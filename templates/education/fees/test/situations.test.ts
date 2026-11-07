// The crash test, run: every situation is its own test, and the counts are pinned for both example centres (the bundle and the sell guide quote them).
// Each situation judges from the stand-ins' records, never from what the agent said (crash-test/situations.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { brightTuition } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { buildSituations, runOn, runSituation } from "../crash-test/situations.ts";

const maths = parseSettings(JSON.parse(readFileSync(new URL("../settings/maths-circle.example.json", import.meta.url), "utf8")));

/** The counts the docs and the sell guide quote. If a situation is added or one starts to be skipped, these change in the same commit. */
export const BRIGHT = { held: 26, total: 26, checks: 209, skipped: 0 };
export const MATHS = { held: 23, total: 23, skipped: 3 };

for (const s of buildSituations(brightTuition()).situations) {
  test(`situation: ${s.title}`, async () => {
    const r = await runSituation(s);
    assert.ok(r.held, r.checks.filter((c) => !c.passed).map((c) => `${c.label}: ${c.detail}`).join("\n"));
    assert.ok(r.checks.length >= 2, "a situation that checks little checks nothing");
  });
}

test("Bright Tuition Centre: every situation is expressible, and all hold", async () => {
  const run = await runOn(brightTuition());
  assert.equal(run.skipped.length, BRIGHT.skipped);
  assert.deepEqual([run.results.filter((r) => r.held).length, run.results.length], [BRIGHT.held, BRIGHT.total]);
  assert.equal(run.results.reduce((n, r) => n + r.checks.length, 0), BRIGHT.checks);
  assert.equal(new Set(run.results.map((r) => r.situation.id)).size, run.results.length, "ids are unique");
});

test("Gauss Maths Circle (no late fee, no waiver limit, no part payments, English and Kannada, first reminder in the month before): three situations cannot be expressed and are named, and the rest hold", async () => {
  const run = await runOn(maths);
  assert.deepEqual([run.results.filter((r) => r.held).length, run.results.length, run.skipped.length], [MATHS.held, MATHS.total, MATHS.skipped]);
  assert.deepEqual(run.skipped.map((s) => s.id).sort(), ["part-payment", "payment-after-late-fee", "waiver-within-limit"]);
  assert.ok(run.skipped.every((s) => s.reason.length > 20), "each says why");
});

test("the talk situations run once for each language the centre speaks, and say which in each check", async () => {
  const run = await runOn(maths);
  const claim = run.results.find((r) => r.situation.id === "claim-not-paid")!;
  assert.ok(claim.checks.some((c) => c.label.startsWith("[English]")) && claim.checks.some((c) => c.label.startsWith("[Kannada]")));
  assert.ok(!claim.checks.some((c) => c.label.startsWith("[Hindi]")), "a language the centre does not speak is not run");
  const bright = await runOn(brightTuition());
  const refund = bright.results.find((r) => r.situation.id === "refund-more-than-paid")!;
  for (const l of ["Hindi", "English", "Malayalam", "Kannada"]) assert.ok(refund.checks.some((c) => c.label.startsWith(`[${l}]`)), l);
});

test("the hand check script prints the result line and a line for each situation, the way the deploy bundle reads them", () => {
  const out = execFileSync(process.execPath, [new URL("../scripts/hand-check.ts", import.meta.url).pathname], { encoding: "utf8" });
  assert.match(out, new RegExp(`^  Held ${BRIGHT.held} of ${BRIGHT.total}\\.  0 failed\\.  \\d+ not tested\\.$`, "m"));
  assert.equal(out.split("\n").filter((l) => /^  ✓ /.test(l)).length, BRIGHT.total);
  assert.match(out, /Bright Tuition Centre · Fees · Hindi \+ English \+ Malayalam \+ Kannada/);
  const two = execFileSync(process.execPath, [new URL("../scripts/hand-check.ts", import.meta.url).pathname, "--settings", new URL("../settings/maths-circle.example.json", import.meta.url).pathname], { encoding: "utf8" });
  assert.match(two, new RegExp(`Held ${MATHS.held} of ${MATHS.total}\\.  0 failed\\.  \\d+ not tested\\.  ${MATHS.skipped} not run on these settings\\.`));
  assert.match(two, /NOT RUN on Gauss Maths Circle's settings \(3\)/);
});
