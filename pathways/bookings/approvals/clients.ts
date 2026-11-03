// The two things the relay talks to besides WhatsApp: Guard's admin port (to read what it holds, and to give it the owner's signed answer)
// and the runtime (a read-only look at the booking behind a held refund, and the word that the owner decided).
//
// What the relay trusts, and from where:
//   - WHAT the owner is asked to approve (the payment and the amount in paise) comes only from Guard's held call. Never from the runtime.
//   - the runtime's view is context: it is cross-checked against Guard's, and if the two disagree the relay does not ask.
import { createHmac, randomUUID } from "node:crypto";

const TIMEOUT_MS = 5_000;

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
}

export type ReadHeld = { ok: true; held: Held } | { ok: false; id?: string; reason: string };

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
  return { ok: true, held: { id, agent: typeof item.agent === "string" ? item.agent : "", amountPaise: Number(amount), paymentId, receipt, requestedAtMs, expiresAtMs, youMayDecide: typeof item.you_may_decide === "boolean" ? item.you_may_decide : null } };
}

export type Reviews = { ok: true; items: unknown[] } | { ok: false; credential: boolean; error: string };

export type Notified =
  | { kind: "recorded" }
  | { kind: "already"; state: string } // Guard already has an answer for this approval (ours, from an earlier try, or another)
  | { kind: "expired" }
  | { kind: "missing" }
  | { kind: "refused"; status: number; error: string } // signature, approver, time or role: the relay is set up wrongly
  | { kind: "unreachable"; error: string };

export interface GuardClient {
  /** The held calls the read credential can see. */
  reviews(): Promise<Reviews>;
  /** The owner's answer, signed with the owner's secret. A new nonce and time every call, so a try that did not get through can go again. */
  notify(approval: string, decision: "approve" | "deny"): Promise<Notified>;
}

export interface GuardConfig {
  /** Guard's admin port (loopback, reached from a sidecar that shares Guard's network). */
  adminUrl: string;
  /** An approver's credential, which Guard issues from the admin port and expires. It reads the held calls; the relay never holds an admin token. */
  readToken: string;
  /** The owner's id in Guard's approver directory, and the secret that signs the owner's answers. */
  approverId: string;
  approverSecret: string;
  now(): number;
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
        return { ok: false, credential: false, error: `Guard could not be reached (${(e as Error).name})` };
      }
    },

    async notify(approval, decision) {
      // The signature is over the exact bytes sent; the time is now (the message's own time may be older than Guard's five minutes if the provider redelivered).
      const raw = JSON.stringify({ approval, decision, approver: config.approverId, at_ms: String(config.now()), nonce: randomUUID() });
      const signature = createHmac("sha256", config.approverSecret).update(raw).digest("hex");
      try {
        const response = await fetch(url("/admin/notify"), { method: "POST", body: raw, headers: { "content-type": "application/json", "x-geo-signature": signature }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const text = await response.text().catch(() => "");
        let error = text;
        try { const j = JSON.parse(text) as { error?: unknown }; if (typeof j.error === "string") error = j.error; } catch { /* not JSON */ }
        if (response.status === 200) return { kind: "recorded" };
        if (response.status === 409) {
          if (/expired/iu.test(error)) return { kind: "expired" };
          return { kind: "already", state: /already (\w+)/iu.exec(error)?.[1]?.toLowerCase() ?? "decided" };
        }
        if (response.status === 404) return { kind: "missing" };
        return { kind: "refused", status: response.status, error: error.slice(0, 200) };
      } catch (e) {
        return { kind: "unreachable", error: `Guard could not be reached (${(e as Error).name})` };
      }
    },
  };
}

// ---- the runtime -----------------------------------------------------------------------------------------------------------------------

/** The booking behind a held refund, as the runtime shows it (server/runtime.ts RefundContext). */
export interface RefundContext {
  booking: string;
  customerPhone: string;
  businessName: string;
  timeZone: string;
  ownerLanguage: "en" | "hi" | "ml" | "kn";
  serviceName: string;
  slotMs: number;
  paymentId: string;
  amountPaise: number;
  approval: string;
  expiresAtMs: number | null;
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
          && typeof c.serviceName === "string" && Number.isFinite(c.slotMs) && typeof c.paymentId === "string" && Number.isSafeInteger(c.amountPaise) && typeof c.approval === "string";
        return ok ? { kind: "found", context: c as unknown as RefundContext } : { kind: "error", error: "the runtime's answer was not in the form expected" };
      } catch (e) {
        return { kind: "error", error: `the runtime could not be reached (${(e as Error).name})` };
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
