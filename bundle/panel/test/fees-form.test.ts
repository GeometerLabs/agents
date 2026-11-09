// The Fees setup form's logic (panel/fees.ts), without the pages: what a centre types becomes settings the Fees pathway accepts, what is wrong is said in the person's own
// language, and the centre's limits come out as the same lines the go-live certificate prints. The pages and routes that use it are not built yet (bundle/Deferred.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSettings } from "../../../templates/education/fees/src/settings.ts";
import type { Settings } from "../../../templates/education/fees/src/settings.ts";
import { applyFeesBusiness, applyFeesRules, buildFeesSettings, feesDraftFromShop, feesLimitLines, MAX_STUDENTS, newFeesDraft } from "../fees.ts";
import { WORDS } from "../languages.ts";
import type { Template } from "../templates.ts";

const checked = validateSettings(JSON.parse(readFileSync(new URL("../../../templates/education/fees/settings/bright-tuition.example.json", import.meta.url), "utf8")));
if (!checked.ok) throw new Error(checked.errors.join("; "));
const example: Settings = checked.settings;
const template: Template = { id: "fees", version: "0.1.0", setup: "fees", steps: ["business", "deposit", "languages", "accounts", "checks"], accounts: ["whatsapp", "payment"], folder: "", settingsExample: "" };
const en = WORDS.en;

const business = {
  name: "Sunrise Tuition", address: "12 Lake Road",
  batch_name_0: "Class 8", batch_fee_0: "1200", batch_name_1: "Class 10", batch_fee_1: "1800",
  students: "Aarav Sharma, 98111 11111, Class 10\nMeera Nair, +91 98222 22222, class 8",
};
const rules = { dueDay: "5", graceDays: "5", lateFee: "100", reminderDays: "-3, 0, 5", reminderHour: "10", reminderMost: "4", partAllowed: "on", partMin: "300", waiver: "500", refund: "1200" };

function filled() {
  const draft = newFeesDraft("d1", "a1", template, example, "2026-11-05T00:00:00Z");
  draft.ownerNumber = "+919876543210";
  assert.deepEqual(applyFeesBusiness(draft, business, en).problems, []);
  assert.deepEqual(applyFeesRules(draft, rules, en).problems, []);
  return draft;
}

test("a filled form becomes settings the Fees pathway accepts: batch ids from the names, students tied to their batch, numbers made whole", () => {
  const built = buildFeesSettings(filled(), example);
  assert.ok(built.ok, built.ok ? "" : built.errors.join("; "));
  if (!built.ok) return;
  const s = built.settings as unknown as Settings;
  assert.equal(s.name, "Sunrise Tuition");
  assert.deepEqual(s.batches.map((b) => [b.id, b.monthlyFeeInr]), [["class-8", 1200], ["class-10", 1800]]);
  assert.deepEqual(s.students.map((x) => [x.name, x.parent, x.batchId]), [["Aarav Sharma", "+919811111111", "class-10"], ["Meera Nair", "+919822222222", "class-8"]]);
  assert.deepEqual([s.due.day, s.due.graceDays, s.lateFeeInr, s.waiver.limitInr, s.refund.limitInr], [5, 5, 100, 500, 1200]);
  assert.deepEqual(s.reminders.daysFromDue, [-3, 0, 5]);
  assert.deepEqual(s.owner, { whatsapp: "+919876543210", language: example.owner.language });
});

test("a centre that exists is read back into the same form, so changing it is the same steps", () => {
  const built = buildFeesSettings(filled(), example);
  assert.ok(built.ok);
  if (!built.ok) return;
  const again = feesDraftFromShop("d2", "a1", "fees", "sunrise-tuition", built.settings as unknown as Settings, undefined, { schema: 1, receipts: {} } as never, "2026-11-05T00:00:00Z");
  assert.equal(again.form.name, "Sunrise Tuition");
  const rebuilt = buildFeesSettings(again, example);
  assert.ok(rebuilt.ok, rebuilt.ok ? "" : rebuilt.errors.join("; "));
  if (rebuilt.ok) assert.deepEqual(rebuilt.settings, built.settings);
});

test("what is wrong with the first step is said once for each thing, in the person's language, with the row", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const w = WORDS[language];
    const draft = newFeesDraft("d1", "a1", template, example, "2026-11-05T00:00:00Z");
    const { problems } = applyFeesBusiness(draft, { name: "", batch_name_0: "", batch_fee_0: "12x", students: "Aarav, 12345, Class 10\nMeera, +919822222222, Class 99\nJust a name" }, w);
    assert.ok(problems.length >= 5, `${language}: ${problems.join(" | ")}`);
    assert.ok(problems.every((p) => p.trim() !== "" && !p.includes("undefined")), `${language}: ${problems.join(" | ")}`);
    assert.equal(new Set(problems).size, problems.length, `${language}: no problem is said twice`);
  }
  const none = applyFeesBusiness(newFeesDraft("d1", "a1", template, example, "2026-11-05T00:00:00Z"), { ...business, students: "" }, en);
  assert.equal(none.problems.length, 1, "no students is one problem");
  const many = applyFeesBusiness(newFeesDraft("d1", "a1", template, example, "2026-11-05T00:00:00Z"), { ...business, students: Array.from({ length: MAX_STUDENTS + 1 }, (_, i) => `S${i}, +91981111${String(i).padStart(4, "0")}, Class 8`).join("\n") }, en);
  assert.equal(many.problems.length, 1, "more than the form takes is said once, not once for each line");
});

test("the rules refuse what the pathway would: a due day past 28, a late fee above the cheapest fee, a waiver above the cheapest fee, two reminders on the same day", () => {
  const draft = newFeesDraft("d1", "a1", template, example, "2026-11-05T00:00:00Z");
  applyFeesBusiness(draft, business, en);
  const bad = applyFeesRules(draft, { ...rules, dueDay: "31", lateFee: "1201", waiver: "1201", reminderDays: "0, 0" }, en);
  assert.equal(bad.problems.length, 4, bad.problems.join(" | "));
  assert.ok(bad.problems.some((p) => p.includes("1,200")), "the cheapest fee is named as the cap");
  for (const language of ["hi", "ml", "kn"] as const) {
    const p = applyFeesRules(draft, { ...rules, dueDay: "31", reminderHour: "3" }, WORDS[language]).problems;
    assert.equal(p.length, 2, `${language}: ${p.join(" | ")}`);
    assert.ok(p.every((x) => x.trim() !== "" && !x.includes("undefined")));
  }
});

test("the centre's limits are the certificate's own lines in each language, and nothing while the form does not build", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const lines = feesLimitLines(filled(), example, language);
    assert.equal(lines.length, 9, `${language}: ${lines.join(" | ")}`);
    assert.ok(lines.some((l) => l.includes("1,800")) && lines.every((l) => !l.includes("undefined")));
  }
  assert.deepEqual(feesLimitLines(newFeesDraft("d1", "a1", template, example, "2026-11-05T00:00:00Z"), example, "en"), []);
});
