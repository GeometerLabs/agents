// What a native reader sees of the report words: every string in strings.ts with the English beside it, and a sample of the owner's five lines.
// scripts/review-sheet.ts puts this in the report section of REVIEW-ml.md and REVIEW-kn.md.
import { brightTuition } from "../src/harness.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { buildFeesReport } from "./data.ts";
import type { FeesReport } from "./data.ts";
import { STRINGS } from "./strings.ts";
import { ownerText } from "./text.ts";

/** What each phrase that takes a number is shown with. */
const SAMPLE: Record<string, unknown[]> = {
  more: [12],
  "cert.held": [25, 26, 1, 12], "cert.fees": ["class 8 ₹1,200 · class 10 ₹1,800"], "cert.due": [5, 5], "cert.lateFee": ["₹100"], "cert.reminders": ["-3, 0, +5", 10, 3], "cert.partPayments": ["₹300"],
  "cert.waiver": ["₹100"], "cert.refund": ["₹500"], "cert.students": [44],
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

/** A made-up month, so a reader sees the five lines: ₹1,20,000 collected, ₹18,000 still to collect from three students, and a few things asked, stopped and taken off. */
export function sampleReport(): FeesReport {
  const settings = brightTuition();
  const base = buildFeesReport({ settings, entries: [], dues: [], ...monthRange("2027-02", settings.timezone), source: "stand-in", madeAt: Date.UTC(2027, 2, 2, 4, 30) });
  return {
    ...base,
    money: { collected: { count: 41, paise: 12_000_000 }, givenBack: { count: 1, paise: 150_000 } },
    fees: { opened: 44, paidInFull: 38, partlyPaid: 1, stillOpen: 6, stillToCollect: { count: 3, paise: 1_800_000 } },
    waivers: { total: { count: 3, paise: 200_000 }, byOwner: { count: 1, paise: 100_000 }, withinLimit: { count: 2, paise: 100_000 }, lateFeesAdded: { count: 5, paise: 50_000 } },
    owner: { asked: 3, approved: 2, denied: 1 },
    reminders: { sent: 96, byLanguage: { hi: 40, en: 30, ml: 14, kn: 12 }, receipts: 41 },
    parents: { stopped: 1 },
    stopped: { total: 5, byRule: { ...base.stopped.byRule, "no-reminder-once-paid": 2, "opt-out": 2, "refund-limit": 1 } },
  };
}

export const sampleOwnerText = (language: Language): string => ownerText(sampleReport(), language);
