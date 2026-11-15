// The owner's money view: what the Money section of the owner's app shows, as plain figures in paise, worked out from the journal and the record alone.
//
// Why a pure view model apart from the page (owner-money-render.ts): the figures are what must be right, so they are tested one by one on a real record; the page
// only words them. It reads the Journal (the one reader of the accounts), the record's entries (for the UPI payments a customer says they made and the owner has
// not marked: payments/owner-marked/obligations.ts), and the refunds made whose customer has not been told (cases' `refundsUntold`, handed in as a plain list
// because a case belongs to a template). It reads no clock and no settings: "now" and the shop's time zone are handed in.
//
// What counts:
//  - received: the money lines of a `received` fact (the payment's own side: cash, UPI, bank or gateway), so a payment counts once with its amount;
//  - given back: the money lines of a `refund_made` fact, except a refund settled by a person's word (Guard's `already_done`, evidence person_word): nobody saw that
//    money move, so it is listed on its own and left out of the totals;
//  - kept from cancellations: what `revenue:kept` holds in the month; gateway charges: the charge and the GST on it, when any were posted (settlements, a later step);
//  - still to come (Fees only): what the open fees are still owed, all time, not just this month, with the count of open fees. Null for a shop that has no fees;
//  - owed back: Journal.owedList(); not matched: what the books cannot match to money on their own. For a payment service shop (settlements.ts reads what it paid
//    into the bank): a payment with no settlement after more than 4 working days (Monday to Friday, in the shop's time zone; bank holidays are not known, so a
//    holiday week can say "not yet" a day early), a row the service is holding, and a payout for a payment that did not go through the assistant.
// A customer's number and a student's name are never in the view: a case id is the only way a person is named, and obligations' `customer` is dropped here.
import { ACCOUNTS } from "./accounts.ts";
import { MONEY_REFS } from "./journal.ts";
import type { Journal, Line } from "./journal.ts";
import { dayRange, monthRange } from "./periods.ts";
import type { Range } from "./periods.ts";
import { addDays, daysBetween, localParts, weekdayOf } from "../core/time.ts";
import { SETTLEMENT_ACTIONS } from "./settlements.ts";
import { markObligations } from "../payments/owner-marked/obligations.ts";
import type { RecordEntry } from "../record/record.ts";

/** A refund made whose customer was not told yet, as the cases hold it (UntoldRefund) with the case it belongs to. Rupees, as the provider's list gives them. */
export interface UntoldInput { case: string; amountInr: number }

export interface MoneyViewInput {
  journal: Journal;
  entries: readonly RecordEntry[];
  refundsUntold: readonly UntoldInput[];
  nowMs: number;
  timeZone: string;
}

export interface Tally { paise: number; count: number }

/** Why a refund is still owed, in two kinds: the owner pays it by hand (a UPI refund the owner marks done), or it waits to go back through the payment service. */
export type OwedWhy = "owner_pays_upi" | "payment_service";

export type NotMatched =
  | { kind: "upi_claim"; case: string | null; paise: number }
  /** `sinceMs`: when the money came, so the page can say "paid on 12 Nov". */
  | { kind: "gateway"; case: string | null; paise: number; sinceMs: number }
  /** The payment service is holding this payment's payout (a row with `on_hold`): it is not in the bank. */
  | { kind: "gateway_held"; case: string | null; paise: number }
  /** The payment service paid out a payment the assistant never took: left out of the books, listed here so the owner knows. */
  | { kind: "not_through_assistant"; paise: number }
  | { kind: "untold_refund"; case: string | null; paise: number };

export interface MoneyView {
  today: { received: Tally; givenBack: Tally };
  month: {
    received: Tally; givenBack: Tally; keptPaise: number;
    /** The payment service's charges with the GST on them; 0 when none were posted (the page then shows no line). */
    gatewayChargesPaise: number;
    /** Fees only: what the open fees are still owed, and how many fees are open. Null when the shop has no fees. */
    stillToCome: Tally | null;
  };
  /** Refunds made in the month on a person's word: listed, never in the totals. */
  byWord: { case: string | null; paise: number; atMs: number }[];
  owedBack: { case: string | null; paise: number; why: OwedWhy }[];
  notMatched: NotMatched[];
  /** The shop's month as "2026-11", for the page's links and labels. */
  period: string;
}

const MONEY_ACCOUNTS: ReadonlySet<string> = new Set([ACCOUNTS.cash.code, ACCOUNTS.upi.code, ACCOUNTS.bank.code, ACCOUNTS.gateway.code, ACCOUNTS.bankSettled.code]);

/** Whole paise of rupees the provider's list gave (always whole paise; rounded only to undo the float of the division). */
/** Working days after a payment's day, up to and including today (Monday to Friday, local dates). */
function workingDaysSince(thenMs: number, nowMs: number, timeZone: string): number {
  const from = localParts(thenMs, timeZone);
  const days = daysBetween(from, localParts(nowMs, timeZone));
  let n = 0;
  for (let k = 1; k <= days; k++) { const w = weekdayOf(addDays(from, k)); if (w !== 0 && w !== 6) n++; }
  return n;
}
/** A gateway payment is "not yet in your bank" once more than this many working days have passed. */
const SETTLES_WITHIN_WORKING_DAYS = 4;

const toPaise = (inr: number): number => Math.round(inr * 100);

function tally(lines: readonly Line[], kind: Line["kind"], side: "debitPaise" | "creditPaise", range: Range, keep: (l: Line) => boolean = () => true): Tally {
  const seqs = new Set<number>();
  let paise = 0;
  for (const l of lines) {
    const at = Date.parse(l.at);
    if (l.kind !== kind || !MONEY_ACCOUNTS.has(l.account) || l[side] === 0 || at < range.fromMs || at >= range.toMs || !keep(l)) continue;
    paise += l[side];
    seqs.add(l.seq);
  }
  return { paise, count: seqs.size };
}

/** What an account holds over a range: debits less credits. */
function net(lines: readonly Line[], accounts: readonly string[], range: Range): number {
  let n = 0;
  for (const l of lines) {
    const at = Date.parse(l.at);
    if (accounts.includes(l.account) && at >= range.fromMs && at < range.toMs) n += l.debitPaise - l.creditPaise;
  }
  return n;
}

/** The refund's owner-paid kind: the owner-marked ledger's ids are `upr-N`; a gateway refund's key is `<case>:<payment>` (post.ts MoneyEvent.owed). */
const owedWhy = (key: string): OwedWhy => (/^upr-\d+$/u.test(key) ? "owner_pays_upi" : "payment_service");

export function ownerMoney(i: MoneyViewInput): MoneyView {
  const lines = i.journal.lines;
  const day = dayRange(i.nowMs, i.timeZone);
  const p = localParts(i.nowMs, i.timeZone);
  const month = monthRange(p.year, p.month, i.timeZone);
  const byWordLine = (l: Line): boolean => l.evidence === "person_word";
  const stillToCome = (): Tally | null => {
    const cases = new Set<string | null>();
    for (const l of lines) if (l.account === ACCOUNTS.receivable.code) cases.add(l.case);
    if (cases.size === 0) return null;
    let paise = 0;
    let count = 0;
    for (const c of cases) {
      const owed = c === null ? 0 : i.journal.receivableOf(c); // negative: paid beyond the fee, which is not "still to come"
      if (owed > 0) { paise += owed; count++; }
    }
    return { paise, count };
  };

  const byWord = lines
    .filter((l) => l.kind === "refund_made" && byWordLine(l) && l.creditPaise > 0 && MONEY_ACCOUNTS.has(l.account) && Date.parse(l.at) >= month.fromMs && Date.parse(l.at) < month.toMs)
    .map((l) => ({ case: l.case, paise: l.creditPaise, atMs: Date.parse(l.at) }));

  // Payments the payment service has paid into the bank (a `settled` row), and what is held or was not through the assistant, from the record's own settlement lines.
  const settledEntities = new Set<string>();
  for (const e of i.entries) if (e.refs[MONEY_REFS.kind] === "settled") settledEntities.add(e.refs[MONEY_REFS.entity]);
  const seqRefs = new Map(i.entries.map((e) => [e.seq, e.refs]));
  // A payment that came through the payment service and has no payout after more than 4 working days, while its case still holds money there.
  const heldInGateway = new Map<string | null, number>();
  for (const l of lines) if (l.account === ACCOUNTS.gateway.code) heldInGateway.set(l.case, (heldInGateway.get(l.case) ?? 0) + l.debitPaise - l.creditPaise);
  const listed = (why: string): RecordEntry[] => i.entries.filter((e) => e.action === SETTLEMENT_ACTIONS.listed && e.refs.why === why && Date.parse(e.time) >= month.fromMs && Date.parse(e.time) < month.toMs);
  const once = (rows: RecordEntry[]): RecordEntry[] => rows.filter((e, n) => rows.findIndex((o) => o.refs.entity === e.refs.entity) === n);
  // A held row is listed as held, and not also as "not yet in your bank". Held and not-through-the-assistant rows are listed for the month they were found in.
  const heldRows = once(listed("held")).filter((e) => !settledEntities.has(e.refs.entity));
  const heldIds = new Set(heldRows.map((e) => e.refs.entity));
  const gatewayUnpaid: NotMatched[] = [];
  for (const l of lines) {
    const paymentId = l.kind === "received" && l.account === ACCOUNTS.gateway.code && l.debitPaise > 0 ? seqRefs.get(l.seq)?.[MONEY_REFS.paymentId] : undefined;
    if (paymentId === undefined || settledEntities.has(paymentId) || heldIds.has(paymentId) || (heldInGateway.get(l.case) ?? 0) <= 0) continue;
    if (workingDaysSince(Date.parse(l.at), i.nowMs, i.timeZone) > SETTLES_WITHIN_WORKING_DAYS) gatewayUnpaid.push({ kind: "gateway", case: l.case, paise: l.debitPaise, sinceMs: Date.parse(l.at) });
  }
  const held: NotMatched[] = heldRows.map((e) => ({ kind: "gateway_held", case: e.booking, paise: Number(e.refs.amountPaise) }));
  const notThrough: NotMatched[] = once(listed("unknown_payment")).filter((e) => e.refs.rowType === "payment").map((e) => ({ kind: "not_through_assistant", paise: Number(e.refs.amountPaise) }));

  const notMatched: NotMatched[] = [
    ...markObligations(i.entries).filter((o) => o.kind === "upi_payment_unconfirmed").map((o): NotMatched => ({ kind: "upi_claim", case: o.case || null, paise: o.amountPaise })),
    ...gatewayUnpaid, ...held, ...notThrough,
    ...i.refundsUntold.map((u): NotMatched => ({ kind: "untold_refund", case: u.case, paise: toPaise(u.amountInr) })),
  ];

  return {
    today: { received: tally(lines, "received", "debitPaise", day), givenBack: tally(lines, "refund_made", "creditPaise", day, (l) => !byWordLine(l)) },
    month: {
      received: tally(lines, "received", "debitPaise", month),
      givenBack: tally(lines, "refund_made", "creditPaise", month, (l) => !byWordLine(l)),
      keptPaise: -net(lines, [ACCOUNTS.kept.code], month),
      gatewayChargesPaise: net(lines, [ACCOUNTS.gatewayFees.code, ACCOUNTS.gstOnFees.code], month),
      stillToCome: stillToCome(),
    },
    byWord,
    owedBack: i.journal.owedList().map((o) => ({ case: o.case, paise: o.paise, why: owedWhy(o.key) })),
    notMatched,
    period: `${p.year}-${String(p.month).padStart(2, "0")}`,
  };
}
