// The pure limits: approved supplier, quantity, cap, budget, one order per request, approval match, reply from the supplier, send only when approved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkApprovedSupplier, checkApprovalMatches, checkMonthlyBudget, checkOneOrderPerRequest, checkPerOrderCap, checkQuantity, checkReplyFromSupplier, checkSendOnlyWhenApproved, money } from "../src/limits.ts";
import { glowSalon } from "../src/harness.ts";

const s = glowSalon();

test("only an approved supplier on the list", () => {
  assert.equal(checkApprovedSupplier({ supplier: s.suppliers[0] }).verdict, "allow");
  assert.equal(checkApprovedSupplier({ supplier: s.suppliers[2] }).verdict, "block");
  assert.equal(checkApprovedSupplier({ supplier: undefined, named: "Sharma" }).verdict, "block");
});

test("quantity, cap and budget are checked in paise, and the limit itself is allowed", () => {
  assert.equal(checkQuantity({ qty: 0, maxQuantity: 10 }).verdict, "block");
  assert.equal(checkQuantity({ qty: 11, maxQuantity: 10 }).verdict, "block");
  assert.equal(checkPerOrderCap({ totalPaise: 1_200_000, capInr: 12000 }).verdict, "allow");
  assert.equal(checkPerOrderCap({ totalPaise: 1_200_001, capInr: 12000 }).verdict, "block");
  assert.equal(checkMonthlyBudget({ totalPaise: 500_000, reservedPaise: 1_500_000, budgetInr: 20000 }).verdict, "allow");
  assert.equal(checkMonthlyBudget({ totalPaise: 500_001, reservedPaise: 1_500_000, budgetInr: 20000 }).verdict, "block");
});

test("one order per request, approval match, supplier's own number, send only when approved", () => {
  assert.equal(checkOneOrderPerRequest({ requestId: "a", requests: new Map([["a", "po-1"]]) }).verdict, "block");
  assert.equal(checkOneOrderPerRequest({ requestId: "b", requests: new Map() }).verdict, "allow");
  assert.equal(checkApprovalMatches({ same: false }).verdict, "block");
  assert.equal(checkReplyFromSupplier({ from: "+919876500001", supplier: s.suppliers[0] }).verdict, "allow");
  assert.equal(checkReplyFromSupplier({ from: "+919876500009", supplier: s.suppliers[0] }).verdict, "block");
  assert.equal(checkSendOnlyWhenApproved({ approved: false, supplier: s.suppliers[0] }).verdict, "block");
  assert.equal(checkSendOnlyWhenApproved({ approved: true, supplier: s.suppliers[0] }).verdict, "allow");
});

test("money writes whole rupees plainly and others with two decimals", () => {
  assert.equal(money(4500), "₹4,500");
  assert.equal(money(175.5), "₹175.50");
});
