// The Orders setup form's logic (panel/orders.ts), without the pages: what a shop types becomes settings the Orders pathway accepts, what is wrong is said in the person's own
// language, a shop that exists is read back into the same form (its ids and its slots' own cut-offs kept), and the limits come out as the certificate's own lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSettings } from "../../../templates/commerce/orders/src/settings.ts";
import type { Settings } from "../../../templates/commerce/orders/src/settings.ts";
import { MAX_ITEMS, applyOrdersBusiness, applyOrdersRules, buildOrdersSettings, menuLine, newOrdersDraft, ordersDraftFromShop, ordersLimitLines, placesOf, slotLine } from "../orders.ts";
import { WORDS } from "../languages.ts";
import type { Template } from "../templates.ts";

const checked = validateSettings(JSON.parse(readFileSync(new URL("../../../templates/commerce/orders/settings/annapurna-tiffins.example.json", import.meta.url), "utf8")));
if (!checked.ok) throw new Error(checked.errors.join("; "));
const example: Settings = checked.settings;
const template: Template = { id: "orders", version: "0.1.0", setup: "orders", steps: ["business", "deposit", "languages", "accounts", "checks"], accounts: ["whatsapp", "payment"], folder: "", settingsExample: "" };
const en = WORDS.en;
const blank = () => newOrdersDraft("d1", "a1", template, example, "2026-11-05T00:00:00Z");

const business = { name: "Sunrise Tiffins", address: "12 Lake Road", menu: "Veg thali, 120, 12\nChicken meal, 160, 8\nCurd, 20, 30" };
const rules = {
  cutoffDays: "1", cutoffTime: "20:00", pickup: "12:00-13:00, lunch\n19:00-20:00, dinner", delivery: "12:30-13:30, lunch\n19:30-20:30", area: "Kakkanad, Edappally\nInfopark",
  advanceMode: "part", advancePercent: "50", holdMinutes: "30", maxPerDay: "8", maxItems: "10", daysAhead: "7", windowHours: "6", refund: "300", approveOver: "1000",
};

function filled() {
  const draft = blank();
  draft.ownerNumber = "+919876543210";
  assert.deepEqual(applyOrdersBusiness(draft, business, en).problems, []);
  assert.deepEqual(applyOrdersRules(draft, rules, en).problems, []);
  return draft;
}

test("a filled form becomes settings the Orders pathway accepts: item ids from the names, slot ids unique across pickup and delivery, the area from commas and lines", () => {
  const built = buildOrdersSettings(filled(), example);
  assert.ok(built.ok, built.ok ? "" : built.errors.join("; "));
  if (!built.ok) return;
  const s = built.settings as unknown as Settings;
  assert.equal(s.name, "Sunrise Tiffins");
  assert.deepEqual(s.menu.map((i) => [i.id, i.priceInr, i.dailyStock]), [["veg-thali", 120, 12], ["chicken-meal", 160, 8], ["curd", 20, 30]]);
  assert.deepEqual(s.pickup.slots.map((x) => [x.id, x.from, x.to]), [["lunch", "12:00", "13:00"], ["dinner", "19:00", "20:00"]]);
  assert.deepEqual(s.delivery?.slots.map((x) => x.id), ["lunch-2", "slot-4"], "a delivery lunch does not share the pickup lunch's id");
  assert.deepEqual(s.delivery?.area, ["Kakkanad", "Edappally", "Infopark"]);
  assert.deepEqual(s.advance, { mode: "part", percent: 50, holdMinutes: 30 });
  assert.deepEqual([s.orders.maxPerDay, s.orders.maxItemsPerOrder, s.orders.daysAhead, s.cancellation.windowHours, s.refund.limitInr, s.owner.approveOverInr], [8, 10, 7, 6, 300, 1000]);
  assert.deepEqual(s.owner, { whatsapp: "+919876543210", language: example.owner.language, approveOverInr: 1000 });
  assert.equal(s.payment.module, "upi", "until the accounts step has a UPI ID, the limits are worked out with a stand-in UPI ID, never as a gateway (B71)");
});

test("no delivery slots and no places is a shop that does not deliver; all of the order is an advance of the whole", () => {
  const draft = filled();
  assert.deepEqual(applyOrdersRules(draft, { ...rules, delivery: "", area: "", advanceMode: "full" }, en).problems, []);
  const built = buildOrdersSettings(draft, example);
  assert.ok(built.ok, built.ok ? "" : built.errors.join("; "));
  if (!built.ok) return;
  const s = built.settings as unknown as Settings;
  assert.equal(s.delivery, undefined);
  assert.equal(s.advance.mode, "full");
});

test("a shop that exists is read back into the same form: its ids and its slots' own cut-offs are kept, so its orders still find them", () => {
  const again = ordersDraftFromShop("d2", "a1", "orders", "annapurna", example, undefined, { schema: 1, receipts: {} } as never, "2026-11-05T00:00:00Z");
  assert.equal(again.form.name, "Annapurna Tiffins");
  const rebuilt = buildOrdersSettings(again, example);
  assert.ok(rebuilt.ok, rebuilt.ok ? "" : rebuilt.errors.join("; "));
  if (!rebuilt.ok) return;
  const s = rebuilt.settings as unknown as Settings;
  assert.deepEqual(s.menu.map((i) => i.id), example.menu.map((i) => i.id));
  assert.deepEqual(s.pickup.slots.map((x) => [x.id, x.cutoff]), example.pickup.slots.map((x) => [x.id, x.cutoff]));
  assert.deepEqual(s.delivery?.slots.map((x) => [x.id, x.cutoff]), example.delivery?.slots.map((x) => [x.id, x.cutoff]));
  assert.deepEqual(s.delivery?.area, example.delivery?.area);
  assert.deepEqual(s.payment, example.payment, "the UPI block it had is kept");
});

test("the lines of the form are read as written: a comma in a name, a rupee sign, a short clock time, the word 'to'", () => {
  assert.deepEqual(menuLine("Pav bhaji, large, ₹90, 15"), { name: "Pav bhaji, large", price: "90", stock: "15" });
  assert.equal(menuLine("just a name"), undefined);
  assert.deepEqual(slotLine("9:00 to 10:30, breakfast"), { from: "09:00", to: "10:30", name: "breakfast" });
  assert.deepEqual(slotLine("12:00-13:00"), { from: "12:00", to: "13:00", name: "" });
  assert.equal(slotLine("13:00-12:00"), undefined);
  assert.deepEqual(placesOf("Kakkanad, kakkanad,\nEdappally"), ["Kakkanad", "Edappally"]);
});

test("what is wrong with the first step is said once for each thing, in the person's language, with the line", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const { problems } = applyOrdersBusiness(blank(), { name: "", menu: "Thali, abc, 0\nthali, 10, 1\njust a name" }, WORDS[language]);
    assert.equal(problems.length, 5, `${language}: ${problems.join(" | ")}`);
    assert.ok(problems.every((p) => p.trim() !== "" && !p.includes("undefined")), `${language}: ${problems.join(" | ")}`);
    assert.equal(new Set(problems).size, problems.length, `${language}: no problem is said twice`);
  }
  assert.equal(applyOrdersBusiness(blank(), { ...business, menu: "" }, en).problems.length, 1, "no menu is one problem");
  const many = applyOrdersBusiness(blank(), { ...business, menu: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `Item ${i}, 10, 5`).join("\n") }, en);
  assert.deepEqual(many.problems, [en.setup.orders.problems.tooManyItems(MAX_ITEMS)]);
  assert.ok(many.problems[0].endsWith("Write to support. A person answers."));
});

test("the rules refuse what the pathway would, in each language: a slot that ends before it starts, places without slots, a part over 99, an order that could be refunded past the day's cap", () => {
  const draft = blank();
  applyOrdersBusiness(draft, business, en);
  const bad = { ...rules, pickup: "13:00-12:00", delivery: "", area: "Kakkanad", advancePercent: "100", maxItems: "100", cutoffDays: "9" };
  const said = applyOrdersRules(draft, bad, en);
  assert.equal(said.problems.length, 5, said.problems.join(" | "));
  assert.ok(said.problems.some((p) => p.includes("₹16,000") && p.includes("₹5,000")), "the largest order and the daily cap are named");
  for (const language of ["hi", "ml", "kn"] as const) {
    const p = applyOrdersRules(draft, bad, WORDS[language]).problems;
    assert.equal(p.length, 5, `${language}: ${p.join(" | ")}`);
    assert.ok(p.every((x) => x.trim() !== "" && !x.includes("undefined")));
  }
  assert.deepEqual(applyOrdersRules(draft, { ...rules, delivery: "12:30-13:30", area: "" }, en).problems, [en.setup.orders.problems.deliveryNeedsArea]);
});

test("the shop's limits are the certificate's own lines in each language, and nothing while the form does not build", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const lines = ordersLimitLines(filled(), example, language);
    assert.equal(lines.length, 9, `${language}: ${lines.join(" | ")}`);
    assert.ok(lines.some((l) => l.includes("₹160")) && lines.every((l) => !l.includes("undefined")));
  }
  assert.deepEqual(ordersLimitLines(blank(), example, "en"), []);
});
