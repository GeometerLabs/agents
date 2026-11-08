// The limits are pure checks: they read nothing but their arguments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { areaOf, checkBeforeCutoff, checkConfirmOnlyWhenRecorded, checkDayCap, checkDeliveryArea, checkMessageMatchesRecord, checkOrderSize, checkPriceAtOrAboveMenu, checkRefundLimit, checkStock } from "../src/limits.ts";
import { createRecord } from "../../../../modules/record/record.ts";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { checkMessage } from "../src/language/check.ts";
import type { MessageFacts } from "../src/language/templates.ts";

test("price: never below the menu price, the menu price itself is fine", () => {
  assert.equal(checkPriceAtOrAboveMenu({ itemName: "thali", listInr: 120, proposedInr: 119 }).verdict, "block");
  assert.equal(checkPriceAtOrAboveMenu({ itemName: "thali", listInr: 120, proposedInr: 120 }).verdict, "allow");
  assert.equal(checkPriceAtOrAboveMenu({ itemName: "thali", listInr: 120, proposedInr: 0 }).verdict, "block", "free is below the price");
});

test("stock, the day's count and the order's size", () => {
  assert.equal(checkStock({ itemName: "thali", wanted: 3, taken: 10, dailyStock: 12 }).verdict, "block");
  assert.equal(checkStock({ itemName: "thali", wanted: 2, taken: 10, dailyStock: 12 }).verdict, "allow");
  assert.equal(checkStock({ itemName: "thali", wanted: 1, taken: 15, dailyStock: 12 }).verdict, "block");
  assert.equal(checkDayCap({ ordersOnDay: 8, maxPerDay: 8 }).verdict, "block");
  assert.equal(checkDayCap({ ordersOnDay: 7, maxPerDay: 8 }).verdict, "allow");
  assert.equal(checkOrderSize({ items: 11, maxItems: 10 }).verdict, "block");
  assert.equal(checkOrderSize({ items: 0, maxItems: 10 }).verdict, "block");
  assert.equal(checkOrderSize({ items: 10, maxItems: 10 }).verdict, "allow");
});

test("the cut-off: the moment itself is too late", () => {
  assert.equal(checkBeforeCutoff({ nowMs: 1000, cutoffMs: 1000 }).verdict, "block");
  assert.equal(checkBeforeCutoff({ nowMs: 999, cutoffMs: 1000 }).verdict, "allow");
});

test("the delivery area is a plain list, matched on whole words in any case", () => {
  const area = ["Kakkanad", "Edappally", "Info Park"];
  assert.equal(areaOf("flat 4, lake view, KAKKANAD, kochi", area), "Kakkanad");
  assert.equal(areaOf("near info-park gate 2", area), "Info Park");
  assert.equal(areaOf("Kakkanadu", area), undefined, "part of a word is not the place");
  assert.equal(checkDeliveryArea({ address: "12 Park Street, Mumbai", area }).verdict, "block");
});

test("confirmed only when the record holds the whole advance: a part, or nothing, is not enough", () => {
  const record = createRecord(fakeClock(0));
  const entry = (action: string, amountPaise: string) => record.append({ conversation: "+91", booking: "o-1", action, inputs: {}, outcome: "confirmed", language: "en", decisions: [], refs: { amountPaise, paymentId: `p${amountPaise}` } });
  assert.equal(checkConfirmOnlyWhenRecorded({ record, order: "o-1", advancePaise: 12000 }).verdict, "block");
  entry("record_payment", "5000");
  assert.equal(checkConfirmOnlyWhenRecorded({ record, order: "o-1", advancePaise: 12000 }).verdict, "block");
  entry("owner_marked_paid", "7000");
  assert.equal(checkConfirmOnlyWhenRecorded({ record, order: "o-1", advancePaise: 12000 }).verdict, "allow", "the owner's UPI mark is the record");
  assert.equal(checkConfirmOnlyWhenRecorded({ record, order: "o-2", advancePaise: 1 }).verdict, "block", "another order's payments are not this one's");
});

test("a refund is never more than was paid, above the limit it waits for the owner, outside the window the owner decides", () => {
  assert.equal(checkRefundLimit({ amountInr: 301, limitInr: 300, paidInr: 301 }).verdict, "hold_for_owner");
  assert.equal(checkRefundLimit({ amountInr: 300, limitInr: 300, paidInr: 300 }).verdict, "allow");
  assert.equal(checkRefundLimit({ amountInr: 130, limitInr: 300, paidInr: 120 }).verdict, "block");
  assert.equal(checkRefundLimit({ amountInr: 100, limitInr: 300, paidInr: 100, inCancellationWindow: false }).verdict, "hold_for_owner");
});

test("a message's amounts, quantities, days and links must be the record's: a different quantity, amount, or link is held back", () => {
  const facts: MessageFacts = { language: "en", timeZone: "Asia/Kolkata", businessName: "Annapurna Tiffins", menu: [{ name: "veg thali", priceInr: 120 }], itemsText: "2 × veg thali", totalInr: 240, advanceInr: 120, link: "https://rzp.io/i/x" };
  const check = (text: string) => checkMessageMatchesRecord({ text, facts }).verdict;
  assert.equal(check("2 × veg thali, total ₹240, pay ₹120: https://rzp.io/i/x"), "allow");
  assert.equal(check("3 × veg thali, total ₹240"), "block");
  assert.equal(check("2 × veg thali, total ₹241"), "block");
  assert.equal(check("pay at https://evil.example/x"), "block");
  assert.equal(checkMessage("2 × veg thali on Fri 14 Jun", facts).ok, false, "a day the record does not hold");
});
