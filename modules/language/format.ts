// How amounts, dates and times are written, per language. This is the ONLY place those formats live:
// the templates write with these functions and the outgoing check reads with the same tables.
import type { Language } from "./languages.ts";
import { localParts } from "../core/time.ts";
import type { LocalDate, LocalTime } from "../core/time.ts";

// Index 0 is Sunday and month 1 is index 0, the same as Date#getDay() and Date#getMonth().
export const WEEKDAY_NAMES: Record<Language, string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  hi: ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"],
  ml: ["ഞായർ", "തിങ്കൾ", "ചൊവ്വ", "ബുധൻ", "വ്യാഴം", "വെള്ളി", "ശനി"],
  kn: ["ಭಾನುವಾರ", "ಸೋಮವಾರ", "ಮಂಗಳವಾರ", "ಬುಧವಾರ", "ಗುರುವಾರ", "ಶುಕ್ರವಾರ", "ಶನಿವಾರ"],
};

export const MONTH_NAMES: Record<Language, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  hi: ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
  ml: ["ജനുവരി", "ഫെബ്രുവരി", "മാർച്ച്", "ഏപ്രിൽ", "മേയ്", "ജൂൺ", "ജൂലൈ", "ഓഗസ്റ്റ്", "സെപ്റ്റംബർ", "ഒക്ടോബർ", "നവംബർ", "ഡിസംബർ"],
  kn: ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"],
};

/** Which part of the day an hour (0-23) is in. Hindi, Malayalam and Kannada each name it before the time. */
export type DayPart = "morning" | "noon" | "evening" | "night";
// One definition of the day boundaries so every language says 'morning' and 'evening' for the same hours.
export function dayPartOf(hour24: number): DayPart {
  if (hour24 >= 5 && hour24 < 12) return "morning";
  if (hour24 >= 12 && hour24 < 16) return "noon";
  if (hour24 >= 16 && hour24 < 20) return "evening";
  return "night";
}

/** The words the formatters write, per language that names the part of the day. English uses am/pm instead. */
export const DAY_PART_WORDS: Record<Exclude<Language, "en">, Record<DayPart, string>> = {
  hi: { morning: "सुबह", noon: "दोपहर", evening: "शाम", night: "रात" },
  ml: { morning: "രാവിലെ", noon: "ഉച്ചയ്ക്ക്", evening: "വൈകുന്നേരം", night: "രാത്രി" },
  kn: { morning: "ಬೆಳಿಗ್ಗೆ", noon: "ಮಧ್ಯಾಹ್ನ", evening: "ಸಂಜೆ", night: "ರಾತ್ರಿ" },
};

/** Hindi says which part of the day it is: "शाम 6:00 बजे" (6:00 in the evening). Kept for callers that only need Hindi. */
export const HINDI_PERIODS = DAY_PART_WORDS.hi;
// Older callers only need Hindi; kept so they do not each rebuild the lookup.
export const hindiPeriod = (hour24: number): string => DAY_PART_WORDS.hi[dayPartOf(hour24)];

/** "₹450", "₹1,200", "₹12,500", "₹1,25,000": whole rupees with Indian digit grouping. */
export function formatInr(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/** English "Tue 11 Nov"; Hindi "मंगलवार, 11 नवंबर"; Malayalam "ചൊവ്വ, 11 നവംബർ"; Kannada "ಮಂಗಳವಾರ, 11 ನವೆಂಬರ್". The weekday is computed from the date, never passed in. */
export function formatDate(d: LocalDate, language: Language): string {
  const weekday = WEEKDAY_NAMES[language][new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
  const month = MONTH_NAMES[language][d.month - 1];
  return language === "en" ? `${weekday} ${d.day} ${month}` : `${weekday}, ${d.day} ${month}`;
}

/** English "6:00 pm"; Hindi "शाम 6:00 बजे"; Malayalam "വൈകുന്നേരം 6:00"; Kannada "ಸಂಜೆ 6:00". */
export function formatTime(t: LocalTime, language: Language): string {
  const minute = String(t.minute).padStart(2, "0");
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  if (language === "en") return `${hour12}:${minute} ${t.hour < 12 ? "am" : "pm"}`;
  const clock = `${DAY_PART_WORDS[language][dayPartOf(t.hour)]} ${hour12}:${minute}`;
  return language === "hi" ? `${clock} बजे` : clock;
}

/** Date and time of an instant in the business's time zone: "Tue 11 Nov, 6:00 pm", "मंगलवार, 11 नवंबर, शाम 6:00 बजे", "ചൊവ്വ, 11 നവംബർ, വൈകുന്നേരം 6:00". */
export function formatSlot(ms: number, timeZone: string, language: Language): string {
  const p = localParts(ms, timeZone);
  return `${formatDate(p, language)}, ${formatTime(p, language)}`;
}

/**
 * An Indian mobile number the way people write it on WhatsApp: "+91 98111 11111" for "+919811111111" (14 Nov 2026: the owner found the run-together digits hard
 * to read). Anything else comes back as it was (another country's number, a booking page's conversation), so nothing is ever guessed. A check that reads a message
 * with a grouped number must hold this form among its literals too (templates/commerce/bookings/src/language/check.ts).
 */
export function groupPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/u.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** Words that open a sentence: the first letter capitalised in English ("Haircut on ..."). Hindi, Malayalam and Kannada have no capital letters, so they are kept as they are. */
export function sentenceStart(text: string, language: Language): string {
  return language === "en" && text.length > 0 ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

// The old way of typing a Malayalam chillu was consonant + virama + ZWJ; Unicode now has one letter for each.
const OLD_CHILLU: [RegExp, string][] = [[/ണ്\u200d/gu, "ൺ"], [/ന്\u200d/gu, "ൻ"], [/ര്\u200d/gu, "ർ"], [/ല്\u200d/gu, "ൽ"], [/ള്\u200d/gu, "ൾ"], [/ക്\u200d/gu, "ൿ"]];

/**
 * Text with a single spelling for the same thing: Unicode-composed; Devanagari, Malayalam and Kannada digits turned into
 * 0-9; old-style Malayalam chillus made new-style; zero-width joiners (which only change how a letter is drawn) removed.
 * Case is kept.
 */
export function plain(text: string): string {
  let out = text.normalize("NFC");
  for (const [old, current] of OLD_CHILLU) out = out.replace(old, current);
  return out
    .replace(/[\u200c\u200d]/gu, "")
    .replace(/[०-९]/gu, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[൦-൯]/gu, (d) => String(d.charCodeAt(0) - 0x0d66))
    .replace(/[೦-೯]/gu, (d) => String(d.charCodeAt(0) - 0x0ce6));
}

/** Which language a stretch of text is written in, by its script. Latin letters are English. */
export function languageOfScript(text: string): Language {
  if (/[ऀ-ॿ]/u.test(text)) return "hi";
  if (/[ഀ-ൿ]/u.test(text)) return "ml";
  if (/[ಀ-೿]/u.test(text)) return "kn";
  return "en";
}

/** The text a customer typed, made easy to match: plain() and lower case. */
export function canon(text: string): string {
  return plain(text).toLowerCase();
}
