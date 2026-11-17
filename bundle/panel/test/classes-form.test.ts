// The Classes part of the Fees phone form (item 7, 17 Nov 2026; fees.ts, words-classes.ts): the timetable box, its refusals in the person's language, and the Classes block it
// writes. A centre that already has Classes is edited without losing a thing: a timetable with different times on different days comes back as it was, and the block's lead
// minutes and file limit (which the form has no box for) stay. The class link and the teacher are not here: the teacher sends the link on WhatsApp from the owner's number
// (src/classes/state.ts), so the form has no field for either (bundle/panel/Deferred.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSettings } from "../../../templates/education/fees/src/settings.ts";
import type { Settings } from "../../../templates/education/fees/src/settings.ts";
import { applyFeesBusiness, buildFeesSettings, feesDraftFromShop, newFeesDraft, timetableLine } from "../fees.ts";
import { CLASSES_WORDS } from "../words-classes.ts";
import { KEEP } from "../keep.ts";
import { WORDS } from "../languages.ts";
import type { Template } from "../templates.ts";

const json = (path: string): any => JSON.parse(readFileSync(new URL(`../../../templates/education/fees/settings/${path}`, import.meta.url), "utf8"));
const must = (r: ReturnType<typeof validateSettings>): Settings => { assert.ok(r.ok, r.ok ? "" : r.errors.join("; ")); return (r as { settings: Settings }).settings; };
const meta = { schema: 1, receipts: {} } as never;
const template: Template = { id: "fees", version: "0.1.0", setup: "fees", steps: ["business", "deposit", "languages", "accounts", "character", "checks"], accounts: ["whatsapp", "payment"], folder: "", settingsExample: "" };
const en = WORDS.en;
const NOW = "2026-11-17T00:00:00Z";

/** The Classes example, with a batch whose two classes start at different times and a lead time and file limit the form has no box for. */
function saved(): any {
  const s = json("bright-tuition-classes.example.json");
  s.classes.timetable["class-10"] = [{ day: "mon", time: "17:00", minutes: 60 }, { day: "thu", time: "18:30", minutes: 90 }];
  s.classes.linkLeadMinutes = 45; s.classes.materialMaxMb = 20;
  return s;
}
const editing = (s: any) => feesDraftFromShop("d1", "a1", "fees", "bright-tuition", must(validateSettings(s)), undefined, meta, NOW);
const build = (d: ReturnType<typeof editing>, s: any) => buildFeesSettings(d, must(validateSettings(s)), s) as any;

test("one class on a line: the batch (which may hold a comma), the day, the start time and the minutes, which may be left out", () => {
  assert.deepEqual(timetableLine("Class 8, Mon, 16:00, 45"), { batch: "Class 8", day: "Mon", time: "16:00", minutes: "45" });
  assert.deepEqual(timetableLine("Class 8, Mon, 16:00"), { batch: "Class 8", day: "Mon", time: "16:00", minutes: "60" });
  assert.deepEqual(timetableLine("Maths, Class 8, thu, 9:30, 60"), { batch: "Maths, Class 8", day: "thu", time: "9:30", minutes: "60" });
  assert.equal(timetableLine("Class 8"), undefined);
  assert.equal(timetableLine(", Mon, 16:00"), undefined);
});

test("a centre that has Classes is read into the form and built again exactly as it was: different times on different days, the lead minutes and the file limit kept", () => {
  const s = saved();
  const original = must(validateSettings(s));
  const d = editing(s);
  assert.ok(d.fees!.timetable!.includes("कक्षा 10, Thu, 18:30, 90"), d.fees!.timetable);
  assert.equal(d.fees!.oldDuesStopLink, false);
  const built = build(d, s);
  assert.ok(built.ok, built.errors?.join("; "));
  assert.deepEqual(built.settings, original);
  assert.equal(built.settings.classes.linkLeadMinutes, 45);
  assert.equal(built.settings.classes.materialMaxMb, 20);
});

test("editing one class changes that class only; emptying the box drops the Classes block (the Operator took classes out)", () => {
  const s = saved();
  const d = editing(s);
  d.fees!.timetable = d.fees!.timetable!.replace("कक्षा 10, Thu, 18:30, 90", "कक्षा 10, Fri, 18:00, 60");
  const built = build(d, s);
  assert.ok(built.ok, built.errors?.join("; "));
  const slots = built.settings.classes.timetable["class-10"];
  assert.deepEqual(slots.map((x: any) => [x.day, x.hour, x.minute, x.minutes]), [[1, 17, 0, 60], [5, 18, 0, 60]]);
  assert.deepEqual(built.settings.classes.timetable["class-8"], must(validateSettings(s)).classes!.timetable["class-8"]);
  assert.equal(built.settings.classes.linkLeadMinutes, 45);

  const none = editing(s);
  none.fees!.timetable = "";
  const without = build(none, s);
  assert.ok(without.ok, without.errors?.join("; "));
  assert.equal(without.settings.classes, undefined);
  assert.ok(!JSON.stringify(without.raw).includes("classes"));
});

test("a new centre writes a Classes block with the template's defaults; with no lines it has none, as a Fees centre always was", () => {
  const example = must(validateSettings(json("bright-tuition.example.json")));
  const d = newFeesDraft("d1", "a1", template, example, NOW);
  d.ownerNumber = "+919876543210";
  const body = { name: "Sunrise Tuition", batch_name_0: "Class 8", batch_fee_0: "1200", batch_name_1: "Class 10", batch_fee_1: "1800", students: "Aarav Sharma, 98111 11111, Class 10", timetable: "Class 8, Mon, 16:00, 45\nclass 10, Tue, 9:30\nClass 10, Thu, 17:00, 60" };
  assert.deepEqual(applyFeesBusiness(d, body, en).problems, []);
  const built = buildFeesSettings(d, example) as any;
  assert.ok(built.ok, built.errors?.join("; "));
  assert.deepEqual(built.raw.classes.timetable, { "class-8": [{ day: "mon", time: "16:00", minutes: 45 }], "class-10": [{ day: "tue", time: "09:30", minutes: 60 }, { day: "thu", time: "17:00", minutes: 60 }] });
  assert.equal(built.settings.classes.linkLeadMinutes, 30);
  assert.equal(built.settings.classes.materialMaxMb, 10);
  assert.equal("oldDuesStopLink" in built.raw.classes, false, "off is written as nothing");

  const plain = newFeesDraft("d2", "a1", template, example, NOW);
  plain.ownerNumber = "+919876543210";
  assert.deepEqual(applyFeesBusiness(plain, { ...body, timetable: "" }, en).problems, []);
  const none = buildFeesSettings(plain, example) as any;
  assert.ok(none.ok);
  assert.equal(none.raw.classes, undefined);
});

test("the old-dues switch is written only when on, and the Fees block it belongs to is the form's own to keep or drop", () => {
  assert.deepEqual(KEEP.fees.objects, { classes: ["timetable", "oldDuesStopLink"] });
  const example = must(validateSettings(json("bright-tuition.example.json")));
  const d = newFeesDraft("d1", "a1", template, example, NOW);
  d.ownerNumber = "+919876543210";
  const body = { name: "Sunrise Tuition", batch_name_0: "Class 8", batch_fee_0: "1200", students: "Aarav Sharma, 98111 11111, Class 8", timetable: "Class 8, Mon, 16:00, 45", oldDuesStopLink: "on" };
  applyFeesBusiness(d, body, en);
  assert.equal(d.fees!.oldDuesStopLink, true);
  const built = buildFeesSettings(d, example) as any;
  assert.ok(built.ok, built.errors?.join("; "));
  assert.equal(built.raw.classes.oldDuesStopLink, true);
  assert.equal(built.settings.classes.oldDuesStopLink, true);
  d.fees!.oldDuesStopLink = false;
  assert.equal(("oldDuesStopLink" in (buildFeesSettings(d, example) as any).raw.classes), false);
});

test("what is wrong with a class line is said once for each thing, with its row, in the person's language; an empty box is fine", () => {
  const example = must(validateSettings(json("bright-tuition.example.json")));
  const batches = { name: "Sunrise", batch_name_0: "Class 8", batch_fee_0: "1200", students: "Aarav, 98111 11111, Class 8" };
  const lines = "Class 8\nClass 9, Mon, 16:00\nClass 8, Someday, 16:00\nClass 8, Mon, 25:00\nClass 8, Tue, 16:00, 5\nClass 8, Wed, 16:00, 45\nClass 8, Wed, 16:00, 45";
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const d = newFeesDraft("d1", "a1", template, example, NOW);
    const { problems } = applyFeesBusiness(d, { ...batches, timetable: lines }, WORDS[language]);
    assert.equal(problems.length, 6, `${language}: ${problems.join(" | ")}`);
    assert.ok(problems.every((p) => p.trim() !== "" && !p.includes("undefined")), `${language}: ${problems.join(" | ")}`);
    assert.equal(new Set(problems).size, problems.length, `${language}: no problem is said twice`);
    assert.deepEqual(applyFeesBusiness(newFeesDraft("d2", "a1", template, example, NOW), { ...batches, timetable: "" }, WORDS[language]).problems, []);
  }
  const many = applyFeesBusiness(newFeesDraft("d3", "a1", template, example, NOW), { ...batches, timetable: Array.from({ length: 61 }, (_, i) => `Class 8, Mon, ${String(i % 24).padStart(2, "0")}:00`).join("\n") }, en);
  assert.equal(many.problems.length, 1, "more than the box takes is said once");
});

test("the Classes words are in all four languages, each line whole", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const w = CLASSES_WORDS[language];
    const lines = [w.heading, w.label, w.help, w.linkNote, w.oldDues, w.oldDuesHelp, w.problems.tooMany(60), w.problems.lineBad(2), w.problems.batch(2, "Class 8"), w.problems.day(2), w.problems.time(2), w.problems.minutes(2), w.problems.twice(2)];
    assert.ok(lines.every((l) => l.trim() !== "" && !l.includes("undefined")), language);
  }
});
