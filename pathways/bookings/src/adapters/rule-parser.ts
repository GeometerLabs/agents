// A deterministic parser for Hindi and English (and the Hindi people type in Latin letters), good enough to drive the
// tests and the hand check. It reads a message and returns an Intent. It never decides anything: prices, hours and
// slots are decided by the limits, so a smarter (or fooled) parser changes nothing about what is allowed.
import { canon } from "../language/format.ts";
import { findDatePhrase, findTimePhrase, wordRe } from "../language/dates.ts";
import type { Language } from "../settings.ts";
import type { Intent, IntentParser, ParseContext } from "./model.ts";

const nfc = (source: string) => source.normalize("NFC");

const CANCEL_RE = wordRe(["cancel", "cancelled", "canceled", "cancellation", "कैंसल", "रद्द", "रद", "निरस्त", "radd", "cancle"]);
const RESCHEDULE_RE = new RegExp(nfc("(?:re-?schedul|postpone|change\\s+(?:the\\s+|my\\s+)?(?:time|date|slot|booking|appointment)|move\\s+(?:it|my\\s+(?:booking|appointment))|समय\\s+बदल|तारीख\\s+बदल|दिन\\s+बदल|रीशेड्यूल|रीसेट|time\\s+badal|date\\s+badal)"), "u");
const YES_RE = wordRe(["yes", "y", "yeah", "yep", "yup", "ok", "okay", "sure", "confirm", "confirmed", "correct", "haan", "han", "haa", "हाँ", "हां", "हा", "जी", "ठीक", "ठीक है", "theek hai", "thik hai", "पक्का", "ओके", "सही"]);
const NO_RE = wordRe(["no", "nope", "nahi", "nahin", "नहीं", "नही", "गलत", "wrong"]);
const GREETING_RE = wordRe(["hi", "hello", "hey", "namaste", "namaskar", "नमस्ते", "नमस्कार", "हैलो", "हेलो", "हाय"]);
const BOOK_RE = wordRe(["book", "booking", "appointment", "slot", "reserve", "बुक", "बुकिंग", "अपॉइंटमेंट", "चाहिए", "करवाना", "कटवाना", "chahiye", "karwana", "available"]);
const FREE_RE = wordRe(["free", "complimentary", "free of charge", "no charge", "for nothing", "मुफ्त", "मुफ़्त", "फ्री", "फ़्री", "बिना पैसे", "muft", "bina paise"]);

// "stop" on its own, or a few words around it; never a sentence that merely contains the word
const STOP_WORDS_RE = wordRe(["stop", "unsubscribe", "स्टॉप", "opt out", "optout"]);
const STOP_HINDI_RE = new RegExp(nfc("(?:मैसेज|संदेश|msg|message).{0,12}बंद|बंद.{0,12}(?:मैसेज|संदेश)"), "u");

const OVERRIDE_PATTERNS = [
  "(?:ignore|forget|disregard|override|bypass)\\b[^.!?]{0,40}\\b(?:rules?|instructions?|prompts?|polic(?:y|ies)|limits?|guidelines)",
  "\\b(?:you are now|system prompt|developer mode|jailbreak)\\b",
  "(?:नियम|निर्देश|इंस्ट्रक्शन|पॉलिसी)[^.!?]{0,30}(?:भूल|नजरअंदाज|छोड़|तोड़)",
  "(?:भूल|नजरअंदाज|छोड़|तोड़)[^.!?]{0,30}(?:नियम|निर्देश|इंस्ट्रक्शन|पॉलिसी)",
].map((p) => new RegExp(nfc(p), "u"));

const ENGLISH_WORDS_RE = wordRe(["the", "please", "can", "could", "would", "i", "my", "want", "like", "book", "tomorrow", "today", "next", "cancel", "for", "at", "to", "you", "your", "free", "ignore", "reschedule", "hello", "appointment", "rules", "it"]);
const ROMAN_HINDI_RE = wordRe(["kal", "aaj", "parso", "baje", "bje", "shaam", "subah", "raat", "haan", "nahi", "chahiye", "karna", "karwana", "kar do", "mein", "hai", "kitna", "kya", "bhai", "didi", "muft"]);

export function detectLanguage(text: string): Language | undefined {
  const t = canon(text);
  if (/[ऀ-ॿ]/u.test(text) || ROMAN_HINDI_RE.test(t)) return "hi";
  if (ENGLISH_WORDS_RE.test(t) || /[a-z]{4,}/u.test(t)) return "en";
  return undefined;
}

function findService(t: string, context: ParseContext): string | undefined {
  let best: { id: string; length: number } | undefined;
  for (const service of context.services) {
    for (const names of Object.values(service.names)) {
      for (const name of names ?? []) {
        if (wordRe([name]).test(t) && (!best || name.length > best.length)) best = { id: service.id, length: name.length };
      }
    }
  }
  return best?.id;
}

const toRupees = (digits: string) => Number(digits.replace(/,/g, ""));

/** A price the customer proposed. Cues are explicit (₹, Rs, "में", "for"), so a time like "6 बजे" is never read as a price. */
function findOffer(t: string): number | undefined {
  const tests: [RegExp, number][] = [
    [/(?:₹|rs\.?|inr|रु\.?|रुपये|रुपए)\s*(\d[\d,]*)/u, 1],
    [/(?<![\d:.])(\d[\d,]*)\s*(?:₹|rs\b|rupees?|रुपये|रुपए|रुपया|रु\b|में|मे|मैं|mein|only|का\b|ka\b|के लिए|ke liye)/u, 10],
    [/(?:\bfor|@)\s*₹?\s*(\d[\d,]*)(?!\s*(?::|am\b|pm\b|baje|बजे|o'?clock))/u, 10],
    [/\bat\s*₹?\s*(\d[\d,]*)(?!\s*(?::|am\b|pm\b|baje|बजे|o'?clock))/u, 100],
  ];
  for (const [re, minimum] of tests) {
    const m = re.exec(t);
    if (m && toRupees(m[1]) >= minimum && toRupees(m[1]) <= 1_000_000) return toRupees(m[1]);
  }
  return FREE_RE.test(t) ? 0 : undefined;
}

function isStop(t: string): boolean {
  const tokens = t.trim().split(/\s+/u).filter(Boolean);
  return (tokens.length <= 4 && STOP_WORDS_RE.test(t)) || (tokens.length <= 5 && STOP_HINDI_RE.test(t));
}

/** Read one message. Pure and synchronous; the async wrapper is only there to fit the IntentParser seam. */
export function parseIntent(text: string, context: ParseContext): Intent {
  const t = canon(text);
  const intent: Intent = { kind: "unknown" };
  const language = detectLanguage(text);
  if (language) intent.language = language;
  if (OVERRIDE_PATTERNS.some((re) => re.test(t))) intent.overrideAttempt = true;

  if (isStop(t)) return { ...intent, kind: "stop" };

  const serviceId = findService(t, context);
  const offerInr = findOffer(t);
  const date = findDatePhrase(text);
  const time = findTimePhrase(text);
  if (serviceId) intent.serviceId = serviceId;
  if (offerInr !== undefined) intent.offerInr = offerInr;
  if (date) intent.date = date;
  if (time) intent.time = time;

  const hasDetails = serviceId !== undefined || offerInr !== undefined || date !== undefined || time !== undefined;
  const shortReply = t.trim().split(/\s+/u).length <= 5 && !hasDetails;

  if (RESCHEDULE_RE.test(t)) intent.kind = "reschedule";
  else if (CANCEL_RE.test(t)) intent.kind = "cancel";
  else if (hasDetails || BOOK_RE.test(t)) intent.kind = "book";
  else if (shortReply && NO_RE.test(t) && !YES_RE.test(t)) intent.kind = "no";
  else if (shortReply && YES_RE.test(t)) intent.kind = "yes";
  else if (GREETING_RE.test(t)) intent.kind = "greeting";
  return intent;
}

export function createRuleParser(): IntentParser {
  return { parse: async (text, context) => parseIntent(text, context) };
}
