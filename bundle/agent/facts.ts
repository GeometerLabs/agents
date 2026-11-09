// What an agent someone else wrote did, as the two places that are not the agent can tell it: each of its Guards (every call it made, and what Guard decided: allowed, held for
// the owner, refused, and the answer the service gave) and the services themselves (the payment link, the refund, the calendar event as Razorpay and Google hold them).
// Nothing here asks the agent. Run inside the `ops` container, which holds the Guards' admin credentials and is on the network where their agent ports answer; the reads
// of the services go through the Guards with the reading agent (record-<name>), which each Guard allows to look and not to change. fetch is a parameter, so the tests run it against
// the real Guard binary and the stand-ins.
import { personLabel } from "../../modules/record/fingerprint.ts";
import type { AgentUpstream } from "./folder.ts";

export interface GuardAccess { kind: AgentUpstream; adminUrl: string; adminToken: string; agentUrl: string }
export interface FactsConfig {
  /** The builder's own agent, as the Guards know it (`agent-<name>`). Only its calls, and the relay's messages to the owner, are the agent's record; the reading agent's reads are not. */
  agentId: string;
  relayId: string;
  recordToken: string;
  /** The key a reference that looks like a phone number is labelled with (B69, derived from the agent's own; the deployer's fold uses the same one). */
  labelKey: Buffer;
  guards: GuardAccess[];
  calendarId?: string;
}

/** One Guard decision, as `GET /admin/decisions` writes it. Only the fields the record uses are named. */
export interface Decision {
  id: string;
  at_ms: string;
  operation: string;
  outcome: "allow" | "deny" | "hold";
  dispatched: boolean;
  prevented: boolean;
  principal: { workload: string };
  /** Typed values: ["int","20000"], ["str","pay_1"], ["map",{...}]. */
  arguments: Record<string, unknown>;
  call: string;
  approval?: string;
  evaluations: { rule: string; decision: string; reason: string }[];
  reasons: string[];
}
export interface Intent { intent: string; operation: string; call: string; state: string; decision: string; provider_effect?: string; detail: string }
export interface Approval { id: string; operation: string; principal: string; state: string; approver?: string; arguments: Record<string, unknown>; requested_at_ms: string; expires_at_ms: string; decided_at_ms?: string; consumed_by?: string; rule: string }

/** Guard lists at most the 500 most recent decisions, newest first, with no way to ask "since". `windowFull` says the list was cut: older decisions may exist that this pass cannot see. */
export interface GuardFacts { decisions: Decision[]; intents: Intent[]; approvals: Approval[]; counts: Record<string, number>; windowFull: boolean; oldestAtMs?: number; newestAtMs?: number; error?: string }
/** The most decisions Guard lists at once (`GET /admin/decisions?limit=` is capped at 500). */
export const DECISION_WINDOW = 500;
export interface LinkFact { id: string; status: string; amountPaid: number; payments: { paymentId: string; amount: number; createdAt: number }[] }
export interface RefundFact { id: string; amount: number; receipt: string | null; status: string; createdAt: number }
export interface EventFact { id: string; summary: string; start: string | null; status: string }

export interface Facts {
  at: string;
  guards: Partial<Record<AgentUpstream, GuardFacts>>;
  service: {
    /** By the reference_id the agent sent. `null`: the service could not be asked, which is not the same as "there is no such link". */
    links: Record<string, LinkFact | null>;
    /** By payment id. */
    refunds: Record<string, RefundFact[] | null>;
    /** The events the calendar holds around the times the agent booked, or null when it could not be read. */
    events: EventFact[] | null;
    /** An event the agent changed or deleted, asked for by its id: the event, `"gone"` when the calendar has none (or only a cancelled one), `null` when it could not be asked. */
    eventsById: Record<string, EventFact | "gone" | null>;
  };
  /** What could not be read, in words. Nothing secret. */
  problems: string[];
}

const TIMEOUT = 8_000;
const why = (e: unknown): string => (e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? "error";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A reference the builder's agent chose (a receipt, a reference_id) can be anything, a customer's number included. One that looks like a phone number (seven digits in a row, with at
 * most a space, dot, dash or bracket between them: the rule fleet applies) is kept as a keyed fingerprint of itself (B69, under a key derived from the agent's), so no number reaches the record, the exports or a signed report.
 */
const PHONE_SHAPE = /\d(?:[ .\-()]?\d){6,}/u;
export const label = (key: Buffer, v: string | null | undefined): string | null => (typeof v === "string" ? (PHONE_SHAPE.test(v) ? personLabel(key, "b", v) : v) : null);

/** The string inside a typed argument (["str","pay_1"]), or the number inside ["int","20000"]; undefined for anything else. */
export function typedText(v: unknown): string | undefined { return Array.isArray(v) && (v[0] === "str" || v[0] === "int") && typeof v[1] === "string" ? v[1] : undefined; }
export function typedMap(v: unknown): Record<string, unknown> | undefined { return Array.isArray(v) && v[0] === "map" && isObj(v[1]) ? v[1] : undefined; }

/**
 * What the record has already settled, so the services are not asked again (every question asked through a Guard is itself a decision in the 500 it lists, and a record that
 * fills the list with its own reads loses the agent's calls): the decisions whose entry is final, and the references whose deposit is in the record.
 */
export interface Skip { settled: string[]; paid: string[] }

const DAY = 86_400_000;
/** A link nobody has paid after this long is left alone: the record already says it was made. */
const UNPAID_FOR = 36 * 3_600_000;

export async function collectFacts(cfg: FactsConfig, now: Date, fetchFn: typeof fetch = fetch, skip: Skip = { settled: [], paid: [] }): Promise<Facts> {
  const facts: Facts = { at: now.toISOString(), guards: {}, service: { links: {}, refunds: {}, events: null, eventsById: {} }, problems: [] };
  const settled = new Set(skip.settled); const paid = new Set(skip.paid);
  const getJson = async (url: string, token: string): Promise<{ status: number; body: unknown }> => {
    try {
      const r = await fetchFn(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
      const text = await r.text();
      let body: unknown = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body };
    } catch (e) { return { status: 0, body: { error: why(e) } }; }
  };
  const list = (body: unknown, key: string): unknown[] => (isObj(body) && Array.isArray(body[key]) ? body[key] as unknown[] : []);

  for (const g of cfg.guards) {
    const admin = (path: string) => getJson(`${g.adminUrl.replace(/\/+$/u, "")}${path}`, g.adminToken);
    const [decisions, intents, approvals, status] = await Promise.all([admin(`/admin/decisions?limit=${DECISION_WINDOW}`), admin("/admin/intents"), admin("/admin/approvals"), admin("/admin/status")]);
    if (decisions.status !== 200) { facts.problems.push(`${g.kind}'s Guard could not be read (${decisions.status === 0 ? "not reachable" : `HTTP ${decisions.status}`}), so its calls are not in this pass.`); continue; }
    const counts = isObj(status.body) && isObj(status.body.counts) ? Object.fromEntries(Object.entries(status.body.counts).filter(([, v]) => typeof v === "number")) as Record<string, number> : {};
    const all = list(decisions.body, "decisions") as Decision[];
    const times = all.map((d) => Number(d.at_ms)).filter(Number.isFinite);
    facts.guards[g.kind] = {
      decisions: all, intents: list(intents.body, "intents") as Intent[], approvals: list(approvals.body, "approvals") as Approval[], counts, windowFull: all.length >= DECISION_WINDOW,
      ...(times.length > 0 ? { oldestAtMs: Math.min(...times), newestAtMs: Math.max(...times) } : {}),
    };
  }

  const mine = (d: Decision) => d.principal?.workload === cfg.agentId;
  const dispatched = (d: Decision) => d.outcome === "allow" && d.dispatched === true;

  // Razorpay's own record of what the agent made: a link by the reference it was given, and the refunds against a payment
  const rz = cfg.guards.find((g) => g.kind === "razorpay");
  if (rz && facts.guards.razorpay) {
    const base = rz.agentUrl.replace(/\/+$/u, "");
    const refs = new Set<string>(); const payments = new Set<string>();
    for (const d of facts.guards.razorpay.decisions.filter(mine)) {
      if (!dispatched(d)) continue;
      if (d.operation === "create_link") {
        // asked about until the link is in the record AND its deposit is, or until nobody has paid for a day and a half
        const ref = typedText(d.arguments.reference_id);
        if (ref && (!settled.has(d.id) || (!paid.has(label(cfg.labelKey, ref)!) && now.getTime() - Number(d.at_ms) < UNPAID_FOR))) refs.add(ref);
      } else if (d.operation === "refund" && !settled.has(d.id)) {
        const p = typedText(d.arguments.payment_id);
        if (p) payments.add(p);
      }
    }
    for (const ref of [...refs].slice(0, 200)) {
      const found = await getJson(`${base}/v1/payment_links?reference_id=${encodeURIComponent(ref)}`, cfg.recordToken);
      if (found.status !== 200) { facts.service.links[ref] = null; continue; }
      const link = list(found.body, "payment_links").find((l) => isObj(l) && l.reference_id === ref) as Record<string, unknown> | undefined;
      if (!link || typeof link.id !== "string") { facts.service.links[ref] = null; facts.problems.push(`Razorpay shows no payment link with the reference ${ref}.`); continue; }
      const amountPaid = Number(link.amount_paid ?? 0);
      let pays: LinkFact["payments"] = [];
      // the list shows `payments: []` even on a paid link; the single read has them
      if (amountPaid > 0) {
        const one = await getJson(`${base}/v1/payment_links/${encodeURIComponent(link.id)}`, cfg.recordToken);
        if (one.status !== 200) { facts.service.links[ref] = null; continue; }
        pays = list(one.body, "payments").filter(isObj).filter((p) => typeof p.payment_id === "string").map((p) => ({ paymentId: p.payment_id as string, amount: Number(p.amount), createdAt: Number(p.created_at) }));
      }
      facts.service.links[ref] = { id: link.id, status: String(link.status), amountPaid, payments: pays };
    }
    for (const p of [...payments].slice(0, 200)) {
      const r = await getJson(`${base}/v1/payments/${encodeURIComponent(p)}/refunds`, cfg.recordToken);
      facts.service.refunds[p] = r.status === 200 ? list(r.body, "items").filter(isObj).map((i) => ({ id: String(i.id), amount: Number(i.amount), receipt: typeof i.receipt === "string" ? i.receipt : null, status: String(i.status), createdAt: Number(i.created_at) })) : null;
    }
  }

  // Google's own record of the calendar. An event the agent booked is looked for around the times it booked (a calendar with history is far more than one page); an event the
  // agent changed or deleted is asked for by its id.
  const cal = cfg.guards.find((g) => g.kind === "calendar");
  if (cal && facts.guards.calendar && cfg.calendarId) {
    const base = `${cal.agentUrl.replace(/\/+$/u, "")}/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`;
    const open = facts.guards.calendar.decisions.filter((d) => mine(d) && dispatched(d) && !settled.has(d.id));
    const eventOf = (e: Record<string, unknown>): EventFact => ({ id: String(e.id), summary: String(e.summary ?? ""), start: isObj(e.start) && typeof e.start.dateTime === "string" ? e.start.dateTime : null, status: String(e.status ?? "") });
    const starts = open.filter((d) => d.operation === "insert").map((d) => Date.parse(typedText(typedMap(d.arguments.start)?.dateTime) ?? "")).filter(Number.isFinite);
    if (starts.length > 0) {
      const range = `timeMin=${encodeURIComponent(new Date(Math.min(...starts) - DAY).toISOString())}&timeMax=${encodeURIComponent(new Date(Math.max(...starts) + DAY).toISOString())}`;
      const r = await getJson(`${base}?${range}&singleEvents=true&maxResults=250`, cfg.recordToken);
      if (r.status === 200) facts.service.events = list(r.body, "items").filter(isObj).map(eventOf);
      else facts.problems.push("The calendar could not be read, so the events the agent booked are not confirmed in this pass.");
    }
    const changed = open.filter((d) => d.operation === "patch" || d.operation === "delete").map((d) => typedText(d.arguments.eventId)).filter((x): x is string => !!x);
    for (const id of [...new Set(changed)].slice(0, 200)) {
      const r = await getJson(`${base}/${encodeURIComponent(id)}`, cfg.recordToken);
      facts.service.eventsById[id] = r.status === 404 || r.status === 410 ? "gone" : r.status === 200 && isObj(r.body) ? (String(r.body.status) === "cancelled" ? "gone" : eventOf(r.body)) : null;
    }
  }
  return facts;
}
