// A shop's settings for Stock orders: everything a builder changes, no code. The owner's approved supplier list and catalogue (item, pack or unit, last price) live here,
// with the two limits (a cap for one order, a budget for the month) and when the agent asks a silent supplier again. Validation is written by hand and says what is
// wrong in plain words, so a builder can fix the file without a manual.
//
// Why a "catalogue line" is (item, supplier, unit, price): the same hair colour comes by the box from one supplier and by the piece from another at different prices, and
// the order must never convert between them. A line is one thing that can be ordered, so an order names exactly one line and the total is that line's price times a
// whole quantity, worked out in code (order.ts), never by the AI.
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { readAssistantSettings } from "../../../../modules/assistant/settings.ts";
import type { AssistantSettings } from "../../../../modules/assistant/settings.ts";
import { isValidTimeZone } from "../../../../modules/core/time.ts";

const languageList = () => LANGUAGES.map((l) => `"${l}" (${LANGUAGE_NAMES[l]})`).join(", ");

/** Names per language; the first is the one the agent says, the rest are what the owner may type. English is always there. */
export type Names = Partial<Record<Language, string[]>> & { en: string[] };

export interface Item { id: string; names: Names }
/** A pack or unit ("box", "piece", "25 kg bag"). The agent never converts one into another. */
export interface Unit { id: string; names: Names }
export interface Supplier {
  id: string;
  name: string;
  /** Other ways the owner may write the name ("ravi"). */
  aliases: string[];
  /** The supplier's WhatsApp number. The order goes only here, and only an answer from this number counts as theirs. */
  whatsapp: string;
  /** The language the supplier is written to. */
  language: Language;
  /** False: on the list but not to be ordered from (paused). Only approved suppliers get an order. */
  approved: boolean;
}
/** One thing that can be ordered: this item, from this supplier, in this unit, at the last price. */
export interface Line {
  item: string;
  supplier: string;
  unit: string;
  /** The last price for one unit, in rupees (at most two decimals). A change of this price voids an approval that is waiting. */
  priceInr: number;
  /** How many units to order when the owner marks the item low and gives no number. Left out: the agent asks. */
  reorderQty?: number;
}

export interface Settings {
  name: string;
  address?: string;
  timezone: string;
  /** Used for messages to suppliers by default and for the owner's; the first is the default. */
  languages: Language[];
  owner: { whatsapp: string; language: Language };
  items: Item[];
  units: Unit[];
  suppliers: Supplier[];
  catalogue: Line[];
  limits: {
    /** One order may not be worth more than this, whatever the owner approves. */
    maxPerOrderInr: number;
    /** The most the month's approved orders may add up to; reserved when the owner approves. */
    monthlyBudgetInr: number;
    /** The most units of one line in one order (a typing slip such as 1000 for 10). */
    maxQuantity: number;
  };
  /** When a supplier who has not answered an order is asked again, hours after it went out (the same order, never a new one). The last is when the owner is told. */
  followUpHours: number[];
  /** The shop's assistant (the owner's conversation, the morning line, the character; modules/assistant/settings.ts). Left out: no assistant, the fixed phrases only. */
  assistant?: AssistantSettings;
}

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const PHONE = /^\+\d{10,15}$/u;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/u;
/** Rupees with at most two decimals (so a total is a whole number of paise). */
const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

/** Check a settings object (usually parsed from JSON), fill in the defaults and say what is wrong in plain words. */
export function validateSettings(input: unknown): SettingsResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["The settings must be an object with the shop's name, suppliers, catalogue and limits."] };
  unknownKeys(input, ["name", "address", "timezone", "languages", "owner", "items", "units", "suppliers", "catalogue", "limits", "followUpHours", "assistant"], "the settings", errors);

  const name = input.name;
  if (typeof name !== "string" || name.trim() === "") errors.push("Add the shop's name (\"name\").");
  if (input.address !== undefined && typeof input.address !== "string") errors.push("The address (\"address\") must be text.");
  const timezone = input.timezone ?? "Asia/Kolkata";
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) errors.push(`The time zone ${JSON.stringify(timezone)} is not one I know. Use a name like "Asia/Kolkata".`);

  const languages = readLanguages(input.languages, errors);
  const owner = readOwner(input.owner, languages, errors);
  const items = readNamed(input.items, "item", "items", errors) as Item[];
  const units = readNamed(input.units, "unit", "units", errors) as Unit[];
  const suppliers = readSuppliers(input.suppliers, languages, errors);
  const catalogue = readCatalogue(input.catalogue, items, units, suppliers, errors);
  const limits = readLimits(input.limits, errors);
  const followUpHours = readFollowUp(input.followUpHours, errors);
  const assistant = readAssistantSettings(input.assistant, errors);

  if (errors.length === 0 && limits) {
    for (const l of catalogue) if (l.priceInr > limits.maxPerOrderInr) errors.push(`One unit of ${l.item} from ${l.supplier} costs ₹${l.priceInr}, more than the most one order may be worth (₹${limits.maxPerOrderInr}): it could never be ordered. Raise "limits.maxPerOrderInr" or fix the price.`);
    if (limits.maxPerOrderInr > limits.monthlyBudgetInr) errors.push(`The most for one order (₹${limits.maxPerOrderInr}) is above the month's budget (₹${limits.monthlyBudgetInr}). Make the order limit the smaller number.`);
  }
  if (errors.length > 0 || !owner || !limits) return { ok: false, errors };
  const settings: Settings = { name: (name as string).trim(), ...(typeof input.address === "string" ? { address: input.address } : {}), timezone: timezone as string, languages, owner, items, units, suppliers, catalogue, limits, followUpHours, ...(assistant ? { assistant } : {}) };
  return { ok: true, settings };
}

/** Parse settings, throwing the plain-words problems as one error. For code that holds settings it wrote itself (the harness, the tests). */
export function parseSettings(input: unknown): Settings {
  const r = validateSettings(input);
  if (!r.ok) throw new Error(`The settings need fixing:\n- ${r.errors.join("\n- ")}`);
  return r.settings;
}

function unknownKeys(obj: Obj, known: string[], where: string, errors: string[]): void {
  for (const k of Object.keys(obj)) if (!known.includes(k)) errors.push(`${where} has "${k}", which I do not know. Known: ${known.map((n) => `"${n}"`).join(", ")}.`);
}

function readLanguages(v: unknown, errors: string[]): Language[] {
  if (!Array.isArray(v) || v.length === 0) { errors.push(`List the languages ("languages"), for example ["en", "hi"]. Known: ${languageList()}.`); return ["en"]; }
  const out: Language[] = [];
  for (const l of v) {
    if (!LANGUAGES.includes(l as Language)) errors.push(`The language ${JSON.stringify(l)} is not one I know. Known: ${languageList()}.`);
    else if (!out.includes(l as Language)) out.push(l as Language);
  }
  return out;
}

function readOwner(v: unknown, languages: Language[], errors: string[]): Settings["owner"] | undefined {
  if (!isObj(v)) { errors.push("Add the owner (\"owner\": the WhatsApp number and language)."); return undefined; }
  unknownKeys(v, ["whatsapp", "language"], "\"owner\"", errors);
  if (typeof v.whatsapp !== "string" || !PHONE.test(v.whatsapp)) errors.push("The owner's WhatsApp number (\"owner.whatsapp\") must look like +919812345678.");
  const language = v.language ?? languages[0];
  if (!LANGUAGES.includes(language as Language)) errors.push(`The owner's language (\"owner.language\") must be one of ${languageList()}.`);
  return typeof v.whatsapp === "string" ? { whatsapp: v.whatsapp, language: language as Language } : undefined;
}

function readNames(v: unknown, where: string, errors: string[]): Names | undefined {
  if (!isObj(v)) { errors.push(`${where} needs names, for example {"en": ["hair colour"], "hi": ["हेयर कलर"]}.`); return undefined; }
  const out: Partial<Record<Language, string[]>> = {};
  for (const [lang, list] of Object.entries(v)) {
    if (!LANGUAGES.includes(lang as Language)) { errors.push(`${where} has a name in "${lang}", which is not a language I know.`); continue; }
    if (!Array.isArray(list) || list.length === 0 || list.some((n) => typeof n !== "string" || n.trim() === "")) { errors.push(`${where}: the names in "${lang}" must be a list of words.`); continue; }
    out[lang as Language] = list.map((n: string) => n.trim());
  }
  if (!out.en) { errors.push(`${where} needs an English name ("en"): it is the fallback every language uses.`); return undefined; }
  return out as Names;
}

function readNamed(v: unknown, singular: string, plural: string, errors: string[]): { id: string; names: Names }[] {
  if (!Array.isArray(v) || v.length === 0) { errors.push(`List the ${plural} ("${plural}"), each with an id and names.`); return []; }
  const out: { id: string; names: Names }[] = [];
  for (const [i, e] of v.entries()) {
    const where = `${singular} number ${i + 1}`;
    if (!isObj(e)) { errors.push(`${where} must be an object with an id and names.`); continue; }
    unknownKeys(e, ["id", "names"], where, errors);
    if (typeof e.id !== "string" || !ID.test(e.id)) { errors.push(`${where} needs an id of lowercase letters, digits and dashes.`); continue; }
    if (out.some((o) => o.id === e.id)) errors.push(`The ${singular} id "${e.id}" is used twice.`);
    const names = readNames(e.names, `${singular} "${e.id}"`, errors);
    if (names) out.push({ id: e.id, names });
  }
  return out;
}

function readSuppliers(v: unknown, languages: Language[], errors: string[]): Supplier[] {
  if (!Array.isArray(v) || v.length === 0) { errors.push("List the approved suppliers (\"suppliers\"): an id, a name and a WhatsApp number each."); return []; }
  const out: Supplier[] = [];
  for (const [i, e] of v.entries()) {
    const where = `supplier number ${i + 1}`;
    if (!isObj(e)) { errors.push(`${where} must be an object.`); continue; }
    unknownKeys(e, ["id", "name", "aliases", "whatsapp", "language", "approved"], where, errors);
    if (typeof e.id !== "string" || !ID.test(e.id)) { errors.push(`${where} needs an id of lowercase letters, digits and dashes.`); continue; }
    if (out.some((o) => o.id === e.id)) errors.push(`The supplier id "${e.id}" is used twice.`);
    if (typeof e.name !== "string" || e.name.trim() === "") errors.push(`Supplier "${e.id}" needs a name.`);
    if (typeof e.whatsapp !== "string" || !PHONE.test(e.whatsapp)) errors.push(`Supplier "${e.id}" needs a WhatsApp number like +919812345678.`);
    if (e.aliases !== undefined && (!Array.isArray(e.aliases) || e.aliases.some((a) => typeof a !== "string" || a.trim() === ""))) errors.push(`Supplier "${e.id}": "aliases" must be a list of names.`);
    const language = e.language ?? languages[0];
    if (!LANGUAGES.includes(language as Language)) errors.push(`Supplier "${e.id}": the language must be one of ${languageList()}.`);
    if (e.approved !== undefined && typeof e.approved !== "boolean") errors.push(`Supplier "${e.id}": "approved" must be true or false.`);
    out.push({ id: e.id, name: String(e.name ?? "").trim(), aliases: Array.isArray(e.aliases) ? (e.aliases as string[]).map((a) => a.trim()) : [], whatsapp: String(e.whatsapp ?? ""), language: language as Language, approved: e.approved !== false });
  }
  const numbers = out.map((s) => s.whatsapp);
  for (const n of new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))) errors.push(`Two suppliers have the number ${n}: a reply could not be told apart.`);
  return out;
}

function readCatalogue(v: unknown, items: Item[], units: Unit[], suppliers: Supplier[], errors: string[]): Line[] {
  if (!Array.isArray(v) || v.length === 0) { errors.push("List the catalogue (\"catalogue\"): each line is an item, a supplier, a unit and the last price."); return []; }
  const out: Line[] = [];
  for (const [i, e] of v.entries()) {
    const where = `catalogue line ${i + 1}`;
    if (!isObj(e)) { errors.push(`${where} must be an object.`); continue; }
    unknownKeys(e, ["item", "supplier", "unit", "priceInr", "reorderQty"], where, errors);
    if (!items.some((x) => x.id === e.item)) errors.push(`${where}: the item ${JSON.stringify(e.item)} is not in "items".`);
    if (!suppliers.some((x) => x.id === e.supplier)) errors.push(`${where}: the supplier ${JSON.stringify(e.supplier)} is not in "suppliers".`);
    if (!units.some((x) => x.id === e.unit)) errors.push(`${where}: the unit ${JSON.stringify(e.unit)} is not in "units".`);
    if (!isMoney(e.priceInr)) errors.push(`${where}: the price (\"priceInr\") must be a number of rupees above 0 with at most two decimals.`);
    if (e.reorderQty !== undefined && (!isWhole(e.reorderQty) || e.reorderQty < 1)) errors.push(`${where}: \"reorderQty\" must be a whole number of at least 1, or left out.`);
    if (out.some((o) => o.item === e.item && o.supplier === e.supplier && o.unit === e.unit)) errors.push(`${where}: the same item, supplier and unit is listed twice.`);
    out.push({ item: String(e.item), supplier: String(e.supplier), unit: String(e.unit), priceInr: Number(e.priceInr), ...(isWhole(e.reorderQty) ? { reorderQty: e.reorderQty } : {}) });
  }
  return out;
}

function readLimits(v: unknown, errors: string[]): Settings["limits"] | undefined {
  if (!isObj(v)) { errors.push("Add the limits (\"limits\": maxPerOrderInr, monthlyBudgetInr)."); return undefined; }
  unknownKeys(v, ["maxPerOrderInr", "monthlyBudgetInr", "maxQuantity"], "\"limits\"", errors);
  // whole rupees: the owner tightens them by a tap (chat-limits.ts), and those limits are whole numbers
  if (!isMoney(v.maxPerOrderInr) || !Number.isInteger(v.maxPerOrderInr)) errors.push("\"limits.maxPerOrderInr\" must be a whole number of rupees above 0: the most one order may be worth.");
  if (!isMoney(v.monthlyBudgetInr) || !Number.isInteger(v.monthlyBudgetInr)) errors.push("\"limits.monthlyBudgetInr\" must be a whole number of rupees above 0: the most a month's orders may add up to.");
  const maxQuantity = v.maxQuantity ?? 500;
  if (!isWhole(maxQuantity) || maxQuantity < 1) errors.push("\"limits.maxQuantity\" must be a whole number of at least 1.");
  return errors.length === 0 || (isMoney(v.maxPerOrderInr) && isMoney(v.monthlyBudgetInr)) ? { maxPerOrderInr: Number(v.maxPerOrderInr), monthlyBudgetInr: Number(v.monthlyBudgetInr), maxQuantity: Number(maxQuantity) } : undefined;
}

function readFollowUp(v: unknown, errors: string[]): number[] {
  if (v === undefined) return [4, 24];
  if (!Array.isArray(v) || v.length === 0 || v.some((h, i) => !isWhole(h) || h < 1 || (i > 0 && h <= (v[i - 1] as number)))) { errors.push("\"followUpHours\" must be a list of whole hours, each later than the one before, for example [4, 24]."); return [4, 24]; }
  return v as number[];
}

// ---- reading the catalogue --------------------------------------------------------------------------------------------------

export const itemOf = (s: Settings, id: string): Item => s.items.find((i) => i.id === id)!;
export const unitOf = (s: Settings, id: string): Unit => s.units.find((u) => u.id === id)!;
export const supplierOf = (s: Settings, id: string): Supplier => s.suppliers.find((x) => x.id === id)!;
/** What an item or unit is called in a language: its first name there, or its English one. */
export const nameIn = (n: Names, language: Language): string => (n[language] ?? n.en)[0];
export const lineKey = (l: Pick<Line, "item" | "supplier" | "unit">): string => `${l.item}~${l.supplier}~${l.unit}`;
export const lineByKey = (s: Settings, key: string): Line | undefined => s.catalogue.find((l) => lineKey(l) === key);
/** The paise in a price: totals are worked out in whole paise so rupees with decimals never drift. */
export const paise = (rupees: number): number => Math.round(rupees * 100);
