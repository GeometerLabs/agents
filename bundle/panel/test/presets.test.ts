// Presets, trades as data (17 Nov 2026; presets.ts, bundle/panel/presets/*.json): every preset file is valid and what it fills in passes the base template's own checks when the
// Operator takes it through the real steps (in all four languages); a preset naming an unknown template or variant is refused; "Something else" keeps the typed trade and starts empty;
// the four languages have every name. The pages and routes are in presets-flow.test.ts.
import { applyListingsBusiness, buildListingsSettings, newListingsDraft } from "../listings.ts";
import { validateSettings as validateListings } from "../../../templates/commerce/listings/src/settings.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { validateSettings as validateBookings } from "../../../templates/commerce/bookings/src/settings.ts";
import { validateSettings as validateFees } from "../../../templates/education/fees/src/settings.ts";
import { validateSettings as validateOrders } from "../../../templates/commerce/orders/src/settings.ts";
import { validateSettings as validateStock } from "../../../templates/commerce/stock-orders/src/settings.ts";
import { applyBusiness, applyDeposit, buildSettings, newDraft } from "../setup.ts";
import type { Draft } from "../setup.ts";
import { applyFeesBusiness, applyFeesRules, buildFeesSettings, newFeesDraft } from "../fees.ts";
import { applyOrdersBusiness, applyOrdersRules, buildOrdersSettings, newOrdersDraft } from "../orders.ts";
import { applyStockBusiness, applyStockRules, buildStockSettings, newStockDraft } from "../stock.ts";
import { PHONE_TEMPLATES, PRESETS_DIR, VARIANTS, applyPreset, cleanTrade, loadPresets, MAX_TRADE, presetTexts, readPreset, tradeLabel } from "../presets.ts";
import type { Preset } from "../presets.ts";
import { SETUPS } from "../setups.ts";
import { newCharacterDraft } from "../character.ts";
import { PRESET_WORDS } from "../words-presets.ts";
import { WORDS } from "../languages.ts";
import type { Template } from "../templates.ts";

const json = (path: string): any => JSON.parse(readFileSync(new URL(`../../../templates/${path}`, import.meta.url), "utf8"));
const NOW = "2026-11-17T00:00:00Z";
const tpl = (id: string): Template => ({ id, version: "0.1.0", setup: id, steps: ["business", "deposit", "languages", "accounts", "character", "checks"], accounts: ["whatsapp", "payment"], folder: "", settingsExample: "" });
const must = <T>(r: { ok: true; settings: T } | { ok: false; errors: string[] }): T => { assert.ok(r.ok, r.ok ? "" : r.errors.join("; ")); return (r as { settings: T }).settings; };
const presets = loadPresets(PRESETS_DIR, PHONE_TEMPLATES);
const en = WORDS.en;

test("the phone templates a preset may name are Bookings and every row of setups.ts", () => {
  assert.deepEqual([...PHONE_TEMPLATES].sort(), ["bookings", ...Object.keys(SETUPS)].sort());
});

test("the first set is here: salon, clinic, tuition, music or dance or yoga, bakery, sweets, catering and restocking, and the free listings-only shop; each file is named by its id", () => {
  assert.deepEqual(presets.map((p) => p.id), ["arts", "bakery", "catering", "clinic", "hardware-credit", "restock", "salon", "shows-only", "sweets", "tuition"]);
  assert.deepEqual(readdirSync(PRESETS_DIR).filter((f) => f.endsWith(".json")).sort(), presets.map((p) => `${p.id}.json`));
  assert.deepEqual(presets.filter((p) => p.variant === "classes").map((p) => p.id), ["arts", "tuition"], "the two class trades use the Classes part of the Fees form");
  assert.deepEqual(presets.filter((p) => p.variant === "creditBook").map((p) => p.id), ["hardware-credit"], "the shop starter's credit book (24 Nov 2026) is the Fees form's credit variant");
  assert.equal(presets.some((p) => p.id === "tiffin" || p.id === "hire"), false, "tiffin and equipment hire stay hidden until their form step exists");
});

/**
 * Take a preset through the real steps of its form, as an Operator would: the form's boxes filled by the preset, posted back unchanged, the few things only the Operator
 * knows (their own name, their own number, their UPI ID, a student, a supplier) added. The result is what the save would check.
 */
function throughTheSteps(preset: Preset, language: Language) {
  const w = WORDS[language];
  const owner = "+919876543210";
  const pay = { module: "upi", upiId: "shop@okicici", payee: "Test Shop" };
  if (preset.template === "bookings") {
    const example = must(validateBookings(json("commerce/bookings/settings/glow-salon-upi.example.json")));
    const d: Draft = newDraft("d1", "a1", tpl("bookings"), example, NOW);
    applyPreset(d, preset, language);
    const body: Record<string, string> = { name: "Test Shop", opens: d.form.opens, closes: d.form.closes, capacity: d.form.capacity ?? "1" };
    d.form.services.forEach((r, i) => { body[`svc_name_${i}`] = r.name; body[`svc_price_${i}`] = r.price; body[`svc_minutes_${i}`] = r.minutes; });
    d.form.days.forEach((on, i) => { if (on) body[`day_${i}`] = "on"; });
    assert.deepEqual(applyBusiness(d, body, w).problems, [], `${preset.id}/${language}`);
    assert.deepEqual(applyDeposit(d, { deposit: d.form.deposit, window: d.windowHours }, w).problems, [], `${preset.id}/${language}`);
    d.ownerNumber = owner; d.payment = pay;
    return buildSettings(d, example);
  }
  if (preset.template === "listings") {
    // a listings-only shop has no example values: its form starts empty, and the Operator writes the shop, the town and the languages
    const example = must(validateListings({ name: "X", place: { town: "T" }, languages: ["en"], owner: { language: "en" } }));
    const d = newListingsDraft("d1", "a1", tpl("listings"), example, NOW);
    applyPreset(d, preset, language);
    assert.deepEqual(applyListingsBusiness(d, { name: "Test Shop", town: "Thrissur", pincode: "", trade: "" }, w).problems, [], `${preset.id}/${language}`);
    d.primaryLanguage = language; d.ownerLanguage = language;
    return buildListingsSettings(d, example);
  }
  if (preset.template === "fees" && preset.variant === "creditBook") {
    // the credit book: the shop and one person a line, then the reminders and limits; no batch, student or due day is asked
    const example = must(validateFees(json("education/fees/settings/bright-tuition.example.json")));
    const d = newFeesDraft("d1", "a1", tpl("fees"), example, NOW);
    applyPreset(d, preset, language);
    assert.deepEqual(applyFeesBusiness(d, { name: "Test Hardware", address: "", people: "Ramesh, 98450 11111, 2400\nSuresh Electricals, +919845022222, 7850" }, w).problems, [], `${preset.id}/${language}`);
    const g = (d as any).fees;
    assert.deepEqual(applyFeesRules(d, { every: g.credit.every, reminderHour: g.reminderHour, reminderMost: g.reminderMost, most: g.credit.most, partAllowed: "on", partMin: "100", refund: g.refund }, w).problems, [], `${preset.id}/${language}`);
    d.ownerNumber = owner; d.payment = pay;
    return buildFeesSettings(d, example);
  }
  if (preset.template === "fees") {
    const example = must(validateFees(json("education/fees/settings/bright-tuition.example.json")));
    const d = newFeesDraft("d1", "a1", tpl("fees"), example, NOW);
    applyPreset(d, preset, language);
    const f = (d as any).fees;
    const body: Record<string, string> = { name: "Test Centre", address: "", students: `Aarav Sharma, +919811111111, ${f.batches[0].name}`, timetable: f.timetable };
    f.batches.forEach((b: any, i: number) => { body[`batch_name_${i}`] = b.name; body[`batch_fee_${i}`] = b.fee; });
    assert.deepEqual(applyFeesBusiness(d, body, w).problems, [], `${preset.id}/${language}`);
    const g = (d as any).fees;
    assert.deepEqual(applyFeesRules(d, { dueDay: g.dueDay, graceDays: g.graceDays, lateFee: g.lateFee, reminderDays: g.reminderDays, reminderHour: g.reminderHour, reminderMost: g.reminderMost, partAllowed: "on", partMin: g.partMin, waiver: g.waiver, refund: g.refund }, w).problems, [], `${preset.id}/${language}`);
    d.ownerNumber = owner; d.payment = pay;
    return buildFeesSettings(d, example);
  }
  if (preset.template === "orders") {
    const example = must(validateOrders(json("commerce/orders/settings/sweet-crumbs.example.json")));
    const d = newOrdersDraft("d1", "a1", tpl("orders"), example, NOW);
    applyPreset(d, preset, language);
    const o = (d as any).orders;
    assert.deepEqual(applyOrdersBusiness(d, { name: "Test Kitchen", address: "", menu: o.menu }, w).problems, [], `${preset.id}/${language}`);
    const r = (d as any).orders;
    assert.deepEqual(applyOrdersRules(d, { cutoffDays: r.cutoffDays, cutoffTime: r.cutoffTime, pickup: r.pickup, delivery: "", area: "", advanceMode: r.advanceMode, advancePercent: r.advancePercent, holdMinutes: r.holdMinutes, maxPerDay: r.maxPerDay, maxItems: r.maxItems, daysAhead: r.daysAhead, windowHours: r.windowHours, refund: r.refund, approveOver: r.approveOver }, w).problems, [], `${preset.id}/${language}`);
    d.ownerNumber = owner; d.payment = pay;
    return buildOrdersSettings(d, example);
  }
  const example = must(validateStock(json("commerce/stock-orders/settings/glow-salon.example.json")));
  const d = newStockDraft("d1", "a1", tpl("stock-orders"), example, NOW);
  applyPreset(d, preset, language);
  const s = (d as any).stock;
  // the Operator writes their own supplier (the preset never invents a number): the placeholder name the catalogue lines carry is the name they give
  const supplier = (preset.prefill as { supplier: Record<Language, string> }).supplier[language];
  assert.deepEqual(applyStockBusiness(d, { name: "Test Store", address: "", suppliers: `${supplier}, +919876500001`, catalogue: s.catalogue }, w).problems, [], `${preset.id}/${language}`);
  assert.deepEqual(applyStockRules(d, { maxPerOrderInr: s.maxPerOrderInr, monthlyBudgetInr: s.monthlyBudgetInr }, w).problems, [], `${preset.id}/${language}`);
  d.ownerNumber = owner;
  return buildStockSettings(d, example);
}

test("every preset, in every language, goes through its form's steps and its prefilled settings pass the base template's validateSettings", () => {
  for (const preset of presets) for (const language of LANGUAGES) {
    const built = throughTheSteps(preset, language) as any;
    assert.ok(built.ok, `${preset.id}/${language}: ${built.errors?.join("; ")}`);
    if (preset.variant === "classes") assert.ok(Object.keys(built.settings.classes.timetable).length > 0, `${preset.id}: the Classes part is filled`);
    else if (preset.variant === "creditBook") {
      assert.deepEqual(built.settings.creditBook.people.map((p: { name: string; phone: string; amountInr: number }) => [p.name, p.phone, p.amountInr]), [["Ramesh", "+919845011111", 2400], ["Suresh Electricals", "+919845022222", 7850]], `${preset.id}: who owes what`);
      assert.deepEqual([built.settings.batches, built.settings.students], [[], []], "a credit book has no batch and no student");
    }
    else if (preset.template === "fees") assert.equal(built.settings.classes, undefined);
  }
});

test("every value of a preset stays editable: it is text in the form's own boxes, and the draft remembers the trade and the suggested character", () => {
  const salon = presets.find((p) => p.id === "salon")!;
  const example = must(validateBookings(json("commerce/bookings/settings/glow-salon-upi.example.json")));
  const d = newDraft("d1", "a1", tpl("bookings"), example, NOW);
  applyPreset(d, salon, "hi");
  assert.equal(d.form.services[0].name, "हेयरकट");
  assert.equal(typeof d.form.services[0].price, "string");
  assert.equal(d.form.services.length, 4);
  assert.deepEqual(d.trade, { preset: "salon" });
  assert.deepEqual(d.suggestCharacter, { personality: "cheerful", paint: "pink" });
  const c = newCharacterDraft("shop", d.suggestCharacter);
  assert.equal(c.personality, "cheerful");
  assert.equal(c.paint, "pink");
  assert.equal(c.chosen, false, "a suggestion starts the step; nothing is written until the Operator has been through it");
  assert.equal(newCharacterDraft("shop", { personality: "angry", paint: "purple" }).personality, "warm", "a suggestion that is not one of the choices is ignored");
  assert.equal(newCharacterDraft("shop", { personality: "angry", paint: "purple" }).paint, undefined);
});

test("every preset has its name, and every name it fills in, in all four languages, and the review sheets carry them", () => {
  for (const preset of presets) {
    for (const l of LANGUAGES) assert.ok(preset.names[l].trim() !== "", `${preset.id}/${l}`);
    const english = presetTexts(preset, "en");
    // a preset with no example values (the listings-only shop) has only its name to review
    // the credit book's preset fills in numbers only (who owes what is the owner's), so it too has only its name to review
    assert.ok(english.size >= (Object.keys(preset.prefill).length === 0 || preset.variant === "creditBook" ? 1 : 4), `${preset.id}: its name and its example names are listed for review`);
    for (const l of ["hi", "ml", "kn"] as const) {
      const mine = presetTexts(preset, l);
      assert.deepEqual([...mine.keys()], [...english.keys()], `${preset.id}/${l}: the same ids as English`);
      assert.ok([...mine.values()].every((t) => t.trim() !== ""), `${preset.id}/${l}`);
    }
  }
  for (const l of LANGUAGES) assert.ok(Object.values(PRESET_WORDS[l]).every((t) => t.trim() !== ""), l);
});

// ---- the reader refuses -------------------------------------------------------------------------------------------------------------------------

const names = { en: "A", hi: "ए", ml: "എ", kn: "ಎ" };
const salon = () => JSON.parse(readFileSync(join(PRESETS_DIR, "salon.json"), "utf8"));
const tuition = () => JSON.parse(readFileSync(join(PRESETS_DIR, "tuition.json"), "utf8"));
const refused = (raw: unknown): string => { const r = readPreset(raw, PHONE_TEMPLATES); assert.equal(r.ok, false); return r.ok ? "" : r.errors.join(" | "); };

test("a preset naming an unknown template, a variant the template does not have, or one the form cannot set up yet is refused, each saying why", () => {
  assert.match(refused({ ...salon(), template: "tailoring" }), /not one the phone form can set up/u);
  assert.match(refused({ ...salon(), variant: "rental" }), /cannot be set up in the phone form yet/u, "equipment hire waits for its form step");
  assert.match(refused({ ...salon(), variant: "classes" }), /has no variant/u);
  const plans = { ...JSON.parse(readFileSync(join(PRESETS_DIR, "bakery.json"), "utf8")), variant: "plans" };
  assert.match(refused(plans), /cannot be set up in the phone form yet/u, "tiffin waits for its form step");
  assert.deepEqual(VARIANTS.fees.settable, ["classes", "creditBook"]);
  const credit = JSON.parse(readFileSync(join(PRESETS_DIR, "hardware-credit.json"), "utf8"));
  assert.match(refused({ ...credit, prefill: { ...credit.prefill, creditBook: { maxPerPersonInr: 0, remindEveryDays: 7 } } }), /maxPerPersonInr/u);
  assert.match(refused({ ...credit, prefill: { ...credit.prefill, batches: [] } }), /"batches"/u, "a credit book's prefill has no batches");
  assert.equal(readPreset(salon(), ["fees"]).ok, false, "a server that cannot set the template up does not take its presets");
});

test("a preset must be whole: all four languages, prefill inside the template's bounds, a timetable only for Classes, known keys only", () => {
  assert.match(refused({ ...salon(), names: { en: "A" } }), /needs a name in hi/u);
  assert.match(refused({ ...salon(), id: "Salon!" }), /"id"/u);
  assert.match(refused({ ...salon(), extra: 1 }), /"extra"/u);
  const dear = salon(); dear.prefill.depositInr = 5000;
  assert.match(refused(dear), /above the cheapest service/u);
  const noTimetable = tuition(); delete noTimetable.prefill.timetable;
  assert.match(refused(noTimetable), /timetable/u);
  const plain = tuition(); delete plain.variant;
  assert.match(refused(plain), /belongs to the variant/u);
  const badDay = tuition(); badDay.prefill.timetable[0].day = "someday";
  assert.match(refused(badDay), /day must be/u);
  const badPaint = salon(); badPaint.character.paint = "purple";
  assert.match(refused(badPaint), /paint/u);
  const big = JSON.parse(readFileSync(join(PRESETS_DIR, "catering.json"), "utf8")); big.prefill.maxItemsPerOrder = 10;
  assert.match(refused(big), /refunds may come to/u);
  const lateFee = tuition(); lateFee.prefill.lateFeeInr = 5000;
  assert.match(refused(lateFee), /lateFeeInr/u);
});

test("a folder with a broken preset stops with the file's name; a file whose id is not its name is refused; the README is not a preset", () => {
  const dir = mkdtempSync(join(tmpdir(), "presets-"));
  writeFileSync(join(dir, "README.md"), "# not a preset");
  writeFileSync(join(dir, "good.json"), JSON.stringify({ ...salon(), id: "good" }));
  assert.deepEqual(loadPresets(dir, PHONE_TEMPLATES).map((p) => p.id), ["good"]);
  writeFileSync(join(dir, "wrong.json"), JSON.stringify({ ...salon(), id: "other" }));
  assert.throws(() => loadPresets(dir, PHONE_TEMPLATES), /wrong\.json: the id other must be the file's name/u);
  writeFileSync(join(dir, "wrong.json"), JSON.stringify({ ...salon(), id: "wrong", template: "nowhere", names }));
  assert.throws(() => loadPresets(dir, PHONE_TEMPLATES), /wrong\.json/u);
  writeFileSync(join(dir, "wrong.json"), "{ not json");
  assert.throws(() => loadPresets(dir, PHONE_TEMPLATES), /wrong\.json: not readable JSON/u);
});

// ---- Other: the typed trade --------------------------------------------------------------------------------------------------------------------

test("Other: the typed trade is cleaned and bounded, kept as the Operator wrote it (escaped only where shown), and the form starts empty", () => {
  assert.equal(cleanTrade("  tailor  "), "tailor");
  assert.equal(cleanTrade("tai\u0000lor\n\tshop"), "tai lor shop");
  assert.equal(cleanTrade(""), undefined);
  assert.equal(cleanTrade("  \n "), undefined);
  assert.equal(cleanTrade(undefined), undefined);
  assert.equal(Array.from(cleanTrade("x".repeat(500))!).length, MAX_TRADE);
  assert.equal(cleanTrade("<b>tailor</b> & co"), "<b>tailor</b> & co", "not pre-escaped: a page escapes it on the way out");
  assert.equal(cleanTrade("दर्ज़ी"), "दर्ज़ी");
  const example = must(validateBookings(json("commerce/bookings/settings/glow-salon-upi.example.json")));
  const d = newDraft("d1", "a1", tpl("bookings"), example, NOW);
  assert.ok(d.form.services.every((r) => r.name === "" && r.price === "") && d.form.name === "" && d.form.deposit === "", "a new shop with no trade starts empty");
});

test("the shop page's trade: a preset's name in the reader's language, or the Operator's own words, or nothing for a shop from before", () => {
  assert.equal(tradeLabel({ preset: "salon" }, presets, "ml"), presets.find((p) => p.id === "salon")!.names.ml);
  assert.equal(tradeLabel({ typed: "tailor" }, presets, "hi"), "tailor");
  assert.equal(tradeLabel(undefined, presets, "en"), undefined);
  assert.equal(tradeLabel({ preset: "gone" }, presets, "en"), undefined);
});
