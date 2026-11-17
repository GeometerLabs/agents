// The runtime core's part of "limits, tightened by a tap" (17 Nov 2026; modules/Explanation.md). The core hands it three things, the way it hands the owner's sign-in its own:
//   apply(store)      before every step: the settings object the agent reads gets what is in force now (the tighter of the settings and any pending tightening), so the
//                     runtime's own checks obey a tapped limit at once and drop it again if the change failed;
//   run(event, ...)   two events that only the runtime's own HTTP layer can make: `limit_settled` (the deployer says Guard has the new value, or that the change failed)
//                     and `owner_limit` (the owner's own limits page, behind their passkey: a tightening or a loosening within the template's hard bounds);
//   view(store)       what the deployer reads (the pending changes and the file's own values) and what the owner's limits page shows.
// A change is a LimitChange in the assistant's state (modules/limits/chat-limits.ts), so it is saved in the same step and transaction as everything else, and the record
// gets a `limit_change` line when it is made and when it settles. Nothing here sends a message: the assistant tells the owner on its next beat (assistant/limits-card.ts).
//
// Why the event kinds are not in the inbox's list: neither the inbox's token nor the channel token can send them. `limit_settled` comes from the deployer's `ops`
// through the internal route (http.ts), `owner_limit` from the owner-limits route, which needs a session the owner made with their PASSKEY.
import type { Language } from "../language/languages.ts";
import type { ActionRecord } from "../record/record.ts";
import { assistantOf, nextId } from "../assistant/state.ts";
import type { AssistantState } from "../assistant/state.ts";
import { applyInForce, getAt, inForce, judgeChange, limitBase, limitNamed } from "./chat-limits.ts";
import type { ChatLimit, ChangeDirection, LimitChange } from "./chat-limits.ts";

/** The deployer says what became of a change: Guard reports the new value (active), or something failed and the previous limit stands (failed). */
export interface LimitSettledEvent { kind: "limit_settled"; id: string; change: string; result: "active" | "failed"; why?: string }
/** The owner's own limits page, behind their passkey, asks for a value. The direction is decided here from the numbers, never taken from the page. */
export interface OwnerLimitEvent { kind: "owner_limit"; id: string; limit: string; to: number }
export type LimitsEvent = LimitSettledEvent | OwnerLimitEvent;

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/u;
const CHANGE_ID = /^l-\d{1,9}$/u;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The body of POST /internal/limit-changes (the deployer's word), checked for shape. The reason is plain words, cut short, and never carries a secret (the deployer writes it). */
export function checkSettled(body: unknown): { ok: true; event: LimitSettledEvent } | { ok: false; error: string } {
  if (!isObj(body) || typeof body.id !== "string" || !REQUEST_ID.test(body.id) || typeof body.change !== "string" || !CHANGE_ID.test(body.change) || (body.result !== "active" && body.result !== "failed")) {
    return { ok: false, error: 'Send {"id": a request id, "change": "l-3", "result": "active" or "failed", "why"?: words}.' };
  }
  const why = typeof body.why === "string" ? body.why.replace(/\s+/gu, " ").trim().slice(0, 160) : undefined;
  return { ok: true, event: { kind: "limit_settled", id: body.id, change: body.change, result: body.result, ...(why ? { why } : {}) } };
}

/** The body of POST /internal/channel/owner-limits, checked for shape. */
export function checkOwnerLimit(body: unknown): { ok: true; event: OwnerLimitEvent } | { ok: false; error: string } {
  if (!isObj(body) || typeof body.id !== "string" || !REQUEST_ID.test(body.id) || typeof body.limit !== "string" || !/^[a-z_]{1,40}$/u.test(body.limit) || typeof body.to !== "number" || !Number.isSafeInteger(body.to)) {
    return { ok: false, error: 'Send {"id": a request id, "limit": a limit id, "to": a whole number}.' };
  }
  return { ok: true, event: { kind: "owner_limit", id: body.id, limit: body.limit, to: body.to } };
}

/** The task key of each: one per request id, so a redelivery is one. */
export const limitsEventKey = (e: LimitsEvent): string => `${e.kind}:${e.id}`;

/** One limit as the owner's page and the deployer read it. */
export interface LimitRow {
  id: string;
  path: string;
  unit: ChatLimit["unit"];
  tighter: ChatLimit["tighter"];
  zeroIsOff: boolean;
  name: Record<Language, string>;
  rule: Record<Language, string>;
  /** The value in force now (a pending tightening counted) and what the settings file said when the runtime started. */
  inForce: number;
  file: number;
  bounds: { min: number; max: number };
}
export interface LimitsView { limits: LimitRow[]; changes: LimitChange[] }

export interface LimitsKitOptions {
  declared: readonly ChatLimit[];
  /** The live settings object the agent reads. The kit puts what is in force into it before every step. */
  settings: object;
  clock: { now(): number };
  owner: { whatsapp: string; language: Language };
}

/** What the core needs of the kit; generic over the store so the core stays template-free. */
export interface LimitsKit<Store extends { assistant?: AssistantState }> {
  declared: readonly ChatLimit[];
  takes(event: { kind: string }): boolean;
  run(event: LimitsEvent, ctx: { store: Store; record: ActionRecord }): void;
  apply(store: Store): void;
  view(store: Store): LimitsView;
}

export function createLimitsKit<Store extends { assistant?: AssistantState }>(o: LimitsKitOptions): LimitsKit<Store> {
  // remembered before any step moves the settings object (chat-limits.ts limitBase)
  const base = limitBase(o.declared, o.settings);
  const changesOf = (store: Store): LimitChange[] => store.assistant?.limitChanges ?? [];

  function record(ctx: { record: ActionRecord }, c: LimitChange, outcome: "unconfirmed" | "confirmed" | "failed" | "blocked", notes: string): void {
    ctx.record.append({
      conversation: o.owner.whatsapp, action: "limit_change", outcome, inputs: { limit: c.limit, change: c.id }, language: o.owner.language, notes,
      refs: { limit: c.limit, path: c.path, change: c.id, from: String(c.from), to: String(c.to), direction: c.direction, by: c.by, state: c.state, ...(c.why ? { why: c.why } : {}) },
    });
  }

  return {
    declared: o.declared,
    takes: (event) => event.kind === "limit_settled" || event.kind === "owner_limit",

    run(event, ctx) {
      const s = assistantOf(ctx.store);
      if (event.kind === "limit_settled") {
        const c = s.limitChanges.find((x) => x.id === event.change);
        // a word about a change this store does not have, or one already settled, changes nothing (a redelivery, or a deployer that lost its place)
        if (!c || c.state !== "pending") {
          ctx.record.append({ conversation: o.owner.whatsapp, action: "limit_change", outcome: "blocked", inputs: { change: event.change }, language: o.owner.language, notes: c ? `the change was already ${c.state}: nothing was changed` : "no such change: nothing was changed", refs: { change: event.change, result: event.result } });
          return;
        }
        c.state = event.result;
        c.settledAtMs = o.clock.now();
        if (event.why) c.why = event.why;
        applyInForce(o.declared, o.settings, base, s.limitChanges);
        record(ctx, c, event.result === "active" ? "confirmed" : "failed",
          event.result === "active" ? "Guard reported the new value: the change is Active" : "the change did not go through: the previous limit is still in force, and the runtime dropped its tighter value");
        return;
      }
      // the owner's own page: the limit must be a declared one, and the numbers decide the direction
      const limit = limitNamed(o.declared, event.limit);
      if (!limit || base[limit.id] === undefined) return;
      const from = inForce(limit, base[limit.id], s.limitChanges);
      const tightens = judgeChange(limit, { settings: o.settings, base: base[limit.id], changes: s.limitChanges, to: event.to, direction: "tighten" }).ok;
      const direction: ChangeDirection = tightens ? "tighten" : "loosen";
      const r = judgeChange(limit, { settings: o.settings, base: base[limit.id], changes: s.limitChanges, to: event.to, direction });
      if (!r.ok) {
        ctx.record.append({ conversation: o.owner.whatsapp, action: "limit_change", outcome: "blocked", inputs: { limit: limit.id }, language: o.owner.language, notes: `the owner's page asked for ${event.to}, which is not allowed (${r.why}): nothing was changed`, refs: { limit: limit.id, from: String(from), to: String(event.to), by: "owner_app", why: r.why } });
        return;
      }
      const change: LimitChange = { id: nextId(s, "l"), limit: limit.id, path: limit.path, from: r.from, to: event.to, direction, by: "owner_app", state: "pending", atMs: o.clock.now() };
      s.limitChanges.push(change);
      applyInForce(o.declared, o.settings, base, s.limitChanges);
      record(ctx, change, "unconfirmed", direction === "tighten"
        ? "the owner tightened it in their app behind their passkey; the runtime obeys it now and the deployer is asked to put it where Guard's spec is made"
        : "the owner loosened it in their app behind their passkey, within the template's bounds; it is Pending until Guard reports the new value, and the Operator is told, never asked");
    },

    apply(store) {
      const changes = changesOf(store);
      applyInForce(o.declared, o.settings, base, changes);
    },

    view(store) {
      const changes = changesOf(store);
      return {
        limits: o.declared.filter((l) => base[l.id] !== undefined).map((l) => ({
          id: l.id, path: l.path, unit: l.unit, tighter: l.tighter, zeroIsOff: l.zeroIsOff === true, name: l.name, rule: l.rule,
          inForce: inForce(l, base[l.id], changes), file: base[l.id], bounds: l.bounds(o.settings),
        })),
        changes: changes.slice(),
      };
    },
  };
}

/** The value at a limit's path in a settings text the deployer holds (for the deployer's read of the file): a whole number or undefined. */
export function valueIn(settings: unknown, limit: ChatLimit): number | undefined {
  const v = getAt(settings, limit.path);
  return typeof v === "number" && Number.isSafeInteger(v) ? v : undefined;
}
