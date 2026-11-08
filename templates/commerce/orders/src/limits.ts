// The Orders limits, in plain words, as pure checks. Each takes the facts it needs and returns a decision { verdict, ruleId, reason }. They have no side effects and read
// nothing but their arguments, so the agent calls them in-process, and later Guard can run the very same functions outside the AI, in front of every real service. Three are
// every template's and live in modules/limits/limits.ts (opt-out, the refund limit, message-matches-record); the wrappers below give the last two Orders' facts. The rest:
//
//   price-at-or-above-menu       never quote or agree below the menu price
//   order-size                   at most so many items in one order
//   within-stock                 never more of an item than the day's stock (what other orders hold counted)
//   within-day-cap               never more orders for a day than the shop takes
//   before-cutoff                no order once the cut-off for its day and slot has passed
//   within-delivery-area         a delivery address must name a place on the shop's list
//   confirm-only-when-recorded   "confirmed" only when the payment record (or the owner's UPI mark) shows the whole advance
//   one-advance-per-order        a second payment on an order that has its advance is not another advance
//   refund-limit, opt-out, message-matches-record      the shared three
import { formatInr } from "../../../../modules/language/format.ts";
import { allow, block, checkRecordMatch, checkRefund, hold } from "../../../../modules/limits/limits.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import type { RecordView } from "../../../../modules/record/record.ts";
import { canon } from "../../../../modules/language/format.ts";
import { checkFactsOf } from "./language/check.ts";
import type { MessageFacts } from "./language/templates.ts";

export { allow, block, hold };
export type { Decision };

// price-at-or-above-menu: never quote or agree below the menu price (the menu price is the floor)
export function checkPriceAtOrAboveMenu(input: { itemName: string; listInr: number; proposedInr: number }): Decision {
  const { itemName, listInr, proposedInr } = input;
  if (proposedInr < listInr) return block("price-at-or-above-menu", `${formatInr(proposedInr)} is below the menu price: ${itemName} is ${formatInr(listInr)}. The agent never quotes or agrees to less.`);
  return allow("price-at-or-above-menu", `${formatInr(proposedInr)} is at or above the menu price of ${formatInr(listInr)} for ${itemName}.`);
}

// order-size: an order has at most so many items, counting each one. (Guard bounds a payment link by the same number of the dearest item.)
export function checkOrderSize(input: { items: number; maxItems: number }): Decision {
  if (input.items > input.maxItems) return block("order-size", `${input.items} items is more than one order may have (${input.maxItems}).`);
  if (input.items < 1) return block("order-size", "An order needs at least one item.");
  return allow("order-size", `${input.items} items is within the ${input.maxItems} one order may have.`);
}

// within-stock: the day's stock of an item. `taken` is what the other orders that hold stock already have (confirmed ones, and ones whose hold has not run out).
export function checkStock(input: { itemName: string; wanted: number; taken: number; dailyStock: number }): Decision {
  const { itemName, wanted, taken, dailyStock } = input;
  const left = Math.max(0, dailyStock - taken);
  if (wanted > left) return block("within-stock", `${wanted} of ${itemName} is more than is left for the day: ${left} of ${dailyStock}.`);
  return allow("within-stock", `${wanted} of ${itemName} is within the ${left} left of ${dailyStock}.`);
}

// within-day-cap: the most orders for one day. `ordersOnDay` is the orders that hold a place (confirmed, or held and not run out), not counting this one.
export function checkDayCap(input: { ordersOnDay: number; maxPerDay: number }): Decision {
  if (input.ordersOnDay >= input.maxPerDay) return block("within-day-cap", `${input.ordersOnDay} orders already hold a place for the day, which is the most (${input.maxPerDay}).`);
  return allow("within-day-cap", `${input.ordersOnDay} of ${input.maxPerDay} orders hold a place for the day.`);
}

// before-cutoff: no order once the cut-off for the order's day and slot has passed. The moment itself is already too late.
export function checkBeforeCutoff(input: { nowMs: number; cutoffMs: number }): Decision {
  if (input.nowMs >= input.cutoffMs) return block("before-cutoff", "The cut-off for that day and slot has passed.");
  return allow("before-cutoff", "The cut-off for that day and slot has not passed.");
}

/** The place on the shop's list that an address names (whole words, any case), or undefined. The longest name wins. */
export function areaOf(address: string, area: readonly string[]): string | undefined {
  const text = ` ${canon(address).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return [...area].sort((a, b) => b.length - a.length).find((place) => text.includes(` ${canon(place).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `));
}

// within-delivery-area: a delivery address must name a place on the shop's list.
export function checkDeliveryArea(input: { address: string; area: readonly string[] }): Decision {
  const place = areaOf(input.address, input.area);
  if (!place) return block("within-delivery-area", "The address names no place on the shop's delivery list.");
  return allow("within-delivery-area", `The address names ${place}, which is on the shop's delivery list.`);
}

/**
 * What the payment record shows paid on an order, in paise: the payments the agent read back from the payments service's own list and wrote as confirmed
 * ("record_payment"), and on a UPI shop (B33) the payments the owner marked received ("owner_marked_paid"). Never what a customer said or sent: a screenshot makes no such entry.
 */
export function recordedPaidPaise(record: RecordView, orderId: string): number {
  return [...record.confirmedRefs(orderId, "record_payment", "amountPaise"), ...record.confirmedRefs(orderId, "owner_marked_paid", "amountPaise")].reduce((n, s) => n + Number(s), 0);
}

// confirm-only-when-recorded: say "confirmed" only when the record shows the whole advance for this order.
export function checkConfirmOnlyWhenRecorded(input: { record: RecordView; order: string; advancePaise: number }): Decision {
  const paid = recordedPaidPaise(input.record, input.order);
  if (paid >= input.advancePaise) return allow("confirm-only-when-recorded", `The payment record shows ${formatInr(paid / 100)} paid, which covers the ${formatInr(input.advancePaise / 100)} advance.`);
  return block("confirm-only-when-recorded", `Not confirmed yet: the payment record shows ${formatInr(paid / 100)} of the ${formatInr(input.advancePaise / 100)} advance.`);
}

// one-advance-per-order: a second payment on an order that already has its advance is not another advance. The block means "do not count it"; the agent refunds it.
export function checkOneAdvancePerOrder(input: { record: RecordView; order: string; paymentId: string }): Decision {
  const recorded = input.record.confirmedRefs(input.order, "record_payment", "paymentId");
  if (recorded.length === 0) return allow("one-advance-per-order", "No advance is recorded for this order yet, so this payment is its advance.");
  if (recorded.includes(input.paymentId)) return allow("one-advance-per-order", "This payment is the order's recorded advance.");
  return block("one-advance-per-order", "This order already has its advance, so this second payment is not counted. It is refunded and the owner is told.");
}

// refund-limit: a refund is never more than the payment, and above the limit the owner approves it (Guard holds it). Outside the cancellation window the owner decides too.
export function checkRefundLimit(input: { amountInr: number; limitInr: number; paidInr?: number; ownerApproved?: boolean; inCancellationWindow?: boolean }): Decision {
  const { inCancellationWindow = true, ...rest } = input;
  return checkRefund({ ...rest, owedAutomatically: inCancellationWindow, notAutomaticReason: "The order was cancelled too late for an automatic refund, so the owner decides." });
}

export function checkMessageMatchesRecord(input: { text: string; facts: MessageFacts }): Decision {
  return checkRecordMatch({ text: input.text, facts: checkFactsOf(input.facts) });
}
