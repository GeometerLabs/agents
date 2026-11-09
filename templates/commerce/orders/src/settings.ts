// A shop's settings: everything a builder changes to tailor the Orders pathway. No code, only this file.
// Validation is written by hand and says what is wrong in plain words, so a builder can fix it without a manual.
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { readApprovers } from "../../../../modules/approvals/people.ts";
import type { ApproversSettings } from "../../../../modules/approvals/people.ts";
import { isValidTimeZone, parseClock } from "../../../../modules/core/time.ts";
import { DEFAULT_CAPS } from "../../../../modules/payments/guard-limits.ts";
import { readPaymentSettings } from "../../../../modules/payments/upi/settings.ts";
import type { PaymentSettings } from "../../../../modules/payments/upi/settings.ts";

const languageList = () => LANGUAGES.map((l) => `"${l}" (${LANGUAGE_NAMES[l]})`).join(", ");

export interface MenuItem {
  id: string;
  /** What customers call it, per language. The first name is the one the agent says; the rest are synonyms. */
  names: Partial<Record<Language, string[]>>;
  /** Whole rupees for one. This is also the floor: the agent never quotes or agrees below it. */
  priceInr: number;
  /** The most of this item the shop makes for one day. The agent never takes an order past it. */
  dailyStock: number;
}

/** The day an order closes for a slot: this many days before the slot's day, at this time ("20:00"). 0 days is the same day. */
export interface Cutoff { daysBefore: number; time: string }

export interface Slot {
  /** Lowercase letters, digits and dashes: "lunch", "eve-2". */
  id: string;
  /** The window as the customer sees it, "12:00" to "13:00" in the shop's time zone. */
  from: string;
  to: string;
  /** What customers call it, per language ("lunch", "dinner"): a customer who writes one means this slot. */
  names?: Partial<Record<Language, string[]>>;
  /** This slot's own cut-off. Left out: the shop's `cutoff`. */
  cutoff?: Cutoff;
}

export interface Settings {
  name: string;
  address?: string;
  timezone: string;
  /** Customer-facing; the first is the default. */
  languages: Language[];
  menu: MenuItem[];
  orders: {
    /** The most orders for one day. The agent never confirms one past it. */
    maxPerDay: number;
    /** The most items (counting each one) in one order. It bounds what a payment link can be, so Guard can hold the same number. */
    maxItemsPerOrder: number;
    /** How many days ahead an order may be for (0 is today only). */
    daysAhead: number;
  };
  /** The shop's usual cut-off; a slot may have its own. */
  cutoff: Cutoff;
  pickup: { slots: Slot[] };
  /** Left out: the shop does not deliver. `area` is a plain list of places; an address that names none of them is not delivered to. */
  delivery?: { slots: Slot[]; area: string[] };
  /** The advance the customer pays to confirm: all of the order ("full") or a part of it ("part", `percent` of the total, rounded up to a whole rupee). */
  advance: { mode: "full" | "part"; percent: number; holdMinutes: number };
  cancellation: {
    /** Cancel at least this long before the slot starts and the advance is refunded; later and the owner decides. */
    windowHours: number;
  };
  /** The agent refunds up to and including this amount alone; anything above needs the owner (Guard holds it). It is the same number Guard's threshold is made from. */
  refund: { limitInr: number };
  /**
   * How customers pay the advance (modules/payments/upi/settings.ts): "upi", the shop's own UPI ID, marked paid by the owner; or "razorpay", the shop's own account.
   * Required (B71): a file without it is refused and asked for the UPI ID, never read as a gateway shop.
   */
  payment: PaymentSettings;
  owner: {
    whatsapp: string;
    language: Language;
    /** An order whose total is above this goes to the owner before any payment is asked. 0: never. */
    approveOverInr: number;
  };
  /** Others who may approve a refund Guard holds, and the amount above which two must (B37, modules/approvals/people.ts). Left out: the owner alone. */
  approvers?: ApproversSettings;
}

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const PHONE = /^\+\d{10,15}$/;

/** Check a settings object (usually parsed from JSON), fill in the defaults and say what is wrong in plain words. */
export function validateSettings(input: unknown): SettingsResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["The settings must be an object with the shop's name, menu, slots and so on."] };
  unknownKeys(input, ["name", "address", "timezone", "languages", "menu", "orders", "cutoff", "pickup", "delivery", "advance", "cancellation", "refund", "payment", "owner", "approvers"], "the settings", errors);

  const name = input.name;
  if (typeof name !== "string" || name.trim() === "") errors.push("Add the shop's name (\"name\").");
  const address = input.address;
  if (address !== undefined && typeof address !== "string") errors.push("The address (\"address\") must be text.");
  const timezone = input.timezone ?? "Asia/Kolkata";
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) errors.push(`The time zone ${JSON.stringify(timezone)} is not one I know. Use a name like "Asia/Kolkata".`);

  const languages = readLanguages(input.languages, errors);
  const menu = readMenu(input.menu, languages, errors);
  const orders = readOrders(input.orders, menu, errors);
  const cutoff = readCutoff(input.cutoff, "the cut-off (\"cutoff\")", errors, { daysBefore: 1, time: "20:00" });
  const pickup = readSlots(input.pickup, "pickup", new Set<string>(), errors, true);
  const delivery = readDelivery(input.delivery, new Set(pickup.map((s) => s.id)), errors);
  const advance = readAdvance(input.advance, errors);
  const cancellation = readCancellation(input.cancellation, errors);
  const refund = readRefund(input.refund, errors);
  const payment = readPayment(input.payment, errors);
  const owner = readOwner(input.owner, errors);
  const approvers = readApprovers(input.approvers, { ownerWhatsapp: owner?.whatsapp, refundLimitInr: refund?.limitInr }, errors);

  if (errors.length === 0 && orders && menu.length > 0 && highestOrderInr({ menu, orders } as Settings) * 100 > DEFAULT_CAPS.refundPaisePerDay) {
    errors.push(`One order can come to ₹${highestOrderInr({ menu, orders } as Settings).toLocaleString("en-IN")} (the most items in an order, all of your dearest item), which is more than the ₹${(DEFAULT_CAPS.refundPaisePerDay / 100).toLocaleString("en-IN")} that can be refunded in a day. Lower "orders.maxItemsPerOrder" or the price.`);
  }
  if (errors.length > 0) return { ok: false, errors };
  const settings: Settings = {
    name: (name as string).trim(), timezone: timezone as string, languages, menu, orders: orders as Settings["orders"], cutoff: cutoff as Cutoff, pickup: { slots: pickup },
    advance: advance as Settings["advance"], cancellation: cancellation as Settings["cancellation"], refund: refund as Settings["refund"], payment: payment as Settings["payment"], owner: owner as Settings["owner"],
  };
  if (delivery) settings.delivery = delivery;
  if (approvers) settings.approvers = approvers;
  if (typeof address === "string") settings.address = address;
  return { ok: true, settings };
}

/** Like validateSettings, but throws one error that lists every problem. For scripts and tests. */
export function parseSettings(input: unknown): Settings {
  const result = validateSettings(input);
  if (!result.ok) throw new Error(`These settings need fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

// ---- helpers other files use ---------------------------------------------------------------------------------------

/** The name the agent says for an item in a language, falling back to the first language that has one. */
export function itemName(item: MenuItem, language: Language): string {
  return item.names[language]?.[0] ?? item.names.en?.[0] ?? item.names.hi?.[0] ?? item.names.ml?.[0] ?? item.names.kn?.[0] ?? item.id;
}

export const itemOf = (settings: Settings, id: string | undefined): MenuItem | undefined => settings.menu.find((i) => i.id === id);

/** Every slot, pickup first, each with the mode it belongs to. */
export function allSlots(settings: Settings): { slot: Slot; mode: "pickup" | "delivery" }[] {
  return [...settings.pickup.slots.map((slot) => ({ slot, mode: "pickup" as const })), ...(settings.delivery?.slots ?? []).map((slot) => ({ slot, mode: "delivery" as const }))];
}

export const slotOf = (settings: Settings, id: string | undefined): { slot: Slot; mode: "pickup" | "delivery" } | undefined => allSlots(settings).find((s) => s.slot.id === id);

/** The cut-off a slot has: its own or the shop's. */
export const cutoffOf = (settings: Settings, slot: Slot): Cutoff => slot.cutoff ?? settings.cutoff;

/** The dearest an order can be, in rupees: the most items, all of the dearest item. It bounds a payment link and a refund, so Guard can hold the same number. */
export const highestOrderInr = (settings: Settings): number => settings.orders.maxItemsPerOrder * Math.max(...settings.menu.map((i) => i.priceInr));

/** The least any one payment link can be for, in rupees. */
export const LOWEST_LINK_INR = 1;

/** The advance for an order total, in whole rupees: all of it, or the percentage rounded up (never 0, never more than the total). */
export function advanceFor(settings: Settings, totalInr: number): number {
  if (settings.advance.mode === "full") return totalInr;
  return Math.min(totalInr, Math.max(1, Math.ceil((totalInr * settings.advance.percent) / 100)));
}

// ---- readers: each pushes plain-words problems and returns a best-effort value ---------------------------------------

function unknownKeys(obj: Obj, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`I don't know what "${key}" means in ${where}. Allowed: ${allowed.join(", ")}.`);
  }
}

function readWhole(v: unknown, label: string, min: number, max: number, errors: string[], why?: string): number | undefined {
  if (!isWhole(v)) { errors.push(`Set ${label} as a whole number, for example ${Math.max(min, 1)}.`); return undefined; }
  if (v < min || v > max) { errors.push(`${label.charAt(0).toUpperCase() + label.slice(1)} must be between ${min} and ${max}, not ${v}${why ? ` (${why})` : ""}.`); return undefined; }
  return v;
}

function readLanguages(v: unknown, errors: string[]): Language[] {
  if (v === undefined) return ["hi", "en"];
  if (!Array.isArray(v) || v.length === 0) { errors.push("List at least one customer language (\"languages\"), for example [\"hi\", \"en\"]."); return ["hi", "en"]; }
  const out: Language[] = [];
  for (const l of v) {
    if (!LANGUAGES.includes(l as Language)) errors.push(`The language ${JSON.stringify(l)} is not supported yet. Use one of ${languageList()}.`);
    else if (out.includes(l as Language)) errors.push(`The language "${l}" is listed twice.`);
    else out.push(l as Language);
  }
  return out.length > 0 ? out : ["hi", "en"];
}

function readMenu(v: unknown, languages: Language[], errors: string[]): MenuItem[] {
  if (!Array.isArray(v) || v.length === 0) { errors.push("Add at least one menu item (\"menu\") with a name, a price in rupees and a daily stock."); return []; }
  const items: MenuItem[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Map<string, string>();
  v.forEach((raw, i) => {
    const label = isObj(raw) && typeof raw.id === "string" ? `Item "${raw.id}"` : `Item number ${i + 1}`;
    if (!isObj(raw)) { errors.push(`${label} must be an object with id, names, priceInr and dailyStock.`); return; }
    unknownKeys(raw, ["id", "names", "priceInr", "dailyStock"], label, errors);
    const id = raw.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) errors.push(`${label} needs an id made of lowercase letters, digits and dashes, for example "veg-thali".`);
    else if (seenIds.has(id)) errors.push(`Two items share the id "${id}". Each id must be different.`);
    else seenIds.add(id);

    const names: MenuItem["names"] = {};
    if (!isObj(raw.names)) {
      errors.push(`${label} needs "names": what customers call it, per language, for example {"en": ["veg thali"], "hi": ["वेज थाली"]}.`);
    } else {
      unknownKeys(raw.names, [...LANGUAGES], `${label}'s names`, errors);
      for (const lang of languages) {
        const list = raw.names[lang];
        if (!Array.isArray(list) || list.length === 0 || !list.every((n) => typeof n === "string" && n.trim() !== "")) {
          errors.push(`${label} needs at least one name in ${LANGUAGE_NAMES[lang]} ("${lang}"), because customers can write in it.`);
          continue;
        }
        names[lang] = list.map((n: string) => n.trim());
        for (const n of names[lang]!) {
          const key = n.toLowerCase();
          const other = seenNames.get(key);
          if (other !== undefined && other !== String(id)) errors.push(`The name "${n}" is used by both "${other}" and "${String(id)}", so the agent could not tell which one a customer means.`);
          else seenNames.set(key, String(id));
        }
      }
    }
    const priceOk = isWhole(raw.priceInr) && raw.priceInr >= 1 && raw.priceInr <= 100_000;
    if (!priceOk) errors.push(`${label} needs a price in whole rupees ("priceInr"), for example 120. It is also the lowest price the agent will ever agree to.`);
    const stockOk = isWhole(raw.dailyStock) && raw.dailyStock >= 1 && raw.dailyStock <= 10_000;
    if (!stockOk) errors.push(`${label} needs the most you make in a day ("dailyStock"), a whole number from 1, for example 40.`);
    if (typeof id === "string" && priceOk && stockOk) items.push({ id, names, priceInr: raw.priceInr as number, dailyStock: raw.dailyStock as number });
  });
  return items;
}

function readOrders(v: unknown, menu: MenuItem[], errors: string[]): Settings["orders"] | undefined {
  if (!isObj(v)) { errors.push("Add the order limits (\"orders\"): {\"maxPerDay\": 30, \"maxItemsPerOrder\": 10, \"daysAhead\": 7}."); return undefined; }
  unknownKeys(v, ["maxPerDay", "maxItemsPerOrder", "daysAhead"], "the order limits", errors);
  const maxPerDay = readWhole(v.maxPerDay, "the most orders in a day (\"orders.maxPerDay\")", 1, 10_000, errors);
  const maxItems = readWhole(v.maxItemsPerOrder, "the most items in one order (\"orders.maxItemsPerOrder\")", 1, 100, errors, "a payment link is bound to this many of your dearest item");
  const daysAhead = v.daysAhead === undefined ? 7 : readWhole(v.daysAhead, "how many days ahead an order may be (\"orders.daysAhead\")", 0, 60, errors);
  void menu;
  return maxPerDay === undefined || maxItems === undefined || daysAhead === undefined ? undefined : { maxPerDay, maxItemsPerOrder: maxItems, daysAhead };
}

function readCutoff(v: unknown, label: string, errors: string[], fallback?: Cutoff): Cutoff | undefined {
  if (v === undefined && fallback) return fallback;
  if (!isObj(v)) { errors.push(`Add ${label}: {"daysBefore": 1, "time": "20:00"} closes orders at 8 pm the evening before.`); return undefined; }
  unknownKeys(v, ["daysBefore", "time"], label, errors);
  const daysBefore = v.daysBefore === undefined ? 0 : readWhole(v.daysBefore, `the days before (${label})`, 0, 7, errors);
  const time = v.time;
  if (typeof time !== "string" || parseClock(time) === null) { errors.push(`The cut-off time in ${label} must be a 24-hour time like "20:00".`); return undefined; }
  return daysBefore === undefined ? undefined : { daysBefore, time };
}

function readSlots(v: unknown, where: "pickup" | "delivery", used: Set<string>, errors: string[], required: boolean): Slot[] {
  const raw = isObj(v) ? v.slots : undefined;
  if (!isObj(v)) { if (required) errors.push(`Add the ${where} slots ("${where}"): {"slots": [{"id": "lunch", "from": "12:00", "to": "13:00"}]}.`); return []; }
  unknownKeys(v, where === "delivery" ? ["slots", "area"] : ["slots"], `the ${where} slots`, errors);
  if (!Array.isArray(raw) || raw.length === 0) { errors.push(`List at least one ${where} slot ("${where}.slots").`); return []; }
  const slots: Slot[] = [];
  raw.forEach((s, i) => {
    const label = isObj(s) && typeof s.id === "string" ? `The ${where} slot "${s.id}"` : `${where} slot number ${i + 1}`;
    if (!isObj(s)) { errors.push(`${label} must be an object with id, from and to.`); return; }
    unknownKeys(s, ["id", "from", "to", "names", "cutoff"], label, errors);
    const id = s.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) errors.push(`${label} needs an id made of lowercase letters, digits and dashes, for example "lunch".`);
    else if (used.has(id)) errors.push(`Two slots share the id "${id}". Each slot (pickup or delivery) needs its own id.`);
    else used.add(id);
    const from = typeof s.from === "string" ? parseClock(s.from) : null;
    const to = typeof s.to === "string" ? parseClock(s.to) : null;
    if (from === null || to === null) errors.push(`${label} needs "from" and "to" as 24-hour times like "12:00".`);
    else if (to <= from) errors.push(`${label} must end after it starts.`);
    const cutoff = s.cutoff === undefined ? undefined : readCutoff(s.cutoff, `${label}'s cut-off`, errors);
    const names = readSlotNames(s.names, label, errors);
    if (typeof id === "string" && from !== null && to !== null && to > from && (s.cutoff === undefined || cutoff)) slots.push({ id, from: s.from as string, to: s.to as string, ...(names ? { names } : {}), ...(cutoff ? { cutoff } : {}) });
  });
  return slots;
}

function readSlotNames(v: unknown, label: string, errors: string[]): Slot["names"] | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) { errors.push(`${label}'s names ("names") must look like {"en": ["lunch"], "hi": ["लंच"]}.`); return undefined; }
  unknownKeys(v, [...LANGUAGES], `${label}'s names`, errors);
  const names: NonNullable<Slot["names"]> = {};
  for (const lang of LANGUAGES) {
    const list = v[lang];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every((n) => typeof n === "string" && n.trim() !== "")) { errors.push(`${label}'s names in ${LANGUAGE_NAMES[lang]} ("${lang}") must be a list of words.`); continue; }
    names[lang] = list.map((n: string) => n.trim());
  }
  return names;
}

function readDelivery(v: unknown, used: Set<string>, errors: string[]): Settings["delivery"] | undefined {
  if (v === undefined) return undefined;
  const slots = readSlots(v, "delivery", used, errors, true);
  const area = isObj(v) ? v.area : undefined;
  const places: string[] = [];
  if (!Array.isArray(area) || area.length === 0 || !area.every((a) => typeof a === "string" && a.trim() !== "")) errors.push("List the places you deliver to (\"delivery.area\"), for example [\"Kakkanad\", \"Edappally\"]. An address that names none of them is not delivered to.");
  else for (const a of area) { const p = (a as string).trim(); if (places.some((x) => x.toLowerCase() === p.toLowerCase())) errors.push(`The place "${p}" is listed twice.`); else places.push(p); }
  return slots.length > 0 && places.length > 0 ? { slots, area: places } : undefined;
}

function readAdvance(v: unknown, errors: string[]): Settings["advance"] | undefined {
  const fallback = { mode: "part" as const, percent: 50, holdMinutes: 30 };
  if (v === undefined) return fallback;
  if (!isObj(v)) { errors.push("The advance (\"advance\") must look like {\"mode\": \"part\", \"percent\": 50, \"holdMinutes\": 30}, or {\"mode\": \"full\"}."); return undefined; }
  unknownKeys(v, ["mode", "percent", "holdMinutes"], "the advance", errors);
  const mode = v.mode ?? "part";
  if (mode !== "full" && mode !== "part") { errors.push("The advance mode (\"advance.mode\") must be \"full\" (all of the order) or \"part\" (a percentage of it)."); return undefined; }
  const percent = mode === "full" ? 100 : v.percent === undefined ? 50 : readWhole(v.percent, "the advance percentage (\"advance.percent\")", 1, 99, errors, "use mode \"full\" for all of it");
  const holdMinutes = v.holdMinutes === undefined ? 30 : readWhole(v.holdMinutes, "how long an order is held for the advance (\"advance.holdMinutes\")", 5, 24 * 60, errors);
  return percent === undefined || holdMinutes === undefined ? undefined : { mode, percent, holdMinutes };
}

function readCancellation(v: unknown, errors: string[]): Settings["cancellation"] | undefined {
  if (!isObj(v)) { errors.push("Add the cancellation rule (\"cancellation\"): {\"windowHours\": 12}."); return undefined; }
  unknownKeys(v, ["windowHours"], "the cancellation rule", errors);
  const windowHours = readWhole(v.windowHours, "the cancellation window in hours (\"cancellation.windowHours\")", 0, 14 * 24, errors);
  return windowHours === undefined ? undefined : { windowHours };
}

function readRefund(v: unknown, errors: string[]): Settings["refund"] | undefined {
  if (!isObj(v)) { errors.push("Add the refund limit (\"refund\"): {\"limitInr\": 500}."); return undefined; }
  unknownKeys(v, ["limitInr"], "the refund limit", errors);
  const limitInr = readWhole(v.limitInr, "the refund limit (\"refund.limitInr\")", 0, 1_000_000, errors);
  return limitInr === undefined ? undefined : { limitInr };
}

/** The shared reader: a missing block is refused with the same words in every template (B71), asking for the UPI ID first. */
function readPayment(v: unknown, errors: string[]): Settings["payment"] | undefined {
  return readPaymentSettings(v, errors);
}

function readOwner(v: unknown, errors: string[]): Settings["owner"] | undefined {
  if (!isObj(v)) { errors.push("Add the owner (\"owner\") with their WhatsApp number, for example {\"whatsapp\": \"+919800000000\"}."); return undefined; }
  unknownKeys(v, ["whatsapp", "language", "approveOverInr"], "the owner", errors);
  const whatsapp = v.whatsapp;
  if (typeof whatsapp !== "string" || !PHONE.test(whatsapp)) errors.push("The owner's WhatsApp number (\"owner.whatsapp\") must start with + and the country code, then digits only, for example +919800000000.");
  const language = v.language ?? "en";
  const languageOk = LANGUAGES.includes(language as Language);
  if (!languageOk) errors.push(`The owner's language ("owner.language") must be one of ${languageList()}.`);
  const approveOverInr = v.approveOverInr === undefined ? 0 : readWhole(v.approveOverInr, "the order total above which you want to approve (\"owner.approveOverInr\"; 0 is never)", 0, 10_000_000, errors);
  return typeof whatsapp === "string" && PHONE.test(whatsapp) && languageOk && approveOverInr !== undefined ? { whatsapp, language: language as Language, approveOverInr } : undefined;
}
