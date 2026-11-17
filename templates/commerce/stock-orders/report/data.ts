// The monthly Stock orders report as plain data: what the owner asked for, what they approved, what each supplier answered, what arrived, how much of the month's budget the
// approved orders hold, and what the limits stopped. Nothing here is written by a model or estimated: every number is a count of orders or of record entries, and anything the
// record cannot tell us is listed under "not counted" instead of being filled in.
//
// How it is counted (the rules are pinned by test/report.test.ts):
//  - The WHOLE record goes in, not one month of it. The month is [from, to) in the shop's time zone, compared with each entry's own time and each order's own time.
//  - An order is "placed" in the month the owner approved it (approvedMs). What the supplier answered and what arrived are read from those orders AS THEY ARE when the report is
//    made, so a delivery that comes next month shows in next month's report only as a change to this month's orders when this month is made again.
//  - Three different things stay three different counts and are never folded into one: the supplier said yes (ack), the goods came (receipt: full, part, wrong item), and
//    "marked paid by the owner". This agent pays no one, so nothing here ever says "paid" on its own: the last count is the owner's own note, from the record's
//    mark_paid_outside entries, labelled that way, and it is not checked against anything.
//  - The budget used is the sum of the placed orders that still hold budget (order.ts holdsBudget), the same sum the agent reserves with (reservedPaise).
//  - What the limits stopped is counted per record entry that was blocked, once, under each rule that blocked it.
//  - No phone number is in the report: the owner's and the suppliers' numbers are only ever in the record's conversation field, which the digest leaves out and the report
//    never copies. Supplier names are the shop's own and are shown.
import { existsSync, readFileSync } from "node:fs";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { canonicalJson } from "../../../../modules/record/record.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { headOf } from "../../../../modules/record/ledger.ts";
import type { LedgerHead } from "../../../../modules/record/ledger.ts";
import { digestOf } from "../../../../modules/report/digest.ts";
import { SOURCES } from "../../../../modules/report/text.ts";
import type { Source } from "../../../../modules/report/text.ts";
import type { GoLiveFinding } from "../../../../modules/report/go-live.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { notTestedOf } from "../crash-test/not-tested.ts";
import { glowSalon } from "../src/harness.ts";
import { holdsBudget } from "../src/order.ts";
import type { PurchaseOrder } from "../src/order.ts";
import type { Settings } from "../src/settings.ts";

export { SOURCES };
export type { Source, GoLiveFinding };

export const PATHWAY = readPathway();
// package.json holds the template's version. A template without one yet reports version 0.0.0 rather than none, so the signed bytes always name a version.
function readPathway(): { name: string; version: string } {
  const url = new URL("../package.json", import.meta.url);
  const version = existsSync(url) ? (JSON.parse(readFileSync(url, "utf8")) as { version?: string }).version : undefined;
  return { name: "stock-orders", version: version ?? "0.0.0" };
}

/** The rules a stop is counted under (src/limits.ts and the checks the send goes through). "other" holds a rule this list does not know, so no stop goes uncounted. */
export const RULE_IDS = [
  "monthly-budget", "per-order-cap", "order-quantity", "approved-supplier-only", "approval-matches-order", "one-order-per-request", "reply-from-supplier",
  "send-only-when-approved", "message-matches-record", "opt-out", "other",
] as const;
export type StockRuleId = (typeof RULE_IDS)[number];

/** The things the hand check does not cover, by the ids in crash-test/not-tested.ts. */
export type HandCheckGapId = "real-whatsapp" | "native-review" | "model-reading" | "supplier-formats" | "restart" | "paying" | "invoice" | "real-month";

/**
 * What the checks behind an agent do not cover: the hand check's list, plus one more when the checks are not shown to have run on this shop's own settings:
 * "own-settings" (they ran on the example shop, Glow Unisex Salon), "other-settings" (on some other settings), "no-go-live-certificate" (the monthly report was given
 * none), "go-live-untrusted" (it was given one it could not trust), or "situations-skipped" when they did run on this shop's settings but some situations could not be run.
 */
export type NotTestedKey = HandCheckGapId | "own-settings" | "other-settings" | "no-go-live-certificate" | "go-live-untrusted" | "situations-skipped";

/** Things the record cannot tell us, so the report does not say them. Always listed. */
export type NotCountedId = "goods-really-arrived" | "payments" | "outside-agent" | "read-receipts" | "rule-breaks";
export const NOT_COUNTED: readonly NotCountedId[] = ["goods-really-arrived", "payments", "outside-agent", "read-receipts", "rule-breaks"];

export interface SupplierCounts {
  id: string;
  /** The shop's own name for the supplier, from its settings. */
  name: string;
  placed: number;
  acknowledged: number;
  receivedFull: number;
  partReceived: number;
  wrongItem: number;
  declined: number;
  silent: number;
}

export interface StockReport {
  format: "geometer-stock-orders-report/1";
  pathway: { name: string; version: string };
  source: Source;
  shop: { name: string; timeZone: string; languages: Language[]; ownerLanguage: Language };
  preparedBy: string | null;
  /** True when the builder or Operator who set the agent up has the Innovator badge. */
  innovator?: true;
  period: { from: string; to: string; firstDay: LocalDate; lastDay: LocalDate; month: { year: number; month: number } | null };
  madeAt: string;
  policyDigest: string;
  record: { entries: number; digest: string; byAction: Record<string, Record<string, number>> };
  /**
   * `placed` are the orders the owner approved in the month. The rest are counts of those orders as they are now: they went out to the supplier (`sentOut`), the supplier said
   * yes (`acknowledged`) or no (`declinedBySupplier`), or never answered (`silent`: out, no answer), the goods came in full, in part, or were the wrong item, and the order was
   * cancelled or never went out (`neverSent`). `sendUnknown` went out but WhatsApp never confirmed it (the supplier is asked about it, it is never sent again).
   */
  orders: {
    placed: number; sentOut: number; acknowledged: number; declinedBySupplier: number; silent: number; receivedFull: number; partReceived: number; wrongItem: number;
    neverSent: number; sendUnknown: number;
  };
  /**
   * The owner's part: orders asked in the month, those they said no to, and `voided`: orders that never went out because their card ran out, was replaced by a new card, or a
   * check held the approval back (the order's state "void" covers all three, so the count does not say which). "Approved" is orders.placed.
   */
  owner: { asked: number; approved: number; saidNo: number; voided: number };
  /** The owner's own note that they paid a supplier themselves, counted from the record (orders marked once each). The agent pays no one and cannot check it. */
  markedPaidByOwner: { orders: number };
  /** The month's budget in paise: what the shop set, and what the placed orders that still hold budget add up to. */
  budget: { monthlyPaise: number; usedPaise: number; leftPaise: number };
  /** One row per supplier that had an order placed in the month, in the order of the shop's list. */
  suppliers: SupplierCounts[];
  stopped: { total: number; byRule: Record<StockRuleId, number> };
  /** Orders whose send left no confirmed answer (counted from the record: unconfirmed or failed send_order entries). */
  unconfirmed: { open: number };
  notCounted: NotCountedId[];
  notTested: NotTestedKey[];
  /** What the report was told about the go-live checks: no certificate, one it could not trust, or one it read and what that says the checks ran on. */
  goLive: GoLiveFinding;
  /** The head of the shop's record as a hash-chained ledger when the report was made, or null when no ledger was named. Part of the signed bytes. */
  anchor: LedgerHead | null;
}

export interface ReportInput {
  settings: Settings;
  /** The whole record, oldest first. */
  entries: readonly RecordEntry[];
  /** The orders as they are when the report is made (the store's orders). */
  orders: readonly PurchaseOrder[];
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

/**
 * What governs how the agent behaves and speaks, without contact details: the shop's name, languages, items, units, catalogue and prices, limits and follow-up times, and
 * which suppliers are approved (their numbers and the owner's number are left out). Two shops with the same policy digest have the same limits and words.
 */
export function policyOf(settings: Settings): unknown {
  const { address: _address, owner, suppliers, ...rest } = settings;
  return { ...rest, owner: { language: owner.language }, suppliers: suppliers.map(({ whatsapp: _whatsapp, ...s }) => s) };
}
export const policyDigest = (settings: Settings): string => digestOf(policyOf(settings));

/** The example settings the hand check runs on when it is not given others. A go-live certificate whose checks ran on different settings has to say so. */
export const checkedPolicyDigest = (): string => policyDigest(glowSalon());

/**
 * What the checks behind this shop's agent do not cover. `ran` says what the hand check ran on: the digest of the settings it used (Glow Unisex Salon's, when left out)
 * and how many situations those settings could not run.
 */
export function notTestedFor(settings: Settings, ran: { onPolicyDigest?: string; notRun?: number } = {}): NotTestedKey[] {
  const ids = notTestedOf(settings).map((n) => n.id as NotTestedKey);
  if (policyDigest(settings) !== (ran.onPolicyDigest ?? checkedPolicyDigest())) return [...ids, "own-settings"];
  return (ran.notRun ?? 0) > 0 ? [...ids, "situations-skipped"] : ids;
}

/** What the monthly report lists as not tested: the hand check's list, and one more unless a go-live certificate shows the checks ran on this shop's own settings with nothing left out. */
export function notTestedForReport(goLive: GoLiveFinding, settings: Settings): NotTestedKey[] {
  const ids = notTestedOf(settings).map((n) => n.id as NotTestedKey);
  switch (goLive.status) {
    case "own": return goLive.notRun > 0 ? [...ids, "situations-skipped"] : ids;
    case "example": return [...ids, "own-settings"];
    case "different": return [...ids, "other-settings"];
    case "untrusted": return [...ids, "go-live-untrusted"];
    case "none": return [...ids, "no-go-live-certificate"];
  }
}

/** The fingerprint of one record entry. The conversation (the owner's or a supplier's number) is left out: the digest must not carry it. */
export function entryDigest(entry: RecordEntry): string {
  const { conversation: _conversation, ...rest } = entry;
  return digestOf(rest);
}

/**
 * What the limits stopped, one entry at a time: a blocked entry (one with a block decision) is one stop, and it is counted under each rule that blocked it. A rule this
 * module does not list is counted under "other", so the total is always every blocked entry.
 */
function stopsIn(month: readonly RecordEntry[]): { total: number; byRule: Record<StockRuleId, number> } {
  const byRule = Object.fromEntries(RULE_IDS.map((r) => [r, 0])) as Record<StockRuleId, number>;
  let total = 0;
  for (const e of month) {
    if (e.outcome !== "blocked") continue;
    const rules = new Set(e.decisions.filter((d) => d.verdict === "block").map((d) => ((RULE_IDS as readonly string[]).includes(d.ruleId) ? d.ruleId : "other") as StockRuleId));
    if (rules.size === 0) continue;
    total++;
    for (const r of rules) byRule[r]++;
  }
  return { total, byRule };
}

export function buildStockReport(input: ReportInput): StockReport {
  const { settings, from, to, source, madeAt } = input;
  const goLive: GoLiveFinding = input.goLive ?? { status: "none" };
  if (!(from < to)) throw new Error("The report period must end after it starts.");
  if (!SOURCES.includes(source)) throw new Error(`Say what the numbers were counted from: ${SOURCES.join(", ")}.`);
  const all = [...input.entries].filter((e) => Date.parse(e.time) < to).sort((a, b) => a.seq - b.seq);
  const month = all.filter((e) => Date.parse(e.time) >= from);
  const inMonth = (ms: number | undefined): boolean => ms !== undefined && ms >= from && ms < to;

  // ---- orders: the ones the owner approved in the month, read as they are now ----
  const placed = input.orders.filter((o) => inMonth(o.approvedMs));
  const countsOf = (list: readonly PurchaseOrder[]) => ({
    sentOut: list.filter((o) => o.sentMs !== undefined).length,
    acknowledged: list.filter((o) => o.ack === "accepted").length,
    declinedBySupplier: list.filter((o) => o.ack === "declined").length,
    silent: list.filter((o) => o.sentMs !== undefined && o.ack === "none").length,
    receivedFull: list.filter((o) => o.receipt === "full").length,
    partReceived: list.filter((o) => o.receipt === "part").length,
    wrongItem: list.filter((o) => o.receipt === "wrong_item").length,
  });
  const orders = {
    placed: placed.length,
    ...countsOf(placed),
    neverSent: placed.filter((o) => o.sentMs === undefined && (o.state === "cancelled" || o.state === "send_failed" || o.state === "send_blocked")).length,
    sendUnknown: placed.filter((o) => o.state === "send_unknown").length,
  };

  // ---- the owner's part ----
  const asked = input.orders.filter((o) => inMonth(o.createdMs));
  const owner = { asked: asked.length, approved: placed.length, saidNo: asked.filter((o) => o.state === "declined").length, voided: asked.filter((o) => o.state === "void").length };
  // the owner's own "paid" note: each order once, at the first mark in the month
  const markedPaidByOwner = { orders: new Set(month.filter((e) => e.action === "mark_paid_outside" && e.outcome === "confirmed" && e.booking).map((e) => e.booking as string)).size };

  // ---- the budget: what the placed orders that still hold it add up to ----
  const usedPaise = placed.filter(holdsBudget).reduce((n, o) => n + o.totalPaise, 0);
  const monthlyPaise = Math.round(settings.limits.monthlyBudgetInr * 100);
  const budget = { monthlyPaise, usedPaise, leftPaise: Math.max(0, monthlyPaise - usedPaise) };

  // ---- each supplier that was ordered from, by the shop's own name ----
  const suppliers: SupplierCounts[] = settings.suppliers
    .map((s) => ({ s, mine: placed.filter((o) => o.supplier === s.id) }))
    .filter(({ mine }) => mine.length > 0)
    .map(({ s, mine }) => {
      const c = countsOf(mine);
      return { id: s.id, name: s.name, placed: mine.length, acknowledged: c.acknowledged, receivedFull: c.receivedFull, partReceived: c.partReceived, wrongItem: c.wrongItem, declined: c.declinedBySupplier, silent: c.silent };
    });

  const byAction: Record<string, Record<string, number>> = {};
  for (const e of month) { byAction[e.action] ??= {}; byAction[e.action][e.outcome] = (byAction[e.action][e.outcome] ?? 0) + 1; }

  const midnight = { hour: 0, minute: 0 };
  const first = localParts(from, settings.timezone);
  const last = localParts(to - 1, settings.timezone);
  const firstDay: LocalDate = { year: first.year, month: first.month, day: first.day };
  const lastDay: LocalDate = { year: last.year, month: last.month, day: last.day };
  const nextMonth: LocalDate = firstDay.month === 12 ? { year: firstDay.year + 1, month: 1, day: 1 } : { year: firstDay.year, month: firstDay.month + 1, day: 1 };
  const wholeMonth = zonedToMs({ ...firstDay, day: 1 }, midnight, settings.timezone) === from && zonedToMs(nextMonth, midnight, settings.timezone) === to;
  return {
    format: "geometer-stock-orders-report/1",
    pathway: PATHWAY,
    source,
    shop: { name: settings.name, timeZone: settings.timezone, languages: settings.languages, ownerLanguage: settings.owner.language },
    preparedBy: input.preparedBy ?? null,
    ...(input.innovator === true ? { innovator: true as const } : {}),
    period: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), firstDay, lastDay, month: wholeMonth ? { year: firstDay.year, month: firstDay.month } : null },
    madeAt: new Date(madeAt).toISOString(),
    policyDigest: policyDigest(settings),
    record: { entries: month.length, digest: digestOf(all.map(entryDigest)), byAction },
    orders, owner, markedPaidByOwner, budget, suppliers,
    stopped: stopsIn(month),
    unconfirmed: { open: month.filter((e) => e.action === "send_order" && (e.outcome === "unconfirmed" || e.outcome === "failed")).length },
    notCounted: [...NOT_COUNTED],
    notTested: notTestedForReport(goLive, settings),
    goLive,
    anchor: input.ledger ? headOf(input.entries, input.ledger.tenant) : null,
  };
}

/** The report as the exact bytes that are digested and signed. */
export const reportBytes = (report: StockReport): string => canonicalJson(report);
