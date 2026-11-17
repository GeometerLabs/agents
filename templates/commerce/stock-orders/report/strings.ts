// Every word the monthly Stock orders report and go-live certificate say, per language. Nothing numeric is typed here: counts, amounts and dates are filled in from the
// record by the per-language formatters in modules/language/format.ts, and these are the fixed words around them. The type makes sure no language is missing a string.
//
// Machine-written Hindi, Malayalam and Kannada. They are listed in REVIEW-hi.md, REVIEW-ml.md and REVIEW-kn.md for a native speaker (report/review.ts), and no real shop
// should be given them before that review. The claim rules (modules/report/claims.ts) apply: a document counts and states facts; it never grades. The word for a payment
// appears only where the owner's OWN note is counted (label.markedPaid) and in the lists of what is not counted: this agent pays no one, and says so.
import { CHECK_GENUINE } from "../../../../modules/report/text.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { NotCountedId, NotTestedKey, Source, StockRuleId } from "./data.ts";

export interface Strings {
  agent: string;
  monthlyReport: string;
  goLiveCertificate: string;
  /** The label before the address of the full report page, in the WhatsApp message. */
  fullReport: string;
  /** The label before the check link in the WhatsApp message (modules/report/text.ts CHECK_GENUINE). */
  checkGenuine: string;
  /** The one help line every owner document ends with. */
  helpLine: string;
  /** The one assurance the documents make, and the only one. */
  promise: string;
  handRun: string;
  sourceTag: Record<Source, string>;
  more: (n: number) => string;
  /** "₹4,500 of ₹20,000": what the approved orders hold, then the month's budget. */
  budgetOf: (used: string, total: string) => string;
  /** The owner's lines: "label: number". */
  label: {
    placed: string; acknowledged: string; receivedFull: string; partReceived: string; wrongItem: string; supplierSaidNo: string; noAnswer: string; neverSent: string;
    budgetUsed: string; budgetLeft: string; markedPaid: string; asked: string; approved: string; saidNo: string; stopped: string; notChecked: string;
  };
  /** What each limit that stopped something is called. */
  stop: Record<StockRuleId, string>;
  /** The things an owner would expect to be checked and was not, in short. */
  notChecked: { whatsapp: string; supplier: string; paying: string; review: string };
  /** The full lists on the page: what the hand check did not cover, and what the record cannot count. */
  notTested: Record<NotTestedKey, string>;
  notCounted: Record<NotCountedId, string>;
  /** The go-live certificate: the shop's limits in plain words. The numbers are filled in by the per-language formatters. */
  cert: {
    date: string; held(held: number, total: number, failed: number, notTested: number): string; intro: string; yourLimits: string;
    paidRule: string; budget(amount: string): string; cap(amount: string): string; maxQty(n: number): string; suppliers(approved: number, paused: number): string; followUp(hours: string): string;
    notAGrade: string; didNotHold: string; handRunLine: string; checkedOn: string;
  };
  /** What the monthly report says about the go-live checks. A date is passed in already written by the formatter, and a key as its id. */
  goLive: {
    heading: string; own(date: string): string; example(date: string): string; different(date: string): string;
    untrusted: string; none: string; signedWith(key: string): string;
  };
  page: {
    numbers: string; item: string; count: string; amount: string; ordersHeading: string; budgetHeading: string; monthlyBudget: string; ownersNoteHeading: string; suppliersHeading: string; supplier: string;
    stoppedHeading: string; rule: string; times: string; notCountedHeading: string; notTestedHeading: string; unconfirmed: string;
    checkHeading: string; code: string; digest: string; countedFrom: string; setUpBy: string; madeOn: string; signedBy: string; notSigned: string; signatureNote: string; scanToCheck: string; scanSummary: string; notAGrade: string; period: string;
    showWhatWeDid: string; byActionHeading: string; action: string; agentVersion: string; limitsDigest: string; recordDigest: string; liveServices: string;
  };
}

export const en: Strings = {
  agent: "Stock orders agent", monthlyReport: "Monthly report", goLiveCertificate: "Go-live certificate", fullReport: "Full report", checkGenuine: CHECK_GENUINE.en,
  helpLine: "Write to support. A person answers.",
  promise: "Nothing goes to a supplier without your approval; the agent pays no one.",
  handRun: "Checks were run by hand.",
  sourceTag: { "stand-in": "stand-in services, test money", "test-mode": "test mode, test money", live: "" },
  more: (n) => `and ${n} more (see the full report)`,
  budgetOf: (used, total) => `${used} of ${total}`,
  label: {
    placed: "Orders placed", acknowledged: "Supplier said OK", receivedFull: "Received in full", partReceived: "Part received", wrongItem: "Wrong item", supplierSaidNo: "Supplier said no", noAnswer: "No answer from the supplier",
    neverSent: "Cancelled or never sent", budgetUsed: "Budget used", budgetLeft: "Budget left", markedPaid: "Marked paid by you (your note)", asked: "You were asked", approved: "You approved", saidNo: "You said no",
    stopped: "Stopped by your limits", notChecked: "Not checked",
  },
  stop: {
    "monthly-budget": "Orders over the month's budget", "per-order-cap": "Orders above your one-order limit", "order-quantity": "Quantities that looked like a slip", "approved-supplier-only": "Suppliers not on your approved list",
    "approval-matches-order": "Approvals that no longer matched the order", "one-order-per-request": "A second order from one request", "reply-from-supplier": "Replies that were not the supplier's",
    "send-only-when-approved": "Sends that were not approved", "message-matches-record": "Messages that did not match the record", "opt-out": "Messages after STOP", other: "Something else your limits held back",
  },
  notChecked: { whatsapp: "real WhatsApp", supplier: "real suppliers' replies", paying: "paying a supplier", review: "a native speaker's review of the wording" },
  notTested: {
    "real-whatsapp": "Real WhatsApp: a real account, a real Meta template approval, a real supplier's phone",
    "native-review": "A native speaker's review of the Hindi, Malayalam and Kannada wording",
    "model-reading": "An owner's request read by an AI model (only the rule reader was tried; a request it cannot read is asked about, not guessed)",
    "supplier-formats": "The many ways real suppliers answer (a voice note, a photo of a bill, another script, a reply that quotes an older message)",
    restart: "A restart in the middle of an approval (the checks kept everything in memory)",
    paying: "Paying a supplier (the agent pays no one; your own note is only your word)",
    invoice: "A supplier's invoice, a price that differs from the catalogue, a part-shipment note from the supplier, a return of goods",
    "real-month": "A month that turns while an approval is open",
    "own-settings": "These checks on this shop's own settings (the go-live certificate says they ran on the example shop, Glow Unisex Salon)",
    "other-settings": "These checks on this shop's own settings (the go-live certificate says they ran on different settings)",
    "no-go-live-certificate": "These checks on this shop's own settings (no go-live certificate was given)",
    "go-live-untrusted": "These checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used)",
    "situations-skipped": "Situations these settings could not run (named in the go-live certificate)",
  },
  notCounted: {
    "goods-really-arrived": "Whether the goods really arrived: only your own mark is counted",
    payments: "Payments to suppliers: this agent pays no one and cannot see a payment; only your own note is counted",
    "outside-agent": "Orders placed outside the agent (by phone, in person or in another chat)",
    "read-receipts": "Whether a supplier read a message",
    "rule-breaks": "Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing",
  },
  cert: {
    date: "Date", held: (h, t, f, n) => `Held ${h} of ${t} situations. ${f} failed. ${n} not tested.`,
    intro: "Before switching on, we tried situations that could go wrong: a lost reply to an order message, a supplier who never answers, two orders racing for the last of the budget, a quantity or price that changes after you approve, a supplier who is not on your list, and a wrong item arriving.",
    yourLimits: "Your limits", paidRule: "Nothing goes to a supplier until you approve that exact order, and the agent pays no one",
    budget: (a) => `Budget for the month: ${a}, set aside when you approve an order`, cap: (a) => `One order is at most ${a}`, maxQty: (n) => `At most ${n} units of one item in one order`,
    suppliers: (a, p) => (p > 0 ? `${a} approved suppliers; ${p} on the list but paused (never ordered from)` : `${a} approved suppliers`),
    followUp: (h) => `A supplier who has not answered is asked again after ${h} hours; after the last time you are told`,
    notAGrade: "This counts the situations tried. It does not grade the agent.", didNotHold: "Did not hold",
    handRunLine: "Checks were run by hand against stand-in services, not real WhatsApp. No money moved.", checkedOn: "Checks run on",
  },
  goLive: {
    heading: "Go-live checks",
    own: (date) => `The go-live checks ran on this shop's own settings, in the go-live certificate of ${date}.`,
    example: (date) => `The go-live certificate of ${date} says its checks ran on the example shop, Glow Unisex Salon, not on this shop's own settings.`,
    different: (date) => `The go-live certificate of ${date} says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave.`,
    untrusted: "A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used.",
    none: "No go-live certificate was given, so this document does not say what the go-live checks ran on.",
    signedWith: (key) => `The go-live certificate is signed with ${key}. A key does not show who holds it.`,
  },
  page: {
    numbers: "The numbers", item: "What", count: "How many", amount: "Amount", ordersHeading: "Orders approved in this month", budgetHeading: "The month's budget", monthlyBudget: "Budget for the month", ownersNoteHeading: "Your own note",
    suppliersHeading: "By supplier", supplier: "Supplier", stoppedHeading: "What your limits stopped", rule: "Limit", times: "Times", notCountedHeading: "Not counted", notTestedHeading: "Not tested",
    unconfirmed: "Order messages WhatsApp did not confirm",
    checkHeading: "Check this document", code: "Code", digest: "Digest", countedFrom: "Counted from", setUpBy: "Set up by", madeOn: "Made on", signedBy: "Signed by", notSigned: "Not signed",
    signatureNote: "A signature shows who made this document and that it has not changed. It does not show that what it counts is complete.",
    scanToCheck: "Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your Operator or Geometer's team gave you.",
    scanSummary: "Scan this code, or open the link, to check this paper on geometer.dev. It shows whether the paper is genuine, who issued it, and the figures to compare with this page. The check runs on your phone and nothing about the paper is sent. It does not show that the numbers are true.",
    notAGrade: "These are counts of what the record shows. They do not grade the agent.", period: "Period",
    showWhatWeDid: "Show what we did ▸", byActionHeading: "What the agent did, by action", action: "Action", agentVersion: "Agent version", limitsDigest: "Limits digest", recordDigest: "Record digest", liveServices: "Live services",
  },
};

export const hi: Strings = {
  agent: "स्टॉक ऑर्डर एजेंट", monthlyReport: "मासिक रिपोर्ट", goLiveCertificate: "चालू करने से पहले का जाँच प्रमाणपत्र", fullReport: "पूरी रिपोर्ट", checkGenuine: CHECK_GENUINE.hi,
  helpLine: "सपोर्ट को लिखें। एक इंसान जवाब देता है।",
  promise: "आपकी मंज़ूरी के बिना कोई ऑर्डर सप्लायर को नहीं जाता; एजेंट किसी को पैसे नहीं देता।",
  handRun: "जाँच हाथ से की गई।",
  sourceTag: { "stand-in": "अभ्यास वाले नकली सिस्टम, टेस्ट पैसा", "test-mode": "टेस्ट मोड, टेस्ट पैसा", live: "" },
  more: (n) => `और ${n} (पूरी रिपोर्ट में)`,
  budgetOf: (used, total) => `${total} में से ${used}`,
  label: {
    placed: "दिए गए ऑर्डर", acknowledged: "सप्लायर ने OK कहा", receivedFull: "पूरा माल आया", partReceived: "कुछ माल आया", wrongItem: "गलत सामान", supplierSaidNo: "सप्लायर ने मना किया", noAnswer: "सप्लायर का जवाब नहीं",
    neverSent: "रद्द या भेजे नहीं गए", budgetUsed: "इस्तेमाल हुआ बजट", budgetLeft: "बचा हुआ बजट", markedPaid: "आपने भुगतान दर्ज किया (आपका नोट)", asked: "आपसे पूछा गया", approved: "आपने मंज़ूर किया", saidNo: "आपने मना किया",
    stopped: "आपकी सीमाओं ने रोका", notChecked: "जाँचा नहीं गया",
  },
  stop: {
    "monthly-budget": "महीने के बजट से ऊपर के ऑर्डर", "per-order-cap": "एक ऑर्डर की सीमा से ऊपर के ऑर्डर", "order-quantity": "गलती जैसी लगने वाली मात्रा", "approved-supplier-only": "आपकी मंज़ूर सूची में न होने वाले सप्लायर",
    "approval-matches-order": "ऑर्डर से न मिलने वाली मंज़ूरियाँ", "one-order-per-request": "एक अनुरोध से दूसरा ऑर्डर", "reply-from-supplier": "सप्लायर के न होने वाले जवाब",
    "send-only-when-approved": "बिना मंज़ूरी के भेजने की कोशिशें", "message-matches-record": "रिकॉर्ड से न मिलने वाले संदेश", "opt-out": "STOP के बाद संदेश", other: "आपकी सीमाओं ने रोकी कोई और बात",
  },
  notChecked: { whatsapp: "असली WhatsApp", supplier: "असली सप्लायर के जवाब", paying: "सप्लायर को पैसे देना", review: "शब्दों की किसी मूल भाषी से जाँच" },
  notTested: {
    "real-whatsapp": "असली WhatsApp: असली खाता, Meta से असली टेम्पलेट मंज़ूरी, असली सप्लायर का फ़ोन",
    "native-review": "हिंदी, मलयालम और कन्नड़ शब्दों की किसी मूल भाषी से जाँच",
    "model-reading": "मालिक के अनुरोध को AI मॉडल से पढ़वाना (सिर्फ़ नियमों वाला पाठक आज़माया गया; जो अनुरोध वह नहीं पढ़ पाता, उसके बारे में पूछा जाता है, अंदाज़ा नहीं लगाया जाता)",
    "supplier-formats": "असली सप्लायर के जवाब देने के कई तरीके (वॉइस नोट, बिल की फ़ोटो, दूसरी लिपि, पुराने संदेश को उद्धृत करता जवाब)",
    restart: "मंज़ूरी के बीच में रीस्टार्ट (जाँच में सब कुछ मेमोरी में रखा गया था)",
    paying: "सप्लायर को पैसे देना (एजेंट किसी को पैसे नहीं देता; आपका अपना नोट सिर्फ़ आपकी बात है)",
    invoice: "सप्लायर का इनवॉइस, कैटलॉग से अलग दाम, सप्लायर की ओर से आधे माल की सूचना, माल की वापसी",
    "real-month": "मंज़ूरी खुली रहते महीना बदल जाना",
    "own-settings": "ये जाँच इस दुकान की अपनी सेटिंग पर (जाँच प्रमाणपत्र कहता है कि वे उदाहरण दुकान Glow Unisex Salon पर चली थीं)",
    "other-settings": "ये जाँच इस दुकान की अपनी सेटिंग पर (जाँच प्रमाणपत्र कहता है कि वे अलग सेटिंग पर चली थीं)",
    "no-go-live-certificate": "ये जाँच इस दुकान की अपनी सेटिंग पर (कोई जाँच प्रमाणपत्र नहीं दिया गया)",
    "go-live-untrusted": "ये जाँच इस दुकान की अपनी सेटिंग पर (जो जाँच प्रमाणपत्र दिया गया उस पर भरोसा नहीं किया जा सका, इसलिए उसे इस्तेमाल नहीं किया गया)",
    "situations-skipped": "वे स्थितियाँ जो इन सेटिंग पर चल नहीं सकीं (जाँच प्रमाणपत्र में नाम दिए हैं)",
  },
  notCounted: {
    "goods-really-arrived": "माल सच में आया या नहीं: सिर्फ़ आपका अपना दर्ज किया हुआ गिना जाता है",
    payments: "सप्लायर को भुगतान: यह एजेंट किसी को पैसे नहीं देता और कोई भुगतान देख नहीं सकता; सिर्फ़ आपका अपना नोट गिना जाता है",
    "outside-agent": "एजेंट के बाहर दिए गए ऑर्डर (फ़ोन पर, सामने या किसी और चैट में)",
    "read-receipts": "सप्लायर ने संदेश पढ़ा या नहीं",
    "rule-breaks": "नियम टूटने की वे बातें जो एजेंट ने नहीं देखीं: रिकॉर्ड में वही है जो एजेंट ने किया और जिससे उसे रोका गया",
  },
  cert: {
    date: "तारीख़", held: (h, t, f, n) => `${t} में से ${h} स्थितियाँ ठीक रहीं। ${f} में गड़बड़ हुई। ${n} बातें जाँची नहीं गईं।`,
    intro: "चालू करने से पहले हमने वे स्थितियाँ आज़माईं जो गलत हो सकती थीं: ऑर्डर संदेश का खोया हुआ जवाब, कभी जवाब न देने वाला सप्लायर, बजट के आख़िरी हिस्से के लिए दो ऑर्डर की होड़, आपकी मंज़ूरी के बाद बदलती मात्रा या दाम, आपकी सूची में न होने वाला सप्लायर, और गलत सामान का आना।",
    yourLimits: "आपकी सीमाएँ", paidRule: "आपकी मंज़ूरी के बिना ठीक वही ऑर्डर किसी सप्लायर को नहीं जाता, और एजेंट किसी को पैसे नहीं देता",
    budget: (a) => `महीने का बजट: ${a}, ऑर्डर मंज़ूर करते ही अलग रख दिया जाता है`, cap: (a) => `एक ऑर्डर ज़्यादा से ज़्यादा ${a} का`, maxQty: (n) => `एक ऑर्डर में एक चीज़ की ज़्यादा से ज़्यादा ${n} इकाइयाँ`,
    suppliers: (a, p) => (p > 0 ? `${a} मंज़ूर सप्लायर; ${p} सूची में हैं पर रोके गए हैं (उन्हें ऑर्डर नहीं जाता)` : `${a} मंज़ूर सप्लायर`),
    followUp: (h) => `जिस सप्लायर ने जवाब नहीं दिया उससे ${h} घंटे बाद फिर पूछा जाता है; आख़िरी बार के बाद आपको बताया जाता है`,
    notAGrade: "यह आज़माई गई स्थितियों की गिनती है। यह एजेंट को अंक या दर्जा नहीं देती।", didNotHold: "जिनमें गड़बड़ हुई",
    handRunLine: "जाँच हाथ से की गई, असली WhatsApp पर नहीं, बल्कि अभ्यास वाले नकली सिस्टम (stand-in services) पर। कोई पैसा नहीं हिला।", checkedOn: "जाँच इन पर की गई",
  },
  goLive: {
    heading: "चालू करने से पहले की जाँच",
    own: (date) => `चालू करने से पहले की जाँच इसी दुकान की अपनी सेटिंग पर चली थी, ${date} के जाँच प्रमाणपत्र के अनुसार।`,
    example: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच उदाहरण दुकान Glow Unisex Salon पर चली थी, इस दुकान की अपनी सेटिंग पर नहीं।`,
    different: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच इस दुकान से अलग सेटिंग पर चली थी, इसलिए उससे इस दुकान की अपनी सेटिंग का हाल पता नहीं चलता।`,
    untrusted: "एक जाँच प्रमाणपत्र दिया गया था, पर उस पर भरोसा नहीं किया जा सका (उस पर हस्ताक्षर नहीं है, हस्ताक्षर नहीं बैठता, या वह इस एजेंट का जाँच प्रमाणपत्र है ही नहीं), इसलिए उसे इस्तेमाल नहीं किया गया।",
    none: "कोई जाँच प्रमाणपत्र नहीं दिया गया, इसलिए यह दस्तावेज़ नहीं बताता कि चालू करने से पहले की जाँच किस सेटिंग पर चली थी।",
    signedWith: (key) => `जाँच प्रमाणपत्र पर ${key} कुंजी से हस्ताक्षर हैं। कुंजी यह नहीं बताती कि वह किसके पास है।`,
  },
  page: {
    numbers: "आँकड़े", item: "क्या", count: "कितने", amount: "रकम", ordersHeading: "इस महीने मंज़ूर हुए ऑर्डर", budgetHeading: "महीने का बजट", monthlyBudget: "महीने का बजट", ownersNoteHeading: "आपका अपना नोट",
    suppliersHeading: "सप्लायर के हिसाब से", supplier: "सप्लायर", stoppedHeading: "आपकी सीमाओं ने क्या रोका", rule: "सीमा", times: "बार", notCountedHeading: "गिना नहीं गया", notTestedHeading: "जाँचा नहीं गया",
    unconfirmed: "ऑर्डर संदेश जिन्हें WhatsApp ने पक्का नहीं किया",
    checkHeading: "इस दस्तावेज़ को जाँचें", code: "कोड", digest: "डाइजेस्ट", countedFrom: "कहाँ से गिना", setUpBy: "तैयार किया", madeOn: "बनाया गया", signedBy: "हस्ताक्षर", notSigned: "हस्ताक्षर नहीं",
    signatureNote: "हस्ताक्षर दिखाता है कि यह दस्तावेज़ किसने बनाया और यह बदला नहीं है। यह नहीं दिखाता कि इसमें गिनी गई बातें पूरी हैं।",
    scanToCheck: "इस दस्तावेज़ को geometer.dev पर जाँचने के लिए स्कैन करें। इसकी .json फ़ाइल चाहिए होगी। जाँच आपके ब्राउज़र में होती है, कुछ भेजा नहीं जाता। लिंक में हस्ताक्षर की कुंजी नहीं है: किसने हस्ताक्षर किए यह जानने के लिए यहाँ दिखी कुंजी को उस कुंजी से मिलाएँ जो आपके ऑपरेटर या Geometer की टीम ने दी है।",
    scanSummary: "इस दस्तावेज़ को geometer.dev पर जाँचने के लिए यह कोड स्कैन करें या लिंक खोलें। इससे पता चलता है कि दस्तावेज़ असली है या नहीं, इसे किसने जारी किया, और इस पन्ने से मिलाने के लिए आँकड़े। जाँच आपके फ़ोन पर होती है, दस्तावेज़ के बारे में कुछ भेजा नहीं जाता। यह नहीं बताता कि आँकड़े सच हैं।",
    notAGrade: "ये रिकॉर्ड में दिखी बातों की गिनती हैं। ये एजेंट को अंक या दर्जा नहीं देतीं।", period: "अवधि",
    showWhatWeDid: "देखें हमने क्या किया ▸", byActionHeading: "एजेंट ने क्या किया, काम के हिसाब से", action: "काम", agentVersion: "एजेंट का संस्करण", limitsDigest: "सीमाओं का डाइजेस्ट", recordDigest: "रिकॉर्ड का डाइजेस्ट", liveServices: "असली सिस्टम",
  },
};

export const ml: Strings = {
  agent: "സ്റ്റോക്ക് ഓർഡർ ഏജന്റ്", monthlyReport: "പ്രതിമാസ റിപ്പോർട്ട്", goLiveCertificate: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനാ സർട്ടിഫിക്കറ്റ്", fullReport: "പൂർണ്ണ റിപ്പോർട്ട്", checkGenuine: CHECK_GENUINE.ml,
  helpLine: "സപ്പോർട്ടിന് എഴുതുക. ഒരു വ്യക്തി മറുപടി നൽകും.",
  promise: "നിങ്ങളുടെ അനുമതിയില്ലാതെ ഒരു ഓർഡറും വിതരണക്കാരന് പോകില്ല; ഏജന്റ് ആർക്കും പണം നൽകുന്നില്ല.",
  handRun: "പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തു.",
  sourceTag: { "stand-in": "പരിശീലന സംവിധാനങ്ങൾ, ടെസ്റ്റ് പണം", "test-mode": "ടെസ്റ്റ് മോഡ്, ടെസ്റ്റ് പണം", live: "" },
  more: (n) => `+${n} (പൂർണ്ണ റിപ്പോർട്ടിൽ)`,
  budgetOf: (used, total) => `${total}-ൽ ${used}`,
  label: {
    placed: "നൽകിയ ഓർഡറുകൾ", acknowledged: "വിതരണക്കാരൻ OK പറഞ്ഞു", receivedFull: "മുഴുവൻ വന്നു", partReceived: "ഭാഗികമായി വന്നു", wrongItem: "തെറ്റായ സാധനം", supplierSaidNo: "വിതരണക്കാരൻ ഇല്ല എന്ന് പറഞ്ഞു", noAnswer: "വിതരണക്കാരന്റെ മറുപടി ഇല്ല",
    neverSent: "റദ്ദാക്കിയതോ അയയ്ക്കാത്തതോ", budgetUsed: "ഉപയോഗിച്ച ബജറ്റ്", budgetLeft: "ബാക്കി ബജറ്റ്", markedPaid: "പണം നൽകിയതായി കുറിച്ചത് (നിങ്ങളുടെ കുറിപ്പ്)", asked: "നിങ്ങളോട് ചോദിച്ചു", approved: "നിങ്ങൾ അംഗീകരിച്ചു", saidNo: "നിങ്ങൾ ഇല്ല എന്ന് പറഞ്ഞു",
    stopped: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", notChecked: "പരിശോധിക്കാത്തത്",
  },
  stop: {
    "monthly-budget": "മാസ ബജറ്റിന് മുകളിലുള്ള ഓർഡറുകൾ", "per-order-cap": "ഒരു ഓർഡറിന്റെ പരിധിക്ക് മുകളിലുള്ളവ", "order-quantity": "അബദ്ധം പോലെ തോന്നിയ അളവുകൾ", "approved-supplier-only": "നിങ്ങളുടെ അംഗീകൃത പട്ടികയിൽ ഇല്ലാത്ത വിതരണക്കാർ",
    "approval-matches-order": "ഓർഡറുമായി ചേരാതായ അംഗീകാരങ്ങൾ", "one-order-per-request": "ഒരു അഭ്യർത്ഥനയിൽ നിന്ന് രണ്ടാമത്തെ ഓർഡർ", "reply-from-supplier": "വിതരണക്കാരന്റേതല്ലാത്ത മറുപടികൾ",
    "send-only-when-approved": "അംഗീകാരമില്ലാത്ത അയയ്ക്കലുകൾ", "message-matches-record": "രേഖയുമായി ചേരാത്ത സന്ദേശങ്ങൾ", "opt-out": "STOP ന് ശേഷമുള്ള സന്ദേശങ്ങൾ", other: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞ മറ്റൊന്ന്",
  },
  notChecked: { whatsapp: "യഥാർത്ഥ WhatsApp", supplier: "യഥാർത്ഥ വിതരണക്കാരുടെ മറുപടികൾ", paying: "വിതരണക്കാരന് പണം നൽകൽ", review: "മാതൃഭാഷക്കാരന്റെ പരിശോധന" },
  notTested: {
    "real-whatsapp": "യഥാർത്ഥ WhatsApp: യഥാർത്ഥ അക്കൗണ്ട്, Meta-യുടെ യഥാർത്ഥ ടെംപ്ലേറ്റ് അംഗീകാരം, യഥാർത്ഥ വിതരണക്കാരന്റെ ഫോൺ",
    "native-review": "ഹിന്ദി, മലയാളം, കന്നഡ വാക്കുകളുടെ ഒരു മാതൃഭാഷക്കാരന്റെ പരിശോധന",
    "model-reading": "ഉടമയുടെ അഭ്യർത്ഥന AI മോഡൽ വായിക്കുന്നത് (നിയമം അടിസ്ഥാനമാക്കിയ വായനക്കാരൻ മാത്രമേ പരീക്ഷിച്ചുള്ളൂ; വായിക്കാൻ കഴിയാത്ത അഭ്യർത്ഥനയെക്കുറിച്ച് ചോദിക്കുന്നു, ഊഹിക്കുന്നില്ല)",
    "supplier-formats": "യഥാർത്ഥ വിതരണക്കാർ മറുപടി നൽകുന്ന പല രീതികൾ (വോയ്സ് നോട്ട്, ബില്ലിന്റെ ഫോട്ടോ, മറ്റൊരു ലിപി, പഴയ സന്ദേശം ഉദ്ധരിക്കുന്ന മറുപടി)",
    restart: "ഒരു അംഗീകാരത്തിനിടയിൽ റീസ്റ്റാർട്ട് (പരിശോധനകളിൽ എല്ലാം മെമ്മറിയിലായിരുന്നു)",
    paying: "വിതരണക്കാരന് പണം നൽകൽ (ഏജന്റ് ആർക്കും പണം നൽകുന്നില്ല; നിങ്ങളുടെ സ്വന്തം കുറിപ്പ് നിങ്ങളുടെ വാക്ക് മാത്രമാണ്)",
    invoice: "വിതരണക്കാരന്റെ ഇൻവോയ്സ്, കാറ്റലോഗിൽ നിന്ന് വ്യത്യസ്തമായ വില, വിതരണക്കാരന്റെ ഭാഗിക ഷിപ്പ്മെന്റ് അറിയിപ്പ്, സാധനം തിരികെ നൽകൽ",
    "real-month": "ഒരു അംഗീകാരം തുറന്നിരിക്കെ മാസം മാറുന്നത്",
    "own-settings": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നു അവ ഉദാഹരണ കടയായ Glow Unisex Salon-ൽ ആണ് നടത്തിയതെന്ന്)",
    "other-settings": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നു അവ വ്യത്യസ്ത ക്രമീകരണങ്ങളിലാണ് നടത്തിയതെന്ന്)",
    "no-go-live-certificate": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല)",
    "go-live-untrusted": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (നൽകിയ പരിശോധനാ സർട്ടിഫിക്കറ്റ് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഉപയോഗിച്ചില്ല)",
    "situations-skipped": "ഈ ക്രമീകരണങ്ങളിൽ നടത്താൻ കഴിയാത്ത സാഹചര്യങ്ങൾ (പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ പേരുണ്ട്)",
  },
  notCounted: {
    "goods-really-arrived": "സാധനം ശരിക്കും എത്തിയോ എന്ന്: നിങ്ങളുടെ സ്വന്തം രേഖപ്പെടുത്തൽ മാത്രം എണ്ണുന്നു",
    payments: "വിതരണക്കാർക്കുള്ള പേയ്മെന്റുകൾ: ഈ ഏജന്റ് ആർക്കും പണം നൽകുന്നില്ല, ഒരു പേയ്മെന്റും കാണാനും കഴിയില്ല; നിങ്ങളുടെ സ്വന്തം കുറിപ്പ് മാത്രം എണ്ണുന്നു",
    "outside-agent": "ഏജന്റിന് പുറത്ത് നൽകിയ ഓർഡറുകൾ (ഫോണിൽ, നേരിട്ട് അല്ലെങ്കിൽ മറ്റൊരു ചാറ്റിൽ)",
    "read-receipts": "വിതരണക്കാരൻ സന്ദേശം വായിച്ചോ എന്ന്",
    "rule-breaks": "ഏജന്റ് കാണാത്ത നിയമലംഘനങ്ങൾ: ഏജന്റ് ചെയ്തതും തടയപ്പെട്ടതും മാത്രമാണ് രേഖയിൽ ഉള്ളത്",
  },
  cert: {
    date: "തീയതി", held: (h, t, f, n) => `${t} സാഹചര്യങ്ങളിൽ ${h} എണ്ണം ശരിയായി നിന്നു. ${f} എണ്ണം പിഴച്ചു. ${n} കാര്യങ്ങൾ പരിശോധിച്ചിട്ടില്ല.`,
    intro: "തുടങ്ങുന്നതിന് മുമ്പ് തെറ്റാൻ സാധ്യതയുള്ള സാഹചര്യങ്ങൾ ഞങ്ങൾ പരീക്ഷിച്ചു: ഓർഡർ സന്ദേശത്തിന്റെ നഷ്ടപ്പെട്ട മറുപടി, ഒരിക്കലും മറുപടി നൽകാത്ത വിതരണക്കാരൻ, ബജറ്റിന്റെ അവസാന ഭാഗത്തിനായി രണ്ട് ഓർഡറുകളുടെ മത്സരം, നിങ്ങൾ അംഗീകരിച്ച ശേഷം മാറുന്ന അളവോ വിലയോ, നിങ്ങളുടെ പട്ടികയിൽ ഇല്ലാത്ത വിതരണക്കാരൻ, തെറ്റായ സാധനം വരുന്നത്.",
    yourLimits: "നിങ്ങളുടെ പരിധികൾ", paidRule: "നിങ്ങൾ ആ ഓർഡർ തന്നെ അംഗീകരിക്കുംവരെ ഒന്നും വിതരണക്കാരന് പോകില്ല, ഏജന്റ് ആർക്കും പണം നൽകുകയുമില്ല",
    budget: (a) => `മാസത്തെ ബജറ്റ്: ${a}, ഓർഡർ അംഗീകരിക്കുമ്പോൾ മാറ്റിവയ്ക്കും`, cap: (a) => `ഒരു ഓർഡർ പരമാവധി ${a}`, maxQty: (n) => `ഒരു ഓർഡറിൽ ഒരു ഇനത്തിന്റെ പരമാവധി ${n} യൂണിറ്റ്`,
    suppliers: (a, p) => (p > 0 ? `${a} അംഗീകൃത വിതരണക്കാർ; ${p} പേർ പട്ടികയിലുണ്ട്, പക്ഷേ നിർത്തിവച്ചിരിക്കുന്നു (ഓർഡർ പോകില്ല)` : `${a} അംഗീകൃത വിതരണക്കാർ`),
    followUp: (h) => `മറുപടി നൽകാത്ത വിതരണക്കാരനോട് ${h} മണിക്കൂറിന് ശേഷം വീണ്ടും ചോദിക്കും; അവസാനത്തെ തവണയ്ക്ക് ശേഷം നിങ്ങളെ അറിയിക്കും`,
    notAGrade: "ഇത് പരീക്ഷിച്ച സാഹചര്യങ്ങളുടെ എണ്ണം മാത്രമാണ്. ഇത് ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", didNotHold: "പിഴച്ചവ",
    handRunLine: "പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തത് യഥാർത്ഥ WhatsApp-ലല്ല, പരിശീലന സംവിധാനങ്ങളിലാണ് (stand-in services). പണം ഒന്നും നീങ്ങിയില്ല.", checkedOn: "പരിശോധിച്ചത്",
  },
  goLive: {
    heading: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധന",
    own: (date) => `തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ തന്നെയാണ് നടത്തിയത്, ${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പ്രകാരം.`,
    example: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഉദാഹരണ കടയായ Glow Unisex Salon-ൽ ആണ് നടത്തിയത് എന്നാണ്, ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ അല്ല.`,
    different: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഈ കടയുടേതിൽ നിന്ന് വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിലാണ് നടത്തിയത് എന്നാണ്, അതിനാൽ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങൾ എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് അത് കാണിക്കുന്നില്ല.`,
    untrusted: "ഒരു പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിരുന്നു, പക്ഷേ അത് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല (അതിൽ ഒപ്പില്ല, ഒപ്പ് ചേരുന്നില്ല, അല്ലെങ്കിൽ അത് ഈ ഏജന്റിന്റെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് അല്ല), അതിനാൽ ഉപയോഗിച്ചില്ല.",
    none: "പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല, അതിനാൽ തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഏത് ക്രമീകരണങ്ങളിലാണ് നടത്തിയതെന്ന് ഈ രേഖ പറയുന്നില്ല.",
    signedWith: (key) => `പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ ഒപ്പിട്ടത് ${key} എന്ന കീ ഉപയോഗിച്ചാണ്. ആ കീ ആരുടെ കൈയിലാണെന്ന് കീ കാണിക്കുന്നില്ല.`,
  },
  page: {
    numbers: "കണക്കുകൾ", item: "എന്ത്", count: "എത്ര", amount: "തുക", ordersHeading: "ഈ മാസം അംഗീകരിച്ച ഓർഡറുകൾ", budgetHeading: "മാസത്തെ ബജറ്റ്", monthlyBudget: "മാസത്തെ ബജറ്റ്", ownersNoteHeading: "നിങ്ങളുടെ സ്വന്തം കുറിപ്പ്",
    suppliersHeading: "വിതരണക്കാർ അനുസരിച്ച്", supplier: "വിതരണക്കാരൻ", stoppedHeading: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", rule: "പരിധി", times: "തവണ", notCountedHeading: "എണ്ണാത്തത്", notTestedHeading: "പരിശോധിക്കാത്തത്",
    unconfirmed: "WhatsApp ഉറപ്പാക്കാത്ത ഓർഡർ സന്ദേശങ്ങൾ",
    checkHeading: "ഈ രേഖ പരിശോധിക്കുക", code: "കോഡ്", digest: "ഡൈജസ്റ്റ്", countedFrom: "എവിടെ നിന്ന് എണ്ണി", setUpBy: "തയ്യാറാക്കിയത്", madeOn: "ഉണ്ടാക്കിയ തീയതി", signedBy: "ഒപ്പിട്ടത്", notSigned: "ഒപ്പിട്ടിട്ടില്ല",
    signatureNote: "ഈ രേഖ ആരാണ് ഉണ്ടാക്കിയതെന്നും അത് മാറിയിട്ടില്ലെന്നും ഒപ്പ് കാണിക്കുന്നു. ഇതിൽ എണ്ണിയതെല്ലാം പൂർണ്ണമാണെന്ന് അത് കാണിക്കുന്നില്ല.",
    scanToCheck: "ഈ രേഖ geometer.dev-ൽ പരിശോധിക്കാൻ സ്കാൻ ചെയ്യുക. ഇതിന്റെ .json ഫയൽ വേണ്ടിവരും. പരിശോധന നിങ്ങളുടെ ബ്രൗസറിൽ നടക്കുന്നു, ഒന്നും അയയ്ക്കുന്നില്ല. ലിങ്കിൽ ഒപ്പിട്ട കീ ഇല്ല: ആര് ഒപ്പിട്ടു എന്നറിയാൻ ഇവിടെ കാണുന്ന കീ, നിങ്ങളുടെ ഓപ്പറേറ്റർയോ Geometer ടീമോ തന്ന കീയുമായി ഒത്തുനോക്കുക.",
    scanSummary: "ഈ രേഖ geometer.dev-ൽ പരിശോധിക്കാൻ ഈ കോഡ് സ്കാൻ ചെയ്യുക, അല്ലെങ്കിൽ ലിങ്ക് തുറക്കുക. രേഖ യഥാർത്ഥമാണോ, ആരാണ് ഇത് പുറത്തിറക്കിയത്, ഈ പേജുമായി ഒത്തുനോക്കാനുള്ള കണക്കുകൾ എന്നിവ അത് കാണിക്കും. പരിശോധന നിങ്ങളുടെ ഫോണിൽ നടക്കുന്നു, രേഖയെക്കുറിച്ച് ഒന്നും അയയ്ക്കുന്നില്ല. കണക്കുകൾ ശരിയാണെന്ന് അത് കാണിക്കുന്നില്ല.",
    notAGrade: "ഇവ രേഖയിൽ കാണുന്നതിന്റെ എണ്ണം മാത്രമാണ്. ഇവ ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", period: "കാലയളവ്",
    showWhatWeDid: "ഞങ്ങൾ ചെയ്തത് കാണിക്കുക ▸", byActionHeading: "ഏജന്റ് ചെയ്തത്, പ്രവൃത്തി അനുസരിച്ച്", action: "പ്രവൃത്തി", agentVersion: "ഏജന്റ് പതിപ്പ്", limitsDigest: "പരിധികളുടെ ഡൈജസ്റ്റ്", recordDigest: "രേഖയുടെ ഡൈജസ്റ്റ്", liveServices: "യഥാർത്ഥ സംവിധാനങ്ങൾ",
  },
};

export const kn: Strings = {
  agent: "ಸ್ಟಾಕ್ ಆರ್ಡರ್ ಏಜೆಂಟ್", monthlyReport: "ಮಾಸಿಕ ವರದಿ", goLiveCertificate: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ", fullReport: "ಪೂರ್ಣ ವರದಿ", checkGenuine: CHECK_GENUINE.kn,
  helpLine: "ಸಪೋರ್ಟ್‌ಗೆ ಬರೆಯಿರಿ. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಉತ್ತರಿಸುತ್ತಾರೆ.",
  promise: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್ ಕೂಡ ಪೂರೈಕೆದಾರರಿಗೆ ಹೋಗುವುದಿಲ್ಲ; ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ.",
  handRun: "ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.",
  sourceTag: { "stand-in": "ಅಭ್ಯಾಸದ ನಕಲಿ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ", "test-mode": "ಟೆಸ್ಟ್ ಮೋಡ್, ಟೆಸ್ಟ್ ಹಣ", live: "" },
  more: (n) => `ಮತ್ತು ${n} (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ)`,
  budgetOf: (used, total) => `${total} ರಲ್ಲಿ ${used}`,
  label: {
    placed: "ನೀಡಿದ ಆರ್ಡರ್‌ಗಳು", acknowledged: "ಪೂರೈಕೆದಾರರು OK ಎಂದರು", receivedFull: "ಪೂರ್ತಿ ಬಂತು", partReceived: "ಭಾಗಶಃ ಬಂತು", wrongItem: "ತಪ್ಪು ವಸ್ತು", supplierSaidNo: "ಪೂರೈಕೆದಾರರು ಇಲ್ಲ ಎಂದರು", noAnswer: "ಪೂರೈಕೆದಾರರ ಉತ್ತರ ಇಲ್ಲ",
    neverSent: "ರದ್ದಾದ ಅಥವಾ ಕಳುಹಿಸದ", budgetUsed: "ಬಳಸಿದ ಬಜೆಟ್", budgetLeft: "ಉಳಿದ ಬಜೆಟ್", markedPaid: "ಹಣ ಕೊಟ್ಟಿದ್ದೆಂದು ಗುರುತಿಸಿದ್ದು (ನಿಮ್ಮ ಟಿಪ್ಪಣಿ)", asked: "ನಿಮ್ಮನ್ನು ಕೇಳಲಾಯಿತು", approved: "ನೀವು ಒಪ್ಪಿದ್ದು", saidNo: "ನೀವು ಇಲ್ಲ ಎಂದಿರಿ",
    stopped: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", notChecked: "ಪರಿಶೀಲಿಸದ್ದು",
  },
  stop: {
    "monthly-budget": "ತಿಂಗಳ ಬಜೆಟ್‌ಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು", "per-order-cap": "ಒಂದು ಆರ್ಡರ್‌ನ ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನವು", "order-quantity": "ತಪ್ಪಿನಂತೆ ಕಂಡ ಪ್ರಮಾಣಗಳು", "approved-supplier-only": "ನಿಮ್ಮ ಒಪ್ಪಿದ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದ ಪೂರೈಕೆದಾರರು",
    "approval-matches-order": "ಆರ್ಡರ್‌ಗೆ ಹೊಂದದ ಒಪ್ಪಿಗೆಗಳು", "one-order-per-request": "ಒಂದು ಕೋರಿಕೆಯಿಂದ ಎರಡನೇ ಆರ್ಡರ್", "reply-from-supplier": "ಪೂರೈಕೆದಾರರದ್ದಲ್ಲದ ಉತ್ತರಗಳು",
    "send-only-when-approved": "ಒಪ್ಪಿಗೆ ಇಲ್ಲದ ಕಳುಹಿಸುವಿಕೆಗಳು", "message-matches-record": "ದಾಖಲೆಗೆ ಹೊಂದದ ಸಂದೇಶಗಳು", "opt-out": "STOP ನಂತರದ ಸಂದೇಶಗಳು", other: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದ ಬೇರೆ ಏನೋ",
  },
  notChecked: { whatsapp: "ನಿಜವಾದ WhatsApp", supplier: "ನಿಜವಾದ ಪೂರೈಕೆದಾರರ ಉತ್ತರಗಳು", paying: "ಪೂರೈಕೆದಾರರಿಗೆ ಹಣ ಕೊಡುವುದು", review: "ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ" },
  notTested: {
    "real-whatsapp": "ನಿಜವಾದ WhatsApp: ನಿಜವಾದ ಖಾತೆ, Meta ಯ ನಿಜವಾದ ಟೆಂಪ್ಲೇಟ್ ಅನುಮೋದನೆ, ನಿಜವಾದ ಪೂರೈಕೆದಾರರ ಫೋನ್",
    "native-review": "ಹಿಂದಿ, ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡ ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ",
    "model-reading": "ಮಾಲೀಕರ ಕೋರಿಕೆಯನ್ನು AI ಮಾದರಿ ಓದುವುದು (ನಿಯಮಗಳ ಓದುಗ ಮಾತ್ರ ಪ್ರಯತ್ನಿಸಲಾಯಿತು; ಓದಲಾಗದ ಕೋರಿಕೆಯ ಬಗ್ಗೆ ಕೇಳಲಾಗುತ್ತದೆ, ಊಹಿಸುವುದಿಲ್ಲ)",
    "supplier-formats": "ನಿಜವಾದ ಪೂರೈಕೆದಾರರು ಉತ್ತರಿಸುವ ಹಲವು ವಿಧಗಳು (ವಾಯ್ಸ್ ನೋಟ್, ಬಿಲ್‌ನ ಫೋಟೋ, ಬೇರೆ ಲಿಪಿ, ಹಳೆಯ ಸಂದೇಶವನ್ನು ಉಲ್ಲೇಖಿಸುವ ಉತ್ತರ)",
    restart: "ಒಪ್ಪಿಗೆಯ ನಡುವೆ ರೀಸ್ಟಾರ್ಟ್ (ಪರಿಶೀಲನೆಗಳಲ್ಲಿ ಎಲ್ಲವೂ ಮೆಮೊರಿಯಲ್ಲಿತ್ತು)",
    paying: "ಪೂರೈಕೆದಾರರಿಗೆ ಹಣ ಕೊಡುವುದು (ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ; ನಿಮ್ಮದೇ ಟಿಪ್ಪಣಿ ನಿಮ್ಮ ಮಾತು ಮಾತ್ರ)",
    invoice: "ಪೂರೈಕೆದಾರರ ಇನ್‌ವಾಯ್ಸ್, ಕ್ಯಾಟಲಾಗ್‌ಗಿಂತ ಬೇರೆ ಬೆಲೆ, ಪೂರೈಕೆದಾರರ ಭಾಗಶಃ ಸಾಗಣೆ ಸೂಚನೆ, ಸರಕು ಹಿಂತಿರುಗಿಸುವುದು",
    "real-month": "ಒಪ್ಪಿಗೆ ತೆರೆದಿರುವಾಗ ತಿಂಗಳು ಬದಲಾಗುವುದು",
    "own-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅವು ಉದಾಹರಣೆ ಅಂಗಡಿ Glow Unisex Salon ಮೇಲೆ ನಡೆದವು)",
    "other-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅವು ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು)",
    "no-go-live-certificate": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ)",
    "go-live-untrusted": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಕೊಟ್ಟ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ)",
    "situations-skipped": "ಈ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆಸಲಾಗದ ಸಂದರ್ಭಗಳು (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದಲ್ಲಿ ಹೆಸರಿಸಲಾಗಿದೆ)",
  },
  notCounted: {
    "goods-really-arrived": "ಸರಕು ನಿಜವಾಗಿ ಬಂತೇ ಎಂದು: ನಿಮ್ಮದೇ ದಾಖಲೆಯನ್ನು ಮಾತ್ರ ಎಣಿಸಲಾಗುತ್ತದೆ",
    payments: "ಪೂರೈಕೆದಾರರಿಗೆ ಪಾವತಿಗಳು: ಈ ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ ಮತ್ತು ಯಾವ ಪಾವತಿಯನ್ನೂ ನೋಡಲಾಗದು; ನಿಮ್ಮದೇ ಟಿಪ್ಪಣಿಯನ್ನು ಮಾತ್ರ ಎಣಿಸಲಾಗುತ್ತದೆ",
    "outside-agent": "ಏಜೆಂಟ್‌ನ ಹೊರಗೆ ನೀಡಿದ ಆರ್ಡರ್‌ಗಳು (ಫೋನ್‌ನಲ್ಲಿ, ನೇರವಾಗಿ ಅಥವಾ ಬೇರೆ ಚಾಟ್‌ನಲ್ಲಿ)",
    "read-receipts": "ಪೂರೈಕೆದಾರರು ಸಂದೇಶ ಓದಿದರೇ ಎಂದು",
    "rule-breaks": "ಏಜೆಂಟ್ ನೋಡದ ನಿಯಮ ಉಲ್ಲಂಘನೆಗಳು: ದಾಖಲೆಯಲ್ಲಿ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು ಮತ್ತು ತಡೆಯಲ್ಪಟ್ಟದ್ದು ಮಾತ್ರ ಇದೆ",
  },
  cert: {
    date: "ದಿನಾಂಕ", held: (h, t, f, n) => `${t} ಸಂದರ್ಭಗಳಲ್ಲಿ ${h} ಸರಿಯಾಗಿ ನಿಂತವು. ${f} ತಪ್ಪಿದವು. ${n} ವಿಷಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿಲ್ಲ.`,
    intro: "ಆರಂಭಿಸುವ ಮೊದಲು ತಪ್ಪಾಗಬಹುದಾದ ಸಂದರ್ಭಗಳನ್ನು ನಾವು ಪ್ರಯತ್ನಿಸಿದೆವು: ಆರ್ಡರ್ ಸಂದೇಶದ ಕಳೆದುಹೋದ ಉತ್ತರ, ಎಂದೂ ಉತ್ತರಿಸದ ಪೂರೈಕೆದಾರ, ಬಜೆಟ್‌ನ ಕೊನೆಯ ಭಾಗಕ್ಕೆ ಎರಡು ಆರ್ಡರ್‌ಗಳ ಪೈಪೋಟಿ, ನೀವು ಒಪ್ಪಿದ ನಂತರ ಬದಲಾಗುವ ಪ್ರಮಾಣ ಅಥವಾ ಬೆಲೆ, ನಿಮ್ಮ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲದ ಪೂರೈಕೆದಾರ, ಮತ್ತು ತಪ್ಪು ವಸ್ತು ಬರುವುದು.",
    yourLimits: "ನಿಮ್ಮ ಮಿತಿಗಳು", paidRule: "ನೀವು ಅದೇ ಆರ್ಡರ್ ಅನ್ನು ಒಪ್ಪುವವರೆಗೆ ಏನೂ ಪೂರೈಕೆದಾರರಿಗೆ ಹೋಗುವುದಿಲ್ಲ, ಮತ್ತು ಏಜೆಂಟ್ ಯಾರಿಗೂ ಹಣ ಕೊಡುವುದಿಲ್ಲ",
    budget: (a) => `ತಿಂಗಳ ಬಜೆಟ್: ${a}, ಆರ್ಡರ್ ಒಪ್ಪಿದಾಗ ಮೀಸಲಿಡಲಾಗುತ್ತದೆ`, cap: (a) => `ಒಂದು ಆರ್ಡರ್ ಗರಿಷ್ಠ ${a}`, maxQty: (n) => `ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ಒಂದು ವಸ್ತುವಿನ ಗರಿಷ್ಠ ${n} ಘಟಕಗಳು`,
    suppliers: (a, p) => (p > 0 ? `${a} ಒಪ್ಪಿದ ಪೂರೈಕೆದಾರರು; ${p} ಪಟ್ಟಿಯಲ್ಲಿದ್ದಾರೆ ಆದರೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ (ಆರ್ಡರ್ ಹೋಗುವುದಿಲ್ಲ)` : `${a} ಒಪ್ಪಿದ ಪೂರೈಕೆದಾರರು`),
    followUp: (h) => `ಉತ್ತರಿಸದ ಪೂರೈಕೆದಾರರನ್ನು ${h} ಗಂಟೆಗಳ ನಂತರ ಮತ್ತೆ ಕೇಳಲಾಗುತ್ತದೆ; ಕೊನೆಯ ಬಾರಿಯ ನಂತರ ನಿಮಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ`,
    notAGrade: "ಇದು ಪ್ರಯತ್ನಿಸಿದ ಸಂದರ್ಭಗಳ ಎಣಿಕೆ ಮಾತ್ರ. ಇದು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ಕೊಡುವುದಿಲ್ಲ.", didNotHold: "ತಪ್ಪಿದವು",
    handRunLine: "ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಿದ್ದು ನಿಜವಾದ WhatsApp ಮೇಲೆ ಅಲ್ಲ, ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳ ಮೇಲೆ (stand-in services). ಯಾವ ಹಣವೂ ಚಲಿಸಲಿಲ್ಲ.", checkedOn: "ಪರಿಶೀಲನೆ ನಡೆದದ್ದು",
  },
  goLive: {
    heading: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆ",
    own: (date) => `ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆಯೇ ನಡೆದವು, ${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದ ಪ್ರಕಾರ.`,
    example: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಉದಾಹರಣೆ ಅಂಗಡಿ Glow Unisex Salon ಮೇಲೆ ನಡೆದವು, ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ಅಲ್ಲ.`,
    different: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಗಿಂತ ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು, ಆದ್ದರಿಂದ ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.`,
    untrusted: "ಒಂದು ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಡಲಾಗಿತ್ತು, ಆದರೆ ಅದನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ (ಅದರಲ್ಲಿ ಸಹಿ ಇಲ್ಲ, ಸಹಿ ಹೊಂದುವುದಿಲ್ಲ, ಅಥವಾ ಅದು ಈ ಏಜೆಂಟ್‌ನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವೇ ಅಲ್ಲ), ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ.",
    none: "ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ, ಆದ್ದರಿಂದ ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಯಾವ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು ಈ ದಾಖಲೆ ಹೇಳುವುದಿಲ್ಲ.",
    signedWith: (key) => `ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರಕ್ಕೆ ಸಹಿ ಮಾಡಿದ್ದು ${key} ಎಂಬ ಕೀಲಿಯಿಂದ. ಆ ಕೀಲಿ ಯಾರ ಬಳಿ ಇದೆ ಎಂದು ಕೀಲಿ ತೋರಿಸುವುದಿಲ್ಲ.`,
  },
  page: {
    numbers: "ಅಂಕಿಅಂಶಗಳು", item: "ಏನು", count: "ಎಷ್ಟು", amount: "ಮೊತ್ತ", ordersHeading: "ಈ ತಿಂಗಳು ಒಪ್ಪಿದ ಆರ್ಡರ್‌ಗಳು", budgetHeading: "ತಿಂಗಳ ಬಜೆಟ್", monthlyBudget: "ತಿಂಗಳ ಬಜೆಟ್", ownersNoteHeading: "ನಿಮ್ಮದೇ ಟಿಪ್ಪಣಿ",
    suppliersHeading: "ಪೂರೈಕೆದಾರರ ಪ್ರಕಾರ", supplier: "ಪೂರೈಕೆದಾರ", stoppedHeading: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", rule: "ಮಿತಿ", times: "ಬಾರಿ", notCountedHeading: "ಎಣಿಸದ್ದು", notTestedHeading: "ಪರಿಶೀಲಿಸದ್ದು",
    unconfirmed: "WhatsApp ದೃಢಪಡಿಸದ ಆರ್ಡರ್ ಸಂದೇಶಗಳು",
    checkHeading: "ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ", code: "ಕೋಡ್", digest: "ಡೈಜೆಸ್ಟ್", countedFrom: "ಎಲ್ಲಿಂದ ಎಣಿಸಿದ್ದು", setUpBy: "ಸಿದ್ಧಪಡಿಸಿದವರು", madeOn: "ಮಾಡಿದ ದಿನ", signedBy: "ಸಹಿ ಮಾಡಿದವರು", notSigned: "ಸಹಿ ಇಲ್ಲ",
    signatureNote: "ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ಮಾಡಿದರು ಮತ್ತು ಅದು ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಇದರಲ್ಲಿ ಎಣಿಸಿದ್ದೆಲ್ಲ ಪೂರ್ಣ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
    scanToCheck: "ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಇದರ .json ಫೈಲ್ ಬೇಕಾಗುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲಿಂಕ್‌ನಲ್ಲಿ ಸಹಿ ಮಾಡಿದ ಕೀ ಇಲ್ಲ: ಯಾರು ಸಹಿ ಮಾಡಿದರು ಎಂದು ತಿಳಿಯಲು ಇಲ್ಲಿ ತೋರಿಸಿದ ಕೀಯನ್ನು ನಿಮ್ಮ ಆಪರೇಟರ್ ಅಥವಾ Geometer ತಂಡ ನೀಡಿದ ಕೀಯೊಂದಿಗೆ ಹೋಲಿಸಿ.",
    scanSummary: "ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಈ ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ ಅಥವಾ ಲಿಂಕ್ ತೆರೆಯಿರಿ. ದಾಖಲೆ ನಿಜವಾದುದೇ, ಅದನ್ನು ಯಾರು ನೀಡಿದರು, ಮತ್ತು ಈ ಪುಟದೊಂದಿಗೆ ಹೋಲಿಸಲು ಲೆಕ್ಕಗಳನ್ನು ಅದು ತೋರಿಸುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ದಾಖಲೆಯ ಬಗ್ಗೆ ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲೆಕ್ಕಗಳು ಸತ್ಯ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
    notAGrade: "ಇವು ದಾಖಲೆಯಲ್ಲಿ ಕಾಣುವ ವಿಷಯಗಳ ಎಣಿಕೆ. ಇವು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ನೀಡುವುದಿಲ್ಲ.", period: "ಅವಧಿ",
    showWhatWeDid: "ನಾವು ಮಾಡಿದ್ದನ್ನು ತೋರಿಸಿ ▸", byActionHeading: "ಏಜೆಂಟ್ ಮಾಡಿದ್ದು, ಕೆಲಸದ ಪ್ರಕಾರ", action: "ಕೆಲಸ", agentVersion: "ಏಜೆಂಟ್ ಆವೃತ್ತಿ", limitsDigest: "ಮಿತಿಗಳ ಡೈಜೆಸ್ಟ್", recordDigest: "ದಾಖಲೆಯ ಡೈಜೆಸ್ಟ್", liveServices: "ನಿಜವಾದ ವ್ಯವಸ್ಥೆಗಳು",
  },
};

export const STRINGS: Record<Language, Strings> = { en, hi, ml, kn };
