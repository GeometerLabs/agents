// The phone form never drops what it does not show (item 7, 17 Nov 2026; keep.ts). For each template that has a phone form (Bookings, Fees, Orders, Stock orders): a saved shop
// with every optional block the form has no box for is read into the form, one field is edited, the shop is built again as the save route does (the form, the saved settings as
// written, then the template's own validateSettings), and everything but the edited field is exactly as it was. A removed student, item or slot takes its hidden fields with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSettings as validateBookings } from "../../../templates/commerce/bookings/src/settings.ts";
import { validateSettings as validateFees } from "../../../templates/education/fees/src/settings.ts";
import { validateSettings as validateOrders } from "../../../templates/commerce/orders/src/settings.ts";
import { validateSettings as validateStock } from "../../../templates/commerce/stock-orders/src/settings.ts";
import { MAX_SERVICES } from "../../../templates/commerce/bookings/demo/personalise.ts";
import { buildSettings, draftFromShop } from "../setup.ts";
import { buildFeesSettings, feesDraftFromShop, MAX_BATCHES } from "../fees.ts";
import { buildOrdersSettings, ordersDraftFromShop } from "../orders.ts";
import { buildStockSettings, stockDraftFromShop } from "../stock.ts";
import { KEEP, keepHidden, pairStudents } from "../keep.ts";

const json = (path: string): any => JSON.parse(readFileSync(new URL(`../../../templates/${path}`, import.meta.url), "utf8"));
const meta = { schema: 1, receipts: {} } as never;
const NOW = "2026-11-17T00:00:00Z";
const must = <T>(r: { ok: true; settings: T } | { ok: false; errors: string[] }): T => { assert.ok(r.ok, r.ok ? "" : r.errors.join("; ")); return (r as { settings: T }).settings; };

test("the forms' room for batches and services is the number keep.ts says is shown", () => {
  assert.equal(KEEP.bookings.lists!.services.shown, MAX_SERVICES);
  assert.equal(KEEP.fees.lists!.batches.shown, MAX_BATCHES);
});

// ---- keepHidden itself -------------------------------------------------------------------------------------------------------------------------

test("keepHidden: a key the form owns and no longer writes is deleted, a key it does not own is kept, a key nobody here knows is kept", () => {
  const saved = { name: "A", address: "old", futureBlock: { x: 1 }, delivery: { slots: [], area: ["Z"] } };
  const out = keepHidden({ name: "B" }, saved, { owned: ["name", "address", "delivery"] }) as Record<string, unknown>;
  assert.deepEqual(out, { name: "B", futureBlock: { x: 1 } });
});

test("keepHidden: a list entry the form writes keeps the saved keys it does not write, matched by id; a removed entry is simply not there", () => {
  const spec = { owned: ["items"], lists: { items: { owned: ["id", "price"] } } };
  const saved = { items: [{ id: "a", price: 1, secret: "kept" }, { id: "b", price: 2, secret: "gone with b" }] };
  const out = keepHidden({ items: [{ id: "a", price: 5 }, { id: "c", price: 9 }] }, saved, spec) as { items: Record<string, unknown>[] };
  assert.deepEqual(out.items, [{ id: "a", price: 5, secret: "kept" }, { id: "c", price: 9 }]);
  assert.ok(!JSON.stringify(out).includes("gone with b"));
});

test("keepHidden: an entry kept even when the entry's saved language is no longer offered falls back to the form's", () => {
  const spec = { owned: ["students", "languages"], lists: { students: { owned: ["name"], prefer: ["language"], pair: pairStudents } } };
  const saved = { languages: ["en", "ml"], students: [{ name: "A", parent: "+911", batch: "b", language: "ml" }] };
  const out = keepHidden({ languages: ["en"], students: [{ name: "A", parent: "+911", batch: "b", language: "en" }] }, saved, spec) as { students: Record<string, unknown>[] };
  assert.equal(out.students[0].language, "en");
});

test("pairStudents: the same name and number; a corrected number or a corrected spelling still finds the student; two possible matches find none", () => {
  const saved = [{ name: "Meera Nair", parent: "+911", batch: "b9" }, { name: "Aarav", parent: "+912", batch: "b10" }, { name: "Anaya", parent: "+912", batch: "b10" }];
  const built = [{ name: "meera nair", parent: "+911", batch: "b9" }];
  assert.equal(pairStudents(built, saved)[0], saved[0]);
  assert.equal(pairStudents([{ name: "Meera Nair", parent: "+919", batch: "b9" }], saved)[0], saved[0], "number corrected");
  assert.equal(pairStudents([{ name: "Meera Nayar", parent: "+911", batch: "b9" }], saved)[0], saved[0], "spelling corrected");
  assert.equal(pairStudents([{ name: "Aryan", parent: "+912", batch: "b10" }], saved)[0], undefined, "two siblings fit: no guess");
});

// ---- Fees --------------------------------------------------------------------------------------------------------------------------------------

/** A centre with Classes, every kind of block the Fees form shows no box for, and a student's own language. */
function savedFees(): any {
  const s = json("education/fees/settings/bright-tuition-classes.example.json");
  s.joiningMidMonth = "nextMonth";
  s.batches[0].names.en.push("eighth std");
  s.students[1].joined = "2026-10-20"; // Anaya
  s.students[2].backDues = [{ month: "2026-09", amountInr: 1000 }]; // Meera
  s.students[3].joined = "2026-11-02"; s.students[3].backDues = [{ month: "2026-10", amountInr: 1200 }]; // Kiran
  s.classes.linkLeadMinutes = 45; s.classes.materialMaxMb = 20;
  return s;
}
const feesDraft = (saved: any) => feesDraftFromShop("d1", "a1", "fees", "bright-tuition", must(validateFees(saved)), undefined, meta, NOW);
const feesBuild = (d: ReturnType<typeof feesDraft>, saved: any) => buildFeesSettings(d, must(validateFees(saved)), saved);

test("Fees: a fee changed in the form leaves every student's backDues, joined and adult, the Classes block and the other names exactly as they were", () => {
  const saved = savedFees();
  const original = must(validateFees(saved));
  const d = feesDraft(saved);
  d.fees!.batches[0].fee = "1300"; // class 8: 1200 -> 1300
  const built = feesBuild(d, saved) as any;
  assert.ok(built.ok, built.errors?.join("; "));
  const s = built.settings;
  const expected = structuredClone(original) as any;
  expected.batches[0].monthlyFeeInr = 1300;
  assert.deepEqual(s, expected);
  assert.deepEqual(s.students.find((x: any) => x.name === "Meera Nair").backDues, [{ month: "2026-09", amountInr: 1000 }]);
  assert.equal(s.students.find((x: any) => x.name === "Rohan Mehta").adult, true);
  assert.equal(s.students.find((x: any) => x.name === "Kiran Gowda").joined, "2026-11-02");
  assert.equal(s.students.find((x: any) => x.name === "Meera Nair").language, "ml", "a student's own language is not turned into the centre's first");
  assert.equal(s.joiningMidMonth, "nextMonth");
  assert.deepEqual(s.classes, original.classes);
  assert.deepEqual(s.batches[0].names.en, ["class 8", "8th", "eighth std"]);
});

test("Fees: a student the Operator removed takes joined, backDues and adult with them; a new student starts with none", () => {
  const saved = savedFees();
  const d = feesDraft(saved);
  d.fees!.students = d.fees!.students.split("\n").filter((l) => !l.startsWith("Kiran")).join("\n") + "\nZoya Khan, +919855555555, कक्षा 9";
  const built = feesBuild(d, saved) as any;
  assert.ok(built.ok, built.errors?.join("; "));
  const names = built.settings.students.map((x: any) => x.name);
  assert.deepEqual(names, ["Aarav Sharma", "Anaya Sharma", "Meera Nair", "Rohan Mehta", "Zoya Khan"]);
  const written = JSON.stringify(built.raw);
  assert.ok(!written.includes("Kiran") && !written.includes("2026-11-02") && !written.includes("2026-10\""), "nothing of the removed student is left");
  const zoya = built.settings.students.find((x: any) => x.name === "Zoya Khan");
  assert.equal(zoya.backDues, undefined);
  assert.equal(zoya.joined, undefined);
});

test("Fees: a student whose spelling or number was corrected keeps the back dues", () => {
  const saved = savedFees();
  const d = feesDraft(saved);
  d.fees!.students = d.fees!.students.replace("Meera Nair, +919822222222", "Meera Nayar, +919822299999");
  const built = feesBuild(d, saved) as any;
  assert.ok(built.ok, built.errors?.join("; "));
  const meera = built.settings.students.find((x: any) => x.name === "Meera Nayar");
  assert.deepEqual(meera.backDues, [{ month: "2026-09", amountInr: 1000 }]);
});

test("Fees: a renamed batch is still the same batch (its id, its students, its timetable); a back due above a lowered fee is refused in words, not dropped", () => {
  const saved = savedFees();
  const d = feesDraft(saved);
  d.fees!.batches[1].name = "Class IX";
  d.fees!.students = d.fees!.students.replace("कक्षा 9", "Class IX");
  d.fees!.timetable = d.fees!.timetable!.replace("कक्षा 9", "Class IX");
  const built = feesBuild(d, saved) as any;
  assert.ok(built.ok, built.errors?.join("; "));
  assert.equal(built.settings.batches[1].id, "class-9");
  assert.equal(built.settings.students.find((x: any) => x.name === "Meera Nair").batchId, "class-9");
  assert.ok(built.settings.classes.timetable["class-9"], "its timetable is still its own");
  const low = feesDraft(saved);
  low.fees!.batches[0].fee = "500"; // Kiran's back due is 1200 and the batch fee 500, but the dearest batch is 1800: allowed; lower every fee so the back due cannot stand
  low.fees!.batches[1].fee = "500"; low.fees!.batches[2].fee = "500";
  low.fees!.lateFee = "50"; low.fees!.waiver = "50"; low.fees!.partMin = "100";
  const refused = feesBuild(low, saved) as any;
  assert.equal(refused.ok, false, "a back due the fees can no longer carry is refused");
  assert.ok(refused.errors.some((e: string) => e.includes("earlier unpaid month") || e.includes("backDues")));
});

test("Fees: a centre with more batches than the form takes keeps the rest", () => {
  const saved = savedFees();
  for (let i = 0; i < 4; i++) saved.batches.push({ id: `extra-${i}`, names: { en: [`Extra ${i}`] }, monthlyFeeInr: 700 });
  const built = feesBuild(feesDraft(saved), saved) as any;
  assert.ok(built.ok, built.errors?.join("; "));
  assert.deepEqual(built.settings.batches.map((b: any) => b.id).slice(-1), ["extra-3"]);
  assert.equal(built.settings.batches.length, 7);
});

// ---- Orders ------------------------------------------------------------------------------------------------------------------------------------

function savedOrders(): any {
  const s = json("commerce/orders/settings/annapurna-tiffins-plans.example.json");
  s.reminder = { hoursBefore: 2 };
  return s;
}
const ordersDraft = (saved: any) => ordersDraftFromShop("d1", "a1", "orders", "annapurna", must(validateOrders(saved)), undefined, meta, NOW);
const ordersBuild = (d: ReturnType<typeof ordersDraft>, saved: any) => buildOrdersSettings(d, must(validateOrders(saved)), saved) as any;

test("Orders: editing one rule leaves the plans, the reminder, every slot's own cut-off and most orders, and the other names exactly as they were", () => {
  const saved = savedOrders();
  const original = must(validateOrders(saved)) as any;
  const d = ordersDraft(saved);
  d.orders!.refund = "250";
  const built = ordersBuild(d, saved);
  assert.ok(built.ok, built.errors?.join("; "));
  const expected = structuredClone(original);
  expected.refund.limitInr = 250;
  assert.deepEqual(built.settings, expected);
  assert.ok(built.settings.plans.types.length === 2 && built.settings.reminder.hoursBefore === 2);
  assert.equal(built.settings.pickup.slots[0].maxOrders, 14);
  assert.deepEqual(built.settings.menu[0].names.en, ["veg thali", "thali"]);
});

test("Orders: a removed menu item takes its fields with it; a slot a plan still uses cannot be removed (refused in words), one no plan uses can", () => {
  const saved = savedOrders();
  const d = ordersDraft(saved);
  d.orders!.menu = d.orders!.menu.split("\n").filter((l) => !l.startsWith("chicken meal")).join("\n");
  const built = ordersBuild(d, saved);
  assert.ok(built.ok, built.errors?.join("; "));
  assert.ok(!JSON.stringify(built.raw).includes("chicken"), "nothing of the removed item is left");

  const noDinner = ordersDraft(saved);
  noDinner.orders!.pickup = noDinner.orders!.pickup.split("\n").filter((l) => !l.endsWith("dinner")).join("\n");
  const ok = ordersBuild(noDinner, saved);
  assert.ok(ok.ok, ok.errors?.join("; "));
  assert.deepEqual(ok.settings.pickup.slots.map((x: any) => x.id), ["lunch"]);

  const noLunchHome = ordersDraft(saved);
  noLunchHome.orders!.delivery = noLunchHome.orders!.delivery.split("\n").filter((l) => !l.endsWith("lunch")).join("\n");
  const refused = ordersBuild(noLunchHome, saved);
  assert.equal(refused.ok, false, "the plan 'home lunch' still names that slot");
});

test("Orders: a cleared address and a removed delivery area are deleted, not brought back", () => {
  const saved = savedOrders();
  const d = ordersDraft(saved);
  d.orders!.address = "";
  d.orders!.delivery = ""; d.orders!.area = "";
  // a plan on the delivery slot would be refused: take that plan out of the saved settings first
  saved.plans.types = saved.plans.types.filter((t: any) => t.slotId !== "lunch-home");
  const built = ordersBuild(d, saved);
  assert.ok(built.ok, built.errors?.join("; "));
  assert.equal(built.settings.address, undefined);
  assert.equal(built.settings.delivery, undefined);
});

// ---- Stock orders ------------------------------------------------------------------------------------------------------------------------------

const savedStock = (): any => json("commerce/stock-orders/settings/glow-salon.example.json");
const stockDraft = (saved: any) => stockDraftFromShop("d1", "a1", "stock-orders", "glow", must(validateStock(saved)), undefined, meta, NOW);
const stockBuild = (d: ReturnType<typeof stockDraft>, saved: any) => buildStockSettings(d, must(validateStock(saved)), saved) as any;

test("Stock orders: editing a limit never approves a supplier the owner had not, and keeps the follow-up hours, the most units, aliases, languages and other names", () => {
  const saved = savedStock();
  saved.followUpHours = [2, 12];
  const original = must(validateStock(saved)) as any;
  const d = stockDraft(saved);
  (d as any).stock.maxPerOrderInr = "15000";
  const built = stockBuild(d, saved);
  assert.ok(built.ok, built.errors?.join("; "));
  const s = built.settings;
  assert.equal(s.limits.maxPerOrderInr, 15000);
  assert.equal(s.limits.maxQuantity, original.limits.maxQuantity);
  assert.deepEqual(s.followUpHours, [2, 12]);
  assert.deepEqual(s.suppliers, original.suppliers);
  assert.equal(s.suppliers.find((x: any) => x.id === "kumar-wholesale").approved, false);
  assert.deepEqual(s.items.find((x: any) => x.id === "hair-colour").names, original.items.find((x: any) => x.id === "hair-colour").names);
});

test("Stock orders: a removed supplier takes its aliases and approval with it", () => {
  const saved = savedStock();
  const d = stockDraft(saved);
  const stock = (d as any).stock;
  stock.suppliers = stock.suppliers.split("\n").filter((l: string) => !l.startsWith("Kumar")).join("\n");
  stock.catalogue = stock.catalogue.split("\n").filter((l: string) => !l.includes("Kumar")).join("\n");
  const built = stockBuild(d, saved);
  assert.ok(built.ok, built.errors?.join("; "));
  assert.ok(!/kumar/i.test(JSON.stringify(built.raw)), "nothing of the removed supplier is left");
});

// ---- Bookings ----------------------------------------------------------------------------------------------------------------------------------

/** A hiring centre with two units of its shared pool, a tractor with its own pool, a fifth service the form has no room for, and the values the form has no box for. */
function savedBookings(): any {
  const s = json("commerce/bookings/settings/equipment-rental.example.json");
  s.resources = { shop: 2, tractor: 2 };
  s.services[0].resource = "tractor";
  s.services.push({ id: "plough-half-day", names: { kn: ["ನೇಗಿಲು ಅರ್ಧ ದಿನ"], hi: ["हल आधा दिन"] }, priceInr: 1800, durationMinutes: 240 });
  s.deposit.holdMinutes = 45;
  return s;
}

test("Bookings: editing the deposit keeps the address, the reminders, the slot and buffer minutes, the hold minutes, a service's resource, the pools, the names and the fifth service", () => {
  const saved = savedBookings();
  const original = must(validateBookings(saved)) as any;
  const d = draftFromShop("d1", "a1", "bookings", "hosahalli", original, undefined, meta, NOW);
  d.form.deposit = "1500";
  const built = buildSettings(d, original, saved);
  const s = must(built) as any;
  assert.equal(s.deposit.amountInr, 1500);
  assert.equal(s.deposit.holdMinutes, 45);
  assert.equal(s.address, original.address);
  assert.deepEqual(s.reminders, original.reminders);
  assert.equal(s.slotMinutes, 120);
  assert.equal(s.bufferMinutes, 60);
  assert.deepEqual(s.resources, { shop: 2, tractor: 2 });
  assert.equal(s.services[0].resource, "tractor");
  assert.deepEqual(s.services.map((x: any) => x.names), original.services.map((x: any) => x.names));
  assert.equal(s.services.length, 5);
  assert.deepEqual(s.openingHours, original.openingHours);
});

test("Bookings: a service the Operator removed takes its resource with it", () => {
  const saved = savedBookings();
  const original = must(validateBookings(saved)) as any;
  const d = draftFromShop("d1", "a1", "bookings", "hosahalli", original, undefined, meta, NOW);
  d.form.services[0] = { id: "", name: "", also: "", price: "", minutes: "30" };
  const built = must(buildSettings(d, original, saved)) as any;
  assert.ok(!built.services.some((x: any) => x.id === "rotavator-half-day"));
  assert.ok(built.services.every((x: any) => x.resource !== "tractor"), "the removed service's resource went with it");
  assert.deepEqual(built.resources, { shop: 2, tractor: 2 }, "the pools are the shop's, not the service's");
});
