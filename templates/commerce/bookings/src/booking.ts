// A booking as an explicit state machine, and the conversation state the agent keeps (the store).
//
//   enquiry ─► confirming_details ─► awaiting_deposit ─► confirmed ─► completed
//      │             │                  │   │              │  ▲
//      │             │                  │   ▼              │  └─ reschedule (same state, new time)
//      │             │                  │ needs_owner ─────┤
//      ▼             ▼                  ▼   (calendar        ▼
//   cancelled     cancelled          expired ─► awaiting_deposit (a late payment, slot still free)
//                                       └─► cancelled        cancelled (refund within limit, or the owner decides)
//
// "confirmed" is only ever reached through confirmed read-backs in the record: the agent moves a booking there after
// the calendar shows the event AND the payments record shows the deposit.
import type { Settings } from "./settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { serviceName } from "./settings.ts";
import type { LocalDate, LocalTime } from "../../../../modules/core/time.ts";
import { hoursBefore, scheduleAround } from "../../../../modules/reminders/reminders.ts";
import type { Reminder } from "../../../../modules/reminders/reminders.ts";
import type { TimePhrase } from "../../../../modules/language/dates.ts";
import type { MessageFacts, TemplateId } from "./language/templates.ts";
import type { AiState } from "../../../../modules/understanding/ai-state.ts";
import type { GuardHold, RefundIssue, RefundRetry, UntoldRefund } from "../../../../modules/payments/refunds.ts";
import type { MarkState } from "../../../../modules/payments/owner-marked/ledger.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";

export type BookingState =
  | "enquiry" | "confirming_details" | "awaiting_deposit" | "needs_owner" | "confirmed" | "expired" | "cancelled" | "completed";

const TRANSITIONS: Record<BookingState, BookingState[]> = {
  enquiry: ["confirming_details", "awaiting_deposit", "cancelled"],
  confirming_details: ["enquiry", "awaiting_deposit", "cancelled"],
  awaiting_deposit: ["confirmed", "needs_owner", "expired", "cancelled", "enquiry"], // enquiry: the hold or link failed, start again
  needs_owner: ["confirmed", "cancelled"],
  confirmed: ["confirmed", "cancelled", "completed"], // confirmed -> confirmed is a reschedule
  expired: ["awaiting_deposit", "cancelled"], // a payment that arrives late
  cancelled: [],
  completed: [],
};

export const LIVE_STATES: BookingState[] = ["enquiry", "confirming_details", "awaiting_deposit", "needs_owner", "confirmed"];

export function canMove(from: BookingState, to: BookingState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Move a booking to a new state, refusing any move the flow does not allow. */
export function moveTo(booking: Booking, to: BookingState): void {
  if (!canMove(booking.state, to)) throw new Error(`A booking cannot go from ${booking.state} to ${to}.`);
  booking.state = to;
}

/**
 * Something waiting for an answer, or for another try.
 *  - refund: the owner's own call about a refund WITHIN the limit (a late cancellation), asked by the agent as "approve b-3".
 *    A refund ABOVE the limit is not asked by the agent at all: Guard holds it, and the approvals relay asks the owner, once.
 *  - guard_hold: a refund Guard is holding for the owner (modules/payments/refunds.ts). It keeps the approval id and the EXACT bytes of the call that was held:
 *    after the relay says the owner approved, those same bytes are sent again, once. It is never sent again on a timer.
 *  - refund_retry: a refund that could not be sent at all (nothing went out). The agent tries again by itself, a few times.
 *  - calendar: the calendar would not confirm a paid booking; the owner can retry or cancel and refund.
 */
export type Pending =
  | { kind: "refund"; amountInr: number; paymentId: string; reason: "late_cancellation" }
  | GuardHold
  | RefundRetry
  | { kind: "calendar" };

export interface Booking {
  id: string; // "b-1": also the calendar event's bookingRef and the payment link's reference_id
  customer: string;
  language: Language;
  state: BookingState;
  serviceId?: string;
  // what the customer asked for, as the agent understood it
  date?: LocalDate;
  timePhrase?: TimePhrase;
  time?: LocalTime;
  dateNeedsConfirmation: boolean; // a weekday phrase: read it back and wait for a yes
  timeInferred: boolean; // no am/pm was given: read it back and wait for a yes
  startMs?: number;
  endMs?: number;
  // what the services' records say
  eventId?: string;
  holdExpiresAt?: number;
  linkId?: string;
  linkUrl?: string;
  depositPaymentId?: string;
  depositInr?: number;
  handledPayments: string[]; // payments already dealt with (the deposit, or an extra one that was refunded or sent to the owner)
  reminders: Reminder[];
  pending: Pending[];
  /** Refunds that need the builder (never the owner): see RefundIssueKind. Counted in the runtime's status. */
  refundIssues?: RefundIssue[];
  /** Payments the agent must not ask Guard to refund again: the owner said no, the outcome is unclear, it failed for good, or the approval ran out. */
  stoppedRefunds?: string[];
  /** Refunds the payments service's list settled whose customer has not been told yet (modules/payments/refunds.ts): listed on the to-do list until a message is accepted. */
  refundsUntold?: UntoldRefund[];
  /** A move to a new time that is waiting for the customer's yes. */
  reschedule?: { date: LocalDate; timePhrase: TimePhrase; startMs: number; endMs: number };
  /** UPI (B33): when the owner was last told that this customer says they paid (at most once an hour). */
  claimTellAtMs?: number;
}

export interface Customer {
  phone: string;
  language?: Language;
  optedOut: boolean;
  /** When this customer last asked to talk to the owner (the owner is told at most once an hour about the same person). */
  ownerAskedAtMs?: number;
}

/** All the conversation state. It is passed in, never global, so every scenario starts clean. */
export interface Store {
  bookings: Map<string, Booking>;
  customers: Map<string, Customer>;
  seenMessages: Set<string>; // WhatsApp message ids already handled
  seenEvents: Set<string>; // payment event ids already handled
  nextBooking: number;
  /** The month's AI spend and button-mode notices. Left out until the first message. */
  ai?: AiState;
  /** An owner-marked shop's requests, the owner's marks and the refunds the owner owes (modules/payments/owner-marked/ledger.ts). Kept under `upi`, as it always was. Left out until the first request. */
  upi?: MarkState;
  /** A shop with no Google Calendar (settings "calendar": {"module": "own"}): the calendar view of its own bookings (src/adapters/own-calendar.ts). Left out for a Google shop. */
  ownCalendar?: { events: Record<string, import("./adapters/calendar.ts").CalendarEvent>; next: number };
  /** Which calendar the bookings were last written to ("own" or "google"), so a calendar added later is filled from the booking list once (agent.ts, backfill). */
  calendarState?: { kind: "own" | "google" };
}

export function createStore(): Store {
  return { bookings: new Map(), customers: new Map(), seenMessages: new Set(), seenEvents: new Set(), nextBooking: 1 };
}

export function newDraft(customer: string, language: Language): Booking {
  return { id: "", customer, language, state: "enquiry", dateNeedsConfirmation: false, timeInferred: false, handledPayments: [], reminders: [], pending: [] };
}

/** Give a draft its id and keep it. */
export function register(store: Store, booking: Booking): Booking {
  booking.id = `b-${store.nextBooking++}`;
  store.bookings.set(booking.id, booking);
  return booking;
}

/** The customer's most recent booking in one of these states. */
export function latestBooking(store: Store, customer: string, states: BookingState[]): Booking | undefined {
  return [...store.bookings.values()].reverse().find((b) => b.customer === customer && states.includes(b.state));
}

/** The values of this booking's record that a message may use. Everything comes from the booking and the settings, never from message text. */
export function factsFor(settings: Settings, booking: Booking | null, language: Language, extra: { customerPhone?: string; refundInr?: number; slotMs?: number; slotChoices?: number[]; menu?: boolean; upiCode?: string; markedInr?: number; leftInr?: number; day?: "today" | "tomorrow"; dayBookings?: MessageFacts["dayBookings"] } = {}): MessageFacts {
  const payTo = ownerMarkedOf(settings.payment)?.payTo; // who the customer pays, when the owner marks payments (B71)
  const service = booking?.serviceId ? settings.services.find((s) => s.id === booking.serviceId) : undefined;
  return {
    language,
    timeZone: settings.timezone,
    businessName: settings.name,
    // Only the menu may state every service's price; any other message may state this booking's own service and nothing else.
    services: (extra.menu ? settings.services : service ? [service] : []).map((s) => ({ name: serviceName(s, language), priceInr: s.priceInr })),
    serviceName: service ? serviceName(service, language) : undefined,
    priceInr: service?.priceInr,
    depositInr: booking?.depositInr ?? settings.deposit.amountInr,
    refundInr: extra.refundInr,
    slotMs: extra.slotMs ?? booking?.startMs,
    ...(extra.slotChoices ? { slotChoices: extra.slotChoices } : {}),
    link: booking?.linkUrl,
    holdMinutes: settings.deposit.holdMinutes,
    windowHours: settings.cancellation.windowHours,
    bookingRef: booking?.id || undefined,
    customerPhone: extra.customerPhone ?? booking?.customer,
    ...(payTo ? { upiId: payTo.id, payee: payTo.name } : {}),
    ...(extra.upiCode ? { upiCode: extra.upiCode } : {}),
    ...(extra.markedInr !== undefined ? { markedInr: extra.markedInr } : {}),
    ...(extra.leftInr !== undefined ? { leftInr: extra.leftInr } : {}),
    ...(extra.day ? { day: extra.day, dayBookings: extra.dayBookings ?? [] } : {}),
  };
}

/** When the reminders are due: each configured number of hours before the start, skipping any that is already past (modules/reminders/reminders.ts). */
export function reminderSchedule(settings: Settings, startMs: number, nowMs: number): Reminder[] {
  return scheduleAround(startMs, hoursBefore(settings.reminders.hoursBefore), nowMs);
}
