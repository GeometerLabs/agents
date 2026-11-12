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
import { INNOVATOR, CHECK_GENUINE, SCAN_SUMMARY, SETTLED_BY_SOMEONE, SETTLED_BY_WORD } from "../../../../modules/report/text.ts";
import { STAND_IN_SERVICES } from "../crash-test/not-tested.ts";
import type { RuleId } from "../../../../modules/record/record.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { NotCountedId, NotTestedKey, Source } from "./data.ts";

export interface Strings {
  agent: string;
  monthlyReport: string;
  goLiveCertificate: string;
  monthlyCertificate: string;
  /** The badge for the first 100 builders and partners, as a word. Shown after BADGE_SYMBOL on the report page, the certificate and the WhatsApp message. */
  innovator: string;
  /** The label before the address of the full report page, in the WhatsApp message. */
  fullReport: string;
  /** The label before the check link in the WhatsApp message (modules/report/text.ts CHECK_GENUINE). */
  checkGenuine: string;
  /** A refund a person settled as made, by their word (B75): "Settled by <who>, by their word", and the same without a name (modules/report/text.ts). */
  settledByWord: (who: string) => string;
  settledBySomeone: string;
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
  /** The labels a UPI shop's report uses instead (B33): its money is what the owner marked, not what a payment service shows. */
  upiLabel: { deposits: string; givenBack: string };
  notTested: Record<NotTestedKey, string>;
  notCounted: Record<NotCountedId, string>;
  /** The month's work and what it cost (plan B75): the three counts, what each means, and why a cost per job is sometimes not given. */
  work: {
    heading: string; jobs: string; completed: string; abandoned: string; unresolved: string; settledByPerson: string; cost: string; costUnknown: string; unitCost: string;
    noCompleted: string; noCost: string; completedMeans: string; abandonedMeans: string; unresolvedMeans: string; abandonedNeverClears: string;
  };
  page: {
    numbers: string; item: string; count: string; amount: string; droppedBeforeBooked: string; givenBackDeposits: string; givenBackSecond: string; retried: string;
    stoppedHeading: string; stoppedTotal: string; stoppedNote: string; rule: string; times: string;
    messagesHeading: string; toCustomers: string; toYou: string; heldBack: string;
    unconfirmedHeading: string; stillOpen: string; settledLater: string; nothing: string; waitingNow: string; paidNotBooked: string;
    missingHeading: string; missingDepositAmounts: string; missingRefundAmounts: string; missingOwnerCommands: string; missingMessageTargets: string;
    notCountedHeading: string; notTestedHeading: string;
    checkHeading: string; code: string; digest: string; limitsDigest: string; recordDigest: string; countedFrom: string; setUpBy: string; madeOn: string; agentVersion: string;
    checkAt: string; signedBy: string; notSigned: string; signatureNote: string; scanToCheck: string; scanSummary: string;
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
  innovator: INNOVATOR.en,
  fullReport: "Full report", checkGenuine: CHECK_GENUINE.en, settledByWord: SETTLED_BY_WORD.en, settledBySomeone: SETTLED_BY_SOMEONE.en,
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
  upiLabel: { deposits: "Deposits marked paid by owner", givenBack: "Refunds marked sent by owner" },
  notTested: {
    "upi-not-automatic": "automatic payment checking: with UPI the owner marks each payment received", "real-upi": "a real UPI app paying a real UPI ID (the owner's marks were tried, not a payment)",
    "voice-calls": "phone calls", "group-bookings": "group bookings", "walk-ins": "walk-ins", "payments-outside-razorpay": "payments made outside Razorpay",
    "real-whatsapp": "real WhatsApp", "real-razorpay": "real Razorpay, in test mode or live", "real-calendar": "a real calendar", "webhook-signatures-upi": "webhook signatures (proof that a message came from WhatsApp)", "webhook-signatures": "webhook signatures (proof that a payment notice came from Razorpay)",
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
  work: {
    heading: "Work this month, and what it cost", jobs: "Bookings worked on", completed: "Completed", abandoned: "Abandoned", unresolved: "Unresolved",
    settledByPerson: "Steps a person settled by hand (their word, not the service's)", cost: "Cost this month", costUnknown: "Not worked out for this report", unitCost: "Cost per completed job",
    noCompleted: "None: no job was completed, so there is no cost per job.", noCost: "None: the cost is not known, so there is no cost per job.",
    completedMeans: "Completed means the calendar's own record shows the booking and the deposit was recorded first, and nothing about it is still open. A booking cancelled afterwards counts as completed once its refund is settled.",
    abandonedMeans: "Abandoned means the conversation stopped before the calendar confirmed a booking: nobody paid, the hold ran out, or the customer dropped it.",
    unresolvedMeans: "Unresolved means something is still open or not confirmed: a step a service never confirmed, a refund waiting for you or owed by you, or a payment the customer says they made that you have not marked.",
    abandonedNeverClears: "A customer who stops replying never closes an unresolved item.",
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
    scanToCheck: "Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your partner or Geometer's team gave you.", scanSummary: SCAN_SUMMARY.en, signatureNote: "A signature shows who issued this document and that it has not changed since. It does not show that the numbers are true.",
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
  innovator: INNOVATOR.hi,
  fullReport: "पूरी रिपोर्ट", checkGenuine: CHECK_GENUINE.hi, settledByWord: SETTLED_BY_WORD.hi, settledBySomeone: SETTLED_BY_SOMEONE.hi,
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
  upiLabel: { deposits: "मालिक द्वारा मिला हुआ दर्ज जमा", givenBack: "मालिक द्वारा भेजा हुआ दर्ज रिफंड" },
  notTested: {
    "upi-not-automatic": "भुगतान की अपने-आप जाँच: UPI में हर भुगतान मालिक खुद मिला हुआ दर्ज करते हैं", "real-upi": "असली UPI ऐप से असली UPI ID पर भुगतान (मालिक का दर्ज करना आज़माया गया, भुगतान नहीं)",
    "voice-calls": "फ़ोन कॉल", "group-bookings": "समूह की बुकिंग", "walk-ins": "वॉक-इन ग्राहक", "payments-outside-razorpay": "Razorpay के बाहर के भुगतान",
    "real-whatsapp": "असली WhatsApp", "real-razorpay": "असली Razorpay (टेस्ट मोड या चालू)", "real-calendar": "असली कैलेंडर", "webhook-signatures-upi": "संदेशों के हस्ताक्षर (webhook signatures)", "webhook-signatures": "पेमेंट सूचनाओं के हस्ताक्षर (webhook signatures)",
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
  work: {
    heading: "इस महीने का काम और उसका खर्च", jobs: "जिन बुकिंग पर काम हुआ", completed: "पूरे हुए", abandoned: "बीच में छूटे", unresolved: "अनसुलझे",
    settledByPerson: "जो कदम किसी व्यक्ति ने हाथ से निपटाए (उनकी बात, सेवा की नहीं)", cost: "इस महीने का खर्च", costUnknown: "इस रिपोर्ट के लिए निकाला नहीं गया", unitCost: "हर पूरे हुए काम का खर्च",
    noCompleted: "कुछ नहीं: कोई काम पूरा नहीं हुआ, इसलिए प्रति काम खर्च नहीं।", noCost: "कुछ नहीं: खर्च पता नहीं है, इसलिए प्रति काम खर्च नहीं।",
    completedMeans: "पूरा हुआ का मतलब: कैलेंडर के अपने रिकॉर्ड में बुकिंग दिखती है, उससे पहले जमा राशि दर्ज हुई, और उसमें कुछ भी खुला नहीं है। बाद में रद्द हुई बुकिंग तब पूरी गिनी जाती है जब उसका रिफंड निपट जाए।",
    abandonedMeans: "बीच में छूटा का मतलब: कैलेंडर के बुकिंग पक्की करने से पहले बातचीत रुक गई: किसी ने पैसे नहीं दिए, होल्ड खत्म हो गया, या ग्राहक ने छोड़ दिया।",
    unresolvedMeans: "अनसुलझा का मतलब: कुछ अभी खुला है या पक्का नहीं हुआ: जो कदम किसी सेवा ने पक्का नहीं किया, आपके इंतज़ार में या आपके देने वाला रिफंड, या ग्राहक का बताया पेमेंट जिसे आपने दर्ज नहीं किया।",
    abandonedNeverClears: "जो ग्राहक जवाब देना बंद कर दे, उससे कोई अनसुलझी बात बंद नहीं होती।",
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
    scanToCheck: "इस दस्तावेज़ को geometer.dev पर जाँचने के लिए स्कैन करें। इसकी .json फ़ाइल चाहिए होगी। जाँच आपके ब्राउज़र में होती है, कुछ भेजा नहीं जाता। लिंक में हस्ताक्षर की कुंजी नहीं है: किसने हस्ताक्षर किए यह जानने के लिए यहाँ दिखी कुंजी को उस कुंजी से मिलाएँ जो आपके पार्टनर या Geometer की टीम ने दी है।", scanSummary: SCAN_SUMMARY.hi, signatureNote: "हस्ताक्षर बताता है कि यह दस्तावेज़ किसने जारी किया और तब से बदला नहीं है। यह नहीं बताता कि आँकड़े सच हैं।",
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
  innovator: INNOVATOR.ml,
  fullReport: "പൂർണ്ണ റിപ്പോർട്ട്", checkGenuine: CHECK_GENUINE.ml, settledByWord: SETTLED_BY_WORD.ml, settledBySomeone: SETTLED_BY_SOMEONE.ml,
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
  upiLabel: { deposits: "ഉടമ കിട്ടിയതായി രേഖപ്പെടുത്തിയ അഡ്വാൻസ്", givenBack: "ഉടമ അയച്ചതായി രേഖപ്പെടുത്തിയ റീഫണ്ട്" },
  notTested: {
    "upi-not-automatic": "പണമടവ് സ്വയം പരിശോധിക്കൽ: UPI-യിൽ ഓരോ പണമടവും ഉടമ തന്നെ കിട്ടിയതായി രേഖപ്പെടുത്തുന്നു", "real-upi": "യഥാർത്ഥ UPI ആപ്പിൽ നിന്ന് യഥാർത്ഥ UPI ID-യിലേക്കുള്ള പണമടവ് (ഉടമയുടെ രേഖപ്പെടുത്തലാണ് പരീക്ഷിച്ചത്, പണമടവല്ല)",
    "voice-calls": "ഫോൺ കോളുകൾ", "group-bookings": "ഗ്രൂപ്പ് ബുക്കിംഗ്", "walk-ins": "നേരിട്ട് വരുന്നവർ (വാക്ക്-ഇൻ)", "payments-outside-razorpay": "Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ",
    "real-whatsapp": "യഥാർത്ഥ WhatsApp", "real-razorpay": "യഥാർത്ഥ Razorpay (ടെസ്റ്റ് മോഡോ ലൈവോ)", "real-calendar": "യഥാർത്ഥ കലണ്ടർ", "webhook-signatures-upi": "സന്ദേശങ്ങളുടെ ഒപ്പ് (webhook signatures)", "webhook-signatures": "പേയ്മെന്റ് അറിയിപ്പുകളുടെ ഒപ്പ് (webhook signatures)",
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
  work: {
    heading: "ഈ മാസത്തെ ജോലിയും അതിന്റെ ചെലവും", jobs: "ജോലി ചെയ്ത ബുക്കിംഗുകൾ", completed: "പൂർത്തിയായത്", abandoned: "ഇടയ്ക്ക് നിന്നുപോയത്", unresolved: "പരിഹരിക്കാത്തത്",
    settledByPerson: "ഒരാൾ കൈകൊണ്ട് തീർത്ത ഘട്ടങ്ങൾ (അവരുടെ വാക്ക്, സേവനത്തിന്റേതല്ല)", cost: "ഈ മാസത്തെ ചെലവ്", costUnknown: "ഈ റിപ്പോർട്ടിന് കണക്കാക്കിയിട്ടില്ല", unitCost: "പൂർത്തിയായ ഓരോ ജോലിയുടെയും ചെലവ്",
    noCompleted: "ഒന്നുമില്ല: ഒരു ജോലിയും പൂർത്തിയായില്ല, അതിനാൽ ഒരു ജോലിക്കുള്ള ചെലവില്ല.", noCost: "ഒന്നുമില്ല: ചെലവ് അറിയില്ല, അതിനാൽ ഒരു ജോലിക്കുള്ള ചെലവില്ല.",
    completedMeans: "പൂർത്തിയായത് എന്നാൽ: കലണ്ടറിന്റെ സ്വന്തം രേഖയിൽ ബുക്കിംഗ് കാണുന്നു, അതിനുമുമ്പ് അഡ്വാൻസ് രേഖപ്പെടുത്തി, ഇനി ഒന്നും തുറന്നിരിപ്പില്ല. പിന്നീട് റദ്ദാക്കിയ ബുക്കിംഗ് അതിന്റെ റീഫണ്ട് തീർന്നാൽ പൂർത്തിയായതായി കണക്കാക്കും.",
    abandonedMeans: "ഇടയ്ക്ക് നിന്നുപോയത് എന്നാൽ: കലണ്ടർ ബുക്കിംഗ് ഉറപ്പിക്കുംമുമ്പ് സംഭാഷണം നിന്നു: ആരും പണം അടച്ചില്ല, ഹോൾഡ് തീർന്നു, അല്ലെങ്കിൽ ഉപഭോക്താവ് ഉപേക്ഷിച്ചു.",
    unresolvedMeans: "പരിഹരിക്കാത്തത് എന്നാൽ: എന്തോ തുറന്നിരിക്കുന്നു അല്ലെങ്കിൽ ഉറപ്പായിട്ടില്ല: ഒരു സേവനം ഉറപ്പിക്കാത്ത ഘട്ടം, നിങ്ങൾക്കായി കാത്തിരിക്കുന്നതോ നിങ്ങൾ നൽകാനുള്ളതോ ആയ റീഫണ്ട്, അല്ലെങ്കിൽ ഉപഭോക്താവ് അടച്ചെന്ന് പറഞ്ഞ് നിങ്ങൾ രേഖപ്പെടുത്താത്ത പണം.",
    abandonedNeverClears: "മറുപടി നിർത്തിയ ഉപഭോക്താവ് ഒരു പരിഹരിക്കാത്ത കാര്യവും അടയ്ക്കുന്നില്ല.",
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
    scanToCheck: "ഈ രേഖ geometer.dev-ൽ പരിശോധിക്കാൻ സ്കാൻ ചെയ്യുക. ഇതിന്റെ .json ഫയൽ വേണ്ടിവരും. പരിശോധന നിങ്ങളുടെ ബ്രൗസറിൽ നടക്കുന്നു, ഒന്നും അയയ്ക്കുന്നില്ല. ലിങ്കിൽ ഒപ്പിട്ട കീ ഇല്ല: ആര് ഒപ്പിട്ടു എന്നറിയാൻ ഇവിടെ കാണുന്ന കീ, നിങ്ങളുടെ പങ്കാളിയോ Geometer ടീമോ തന്ന കീയുമായി ഒത്തുനോക്കുക.", scanSummary: SCAN_SUMMARY.ml, signatureNote: "ഈ രേഖ ആര് പുറത്തിറക്കി എന്നും അതിനുശേഷം മാറിയിട്ടില്ലെന്നും ഒപ്പ് കാണിക്കുന്നു. കണക്കുകൾ ശരിയാണെന്ന് അത് കാണിക്കുന്നില്ല.",
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
  innovator: INNOVATOR.kn,
  fullReport: "ಪೂರ್ಣ ವರದಿ", checkGenuine: CHECK_GENUINE.kn, settledByWord: SETTLED_BY_WORD.kn, settledBySomeone: SETTLED_BY_SOMEONE.kn,
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
  upiLabel: { deposits: "ಮಾಲೀಕರು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ಮುಂಗಡ", givenBack: "ಮಾಲೀಕರು ಕಳುಹಿಸಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ರೀಫಂಡ್" },
  notTested: {
    "upi-not-automatic": "ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ: UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರೇ ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸುತ್ತಾರೆ", "real-upi": "ನಿಜವಾದ UPI ಆ್ಯಪ್‌ನಿಂದ ನಿಜವಾದ UPI ID ಗೆ ಪಾವತಿ (ಮಾಲೀಕರ ದಾಖಲಾತಿಯನ್ನು ಪ್ರಯತ್ನಿಸಲಾಯಿತು, ಪಾವತಿಯನ್ನಲ್ಲ)",
    "voice-calls": "ಫೋನ್ ಕರೆಗಳು", "group-bookings": "ಗುಂಪು ಬುಕಿಂಗ್", "walk-ins": "ನೇರವಾಗಿ ಬರುವವರು (ವಾಕ್-ಇನ್)", "payments-outside-razorpay": "Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು",
    "real-whatsapp": "ನಿಜವಾದ WhatsApp", "real-razorpay": "ನಿಜವಾದ Razorpay (ಟೆಸ್ಟ್ ಮೋಡ್ ಅಥವಾ ಲೈವ್)", "real-calendar": "ನಿಜವಾದ ಕ್ಯಾಲೆಂಡರ್", "webhook-signatures-upi": "ಸಂದೇಶಗಳ ಸಹಿ (webhook signatures)", "webhook-signatures": "ಪಾವತಿ ಸೂಚನೆಗಳ ಸಹಿ (webhook signatures)",
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
  work: {
    heading: "ಈ ತಿಂಗಳ ಕೆಲಸ ಮತ್ತು ಅದರ ವೆಚ್ಚ", jobs: "ಕೆಲಸ ಮಾಡಿದ ಬುಕಿಂಗ್‌ಗಳು", completed: "ಪೂರ್ಣಗೊಂಡದ್ದು", abandoned: "ಅರ್ಧಕ್ಕೆ ನಿಂತದ್ದು", unresolved: "ಬಗೆಹರಿಯದ್ದು",
    settledByPerson: "ಒಬ್ಬ ವ್ಯಕ್ತಿ ಕೈಯಿಂದ ಮುಗಿಸಿದ ಹಂತಗಳು (ಅವರ ಮಾತು, ಸೇವೆಯದ್ದಲ್ಲ)", cost: "ಈ ತಿಂಗಳ ವೆಚ್ಚ", costUnknown: "ಈ ವರದಿಗೆ ಲೆಕ್ಕ ಹಾಕಿಲ್ಲ", unitCost: "ಪೂರ್ಣಗೊಂಡ ಪ್ರತಿ ಕೆಲಸದ ವೆಚ್ಚ",
    noCompleted: "ಯಾವುದೂ ಇಲ್ಲ: ಯಾವ ಕೆಲಸವೂ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ, ಆದ್ದರಿಂದ ಪ್ರತಿ ಕೆಲಸದ ವೆಚ್ಚವಿಲ್ಲ.", noCost: "ಯಾವುದೂ ಇಲ್ಲ: ವೆಚ್ಚ ತಿಳಿದಿಲ್ಲ, ಆದ್ದರಿಂದ ಪ್ರತಿ ಕೆಲಸದ ವೆಚ್ಚವಿಲ್ಲ.",
    completedMeans: "ಪೂರ್ಣಗೊಂಡದ್ದು ಎಂದರೆ: ಕ್ಯಾಲೆಂಡರ್‌ನ ಸ್ವಂತ ದಾಖಲೆಯಲ್ಲಿ ಬುಕಿಂಗ್ ಕಾಣುತ್ತದೆ, ಅದಕ್ಕಿಂತ ಮೊದಲು ಮುಂಗಡ ದಾಖಲಾಗಿದೆ, ಮತ್ತು ಇನ್ನೇನೂ ತೆರೆದಿಲ್ಲ. ನಂತರ ರದ್ದಾದ ಬುಕಿಂಗ್ ಅದರ ರೀಫಂಡ್ ಮುಗಿದಾಗ ಪೂರ್ಣಗೊಂಡದ್ದು ಎಂದು ಎಣಿಕೆಯಾಗುತ್ತದೆ.",
    abandonedMeans: "ಅರ್ಧಕ್ಕೆ ನಿಂತದ್ದು ಎಂದರೆ: ಕ್ಯಾಲೆಂಡರ್ ಬುಕಿಂಗ್ ಖಚಿತಪಡಿಸುವ ಮೊದಲೇ ಮಾತುಕತೆ ನಿಂತಿತು: ಯಾರೂ ಪಾವತಿಸಲಿಲ್ಲ, ಹೋಲ್ಡ್ ಮುಗಿಯಿತು, ಅಥವಾ ಗ್ರಾಹಕರು ಕೈಬಿಟ್ಟರು.",
    unresolvedMeans: "ಬಗೆಹರಿಯದ್ದು ಎಂದರೆ: ಏನೋ ಇನ್ನೂ ತೆರೆದಿದೆ ಅಥವಾ ಖಚಿತವಾಗಿಲ್ಲ: ಒಂದು ಸೇವೆ ಖಚಿತಪಡಿಸದ ಹಂತ, ನಿಮಗಾಗಿ ಕಾಯುತ್ತಿರುವ ಅಥವಾ ನೀವು ಕೊಡಬೇಕಾದ ರೀಫಂಡ್, ಅಥವಾ ಗ್ರಾಹಕರು ಪಾವತಿಸಿದ್ದೇನೆ ಎಂದು ಹೇಳಿ ನೀವು ದಾಖಲಿಸದ ಹಣ.",
    abandonedNeverClears: "ಉತ್ತರ ನಿಲ್ಲಿಸಿದ ಗ್ರಾಹಕರು ಯಾವುದೇ ಬಗೆಹರಿಯದ ವಿಷಯವನ್ನು ಮುಚ್ಚುವುದಿಲ್ಲ.",
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
    scanToCheck: "ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಇದರ .json ಫೈಲ್ ಬೇಕಾಗುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲಿಂಕ್‌ನಲ್ಲಿ ಸಹಿ ಮಾಡಿದ ಕೀ ಇಲ್ಲ: ಯಾರು ಸಹಿ ಮಾಡಿದರು ಎಂದು ತಿಳಿಯಲು ಇಲ್ಲಿ ತೋರಿಸಿದ ಕೀಯನ್ನು ನಿಮ್ಮ ಪಾಲುದಾರ ಅಥವಾ Geometer ತಂಡ ನೀಡಿದ ಕೀಯೊಂದಿಗೆ ಹೋಲಿಸಿ.", scanSummary: SCAN_SUMMARY.kn, signatureNote: "ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ನೀಡಿದರು ಮತ್ತು ಅಂದಿನಿಂದ ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಲೆಕ್ಕಗಳು ಸತ್ಯ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
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

/** The money labels of a report: a UPI shop's (B33) say the money was marked by the owner ("Deposits marked paid by owner"); a Razorpay shop's are as they were. */
export const moneyLabels = (language: Language, paidBy?: "owner-marked"): { deposits: string; givenBack: string } =>
  paidBy === "owner-marked" ? STRINGS[language].upiLabel : { deposits: STRINGS[language].label.depositsCollected, givenBack: STRINGS[language].label.givenBack };
