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
import { esc, fig } from "../report/page.ts";
import type { Language } from "../language/languages.ts";

export interface MoneyBlockWords {
  heading: string;
  received: string; givenBack: string; kept: string;
  /** At the month's end: refunds still owed back to customers, and (Fees) fees still to come in. */
  owedBack: string; toCome: string;
  /** Refunds settled on someone's word only: shown on their own and left out of "given back" (the owner's Money section words them the same way). */
  byWord: string;
}

const OWN: Record<Language, Pick<MoneyBlockWords, "heading" | "owedBack" | "toCome">> = {
  en: { heading: "Money this month", owedBack: "Still owed back at the end of the month", toCome: "Still to come at the end of the month" },
  hi: { heading: "इस महीने के पैसे", owedBack: "महीने के अंत में ग्राहकों को लौटाना बाकी", toCome: "महीने के अंत में अभी आना बाकी" },
  ml: { heading: "ഈ മാസത്തെ പണം", owedBack: "മാസാവസാനം ഉപഭോക്താക്കൾക്ക് തിരികെ നൽകാനുള്ളത്", toCome: "മാസാവസാനം ഇനിയും കിട്ടാനുള്ളത്" },
  kn: { heading: "ಈ ತಿಂಗಳ ಹಣ", owedBack: "ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ಗ್ರಾಹಕರಿಗೆ ಹಿಂದಿರುಗಿಸಬೇಕಾದದ್ದು", toCome: "ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ಇನ್ನೂ ಬರಬೇಕಾದದ್ದು" },
};

const wordsFor = (l: Language): MoneyBlockWords => {
  const o = OWNER_MONEY_WORDS[l];
  return { ...OWN[l], received: o.received, givenBack: o.givenBack, kept: o.kept, byWord: o.byWordTitle };
};

export const MONEY_BLOCK_WORDS: Record<Language, MoneyBlockWords> = { en: wordsFor("en"), hi: wordsFor("hi"), ml: wordsFor("ml"), kn: wordsFor("kn") };

/**
 * The block as HTML for the report page (the cards of modules/report/page.ts). `toCome`: a template that bills in advance (Fees) also shows what is still to come in.
 * What is shown: received and given back always; what the shop kept only when something was; refunds settled on someone's word only when there were some, and
 * never inside "given back" (the same rule as the owner's Money section); what is still owed back always (a plain zero is an answer).
 */
export function moneyBlock(summary: AccountingSummary, words: MoneyBlockWords, options: { toCome?: boolean } = {}): string {
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
  return `<h2>${esc(words.heading)}</h2><div class="cards">${cards.join("")}</div>`;
}
