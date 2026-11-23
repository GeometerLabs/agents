// The crash test, run: every situation is its own test, and the counts are pinned for both example centres (the bundle and the sell guide quote them).
// Each situation judges from the stand-ins' records, never from what the agent said (crash-test/situations.ts).
import { goSkip } from "../../../../modules/crash-test/go-shop.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { brightTuition } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { buildSituations, runOn, runSituation } from "../crash-test/situations.ts";

const maths = parseSettings(JSON.parse(readFileSync(new URL("../settings/maths-circle.example.json", import.meta.url), "utf8")));

/**
 * The counts on the Go program (24 Nov 2026). "The model is down" is not run (the program reads by its rules alone), and one situation fails by a finding of the hand check
 * on Go (go/TRIAL.md handcheck-go-24nov): on a Razorpay centre, when a fee is paid twice, the parent's messages about the extra payment go under the generic name outside the
 * parent's 24 hours, which the provider refuses (no approved WhatsApp template). Pinned: such a situation fails ONLY by the check that every send was taken.
 */
export const BRIGHT = { held: 24, total: 25, skipped: 1 };
export const KNOWN_ON_GO = new Set(["paid-twice"]);
export const PROVIDER_CHECK = "Every message the program sent was taken by the provider";
const failing = (run: Awaited<ReturnType<typeof runOn>>) => run.results.filter((r) => !r.held);
const onlyKnown = (run: Awaited<ReturnType<typeof runOn>>): string[] =>
  failing(run).filter((r) => !KNOWN_ON_GO.has(r.situation.id) || r.checks.some((c) => !c.passed && c.label !== PROVIDER_CHECK)).map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => `${c.label} ${c.detail}`).join("; ")}`);

for (const s of buildSituations(brightTuition()).situations) {
  test(`situation: ${s.title}`, { skip: goSkip("fees") }, async () => {
    const r = await runSituation(s);
    const wrong = r.checks.filter((c) => !c.passed && !(KNOWN_ON_GO.has(s.id) && c.label === PROVIDER_CHECK));
    assert.deepEqual(wrong.map((c) => `${c.label}: ${c.detail}`), []);
    assert.ok(r.checks.length >= 2, "a situation that checks little checks nothing");
  });
}

test("Bright Tuition Centre: every situation is expressible but the model's, and all hold but the known one", { skip: goSkip("fees") }, async () => {
  const run = await runOn(brightTuition());
  assert.deepEqual(run.skipped.map((s) => s.id), ["model-down"]);
  assert.deepEqual([run.results.filter((r) => r.held).length, run.results.length], [BRIGHT.held, BRIGHT.total]);
  assert.deepEqual(onlyKnown(run), []);
  assert.ok(run.results.reduce((n, r) => n + r.checks.length, 0) >= 200, "the checks are counted");
  assert.equal(new Set(run.results.map((r) => r.situation.id)).size, run.results.length, "ids are unique");
});

test("Gauss Maths Circle (no late fee, no waiver limit, no part payments, English and Kannada, first reminder in the month before): four situations cannot be expressed and are named, and the rest hold but the known one", { skip: goSkip("fees") }, async () => {
  const run = await runOn(maths);
  assert.deepEqual(run.skipped.map((s) => s.id).sort(), ["model-down", "part-payment", "payment-after-late-fee", "waiver-within-limit"]);
  assert.deepEqual(onlyKnown(run), []);
  assert.ok(run.skipped.every((s) => s.reason.length > 20), "each says why");
});

test("the talk situations run once for each language the centre speaks, and say which in each check", { skip: goSkip("fees") }, async () => {
  const run = await runOn(maths);
  const claim = run.results.find((r) => r.situation.id === "claim-not-paid")!;
  assert.ok(claim.checks.some((c) => c.label.startsWith("[English]")) && claim.checks.some((c) => c.label.startsWith("[Kannada]")));
  assert.ok(!claim.checks.some((c) => c.label.startsWith("[Hindi]")), "a language the centre does not speak is not run");
  const bright = await runOn(brightTuition());
  const refund = bright.results.find((r) => r.situation.id === "refund-more-than-paid")!;
  for (const l of ["Hindi", "English", "Malayalam", "Kannada"]) assert.ok(refund.checks.some((c) => c.label.startsWith(`[${l}]`)), l);
});

test("the hand check script prints the result line and a line for each situation, the way the deploy bundle reads them", { skip: goSkip("fees") }, () => {
  const out = execFileSync(process.execPath, [new URL("../scripts/hand-check.ts", import.meta.url).pathname], { encoding: "utf8" });
  assert.match(out, new RegExp(`^  Held ${BRIGHT.held} of ${BRIGHT.total}\\.  ${BRIGHT.total - BRIGHT.held} failed\\.  \\d+ not tested\\.  ${BRIGHT.skipped} not run on these settings\\.$`, "m"));
  assert.equal(out.split("\n").filter((l) => /^  [✓✗] /.test(l)).length, BRIGHT.total);
  assert.match(out, /Bright Tuition Centre · Fees · Hindi \+ English \+ Malayalam \+ Kannada/);
  assert.match(out, /ON THE SHOP'S OWN PROGRAM   Go fees/);
});
