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
//
// What the shop's payment module can do decides every payment branch below, never its name (B71: modules/payments/providers). A module that cannot confirm a
// payment by itself (UPI, the default, plan B33) has no payment service the agent can read: the customer pays the shop directly, and the deposit counts only when the
// owner marks it received from their own number with a one-use code (modules/payments/owner-marked). The agent keeps those requests and marks in its own store, seen
// through the same Payments shape, and the owner's mark goes through the same reconcilePayments a gateway's webhook does, so "look first, write, read back" and
// "booked only when recorded" are one flow. What differs is in the functions marked "owner-marked" below: the deposit counts only when the owner has marked all of
// it; a mark after the hold ended never books by itself; and a module that cannot refund by itself never has the agent send one: the owner owes it, and the
// customer hears "sent" only after the owner marks it so.
//
// The licence (plan B13; modules/licence). While the shop's lease puts it in its WIND-DOWN, the agent takes no new work: a request to book is answered "online booking
// is paused, please contact the shop", no hold or deposit link is made, and nothing is kept to do later. Refunds owed, cancellations, reschedules of existing bookings,
// reminders of existing bookings and payments from links sent earlier go on as every day. In the FINAL STOP the agent also closes the open deposit links (where the
// module can cancel one) and sends nothing more; payments already made are still recorded and refunds still go through Guard. This is the runtime's own check of the
// lease: Guard's offline check (`subscription_suspended`) is not built yet.
import { checkConfirmOnlyWhenRecorded, checkMessageMatchesRecord, checkNoDoubleBooking, checkNoMessageAfterStop, checkOneDepositPerBooking, checkPriceAtOrAboveList, checkRefundLimit, checkWithinHours } from "./limits.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import type { BusyEvent } from "./limits.ts";
import { factsFor, latestBooking, moveTo, newDraft, register, reminderSchedule } from "./booking.ts";
import type { Booking, Pending, Store } from "./booking.ts";
import { isRelayReply } from "../../../../modules/approvals/buttons.ts"; // the relay's replies, typed or tapped (item 11e)
import { approverNumbers, ownerAsked } from "../../../../modules/approvals/people.ts";
import { HANDOVER_ACTION, handoverHash, parseHandoverReply } from "../../../../modules/approvals/handover.ts";
import { handleOwnerTerms } from "../../../../modules/terms/owner.ts";
import type { TermsFile } from "../../../../modules/terms/terms.ts";
import { GUARD_WAIT_ENTRY, RECOVERY_ENTRY, guardWaitLine } from "../../../../modules/unfinished/registry.ts";
import { ApiError, ConflictError, GuardSuspendedError, TimeoutError } from "../../../../modules/core/faults.ts";
import type { Calendar, CalendarEvent } from "./adapters/calendar.ts";
import type { InboundMessage, Messaging } from "../../../../modules/messaging/messaging.ts";
import { createSay } from "../../../../modules/messaging/say.ts";
import { detectLanguage } from "../../../../modules/understanding/rules.ts";
import { coerceIntent } from "./adapters/model.ts";
import type { CandidateSlot, Intent, IntentParser, ParseOptions } from "./adapters/model.ts";
import { bookingsReading } from "./adapters/reading.ts";
import { RULES } from "../../../../modules/understanding/model.ts";
import { createReader } from "../../../../modules/understanding/reader.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { PaymentEvent, PaymentRequest, Payments } from "../../../../modules/payments/payments.ts";
import { ATTEMPTS, ensureLink as makeLink } from "../../../../modules/payments/links.ts";
import { createRefunds, recheckLine } from "../../../../modules/payments/refunds.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { takeDue } from "../../../../modules/reminders/reminders.ts";
import { resolveDate, resolveTime } from "../../../../modules/language/dates.ts";
import { templateMessage } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "./language/templates.ts";
import type { MessageFacts, TemplateId } from "./language/templates.ts";
import type { Action, ActionRecord, Outcome } from "../../../../modules/record/record.ts";
import { formatInr, formatSlot } from "../../../../modules/language/format.ts";
import { checkFactsOf } from "./language/check.ts";
import { buttonsFor, intentFromReply, ownerMarkButtons, serviceList, slotList } from "./language/interactive.ts";
import type { Choice } from "../../../../modules/language/interactive.ts";
import { emptyMarkState, markReceived, markRefund, oweRefund, reminded, remindersDue, markedPayments } from "../../../../modules/payments/owner-marked/ledger.ts";
import type { OwedRefund, OwnerMark, MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { markButtonId, parseMarkReply } from "../../../../modules/payments/owner-marked/owner.ts";
import type { MarkReply } from "../../../../modules/payments/owner-marked/owner.ts";
import { MARK_ACTIONS } from "../../../../modules/payments/owner-marked/obligations.ts";
import { capabilitiesOf, ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import type { ButtonId } from "./language/interactive.ts";
import type { InteractiveMessage } from "../../../../modules/language/interactive.ts";
import { calendarModule, hoursOn, serviceName } from "./settings.ts";
import type { Settings } from "./settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { HOUR, MINUTE, addDays, localParts, weekdayOf, zonedToMs } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { LICENCE_RULE, UNRESTRICTED, guardLicenceDecision } from "../../../../modules/licence/rules.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { conversationOf } from "../../../../modules/channels/conversation.ts";
import { phoneDigits } from "../../../../modules/channels/contact.ts";
import { CHANNEL_LIMITS, DAY_MS, emptyChannelState } from "../../../../modules/channels/state.ts";
import type { ChannelState } from "../../../../modules/channels/state.ts";
import type { ChannelBook, ChannelEvent, OwnerAction } from "../../../../modules/channels/events.ts";
import { ownerItems } from "./channel.ts";
import type { Heard, VoiceService } from "../../../../modules/voice/voice.ts";
import { VOICE_WHY, createListener, failedMarks, voiceMarks } from "../../../../modules/voice/turn.ts";
import type { HeardOk } from "../../../../modules/voice/turn.ts";
import { isoDate } from "../../../../modules/assistant/conversation.ts";
import { assistantForAgent } from "../../../../modules/assistant/wire.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import { bookingsSkill } from "./assistant.ts";

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
  /**
   * An owner-marked shop: make the QR picture of its pay link and put it where WhatsApp can fetch it; its https address, or null (modules/payments/owner-marked/qr-image.ts). Left out,
   * or null, the customer gets the link, the UPI ID and the amount as text, which is enough to pay. Handed in, so the agent never loads node:zlib (the browser demo has none).
   */
  qrImage?: (text: string) => Promise<string | null>;
  /**
   * B29, voice notes: listens to a customer's voice note (speech to text); modules/voice. The agent always replies in text. Handed in, so the agent never loads a provider or
   * a node module. Left out: voice is off for this shop and a voice note gets the one line asking the customer to type, exactly as before.
   */
  voice?: VoiceService;
  /** The shop's licence right now (modules/licence; the runtime reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
  /** B72: the shop terms the owner can read and agree to on WhatsApp (modules/terms). Left out, or returning undefined: the feature is off for this shop. */
  terms?: () => TermsFile | undefined;
  /**
   * Item 11e: how the shop's assistant reads the owner's words (modules/assistant/reading.ts): the owner's router over the shop's model steps. Left out: the rules alone.
   * The assistant itself is on only when the settings have an "assistant" block.
   */
  ownerParser?: OwnerParser;
}

export type AgentEvent =
  | { kind: "message"; message: InboundMessage } // a customer's (or the owner's) WhatsApp message
  | { kind: "payment_event"; event: PaymentEvent } // a gateway's webhook, read by the inbox into the neutral events
  // The approvals relay says what the owner decided about a refund Guard is holding. It carries no authority: Guard releases the refund
  // only if its own record says the owner approved, so a forged "approve" makes the agent ask Guard once more and nothing else.
  | { kind: "approval_decision"; approval: string; decision: "approve" | "deny"; id?: string }
  // The panel's to-do list asks the agent to look again or ask again about one booking (modules/unfinished). It carries no authority: the agent does what it does every day, through Guard.
  | { kind: "recovery"; id: string; case: string; action: string }
  // Item 11d: the shop's booking page, its API or the MCP endpoint (a channel_request), or the owner's private page (an owner_action). modules/channels/events.ts.
  | ChannelEvent
  | { kind: "tick" }; // time has passed: let holds expire and send due reminders

export interface Agent {
  handle(event: AgentEvent): Promise<void>;
  /** Item 11d, a read: every free start of one service, day by day, from a date (today when left out), for the booking page and its API. Throws when the calendar cannot be read. */
  freeStarts(serviceId: string, fromDate: LocalDate | undefined, days: number): Promise<{ date: string; starts: number[] }[]>;
  /** The wait for a Guard is over and this event's work is not done (modules/runtime/guard-wait.ts). With `tell`, the customer also gets the shop's words for it. */
  giveUp(event: AgentEvent, why: { service: string; tell: boolean }): Promise<void>;
}

/** "I paid", in the shop's four languages: on a UPI shop with a deposit waiting it asks the owner to look. It never marks anything paid. */
/** A "no" in the same message ("I have not paid yet") makes it not a claim. */
const NOT_PAID = /\b(?:not|haven'?t|hasn'?t|didn'?t|nahi|nahin|illa)\b|n't\b|नहीं|नही|ഇല്ല|അല്ല|ಇಲ್ಲ|ಆಗಿಲ್ಲ/iu;
const PAID_CLAIM = /\b(?:paid|i have paid|payment done|sent the money|money sent|transferred)\b|पेमेंट कर दिया|भुगतान कर दिया|पैसे भेज दिए|पैसे भेजे|भेज दिया|പണം അടച്ചു|അടച്ചു|പണം അയച്ചു|ಪಾವತಿಸಿದ್ದೇನೆ|ಹಣ ಕಳುಹಿಸಿದ್ದೇನೆ|ಪಾವತಿ ಮಾಡಿದ್ದೇನೆ/iu;


/** What the owner's marks on a booking's request came to: booked in full, a part, after the hold, beyond the deposit, or nothing new. */
type MarkOutcome = "booked" | "part" | "late" | "extra" | "none";

export function createAgent(deps: AgentDeps): Agent {
  const { settings, clock, calendar, messaging, parser, record, store } = deps;
  // B71: what the payment module can do, asked once. A module that cannot confirm a payment by itself is marked paid by the owner: the requests and the owner's
  // marks live in this agent's own store (its `upi` key, as it always was) and are read through the same Payments shape as a gateway's, and deps.payments is never
  // called. One that cannot refund by itself has the owner pay refunds back, tracked in the same store.
  const can = capabilitiesOf(settings.payment);
  const ownerConfirms = !can.confirmsAutomatically;
  const ownerRefunds = !can.refundsAutomatically;
  const marked = ownerMarkedOf(settings.payment);
  if (ownerConfirms && !marked) throw new Error("This payment module cannot confirm a payment by itself and says no way for the owner to be paid: it cannot run.");
  const markState = ownerConfirms || ownerRefunds ? (store.upi ??= emptyMarkState()) : undefined;
  const payments: Payments = ownerConfirms ? markedPayments(markState!, marked!.payLink, clock) : deps.payments;
  const policy: AiPolicy = deps.ai ?? {};
  const licence = deps.licence ?? (() => UNRESTRICTED);
  const tz = settings.timezone;
  const owner = settings.owner.whatsapp;
  // B37: with other approvers, a refund the owner's own command asks for names the owner (Geo-Requested-By), and the others' code replies are the relay's
  const askedByOwner = ownerAsked(settings.approvers);
  const approverDigits = approverNumbers(settings.approvers);
  const parseContext = { services: settings.services, languages: settings.languages };
  const depositPaise = settings.deposit.amountInr * 100;

  const serviceOf = (b: Booking) => settings.services.find((s) => s.id === b.serviceId);
  const customerOf = (phone: string) => {
    let c = store.customers.get(phone);
    if (!c) { c = { phone, optedOut: false }; store.customers.set(phone, c); }
    return c;
  };
  const languageOf = (phone: string, b?: Booking | null) => b?.language ?? store.customers.get(phone)?.language ?? settings.languages[0];
  /** The number a message names for this conversation: a channel booking's is the one its customer typed (item 11d), never its "web:..." conversation. */
  const shownPhone = (phone: string, b: Booking | null): string => (b?.channel && b.contact ? b.contact.phone : phone);
  /** Item 11e: the dates the owner closed through the shop's assistant; the free times and the within-hours limit leave them out. */
  const closedDays = (): readonly string[] => store.assistant?.closedDays ?? [];

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
    | { kind: "buttons"; buttons: ButtonId[]; body?: TemplateId[] }
    // the owner's UPI buttons ("Received ₹200", "Refund sent"), each carrying its one-use code
    | { kind: "owner_upi"; choices: Choice[]; body?: TemplateId[] };

  function buildInteractive(offer: Offer, templates: TemplateId[], facts: MessageFacts, language: Language): InteractiveMessage {
    const body = (offer.body ?? templates).map((id) => render(id, facts)).join(" ");
    if (offer.kind === "services") return { body, list: serviceList(settings, language) };
    if (offer.kind === "slots") return { body, list: slotList(offer.slots, tz, language) };
    if (offer.kind === "owner_upi") return { body, buttons: offer.choices };
    return { body, buttons: buttonsFor(language, offer.buttons) };
  }

  /**
   * The one way a message leaves the agent (modules/messaging/say.ts): it renders the templates from the record, runs the limits on the final text,
   * sends only if none blocks, and reads the message back from the messaging service. Returns whether it went out.
   * `shown` are decisions worth recording alongside the message (for example "price floor held") that do not gate it.
   * With an `offer`, the text the limits read is the whole message the customer will see: the words, then each option.
   * What is Bookings' own is given here: the facts, the offers, and the two gates (no reminder after a cancellation, "booked" only when recorded).
   */
  interface SayArgs { booking: Booking | null; phone: string; to: "customer" | "owner"; templates: TemplateId[]; refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean; action?: Action; offer?: Offer; image?: { link: string; caption: TemplateId[] }; upiCode?: string; markedInr?: number; leftInr?: number; day?: "today" | "tomorrow"; dayBookings?: MessageFacts["dayBookings"] }
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
    factsFor: (a, language) => factsFor(settings, a.booking, language, { customerPhone: shownPhone(a.phone, a.booking), refundInr: a.refundInr, slotMs: a.slotMs, menu: a.templates.includes("menu") || a.offer?.kind === "services", ...(a.offer?.kind === "slots" ? { slotChoices: a.offer.slots } : {}), upiCode: a.upiCode, markedInr: a.markedInr, leftInr: a.leftInr, day: a.day, dayBookings: a.dayBookings }),
    interactiveFor: (a, facts, language) => buildInteractive(a.offer!, a.templates, facts, language),
    inputsOf: (a) => ({ refundInr: a.refundInr, slotMs: a.slotMs, ...(a.markedInr !== undefined ? { markedInr: a.markedInr } : {}) }), // never the owner's code
    gates: (a, optedOut) => [
      ...(a.to === "customer" && a.reminder ? [checkNoMessageAfterStop({ isReminder: true, bookingConfirmed: a.booking?.state === "confirmed", customerOptedOut: optedOut })] : []),
      ...(a.booking && (a.templates.includes("booked") || a.templates.includes("upi_booked")) ? [checkConfirmOnlyWhenRecorded({ record, booking: a.booking.id, ...(ownerConfirms ? { depositPaise } : {}) })] : []),
      ...(licence().state === "stopped" ? [stoppedGate] : []),
    ],
    log: (booking, phone, action, outcome, inputs, more) => log(booking, phone, action, outcome, inputs, more),
    heldBack: async (a) => { await say({ booking: a.booking, phone: a.phone, to: "owner", templates: ["owner_message_held"] }); },
  });

  const tellCustomer = (b: Booking | null, phone: string, templates: TemplateId[], more: { refundInr?: number; slotMs?: number; shown?: Decision[]; reminder?: boolean; action?: Action; offer?: Offer; image?: SayArgs["image"]; markedInr?: number } = {}) =>
    say({ booking: b, phone, to: "customer", templates, ...more });
  const tellOwner = (b: Booking | null, phone: string, template: TemplateId, more: { refundInr?: number; slotMs?: number; offer?: Offer; upiCode?: string; markedInr?: number; leftInr?: number } = {}) =>
    say({ booking: b, phone, to: "owner", templates: [template], ...more });

  // ---- what to offer: the shop's services, free times, and a few buttons ----------------------------------------------

  // B72: a shop with no Google Calendar keeps its bookings in its own list (the runtime hands in src/adapters/own-calendar.ts). "booked" then means the shop's own record holds it.
  const ownList = calendarModule(settings) === "own";
  const OFFER_DAYS = 7; // free times are looked for a week ahead
  const OFFER_ROWS = 9; // a list holds ten rows, and the last is the row that reaches the owner

  /** A calendar event as the double-booking limit reads it: a tentative event (a hold) stops blocking when its hold ends. */
  const busyOf = (e: CalendarEvent): BusyEvent => ({ start: e.start, end: e.end, bookingRef: e.bookingRef, tentativeUntil: e.status === "tentative" ? e.holdExpiresAt : undefined });

  /**
   * The times the shop's own bookings hold, read from the bookings themselves (11 Nov, the last slot): the shop's own saved state is the authority for its holds, the way
   * Orders works its stock out from its orders. The calendar is still read, for what others put there, but its list can lag a write, or miss a hold whose write did not
   * land, and Google never refuses an overlapping event. One message is handled at a time (modules/runtime/tasks.ts), so this look and the hold a step makes are never
   * split by another customer's step. Which bookings hold a time: one waiting for its deposit, until its hold ends (an unpaid hold expires by itself); one waiting for
   * the owner (the deposit is in and the calendar would not confirm it) and a confirmed one, until they are cancelled or done. `exceptId`: the booking asking.
   */
  function heldByBookings(exceptId: string): BusyEvent[] {
    const held: BusyEvent[] = [];
    for (const x of store.bookings.values()) {
      if (x.id === exceptId || x.startMs === undefined || x.endMs === undefined) continue;
      if (x.state === "awaiting_deposit" && x.holdExpiresAt !== undefined) held.push({ start: x.startMs, end: x.endMs, bookingRef: x.id, tentativeUntil: x.holdExpiresAt });
      else if (x.state === "needs_owner" || x.state === "confirmed") held.push({ start: x.startMs, end: x.endMs, bookingRef: x.id });
    }
    return held;
  }

  /**
   * Every start time on the shop's slot grid, on one day, that is free for this service: inside its opening hours, clear of everything in the calendar and of the shop's
   * own holds (the same two rules a typed time must pass), and far enough ahead that the customer has the hold's time to pay. `others` is what is busy (calendar and holds).
   * The one place free times are worked out: WhatsApp's list (freeSlots) and the booking page and its API (freeStarts, item 11d) both use it, so a day the owner
   * closed (item 11e) is left out of all of them at once.
   */
  function freeOnDay(service: Settings["services"][number], date: LocalDate, others: BusyEvent[], now: number): number[] {
    const hours = hoursOn(settings, weekdayOf(date));
    // item 11e: a date the owner closed through the assistant has no free time anywhere: WhatsApp's list, the booking page, its API and MCP all read this one function
    if (!hours || closedDays().includes(isoDate(date))) return [];
    const grid = settings.slotMinutes;
    const free: number[] = [];
    for (let m = Math.ceil(hours.open / grid) * grid; m + service.durationMinutes <= hours.close; m += grid) {
      const startMs = zonedToMs(date, { hour: Math.floor(m / 60), minute: m % 60 }, tz);
      if (startMs <= now + settings.deposit.holdMinutes * MINUTE) continue; // the customer needs the hold's time to pay before it starts
      const clash = checkNoDoubleBooking({ startMs, endMs: startMs + service.durationMinutes * MINUTE, bufferMinutes: settings.bufferMinutes, ownBookingRef: "", nowMs: now, others });
      if (clash.verdict !== "block") free.push(startMs);
    }
    return free;
  }

  /** What is busy from `from` to `to`: the calendar's events and the shop's own holds. Throws when the calendar cannot be read. */
  async function busyBetween(from: number, to: number): Promise<BusyEvent[]> {
    const events = await calendar.conflicts(from - settings.bufferMinutes * MINUTE, to + settings.bufferMinutes * MINUTE);
    // the shop's own holds as well as the calendar's, so the list never offers a time a booking here already holds (the same two sources as slotRules)
    return [...events.map(busyOf), ...heldByBookings("")];
  }

  /**
   * Up to nine start times the calendar shows free for this service in the next week, at most three a day (spread through the day), earliest first. Each is
   * on the shop's slot grid, inside its opening hours and clear of everything in the calendar, holds included: the same two rules a typed time must pass.
   * Empty when the calendar cannot be read, in which case the customer is asked to type a time, as before.
   */
  async function freeSlots(serviceId: string | undefined, limit = OFFER_ROWS): Promise<number[]> {
    const service = settings.services.find((x) => x.id === serviceId) ?? [...settings.services].sort((x, y) => x.durationMinutes - y.durationMinutes)[0];
    const now = clock.now();
    const today = localParts(now, tz);
    let others: BusyEvent[];
    try { others = await busyBetween(now, now + (OFFER_DAYS + 2) * 24 * HOUR); } catch { return []; }
    const out: number[] = [];
    for (let day = 0; day < OFFER_DAYS && out.length < limit; day++) {
      const free = freeOnDay(service, addDays(today, day), others, now);
      if (free.length === 0) continue; // a day that is full, or closed
      for (const i of new Set([0, Math.floor((free.length - 1) / 2), free.length - 1])) if (out.length < limit) out.push(free[i]);
    }
    return out.sort((x, y) => x - y);
  }

  /**
   * Item 11d: every free start time of one service, day by day, for the booking page and its API. The same rules and the same sources as WhatsApp's list (freeOnDay);
   * a read only, so a time shown here is still checked again when the booking is made (tryHold). Throws when the calendar cannot be read: the page says so.
   */
  async function freeStarts(serviceId: string, fromDate: LocalDate | undefined, days: number): Promise<{ date: string; starts: number[] }[]> {
    const service = settings.services.find((x) => x.id === serviceId);
    if (!service) return [];
    const now = clock.now();
    const today = localParts(now, tz);
    const first = fromDate && zonedToMs(fromDate, { hour: 0, minute: 0 }, tz) > zonedToMs(today, { hour: 0, minute: 0 }, tz) ? fromDate : today;
    const firstMs = zonedToMs(first, { hour: 0, minute: 0 }, tz);
    const lastAllowed = now + CHANNEL_LIMITS.daysAhead * 24 * HOUR;
    const others = await busyBetween(Math.max(now, firstMs), firstMs + (days + 1) * 24 * HOUR);
    const out: { date: string; starts: number[] }[] = [];
    for (let day = 0; day < days; day++) {
      const date = addDays(first, day);
      if (zonedToMs(date, { hour: 0, minute: 0 }, tz) > lastAllowed) break;
      out.push({ date: `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`, starts: freeOnDay(service, date, others, now).filter((t) => t <= lastAllowed) });
    }
    return out;
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
  /** A UPI shop's customer, while their deposit waits: "I have paid" (the owner is asked to look; nothing is marked paid), cancel, or talk to the owner. */
  const paidCancelOrOwner: Offer = { kind: "buttons", buttons: ["paid", "cancel", "owner"] };
  const waitingOffer = (): Offer => (ownerConfirms ? paidCancelOrOwner : cancelOrOwner);

  // ---- the calendar: look first, write, read back ------------------------------------------------------------------

  interface Wanted { start: number; end: number; status: "tentative" | "confirmed" }

  /** Make the calendar show this booking's event as wanted. Returns the event only if the calendar's own list shows it. */
  async function ensureEvent(b: Booking, want: Wanted): Promise<{ event: CalendarEvent | null; error?: string; conflict?: boolean; suspended?: GuardSuspendedError }> {
    const matches = (e: CalendarEvent) => e.start === want.start && e.end === want.end && e.status === want.status;
    const holdExpiresAt = want.status === "tentative" ? b.holdExpiresAt : undefined;
    let error: string | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const before = await calendar.list({ bookingRef: b.id }); // look first: an earlier try (a lost reply) may have landed
        const found = before.find(matches);
        if (found) {
          // A rerun after a wait for a Guard finds the hold its first try left. The booking's hold has a new end now, and the calendar must show the same one: other customers
          // are kept out of this time only until the end written there.
          if (want.status === "tentative" && found.holdExpiresAt !== holdExpiresAt) await calendar.update(found.id, { start: want.start, end: want.end, status: want.status, holdExpiresAt });
          return { event: found };
        }
        if (before[0]) await calendar.update(before[0].id, { start: want.start, end: want.end, status: want.status, holdExpiresAt });
        else await calendar.insert({ summary: `${serviceOf(b)?.id ?? "booking"} · ${b.customer}`, start: want.start, end: want.end, status: want.status, bookingRef: b.id, holdExpiresAt });
        const after = (await calendar.list({ bookingRef: b.id })).find(matches); // read back from the calendar's own list
        if (after) return { event: after };
      } catch (e) {
        if (e instanceof ConflictError) return { event: null, error: e.message, conflict: true };
        if (e instanceof GuardSuspendedError) return { event: null, error: e.message, suspended: e }; // Guard held it back for the licence: nothing was sent, never tried again
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
    // the confirmation after an unknown outcome is kept until WhatsApp accepts it, so the shared code needs to know how the send ended, not only whether it was read back
    tellCustomerOutcome: (b, phone, template, more) => say.outcome({ booking: b, phone, to: "customer", templates: [template as TemplateId], ...more }),
    tellOwner: (b, phone, template, more) => tellOwner(b, phone, template as TemplateId, more),
    cases: () => store.bookings.values(),
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired", settled: "owner_refund_settled", confirmed: "refund_confirmed" },
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

  // ---- owner-marked: paid when the owner marks it (B33; modules/payments/owner-marked) -------------------------------------------
  //
  // The customer pays the shop's own UPI ID. The agent cannot see that payment; the owner can, in their UPI app. So the deposit counts only when the owner marks
  // it received, from their own number, with the one-use code the agent sent only to them. A screenshot, a "paid" button or the words "I paid" ask the owner to look,
  // and mark nothing. A refund is never sent by the agent: the owner owes it, is reminded, and the customer hears "sent" only after the owner marks it so.

  const requestOf = (b: Booking): MarkedRequest | undefined => markState?.requests.find((r) => r.id === b.linkId);
  const receivedButtons = (request: MarkedRequest, amountPaise: number): Offer | undefined =>
    request.code ? { kind: "owner_upi", choices: ownerMarkButtons(settings.owner.language, { kind: "received", code: request.code, amountInr: amountPaise / 100 }) } : undefined;
  const refundButtons = (r: OwedRefund): Offer | undefined =>
    r.code ? { kind: "owner_upi", choices: ownerMarkButtons(settings.owner.language, { kind: "refund", code: r.code, keepAllowed: r.keepAllowed === true }) } : undefined;
  /** The QR picture of the request's link, made once (best effort: without it the words carry the link, the UPI ID and the amount). */
  async function qrOf(request: MarkedRequest): Promise<SayArgs["image"]> {
    if (request.imageLink === undefined && deps.qrImage) request.imageLink = (await deps.qrImage(request.link).catch(() => null)) ?? undefined;
    return request.imageLink ? { link: request.imageLink, caption: ["upi_qr_caption"] } : undefined;
  }

  /** The request is made: put it in the record, send the customer the QR and the words, and tell the owner what to look for, with the code and the button. */
  async function sendMarkedRequest(b: Booking, prefix: TemplateId[], shown: Decision[]): Promise<void> {
    const request = requestOf(b)!;
    if (!record.confirmedRefs(b.id, MARK_ACTIONS.request, "requestId").includes(request.id)) {
      log(b, b.customer, MARK_ACTIONS.request, "confirmed", { amountPaise: request.amountPaise }, { refs: { requestId: request.id, reference: b.id, amountPaise: String(request.amountPaise) }, notes: "a UPI request to the shop's own UPI ID; it counts as paid only when the owner marks it received" });
    }
    await tellCustomer(b, b.customer, [...prefix, prefix.includes("price_floor") ? "upi_slot_and_link" : "upi_quote_and_link"], { shown, offer: paidCancelOrOwner, image: b.channel ? undefined : await qrOf(request) }); // a booking page draws its own QR
    await tellOwner(b, b.customer, "owner_upi_expected", { upiCode: request.code ?? undefined, offer: receivedButtons(request, request.amountPaise) });
  }

  async function tellAlreadyWaiting(waiting: Booking): Promise<void> {
    const request = ownerConfirms ? requestOf(waiting) : undefined;
    if (!request) { await tellCustomer(waiting, waiting.customer, ["already_waiting"], { offer: cancelOrOwner }); return; }
    await tellCustomer(waiting, waiting.customer, ["upi_already_waiting"], { offer: paidCancelOrOwner, image: waiting.channel ? undefined : await qrOf(request) });
  }

  /**
   * The owner's marks on this booking's request, not counted yet. Each is recorded as "marked paid by owner". The deposit counts once the marks add up to all of it;
   * less, and the slot stays held and the owner is asked for the rest; more, and the extra is owed back. A mark after the hold ended (or the booking was cancelled)
   * never books by itself: the owner and the builder are told, and the money is owed back unless the owner books the customer by hand.
   */
  async function reconcileMarks(b: Booking): Promise<MarkOutcome> {
    const request = requestOf(b);
    if (!request) return "none";
    const fresh = request.marks.filter((m) => !b.handledPayments.includes(m.id));
    if (fresh.length === 0) return "none";
    for (const m of fresh) {
      b.handledPayments.push(m.id);
      log(b, b.customer, MARK_ACTIONS.marked, "confirmed", { requestId: request.id, amountPaise: m.amountPaise }, {
        refs: { paymentId: m.id, requestId: request.id, amountPaise: String(m.amountPaise), markedBy: "owner" },
        notes: m.afterClose ? "marked received by the owner after the request was closed: it does not book by itself" : "marked paid by owner: from the owner's own number, with a one-use code",
      });
    }
    const freshPaise = fresh.reduce((n, m) => n + m.amountPaise, 0);
    const last = fresh.at(-1)!;
    if (b.depositPaymentId) { // the deposit was already whole: this is money beyond it
      await oweBack(b, last.id, freshPaise, "marked received beyond the deposit", { customer: "upi_extra_refund_owed" });
      return "extra";
    }
    if (b.state !== "awaiting_deposit" && b.state !== "needs_owner") { await lateMark(b, last, freshPaise); return "late"; }
    const total = request.marks.reduce((n, m) => n + m.amountPaise, 0);
    if (total < depositPaise) {
      // not the whole deposit: not booked, the hold stays, and the owner is asked for the rest (a new code; the used one counts nothing again)
      log(b, b.customer, "upi_deposit_part", "held_for_owner", { requestId: request.id, markedPaise: total }, { refs: { requestId: request.id, amountPaise: String(total) }, notes: `the owner marked ${formatInr(total / 100)} of the ${formatInr(depositPaise / 100)} deposit: not booked; the hold stays until it ends` });
      await tellOwner(b, b.customer, "owner_upi_part", { markedInr: total / 100, leftInr: (depositPaise - total) / 100, upiCode: request.code ?? undefined, offer: receivedButtons(request, depositPaise - total) });
      return "part";
    }
    b.depositPaymentId = last.id;
    b.depositInr = settings.deposit.amountInr;
    if (total > depositPaise) await oweBack(b, last.id, total - depositPaise, "marked received beyond the deposit", { customer: "upi_extra_refund_owed" });
    await completeBooking(b);
    return total > depositPaise ? "extra" : "booked";
  }

  /** A mark after the hold ended (or after the booking was cancelled): recorded as received, never booked again by itself. The owner and the builder are told. */
  async function lateMark(b: Booking, mark: OwnerMark, amountPaise: number): Promise<void> {
    const expired = b.state === "expired";
    (b.refundIssues ??= []).push({ paymentId: mark.id, kind: "late_upi", atMs: clock.now(), note: `The owner marked ${formatInr(amountPaise / 100)} received for ${b.id} after its ${expired ? "hold had ended" : "cancellation"}. It was not booked again by itself; the owner owes it back${expired ? " or books the customer by hand" : ""}.` });
    if (!expired) { await oweBack(b, mark.id, amountPaise, "marked received after the booking was cancelled", { customer: "upi_refund_owed" }); return; }
    await oweBack(b, mark.id, amountPaise, "marked received after the hold had ended: not booked again by itself", { customer: "upi_late_received", ownerTemplate: "owner_upi_late", keepAllowed: true, markedInr: amountPaise / 100 });
  }

  /** A refund the owner owes: recorded, the customer told it will come from the owner, the owner told what to send, with the code. The agent never sends it. */
  async function oweBack(b: Booking, paymentId: string, amountPaise: number, why: string, o: { customer: TemplateId; ownerTemplate?: TemplateId; keepAllowed?: boolean; markedInr?: number; decisions?: Decision[] }): Promise<OwedRefund> {
    const r = oweRefund(markState!, { caseId: b.id, customer: b.customer, paymentId, amountPaise, why, keepAllowed: o.keepAllowed }, clock.now());
    log(b, b.customer, MARK_ACTIONS.refundOwed, "held_for_owner", { paymentId, amountPaise }, { decisions: o.decisions, refs: { refundId: r.id, paymentId, amountPaise: String(amountPaise) }, notes: `owed back by the owner, who sends it from their own UPI app (${why}); the agent never sends it and tracks it until the owner marks it done` });
    const refundInr = amountPaise / 100;
    await tellCustomer(b, b.customer, [o.customer], { refundInr, markedInr: o.markedInr });
    await tellOwner(b, b.customer, o.ownerTemplate ?? "owner_upi_refund_owed", { refundInr, upiCode: r.code ?? undefined, markedInr: o.markedInr, offer: refundButtons(r) });
    return r;
  }

  /** "I have paid", the words, or a screenshot: thanks, the owner will confirm, a screenshot is not proof. The owner is asked to look, at most once an hour per booking. */
  async function onPaidClaim(phone: string, via: "button" | "words" | "screenshot"): Promise<void> {
    const b = latestBooking(store, phone, ["awaiting_deposit"]);
    const request = b ? requestOf(b) : undefined;
    if (!b || !request) {
      log(null, phone, MARK_ACTIONS.claim, "blocked", { claim: "paid", via }, { notes: "the customer says they paid, and no UPI deposit is waiting for them; nothing is marked paid", refs: { to: "owner", via } });
      await tellCustomer(null, phone, ["upi_nothing_waiting"], { offer: { kind: "buttons", buttons: ["owner"] } });
      return;
    }
    await tellCustomer(b, phone, ["upi_paid_claim"]);
    const now = clock.now();
    const recently = b.claimTellAtMs !== undefined && now - b.claimTellAtMs < HOUR;
    let told = recently;
    if (!recently && request.code) { told = await tellOwner(b, phone, "owner_upi_claim", { upiCode: request.code, offer: receivedButtons(request, depositPaise - request.marks.reduce((n, m) => n + m.amountPaise, 0)) }); if (told) b.claimTellAtMs = now; }
    log(b, phone, MARK_ACTIONS.claim, told ? "confirmed" : "failed", { claim: "paid", via }, { refs: { to: "owner", via, requestId: request.id }, notes: `the customer says they paid (${via === "screenshot" ? "a screenshot, which is not proof" : via === "button" ? "the I have paid button" : "in words"}); nothing is marked paid until the owner marks it${recently ? "; the owner was already asked in the last hour" : ""}` });
  }

  /** A picture from a customer. It is never looked at or kept. On a UPI shop it is read as "I paid" (a screenshot is not proof); a shop whose gateway confirms by itself answers nothing, as before. */
  async function onPicture(msg: InboundMessage): Promise<void> {
    const phone = msg.from;
    log(null, phone, "receive_message", "confirmed", { image: true, id: msg.id }, { notes: "a picture: it is not looked at and nothing of it is kept; a picture is never proof of a payment", refs: { messageId: msg.id } });
    if (!ownerConfirms || customerOf(phone).optedOut) return;
    await onPaidClaim(phone, "screenshot");
  }

  /** The owner's UPI reply: a mark of money received, or a refund marked sent (or kept). A code is used once; the same reply again counts nothing. */
  async function onOwnerMark(reply: MarkReply, msg: InboundMessage): Promise<void> {
    const now = clock.now();
    const quietly = (outcome: "already" | "unknown", notes: string) => {
      log(null, owner, "upi_owner_reply", "blocked", { kind: reply.kind, id: msg.id }, { notes, refs: { command: reply.kind } });
      return say({ booking: null, phone: owner, to: "owner", templates: [outcome === "already" ? "owner_upi_already" : "owner_upi_unknown"] });
    };
    if (reply.kind === "received") {
      const result = markReceived(markState!, reply.code, reply.amountPaise, now);
      if (result.kind === "already" || result.kind === "already_refund") { await quietly("already", "a code that was already used: the payment is counted once"); return; }
      if (result.kind !== "marked") { await quietly("unknown", result.kind === "bad_amount" ? "an amount that cannot be right for this payment" : "a code the agent never issued"); return; }
      const b = store.bookings.get(result.request.reference);
      if (!b) { await quietly("unknown", "no booking has this request"); return; }
      const outcome = await reconcilePayments(b); // the same flow a gateway's webhook takes
      if (outcome === "booked" || outcome === "extra") await tellOwner(b, b.customer, "owner_upi_marked", { markedInr: result.mark.amountPaise / 100 });
      return;
    }
    const result = markRefund(markState!, reply.code, reply.kind === "kept" ? "kept" : "done", now);
    if (result.kind === "already") { await quietly("already", "a refund code that was already used"); return; }
    if (result.kind !== "done" && result.kind !== "kept") { await quietly("unknown", result.kind === "not_allowed" ? "keeping this money was not offered" : "a code the agent never issued"); return; }
    const r = result.refund;
    const b = store.bookings.get(r.caseId) ?? null;
    const refs = { refundId: r.id, paymentId: r.paymentId, amountPaise: String(r.amountPaise) };
    if (result.kind === "kept") {
      log(b, r.customer, MARK_ACTIONS.refundKept, "confirmed", { refundId: r.id }, { refs, notes: "the owner keeps this money for a booking they make by hand: nothing is owed back" });
      await tellOwner(b, r.customer, "owner_upi_refund_kept", { refundInr: r.amountPaise / 100 });
      return;
    }
    log(b, r.customer, MARK_ACTIONS.refundDone, "confirmed", { refundId: r.id }, { refs, notes: "the owner marked the refund sent from their UPI app; only now is the customer told it was sent" });
    await tellCustomer(b, r.customer, ["upi_refund_sent"], { refundInr: r.amountPaise / 100 });
    await tellOwner(b, r.customer, "owner_upi_refund_marked", { refundInr: r.amountPaise / 100 });
  }

  /**
   * The unfinished-work list (B31) asks the owner again about a UPI booking: each refund still owed (the reminder, with its code and button), and a deposit the owner
   * has not finished confirming (the part still to come, or the customer's "I paid"). False when there is nothing UPI to ask about, so the usual asks are tried.
   */
  async function markAskAgain(b: Booking, note: (outcome: Outcome, notes: string) => unknown): Promise<boolean> {
    const owed = markState!.refunds.filter((r) => r.caseId === b.id && r.state === "owed" && r.code);
    const request = requestOf(b);
    const open = request && request.code && (request.status === "created" || request.status === "partially_paid") && b.state === "awaiting_deposit" ? request : undefined;
    if (owed.length === 0 && !open) return false;
    note("attempted", "telling the owner again about a UPI payment or refund");
    let told = true;
    for (const r of owed) told = (await tellOwner(b, b.customer, "owner_upi_refund_reminder", { refundInr: r.amountPaise / 100, upiCode: r.code!, offer: refundButtons(r) })) && told;
    if (open) {
      const markedPaise = open.marks.reduce((n, m) => n + m.amountPaise, 0);
      const left = depositPaise - markedPaise;
      told = (markedPaise > 0
        ? await tellOwner(b, b.customer, "owner_upi_part", { markedInr: markedPaise / 100, leftInr: left / 100, upiCode: open.code!, offer: receivedButtons(open, left) })
        : await tellOwner(b, b.customer, "owner_upi_claim", { upiCode: open.code!, offer: receivedButtons(open, left) })) && told;
    }
    note(told ? "confirmed" : "failed", told ? "the owner was told again" : "the owner could not be told (the limits or the provider said no)");
    return true;
  }

  /** Refunds still owed: remind the owner, once a day, at most three times; after that they stay in the record's unfinished work. */
  async function remindOwedRefunds(now: number): Promise<void> {
    for (const r of remindersDue(markState!, now)) {
      const b = store.bookings.get(r.caseId) ?? null;
      reminded(r, now);
      const told = await tellOwner(b, r.customer, "owner_upi_refund_reminder", { refundInr: r.amountPaise / 100, upiCode: r.code ?? undefined, offer: refundButtons(r) });
      log(b, r.customer, MARK_ACTIONS.refundReminder, told ? "confirmed" : "failed", { refundId: r.id }, { refs: { refundId: r.id, amountPaise: String(r.amountPaise) }, notes: `reminder ${r.reminders} of a refund the owner still owes` });
    }
  }

  // ---- the booking flow ------------------------------------------------------------------------------------------

  /** The two limits about WHEN: inside opening hours, and not on top of anything else, in the calendar or held by the shop's own bookings (holds included). */
  async function slotRules(b: Booking, start: number, end: number): Promise<{ hours: Decision; clash: Decision }> {
    const buffer = settings.bufferMinutes * MINUTE;
    const nearby = await calendar.conflicts(start - buffer, end + buffer);
    return {
      hours: checkWithinHours({ settings, service: serviceOf(b)!, startMs: start, closedDays: closedDays() }),
      clash: checkNoDoubleBooking({ startMs: start, endMs: end, bufferMinutes: settings.bufferMinutes, ownBookingRef: b.id, nowMs: clock.now(), others: [...nearby.map(busyOf), ...heldByBookings(b.id)] }),
    };
  }

  /**
   * After this booking's hold is written to the calendar: did anyone else write an event on the same time in between? Google takes overlapping events without a word, so
   * the calendar is read again and the same limit decides, counting only what is in the calendar now. A block means the time was taken meanwhile; null, that it was not.
   * A read that fails says neither, and is answered as "not held" by the caller: a hold is only kept when the calendar was seen clear around it.
   */
  async function takenMeanwhile(b: Booking, start: number, end: number): Promise<{ clash: Decision | null } | { unread: string }> {
    const buffer = settings.bufferMinutes * MINUTE;
    let nearby: CalendarEvent[];
    try { nearby = await calendar.conflicts(start - buffer, end + buffer); } catch (e) {
      if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
      return { unread: (e as Error).message };
    }
    const clash = checkNoDoubleBooking({ startMs: start, endMs: end, bufferMinutes: settings.bufferMinutes, ownBookingRef: b.id, nowMs: clock.now(), others: nearby.map(busyOf) });
    return { clash: clash.verdict === "block" ? clash : null };
  }

  /** Check the limits for a slot, then hold it in the calendar. */
  async function tryHold(b: Booking): Promise<{ ok: true; decisions: Decision[] } | { ok: false; why: "outside_hours" | "unavailable" | "failed" | "paused"; decisions: Decision[] }> {
    const service = serviceOf(b)!;
    const start = b.startMs!;
    const end = b.endMs!;
    const decisions: Decision[] = [checkPriceAtOrAboveList({ serviceName: serviceName(service, "en"), listInr: service.priceInr, proposedInr: service.priceInr })];
    const { hours, clash } = await slotRules(b, start, end);
    decisions.push(hours, clash);
    if (hours.verdict === "block") { log(b, b.customer, "hold_slot", "blocked", { start }, { decisions }); return { ok: false, why: "outside_hours", decisions }; }
    if (clash.verdict === "block") { log(b, b.customer, "hold_slot", "blocked", { start }, { decisions }); return { ok: false, why: "unavailable", decisions }; }

    // The hold is the booking's own: its time and its end, kept in the shop's saved state with the rest of this step. It is written before the calendar, and the calendar
    // only follows it. The record shows both: this line for the shop's hold, the next for the calendar's.
    b.holdExpiresAt = clock.now() + settings.deposit.holdMinutes * MINUTE;
    log(b, b.customer, "hold_slot", "attempted", { start, end }, { decisions, notes: `held in the shop's own bookings until ${new Date(b.holdExpiresAt).toISOString()}, before the calendar is written; a hold that is not paid by then ends by itself` });
    const { event, error, conflict, suspended } = await ensureEvent(b, { start, end, status: "tentative" });
    if (event) {
      b.eventId = event.id;
      const meanwhile = await takenMeanwhile(b, start, end);
      if ("unread" in meanwhile || meanwhile.clash) {
        // Not kept: someone else's event is on this time now, or the calendar could not be read again to say it is not. The calendar's hold is taken away again.
        const taken = !("unread" in meanwhile);
        log(b, b.customer, "hold_slot", taken ? "blocked" : "unconfirmed", { start, end }, {
          ...(taken ? { decisions: [...decisions, meanwhile.clash!] } : {}),
          refs: { eventId: event.id },
          notes: taken ? "another event was written on this time in the calendar while it was being held: the hold is let go and the customer is offered another time" : `the calendar could not be read again after the hold was written (${meanwhile.unread}), so the hold is not kept`,
        });
        await releaseSlot(b, taken ? "another event took the time while it was being held" : "the calendar could not be read again after the hold was written");
        b.holdExpiresAt = undefined;
        return taken ? { ok: false, why: "unavailable", decisions: [...decisions, meanwhile.clash!] } : { ok: false, why: "failed", decisions };
      }
      log(b, b.customer, "hold_slot", "confirmed", { start, end }, { refs: { eventId: event.id } });
      return { ok: true, decisions };
    }
    b.holdExpiresAt = undefined;
    if (suspended) {
      const decision = guardLicenceDecision(suspended.guard.reason);
      log(b, b.customer, "hold_slot", "blocked", { start, end }, { decisions: [...decisions, decision], notes: suspended.message });
      return { ok: false, why: "paused", decisions: [decision] };
    }
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
    if (!licence().takesNewWork) { clearSlot(b); if (b.state !== "enquiry") moveTo(b, "enquiry"); return pausedReply(phone, "hold"); } // nothing held, nothing kept for later
    const held = await tryHold(b);
    if (!held.ok && held.why === "paused") { clearSlot(b); if (b.state !== "enquiry") moveTo(b, "enquiry"); return pausedReply(phone, "hold", held.decisions[0]); } // Guard's licence check: nothing held, nothing kept for later
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
    const { link, error, suspended } = await ensureLink(b);
    if (!link && suspended) { // Guard held the link back for the licence: the shop's own pause, said as Guard's. The slot is let go; the owner is not asked to do anything.
      const decision = guardLicenceDecision(suspended.guard.reason);
      log(b, phone, "create_deposit_link", "blocked", { amountPaise: depositPaise }, { decisions: [decision], notes: suspended.message });
      await releaseSlot(b, "Guard refused the deposit link for the shop's licence");
      moveTo(b, "enquiry");
      clearSlot(b);
      return pausedReply(phone, "link", decision);
    }
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
    b.linkUrl = link.pay_url;
    log(b, phone, "create_deposit_link", "confirmed", { amountPaise: depositPaise }, { refs: { linkId: link.id } });
    moveTo(b, "awaiting_deposit");
    if (ownerConfirms) { await sendMarkedRequest(b, prefix, [...shown, ...held.decisions]); return; }
    await tellCustomer(b, phone, [...prefix, prefix.includes("price_floor") ? "slot_and_link" : "quote_and_link"], { shown: [...shown, ...held.decisions], offer: cancelOrOwner });
  }

  // ---- the licence: no new work in the wind-down, nothing more sent in the final stop ----------------------------------------------------------------------

  const stoppedGate: Decision = { ruleId: LICENCE_RULE, verdict: "block", reason: "the shop's licence has reached its final stop, so nothing more is sent from here (the owner's one notice aside); the runtime's own check of the lease" };

  /** A request for new work while online booking is paused: said in the record, answered "please contact the shop", and nothing kept to do later. */
  async function pausedReply(phone: string, asked: string, byGuard?: Decision): Promise<void> {
    const decision: Decision = byGuard ?? { ruleId: LICENCE_RULE, verdict: "block", reason: `online booking is paused: the shop's licence is in its ${licence().state === "stopped" ? "final stop" : "wind-down"}, so no booking, hold or deposit link is made, and nothing is kept to do later (the runtime's own check of the lease)` };
    log(null, phone, "new_work", "blocked", { asked }, { decisions: [decision], notes: "the customer is told online booking is paused and to contact the shop" });
    await tellCustomer(null, phone, ["booking_paused"]);
  }

  /** One record line each time the licence restricts the shop, or stops restricting it. Nothing asked during a wind-down is done when it ends: the customer asks again. */
  function noteLicence(): void {
    const l = licence();
    const now = l.restricted ? l.state : "active";
    let was = "active";
    const entries = record.entries();
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].action === "licence") { was = entries[i].refs.state ?? "active"; break; }
    if (now === was) return;
    const notes = now === "wind_down" ? "The shop's licence is in its wind-down (the lease fleet signed, read on this server): no new booking or deposit link is made, and nothing is kept to do later. Refunds owed, cancellations, existing bookings and payments from links sent earlier go on."
      : now === "stopped" ? "The shop's licence has reached its final stop: open deposit links are closed and nothing more is sent from here, except the owner's one notice. Payments already made are still recorded and refunds still go through. Nothing is deleted."
      : "The shop's licence is in order again: new bookings are taken from now on. Nothing asked during the wind-down is done now; a customer who still wants it asks again.";
    log(null, owner, "licence", "confirmed", { state: now }, { refs: { state: now, ...(l.paidThrough !== null ? { paidThrough: String(l.paidThrough) } : {}) }, notes });
  }

  /** The final stop, once for each `paid_through`: close every open deposit link at the gateway through Guard, so no new payment comes in. A module that cannot cancel a request (UPI) has none to close. */
  async function closeLinksAtStop(): Promise<void> {
    const l = licence();
    if (l.state !== "stopped" || !can.cancels) return;
    const key = `stop:${l.paidThrough ?? 0}`;
    for (const b of [...store.bookings.values()]) {
      if (b.state !== "awaiting_deposit" || !b.linkId) continue;
      if (record.entries().some((e) => e.booking === b.id && e.action === "cancel_deposit_link" && e.refs.licence === key)) continue;
      const linkId = b.linkId;
      const closed = await payments.cancelRequest(linkId).then(() => payments.fetchRequest(linkId)).then((x) => x?.status === "cancelled").catch(() => false);
      log(b, b.customer, "cancel_deposit_link", closed ? "confirmed" : "unconfirmed", { linkId }, { refs: { linkId, licence: key }, notes: closed ? "the final stop of the shop's licence: the open deposit link is closed, so no new payment comes in; a payment already made is still recorded" : "the final stop of the shop's licence: the link could not be closed (it may be paid already, or the gateway did not answer); the owner can close it in the gateway's own dashboard" });
    }
  }

  async function onBook(phone: string, intent: Intent): Promise<void> {
    if (!licence().takesNewWork) return pausedReply(phone, "book");
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
        await tellAlreadyWaiting(waiting);
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
    if (waiting) { await tellAlreadyWaiting(waiting); return; }
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
  async function reconcilePayments(b: Booking): Promise<MarkOutcome | void> {
    if (ownerConfirms) return reconcileMarks(b); // the owner's marks are this module's payment record
    if (!b.linkId) return;
    const link = await payments.fetchRequest(b.linkId);
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
      log(b, b.customer, "confirm_booking", "confirmed", want, { refs: { eventId: found.event.id }, ...(ownList ? { notes: "read back from the shop's own booking list (this shop has no Google Calendar); the deposit is recorded too" } : {}) });
      moveTo(b, "confirmed");
      await tellCustomer(b, b.customer, [ownerConfirms ? "upi_booked" : "booked"], { offer: cancelOrOwner });
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
    const closed = await payments.cancelRequest(b.linkId).then(() => payments.fetchRequest(b.linkId!)).then((l) => l?.status === "cancelled").catch(() => false);
    log(b, b.customer, "cancel_deposit_link", closed ? "confirmed" : "unconfirmed", { linkId: b.linkId }, { notes: closed ? why : "the link could not be closed: it may still be open or already paid" });
    if (ownerConfirms && closed) log(b, b.customer, MARK_ACTIONS.closed, "confirmed", { requestId: b.linkId }, { refs: { requestId: b.linkId }, notes: `${why}; a mark by the owner that comes later is still recorded, and never books by itself` });
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
    await tellCustomer(b, b.customer, [ownerConfirms ? "upi_hold_expired" : "hold_expired"], { slotMs });
    if (ownerConfirms) {
      // part of the deposit was marked, and the hold ran out: that part is the customer's, and the owner owes it back
      const marks = requestOf(b)?.marks ?? [];
      const partPaise = marks.reduce((n, m) => n + m.amountPaise, 0);
      if (partPaise > 0) await oweBack(b, marks.at(-1)!.id, partPaise, "part of the deposit was marked received, and the hold ran out", { customer: "upi_refund_owed" });
    }
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
    // A module that cannot refund by itself: inside the window the deposit is owed back by the owner, whatever the limit (the owner sends every such refund, so
    // there is no Guard to hold one); outside it the owner decides, as below.
    if (ownerRefunds && inWindow) { await oweBack(b, b.depositPaymentId!, amountInr * 100, "cancelled inside the cancellation window", { customer: "upi_cancelled_refund_owed", decisions: [limit] }); return; }
    if (!inWindow && (limit.verdict === "allow" || ownerRefunds)) {
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

  /** The words that ask for a day's bookings, in the four languages. Nothing else matches, so a command or a payment mark is never read as one. */
  const DAY_WORDS: [RegExp, "today" | "tomorrow"][] = [
    [/^\s*(?:today|bookings?|aaj|आज|ഇന്ന്|ಇಂದು)\s*[.!?]*\s*$/iu, "today"],
    [/^\s*(?:tomorrow|kal|कल|നാളെ|ನಾಳೆ)\s*[.!?]*\s*$/iu, "tomorrow"],
  ];
  const parseDayRequest = (text: string): "today" | "tomorrow" | undefined => DAY_WORDS.find(([re]) => re.test(text))?.[1];

  /** The owner's list for a day: the shop's confirmed bookings (and those waiting for the owner after the deposit), in time order, read from the saved bookings. */
  async function tellDay(day: "today" | "tomorrow"): Promise<void> {
    const today = localParts(clock.now(), tz);
    const from = zonedToMs(addDays(today, day === "today" ? 0 : 1), { hour: 0, minute: 0 }, tz);
    const to = zonedToMs(addDays(today, day === "today" ? 1 : 2), { hour: 0, minute: 0 }, tz);
    const rows = [...store.bookings.values()]
      .filter((x) => (x.state === "confirmed" || x.state === "needs_owner") && x.startMs !== undefined && x.startMs >= from && x.startMs < to)
      .sort((x, y) => (x.startMs as number) - (y.startMs as number))
      .map((x) => ({ slotMs: x.startMs as number, serviceName: serviceName(settings.services.find((v) => v.id === x.serviceId) ?? settings.services[0], settings.owner.language), customerPhone: shownPhone(x.customer, x), ref: x.id }));
    log(null, owner, "owner_day_list", "confirmed", { day }, { notes: `the owner asked for the bookings of ${day}; ${rows.length} listed from the shop's saved bookings`, refs: { day } });
    await say({ booking: null, phone: owner, to: "owner", templates: ["owner_day_bookings"], day, dayBookings: rows });
  }

  async function onOwnerMessage(msg: InboundMessage): Promise<void> {
    // Owner-marked (B33): "received K7M2QX", "refunded K7M2QX" or a tap on one of those buttons. Only the owner's number reaches here.
    const markReply = markState ? parseMarkReply(msg) : undefined;
    if (markReply) return onOwnerMark(markReply, msg);
    if (ownerConfirms && msg.image) return; // a picture from the owner is not a mark: only the reply with its code is
    // "approve K7M2QX" answers the approvals relay, which reads the owner's messages too (the inbox gives it a copy). It is not for the agent:
    // no reply and no record, so the owner is not told "I didn't understand" about an answer that was understood elsewhere.
    if (isRelayReply(msg)) return;
    // "move K7M2QX" is the owner agreeing to hand the shop to another partner or builder (modules/approvals/handover.ts). The record keeps the owner's number and the code's hash; the panel does the rest.
    const moving = parseHandoverReply(msg.text);
    if (moving) { log(null, owner, HANDOVER_ACTION, "confirmed", { command: "handover" }, { refs: { command: "handover", handover: handoverHash(moving) }, notes: "the owner agreed, from their own number, to hand the shop to another partner or builder. The panel checks the code before it moves anything" }); return; }
    // B72: "terms" sends the shop terms to the owner and "I agree" records the agreement (modules/terms/owner.ts). Off unless the shop was handed a terms file.
    if (await handleOwnerTerms(msg, { setup: deps.terms?.(), shopName: settings.name, ownerNumber: owner, ownerLanguage: settings.owner.language, messaging, record, log: (action, outcome, inputs, more) => log(null, owner, action, outcome, inputs, more) })) return;
    // B72: "today" / "tomorrow" (or "bookings") asks for that day's bookings, from the shop's own saved list. A reply to the owner's own message, so no template is needed.
    const dayAsked = parseDayRequest(msg.text);
    if (dayAsked) return tellDay(dayAsked);
    // Item 11e: the shop's assistant reads what no fixed phrase is (this command is one). A shop without an "assistant" block: exactly as before.
    if (assistant && !OWNER_COMMAND.test(msg.text) && (await assistant.onOwnerMessage(msg))) return;
    const m = OWNER_COMMAND.exec(msg.text);
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
      if (ownerRefunds) { await oweBack(b, b.depositPaymentId!, amountInr * 100, "the owner cancelled a booking the calendar could not confirm", { customer: "upi_cancelled_refund_owed", decisions: [limit] }); return; }
      // The owner chose to cancel. The deposit going back is a separate matter if it is above the limit: Guard holds it and the relay asks.
      // With other approvers (B37) the owner is named as asking for it, so someone else approves it.
      const result = await requestRefund(b, b.depositPaymentId!, amountInr, [limit], overLimit(amountInr), askedByOwner);
      await afterRefund(b, result, { paymentId: b.depositPaymentId!, amountInr, done: { customer: "cancelled_refund" }, held: "cancelled_refund_pending", requestedBy: askedByOwner });
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
    if (ownerRefunds) { await oweBack(b, pending.paymentId, pending.amountInr * 100, "the owner approved a refund after a late cancellation", { customer: "upi_refund_owed", decisions: [limit] }); return; }
    const result = await requestRefund(b, pending.paymentId, pending.amountInr, [limit], overLimit(pending.amountInr), askedByOwner);
    await afterRefund(b, result, { paymentId: pending.paymentId, amountInr: pending.amountInr, done: { customer: "refund_approved" }, held: "cancelled_refund_pending", requestedBy: askedByOwner });
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
  async function onVoiceNote(msg: InboundMessage, tried?: Heard): Promise<void> {
    const phone = msg.from;
    // Item 11e: with the shop's assistant and a voice service, the owner's voice note is read as their typed words (or they are told it could not be made out)
    const heard = phone === owner && assistant ? await assistant.hearOwner(msg) : null;
    if (heard) return heard.text ? onOwnerMessage(heard) : undefined;
    if (phone === owner) {
      await say({ booking: null, phone, to: "owner", templates: ["voice_note"], action: "voice_note_reply" });
      return;
    }
    const customer = customerOf(phone);
    // B29: when voice is on and the note could not be used, the record says why and what listening cost (a priced call is counted as a rules-read message, so fleet's meter sees the spend)
    const why = tried && !tried.ok ? tried : undefined;
    log(null, phone, "receive_message", "confirmed", { voiceNote: true, id: msg.id }, {
      notes: why ? `a voice note that could not be used (${VOICE_WHY[why.reason]}); the audio was held in memory for the call only and nothing of it is kept` : "a voice note: it is not listened to and nothing of it is kept",
      refs: { messageId: msg.id, ...(why ? failedMarks(why) : {}) },
    });
    if (customer.optedOut) return; // STOP means STOP: nothing goes to them, even if they write again
    await tellCustomer(null, phone, [deps.voice ? "voice_note_retry" : "voice_note"], { action: "voice_note_reply" }); // B29: where voice is on the line says it could not be made out; where it is off, that voice notes cannot be listened to
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  // B29: listening, shared by every template (modules/voice/turn.ts). The owner and the other approvers' messages are commands and are typed.
  const listen = createListener({ voice: deps.voice, reader, isCommander: (phone) => phone === owner || approverDigits.has(phone.replace(/\D/gu, "")), optedOut: (phone) => customerOf(phone).optedOut });

  async function onMessage(original: InboundMessage): Promise<void> {
    let msg = original;
    if (store.seenMessages.has(msg.id)) {
      log(null, msg.from, "receive_message", "blocked", { id: msg.id }, { notes: "the same WhatsApp message was delivered again, so it is ignored" });
      return;
    }
    store.seenMessages.add(msg.id);
    // B37: another approver's "approve K7M2QX" is the approvals relay's (the inbox gives it a copy): no reply and no record here, as for the owner's
    if (approverDigits.has(msg.from.replace(/\D/gu, "")) && isRelayReply(msg)) return;
    // B29: a voice note is turned into the words it says and then read exactly like a typed message (rules first, then the models, then the same limits and checks).
    let voiceHeard: HeardOk | undefined;
    if (msg.voiceNote) {
      const heard = await listen(msg);
      if (!heard?.ok) return onVoiceNote(msg, heard ?? undefined);
      voiceHeard = heard;
      msg = { id: msg.id, from: msg.from, text: heard.text, timestamp: msg.timestamp };
    }
    if (msg.from === owner) return onOwnerMessage(msg);
    if (msg.image) return onPicture(msg);

    const phone = msg.from;
    const customer = customerOf(phone);
    const mode = reader.mode();
    // UPI: "I paid" while a deposit waits is read from a few plain words before any model; it is a claim, and the owner is asked to look. It marks nothing paid.
    if (ownerConfirms && !msg.reply && !customer.optedOut && PAID_CLAIM.test(msg.text) && !NOT_PAID.test(msg.text) && latestBooking(store, phone, ["awaiting_deposit"])) {
      // B29: a voice note that says "I paid" is recorded as voice too, with what listening cost, so the cost meter does not miss it
      log(null, phone, "receive_message", "confirmed", { text: msg.text, id: msg.id, ...(voiceHeard ? { voice: true } : {}) }, { refs: { messageId: msg.id, step: "rules", ...(voiceHeard ? { ...voiceMarks(voiceHeard), costMicroInr: String(voiceHeard.costMicroInr) } : {}) } });
      return onPaidClaim(phone, "words");
    }
    // A tap on a button or a list row is read by looking its id up: no words are read, so no model is asked, whatever the mode. An id that is none of ours is read as words.
    const tapped = msg.reply ? intentFromReply(msg.reply.id, settings) : null;
    const { intent, note, understood } = tapped
      ? { intent: tapped, note: undefined, understood: RULES }
      : await readIntent(msg.text, { rulesOnly: mode.buttons || customer.optedOut, slots: () => candidateSlots(latestBooking(store, phone, ["enquiry", "confirming_details"])?.serviceId) }); // an opted-out customer gets no reply, so no model is paid to read it
    countUnderstood(understood);
    if (intent.language && settings.languages.includes(intent.language)) customer.language = intent.language;
    else if (voiceHeard && !customer.language && settings.languages.includes(voiceHeard.language)) customer.language = voiceHeard.language; // the language they spoke, when the words do not say
    const notes = [note, intent.overrideAttempt ? "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing" : undefined].filter(Boolean).join("; ");
    // B29: the record keeps what it keeps for typed text, plus that it came from a voice note, which provider and models listened, for how long, and what that cost; the
    // cost is added to the message's own so the cost meter (which reads costMicroInr) counts it as model spend.
    const understoodRefs = understandingRefs(understood, tapped ? msg.reply!.kind : undefined);
    const voiceRefs: Record<string, string> = voiceHeard ? {
      ...voiceMarks(voiceHeard),
      ...(understoodRefs.costMicroInr !== undefined ? { costMicroInr: String(Number(understoodRefs.costMicroInr) + voiceHeard.costMicroInr) } : {}),
    } : {};
    log(null, phone, "receive_message", "confirmed", { text: msg.text, id: msg.id, ...(tapped ? { reply: msg.reply!.id } : {}), ...(voiceHeard ? { voice: true } : {}) }, { notes: [notes, voiceHeard ? "the customer sent a voice note; this is its transcript" : undefined].filter(Boolean).join("; "), refs: { messageId: msg.id, ...understoodRefs, ...voiceRefs } });

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
        case "paid": return await (ownerConfirms ? onPaidClaim(phone, "button") : tellCustomer(null, phone, ["didnt_understand"], { offer: servicesOffer(["didnt_understand"]) }).then(() => undefined));
        case "greeting": if (!licence().takesNewWork) return await pausedReply(phone, "menu"); await tellCustomer(null, phone, ["menu"], { offer: servicesOffer(["pick_service"]) }); return;
        default: if (!licence().takesNewWork) return await pausedReply(phone, "menu"); await tellCustomer(null, phone, ["didnt_understand"], { offer: servicesOffer(["didnt_understand"]) });
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
    if (event.event === "refund.done") {
      const paymentId = event.payload.refund!.payment_id;
      const b = bookings.find((x) => x.handledPayments.includes(paymentId) || x.depositPaymentId === paymentId);
      const refundId = event.payload.refund!.id;
      // The event only says to look: the payments service's own list must show the refund. When it is the refund an unknown outcome is open on (B75), that ORIGINAL
      // attempt is settled as the provider's confirmation and the customer told, or kept on the to-do list until WhatsApp accepts that message (modules/payments/refunds.ts
      // settleFromEvent); no refund is ever asked for again.
      const listed = (await payments.listRefunds(paymentId)).find((r) => r.id === refundId);
      const settles = b && listed ? refunds.openIssueFor(b, listed) !== undefined : false;
      log(b ?? null, b?.customer ?? owner, "receive_payment_event", listed ? "confirmed" : "unconfirmed", { id: event.id, event: event.event }, { refs: { refundId, paymentId }, notes: listed ? (settles ? "the refund is on the payments service's own list, and it is the one whose outcome was unknown: settled below" : "the refund is on the payments service's own list") : "the payments service's own list does not show this refund, so nothing is settled by it" });
      if (b && listed && settles) await refunds.settleFromEvent(b, listed, event.id);
      store.seenEvents.add(event.id);
      return;
    }
    // A payment.received may name the payment and not its request (a provider's body can carry its order only): ask the payments service which request it paid.
    const paymentId = event.payload.payment?.id;
    const linkId = event.payload.request?.id ?? event.payload.payment?.request_id
      ?? (paymentId ? (await payments.listRequests({ payment_id: paymentId }))[0]?.id : undefined);
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

  /**
   * B72: remember which calendar the bookings were last written to. A shop that was on its own booking list and now has Google Calendar gets its coming bookings written
   * there once, looking first by booking id, so nothing is doubled and nothing is lost; the booking list stays the authority either way. A booking whose time Google already
   * shows taken is not un-booked: the failure is recorded for the partner and the owner's list still shows it. Tried again on the next beat until every one is in.
   */
  async function backfillCalendar(now: number): Promise<void> {
    if (ownList) { if (store.calendarState?.kind !== "own") store.calendarState = { kind: "own" }; return; }
    if (store.calendarState?.kind !== "own") return;
    let allIn = true;
    for (const b of [...store.bookings.values()]) {
      if (b.startMs === undefined || b.endMs === undefined || b.endMs <= now) continue;
      const status = b.state === "confirmed" || b.state === "needs_owner" ? "confirmed" : b.state === "awaiting_deposit" && b.holdExpiresAt !== undefined && b.holdExpiresAt > now ? "tentative" : undefined;
      if (!status) continue;
      const found = await ensureEvent(b, { start: b.startMs, end: b.endMs, status });
      if (found.event) { b.eventId = found.event.id; continue; }
      allIn = false;
      log(b, b.customer, "calendar_backfill", found.error || found.conflict ? "failed" : "unconfirmed", { start: b.startMs }, { notes: `this booking is in the shop's booking list but could not be written to the new Google Calendar yet (${found.error ?? "the calendar does not show it"}); it stays booked and is tried again` });
    }
    if (allIn) { store.calendarState = { kind: "google" }; log(null, owner, "calendar_backfill", "confirmed", { kind: "google" }, { notes: "every coming booking from the shop's own list is now in the Google Calendar" }); }
  }

  async function onTick(): Promise<void> {
    const now = clock.now();
    await backfillCalendar(now);
    await announceButtonMode(); // the outside switch can change between messages; the owner hears of it on the next beat
    await refunds.sweep(now); // refunds first, whatever state their booking is in (modules/payments/refunds.ts)
    if (markState) await remindOwedRefunds(now);
    await closeLinksAtStop();
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
    assistant?.onTick(); // item 11e: cards past their time close; the morning line is the runtime's own job (modules/assistant/morning.ts)
  }

  // ---- recovery: the panel's to-do list asks the agent to look again, or ask again -----------------------------------------------------------------------
  //   recheck_payment   read the payments service's own list for this booking's link, and record any payment not yet counted (the normal path, with its rules)
  //   retry_booking     a deposit is in and the calendar would not confirm it: ask the calendar again, and tell the customer "booked" only if it now shows the booking
  //   ask_owner_again   the owner has not answered: send the owner the same notice again (a calendar clash, or a late cancellation's refund)
  //   recheck_refund    look again, read-only, for a refund that may have gone (nothing is ever sent again; a refund the list shows settles it, and the customer is told,
  //                     or, if WhatsApp does not accept that message, it stays on the to-do list as "refund made, customer not yet told" until it does)
  // Nothing here widens a limit: every call is one the agent already makes, and Guard decides each as it does every day.
  async function onRecovery(e: { id: string; case: string; action: string }): Promise<void> {
    const b = store.bookings.get(e.case);
    const refs = { action: e.action, recovery: e.id };
    const say = (outcome: Outcome, notes: string) => log(b ?? null, owner, RECOVERY_ENTRY, outcome, { action: e.action, case: e.case }, { notes, refs });
    if (!b) return say("blocked", "no booking has this id, so nothing was done");
    if (e.action === "recheck_payment") {
      if (!b.linkId) return say("blocked", "this booking has no payment link to look at");
      say("attempted", "looking again at the payments service's list for this booking's link");
      await reconcilePayments(b);
      return say("confirmed", "the payments service's list was read; any payment not yet counted was recorded above");
    }
    if (e.action === "retry_booking") {
      if (typeof b.depositPaymentId !== "string" || (b.state !== "needs_owner" && b.state !== "awaiting_deposit")) return say("blocked", "this booking has no deposit waiting on the calendar, so there is nothing to confirm again");
      say("attempted", "asking the calendar again to confirm the booking the deposit paid for");
      await completeBooking(b); // sends "booked" only if the calendar now shows it
      return;
    }
    if (e.action === "ask_owner_again" && markState && (await markAskAgain(b, say))) return;
    if (e.action === "ask_owner_again") {
      const calendar = b.pending.find((p) => p.kind === "calendar");
      const refund = b.pending.find((p): p is Extract<Pending, { kind: "refund" }> => p.kind === "refund");
      if (!calendar && !refund) return say("blocked", "nothing the agent asked the owner is waiting (a refund Guard holds is asked by the approvals relay)");
      say("attempted", "telling the owner again");
      const told = calendar ? await tellOwner(b, b.customer, "owner_cant_confirm") : await tellOwner(b, b.customer, "owner_late_cancellation", { refundInr: refund!.amountInr });
      return say(told ? "confirmed" : "failed", told ? "the owner was told again" : "the owner could not be told (the limits or the provider said no)");
    }
    if (e.action === "recheck_refund") {
      if (!(b.refundIssues ?? []).some((i) => ["unknown", "uncertain", "unconfirmed", "failed"].includes(i.kind))) return say("blocked", "no refund here is waiting on an unclear outcome");
      say("attempted", "looking again, read-only, for a refund that may have gone");
      const r = await refunds.recheck(b);
      return say("confirmed", recheckLine(r)); // says how many customers were told: one whose message was not accepted stays on the to-do list
    }
    say("blocked", `the agent has no recovery called "${e.action}"`);
  }

  // ---- item 11d: the booking page, its API and the MCP endpoint; the owner's private page --------------------------------------------------------------
  //
  // A channel booking goes through the SAME steps as a WhatsApp booking (proceedToHold: the hours and the double-booking limits, the hold in the shop's own list
  // and the calendar, the deposit request through its Guard or the owner-marked ledger, "booked" only when the record holds the calendar and the deposit). What differs:
  //  - its conversation is its own ("web:<16 hex>"), never the typed number, so no WhatsApp booking is ever found, changed or cancelled by it;
  //  - its messages go to its page (modules/channels/outbox.ts), never to the typed number on WhatsApp;
  //  - the request names an exact service and start, so no words are read and no model is asked;
  //  - the per-number and per-shop limits below, which a WhatsApp booking does not need (WhatsApp says whose number it is; a web form does not).

  const channelState = (): ChannelState => (store.channel ??= emptyChannelState());

  /** Why a requested start cannot be booked before anything is held: off the shop's grid, too soon to pay in time, or too far ahead. Null when it may be tried. */
  function channelTimeProblem(service: Settings["services"][number], startMs: number): string | null {
    const now = clock.now();
    const p = localParts(startMs, tz);
    const minuteOfDay = p.hour * 60 + p.minute;
    if (startMs % MINUTE !== 0 || minuteOfDay % settings.slotMinutes !== 0) return "off_grid";
    if (startMs <= now + settings.deposit.holdMinutes * MINUTE) return "too_soon";
    if (startMs > now + CHANNEL_LIMITS.daysAhead * 24 * HOUR) return "too_far";
    const hours = hoursOn(settings, weekdayOf(p));
    // a date the owner closed through the assistant (item 11e) is outside the hours here too, so nothing is held for it (slotRules would refuse it later anyway)
    if (!hours || closedDays().includes(isoDate(p)) || minuteOfDay < hours.open || minuteOfDay + service.durationMinutes > hours.close) return "outside_hours";
    return null;
  }

  async function onChannelBook(e: ChannelBook): Promise<void> {
    const state = channelState();
    if (state.requests[e.handle]) return; // the same request again (its task key is the handle): one booking, however often it is sent
    const now = clock.now();
    const conversation = conversationOf(e.channel, e.handle);
    const digits = phoneDigits(e.phone);
    const language = settings.languages.includes(e.language) ? e.language : settings.languages[0];
    // the name and number are inputs only: the record keeps their keyed digest (B69), never the words, in refs or notes
    const inputs = { channel: e.channel, serviceId: e.serviceId, startMs: e.startMs, name: e.name, phone: e.phone };
    const refuse = async (reason: string, notes: string, decisions: Decision[] = []) => {
      state.requests[e.handle] = { atMs: now, channel: e.channel, refused: reason, phone: digits };
      log(null, conversation, "channel_booking", "blocked", inputs, { decisions, refs: { channel: e.channel, reason }, notes });
    };
    if (!licence().takesNewWork) { await refuse("paused", "online booking is paused (the shop's licence): nothing is held and nothing is kept to do later"); customerOf(conversation).language = language; return pausedReply(conversation, "book"); }
    const service = settings.services.find((x) => x.id === e.serviceId);
    if (!service) return refuse("unknown_service", "the shop has no such service");
    const timeProblem = channelTimeProblem(service, e.startMs);
    if (timeProblem) return refuse(timeProblem, "the start asked for is not one the shop can offer (off its slot grid, too soon to pay in time, too far ahead, or outside its hours); nothing was held");
    // The typed number is not verified, so these only slow one person down; the per-shop cap and the hold's own end are what bound a flood.
    const live = [...store.bookings.values()].filter((b) => b.channel !== undefined && b.state === "awaiting_deposit");
    if (live.filter((b) => b.contact && phoneDigits(b.contact.phone) === digits).length >= CHANNEL_LIMITS.holdsPerPhone) return refuse("phone_busy", `this number already has ${CHANNEL_LIMITS.holdsPerPhone} unpaid holds from the booking page; nothing more is held for it until one is paid, cancelled or ends`);
    if (Object.values(state.requests).filter((r) => r.phone === digits && now - r.atMs < DAY_MS).length >= CHANNEL_LIMITS.startsPerPhonePerDay) return refuse("phone_day", `this number started ${CHANNEL_LIMITS.startsPerPhonePerDay} bookings from the booking page in the last 24 hours; no more today`);
    if (live.length >= CHANNEL_LIMITS.unpaidHoldsPerShop) return refuse("shop_busy", `the shop already has ${CHANNEL_LIMITS.unpaidHoldsPerShop} unpaid holds from the booking page and its API; nothing more is held until one is paid, cancelled or ends`);

    customerOf(conversation).language = language; // only now: a refused request leaves no customer behind
    const b = register(store, newDraft(conversation, language));
    b.channel = e.channel;
    b.handle = e.handle;
    b.contact = { name: e.name, phone: e.phone };
    b.serviceId = service.id;
    b.startMs = e.startMs;
    b.endMs = e.startMs + service.durationMinutes * MINUTE;
    const p = localParts(e.startMs, tz);
    b.date = { year: p.year, month: p.month, day: p.day };
    b.time = { hour: p.hour, minute: p.minute };
    state.requests[e.handle] = { atMs: now, channel: e.channel, booking: b.id, phone: digits };
    log(b, conversation, "channel_booking", "confirmed", inputs, { refs: { channel: e.channel }, notes: `asked for on the ${e.channel === "mcp" ? "MCP endpoint, by an AI assistant for its user" : "shop's booking page or its API"}: an exact service and start, so no words were read; the same hold, limits and deposit as a WhatsApp booking follow` });
    await proceedToHold(b, [], []);
  }

  /** A cancel or an "I have paid" for the booking with this handle: the same as the same button on WhatsApp, in the booking's own conversation. */
  async function onChannel(e: ChannelEvent & { kind: "channel_request" }): Promise<void> {
    if (e.op === "book") return onChannelBook(e);
    const request = channelState().requests[e.handle];
    const b = request?.booking ? store.bookings.get(request.booking) : undefined;
    if (!b || b.handle !== e.handle) { log(null, owner, "channel_booking", "blocked", { op: e.op }, { refs: { channel: e.channel, op: e.op }, notes: "no booking has this handle, so nothing was done" }); return; }
    log(b, b.customer, "channel_booking", "confirmed", { op: e.op }, { refs: { channel: e.channel, op: e.op }, notes: e.op === "cancel" ? "the customer cancelled from the booking's page" : "the customer says they paid, from the booking's page; nothing is marked paid until the owner marks it" });
    if (e.op === "cancel") return onCancel(b.customer); // its conversation holds only this booking, so this cancels exactly it
    if (ownerConfirms) return onPaidClaim(b.customer, "button");
  }

  /**
   * The owner pressed a button on their private approvals page. The page showed an action with a digest of exactly what it showed (channel.ts ownerItems); if what waits
   * now has another digest (a mark was made since, the amount changed, it was already answered) nothing is done and the page shows what waits now. Otherwise it is handled
   * by the same code as the owner's reply on WhatsApp: the one-use code's button for a UPI mark (bound to its request and the amount still asked), "approve b-3" and the like
   * for what the agent asked the owner. A refund Guard holds is never here: the approvals relay answers it (it alone holds the owner's approver secret).
   */
  async function onOwnerAction(e: OwnerAction): Promise<void> {
    // Item 11e on the page: an answer to one of the assistant's cards. The card's own binding decides (modules/assistant/cards.ts judgeCard), exactly as for a tap on
    // WhatsApp: the posted digest must be the card's, the card answers once, and a yes does the saved action only while the store still gives the card's digest.
    if (e.action === "card_yes" || e.action === "card_no") {
      if (!assistant) { log(null, owner, "owner_page_action", "blocked", { action: e.action, case: e.case }, { refs: { channel: "owner_page", action: e.action }, notes: "a card's answer came for a shop without the assistant: nothing was done" }); return; }
      log(null, owner, "owner_page_action", "confirmed", { action: e.action, case: e.case }, { refs: { channel: "owner_page", action: e.action }, notes: "pressed by the owner on their page; the card's own binding decides, as for a tap on WhatsApp" });
      return assistant.onPageCard({ card: e.case, digest: e.digest, answer: e.action === "card_yes" ? "yes" : "no" });
    }
    const item = ownerItems(settings, store, clock.now()).items.find((x) => x.case === e.case && x.digest === e.digest && x.actions.includes(e.action));
    const b = store.bookings.get(e.case) ?? null;
    if (!item) {
      log(b, owner, "owner_page_action", "blocked", { action: e.action, case: e.case }, { refs: { channel: "owner_page", action: e.action }, notes: "what the owner's page showed is not what waits now (already answered, a new mark or amount since, or gone): nothing was done" });
      return;
    }
    log(b, owner, "owner_page_action", "confirmed", { action: e.action, case: e.case }, { refs: { channel: "owner_page", action: e.action }, notes: "pressed by the owner on their private approvals page; handled exactly as the same reply on WhatsApp" });
    const base = { id: `owner-page:${e.id}`, from: owner, timestamp: clock.now() };
    const msg: InboundMessage = item.code
      ? { ...base, text: "", reply: { id: markButtonId(e.action === "received" ? "received" : e.action === "kept" ? "kept" : "refunded", item.code), kind: "button" } }
      : { ...base, text: `${e.action} ${e.case}` };
    await onOwnerMessage(msg);
  }

  async function handle(event: AgentEvent): Promise<void> {
    noteLicence();
    if (event.kind === "recovery") return onRecovery(event);
    if (event.kind === "channel_request") return onChannel(event);
    if (event.kind === "owner_action") return onOwnerAction(event);
    if (event.kind === "message") return onMessage(event.message);
    if (event.kind === "payment_event") return onPaymentEvent(event.event);
    if (event.kind === "approval_decision") return refunds.onApprovalDecision(event);
    return onTick();
  }

  /**
   * `wait_over` (11 Nov 2026): the request was not finished, the system is not answering just now, the message is on the owner's to-do list (the line written below,
   * which the panel's list reads), and to write again later or contact the shop directly. Nothing else is promised, because nothing else happens: nobody is messaged
   * and nothing is tried again by itself. Sent only when the customer heard nothing from this step (`why.tell`).
   */
  async function giveUp(event: AgentEvent, why: { service: string; tell: boolean }): Promise<void> {
    const phone = event.kind === "message" ? event.message.from : owner;
    if (event.kind === "message" && why.tell) {
      // The step that would have noted a new customer's language was thrown away, so it is read again here from the message, by the rules alone (no model is asked);
      // without it a first message would be answered in the shop's first language, whatever the customer wrote in. A language already on record is kept.
      const customer = customerOf(phone);
      const spoken = detectLanguage(event.message.text);
      if (customer.language === undefined && spoken !== undefined && settings.languages.includes(spoken)) customer.language = spoken;
    }
    const told = event.kind === "message" && why.tell ? await tellCustomer(null, phone, ["wait_over"]) : false;
    const line = guardWaitLine(event, why, told);
    log(null, phone, GUARD_WAIT_ENTRY, "failed", line.inputs, { notes: line.notes, refs: line.refs });
  }

  // ---- item 11e: the shop's assistant (modules/assistant) -------------------------------------------------------------
  // On only when the settings have an "assistant" block. Bookings is its one skill here; the skill's acts are this agent's own paths (src/assistant.ts).
  const ownerCancelRefund = async (b: Booking, amountInr: number, why: string, customer: { upi: TemplateId; done: TemplateId; held: TemplateId }) => {
    const limit = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr, paidInr: b.depositInr ?? amountInr, ownerApproved: true });
    if (ownerRefunds) { await oweBack(b, b.depositPaymentId!, amountInr * 100, why, { customer: customer.upi, decisions: [limit] }); return "owed" as const; }
    const result = await requestRefund(b, b.depositPaymentId!, amountInr, [limit], overLimit(amountInr), askedByOwner);
    await afterRefund(b, result, { paymentId: b.depositPaymentId!, amountInr, done: { customer: customer.done }, held: customer.held, requestedBy: askedByOwner } as never);
    return result;
  };
  const assistantSkill = bookingsSkill({
    settings, store, nowMs: () => clock.now(), entries: () => record.entries(), optedOut: (phone) => store.customers.get(phone)?.optedOut ?? false,
    acts: {
      owner, ownerRefunds,
      answer: (msg) => onOwnerMessage(msg),
      // the owner cancels a paid booking: the same steps as the owner's "approve b-3" on a booking the calendar could not confirm (above), then the deposit back
      async cancelPaid(b, back, why) {
        b.pending = [];
        await releaseSlot(b, why);
        b.reminders = [];
        moveTo(b, "cancelled");
        log(b, b.customer, "cancel_booking", "confirmed", { by: "owner" }, { refs: { by: "owner", via: "assistant" } });
        return ownerCancelRefund(b, back, why, { upi: "upi_cancelled_refund_owed", done: "cancelled_refund", held: "cancelled_refund_pending" });
      },
      cancelWaiting: (b, why) => cancelWaiting(b, why),
      slotRules: (b, startMs, endMs) => slotRules(b, startMs, endMs),
      // the owner's move, as the customer's own "yes" to a new time applies it: the same checks again, the calendar, and the customer's "rescheduled" message
      async applyMove(b, startMs, endMs) {
        const p = localParts(startMs, tz);
        b.reschedule = { date: { year: p.year, month: p.month, day: p.day }, timePhrase: { hour: p.hour % 12 || 12, minute: p.minute, period: p.hour < 12 ? "am" : "pm" }, startMs, endMs };
        await applyReschedule(b);
      },
      tellCancelled: (b) => tellCustomer(b, b.customer, ["cancelled_no_deposit"]),
      refund: (b, _paymentId, amountInr, why) => ownerCancelRefund(b, amountInr, why, { upi: "upi_refund_owed", done: "refund_approved", held: "cancelled_refund_pending" }),
    },
  });
  const assistant = assistantForAgent({
    settings, store, skill: assistantSkill, clock, messaging, record, policy, ...(deps.ownerParser ? { ownerParser: deps.ownerParser } : {}),
    // the owner's voice notes (B29 with item 11e): the same shared listener as a customer's (voice allowed, the day's count, the month's spend), never leaving the owner out
    ...(deps.voice ? { hearing: { hear: createListener({ voice: deps.voice, reader, isCommander: () => false, optedOut: () => false }) } } : {}),
    log: (caseId, phone, action, outcome, inputs, more) => log(caseId ? store.bookings.get(caseId) ?? null : null, phone, action, outcome, inputs, more),
    ownerNotice: async (notice) => { await say({ booking: null, phone: owner, to: "owner", templates: [notice === "allowance" ? "owner_ai_allowance" : notice === "override" ? "owner_ai_off" : "owner_ai_fault"] }); },
    languageOf: (phone) => languageOf(phone),
    optedOut: (phone) => store.customers.get(phone)?.optedOut ?? false,
  });

  return { handle, giveUp, freeStarts };
}

/** The owner's fixed command about something the agent asked them ("approve b-3", "deny b-3", "retry b-3"). Item 11e names it so the assistant lets it pass. */
const OWNER_COMMAND = /^\s*(approve|deny|retry)\s+(b-\d+)\s*$/i;
