import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hoursOn, parseSettings, serviceName, validateSettings } from "../src/settings.ts";

const example = JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8"));
const copy = () => structuredClone(example);

function errorsFor(change: (s: any) => void): string[] {
  const s = copy();
  change(s);
  const r = validateSettings(s);
  assert.equal(r.ok, false, "expected the settings to be rejected");
  return r.ok ? [] : r.errors;
}

test("the Glow Salon example is valid and carries the numbers the product shows", () => {
  const s = parseSettings(example);
  assert.equal(s.name, "Glow Salon");
  assert.equal(s.services[0].priceInr, 450);
  assert.equal(s.deposit.amountInr, 200);
  assert.equal(s.deposit.holdMinutes, 15);
  assert.equal(serviceName(s.services[0], "hi"), "हेयरकट");
  assert.deepEqual(hoursOn(s, 2), { open: 600, close: 1200 }); // Tuesday
  assert.equal(hoursOn(s, 0), null); // Sunday is closed
});

test("defaults: time zone, hold length, languages and reminders", () => {
  const s = copy();
  delete s.timezone;
  delete s.languages;
  delete s.reminders;
  delete s.deposit.holdMinutes;
  const parsed = parseSettings(s);
  assert.equal(parsed.timezone, "Asia/Kolkata");
  assert.deepEqual(parsed.languages, ["hi", "en"]);
  assert.deepEqual(parsed.reminders.hoursBefore, [24, 2]);
  assert.equal(parsed.deposit.holdMinutes, 15);
});

test("a price with paise is refused, in plain words", () => {
  const errors = errorsFor((s) => { s.services[0].priceInr = 449.5; });
  assert.match(errors.join("\n"), /Service "haircut" needs a price in whole rupees/);
});

test("a deposit above the cheapest price is refused", () => {
  const errors = errorsFor((s) => { s.deposit.amountInr = 300; });
  assert.match(errors.join("\n"), /deposit \(₹300\) is more than the cheapest service \(₹250\)/);
});

test("opening hours must be real times and open before close", () => {
  const bad = errorsFor((s) => { s.openingHours.mon = { open: "25:00", close: "20:00" }; });
  assert.match(bad.join("\n"), /24-hour times/);
  const backwards = errorsFor((s) => { s.openingHours.tue = { open: "20:00", close: "10:00" }; });
  assert.match(backwards.join("\n"), /must be earlier than the closing time/);
});

test("a business closed every day is refused", () => {
  const errors = errorsFor((s) => { for (const k of Object.keys(s.openingHours)) s.openingHours[k] = null; });
  assert.match(errors.join("\n"), /closed every day/);
});

test("a language the business lists must have a name for every service", () => {
  const errors = errorsFor((s) => { delete s.services[1].names.hi; });
  assert.match(errors.join("\n"), /Service "beard-trim" needs at least one name in Hindi/);
});

test("two services cannot share a name", () => {
  const errors = errorsFor((s) => { s.services[1].names.en.push("haircut"); });
  assert.match(errors.join("\n"), /"haircut" is used by both/);
});

test("typos are caught instead of silently ignored", () => {
  const errors = errorsFor((s) => { s.depositt = {}; });
  assert.match(errors.join("\n"), /I don't know what "depositt" means/);
});

test("the owner's number needs a country code, and unknown time zones are named", () => {
  const phone = errorsFor((s) => { s.owner.whatsapp = "9000000000"; });
  assert.match(phone.join("\n"), /must start with \+ and the country code/);
  const zone = errorsFor((s) => { s.timezone = "Mars/Olympus"; });
  assert.match(zone.join("\n"), /"Mars\/Olympus" is not one I know/);
});

test("every problem is listed at once, not one at a time", () => {
  const errors = errorsFor((s) => { s.name = ""; s.slotMinutes = "half an hour"; s.cancellation.windowHours = -1; });
  assert.ok(errors.length >= 3, errors.join("\n"));
});

test("parseSettings throws one error that lists every problem", () => {
  assert.throws(() => parseSettings({}), /These settings need fixing/);
});

test("Malayalam and Kannada are supported languages; listing one needs a name for every service in it", () => {
  const ok = copy();
  ok.owner.language = "ml";
  const parsed = parseSettings(ok); // the example lists all four languages and names every service in each
  assert.deepEqual(parsed.languages, ["hi", "en", "ml", "kn"]);
  assert.equal(parsed.owner.language, "ml");
  assert.equal(serviceName(parsed.services[0], "ml"), "ഹെയർകട്ട്");
  assert.equal(serviceName(parsed.services[0], "kn"), "ಹೇರ್ ಕಟ್");

  const missing = errorsFor((s) => { delete s.services[0].names.ml; });
  assert.match(missing.join("\n"), /Service "haircut" needs at least one name in Malayalam \("ml"\)/);
  const kannada = errorsFor((s) => { delete s.services[2].names.kn; });
  assert.match(kannada.join("\n"), /Service "facial" needs at least one name in Kannada \("kn"\)/);
  const notListed = copy();
  notListed.languages = ["hi", "en"];
  delete notListed.services[0].names.ml;
  assert.doesNotThrow(() => parseSettings(notListed)); // a business that does not list Malayalam does not need Malayalam names
});

test("an unsupported language is named with the ones that are supported", () => {
  const language = errorsFor((s) => { s.languages = ["hi", "ta"]; });
  assert.match(language.join("\n"), /"ta" is not supported yet\. Use one of "hi" \(Hindi\), "en" \(English\), "ml" \(Malayalam\), "kn" \(Kannada\)/);
  const owner = errorsFor((s) => { s.owner.language = "ta"; });
  assert.match(owner.join("\n"), /owner's language .* must be one of "hi" \(Hindi\)/);
});

test("a service name in a language the business does not list is allowed (it is a synonym), but a typo in the language key is not", () => {
  const extra = copy();
  extra.services[0].names.kn = ["ಹೇರ್ ಕಟ್"];
  assert.doesNotThrow(() => parseSettings(extra));
  const typo = errorsFor((s) => { s.services[0].names.mal = ["x"]; });
  assert.match(typo.join("\n"), /I don't know what "mal" means/);
});
