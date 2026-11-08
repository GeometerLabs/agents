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
// The care that is the same for every template is in modules/: sending a message (messaging/say.ts), making a payment link (payments/links.ts), asking for a
// refund and following it through Guard's hold (payments/refunds.ts), and reading a message with the month's AI allowance (understanding/reader.ts).
// What is left here is Bookings: the calendar, the slot, the booking's states and its words.
import { checkConfirmOnlyWhenRecorded, checkMessageMatchesRecord, checkNoDoubleBooking, checkNoMessageAfterStop, checkOneDepositPerBooking, checkPriceAtOrAboveList, checkRefundLimit, checkWithinHours } from "./limits.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import { factsFor, latestBooking, moveTo, newDraft, register, reminderSchedule } from "./booking.ts";
import type { Booking, Store } from "./booking.ts";
import { RELAY_CODE_REPLY } from "../../../../modules/approvals/code.ts";
import { ApiError, ConflictError, TimeoutError } from "../../../../modules/core/faults.ts";
import type { Calendar, CalendarEvent } from "./adapters/calendar.ts";
import type { InboundMessage, Messaging } from "../../../../modules/messaging/messaging.ts";
import { createSay } from "../../../../modules/messaging/say.ts";
import { coerceIntent } from "./adapters/model.ts";
import type { CandidateSlot, Intent, IntentParser, ParseOptions } from "./adapters/model.ts";
import { bookingsReading } from "./adapters/reading.ts";
import { RULES } from "../../../../modules/understanding/model.ts";
import { createReader } from "../../../../modules/understanding/reader.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { PaymentEvent, PaymentLink, Payments } from "../../../../modules/payments/payments.ts";
import { ATTEMPTS, ensureLink as makeLink } from "../../../../modules/payments/links.ts";
import { createRefunds } from "../../../../modules/payments/refunds.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { takeDue } from "../../../../modules/reminders/reminders.ts";
import { resolveDate, resolveTime } from "../../../../modules/language/dates.ts";
import { templateMessage } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "./language/templates.ts";
import type { MessageFacts, TemplateId } from "./language/templates.ts";
import type { Action, ActionRecord, Outcome } from "../../../../modules/record/record.ts";
import { formatSlot } from "../../../../modules/language/format.ts";
import { checkFactsOf } from "./language/check.ts";
import { buttonsFor, intentFromReply, serviceList, slotList } from "./language/interactive.ts";
import type { ButtonId } from "./language/interactive.ts";
import type { InteractiveMessage } from "../../../../modules/language/interactive.ts";
import { hoursOn, serviceName } from "./settings.ts";
import type { Settings } from "./settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { HOUR, MINUTE, addDays, localParts, weekdayOf, zonedToMs } from "../../../../modules/core/time.ts";

export interface AgentDeps {
  settings: Settings;
  clock: Clock;
  calendar: Calendar;
  payments: Payments;
  messaging: Messaging;
  parser: IntentParser;
  record: ActionRecord;
  store: Store;
  /** The monthly AI allowance and the outside switch (modules/understanding/ai-state.ts). Left out: no limit, no switch; a model that fails still puts the agent in button mode for a few minutes. */
  ai?: AiPolicy;
}

export type AgentEvent =
  | { kind: "message"; message: InboundMessage } // a customer's (or the owner's) WhatsApp message
  | { kind: "payment_event"; event: PaymentEvent } // a Razorpay webhook
  // The approvals relay says what the owner decided about a refund Guard is holding. It carries no authority: Guard releases the refund
  // only if its own record says the owner approved, so a forged "approve" makes the agent ask Guard once more and nothing else.
  | { kind: "approval_decision"; approval: string; decision: "approve" | "deny"; id?: string }
  | { kind: "tick" }; // time has passed: let holds expire and send due reminders

export interface Agent { handle(event: AgentEvent): Promise<void> }


export function createAgent(deps: AgentDeps): Agent {
  const { settings, clock, calendar, payments, messaging, parser, record, store } = deps;
  const policy: AiPolicy = deps.ai ?? {};
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
   * What goes with a message to a customer as tappable buttons or a list (language/interactive.ts). The words above are still templates, and every row is
   * filled from the record: the shop's services and prices, or free times the calendar showed. Where buttons cannot be used (the customer's 24-hour window is
   * closed, the provider has none, or the provider refuses them) the same words go out as plain text instead, so nothing is lost.
   *  - services: the list of the shop's services (and a row to reach the owner)
   *  - slots:    the list of free times (and a row to reach the owner)
   *  - buttons:  up to three buttons
   * `body` is the templates that make the words above the options; left out, it is the message's own templates.
   */
  type Offer =
    | { kind: "services"; body?: TemplateId[] }
    | { kind: "slots"; slots: number[]; body?: TemplateId[] }
    | { kind: "buttons"; buttons: ButtonId[]; body?: TemplateId[] };

  function buildInteractive(offer: Offer, templates: TemplateId[], facts: MessageFacts, language: Language): InteractiveMessage {
    const body = (offer.body ?? templates).map((id) => render(id, facts)).join(" ");
    if (offer.kind === "services") return { body, list: serviceList(settings, language) };
    if (offer.kind === "slots") return { body, list: slotList(offer.slots, tz, language) };
    return { body, buttons: buttonsFor(language, offer.buttons) };
  }

  /**
   * The one way a message leaves the agent (modules/messaging/say.ts): it renders the templates from the record, runs the limits on the final text,
   * sends only if none blocks, and reads the message back from the messaging service. Returns whether it went out.
   * `shown` are decisions worth recording alongside the message (for example "price floor held") that do not gate it.
   * With an `offer`, the text the limits read is the whole message the customer will see: the words, then each option.
   * What is Bookings' own is given here: the facts, the offers, and the two gates (no reminder after a cancellation, "booked" only when recorded).
   */
  interface SayArgs { booking: Booking | null; phone: string; to: "customer" | "owner"; templates: TemplateId[]; refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean; action?: Action; offer?: Offer }
  const say = createSay<SayArgs, MessageFacts>({
    messaging,
    voice: {
      render: (id, facts) => render(id as TemplateId, facts),
      templateMessage: (a) => templateMessage({ ...a, ids: a.ids as TemplateId[] }),
      genericNames: TEMPLATE_NAMES,
      matches: (text, facts) => checkMessageMatchesRecord({ text, facts }),
    },
    owner: { whatsapp: owner, language: settings.owner.language },
    languageOf: (phone, booking) => languageOf(phone, booking),
    optedOut: (phone) => customerOf(phone).optedOut,
    factsFor: (a, language) => factsFor(settings, a.booking, language, { customerPhone: a.phone, refundInr: a.refundInr, slotMs: a.slotMs, menu: a.templates.includes("menu") || a.offer?.kind === "services", ...(a.offer?.kind === "slots" ? { slotChoices: a.offer.slots } : {}) }),
    interactiveFor: (a, facts, language) => buildInteractive(a.offer!, a.templates, facts, language),
    inputsOf: (a) => ({ refundInr: a.refundInr, slotMs: a.slotMs }),
    gates: (a, optedOut) => [
      ...(a.to === "customer" && a.reminder ? [checkNoMessageAfterStop({ isReminder: true, bookingConfirmed: a.booking?.state === "confirmed", customerOptedOut: optedOut })] : []),
      ...(a.booking && a.templates.includes("booked") ? [checkConfirmOnlyWhenRecorded({ record, booking: a.booking.id })] : []),
    ],
    log: (booking, phone, action, outcome, inputs, more) => log(booking, phone, action, outcome, inputs, more),
    heldBack: async (a) => { await say({ booking: a.booking, phone: a.phone, to: "owner", templates: ["owner_message_held"] }); },
  });

  const tellCustomer = (b: Booking | null, phone: string, templates: TemplateId[], more: { refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean; action?: Action; offer?: Offer } = {}) =>
    say({ booking: b, phone, to: "customer", templates, ...more });
  const tellOwner = (b: Booking | null, phone: string, template: TemplateId, more: { refundInr?: number; slotMs?: number } = {}) =>
    say({ booking: b, phone, to: "owner", templates: [template], ...more });

  // ---- what to offer: the shop's services, free times, and a few buttons ----------------------------------------------

  const OFFER_DAYS = 7; // free times are looked for a week ahead
  const OFFER_ROWS = 9; // a list holds ten rows, and the last is the row that reaches the owner

  /**
   * Up to nine start times the calendar shows free for this service in the next week, at most three a day (spread through the day), earliest first. Each is
   * on the shop's slot grid, inside its opening hours and clear of everything in the calendar, holds included: the same two rules a typed time must pass.
   * Empty when the calendar cannot be read, in which case the customer is asked to type a time, as before.
   */
  async function freeSlots(serviceId: string | undefined, limit = OFFER_ROWS): Promise<number[]> {
    const service = settings.services.find((x) => x.id === serviceId) ?? [...settings.services].sort((x, y) => x.durationMinutes - y.durationMinutes)[0];
    const now = clock.now();
    const today = localParts(now, tz);
    const grid = settings.slotMinutes;
    let events: CalendarEvent[];
    try { events = await calendar.conflicts(now - settings.bufferMinutes * MINUTE, now + (OFFER_DAYS + 2) * 24 * HOUR + settings.bufferMinutes * MINUTE); } catch { return []; }
    const others = events.map((e) => ({ start: e.start, end: e.end, bookingRef: e.bookingRef, tentativeUntil: e.status === "tentative" ? e.holdExpiresAt : undefined }));
    const out: number[] = [];
    for (let day = 0; day < OFFER_DAYS && out.length < limit; day++) {
      const date = addDays(today, day);
      const hours = hoursOn(settings, weekdayOf(date));
      if (!hours) continue;
      const free: number[] = [];
      for (let m = Math.ceil(hours.open / grid) * grid; m + service.durationMinutes <= hours.close; m += grid) {
        const startMs = zonedToMs(date, { hour: Math.floor(m / 60), minute: m % 60 }, tz);
        if (startMs <= now + settings.deposit.holdMinutes * MINUTE) continue; // the customer needs the hold's time to pay before it starts
        const clash = checkNoDoubleBooking({ startMs, endMs: startMs + service.durationMinutes * MINUTE, bufferMinutes: settings.bufferMinutes, ownBookingRef: "", nowMs: now, others });
        if (clash.verdict !== "block") free.push(startMs);
      }
      if (free.length === 0) continue; // a day that is full
      for (const i of new Set([0, Math.floor((free.length - 1) / 2), free.length - 1])) if (out.length < limit) out.push(free[i]);
    }
    return out.sort((x, y) => x - y);
  }

  /** The same free times as the decision model may pick from: each as the calendar date and the clock time a customer could have written. */
  async function candidateSlots(serviceId: string | undefined): Promise<CandidateSlot[]> {
    return (await freeSlots(serviceId, 6)).map((startMs) => {
      const p = localParts(startMs, tz);
      return { startMs, date: { kind: "calendar" as const, day: p.day, month: p.month }, time: { hour: p.hour % 12 === 0 ? 12 : p.hour % 12, minute: p.minute, period: p.hour < 12 ? "am" as const : "pm" as const }, label: formatSlot(startMs, tz, "en") };
    });
  }

  /** The list of free times under these words, or nothing when there are none (the customer is then asked to type a time). */
  async function slotsOffer(serviceId: string | undefined, body: TemplateId[]): Promise<Offer | undefined> {
    const slots = await freeSlots(serviceId);
    return slots.length > 0 ? { kind: "slots", slots, body } : undefined;
  }
  const servicesOffer = (body: TemplateId[]): Offer => ({ kind: "services", body });
  const yesNo = (body: TemplateId[]): Offer => ({ kind: "buttons", buttons: ["yes", "no"], body });
  const cancelOrOwner: Offer = { kind: "buttons", buttons: ["cancel", "owner"] };

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

  const ensureLink = (b: Booking) => makeLink(payments, { reference: b.id, amountPaise: depositPaise, description: `${settings.name} deposit` });

  // ---- refunds (modules/payments/refunds.ts) ---------------------------------------------------------------------------------
  //
  // A refund above the owner's limit is not decided here. The agent sends it like any other; Guard holds it (HTTP 202) and the approvals
  // relay asks the owner, once, with a code. The agent keeps the approval id and the exact bytes of the held call, and sends those same
  // bytes again only when the relay says the owner approved. Whatever Guard or the service answered, a refund that may have gone out is never sent again.

  const refunds = createRefunds<Booking>({
    payments, clock, owner,
    limitInr: () => settings.cancellation.refundLimitInr,
    log: (b, phone, action, outcome, inputs, more) => log(b, phone, action, outcome, inputs, more),
    tellCustomer: (b, phone, templates, more) => tellCustomer(b, phone, templates as TemplateId[], more),
    tellOwner: (b, phone, template, more) => tellOwner(b, phone, template as TemplateId, more),
    cases: () => store.bookings.values(),
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired", settled: "owner_refund_settled" },
  });
  const { requestRefund, overLimit } = refunds;
  const afterRefund = (b: Booking, result: Parameters<typeof refunds.afterRefund>[1], a: { paymentId: string; amountInr: number; done: { customer: TemplateId; owner?: TemplateId }; held: TemplateId }) => refunds.afterRefund(b, result, a);

  // ---- reading a message, what it cost, the monthly allowance and button mode (modules/understanding/reader.ts) -------------------

  const reader = createReader<Intent, { services: Settings["services"]; languages: Language[] }, ParseOptions>({
    parser, context: parseContext, coerce: coerceIntent, policy, store, clock, timeZone: tz,
    log: (action, outcome, inputs, more) => log(null, owner, action, outcome, inputs, more),
    tellOwner: async (notice) => { await say({ booking: null, phone: owner, to: "owner", templates: [notice === "allowance" ? "owner_ai_allowance" : notice === "override" ? "owner_ai_off" : "owner_ai_fault"] }); },
  });
  const { readIntent, understandingRefs, countUnderstood, announceButtonMode } = reader;

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
      const offer = template === "hold_failed" ? undefined : await slotsOffer(b.serviceId, [...prefix, template]); // another time to tap, when this one cannot be had
      await tellCustomer(b, phone, [...prefix, template], { slotMs, shown: [...shown, ...held.decisions], offer });
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
    await tellCustomer(b, phone, [...prefix, prefix.includes("price_floor") ? "slot_and_link" : "quote_and_link"], { shown: [...shown, ...held.decisions], offer: cancelOrOwner });
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
        await tellCustomer(waiting, phone, ["already_waiting"], { offer: cancelOrOwner });
        return;
      }
      await cancelWaiting(waiting, "replaced by a new request from the customer");
      b = register(store, probe);
    } else if (!b) {
      b = register(store, newDraft(phone, language));
    }
    b.language = language;
    if (!fill(b, intent)) { await tellCustomer(b, phone, ["didnt_understand"], { offer: servicesOffer(["didnt_understand"]) }); return; }
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

    if (!service) { await tellCustomer(b, phone, ["menu"], { shown, offer: servicesOffer(["pick_service"]) }); return; }
    if (b.startMs === undefined || b.endMs === undefined) { await tellCustomer(b, phone, [...prefix, "ask_when"], { shown, offer: await slotsOffer(b.serviceId, [...prefix, "pick_slot"]) }); return; }
    if (b.startMs <= clock.now()) {
      const slotMs = b.startMs;
      clearSlot(b);
      await tellCustomer(b, phone, [...prefix, "slot_unavailable"], { slotMs, shown, offer: await slotsOffer(b.serviceId, [...prefix, "slot_unavailable"]) });
      return;
    }
    if (b.dateNeedsConfirmation || b.timeInferred) {
      moveTo(b, "confirming_details");
      await tellCustomer(b, phone, [...prefix, "confirm_details"], { shown, offer: yesNo([...prefix, "confirm_buttons"]) });
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
    if (waiting) { await tellCustomer(waiting, phone, ["already_waiting"], { offer: cancelOrOwner }); return; }
    await tellCustomer(null, phone, ["didnt_understand"], { offer: servicesOffer(["didnt_understand"]) });
  }

  async function onNo(phone: string): Promise<void> {
    const moving = latestBooking(store, phone, ["confirmed"]);
    if (moving?.reschedule) { moving.reschedule = undefined; await tellCustomer(moving, phone, ["ask_new_time"]); return; }
    const b = latestBooking(store, phone, ["confirming_details"]);
    if (b) { clearSlot(b); moveTo(b, "enquiry"); await tellCustomer(b, phone, ["ask_when"], { offer: await slotsOffer(b.serviceId, ["pick_slot"]) }); return; }
    await tellCustomer(null, phone, ["didnt_understand"], { offer: servicesOffer(["didnt_understand"]) });
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
      await tellCustomer(b, b.customer, ["booked"], { offer: cancelOrOwner });
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

  /** The booking a "cancel" means: the paid one first, then one waiting for its owner or its deposit, then a draft. */
  const cancellable = (phone: string): Booking | undefined => latestBooking(store, phone, ["confirmed"]) ?? latestBooking(store, phone, ["needs_owner"]) ?? latestBooking(store, phone, ["awaiting_deposit"])
    ?? latestBooking(store, phone, ["confirming_details", "enquiry"]);

  /** The customer tapped "Cancel booking": nothing is cancelled yet. They are asked once, with Yes and No buttons; "Yes, cancel" is the same as typing cancel. */
  async function onCancelAsk(phone: string): Promise<void> {
    const b = cancellable(phone);
    if (!b || b.startMs === undefined) { await tellCustomer(b ?? null, phone, ["no_booking_found"], { offer: servicesOffer(["no_booking_found"]) }); return; }
    await tellCustomer(b, phone, ["ask_cancel"], { offer: { kind: "buttons", buttons: ["cancelYes", "keep"] } });
  }

  /** "No, keep it": the booking is left exactly as it was. */
  async function onKeep(phone: string): Promise<void> {
    const b = cancellable(phone);
    if (!b || b.startMs === undefined) { await tellCustomer(null, phone, ["didnt_understand"], { offer: servicesOffer(["didnt_understand"]) }); return; }
    await tellCustomer(b, phone, ["kept"]);
  }

  /**
   * "Talk to the owner": the owner is told, once an hour for the same customer, and the customer is told the owner will message them. The agent does not reply on the
   * owner's behalf and decides nothing. If the owner could not be told, the customer is told that, and not that the owner will write.
   */
  async function onTalkToOwner(phone: string): Promise<void> {
    const customer = customerOf(phone);
    const now = clock.now();
    const recently = customer.ownerAskedAtMs !== undefined && now - customer.ownerAskedAtMs < HOUR;
    let told = recently;
    if (!recently) {
      told = await tellOwner(null, phone, "owner_wants_to_talk");
      if (told) customer.ownerAskedAtMs = now;
    }
    log(null, phone, "ask_owner", told ? "confirmed" : "failed", { by: "button" }, { refs: { to: "owner" }, notes: recently ? "the owner was already told in the last hour, so not again" : told ? "the customer asked to talk to the owner, and the owner was told" : "the owner could not be told" });
    await tellCustomer(null, phone, [told ? "told_owner" : "couldnt_tell_owner"]);
  }

  async function onCancel(phone: string): Promise<void> {
    const b = cancellable(phone);
    if (!b || b.startMs === undefined) { await tellCustomer(b ?? null, phone, ["no_booking_found"], { offer: servicesOffer(["no_booking_found"]) }); return; }

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
    if (!b || b.startMs === undefined) { await tellCustomer(b ?? null, phone, ["no_booking_found"], { offer: servicesOffer(["no_booking_found"]) }); return; }
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
      await tellCustomer(b, phone, ["confirm_details"], { slotMs: start, offer: yesNo(["confirm_buttons"]) });
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
      await tellCustomer(b, b.customer, ["rescheduled"], { offer: cancelOrOwner });
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
    const mode = reader.mode();
    // A tap on a button or a list row is read by looking its id up: no words are read, so no model is asked, whatever the mode. An id that is none of ours is read as words.
    const tapped = msg.reply ? intentFromReply(msg.reply.id, settings) : null;
    const { intent, note, understood } = tapped
      ? { intent: tapped, note: undefined, understood: RULES }
      : await readIntent(msg.text, { rulesOnly: mode.buttons || customer.optedOut, slots: () => candidateSlots(latestBooking(store, phone, ["enquiry", "confirming_details"])?.serviceId) }); // an opted-out customer gets no reply, so no model is paid to read it
    countUnderstood(understood);
    if (intent.language && settings.languages.includes(intent.language)) customer.language = intent.language;
    const notes = [note, intent.overrideAttempt ? "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing" : undefined].filter(Boolean).join("; ");
    log(null, phone, "receive_message", "confirmed", { text: msg.text, id: msg.id, ...(tapped ? { reply: msg.reply!.id } : {}) }, { notes, refs: { messageId: msg.id, ...understandingRefs(understood, tapped ? msg.reply!.kind : undefined) } });

    try {
      if (intent.kind === "stop") return await onStop(phone);
      if (customer.optedOut) return; // STOP means STOP: nothing goes to them, even if they write again

      switch (intent.kind) {
        case "book": return await onBook(phone, intent);
        case "yes": return await onYes(phone);
        case "no": return await onNo(phone);
        case "cancel": return await (intent.ask ? onCancelAsk(phone) : onCancel(phone));
        case "reschedule": return await onReschedule(phone, intent);
        case "owner": return await onTalkToOwner(phone);
        case "keep": return await onKeep(phone);
        case "greeting": await tellCustomer(null, phone, ["menu"], { offer: servicesOffer(["pick_service"]) }); return;
        default: await tellCustomer(null, phone, ["didnt_understand"], { offer: servicesOffer(["didnt_understand"]) });
      }
    } finally {
      await announceButtonMode(); // after the customer has their answer
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
    await announceButtonMode(); // the outside switch can change between messages; the owner hears of it on the next beat
    await refunds.sweep(now); // refunds first, whatever state their booking is in (modules/payments/refunds.ts)
    for (const b of [...store.bookings.values()]) {
      if (b.state === "awaiting_deposit" && b.holdExpiresAt !== undefined && b.holdExpiresAt <= now) await expireHold(b);
      if (b.state !== "confirmed" || b.startMs === undefined || b.endMs === undefined) continue;

      // Reminders: if several fell due while nothing was running, send one, the latest. Whether it may go is the limits' call.
      if (takeDue(b.reminders, now).due && b.startMs > now) await tellCustomer(b, b.customer, ["reminder"], { reminder: true });

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
    if (event.kind === "approval_decision") return refunds.onApprovalDecision(event);
    return onTick();
  }

  return { handle };
}
