// What every template's rule parser reads the same way: STOP, yes and no, a greeting, the language a message is written in (by script, then by Latin-letter
// words), an attempt to change the rules, and a price or an amount written in the message. The words come from modules/language/words.ts, so they can be
// read and reviewed in one place. A template's own parser (Bookings: book, cancel, reschedule; Fees: pay, paid, discount) adds what it alone needs.
// It reads a message and never decides anything: amounts, hours and slots are decided by the template's limits, so a smarter (or fooled) parser changes
// nothing about what is allowed.
import { canon } from "../language/format.ts";
import { blankWrittenDate, phraseRe, wordRe } from "../language/dates.ts";
import { WORDS, inBoth } from "../language/words.ts";
import type { Language } from "../language/languages.ts";

// Hindi and Malayalam can arrive in different Unicode compositions; normalising first makes the word lists match either.
export const nfc = (source: string) => source.normalize("NFC");

export const YES_RE = wordRe(["yes", "y", "yeah", "yep", "yup", "ok", "okay", "sure", "confirm", "confirmed", "correct", "haan", "han", "haa", "हाँ", "हां", "हा", "जी", "ठीक", "ठीक है", "theek hai", "thik hai", "पक्का", "ओके", "सही", ...inBoth((w) => w.yes)], "u", false);
// A "no" is read from the same shared word lists as "yes", so every template parses a refusal identically.
export const NO_RE = wordRe(["no", "nope", "nahi", "nahin", "नहीं", "नही", "गलत", "wrong", ...inBoth((w) => w.no)], "u", false);
export const GREETING_RE = wordRe(["hi", "hello", "hey", "namaste", "namaskar", "नमस्ते", "नमस्कार", "हैलो", "हेलो", "हाय", ...inBoth((w) => w.greeting)], "u", false);
export const FREE_RE = wordRe(["free", "complimentary", "free of charge", "no charge", "for nothing", "मुफ्त", "मुफ़्त", "फ्री", "फ़्री", "बिना पैसे", "muft", "bina paise", ...inBoth((w) => w.free)]);
// "stop" on its own, or a few words around it; never a sentence that merely contains the word
const STOP_WORDS_RE = wordRe(["stop", "unsubscribe", "स्टॉप", "opt out", "optout", ...inBoth((w) => w.stop)], "u", false);
const STOP_HINDI_RE = new RegExp(nfc("(?:मैसेज|संदेश|msg|message).{0,12}बंद|बंद.{0,12}(?:मैसेज|संदेश)"), "u");
const STOP_DRAVIDIAN_RE = phraseRe(inBoth((w) => w.stopPhrases));

const OVERRIDE_PATTERNS = [
  "(?:ignore|forget|disregard|override|bypass)\\b[^.!?]{0,40}\\b(?:rules?|instructions?|prompts?|polic(?:y|ies)|limits?|guidelines)",
  "\\b(?:you are now|system prompt|developer mode|jailbreak)\\b",
  "(?:नियम|निर्देश|इंस्ट्रक्शन|पॉलिसी)[^.!?]{0,30}(?:भूल|नजरअंदाज|छोड़|तोड़)",
  "(?:भूल|नजरअंदाज|छोड़|तोड़)[^.!?]{0,30}(?:नियम|निर्देश|इंस्ट्रक्शन|पॉलिसी)",
].map((p) => new RegExp(nfc(p), "u"));
// "rules" near "forget/ignore" in Malayalam and Kannada, either way round
const topics = inBoth((w) => w.overrideTopics).map((x) => canon(x)).join("|");
const verbs = inBoth((w) => w.overrideVerbs).map((x) => canon(x)).join("|");
OVERRIDE_PATTERNS.push(new RegExp(`(?:${topics})[^.!?]{0,30}(?:${verbs})`, "u"), new RegExp(`(?:${verbs})[^.!?]{0,30}(?:${topics})`, "u"));

const ENGLISH_WORDS_RE = wordRe(["the", "please", "can", "could", "would", "i", "my", "want", "like", "book", "tomorrow", "today", "next", "cancel", "for", "at", "to", "you", "your", "free", "ignore", "reschedule", "hello", "appointment", "rules", "it"]);
const ROMAN_HINDI_RE = wordRe(["kal", "aaj", "parso", "baje", "bje", "shaam", "subah", "raat", "haan", "nahi", "chahiye", "karna", "karwana", "kar do", "mein", "hai", "kitna", "kya", "bhai", "didi", "muft"]);

const ROMAN_MALAYALAM_RE = wordRe(WORDS.ml.hints, "u", false);
const ROMAN_KANNADA_RE = wordRe(WORDS.kn.hints, "u", false);

/** The language a message is written in: by script first (Devanagari, Malayalam, Kannada), then by Latin-letter words. */
export function detectLanguage(text: string): Language | undefined {
  const t = canon(text);
  if (/[ऀ-ॿ]/u.test(text)) return "hi";
  if (/[ഀ-ൿ]/u.test(text)) return "ml";
  if (/[ಀ-೿]/u.test(text)) return "kn";
  if (ROMAN_HINDI_RE.test(t)) return "hi";
  if (ROMAN_MALAYALAM_RE.test(t)) return "ml";
  if (ROMAN_KANNADA_RE.test(t)) return "kn";
  if (ENGLISH_WORDS_RE.test(t) || /[a-z]{4,}/u.test(t)) return "en";
  return undefined;
}

const toRupees = (digits: string) => Number(digits.replace(/,/g, ""));

// What follows a price in Malayalam and Kannada: "രൂപയ്ക്ക്", "ರೂಪಾಯಿಗೆ" (more letters may follow), or a Latin spelling ("rupayakku").
const RUPEE_AFTER = inBoth((w) => w.rupee).map(canon).sort((a, b) => b.length - a.length)
  .map((w) => (/[a-z]/u.test(w) ? `${w}(?![a-z])` : `${w}[\\p{L}\\p{M}]*`)).join("|");

/** A price the customer proposed. Cues are explicit (₹, Rs, "में", "for"), so a time like "6 बजे" is never read as a price. */
export function findOffer(t: string): number | undefined {
  const tests: [RegExp, number, boolean?][] = [
    [/(?:₹|rs\.?|inr|रु\.?|रुपये|रुपए)\s*(\d[\d,]*)/u, 1],
    [/(?<![\d:.])(\d[\d,]*)\s*(?:₹|rs\b|rupees?|रुपये|रुपए|रुपया|रु\b|में|मे|मैं|mein|only|का\b|ka\b|के लिए|ke liye)/u, 10],
    [new RegExp(`(?<![\\d:.])(\\d[\\d,]*)\\s*(?:${RUPEE_AFTER})`, "u"), 10],
    [/(?<![\d:.])(\d[\d,]*)\s*(?:ಕ್ಕ[ೆೇ]|ಗ[ೆೇ]|ಕ[ೆೇ])(?![\p{L}\p{M}])/u, 25, true], // Kannada "300ಕ್ಕೆ" (for 300); a smaller number with ಕ್ಕೆ is a time, "6ಕ್ಕೆ"
    [/(?:\bfor|@)\s*₹?\s*(\d[\d,]*)(?!\s*(?::|am\b|pm\b|baje|बजे|o'?clock|mani|gante|മണി|ಗಂಟೆ))/u, 10],
    [/\bat\s*₹?\s*(\d[\d,]*)(?!\s*(?::|am\b|pm\b|baje|बजे|o'?clock|mani|gante|മണി|ಗಂಟೆ))/u, 100],
  ];
  for (const [re, minimum, skipWrittenDate] of tests) {
    // The first match that is big enough: in "ಸಂಜೆ 6ಕ್ಕೆ ... 300ಕ್ಕೆ" the 6 is an hour and the 300 is the price.
    for (const m of (skipWrittenDate ? blankWrittenDate(t) : t).matchAll(new RegExp(re.source, `${re.flags}g`))) { // "ನವೆಂಬರ್ 28ಕ್ಕೆ" is a date, not a price of 28
      if (toRupees(m[1]) >= minimum && toRupees(m[1]) <= 1_000_000) return toRupees(m[1]);
    }
  }
  return FREE_RE.test(t) ? 0 : undefined;
}

// Short messages only: STOP inside a long sentence is not an opt-out, and a missed opt-out is worse than a false one so the word lists are wide.
export function isStop(t: string): boolean {
  const tokens = t.trim().split(/\s+/u).filter(Boolean);
  return (tokens.length <= 4 && STOP_WORDS_RE.test(t)) || (tokens.length <= 5 && (STOP_HINDI_RE.test(t) || STOP_DRAVIDIAN_RE.test(t)));
}

/** Did the message try to change the agent's rules ("ignore your rules")? `t` is the message after `canon`. */
export const isOverrideAttempt = (t: string): boolean => OVERRIDE_PATTERNS.some((re) => re.test(t));
