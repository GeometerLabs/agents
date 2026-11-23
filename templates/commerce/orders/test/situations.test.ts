// The hand check's situations hold on each example shop, and say what they could not run.
import { goSkip } from "../../../../modules/crash-test/go-shop.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOn } from "../crash-test/situations.ts";
import { annapurna, annapurnaRazorpay, sweetCrumbs } from "../src/harness.ts";
import { notTestedOf } from "../crash-test/not-tested.ts";

/**
 * A finding of the hand check on Go (24 Nov 2026, go/TRIAL.md handcheck-go-24nov): on a Razorpay shop, the owner's message about a late payment that was refunded
 * (`owner_payment_unused`) has no approved WhatsApp template, so outside the owner's 24 hours the provider refuses it and the owner is not told. The demo engine's stand-in
 * approved every name, so it never showed. Pinned here as exactly that one failure: a new failure, or this one fixed (the template registered), changes this test.
 */
const OWNER_PAYMENT_UNUSED = ["A payment after the hold ended is taken again only if the cut-off, the stock and the day still allow it: (b) The owner was told; Every message the program sent was taken by the provider"];

for (const [name, settings, held, skipped, known] of [
  ["Annapurna Tiffins (UPI)", annapurna(), 17, 2, []],
  ["Annapurna Tiffins (Razorpay)", annapurnaRazorpay(), 18, 1, OWNER_PAYMENT_UNUSED],
  ["Sweet Crumbs Bakery (Razorpay, pickup only, no approval line)", sweetCrumbs(), 16, 3, OWNER_PAYMENT_UNUSED],
] as const) {
  test(`every situation holds on ${name}${known.length ? ", but the one the owner's untemplated message fails" : ""}`, { skip: goSkip("orders") }, async () => {
    const run = await runOn(settings);
    const failed = run.results.filter((r) => !r.held).map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => c.label).join("; ")}`);
    assert.deepEqual(failed, [...known]);
    assert.equal(run.results.length, held);
    assert.equal(run.skipped.length, skipped);
    assert.ok(run.skipped.every((s) => s.reason.length > 10));
  });
}

test("every owner language holds: the owner's replies are Latin-letter commands, so the checks read the template, not the language", { skip: goSkip("orders") }, async () => {
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
