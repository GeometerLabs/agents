// Settlements and the Tally files (plan step 6). Nothing here has run against a real Razorpay account or a real TallyPrime: no live key exists. The recon is read
// through the stand-in (written from Razorpay's documents), and the Tally XML is checked by a small strict well-formedness reader written here plus the sum of every
// voucher. What is tested: the recon read (pages, a refund row, a held row), the fee checked both ways and a row that fits neither, a row posted once, a row for a
// payment the books do not know listed and not posted, the daily job (a day read once, a failed read tried again), the owner's not-matched words, the settlements
// file, and the Tally XML (well formed, every voucher sums to zero, special characters escaped, no phone number or name).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { zonedToMs } from "../../core/time.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { capabilitiesOf } from "../../payments/providers/index.ts";
import { createRazorpayPayments, toSettlementRow } from "../../payments/providers/razorpay/api.ts";
import { razorpayStandin } from "../../payments/providers/razorpay/standin.ts";
import { createFakePayments } from "../../payments/payments.ts";
import type { Payments, SettlementRow } from "../../payments/payments.ts";
import { createRecord } from "../../record/record.ts";
import { bannedIn } from "../../report/claims.ts";
import { serveHandlers } from "../../standins/http.ts";
import { accountantFiles } from "../export.ts";
import { checkSettlementRow } from "../journal.ts";
import type { Line } from "../journal.ts";
import { ownerMoney } from "../owner-money.ts";
import { ownerMoneySection } from "../owner-money-render.ts";
import { createAccounting } from "../post.ts";
import type { MoneyEvent } from "../post.ts";
import { SETTLEMENT_ACTIONS, readSettlementsOnce, yesterdayOf } from "../settlements.ts";
import { tallyFiles, xml } from "../tally.ts";
import { figuresOf } from "../figures.ts";
import { booksFaults } from "../invariants.ts";
import { reportAccounting } from "../summary.ts";
import { checkAccounting } from "../check.ts";
import { headOf } from "../../record/ledger.ts";
import { packOf } from "./pack-helpers.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, year = 2026) => zonedToMs({ year, month, day }, { hour, minute: 0 }, TZ);
const PHONE = "+919800000001";
const NAME = "Asha Menon";
const NOW = at(11, 13, 10); // yesterday is 12 Nov
const DAY = { year: 2026, month: 11, day: 12 };

/** The shop's books over one record, and the helper every test uses to put money in them the way a template does. */
function shop(start = at(11, 10, 11)) {
  const clock = fakeClock(start);
  const record = createRecord(clock);
  const acc = createAccounting({ record, shop: { timezone: TZ }, legacy: { received: [] }, clock });
  const post = (event: MoneyEvent, action = "record_deposit") =>
    acc.post(event, (refs) => record.append({ conversation: PHONE, booking: "case" in event ? event.case : null, action, inputs: { name: NAME }, outcome: "confirmed", language: "en", notes: `${NAME} ${PHONE}`, refs }));
  const received = (c: string, id: string, amountPaise: number) => post({ kind: "received", case: c, paymentId: id, amountPaise, method: "gateway", evidence: "provider", for: "advance" });
  return { clock, record, acc, post, received };
}
type Shop = ReturnType<typeof shop>;

const job = (w: Shop, payments: Payments, nowMs = NOW) => readSettlementsOnce({ payments, accounting: w.acc, record: w.record, conversation: PHONE, language: "en", nowMs, timeZone: TZ });

/** A payments service that answers `readSettlements` with the rows it is given (the stand-in is used where the wire matters). */
function stub(rows: SettlementRow[] | (() => SettlementRow[])): Payments & { reads: number } {
  const p = { reads: 0, readSettlements: async () => { p.reads++; return typeof rows === "function" ? rows() : rows; } };
  return p as unknown as Payments & { reads: number };
}
const row = (over: Partial<SettlementRow>): SettlementRow => ({
  entityId: "pay_1", type: "payment", paymentId: null, amount: 10_000, fee: 200, tax: 36, debit: 0, credit: 9_764, onHold: false, settled: true, settlementId: "setl_1", utr: "UTR1", settledAt: Math.floor(at(11, 12, 9) / 1000), ...over,
});

// ---- the read: the recon through the stand-in -----------------------------------------------------------------------------------------

/** A fake payments service with three payments on 10 Nov and a refund of part of the second, served as Razorpay serves it. */
async function standinKit(options: Parameters<typeof razorpayStandin>[1] = {}) {
  const clock = fakeClock(at(11, 10, 11));
  const fake = createFakePayments(clock);
  const served = await serveHandlers([razorpayStandin(fake, options)]);
  const payments = createRazorpayPayments({ baseUrl: served.url, timeoutMs: 3_000 });
  const ids: string[] = [];
  for (const [n, amount] of [[1, 10_000], [2, 25_050], [3, 99_999]] as const) {
    const link = await fake.createRequest({ amount, reference_id: `b-${n}`, description: "Deposit" });
    ids.push(fake.customerPays(link.id).id);
  }
  const refund = await fake.refund(ids[1], { amount: 5_000, receipt: "r1" });
  return { clock, fake, payments, ids, refund, close: () => served.close() };
}

test("capabilities: Razorpay reads settlements, UPI does not", () => {
  assert.equal(capabilitiesOf({ module: "razorpay" }).readsSettlements, true);
  assert.equal(capabilitiesOf({ module: "upi", upi: { id: "shop@okicici", payee: "Shop" } }).readsSettlements, false);
});

test("the recon read: every page of the day, a refund as a debit row, rows of other days left out", async () => {
  const k = await standinKit();
  try {
    const rows = await k.payments.readSettlements!(DAY, { pageSize: 2 }); // 4 rows over 2 pages
    assert.equal(rows.length, 4);
    const [p1, p2, p3] = rows.filter((r) => r.type === "payment");
    assert.deepEqual([p1.entityId, p1.amount, p1.fee, p1.tax, p1.credit, p1.debit], [k.ids[0], 10_000, 200, 36, 9_764, 0]); // 2% fee, 18% GST on it, whole paise
    assert.deepEqual([p2.amount, p2.fee, p2.tax, p2.credit], [25_050, 501, 90, 24_459]);
    assert.deepEqual([p3.amount, p3.fee, p3.tax, p3.credit], [99_999, 2_000, 360, 97_639]); // 1999.98 and 359.99 rounded as integers
    const refund = rows.find((r) => r.type === "refund")!;
    assert.deepEqual([refund.entityId, refund.paymentId, refund.amount, refund.debit, refund.credit, refund.fee, refund.tax], [k.refund.id, k.ids[1], 5_000, 5_000, 0, 0, 0]);
    assert.ok(rows.every((r) => r.settled && !r.onHold && r.settlementId === "setl_20261112" && r.utr === "UTR20261112"));
    assert.deepEqual(await k.payments.readSettlements!({ year: 2026, month: 11, day: 11 }), [], "nothing settles the day before");
    assert.equal((await k.payments.readSettlements!(DAY)).length, 4, "the default page holds them all");
  } finally { await k.close(); }
});

test("the recon read: a held row has on_hold and no payout; the stand-in can serve the fee with its GST in it", async () => {
  const k0 = await standinKit();
  const heldId = k0.ids[2];
  await k0.close();
  const k = await standinKit({ hold: new Set([heldId]), feeIncludesTax: true });
  try {
    const rows = await k.payments.readSettlements!(DAY);
    const held = rows.find((r) => r.entityId === k.ids[2])!;
    assert.deepEqual([held.onHold, held.settled, held.utr, held.settledAt], [true, false, null, null]);
    const first = rows.find((r) => r.entityId === k.ids[0])!;
    assert.deepEqual([first.fee, first.tax, first.credit], [236, 36, 9_764], "fee 200 plus 36 of GST shown as one figure");
  } finally { await k.close(); }
});

// ---- the fee, checked both ways -----------------------------------------------------------------------------------------------

test("the fee check: without GST, with GST, neither, and the figures a row cannot have", () => {
  const base = { type: "payment" as const, amount: 10_000, debit: 0 };
  assert.deepEqual(checkSettlementRow({ ...base, fee: 200, tax: 36, credit: 9_764 }), { ok: true, basis: "without_gst", feePaise: 200, gstPaise: 36 });
  assert.deepEqual(checkSettlementRow({ ...base, fee: 236, tax: 36, credit: 9_764 }), { ok: true, basis: "with_gst", feePaise: 200, gstPaise: 36 });
  assert.deepEqual(checkSettlementRow({ ...base, fee: 0, tax: 0, credit: 10_000 }), { ok: true, basis: "without_gst", feePaise: 0, gstPaise: 0 });
  const neither = checkSettlementRow({ ...base, fee: 200, tax: 36, credit: 9_700 });
  assert.equal(neither.ok, false);
  assert.equal(checkSettlementRow({ ...base, fee: 10, tax: 36, credit: 9_990 }).ok, false, "a fee smaller than its own GST cannot hold it");
  assert.equal(checkSettlementRow({ ...base, fee: 200, tax: 36, credit: 9_764, debit: 5 }).ok, false, "a payment row has no debit");
  assert.equal(checkSettlementRow({ ...base, fee: 200.5, tax: 36, credit: 9_763.5 }).ok, false, "paise are whole");
  assert.equal(checkSettlementRow({ type: "refund", amount: 5_000, debit: 5_000, credit: 0, fee: 0, tax: 0 }).ok, true);
  assert.equal(checkSettlementRow({ type: "refund", amount: 5_000, debit: 4_000, credit: 0, fee: 0, tax: 0 }).ok, false);
});

// ---- the job: post, once, list, read once a day -----------------------------------------------------------------------------------

/** The shop took pay_1 (10,000) and pay_2 (25,050, 5,000 of it given back) through the agent; pay_x was never taken by it. */
function booked(): Shop {
  const w = shop();
  w.received("b-1", "pay_1", 10_000);
  w.received("b-2", "pay_2", 25_050);
  w.post({ kind: "refund_owed", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 5_000 }, "refund");
  w.post({ kind: "refund_made", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", refundId: "rfd_2", amountPaise: 5_000, method: "gateway", evidence: "provider" }, "refund");
  return w;
}
const rows12 = (): SettlementRow[] => [
  row({}),
  row({ entityId: "pay_2", amount: 25_050, fee: 501, tax: 90, credit: 24_459 }),
  row({ entityId: "rfd_2", type: "refund", paymentId: "pay_2", amount: 5_000, debit: 5_000, credit: 0, fee: 0, tax: 0 }),
];

test("a settled payment and a refund are posted: the bank, the charge and its GST out of the gateway, once", async () => {
  const w = booked();
  const r = await job(w, stub(rows12));
  assert.deepEqual([r.status, r.day, r.posted, r.listed], ["read", "2026-11-12", 3, 0]);
  const bal = (account: string) => w.acc.journal().lines.filter((l) => l.account === account).reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);
  assert.equal(bal("bank_settled"), 9_764 + 24_459 - 5_000);
  assert.equal(bal("gateway_fees"), 200 + 501);
  assert.equal(bal("gst_on_fees"), 36 + 90);
  assert.equal(bal("gateway"), 0, "everything the gateway held was settled");
  assert.deepEqual(w.acc.journal().problems, []);
  // the record says which way each fee was read, and no customer is in it
  const settled = w.record.entries().filter((e) => e.refs.money === "settled");
  assert.deepEqual(settled.map((e) => e.refs.feeBasis), ["without_gst", "without_gst", "without_gst"]);
  assert.equal(JSON.stringify(w.record.entries().map((e) => e.refs)).includes("9800000001"), false);
});

test("a row is posted once: the same settlement posted again changes nothing", async () => {
  const w = booked();
  await job(w, stub(rows12));
  const before = w.record.entries().length;
  const again = w.acc.post({ kind: "settled", case: "b-1", settlementId: "setl_1", utr: "UTR1", entityId: "pay_1", rowType: "payment", paymentId: "pay_1", amountPaise: 10_000, feePaise: 200, taxPaise: 36, creditPaise: 9_764, debitPaise: 0 }, () => 0);
  assert.equal(again.posted, false);
  assert.equal(w.record.entries().length, before, "the template's own write is called with no money fields; nothing here wrote a line");
  assert.equal(w.acc.journal().lines.filter((l) => l.account === "bank_settled").length, 3);
});

test("the fee with its GST in it is read and recorded as with_gst", async () => {
  const w = booked();
  await job(w, stub([row({ fee: 236 })]));
  const e = w.record.entries().find((x) => x.refs.money === "settled")!;
  assert.equal(e.refs.feeBasis, "with_gst");
  const lines = w.acc.journal().lines.filter((l) => l.seq === e.seq).map((l) => [l.account, l.debitPaise, l.creditPaise]);
  assert.deepEqual(lines, [["bank_settled", 9_764, 0], ["gateway_fees", 200, 0], ["gst_on_fees", 36, 0], ["gateway", 0, 10_000]]);
});

test("a row that fits neither way, a held row and an adjustment are listed and never posted; a payment the books do not know is listed too", async () => {
  const w = booked();
  const r = await job(w, stub([
    row({ credit: 9_000 }), // fits neither
    row({ entityId: "pay_2", amount: 25_050, fee: 501, tax: 90, credit: 0, onHold: true, settled: false, utr: null }),
    row({ entityId: "adj_1", type: "adjustment", amount: 300, debit: 300, credit: 0, fee: 0, tax: 0 }),
    row({ entityId: "pay_x", amount: 50_000, fee: 1_000, tax: 180, credit: 48_820 }), // not through the assistant
  ]));
  assert.deepEqual([r.posted, r.listed], [0, 4]);
  assert.equal(w.acc.journal().lines.some((l) => l.kind === "settled"), false, "nothing was posted");
  const listed = w.record.entries().filter((e) => e.action === SETTLEMENT_ACTIONS.listed);
  assert.deepEqual(listed.map((e) => [e.refs.why, e.refs.entity]), [["problem", "pay_1"], ["held", "pay_2"], ["adjustment", "adj_1"], ["unknown_payment", "pay_x"]]);
  assert.match(listed[0].notes, /neither/u);
  assert.deepEqual(w.acc.journal().problems, [], "the listed rows are not journal problems: they never became lines");
});

test("the daily job reads a day once; a failed read writes nothing and is tried again on the next tick", async () => {
  const w = booked();
  let fail = true;
  const p = stub(() => { if (fail) throw new Error("Razorpay answered 502."); return rows12(); });
  const first = await job(w, p);
  assert.deepEqual([first.status, first.error], ["failed", "Razorpay answered 502."]);
  assert.equal(w.record.entries().some((e) => e.action === SETTLEMENT_ACTIONS.read), false, "a failed read leaves no mark: nothing is guessed");
  fail = false;
  assert.equal((await job(w, p)).status, "read");
  const lines = w.record.entries().length;
  assert.equal((await job(w, p)).status, "already_read");
  assert.equal(p.reads, 2, "two reads in all: the failure and the success, never a third");
  assert.equal(w.record.entries().length, lines);
  // the next day is a new read
  assert.equal((await job(w, p, NOW + 86_400_000)).status, "read");
  assert.equal(p.reads, 3);
  assert.deepEqual(yesterdayOf(at(11, 1, 0), TZ), { year: 2026, month: 10, day: 31 }, "yesterday is cut in the shop's time zone, across a month end");
});

test("a day missed is read when the agent next runs (oldest first, at most a week); a row of a kind Razorpay's documents do not list is \"other\", not a failed read", async () => {
  const w = booked();
  const days: number[] = [];
  const p = { readSettlements: async (d: { day: number }) => { days.push(d.day); return d.day === 12 ? rows12() : []; } } as unknown as Payments;
  assert.equal((await job(w, p)).status, "read"); // 12 Nov, the first ever: only yesterday
  assert.deepEqual(days, [12]);
  const r = await job(w, p, at(11, 16, 10)); // the agent was off: 13, 14 and 15 Nov are unread
  assert.deepEqual([r.status, days.slice(1)], ["read", [13, 14, 15]]);
  const far = await job(w, p, at(12, 30, 10)); // a month later: the last week only
  assert.equal(far.status, "read");
  assert.equal(days.length - 4, 7);
  assert.deepEqual(toSettlementRow({ entity_id: "x_1", type: "something_new", amount: 5 }).type, "other");
  const listed = await job(shop(), stub([row({ entityId: "x_1", type: "other" as never })]));
  assert.deepEqual([listed.posted, listed.listed], [0, 1]);
});

test("a read line with no day does not hide the last day read (sort() put undefined last, so the days since were taken as never read)", async () => {
  const w = booked();
  const days: number[] = [];
  const p = { readSettlements: async (d: { day: number }) => { days.push(d.day); return []; } } as unknown as Payments;
  await job(w, p); // 12 Nov
  w.record.append({ conversation: PHONE, booking: null, action: SETTLEMENT_ACTIONS.read, inputs: {}, outcome: "confirmed", language: "en", refs: {} });
  await job(w, p, at(11, 16, 10));
  assert.deepEqual(days, [12, 13, 14, 15]);
});

test("a settled row whose post throws after its line is written is not listed as a problem as well (the line itself is the journal's problem); one that throws before is", async () => {
  const w = booked();
  const real = w.acc;
  const throwsAfter = { journal: () => real.journal(), post: (e: MoneyEvent, write: (refs: Record<string, string>) => unknown) => { write({ money: "settled" }); throw new Error("The settled line cannot be read as money."); } };
  const after = await readSettlementsOnce({ payments: stub([row({})]), accounting: throwsAfter, record: w.record, conversation: PHONE, language: "en", nowMs: NOW, timeZone: TZ });
  assert.deepEqual([after.posted, after.listed], [0, 0]);
  assert.equal(w.record.entries().filter((e) => e.action === SETTLEMENT_ACTIONS.row).length, 1);
  assert.equal(w.record.entries().some((e) => e.action === SETTLEMENT_ACTIONS.listed), false);
  const v = shop();
  v.received("b-1", "pay_1", 10_000);
  const throwsBefore = { journal: () => v.acc.journal(), post: () => { throw new Error("A settlement row of pay_1 cannot be posted."); } };
  const before = await readSettlementsOnce({ payments: stub([row({})]), accounting: throwsBefore, record: v.record, conversation: PHONE, language: "en", nowMs: NOW, timeZone: TZ });
  assert.deepEqual([before.posted, before.listed], [0, 1]);
});

test("the job through the stand-in's wire: payments, a refund and a held row of one real-shaped day", async () => {
  const k = await standinKit({ hold: new Set<string>() });
  try {
    const w = shop(at(11, 10, 11));
    // the books know the first two payments (and the refund of the second); the third never went through the assistant
    w.received("b-1", k.ids[0], 10_000);
    w.received("b-2", k.ids[1], 25_050);
    w.post({ kind: "refund_owed", case: "b-2", owed: `b-2:${k.ids[1]}`, paymentId: k.ids[1], amountPaise: 5_000 }, "refund");
    w.post({ kind: "refund_made", case: "b-2", owed: `b-2:${k.ids[1]}`, paymentId: k.ids[1], refundId: k.refund.id, amountPaise: 5_000, method: "gateway", evidence: "provider" }, "refund");
    const r = await job(w, k.payments);
    assert.deepEqual([r.status, r.posted, r.listed], ["read", 3, 1]);
    assert.equal(w.record.entries().find((e) => e.action === SETTLEMENT_ACTIONS.listed)!.refs.why, "unknown_payment");
    assert.equal(w.acc.journal().lines.filter((l) => l.account === "gateway").reduce((n, l) => n + l.debitPaise - l.creditPaise, 0), 0);
  } finally { await k.close(); }
});

// ---- the owner's not-matched words ---------------------------------------------------------------------------------------------

test("not matched: a payment with no payout after more than 4 working days, a held row, and a payout for a payment not through the assistant", async () => {
  const w = booked();
  w.received("b-3", "pay_3", 7_000); // 10 Nov (Tue) like the others
  await job(w, stub([
    row({}), // pay_1 settled
    row({ entityId: "pay_2", amount: 25_050, fee: 501, tax: 90, credit: 0, onHold: true, settled: false, utr: null }),
    row({ entityId: "pay_x", amount: 50_000, fee: 1_000, tax: 180, credit: 48_820 }),
  ]));
  const view = (nowMs: number) => ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: [], nowMs, timeZone: TZ });
  // Tue 10 Nov + 4 working days = Mon 16 Nov (Wed, Thu, Fri, Mon); it is "after 4 working days" from Tue 17 Nov
  assert.deepEqual(view(at(11, 16, 12)).notMatched.filter((n) => n.kind === "gateway"), [], "four working days have not yet passed");
  const v = view(at(11, 17, 12));
  assert.deepEqual(v.notMatched.filter((n) => n.kind === "gateway").map((n) => n.kind === "gateway" && [n.case, n.paise]).sort(), [["b-3", 7_000]], "pay_1 settled and is not listed, and pay_2 is held so it is listed as held, not twice");
  assert.deepEqual(v.notMatched.filter((n) => n.kind === "gateway_held"), [{ kind: "gateway_held", case: "b-2", paise: 25_050 }]);
  assert.deepEqual(v.notMatched.filter((n) => n.kind === "not_through_assistant"), [{ kind: "not_through_assistant", paise: 50_000 }]);
  // the words, in every language: plain, no accounting word, none the claims check bans, no phone number or name, and no provider named
  for (const language of LANGUAGES) {
    // no download links: their file names (journal-<period>.csv) are not words the owner reads; the links are tested in accounting-front.test.ts
    const text = ownerMoneySection(v, language, undefined, TZ).toString();
    assert.deepEqual(bannedIn(text, language), [], `${language}: banned words`);
    for (const word of [/\bdebit/i, /\bcredit/i, /\bledger/i, /\breceivable/i, /\bjournal/i, /\bsettle/i, /razorpay/i]) assert.equal(word.test(text), false, `${language}: ${word}`);
    assert.equal(text.includes("9800000001") || text.includes("Asha"), false);
  }
  const en = ownerMoneySection(v, "en", { thisMonth: "/m", lastMonth: "/l", year: "/y" }, TZ, at(11, 17, 12)).toString();
  assert.match(en, /paid through the payment service on Tue 10 Nov[^.]*not yet in your bank/u);
  assert.match(en, /being held by the payment service/u);
  assert.match(en, /a payment not through your assistant/u);
  // once the held payment is paid out, it is no longer held
  await job(w, stub([row({ entityId: "pay_2", amount: 25_050, fee: 501, tax: 90, credit: 24_459, settlementId: "setl_2" })]), NOW + 86_400_000);
  assert.deepEqual(view(at(11, 17, 12)).notMatched.filter((n) => n.kind === "gateway_held"), []);
});

// ---- the accountant's files ----------------------------------------------------------------------------------------------------

const csvRows = (text: string): string[][] => text.split("\r\n").filter((l) => l !== "").map((l) => l.split(","));

test("settlements-<period>.csv: one row per settlement with gross, fee without GST, GST, refunds, adjustments and net; absent for a shop with none", async () => {
  const w = booked();
  await job(w, stub(() => [...rows12(), row({ entityId: "adj_1", type: "adjustment", amount: 300, debit: 300, credit: 0, fee: 0, tax: 0 }), row({ entityId: "pay_x", amount: 50_000, fee: 1_000, tax: 180, credit: 48_820 })]));
  const files = accountantFiles({ journal: w.acc.journal(), entries: w.record.entries(), period: "2026-11", timeZone: TZ });
  const rows = csvRows(files.find((f) => f.name === "settlements-2026-11.csv")!.content);
  assert.deepEqual(rows[0], ["settlement_id", "utr", "settled_on", "gross", "fee_without_gst", "gst_on_fee", "refunds", "adjustments", "net", "rows_left_out"]);
  // 10,000 + 25,050 gross; fee 701 and GST 126; 5,000 given back; 3.00 taken off; net 9,764 + 24,459 - 5,000 - 300; one row (a payment not through the assistant) left out
  assert.deepEqual(rows.slice(1), [["setl_1", "UTR1", "2026-11-12", "350.50", "7.01", "1.26", "50.00", "3.00", "289.23", "1"]]);
  assert.equal(rows.length, 2);
  assert.equal(accountantFiles({ journal: w.acc.journal(), entries: w.record.entries(), period: "2026-10", timeZone: TZ }).find((f) => f.name === "settlements-2026-10.csv")!.content.split("\r\n").length, 2, "a month with none has the header only");
  assert.match(files.find((f) => f.name === "README.txt")!.content, /settlements-2026-11\.csv/u);
  const none = shop();
  none.received("b-1", "pay_1", 100);
  assert.equal(accountantFiles({ journal: none.acc.journal(), entries: none.record.entries(), period: "2026-11", timeZone: TZ }).some((f) => f.name.startsWith("settlements-")), false);
});

// ---- the Tally XML -----------------------------------------------------------------------------------------------------------

/** A small strict XML reader: one root, the declaration first, tags nested and closed, attributes quoted, and only the five entities in text and values. */
function parseXml(text: string): { name: string; attrs: Record<string, string>; kids: unknown[]; text: string } {
  assert.ok(text.startsWith("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"), "the declaration comes first");
  const body = text.slice(text.indexOf("?>") + 3);
  type Node = { name: string; attrs: Record<string, string>; kids: Node[]; text: string };
  const unescape = (s: string): string => { assert.equal(/&(?!(amp|lt|gt|quot|apos);)/u.test(s), false, `a bare "&" in ${s}`); assert.equal(/[<>]/u.test(s), false, `a raw angle bracket in ${s}`); return s.replace(/&quot;/gu, "\"").replace(/&apos;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&"); };
  const root: Node = { name: "#root", attrs: {}, kids: [], text: "" };
  const stack: Node[] = [root];
  const token = /<(\/?)([A-Za-z][A-Za-z0-9._:-]*)((?:\s+[A-Za-z:]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gu;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = token.exec(body))) {
    assert.equal(m.index, last, `text the reader cannot read at ${last}`);
    last = token.lastIndex;
    if (m[5] !== undefined) { if (m[5].trim() !== "") stack.at(-1)!.text += unescape(m[5]); continue; }
    if (m[1]) { const open = stack.pop()!; assert.equal(open.name, m[2], `</${m[2]}> closes <${open.name}>`); continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([A-Za-z:]+)="([^"]*)"/gu)) attrs[a[1]] = unescape(a[2]);
    const node: Node = { name: m[2], attrs, kids: [], text: "" };
    stack.at(-1)!.kids.push(node);
    if (!m[4]) stack.push(node);
  }
  assert.equal(last, body.length);
  assert.equal(stack.length, 1, "every tag is closed");
  assert.equal(root.kids.length, 1, "one root");
  return root.kids[0] as Node;
}
type XNode = ReturnType<typeof parseXml> & { kids: XNode[] };
const find = (n: XNode, name: string): XNode[] => [...(n.name === name ? [n] : []), ...n.kids.flatMap((k) => find(k, name))];

/** A shop with a receipt, a refund, a bill, a settlement and the planted special characters. */
async function tallyShop() {
  const w = booked();
  w.post({ kind: "fee_charged", case: "f-1", amountPaise: 140_000 }, "open_fee");
  await job(w, stub(rows12));
  return w;
}
const files = (w: Shop, tally: { company?: string; ledgerNames?: Record<string, string> }) => accountantFiles({ journal: w.acc.journal(), entries: w.record.entries(), period: "2026-11", timeZone: TZ, tally });

test("Tally XML: well formed, masters then vouchers, every voucher sums to zero, debits negative", async () => {
  const w = await tallyShop();
  const out = files(w, { company: "Glow Salon" });
  const masters = parseXml(out.find((f) => f.name === "tally-masters.xml")!.content) as XNode;
  const vouchers = parseXml(out.find((f) => f.name === "tally-vouchers.xml")!.content) as XNode;
  assert.deepEqual([masters.name, find(masters, "REPORTNAME")[0].text, find(vouchers, "REPORTNAME")[0].text], ["ENVELOPE", "All Masters", "Vouchers"]);
  assert.equal(find(vouchers, "SVCURRENTCOMPANY")[0].text, "Glow Salon");
  // the ledgers: each under a group TallyPrime has by default, and every ledger a voucher uses is in the masters
  const GROUPS = ["Cash-in-Hand", "Bank Accounts", "Sundry Debtors", "Current Liabilities", "Sales Accounts", "Indirect Expenses", "Duties & Taxes"];
  const parent = new Map(find(masters, "LEDGER").map((l) => [l.attrs.NAME, find(l, "PARENT")[0].text]));
  assert.ok([...parent.values()].every((g) => GROUPS.includes(g)));
  assert.equal(parent.get("Bank (gateway settlements)"), "Bank Accounts");
  assert.equal(parent.get("Payment gateway charges"), "Indirect Expenses");
  assert.equal(parent.get("Customer advances and deposits"), "Current Liabilities");
  const list = find(vouchers, "VOUCHER");
  assert.ok(list.length >= 8);
  for (const v of list) {
    const entries = find(v, "ALLLEDGERENTRIES.LIST");
    let sum = 0;
    for (const e of entries) {
      const amount = find(e, "AMOUNT")[0].text;
      assert.match(amount, /^-?\d+\.\d{2}$/u);
      const paise = Math.round(Number(amount) * 100);
      const debit = find(e, "ISDEEMEDPOSITIVE")[0].text === "Yes";
      assert.equal(paise < 0, debit, "a debit is Yes with a negative amount, a credit No with a positive one");
      assert.ok(parent.has(find(e, "LEDGERNAME")[0].text), "the ledger is in the masters");
      sum += paise;
    }
    assert.equal(sum, 0, `${find(v, "VOUCHERNUMBER")[0].text} sums to zero`);
    assert.match(find(v, "DATE")[0].text, /^20261[01]\d\d$/u);
    assert.ok(["Receipt", "Payment", "Journal"].includes(v.attrs.VCHTYPE));
    assert.equal(find(v, "VOUCHERTYPENAME")[0].text, v.attrs.VCHTYPE);
  }
  assert.deepEqual([...new Set(list.map((v) => v.attrs.VCHTYPE))].sort(), ["Journal", "Payment", "Receipt"]);
  // the type follows the bank ledger: money into the bank is a Receipt, out of it a Payment, and no bank or cash ledger a Journal (Tally keeps those out of a Journal)
  for (const v of list) {
    const sides = find(v, "ALLLEDGERENTRIES.LIST").filter((e) => parent.get(find(e, "LEDGERNAME")[0].text) === "Bank Accounts" || parent.get(find(e, "LEDGERNAME")[0].text) === "Cash-in-Hand").map((e) => find(e, "ISDEEMEDPOSITIVE")[0].text);
    assert.equal(v.attrs.VCHTYPE, sides.length === 0 ? "Journal" : sides[0] === "Yes" ? "Receipt" : "Payment");
  }
  const byNumber = new Map(list.map((v) => [find(v, "VOUCHERNUMBER")[0].text, v]));
  const receipt = [...byNumber].find(([n]) => n.startsWith("RCT/"))!;
  assert.equal(find(receipt[1], "NARRATION")[0].text.includes("pay_1") || find(receipt[1], "NARRATION")[0].text.includes("pay_2"), true, "the narration carries the payment id");
  const settled = list.filter((v) => find(v, "NARRATION")[0].text.includes("UTR UTR1"));
  assert.equal(settled.length, 3, "a settlement row's narration carries the bank reference");
  assert.ok([...byNumber.keys()].some((n) => /^J-\d+$/u.test(n)), "a line with no document is J-<seq>");
  const readme = out.find((f) => f.name === "README.txt")!.content;
  assert.match(readme, /Importing into TallyPrime \(best effort/u);
  assert.match(readme, /Back up/u);
  assert.match(readme, /Masters/u);
  assert.match(readme, /once only/u);
  assert.match(readme, /exactly "Glow Salon"/u);
});

test("Tally XML: ledger names are configurable and special characters are escaped; no phone number or name is in any file", async () => {
  const w = await tallyShop();
  const out = files(w, { company: "Glow & Co <Salon> \"One\"", ledgerNames: { gateway: "Razorpay Clearing <R&D> 'x'", bank_settled: "HDFC \"Current\" A/c" } });
  const mastersText = out.find((f) => f.name === "tally-masters.xml")!.content;
  assert.ok(mastersText.includes("Razorpay Clearing &lt;R&amp;D&gt; &apos;x&apos;"));
  assert.ok(mastersText.includes("HDFC &quot;Current&quot; A/c"));
  assert.ok(mastersText.includes("Glow &amp; Co &lt;Salon&gt; &quot;One&quot;"));
  const masters = parseXml(mastersText) as XNode;
  assert.ok(find(masters, "LEDGER").some((l) => l.attrs.NAME === "Razorpay Clearing <R&D> 'x'"), "read back, the name is exactly as given");
  parseXml(out.find((f) => f.name === "tally-vouchers.xml")!.content);
  for (const f of out) for (const bad of ["9800000001", "Asha", "Menon", NAME]) assert.equal(f.content.includes(bad), false, `${f.name} has ${bad}`);
  assert.equal(xml("a\u0000b\u0008c&d"), "a b c&amp;d", "what XML cannot carry is replaced, never written");
  // no company named: the file names none and goes into the open one
  assert.equal(files(w, {}).find((f) => f.name === "tally-vouchers.xml")!.content.includes("SVCURRENTCOMPANY"), false);
  // not asked for: no Tally files
  assert.equal(accountantFiles({ journal: w.acc.journal(), entries: w.record.entries(), period: "2026-11", timeZone: TZ }).some((f) => f.name.startsWith("tally-")), false);
});

test("Tally XML: a voucher that does not sum to zero is refused, and the export then leaves the Tally files out and says why", async () => {
  const w = await tallyShop();
  const lines: Line[] = [
    { seq: 1, at: new Date(NOW).toISOString(), case: "b-1", account: "bank", debitPaise: 1_000, creditPaise: 0, kind: "received" },
    { seq: 1, at: new Date(NOW).toISOString(), case: "b-1", account: "advances", debitPaise: 0, creditPaise: 999, kind: "received" },
  ];
  assert.throws(() => tallyFiles({ lines, entries: [], timeZone: TZ }), /does not add up \(1 paise\)/u);
  // two accounts given one name but different groups are refused too (Tally would keep only one)
  assert.throws(() => tallyFiles({ lines: w.acc.journal().lines, entries: w.record.entries(), timeZone: TZ, ledgerNames: { gateway: "Same", advances: "Same" } }), /two groups/u);
  const out = files(w, { ledgerNames: { gateway: "Same", advances: "Same" } });
  assert.equal(out.some((f) => f.name.startsWith("tally-")), false);
  assert.match(out.find((f) => f.name === "README.txt")!.content, /The Tally files could not be made this time/u);
  assert.ok(out.some((f) => f.name === "journal-2026-11.csv"), "the CSV files are still complete");
});

// ---- the three parts together: settlements, the report's books summary and its open check, the books check ------------------------------------------

test("a record with settled rows passes the open check and the books check, and the report's received and refunds are as they were before the rows", async () => {
  const w = booked();
  const legacy = { received: [] };
  const FROM = new Date(at(11, 1, 0)).toISOString();
  const TO = new Date(at(12, 1, 0)).toISOString();
  const before = figuresOf(w.acc.journal(), w.record.entries(), legacy, FROM, TO);
  await job(w, stub(rows12()));
  const entries = w.record.entries();
  assert.ok(entries.filter((e) => e.refs.money === "settled").length >= 2, "the rows were posted");
  assert.deepEqual(booksFaults(entries, legacy, { privateText: [NAME] }), [], "the books hold, and no name or number is in any refs");
  const after = figuresOf(w.acc.journal(), entries, legacy, FROM, TO);
  assert.deepEqual([after.received, after.refunds], [before.received, before.refunds], "a payout moves money between accounts; it is not a payment or a refund");
  const report = JSON.parse(JSON.stringify({ document: { period: { from: FROM, to: TO }, accounting: reportAccounting(entries, legacy, FROM, TO), anchor: headOf(entries, "glow-salon") } }));
  assert.ok(report.document.accounting.summary.byKind.some((k: { kind: string }) => k.kind === "settled"), "the summary carries the settled rows");
  const checked = checkAccounting(packOf(entries, "glow-salon"), report);
  assert.equal(checked.ok, true, checked.lines.filter((l) => !l.ok).map((l) => l.text).join("; "));
});

