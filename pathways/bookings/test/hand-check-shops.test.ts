// The hand check on a shop's own settings. The situations used to be written for Glow Salon alone; now they are built from
// whatever settings they are given (crash-test/shop.ts, crash-test/says.ts). These tests fix three things: that nothing
// changed for Glow Salon (the sentences REVIEW-ml.md and REVIEW-kn.md list, the day, the time, the price, the count), that the
// equipment-rental example holds on its own settings, and that settings which cannot express a situation say so instead of
// quietly running something else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseIntent } from "../src/adapters/rule-parser.ts";
import { glowSalon } from "../src/harness.ts";
import { parseSettings, validateSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { zonedToMs } from "../../../modules/core/time.ts";
import { SAYS, buildSituations, runOn } from "../crash-test/situations.ts";
import { sayingsFor } from "../crash-test/says.ts";
import { haggleOffer, planShop } from "../crash-test/shop.ts";

const SETTINGS_DIR = new URL("../settings/", import.meta.url);
const raw = (name: string) => JSON.parse(readFileSync(new URL(name, SETTINGS_DIR), "utf8"));
const rental = (): Settings => parseSettings(raw("equipment-rental.example.json"));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const SCRIPT = fileURLToPath(new URL("../scripts/hand-check.ts", import.meta.url));
const IST = "Asia/Kolkata";

test("what the situations type for Glow Salon is exactly what it always was (the sentences the review sheets list)", () => {
  const hash = createHash("sha256").update(JSON.stringify(SAYS)).digest("hex");
  assert.equal(hash, "09c5e7bc374eda53947fe773bf5e1d9744a18cc7212503f70220eb5f4b97a754", "SAYS changed: REVIEW-ml.md and REVIEW-kn.md list these sentences for a native reader");
});

test("the plan for Glow Salon is the one the situations were written with: tomorrow 6pm, next Tuesday 6pm, a haircut for ₹450, a haggle for ₹300", () => {
  const planned = planShop(glowSalon());
  assert.ok("shop" in planned);
  const { shop } = planned;
  assert.equal(shop.reviewed, true);
  const tomorrow = shop.pick();
  assert.equal(tomorrow?.startMs, zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 18, minute: 0 }, IST));
  const next = shop.nextWeekday(shop.today);
  const nextSlot = next ? shop.pick({ minOffset: 7, days: 1 }) : undefined;
  assert.equal(nextSlot?.startMs, zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 18, minute: 0 }, IST));
  assert.deepEqual([shop.priceInr, shop.depositInr, shop.offerInr, shop.service.id], [450, 200, 300, "haircut"]);
  assert.deepEqual(shop.listInr, [200, 250, 450, 900, 1800]);
  assert.deepEqual(shop.reminders, [24, 2]);
});

test("the sentences written for a shop are read the way the reviewed Glow Salon ones are: same service, price, day, time and trick", () => {
  const planned = planShop(glowSalon());
  assert.ok("shop" in planned);
  const { shop } = planned;
  const slot = shop.pick()!;
  const next = shop.pick({ minOffset: 7, days: 1 })!;
  const context = { services: shop.settings.services, languages: shop.settings.languages };
  for (const language of LANGUAGES) {
    const made = sayingsFor(language, { service: shop.service, slot, nextWeekday: next, offerInr: shop.offerInr, fullDate: SAYS[language].fullDate });
    for (const key of ["book", "haggle", "push", "trickFollowUp", "nextTuesday"] as const) {
      const a = parseIntent(made[key], context);
      const b = parseIntent(SAYS[language][key], context);
      assert.deepEqual(a, b, `${language} ${key}: "${made[key]}" is not read like "${SAYS[language][key]}"`);
    }
    assert.equal(made.cancel, SAYS[language].cancel);
    assert.equal(made.trick, SAYS[language].trick);
  }
});

test("Glow Salon still holds 37 of 37 with nothing left out, and the same run names no situation as not run", async () => {
  const run = await runOn();
  assert.equal(run.results.length, 37);
  assert.ok(run.results.every((r) => r.held));
  assert.deepEqual(run.skipped, []);
  assert.deepEqual(run.results.filter((r) => r.situation.leftOut).map((r) => r.situation.id), []);
  assert.equal(run.results.reduce((n, r) => n + r.checks.length, 0), 242);
});

test("the equipment-rental example is valid settings, and its situations hold on its own settings", async () => {
  const result = validateSettings(raw("equipment-rental.example.json"));
  assert.ok(result.ok, result.ok ? "" : result.errors.join("; "));
  const run = await runOn(rental());
  assert.deepEqual(run.skipped, []);
  assert.equal(run.results.length, 32);
  const failed = run.results.filter((r) => !r.held).map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => c.label).join("; ")}`);
  assert.deepEqual(failed, []);
  // a shop that is open every day has no closed day to ask for; the situation says so
  assert.deepEqual(run.results.filter((r) => r.situation.leftOut).map((r) => [r.situation.id, r.situation.leftOut]), [["outside-hours", ["a closed day: the shop is open every day"]]]);
  // only the languages the shop speaks are used
  const titles = run.results.map((r) => r.situation.title).join(" | ");
  assert.ok(titles.includes("Hindi") && titles.includes("Kannada") && !titles.includes("Malayalam") && !titles.includes("English"));
});

test("on the rental's own settings the checks use its service, its prices and times that are on its grid", async () => {
  const run = await runOn(rental());
  const text = run.results.flatMap((r) => r.checks.map((c) => c.label)).join("\n");
  for (const wanted of ["₹1,000", "₹3,200", "₹2,100"]) assert.ok(text.includes(wanted), wanted);
  for (const glow of ["₹200", "₹450", "₹300", "haircut"]) assert.ok(!text.includes(glow), `${glow} is Glow Salon's, not this shop's`);
  const booked = run.results.find((r) => r.situation.id === "booking-works")!;
  assert.ok(booked.checks.some((c) => c.label.includes("Wed 4 Nov, 2:00 pm")), "the grid has 2-hour steps from midnight, so 6pm is not a start for a 4-hour service closing at 6pm: 2pm is");
});

const VARIANTS: [string, string, (r: any) => void][] = [
  ["a salon with a smaller deposit and window", "glow-salon.example.json", (r) => { r.deposit.amountInr = 100; r.cancellation = { windowHours: 12, refundLimitInr: 150 }; }],
  ["a refund limit of nothing", "glow-salon.example.json", (r) => { r.cancellation.refundLimitInr = 0; }],
  ["closed on Wednesday and Thursday", "glow-salon.example.json", (r) => { r.openingHours.wed = null; r.openingHours.thu = null; }],
  ["reminders 48 and 3 hours before", "glow-salon.example.json", (r) => { r.reminders.hoursBefore = [48, 3]; }],
  ["one reminder, 1 hour before", "glow-salon.example.json", (r) => { r.reminders.hoursBefore = [1]; }],
  ["Hindi only", "glow-salon.example.json", (r) => { r.languages = ["hi"]; }],
  ["Malayalam first, then English", "glow-salon.example.json", (r) => { r.languages = ["ml", "en"]; }],
  ["15-minute slots, no gap", "glow-salon.example.json", (r) => { r.slotMinutes = 15; r.bufferMinutes = 0; }],
  ["open from 6 to 9 in the morning only", "glow-salon.example.json", (r) => { for (const d of Object.keys(r.openingHours)) if (r.openingHours[d]) r.openingHours[d] = { open: "06:00", close: "09:00" }; }],
  ["the rental with Sunday closed", "equipment-rental.example.json", (r) => { r.openingHours.sun = null; }],
  ["the rental with two reminders", "equipment-rental.example.json", (r) => { r.reminders.hoursBefore = [24, 12]; }],
  ["the rental with a refund limit below its deposit", "equipment-rental.example.json", (r) => { r.cancellation.refundLimitInr = 500; }],
  ["the rental with 4-hour slots on a 4-hour grid", "equipment-rental.example.json", (r) => { r.slotMinutes = 240; r.bufferMinutes = 0; for (const d of Object.keys(r.openingHours)) r.openingHours[d] = { open: "08:00", close: "20:00" }; }],
];

for (const [name, file, change] of VARIANTS) {
  test(`other settings: ${name}: whatever can be run holds, and nothing is run on someone else's settings`, async () => {
    const settings = parseSettings((() => { const r = clone(raw(file)); change(r); return r; })());
    const run = await runOn(settings);
    assert.ok(run.results.length >= 20, `only ${run.results.length} situations ran`);
    const failed = run.results.filter((r) => !r.held).map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => `${c.label} [${c.detail}]`).join("; ")}`);
    assert.deepEqual(failed, []);
    assert.equal(run.settings, settings);
    for (const s of run.skipped) assert.ok(s.reason.length > 20, `${s.id} is skipped without a reason`);
  });
}

test("settings with no cancellation window cannot be 'late': those three situations are named as not run, with the reason, and are not counted", async () => {
  const settings = parseSettings((() => { const r = clone(raw("glow-salon.example.json")); r.cancellation.windowHours = 0; return r; })());
  const { situations, skipped } = buildSituations(settings);
  assert.equal(situations.length, 34);
  assert.deepEqual(skipped.map((s) => s.id), ["cancel-after-window", "cancel-after-window-owner-ml", "cancel-after-window-owner-kn"]);
  assert.ok(skipped.every((s) => s.reason.includes("window is 0 hours")));
  // the customer who asks for more back than they paid still runs where it can: only its late half is left out, and it says so
  const more = situations.find((s) => s.id === "refund-more-than-paid");
  assert.equal(more?.leftOut?.length, 1);
  assert.ok(more?.leftOut?.[0].includes("window is 0 hours"));
});

test("a haggle price is never a number that shows up inside another amount", () => {
  const glow = glowSalon();
  assert.equal(haggleOffer(glow.services[0], [200, 250, 450, 900, 1800]), 300);
  // two thirds of 450 is 300, but a ₹3,000 price has "300" in it: another fraction is used instead
  const other = haggleOffer(glow.services[0], [200, 450, 3000]);
  assert.ok(other !== undefined && other !== 300 && other < 450 && other >= 25);
  // a price too small to haggle below: no number can be chosen, and the plan says so instead of guessing
  assert.equal(haggleOffer({ ...glow.services[0], priceInr: 26 }, [26]), undefined);
});

test("hand-check.ts --settings runs the situations on that shop, names the language pair, and fails on a file that is not settings", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const dir = mkdtempSync(join(tmpdir(), "geometer-hand-check-"));
  const rentalFile = fileURLToPath(new URL("equipment-rental.example.json", SETTINGS_DIR));
  const r = run("--settings", rentalFile);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("CRASH TEST   Hosahalli Farm Hiring Centre · Bookings · Hindi + Kannada"));
  assert.ok(r.stdout.includes("Held 32 of 32.  0 failed.  14 not tested."));
  assert.ok(r.stdout.includes("Parts left out of 1 situation(s)"));
  assert.ok(run("--settings", rentalFile, "--details").stdout.includes("left out: a closed day: the shop is open every day"));
  const noWindow = clone(raw("glow-salon.example.json"));
  noWindow.cancellation.windowHours = 0;
  writeFileSync(join(dir, "no-window.json"), JSON.stringify(noWindow));
  const skipped = run("--settings", join(dir, "no-window.json"));
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.ok(skipped.stdout.includes("Held 34 of 34.  0 failed.  14 not tested.  3 not run on these settings."));
  assert.ok(skipped.stdout.includes("NOT RUN on Glow Salon's settings (3), and not counted above:") && skipped.stdout.includes("- Cancellation after the window:"));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ name: "" }));
  const bad = run("--settings", join(dir, "bad.json"));
  assert.equal(bad.status, 64);
  assert.ok(bad.stderr.includes("The settings need fixing"));
  const plain = run();
  assert.equal(plain.status, 0);
  assert.ok(plain.stdout.includes("Held 37 of 37.  0 failed.  14 not tested.") && !plain.stdout.includes("not run on these settings"));
});

test("every language the rental speaks is one the situations can write in", () => {
  const spoken: Language[] = rental().languages;
  for (const l of spoken) assert.ok(LANGUAGES.includes(l));
  assert.deepEqual([...spoken].sort(), ["hi", "kn"]);
});
