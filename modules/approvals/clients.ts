// The two things the relay talks to besides WhatsApp: Guard's admin port (to read what it holds, and to give it the owner's signed answer)
// and the runtime (a read-only look at the booking behind a held refund, and the word that the owner decided).
//
// What the relay trusts, and from where:
//   - WHAT the owner is asked to approve (the payment and the amount in paise) comes only from Guard's held call. Never from the runtime.
//   - the runtime's view is context: it is cross-checked against Guard's, and if the two disagree the relay does not ask.
import { createHmac, randomUUID } from "node:crypto";

const TIMEOUT_MS = 5_000;
/** Why a request failed, in a word: "ECONNREFUSED", "TimeoutError". Never the address or anything the other side said. */
const why = (e: unknown): string => (e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? "error";

// ---- Guard ------------------------------------------------------------------------------------------------------------------------

/** A held refund, read from one item of GET /admin/reviews. */
export interface Held {
  id: string;
  agent: string;
  amountPaise: number;
  paymentId: string;
  receipt: string | null;
  requestedAtMs: number;
  expiresAtMs: number;
  youMayDecide: boolean | null;
  /**
   * B37 (Guard's ADR-0061): present only on a request that needs several approvals or names who asked for it. `mayStillDecide` is whom to ask: the same for
   * every reader, sorted, without the people who asked, those who answered, removed approvers and roles not escalated to yet. Absent: one owner, as before.
   */
  group?: HeldGroup;
}

export interface HeldGroup {
  needed: number;
  given: number;
  votes: { approver: string; decision: "approve" | "deny" }[];
  requestedBy: string[];
  mayStillDecide: string[];
}

export type ReadHeld = { ok: true; held: Held } | { ok: false; id?: string; reason: string };

const ids = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u.test(x)) ? v as string[] : undefined);

/** The B37 keys of a review item, all of them or nothing (a request with only some of them is not in the form Guard writes). */
function readGroup(item: Record<string, unknown>): HeldGroup | undefined | "malformed" {
  if (!("may_still_decide" in item) && !("approvals_needed" in item) && !("requested_by" in item)) return undefined;
  const needed = item.approvals_needed, given = item.approvals_given;
  const mayStillDecide = ids(item.may_still_decide), requestedBy = ids(item.requested_by);
  const votes = Array.isArray(item.votes) && item.votes.every((v) => isRecord(v) && typeof v.approver === "string" && (v.decision === "approve" || v.decision === "deny"))
    ? (item.votes as Record<string, unknown>[]).map((v) => ({ approver: v.approver as string, decision: v.decision as "approve" | "deny" })) : undefined;
  if (!Number.isSafeInteger(needed) || (needed as number) < 1 || (needed as number) > 20 || !Number.isSafeInteger(given) || (given as number) < 0 || !mayStillDecide || !requestedBy || !votes) return "malformed";
  return { needed: needed as number, given: given as number, votes, requestedBy, mayStillDecide };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const millis = (v: unknown): number | undefined => (typeof v === "string" && /^\d{1,16}$/u.test(v) ? Number(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/**
 * One review item as a held refund. The amount and the payment come from the item's TYPED arguments (`["int","60000"]`, `["str","pay_x"]`), and the
 * tag must be the right one: an amount that came as a string is a different call (Guard binds approval to the call's digest) and is not shown to the owner.
 */
export function readHeld(item: unknown): ReadHeld {
  if (!isRecord(item)) return { ok: false, reason: "a review item that is not an object" };
  const id = typeof item.id === "string" && item.id.length > 0 ? item.id : undefined;
  if (!id) return { ok: false, reason: "a held call with no approval id: it cannot be approved on WhatsApp, and is for the builder" };
  const no = (reason: string): ReadHeld => ({ ok: false, id, reason });
  if (item.tool !== "razorpay" || item.operation !== "refund") return no(`it is a ${String(item.operation)} on ${String(item.tool)}, not a refund on razorpay`);
  const args = Array.isArray(item.arguments) && item.arguments[0] === "map" && isRecord(item.arguments[1]) ? item.arguments[1] : undefined;
  if (!args) return no("its arguments are not in the typed form Guard writes");
  const typed = (name: string, tag: string): string | undefined => { const v = args[name]; return Array.isArray(v) && v[0] === tag && typeof v[1] === "string" ? v[1] : undefined; };
  const amount = typed("amount", "int");
  if (amount === undefined || !/^[1-9]\d{0,11}$/u.test(amount)) return no("its amount is not a whole number of paise written as a number");
  const paymentId = typed("payment_id", "str");
  if (paymentId === undefined || !/^[A-Za-z0-9_]{1,64}$/u.test(paymentId)) return no("it names no payment, or one that does not look like a payment id");
  const receipt = typed("receipt", "str") ?? null;
  const requestedAtMs = millis(item.requested_at_ms);
  const expiresAtMs = millis(item.expires_at_ms);
  if (requestedAtMs === undefined || expiresAtMs === undefined) return no("it has no times");
  const group = readGroup(item);
  if (group === "malformed") return no("it says it needs several approvals, but not in the form Guard writes (approvals_needed, approvals_given, votes, requested_by, may_still_decide)");
  return { ok: true, held: { id, agent: typeof item.agent === "string" ? item.agent : "", amountPaise: Number(amount), paymentId, receipt, requestedAtMs, expiresAtMs, youMayDecide: typeof item.you_may_decide === "boolean" ? item.you_may_decide : null, ...(group ? { group } : {}) } };
}

export type Reviews = { ok: true; items: unknown[] } | { ok: false; credential: boolean; error: string };

export type Notified =
  /**
   * Guard took the answer. `state` is the request's after it (B37: "pending" means more approvals are needed, and only "approved" or "denied" is a decision);
   * `needed` and `given` are there when the request needs several approvals.
   */
  | { kind: "recorded"; state?: string; needed?: number; given?: number }
  /**
   * Guard already has an answer. With `by`, it is THIS approver's earlier vote on a request still waiting for others ("is already approved by asha: each
   * approver decides once (1 of 2 approvals so far)"); `state` is then what that approver answered, not the request's. Without `by`, the request is decided.
   */
  | { kind: "already"; state: string; by?: string; given?: number; needed?: number }
  | { kind: "expired" }
  | { kind: "missing" }
  /** B37: the approver asked for this call themselves, so Guard will not take their answer. The relay should never have asked them. */
  | { kind: "requester"; error: string }
  | { kind: "refused"; status: number; error: string } // signature, approver, time or role: the relay is set up wrongly
  | { kind: "unreachable"; error: string };

export interface GuardClient {
  /** The held calls the read credential can see. */
  reviews(): Promise<Reviews>;
  /**
   * An approver's answer, signed with that approver's own secret: the owner's when `approver` is left out (or is the owner's id). A new nonce and time every
   * call, so a try that did not get through can go again.
   */
  notify(approval: string, decision: "approve" | "deny", approver?: string): Promise<Notified>;
}

export interface GuardConfig {
  /** Guard's admin port (loopback, reached from a sidecar that shares Guard's network). */
  adminUrl: string;
  /** An approver's credential, which Guard issues from the admin port and expires. It reads the held calls; the relay never holds an admin token. */
  readToken: string;
  /** The owner's id in Guard's approver directory, and the secret that signs the owner's answers. */
  approverId: string;
  approverSecret: string;
  /** B37: another approver's signing secret, by their id in Guard's directory (each person signs their own answers). Undefined: they cannot answer through this relay. */
  secretOf?(approverId: string): string | undefined;
  now(): number;
}

/** Guard's 409 words for an answer it already has, read once here ("approval X is already approved by asha: each approver decides once (1 of 2 approvals so far)"). */
export function readAlready(error: string): { state: string; by?: string; given?: number; needed?: number } {
  const vote = /already (approved|denied) by ([A-Za-z0-9][A-Za-z0-9._:/@+-]*): each approver decides once \((\d+) of (\d+) approvals so far\)/iu.exec(error);
  if (vote) return { state: vote[1]!.toLowerCase(), by: vote[2]!, given: Number(vote[3]), needed: Number(vote[4]) };
  return { state: /already (\w+)/iu.exec(error)?.[1]?.toLowerCase() ?? "decided" };
}

export function createGuardClient(config: GuardConfig): GuardClient {
  const url = (path: string) => config.adminUrl.replace(/\/+$/u, "") + path;
  return {
    async reviews() {
      try {
        const response = await fetch(url("/admin/reviews"), { headers: { authorization: `Bearer ${config.readToken}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (response.status === 401 || response.status === 403) { await response.arrayBuffer().catch(() => undefined); return { ok: false, credential: true, error: `Guard did not accept the reading credential (${response.status}); it may have expired` }; }
        if (!response.ok) { await response.arrayBuffer().catch(() => undefined); return { ok: false, credential: false, error: `Guard answered ${response.status}` }; }
        const body = await response.json() as unknown;
        return isRecord(body) && Array.isArray(body.reviews) ? { ok: true, items: body.reviews } : { ok: false, credential: false, error: "Guard's review list was not in the form expected" };
      } catch (e) {
        return { ok: false, credential: false, error: `Guard could not be reached (${why(e)})` };
      }
    },

    async notify(approval, decision, approver) {
      const as = approver ?? config.approverId;
      const secret = as === config.approverId ? config.approverSecret : config.secretOf?.(as);
      if (secret === undefined || (as !== config.approverId && secret === "")) return { kind: "refused", status: 0, error: `the relay holds no signing secret for approver ${as}` };
      // The signature is over the exact bytes sent; the time is now (the message's own time may be older than Guard's five minutes if the provider redelivered).
      const raw = JSON.stringify({ approval, decision, approver: as, at_ms: String(config.now()), nonce: randomUUID() });
      const signature = createHmac("sha256", secret).update(raw).digest("hex");
      try {
        const response = await fetch(url("/admin/notify"), { method: "POST", body: raw, headers: { "content-type": "application/json", "x-geo-signature": signature }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const text = await response.text().catch(() => "");
        let error = text;
        let body: Record<string, unknown> | undefined;
        try { const j = JSON.parse(text) as unknown; if (isRecord(j)) { body = j; if (typeof j.error === "string") error = j.error; } } catch { /* not JSON */ }
        if (response.status === 200) {
          // B37: the answer to a vote is the request itself: its state, and its votes so far (`approve` is a boolean there, unlike the review queue's `decision`)
          const needed = body && Number.isSafeInteger(body.approvals_needed) ? body.approvals_needed as number : undefined;
          const given = body && Array.isArray(body.votes) ? body.votes.filter((v) => isRecord(v) && v.approve === true).length : undefined;
          return { kind: "recorded", ...(typeof body?.state === "string" ? { state: body.state } : {}), ...(needed !== undefined ? { needed } : {}), ...(given !== undefined ? { given } : {}) };
        }
        if (response.status === 409) {
          if (/expired/iu.test(error)) return { kind: "expired" };
          return { kind: "already", ...readAlready(error) };
        }
        if (response.status === 404) return { kind: "missing" };
        if (response.status === 403 && /asked for this call/iu.test(error)) return { kind: "requester", error: error.slice(0, 200) };
        return { kind: "refused", status: response.status, error: error.slice(0, 200) };
      } catch (e) {
        return { kind: "unreachable", error: `Guard could not be reached (${why(e)})` };
      }
    },
  };
}

// ---- the runtime -----------------------------------------------------------------------------------------------------------------------

/**
 * The booking or fee behind a held refund, as the runtime shows it (each template's server/runtime.ts RefundContext). What every template has is first: `booking` is the
 * case's own id ("b-3" for a booking, "f-3" for a fee), and the customer is whoever paid. What only some templates know follows, and is there only for them:
 * Bookings' service and slot, Fees' student, batch and month. A template's voice (approvals/relay.ts) reads the ones it needs and says so if one is missing.
 */
export interface RefundContext {
  booking: string;
  customerPhone: string;
  businessName: string;
  timeZone: string;
  ownerLanguage: "en" | "hi" | "ml" | "kn";
  paymentId: string;
  amountPaise: number;
  approval: string;
  expiresAtMs: number | null;
  /** Bookings: the service in the owner's language, and the slot. */
  serviceName?: string;
  slotMs?: number;
  /** Fees: the student, the batch and the month, in the owner's language. */
  studentName?: string;
  batchName?: string;
  monthLabel?: string;
  /** B37: who asked the agent for this refund, by approver id (the runtime sent them in Geo-Requested-By). They are never asked to approve it. */
  requestedBy?: string[];
}

export type Context = { kind: "found"; context: RefundContext } | { kind: "missing" } | { kind: "error"; error: string };

export interface RuntimeClient {
  context(receipt: string): Promise<Context>;
  /**
   * Tell the agent what the owner decided. True once the runtime has saved it. `id` is new for every delivery: it makes the event its own, so
   * an earlier event for the same approval (a forged one, say) cannot stand in for it and make the runtime drop the real one as a repeat.
   */
  decided(approval: string, decision: "approve" | "deny", id: string): Promise<boolean>;
}

export function createRuntimeClient(config: { url: string; token: string }): RuntimeClient {
  const base = config.url.replace(/\/+$/u, "");
  const headers = { authorization: `Bearer ${config.token}` };
  return {
    async context(receipt) {
      try {
        const response = await fetch(`${base}/internal/refund-context?receipt=${encodeURIComponent(receipt)}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (response.status === 404) { await response.arrayBuffer().catch(() => undefined); return { kind: "missing" }; }
        if (!response.ok) { await response.arrayBuffer().catch(() => undefined); return { kind: "error", error: `the runtime answered ${response.status}` }; }
        const c = await response.json() as Record<string, unknown>;
        const ok = typeof c.booking === "string" && typeof c.customerPhone === "string" && typeof c.businessName === "string" && typeof c.timeZone === "string" && ["en", "hi", "ml", "kn"].includes(c.ownerLanguage as string)
          && typeof c.paymentId === "string" && Number.isSafeInteger(c.amountPaise) && typeof c.approval === "string"
          && ["serviceName", "studentName", "batchName", "monthLabel"].every((k) => c[k] === undefined || typeof c[k] === "string") && (c.slotMs === undefined || Number.isFinite(c.slotMs))
          && (c.requestedBy === undefined || ids(c.requestedBy) !== undefined);
        return ok ? { kind: "found", context: c as unknown as RefundContext } : { kind: "error", error: "the runtime's answer was not in the form expected" };
      } catch (e) {
        return { kind: "error", error: `the runtime could not be reached (${why(e)})` };
      }
    },

    async decided(approval, decision, id) {
      try {
        const response = await fetch(`${base}/internal/events`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ events: [{ kind: "approval_decision", approval, decision, id }] }), signal: AbortSignal.timeout(TIMEOUT_MS) });
        await response.arrayBuffer().catch(() => undefined);
        return response.status >= 200 && response.status < 300;
      } catch {
        return false;
      }
    },
  };
}
