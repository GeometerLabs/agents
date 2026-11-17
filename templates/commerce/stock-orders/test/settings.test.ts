// The settings check: the example loads, and each plain-words problem is named. Run with node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSettings } from "../src/settings.ts";

const example = () => JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8"));

test("the example settings are valid", () => {
  const r = validateSettings(example());
  assert.ok(r.ok, r.ok ? "" : r.errors.join("; "));
});

test("a catalogue line naming an unknown supplier is refused in plain words", () => {
  const s = example();
  s.catalogue[0].supplier = "nobody";
  const r = validateSettings(s);
  assert.ok(!r.ok && r.errors.some((e) => e.includes("nobody")));
});

test("a price above the per-order cap, a cap above the budget and two suppliers on one number are refused", () => {
  const a = example(); a.limits.maxPerOrderInr = 100;
  assert.ok(!validateSettings(a).ok);
  const b = example(); b.limits.maxPerOrderInr = 50000;
  assert.ok(!validateSettings(b).ok);
  const c = example(); c.suppliers[1].whatsapp = c.suppliers[0].whatsapp;
  const r = validateSettings(c);
  assert.ok(!r.ok && r.errors.some((e) => e.includes("Two suppliers")));
});

test("a price with three decimals and follow-up hours out of order are refused", () => {
  const a = example(); a.catalogue[0].priceInr = 10.123;
  assert.ok(!validateSettings(a).ok);
  const b = example(); b.followUpHours = [24, 4];
  assert.ok(!validateSettings(b).ok);
});
