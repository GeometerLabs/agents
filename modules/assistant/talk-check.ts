// The checks a talk reply passes BEFORE anything is sent (block M, next-phase 1a "Grounding, not only numbers"). The model's reply is untrusted: it comes as sentences, each
// naming the sources it rests on, and this file decides whether the whole reply may go. Checking numbers alone is not enough: a reply could say "the owner guarantees this"
// with no number in it. So five checks, in this order, and the first that fails stops the reply (the caller sends the owner a fixed line with the real numbers, or a customer
// the template's menu, and the record keeps which check failed):
//   1. every source a sentence names exists, and is one the speaker may see (the prompt's own list: a note or a record of another audience is not in it);
//   2. every number, amount, date, time and percentage a sentence states is one ITS sources state (language/check.ts over the facts of just those sources);
//   3. claims and commitments ("guarantee", "promise", "we will", "the owner says", "free", "discount", "refund", "waive", in four languages): to a customer, the
//      sentence must name a note for everyone, or a setting, whose own words say the same kind of thing; with none it is refused;
//   4. completion ("booked", "confirmed", "paid", "refunded", "cancelled", "sent", in four languages) is refused in any talk reply: only the template's own messages,
//      written from the record, say that something happened;
//   5. no link and no phone number but the shop's own, the length cap, and the speaker's language.
// It is pure and imports nothing that reads disk. A word list can miss a phrase; it fails closed where it can (an unlisted number word is still caught by check 2).
import { checkText } from "../language/check.ts";
import type { CheckFacts } from "../language/check.ts";
import { languageOfScript, plain } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { BANNED } from "../report/claims.ts";
import type { TalkAnswer, TalkSource } from "./talk-types.ts";

export type CheckNumber = 1 | 2 | 3 | 4 | 5;
export type TalkCheck = { ok: true; text: string; facts: CheckFacts } | { ok: false; check: CheckNumber; why: string };

/** The kinds of promise a sentence can make. A source backs a sentence only for a kind its own words state. */
export type ClaimKind = "assure" | "speaks_for_owner" | "money_off";

const U = (re: string) => new RegExp(re, "iu");
const NL = "(?![\\p{L}\\p{M}])"; // a word's end, in scripts where \b does not work
const NB = "(?<![\\p{L}\\p{M}])";

/** Words that promise or assure, speak for the owner, or offer money off, in the four languages (English words are looked for in every language: they sit in any text). */
const CLAIM_WORDS: Record<ClaimKind, RegExp> = {
  assure: U(`${NB}(?:guarantee[ds]?|guaranteeing|promise[ds]?|promising|assure[ds]?|assurance|for sure|definitely|certainly|absolutely|sure thing|no doubt|100 ?%)${NL}|गारंटी|गारण्टी|वादा|पक्का|यक़ीन|यकीन|भरोसा दिल|ഉറപ്പ്|ഉറപ്പാ|വാക്ക് നൽ|ഗ്യാരണ്ടി|ഗ്യാരന്റി|ಖಾತರಿ|ಖಾತ್ರಿ|ಭರವಸೆ|ಗ್ಯಾರಂಟಿ|ವಾಗ್ದಾನ`),
  speaks_for_owner: U(`${NB}(?:the owner (?:says|said|has|will|agreed|approved|allows?|allowed)|owner (?:says|said|agreed|approved)|we (?:will|shall|can promise)|we'll|i will make sure|will be honou?red|has agreed|has approved|is allowed)${NL}|मालिक ने|मालिक कहते|मालिक ने कहा|हम करेंगे|हम देंगे|करवा देंगे|ഉടമ പറഞ്ഞു|ഉടമ സമ്മതിച്ചു|ഉടമ അനുവദിച്ചു|ഞങ്ങൾ ചെയ്യും|ഞങ്ങൾ തരും|ಮಾಲೀಕರು ಹೇಳಿ|ಮಾಲೀಕರು ಒಪ್ಪಿ|ನಾವು ಮಾಡುತ್ತೇವೆ|ನಾವು ಕೊಡುತ್ತೇವೆ`),
  money_off: U(`${NB}(?:free(?! (?:time|times|slot|slots|day|days|hour|hours|appointment|appointments|on|at|from|today|tomorrow|now|this|next))|complimentary|discount(?:s|ed)?|waive[ds]?|waiver|refund(?:s|ed)?|cashback|no charge|on the house|half price|offer(?:s)? you)${NL}|\\d\\s*(?:%|per ?cent)\\s*off|मुफ़्त|मुफ्त|फ्री|डिस्काउंट|छूट|रिफंड|माफ़|माफ|सौजन्य|സൗജന്യം|ഫ്രീ|ഡിസ്കൗണ്ട്|ഇളവ്|റീഫണ്ട്|ഒഴിവാക്ക|ಉಚಿತ|ಫ್ರೀ|ಡಿಸ್ಕೌಂಟ್|ರಿಯಾಯಿತಿ|ರೀಫಂಡ್|ಮನ್ನಾ`),
};

/** Words that say something happened. Only the template's own messages, written from the record, may say these. */
const COMPLETION = U(`${NB}(?:booked|confirmed|paid|refunded|cancell?ed|canceled|sent|scheduled|reserved|completed|done|processed|credited|rescheduled|moved)${NL}|बुक हो|बुक कर दि|बुक कर लि|कन्फर्म हो|कन्फर्म कर|पक्की हो|भुगतान हो|भुगतान कर दि|पेमेंट हो|रिफंड हो|रिफंड कर दि|रद्द हो|रद्द कर दि|रद्द कर दी|भेज दि|भेज दी|बुक ചെയ്തു|ബുക്ക് ചെയ്തു|ബുക്ക് ആയി|ഉറപ്പിച്ചു|ഉറപ്പായി|പണമടച്ചു|പേയ്മെന്റ് ലഭിച്ചു|റീഫണ്ട് ചെയ്തു|റദ്ദാക്കി|റദ്ദായി|അയച്ചു|ಬುಕ್ ಮಾಡಲಾಗಿದೆ|ಬುಕ್ ಆಗಿದೆ|ದೃಢಪಡಿಸಲಾಗಿದೆ|ಖಚಿತವಾಗಿದೆ|ಪಾವತಿಸಲಾಗಿದೆ|ಪಾವತಿ ಆಗಿದೆ|ರೀಫಂಡ್ ಮಾಡಲಾಗಿದೆ|ರದ್ದುಮಾಡಲಾಗಿದೆ|ರದ್ದಾಗಿದೆ|ಕಳುಹಿಸಲಾಗಿದೆ`);

/** Number words and fractions a reply may not use unless the same word is in a source it names ("half price" needs a source that says half). */
const NUMBER_WORDS = U(`${NB}(?:half|quarter|double|twice|triple|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozen)${NL}|आधा|आधी|दोगुना|दुगना|दस|बीस|तीस|चालीस|पचास|साठ|सत्तर|अस्सी|नब्बे|പകുതി|ഇരട്ടി|പത്ത്|ഇരുപത്|മുപ്പത്|നാൽപ്പത്|അമ്പത്|അറുപത്|ഏഴുപത്|എൺപത്|തൊണ്ണൂറ്|ಅರ್ಧ|ದುಪ್ಪಟ್ಟು|ಹತ್ತು|ಇಪ್ಪತ್ತು|ಮೂವತ್ತು|ನಲವತ್ತು|ಐವತ್ತು|ಅರವತ್ತು|ಎಪ್ಪತ್ತು|ಎಂಭತ್ತು|ತೊಂಬತ್ತು`);
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|per ?cent|प्रतिशत|ശതമാനം|ಶೇಕಡಾ|ಪ್ರತಿಶತ|ಶೇ\.?)/giu;
const LINK = /(?:https?:\/\/|www\.)[^\s)]+|\b(?:[a-z0-9-]+\.)+(?:com|in|dev|co|org|net|app|io|me|link)(?:\/[^\s)]*)?/giu;
const LONG_DIGITS = /\d[\d\s().+-]{6,}\d/gu;

/** Which kinds of claim a text states. */
export function claimKindsOf(text: string): ClaimKind[] {
  const t = plain(text);
  return (Object.keys(CLAIM_WORDS) as ClaimKind[]).filter((k) => CLAIM_WORDS[k].test(t));
}

/** The numbers (integers and decimals, in any digit script) a text states. */
const numbersOf = (text: string): number[] => [...plain(text).matchAll(/\d+(?:\.\d+)?/gu)].map((m) => Number(m[0]));

export interface CheckInput {
  role: "owner" | "customer";
  answer: TalkAnswer;
  /** Every source the prompt listed: this is the scope. A sentence naming an id outside it fails check 1. */
  scope: readonly TalkSource[];
  /** The speaker's own words (redacted or not: only their script is read), for the language check. */
  speakerText: string;
  /** The speaker's language preference when their words do not say (a bare "ok"). */
  speakerLanguage: Language;
  timeZone: string;
  /** The shop's own links, and the names and numbers a reply may repeat (the shop's name and its own phone number). */
  links: readonly string[];
  literals: readonly string[];
  maxChars: number;
}

/** The facts check.ts reads for one sentence: only what its own sources state. */
function factsFor(sources: readonly TalkSource[], i: CheckInput): CheckFacts {
  const numbers = sources.flatMap((s) => numbersOf(s.text));
  return {
    language: i.speakerLanguage, timeZone: i.timeZone,
    amountsInr: [...sources.flatMap((s) => s.amountsInr ?? []), ...numbers],
    counts: numbers,
    momentsMs: sources.flatMap((s) => s.momentsMs ?? []),
    links: i.links,
    literals: [...i.literals, ...sources.flatMap((s) => s.literals ?? [])],
  };
}

/** Run the five checks. On success: the reply's text (the sentences, joined) and the facts the outgoing check will read over the whole reply. */
export function checkTalk(i: CheckInput): TalkCheck {
  const byId = new Map(i.scope.map((s) => [s.id, s]));
  const fail = (check: CheckNumber, why: string): TalkCheck => ({ ok: false, check, why });
  const text = i.answer.sentences.map((s) => s.text).join(" ");

  // 1. every named source exists and is in this speaker's scope
  for (const s of i.answer.sentences) for (const id of s.sources) if (!byId.has(id)) return fail(1, `a sentence names the source "${id}", which is not one this speaker may see`);

  // 4. completion words: refused, whatever they rest on (checked before the numbers so the record says the plainer reason)
  for (const s of i.answer.sentences) if (COMPLETION.test(plain(s.text))) return fail(4, "a sentence says that something was done; only the shop's own messages, written from the record, say that");

  // 3. claims and commitments: to a customer, each needs a note for everyone or a setting that says the same kind of thing
  if (i.role === "customer") {
    for (const s of i.answer.sentences) {
      const t = plain(s.text);
      if ([...BANNED.any, ...BANNED.hi, ...BANNED.ml, ...BANNED.kn].some((re) => re.test(t))) return fail(3, "a sentence uses a word the shop's documents never use (a safety, guarantee or earnings claim)");
      for (const kind of claimKindsOf(t)) {
        const backing = s.sources.map((id) => byId.get(id)!).filter((src) => src.kind !== "record" && claimKindsOf(src.text).includes(kind));
        if (backing.length === 0) return fail(3, `a sentence makes a ${kind.replace(/_/gu, " ")} claim that no note for everyone and no setting says`);
      }
    }
  }

  // 2. numbers, amounts, dates, times, percentages and number words: only what the sentence's own sources state
  for (const s of i.answer.sentences) {
    const sources = s.sources.map((id) => byId.get(id)!);
    const own = sources.map((x) => plain(x.text)).join(" \n ");
    const t = plain(s.text);
    for (const m of t.matchAll(PERCENT)) {
      const same = new RegExp(`${m[1].replace(/\./gu, "\\.")}\\s*(?:%|per ?cent|प्रतिशत|ശതമാനം|ಶೇಕಡಾ|ಪ್ರತಿಶತ|ಶೇ)`, "iu");
      if (!same.test(own)) return fail(2, `a sentence says ${m[1]}%, which none of its sources states`);
    }
    for (const m of t.matchAll(new RegExp(NUMBER_WORDS.source, "giu"))) if (!own.toLowerCase().includes(m[0].toLowerCase())) return fail(2, `a sentence uses the number word "${m[0]}", which none of its sources uses`);
    const r = checkText(s.text, factsFor(sources, i));
    if (!r.ok) return fail(2, r.problems.join(" "));
  }

  // 5. the shop's own links and number only, the length, and the speaker's language
  const maskLiterals = (t: string) => i.literals.reduce((acc, l) => (l ? acc.split(plain(l)).join(" ") : acc), plain(t));
  const shown = maskLiterals(text);
  for (const m of shown.matchAll(LINK)) {
    if (!i.links.some((l) => l.toLowerCase().replace(/^https?:\/\//u, "").startsWith(m[0].toLowerCase().replace(/^https?:\/\//u, "").replace(/[.,;:!?]+$/u, "")) || m[0].toLowerCase().includes(l.toLowerCase().replace(/^https?:\/\//u, "")))) return fail(5, `the reply has the link "${m[0]}", which is not one of the shop's own`);
  }
  for (const m of shown.matchAll(LONG_DIGITS)) if (m[0].replace(/\D/gu, "").length >= 7) return fail(5, "the reply has a phone number that is not the shop's own");
  if (text.length > i.maxChars) return fail(5, `the reply is ${text.length} characters, over the ${i.maxChars} the talk allows`);
  const spoke = languageOfScript(i.speakerText);
  const answered = languageOfScript(text);
  if (spoke !== "en" ? answered !== spoke : answered !== "en") return fail(5, "the reply is not in the language the speaker wrote in");

  return { ok: true, text, facts: wholeReplyFacts(i) };
}

/** The facts for the outgoing check over the whole reply: the union of what the sentences' own sources state (each sentence already passed on its own). */
function wholeReplyFacts(i: CheckInput): CheckFacts {
  const byId = new Map(i.scope.map((s) => [s.id, s]));
  const used = [...new Set(i.answer.sentences.flatMap((s) => s.sources))].map((id) => byId.get(id)!);
  return factsFor(used, i);
}
