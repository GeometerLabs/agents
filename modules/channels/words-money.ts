// Money clarity (batch 4, 14 Nov 2026): the words of the money parts of the shop's pages, kept apart from words.ts and words-orders-fees.ts so the pages' other words
// are not touched. Two sets:
//   MONEY        what a customer reads on the UPI box and the "I have paid" part of a booking's, an order's and a fee's page (copy the UPI ID, open in Chrome, the UPI
//                reference, how long a check takes, "payment did not go through?", and a payment made after the time ended);
//   OWNER_MONEY  what the owner reads on their page (customers who say they paid first, holds that are only waiting, a hold that ended where money may have come, and
//                Fees' "paid in cash or by bank?").
// English is the source. Hindi, Malayalam and Kannada are MACHINE-WRITTEN and wait for a native reader like the rest of the pages' words (each page already says so at
// its top in that language: PAGE[language].machine). Used by page.ts (upiBox), fee-page.ts and owner-page.ts, and nowhere else.
//
// What the words never do: say the agent has the money (it cannot see a UPI payment: only the owner can, in their own UPI app), promise a refund before the owner has
// said so, or promise more than the shop does. "The shop usually checks within 30 minutes" is the usual, not a rule: CHECK_MINUTES is the one figure, in one place.
import type { Language } from "../language/languages.ts";

type W<T> = Record<Language, T>;

/** How long a shop usually takes to look in its UPI app after "I have paid" (a usual, said as one; the owner is asked at once and again within the hour). */
export const CHECK_MINUTES = 30;

export interface MoneyWords {
  copyId: string; copied: string;
  openChrome: string; chromeNote: string;
  refLabel: string; refHint: string;
  paid: string;
  /** After "I have paid": what the shop does now, and how long it usually takes. */
  claimed: string; checkTime: (minutes: number) => string;
  failTitle: string; failTips: [string, string, string]; retry: string;
  /** A booking whose time ran out: money may have come as it did. `lateTitle` over the form, `lateNote` under it, `lateClaimed` once it is pressed. */
  lateTitle: string; lateNote: string; lateClaimed: string; lateRefund: string;
}

export const MONEY: W<MoneyWords> = {
  en: {
    copyId: "Copy UPI ID", copied: "UPI ID copied",
    openChrome: "Open in Chrome", chromeNote: "If your UPI app does not open from here, open this page in Chrome.",
    refLabel: "UPI reference (optional)", refHint: "The 12 digits in your UPI app's payment details. It helps the shop find your payment.",
    paid: "I have paid",
    claimed: "You said you have paid. The shop will look in its UPI app.", checkTime: (m) => `It usually takes about ${m} minutes. This page changes once the shop has seen it.`,
    failTitle: "Payment did not go through?",
    failTips: [
      "First look in your bank app. If the money has left your account, do not pay again: tap \"I have paid\" and the shop will find it.",
      "If your app said it was declined, try another UPI app, or pay to the UPI ID above by typing it in.",
      "Still stuck? Ask the shop. Your time stays held until it ends.",
    ],
    retry: "Try again",
    lateTitle: "Paid after the time ended?", lateNote: "If money left your account as the time ran out, tell us. The shop will refund it or book you again.",
    lateClaimed: "We have noted your payment. The shop will check it, then refund it or book you again.", lateRefund: "Refund",
  },
  hi: {
    copyId: "UPI ID कॉपी करें", copied: "UPI ID कॉपी हो गई",
    openChrome: "Chrome में खोलें", chromeNote: "अगर यहाँ से आपका UPI ऐप नहीं खुलता, तो इस पेज को Chrome में खोलिए।",
    refLabel: "UPI रेफ़रेंस (ज़रूरी नहीं)", refHint: "आपके UPI ऐप के पेमेंट विवरण में दिए 12 अंक। इससे दुकान आपका पेमेंट आसानी से ढूँढ लेती है।",
    paid: "मैंने पेमेंट कर दिया",
    claimed: "आपने बताया कि पेमेंट कर दिया है। दुकान अपने UPI ऐप में देखेगी।", checkTime: (m) => `आमतौर पर इसमें लगभग ${m} मिनट लगते हैं। दुकान के देख लेने पर यह पेज बदल जाएगा।`,
    failTitle: "पेमेंट नहीं हो पाया?",
    failTips: [
      "पहले अपने बैंक ऐप में देखिए। अगर पैसे कट गए हैं, तो दोबारा पेमेंट मत कीजिए: \"मैंने पेमेंट कर दिया\" दबाइए, दुकान उसे ढूँढ लेगी।",
      "अगर ऐप ने पेमेंट रद्द बताया, तो दूसरा UPI ऐप आज़माइए, या ऊपर दी गई UPI ID डालकर पेमेंट कीजिए।",
      "फिर भी दिक्कत है? दुकान से पूछिए। आपका समय रोका गया है, जब तक वह ख़त्म न हो।",
    ],
    retry: "फिर कोशिश कीजिए",
    lateTitle: "समय ख़त्म होने के बाद पेमेंट हुआ?", lateNote: "अगर समय ख़त्म होते-होते आपके पैसे कट गए, तो हमें बताइए। दुकान उन्हें वापस करेगी या आपको दोबारा बुक करेगी।",
    lateClaimed: "हमने आपका पेमेंट नोट कर लिया है। दुकान उसे देखकर पैसे वापस करेगी या आपको दोबारा बुक करेगी।", lateRefund: "रिफ़ंड",
  },
  ml: {
    copyId: "UPI ID പകർത്തുക", copied: "UPI ID പകർത്തി",
    openChrome: "Chrome-ൽ തുറക്കുക", chromeNote: "ഇവിടെ നിന്ന് നിങ്ങളുടെ UPI ആപ്പ് തുറക്കുന്നില്ലെങ്കിൽ, ഈ പേജ് Chrome-ൽ തുറക്കൂ.",
    refLabel: "UPI റഫറൻസ് (നിർബന്ധമില്ല)", refHint: "നിങ്ങളുടെ UPI ആപ്പിലെ പേയ്‌മെന്റ് വിവരങ്ങളിലെ 12 അക്കങ്ങൾ. ഇത് കട നിങ്ങളുടെ പേയ്‌മെന്റ് കണ്ടെത്താൻ സഹായിക്കും.",
    paid: "ഞാൻ അടച്ചു",
    claimed: "നിങ്ങൾ അടച്ചു എന്ന് പറഞ്ഞു. കട അവരുടെ UPI ആപ്പിൽ നോക്കും.", checkTime: (m) => `സാധാരണ ഏകദേശം ${m} മിനിറ്റ് എടുക്കും. കട കണ്ടുകഴിഞ്ഞാൽ ഈ പേജ് മാറും.`,
    failTitle: "പേയ്‌മെന്റ് നടന്നില്ലേ?",
    failTips: [
      "ആദ്യം നിങ്ങളുടെ ബാങ്ക് ആപ്പിൽ നോക്കൂ. പണം പോയിട്ടുണ്ടെങ്കിൽ വീണ്ടും അടയ്ക്കരുത്: \"ഞാൻ അടച്ചു\" അമർത്തൂ, കട അത് കണ്ടെത്തും.",
      "ആപ്പ് നിരസിച്ചു എന്ന് കാണിച്ചാൽ, മറ്റൊരു UPI ആപ്പ് പരീക്ഷിക്കൂ, അല്ലെങ്കിൽ മുകളിലെ UPI ID ടൈപ്പ് ചെയ്ത് അടയ്ക്കൂ.",
      "ഇപ്പോഴും പ്രശ്നമുണ്ടോ? കടയോട് ചോദിക്കൂ. സമയം തീരുന്നതുവരെ നിങ്ങളുടെ സമയം മാറ്റിവച്ചിരിക്കും.",
    ],
    retry: "വീണ്ടും ശ്രമിക്കുക",
    lateTitle: "സമയം കഴിഞ്ഞ ശേഷം അടച്ചോ?", lateNote: "സമയം തീരുന്നതിനിടയിൽ പണം പോയെങ്കിൽ ഞങ്ങളോട് പറയൂ. കട അത് തിരികെ നൽകും, അല്ലെങ്കിൽ വീണ്ടും ബുക്ക് ചെയ്യും.",
    lateClaimed: "നിങ്ങളുടെ പേയ്‌മെന്റ് ഞങ്ങൾ കുറിച്ചിട്ടുണ്ട്. കട അത് നോക്കി, തിരികെ നൽകും, അല്ലെങ്കിൽ വീണ്ടും ബുക്ക് ചെയ്യും.", lateRefund: "റീഫണ്ട്",
  },
  kn: {
    copyId: "UPI ID ನಕಲಿಸಿ", copied: "UPI ID ನಕಲಾಗಿದೆ",
    openChrome: "Chrome ನಲ್ಲಿ ತೆರೆಯಿರಿ", chromeNote: "ಇಲ್ಲಿಂದ ನಿಮ್ಮ UPI ಆ್ಯಪ್ ತೆರೆಯದಿದ್ದರೆ, ಈ ಪುಟವನ್ನು Chrome ನಲ್ಲಿ ತೆರೆಯಿರಿ.",
    refLabel: "UPI ರೆಫರೆನ್ಸ್ (ಐಚ್ಛಿಕ)", refHint: "ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನ ಪಾವತಿ ವಿವರಗಳಲ್ಲಿರುವ 12 ಅಂಕಿಗಳು. ಇದು ಅಂಗಡಿಗೆ ನಿಮ್ಮ ಪಾವತಿಯನ್ನು ಹುಡುಕಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ.",
    paid: "ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ",
    claimed: "ನೀವು ಪಾವತಿಸಿದ್ದೀರಿ ಎಂದು ಹೇಳಿದ್ದೀರಿ. ಅಂಗಡಿ ತನ್ನ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡುತ್ತದೆ.", checkTime: (m) => `ಸಾಮಾನ್ಯವಾಗಿ ಸುಮಾರು ${m} ನಿಮಿಷ ಬೇಕಾಗುತ್ತದೆ. ಅಂಗಡಿ ನೋಡಿದ ಮೇಲೆ ಈ ಪುಟ ಬದಲಾಗುತ್ತದೆ.`,
    failTitle: "ಪಾವತಿ ಆಗಲಿಲ್ಲವೇ?",
    failTips: [
      "ಮೊದಲು ನಿಮ್ಮ ಬ್ಯಾಂಕ್ ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡಿ. ಹಣ ಕಡಿತವಾಗಿದ್ದರೆ ಮತ್ತೆ ಪಾವತಿಸಬೇಡಿ: \"ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ\" ಒತ್ತಿ, ಅಂಗಡಿ ಅದನ್ನು ಹುಡುಕುತ್ತದೆ.",
      "ಆ್ಯಪ್ ತಿರಸ್ಕರಿಸಿದೆ ಎಂದು ತೋರಿಸಿದರೆ, ಇನ್ನೊಂದು UPI ಆ್ಯಪ್ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಮೇಲಿನ UPI ID ಟೈಪ್ ಮಾಡಿ ಪಾವತಿಸಿ.",
      "ಇನ್ನೂ ತೊಂದರೆಯೇ? ಅಂಗಡಿಯನ್ನು ಕೇಳಿ. ಸಮಯ ಮುಗಿಯುವವರೆಗೆ ನಿಮ್ಮ ಸಮಯವನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.",
    ],
    retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    lateTitle: "ಸಮಯ ಮುಗಿದ ನಂತರ ಪಾವತಿಸಿದ್ದೀರಾ?", lateNote: "ಸಮಯ ಮುಗಿಯುವಾಗ ನಿಮ್ಮ ಹಣ ಕಡಿತವಾಗಿದ್ದರೆ ನಮಗೆ ತಿಳಿಸಿ. ಅಂಗಡಿ ಅದನ್ನು ಮರುಪಾವತಿಸುತ್ತದೆ ಅಥವಾ ಮತ್ತೆ ಬುಕ್ ಮಾಡುತ್ತದೆ.",
    lateClaimed: "ನಿಮ್ಮ ಪಾವತಿಯನ್ನು ನಾವು ಗುರುತಿಸಿಕೊಂಡಿದ್ದೇವೆ. ಅಂಗಡಿ ಅದನ್ನು ನೋಡಿ, ಮರುಪಾವತಿಸುತ್ತದೆ ಅಥವಾ ಮತ್ತೆ ಬುಕ್ ಮಾಡುತ್ತದೆ.", lateRefund: "ಮರುಪಾವತಿ",
  },
};

export interface OwnerMoneyWords {
  /** The three groups of money on the owner's page. */
  saysPaid: string; waitingPay: string; waitingPayNote: string; lateHeading: string; lateNote: string;
  /** Tags over a card. */
  tagSaysPaid: string; tagLate: string;
  /** A line under a card's sentence: the booking reference (it is the UPI note), when the customer said they paid, and the reference they typed. */
  reference: (ref: string) => string; claimedAt: (when: string) => string; upiRef: (ref: string) => string;
  /** The card for a hold that ended where money may have come: "Yes" is the same mark as on WhatsApp, after which the refund (or keep) card follows. */
  lateDeposit: (who: string, amount: string, what: string) => string; lateAfter: string;
  /** Fees: "paid another way?". */
  cashTitle: string; cashNote: string; cashRow: (student: string, what: string) => string; cashButton: (amount: string) => string; bankButton: (amount: string) => string;
  /** Fees, 17 Nov 2026: marking only part of a fee received in cash: the label of the rupee box and the button. */
  cashPartLabel: string; cashPartButton: string;
}

export const OWNER_MONEY: W<OwnerMoneyWords> = {
  en: {
    saysPaid: "Customers say they have paid", waitingPay: "Waiting for payment", waitingPayNote: "Nothing to do until the money shows in your UPI app. Look for the booking reference in the UPI note.",
    lateHeading: "Time ran out: did money come?", lateNote: "These holds have ended. If you see the money in your UPI app, tap Yes: you can then refund it or keep it.",
    tagSaysPaid: "Says paid", tagLate: "Time ran out",
    reference: (ref) => `Reference ${ref} (it is in the UPI note).`, claimedAt: (when) => `Said they paid at ${when}.`, upiRef: (ref) => `UPI reference ${ref}.`,
    lateDeposit: (who, amount, what) => `${who} may have paid ${amount} for ${what} after the time ended. Has it reached your UPI app?`,
    lateAfter: "After Yes you choose: refund it, or keep it for a booking you make by hand.",
    cashTitle: "Paid in cash or by bank?", cashNote: "If a parent paid you another way, mark it here. The fee is marked paid and the parent is told.",
    cashRow: (student, what) => `${student}, ${what}`, cashButton: (amount) => `Paid ${amount} in cash`, bankButton: (amount) => `Paid ${amount} by bank transfer`,
    cashPartLabel: "Received only part? How much (₹)", cashPartButton: "Mark this part received in cash",
  },
  hi: {
    saysPaid: "ग्राहक कहते हैं कि पेमेंट कर दिया", waitingPay: "पेमेंट का इंतज़ार", waitingPayNote: "जब तक पैसे आपके UPI ऐप में न दिखें, कुछ करना नहीं है। UPI नोट में बुकिंग रेफ़रेंस देखिए।",
    lateHeading: "समय ख़त्म हुआ: क्या पैसे आए?", lateNote: "ये रोक ख़त्म हो चुकी हैं। अगर आपको पैसे अपने UPI ऐप में दिखें, तो \"हाँ\" दबाइए: फिर आप उन्हें वापस कर सकते हैं या रख सकते हैं।",
    tagSaysPaid: "पेमेंट बताया", tagLate: "समय ख़त्म",
    reference: (ref) => `रेफ़रेंस ${ref} (यह UPI नोट में है)।`, claimedAt: (when) => `${when} पर बताया कि पेमेंट कर दिया।`, upiRef: (ref) => `UPI रेफ़रेंस ${ref}।`,
    lateDeposit: (who, amount, what) => `${who} ने समय ख़त्म होने के बाद ${what} के लिए ${amount} दिए होंगे। क्या यह आपके UPI ऐप में आया?`,
    lateAfter: "\"हाँ\" के बाद आप चुनते हैं: वापस करें, या हाथ से की गई बुकिंग के लिए रख लें।",
    cashTitle: "नकद या बैंक से दिया?", cashNote: "अगर किसी अभिभावक ने दूसरे तरीके से दिया है, तो यहाँ दर्ज कीजिए। फीस चुकता मानी जाएगी और अभिभावक को बताया जाएगा।",
    cashRow: (student, what) => `${student}, ${what}`, cashButton: (amount) => `${amount} नकद मिले`, bankButton: (amount) => `${amount} बैंक से मिले`,
    cashPartLabel: "सिर्फ़ कुछ हिस्सा मिला? कितना (₹)", cashPartButton: "यह हिस्सा नकद मिला लिखें",
  },
  ml: {
    saysPaid: "ഉപഭോക്താക്കൾ അടച്ചു എന്ന് പറയുന്നു", waitingPay: "പേയ്‌മെന്റിനായി കാത്തിരിക്കുന്നു", waitingPayNote: "പണം നിങ്ങളുടെ UPI ആപ്പിൽ കാണുന്നതുവരെ ഒന്നും ചെയ്യേണ്ടതില്ല. UPI കുറിപ്പിൽ ബുക്കിംഗ് റഫറൻസ് നോക്കൂ.",
    lateHeading: "സമയം കഴിഞ്ഞു: പണം വന്നോ?", lateNote: "ഈ പിടികൾ അവസാനിച്ചു. പണം നിങ്ങളുടെ UPI ആപ്പിൽ കണ്ടാൽ \"അതെ\" അമർത്തൂ: പിന്നെ തിരികെ നൽകാം, അല്ലെങ്കിൽ സൂക്ഷിക്കാം.",
    tagSaysPaid: "അടച്ചു എന്ന് പറയുന്നു", tagLate: "സമയം കഴിഞ്ഞു",
    reference: (ref) => `റഫറൻസ് ${ref} (UPI കുറിപ്പിലുണ്ട്).`, claimedAt: (when) => `${when}-ന് അടച്ചു എന്ന് പറഞ്ഞു.`, upiRef: (ref) => `UPI റഫറൻസ് ${ref}.`,
    lateDeposit: (who, amount, what) => `${who} സമയം കഴിഞ്ഞശേഷം ${what}-ന് ${amount} അടച്ചിരിക്കാം. അത് നിങ്ങളുടെ UPI ആപ്പിൽ എത്തിയോ?`,
    lateAfter: "\"അതെ\" എന്നതിനുശേഷം നിങ്ങൾ തിരഞ്ഞെടുക്കും: തിരികെ നൽകുക, അല്ലെങ്കിൽ കൈകൊണ്ട് ചെയ്യുന്ന ബുക്കിംഗിനായി സൂക്ഷിക്കുക.",
    cashTitle: "പണമായോ ബാങ്ക് വഴിയോ അടച്ചോ?", cashNote: "ഒരു രക്ഷിതാവ് മറ്റൊരു വഴിയിൽ അടച്ചെങ്കിൽ ഇവിടെ രേഖപ്പെടുത്തൂ. ഫീസ് അടച്ചതായി കണക്കാക്കി രക്ഷിതാവിനെ അറിയിക്കും.",
    cashRow: (student, what) => `${student}, ${what}`, cashButton: (amount) => `${amount} പണമായി കിട്ടി`, bankButton: (amount) => `${amount} ബാങ്ക് വഴി കിട്ടി`,
    cashPartLabel: "ഒരു ഭാഗം മാത്രമാണോ കിട്ടിയത്? എത്ര (₹)", cashPartButton: "ഈ ഭാഗം പണമായി കിട്ടിയെന്ന് രേഖപ്പെടുത്തുക",
  },
  kn: {
    saysPaid: "ಗ್ರಾಹಕರು ಪಾವತಿಸಿದ್ದೇವೆ ಎನ್ನುತ್ತಿದ್ದಾರೆ", waitingPay: "ಪಾವತಿಗಾಗಿ ಕಾಯುತ್ತಿದೆ", waitingPayNote: "ಹಣ ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಾಣುವವರೆಗೆ ಏನೂ ಮಾಡಬೇಕಾಗಿಲ್ಲ. UPI ಟಿಪ್ಪಣಿಯಲ್ಲಿ ಬುಕಿಂಗ್ ರೆಫರೆನ್ಸ್ ನೋಡಿ.",
    lateHeading: "ಸಮಯ ಮುಗಿಯಿತು: ಹಣ ಬಂದಿತೇ?", lateNote: "ಈ ಹಿಡಿತಗಳು ಮುಗಿದಿವೆ. ಹಣ ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಂಡರೆ \"ಹೌದು\" ಒತ್ತಿ: ನಂತರ ಮರುಪಾವತಿಸಬಹುದು ಅಥವಾ ಇಟ್ಟುಕೊಳ್ಳಬಹುದು.",
    tagSaysPaid: "ಪಾವತಿಸಿದ್ದೇನೆ ಎನ್ನುತ್ತಾರೆ", tagLate: "ಸಮಯ ಮುಗಿಯಿತು",
    reference: (ref) => `ರೆಫರೆನ್ಸ್ ${ref} (ಇದು UPI ಟಿಪ್ಪಣಿಯಲ್ಲಿದೆ).`, claimedAt: (when) => `${when} ಕ್ಕೆ ಪಾವತಿಸಿದ್ದೇನೆ ಎಂದರು.`, upiRef: (ref) => `UPI ರೆಫರೆನ್ಸ್ ${ref}.`,
    lateDeposit: (who, amount, what) => `${who} ಸಮಯ ಮುಗಿದ ನಂತರ ${what} ಗಾಗಿ ${amount} ಪಾವತಿಸಿರಬಹುದು. ಅದು ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ಗೆ ಬಂದಿದೆಯೇ?`,
    lateAfter: "\"ಹೌದು\" ನಂತರ ನೀವು ಆರಿಸುತ್ತೀರಿ: ಮರುಪಾವತಿಸಿ, ಅಥವಾ ಕೈಯಿಂದ ಮಾಡುವ ಬುಕಿಂಗ್‌ಗಾಗಿ ಇಟ್ಟುಕೊಳ್ಳಿ.",
    cashTitle: "ನಗದು ಅಥವಾ ಬ್ಯಾಂಕ್ ಮೂಲಕ ಪಾವತಿಸಿದ್ದಾರೆಯೇ?", cashNote: "ಪೋಷಕರು ಬೇರೆ ರೀತಿಯಲ್ಲಿ ಪಾವತಿಸಿದ್ದರೆ ಇಲ್ಲಿ ಗುರುತಿಸಿ. ಶುಲ್ಕ ಪಾವತಿಯಾಗಿದೆ ಎಂದು ಗುರುತಿಸಿ ಪೋಷಕರಿಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ.",
    cashRow: (student, what) => `${student}, ${what}`, cashButton: (amount) => `${amount} ನಗದಾಗಿ ಸಿಕ್ಕಿತು`, bankButton: (amount) => `${amount} ಬ್ಯಾಂಕ್ ಮೂಲಕ ಸಿಕ್ಕಿತು`,
    cashPartLabel: "ಒಂದು ಭಾಗ ಮಾತ್ರ ಸಿಕ್ಕಿತೇ? ಎಷ್ಟು (₹)", cashPartButton: "ಈ ಭಾಗ ನಗದಾಗಿ ಸಿಕ್ಕಿತು ಎಂದು ಗುರುತಿಸಿ",
  },
};
