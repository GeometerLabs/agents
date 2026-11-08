// What a native reader sees of the report words: every string in strings.ts with the English beside it, and a sample of the owner's five lines.
// A review sheet puts this in the report section of the shop's REVIEW-hi.md, REVIEW-ml.md and REVIEW-kn.md.
import { annapurna } from "../src/harness.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { buildOrdersReport } from "./data.ts";
import type { OrdersReport } from "./data.ts";
import { STRINGS } from "./strings.ts";
import { ownerText } from "./text.ts";

/** What each phrase that takes a number is shown with. */
const SAMPLE: Record<string, unknown[]> = {
  more: [12],
  "cert.held": [25, 26, 1, 12], "cert.menu": ["Veg thali ₹120 (12) · Curd ₹20 (30)"], "cert.orderLimits": [8, 10, 7], "cert.cutoff": [1, "20:00"], "cert.advance": [false, 50, 30],
  "cert.delivery": ["Kakkanad, Edappally, Infopark"], "cert.window": [6], "cert.refund": ["₹300"], "cert.approve": ["₹1,000"],
  "goLive.own": ["2 Nov 2026"], "goLive.example": ["2 Nov 2026"], "goLive.different": ["2 Nov 2026"], "goLive.signedWith": ["key-3f9a1c"],
};

export interface StringRow { id: string; text: string; english: string }

function flatten(value: unknown, path: string, out: Map<string, string>): void {
  if (typeof value === "string") out.set(path, value);
  else if (typeof value === "function") out.set(path, (value as (...a: unknown[]) => string)(...(SAMPLE[path] ?? [])));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
}

export function reportStringRows(language: Language): StringRow[] {
  const mine = new Map<string, string>();
  const english = new Map<string, string>();
  flatten(STRINGS[language], "", mine);
  flatten(STRINGS.en, "", english);
  return [...mine].filter(([, text]) => text !== "").map(([id, text]) => ({ id, text, english: english.get(id) ?? "" })); // an empty phrase (no tag for a live report) has nothing to review
}

/** A made-up month, so a reader sees the five lines: ₹24,000 of advance collected, ₹9,000 still to collect at pickup, and a few things asked and stopped. */
export function sampleReport(): OrdersReport {
  const settings = annapurna();
  const base = buildOrdersReport({ settings, entries: [], orders: [], ...monthRange("2027-02", settings.timezone), source: "stand-in", madeAt: Date.UTC(2027, 2, 2, 4, 30) });
  return {
    ...base,
    money: { collected: { count: 41, paise: 2_400_000 }, givenBack: { count: 2, paise: 60_000 } },
    orders: { taken: 41, completed: 36, cancelled: 3, holdsRanOut: 5 },
    sold: { orders: 38, pickup: 30, delivery: 8, items: [{ id: "veg-thali", names: { en: "Veg thali", hi: "वेज थाली", ml: "Veg thali", kn: "Veg thali" }, qty: 61 }], toCollect: { count: 6, paise: 900_000 } },
    owner: { asked: 3, approved: 2, denied: 1 },
    customers: { stopped: 1 },
    stopped: { total: 7, byRule: { ...base.stopped.byRule, "within-stock": 3, "before-cutoff": 2, "within-delivery-area": 1, "refund-limit": 1 } },
  };
}

export const sampleOwnerText = (language: Language): string => ownerText(sampleReport(), language);
