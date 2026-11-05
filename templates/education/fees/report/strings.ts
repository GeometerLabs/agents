// Every word the monthly Fees report says, per language. Nothing numeric is typed here: counts, amounts and dates are filled in from the record by the per-language
// formatters in modules/language/format.ts, and these are the fixed words around them. The type makes sure no language is missing a string.
//
// Machine-written Hindi, Malayalam and Kannada. They are listed in REVIEW-ml.md and REVIEW-kn.md for a native speaker, and no real centre should be given them before
// that review. The claim rules (modules/report/claims.ts) apply: a document counts and states facts; it never grades.
import type { Language } from "../../../../modules/language/languages.ts";
import type { NotTestedId } from "../crash-test/not-tested.ts";
import type { NotCountedId, Source } from "./data.ts";

export interface Strings {
  agent: string;
  monthlyReport: string;
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
  notTested: Record<NotTestedId, string>;
  notCounted: Record<NotCountedId, string>;
  page: {
    numbers: string; item: string; count: string; amount: string; moneyHeading: string; opened: string; paidInFull: string; partlyPaid: string; stillOpen: string;
    waiversHeading: string; byOwner: string; withinLimit: string; lateFees: string; lateFeesAdded: string; messagesHeading: string; remindersToParents: string; receiptsToParents: string; toYou: string; heldBack: string;
    stoppedHeading: string; rule: string; times: string; stoppedParents: string; notCountedHeading: string; notTestedHeading: string; unconfirmed: string;
    showWhatWeDid: string; byActionHeading: string; action: string; agentVersion: string; limitsDigest: string; recordDigest: string; liveServices: string;
    checkHeading: string; code: string; digest: string; countedFrom: string; setUpBy: string; madeOn: string; signedBy: string; notSigned: string; signatureNote: string; notAGrade: string; period: string;
  };
}

export const en: Strings = {
  agent: "Fees agent", monthlyReport: "Monthly report", fullReport: "Full report",
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
  notTested: {
    "cash-and-bank-transfers": "Fees paid in cash or by bank transfer (a parent who says so is sent to the owner; nothing is marked paid)",
    "payments-outside-razorpay": "Payments outside Razorpay (the UPI module is not built)",
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
  },
  notCounted: {
    "cash-and-transfers": "Fees paid in cash or by bank transfer: the record only holds Razorpay payments",
    "read-receipts": "Whether a parent read a message",
    "outside-agent": "Anything done outside the agent (by you or anyone else, in Razorpay or WhatsApp)",
    "rule-breaks": "Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing",
  },
  page: {
    numbers: "The numbers", item: "What", count: "How many", amount: "Amount", moneyHeading: "Money", opened: "Fees opened for the month", paidInFull: "Paid in full", partlyPaid: "Part paid", stillOpen: "Still open",
    waiversHeading: "What was taken off", byOwner: "Approved by you", withinLimit: "Within your limit, done by the agent", lateFees: "Late fees", lateFeesAdded: "Late fees added",
    messagesHeading: "Messages sent", remindersToParents: "Reminders to parents", receiptsToParents: "Receipts to parents", toYou: "To you, the owner", heldBack: "Held back before sending",
    stoppedHeading: "What your limits stopped", rule: "Limit", times: "Times", stoppedParents: "Parents who sent STOP", notCountedHeading: "Not counted", notTestedHeading: "Not tested", unconfirmed: "Left unconfirmed or failed",
    checkHeading: "Check this document", code: "Code", digest: "Digest", countedFrom: "Counted from", setUpBy: "Set up by", madeOn: "Made on", signedBy: "Signed by", notSigned: "Not signed", signatureNote: "A signature shows who made this document and that it has not changed. It does not show that what it counts is complete.",
    notAGrade: "These are counts of what the record shows. They do not grade the agent.", period: "Period",
    showWhatWeDid: "Show what we did ▸", byActionHeading: "What the agent did, by action", action: "Action", agentVersion: "Agent version", limitsDigest: "Limits digest", recordDigest: "Record digest", liveServices: "Live services",
  },
};

export const hi: Strings = {
  agent: "फीस एजेंट", monthlyReport: "मासिक रिपोर्ट", fullReport: "पूरी रिपोर्ट",
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
  notTested: {
    "cash-and-bank-transfers": "नकद या बैंक ट्रांसफर से दी गई फीस (जो अभिभावक ऐसा कहे उसे मालिक के पास भेजा जाता है; कुछ भी \"भरा हुआ\" नहीं माना जाता)",
    "payments-outside-razorpay": "Razorpay के बाहर के भुगतान (UPI मॉड्यूल अभी बना नहीं है)",
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
  },
  notCounted: {
    "cash-and-transfers": "नकद या बैंक ट्रांसफर से दी गई फीस: रिकॉर्ड में सिर्फ़ Razorpay के भुगतान हैं",
    "read-receipts": "अभिभावक ने संदेश पढ़ा या नहीं",
    "outside-agent": "एजेंट के बाहर किया गया कोई भी काम (आपने या किसी और ने Razorpay या WhatsApp में किया)",
    "rule-breaks": "वे नियम-उल्लंघन जो एजेंट ने देखे नहीं: रिकॉर्ड में वही है जो एजेंट ने किया या जिससे उसे रोका गया",
  },
  page: {
    numbers: "आँकड़े", item: "क्या", count: "कितने", amount: "रकम", moneyHeading: "पैसा", opened: "इस महीने खोली गई फीस", paidInFull: "पूरी भरी गई", partlyPaid: "आधी भरी गई", stillOpen: "अभी खुली",
    waiversHeading: "क्या घटाया गया", byOwner: "आपने मंज़ूर की", withinLimit: "आपकी सीमा के अंदर, एजेंट ने की", lateFees: "देर की फीस", lateFeesAdded: "जोड़ी गई देर की फीस",
    messagesHeading: "भेजे गए संदेश", remindersToParents: "अभिभावकों को याद", receiptsToParents: "अभिभावकों को रसीद", toYou: "आपको, मालिक को", heldBack: "भेजने से पहले रोके गए",
    stoppedHeading: "आपकी सीमाओं ने क्या रोका", rule: "सीमा", times: "बार", stoppedParents: "STOP भेजने वाले अभिभावक", notCountedHeading: "गिना नहीं गया", notTestedHeading: "जाँचा नहीं गया", unconfirmed: "जो पक्का नहीं हुआ या नहीं हो पाया",
    checkHeading: "इस दस्तावेज़ को जाँचें", code: "कोड", digest: "डाइजेस्ट", countedFrom: "कहाँ से गिना", setUpBy: "तैयार किया", madeOn: "बनाया गया", signedBy: "हस्ताक्षर", notSigned: "हस्ताक्षर नहीं", signatureNote: "हस्ताक्षर दिखाता है कि यह दस्तावेज़ किसने बनाया और यह बदला नहीं है। यह नहीं दिखाता कि इसमें गिनी गई बातें पूरी हैं।",
    notAGrade: "ये रिकॉर्ड में दिखी बातों की गिनती हैं। ये एजेंट को अंक या दर्जा नहीं देतीं।", period: "अवधि",
    showWhatWeDid: "देखें हमने क्या किया ▸", byActionHeading: "एजेंट ने क्या किया, काम के हिसाब से", action: "काम", agentVersion: "एजेंट का संस्करण", limitsDigest: "सीमाओं का डाइजेस्ट", recordDigest: "रिकॉर्ड का डाइजेस्ट", liveServices: "असली सिस्टम",
  },
};

export const ml: Strings = {
  agent: "ഫീസ് ഏജന്റ്", monthlyReport: "പ്രതിമാസ റിപ്പോർട്ട്", fullReport: "പൂർണ്ണ റിപ്പോർട്ട്",
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
  notTested: {
    "cash-and-bank-transfers": "പണമായോ ബാങ്ക് ട്രാൻസ്ഫറായോ അടച്ച ഫീസ് (അങ്ങനെ പറയുന്ന രക്ഷിതാവിനെ ഉടമയുടെ അടുത്തേക്ക് അയയ്ക്കുന്നു; ഒന്നും \"അടച്ചു\" എന്ന് രേഖപ്പെടുത്തുന്നില്ല)",
    "payments-outside-razorpay": "Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ (UPI മൊഡ്യൂൾ ഇതുവരെ നിർമ്മിച്ചിട്ടില്ല)",
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
  },
  notCounted: {
    "cash-and-transfers": "പണമായോ ബാങ്ക് ട്രാൻസ്ഫറായോ അടച്ച ഫീസ്: രേഖയിൽ Razorpay പേയ്മെന്റുകൾ മാത്രമേയുള്ളൂ",
    "read-receipts": "രക്ഷിതാവ് സന്ദേശം വായിച്ചോ ഇല്ലയോ",
    "outside-agent": "ഏജന്റിന് പുറത്ത് ചെയ്ത എന്തും (നിങ്ങളോ മറ്റാരെങ്കിലുമോ Razorpay-യിലോ WhatsApp-ലോ ചെയ്തത്)",
    "rule-breaks": "ഏജന്റ് കാണാത്ത നിയമലംഘനങ്ങൾ: ഏജന്റ് ചെയ്തതും തടഞ്ഞതും മാത്രമാണ് രേഖയിലുള്ളത്",
  },
  page: {
    numbers: "കണക്കുകൾ", item: "എന്ത്", count: "എത്ര", amount: "തുക", moneyHeading: "പണം", opened: "ഈ മാസം തുറന്ന ഫീസുകൾ", paidInFull: "പൂർണ്ണമായി അടച്ചത്", partlyPaid: "ഭാഗികമായി അടച്ചത്", stillOpen: "ഇനിയും തുറന്നിരിക്കുന്നത്",
    waiversHeading: "കുറച്ചത്", byOwner: "നിങ്ങൾ അംഗീകരിച്ചത്", withinLimit: "നിങ്ങളുടെ പരിധിക്കുള്ളിൽ ഏജന്റ് ചെയ്തത്", lateFees: "വൈകിയ ഫീസ്", lateFeesAdded: "ചേർത്ത വൈകിയ ഫീസ്",
    messagesHeading: "അയച്ച സന്ദേശങ്ങൾ", remindersToParents: "രക്ഷിതാക്കൾക്കുള്ള ഓർമ്മപ്പെടുത്തലുകൾ", receiptsToParents: "രക്ഷിതാക്കൾക്കുള്ള രസീതുകൾ", toYou: "നിങ്ങൾക്ക്, ഉടമയ്ക്ക്", heldBack: "അയയ്ക്കുന്നതിന് മുമ്പ് തടഞ്ഞത്",
    stoppedHeading: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", rule: "പരിധി", times: "തവണ", stoppedParents: "STOP അയച്ച രക്ഷിതാക്കൾ", notCountedHeading: "എണ്ണാത്തത്", notTestedHeading: "പരിശോധിക്കാത്തത്", unconfirmed: "ഉറപ്പാകാത്തതോ പരാജയപ്പെട്ടതോ",
    checkHeading: "ഈ രേഖ പരിശോധിക്കുക", code: "കോഡ്", digest: "ഡൈജസ്റ്റ്", countedFrom: "എവിടെ നിന്ന് എണ്ണി", setUpBy: "തയ്യാറാക്കിയത്", madeOn: "ഉണ്ടാക്കിയ തീയതി", signedBy: "ഒപ്പിട്ടത്", notSigned: "ഒപ്പിട്ടിട്ടില്ല", signatureNote: "ഈ രേഖ ആരാണ് ഉണ്ടാക്കിയതെന്നും അത് മാറിയിട്ടില്ലെന്നും ഒപ്പ് കാണിക്കുന്നു. ഇതിൽ എണ്ണിയതെല്ലാം പൂർണ്ണമാണെന്ന് അത് കാണിക്കുന്നില്ല.",
    notAGrade: "ഇവ രേഖയിൽ കാണുന്നതിന്റെ എണ്ണം മാത്രമാണ്. ഇവ ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", period: "കാലയളവ്",
    showWhatWeDid: "ഞങ്ങൾ ചെയ്തത് കാണിക്കുക ▸", byActionHeading: "ഏജന്റ് ചെയ്തത്, പ്രവൃത്തി അനുസരിച്ച്", action: "പ്രവൃത്തി", agentVersion: "ഏജന്റ് പതിപ്പ്", limitsDigest: "പരിധികളുടെ ഡൈജസ്റ്റ്", recordDigest: "രേഖയുടെ ഡൈജസ്റ്റ്", liveServices: "യഥാർത്ഥ സംവിധാനങ്ങൾ",
  },
};

export const kn: Strings = {
  agent: "ಶುಲ್ಕ ಏಜೆಂಟ್", monthlyReport: "ಮಾಸಿಕ ವರದಿ", fullReport: "ಪೂರ್ಣ ವರದಿ",
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
  notTested: {
    "cash-and-bank-transfers": "ನಗದು ಅಥವಾ ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆಯಲ್ಲಿ ಕೊಟ್ಟ ಶುಲ್ಕ (ಹಾಗೆ ಹೇಳಿದ ಪೋಷಕರನ್ನು ಮಾಲೀಕರ ಬಳಿ ಕಳುಹಿಸಲಾಗುತ್ತದೆ; ಏನನ್ನೂ \"ಪಾವತಿಯಾಗಿದೆ\" ಎಂದು ಗುರುತಿಸುವುದಿಲ್ಲ)",
    "payments-outside-razorpay": "Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು (UPI ಮಾಡ್ಯೂಲ್ ಇನ್ನೂ ಮಾಡಿಲ್ಲ)",
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
  },
  notCounted: {
    "cash-and-transfers": "ನಗದು ಅಥವಾ ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆಯಲ್ಲಿ ಕೊಟ್ಟ ಶುಲ್ಕ: ದಾಖಲೆಯಲ್ಲಿ Razorpay ಪಾವತಿಗಳು ಮಾತ್ರ ಇವೆ",
    "read-receipts": "ಪೋಷಕರು ಸಂದೇಶ ಓದಿದರೇ ಇಲ್ಲವೇ",
    "outside-agent": "ಏಜೆಂಟ್ ಹೊರಗೆ ಮಾಡಿದ ಯಾವುದೇ ಕೆಲಸ (ನೀವು ಅಥವಾ ಬೇರೆಯವರು Razorpay ಅಥವಾ WhatsApp ನಲ್ಲಿ ಮಾಡಿದ್ದು)",
    "rule-breaks": "ಏಜೆಂಟ್ ನೋಡದ ನಿಯಮ ಉಲ್ಲಂಘನೆಗಳು: ದಾಖಲೆಯಲ್ಲಿ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು ಮತ್ತು ಅದನ್ನು ತಡೆದದ್ದು ಮಾತ್ರ ಇದೆ",
  },
  page: {
    numbers: "ಅಂಕಿಅಂಶಗಳು", item: "ಏನು", count: "ಎಷ್ಟು", amount: "ಮೊತ್ತ", moneyHeading: "ಹಣ", opened: "ಈ ತಿಂಗಳು ತೆರೆದ ಶುಲ್ಕಗಳು", paidInFull: "ಪೂರ್ತಿ ಪಾವತಿಯಾದದ್ದು", partlyPaid: "ಭಾಗಶಃ ಪಾವತಿಯಾದದ್ದು", stillOpen: "ಇನ್ನೂ ತೆರೆದಿರುವುದು",
    waiversHeading: "ಏನು ಕಡಿಮೆ ಮಾಡಲಾಯಿತು", byOwner: "ನೀವು ಒಪ್ಪಿದ್ದು", withinLimit: "ನಿಮ್ಮ ಮಿತಿಯೊಳಗೆ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು", lateFees: "ತಡ ಶುಲ್ಕ", lateFeesAdded: "ಸೇರಿಸಿದ ತಡ ಶುಲ್ಕ",
    messagesHeading: "ಕಳುಹಿಸಿದ ಸಂದೇಶಗಳು", remindersToParents: "ಪೋಷಕರಿಗೆ ನೆನಪುಗಳು", receiptsToParents: "ಪೋಷಕರಿಗೆ ರಸೀದಿಗಳು", toYou: "ನಿಮಗೆ, ಮಾಲೀಕರಿಗೆ", heldBack: "ಕಳುಹಿಸುವ ಮೊದಲು ತಡೆದದ್ದು",
    stoppedHeading: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", rule: "ಮಿತಿ", times: "ಬಾರಿ", stoppedParents: "STOP ಕಳುಹಿಸಿದ ಪೋಷಕರು", notCountedHeading: "ಎಣಿಸದ್ದು", notTestedHeading: "ಪರಿಶೀಲಿಸದ್ದು", unconfirmed: "ದೃಢವಾಗದ ಅಥವಾ ವಿಫಲವಾದದ್ದು",
    checkHeading: "ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ", code: "ಕೋಡ್", digest: "ಡೈಜೆಸ್ಟ್", countedFrom: "ಎಲ್ಲಿಂದ ಎಣಿಸಿದ್ದು", setUpBy: "ಸಿದ್ಧಪಡಿಸಿದವರು", madeOn: "ಮಾಡಿದ ದಿನ", signedBy: "ಸಹಿ ಮಾಡಿದವರು", notSigned: "ಸಹಿ ಇಲ್ಲ", signatureNote: "ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ಮಾಡಿದರು ಮತ್ತು ಅದು ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಇದರಲ್ಲಿ ಎಣಿಸಿದ್ದೆಲ್ಲ ಪೂರ್ಣ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
    notAGrade: "ಇವು ದಾಖಲೆಯಲ್ಲಿ ಕಾಣುವ ವಿಷಯಗಳ ಎಣಿಕೆ. ಇವು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ನೀಡುವುದಿಲ್ಲ.", period: "ಅವಧಿ",
    showWhatWeDid: "ನಾವು ಮಾಡಿದ್ದನ್ನು ತೋರಿಸಿ ▸", byActionHeading: "ಏಜೆಂಟ್ ಮಾಡಿದ್ದು, ಕೆಲಸದ ಪ್ರಕಾರ", action: "ಕೆಲಸ", agentVersion: "ಏಜೆಂಟ್ ಆವೃತ್ತಿ", limitsDigest: "ಮಿತಿಗಳ ಡೈಜೆಸ್ಟ್", recordDigest: "ದಾಖಲೆಯ ಡೈಜೆಸ್ಟ್", liveServices: "ನಿಜವಾದ ವ್ಯವಸ್ಥೆಗಳು",
  },
};

export const STRINGS: Record<Language, Strings> = { hi, en, ml, kn };
