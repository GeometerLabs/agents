// The words of the owner's Money section, in four languages (owner-money.ts is the figures, owner-money-render.ts the page).
//
// English is the source. Hindi, Malayalam and Kannada are MACHINE-WRITTEN and wait for a native reader, like the rest of the owner's words (channels/words-money.ts);
// the section says so in that language (`machine`). No accounting word is used here (no debit, credit, ledger, receivable, journal): an owner reads this in 10
// seconds. Accounting words live only in the accountant's export (export.ts). None of the words report/claims.ts bans appear either (a test runs every language
// through it). "Payment service" is the plain name for the gateway; no provider is named.
import type { Language } from "../language/languages.ts";

type W<T> = Record<Language, T>;

export interface OwnerMoneyWords {
  /** Null in English; the machine-written note in the other three. */
  machine: string | null;
  title: string; today: string; month: string;
  received: string; givenBack: string; kept: string; charges: string; stillToCome: string;
  payments: (n: number) => string; refunds: (n: number) => string; fees: (n: number) => string;
  byWordTitle: string; byWordRow: (amount: string, caseRef: string) => string;
  owedTitle: string; owedNone: string;
  owedUpi: (caseRef: string) => string; owedService: (caseRef: string) => string;
  notMatchedTitle: string; notMatchedNone: string;
  upiClaim: (amount: string, caseRef: string) => string;
  gateway: (amount: string, caseRef: string, date: string) => string;
  /** The payment service is holding the payout; and a payout for a payment that did not go through the assistant. */
  gatewayHeld: (amount: string, caseRef: string) => string;
  notThrough: (amount: string) => string;
  untold: (amount: string, caseRef: string) => string;
  /** Said of a customer when the case is not known. */
  aCase: string;
  accountantTitle: string; accountantNote: string; thisMonth: string; lastMonth: string; thisYear: (fy: string) => string;
  /** The three downloads of a period, named for what is in them, and the one WhatsApp nudge to the accountant (a link of the words only: never a file or a customer). */
  fileJournal: string; fileDocuments: string; fileReadme: string; fileSettlements: string; fileTallyMasters: string; fileTallyVouchers: string; shareWhatsapp: string; shareText: (period: string) => string;
  scope: string;
}

export const OWNER_MONEY_WORDS: W<OwnerMoneyWords> = {
  en: {
    machine: null,
    title: "Money", today: "Today", month: "This month",
    received: "Received", givenBack: "Given back", kept: "Kept from cancellations", charges: "Payment service charges", stillToCome: "Still to come",
    payments: (n) => (n === 1 ? "1 payment" : `${n} payments`), refunds: (n) => (n === 1 ? "1 refund" : `${n} refunds`), fees: (n) => (n === 1 ? "from 1 fee" : `from ${n} fees`),
    byWordTitle: "Settled on someone's word, not counted in the totals above",
    byWordRow: (amount, c) => `${amount} for ${c}`,
    owedTitle: "Owed back to customers", owedNone: "Nothing is owed back.",
    owedUpi: (c) => `${c}: you pay this back by UPI, then mark it done.`,
    owedService: (c) => `${c}: this is waiting to go back through the payment service.`,
    notMatchedTitle: "Not matched yet", notMatchedNone: "Everything is matched.",
    upiClaim: (a, c) => `A customer says they paid ${a} for ${c}. Look in your UPI app.`,
    gateway: (a, c, d) => `${a} for ${c}, paid through the payment service on ${d}, is not yet in your bank.`,
    gatewayHeld: (a, c) => `${a} for ${c} is being held by the payment service, so it is not in your bank yet.`,
    notThrough: (a) => `${a} was paid into your bank for a payment not through your assistant. It is not in these books.`,
    untold: (a, c) => `A refund of ${a} for ${c} was made, but the customer has not been told yet. Please tell them.`,
    aCase: "a customer",
    accountantTitle: "Send to my accountant", accountantNote: "Every payment in a table that opens in Excel or Tally.",
    thisMonth: "This month", lastMonth: "Last month", thisYear: (fy) => `Financial year ${fy}`,
    fileJournal: "All payments", fileDocuments: "Receipts and bills", fileReadme: "Read me", fileSettlements: "Paid into the bank", fileTallyMasters: "For Tally: accounts", fileTallyVouchers: "For Tally: entries", shareWhatsapp: "Tell my accountant on WhatsApp", shareText: (p) => `My shop's accounts for ${p}`,
    scope: "These are the payments that went through your assistant. Money paid at the shop is not here.",
  },
  hi: {
    machine: "ये शब्द मशीन से लिखे गए हैं; कोई हिंदी पाठक इन्हें जाँचेगा।",
    title: "पैसे", today: "आज", month: "इस महीने",
    received: "मिले", givenBack: "लौटाए", kept: "रद्द करने पर रखे", charges: "पेमेंट सेवा का शुल्क", stillToCome: "अभी आना बाकी",
    payments: (n) => `${n} भुगतान`, refunds: (n) => `${n} रिफंड`, fees: (n) => `${n} फीस में से`,
    byWordTitle: "किसी के कहने पर निपटाए गए, ऊपर के जोड़ में नहीं",
    byWordRow: (amount, c) => `${c} के लिए ${amount}`,
    owedTitle: "ग्राहकों को लौटाना बाकी", owedNone: "कुछ भी लौटाना बाकी नहीं है।",
    owedUpi: (c) => `${c}: यह आप UPI से लौटाएँ, फिर \"हो गया\" चिह्नित करें।`,
    owedService: (c) => `${c}: यह पेमेंट सेवा से लौटने के इंतज़ार में है।`,
    notMatchedTitle: "अभी मिलान नहीं हुआ", notMatchedNone: "सब कुछ मिल गया है।",
    upiClaim: (a, c) => `एक ग्राहक कहता है कि उसने ${c} के लिए ${a} दिए हैं। अपने UPI ऐप में देखें।`,
    gateway: (a, c, d) => `${c} के लिए ${a}, ${d} को पेमेंट सेवा से आए, अभी आपके बैंक में नहीं पहुँचे हैं।`,
    gatewayHeld: (a, c) => `${c} के लिए ${a} पेमेंट सेवा ने रोक रखे हैं, इसलिए अभी आपके बैंक में नहीं हैं।`,
    notThrough: (a) => `${a} आपके बैंक में ऐसे भुगतान के लिए आए जो आपके असिस्टेंट से नहीं हुआ। यह इन हिसाबों में नहीं है।`,
    untold: (a, c) => `${c} के लिए ${a} का रिफंड हो चुका है, पर ग्राहक को अभी बताया नहीं गया। कृपया उन्हें बताएँ।`,
    aCase: "एक ग्राहक",
    accountantTitle: "मेरे अकाउंटेंट को भेजें", accountantNote: "हर भुगतान एक तालिका में, जो Excel या Tally में खुलती है।",
    thisMonth: "इस महीने", lastMonth: "पिछले महीने", thisYear: (fy) => `वित्त वर्ष ${fy}`,
    fileJournal: "सारे भुगतान", fileDocuments: "रसीदें और बिल", fileReadme: "पढ़ने के लिए", fileSettlements: "बैंक में आया पैसा", fileTallyMasters: "Tally के लिए: खाते", fileTallyVouchers: "Tally के लिए: एंट्री", shareWhatsapp: "WhatsApp पर अपने अकाउंटेंट को बताइए", shareText: (p) => `मेरी दुकान का हिसाब, ${p}`,
    scope: "ये वे भुगतान हैं जो आपके असिस्टेंट से होकर गए। दुकान पर दिया गया पैसा यहाँ नहीं है।",
  },
  ml: {
    machine: "ഈ വാക്കുകൾ യന്ത്രം എഴുതിയതാണ്; ഒരു മലയാളം വായനക്കാരൻ പരിശോധിക്കും.",
    title: "പണം", today: "ഇന്ന്", month: "ഈ മാസം",
    received: "കിട്ടിയത്", givenBack: "തിരികെ നൽകിയത്", kept: "റദ്ദാക്കലിൽ നിന്ന് എടുത്തുവച്ചത്", charges: "പേയ്‌മെന്റ് സേവനത്തിന്റെ ചാർജ്", stillToCome: "ഇനിയും കിട്ടാനുള്ളത്",
    payments: (n) => `${n} പേയ്‌മെന്റ്`, refunds: (n) => `${n} റീഫണ്ട്`, fees: (n) => `${n} ഫീസിൽ നിന്ന്`,
    byWordTitle: "ആരുടെയോ വാക്കിൽ തീർത്തത്, മുകളിലെ തുകകളിൽ ഇല്ല",
    byWordRow: (amount, c) => `${c}-ന് ${amount}`,
    owedTitle: "ഉപഭോക്താക്കൾക്ക് തിരികെ നൽകാനുള്ളത്", owedNone: "തിരികെ നൽകാൻ ഒന്നുമില്ല.",
    owedUpi: (c) => `${c}: ഇത് നിങ്ങൾ UPI വഴി തിരികെ നൽകി, പിന്നെ \"കഴിഞ്ഞു\" എന്ന് അടയാളപ്പെടുത്തണം.`,
    owedService: (c) => `${c}: ഇത് പേയ്‌മെന്റ് സേവനം വഴി തിരികെ പോകാൻ കാത്തിരിക്കുന്നു.`,
    notMatchedTitle: "ഇതുവരെ ഒത്തുനോക്കിയിട്ടില്ല", notMatchedNone: "എല്ലാം ഒത്തുനോക്കി.",
    upiClaim: (a, c) => `${c}-ന് ${a} അടച്ചു എന്ന് ഒരു ഉപഭോക്താവ് പറയുന്നു. നിങ്ങളുടെ UPI ആപ്പിൽ നോക്കുക.`,
    gateway: (a, c, d) => `${c}-ന് ${a}, ${d}-ന് പേയ്‌മെന്റ് സേവനം വഴി അടച്ചത്, ഇതുവരെ നിങ്ങളുടെ ബാങ്കിൽ എത്തിയിട്ടില്ല.`,
    gatewayHeld: (a, c) => `${c}-ന് ${a} പേയ്‌മെന്റ് സേവനം പിടിച്ചുവച്ചിരിക്കുന്നു, അതിനാൽ ഇതുവരെ നിങ്ങളുടെ ബാങ്കിൽ എത്തിയിട്ടില്ല.`,
    notThrough: (a) => `നിങ്ങളുടെ അസിസ്റ്റന്റ് വഴി അല്ലാത്ത ഒരു പേയ്‌മെന്റിന് ${a} നിങ്ങളുടെ ബാങ്കിൽ വന്നു. ഇത് ഈ കണക്കുകളിൽ ഇല്ല.`,
    untold: (a, c) => `${c}-ന് ${a} റീഫണ്ട് ചെയ്തു, പക്ഷേ ഉപഭോക്താവിനെ ഇതുവരെ അറിയിച്ചിട്ടില്ല. ദയവായി അറിയിക്കുക.`,
    aCase: "ഒരു ഉപഭോക്താവ്",
    accountantTitle: "എന്റെ അക്കൗണ്ടന്റിന് അയയ്ക്കുക", accountantNote: "എല്ലാ പേയ്‌മെന്റും Excel-ലോ Tally-യിലോ തുറക്കുന്ന ഒരു പട്ടികയിൽ.",
    thisMonth: "ഈ മാസം", lastMonth: "കഴിഞ്ഞ മാസം", thisYear: (fy) => `സാമ്പത്തിക വർഷം ${fy}`,
    fileJournal: "എല്ലാ പണമിടപാടുകളും", fileDocuments: "രസീതുകളും ബില്ലുകളും", fileReadme: "വായിക്കാൻ", fileSettlements: "ബാങ്കിൽ വന്ന പണം", fileTallyMasters: "Tally-ക്ക്: അക്കൗണ്ടുകൾ", fileTallyVouchers: "Tally-ക്ക്: എൻട്രികൾ", shareWhatsapp: "WhatsApp-ൽ അക്കൗണ്ടന്റിനോട് പറയൂ", shareText: (p) => `എന്റെ കടയുടെ കണക്കുകൾ, ${p}`,
    scope: "ഇവ നിങ്ങളുടെ അസിസ്റ്റന്റ് വഴി നടന്ന പേയ്‌മെന്റുകളാണ്. കടയിൽ നേരിട്ട് നൽകിയ പണം ഇവിടെ ഇല്ല.",
  },
  kn: {
    machine: "ಈ ಪದಗಳನ್ನು ಯಂತ್ರ ಬರೆದಿದೆ; ಕನ್ನಡ ಓದುಗರೊಬ್ಬರು ಪರಿಶೀಲಿಸುತ್ತಾರೆ.",
    title: "ಹಣ", today: "ಇಂದು", month: "ಈ ತಿಂಗಳು",
    received: "ಬಂದದ್ದು", givenBack: "ಹಿಂದಿರುಗಿಸಿದ್ದು", kept: "ರದ್ದತಿಯಿಂದ ಇಟ್ಟುಕೊಂಡದ್ದು", charges: "ಪಾವತಿ ಸೇವೆಯ ಶುಲ್ಕ", stillToCome: "ಇನ್ನೂ ಬರಬೇಕಾದದ್ದು",
    payments: (n) => `${n} ಪಾವತಿ`, refunds: (n) => `${n} ರೀಫಂಡ್`, fees: (n) => `${n} ಶುಲ್ಕಗಳಿಂದ`,
    byWordTitle: "ಯಾರದೋ ಮಾತಿನ ಮೇಲೆ ಮುಗಿಸಿದ್ದು, ಮೇಲಿನ ಮೊತ್ತದಲ್ಲಿ ಇಲ್ಲ",
    byWordRow: (amount, c) => `${c} ಗೆ ${amount}`,
    owedTitle: "ಗ್ರಾಹಕರಿಗೆ ಹಿಂದಿರುಗಿಸಬೇಕಾದದ್ದು", owedNone: "ಹಿಂದಿರುಗಿಸಲು ಏನೂ ಇಲ್ಲ.",
    owedUpi: (c) => `${c}: ಇದನ್ನು ನೀವು UPI ಮೂಲಕ ಹಿಂದಿರುಗಿಸಿ, ನಂತರ \"ಆಯಿತು\" ಎಂದು ಗುರುತಿಸಿ.`,
    owedService: (c) => `${c}: ಇದು ಪಾವತಿ ಸೇವೆಯ ಮೂಲಕ ಹಿಂದಿರುಗಲು ಕಾಯುತ್ತಿದೆ.`,
    notMatchedTitle: "ಇನ್ನೂ ಹೊಂದಿಸಿಲ್ಲ", notMatchedNone: "ಎಲ್ಲವೂ ಹೊಂದಿಕೆಯಾಗಿದೆ.",
    upiClaim: (a, c) => `${c} ಗೆ ${a} ಪಾವತಿಸಿದ್ದೇನೆ ಎಂದು ಒಬ್ಬ ಗ್ರಾಹಕ ಹೇಳುತ್ತಾರೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡಿ.`,
    gateway: (a, c, d) => `${c} ಗೆ ${a}, ${d} ರಂದು ಪಾವತಿ ಸೇವೆಯ ಮೂಲಕ ಬಂದದ್ದು, ಇನ್ನೂ ನಿಮ್ಮ ಬ್ಯಾಂಕ್‌ಗೆ ತಲುಪಿಲ್ಲ.`,
    gatewayHeld: (a, c) => `${c} ಗೆ ${a} ಅನ್ನು ಪಾವತಿ ಸೇವೆ ಹಿಡಿದಿಟ್ಟಿದೆ, ಆದ್ದರಿಂದ ಇನ್ನೂ ನಿಮ್ಮ ಬ್ಯಾಂಕ್‌ಗೆ ತಲುಪಿಲ್ಲ.`,
    notThrough: (a) => `ನಿಮ್ಮ ಸಹಾಯಕದ ಮೂಲಕ ನಡೆಯದ ಪಾವತಿಗೆ ${a} ನಿಮ್ಮ ಬ್ಯಾಂಕ್‌ಗೆ ಬಂದಿದೆ. ಇದು ಈ ಲೆಕ್ಕಗಳಲ್ಲಿ ಇಲ್ಲ.`,
    untold: (a, c) => `${c} ಗೆ ${a} ರೀಫಂಡ್ ಮಾಡಲಾಗಿದೆ, ಆದರೆ ಗ್ರಾಹಕರಿಗೆ ಇನ್ನೂ ತಿಳಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು ತಿಳಿಸಿ.`,
    aCase: "ಒಬ್ಬ ಗ್ರಾಹಕ",
    accountantTitle: "ನನ್ನ ಲೆಕ್ಕಿಗರಿಗೆ ಕಳುಹಿಸಿ", accountantNote: "ಪ್ರತಿ ಪಾವತಿಯೂ Excel ಅಥವಾ Tally ನಲ್ಲಿ ತೆರೆಯುವ ಕೋಷ್ಟಕದಲ್ಲಿ.",
    thisMonth: "ಈ ತಿಂಗಳು", lastMonth: "ಕಳೆದ ತಿಂಗಳು", thisYear: (fy) => `ಹಣಕಾಸು ವರ್ಷ ${fy}`,
    fileJournal: "ಎಲ್ಲಾ ಪಾವತಿಗಳು", fileDocuments: "ರಸೀದಿ ಮತ್ತು ಬಿಲ್‌ಗಳು", fileReadme: "ಓದಲು", fileSettlements: "ಬ್ಯಾಂಕಿಗೆ ಬಂದ ಹಣ", fileTallyMasters: "Tally ಗಾಗಿ: ಖಾತೆಗಳು", fileTallyVouchers: "Tally ಗಾಗಿ: ಎಂಟ್ರಿಗಳು", shareWhatsapp: "WhatsApp ನಲ್ಲಿ ನಿಮ್ಮ ಅಕೌಂಟೆಂಟ್‌ಗೆ ಹೇಳಿ", shareText: (p) => `ನನ್ನ ಅಂಗಡಿಯ ಲೆಕ್ಕ, ${p}`,
    scope: "ಇವು ನಿಮ್ಮ ಸಹಾಯಕದ ಮೂಲಕ ನಡೆದ ಪಾವತಿಗಳು. ಅಂಗಡಿಯಲ್ಲಿ ನೇರವಾಗಿ ಕೊಟ್ಟ ಹಣ ಇಲ್ಲಿ ಇಲ್ಲ.",
  },
};
