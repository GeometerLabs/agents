// ONE threshold. The agent's refund limit (rupees, settings) and Guard's call_bound_approval threshold (paise, generated) are the
// same value; a hundredfold slip between them is a silent fail-open (too high) or an owner approving every refund (too low).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseSettings } from "../src/settings.ts";
import { glowSalon } from "../src/harness.ts";
import { checkRefundLimit } from "../src/limits.ts";
import { APPROVAL_TTL_SECONDS, DEFAULT_CAPS, MAX_APPROVAL_TTL_SECONDS, guardHoldsRefund, razorpayLimitsSpec, razorpayNumbers, refundRulesOf, refundThresholdPaise, rupeesToPaise } from "../src/guard-limits.ts";

const withSettings = (changes: { refundLimitInr?: number; depositInr?: number }) => {
  const base = JSON.parse(JSON.stringify(glowSalon()));
  if (changes.refundLimitInr !== undefined) base.cancellation.refundLimitInr = changes.refundLimitInr;
  if (changes.depositInr !== undefined) base.deposit.amountInr = changes.depositInr;
  return parseSettings(base);
};
const IDENTITY = { tenant: "glow-salon", version: 1, reviewedBy: "builder-arjun" };

test("the refund limit in rupees becomes the threshold in paise: 200 rupees is \"20000\", not \"200\" and not \"2000000\"", () => {
  const spec = razorpayLimitsSpec(withSettings({ refundLimitInr: 200 }), IDENTITY);
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
    const spec = razorpayLimitsSpec(settings, IDENTITY);
    assert.equal(refundRulesOf(spec).thresholdPaise, BigInt(limit * 100));
    for (const amountInr of [1, limit - 1, limit, limit + 1, limit * 2 + 1].filter((a) => a >= 1)) {
      const agentHolds = checkRefundLimit({ amountInr, limitInr: settings.cancellation.refundLimitInr }).verdict === "hold_for_owner";
      assert.equal(guardHoldsRefund(spec, amountInr * 100), agentHolds, `limit ${limit}, refund ${amountInr}`);
    }
  }
  // and the paise either side of the line, which the agent never sends (refunds are whole rupees) but Guard would compare
  const spec = razorpayLimitsSpec(withSettings({ refundLimitInr: 200 }), IDENTITY);
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
    const rule = razorpayLimitsSpec(settings, IDENTITY).rules.find((r: any) => r.id === "deposit-amount");
    assert.equal(rule.min, String(depositInr * 100));
    assert.equal(rule.max, String(depositInr * 100));
  }
});

test("the daily refund cap can always cover one deposit; a cap that could not is refused when the spec is made", () => {
  const settings = withSettings({ depositInr: 250, refundLimitInr: 100 });
  assert.throws(() => razorpayLimitsSpec(settings, IDENTITY, { caps: { refundPaisePerDay: 24_999 } }), /smaller than one deposit/);
  const wide = razorpayLimitsSpec(settings, IDENTITY, { caps: { refundPaisePerDay: 1_000_000 } });
  assert.equal(wide.limits.find((l: any) => l.id === "refund-paise-per-day").cap, "1000000");
  assert.equal(razorpayLimitsSpec(withSettings({}), IDENTITY).limits.find((l: any) => l.id === "refund-paise-per-day").cap, String(DEFAULT_CAPS.refundPaisePerDay));
  assert.throws(() => razorpayNumbers(settings, { caps: { refundsPerDay: 0 } }), /whole number above zero/);
});

test("the approval time is in hours (24 by default), inside Guard's own bounds", () => {
  assert.equal(APPROVAL_TTL_SECONDS, 86_400);
  assert.equal(razorpayLimitsSpec(glowSalon(), IDENTITY).approval_ttl_seconds, 86_400);
  assert.equal(razorpayLimitsSpec(glowSalon(), IDENTITY, { approvalTtlSeconds: MAX_APPROVAL_TTL_SECONDS }).approval_ttl_seconds, 604_800);
  for (const bad of [59, 604_801, 1.5]) assert.throws(() => razorpayLimitsSpec(glowSalon(), IDENTITY, { approvalTtlSeconds: bad }), /between 60 and 604800/);
});

// The format rules of monorepo docs/guard-limits-spec.md that a wrong spec would break, checked here so a bad spec fails in this folder
// and not at `geo-guard compile`. (The real compiler is run in test/approvals-guard-binary.test.ts when the binary is there.)
test("the spec follows the format: only listed fields, amounts as strings, ids that exist, a rule on every operation it names", () => {
  const spec = razorpayLimitsSpec(glowSalon(), IDENTITY);
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
  assert.equal(JSON.stringify(razorpayLimitsSpec(glowSalon(), IDENTITY)), JSON.stringify(spec), "the same settings give the same bytes");
});

test("scripts/guard-spec.ts prints the spec for a client folder", () => {
  const out = execFileSync("node", [new URL("../scripts/guard-spec.ts", import.meta.url).pathname, "--client", new URL("../clients/glow-salon.example", import.meta.url).pathname, "--tenant", "glow-salon", "--reviewed-by", "builder-arjun"], { encoding: "utf8" });
  const spec = JSON.parse(out);
  assert.equal(spec.rules.find((r: any) => r.id === "refund-needs-owner").threshold, "20000");
});
