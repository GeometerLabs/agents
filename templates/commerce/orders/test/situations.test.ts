// The hand check's situations hold on each example shop, and say what they could not run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOn } from "../crash-test/situations.ts";
import { annapurna, annapurnaRazorpay, sweetCrumbs } from "../src/harness.ts";
import { notTestedOf } from "../crash-test/not-tested.ts";

for (const [name, settings, held, skipped] of [
  ["Annapurna Tiffins (UPI)", annapurna(), 17, 2],
  ["Annapurna Tiffins (Razorpay)", annapurnaRazorpay(), 18, 1],
  ["Sweet Crumbs Bakery (Razorpay, pickup only, no approval line)", sweetCrumbs(), 16, 3],
] as const) {
  test(`every situation holds on ${name}`, async () => {
    const run = await runOn(settings);
    const failed = run.results.filter((r) => !r.held).map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => c.label).join("; ")}`);
    assert.deepEqual(failed, []);
    assert.equal(run.results.length, held);
    assert.equal(run.skipped.length, skipped);
    assert.ok(run.skipped.every((s) => s.reason.length > 10));
  });
}

test("every owner language holds: the owner's replies are Latin-letter commands, so the checks read the template, not the language", async () => {
  for (const language of ["hi", "ml", "kn"] as const) {
    const run = await runOn({ ...annapurna(), owner: { ...annapurna().owner, language } });
    assert.equal(run.results.filter((r) => !r.held).length, 0, language);
  }
});

test("what was not tested is named, and a UPI shop swaps the Razorpay lines for the UPI ones", () => {
  const upi = notTestedOf(annapurna()).map((n) => n.id);
  const rz = notTestedOf(annapurnaRazorpay()).map((n) => n.id);
  assert.ok(upi.includes("real-upi") && !upi.includes("real-razorpay"));
  assert.ok(rz.includes("real-razorpay") && !rz.includes("real-upi"));
  assert.ok(rz.includes("balance-at-pickup") && rz.includes("native-review"));
});
