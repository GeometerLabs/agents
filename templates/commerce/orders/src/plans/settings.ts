// A shop's monthly plans (17 Nov 2026): the optional `plans` block of the Orders settings. A shop without it behaves exactly as Orders always did.
// A plan type is a meal the shop sends on set weekdays in one of its slots for one price a month, paid in advance. The block also holds the two rules the shop chooses:
// when a customer may still pause or skip a day (the cut-off, per meal day), and what happens to the days they do not take (carry the credit to the next month's
// payment, or refund it at month end). Written by hand and checked in plain words, like the rest of the settings, so a builder can fix a file without a manual.
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { Cutoff } from "../settings.ts";

export interface PlanType {
  /** Lowercase letters, digits and dashes: "lunch-weekdays". */
  id: string;
  /** What customers call it, per language. The first name is the one the agent says; the rest are what a customer may write to choose it. */
  names: Partial<Record<Language, string[]>>;
  /** The pickup or delivery slot every meal of this plan is in. The slot's own `maxOrders`, if it has one, counts these meals too. */
  slotId: string;
  /** The days of the week a meal is sent, 0 is Sunday to 6 is Saturday. */
  weekdays: number[];
  /** Whole rupees for one month (one period), paid in advance. */
  priceInr: number;
}

export interface PlansSettings {
  types: PlanType[];
  /** A meal day closes for pausing and skipping this long before it (the same shape as the order cut-off): {"daysBefore": 1, "time": "20:00"}. */
  cutoff: Cutoff;
  /** Days the customer did not take: "carry" them as a reduction of the next month's payment, or "refund" them at month end. Never both. */
  credits: "carry" | "refund";
}

const WEEKDAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** What the reader needs from the rest of the settings (so this file imports nothing from settings.ts at run time). */
export interface PlansContext {
  languages: Language[];
  slots: Map<string, "pickup" | "delivery">;
  /** The shop's own cut-off reader, for the pause and skip cut-off. */
  readCutoff: (v: unknown, label: string, errors: string[], fallback: Cutoff) => Cutoff | undefined;
  shopCutoff: Cutoff;
  /** The most that can be refunded in a day, in rupees: a plan's price is refunded whole if its customer cancels, so it must fit. */
  dailyRefundInr: number;
}

/** Read the `plans` block. Left out (undefined): no plans. Problems are pushed in plain words and a best-effort value returned. */
export function readPlans(v: unknown, ctx: PlansContext, errors: string[]): PlansSettings | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) { errors.push("The plans (\"plans\") must be an object: {\"types\": [...], \"credits\": \"carry\"}."); return undefined; }
  for (const key of Object.keys(v)) if (!["types", "cutoff", "credits"].includes(key)) errors.push(`I don't know what "${key}" means in the plans. Allowed: types, cutoff, credits.`);
  const credits = v.credits === undefined ? "carry" : v.credits;
  if (credits !== "carry" && credits !== "refund") errors.push("Say what happens to meal days the customer does not take (\"plans.credits\"): \"carry\" takes them off next month's payment, \"refund\" gives the money back at month end.");
  const cutoff = ctx.readCutoff(v.cutoff, "the plans' pause and skip cut-off (\"plans.cutoff\")", errors, ctx.shopCutoff);
  const types: PlanType[] = [];
  if (!Array.isArray(v.types) || v.types.length === 0) errors.push("List at least one plan (\"plans.types\"), for example {\"id\": \"lunch-weekdays\", \"names\": {\"en\": [\"lunch plan\"]}, \"slotId\": \"lunch\", \"weekdays\": [1,2,3,4,5], \"priceInr\": 2400}.");
  else v.types.forEach((raw, i) => {
    const label = isObj(raw) && typeof raw.id === "string" ? `Plan "${raw.id}"` : `Plan number ${i + 1}`;
    if (!isObj(raw)) { errors.push(`${label} must be an object with id, names, slotId, weekdays and priceInr.`); return; }
    for (const key of Object.keys(raw)) if (!["id", "names", "slotId", "weekdays", "priceInr"].includes(key)) errors.push(`I don't know what "${key}" means in ${label}. Allowed: id, names, slotId, weekdays, priceInr.`);
    const id = raw.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) errors.push(`${label} needs an id made of lowercase letters, digits and dashes, for example "lunch-weekdays".`);
    else if (types.some((t) => t.id === id)) errors.push(`Two plans share the id "${id}". Each id must be different.`);
    const names: PlanType["names"] = {};
    if (!isObj(raw.names)) errors.push(`${label} needs "names": what customers call it, per language, for example {"en": ["lunch plan"]}.`);
    else for (const lang of ctx.languages) {
      const list = raw.names[lang];
      if (!Array.isArray(list) || list.length === 0 || !list.every((n) => typeof n === "string" && n.trim() !== "")) errors.push(`${label} needs at least one name in "${lang}", because customers can write in it.`);
      else names[lang] = list.map((n: string) => n.trim());
    }
    if (isObj(raw.names)) for (const key of Object.keys(raw.names)) if (!(LANGUAGES as readonly string[]).includes(key)) errors.push(`${label} names a language "${key}" that is not supported.`);
    if (typeof raw.slotId !== "string" || !ctx.slots.has(raw.slotId)) errors.push(`${label} needs the id of one of your pickup or delivery slots ("slotId"). Yours: ${[...ctx.slots.keys()].join(", ")}.`);
    const days: number[] = [];
    if (!Array.isArray(raw.weekdays) || raw.weekdays.length === 0) errors.push(`${label} needs the days a meal is sent ("weekdays"), for example [1, 2, 3, 4, 5] (0 is Sunday) or ["mon", "tue"].`);
    else for (const d of raw.weekdays) {
      const n = typeof d === "string" ? WEEKDAY_NAMES[d.toLowerCase().slice(0, 3)] : d;
      if (!isWhole(n) || n < 0 || n > 6) errors.push(`${label}: ${JSON.stringify(d)} is not a day of the week. Use 0 (Sunday) to 6 (Saturday), or "mon" to "sun".`);
      else if (days.includes(n)) errors.push(`${label} lists the same weekday twice.`);
      else days.push(n);
    }
    const price = raw.priceInr;
    if (!isWhole(price) || price < 1 || price > 100_000) errors.push(`${label} needs the price of one month in whole rupees ("priceInr"), for example 2400.`);
    else if (price > ctx.dailyRefundInr) errors.push(`${label} costs ₹${price.toLocaleString("en-IN")} a month, which is more than the ₹${ctx.dailyRefundInr.toLocaleString("en-IN")} that can be refunded in a day: a customer who cancels could not be paid back. Lower the price.`);
    if (typeof id === "string" && typeof raw.slotId === "string" && ctx.slots.has(raw.slotId) && days.length > 0 && isWhole(price) && Object.keys(names).length === ctx.languages.length) types.push({ id, names, slotId: raw.slotId, weekdays: days.sort(), priceInr: price });
  });
  return cutoff && types.length > 0 && (credits === "carry" || credits === "refund") ? { types, cutoff, credits } : undefined;
}

export const planTypeOf = (plans: PlansSettings | undefined, id: string | undefined): PlanType | undefined => plans?.types.find((t) => t.id === id);

/** The name the agent says for a plan in a language, falling back to the first language that has one. */
export const planName = (type: PlanType, language: Language): string => type.names[language]?.[0] ?? type.names.en?.[0] ?? Object.values(type.names)[0]?.[0] ?? type.id;

/** The dearest a plan's payment can be, in rupees (0 for none): it bounds a payment link, so Guard can hold the same number. */
export const highestPlanInr = (plans: PlansSettings | undefined): number => Math.max(0, ...(plans?.types.map((t) => t.priceInr) ?? []));
