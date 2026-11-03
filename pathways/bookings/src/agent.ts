// The Bookings agent: handle(event) processes ONE inbound message, ONE payment event, or ONE tick of the clock, and
// returns. Each call is a separate step, so the engine can later drive the agent one task at a time.
//
// How it stays honest (the design rules in the implementation plan):
//  - Every write to a service is followed by a READ from that service's own store. Only the read-back is "confirmed".
//    A reply that says "ok" proves nothing (the calendar that saves nothing, the reply that never comes).
//  - After a lost reply it LOOKS before it retries (by booking id), so a retry cannot create a second event or link.
//  - Payments are reconciled from the payments service's record, not from the event that announced them, so a late,
//    duplicated or missing event cannot change what the agent believes.
//  - Every customer message is one of the templates, checked against the record before it is sent, and "booked" goes
//    out only when the record holds both the calendar confirmation and the deposit.
import { checkConfirmOnlyWhenRecorded, checkMessageMatchesRecord, checkNoDoubleBooking, checkNoMessageAfterStop, checkOneDepositPerBooking, checkOptOut, checkPriceAtOrAboveList, checkRefundLimit, checkWithinHours, strictest } from "./limits.ts";
import type { Decision } from "./limits.ts";
import { factsFor, latestBooking, moveTo, newDraft, register, reminderSchedule } from "./booking.ts";
import type { Booking, Pending, RefundIssueKind, Store } from "./booking.ts";
import { RELAY_CODE_REPLY } from "./approval-code.ts";
import { ApiError, ConflictError, GuardConflictError, GuardError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardUnavailableError, NotSentError, TimeoutError, mayHaveHappened } from "./adapters/faults.ts";
import type { Calendar, CalendarEvent } from "./adapters/calendar.ts";
import type { InboundMessage, Messaging } from "./adapters/messaging.ts";
import { coerceIntent } from "./adapters/model.ts";
import type { Intent, IntentParser } from "./adapters/model.ts";
import type { PaymentEvent, PaymentLink, Payments } from "./adapters/payments.ts";
import type { Clock } from "./clock.ts";
import { resolveDate, resolveTime } from "./language/dates.ts";
import { templateMessage } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "./language/templates.ts";
import type { TemplateId } from "./language/templates.ts";
import type { Action, ActionRecord, Outcome } from "./record.ts";
import { formatInr } from "./language/format.ts";
import { hoursOn, serviceName } from "./settings.ts";
import type { Language, Settings } from "./settings.ts";
import { HOUR, MINUTE, localParts, weekdayOf, zonedToMs } from "./time.ts";

export interface AgentDeps {
  settings: Settings;
  clock: Clock;
  calendar: Calendar;
  payments: Payments;
  messaging: Messaging;
  parser: IntentParser;
  record: ActionRecord;
  store: Store;
}

export type AgentEvent =
  | { kind: "message"; message: InboundMessage } // a customer's (or the owner's) WhatsApp message
  | { kind: "payment_event"; event: PaymentEvent } // a Razorpay webhook
  // The approvals relay says what the owner decided about a refund Guard is holding. It carries no authority: Guard releases the refund
  // only if its own record says the owner approved, so a forged "approve" makes the agent ask Guard once more and nothing else.
  | { kind: "approval_decision"; approval: string; decision: "approve" | "deny"; id?: string }
  | { kind: "tick" }; // time has passed: let holds expire and send due reminders

export interface Agent { handle(event: AgentEvent): Promise<void> }

const ATTEMPTS = 2; // look, try, read back; and once more if that did not settle it
/** After a refund could not be sent at all, or an approved one could not be sent again: minutes before each next try, then the builder is told. */
const RETRY_MINUTES = [1, 2, 5, 15, 30, 60];

export function createAgent(deps: AgentDeps): Agent {
  const { settings, clock, calendar, payments, messaging, parser, record, store } = deps;
  const tz = settings.timezone;
  const owner = settings.owner.whatsapp;
  const parseContext = { services: settings.services, languages: settings.languages };
  const depositPaise = settings.deposit.amountInr * 100;

  const serviceOf = (b: Booking) => settings.services.find((s) => s.id === b.serviceId);
  const customerOf = (phone: string) => {
    let c = store.customers.get(phone);
    if (!c) { c = { phone, optedOut: false }; store.customers.set(phone, c); }
    return c;
  };
  const languageOf = (phone: string, b?: Booking | null) => b?.language ?? store.customers.get(phone)?.language ?? settings.languages[0];

  function log(b: Booking | null, phone: string, action: Action, outcome: Outcome, inputs: unknown, more: { decisions?: Decision[]; notes?: string; refs?: Record<string, string>; language?: Language } = {}) {
    return record.append({ conversation: phone, booking: b?.id || null, action, inputs, outcome, language: languageOf(phone, b), ...more });
  }

  // ---- saying things -------------------------------------------------------------------------------------------

  /**
   * The one way a message leaves the agent. It renders the templates from the record, runs the limits on the final text,
   * sends only if none blocks, and reads the message back from the messaging service. Returns whether it went out.
   * `shown` are decisions worth recording alongside the message (for example "price floor held") that do not gate it.
   */
  async function say(a: { booking: Booking | null; phone: string; to: "customer" | "owner"; templates: TemplateId[]; refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean; action?: Action }): Promise<boolean> {
    const toCustomer = a.to === "customer";
    const action = a.action ?? "send_message"; // the record's name for this message: a reply to a voice note is its own action
    const toNumber = toCustomer ? a.phone : owner;
    const language = toCustomer ? languageOf(a.phone, a.booking) : settings.owner.language;
    const facts = factsFor(settings, a.booking, language, { customerPhone: a.phone, refundInr: a.refundInr, slotMs: a.slotMs, menu: a.templates.includes("menu") });
    const inputs = { to: a.to, templates: a.templates, refundInr: a.refundInr, slotMs: a.slotMs };
    let text: string;
    try {
      text = a.templates.map((id) => render(id, facts)).join(" ");
    } catch (e) {
      log(a.booking, a.phone, action, "blocked", inputs, { notes: (e as Error).message, decisions: a.shown, refs: { to: a.to }, language });
      return false;
    }

    const optedOut = customerOf(a.phone).optedOut;
    const gates: Decision[] = [
      checkOptOut({ toCustomer, customerOptedOut: optedOut }),
      checkMessageMatchesRecord({ text, facts }),
    ];
    if (toCustomer && a.reminder) gates.push(checkNoMessageAfterStop({ isReminder: true, bookingConfirmed: a.booking?.state === "confirmed", customerOptedOut: optedOut }));
    if (a.booking && a.templates.includes("booked")) gates.push(checkConfirmOnlyWhenRecorded({ record, booking: a.booking.id }));
    const decisions = [...(a.shown ?? []), ...gates];
    const worst = strictest(gates);
    if (worst.verdict !== "allow") {
      log(a.booking, a.phone, action, "blocked", inputs, { decisions, notes: worst.reason, refs: { to: a.to }, language });
      if (toCustomer && worst.ruleId === "message-matches-record") await say({ booking: a.booking, phone: a.phone, to: "owner", templates: ["owner_message_held"] });
      return false;
    }

    try {
      const sent = (await messaging.isWindowOpen(toNumber))
        ? await messaging.sendText(toNumber, text)
        : await messaging.sendTemplate(toNumber, templateMessage({ ids: a.templates, language, facts, text, generic: !toCustomer ? TEMPLATE_NAMES.owner : a.reminder ? TEMPLATE_NAMES.reminder : TEMPLATE_NAMES.customer }));
      const seen = await messaging.getMessage(sent.id); // read back from the provider's own outbox
      log(a.booking, a.phone, action, seen ? "confirmed" : "unconfirmed", inputs, { decisions, refs: { messageId: sent.id, templates: a.templates.join("+"), to: a.to }, language });
      return seen !== null;
    } catch (e) {
      // a lost reply may still have gone out; it is not sent again, because there is no way to look it up
      log(a.booking, a.phone, action, mayHaveHappened(e) ? "unconfirmed" : "failed", inputs, { decisions, notes: (e as Error).message, refs: { to: a.to }, language });
      return false;
    }
  }

  const tellCustomer = (b: Booking | null, phone: string, templates: TemplateId[], more: { refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean; action?: Action } = {}) =>
    say({ booking: b, phone, to: "customer", templates, ...more });
  const tellOwner = (b: Booking | null, phone: string, template: TemplateId, more: { refundInr?: number; slotMs?: number } = {}) =>
    say({ booking: b, phone, to: "owner", templates: [template], ...more });

  // ---- the calendar: look first, write, read back ------------------------------------------------------------------

  interface Wanted { start: number; end: number; status: "tentative" | "confirmed" }

  /** Make the calendar show this booking's event as wanted. Returns the event only if the calendar's own list shows it. */
  async function ensureEvent(b: Booking, want: Wanted): Promise<{ event: CalendarEvent | null; error?: string; conflict?: boolean }> {
    const matches = (e: CalendarEvent) => e.start === want.start && e.end === want.end && e.status === want.status;
    const holdExpiresAt = want.status === "tentative" ? b.holdExpiresAt : undefined;
    let error: string | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const before = await calendar.list({ bookingRef: b.id }); // look first: an earlier try (a lost reply) may have landed
        const found = before.find(matches);
        if (found) return { event: found };
        if (before[0]) await calendar.update(before[0].id, { start: want.start, end: want.end, status: want.status, holdExpiresAt });
        else await calendar.insert({ summary: `${serviceOf(b)?.id ?? "booking"} · ${b.customer}`, start: want.start, end: want.end, status: want.status, bookingRef: b.id, holdExpiresAt });
        const after = (await calendar.list({ bookingRef: b.id })).find(matches); // read back from the calendar's own list
        if (after) return { event: after };
      } catch (e) {
        if (e instanceof ConflictError) return { event: null, error: e.message, conflict: true };
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
        error = (e as Error).message;
      }
    }
    const last = await calendar.list({ bookingRef: b.id }).then((l) => l.find(matches)).catch(() => undefined); // the last write may have landed too
    return last ? { event: last } : { event: null, error };
  }

  /** Delete every event this booking has, and check the calendar agrees. */
  async function removeEvents(b: Booking): Promise<boolean> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const events = await calendar.list({ bookingRef: b.id });
        if (events.length === 0) return true;
        for (const e of events) await calendar.delete(e.id).catch(() => undefined);
      } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
      }
    }
    return calendar.list({ bookingRef: b.id }).then((l) => l.length === 0).catch(() => false);
  }

  async function releaseSlot(b: Booking, why: string): Promise<void> {
    const gone = await removeEvents(b).catch(() => false);
    log(b, b.customer, "release_slot", gone ? "confirmed" : "unconfirmed", { eventId: b.eventId }, { notes: why });
    if (gone) { b.eventId = undefined; b.holdExpiresAt = undefined; }
  }

  // ---- payments: look first, write, read back ----------------------------------------------------------------------

  async function ensureLink(b: Booking): Promise<{ link: PaymentLink | null; error?: string }> {
    const live = (links: PaymentLink[]) => links.find((l) => l.status !== "cancelled" && l.amount === depositPaise);
    let error: string | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const existing = live(await payments.listPaymentLinks({ reference_id: b.id })); // look first: a lost reply may have created it
        if (existing) return { link: existing };
        await payments.createPaymentLink({ amount: depositPaise, reference_id: b.id, description: `${settings.name} deposit` });
        const after = live(await payments.listPaymentLinks({ reference_id: b.id })); // read back from the payments service's own list
        if (after) return { link: after };
      } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
        error = (e as Error).message;
      }
    }
    const last = await payments.listPaymentLinks({ reference_id: b.id }).then(live).catch(() => undefined);
    return last ? { link: last } : { link: null, error };
  }

  // ---- refunds: look first, send once, never send again what may have gone out ------------------------------------------------
  //
  // A refund above the owner's limit is not decided here. The agent sends it like any other; Guard holds it (HTTP 202) and the approvals
  // relay asks the owner, once, with a code. The agent keeps the approval id and the exact bytes of the held call, and sends those same
  // bytes again only when the relay says the owner approved: Guard releases a call only if it is the identical call, and `60000` is not
  // `"60000"`. Between the hold and the answer the agent does nothing: no timer sends a held refund again.
  //
  // Whatever Guard or the service answered, a refund that may have gone out is never sent again: Guard's own record makes the second one a
  // new hold, which would ask the owner about money already paid.

  type RefundResult = "done" | "held" | "retry" | "stopped";

  const issuesOf = (b: Booking) => (b.refundIssues ??= []);
  const stoppedOf = (b: Booking) => (b.stoppedRefunds ??= []);
  /** The builder must look at this refund, not the owner. It is in the record (the entry's notes) and counted in the runtime's status. */
  function raise(b: Booking, paymentId: string, kind: RefundIssueKind, note: string): void {
    issuesOf(b).push({ paymentId, kind, note, atMs: clock.now() });
    if (kind !== "unheld") stoppedOf(b).push(paymentId); // asking Guard again could only ask the owner about the same money again
  }

  type Sorted =
    | { is: "held"; error: GuardHeldError }
    | { is: "may_have_happened"; why: string } // look once, never send again
    | { is: "refused"; error: GuardRefusedError }
    | { is: "no_good"; why: string } // Guard said no and trying again will not change it
    | { is: "lost"; why: string } // no reply: the next look says whether it landed
    | { is: "not_sent"; why: string }; // nothing went out: Guard could not decide or reach the service, or the service refused this call

  /** What an error from a refund call means for the refund. Anything that is not one of the service errors is the agent's own bug, and is thrown. */
  function sortRefundError(e: unknown): Sorted {
    if (e instanceof GuardHeldError) return { is: "held", error: e };
    if (e instanceof GuardOutcomeUnknownError) return { is: "may_have_happened", why: "Guard says the outcome is unknown" };
    if (e instanceof GuardRefusedError) return { is: "refused", error: e };
    if (e instanceof GuardUnavailableError) return { is: "not_sent", why: e.message };
    if (e instanceof GuardConflictError || e instanceof GuardError) return { is: "no_good", why: e.message };
    if (e instanceof NotSentError) return { is: "not_sent", why: e.message };
    if (e instanceof TimeoutError) return { is: "lost", why: e.message };
    // the service's own answer, as it came through Guard: a 5xx may have happened (Guard will not repeat it either); a 4xx did not
    if (e instanceof ApiError) return e.status >= 500 ? { is: "may_have_happened", why: `the payments service answered ${e.status}` } : { is: "not_sent", why: e.message };
    throw e;
  }

  const findRefund = async (paymentId: string, receipt: string) => (await payments.listRefunds(paymentId)).find((r) => r.receipt === receipt);

  /**
   * Ask for a refund of a deposit payment, once. `expectHold`: the amount is above the owner's limit, so Guard should hold it.
   * "done": the payments service's own list shows the refund. "held": Guard is holding it for the owner. "retry": nothing went out, it will
   * be tried again by itself. "stopped": the builder has been told, and nothing more is done for this payment.
   */
  async function requestRefund(b: Booking, paymentId: string, amountInr: number, decisions: Decision[], expectHold: boolean): Promise<RefundResult> {
    const receipt = `${b.id}:${paymentId}`; // the booking id travels in the receipt: the relay finds the booking from it
    const amountPaise = amountInr * 100;
    const refs = { paymentId, amountPaise: String(amountPaise) };
    if (stoppedOf(b).includes(paymentId)) {
      log(b, b.customer, "refund", "blocked", { paymentId, amountInr }, { refs, notes: "an earlier try at this refund ended with a no, an unclear outcome, or a failure, so Guard is not asked again" });
      return "stopped";
    }
    log(b, b.customer, "refund", "attempted", { paymentId, amountInr }, { decisions, refs });

    /** The refund may have gone out and cannot be sent again: read the payments service's own list once, and stop. */
    async function maybeDone(why: string): Promise<RefundResult> {
      const found = await findRefund(paymentId, receipt).catch(() => undefined);
      if (found) { log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId: found.id }, notes: `${why}; the payments service's own list shows the refund, and it is not sent again` }); return "done"; }
      const note = `${why}. The refund may or may not have been made. It was NOT sent again. Check Razorpay for payment ${paymentId}; if Guard holds it as uncertain, tell Guard what happened (POST /admin/intents/resolve).`;
      log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: note });
      raise(b, paymentId, "unknown", note);
      return "stopped";
    }

    /** The service took the refund (2xx): read it back once. Never send again, whatever the list shows. */
    async function readBack(note?: string): Promise<RefundResult> {
      const found = await findRefund(paymentId, receipt).catch(() => undefined);
      if (found) {
        log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId: found.id }, ...(note ? { notes: note } : {}) });
        if (expectHold) {
          const why = `A refund of ${formatInr(amountInr)} is above the ${formatInr(settings.cancellation.refundLimitInr)} limit but Guard sent it without holding it for the owner. Guard's threshold does not match these settings: check the Razorpay limits spec.`;
          log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: why });
          raise(b, paymentId, "unheld", why);
        }
        return "done";
      }
      const why = "the payments service accepted the refund, but its own list does not show it yet. It is NOT sent again";
      log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: why });
      raise(b, paymentId, "unconfirmed", why);
      return "stopped";
    }

    let error: string | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const done = await findRefund(paymentId, receipt); // look first: an earlier try, or a lost reply, may have landed
        if (done) {
          log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId: done.id } });
          return "done";
        }
      } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
        error = `could not look at the existing refunds first (${(e as Error).message}), so nothing was sent`;
        break; // what cannot be looked at is not sent blind
      }
      try {
        const sent = await payments.refund(paymentId, { amount: amountPaise, receipt });
        return await readBack(sent.replayed ? "Guard answered from its record; nothing was sent again" : undefined);
      } catch (e) {
        const sorted = sortRefundError(e);
        switch (sorted.is) {
          case "held": {
            if (sorted.error.approval === null || sorted.error.call.body === undefined) {
              const note = `Guard is holding this refund with no approval to give: an earlier attempt has an unknown outcome, and only a person at the server can settle it, not the owner on WhatsApp. It was NOT sent again. Check Razorpay for payment ${paymentId}, then tell Guard (POST /admin/intents/resolve).`;
              log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: note });
              raise(b, paymentId, "uncertain", note);
              return "stopped";
            }
            b.pending.push({ kind: "guard_hold", amountInr, paymentId, receipt, approval: sorted.error.approval, body: sorted.error.call.body, expiresAtMs: sorted.error.expiresAtMs, heldAtMs: clock.now() });
            log(b, b.customer, "refund", "held_for_owner", { paymentId, amountInr }, { decisions, refs: { ...refs, approval: sorted.error.approval }, notes: "Guard is holding this refund for the owner. The approvals relay asks the owner, once; the agent does not." });
            return "held";
          }
          case "may_have_happened": return await maybeDone(sorted.why);
          case "refused": {
            const note = `Guard refused the refund (${sorted.error.kind === "limit" ? "a limit" : "a rule"}${sorted.error.ruleId ? `: ${sorted.error.ruleId}` : ""}): ${sorted.error.guard.reason ?? sorted.error.message}. Nothing was refunded.`;
            log(b, b.customer, "refund", "blocked", { paymentId, amountInr }, { refs, notes: note });
            raise(b, paymentId, "refused", note);
            return "stopped";
          }
          case "no_good": {
            const note = `Guard did not take the refund and will not on a retry: ${sorted.why}. Nothing was refunded.`;
            log(b, b.customer, "refund", "failed", { paymentId, amountInr }, { refs, notes: note });
            raise(b, paymentId, "failed", note);
            return "stopped";
          }
          case "lost": case "not_sent": error = sorted.why; break; // look again, and try once more
        }
      }
    }
    log(b, b.customer, "refund", error ? "failed" : "unconfirmed", { paymentId, amountInr }, { refs, notes: `${error ?? "the refund could not be sent"}; it will be tried again` });
    return "retry";
  }

  /** What the customer is told after a refund was asked for, and what is kept to try again. */
  async function afterRefund(b: Booking, result: RefundResult, a: { paymentId: string; amountInr: number; done: { customer: TemplateId; owner?: TemplateId }; held: TemplateId }): Promise<void> {
    if (result === "done") {
      await tellCustomer(b, b.customer, [a.done.customer], { refundInr: a.amountInr });
      if (a.done.owner) await tellOwner(b, b.customer, a.done.owner, { refundInr: a.amountInr });
      return;
    }
    if (result === "held") { await tellCustomer(b, b.customer, [a.held], { refundInr: a.amountInr }); return; }
    if (result === "retry") b.pending.push({ kind: "refund_retry", amountInr: a.amountInr, paymentId: a.paymentId, tries: 0, retryAtMs: clock.now() + RETRY_MINUTES[0] * MINUTE, then: { ...a.done, held: a.held } });
    await tellCustomer(b, b.customer, ["refund_checking"], { refundInr: a.amountInr });
  }

  const overLimit = (amountInr: number) => amountInr > settings.cancellation.refundLimitInr;

  /** A refund that could not be sent at all is tried again by the clock, a few times; then the builder is told. */
  async function retryRefund(b: Booking, p: Extract<Pending, { kind: "refund_retry" }>): Promise<void> {
    b.pending = b.pending.filter((x) => x !== p);
    const result = await requestRefund(b, p.paymentId, p.amountInr, [], overLimit(p.amountInr));
    if (result === "retry") {
      const tries = p.tries + 1;
      if (tries >= RETRY_MINUTES.length) {
        const note = `The refund of ${formatInr(p.amountInr)} for payment ${p.paymentId} could not be sent after ${tries + 1} tries. Nothing was refunded.`;
        log(b, b.customer, "refund", "failed", { paymentId: p.paymentId, amountInr: p.amountInr }, { notes: note, refs: { paymentId: p.paymentId } });
        raise(b, p.paymentId, "failed", note);
        return;
      }
      b.pending.push({ ...p, tries, retryAtMs: clock.now() + RETRY_MINUTES[tries] * MINUTE });
      return;
    }
    if (result === "done") { await tellCustomer(b, b.customer, [p.then.customer], { refundInr: p.amountInr }); if (p.then.owner) await tellOwner(b, b.customer, p.then.owner, { refundInr: p.amountInr }); }
    else if (result === "held") await tellCustomer(b, b.customer, [p.then.held], { refundInr: p.amountInr });
  }

  // ---- a refund Guard held: the relay says the owner decided ---------------------------------------------------------------------

  type Hold = Extract<Pending, { kind: "guard_hold" }>;
  const holdFor = (approval: string): { b: Booking; hold: Hold } | undefined => {
    for (const b of store.bookings.values()) for (const hold of b.pending) if (hold.kind === "guard_hold" && hold.approval === approval) return { b, hold };
    return undefined;
  };
  const dropHold = (b: Booking, hold: Hold) => { b.pending = b.pending.filter((x) => x !== hold); };

  async function onApprovalDecision(event: Extract<AgentEvent, { kind: "approval_decision" }>): Promise<void> {
    const found = holdFor(event.approval);
    if (!found) {
      log(null, owner, "owner_decision", "blocked", { approval: event.approval, decision: event.decision }, { notes: "no refund is waiting on this approval, so nothing is done (it may be answered already, expired, or not ours)", refs: { approval: event.approval } });
      return;
    }
    const { b, hold } = found;
    const command = event.decision;
    // What the relay said is not yet a fact: the agent cannot see Guard's record. An approval is counted as the owner's (owner_decision, confirmed) only
    // when Guard has RELEASED the held call (see releaseHeld), so a forged "approve" event leaves nothing false in the record or the monthly report.
    log(b, owner, "owner_decision", "attempted", { approval: hold.approval, decision: command }, { refs: { command, approval: hold.approval }, notes: "the approvals relay says the owner decided" });
    if (command === "deny") {
      // A deny cannot be checked from here (a refund Guard did not send leaves no trace to read). It is the safe direction for the money, and it is final.
      log(b, owner, "owner_decision", "confirmed", { approval: hold.approval, decision: command }, { refs: { command, approval: hold.approval }, notes: "the approvals relay reported that the owner denied the refund" });
      dropHold(b, hold);
      stoppedOf(b).push(hold.paymentId); // Guard would hold the same call again under a new approval: the agent must not ask again
      log(b, b.customer, "refund", "blocked", { paymentId: hold.paymentId, amountInr: hold.amountInr }, { refs: { paymentId: hold.paymentId, approval: hold.approval }, notes: "the owner declined the refund" });
      await tellCustomer(b, b.customer, ["refund_denied"]);
      return;
    }
    hold.approved = true;
    await releaseHeld(b, hold);
  }

  /** Send the held call again, with the very bytes it was held with. Only after the relay said the owner approved. */
  async function releaseHeld(b: Booking, hold: Hold): Promise<void> {
    const { paymentId, amountInr } = hold;
    const refs = { paymentId, amountPaise: String(amountInr * 100), approval: hold.approval };
    const later = (why: string) => {
      hold.tries = (hold.tries ?? 0) + 1;
      if (hold.tries >= RETRY_MINUTES.length) {
        dropHold(b, hold);
        const note = `The owner approved the refund, but it could not be sent after ${hold.tries} tries (${why}). Nothing was refunded.`;
        log(b, b.customer, "refund", "failed", { paymentId, amountInr }, { refs, notes: note });
        raise(b, paymentId, "failed", note);
        return tellCustomer(b, b.customer, ["refund_checking"], { refundInr: amountInr }).then(() => undefined);
      }
      hold.retryAtMs = clock.now() + RETRY_MINUTES[hold.tries - 1] * MINUTE;
      log(b, b.customer, "refund", "failed", { paymentId, amountInr }, { refs, notes: `the approved refund could not be sent yet (${why}); it is tried again` });
    };
    /** Guard let the held call go, which it does only for an approved one: now the owner's approval is a fact the report may count. */
    const released = () => log(b, owner, "owner_decision", "confirmed", { approval: hold.approval, decision: "approve" }, { refs: { command: "approve", approval: hold.approval }, notes: "Guard released the held refund, so the owner's approval is on Guard's record" });
    const finish = async (refundId: string, note?: string) => {
      dropHold(b, hold);
      log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId }, ...(note ? { notes: note } : {}) });
      await tellCustomer(b, b.customer, ["refund_approved"], { refundInr: amountInr });
    };
    const stop = async (kind: RefundIssueKind, note: string, outcome: "failed" | "unconfirmed" | "blocked") => {
      dropHold(b, hold);
      log(b, b.customer, "refund", outcome, { paymentId, amountInr }, { refs, notes: note });
      raise(b, paymentId, kind, note);
      await tellCustomer(b, b.customer, ["refund_checking"], { refundInr: amountInr });
    };

    // look before retrying: the refund may exist already
    let listed;
    try { listed = await findRefund(paymentId, hold.receipt); } catch (e) {
      if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
      return later(`could not look at the existing refunds first: ${(e as Error).message}`);
    }
    if (listed) return finish(listed.id, "the refund was already on the payments service's own list, so it was not sent again");

    try {
      await payments.resendRefund(paymentId, hold.body);
    } catch (e) {
      const sorted = sortRefundError(e);
      switch (sorted.is) {
        case "held":
          if (sorted.error.approval === null) return stop("uncertain", `After the owner approved, Guard holds the refund with no approval to give (an earlier attempt has an unknown outcome). It was NOT sent again. Check Razorpay for payment ${paymentId}, then tell Guard (POST /admin/intents/resolve).`, "unconfirmed");
          hold.approved = false;
          if (sorted.error.approval === hold.approval) { // Guard has no approval on record for this call: the owner's answer was not recorded there, and the owner was already asked
            log(b, b.customer, "refund", "held_for_owner", { paymentId, amountInr }, { refs, notes: "Guard still holds the refund: its record does not show the owner's approval. It waits; the owner is not asked again" });
            return;
          }
          hold.approval = sorted.error.approval;
          hold.expiresAtMs = sorted.error.expiresAtMs;
          log(b, b.customer, "refund", "held_for_owner", { paymentId, amountInr }, { refs: { ...refs, approval: sorted.error.approval }, notes: "Guard held the call again under a new approval (the first was used up or no longer valid). The relay will ask the owner about the new one" });
          return;
        case "refused": {
          const reason = sorted.error.guard.reason ?? sorted.error.message;
          if (/expire/iu.test(reason)) return expireGuardHold(b, hold, reason);
          return stop("refused", `Guard refused the approved refund (${sorted.error.kind === "limit" ? "a limit" : "a rule"}${sorted.error.ruleId ? `: ${sorted.error.ruleId}` : ""}): ${reason}. Nothing was refunded.`, "blocked");
        }
        case "no_good": return stop("failed", `Guard did not take the approved refund and will not on a retry: ${sorted.why}. Nothing was refunded.`, "failed");
        case "may_have_happened": case "lost": {
          released(); // the call went out: Guard does not send an unapproved one
          const found = await findRefund(paymentId, hold.receipt).catch(() => undefined);
          if (found) return finish(found.id, `${sorted.why}; the payments service's own list shows the refund, and it is not sent again`);
          return stop("unknown", `${sorted.why}. The approved refund may or may not have been made. It was NOT sent again. Check Razorpay for payment ${paymentId}; if Guard holds it as uncertain, tell Guard what happened (POST /admin/intents/resolve).`, "unconfirmed");
        }
        case "not_sent": return later(sorted.why);
      }
    }
    // the service took it: read back once; whatever the list shows, it is not sent again
    released();
    const after = await findRefund(paymentId, hold.receipt).catch(() => undefined);
    if (after) return finish(after.id);
    return stop("unconfirmed", "the payments service accepted the approved refund, but its own list does not show it yet. It is NOT sent again", "unconfirmed");
  }

  /** Guard's approval ran out before the owner answered (or before the approved call could be used). Nothing was refunded; the customer is told. */
  async function expireGuardHold(b: Booking, hold: Hold, why = "the owner did not answer before Guard's approval ran out"): Promise<void> {
    dropHold(b, hold);
    const note = `${why}. Nothing was refunded. A new request for payment ${hold.paymentId} has to be made by the builder.`;
    log(b, b.customer, "refund", "failed", { paymentId: hold.paymentId, amountInr: hold.amountInr }, { refs: { paymentId: hold.paymentId, approval: hold.approval }, notes: note });
    raise(b, hold.paymentId, "expired", note);
    await tellCustomer(b, b.customer, ["refund_expired"], { refundInr: hold.amountInr });
  }

  // ---- reading a message -------------------------------------------------------------------------------------------

  async function readIntent(text: string): Promise<{ intent: Intent; note?: string }> {
    try {
      // A parser that can say why it fell back (the model parser) gets that said in the record.
      const read = parser.parseDetailed ? await parser.parseDetailed(text, parseContext) : { intent: await parser.parse(text, parseContext), fallbackReason: undefined };
      const intent = coerceIntent(read.intent, parseContext);
      const note = read.fallbackReason ? `the model could not be used (${read.fallbackReason}), so the rule parser read the message` : undefined;
      return intent ? { intent, note } : { intent: { kind: "unknown" }, note: "the parser's answer was not a valid intent, so the message was treated as not understood" };
    } catch (e) {
      return { intent: { kind: "unknown" }, note: `the parser failed (${(e as Error).message}), so the message was treated as not understood` };
    }
  }

  /** Put what the customer said into the draft. False when a date does not exist (31 November). */
  function fill(b: Booking, intent: Intent): boolean {
    if (intent.serviceId) b.serviceId = intent.serviceId;
    if (intent.date) {
      const r = resolveDate(intent.date, clock.now(), tz);
      if (!r) return false;
      b.date = r.date;
      b.dateNeedsConfirmation = r.needsConfirmation;
    }
    if (intent.time) b.timePhrase = intent.time;
    return true;
  }

  /** Work out the exact start and end from the draft, if it is complete. */
  function settle(b: Booking): boolean {
    if (!b.date || !b.timePhrase) return false;
    const resolved = resolveTime(b.timePhrase, hoursOn(settings, weekdayOf(b.date)));
    b.time = resolved.time;
    b.timeInferred = resolved.inferred;
    b.startMs = zonedToMs(b.date, resolved.time, tz);
    const service = serviceOf(b);
    b.endMs = service ? b.startMs + service.durationMinutes * MINUTE : undefined;
    return true;
  }

  function clearSlot(b: Booking): void {
    b.date = b.timePhrase = b.time = b.startMs = b.endMs = undefined;
    b.dateNeedsConfirmation = b.timeInferred = false;
  }

  // ---- the booking flow ------------------------------------------------------------------------------------------

  /** The two limits about WHEN: inside opening hours, and not on top of anything else in the calendar (holds included). */
  async function slotRules(b: Booking, start: number, end: number): Promise<{ hours: Decision; clash: Decision }> {
    const buffer = settings.bufferMinutes * MINUTE;
    const nearby = await calendar.conflicts(start - buffer, end + buffer);
    return {
      hours: checkWithinHours({ settings, service: serviceOf(b)!, startMs: start }),
      clash: checkNoDoubleBooking({
        startMs: start, endMs: end, bufferMinutes: settings.bufferMinutes, ownBookingRef: b.id, nowMs: clock.now(),
        others: nearby.map((e) => ({ start: e.start, end: e.end, bookingRef: e.bookingRef, tentativeUntil: e.status === "tentative" ? e.holdExpiresAt : undefined })),
      }),
    };
  }

  /** Check the limits for a slot, then hold it in the calendar. */
  async function tryHold(b: Booking): Promise<{ ok: true; decisions: Decision[] } | { ok: false; why: "outside_hours" | "unavailable" | "failed"; decisions: Decision[] }> {
    const service = serviceOf(b)!;
    const start = b.startMs!;
    const end = b.endMs!;
    const decisions: Decision[] = [checkPriceAtOrAboveList({ serviceName: serviceName(service, "en"), listInr: service.priceInr, proposedInr: service.priceInr })];
    const { hours, clash } = await slotRules(b, start, end);
    decisions.push(hours, clash);
    if (hours.verdict === "block") { log(b, b.customer, "hold_slot", "blocked", { start }, { decisions }); return { ok: false, why: "outside_hours", decisions }; }
    if (clash.verdict === "block") { log(b, b.customer, "hold_slot", "blocked", { start }, { decisions }); return { ok: false, why: "unavailable", decisions }; }

    b.holdExpiresAt = clock.now() + settings.deposit.holdMinutes * MINUTE;
    log(b, b.customer, "hold_slot", "attempted", { start, end }, { decisions });
    const { event, error, conflict } = await ensureEvent(b, { start, end, status: "tentative" });
    if (event) {
      b.eventId = event.id;
      log(b, b.customer, "hold_slot", "confirmed", { start, end }, { refs: { eventId: event.id } });
      return { ok: true, decisions };
    }
    b.holdExpiresAt = undefined;
    if (conflict) {
      log(b, b.customer, "hold_slot", "blocked", { start }, { notes: "the calendar refused: someone took the time first", decisions });
      return { ok: false, why: "unavailable", decisions };
    }
    log(b, b.customer, "hold_slot", error ? "failed" : "unconfirmed", { start, end }, { notes: error ?? "the calendar does not show the hold" });
    return { ok: false, why: "failed", decisions };
  }

  /** Hold the slot, create the deposit link, and send the quote. */
  async function proceedToHold(b: Booking, prefix: TemplateId[], shown: Decision[]): Promise<void> {
    const phone = b.customer;
    const held = await tryHold(b);
    if (!held.ok) {
      const slotMs = b.startMs;
      if (held.why === "failed") await tellOwner(b, phone, "owner_not_booked");
      const template: TemplateId = held.why === "outside_hours" ? "outside_hours" : held.why === "unavailable" ? "slot_unavailable" : "hold_failed";
      moveTo(b, "enquiry");
      await tellCustomer(b, phone, [...prefix, template], { slotMs, shown: [...shown, ...held.decisions] });
      clearSlot(b);
      return;
    }

    log(b, phone, "create_deposit_link", "attempted", { amountPaise: depositPaise });
    const { link, error } = await ensureLink(b);
    if (!link) {
      log(b, phone, "create_deposit_link", error ? "failed" : "unconfirmed", { amountPaise: depositPaise }, { notes: error ?? "the payments service does not show the link" });
      await releaseSlot(b, "no payment link could be created");
      await tellOwner(b, phone, "owner_not_booked");
      moveTo(b, "enquiry");
      await tellCustomer(b, phone, ["link_failed"]);
      clearSlot(b);
      return;
    }
    b.linkId = link.id;
    b.linkUrl = link.short_url;
    log(b, phone, "create_deposit_link", "confirmed", { amountPaise: depositPaise }, { refs: { linkId: link.id } });
    moveTo(b, "awaiting_deposit");
    await tellCustomer(b, phone, [...prefix, prefix.includes("price_floor") ? "slot_and_link" : "quote_and_link"], { shown: [...shown, ...held.decisions] });
  }

  async function onBook(phone: string, intent: Intent): Promise<void> {
    const language = languageOf(phone);
    const waiting = latestBooking(store, phone, ["awaiting_deposit"]);
    let b = latestBooking(store, phone, ["enquiry", "confirming_details"]);
    const hasDetails = intent.serviceId !== undefined || intent.date !== undefined || intent.time !== undefined;

    if (!b && waiting) {
      // Already holding a slot for this customer: a repeat of the same request gets the same link, not a second hold.
      const probe = newDraft(phone, language);
      Object.assign(probe, { serviceId: waiting.serviceId, date: waiting.date, timePhrase: waiting.timePhrase, dateNeedsConfirmation: waiting.dateNeedsConfirmation });
      if (hasDetails && fill(probe, intent)) settle(probe);
      if (!hasDetails || (probe.serviceId === waiting.serviceId && probe.startMs === waiting.startMs)) {
        await tellCustomer(waiting, phone, ["already_waiting"]);
        return;
      }
      await cancelWaiting(waiting, "replaced by a new request from the customer");
      b = register(store, probe);
    } else if (!b) {
      b = register(store, newDraft(phone, language));
    }
    b.language = language;
    if (!fill(b, intent)) { await tellCustomer(b, phone, ["didnt_understand"]); return; }
    settle(b);

    // The customer's price is only ever compared with the list; the quote is always the list price.
    const service = serviceOf(b);
    const shown: Decision[] = [];
    const prefix: TemplateId[] = [];
    if (service && intent.offerInr !== undefined) {
      const d = checkPriceAtOrAboveList({ serviceName: serviceName(service, "en"), listInr: service.priceInr, proposedInr: intent.offerInr });
      shown.push(d);
      if (d.verdict === "block") prefix.push("price_floor");
    }

    if (!service) { await tellCustomer(b, phone, ["menu"], { shown }); return; }
    if (b.startMs === undefined || b.endMs === undefined) { await tellCustomer(b, phone, [...prefix, "ask_when"], { shown }); return; }
    if (b.startMs <= clock.now()) {
      const slotMs = b.startMs;
      clearSlot(b);
      await tellCustomer(b, phone, [...prefix, "slot_unavailable"], { slotMs, shown });
      return;
    }
    if (b.dateNeedsConfirmation || b.timeInferred) {
      moveTo(b, "confirming_details");
      await tellCustomer(b, phone, [...prefix, "confirm_details"], { shown });
      return;
    }
    await proceedToHold(b, prefix, shown);
  }

  async function onYes(phone: string): Promise<void> {
    const moving = latestBooking(store, phone, ["confirmed"]);
    if (moving?.reschedule) return applyReschedule(moving);
    const b = latestBooking(store, phone, ["confirming_details"]);
    if (b) return proceedToHold(b, [], []);
    const waiting = latestBooking(store, phone, ["awaiting_deposit"]);
    if (waiting) { await tellCustomer(waiting, phone, ["already_waiting"]); return; }
    await tellCustomer(null, phone, ["didnt_understand"]);
  }

  async function onNo(phone: string): Promise<void> {
    const moving = latestBooking(store, phone, ["confirmed"]);
    if (moving?.reschedule) { moving.reschedule = undefined; await tellCustomer(moving, phone, ["ask_new_time"]); return; }
    const b = latestBooking(store, phone, ["confirming_details"]);
    if (b) { clearSlot(b); moveTo(b, "enquiry"); await tellCustomer(b, phone, ["ask_when"]); return; }
    await tellCustomer(null, phone, ["didnt_understand"]);
  }

  // ---- deposits ----------------------------------------------------------------------------------------------------

  /** Compare the payments service's record of this booking's link with what the agent has counted. */
  async function reconcilePayments(b: Booking): Promise<void> {
    if (!b.linkId) return;
    const link = await payments.fetchPaymentLink(b.linkId);
    if (!link) { log(b, b.customer, "record_deposit", "failed", { linkId: b.linkId }, { notes: "the payments service has no such link" }); return; }
    for (const payment of link.payments) {
      if (b.handledPayments.includes(payment.id)) continue;
      const rule = checkOneDepositPerBooking({ record, booking: b.id, paymentId: payment.id });
      b.handledPayments.push(payment.id);
      if (rule.verdict === "allow") {
        b.depositPaymentId = payment.id;
        b.depositInr = payment.amount / 100;
        log(b, b.customer, "record_deposit", "confirmed", { linkId: link.id, amount: payment.amount }, { decisions: [rule], refs: { paymentId: payment.id, linkId: link.id, amountPaise: String(payment.amount) } });
        await afterDeposit(b);
      } else {
        log(b, b.customer, "record_deposit", "blocked", { linkId: link.id, amount: payment.amount }, { decisions: [rule], refs: { paymentId: payment.id, amountPaise: String(payment.amount) } });
        await handleExtraPayment(b, payment.id, payment.amount / 100 - payment.amount_refunded / 100, rule);
      }
    }
  }

  async function afterDeposit(b: Booking): Promise<void> {
    if (b.state === "awaiting_deposit" || b.state === "needs_owner") return completeBooking(b);
    if (b.state === "expired") {
      // The hold ran out before the money came. If the slot is still free, take it again; if not, give the money back.
      const held = await tryHold(b);
      if (held.ok) { moveTo(b, "awaiting_deposit"); return completeBooking(b); }
      return refundUnbookable(b, "slot_gone");
    }
    return refundUnbookable(b, "inactive");
  }

  /** The deposit is recorded: now the calendar must show the booking too. Only then does the customer hear "booked". */
  async function completeBooking(b: Booking): Promise<void> {
    const want: Wanted = { start: b.startMs!, end: b.endMs!, status: "confirmed" };
    log(b, b.customer, "confirm_booking", "attempted", want);
    const found = await ensureEvent(b, want);
    if (found.event) {
      b.eventId = found.event.id;
      b.holdExpiresAt = undefined;
      b.pending = b.pending.filter((p) => p.kind !== "calendar");
      b.reminders = reminderSchedule(settings, b.startMs!, clock.now());
      log(b, b.customer, "confirm_booking", "confirmed", want, { refs: { eventId: found.event.id } });
      moveTo(b, "confirmed");
      await tellCustomer(b, b.customer, ["booked"]);
      return;
    }
    log(b, b.customer, "confirm_booking", found.error ? "failed" : "unconfirmed", want, { notes: found.error ?? "the calendar does not show the booking" });
    if (!b.pending.some((p) => p.kind === "calendar")) b.pending.push({ kind: "calendar" });
    if (b.state !== "needs_owner") moveTo(b, "needs_owner");
    await tellCustomer(b, b.customer, ["couldnt_confirm"]);
    await tellOwner(b, b.customer, "owner_cant_confirm");
  }

  /** A payment that is not the booking's deposit (a second payment on the same link): refund it and tell the owner. */
  async function handleExtraPayment(b: Booking, paymentId: string, leftInr: number, oneDeposit: Decision): Promise<void> {
    const payment = await payments.fetchPayment(paymentId);
    if (payment && payment.amount_refunded >= payment.amount) return; // already refunded by someone
    const limit = checkRefundLimit({ amountInr: leftInr, limitInr: settings.cancellation.refundLimitInr, paidInr: leftInr });
    if (limit.verdict === "block") { log(b, b.customer, "refund", "blocked", { paymentId, amountInr: leftInr }, { decisions: [oneDeposit, limit], refs: { paymentId, amountPaise: String(leftInr * 100) } }); return; }
    // Above the limit the agent does not ask the owner: Guard holds the refund, and the approvals relay asks, once.
    const result = await requestRefund(b, paymentId, leftInr, [oneDeposit, limit], limit.verdict !== "allow");
    await afterRefund(b, result, { paymentId, amountInr: leftInr, done: { customer: "duplicate_refund", owner: "owner_duplicate_payment" }, held: "duplicate_refund_pending" });
  }

  /** The deposit arrived but there is no booking it can confirm. */
  async function refundUnbookable(b: Booking, why: "slot_gone" | "inactive"): Promise<void> {
    const amountInr = b.depositInr!;
    const limit = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: amountInr });
    const result = limit.verdict === "block" ? "stopped" : await requestRefund(b, b.depositPaymentId!, amountInr, [limit], limit.verdict !== "allow");
    if (b.state !== "cancelled") moveTo(b, "cancelled");
    await afterRefund(b, result, { paymentId: b.depositPaymentId!, amountInr, done: { customer: why === "slot_gone" ? "slot_gone_refund" : "refund_unbooked", owner: "owner_payment_unused" }, held: "cancelled_refund_pending" });
  }

  // ---- cancelling and rescheduling ---------------------------------------------------------------------------------

  async function closeLink(b: Booking, why: string): Promise<void> {
    if (!b.linkId) return;
    const closed = await payments.cancelPaymentLink(b.linkId).then(() => payments.fetchPaymentLink(b.linkId!)).then((l) => l?.status === "cancelled").catch(() => false);
    log(b, b.customer, "cancel_deposit_link", closed ? "confirmed" : "unconfirmed", { linkId: b.linkId }, { notes: closed ? why : "the link could not be closed: it may still be open or already paid" });
  }

  /** Give up a held slot that has not been paid: free the calendar and close the link. */
  async function cancelWaiting(b: Booking, why: string): Promise<void> {
    await releaseSlot(b, why);
    await closeLink(b, why);
    moveTo(b, "cancelled");
    log(b, b.customer, "cancel_booking", "confirmed", { state: "awaiting_deposit" }, { notes: why });
    await reconcilePayments(b); // a payment that landed just before the cancel is refunded, not forgotten
  }

  /** The hold ran out. Before giving the slot up, look at the payments record: the event may have been lost. */
  async function expireHold(b: Booking): Promise<void> {
    await reconcilePayments(b);
    if (b.state !== "awaiting_deposit") return;
    const slotMs = b.startMs;
    await releaseSlot(b, "the hold ran out before a deposit was recorded");
    await closeLink(b, "the hold ran out");
    moveTo(b, "expired");
    await tellCustomer(b, b.customer, ["hold_expired"], { slotMs });
  }

  async function onCancel(phone: string): Promise<void> {
    const b = latestBooking(store, phone, ["confirmed"]) ?? latestBooking(store, phone, ["needs_owner"]) ?? latestBooking(store, phone, ["awaiting_deposit"])
      ?? latestBooking(store, phone, ["confirming_details", "enquiry"]);
    if (!b || b.startMs === undefined) { await tellCustomer(b ?? null, phone, ["no_booking_found"]); return; }

    if (b.state === "enquiry" || b.state === "confirming_details") {
      moveTo(b, "cancelled");
      log(b, phone, "cancel_booking", "confirmed", { state: "draft" });
      await tellCustomer(b, phone, ["cancelled_no_deposit"]);
      return;
    }
    if (b.state === "awaiting_deposit") {
      await cancelWaiting(b, "cancelled by the customer before paying");
      await tellCustomer(b, phone, ["cancelled_no_deposit"]);
      return;
    }

    // A paid booking. Inside the cancellation window the deposit goes back. Above the refund limit Guard holds it for the owner (asked once, by
    // the relay). Outside the window and within the limit, whether to give it back is the owner's call, and the agent asks. Outside the window
    // AND above the limit it is the same one ask, Guard's: asking twice about one refund is what this avoids.
    const hoursLeft = (b.startMs - clock.now()) / HOUR;
    const inWindow = hoursLeft >= settings.cancellation.windowHours;
    const amountInr = b.depositInr!;
    await releaseSlot(b, "cancelled by the customer");
    b.reminders = [];
    b.pending = [];
    moveTo(b, "cancelled");
    log(b, phone, "cancel_booking", "confirmed", { hoursLeft: Math.floor(hoursLeft), inWindow });
    const limit = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: amountInr });
    if (limit.verdict === "block") { log(b, phone, "refund", "blocked", { paymentId: b.depositPaymentId, amountInr }, { decisions: [limit], refs: { paymentId: b.depositPaymentId!, amountPaise: String(amountInr * 100) } }); return; }
    if (!inWindow && limit.verdict === "allow") {
      const late = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: amountInr, inCancellationWindow: false });
      b.pending.push({ kind: "refund", amountInr, paymentId: b.depositPaymentId!, reason: "late_cancellation" });
      log(b, phone, "refund", "held_for_owner", { paymentId: b.depositPaymentId, amountInr }, { decisions: [late], refs: { paymentId: b.depositPaymentId!, amountPaise: String(amountInr * 100) } });
      await tellCustomer(b, phone, ["cancelled_late"], { refundInr: amountInr });
      await tellOwner(b, phone, "owner_late_cancellation", { refundInr: amountInr });
      return;
    }
    const result = await requestRefund(b, b.depositPaymentId!, amountInr, [limit], limit.verdict !== "allow");
    await afterRefund(b, result, { paymentId: b.depositPaymentId!, amountInr, done: { customer: "cancelled_refund" }, held: inWindow ? "cancelled_refund_pending" : "cancelled_late" });
  }

  async function onReschedule(phone: string, intent: Intent): Promise<void> {
    const b = latestBooking(store, phone, ["confirmed"]);
    if (!b || b.startMs === undefined) { await tellCustomer(b ?? null, phone, ["no_booking_found"]); return; }
    if (!intent.date && !intent.time) { await tellCustomer(b, phone, ["ask_new_time"]); return; }

    // Build the new slot from the old one, changed by whatever the customer named.
    const probe = newDraft(phone, b.language);
    probe.serviceId = b.serviceId;
    const old = localParts(b.startMs, tz);
    probe.date = { year: old.year, month: old.month, day: old.day };
    probe.timePhrase = { hour: old.hour % 12 || 12, minute: old.minute, period: old.hour < 12 ? "am" : "pm" };
    if (!fill(probe, intent)) { await tellCustomer(b, phone, ["didnt_understand"]); return; }
    settle(probe);
    const start = probe.startMs!;
    const end = probe.endMs!;

    b.reschedule = { date: probe.date!, timePhrase: probe.timePhrase!, startMs: start, endMs: end };
    if (probe.dateNeedsConfirmation || probe.timeInferred) {
      // Ask only about a time that is possible right now; it is checked again when the customer says yes.
      if (!(await moveAllowed(b, b.reschedule))) { b.reschedule = undefined; return; }
      await tellCustomer(b, phone, ["confirm_details"], { slotMs: start });
      return;
    }
    await applyReschedule(b);
  }

  /** Can this booking move to this time right now? If not, say why to the customer. Hours and double-booking are checked again at every move. */
  async function moveAllowed(b: Booking, move: { startMs: number; endMs: number }): Promise<boolean> {
    const { hours, clash } = await slotRules(b, move.startMs, move.endMs);
    const past = move.startMs <= clock.now();
    if (!past && hours.verdict !== "block" && clash.verdict !== "block") return true;
    log(b, b.customer, "reschedule_booking", "blocked", { start: move.startMs }, { decisions: [hours, clash], notes: past ? "that time has already passed" : undefined });
    await tellCustomer(b, b.customer, [hours.verdict === "block" ? "outside_hours" : "slot_unavailable"], { slotMs: move.startMs, shown: [hours, clash] });
    return false;
  }

  async function applyReschedule(b: Booking): Promise<void> {
    const move = b.reschedule!;
    b.reschedule = undefined;
    if (!(await moveAllowed(b, move))) return; // the customer's yes may come after someone else took the time
    const want: Wanted = { start: move.startMs, end: move.endMs, status: "confirmed" };
    log(b, b.customer, "reschedule_booking", "attempted", want);
    const found = await ensureEvent(b, want);
    if (found.event) {
      b.startMs = move.startMs;
      b.endMs = move.endMs;
      b.reminders = reminderSchedule(settings, b.startMs, clock.now());
      log(b, b.customer, "reschedule_booking", "confirmed", want, { refs: { eventId: found.event.id } });
      await tellCustomer(b, b.customer, ["rescheduled"]);
      return;
    }
    log(b, b.customer, "reschedule_booking", found.error ? "failed" : "unconfirmed", want, { notes: found.error ?? "the calendar does not show the new time" });
    await tellCustomer(b, b.customer, ["reschedule_failed"], { slotMs: move.startMs });
    await tellOwner(b, b.customer, "owner_reschedule_failed", { slotMs: move.startMs });
  }

  // ---- the owner's answers -----------------------------------------------------------------------------------------

  async function onOwnerMessage(msg: InboundMessage): Promise<void> {
    // "approve K7M2QX" answers the approvals relay, which reads the owner's messages too (the inbox gives it a copy). It is not for the agent:
    // no reply and no record, so the owner is not told "I didn't understand" about an answer that was understood elsewhere.
    if (RELAY_CODE_REPLY.test(msg.text)) return;
    const m = /^\s*(approve|deny|retry)\s+(b-\d+)\s*$/i.exec(msg.text);
    const b = m ? store.bookings.get(m[2].toLowerCase()) : undefined;
    const command = m?.[1].toLowerCase();
    const pending = b?.pending[0];
    const said = command ? { command } : undefined; // the record keeps the command in the clear, so a report can count approvals and refusals
    log(b ?? null, owner, "owner_decision", "attempted", { command, ref: m?.[2] }, { refs: said });
    if (!b || !command || !pending) {
      log(b ?? null, owner, "owner_decision", "blocked", { command }, { notes: "not a command for something waiting on the owner", refs: said });
      await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] });
      return;
    }

    if (pending.kind === "calendar") {
      if (command === "deny") { await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] }); return; }
      if (command === "retry") {
        log(b, owner, "owner_decision", "confirmed", { command }, { refs: said });
        await completeBooking(b); // sends "booked" only if the calendar now shows it
        return;
      }
      // approve: cancel the booking and give the deposit back
      b.pending = [];
      await releaseSlot(b, "the owner cancelled a booking the calendar could not confirm");
      b.reminders = [];
      moveTo(b, "cancelled");
      log(b, b.customer, "cancel_booking", "confirmed", { by: "owner" });
      const amountInr = b.depositInr!;
      const limit = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: amountInr, ownerApproved: true });
      log(b, owner, "owner_decision", "confirmed", { command }, { refs: said });
      // The owner chose to cancel. The deposit going back is a separate matter if it is above the limit: Guard holds it and the relay asks.
      const result = await requestRefund(b, b.depositPaymentId!, amountInr, [limit], overLimit(amountInr));
      await afterRefund(b, result, { paymentId: b.depositPaymentId!, amountInr, done: { customer: "cancelled_refund" }, held: "cancelled_refund_pending" });
      return;
    }

    if (pending.kind === "guard_hold" || pending.kind === "refund_retry") {
      log(b, owner, "owner_decision", "blocked", { command }, { notes: pending.kind === "guard_hold" ? "this refund is held by Guard: it is answered with the code in the approval message, not with the booking reference" : "this refund is being sent again by itself", refs: said });
      return;
    }

    if (command === "retry") { await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] }); return; }
    if (command === "deny") {
      b.pending.shift();
      log(b, owner, "owner_decision", "confirmed", { command }, { notes: "the owner declined the refund", refs: said });
      await tellCustomer(b, b.customer, ["refund_denied"]);
      return;
    }
    const limit = checkRefundLimit({ amountInr: pending.amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: pending.amountInr, ownerApproved: true });
    log(b, owner, "owner_decision", "confirmed", { command }, { refs: said });
    b.pending = b.pending.filter((x) => x !== pending);
    const result = await requestRefund(b, pending.paymentId, pending.amountInr, [limit], overLimit(pending.amountInr));
    await afterRefund(b, result, { paymentId: pending.paymentId, amountInr: pending.amountInr, done: { customer: "refund_approved" }, held: "cancelled_refund_pending" });
  }

  // ---- STOP --------------------------------------------------------------------------------------------------------

  async function onStop(phone: string): Promise<void> {
    customerOf(phone).optedOut = true;
    log(null, phone, "opt_out", "confirmed", { by: "STOP" }, { notes: "no more messages to this customer, not even a reply; any reminder that falls due is stopped by the limits" });
    await tellOwner(null, phone, "owner_opted_out");
  }

  // ---- a voice note ------------------------------------------------------------------------------------------------

  /**
   * A voice note (or an audio file) cannot be listened to yet (plan B29 is the voice module), so the sender gets one plain line asking them to
   * type, in the language this conversation already uses (else the shop's first language). The record names it `voice_note_reply`. The audio
   * is never fetched or kept, the model is never asked about it, and it does not change the customer's language. STOP means STOP: nothing is
   * sent to a customer who opted out. The owner's messages are commands, so an owner's voice note gets the same line in the owner's language.
   * A reply that cannot go out is recorded as unconfirmed or failed by `say`, like any other, and the step does not fail.
   */
  async function onVoiceNote(msg: InboundMessage): Promise<void> {
    const phone = msg.from;
    if (phone === owner) {
      await say({ booking: null, phone, to: "owner", templates: ["voice_note"], action: "voice_note_reply" });
      return;
    }
    const customer = customerOf(phone);
    log(null, phone, "receive_message", "confirmed", { voiceNote: true, id: msg.id }, { notes: "a voice note: it is not listened to and nothing of it is kept", refs: { messageId: msg.id } });
    if (customer.optedOut) return; // STOP means STOP: nothing goes to them, even if they write again
    await tellCustomer(null, phone, ["voice_note"], { action: "voice_note_reply" });
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  async function onMessage(msg: InboundMessage): Promise<void> {
    if (store.seenMessages.has(msg.id)) {
      log(null, msg.from, "receive_message", "blocked", { id: msg.id }, { notes: `the same WhatsApp message (${msg.id}) was delivered again, so it is ignored` });
      return;
    }
    store.seenMessages.add(msg.id);
    if (msg.voiceNote) return onVoiceNote(msg);
    if (msg.from === owner) return onOwnerMessage(msg);

    const phone = msg.from;
    const customer = customerOf(phone);
    const { intent, note } = await readIntent(msg.text);
    if (intent.language && settings.languages.includes(intent.language)) customer.language = intent.language;
    const notes = [note, intent.overrideAttempt ? "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing" : undefined].filter(Boolean).join("; ");
    log(null, phone, "receive_message", "confirmed", { text: msg.text, id: msg.id }, { notes, refs: { messageId: msg.id } });

    if (intent.kind === "stop") return onStop(phone);
    if (customer.optedOut) return; // STOP means STOP: nothing goes to them, even if they write again

    switch (intent.kind) {
      case "book": return onBook(phone, intent);
      case "yes": return onYes(phone);
      case "no": return onNo(phone);
      case "cancel": return onCancel(phone);
      case "reschedule": return onReschedule(phone, intent);
      case "greeting": await tellCustomer(null, phone, ["menu"]); return;
      default: await tellCustomer(null, phone, ["didnt_understand"]);
    }
  }

  async function onPaymentEvent(event: PaymentEvent): Promise<void> {
    if (store.seenEvents.has(event.id)) {
      log(null, owner, "receive_payment_event", "blocked", { id: event.id, event: event.event }, { notes: `event ${event.id} was delivered again, so it is ignored` });
      return;
    }
    const bookings = [...store.bookings.values()];
    if (event.event === "refund.processed") {
      const paymentId = event.payload.refund!.payment_id;
      const b = bookings.find((x) => x.handledPayments.includes(paymentId) || x.depositPaymentId === paymentId);
      const refundId = event.payload.refund!.id;
      const listed = (await payments.listRefunds(paymentId)).some((r) => r.id === refundId);
      log(b ?? null, b?.customer ?? owner, "receive_payment_event", listed ? "confirmed" : "unconfirmed", { id: event.id, event: event.event }, { refs: { refundId, paymentId }, notes: "the refund is on the payments service's own list" });
      store.seenEvents.add(event.id);
      return;
    }
    // A real payment.captured names the payment, not its link (Razorpay's body has the order id only): ask the payments service which link it paid.
    const paymentId = event.payload.payment?.id;
    const linkId = event.payload.payment_link?.id ?? event.payload.payment?.link_id
      ?? (paymentId ? (await payments.listPaymentLinks({ payment_id: paymentId }))[0]?.id : undefined);
    const b = linkId ? bookings.find((x) => x.linkId === linkId) : undefined;
    if (!b) {
      log(null, owner, "receive_payment_event", "blocked", { id: event.id, event: event.event }, { notes: "no booking has this payment link, so the event is ignored" });
      store.seenEvents.add(event.id);
      return;
    }
    log(b, b.customer, "receive_payment_event", "confirmed", { id: event.id, event: event.event }, { refs: { eventId: event.id } });
    await reconcilePayments(b); // the record decides; the event only said to look
    store.seenEvents.add(event.id); // only after it worked: a failed step can be run again with the same event
  }

  async function onTick(): Promise<void> {
    const now = clock.now();
    // Refunds first, whatever state their booking is in. A hold whose approval ran out is over; one the owner approved and that could not be
    // sent yet is sent again; a refund that could not be sent at all is tried again. A hold nobody answered is NOT sent again: it just waits.
    for (const b of [...store.bookings.values()]) {
      for (const p of [...b.pending]) {
        if (p.kind === "guard_hold") {
          if (p.expiresAtMs !== null && p.expiresAtMs <= now) await expireGuardHold(b, p);
          else if (p.approved && p.retryAtMs !== undefined && p.retryAtMs <= now) await releaseHeld(b, p);
        } else if (p.kind === "refund_retry" && p.retryAtMs <= now) await retryRefund(b, p);
      }
    }
    for (const b of [...store.bookings.values()]) {
      if (b.state === "awaiting_deposit" && b.holdExpiresAt !== undefined && b.holdExpiresAt <= now) await expireHold(b);
      if (b.state !== "confirmed" || b.startMs === undefined || b.endMs === undefined) continue;

      // Reminders: if several fell due while nothing was running, send one, the latest. Whether it may go is the limits' call.
      const due = b.reminders.filter((r) => !r.sent && r.atMs <= now);
      for (const r of due) r.sent = true;
      if (due.length > 0 && b.startMs > now) await tellCustomer(b, b.customer, ["reminder"], { reminder: true });

      if (b.endMs <= now) {
        moveTo(b, "completed");
        b.reminders = [];
        log(b, b.customer, "complete_booking", "confirmed", { endMs: b.endMs });
      }
    }
  }

  async function handle(event: AgentEvent): Promise<void> {
    if (event.kind === "message") return onMessage(event.message);
    if (event.kind === "payment_event") return onPaymentEvent(event.event);
    if (event.kind === "approval_decision") return onApprovalDecision(event);
    return onTick();
  }

  return { handle };
}
