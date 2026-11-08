// The words of the three papers (a person's statement, the record of one case, the agent's identity paper), in Hindi, English, Malayalam and Kannada.
//
// MACHINE-WRITTEN, WAITING FOR NATIVE REVIEW: the Hindi, Malayalam and Kannada below were written by a model (8 November 2026) and no native speaker has
// read them yet. REVIEW_STATUS says so in code, the papers' tests check it is still there, and Deferred.md lists the words to look at. English is the source.
//
// The rules every word here follows (the claim rules): facts and counts only. No word that grades, promises or decides: never safe, guaranteed, certified,
// proves, 100%, never who is right, never a score or a rank. Every paper lists what was not checked.
import type { Language } from "../language/languages.ts";
import type { Outcome } from "../record/record.ts";

export const REVIEW_STATUS: Record<Language, "source" | "machine-written, waiting for native review"> = {
  en: "source", hi: "machine-written, waiting for native review", ml: "machine-written, waiting for native review", kn: "machine-written, waiting for native review",
};

export interface PaperWords {
  outcome: Record<Outcome, string>;
  /** The actions every template records; a template hands in its own (Bookings: hold_slot ...; Fees: open_fee ...). */
  action: Record<string, string>;
  common: { shop: string; issued: string; code: string; checkAt: (path: string) => string; notChecked: string; notSigned: string; signedBy: string; digest: string; ledger: string; ledgerNone: string; signatureNote: string; draft: string };
  statement: {
    title: string; forNumber: (last4: string) => string; intro: string; heading: string; paid: string; refunded: string; markedPaid: string; markedRefund: string;
    totalPaid: string; totalRefunded: string; net: string; owed: string; none: string; when: string; what: string; amount: string; case: string;
  };
  dispute: {
    title: string; intro: string; time: string; asked: string; did: string; limits: string; approved: string; services: string; askedFor: string;
    message: string; claim: (via: string) => string; guardHeld: (approval: string) => string; rule: (rule: string, verdict: string, reason: string) => string;
    verdict: { allow: string; block: string; hold_for_owner: string }; owner: (command: string) => string; ownerMarked: string; ownerMarkedRefund: string;
    service: { payments: string; calendar: string; whatsapp: string }; showed: (service: string, ids: string) => string; nothing: string; case: string; customer: string; state: string;
  };
  identity: {
    title: string; id: string; operator: string; shop: string; template: string; limits: string; checks: string; held: (held: number, total: number) => string; checksNone: string;
    notTestedHeading: string; live: string; liveSince: (date: string) => string; entries: string; payments: string; refunds: string; stopped: string; heldForOwner: string;
    changes: string; changed: (date: string, who: string, what: string) => string; noChanges: (since: string) => string; noHistory: string; hidden: string; role: Record<string, string>;
  };
  /** The lines of "what this paper did not check". */
  not: {
    truth: string; providers: string; words: string; outside: string; guardLog: string; whoIsRight: string; upi: string; others: string; cash: string;
    everySituation: string; keyHolder: string; historyStart: (date: string) => string; liveNotChecked: string; noLedger: string; anchorNotCompared: string;
  };
}

const en: PaperWords = {
  outcome: { attempted: "tried", confirmed: "done, read back from the service", unconfirmed: "not confirmed by the service", failed: "failed", blocked: "stopped by a limit", held_for_owner: "waiting for the owner" },
  action: {
    receive_message: "message received", receive_payment_event: "payment notice received", send_message: "message sent", ask_owner: "owner asked", opt_out: "asked for no more messages",
    owner_decision: "owner's answer", refund: "refund", voice_note_reply: "reply to a voice note", ai_mode: "switched to buttons only",
    upi_request: "UPI payment request sent", upi_paid_claim: "customer says they paid", owner_marked_paid: "marked paid by owner", upi_request_closed: "UPI request closed",
    upi_refund_owed: "refund owed by the owner", upi_refund_marked_done: "refund marked sent by owner", upi_refund_kept: "owner kept the money for a booking made by hand", upi_refund_reminder: "reminder of a refund owed",
  },
  common: { shop: "Shop", issued: "Made on", code: "Check code", checkAt: (p) => `Check it at geometer.dev${p}`, notChecked: "What this paper did not check", notSigned: "not signed",
    signedBy: "Signed with key", digest: "Digest", ledger: "Record fingerprint (entry and hash)", ledgerNone: "not anchored to the record's fingerprint", draft: "Draft words, waiting for review",
    signatureNote: "The code and the digest let anyone check this paper has not changed since it was signed. They do not show that what it says is true." },
  statement: {
    title: "Your payments statement", forNumber: (l) => `For the WhatsApp number ending ${l}`, intro: "Your own payments and refunds, as this shop's agent recorded them. Nothing about anyone else.",
    heading: "Your payments", paid: "Paid", refunded: "Refunded", markedPaid: "Marked paid by owner", markedRefund: "Refund marked sent by owner", totalPaid: "Total paid", totalRefunded: "Total refunded",
    net: "Paid less refunded", owed: "Still owed, as the record shows now", none: "No payments are recorded for this number.", when: "When", what: "What", amount: "Amount", case: "For",
  },
  dispute: {
    title: "Record of one case", intro: "Side by side: what each part of the record says about this one case. This paper does not decide who is right.",
    time: "Time", asked: "The customer", did: "The agent", limits: "Limits and Guard", approved: "The owner", services: "Service records", askedFor: "Asked for, as the agent understood it",
    message: "a message (its words are not kept, only a fingerprint)", claim: (v) => `said they paid (${v})`, guardHeld: (a) => `Guard held it for the owner (approval ${a})`,
    rule: (r, v, why) => `limit ${r}: ${v}${why ? `, ${why}` : ""}`, verdict: { allow: "allowed", block: "stopped", hold_for_owner: "held for the owner" }, owner: (c) => `owner answered ${c}`,
    ownerMarked: "owner marked the payment received (no payment service record)", ownerMarkedRefund: "owner marked the refund sent (no payment service record)",
    service: { payments: "payments service", calendar: "calendar", whatsapp: "WhatsApp" }, showed: (s, ids) => `the ${s}'s own record showed ${ids} when the agent read it back`,
    nothing: "Nothing in the record is about this case.", case: "Case", customer: "Customer, as the record keeps it", state: "State now",
  },
  identity: {
    title: "About this agent", id: "Agent id", operator: "Run by", shop: "For the shop", template: "Template and version", limits: "Its limits", checks: "Checks before it went live",
    held: (h, t) => `Held ${h} of ${t} situations`, checksNone: "No go-live check result was given for this paper.", notTestedHeading: "What the checks did not test",
    live: "What it has done so far", liveSince: (d) => `Since ${d}`, entries: "Entries in its record", payments: "Payments recorded", refunds: "Refunds recorded", stopped: "Times a limit said no",
    heldForOwner: "Times it waited for the owner", changes: "Limits made wider", changed: (d, who, what) => `${d}: ${who} changed ${what}`, noChanges: (s) => `No limit was made wider since ${s}.`,
    noHistory: "The panel keeps no history of this shop's settings yet.", hidden: "Not shown by the operator", role: { builder: "builder", partner: "local partner" },
  },
  not: {
    truth: "That what the record says is true. This paper is made from the agent's own record.",
    providers: "The payment provider's and the calendar's own records were not looked up again for this paper. It shows what the agent read back from them at the time.",
    words: "What the customer wrote. The record keeps only a fingerprint of each message.",
    outside: "Anything done outside the agent: phone calls, cash, the owner's own UPI app.",
    guardLog: "Guard's own decision log. Only what the agent recorded of Guard's answers is shown.",
    whoIsRight: "Who is right. This paper shows the records side by side and does not decide that.",
    upi: "Whether UPI money arrived. The owner marked it; no payment service has a record of it.",
    others: "Anyone else's payments. This statement shows only the payments for this number.",
    cash: "Payments made outside the agent, in cash or straight to the owner, unless the owner marked them.",
    everySituation: "Every situation. The checks tried a set of situations, not every message a customer could send.",
    keyHolder: "Who holds the signing key. Name a key you already trust when you check this paper.",
    historyStart: (d) => `Limit changes before ${d}, when the panel began keeping the shop's settings.`,
    liveNotChecked: "The live counts against the services' own records. They are counted from the agent's record.",
    noLedger: "The record's fingerprint. This paper is not anchored to it.",
    anchorNotCompared: "Whether the record fingerprint on this paper is the one the shop published that day. Compare the two, and check the record itself with geo-verify, the open checker.",
  },
};

const hi: PaperWords = {
  outcome: { attempted: "कोशिश की", confirmed: "हो गया, सेवा के रिकॉर्ड से जाँचा", unconfirmed: "सेवा ने पक्का नहीं किया", failed: "नहीं हुआ", blocked: "सीमा ने रोका", held_for_owner: "मालिक के जवाब का इंतज़ार" },
  action: {
    receive_message: "संदेश मिला", receive_payment_event: "भुगतान की सूचना मिली", send_message: "संदेश भेजा", ask_owner: "मालिक से पूछा", opt_out: "और संदेश न भेजने को कहा",
    owner_decision: "मालिक का जवाब", refund: "रिफ़ंड", voice_note_reply: "वॉइस नोट का जवाब", ai_mode: "सिर्फ़ बटन पर चला",
    upi_request: "UPI भुगतान का अनुरोध भेजा", upi_paid_claim: "ग्राहक ने कहा भुगतान कर दिया", owner_marked_paid: "मालिक ने भुगतान मिला लिखा", upi_request_closed: "UPI अनुरोध बंद किया",
    upi_refund_owed: "मालिक को रिफ़ंड लौटाना है", upi_refund_marked_done: "मालिक ने रिफ़ंड भेजा लिखा", upi_refund_kept: "मालिक ने हाथ से की बुकिंग के लिए पैसा रखा", upi_refund_reminder: "बकाया रिफ़ंड की याद",
  },
  common: { shop: "दुकान", issued: "बनाया गया", code: "जाँच कोड", checkAt: (p) => `geometer.dev${p} पर जाँचें`, notChecked: "इस काग़ज़ ने क्या नहीं जाँचा", notSigned: "हस्ताक्षर नहीं",
    signedBy: "इस कुंजी से हस्ताक्षर", digest: "डाइजेस्ट", ledger: "रिकॉर्ड की पहचान (एंट्री और हैश)", ledgerNone: "रिकॉर्ड की पहचान से नहीं जुड़ा", draft: "मसौदा शब्द, समीक्षा बाकी",
    signatureNote: "कोड और डाइजेस्ट से कोई भी देख सकता है कि हस्ताक्षर के बाद यह काग़ज़ बदला नहीं। इससे यह नहीं दिखता कि इसमें लिखी बात सच है।" },
  statement: {
    title: "आपके भुगतान का विवरण", forNumber: (l) => `${l} पर ख़त्म होने वाले WhatsApp नंबर के लिए`, intro: "सिर्फ़ आपके भुगतान और रिफ़ंड, जैसे इस दुकान के एजेंट ने लिखे। किसी और के बारे में कुछ नहीं।",
    heading: "आपके भुगतान", paid: "भुगतान", refunded: "रिफ़ंड", markedPaid: "मालिक ने भुगतान मिला लिखा", markedRefund: "मालिक ने रिफ़ंड भेजा लिखा", totalPaid: "कुल भुगतान", totalRefunded: "कुल रिफ़ंड",
    net: "भुगतान में से रिफ़ंड घटाकर", owed: "अभी बाकी, रिकॉर्ड के अनुसार", none: "इस नंबर का कोई भुगतान दर्ज नहीं है।", when: "कब", what: "क्या", amount: "रकम", case: "किसके लिए",
  },
  dispute: {
    title: "एक मामले का रिकॉर्ड", intro: "आमने-सामने: इस एक मामले के बारे में रिकॉर्ड का हर हिस्सा क्या कहता है। यह काग़ज़ तय नहीं करता कि कौन सही है।",
    time: "समय", asked: "ग्राहक", did: "एजेंट", limits: "सीमाएँ और Guard", approved: "मालिक", services: "सेवाओं के रिकॉर्ड", askedFor: "क्या माँगा, जैसा एजेंट ने समझा",
    message: "एक संदेश (शब्द नहीं रखे जाते, सिर्फ़ उसकी पहचान)", claim: (v) => `कहा कि भुगतान कर दिया (${v})`, guardHeld: (a) => `Guard ने इसे मालिक के लिए रोका (अनुमति ${a})`,
    rule: (r, v, why) => `सीमा ${r}: ${v}${why ? `, ${why}` : ""}`, verdict: { allow: "जाने दिया", block: "रोका", hold_for_owner: "मालिक के लिए रोका" }, owner: (c) => `मालिक ने जवाब दिया: ${c}`,
    ownerMarked: "मालिक ने भुगतान मिला लिखा (भुगतान सेवा का कोई रिकॉर्ड नहीं)", ownerMarkedRefund: "मालिक ने रिफ़ंड भेजा लिखा (भुगतान सेवा का कोई रिकॉर्ड नहीं)",
    service: { payments: "भुगतान सेवा", calendar: "कैलेंडर", whatsapp: "WhatsApp" }, showed: (s, ids) => `एजेंट ने जब देखा, ${s} के अपने रिकॉर्ड में ${ids} था`,
    nothing: "रिकॉर्ड में इस मामले के बारे में कुछ नहीं है।", case: "मामला", customer: "ग्राहक, जैसे रिकॉर्ड में है", state: "अभी की स्थिति",
  },
  identity: {
    title: "इस एजेंट के बारे में", id: "एजेंट पहचान", operator: "चलाने वाले", shop: "दुकान", template: "टेम्पलेट और संस्करण", limits: "इसकी सीमाएँ", checks: "चालू होने से पहले की जाँच",
    held: (h, t) => `${t} में से ${h} स्थितियों में सीमा टिकी`, checksNone: "इस काग़ज़ को चालू होने की जाँच का नतीजा नहीं दिया गया।", notTestedHeading: "जाँच ने क्या नहीं परखा",
    live: "अब तक क्या किया", liveSince: (d) => `${d} से`, entries: "रिकॉर्ड में एंट्री", payments: "दर्ज भुगतान", refunds: "दर्ज रिफ़ंड", stopped: "सीमा ने कितनी बार मना किया",
    heldForOwner: "कितनी बार मालिक का इंतज़ार किया", changes: "जो सीमाएँ ढीली की गईं", changed: (d, who, what) => `${d}: ${who} ने ${what} बदला`, noChanges: (s) => `${s} से कोई सीमा ढीली नहीं की गई।`,
    noHistory: "पैनल में इस दुकान की सेटिंग का इतिहास अभी नहीं है।", hidden: "चलाने वाले ने नहीं दिखाया", role: { builder: "बिल्डर", partner: "स्थानीय पार्टनर" },
  },
  not: {
    truth: "रिकॉर्ड में लिखी बात सच है या नहीं। यह काग़ज़ एजेंट के अपने रिकॉर्ड से बना है।",
    providers: "इस काग़ज़ के लिए भुगतान सेवा और कैलेंडर के रिकॉर्ड दोबारा नहीं देखे गए। इसमें वही है जो एजेंट ने उस समय उनसे पढ़ा।",
    words: "ग्राहक ने क्या लिखा। रिकॉर्ड हर संदेश की सिर्फ़ पहचान रखता है।",
    outside: "एजेंट के बाहर हुआ कुछ भी: फ़ोन कॉल, नकद, मालिक का अपना UPI ऐप।",
    guardLog: "Guard का अपना फ़ैसलों का रिकॉर्ड। सिर्फ़ वही दिखाया है जो एजेंट ने Guard के जवाबों के बारे में लिखा।",
    whoIsRight: "कौन सही है। यह काग़ज़ रिकॉर्ड आमने-सामने रखता है, यह तय नहीं करता।",
    upi: "UPI का पैसा आया या नहीं। मालिक ने लिखा; किसी भुगतान सेवा के पास इसका रिकॉर्ड नहीं है।",
    others: "किसी और के भुगतान। यह विवरण सिर्फ़ इस नंबर के भुगतान दिखाता है।",
    cash: "एजेंट के बाहर किए गए भुगतान, नकद या सीधे मालिक को, जब तक मालिक ने उन्हें न लिखा हो।",
    everySituation: "हर स्थिति। जाँच ने कुछ तय स्थितियाँ परखीं, ग्राहक का हर संभव संदेश नहीं।",
    keyHolder: "हस्ताक्षर की कुंजी किसके पास है। जाँचते समय वह कुंजी बताएँ जिस पर आप पहले से भरोसा करते हैं।",
    historyStart: (d) => `${d} से पहले के सीमा बदलाव, जब पैनल ने दुकान की सेटिंग रखनी शुरू की।`,
    liveNotChecked: "अब तक की गिनती, सेवाओं के अपने रिकॉर्ड से। ये एजेंट के रिकॉर्ड से गिनी गई हैं।",
    noLedger: "रिकॉर्ड की पहचान। यह काग़ज़ उससे नहीं जुड़ा।",
    anchorNotCompared: "इस काग़ज़ पर लिखी रिकॉर्ड की पहचान वही है या नहीं जो दुकान ने उस दिन प्रकाशित की। दोनों को मिलाएँ, और रिकॉर्ड को खुले जाँचने वाले geo-verify से जाँचें।",
  },
};

const ml: PaperWords = {
  outcome: { attempted: "ശ്രമിച്ചു", confirmed: "ചെയ്തു, സേവനത്തിന്റെ രേഖയിൽ നോക്കി", unconfirmed: "സേവനം സ്ഥിരീകരിച്ചില്ല", failed: "നടന്നില്ല", blocked: "പരിധി തടഞ്ഞു", held_for_owner: "ഉടമയുടെ മറുപടിക്കായി കാത്തിരിക്കുന്നു" },
  action: {
    receive_message: "സന്ദേശം കിട്ടി", receive_payment_event: "പണമടവിന്റെ അറിയിപ്പ് കിട്ടി", send_message: "സന്ദേശം അയച്ചു", ask_owner: "ഉടമയോട് ചോദിച്ചു", opt_out: "ഇനി സന്ദേശം വേണ്ടെന്ന് പറഞ്ഞു",
    owner_decision: "ഉടമയുടെ മറുപടി", refund: "റീഫണ്ട്", voice_note_reply: "വോയ്സ് നോട്ടിന് മറുപടി", ai_mode: "ബട്ടണുകൾ മാത്രമായി മാറി",
    upi_request: "UPI പണമടവ് അഭ്യർത്ഥന അയച്ചു", upi_paid_claim: "പണമടച്ചെന്ന് ഉപഭോക്താവ് പറഞ്ഞു", owner_marked_paid: "പണം കിട്ടിയെന്ന് ഉടമ രേഖപ്പെടുത്തി", upi_request_closed: "UPI അഭ്യർത്ഥന അടച്ചു",
    upi_refund_owed: "ഉടമ തിരികെ നൽകേണ്ട റീഫണ്ട്", upi_refund_marked_done: "റീഫണ്ട് അയച്ചെന്ന് ഉടമ രേഖപ്പെടുത്തി", upi_refund_kept: "കൈകൊണ്ട് എടുത്ത ബുക്കിംഗിനായി ഉടമ പണം വെച്ചു", upi_refund_reminder: "നൽകാനുള്ള റീഫണ്ടിന്റെ ഓർമ്മപ്പെടുത്തൽ",
  },
  common: { shop: "കട", issued: "തയ്യാറാക്കിയത്", code: "പരിശോധനാ കോഡ്", checkAt: (p) => `geometer.dev${p} ൽ പരിശോധിക്കുക`, notChecked: "ഈ രേഖ എന്തൊക്കെ പരിശോധിച്ചില്ല", notSigned: "ഒപ്പിട്ടിട്ടില്ല",
    signedBy: "ഈ കീ കൊണ്ട് ഒപ്പിട്ടു", digest: "ഡൈജസ്റ്റ്", ledger: "രേഖയുടെ വിരലടയാളം (എൻട്രിയും ഹാഷും)", ledgerNone: "രേഖയുടെ വിരലടയാളവുമായി ബന്ധിപ്പിച്ചിട്ടില്ല", draft: "കരട് വാക്കുകൾ, പരിശോധന ബാക്കി",
    signatureNote: "ഒപ്പിട്ട ശേഷം ഈ രേഖ മാറിയിട്ടില്ലെന്ന് കോഡും ഡൈജസ്റ്റും കൊണ്ട് ആർക്കും നോക്കാം. ഇതിൽ പറയുന്നത് ശരിയാണെന്ന് അത് കാണിക്കുന്നില്ല." },
  statement: {
    title: "നിങ്ങളുടെ പണമടവ് വിവരം", forNumber: (l) => `${l} ൽ അവസാനിക്കുന്ന WhatsApp നമ്പറിന്`, intro: "നിങ്ങളുടെ സ്വന്തം പണമടവുകളും റീഫണ്ടുകളും മാത്രം, ഈ കടയുടെ ഏജന്റ് രേഖപ്പെടുത്തിയതുപോലെ. മറ്റാരെക്കുറിച്ചും ഒന്നുമില്ല.",
    heading: "നിങ്ങളുടെ പണമടവുകൾ", paid: "അടച്ചത്", refunded: "തിരികെ നൽകിയത്", markedPaid: "പണം കിട്ടിയെന്ന് ഉടമ രേഖപ്പെടുത്തി", markedRefund: "റീഫണ്ട് അയച്ചെന്ന് ഉടമ രേഖപ്പെടുത്തി", totalPaid: "ആകെ അടച്ചത്", totalRefunded: "ആകെ തിരികെ നൽകിയത്",
    net: "അടച്ചതിൽ നിന്ന് തിരികെ നൽകിയത് കുറച്ച്", owed: "ഇപ്പോഴും ബാക്കി, രേഖ പ്രകാരം", none: "ഈ നമ്പറിന് പണമടവൊന്നും രേഖപ്പെടുത്തിയിട്ടില്ല.", when: "എപ്പോൾ", what: "എന്ത്", amount: "തുക", case: "എന്തിന്",
  },
  dispute: {
    title: "ഒരു കേസിന്റെ രേഖ", intro: "അരികരികെ: ഈ ഒരു കേസിനെക്കുറിച്ച് രേഖയുടെ ഓരോ ഭാഗവും പറയുന്നത്. ആരാണ് ശരിയെന്ന് ഈ രേഖ തീരുമാനിക്കുന്നില്ല.",
    time: "സമയം", asked: "ഉപഭോക്താവ്", did: "ഏജന്റ്", limits: "പരിധികളും Guard-ഉം", approved: "ഉടമ", services: "സേവനങ്ങളുടെ രേഖകൾ", askedFor: "ചോദിച്ചത്, ഏജന്റ് മനസ്സിലാക്കിയതുപോലെ",
    message: "ഒരു സന്ദേശം (വാക്കുകൾ സൂക്ഷിക്കുന്നില്ല, വിരലടയാളം മാത്രം)", claim: (v) => `പണമടച്ചെന്ന് പറഞ്ഞു (${v})`, guardHeld: (a) => `Guard ഇത് ഉടമയ്ക്കായി തടഞ്ഞുവെച്ചു (അനുമതി ${a})`,
    rule: (r, v, why) => `പരിധി ${r}: ${v}${why ? `, ${why}` : ""}`, verdict: { allow: "അനുവദിച്ചു", block: "തടഞ്ഞു", hold_for_owner: "ഉടമയ്ക്കായി തടഞ്ഞുവെച്ചു" }, owner: (c) => `ഉടമ മറുപടി നൽകി: ${c}`,
    ownerMarked: "പണം കിട്ടിയെന്ന് ഉടമ രേഖപ്പെടുത്തി (പണമടവ് സേവനത്തിന്റെ രേഖയില്ല)", ownerMarkedRefund: "റീഫണ്ട് അയച്ചെന്ന് ഉടമ രേഖപ്പെടുത്തി (പണമടവ് സേവനത്തിന്റെ രേഖയില്ല)",
    service: { payments: "പണമടവ് സേവനം", calendar: "കലണ്ടർ", whatsapp: "WhatsApp" }, showed: (s, ids) => `ഏജന്റ് നോക്കിയപ്പോൾ ${s} ന്റെ സ്വന്തം രേഖയിൽ ${ids} ഉണ്ടായിരുന്നു`,
    nothing: "ഈ കേസിനെക്കുറിച്ച് രേഖയിൽ ഒന്നുമില്ല.", case: "കേസ്", customer: "ഉപഭോക്താവ്, രേഖയിൽ ഉള്ളതുപോലെ", state: "ഇപ്പോഴത്തെ നില",
  },
  identity: {
    title: "ഈ ഏജന്റിനെക്കുറിച്ച്", id: "ഏജന്റ് ഐഡി", operator: "നടത്തുന്നത്", shop: "കടയ്ക്കായി", template: "ടെംപ്ലേറ്റും പതിപ്പും", limits: "ഇതിന്റെ പരിധികൾ", checks: "തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധന",
    held: (h, t) => `${t} സാഹചര്യങ്ങളിൽ ${h} എണ്ണത്തിൽ പരിധി നിന്നു`, checksNone: "ഈ രേഖയ്ക്ക് തുടങ്ങുന്നതിന് മുമ്പുള്ള പരിശോധനാഫലം നൽകിയിട്ടില്ല.", notTestedHeading: "പരിശോധന എന്തൊക്കെ നോക്കിയില്ല",
    live: "ഇതുവരെ ചെയ്തത്", liveSince: (d) => `${d} മുതൽ`, entries: "രേഖയിലെ എൻട്രികൾ", payments: "രേഖപ്പെടുത്തിയ പണമടവുകൾ", refunds: "രേഖപ്പെടുത്തിയ റീഫണ്ടുകൾ", stopped: "പരിധി വേണ്ടെന്ന് പറഞ്ഞ തവണകൾ",
    heldForOwner: "ഉടമയ്ക്കായി കാത്ത തവണകൾ", changes: "അയച്ച പരിധികൾ", changed: (d, who, what) => `${d}: ${who} ${what} മാറ്റി`, noChanges: (s) => `${s} മുതൽ ഒരു പരിധിയും അയച്ചിട്ടില്ല.`,
    noHistory: "ഈ കടയുടെ ക്രമീകരണങ്ങളുടെ ചരിത്രം പാനലിൽ ഇതുവരെ ഇല്ല.", hidden: "നടത്തുന്നയാൾ കാണിച്ചിട്ടില്ല", role: { builder: "ബിൽഡർ", partner: "പ്രാദേശിക പങ്കാളി" },
  },
  not: {
    truth: "രേഖയിൽ പറയുന്നത് ശരിയാണോ എന്ന്. ഈ രേഖ ഏജന്റിന്റെ സ്വന്തം രേഖയിൽ നിന്ന് ഉണ്ടാക്കിയതാണ്.",
    providers: "ഈ രേഖയ്ക്കായി പണമടവ് സേവനത്തിന്റെയും കലണ്ടറിന്റെയും രേഖകൾ വീണ്ടും നോക്കിയിട്ടില്ല. അന്ന് ഏജന്റ് അവയിൽ നിന്ന് വായിച്ചതാണ് ഇതിൽ.",
    words: "ഉപഭോക്താവ് എഴുതിയത്. ഓരോ സന്ദേശത്തിന്റെയും വിരലടയാളം മാത്രമേ രേഖ സൂക്ഷിക്കൂ.",
    outside: "ഏജന്റിന് പുറത്ത് നടന്നതൊന്നും: ഫോൺ കോളുകൾ, പണം കൈയിൽ, ഉടമയുടെ സ്വന്തം UPI ആപ്പ്.",
    guardLog: "Guard-ന്റെ സ്വന്തം തീരുമാന രേഖ. Guard-ന്റെ മറുപടികളെക്കുറിച്ച് ഏജന്റ് രേഖപ്പെടുത്തിയത് മാത്രമാണ് കാണിക്കുന്നത്.",
    whoIsRight: "ആരാണ് ശരി എന്ന്. ഈ രേഖ രേഖകൾ അരികരികെ കാണിക്കുന്നു, അത് തീരുമാനിക്കുന്നില്ല.",
    upi: "UPI പണം എത്തിയോ എന്ന്. ഉടമ രേഖപ്പെടുത്തി; ഒരു പണമടവ് സേവനത്തിനും ഇതിന്റെ രേഖയില്ല.",
    others: "മറ്റാരുടെയെങ്കിലും പണമടവുകൾ. ഈ വിവരം ഈ നമ്പറിന്റെ പണമടവുകൾ മാത്രം കാണിക്കുന്നു.",
    cash: "ഏജന്റിന് പുറത്ത്, പണമായോ നേരിട്ട് ഉടമയ്ക്കോ നൽകിയ തുക, ഉടമ അത് രേഖപ്പെടുത്തിയില്ലെങ്കിൽ.",
    everySituation: "എല്ലാ സാഹചര്യങ്ങളും. പരിശോധന ചില സാഹചര്യങ്ങൾ മാത്രം നോക്കി, ഉപഭോക്താവ് അയയ്ക്കാവുന്ന എല്ലാ സന്ദേശങ്ങളുമല്ല.",
    keyHolder: "ഒപ്പിന്റെ കീ ആരുടെ കൈയിലാണെന്ന്. പരിശോധിക്കുമ്പോൾ നിങ്ങൾ ഇതിനകം വിശ്വസിക്കുന്ന കീ പറയുക.",
    historyStart: (d) => `${d} ന് മുമ്പുള്ള പരിധി മാറ്റങ്ങൾ, പാനൽ കടയുടെ ക്രമീകരണങ്ങൾ സൂക്ഷിക്കാൻ തുടങ്ങിയത് അന്നാണ്.`,
    liveNotChecked: "ഇതുവരെയുള്ള എണ്ണം, സേവനങ്ങളുടെ സ്വന്തം രേഖകളുമായി. ഇവ ഏജന്റിന്റെ രേഖയിൽ നിന്ന് എണ്ണിയതാണ്.",
    noLedger: "രേഖയുടെ വിരലടയാളം. ഈ രേഖ അതുമായി ബന്ധിപ്പിച്ചിട്ടില്ല.",
    anchorNotCompared: "ഈ രേഖയിലെ വിരലടയാളം അന്ന് കട പ്രസിദ്ധീകരിച്ചതുതന്നെയാണോ എന്ന്. രണ്ടും ഒത്തുനോക്കുക, രേഖ തന്നെ തുറന്ന പരിശോധകൻ geo-verify കൊണ്ട് പരിശോധിക്കുക.",
  },
};

const kn: PaperWords = {
  outcome: { attempted: "ಪ್ರಯತ್ನಿಸಿತು", confirmed: "ಆಯಿತು, ಸೇವೆಯ ದಾಖಲೆಯಲ್ಲಿ ನೋಡಿತು", unconfirmed: "ಸೇವೆ ದೃಢಪಡಿಸಲಿಲ್ಲ", failed: "ಆಗಲಿಲ್ಲ", blocked: "ಮಿತಿ ತಡೆಯಿತು", held_for_owner: "ಮಾಲೀಕರ ಉತ್ತರಕ್ಕೆ ಕಾಯುತ್ತಿದೆ" },
  action: {
    receive_message: "ಸಂದೇಶ ಬಂತು", receive_payment_event: "ಪಾವತಿ ಸೂಚನೆ ಬಂತು", send_message: "ಸಂದೇಶ ಕಳುಹಿಸಿತು", ask_owner: "ಮಾಲೀಕರನ್ನು ಕೇಳಿತು", opt_out: "ಇನ್ನು ಸಂದೇಶ ಬೇಡ ಎಂದರು",
    owner_decision: "ಮಾಲೀಕರ ಉತ್ತರ", refund: "ಹಣ ವಾಪಸ್", voice_note_reply: "ವಾಯ್ಸ್ ನೋಟ್‌ಗೆ ಉತ್ತರ", ai_mode: "ಬಟನ್‌ಗಳಿಗೆ ಮಾತ್ರ ಬದಲಾಯಿತು",
    upi_request: "UPI ಪಾವತಿ ವಿನಂತಿ ಕಳುಹಿಸಿತು", upi_paid_claim: "ಪಾವತಿಸಿದ್ದೇವೆ ಎಂದು ಗ್ರಾಹಕರು ಹೇಳಿದರು", owner_marked_paid: "ಹಣ ಬಂತು ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದರು", upi_request_closed: "UPI ವಿನಂತಿ ಮುಚ್ಚಿತು",
    upi_refund_owed: "ಮಾಲೀಕರು ವಾಪಸ್ ಕೊಡಬೇಕಾದ ಹಣ", upi_refund_marked_done: "ಹಣ ವಾಪಸ್ ಕಳುಹಿಸಿದೆ ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದರು", upi_refund_kept: "ಕೈಯಾರೆ ಮಾಡಿದ ಬುಕಿಂಗ್‌ಗೆ ಮಾಲೀಕರು ಹಣ ಇಟ್ಟುಕೊಂಡರು", upi_refund_reminder: "ಬಾಕಿ ಹಣ ವಾಪಸಿನ ನೆನಪು",
  },
  common: { shop: "ಅಂಗಡಿ", issued: "ಮಾಡಿದ ದಿನ", code: "ಪರಿಶೀಲನಾ ಕೋಡ್", checkAt: (p) => `geometer.dev${p} ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ`, notChecked: "ಈ ಕಾಗದ ಏನನ್ನು ಪರಿಶೀಲಿಸಲಿಲ್ಲ", notSigned: "ಸಹಿ ಇಲ್ಲ",
    signedBy: "ಈ ಕೀಲಿಯಿಂದ ಸಹಿ", digest: "ಡೈಜೆಸ್ಟ್", ledger: "ದಾಖಲೆಯ ಬೆರಳಚ್ಚು (ನಮೂದು ಮತ್ತು ಹ್ಯಾಶ್)", ledgerNone: "ದಾಖಲೆಯ ಬೆರಳಚ್ಚಿಗೆ ಜೋಡಿಸಿಲ್ಲ", draft: "ಕರಡು ಪದಗಳು, ಪರಿಶೀಲನೆ ಬಾಕಿ",
    signatureNote: "ಸಹಿ ಮಾಡಿದ ನಂತರ ಈ ಕಾಗದ ಬದಲಾಗಿಲ್ಲ ಎಂದು ಕೋಡ್ ಮತ್ತು ಡೈಜೆಸ್ಟ್‌ನಿಂದ ಯಾರಾದರೂ ನೋಡಬಹುದು. ಇದರಲ್ಲಿ ಹೇಳಿದ್ದು ನಿಜ ಎಂದು ಅದು ತೋರಿಸುವುದಿಲ್ಲ." },
  statement: {
    title: "ನಿಮ್ಮ ಪಾವತಿಗಳ ವಿವರ", forNumber: (l) => `${l} ರಲ್ಲಿ ಮುಗಿಯುವ WhatsApp ಸಂಖ್ಯೆಗೆ`, intro: "ನಿಮ್ಮ ಸ್ವಂತ ಪಾವತಿಗಳು ಮತ್ತು ವಾಪಸುಗಳು ಮಾತ್ರ, ಈ ಅಂಗಡಿಯ ಏಜೆಂಟ್ ದಾಖಲಿಸಿದಂತೆ. ಬೇರೆ ಯಾರ ಬಗ್ಗೆಯೂ ಏನೂ ಇಲ್ಲ.",
    heading: "ನಿಮ್ಮ ಪಾವತಿಗಳು", paid: "ಪಾವತಿ", refunded: "ವಾಪಸ್", markedPaid: "ಹಣ ಬಂತು ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದರು", markedRefund: "ವಾಪಸ್ ಕಳುಹಿಸಿದೆ ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದರು", totalPaid: "ಒಟ್ಟು ಪಾವತಿ", totalRefunded: "ಒಟ್ಟು ವಾಪಸ್",
    net: "ಪಾವತಿಯಿಂದ ವಾಪಸ್ ಕಳೆದು", owed: "ಈಗಲೂ ಬಾಕಿ, ದಾಖಲೆಯ ಪ್ರಕಾರ", none: "ಈ ಸಂಖ್ಯೆಗೆ ಯಾವ ಪಾವತಿಯೂ ದಾಖಲಾಗಿಲ್ಲ.", when: "ಯಾವಾಗ", what: "ಏನು", amount: "ಮೊತ್ತ", case: "ಯಾವುದಕ್ಕೆ",
  },
  dispute: {
    title: "ಒಂದು ಪ್ರಕರಣದ ದಾಖಲೆ", intro: "ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ: ಈ ಒಂದು ಪ್ರಕರಣದ ಬಗ್ಗೆ ದಾಖಲೆಯ ಪ್ರತಿ ಭಾಗ ಏನು ಹೇಳುತ್ತದೆ. ಯಾರು ಸರಿ ಎಂದು ಈ ಕಾಗದ ತೀರ್ಮಾನಿಸುವುದಿಲ್ಲ.",
    time: "ಸಮಯ", asked: "ಗ್ರಾಹಕರು", did: "ಏಜೆಂಟ್", limits: "ಮಿತಿಗಳು ಮತ್ತು Guard", approved: "ಮಾಲೀಕರು", services: "ಸೇವೆಗಳ ದಾಖಲೆಗಳು", askedFor: "ಕೇಳಿದ್ದು, ಏಜೆಂಟ್ ಅರ್ಥ ಮಾಡಿಕೊಂಡಂತೆ",
    message: "ಒಂದು ಸಂದೇಶ (ಪದಗಳನ್ನು ಇಡುವುದಿಲ್ಲ, ಬೆರಳಚ್ಚು ಮಾತ್ರ)", claim: (v) => `ಪಾವತಿಸಿದ್ದೇವೆ ಎಂದರು (${v})`, guardHeld: (a) => `Guard ಇದನ್ನು ಮಾಲೀಕರಿಗಾಗಿ ತಡೆಹಿಡಿಯಿತು (ಅನುಮತಿ ${a})`,
    rule: (r, v, why) => `ಮಿತಿ ${r}: ${v}${why ? `, ${why}` : ""}`, verdict: { allow: "ಬಿಟ್ಟಿತು", block: "ತಡೆಯಿತು", hold_for_owner: "ಮಾಲೀಕರಿಗಾಗಿ ತಡೆಹಿಡಿಯಿತು" }, owner: (c) => `ಮಾಲೀಕರ ಉತ್ತರ: ${c}`,
    ownerMarked: "ಹಣ ಬಂತು ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದರು (ಪಾವತಿ ಸೇವೆಯ ದಾಖಲೆ ಇಲ್ಲ)", ownerMarkedRefund: "ವಾಪಸ್ ಕಳುಹಿಸಿದೆ ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದರು (ಪಾವತಿ ಸೇವೆಯ ದಾಖಲೆ ಇಲ್ಲ)",
    service: { payments: "ಪಾವತಿ ಸೇವೆ", calendar: "ಕ್ಯಾಲೆಂಡರ್", whatsapp: "WhatsApp" }, showed: (s, ids) => `ಏಜೆಂಟ್ ನೋಡಿದಾಗ ${s} ನ ಸ್ವಂತ ದಾಖಲೆಯಲ್ಲಿ ${ids} ಇತ್ತು`,
    nothing: "ಈ ಪ್ರಕರಣದ ಬಗ್ಗೆ ದಾಖಲೆಯಲ್ಲಿ ಏನೂ ಇಲ್ಲ.", case: "ಪ್ರಕರಣ", customer: "ಗ್ರಾಹಕರು, ದಾಖಲೆಯಲ್ಲಿ ಇರುವಂತೆ", state: "ಈಗಿನ ಸ್ಥಿತಿ",
  },
  identity: {
    title: "ಈ ಏಜೆಂಟ್ ಬಗ್ಗೆ", id: "ಏಜೆಂಟ್ ಗುರುತು", operator: "ನಡೆಸುವವರು", shop: "ಅಂಗಡಿಗಾಗಿ", template: "ಟೆಂಪ್ಲೇಟ್ ಮತ್ತು ಆವೃತ್ತಿ", limits: "ಇದರ ಮಿತಿಗಳು", checks: "ಆರಂಭಕ್ಕೆ ಮುನ್ನದ ಪರಿಶೀಲನೆ",
    held: (h, t) => `${t} ಸನ್ನಿವೇಶಗಳಲ್ಲಿ ${h} ರಲ್ಲಿ ಮಿತಿ ನಿಂತಿತು`, checksNone: "ಈ ಕಾಗದಕ್ಕೆ ಆರಂಭದ ಪರಿಶೀಲನೆಯ ಫಲಿತಾಂಶ ಕೊಟ್ಟಿಲ್ಲ.", notTestedHeading: "ಪರಿಶೀಲನೆ ಏನನ್ನು ನೋಡಲಿಲ್ಲ",
    live: "ಇದುವರೆಗೆ ಮಾಡಿದ್ದು", liveSince: (d) => `${d} ರಿಂದ`, entries: "ದಾಖಲೆಯ ನಮೂದುಗಳು", payments: "ದಾಖಲಾದ ಪಾವತಿಗಳು", refunds: "ದಾಖಲಾದ ವಾಪಸುಗಳು", stopped: "ಮಿತಿ ಬೇಡ ಎಂದ ಬಾರಿ",
    heldForOwner: "ಮಾಲೀಕರಿಗಾಗಿ ಕಾದ ಬಾರಿ", changes: "ಸಡಿಲಿಸಿದ ಮಿತಿಗಳು", changed: (d, who, what) => `${d}: ${who} ${what} ಬದಲಿಸಿದರು`, noChanges: (s) => `${s} ರಿಂದ ಯಾವ ಮಿತಿಯನ್ನೂ ಸಡಿಲಿಸಿಲ್ಲ.`,
    noHistory: "ಈ ಅಂಗಡಿಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳ ಇತಿಹಾಸ ಪ್ಯಾನೆಲ್‌ನಲ್ಲಿ ಇನ್ನೂ ಇಲ್ಲ.", hidden: "ನಡೆಸುವವರು ತೋರಿಸಿಲ್ಲ", role: { builder: "ಬಿಲ್ಡರ್", partner: "ಸ್ಥಳೀಯ ಪಾಲುದಾರ" },
  },
  not: {
    truth: "ದಾಖಲೆಯಲ್ಲಿ ಹೇಳಿದ್ದು ನಿಜವೇ ಎಂದು. ಈ ಕಾಗದ ಏಜೆಂಟ್‌ನ ಸ್ವಂತ ದಾಖಲೆಯಿಂದ ಮಾಡಿದ್ದು.",
    providers: "ಈ ಕಾಗದಕ್ಕಾಗಿ ಪಾವತಿ ಸೇವೆ ಮತ್ತು ಕ್ಯಾಲೆಂಡರ್‌ನ ದಾಖಲೆಗಳನ್ನು ಮತ್ತೆ ನೋಡಿಲ್ಲ. ಆಗ ಏಜೆಂಟ್ ಅವುಗಳಿಂದ ಓದಿದ್ದನ್ನು ಇದು ತೋರಿಸುತ್ತದೆ.",
    words: "ಗ್ರಾಹಕರು ಏನು ಬರೆದರು ಎಂದು. ದಾಖಲೆ ಪ್ರತಿ ಸಂದೇಶದ ಬೆರಳಚ್ಚನ್ನು ಮಾತ್ರ ಇಡುತ್ತದೆ.",
    outside: "ಏಜೆಂಟ್‌ನ ಹೊರಗೆ ನಡೆದದ್ದು: ಫೋನ್ ಕರೆಗಳು, ನಗದು, ಮಾಲೀಕರ ಸ್ವಂತ UPI ಆಪ್.",
    guardLog: "Guard ನ ಸ್ವಂತ ತೀರ್ಮಾನಗಳ ದಾಖಲೆ. Guard ನ ಉತ್ತರಗಳ ಬಗ್ಗೆ ಏಜೆಂಟ್ ದಾಖಲಿಸಿದ್ದನ್ನು ಮಾತ್ರ ತೋರಿಸಿದೆ.",
    whoIsRight: "ಯಾರು ಸರಿ ಎಂದು. ಈ ಕಾಗದ ದಾಖಲೆಗಳನ್ನು ಪಕ್ಕಪಕ್ಕದಲ್ಲಿ ತೋರಿಸುತ್ತದೆ, ಅದನ್ನು ತೀರ್ಮಾನಿಸುವುದಿಲ್ಲ.",
    upi: "UPI ಹಣ ಬಂತೇ ಎಂದು. ಮಾಲೀಕರು ಗುರುತಿಸಿದರು; ಯಾವ ಪಾವತಿ ಸೇವೆಯ ಬಳಿಯೂ ಇದರ ದಾಖಲೆ ಇಲ್ಲ.",
    others: "ಬೇರೆ ಯಾರದ್ದೇ ಪಾವತಿಗಳು. ಈ ವಿವರ ಈ ಸಂಖ್ಯೆಯ ಪಾವತಿಗಳನ್ನು ಮಾತ್ರ ತೋರಿಸುತ್ತದೆ.",
    cash: "ಏಜೆಂಟ್‌ನ ಹೊರಗೆ, ನಗದಾಗಿ ಅಥವಾ ನೇರವಾಗಿ ಮಾಲೀಕರಿಗೆ ಕೊಟ್ಟ ಹಣ, ಮಾಲೀಕರು ಗುರುತಿಸದಿದ್ದರೆ.",
    everySituation: "ಎಲ್ಲಾ ಸನ್ನಿವೇಶಗಳು. ಪರಿಶೀಲನೆ ಕೆಲವು ಸನ್ನಿವೇಶಗಳನ್ನು ಮಾತ್ರ ನೋಡಿತು, ಗ್ರಾಹಕರು ಕಳುಹಿಸಬಹುದಾದ ಎಲ್ಲಾ ಸಂದೇಶಗಳನ್ನಲ್ಲ.",
    keyHolder: "ಸಹಿಯ ಕೀಲಿ ಯಾರ ಬಳಿ ಇದೆ ಎಂದು. ಪರಿಶೀಲಿಸುವಾಗ ನೀವು ಈಗಾಗಲೇ ನಂಬುವ ಕೀಲಿಯನ್ನು ಹೇಳಿ.",
    historyStart: (d) => `${d} ಕ್ಕಿಂತ ಮೊದಲಿನ ಮಿತಿ ಬದಲಾವಣೆಗಳು, ಪ್ಯಾನೆಲ್ ಅಂಗಡಿಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳನ್ನು ಇಡಲು ಶುರು ಮಾಡಿದ್ದು ಆಗ.`,
    liveNotChecked: "ಇದುವರೆಗಿನ ಎಣಿಕೆ, ಸೇವೆಗಳ ಸ್ವಂತ ದಾಖಲೆಗಳ ಜೊತೆ. ಇವು ಏಜೆಂಟ್‌ನ ದಾಖಲೆಯಿಂದ ಎಣಿಸಿದವು.",
    noLedger: "ದಾಖಲೆಯ ಬೆರಳಚ್ಚು. ಈ ಕಾಗದವನ್ನು ಅದಕ್ಕೆ ಜೋಡಿಸಿಲ್ಲ.",
    anchorNotCompared: "ಈ ಕಾಗದದ ಮೇಲಿನ ದಾಖಲೆಯ ಬೆರಳಚ್ಚು ಅಂದು ಅಂಗಡಿ ಪ್ರಕಟಿಸಿದ್ದೇ ಎಂದು. ಎರಡನ್ನೂ ಹೋಲಿಸಿ, ದಾಖಲೆಯನ್ನು ತೆರೆದ ಪರಿಶೀಲಕ geo-verify ನಿಂದ ಪರಿಶೀಲಿಸಿ.",
  },
};

export const WORDS: Record<Language, PaperWords> = { en, hi, ml, kn };

/** The word for an action: the template's own, else the shared one, else the action's id with spaces, so an action no one has named still reads. */
export const actionWord = (words: PaperWords, extra: Record<string, string> | undefined, action: string): string => extra?.[action] ?? words.action[action] ?? action.replace(/_/gu, " ");
