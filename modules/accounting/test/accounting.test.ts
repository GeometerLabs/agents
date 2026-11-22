// The accounting core: the fold (journal.ts), the one writer (post.ts) and the document numbers (numbers.ts), each on a real record (modules/record/record.ts).
// What is pinned here, and why: every entry balances; a money fact counts once however often it is posted; a number is gap-free, at most 16 characters, and moves on
// after a restore; a line that is not written as posted throws (so the runtime saves nothing of that step); older lines read through the legacy map give the same
// accounts as new ones; and the three files the browser demo and the open check run import nothing from `node:`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeClock } from "../../core/clock.ts";
import { zonedToMs } from "../../core/time.ts";
import { createRecord } from "../../record/record.ts";
import type { ActionRecord, Outcome } from "../../record/record.ts";
import { balances, journal } from "../journal.ts";
import type { LegacyMap } from "../journal.ts";
import { createAccounting } from "../post.ts";
import { figuresOf } from "../figures.ts";
import type { MoneyEvent } from "../post.ts";
import { RESTORE_DOC_GAP, formatNumber, fyOf, fyStartMs, nextNumber, parseNumber } from "../numbers.ts";

const TZ = "Asia/Kolkata";
const NOV_15 = zonedToMs({ year: 2026, month: 11, day: 15 }, { hour: 10, minute: 0 }, TZ);
const LEGACY: LegacyMap = {
  received: [
    { action: "record_deposit", outcome: "confirmed", for: "advance" },
    { action: "record_deposit", outcome: "blocked", for: "extra" },
    { action: "owner_marked_paid", outcome: "confirmed", for: "advance" },
  ],
  applied: [{ action: "complete_booking", account: "revenue:bookings" }],
};
const FEES_LEGACY: LegacyMap = {
  received: [{ action: "record_payment", outcome: "confirmed", for: "fee" }, { action: "owner_marked_paid", outcome: "confirmed", for: "fee" }],
  feeCharged: "open_fee", lateFee: "add_late_fee", discount: "waive_fee",
};

function world(legacy = LEGACY, startMs = NOV_15) {
  const clock = fakeClock(startMs);
  const record = createRecord(clock);
  const acc = createAccounting({ record, shop: { timezone: TZ }, legacy, clock });
  /** A template's own line, as `log` writes it: here the action names are Bookings'. */
  const line = (r: ActionRecord, c: string | null, action: string, outcome: Outcome, refs: Record<string, string> = {}) =>
    r.append({ conversation: "+919800000001", booking: c, action, inputs: {}, outcome, language: "en", refs });
  const post = (event: MoneyEvent, action: string, outcome: Outcome = "confirmed", own: Record<string, string> = {}) =>
    acc.post(event, (refs) => line(record, "case" in event ? event.case : null, action, outcome, { ...own, ...refs }));
  return { clock, record, acc, line: (c: string | null, action: string, outcome: Outcome, refs?: Record<string, string>) => line(record, c, action, outcome, refs), post };
}

const sumZero = (lines: { debitPaise: number; creditPaise: number }[]) => lines.reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);

test("numbers: the financial year turns on 1 April in the shop's time zone, and a number is at most 16 characters", () => {
  assert.equal(fyOf(zonedToMs({ year: 2027, month: 3, day: 31 }, { hour: 23, minute: 59 }, TZ), TZ), "26-27");
  assert.equal(fyOf(zonedToMs({ year: 2027, month: 4, day: 1 }, { hour: 0, minute: 0 }, TZ), TZ), "27-28");
  assert.equal(formatNumber({ series: "RCT", fy: "26-27", n: 7 }), "RCT/26-27/0007");
  assert.equal(formatNumber({ series: "BILL", fy: "26-27", n: 99_999 }), "BILL/26-27/99999"); // 16
  assert.throws(() => formatNumber({ series: "BILL", fy: "26-27", n: 100_000 }), /16 characters/);
  assert.throws(() => formatNumber({ series: "CN", fy: "26-27", n: 0 }), /1 or more/);
  assert.deepEqual(parseNumber("CN/26-27/0012"), { series: "CN", fy: "26-27", n: 12 });
  assert.equal(parseNumber("CN/26-28/0012"), null);
  assert.equal(parseNumber("RCT 26-27 0001"), null);
  assert.equal(fyStartMs("26-27", TZ), zonedToMs({ year: 2026, month: 4, day: 1 }, { hour: 0, minute: 0 }, TZ));
});

test("a Bookings deposit through a gateway: received into advances, applied to the service when the booking is done; every entry balances", () => {
  const w = world();
  const r1 = w.post({ kind: "received", case: "b-1", paymentId: "pay_1", amountPaise: 20_000, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit");
  assert.deepEqual(r1, { posted: true, doc: "RCT/26-27/0001" });
  const j1 = w.acc.journal();
  assert.equal(j1.advancesOf("b-1"), 20_000);
  w.post({ kind: "applied", case: "b-1", amountPaise: 20_000, service: "haircut" }, "complete_booking");
  const j = w.acc.journal();
  assert.equal(j.problems.length, 0);
  assert.equal(j.advancesOf("b-1"), 0);
  const b = balances(j.lines);
  assert.equal(b.gateway, 20_000);
  assert.equal(b["revenue:haircut"], -20_000);
  assert.equal(sumZero(j.lines), 0);
  assert.deepEqual(j.documents.map((d) => d.number), ["RCT/26-27/0001"]); // an unregistered shop issues no bill for work done: the receipt is the document
});

test("a refund owed, then made through the gateway: the deposit goes to refunds owed, then out; a credit note is numbered", () => {
  const w = world();
  w.post({ kind: "received", case: "b-2", paymentId: "pay_2", amountPaise: 20_000, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit");
  w.post({ kind: "refund_owed", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 20_000 }, "refund", "attempted");
  let j = w.acc.journal();
  assert.equal(j.openOwed("b-2:pay_2"), 20_000);
  assert.equal(j.advancesOf("b-2"), 0);
  const made = w.post({ kind: "refund_made", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", refundId: "rfd_1", amountPaise: 20_000, method: "gateway", evidence: "provider" }, "refund");
  assert.equal(made.doc, "CN/26-27/0001");
  j = w.acc.journal();
  assert.equal(j.openOwed("b-2:pay_2"), 0);
  const b = balances(j.lines);
  assert.equal(b.gateway ?? 0, 0);
  assert.equal(b.refunds_owed ?? 0, 0);
  assert.equal(sumZero(j.lines), 0);
});

test("a refund owed and then cancelled (the owner's no, an approval that ran out) puts the money back where it came from", () => {
  const w = world();
  w.post({ kind: "received", case: "b-3", paymentId: "pay_3", amountPaise: 30_000, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit");
  w.post({ kind: "refund_owed", case: "b-3", owed: "b-3:pay_3", paymentId: "pay_3", amountPaise: 30_000 }, "refund", "attempted");
  w.post({ kind: "refund_cancelled", case: "b-3", owed: "b-3:pay_3", why: "owner_said_no" }, "refund", "blocked");
  const j = w.acc.journal();
  assert.equal(j.advancesOf("b-3"), 30_000);
  assert.equal(balances(j.lines).refunds_owed ?? 0, 0);
  // and the owner keeps the deposit of the late cancellation
  w.post({ kind: "kept", case: "b-3", amountPaise: 30_000, why: "late_cancellation" }, "owner_decision");
  const k = w.acc.journal();
  assert.equal(k.advancesOf("b-3"), 0);
  assert.equal(balances(k.lines)["revenue:kept"], -30_000);
});

test("a refund owed that the owner keeps (`kept` naming `owed`) posts with no amount in its line: the amount is the refund's open part, and a second keep is a repeat", () => {
  // Found in the Go port (22 Nov): the reader demanded an amount post() never writes for this event, so the line was a problem and post() threw unless the
  // template happened to add `amountPaise` to its own refs.
  const w = world();
  w.post({ kind: "received", case: "b-9", paymentId: "pay_9", amountPaise: 25_000, method: "gateway", evidence: "provider", for: "advance" }, "record_deposit");
  w.post({ kind: "refund_owed", case: "b-9", owed: "upr-9", paymentId: "pay_9", amountPaise: 25_000 }, "upi_refund_owed", "held_for_owner");
  const kept = w.post({ kind: "kept", case: "b-9", owed: "upr-9", why: "late_mark_kept" }, "upi_refund_kept");
  assert.deepEqual(kept, { posted: true });
  const line = w.record.entries().at(-1)!;
  assert.equal(line.refs.amountPaise, undefined);
  const j = w.acc.journal();
  assert.deepEqual(j.problems, []);
  assert.equal(j.openOwed("upr-9"), 0);
  assert.equal(balances(j.lines)["revenue:kept"], -25_000);
  assert.equal(w.post({ kind: "kept", case: "b-9", owed: "upr-9", why: "late_mark_kept" }, "upi_refund_kept").posted, false);
});

test("once: a payment posted twice, a refund owed twice, a refund made twice are counted once; the repeated line carries no money and no number", () => {
  const w = world();
  const ev: MoneyEvent = { kind: "received", case: "b-4", paymentId: "upi-pay-1", amountPaise: 20_000, method: "upi", evidence: "owner_mark", for: "advance" };
  assert.equal(w.post(ev, "owner_marked_paid").posted, true);
  const again = w.post(ev, "owner_marked_paid");
  assert.equal(again.posted, false);
  assert.match(again.why ?? "", /already counted/);
  assert.equal(w.record.entries().at(-1)!.refs.money, undefined);
  assert.equal(w.record.entries().at(-1)!.refs.doc, undefined);
  const owed: MoneyEvent = { kind: "refund_owed", case: "b-4", owed: "upr-1", paymentId: "upi-pay-1", amountPaise: 20_000 };
  assert.equal(w.post(owed, "upi_refund_owed", "held_for_owner").posted, true);
  assert.equal(w.post(owed, "upi_refund_owed", "held_for_owner").posted, false);
  const made: MoneyEvent = { kind: "refund_made", case: "b-4", owed: "upr-1", paymentId: "upi-pay-1", refundId: "upr-1", amountPaise: 20_000, method: "upi", evidence: "owner_mark" };
  assert.equal(w.post(made, "upi_refund_marked_done").posted, true);
  assert.equal(w.post(made, "upi_refund_marked_done").posted, false);
  const j = w.acc.journal();
  assert.equal(balances(j.lines).upi ?? 0, 0);
  assert.deepEqual(j.documents.map((d) => d.number), ["RCT/26-27/0001", "CN/26-27/0001"]);
});

test("numbers are gap-free per series and year, and start again at 1 on 1 April", () => {
  const w = world(LEGACY, zonedToMs({ year: 2027, month: 3, day: 31 }, { hour: 23, minute: 0 }, TZ));
  for (let i = 1; i <= 3; i++) w.post({ kind: "received", case: `b-${i}`, paymentId: `p${i}`, amountPaise: 100, method: "cash", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  w.clock.advance(2 * 60 * 60 * 1000); // 1 April, 01:00
  w.post({ kind: "received", case: "b-9", paymentId: "p9", amountPaise: 100, method: "cash", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  assert.deepEqual(w.acc.journal().documents.map((d) => d.number), ["RCT/26-27/0001", "RCT/26-27/0002", "RCT/26-27/0003", "RCT/27-28/0001"]);
});

test("after a restore each series moves on, so a number a customer may hold from before is never issued again", () => {
  const w = world();
  w.post({ kind: "received", case: "b-1", paymentId: "p1", amountPaise: 100, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  w.line(null, "restored", "confirmed", { snapshot: "2026-11-14" });
  const r = w.post({ kind: "received", case: "b-2", paymentId: "p2", amountPaise: 100, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  assert.equal(r.doc, formatNumber({ series: "RCT", fy: "26-27", n: 2 + RESTORE_DOC_GAP }));
  // the next one after that is simply the next: the restore was already moved past
  const r2 = w.post({ kind: "received", case: "b-3", paymentId: "p3", amountPaise: 100, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  assert.equal(r2.doc, formatNumber({ series: "RCT", fy: "26-27", n: 3 + RESTORE_DOC_GAP }));
  // a series that issued nothing before the restore moves on too (its documents may have been lost with the snapshot)
  assert.equal(nextNumber(w.record.entries(), "CN", "26-27", fyStartMs("26-27", TZ)).n, 1 + RESTORE_DOC_GAP);
});

test("read-back: a line not written, written for another case, or written with other money facts throws (and the runtime then saves nothing of the step)", () => {
  const w = world();
  const ev: MoneyEvent = { kind: "received", case: "b-1", paymentId: "p1", amountPaise: 500, method: "upi", evidence: "owner_mark", for: "advance" };
  assert.throws(() => w.acc.post(ev, () => undefined), /not written as one record entry/);
  assert.throws(() => w.acc.post(ev, (refs) => w.line("b-2", "owner_marked_paid", "confirmed", refs)), /written for b-2/);
  assert.throws(() => w.acc.post({ ...ev, paymentId: "p2" }, (refs) => w.line("b-1", "owner_marked_paid", "confirmed", { ...refs, amountPaise: "400" })), /amountPaise is "400"/);
  assert.throws(() => w.acc.post({ ...ev, paymentId: "p3", amountPaise: 12.5 }, () => undefined), /whole number of paise/);
  assert.throws(() => w.acc.post({ kind: "applied", case: "b-1", amountPaise: 100, service: "Hair Cut!" }, () => undefined), /not a service id/);
});

test("Fees: a month's fee and a late fee are owed, payments count against them, an overpayment is given back from what was paid beyond", () => {
  const w = world(FEES_LEGACY);
  assert.equal(w.post({ kind: "fee_charged", case: "f-1.1", amountPaise: 100_000 }, "open_fee").doc, "BILL/26-27/0001");
  w.post({ kind: "late_fee", case: "f-1.1", amountPaise: 5_000 }, "add_late_fee");
  w.post({ kind: "discount", case: "f-1.1", amountPaise: 5_000 }, "waive_fee");
  w.post({ kind: "received", case: "f-1.1", paymentId: "pay_a", amountPaise: 60_000, method: "gateway", evidence: "provider", for: "fee" }, "record_payment");
  w.post({ kind: "received", case: "f-1.1", paymentId: "cash-f-1.1-1", amountPaise: 50_000, method: "cash", evidence: "owner_mark", for: "fee" }, "owner_marked_paid");
  let j = w.acc.journal();
  assert.equal(j.receivableOf("f-1.1"), -10_000); // paid 10,000 paise beyond what is owed
  w.post({ kind: "refund_owed", case: "f-1.1", owed: "f-1.1:pay_a", paymentId: "pay_a", amountPaise: 10_000 }, "refund", "attempted");
  j = w.acc.journal();
  assert.equal(j.receivableOf("f-1.1"), 0);
  const b = balances(j.lines);
  assert.equal(b["revenue:fees"], -100_000);
  assert.equal(b["revenue:late_fees"], -5_000);
  assert.equal(b.discounts, 5_000);
  assert.equal(b.refunds_owed, -10_000);
  assert.equal(sumZero(j.lines), 0);
});

test("a correction reverses an entry the owner made, once; a payment or a refund is never corrected that way", () => {
  const w = world(FEES_LEGACY);
  w.post({ kind: "fee_charged", case: "f-2.1", amountPaise: 80_000 }, "open_fee");
  w.post({ kind: "write_off", case: "f-2.1", amountPaise: 80_000 }, "write_off");
  const seq = w.record.entries().at(-1)!.seq;
  assert.equal(w.post({ kind: "correction", case: "f-2.1", reverses: seq, why: "owner" }, "accounting_correction").posted, true);
  assert.equal(w.post({ kind: "correction", case: "f-2.1", reverses: seq, why: "owner" }, "accounting_correction").posted, false);
  assert.equal(w.acc.journal().receivableOf("f-2.1"), 80_000);
  w.post({ kind: "received", case: "f-2.1", paymentId: "p", amountPaise: 80_000, method: "upi", evidence: "owner_mark", for: "fee" }, "owner_marked_paid");
  const paid = w.record.entries().at(-1)!.seq;
  assert.throws(() => w.post({ kind: "correction", case: "f-2.1", reverses: paid, why: "owner" }, "accounting_correction"), /corrected by its own flow/);
});

test("older lines (no refs.money) read through the legacy map give the same accounts; what they cannot say is a problem, never a guess", () => {
  const w = world();
  w.line("b-1", "record_deposit", "confirmed", { paymentId: "pay_1", linkId: "plink_1", amountPaise: "20000" });
  w.line("b-1", "record_deposit", "blocked", { paymentId: "pay_2", amountPaise: "20000" }); // a second payment on the link
  w.line("b-1", "refund", "attempted", { paymentId: "pay_2", amountPaise: "20000" });
  w.line("b-1", "refund", "confirmed", { paymentId: "pay_2", amountPaise: "20000", refundId: "rfd_9" });
  w.line("b-1", "complete_booking", "confirmed");
  w.line("b-5", "owner_marked_paid", "confirmed", { paymentId: "upi-pay-3", requestId: "upi-1", amountPaise: "15000", markedBy: "owner" });
  w.line("b-5", "upi_refund_owed", "held_for_owner", { refundId: "upr-2", paymentId: "upi-pay-3", amountPaise: "15000" });
  w.line("b-5", "upi_refund_kept", "confirmed", { refundId: "upr-2", paymentId: "upi-pay-3", amountPaise: "15000" });
  w.line("b-6", "refund", "confirmed", { paymentId: "pay_6", amountPaise: "5000", confirmedBy: "operator:ravi" }); // a person's word
  w.line("b-7", "record_deposit", "confirmed", { paymentId: "pay_7" }); // no amount
  const j = journal(w.record.entries(), LEGACY);
  const b = balances(j.lines);
  assert.equal(b["revenue:bookings"], -20_000);
  assert.equal(b["revenue:kept"], -15_000);
  assert.equal(b.gateway, 20_000 + 20_000 - 20_000 - 5_000);
  assert.equal(j.lines.find((l) => l.case === "b-6")!.evidence, "person_word");
  assert.deepEqual(j.problems.map((p) => p.seq), [w.record.entries().at(-1)!.seq]);
  assert.match(j.problems[0].why, /amount is missing/);
  assert.equal(j.documents.length, 0); // older payments were issued no documents
  // and the same record read one entry at a time gives the same lines (the cached fold post.ts keeps)
  const k = createAccounting({ record: w.record, shop: { timezone: TZ }, legacy: LEGACY, clock: w.clock }).journal();
  assert.deepEqual(k.lines, j.lines);
});

test("figures: a refund line with no amount borrows an earlier line's amount only when that is whole paise as the journal writes it (\"1e3\" or \"12.5\" is not)", () => {
  // Found in the Go port (22 Nov): figures.ts read the borrowed amount with a bare Number(), so "1e3" lent 1000 and "12.5" a fraction of a paisa.
  const figures = (amount: string) => {
    const w = world();
    w.line("b-1", "refund", "confirmed", { paymentId: "pay_1", refundId: "rf_1", amountPaise: amount });
    w.line("b-1", "refund", "confirmed", { paymentId: "pay_1", refundId: "rf_2" });
    return figuresOf(w.acc.journal(), w.record.entries(), LEGACY, "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", { refundAmountFromPayment: true });
  };
  const whole = figures("1000");
  assert.equal(whole.refunds.paise, 2000); // the line's own 1000, and 1000 borrowed by the second
  assert.equal(whole.missing.refundAmounts, 0);
  for (const bad of ["1e3", "12.5", "0x10"]) {
    const f = figures(bad);
    assert.equal(f.refunds.paise, 0, bad);
    assert.equal(f.missing.refundAmounts, 2, bad);
  }
});

test("an unknown kind, a bad amount or an unknown account in a money line is a problem and gives no lines", () => {
  const w = world();
  w.line("b-1", "record_deposit", "confirmed", { money: "gift", amountPaise: "100" });
  w.line("b-1", "record_deposit", "confirmed", { money: "received", amountPaise: "-5", paymentId: "x", method: "upi", evidence: "owner_mark", for: "advance" });
  w.line("b-1", "complete_booking", "confirmed", { money: "applied", amountPaise: "100", service: "BAD ID" });
  const j = journal(w.record.entries(), LEGACY);
  assert.equal(j.lines.length, 0);
  assert.equal(j.problems.length, 3);
});

test("a regular GST shop is refused in plain words (the owner's decision: not yet)", () => {
  const clock = fakeClock(NOV_15);
  assert.throws(() => createAccounting({ record: createRecord(clock), shop: { timezone: TZ, status: "regular" as never }, legacy: LEGACY, clock }), /not supported/);
});

test("the fold, the accounts and the numbers import nothing from node: (the browser demo and the open check run them)", () => {
  for (const f of ["journal.ts", "accounts.ts", "numbers.ts", "post.ts"]) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /from\s+["']node:/u, f);
  }
});
