// MACHINE-WRITTEN Hindi for the panel (review marker: "machine-written", see REVIEW_STATE in languages.ts). A native Hindi speaker must read every line
// before a real shop sees it; until then the page says so in a line at the foot (draftNote). The shape is the one in words.ts, line for line.
//
// Where a word already exists it is the same word: the report and the certificates (pathways/bookings/report/strings.ts), the customer messages
// (src/language/templates.ts) and the demo (demo/strings.ts) all say जमा राशि, रिफंड, बुकिंग, कैलेंडर, एजेंट, रिपोर्ट, सीमा, जाँच, so this file does too. The shop's form labels come
// from the demo's own Hindi (uiFor("hi")), so the demo and the panel say the same thing. Four of the seven limits are the Hindi column of the
// table in docs/product/gtm-and-revenue.md ("The same lines in Hindi, Malayalam and Kannada"): that table is the one source for them.
// Numbers, amounts, names, dates and addresses are shown exactly as passed in (Western digits). Nothing here says a shop is safe or guaranteed.
import { uiFor } from "../../pathways/bookings/demo/strings.ts";
import type { Words } from "./words.ts";

const demo = uiFor("hi");

/** One form for a count of 1, another for the rest (the same helper pattern words.ts uses). */
const t1 = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const hi: Words = {
  appName: "Geometer",
  languageName: "हिन्दी",
  draftNote: "यह अनुवाद मशीन से बना है और अभी किसी मातृभाषी ने इसे पढ़ा नहीं है। कोई शब्द ग़लत लगे तो अपने Geometer संपर्क को बताइए।",
  nav: { shops: "दुकानें", setUp: "दुकान सेट करें", invite: "किसी को बुलाएँ", signOut: "साइन आउट" },
  common: { back: "पीछे", next: "आगे", save: "सेव करें", counts: "सिर्फ़ गिनती। यहाँ कोई संदेश नहीं दिखता।" },
  login: {
    title: "साइन इन", handle: "आपका साइन इन का नाम", passphrase: "पासवर्ड", button: "साइन इन करें", wrong: "यह नाम या पासवर्ड सही नहीं है।",
    wait: (s) => `बहुत बार कोशिश हो गई। ${s} सेकंड रुकिए और फिर कोशिश कीजिए।`, byInvitation: "अकाउंट सिर्फ़ न्योते से बनते हैं। जो इस सर्वर को चलाते हैं, उनसे अपना लिंक माँगिए।",
  },
  join: {
    title: (role) => `अपना ${role} अकाउंट बनाइए`, intro: "आपका न्योता सिर्फ़ एक बार चलता है। तय कीजिए कि आप कैसे साइन इन करेंगे।", name: "आपका नाम", handle: "साइन इन के लिए नाम", handleHelp: "3 से 40 अक्षर, अंक, बिंदु या डैश।",
    passphrase: "पासवर्ड", passphraseHelp: "कम से कम 10 अक्षर। कुछ शब्द एक साथ रखिए: याद रखना आसान, अंदाज़ा लगाना मुश्किल।", language: "आपकी भाषा", button: "अकाउंट बनाएँ",
    problems: {
      "invite-unknown": "यह लिंक हमारा बनाया हुआ नहीं है। नया लिंक माँगिए।", "invite-used": "यह लिंक पहले ही इस्तेमाल हो चुका है। नया लिंक माँगिए।", "invite-expired": "इस लिंक की मियाद पूरी हो गई है। नया लिंक माँगिए।",
      "handle-bad": "साइन इन के नाम में 3 से 40 अक्षर, अंक, बिंदु या डैश रखिए।", "handle-taken": "यह साइन इन का नाम किसी और ने ले लिया है। कोई दूसरा चुनिए।", "name-bad": "अपना नाम लिखिए।",
      "language-bad": "सूची में से कोई भाषा चुनिए।", short: "पासवर्ड में कम से कम 10 अक्षर चाहिए।", long: "पासवर्ड बहुत लंबा है (ज़्यादा से ज़्यादा 200 अक्षर)।",
      "same-as-handle": "पासवर्ड और साइन इन का नाम एक जैसे नहीं हो सकते।",
    },
  },
  roles: { builder: "बिल्डर", partner: "पार्टनर" },
  invite: { title: "किसी को बुलाएँ", role: "वे इस रूप में जुड़ेंगे", note: "यह किसके लिए है?", button: "लिंक बनाएँ", made: "यह रहा लिंक। यह एक बार चलता है और 3 दिन में ख़त्म हो जाता है।", copy: "इसे सिर्फ़ उसी व्यक्ति को भेजिए।", hostedOnly: "इस सर्वर पर न्योते वही बनाते हैं जो सर्वर चलाते हैं।" },
  shops: {
    title: "आपकी दुकानें", titleAll: "इस सर्वर की सभी दुकानें", empty: "अभी कोई दुकान नहीं है।", setUp: "दुकान सेट करें", version: (v) => `वर्ज़न ${v}`,
    limits: (p, o) => `${o} में से ${p} सीमाएँ जाँच में ठीक निकलीं`, limitsUnknown: "सीमाएँ: अभी पक्का नहीं", setUpBy: (n) => `सेट करने वाले: ${n}`, setUpOnServer: "सर्वर पर सेट की गई",
  },
  live: {
    unknown: "अभी पक्का नहीं", "setting-up": "सेट हो रही है", live: "चालू", attention: "देखने की ज़रूरत है",
    stopping: "रोकने को कहा गया है। सर्वर की पुष्टि का इंतज़ार है।", stopped: "रोक दिया गया। अब कुछ भी नहीं भेजा जाएगा।",
  },
  why: {
    "no-status": "सर्वर ने अभी तक इस दुकान के बारे में कुछ नहीं बताया।", "status-unreadable": "सर्वर की भेजी स्थिति पढ़ी नहीं जा सकी।", "status-old": "सर्वर ने काफ़ी समय से कुछ नहीं बताया।",
    "deploy-failed": "पिछला अपडेट नहीं हो पाया।", "limits-not-proven": "सभी सीमाओं की जाँच अभी पूरी नहीं हुई है।", "runtime-unreachable": "एजेंट जवाब नहीं दे रहा।",
    "runtime-not-ready": "एजेंट कहता है कि वह अभी तैयार नहीं है।", "refunds-need-builder": "रिफंड के लिए बिल्डर की ज़रूरत है, मालिक की नहीं।",
  },
  shop: {
    status: "स्थिति", versions: (p, b) => `पाथवे ${p}, बंडल ${b}`, lastDeploy: (at) => `पिछला अपडेट: ${at}`, neverDeployed: "अभी तक अपडेट नहीं हुआ।",
    limitsHeading: "सीमाएँ", unprovable: (l) => `इनकी अलग से जाँच नहीं हो सकती: ${l}`,
    backups: "बैकअप", backupCopy: (at) => `सर्वर के बाहर आख़िरी कॉपी: ${at}`, backupNone: "सर्वर के बाहर अभी कोई कॉपी नहीं है।",
    backupDrill: (at, ok) => `आख़िरी बार कॉपी से डेटा वापस लाकर जाँचा: ${at}, ${ok ? "मेल खा गया" : "मेल नहीं खाया"}`, backupDrillNone: "कॉपी से डेटा वापस लाकर जाँचना अभी हुआ नहीं।",
    settings: "एजेंट इस दुकान के बारे में क्या जानता है", settingsEdit: "सेटिंग बदलें", summaryServices: "सेवाएँ", summaryHours: "खुलने का समय", hoursRange: (o, c) => `${o} से ${c} तक`, summaryClosed: "बंद",
    summaryDeposit: (a, m) => `जमा राशि ${a}; इसके लिए स्लॉट ${m} मिनट रोका जाता है`,
    summaryCancel: (h, l) => `कम से कम ${h} घंटे पहले रद्द करने पर जमा राशि लौट जाती है; ${l} से ज़्यादा रिफंड देने से पहले यह आपसे पूछता है`, summaryLanguages: "ग्राहकों की भाषाएँ", summaryOwner: "मालिक का WhatsApp",
    activity: "इस महीने", activityNote: "सिर्फ़ गिनती। यहाँ कोई संदेश नहीं दिखता।", noRecord: "रिकॉर्ड अभी पैनल के साथ साझा नहीं हुआ है, इसलिए सिर्फ़ वही दिख रहा है जो अभी चालू है।",
    waiting: (n) => `मालिक के जवाब का इंतज़ार: ${n} रिफंड`, needBuilder: (n) => `बिल्डर की ज़रूरत वाले रिफंड: ${n}`,
    made: "हुई बुकिंग", cancelled: "रद्द हुईं", moved: "समय बदला", deposits: "जमा राशि मिली", refunds: "रिफंड वापस किए", saidNo: "जिन माँगों को इसने मना किया",
    approvals: "मालिक की मंज़ूरी", approvalsLine: (a, ap, d) => `${a} बार पूछा गया: ${ap} मंज़ूर, ${d} मना।`,
    bookingStates: {
      enquiry: "पूछताछ", confirming_details: "ब्योरा पक्का हो रहा है", awaiting_deposit: "जमा राशि का इंतज़ार", needs_owner: "मालिक का इंतज़ार", confirmed: "बुक हो गया", expired: "रोक की मियाद ख़त्म", cancelled: "रद्द", completed: "पूरी हुई",
    },
    papers: "मालिक के लिए दस्तावेज़", goLive: "चालू करने से पहले का जाँच प्रमाणपत्र", goLiveNone: "अभी बना नहीं है। सेटअप में जाँच पूरी होने पर बनता है।", monthly: "मासिक रिपोर्ट", makeReport: (m) => `${m} की रिपोर्ट बनाइए`,
    reportNoRecord: "रिकॉर्ड अभी पैनल के साथ साझा नहीं हुआ है, इसलिए मासिक रिपोर्ट नहीं बन सकती।", reportMade: "रिपोर्ट तैयार है।",
    stop: "इस दुकान को रोकें", stopTitle: (n) => `${n} को रोकें?`, stopText: "यह सर्वर से एजेंट को रोकने के लिए कहता है। सर्वर के रोक देने के बाद कुछ भी आगे नहीं भेजा जाएगा। इसमें एक मिनट लग सकता है, और सर्वर इसे दोबारा तभी चालू करता है जब आप कहें।",
    stopConfirm: "हाँ, रोक दीजिए", stopAsked: (at) => `${at} पर रोकने को कहा गया। सर्वर की पुष्टि का इंतज़ार है।`, stopOnly: "रुका है या नहीं, यह सिर्फ़ सर्वर बता सकता है।",
    details: "हमने क्या किया, देखें ▸", detailsDeploy: "सर्वर का आख़िरी संदेश", detailsPins: "जिन आईडी की जाँच में पुष्टि हुई", detailsPrices: (d) => `${d} की कीमत-सूची`, detailsNothing: "अभी कुछ नहीं", detailsStatusFile: "सर्वर ने क्या बताया",
  },
  cost: {
    heading: "हर महीने चलाने का ख़र्च", early: "शुरुआती अंदाज़ा: अभी असली बुकिंग गिनी नहीं गई हैं।", fromRecord: (n) => `रिकॉर्ड की ${n} बुकिंग से निकाला गया।`, assumption: (n) => `हमने महीने में ${n} बुकिंग मानी हैं।`,
    lines: { whatsapp: "WhatsApp संदेश (Meta की फ़ीस)", "whatsapp-provider": "WhatsApp प्रोवाइडर की अपनी फ़ीस", model: "मॉडल का इस्तेमाल", razorpay: "Razorpay की फ़ीस", hosting: "होस्टिंग का हिस्सा" },
    payer: { "passed-through": "लागत के दाम पर आगे डाला जाता है", "shop-pays-razorpay": "दुकान सीधे Razorpay को देती है", hosting: "सर्वर का ख़र्च, बाँटकर" },
    unknown: "पता नहीं", included: "शामिल", usage: (a) => `मॉडल के इस्तेमाल का लगभग ${a}`, total: "कुल", subtotal: (n) => `अभी का जोड़। ${n} ${t1(n, "चीज़ की", "चीज़ों की")} कीमत अभी पता नहीं है, इसलिए यह पूरा ख़र्च नहीं है।`, priceList: (d) => `कीमतें ${d} की सूची से ली गई हैं।`,
    caveats: {
      "assumed-exchange-rate": "डॉलर और यूरो की कीमतों में अंदाज़े का भाव (₹90 और ₹100) लिया गया है। असली बिल अलग हो सकता है।",
      "provider-not-chosen": "WhatsApp प्रोवाइडर अभी चुना नहीं गया है, इसलिए उसकी फ़ीस पता नहीं।",
      "provider-not-priced": "कीमत-सूची में इस प्रोवाइडर की कीमत नहीं है।",
      "allowance-not-set": "मॉडल के इस्तेमाल की शामिल हद तय नहीं है, इसलिए आगे डाली जाने वाली रकम पता नहीं।",
      "model-not-priced": "कीमत-सूची में इस मॉडल की कीमत नहीं है।",
      "hosting-not-measured": "होस्टिंग का हिस्सा अभी नापा नहीं गया है।",
      "payment-link-fee-conflict": "पेमेंट लिंक की फ़ीस पर Razorpay के अपने पेज एक-दूसरे से अलग बात कहते हैं। ऊँची वाली (2%) ली गई है।",
      "whatsapp-rate-second-hand": "WhatsApp का रुपये वाला भाव Meta के पेज से नहीं, किसी रीसेलर के पेज से आया है। पहले इनवॉइस पर इसे जाँच लीजिए।",
    },
  },
  setup: {
    title: "दुकान सेट करें", chooseTemplate: "यह क्या काम करेगा?", templateNames: { bookings: "जमा राशि के साथ बुकिंग" },
    templateElsewhere: "इसे बिल्डर प्लगइन से सेट करता है। फ़ोन वाले सेटअप में यह अभी नहीं है।", start: "शुरू करें", progress: (n, o) => `कदम ${n} / ${o}`,
    steps: { business: "दुकान की जानकारी", deposit: "जमा राशि और रद्द करना", languages: "भाषाएँ और आपका नंबर", accounts: "दुकान के अकाउंट जोड़ें", checks: "जाँच" },
    problemsTitle: "कृपया यह ठीक कीजिए:", fallback: (e) => `एक बात ठीक करनी है: ${e}`,
    business: {
      name: demo.formName, services: demo.formServices, serviceName: demo.formServiceName, also: demo.formAlso, price: demo.formPrice, minutes: demo.formMinutes, opens: demo.formOpens, closes: demo.formCloses, openOn: demo.formDays,
      hint: "सेवा की जो कीमत आप लिखेंगे, एजेंट उससे कम में कभी राज़ी नहीं होगा।", dayNames: demo.dayNames,
    },
    depositStep: { amount: demo.formDeposit, window: "कम से कम इतने घंटे पहले रद्द करें", windowHint: "अगर ग्राहक इससे पहले रद्द करता है तो जमा राशि लौट जाती है। इसके बाद रद्द करने पर फ़ैसला आप करते हैं।", whatThisMeans: "आपके लिए इसका मतलब" },
    limits: {
      price: "यह आपकी कीमतों से कम नहीं जा सकता, और कोई भी रिफंड देने से पहले आपसे पूछता है।",
      hours: "यह आपके खुलने के समय के बाहर कभी बुक नहीं करता।",
      deposit: (a, m) => `जमा राशि ${a} है, आपकी सबसे कम कीमत से कभी ज़्यादा नहीं, और पैसे जमा होने तक स्लॉट ${m} मिनट रुका रहता है।`,
      refund: (h, l) => `अगर ग्राहक शुरू होने से कम से कम ${h} घंटे पहले रद्द करे, तो जमा राशि लौट जाती है। इससे देर से, या ${l} से ऊपर के किसी भी रिफंड के लिए आपके WhatsApp पर आपकी हाँ का इंतज़ार रहता है।`,
      booked: "जब यह \"बुक हो गया\" कहता है, तब स्लॉट आपके कैलेंडर में होता है और डिपॉज़िट आपके खाते में।",
      language: "आपके ग्राहकों को उनकी भाषा में जवाब मिलता है, सही कीमत और तारीख के साथ।",
      charge: "आपके फ़ोन से, फ़ैसला हमेशा आपके हाथ में रहता है।",
    },
    languagesStep: {
      main: "आपके ग्राहकों की मुख्य भाषा", also: "जिन और भाषाओं में आपके ग्राहक लिखते हैं, उन पर निशान लगाइए", hint: "एजेंट मुख्य भाषा से शुरू करता है और हर ग्राहक को उसी भाषा में जवाब देता है जिसमें वह लिखे।", ownerLanguage: "आपको संदेश भेजने के लिए आपकी भाषा",
      ownerNumber: "आपका अपना WhatsApp नंबर", ownerNumberHelp: "देश कोड से शुरू कीजिए, जैसे +91 98765 43210। किसी भी रिफंड से पहले एजेंट आपसे यहीं पूछता है। यह आपका अपना नंबर है, दुकान का वह नंबर नहीं जिस पर ग्राहक लिखते हैं।",
    },
    problems: {
      nameEmpty: "दुकान का नाम लिखिए।", noService: "कीमत के साथ कम से कम एक सेवा जोड़िए।", priceBad: (n) => `सेवा ${n}: कीमत पूरे रुपयों में लिखिए, जैसे 450।`, depositBad: "जमा राशि पूरे रुपयों में लिखिए, जैसे 200।",
      depositTooBig: (d, c) => `जमा राशि (${d}) आपकी सबसे सस्ती सेवा (${c}) से ज़्यादा है। जमा राशि कम कीजिए।`, windowBad: "घंटे पूरी संख्या में लिखिए, जैसे 24।",
      hoursBad: "दुकान बंद होने से पहले खुलनी चाहिए। समय ऐसे लिखिए: 10:00 और 20:00।", noDay: "कम से कम एक ऐसा दिन चुनिए जब दुकान खुलती है।", noLanguage: "कम से कम एक भाषा चुनिए।",
      ownerNumberBad: "अपना नंबर देश कोड के साथ लिखिए, जैसे +91 98765 43210।", sameNumber: "आपका नंबर और दुकान का WhatsApp नंबर अलग होने चाहिए। आप अपने ही फ़ोन से जवाब देते हैं।",
      serviceNameEmpty: (n) => `सेवा ${n} की कीमत लिखी है, पर नाम नहीं।`,
      expectedBad: "महीने की बुकिंग पूरी संख्या में लिखिए, जैसे 40, या खाली छोड़ दीजिए।", numberIdBad: "फ़ोन नंबर आईडी में सिर्फ़ अंक होते हैं (6 से 20)।", businessNumberBad: "दुकान का WhatsApp नंबर देश कोड के साथ लिखिए।", keyIdBad: "कुंजी आईडी (Key ID) rzp_live_ या rzp_test_ से शुरू होती है।",
      secretMissing: (w) => `${w} भरिए।`, secretShape: (w) => `${w} में खाली जगह या नई लाइन है। इसे उनके बिना फिर से कॉपी कीजिए।`,
      calendarIdBad: "कैलेंडर की आईडी बिना खाली जगह के लिखिए।", jsonBad: "यह Google सर्विस-अकाउंट की कुंजी फ़ाइल नहीं है। पूरी फ़ाइल चिपकाइए।", modeBad: "लाइव या अभ्यास चुनिए।",
    },
    accounts: {
      intro: "हर अकाउंट दुकान का अपना होता है। यहाँ भरी गई कुंजियाँ सर्वर के कुंजी-भंडार में जाती हैं, दोबारा नहीं दिखाई जातीं, और इस पैनल में नहीं रखी जातीं।",
      received: (at) => `${at} को मिला।`, keepEmpty: "जैसा है वैसा रखना हो तो खाली छोड़िए।", neverShown: "सेव करने के बाद यह दोबारा नहीं दिखेगा।",
      whatsapp: {
        title: "WhatsApp", intro: "दुकान अपना ही नंबर और अपना ही WhatsApp Business ऐप रखती है। ग्राहक उसी नंबर पर लिखते हैं जिस पर पहले लिखते थे।",
        steps: ["दुकान के फ़ोन पर दुकान के नंबर के साथ WhatsApp Business ऐप चलाते रहिए।", "जिसने नंबर को हेल्पर से जोड़ा है, वह आपको तीन चीज़ें देगा: फ़ोन नंबर आईडी, एक एक्सेस टोकन और ऐप सीक्रेट।", "इन्हें नीचे लिखिए।"],
        number: "दुकान का WhatsApp नंबर", numberId: "फ़ोन नंबर आईडी (Phone number ID)", token: "एक्सेस टोकन (Access token)", appSecret: "ऐप सीक्रेट (App secret)",
      },
      calendar: {
        title: "कैलेंडर", intro: "बुकिंग दुकान के अपने Google कैलेंडर में जाती हैं।",
        steps: ["किसी कंप्यूटर पर Google कैलेंडर खोलिए, और उस कैलेंडर की सेटिंग खोलिए।", "“Share with specific people” (ख़ास लोगों के साथ शेयर करें) में नीचे दिया पता जोड़िए और “Make changes to events” (इवेंट में बदलाव करें) चुनिए।", "“Integrate calendar” (कैलेंडर जोड़ें) में Calendar ID कॉपी करके नीचे लिखिए।"],
        shareAddress: "कैलेंडर को इस पते के साथ शेयर कीजिए:", noAddress: "इस सर्वर के पास शेयर करने का कोई पता नहीं है। आपके बिल्डर ने जो कुंजी फ़ाइल दी है, उसे नीचे चिपकाइए।", id: "कैलेंडर आईडी (Calendar ID)", json: "सर्विस-अकाउंट कुंजी फ़ाइल", jsonHelp: "सिर्फ़ तब, जब आपके बिल्डर ने आपको दी हो। पूरी फ़ाइल चिपकाइए।",
      },
      razorpay: {
        title: "Razorpay", intro: "ग्राहक जमा राशि दुकान के अपने Razorpay अकाउंट में देते हैं। पैसा सीधे दुकान के बैंक में जाता है। Geometer उसे कभी अपने पास नहीं रखता।",
        steps: ["दुकान के अपने Razorpay अकाउंट में साइन इन कीजिए।", "Settings, API keys में एक कुंजी बनाइए और Key ID व Key secret कॉपी कीजिए।", "Settings, Webhooks में नीचे दिखा वेब पता जोड़िए और अपनी पसंद का एक सीक्रेट चुनिए। वही सीक्रेट यहाँ भी लिखिए।"],
        mode: "यह कौन सी कुंजी है?", modeLive: "लाइव: असली पैसा", modeTest: "अभ्यास: टेस्ट पैसा", keyId: "कुंजी आईडी (Key ID)", keySecret: "कुंजी सीक्रेट (Key secret)", webhookSecret: "Webhook सीक्रेट (Webhook secret)",
        webhookUrl: (u) => `Webhook के लिए वेब पता: ${u}`,
      },
    },
    checks: {
      saveFirst: "पहले इस दुकान को सर्वर पर सेव कीजिए।", saveButton: "सेव करें और जोड़ें", saved: "सेव हो गया। सर्वर इसे लागू करेगा, और लागू होते ही यह पेज बता देगा।", runButton: "जाँच चलाइए", waiting: "सर्वर के दुकान लागू करने का इंतज़ार है।",
      settingsOk: "सेटिंग पूरी हैं।", handCheck: "इस दुकान की अपनी कीमतों और समय पर टेस्ट", handNotRun: "अभी चले नहीं।",
      deploy: "सर्वर का अपडेट", deployApplied: (at) => `${at} को लागू हुआ।`, deployNot: "अभी लागू नहीं हुआ।", limitsProven: (p, o) => `${o} में से ${p} सीमाएँ चल रहे एजेंट पर जाँच में ठीक निकलीं।`, limitsNot: "सीमाओं की जाँच अभी पूरी नहीं हुई।",
      guardNotSet: "इस सर्वर ने पैनल को अभी नहीं बताया कि अकाउंट कहाँ जाँचने हैं, इसलिए यहाँ उनकी जाँच नहीं हो सकती।",
      readOnly: "जाँच सिर्फ़ पढ़ती है। यह कभी कोई संदेश नहीं भेजती, कोई पेमेंट नहीं लेती और कोई बुकिंग नहीं बनाती, इसलिए संदेश भेजना और पेमेंट यहाँ जाँचे नहीं जाते।",
      whatsapp: {
        title: "WhatsApp की जाँच", confirmed: (n) => `यह दुकान का ही नंबर है (${n})।`, differs: (e) => `जो नंबर मिला वह ${e} पर ख़त्म होता है, दुकान का नंबर नहीं है। कुछ भी बदला नहीं गया।`,
        notFound: "यह फ़ोन नंबर आईडी इस अकाउंट में नहीं है।",
      },
      razorpay: {
        title: "Razorpay की जाँच", confirmed: (m) => `कुंजी काम करती है (${m})।`, differs: "यह वह कुंजी नहीं है जो पहले पक्की हुई थी। कुछ भी बदला नहीं गया।",
        wrongMode: "इस कुंजी का मोड वह नहीं है जो ऊपर चुना गया है। जो कुंजी मेल खाए, वही इस्तेमाल कीजिए।",
      },
      calendar: {
        title: "कैलेंडर की जाँच", confirmed: (n) => `“${n}” मिला, और इसमें बदलाव हो सकता है।`, differs: "Google एक अलग कैलेंडर दिखा रहा है, दिए गए कैलेंडर से अलग। कुछ भी बदला नहीं गया।",
        notFound: "नहीं मिला। आईडी देखिए, और यह भी कि कैलेंडर ऊपर वाले पते के साथ शेयर हुआ है या नहीं।", notWritable: (r) => `शेयर तो हुआ है, पर “Make changes to events” के साथ नहीं (यह ${r} बता रहा है)।`,
      },
      generic: {
        not_allowed: "अकाउंट ने जाँच मंज़ूर नहीं की। कुंजियाँ देख लीजिए।", refused_by_guard: "सर्वर के Guard ने इस जाँच को आगे नहीं जाने दिया।", unreachable: "वहाँ तक पहुँच नहीं हो पाई। एक मिनट बाद फिर कोशिश कीजिए।",
        unexpected_response: "जवाब वैसा नहीं था जैसा यह सेवा देती है, इसलिए उसे इस्तेमाल नहीं किया गया।", not_configured: "पहले ऊपर की जानकारी भरिए।",
      },
      razorpayWhose: "Razorpay यह नहीं बताता कि कोई कुंजी किसके अकाउंट की है। पहला टेस्ट पेमेंट लिंक खोलकर देखिए: उस पर दुकान का नाम होना चाहिए।",
      guardWords: (d) => `Guard ने कहा: ${d}`,
      bookingsExpected: "हर महीने आपको कितनी बुकिंग की उम्मीद है (सिर्फ़ ख़र्च निकालने के लिए)", readyButton: "चालू करने के लिए तैयार", ready: "चालू करने के लिए तैयार। चालू करने से पहले का जाँच प्रमाणपत्र बन गया है।",
      notReady: (n) => `अभी तैयार नहीं: ${n} ${t1(n, "बात", "बातें")} ठीक करनी ${t1(n, "है", "हैं")}।`, certificate: "चालू करने से पहले का जाँच प्रमाणपत्र खोलिए", switchOn: "सर्वर इसे लागू करते समय दुकान को चालू कर देता है।",
    },
  },
  errors: { notFound: "यहाँ कुछ नहीं है।", notAllowed: "आप यह नहीं कर सकते।", csrf: "वह फ़ॉर्म बहुत पुराना था या इसी पेज से नहीं आया था। पीछे जाइए और फिर कोशिश कीजिए।", tooBig: "यह भेजने के लिए बहुत बड़ा था।", wrongMethod: "यह पेज इस तरह नहीं चलता।", tryAgain: "कुछ गड़बड़ हो गई। फिर कोशिश कीजिए।" },
};
