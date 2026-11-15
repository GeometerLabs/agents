// The "Money this month" block of a monthly report page: a few bold figures from the signed books summary (summary.ts), in plain words, in four languages.
//
// Why one file for three templates: Bookings, Orders and Fees show the same four or five figures, so the words and the markup live here once and each template's
// report/strings.ts takes `MONEY_BLOCK_WORDS[language]` as its `moneyBlock` (so the native review sheets list them with the template's other words). The figures are
// read from the summary only, by kind of money fact and the closing balances, so no account name or accounting word reaches the owner's page.
//
// Words: English is the source. Hindi, Malayalam and Kannada are MACHINE-WRITTEN and wait for a native reader, like the owner's money words they share (words-owner.ts:
// received, given back, kept, still to come); the report page already marks its machine-written languages in its own words (the words are not repeated here). None of the words report/claims.ts bans appear (a test checks every language).
import { OWNER_MONEY_WORDS } from "./words-owner.ts";
import { inr } from "./owner-money-render.ts";
import type { AccountingSummary } from "./summary.ts";
import type { BooksOnly } from "./figures.ts";
import { esc, fig } from "../report/page.ts";
import type { Language } from "../language/languages.ts";

export interface MoneyBlockWords {
  heading: string;
  received: string; givenBack: string; kept: string;
  /** At the month's end: refunds still owed back to customers, and (Fees) fees still to come in. */
  owedBack: string; toCome: string;
  /** Refunds settled on someone's word only: shown on their own and left out of "given back" (the owner's Money section words them the same way). */
  byWord: string;
  /**
   * The lines under the cards that say why the block differs from the report's own rows ({amount} is the rupees). The block counts money the standard way: a payment
   * counts when it arrives, and a payment made twice is the customer's money owed back, not the shop's. The report's rows count deposits, advances or fees only.
   */
  paidTwice: string; markedReceived: string; markedGivenBack: string;
}


type OwnWords = Pick<MoneyBlockWords, "heading" | "owedBack" | "toCome" | "paidTwice" | "markedReceived" | "markedGivenBack">;
const OWN: Record<Language, OwnWords> = {
  en: { heading: "Money this month", owedBack: "Still owed back at the end of the month", toCome: "Still to come at the end of the month",
    paidTwice: "\"Received\" includes {amount} that customers paid twice. That money is theirs, not the shop's.",
    markedReceived: "\"Received\" includes {amount} that you marked as paid yourself. The rows above count only payments that your payment service confirmed.",
    markedGivenBack: "\"Given back\" includes {amount} that you marked as sent yourself." },
  hi: { heading: "इस महीने के पैसे", owedBack: "महीने के अंत में ग्राहकों को लौटाना बाकी", toCome: "महीने के अंत में अभी आना बाकी",
    paidTwice: "\"मिले\" में {amount} शामिल हैं जो ग्राहकों ने दो बार चुकाए। वह पैसा उनका है, दुकान का नहीं।",
    markedReceived: "\"मिले\" में {amount} शामिल हैं जिन्हें आपने खुद मिला हुआ दर्ज किया। ऊपर की पंक्तियाँ सिर्फ़ वे भुगतान गिनती हैं जिनकी पुष्टि आपकी पेमेंट सेवा ने की।",
    markedGivenBack: "\"लौटाए\" में {amount} शामिल हैं जिन्हें आपने खुद भेजा हुआ दर्ज किया।" },
  ml: { heading: "ഈ മാസത്തെ പണം", owedBack: "മാസാവസാനം ഉപഭോക്താക്കൾക്ക് തിരികെ നൽകാനുള്ളത്", toCome: "മാസാവസാനം ഇനിയും കിട്ടാനുള്ളത്",
    paidTwice: "\"കിട്ടിയത്\" എന്നതിൽ ഉപഭോക്താക്കൾ രണ്ടുതവണ അടച്ച {amount} ഉൾപ്പെടുന്നു. ആ പണം അവരുടേതാണ്, കടയുടേതല്ല.",
    markedReceived: "\"കിട്ടിയത്\" എന്നതിൽ നിങ്ങൾ സ്വയം കിട്ടിയതായി രേഖപ്പെടുത്തിയ {amount} ഉൾപ്പെടുന്നു. മുകളിലെ വരികൾ നിങ്ങളുടെ പേയ്‌മെന്റ് സേവനം സ്ഥിരീകരിച്ച പേയ്‌മെന്റുകൾ മാത്രമേ എണ്ണുന്നുള്ളൂ.",
    markedGivenBack: "\"തിരികെ നൽകിയത്\" എന്നതിൽ നിങ്ങൾ സ്വയം അയച്ചതായി രേഖപ്പെടുത്തിയ {amount} ഉൾപ്പെടുന്നു." },
  kn: { heading: "ಈ ತಿಂಗಳ ಹಣ", owedBack: "ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ಗ್ರಾಹಕರಿಗೆ ಹಿಂದಿರುಗಿಸಬೇಕಾದದ್ದು", toCome: "ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ಇನ್ನೂ ಬರಬೇಕಾದದ್ದು",
    paidTwice: "\"ಬಂದದ್ದು\" ಇದರಲ್ಲಿ ಗ್ರಾಹಕರು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ {amount} ಸೇರಿದೆ. ಆ ಹಣ ಅವರದು, ಅಂಗಡಿಯದಲ್ಲ.",
    markedReceived: "\"ಬಂದದ್ದು\" ಇದರಲ್ಲಿ ನೀವೇ ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿದ {amount} ಸೇರಿದೆ. ಮೇಲಿನ ಸಾಲುಗಳು ನಿಮ್ಮ ಪಾವತಿ ಸೇವೆ ದೃಢಪಡಿಸಿದ ಪಾವತಿಗಳನ್ನು ಮಾತ್ರ ಎಣಿಸುತ್ತವೆ.",
    markedGivenBack: "\"ಹಿಂದಿರುಗಿಸಿದ್ದು\" ಇದರಲ್ಲಿ ನೀವೇ ಕಳುಹಿಸಿದೆ ಎಂದು ಗುರುತಿಸಿದ {amount} ಸೇರಿದೆ." },
};

const wordsFor = (l: Language): MoneyBlockWords => {
  const o = OWNER_MONEY_WORDS[l];
  return { ...OWN[l], received: o.received, givenBack: o.givenBack, kept: o.kept, byWord: o.byWordTitle };
};

export const MONEY_BLOCK_WORDS: Record<Language, MoneyBlockWords> = { en: wordsFor("en"), hi: wordsFor("hi"), ml: wordsFor("ml"), kn: wordsFor("kn") };

/**
 * The block as HTML for the report page (the cards of modules/report/page.ts). `toCome`: a template that bills in advance (Fees) also shows what is still to come in.
 * What is shown: received and given back always; what the shop kept only when something was; refunds settled on someone's word only when there were some, and
 * never inside "given back" (the same rule as the owner's Money section); what is still owed back always (a plain zero is an answer). `booksOnly`: under the cards, a
 * line for each kind of money the block counts and the report's rows above do not (a payment made twice, the owner's own marks), so the two never look like a mistake.
 */
export function moneyBlock(summary: AccountingSummary, words: MoneyBlockWords, options: { toCome?: boolean; booksOnly?: BooksOnly } = {}): string {
  const paiseOf = (kind: string): number => summary.byKind.find((k) => k.kind === kind)?.paise ?? 0;
  const card = (label: string, paise: number): string => `<div class="card">${fig(inr(paise))}<span>${esc(label)}</span></div>`;
  const cards = [
    card(words.received, paiseOf("received")),
    card(words.givenBack, paiseOf("refund_made") - summary.byWord.paise),
    ...(paiseOf("kept") > 0 ? [card(words.kept, paiseOf("kept"))] : []),
    ...(summary.byWord.paise > 0 ? [card(words.byWord, summary.byWord.paise)] : []),
    card(words.owedBack, summary.closing.refundsOwedPaise),
    ...(options.toCome ? [card(words.toCome, Math.max(0, summary.closing.receivablePaise))] : []),
  ];
  // why the block differs from the rows above it, one line for each kind of money the rows leave out
  const b = options.booksOnly;
  const why = b === undefined ? [] : ([[words.paidTwice, b.paidTwicePaise], [words.markedReceived, b.markedReceivedPaise], [words.markedGivenBack, b.markedGivenBackPaise]] as const)
    .filter(([, paise]) => paise > 0).map(([line, paise]) => `<p class="small">${esc(line.replace("{amount}", inr(paise)))}</p>`);
  return `<h2>${esc(words.heading)}</h2><div class="cards">${cards.join("")}</div>${why.join("")}`;
}
