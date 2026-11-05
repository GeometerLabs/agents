// A deterministic parser for what a parent writes about a fee, in Hindi, English, Malayalam and Kannada (and the Hindi, Malayalam and Kannada people type in
// Latin letters). STOP, yes, no, a greeting, the language and an attempt to change the rules are read the same way for every template
// (modules/understanding/rules.ts); this file adds the words that are about fees. It reads a message and returns an Intent. It never decides anything:
// amounts, waivers and refunds are decided by the limits, so a smarter (or fooled) parser changes nothing about what is allowed.
// Machine-written lists for Malayalam and Kannada: not yet read by a native speaker (REVIEW-ml.md, REVIEW-kn.md).
import { canon } from "../../../../../modules/language/format.ts";
import { blankWrittenDate, wordRe } from "../../../../../modules/language/dates.ts";
import { GREETING_RE, NO_RE, YES_RE, detectLanguage, findOffer, isOverrideAttempt, isStop } from "../../../../../modules/understanding/rules.ts";
import type { Intent, IntentParser, ParseContext } from "./model.ts";

const PAID_WORDS = [
  "paid", "already paid", "i paid", "have paid", "payment done", "payment made", "done payment", "fee paid", "fees paid", "transferred", "sent the money", "sent money", "paid it", "bhar diya", "bhar di", "bhar chuke", "pay kar diya", "payment kar diya", "paid kar diya", "de diya", "jama kar diya",
  "भर दिया", "भर दी", "भर चुके", "भुगतान कर दिया", "पेमेंट कर दिया", "पे कर दिया", "जमा कर दिया", "जमा कर दी", "दे दिया", "दे दी", "फीस दे दी", "फीस भर दी",
  "അടച്ചു", "അടച്ചിട്ടുണ്ട്", "അടച്ചിരുന്നു", "പണം അടച്ചു", "ഫീസ് അടച്ചു", "അയച്ചു", "adachu", "adachittund", "payment cheythu", "paid aanu",
  "ಪಾವತಿಸಿದ್ದೇನೆ", "ಪಾವತಿಸಿದೆ", "ಕಟ್ಟಿದ್ದೇನೆ", "ಕಟ್ಟಿದೆ", "ಹಾಕಿದ್ದೇನೆ", "ಕೊಟ್ಟಿದ್ದೇನೆ", "kattide", "kattidini", "paavatisiddene", "payment madide",
];
const PAID_RE = wordRe(PAID_WORDS);
const PAY_WORDS = [
  "pay", "link", "payment link", "send link", "send the link", "how to pay", "pay now", "qr", "fees link", "fee link",
  "भुगतान", "लिंक", "पेमेंट", "भरना है", "फीस भरनी", "link bhejo", "link bhej do", "kaise bharun", "kaise bhare",
  "അടയ്ക്കണം", "ലിങ്ക്", "പണമടയ്ക്കാൻ", "link ayakku", "link tharamo",
  "ಪಾವತಿಸಬೇಕು", "ಲಿಂಕ್", "ಕಟ್ಟಬೇಕು", "link kalisi", "link kodi",
];
const PAY_RE = wordRe(PAY_WORDS);
const DISCOUNT_WORDS = [
  "discount", "discounts", "concession", "waive", "waived", "waiver", "reduce", "reduced", "reduction", "less fee", "off", "cheaper", "lower the fee", "take off",
  "छूट", "डिस्काउंट", "कम कर", "कम करो", "माफ़", "माफ", "रियायत", "कंसेशन", "chhoot", "chhut", "kam kar do", "kam karo", "maaf",
  "ഇളവ്", "ഡിസ്കൗണ്ട്", "കുറയ്ക്ക", "ഒഴിവാക്ക", "ilavu", "kuraykkamo", "kurakkamo",
  "ರಿಯಾಯಿತಿ", "ಡಿಸ್ಕೌಂಟ್", "ಕಡಿಮೆ ಮಾಡ", "ಮನ್ನಾ", "riyayiti", "kadime madi",
];
const DISCOUNT_RE = wordRe(DISCOUNT_WORDS);
const REFUND_WORDS = [
  "refund", "refunded", "refunding", "refunds", "money back", "give back", "return the money", "return my money", "get back",
  "रिफंड", "वापस", "लौटा", "paise wapas", "wapas",
  "റീഫണ്ട്", "തിരികെ", "തിരിച്ച് തരൂ", "thirike",
  "ರೀಫಂಡ್", "ಮರುಪಾವತಿ", "ವಾಪಸ್", "ಹಿಂತಿರುಗಿಸ", "vapas",
];
const REFUND_RE = wordRe(REFUND_WORDS);
const OWNER_WORDS = [
  "owner", "talk to", "call me", "speak to", "principal", "manager",
  "मालिक", "बात करनी", "बात करना", "फोन करो", "फ़ोन करो", "malik",
  "ഉടമ", "സംസാരിക്കണം", "വിളിക്കൂ", "udama",
  "ಮಾಲೀಕ", "ಮಾತನಾಡ", "ಕರೆ ಮಾಡಿ", "malika",
];
const OWNER_RE = wordRe(OWNER_WORDS);
// "I have not paid", "not yet": a claim of payment with a no in it is not a claim
const NEGATION_WORDS = [
  "not", "haven't", "havent", "didn't", "didnt", "not yet", "yet", "never", "no",
  "नहीं", "नही", "अभी तक", "अभी नहीं", "nahi", "nahin", "abhi tak", "abhi nahi",
  "ഇല്ല", "ഇതുവരെ", "illa", "ithuvare",
  "ಇಲ್ಲ", "ಇನ್ನೂ", "illa", "innu",
];
const NEGATION_RE = wordRe(NEGATION_WORDS, "u", true);

/** The words about fees, by what they mean, for the review sheets (REVIEW-ml.md, REVIEW-kn.md). Every language's words are in each list, with the Latin-letter forms people type. */
export const FEE_WORDS = { paid: PAID_WORDS, pay: PAY_WORDS, discount: DISCOUNT_WORDS, refund: REFUND_WORDS, owner: OWNER_WORDS, not: NEGATION_WORDS } as const;

const toRupees = (digits: string) => Number(digits.replace(/,/g, ""));

/** An amount the parent named: with a rupee cue first (the shared finder), else the first plain number of 20 or more that is not part of a written date. */
function findAmount(t: string): number | undefined {
  const cued = findOffer(t);
  if (cued !== undefined && cued > 0) return cued;
  for (const m of blankWrittenDate(t).matchAll(/(?<![\d:.])(\d[\d,]*)(?![\d:])/gu)) {
    const n = toRupees(m[1]);
    if (n >= 20 && n <= 1_000_000) return n;
  }
  return undefined;
}

/** Read one message. Pure and synchronous; the async wrapper is only there to fit the IntentParser seam. */
export function parseIntent(text: string, _context: ParseContext): Intent {
  const t = canon(text);
  const intent: Intent = { kind: "unknown" };
  const language = detectLanguage(text);
  if (language) intent.language = language;
  if (isOverrideAttempt(t)) intent.overrideAttempt = true;

  if (isStop(t)) return { ...intent, kind: "stop" };

  const amountInr = findAmount(t);
  const tokens = t.trim().split(/\s+/u).filter(Boolean).length;
  const shortReply = tokens <= 5;

  if (REFUND_RE.test(t)) { intent.kind = "refund"; if (amountInr !== undefined) intent.amountInr = amountInr; }
  else if (DISCOUNT_RE.test(t)) { intent.kind = "discount"; if (amountInr !== undefined) intent.amountInr = amountInr; }
  else if (PAID_RE.test(t)) intent.kind = NEGATION_RE.test(t) && !/\balready\b|पहले ही|ഇതിനകം|ಈಗಾಗಲೇ/u.test(t) ? "pay" : "paid";
  else if (OWNER_RE.test(t)) intent.kind = "owner";
  else if (PAY_RE.test(t)) intent.kind = "pay";
  else if (shortReply && NO_RE.test(t) && !YES_RE.test(t)) intent.kind = "no";
  else if (shortReply && YES_RE.test(t)) intent.kind = "yes";
  else if (GREETING_RE.test(t)) intent.kind = "greeting";
  return intent;
}

export function createRuleParser(): IntentParser {
  return { parse: async (text, context) => parseIntent(text, context) };
}
