// The phone setup for a listings-only shop ("Only show what the shop has", free; 18 Nov 2026): a shop that shows what it has on its own page and in search, and takes no
// booking, order or fee. The Operator sets it up ONCE, on a visit: the shop's name, its town (and pincode), a few words on what it sells, its languages, and the owner. There is
// no payment step, no WhatsApp step, no limits step and no character step: the shop calls nothing, so there is nothing to connect and no limit to set. After that the owner does
// everything with the assistant in their own app (what they have, "Still have it?", the switch "Show my shop on Streetlist and in search", the place and the registration).
//
// The owner's number is OPTIONAL here (a shop may have no WhatsApp at all). Without it the owner's way in is the Operator's one-use sign-in code, made on the shop's page after the
// shop is set up (templates/commerce/listings/README.md, "The first sign-in"). Words are in four languages (Hindi, Malayalam and Kannada machine-written, on the review sheets:
// LISTINGS_PANEL_WORDS), found by the panel's own `Words` language name, so the shared words files change only by one template name each. `validateSettings` of the template is the last gate.
import type { Language } from "../../modules/language/languages.ts";
import { validateSettings, MAX_NAME } from "../../templates/commerce/listings/src/settings.ts";
import type { Settings } from "../../templates/commerce/listings/src/settings.ts";
import { KEEP, keepHidden } from "./keep.ts";
import { wordsLanguage } from "./languages.ts";
import { html } from "./html.ts";
import type { Raw } from "./html.ts";
import { newPayment, whatsappDraftOf } from "./setup.ts";
import type { Body, Built, Draft, StepResult } from "./setup.ts";
import type { ShopMeta } from "./shops.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";
import type { Helpers } from "./views-fees.ts";
import type { Ctx, TemplateMessages, TemplateSummary } from "./views.ts";

/** What the form shows and sends back. Every value is text, as typed. */
export interface ListingsForm { town: string; pincode: string; trade: string }

export interface ListingsPanelWords {
  steps: { business: string; rules: string };
  business: { name: string; town: string; townHelp: string; pincode: string; pincodeHelp: string; trade: string; tradeHelp: string };
  languages: { ownerNumberHelp: string };
  problems: { townBad: string; pincodeBad: string; tradeBad: string };
  shop: { heading: string; town: string; trade: string; free: string };
  /** The checks page (the last step) of a listings-only shop: what it is, the save, and the owner's first sign-in. */
  checks: { lines: string[]; saveFirst: string; saved: string; waiting: string; deployed: string; next: string; openShop: string };
}

export const LISTINGS_PANEL_WORDS: Record<Language, ListingsPanelWords> = {
  en: {
    steps: { business: "The shop", rules: "The shop" },
    business: {
      name: "Shop name", town: "Town or village", townHelp: "Where people will find the shop, for example Thrissur.", pincode: "Pincode (if you know it)", pincodeHelp: "Six digits. It helps people nearby find the shop.",
      trade: "What the shop sells, in a few words", tradeHelp: "In your own words, for example second-hand cycles. It is only a label for you and the shop's page.",
    },
    languages: { ownerNumberHelp: "The owner's phone number with the country code, for example +91 98765 43210. You may leave it empty: the owner then signs in the first time with a one-use code that you show them on the shop's page." },
    problems: { townBad: "Write the town or village, one short line.", pincodeBad: "The pincode is six digits, not starting with 0. You may leave it empty.", tradeBad: "Write what the shop sells in a few words, one short line." },
    shop: { heading: "What this shop shows", town: "Town", trade: "Sells", free: "Free: it takes no money and sends no WhatsApp messages." },
    checks: {
      lines: [
        "The shop shows what it has on its own page. It is free: it takes no bookings, orders or fees, holds no money and sends no WhatsApp messages.",
        "The owner does the rest in their own app: they say what they have, the assistant writes the listing, and they tap to show it. The assistant asks \"Still have it?\" and the owner answers Yes or Sold.",
        "Nothing is shown on Streetlist or in search until the owner switches \"Show my shop on Streetlist and in search\" on.",
        "Geometer pays for the assistant's model use, up to a small limit each month.",
      ],
      saveFirst: "Check this, then save the shop.", saved: "Saved. The server sets the shop up within a minute.", waiting: "The server has not set this shop up yet. Come back to this page in a minute.",
      deployed: "The shop is set up on the server.", next: "Next: give the owner their first sign-in code. It is made on the shop's page, works once and for a few minutes, and the owner opens it on their own phone.", openShop: "Open the shop's page",
    },
  },
  hi: {
    steps: { business: "दुकान", rules: "दुकान" },
    business: {
      name: "दुकान का नाम", town: "शहर या गाँव", townHelp: "जहाँ लोग दुकान को ढूँढेंगे, जैसे थ्रिस्सूर।", pincode: "पिन कोड (अगर पता हो)", pincodeHelp: "छह अंक। इससे आस-पास के लोग दुकान ढूँढ पाते हैं।",
      trade: "दुकान क्या बेचती है, कुछ शब्दों में", tradeHelp: "अपने शब्दों में, जैसे पुरानी साइकिलें। यह सिर्फ़ आपके और दुकान के पेज के लिए एक नाम है।",
    },
    languages: { ownerNumberHelp: "मालिक का फ़ोन नंबर देश कोड के साथ, जैसे +91 98765 43210। आप इसे खाली छोड़ सकते हैं: तब मालिक पहली बार उस एक-बार वाले कोड से साइन-इन करता है जो आप उसे दुकान के पेज पर दिखाते हैं।" },
    problems: { townBad: "शहर या गाँव लिखिए, एक छोटी लाइन।", pincodeBad: "पिन कोड छह अंकों का होता है, 0 से शुरू नहीं होता। आप इसे खाली छोड़ सकते हैं।", tradeBad: "दुकान क्या बेचती है, कुछ शब्दों में लिखिए, एक छोटी लाइन।" },
    shop: { heading: "यह दुकान क्या दिखाती है", town: "शहर", trade: "बेचती है", free: "मुफ़्त: न पैसे लेती है, न WhatsApp संदेश भेजती है।" },
    checks: {
      lines: [
        "दुकान अपने पेज पर दिखाती है कि उसके पास क्या है। यह मुफ़्त है: न बुकिंग, न ऑर्डर, न फ़ीस, न पैसे का हिसाब, न WhatsApp संदेश।",
        "बाक़ी सब मालिक अपने ऐप में करता है: वह बताता है कि क्या है, असिस्टेंट लिस्टिंग लिखता है, और वह एक टैप से उसे दिखा देता है। असिस्टेंट पूछता है \"अभी भी है?\" और मालिक हाँ या बिक गया कहता है।",
        "जब तक मालिक \"मेरी दुकान Streetlist और सर्च में दिखाएँ\" चालू नहीं करता, कुछ भी Streetlist या सर्च में नहीं दिखता।",
        "असिस्टेंट के मॉडल का ख़र्च Geometer उठाता है, हर महीने एक छोटी सीमा तक।",
      ],
      saveFirst: "इसे देखिए, फिर दुकान सहेजिए।", saved: "सहेज लिया। सर्वर एक मिनट के अंदर दुकान तैयार कर देता है।", waiting: "सर्वर ने अभी यह दुकान तैयार नहीं की है। एक मिनट बाद इस पेज पर लौटिए।",
      deployed: "दुकान सर्वर पर तैयार है।", next: "अब मालिक को उसका पहला साइन-इन कोड दीजिए। यह दुकान के पेज पर बनता है, एक बार और कुछ ही मिनट चलता है, और मालिक इसे अपने फ़ोन पर खोलता है।", openShop: "दुकान का पेज खोलें",
    },
  },
  ml: {
    steps: { business: "കട", rules: "കട" },
    business: {
      name: "കടയുടെ പേര്", town: "ടൗൺ അല്ലെങ്കിൽ ഗ്രാമം", townHelp: "ആളുകൾ കട കണ്ടെത്തുന്ന സ്ഥലം, ഉദാഹരണം തൃശൂർ.", pincode: "പിൻകോഡ് (അറിയാമെങ്കിൽ)", pincodeHelp: "ആറ് അക്കങ്ങൾ. അടുത്തുള്ളവർക്ക് കട കണ്ടെത്താൻ ഇത് സഹായിക്കും.",
      trade: "കട എന്താണ് വിൽക്കുന്നത്, കുറച്ച് വാക്കുകളിൽ", tradeHelp: "നിങ്ങളുടെ സ്വന്തം വാക്കുകളിൽ, ഉദാഹരണം പഴയ സൈക്കിളുകൾ. ഇത് നിങ്ങൾക്കും കടയുടെ പേജിനും ഉള്ള ഒരു പേര് മാത്രം.",
    },
    languages: { ownerNumberHelp: "ഉടമയുടെ ഫോൺ നമ്പർ രാജ്യത്തിന്റെ കോഡ് സഹിതം, ഉദാഹരണം +91 98765 43210. ഇത് ഒഴിച്ചിടാം: അപ്പോൾ കടയുടെ പേജിൽ നിങ്ങൾ കാണിക്കുന്ന ഒരിക്കൽ മാത്രം ഉപയോഗിക്കാവുന്ന കോഡ് കൊണ്ട് ഉടമ ആദ്യമായി സൈൻ ഇൻ ചെയ്യും." },
    problems: { townBad: "ടൗൺ അല്ലെങ്കിൽ ഗ്രാമം എഴുതുക, ഒരു ചെറിയ വരി.", pincodeBad: "പിൻകോഡ് ആറ് അക്കമാണ്, 0 കൊണ്ട് തുടങ്ങില്ല. ഇത് ഒഴിച്ചിടാം.", tradeBad: "കട എന്താണ് വിൽക്കുന്നതെന്ന് കുറച്ച് വാക്കുകളിൽ എഴുതുക, ഒരു ചെറിയ വരി." },
    shop: { heading: "ഈ കട കാണിക്കുന്നത്", town: "ടൗൺ", trade: "വിൽക്കുന്നത്", free: "സൗജന്യം: പണം എടുക്കില്ല, WhatsApp സന്ദേശങ്ങൾ അയയ്ക്കില്ല." },
    checks: {
      lines: [
        "കടയുടെ കൈവശം എന്താണുള്ളതെന്ന് കട സ്വന്തം പേജിൽ കാണിക്കുന്നു. ഇത് സൗജന്യമാണ്: ബുക്കിംഗോ ഓർഡറോ ഫീസോ ഇല്ല, പണം കൈകാര്യം ചെയ്യില്ല, WhatsApp സന്ദേശങ്ങൾ അയയ്ക്കില്ല.",
        "ബാക്കിയെല്ലാം ഉടമ സ്വന്തം ആപ്പിൽ ചെയ്യുന്നു: എന്താണുള്ളതെന്ന് പറയുന്നു, അസിസ്റ്റന്റ് ലിസ്റ്റിംഗ് എഴുതുന്നു, ഒരു ടാപ്പിൽ ഉടമ അത് കാണിക്കുന്നു. അസിസ്റ്റന്റ് \"ഇപ്പോഴും ഉണ്ടോ?\" എന്ന് ചോദിക്കും, ഉടമ ഉണ്ട് അല്ലെങ്കിൽ വിറ്റു എന്ന് ഉത്തരം നൽകും.",
        "ഉടമ \"എന്റെ കട Streetlist-ലും സെർച്ചിലും കാണിക്കുക\" ഓണാക്കുന്നതുവരെ Streetlist-ലോ സെർച്ചിലോ ഒന്നും കാണിക്കില്ല.",
        "അസിസ്റ്റന്റിന്റെ മോഡൽ ഉപയോഗത്തിന്റെ ചെലവ് Geometer വഹിക്കുന്നു, മാസത്തിൽ ഒരു ചെറിയ പരിധി വരെ.",
      ],
      saveFirst: "ഇത് നോക്കുക, എന്നിട്ട് കട സേവ് ചെയ്യുക.", saved: "സേവ് ചെയ്തു. ഒരു മിനിറ്റിനുള്ളിൽ സെർവർ കട സജ്ജമാക്കും.", waiting: "സെർവർ ഇതുവരെ ഈ കട സജ്ജമാക്കിയിട്ടില്ല. ഒരു മിനിറ്റ് കഴിഞ്ഞ് ഈ പേജിലേക്ക് വരൂ.",
      deployed: "കട സെർവറിൽ സജ്ജമായി.", next: "അടുത്തത്: ഉടമയ്ക്ക് ആദ്യത്തെ സൈൻ ഇൻ കോഡ് നൽകുക. ഇത് കടയുടെ പേജിൽ ഉണ്ടാക്കാം, ഒരിക്കൽ മാത്രവും കുറച്ച് മിനിറ്റ് മാത്രവും പ്രവർത്തിക്കും, ഉടമ ഇത് സ്വന്തം ഫോണിൽ തുറക്കും.", openShop: "കടയുടെ പേജ് തുറക്കുക",
    },
  },
  kn: {
    steps: { business: "ಅಂಗಡಿ", rules: "ಅಂಗಡಿ" },
    business: {
      name: "ಅಂಗಡಿಯ ಹೆಸರು", town: "ಊರು ಅಥವಾ ಗ್ರಾಮ", townHelp: "ಜನರು ಅಂಗಡಿಯನ್ನು ಹುಡುಕುವ ಸ್ಥಳ, ಉದಾಹರಣೆಗೆ ಮೈಸೂರು.", pincode: "ಪಿನ್‌ಕೋಡ್ (ಗೊತ್ತಿದ್ದರೆ)", pincodeHelp: "ಆರು ಅಂಕೆಗಳು. ಹತ್ತಿರದ ಜನರು ಅಂಗಡಿಯನ್ನು ಹುಡುಕಲು ಇದು ಸಹಾಯ ಮಾಡುತ್ತದೆ.",
      trade: "ಅಂಗಡಿ ಏನು ಮಾರುತ್ತದೆ, ಕೆಲವು ಪದಗಳಲ್ಲಿ", tradeHelp: "ನಿಮ್ಮದೇ ಪದಗಳಲ್ಲಿ, ಉದಾಹರಣೆಗೆ ಹಳೆಯ ಸೈಕಲ್‌ಗಳು. ಇದು ನಿಮಗೆ ಮತ್ತು ಅಂಗಡಿಯ ಪುಟಕ್ಕೆ ಒಂದು ಹೆಸರು ಮಾತ್ರ.",
    },
    languages: { ownerNumberHelp: "ಮಾಲೀಕರ ಫೋನ್ ಸಂಖ್ಯೆ ದೇಶದ ಕೋಡ್‌ನೊಂದಿಗೆ, ಉದಾಹರಣೆಗೆ +91 98765 43210. ಇದನ್ನು ಖಾಲಿ ಬಿಡಬಹುದು: ಆಗ ಅಂಗಡಿಯ ಪುಟದಲ್ಲಿ ನೀವು ತೋರಿಸುವ ಒಮ್ಮೆ ಮಾತ್ರ ಬಳಸುವ ಕೋಡ್‌ನಿಂದ ಮಾಲೀಕರು ಮೊದಲ ಬಾರಿ ಸೈನ್ ಇನ್ ಮಾಡುತ್ತಾರೆ." },
    problems: { townBad: "ಊರು ಅಥವಾ ಗ್ರಾಮವನ್ನು ಬರೆಯಿರಿ, ಒಂದು ಚಿಕ್ಕ ಸಾಲು.", pincodeBad: "ಪಿನ್‌ಕೋಡ್ ಆರು ಅಂಕೆಗಳು, 0 ದಿಂದ ಶುರುವಾಗುವುದಿಲ್ಲ. ಇದನ್ನು ಖಾಲಿ ಬಿಡಬಹುದು.", tradeBad: "ಅಂಗಡಿ ಏನು ಮಾರುತ್ತದೆ ಎಂದು ಕೆಲವು ಪದಗಳಲ್ಲಿ ಬರೆಯಿರಿ, ಒಂದು ಚಿಕ್ಕ ಸಾಲು." },
    shop: { heading: "ಈ ಅಂಗಡಿ ತೋರಿಸುವುದು", town: "ಊರು", trade: "ಮಾರುವುದು", free: "ಉಚಿತ: ಹಣ ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ, WhatsApp ಸಂದೇಶಗಳನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ." },
    checks: {
      lines: [
        "ಅಂಗಡಿಯಲ್ಲಿ ಏನಿದೆ ಎಂದು ಅಂಗಡಿ ತನ್ನ ಪುಟದಲ್ಲಿ ತೋರಿಸುತ್ತದೆ. ಇದು ಉಚಿತ: ಬುಕಿಂಗ್, ಆರ್ಡರ್, ಶುಲ್ಕ ಇಲ್ಲ, ಹಣ ಇಟ್ಟುಕೊಳ್ಳುವುದಿಲ್ಲ, WhatsApp ಸಂದೇಶ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
        "ಉಳಿದದ್ದನ್ನೆಲ್ಲ ಮಾಲೀಕರು ತಮ್ಮ ಆಪ್‌ನಲ್ಲಿ ಮಾಡುತ್ತಾರೆ: ಏನಿದೆ ಎಂದು ಹೇಳುತ್ತಾರೆ, ಅಸಿಸ್ಟೆಂಟ್ ಲಿಸ್ಟಿಂಗ್ ಬರೆಯುತ್ತದೆ, ಒಂದು ಟ್ಯಾಪ್‌ನಲ್ಲಿ ಮಾಲೀಕರು ಅದನ್ನು ತೋರಿಸುತ್ತಾರೆ. ಅಸಿಸ್ಟೆಂಟ್ \"ಇನ್ನೂ ಇದೆಯೇ?\" ಎಂದು ಕೇಳುತ್ತದೆ, ಮಾಲೀಕರು ಇದೆ ಅಥವಾ ಮಾರಾಟವಾಯಿತು ಎನ್ನುತ್ತಾರೆ.",
        "ಮಾಲೀಕರು \"ನನ್ನ ಅಂಗಡಿಯನ್ನು Streetlist ಮತ್ತು ಹುಡುಕಾಟದಲ್ಲಿ ತೋರಿಸಿ\" ಅನ್ನು ಆನ್ ಮಾಡುವವರೆಗೆ Streetlist ಅಥವಾ ಹುಡುಕಾಟದಲ್ಲಿ ಏನೂ ತೋರಿಸುವುದಿಲ್ಲ.",
        "ಅಸಿಸ್ಟೆಂಟ್‌ನ ಮಾದರಿ ಬಳಕೆಯ ವೆಚ್ಚವನ್ನು Geometer ಭರಿಸುತ್ತದೆ, ತಿಂಗಳಿಗೆ ಒಂದು ಸಣ್ಣ ಮಿತಿಯವರೆಗೆ.",
      ],
      saveFirst: "ಇದನ್ನು ನೋಡಿ, ನಂತರ ಅಂಗಡಿಯನ್ನು ಉಳಿಸಿ.", saved: "ಉಳಿಸಲಾಗಿದೆ. ಸರ್ವರ್ ಒಂದು ನಿಮಿಷದಲ್ಲಿ ಅಂಗಡಿಯನ್ನು ಸಿದ್ಧಪಡಿಸುತ್ತದೆ.", waiting: "ಸರ್ವರ್ ಇನ್ನೂ ಈ ಅಂಗಡಿಯನ್ನು ಸಿದ್ಧಪಡಿಸಿಲ್ಲ. ಒಂದು ನಿಮಿಷ ಬಿಟ್ಟು ಈ ಪುಟಕ್ಕೆ ಬನ್ನಿ.",
      deployed: "ಅಂಗಡಿ ಸರ್ವರ್‌ನಲ್ಲಿ ಸಿದ್ಧವಾಗಿದೆ.", next: "ಮುಂದೆ: ಮಾಲೀಕರಿಗೆ ಅವರ ಮೊದಲ ಸೈನ್ ಇನ್ ಕೋಡ್ ಕೊಡಿ. ಇದು ಅಂಗಡಿಯ ಪುಟದಲ್ಲಿ ಮಾಡಲಾಗುತ್ತದೆ, ಒಮ್ಮೆ ಮಾತ್ರ ಮತ್ತು ಕೆಲವೇ ನಿಮಿಷ ಕೆಲಸ ಮಾಡುತ್ತದೆ, ಮಾಲೀಕರು ಇದನ್ನು ತಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ತೆರೆಯುತ್ತಾರೆ.", openShop: "ಅಂಗಡಿಯ ಪುಟ ತೆರೆಯಿರಿ",
    },
  },
};

/** The words for the panel's words of one language (found by its language name, so the shared words files need no new section). */
export const listingsWords = (w: Words): ListingsPanelWords => LISTINGS_PANEL_WORDS[wordsLanguage(w)];
const listingsOf = (draft: Draft): ListingsForm => (draft as unknown as { listings: ListingsForm }).listings;

const text = (v: string | undefined, max = 120) => (v ?? "").trim().replace(/\s+/gu, " ").slice(0, max);
const PINCODE = /^[1-9]\d{5}$/u;
const emptyShopForm = (): Draft["form"] => ({ name: "", language: "en", services: [], deposit: "", opens: "", closes: "", days: [] });

// ---- the draft ---------------------------------------------------------------------------------------------------------------------------

export function newListingsDraft(id: string, accountId: string, template: Template, example: Settings, now: string): Draft {
  return {
    id, accountId, template: template.id, createdAt: now, editing: false, saved: false,
    form: emptyShopForm(), windowHours: "", primaryLanguage: example.languages[0], otherLanguages: [], ownerLanguage: example.owner.language, ownerNumber: "",
    whatsapp: { businessNumber: "", numberId: "", none: true }, calendar: { id: "" }, gateway: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: 0,
    listings: { town: "", pincode: "", trade: "" } satisfies ListingsForm,
  } as Draft;
}

export function listingsDraftFromShop(id: string, accountId: string, templateId: string, shopId: string, s: Settings, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft {
  return {
    id, accountId, template: templateId, createdAt: now, shopId, editing: true, saved: true, form: { ...emptyShopForm(), name: s.name }, windowHours: "",
    primaryLanguage: s.languages[0], otherLanguages: s.languages.slice(1), ownerLanguage: s.owner.language, ownerNumber: s.owner.noNumber ? "" : s.owner.whatsapp, whatsapp: whatsappDraftOf(meta, runtime),
    calendar: { id: "" }, gateway: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: Number.MAX_SAFE_INTEGER,
    listings: { town: s.place.town, pincode: s.place.pincode ?? "", trade: s.trade ?? "" } satisfies ListingsForm,
  } as Draft;
}

// ---- step 1: the shop ----------------------------------------------------------------------------------------------------------------------

export function applyListingsBusiness(draft: Draft, body: Body, w: Words): StepResult {
  const s = w.setup.problems;
  const p = listingsWords(w).problems;
  const problems: string[] = [];
  const name = text(body.name, MAX_NAME);
  const town = text(body.town, 60);
  const pincode = text(body.pincode, 6);
  const trade = text(body.trade, 60);
  if (name === "") problems.push(s.nameEmpty);
  if (town === "") problems.push(p.townBad);
  if (pincode !== "" && !PINCODE.test(pincode)) problems.push(p.pincodeBad);
  if (/[\p{Cc}]/u.test(trade)) problems.push(p.tradeBad);
  draft.form = { ...draft.form, name };
  (draft as unknown as { listings: ListingsForm }).listings = { town, pincode, trade };
  return { problems };
}

/** A listings-only shop has no second form (no deposit, limits or rules): the step list has none, and this is only here so the row of setups.ts is complete. */
export const applyListingsRules = (_draft: Draft, _body: Body, _w: Words): StepResult => ({ problems: [] });

// ---- the settings, and the runtime ----------------------------------------------------------------------------------------------------------

/**
 * The form becomes the listings-only settings; `validateSettings` is the last word. `saved` is the shop's settings.json as written, for a shop being changed: what the form does not
 * show (the assistant's block, the time zone) is put back from it (keep.ts). The owner's number is left out when none was given (the owner then signs in with the Operator's code).
 */
export function buildListingsSettings(draft: Draft, _example: Settings, saved?: unknown): Built {
  const f = listingsOf(draft);
  const languages: Language[] = [draft.primaryLanguage as Language, ...(draft.otherLanguages as Language[])];
  const raw = {
    name: draft.form.name, place: { town: f.town, ...(f.pincode !== "" ? { pincode: f.pincode } : {}) }, ...(f.trade !== "" ? { trade: f.trade } : {}),
    timezone: (saved as { timezone?: string } | undefined)?.timezone ?? "Asia/Kolkata", languages,
    owner: { language: draft.ownerLanguage, ...(draft.ownerNumber !== "" ? { whatsapp: draft.ownerNumber } : {}) },
  };
  const written = saved === undefined ? raw : keepHidden(raw, saved, KEEP.listings);
  const checked = validateSettings(written);
  return checked.ok ? ({ ok: true, settings: checked.settings as never, raw: written } as Built) : { ok: false, errors: checked.errors };
}

/** What a listings-only shop promises, as sentences in the person's language (the certificate's place on other templates; here there is no certificate). */
export const listingsLimitLines = (_draft: Draft, _example: Settings, language: Language): string[] => LISTINGS_PANEL_WORDS[language].checks.lines;

/** runtime.json: who things are. A listings-only shop calls no service, so `services` is empty; the model is the server's (the deployer writes the rest). */
export function runtimeForListings(_phoneNumberId: string, serverModel?: { wire: string; model: string }): Record<string, unknown> {
  return { mode: "live", tickSeconds: 30, services: {}, ...(serverModel ? { parser: { wire: serverModel.wire, model: serverModel.model } } : {}) };
}

// ---- the pages ---------------------------------------------------------------------------------------------------------------------------------

export function listingsBusinessBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, h: Helpers): Raw {
  const b = listingsWords(c.w).business;
  const f = listingsOf(d);
  return html`<form method="post" action="${action}">${h.csrf}
  ${h.text(b.name, "name", d.form.name, { max: MAX_NAME })}
  ${h.text(b.town, "town", f.town, { max: 60, help: b.townHelp })}
  ${h.text(b.pincode, "pincode", f.pincode, { mode: "numeric", max: 6, help: b.pincodeHelp })}
  ${h.text(b.trade, "trade", f.trade, { max: 60, help: b.tradeHelp })}
  ${back}${next}</form>`;
}

/** No second form: never shown (the step list has no "deposit" step). */
export const listingsRulesBody = (_c: Ctx, _d: Draft, _action: string, _back: Raw | string, _next: Raw, _lines: string[], _h: Helpers): Raw => html``;

export function summaryListings(c: Ctx, s: Settings) {
  const w = listingsWords(c.w).shop;
  return {
    heading: w.heading, rulesHeading: w.free,
    lines: [`${w.town}: ${s.place.town}${s.place.pincode ? ` ${s.place.pincode}` : ""}`, ...(s.trade ? [`${w.trade}: ${s.trade}`] : [])],
    languages: s.languages.join(", "), owner: s.owner.noNumber ? "" : s.owner.whatsapp,
  } satisfies TemplateSummary;
}

/** No message is sent to anyone: the planning table for the shop's page says so by saying nothing. */
export const listingsMessageCeiling = (_c: Ctx, _s: Settings, _included: number | null): TemplateMessages => ({ heading: "", lines: [], note: "" });

/** The last step for a listings-only shop: what it is (before saving), then what the Operator does next (after). */
export function listingsChecksPage(c: Ctx, v: { draft: Draft; saved: boolean; deployApplied?: unknown; shopId?: string }, shell: (title: string, body: Raw) => string, parts: { head: Raw; back: Raw; csrf: Raw }): string {
  const k = listingsWords(c.w).checks;
  const d = v.draft;
  const lines = html`<ul class="plain">${k.lines.map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>`;
  if (!v.saved) {
    return shell(k.saveFirst, html`${parts.head}<p class="big">${k.saveFirst}</p>${lines}
<form method="post" action="/setup/${d.id}/save">${parts.csrf}<button class="btn primary" type="submit">${c.w.common.save}</button> ${parts.back}</form>`);
  }
  return shell(k.saved, html`${parts.head}<div class="notice" role="status">${k.saved}</div>
<p>${v.deployApplied ? k.deployed : k.waiting}</p>
<p class="big">${k.next}</p>
${v.shopId ? html`<p><a class="btn primary" href="/shops/${v.shopId}">${k.openShop}</a></p>` : ""}
${lines}<p>${parts.back}</p>`);
}
