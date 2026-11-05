// The Fees limits as pure checks, and the Guard spec built from the settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { createRecord } from "../../../../modules/record/record.ts";
import { guardHoldsRefund, guardRefusesRefund, refundRulesOf } from "../../../../modules/payments/guard-limits.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { brightTuition } from "../src/harness.ts";
import { razorpayLimitsSpec, razorpayNumbers } from "../src/guard-limits.ts";
import { checkFeeLink, checkNoReminderOncePaid, checkOneRefundPerPayment, checkPaidOnlyWhenRecorded, checkReminderCap, checkWaiver, recordedPaidPaise } from "../src/limits.ts";
import { parseSettings } from "../src/settings.ts";

const IDENTITY = { tenant: "bright-tuition", version: 1, reviewedBy: "test" } as const;
const settings = brightTuition();

const recordWith = (payments: number[]) => {
  const record = createRecord(fakeClock(Date.UTC(2026, 10, 2)));
  payments.forEach((p, i) => record.append({ conversation: "+91", booking: "f-1", action: "record_payment", inputs: {}, outcome: "confirmed", language: "en", refs: { paymentId: `pay_${i}`, amountPaise: String(p) } }));
  record.append({ conversation: "+91", booking: "f-1", action: "record_payment", inputs: {}, outcome: "failed", language: "en", refs: { amountPaise: "999900" } });
  return record;
};

test("a link is for what the record says is owed, and for nothing else", () => {
  assert.equal(checkFeeLink({ amountInr: 1800, balanceInr: 1800, highestInr: 1900 }).verdict, "allow");
  assert.equal(checkFeeLink({ amountInr: 1500, balanceInr: 1800, highestInr: 1900 }).verdict, "block", "less than owed");
  assert.equal(checkFeeLink({ amountInr: 2000, balanceInr: 2000, highestInr: 1900 }).verdict, "block", "more than any fee");
  assert.equal(checkFeeLink({ amountInr: 0, balanceInr: 0, highestInr: 1900 }).verdict, "block");
  assert.equal(checkFeeLink({ amountInr: 12.5, balanceInr: 12.5, highestInr: 1900 }).verdict, "block");
});

test("no reminder once the payment record covers the fee, none when it could not be read, and the record is the failed-entries-free list of confirmed payments", () => {
  const unpaid = recordWith([]);
  const part = recordWith([60_000]);
  const paid = recordWith([180_000]);
  const over = { dueId: "f-1", owedPaise: 180_000, readOk: true };
  assert.equal(recordedPaidPaise(paid, "f-1"), 180_000, "an entry that did not confirm is not money");
  assert.equal(checkNoReminderOncePaid({ record: unpaid, ...over }).verdict, "allow");
  assert.equal(checkNoReminderOncePaid({ record: part, ...over }).verdict, "allow");
  assert.equal(checkNoReminderOncePaid({ record: paid, ...over }).verdict, "block");
  assert.equal(checkNoReminderOncePaid({ record: recordWith([100_000, 80_000]), ...over }).verdict, "block", "two payments that add up to it");
  assert.equal(checkNoReminderOncePaid({ record: unpaid, ...over, readOk: false }).verdict, "block", "a record that could not be read");
  assert.equal(checkNoReminderOncePaid({ record: paid, dueId: "f-2", owedPaise: 180_000, readOk: true }).verdict, "allow", "another fee's payments are not this one's");
});

test("'received' and 'nothing more is due' go out only when the payment record shows the money", () => {
  assert.equal(checkPaidOnlyWhenRecorded({ record: recordWith([]), dueId: "f-1", owedPaise: 180_000, needsAll: false }).verdict, "block");
  assert.equal(checkPaidOnlyWhenRecorded({ record: recordWith([60_000]), dueId: "f-1", owedPaise: 180_000, needsAll: false }).verdict, "allow");
  assert.equal(checkPaidOnlyWhenRecorded({ record: recordWith([60_000]), dueId: "f-1", owedPaise: 180_000, needsAll: true }).verdict, "block");
  assert.equal(checkPaidOnlyWhenRecorded({ record: recordWith([180_000]), dueId: "f-1", owedPaise: 180_000, needsAll: true }).verdict, "allow");
});

test("a waiver: within the limit in all, or the owner's call for that amount; never more than is owed", () => {
  const base = { balanceInr: 1800, alreadyWaivedInr: 0, limitInr: 100 };
  assert.equal(checkWaiver({ ...base, amountInr: 100 }).verdict, "allow");
  assert.equal(checkWaiver({ ...base, amountInr: 101 }).verdict, "hold_for_owner");
  assert.equal(checkWaiver({ ...base, alreadyWaivedInr: 60, amountInr: 50 }).verdict, "hold_for_owner", "judged on the total");
  assert.equal(checkWaiver({ ...base, limitInr: 0, amountInr: 1 }).verdict, "hold_for_owner", "a limit of nothing sends every request to the owner");
  assert.equal(checkWaiver({ ...base, amountInr: 1801 }).verdict, "block", "more than is owed");
  assert.equal(checkWaiver({ ...base, amountInr: 0 }).verdict, "block");
  assert.equal(checkWaiver({ ...base, amountInr: 900, ownerApproved: true }).verdict, "allow");
  assert.equal(checkWaiver({ ...base, amountInr: 2000, ownerApproved: true }).verdict, "block", "the owner cannot waive more than is owed either");
});

test("a reminder cap, and one refund per payment", () => {
  assert.equal(checkReminderCap({ sent: 3, maxPerMonth: 4 }).verdict, "allow");
  assert.equal(checkReminderCap({ sent: 4, maxPerMonth: 4 }).verdict, "block");
  assert.equal(checkOneRefundPerPayment({ paymentId: "pay_1", refundedPaise: 0 }).verdict, "allow");
  assert.equal(checkOneRefundPerPayment({ paymentId: "pay_1", refundedPaise: 100 }).verdict, "block", "a part refund is the payment's refund");
});

test("the Guard spec: links in a range, refunds bounded by the dearest fee, held above the owner's limit, once per payment, no payouts, daily caps", () => {
  const spec = razorpayLimitsSpec(settings, IDENTITY);
  assert.equal(spec.schema, 1);
  const rule = (id: string) => spec.rules.find((r: any) => r.id === id);
  assert.deepEqual([rule("fee-amount").min, rule("fee-amount").max, rule("fee-amount").operation], ["100", "190000", "create_link"], "₹1 to ₹1,800 + ₹100");
  assert.deepEqual([rule("refund-at-most-fee-paid").min, rule("refund-at-most-fee-paid").max], ["1", "190000"]);
  assert.equal(rule("refund-needs-owner").threshold, "50000", "the owner's refund limit, ₹500, in paise: the one value");
  assert.equal(rule("refund-once").kind, "at_most_once_effect");
  assert.equal(rule("no-payouts").kind, "forbidden_call");
  assert.deepEqual(spec.limits.map((l: any) => l.id), ["refund-paise-per-day", "refunds-per-day", "links-per-hour"]);
  assert.equal(guardHoldsRefund(spec, 50_000), false);
  assert.equal(guardHoldsRefund(spec, 50_001), true, "above the limit, not at it");
  assert.match(guardRefusesRefund(spec, 190_001) ?? "", /refund-at-most-fee-paid/);
  assert.equal(guardRefusesRefund(spec, 190_000), undefined);
  assert.equal(refundRulesOf(spec).thresholdPaise, 50_000n);
  assert.deepEqual(razorpayLimitsSpec(settings, IDENTITY), spec, "the same settings give the same spec");
});

test("changing the refund limit changes the spec's threshold, and a daily cap below the dearest fee is refused", () => {
  const raw = JSON.parse(JSON.stringify(settings));
  raw.students = settings.students.map((s) => ({ name: s.name, parent: s.parent, batch: s.batchId, language: s.language }));
  raw.refund.limitInr = 900;
  const changed = parseSettings(raw);
  assert.equal(razorpayLimitsSpec(changed, IDENTITY).rules.find((r: any) => r.id === "refund-needs-owner").threshold, "90000");
  assert.throws(() => razorpayNumbers(settings, { caps: { refundPaisePerDay: 100_000 } }), /smaller than the dearest fee/);
  assert.throws(() => razorpayLimitsSpec(settings, { ...IDENTITY, version: 0 }), /version must be a whole number/);
});

test("the in-process Guard model uses the same spec: a link outside the range, or a refund above the dearest fee, is refused with the rule's name", () => {
  const model = createGuardModel(razorpayLimitsSpec(settings, IDENTITY), fakeClock(0));
  assert.deepEqual(model.decideLink(150_000), { kind: "pass" });
  assert.equal(model.decideLink(190_001).kind, "refused");
  assert.equal(model.decideLink(99).kind, "refused");
  assert.equal(model.decideLink("1500").kind, "refused", "an amount that is not a number is never a pass");
  const refused = model.decideRefund("pay_1", { amount: 200_000 });
  assert.equal(refused.kind === "refused" && refused.ruleId, "refund-at-most-fee-paid");
});

test("scripts/guard-spec.ts prints the same spec the code makes for the example centre, and says plainly what it needs", () => {
  const script = new URL("../scripts/guard-spec.ts", import.meta.url).pathname;
  const file = new URL("../settings/bright-tuition.example.json", import.meta.url).pathname;
  const printed = JSON.parse(execFileSync("node", [script, "--settings", file, "--tenant", "bright-tuition", "--reviewed-by", "builder-arjun"], { encoding: "utf8" })) as unknown;
  assert.deepEqual(printed, JSON.parse(JSON.stringify(razorpayLimitsSpec(settings, { tenant: "bright-tuition", version: 1, reviewedBy: "builder-arjun" }))));
  assert.throws(() => execFileSync("node", [script, "--settings", file], { encoding: "utf8", stdio: "pipe" }), /Command failed/);
});
