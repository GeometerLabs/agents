// The monthly Orders report as plain data. Money, orders taken, cancellations, holds that ran out, refunds, the owner's part and what the limits stopped are counted from the
// action record only. Nothing here is written by a model, estimated or guessed: every number is a count of record entries (or a sum of amounts the record itself kept),
// and anything the record cannot tell us is listed under "not counted" instead of being filled in.
//
// How the record is counted (the rules are pinned by test/report.test.ts):
//  - The WHOLE record goes in, not one month of it. The month is [from, to) in the shop's time zone, compared with each entry's own time.
//  - Things are counted when the action happened, and each once: an advance by its payment id, a refund by its refund id, an order at its own entry.
//  - "Advance collected" is the sum of payments the agent read back from the payments service's own list (or the owner's UPI marks). What a customer said is never in it.
//  - The record keeps a digest of what an action was asked, not the order's lines, so what was SOLD, pickup against delivery, and what is still to collect at pickup are read
//    from the orders as they are when the report is made (orders.json), for the orders whose day falls in the month and that are confirmed or completed.
//  - A limit "stopped" something at ONE entry: a blocked entry is counted under the rule that blocked it, once. A check that stops an order and the message that tells the
//    customer carry the same decision; they are one stop (see stopsIn).
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { existsSync, readFileSync } from "node:fs";
import type { Language } from "../../../../modules/language/languages.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { canonicalJson } from "../../../../modules/record/record.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { digestOf } from "../../../../modules/report/digest.ts";
import { headOf } from "../../../../modules/record/ledger.ts";
import type { LedgerHead } from "../../../../modules/record/ledger.ts";
import { SOURCES } from "../../../../modules/report/text.ts";
import type { Source } from "../../../../modules/report/text.ts";
import { NOT_TESTED, notTestedOf } from "../crash-test/not-tested.ts";
import type { NotTestedId } from "../crash-test/not-tested.ts";
import type { GoLiveFinding } from "../../../../modules/report/go-live.ts";
import type { Order } from "../src/order.ts";
import { annapurna } from "../src/harness.ts";
import { itemName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

export { SOURCES };
export type { Source, GoLiveFinding };

export const PATHWAY = readPathway();
// package.json holds the template's version. A template without one yet reports version 0.0.0 rather than none, so the signed bytes always name a version.
function readPathway(): { name: string; version: string } {
  const url = new URL("../package.json", import.meta.url);
  const version = existsSync(url) ? (JSON.parse(readFileSync(url, "utf8")) as { version?: string }).version : undefined;
  return { name: "orders", version: version ?? "0.0.0" };
}

export const RULE_IDS = ["price-at-or-above-menu", "order-size", "within-stock", "within-day-cap", "before-cutoff", "within-delivery-area", "confirm-only-when-recorded", "one-advance-per-order", "refund-limit", "message-matches-record", "opt-out"] as const;
export type OrderRuleId = (typeof RULE_IDS)[number];

/**
 * The entries a rule's "block" is counted at (a rule is checked at more than one place, and an entry that merely carries its decision is not a stop). The stock, the day's
 * count, the cut-off and the delivery area are checked in a step that is recorded (check_order, check_address) and the customer is told in a message that carries the same
 * decision; both are listed, and stopsIn counts the pair once. The price and the order size are only ever shown with the message.
 */
const MESSAGES = ["send_message", "voice_note_reply"];
const STOP_SITES: Record<OrderRuleId, readonly string[]> = {
  "price-at-or-above-menu": MESSAGES,
  "order-size": MESSAGES,
  "within-stock": ["check_order", ...MESSAGES],
  "within-day-cap": ["check_order", ...MESSAGES],
  "before-cutoff": ["check_order", ...MESSAGES],
  "within-delivery-area": ["check_address", ...MESSAGES],
  "confirm-only-when-recorded": MESSAGES,
  "one-advance-per-order": ["record_payment"],
  "refund-limit": ["refund", "owner_decision"],
  "message-matches-record": MESSAGES,
  "opt-out": MESSAGES,
};
const CHECK_SITES = ["check_order", "check_address"];

/**
 * What the checks behind an agent do not cover: the hand check's list, plus one more when the checks are not shown to have run on this shop's own settings:
 * "own-settings" (they ran on the example shop, Annapurna Tiffins), "other-settings" (on some other settings), "no-go-live-certificate" (the monthly report was given
 * none), "go-live-untrusted" (it was given one it could not trust), or "situations-skipped" when they did run on this shop's settings but some situations could not be run on them.
 */
export type NotTestedKey = NotTestedId | "own-settings" | "other-settings" | "no-go-live-certificate" | "go-live-untrusted" | "situations-skipped";

/** Things the record cannot tell us, so the report does not say them. Always listed. */
export type NotCountedId = "balance-at-pickup" | "kitchen-and-delivery" | "read-receipts" | "outside-agent" | "rule-breaks" | "outside-agent-upi";
export const NOT_COUNTED: readonly NotCountedId[] = ["balance-at-pickup", "kitchen-and-delivery", "read-receipts", "outside-agent", "rule-breaks"];
/** B71 part 2: a UPI shop's report names no gateway ("in Razorpay, your UPI app or WhatsApp" becomes its own line). A gateway shop's line and bytes are as they were. */
const UPI_NOT_COUNTED: Partial<Record<NotCountedId, NotCountedId>> = { "outside-agent": "outside-agent-upi" };

export interface Amount { count: number; paise: number }

export interface SoldItem { id: string; names: Record<Language, string>; qty: number }

export interface OrdersReport {
  format: "geometer-orders-report/1";
  pathway: { name: string; version: string };
  source: Source;
  shop: { name: string; timeZone: string; languages: Language[]; ownerLanguage: Language };
  preparedBy: string | null;
  /** True when the builder or partner who set the agent up has the Innovator badge (plan B56). */
  innovator?: true;
  period: { from: string; to: string; firstDay: LocalDate; lastDay: LocalDate; month: { year: number; month: number } | null };
  madeAt: string;
  policyDigest: string;
  record: { entries: number; digest: string; byAction: Record<string, Record<string, number>> };
  /** `collected` is the advance. For a UPI shop it is what the owner marked paid. */
  money: { collected: Amount; givenBack: Amount };
  /** Present only for a UPI shop (B33): the money is what the owner MARKED, and every document labels it so. Left out for a Razorpay shop, which keeps its bytes. */
  paidBy?: "owner-marked";
  /** From the record: orders confirmed (each once), orders completed, orders cancelled after they were confirmed, and holds that ran out before an advance was recorded. */
  orders: { taken: number; completed: number; cancelled: number; holdsRanOut: number };
  /** From the orders given (orders.json): the confirmed or completed orders whose day is in the month. `toCollect` is what is left of confirmed (not yet completed) orders after the advance. */
  sold: { orders: number; pickup: number; delivery: number; items: SoldItem[]; toCollect: Amount };
  owner: { asked: number; approved: number; denied: number };
  customers: { stopped: number };
  stopped: { total: number; byRule: Record<OrderRuleId, number> };
  messages: { toOwner: number; heldBack: number };
  unconfirmed: { open: number };
  notCounted: NotCountedId[];
  notTested: NotTestedKey[];
  /** What the report was told about the go-live checks: no certificate, one it could not trust, or one it read and what that says the checks ran on. */
  goLive: GoLiveFinding;
  /** The head of the shop's record as a hash-chained ledger when the report was made (see Bookings' report/data.ts), or null when no ledger was named. Part of the signed bytes. */
  anchor: LedgerHead | null;
}

export interface ReportInput {
  settings: Settings;
  /** The whole record, oldest first. */
  entries: readonly RecordEntry[];
  /** The orders as they are when the report is made. Used for what was sold, pickup against delivery, and what is still to collect. */
  orders: readonly Order[];
  from: number;
  to: number;
  source: Source;
  madeAt: number;
  preparedBy?: string;
  innovator?: boolean;
  /** What the go-live certificate the caller was given says (report/go-live.ts). Left out, the report says that no go-live certificate was given. */
  goLive?: GoLiveFinding;
  /** The ledger to anchor the report to: its tenant (the shop's id on the server). Left out, `anchor` is null. */
  ledger?: { tenant: string };
}

/** What governs how the agent behaves and speaks, without contact details. Two shops with the same policy digest have the same limits and words. */
export function policyOf(settings: Settings): unknown {
  const { address: _address, owner, payment, ...rest } = settings;
  return { ...rest, owner: { language: owner.language, approveOverInr: owner.approveOverInr }, payment: { module: payment.module } };
}
export const policyDigest = (settings: Settings): string => digestOf(policyOf(settings));

/** The example settings the hand check runs on when it is not given others. A go-live certificate whose checks ran on different settings has to say so. */
export const checkedPolicyDigest = (): string => policyDigest(annapurna());

/**
 * What the checks behind this shop's agent do not cover. `ran` says what the hand check ran on: the digest of the settings it used (Annapurna Tiffins', when left out)
 * and how many situations those settings could not run.
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

/** The fingerprint of one record entry. The customer's number is left out: the digest must not carry it. */
export function entryDigest(entry: RecordEntry): string {
  const { conversation: _conversation, ...rest } = entry;
  return digestOf(rest);
}

const emptyAmount = (): Amount => ({ count: 0, paise: 0 });
function add(a: Amount, paise: string | number | undefined): void {
  a.count += 1;
  const n = Number(paise);
  if (Number.isFinite(n)) a.paise += n;
}

/**
 * What the limits stopped, one entry at a time. A rule is counted at the entries STOP_SITES names for it, and when a message repeats a decision that the step before it
 * (a check_order or check_address of the same conversation) already stopped, that is the same stop and it is not counted again.
 */
function stopsIn(month: readonly RecordEntry[]): { total: number; byRule: Record<OrderRuleId, number> } {
  const byRule = Object.fromEntries(RULE_IDS.map((r) => [r, 0])) as Record<OrderRuleId, number>;
  let total = 0;
  const justChecked = new Map<string, Set<string>>(); // conversation -> rules the previous entry's check stopped
  for (const e of month) {
    const blocked = new Set(e.decisions.filter((d) => d.verdict === "block" && (STOP_SITES[d.ruleId as OrderRuleId] ?? []).includes(e.action)).map((d) => d.ruleId));
    const before = justChecked.get(e.conversation);
    justChecked.delete(e.conversation);
    if (CHECK_SITES.includes(e.action)) justChecked.set(e.conversation, blocked);
    else if (MESSAGES.includes(e.action) && before) for (const r of before) blocked.delete(r);
    if (blocked.size === 0) continue;
    total++;
    for (const ruleId of blocked) byRule[ruleId as OrderRuleId]++;
  }
  return { total, byRule };
}

export function buildOrdersReport(input: ReportInput): OrdersReport {
  const { settings, from, to, source, madeAt } = input;
  const goLive: GoLiveFinding = input.goLive ?? { status: "none" };
  if (!(from < to)) throw new Error("The report period must end after it starts.");
  if (!SOURCES.includes(source)) throw new Error(`Say what the numbers were counted from: ${SOURCES.join(", ")}.`);
  const all = [...input.entries].filter((e) => Date.parse(e.time) < to).sort((a, b) => a.seq - b.seq);
  const month = all.filter((e) => Date.parse(e.time) >= from);

  // ---- money: from entries the payments service's own record confirmed (or, for UPI, the owner's marks) ----
  const collected = emptyAmount();
  const seenPayments = new Set<string>();
  const upi = !capabilitiesOf(settings.payment).confirmsAutomatically; // the owner marks payments (UPI): their marks are the payment record
  for (const e of month.filter((x) => (x.action === "record_payment" || (upi && x.action === "owner_marked_paid")) && x.outcome === "confirmed")) {
    const key = e.refs.paymentId ?? `seq-${e.seq}`;
    if (seenPayments.has(key)) continue;
    seenPayments.add(key);
    add(collected, e.refs.amountPaise);
  }
  // A refund that was looked for again carries its refund id but not its amount: that is the amount an earlier entry for the same payment kept.
  const amountOfPayment = new Map<string, string>();
  for (const e of all) if (e.action === "refund" && e.refs.paymentId && e.refs.amountPaise) amountOfPayment.set(e.refs.paymentId, e.refs.amountPaise);
  const givenBack = emptyAmount();
  const seenRefunds = new Set<string>();
  for (const e of month.filter((x) => (x.action === "refund" || (upi && x.action === "upi_refund_marked_done")) && x.outcome === "confirmed")) {
    const key = e.refs.refundId ?? `seq-${e.seq}`;
    if (seenRefunds.has(key)) continue;
    seenRefunds.add(key);
    add(givenBack, e.refs.amountPaise ?? (e.refs.paymentId ? amountOfPayment.get(e.refs.paymentId) : undefined));
  }

  // ---- orders: each at its own confirmed entry, once per order ----
  const bookingsOf = (action: string, entries: readonly RecordEntry[] = month) => new Set(entries.filter((e) => e.action === action && e.outcome === "confirmed" && e.booking).map((e) => e.booking as string));
  const everConfirmed = bookingsOf("confirm_order", all);
  const orders = {
    taken: bookingsOf("confirm_order").size,
    completed: bookingsOf("complete_order").size,
    cancelled: [...bookingsOf("cancel_order")].filter((b) => everConfirmed.has(b)).length, // an enquiry or a hold given up before the advance was never an order taken
    holdsRanOut: bookingsOf("release_stock").size,
  };

  // ---- the owner's part: a request is counted once, whether it was a big order or a late cancellation, and however many entries it left ----
  const asked = new Set(month.filter((e) => e.outcome === "held_for_owner" && (e.action === "ask_owner" || e.action === "refund"))
    .map((e) => `${e.action}|${e.booking}|${e.refs.paymentId ?? e.seq}`)).size;
  const owner = { asked, approved: 0, denied: 0 };
  for (const e of month.filter((x) => x.action === "owner_decision" && x.outcome === "confirmed")) {
    if (e.refs.command === "approve") owner.approved++;
    else if (e.refs.command === "deny") owner.denied++;
  }

  // ---- what was sold and what is left to pay at pickup: the month's own orders, read when the report is made ----
  const midnight = { hour: 0, minute: 0 };
  const ofMonth = input.orders.filter((o) => {
    if (!o.date || (o.state !== "confirmed" && o.state !== "completed")) return false;
    const day = zonedToMs(o.date, midnight, settings.timezone);
    return day >= from && day < to;
  });
  const qty = new Map<string, number>();
  for (const o of ofMonth) for (const l of o.lines) qty.set(l.itemId, (qty.get(l.itemId) ?? 0) + l.qty);
  const items: SoldItem[] = settings.menu.filter((i) => qty.has(i.id)).map((i) => ({ id: i.id, names: Object.fromEntries(LANGUAGES.map((l) => [l, itemName(i, l)])) as Record<Language, string>, qty: qty.get(i.id)! }));
  const toCollect = emptyAmount();
  for (const o of ofMonth.filter((x) => x.state === "confirmed")) {
    const left = Math.max(0, (o.totalInr ?? 0) - (o.advanceInr ?? 0));
    if (left > 0) add(toCollect, left * 100);
  }
  const sold = { orders: ofMonth.length, pickup: ofMonth.filter((o) => o.mode === "pickup").length, delivery: ofMonth.filter((o) => o.mode === "delivery").length, items, toCollect };

  const stopped = stopsIn(month);

  const byAction: Record<string, Record<string, number>> = {};
  for (const e of month) { byAction[e.action] ??= {}; byAction[e.action][e.outcome] = (byAction[e.action][e.outcome] ?? 0) + 1; }

  const first = localParts(from, settings.timezone);
  const last = localParts(to - 1, settings.timezone);
  const firstDay: LocalDate = { year: first.year, month: first.month, day: first.day };
  const lastDay: LocalDate = { year: last.year, month: last.month, day: last.day };
  const nextMonth: LocalDate = firstDay.month === 12 ? { year: firstDay.year + 1, month: 1, day: 1 } : { year: firstDay.year, month: firstDay.month + 1, day: 1 };
  const wholeMonth = zonedToMs({ ...firstDay, day: 1 }, midnight, settings.timezone) === from && zonedToMs(nextMonth, midnight, settings.timezone) === to;
  return {
    format: "geometer-orders-report/1",
    pathway: PATHWAY,
    source,
    shop: { name: settings.name, timeZone: settings.timezone, languages: settings.languages, ownerLanguage: settings.owner.language },
    preparedBy: input.preparedBy ?? null,
    ...(input.innovator === true ? { innovator: true as const } : {}),
    period: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), firstDay, lastDay, month: wholeMonth ? { year: firstDay.year, month: firstDay.month } : null },
    madeAt: new Date(madeAt).toISOString(),
    policyDigest: policyDigest(settings),
    record: { entries: month.length, digest: digestOf(all.map(entryDigest)), byAction },
    money: { collected, givenBack },
    ...(upi ? { paidBy: "owner-marked" as const } : {}),
    orders, sold, owner,
    customers: { stopped: new Set(month.filter((e) => e.action === "opt_out" && e.outcome === "confirmed").map((e) => e.conversation)).size },
    stopped,
    messages: { toOwner: month.filter((e) => e.action === "send_message" && e.outcome !== "blocked" && e.refs.to === "owner").length, heldBack: month.filter((e) => e.action === "send_message" && e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === "message-matches-record")).length },
    unconfirmed: { open: month.filter((e) => (e.outcome === "unconfirmed" || e.outcome === "failed") && e.action !== "send_message").length },
    notCounted: NOT_COUNTED.map((id) => (upi ? UPI_NOT_COUNTED[id] ?? id : id)),
    notTested: notTestedForReport(goLive, settings),
    goLive,
    anchor: input.ledger ? headOf(input.entries, input.ledger.tenant) : null,
  };
}

/** The report as the exact bytes that are digested and signed. */
export const reportBytes = (report: OrdersReport): string => canonicalJson(report);
