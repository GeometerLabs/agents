// What a native reader sees of the report words: every string in strings.ts with the English beside it, and a sample of the owner's lines. The review sheet script
// (scripts/review-sheet.ts) puts this in the report section of the shop's REVIEW-hi.md, REVIEW-ml.md and REVIEW-kn.md. Every Hindi, Malayalam and Kannada line of the
// report and the go-live certificate is in STRINGS, so flattening it lists them all; nothing is kept in a second place.
import { glowSalon } from "../src/harness.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { buildStockReport } from "./data.ts";
import type { StockReport } from "./data.ts";
import { STRINGS } from "./strings.ts";
import { ownerText } from "./text.ts";

/** What each phrase that takes a number is shown with. */
const SAMPLE: Record<string, unknown[]> = {
  more: [12], budgetOf: ["₹9,000", "₹20,000"],
  "cert.held": [14, 15, 1, 12], "cert.budget": ["₹20,000"], "cert.cap": ["₹12,000"], "cert.maxQty": [200], "cert.suppliers": [2, 1], "cert.followUp": ["4, 24"],
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

/** A made-up month, so a reader sees the lines: 9 orders placed, 7 acknowledged, 4 received in full, a part delivery, a wrong item, and a budget part used. */
export function sampleReport(): StockReport {
  const settings = glowSalon();
  const base = buildStockReport({ settings, entries: [], orders: [], ...monthRange("2027-02", settings.timezone), source: "stand-in", madeAt: Date.UTC(2027, 2, 2, 4, 30) });
  return {
    ...base,
    orders: { placed: 9, sentOut: 9, acknowledged: 7, declinedBySupplier: 1, silent: 1, receivedFull: 4, partReceived: 1, wrongItem: 1, neverSent: 0, sendUnknown: 0 },
    owner: { asked: 11, approved: 9, saidNo: 1, voided: 1 },
    markedPaidByOwner: { orders: 2 },
    budget: { monthlyPaise: 2_000_000, usedPaise: 900_000, leftPaise: 1_100_000 },
    suppliers: [{ id: "ravi-traders", name: "Ravi Traders", placed: 5, acknowledged: 4, receivedFull: 3, partReceived: 1, wrongItem: 0, declined: 0, silent: 1 }],
    stopped: { total: 3, byRule: { ...base.stopped.byRule, "monthly-budget": 2, "approved-supplier-only": 1 } },
  };
}

export const sampleOwnerText = (language: Language): string => ownerText(sampleReport(), language);
