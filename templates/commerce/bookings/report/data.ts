// The monthly report as plain data, counted from the action record. Nothing here is written by a model, estimated or
// guessed: every number is a count of record entries (or a sum of amounts the record itself kept), and anything the
// record cannot tell us is listed under "not counted" or "missing" instead of being filled in.
//
// What the record is, and how it is counted (the rules are pinned by test/report-data.test.ts):
//  - The WHOLE record goes in, not one month of it: earlier entries give context (a booking confirmed in October may be
//    cancelled in November). The month is [from, to) in the shop's time zone, compared with each entry's own time.
//  - Things are counted when the action happened, not by appointment date, and each thing is counted once: a booking is
//    "made" by its first confirmed confirm_booking, a deposit by its payment id, a refund by its refund id.
//  - A limit "stopped" something at ONE place in the record. A block is written twice (on hold_slot or reschedule_booking,
//    and again as the reason shown on the message that follows), so each rule is counted at its own entry only.
//  - Only "unconfirmed" and "failed" outcomes are counted as such, never "attempted" (an attempt is checked in the next step).
import { readFileSync } from "node:fs";
import { NOT_TESTED, notTestedOf } from "../crash-test/not-tested.ts";
import type { NotTestedId } from "../crash-test/not-tested.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { Booking } from "../src/booking.ts";
import type { Action, Outcome, RecordEntry, RuleId } from "../../../../modules/record/record.ts";
import { canonicalJson } from "../../../../modules/record/record.ts";
import { localParts, zonedToMs } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { digestOf } from "../../../../modules/report/digest.ts";
import { headOf } from "../../../../modules/record/ledger.ts";
import type { LedgerHead } from "../../../../modules/record/ledger.ts";
import { SOURCES } from "../../../../modules/report/text.ts";
import type { Source } from "../../../../modules/report/text.ts";

/** What the numbers were counted from. Always stated, never assumed: a report made from stand-ins must say so. */
export { SOURCES };
export type { Source };

export const PATHWAY = readPathway();

function readPathway(): { name: string; version: string } {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  if (!pkg.version) throw new Error("templates/commerce/bookings/package.json has no version.");
  return { name: "bookings", version: pkg.version };
}

export const RULE_IDS: readonly RuleId[] = [
  "price-at-or-above-list", "within-hours", "no-double-booking", "confirm-only-when-recorded", "one-deposit-per-booking",
  "refund-limit", "no-message-after-stop", "message-matches-record", "opt-out",
];

/** Things the record cannot tell us, so the report does not say them. Always listed. */
export type NotCountedId = "no-shows" | "read-receipts" | "outside-agent" | "rule-breaks";
export const NOT_COUNTED: readonly NotCountedId[] = ["no-shows", "read-receipts", "outside-agent", "rule-breaks"];

/**
 * What the checks behind an agent do not cover: the hand check's list, plus one more when the checks are not shown to have run on this shop's
 * own settings: "own-settings" (they ran on the example shop, Glow Salon), "other-settings" (on some other settings), "no-go-live-certificate"
 * (the monthly report was given none), "go-live-untrusted" (it was given one it could not trust), or "situations-skipped" when they did run
 * on this shop's settings but some situations could not be run on them.
 */
export type NotTestedKey = NotTestedId | "own-settings" | "other-settings" | "no-go-live-certificate" | "go-live-untrusted" | "situations-skipped";

/**
 * What the monthly report was told about the go-live checks, from the go-live certificate it was given (report/go-live.ts reads and checks one). The type is the same for
 * every template (modules/report/go-live.ts, which says what each status means): `own` says the checks ran on this shop's own settings, `example` that they ran on Glow
 * Salon's example settings, `different` on any other settings.
 */
export type { GoLiveFinding, GoLiveSeen } from "../../../../modules/report/go-live.ts";
import type { GoLiveFinding } from "../../../../modules/report/go-live.ts";

/**
 * The actions that are a message going out. A reply to a voice note ("please type") is one too: it is counted in "messages sent" and, when it
 * is lost, among the messages that are not confirmed, and it never makes the owner's "could not confirm" line, which counts bookings.
 * Any other action name the report does not know is counted only in the page's table by action, and nowhere else.
 */
const MESSAGE_ACTIONS: readonly Action[] = ["send_message", "voice_note_reply"];

/** The entry where a rule's "no" is counted (see the header: a block is written twice). */
const STOP_SITES: Record<RuleId, readonly Action[]> = {
  "price-at-or-above-list": MESSAGE_ACTIONS,
  "within-hours": ["hold_slot", "reschedule_booking"],
  "no-double-booking": ["hold_slot", "reschedule_booking"],
  "confirm-only-when-recorded": MESSAGE_ACTIONS,
  "one-deposit-per-booking": ["record_deposit"],
  "refund-limit": ["refund"],
  "no-message-after-stop": MESSAGE_ACTIONS,
  "message-matches-record": MESSAGE_ACTIONS,
  "opt-out": MESSAGE_ACTIONS,
};

/** Actions whose unconfirmed or failed entry can be settled by a later confirmed entry for the same booking. */
const SETTLEABLE: readonly Action[] = ["hold_slot", "create_deposit_link", "record_deposit", "confirm_booking", "reschedule_booking", "refund", "release_slot", "cancel_deposit_link"];

export interface Amount { count: number; paise: number }
export type ByLanguage = Record<Language, number>;

export interface RecordRow {
  seq: number;
  time: string;
  action: Action;
  outcome: Outcome;
  booking: string | null; // "b-3"; never a phone number
  inputsDigest: string; // the record's own 16-digit fingerprint of what the action was asked
  digest: string; // sha256 of the whole entry without the customer's number
}

export interface MonthlyReport {
  format: "geometer-monthly-report/1";
  pathway: { name: string; version: string };
  source: Source;
  shop: { name: string; timeZone: string; languages: Language[]; ownerLanguage: Language };
  preparedBy: string | null; // who set it up, as the caller wrote it
  period: { from: string; to: string; firstDay: LocalDate; lastDay: LocalDate; month: { year: number; month: number } | null };
  madeAt: string;
  policyDigest: string;
  record: { entries: number; digest: string; byAction: Record<string, Record<string, number>>; rows: RecordRow[] };
  bookings: { made: number; cancelled: number; moved: number; droppedBeforeBooked: number };
  money: { deposits: Amount; refunds: Amount & { ofDeposits: Amount; ofSecondPayments: Amount } };
  owner: { asked: number; approved: number; denied: number; retried: number };
  stopped: { total: number; byRule: Record<RuleId, number> };
  messages: { toCustomers: { total: number; byLanguage: ByLanguage }; toOwner: { total: number; byLanguage: ByLanguage }; heldBack: number };
  unconfirmed: { open: number; /** The open ones that touch a booking, a payment or the calendar: everything but a message. This is what the owner's line counts. */ openOnBookings: number; settledLater: number; rows: { seq: number; action: Action; outcome: "unconfirmed" | "failed"; booking: string | null; settledLater: boolean }[] };
  atReportTime: { waitingForOwner: number; paidNotBooked: number };
  /** Entries that should carry a detail (an amount, a command, who a message went to) and do not, so that count is incomplete. */
  missing: { depositAmounts: number; refundAmounts: number; ownerCommands: number; messageTargets: number };
  notCounted: NotCountedId[];
  notTested: NotTestedKey[];
  /** What the report was told about the go-live checks: no certificate, one it could not trust, or one it read and what that says the checks ran on. */
  goLive: GoLiveFinding;
  /**
   * Present, and true, only when the builder or partner who sends this report has the Innovator badge (fleet's answer for the shop). It is part of the signed
   * bytes, so the badge on the page is the one that was signed. Left out otherwise, which keeps the bytes (and the digest and code) of every report made without it.
   */
  innovator?: true;
  /**
   * Present only for a UPI shop (B33): its deposits and refunds are what the owner MARKED (received, sent), not what a payment service shows, and every document
   * labels them so. Left out for a Razorpay shop, which keeps the bytes (and the digest and code) of every report made before.
   */
  paidBy?: "owner-marked";
  /**
   * The head of the shop's record as a hash-chained ledger (modules/record/ledger.ts) when the report was made: the last entry's number and hash, over the whole record handed
   * in. A later change to any entry it covers gives a different hash, which no longer matches this one or the daily fingerprint. null when the caller named no ledger
   * (`ledger` below), which keeps the bytes of every report made before. Part of the signed bytes.
   */
  anchor: LedgerHead | null;
}

export interface ReportInput {
  settings: Settings;
  /** The whole record, oldest first. */
  entries: readonly RecordEntry[];
  /** The conversation store's bookings as they are when the report is made. Used only for what is waiting right now. */
  bookings: readonly Booking[];
  /** The month: from (included) to (not included), in epoch milliseconds. See monthRange. */
  from: number;
  to: number;
  source: Source;
  /** When the report is made (epoch milliseconds). Passed in, never read from the machine, so the same input gives the same report. */
  madeAt: number;
  preparedBy?: string;
  /** Whether the builder or partner has the Innovator badge. Left out or false: no badge, and nothing about it in the signed bytes. */
  innovator?: boolean;
  /** What the go-live certificate the caller was given says (report/go-live.ts). Left out, the report says that no go-live certificate was given. */
  goLive?: GoLiveFinding;
  /** Which agent the record is of. Left out, the bookings pathway. An agent someone else wrote (deploy bundle, `agent report`) says so here, and the page and the certificate repeat it. */
  pathway?: { name: string; version: string };
  /** The ledger to anchor the report to: its tenant (the shop's id on the server). Left out, `anchor` is null. */
  ledger?: { tenant: string };
}

/** What governs how the agent behaves and speaks, without contact details. Two shops with the same policy digest have the same limits and words. */
export function policyOf(settings: Settings): unknown {
  const { address: _address, owner, ...rest } = settings;
  return { ...rest, owner: { language: owner.language } };
}
export const policyDigest = (settings: Settings): string => digestOf(policyOf(settings));

/** The example settings the hand check runs on when it is not given others. A go-live certificate whose checks ran on different settings from the shop's has to say so. The monthly report no longer assumes anything about this: it is told what ran (see GoLiveFinding). */
export const checkedPolicyDigest = (): string => policyDigest(glowSalon());

/**
 * What the checks behind this shop's agent do not cover. `ran` says what the hand check ran on: the digest of the settings it used
 * (Glow Salon's, when left out) and how many situations those settings could not run.
 */
export function notTestedFor(settings: Settings, ran: { onPolicyDigest?: string; notRun?: number } = {}): NotTestedKey[] {
  const ids: NotTestedKey[] = notTestedOf(settings).map((n) => n.id);
  if (policyDigest(settings) !== (ran.onPolicyDigest ?? checkedPolicyDigest())) return [...ids, "own-settings"];
  return (ran.notRun ?? 0) > 0 ? [...ids, "situations-skipped"] : ids;
}

/** What the monthly report lists as not tested: the hand check's list, and one more unless a go-live certificate shows the checks ran on this shop's own settings with nothing left out. */
export function notTestedForReport(goLive: GoLiveFinding, settings?: Settings): NotTestedKey[] {
  const ids: NotTestedKey[] = (settings ? notTestedOf(settings) : NOT_TESTED).map((n) => n.id);
  switch (goLive.status) {
    case "own": return goLive.notRun > 0 ? [...ids, "situations-skipped"] : ids;
    case "example": return [...ids, "own-settings"];
    case "different": return [...ids, "other-settings"];
    case "untrusted": return [...ids, "go-live-untrusted"];
    case "none": return [...ids, "no-go-live-certificate"];
  }
}

const zeroByLanguage = (): ByLanguage => Object.fromEntries(LANGUAGES.map((l) => [l, 0])) as ByLanguage;
const bump = (counts: Record<string, number>, key: string) => { counts[key] = (counts[key] ?? 0) + 1; };

/** The fingerprint of one record entry. The customer's number is left out: the digest must not carry it. */
export function entryDigest(entry: RecordEntry): string {
  const { conversation: _conversation, ...rest } = entry;
  return digestOf(rest);
}

export function buildMonthlyReport(input: ReportInput): MonthlyReport {
  const { settings, bookings, from, to, source, madeAt } = input;
  const goLive: GoLiveFinding = input.goLive ?? { status: "none" };
  if (!(from < to)) throw new Error("The report period must end after it starts.");
  if (!SOURCES.includes(source)) throw new Error(`Say what the numbers were counted from: ${SOURCES.join(", ")}.`);
  const all = [...input.entries].filter((e) => Date.parse(e.time) < to).sort((a, b) => a.seq - b.seq); // nothing after the period can matter
  const timeOf = new Map(all.map((e) => [e.seq, Date.parse(e.time)]));
  const inPeriod = (e: RecordEntry) => (timeOf.get(e.seq) as number) >= from;
  const month = all.filter(inPeriod);

  // ---- bookings: each counted once, at the first confirmed entry ----
  const firstConfirmed = firstBy(all, (e) => e.action === "confirm_booking" && e.outcome === "confirmed" && e.booking !== null, (e) => e.booking as string);
  const firstCancel = firstBy(all, (e) => e.action === "cancel_booking" && e.outcome === "confirmed" && e.booking !== null, (e) => e.booking as string);
  let cancelled = 0;
  let dropped = 0;
  const made = [...firstConfirmed.values()].filter(inPeriod).length;
  for (const [id, e] of firstCancel) {
    if (!inPeriod(e)) continue;
    const wasBooked = firstConfirmed.get(id);
    if (wasBooked && wasBooked.seq < e.seq) cancelled++;
    else dropped++; // a draft, or a hold nobody paid for: never a booking the shop had
  }
  const moved = new Set(month.filter((e) => e.action === "reschedule_booking" && e.outcome === "confirmed" && e.booking !== null).map((e) => e.booking)).size;

  // ---- money: from entries the payments service's own record confirmed ----
  const depositEntries = all.filter((e) => e.action === "record_deposit" && e.outcome === "confirmed");
  const depositPayments = new Set(depositEntries.map((e) => e.refs.paymentId).filter(Boolean));
  const missing = { depositAmounts: 0, refundAmounts: 0, ownerCommands: 0, messageTargets: 0 };
  const deposits = emptyAmount();
  const seenDeposits = new Set<string>();
  // UPI (B33): the owner's marks are the payment record ("owner_marked_paid"), and a refund counts once the owner marks it sent ("upi_refund_marked_done")
  const upi = settings.payment?.module === "upi";
  for (const e of month.filter((x) => (x.action === "record_deposit" || (upi && x.action === "owner_marked_paid")) && x.outcome === "confirmed")) {
    const key = e.refs.paymentId ?? `seq-${e.seq}`;
    if (seenDeposits.has(key)) continue;
    seenDeposits.add(key);
    if (!tally([deposits], e.refs.amountPaise)) missing.depositAmounts++;
  }
  const refunds = { ...emptyAmount(), ofDeposits: emptyAmount(), ofSecondPayments: emptyAmount() };
  const seenRefunds = new Set<string>();
  for (const e of month.filter((x) => (x.action === "refund" || (upi && x.action === "upi_refund_marked_done")) && x.outcome === "confirmed")) {
    const key = e.refs.refundId ?? `seq-${e.seq}`;
    if (seenRefunds.has(key)) continue;
    seenRefunds.add(key);
    const part = depositPayments.has(e.refs.paymentId) || e.action === "upi_refund_marked_done" ? refunds.ofDeposits : refunds.ofSecondPayments;
    if (!tally([refunds, part], e.refs.amountPaise)) missing.refundAmounts++;
  }

  // ---- the owner's part ----
  const asked = new Set(month.filter((e) => e.action === "refund" && e.outcome === "held_for_owner").map((e) => `${e.booking}|${e.refs.paymentId ?? e.seq}`)).size;
  const owner = { asked, approved: 0, denied: 0, retried: 0 };
  for (const e of month.filter((x) => x.action === "owner_decision" && x.outcome === "confirmed")) {
    const command = e.refs.command;
    if (command === "approve") owner.approved++;
    else if (command === "deny") owner.denied++;
    else if (command === "retry") owner.retried++;
    else missing.ownerCommands++;
  }

  // ---- what the limits stopped: each rule at its own entry; the total counts entries, not rules ----
  const byRule = Object.fromEntries(RULE_IDS.map((r) => [r, 0])) as Record<RuleId, number>;
  let stoppedTotal = 0;
  for (const e of month) {
    const blocked = e.decisions.filter((d) => d.verdict === "block" && STOP_SITES[d.ruleId].includes(e.action));
    if (blocked.length === 0) continue;
    stoppedTotal++;
    for (const ruleId of new Set(blocked.map((d) => d.ruleId))) byRule[ruleId]++;
  }

  // ---- messages that were sent, by the language they were written in ----
  const toCustomers = { total: 0, byLanguage: zeroByLanguage() };
  const toOwner = { total: 0, byLanguage: zeroByLanguage() };
  let heldBack = 0;
  for (const e of month.filter((x) => MESSAGE_ACTIONS.includes(x.action))) {
    if (e.outcome === "blocked") heldBack++;
    if (e.outcome !== "confirmed") continue;
    const side = e.refs.to === "customer" ? toCustomers : e.refs.to === "owner" ? toOwner : undefined;
    if (!side) { missing.messageTargets++; continue; }
    side.total++;
    side.byLanguage[e.language]++;
  }

  // ---- left unconfirmed or failed (an entry that a later confirmed entry settled is marked, not hidden) ----
  const rows = month.filter((e) => e.outcome === "unconfirmed" || e.outcome === "failed").map((e) => ({
    seq: e.seq, action: e.action, outcome: e.outcome as "unconfirmed" | "failed", booking: e.booking,
    settledLater: SETTLEABLE.includes(e.action) && all.some((later) => later.seq > e.seq && later.outcome === "confirmed" && later.action === e.action && later.booking === e.booking
      && (e.action !== "refund" || later.refs.paymentId === e.refs.paymentId)),
  }));
  const settledLater = rows.filter((r) => r.settledLater).length;

  // ---- the record itself ----
  const recordRows: RecordRow[] = month.map((e) => ({ seq: e.seq, time: e.time, action: e.action, outcome: e.outcome, booking: e.booking, inputsDigest: e.inputsDigest, digest: entryDigest(e) }));
  const byAction: Record<string, Record<string, number>> = {};
  for (const e of month) { byAction[e.action] ??= {}; bump(byAction[e.action], e.outcome); }

  const first = localParts(from, settings.timezone);
  const last = localParts(to - 1, settings.timezone);
  const firstDay: LocalDate = { year: first.year, month: first.month, day: first.day };
  const lastDay: LocalDate = { year: last.year, month: last.month, day: last.day };
  const midnight = { hour: 0, minute: 0 };
  const nextMonth: LocalDate = firstDay.month === 12 ? { year: firstDay.year + 1, month: 1, day: 1 } : { year: firstDay.year, month: firstDay.month + 1, day: 1 };
  const wholeMonth = zonedToMs({ ...firstDay, day: 1 }, midnight, settings.timezone) === from && zonedToMs(nextMonth, midnight, settings.timezone) === to;

  return {
    format: "geometer-monthly-report/1",
    pathway: input.pathway ?? PATHWAY,
    source,
    shop: { name: settings.name, timeZone: settings.timezone, languages: [...settings.languages], ownerLanguage: settings.owner.language },
    preparedBy: input.preparedBy ?? null,
    period: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), firstDay, lastDay, month: wholeMonth ? { year: firstDay.year, month: firstDay.month } : null },
    madeAt: new Date(madeAt).toISOString(),
    policyDigest: policyDigest(settings),
    record: { entries: month.length, digest: digestOf(recordRows.map((r) => r.digest)), byAction, rows: recordRows },
    bookings: { made, cancelled, moved, droppedBeforeBooked: dropped },
    money: { deposits, refunds },
    owner,
    stopped: { total: stoppedTotal, byRule },
    messages: { toCustomers, toOwner, heldBack },
    unconfirmed: { open: rows.length - settledLater, openOnBookings: rows.filter((r) => !r.settledLater && !MESSAGE_ACTIONS.includes(r.action)).length, settledLater, rows },
    atReportTime: {
      waitingForOwner: bookings.filter((b) => b.pending.length > 0).length,
      paidNotBooked: bookings.filter((b) => b.state === "needs_owner").length,
    },
    missing,
    notCounted: [...NOT_COUNTED],
    notTested: notTestedForReport(goLive, settings),
    goLive,
    ...(input.innovator === true ? { innovator: true as const } : {}),
    ...(upi ? { paidBy: "owner-marked" as const } : {}),
    anchor: input.ledger ? headOf(input.entries, input.ledger.tenant) : null,
  };
}

/** The canonical bytes of the report: what is digested and signed. */
export const reportBytes = (report: MonthlyReport): string => canonicalJson(report);

function emptyAmount(): Amount { return { count: 0, paise: 0 }; }

/**
 * One more thing counted in each total, with its amount when the record kept one. A thing with no amount is still
 * counted, but adds nothing, and the caller notes it as missing (returns false).
 */
function tally(totals: Amount[], amountPaise: string | undefined): boolean {
  const paise = amountPaise === undefined ? NaN : Number(amountPaise);
  const ok = Number.isInteger(paise) && paise >= 0;
  for (const t of totals) { t.count++; if (ok) t.paise += paise; }
  return ok;
}

function firstBy(entries: readonly RecordEntry[], keep: (e: RecordEntry) => boolean, key: (e: RecordEntry) => string): Map<string, RecordEntry> {
  const out = new Map<string, RecordEntry>();
  for (const e of entries) if (keep(e) && !out.has(key(e))) out.set(key(e), e);
  return out;
}
