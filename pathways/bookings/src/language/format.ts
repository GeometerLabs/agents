// How amounts, dates and times are written, per language. This is the ONLY place those formats live:
// the templates write with these functions and the outgoing check reads with the same tables.
import type { Language } from "../settings.ts";
import { localParts } from "./../time.ts";
import type { LocalDate, LocalTime } from "../time.ts";

// Index 0 is Sunday and month 1 is index 0, the same as Date#getDay() and Date#getMonth().
export const WEEKDAY_NAMES: Record<Language, string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  hi: ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"],
};

export const MONTH_NAMES: Record<Language, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  hi: ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
};

/** Hindi says which part of the day it is: "शाम 6:00 बजे" (6:00 in the evening). */
export const HINDI_PERIODS = { morning: "सुबह", noon: "दोपहर", evening: "शाम", night: "रात" } as const;

export function hindiPeriod(hour24: number): string {
  if (hour24 >= 5 && hour24 < 12) return HINDI_PERIODS.morning;
  if (hour24 >= 12 && hour24 < 16) return HINDI_PERIODS.noon;
  if (hour24 >= 16 && hour24 < 20) return HINDI_PERIODS.evening;
  return HINDI_PERIODS.night;
}

/** "₹450", "₹1,200", "₹12,500", "₹1,25,000": whole rupees with Indian digit grouping. */
export function formatInr(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/** English "Tue 11 Nov"; Hindi "मंगलवार, 11 नवंबर". The weekday is computed from the date, never passed in. */
export function formatDate(d: LocalDate, language: Language): string {
  const weekday = WEEKDAY_NAMES[language][new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
  const month = MONTH_NAMES[language][d.month - 1];
  return language === "hi" ? `${weekday}, ${d.day} ${month}` : `${weekday} ${d.day} ${month}`;
}

/** English "6:00 pm"; Hindi "शाम 6:00 बजे". */
export function formatTime(t: LocalTime, language: Language): string {
  const minute = String(t.minute).padStart(2, "0");
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  if (language === "hi") return `${hindiPeriod(t.hour)} ${hour12}:${minute} बजे`;
  return `${hour12}:${minute} ${t.hour < 12 ? "am" : "pm"}`;
}

/** Date and time of an instant in the business's time zone: "Tue 11 Nov, 6:00 pm" or "मंगलवार, 11 नवंबर, शाम 6:00 बजे". */
export function formatSlot(ms: number, timeZone: string, language: Language): string {
  const p = localParts(ms, timeZone);
  return `${formatDate(p, language)}, ${formatTime(p, language)}`;
}

/** Text with a single spelling for the same thing: Unicode-composed, Devanagari digits turned into 0-9. Case is kept. */
export function plain(text: string): string {
  return text.normalize("NFC").replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

/** The text a customer typed, made easy to match: plain() and lower case. */
export function canon(text: string): string {
  return plain(text).toLowerCase();
}
