// "What to ask the shop for": the ONE list behind the card a partner takes to a visit (B72, plan checkpoint item 9). Everything the card says is written here, in
// English, Hindi, Malayalam and Kannada, and nowhere else: render.ts makes the cards (the Markdown files beside each template's sell guide, and the data the panel
// shows) from this file, so the printed card, the panel and the sell guides' setup list cannot drift apart. Used by render.ts, the panel (through askCardFor) and
// test/ask-card.test.ts.
//
// What goes on the list: only what the code needs from the shop today. The first block is the same for every template: the UPI ID, the shop's WhatsApp number, the
// owner's phone, and the Facebook login WhatsApp needs. After it, each template adds what its own settings file asks (Bookings: templates/commerce/bookings/src/settings.ts;
// Orders and Fees likewise). Things only some shops want (Google Calendar for Bookings, its own Razorpay account, a delivery area) are marked optional.
//
// Honesty rules the list keeps (docs/research/2026-11-11-whatsapp-onboarding-facts.md): Meta may later ask the shop to verify its business, and which documents it accepts
// for a small shop is not confirmed, so the card never tells the partner that no papers will be needed. No price or percentage is written here (prices live in prices/).
//
// Hindi, Malayalam and Kannada are machine-written, like the rest of those languages (REVIEW_STATE in bundle/panel/languages.ts): they wait for a native reader. The words
// for deposit, advance, refund, booking and the limits are the ones the sell guides and the customer messages already use (templates/commerce/bookings/src/language/templates.ts).
import type { Language } from "../language/languages.ts";

/** The three templates the bundle can run (bundle/lib/kinds.ts). */
export type CardTemplate = "bookings" | "orders" | "fees";
export const CARD_TEMPLATES: readonly CardTemplate[] = ["bookings", "orders", "fees"];

/** One piece of text in every language. A missing language is a type error, so a card can never lose one. */
export type Words = Record<Language, string>;
const w = (en: string, hi: string, ml: string, kn: string): Words => ({ en, hi, ml, kn });

export interface ListItem {
  /** Stable name, for tests and for anything that points at one line of the card. */
  id: string;
  /** "always": every shop. "template": what this template adds. */
  group: "always" | "template";
  /** Only some shops need it. The card marks it, and the condition is in `what`. */
  optional?: boolean;
  /** What to bring or ask for. */
  what: Words;
  /** Why, and how to ask it, in a sentence or two. */
  why: Words;
}

// ---- what every shop is asked for ---------------------------------------------------------------------------------------

const ALWAYS: ListItem[] = [
  {
    id: "upi", group: "always",
    what: w(
      "The shop's UPI ID, and the name that shows on it",
      "दुकान की UPI ID और उस पर दिखने वाला नाम",
      "കടയുടെ UPI ID-യും അതിൽ കാണുന്ന പേരും",
      "ಅಂಗಡಿಯ UPI ID ಮತ್ತು ಅದರಲ್ಲಿ ಕಾಣುವ ಹೆಸರು"),
    why: w(
      "Customers pay straight to this UPI ID. Type both carefully and read them back to the owner: nothing checks a UPI ID for you, and one wrong letter sends the money to someone else.",
      "ग्राहक सीधे इसी UPI ID पर पैसे भेजते हैं। दोनों ध्यान से टाइप कीजिए और मालिक को पढ़कर सुनाइए: UPI ID जाँचने का कोई तरीक़ा नहीं है, और एक अक्षर ग़लत हुआ तो पैसे किसी और के पास चले जाएँगे।",
      "കസ്റ്റമർമാർ നേരെ ഈ UPI ID-യിലേക്കാണ് പണം അയക്കുന്നത്. രണ്ടും ശ്രദ്ധയോടെ ടൈപ്പ് ചെയ്ത് ഉടമയെ വായിച്ചു കേൾപ്പിക്കൂ: UPI ID പരിശോധിക്കാൻ ഒരു വഴിയുമില്ല, ഒരു അക്ഷരം തെറ്റിയാൽ പണം മറ്റൊരാൾക്ക് പോകും.",
      "ಗ್ರಾಹಕರು ನೇರವಾಗಿ ಈ UPI ID ಗೆ ಹಣ ಕಳುಹಿಸುತ್ತಾರೆ. ಎರಡನ್ನೂ ಎಚ್ಚರಿಕೆಯಿಂದ ಟೈಪ್ ಮಾಡಿ, ಮಾಲೀಕರಿಗೆ ಓದಿ ಹೇಳಿ: UPI ID ಯನ್ನು ಪರಿಶೀಲಿಸುವ ವ್ಯವಸ್ಥೆ ಇಲ್ಲ, ಒಂದು ಅಕ್ಷರ ತಪ್ಪಿದರೆ ಹಣ ಬೇರೆಯವರಿಗೆ ಹೋಗುತ್ತದೆ."),
  },
  {
    id: "shop-whatsapp", group: "always",
    what: w(
      "The shop's WhatsApp number, in the WhatsApp Business app on the owner's phone",
      "दुकान का WhatsApp नंबर, मालिक के फ़ोन के WhatsApp Business ऐप में",
      "കടയുടെ WhatsApp നമ്പർ, ഉടമയുടെ ഫോണിലെ WhatsApp Business ആപ്പിൽ",
      "ಅಂಗಡಿಯ WhatsApp ನಂಬರ್, ಮಾಲೀಕರ ಫೋನ್‌ನ WhatsApp Business ಆ್ಯಪ್‌ನಲ್ಲಿ"),
    why: w(
      "The shop keeps its number and its app; the helper works next to them. It must be the Business app, not plain WhatsApp. The owner opens the app at least every two weeks, or the connection can drop.",
      "दुकान अपना नंबर और अपना ऐप रखती है; हेल्पर उनके बग़ल में काम करता है। यह WhatsApp Business ऐप होना चाहिए, साधारण WhatsApp नहीं। मालिक ऐप को कम से कम दो हफ़्ते में एक बार खोलें, वरना कनेक्शन टूट सकता है।",
      "കട സ്വന്തം നമ്പറും സ്വന്തം ആപ്പും നിലനിർത്തും; ഹെൽപ്പർ അവയ്ക്കരികിൽ പ്രവർത്തിക്കും. ഇത് WhatsApp Business ആപ്പ് ആയിരിക്കണം, സാധാരണ WhatsApp അല്ല. ഉടമ ആപ്പ് കുറഞ്ഞത് രണ്ട് ആഴ്ചയിലൊരിക്കൽ തുറക്കണം, അല്ലെങ്കിൽ കണക്ഷൻ വിട്ടുപോകാം.",
      "ಅಂಗಡಿ ತನ್ನ ನಂಬರ್ ಮತ್ತು ತನ್ನ ಆ್ಯಪ್ ಉಳಿಸಿಕೊಳ್ಳುತ್ತದೆ; ಹೆಲ್ಪರ್ ಅವುಗಳ ಪಕ್ಕದಲ್ಲೇ ಕೆಲಸ ಮಾಡುತ್ತದೆ. ಇದು WhatsApp Business ಆ್ಯಪ್ ಆಗಿರಬೇಕು, ಸಾಮಾನ್ಯ WhatsApp ಅಲ್ಲ. ಮಾಲೀಕರು ಆ್ಯಪ್ ಅನ್ನು ಕನಿಷ್ಠ ಎರಡು ವಾರಕ್ಕೊಮ್ಮೆ ತೆರೆಯಬೇಕು, ಇಲ್ಲದಿದ್ದರೆ ಸಂಪರ್ಕ ಕಡಿಯಬಹುದು."),
  },
  {
    id: "owner-phone", group: "always",
    what: w(
      "The owner's own phone number, on WhatsApp",
      "मालिक का अपना फ़ोन नंबर (WhatsApp पर)",
      "ഉടമയുടെ സ്വന്തം ഫോൺ നമ്പർ (WhatsApp-ൽ)",
      "ಮಾಲೀಕರ ಸ್ವಂತ ಫೋನ್ ನಂಬರ್ (WhatsApp ನಲ್ಲಿ)"),
    why: w(
      "This is where the helper asks for approvals, and where the monthly report goes. The owner replies \"approve\" or \"deny\". Practise one together.",
      "हेल्पर मंज़ूरी इसी नंबर पर पूछता है और मासिक रिपोर्ट भी यहीं आती है। मालिक \"approve\" या \"deny\" लिखकर जवाब देते हैं। साथ बैठकर एक बार आज़मा लीजिए।",
      "ഹെൽപ്പർ അനുമതി ചോദിക്കുന്നതും മാസത്തെ റിപ്പോർട്ട് വരുന്നതും ഈ നമ്പറിലാണ്. ഉടമ \"approve\" അല്ലെങ്കിൽ \"deny\" എന്ന് മറുപടി അയക്കും. ഒരുമിച്ച് ഒരെണ്ണം പരീക്ഷിച്ചു നോക്കൂ.",
      "ಹೆಲ್ಪರ್ ಅನುಮತಿ ಕೇಳುವುದು ಮತ್ತು ತಿಂಗಳ ರಿಪೋರ್ಟ್ ಬರುವುದು ಈ ನಂಬರ್‌ಗೆ. ಮಾಲೀಕರು \"approve\" ಅಥವಾ \"deny\" ಎಂದು ಉತ್ತರಿಸುತ್ತಾರೆ. ಒಟ್ಟಿಗೆ ಒಂದನ್ನು ಪ್ರಯತ್ನಿಸಿ."),
  },
  {
    id: "meta-login", group: "always",
    what: w(
      "A Facebook login with admin access to the shop's Meta business portfolio",
      "दुकान के Meta बिज़नेस पोर्टफ़ोलियो पर एडमिन पहुँच वाला Facebook लॉगिन",
      "കടയുടെ Meta ബിസിനസ് പോർട്ട്‌ഫോളിയോയിൽ അഡ്മിൻ ആക്സസ് ഉള്ള ഒരു Facebook ലോഗിൻ",
      "ಅಂಗಡಿಯ Meta ಬಿಸಿನೆಸ್ ಪೋರ್ಟ್‌ಫೋಲಿಯೊದಲ್ಲಿ ಅಡ್ಮಿನ್ ಪ್ರವೇಶ ಇರುವ Facebook ಲಾಗಿನ್"),
    why: w(
      "WhatsApp needs it. The owner logs in themselves, on their own phone: you never see a password or a code.",
      "WhatsApp के लिए यह चाहिए। मालिक ख़ुद अपने फ़ोन पर लॉगिन करते हैं: आप कोई पासवर्ड या कोड कभी नहीं देखते।",
      "WhatsApp-ന് ഇത് വേണം. ഉടമ സ്വന്തം ഫോണിൽ തന്നെ ലോഗിൻ ചെയ്യും: നിങ്ങൾ പാസ്‌വേഡോ കോഡോ ഒരിക്കലും കാണില്ല.",
      "WhatsApp ಗೆ ಇದು ಬೇಕು. ಮಾಲೀಕರು ತಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ತಾವೇ ಲಾಗಿನ್ ಮಾಡುತ್ತಾರೆ: ನೀವು ಪಾಸ್‌ವರ್ಡ್ ಅಥವಾ ಕೋಡ್ ಅನ್ನು ಎಂದಿಗೂ ನೋಡುವುದಿಲ್ಲ."),
  },
  {
    id: "public-name", group: "always",
    what: w(
      "The name the shop is known by in public (signboard, Google or Instagram page)",
      "दुकान का वह नाम जिससे लोग उसे बाहर जानते हैं (बोर्ड, Google या Instagram पेज)",
      "പുറത്ത് കട അറിയപ്പെടുന്ന പേര് (ബോർഡ്, Google അല്ലെങ്കിൽ Instagram പേജ്)",
      "ಹೊರಗೆ ಅಂಗಡಿ ಯಾವ ಹೆಸರಿನಿಂದ ಗೊತ್ತಿದೆಯೋ ಆ ಹೆಸರು (ಬೋರ್ಡ್, Google ಅಥವಾ Instagram ಪುಟ)"),
    why: w(
      "The name WhatsApp shows has to match what the shop calls itself in public.",
      "WhatsApp पर दिखने वाला नाम उसी नाम से मेल खाना चाहिए जो दुकान बाहर इस्तेमाल करती है।",
      "WhatsApp കാണിക്കുന്ന പേര് കട പുറത്ത് ഉപയോഗിക്കുന്ന പേരുമായി ചേരണം.",
      "WhatsApp ತೋರಿಸುವ ಹೆಸರು ಅಂಗಡಿ ಹೊರಗೆ ಬಳಸುವ ಹೆಸರಿಗೆ ಹೊಂದಿಕೆಯಾಗಬೇಕು."),
  },
  {
    id: "verification", group: "always",
    what: w(
      "Be ready for Meta to ask the shop to verify its business later",
      "तैयार रहिए: Meta आगे चलकर दुकान से अपने कारोबार की पुष्टि करने को कह सकता है",
      "തയ്യാറായിരിക്കൂ: Meta പിന്നീട് കടയോട് ബിസിനസ് സ്ഥിരീകരിക്കാൻ ആവശ്യപ്പെട്ടേക്കാം",
      "ಸಿದ್ಧರಾಗಿರಿ: Meta ನಂತರ ಅಂಗಡಿಯ ವ್ಯಾಪಾರವನ್ನು ದೃಢೀಕರಿಸಲು ಕೇಳಬಹುದು"),
    why: w(
      "Which documents Meta will accept for a small shop is not confirmed yet. Do not tell the shop that no papers will be needed.",
      "छोटी दुकान के लिए Meta कौन-से काग़ज़ मानेगा, यह अभी पक्का नहीं है। दुकान से यह मत कहिए कि कोई काग़ज़ नहीं लगेगा।",
      "ചെറിയ കടയ്ക്ക് Meta ഏതൊക്കെ രേഖകൾ സ്വീകരിക്കും എന്നത് ഇതുവരെ ഉറപ്പായിട്ടില്ല. ഒരു രേഖയും വേണ്ടിവരില്ലെന്ന് കടയോട് പറയരുത്.",
      "ಚಿಕ್ಕ ಅಂಗಡಿಗೆ Meta ಯಾವ ದಾಖಲೆಗಳನ್ನು ಒಪ್ಪುತ್ತದೆ ಎಂಬುದು ಇನ್ನೂ ಖಚಿತವಿಲ್ಲ. ಯಾವ ದಾಖಲೆಯೂ ಬೇಕಾಗುವುದಿಲ್ಲ ಎಂದು ಅಂಗಡಿಗೆ ಹೇಳಬೇಡಿ."),
  },
  {
    id: "razorpay", group: "always", optional: true,
    what: w(
      "Only if the shop has, or wants, its own Razorpay account: the owner makes it on their own phone",
      "सिर्फ़ तब जब दुकान के पास अपना Razorpay अकाउंट है या वह चाहती है: मालिक उसे अपने फ़ोन पर ख़ुद बनाते हैं",
      "കടയ്ക്ക് സ്വന്തം Razorpay അക്കൗണ്ട് ഉണ്ടെങ്കിലോ വേണമെങ്കിലോ മാത്രം: ഉടമ അത് സ്വന്തം ഫോണിൽ ഉണ്ടാക്കും",
      "ಅಂಗಡಿಗೆ ಸ್ವಂತ Razorpay ಅಕೌಂಟ್ ಇದ್ದರೆ ಅಥವಾ ಬೇಕಾದರೆ ಮಾತ್ರ: ಮಾಲೀಕರು ಅದನ್ನು ತಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ಮಾಡುತ್ತಾರೆ"),
    why: w(
      "UPI is the usual way and needs no gateway account. Razorpay's keys and codes are made by the owner and are never written in a chat or on paper.",
      "UPI सामान्य तरीक़ा है और उसके लिए गेटवे अकाउंट नहीं चाहिए। Razorpay की कुंजियाँ और कोड मालिक बनाते हैं; उन्हें चैट या काग़ज़ पर कभी मत लिखिए।",
      "UPI ആണ് സാധാരണ വഴി, അതിന് ഗേറ്റ്‌വേ അക്കൗണ്ട് വേണ്ട. Razorpay-യുടെ കീകളും കോഡുകളും ഉടമ ഉണ്ടാക്കും; അവ ചാറ്റിലോ കടലാസിലോ ഒരിക്കലും എഴുതരുത്.",
      "UPI ಸಾಮಾನ್ಯ ದಾರಿ, ಅದಕ್ಕೆ ಗೇಟ್‌ವೇ ಅಕೌಂಟ್ ಬೇಡ. Razorpay ಕೀಗಳನ್ನು ಮತ್ತು ಕೋಡ್‌ಗಳನ್ನು ಮಾಲೀಕರು ಮಾಡುತ್ತಾರೆ; ಅವನ್ನು ಚಾಟ್‌ನಲ್ಲಿ ಅಥವಾ ಕಾಗದದಲ್ಲಿ ಎಂದಿಗೂ ಬರೆಯಬೇಡಿ."),
  },
];

// ---- what each template adds --------------------------------------------------------------------------------------------

const BOOKINGS: ListItem[] = [
  {
    id: "services", group: "template",
    what: w(
      "Each service, with the name customers call it and its price",
      "हर सेवा, ग्राहक उसे जिस नाम से बुलाते हैं, और उसकी कीमत",
      "ഓരോ സേവനവും, കസ്റ്റമർമാർ അതിനെ വിളിക്കുന്ന പേരും വിലയും",
      "ಪ್ರತಿ ಸೇವೆ, ಗ್ರಾಹಕರು ಅದನ್ನು ಕರೆಯುವ ಹೆಸರು ಮತ್ತು ಅದರ ಬೆಲೆ"),
    why: w(
      "This price is also the lowest the helper will ever agree to. Ask \"What is the lowest you will ever do each service for?\" and read the list back.",
      "यह कीमत ही सबसे कम वह कीमत है जिस पर हेल्पर कभी राज़ी होगा। पूछिए: \"हर सेवा के लिए आप सबसे कम कितने में करेंगे?\" और सूची मालिक को पढ़कर सुनाइए।",
      "ഈ വില തന്നെയാണ് ഹെൽപ്പർ ഒരിക്കലും സമ്മതിക്കുന്ന ഏറ്റവും കുറഞ്ഞ വില. ചോദിക്കൂ: \"ഓരോ സേവനവും ഏറ്റവും കുറഞ്ഞത് എത്രയ്ക്ക് ചെയ്യും?\" എന്നിട്ട് പട്ടിക ഉടമയെ വായിച്ചു കേൾപ്പിക്കൂ.",
      "ಈ ಬೆಲೆಯೇ ಹೆಲ್ಪರ್ ಎಂದಿಗೂ ಒಪ್ಪುವ ಕನಿಷ್ಠ ಬೆಲೆ. ಕೇಳಿ: \"ಪ್ರತಿ ಸೇವೆಯನ್ನು ಕನಿಷ್ಠ ಎಷ್ಟಕ್ಕೆ ಮಾಡುತ್ತೀರಿ?\" ಮತ್ತು ಪಟ್ಟಿಯನ್ನು ಮಾಲೀಕರಿಗೆ ಓದಿ ಹೇಳಿ."),
  },
  {
    id: "hours", group: "template",
    what: w(
      "Opening hours, day by day",
      "खुलने का समय, दिन-दिन के हिसाब से",
      "പ്രവൃത്തി സമയം, ഓരോ ദിവസത്തിനും",
      "ತೆರೆಯುವ ಸಮಯ, ಪ್ರತಿ ದಿನದ ಪ್ರಕಾರ"),
    why: w(
      "No booking is taken outside them. Ask \"When do you take bookings?\"",
      "इनके बाहर कोई बुकिंग नहीं ली जाती। पूछिए: \"आप बुकिंग कब लेते हैं?\"",
      "ഇതിനു പുറത്ത് ബുക്കിംഗ് എടുക്കില്ല. ചോദിക്കൂ: \"ബുക്കിംഗ് എപ്പോഴൊക്കെ എടുക്കും?\"",
      "ಇದರ ಹೊರಗೆ ಬುಕಿಂಗ್ ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ. ಕೇಳಿ: \"ಬುಕಿಂಗ್ ಯಾವಾಗ ತೆಗೆದುಕೊಳ್ಳುತ್ತೀರಿ?\""),
  },
  {
    id: "deposit", group: "template",
    what: w(
      "The deposit that holds a booking",
      "बुकिंग रोकने वाली जमा राशि",
      "ബുക്കിംഗ് പിടിച്ചുവയ്ക്കാനുള്ള അഡ്വാൻസ്",
      "ಬುಕಿಂಗ್ ಹಿಡಿದಿಡುವ ಮುಂಗಡ ಹಣ"),
    why: w(
      "A whole number of rupees. Ask \"How much to hold a booking?\"",
      "पूरे रुपयों में। पूछिए: \"बुकिंग रोकने के लिए कितना?\"",
      "മുഴുവൻ രൂപയിൽ. ചോദിക്കൂ: \"ബുക്കിംഗ് പിടിച്ചുവയ്ക്കാൻ എത്ര?\"",
      "ಪೂರ್ಣ ರೂಪಾಯಿಗಳಲ್ಲಿ. ಕೇಳಿ: \"ಬುಕಿಂಗ್ ಹಿಡಿದಿಡಲು ಎಷ್ಟು?\""),
  },
  {
    id: "hold-time", group: "template",
    what: w(
      "How long a slot is kept while the deposit comes",
      "जमा राशि आने तक स्लॉट कितनी देर रोका जाए",
      "അഡ്വാൻസ് വരുന്നതുവരെ സ്ലോട്ട് എത്ര നേരം പിടിച്ചുവയ്ക്കണം",
      "ಮುಂಗಡ ಹಣ ಬರುವವರೆಗೆ ಸ್ಲಾಟ್ ಅನ್ನು ಎಷ್ಟು ಹೊತ್ತು ಹಿಡಿದಿಡಬೇಕು"),
    why: w(
      "Ask \"How long do we keep a slot for the deposit?\"",
      "पूछिए: \"जमा राशि के लिए हम स्लॉट कितनी देर रोकें?\"",
      "ചോദിക്കൂ: \"അഡ്വാൻസിനായി സ്ലോട്ട് എത്ര നേരം പിടിച്ചുവയ്ക്കണം?\"",
      "ಕೇಳಿ: \"ಮುಂಗಡ ಹಣಕ್ಕಾಗಿ ಸ್ಲಾಟ್ ಅನ್ನು ಎಷ್ಟು ಹೊತ್ತು ಹಿಡಿದಿಡಬೇಕು?\""),
  },
  {
    id: "cancellation", group: "template",
    what: w(
      "How early a customer must cancel to get the deposit back",
      "जमा राशि लौटाने के लिए ग्राहक को कितना पहले रद्द करना होगा",
      "അഡ്വാൻസ് തിരികെ കിട്ടാൻ കസ്റ്റമർ എത്ര നേരത്തെ റദ്ദാക്കണം",
      "ಮುಂಗಡ ಹಣ ವಾಪಸ್ ಸಿಗಲು ಗ್ರಾಹಕರು ಎಷ್ಟು ಮೊದಲು ರದ್ದು ಮಾಡಬೇಕು"),
    why: w(
      "A later cancellation is the owner's decision.",
      "इससे देर से रद्द करने पर फ़ैसला मालिक का होता है।",
      "ഇതിലും വൈകിയുള്ള റദ്ദാക്കൽ ഉടമയുടെ തീരുമാനമാണ്.",
      "ಇದಕ್ಕಿಂತ ತಡವಾದ ರದ್ದತಿ ಮಾಲೀಕರ ತೀರ್ಮಾನ."),
  },
  {
    id: "refund-limit", group: "template",
    what: w(
      "The most the helper may give back without asking the owner",
      "आपसे पूछे बिना हेल्पर ज़्यादा से ज़्यादा कितना लौटा सकता है",
      "ഉടമയോട് ചോദിക്കാതെ ഹെൽപ്പർക്ക് ഏറ്റവും കൂടുതൽ എത്ര തിരികെ കൊടുക്കാം",
      "ಮಾಲೀಕರನ್ನು ಕೇಳದೆ ಹೆಲ್ಪರ್ ಗರಿಷ್ಠ ಎಷ್ಟು ವಾಪಸ್ ಕೊಡಬಹುದು"),
    why: w(
      "Above this amount a refund waits for the owner's yes.",
      "इस रकम से ऊपर रिफंड मालिक की हाँ का इंतज़ार करता है।",
      "ഈ തുകയ്ക്ക് മുകളിലുള്ള റീഫണ്ട് ഉടമയുടെ സമ്മതത്തിനായി കാത്തിരിക്കും.",
      "ಈ ಮೊತ್ತಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್ ಮಾಲೀಕರ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತದೆ."),
  },
  {
    id: "calendar", group: "template", optional: true,
    what: w(
      "Google Calendar, only if the shop wants it: the owner's calendar, shared with the address Geometer gives you",
      "Google Calendar, सिर्फ़ तब जब दुकान चाहे: मालिक का कैलेंडर, उस पते के साथ शेयर किया हुआ जो Geometer देता है",
      "Google Calendar, കടയ്ക്ക് വേണമെങ്കിൽ മാത്രം: ഉടമയുടെ കലണ്ടർ, Geometer തരുന്ന വിലാസവുമായി ഷെയർ ചെയ്തത്",
      "Google Calendar, ಅಂಗಡಿಗೆ ಬೇಕಾದರೆ ಮಾತ್ರ: ಮಾಲೀಕರ ಕ್ಯಾಲೆಂಡರ್, Geometer ಕೊಡುವ ವಿಳಾಸಕ್ಕೆ ಶೇರ್ ಮಾಡಿದ್ದು"),
    why: w(
      "Not needed to start. Bookings keeps its own booking list: the owner sends \"today\" or \"tomorrow\" on WhatsApp to the shop's number to see that day's bookings. A calendar can be added later, and the bookings already made are written to it.",
      "शुरू करने के लिए ज़रूरी नहीं। बुकिंग अपनी ख़ुद की बुकिंग सूची रखती है: मालिक दुकान के नंबर पर WhatsApp में \"today\" या \"tomorrow\" भेजकर उस दिन की बुकिंग देख सकते हैं। कैलेंडर बाद में जोड़ा जा सकता है, और पहले हो चुकी बुकिंग उसमें लिख दी जाती हैं।",
      "തുടങ്ങാൻ ആവശ്യമില്ല. ബുക്കിംഗ് സ്വന്തം ബുക്കിംഗ് പട്ടിക സൂക്ഷിക്കും: ഉടമ കടയുടെ നമ്പറിലേക്ക് WhatsApp-ൽ \"today\" അല്ലെങ്കിൽ \"tomorrow\" അയച്ചാൽ ആ ദിവസത്തെ ബുക്കിംഗുകൾ കാണാം. കലണ്ടർ പിന്നീട് ചേർക്കാം, നേരത്തേ നടന്ന ബുക്കിംഗുകൾ അതിൽ എഴുതിച്ചേർക്കും.",
      "ಆರಂಭಿಸಲು ಬೇಕಿಲ್ಲ. ಬುಕಿಂಗ್ ತನ್ನದೇ ಬುಕಿಂಗ್ ಪಟ್ಟಿ ಇಟ್ಟುಕೊಳ್ಳುತ್ತದೆ: ಮಾಲೀಕರು ಅಂಗಡಿಯ ನಂಬರ್‌ಗೆ WhatsApp ನಲ್ಲಿ \"today\" ಅಥವಾ \"tomorrow\" ಕಳುಹಿಸಿದರೆ ಆ ದಿನದ ಬುಕಿಂಗ್‌ಗಳು ಕಾಣುತ್ತವೆ. ಕ್ಯಾಲೆಂಡರ್ ಅನ್ನು ನಂತರ ಸೇರಿಸಬಹುದು, ಈಗಾಗಲೇ ಆದ ಬುಕಿಂಗ್‌ಗಳನ್ನು ಅದರಲ್ಲಿ ಬರೆಯಲಾಗುತ್ತದೆ."),
  },
];

const ORDERS: ListItem[] = [
  {
    id: "menu", group: "template",
    what: w(
      "Each item: the names customers use (in Hindi, English, Malayalam or Kannada), its price in whole rupees, and the most the kitchen makes in a day",
      "हर आइटम: ग्राहक जिन नामों से बुलाते हैं (हिंदी, अंग्रेज़ी, मलयालम या कन्नड़ में), पूरे रुपयों में दाम, और रसोई एक दिन में ज़्यादा से ज़्यादा कितना बनाती है",
      "ഓരോ ഐറ്റവും: കസ്റ്റമർമാർ വിളിക്കുന്ന പേരുകൾ (ഹിന്ദി, ഇംഗ്ലീഷ്, മലയാളം അല്ലെങ്കിൽ കന്നഡ), മുഴുവൻ രൂപയിൽ വില, അടുക്കള ഒരു ദിവസം പരമാവധി എത്ര ഉണ്ടാക്കും",
      "ಪ್ರತಿ ಐಟಂ: ಗ್ರಾಹಕರು ಕರೆಯುವ ಹೆಸರುಗಳು (ಹಿಂದಿ, ಇಂಗ್ಲಿಷ್, ಮಲಯಾಳಂ ಅಥವಾ ಕನ್ನಡದಲ್ಲಿ), ಪೂರ್ಣ ರೂಪಾಯಿಗಳಲ್ಲಿ ಬೆಲೆ, ಮತ್ತು ಅಡುಗೆಮನೆ ದಿನಕ್ಕೆ ಗರಿಷ್ಠ ಎಷ್ಟು ಮಾಡುತ್ತದೆ"),
    why: w(
      "The price is also the lowest the helper will ever agree to. Ask the owner to read the list back.",
      "यह दाम ही सबसे कम वह दाम है जिस पर हेल्पर कभी राज़ी होगा। मालिक से सूची पढ़कर सुनाने को कहिए।",
      "ഈ വില തന്നെയാണ് ഹെൽപ്പർ ഒരിക്കലും സമ്മതിക്കുന്ന ഏറ്റവും കുറഞ്ഞ വില. പട്ടിക വായിച്ചു കേൾപ്പിക്കാൻ ഉടമയോട് പറയൂ.",
      "ಈ ಬೆಲೆಯೇ ಹೆಲ್ಪರ್ ಎಂದಿಗೂ ಒಪ್ಪುವ ಕನಿಷ್ಠ ಬೆಲೆ. ಪಟ್ಟಿಯನ್ನು ಓದಿ ಹೇಳಲು ಮಾಲೀಕರಿಗೆ ಹೇಳಿ."),
  },
  {
    id: "cutoff", group: "template",
    what: w(
      "When orders close (the cut-off)",
      "ऑर्डर कब बंद होते हैं (कट-ऑफ़)",
      "ഓർഡർ എപ്പോൾ നിർത്തും (കട്ട്-ഓഫ്)",
      "ಆರ್ಡರ್ ಯಾವಾಗ ಮುಚ್ಚುತ್ತದೆ (ಕೊನೆಯ ಸಮಯ)"),
    why: w(
      "For the day, or for each slot. Ask \"When do orders close?\"",
      "पूरे दिन के लिए, या हर स्लॉट के लिए। पूछिए: \"ऑर्डर कब बंद होते हैं?\"",
      "ദിവസത്തിനോ ഓരോ സ്ലോട്ടിനോ. ചോദിക്കൂ: \"ഓർഡർ എപ്പോൾ നിർത്തും?\"",
      "ದಿನಕ್ಕೆ ಅಥವಾ ಪ್ರತಿ ಸ್ಲಾಟ್‌ಗೆ. ಕೇಳಿ: \"ಆರ್ಡರ್ ಯಾವಾಗ ಮುಚ್ಚುತ್ತದೆ?\""),
  },
  {
    id: "slots", group: "template",
    what: w(
      "When customers can collect an order, and when the shop can deliver",
      "ग्राहक ऑर्डर कब लेने आ सकते हैं, और दुकान डिलीवरी कब कर सकती है",
      "കസ്റ്റമർമാർക്ക് ഓർഡർ എപ്പോൾ എടുക്കാം, കടയ്ക്ക് എപ്പോൾ എത്തിക്കാം",
      "ಗ್ರಾಹಕರು ಆರ್ಡರ್ ಅನ್ನು ಯಾವಾಗ ಬಂದು ತೆಗೆದುಕೊಳ್ಳಬಹುದು, ಮತ್ತು ಅಂಗಡಿ ಯಾವಾಗ ಡೆಲಿವರಿ ಮಾಡಬಹುದು"),
    why: w(
      "Ask \"When can customers collect or get it delivered?\"",
      "पूछिए: \"ग्राहक कब लेने आ सकते हैं या डिलीवरी कब हो सकती है?\"",
      "ചോദിക്കൂ: \"കസ്റ്റമർമാർക്ക് എപ്പോൾ എടുക്കാം അല്ലെങ്കിൽ എപ്പോൾ എത്തിക്കാം?\"",
      "ಕೇಳಿ: \"ಗ್ರಾಹಕರು ಯಾವಾಗ ಬಂದು ತೆಗೆದುಕೊಳ್ಳಬಹುದು ಅಥವಾ ಡೆಲಿವರಿ ಪಡೆಯಬಹುದು?\""),
  },
  {
    id: "delivery-area", group: "template", optional: true,
    what: w(
      "Only if the shop delivers: the places it delivers to",
      "सिर्फ़ तब जब दुकान डिलीवरी करती है: वे जगहें जहाँ वह डिलीवरी करती है",
      "കട എത്തിക്കുന്നുണ്ടെങ്കിൽ മാത്രം: എത്തിക്കുന്ന സ്ഥലങ്ങൾ",
      "ಅಂಗಡಿ ಡೆಲಿವರಿ ಮಾಡುತ್ತಿದ್ದರೆ ಮಾತ್ರ: ಡೆಲಿವರಿ ಮಾಡುವ ಸ್ಥಳಗಳು"),
    why: w(
      "An address that names none of them is not delivered to.",
      "जिस पते में इनमें से कोई जगह नहीं है, वहाँ डिलीवरी नहीं होती।",
      "ഇവയിലൊന്നും പറയാത്ത വിലാസത്തിലേക്ക് എത്തിക്കില്ല.",
      "ಇವುಗಳಲ್ಲಿ ಯಾವುದನ್ನೂ ಹೆಸರಿಸದ ವಿಳಾಸಕ್ಕೆ ಡೆಲಿವರಿ ಮಾಡುವುದಿಲ್ಲ."),
  },
  {
    id: "advance", group: "template",
    what: w(
      "How much a customer pays to confirm an order (all of it or a part), and how long an order is held for the payment",
      "ऑर्डर पक्का करने के लिए ग्राहक कितना देता है (पूरा या कुछ हिस्सा), और भुगतान के लिए ऑर्डर कितनी देर रोका जाता है",
      "ഓർഡർ ഉറപ്പിക്കാൻ കസ്റ്റമർ എത്ര അടയ്ക്കണം (മുഴുവനും അല്ലെങ്കിൽ ഒരു ഭാഗം), പണത്തിനായി ഓർഡർ എത്ര നേരം പിടിച്ചുവയ്ക്കും",
      "ಆರ್ಡರ್ ಖಚಿತಪಡಿಸಲು ಗ್ರಾಹಕರು ಎಷ್ಟು ಕಟ್ಟಬೇಕು (ಪೂರ್ತಿ ಅಥವಾ ಒಂದು ಭಾಗ), ಮತ್ತು ಹಣಕ್ಕಾಗಿ ಆರ್ಡರ್ ಅನ್ನು ಎಷ್ಟು ಹೊತ್ತು ಹಿಡಿದಿಡಲಾಗುತ್ತದೆ"),
    why: w(
      "The advance. Ask \"How much must a customer pay to confirm? All, or a part?\"",
      "एडवांस। पूछिए: \"पक्का करने के लिए ग्राहक को कितना देना होगा? पूरा या कुछ हिस्सा?\"",
      "അഡ്വാൻസ്. ചോദിക്കൂ: \"ഉറപ്പിക്കാൻ ഒരു കസ്റ്റമർ എത്ര അടയ്ക്കണം? മുഴുവനും, അതോ ഒരു ഭാഗമോ?\"",
      "ಅಡ್ವಾನ್ಸ್. ಕೇಳಿ: \"ಖಚಿತಪಡಿಸಲು ಗ್ರಾಹಕರು ಎಷ್ಟು ಕಟ್ಟಬೇಕು? ಪೂರ್ತಿ, ಅಥವಾ ಒಂದು ಭಾಗ?\""),
  },
  {
    id: "day-limits", group: "template",
    what: w(
      "The most orders in a day, and the most items in one order",
      "एक दिन में ज़्यादा से ज़्यादा कितने ऑर्डर, और एक ऑर्डर में कितने आइटम",
      "ഒരു ദിവസം പരമാവധി എത്ര ഓർഡർ, ഒരു ഓർഡറിൽ എത്ര ഐറ്റം",
      "ದಿನಕ್ಕೆ ಗರಿಷ್ಠ ಎಷ್ಟು ಆರ್ಡರ್, ಮತ್ತು ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ಎಷ್ಟು ಐಟಂ"),
    why: w(
      "The helper never confirms an order past them.",
      "इनसे आगे हेल्पर कोई ऑर्डर पक्का नहीं करता।",
      "ഇതിനപ്പുറം ഹെൽപ്പർ ഒരു ഓർഡറും ഉറപ്പിക്കില്ല.",
      "ಇದನ್ನು ಮೀರಿ ಹೆಲ್ಪರ್ ಯಾವ ಆರ್ಡರ್ ಅನ್ನೂ ಖಚಿತಪಡಿಸುವುದಿಲ್ಲ."),
  },
  {
    id: "cancellation", group: "template",
    what: w(
      "Until when a customer can cancel and get the advance back",
      "ग्राहक कब तक रद्द करके एडवांस वापस पा सकता है",
      "റീഫണ്ടിനായി കസ്റ്റമർക്ക് എപ്പോൾ വരെ റദ്ദാക്കാം",
      "ರೀಫಂಡ್‌ಗಾಗಿ ಗ್ರಾಹಕರು ಯಾವಾಗಿನವರೆಗೆ ರದ್ದು ಮಾಡಬಹುದು"),
    why: w(
      "A later cancellation is the owner's decision.",
      "इससे देर से रद्द करने पर फ़ैसला मालिक का होता है।",
      "ഇതിലും വൈകിയുള്ള റദ്ദാക്കൽ ഉടമയുടെ തീരുമാനമാണ്.",
      "ಇದಕ್ಕಿಂತ ತಡವಾದ ರದ್ದತಿ ಮಾಲೀಕರ ತೀರ್ಮಾನ."),
  },
  {
    id: "refund-limit", group: "template",
    what: w(
      "The amount above which a refund waits for the owner",
      "वह रकम जिससे ऊपर रिफंड को मालिक का इंतज़ार करना होगा",
      "ഇതിനു മുകളിൽ റീഫണ്ട് ഉടമയ്ക്കായി കാത്തിരിക്കേണ്ട തുക",
      "ಇದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೀಫಂಡ್ ಮಾಲೀಕರಿಗಾಗಿ ಕಾಯಬೇಕಾದ ಮೊತ್ತ"),
    why: w(
      "A refund is never more than the advance paid.",
      "रिफंड कभी चुकाए गए एडवांस से ज़्यादा नहीं होता।",
      "റീഫണ്ട് ഒരിക്കലും അടച്ച അഡ്വാൻസിനേക്കാൾ കൂടില്ല.",
      "ರೀಫಂಡ್ ಎಂದಿಗೂ ಕಟ್ಟಿದ ಅಡ್ವಾನ್ಸ್‌ಗಿಂತ ಹೆಚ್ಚಿರುವುದಿಲ್ಲ."),
  },
  {
    id: "approval-line", group: "template",
    what: w(
      "The order total above which the owner wants to say yes first",
      "ऑर्डर की वह कुल रकम जिससे ऊपर मालिक पहले हाँ कहना चाहते हैं",
      "ഏത് ഓർഡർ തുകയ്ക്ക് മുകളിൽ ഉടമ ആദ്യം ശരി പറയണം",
      "ಯಾವ ಆರ್ಡರ್ ಮೊತ್ತದ ಮೇಲೆ ಮಾಲೀಕರು ಮೊದಲು ಹೌದು ಎನ್ನಲು ಬಯಸುತ್ತಾರೆ"),
    why: w(
      "Above it, the order waits for the owner before any payment is asked.",
      "इससे ऊपर के ऑर्डर में किसी भुगतान को माँगने से पहले मालिक का इंतज़ार होता है।",
      "ഇതിനു മുകളിൽ, പണം ചോദിക്കുന്നതിന് മുമ്പ് ഓർഡർ ഉടമയ്ക്കായി കാത്തിരിക്കും.",
      "ಇದಕ್ಕಿಂತ ಹೆಚ್ಚಿದ್ದರೆ, ಯಾವುದೇ ಹಣ ಕೇಳುವ ಮೊದಲು ಆರ್ಡರ್ ಮಾಲೀಕರಿಗಾಗಿ ಕಾಯುತ್ತದೆ."),
  },
];

const FEES: ListItem[] = [
  {
    id: "students", group: "template",
    what: w(
      "For each child: the name, the class, the parent's WhatsApp number and the parent's language",
      "हर बच्चे के लिए: नाम, क्लास, अभिभावक का WhatsApp नंबर और अभिभावक की भाषा",
      "ഓരോ കുട്ടിക്കും: പേര്, ക്ലാസ്, രക്ഷിതാവിന്റെ WhatsApp നമ്പർ, രക്ഷിതാവിന്റെ ഭാഷ",
      "ಪ್ರತಿ ಮಗುವಿಗೆ: ಹೆಸರು, ತರಗತಿ, ಪೋಷಕರ WhatsApp ನಂಬರ್ ಮತ್ತು ಪೋಷಕರ ಭಾಷೆ"),
    why: w(
      "The language is Hindi, English, Malayalam or Kannada. The list is the owner's: don't keep a copy on your own phone.",
      "भाषा हिंदी, अंग्रेज़ी, मलयालम या कन्नड़ है। यह सूची मालिक की है: इसकी कॉपी अपने फ़ोन पर मत रखिए।",
      "ഭാഷ ഹിന്ദി, ഇംഗ്ലീഷ്, മലയാളം അല്ലെങ്കിൽ കന്നഡ ആണ്. ഈ പട്ടിക ഉടമയുടേതാണ്: നിങ്ങളുടെ ഫോണിൽ ഒരു കോപ്പി സൂക്ഷിക്കരുത്.",
      "ಭಾಷೆ ಹಿಂದಿ, ಇಂಗ್ಲಿಷ್, ಮಲಯಾಳಂ ಅಥವಾ ಕನ್ನಡ. ಈ ಪಟ್ಟಿ ಮಾಲೀಕರದ್ದು: ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ಪ್ರತಿ ಇಟ್ಟುಕೊಳ್ಳಬೇಡಿ."),
  },
  {
    id: "class-fee", group: "template",
    what: w(
      "The monthly fee for each class",
      "हर क्लास की महीने की फीस",
      "ഓരോ ക്ലാസിന്റെയും മാസ ഫീസ്",
      "ಪ್ರತಿ ತರಗತಿಯ ತಿಂಗಳ ಶುಲ್ಕ"),
    why: w(
      "In whole rupees. Ask \"What is the monthly fee for each class?\"",
      "पूरे रुपयों में। पूछिए: \"हर क्लास की महीने की फीस कितनी है?\"",
      "മുഴുവൻ രൂപയിൽ. ചോദിക്കൂ: \"ഓരോ ക്ലാസിന്റെയും മാസ ഫീസ് എത്രയാണ്?\"",
      "ಪೂರ್ಣ ರೂಪಾಯಿಗಳಲ್ಲಿ. ಕೇಳಿ: \"ಪ್ರತಿ ತರಗತಿಯ ತಿಂಗಳ ಶುಲ್ಕ ಎಷ್ಟು?\""),
  },
  {
    id: "due-day", group: "template",
    what: w(
      "The day of the month the fee is due, and how many days after it a payment is still on time",
      "महीने की वह तारीख़ जब फीस देय है, और उसके कितने दिन बाद तक भुगतान समय पर माना जाता है",
      "മാസത്തിലെ ഏത് ദിവസമാണ് ഫീസ് അടയ്ക്കേണ്ടത്, അതിനുശേഷം എത്ര ദിവസം വരെ പേയ്മെന്റ് സമയത്താണെന്ന് കണക്കാക്കും",
      "ತಿಂಗಳ ಯಾವ ದಿನ ಶುಲ್ಕ ಕಟ್ಟಬೇಕು, ಮತ್ತು ಅದಾದ ಮೇಲೆ ಎಷ್ಟು ದಿನ ಪಾವತಿಯನ್ನು ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಎಂದು ಪರಿಗಣಿಸಲಾಗುತ್ತದೆ"),
    why: w(
      "Ask \"On which day of the month is the fee due?\" and \"For how many days after that is a payment still on time?\"",
      "पूछिए: \"फीस महीने की किस तारीख़ को देय है?\" और \"उसके बाद कितने दिन तक भुगतान समय पर माना जाता है?\"",
      "ചോദിക്കൂ: \"മാസത്തിലെ ഏത് ദിവസമാണ് ഫീസ് അടയ്ക്കേണ്ടത്?\" എന്നും \"അതിനുശേഷം എത്ര ദിവസം വരെ പേയ്മെന്റ് സമയത്താണെന്ന് കണക്കാക്കും?\" എന്നും",
      "ಕೇಳಿ: \"ತಿಂಗಳ ಯಾವ ದಿನ ಶುಲ್ಕ ಕಟ್ಟಬೇಕು?\" ಮತ್ತು \"ಅದಾದ ಮೇಲೆ ಎಷ್ಟು ದಿನ ಪಾವತಿಯನ್ನು ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಎಂದು ಪರಿಗಣಿಸುತ್ತೀರಿ?\""),
  },
  {
    id: "late-fee", group: "template",
    what: w(
      "Whether the centre adds a late fee, and how much",
      "क्या केंद्र देर की फीस जोड़ता है, और कितनी",
      "വൈകിയ ഫീസ് ചേർക്കാറുണ്ടോ, എത്ര",
      "ತಡ ಶುಲ್ಕ ಸೇರಿಸುತ್ತಾರೆಯೇ, ಮತ್ತು ಎಷ್ಟು"),
    why: w(
      "None is a fine answer. A parent who sent STOP is never charged one.",
      "कोई नहीं भी ठीक जवाब है। जिस अभिभावक ने STOP भेजा है, उससे यह कभी नहीं ली जाती।",
      "ഇല്ല എന്നതും ശരിയായ ഉത്തരമാണ്. STOP അയച്ച രക്ഷിതാവിനോട് ഇത് ഒരിക്കലും ഈടാക്കില്ല.",
      "ಇಲ್ಲ ಎಂಬುದೂ ಸರಿಯಾದ ಉತ್ತರ. STOP ಕಳುಹಿಸಿದ ಪೋಷಕರಿಂದ ಇದನ್ನು ಎಂದಿಗೂ ವಸೂಲಿ ಮಾಡುವುದಿಲ್ಲ."),
  },
  {
    id: "reminders", group: "template",
    what: w(
      "When parents should be reminded",
      "अभिभावकों को कब याद दिलाई जाए",
      "രക്ഷിതാക്കളെ എപ്പോഴൊക്കെ ഓർമ്മിപ്പിക്കണം",
      "ಪೋಷಕರಿಗೆ ಯಾವಾಗ ನೆನಪು ಕಳುಹಿಸಬೇಕು"),
    why: w(
      "The days before and after the due day, the hour, and the most reminders for one child in a month.",
      "देय तारीख़ से पहले और बाद के दिन, समय का घंटा, और एक बच्चे के लिए एक महीने में ज़्यादा से ज़्यादा कितनी याद।",
      "അവസാന തീയതിക്ക് മുമ്പും ശേഷവുമുള്ള ദിവസങ്ങൾ, സമയം, ഒരു കുട്ടിക്ക് ഒരു മാസം പരമാവധി എത്ര ഓർമ്മപ്പെടുത്തൽ.",
      "ಕೊನೆಯ ದಿನಾಂಕದ ಮೊದಲು ಮತ್ತು ನಂತರದ ದಿನಗಳು, ಸಮಯ, ಮತ್ತು ಒಂದು ಮಗುವಿಗೆ ತಿಂಗಳಲ್ಲಿ ಗರಿಷ್ಠ ಎಷ್ಟು ನೆನಪುಗಳು."),
  },
  {
    id: "part-payments", group: "template",
    what: w(
      "Whether a parent may pay part of the fee, and from how much",
      "क्या अभिभावक फीस का कुछ हिस्सा भर सकता है, और कितने से",
      "ഫീസിന്റെ ഒരു ഭാഗം രക്ഷിതാവിന് അടയ്ക്കാമോ, എത്ര മുതൽ",
      "ಪೋಷಕರು ಶುಲ್ಕದ ಒಂದು ಭಾಗವನ್ನು ಕಟ್ಟಬಹುದೇ, ಮತ್ತು ಎಷ್ಟರಿಂದ"),
    why: w(
      "Ask \"May a parent pay part of the fee? From how much?\"",
      "पूछिए: \"क्या अभिभावक फीस का कुछ हिस्सा भर सकता है? कितने से?\"",
      "ചോദിക്കൂ: \"ഫീസിന്റെ ഒരു ഭാഗം രക്ഷിതാവിന് അടയ്ക്കാമോ? എത്ര മുതൽ?\"",
      "ಕೇಳಿ: \"ಪೋಷಕರು ಶುಲ್ಕದ ಒಂದು ಭಾಗವನ್ನು ಕಟ್ಟಬಹುದೇ? ಎಷ್ಟರಿಂದ?\""),
  },
  {
    id: "waiver-limit", group: "template",
    what: w(
      "How much the helper may take off one child's month by itself",
      "हेल्पर एक बच्चे के एक महीने में ख़ुद कितनी छूट दे सकता है",
      "ഒരു കുട്ടിക്ക് ഒരു മാസം ഹെൽപ്പർക്ക് തനിയെ എത്ര ഇളവ് നൽകാം",
      "ಒಬ್ಬ ಮಗುವಿಗೆ ಒಂದು ತಿಂಗಳಲ್ಲಿ ಹೆಲ್ಪರ್ ತಾನಾಗಿ ಎಷ್ಟು ಕಡಿಮೆ ಮಾಡಬಹುದು"),
    why: w(
      "Above this, it asks the owner.",
      "इससे ऊपर यह मालिक से पूछता है।",
      "ഇതിനു മുകളിൽ ഇത് ഉടമയോട് ചോദിക്കും.",
      "ಇದಕ್ಕಿಂತ ಹೆಚ್ಚಿಗೆ ಇದು ಮಾಲೀಕರನ್ನು ಕೇಳುತ್ತದೆ."),
  },
  {
    id: "refund-limit", group: "template",
    what: w(
      "The amount from which a refund needs the owner's one-use code",
      "वह रकम जिससे रिफंड के लिए मालिक का एक बार चलने वाला कोड चाहिए",
      "ഏത് തുകയ്ക്ക് മുകളിലുള്ള റീഫണ്ടിന് ഉടമയുടെ ഒരു തവണ ഉപയോഗിക്കാവുന്ന കോഡ് വേണം",
      "ಯಾವ ಮೊತ್ತದಿಂದ ರೀಫಂಡ್‌ಗೆ ಮಾಲೀಕರ ಒಮ್ಮೆ ಬಳಸುವ ಕೋಡ್ ಬೇಕು"),
    why: w(
      "A refund is never more than the payment on record.",
      "रिफंड कभी रिकॉर्ड में दर्ज भुगतान से ज़्यादा नहीं होता।",
      "റീഫണ്ട് ഒരിക്കലും രേഖയിലുള്ള പേയ്മെന്റിനേക്കാൾ കൂടില്ല.",
      "ರೀಫಂಡ್ ಎಂದಿಗೂ ದಾಖಲೆಯಲ್ಲಿರುವ ಪಾವತಿಗಿಂತ ಹೆಚ್ಚಿರುವುದಿಲ್ಲ."),
  },
];

/** The whole list: every shop's items first, then the template's own. */
export const LIST: Record<CardTemplate, ListItem[]> = {
  bookings: [...ALWAYS, ...BOOKINGS],
  orders: [...ALWAYS, ...ORDERS],
  fees: [...ALWAYS, ...FEES],
};

// ---- the words around the list --------------------------------------------------------------------------------------------

/** What each template is called on the card (the word the sell guide uses for it). */
export const TEMPLATE_NAMES: Record<CardTemplate, Words> = {
  bookings: w("Bookings", "बुकिंग", "ബുക്കിംഗ്", "ಬುಕಿಂಗ್"),
  orders: w("Orders", "ऑर्डर", "ഓർഡർ", "ಆರ್ಡರ್"),
  fees: w("Fees", "फीस", "ഫീസ്", "ಶುಲ್ಕ"),
};

export const TITLE: Words = w("What to ask the shop for", "दुकान से क्या माँगना है", "കടയോട് എന്തൊക്കെ ചോദിക്കണം", "ಅಂಗಡಿಯಿಂದ ಏನು ಕೇಳಬೇಕು");

export const INTRO: Words = w(
  "Take this to the visit and tick each item with the owner. Ask for these and nothing more. An item marked optional is only for a shop that wants it.",
  "इसे विज़िट पर ले जाइए और हर चीज़ मालिक के साथ टिक कीजिए। बस यही माँगिए, इससे ज़्यादा कुछ नहीं। \"वैकल्पिक\" वाली चीज़ सिर्फ़ उस दुकान के लिए है जो उसे चाहती है।",
  "ഇത് സന്ദർശനത്തിന് കൊണ്ടുപോകൂ, ഓരോന്നും ഉടമയോടൊപ്പം ടിക്ക് ചെയ്യൂ. ഇവ മാത്രം ചോദിക്കൂ, കൂടുതൽ ഒന്നും വേണ്ട. \"ഓപ്ഷണൽ\" എന്ന് അടയാളപ്പെടുത്തിയത് അത് വേണ്ട കടയ്ക്ക് മാത്രമാണ്.",
  "ಇದನ್ನು ಭೇಟಿಗೆ ತೆಗೆದುಕೊಂಡು ಹೋಗಿ, ಪ್ರತಿಯೊಂದನ್ನೂ ಮಾಲೀಕರ ಜೊತೆ ಟಿಕ್ ಮಾಡಿ. ಇವನ್ನು ಮಾತ್ರ ಕೇಳಿ, ಹೆಚ್ಚೇನೂ ಬೇಡ. \"ಐಚ್ಛಿಕ\" ಎಂದು ಗುರುತಿಸಿದ್ದು ಅದು ಬೇಕಾದ ಅಂಗಡಿಗೆ ಮಾತ್ರ.");

/** The tag in front of an optional item. */
export const OPTIONAL_LABEL: Words = w("Optional", "वैकल्पिक", "ഓപ്ഷണൽ", "ಐಚ್ಛಿಕ");

export const HEADS: Record<"always" | "template", Words> = {
  always: w("Every shop", "हर दुकान से", "എല്ലാ കടകളിൽ നിന്നും", "ಪ್ರತಿ ಅಂಗಡಿಯಿಂದ"),
  template: w("For this template", "इस टेम्पलेट के लिए", "ഈ ടെംപ്ലേറ്റിന്", "ಈ ಟೆಂಪ್ಲೇಟ್‌ಗೆ"),
};

/** The line under the list: what the partner must not promise. */
export const NOTE: Words = w(
  "Do not promise how long setup takes, or that nothing else will be asked for. Meta decides what it needs, and it can change.",
  "यह मत वादा कीजिए कि सेटअप में कितना समय लगेगा, या कि और कुछ नहीं माँगा जाएगा। क्या चाहिए, यह Meta तय करता है, और वह बदल सकता है।",
  "സെറ്റപ്പിന് എത്ര സമയമെടുക്കുമെന്നോ മറ്റൊന്നും ചോദിക്കില്ലെന്നോ വാഗ്ദാനം ചെയ്യരുത്. എന്താണ് വേണ്ടതെന്ന് Meta തീരുമാനിക്കും, അത് മാറുകയും ചെയ്യാം.",
  "ಸೆಟಪ್‌ಗೆ ಎಷ್ಟು ಸಮಯ ಬೇಕು, ಅಥವಾ ಬೇರೇನೂ ಕೇಳುವುದಿಲ್ಲ ಎಂದು ಮಾತು ಕೊಡಬೇಡಿ. ಏನು ಬೇಕು ಎಂದು Meta ತೀರ್ಮಾನಿಸುತ್ತದೆ, ಮತ್ತು ಅದು ಬದಲಾಗಬಹುದು.");

// ---- the machine-written marker --------------------------------------------------------------------------------------------

/**
 * Hindi, Malayalam and Kannada are machine-written until a native reader has signed them off. This is the same state as REVIEW_STATE in bundle/panel/languages.ts (a test
 * compares the two); it lives here because modules/ does not import bundle/. Change a marker only when a named reader has signed the review sheet.
 */
export const CARD_REVIEW_STATE: Record<Language, "source" | "machine-written"> = { en: "source", hi: "machine-written", ml: "machine-written", kn: "machine-written" };

/** The day the machine-written wording was made. */
export const CARD_WRITTEN = "12 November 2026";

/** The banner above a machine-written card: the English line every guide uses, then the same in the card's language. */
export const REVIEW_BANNER: Record<Language, string[]> = {
  en: [],
  hi: [
    `**Machine-written (${CARD_WRITTEN}). Needs review by a native speaker before partners or shops rely on it.**`,
    `मशीन से लिखा गया (${CARD_WRITTEN})। किसी पार्टनर या दुकान के इस पर भरोसा करने से पहले किसी हिंदी मातृभाषी से जँचवाना ज़रूरी है।`,
  ],
  ml: [
    `**Machine-written (${CARD_WRITTEN}). Needs review by a native speaker before partners or shops rely on it.**`,
    `യന്ത്രം എഴുതിയത് (${CARD_WRITTEN}). പാർട്ണർമാരോ കടകളോ ഇത് ആശ്രയിക്കുന്നതിന് മുമ്പ് ഒരു മലയാളം മാതൃഭാഷക്കാരൻ പരിശോധിക്കണം.`,
  ],
  kn: [
    `**Machine-written (${CARD_WRITTEN}). Needs review by a native speaker before partners or shops rely on it.**`,
    `ಯಂತ್ರ ಬರೆದದ್ದು (${CARD_WRITTEN}). ಪಾರ್ಟ್ನರ್‌ಗಳು ಅಥವಾ ಅಂಗಡಿಗಳು ಇದನ್ನು ನಂಬುವ ಮೊದಲು ಕನ್ನಡ ಮಾತೃಭಾಷಿಕರೊಬ್ಬರು ಪರಿಶೀಲಿಸಬೇಕು.`,
  ],
};
