// The outgoing check: read the FINAL text of a message, find every amount, date, time, number and link in it, and
// compare each with this conversation's record. Anything that does not match, or that the record cannot explain, fails
// the check, and a message that fails the check is not sent (fail closed). It reads text the way a customer would,
// so it does not care how the text was made: today a template, later a model.
import { LANGUAGES } from "../settings.ts";
import type { Language } from "../settings.ts";
import { localParts } from "../time.ts";
import { DAY_PART_WORDS, MONTH_NAMES, WEEKDAY_NAMES, formatDate, formatInr, formatTime, languageOfScript, plain } from "./format.ts";
import { wordRe } from "./dates.ts";
import type { MessageFacts } from "./templates.ts";

export interface CheckResult { ok: boolean; problems: string[] }

const alternation = (words: string[]) => words.map(plain).join("|");
const WEEKDAYS = alternation(LANGUAGES.flatMap((l) => WEEKDAY_NAMES[l]));
const MONTHS = alternation(LANGUAGES.flatMap((l) => MONTH_NAMES[l]));
const periodsOf = (language: "hi" | "ml" | "kn") => alternation(Object.values(DAY_PART_WORDS[language]));

// A date is "Tue 10 Nov", "मंगलवार, 10 नवंबर", "ചൊവ്വ, 10 നവംബർ" or "ಮಂಗಳವಾರ, 10 ನವೆಂಬರ್"; a time is "6:00 pm", "शाम 6:00 बजे",
// "വൈകുന്നേരം 6:00" or "ಸಂಜೆ 6:00". Exactly what the formatters write; the period word is part of the time, so a wrong one is caught.
const DATE_RE = new RegExp(`(?:${WEEKDAYS})\\s*,?\\s*\\d{1,2}\\s+(?:${MONTHS})`, "giu");
const TIME_RE = new RegExp(`(?:${periodsOf("hi")})\\s+\\d{1,2}:\\d{2}\\s+बजे|(?:${periodsOf("ml")}|${periodsOf("kn")})\\s+\\d{1,2}:\\d{2}|\\d{1,2}:\\d{2}\\s*(?:am|pm)`, "giu");
const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s)]*/giu;
const AMOUNT_RE = /₹\s*(\d[\d,]*(?:\.\d+)?)/gu;
const QUANTITY_WORD_RE = wordRe(["hundred", "thousand", "lakh", "crore", "सौ", "हज़ार", "हजार", "लाख", "करोड़"], "iu");
// Malayalam and Kannada join number words into one ("ഇരുന്നൂറ്" is 200), so these are looked for inside words, not only as words.
const QUANTITY_STEM_RE = new RegExp(["നൂറ", "ആയിരം", "ലക്ഷം", "കോടി", "ನೂರ", "ಸಾವಿರ", "ಲಕ್ಷ", "ಕೋಟಿ"].map(plain).join("|"), "u");

/** Whitespace, commas and case vary in what is written; the values do not. */
const normaliseDate = (s: string) => plain(s).toLowerCase().replace(/,/gu, " ").replace(/\s+/gu, " ").trim();
const normaliseTime = (s: string) => plain(s).toLowerCase().replace(/\s+/gu, " ").replace(/(\d)\s*(am|pm)$/u, "$1 $2").trim();

interface Allowed {
  amounts: Set<number>;
  counts: Set<number>;
  dates: Set<string>; // normalised, in every language
  times: Set<string>;
  urls: Set<string>;
  literals: string[]; // names and references the message may repeat; masked out before numbers are looked for
  shown: Partial<Record<Language, { date: string; time: string }>>; // how the record's slot reads, for the problem text
  amountList: number[];
}

function allowedFrom(facts: MessageFacts): Allowed {
  const a: Allowed = { amounts: new Set(), counts: new Set(), dates: new Set(), times: new Set(), urls: new Set(), literals: [], shown: {}, amountList: [] };
  for (const v of [facts.priceInr, facts.depositInr, facts.refundInr, ...facts.services.map((s) => s.priceInr)]) if (v !== undefined) a.amounts.add(v);
  a.amountList = [...a.amounts].sort((x, y) => x - y);
  for (const v of [facts.holdMinutes, facts.windowHours, facts.approvalHours]) if (v !== undefined) a.counts.add(v);
  if (facts.slotMs !== undefined) {
    const p = localParts(facts.slotMs, facts.timeZone);
    for (const language of LANGUAGES) {
      const date = formatDate(p, language);
      const time = formatTime(p, language);
      a.shown[language] = { date, time };
      a.dates.add(normaliseDate(date));
      a.times.add(normaliseTime(time));
    }
  }
  // A list of free times offers several; each one is a time the calendar showed free, taken from the record, and nothing else is allowed.
  for (const startMs of facts.slotChoices ?? []) {
    const p = localParts(startMs, facts.timeZone);
    for (const language of LANGUAGES) {
      a.dates.add(normaliseDate(formatDate(p, language)));
      a.times.add(normaliseTime(formatTime(p, language)));
    }
  }
  if (facts.link) a.urls.add(facts.link.toLowerCase());
  for (const lit of [facts.businessName, facts.serviceName, facts.bookingRef, facts.customerPhone, facts.approvalCode, ...facts.services.map((s) => s.name)]) {
    if (lit) a.literals.push(plain(lit));
  }
  a.literals.sort((x, y) => y.length - x.length);
  return a;
}

interface Token { text: string; start: number; end: number }

function tokens(re: RegExp, text: string): Token[] {
  return [...text.matchAll(re)].map((m) => ({ text: m[0], start: m.index as number, end: (m.index as number) + m[0].length }));
}

function mask(text: string, spans: { start: number; end: number }[]): string {
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + " ".repeat(s.end - s.start) + out.slice(s.end);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Check a final message against the facts of its conversation. `problems` is in plain words and empty when `ok`. */
export function checkMessage(finalText: string, facts: MessageFacts): CheckResult {
  const allowed = allowedFrom(facts);
  const problems: string[] = [];
  let text = plain(finalText);

  // Names and references the message may repeat (the business, the service, "b-3", the customer's number).
  for (const lit of allowed.literals) text = text.replace(new RegExp(escapeRe(lit), "giu"), (m) => " ".repeat(m.length));

  // Links: only the payment link in the record.
  const urls = tokens(URL_RE, text);
  for (const u of urls) {
    const cleaned = u.text.replace(/[.,;:!?]+$/u, "");
    if (!allowed.urls.has(cleaned.toLowerCase())) problems.push(`The message has the link "${cleaned}", which is not the payment link in the record.`);
  }
  text = mask(text, urls);

  // Dates and times. One conversation talks about one slot, so each date and each time is compared with that slot.
  const dates = tokens(DATE_RE, text);
  const times = tokens(TIME_RE, text);
  for (const d of dates) {
    if (!allowed.dates.has(normaliseDate(d.text))) {
      const record = allowed.shown[languageOfScript(d.text)]?.date;
      problems.push(`The message says the date "${d.text}", but the record has ${record ?? "no date for this conversation"}.`);
    }
  }
  for (const t of times) {
    if (!allowed.times.has(normaliseTime(t.text))) {
      const record = allowed.shown[languageOfScript(t.text)]?.time;
      problems.push(`The message says the time "${t.text}", but the record has ${record ?? "no time for this conversation"}.`);
    }
  }
  text = mask(text, [...dates, ...times]);

  // Amounts in rupees.
  const amounts = [...text.matchAll(AMOUNT_RE)];
  for (const m of amounts) {
    const value = Number(m[1].replace(/,/gu, ""));
    if (!allowed.amounts.has(value)) {
      const record = allowed.amountList.length > 0 ? allowed.amountList.map(formatInr).join(", ") : "no amounts for this conversation";
      problems.push(`The message says ${formatInr(value)}, but the record only has ${record}.`);
    }
  }
  text = mask(text, amounts.map((m) => ({ start: m.index as number, end: (m.index as number) + m[0].length })));

  // Anything else that is a number is unexplained, unless it is a count the record holds (minutes held, hours of notice).
  for (const m of text.matchAll(/\d+/gu)) {
    if (!allowed.counts.has(Number(m[0]))) problems.push(`The message has the number ${m[0]}, which is not in the record for this conversation.`);
  }
  if (QUANTITY_WORD_RE.test(text) || QUANTITY_STEM_RE.test(text)) problems.push("The message spells out a quantity in words (hundred, thousand, सौ, हज़ार, നൂറ്, ನೂರು ...), which cannot be checked against the record.");

  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
