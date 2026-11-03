// The monthly report's numbers. The busy month is scripted with the harness; every total is then checked against the
// stand-in services' OWN lists (payments, refunds, outbox, calendar), not only against the record the report reads.
// Small synthetic records pin the counting rules: distinct things, one place per rule, month edges, missing details.
import { test } from "node:test";
import assert from "node:assert/strict";
import { glowSalon } from "../src/harness.ts";
import { languageOfScript } from "../src/language/format.ts";
import type { Action, Outcome, RecordEntry, RuleDecision } from "../src/record.ts";
import { LANGUAGES } from "../src/settings.ts";
import { buildMonthlyReport, monthRange, policyDigest, RULE_IDS } from "../report/data.ts";
import type { MonthlyReport } from "../report/data.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import type { BusyMonth } from "../report/example-month.ts";

const settings = glowSalon();
let month: Promise<BusyMonth> | undefined;
const busy = () => (month ??= runBusyMonth());

async function reportFor(ym: string, madeAt = at(12, 5, 10)): Promise<{ report: MonthlyReport; m: BusyMonth }> {
  const m = await busy();
  const { from, to } = monthRange(ym, settings.timezone);
  return { report: buildMonthlyReport({ settings, entries: m.world.record.entries(), bookings: [...m.world.store.bookings.values()], from, to, source: "stand-in", madeAt }), m };
}

test("the busy month: bookings, owner decisions and what the limits stopped, as scripted", async () => {
  const { report } = await reportFor("2026-11");
  assert.deepEqual(report.bookings, { made: 26, cancelled: 6, moved: 2, droppedBeforeBooked: 1 });
  assert.deepEqual(report.owner, { asked: 3, approved: 1, denied: 1, retried: 1 });
  assert.deepEqual(report.stopped.byRule, {
    "price-at-or-above-list": 3, "within-hours": 2, "no-double-booking": 2, "confirm-only-when-recorded": 0, "one-deposit-per-booking": 1,
    "refund-limit": 0, "no-message-after-stop": 2, "message-matches-record": 0, "opt-out": 2,
  });
  // 12 "no"s across the rules, but 10 things stopped: a reminder after STOP is held by two rules at once
  assert.equal(report.stopped.total, 10);
  assert.equal(report.messages.heldBack, 2);
  assert.deepEqual(report.unconfirmed, {
    open: 2, openOnBookings: 1, settledLater: 1,
    rows: [
      { seq: report.unconfirmed.rows[0].seq, action: "confirm_booking", outcome: "unconfirmed", booking: "b-33", settledLater: true },
      { seq: report.unconfirmed.rows[1].seq, action: "confirm_booking", outcome: "unconfirmed", booking: "b-34", settledLater: false },
      { seq: report.unconfirmed.rows[2].seq, action: "send_message", outcome: "unconfirmed", booking: null, settledLater: false },
    ],
  });
  assert.deepEqual(report.atReportTime, { waitingForOwner: 2, paidNotBooked: 1 });
  assert.deepEqual(report.missing, { depositAmounts: 0, refundAmounts: 0, ownerCommands: 0, messageTargets: 0 });
  assert.equal(report.period.month?.month, 11);
});

test("the busy month: ₹ amounts equal what the payments service itself holds", async () => {
  const { report, m } = await reportFor("2026-11");
  const { from, to } = monthRange("2026-11", settings.timezone);
  const inMonth = (seconds: number) => seconds * 1000 >= from && seconds * 1000 < to;
  const links = m.world.payments.links();
  const payments = links.flatMap((l) => l.payments.map((p, i) => ({ ...p, second: i > 0 }))).filter((p) => inMonth(p.created_at));
  const deposits = payments.filter((p) => !p.second);
  assert.equal(payments.length, 28, "28 payments came in during November, one of them a second payment on a link");
  assert.deepEqual(report.money.deposits, { count: deposits.length, paise: deposits.reduce((n, p) => n + p.amount, 0) });
  assert.equal(report.money.deposits.paise, 27 * 200 * 100);
  const refunds = m.world.payments.refunds().filter((r) => inMonth(r.created_at));
  const depositIds = new Set(links.map((l) => l.payments[0]?.id)); // the first payment on a link is the deposit, whatever month it came in
  assert.equal(report.money.refunds.count, refunds.length);
  assert.equal(report.money.refunds.paise, refunds.reduce((n, r) => n + r.amount, 0));
  assert.deepEqual(report.money.refunds.ofDeposits, { count: refunds.filter((r) => depositIds.has(r.payment_id)).length, paise: refunds.filter((r) => depositIds.has(r.payment_id)).reduce((n, r) => n + r.amount, 0) });
  // b-1's deposit came in on 29 October and went back on 1 November: the refund is November's, the deposit is October's
  assert.ok(refunds.some((r) => links.find((l) => l.reference_id === "b-1")?.payments[0].id === r.payment_id));
  assert.equal(report.money.refunds.ofSecondPayments.paise, 20000);
});

test("the busy month: bookings agree with the calendar, and messages with the WhatsApp outbox", async () => {
  const { report, m } = await reportFor("2026-11");
  const { from, to } = monthRange("2026-11", settings.timezone);
  const sent = m.world.messaging.outbox().filter((o) => o.sentAt >= from && o.sentAt < to);
  const toOwner = sent.filter((o) => o.to === m.world.owner);
  const toCustomers = sent.filter((o) => o.to !== m.world.owner);
  assert.equal(report.messages.toOwner.total, toOwner.length);
  assert.equal(report.messages.toCustomers.total, toCustomers.length - 1, "one message left the outbox but its reply was lost, so the record has it as unconfirmed");
  for (const language of LANGUAGES) {
    const outbox = toCustomers.filter((o) => languageOfScript(o.text) === language).length;
    assert.equal(report.messages.toCustomers.byLanguage[language], outbox - (language === "en" ? 1 : 0), `customer messages in ${language}`);
    assert.equal(report.messages.toOwner.byLanguage[language], toOwner.filter((o) => languageOfScript(o.text) === language).length, `owner messages in ${language}`);
  }
  // every booking the report says was made in November is on the calendar's own list, or was cancelled or finished since
  const everConfirmed = new Set(m.world.record.entries().filter((e) => e.action === "confirm_booking" && e.outcome === "confirmed").map((e) => e.booking));
  assert.equal(everConfirmed.size, 28, "28 bookings in all: one in October, 26 in November, one in December");
  assert.equal([...everConfirmed].filter((id) => m.world.calendar.events().some((e) => e.bookingRef === id && e.status === "confirmed")).length, 28 - 6, "the calendar holds every booking that was not cancelled");
});

test("each month counts its own, and the months add up to the whole record", async () => {
  const oct = (await reportFor("2026-10")).report;
  const nov = (await reportFor("2026-11")).report;
  const dec = (await reportFor("2026-12")).report;
  assert.equal(oct.bookings.made, 1);
  assert.deepEqual(oct.money.deposits, { count: 1, paise: 20000 });
  assert.equal(oct.bookings.cancelled, 0, "b-1 was cancelled on 1 November");
  assert.equal(oct.stopped.byRule["price-at-or-above-list"], 1, "the ₹300 ask on 30 October");
  assert.equal(oct.money.refunds.count, 0);
  assert.equal(dec.bookings.made, 1);
  assert.deepEqual(dec.money.deposits, { count: 1, paise: 20000 });
  assert.equal(oct.bookings.made + nov.bookings.made + dec.bookings.made, 28);
  const m = await busy();
  const allDeposits = m.world.payments.links().flatMap((l) => l.payments).length - 1; // all payments, less the one second payment
  assert.equal(oct.money.deposits.count + nov.money.deposits.count + dec.money.deposits.count, allDeposits);
  // a deposit paid at 00:03 on 1 November was asked for at 23:50 on 31 October: the deposit and the booking are November's
  const c2 = [...m.world.store.bookings.values()].find((b) => b.id === "b-3")!;
  assert.equal(c2.state, "completed");
  assert.ok(m.world.record.entries().some((e) => e.booking === "b-3" && e.action === "hold_slot" && e.outcome === "confirmed" && Date.parse(e.time) < at(11, 1, 0)));
});

test("no customer's phone number is anywhere in the report, only booking ids", async () => {
  const { report, m } = await reportFor("2026-11");
  const json = JSON.stringify(report);
  for (const b of m.world.store.bookings.values()) assert.ok(!json.includes(b.customer), `${b.customer} is in the report`);
  assert.ok(!json.includes(m.world.owner));
  assert.ok(!json.includes("conversation"));
  assert.ok(!/\+91\d{6}/.test(json));
});

test("the report is the same every time it is made from the same record", async () => {
  const a = (await reportFor("2026-11")).report;
  const b = (await reportFor("2026-11")).report;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ---- the counting rules, on small records ------------------------------------------------------------------------

let seq = 0;
const NOV = at(11, 10, 12);
function e(action: Action, outcome: Outcome, more: { booking?: string | null; refs?: Record<string, string>; decisions?: RuleDecision[]; time?: number; language?: "hi" | "en" | "ml" | "kn" } = {}): RecordEntry {
  seq++;
  return Object.freeze({
    seq, time: new Date(more.time ?? NOV + seq * 1000).toISOString(), conversation: "+919811111111", booking: more.booking === undefined ? "b-1" : more.booking, action,
    inputsDigest: "0123456789abcdef", outcome, decisions: more.decisions ?? [], language: more.language ?? "en", notes: "", refs: more.refs ?? {},
  });
}
const block = (ruleId: RuleDecision["ruleId"]): RuleDecision => ({ ruleId, verdict: "block", reason: "x" });
const November = monthRange("2026-11", settings.timezone);
const count = (entries: RecordEntry[], window = November) => buildMonthlyReport({ settings, entries, bookings: [], ...window, source: "stand-in", madeAt: window.to });

test("a retry that confirms a booking again does not make it two bookings; a booking made in October is not November's", () => {
  seq = 0;
  const twice = count([e("confirm_booking", "confirmed"), e("confirm_booking", "confirmed")]);
  assert.equal(twice.bookings.made, 1);
  seq = 0;
  const earlier = e("confirm_booking", "confirmed", { time: at(10, 30, 12) });
  const again = e("confirm_booking", "confirmed");
  assert.equal(count([earlier, again]).bookings.made, 0, "its first confirmation was in October");
});

test("a booking that was never confirmed is dropped, not cancelled; one that was confirmed is cancelled once", () => {
  seq = 0;
  const r = count([
    e("confirm_booking", "confirmed", { booking: "b-1" }), e("cancel_booking", "confirmed", { booking: "b-1" }), e("cancel_booking", "confirmed", { booking: "b-1" }),
    e("cancel_booking", "confirmed", { booking: "b-2" }),
  ]);
  assert.deepEqual(r.bookings, { made: 1, cancelled: 1, moved: 0, droppedBeforeBooked: 1 });
});

test("a booking moved twice is one moved booking", () => {
  seq = 0;
  assert.equal(count([e("reschedule_booking", "confirmed"), e("reschedule_booking", "confirmed"), e("reschedule_booking", "blocked"), e("reschedule_booking", "attempted")]).bookings.moved, 1);
});

test("a deposit or refund is counted once by its payment or refund id, and one with no amount is counted and noted", () => {
  seq = 0;
  const r = count([
    e("record_deposit", "confirmed", { refs: { paymentId: "pay_1", amountPaise: "20000" } }),
    e("record_deposit", "confirmed", { refs: { paymentId: "pay_1", amountPaise: "20000" } }),
    e("record_deposit", "confirmed", { booking: "b-2", refs: { paymentId: "pay_2" } }),
    e("record_deposit", "blocked", { booking: "b-2", refs: { paymentId: "pay_9", amountPaise: "20000" } }),
    e("refund", "confirmed", { refs: { refundId: "r_1", paymentId: "pay_1", amountPaise: "20000" } }),
    e("refund", "confirmed", { refs: { refundId: "r_1", paymentId: "pay_1", amountPaise: "20000" } }),
    e("refund", "confirmed", { refs: { refundId: "r_2", paymentId: "pay_9", amountPaise: "5000" } }),
    e("refund", "confirmed", { refs: { refundId: "r_3", paymentId: "pay_9" } }),
    e("refund", "attempted", { refs: { paymentId: "pay_1", amountPaise: "20000" } }),
  ]);
  assert.deepEqual(r.money.deposits, { count: 2, paise: 20000 });
  assert.deepEqual(r.money.refunds, { count: 3, paise: 25000, ofDeposits: { count: 1, paise: 20000 }, ofSecondPayments: { count: 2, paise: 5000 } });
  assert.deepEqual(r.missing, { depositAmounts: 1, refundAmounts: 1, ownerCommands: 0, messageTargets: 0 });
});

test("a limit that said no is counted once, at its own entry, not again on the message that follows", () => {
  seq = 0;
  const hours = block("within-hours");
  const r = count([
    e("hold_slot", "blocked", { decisions: [hours] }),
    e("send_message", "confirmed", { decisions: [hours, block("price-at-or-above-list")], refs: { to: "customer" } }), // the same "no" shown on the reply, and a price refused
    e("reschedule_booking", "blocked", { decisions: [block("no-double-booking")] }),
    e("send_message", "blocked", { decisions: [block("opt-out"), block("no-message-after-stop")] }),
    e("refund", "held_for_owner", { decisions: [{ ruleId: "refund-limit", verdict: "hold_for_owner", reason: "x" }], refs: { paymentId: "pay_1", amountPaise: "20000" } }),
  ]);
  assert.equal(r.stopped.byRule["within-hours"], 1);
  assert.equal(r.stopped.byRule["price-at-or-above-list"], 1);
  assert.equal(r.stopped.byRule["no-double-booking"], 1);
  assert.equal(r.stopped.byRule["opt-out"], 1);
  assert.equal(r.stopped.byRule["no-message-after-stop"], 1);
  assert.equal(r.stopped.byRule["refund-limit"], 0, "a refund the owner is asked about was held for them, not stopped");
  assert.equal(r.stopped.total, 4, "four entries said no; the last one under two rules");
  assert.equal(r.owner.asked, 1);
});

test("only unconfirmed and failed are counted as left open, and a later confirmed entry for the same thing settles it", () => {
  seq = 0;
  const r = count([
    e("hold_slot", "attempted"), e("confirm_booking", "unconfirmed", { booking: "b-1" }), e("confirm_booking", "confirmed", { booking: "b-1" }),
    e("refund", "failed", { booking: "b-2", refs: { paymentId: "pay_1" } }), e("refund", "confirmed", { booking: "b-2", refs: { paymentId: "pay_2", refundId: "r_2" } }), // another payment's refund does not settle it
    e("send_message", "unconfirmed", { booking: "b-3", refs: { to: "customer" } }), e("send_message", "confirmed", { booking: "b-3", refs: { to: "customer" } }), // a later message is not the lost one
    e("hold_slot", "held_for_owner" as Outcome),
  ]);
  assert.deepEqual(r.unconfirmed.rows.map((x) => [x.action, x.settledLater]), [["confirm_booking", true], ["refund", false], ["send_message", false]]);
  assert.equal(r.unconfirmed.open, 2);
  assert.equal(r.unconfirmed.settledLater, 1);
});

test("owner commands and message targets are read from the record, and an entry without them is noted, never guessed", () => {
  seq = 0;
  const r = count([
    e("owner_decision", "confirmed", { refs: { command: "approve" } }), e("owner_decision", "confirmed", { refs: { command: "deny" } }), e("owner_decision", "confirmed", { refs: { command: "retry" } }),
    e("owner_decision", "confirmed"), e("owner_decision", "attempted", { refs: { command: "approve" } }), e("owner_decision", "blocked", { refs: { command: "deny" } }),
    e("send_message", "confirmed", { refs: { to: "customer" }, language: "hi" }), e("send_message", "confirmed", { refs: { to: "owner" }, language: "ml" }), e("send_message", "confirmed"),
  ]);
  assert.deepEqual(r.owner, { asked: 0, approved: 1, denied: 1, retried: 1 });
  assert.equal(r.missing.ownerCommands, 1);
  assert.equal(r.missing.messageTargets, 1);
  assert.equal(r.messages.toCustomers.byLanguage.hi, 1);
  assert.equal(r.messages.toOwner.byLanguage.ml, 1);
});

test("the month is [from, to) in the shop's time zone: 00:00 in India on 1 November is 18:30 UTC the evening before", () => {
  assert.equal(new Date(November.from).toISOString(), "2026-10-31T18:30:00.000Z");
  assert.equal(new Date(November.to).toISOString(), "2026-11-30T18:30:00.000Z");
  seq = 0;
  const oneMs = (action: Action, ms: number, booking: string) => e(action, "confirmed", { booking, time: ms });
  const r = count([
    oneMs("confirm_booking", November.from - 1, "b-1"), // 23:59:59.999 on 31 October in India
    oneMs("confirm_booking", November.from, "b-2"), // 00:00:00.000 on 1 November
    oneMs("confirm_booking", November.to - 1, "b-3"), // the last millisecond of 30 November
    oneMs("confirm_booking", November.to, "b-4"), // 00:00 on 1 December
  ]);
  assert.equal(r.bookings.made, 2);
  assert.deepEqual(monthRange("2026-12", "Asia/Kolkata").to - monthRange("2026-12", "Asia/Kolkata").from, 31 * 24 * 3600 * 1000);
  assert.throws(() => monthRange("2026-13", "Asia/Kolkata"), /not a month/);
});

test("a period that is not a whole month says so", () => {
  const r = count([], { from: at(11, 3, 0), to: at(11, 10, 0) });
  assert.equal(r.period.month, null);
  assert.deepEqual(r.period.firstDay, { year: 2026, month: 11, day: 3 });
  assert.deepEqual(r.period.lastDay, { year: 2026, month: 11, day: 9 });
});

test("the report asks what the numbers were counted from, and the not-counted and not-tested lists are always there", () => {
  seq = 0;
  const empty = count([]);
  assert.ok(empty.notCounted.length >= 3 && empty.notTested.length >= 14);
  assert.throws(() => buildMonthlyReport({ settings, entries: [], bookings: [], ...November, madeAt: 0 } as never), /counted from/);
  assert.throws(() => buildMonthlyReport({ settings, entries: [], bookings: [], from: 2, to: 1, source: "live", madeAt: 0 }), /must end after/);
});

test("the policy digest ignores the owner's number and the address, and changes with a price", () => {
  const other = JSON.parse(JSON.stringify(settings));
  other.owner.whatsapp = "+919000000099";
  other.address = "Somewhere else";
  assert.equal(policyDigest(other), policyDigest(settings));
  other.services[0].priceInr = 500;
  assert.notEqual(policyDigest(other), policyDigest(settings));
  assert.equal(RULE_IDS.length, 9);
});
