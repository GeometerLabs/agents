// The words of a customer's document page (receipt, bill, bill of supply, refund note), in the four languages. English is the source. Hindi, Malayalam and Kannada
// are MACHINE-WRITTEN and wait for a native reader, like the rest of the customer pages' words (the page says so at its top in that language: PAGE[language].machine
// in modules/channels/words.ts, reused by document-page.ts).
//
// Why the words are kept apart from the pages' other words: a document is read by an accountant and may be printed, so its fixed words (title, number, date, amount)
// are also printed in English beside the customer's language (document-page.ts uses EN for that). The tax words (`legend`) are used ONLY for a composition shop: an
// unregistered shop's document never says "tax" in any language (the test in test/documents.test.ts looks for the English word and each language's own).
// No word here says "safe", "guaranteed", "certified" or "earn" (modules/report/claims.ts checks every page).
import type { Language } from "../language/languages.ts";
import type { Evidence } from "./journal.ts";
import type { Method } from "./accounts.ts";

type W<T> = Record<Language, T>;

/** The four kinds of title, by the shop's tax status and the document's series (documents.ts). */
export type DocKind = "receipt" | "bill" | "bill_of_supply" | "refund_note";

export interface DocWords {
  title: Record<DocKind, string>;
  /** Over the amount: money received, money to pay, money sent back. */
  amountLabel: Record<DocKind, string>;
  number: string; date: string; forLabel: string; person: string; phone: string; paidBy: string; howKnown: string;
  method: Record<Method, string>;
  /** How the money is known. A refund's owner mark says "sent", a payment's says "received". */
  evidence: Record<Evidence, string>;
  ownerMarkRefund: string;
  /** A refund note's line citing its receipt. */
  cites: (number: string, date: string) => string;
  /** The line CGST rule 5(1)(f) asks a composition shop to print at the top of its documents. */
  legend: string;
  footer: (shop: string) => string;
  printHint: string;
}

export const DOC: W<DocWords> = {
  en: {
    title: { receipt: "Receipt", bill: "Bill", bill_of_supply: "Bill of supply", refund_note: "Refund note" },
    amountLabel: { receipt: "Amount received", bill: "Amount", bill_of_supply: "Amount", refund_note: "Amount sent back" },
    number: "Number", date: "Date", forLabel: "For", person: "Name", phone: "Phone", paidBy: "Paid by", howKnown: "How it is known",
    method: { gateway: "Online", upi: "UPI", cash: "Cash", bank: "Bank transfer" },
    evidence: { provider: "Confirmed by the payment service", owner_mark: "Marked received by the shop owner", person_word: "Settled by a person's word" },
    ownerMarkRefund: "Marked sent by the shop owner",
    cites: (n, d) => `Refund of receipt ${n} (${d})`,
    legend: "composition taxable person, not eligible to collect tax on supplies",
    footer: (s) => `Made by computer for ${s}.`,
    printHint: "To keep a copy, choose \"Print / Save as PDF\" in your phone's menu.",
  },
  hi: {
    title: { receipt: "रसीद", bill: "बिल", bill_of_supply: "आपूर्ति का बिल", refund_note: "पैसे वापसी का नोट" },
    amountLabel: { receipt: "मिली रकम", bill: "रकम", bill_of_supply: "रकम", refund_note: "लौटाई गई रकम" },
    number: "क्रमांक", date: "तारीख़", forLabel: "किसलिए", person: "नाम", phone: "फ़ोन", paidBy: "भुगतान का तरीका", howKnown: "कैसे पता चला",
    method: { gateway: "ऑनलाइन", upi: "UPI", cash: "नकद", bank: "बैंक ट्रांसफ़र" },
    evidence: { provider: "पेमेंट सेवा ने पुष्टि की", owner_mark: "दुकान के मालिक ने पैसे मिलना दर्ज किया", person_word: "एक व्यक्ति के कहने पर निपटाया गया" },
    ownerMarkRefund: "दुकान के मालिक ने पैसे भेजना दर्ज किया",
    cites: (n, d) => `रसीद ${n} (${d}) के पैसे की वापसी`,
    legend: "कंपोज़िशन करदाता, आपूर्ति पर कर वसूलने का पात्र नहीं",
    footer: (s) => `यह ${s} के लिए कंप्यूटर से बनाया गया है।`,
    printHint: "अपनी कॉपी रखने के लिए फ़ोन के मेन्यू में \"Print / Save as PDF\" चुनिए।",
  },
  ml: {
    title: { receipt: "രസീത്", bill: "ബിൽ", bill_of_supply: "സപ്ലൈ ബിൽ", refund_note: "പണം തിരികെ നൽകിയ കുറിപ്പ്" },
    amountLabel: { receipt: "ലഭിച്ച തുക", bill: "തുക", bill_of_supply: "തുക", refund_note: "തിരികെ നൽകിയ തുക" },
    number: "നമ്പർ", date: "തീയതി", forLabel: "എന്തിന്", person: "പേര്", phone: "ഫോൺ", paidBy: "അടച്ച വിധം", howKnown: "എങ്ങനെ അറിയാം",
    method: { gateway: "ഓൺലൈൻ", upi: "UPI", cash: "പണം", bank: "ബാങ്ക് ട്രാൻസ്ഫർ" },
    evidence: { provider: "പേയ്‌മെന്റ് സേവനം സ്ഥിരീകരിച്ചു", owner_mark: "പണം ലഭിച്ചതായി കടയുടമ രേഖപ്പെടുത്തി", person_word: "ഒരാളുടെ വാക്കിൽ തീർപ്പാക്കി" },
    ownerMarkRefund: "പണം തിരികെ അയച്ചതായി കടയുടമ രേഖപ്പെടുത്തി",
    cites: (n, d) => `രസീത് ${n} (${d}) പ്രകാരമുള്ള പണം തിരികെ`,
    legend: "കോമ്പോസിഷൻ നികുതിദായകൻ; വിതരണങ്ങളിൽ നികുതി ഈടാക്കാൻ അർഹതയില്ല",
    footer: (s) => `${s}-നായി കമ്പ്യൂട്ടർ ഉണ്ടാക്കിയത്.`,
    printHint: "കോപ്പി സൂക്ഷിക്കാൻ ഫോണിലെ മെനുവിൽ \"Print / Save as PDF\" തിരഞ്ഞെടുക്കുക.",
  },
  kn: {
    title: { receipt: "ರಶೀದಿ", bill: "ಬಿಲ್", bill_of_supply: "ಪೂರೈಕೆ ಬಿಲ್", refund_note: "ಹಣ ಹಿಂತಿರುಗಿಸಿದ ಟಿಪ್ಪಣಿ" },
    amountLabel: { receipt: "ಸ್ವೀಕರಿಸಿದ ಮೊತ್ತ", bill: "ಮೊತ್ತ", bill_of_supply: "ಮೊತ್ತ", refund_note: "ಹಿಂತಿರುಗಿಸಿದ ಮೊತ್ತ" },
    number: "ಸಂಖ್ಯೆ", date: "ದಿನಾಂಕ", forLabel: "ಯಾವುದಕ್ಕೆ", person: "ಹೆಸರು", phone: "ಫೋನ್", paidBy: "ಪಾವತಿ ವಿಧಾನ", howKnown: "ಹೇಗೆ ತಿಳಿದಿದೆ",
    method: { gateway: "ಆನ್‌ಲೈನ್", upi: "UPI", cash: "ನಗದು", bank: "ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆ" },
    evidence: { provider: "ಪಾವತಿ ಸೇವೆ ದೃಢಪಡಿಸಿದೆ", owner_mark: "ಹಣ ಬಂದಿದೆ ಎಂದು ಅಂಗಡಿ ಮಾಲೀಕರು ಗುರುತಿಸಿದ್ದಾರೆ", person_word: "ಒಬ್ಬ ವ್ಯಕ್ತಿಯ ಮಾತಿನ ಮೇಲೆ ಇತ್ಯರ್ಥವಾಗಿದೆ" },
    ownerMarkRefund: "ಹಣ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಅಂಗಡಿ ಮಾಲೀಕರು ಗುರುತಿಸಿದ್ದಾರೆ",
    cites: (n, d) => `ರಶೀದಿ ${n} (${d}) ಹಣದ ಮರುಪಾವತಿ`,
    legend: "ಸಂಯೋಜನೆ ತೆರಿಗೆದಾರ; ಪೂರೈಕೆಗಳ ಮೇಲೆ ತೆರಿಗೆ ಸಂಗ್ರಹಿಸಲು ಅರ್ಹರಲ್ಲ",
    footer: (s) => `${s} ಗಾಗಿ ಕಂಪ್ಯೂಟರ್ ಮೂಲಕ ತಯಾರಿಸಲಾಗಿದೆ.`,
    printHint: "ಪ್ರತಿ ಉಳಿಸಲು ಫೋನ್‌ನ ಮೆನುವಿನಲ್ಲಿ \"Print / Save as PDF\" ಆರಿಸಿ.",
  },
};
