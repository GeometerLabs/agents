// Which settings are limits, and which way is tighter. The Claude Code plugin (plan B11) may only DRAFT a change that makes a limit tighter or leaves it as it is;
// the panel checks the same thing again when a person confirms. It is a short list on purpose, and anything not on it is refused: a field with no known tight
// direction, an unknown template, a price, a deposit, an opening hour. Those are changed by a person in the panel's own form.
//
// One place, used by both the plugin's tools (to refuse early and show the change) and the panel (to refuse for good), so the two cannot disagree.
import { createHash } from "node:crypto";
import { canonicalJson } from "../../modules/record/record.ts";

export interface LimitField { path: string; label: string; /** Which direction of the number is tighter. */ tighter: "lower" | "higher"; rupees: boolean }

/** Per template id. A template that is not here has no field a plugin may change. */
export const TIGHTEN_ONLY: Readonly<Record<string, readonly LimitField[]>> = {
  bookings: [
    { path: "cancellation.refundLimitInr", label: "Largest refund the agent may make without asking the owner", tighter: "lower", rupees: true },
  ],
  fees: [
    { path: "refund.limitInr", label: "Largest refund the agent may make without asking the owner", tighter: "lower", rupees: true },
    { path: "waiver.limitInr", label: "Largest late fee the agent may waive without asking the owner", tighter: "lower", rupees: true },
    { path: "lateFeeInr", label: "Late fee", tighter: "lower", rupees: true },
    { path: "reminders.maxPerMonth", label: "Most reminders to one parent in a month", tighter: "lower", rupees: false },
    { path: "partPayments.minInr", label: "Smallest part payment accepted", tighter: "higher", rupees: true },
  ],
};

export interface Change { path: string; value: number }
export interface ChangeRow { path: string; label: string; from: unknown; to: unknown; verdict: "tighter" | "wider" | "not-a-limit-the-plugin-may-change" }

export const settingsDigest = (settings: unknown): string => createHash("sha256").update(canonicalJson(settings)).digest("hex");

export function getPath(obj: unknown, path: string): unknown {
  let at: any = obj;
  for (const part of path.split(".")) { if (at === null || typeof at !== "object") return undefined; at = at[part]; }
  return at;
}

/** A copy of the settings with the changes put in. A path that is not already in the settings is refused (a change never adds a field). */
export function applyChanges(settings: unknown, changes: readonly Change[]): { ok: true; settings: any } | { ok: false; problem: string } {
  const copy = JSON.parse(JSON.stringify(settings));
  for (const c of changes) {
    if (typeof c.path !== "string" || !/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/u.test(c.path)) return { ok: false, problem: `"${String(c.path)}" is not a settings path.` };
    const parts = c.path.split(".");
    let at: any = copy;
    for (const p of parts.slice(0, -1)) { if (at === null || typeof at !== "object" || !Object.hasOwn(at, p)) return { ok: false, problem: `${c.path} is not in these settings.` }; at = at[p]; }
    const last = parts.at(-1) as string;
    if (at === null || typeof at !== "object" || !Object.hasOwn(at, last)) return { ok: false, problem: `${c.path} is not in these settings.` };
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) return { ok: false, problem: `${c.path} must be given as a number.` };
    at[last] = c.value;
  }
  return { ok: true, settings: copy };
}

function leaves(value: unknown, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  else out.set(prefix, JSON.stringify(value));
  return out;
}

/**
 * Every difference between the settings in force and the settings proposed, with a verdict. Default-deny: a difference is "tighter" only when the path is on the
 * template's list, both values are numbers, and the number moved the tight way. Anything else, including a path that was added or removed, is not allowed.
 */
export function judgeChanges(kindId: string, current: unknown, proposed: unknown): ChangeRow[] {
  const before = leaves(current);
  const after = leaves(proposed);
  const fields = TIGHTEN_ONLY[kindId] ?? [];
  const rows: ChangeRow[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) === after.get(path)) continue;
    const from = getPath(current, path);
    const to = getPath(proposed, path);
    const field = fields.find((f) => f.path === path);
    let verdict: ChangeRow["verdict"] = "not-a-limit-the-plugin-may-change";
    if (field && typeof from === "number" && typeof to === "number") verdict = (field.tighter === "lower" ? to < from : to > from) ? "tighter" : "wider";
    rows.push({ path, label: field?.label ?? path, from, to, verdict });
  }
  return rows;
}

/** The limits a plugin may tighten, with their value now: what `draft_limits` shows when it is asked for no change. */
export function currentLimits(kindId: string, settings: unknown): { path: string; label: string; value: unknown; tighter: "lower" | "higher" }[] {
  return (TIGHTEN_ONLY[kindId] ?? []).map((f) => ({ path: f.path, label: f.label, value: getPath(settings, f.path), tighter: f.tighter }));
}

/** Plain sentence for a row the plugin or the panel refuses. */
export function refusalText(row: ChangeRow): string {
  return row.verdict === "wider"
    ? `${row.label} would go from ${String(row.from)} to ${String(row.to)}, which loosens it. Only a person can loosen a limit, in the panel's edit form.`
    : `${row.path} is not a limit the plugin may change (${String(row.from)} to ${String(row.to)}). A person changes it in the panel's edit form.`;
}
