// The limits of Stock orders, as pure functions: each takes the facts it needs and returns a decision { verdict, ruleId, reason }. They read nothing but their arguments,
// so the agent calls them in-process and later Guard can run the very same checks in front of a real service. The three every template has (opt-out, the message matches the
// record, and the refund rule that Stock orders does not use because it moves no money) are in modules/limits/limits.ts; the rest is about buying:
//
//   approved-supplier-only      an order goes only to a supplier on the owner's list who is approved
//   order-quantity              a whole quantity of at least 1 and no more than the settings allow (a typing slip)
//   per-order-cap               one order is never worth more than the owner's cap; the owner's approval cannot raise it
//   monthly-budget              the month's approved orders never add up to more than the budget; reserved with the approval
//   one-order-per-request       a request (the owner's message) makes at most one order, even if the supplier's reply was lost
//   approval-matches-order      an approval counts only for the exact fields the owner saw; any change needs a fresh approval
//   reply-from-supplier         an answer counts as the supplier's only when it comes from the supplier's own number
//   opt-out, message-matches-record   the shared two
import { formatInr } from "../../../../modules/language/format.ts";
import { allow, block, checkOptOut, checkRecordMatch } from "../../../../modules/limits/limits.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import { checkFactsOf } from "./language/check.ts";
import type { MessageFacts } from "./language/templates.ts";
import type { Settings, Supplier } from "./settings.ts";

export { allow, block, checkOptOut };
export type { Decision };

/** Rupees as the messages write them: whole rupees plainly ("₹4,500"), otherwise two decimals ("₹37.50"). */
export const money = (rupees: number): string => (Number.isInteger(rupees) ? formatInr(rupees) : `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// approved-supplier-only
export function checkApprovedSupplier(input: { supplier: Supplier | undefined; named?: string }): Decision {
  const { supplier, named } = input;
  if (!supplier) return block("approved-supplier-only", `${named ? `"${named}"` : "That supplier"} is not on the owner's supplier list, so nothing is ordered from them.`);
  if (!supplier.approved) return block("approved-supplier-only", `${supplier.name} is on the list but not approved at the moment, so nothing is ordered from them.`);
  return allow("approved-supplier-only", `${supplier.name} is an approved supplier.`);
}

// order-quantity
export function checkQuantity(input: { qty: number; maxQuantity: number }): Decision {
  const { qty, maxQuantity } = input;
  if (!Number.isInteger(qty) || qty < 1) return block("order-quantity", "An order needs a whole quantity of at least 1.");
  if (qty > maxQuantity) return block("order-quantity", `${qty} is more than one order may have (${maxQuantity}). It may be a typing slip.`);
  return allow("order-quantity", `${qty} is within the ${maxQuantity} one order may have.`);
}

// per-order-cap: the cap is a hard stop. The owner approves every order anyway, so the cap is for the order the owner would approve by mistake.
export function checkPerOrderCap(input: { totalPaise: number; capInr: number }): Decision {
  const total = input.totalPaise / 100;
  if (total > input.capInr) return block("per-order-cap", `${money(total)} is more than the ${money(input.capInr)} one order may be worth.`);
  return allow("per-order-cap", `${money(total)} is within the ${money(input.capInr)} one order may be worth.`);
}

// monthly-budget: `reservedPaise` is what the month's other approved orders already hold (worked out from the orders, order.ts reservedPaise).
export function checkMonthlyBudget(input: { totalPaise: number; reservedPaise: number; budgetInr: number }): Decision {
  const { totalPaise, reservedPaise, budgetInr } = input;
  const left = Math.max(0, budgetInr * 100 - reservedPaise);
  if (totalPaise > left) return block("monthly-budget", `${money(totalPaise / 100)} is more than the ${money(left / 100)} left of this month's ${money(budgetInr)} budget.`);
  return allow("monthly-budget", `${money(totalPaise / 100)} is within the ${money(left / 100)} left of this month's ${money(budgetInr)} budget.`);
}

// one-order-per-request: the owner's message id has made an order already (or not).
export function checkOneOrderPerRequest(input: { requestId: string; requests: ReadonlyMap<string, string> }): Decision {
  const made = input.requests.get(input.requestId);
  if (made) return block("one-order-per-request", `This request already made order ${made}, so it makes no second one.`);
  return allow("one-order-per-request", "This request has made no order yet.");
}

// approval-matches-order: the card's fields against the order's fields now. `same` is the digest comparison the card module made.
export function checkApprovalMatches(input: { same: boolean; what?: string }): Decision {
  if (input.same) return allow("approval-matches-order", "The order is exactly what the owner approved.");
  return block("approval-matches-order", `The order changed since the owner saw it${input.what ? ` (${input.what})` : ""}, so that approval does not count and a new one is asked.`);
}

// reply-from-supplier: only the supplier's own number can answer for the supplier.
export function checkReplyFromSupplier(input: { from: string; supplier: Supplier }): Decision {
  const same = input.from.replace(/\D/gu, "") === input.supplier.whatsapp.replace(/\D/gu, "");
  return same ? allow("reply-from-supplier", `The reply came from ${input.supplier.name}'s own number.`) : block("reply-from-supplier", "The reply did not come from the supplier's own number, so it does not count.");
}

export function checkMessageMatchesRecord(input: { text: string; facts: MessageFacts }): Decision {
  return checkRecordMatch({ text: input.text, facts: checkFactsOf(input.facts) });
}

/** Every check an order must pass before its card is shown, in the order they are recorded. Stops at nothing: the caller takes the strictest. */
export function proposalChecks(input: { settings: Settings; supplier: Supplier | undefined; qty: number; totalPaise: number; reservedPaise: number }): Decision[] {
  const { settings, supplier, qty, totalPaise, reservedPaise } = input;
  return [
    checkApprovedSupplier({ supplier }),
    checkQuantity({ qty, maxQuantity: settings.limits.maxQuantity }),
    checkPerOrderCap({ totalPaise, capInr: settings.limits.maxPerOrderInr }),
    checkMonthlyBudget({ totalPaise, reservedPaise, budgetInr: settings.limits.monthlyBudgetInr }),
  ];
}

// send-only-when-approved: the order message goes out only for an order the owner approved (and so reserved budget for), to a supplier who is approved. The one gate every
// message that carries or repeats an order passes, so no path (a retry, a reminder, a later feature) can send one without the owner's approval.
export function checkSendOnlyWhenApproved(input: { approved: boolean; supplier: Supplier | undefined }): Decision {
  if (!input.approved) return block("send-only-when-approved", "The owner has not approved this order, so it is not sent to the supplier.");
  if (!input.supplier || !input.supplier.approved) return block("send-only-when-approved", "The supplier is not approved at the moment, so the order is not sent.");
  return allow("send-only-when-approved", "The owner approved this order and the supplier is approved.");
}
