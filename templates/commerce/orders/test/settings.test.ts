// The settings: the examples are valid, and every mistake is said in plain words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { advanceFor, highestOrderInr, parseSettings, validateSettings } from "../src/settings.ts";
import { gatewayLimitsSpec, refundThresholdPaise } from "../src/guard-limits.ts";
import { annapurna } from "../src/harness.ts";

const dir = new URL("../settings/", import.meta.url);
const raw = () => JSON.parse(readFileSync(new URL("annapurna-tiffins.example.json", dir), "utf8"));
const errorsOf = (change: (s: any) => void): string[] => { const s = raw(); change(s); const r = validateSettings(s); return r.ok ? [] : r.errors; };

test("every example shop's settings are valid, and UPI is the default example", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".example.json"));
  assert.equal(files.length, 3);
  for (const f of files) assert.ok(validateSettings(JSON.parse(readFileSync(new URL(f, dir), "utf8"))).ok, f);
  assert.equal(annapurna().payment.module, "upi");
});

test("a mistake is said in plain words and all at once", () => {
  assert.match(errorsOf((s) => { s.menu[0].priceInr = 0; }).join(" "), /price in whole rupees/);
  assert.match(errorsOf((s) => { s.menu[0].dailyStock = "many"; }).join(" "), /most you make in a day/);
  assert.match(errorsOf((s) => { s.cutoff.time = "8pm"; }).join(" "), /24-hour time/);
  assert.match(errorsOf((s) => { s.pickup.slots[0].to = "11:00"; }).join(" "), /end after it starts/);
  assert.match(errorsOf((s) => { s.delivery.slots[0].id = "lunch"; }).join(" "), /own id/);
  assert.match(errorsOf((s) => { s.delivery.area = []; }).join(" "), /places you deliver to/);
  assert.match(errorsOf((s) => { s.advance = { mode: "part", percent: 100 }; }).join(" "), /between 1 and 99/);
  assert.match(errorsOf((s) => { delete s.payment; }).join(" "), /how customers pay/);
  assert.match(errorsOf((s) => { s.owner.whatsapp = "98000"; }).join(" "), /WhatsApp number/);
  assert.match(errorsOf((s) => { s.languages = ["hi", "en", "ml"]; }).join(" "), /Malayalam/);
  assert.match(errorsOf((s) => { s.surprise = 1; }).join(" "), /don't know what "surprise"/);
  assert.ok(errorsOf((s) => { s.menu[0].priceInr = 100; s.orders.maxItemsPerOrder = 100; }).join(" ").includes("refunded in a day"), "an order bigger than the daily refund cap is refused when the settings are checked");
  assert.throws(() => parseSettings({}), /need fixing/);
});

test("the advance is all of the order or a part of it, rounded up to a whole rupee, never 0 and never more than the total", () => {
  const s = annapurna();
  assert.equal(advanceFor(s, 240), 120);
  assert.equal(advanceFor(s, 5), 3);
  assert.equal(advanceFor({ ...s, advance: { mode: "full", percent: 100, holdMinutes: 30 } }, 240), 240);
});

test("Guard's numbers come from the settings: the refund threshold is the refund limit, links are bound to the dearest order the shop can take", () => {
  const s = annapurna();
  const spec = gatewayLimitsSpec(s, { tenant: "t", version: 1, reviewedBy: "x" });
  assert.equal(refundThresholdPaise(s), s.refund.limitInr * 100);
  const rule = (id: string) => spec.rules.find((r: any) => r.id === id);
  assert.equal(rule("refund-needs-owner").threshold, String(s.refund.limitInr * 100));
  assert.equal(rule("order-amount").max, String(highestOrderInr(s) * 100));
  assert.equal(highestOrderInr(s), 10 * 160);
  assert.ok(!JSON.stringify(spec).includes("encoding"), "the call's amounts are JSON numbers: the spec declares no text encoding");
});
