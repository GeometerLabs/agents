// The events the inbox sends a runtime, checked for shape before anything is saved, and the key that makes a redelivery a no-op. The same for every template:
// a message, a payment event or an approvals answer; a template's agent adds one more event of its own, the tick, which only its own clock makes.
// The inbox has already checked each provider's signature; this only makes sure a malformed body cannot reach the agent.
import type { InboundMessage } from "../messaging/messaging.ts";
import type { PaymentEvent } from "../payments/payments.ts";

/** Ticks come from our own clock, never from outside. */
export type IncomingEvent =
  | { kind: "message"; message: InboundMessage } // a customer's (or the owner's) WhatsApp message
  | { kind: "payment_event"; event: PaymentEvent } // a Razorpay webhook
  // The approvals relay says what the owner decided about a refund Guard is holding. It carries no authority: Guard releases the refund
  // only if its own record says the owner approved, so a forged "approve" makes the agent ask Guard once more and nothing else.
  | { kind: "approval_decision"; approval: string; decision: "approve" | "deny"; id?: string }
  // The panel's to-do list (plan B31) asks the agent to look again or ask again about one booking or fee. It carries no authority either: the agent does it the way it does
  // the same thing every day, through Guard and the same limits. It does not come in through /internal/events (the inbox cannot send one); it has its own endpoint.
  | { kind: "recovery"; id: string; case: string; action: string };

/** What a runtime hands its agent: an incoming event, or time passing. */
export type RuntimeEvent = IncomingEvent | { kind: "tick" };

export const MAX_EVENTS_PER_REQUEST = 100;

/** Message ids, payment event ids and approval ids are different id spaces, so each gets its own prefix. An approval's two answers are two events. */
export function eventKey(event: IncomingEvent): string {
  if (event.kind === "message") return `message:${event.message.id}`;
  // The relay gives every delivery its own `id`, so an earlier event for the same approval (a forged one) cannot shadow the real one as a "repeat".
  // Handling is safe to repeat: the agent looks at the refunds first, and a decision for a hold it no longer has does nothing.
  if (event.kind === "approval_decision") return `approval_decision:${event.approval}:${event.decision}:${event.id ?? ""}`;
  if (event.kind === "recovery") return `recovery:${event.id}`; // the panel gives each request its own id, so pressing a button twice is one request
  return `payment_event:${event.event.id}`;
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/u;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const ACTION_NAME = /^[a-z][a-z0-9_]{1,39}$/u;

/** The body of POST /internal/recover: {"id", "case", "action"}. The action is only a name; the agent decides whether it fits the case and refuses what does not. */
export function checkRecovery(body: unknown): { ok: true; event: Extract<IncomingEvent, { kind: "recovery" }> } | { ok: false; error: string } {
  if (!isObj(body) || typeof body.id !== "string" || !REQUEST_ID.test(body.id) || typeof body.case !== "string" || !CASE_ID.test(body.case) || typeof body.action !== "string" || !ACTION_NAME.test(body.action)) {
    return { ok: false, error: 'Send {"id": up to 64 letters, digits and hyphens, "case": the booking or fee ("b-3"), "action": a name like "recheck_payment"}.' };
  }
  return { ok: true, event: { kind: "recovery", id: body.id, case: body.case, action: body.action } };
}

export type CheckedEvents = { ok: true; events: IncomingEvent[] } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256;
const PAYMENT_EVENTS = ["payment_link.paid", "payment.captured", "refund.processed"];
/** Guard's approval ids look like ap-glow-salon-razorpay-458e...-3: letters, digits and a few separators, never anything a path or a log line could be confused by. */
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u;

/** All or nothing: one bad event refuses the whole request, so the inbox sees the mistake instead of half a batch. */
export function checkEvents(body: unknown): CheckedEvents {
  const list = isObj(body) ? body.events : undefined;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_EVENTS_PER_REQUEST) {
    return { ok: false, error: `Send {"events": [...]} with 1 to ${MAX_EVENTS_PER_REQUEST} events.` };
  }
  const events: IncomingEvent[] = [];
  for (const [i, raw] of list.entries()) {
    const event = checkOne(raw);
    if (typeof event === "string") return { ok: false, error: `Event ${i + 1}: ${event}` };
    events.push(event);
  }
  return { ok: true, events };
}

function checkOne(raw: unknown): IncomingEvent | string {
  if (!isObj(raw)) return "it must be an object with a kind.";
  if (raw.kind === "message") {
    const m = raw.message;
    if (!isObj(m) || !isText(m.id) || !isText(m.from) || typeof m.text !== "string" || typeof m.timestamp !== "number" || !Number.isFinite(m.timestamp)) {
      return "a message needs message.id, message.from, message.text and message.timestamp (epoch milliseconds).";
    }
    // A voice note carries the fact and nothing else: no words, and no audio id or link (the inbox never passes one on). Only the boolean true is accepted.
    if (m.voiceNote !== undefined && m.voiceNote !== true) return "message.voiceNote, if given, must be true (a voice note or audio file).";
    if (m.voiceNote === true && m.text !== "") return "a voice note has no words: send message.text as an empty string.";
    // A tap on a button or a list row: the id we gave that row, and the kind. Nothing else of the interactive payload is passed on.
    let reply: { id: string; kind: "button" | "list" } | undefined;
    if (m.reply !== undefined) {
      const r = m.reply;
      if (!isObj(r) || typeof r.id !== "string" || !/^[A-Za-z0-9:_.-]{1,200}$/u.test(r.id) || (r.kind !== "button" && r.kind !== "list")) return 'message.reply, if given, must be {"id": the id of the button or row, "kind": "button" or "list"}.';
      if (m.voiceNote === true) return "a voice note cannot be a button or list reply.";
      reply = { id: r.id, kind: r.kind };
    }
    return { kind: "message", message: { id: m.id, from: m.from, text: m.text, timestamp: m.timestamp, ...(m.voiceNote === true ? { voiceNote: true as const } : {}), ...(reply ? { reply } : {}) } };
  }
  if (raw.kind === "payment_event") {
    const e = raw.event;
    const p = isObj(e) && isObj(e.payload) ? e.payload : undefined;
    if (!isObj(e) || !p || !isText(e.id) || !PAYMENT_EVENTS.includes(e.event as string) || typeof e.created_at !== "number") {
      return `a payment event needs event.id, event.event (${PAYMENT_EVENTS.join(", ")}), event.created_at and event.payload.`;
    }
    const link = isObj(p.payment_link) ? p.payment_link.id : undefined;
    const payment = isObj(p.payment) ? p.payment : undefined;
    const refund = isObj(p.refund) ? p.refund : undefined;
    // A real payment.captured names the payment and not its link (the agent asks the payments service which link it paid), so its payment id is enough.
    const hasWhatItNeeds = e.event === "refund.processed" ? isText(refund?.id) && isText(refund?.payment_id)
      : e.event === "payment.captured" ? isText(payment?.id) || isText(payment?.link_id) || isText(link)
      : isText(link) || isText(payment?.link_id);
    if (!hasWhatItNeeds) return `a ${e.event} event is missing the ids in its payload that say which payment it is about.`;
    return { kind: "payment_event", event: e as unknown as Extract<IncomingEvent, { kind: "payment_event" }>["event"] };
  }
  if (raw.kind === "approval_decision") {
    // The approvals relay's word for what the owner decided. It carries no authority: Guard releases a held refund only if its own record shows the approval.
    if (typeof raw.approval !== "string" || !APPROVAL_ID.test(raw.approval) || (raw.decision !== "approve" && raw.decision !== "deny")) {
      return 'an approval_decision needs approval (Guard\'s approval id) and decision ("approve" or "deny").';
    }
    if (raw.id !== undefined && (typeof raw.id !== "string" || !/^[A-Za-z0-9-]{1,64}$/u.test(raw.id))) return "an approval_decision's id, if given, is up to 64 letters, digits and hyphens.";
    return { kind: "approval_decision", approval: raw.approval, decision: raw.decision, ...(raw.id !== undefined ? { id: raw.id } : {}) };
  }
  return 'the kind must be "message", "payment_event" or "approval_decision" (a tick is never sent from outside).';
}
