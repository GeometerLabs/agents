// Item 11f on the panel's shop page: "The shop's page" (the short name on the pages domain, where it stands at fleet, its stable address and the WhatsApp number the
// page shows), the builder's choice between the pages domain and their own domain, and "sign out every device" for the owner's sessions. Plain forms, no script.
// Item 11h (decisions 45 and 46): "The owner's sign-in": the setup QR code the Operator shows at the setup visit (the owner registers a passkey with it), the printed
// recovery card, and "remove the owner's passkeys" for a lost phone. The QR and the codes are shown once (only their hashes are kept: bundle/lib/pages.ts).
// Used by views.ts (the shop page) and server.ts (the two routes that write lib/pages.ts's files). The words are in four languages; Hindi, Malayalam and Kannada are
// machine-written and wait for a native reader, like the rest of the panel's.
import type { Language } from "../../modules/language/languages.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import type { Ctx } from "./views.ts";
import { layout } from "./views.ts";
import { textQrSvg } from "../../modules/qr/svg.ts";
import { printedCode } from "../../modules/channels/owner-grants.ts";
import type { PageSettings, PageStatus } from "../lib/pages.ts";

/** What the block shows: the choice, what came of it at fleet, and whether this panel may choose "own" (a builder's server) or always "hub" (Geometer's). */
export interface PagesView { settings: PageSettings; status?: PageStatus; canChoose: boolean; /** Item 11h: when the last QR and card were made, and passkeys removed. */ grants?: { setupAt?: string; recoveryAt?: string; removedAt?: string; resetAt?: string; resetReason?: string }; /** Owner's item 2: what the shop's runtime says (from /status): the owner holds a passkey (so the QR and the card are closed), and the Operator's pending request. */ access?: { locked: boolean; removal?: { askedBy: string; effectiveAt: string } } }

interface Words {
  heading: string; note: string; choice: string; hub: string; own: string; slug: string; slugNote: string; whatsapp: string; whatsappNote: string; save: string;
  live: (url: string) => string; stable: string; stableNote: string; waiting: string; problem: (m: string) => string; ownNote: string;
  sessions: string; sessionsNote: string; endAll: string; ended: string; bad: string;
  signin: string; signinNote: string; setupMake: string; recoveryMake: string; recoveryOn: (day: string) => string; remove: string; removeNote: string; removed: string;
  setupTitle: string; setupNote: (until: string) => string; cardTitle: string; cardNote: string; cardOwner: (url: string) => string; printNote: string; back: string;
  /** Batch 3 and 5: the shop's phone and map, the Operator's name and number (what the owner's app and the error pages show), and the QR page's "wait until green". */
  shopPhone: string; shopPhoneNote: string; map: string; mapNote: string; partnerName: string; partnerPhone: string; partnerNote: string;
  setupWait: string; setupReady: string; setupWaitNote: string; cardQr: string; cardMachine: string;
  /**
   * Owner's item 2 ("no Operator holds a shop hostage"): once the owner holds a passkey the runtime closes the setup QR and the card and makes "remove the passkeys" a
   * request with a wait. The panel only SHOWS that (the runtime decides whatever this page does).
   */
  locked: string; askRemove: string; askRemoveNote: string; requested: string; pending: (by: string, when: string) => string; resetLine: (day: string, reason: string) => string; lockedNotice: string;
}
/** Exported so the native reviewer's sheet lists these lines too (review.ts, ids "pages.block.*"). */
export const WORDS: Record<Language, Words> = {
  en: {
    heading: "The shop's page", note: "Customers book, pay and message the shop here; the owner signs in with a link sent to their WhatsApp. One short name per shop.",
    choice: "Where the page is", hub: "On the shared pages domain (a short name)", own: "On your own domain only", slug: "Short name", slugNote: "3 to 40 small letters, digits and hyphens, like veena-salon. A name another shop holds, or one used lately, cannot be taken.",
    whatsapp: "The shop's WhatsApp number on the page", whatsappNote: "+91 and ten digits. The page links to it (\"message us on WhatsApp\"), and the owner sends \"open my app\" to it.", save: "Save",
    live: (url) => `Live at ${url}`, stable: "Address for QR codes and print", stableNote: "It never changes, even if the short name or the domain changes. Use it on anything printed.",
    waiting: "Being claimed: the server asks within a minute.", problem: (m) => `Not taken: ${m}`, ownNote: "The page is at this server's own address only.",
    sessions: "The owner's signed-in devices", sessionsNote: "The owner signs in with their fingerprint (a passkey) or a link on WhatsApp; each device stays signed in for 30 days. If a phone is lost or the owner asks, sign every device out.", endAll: "Sign out every device", ended: "Every device is signed out.", bad: "Check the short name (3 to 40 small letters, digits and hyphens) and the number (+91 and ten digits): nothing was saved.",
    signin: "The owner's sign-in", signinNote: "The owner signs in with their phone's fingerprint or screen lock. At the setup visit, show the setup QR code: the owner scans it and touches the fingerprint reader. Then print a recovery card for them.",
    setupMake: "Show the setup QR code", recoveryMake: "Print a recovery card", recoveryOn: (day) => `Recovery card made ${day}.`,
    remove: "Remove the owner's passkeys", removeNote: "For a lost or stolen phone: every passkey stops working, and so do the QR code and the card. Then show a new setup QR code.", removed: "The owner's passkeys are removed. Show a new setup QR code when you meet the owner.",
    setupTitle: "Setup QR code for the owner", setupNote: (until) => `Works once, for this shop only, until ${until}. The owner scans it with their phone's camera, then touches the fingerprint reader. Showing a new code stops this one.`,
    cardTitle: "Recovery card", cardNote: "Print this page and give it to the owner. Each code works once. Nobody can see these codes again, not even here.", cardOwner: (url) => `Lost your phone? Open ${url} and type one code.`,
    printNote: "Use your browser's Print.", back: "Back to the shop",
    locked: "The owner now holds their own sign-in. A new phone is added from the owner's app, or with the owner's recovery codes.", askRemove: "Ask to remove the owner's passkeys", askRemoveNote: "For an owner who lost every phone and has no codes. The owner is told at once and can cancel; if they do not, it happens after 48 hours, and only then can you show a new setup QR code.",
    requested: "Asked. The owner sees it in their app now. If they do not cancel, it happens in 48 hours.", pending: (by, when) => `${by} asked to remove the owner's passkeys. It happens on ${when} unless the owner cancels.`, resetLine: (day, reason) => `Geometer reset the owner's sign-in on ${day}: ${reason}`, lockedNotice: "The owner now holds their own sign-in. A new phone is added from the owner's app, or with the owner's recovery codes.",
    shopPhone: "The shop's phone number on the page", shopPhoneNote: "With the country code, like +918012345678. The page shows \"Call the shop\". A landline works too.",
    map: "Map link", mapNote: "Paste the shop's link from Google Maps (Share, then Copy link). The page shows \"Find us on the map\".",
    partnerName: "Your name, for the owner", partnerPhone: "Your phone number, for the owner", partnerNote: "The owner's app and every error page show your name with Call and WhatsApp buttons. Fill in both, or neither.",
    setupWait: "Wait...", setupReady: "Ready: scan now", setupWaitNote: "The code starts working about 15 seconds after it is shown. Wait until the bar below turns green, then scan. A scan before that does not work yet.",
    cardQr: "Or scan this with your phone's camera:", cardMachine: "",
  },
  hi: {
    heading: "दुकान का पेज", note: "ग्राहक यहाँ बुक करते हैं, भुगतान करते हैं और दुकान को मैसेज करते हैं; मालिक अपने WhatsApp पर आए लिंक से साइन इन करते हैं। हर दुकान का एक छोटा नाम।",
    choice: "पेज कहाँ है", hub: "साझा पेज डोमेन पर (छोटा नाम)", own: "सिर्फ़ आपके अपने डोमेन पर", slug: "छोटा नाम", slugNote: "3 से 40 छोटे अक्षर, अंक और हाइफ़न, जैसे veena-salon। किसी और दुकान का नाम, या हाल में इस्तेमाल हुआ नाम, नहीं लिया जा सकता।",
    whatsapp: "पेज पर दुकान का WhatsApp नंबर", whatsappNote: "+91 और दस अंक। पेज इससे जुड़ता है (\"WhatsApp पर हमें मैसेज करें\"), और मालिक इसी पर \"open my app\" भेजते हैं।", save: "सहेजें",
    live: (url) => `चालू: ${url}`, stable: "QR कोड और छपाई का पता", stableNote: "यह कभी नहीं बदलता, छोटा नाम या डोमेन बदलने पर भी नहीं। छपी हुई हर चीज़ पर यही लगाएँ।",
    waiting: "लिया जा रहा है: सर्वर एक मिनट में पूछेगा।", problem: (m) => `नहीं लिया गया: ${m}`, ownNote: "पेज सिर्फ़ इस सर्वर के अपने पते पर है।",
    sessions: "मालिक के साइन-इन किए डिवाइस", sessionsNote: "मालिक अपने फ़िंगरप्रिंट (पासकी) से या WhatsApp पर आए लिंक से साइन इन करते हैं; हर डिवाइस 30 दिन साइन इन रहता है। फ़ोन खो जाए या मालिक कहें, तो सब डिवाइस साइन आउट कर दें।", endAll: "सब डिवाइस साइन आउट करें", ended: "सब डिवाइस साइन आउट हो गए।", bad: "छोटा नाम (3 से 40 छोटे अक्षर, अंक और हाइफ़न) और नंबर (+91 और दस अंक) जाँचिए: कुछ सहेजा नहीं गया।",
    signin: "मालिक का साइन-इन", signinNote: "मालिक अपने फ़ोन के फ़िंगरप्रिंट या स्क्रीन लॉक से साइन इन करते हैं। सेटअप के समय सेटअप QR कोड दिखाइए: मालिक उसे स्कैन करके फ़िंगरप्रिंट छूते हैं। फिर उनके लिए रिकवरी कार्ड छापिए।",
    setupMake: "सेटअप QR कोड दिखाएँ", recoveryMake: "रिकवरी कार्ड छापें", recoveryOn: (day) => `रिकवरी कार्ड ${day} को बना।`,
    remove: "मालिक की पासकी हटाएँ", removeNote: "फ़ोन खो जाए या चोरी हो जाए तो: हर पासकी काम करना बंद कर देगी, QR कोड और कार्ड भी। फिर नया सेटअप QR कोड दिखाइए।", removed: "मालिक की पासकी हटा दी गईं। मालिक से मिलने पर नया सेटअप QR कोड दिखाइए।",
    setupTitle: "मालिक के लिए सेटअप QR कोड", setupNote: (until) => `एक बार, सिर्फ़ इसी दुकान के लिए, ${until} तक चलेगा। मालिक इसे फ़ोन के कैमरे से स्कैन करें, फिर फ़िंगरप्रिंट छुएँ। नया कोड दिखाने पर यह बंद हो जाता है।`,
    cardTitle: "रिकवरी कार्ड", cardNote: "यह पेज छापकर मालिक को दीजिए। हर कोड एक बार चलता है। ये कोड फिर कोई नहीं देख सकता, यहाँ भी नहीं।", cardOwner: (url) => `फ़ोन खो गया? ${url} खोलिए और एक कोड लिखिए।`,
    printNote: "ब्राउज़र का Print इस्तेमाल करें।", back: "दुकान पर वापस",
    locked: "अब मालिक के पास अपना साइन-इन है। नया फ़ोन मालिक के ऐप से, या मालिक के रिकवरी कोड से जुड़ता है।", askRemove: "मालिक की पासकी हटाने का अनुरोध करें", askRemoveNote: "ऐसे मालिक के लिए जिसके सारे फ़ोन खो गए और जिसके पास कोड नहीं हैं। मालिक को तुरंत बताया जाता है और वे रद्द कर सकते हैं; न करें तो 48 घंटे बाद यह होता है, और तभी आप नया सेटअप QR कोड दिखा सकते हैं।",
    requested: "अनुरोध हो गया। मालिक को अपने ऐप में अभी दिखेगा। वे रद्द न करें तो 48 घंटे में हो जाएगा।", pending: (by, when) => `${by} ने मालिक की पासकी हटाने को कहा है। मालिक रद्द न करें तो यह ${when} को होगा।`, resetLine: (day, reason) => `Geometer ने ${day} को मालिक का साइन-इन रीसेट किया: ${reason}`, lockedNotice: "अब मालिक के पास अपना साइन-इन है। नया फ़ोन मालिक के ऐप से, या मालिक के रिकवरी कोड से जुड़ता है।",
    shopPhone: "पेज पर दुकान का फ़ोन नंबर", shopPhoneNote: "देश कोड के साथ, जैसे +918012345678। पेज पर \"दुकान को कॉल करें\" दिखेगा। लैंडलाइन भी चलता है।",
    map: "मैप लिंक", mapNote: "दुकान का Google Maps लिंक चिपकाइए (Share, फिर Copy link)। पेज पर \"नक्शे पर देखें\" दिखेगा।",
    partnerName: "आपका नाम, मालिक के लिए", partnerPhone: "आपका फ़ोन नंबर, मालिक के लिए", partnerNote: "मालिक के ऐप और हर एरर पेज पर आपका नाम, कॉल और WhatsApp बटन के साथ दिखेगा। दोनों भरिए, या कोई नहीं।",
    setupWait: "रुकिए...", setupReady: "तैयार: अब स्कैन करें", setupWaitNote: "कोड दिखने के करीब 15 सेकंड बाद चलने लगता है। नीचे की पट्टी हरी होने तक रुकिए, फिर स्कैन करें। उससे पहले स्कैन करने पर यह अभी नहीं चलता।",
    cardQr: "या फ़ोन के कैमरे से यह स्कैन करें:", cardMachine: "यह हिंदी मशीन से लिखी गई है; किसी हिंदी भाषी ने अभी इसे जाँचा नहीं है।",
  },
  ml: {
    heading: "കടയുടെ പേജ്", note: "കസ്റ്റമർമാർ ഇവിടെ ബുക്ക് ചെയ്യുകയും പണമടയ്ക്കുകയും കടയ്ക്ക് സന്ദേശം അയയ്ക്കുകയും ചെയ്യുന്നു; ഉടമ WhatsApp-ൽ വരുന്ന ലിങ്ക് വഴി സൈൻ ഇൻ ചെയ്യുന്നു. ഓരോ കടയ്ക്കും ഒരു ചെറിയ പേര്.",
    choice: "പേജ് എവിടെ", hub: "പങ്കിട്ട പേജ് ഡൊമെയ്‌നിൽ (ചെറിയ പേര്)", own: "നിങ്ങളുടെ സ്വന്തം ഡൊമെയ്‌നിൽ മാത്രം", slug: "ചെറിയ പേര്", slugNote: "3 മുതൽ 40 വരെ ചെറിയ അക്ഷരങ്ങൾ, അക്കങ്ങൾ, ഹൈഫൻ, ഉദാ. veena-salon. മറ്റൊരു കടയുടെ പേരോ അടുത്തിടെ ഉപയോഗിച്ച പേരോ എടുക്കാനാവില്ല.",
    whatsapp: "പേജിലെ കടയുടെ WhatsApp നമ്പർ", whatsappNote: "+91-ഉം പത്ത് അക്കങ്ങളും. പേജ് ഇതിലേക്ക് ലിങ്ക് ചെയ്യും, ഉടമ ഇതിലേക്ക് \"open my app\" അയയ്ക്കും.", save: "സേവ് ചെയ്യൂ",
    live: (url) => `ലൈവ്: ${url}`, stable: "QR കോഡിനും അച്ചടിക്കും ഉള്ള വിലാസം", stableNote: "ചെറിയ പേരോ ഡൊമെയ്‌നോ മാറിയാലും ഇത് മാറില്ല. അച്ചടിക്കുന്ന എല്ലാറ്റിലും ഇത് ഉപയോഗിക്കൂ.",
    waiting: "എടുക്കുന്നു: സെർവർ ഒരു മിനിറ്റിനുള്ളിൽ ചോദിക്കും.", problem: (m) => `എടുത്തില്ല: ${m}`, ownNote: "പേജ് ഈ സെർവറിന്റെ സ്വന്തം വിലാസത്തിൽ മാത്രം.",
    sessions: "ഉടമ സൈൻ ഇൻ ചെയ്ത ഉപകരണങ്ങൾ", sessionsNote: "ഉടമ വിരലടയാളം (പാസ്‌കീ) കൊണ്ടോ WhatsApp-ൽ വരുന്ന ലിങ്ക് വഴിയോ സൈൻ ഇൻ ചെയ്യുന്നു; ഓരോ ഉപകരണവും 30 ദിവസം സൈൻ ഇൻ ആയിരിക്കും. ഫോൺ നഷ്ടപ്പെട്ടാലോ ഉടമ ആവശ്യപ്പെട്ടാലോ എല്ലാം സൈൻ ഔട്ട് ചെയ്യൂ.", endAll: "എല്ലാ ഉപകരണങ്ങളും സൈൻ ഔട്ട് ചെയ്യൂ", ended: "എല്ലാ ഉപകരണങ്ങളും സൈൻ ഔട്ട് ചെയ്തു.", bad: "ചെറിയ പേരും (3 മുതൽ 40 വരെ ചെറിയ അക്ഷരങ്ങൾ, അക്കങ്ങൾ, ഹൈഫൻ) നമ്പറും (+91-ഉം പത്ത് അക്കങ്ങളും) പരിശോധിക്കൂ: ഒന്നും സേവ് ചെയ്തില്ല.",
    signin: "ഉടമയുടെ സൈൻ ഇൻ", signinNote: "ഉടമ ഫോണിലെ വിരലടയാളമോ സ്ക്രീൻ ലോക്കോ കൊണ്ട് സൈൻ ഇൻ ചെയ്യുന്നു. സെറ്റപ്പ് സമയത്ത് സെറ്റപ്പ് QR കോഡ് കാണിക്കൂ: ഉടമ അത് സ്കാൻ ചെയ്ത് വിരലടയാളം തൊടും. പിന്നെ അവർക്കായി ഒരു റിക്കവറി കാർഡ് പ്രിന്റ് ചെയ്യൂ.",
    setupMake: "സെറ്റപ്പ് QR കോഡ് കാണിക്കൂ", recoveryMake: "റിക്കവറി കാർഡ് പ്രിന്റ് ചെയ്യൂ", recoveryOn: (day) => `റിക്കവറി കാർഡ് ഉണ്ടാക്കിയത് ${day}.`,
    remove: "ഉടമയുടെ പാസ്‌കീകൾ നീക്കം ചെയ്യൂ", removeNote: "ഫോൺ നഷ്ടപ്പെട്ടാലോ മോഷണം പോയാലോ: എല്ലാ പാസ്‌കീകളും, QR കോഡും കാർഡും, പ്രവർത്തിക്കാതാകും. പിന്നെ പുതിയ സെറ്റപ്പ് QR കോഡ് കാണിക്കൂ.", removed: "ഉടമയുടെ പാസ്‌കീകൾ നീക്കം ചെയ്തു. ഉടമയെ കാണുമ്പോൾ പുതിയ സെറ്റപ്പ് QR കോഡ് കാണിക്കൂ.",
    setupTitle: "ഉടമയ്ക്കുള്ള സെറ്റപ്പ് QR കോഡ്", setupNote: (until) => `ഒരിക്കൽ മാത്രം, ഈ കടയ്ക്ക് മാത്രം, ${until} വരെ പ്രവർത്തിക്കും. ഉടമ ഫോൺ ക്യാമറ കൊണ്ട് സ്കാൻ ചെയ്ത് വിരലടയാളം തൊടണം. പുതിയ കോഡ് കാണിച്ചാൽ ഇത് നിൽക്കും.`,
    cardTitle: "റിക്കവറി കാർഡ്", cardNote: "ഈ പേജ് പ്രിന്റ് ചെയ്ത് ഉടമയ്ക്ക് കൊടുക്കൂ. ഓരോ കോഡും ഒരിക്കൽ മാത്രം. ഈ കോഡുകൾ ഇനി ആർക്കും കാണാനാവില്ല, ഇവിടെയും.", cardOwner: (url) => `ഫോൺ നഷ്ടപ്പെട്ടോ? ${url} തുറന്ന് ഒരു കോഡ് ടൈപ്പ് ചെയ്യൂ.`,
    printNote: "ബ്രൗസറിലെ Print ഉപയോഗിക്കൂ.", back: "കടയിലേക്ക് മടങ്ങൂ",
    locked: "ഇപ്പോൾ ഉടമയ്ക്ക് സ്വന്തം സൈൻ ഇൻ ഉണ്ട്. പുതിയ ഫോൺ ഉടമയുടെ ആപ്പിൽ നിന്നോ ഉടമയുടെ റിക്കവറി കോഡുകൾ കൊണ്ടോ ചേർക്കാം.", askRemove: "ഉടമയുടെ പാസ്‌കീകൾ നീക്കാൻ ആവശ്യപ്പെടുക", askRemoveNote: "എല്ലാ ഫോണുകളും നഷ്ടപ്പെട്ട്, കോഡുകളുമില്ലാത്ത ഉടമയ്ക്കായി. ഉടമയെ ഉടൻ അറിയിക്കും, അവർക്ക് റദ്ദാക്കാം; റദ്ദാക്കിയില്ലെങ്കിൽ 48 മണിക്കൂറിന് ശേഷം നടക്കും, അപ്പോൾ മാത്രമേ പുതിയ സെറ്റപ്പ് QR കോഡ് കാണിക്കാനാകൂ.",
    requested: "അഭ്യർത്ഥിച്ചു. ഉടമയ്ക്ക് ഇപ്പോൾ അവരുടെ ആപ്പിൽ കാണാം. റദ്ദാക്കിയില്ലെങ്കിൽ 48 മണിക്കൂറിൽ നടക്കും.", pending: (by, when) => `${by} ഉടമയുടെ പാസ്‌കീകൾ നീക്കാൻ ആവശ്യപ്പെട്ടു. ഉടമ റദ്ദാക്കിയില്ലെങ്കിൽ ${when}-ന് നടക്കും.`, resetLine: (day, reason) => `${day}-ന് Geometer ഉടമയുടെ സൈൻ ഇൻ റീസെറ്റ് ചെയ്തു: ${reason}`, lockedNotice: "ഇപ്പോൾ ഉടമയ്ക്ക് സ്വന്തം സൈൻ ഇൻ ഉണ്ട്. പുതിയ ഫോൺ ഉടമയുടെ ആപ്പിൽ നിന്നോ ഉടമയുടെ റിക്കവറി കോഡുകൾ കൊണ്ടോ ചേർക്കാം.",
    shopPhone: "പേജിൽ കടയുടെ ഫോൺ നമ്പർ", shopPhoneNote: "രാജ്യ കോഡ് സഹിതം, ഉദാ. +918012345678. പേജിൽ \"കടയെ വിളിക്കൂ\" കാണും. ലാൻഡ്‌ലൈനും ചേരും.",
    map: "മാപ്പ് ലിങ്ക്", mapNote: "കടയുടെ Google Maps ലിങ്ക് പേസ്റ്റ് ചെയ്യൂ (Share, പിന്നെ Copy link). പേജിൽ \"മാപ്പിൽ കാണൂ\" കാണും.",
    partnerName: "നിങ്ങളുടെ പേര്, ഉടമയ്ക്കായി", partnerPhone: "നിങ്ങളുടെ ഫോൺ നമ്പർ, ഉടമയ്ക്കായി", partnerNote: "ഉടമയുടെ ആപ്പിലും ഓരോ എറർ പേജിലും നിങ്ങളുടെ പേര്, വിളിക്കാനും WhatsApp-നും ബട്ടണുകളോടെ കാണും. രണ്ടും നൽകൂ, അല്ലെങ്കിൽ ഒന്നും വേണ്ട.",
    setupWait: "കാത്തിരിക്കൂ...", setupReady: "തയ്യാർ: ഇപ്പോൾ സ്കാൻ ചെയ്യൂ", setupWaitNote: "കോഡ് കാണിച്ച് ഏകദേശം 15 സെക്കൻഡ് കഴിഞ്ഞാണ് പ്രവർത്തിച്ചുതുടങ്ങുന്നത്. താഴത്തെ ബാർ പച്ചയാകുന്നതുവരെ കാത്തിരുന്ന് സ്കാൻ ചെയ്യൂ. അതിനുമുമ്പ് സ്കാൻ ചെയ്താൽ ഇതുവരെ പ്രവർത്തിക്കില്ല.",
    cardQr: "അല്ലെങ്കിൽ ഫോൺ ക്യാമറ കൊണ്ട് ഇത് സ്കാൻ ചെയ്യൂ:", cardMachine: "ഈ മലയാളം യന്ത്രം എഴുതിയതാണ്; മലയാളം അറിയുന്ന ഒരാൾ ഇതുവരെ പരിശോധിച്ചിട്ടില്ല.",
  },
  kn: {
    heading: "ಅಂಗಡಿಯ ಪುಟ", note: "ಗ್ರಾಹಕರು ಇಲ್ಲಿ ಬುಕ್ ಮಾಡುತ್ತಾರೆ, ಪಾವತಿಸುತ್ತಾರೆ ಮತ್ತು ಅಂಗಡಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ; ಮಾಲೀಕರು ತಮ್ಮ WhatsApp ಗೆ ಬಂದ ಲಿಂಕ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡುತ್ತಾರೆ. ಪ್ರತಿ ಅಂಗಡಿಗೆ ಒಂದು ಚಿಕ್ಕ ಹೆಸರು.",
    choice: "ಪುಟ ಎಲ್ಲಿದೆ", hub: "ಹಂಚಿದ ಪುಟ ಡೊಮೇನ್‌ನಲ್ಲಿ (ಚಿಕ್ಕ ಹೆಸರು)", own: "ನಿಮ್ಮ ಸ್ವಂತ ಡೊಮೇನ್‌ನಲ್ಲಿ ಮಾತ್ರ", slug: "ಚಿಕ್ಕ ಹೆಸರು", slugNote: "3 ರಿಂದ 40 ಸಣ್ಣ ಅಕ್ಷರಗಳು, ಅಂಕಿಗಳು ಮತ್ತು ಹೈಫನ್, ಉದಾ. veena-salon. ಬೇರೆ ಅಂಗಡಿಯ ಹೆಸರು ಅಥವಾ ಇತ್ತೀಚೆಗೆ ಬಳಸಿದ ಹೆಸರು ತೆಗೆದುಕೊಳ್ಳಲಾಗದು.",
    whatsapp: "ಪುಟದಲ್ಲಿ ಅಂಗಡಿಯ WhatsApp ನಂಬರ್", whatsappNote: "+91 ಮತ್ತು ಹತ್ತು ಅಂಕಿಗಳು. ಪುಟ ಇದಕ್ಕೆ ಲಿಂಕ್ ಮಾಡುತ್ತದೆ, ಮಾಲೀಕರು ಇದಕ್ಕೆ \"open my app\" ಕಳುಹಿಸುತ್ತಾರೆ.", save: "ಉಳಿಸಿ",
    live: (url) => `ಚಾಲೂ: ${url}`, stable: "QR ಕೋಡ್ ಮತ್ತು ಮುದ್ರಣಕ್ಕಾಗಿ ವಿಳಾಸ", stableNote: "ಚಿಕ್ಕ ಹೆಸರು ಅಥವಾ ಡೊಮೇನ್ ಬದಲಾದರೂ ಇದು ಬದಲಾಗುವುದಿಲ್ಲ. ಮುದ್ರಿಸುವ ಎಲ್ಲದರಲ್ಲೂ ಇದನ್ನೇ ಬಳಸಿ.",
    waiting: "ಪಡೆಯಲಾಗುತ್ತಿದೆ: ಸರ್ವರ್ ಒಂದು ನಿಮಿಷದಲ್ಲಿ ಕೇಳುತ್ತದೆ.", problem: (m) => `ಪಡೆಯಲಿಲ್ಲ: ${m}`, ownNote: "ಪುಟ ಈ ಸರ್ವರ್‌ನ ಸ್ವಂತ ವಿಳಾಸದಲ್ಲಿ ಮಾತ್ರ.",
    sessions: "ಮಾಲೀಕರು ಸೈನ್ ಇನ್ ಆದ ಸಾಧನಗಳು", sessionsNote: "ಮಾಲೀಕರು ಬೆರಳಚ್ಚಿನಿಂದ (ಪಾಸ್‌ಕೀ) ಅಥವಾ WhatsApp ನಲ್ಲಿ ಬಂದ ಲಿಂಕ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡುತ್ತಾರೆ; ಪ್ರತಿ ಸಾಧನ 30 ದಿನ ಸೈನ್ ಇನ್ ಆಗಿರುತ್ತದೆ. ಫೋನ್ ಕಳೆದುಹೋದರೆ ಅಥವಾ ಮಾಲೀಕರು ಕೇಳಿದರೆ, ಎಲ್ಲವನ್ನೂ ಸೈನ್ ಔಟ್ ಮಾಡಿ.", endAll: "ಎಲ್ಲಾ ಸಾಧನಗಳನ್ನು ಸೈನ್ ಔಟ್ ಮಾಡಿ", ended: "ಎಲ್ಲಾ ಸಾಧನಗಳು ಸೈನ್ ಔಟ್ ಆಗಿವೆ.", bad: "ಚಿಕ್ಕ ಹೆಸರು (3 ರಿಂದ 40 ಸಣ್ಣ ಅಕ್ಷರಗಳು, ಅಂಕಿಗಳು ಮತ್ತು ಹೈಫನ್) ಮತ್ತು ನಂಬರ್ (+91 ಮತ್ತು ಹತ್ತು ಅಂಕಿಗಳು) ಪರಿಶೀಲಿಸಿ: ಏನೂ ಉಳಿಸಲಿಲ್ಲ.",
    signin: "ಮಾಲೀಕರ ಸೈನ್ ಇನ್", signinNote: "ಮಾಲೀಕರು ಫೋನ್‌ನ ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡುತ್ತಾರೆ. ಸೆಟಪ್ ಭೇಟಿಯಲ್ಲಿ ಸೆಟಪ್ QR ಕೋಡ್ ತೋರಿಸಿ: ಮಾಲೀಕರು ಅದನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ ಬೆರಳಚ್ಚು ಮುಟ್ಟುತ್ತಾರೆ. ನಂತರ ಅವರಿಗೆ ರಿಕವರಿ ಕಾರ್ಡ್ ಮುದ್ರಿಸಿ.",
    setupMake: "ಸೆಟಪ್ QR ಕೋಡ್ ತೋರಿಸಿ", recoveryMake: "ರಿಕವರಿ ಕಾರ್ಡ್ ಮುದ್ರಿಸಿ", recoveryOn: (day) => `ರಿಕವರಿ ಕಾರ್ಡ್ ಮಾಡಿದ್ದು ${day}.`,
    remove: "ಮಾಲೀಕರ ಪಾಸ್‌ಕೀಗಳನ್ನು ತೆಗೆದುಹಾಕಿ", removeNote: "ಫೋನ್ ಕಳೆದುಹೋದರೆ ಅಥವಾ ಕಳುವಾದರೆ: ಎಲ್ಲಾ ಪಾಸ್‌ಕೀಗಳು, QR ಕೋಡ್ ಮತ್ತು ಕಾರ್ಡ್ ಕೆಲಸ ನಿಲ್ಲಿಸುತ್ತವೆ. ನಂತರ ಹೊಸ ಸೆಟಪ್ QR ಕೋಡ್ ತೋರಿಸಿ.", removed: "ಮಾಲೀಕರ ಪಾಸ್‌ಕೀಗಳನ್ನು ತೆಗೆದುಹಾಕಲಾಗಿದೆ. ಮಾಲೀಕರನ್ನು ಭೇಟಿಯಾದಾಗ ಹೊಸ ಸೆಟಪ್ QR ಕೋಡ್ ತೋರಿಸಿ.",
    setupTitle: "ಮಾಲೀಕರಿಗಾಗಿ ಸೆಟಪ್ QR ಕೋಡ್", setupNote: (until) => `ಒಮ್ಮೆ ಮಾತ್ರ, ಈ ಅಂಗಡಿಗೆ ಮಾತ್ರ, ${until} ವರೆಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ. ಮಾಲೀಕರು ಫೋನ್ ಕ್ಯಾಮೆರಾದಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ ಬೆರಳಚ್ಚು ಮುಟ್ಟಬೇಕು. ಹೊಸ ಕೋಡ್ ತೋರಿಸಿದರೆ ಇದು ನಿಲ್ಲುತ್ತದೆ.`,
    cardTitle: "ರಿಕವರಿ ಕಾರ್ಡ್", cardNote: "ಈ ಪುಟವನ್ನು ಮುದ್ರಿಸಿ ಮಾಲೀಕರಿಗೆ ಕೊಡಿ. ಪ್ರತಿ ಕೋಡ್ ಒಮ್ಮೆ ಮಾತ್ರ. ಈ ಕೋಡ್‌ಗಳನ್ನು ಮತ್ತೆ ಯಾರೂ ನೋಡಲಾಗದು, ಇಲ್ಲಿಯೂ.", cardOwner: (url) => `ಫೋನ್ ಕಳೆದುಹೋಯಿತೇ? ${url} ತೆರೆದು ಒಂದು ಕೋಡ್ ಟೈಪ್ ಮಾಡಿ.`,
    printNote: "ಬ್ರೌಸರ್‌ನ Print ಬಳಸಿ.", back: "ಅಂಗಡಿಗೆ ಹಿಂತಿರುಗಿ",
    locked: "ಈಗ ಮಾಲೀಕರ ಬಳಿ ಅವರ ಸ್ವಂತ ಸೈನ್ ಇನ್ ಇದೆ. ಹೊಸ ಫೋನ್ ಅನ್ನು ಮಾಲೀಕರ ಆಪ್‌ನಿಂದ ಅಥವಾ ಮಾಲೀಕರ ರಿಕವರಿ ಕೋಡ್‌ಗಳಿಂದ ಸೇರಿಸಲಾಗುತ್ತದೆ.", askRemove: "ಮಾಲೀಕರ ಪಾಸ್‌ಕೀಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿ", askRemoveNote: "ಎಲ್ಲಾ ಫೋನ್‌ಗಳನ್ನು ಕಳೆದುಕೊಂಡು, ಕೋಡ್‌ಗಳೂ ಇಲ್ಲದ ಮಾಲೀಕರಿಗಾಗಿ. ಮಾಲೀಕರಿಗೆ ತಕ್ಷಣ ತಿಳಿಸಲಾಗುತ್ತದೆ, ಅವರು ರದ್ದುಗೊಳಿಸಬಹುದು; ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 48 ಗಂಟೆಗಳ ನಂತರ ಆಗುತ್ತದೆ, ಆಗ ಮಾತ್ರ ಹೊಸ ಸೆಟಪ್ QR ಕೋಡ್ ತೋರಿಸಬಹುದು.",
    requested: "ಕೇಳಲಾಗಿದೆ. ಮಾಲೀಕರಿಗೆ ಈಗ ಅವರ ಆಪ್‌ನಲ್ಲಿ ಕಾಣುತ್ತದೆ. ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ 48 ಗಂಟೆಗಳಲ್ಲಿ ಆಗುತ್ತದೆ.", pending: (by, when) => `${by} ಮಾಲೀಕರ ಪಾಸ್‌ಕೀಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿದ್ದಾರೆ. ಮಾಲೀಕರು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ ${when} ರಂದು ಆಗುತ್ತದೆ.`, resetLine: (day, reason) => `${day} ರಂದು Geometer ಮಾಲೀಕರ ಸೈನ್ ಇನ್ ರೀಸೆಟ್ ಮಾಡಿದೆ: ${reason}`, lockedNotice: "ಈಗ ಮಾಲೀಕರ ಬಳಿ ಅವರ ಸ್ವಂತ ಸೈನ್ ಇನ್ ಇದೆ. ಹೊಸ ಫೋನ್ ಅನ್ನು ಮಾಲೀಕರ ಆಪ್‌ನಿಂದ ಅಥವಾ ಮಾಲೀಕರ ರಿಕವರಿ ಕೋಡ್‌ಗಳಿಂದ ಸೇರಿಸಲಾಗುತ್ತದೆ.",
    shopPhone: "ಪುಟದಲ್ಲಿ ಅಂಗಡಿಯ ಫೋನ್ ನಂಬರ್", shopPhoneNote: "ದೇಶದ ಕೋಡ್‌ನೊಂದಿಗೆ, ಉದಾ. +918012345678. ಪುಟದಲ್ಲಿ \"ಅಂಗಡಿಗೆ ಕರೆ ಮಾಡಿ\" ಕಾಣುತ್ತದೆ. ಲ್ಯಾಂಡ್‌ಲೈನ್ ಕೂಡ ಆಗುತ್ತದೆ.",
    map: "ಮ್ಯಾಪ್ ಲಿಂಕ್", mapNote: "ಅಂಗಡಿಯ Google Maps ಲಿಂಕ್ ಅಂಟಿಸಿ (Share, ನಂತರ Copy link). ಪುಟದಲ್ಲಿ \"ನಕ್ಷೆಯಲ್ಲಿ ನೋಡಿ\" ಕಾಣುತ್ತದೆ.",
    partnerName: "ನಿಮ್ಮ ಹೆಸರು, ಮಾಲೀಕರಿಗಾಗಿ", partnerPhone: "ನಿಮ್ಮ ಫೋನ್ ನಂಬರ್, ಮಾಲೀಕರಿಗಾಗಿ", partnerNote: "ಮಾಲೀಕರ ಆಪ್‌ನಲ್ಲಿ ಮತ್ತು ಪ್ರತಿ ದೋಷ ಪುಟದಲ್ಲಿ ನಿಮ್ಮ ಹೆಸರು, ಕರೆ ಮತ್ತು WhatsApp ಬಟನ್‌ಗಳೊಂದಿಗೆ ಕಾಣುತ್ತದೆ. ಎರಡನ್ನೂ ತುಂಬಿ, ಅಥವಾ ಯಾವುದನ್ನೂ ಬೇಡ.",
    setupWait: "ಕಾಯಿರಿ...", setupReady: "ಸಿದ್ಧ: ಈಗ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ", setupWaitNote: "ಕೋಡ್ ತೋರಿಸಿ ಸುಮಾರು 15 ಸೆಕೆಂಡ್ ನಂತರ ಕೆಲಸ ಮಾಡಲು ಶುರುವಾಗುತ್ತದೆ. ಕೆಳಗಿನ ಪಟ್ಟಿ ಹಸಿರಾಗುವವರೆಗೆ ಕಾಯಿರಿ, ನಂತರ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ. ಅದಕ್ಕೂ ಮೊದಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿದರೆ ಇನ್ನೂ ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ.",
    cardQr: "ಅಥವಾ ಫೋನ್ ಕ್ಯಾಮೆರಾದಿಂದ ಇದನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ:", cardMachine: "ಈ ಕನ್ನಡವನ್ನು ಯಂತ್ರ ಬರೆದಿದೆ; ಕನ್ನಡ ಬಲ್ಲವರು ಇನ್ನೂ ಪರಿಶೀಲಿಸಿಲ್ಲ.",
  },
};

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;

/** The block on the shop page. */
export function pagesBlock(c: Ctx, id: string, v: PagesView, notice?: "ended" | "bad" | "removed" | "locked" | "requested"): Raw {
  const w = WORDS[c.lang];
  const s = v.settings;
  const st = v.status;
  const live = s.pages === "hub" && st?.slug === s.slug && st?.url;
  const state = s.pages === "own" ? html`<li class="info"><span class="mark">·</span><span>${w.ownNote}</span></li>`
    : live ? html`<li class="info"><span class="mark">✓</span><span>${w.live(st!.url!)}${st!.pageUrl ? html`<br><b>${w.stable}</b>: <code>${st!.pageUrl}</code><br><small class="note">${w.stableNote}</small>` : ""}</span></li>`
    : st?.problem && st.tried?.slug === s.slug ? html`<li class="warn"><span class="mark">!</span><span>${w.problem(st.problem.message)}</span></li>`
    : s.slug ? html`<li class="info"><span class="mark">·</span><span>${w.waiting}</span></li>` : "";
  return html`<h2>${w.heading}</h2><p class="note">${w.note}</p>
${notice === "bad" ? html`<div class="notice" role="alert">${w.bad}</div>` : ""}
<ul class="plain">${state}</ul>
<form method="post" action="/shops/${id}/page">${csrf(c)}
${v.canChoose ? html`<label class="field"><span>${w.choice}</span><select name="pages"><option value="own" ${s.pages === "own" ? raw("selected") : ""}>${w.own}</option><option value="hub" ${s.pages === "hub" ? raw("selected") : ""}>${w.hub}</option></select></label>` : ""}
<label class="field"><span>${w.slug}</span><input name="slug" value="${s.slug ?? ""}" maxlength="40" pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" autocapitalize="none" spellcheck="false"></label><p class="note">${w.slugNote}</p>
<label class="field"><span>${w.whatsapp}</span><input name="whatsapp" type="tel" value="${s.whatsapp ?? ""}" maxlength="13" pattern="\\+91[0-9]{10}"></label><p class="note">${w.whatsappNote}</p>
<label class="field"><span>${w.shopPhone}</span><input name="phone" type="tel" value="${s.phone ?? ""}" maxlength="16" pattern="\\+[0-9]{10,15}"></label><p class="note">${w.shopPhoneNote}</p>
<label class="field"><span>${w.map}</span><input name="map" type="url" value="${s.map ?? ""}" maxlength="300"></label><p class="note">${w.mapNote}</p>
<label class="field"><span>${w.partnerName}</span><input name="partnerName" value="${s.partner?.name ?? ""}" maxlength="60"></label>
<label class="field"><span>${w.partnerPhone}</span><input name="partnerPhone" type="tel" value="${s.partner?.phone ?? ""}" maxlength="16" pattern="\\+[0-9]{10,15}"></label><p class="note">${w.partnerNote}</p>
<button class="btn" type="submit">${w.save}</button></form>
<h3>${w.signin}</h3><p class="note">${w.signinNote}</p>
${notice === "removed" ? html`<div class="notice" role="status">${w.removed}</div>` : ""}
${notice === "locked" ? html`<div class="notice" role="alert">${w.lockedNotice}</div>` : ""}
${notice === "requested" ? html`<div class="notice" role="status">${w.requested}</div>` : ""}
${v.grants?.resetAt ? html`<div class="notice" role="note">${w.resetLine(v.grants.resetAt.slice(0, 10), v.grants.resetReason ?? "")}</div>` : ""}
${v.access?.locked ? html`
<p class="note">${w.locked}</p>
${v.access.removal ? html`<div class="notice" role="status">${w.pending(v.access.removal.askedBy, v.access.removal.effectiveAt.slice(0, 16).replace("T", " ") + " UTC")}</div>` : html`<p class="note">${w.askRemoveNote}</p>
<form method="post" action="/shops/${id}/owner-passkeys/remove">${csrf(c)}<button class="btn danger" type="submit">${w.askRemove}</button></form>`}` : html`
${v.grants?.recoveryAt ? html`<p class="note">${w.recoveryOn(v.grants.recoveryAt.slice(0, 10))}</p>` : ""}
<form method="post" action="/shops/${id}/owner-setup">${csrf(c)}<button class="btn" type="submit">${w.setupMake}</button></form>
<form method="post" action="/shops/${id}/owner-recovery">${csrf(c)}<button class="btn" type="submit">${w.recoveryMake}</button></form>
<p class="note">${w.removeNote}</p>
<form method="post" action="/shops/${id}/owner-passkeys/remove">${csrf(c)}<button class="btn danger" type="submit">${w.remove}</button></form>`}
<h3>${w.sessions}</h3><p class="note">${w.sessionsNote}</p>
${notice === "ended" ? html`<div class="notice" role="status">${w.ended}</div>` : ""}
<form method="post" action="/shops/${id}/owner-sessions/end">${csrf(c)}<button class="btn danger" type="submit">${w.endAll}</button></form>`;
}

/**
 * Item 11h: the setup QR code, shown once. Its address is the owner's view's own (the runtime checks the passkey against that origin). Batch 3: the deployer hands the
 * code to the runtime within one pass (10 s), and a scan before that was counted as a wrong guess; the page now says "wait until this turns green", with a bar that
 * turns green by itself after 15 s (CSS only: the panel runs no script, and the code is shown once, so nothing here can ask the runtime).
 */
export function ownerSetupPage(c: Ctx, id: string, url: string, until: Date): string {
  const w = WORDS[c.lang];
  const time = until.toISOString().slice(11, 16);
  return layout(c, w.setupTitle, html`<h1>${w.setupTitle}</h1><div class="ready" role="status"><span class="ready-wait">${w.setupWait}</span><span class="ready-go">${w.setupReady}</span></div><p class="note">${w.setupWaitNote}</p><figure class="qr">${raw(textQrSvg(url, { width: 280 }))}</figure>
<div class="notice" role="note">${w.setupNote(`${time} UTC`)}</div><p><small class="note"><code class="addr">${url}</code></small></p><p><a href="/shops/${id}">${w.back}</a></p>`);
}

/**
 * Item 11h: the recovery card, shown once, made to be printed. Batch 3: the part the owner keeps (the card itself) is in the OWNER's language, not the Operator's, and
 * carries a QR for the recovery address (opened in the owner's language) beside the address in large type; the Operator's own instructions stay in the panel's.
 */
export function recoveryCardPage(c: Ctx, id: string, shopName: string, codes: readonly string[], recoverUrl: string, ownerLanguage: Language = c.lang): string {
  const w = WORDS[c.lang];
  const o = WORDS[ownerLanguage];
  return layout(c, w.cardTitle, html`<h1>${w.cardTitle}: ${shopName}</h1><div class="notice" role="note">${w.cardNote}</div>
<section class="owner-card" lang="${ownerLanguage}"><h2>${o.cardTitle}: ${shopName}</h2>${o.cardMachine ? html`<p class="note">${o.cardMachine}</p>` : ""}
<ol class="codes">${codes.map((code) => html`<li>${printedCode(code)}</li>`)}</ol>
<p><b>${o.cardOwner(recoverUrl)}</b></p><p class="note">${o.cardQr}</p><figure class="qr">${raw(textQrSvg(`${recoverUrl}?lang=${ownerLanguage}`, { width: 180 }))}</figure></section>
<p class="note">${w.printNote}</p><p><a href="/shops/${id}">${w.back}</a></p>`);
}
