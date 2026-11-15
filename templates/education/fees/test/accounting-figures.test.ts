// The Fees report's money figures, from the books, equal what the report summed from the record before the books existed (docs/plans/accounting-module.md, 10).
//
// `oldMoney` below is the report's own sum as it was in report/data.ts before this change (kept here as the thing the books must agree with). It is run, with
// modules/accounting/figures.ts, over every record the template's tests build: the scripted busy month the report tests use, and every crash-test situation's world (the
// harness calls `worldHook` once for each world made), by calendar month and over the whole record. They must be equal to the paisa and the count. A few small
// hand-made older records pin the edges (a repeated payment, a refund a person settled by their word, a refund line that carries no amount).
import { test } from "node:test";
import assert from "node:assert/strict";
import { worldHook } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { runBusyMonth } from "../report/example-month.ts";
import { runOn } from "../crash-test/situations.ts";
import { FEES_LEGACY } from "../src/accounting.ts";
import { journal } from "../../../../modules/accounting/journal.ts";
import { figuresOf } from "../../../../modules/accounting/figures.ts";
import { booksFaults } from "../../../../modules/accounting/invariants.ts";
import { balancePaise } from "../src/due.ts";
import { isSettledByWord } from "../../../../modules/report/settled-by-word.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";

interface Amount { count: number; paise: number }
const empty = (): Amount => ({ count: 0, paise: 0 });
function add(a: Amount, paise: string | number | undefined): void {
  a.count += 1;
  const n = Number(paise);
  if (Number.isFinite(n)) a.paise += n;
}

/** The report's money as report/data.ts summed it before the books: collected, given back, waivers and late fees, over [from, to) in epoch milliseconds. */
function oldMoney(all: readonly RecordEntry[], upi: boolean, from: number, to: number) {
  const month = all.filter((e) => Date.parse(e.time) >= from && Date.parse(e.time) < to);
  const collected = empty();
  const seenPayments = new Set<string>();
  for (const e of month.filter((x) => (x.action === "record_payment" || (upi && x.action === "owner_marked_paid")) && x.outcome === "confirmed")) {
    const key = e.refs.paymentId ?? `seq-${e.seq}`;
    if (seenPayments.has(key)) continue;
    seenPayments.add(key);
    add(collected, e.refs.amountPaise);
  }
  const givenBack = empty();
  const seenRefunds = new Set<string>();
  for (const e of month.filter((x) => (x.action === "refund" || (upi && x.action === "upi_refund_marked_done")) && x.outcome === "confirmed" && !isSettledByWord(x))) {
    const key = e.refs.refundId ?? `seq-${e.seq}`;
    if (seenRefunds.has(key)) continue;
    seenRefunds.add(key);
    add(givenBack, e.refs.amountPaise);
  }
  const waived = empty();
  for (const e of month.filter((x) => x.action === "waive_fee" && x.outcome === "confirmed")) add(waived, e.refs.amountPaise);
  const lateFees = empty();
  for (const e of month.filter((x) => x.action === "add_late_fee" && x.outcome === "confirmed")) add(lateFees, e.refs.amountPaise);
  return { collected, givenBack, waived, lateFees };
}

function newMoney(all: readonly RecordEntry[], upi: boolean, from: number, to: number) {
  const f = figuresOf(journal(all, FEES_LEGACY), all, FEES_LEGACY, new Date(from).toISOString(), new Date(to).toISOString(), { ownerMarks: upi });
  return { collected: f.received, givenBack: { count: f.refunds.count, paise: f.refunds.paise }, waived: f.discounts, lateFees: f.lateFees };
}

/** The same record as one written before the books: no money fields, so the journal reads it through the template's frozen map. */
const olderForm = (all: readonly RecordEntry[]): RecordEntry[] => all.map((e) => { const { money: _m, ...refs } = e.refs; return { ...e, refs }; });

/** Each calendar month the record touches (in the shop's zone), and the whole record. */
function spans(all: readonly RecordEntry[], timezone: string): { label: string; from: number; to: number }[] {
  if (all.length === 0) return [];
  const months = new Set(all.map((e) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(new Date(e.time)).slice(0, 7)));
  return [...[...months].map((m) => ({ label: m, ...monthRange(m, timezone) })), { label: "whole record", from: 0, to: Date.parse("2100-01-01T00:00:00Z") }];
}

test("the books give the report's money, exactly, on the busy month and every crash-test situation", async () => {
  const worlds: World[] = [];
  worldHook.on = (w) => worlds.push(w);
  try {
    await runBusyMonth();
    await runOn();
  } finally { worldHook.on = undefined; }
  assert.ok(worlds.length > 20, `${worlds.length} worlds were made`);
  let seen = 0;
  worlds.forEach((w, i) => {
    const all = w.record.entries();
    const upi = !capabilitiesOf(w.settings.payment).confirmsAutomatically;
    for (const s of spans(all, w.settings.timezone)) {
      const old = oldMoney(all, upi, s.from, s.to);
      assert.deepEqual(newMoney(all, upi, s.from, s.to), old, `world ${i}, ${s.label}`);
      assert.deepEqual(newMoney(olderForm(all), upi, s.from, s.to), old, `world ${i}, ${s.label}, read as a record written before the books`);
      seen += old.collected.count + old.givenBack.count;
    }
    assert.deepEqual(journal(all, FEES_LEGACY).problems.filter((p) => !/already counted/.test(p.why)), [], `world ${i}: the journal reads every line of the record`);
    const j = journal(all, FEES_LEGACY);
    // the books hold after every situation (as in Bookings and Orders), and no student's name reaches a record entry's refs
    const dues = [...w.store.dues.values()];
    assert.deepEqual(booksFaults(all, FEES_LEGACY, { privateText: dues.map((d) => d.studentName) }), [], `world ${i}: the books hold`);
    // Fees keeps each fee's balance in its own store, before refunds (due.ts: "negative: more was paid than is owed, and the extra is to be refunded"). The books take
    // a refund owed out of the fee's overpaid receivable first and the rest from `returns` (a refund the owner gives on a fee paid exactly), so the books' receivable is
    // the store's balance plus the refunds owed on that fee, up to what was overpaid. A refund made, or kept by the owner, stays counted; a cancelled one does not.
    const owedOn = new Map<string, { case: string; paise: number }>();
    for (const e of all) {
      if (e.refs.money === "refund_owed" && j.linesOf(e.seq).length > 0) owedOn.set(e.refs.owed, { case: e.booking ?? "", paise: Number(e.refs.amountPaise) });
      if (e.refs.money === "refund_cancelled" && j.linesOf(e.seq).length > 0) owedOn.delete(e.refs.owed);
    }
    for (const d of dues) {
      const refunds = [...owedOn.values()].filter((o) => o.case === d.id).reduce((n, o) => n + o.paise, 0);
      const overpaid = Math.max(0, -balancePaise(d));
      assert.equal(j.receivableOf(d.id), balancePaise(d) + Math.min(refunds, overpaid), `world ${i}: fee ${d.id}'s receivable is its balance plus its refunds of what was overpaid`);
    }
    assert.deepEqual(all.filter((e) => e.refs.money === undefined && j.linesOf(e.seq).length > 0).map((e) => `${e.action}/${e.outcome}`), [], `world ${i}: every money line was written through post`);
  });
  assert.ok(seen > 50, `the comparison saw money: ${seen} figures`);
});

// ---- older, hand-made records: the edges --------------------------------------------------------------------------------------------------------

let seq = 0;
const entry = (action: string, outcome: string, refs: Record<string, string>, booking: string | null = "d-1"): RecordEntry =>
  ({ seq: ++seq, time: "2026-11-10T05:00:00.000Z", conversation: "+910000000001", booking, action, inputs: {}, outcome, decisions: [], refs, notes: "", language: "en" }) as unknown as RecordEntry;

test("older records without money fields: a repeated payment, a refund by a person's word, a refund with no amount, an owner's UPI mark", () => {
  seq = 0;
  const entries = [
    entry("record_payment", "confirmed", { paymentId: "pay_1", amountPaise: "20000" }),
    entry("record_payment", "confirmed", { paymentId: "pay_1", amountPaise: "20000" }), // the same payment again: counted once
    entry("refund", "confirmed", { paymentId: "pay_1", amountPaise: "20000", refundId: "rfnd_1" }),
    entry("refund", "confirmed", { paymentId: "pay_1", amountPaise: "20000", refundId: "rfnd_1" }), // the same refund again
    entry("refund", "confirmed", { paymentId: "pay_4", amountPaise: "30000", confirmedBy: "Ravi" }, "d-3"), // a person's word: not a refund made
    entry("refund", "confirmed", { paymentId: "pay_1", refundId: "rfnd_9" }), // looked for again: no amount of its own, the payment's earlier one is used
    entry("waive_fee", "confirmed", { amountPaise: "10000", by: "owner" }),
    entry("waive_fee", "confirmed", { amountPaise: "5000", by: "limit" }),
    entry("add_late_fee", "confirmed", { amountPaise: "5000" }),
    entry("open_fee", "confirmed", { month: "2026-11", amountPaise: "180000" }),
    entry("owner_marked_paid", "confirmed", { paymentId: "cash-1", amountPaise: "50000", markedBy: "owner", via: "cash" }), // an owner mark on a gateway shop: the report has never summed it, and still does not
  ];
  const t = Date.parse("2026-11-01T00:00:00Z");
  assert.deepEqual(newMoney(entries, false, t, t + 40 * 86400000), oldMoney(entries, false, t, t + 40 * 86400000));
  const upiEntries = [
    entry("owner_marked_paid", "confirmed", { paymentId: "mark_1", amountPaise: "20000", markedBy: "owner" }),
    entry("owner_marked_paid", "confirmed", { paymentId: "cash-d-1-1", amountPaise: "50000", markedBy: "owner", via: "cash" }),
    entry("upi_refund_owed", "held_for_owner", { refundId: "upr-1", paymentId: "mark_1", amountPaise: "5000" }),
    entry("upi_refund_marked_done", "confirmed", { refundId: "upr-1", paymentId: "mark_1", amountPaise: "5000" }),
  ];
  assert.deepEqual(newMoney(upiEntries, true, t, t + 40 * 86400000), oldMoney(upiEntries, true, t, t + 40 * 86400000));
});
