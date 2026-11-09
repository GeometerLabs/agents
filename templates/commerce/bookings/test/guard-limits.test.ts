// ONE threshold. The agent's refund limit (rupees, settings) and Guard's call_bound_approval threshold (paise, generated) are the
// same value; a hundredfold slip between them is a silent fail-open (too high) or an owner approving every refund (too low).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseSettings } from "../src/settings.ts";
import { glowSalon } from "../src/harness.ts";
import { checkRefundLimit } from "../src/limits.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { gatewayLimitsSpec, paymentNumbers, refundThresholdPaise } from "../src/guard-limits.ts";
import { APPROVAL_TTL_SECONDS, DEFAULT_CAPS, MAX_APPROVAL_TTL_SECONDS, guardHoldsRefund, guardRefusesRefund, refundRulesOf, rupeesToPaise } from "../../../../modules/payments/guard-limits.ts";

const withSettings = (changes: { refundLimitInr?: number; depositInr?: number }) => {
  const base = JSON.parse(JSON.stringify(glowSalon()));
  if (changes.refundLimitInr !== undefined) base.cancellation.refundLimitInr = changes.refundLimitInr;
  if (changes.depositInr !== undefined) base.deposit.amountInr = changes.depositInr;
  return parseSettings(base);
};
const IDENTITY = { tenant: "glow-salon", version: 1, reviewedBy: "builder-arjun" };

test("the refund limit in rupees becomes the threshold in paise: 200 rupees is \"20000\", not \"200\" and not \"2000000\"", () => {
  const spec = gatewayLimitsSpec(withSettings({ refundLimitInr: 200 }), IDENTITY);
  const rule = spec.rules.find((r: any) => r.id === "refund-needs-owner");
  assert.deepEqual(rule, { id: "refund-needs-owner", kind: "call_bound_approval", operation: "refund", amount_field: "amount", threshold: "20000", units: { amount: "paise" } });
  assert.equal(typeof rule.threshold, "string", "amounts in a spec are strings: a number is refused by the compiler");
  assert.equal(refundThresholdPaise(withSettings({ refundLimitInr: 200 })), 20_000);
  assert.equal(rupeesToPaise(1), 100);
  assert.equal(rupeesToPaise(0), 0);
});

test("the agent holds a refund exactly when Guard would: at the limit both let it through, one rupee above both hold", () => {
  for (const limit of [0, 1, 99, 100, 199, 200, 201, 500, 5_000, 1_000_000]) {
    const settings = withSettings({ refundLimitInr: limit });
    const spec = gatewayLimitsSpec(settings, IDENTITY);
    assert.equal(refundRulesOf(spec).thresholdPaise, BigInt(limit * 100));
    for (const amountInr of [1, limit - 1, limit, limit + 1, limit * 2 + 1].filter((a) => a >= 1)) {
      const agentHolds = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr }).verdict === "hold_for_owner";
      assert.equal(guardHoldsRefund(spec, amountInr * 100), agentHolds, `limit ${limit}, refund ${amountInr}`);
    }
  }
  // and the paise either side of the line, which the agent never sends (refunds are whole rupees) but Guard would compare
  const spec = gatewayLimitsSpec(withSettings({ refundLimitInr: 200 }), IDENTITY);
  assert.deepEqual([guardHoldsRefund(spec, 19_999), guardHoldsRefund(spec, 20_000), guardHoldsRefund(spec, 20_001)], [false, false, true]);
});

test("a rupee amount that is not a whole number is refused, never rounded", () => {
  assert.throws(() => rupeesToPaise(150.5), /whole number of rupees/);
  assert.throws(() => rupeesToPaise(-1), /whole number of rupees/);
  assert.throws(() => rupeesToPaise(Number.MAX_SAFE_INTEGER), /too large/);
});

test("the deposit bound is the settings' deposit and nothing else, so a link for the deposit is never refused and any other amount is", () => {
  for (const depositInr of [1, 200, 250]) {
    const settings = withSettings({ depositInr, refundLimitInr: 100 });
    const rule = gatewayLimitsSpec(settings, IDENTITY).rules.find((r: any) => r.id === "deposit-amount");
    assert.equal(rule.min, String(depositInr * 100));
    assert.equal(rule.max, String(depositInr * 100));
  }
});

test("a refund is bounded by the settings' deposit, from 1 paisa: the same number that bounds the payment link", () => {
  for (const depositInr of [1, 200, 250]) {
    const spec = gatewayLimitsSpec(withSettings({ depositInr, refundLimitInr: 100 }), IDENTITY);
    const rule = spec.rules.find((r: any) => r.id === "refund-at-most-deposit");
    assert.deepEqual(rule, { id: "refund-at-most-deposit", kind: "argument_bound", operation: "refund", field: "amount", min: "1", max: String(depositInr * 100), units: { amount: "paise" } });
    assert.equal(typeof rule.max, "string", "amounts in a spec are strings");
    assert.equal(rule.max, spec.rules.find((r: any) => r.id === "deposit-amount").max, "a refund can be as large as the one payment the link allowed, and no larger");
    assert.equal(refundRulesOf(spec).bound.maxPaise, BigInt(depositInr * 100));
    // the words are Guard's own: equal to the deposit passes, a paisa either side is refused
    assert.equal(guardRefusesRefund(spec, depositInr * 100), undefined);
    assert.equal(guardRefusesRefund(spec, 1), undefined);
    assert.match(guardRefusesRefund(spec, depositInr * 100 + 1) ?? "", /^refund-at-most-deposit: amount \d+ is above the highest allowed value, \d+$/);
    assert.match(guardRefusesRefund(spec, 0) ?? "", /below the lowest allowed value, 1$/);
  }
});

// Guard decides every rule on a call separately and adds them up: any refusal refuses, otherwise any hold holds (monorepo adapters/boundaries/guard
// src/engine.rs `fold_evals`). So the bound wins over the owner's hold. The model has to say the same, and the real binary is asked in
// approvals-guard-binary.test.ts.
test("the Guard model refuses a refund above the deposit even when it is also above the owner's limit: no hold, nobody asked, and the once-only record is untouched", () => {
  const spec = gatewayLimitsSpec(withSettings({ depositInr: 200, refundLimitInr: 100 }), IDENTITY); // the owner's limit (₹100) is below the deposit (₹200)
  const model = createGuardModel(spec, fakeClock(0));
  const call = (amount: number, payment = "pay_a") => model.decideRefund(payment, { amount, receipt: `b-1:${payment}` });
  const above = call(20_001);
  assert.deepEqual(above, { kind: "refused", ruleId: "refund-at-most-deposit", reason: "refund-at-most-deposit: amount 20001 is above the highest allowed value, 20000" });
  assert.deepEqual(model.approvals(), [], "no approval was made, so the owner is not asked");
  assert.equal(call(500_000).kind, "refused");
  assert.equal(call(0).kind, "refused");
  assert.equal(call(-100).kind, "refused");
  assert.deepEqual(model.approvals(), []);
  // the deposit itself is above the owner's limit, so it is held for the owner as before
  assert.equal(call(20_000).kind, "hold");
  assert.equal(model.approvals().length, 1);
  // and with the owner's limit above the deposit, the deposit goes straight through, and a paisa more does not
  const roomy = createGuardModel(gatewayLimitsSpec(withSettings({ depositInr: 200, refundLimitInr: 500 }), IDENTITY), fakeClock(0));
  assert.equal(roomy.decideRefund("pay_a", { amount: 20_001, receipt: "b-1:pay_a" }).kind, "refused");
  assert.equal(roomy.decideRefund("pay_a", { amount: 20_000, receipt: "b-1:pay_a" }).kind, "pass", "the refused call did not use up the once-only record of the payment");
});

test("the daily refund cap can always cover one deposit; a cap that could not is refused when the spec is made", () => {
  const settings = withSettings({ depositInr: 250, refundLimitInr: 100 });
  assert.throws(() => gatewayLimitsSpec(settings, IDENTITY, { caps: { refundPaisePerDay: 24_999 } }), /smaller than one deposit/);
  const wide = gatewayLimitsSpec(settings, IDENTITY, { caps: { refundPaisePerDay: 1_000_000 } });
  assert.equal(wide.limits.find((l: any) => l.id === "refund-paise-per-day").cap, "1000000");
  assert.equal(gatewayLimitsSpec(withSettings({}), IDENTITY).limits.find((l: any) => l.id === "refund-paise-per-day").cap, String(DEFAULT_CAPS.refundPaisePerDay));
  assert.throws(() => paymentNumbers(settings, { caps: { refundsPerDay: 0 } }), /whole number above zero/);
});

test("the approval time is in hours (24 by default), inside Guard's own bounds", () => {
  assert.equal(APPROVAL_TTL_SECONDS, 86_400);
  assert.equal(gatewayLimitsSpec(glowSalon(), IDENTITY).approval_ttl_seconds, 86_400);
  assert.equal(gatewayLimitsSpec(glowSalon(), IDENTITY, { approvalTtlSeconds: MAX_APPROVAL_TTL_SECONDS }).approval_ttl_seconds, 604_800);
  for (const bad of [59, 604_801, 1.5]) assert.throws(() => gatewayLimitsSpec(glowSalon(), IDENTITY, { approvalTtlSeconds: bad }), /between 60 and 604800/);
});

// The format rules of monorepo docs/guard-limits-spec.md that a wrong spec would break, checked here so a bad spec fails in this folder
// and not at `geo-guard compile`. (The real compiler is run in test/approvals-guard-binary.test.ts when the binary is there.)
test("the spec follows the format: only listed fields, amounts as strings, ids that exist, a rule on every operation it names", () => {
  const spec = gatewayLimitsSpec(glowSalon(), IDENTITY);
  assert.deepEqual(Object.keys(spec).sort(), ["approval_ttl_seconds", "fail_policy", "intents", "limits", "name", "reviewed_by", "routes", "rules", "schema", "tenant", "tool", "version"]);
  const operations = new Set(spec.routes.map((r: any) => r.operation));
  const allowedByKind: Record<string, string[]> = {
    argument_bound: ["id", "kind", "operation", "field", "min", "max", "units"],
    call_bound_approval: ["id", "kind", "operation", "amount_field", "threshold", "units"],
    at_most_once_effect: ["id", "kind", "operation"],
    forbidden_call: ["id", "kind", "operation"],
  };
  const ids = new Set<string>();
  for (const rule of spec.rules) {
    assert.ok(operations.has(rule.operation), `${rule.id} names an operation with no route`);
    assert.ok(Object.keys(rule).every((k) => allowedByKind[rule.kind].includes(k)), `${rule.id} has a field the format does not list`);
    for (const key of ["min", "max", "threshold"]) if (key in rule) assert.match(rule[key], /^(0|[1-9]\d*)(\.\d+)?$/);
    assert.ok(!ids.has(rule.id)); ids.add(rule.id);
  }
  for (const limit of spec.limits) {
    assert.ok(operations.has(limit.operation));
    assert.match(limit.cap, /^[1-9]\d*$/, "a cap is a whole number above zero");
    assert.ok(!ids.has(limit.id)); ids.add(limit.id);
  }
  assert.ok(spec.rules.some((r: any) => r.kind === "at_most_once_effect" && r.operation === "refund") && spec.intents.some((i: any) => i.operation === "refund"), "at_most_once_effect needs its intent");
  assert.equal(JSON.stringify(gatewayLimitsSpec(glowSalon(), IDENTITY)), JSON.stringify(spec), "the same settings give the same bytes");
});

test("scripts/guard-spec.ts prints the spec for a client folder", () => {
  const out = execFileSync("node", [new URL("../scripts/guard-spec.ts", import.meta.url).pathname, "--client", new URL("../clients/glow-salon.example", import.meta.url).pathname, "--tenant", "glow-salon", "--reviewed-by", "builder-arjun"], { encoding: "utf8" });
  const spec = JSON.parse(out);
  assert.equal(spec.rules.find((r: any) => r.id === "refund-needs-owner").threshold, "20000");
});
