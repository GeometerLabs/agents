// The sample report to take away (plan B66) and the month's work counts (plan B75): the committed copy in sample-report/ is exactly what the script makes again (as prices/
// does for the price list), the sample month holds each kind of thing it is meant to hold, and the cost per job is never given when nothing completed or the cost is unknown.
// Also "What this checks" (B67): every printed paper carries it, in its own language. NOT RUN when it was written (12 Nov 2026: the owner asked for the tests to be run once,
// together); the sample files were made by scripts/sample-report.ts and are what this compares against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_FOLDER, makeSampleReport } from "../scripts/sample-report.ts";
import { buildMonthlyReport } from "../report/data.ts";
import { runSampleMonth, at, sampleSettings } from "../report/sample-shop.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { verifyEnvelopeText } from "../../../../modules/report/sign.ts";
import { WHAT_THIS_CHECKS, whatThisChecksBlock } from "../../../../modules/report/what-this-checks.ts";
import { page } from "../../../../modules/report/page.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";

const build = async (cost?: { microInr: number; basis: string }) => {
  const { world } = await runSampleMonth();
  const { from, to } = monthRange("2026-11", world.settings.timezone);
  return { world, from, to, report: buildMonthlyReport({ settings: world.settings, entries: world.record.entries(), bookings: [...world.store.bookings.values()], from, to, source: "stand-in", madeAt: at(11, 30, 23, 5), ...(cost ? { cost } : {}) }) };
};

test("the committed sample report is what the script makes again, file for file", async () => {
  const out = mkdtempSync(join(tmpdir(), "sample-report-"));
  try {
    await makeSampleReport(out);
    const names = readdirSync(out).sort();
    assert.deepEqual(names, readdirSync(SAMPLE_FOLDER).sort(), "the same files");
    for (const name of names) assert.equal(readFileSync(join(out, name), "utf8"), readFileSync(join(SAMPLE_FOLDER, name), "utf8"), `${name} differs: run node templates/commerce/bookings/scripts/sample-report.ts, then public-web's npm run sample:pull`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("the sample month holds a held refund, an unresolved payment, abandoned conversations and owner-marked UPI payments, and the three counts add up", async () => {
  const { report: r } = await build();
  assert.equal(r.paidBy, "owner-marked");
  assert.deepEqual([r.work.jobs, r.work.completed, r.work.abandoned, r.work.unresolved], [11, 6, 3, 2]);
  assert.equal(r.work.completed + r.work.abandoned + r.work.unresolved, r.work.jobs);
  assert.equal(r.money.deposits.count, 7, "seven payments marked received by the owner");
  assert.equal(r.atReportTime.waitingForOwner, 1, "one refund is still waiting for the owner");
  assert.equal(r.work.costMicroInr, null, "no cost given: unknown, never 0");
  assert.equal(r.work.list.length, r.work.jobs, "every job is listed with its state");
  assert.deepEqual(r.work.list.filter((j) => j.state === "unresolved").map((j) => j.why).sort(), ["payment-not-marked", "refund-waiting-for-owner"]);
  assert.ok(r.work.list.every((j) => j.seqs.length > 0 && j.seqs.every((n) => r.record.rows.some((row) => row.seq === n))), "each job's entry numbers are rows of the report's own record");
});

test("a booking cancelled and refunded counts as completed; a refund held for the owner and a payment the owner has not marked are unresolved, whatever else the customer does", async () => {
  const { world } = await runSampleMonth();
  const entries = world.record.entries();
  const heldRefund = entries.find((e) => e.action === "refund" && e.outcome === "held_for_owner" && !entries.some((x) => x.action === "owner_decision" && x.booking === e.booking && x.seq > e.seq))!;
  const claim = entries.find((e) => e.action === "upi_paid_claim")!;
  const { report: r } = await build();
  assert.ok(heldRefund && claim);
  assert.equal(r.work.unresolved, new Set([heldRefund.booking, claim.booking]).size);
});

test("no cost per job when nothing completed, and none when the cost is not known; with both, the cost is divided by the completed jobs, rounded up", async () => {
  const settings = sampleSettings();
  const { from, to } = monthRange("2026-11", settings.timezone);
  const empty = (cost?: { microInr: number; basis: string }) => buildMonthlyReport({ settings, entries: [], bookings: [], from, to, source: "stand-in", madeAt: at(11, 30, 23), ...(cost ? { cost } : {}) });
  const none = empty({ microInr: 5_000_000, basis: "test" });
  assert.deepEqual([none.work.completed, none.work.costPerCompletedMicroInr, none.work.noUnitCost], [0, null, "no-completed-jobs"]);
  const { report: unknown } = await build();
  assert.deepEqual([unknown.work.completed > 0, unknown.work.costPerCompletedMicroInr, unknown.work.noUnitCost], [true, null, "cost-unknown"]);
  const { report: priced } = await build({ microInr: 8_413_400, basis: "test" });
  assert.equal(priced.work.costPerCompletedMicroInr, Math.ceil(8_413_400 / priced.work.completed));
  assert.equal(priced.work.noUnitCost, null);
});

test("the sample's signed JSON checks with its own public key and not as anyone else's", () => {
  const manifest = JSON.parse(readFileSync(join(SAMPLE_FOLDER, "manifest.json"), "utf8"));
  const text = readFileSync(join(SAMPLE_FOLDER, manifest.report.json), "utf8");
  const ok = verifyEnvelopeText(text, [manifest.keyId]);
  assert.ok(ok.unchanged && ok.trusted);
  assert.ok(!verifyEnvelopeText(text, [`key:${"0".repeat(64)}`]).trusted);
  assert.ok(!verifyEnvelopeText(text.replace('"completed":6', '"completed":7'), [manifest.keyId]).unchanged, "one changed figure no longer checks");
  assert.match(manifest.report.check, /^https:\/\/geometer\.dev\/verify\/#s1\./);
});

test("the report page shows completed, abandoned and unresolved beside the cost, says what completed means, and is self-contained", () => {
  const html = readFileSync(join(SAMPLE_FOLDER, "report-2026-11-en.html"), "utf8");
  for (const word of ["Completed", "Abandoned", "Unresolved", "Cost this month", "Cost per completed job", "Completed means the calendar"]) assert.ok(html.includes(word), word);
  assert.ok(!/<script|<link |<img|src=/.test(html), "one file: no script, link or image");
});

test("every printed paper carries What this checks in its own language, and the machine-written ones are marked", () => {
  for (const language of LANGUAGES) {
    const block = whatThisChecksBlock(language);
    assert.equal((block.match(/<dt>/g) ?? []).length, 3, language);
    const doc = page("t", "en", [`<section class="doc" lang="${language}"><h1>x</h1></section>`]);
    assert.ok(doc.includes(WHAT_THIS_CHECKS[language].lines[0][0]), `${language}: the section's own language`);
  }
  const both = page("t", "hi", [`<section class="doc" lang="hi">a</section>`, `<section class="doc" lang="en">b</section>`]);
  assert.equal((both.match(/class="what"/g) ?? []).length, 2, "one block in each language section");
  assert.ok(page("t", "ml", ["<section class=\"doc\">c</section>"]).includes(WHAT_THIS_CHECKS.ml.heading), "a section with no lang takes the page's");
});
