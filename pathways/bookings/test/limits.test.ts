import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeClock } from "../src/clock.ts";
import {
  checkConfirmOnlyWhenRecorded, checkMessageMatchesRecord, checkNoDoubleBooking, checkNoMessageAfterStop, checkOneDepositPerBooking,
  checkOptOut, checkPriceAtOrAboveList, checkRefundLimit, checkWithinHours, strictest,
} from "../src/limits.ts";
import { createRecord } from "../src/record.ts";
import { parseSettings } from "../src/settings.ts";
import { MINUTE, zonedToMs } from "../src/time.ts";

const settings = parseSettings(JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")));
const haircut = settings.services[0]; // 45 minutes, ₹450
const at = (day: number, hour: number, minute = 0) => zonedToMs({ year: 2026, month: 11, day }, { hour, minute }, settings.timezone); // November 2026: the 10th is a Tuesday

test("price-at-or-above-list: below the list is blocked, at or above is allowed", () => {
  const input = { serviceName: "haircut", listInr: 450 };
  const low = checkPriceAtOrAboveList({ ...input, proposedInr: 300 });
  assert.deepEqual([low.verdict, low.ruleId], ["block", "price-at-or-above-list"]);
  assert.match(low.reason, /₹300 is below the price list: haircut is ₹450/);
  assert.equal(checkPriceAtOrAboveList({ ...input, proposedInr: 0 }).verdict, "block");
  assert.equal(checkPriceAtOrAboveList({ ...input, proposedInr: 449 }).verdict, "block");
  assert.equal(checkPriceAtOrAboveList({ ...input, proposedInr: 450 }).verdict, "allow");
  assert.equal(checkPriceAtOrAboveList({ ...input, proposedInr: 500 }).verdict, "allow");
});

test("within-hours: open days and times, the edges, closed days, running past closing, and the slot grid", () => {
  const check = (startMs: number) => checkWithinHours({ settings, service: haircut, startMs });
  assert.equal(check(at(10, 10)).verdict, "allow"); // opens at 10:00
  assert.equal(check(at(10, 19, 0)).verdict, "allow"); // 19:00 + 45 min ends 19:45, before the 20:00 close
  assert.match(check(at(10, 9, 30)).reason, /before opening time/);
  assert.match(check(at(10, 19, 30)).reason, /past closing time/); // would end 20:15
  assert.match(check(at(10, 22)).reason, /past closing time|before opening/);
  assert.match(check(at(8, 12)).reason, /closed that day/); // Sunday
  assert.match(check(at(10, 11, 15)).reason, /every 30 minutes/);
  assert.equal(check(at(14, 20, 0)).verdict, "allow"); // Saturday closes at 21:00
});

test("no-double-booking: overlaps and the buffer block; expired holds and the booking's own event do not", () => {
  const start = at(10, 18);
  const end = start + 45 * MINUTE;
  const base = { startMs: start, endMs: end, bufferMinutes: 10, ownBookingRef: "b-2", nowMs: at(10, 9) };
  const other = (s: number, e: number, extra = {}) => ({ start: s, end: e, bookingRef: "b-1", ...extra });
  assert.equal(checkNoDoubleBooking({ ...base, others: [] }).verdict, "allow");
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(start, end)] }).verdict, "block");
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(start + 10 * MINUTE, end + 10 * MINUTE)] }).verdict, "block");
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(start - 50 * MINUTE, start - 5 * MINUTE)] }).verdict, "block"); // ends 5 minutes before: inside the buffer
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(start - 60 * MINUTE, start - 10 * MINUTE)] }).verdict, "allow"); // exactly the buffer
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(end + 10 * MINUTE, end + 55 * MINUTE)] }).verdict, "allow");
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(start, end, { bookingRef: "b-2" })] }).verdict, "allow"); // its own event
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(start, end, { tentativeUntil: at(10, 8) })] }).verdict, "allow"); // hold ran out
  assert.equal(checkNoDoubleBooking({ ...base, others: [other(start, end, { tentativeUntil: at(10, 10) })] }).verdict, "block"); // hold still live
});

test("confirm-only-when-recorded needs BOTH the calendar and the deposit, read back and recorded as confirmed", () => {
  const record = createRecord(fakeClock(at(10, 9)));
  const entry = (action: "confirm_booking" | "record_deposit", outcome: "attempted" | "unconfirmed" | "confirmed") =>
    record.append({ conversation: "c", booking: "b-1", action, inputs: {}, outcome, language: "en" });
  const verdict = () => checkConfirmOnlyWhenRecorded({ record, booking: "b-1" });
  assert.match(verdict().reason, /calendar does not show the booking and no deposit is recorded/);
  entry("record_deposit", "confirmed");
  assert.match(verdict().reason, /the calendar does not show the booking\./);
  entry("confirm_booking", "attempted");
  entry("confirm_booking", "unconfirmed");
  assert.equal(verdict().verdict, "block"); // the calendar said ok but the read-back did not find it
  entry("confirm_booking", "confirmed");
  assert.equal(verdict().verdict, "allow");
  assert.equal(checkConfirmOnlyWhenRecorded({ record, booking: "b-2" }).verdict, "block"); // another booking's records do not count
});

test("one-deposit-per-booking: the first payment is the deposit, a second payment is not counted", () => {
  const record = createRecord(fakeClock(at(10, 9)));
  const check = (paymentId: string) => checkOneDepositPerBooking({ record, booking: "b-1", paymentId });
  assert.equal(check("pay_1").verdict, "allow");
  record.append({ conversation: "c", booking: "b-1", action: "record_deposit", inputs: {}, outcome: "confirmed", language: "en", refs: { paymentId: "pay_1" } });
  assert.equal(check("pay_1").verdict, "allow"); // the same payment seen again
  const second = check("pay_2");
  assert.deepEqual([second.verdict, second.ruleId], ["block", "one-deposit-per-booking"]);
  assert.match(second.reason, /refunded and the owner is told/);
});

test("refund-limit: the limit itself is within the limit; above it, late cancellations and owner approval", () => {
  const base = { limitInr: 200 };
  assert.equal(checkRefundLimit({ ...base, amountInr: 200 }).verdict, "allow");
  assert.equal(checkRefundLimit({ ...base, amountInr: 100 }).verdict, "allow");
  const over = checkRefundLimit({ ...base, amountInr: 201 });
  assert.deepEqual([over.verdict, over.ruleId], ["hold_for_owner", "refund-limit"]);
  assert.match(over.reason, /₹201 is above your ₹200 refund limit/);
  assert.equal(checkRefundLimit({ ...base, amountInr: 201, ownerApproved: true }).verdict, "allow");
  assert.equal(checkRefundLimit({ ...base, amountInr: 200, inCancellationWindow: false }).verdict, "hold_for_owner");
  assert.equal(checkRefundLimit({ ...base, amountInr: 200, inCancellationWindow: false, ownerApproved: true }).verdict, "allow");
  assert.equal(checkRefundLimit({ ...base, amountInr: 0 }).verdict, "block");
  assert.equal(checkRefundLimit({ ...base, amountInr: 150, paidInr: 100, ownerApproved: true }).verdict, "block"); // even the owner cannot refund more than was paid
});

test("no-message-after-stop and opt-out", () => {
  const live = { isReminder: true, bookingConfirmed: true, customerOptedOut: false };
  assert.equal(checkNoMessageAfterStop(live).verdict, "allow");
  assert.equal(checkNoMessageAfterStop({ ...live, bookingConfirmed: false }).verdict, "block"); // cancelled, finished or never confirmed
  assert.equal(checkNoMessageAfterStop({ ...live, customerOptedOut: true }).verdict, "block");
  assert.equal(checkNoMessageAfterStop({ ...live, isReminder: false, bookingConfirmed: false }).verdict, "allow"); // a reply is not a reminder
  assert.equal(checkOptOut({ toCustomer: true, customerOptedOut: true }).verdict, "block");
  assert.equal(checkOptOut({ toCustomer: true, customerOptedOut: false }).verdict, "allow");
  assert.equal(checkOptOut({ toCustomer: false, customerOptedOut: true }).verdict, "allow"); // the owner may still be told
});

test("message-matches-record wraps the outgoing check", () => {
  const facts = { language: "en" as const, timeZone: "Asia/Kolkata", businessName: "Glow Salon", services: [{ name: "haircut", priceInr: 450 }], priceInr: 450 };
  assert.equal(checkMessageMatchesRecord({ text: "A haircut is ₹450.", facts }).verdict, "allow");
  const bad = checkMessageMatchesRecord({ text: "A haircut is ₹300.", facts });
  assert.deepEqual([bad.verdict, bad.ruleId], ["block", "message-matches-record"]);
  assert.match(bad.reason, /does not match the record.*₹300/);
});

test("strictest picks a block over a hold over an allow", () => {
  const a = checkRefundLimit({ amountInr: 100, limitInr: 200 });
  const h = checkRefundLimit({ amountInr: 300, limitInr: 200 });
  const b = checkRefundLimit({ amountInr: 0, limitInr: 200 });
  assert.equal(strictest([a, h]).verdict, "hold_for_owner");
  assert.equal(strictest([a, h, b]).verdict, "block");
  assert.equal(strictest([a]).verdict, "allow");
});

test("the limits are pure: the same inputs give the same decision, and nothing is changed", () => {
  const input = { settings, service: haircut, startMs: at(10, 18) };
  const frozen = JSON.stringify(settings);
  assert.deepEqual(checkWithinHours(input), checkWithinHours(input));
  assert.equal(JSON.stringify(settings), frozen);
});
