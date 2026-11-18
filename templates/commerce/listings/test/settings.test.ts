// A listings-only shop's settings: the shop's name, place, trade, languages and owner, and the two things the validator ALWAYS makes true because the rest of the system quietly
// switches the product off without them: an `assistant` block, and an owner with a `whatsapp` string (the marker when the owner gave no number).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_NUMBER, parseSettings, validateSettings } from "../src/settings.ts";

const base = { name: "Sree Pet Corner", place: { town: "Thrissur", pincode: "680001" }, trade: "pets", languages: ["en", "ml"], owner: { language: "ml" } };

test("the example file is a good shop", () => {
  const example = JSON.parse(readFileSync(new URL("../settings/shop.example.json", import.meta.url), "utf8"));
  assert.equal(validateSettings(example).ok, true);
});

test("an owner with no number is the marker, flagged, and the assistant is always on", () => {
  const s = parseSettings(base);
  assert.equal(s.owner.whatsapp, NO_NUMBER);
  assert.equal(s.owner.noNumber, true);
  assert.ok(s.assistant, "the assistant block is always there: core.ts drops listings for a shop without one");
  assert.equal(s.assistant.morningAt?.hour, 8);
});

test("an owner with a number keeps it, and a number that is not one is refused", () => {
  assert.equal(parseSettings({ ...base, owner: { language: "en", whatsapp: "+919812345678" } }).owner.whatsapp, "+919812345678");
  const bad = validateSettings({ ...base, owner: { language: "en", whatsapp: "98123" } });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.errors.join(" "), /phone number/u);
});

test("what is wrong is said in plain words, all at once", () => {
  const r = validateSettings({ name: "", place: { town: "", pincode: "012345" }, languages: ["xx"], owner: {}, extra: 1 });
  assert.equal(r.ok, false);
  const text = r.ok ? "" : r.errors.join("\n");
  for (const want of [/shop's name/u, /town/u, /pincode/u, /language/u, /"extra"/u]) assert.match(text, want);
});

test("nothing about money, WhatsApp or hours is a setting here", () => {
  for (const key of ["payment", "services", "deposit", "calendar", "suppliers", "limits"]) assert.equal(validateSettings({ ...base, [key]: {} }).ok, false, key);
});
