// Reading what a customer writes about a monthly plan (17 Nov 2026): a few plain words in four languages, with the rules alone. No model is asked, so a plan costs no AI
// allowance, and the reading can only ever mean one of: start a plan, skip a day, pause from a day, resume from a day, cancel the plan, or "my plan". It reads a day
// the way an order does (modules/language/dates.ts) and decides nothing: the cut-off, the capacity and the money are the ledger's and the agent's. It only looks at a message when the shop
// has plans, and a message with no plan word in it (and no plan on the customer) is never read as one, so "2 veg thali tomorrow" and a bare "cancel" go the way they always did.
// The Hindi, Malayalam and Kannada words are machine-written and wait for a native speaker's review, like the rest (REVIEW sheets list them).
import { findDatePhrase, phraseRe, wordRe } from "../../../../../modules/language/dates.ts";
import type { DatePhrase } from "../../../../../modules/language/dates.ts";
import { canon } from "../../../../../modules/language/format.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { PlanType } from "./settings.ts";
import { planName } from "./settings.ts";

export type PlanIntent =
  | { kind: "subscribe"; typeId?: string }
  | { kind: "skip"; date?: DatePhrase }
  | { kind: "pause"; date?: DatePhrase }
  | { kind: "resume"; date?: DatePhrase }
  | { kind: "cancel_plan" }
  | { kind: "my_plan" };

/** The words, by what they mean, for the review sheets: every language's words in each list, with the Latin-letter forms people type. */
export const PLAN_WORDS = {
  plan: ["plan", "monthly", "subscription", "subscribe", "monthly meals", "प्लान", "मासिक", "सब्सक्रिप्शन", "महीने का", "plan chahiye", "പ്ലാൻ", "മാസ പ്ലാൻ", "മാസത്തേക്ക്", "ಪ್ಲಾನ್", "ತಿಂಗಳ"],
  subscribe: ["subscribe", "join", "start", "want", "need", "take", "get", "सब्सक्राइब", "शुरू", "चाहिए", "लेना", "ചേരണം", "വേണം", "തുടങ്ങണം", "ಬೇಕು", "ಶುರು", "ಸೇರಬೇಕು"],
  skip: ["skip", "no meal", "don't send", "dont send", "स्किप", "छोड़", "मत भेजना", "नहीं चाहिए", "സ്കിപ്", "ഒഴിവാക്ക", "വേണ്ട", "ಸ್ಕಿಪ್", "ಬಿಟ್ಟು", "ಬೇಡ"],
  pause: ["pause", "hold", "break", "पॉज", "रोक", "रोकना", "പോസ്", "നിർത്തിവയ്ക്ക", "ಪಾಸ್", "ನಿಲ್ಲಿಸಿ", "ನಿಲ್ಲಿಸ"],
  resume: ["resume", "restart", "continue", "start again", "फिर से शुरू", "दोबारा शुरू", "चालू करें", "വീണ്ടും തുടങ്ങ", "പുനരാരംഭ", "ಮತ್ತೆ ಶುರು", "ಮುಂದುವರಿ"],
  cancel: ["cancel", "end", "stop", "unsubscribe", "close", "रद्द", "बंद", "खत्म", "റദ്ദ", "നിർത്ത", "ರದ್ದು", "ನಿಲ್ಲಿಸು"],
  mine: ["my plan", "my subscription", "plan status", "मेरा प्लान", "എന്റെ പ്ലാൻ", "ನನ್ನ ಪ್ಲಾನ್"],
} as const;

const RE = {
  plan: wordRe([...PLAN_WORDS.plan]),
  subscribe: wordRe([...PLAN_WORDS.subscribe]),
  skip: phraseRe([...PLAN_WORDS.skip]),
  pause: phraseRe([...PLAN_WORDS.pause]),
  resume: phraseRe([...PLAN_WORDS.resume]),
  cancel: phraseRe([...PLAN_WORDS.cancel]),
  mine: phraseRe([...PLAN_WORDS.mine]),
};

/** Does the message name a plan at all? The only thing that lets a customer with no plan reach the plan reading. */
export const mentionsPlan = (text: string): boolean => RE.plan.test(canon(text));

/**
 * Read one message. `hasPlan` says the customer already has a plan: then "skip tomorrow" or "pause from monday" need no word for "plan". Without one, only a message that
 * names a plan is read here ("I want the monthly plan"). Undefined: not about a plan.
 */
export function readPlanIntent(text: string, hasPlan: boolean, types: readonly PlanType[], languages: readonly Language[]): PlanIntent | undefined {
  const t = canon(text);
  const named = RE.plan.test(t);
  if (!hasPlan && !named) return undefined;
  const date = findDatePhrase(text);
  // order matters: "resume" and "cancel plan" before "pause"/"skip", because "stop my plan" is not a skip
  if (hasPlan && RE.resume.test(t)) return { kind: "resume", ...(date ? { date } : {}) };
  if (hasPlan && named && RE.cancel.test(t)) return { kind: "cancel_plan" };
  if (hasPlan && RE.skip.test(t)) return { kind: "skip", ...(date ? { date } : {}) };
  if (hasPlan && RE.pause.test(t)) return { kind: "pause", ...(date ? { date } : {}) };
  if (hasPlan && (named || RE.mine.test(t))) return { kind: "my_plan" };
  if (named && (RE.subscribe.test(t) || types.length > 0)) return { kind: "subscribe", ...typeNamed(t, types, languages) };
  return undefined;
}

/** The plan type a message names by one of its names, if exactly one is named. */
function typeNamed(t: string, types: readonly PlanType[], languages: readonly Language[]): { typeId?: string } {
  // the longest name written wins, so "home lunch" is the home plan although "lunch" is also in the other's name
  const scored = types.map((type) => ({ type, len: Math.max(0, ...languages.flatMap((l) => (type.names[l] ?? []).filter((n) => t.includes(canon(n))).map((n) => n.length))) })).filter((x) => x.len > 0).sort((x, y) => y.len - x.len);
  return scored.length > 0 && (scored.length === 1 || scored[0].len > scored[1].len) ? { typeId: scored[0].type.id } : {};
}

/** The plans as one line of words, "Lunch plan ₹2,400, Dinner plan ₹2,800": what a customer who named no plan is asked to choose from (read whole by the outgoing check). */
export const plansLine = (types: readonly PlanType[], language: Language, price: (inr: number) => string): string => types.map((t) => `${planName(t, language)} ${price(t.priceInr)}`).join(", ");
