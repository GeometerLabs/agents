// The words of a shop of several template parts (decision 65) that are the shop's own, not any part's: what each part is called, and the one short question the shop asks when
// two parts could take a message (go/internal/parts router). The Go program reads them GENERATED from this file (go/scripts/gen_parts_words.ts writes go/internal/parts/words.json;
// `--check` and contract/words-fresh.test.ts say when it is stale), never retyped.
//
// Each part has three names: `owner` (how the owner knows it), `customer` (how a customer is asked about it), `button` (a WhatsApp reply button's title, 20 characters at most).
// The question has `{parts}` where the names go, joined by `or`. No number is in any of them, so the outgoing check has nothing to hold against the record.
// Hindi, Malayalam and Kannada are machine-written and wait for a native reader (the owner reads Malayalam and Hindi).
import type { Language } from "../../../../modules/language/languages.ts";

export interface PartNames { owner: string; customer: string; button: string; customerButton: string }

/** A part's names by the kind of part it is: the credit book (Fees with `creditBook`), Fees, the pickup hold (Orders with no advance), Orders, Stock orders. */
export type PartKind = "credit" | "fees" | "hold" | "orders" | "stock-orders";

export const PART_NAMES: Record<PartKind, Record<Language, PartNames>> = {
  credit: {
    en: { owner: "the credit book", customer: "what you owe the shop", button: "Credit book", customerButton: "What I owe" },
    hi: { owner: "उधार खाता", customer: "दुकान का आपका बकाया", button: "उधार खाता", customerButton: "मेरा बकाया" },
    ml: { owner: "കടം കണക്ക്", customer: "കടയിലെ നിങ്ങളുടെ കടം", button: "കടം കണക്ക്", customerButton: "എന്റെ കടം" },
    kn: { owner: "ಸಾಲದ ಲೆಕ್ಕ", customer: "ಅಂಗಡಿಗೆ ನೀವು ಕೊಡಬೇಕಾದದ್ದು", button: "ಸಾಲದ ಲೆಕ್ಕ", customerButton: "ನನ್ನ ಬಾಕಿ" },
  },
  fees: {
    en: { owner: "fees", customer: "your fees", button: "Fees", customerButton: "My fees" },
    hi: { owner: "फ़ीस", customer: "आपकी फ़ीस", button: "फ़ीस", customerButton: "मेरी फ़ीस" },
    ml: { owner: "ഫീസ്", customer: "നിങ്ങളുടെ ഫീസ്", button: "ഫീസ്", customerButton: "എന്റെ ഫീസ്" },
    kn: { owner: "ಶುಲ್ಕ", customer: "ನಿಮ್ಮ ಶುಲ್ಕ", button: "ಶುಲ್ಕ", customerButton: "ನನ್ನ ಶುಲ್ಕ" },
  },
  hold: {
    en: { owner: "holds", customer: "keeping an item for you", button: "Holds", customerButton: "Keep an item" },
    hi: { owner: "सामान रखवाना", customer: "आपके लिए सामान रखना", button: "सामान रखवाना", customerButton: "सामान रखें" },
    ml: { owner: "സാധനം മാറ്റിവയ്ക്കൽ", customer: "നിങ്ങൾക്കായി സാധനം മാറ്റിവയ്ക്കൽ", button: "മാറ്റിവയ്ക്കൽ", customerButton: "സാധനം വയ്ക്കുക" },
    kn: { owner: "ವಸ್ತು ಕಾಯ್ದಿರಿಸುವಿಕೆ", customer: "ನಿಮಗಾಗಿ ವಸ್ತು ಕಾಯ್ದಿರಿಸುವುದು", button: "ಕಾಯ್ದಿರಿಸುವಿಕೆ", customerButton: "ವಸ್ತು ಇಡಿ" },
  },
  orders: {
    en: { owner: "orders", customer: "an order", button: "Orders", customerButton: "An order" },
    hi: { owner: "ऑर्डर", customer: "एक ऑर्डर", button: "ऑर्डर", customerButton: "ऑर्डर" },
    ml: { owner: "ഓർഡറുകൾ", customer: "ഒരു ഓർഡർ", button: "ഓർഡറുകൾ", customerButton: "ഓർഡർ" },
    kn: { owner: "ಆರ್ಡರ್‌ಗಳು", customer: "ಒಂದು ಆರ್ಡರ್", button: "ಆರ್ಡರ್‌ಗಳು", customerButton: "ಆರ್ಡರ್" },
  },
  "stock-orders": {
    en: { owner: "supplier orders", customer: "an order to a supplier", button: "Supplier orders", customerButton: "Supplier order" },
    hi: { owner: "सप्लायर ऑर्डर", customer: "सप्लायर को ऑर्डर", button: "सप्लायर ऑर्डर", customerButton: "सप्लायर ऑर्डर" },
    ml: { owner: "വിതരണക്കാരുടെ ഓർഡർ", customer: "വിതരണക്കാരനുള്ള ഓർഡർ", button: "വിതരണ ഓർഡർ", customerButton: "വിതരണ ഓർഡർ" },
    kn: { owner: "ಪೂರೈಕೆದಾರರ ಆರ್ಡರ್", customer: "ಪೂರೈಕೆದಾರರಿಗೆ ಆರ್ಡರ್", button: "ಪೂರೈಕೆ ಆರ್ಡರ್", customerButton: "ಪೂರೈಕೆ ಆರ್ಡರ್" },
  },
};

export interface QuestionWords { owner: string; customer: string; or: string }

/** The one short question, to the owner and to a customer. */
export const QUESTION: Record<Language, QuestionWords> = {
  en: { owner: "Which part is this for: {parts}? Tap one, or send its name.", customer: "Is this about {parts}? Tap one, or send its name.", or: " or " },
  hi: { owner: "यह किसके लिए है: {parts}? एक दबाएँ, या उसका नाम भेजें।", customer: "क्या यह {parts} के बारे में है? एक दबाएँ, या उसका नाम भेजें।", or: " या " },
  ml: { owner: "ഇത് ഏതിനു വേണ്ടിയാണ്: {parts}? ഒന്ന് അമർത്തുക, അല്ലെങ്കിൽ അതിന്റെ പേര് അയയ്ക്കുക.", customer: "ഇത് {parts} എന്നതിനെക്കുറിച്ചാണോ? ഒന്ന് അമർത്തുക, അല്ലെങ്കിൽ അതിന്റെ പേര് അയയ്ക്കുക.", or: " അല്ലെങ്കിൽ " },
  kn: { owner: "ಇದು ಯಾವುದಕ್ಕಾಗಿ: {parts}? ಒಂದನ್ನು ಒತ್ತಿ, ಅಥವಾ ಅದರ ಹೆಸರು ಕಳುಹಿಸಿ.", customer: "ಇದು {parts} ಬಗ್ಗೆಯೇ? ಒಂದನ್ನು ಒತ್ತಿ, ಅಥವಾ ಅದರ ಹೆಸರು ಕಳುಹಿಸಿ.", or: " ಅಥವಾ " },
};

/** The question with the names put in: "a, b or c" (each language's own "or" before the last). */
export function question(language: Language, to: "owner" | "customer", names: string[]): string {
  const q = QUESTION[language];
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")}${q.or}${names.at(-1)}`;
  return q[to].replace("{parts}", list);
}
