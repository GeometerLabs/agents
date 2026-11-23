// The monthly Fees report as plain data, counted from the action record. Nothing here is written by a model, estimated or guessed: every number is a count of record
// entries (or a sum of amounts the record itself kept), and anything the record cannot tell us is listed under "not counted" instead of being filled in.
//
// How the record is counted (the rules are pinned by test/report.test.ts):
//  - The WHOLE record goes in, not one month of it. The month is [from, to) in the centre's time zone, compared with each entry's own time.
//  - Things are counted when the action happened, and each once: a payment by its payment id, a refund by its refund id, a waiver at its own confirmed entry.
//  - "Collected" is the sum of payments the agent read back from the payments service's own list. What a parent said is never in it.
//  - "Still to collect" is read from the fees as they are when the report is made: the open fees of the month and what is left on each.
//  - A limit "stopped" something at ONE entry: a blocked entry is counted under the rule that blocked it, once.
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { journal } from "../../../../modules/accounting/journal.ts";
import { booksOnlyOf, figuresOf } from "../../../../modules/accounting/figures.ts";
import type { BooksOnly } from "../../../../modules/accounting/figures.ts";
import { reportAccounting } from "../../../../modules/accounting/summary.ts";
import type { AccountingSummary } from "../../../../modules/accounting/summary.ts";
import type { LegacyMap } from "../../../../modules/accounting/journal.ts";
import { FEES_LEGACY, oldDueOf } from "../src/accounting.ts";
import { readFileSync } from "node:fs";
import type { Language } from "../../../../modules/language/languages.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { canonicalJson } from "../../../../modules/record/record.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { digestOf } from "../../../../modules/report/digest.ts";
import { settledByWordOf } from "../../../../modules/report/settled-by-word.ts";
import type { SettledByWord } from "../../../../modules/report/settled-by-word.ts";
import { headOf } from "../../../../modules/record/ledger.ts";
import { MESSAGE_STATUS_ENTRY } from "../../../../modules/unfinished/registry.ts";
import type { LedgerHead } from "../../../../modules/record/ledger.ts";
import { SOURCES } from "../../../../modules/report/text.ts";
import type { Source } from "../../../../modules/report/text.ts";
import { NOT_TESTED, notTestedOf } from "../crash-test/not-tested.ts";
import type { NotTestedId } from "../crash-test/not-tested.ts";
import type { GoLiveFinding } from "../../../../modules/report/go-live.ts";
import { balancePaise, monthKey } from "../src/due.ts";
import type { Due } from "../src/due.ts";
import { brightTuition } from "../src/harness.ts";
import type { Settings } from "../src/settings.ts";

export { SOURCES };
export type { Source, GoLiveFinding };

export const PATHWAY = readPathway();
function readPathway(): { name: string; version: string } {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
  if (!pkg.version) throw new Error("templates/education/fees/package.json has no version.");
  return { name: "fees", version: pkg.version };
}

export const RULE_IDS = ["no-reminder-once-paid", "reminder-cap", "waiver-limit", "fee-link-matches-record", "refund-limit", "one-refund-per-payment", "paid-only-when-recorded", "message-matches-record", "opt-out"] as const;
export type FeeRuleId = (typeof RULE_IDS)[number];

/** The entries a rule's "block" is counted at (a rule is checked at more than one place, and an entry that merely carries its decision is not a stop). */
const MESSAGES = ["send_message", "voice_note_reply"];
export const STOP_SITES: Record<FeeRuleId, readonly string[]> = {
  "no-reminder-once-paid": MESSAGES,
  "reminder-cap": MESSAGES,
  "waiver-limit": ["waiver_request", "owner_decision", "ask_owner"],
  "fee-link-matches-record": ["create_fee_link"],
  "refund-limit": ["refund", "owner_decision"],
  "one-refund-per-payment": ["refund", "owner_decision"],
  "paid-only-when-recorded": MESSAGES,
  "message-matches-record": MESSAGES,
  "opt-out": MESSAGES,
};

/**
 * What the checks behind an agent do not cover: the hand check's list, plus one more when the checks are not shown to have run on this centre's own settings:
 * "own-settings" (they ran on the example centre, Bright Tuition Centre), "other-settings" (on some other settings), "no-go-live-certificate" (the monthly report was given
 * none), "go-live-untrusted" (it was given one it could not trust), or "situations-skipped" when they did run on this centre's settings but some situations could not be run on them.
 */
export type NotTestedKey = NotTestedId | "own-settings" | "other-settings" | "no-go-live-certificate" | "go-live-untrusted" | "situations-skipped";

/** Things the record cannot tell us, so the report does not say them. Always listed. */
export type NotCountedId = "cash-and-transfers" | "read-receipts" | "outside-agent" | "rule-breaks" | "cash-and-transfers-upi" | "outside-agent-upi";
export const NOT_COUNTED: readonly NotCountedId[] = ["cash-and-transfers", "read-receipts", "outside-agent", "rule-breaks"];
/**
 * B71 part 2: a UPI centre's report names no gateway. Two lines said what the record holds in a gateway's words ("only Razorpay payments", "in Razorpay or WhatsApp");
 * a UPI centre gets its own words for them. A gateway centre's lines, and so its report's bytes, are as they were.
 */
export const UPI_NOT_COUNTED: Partial<Record<NotCountedId, NotCountedId>> = { "cash-and-transfers": "cash-and-transfers-upi", "outside-agent": "outside-agent-upi" };

/** The templates whose message is a fee reminder, and the ones that are receipts, by the name the record keeps in `refs.templates`. */
export const REMINDER_TEMPLATES: readonly string[] = ["fee_reminder", "fee_reminder_family", "fee_reminder_family_page", "fee_overdue", "fee_overdue_late", "credit_reminder"];
export const RECEIPT_TEMPLATES: readonly string[] = ["fee_received", "fee_part_received", "credit_received", "credit_part_received"];

export interface Amount { count: number; paise: number }
export type ByLanguage = Record<Language, number>;

export interface FeesReport {
  format: "geometer-fees-report/1";
  pathway: { name: string; version: string };
  source: Source;
  shop: { name: string; timeZone: string; languages: Language[]; ownerLanguage: Language };
  preparedBy: string | null;
  /** True when the builder or Operator who set the agent up has the Innovator badge (plan B56). */
  innovator?: true;
  period: { from: string; to: string; firstDay: LocalDate; lastDay: LocalDate; month: { year: number; month: number } | null };
  madeAt: string;
  policyDigest: string;
  record: { entries: number; digest: string; byAction: Record<string, Record<string, number>> };
  /**
   * `givenBack` is what the payments service's own record confirmed (or, UPI, the owner marked sent). `settledByWord` (B75, 12 Nov 2026) are refunds a person at the
   * server settled as made by their word (Guard's already_done): never counted as given back, grouped by who said so. Left out when there are none (older bytes kept).
   */
  money: { collected: Amount; givenBack: Amount;
    /**
     * Owner's decision, 17 Nov 2026: old dues (a student's `backDues`, earlier months unpaid when the agent started, each a fee of its own with `backDue`) are told apart.
     * `collected` is the money for this period's own fees and `oldDues` the payments on old dues, both worked out from the record and the books (never from what a parent said);
     * together they are exactly the books' received figure. Left out when no old due was paid in the period, so a centre without old dues keeps its bytes.
     */
    oldDues?: Amount;
    settledByWord?: SettledByWord[];
    /** Money the books count and the rows above leave out (a payment made twice, the owner's own marks on a gateway shop); only when one is above 0. */
    booksOnly?: BooksOnly };
  /** Present only for a UPI centre (B33): the money is what the owner MARKED, and every document labels it so. Left out for a Razorpay centre, which keeps its bytes. */
  paidBy?: "owner-marked";
  fees: { opened: number; paidInFull: number; partlyPaid: number; stillOpen: number; stillToCollect: Amount };
  waivers: { total: Amount; byOwner: Amount; withinLimit: Amount; lateFeesAdded: Amount };
  owner: { asked: number; approved: number; denied: number };
  reminders: { sent: number; byLanguage: ByLanguage; receipts: number };
  parents: { stopped: number };
  stopped: { total: number; byRule: Record<FeeRuleId, number> };
  messages: { toOwner: number; heldBack: number };
  unconfirmed: { open: number };
  notCounted: NotCountedId[];
  notTested: NotTestedKey[];
  /** What the report was told about the go-live checks: no certificate, one it could not trust, or one it read and what that says the checks ran on. */
  goLive: GoLiveFinding;
  /**
   * The books summary (modules/accounting/summary.ts) for the month, with the template's frozen legacy map so the open check (modules/accounting/check.ts) can read an older line
   * from the evidence pack alone. Left out when the whole record has no money lines, which keeps the bytes of every report made without money.
   */
  accounting?: { summary: AccountingSummary; legacy: LegacyMap };
  /**
   * Classes (the Fees add-on): counted from the record, only for a centre with the `classes` block (a Fees centre's report is as it was). `held` is classes whose attendance the
   * teacher confirmed; `attendanceMarked` the students marked in them. Delivery of a link is not attendance and attendance is not learning: nothing here says either.
   */
  classes?: { held: number; linksSent: number; attendanceMarked: number; missedNotes: number; doubts: number };
  /**
   * The credit book (the Fees adult variant, src/credit/): its one number and its one check, counted from the record, only for a shop with the `creditBook` block (a Fees centre's
   * report is as it was). `owedAtStart` is what the accounts showed at the month's start (each account's entries less its recorded payments and the owner's marks, before `from`;
   * count = accounts that owed); `collectedAfterReminder` the payments and owner's marks in the month on an account that had been sent a reminder before them; `remindersAfterPaid`
   * the month's reminders sent when the record already showed the account paid, which must be 0. A part payment still leaves a reminder for the rest: that is not "after paid".
   */
  credit?: { owedAtStart: Amount; collectedAfterReminder: Amount; remindersSent: number; remindersAfterPaid: number };
  /** The head of the centre's record as a hash-chained ledger when the report was made (see Bookings' report/data.ts), or null when no ledger was named. Part of the signed bytes. */
  anchor: LedgerHead | null;
}

export interface ReportInput {
  settings: Settings;
  /** The whole record, oldest first. */
  entries: readonly RecordEntry[];
  /** The fees as they are when the report is made. Used only for what is still to collect. */
  dues: readonly Due[];
  from: number;
  to: number;
  source: Source;
  madeAt: number;
  preparedBy?: string;
  innovator?: boolean;
  /** What the go-live certificate the caller was given says (report/go-live.ts). Left out, the report says that no go-live certificate was given. */
  goLive?: GoLiveFinding;
  /** The ledger to anchor the report to: its tenant (the centre's id on the server). Left out, `anchor` is null. */
  ledger?: { tenant: string };
}

/** What governs how the agent behaves and speaks, without contact details. Two centres with the same policy digest have the same limits and words. */
export function policyOf(settings: Settings): unknown {
  const { address: _address, owner, students: _students, creditBook, ...rest } = settings;
  // the credit book's people are counted like the students: no name or number is in what the digest is of (left out when the shop has no credit book, so its digest is as it was)
  return { ...rest, owner: { language: owner.language }, students: settings.students.length, ...(creditBook ? { creditBook: { ...creditBook, people: creditBook.people.length } } : {}) };
}
export const policyDigest = (settings: Settings): string => digestOf(policyOf(settings));

/** The example settings the hand check runs on when it is not given others. A go-live certificate whose checks ran on different settings from the centre's has to say so. */
export const checkedPolicyDigest = (): string => policyDigest(brightTuition());

/**
 * What the checks behind this centre's agent do not cover. `ran` says what the hand check ran on: the digest of the settings it used (Bright Tuition Centre's, when left out)
 * and how many situations those settings could not run.
 */
export function notTestedFor(settings: Settings, ran: { onPolicyDigest?: string; notRun?: number } = {}): NotTestedKey[] {
  const ids: NotTestedKey[] = notTestedOf(settings).map((n) => n.id);
  if (policyDigest(settings) !== (ran.onPolicyDigest ?? checkedPolicyDigest())) return [...ids, "own-settings"];
  return (ran.notRun ?? 0) > 0 ? [...ids, "situations-skipped"] : ids;
}

/** What the monthly report lists as not tested: the hand check's list, and one more unless a go-live certificate shows the checks ran on this centre's own settings with nothing left out. */
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

/** The fingerprint of one record entry. The parent's number and the note are left out, as they are from the chain (modules/record/ledger.ts): a note can name a child, and a digest of it could be tested by guessing the name. */
export function entryDigest(entry: RecordEntry): string {
  const { conversation: _conversation, notes: _notes, ...rest } = entry;
  return digestOf(rest);
}

const emptyAmount = (): Amount => ({ count: 0, paise: 0 });
function add(a: Amount, paise: string | undefined): void {
  a.count += 1;
  const n = Number(paise);
  if (Number.isFinite(n)) a.paise += n;
}

export function buildFeesReport(input: ReportInput): FeesReport {
  const { settings, from, to, source, madeAt } = input;
  const goLive: GoLiveFinding = input.goLive ?? { status: "none" };
  if (!(from < to)) throw new Error("The report period must end after it starts.");
  if (!SOURCES.includes(source)) throw new Error(`Say what the numbers were counted from: ${SOURCES.join(", ")}.`);
  const all = [...input.entries].filter((e) => Date.parse(e.time) < to).sort((a, b) => a.seq - b.seq);
  const month = all.filter((e) => Date.parse(e.time) >= from);

  // ---- money: read from the books (modules/accounting/figures.ts): the journal is the record read as double-entry lines, and the month's figures are sums over it ----
  // For a UPI centre the owner's marks are the payment record (cash and bank marks too), and a refund counts once the owner marks it sent; the journal reads them all. A
  // payment is counted once, a refund once per refund id, and a refund a person settled by their word is not money given back (it is counted on its own below).
  const upi = !capabilitiesOf(settings.payment).confirmsAutomatically; // the owner marks payments (UPI): the report says so (paidBy)
  const figures = figuresOf(journal(all, FEES_LEGACY), all, FEES_LEGACY, new Date(from).toISOString(), new Date(to).toISOString(), { ownerMarks: upi });
  const booksOnly = booksOnlyOf(figures); // why the "Money this month" block can differ from the rows (figures.ts booksOnly)
  const accounting = reportAccounting(all, FEES_LEGACY, new Date(from).toISOString(), new Date(to).toISOString());
  // Old dues collected: the same books figure over only the entries on a fee that was opened as a back due (src/accounting.ts oldDueOf), so every rule of `received`
  // (once per payment, a second payment on a link left out, a UPI centre's marks) applies unchanged and the two parts add up to `figures.received` exactly.
  const isOld = oldDueOf(all);
  const old = figuresOf(journal(all, FEES_LEGACY), all.filter((e) => isOld(e) !== undefined), FEES_LEGACY, new Date(from).toISOString(), new Date(to).toISOString(), { ownerMarks: upi }).received;
  const oldDues = old.count > 0 ? { count: old.count, paise: old.paise } : undefined;
  const collected = oldDues ? { count: figures.received.count - oldDues.count, paise: figures.received.paise - oldDues.paise } : figures.received;
  const givenBack = { count: figures.refunds.count, paise: figures.refunds.paise };
  const byWord = settledByWordOf(month).rows; // a person's word, by who said it (modules/report/settled-by-word.ts)

  // ---- waivers and late fees, each at its own confirmed entry ----
  // the totals come from the books; who approved each waiver (the owner, or within the limit) is the entry's own `by`, which the books do not carry, so that split is still counted here
  const waivers = { total: figures.discounts, byOwner: emptyAmount(), withinLimit: emptyAmount(), lateFeesAdded: figures.lateFees };
  for (const e of month.filter((x) => x.action === "waive_fee" && x.outcome === "confirmed")) add(e.refs.by === "owner" ? waivers.byOwner : waivers.withinLimit, e.refs.amountPaise);

  // ---- the owner's part: a request is counted once, whether it was a waiver or a refund, and however many entries it left ----
  const asked = new Set(month.filter((e) => e.outcome === "held_for_owner" && (e.action === "waiver_request" || e.action === "refund"))
    .map((e) => `${e.action}|${e.booking}|${e.refs.paymentId ?? e.refs.request ?? e.seq}`)).size;
  const owner = { asked, approved: 0, denied: 0 };
  for (const e of month.filter((x) => x.action === "owner_decision" && x.outcome === "confirmed")) {
    if (e.refs.command === "approve") owner.approved++;
    else if (e.refs.command === "deny") owner.denied++;
  }

  // ---- the fees as they stand: the month's own fees, read when the report is made ----
  const monthStart = localParts(from, settings.timezone);
  const ofMonth = input.dues.filter((d) => d.month === monthKey(monthStart));
  const stillOpen = ofMonth.filter((d) => d.state === "open");
  const stillToCollect = emptyAmount();
  for (const d of stillOpen) { stillToCollect.count += 1; stillToCollect.paise += Math.max(0, balancePaise(d)); }
  const fees = {
    opened: ofMonth.length,
    paidInFull: ofMonth.filter((d) => d.state === "paid").length,
    partlyPaid: stillOpen.filter((d) => d.payments.length > 0).length,
    stillOpen: stillOpen.length,
    stillToCollect,
  };

  // ---- reminders and receipts sent: a message counted by the template the record names ----
  const templatesOf = (e: RecordEntry) => (e.refs.templates ?? "").split("+");
  const toParents = month.filter((e) => e.action === "send_message" && e.outcome === "confirmed" && e.refs.to === "customer");
  const byLanguage = Object.fromEntries(LANGUAGES.map((l) => [l, 0])) as ByLanguage;
  let reminders = 0;
  for (const e of toParents.filter((x) => templatesOf(x).some((t) => REMINDER_TEMPLATES.includes(t)))) { reminders++; byLanguage[e.language]++; }
  const receipts = toParents.filter((x) => templatesOf(x).some((t) => RECEIPT_TEMPLATES.includes(t))).length;

  // ---- what the limits stopped: each rule at its own entry; the total counts entries, not rules. A waiver or refund held for the owner is not "stopped": it is under "asked". ----
  const byRule = Object.fromEntries(RULE_IDS.map((r) => [r, 0])) as Record<FeeRuleId, number>;
  let stoppedTotal = 0;
  for (const e of month) {
    const blocked = e.decisions.filter((d) => d.verdict === "block" && (STOP_SITES[d.ruleId as FeeRuleId] ?? []).includes(e.action));
    if (blocked.length === 0) continue;
    stoppedTotal++;
    for (const ruleId of new Set(blocked.map((d) => d.ruleId))) byRule[ruleId as FeeRuleId]++;
  }

  const byAction: Record<string, Record<string, number>> = {};
  for (const e of month) { byAction[e.action] ??= {}; byAction[e.action][e.outcome] = (byAction[e.action][e.outcome] ?? 0) + 1; }

  const first = localParts(from, settings.timezone);
  const last = localParts(to - 1, settings.timezone);
  const firstDay: LocalDate = { year: first.year, month: first.month, day: first.day };
  const lastDay: LocalDate = { year: last.year, month: last.month, day: last.day };
  const midnight = { hour: 0, minute: 0 };
  const nextMonth: LocalDate = firstDay.month === 12 ? { year: firstDay.year + 1, month: 1, day: 1 } : { year: firstDay.year, month: firstDay.month + 1, day: 1 };
  const wholeMonth = zonedToMs({ ...firstDay, day: 1 }, midnight, settings.timezone) === from && zonedToMs(nextMonth, midnight, settings.timezone) === to;
  // ---- Classes: counted at the entries Classes writes (src/classes/run.ts CLASS_ACTIONS), only for a centre that has it ----
  const attendance = month.filter((e) => e.action === "class_attendance" && e.outcome === "confirmed");
  const classes = settings.classes ? {
    held: attendance.length,
    linksSent: toParents.filter((x) => templatesOf(x).includes("class_link")).length,
    attendanceMarked: attendance.reduce((n, e) => n + Number(e.refs.present ?? 0) + Number(e.refs.absent ?? 0), 0),
    missedNotes: toParents.filter((x) => templatesOf(x).includes("class_missed_note")).length,
    doubts: month.filter((e) => e.action === "class_doubt" && e.outcome === "confirmed" && e.refs.answered === undefined).length,
  } : undefined;
  const credit = settings.creditBook ? creditCounts(all, from) : undefined;
  return {
    format: "geometer-fees-report/1",
    pathway: PATHWAY,
    source,
    shop: { name: settings.name, timeZone: settings.timezone, languages: settings.languages, ownerLanguage: settings.owner.language },
    preparedBy: input.preparedBy ?? null,
    ...(input.innovator === true ? { innovator: true as const } : {}),
    period: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), firstDay, lastDay, month: wholeMonth ? { year: firstDay.year, month: firstDay.month } : null },
    madeAt: new Date(madeAt).toISOString(),
    policyDigest: policyDigest(settings),
    record: { entries: month.length, digest: digestOf(all.map(entryDigest)), byAction },
    money: { collected, givenBack, ...(oldDues ? { oldDues } : {}), ...(byWord.length > 0 ? { settledByWord: byWord } : {}), ...(booksOnly ? { booksOnly } : {}) },
    ...(upi ? { paidBy: "owner-marked" as const } : {}),
    fees, waivers, owner,
    reminders: { sent: reminders, byLanguage, receipts },
    parents: { stopped: new Set(month.filter((e) => e.action === "opt_out" && e.outcome === "confirmed").map((e) => e.conversation)).size },
    stopped: { total: stoppedTotal, byRule },
    messages: { toOwner: month.filter((e) => e.action === "send_message" && e.outcome !== "blocked" && e.refs.to === "owner").length, heldBack: month.filter((e) => e.action === "send_message" && e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === "message-matches-record")).length },
    unconfirmed: { open: month.filter((e) => (e.outcome === "unconfirmed" || e.outcome === "failed") && e.action !== "send_message" && e.action !== MESSAGE_STATUS_ENTRY).length }, // a message, or WhatsApp's report on one, is not an open payment
    notCounted: NOT_COUNTED.map((id) => (upi ? UPI_NOT_COUNTED[id] ?? id : id)),
    notTested: notTestedForReport(goLive, settings),
    goLive,
    ...(accounting ? { accounting } : {}),
    ...(classes ? { classes } : {}),
    ...(credit ? { credit } : {}),
    anchor: input.ledger ? headOf(input.entries, input.ledger.tenant) : null,
  };
}

/**
 * The credit book's counts (FeesReport.credit), from the whole record in its order: each account's entries (`credit_add`), its recorded payments and owner's marks
 * (`record_payment`, `owner_marked_paid`, by their `amountPaise`, as limits.ts no-reminder-once-paid reads them) and its reminders (a confirmed `send_message` to the customer
 * naming `credit_reminder`), by the fee they are on.
 */
export function creditCounts(all: readonly RecordEntry[], from: number): NonNullable<FeesReport["credit"]> {
  const owed = new Map<string, number>();
  const reminded = new Set<string>();
  const out = { owedAtStart: emptyAmount(), collectedAfterReminder: emptyAmount(), remindersSent: 0, remindersAfterPaid: 0 };
  let started = false;
  const takeStart = () => { for (const v of owed.values()) if (v > 0) { out.owedAtStart.count++; out.owedAtStart.paise += v; } started = true; };
  for (const e of all) {
    const inMonth = Date.parse(e.time) >= from;
    if (inMonth && !started) takeStart();
    const fee = e.booking;
    if (!fee || e.outcome !== "confirmed") continue;
    const paise = Number(e.refs.amountPaise);
    if (e.action === "credit_add" && Number.isFinite(paise)) owed.set(fee, (owed.get(fee) ?? 0) + paise);
    else if (!owed.has(fee)) continue;
    else if ((e.action === "record_payment" || e.action === "owner_marked_paid") && Number.isFinite(paise)) {
      owed.set(fee, owed.get(fee)! - paise);
      if (inMonth && reminded.has(fee)) add(out.collectedAfterReminder, e.refs.amountPaise);
    } else if (e.action === "send_message" && e.refs.to === "customer" && (e.refs.templates ?? "").split("+").includes("credit_reminder")) {
      reminded.add(fee);
      if (inMonth) { out.remindersSent++; if (owed.get(fee)! <= 0) out.remindersAfterPaid++; }
    }
  }
  if (!started) takeStart();
  return out;
}

/** The report as the exact bytes that are digested and signed. */
export const reportBytes = (report: FeesReport): string => canonicalJson(report);
