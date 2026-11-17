// The limits an owner may change by a tap or from their own app, as pure functions (17 Nov 2026, "Limits, tightened by a tap", modules/Explanation.md). A template
// DECLARES which of its settings are such limits (templates/*/src/chat-limits.ts): the id, the settings path, which direction of the number is tighter, the hard bounds
// and the words in four languages. This file holds what is the same for every template: is a new value STRICTLY TIGHTER than the limit in force now, is it within the
// bounds, what is in force when a change is still being applied, and the record of a change (Pending, Active, Failed).
//
// Why "in force now" and not "the settings file": a change the owner tapped but Guard's spec does not carry yet is already in force in the runtime (it is only
// stricter), so a second tap must be compared with it, not with the older file. And a change is judged against the number, never against the words: "refunds above
// ₹500" LOOSENS a limit of ₹200, whatever the owner meant. Only a strictly tighter value is ever offered from the chat.
//
// No disk, no network and no node:sqlite: the browser demo is built from the agent, and Guard can run the same functions later.
import type { Language } from "../language/languages.ts";

/** One limit a template lets the owner change. All values are whole numbers: rupees for "inr", a count for "count". */
export interface ChatLimit {
  /** Stable name, used in cards and the record: "refund_limit". */
  id: string;
  /** Where it sits in the settings file ("cancellation.refundLimitInr"). The deployer writes only this path. */
  path: string;
  unit: "inr" | "count";
  /** Which direction of the number is tighter. */
  tighter: "lower" | "higher";
  /** For a limit where 0 means "no limit at all" (Orders: approve orders above ₹N, 0 is never): 0 is the loosest value, so any other number is tighter. */
  zeroIsOff?: boolean;
  /** The hard bounds of a value the owner may set (a settings-dependent bound, such as "never more than the cheapest fee", reads the settings). */
  bounds(settings: unknown): { min: number; max: number };
  /** What the owner calls it, in each language ("refund limit"). */
  name: Record<Language, string>;
  /** The rule as a sentence with the value as {v}: "Refunds above {v} will need your approval". */
  rule: Record<Language, string>;
  /** Words that name it in the owner's message (any language, lower case, matched as whole words). The talk model may only choose among the ids, never write a value. */
  words: readonly string[];
}

export type ChangeState = "pending" | "active" | "failed";
export type ChangeDirection = "tighten" | "loosen";
/** Where a change came from: the owner's tap on a card (WhatsApp or the app's talk), or the owner's own limits page behind their passkey. */
export type ChangeBy = "owner_chat" | "owner_app";

/** One change, as the runtime keeps it in the assistant's state (saved in the step that made it) and as the deployer reads it. */
export interface LimitChange {
  /** "l-3": never given twice. */
  id: string;
  limit: string;
  path: string;
  /** The value in force when it was made, and the value asked for. */
  from: number;
  to: number;
  direction: ChangeDirection;
  by: ChangeBy;
  state: ChangeState;
  atMs: number;
  settledAtMs?: number;
  /** Why it failed, in the deployer's plain words (never a secret). */
  why?: string;
}

/** How many settled changes the state keeps (the record keeps all of them). */
export const KEEP_SETTLED_CHANGES = 30;

/** Is this whole number a value this limit can hold at all? */
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** How loose a value is, so two values can be compared whatever the direction: bigger is looser. A "no limit" 0 is the loosest of all. */
function looseness(limit: ChatLimit, v: number): number {
  if (limit.zeroIsOff && v === 0) return Number.POSITIVE_INFINITY;
  return limit.tighter === "lower" ? v : -v;
}

/** Is `proposed` STRICTLY tighter than `inForce`? Equal is not tighter: nothing is offered that changes nothing. */
export function isStrictlyTighter(limit: ChatLimit, inForceValue: number, proposed: number): boolean {
  if (!whole(inForceValue) || !whole(proposed)) return false;
  return looseness(limit, proposed) < looseness(limit, inForceValue);
}

/** The tighter of two values (the first when they are equal). */
export const tighterOf = (limit: ChatLimit, a: number, b: number): number => (isStrictlyTighter(limit, a, b) ? b : a);

/** Is the value a whole number inside the limit's hard bounds for these settings? */
export function withinBounds(limit: ChatLimit, settings: unknown, value: number): boolean {
  if (!whole(value)) return false;
  const { min, max } = limit.bounds(settings);
  return value >= min && value <= max;
}

/**
 * What is in force now, given what the settings said when the runtime started (`base`) and the changes saved since:
 *  - an ACTIVE change whose `from` is the value so far is already in the file the deployer wrote, but the runtime may not have restarted yet: it counts, in order;
 *  - a PENDING tightening counts at once, as the tighter of the value so far and its own (it is only stricter);
 *  - a PENDING loosening and a FAILED change never count: a loosening is in force only when Guard has it (Active), and a failure leaves the previous limit.
 * An active change whose `from` is not the value so far is ignored: the file moved on by another way (the panel), and the file wins.
 */
export function inForce(limit: ChatLimit, base: number, changes: readonly LimitChange[]): number {
  let v = base;
  for (const c of changes) if (c.limit === limit.id && c.state === "active" && c.from === v) v = c.to;
  for (const c of changes) if (c.limit === limit.id && c.state === "pending" && c.direction === "tighten") v = tighterOf(limit, v, c.to);
  return v;
}

export type ProposalRefusal =
  | "not_whole" // not a whole number
  | "not_tighter" // from the chat or a tap: not strictly tighter than what is in force
  | "not_looser" // from the app: not looser than what is in force (nothing to loosen)
  | "out_of_bounds" // outside the template's hard bounds
  | "busy"; // a change to this limit is still being applied (loosening waits for it)

/**
 * May the owner make this change? `direction` is what the caller intends: the chat only ever asks for "tighten"; the app's page asks for either. The check is on the
 * numbers, against the limit in force now (pending tightenings included), and is made again on the tap and again by the deployer against the file.
 */
export function judgeChange(limit: ChatLimit, a: { settings: unknown; base: number; changes: readonly LimitChange[]; to: number; direction: ChangeDirection }): { ok: true; from: number } | { ok: false; why: ProposalRefusal; from: number } {
  const from = inForce(limit, a.base, a.changes);
  if (!whole(a.to)) return { ok: false, why: "not_whole", from };
  if (!withinBounds(limit, a.settings, a.to)) return { ok: false, why: "out_of_bounds", from };
  if (a.direction === "tighten") return isStrictlyTighter(limit, from, a.to) ? { ok: true, from } : { ok: false, why: "not_tighter", from };
  if (a.changes.some((c) => c.limit === limit.id && c.state === "pending")) return { ok: false, why: "busy", from };
  return isStrictlyTighter(limit, a.to, from) ? { ok: true, from } : { ok: false, why: "not_looser", from };
}

/** The settings value at a dotted path, or undefined when a step is missing. */
export function getAt(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const part of path.split(".")) { if (at === null || typeof at !== "object") return undefined; at = (at as Record<string, unknown>)[part]; }
  return at;
}

/** Set the value at a path that already exists (a change never adds a field). Returns whether it was set. */
export function setAt(obj: unknown, path: string, value: number): boolean {
  const parts = path.split(".");
  let at: unknown = obj;
  for (const p of parts.slice(0, -1)) { if (at === null || typeof at !== "object") return false; at = (at as Record<string, unknown>)[p]; }
  const last = parts.at(-1)!;
  if (at === null || typeof at !== "object" || !Object.hasOwn(at, last)) return false;
  (at as Record<string, unknown>)[last] = value;
  return true;
}

/** The declared limit with this id. */
export const limitNamed = (declared: readonly ChatLimit[], id: string): ChatLimit | undefined => declared.find((l) => l.id === id);

/** The values every declared limit has in the settings now (before any overlay): what a kit captures at start. */
export function baseValues(declared: readonly ChatLimit[], settings: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of declared) { const v = getAt(settings, l.path); if (whole(v)) out[l.id] = v; }
  return out;
}

/** Put what is in force into the settings object the agent reads, so the runtime's own checks use the tighter value at once. Returns the ids it moved. */
export function applyInForce(declared: readonly ChatLimit[], settings: unknown, base: Record<string, number>, changes: readonly LimitChange[]): string[] {
  const moved: string[] = [];
  for (const l of declared) {
    if (base[l.id] === undefined) continue;
    const v = inForce(l, base[l.id], changes);
    if (getAt(settings, l.path) !== v && setAt(settings, l.path, v)) moved.push(l.id);
  }
  return moved;
}

/** Take settled changes off, keeping the newest few (a pending one is never taken). Returns how many went. */
export function compactChanges(changes: LimitChange[]): number {
  const settled = changes.filter((c) => c.state !== "pending");
  const drop = new Set(settled.slice(0, Math.max(0, settled.length - KEEP_SETTLED_CHANGES)).map((c) => c.id));
  if (drop.size === 0) return 0;
  const keep = changes.filter((c) => !drop.has(c.id));
  changes.length = 0;
  changes.push(...keep);
  return drop.size;
}
