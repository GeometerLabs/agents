// Reading the OWNER's words (item 11e): what the owner wants of their shop's assistant, in English, Hindi (also typed in Latin letters), Malayalam or Kannada. It is a
// `Reading` (modules/understanding/model.ts) for the shared router, so the owner's messages are read cheapest first like a customer's: these rules, then the decision model,
// then the small language model, counted in the same month's AI spend and read by the rules alone in button mode (understanding/reader.ts). Used by conversation.ts and
// by the templates' start (which builds the owner's router beside the customer's).
//
// The models only choose WHAT KIND of thing the owner wants. Every value comes from the words by rule (a date through language/dates.ts, a case reference, the digits
// of an amount written with a rupee sign, a message's own words) and is put back after the model answered (`merge`). A model never writes a value into an act. What a
// value cannot be read from is asked for (conversation.ts), never guessed.
import { findDatePhrase, findTimePhrase, wordRe } from "../language/dates.ts";
import type { DatePhrase, TimePhrase } from "../language/dates.ts";
import { canon, languageOfScript } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { chosenProbability, isObj } from "../understanding/model.ts";
import type { DecisionPlan, IntentBase, ParseOptionsBase, Reading } from "../understanding/model.ts";

/** What the owner can ask or ask for. Which of these a shop offers depends on its skills (OwnerContext.kinds). */
export const OWNER_KINDS = ["day", "owes", "open_orders", "waiting", "money", "close_day", "reopen_day", "move", "cancel", "refund", "message", "undo", "limit", "help"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number] | "unknown";

export interface OwnerIntent extends IntentBase {
  kind: OwnerKind;
  /** The day the words name ("Sunday", "16 Nov", "kal", "ഞായർ"), as written; resolved against the shop's clock by the caller. */
  date?: DatePhrase;
  /** A time of day the words name ("5pm", "शाम 6 बजे"), as written; resolved against the shop's hours by the skill (a move). */
  time?: TimePhrase;
  /** A case reference ("b-14", "q-2", "o-5"), lower case. */
  ref?: string;
  /** An amount written with a rupee sign or word ("₹1,200", "1200 rupees"), in paise. A bare number is never an amount. */
  amountPaise?: number;
  /** For a message: the owner's own words to send, as typed, without the reference and the command word. */
  words?: string;
}

/** What the reading is told about the shop: the kinds its skills offer. A kind not offered is read but answered "this shop's assistant does not take that". */
export interface OwnerContext { kinds: readonly OwnerKind[] }

/** The words for each kind, every language together (owners mix them), in the order they are tried. The first kind whose words are in the message wins. */
const KIND_WORDS: readonly [OwnerKind, readonly string[]][] = [
  ["undo", ["undo", "revert", "take that back", "वापस लो", "पहले जैसा", "wapas lo", "pehle jaisa", "പഴയപടി", "പഴയപോലെ", "ಹಿಂದಿನಂತೆ"]],
  ["limit", ["limit", "limits", "लिमिट", "सीमा", "പരിധി", "ലിമിറ്റ്", "ಮಿತಿ", "ಲಿಮಿಟ್"]],
  ["help", ["help", "what can you do", "मदद", "madad", "सहायता", "സഹായം", "ಸಹಾಯ"]],
  ["open_orders", ["orders", "order", "open orders", "ऑर्डर", "आर्डर", "ഓർഡർ", "ಆರ್ಡರ್"]],
  ["reopen_day", ["reopen", "open again", "फिर से खोल", "खोल दो", "khol do", "kholo", "വീണ്ടും തുറ", "ಮತ್ತೆ ತೆರೆ"]],
  ["close_day", ["close", "closed", "shut", "holiday", "day off", "बंद", "band", "छुट्टी", "chutti", "chhutti", "അടച്ചിട", "അടയ്ക്ക", "അവധി", "ಮುಚ್ಚ", "ರಜೆ"]],
  ["move", ["move", "shift", "reschedule", "postpone", "prepone", "change the time", "शिफ्ट", "समय बदल", "badal do", "time badlo", "മാറ്റുക", "സമയം മാറ്റ", "ಶಿಫ್ಟ್", "ಸಮಯ ಬದಲಾಯಿಸ"]],
  ["cancel", ["cancel", "रद्द", "कैंसल", "റദ്ദാക്ക", "ക്യാൻസൽ", "ರದ್ದು", "ಕ್ಯಾನ್ಸಲ್"]],
  ["refund", ["refund", "give back", "pay back", "रिफंड", "वापस दो", "वापस करो", "wapas do", "wapas karo", "paise wapas", "റീഫണ്ട്", "തിരികെ നൽക", "ರೀಫಂಡ್", "ಹಿಂತಿರುಗಿಸ"]],
  ["message", ["message", "msg", "tell", "inform", "let know", "मैसेज", "संदेश", "बोलो", "बोल दो", "बताओ", "बता दो", "bolo", "bol do", "batao", "bata do", "മെസ്സേജ്", "സന്ദേശം", "പറയ", "അറിയിക്ക", "ಮೆಸೇಜ್", "ಸಂದೇಶ", "ಹೇಳಿ", "ತಿಳಿಸಿ"]],
  ["owes", ["owe", "owes", "dues", "unpaid", "not paid", "fees", "fee", "फीस", "बकाया", "fees baki", "kisne nahi diya", "ഫീസ്", "കുടിശ്ശിക", "ಫೀಸ್", "ಶುಲ್ಕ"]],
  ["waiting", ["needs me", "need me", "waiting", "pending", "anything for me", "approve", "approvals", "मेरे लिए", "क्या बाकी", "बाकी है", "mere liye", "kya baki", "എനിക്ക്", "കാത്തിരിക്കുന്ന", "ബാക്കി", "ನನಗೆ", "ಬಾಕಿ", "ಕಾಯುತ್ತಿದೆ"]],
  ["money", ["money", "collected", "came in", "how much", "takings", "पैसे", "पैसा", "paisa", "paise", "kitna aaya", "कितना आया", "പണം", "എത്ര കിട്ടി", "ಹಣ", "ಎಷ್ಟು ಬಂತು"]],
  ["day", ["bookings", "booking", "appointments", "appointment", "list", "schedule", "who is coming", "बुकिंग", "लिस्ट", "kaun aa raha", "ബുക്കിംഗ്", "ബുക്കിങ്", "ലിസ്റ്റ്", "ಬುಕಿಂಗ್", "ಪಟ್ಟಿ"]],
];
const KIND_RES: readonly [OwnerKind, RegExp][] = KIND_WORDS.map(([kind, words]) => [kind, wordRe([...words], "iu")]);

/** A case reference: a letter the templates use, a hyphen and digits. Bookings b-, Fees f- and q- (a request to the owner), Orders o-. */
const REF_RE = /(?<![\p{L}\p{N}])([bfqo])-(\d{1,6})(?![\p{N}])/iu;

/** An amount with a rupee sign or word before or after it. Without one a number is never read as money: "close 16" must not be ₹16. */
const AMOUNT_RE = /(?:₹|rs\.?|inr|रु\.?|रुपये|रुपए)\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?|(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\s*(?:₹|rs\b|rupees?\b|रुपये|रुपए|രൂപ|ರೂಪಾಯ|ರೂ\.?)/iu;

/** The amount written in the words, in paise; undefined when none is written with a rupee sign or word. */
export function amountOf(text: string): number | undefined {
  const m = AMOUNT_RE.exec(text);
  if (!m) return undefined;
  const rupees = Number((m[1] ?? m[3]).replace(/,/gu, ""));
  const paise = Number((m[2] ?? m[4] ?? "0").padEnd(2, "0"));
  const total = rupees * 100 + paise;
  return Number.isSafeInteger(total) && total > 0 ? total : undefined;
}

/** The words of a message to send: everything after the reference (or after the command word when the reference comes first), without a leading "that"/":" and quotes. */
export function messageWords(text: string, ref: string): string | undefined {
  const at = text.toLowerCase().indexOf(ref);
  if (at < 0) return undefined;
  let after = text.slice(at + ref.length);
  const before = text.slice(0, at);
  // "b-14 ko bolo ki ..." / "tell b-14: ..." : the command word may be on either side of the reference
  const command = KIND_RES.find(([k]) => k === "message")![1];
  const cmdAfter = command.exec(after);
  if (cmdAfter && cmdAfter.index <= 12) after = after.slice(cmdAfter.index + cmdAfter[0].length);
  else if (!command.test(before)) return undefined;
  const words = after.replace(/^[\s:,;.\-–—]*(?:that|ki|कि|को|ko)?[\s:,;.\-–—]*/iu, "").replace(/^["'“‘](.*)["'”’]$/su, "$1").trim();
  return words.length > 0 ? words : undefined;
}

/** The rules' reading: the first kind whose words are in the message, and every value the words give. */
export function readOwnerRules(text: string, context: OwnerContext): OwnerIntent {
  const plainText = canon(text);
  const refHit = REF_RE.exec(plainText);
  const ref = refHit ? `${refHit[1].toLowerCase()}-${Number(refHit[2])}` : undefined;
  const withoutRef = ref ? plainText.replace(REF_RE, " ") : plainText;
  const date = findDatePhrase(withoutRef);
  const time = findTimePhrase(withoutRef);
  const amountPaise = amountOf(withoutRef);
  const script = languageOfScript(text);
  const language: Language | undefined = script === "en" ? undefined : script; // Latin letters may be English or Hindi typed in Latin letters: not clear
  const base = { ...(language ? { language } : {}), ...(date ? { date } : {}), ...(time ? { time } : {}), ...(ref ? { ref } : {}) };
  for (const [kind, re] of KIND_RES) {
    if (!re.test(withoutRef)) continue;
    // A message is only a message to a customer when it names one: "बताओ कल की बुकिंग" (tell me tomorrow's bookings) is a question, not something to send.
    if (kind === "message") { if (!ref) continue; const words = messageWords(text, ref); return { kind, ...base, ...(words ? { words } : {}) }; }
    if (kind === "refund") return { kind, ...base, ...(amountPaise !== undefined ? { amountPaise } : {}) };
    return { kind, ...base };
  }
  // A day and nothing else ("Sunday?", "16 Nov", "നാളെ") asks for that day's list. A time alone says nothing.
  if (date && !time && withoutRef.replace(/[\s?.!]/gu, "").length <= 24) return { kind: "day", ...base };
  return { kind: "unknown", ...base };
}

/** What each kind means, for the decision model's question and the language model's prompt. */
const KIND_MEANING: Record<Exclude<OwnerKind, "unknown">, string> = {
  day: "see the list of bookings for a day",
  owes: "see who still owes fees",
  open_orders: "see the orders that are still open",
  waiting: "see what is waiting for the owner's answer or approval",
  money: "know how much money came in",
  close_day: "close the shop on a day (no bookings that day)",
  reopen_day: "open the shop again on a day that was closed",
  move: "move a customer's booking to another day or time",
  cancel: "cancel a customer's booking or order",
  refund: "give a customer money back",
  message: "send a message to one customer",
  undo: "undo the last thing the assistant did",
  limit: "change a limit (a refund limit, a deposit, a cap)",
  help: "know what the assistant can do",
};

const offered = (context: OwnerContext): Exclude<OwnerKind, "unknown">[] => OWNER_KINDS.filter((k) => context.kinds.includes(k));

/** The owner's reading for the router. Only `kind` comes from a model; `merge` puts back the rules' values. */
export const ownerReading: Reading<OwnerIntent, OwnerContext, ParseOptionsBase> = {
  rules: readOwnerRules,

  coerce(raw, context) {
    if (!isObj(raw) || typeof raw.kind !== "string") return null;
    const kind = raw.kind as OwnerKind;
    if (kind !== "unknown" && !(OWNER_KINDS as readonly string[]).includes(kind)) return null;
    if (kind !== "unknown" && kind !== "help" && kind !== "limit" && !context.kinds.includes(kind)) return { kind: "unknown" };
    const out: OwnerIntent = { kind };
    if (raw.language === "hi" || raw.language === "en" || raw.language === "ml" || raw.language === "kn") out.language = raw.language;
    if (isObj(raw.date) && typeof raw.date.kind === "string") out.date = raw.date as unknown as DatePhrase;
    if (isObj(raw.time) && typeof raw.time.hour === "number" && typeof raw.time.minute === "number") out.time = raw.time as unknown as TimePhrase;
    if (typeof raw.ref === "string" && /^[bfqo]-\d{1,6}$/u.test(raw.ref)) out.ref = raw.ref;
    if (typeof raw.amountPaise === "number" && Number.isSafeInteger(raw.amountPaise) && raw.amountPaise > 0) out.amountPaise = raw.amountPaise;
    if (typeof raw.words === "string" && raw.words.trim() !== "" && raw.words.length <= 900) out.words = raw.words;
    return out;
  },

  prompt(context) {
    const kinds = offered(context);
    return [
      "You read one message a shop owner sent to their shop's assistant on WhatsApp. It may be in English, Hindi (also typed in Latin letters), Malayalam or Kannada.",
      "Say only what kind of thing the owner wants. Never copy names, numbers, dates or amounts: the assistant reads those from the words itself.",
      "Kinds:",
      ...kinds.map((k) => `- ${k}: the owner wants to ${KIND_MEANING[k]}`),
      "- unknown: none of these, or you are not sure",
      'Answer with JSON only: {"kind": "<one of the kinds>"}.',
    ].join("\n");
  },

  schema(context) {
    return { type: "object", properties: { kind: { type: "string", enum: [...offered(context), "unknown"] } }, required: ["kind"], additionalProperties: false };
  },

  shape(answer) {
    return isObj(answer) ? Object.fromEntries(Object.entries(answer).filter(([, v]) => v !== null)) : answer;
  },

  /** The rules are enough whenever they found a kind. A message they could not place goes to the models, which choose only the kind. */
  sure: (ruled) => ruled.kind !== "unknown",

  async decision(context, ruled): Promise<DecisionPlan<OwnerIntent>> {
    const kinds = offered(context);
    return {
      questions: { want: { type: "choice", instructions: "A shop owner wrote this to their shop's assistant. What do they want?", criteria: Object.fromEntries(kinds.map((k) => [k, KIND_MEANING[k]])) } },
      read(answers, threshold) {
        const a = answers.want;
        if (!a || a.type !== "choice" || chosenProbability(a) < threshold || !(kinds as string[]).includes(a.choice)) return null;
        return ownerReading.merge!({ kind: a.choice as OwnerKind }, ruled);
      },
    };
  },

  /** The model's kind with the rules' values: a date, a reference, an amount and a message's words come from the words, never from a model. */
  merge(modelIntent, ruled) {
    const words = modelIntent.kind === "message" && ruled.ref ? ruled.words : undefined;
    return {
      kind: modelIntent.kind,
      ...(ruled.language ? { language: ruled.language } : {}),
      ...(ruled.date ? { date: ruled.date } : {}),
      ...(ruled.time ? { time: ruled.time } : {}),
      ...(ruled.ref ? { ref: ruled.ref } : {}),
      ...(ruled.amountPaise !== undefined && modelIntent.kind === "refund" ? { amountPaise: ruled.amountPaise } : {}),
      ...(words ? { words } : {}),
    };
  },
};
