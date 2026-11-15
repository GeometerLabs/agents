// The owner's Money section: every figure of the view model on a real record (modules/record/record.ts, posted through the core's post), the owed and not-matched
// lists, and the page in four languages through the claims check (report/claims.ts), the accounting-word check, and a privacy check (no phone number, no planted
// name). The record is built the way test/accounting.test.ts builds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { zonedToMs } from "../../core/time.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { createRecord } from "../../record/record.ts";
import type { ActionRecord, Outcome } from "../../record/record.ts";
import { bannedIn } from "../../report/claims.ts";
import type { LegacyMap } from "../journal.ts";
import { createAccounting } from "../post.ts";
import type { MoneyEvent } from "../post.ts";
import { ownerMoney } from "../owner-money.ts";
import { inr, ownerMoneySection } from "../owner-money-render.ts";
import { OWNER_MONEY_WORDS } from "../words-owner.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, year = 2026) => zonedToMs({ year, month, day }, { hour, minute: 0 }, TZ);
const NOW = at(11, 15, 18);
const PHONE = "+919800000001";
const LEGACY: LegacyMap = {
  received: [{ action: "record_deposit", outcome: "confirmed", for: "advance" }, { action: "record_payment", outcome: "confirmed", for: "fee" }],
  feeCharged: "open_fee",
};

function world() {
  const clock = fakeClock(at(10, 20, 11));
  const record = createRecord(clock);
  const acc = createAccounting({ record, shop: { timezone: TZ }, legacy: LEGACY, clock });
  const line = (r: ActionRecord, c: string | null, action: string, outcome: Outcome, refs: Record<string, string> = {}) =>
    r.append({ conversation: PHONE, booking: c, action, inputs: {}, outcome, language: "en", refs });
  const post = (event: MoneyEvent, action: string, outcome: Outcome = "confirmed", own: Record<string, string> = {}) =>
    acc.post(event, (refs) => line(record, "case" in event ? event.case : null, action, outcome, { ...own, ...refs }));
  return { clock, record, acc, post, line: (c: string | null, a: string, o: Outcome, refs?: Record<string, string>) => line(record, c, a, o, refs) };
}

const gw = (c: string, id: string, amountPaise: number): MoneyEvent => ({ kind: "received", case: c, paymentId: id, amountPaise, method: "gateway", evidence: "provider", for: "advance" });

/** A shop's October and November, with every kind of line the view reads. */
function build() {
  const w = world();
  w.post(gw("b-7", "pay_7", 9_999), "record_deposit"); // 20 Oct: last month, not in this month's figures
  w.clock.set(at(11, 3, 10));
  w.post(gw("b-1", "pay_1", 20_000), "record_deposit");
  w.post(gw("b-2", "pay_2", 30_000), "record_deposit");
  w.post({ kind: "refund_owed", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 30_000 }, "refund", "attempted");
  w.post({ kind: "refund_made", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", refundId: "rfd_2", amountPaise: 30_000, method: "gateway", evidence: "provider" }, "refund");
  w.post({ kind: "received", case: "b-3", paymentId: "up_3", amountPaise: 5_000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  w.post({ kind: "refund_owed", case: "b-3", owed: "upr-1", paymentId: "up_3", amountPaise: 5_000 }, "upi_refund_owed", "held_for_owner");
  w.post(gw("b-4", "pay_4", 10_000), "record_deposit");
  w.post({ kind: "refund_owed", case: "b-4", owed: "b-4:pay_4", paymentId: "pay_4", amountPaise: 10_000 }, "refund", "attempted");
  w.post(gw("b-5", "pay_5", 7_050), "record_deposit");
  w.post({ kind: "kept", case: "b-5", amountPaise: 7_050, why: "late_cancellation" }, "late_cancel");
  w.post(gw("b-6", "pay_6", 4_000), "record_deposit");
  w.post({ kind: "refund_owed", case: "b-6", owed: "b-6:pay_6", paymentId: "pay_6", amountPaise: 4_000 }, "refund", "attempted");
  w.post({ kind: "refund_made", case: "b-6", owed: "b-6:pay_6", paymentId: "pay_6", amountPaise: 4_000, method: "gateway", evidence: "person_word" }, "refund");
  w.clock.set(NOW);
  w.post({ kind: "received", case: "b-8", paymentId: "up_8", amountPaise: 12_345, method: "cash", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  // a customer says they paid 500 by UPI and the owner has not marked it
  w.line("b-9", "upi_request", "confirmed", { requestId: "upi-1", amountPaise: "50000" });
  w.line("b-9", "upi_paid_claim", "attempted", { requestId: "upi-1", via: "button" });
  return w;
}

const view = (w: ReturnType<typeof build>, untold = [{ case: "b-2", amountInr: 300 }]) =>
  ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: untold, nowMs: NOW, timeZone: TZ });

test("today and this month: received, given back, kept, in paise", () => {
  const v = view(build());
  assert.equal(v.period, "2026-11");
  assert.deepEqual(v.today.received, { paise: 12_345, count: 1 });
  assert.deepEqual(v.today.givenBack, { paise: 0, count: 0 });
  // November: 20000 + 30000 + 5000 + 10000 + 7050 + 4000 + 12345; the October 9999 is left out
  assert.deepEqual(v.month.received, { paise: 88_395, count: 7 });
  // only the provider's refund counts as given back; the one on a person's word is listed instead
  assert.deepEqual(v.month.givenBack, { paise: 30_000, count: 1 });
  assert.equal(v.month.keptPaise, 7_050);
  assert.equal(v.month.gatewayChargesPaise, 0);
  assert.equal(v.month.stillToCome, null);
  assert.deepEqual(v.byWord.map((b) => [b.case, b.paise]), [["b-6", 4_000]]);
});

test("a day is the shop's day: a payment at 00:30 India time is that day's, though it is the day before in UTC", () => {
  const w = world();
  w.clock.set(at(11, 15, 0) + 30 * 60_000);
  w.post(gw("b-1", "pay_1", 100), "record_deposit");
  const v = ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: [], nowMs: at(11, 15, 9), timeZone: TZ });
  assert.deepEqual(v.today.received, { paise: 100, count: 1 });
  const yesterday = ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: [], nowMs: at(11, 14, 9), timeZone: TZ });
  assert.deepEqual(yesterday.today.received, { paise: 0, count: 0 });
});

test("owed back: each refund still owed, with a plain reason; made and kept ones are gone", () => {
  const v = view(build());
  const owed = Object.fromEntries(v.owedBack.map((o) => [o.case, o]));
  assert.deepEqual(Object.keys(owed).sort(), ["b-3", "b-4"]);
  assert.deepEqual(owed["b-3"], { case: "b-3", paise: 5_000, why: "owner_pays_upi" });
  assert.deepEqual(owed["b-4"], { case: "b-4", paise: 10_000, why: "payment_service" });
});

test("not matched: a UPI claim, money still with the payment service, and a refund whose customer was not told", () => {
  // "not yet in your bank" needs a shop that reads its settlements: without a settlements_read line the page never calls gateway money unpaid on a guess
  const unread = view(build());
  assert.equal(unread.readsSettlements, false);
  assert.deepEqual(unread.notMatched.filter((n) => n.kind === "gateway"), []);
  const reads = build();
  reads.line(null, "settlements_read", "confirmed", { day: "2026-11-14", rows: "0", posted: "0", listed: "0" });
  const v = view(reads);
  assert.equal(v.readsSettlements, true);
  const claim = v.notMatched.find((n) => n.kind === "upi_claim");
  assert.deepEqual(claim, { kind: "upi_claim", case: "b-9", paise: 50_000 });
  const gateway = v.notMatched.filter((n) => n.kind === "gateway");
  // b-7 (October), b-1, b-5 and b-4 (its refund is owed, not yet paid out of the gateway); b-2 and b-6 were paid back through it
  assert.deepEqual(gateway.map((g) => [g.case, g.paise]).sort(), [["b-1", 20_000], ["b-4", 10_000], ["b-5", 7_050], ["b-7", 9_999]]);
  assert.deepEqual(v.notMatched.filter((n) => n.kind === "untold_refund"), [{ kind: "untold_refund", case: "b-2", paise: 30_000 }]);
  // a marked-paid request is not listed any more
  const w = build();
  w.post({ kind: "received", case: "b-9", paymentId: "up_9", amountPaise: 50_000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", { requestId: "upi-1" });
  assert.equal(view(w).notMatched.some((n) => n.kind === "upi_claim"), false);
});

test("Fees: still to come is the open balance and the count of open fees; a fee paid in full is not counted", () => {
  const w = world();
  w.clock.set(NOW);
  w.post({ kind: "fee_charged", case: "f-1", amountPaise: 140_000 }, "open_fee");
  w.post({ kind: "fee_charged", case: "f-2", amountPaise: 70_000 }, "open_fee");
  w.post({ kind: "fee_charged", case: "f-3", amountPaise: 70_000 }, "open_fee");
  w.post({ kind: "received", case: "f-3", paymentId: "pay_f3", amountPaise: 70_000, method: "gateway", evidence: "provider", for: "fee" }, "record_payment");
  w.post({ kind: "received", case: "f-1", paymentId: "pay_f1", amountPaise: 40_000, method: "upi", evidence: "owner_mark", for: "fee" }, "record_payment");
  const v = ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: [], nowMs: NOW, timeZone: TZ });
  assert.deepEqual(v.month.stillToCome, { paise: 100_000 + 70_000, count: 2 });
  assert.deepEqual(v.month.received, { paise: 110_000, count: 2 });
});

test("the owner's amounts are written from integer paise", () => {
  assert.equal(inr(120_000), "₹1,200");
  assert.equal(inr(12_345), "₹123.45");
  assert.equal(inr(100), "₹1");
  assert.equal(inr(1), "₹0.01");
  assert.equal(inr(123_456_789), "₹12,34,567.89");
});

const ACCOUNTING_WORDS = [/\bdebit/i, /\bcredit/i, /\bledger/i, /\breceivable/i, /\bjournal/i];

test("the section in four languages: the scope line, the sums, the links, no banned or accounting word, no phone number or planted name", () => {
  const w = build();
  const v = view(w);
  for (const language of LANGUAGES) {
    const page = ownerMoneySection(v, language, { base: "/m" }, TZ).toString();
    const text = page.replace(/<[^>]+>/gu, " ");
    assert.ok(text.includes(OWNER_MONEY_WORDS[language].scope), `${language}: the scope line`);
    assert.ok(page.includes("₹883.95"), `${language}: this month's received, from paise`);
    assert.ok(page.includes("₹123.45"), `${language}: today's received`);
    // three periods, three files each, from the month the view names (the runtime's clock); the WhatsApp link holds the words only
    for (const href of ["/m/2026-11/journal-2026-11.csv", "/m/2026-11/documents-2026-11.csv", "/m/2026-11/README.txt", "/m/2026-10/journal-2026-10.csv", "/m/26-27/documents-26-27.csv"]) assert.ok(page.includes(`href="${href}"`), `${language}: link ${href}`);
    assert.match(page, /href="https:\/\/wa\.me\/\?text=[^"]*"/u, `${language}: the share link`);
    assert.equal(/\.csv[^"]*wa\.me/u.test(page), false);
    assert.equal(/<script/i.test(page), false);
    assert.deepEqual(bannedIn(text, language), [], `${language}: banned words`);
    for (const re of ACCOUNTING_WORDS) assert.equal(re.test(text), false, `${language}: ${re}`);
    assert.equal(/\+?\d{10}/u.test(text.replace(/[\s,]/gu, "")), false, `${language}: no phone number`);
    assert.equal(text.includes("9800000001"), false);
    assert.equal(page.includes("class=\"machine\""), language !== "en", `${language}: only hi, ml and kn say they are machine-written`);
  }
});

test("a case named with markup is text, not markup", () => {
  const w = world();
  w.clock.set(at(11, 3, 10)); // paid through the payment service more than 4 working days ago, so it is listed as "not yet in your bank"
  w.post(gw("<b-1>", "pay_x", 5_000), "record_deposit");
  w.line(null, "settlements_read", "confirmed", { day: "2026-11-14", rows: "0", posted: "0", listed: "0" }); // a shop that reads its settlements
  const v = ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: [], nowMs: NOW, timeZone: TZ });
  const page = ownerMoneySection(v, "en", { base: "a" }, TZ).toString();
  assert.equal(page.includes("<b-1>"), false);
  assert.ok(page.includes("&lt;b-1&gt;"));
});

test("\"everything is matched\" only when it is known: a shop with online money that does not read its payouts is told they are not checked yet", () => {
  const w = world();
  w.clock.set(NOW);
  w.post(gw("b-1", "pay_1", 20_000), "record_deposit");
  const unread = ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: [], nowMs: NOW, timeZone: TZ });
  assert.equal(unread.payoutsUnchecked, true);
  for (const language of LANGUAGES) {
    const page = ownerMoneySection(unread, language, undefined, TZ).toString();
    assert.ok(page.includes(OWNER_MONEY_WORDS[language].payoutsUnchecked), language);
    assert.equal(page.includes(OWNER_MONEY_WORDS[language].notMatchedNone), false, `${language}: no false all-clear`);
    assert.deepEqual(bannedIn(OWNER_MONEY_WORDS[language].payoutsUnchecked, language), [], language);
  }
  w.line(null, "settlements_read", "confirmed", { day: "2026-11-14", rows: "0", posted: "0", listed: "0" });
  const reads = ownerMoney({ journal: w.acc.journal(), entries: w.record.entries(), refundsUntold: [], nowMs: NOW, timeZone: TZ });
  assert.equal(reads.payoutsUnchecked, false, "a shop that reads its settlements is checked");
  const cashOnly = world();
  cashOnly.clock.set(NOW);
  cashOnly.post({ kind: "received", case: "b-8", paymentId: "up_8", amountPaise: 12_345, method: "cash", evidence: "owner_mark", for: "advance" }, "owner_marked_paid");
  const v = ownerMoney({ journal: cashOnly.acc.journal(), entries: cashOnly.record.entries(), refundsUntold: [], nowMs: NOW, timeZone: TZ });
  assert.equal(v.payoutsUnchecked, false, "no online money: nothing to check");
  assert.ok(ownerMoneySection(v, "en", undefined, TZ).toString().includes(OWNER_MONEY_WORDS.en.notMatchedNone));
});
