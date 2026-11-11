// The words of the panel's own-agent pages (B51's rest, 12 Nov 2026: views-agents.ts), in the four languages. English is the source. Hindi, Malayalam and Kannada are
// MACHINE-WRITTEN and WAIT FOR NATIVE REVIEW like the rest of the panel's: the pages carry the panel's draft note in those languages (languages.ts REVIEW_STATE), and every
// line is on the review sheets, section 7 (review.ts adds them under the ids "agents.*"). Names stay in Latin letters (Guard, WhatsApp, Razorpay, Google Calendar, UPI).
// A sentence here says what is so; it never says anything is certain to be fine. The builder licence's price is not here: it is the price list's (views-agents.ts).
import type { Language } from "../../modules/language/languages.ts";

export interface AgentWords {
  heading: string; intro: string; open: string; title(name: string): string; back: string;
  guards: { heading: string; intro: string; desk: string; ownGateway: string; limits(proven: number, of: number): string; limitsUnknown: string; since(day: string): string; oldUntil(time: string): string; shared: string; file(path: string): string };
  held: { heading: string; none: string; some(n: number): string; asOf(when: string): string; unknown: string };
  unfinished: { heading: string; none: string; notShared: string };
  crash: { heading: string; never: string; held(held: number, of: number): string; failed: string; notRun: string; running: string; waiting: string; error(why: string): string; when(at: string, by: string): string; version(v: string): string };
  goLive: { heading: string; none: string; inService(version: string, day: string): string; code(code: string): string };
  licence: { price(price: string): string };
  actions: {
    heading: string; stop: string; stopNote: string; stopAsked: string; stopped: string;
    crashTest: string; crashNote: string; crashAsked: string;
    rotate: string; rotateOne(guard: string): string; rotateNote: string; rotateAsked: string; rotateDone(time: string): string; rotateFailed: string;
    cliOnly: string;
  };
}

/** Sample values for the functions above, so the review sheet shows one real sentence per line. Paths are as review.ts names them ("agents.crash.held"). */
export const AGENT_SAMPLE_ARGS: Record<string, unknown[]> = {
  "agents.title": ["my-agent"],
  "agents.guards.limits": [12, 12], "agents.guards.since": ["4 Nov 2026"], "agents.guards.oldUntil": ["4 Nov 2026, 10:15"], "agents.guards.file": ["secrets/agents/my-agent/credentials.env"],
  "agents.held.some": [1], "agents.held.asOf": ["4 Nov 2026, 10:00"],
  "agents.crash.held": [11, 12], "agents.crash.error": ["The agent did not start"], "agents.crash.when": ["4 Nov 2026, 10:00", "Divya (builder, from the panel)"], "agents.crash.version": ["4f9c2e1"],
  "agents.goLive.inService": ["4f9c2e1", "4 Nov 2026"], "agents.goLive.code": ["GL-7K2M"],
  "agents.licence.price": ["₹199.00"],
  "agents.actions.rotateOne": ["WhatsApp"], "agents.actions.rotateDone": ["4 Nov 2026, 10:15"],
};

const en: AgentWords = {
  heading: "Your own agents",
  intro: "Agents you wrote, behind the same Guards as the shops. Geometer does not run them: it checks every call they make to the shop's services.",
  open: "Open", title: (name) => `${name}: your own agent`, back: "All shops and agents",
  guards: {
    heading: "Its Guards", intro: "Each service your agent calls has a Guard in front of it, with a credential of its own.", desk: "UPI desk", ownGateway: "Your gateway",
    limits: (p, o) => `${p} of ${o} limits proven to bite on the running Guards`, limitsUnknown: "The limits have not been checked on the running Guards yet.",
    since: (d) => `credential since ${d}`, oldUntil: (t) => `the old credential still works until ${t}`,
    shared: "These Guards still share one credential, made before 12 Nov 2026. New credentials give each Guard its own.",
    file: (p) => `Your agent reads its credentials from ${p} on the server. The panel never shows a credential.`,
  },
  held: { heading: "Held for the owner", none: "Nothing is waiting for the owner.", some: (n) => (n === 1 ? "1 call is waiting for the owner's answer on WhatsApp." : `${n} calls are waiting for the owner's answer on WhatsApp.`), asOf: (w) => `As the Guards said at ${w}.`, unknown: "The Guards have not been asked yet." },
  unfinished: { heading: "Unfinished work", none: "Nothing is unfinished.", notShared: "Its record has not been shared yet, so its unfinished work cannot be listed." },
  crash: {
    heading: "Last crash test", never: "No crash test has run yet.", held: (h, o) => `Held ${h} of ${o}.`, failed: "Did not hold:", notRun: "Not run on these settings:",
    running: "A crash test is running. It takes a few minutes.", waiting: "A crash test is asked for. It starts when the server is free.",
    error: (why) => `The crash test could not run: ${why}`, when: (at, by) => `${at}, asked by ${by}.`, version: (v) => `Version ${v}.`,
  },
  goLive: { heading: "Go-live", none: "No version has a go-live certificate yet. `geometer agent go-live` makes one.", inService: (v, d) => `Version ${v} is in service: everything held in its crash test on ${d}.`, code: (c) => `Certificate ${c}.` },
  licence: { price: (p) => `Builder licence: ${p} a month for this live client business, before GST.` },
  actions: {
    heading: "What you can do here",
    stop: "Stop it (kill switch)", stopNote: "Its Guards let nothing new go out. Refunds already approved can still be finished. To start it again: geometer start <name> on the server.",
    stopAsked: "Stop asked. The server carries it out within a minute.", stopped: "It is stopped.",
    crashTest: "Run a new crash test", crashNote: "Starts your agent with its own command against stand-in services, behind its real Guards. Nothing real is sent or charged.",
    crashAsked: "Crash test asked. The result shows here when it is done.",
    rotate: "New credentials for every Guard", rotateOne: (g) => `New credential for ${g}`,
    rotateNote: "The old credential keeps working for 15 minutes, then stops. Your agent must read its credentials file again before then.",
    rotateAsked: "New credentials asked. The server makes them within a minute.", rotateDone: (t) => `New credentials made. The old ones stop at ${t}.`, rotateFailed: "The last request for new credentials was not done; nothing changed for your agent. The server's log says why.",
    cliOnly: "Removing an agent is done on the server only: geometer agent remove <name>.",
  },
};

const hi: AgentWords = {
  heading: "आपके अपने एजेंट",
  intro: "आपके लिखे एजेंट, दुकानों जैसे ही Guard के पीछे। Geometer इन्हें नहीं चलाता: दुकान की सेवाओं को किया गया इनका हर कॉल जाँचता है।",
  open: "खोलें", title: (name) => `${name}: आपका अपना एजेंट`, back: "सभी दुकानें और एजेंट",
  guards: {
    heading: "इसके Guard", intro: "आपका एजेंट जिस भी सेवा को कॉल करता है, उसके आगे एक Guard है, जिसका अपना क्रेडेंशियल है।", desk: "UPI डेस्क", ownGateway: "आपका गेटवे",
    limits: (p, o) => `चल रहे Guard पर ${o} में से ${p} सीमाएँ जाँची गईं`, limitsUnknown: "चल रहे Guard पर सीमाएँ अभी जाँची नहीं गईं।",
    since: (d) => `क्रेडेंशियल ${d} से`, oldUntil: (t) => `पुराना क्रेडेंशियल ${t} तक काम करता है`,
    shared: "ये Guard अभी भी एक ही क्रेडेंशियल बाँटते हैं, जो 12 नवंबर 2026 से पहले बना था। नए क्रेडेंशियल हर Guard को उसका अपना देते हैं।",
    file: (p) => `आपका एजेंट अपने क्रेडेंशियल सर्वर पर ${p} से पढ़ता है। पैनल कभी कोई क्रेडेंशियल नहीं दिखाता।`,
  },
  held: { heading: "मालिक के लिए रुके हुए", none: "मालिक के लिए कुछ भी रुका नहीं है।", some: (n) => (n === 1 ? "1 कॉल WhatsApp पर मालिक के जवाब का इंतज़ार कर रहा है।" : `${n} कॉल WhatsApp पर मालिक के जवाब का इंतज़ार कर रहे हैं।`), asOf: (w) => `${w} पर Guard के बताए अनुसार।`, unknown: "Guard से अभी पूछा नहीं गया है।" },
  unfinished: { heading: "अधूरा काम", none: "कुछ भी अधूरा नहीं है।", notShared: "इसका रिकॉर्ड अभी साझा नहीं हुआ है, इसलिए इसका अधूरा काम नहीं दिखाया जा सकता।" },
  crash: {
    heading: "पिछला क्रैश टेस्ट", never: "अभी तक कोई क्रैश टेस्ट नहीं चला।", held: (h, o) => `${o} में से ${h} सही रहे।`, failed: "जो सही नहीं रहे:", notRun: "इन सेटिंग पर नहीं चले:",
    running: "क्रैश टेस्ट चल रहा है। इसमें कुछ मिनट लगते हैं।", waiting: "क्रैश टेस्ट माँगा गया है। सर्वर खाली होते ही शुरू होगा।",
    error: (why) => `क्रैश टेस्ट नहीं चल सका: ${why}`, when: (at, by) => `${at}, माँगा: ${by}।`, version: (v) => `वर्ज़न ${v}।`,
  },
  goLive: { heading: "गो-लाइव", none: "अभी किसी वर्ज़न का गो-लाइव सर्टिफ़िकेट नहीं है। `geometer agent go-live` एक बनाता है।", inService: (v, d) => `वर्ज़न ${v} सेवा में है: ${d} के क्रैश टेस्ट में सब सही रहा।`, code: (c) => `सर्टिफ़िकेट ${c}।` },
  licence: { price: (p) => `बिल्डर लाइसेंस: इस लाइव क्लाइंट कारोबार के लिए ${p} महीना, GST से पहले।` },
  actions: {
    heading: "आप यहाँ क्या कर सकते हैं",
    stop: "इसे रोकें (किल स्विच)", stopNote: "इसके Guard कुछ भी नया बाहर नहीं जाने देते। पहले से मंज़ूर रिफंड अब भी पूरे हो सकते हैं। फिर से शुरू करने के लिए: सर्वर पर geometer start <name>।",
    stopAsked: "रोकने को कहा गया। सर्वर एक मिनट में इसे करता है।", stopped: "यह रुका हुआ है।",
    crashTest: "नया क्रैश टेस्ट चलाएँ", crashNote: "आपके एजेंट को उसके अपने कमांड से, उसके असली Guard के पीछे, नकली सेवाओं के साथ चलाता है। कुछ भी असली भेजा या चार्ज नहीं होता।",
    crashAsked: "क्रैश टेस्ट माँगा गया। पूरा होने पर नतीजा यहाँ दिखेगा।",
    rotate: "हर Guard के लिए नए क्रेडेंशियल", rotateOne: (g) => `${g} के लिए नया क्रेडेंशियल`,
    rotateNote: "पुराना क्रेडेंशियल 15 मिनट तक काम करता है, फिर बंद हो जाता है। उससे पहले आपके एजेंट को अपनी क्रेडेंशियल फ़ाइल फिर से पढ़नी होगी।",
    rotateAsked: "नए क्रेडेंशियल माँगे गए। सर्वर एक मिनट में बनाता है।", rotateDone: (t) => `नए क्रेडेंशियल बन गए। पुराने ${t} पर बंद होंगे।`, rotateFailed: "नए क्रेडेंशियल की पिछली माँग पूरी नहीं हुई; आपके एजेंट के लिए कुछ नहीं बदला। वजह सर्वर के लॉग में है।",
    cliOnly: "एजेंट हटाना सिर्फ़ सर्वर पर होता है: geometer agent remove <name>।",
  },
};

const ml: AgentWords = {
  heading: "നിങ്ങളുടെ സ്വന്തം ഏജന്റുകൾ",
  intro: "നിങ്ങൾ എഴുതിയ ഏജന്റുകൾ, കടകളുടേതുപോലെ അതേ Guard-കൾക്ക് പിന്നിൽ. Geometer ഇവയെ പ്രവർത്തിപ്പിക്കുന്നില്ല: കടയുടെ സേവനങ്ങളിലേക്ക് ഇവ നടത്തുന്ന ഓരോ കോളും പരിശോധിക്കുന്നു.",
  open: "തുറക്കുക", title: (name) => `${name}: നിങ്ങളുടെ സ്വന്തം ഏജന്റ്`, back: "എല്ലാ കടകളും ഏജന്റുകളും",
  guards: {
    heading: "ഇതിന്റെ Guard-കൾ", intro: "നിങ്ങളുടെ ഏജന്റ് വിളിക്കുന്ന ഓരോ സേവനത്തിനും മുന്നിൽ ഒരു Guard ഉണ്ട്, അതിന് സ്വന്തം ക്രെഡൻഷ്യലും.", desk: "UPI ഡെസ്ക്", ownGateway: "നിങ്ങളുടെ ഗേറ്റ്‌വേ",
    limits: (p, o) => `പ്രവർത്തിക്കുന്ന Guard-കളിൽ ${o}-ൽ ${p} പരിധികൾ പരിശോധിച്ചു`, limitsUnknown: "പ്രവർത്തിക്കുന്ന Guard-കളിൽ പരിധികൾ ഇതുവരെ പരിശോധിച്ചിട്ടില്ല.",
    since: (d) => `${d} മുതലുള്ള ക്രെഡൻഷ്യൽ`, oldUntil: (t) => `പഴയ ക്രെഡൻഷ്യൽ ${t} വരെ പ്രവർത്തിക്കും`,
    shared: "ഈ Guard-കൾ ഇപ്പോഴും 12 നവംബർ 2026-ന് മുമ്പ് ഉണ്ടാക്കിയ ഒരേ ക്രെഡൻഷ്യൽ പങ്കിടുന്നു. പുതിയ ക്രെഡൻഷ്യലുകൾ ഓരോ Guard-നും സ്വന്തമായത് നൽകും.",
    file: (p) => `നിങ്ങളുടെ ഏജന്റ് സെർവറിലെ ${p}-ൽ നിന്നാണ് ക്രെഡൻഷ്യലുകൾ വായിക്കുന്നത്. പാനൽ ഒരിക്കലും ക്രെഡൻഷ്യൽ കാണിക്കില്ല.`,
  },
  held: { heading: "ഉടമയ്ക്കായി നിർത്തിവച്ചവ", none: "ഉടമയ്ക്കായി ഒന്നും കാത്തിരിക്കുന്നില്ല.", some: (n) => (n === 1 ? "1 കോൾ WhatsApp-ൽ ഉടമയുടെ മറുപടിക്കായി കാത്തിരിക്കുന്നു." : `${n} കോളുകൾ WhatsApp-ൽ ഉടമയുടെ മറുപടിക്കായി കാത്തിരിക്കുന്നു.`), asOf: (w) => `${w}-ന് Guard-കൾ പറഞ്ഞതുപോലെ.`, unknown: "Guard-കളോട് ഇതുവരെ ചോദിച്ചിട്ടില്ല." },
  unfinished: { heading: "തീരാത്ത ജോലി", none: "ഒന്നും ബാക്കിയില്ല.", notShared: "ഇതിന്റെ രേഖ ഇതുവരെ പങ്കിട്ടിട്ടില്ല, അതിനാൽ തീരാത്ത ജോലി കാണിക്കാൻ കഴിയില്ല." },
  crash: {
    heading: "കഴിഞ്ഞ ക്രാഷ് ടെസ്റ്റ്", never: "ഇതുവരെ ക്രാഷ് ടെസ്റ്റ് നടന്നിട്ടില്ല.", held: (h, o) => `${o}-ൽ ${h} പിടിച്ചുനിന്നു.`, failed: "പിടിച്ചുനിൽക്കാത്തവ:", notRun: "ഈ ക്രമീകരണങ്ങളിൽ നടത്താത്തവ:",
    running: "ക്രാഷ് ടെസ്റ്റ് നടക്കുന്നു. കുറച്ച് മിനിറ്റ് എടുക്കും.", waiting: "ക്രാഷ് ടെസ്റ്റ് ആവശ്യപ്പെട്ടു. സെർവർ ഒഴിവാകുമ്പോൾ തുടങ്ങും.",
    error: (why) => `ക്രാഷ് ടെസ്റ്റ് നടത്താനായില്ല: ${why}`, when: (at, by) => `${at}, ആവശ്യപ്പെട്ടത്: ${by}.`, version: (v) => `പതിപ്പ് ${v}.`,
  },
  goLive: { heading: "ഗോ-ലൈവ്", none: "ഒരു പതിപ്പിനും ഇതുവരെ ഗോ-ലൈവ് സർട്ടിഫിക്കറ്റ് ഇല്ല. `geometer agent go-live` ഒന്ന് ഉണ്ടാക്കും.", inService: (v, d) => `പതിപ്പ് ${v} സേവനത്തിലാണ്: ${d}-ലെ ക്രാഷ് ടെസ്റ്റിൽ എല്ലാം പിടിച്ചുനിന്നു.`, code: (c) => `സർട്ടിഫിക്കറ്റ് ${c}.` },
  licence: { price: (p) => `ബിൽഡർ ലൈസൻസ്: ഈ ലൈവ് ക്ലയന്റ് ബിസിനസിന് മാസം ${p}, GST-ക്ക് മുമ്പ്.` },
  actions: {
    heading: "നിങ്ങൾക്ക് ഇവിടെ ചെയ്യാവുന്നത്",
    stop: "നിർത്തുക (കിൽ സ്വിച്ച്)", stopNote: "ഇതിന്റെ Guard-കൾ പുതിയതൊന്നും പുറത്തുവിടില്ല. ഇതിനകം അംഗീകരിച്ച റീഫണ്ടുകൾ ഇപ്പോഴും പൂർത്തിയാക്കാം. വീണ്ടും തുടങ്ങാൻ: സെർവറിൽ geometer start <name>.",
    stopAsked: "നിർത്താൻ ആവശ്യപ്പെട്ടു. സെർവർ ഒരു മിനിറ്റിനുള്ളിൽ ചെയ്യും.", stopped: "ഇത് നിർത്തിയിരിക്കുന്നു.",
    crashTest: "പുതിയ ക്രാഷ് ടെസ്റ്റ് നടത്തുക", crashNote: "നിങ്ങളുടെ ഏജന്റിനെ അതിന്റെ സ്വന്തം കമാൻഡ് ഉപയോഗിച്ച്, യഥാർത്ഥ Guard-കൾക്ക് പിന്നിൽ, പകരക്കാരൻ സേവനങ്ങളോടൊപ്പം തുടങ്ങുന്നു. യഥാർത്ഥമായി ഒന്നും അയയ്ക്കുകയോ ഈടാക്കുകയോ ഇല്ല.",
    crashAsked: "ക്രാഷ് ടെസ്റ്റ് ആവശ്യപ്പെട്ടു. പൂർത്തിയാകുമ്പോൾ ഫലം ഇവിടെ കാണാം.",
    rotate: "എല്ലാ Guard-നും പുതിയ ക്രെഡൻഷ്യലുകൾ", rotateOne: (g) => `${g}-ന് പുതിയ ക്രെഡൻഷ്യൽ`,
    rotateNote: "പഴയ ക്രെഡൻഷ്യൽ 15 മിനിറ്റ് കൂടി പ്രവർത്തിക്കും, പിന്നെ നിൽക്കും. അതിനുമുമ്പ് നിങ്ങളുടെ ഏജന്റ് ക്രെഡൻഷ്യൽ ഫയൽ വീണ്ടും വായിക്കണം.",
    rotateAsked: "പുതിയ ക്രെഡൻഷ്യലുകൾ ആവശ്യപ്പെട്ടു. സെർവർ ഒരു മിനിറ്റിനുള്ളിൽ ഉണ്ടാക്കും.", rotateDone: (t) => `പുതിയ ക്രെഡൻഷ്യലുകൾ ഉണ്ടാക്കി. പഴയവ ${t}-ന് നിൽക്കും.`, rotateFailed: "പുതിയ ക്രെഡൻഷ്യലുകൾക്കുള്ള കഴിഞ്ഞ ആവശ്യം നടന്നില്ല; നിങ്ങളുടെ ഏജന്റിന് ഒന്നും മാറിയില്ല. കാരണം സെർവറിന്റെ ലോഗിൽ ഉണ്ട്.",
    cliOnly: "ഏജന്റിനെ നീക്കം ചെയ്യുന്നത് സെർവറിൽ മാത്രം: geometer agent remove <name>.",
  },
};

const kn: AgentWords = {
  heading: "ನಿಮ್ಮ ಸ್ವಂತ ಏಜೆಂಟ್‌ಗಳು",
  intro: "ನೀವು ಬರೆದ ಏಜೆಂಟ್‌ಗಳು, ಅಂಗಡಿಗಳಂತೆಯೇ ಅದೇ Guard-ಗಳ ಹಿಂದೆ. Geometer ಇವುಗಳನ್ನು ನಡೆಸುವುದಿಲ್ಲ: ಅಂಗಡಿಯ ಸೇವೆಗಳಿಗೆ ಇವು ಮಾಡುವ ಪ್ರತಿ ಕರೆಯನ್ನೂ ಪರಿಶೀಲಿಸುತ್ತದೆ.",
  open: "ತೆರೆಯಿರಿ", title: (name) => `${name}: ನಿಮ್ಮ ಸ್ವಂತ ಏಜೆಂಟ್`, back: "ಎಲ್ಲಾ ಅಂಗಡಿಗಳು ಮತ್ತು ಏಜೆಂಟ್‌ಗಳು",
  guards: {
    heading: "ಇದರ Guard-ಗಳು", intro: "ನಿಮ್ಮ ಏಜೆಂಟ್ ಕರೆಯುವ ಪ್ರತಿ ಸೇವೆಯ ಮುಂದೆ ಒಂದು Guard ಇದೆ, ಅದಕ್ಕೆ ತನ್ನದೇ ಕ್ರೆಡೆನ್ಶಿಯಲ್ ಇದೆ.", desk: "UPI ಡೆಸ್ಕ್", ownGateway: "ನಿಮ್ಮ ಗೇಟ್‌ವೇ",
    limits: (p, o) => `ನಡೆಯುತ್ತಿರುವ Guard-ಗಳಲ್ಲಿ ${o} ರಲ್ಲಿ ${p} ಮಿತಿಗಳನ್ನು ಪರೀಕ್ಷಿಸಲಾಗಿದೆ`, limitsUnknown: "ನಡೆಯುತ್ತಿರುವ Guard-ಗಳಲ್ಲಿ ಮಿತಿಗಳನ್ನು ಇನ್ನೂ ಪರೀಕ್ಷಿಸಿಲ್ಲ.",
    since: (d) => `${d} ರಿಂದ ಕ್ರೆಡೆನ್ಶಿಯಲ್`, oldUntil: (t) => `ಹಳೆಯ ಕ್ರೆಡೆನ್ಶಿಯಲ್ ${t} ರವರೆಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ`,
    shared: "ಈ Guard-ಗಳು ಇನ್ನೂ 12 ನವೆಂಬರ್ 2026 ರ ಮೊದಲು ಮಾಡಿದ ಒಂದೇ ಕ್ರೆಡೆನ್ಶಿಯಲ್ ಹಂಚಿಕೊಳ್ಳುತ್ತವೆ. ಹೊಸ ಕ್ರೆಡೆನ್ಶಿಯಲ್‌ಗಳು ಪ್ರತಿ Guard-ಗೆ ತನ್ನದೇ ಒಂದನ್ನು ಕೊಡುತ್ತವೆ.",
    file: (p) => `ನಿಮ್ಮ ಏಜೆಂಟ್ ಸರ್ವರ್‌ನಲ್ಲಿರುವ ${p} ನಿಂದ ತನ್ನ ಕ್ರೆಡೆನ್ಶಿಯಲ್‌ಗಳನ್ನು ಓದುತ್ತದೆ. ಪ್ಯಾನೆಲ್ ಯಾವತ್ತೂ ಕ್ರೆಡೆನ್ಶಿಯಲ್ ತೋರಿಸುವುದಿಲ್ಲ.`,
  },
  held: { heading: "ಮಾಲೀಕರಿಗಾಗಿ ತಡೆಹಿಡಿದವು", none: "ಮಾಲೀಕರಿಗಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ.", some: (n) => (n === 1 ? "1 ಕರೆ WhatsApp ನಲ್ಲಿ ಮಾಲೀಕರ ಉತ್ತರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿದೆ." : `${n} ಕರೆಗಳು WhatsApp ನಲ್ಲಿ ಮಾಲೀಕರ ಉತ್ತರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿವೆ.`), asOf: (w) => `${w} ರಂದು Guard-ಗಳು ಹೇಳಿದಂತೆ.`, unknown: "Guard-ಗಳನ್ನು ಇನ್ನೂ ಕೇಳಿಲ್ಲ." },
  unfinished: { heading: "ಮುಗಿಯದ ಕೆಲಸ", none: "ಏನೂ ಬಾಕಿ ಇಲ್ಲ.", notShared: "ಇದರ ದಾಖಲೆ ಇನ್ನೂ ಹಂಚಿಕೊಂಡಿಲ್ಲ, ಆದ್ದರಿಂದ ಮುಗಿಯದ ಕೆಲಸವನ್ನು ತೋರಿಸಲು ಆಗುವುದಿಲ್ಲ." },
  crash: {
    heading: "ಹಿಂದಿನ ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್", never: "ಇನ್ನೂ ಯಾವುದೇ ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್ ನಡೆದಿಲ್ಲ.", held: (h, o) => `${o} ರಲ್ಲಿ ${h} ಸರಿಯಾಗಿ ನಿಂತವು.`, failed: "ಸರಿಯಾಗಿ ನಿಲ್ಲದವು:", notRun: "ಈ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ನಡೆಸದವು:",
    running: "ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್ ನಡೆಯುತ್ತಿದೆ. ಕೆಲವು ನಿಮಿಷ ಬೇಕು.", waiting: "ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್ ಕೇಳಲಾಗಿದೆ. ಸರ್ವರ್ ಬಿಡುವಾದಾಗ ಶುರುವಾಗುತ್ತದೆ.",
    error: (why) => `ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್ ನಡೆಸಲು ಆಗಲಿಲ್ಲ: ${why}`, when: (at, by) => `${at}, ಕೇಳಿದವರು: ${by}.`, version: (v) => `ಆವೃತ್ತಿ ${v}.`,
  },
  goLive: { heading: "ಗೋ-ಲೈವ್", none: "ಇನ್ನೂ ಯಾವ ಆವೃತ್ತಿಗೂ ಗೋ-ಲೈವ್ ಪ್ರಮಾಣಪತ್ರ ಇಲ್ಲ. `geometer agent go-live` ಒಂದನ್ನು ಮಾಡುತ್ತದೆ.", inService: (v, d) => `ಆವೃತ್ತಿ ${v} ಸೇವೆಯಲ್ಲಿದೆ: ${d} ರ ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್‌ನಲ್ಲಿ ಎಲ್ಲವೂ ಸರಿಯಾಗಿ ನಿಂತವು.`, code: (c) => `ಪ್ರಮಾಣಪತ್ರ ${c}.` },
  licence: { price: (p) => `ಬಿಲ್ಡರ್ ಲೈಸೆನ್ಸ್: ಈ ಲೈವ್ ಕ್ಲೈಂಟ್ ವ್ಯವಹಾರಕ್ಕೆ ತಿಂಗಳಿಗೆ ${p}, GST ಮೊದಲು.` },
  actions: {
    heading: "ನೀವು ಇಲ್ಲಿ ಮಾಡಬಹುದಾದದ್ದು",
    stop: "ನಿಲ್ಲಿಸಿ (ಕಿಲ್ ಸ್ವಿಚ್)", stopNote: "ಇದರ Guard-ಗಳು ಹೊಸದೇನೂ ಹೊರಗೆ ಹೋಗಲು ಬಿಡುವುದಿಲ್ಲ. ಈಗಾಗಲೇ ಒಪ್ಪಿದ ರೀಫಂಡ್‌ಗಳನ್ನು ಇನ್ನೂ ಮುಗಿಸಬಹುದು. ಮತ್ತೆ ಶುರು ಮಾಡಲು: ಸರ್ವರ್‌ನಲ್ಲಿ geometer start <name>.",
    stopAsked: "ನಿಲ್ಲಿಸಲು ಕೇಳಲಾಗಿದೆ. ಸರ್ವರ್ ಒಂದು ನಿಮಿಷದಲ್ಲಿ ಮಾಡುತ್ತದೆ.", stopped: "ಇದನ್ನು ನಿಲ್ಲಿಸಲಾಗಿದೆ.",
    crashTest: "ಹೊಸ ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್ ನಡೆಸಿ", crashNote: "ನಿಮ್ಮ ಏಜೆಂಟ್ ಅನ್ನು ಅದರ ಸ್ವಂತ ಆಜ್ಞೆಯಿಂದ, ಅದರ ನಿಜವಾದ Guard-ಗಳ ಹಿಂದೆ, ಬದಲಿ ಸೇವೆಗಳ ಜೊತೆ ಶುರು ಮಾಡುತ್ತದೆ. ನಿಜವಾಗಿ ಏನನ್ನೂ ಕಳಿಸುವುದಿಲ್ಲ ಅಥವಾ ಶುಲ್ಕ ವಿಧಿಸುವುದಿಲ್ಲ.",
    crashAsked: "ಕ್ರ್ಯಾಶ್ ಟೆಸ್ಟ್ ಕೇಳಲಾಗಿದೆ. ಮುಗಿದಾಗ ಫಲಿತಾಂಶ ಇಲ್ಲಿ ಕಾಣುತ್ತದೆ.",
    rotate: "ಪ್ರತಿ Guard-ಗೆ ಹೊಸ ಕ್ರೆಡೆನ್ಶಿಯಲ್‌ಗಳು", rotateOne: (g) => `${g} ಗೆ ಹೊಸ ಕ್ರೆಡೆನ್ಶಿಯಲ್`,
    rotateNote: "ಹಳೆಯ ಕ್ರೆಡೆನ್ಶಿಯಲ್ 15 ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ, ನಂತರ ನಿಲ್ಲುತ್ತದೆ. ಅದಕ್ಕೂ ಮೊದಲು ನಿಮ್ಮ ಏಜೆಂಟ್ ತನ್ನ ಕ್ರೆಡೆನ್ಶಿಯಲ್ ಫೈಲ್ ಅನ್ನು ಮತ್ತೆ ಓದಬೇಕು.",
    rotateAsked: "ಹೊಸ ಕ್ರೆಡೆನ್ಶಿಯಲ್‌ಗಳನ್ನು ಕೇಳಲಾಗಿದೆ. ಸರ್ವರ್ ಒಂದು ನಿಮಿಷದಲ್ಲಿ ಮಾಡುತ್ತದೆ.", rotateDone: (t) => `ಹೊಸ ಕ್ರೆಡೆನ್ಶಿಯಲ್‌ಗಳು ಸಿದ್ಧ. ಹಳೆಯವು ${t} ಕ್ಕೆ ನಿಲ್ಲುತ್ತವೆ.`, rotateFailed: "ಹೊಸ ಕ್ರೆಡೆನ್ಶಿಯಲ್‌ಗಳ ಹಿಂದಿನ ವಿನಂತಿ ಆಗಲಿಲ್ಲ; ನಿಮ್ಮ ಏಜೆಂಟ್‌ಗೆ ಏನೂ ಬದಲಾಗಲಿಲ್ಲ. ಕಾರಣ ಸರ್ವರ್‌ನ ಲಾಗ್‌ನಲ್ಲಿದೆ.",
    cliOnly: "ಏಜೆಂಟ್ ಅನ್ನು ತೆಗೆದುಹಾಕುವುದು ಸರ್ವರ್‌ನಲ್ಲಿ ಮಾತ್ರ: geometer agent remove <name>.",
  },
};

export const AGENT_WORDS: Record<Language, AgentWords> = { en, hi, ml, kn };
