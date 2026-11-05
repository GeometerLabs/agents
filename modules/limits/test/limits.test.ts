import { test } from "node:test";
import assert from "node:assert/strict";
import { allow, block, checkOptOut, checkRecordMatch, checkRefund, hold, strictest } from "../limits.ts";

const words = { notAutomaticReason: "The owner decides this one." };

test("a refund is within the limit, above it (the owner decides), or never more than was paid", () => {
  assert.equal(checkRefund({ amountInr: 200, limitInr: 200, paidInr: 500, ...words }).verdict, "allow", "the limit itself is within it");
  assert.equal(checkRefund({ amountInr: 201, limitInr: 200, paidInr: 500, ...words }).verdict, "hold_for_owner");
  const more = checkRefund({ amountInr: 600, limitInr: 1000, paidInr: 500, ...words });
  assert.equal(more.verdict, "block");
  assert.match(more.reason, /more than the ₹500 that was paid/);
  assert.equal(checkRefund({ amountInr: 0, limitInr: 200, ...words }).verdict, "block");
  assert.equal(checkRefund({ amountInr: 900, limitInr: 200, paidInr: 900, ownerApproved: true, ...words }).verdict, "allow");
  const late = checkRefund({ amountInr: 100, limitInr: 200, paidInr: 500, owedAutomatically: false, ...words });
  assert.deepEqual([late.verdict, late.reason], ["hold_for_owner", "The owner decides this one."]);
});

test("the strictest decision wins, STOP blocks only messages to the customer, and a message is checked against the record it is given", () => {
  assert.equal(strictest([allow("a", "x"), hold("b", "y"), block("c", "z")]).ruleId, "c");
  assert.equal(strictest([allow("a", "x"), hold("b", "y")]).ruleId, "b");
  assert.equal(checkOptOut({ toCustomer: true, customerOptedOut: true }).verdict, "block");
  assert.equal(checkOptOut({ toCustomer: false, customerOptedOut: true }).verdict, "allow");
  const facts = { language: "en" as const, timeZone: "Asia/Kolkata", amountsInr: [1500], counts: [5], momentsMs: [], links: ["https://rzp.io/l/x"], literals: ["Bright Tuition"] };
  assert.equal(checkRecordMatch({ text: "Bright Tuition: pay ₹1,500 at https://rzp.io/l/x within 5 days.", facts }).verdict, "allow");
  assert.equal(checkRecordMatch({ text: "Pay ₹1,200 now.", facts }).verdict, "block");
  assert.equal(checkRecordMatch({ text: "Pay at https://evil.example/pay", facts }).verdict, "block");
});
