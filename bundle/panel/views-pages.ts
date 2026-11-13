// Item 11f on the panel's shop page: "The shop's page" (the short name on the pages domain, where it stands at fleet, its stable address and the WhatsApp number the
// page shows), the builder's choice between the pages domain and their own domain, and "sign out every device" for the owner's sessions. Plain forms, no script.
// Item 11h (decisions 45 and 46): "The owner's sign-in": the setup QR code the partner shows at the setup visit (the owner registers a passkey with it), the printed
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
export interface PagesView { settings: PageSettings; status?: PageStatus; canChoose: boolean; /** Item 11h: when the last QR and card were made, and passkeys removed. */ grants?: { setupAt?: string; recoveryAt?: string; removedAt?: string } }

interface Words {
  heading: string; note: string; choice: string; hub: string; own: string; slug: string; slugNote: string; whatsapp: string; whatsappNote: string; save: string;
  live: (url: string) => string; stable: string; stableNote: string; waiting: string; problem: (m: string) => string; ownNote: string;
  sessions: string; sessionsNote: string; endAll: string; ended: string; bad: string;
  signin: string; signinNote: string; setupMake: string; recoveryMake: string; recoveryOn: (day: string) => string; remove: string; removeNote: string; removed: string;
  setupTitle: string; setupNote: (until: string) => string; cardTitle: string; cardNote: string; cardOwner: (url: string) => string; printNote: string; back: string;
}
const WORDS: Record<Language, Words> = {
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
  },
};

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;

/** The block on the shop page. */
export function pagesBlock(c: Ctx, id: string, v: PagesView, notice?: "ended" | "bad" | "removed"): Raw {
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
<button class="btn" type="submit">${w.save}</button></form>
<h3>${w.signin}</h3><p class="note">${w.signinNote}</p>
${notice === "removed" ? html`<div class="notice" role="status">${w.removed}</div>` : ""}
${v.grants?.recoveryAt ? html`<p class="note">${w.recoveryOn(v.grants.recoveryAt.slice(0, 10))}</p>` : ""}
<form method="post" action="/shops/${id}/owner-setup">${csrf(c)}<button class="btn" type="submit">${w.setupMake}</button></form>
<form method="post" action="/shops/${id}/owner-recovery">${csrf(c)}<button class="btn" type="submit">${w.recoveryMake}</button></form>
<p class="note">${w.removeNote}</p>
<form method="post" action="/shops/${id}/owner-passkeys/remove">${csrf(c)}<button class="btn danger" type="submit">${w.remove}</button></form>
<h3>${w.sessions}</h3><p class="note">${w.sessionsNote}</p>
${notice === "ended" ? html`<div class="notice" role="status">${w.ended}</div>` : ""}
<form method="post" action="/shops/${id}/owner-sessions/end">${csrf(c)}<button class="btn danger" type="submit">${w.endAll}</button></form>`;
}

/** Item 11h: the setup QR code, shown once. Its address is the owner's view's own (the runtime checks the passkey against that origin). */
export function ownerSetupPage(c: Ctx, id: string, url: string, until: Date): string {
  const w = WORDS[c.lang];
  const time = until.toISOString().slice(11, 16);
  return layout(c, w.setupTitle, html`<h1>${w.setupTitle}</h1><figure class="qr">${raw(textQrSvg(url, { width: 280 }))}</figure>
<div class="notice" role="note">${w.setupNote(`${time} UTC`)}</div><p><small class="note"><code class="addr">${url}</code></small></p><p><a href="/shops/${id}">${w.back}</a></p>`);
}

/** Item 11h: the recovery card, shown once, made to be printed: the shop, the codes in two groups of five, and where the owner types one. */
export function recoveryCardPage(c: Ctx, id: string, shopName: string, codes: readonly string[], recoverUrl: string): string {
  const w = WORDS[c.lang];
  return layout(c, w.cardTitle, html`<h1>${w.cardTitle}: ${shopName}</h1><div class="notice" role="note">${w.cardNote}</div>
<ol class="codes" style="font:1.4rem/2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em">${codes.map((code) => html`<li>${printedCode(code)}</li>`)}</ol>
<p><b>${w.cardOwner(recoverUrl)}</b></p><p class="note">${w.printNote}</p><p><a href="/shops/${id}">${w.back}</a></p>`);
}
