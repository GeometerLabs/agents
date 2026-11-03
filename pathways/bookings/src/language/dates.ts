// Dates and times the customer typed, in Hindi or English, turned into real ones in the business's time zone.
//
// The rules for the phrases people use loosely are explicit, and the agent always says the full date back:
//   आज / today ................ the business's current calendar date.
//   कल / tomorrow ............. the next calendar date. (In Hindi, "कल" also means yesterday; bookings are only for
//                               the future, so it always means tomorrow here.)
//   परसों / day after tomorrow . two calendar dates ahead (it also means "the day before yesterday"; same rule).
//   अगले मंगलवार / next Tuesday . the Tuesday in the NEXT calendar week (weeks run Monday to Sunday). On Tue 3 Nov
//                               that is Tue 10 Nov, never tomorrow's Tuesday.
//   इस मंगलवार / this Tuesday .. the Tuesday in the current week, today included; if it has already passed this
//                               week, the next one.
//   मंगलवार / Tuesday .......... the first Tuesday AFTER today (a Tuesday said on a Tuesday means a week from today;
//                               "today" is how people say today).
// Any weekday phrase is ambiguous in everyday speech, so the agent places no hold until the customer says yes to
// the full date ("Tue 10 Nov, 6:00 pm"). Times without am/pm are resolved against opening hours and confirmed too.
import { addDays, daysBetween, localParts } from "../time.ts";
import type { LocalDate, LocalTime } from "../time.ts";
import { canon } from "./format.ts";

export type DatePhrase =
  | { kind: "relative"; offsetDays: 0 | 1 | 2 }
  | { kind: "weekday"; weekday: number; which: "next" | "this" | "plain" } // weekday 0 = Sunday
  | { kind: "calendar"; day: number; month: number };

/** A time as written. `hour` is 1-12 when `period` is given, otherwise as typed (0-23). */
export interface TimePhrase { hour: number; minute: number; period?: "am" | "pm" }

// ---- word matching ---------------------------------------------------------------------------------------------

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{M}\\p{N}])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{M}\\p{N}])";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regex for whole words (works for Devanagari, where \b does not): longest alternative first. */
export function wordRe(words: string[], flags = "u"): RegExp {
  const alt = words.map(canon).sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  return new RegExp(`${NOT_LETTER_BEFORE}(?:${alt})${NOT_LETTER_AFTER}`, flags);
}

// Romanised Hindi ("kal shaam 6 baje") is common on WhatsApp, so the common words are accepted too.
const WEEKDAY_WORDS: string[][] = [
  ["sunday", "रविवार", "इतवार", "ravivar", "ravivaar", "itwar", "itvar"],
  ["monday", "सोमवार", "somvar", "somwar", "somvaar"],
  ["tuesday", "tue", "tues", "मंगलवार", "mangalvar", "mangalwar", "mangalvaar"],
  ["wednesday", "बुधवार", "budhvar", "budhwar", "budhvaar"],
  ["thursday", "thu", "thur", "thurs", "गुरुवार", "बृहस्पतिवार", "वीरवार", "guruvar", "guruwar", "brihaspativar", "veervar"],
  ["friday", "fri", "शुक्रवार", "shukravar", "shukrawar", "shukravaar"],
  ["saturday", "शनिवार", "shanivar", "shaniwar", "shanivaar"],
];
const WEEKDAY_RES = WEEKDAY_WORDS.map((w) => wordRe(w));

const MONTH_WORDS: string[][] = [
  ["january", "jan", "जनवरी"], ["february", "feb", "फरवरी"], ["march", "mar", "मार्च"], ["april", "apr", "अप्रैल"],
  ["may", "मई"], ["june", "jun", "जून"], ["july", "jul", "जुलाई"], ["august", "aug", "अगस्त"],
  ["september", "sep", "sept", "सितंबर", "सितम्बर"], ["october", "oct", "अक्टूबर", "अक्तूबर"], ["november", "nov", "नवंबर", "नवम्बर"], ["december", "dec", "दिसंबर", "दिसम्बर"],
];
const MONTH_RES = MONTH_WORDS.map((w) => wordRe(w));

const DAY_AFTER_RE = wordRe(["day after tomorrow", "परसों", "परसो", "parso", "parson", "parsoon"]);
const TOMORROW_RE = wordRe(["tomorrow", "tmrw", "tomorow", "कल", "kal"]);
const TODAY_RE = wordRe(["today", "आज", "aaj"]);
const NEXT_RE = new RegExp(`${NOT_LETTER_BEFORE}(?:${["next", "अगले", "अगला", "अगली", "agle", "agla"].map(escapeRe).join("|")})\\s+$`, "u");
const THIS_RE = new RegExp(`${NOT_LETTER_BEFORE}(?:${["this", "इस"].map(escapeRe).join("|")})\\s+$`, "u");

const PERIODS: { re: RegExp; kind: "morning" | "afternoon" | "evening" | "night" }[] = [
  { re: wordRe(["सुबह", "सवेरे", "subah", "savere", "morning"]), kind: "morning" },
  { re: wordRe(["दोपहर", "dopahar", "afternoon", "noon"]), kind: "afternoon" },
  { re: wordRe(["शाम", "shaam", "sham", "evening"]), kind: "evening" },
  { re: wordRe(["रात", "raat", "night", "tonight"]), kind: "night" },
];
const PERIOD_WORDS = "सुबह|सवेरे|subah|savere|morning|दोपहर|dopahar|afternoon|noon|शाम|shaam|sham|evening|रात|raat|night";

// ---- finding phrases in a message -----------------------------------------------------------------------------

/** The first date phrase in the message, if any. */
export function findDatePhrase(rawText: string): DatePhrase | undefined {
  const text = canon(rawText);

  // "11 nov", "11 नवंबर", "nov 11"
  for (let m = 0; m < 12; m++) {
    const re = MONTH_RES[m];
    const month = re.exec(text);
    if (!month) continue;
    const before = /(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?$/u.exec(text.slice(0, month.index));
    const after = /^\s*(\d{1,2})(?!\d|\s*(?::|am|pm|बजे))/u.exec(text.slice(month.index + month[0].length));
    const day = Number((before ?? after)?.[1]);
    if (day >= 1 && day <= 31) return { kind: "calendar", day, month: m + 1 };
  }

  if (DAY_AFTER_RE.test(text)) return { kind: "relative", offsetDays: 2 };
  if (TOMORROW_RE.test(text)) return { kind: "relative", offsetDays: 1 };
  if (TODAY_RE.test(text)) return { kind: "relative", offsetDays: 0 };

  for (let w = 0; w < 7; w++) {
    const hit = WEEKDAY_RES[w].exec(text);
    if (!hit) continue;
    const before = text.slice(0, hit.index);
    const which = NEXT_RE.test(before) ? "next" : THIS_RE.test(before) ? "this" : "plain";
    return { kind: "weekday", weekday: w, which };
  }
  return undefined;
}

function periodHint(text: string): "morning" | "afternoon" | "evening" | "night" | undefined {
  return PERIODS.find((p) => p.re.test(text))?.kind;
}

function periodToMeridiem(kind: "morning" | "afternoon" | "evening" | "night", hour: number): "am" | "pm" {
  if (kind === "morning") return "am";
  if (kind === "afternoon" || kind === "evening") return "pm";
  return hour >= 6 && hour <= 11 ? "pm" : "am"; // night: 8 is 8 pm, but 12 and 2 are after midnight
}

/** The first time of day in the message, if any: "6pm", "6:30 pm", "18:00", "6 बजे", "शाम 6 बजे", "evening 6". */
export function findTimePhrase(rawText: string): TimePhrase | undefined {
  const text = canon(rawText);
  let found: { hour: number; minute: number; period?: "am" | "pm" } | undefined;

  let m = /(?<![\d:.])(\d{1,2}):(\d{2})(?!\d)\s*(am|pm|a\.m\.|p\.m\.)?/u.exec(text);
  if (m) found = { hour: Number(m[1]), minute: Number(m[2]), period: m[3] ? (m[3].startsWith("a") ? "am" : "pm") : undefined };
  if (!found) {
    m = /(?<![\d:.])(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![\p{L}])/u.exec(text);
    if (m) found = { hour: Number(m[1]), minute: 0, period: m[2][0] === "a" ? "am" : "pm" };
  }
  if (!found) {
    m = /(?<![\d:.])(\d{1,2})(?::(\d{2}))?\s*(?:बजे|baje|bje|o'?clock)/u.exec(text)
      ?? new RegExp(`(?:${PERIOD_WORDS})\\s*(?:को\\s*|ko\\s*|at\\s*)?(\\d{1,2})(?::(\\d{2}))?(?![\\d])`, "u").exec(text)
      ?? new RegExp(`(?<![\\d:.])(\\d{1,2})\\s*(?:in the |at )?(?:${PERIOD_WORDS})`, "u").exec(text)
      ?? /(?<![\d:.])\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\d)/u.exec(text);
    if (m) found = { hour: Number(m[1]), minute: m[2] ? Number(m[2]) : 0 };
  }
  if (!found || found.hour > 23 || found.minute > 59) return undefined;
  if (found.period === undefined && found.hour >= 1 && found.hour <= 12) {
    const hint = periodHint(text.replace(/good\s+(?:morning|afternoon|evening|night)|सुप्रभात|शुभ रात्रि/gu, " ")); // a greeting is not a time
    if (hint) found.period = periodToMeridiem(hint, found.hour);
  }
  return found.period ? found : { hour: found.hour, minute: found.minute };
}

// ---- resolving them --------------------------------------------------------------------------------------------

export interface ResolvedDate {
  date: LocalDate;
  /** True for weekday phrases: the agent must get a yes to the full date before it holds anything. */
  needsConfirmation: boolean;
  /** The rule that was applied, in words, for the record. */
  rule: string;
}

/** Resolve a date phrase against "now" in the business's time zone. Null when the date does not exist (31 November). */
export function resolveDate(phrase: DatePhrase, nowMs: number, timeZone: string): ResolvedDate | null {
  const today: LocalDate = localParts(nowMs, timeZone);
  if (phrase.kind === "relative") {
    const names = ["today", "tomorrow", "the day after tomorrow"];
    return { date: addDays(today, phrase.offsetDays), needsConfirmation: false, rule: `${names[phrase.offsetDays]}: ${phrase.offsetDays} day(s) after today in ${timeZone}` };
  }
  if (phrase.kind === "calendar") {
    let year = today.year;
    if (daysBetween(today, { year, month: phrase.month, day: phrase.day }) < 0) year += 1; // already gone this year: next year
    const check = addDays({ year, month: phrase.month, day: 1 }, phrase.day - 1);
    if (check.month !== phrase.month) return null;
    return { date: { year, month: phrase.month, day: phrase.day }, needsConfirmation: false, rule: "a written date: the next time it comes round" };
  }
  const monday = (d: number) => (d + 6) % 7; // weeks run Monday (0) to Sunday (6)
  const target = monday(phrase.weekday);
  const now = monday(localParts(nowMs, timeZone).weekday);
  let offset: number;
  let rule: string;
  if (phrase.which === "next") {
    offset = 7 - now + target;
    rule = "next <weekday>: that weekday in the next calendar week (Monday to Sunday)";
  } else if (phrase.which === "this") {
    offset = target >= now ? target - now : target - now + 7;
    rule = "this <weekday>: that weekday in the current week, today included; if it has passed, the next one";
  } else {
    offset = ((target - now + 7) % 7) || 7;
    rule = "<weekday>: the first such weekday after today";
  }
  return { date: addDays(today, offset), needsConfirmation: true, rule };
}

export interface ResolvedTime {
  time: LocalTime;
  /** True when no am/pm was given and the agent had to choose; the customer is asked to confirm. */
  inferred: boolean;
}

/** Turn what was typed into a 24-hour time. Without am/pm, the choice that falls inside opening hours wins. */
export function resolveTime(phrase: TimePhrase, hours: { open: number; close: number } | null): ResolvedTime {
  const { hour, minute, period } = phrase;
  if (period === "pm") return { time: { hour: hour === 12 ? 12 : hour + 12, minute }, inferred: false };
  if (period === "am") return { time: { hour: hour === 12 ? 0 : hour, minute }, inferred: false };
  if (hour === 0 || hour >= 12) return { time: { hour, minute }, inferred: false }; // 24-hour time, or noon
  const candidates = [hour, hour + 12];
  const inside = candidates.filter((c) => hours && c * 60 + minute >= hours.open && c * 60 + minute < hours.close);
  const chosen = inside.length === 1 ? inside[0] : hour >= 7 ? hour : hour + 12; // otherwise: 7-11 is morning, 1-6 afternoon
  return { time: { hour: chosen, minute }, inferred: true };
}
