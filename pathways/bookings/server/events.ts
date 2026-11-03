// The events the inbox sends us, checked for shape before anything is saved, and the key that makes a redelivery a no-op.
// The inbox has already checked each provider's signature; this only makes sure a malformed body cannot reach the agent.
import type { AgentEvent } from "../src/agent.ts";

/** Ticks come from our own clock, never from outside. */
export type IncomingEvent = Exclude<AgentEvent, { kind: "tick" }>;

export const MAX_EVENTS_PER_REQUEST = 100;

/** Message ids and payment event ids are different id spaces, so each gets its own prefix. */
export function eventKey(event: IncomingEvent): string {
  return event.kind === "message" ? `message:${event.message.id}` : `payment_event:${event.event.id}`;
}

export type CheckedEvents = { ok: true; events: IncomingEvent[] } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256;
const PAYMENT_EVENTS = ["payment_link.paid", "payment.captured", "refund.processed"];

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
    return { kind: "message", message: { id: m.id, from: m.from, text: m.text, timestamp: m.timestamp } };
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
  return 'the kind must be "message" or "payment_event" (a tick is never sent from outside).';
}
