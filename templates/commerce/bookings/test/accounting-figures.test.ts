// The Bookings report's money figures, from the books, equal what the report summed from the record before the books existed (docs/plans/accounting-module.md, 10).
//
// `oldMoney` below is the report's own sum as it was in report/data.ts before this change (kept here, word for word, as the thing the books must agree with). It is run,
// with modules/accounting/figures.ts, over every record the template's tests build: the scripted busy month the sample report is made from, and every crash-test
// situation's world (the situations run on the shop's own Go program; modules/crash-test/go-world.ts `goWorldHook` hands each world's record over as it closes), by calendar month and over the whole record. They must be equal to the paisa and the count.
// A few small hand-made older records pin the edges (a missing amount, a repeated payment, a refund a person settled by their word, an owner's UPI mark).
import { test } from "node:test";
import assert from "node:assert/strict";
import { goWorldHook } from "../../../../modules/crash-test/go-world.ts";
import { goSkip } from "../../../../modules/crash-test/go-shop.ts";
import type { Settings } from "../src/settings.ts";
import type { RecordEntry as Line } from "../../../../modules/record/record.ts";

/** A record to check: the busy month's (the demo engine's scripted month) or one crash-test situation's world, read from the shop's own Go program as it closed. */
interface World { settings: Settings; record: { entries(): readonly Line[] } }
import { runBusyMonth } from "../report/example-month.ts";
import { runOn } from "../crash-test/situations.ts";
import { BOOKINGS_LEGACY } from "../src/accounting.ts";
import { journal } from "../../../../modules/accounting/journal.ts";
import { figuresOf } from "../../../../modules/accounting/figures.ts";
import { booksFaults, figuresFaults } from "../../../../modules/accounting/invariants.ts";
import { isSettledByWord, settledByWordOf } from "../../../../modules/report/settled-by-word.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";

interface Amount { count: number; paise: number }
const empty = (): Amount => ({ count: 0, paise: 0 });
function tally(totals: Amount[], amountPaise: string | undefined): boolean {
  const paise = amountPaise === undefined ? NaN : Number(amountPaise);
  const ok = Number.isInteger(paise) && paise >= 0;
  for (const t of totals) { t.count++; if (ok) t.paise += paise; }
  return ok;
}

/** The report's money, as report/data.ts summed it before the books (deposits, refunds and what is missing), over [from, to) in epoch milliseconds. */
function oldMoney(all: readonly RecordEntry[], upi: boolean, from: number, to: number) {
  const month = all.filter((e) => Date.parse(e.time) >= from && Date.parse(e.time) < to);
  const before = all.filter((e) => Date.parse(e.time) < to);
  const depositPayments = new Set(before.filter((e) => e.action === "record_deposit" && e.outcome === "confirmed").map((e) => e.refs.paymentId).filter(Boolean));
  const missing = { depositAmounts: 0, refundAmounts: 0 };
  const deposits = empty();
  const seenDeposits = new Set<string>();
  for (const e of month.filter((x) => (x.action === "record_deposit" || (upi && x.action === "owner_marked_paid")) && x.outcome === "confirmed")) {
    const key = e.refs.paymentId ?? `seq-${e.seq}`;
    if (seenDeposits.has(key)) continue;
    seenDeposits.add(key);
    if (!tally([deposits], e.refs.amountPaise)) missing.depositAmounts++;
  }
  const refunds = { ...empty(), ofDeposits: empty(), ofSecondPayments: empty() };
  const seenRefunds = new Set<string>();
  for (const e of month.filter((x) => (x.action === "refund" || (upi && x.action === "upi_refund_marked_done")) && x.outcome === "confirmed" && !isSettledByWord(x))) {
    const key = e.refs.refundId ?? `seq-${e.seq}`;
    if (seenRefunds.has(key)) continue;
    seenRefunds.add(key);
    const part = depositPayments.has(e.refs.paymentId) || e.action === "upi_refund_marked_done" ? refunds.ofDeposits : refunds.ofSecondPayments;
    if (!tally([refunds, part], e.refs.amountPaise)) missing.refundAmounts++;
  }
  missing.refundAmounts += settledByWordOf(month).missingAmounts;
  return { deposits, refunds, missing };
}

function newMoney(all: readonly RecordEntry[], upi: boolean, from: number, to: number) {
  const f = figuresOf(journal(all, BOOKINGS_LEGACY), all, BOOKINGS_LEGACY, new Date(from).toISOString(), new Date(to).toISOString(), { ownerMarks: upi });
  return { deposits: f.received, refunds: f.refunds, missing: f.missing };
}

/** The same record as one written before the books: no money fields, so the journal reads it through the template's frozen map. */
const olderForm = (all: readonly RecordEntry[]): RecordEntry[] => all.map((e) => { const { money: _m, ...refs } = e.refs; return { ...e, refs }; });

/** Each calendar month the record touches (in the shop's zone), and the whole record. */
function spans(all: readonly RecordEntry[], timezone: string): { label: string; from: number; to: number }[] {
  if (all.length === 0) return [];
  const months = new Set(all.map((e) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(new Date(e.time)).slice(0, 7)));
  return [...[...months].map((m) => ({ label: m, ...monthRange(m, timezone) })), { label: "whole record", from: 0, to: Date.parse("2100-01-01T00:00:00Z") }];
}

function equal(label: string, all: readonly RecordEntry[], upi: boolean, timezone: string): number {
  let counted = 0;
  for (const s of spans(all, timezone)) {
    const old = oldMoney(all, upi, s.from, s.to);
    assert.deepEqual(newMoney(all, upi, s.from, s.to), old, `${label}, ${s.label}`);
    assert.deepEqual(newMoney(olderForm(all), upi, s.from, s.to), old, `${label}, ${s.label}, read as a record written before the books`);
    counted += old.deposits.count + old.refunds.count;
  }
  return counted;
}

test("the books give the report's deposits, refunds and missing amounts, exactly, on the busy month and every crash-test situation", { skip: goSkip("bookings") }, async () => {
  const worlds: World[] = [];
  goWorldHook.closing = (w) => worlds.push({ settings: w.settings as Settings, record: { entries: () => w.entries } });
  try {
    worlds.push((await runBusyMonth()).world);
    await runOn();
  } finally { goWorldHook.closing = undefined; }
  assert.ok(worlds.length > 40, `${worlds.length} worlds were made`);
  let counted = 0;
  let refundsSeen = 0;
  let secondPayments = 0;
  worlds.forEach((w, i) => {
    const upi = !capabilitiesOf(w.settings.payment).confirmsAutomatically;
    counted += equal(`world ${i}`, w.record.entries(), upi, w.settings.timezone);
    const j = journal(w.record.entries(), BOOKINGS_LEGACY);
    assert.deepEqual(j.problems.filter((p) => !/already counted/.test(p.why)), [], `world ${i}: the journal reads every line of the record`);
    // the books hold after every situation: balanced entries, money once, refunds owed equal to the open refunds, numbers with no gap, no phone number in refs
    assert.deepEqual(booksFaults(w.record.entries(), BOOKINGS_LEGACY), [], `world ${i}: the books hold`);
    // the report's rows and its "Money this month" block differ only by what booksOnly names (a payment made twice, the owner's own marks)
    assert.deepEqual(figuresFaults(w.record.entries(), BOOKINGS_LEGACY), [], `world ${i}: the rows and the block differ only by booksOnly`);
    assert.deepEqual(w.record.entries().filter((e) => e.refs.money === undefined && j.linesOf(e.seq).length > 0).map((e) => `${e.action}/${e.outcome}`), [], `world ${i}: every money line was written through post`);
    const f = figuresOf(j, w.record.entries(), BOOKINGS_LEGACY, "1970-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
    refundsSeen += f.refunds.count;
    secondPayments += f.refunds.ofSecondPayments.count;
  });
  assert.ok(counted > 100 && refundsSeen > 5 && secondPayments > 0, `the comparison saw money: ${counted} figures, ${refundsSeen} refunds, ${secondPayments} of second payments`);
});

// ---- older, hand-made records: the edges --------------------------------------------------------------------------------------------------------

let seq = 0;
const entry = (action: string, outcome: string, refs: Record<string, string>, time = "2026-11-10T05:00:00.000Z", booking: string | null = "b-1"): RecordEntry =>
  ({ seq: ++seq, time, conversation: "+910000000001", booking, action, inputs: {}, outcome, decisions: [], refs, notes: "", language: "en" }) as unknown as RecordEntry;

test("older records without money fields: a missing amount, a repeated payment, a refund by a person's word, an owner's UPI mark", () => {
  seq = 0;
  const entries = [
    entry("record_deposit", "confirmed", { paymentId: "pay_1", amountPaise: "20000" }),
    entry("record_deposit", "confirmed", { paymentId: "pay_1", amountPaise: "20000" }), // the same payment again: counted once
    entry("record_deposit", "confirmed", { paymentId: "pay_2" }, undefined, "b-2"), // no amount: counted, adds nothing, listed as missing
    entry("record_deposit", "blocked", { paymentId: "pay_3", amountPaise: "20000" }, undefined, "b-1"), // a second payment: not a deposit
    entry("refund", "confirmed", { paymentId: "pay_1", amountPaise: "20000", refundId: "rfnd_1" }),
    entry("refund", "confirmed", { paymentId: "pay_1", amountPaise: "20000", refundId: "rfnd_1" }), // the same refund again
    entry("refund", "confirmed", { paymentId: "pay_3", amountPaise: "20000", refundId: "rfnd_3" }), // of a second payment
    entry("refund", "confirmed", { paymentId: "pay_4", amountPaise: "20000", confirmedBy: "Ravi" }, undefined, "b-3"), // a person's word: not a refund made
    entry("refund", "confirmed", { paymentId: "pay_5", refundId: "rfnd_5" }, undefined, "b-4"), // no amount
    entry("owner_marked_paid", "confirmed", { paymentId: "cash-1", amountPaise: "50000", markedBy: "owner", via: "cash" }), // an owner mark on a gateway shop: the report has never summed it, and still does not
  ];
  const t = Date.parse("2026-11-01T00:00:00Z");
  assert.deepEqual(newMoney(entries, false, t, t + 40 * 86400000), oldMoney(entries, false, t, t + 40 * 86400000));
  const upiEntries = [
    entry("owner_marked_paid", "confirmed", { paymentId: "mark_1", amountPaise: "20000", markedBy: "owner" }),
    entry("upi_refund_owed", "held_for_owner", { refundId: "upr-1", paymentId: "mark_1", amountPaise: "5000" }),
    entry("upi_refund_marked_done", "confirmed", { refundId: "upr-1", paymentId: "mark_1", amountPaise: "5000" }),
  ];
  assert.deepEqual(newMoney(upiEntries, true, t, t + 40 * 86400000), oldMoney(upiEntries, true, t, t + 40 * 86400000));
});
