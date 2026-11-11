// The record of an agent someone else wrote, in the record format the monthly report and the certificates read (modules/record/record.ts). It is built from what the Guards
// and the services say, never from what the agent says:
//   - every call the agent made is a Guard decision: allowed (and the answer the service gave), held for the owner, or refused (and which rule);
//   - "done" is what the service itself holds: a payment link by its reference, a payment by its link, a refund against its payment, an event in the calendar;
//   - "the owner approved" is the approval's state in Guard (decided by the owner's signed answer), not a message anyone sent;
//   - on UPI (the owner-marked desk, B71 part 2) "paid" is the OWNER's mark, from the desk's own list: written as `owner_marked_paid` with `markedBy: "owner"`, the
//     owner's statement, never as a provider's confirmation (`record_deposit`), because nothing but the owner has seen the money (B74).
// A thing the service does not show (yet) is `unconfirmed`, never `confirmed`. It is written only after a short wait, so a service that is a moment behind does not leave a false
// "unconfirmed" in a record that is append-only; when the service shows it later, a confirmed entry for the same thing is added after it (the report marks the earlier one "settled later").
import { canonicalJson } from "../../modules/record/record.ts";
import { keyedDigest, personLabel } from "../../modules/record/fingerprint.ts";
import type { Action, Outcome, RecordEntry, RuleDecision } from "../../modules/record/record.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import { readWindow } from "../../companies/decision-window.ts";
import { label, typedMap, typedText } from "./facts.ts";
import { MARK_ACTIONS } from "../../modules/payments/owner-marked/obligations.ts";
import { providerById } from "../../modules/payments/providers/index.ts";
import type { Approval, Decision, Facts } from "./facts.ts";

export interface RecordState {
  schema: 1;
  /** Append-only. A customer's number is never in it: only a keyed fingerprint of it (B69). */
  entries: RecordEntry[];
  /** What has been written, by the thing it was about (a decision, an approval, a payment) and how it stood. */
  seen: Record<string, { seq: number; outcome: Outcome }>;
  /** The newest decision (its time) read from each Guard so far: what a gap in Guard's list of recent decisions is measured from. */
  marks?: Record<string, number>;
}
export const emptyRecord = (): RecordState => ({ schema: 1, entries: [], seen: {} });

/** How long a thing the service does not show yet is given before it is written down as unconfirmed. */
export const GRACE_MS = 10 * 60_000;

export interface FoldOptions { settings: Settings; agentId: string; relayId: string; now: number; /** The key the labels, the customers' fingerprints and the inputs' digests are made with (B69, derived from the agent's own). */ labelKey: Buffer }
interface Candidate { key: string; atMs: number; entry: Omit<RecordEntry, "seq" | "time"> }

const digits = (s: string) => s.replace(/\D/gu, "");
const answered = (d: Decision): number | undefined => { const m = /the provider answered (\d{3})/u.exec(d.reasons.join(" ")); return m ? Number(m[1]) : undefined; };
const REFUND_RULES = new Set(["refund-at-most-deposit", "refund-paise-per-day", "refunds-per-day", "refund-needs-owner", "refund-once"]);

/** The rule that said no (or hold), in the report's own list of rules when the report has a rule for it: every refund rule is the refund limit. */
function ruleDecisions(d: Decision, verdict: "block" | "hold_for_owner"): RuleDecision[] {
  const hit = d.evaluations.find((e) => e.decision === (verdict === "block" ? "deny" : "hold"));
  return hit && REFUND_RULES.has(hit.rule) ? [{ ruleId: "refund-limit", verdict, reason: `${hit.rule}: ${hit.reason}`.slice(0, 300) }] : [];
}

function candidates(facts: Facts, o: FoldOptions): Candidate[] {
  const out: Candidate[] = [];
  const language = o.settings.languages[0];
  const ownerDigits = digits(o.settings.owner.whatsapp);
  const mk = (key: string, atMs: number, e: { conversation: string; booking: string | null; action: Action | string; inputs: unknown; outcome: Outcome; decisions?: RuleDecision[]; language?: Settings["languages"][number]; notes?: string; refs?: Record<string, string> }) => {
    out.push({ key, atMs, entry: { conversation: e.conversation, booking: e.booking, action: e.action as Action, inputsDigest: keyedDigest(o.labelKey, canonicalJson(e.inputs)), outcome: e.outcome, decisions: e.decisions ?? [], language: e.language ?? language, notes: e.notes ?? "", refs: e.refs ?? {} } });
  };
  const lab = (v: string | null | undefined) => label(o.labelKey, v);
  const failedOrNot = (d: Decision, confirmed: boolean): Outcome => { const s = answered(d); return s !== undefined && (s < 200 || s >= 300) ? "failed" : confirmed ? "confirmed" : "unconfirmed"; };
  const refused = (d: Decision, action: string, booking: string | null, conversation = "agent", decisions: RuleDecision[] = []) =>
    mk(d.id, Number(d.at_ms), { conversation, booking, action, inputs: { call: d.call }, outcome: "blocked", decisions, notes: `Guard refused it: ${d.reasons[0] ?? ""}`.slice(0, 300) });

  // ---- Razorpay
  const rz = facts.guards.razorpay;
  if (rz) {
    for (const d of rz.decisions.filter((x) => x.principal?.workload === o.agentId)) {
      const at = Number(d.at_ms);
      if (d.operation === "create_link") {
        const ref = typedText(d.arguments.reference_id) ?? null;
        if (d.outcome === "deny") { refused(d, "create_deposit_link", lab(ref)); continue; }
        if (d.outcome !== "allow" || !d.dispatched) continue;
        const link = ref ? facts.service.links[ref] : undefined;
        mk(d.id, at, { conversation: "agent", booking: lab(ref), action: "create_deposit_link", inputs: { call: d.call }, outcome: failedOrNot(d, !!link), refs: { ...(link ? { linkId: link.id } : {}), ...(ref ? { referenceId: lab(ref)! } : {}) } });
      } else if (d.operation === "refund") {
        const paymentId = typedText(d.arguments.payment_id) ?? "";
        const amount = typedText(d.arguments.amount) ?? "";
        const receipt = typedText(d.arguments.receipt);
        const booking = lab(receipt ?? (paymentId || null));
        if (d.outcome === "deny") { refused(d, "refund", booking, "agent", ruleDecisions(d, "block")); continue; }
        if (d.outcome === "hold") {
          // a call held again while it waits is the same hold: one entry for each approval
          mk(`hold:${d.approval ?? d.id}`, at, { conversation: "agent", booking, action: "refund", inputs: { call: d.call }, outcome: "held_for_owner", decisions: ruleDecisions(d, "hold_for_owner"), refs: { paymentId, amountPaise: amount, ...(d.approval ? { approval: d.approval } : {}) } });
          continue;
        }
        if (!d.dispatched) continue;
        const shown = facts.service.refunds[paymentId];
        const refund = Array.isArray(shown) ? shown.find((r) => String(r.amount) === amount && (receipt === undefined || r.receipt === receipt)) : undefined;
        mk(d.id, at, { conversation: "agent", booking, action: "refund", inputs: { call: d.call }, outcome: failedOrNot(d, !!refund), refs: { paymentId, amountPaise: amount, ...(refund ? { refundId: refund.id } : {}), ...(d.approval ? { approval: d.approval } : {}) } });
      } else if (d.outcome === "deny") {
        refused(d, d.operation, null); // a payout, a route that is not listed: a thing it tried and could not do
      }
    }
    // the deposit: a payment on a link the agent made, as Razorpay shows it
    for (const [ref, link] of Object.entries(facts.service.links)) {
      for (const p of link?.payments ?? []) mk(`deposit:${p.paymentId}`, p.createdAt * 1000, { conversation: "customer", booking: lab(ref), action: "record_deposit", inputs: { link: link!.id, payment: p.paymentId }, outcome: "confirmed", refs: { paymentId: p.paymentId, linkId: link!.id, amountPaise: String(p.amount) } });
    }
    // the owner's answer, as Guard holds it: signed by the owner's approver, not a message that says so
    for (const a of rz.approvals as Approval[]) {
      if (!a.approver || !["approved", "consumed", "denied"].includes(a.state) || !a.decided_at_ms) continue;
      const args = a.arguments ?? {};
      const booking = lab(typedText(args.receipt) ?? typedText(args.payment_id) ?? null);
      mk(`approval:${a.id}`, Number(a.decided_at_ms), { conversation: "owner", booking, action: "owner_decision", inputs: { approval: a.id, state: a.state }, outcome: "confirmed", language: o.settings.owner.language, refs: { command: a.state === "denied" ? "deny" : "approve", approval: a.id } });
    }
  }

  // ---- the owner-marked desk (UPI, B71 part 2): the agent's calls are its desk Guard's decisions; what the owner marked is the desk's own lists. The entries use the
  // names a template's UPI entries use (MARK_ACTIONS), so the unfinished-work list, the papers and the report read them the same way.
  const deskKind = Object.keys(facts.guards).find((k) => providerById(k)?.ownerMarked !== undefined);
  const dk = deskKind ? facts.guards[deskKind] : undefined;
  if (dk) {
    const requests = facts.service.desk?.requests ?? [];
    const refunds = facts.service.desk?.refunds ?? [];
    const requestOf = (id: string | undefined) => (id ? requests.find((r) => r.id === id) : undefined);
    // who each request is for, from the agent's own calls: a keyed fingerprint of the customer's number, never the number
    const customerOf = new Map<string, string>();
    for (const d of dk.decisions.filter((x) => x.principal?.workload === o.agentId && x.operation === "create_link")) {
      const customer = typedText(d.arguments.customer); const ref = typedText(d.arguments.reference); const amount = typedText(d.arguments.amount_paise);
      const r = requests.find((x) => x.reference === ref && String(x.amount_paise) === amount);
      if (r && customer) customerOf.set(r.id, personLabel(o.labelKey, "c", customer));
    }
    for (const d of dk.decisions.filter((x) => x.principal?.workload === o.agentId)) {
      const at = Number(d.at_ms);
      if (d.operation === "create_link") {
        const ref = typedText(d.arguments.reference) ?? null; const amount = typedText(d.arguments.amount_paise) ?? "";
        const customer = typedText(d.arguments.customer);
        const conversation = customer ? personLabel(o.labelKey, "c", customer) : "agent";
        if (d.outcome === "deny") { refused(d, MARK_ACTIONS.request, lab(ref), conversation); continue; }
        if (d.outcome !== "allow" || !d.dispatched) continue;
        const r = requests.find((x) => x.reference === ref && String(x.amount_paise) === amount);
        mk(d.id, at, { conversation, booking: lab(ref), action: MARK_ACTIONS.request, inputs: { call: d.call }, outcome: failedOrNot(d, !!r), refs: { ...(r ? { requestId: r.id } : {}), ...(ref ? { reference: lab(ref)! } : {}), amountPaise: amount } });
      } else if (d.operation === "claim" || d.operation === "cancel_link") {
        const id = typedText(d.arguments.id); const r = requestOf(id);
        const action = d.operation === "claim" ? MARK_ACTIONS.claim : MARK_ACTIONS.closed;
        if (d.outcome === "deny") { refused(d, action, lab(r?.reference ?? null)); continue; }
        if (d.outcome !== "allow" || !d.dispatched) continue;
        // a claim marks nothing paid: the customer said so, and the owner is asked to look
        mk(d.id, at, { conversation: (id && customerOf.get(id)) ?? "customer", booking: lab(r?.reference ?? null), action, inputs: { call: d.call }, outcome: failedOrNot(d, !!r), refs: { ...(id ? { requestId: id } : {}), ...(d.operation === "claim" ? { via: typedText(d.arguments.via) ?? "words" } : {}) } });
      } else if (d.operation === "refund") {
        const paymentId = typedText(d.arguments.payment_id) ?? ""; const amount = typedText(d.arguments.amount_paise) ?? "";
        const owner = requests.find((r) => r.payments.some((p) => p.id === paymentId));
        const booking = lab(owner?.reference ?? null);
        if (d.outcome === "deny") { refused(d, MARK_ACTIONS.refundOwed, booking, "agent", ruleDecisions(d, "block")); continue; }
        if (d.outcome !== "allow" || !d.dispatched) continue;
        const owed = refunds.find((r) => r.payment_id === paymentId && String(r.amount_paise) === amount && Math.abs(r.owed_at_ms - at) < GRACE_MS);
        // owed back by the owner, who sends it from their own UPI app: the agent never sends money
        mk(d.id, at, { conversation: "agent", booking, action: MARK_ACTIONS.refundOwed, inputs: { call: d.call }, outcome: owed ? "held_for_owner" : failedOrNot(d, false), refs: { ...(owed ? { refundId: owed.id } : {}), paymentId, amountPaise: amount } });
      } else if (d.outcome === "deny") {
        refused(d, d.operation, null);
      }
    }
    // the owner's marks: what the owner says came in, from the owner's own number with a one-use code. The owner's statement, never a provider's confirmation.
    for (const r of requests) {
      for (const p of r.payments ?? []) {
        mk(`mark:${p.id}`, p.marked_at_ms, {
          conversation: "owner", booking: lab(r.reference), action: MARK_ACTIONS.marked, inputs: { request: r.id, payment: p.id }, outcome: "confirmed", language: o.settings.owner.language,
          refs: { paymentId: p.id, requestId: r.id, amountPaise: String(p.amount_paise), markedBy: "owner" },
          notes: p.after_close ? "marked received by the owner after the request was closed: kept apart, it pays nothing open" : "marked paid by owner: the owner's statement from their own number, not a payment service's record",
        });
      }
    }
    // a refund the owner owed and marked sent (or kept for something given another way)
    for (const f of refunds) {
      if ((f.state !== "done" && f.state !== "kept") || f.settled_at_ms === undefined) continue;
      mk(`refund-marked:${f.id}`, f.settled_at_ms, { conversation: "owner", booking: lab(f.reference), action: f.state === "kept" ? MARK_ACTIONS.refundKept : MARK_ACTIONS.refundDone, inputs: { refund: f.id }, outcome: "confirmed", language: o.settings.owner.language, refs: { refundId: f.id, paymentId: f.payment_id, amountPaise: String(f.amount_paise) }, notes: "the owner marked it, from their own number: the owner's statement" });
    }
  }

  // ---- the calendar: an event is booked when the calendar shows it
  const cal = facts.guards.calendar;
  if (cal) {
    const events = facts.service.events;
    const used = new Set<string>();
    for (const d of cal.decisions.filter((x) => x.principal?.workload === o.agentId).sort((a, b) => Number(a.at_ms) - Number(b.at_ms))) {
      const at = Number(d.at_ms);
      const eventId = typedText(d.arguments.eventId);
      if (d.operation === "insert") {
        if (d.outcome === "deny") { refused(d, "confirm_booking", null); continue; }
        if (d.outcome !== "allow" || !d.dispatched) continue;
        const summary = typedText(d.arguments.summary); const start = typedText(typedMap(d.arguments.start)?.dateTime);
        const event = events?.find((e) => !used.has(e.id) && e.summary === summary && e.start !== null && start !== undefined && Date.parse(e.start) === Date.parse(start));
        if (event) used.add(event.id);
        mk(d.id, at, { conversation: "agent", booking: event?.id ?? null, action: "confirm_booking", inputs: { call: d.call }, outcome: failedOrNot(d, !!event), refs: event ? { eventId: event.id } : {} });
      } else if (d.operation === "patch" && eventId) {
        if (d.outcome === "deny") { refused(d, "reschedule_booking", eventId); continue; }
        if (d.outcome !== "allow" || !d.dispatched) continue;
        const start = typedText(typedMap(d.arguments.start)?.dateTime);
        const there = facts.service.eventsById?.[eventId];
        const event = there && there !== "gone" && (start === undefined || (there.start !== null && Date.parse(there.start) === Date.parse(start))) ? there : undefined;
        mk(d.id, at, { conversation: "agent", booking: eventId, action: "reschedule_booking", inputs: { call: d.call }, outcome: failedOrNot(d, !!event), refs: { eventId } });
      } else if (d.operation === "delete" && eventId) {
        if (d.outcome === "deny") { refused(d, "cancel_booking", eventId); continue; }
        if (d.outcome !== "allow" || !d.dispatched) continue;
        const gone = facts.service.eventsById?.[eventId] === "gone";
        mk(d.id, at, { conversation: "agent", booking: eventId, action: "cancel_booking", inputs: { call: d.call }, outcome: failedOrNot(d, gone), refs: { eventId } });
      } else if (d.outcome === "deny") {
        refused(d, d.operation, eventId ?? null);
      }
    }
  }

  // ---- WhatsApp: a message the agent sent, or the approvals relay sent to the owner. WhatsApp offers no way to read a sent message back, so what Guard recorded is what there is:
  // the service accepted it (it answered 2xx).
  const wa = facts.guards.whatsapp;
  if (wa) {
    for (const d of wa.decisions.filter((x) => x.principal?.workload === o.agentId || x.principal?.workload === o.relayId)) {
      if (d.operation !== "send") { if (d.outcome === "deny") refused(d, d.operation, null); continue; }
      const to = typedText(d.arguments.to) ?? "";
      const toOwner = digits(to) === ownerDigits;
      const fromRelay = d.principal.workload === o.relayId;
      const conversation = toOwner ? "owner" : personLabel(o.labelKey, "c", to);
      if (d.outcome === "deny") { refused(d, "send_message", null, conversation); continue; }
      if (d.outcome !== "allow" || !d.dispatched) continue;
      mk(d.id, Number(d.at_ms), { conversation, booking: null, action: "send_message", inputs: { call: d.call }, outcome: failedOrNot(d, true), language: fromRelay || toOwner ? o.settings.owner.language : language, refs: { to: toOwner ? "owner" : "customer" } });
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs || (a.key < b.key ? -1 : 1));
}

/** One pass: what Guards and services say now, added to the record. Returns the new state and only the entries it added. */
export function foldFacts(prev: RecordState, facts: Facts, o: FoldOptions): { state: RecordState; added: RecordEntry[]; /** Calls that fell out of a Guard's list before they were read, in words. Empty when the record is whole. */ gaps: string[] } {
  const state: RecordState = { schema: 1, entries: [...prev.entries], seen: { ...prev.seen } };
  const added: RecordEntry[] = [];
  const append = (key: string, c: Candidate) => {
    const entry: RecordEntry = Object.freeze({ seq: state.entries.length + 1, time: new Date(c.atMs).toISOString(), ...c.entry, decisions: Object.freeze([...c.entry.decisions]), refs: Object.freeze({ ...c.entry.refs }) });
    state.entries.push(entry); added.push(entry);
    state.seen[key] = { seq: entry.seq, outcome: entry.outcome };
  };
  // Guard lists only its 500 most recent decisions. If the oldest it shows is newer than the newest this record had already read, calls fell out of the list unread: say so in the
  // record (an entry the report lists as left unconfirmed) and in what is returned, rather than looking complete.
  const gaps: string[] = [];
  const found: Candidate[] = [];
  state.marks = { ...prev.marks };
  for (const [kind, g] of Object.entries(facts.guards)) {
    if (!g) continue;
    const r = readWindow(prev.marks?.[kind], { count: g.decisions.length, full: g.windowFull, ...(g.oldestAtMs !== undefined ? { oldestAtMs: g.oldestAtMs } : {}), ...(g.newestAtMs !== undefined ? { newestAtMs: g.newestAtMs } : {}) }, `${kind}'s Guard`);
    if (r.gap) {
      gaps.push(r.gap.message);
      found.push({ key: `gap:${kind}:${r.gap.toMs}`, atMs: r.gap.toMs, entry: { conversation: "agent", booking: null, action: "record_gap" as Action, inputsDigest: keyedDigest(o.labelKey, canonicalJson({ kind, from: r.gap.fromMs, to: r.gap.toMs })), outcome: "unconfirmed", decisions: [], language: o.settings.languages[0], notes: r.gap.message.slice(0, 300), refs: {} } });
    }
    if (r.mark !== undefined) state.marks[kind] = r.mark;
  }
  for (const c of [...candidates(facts, o), ...found].sort((a, b) => a.atMs - b.atMs || (a.key < b.key ? -1 : 1))) {
    const was = state.seen[c.key];
    if (!was) {
      // not shown by the service yet: give it a little time before writing "unconfirmed" into a record that is only ever added to (a gap is already a fact)
      if (c.entry.outcome === "unconfirmed" && !c.key.startsWith("gap:") && o.now - c.atMs < GRACE_MS) continue;
      append(c.key, c);
    } else if ((was.outcome === "unconfirmed" || was.outcome === "attempted") && c.entry.outcome === "confirmed" && !state.seen[`${c.key}#confirmed`]) {
      append(`${c.key}#confirmed`, c);
    }
  }
  return { state, added, gaps };
}

/**
 * The bookings file the monthly report reads for "waiting for the owner right now": one entry for each refund Guard is holding that has not run out. (The report reads only
 * whether an entry has something pending; the rest is a booking's shape, kept minimal and free of any customer's details.)
 */
export function waitingForOwner(facts: Facts, now: number): unknown[] {
  return (facts.guards.razorpay?.approvals ?? []).filter((a) => a.state === "pending" && Number(a.expires_at_ms) > now).map((a) => ({
    id: a.id, customer: "agent", language: "en", state: "confirmed", dateNeedsConfirmation: false, timeInferred: false, handledPayments: [], reminders: [],
    pending: [{ kind: "guard_hold", approval: a.id, paymentId: typedText(a.arguments?.payment_id) ?? "", amountInr: Number(typedText(a.arguments?.amount) ?? 0) / 100, receipt: typedText(a.arguments?.receipt) ?? "", expiresAtMs: Number(a.expires_at_ms), heldAtMs: Number(a.requested_at_ms) }],
  }));
}
