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
import type { Language, Settings } from "./settings.ts";
import { serviceName } from "./settings.ts";
import type { LocalDate, LocalTime } from "./time.ts";
import { HOUR } from "./time.ts";
import type { TimePhrase } from "./language/dates.ts";
import type { MessageFacts } from "./language/templates.ts";

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

/** Something waiting for the owner's answer on WhatsApp. */
export type Pending =
  | { kind: "refund"; amountInr: number; paymentId: string; reason: "late_cancellation" | "over_limit" | "refund_failed" }
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
  reminders: { atMs: number; sent: boolean }[];
  pending: Pending[];
  /** A move to a new time that is waiting for the customer's yes. */
  reschedule?: { date: LocalDate; timePhrase: TimePhrase; startMs: number; endMs: number };
}

export interface Customer {
  phone: string;
  language?: Language;
  optedOut: boolean;
}

/** All the conversation state. It is passed in, never global, so every scenario starts clean. */
export interface Store {
  bookings: Map<string, Booking>;
  customers: Map<string, Customer>;
  seenMessages: Set<string>; // WhatsApp message ids already handled
  seenEvents: Set<string>; // payment event ids already handled
  nextBooking: number;
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
export function factsFor(settings: Settings, booking: Booking | null, language: Language, extra: { customerPhone?: string; refundInr?: number; slotMs?: number } = {}): MessageFacts {
  const service = booking?.serviceId ? settings.services.find((s) => s.id === booking.serviceId) : undefined;
  return {
    language,
    timeZone: settings.timezone,
    businessName: settings.name,
    services: settings.services.map((s) => ({ name: serviceName(s, language), priceInr: s.priceInr })),
    serviceName: service ? serviceName(service, language) : undefined,
    priceInr: service?.priceInr,
    depositInr: booking?.depositInr ?? settings.deposit.amountInr,
    refundInr: extra.refundInr,
    slotMs: extra.slotMs ?? booking?.startMs,
    link: booking?.linkUrl,
    holdMinutes: settings.deposit.holdMinutes,
    windowHours: settings.cancellation.windowHours,
    bookingRef: booking?.id || undefined,
    customerPhone: extra.customerPhone ?? booking?.customer,
  };
}

/** When the reminders are due: each configured number of hours before the start, skipping any that is already past. */
export function reminderSchedule(settings: Settings, startMs: number, nowMs: number): { atMs: number; sent: boolean }[] {
  return settings.reminders.hoursBefore.map((h) => startMs - h * HOUR).filter((at) => at > nowMs).map((atMs) => ({ atMs, sent: false }));
}
