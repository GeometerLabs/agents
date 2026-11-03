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
import type { Booking, Store } from "./booking.ts";
import { ApiError, ConflictError, TimeoutError } from "./adapters/faults.ts";
import type { Calendar, CalendarEvent } from "./adapters/calendar.ts";
import type { InboundMessage, Messaging } from "./adapters/messaging.ts";
import { coerceIntent } from "./adapters/model.ts";
import type { Intent, IntentParser } from "./adapters/model.ts";
import type { PaymentEvent, PaymentLink, Payments } from "./adapters/payments.ts";
import type { Clock } from "./clock.ts";
import { resolveDate, resolveTime } from "./language/dates.ts";
import { TEMPLATE_NAMES, render } from "./language/templates.ts";
import type { TemplateId } from "./language/templates.ts";
import type { Action, ActionRecord, Outcome } from "./record.ts";
import { hoursOn, serviceName } from "./settings.ts";
import type { Settings } from "./settings.ts";
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
  | { kind: "tick" }; // time has passed: let holds expire and send due reminders

export interface Agent { handle(event: AgentEvent): Promise<void> }

const ATTEMPTS = 2; // look, try, read back; and once more if that did not settle it

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

  function log(b: Booking | null, phone: string, action: Action, outcome: Outcome, inputs: unknown, more: { decisions?: Decision[]; notes?: string; refs?: Record<string, string> } = {}) {
    return record.append({ conversation: phone, booking: b?.id || null, action, inputs, outcome, language: languageOf(phone, b), ...more });
  }

  // ---- saying things -------------------------------------------------------------------------------------------

  /**
   * The one way a message leaves the agent. It renders the templates from the record, runs the limits on the final text,
   * sends only if none blocks, and reads the message back from the messaging service. Returns whether it went out.
   * `shown` are decisions worth recording alongside the message (for example "price floor held") that do not gate it.
   */
  async function say(a: { booking: Booking | null; phone: string; to: "customer" | "owner"; templates: TemplateId[]; refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean }): Promise<boolean> {
    const toCustomer = a.to === "customer";
    const toNumber = toCustomer ? a.phone : owner;
    const language = toCustomer ? languageOf(a.phone, a.booking) : settings.owner.language;
    const facts = factsFor(settings, a.booking, language, { customerPhone: a.phone, refundInr: a.refundInr, slotMs: a.slotMs, menu: a.templates.includes("menu") });
    const inputs = { to: a.to, templates: a.templates, refundInr: a.refundInr, slotMs: a.slotMs };
    let text: string;
    try {
      text = a.templates.map((id) => render(id, facts)).join(" ");
    } catch (e) {
      log(a.booking, a.phone, "send_message", "blocked", inputs, { notes: (e as Error).message, decisions: a.shown });
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
      log(a.booking, a.phone, "send_message", "blocked", inputs, { decisions, notes: worst.reason });
      if (toCustomer && worst.ruleId === "message-matches-record") await say({ booking: a.booking, phone: a.phone, to: "owner", templates: ["owner_message_held"] });
      return false;
    }

    try {
      const sent = (await messaging.isWindowOpen(toNumber))
        ? await messaging.sendText(toNumber, text)
        : await messaging.sendTemplate(toNumber, { name: !toCustomer ? TEMPLATE_NAMES.owner : a.reminder ? TEMPLATE_NAMES.reminder : TEMPLATE_NAMES.customer, language, text });
      const seen = await messaging.getMessage(sent.id); // read back from the provider's own outbox
      log(a.booking, a.phone, "send_message", seen ? "confirmed" : "unconfirmed", inputs, { decisions, refs: { messageId: sent.id, templates: a.templates.join("+") } });
      return seen !== null;
    } catch (e) {
      // a lost reply may still have gone out; it is not sent again, because there is no way to look it up
      log(a.booking, a.phone, "send_message", e instanceof TimeoutError ? "unconfirmed" : "failed", inputs, { decisions, notes: (e as Error).message });
      return false;
    }
  }

  const tellCustomer = (b: Booking | null, phone: string, templates: TemplateId[], more: { refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean } = {}) =>
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

  /** Refund part of a payment, once. Returns true only if the payments service's own record shows the refund. */
  async function refundPayment(b: Booking, paymentId: string, amountInr: number, decisions: Decision[]): Promise<boolean> {
    const receipt = `${b.id}:${paymentId}`;
    log(b, b.customer, "refund", "attempted", { paymentId, amountInr }, { decisions });
    let error: string | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const done = (await payments.listRefunds(paymentId)).find((r) => r.receipt === receipt); // an earlier try may have landed
      if (done) {
        log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { refundId: done.id, paymentId } });
        return true;
      }
      try {
        await payments.refund(paymentId, { amount: amountInr * 100, receipt });
      } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
        error = (e as Error).message;
      }
    }
    const final = (await payments.listRefunds(paymentId)).find((r) => r.receipt === receipt);
    log(b, b.customer, "refund", final ? "confirmed" : error ? "failed" : "unconfirmed", { paymentId, amountInr }, { refs: final ? { refundId: final.id, paymentId } : { paymentId }, notes: error });
    return final !== undefined;
  }

  // ---- reading a message -------------------------------------------------------------------------------------------

  async function readIntent(text: string): Promise<{ intent: Intent; note?: string }> {
    try {
      const intent = coerceIntent(await parser.parse(text, parseContext), parseContext);
      return intent ? { intent } : { intent: { kind: "unknown" }, note: "the parser's answer was not a valid intent, so the message was treated as not understood" };
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
      if (held.why === "failed") await tellOwner(b, phone, "owner_hold_failed");
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
      await tellOwner(b, phone, "owner_link_failed");
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
        log(b, b.customer, "record_deposit", "confirmed", { linkId: link.id, amount: payment.amount }, { decisions: [rule], refs: { paymentId: payment.id, linkId: link.id } });
        await afterDeposit(b);
      } else {
        log(b, b.customer, "record_deposit", "blocked", { linkId: link.id, amount: payment.amount }, { decisions: [rule], refs: { paymentId: payment.id } });
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
    if (limit.verdict === "allow" && (await refundPayment(b, paymentId, leftInr, [oneDeposit, limit]))) {
      await tellCustomer(b, b.customer, ["duplicate_refund"], { refundInr: leftInr });
      await tellOwner(b, b.customer, "owner_duplicate_payment", { refundInr: leftInr });
      return;
    }
    b.pending.push({ kind: "refund", amountInr: leftInr, paymentId, reason: limit.verdict === "allow" ? "refund_failed" : "over_limit" });
    log(b, b.customer, "refund", "held_for_owner", { paymentId, amountInr: leftInr }, { decisions: [oneDeposit, limit] });
    await tellCustomer(b, b.customer, ["duplicate_refund_pending"], { refundInr: leftInr });
    await tellOwner(b, b.customer, "owner_refund_needs_approval", { refundInr: leftInr });
  }

  /** The deposit arrived but there is no booking it can confirm. */
  async function refundUnbookable(b: Booking, why: "slot_gone" | "inactive"): Promise<void> {
    const amountInr = b.depositInr!;
    const limit = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: amountInr });
    if (limit.verdict === "allow" && (await refundPayment(b, b.depositPaymentId!, amountInr, [limit]))) {
      if (b.state !== "cancelled") moveTo(b, "cancelled");
      await tellCustomer(b, b.customer, [why === "slot_gone" ? "slot_gone_refund" : "refund_unbooked"], { refundInr: amountInr });
      await tellOwner(b, b.customer, why === "slot_gone" ? "owner_slot_gone" : "owner_unbooked_payment", { refundInr: amountInr });
      return;
    }
    b.pending.push({ kind: "refund", amountInr, paymentId: b.depositPaymentId!, reason: limit.verdict === "allow" ? "refund_failed" : "over_limit" });
    log(b, b.customer, "refund", "held_for_owner", { paymentId: b.depositPaymentId, amountInr }, { decisions: [limit] });
    if (b.state !== "cancelled") moveTo(b, "cancelled");
    await tellCustomer(b, b.customer, ["cancelled_refund_pending"], { refundInr: amountInr });
    await tellOwner(b, b.customer, "owner_refund_needs_approval", { refundInr: amountInr });
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

    // A paid booking. Inside the cancellation window the deposit goes back (within the refund limit); outside it, the owner decides.
    const hoursLeft = (b.startMs - clock.now()) / HOUR;
    const inWindow = hoursLeft >= settings.cancellation.windowHours;
    const amountInr = b.depositInr!;
    await releaseSlot(b, "cancelled by the customer");
    b.reminders = [];
    b.pending = [];
    moveTo(b, "cancelled");
    log(b, phone, "cancel_booking", "confirmed", { hoursLeft: Math.floor(hoursLeft), inWindow });
    const limit = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: amountInr, inCancellationWindow: inWindow });
    if (limit.verdict === "allow" && (await refundPayment(b, b.depositPaymentId!, amountInr, [limit]))) {
      await tellCustomer(b, phone, ["cancelled_refund"], { refundInr: amountInr });
      return;
    }
    const reason = limit.verdict === "allow" ? "refund_failed" : inWindow ? "over_limit" : "late_cancellation";
    b.pending.push({ kind: "refund", amountInr, paymentId: b.depositPaymentId!, reason });
    log(b, phone, "refund", "held_for_owner", { paymentId: b.depositPaymentId, amountInr }, { decisions: [limit] });
    await tellCustomer(b, phone, [reason === "late_cancellation" ? "cancelled_late" : "cancelled_refund_pending"], { refundInr: amountInr });
    await tellOwner(b, phone, reason === "late_cancellation" ? "owner_late_cancellation" : "owner_refund_needs_approval", { refundInr: amountInr });
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
    const m = /^\s*(approve|deny|retry)\s+(b-\d+)\s*$/i.exec(msg.text);
    const b = m ? store.bookings.get(m[2].toLowerCase()) : undefined;
    const command = m?.[1].toLowerCase();
    const pending = b?.pending[0];
    log(b ?? null, owner, "owner_decision", "attempted", { command, ref: m?.[2] });
    if (!b || !command || !pending) {
      log(b ?? null, owner, "owner_decision", "blocked", { command }, { notes: "not a command for something waiting on the owner" });
      await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] });
      return;
    }

    if (pending.kind === "calendar") {
      if (command === "deny") { await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] }); return; }
      if (command === "retry") {
        log(b, owner, "owner_decision", "confirmed", { command });
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
      log(b, owner, "owner_decision", "confirmed", { command });
      if (await refundPayment(b, b.depositPaymentId!, amountInr, [limit])) await tellCustomer(b, b.customer, ["cancelled_refund"], { refundInr: amountInr });
      else b.pending.push({ kind: "refund", amountInr, paymentId: b.depositPaymentId!, reason: "refund_failed" });
      return;
    }

    if (command === "retry") { await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] }); return; }
    if (command === "deny") {
      b.pending.shift();
      log(b, owner, "owner_decision", "confirmed", { command }, { notes: "the owner declined the refund" });
      await tellCustomer(b, b.customer, ["refund_denied"]);
      return;
    }
    const limit = checkRefundLimit({ amountInr: pending.amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: pending.amountInr, ownerApproved: true });
    if (limit.verdict === "allow" && (await refundPayment(b, pending.paymentId, pending.amountInr, [limit]))) {
      b.pending.shift();
      log(b, owner, "owner_decision", "confirmed", { command });
      await tellCustomer(b, b.customer, ["refund_approved"], { refundInr: pending.amountInr });
    } else {
      log(b, owner, "owner_decision", "failed", { command }, { notes: "the refund did not go through" });
      await tellOwner(b, b.customer, "owner_refund_needs_approval", { refundInr: pending.amountInr });
    }
  }

  // ---- STOP --------------------------------------------------------------------------------------------------------

  async function onStop(phone: string): Promise<void> {
    customerOf(phone).optedOut = true;
    log(null, phone, "opt_out", "confirmed", { by: "STOP" }, { notes: "no more messages to this customer, not even a reply; any reminder that falls due is stopped by the limits" });
    await tellOwner(null, phone, "owner_opted_out");
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  async function onMessage(msg: InboundMessage): Promise<void> {
    if (store.seenMessages.has(msg.id)) {
      log(null, msg.from, "receive_message", "blocked", { id: msg.id }, { notes: `the same WhatsApp message (${msg.id}) was delivered again, so it is ignored` });
      return;
    }
    store.seenMessages.add(msg.id);
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
    const linkId = event.payload.payment_link?.id ?? event.payload.payment?.link_id;
    const b = bookings.find((x) => x.linkId === linkId);
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
    return onTick();
  }

  return { handle };
}
