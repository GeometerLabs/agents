// Presets: a trade as DATA on top of one existing template (owner, 17 Nov 2026: "P yes but have an Other option operator can specify"). Operators think in trades
// ("salon", "tuition", "tiffin"), not in our template names, so the panel's first question is "What does the shop do?" and each answer is a small JSON file in
// bundle/panel/presets/. A preset names a base template (and its variant, if any), the trade's name in four languages, what the phone form starts with (example services, menu
// items, batches, with prices the Operator must check), the rules it suggests, and the shop assistant's suggested personality and signboard paint. It adds no agent code, no new
// settings field and no new rule: every prefilled value goes into the SAME form boxes an Operator would type into, stays editable, and still passes through the template's own
// `validateSettings` when the shop is saved.
//
// Where the files live, and why not templates/: templates.ts finds templates by `template.json` in templates/<domain>/<name>/. A preset is panel data, not a template, so it
// sits in the panel's own folder (like vote-options.json) and cannot be mistaken for one. One reader and validator live here; a broken file fails loudly when the panel starts.
//
// "Other": the Operator types the trade in their own words and picks the kind of work from the template list; the form starts empty. The typed words are the Operator's: cleaned
// and length-bounded here (`cleanTrade`), kept only in the shop's meta, escaped wherever they are shown, and never sent to a customer by this change.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { DEFAULT_CAPS } from "../../modules/payments/guard-limits.ts";
import { PERSONALITIES } from "../../modules/assistant/personality.ts";
import { isPaint } from "../../modules/channels/chat-paint.ts";
import { dayNumber } from "../../templates/education/fees/src/classes/settings.ts";
import { MAX_BATCHES } from "./fees.ts";
import { MAX_ITEMS, MAX_SLOTS } from "./orders.ts";
import { MAX_LINES } from "./stock.ts";
import type { Draft } from "./setup.ts";
import type { ShopMeta } from "./shops.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Where the preset files are: next to this file (the panel's own data, like vote-options.json). */
export const PRESETS_DIR = new URL("./presets/", import.meta.url).pathname;

/** The templates the phone form can set up: Bookings and one row of setups.ts for each other (test/presets.test.ts checks it is the same list). The review sheets read the presets with it. */
export const PHONE_TEMPLATES: readonly string[] = ["bookings", "fees", "orders", "stock-orders", "listings"];

/** The words of one thing in the four languages (Hindi, Malayalam and Kannada machine-written, on the review sheets). */
export type Names = Record<Language, string>;

/** The variants a base template can have. Only the ones the phone form can set up are allowed in a preset; the others are known, so the refusal can say why. */
export const VARIANTS: Record<string, { settable: readonly string[]; later: readonly string[] }> = {
  bookings: { settable: [], later: ["rental"] },
  fees: { settable: ["classes"], later: [] },
  orders: { settable: [], later: ["plans"] },
  "stock-orders": { settable: [], later: [] },
  listings: { settable: [], later: [] },
};

export interface BookingsPrefill { services: { names: Names; priceInr: number; minutes: number }[]; depositInr: number; windowHours: number; opens: string; closes: string; /** 0 = Sunday */ days: number[]; capacity?: number }
export interface FeesPrefill { batches: { names: Names; feeInr: number }[]; dueDay: number; graceDays: number; lateFeeInr: number; /** Only with the variant "classes": batch = the row (from 0) in `batches`. */ timetable?: { batch: number; day: string; time: string; minutes: number }[] }
export interface OrdersPrefill { menu: { names: Names; priceInr: number; dailyStock: number }[]; pickup: { from: string; to: string; names?: Names }[]; cutoffDays: number; cutoffTime: string; advance: { mode: "full" } | { mode: "part"; percent: number }; maxItemsPerOrder: number }
export interface StockPrefill { /** The name of the supplier the catalogue lines name until the Operator writes their own: never a real person or number. */ supplier: Names; items: { names: Names; unit: Names; priceInr: number; reorderQty?: number }[]; maxPerOrderInr: number; monthlyBudgetInr: number }

/** A listings-only shop has no example values: the form starts empty (the Operator writes the town and the shop's words), so its prefill is `{}`. */
export type ListingsPrefill = Record<string, never>;

export interface Preset {
  id: string;
  names: Names;
  template: string;
  variant?: string;
  prefill: BookingsPrefill | FeesPrefill | OrdersPrefill | StockPrefill | ListingsPrefill;
  /** The suggested personality of the shop's assistant (the one mood an Operator chooses; the faces' moods follow the shop's real state) and the signboard paint. Both stay a choice at the Character step. */
  character?: { personality?: string; paint?: string };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;
const ID = /^[a-z][a-z0-9-]{1,39}$/u;

/** A name in all four languages: a short line, one line, no control characters. */
function readNames(v: unknown, where: string, errors: string[], max = 60): Names {
  const out = {} as Names;
  if (!isObj(v)) { errors.push(`${where} must give the name in ${LANGUAGES.join(", ")}.`); return out; }
  for (const k of Object.keys(v)) if (!(LANGUAGES as readonly string[]).includes(k)) errors.push(`${where} has a language ${JSON.stringify(k)} this panel does not know.`);
  for (const l of LANGUAGES) {
    const t = v[l];
    if (typeof t !== "string" || t.trim() === "" || t.length > max || /[\p{Cc}]/u.test(t)) errors.push(`${where} needs a name in ${l}: one short line (at most ${max} characters).`);
    else out[l] = t.trim();
  }
  return out;
}

function onlyKeys(o: Obj, allowed: readonly string[], where: string, errors: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${where} has a key ${JSON.stringify(k)} that is not one of: ${allowed.join(", ")}.`);
}

function listOf(v: unknown, where: string, min: number, max: number, errors: string[]): Obj[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) { errors.push(`${where} must be a list of ${min} to ${max}.`); return []; }
  return v.filter((x, i): x is Obj => { if (!isObj(x)) { errors.push(`${where} number ${i + 1} must be an object.`); return false; } return true; });
}

function readBookings(v: Obj, errors: string[]): BookingsPrefill {
  onlyKeys(v, ["services", "depositInr", "windowHours", "opens", "closes", "days", "capacity"], "The prefill", errors);
  const services = listOf(v.services, "The services", 1, 4, errors).map((s, i) => {
    onlyKeys(s, ["names", "priceInr", "minutes"], `Service ${i + 1}`, errors);
    if (!isWhole(s.priceInr, 1, 1_000_000)) errors.push(`Service ${i + 1}: priceInr must be whole rupees above 0.`);
    if (!isWhole(s.minutes, 5, 480)) errors.push(`Service ${i + 1}: minutes must be from 5 to 480.`);
    return { names: readNames(s.names, `Service ${i + 1}'s name`, errors, 80), priceInr: s.priceInr as number, minutes: s.minutes as number };
  });
  if (!isWhole(v.depositInr, 1, 1_000_000)) errors.push("depositInr must be whole rupees above 0.");
  else if (services.some((s) => typeof s.priceInr === "number" && (v.depositInr as number) > s.priceInr)) errors.push("depositInr is above the cheapest service: a booking would cost less than its deposit.");
  if (!isWhole(v.windowHours, 0, 720)) errors.push("windowHours must be from 0 to 720.");
  if (typeof v.opens !== "string" || !CLOCK.test(v.opens) || typeof v.closes !== "string" || !CLOCK.test(v.closes) || v.opens >= v.closes) errors.push("opens and closes must be 24-hour times like 10:00, opens before closes.");
  if (!Array.isArray(v.days) || v.days.length === 0 || !v.days.every((d) => isWhole(d, 0, 6)) || new Set(v.days).size !== v.days.length) errors.push("days must be a list of the days the shop is open, 0 (Sunday) to 6 (Saturday), each once.");
  if (v.capacity !== undefined && !isWhole(v.capacity, 1, 50)) errors.push("capacity must be from 1 to 50.");
  return { services, depositInr: v.depositInr as number, windowHours: v.windowHours as number, opens: v.opens as string, closes: v.closes as string, days: v.days as number[], ...(v.capacity !== undefined ? { capacity: v.capacity as number } : {}) };
}

function readFees(v: Obj, variant: string | undefined, errors: string[]): FeesPrefill {
  onlyKeys(v, ["batches", "dueDay", "graceDays", "lateFeeInr", "timetable"], "The prefill", errors);
  const batches = listOf(v.batches, "The batches", 1, MAX_BATCHES, errors).map((b, i) => {
    onlyKeys(b, ["names", "feeInr"], `Batch ${i + 1}`, errors);
    if (!isWhole(b.feeInr, 1, 1_000_000)) errors.push(`Batch ${i + 1}: feeInr must be whole rupees above 0.`);
    return { names: readNames(b.names, `Batch ${i + 1}'s name`, errors), feeInr: b.feeInr as number };
  });
  if (!isWhole(v.dueDay, 1, 28)) errors.push("dueDay must be from 1 to 28.");
  if (!isWhole(v.graceDays, 0, 30)) errors.push("graceDays must be from 0 to 30.");
  const cheapest = Math.min(...batches.map((b) => b.feeInr).filter((n) => typeof n === "number"));
  if (!isWhole(v.lateFeeInr, 0, 1_000_000) || (Number.isFinite(cheapest) && (v.lateFeeInr as number) > cheapest)) errors.push("lateFeeInr must be whole rupees, at most the cheapest fee.");
  let timetable: FeesPrefill["timetable"];
  if (variant === "classes") {
    timetable = listOf(v.timetable, "The timetable", 1, 14, errors).map((c, i) => {
      onlyKeys(c, ["batch", "day", "time", "minutes"], `Class ${i + 1}`, errors);
      if (!isWhole(c.batch, 0, batches.length - 1)) errors.push(`Class ${i + 1}: batch must be the row of one of the batches, from 0.`);
      if (dayNumber(c.day) === undefined) errors.push(`Class ${i + 1}: day must be mon, tue, wed, thu, fri, sat or sun.`);
      if (typeof c.time !== "string" || !CLOCK.test(c.time)) errors.push(`Class ${i + 1}: time must be a 24-hour time like 17:00.`);
      if (!isWhole(c.minutes, 10, 240)) errors.push(`Class ${i + 1}: minutes must be from 10 to 240.`);
      return { batch: c.batch as number, day: String(c.day), time: String(c.time), minutes: c.minutes as number };
    });
  } else if (v.timetable !== undefined) errors.push("A timetable belongs to the variant \"classes\".");
  return { batches, dueDay: v.dueDay as number, graceDays: v.graceDays as number, lateFeeInr: v.lateFeeInr as number, ...(timetable ? { timetable } : {}) };
}

function readOrders(v: Obj, errors: string[]): OrdersPrefill {
  onlyKeys(v, ["menu", "pickup", "cutoffDays", "cutoffTime", "advance", "maxItemsPerOrder"], "The prefill", errors);
  const menu = listOf(v.menu, "The menu", 1, MAX_ITEMS, errors).map((m, i) => {
    onlyKeys(m, ["names", "priceInr", "dailyStock"], `Item ${i + 1}`, errors);
    if (!isWhole(m.priceInr, 1, 100_000)) errors.push(`Item ${i + 1}: priceInr must be whole rupees from 1 to 100000.`);
    if (!isWhole(m.dailyStock, 1, 10_000)) errors.push(`Item ${i + 1}: dailyStock must be from 1 to 10000.`);
    return { names: readNames(m.names, `Item ${i + 1}'s name`, errors), priceInr: m.priceInr as number, dailyStock: m.dailyStock as number };
  });
  const pickup = listOf(v.pickup, "The pickup slots", 1, MAX_SLOTS, errors).map((s, i) => {
    onlyKeys(s, ["from", "to", "names"], `Pickup slot ${i + 1}`, errors);
    if (typeof s.from !== "string" || !CLOCK.test(s.from) || typeof s.to !== "string" || !CLOCK.test(s.to) || s.from >= s.to) errors.push(`Pickup slot ${i + 1}: from and to must be 24-hour times on one day, from before to.`);
    return { from: String(s.from), to: String(s.to), ...(s.names !== undefined ? { names: readNames(s.names, `Pickup slot ${i + 1}'s name`, errors, 40) } : {}) };
  });
  if (!isWhole(v.cutoffDays, 0, 7)) errors.push("cutoffDays must be from 0 to 7.");
  if (typeof v.cutoffTime !== "string" || !CLOCK.test(v.cutoffTime)) errors.push("cutoffTime must be a 24-hour time like 18:00.");
  let advance: OrdersPrefill["advance"] = { mode: "full" };
  if (!isObj(v.advance)) errors.push("advance must be {\"mode\": \"full\"} or {\"mode\": \"part\", \"percent\": 50}.");
  else {
    onlyKeys(v.advance, ["mode", "percent"], "The advance", errors);
    if (v.advance.mode === "part") { if (!isWhole(v.advance.percent, 1, 99)) errors.push("The advance's percent must be from 1 to 99."); advance = { mode: "part", percent: v.advance.percent as number }; }
    else if (v.advance.mode !== "full") errors.push("The advance's mode must be \"full\" or \"part\".");
  }
  if (!isWhole(v.maxItemsPerOrder, 1, 100)) errors.push("maxItemsPerOrder must be from 1 to 100.");
  // the pathway refuses an order that could come to more than can be refunded in a day (orders.ts says so in the person's language); the preset must not start the form in that state
  else if (menu.length > 0 && (v.maxItemsPerOrder as number) * Math.max(...menu.map((m) => (typeof m.priceInr === "number" ? m.priceInr : 0))) > DEFAULT_CAPS.refundPaisePerDay / 100) errors.push(`maxItemsPerOrder times the dearest item is more than the most a day's refunds may come to (${DEFAULT_CAPS.refundPaisePerDay / 100} rupees).`);
  return { menu, pickup, cutoffDays: v.cutoffDays as number, cutoffTime: v.cutoffTime as string, advance, maxItemsPerOrder: v.maxItemsPerOrder as number };
}

function readStock(v: Obj, errors: string[]): StockPrefill {
  onlyKeys(v, ["supplier", "items", "maxPerOrderInr", "monthlyBudgetInr"], "The prefill", errors);
  const items = listOf(v.items, "The items", 1, MAX_LINES, errors).map((m, i) => {
    onlyKeys(m, ["names", "unit", "priceInr", "reorderQty"], `Item ${i + 1}`, errors);
    if (typeof m.priceInr !== "number" || !(m.priceInr > 0) || Math.abs(m.priceInr * 100 - Math.round(m.priceInr * 100)) > 1e-6) errors.push(`Item ${i + 1}: priceInr must be rupees above 0 with at most two decimals.`);
    if (m.reorderQty !== undefined && !isWhole(m.reorderQty, 1, 100_000)) errors.push(`Item ${i + 1}: reorderQty must be a whole number of 1 or more.`);
    return { names: readNames(m.names, `Item ${i + 1}'s name`, errors), unit: readNames(m.unit, `Item ${i + 1}'s pack`, errors, 30), priceInr: m.priceInr as number, ...(m.reorderQty !== undefined ? { reorderQty: m.reorderQty as number } : {}) };
  });
  if (!isWhole(v.maxPerOrderInr, 1, 10_000_000) || !isWhole(v.monthlyBudgetInr, 1, 100_000_000)) errors.push("maxPerOrderInr and monthlyBudgetInr must be whole rupees above 0.");
  else if ((v.maxPerOrderInr as number) > (v.monthlyBudgetInr as number)) errors.push("maxPerOrderInr is above monthlyBudgetInr.");
  else if (items.some((i) => typeof i.priceInr === "number" && i.priceInr > (v.maxPerOrderInr as number))) errors.push("An item costs more than maxPerOrderInr: it could never be ordered.");
  return { supplier: readNames(v.supplier, "The supplier's placeholder name", errors, 40), items, maxPerOrderInr: v.maxPerOrderInr as number, monthlyBudgetInr: v.monthlyBudgetInr as number };
}

export type PresetRead = { ok: true; preset: Preset } | { ok: false; errors: string[] };

/**
 * Check one preset file's content. `known` is the ids of the templates this panel's phone form can set up. Refused: a template that is not one of them, a variant the template
 * does not have, and a variant the form cannot set up yet (listed in VARIANTS with the reason, so a preset is never shown that cannot be finished). Every error says what to fix.
 */
export function readPreset(input: unknown, known: readonly string[]): PresetRead {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["A preset must be an object."] };
  onlyKeys(input, ["schema", "id", "names", "template", "variant", "prefill", "character"], "The preset", errors);
  if (input.schema !== 1) errors.push("\"schema\" must be 1.");
  if (typeof input.id !== "string" || !ID.test(input.id)) errors.push("\"id\" must be lowercase letters, digits and dashes, starting with a letter.");
  const names = readNames(input.names, "The trade's name", errors, 60);
  const template = input.template;
  const variants = typeof template === "string" && Object.hasOwn(VARIANTS, template) ? VARIANTS[template] : undefined;
  if (typeof template !== "string" || !variants || !known.includes(template)) errors.push(`The template ${JSON.stringify(template)} is not one the phone form can set up (${known.join(", ")}).`);
  const variant = input.variant;
  if (variant !== undefined && variant !== null) {
    if (typeof variant !== "string") errors.push("\"variant\" must be text.");
    else if (variants && variants.later.includes(variant)) errors.push(`The variant ${JSON.stringify(variant)} of ${String(template)} cannot be set up in the phone form yet, so this preset stays hidden until its form step exists (Deferred.md).`);
    else if (!variants?.settable.includes(variant)) errors.push(`${String(template)} has no variant ${JSON.stringify(variant)}.`);
  }
  const chosenVariant = typeof variant === "string" ? variant : undefined;
  let prefill: Preset["prefill"] | undefined;
  if (!isObj(input.prefill)) errors.push("\"prefill\" must be an object.");
  else if (template === "bookings") prefill = readBookings(input.prefill, errors);
  else if (template === "fees") prefill = readFees(input.prefill, chosenVariant, errors);
  else if (template === "orders") prefill = readOrders(input.prefill, errors);
  else if (template === "stock-orders") prefill = readStock(input.prefill, errors);
  else if (template === "listings") { onlyKeys(input.prefill, [], "The prefill", errors); prefill = {} as ListingsPrefill; }
  let character: Preset["character"];
  if (input.character !== undefined) {
    if (!isObj(input.character)) errors.push("\"character\" must be an object.");
    else {
      onlyKeys(input.character, ["personality", "paint"], "The character", errors);
      const { personality, paint } = input.character;
      if (personality !== undefined && !(PERSONALITIES as readonly unknown[]).includes(personality)) errors.push(`The personality must be one of ${PERSONALITIES.join(", ")}.`);
      if (paint !== undefined && !isPaint(paint)) errors.push("The paint must be one of the signboard paints (modules/channels/chat-paint.ts).");
      character = { ...(personality !== undefined ? { personality: String(personality) } : {}), ...(paint !== undefined ? { paint: String(paint) } : {}) };
    }
  }
  if (errors.length > 0 || !prefill) return { ok: false, errors };
  return { ok: true, preset: { id: input.id as string, names, template: template as string, ...(chosenVariant ? { variant: chosenVariant } : {}), prefill, ...(character ? { character } : {}) } };
}

/** Every preset file in a folder (`*.json`, not the README), in id order. A file that is refused is an error, with its name: a broken data file should fail loudly when the panel starts. */
export function loadPresets(dir: string, known: readonly string[]): Preset[] {
  const presets: Preset[] = [];
  const problems: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(join(dir, file), "utf8")); } catch (e) { problems.push(`${file}: not readable JSON (${(e as Error).message})`); continue; }
    const r = readPreset(raw, known);
    if (!r.ok) problems.push(`${file}: ${r.errors.join(" ")}`);
    else if (`${r.preset.id}.json` !== file) problems.push(`${file}: the id ${r.preset.id} must be the file's name.`);
    else presets.push(r.preset);
  }
  if (problems.length > 0) throw new Error(`The presets need fixing:\n- ${problems.join("\n- ")}`);
  return presets.sort((a, b) => a.id.localeCompare(b.id));
}

// ---- the typed trade (Other) ----------------------------------------------------------------------------------------------------------------

/** How long the Operator's own words for the trade may be, in characters. */
export const MAX_TRADE = 40;

/** The trade as typed under "Other": control characters and runs of spaces become one space, at most MAX_TRADE characters. Undefined for nothing at all. Not HTML-escaped: pages escape on output. */
export function cleanTrade(typed: string | undefined): string | undefined {
  const t = Array.from((typed ?? "").replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim()).slice(0, MAX_TRADE).join("").trim();
  return t === "" ? undefined : t;
}

/** What the shop's page shows for its trade: a preset's name in the reader's language, or the Operator's own words. Nothing for a shop set up before this existed. */
export function tradeLabel(trade: ShopMeta["trade"], presets: readonly Preset[], language: Language): string | undefined {
  if (trade?.preset) { const p = presets.find((x) => x.id === trade.preset); return p ? p.names[language] : undefined; }
  return trade?.typed;
}

// ---- starting a draft from a preset ----------------------------------------------------------------------------------------------------------

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const blank = (n: number, make: () => unknown): unknown[] => Array.from({ length: n }, make);

/**
 * Put a preset's example values into a NEW draft's form boxes, in the language the Operator reads the panel in. Every value is text in a box the Operator can change; the prices
 * are examples, and the step says so. The draft remembers the preset (meta keeps it) and the suggested character. Nothing is saved and nothing is checked here: the steps check
 * what is typed and `validateSettings` has the last word.
 */
export function applyPreset(draft: Draft, preset: Preset, language: Language): void {
  const d = draft as unknown as Record<string, any>;
  d.trade = { preset: preset.id };
  if (preset.character) d.suggestCharacter = { ...preset.character };
  const p = preset.prefill;
  if (preset.template === "bookings") {
    const b = p as BookingsPrefill;
    d.form.services = [...b.services.map((s) => ({ id: "", name: s.names[language], also: "", price: String(s.priceInr), minutes: String(s.minutes) })), ...blank(4 - b.services.length, () => ({ id: "", name: "", also: "", price: "", minutes: "30" }))];
    d.form.deposit = String(b.depositInr);
    d.windowHours = String(b.windowHours);
    d.form.opens = b.opens; d.form.closes = b.closes;
    d.form.days = DAY_SHORT.map((_, i) => b.days.includes(i));
    d.form.capacity = String(b.capacity ?? 1);
  } else if (preset.template === "fees") {
    const f = p as FeesPrefill;
    d.fees.batches = [...f.batches.map((x) => ({ name: x.names[language], fee: String(x.feeInr) })), ...blank(MAX_BATCHES - f.batches.length, () => ({ name: "", fee: "" }))];
    d.fees.dueDay = String(f.dueDay); d.fees.graceDays = String(f.graceDays); d.fees.lateFee = String(f.lateFeeInr);
    if (f.timetable) d.fees.timetable = f.timetable.map((c) => `${f.batches[c.batch].names[language]}, ${DAY_SHORT[dayNumber(c.day) ?? 0]}, ${c.time}, ${c.minutes}`).join("\n");
  } else if (preset.template === "orders") {
    const o = p as OrdersPrefill;
    d.orders.menu = o.menu.map((m) => `${m.names[language]}, ${m.priceInr}, ${m.dailyStock}`).join("\n");
    d.orders.pickup = o.pickup.map((s) => `${s.from}-${s.to}${s.names ? `, ${s.names[language]}` : ""}`).join("\n");
    d.orders.cutoffDays = String(o.cutoffDays); d.orders.cutoffTime = o.cutoffTime;
    d.orders.advanceMode = o.advance.mode;
    if (o.advance.mode === "part") d.orders.advancePercent = String(o.advance.percent);
    d.orders.maxItems = String(o.maxItemsPerOrder);
  } else if (preset.template === "stock-orders") {
    const s = p as StockPrefill;
    d.stock.catalogue = s.items.map((i) => `${i.names[language]}, ${s.supplier[language]}, ${i.unit[language]}, ${i.priceInr}${i.reorderQty ? `, ${i.reorderQty}` : ""}`).join("\n");
    d.stock.maxPerOrderInr = String(s.maxPerOrderInr); d.stock.monthlyBudgetInr = String(s.monthlyBudgetInr);
  }
}

/** Every sentence of a preset a person reads, by id, in one language: the trade's name and each prefilled name (for the review sheets). */
export function presetTexts(preset: Preset, language: Language): Map<string, string> {
  const out = new Map<string, string>([[`preset.${preset.id}.name`, preset.names[language]]]);
  const p = preset.prefill as unknown as Record<string, unknown>;
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i + 1}`));
    else if (isObj(v) && LANGUAGES.every((l) => typeof v[l] === "string")) out.set(path, v[language] as string);
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(p, `preset.${preset.id}.prefill`);
  return out;
}
