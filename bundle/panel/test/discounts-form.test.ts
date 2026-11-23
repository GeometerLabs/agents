// E1's discount boxes in the phone setup (panel/discounts.ts, 24 Nov 2026): the Bookings deposit step and the Orders rules step. Off by default; a valid block is saved with its
// floors on the settings' own ids; every wrong box is refused with modules/limits/discounts.ts readDiscounts' own sentence (the one check the deployer uses); a Bookings floor
// below the deposit is refused; a shop being changed shows its block, loses it only when switched off, and a draft from before the boxes keeps it as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSettings as validateBookings } from "../../../templates/commerce/bookings/src/settings.ts";
import type { Settings as BookingsSettings } from "../../../templates/commerce/bookings/src/settings.ts";
import { validateSettings as validateOrders } from "../../../templates/commerce/orders/src/settings.ts";
import type { Settings as OrdersSettings } from "../../../templates/commerce/orders/src/settings.ts";
import { applyBusiness, applyDeposit, buildSettings, draftFromShop, newDraft } from "../setup.ts";
import type { Draft } from "../setup.ts";
import { applyOrdersBusiness, applyOrdersRules, buildOrdersSettings, newOrdersDraft, ordersDraftFromShop } from "../orders.ts";
import { DISCOUNT_WORDS } from "../discounts.ts";
import { WORDS } from "../languages.ts";
import type { Template } from "../templates.ts";

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../templates/${path}`, import.meta.url), "utf8"));
function must<T>(r: { ok: true; settings: T } | { ok: false; errors: string[] }): T { if (!r.ok) throw new Error(r.errors.join("; ")); return r.settings; }
const en = WORDS.en;
const NOW = "2026-11-24T00:00:00Z";
const tpl = (id: string): Template => ({ id, version: "0.1.0", setup: id === "orders" ? "orders" : undefined, steps: ["business", "deposit", "languages", "accounts", "checks"], accounts: ["whatsapp", "payment"], folder: "", settingsExample: "" } as Template);
const built = <T>(r: ReturnType<typeof buildSettings>): T => { assert.ok(r.ok, r.ok ? "" : r.errors.join("; ")); return (r as { settings: T }).settings; };
const PAY = { module: "upi", upiId: "shop@okicici", payee: "Test Shop" };

// ---- Bookings: the deposit step ---------------------------------------------------------------------------------------------------------

const salon = must(validateBookings(json("commerce/bookings/settings/glow-salon-upi.example.json")));
const STEP1 = { name: "Hosahalli Beauty", opens: "10:00", closes: "20:00", day_1: "on", svc_name_0: "Haircut", svc_price_0: "450", svc_minutes_0: "45", svc_name_1: "Facial", svc_price_1: "900", svc_minutes_1: "60" };
function salonDraft(): Draft {
  const d = newDraft("d1", "a1", tpl("bookings"), salon, NOW);
  assert.deepEqual(applyBusiness(d, STEP1, en).problems, []);
  d.ownerNumber = "+919876543210"; d.payment = PAY;
  return d;
}
const ON = { discountsOn: "on", capPercent: "10", capInr: "100" };

test("Bookings: off by default; the deposit step as before leaves the settings with no discounts block", () => {
  const d = salonDraft();
  assert.equal(d.discounts?.on, false);
  assert.deepEqual(applyDeposit(d, { deposit: "200", window: "24" }, en).problems, []);
  assert.equal(built<BookingsSettings>(buildSettings(d, salon)).discounts, undefined);
});

test("Bookings: a valid block is saved with its floors on the services' own ids, and a service with an empty box has no floor", () => {
  const d = salonDraft();
  assert.deepEqual(applyDeposit(d, { deposit: "200", window: "24", ...ON, floor_0: "400" }, en).problems, []);
  assert.deepEqual(built<BookingsSettings>(buildSettings(d, salon)).discounts, { capPercent: 10, capInr: 100, floors: { haircut: 400 } });
});

test("Bookings: each wrong box is refused with readDiscounts' own sentence, and what was typed stays", () => {
  const cases: [Record<string, string>, string][] = [
    [{ capPercent: "95" }, `The most the agent may take off alone, as a percentage ("discounts.capPercent"), must be a whole number from 0 to 90.`],
    [{ capPercent: "" }, `The most the agent may take off alone, as a percentage ("discounts.capPercent"), must be a whole number from 0 to 90.`],
    [{ capInr: "1.5" }, `The most the agent may take off alone, in rupees ("discounts.capInr"), must be a whole number from 0 to 100000.`],
    [{ floor_0: "" }, `"discounts.floors" must name at least one service and its lowest price in whole rupees, for example {"Haircut": 450}.`],
    [{ floor_0: "0" }, `The lowest price for "Haircut" ("discounts.floors") must be a whole number of rupees, 1 or more.`],
    [{ floor_0: "abc" }, `The lowest price for "Haircut" ("discounts.floors") must be a whole number of rupees, 1 or more.`],
    [{ floor_0: "500" }, `The lowest price for "Haircut" (₹500) is above its list price (₹450). It must be at or below the list price.`],
  ];
  for (const [change, sentence] of cases) {
    const d = salonDraft();
    const problems = applyDeposit(d, { deposit: "200", window: "24", ...ON, floor_0: "400", ...change }, en).problems;
    assert.deepEqual(problems, [sentence], JSON.stringify(change));
    assert.equal(d.discounts?.on, true, "the switch stays as it was typed");
  }
});

test("Bookings: a floor below the deposit is refused, because the deposit link is held to exactly the deposit", () => {
  const d = salonDraft();
  assert.deepEqual(applyDeposit(d, { deposit: "300", window: "24", ...ON, floor_0: "250" }, en).problems,
    [`The lowest price for "Haircut" (₹250) is below the deposit (₹300). Raise it to at least the deposit.`]);
});

test("Bookings: a shop being changed shows its block in the boxes; switched off, the block is gone; a draft from before the boxes keeps it as it was", () => {
  const d = salonDraft();
  applyDeposit(d, { deposit: "200", window: "24", ...ON, floor_1: "800" }, en);
  const saved = built<BookingsSettings>(buildSettings(d, salon));
  const edit = draftFromShop("d2", "a1", "bookings", "hosahalli-beauty", saved, undefined, {} as never, NOW);
  assert.deepEqual(edit.discounts, { on: true, capPercent: "10", capInr: "100", floors: { facial: "800" } });
  assert.deepEqual(built<BookingsSettings>(buildSettings(edit, salon, saved)).discounts, saved.discounts, "saved again unchanged");
  applyDeposit(edit, { deposit: "200", window: "24" }, en);
  assert.equal(built<BookingsSettings>(buildSettings(edit, salon, saved)).discounts, undefined, "the switch off takes the block out");
  const old = draftFromShop("d3", "a1", "bookings", "hosahalli-beauty", saved, undefined, {} as never, NOW);
  delete old.discounts;
  assert.deepEqual(built<BookingsSettings>(buildSettings(old, salon, saved)).discounts, saved.discounts);
});

// ---- Orders: the rules step -------------------------------------------------------------------------------------------------------------

const annapurna = must(validateOrders(json("commerce/orders/settings/annapurna-tiffins.example.json")));
const RULES = {
  cutoffDays: "1", cutoffTime: "20:00", pickup: "12:00-13:00, lunch", delivery: "", area: "", advanceMode: "part", advancePercent: "50", holdMinutes: "30",
  maxPerDay: "8", maxItems: "10", daysAhead: "7", windowHours: "6", refund: "300", approveOver: "1000",
};
function tiffinDraft(): Draft {
  const d = newOrdersDraft("d1", "a1", tpl("orders"), annapurna, NOW);
  assert.deepEqual(applyOrdersBusiness(d, { name: "Sunrise Tiffins", address: "", menu: "Veg thali, 120, 12\nCurd, 20, 30" }, en).problems, []);
  d.ownerNumber = "+919876543210"; d.payment = PAY;
  return d;
}

test("Orders: off by default; the rules step as before leaves the settings with no discounts block", () => {
  const d = tiffinDraft();
  assert.equal(d.discounts?.on, false);
  assert.deepEqual(applyOrdersRules(d, RULES, en).problems, []);
  assert.equal(built<OrdersSettings>(buildOrdersSettings(d, annapurna)).discounts, undefined);
});

test("Orders: a valid block is saved with its floors on the items' own ids", () => {
  const d = tiffinDraft();
  assert.deepEqual(applyOrdersRules(d, { ...RULES, ...ON, floor_0: "100" }, en).problems, []);
  assert.deepEqual(built<OrdersSettings>(buildOrdersSettings(d, annapurna)).discounts, { capPercent: 10, capInr: 100, floors: { "veg-thali": 100 } });
});

test("Orders: each wrong box is refused with readDiscounts' own sentence", () => {
  const cases: [Record<string, string>, string][] = [
    [{ capPercent: "91" }, `The most the agent may take off alone, as a percentage ("discounts.capPercent"), must be a whole number from 0 to 90.`],
    [{ capInr: "200000" }, `The most the agent may take off alone, in rupees ("discounts.capInr"), must be a whole number from 0 to 100000.`],
    [{ floor_0: "" }, `"discounts.floors" must name at least one item and its lowest price in whole rupees, for example {"Veg thali": 120}.`],
    [{ floor_0: "-5" }, `The lowest price for "Veg thali" ("discounts.floors") must be a whole number of rupees, 1 or more.`],
    [{ floor_0: "130" }, `The lowest price for "Veg thali" (₹130) is above its list price (₹120). It must be at or below the list price.`],
  ];
  for (const [change, sentence] of cases) {
    const d = tiffinDraft();
    assert.deepEqual(applyOrdersRules(d, { ...RULES, ...ON, floor_0: "100", ...change }, en).problems, [sentence], JSON.stringify(change));
  }
});

test("Orders: a shop being changed shows its block; a floor follows its item when lines move; switched off, the block is gone", () => {
  const d = tiffinDraft();
  applyOrdersRules(d, { ...RULES, ...ON, floor_1: "15" }, en);
  const saved = built<OrdersSettings>(buildOrdersSettings(d, annapurna));
  const edit = ordersDraftFromShop("d2", "a1", "orders", "sunrise-tiffins", saved, undefined, {} as never, NOW);
  assert.deepEqual(edit.discounts, { on: true, capPercent: "10", capInr: "100", floors: { curd: "15" } });
  // the Operator puts a new item first: the floor stays with Curd, not with the first line
  assert.deepEqual(applyOrdersBusiness(edit, { name: "Sunrise Tiffins", address: "", menu: "Dosa, 60, 10\nVeg thali, 120, 12\nCurd, 20, 30" }, en).problems, []);
  assert.deepEqual(built<OrdersSettings>(buildOrdersSettings(edit, annapurna, saved)).discounts?.floors, { curd: 15 });
  applyOrdersRules(edit, RULES, en);
  assert.equal(built<OrdersSettings>(buildOrdersSettings(edit, annapurna, saved)).discounts, undefined);
});

test("the boxes' words are in the four languages, each with every line", () => {
  for (const l of ["hi", "ml", "kn"] as const) assert.deepEqual(Object.keys(DISCOUNT_WORDS[l]), Object.keys(DISCOUNT_WORDS.en), l);
});
