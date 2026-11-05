// What a native reader sees of the report and certificate words: every string in strings.ts with the English beside it, and
// a sample of the owner's five lines. scripts/review-sheet.ts puts this in section 6 of REVIEW-ml.md and REVIEW-kn.md.
import { glowSalon } from "../src/harness.ts";
import { formatInr } from "../../../modules/language/format.ts";
import { serviceName } from "../src/settings.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { buildMonthlyReport } from "./data.ts";
import { monthRange } from "../../../modules/report/months.ts";
import type { MonthlyReport } from "./data.ts";
import { STRINGS } from "./strings.ts";
import { ownerText } from "./text.ts";

/** What each phrase that takes a number or an amount is shown with. */
const SAMPLE: Record<string, unknown[]> = {
  more: [12], "cert.held": [29, 31, 2, 14], "cert.floor": ["…"], "cert.deposit": ["₹200", 15], "cert.cancel": [24], "cert.refund": ["₹200"], "cert.countedIntro": ["Nov 2026"],
  "goLive.own": ["Tue 10 Nov 2026"], "goLive.example": ["Tue 10 Nov 2026"], "goLive.different": ["Tue 10 Nov 2026"], "goLive.signedWith": ["key:3f9a1c…"],
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

/** A made-up month in the shape of the brief's example (38 bookings, ₹17,600 in deposits), so a reader sees the five lines. */
export function sampleReport(): MonthlyReport {
  const settings = glowSalon();
  const base = buildMonthlyReport({ settings, entries: [], bookings: [], ...monthRange("2027-02", settings.timezone), source: "stand-in", madeAt: Date.UTC(2027, 2, 2, 4, 30) });
  return {
    ...base,
    bookings: { made: 38, cancelled: 3, moved: 2, droppedBeforeBooked: 1 },
    money: { deposits: { count: 88, paise: 1_760_000 }, refunds: { count: 2, paise: 40_000, ofDeposits: { count: 2, paise: 40_000 }, ofSecondPayments: { count: 0, paise: 0 } } },
    owner: { asked: 3, approved: 2, denied: 1, retried: 0 },
    stopped: { total: 5, byRule: { ...base.stopped.byRule, "price-at-or-above-list": 3, "no-double-booking": 1, "within-hours": 1 } },
    unconfirmed: { open: 1, openOnBookings: 1, settledLater: 0, rows: [{ seq: 9, action: "confirm_booking", outcome: "unconfirmed", booking: "b-9", settledLater: false }] },
  };
}

export const sampleOwnerText = (language: Language): string => ownerText(sampleReport(), language);

/** The go-live certificate's limits line, as a sample, so the reader sees how the shop's prices are listed. */
export const sampleFloor = (language: Language): string => glowSalon().services.map((s) => `${serviceName(s, language)} ${formatInr(s.priceInr)}`).join(" · ");
