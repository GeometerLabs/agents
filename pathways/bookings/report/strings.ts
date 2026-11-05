// Every word the monthly report and the certificates say, per language. Nothing numeric is typed here: counts, amounts and
// dates are filled in from the record by the per-language formatters in modules/language/format.ts, and these are the fixed
// words around them. The type makes sure no language is missing a string.
//
// Machine-written Hindi, Malayalam and Kannada. The Malayalam and Kannada strings are listed in REVIEW-ml.md and
// REVIEW-kn.md for a native speaker (section 6), and no real shop should be given them before that review.
//
// Claim rules, kept in code: a document counts and states facts; it never grades. BANNED lists, per language, the words
// no document may contain (safe, guaranteed, certified, earnings and their translations). A test runs every document in
// every language through it. The confirm verbs the packs already use (पक्का, ഉറപ്പിക്കാൻ, ಖಚಿತಪಡಿಸಲು) are not on it.
import { STAND_IN_SERVICES } from "../crash-test/not-tested.ts";
import type { RuleId } from "../../../modules/record/record.ts";
import type { Language } from "../../../modules/language/languages.ts";
import type { NotCountedId, NotTestedKey, Source } from "./data.ts";

export interface Strings {
  agent: string;
  monthlyReport: string;
  goLiveCertificate: string;
  monthlyCertificate: string;
  languageName: Record<Language, string>;
  /** The owner's lines: "label: number". */
  label: {
    bookingsMade: string; cancelled: string; moved: string; depositsCollected: string; givenBack: string;
    wasAsked: string; approved: string; saidNo: string; notConfirmed: string; stoppedByLimits: string; notChecked: string;
  };
  /** What each limit stopped, as a label for a count. */
  stop: Record<RuleId, string>;
  more(n: number): string;
  handRun: string;
  sourceTag: Record<Source, string>;
  sourceLong: Record<Source, string>;
  notTested: Record<NotTestedKey, string>;
  notCounted: Record<NotCountedId, string>;
  page: {
    numbers: string; item: string; count: string; amount: string; droppedBeforeBooked: string; givenBackDeposits: string; givenBackSecond: string; retried: string;
    stoppedHeading: string; stoppedTotal: string; stoppedNote: string; rule: string; times: string;
    messagesHeading: string; toCustomers: string; toYou: string; heldBack: string;
    unconfirmedHeading: string; stillOpen: string; settledLater: string; nothing: string; waitingNow: string; paidNotBooked: string;
    missingHeading: string; missingDepositAmounts: string; missingRefundAmounts: string; missingOwnerCommands: string; missingMessageTargets: string;
    notCountedHeading: string; notTestedHeading: string;
    checkHeading: string; code: string; digest: string; limitsDigest: string; recordDigest: string; countedFrom: string; setUpBy: string; madeOn: string; agentVersion: string;
    checkAt: string; signedBy: string; notSigned: string; signatureNote: string;
    showWhatWeDid: string; byActionHeading: string; entriesHeading: string; colNo: string; colTime: string; colAction: string; colOutcome: string; colBooking: string; colFingerprint: string;
    notAGrade: string; period: string;
  };
  cert: {
    date: string; held(held: number, total: number, failed: number, notTested: number): string; intro: string; yourLimits: string;
    floor(items: string): string; deposit(amount: string, minutes: number): string; cancel(hours: number): string; refund(amount: string): string; hours: string;
    notAGrade: string; didNotHold: string; handRunLine: string; countedIntro(period: string): string; checkedOn: string;
  };
  /**
   * What the monthly documents say about the go-live checks: whether a go-live certificate was given, whether it could be trusted, and what its
   * checks ran on. A date is passed in already written by the formatter, and a key as its id; the sentences carry no number or date of their own.
   */
  goLive: {
    heading: string; own(date: string): string; example(date: string): string; different(date: string): string;
    untrusted: string; none: string; signedWith(key: string): string;
  };
}

const standIn = `(${STAND_IN_SERVICES})`;

const en: Strings = {
  agent: "Bookings agent", monthlyReport: "Monthly report", goLiveCertificate: "Go-live certificate", monthlyCertificate: "Monthly record certificate",
  languageName: { hi: "Hindi", en: "English", ml: "Malayalam", kn: "Kannada" },
  label: {
    bookingsMade: "Bookings made", cancelled: "Cancelled", moved: "Moved to a new time", depositsCollected: "Deposits collected", givenBack: "Given back",
    wasAsked: "You were asked", approved: "You approved", saidNo: "You said no", notConfirmed: "Could not confirm", stoppedByLimits: "Stopped by your limits", notChecked: "Not checked",
  },
  stop: {
    "price-at-or-above-list": "Prices below your list", "within-hours": "Outside opening hours", "no-double-booking": "Double bookings",
    "confirm-only-when-recorded": "\"Booked\" said too early", "one-deposit-per-booking": "Second payments", "refund-limit": "Refunds over your limit",
    "no-message-after-stop": "Reminders after cancel or STOP", "message-matches-record": "Messages not matching the record", "opt-out": "Messages after STOP",
  },
  more: (n) => `and ${n} more (see the full report)`,
  handRun: "Checks were run by hand.",
  sourceTag: { "stand-in": "stand-in services, test money", "test-mode": "test mode, test money", live: "" },
  sourceLong: {
    "stand-in": "These numbers come from stand-in services and test money. Nothing real was sent or paid.",
    "test-mode": "These numbers come from real services in test mode. The money was test money.",
    live: "These numbers come from the live record of real services.",
  },
  notTested: {
    "voice-calls": "phone calls", "group-bookings": "group bookings", "walk-ins": "walk-ins", "payments-outside-razorpay": "payments made outside Razorpay",
    "real-whatsapp": "real WhatsApp", "real-razorpay": "real Razorpay, in test mode or live", "real-calendar": "a real calendar", "webhook-signatures": "webhook signatures (proof that a payment notice came from Razorpay)",
    "real-model": "a real AI model (messages are read by fixed rules and answered from fixed templates)", "other-languages": "Tamil, Telugu and other languages",
    "native-review": "a native speaker's review of the Malayalam and Kannada wording (machine-written)", "restart-mid-step": "a crash or restart in the middle of a step",
    "same-instant": "two customers at the exact same instant", "other-faults": "problems beyond the ones tried",
    "own-settings": "these checks on this shop's own settings (they ran on the example shop, Glow Salon)",
    "situations-skipped": "some of these checks, which this shop's settings cannot run (so they were left out)",
    "other-settings": "these checks on this shop's own settings (the go-live certificate says they ran on different settings)",
    "no-go-live-certificate": "these checks on this shop's own settings (no go-live certificate was given)",
    "go-live-untrusted": "these checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used)",
  },
  notCounted: {
    "no-shows": "who turned up (a booking is marked finished when its time passes)", "read-receipts": "whether customers read their messages (only that WhatsApp's record held them)",
    "outside-agent": "bookings, calls and payments that did not go through the agent", "rule-breaks": "whether anything got past a limit (this counts what the limits stopped)",
  },
  page: {
    numbers: "The numbers", item: "What", count: "How many", amount: "Amount", droppedBeforeBooked: "Asked for, then dropped before it was booked",
    givenBackDeposits: "of which deposits given back", givenBackSecond: "of which second payments given back", retried: "You asked it to check the calendar again",
    stoppedHeading: "What your limits stopped", stoppedTotal: "Things stopped", stoppedNote: "One thing can be stopped by two limits at once, so the rows can add up to more than the total.",
    rule: "Limit", times: "Times", messagesHeading: "Messages sent", toCustomers: "To customers", toYou: "To you, the owner", heldBack: "Held back before sending",
    unconfirmedHeading: "Left unconfirmed or failed", stillOpen: "Still open", settledLater: "Settled by a later step", nothing: "None.",
    waitingNow: "Waiting for your answer when this report was made", paidNotBooked: "Paid, but the calendar did not show the booking",
    missingHeading: "Missing from the record, so the counts above are incomplete", missingDepositAmounts: "Deposits with no amount written down", missingRefundAmounts: "Refunds with no amount written down",
    missingOwnerCommands: "Answers from you with no command written down", missingMessageTargets: "Messages with no recipient written down",
    notCountedHeading: "Not counted", notTestedHeading: "Not tested",
    checkHeading: "Check this document", code: "Code", digest: "Digest", limitsDigest: "Limits digest", recordDigest: "Record digest", countedFrom: "Counted from", setUpBy: "Set up by", madeOn: "Made on",
    agentVersion: "Agent version", checkAt: "Check it at", signedBy: "Signed with key", notSigned: "Not signed",
    signatureNote: "A signature shows who issued this document and that it has not changed since. It does not show that the numbers are true.",
    showWhatWeDid: "Show what we did ▸", byActionHeading: "What was done, by action and outcome",
    entriesHeading: "Every entry in the record (fingerprints only: no customer messages and no phone numbers)",
    colNo: "No.", colTime: "Time", colAction: "Action", colOutcome: "Outcome", colBooking: "Booking", colFingerprint: "Fingerprint",
    notAGrade: "These are counts of what the record shows. They do not grade the agent.", period: "Period",
  },
  cert: {
    date: "Date", held: (h, t, f, n) => `Held ${h} of ${t} situations. ${f} failed. ${n} not tested.`,
    intro: "Before switching on, we tried situations that could go wrong: lost replies, duplicate payments, silent calendar failures, customers trying to trick the agent.",
    yourLimits: "Your limits", floor: (items) => `Nothing below your price list: ${items}`,
    deposit: (amount, minutes) => `Deposit ${amount}, and the slot is held ${minutes} minutes for it`, cancel: (hours) => `Cancel at least ${hours} hours before the start and the deposit goes back; a later cancellation is your decision`,
    refund: (amount) => `Refunds above ${amount} only with your OK`, hours: "No bookings outside your opening hours",
    notAGrade: "This counts the situations tried. It does not grade the agent.", didNotHold: "Did not hold",
    handRunLine: `Checks were run by hand against ${STAND_IN_SERVICES}, not real WhatsApp, payments or a calendar. Test money only.`,
    countedIntro: (period) => `Counted from the agent's record for ${period}:`, checkedOn: "Checks run on",
  },
  goLive: {
    heading: "Go-live checks",
    own: (date) => `The go-live checks ran on this shop's own settings, in the go-live certificate of ${date}.`,
    example: (date) => `The go-live certificate of ${date} says its checks ran on the example shop, Glow Salon, not on this shop's own settings.`,
    different: (date) => `The go-live certificate of ${date} says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave.`,
    untrusted: "A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate), so it was not used.",
    none: "No go-live certificate was given, so this document does not say what the go-live checks ran on.",
    signedWith: (key) => `The go-live certificate is signed with ${key}. A key does not show who holds it.`,
  },
};

const hi: Strings = {
  agent: "बुकिंग एजेंट", monthlyReport: "मासिक रिपोर्ट", goLiveCertificate: "चालू करने से पहले का जाँच प्रमाणपत्र", monthlyCertificate: "मासिक रिकॉर्ड प्रमाणपत्र",
  languageName: { hi: "हिंदी", en: "अंग्रेज़ी", ml: "मलयालम", kn: "कन्नड़" },
  label: {
    bookingsMade: "हुई बुकिंग", cancelled: "रद्द हुईं", moved: "समय बदला", depositsCollected: "जमा राशि मिली", givenBack: "वापस किया",
    wasAsked: "आपसे पूछा गया", approved: "आपने मंज़ूर किया", saidNo: "आपने मना किया", notConfirmed: "पक्का नहीं हो पाया", stoppedByLimits: "आपकी सीमाओं ने रोका", notChecked: "जाँचा नहीं गया",
  },
  stop: {
    "price-at-or-above-list": "कीमत-सूची से कम की माँग", "within-hours": "खुलने के समय के बाहर की बुकिंग", "no-double-booking": "एक ही समय की दूसरी बुकिंग",
    "confirm-only-when-recorded": "रिकॉर्ड से पहले \"बुक हो गया\" कहना", "one-deposit-per-booking": "दूसरी बार की जमा राशि", "refund-limit": "सीमा से ऊपर के रिफंड",
    "no-message-after-stop": "रद्द या STOP के बाद रिमाइंडर", "message-matches-record": "रिकॉर्ड से न मिलते संदेश", "opt-out": "STOP के बाद संदेश",
  },
  more: (n) => `और ${n} बातें (पूरी रिपोर्ट में)`,
  handRun: "जाँच हाथ से की गई।",
  sourceTag: { "stand-in": "अभ्यास वाले नकली सिस्टम, टेस्ट पैसा", "test-mode": "टेस्ट मोड, टेस्ट पैसा", live: "" },
  sourceLong: {
    "stand-in": "ये आँकड़े अभ्यास वाले नकली सिस्टम और टेस्ट पैसे से आए हैं। कुछ भी असली नहीं भेजा या चुकाया गया।",
    "test-mode": "ये आँकड़े असली सेवाओं के टेस्ट मोड से आए हैं। पैसा टेस्ट पैसा था।",
    live: "ये आँकड़े असली सेवाओं के चालू रिकॉर्ड से आए हैं।",
  },
  notTested: {
    "voice-calls": "फ़ोन कॉल", "group-bookings": "समूह की बुकिंग", "walk-ins": "वॉक-इन ग्राहक", "payments-outside-razorpay": "Razorpay के बाहर के भुगतान",
    "real-whatsapp": "असली WhatsApp", "real-razorpay": "असली Razorpay (टेस्ट मोड या चालू)", "real-calendar": "असली कैलेंडर", "webhook-signatures": "पेमेंट सूचनाओं के हस्ताक्षर (webhook signatures)",
    "real-model": "असली AI मॉडल (संदेश तय नियमों से पढ़े जाते हैं और जवाब तय साँचों से बनते हैं)", "other-languages": "तमिल, तेलुगु और दूसरी भाषाएँ",
    "native-review": "मलयालम और कन्नड़ शब्दों की किसी मातृभाषी से जाँच (ये मशीन से लिखे हैं)", "restart-mid-step": "किसी कदम के बीच में बंद होना या दोबारा चालू होना",
    "same-instant": "ठीक एक ही पल में दो ग्राहक", "other-faults": "आज़माई गई गड़बड़ियों के अलावा दूसरी गड़बड़ियाँ",
    "own-settings": "ये जाँचें इस दुकान की अपनी सेटिंग पर (ये उदाहरण दुकान Glow Salon पर चली थीं)",
    "situations-skipped": "इनमें से कुछ जाँचें, जो इस दुकान की सेटिंग पर चल नहीं सकतीं (इसलिए छोड़ दी गईं)",
    "other-settings": "ये जाँचें इस दुकान की अपनी सेटिंग पर (जाँच प्रमाणपत्र के अनुसार ये किसी और सेटिंग पर चली थीं)",
    "no-go-live-certificate": "ये जाँचें इस दुकान की अपनी सेटिंग पर (कोई जाँच प्रमाणपत्र दिया ही नहीं गया)",
    "go-live-untrusted": "ये जाँचें इस दुकान की अपनी सेटिंग पर (जो जाँच प्रमाणपत्र दिया गया उस पर भरोसा नहीं किया जा सका, इसलिए उसे इस्तेमाल नहीं किया गया)",
  },
  notCounted: {
    "no-shows": "कौन आया और कौन नहीं (समय बीतने पर बुकिंग पूरी मान ली जाती है)", "read-receipts": "ग्राहकों ने संदेश पढ़े या नहीं (सिर्फ़ इतना कि WhatsApp के रिकॉर्ड में संदेश है)",
    "outside-agent": "एजेंट से बाहर हुई बुकिंग, कॉल और भुगतान", "rule-breaks": "कोई चीज़ सीमा पार कर गई या नहीं (यहाँ सिर्फ़ यह गिना गया है कि सीमाओं ने क्या रोका)",
  },
  page: {
    numbers: "आँकड़े", item: "क्या", count: "कितने", amount: "रकम", droppedBeforeBooked: "माँगी गई, पर बुक होने से पहले छोड़ दी गई",
    givenBackDeposits: "इनमें से जमा राशि वापस की गई", givenBackSecond: "इनमें से दूसरी बार का भुगतान वापस किया गया", retried: "आपने कैलेंडर फिर जाँचने को कहा",
    stoppedHeading: "आपकी सीमाओं ने क्या रोका", stoppedTotal: "रोकी गई बातें", stoppedNote: "एक बात दो सीमाओं से एक साथ रुक सकती है, इसलिए पंक्तियों का जोड़ कुल से ज़्यादा हो सकता है।",
    rule: "सीमा", times: "बार", messagesHeading: "भेजे गए संदेश", toCustomers: "ग्राहकों को", toYou: "आपको, मालिक को", heldBack: "भेजने से पहले रोके गए",
    unconfirmedHeading: "जो पक्का नहीं हुआ या नहीं हो पाया", stillOpen: "अभी खुला", settledLater: "बाद के कदम से निपटा", nothing: "कुछ नहीं।",
    waitingNow: "यह रिपोर्ट बनते समय आपके जवाब का इंतज़ार", paidNotBooked: "पैसा आया, पर कैलेंडर में बुकिंग नहीं दिखी",
    missingHeading: "रिकॉर्ड में नहीं लिखा गया, इसलिए ऊपर की गिनती अधूरी है", missingDepositAmounts: "बिना रकम लिखी जमा राशि", missingRefundAmounts: "बिना रकम लिखे रिफंड",
    missingOwnerCommands: "आपके जवाब जिनमें आदेश नहीं लिखा", missingMessageTargets: "संदेश जिनमें पाने वाला नहीं लिखा",
    notCountedHeading: "गिना नहीं गया", notTestedHeading: "जाँचा नहीं गया",
    checkHeading: "इस दस्तावेज़ को जाँचें", code: "कोड", digest: "डाइजेस्ट", limitsDigest: "सीमाओं का डाइजेस्ट", recordDigest: "रिकॉर्ड का डाइजेस्ट", countedFrom: "कहाँ से गिना", setUpBy: "तैयार किया", madeOn: "बनाया गया",
    agentVersion: "एजेंट का संस्करण", checkAt: "यहाँ जाँचें", signedBy: "इस कुंजी से हस्ताक्षर", notSigned: "हस्ताक्षर नहीं है",
    signatureNote: "हस्ताक्षर बताता है कि यह दस्तावेज़ किसने जारी किया और तब से बदला नहीं है। यह नहीं बताता कि आँकड़े सच हैं।",
    showWhatWeDid: "हमने क्या किया, देखें ▸", byActionHeading: "क्या किया गया, काम और नतीजे के हिसाब से",
    entriesHeading: "रिकॉर्ड की हर प्रविष्टि (सिर्फ़ फ़िंगरप्रिंट: कोई ग्राहक संदेश या फ़ोन नंबर नहीं)",
    colNo: "क्र.", colTime: "समय", colAction: "काम", colOutcome: "नतीजा", colBooking: "बुकिंग", colFingerprint: "फ़िंगरप्रिंट",
    notAGrade: "ये रिकॉर्ड में दिखी बातों की गिनती हैं। ये एजेंट को अंक या दर्जा नहीं देतीं।", period: "अवधि",
  },
  cert: {
    date: "तारीख़", held: (h, t, f, n) => `${t} में से ${h} स्थितियाँ ठीक रहीं। ${f} में गड़बड़ हुई। ${n} बातें जाँची नहीं गईं।`,
    intro: "चालू करने से पहले हमने वे स्थितियाँ आज़माईं जो गलत हो सकती थीं: खोए हुए जवाब, दोहराए गए पेमेंट, कैलेंडर में चुपचाप न बचना, और एजेंट को चकमा देने वाले ग्राहक।",
    yourLimits: "आपकी सीमाएँ", floor: (items) => `कीमत-सूची से कम नहीं: ${items}`,
    deposit: (amount, minutes) => `जमा राशि ${amount}; इसके लिए स्लॉट ${minutes} मिनट रोका जाता है`, cancel: (hours) => `शुरू होने से कम से कम ${hours} घंटे पहले रद्द करें तो जमा राशि लौट जाती है; देर से रद्द करने पर फ़ैसला आपका`,
    refund: (amount) => `${amount} से ऊपर का रिफंड आपसे पूछकर`, hours: "खुलने के समय के बाहर बुकिंग नहीं",
    notAGrade: "यह आज़माई गई स्थितियों की गिनती है। यह एजेंट को अंक या दर्जा नहीं देती।", didNotHold: "जिनमें गड़बड़ हुई",
    handRunLine: `जाँच हाथ से की गई, असली WhatsApp, पेमेंट या कैलेंडर पर नहीं, बल्कि अभ्यास वाले नकली सिस्टम ${standIn} पर। सिर्फ़ टेस्ट पैसा।`,
    countedIntro: (period) => `एजेंट के रिकॉर्ड से गिना गया, ${period}:`, checkedOn: "जाँच इन पर की गई",
  },
  goLive: {
    heading: "चालू करने से पहले की जाँच",
    own: (date) => `चालू करने से पहले की जाँच इसी दुकान की अपनी सेटिंग पर चली थी, ${date} के जाँच प्रमाणपत्र के अनुसार।`,
    example: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच उदाहरण दुकान Glow Salon पर चली थी, इस दुकान की अपनी सेटिंग पर नहीं।`,
    different: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच इस दुकान से अलग सेटिंग पर चली थी, इसलिए उससे इस दुकान की अपनी सेटिंग का हाल पता नहीं चलता।`,
    untrusted: "एक जाँच प्रमाणपत्र दिया गया था, पर उस पर भरोसा नहीं किया जा सका (उस पर हस्ताक्षर नहीं है, हस्ताक्षर नहीं बैठता, या वह जाँच प्रमाणपत्र है ही नहीं), इसलिए उसे इस्तेमाल नहीं किया गया।",
    none: "कोई जाँच प्रमाणपत्र नहीं दिया गया, इसलिए यह दस्तावेज़ नहीं बताता कि चालू करने से पहले की जाँच किस सेटिंग पर चली थी।",
    signedWith: (key) => `जाँच प्रमाणपत्र पर ${key} कुंजी से हस्ताक्षर हैं। कुंजी यह नहीं बताती कि वह किसके पास है।`,
  },
};

const ml: Strings = {
  agent: "ബുക്കിംഗ് ഏജന്റ്", monthlyReport: "പ്രതിമാസ റിപ്പോർട്ട്", goLiveCertificate: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനാ സർട്ടിഫിക്കറ്റ്", monthlyCertificate: "പ്രതിമാസ രേഖാ സർട്ടിഫിക്കറ്റ്",
  languageName: { hi: "ഹിന്ദി", en: "ഇംഗ്ലീഷ്", ml: "മലയാളം", kn: "കന്നഡ" },
  label: {
    bookingsMade: "ബുക്ക് ആയവ", cancelled: "റദ്ദാക്കിയവ", moved: "സമയം മാറ്റിയവ", depositsCollected: "ലഭിച്ച അഡ്വാൻസ്", givenBack: "തിരികെ നൽകിയത്",
    wasAsked: "നിങ്ങളോട് ചോദിച്ചത്", approved: "നിങ്ങൾ അംഗീകരിച്ചത്", saidNo: "നിങ്ങൾ വേണ്ടെന്ന് പറഞ്ഞത്", notConfirmed: "ഉറപ്പിക്കാൻ കഴിയാത്തത്", stoppedByLimits: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", notChecked: "പരിശോധിക്കാത്തത്",
  },
  stop: {
    "price-at-or-above-list": "ലിസ്റ്റ് വിലയിൽ കുറഞ്ഞ ആവശ്യങ്ങൾ", "within-hours": "പ്രവൃത്തി സമയത്തിന് പുറത്തുള്ള ബുക്കിംഗ്", "no-double-booking": "ഒരേ സമയത്തെ രണ്ടാം ബുക്കിംഗ്",
    "confirm-only-when-recorded": "രേഖയിൽ വരുംമുമ്പ് \"ബുക്ക് ആയി\" എന്ന് പറയൽ", "one-deposit-per-booking": "രണ്ടാമത് അടച്ച അഡ്വാൻസ്", "refund-limit": "പരിധിക്ക് മുകളിലുള്ള റീഫണ്ട്",
    "no-message-after-stop": "റദ്ദാക്കിയതിനോ STOP-നോ ശേഷമുള്ള ഓർമ്മപ്പെടുത്തൽ", "message-matches-record": "രേഖയുമായി പൊരുത്തപ്പെടാത്ത സന്ദേശം", "opt-out": "STOP-ന് ശേഷമുള്ള സന്ദേശം",
  },
  more: (n) => `കൂടാതെ ${n} കാര്യങ്ങൾ (മുഴുവൻ റിപ്പോർട്ടിൽ)`,
  handRun: "പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തു.",
  sourceTag: { "stand-in": "പരിശീലന സംവിധാനങ്ങൾ, ടെസ്റ്റ് പണം", "test-mode": "ടെസ്റ്റ് മോഡ്, ടെസ്റ്റ് പണം", live: "" },
  sourceLong: {
    "stand-in": "ഈ കണക്കുകൾ പരിശീലന സംവിധാനങ്ങളിൽ നിന്നും ടെസ്റ്റ് പണത്തിൽ നിന്നും ഉള്ളതാണ്. യഥാർത്ഥമായ ഒന്നും അയയ്ക്കുകയോ അടയ്ക്കുകയോ ചെയ്തിട്ടില്ല.",
    "test-mode": "ഈ കണക്കുകൾ യഥാർത്ഥ സേവനങ്ങളുടെ ടെസ്റ്റ് മോഡിൽ നിന്നുള്ളതാണ്. പണം ടെസ്റ്റ് പണമായിരുന്നു.",
    live: "ഈ കണക്കുകൾ യഥാർത്ഥ സേവനങ്ങളുടെ പ്രവർത്തിക്കുന്ന രേഖയിൽ നിന്നുള്ളതാണ്.",
  },
  notTested: {
    "voice-calls": "ഫോൺ കോളുകൾ", "group-bookings": "ഗ്രൂപ്പ് ബുക്കിംഗ്", "walk-ins": "നേരിട്ട് വരുന്നവർ (വാക്ക്-ഇൻ)", "payments-outside-razorpay": "Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ",
    "real-whatsapp": "യഥാർത്ഥ WhatsApp", "real-razorpay": "യഥാർത്ഥ Razorpay (ടെസ്റ്റ് മോഡോ ലൈവോ)", "real-calendar": "യഥാർത്ഥ കലണ്ടർ", "webhook-signatures": "പേയ്മെന്റ് അറിയിപ്പുകളുടെ ഒപ്പ് (webhook signatures)",
    "real-model": "യഥാർത്ഥ AI മോഡൽ (സന്ദേശം വായിക്കുന്നത് നിശ്ചിത നിയമങ്ങളാലാണ്, മറുപടികൾ നിശ്ചിത മാതൃകകളാണ്)", "other-languages": "തമിഴ്, തെലുങ്ക്, മറ്റ് ഭാഷകൾ",
    "native-review": "മലയാളം, കന്നഡ വാക്കുകൾ മാതൃഭാഷക്കാരൻ പരിശോധിക്കൽ (ഇവ യന്ത്രം എഴുതിയതാണ്)", "restart-mid-step": "ഒരു ഘട്ടത്തിനിടയിൽ നിൽക്കുകയോ വീണ്ടും തുടങ്ങുകയോ ചെയ്യുന്നത്",
    "same-instant": "ഒരേ നിമിഷത്തിൽ രണ്ട് ഉപഭോക്താക്കൾ", "other-faults": "പരീക്ഷിച്ചവയ്ക്ക് പുറമെയുള്ള പിഴവുകൾ",
    "own-settings": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (ഇവ ഉദാഹരണ കടയായ Glow Salon-ൽ ആണ് നടത്തിയത്)",
    "situations-skipped": "ഈ പരിശോധനകളിൽ ചിലത്, ഈ കടയുടെ ക്രമീകരണങ്ങളിൽ നടത്താൻ കഴിയാത്തതിനാൽ ഒഴിവാക്കി",
    "other-settings": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (സർട്ടിഫിക്കറ്റ് പ്രകാരം ഇവ മറ്റ് ക്രമീകരണങ്ങളിലാണ് നടത്തിയത്)",
    "no-go-live-certificate": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല)",
    "go-live-untrusted": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (നൽകിയ പരിശോധനാ സർട്ടിഫിക്കറ്റ് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഉപയോഗിച്ചില്ല)",
  },
  notCounted: {
    "no-shows": "ആരൊക്കെ വന്നു (സമയം കഴിയുമ്പോൾ ബുക്കിംഗ് തീർന്നതായി രേഖപ്പെടുത്തും)", "read-receipts": "ഉപഭോക്താക്കൾ സന്ദേശം വായിച്ചോ എന്ന് (WhatsApp-ന്റെ രേഖയിൽ സന്ദേശം ഉണ്ടെന്ന് മാത്രം)",
    "outside-agent": "ഏജന്റ് വഴിയല്ലാതെ നടന്ന ബുക്കിംഗ്, കോൾ, പേയ്മെന്റ്", "rule-breaks": "ഏതെങ്കിലും പരിധി മറികടന്നോ എന്ന് (ഇവിടെ പരിധികൾ തടഞ്ഞത് മാത്രം എണ്ണിയിരിക്കുന്നു)",
  },
  page: {
    numbers: "കണക്കുകൾ", item: "എന്ത്", count: "എത്ര", amount: "തുക", droppedBeforeBooked: "ചോദിച്ചു, പക്ഷേ ബുക്ക് ആകുംമുമ്പ് ഒഴിവാക്കി",
    givenBackDeposits: "ഇതിൽ തിരികെ നൽകിയ അഡ്വാൻസ്", givenBackSecond: "ഇതിൽ തിരികെ നൽകിയ രണ്ടാമത്തെ പേയ്മെന്റ്", retried: "കലണ്ടർ വീണ്ടും നോക്കാൻ നിങ്ങൾ പറഞ്ഞത്",
    stoppedHeading: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", stoppedTotal: "തടഞ്ഞ കാര്യങ്ങൾ", stoppedNote: "ഒരു കാര്യം ഒരേ സമയം രണ്ട് പരിധികൾ തടഞ്ഞേക്കാം, അതിനാൽ വരികളുടെ ആകെത്തുക മൊത്തത്തേക്കാൾ കൂടുതലാകാം.",
    rule: "പരിധി", times: "തവണ", messagesHeading: "അയച്ച സന്ദേശങ്ങൾ", toCustomers: "ഉപഭോക്താക്കൾക്ക്", toYou: "നിങ്ങൾക്ക്, ഉടമയ്ക്ക്", heldBack: "അയയ്ക്കുംമുമ്പ് തടഞ്ഞത്",
    unconfirmedHeading: "ഉറപ്പിക്കാതെ പോയതോ പരാജയപ്പെട്ടതോ", stillOpen: "ഇപ്പോഴും തുറന്നത്", settledLater: "പിന്നീടുള്ള ഘട്ടത്തിൽ തീർന്നത്", nothing: "ഒന്നുമില്ല.",
    waitingNow: "ഈ റിപ്പോർട്ട് ഉണ്ടാക്കുമ്പോൾ നിങ്ങളുടെ മറുപടിക്കായി കാത്തിരുന്നത്", paidNotBooked: "പണം ലഭിച്ചു, പക്ഷേ കലണ്ടറിൽ ബുക്കിംഗ് കണ്ടില്ല",
    missingHeading: "രേഖയിൽ എഴുതാതെ പോയത്, അതിനാൽ മുകളിലെ എണ്ണം പൂർണ്ണമല്ല", missingDepositAmounts: "തുക എഴുതാത്ത അഡ്വാൻസുകൾ", missingRefundAmounts: "തുക എഴുതാത്ത റീഫണ്ടുകൾ",
    missingOwnerCommands: "കമാൻഡ് എഴുതാത്ത നിങ്ങളുടെ മറുപടികൾ", missingMessageTargets: "സ്വീകർത്താവ് എഴുതാത്ത സന്ദേശങ്ങൾ",
    notCountedHeading: "എണ്ണാത്തത്", notTestedHeading: "പരിശോധിക്കാത്തത്",
    checkHeading: "ഈ രേഖ പരിശോധിക്കുക", code: "കോഡ്", digest: "ഡൈജസ്റ്റ്", limitsDigest: "പരിധികളുടെ ഡൈജസ്റ്റ്", recordDigest: "രേഖയുടെ ഡൈജസ്റ്റ്", countedFrom: "എവിടെ നിന്ന് എണ്ണി", setUpBy: "തയ്യാറാക്കിയത്", madeOn: "ഉണ്ടാക്കിയ തീയതി",
    agentVersion: "ഏജന്റ് പതിപ്പ്", checkAt: "ഇവിടെ പരിശോധിക്കുക", signedBy: "ഈ കീ ഉപയോഗിച്ച് ഒപ്പിട്ടു", notSigned: "ഒപ്പിട്ടിട്ടില്ല",
    signatureNote: "ഈ രേഖ ആര് പുറത്തിറക്കി എന്നും അതിനുശേഷം മാറിയിട്ടില്ലെന്നും ഒപ്പ് കാണിക്കുന്നു. കണക്കുകൾ ശരിയാണെന്ന് അത് കാണിക്കുന്നില്ല.",
    showWhatWeDid: "ഞങ്ങൾ ചെയ്തത് കാണുക ▸", byActionHeading: "എന്ത് ചെയ്തു, പ്രവൃത്തിയും ഫലവും അനുസരിച്ച്",
    entriesHeading: "രേഖയിലെ ഓരോ എൻട്രിയും (വിരലടയാളം മാത്രം: ഉപഭോക്തൃ സന്ദേശങ്ങളോ ഫോൺ നമ്പറുകളോ ഇല്ല)",
    colNo: "നം.", colTime: "സമയം", colAction: "പ്രവൃത്തി", colOutcome: "ഫലം", colBooking: "ബുക്കിംഗ്", colFingerprint: "വിരലടയാളം",
    notAGrade: "ഇവ രേഖയിൽ കാണുന്നതിന്റെ എണ്ണം മാത്രമാണ്. ഇവ ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", period: "കാലയളവ്",
  },
  cert: {
    date: "തീയതി", held: (h, t, f, n) => `${t} സാഹചര്യങ്ങളിൽ ${h} എണ്ണം ശരിയായി നിന്നു. ${f} എണ്ണം പിഴച്ചു. ${n} കാര്യങ്ങൾ പരിശോധിച്ചിട്ടില്ല.`,
    intro: "തുടങ്ങുന്നതിന് മുമ്പ് തെറ്റാൻ സാധ്യതയുള്ള സാഹചര്യങ്ങൾ ഞങ്ങൾ പരീക്ഷിച്ചു: നഷ്ടപ്പെട്ട മറുപടികൾ, രണ്ടുതവണ വന്ന പേയ്മെന്റുകൾ, കലണ്ടറിൽ നിശ്ശബ്ദമായി സേവ് ആകാതിരിക്കൽ, ഏജന്റിനെ കബളിപ്പിക്കാൻ ശ്രമിക്കുന്ന ഉപഭോക്താക്കൾ.",
    yourLimits: "നിങ്ങളുടെ പരിധികൾ", floor: (items) => `ലിസ്റ്റ് വിലയിൽ കുറയില്ല: ${items}`,
    deposit: (amount, minutes) => `അഡ്വാൻസ് ${amount}; അതിനായി സമയം ${minutes} മിനിറ്റ് മാറ്റിവയ്ക്കും`, cancel: (hours) => `തുടങ്ങുന്നതിന് കുറഞ്ഞത് ${hours} മണിക്കൂർ മുമ്പ് റദ്ദാക്കിയാൽ അഡ്വാൻസ് തിരികെ ലഭിക്കും; അതിനു ശേഷം റദ്ദാക്കിയാൽ തീരുമാനം നിങ്ങളുടേത്`,
    refund: (amount) => `${amount}-ന് മുകളിലുള്ള റീഫണ്ട് നിങ്ങളോട് ചോദിച്ച ശേഷം മാത്രം`, hours: "പ്രവൃത്തി സമയത്തിന് പുറത്ത് ബുക്കിംഗ് ഇല്ല",
    notAGrade: "ഇത് പരീക്ഷിച്ച സാഹചര്യങ്ങളുടെ എണ്ണം മാത്രമാണ്. ഇത് ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", didNotHold: "പിഴച്ചവ",
    handRunLine: `പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തത് യഥാർത്ഥ WhatsApp, പേയ്മെന്റ്, കലണ്ടർ എന്നിവയിലല്ല, പരിശീലന സംവിധാനങ്ങളിലാണ് ${standIn}. ടെസ്റ്റ് പണം മാത്രം.`,
    countedIntro: (period) => `ഏജന്റിന്റെ രേഖയിൽ നിന്ന് എണ്ണിയത്, ${period}:`, checkedOn: "പരിശോധിച്ചത്",
  },
  goLive: {
    heading: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധന",
    own: (date) => `തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ തന്നെയാണ് നടത്തിയത്, ${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പ്രകാരം.`,
    example: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഉദാഹരണ കടയായ Glow Salon-ൽ ആണ് നടത്തിയത് എന്നാണ്, ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ അല്ല.`,
    different: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഈ കടയുടേതിൽ നിന്ന് വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിലാണ് നടത്തിയത് എന്നാണ്, അതിനാൽ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങൾ എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് അത് കാണിക്കുന്നില്ല.`,
    untrusted: "ഒരു പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിരുന്നു, പക്ഷേ അത് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല (അതിൽ ഒപ്പില്ല, ഒപ്പ് ചേരുന്നില്ല, അല്ലെങ്കിൽ അത് പരിശോധനാ സർട്ടിഫിക്കറ്റ് അല്ല), അതിനാൽ ഉപയോഗിച്ചില്ല.",
    none: "പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല, അതിനാൽ തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഏത് ക്രമീകരണങ്ങളിലാണ് നടത്തിയതെന്ന് ഈ രേഖ പറയുന്നില്ല.",
    signedWith: (key) => `പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ ഒപ്പിട്ടത് ${key} എന്ന കീ ഉപയോഗിച്ചാണ്. ആ കീ ആരുടെ കൈയിലാണെന്ന് കീ കാണിക്കുന്നില്ല.`,
  },
};

const kn: Strings = {
  agent: "ಬುಕಿಂಗ್ ಏಜೆಂಟ್", monthlyReport: "ಮಾಸಿಕ ವರದಿ", goLiveCertificate: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ", monthlyCertificate: "ಮಾಸಿಕ ದಾಖಲೆ ಪ್ರಮಾಣಪತ್ರ",
  languageName: { hi: "ಹಿಂದಿ", en: "ಇಂಗ್ಲಿಷ್", ml: "ಮಲಯಾಳಂ", kn: "ಕನ್ನಡ" },
  label: {
    bookingsMade: "ಆದ ಬುಕಿಂಗ್", cancelled: "ರದ್ದಾದವು", moved: "ಸಮಯ ಬದಲಾದವು", depositsCollected: "ಬಂದ ಮುಂಗಡ ಹಣ", givenBack: "ಹಿಂತಿರುಗಿಸಿದ್ದು",
    wasAsked: "ನಿಮ್ಮನ್ನು ಕೇಳಿದ್ದು", approved: "ನೀವು ಒಪ್ಪಿದ್ದು", saidNo: "ನೀವು ಬೇಡ ಎಂದದ್ದು", notConfirmed: "ಖಚಿತಪಡಿಸಲು ಆಗದ್ದು", stoppedByLimits: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", notChecked: "ಪರಿಶೀಲಿಸದ್ದು",
  },
  stop: {
    "price-at-or-above-list": "ಬೆಲೆ ಪಟ್ಟಿಗಿಂತ ಕಡಿಮೆ ಕೇಳಿದ್ದು", "within-hours": "ಕೆಲಸದ ಸಮಯದ ಹೊರಗಿನ ಬುಕಿಂಗ್", "no-double-booking": "ಒಂದೇ ಸಮಯಕ್ಕೆ ಎರಡನೇ ಬುಕಿಂಗ್",
    "confirm-only-when-recorded": "ದಾಖಲೆಗೆ ಮುಂಚೆ \"ಬುಕ್ ಆಯಿತು\" ಎನ್ನುವುದು", "one-deposit-per-booking": "ಎರಡನೇ ಬಾರಿ ಕಟ್ಟಿದ ಮುಂಗಡ", "refund-limit": "ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್",
    "no-message-after-stop": "ರದ್ದು ಅಥವಾ STOP ನಂತರದ ಜ್ಞಾಪನೆ", "message-matches-record": "ದಾಖಲೆಗೆ ಹೊಂದದ ಸಂದೇಶ", "opt-out": "STOP ನಂತರದ ಸಂದೇಶ",
  },
  more: (n) => `ಇನ್ನೂ ${n} ವಿಷಯಗಳು (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ)`,
  handRun: "ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.",
  sourceTag: { "stand-in": "ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ", "test-mode": "ಟೆಸ್ಟ್ ಮೋಡ್, ಟೆಸ್ಟ್ ಹಣ", live: "" },
  sourceLong: {
    "stand-in": "ಈ ಲೆಕ್ಕಗಳು ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳು ಮತ್ತು ಟೆಸ್ಟ್ ಹಣದಿಂದ ಬಂದವು. ನಿಜವಾದ ಯಾವುದನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ, ಪಾವತಿಸಿಲ್ಲ.",
    "test-mode": "ಈ ಲೆಕ್ಕಗಳು ನಿಜವಾದ ಸೇವೆಗಳ ಟೆಸ್ಟ್ ಮೋಡ್‌ನಿಂದ ಬಂದವು. ಹಣ ಟೆಸ್ಟ್ ಹಣವಾಗಿತ್ತು.",
    live: "ಈ ಲೆಕ್ಕಗಳು ನಿಜವಾದ ಸೇವೆಗಳ ನಡೆಯುತ್ತಿರುವ ದಾಖಲೆಯಿಂದ ಬಂದವು.",
  },
  notTested: {
    "voice-calls": "ಫೋನ್ ಕರೆಗಳು", "group-bookings": "ಗುಂಪು ಬುಕಿಂಗ್", "walk-ins": "ನೇರವಾಗಿ ಬರುವವರು (ವಾಕ್-ಇನ್)", "payments-outside-razorpay": "Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು",
    "real-whatsapp": "ನಿಜವಾದ WhatsApp", "real-razorpay": "ನಿಜವಾದ Razorpay (ಟೆಸ್ಟ್ ಮೋಡ್ ಅಥವಾ ಲೈವ್)", "real-calendar": "ನಿಜವಾದ ಕ್ಯಾಲೆಂಡರ್", "webhook-signatures": "ಪಾವತಿ ಸೂಚನೆಗಳ ಸಹಿ (webhook signatures)",
    "real-model": "ನಿಜವಾದ AI ಮಾದರಿ (ಸಂದೇಶ ಓದುವುದು ನಿಗದಿತ ನಿಯಮಗಳಿಂದ, ಉತ್ತರಗಳು ನಿಗದಿತ ಮಾದರಿಗಳಿಂದ)", "other-languages": "ತಮಿಳು, ತೆಲುಗು ಮತ್ತು ಇತರ ಭಾಷೆಗಳು",
    "native-review": "ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡ ಪದಗಳನ್ನು ಮಾತೃಭಾಷಿಕರು ಪರಿಶೀಲಿಸುವುದು (ಇವು ಯಂತ್ರ ಬರೆದದ್ದು)", "restart-mid-step": "ಒಂದು ಹಂತದ ಮಧ್ಯದಲ್ಲಿ ನಿಲ್ಲುವುದು ಅಥವಾ ಮತ್ತೆ ಆರಂಭವಾಗುವುದು",
    "same-instant": "ಒಂದೇ ಕ್ಷಣದಲ್ಲಿ ಇಬ್ಬರು ಗ್ರಾಹಕರು", "other-faults": "ಪ್ರಯತ್ನಿಸಿದವುಗಳ ಹೊರತಾದ ತೊಂದರೆಗಳು",
    "own-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಇವು ಉದಾಹರಣೆ ಅಂಗಡಿ Glow Salon ಮೇಲೆ ನಡೆದವು)",
    "situations-skipped": "ಈ ಪರಿಶೀಲನೆಗಳಲ್ಲಿ ಕೆಲವು, ಈ ಅಂಗಡಿಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ನಡೆಸಲಾಗದ ಕಾರಣ ಬಿಟ್ಟಿದೆ",
    "other-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪ್ರಮಾಣಪತ್ರದ ಪ್ರಕಾರ ಇವು ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು)",
    "no-go-live-certificate": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ)",
    "go-live-untrusted": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಕೊಟ್ಟ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ)",
  },
  notCounted: {
    "no-shows": "ಯಾರು ಬಂದರು (ಸಮಯ ಕಳೆದ ಮೇಲೆ ಬುಕಿಂಗ್ ಮುಗಿದಂತೆ ದಾಖಲಾಗುತ್ತದೆ)", "read-receipts": "ಗ್ರಾಹಕರು ಸಂದೇಶ ಓದಿದರೇ ಎಂದು (WhatsApp ದಾಖಲೆಯಲ್ಲಿ ಸಂದೇಶ ಇದೆ ಎಂದಷ್ಟೇ)",
    "outside-agent": "ಏಜೆಂಟ್ ಮೂಲಕ ಅಲ್ಲದೆ ನಡೆದ ಬುಕಿಂಗ್, ಕರೆ, ಪಾವತಿ", "rule-breaks": "ಯಾವುದಾದರೂ ಮಿತಿ ದಾಟಿತೇ ಎಂದು (ಇಲ್ಲಿ ಮಿತಿಗಳು ತಡೆದದ್ದನ್ನು ಮಾತ್ರ ಎಣಿಸಲಾಗಿದೆ)",
  },
  page: {
    numbers: "ಲೆಕ್ಕಗಳು", item: "ಏನು", count: "ಎಷ್ಟು", amount: "ಮೊತ್ತ", droppedBeforeBooked: "ಕೇಳಿದರು, ಆದರೆ ಬುಕ್ ಆಗುವ ಮೊದಲು ಕೈಬಿಟ್ಟರು",
    givenBackDeposits: "ಇದರಲ್ಲಿ ಹಿಂತಿರುಗಿಸಿದ ಮುಂಗಡ ಹಣ", givenBackSecond: "ಇದರಲ್ಲಿ ಹಿಂತಿರುಗಿಸಿದ ಎರಡನೇ ಪಾವತಿ", retried: "ಕ್ಯಾಲೆಂಡರ್ ಮತ್ತೆ ನೋಡಲು ನೀವು ಹೇಳಿದ್ದು",
    stoppedHeading: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", stoppedTotal: "ತಡೆದ ವಿಷಯಗಳು", stoppedNote: "ಒಂದು ವಿಷಯವನ್ನು ಒಂದೇ ಸಮಯಕ್ಕೆ ಎರಡು ಮಿತಿಗಳು ತಡೆಯಬಹುದು, ಆದ್ದರಿಂದ ಸಾಲುಗಳ ಮೊತ್ತ ಒಟ್ಟಿಗಿಂತ ಹೆಚ್ಚಾಗಬಹುದು.",
    rule: "ಮಿತಿ", times: "ಬಾರಿ", messagesHeading: "ಕಳುಹಿಸಿದ ಸಂದೇಶಗಳು", toCustomers: "ಗ್ರಾಹಕರಿಗೆ", toYou: "ನಿಮಗೆ, ಮಾಲೀಕರಿಗೆ", heldBack: "ಕಳುಹಿಸುವ ಮೊದಲು ತಡೆದದ್ದು",
    unconfirmedHeading: "ಖಚಿತವಾಗದೆ ಉಳಿದದ್ದು ಅಥವಾ ವಿಫಲವಾದದ್ದು", stillOpen: "ಇನ್ನೂ ತೆರೆದಿರುವುದು", settledLater: "ನಂತರದ ಹಂತದಲ್ಲಿ ಮುಗಿದದ್ದು", nothing: "ಯಾವುದೂ ಇಲ್ಲ.",
    waitingNow: "ಈ ವರದಿ ಮಾಡುವಾಗ ನಿಮ್ಮ ಉತ್ತರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿದ್ದದ್ದು", paidNotBooked: "ಹಣ ಬಂತು, ಆದರೆ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಬುಕಿಂಗ್ ಕಾಣಲಿಲ್ಲ",
    missingHeading: "ದಾಖಲೆಯಲ್ಲಿ ಬರೆಯದೆ ಉಳಿದದ್ದು, ಆದ್ದರಿಂದ ಮೇಲಿನ ಎಣಿಕೆ ಪೂರ್ಣವಲ್ಲ", missingDepositAmounts: "ಮೊತ್ತ ಬರೆಯದ ಮುಂಗಡಗಳು", missingRefundAmounts: "ಮೊತ್ತ ಬರೆಯದ ರೀಫಂಡ್‌ಗಳು",
    missingOwnerCommands: "ಆದೇಶ ಬರೆಯದ ನಿಮ್ಮ ಉತ್ತರಗಳು", missingMessageTargets: "ಸ್ವೀಕರಿಸುವವರು ಬರೆಯದ ಸಂದೇಶಗಳು",
    notCountedHeading: "ಎಣಿಸದ್ದು", notTestedHeading: "ಪರಿಶೀಲಿಸದ್ದು",
    checkHeading: "ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ", code: "ಕೋಡ್", digest: "ಡೈಜೆಸ್ಟ್", limitsDigest: "ಮಿತಿಗಳ ಡೈಜೆಸ್ಟ್", recordDigest: "ದಾಖಲೆಯ ಡೈಜೆಸ್ಟ್", countedFrom: "ಎಲ್ಲಿಂದ ಎಣಿಸಿದ್ದು", setUpBy: "ಸಿದ್ಧಪಡಿಸಿದವರು", madeOn: "ಮಾಡಿದ ದಿನ",
    agentVersion: "ಏಜೆಂಟ್ ಆವೃತ್ತಿ", checkAt: "ಇಲ್ಲಿ ಪರಿಶೀಲಿಸಿ", signedBy: "ಈ ಕೀಲಿಯಿಂದ ಸಹಿ ಮಾಡಲಾಗಿದೆ", notSigned: "ಸಹಿ ಇಲ್ಲ",
    signatureNote: "ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ನೀಡಿದರು ಮತ್ತು ಅಂದಿನಿಂದ ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಲೆಕ್ಕಗಳು ಸತ್ಯ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
    showWhatWeDid: "ನಾವು ಏನು ಮಾಡಿದೆವು ನೋಡಿ ▸", byActionHeading: "ಏನು ಮಾಡಲಾಯಿತು, ಕೆಲಸ ಮತ್ತು ಫಲಿತಾಂಶದ ಪ್ರಕಾರ",
    entriesHeading: "ದಾಖಲೆಯ ಪ್ರತಿ ನಮೂದು (ಬೆರಳಚ್ಚು ಮಾತ್ರ: ಗ್ರಾಹಕರ ಸಂದೇಶಗಳಾಗಲಿ ಫೋನ್ ಸಂಖ್ಯೆಗಳಾಗಲಿ ಇಲ್ಲ)",
    colNo: "ಕ್ರ.", colTime: "ಸಮಯ", colAction: "ಕೆಲಸ", colOutcome: "ಫಲಿತಾಂಶ", colBooking: "ಬುಕಿಂಗ್", colFingerprint: "ಬೆರಳಚ್ಚು",
    notAGrade: "ಇವು ದಾಖಲೆಯಲ್ಲಿ ಕಾಣುವುದರ ಎಣಿಕೆ ಮಾತ್ರ. ಇವು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ಕೊಡುವುದಿಲ್ಲ.", period: "ಅವಧಿ",
  },
  cert: {
    date: "ದಿನಾಂಕ", held: (h, t, f, n) => `${t} ಸಂದರ್ಭಗಳಲ್ಲಿ ${h} ಸರಿಯಾಗಿ ನಿಂತವು. ${f} ತಪ್ಪಿದವು. ${n} ವಿಷಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿಲ್ಲ.`,
    intro: "ಆರಂಭಿಸುವ ಮೊದಲು ತಪ್ಪಾಗಬಹುದಾದ ಸಂದರ್ಭಗಳನ್ನು ನಾವು ಪ್ರಯತ್ನಿಸಿದೆವು: ಕಳೆದುಹೋದ ಉತ್ತರಗಳು, ಎರಡು ಬಾರಿ ಬಂದ ಪಾವತಿಗಳು, ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಮೌನವಾಗಿ ಉಳಿಯದಿರುವುದು, ಏಜೆಂಟ್ ಅನ್ನು ಮೋಸಗೊಳಿಸಲು ಯತ್ನಿಸುವ ಗ್ರಾಹಕರು.",
    yourLimits: "ನಿಮ್ಮ ಮಿತಿಗಳು", floor: (items) => `ಬೆಲೆ ಪಟ್ಟಿಗಿಂತ ಕಡಿಮೆ ಇಲ್ಲ: ${items}`,
    deposit: (amount, minutes) => `ಮುಂಗಡ ಹಣ ${amount}; ಅದಕ್ಕಾಗಿ ಸಮಯವನ್ನು ${minutes} ನಿಮಿಷ ಕಾಯ್ದಿರಿಸಲಾಗುತ್ತದೆ`, cancel: (hours) => `ಆರಂಭಕ್ಕೆ ಕನಿಷ್ಠ ${hours} ಗಂಟೆ ಮೊದಲು ರದ್ದುಮಾಡಿದರೆ ಮುಂಗಡ ಹಣ ಹಿಂತಿರುಗುತ್ತದೆ; ನಂತರ ರದ್ದುಮಾಡಿದರೆ ತೀರ್ಮಾನ ನಿಮ್ಮದು`,
    refund: (amount) => `${amount} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್ ನಿಮ್ಮನ್ನು ಕೇಳಿದ ನಂತರ ಮಾತ್ರ`, hours: "ಕೆಲಸದ ಸಮಯದ ಹೊರಗೆ ಬುಕಿಂಗ್ ಇಲ್ಲ",
    notAGrade: "ಇದು ಪ್ರಯತ್ನಿಸಿದ ಸಂದರ್ಭಗಳ ಎಣಿಕೆ ಮಾತ್ರ. ಇದು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ಕೊಡುವುದಿಲ್ಲ.", didNotHold: "ತಪ್ಪಿದವು",
    handRunLine: `ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಿದ್ದು ನಿಜವಾದ WhatsApp, ಪಾವತಿ, ಕ್ಯಾಲೆಂಡರ್ ಮೇಲೆ ಅಲ್ಲ, ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳ ಮೇಲೆ ${standIn}. ಟೆಸ್ಟ್ ಹಣ ಮಾತ್ರ.`,
    countedIntro: (period) => `ಏಜೆಂಟ್‌ನ ದಾಖಲೆಯಿಂದ ಎಣಿಸಿದ್ದು, ${period}:`, checkedOn: "ಪರಿಶೀಲನೆ ನಡೆದದ್ದು",
  },
  goLive: {
    heading: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆ",
    own: (date) => `ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆಯೇ ನಡೆದವು, ${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದ ಪ್ರಕಾರ.`,
    example: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಉದಾಹರಣೆ ಅಂಗಡಿ Glow Salon ಮೇಲೆ ನಡೆದವು, ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ಅಲ್ಲ.`,
    different: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಗಿಂತ ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು, ಆದ್ದರಿಂದ ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.`,
    untrusted: "ಒಂದು ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಡಲಾಗಿತ್ತು, ಆದರೆ ಅದನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ (ಅದರಲ್ಲಿ ಸಹಿ ಇಲ್ಲ, ಸಹಿ ಹೊಂದುವುದಿಲ್ಲ, ಅಥವಾ ಅದು ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವೇ ಅಲ್ಲ), ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ.",
    none: "ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ, ಆದ್ದರಿಂದ ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಯಾವ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು ಈ ದಾಖಲೆ ಹೇಳುವುದಿಲ್ಲ.",
    signedWith: (key) => `ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರಕ್ಕೆ ಸಹಿ ಮಾಡಿದ್ದು ${key} ಎಂಬ ಕೀಲಿಯಿಂದ. ಆ ಕೀಲಿ ಯಾರ ಬಳಿ ಇದೆ ಎಂದು ಕೀಲಿ ತೋರಿಸುವುದಿಲ್ಲ.`,
  },
};

export const STRINGS: Record<Language, Strings> = { hi, en, ml, kn };

// ---- the words no document may contain ------------------------------------------------------------------------------

/**
 * Claim rules 3 and 7: never "safe", "guaranteed", "certified", and no earnings claims. English words are checked in
 * every language (an English word can sit in any text); each language adds its own. "certificate" is fine; "certified"
 * is not, so these name the exact words and do not cut them short. The confirm verbs of the packs are not here.
 */
export const BANNED: Record<Language | "any", RegExp[]> = {
  any: [/\bsafe/i, /\bsafety\b/i, /guarant/i, /\bcertified\b/i, /\bcertify\b/i, /\bcertifies\b/i, /\bcertification\b/i, /\b100 ?%/, /risk[- ]?free/i, /fool[- ]?proof/i, /\bsecure(d|ly)?\b/i, /\bproven\b/i,
    /\bearn/i, /\bincome\b/i, /\bprofit/i, /\brevenue\b/i],
  en: [],
  hi: [/सुरक्षित/u, /सुरक्षा/u, /गारंटी/u, /गारण्टी/u, /प्रमाणित/u, /कमाई/u, /आमदनी/u, /मुनाफ़ा/u, /मुनाफा/u],
  ml: [/സുരക്ഷിത/u, /ഗ്യാരണ്ടി/u, /ഗ്യാരന്റി/u, /സർട്ടിഫൈഡ്/u, /വരുമാനം/u, /ലാഭം/u, /സമ്പാദി/u, /ഉറപ്പ് ?നൽകു/u, /ഉറപ്പുനൽകു/u],
  kn: [/ಸುರಕ್ಷಿತ/u, /ಗ್ಯಾರಂಟಿ/u, /ಖಾತರಿ/u, /ಖಾತ್ರಿ/u, /ಪ್ರಮಾಣೀಕೃತ/u, /ಪ್ರಮಾಣೀಕರಿಸ/u, /ಆದಾಯ/u, /ಲಾಭ/u, /ಗಳಿಕೆ/u, /ಸಂಪಾದ/u],
};

/** The banned words found in a text written in a language (and "both" languages: pass each). Empty means none. */
export function bannedIn(text: string, language: Language): string[] {
  return [...BANNED.any, ...BANNED[language]].filter((re) => re.test(text)).map((re) => re.source);
}
