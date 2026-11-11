// Every word the monthly Fees report says, per language. Nothing numeric is typed here: counts, amounts and dates are filled in from the record by the per-language
// formatters in modules/language/format.ts, and these are the fixed words around them. The type makes sure no language is missing a string.
//
// Machine-written Hindi, Malayalam and Kannada. They are listed in REVIEW-ml.md and REVIEW-kn.md for a native speaker, and no real centre should be given them before
// that review. The claim rules (modules/report/claims.ts) apply: a document counts and states facts; it never grades.
import type { Language } from "../../../../modules/language/languages.ts";
import type { NotCountedId, NotTestedKey, Source } from "./data.ts";

export interface Strings {
  agent: string;
  monthlyReport: string;
  goLiveCertificate: string;
  /** The label before the address of the full report page, in the WhatsApp message. */
  fullReport: string;
  /** The owner's lines: "label: number". */
  label: { collected: string; stillToCollect: string; givenBack: string; takenOff: string; wasAsked: string; approved: string; saidNo: string; remindersSent: string; stoppedByLimits: string; notChecked: string; students: string };
  /** What each limit that stopped something is called. */
  stop: Record<string, string>;
  handRun: string;
  sourceTag: Record<Source, string>;
  more: (n: number) => string;
  /** The things an owner would expect to be checked and was not, in short. */
  notChecked: { cash: string; upi: string; whatsapp: string; razorpay: string; review: string };
  /** Each language's own name for the languages, for the table of messages by language. */
  languageName: Record<Language, string>;
  /** The full lists on the page: what the hand check did not cover, and what the record cannot count. */
  /** The labels a UPI shop's report uses instead (B33): its money is what the owner marked, not what a payment service shows. */
  upiLabel: { collected: string; givenBack: string; notChecked: string };
  notTested: Record<NotTestedKey, string>;
  notCounted: Record<NotCountedId, string>;
  /** The go-live certificate: what the situations tried were, and the centre's limits in plain words. The numbers are filled in by the per-language formatters. */
  cert: {
    date: string; held(held: number, total: number, failed: number, notTested: number): string; intro: string; yourLimits: string;
    paidRule: string; /** B71 part 2: a UPI centre's rule (no gateway named). */ paidRuleUpi: string; fees(items: string): string; due(day: number, graceDays: number): string; lateFee(amount: string): string; noLateFee: string;
    reminders(days: string, hour: number, most: number): string; partPayments(least: string): string; noPartPayments: string; waiver(amount: string): string; noWaiver: string; refund(amount: string): string;
    students(count: number): string; notAGrade: string; didNotHold: string; handRunLine: string; checkedOn: string;
  };
  /**
   * What the monthly report says about the go-live checks: whether a go-live certificate was given, whether it could be trusted, and what its checks ran on. A date is passed in
   * already written by the formatter, and a key as its id; the sentences carry no number or date of their own.
   */
  goLive: {
    heading: string; own(date: string): string; example(date: string): string; different(date: string): string;
    untrusted: string; none: string; signedWith(key: string): string;
  };
  page: {
    numbers: string; item: string; count: string; amount: string; moneyHeading: string; opened: string; paidInFull: string; partlyPaid: string; stillOpen: string;
    waiversHeading: string; byOwner: string; withinLimit: string; lateFees: string; lateFeesAdded: string; messagesHeading: string; remindersToParents: string; receiptsToParents: string; toYou: string; heldBack: string;
    stoppedHeading: string; rule: string; times: string; stoppedParents: string; notCountedHeading: string; notTestedHeading: string; unconfirmed: string;
    showWhatWeDid: string; byActionHeading: string; action: string; agentVersion: string; limitsDigest: string; recordDigest: string; liveServices: string;
    checkHeading: string; code: string; digest: string; countedFrom: string; setUpBy: string; madeOn: string; signedBy: string; notSigned: string; signatureNote: string; scanToCheck: string; notAGrade: string; period: string;
  };
}

export const en: Strings = {
  agent: "Fees agent", monthlyReport: "Monthly report", goLiveCertificate: "Go-live certificate", fullReport: "Full report",
  label: { collected: "Collected", stillToCollect: "Still to collect", givenBack: "Given back", takenOff: "Taken off fees", wasAsked: "You were asked", approved: "You approved", saidNo: "You said no", remindersSent: "Reminders sent", stoppedByLimits: "Stopped by your limits", notChecked: "Not checked", students: "students" },
  stop: {
    "no-reminder-once-paid": "Reminders after a payment", "reminder-cap": "More reminders than your cap", "waiver-limit": "Waivers for more than was owed", "fee-link-matches-record": "Links for the wrong amount", "refund-limit": "Refunds above what was paid",
    "one-refund-per-payment": "A second refund of one payment", "paid-only-when-recorded": "\"Paid\" with no payment on record", "message-matches-record": "Messages that did not match the record", "opt-out": "Messages after STOP",
  },
  handRun: "Checks were run by hand.",
  sourceTag: { "stand-in": "stand-in services, test money", "test-mode": "test mode, test money", live: "" },
  more: (n) => `and ${n} more (see the full report)`,
  notChecked: { cash: "fees paid in cash or by bank transfer", upi: "payments outside Razorpay", whatsapp: "real WhatsApp", razorpay: "real Razorpay", review: "a native speaker's review of the wording" },
  languageName: { hi: "Hindi", en: "English", ml: "Malayalam", kn: "Kannada" },
  upiLabel: { collected: "Marked paid by owner", givenBack: "Refunds marked sent by owner", notChecked: "automatic payment checking (with UPI you mark each payment)" },
  notTested: {
    "upi-not-automatic": "automatic payment checking: with UPI the owner marks each payment received", "real-upi": "a real UPI app paying a real UPI ID (the owner's marks were tried, not a payment)",
    "cash-and-bank-transfers": "Fees paid in cash or by bank transfer (a parent who says so is sent to the owner; nothing is marked paid)",
    "payments-outside-razorpay": "Payments outside Razorpay (this centre takes Razorpay)",
    "real-whatsapp": "Real WhatsApp",
    "real-razorpay": "Real Razorpay (test mode or live)",
    "webhook-signatures": "Webhook signatures",
    "real-model": "A real AI model (the rules and stand-in models were run; messages are fixed templates)",
    "other-languages": "Tamil, Telugu and other languages",
    "native-review": "A native speaker's review of the Malayalam and Kannada wording",
    "restart-mid-step": "A crash or restart in the middle of a step",
    "same-instant": "Two parents at the exact same instant",
    "two-children-one-message": "One message about two children at once (the oldest open fee is the one answered)",
    "other-faults": "Faults beyond the ones the hand check lists",
    "own-settings": "These checks on this centre's own settings (the go-live certificate says they ran on the example centre, Bright Tuition Centre)",
    "other-settings": "These checks on this centre's own settings (the go-live certificate says they ran on different settings)",
    "no-go-live-certificate": "These checks on this centre's own settings (no go-live certificate was given)",
    "go-live-untrusted": "These checks on this centre's own settings (the go-live certificate that was given could not be trusted, so it was not used)",
    "situations-skipped": "Situations these settings could not run (named in the go-live certificate)",
  },
  notCounted: {
    "cash-and-transfers": "Fees paid in cash or by bank transfer: the record only holds Razorpay payments",
    "read-receipts": "Whether a parent read a message",
    "outside-agent": "Anything done outside the agent (by you or anyone else, in Razorpay or WhatsApp)",
    // B71 part 2: a UPI centre's own words for the two lines above (machine-written hi/ml/kn wait for native review, like the rest)
    "cash-and-transfers-upi": "Fees paid in cash or by bank transfer: the record only holds the payments you marked received",
    "outside-agent-upi": "Anything done outside the agent (by you or anyone else, in your UPI app or WhatsApp)",
    "rule-breaks": "Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing",
  },
  cert: {
    date: "Date", held: (h, t, f, n) => `Held ${h} of ${t} situations. ${f} failed. ${n} not tested.`,
    intro: "Before switching on, we tried situations that could go wrong: lost replies, a payment arriving twice, parents saying they paid when they had not, requests for a waiver or a refund, and parents trying to trick the agent.",
    yourLimits: "Your limits", paidRule: "No reminder once Razorpay's record shows a fee paid", paidRuleUpi: "No reminder once you have marked a fee paid", fees: (items) => `Monthly fees: ${items}`,
    due: (day, grace) => `Each fee is due on day ${day} of the month, with ${grace} grace days`, lateFee: (amount) => `A late fee of ${amount}, added once, after the grace days, if the fee is still unpaid`, noLateFee: "No late fee",
    reminders: (days, hour, most) => `Reminders go at ${hour}:00 on these days from the due day (a minus means before it): ${days}; at most ${most} for one fee in a month`,
    partPayments: (least) => `Part payments are allowed, from ${least}`, noPartPayments: "Part payments are not allowed",
    waiver: (amount) => `Taking off more than ${amount} in all from one student's month only with your OK`, noWaiver: "Every request to take money off a fee goes to you",
    refund: (amount) => `Refunds above ${amount} only with your OK`, students: (count) => `${count} students on the list`,
    notAGrade: "This counts the situations tried. It does not grade the agent.", didNotHold: "Did not hold",
    handRunLine: "Checks were run by hand against stand-in services, not real WhatsApp or payments. Test money only.", checkedOn: "Checks run on",
  },
  goLive: {
    heading: "Go-live checks",
    own: (date) => `The go-live checks ran on this centre's own settings, in the go-live certificate of ${date}.`,
    example: (date) => `The go-live certificate of ${date} says its checks ran on the example centre, Bright Tuition Centre, not on this centre's own settings.`,
    different: (date) => `The go-live certificate of ${date} says its checks ran on different settings from this centre's, so it does not show how this centre's own settings behave.`,
    untrusted: "A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used.",
    none: "No go-live certificate was given, so this document does not say what the go-live checks ran on.",
    signedWith: (key) => `The go-live certificate is signed with ${key}. A key does not show who holds it.`,
  },
  page: {
    numbers: "The numbers", item: "What", count: "How many", amount: "Amount", moneyHeading: "Money", opened: "Fees opened for the month", paidInFull: "Paid in full", partlyPaid: "Part paid", stillOpen: "Still open",
    waiversHeading: "What was taken off", byOwner: "Approved by you", withinLimit: "Within your limit, done by the agent", lateFees: "Late fees", lateFeesAdded: "Late fees added",
    messagesHeading: "Messages sent", remindersToParents: "Reminders to parents", receiptsToParents: "Receipts to parents", toYou: "To you, the owner", heldBack: "Held back before sending",
    stoppedHeading: "What your limits stopped", rule: "Limit", times: "Times", stoppedParents: "Parents who sent STOP", notCountedHeading: "Not counted", notTestedHeading: "Not tested", unconfirmed: "Left unconfirmed or failed",
    checkHeading: "Check this document", code: "Code", digest: "Digest", countedFrom: "Counted from", setUpBy: "Set up by", madeOn: "Made on", signedBy: "Signed by", notSigned: "Not signed", scanToCheck: "Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your partner or Geometer's team gave you.", signatureNote: "A signature shows who made this document and that it has not changed. It does not show that what it counts is complete.",
    notAGrade: "These are counts of what the record shows. They do not grade the agent.", period: "Period",
    showWhatWeDid: "Show what we did ▸", byActionHeading: "What the agent did, by action", action: "Action", agentVersion: "Agent version", limitsDigest: "Limits digest", recordDigest: "Record digest", liveServices: "Live services",
  },
};

export const hi: Strings = {
  agent: "फीस एजेंट", monthlyReport: "मासिक रिपोर्ट", goLiveCertificate: "चालू करने से पहले का जाँच प्रमाणपत्र", fullReport: "पूरी रिपोर्ट",
  label: { collected: "जमा हुआ", stillToCollect: "अभी लेना बाकी", givenBack: "वापस किया", takenOff: "फीस से घटाया", wasAsked: "आपसे पूछा गया", approved: "आपने मंज़ूर किया", saidNo: "आपने मना किया", remindersSent: "भेजी गई याद", stoppedByLimits: "आपकी सीमाओं ने रोका", notChecked: "जाँचा नहीं गया", students: "विद्यार्थी" },
  stop: {
    "no-reminder-once-paid": "भुगतान के बाद याद", "reminder-cap": "सीमा से ज़्यादा याद", "waiver-limit": "बकाया से ज़्यादा की छूट", "fee-link-matches-record": "गलत रकम के लिंक", "refund-limit": "भरी रकम से ज़्यादा का रिफंड",
    "one-refund-per-payment": "एक भुगतान का दूसरा रिफंड", "paid-only-when-recorded": "बिना रिकॉर्ड के \"भुगतान हो गया\"", "message-matches-record": "रिकॉर्ड से न मिलने वाले संदेश", "opt-out": "STOP के बाद संदेश",
  },
  handRun: "जाँच हाथ से की गई।",
  sourceTag: { "stand-in": "अभ्यास वाले नकली सिस्टम, टेस्ट पैसा", "test-mode": "टेस्ट मोड, टेस्ट पैसा", live: "" },
  more: (n) => `और ${n} बातें (पूरी रिपोर्ट में)`,
  notChecked: { cash: "नकद या बैंक ट्रांसफर से दी गई फीस", upi: "Razorpay के बाहर के भुगतान", whatsapp: "असली WhatsApp", razorpay: "असली Razorpay", review: "शब्दों की किसी मूल भाषी से जाँच" },
  languageName: { hi: "हिंदी", en: "अंग्रेज़ी", ml: "मलयालम", kn: "कन्नड़" },
  upiLabel: { collected: "मालिक द्वारा मिला हुआ दर्ज", givenBack: "मालिक द्वारा भेजा हुआ दर्ज रिफंड", notChecked: "भुगतान की अपने-आप जाँच (UPI में हर भुगतान आप दर्ज करते हैं)" },
  notTested: {
    "upi-not-automatic": "भुगतान की अपने-आप जाँच: UPI में हर भुगतान मालिक खुद मिला हुआ दर्ज करते हैं", "real-upi": "असली UPI ऐप से असली UPI ID पर भुगतान (मालिक का दर्ज करना आज़माया गया, भुगतान नहीं)",
    "cash-and-bank-transfers": "नकद या बैंक ट्रांसफर से दी गई फीस (जो अभिभावक ऐसा कहे उसे मालिक के पास भेजा जाता है; कुछ भी \"भरा हुआ\" नहीं माना जाता)",
    "payments-outside-razorpay": "Razorpay के बाहर के भुगतान (यह सेंटर Razorpay से लेता है)",
    "real-whatsapp": "असली WhatsApp",
    "real-razorpay": "असली Razorpay (टेस्ट मोड या लाइव)",
    "webhook-signatures": "वेबहुक के हस्ताक्षर",
    "real-model": "असली AI मॉडल (नियम और नकली मॉडल चलाए गए; संदेश तय साँचे वाले हैं)",
    "other-languages": "तमिल, तेलुगु और दूसरी भाषाएँ",
    "native-review": "मलयालम और कन्नड़ के शब्दों की किसी मूल भाषी से जाँच",
    "restart-mid-step": "किसी कदम के बीच में क्रैश या रीस्टार्ट",
    "same-instant": "ठीक एक ही पल में दो अभिभावक",
    "two-children-one-message": "दो बच्चों के बारे में एक ही संदेश (सबसे पुरानी खुली फीस का जवाब दिया जाता है)",
    "other-faults": "हाथ की जाँच में बताई गई गड़बड़ियों से अलग गड़बड़ियाँ",
    "own-settings": "ये जाँचें इस सेंटर की अपनी सेटिंग पर (चालू करने से पहले का जाँच प्रमाणपत्र कहता है कि वे उदाहरण सेंटर Bright Tuition Centre पर चली थीं)",
    "other-settings": "ये जाँचें इस सेंटर की अपनी सेटिंग पर (जाँच प्रमाणपत्र कहता है कि वे अलग सेटिंग पर चली थीं)",
    "no-go-live-certificate": "ये जाँचें इस सेंटर की अपनी सेटिंग पर (कोई जाँच प्रमाणपत्र नहीं दिया गया)",
    "go-live-untrusted": "ये जाँचें इस सेंटर की अपनी सेटिंग पर (जो जाँच प्रमाणपत्र दिया गया उस पर भरोसा नहीं किया जा सका, इसलिए उसे इस्तेमाल नहीं किया गया)",
    "situations-skipped": "वे स्थितियाँ जो इन सेटिंग पर चल नहीं सकीं (जाँच प्रमाणपत्र में उनके नाम हैं)",
  },
  notCounted: {
    "cash-and-transfers": "नकद या बैंक ट्रांसफर से दी गई फीस: रिकॉर्ड में सिर्फ़ Razorpay के भुगतान हैं",
    "read-receipts": "अभिभावक ने संदेश पढ़ा या नहीं",
    "outside-agent": "एजेंट के बाहर किया गया कोई भी काम (आपने या किसी और ने Razorpay या WhatsApp में किया)",
    "cash-and-transfers-upi": "नकद या बैंक ट्रांसफर से दी गई फीस: रिकॉर्ड में सिर्फ़ वे भुगतान हैं जिन्हें आपने मिला हुआ दर्ज किया",
    "outside-agent-upi": "एजेंट के बाहर किया गया कोई भी काम (आपने या किसी और ने अपने UPI ऐप या WhatsApp में किया)",
    "rule-breaks": "वे नियम-उल्लंघन जो एजेंट ने देखे नहीं: रिकॉर्ड में वही है जो एजेंट ने किया या जिससे उसे रोका गया",
  },
  cert: {
    date: "तारीख़", held: (h, t, f, n) => `${t} में से ${h} स्थितियाँ ठीक रहीं। ${f} में गड़बड़ हुई। ${n} बातें जाँची नहीं गईं।`,
    intro: "चालू करने से पहले हमने वे स्थितियाँ आज़माईं जो गलत हो सकती थीं: खोए हुए जवाब, दो बार आया भुगतान, बिना भरे \"भर दिया\" कहने वाले अभिभावक, छूट या रिफंड की माँग, और एजेंट को चकमा देने वाले अभिभावक।",
    yourLimits: "आपकी सीमाएँ", paidRule: "Razorpay का रिकॉर्ड फीस भरी दिखाए तो उसके बाद कोई याद नहीं", paidRuleUpi: "आप फीस को भरी हुई दर्ज कर दें तो उसके बाद कोई याद नहीं", fees: (items) => `मासिक फीस: ${items}`,
    due: (day, grace) => `हर फीस महीने की ${day} तारीख़ को देय है, ${grace} दिन की छूट अवधि के साथ`, lateFee: (amount) => `छूट अवधि के बाद भी फीस न भरी हो तो ${amount} की देर की फीस, एक बार जुड़ती है`, noLateFee: "देर की कोई फीस नहीं",
    reminders: (days, hour, most) => `याद के संदेश ${hour}:00 बजे जाते हैं, देय तारीख़ से इन दिनों पर (ऋण का चिह्न यानी उससे पहले): ${days}; एक फीस के लिए महीने में ज़्यादा से ज़्यादा ${most}`,
    partPayments: (least) => `आंशिक भुगतान की अनुमति है, ${least} से`, noPartPayments: "आंशिक भुगतान की अनुमति नहीं है",
    waiver: (amount) => `एक विद्यार्थी के एक महीने में कुल ${amount} से ज़्यादा घटाना सिर्फ़ आपसे पूछकर`, noWaiver: "फीस घटाने की हर माँग आपके पास आती है",
    refund: (amount) => `${amount} से ऊपर का रिफंड आपसे पूछकर`, students: (count) => `सूची में ${count} विद्यार्थी`,
    notAGrade: "यह आज़माई गई स्थितियों की गिनती है। यह एजेंट को अंक या दर्जा नहीं देती।", didNotHold: "जिनमें गड़बड़ हुई",
    handRunLine: "जाँच हाथ से की गई, असली WhatsApp या पेमेंट पर नहीं, बल्कि अभ्यास वाले नकली सिस्टम (stand-in services) पर। सिर्फ़ टेस्ट पैसा।", checkedOn: "जाँच इन पर की गई",
  },
  goLive: {
    heading: "चालू करने से पहले की जाँच",
    own: (date) => `चालू करने से पहले की जाँच इसी सेंटर की अपनी सेटिंग पर चली थी, ${date} के जाँच प्रमाणपत्र के अनुसार।`,
    example: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच उदाहरण सेंटर Bright Tuition Centre पर चली थी, इस सेंटर की अपनी सेटिंग पर नहीं।`,
    different: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच इस सेंटर से अलग सेटिंग पर चली थी, इसलिए उससे इस सेंटर की अपनी सेटिंग का हाल पता नहीं चलता।`,
    untrusted: "एक जाँच प्रमाणपत्र दिया गया था, पर उस पर भरोसा नहीं किया जा सका (उस पर हस्ताक्षर नहीं है, हस्ताक्षर नहीं बैठता, या वह इस एजेंट का जाँच प्रमाणपत्र है ही नहीं), इसलिए उसे इस्तेमाल नहीं किया गया।",
    none: "कोई जाँच प्रमाणपत्र नहीं दिया गया, इसलिए यह दस्तावेज़ नहीं बताता कि चालू करने से पहले की जाँच किस सेटिंग पर चली थी।",
    signedWith: (key) => `जाँच प्रमाणपत्र पर ${key} कुंजी से हस्ताक्षर हैं। कुंजी यह नहीं बताती कि वह किसके पास है।`,
  },
  page: {
    numbers: "आँकड़े", item: "क्या", count: "कितने", amount: "रकम", moneyHeading: "पैसा", opened: "इस महीने खोली गई फीस", paidInFull: "पूरी भरी गई", partlyPaid: "आधी भरी गई", stillOpen: "अभी खुली",
    waiversHeading: "क्या घटाया गया", byOwner: "आपने मंज़ूर की", withinLimit: "आपकी सीमा के अंदर, एजेंट ने की", lateFees: "देर की फीस", lateFeesAdded: "जोड़ी गई देर की फीस",
    messagesHeading: "भेजे गए संदेश", remindersToParents: "अभिभावकों को याद", receiptsToParents: "अभिभावकों को रसीद", toYou: "आपको, मालिक को", heldBack: "भेजने से पहले रोके गए",
    stoppedHeading: "आपकी सीमाओं ने क्या रोका", rule: "सीमा", times: "बार", stoppedParents: "STOP भेजने वाले अभिभावक", notCountedHeading: "गिना नहीं गया", notTestedHeading: "जाँचा नहीं गया", unconfirmed: "जो पक्का नहीं हुआ या नहीं हो पाया",
    checkHeading: "इस दस्तावेज़ को जाँचें", code: "कोड", digest: "डाइजेस्ट", countedFrom: "कहाँ से गिना", setUpBy: "तैयार किया", madeOn: "बनाया गया", signedBy: "हस्ताक्षर", notSigned: "हस्ताक्षर नहीं", scanToCheck: "इस दस्तावेज़ को geometer.dev पर जाँचने के लिए स्कैन करें। इसकी .json फ़ाइल चाहिए होगी। जाँच आपके ब्राउज़र में होती है, कुछ भेजा नहीं जाता। लिंक में हस्ताक्षर की कुंजी नहीं है: किसने हस्ताक्षर किए यह जानने के लिए यहाँ दिखी कुंजी को उस कुंजी से मिलाएँ जो आपके पार्टनर या Geometer की टीम ने दी है।", signatureNote: "हस्ताक्षर दिखाता है कि यह दस्तावेज़ किसने बनाया और यह बदला नहीं है। यह नहीं दिखाता कि इसमें गिनी गई बातें पूरी हैं।",
    notAGrade: "ये रिकॉर्ड में दिखी बातों की गिनती हैं। ये एजेंट को अंक या दर्जा नहीं देतीं।", period: "अवधि",
    showWhatWeDid: "देखें हमने क्या किया ▸", byActionHeading: "एजेंट ने क्या किया, काम के हिसाब से", action: "काम", agentVersion: "एजेंट का संस्करण", limitsDigest: "सीमाओं का डाइजेस्ट", recordDigest: "रिकॉर्ड का डाइजेस्ट", liveServices: "असली सिस्टम",
  },
};

export const ml: Strings = {
  agent: "ഫീസ് ഏജന്റ്", monthlyReport: "പ്രതിമാസ റിപ്പോർട്ട്", goLiveCertificate: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനാ സർട്ടിഫിക്കറ്റ്", fullReport: "പൂർണ്ണ റിപ്പോർട്ട്",
  label: { collected: "പിരിഞ്ഞത്", stillToCollect: "ഇനിയും പിരിക്കാനുള്ളത്", givenBack: "തിരികെ നൽകിയത്", takenOff: "ഫീസിൽ നിന്ന് കുറച്ചത്", wasAsked: "നിങ്ങളോട് ചോദിച്ചു", approved: "നിങ്ങൾ അംഗീകരിച്ചു", saidNo: "നിങ്ങൾ വേണ്ടെന്ന് പറഞ്ഞു", remindersSent: "അയച്ച ഓർമ്മപ്പെടുത്തലുകൾ", stoppedByLimits: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", notChecked: "പരിശോധിക്കാത്തത്", students: "വിദ്യാർത്ഥികൾ" },
  stop: {
    "no-reminder-once-paid": "പണമടച്ചതിനു ശേഷമുള്ള ഓർമ്മപ്പെടുത്തൽ", "reminder-cap": "പരിധിയിൽ കൂടുതൽ ഓർമ്മപ്പെടുത്തൽ", "waiver-limit": "ബാക്കിയുള്ളതിലും കൂടുതലുള്ള ഇളവ്", "fee-link-matches-record": "തെറ്റായ തുകയുടെ ലിങ്ക്", "refund-limit": "അടച്ചതിൽ കൂടുതലുള്ള റീഫണ്ട്",
    "one-refund-per-payment": "ഒരു പേയ്മെന്റിന്റെ രണ്ടാം റീഫണ്ട്", "paid-only-when-recorded": "രേഖയില്ലാത്ത \"അടച്ചു\"", "message-matches-record": "രേഖയുമായി ചേരാത്ത സന്ദേശങ്ങൾ", "opt-out": "STOP-ന് ശേഷമുള്ള സന്ദേശങ്ങൾ",
  },
  handRun: "പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തു.",
  sourceTag: { "stand-in": "പരിശീലന സംവിധാനങ്ങൾ, ടെസ്റ്റ് പണം", "test-mode": "ടെസ്റ്റ് മോഡ്, ടെസ്റ്റ് പണം", live: "" },
  more: (n) => `കൂടാതെ ${n} കാര്യങ്ങൾ (മുഴുവൻ റിപ്പോർട്ടിൽ)`,
  notChecked: { cash: "പണമായോ ബാങ്ക് ട്രാൻസ്ഫറായോ അടച്ച ഫീസ്", upi: "Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ", whatsapp: "യഥാർത്ഥ WhatsApp", razorpay: "യഥാർത്ഥ Razorpay", review: "വാക്കുകളെക്കുറിച്ച് ഒരു മാതൃഭാഷക്കാരന്റെ പരിശോധന" },
  languageName: { hi: "ഹിന്ദി", en: "ഇംഗ്ലീഷ്", ml: "മലയാളം", kn: "കന്നഡ" },
  upiLabel: { collected: "ഉടമ കിട്ടിയതായി രേഖപ്പെടുത്തിയത്", givenBack: "ഉടമ അയച്ചതായി രേഖപ്പെടുത്തിയ റീഫണ്ട്", notChecked: "പണമടവ് സ്വയം പരിശോധിക്കൽ (UPI-യിൽ ഓരോ പണമടവും നിങ്ങൾ രേഖപ്പെടുത്തുന്നു)" },
  notTested: {
    "upi-not-automatic": "പണമടവ് സ്വയം പരിശോധിക്കൽ: UPI-യിൽ ഓരോ പണമടവും ഉടമ തന്നെ കിട്ടിയതായി രേഖപ്പെടുത്തുന്നു", "real-upi": "യഥാർത്ഥ UPI ആപ്പിൽ നിന്ന് യഥാർത്ഥ UPI ID-യിലേക്കുള്ള പണമടവ് (ഉടമയുടെ രേഖപ്പെടുത്തലാണ് പരീക്ഷിച്ചത്, പണമടവല്ല)",
    "cash-and-bank-transfers": "പണമായോ ബാങ്ക് ട്രാൻസ്ഫറായോ അടച്ച ഫീസ് (അങ്ങനെ പറയുന്ന രക്ഷിതാവിനെ ഉടമയുടെ അടുത്തേക്ക് അയയ്ക്കുന്നു; ഒന്നും \"അടച്ചു\" എന്ന് രേഖപ്പെടുത്തുന്നില്ല)",
    "payments-outside-razorpay": "Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ (ഈ സെന്റർ Razorpay വഴി വാങ്ങുന്നു)",
    "real-whatsapp": "യഥാർത്ഥ WhatsApp",
    "real-razorpay": "യഥാർത്ഥ Razorpay (ടെസ്റ്റ് മോഡ് അല്ലെങ്കിൽ ലൈവ്)",
    "webhook-signatures": "വെബ്ഹുക്ക് ഒപ്പുകൾ",
    "real-model": "യഥാർത്ഥ AI മോഡൽ (നിയമങ്ങളും മാതൃകാ മോഡലുകളും ഓടിച്ചു; സന്ദേശങ്ങൾ നിശ്ചിത ടെംപ്ലേറ്റുകളാണ്)",
    "other-languages": "തമിഴ്, തെലുങ്ക്, മറ്റ് ഭാഷകൾ",
    "native-review": "മലയാളം, കന്നഡ വാക്കുകളെക്കുറിച്ച് മാതൃഭാഷക്കാരുടെ പരിശോധന",
    "restart-mid-step": "ഒരു ഘട്ടത്തിന്റെ നടുവിൽ ക്രാഷ് അല്ലെങ്കിൽ റീസ്റ്റാർട്ട്",
    "same-instant": "ഒരേ നിമിഷത്തിൽ രണ്ട് രക്ഷിതാക്കൾ",
    "two-children-one-message": "രണ്ട് കുട്ടികളെക്കുറിച്ച് ഒരൊറ്റ സന്ദേശം (ഏറ്റവും പഴയ തുറന്ന ഫീസിനാണ് മറുപടി)",
    "other-faults": "കൈ പരിശോധനയിൽ പറഞ്ഞ തകരാറുകൾക്ക് പുറത്തുള്ള തകരാറുകൾ",
    "own-settings": "ഈ പരിശോധനകൾ ഈ സെന്ററിന്റെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അവ ഉദാഹരണ സെന്ററായ Bright Tuition Centre-ൽ നടത്തി എന്നാണ്)",
    "other-settings": "ഈ പരിശോധനകൾ ഈ സെന്ററിന്റെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അവ വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിൽ നടത്തി എന്നാണ്)",
    "no-go-live-certificate": "ഈ പരിശോധനകൾ ഈ സെന്ററിന്റെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല)",
    "go-live-untrusted": "ഈ പരിശോധനകൾ ഈ സെന്ററിന്റെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (നൽകിയ പരിശോധനാ സർട്ടിഫിക്കറ്റ് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഉപയോഗിച്ചില്ല)",
    "situations-skipped": "ഈ ക്രമീകരണങ്ങളിൽ നടത്താൻ കഴിയാത്ത സാഹചര്യങ്ങൾ (പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ അവയുടെ പേരുകളുണ്ട്)",
  },
  notCounted: {
    "cash-and-transfers": "പണമായോ ബാങ്ക് ട്രാൻസ്ഫറായോ അടച്ച ഫീസ്: രേഖയിൽ Razorpay പേയ്മെന്റുകൾ മാത്രമേയുള്ളൂ",
    "read-receipts": "രക്ഷിതാവ് സന്ദേശം വായിച്ചോ ഇല്ലയോ",
    "outside-agent": "ഏജന്റിന് പുറത്ത് ചെയ്ത എന്തും (നിങ്ങളോ മറ്റാരെങ്കിലുമോ Razorpay-യിലോ WhatsApp-ലോ ചെയ്തത്)",
    "cash-and-transfers-upi": "പണമായോ ബാങ്ക് ട്രാൻസ്ഫറായോ അടച്ച ഫീസ്: നിങ്ങൾ കിട്ടിയതായി രേഖപ്പെടുത്തിയ പേയ്മെന്റുകൾ മാത്രമേ രേഖയിലുള്ളൂ",
    "outside-agent-upi": "ഏജന്റിന് പുറത്ത് ചെയ്ത എന്തും (നിങ്ങളോ മറ്റാരെങ്കിലുമോ നിങ്ങളുടെ UPI ആപ്പിലോ WhatsApp-ലോ ചെയ്തത്)",
    "rule-breaks": "ഏജന്റ് കാണാത്ത നിയമലംഘനങ്ങൾ: ഏജന്റ് ചെയ്തതും തടഞ്ഞതും മാത്രമാണ് രേഖയിലുള്ളത്",
  },
  cert: {
    date: "തീയതി", held: (h, t, f, n) => `${t} സാഹചര്യങ്ങളിൽ ${h} എണ്ണം ശരിയായി നിന്നു. ${f} എണ്ണം പിഴച്ചു. ${n} കാര്യങ്ങൾ പരിശോധിച്ചിട്ടില്ല.`,
    intro: "തുടങ്ങുന്നതിന് മുമ്പ് തെറ്റാൻ സാധ്യതയുള്ള സാഹചര്യങ്ങൾ ഞങ്ങൾ പരീക്ഷിച്ചു: നഷ്ടപ്പെട്ട മറുപടികൾ, രണ്ടുതവണ വന്ന പേയ്മെന്റ്, അടയ്ക്കാതെ \"അടച്ചു\" എന്ന് പറയുന്ന രക്ഷിതാക്കൾ, ഇളവിനോ റീഫണ്ടിനോ ഉള്ള അഭ്യർത്ഥനകൾ, ഏജന്റിനെ കബളിപ്പിക്കാൻ ശ്രമിക്കുന്ന രക്ഷിതാക്കൾ.",
    yourLimits: "നിങ്ങളുടെ പരിധികൾ", paidRule: "Razorpay-യുടെ രേഖയിൽ ഫീസ് അടച്ചതായി കണ്ടാൽ പിന്നെ ഓർമ്മപ്പെടുത്തൽ ഇല്ല", paidRuleUpi: "ഫീസ് അടച്ചതായി നിങ്ങൾ രേഖപ്പെടുത്തിയാൽ പിന്നെ ഓർമ്മപ്പെടുത്തൽ ഇല്ല", fees: (items) => `പ്രതിമാസ ഫീസ്: ${items}`,
    due: (day, grace) => `ഓരോ ഫീസും മാസത്തിലെ ${day}-ാം തീയതി അടയ്ക്കണം, ${grace} ദിവസത്തെ ഇളവ് സമയത്തോടെ`, lateFee: (amount) => `ഇളവ് സമയത്തിന് ശേഷവും ഫീസ് അടച്ചിട്ടില്ലെങ്കിൽ ${amount} വൈകിയ ഫീസ്, ഒരു തവണ ചേർക്കും`, noLateFee: "വൈകിയ ഫീസ് ഇല്ല",
    reminders: (days, hour, most) => `ഓർമ്മപ്പെടുത്തലുകൾ ${hour}:00-ന് പോകും, അവസാന തീയതിയിൽ നിന്നുള്ള ഈ ദിവസങ്ങളിൽ (മൈനസ് എന്നാൽ അതിന് മുമ്പ്): ${days}; ഒരു ഫീസിന് ഒരു മാസത്തിൽ പരമാവധി ${most}`,
    partPayments: (least) => `ഭാഗികമായി അടയ്ക്കാം, ${least} മുതൽ`, noPartPayments: "ഭാഗികമായി അടയ്ക്കാൻ അനുവാദമില്ല",
    waiver: (amount) => `ഒരു വിദ്യാർത്ഥിയുടെ ഒരു മാസത്തിൽ ആകെ ${amount}-ൽ കൂടുതൽ കുറയ്ക്കുന്നത് നിങ്ങളോട് ചോദിച്ച ശേഷം മാത്രം`, noWaiver: "ഫീസ് കുറയ്ക്കാനുള്ള ഓരോ അഭ്യർത്ഥനയും നിങ്ങളുടെ അടുത്തേക്ക് വരും",
    refund: (amount) => `${amount}-ന് മുകളിലുള്ള റീഫണ്ട് നിങ്ങളോട് ചോദിച്ച ശേഷം മാത്രം`, students: (count) => `ലിസ്റ്റിൽ ${count} വിദ്യാർത്ഥികൾ`,
    notAGrade: "ഇത് പരീക്ഷിച്ച സാഹചര്യങ്ങളുടെ എണ്ണം മാത്രമാണ്. ഇത് ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", didNotHold: "പിഴച്ചവ",
    handRunLine: "പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തത് യഥാർത്ഥ WhatsApp, പേയ്മെന്റ് എന്നിവയിലല്ല, പരിശീലന സംവിധാനങ്ങളിലാണ് (stand-in services). ടെസ്റ്റ് പണം മാത്രം.", checkedOn: "പരിശോധിച്ചത്",
  },
  goLive: {
    heading: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധന",
    own: (date) => `തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഈ സെന്ററിന്റെ സ്വന്തം ക്രമീകരണങ്ങളിൽ തന്നെയാണ് നടത്തിയത്, ${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പ്രകാരം.`,
    example: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഉദാഹരണ സെന്ററായ Bright Tuition Centre-ൽ ആണ് നടത്തിയത് എന്നാണ്, ഈ സെന്ററിന്റെ സ്വന്തം ക്രമീകരണങ്ങളിൽ അല്ല.`,
    different: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഈ സെന്ററിന്റേതിൽ നിന്ന് വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിലാണ് നടത്തിയത് എന്നാണ്, അതിനാൽ ഈ സെന്ററിന്റെ സ്വന്തം ക്രമീകരണങ്ങൾ എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് അത് കാണിക്കുന്നില്ല.`,
    untrusted: "ഒരു പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിരുന്നു, പക്ഷേ അത് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല (അതിൽ ഒപ്പില്ല, ഒപ്പ് ചേരുന്നില്ല, അല്ലെങ്കിൽ അത് ഈ ഏജന്റിന്റെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് അല്ല), അതിനാൽ ഉപയോഗിച്ചില്ല.",
    none: "പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല, അതിനാൽ തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഏത് ക്രമീകരണങ്ങളിലാണ് നടത്തിയതെന്ന് ഈ രേഖ പറയുന്നില്ല.",
    signedWith: (key) => `പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ ഒപ്പിട്ടത് ${key} എന്ന കീ ഉപയോഗിച്ചാണ്. ആ കീ ആരുടെ കൈയിലാണെന്ന് കീ കാണിക്കുന്നില്ല.`,
  },
  page: {
    numbers: "കണക്കുകൾ", item: "എന്ത്", count: "എത്ര", amount: "തുക", moneyHeading: "പണം", opened: "ഈ മാസം തുറന്ന ഫീസുകൾ", paidInFull: "പൂർണ്ണമായി അടച്ചത്", partlyPaid: "ഭാഗികമായി അടച്ചത്", stillOpen: "ഇനിയും തുറന്നിരിക്കുന്നത്",
    waiversHeading: "കുറച്ചത്", byOwner: "നിങ്ങൾ അംഗീകരിച്ചത്", withinLimit: "നിങ്ങളുടെ പരിധിക്കുള്ളിൽ ഏജന്റ് ചെയ്തത്", lateFees: "വൈകിയ ഫീസ്", lateFeesAdded: "ചേർത്ത വൈകിയ ഫീസ്",
    messagesHeading: "അയച്ച സന്ദേശങ്ങൾ", remindersToParents: "രക്ഷിതാക്കൾക്കുള്ള ഓർമ്മപ്പെടുത്തലുകൾ", receiptsToParents: "രക്ഷിതാക്കൾക്കുള്ള രസീതുകൾ", toYou: "നിങ്ങൾക്ക്, ഉടമയ്ക്ക്", heldBack: "അയയ്ക്കുന്നതിന് മുമ്പ് തടഞ്ഞത്",
    stoppedHeading: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", rule: "പരിധി", times: "തവണ", stoppedParents: "STOP അയച്ച രക്ഷിതാക്കൾ", notCountedHeading: "എണ്ണാത്തത്", notTestedHeading: "പരിശോധിക്കാത്തത്", unconfirmed: "ഉറപ്പാകാത്തതോ പരാജയപ്പെട്ടതോ",
    checkHeading: "ഈ രേഖ പരിശോധിക്കുക", code: "കോഡ്", digest: "ഡൈജസ്റ്റ്", countedFrom: "എവിടെ നിന്ന് എണ്ണി", setUpBy: "തയ്യാറാക്കിയത്", madeOn: "ഉണ്ടാക്കിയ തീയതി", signedBy: "ഒപ്പിട്ടത്", notSigned: "ഒപ്പിട്ടിട്ടില്ല", scanToCheck: "ഈ രേഖ geometer.dev-ൽ പരിശോധിക്കാൻ സ്കാൻ ചെയ്യുക. ഇതിന്റെ .json ഫയൽ വേണ്ടിവരും. പരിശോധന നിങ്ങളുടെ ബ്രൗസറിൽ നടക്കുന്നു, ഒന്നും അയയ്ക്കുന്നില്ല. ലിങ്കിൽ ഒപ്പിട്ട കീ ഇല്ല: ആര് ഒപ്പിട്ടു എന്നറിയാൻ ഇവിടെ കാണുന്ന കീ, നിങ്ങളുടെ പങ്കാളിയോ Geometer ടീമോ തന്ന കീയുമായി ഒത്തുനോക്കുക.", signatureNote: "ഈ രേഖ ആരാണ് ഉണ്ടാക്കിയതെന്നും അത് മാറിയിട്ടില്ലെന്നും ഒപ്പ് കാണിക്കുന്നു. ഇതിൽ എണ്ണിയതെല്ലാം പൂർണ്ണമാണെന്ന് അത് കാണിക്കുന്നില്ല.",
    notAGrade: "ഇവ രേഖയിൽ കാണുന്നതിന്റെ എണ്ണം മാത്രമാണ്. ഇവ ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", period: "കാലയളവ്",
    showWhatWeDid: "ഞങ്ങൾ ചെയ്തത് കാണിക്കുക ▸", byActionHeading: "ഏജന്റ് ചെയ്തത്, പ്രവൃത്തി അനുസരിച്ച്", action: "പ്രവൃത്തി", agentVersion: "ഏജന്റ് പതിപ്പ്", limitsDigest: "പരിധികളുടെ ഡൈജസ്റ്റ്", recordDigest: "രേഖയുടെ ഡൈജസ്റ്റ്", liveServices: "യഥാർത്ഥ സംവിധാനങ്ങൾ",
  },
};

export const kn: Strings = {
  agent: "ಶುಲ್ಕ ಏಜೆಂಟ್", monthlyReport: "ಮಾಸಿಕ ವರದಿ", goLiveCertificate: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ", fullReport: "ಪೂರ್ಣ ವರದಿ",
  label: { collected: "ಸಂಗ್ರಹವಾದದ್ದು", stillToCollect: "ಇನ್ನೂ ಸಂಗ್ರಹಿಸಬೇಕಾದದ್ದು", givenBack: "ಮರಳಿ ಕೊಟ್ಟದ್ದು", takenOff: "ಶುಲ್ಕದಿಂದ ಕಡಿಮೆ ಮಾಡಿದ್ದು", wasAsked: "ನಿಮ್ಮನ್ನು ಕೇಳಲಾಯಿತು", approved: "ನೀವು ಒಪ್ಪಿದ್ದು", saidNo: "ನೀವು ಬೇಡ ಎಂದದ್ದು", remindersSent: "ಕಳುಹಿಸಿದ ನೆನಪುಗಳು", stoppedByLimits: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", notChecked: "ಪರಿಶೀಲಿಸದ್ದು", students: "ವಿದ್ಯಾರ್ಥಿಗಳು" },
  stop: {
    "no-reminder-once-paid": "ಪಾವತಿಯ ನಂತರದ ನೆನಪು", "reminder-cap": "ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನ ನೆನಪು", "waiver-limit": "ಬಾಕಿಗಿಂತ ಹೆಚ್ಚಿನ ರಿಯಾಯಿತಿ", "fee-link-matches-record": "ತಪ್ಪು ಮೊತ್ತದ ಲಿಂಕ್", "refund-limit": "ಪಾವತಿಸಿದ್ದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್",
    "one-refund-per-payment": "ಒಂದು ಪಾವತಿಯ ಎರಡನೇ ರೀಫಂಡ್", "paid-only-when-recorded": "ದಾಖಲೆ ಇಲ್ಲದ \"ಪಾವತಿಯಾಗಿದೆ\"", "message-matches-record": "ದಾಖಲೆಗೆ ಹೊಂದದ ಸಂದೇಶಗಳು", "opt-out": "STOP ನಂತರದ ಸಂದೇಶಗಳು",
  },
  handRun: "ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.",
  sourceTag: { "stand-in": "ಅಭ್ಯಾಸದ ನಕಲಿ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ", "test-mode": "ಟೆಸ್ಟ್ ಮೋಡ್, ಟೆಸ್ಟ್ ಹಣ", live: "" },
  more: (n) => `ಇನ್ನೂ ${n} ವಿಷಯಗಳು (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ)`,
  notChecked: { cash: "ನಗದು ಅಥವಾ ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆಯಲ್ಲಿ ಕೊಟ್ಟ ಶುಲ್ಕ", upi: "Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು", whatsapp: "ನಿಜವಾದ WhatsApp", razorpay: "ನಿಜವಾದ Razorpay", review: "ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ" },
  languageName: { hi: "ಹಿಂದಿ", en: "ಇಂಗ್ಲಿಷ್", ml: "ಮಲಯಾಳಂ", kn: "ಕನ್ನಡ" },
  upiLabel: { collected: "ಮಾಲೀಕರು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದು", givenBack: "ಮಾಲೀಕರು ಕಳುಹಿಸಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ರೀಫಂಡ್", notChecked: "ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ (UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ನೀವು ದಾಖಲಿಸುತ್ತೀರಿ)" },
  notTested: {
    "upi-not-automatic": "ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ: UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರೇ ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸುತ್ತಾರೆ", "real-upi": "ನಿಜವಾದ UPI ಆ್ಯಪ್‌ನಿಂದ ನಿಜವಾದ UPI ID ಗೆ ಪಾವತಿ (ಮಾಲೀಕರ ದಾಖಲಾತಿಯನ್ನು ಪ್ರಯತ್ನಿಸಲಾಯಿತು, ಪಾವತಿಯನ್ನಲ್ಲ)",
    "cash-and-bank-transfers": "ನಗದು ಅಥವಾ ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆಯಲ್ಲಿ ಕೊಟ್ಟ ಶುಲ್ಕ (ಹಾಗೆ ಹೇಳಿದ ಪೋಷಕರನ್ನು ಮಾಲೀಕರ ಬಳಿ ಕಳುಹಿಸಲಾಗುತ್ತದೆ; ಏನನ್ನೂ \"ಪಾವತಿಯಾಗಿದೆ\" ಎಂದು ಗುರುತಿಸುವುದಿಲ್ಲ)",
    "payments-outside-razorpay": "Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು (ಈ ಸೆಂಟರ್ Razorpay ಮೂಲಕ ಪಡೆಯುತ್ತದೆ)",
    "real-whatsapp": "ನಿಜವಾದ WhatsApp",
    "real-razorpay": "ನಿಜವಾದ Razorpay (ಟೆಸ್ಟ್ ಮೋಡ್ ಅಥವಾ ಲೈವ್)",
    "webhook-signatures": "ವೆಬ್‌ಹುಕ್ ಸಹಿಗಳು",
    "real-model": "ನಿಜವಾದ AI ಮಾದರಿ (ನಿಯಮಗಳು ಮತ್ತು ನಕಲಿ ಮಾದರಿಗಳನ್ನು ಓಡಿಸಲಾಯಿತು; ಸಂದೇಶಗಳು ನಿಗದಿತ ಟೆಂಪ್ಲೇಟ್‌ಗಳು)",
    "other-languages": "ತಮಿಳು, ತೆಲುಗು ಮತ್ತು ಇತರ ಭಾಷೆಗಳು",
    "native-review": "ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡ ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ",
    "restart-mid-step": "ಒಂದು ಹಂತದ ನಡುವೆ ಕ್ರ್ಯಾಶ್ ಅಥವಾ ಮರುಪ್ರಾರಂಭ",
    "same-instant": "ಒಂದೇ ಕ್ಷಣದಲ್ಲಿ ಇಬ್ಬರು ಪೋಷಕರು",
    "two-children-one-message": "ಇಬ್ಬರು ಮಕ್ಕಳ ಬಗ್ಗೆ ಒಂದೇ ಸಂದೇಶ (ಅತ್ಯಂತ ಹಳೆಯ ತೆರೆದ ಶುಲ್ಕಕ್ಕೆ ಉತ್ತರಿಸಲಾಗುತ್ತದೆ)",
    "other-faults": "ಕೈ ಪರಿಶೀಲನೆಯಲ್ಲಿ ಹೇಳಿದ ದೋಷಗಳನ್ನು ಬಿಟ್ಟು ಬೇರೆ ದೋಷಗಳು",
    "own-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಸೆಂಟರ್‌ನ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು ಅವು ಉದಾಹರಣೆ ಸೆಂಟರ್ Bright Tuition Centre ಮೇಲೆ ನಡೆದವು ಎಂದು)",
    "other-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಸೆಂಟರ್‌ನ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು ಅವು ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು)",
    "no-go-live-certificate": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಸೆಂಟರ್‌ನ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ)",
    "go-live-untrusted": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಸೆಂಟರ್‌ನ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಕೊಟ್ಟ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ)",
    "situations-skipped": "ಈ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆಸಲಾಗದ ಸಂದರ್ಭಗಳು (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದಲ್ಲಿ ಅವುಗಳ ಹೆಸರುಗಳಿವೆ)",
  },
  notCounted: {
    "cash-and-transfers": "ನಗದು ಅಥವಾ ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆಯಲ್ಲಿ ಕೊಟ್ಟ ಶುಲ್ಕ: ದಾಖಲೆಯಲ್ಲಿ Razorpay ಪಾವತಿಗಳು ಮಾತ್ರ ಇವೆ",
    "read-receipts": "ಪೋಷಕರು ಸಂದೇಶ ಓದಿದರೇ ಇಲ್ಲವೇ",
    "outside-agent": "ಏಜೆಂಟ್ ಹೊರಗೆ ಮಾಡಿದ ಯಾವುದೇ ಕೆಲಸ (ನೀವು ಅಥವಾ ಬೇರೆಯವರು Razorpay ಅಥವಾ WhatsApp ನಲ್ಲಿ ಮಾಡಿದ್ದು)",
    "cash-and-transfers-upi": "ನಗದು ಅಥವಾ ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆಯಲ್ಲಿ ಕೊಟ್ಟ ಶುಲ್ಕ: ನೀವು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ಪಾವತಿಗಳು ಮಾತ್ರ ದಾಖಲೆಯಲ್ಲಿ ಇವೆ",
    "outside-agent-upi": "ಏಜೆಂಟ್ ಹೊರಗೆ ಮಾಡಿದ ಯಾವುದೇ ಕೆಲಸ (ನೀವು ಅಥವಾ ಬೇರೆಯವರು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ಅಥವಾ WhatsApp ನಲ್ಲಿ ಮಾಡಿದ್ದು)",
    "rule-breaks": "ಏಜೆಂಟ್ ನೋಡದ ನಿಯಮ ಉಲ್ಲಂಘನೆಗಳು: ದಾಖಲೆಯಲ್ಲಿ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು ಮತ್ತು ಅದನ್ನು ತಡೆದದ್ದು ಮಾತ್ರ ಇದೆ",
  },
  cert: {
    date: "ದಿನಾಂಕ", held: (h, t, f, n) => `${t} ಸಂದರ್ಭಗಳಲ್ಲಿ ${h} ಸರಿಯಾಗಿ ನಿಂತವು. ${f} ತಪ್ಪಿದವು. ${n} ವಿಷಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿಲ್ಲ.`,
    intro: "ಆರಂಭಿಸುವ ಮೊದಲು ತಪ್ಪಾಗಬಹುದಾದ ಸಂದರ್ಭಗಳನ್ನು ನಾವು ಪ್ರಯತ್ನಿಸಿದೆವು: ಕಳೆದುಹೋದ ಉತ್ತರಗಳು, ಎರಡು ಬಾರಿ ಬಂದ ಪಾವತಿ, ಕಟ್ಟದೆ \"ಕಟ್ಟಿದ್ದೇವೆ\" ಎನ್ನುವ ಪೋಷಕರು, ರಿಯಾಯಿತಿ ಅಥವಾ ರೀಫಂಡ್ ಕೋರಿಕೆಗಳು, ಏಜೆಂಟ್ ಅನ್ನು ಮೋಸಗೊಳಿಸಲು ಯತ್ನಿಸುವ ಪೋಷಕರು.",
    yourLimits: "ನಿಮ್ಮ ಮಿತಿಗಳು", paidRule: "Razorpay ದಾಖಲೆಯಲ್ಲಿ ಶುಲ್ಕ ಪಾವತಿಯಾಗಿದೆ ಎಂದು ಕಂಡರೆ ಆಮೇಲೆ ನೆನಪಿನ ಸಂದೇಶ ಇಲ್ಲ", paidRuleUpi: "ಶುಲ್ಕ ಪಾವತಿಯಾಗಿದೆ ಎಂದು ನೀವು ದಾಖಲಿಸಿದ ಮೇಲೆ ನೆನಪಿನ ಸಂದೇಶ ಇಲ್ಲ", fees: (items) => `ಮಾಸಿಕ ಶುಲ್ಕ: ${items}`,
    due: (day, grace) => `ಪ್ರತಿ ಶುಲ್ಕವನ್ನು ತಿಂಗಳ ${day}ನೇ ತಾರೀಖಿಗೆ ಕಟ್ಟಬೇಕು, ${grace} ದಿನಗಳ ಹೆಚ್ಚುವರಿ ಅವಧಿಯೊಂದಿಗೆ`, lateFee: (amount) => `ಹೆಚ್ಚುವರಿ ಅವಧಿಯ ನಂತರವೂ ಶುಲ್ಕ ಕಟ್ಟದಿದ್ದರೆ ${amount} ತಡ ಶುಲ್ಕ, ಒಮ್ಮೆ ಸೇರಿಸಲಾಗುತ್ತದೆ`, noLateFee: "ತಡ ಶುಲ್ಕ ಇಲ್ಲ",
    reminders: (days, hour, most) => `ನೆನಪಿನ ಸಂದೇಶಗಳು ${hour}:00 ಕ್ಕೆ ಹೋಗುತ್ತವೆ, ಕೊನೆಯ ದಿನಾಂಕದಿಂದ ಈ ದಿನಗಳಲ್ಲಿ (ಮೈನಸ್ ಎಂದರೆ ಅದಕ್ಕಿಂತ ಮೊದಲು): ${days}; ಒಂದು ಶುಲ್ಕಕ್ಕೆ ತಿಂಗಳಲ್ಲಿ ಗರಿಷ್ಠ ${most}`,
    partPayments: (least) => `ಭಾಗಶಃ ಪಾವತಿಗೆ ಅವಕಾಶ ಇದೆ, ${least} ರಿಂದ`, noPartPayments: "ಭಾಗಶಃ ಪಾವತಿಗೆ ಅವಕಾಶ ಇಲ್ಲ",
    waiver: (amount) => `ಒಬ್ಬ ವಿದ್ಯಾರ್ಥಿಯ ಒಂದು ತಿಂಗಳಲ್ಲಿ ಒಟ್ಟು ${amount} ಕ್ಕಿಂತ ಹೆಚ್ಚು ಕಡಿಮೆ ಮಾಡುವುದು ನಿಮ್ಮನ್ನು ಕೇಳಿದ ನಂತರ ಮಾತ್ರ`, noWaiver: "ಶುಲ್ಕ ಕಡಿಮೆ ಮಾಡುವ ಪ್ರತಿ ಕೋರಿಕೆಯೂ ನಿಮ್ಮ ಬಳಿಗೆ ಬರುತ್ತದೆ",
    refund: (amount) => `${amount} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್ ನಿಮ್ಮನ್ನು ಕೇಳಿದ ನಂತರ ಮಾತ್ರ`, students: (count) => `ಪಟ್ಟಿಯಲ್ಲಿ ${count} ವಿದ್ಯಾರ್ಥಿಗಳು`,
    notAGrade: "ಇದು ಪ್ರಯತ್ನಿಸಿದ ಸಂದರ್ಭಗಳ ಎಣಿಕೆ ಮಾತ್ರ. ಇದು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ಕೊಡುವುದಿಲ್ಲ.", didNotHold: "ತಪ್ಪಿದವು",
    handRunLine: "ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಿದ್ದು ನಿಜವಾದ WhatsApp ಅಥವಾ ಪಾವತಿಯ ಮೇಲೆ ಅಲ್ಲ, ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳ ಮೇಲೆ (stand-in services). ಟೆಸ್ಟ್ ಹಣ ಮಾತ್ರ.", checkedOn: "ಪರಿಶೀಲನೆ ನಡೆದದ್ದು",
  },
  goLive: {
    heading: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆ",
    own: (date) => `ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಈ ಸೆಂಟರ್‌ನ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆಯೇ ನಡೆದವು, ${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದ ಪ್ರಕಾರ.`,
    example: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಉದಾಹರಣೆ ಸೆಂಟರ್ Bright Tuition Centre ಮೇಲೆ ನಡೆದವು, ಈ ಸೆಂಟರ್‌ನ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ಅಲ್ಲ.`,
    different: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಈ ಸೆಂಟರ್‌ಗಿಂತ ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು, ಆದ್ದರಿಂದ ಈ ಸೆಂಟರ್‌ನ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.`,
    untrusted: "ಒಂದು ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಡಲಾಗಿತ್ತು, ಆದರೆ ಅದನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ (ಅದರಲ್ಲಿ ಸಹಿ ಇಲ್ಲ, ಸಹಿ ಹೊಂದುವುದಿಲ್ಲ, ಅಥವಾ ಅದು ಈ ಏಜೆಂಟ್‌ನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವೇ ಅಲ್ಲ), ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ.",
    none: "ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ, ಆದ್ದರಿಂದ ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಯಾವ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು ಈ ದಾಖಲೆ ಹೇಳುವುದಿಲ್ಲ.",
    signedWith: (key) => `ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರಕ್ಕೆ ಸಹಿ ಮಾಡಿದ್ದು ${key} ಎಂಬ ಕೀಲಿಯಿಂದ. ಆ ಕೀಲಿ ಯಾರ ಬಳಿ ಇದೆ ಎಂದು ಕೀಲಿ ತೋರಿಸುವುದಿಲ್ಲ.`,
  },
  page: {
    numbers: "ಅಂಕಿಅಂಶಗಳು", item: "ಏನು", count: "ಎಷ್ಟು", amount: "ಮೊತ್ತ", moneyHeading: "ಹಣ", opened: "ಈ ತಿಂಗಳು ತೆರೆದ ಶುಲ್ಕಗಳು", paidInFull: "ಪೂರ್ತಿ ಪಾವತಿಯಾದದ್ದು", partlyPaid: "ಭಾಗಶಃ ಪಾವತಿಯಾದದ್ದು", stillOpen: "ಇನ್ನೂ ತೆರೆದಿರುವುದು",
    waiversHeading: "ಏನು ಕಡಿಮೆ ಮಾಡಲಾಯಿತು", byOwner: "ನೀವು ಒಪ್ಪಿದ್ದು", withinLimit: "ನಿಮ್ಮ ಮಿತಿಯೊಳಗೆ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು", lateFees: "ತಡ ಶುಲ್ಕ", lateFeesAdded: "ಸೇರಿಸಿದ ತಡ ಶುಲ್ಕ",
    messagesHeading: "ಕಳುಹಿಸಿದ ಸಂದೇಶಗಳು", remindersToParents: "ಪೋಷಕರಿಗೆ ನೆನಪುಗಳು", receiptsToParents: "ಪೋಷಕರಿಗೆ ರಸೀದಿಗಳು", toYou: "ನಿಮಗೆ, ಮಾಲೀಕರಿಗೆ", heldBack: "ಕಳುಹಿಸುವ ಮೊದಲು ತಡೆದದ್ದು",
    stoppedHeading: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", rule: "ಮಿತಿ", times: "ಬಾರಿ", stoppedParents: "STOP ಕಳುಹಿಸಿದ ಪೋಷಕರು", notCountedHeading: "ಎಣಿಸದ್ದು", notTestedHeading: "ಪರಿಶೀಲಿಸದ್ದು", unconfirmed: "ದೃಢವಾಗದ ಅಥವಾ ವಿಫಲವಾದದ್ದು",
    checkHeading: "ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ", code: "ಕೋಡ್", digest: "ಡೈಜೆಸ್ಟ್", countedFrom: "ಎಲ್ಲಿಂದ ಎಣಿಸಿದ್ದು", setUpBy: "ಸಿದ್ಧಪಡಿಸಿದವರು", madeOn: "ಮಾಡಿದ ದಿನ", signedBy: "ಸಹಿ ಮಾಡಿದವರು", notSigned: "ಸಹಿ ಇಲ್ಲ", scanToCheck: "ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಇದರ .json ಫೈಲ್ ಬೇಕಾಗುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲಿಂಕ್‌ನಲ್ಲಿ ಸಹಿ ಮಾಡಿದ ಕೀ ಇಲ್ಲ: ಯಾರು ಸಹಿ ಮಾಡಿದರು ಎಂದು ತಿಳಿಯಲು ಇಲ್ಲಿ ತೋರಿಸಿದ ಕೀಯನ್ನು ನಿಮ್ಮ ಪಾಲುದಾರ ಅಥವಾ Geometer ತಂಡ ನೀಡಿದ ಕೀಯೊಂದಿಗೆ ಹೋಲಿಸಿ.", signatureNote: "ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ಮಾಡಿದರು ಮತ್ತು ಅದು ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಇದರಲ್ಲಿ ಎಣಿಸಿದ್ದೆಲ್ಲ ಪೂರ್ಣ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
    notAGrade: "ಇವು ದಾಖಲೆಯಲ್ಲಿ ಕಾಣುವ ವಿಷಯಗಳ ಎಣಿಕೆ. ಇವು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ನೀಡುವುದಿಲ್ಲ.", period: "ಅವಧಿ",
    showWhatWeDid: "ನಾವು ಮಾಡಿದ್ದನ್ನು ತೋರಿಸಿ ▸", byActionHeading: "ಏಜೆಂಟ್ ಮಾಡಿದ್ದು, ಕೆಲಸದ ಪ್ರಕಾರ", action: "ಕೆಲಸ", agentVersion: "ಏಜೆಂಟ್ ಆವೃತ್ತಿ", limitsDigest: "ಮಿತಿಗಳ ಡೈಜೆಸ್ಟ್", recordDigest: "ದಾಖಲೆಯ ಡೈಜೆಸ್ಟ್", liveServices: "ನಿಜವಾದ ವ್ಯವಸ್ಥೆಗಳು",
  },
};

export const STRINGS: Record<Language, Strings> = { hi, en, ml, kn };

/** The money labels of a report: a UPI centre's (B33) say the money was marked by the owner; a Razorpay centre's are as they were. */
export const moneyLabels = (language: Language, paidBy?: "owner-marked"): { collected: string; givenBack: string } =>
  paidBy === "owner-marked" ? STRINGS[language].upiLabel : { collected: STRINGS[language].label.collected, givenBack: STRINGS[language].label.givenBack };
