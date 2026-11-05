// One student's fee for one month, as an explicit state machine, and the conversation state the agent keeps (the store).
//
//   open ──► paid      the payment record shows what is owed (the fee, and the late fee if it was added, less what the owner waived)
//     │
//     └────► closed    the owner approved taking off the whole of what is owed
//
// "paid" is only ever reached through confirmed read-backs in the record: the agent moves a fee there after it has read the payments service's own list of
// payments on the fee's links. It is never reached from what a parent says. And it is final: a refund after it does not open the fee again, so no reminder
// comes after a payment, for any reason.
import { formatDate, MONTH_NAMES } from "../../../modules/language/format.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { localParts } from "../../../modules/core/time.ts";
import type { LocalDate } from "../../../modules/core/time.ts";
import type { GuardHold, RefundIssue, RefundRetry } from "../../../modules/payments/refunds.ts";
import type { Reminder } from "../../../modules/reminders/reminders.ts";
import type { AiState } from "../../../modules/understanding/ai-state.ts";
import { batchName, batchOf } from "./settings.ts";
import type { Batch, Settings, Student } from "./settings.ts";
import type { MessageFacts } from "./language/templates.ts";

export type DueState = "open" | "paid" | "closed";

const TRANSITIONS: Record<DueState, DueState[]> = { open: ["paid", "closed"], paid: [], closed: [] };

export function canMove(from: DueState, to: DueState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Move a fee to a new state, refusing any move the flow does not allow. */
export function moveTo(due: Due, to: DueState): void {
  if (!canMove(due.state, to)) throw new Error(`A fee cannot go from ${due.state} to ${to}.`);
  due.state = to;
}

/** A payment link the agent made for this fee. A fee can have several: the balance changes (a late fee, a waiver) and a link is for one amount. */
export interface LinkRecord { id: string; url: string; reference: string; amountPaise: number }

/** A payment the agent has counted, read from the payments service's own list on one of the fee's links. */
export interface CountedPayment { id: string; amountPaise: number; linkId: string }

/**
 * Something waiting for the owner's answer, or for another try.
 *  - waiver: a parent asked for ₹W off. Above the waiver limit, so the owner is asked for THIS amount on THIS fee at THIS balance: "approve q-3".
 *  - refund_request: a parent asked for money back. The owner decides ("approve q-4"); then the refund is asked for through Guard like any other.
 *  - guard_hold, refund_retry: a refund Guard is holding for the owner, and a refund that could not be sent at all (modules/payments/refunds.ts).
 */
export type Pending =
  | { kind: "waiver"; id: string; amountInr: number; balanceAtAskInr: number; askedAtMs: number }
  | { kind: "refund_request"; id: string; amountInr: number; paymentId: string; askedAtMs: number }
  | GuardHold
  | RefundRetry;

export interface Due {
  id: string; // "f-1": also the prefix of the payment links' reference_id ("f-1.1")
  studentName: string;
  batchId: string;
  customer: string; // the parent's number
  language: Language;
  month: string; // "2026-11": the month of the due date
  dueDate: LocalDate;
  dueMs: number; // the due date at midnight in the centre's time zone
  feeInr: number; // the batch's monthly fee when the month was opened
  lateFeeInr: number; // 0 until the grace days are over and the fee is not paid
  waivedInr: number;
  state: DueState;
  links: LinkRecord[];
  linkSeq: number;
  /** The link a parent should pay now, among `links`. */
  currentLinkId?: string;
  payments: CountedPayment[];
  reminders: Reminder[];
  remindersSent: number;
  pending: Pending[];
  /** The owner said no to a waiver on this fee. The parent asking again is told that, and the owner is not asked again. (A yes, or a request that went stale, leaves the parent free to ask.) */
  waiverDenied: boolean;
  refundIssues?: RefundIssue[];
  stoppedRefunds?: string[];
  /** Each of these keeps one kind of notice from being sent again within its time, so one kind never keeps another quiet. */
  claimTellAtMs?: number; // the owner was told a parent says the fee is paid and the record shows nothing
  discountTellAtMs?: number; // the owner was told a parent asked for a discount without an amount
  linkFailTellAtMs?: number; // the owner was told the payment link could not be made
  readNoteAtMs?: number; // the record says a reminder is waiting because the payments service could not be read
}

export interface Customer {
  phone: string;
  language?: Language;
  optedOut: boolean;
  ownerAskedAtMs?: number;
}

/** All the conversation state. It is passed in, never global, so every scenario starts clean. */
export interface Store {
  dues: Map<string, Due>;
  customers: Map<string, Customer>;
  seenMessages: Set<string>;
  seenEvents: Set<string>;
  nextDue: number;
  nextRequest: number;
  /** When the agent first ran. A month whose first reminder day was before that is not chased: the centre may have collected it already. */
  startedAtMs?: number;
  /** The month's AI spend and button-mode notices. Left out until the first message. */
  ai?: AiState;
}

export function createStore(): Store {
  return { dues: new Map(), customers: new Map(), seenMessages: new Set(), seenEvents: new Set(), nextDue: 1, nextRequest: 1 };
}

export function register(store: Store, due: Due): Due {
  due.id = `f-${store.nextDue++}`;
  store.dues.set(due.id, due);
  return due;
}

export const newRequestId = (store: Store): string => `q-${store.nextRequest++}`;

/** The month key of a date: "2026-11". */
export const monthKey = (d: { year: number; month: number }): string => `${d.year}-${String(d.month).padStart(2, "0")}`;

// ---- the money, all in paise so nothing is ever a fraction -------------------------------------------------------------

/** What is owed on this fee: the fee, and the late fee if it was added, less what the owner waived. */
export const owedPaise = (due: Due): number => (due.feeInr + due.lateFeeInr - due.waivedInr) * 100;
/** What the payment record shows paid on this fee's links, as the agent has counted it. */
export const paidPaise = (due: Due): number => due.payments.reduce((n, p) => n + p.amountPaise, 0);
/** What is still to pay. Negative: more was paid than is owed, and the extra is to be refunded. */
export const balancePaise = (due: Due): number => owedPaise(due) - paidPaise(due);
export const balanceInr = (due: Due): number => Math.max(0, balancePaise(due)) / 100;

/** The fees of a parent's number, newest first. */
export function duesOf(store: Store, phone: string): Due[] {
  return [...store.dues.values()].filter((d) => d.customer === phone).reverse();
}

/** The parent's open fees, oldest due date first: the one to pay first. */
export const openDues = (store: Store, phone: string): Due[] => duesOf(store, phone).filter((d) => d.state === "open").sort((a, b) => a.dueMs - b.dueMs);

// ---- what a message may say -------------------------------------------------------------------------------------------

/** The month as a parent reads it: "November 2026", in their language. */
export function monthLabel(due: { month: string }, language: Language): string {
  const [year, month] = due.month.split("-").map(Number);
  return `${MONTH_NAMES[language][month - 1]} ${year}`;
}

/** The values of this fee's record that a message may use. Everything comes from the fee and the settings, never from message text. */
export function factsFor(settings: Settings, due: Due | null, language: Language, extra: { customerPhone?: string; refundInr?: number; receivedInr?: number; waiverInr?: number; requestRef?: string; paidInr?: number } = {}): MessageFacts {
  const batch: Batch | undefined = due ? settings.batches.find((b) => b.id === due.batchId) : undefined;
  return {
    language,
    timeZone: settings.timezone,
    businessName: settings.name,
    studentName: due?.studentName,
    batchName: batch ? batchName(batch, language) : undefined,
    monthLabel: due ? monthLabel(due, language) : undefined,
    feeInr: due?.feeInr,
    lateFeeInr: due && due.lateFeeInr > 0 ? due.lateFeeInr : undefined,
    balanceInr: due ? balanceInr(due) : undefined,
    paidInr: extra.paidInr ?? (due ? paidPaise(due) / 100 : undefined),
    receivedInr: extra.receivedInr,
    waiverInr: extra.waiverInr,
    refundInr: extra.refundInr,
    waiverLimitInr: settings.waiver.limitInr,
    dueMs: due?.dueMs,
    graceDays: settings.due.graceDays,
    link: due ? due.links.find((l) => l.id === due.currentLinkId)?.url : undefined,
    dueRef: due?.id,
    requestRef: extra.requestRef,
    customerPhone: extra.customerPhone ?? due?.customer,
  };
}

/** A student of the centre as the first of the month's fees is opened for. */
export function newDue(settings: Settings, student: Student, language: Language, month: string, dueDate: LocalDate, dueMs: number): Due {
  const batch = batchOf(settings, student);
  return {
    id: "", studentName: student.name, batchId: batch.id, customer: student.parent, language, month, dueDate, dueMs,
    feeInr: batch.monthlyFeeInr, lateFeeInr: 0, waivedInr: 0, state: "open", links: [], linkSeq: 0, payments: [], reminders: [], remindersSent: 0, pending: [], waiverDenied: false,
  };
}

/** The date a message states for a due date is checked with `formatDate`; this is that date as a parent reads it, for the report and the tests. */
export const dueDateText = (due: Due, settings: Settings, language: Language): string => formatDate(localParts(due.dueMs, settings.timezone), language);
