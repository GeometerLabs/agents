// A deterministic parser for what a customer writes to a shop that takes pre-orders, in Hindi, English, Malayalam and Kannada (and the Hindi, Malayalam and Kannada
// people type in Latin letters). STOP, yes, no, a greeting, the language, a price named and an attempt to change the rules are read the same way for every template
// (modules/understanding/rules.ts); this file adds the words about orders: the items on the menu with a quantity, pickup or delivery. Dates and times are read by the shared
// finders (modules/language/dates.ts). It reads a message and returns an Intent. It never decides anything: prices, stock, cut-offs and the delivery list are decided by the
// limits, so a smarter (or fooled) parser changes nothing about what is allowed.
// Machine-written lists for Hindi, Malayalam and Kannada number words and delivery words: not yet read by a native speaker (REVIEW-hi.md, REVIEW-ml.md, REVIEW-kn.md).
import { canon } from "../../../../../modules/language/format.ts";
import { blankWrittenDate, findDatePhrase, findTimePhrase, phraseRe, wordRe } from "../../../../../modules/language/dates.ts";
import { inBoth } from "../../../../../modules/language/words.ts";
import { GREETING_RE, NO_RE, YES_RE, detectLanguage, findOffer, isOverrideAttempt, isStop } from "../../../../../modules/understanding/rules.ts";
import type { IntentLine, Intent, IntentParser, ParseContext } from "./model.ts";

const CANCEL_RE = wordRe(["cancel", "cancelled", "canceled", "cancellation", "कैंसल", "रद्द", "रद", "निरस्त", "radd", "cancle", ...inBoth((w) => w.cancel)]);
const REFUND_RE = wordRe([
  "refund", "refunded", "money back", "give back", "return my money", "get back my money", "रिफंड", "वापस", "paise wapas", "wapas",
  "റീഫണ്ട്", "തിരികെ", "ರೀಫಂಡ್", "ಮರುಪಾವತಿ", "ವಾಪಸ್",
]);
const OWNER_RE = wordRe([
  "owner", "talk to", "call me", "speak to", "manager", "मालिक", "बात करनी", "बात करना", "फोन करो", "malik", "ഉടമ", "സംസാരിക്കണം", "വിളിക്കൂ", "ಮಾಲೀಕ", "ಮಾತನಾಡ", "ಕರೆ ಮಾಡಿ",
]);
const ORDER_LIST = [
  "order", "orders", "want", "need", "get me", "send", "book", "tiffin", "i'd like", "i would like", "chahiye", "chahie", "bhej do", "mangwana", "ऑर्डर", "चाहिए", "मँगवाना", "बुक",
  ...inBoth((w) => w.book),
];
const ORDER_RE = wordRe(ORDER_LIST);
const PICKUP_RE = phraseRe(["pickup", "pick up", "pick-up", "collect", "takeaway", "take away", "take-away", "come and take", "aake le", "lene aunga", "lene aaunga", "पिकअप", "पिक अप", "लेने आ", "खुद ले", "പിക്കപ്പ്", "പിക്ക് അപ്പ്", "വന്ന് എടുക്ക", "ಪಿಕಪ್", "ಪಿಕ್ ಅಪ್", "ನಾನೇ ಬಂದು"]);
const DELIVERY_RE = phraseRe(["deliver", "delivery", "home delivery", "send it to", "bhej do", "bhejna", "pahuncha", "डिलीवरी", "डिलिवरी", "पहुँचा", "पहुंचा", "घर पर", "ഡെലിവറി", "വീട്ടിൽ എത്തിക്ക", "എത്തിച്ച", "ಡೆಲಿವರಿ", "ಮನೆಗೆ ತಲುಪಿಸ", "ತಲುಪಿಸ"]);

// "I have paid" in words (a UPI shop reads this as a claim and asks the owner to look). A "no" in the same message ("I have not paid yet") makes it not a claim.
const PAID_WORDS = [
  "paid", "i paid", "i have paid", "have paid", "payment done", "payment made", "sent the money", "money sent", "transferred", "paid it", "advance paid", "bhar diya", "pay kar diya", "payment kar diya", "paid kar diya", "de diya", "paise bhej diye",
  "पेमेंट कर दिया", "भुगतान कर दिया", "पैसे भेज दिए", "पैसे भेजे", "भेज दिया", "भर दिया", "दे दिया", "पे कर दिया",
  "അടച്ചു", "പണം അടച്ചു", "പണം അയച്ചു", "അയച്ചു", "adachu", "payment cheythu", "paid aanu",
  "ಪಾವತಿಸಿದ್ದೇನೆ", "ಪಾವತಿಸಿದೆ", "ಹಣ ಕಳುಹಿಸಿದ್ದೇನೆ", "ಪಾವತಿ ಮಾಡಿದ್ದೇನೆ", "paavatisiddene", "payment madide",
];
const PAID_RE = wordRe(PAID_WORDS);
const NEGATION_RE = wordRe(["not", "haven't", "havent", "didn't", "didnt", "not yet", "never", "no", "नहीं", "नही", "अभी तक", "nahi", "nahin", "abhi tak", "ഇല്ല", "ഇതുവരെ", "illa", "ಇಲ್ಲ", "ಇನ್ನೂ", "innu"], "u", true);
/** Does this say "I have paid"? Used on a UPI shop before any model is asked, and for the "paid" intent. */
export const isPaidClaim = (text: string): boolean => { const t = canon(text); return PAID_RE.test(t) && !NEGATION_RE.test(t); };

/** The words about orders, by what they mean, for the review sheets. Every language's words are in each list, with the Latin-letter forms people type. */
export const ORDER_WORDS = { order: ORDER_LIST, paid: PAID_WORDS, cancel: [] as string[], pickup: [] as string[], delivery: [] as string[] } as const;

// ---- quantities ---------------------------------------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9, das: 10,
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
  onnu: 1, randu: 2, moonnu: 3, munnu: 3, naalu: 4, anchu: 5, "ഒന്ന്": 1, "രണ്ട്": 2, "മൂന്ന്": 3, "നാല്": 4, "അഞ്ച്": 5,
  ondu: 1, eradu: 2, mooru: 3, naalku: 4, aidu: 5, "ಒಂದು": 1, "ಎರಡು": 2, "ಮೂರು": 3, "ನಾಲ್ಕು": 4, "ಐದು": 5,
};
const WORD_LIST = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
const BEFORE_RE = new RegExp(`(?:^|[^\\p{L}\\p{N}])(\\d{1,3}|${WORD_LIST})\\s*(?:x|×|\\*)?\\s*(?:plates?|pcs?|pieces?|nos?\\.?|packs?|boxes|box|meals?|tiffins?)?\\s*(?:of\\s+)?$`, "u");
const AFTER_RE = /^\s*(?:x|×|\*)\s*(\d{1,3})(?!\d)/u;

const quantityOf = (n: string): number => (/^\d+$/u.test(n) ? Number(n) : NUMBER_WORDS[n] ?? 1);

/** The menu items named in the message, each with a quantity (the number just before the name, "x 2" just after, else 1). Longest name first, so "veg thali" beats "thali". */
function findItems(t: string, context: ParseContext): IntentLine[] {
  const text = blankWrittenDate(t);
  const names: { id: string; name: string }[] = [];
  for (const item of context.menu) for (const list of Object.values(item.names)) for (const name of list ?? []) names.push({ id: item.id, name: canon(name) });
  names.sort((a, b) => b.name.length - a.name.length);
  const taken: [number, number][] = [];
  const lines: IntentLine[] = [];
  for (const { id, name } of names) {
    const re = new RegExp(wordRe([name]).source, "gu");
    for (const m of text.matchAll(re)) {
      const start = m.index as number;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && a < end)) continue;
      taken.push([start, end]);
      const before = BEFORE_RE.exec(text.slice(Math.max(0, start - 24), start));
      const after = AFTER_RE.exec(text.slice(end, end + 12));
      const qty = after ? Number(after[1]) : before ? quantityOf(before[1]) : 1;
      const found = lines.find((l) => l.itemId === id);
      if (found) found.qty += qty;
      else lines.push({ itemId: id, qty });
    }
  }
  return lines;
}

/** The slots a name in the message stands for ("lunch" is the lunch slot for pickup and the one for delivery). */
function findSlots(t: string, context: ParseContext): string[] {
  const ids: string[] = [];
  for (const slot of context.slots) {
    const names = Object.values(slot.names).flat().map((n) => canon(n as string));
    if (names.length > 0 && wordRe(names).test(t)) ids.push(slot.id);
  }
  return ids;
}

/** Read one message. Pure and synchronous; the async wrapper is only there to fit the IntentParser seam. */
export function parseIntent(text: string, context: ParseContext): Intent {
  const t = canon(text);
  const intent: Intent = { kind: "unknown" };
  const language = detectLanguage(text);
  if (language) intent.language = language;
  if (isOverrideAttempt(t)) intent.overrideAttempt = true;

  if (isStop(t)) return { ...intent, kind: "stop" };

  const items = findItems(t, context);
  const offerInr = findOffer(t);
  const date = findDatePhrase(text);
  const time = findTimePhrase(text);
  const slotIds = findSlots(t, context);
  const mode = PICKUP_RE.test(t) ? "pickup" : DELIVERY_RE.test(t) ? "delivery" : undefined;
  if (items.length > 0) intent.items = items;
  if (offerInr !== undefined) intent.offerInr = offerInr;
  if (date) intent.date = date;
  if (time) intent.time = time;
  if (mode) intent.mode = mode;
  if (slotIds.length > 0) intent.slotIds = slotIds;

  const hasDetails = items.length > 0 || offerInr !== undefined || date !== undefined || time !== undefined || mode !== undefined || slotIds.length > 0;
  const shortReply = t.trim().split(/\s+/u).length <= 5 && !hasDetails;

  if (CANCEL_RE.test(t)) intent.kind = "cancel";
  else if (REFUND_RE.test(t)) intent.kind = "refund";
  else if (PAID_RE.test(t) && !NEGATION_RE.test(t)) intent.kind = "paid";
  else if (OWNER_RE.test(t)) intent.kind = "owner";
  else if (hasDetails || ORDER_RE.test(t)) intent.kind = "order";
  else if (shortReply && NO_RE.test(t) && !YES_RE.test(t)) intent.kind = "no";
  else if (shortReply && YES_RE.test(t)) intent.kind = "yes";
  else if (GREETING_RE.test(t)) intent.kind = "greeting";
  return intent;
}

export function createRuleParser(): IntentParser {
  return { parse: async (text, context) => parseIntent(text, context) };
}
