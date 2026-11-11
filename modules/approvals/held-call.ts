// A call Guard holds for a person on an agent's OWN API (B71 step 6, `own-api`): an API with no payment module here, whose Guard spec its builder reviewed with
// the companies kit. The approvals relay asks the owner about it on WhatsApp the way it asks about a template's held refund (modules/approvals/relay.ts), with
// two differences that this file is for:
//   - which calls are the owner's to answer, and which field is the amount, come from the spec's own `call_bound_approval` rules (`heldRulesOf`), never from a
//     provider's declaration (there is none), and never from the agent;
//   - the amount is in the API's own unit (the rule's `units`, "cents" in the kit's example): it is shown with that unit, and as rupees only when the unit is paise.
// Everything the owner is shown comes from Guard's held call: the operation, the amount (typed: an amount sent as text is a different call, and is not shown),
// and up to a few of the call's other plain fields, so the owner sees what the yes is for (B74). A yes is given to Guard for that approval id only; Guard
// releases only the identical call when the agent sends it again.
//
// Used by bundle/agent/relay-context.ts (the context of a held call) and bundle/services/relay.ts (the relay of an own agent on its own API).
import type { Held, ReadHeld } from "./clients.ts";
import { NOT_A_REFUND } from "./clients.ts";

/** One rule of the spec that holds a call for a person: the operation, the field Guard reads the amount from, and its unit when the builder named one. */
export interface HeldCallRule { operation: string; amountField: string; unit?: string }

/** The own API's Guard: its tool name (the spec's), and the calls the owner is asked about. */
export interface HeldCallSpec { tool: string; rules: HeldCallRule[] }

/** What the owner is shown of a held own-API call, besides its amount (Held.amountPaise carries the amount in the API's unit, see below). */
export interface HeldCall { operation: string; unit?: string; /** The call's other plain fields, as "name value" pairs, already cut to what may be shown. */ details: string[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const millis = (v: unknown): number | undefined => (typeof v === "string" && /^\d{1,16}$/u.test(v) ? Number(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/** At most this many other fields are shown, each value at most this long. The agent chose them, so only id-like tokens are shown, never anything that could read as a link, an address or a code reply. */
export const DETAIL_FIELDS = 3;
export const DETAIL_LENGTH = 40;
const PLAIN_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/u;
const PLAIN_VALUE = new RegExp(`^[A-Za-z0-9_-]{1,${DETAIL_LENGTH}}$`, "u");

/** The spec's rules that hold a call for a person, read from the spec Guard was given (the kit's `call_bound_approval`, with `amount_field` and `units`). */
export function heldRulesOf(spec: { tool?: unknown; rules?: unknown }): HeldCallSpec {
  const rules = (Array.isArray(spec.rules) ? spec.rules : []).filter((r): r is Record<string, unknown> => isRecord(r) && r.kind === "call_bound_approval" && typeof r.operation === "string" && typeof r.amount_field === "string")
    .map((r) => {
      const unit = isRecord(r.units) ? r.units[r.amount_field as string] : undefined;
      return { operation: r.operation as string, amountField: r.amount_field as string, ...(typeof unit === "string" && unit.trim() !== "" ? { unit: unit.trim() } : {}) };
    });
  return { tool: typeof spec.tool === "string" ? spec.tool : "", rules };
}

/**
 * The plain fields of a held call other than its amount, as the owner may read them: names and values that look like ids (letters, digits, `_` and `-`), cut
 * short, at most DETAIL_FIELDS. The agent chose the values, so anything else is left out rather than cleaned: a map or a list, prose, a line break, the words
 * "approve" or "deny", and anything with a dot, colon or @ in it, which WhatsApp could show as a link or an address.
 */
function detailsOf(args: Record<string, unknown>, amountField: string): string[] {
  const out: string[] = [];
  for (const [name, v] of Object.entries(args).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (name === amountField || !PLAIN_NAME.test(name) || !Array.isArray(v) || (v[0] !== "str" && v[0] !== "int") || typeof v[1] !== "string") continue;
    const value = v[1].trim();
    if (!PLAIN_VALUE.test(value) || /\b(approve|deny)\b/iu.test(value)) continue;
    out.push(`${name} ${value}`);
    if (out.length === DETAIL_FIELDS) break;
  }
  return out;
}

/**
 * One review item (GET /admin/reviews) as a held own-API call, or why not. `amountPaise` in the result is the amount in the API's own unit (the relay's store
 * keeps one amount column; for an own API it is not paise unless the unit says so). `receipt` is the approval id: there is no case on our side to look up, so the
 * context is read from Guard's held call by its id (bundle/agent/relay-context.ts ownApiRuntime). A request that names several approvers is not asked about here
 * (an own agent's Guard has the owner alone), and is the builder's.
 */
export function readHeldCall(item: unknown, spec: HeldCallSpec): ReadHeld & { call?: HeldCall } {
  if (!isRecord(item)) return { ok: false, reason: "a review item that is not an object" };
  const id = typeof item.id === "string" && item.id.length > 0 ? item.id : undefined;
  if (!id) return { ok: false, reason: "a held call with no approval id: it cannot be approved on WhatsApp, and is for the builder" };
  const no = (reason: string): ReadHeld => ({ ok: false, id, reason });
  const rule = item.tool === spec.tool ? spec.rules.find((r) => r.operation === item.operation) : undefined;
  if (!rule) return no(`it is a ${String(item.operation)} on ${String(item.tool)}, ${NOT_A_REFUND}`);
  if ("may_still_decide" in item || "approvals_needed" in item || "requested_by" in item) return no("it names several approvers, and the owner of an agent's own API is asked alone");
  const args = Array.isArray(item.arguments) && item.arguments[0] === "map" && isRecord(item.arguments[1]) ? item.arguments[1] : undefined;
  if (!args) return no("its arguments are not in the typed form Guard writes");
  const amountArg = args[rule.amountField];
  const amount = Array.isArray(amountArg) && amountArg[0] === "int" && typeof amountArg[1] === "string" ? amountArg[1] : undefined;
  if (amount === undefined || !/^[1-9]\d{0,11}$/u.test(amount)) return no(`its ${rule.amountField} is not a whole number written as a number`);
  const requestedAtMs = millis(item.requested_at_ms);
  const expiresAtMs = millis(item.expires_at_ms);
  if (requestedAtMs === undefined || expiresAtMs === undefined) return no("it has no times");
  const held: Held = { id, agent: typeof item.agent === "string" ? item.agent : "", amountPaise: Number(amount), paymentId: "", receipt: id, requestedAtMs, expiresAtMs, youMayDecide: typeof item.you_may_decide === "boolean" ? item.you_may_decide : null };
  return { ok: true, held, call: { operation: rule.operation, ...(rule.unit ? { unit: rule.unit } : {}), details: detailsOf(args, rule.amountField) } };
}
