// What the assistant says to the owner about the shop's model budget (decision 60, "caps everywhere", 18 Nov 2026), in English, Hindi, Malayalam and Kannada: most of the month's
// budget is used, it is used up, a feature's daily cap is reached, and a listing that cannot be drafted because of a cap. Kept apart from words.ts like words-memory.ts and
// words-leave.ts; words.ts's `write` reads this table for the id `budget_line`. Plain words for an owner who has never heard of a model or a token: "thinking budget", "buttons still work".
// Every line says what STILL works (buttons, the fixed answers, the plain form) and when the assistant is back; nothing is ever just "no". Every date goes through the Writer so
// the outgoing check can read it. The Hindi, Malayalam and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts, "the model budget").
// Words that no owner-facing line may carry (claims.ts) are not used: no "100%", and no promise beyond "it is back on <date>".
import type { LocalDate } from "../core/time.ts";
import type { Language } from "../language/languages.ts";
import type { Feature } from "../budget/budget.ts";
import type { Writer } from "./words.ts";

export type BudgetLine =
  | { line: "warn" | "full" | "listing_month"; backOn: LocalDate }
  | { line: "day"; feature: Feature };

export interface BudgetMessageData { budget_line: BudgetLine }

/** The features a daily line is written for, in one place so the review sheet and the test can walk them. */
export const DAY_FEATURES: readonly Feature[] = ["owner_talk", "customer_talk", "listing_draft", "router", "buyer"];

type Day = Record<Feature, string>;
type Table = { warn: (back: string) => string; full: (back: string) => string; listingMonth: (back: string) => string; day: Day };

const T: Record<Language, Table> = {
  en: {
    warn: (b) => `A heads-up: most of my thinking budget for this month is used. If it runs out, buttons and my fixed answers keep working, and I am back on ${b}.`,
    full: (b) => `Your assistant's thinking budget for this month is used up. Buttons still work; it is back on ${b}.`,
    listingMonth: (b) => `Your assistant's thinking budget for this month is used up, so I cannot write the listing. Use the Add to my page form in your app: a photo, a title and a price. I am back on ${b}.`,
    day: {
      owner_talk: "I have talked as much as I can for today. Buttons and my fixed answers still work; I am back tomorrow.",
      customer_talk: "Today's limit for answering customers' open questions on my own is reached. Customers get your shop's menus and fixed answers; it is back tomorrow.",
      listing_draft: "Today's limit for writing listings is reached. Use the Add to my page form in your app: a photo, a title and a price. Writing is back tomorrow.",
      router: "Today's limit for reading free-form messages is reached. Buttons and the rules still read them; it is back tomorrow.",
      buyer: "Today's limit for the buying assistant is reached. Plain search still works; it is back tomorrow.",
    },
  },
  hi: {
    warn: (b) => `ध्यान दें: इस महीने का मेरा सोचने का बजट ज़्यादातर खर्च हो चुका है। ख़त्म हो गया तो बटन और मेरे तय जवाब चलते रहेंगे, और ${b} से मैं फिर पूरा चलूँगा।`,
    full: (b) => `इस महीने के लिए आपके असिस्टेंट का सोचने का बजट ख़त्म हो गया है। बटन चलते रहेंगे; यह ${b} से फिर चलेगा।`,
    listingMonth: (b) => `इस महीने के लिए आपके असिस्टेंट का सोचने का बजट ख़त्म हो गया है, इसलिए मैं लिस्टिंग नहीं लिख सकता। अपने ऐप में मेरे पेज पर जोड़ें फ़ॉर्म इस्तेमाल करें: फ़ोटो, नाम और दाम। मैं ${b} से फिर लिख सकूँगा।`,
    day: {
      owner_talk: "आज की बातचीत की सीमा पूरी हो गई। बटन और मेरे तय जवाब चलते रहेंगे; कल से फिर बात हो सकेगी।",
      customer_talk: "आज ग्राहकों के खुले सवालों का जवाब देने की सीमा पूरी हो गई। ग्राहकों को आपकी दुकान के मेनू और तय जवाब मिलेंगे; कल से फिर चलेगा।",
      listing_draft: "आज लिस्टिंग लिखने की सीमा पूरी हो गई। अपने ऐप में मेरे पेज पर जोड़ें फ़ॉर्म इस्तेमाल करें: फ़ोटो, नाम और दाम। कल से मैं फिर लिख सकूँगा।",
      router: "आज खुले संदेश पढ़ने की सीमा पूरी हो गई। बटन और नियम अब भी उन्हें पढ़ते हैं; कल से फिर चलेगा।",
      buyer: "आज खरीदारी वाले असिस्टेंट की सीमा पूरी हो गई। सीधी खोज अब भी चलती है; कल से फिर चलेगा।",
    },
  },
  ml: {
    warn: (b) => `ശ്രദ്ധിക്കുക: ഈ മാസത്തെ എന്റെ ചിന്താ ബജറ്റിൽ ഭൂരിഭാഗവും ഉപയോഗിച്ചു. തീർന്നാലും ബട്ടണുകളും എന്റെ സ്ഥിര ഉത്തരങ്ങളും പ്രവർത്തിക്കും, ${b} മുതൽ ഞാൻ വീണ്ടും പൂർണ്ണമായി ഉണ്ടാകും.`,
    full: (b) => `ഈ മാസത്തെ നിങ്ങളുടെ അസിസ്റ്റന്റിന്റെ ചിന്താ ബജറ്റ് തീർന്നു. ബട്ടണുകൾ പ്രവർത്തിക്കും; ${b} മുതൽ വീണ്ടും ലഭിക്കും.`,
    listingMonth: (b) => `ഈ മാസത്തെ നിങ്ങളുടെ അസിസ്റ്റന്റിന്റെ ചിന്താ ബജറ്റ് തീർന്നതിനാൽ എനിക്ക് ലിസ്റ്റിംഗ് എഴുതാൻ കഴിയില്ല. നിങ്ങളുടെ ആപ്പിലെ എന്റെ പേജിൽ ചേർക്കുക ഫോം ഉപയോഗിക്കുക: ഫോട്ടോ, പേര്, വില. ${b} മുതൽ ഞാൻ വീണ്ടും എഴുതും.`,
    day: {
      owner_talk: "ഇന്നത്തെ സംസാരത്തിന്റെ പരിധി എത്തി. ബട്ടണുകളും എന്റെ സ്ഥിര ഉത്തരങ്ങളും പ്രവർത്തിക്കും; നാളെ വീണ്ടും സംസാരിക്കാം.",
      customer_talk: "ഉപഭോക്താക്കളുടെ തുറന്ന ചോദ്യങ്ങൾക്ക് ഇന്ന് ഉത്തരം നൽകാനുള്ള പരിധി എത്തി. ഉപഭോക്താക്കൾക്ക് നിങ്ങളുടെ കടയുടെ മെനുവും സ്ഥിര ഉത്തരങ്ങളും കിട്ടും; നാളെ വീണ്ടും പ്രവർത്തിക്കും.",
      listing_draft: "ഇന്ന് ലിസ്റ്റിംഗ് എഴുതാനുള്ള പരിധി എത്തി. നിങ്ങളുടെ ആപ്പിലെ എന്റെ പേജിൽ ചേർക്കുക ഫോം ഉപയോഗിക്കുക: ഫോട്ടോ, പേര്, വില. നാളെ ഞാൻ വീണ്ടും എഴുതും.",
      router: "സ്വതന്ത്ര സന്ദേശങ്ങൾ വായിക്കാനുള്ള ഇന്നത്തെ പരിധി എത്തി. ബട്ടണുകളും നിയമങ്ങളും ഇപ്പോഴും അവ വായിക്കും; നാളെ വീണ്ടും പ്രവർത്തിക്കും.",
      buyer: "വാങ്ങൽ അസിസ്റ്റന്റിന്റെ ഇന്നത്തെ പരിധി എത്തി. സാധാരണ തിരയൽ ഇപ്പോഴും പ്രവർത്തിക്കും; നാളെ വീണ്ടും ലഭിക്കും.",
    },
  },
  kn: {
    warn: (b) => `ಗಮನಿಸಿ: ಈ ತಿಂಗಳ ನನ್ನ ಯೋಚನೆಯ ಬಜೆಟ್‌ನ ಹೆಚ್ಚಿನ ಭಾಗ ಬಳಕೆಯಾಗಿದೆ. ಮುಗಿದರೂ ಬಟನ್‌ಗಳು ಮತ್ತು ನನ್ನ ನಿಗದಿತ ಉತ್ತರಗಳು ಕೆಲಸ ಮಾಡುತ್ತವೆ, ${b} ರಿಂದ ನಾನು ಮತ್ತೆ ಪೂರ್ಣವಾಗಿ ಇರುತ್ತೇನೆ.`,
    full: (b) => `ಈ ತಿಂಗಳ ನಿಮ್ಮ ಅಸಿಸ್ಟೆಂಟ್‌ನ ಯೋಚನೆಯ ಬಜೆಟ್ ಮುಗಿದಿದೆ. ಬಟನ್‌ಗಳು ಕೆಲಸ ಮಾಡುತ್ತವೆ; ${b} ರಿಂದ ಮತ್ತೆ ಸಿಗುತ್ತದೆ.`,
    listingMonth: (b) => `ಈ ತಿಂಗಳ ನಿಮ್ಮ ಅಸಿಸ್ಟೆಂಟ್‌ನ ಯೋಚನೆಯ ಬಜೆಟ್ ಮುಗಿದಿರುವುದರಿಂದ ನಾನು ಲಿಸ್ಟಿಂಗ್ ಬರೆಯಲಾರೆ. ನಿಮ್ಮ ಆ್ಯಪ್‌ನಲ್ಲಿ ನನ್ನ ಪುಟಕ್ಕೆ ಸೇರಿಸಿ ಫಾರ್ಮ್ ಬಳಸಿ: ಫೋಟೋ, ಹೆಸರು, ಬೆಲೆ. ${b} ರಿಂದ ನಾನು ಮತ್ತೆ ಬರೆಯುತ್ತೇನೆ.`,
    day: {
      owner_talk: "ಇಂದಿನ ಮಾತುಕತೆಯ ಮಿತಿ ತಲುಪಿದೆ. ಬಟನ್‌ಗಳು ಮತ್ತು ನನ್ನ ನಿಗದಿತ ಉತ್ತರಗಳು ಕೆಲಸ ಮಾಡುತ್ತವೆ; ನಾಳೆ ಮತ್ತೆ ಮಾತನಾಡಬಹುದು.",
      customer_talk: "ಗ್ರಾಹಕರ ಮುಕ್ತ ಪ್ರಶ್ನೆಗಳಿಗೆ ಇಂದು ಉತ್ತರಿಸುವ ಮಿತಿ ತಲುಪಿದೆ. ಗ್ರಾಹಕರಿಗೆ ನಿಮ್ಮ ಅಂಗಡಿಯ ಮೆನು ಮತ್ತು ನಿಗದಿತ ಉತ್ತರಗಳು ಸಿಗುತ್ತವೆ; ನಾಳೆ ಮತ್ತೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ.",
      listing_draft: "ಇಂದು ಲಿಸ್ಟಿಂಗ್ ಬರೆಯುವ ಮಿತಿ ತಲುಪಿದೆ. ನಿಮ್ಮ ಆ್ಯಪ್‌ನಲ್ಲಿ ನನ್ನ ಪುಟಕ್ಕೆ ಸೇರಿಸಿ ಫಾರ್ಮ್ ಬಳಸಿ: ಫೋಟೋ, ಹೆಸರು, ಬೆಲೆ. ನಾಳೆ ನಾನು ಮತ್ತೆ ಬರೆಯುತ್ತೇನೆ.",
      router: "ಮುಕ್ತ ಸಂದೇಶಗಳನ್ನು ಓದುವ ಇಂದಿನ ಮಿತಿ ತಲುಪಿದೆ. ಬಟನ್‌ಗಳು ಮತ್ತು ನಿಯಮಗಳು ಈಗಲೂ ಅವನ್ನು ಓದುತ್ತವೆ; ನಾಳೆ ಮತ್ತೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ.",
      buyer: "ಖರೀದಿ ಅಸಿಸ್ಟೆಂಟ್‌ನ ಇಂದಿನ ಮಿತಿ ತಲುಪಿದೆ. ಸಾಮಾನ್ಯ ಹುಡುಕಾಟ ಈಗಲೂ ಕೆಲಸ ಮಾಡುತ್ತದೆ; ನಾಳೆ ಮತ್ತೆ ಸಿಗುತ್ತದೆ.",
    },
  },
};

const line = (language: Language, d: BudgetLine, w: Writer): string => {
  const t = T[language];
  if (d.line === "day") return t.day[d.feature];
  const back = w.date(d.backOn);
  return d.line === "warn" ? t.warn(back) : d.line === "full" ? t.full(back) : t.listingMonth(back);
};

export const BUDGET_WORDS: Record<Language, { budget_line: (d: BudgetLine, w: Writer) => string }> = {
  en: { budget_line: (d, w) => line("en", d, w) }, hi: { budget_line: (d, w) => line("hi", d, w) },
  ml: { budget_line: (d, w) => line("ml", d, w) }, kn: { budget_line: (d, w) => line("kn", d, w) },
};
