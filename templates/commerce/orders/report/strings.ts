// Every word the monthly Orders report says, per language. Nothing numeric is typed here: counts, amounts and dates are filled in from the record by the per-language
// formatters in modules/language/format.ts, and these are the fixed words around them. The type makes sure no language is missing a string.
//
// Machine-written Hindi, Malayalam and Kannada. They are listed in REVIEW-hi.md, REVIEW-ml.md and REVIEW-kn.md for a native speaker, and no real shop should be given them before
// that review. The claim rules (modules/report/claims.ts) apply: a document counts and states facts; it never grades.
import { CHECK_GENUINE, SCAN_SUMMARY } from "../../../../modules/report/text.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { NotCountedId, NotTestedKey, OrderRuleId, Source } from "./data.ts";

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
  /** The owner's lines: "label: number". */
  label: { collected: string; stillToCollect: string; givenBack: string; ordersTaken: string; cancelled: string; wasAsked: string; approved: string; saidNo: string; stoppedByLimits: string; notChecked: string; orders: string };
  /** What each limit that stopped something is called. */
  stop: Record<OrderRuleId, string>;
  handRun: string;
  sourceTag: Record<Source, string>;
  more: (n: number) => string;
  /** The things an owner would expect to be checked and was not, in short. */
  notChecked: { cash: string; upi: string; whatsapp: string; razorpay: string; review: string };
  /** Each language's own name for the languages. */
  languageName: Record<Language, string>;
  /** The labels a UPI shop's report uses instead (B33): its money is what the owner marked, not what a payment service shows. */
  upiLabel: { collected: string; givenBack: string; notChecked: string };
  /** The full lists on the page: what the hand check did not cover, and what the record cannot count. */
  notTested: Record<NotTestedKey, string>;
  notCounted: Record<NotCountedId, string>;
  /** The go-live certificate: what the situations tried were, and the shop's limits in plain words. The numbers are filled in by the per-language formatters. */
  cert: {
    date: string; held(held: number, total: number, failed: number, notTested: number): string; intro: string; yourLimits: string;
    paidRule: string; menu(items: string): string; orderLimits(perDay: number, items: number, daysAhead: number): string; cutoff(daysBefore: number, time: string): string;
    advance(full: boolean, percent: number, minutes: number): string; delivery(areas: string): string; noDelivery: string; window(hours: number): string; refund(amount: string): string;
    approve(amount: string): string; noApprove: string; notAGrade: string; didNotHold: string; handRunLine: string; checkedOn: string;
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
    numbers: string; item: string; count: string; amount: string; ordersTaken: string; ordersCompleted: string; ordersCancelled: string; holdsRanOut: string; soldHeading: string; soldOrders: string;
    pickup: string; delivery: string; itemsSold: string; noItems: string; messagesHeading: string; toYou: string; heldBack: string;
    stoppedHeading: string; rule: string; times: string; stoppedCustomers: string; notCountedHeading: string; notTestedHeading: string; unconfirmed: string;
    checkHeading: string; code: string; digest: string; countedFrom: string; setUpBy: string; madeOn: string; signedBy: string; notSigned: string; signatureNote: string; scanToCheck: string; scanSummary: string; notAGrade: string; period: string;
    showWhatWeDid: string; byActionHeading: string; action: string; agentVersion: string; limitsDigest: string; recordDigest: string; liveServices: string;
  };
}

export const en: Strings = {
  agent: "Orders agent", monthlyReport: "Monthly report", goLiveCertificate: "Go-live certificate", fullReport: "Full report", checkGenuine: CHECK_GENUINE.en,
  helpLine: "Write to support. A person answers.",
  promise: "No order confirmed without the payment record (or your confirmation for UPI); every refund tracked.",
  label: { collected: "Advance collected", stillToCollect: "To collect at pickup", givenBack: "Given back", ordersTaken: "Orders taken", cancelled: "Cancelled", wasAsked: "You were asked", approved: "You approved", saidNo: "You said no", stoppedByLimits: "Stopped by your limits", notChecked: "Not checked", orders: "orders" },
  stop: {
    "price-at-or-above-menu": "Prices below your menu", "order-size": "Orders with too many items", "within-stock": "Orders past the day's stock", "within-day-cap": "Orders past the day's limit",
    "before-cutoff": "Orders after the cut-off", "within-delivery-area": "Addresses outside your delivery area", "confirm-only-when-recorded": "\"Confirmed\" with no payment on record", "one-advance-per-order": "A second advance on one order",
    "refund-limit": "Refunds above your limit", "message-matches-record": "Messages that did not match the record", "opt-out": "Messages after STOP",
  },
  handRun: "Checks were run by hand.",
  sourceTag: { "stand-in": "stand-in services, test money", "test-mode": "test mode, test money", live: "" },
  more: (n) => `and ${n} more (see the full report)`,
  notChecked: { cash: "balance paid in cash or UPI at pickup", upi: "payments outside Razorpay", whatsapp: "real WhatsApp", razorpay: "real Razorpay", review: "a native speaker's review of the wording" },
  languageName: { hi: "Hindi", en: "English", ml: "Malayalam", kn: "Kannada" },
  upiLabel: { collected: "Advance marked paid by owner", givenBack: "Refunds marked sent by owner", notChecked: "automatic payment checking (with UPI you mark each payment)" },
  notTested: {
    "balance-at-pickup": "The rest of the price, paid in cash or by UPI at pickup or delivery (only the advance is tracked)",
    "kitchen-and-delivery": "Whether the food was made, collected or delivered (an order is completed when its slot ends)",
    "order-changes": "Changing a confirmed order (a customer cancels and orders again)",
    "payments-outside-razorpay": "Payments outside Razorpay (this shop takes Razorpay)",
    "real-whatsapp": "Real WhatsApp",
    "real-razorpay": "Real Razorpay (test mode or live)",
    "webhook-signatures": "Webhook signatures",
    "real-model": "A real AI model (the rules and stand-in models were run; messages are fixed templates)",
    "other-languages": "Tamil, Telugu and other languages",
    "native-review": "A native speaker's review of the Hindi, Malayalam and Kannada wording",
    "restart-mid-step": "A crash or restart in the middle of a step",
    "same-instant": "Two customers taking the last portion at the exact same instant",
    "number-words": "Quantities written in words other than one to ten (English and Hindi) and one to five (Malayalam and Kannada)",
    "other-faults": "Faults beyond the ones the hand check lists",
    "upi-not-automatic": "automatic payment checking: with UPI the owner marks each payment received",
    "real-upi": "a real UPI app paying a real UPI ID (the owner's marks were tried, not a payment)",
    "own-settings": "These checks on this shop's own settings (the go-live certificate says they ran on the example shop, Annapurna Tiffins)",
    "other-settings": "These checks on this shop's own settings (the go-live certificate says they ran on different settings)",
    "no-go-live-certificate": "These checks on this shop's own settings (no go-live certificate was given)",
    "go-live-untrusted": "These checks on this shop's own settings (the go-live certificate that was given could not be trusted, so it was not used)",
    "situations-skipped": "Situations these settings could not run (named in the go-live certificate)",
  },
  notCounted: {
    "balance-at-pickup": "The rest of the price, paid in cash or by UPI at pickup or delivery: the record only holds the advance",
    "kitchen-and-delivery": "Whether the food was made, collected or delivered",
    "read-receipts": "Whether a customer read a message",
    "outside-agent": "Anything done outside the agent (by you or anyone else, in Razorpay, your UPI app or WhatsApp)",
    // B71 part 2: a UPI shop's own words for the line above (machine-written hi/ml/kn wait for native review, like the rest)
    "outside-agent-upi": "Anything done outside the agent (by you or anyone else, in your UPI app or WhatsApp)",
    "rule-breaks": "Rule breaks the agent did not see: the record holds what the agent did and what it was stopped from doing",
  },
  cert: {
    date: "Date", held: (h, t, f, n) => `Held ${h} of ${t} situations. ${f} failed. ${n} not tested.`,
    intro: "Before switching on, we tried situations that could go wrong: lost replies, a payment arriving twice or late, customers saying they paid when they had not, orders past the stock or after the cut-off, requests for refunds, and customers trying to trick the agent.",
    yourLimits: "Your limits", paidRule: "No order is confirmed until the payment record (or your UPI mark) shows the whole advance", menu: (items) => `Menu and the most made in a day: ${items}`,
    orderLimits: (perDay, items, ahead) => `At most ${perDay} orders a day, ${items} items in one order, up to ${ahead} days ahead`, cutoff: (days, time) => (days === 0 ? `The usual cut-off: orders close at ${time} on the same day` : `The usual cut-off: orders close at ${time}, ${days} ${days === 1 ? "day" : "days"} before`),
    advance: (full, percent, minutes) => (full ? `The whole price is paid as the advance; the order is held ${minutes} minutes for it` : `${percent}% of the price is paid as the advance; the order is held ${minutes} minutes for it`),
    delivery: (areas) => `Delivery only to: ${areas}`, noDelivery: "Pickup only, no delivery",
    window: (hours) => `Cancel at least ${hours} hours before the slot and the advance is refunded; later, it is your call`,
    refund: (amount) => `Refunds above ${amount} only with your OK`,
    approve: (amount) => `An order above ${amount} waits for your OK before any payment is asked`, noApprove: "No order waits for your OK because of its size",
    notAGrade: "This counts the situations tried. It does not grade the agent.", didNotHold: "Did not hold",
    handRunLine: "Checks were run by hand against stand-in services, not real WhatsApp or payments. Test money only.", checkedOn: "Checks run on",
  },
  goLive: {
    heading: "Go-live checks",
    own: (date) => `The go-live checks ran on this shop's own settings, in the go-live certificate of ${date}.`,
    example: (date) => `The go-live certificate of ${date} says its checks ran on the example shop, Annapurna Tiffins, not on this shop's own settings.`,
    different: (date) => `The go-live certificate of ${date} says its checks ran on different settings from this shop's, so it does not show how this shop's own settings behave.`,
    untrusted: "A go-live certificate was given, but it could not be trusted (it is not signed, its signature does not fit, or it is not a go-live certificate of this agent), so it was not used.",
    none: "No go-live certificate was given, so this document does not say what the go-live checks ran on.",
    signedWith: (key) => `The go-live certificate is signed with ${key}. A key does not show who holds it.`,
  },
  page: {
    numbers: "The numbers", item: "What", count: "How many", amount: "Amount", ordersTaken: "Orders taken", ordersCompleted: "Orders completed", ordersCancelled: "Orders cancelled after they were confirmed", holdsRanOut: "Holds that ran out before an advance", soldHeading: "Orders for days in this month", soldOrders: "Confirmed or completed orders",
    pickup: "Pickup", delivery: "Delivery", itemsSold: "Items sold", noItems: "None", messagesHeading: "Messages", toYou: "To you, the owner", heldBack: "Held back before sending",
    stoppedHeading: "What your limits stopped", rule: "Limit", times: "Times", stoppedCustomers: "Customers who sent STOP", notCountedHeading: "Not counted", notTestedHeading: "Not tested", unconfirmed: "Left unconfirmed or failed",
    checkHeading: "Check this document", code: "Code", digest: "Digest", countedFrom: "Counted from", setUpBy: "Set up by", madeOn: "Made on", signedBy: "Signed by", notSigned: "Not signed", scanToCheck: "Scan to check this paper on geometer.dev. You will need its .json file. The check runs in your browser and nothing is sent. The link does not name a signing key: to know who signed, compare the key shown here with one your partner or Geometer's team gave you.", scanSummary: SCAN_SUMMARY.en, signatureNote: "A signature shows who made this document and that it has not changed. It does not show that what it counts is complete.",
    notAGrade: "These are counts of what the record shows. They do not grade the agent.", period: "Period",
    showWhatWeDid: "Show what we did ▸", byActionHeading: "What the agent did, by action", action: "Action", agentVersion: "Agent version", limitsDigest: "Limits digest", recordDigest: "Record digest", liveServices: "Live services",
  },
};

export const hi: Strings = {
  agent: "ऑर्डर एजेंट", monthlyReport: "मासिक रिपोर्ट", goLiveCertificate: "चालू करने से पहले का जाँच प्रमाणपत्र", fullReport: "पूरी रिपोर्ट", checkGenuine: CHECK_GENUINE.hi,
  helpLine: "सपोर्ट को लिखें। एक इंसान जवाब देता है।",
  promise: "भुगतान के रिकॉर्ड (या UPI में आपकी पुष्टि) के बिना कोई ऑर्डर पक्का नहीं; हर रिफंड का हिसाब।",
  label: { collected: "एडवांस जमा हुआ", stillToCollect: "पिकअप पर लेना बाकी", givenBack: "वापस किया", ordersTaken: "लिए गए ऑर्डर", cancelled: "रद्द हुए", wasAsked: "आपसे पूछा गया", approved: "आपने मंज़ूर किया", saidNo: "आपने मना किया", stoppedByLimits: "आपकी सीमाओं ने रोका", notChecked: "जाँचा नहीं गया", orders: "ऑर्डर" },
  stop: {
    "price-at-or-above-menu": "मेन्यू से कम दाम", "order-size": "बहुत ज़्यादा चीज़ों वाले ऑर्डर", "within-stock": "दिन के स्टॉक से ज़्यादा के ऑर्डर", "within-day-cap": "दिन की सीमा से ज़्यादा ऑर्डर",
    "before-cutoff": "कट-ऑफ़ के बाद के ऑर्डर", "within-delivery-area": "डिलीवरी क्षेत्र के बाहर के पते", "confirm-only-when-recorded": "बिना भुगतान रिकॉर्ड के \"पक्का\"", "one-advance-per-order": "एक ऑर्डर का दूसरा एडवांस",
    "refund-limit": "सीमा से ऊपर के रिफंड", "message-matches-record": "रिकॉर्ड से न मिलने वाले संदेश", "opt-out": "STOP के बाद संदेश",
  },
  handRun: "जाँच हाथ से की गई।",
  sourceTag: { "stand-in": "अभ्यास वाले नकली सिस्टम, टेस्ट पैसा", "test-mode": "टेस्ट मोड, टेस्ट पैसा", live: "" },
  more: (n) => `और ${n} बातें (पूरी रिपोर्ट में)`,
  notChecked: { cash: "पिकअप पर नकद या UPI से दी गई बाकी रकम", upi: "Razorpay के बाहर के भुगतान", whatsapp: "असली WhatsApp", razorpay: "असली Razorpay", review: "शब्दों की किसी मूल भाषी से जाँच" },
  languageName: { hi: "हिंदी", en: "अंग्रेज़ी", ml: "मलयालम", kn: "कन्नड़" },
  upiLabel: { collected: "मालिक द्वारा मिला हुआ दर्ज एडवांस", givenBack: "मालिक द्वारा भेजा हुआ दर्ज रिफंड", notChecked: "भुगतान की अपने-आप जाँच (UPI में हर भुगतान आप दर्ज करते हैं)" },
  notTested: {
    "balance-at-pickup": "बाकी रकम, जो पिकअप या डिलीवरी पर नकद या UPI से दी जाती है (सिर्फ़ एडवांस का हिसाब रखा जाता है)",
    "kitchen-and-delivery": "खाना बना, लिया गया या पहुँचा या नहीं (स्लॉट खत्म होने पर ऑर्डर पूरा माना जाता है)",
    "order-changes": "पक्के ऑर्डर में बदलाव (ग्राहक रद्द करके दोबारा ऑर्डर करता है)",
    "payments-outside-razorpay": "Razorpay के बाहर के भुगतान (यह दुकान Razorpay से लेती है)",
    "real-whatsapp": "असली WhatsApp",
    "real-razorpay": "असली Razorpay (टेस्ट मोड या लाइव)",
    "webhook-signatures": "वेबहुक के हस्ताक्षर",
    "real-model": "असली AI मॉडल (नियम और नकली मॉडल चलाए गए; संदेश तय साँचे वाले हैं)",
    "other-languages": "तमिल, तेलुगु और दूसरी भाषाएँ",
    "native-review": "हिंदी, मलयालम और कन्नड़ के शब्दों की किसी मूल भाषी से जाँच",
    "restart-mid-step": "किसी कदम के बीच में क्रैश या रीस्टार्ट",
    "same-instant": "ठीक एक ही पल में आखिरी हिस्सा लेने वाले दो ग्राहक",
    "number-words": "एक से दस (अंग्रेज़ी और हिंदी में) और एक से पाँच (मलयालम और कन्नड़ में) के अलावा शब्दों में लिखी मात्राएँ",
    "other-faults": "हाथ की जाँच में बताई गई गड़बड़ियों से अलग गड़बड़ियाँ",
    "upi-not-automatic": "भुगतान की अपने-आप जाँच: UPI में हर भुगतान मालिक खुद मिला हुआ दर्ज करते हैं",
    "real-upi": "असली UPI ऐप से असली UPI ID पर भुगतान (मालिक का दर्ज करना आज़माया गया, भुगतान नहीं)",
    "own-settings": "ये जाँचें इस दुकान की अपनी सेटिंग पर (चालू करने से पहले का जाँच प्रमाणपत्र कहता है कि वे उदाहरण दुकान Annapurna Tiffins पर चली थीं)",
    "other-settings": "ये जाँचें इस दुकान की अपनी सेटिंग पर (जाँच प्रमाणपत्र कहता है कि वे अलग सेटिंग पर चली थीं)",
    "no-go-live-certificate": "ये जाँचें इस दुकान की अपनी सेटिंग पर (कोई जाँच प्रमाणपत्र नहीं दिया गया)",
    "go-live-untrusted": "ये जाँचें इस दुकान की अपनी सेटिंग पर (जो जाँच प्रमाणपत्र दिया गया उस पर भरोसा नहीं किया जा सका, इसलिए उसे इस्तेमाल नहीं किया गया)",
    "situations-skipped": "वे स्थितियाँ जो इन सेटिंग पर चल नहीं सकीं (जाँच प्रमाणपत्र में उनके नाम हैं)",
  },
  notCounted: {
    "balance-at-pickup": "बाकी रकम जो पिकअप या डिलीवरी पर नकद या UPI से दी गई: रिकॉर्ड में सिर्फ़ एडवांस है",
    "kitchen-and-delivery": "खाना बना, लिया गया या पहुँचा या नहीं",
    "read-receipts": "ग्राहक ने संदेश पढ़ा या नहीं",
    "outside-agent": "एजेंट के बाहर किया गया कोई भी काम (आपने या किसी और ने Razorpay, UPI ऐप या WhatsApp में किया)",
    "outside-agent-upi": "एजेंट के बाहर किया गया कोई भी काम (आपने या किसी और ने UPI ऐप या WhatsApp में किया)",
    "rule-breaks": "वे नियम-उल्लंघन जो एजेंट ने देखे नहीं: रिकॉर्ड में वही है जो एजेंट ने किया या जिससे उसे रोका गया",
  },
  cert: {
    date: "तारीख़", held: (h, t, f, n) => `${t} में से ${h} स्थितियाँ ठीक रहीं। ${f} में गड़बड़ हुई। ${n} बातें जाँची नहीं गईं।`,
    intro: "चालू करने से पहले हमने वे स्थितियाँ आज़माईं जो गलत हो सकती थीं: खोए हुए जवाब, दो बार या देर से आया भुगतान, बिना भरे \"भर दिया\" कहने वाले ग्राहक, स्टॉक से ज़्यादा या कट-ऑफ़ के बाद के ऑर्डर, रिफंड की माँग, और एजेंट को चकमा देने वाले ग्राहक।",
    yourLimits: "आपकी सीमाएँ", paidRule: "भुगतान का रिकॉर्ड (या UPI में आपका दर्ज करना) पूरा एडवांस न दिखाए तो ऑर्डर पक्का नहीं होता", menu: (items) => `मेन्यू और एक दिन में ज़्यादा से ज़्यादा बनने वाली मात्रा: ${items}`,
    orderLimits: (perDay, items, ahead) => `एक दिन में ज़्यादा से ज़्यादा ${perDay} ऑर्डर, एक ऑर्डर में ${items} चीज़ें, ${ahead} दिन आगे तक`, cutoff: (days, time) => (days === 0 ? `आम कट-ऑफ़: ऑर्डर उसी दिन ${time} पर बंद होते हैं` : `आम कट-ऑफ़: ऑर्डर ${days} दिन पहले ${time} पर बंद होते हैं`),
    advance: (full, percent, minutes) => (full ? `पूरी कीमत एडवांस में ली जाती है; इसके लिए ऑर्डर ${minutes} मिनट रोका जाता है` : `कीमत का ${percent}% एडवांस में लिया जाता है; इसके लिए ऑर्डर ${minutes} मिनट रोका जाता है`),
    delivery: (areas) => `डिलीवरी सिर्फ़ यहाँ: ${areas}`, noDelivery: "सिर्फ़ पिकअप, डिलीवरी नहीं",
    window: (hours) => `स्लॉट से कम से कम ${hours} घंटे पहले रद्द करने पर एडवांस वापस होता है; उसके बाद का फ़ैसला आपका`,
    refund: (amount) => `${amount} से ऊपर का रिफंड आपसे पूछकर`,
    approve: (amount) => `${amount} से ऊपर का ऑर्डर कोई भुगतान माँगने से पहले आपकी मंज़ूरी का इंतज़ार करता है`, noApprove: "कोई ऑर्डर सिर्फ़ बड़े होने की वजह से आपकी मंज़ूरी का इंतज़ार नहीं करता",
    notAGrade: "यह आज़माई गई स्थितियों की गिनती है। यह एजेंट को अंक या दर्जा नहीं देती।", didNotHold: "जिनमें गड़बड़ हुई",
    handRunLine: "जाँच हाथ से की गई, असली WhatsApp या पेमेंट पर नहीं, बल्कि अभ्यास वाले नकली सिस्टम (stand-in services) पर। सिर्फ़ टेस्ट पैसा।", checkedOn: "जाँच इन पर की गई",
  },
  goLive: {
    heading: "चालू करने से पहले की जाँच",
    own: (date) => `चालू करने से पहले की जाँच इसी दुकान की अपनी सेटिंग पर चली थी, ${date} के जाँच प्रमाणपत्र के अनुसार।`,
    example: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच उदाहरण दुकान Annapurna Tiffins पर चली थी, इस दुकान की अपनी सेटिंग पर नहीं।`,
    different: (date) => `${date} का जाँच प्रमाणपत्र कहता है कि उसकी जाँच इस दुकान से अलग सेटिंग पर चली थी, इसलिए उससे इस दुकान की अपनी सेटिंग का हाल पता नहीं चलता।`,
    untrusted: "एक जाँच प्रमाणपत्र दिया गया था, पर उस पर भरोसा नहीं किया जा सका (उस पर हस्ताक्षर नहीं है, हस्ताक्षर नहीं बैठता, या वह इस एजेंट का जाँच प्रमाणपत्र है ही नहीं), इसलिए उसे इस्तेमाल नहीं किया गया।",
    none: "कोई जाँच प्रमाणपत्र नहीं दिया गया, इसलिए यह दस्तावेज़ नहीं बताता कि चालू करने से पहले की जाँच किस सेटिंग पर चली थी।",
    signedWith: (key) => `जाँच प्रमाणपत्र पर ${key} कुंजी से हस्ताक्षर हैं। कुंजी यह नहीं बताती कि वह किसके पास है।`,
  },
  page: {
    numbers: "आँकड़े", item: "क्या", count: "कितने", amount: "रकम", ordersTaken: "लिए गए ऑर्डर", ordersCompleted: "पूरे हुए ऑर्डर", ordersCancelled: "पक्के होने के बाद रद्द हुए ऑर्डर", holdsRanOut: "एडवांस आने से पहले खत्म हुए होल्ड", soldHeading: "इस महीने के दिनों के ऑर्डर", soldOrders: "पक्के या पूरे हुए ऑर्डर",
    pickup: "पिकअप", delivery: "डिलीवरी", itemsSold: "बिकी चीज़ें", noItems: "कोई नहीं", messagesHeading: "संदेश", toYou: "आपको, मालिक को", heldBack: "भेजने से पहले रोके गए",
    stoppedHeading: "आपकी सीमाओं ने क्या रोका", rule: "सीमा", times: "बार", stoppedCustomers: "STOP भेजने वाले ग्राहक", notCountedHeading: "गिना नहीं गया", notTestedHeading: "जाँचा नहीं गया", unconfirmed: "जो पक्का नहीं हुआ या नहीं हो पाया",
    checkHeading: "इस दस्तावेज़ को जाँचें", code: "कोड", digest: "डाइजेस्ट", countedFrom: "कहाँ से गिना", setUpBy: "तैयार किया", madeOn: "बनाया गया", signedBy: "हस्ताक्षर", notSigned: "हस्ताक्षर नहीं", scanToCheck: "इस दस्तावेज़ को geometer.dev पर जाँचने के लिए स्कैन करें। इसकी .json फ़ाइल चाहिए होगी। जाँच आपके ब्राउज़र में होती है, कुछ भेजा नहीं जाता। लिंक में हस्ताक्षर की कुंजी नहीं है: किसने हस्ताक्षर किए यह जानने के लिए यहाँ दिखी कुंजी को उस कुंजी से मिलाएँ जो आपके पार्टनर या Geometer की टीम ने दी है।", scanSummary: SCAN_SUMMARY.hi, signatureNote: "हस्ताक्षर दिखाता है कि यह दस्तावेज़ किसने बनाया और यह बदला नहीं है। यह नहीं दिखाता कि इसमें गिनी गई बातें पूरी हैं।",
    notAGrade: "ये रिकॉर्ड में दिखी बातों की गिनती हैं। ये एजेंट को अंक या दर्जा नहीं देतीं।", period: "अवधि",
    showWhatWeDid: "देखें हमने क्या किया ▸", byActionHeading: "एजेंट ने क्या किया, काम के हिसाब से", action: "काम", agentVersion: "एजेंट का संस्करण", limitsDigest: "सीमाओं का डाइजेस्ट", recordDigest: "रिकॉर्ड का डाइजेस्ट", liveServices: "असली सिस्टम",
  },
};

export const ml: Strings = {
  agent: "ഓർഡർ ഏജന്റ്", monthlyReport: "പ്രതിമാസ റിപ്പോർട്ട്", goLiveCertificate: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനാ സർട്ടിഫിക്കറ്റ്", fullReport: "പൂർണ്ണ റിപ്പോർട്ട്", checkGenuine: CHECK_GENUINE.ml,
  helpLine: "സപ്പോർട്ടിന് എഴുതുക. ഒരു വ്യക്തി മറുപടി നൽകും.",
  promise: "പേയ്മെന്റ് രേഖയില്ലാതെ (UPI-യിൽ നിങ്ങളുടെ സ്ഥിരീകരണമില്ലാതെ) ഒരു ഓർഡറും ഉറപ്പിക്കില്ല; ഓരോ റീഫണ്ടും രേഖപ്പെടുത്തുന്നു.",
  label: { collected: "പിരിഞ്ഞ അഡ്വാൻസ്", stillToCollect: "പിക്കപ്പിൽ വാങ്ങാനുള്ളത്", givenBack: "തിരികെ നൽകിയത്", ordersTaken: "എടുത്ത ഓർഡറുകൾ", cancelled: "റദ്ദാക്കിയത്", wasAsked: "നിങ്ങളോട് ചോദിച്ചു", approved: "നിങ്ങൾ അംഗീകരിച്ചു", saidNo: "നിങ്ങൾ വേണ്ടെന്ന് പറഞ്ഞു", stoppedByLimits: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", notChecked: "പരിശോധിക്കാത്തത്", orders: "ഓർഡറുകൾ" },
  stop: {
    "price-at-or-above-menu": "മെനുവിലെ വിലയേക്കാൾ കുറഞ്ഞ വില", "order-size": "വളരെയധികം സാധനങ്ങളുള്ള ഓർഡറുകൾ", "within-stock": "ദിവസത്തെ സ്റ്റോക്കിന് മുകളിലുള്ള ഓർഡറുകൾ", "within-day-cap": "ദിവസത്തെ പരിധിക്ക് മുകളിലുള്ള ഓർഡറുകൾ",
    "before-cutoff": "കട്ട്-ഓഫിന് ശേഷമുള്ള ഓർഡറുകൾ", "within-delivery-area": "ഡെലിവറി ഏരിയയ്ക്ക് പുറത്തുള്ള വിലാസങ്ങൾ", "confirm-only-when-recorded": "പേയ്മെന്റ് രേഖയില്ലാത്ത \"ഉറപ്പിച്ചു\"", "one-advance-per-order": "ഒരു ഓർഡറിന്റെ രണ്ടാം അഡ്വാൻസ്",
    "refund-limit": "പരിധിക്ക് മുകളിലുള്ള റീഫണ്ട്", "message-matches-record": "രേഖയുമായി ചേരാത്ത സന്ദേശങ്ങൾ", "opt-out": "STOP-ന് ശേഷമുള്ള സന്ദേശങ്ങൾ",
  },
  handRun: "പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തു.",
  sourceTag: { "stand-in": "പരിശീലന സംവിധാനങ്ങൾ, ടെസ്റ്റ് പണം", "test-mode": "ടെസ്റ്റ് മോഡ്, ടെസ്റ്റ് പണം", live: "" },
  more: (n) => `കൂടാതെ ${n} കാര്യങ്ങൾ (മുഴുവൻ റിപ്പോർട്ടിൽ)`,
  notChecked: { cash: "പിക്കപ്പിൽ പണമായോ UPI വഴിയോ അടച്ച ബാക്കി തുക", upi: "Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ", whatsapp: "യഥാർത്ഥ WhatsApp", razorpay: "യഥാർത്ഥ Razorpay", review: "വാക്കുകളെക്കുറിച്ച് ഒരു മാതൃഭാഷക്കാരന്റെ പരിശോധന" },
  languageName: { hi: "ഹിന്ദി", en: "ഇംഗ്ലീഷ്", ml: "മലയാളം", kn: "കന്നഡ" },
  upiLabel: { collected: "ഉടമ കിട്ടിയതായി രേഖപ്പെടുത്തിയ അഡ്വാൻസ്", givenBack: "ഉടമ അയച്ചതായി രേഖപ്പെടുത്തിയ റീഫണ്ട്", notChecked: "പണമടവ് സ്വയം പരിശോധിക്കൽ (UPI-യിൽ ഓരോ പണമടവും നിങ്ങൾ രേഖപ്പെടുത്തുന്നു)" },
  notTested: {
    "balance-at-pickup": "വിലയുടെ ബാക്കി, പിക്കപ്പിലോ ഡെലിവറിയിലോ പണമായോ UPI വഴിയോ അടയ്ക്കുന്നത് (അഡ്വാൻസ് മാത്രമേ രേഖപ്പെടുത്തൂ)",
    "kitchen-and-delivery": "ഭക്ഷണം ഉണ്ടാക്കിയോ, എടുത്തോ, എത്തിച്ചോ എന്നത് (സ്ലോട്ട് തീരുമ്പോൾ ഓർഡർ പൂർത്തിയായതായി കണക്കാക്കുന്നു)",
    "order-changes": "ഉറപ്പിച്ച ഓർഡറിൽ മാറ്റം വരുത്തുന്നത് (ഉപഭോക്താവ് റദ്ദാക്കി വീണ്ടും ഓർഡർ ചെയ്യണം)",
    "payments-outside-razorpay": "Razorpay-ക്ക് പുറത്തുള്ള പേയ്മെന്റുകൾ (ഈ കട Razorpay വഴി വാങ്ങുന്നു)",
    "real-whatsapp": "യഥാർത്ഥ WhatsApp",
    "real-razorpay": "യഥാർത്ഥ Razorpay (ടെസ്റ്റ് മോഡ് അല്ലെങ്കിൽ ലൈവ്)",
    "webhook-signatures": "വെബ്ഹുക്ക് ഒപ്പുകൾ",
    "real-model": "യഥാർത്ഥ AI മോഡൽ (നിയമങ്ങളും മാതൃകാ മോഡലുകളും ഓടിച്ചു; സന്ദേശങ്ങൾ നിശ്ചിത ടെംപ്ലേറ്റുകളാണ്)",
    "other-languages": "തമിഴ്, തെലുങ്ക്, മറ്റ് ഭാഷകൾ",
    "native-review": "ഹിന്ദി, മലയാളം, കന്നഡ വാക്കുകളെക്കുറിച്ച് മാതൃഭാഷക്കാരുടെ പരിശോധന",
    "restart-mid-step": "ഒരു ഘട്ടത്തിന്റെ നടുവിൽ ക്രാഷ് അല്ലെങ്കിൽ റീസ്റ്റാർട്ട്",
    "same-instant": "ഒരേ നിമിഷത്തിൽ അവസാനത്തെ പങ്ക് എടുക്കുന്ന രണ്ട് ഉപഭോക്താക്കൾ",
    "number-words": "ഒന്നു മുതൽ പത്തുവരെ (ഇംഗ്ലീഷിലും ഹിന്ദിയിലും), ഒന്നു മുതൽ അഞ്ചുവരെ (മലയാളത്തിലും കന്നഡയിലും) എന്നിവയല്ലാത്ത വാക്കുകളിൽ എഴുതിയ എണ്ണങ്ങൾ",
    "other-faults": "കൈ പരിശോധനയിൽ പറഞ്ഞ തകരാറുകൾക്ക് പുറത്തുള്ള തകരാറുകൾ",
    "upi-not-automatic": "പണമടവ് സ്വയം പരിശോധിക്കൽ: UPI-യിൽ ഓരോ പണമടവും ഉടമ തന്നെ കിട്ടിയതായി രേഖപ്പെടുത്തുന്നു",
    "real-upi": "യഥാർത്ഥ UPI ആപ്പിൽ നിന്ന് യഥാർത്ഥ UPI ID-യിലേക്കുള്ള പണമടവ് (ഉടമയുടെ രേഖപ്പെടുത്തലാണ് പരീക്ഷിച്ചത്, പണമടവല്ല)",
    "own-settings": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അവ ഉദാഹരണ കടയായ Annapurna Tiffins-ൽ നടത്തി എന്നാണ്)",
    "other-settings": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അവ വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിൽ നടത്തി എന്നാണ്)",
    "no-go-live-certificate": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല)",
    "go-live-untrusted": "ഈ പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ (നൽകിയ പരിശോധനാ സർട്ടിഫിക്കറ്റ് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഉപയോഗിച്ചില്ല)",
    "situations-skipped": "ഈ ക്രമീകരണങ്ങളിൽ നടത്താൻ കഴിയാത്ത സാഹചര്യങ്ങൾ (പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ അവയുടെ പേരുകളുണ്ട്)",
  },
  notCounted: {
    "balance-at-pickup": "പിക്കപ്പിലോ ഡെലിവറിയിലോ പണമായോ UPI വഴിയോ അടച്ച ബാക്കി തുക: രേഖയിൽ അഡ്വാൻസ് മാത്രമേയുള്ളൂ",
    "kitchen-and-delivery": "ഭക്ഷണം ഉണ്ടാക്കിയോ, എടുത്തോ, എത്തിച്ചോ എന്നത്",
    "read-receipts": "ഉപഭോക്താവ് സന്ദേശം വായിച്ചോ ഇല്ലയോ",
    "outside-agent": "ഏജന്റിന് പുറത്ത് ചെയ്ത എന്തും (നിങ്ങളോ മറ്റാരെങ്കിലുമോ Razorpay-യിലോ UPI ആപ്പിലോ WhatsApp-ലോ ചെയ്തത്)",
    "outside-agent-upi": "ഏജന്റിന് പുറത്ത് ചെയ്ത എന്തും (നിങ്ങളോ മറ്റാരെങ്കിലുമോ UPI ആപ്പിലോ WhatsApp-ലോ ചെയ്തത്)",
    "rule-breaks": "ഏജന്റ് കാണാത്ത നിയമലംഘനങ്ങൾ: ഏജന്റ് ചെയ്തതും തടഞ്ഞതും മാത്രമാണ് രേഖയിലുള്ളത്",
  },
  cert: {
    date: "തീയതി", held: (h, t, f, n) => `${t} സാഹചര്യങ്ങളിൽ ${h} എണ്ണം ശരിയായി നിന്നു. ${f} എണ്ണം പിഴച്ചു. ${n} കാര്യങ്ങൾ പരിശോധിച്ചിട്ടില്ല.`,
    intro: "തുടങ്ങുന്നതിന് മുമ്പ് തെറ്റാൻ സാധ്യതയുള്ള സാഹചര്യങ്ങൾ ഞങ്ങൾ പരീക്ഷിച്ചു: നഷ്ടപ്പെട്ട മറുപടികൾ, രണ്ടുതവണയോ വൈകിയോ വന്ന പേയ്മെന്റ്, അടയ്ക്കാതെ \"അടച്ചു\" എന്ന് പറയുന്ന ഉപഭോക്താക്കൾ, സ്റ്റോക്കിന് മുകളിലോ കട്ട്-ഓഫിന് ശേഷമോ ഉള്ള ഓർഡറുകൾ, റീഫണ്ടിനുള്ള അഭ്യർത്ഥനകൾ, ഏജന്റിനെ കബളിപ്പിക്കാൻ ശ്രമിക്കുന്ന ഉപഭോക്താക്കൾ.",
    yourLimits: "നിങ്ങളുടെ പരിധികൾ", paidRule: "പേയ്മെന്റ് രേഖ (അല്ലെങ്കിൽ UPI-യിൽ നിങ്ങളുടെ രേഖപ്പെടുത്തൽ) മുഴുവൻ അഡ്വാൻസും കാണിക്കുന്നതുവരെ ഒരു ഓർഡറും ഉറപ്പിക്കില്ല", menu: (items) => `മെനുവും ഒരു ദിവസം പരമാവധി ഉണ്ടാക്കുന്നതും: ${items}`,
    orderLimits: (perDay, items, ahead) => `ഒരു ദിവസം പരമാവധി ${perDay} ഓർഡറുകൾ, ഒരു ഓർഡറിൽ ${items} സാധനങ്ങൾ, ${ahead} ദിവസം മുൻകൂട്ടി വരെ`, cutoff: (days, time) => (days === 0 ? `സാധാരണ കട്ട്-ഓഫ്: അതേ ദിവസം ${time}-ന് ഓർഡറുകൾ അടയ്ക്കും` : `സാധാരണ കട്ട്-ഓഫ്: ${days} ദിവസം മുമ്പ് ${time}-ന് ഓർഡറുകൾ അടയ്ക്കും`),
    advance: (full, percent, minutes) => (full ? `മുഴുവൻ വിലയും അഡ്വാൻസായി വാങ്ങുന്നു; അതിനായി ഓർഡർ ${minutes} മിനിറ്റ് പിടിച്ചുവെക്കും` : `വിലയുടെ ${percent}% അഡ്വാൻസായി വാങ്ങുന്നു; അതിനായി ഓർഡർ ${minutes} മിനിറ്റ് പിടിച്ചുവെക്കും`),
    delivery: (areas) => `ഡെലിവറി ഇവിടങ്ങളിൽ മാത്രം: ${areas}`, noDelivery: "പിക്കപ്പ് മാത്രം, ഡെലിവറി ഇല്ല",
    window: (hours) => `സ്ലോട്ടിന് കുറഞ്ഞത് ${hours} മണിക്കൂർ മുമ്പ് റദ്ദാക്കിയാൽ അഡ്വാൻസ് തിരികെ കിട്ടും; അതിനു ശേഷമുള്ളത് നിങ്ങളുടെ തീരുമാനം`,
    refund: (amount) => `${amount}-ന് മുകളിലുള്ള റീഫണ്ട് നിങ്ങളോട് ചോദിച്ച ശേഷം മാത്രം`,
    approve: (amount) => `${amount}-ന് മുകളിലുള്ള ഓർഡർ ഒരു പേയ്മെന്റും ചോദിക്കുന്നതിന് മുമ്പ് നിങ്ങളുടെ അനുമതിക്കായി കാത്തിരിക്കും`, noApprove: "വലുപ്പം കൊണ്ടു മാത്രം ഒരു ഓർഡറും നിങ്ങളുടെ അനുമതിക്കായി കാത്തിരിക്കില്ല",
    notAGrade: "ഇത് പരീക്ഷിച്ച സാഹചര്യങ്ങളുടെ എണ്ണം മാത്രമാണ്. ഇത് ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", didNotHold: "പിഴച്ചവ",
    handRunLine: "പരിശോധനകൾ കൈകൊണ്ട് ചെയ്തത് യഥാർത്ഥ WhatsApp, പേയ്മെന്റ് എന്നിവയിലല്ല, പരിശീലന സംവിധാനങ്ങളിലാണ് (stand-in services). ടെസ്റ്റ് പണം മാത്രം.", checkedOn: "പരിശോധിച്ചത്",
  },
  goLive: {
    heading: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധന",
    own: (date) => `തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ തന്നെയാണ് നടത്തിയത്, ${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പ്രകാരം.`,
    example: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഉദാഹരണ കടയായ Annapurna Tiffins-ൽ ആണ് നടത്തിയത് എന്നാണ്, ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങളിൽ അല്ല.`,
    different: (date) => `${date}-ലെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് പറയുന്നത് അതിലെ പരിശോധനകൾ ഈ കടയുടേതിൽ നിന്ന് വ്യത്യസ്തമായ ക്രമീകരണങ്ങളിലാണ് നടത്തിയത് എന്നാണ്, അതിനാൽ ഈ കടയുടെ സ്വന്തം ക്രമീകരണങ്ങൾ എങ്ങനെ പ്രവർത്തിക്കുന്നു എന്ന് അത് കാണിക്കുന്നില്ല.`,
    untrusted: "ഒരു പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിരുന്നു, പക്ഷേ അത് വിശ്വസിക്കാൻ കഴിഞ്ഞില്ല (അതിൽ ഒപ്പില്ല, ഒപ്പ് ചേരുന്നില്ല, അല്ലെങ്കിൽ അത് ഈ ഏജന്റിന്റെ പരിശോധനാ സർട്ടിഫിക്കറ്റ് അല്ല), അതിനാൽ ഉപയോഗിച്ചില്ല.",
    none: "പരിശോധനാ സർട്ടിഫിക്കറ്റ് നൽകിയിട്ടില്ല, അതിനാൽ തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനകൾ ഏത് ക്രമീകരണങ്ങളിലാണ് നടത്തിയതെന്ന് ഈ രേഖ പറയുന്നില്ല.",
    signedWith: (key) => `പരിശോധനാ സർട്ടിഫിക്കറ്റിൽ ഒപ്പിട്ടത് ${key} എന്ന കീ ഉപയോഗിച്ചാണ്. ആ കീ ആരുടെ കൈയിലാണെന്ന് കീ കാണിക്കുന്നില്ല.`,
  },
  page: {
    numbers: "കണക്കുകൾ", item: "എന്ത്", count: "എത്ര", amount: "തുക", ordersTaken: "എടുത്ത ഓർഡറുകൾ", ordersCompleted: "പൂർത്തിയായ ഓർഡറുകൾ", ordersCancelled: "ഉറപ്പിച്ചതിന് ശേഷം റദ്ദാക്കിയ ഓർഡറുകൾ", holdsRanOut: "അഡ്വാൻസ് വരുന്നതിന് മുമ്പ് തീർന്ന ഹോൾഡുകൾ", soldHeading: "ഈ മാസത്തെ ദിവസങ്ങളിലെ ഓർഡറുകൾ", soldOrders: "ഉറപ്പിച്ചതോ പൂർത്തിയായതോ ആയ ഓർഡറുകൾ",
    pickup: "പിക്കപ്പ്", delivery: "ഡെലിവറി", itemsSold: "വിറ്റ സാധനങ്ങൾ", noItems: "ഒന്നുമില്ല", messagesHeading: "സന്ദേശങ്ങൾ", toYou: "നിങ്ങൾക്ക്, ഉടമയ്ക്ക്", heldBack: "അയയ്ക്കുന്നതിന് മുമ്പ് തടഞ്ഞത്",
    stoppedHeading: "നിങ്ങളുടെ പരിധികൾ തടഞ്ഞത്", rule: "പരിധി", times: "തവണ", stoppedCustomers: "STOP അയച്ച ഉപഭോക്താക്കൾ", notCountedHeading: "എണ്ണാത്തത്", notTestedHeading: "പരിശോധിക്കാത്തത്", unconfirmed: "ഉറപ്പാകാത്തതോ പരാജയപ്പെട്ടതോ",
    checkHeading: "ഈ രേഖ പരിശോധിക്കുക", code: "കോഡ്", digest: "ഡൈജസ്റ്റ്", countedFrom: "എവിടെ നിന്ന് എണ്ണി", setUpBy: "തയ്യാറാക്കിയത്", madeOn: "ഉണ്ടാക്കിയ തീയതി", signedBy: "ഒപ്പിട്ടത്", notSigned: "ഒപ്പിട്ടിട്ടില്ല", scanToCheck: "ഈ രേഖ geometer.dev-ൽ പരിശോധിക്കാൻ സ്കാൻ ചെയ്യുക. ഇതിന്റെ .json ഫയൽ വേണ്ടിവരും. പരിശോധന നിങ്ങളുടെ ബ്രൗസറിൽ നടക്കുന്നു, ഒന്നും അയയ്ക്കുന്നില്ല. ലിങ്കിൽ ഒപ്പിട്ട കീ ഇല്ല: ആര് ഒപ്പിട്ടു എന്നറിയാൻ ഇവിടെ കാണുന്ന കീ, നിങ്ങളുടെ പങ്കാളിയോ Geometer ടീമോ തന്ന കീയുമായി ഒത്തുനോക്കുക.", scanSummary: SCAN_SUMMARY.ml, signatureNote: "ഈ രേഖ ആരാണ് ഉണ്ടാക്കിയതെന്നും അത് മാറിയിട്ടില്ലെന്നും ഒപ്പ് കാണിക്കുന്നു. ഇതിൽ എണ്ണിയതെല്ലാം പൂർണ്ണമാണെന്ന് അത് കാണിക്കുന്നില്ല.",
    notAGrade: "ഇവ രേഖയിൽ കാണുന്നതിന്റെ എണ്ണം മാത്രമാണ്. ഇവ ഏജന്റിന് മാർക്കോ ഗ്രേഡോ നൽകുന്നില്ല.", period: "കാലയളവ്",
    showWhatWeDid: "ഞങ്ങൾ ചെയ്തത് കാണിക്കുക ▸", byActionHeading: "ഏജന്റ് ചെയ്തത്, പ്രവൃത്തി അനുസരിച്ച്", action: "പ്രവൃത്തി", agentVersion: "ഏജന്റ് പതിപ്പ്", limitsDigest: "പരിധികളുടെ ഡൈജസ്റ്റ്", recordDigest: "രേഖയുടെ ഡൈജസ്റ്റ്", liveServices: "യഥാർത്ഥ സംവിധാനങ്ങൾ",
  },
};

export const kn: Strings = {
  agent: "ಆರ್ಡರ್ ಏಜೆಂಟ್", monthlyReport: "ಮಾಸಿಕ ವರದಿ", goLiveCertificate: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ", fullReport: "ಪೂರ್ಣ ವರದಿ", checkGenuine: CHECK_GENUINE.kn,
  helpLine: "ಸಪೋರ್ಟ್‌ಗೆ ಬರೆಯಿರಿ. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಉತ್ತರಿಸುತ್ತಾರೆ.",
  promise: "ಪಾವತಿ ದಾಖಲೆ (ಅಥವಾ UPI ಯಲ್ಲಿ ನಿಮ್ಮ ದೃಢೀಕರಣ) ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್ ಅನ್ನೂ ಖಚಿತಪಡಿಸುವುದಿಲ್ಲ; ಪ್ರತಿ ರೀಫಂಡ್ ದಾಖಲಾಗುತ್ತದೆ.",
  label: { collected: "ಸಂಗ್ರಹವಾದ ಮುಂಗಡ", stillToCollect: "ಪಿಕಪ್‌ನಲ್ಲಿ ಪಡೆಯಬೇಕಾದದ್ದು", givenBack: "ಮರಳಿ ಕೊಟ್ಟದ್ದು", ordersTaken: "ತೆಗೆದುಕೊಂಡ ಆರ್ಡರ್‌ಗಳು", cancelled: "ರದ್ದಾದವು", wasAsked: "ನಿಮ್ಮನ್ನು ಕೇಳಲಾಯಿತು", approved: "ನೀವು ಒಪ್ಪಿದ್ದು", saidNo: "ನೀವು ಬೇಡ ಎಂದದ್ದು", stoppedByLimits: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", notChecked: "ಪರಿಶೀಲಿಸದ್ದು", orders: "ಆರ್ಡರ್‌ಗಳು" },
  stop: {
    "price-at-or-above-menu": "ಮೆನುವಿಗಿಂತ ಕಡಿಮೆ ಬೆಲೆ", "order-size": "ತುಂಬ ವಸ್ತುಗಳ ಆರ್ಡರ್‌ಗಳು", "within-stock": "ದಿನದ ಸ್ಟಾಕ್‌ಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು", "within-day-cap": "ದಿನದ ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್‌ಗಳು",
    "before-cutoff": "ಕಟ್-ಆಫ್ ನಂತರದ ಆರ್ಡರ್‌ಗಳು", "within-delivery-area": "ಡೆಲಿವರಿ ಪ್ರದೇಶದ ಹೊರಗಿನ ವಿಳಾಸಗಳು", "confirm-only-when-recorded": "ಪಾವತಿ ದಾಖಲೆ ಇಲ್ಲದ \"ಖಚಿತ\"", "one-advance-per-order": "ಒಂದು ಆರ್ಡರ್‌ನ ಎರಡನೇ ಮುಂಗಡ",
    "refund-limit": "ಮಿತಿಗಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್", "message-matches-record": "ದಾಖಲೆಗೆ ಹೊಂದದ ಸಂದೇಶಗಳು", "opt-out": "STOP ನಂತರದ ಸಂದೇಶಗಳು",
  },
  handRun: "ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಲಾಗಿದೆ.",
  sourceTag: { "stand-in": "ಅಭ್ಯಾಸದ ನಕಲಿ ವ್ಯವಸ್ಥೆಗಳು, ಟೆಸ್ಟ್ ಹಣ", "test-mode": "ಟೆಸ್ಟ್ ಮೋಡ್, ಟೆಸ್ಟ್ ಹಣ", live: "" },
  more: (n) => `ಇನ್ನೂ ${n} ವಿಷಯಗಳು (ಪೂರ್ಣ ವರದಿಯಲ್ಲಿ)`,
  notChecked: { cash: "ಪಿಕಪ್‌ನಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಟ್ಟ ಉಳಿದ ಮೊತ್ತ", upi: "Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು", whatsapp: "ನಿಜವಾದ WhatsApp", razorpay: "ನಿಜವಾದ Razorpay", review: "ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ" },
  languageName: { hi: "ಹಿಂದಿ", en: "ಇಂಗ್ಲಿಷ್", ml: "ಮಲಯಾಳಂ", kn: "ಕನ್ನಡ" },
  upiLabel: { collected: "ಮಾಲೀಕರು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ಮುಂಗಡ", givenBack: "ಮಾಲೀಕರು ಕಳುಹಿಸಿದೆ ಎಂದು ದಾಖಲಿಸಿದ ರೀಫಂಡ್", notChecked: "ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ (UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ನೀವು ದಾಖಲಿಸುತ್ತೀರಿ)" },
  notTested: {
    "balance-at-pickup": "ಉಳಿದ ಬೆಲೆ, ಪಿಕಪ್ ಅಥವಾ ಡೆಲಿವರಿಯಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಡುವುದು (ಮುಂಗಡವನ್ನು ಮಾತ್ರ ದಾಖಲಿಸಲಾಗುತ್ತದೆ)",
    "kitchen-and-delivery": "ಆಹಾರ ತಯಾರಾಯಿತೇ, ತೆಗೆದುಕೊಂಡರೇ ಅಥವಾ ತಲುಪಿತೇ ಎಂಬುದು (ಸ್ಲಾಟ್ ಮುಗಿದಾಗ ಆರ್ಡರ್ ಮುಗಿದಿದೆ ಎಂದು ಪರಿಗಣಿಸಲಾಗುತ್ತದೆ)",
    "order-changes": "ಖಚಿತವಾದ ಆರ್ಡರ್‌ನಲ್ಲಿ ಬದಲಾವಣೆ (ಗ್ರಾಹಕರು ರದ್ದು ಮಾಡಿ ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡುತ್ತಾರೆ)",
    "payments-outside-razorpay": "Razorpay ಹೊರಗಿನ ಪಾವತಿಗಳು (ಈ ಅಂಗಡಿ Razorpay ಮೂಲಕ ಪಡೆಯುತ್ತದೆ)",
    "real-whatsapp": "ನಿಜವಾದ WhatsApp",
    "real-razorpay": "ನಿಜವಾದ Razorpay (ಟೆಸ್ಟ್ ಮೋಡ್ ಅಥವಾ ಲೈವ್)",
    "webhook-signatures": "ವೆಬ್‌ಹುಕ್ ಸಹಿಗಳು",
    "real-model": "ನಿಜವಾದ AI ಮಾದರಿ (ನಿಯಮಗಳು ಮತ್ತು ನಕಲಿ ಮಾದರಿಗಳನ್ನು ಓಡಿಸಲಾಯಿತು; ಸಂದೇಶಗಳು ನಿಗದಿತ ಟೆಂಪ್ಲೇಟ್‌ಗಳು)",
    "other-languages": "ತಮಿಳು, ತೆಲುಗು ಮತ್ತು ಇತರ ಭಾಷೆಗಳು",
    "native-review": "ಹಿಂದಿ, ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡ ಪದಗಳ ಬಗ್ಗೆ ಮಾತೃಭಾಷಿಕರ ಪರಿಶೀಲನೆ",
    "restart-mid-step": "ಒಂದು ಹಂತದ ನಡುವೆ ಕ್ರ್ಯಾಶ್ ಅಥವಾ ಮರುಪ್ರಾರಂಭ",
    "same-instant": "ಒಂದೇ ಕ್ಷಣದಲ್ಲಿ ಕೊನೆಯ ಭಾಗವನ್ನು ತೆಗೆದುಕೊಳ್ಳುವ ಇಬ್ಬರು ಗ್ರಾಹಕರು",
    "number-words": "ಒಂದರಿಂದ ಹತ್ತು (ಇಂಗ್ಲಿಷ್ ಮತ್ತು ಹಿಂದಿಯಲ್ಲಿ) ಮತ್ತು ಒಂದರಿಂದ ಐದು (ಮಲಯಾಳಂ ಮತ್ತು ಕನ್ನಡದಲ್ಲಿ) ಹೊರತಾದ ಪದಗಳಲ್ಲಿ ಬರೆದ ಪ್ರಮಾಣಗಳು",
    "other-faults": "ಕೈ ಪರಿಶೀಲನೆಯಲ್ಲಿ ಹೇಳಿದ ದೋಷಗಳನ್ನು ಬಿಟ್ಟು ಬೇರೆ ದೋಷಗಳು",
    "upi-not-automatic": "ಪಾವತಿಯ ಸ್ವಯಂ ಪರಿಶೀಲನೆ: UPI ಯಲ್ಲಿ ಪ್ರತಿ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರೇ ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸುತ್ತಾರೆ",
    "real-upi": "ನಿಜವಾದ UPI ಆ್ಯಪ್‌ನಿಂದ ನಿಜವಾದ UPI ID ಗೆ ಪಾವತಿ (ಮಾಲೀಕರ ದಾಖಲಾತಿಯನ್ನು ಪ್ರಯತ್ನಿಸಲಾಯಿತು, ಪಾವತಿಯನ್ನಲ್ಲ)",
    "own-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು ಅವು ಉದಾಹರಣೆ ಅಂಗಡಿ Annapurna Tiffins ಮೇಲೆ ನಡೆದವು ಎಂದು)",
    "other-settings": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು ಅವು ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು)",
    "no-go-live-certificate": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ)",
    "go-live-untrusted": "ಈ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ (ಕೊಟ್ಟ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ)",
    "situations-skipped": "ಈ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆಸಲಾಗದ ಸಂದರ್ಭಗಳು (ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದಲ್ಲಿ ಅವುಗಳ ಹೆಸರುಗಳಿವೆ)",
  },
  notCounted: {
    "balance-at-pickup": "ಪಿಕಪ್ ಅಥವಾ ಡೆಲಿವರಿಯಲ್ಲಿ ನಗದು ಅಥವಾ UPI ಮೂಲಕ ಕೊಟ್ಟ ಉಳಿದ ಮೊತ್ತ: ದಾಖಲೆಯಲ್ಲಿ ಮುಂಗಡ ಮಾತ್ರ ಇದೆ",
    "kitchen-and-delivery": "ಆಹಾರ ತಯಾರಾಯಿತೇ, ತೆಗೆದುಕೊಂಡರೇ ಅಥವಾ ತಲುಪಿತೇ ಎಂಬುದು",
    "read-receipts": "ಗ್ರಾಹಕರು ಸಂದೇಶ ಓದಿದರೇ ಇಲ್ಲವೇ",
    "outside-agent": "ಏಜೆಂಟ್ ಹೊರಗೆ ಮಾಡಿದ ಯಾವುದೇ ಕೆಲಸ (ನೀವು ಅಥವಾ ಬೇರೆಯವರು Razorpay, UPI ಆ್ಯಪ್ ಅಥವಾ WhatsApp ನಲ್ಲಿ ಮಾಡಿದ್ದು)",
    "outside-agent-upi": "ಏಜೆಂಟ್ ಹೊರಗೆ ಮಾಡಿದ ಯಾವುದೇ ಕೆಲಸ (ನೀವು ಅಥವಾ ಬೇರೆಯವರು UPI ಆ್ಯಪ್ ಅಥವಾ WhatsApp ನಲ್ಲಿ ಮಾಡಿದ್ದು)",
    "rule-breaks": "ಏಜೆಂಟ್ ನೋಡದ ನಿಯಮ ಉಲ್ಲಂಘನೆಗಳು: ದಾಖಲೆಯಲ್ಲಿ ಏಜೆಂಟ್ ಮಾಡಿದ್ದು ಮತ್ತು ಅದನ್ನು ತಡೆದದ್ದು ಮಾತ್ರ ಇದೆ",
  },
  cert: {
    date: "ದಿನಾಂಕ", held: (h, t, f, n) => `${t} ಸಂದರ್ಭಗಳಲ್ಲಿ ${h} ಸರಿಯಾಗಿ ನಿಂತವು. ${f} ತಪ್ಪಿದವು. ${n} ವಿಷಯಗಳನ್ನು ಪರಿಶೀಲಿಸಿಲ್ಲ.`,
    intro: "ಆರಂಭಿಸುವ ಮೊದಲು ತಪ್ಪಾಗಬಹುದಾದ ಸಂದರ್ಭಗಳನ್ನು ನಾವು ಪ್ರಯತ್ನಿಸಿದೆವು: ಕಳೆದುಹೋದ ಉತ್ತರಗಳು, ಎರಡು ಬಾರಿ ಅಥವಾ ತಡವಾಗಿ ಬಂದ ಪಾವತಿ, ಕಟ್ಟದೆ \"ಕಟ್ಟಿದ್ದೇವೆ\" ಎನ್ನುವ ಗ್ರಾಹಕರು, ಸ್ಟಾಕ್‌ಗಿಂತ ಹೆಚ್ಚು ಅಥವಾ ಕಟ್-ಆಫ್ ನಂತರದ ಆರ್ಡರ್‌ಗಳು, ರೀಫಂಡ್ ಕೋರಿಕೆಗಳು, ಏಜೆಂಟ್ ಅನ್ನು ಮೋಸಗೊಳಿಸಲು ಯತ್ನಿಸುವ ಗ್ರಾಹಕರು.",
    yourLimits: "ನಿಮ್ಮ ಮಿತಿಗಳು", paidRule: "ಪಾವತಿ ದಾಖಲೆ (ಅಥವಾ UPI ಯಲ್ಲಿ ನಿಮ್ಮ ದಾಖಲಾತಿ) ಪೂರ್ತಿ ಮುಂಗಡ ತೋರಿಸುವವರೆಗೆ ಯಾವ ಆರ್ಡರ್ ಅನ್ನೂ ಖಚಿತಪಡಿಸುವುದಿಲ್ಲ", menu: (items) => `ಮೆನು ಮತ್ತು ಒಂದು ದಿನದಲ್ಲಿ ಗರಿಷ್ಠ ಮಾಡುವುದು: ${items}`,
    orderLimits: (perDay, items, ahead) => `ಒಂದು ದಿನಕ್ಕೆ ಗರಿಷ್ಠ ${perDay} ಆರ್ಡರ್, ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ${items} ವಸ್ತುಗಳು, ${ahead} ದಿನ ಮುಂಚಿತವಾಗಿಯವರೆಗೆ`, cutoff: (days, time) => (days === 0 ? `ಸಾಮಾನ್ಯ ಕಟ್-ಆಫ್: ಅದೇ ದಿನ ${time} ಕ್ಕೆ ಆರ್ಡರ್‌ಗಳು ಮುಚ್ಚುತ್ತವೆ` : `ಸಾಮಾನ್ಯ ಕಟ್-ಆಫ್: ${days} ದಿನ ಮೊದಲು ${time} ಕ್ಕೆ ಆರ್ಡರ್‌ಗಳು ಮುಚ್ಚುತ್ತವೆ`),
    advance: (full, percent, minutes) => (full ? `ಪೂರ್ಣ ಬೆಲೆಯನ್ನು ಮುಂಗಡವಾಗಿ ಪಡೆಯಲಾಗುತ್ತದೆ; ಅದಕ್ಕಾಗಿ ಆರ್ಡರ್ ಅನ್ನು ${minutes} ನಿಮಿಷ ಹಿಡಿದಿಡಲಾಗುತ್ತದೆ` : `ಬೆಲೆಯ ${percent}% ಅನ್ನು ಮುಂಗಡವಾಗಿ ಪಡೆಯಲಾಗುತ್ತದೆ; ಅದಕ್ಕಾಗಿ ಆರ್ಡರ್ ಅನ್ನು ${minutes} ನಿಮಿಷ ಹಿಡಿದಿಡಲಾಗುತ್ತದೆ`),
    delivery: (areas) => `ಡೆಲಿವರಿ ಇಲ್ಲಿಗೆ ಮಾತ್ರ: ${areas}`, noDelivery: "ಪಿಕಪ್ ಮಾತ್ರ, ಡೆಲಿವರಿ ಇಲ್ಲ",
    window: (hours) => `ಸ್ಲಾಟ್‌ಗೆ ಕನಿಷ್ಠ ${hours} ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿದರೆ ಮುಂಗಡ ಹಣ ಮರಳಿಸಲಾಗುತ್ತದೆ; ನಂತರದ್ದು ನಿಮ್ಮ ತೀರ್ಮಾನ`,
    refund: (amount) => `${amount} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್ ನಿಮ್ಮನ್ನು ಕೇಳಿದ ನಂತರ ಮಾತ್ರ`,
    approve: (amount) => `${amount} ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಆರ್ಡರ್ ಯಾವುದೇ ಪಾವತಿ ಕೇಳುವ ಮೊದಲು ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತದೆ`, noApprove: "ಗಾತ್ರದ ಕಾರಣದಿಂದ ಮಾತ್ರ ಯಾವ ಆರ್ಡರ್ ಕೂಡ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುವುದಿಲ್ಲ",
    notAGrade: "ಇದು ಪ್ರಯತ್ನಿಸಿದ ಸಂದರ್ಭಗಳ ಎಣಿಕೆ ಮಾತ್ರ. ಇದು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ಕೊಡುವುದಿಲ್ಲ.", didNotHold: "ತಪ್ಪಿದವು",
    handRunLine: "ಪರಿಶೀಲನೆಗಳನ್ನು ಕೈಯಾರೆ ಮಾಡಿದ್ದು ನಿಜವಾದ WhatsApp ಅಥವಾ ಪಾವತಿಯ ಮೇಲೆ ಅಲ್ಲ, ಅಭ್ಯಾಸದ ವ್ಯವಸ್ಥೆಗಳ ಮೇಲೆ (stand-in services). ಟೆಸ್ಟ್ ಹಣ ಮಾತ್ರ.", checkedOn: "ಪರಿಶೀಲನೆ ನಡೆದದ್ದು",
  },
  goLive: {
    heading: "ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆ",
    own: (date) => `ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆಯೇ ನಡೆದವು, ${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರದ ಪ್ರಕಾರ.`,
    example: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಉದಾಹರಣೆ ಅಂಗಡಿ Annapurna Tiffins ಮೇಲೆ ನಡೆದವು, ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ಅಲ್ಲ.`,
    different: (date) => `${date} ರ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಹೇಳುವುದು: ಅದರ ಪರಿಶೀಲನೆಗಳು ಈ ಅಂಗಡಿಗಿಂತ ಬೇರೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು, ಆದ್ದರಿಂದ ಈ ಅಂಗಡಿಯ ಸ್ವಂತ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತವೆ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.`,
    untrusted: "ಒಂದು ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಡಲಾಗಿತ್ತು, ಆದರೆ ಅದನ್ನು ನಂಬಲಾಗಲಿಲ್ಲ (ಅದರಲ್ಲಿ ಸಹಿ ಇಲ್ಲ, ಸಹಿ ಹೊಂದುವುದಿಲ್ಲ, ಅಥವಾ ಅದು ಈ ಏಜೆಂಟ್‌ನ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರವೇ ಅಲ್ಲ), ಆದ್ದರಿಂದ ಬಳಸಲಿಲ್ಲ.",
    none: "ಯಾವುದೇ ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರ ಕೊಟ್ಟಿಲ್ಲ, ಆದ್ದರಿಂದ ಆರಂಭಿಸುವ ಮೊದಲಿನ ಪರಿಶೀಲನೆಗಳು ಯಾವ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಮೇಲೆ ನಡೆದವು ಎಂದು ಈ ದಾಖಲೆ ಹೇಳುವುದಿಲ್ಲ.",
    signedWith: (key) => `ಪರಿಶೀಲನಾ ಪ್ರಮಾಣಪತ್ರಕ್ಕೆ ಸಹಿ ಮಾಡಿದ್ದು ${key} ಎಂಬ ಕೀಲಿಯಿಂದ. ಆ ಕೀಲಿ ಯಾರ ಬಳಿ ಇದೆ ಎಂದು ಕೀಲಿ ತೋರಿಸುವುದಿಲ್ಲ.`,
  },
  page: {
    numbers: "ಅಂಕಿಅಂಶಗಳು", item: "ಏನು", count: "ಎಷ್ಟು", amount: "ಮೊತ್ತ", ordersTaken: "ತೆಗೆದುಕೊಂಡ ಆರ್ಡರ್‌ಗಳು", ordersCompleted: "ಮುಗಿದ ಆರ್ಡರ್‌ಗಳು", ordersCancelled: "ಖಚಿತವಾದ ನಂತರ ರದ್ದಾದ ಆರ್ಡರ್‌ಗಳು", holdsRanOut: "ಮುಂಗಡ ಬರುವ ಮೊದಲೇ ಮುಗಿದ ಹೋಲ್ಡ್‌ಗಳು", soldHeading: "ಈ ತಿಂಗಳ ದಿನಗಳ ಆರ್ಡರ್‌ಗಳು", soldOrders: "ಖಚಿತವಾದ ಅಥವಾ ಮುಗಿದ ಆರ್ಡರ್‌ಗಳು",
    pickup: "ಪಿಕಪ್", delivery: "ಡೆಲಿವರಿ", itemsSold: "ಮಾರಾಟವಾದ ವಸ್ತುಗಳು", noItems: "ಯಾವುದೂ ಇಲ್ಲ", messagesHeading: "ಸಂದೇಶಗಳು", toYou: "ನಿಮಗೆ, ಮಾಲೀಕರಿಗೆ", heldBack: "ಕಳುಹಿಸುವ ಮೊದಲು ತಡೆದದ್ದು",
    stoppedHeading: "ನಿಮ್ಮ ಮಿತಿಗಳು ತಡೆದದ್ದು", rule: "ಮಿತಿ", times: "ಬಾರಿ", stoppedCustomers: "STOP ಕಳುಹಿಸಿದ ಗ್ರಾಹಕರು", notCountedHeading: "ಎಣಿಸದ್ದು", notTestedHeading: "ಪರಿಶೀಲಿಸದ್ದು", unconfirmed: "ದೃಢವಾಗದ ಅಥವಾ ವಿಫಲವಾದದ್ದು",
    checkHeading: "ಈ ದಾಖಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ", code: "ಕೋಡ್", digest: "ಡೈಜೆಸ್ಟ್", countedFrom: "ಎಲ್ಲಿಂದ ಎಣಿಸಿದ್ದು", setUpBy: "ಸಿದ್ಧಪಡಿಸಿದವರು", madeOn: "ಮಾಡಿದ ದಿನ", signedBy: "ಸಹಿ ಮಾಡಿದವರು", notSigned: "ಸಹಿ ಇಲ್ಲ", scanToCheck: "ಈ ದಾಖಲೆಯನ್ನು geometer.dev ನಲ್ಲಿ ಪರಿಶೀಲಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಇದರ .json ಫೈಲ್ ಬೇಕಾಗುತ್ತದೆ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಡೆಯುತ್ತದೆ, ಏನೂ ಕಳುಹಿಸಲಾಗುವುದಿಲ್ಲ. ಲಿಂಕ್‌ನಲ್ಲಿ ಸಹಿ ಮಾಡಿದ ಕೀ ಇಲ್ಲ: ಯಾರು ಸಹಿ ಮಾಡಿದರು ಎಂದು ತಿಳಿಯಲು ಇಲ್ಲಿ ತೋರಿಸಿದ ಕೀಯನ್ನು ನಿಮ್ಮ ಪಾಲುದಾರ ಅಥವಾ Geometer ತಂಡ ನೀಡಿದ ಕೀಯೊಂದಿಗೆ ಹೋಲಿಸಿ.", scanSummary: SCAN_SUMMARY.kn, signatureNote: "ಈ ದಾಖಲೆಯನ್ನು ಯಾರು ಮಾಡಿದರು ಮತ್ತು ಅದು ಬದಲಾಗಿಲ್ಲ ಎಂದು ಸಹಿ ತೋರಿಸುತ್ತದೆ. ಇದರಲ್ಲಿ ಎಣಿಸಿದ್ದೆಲ್ಲ ಪೂರ್ಣ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ.",
    notAGrade: "ಇವು ದಾಖಲೆಯಲ್ಲಿ ಕಾಣುವ ವಿಷಯಗಳ ಎಣಿಕೆ. ಇವು ಏಜೆಂಟ್‌ಗೆ ಅಂಕ ಅಥವಾ ದರ್ಜೆ ನೀಡುವುದಿಲ್ಲ.", period: "ಅವಧಿ",
    showWhatWeDid: "ನಾವು ಮಾಡಿದ್ದನ್ನು ತೋರಿಸಿ ▸", byActionHeading: "ಏಜೆಂಟ್ ಮಾಡಿದ್ದು, ಕೆಲಸದ ಪ್ರಕಾರ", action: "ಕೆಲಸ", agentVersion: "ಏಜೆಂಟ್ ಆವೃತ್ತಿ", limitsDigest: "ಮಿತಿಗಳ ಡೈಜೆಸ್ಟ್", recordDigest: "ದಾಖಲೆಯ ಡೈಜೆಸ್ಟ್", liveServices: "ನಿಜವಾದ ವ್ಯವಸ್ಥೆಗಳು",
  },
};

export const STRINGS: Record<Language, Strings> = { hi, en, ml, kn };

/** The money labels of a report: a UPI shop's (B33) say the money was marked by the owner; a Razorpay shop's are as they were. */
export const moneyLabels = (language: Language, paidBy?: "owner-marked"): { collected: string; givenBack: string } =>
  paidBy === "owner-marked" ? STRINGS[language].upiLabel : { collected: STRINGS[language].label.collected, givenBack: STRINGS[language].label.givenBack };
