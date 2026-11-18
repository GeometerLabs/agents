// "Phones that can open your shop": the owner's own page in their app (owner's item 2, "no Operator holds a shop hostage"), and the banners on the owner's other
// pages. It lists every phone that can sign in (a plain label like "Android, Chrome", the day it was added, how, when it was last used, "This phone"), lets the owner
// remove one (with a confirm, and a second one in plain words for the LAST phone), add a phone from this phone, make their OWN recovery codes (shown once; the
// Operator's printed card stops working), and cancel the Operator's request to remove every phone.
//
// Used by front.ts (GET <base>/phones, POST <base>/phones/remove|dismiss|cancel|codes|add) with the runtime's answers (backend.phones). Every rule is the runtime's
// (modules/runtime/http.ts "owner-phones"); this file only draws what the runtime says. Plain forms, no script, so the strictest content policy applies. Hindi, Malayalam
// and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts, ids "phones.*").
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import { textQrSvg } from "../qr/svg.ts";
import type { PhonesView } from "./owner-access.ts";
import { LOST_HELP, dayAndTime, dayOnly } from "./owner-phones.ts";
import { OWNER_CSS } from "./look.ts";
import { printedCode } from "./owner-grants.ts";

/** The runtime's list answer, as the front passes it on (times in ms). */
export type PhonesAnswer = PhonesView & { language: Language; now: number; /** The alert subscriptions that reach the owner, each with the phone it came from. */ alerts?: { id: string; madeAt: number; label?: string }[] };

interface Words {
  title: string; link: string; intro: string; thisPhone: string; aPhone: string; added: (day: string) => string; via: Record<"setup" | "recovery" | "own_phone" | "own_code" | "reset", string>;
  lastUsed: (day: string) => string; neverUsed: string; remove: string; removeTitle: string; removeAsk: (what: string) => string; removeYes: string; keep: string;
  lastTitle: string; lastAsk: string; lastYes: string; removed: string; add: string; addNote: string; addTitle: string; addHow: (time: string) => string;
  codes: string; codesNone: string; codesHave: (day: string) => string; codesMake: string; codesRemake: string; codesNote: string; codesTitle: string; codesShow: string;
  needPasskey: string; back: string; onePhone: string; noPhones: string;
  bannerNew: (when: string, label: string) => string; itWasMe: string; removeIt: string; bannerRequest: (by: string, when: string) => string; cancel: string; cancelled: string;
  labelNote: string; alertsTitle: string; alertsNote: string; alertSince: (day: string) => string; stop: string; bannerNumber: string; bannerOwner: (when: string) => string; bannerCodesMade: (when: string, label: string) => string; bannerRemoved: (when: string, label: string) => string; bannerCodes: string; makeCodes: string; refused: string; operator: string; openPhones: string;
}
/** Exported so the review sheets list these lines too (review.ts, ids "phones.*"). */
export const WORDS: Record<Language, Words> = {
  en: {
    title: "Phones that can open your shop", link: "Phones that can open your shop", intro: "Only these phones can open your shop's app. If you see one you do not know, remove it.",
    thisPhone: "This phone", aPhone: "A phone", added: (d) => `Added ${d}`,
    via: { setup: "with the setup QR code", recovery: "with a recovery code", own_code: "with your own recovery code", own_phone: "from your own phone", reset: "after Geometer reset your sign-in" },
    lastUsed: (d) => `Last used ${d}`, neverUsed: "Not used yet", remove: "Remove", removeTitle: "Remove this phone?", removeAsk: (w) => `${w} will not be able to open your shop any more.`,
    removeYes: "Yes, remove it", keep: "No, keep it",
    lastTitle: "This is your only phone", lastAsk: "If you remove it, you can only get back in with your own recovery codes, or with your Operator's help, which takes 2 days. Remove it anyway?", lastYes: "Yes, remove my only phone",
    removed: "That phone is removed.", add: "Add a phone", addNote: "Shows a one-use code on this screen. Scan it with the new phone's camera within 15 minutes.",
    addTitle: "Add a new phone", addHow: (t) => `Scan this with the new phone's camera and touch its fingerprint reader. It works once, until ${t}.`,
    codes: "Your own recovery codes", codesNone: "You have not made your own codes yet.", codesHave: (d) => `You made your own codes on ${d}. Only you hold them.`,
    codesMake: "Make my own recovery codes", codesRemake: "Make new codes", codesNote: "The codes show once. The codes your Operator printed stop working.",
    codesTitle: "Your recovery codes", codesShow: "Write these down and keep them safe. Each works once, and they are never shown again. The codes your Operator printed no longer work.",
    needPasskey: "To make codes or add a phone, sign out and sign in again with your phone's fingerprint or screen lock.", back: "Back to your shop",
    onePhone: "Only one phone can open your shop now.", noPhones: "No phone can open your shop now. Use your recovery codes, or ask your Operator.",
    bannerNew: (when, label) => `A new phone was added on ${when}${label ? ` (${label})` : ""}. Not you? Remove it.`, itWasMe: "It was me", removeIt: "Remove it",
    bannerRequest: (by, when) => `${by} asked to remove every phone that can open your shop. It will happen on ${when} unless you cancel.`, cancel: "Cancel the request", cancelled: "Cancelled. Your phones stay.",
    labelNote: "The names are what each phone said about itself when it was added.",
    alertsTitle: "Alerts on your phones", alertsNote: "These phones get your shop's alerts. Stop one you do not know.", alertSince: (d) => `Alerts since ${d}`, stop: "Stop",
    bannerNumber: "The Operator's panel shows a different owner number. Your messages still come to your number.",
    bannerOwner: (when) => `The owner's number for this shop was changed. Every phone that opens your shop stops working on ${when} unless you cancel.`,
    bannerCodesMade: (when, label) => `New recovery codes were made on ${when}${label ? ` (${label})` : ""}. Not you? Remove that phone.`, bannerRemoved: (when, label) => `A phone was removed on ${when}${label ? ` (${label})` : ""}.`,
    bannerCodes: "Make your own codes now, so only you hold them.", makeCodes: "Make my codes", refused: "That did not work. Sign out, sign in with your phone's fingerprint and try again.", operator: "Your Operator", openPhones: "Your phones",
  },
  hi: {
    title: "वे फ़ोन जो आपकी दुकान खोल सकते हैं", link: "वे फ़ोन जो आपकी दुकान खोल सकते हैं", intro: "सिर्फ़ यही फ़ोन आपकी दुकान का ऐप खोल सकते हैं। कोई फ़ोन अनजान दिखे तो उसे हटा दीजिए।",
    thisPhone: "यह फ़ोन", aPhone: "एक फ़ोन", added: (d) => `${d} को जोड़ा गया`,
    via: { setup: "सेटअप QR कोड से", recovery: "रिकवरी कोड से", own_code: "आपके अपने रिकवरी कोड से", own_phone: "आपके अपने फ़ोन से", reset: "Geometer के आपका साइन-इन रीसेट करने के बाद" },
    lastUsed: (d) => `आख़िरी बार ${d} को इस्तेमाल हुआ`, neverUsed: "अभी तक इस्तेमाल नहीं हुआ", remove: "हटाएँ", removeTitle: "यह फ़ोन हटाएँ?", removeAsk: (w) => `${w} अब आपकी दुकान नहीं खोल पाएगा।`,
    removeYes: "हाँ, हटाइए", keep: "नहीं, रहने दीजिए",
    lastTitle: "यह आपका अकेला फ़ोन है", lastAsk: "इसे हटाने पर आप अपने रिकवरी कोड से, या अपने ऑपरेटर की मदद से ही वापस आ पाएँगे, जिसमें 2 दिन लगते हैं। फिर भी हटाएँ?", lastYes: "हाँ, मेरा अकेला फ़ोन हटाइए",
    removed: "वह फ़ोन हटा दिया गया।", add: "फ़ोन जोड़ें", addNote: "इस स्क्रीन पर एक बार चलने वाला कोड दिखता है। नए फ़ोन के कैमरे से 15 मिनट के भीतर स्कैन कीजिए।",
    addTitle: "नया फ़ोन जोड़ें", addHow: (t) => `इसे नए फ़ोन के कैमरे से स्कैन कीजिए और उसके फ़िंगरप्रिंट रीडर को छुइए। यह एक बार चलेगा, ${t} तक।`,
    codes: "आपके अपने रिकवरी कोड", codesNone: "आपने अपने कोड अभी नहीं बनाए हैं।", codesHave: (d) => `आपने अपने कोड ${d} को बनाए। ये सिर्फ़ आपके पास हैं।`,
    codesMake: "मेरे अपने रिकवरी कोड बनाएँ", codesRemake: "नए कोड बनाएँ", codesNote: "कोड एक ही बार दिखते हैं। आपके ऑपरेटर के छापे हुए कोड बंद हो जाते हैं।",
    codesTitle: "आपके रिकवरी कोड", codesShow: "इन्हें लिख लीजिए और सँभालकर रखिए। हर कोड एक बार चलता है, और ये दोबारा नहीं दिखाए जाते। आपके ऑपरेटर के छापे हुए कोड अब नहीं चलेंगे।",
    needPasskey: "कोड बनाने या फ़ोन जोड़ने के लिए साइन आउट करके अपने फ़ोन के फ़िंगरप्रिंट या स्क्रीन लॉक से फिर साइन इन कीजिए।", back: "अपनी दुकान पर वापस",
    onePhone: "अभी सिर्फ़ एक फ़ोन आपकी दुकान खोल सकता है।", noPhones: "अभी कोई फ़ोन आपकी दुकान नहीं खोल सकता। अपने रिकवरी कोड इस्तेमाल कीजिए, या अपने ऑपरेटर से कहिए।",
    bannerNew: (when, label) => `${when} को एक नया फ़ोन जोड़ा गया${label ? ` (${label})` : ""}। आपने नहीं जोड़ा? उसे हटा दीजिए।`, itWasMe: "मैंने ही जोड़ा", removeIt: "हटाइए",
    bannerRequest: (by, when) => `${by} ने आपकी दुकान खोलने वाले हर फ़ोन को हटाने को कहा है। आप रद्द न करें तो यह ${when} को हो जाएगा।`, cancel: "अनुरोध रद्द करें", cancelled: "रद्द हो गया। आपके फ़ोन बने रहेंगे।",
    labelNote: "ये नाम वही हैं जो हर फ़ोन ने जुड़ते समय अपने बारे में बताए।",
    alertsTitle: "आपके फ़ोनों पर अलर्ट", alertsNote: "ये फ़ोन आपकी दुकान के अलर्ट पाते हैं। जो फ़ोन आप नहीं पहचानते, उसे रोक दीजिए।", alertSince: (d) => `${d} से अलर्ट`, stop: "रोकें",
    bannerNumber: "ऑपरेटर के पैनल में मालिक का नंबर कुछ और दिख रहा है। आपके संदेश अब भी आपके नंबर पर आते हैं।",
    bannerOwner: (when) => `इस दुकान के लिए मालिक का नंबर बदला गया है। आप रद्द न करें तो दुकान खोलने वाले सारे फ़ोन ${when} को बंद हो जाएँगे।`,
    bannerCodesMade: (when, label) => `${when} को नए रिकवरी कोड बनाए गए${label ? ` (${label})` : ""}। आपने नहीं बनाए? वह फ़ोन हटा दीजिए।`, bannerRemoved: (when, label) => `${when} को एक फ़ोन हटाया गया${label ? ` (${label})` : ""}।`,
    bannerCodes: "अपने कोड अभी बनाइए, ताकि वे सिर्फ़ आपके पास रहें।", makeCodes: "मेरे कोड बनाएँ", refused: "यह नहीं हो पाया। साइन आउट करके अपने फ़ोन के फ़िंगरप्रिंट से साइन इन कीजिए और फिर कोशिश कीजिए।", operator: "आपके ऑपरेटर", openPhones: "आपके फ़ोन",
  },
  ml: {
    title: "നിങ്ങളുടെ കട തുറക്കാവുന്ന ഫോണുകൾ", link: "നിങ്ങളുടെ കട തുറക്കാവുന്ന ഫോണുകൾ", intro: "ഈ ഫോണുകൾക്ക് മാത്രമേ നിങ്ങളുടെ കടയുടെ ആപ്പ് തുറക്കാനാകൂ. നിങ്ങൾക്ക് അറിയാത്ത ഒരെണ്ണം കണ്ടാൽ അത് നീക്കൂ.",
    thisPhone: "ഈ ഫോൺ", aPhone: "ഒരു ഫോൺ", added: (d) => `${d}-ന് ചേർത്തു`,
    via: { setup: "സെറ്റപ്പ് QR കോഡ് ഉപയോഗിച്ച്", recovery: "റിക്കവറി കോഡ് ഉപയോഗിച്ച്", own_code: "നിങ്ങളുടെ സ്വന്തം റിക്കവറി കോഡ് ഉപയോഗിച്ച്", own_phone: "നിങ്ങളുടെ സ്വന്തം ഫോണിൽ നിന്ന്", reset: "Geometer നിങ്ങളുടെ സൈൻ ഇൻ റീസെറ്റ് ചെയ്ത ശേഷം" },
    lastUsed: (d) => `അവസാനം ഉപയോഗിച്ചത് ${d}`, neverUsed: "ഇതുവരെ ഉപയോഗിച്ചിട്ടില്ല", remove: "നീക്കുക", removeTitle: "ഈ ഫോൺ നീക്കണോ?", removeAsk: (w) => `${w}-ന് ഇനി നിങ്ങളുടെ കട തുറക്കാനാകില്ല.`,
    removeYes: "അതെ, നീക്കൂ", keep: "വേണ്ട, ഇരിക്കട്ടെ",
    lastTitle: "ഇത് നിങ്ങളുടെ ഒരേയൊരു ഫോണാണ്", lastAsk: "ഇത് നീക്കിയാൽ നിങ്ങളുടെ സ്വന്തം റിക്കവറി കോഡുകൾ കൊണ്ടോ ഓപ്പറേറ്ററുടെ സഹായം കൊണ്ടോ മാത്രമേ തിരികെ കയറാനാകൂ; അതിന് 2 ദിവസം എടുക്കും. എന്നാലും നീക്കണോ?", lastYes: "അതെ, എന്റെ ഒരേയൊരു ഫോൺ നീക്കൂ",
    removed: "ആ ഫോൺ നീക്കി.", add: "ഫോൺ ചേർക്കുക", addNote: "ഈ സ്ക്രീനിൽ ഒരിക്കൽ മാത്രം പ്രവർത്തിക്കുന്ന ഒരു കോഡ് കാണിക്കും. 15 മിനിറ്റിനുള്ളിൽ പുതിയ ഫോണിന്റെ ക്യാമറ കൊണ്ട് സ്കാൻ ചെയ്യൂ.",
    addTitle: "പുതിയ ഫോൺ ചേർക്കുക", addHow: (t) => `ഇത് പുതിയ ഫോണിന്റെ ക്യാമറ കൊണ്ട് സ്കാൻ ചെയ്ത് അതിന്റെ ഫിംഗർപ്രിന്റ് റീഡറിൽ തൊടൂ. ഇത് ഒരിക്കൽ മാത്രം, ${t} വരെ പ്രവർത്തിക്കും.`,
    codes: "നിങ്ങളുടെ സ്വന്തം റിക്കവറി കോഡുകൾ", codesNone: "നിങ്ങൾ ഇതുവരെ സ്വന്തം കോഡുകൾ ഉണ്ടാക്കിയിട്ടില്ല.", codesHave: (d) => `നിങ്ങൾ ${d}-ന് സ്വന്തം കോഡുകൾ ഉണ്ടാക്കി. അത് നിങ്ങളുടെ കയ്യിൽ മാത്രമാണ്.`,
    codesMake: "എന്റെ സ്വന്തം റിക്കവറി കോഡുകൾ ഉണ്ടാക്കൂ", codesRemake: "പുതിയ കോഡുകൾ ഉണ്ടാക്കൂ", codesNote: "കോഡുകൾ ഒരിക്കൽ മാത്രം കാണിക്കും. ഓപ്പറേറ്റർ പ്രിന്റ് ചെയ്ത കോഡുകൾ പ്രവർത്തിക്കില്ല.",
    codesTitle: "നിങ്ങളുടെ റിക്കവറി കോഡുകൾ", codesShow: "ഇവ എഴുതിവെച്ച് സുരക്ഷിതമായി സൂക്ഷിക്കൂ. ഓരോന്നും ഒരിക്കൽ പ്രവർത്തിക്കും, വീണ്ടും കാണിക്കില്ല. ഓപ്പറേറ്റർ പ്രിന്റ് ചെയ്ത കോഡുകൾ ഇനി പ്രവർത്തിക്കില്ല.",
    needPasskey: "കോഡുകൾ ഉണ്ടാക്കാനോ ഫോൺ ചേർക്കാനോ സൈൻ ഔട്ട് ചെയ്ത് ഫോണിന്റെ ഫിംഗർപ്രിന്റ് അല്ലെങ്കിൽ സ്ക്രീൻ ലോക്ക് ഉപയോഗിച്ച് വീണ്ടും സൈൻ ഇൻ ചെയ്യൂ.", back: "നിങ്ങളുടെ കടയിലേക്ക് മടങ്ങുക",
    onePhone: "ഇപ്പോൾ ഒരു ഫോണിന് മാത്രമേ നിങ്ങളുടെ കട തുറക്കാനാകൂ.", noPhones: "ഇപ്പോൾ ഒരു ഫോണിനും നിങ്ങളുടെ കട തുറക്കാനാകില്ല. റിക്കവറി കോഡുകൾ ഉപയോഗിക്കൂ, അല്ലെങ്കിൽ ഓപ്പറേറ്ററോട് ചോദിക്കൂ.",
    bannerNew: (when, label) => `${when}-ന് ഒരു പുതിയ ഫോൺ ചേർത്തു${label ? ` (${label})` : ""}. നിങ്ങളല്ലേ? അത് നീക്കൂ.`, itWasMe: "ഞാൻ തന്നെയാണ്", removeIt: "നീക്കൂ",
    bannerRequest: (by, when) => `${by} നിങ്ങളുടെ കട തുറക്കുന്ന എല്ലാ ഫോണുകളും നീക്കാൻ ആവശ്യപ്പെട്ടു. നിങ്ങൾ റദ്ദാക്കിയില്ലെങ്കിൽ ${when}-ന് അത് നടക്കും.`, cancel: "അഭ്യർത്ഥന റദ്ദാക്കൂ", cancelled: "റദ്ദാക്കി. നിങ്ങളുടെ ഫോണുകൾ അതേപടി തുടരും.",
    labelNote: "ഓരോ ഫോണും ചേർക്കുമ്പോൾ സ്വയം പറഞ്ഞ പേരുകളാണ് ഇവ.",
    alertsTitle: "നിങ്ങളുടെ ഫോണുകളിലെ അലർട്ടുകൾ", alertsNote: "ഈ ഫോണുകൾക്ക് നിങ്ങളുടെ കടയുടെ അലർട്ടുകൾ കിട്ടുന്നു. നിങ്ങൾക്ക് അറിയാത്തത് നിർത്തൂ.", alertSince: (d) => `${d} മുതൽ അലർട്ടുകൾ`, stop: "നിർത്തൂ",
    bannerNumber: "ഓപ്പറേറ്ററുടെ പാനലിൽ ഉടമയുടെ നമ്പർ വേറൊന്നായി കാണിക്കുന്നു. നിങ്ങളുടെ സന്ദേശങ്ങൾ ഇപ്പോഴും നിങ്ങളുടെ നമ്പറിലേക്ക് തന്നെ വരുന്നു.",
    bannerOwner: (when) => `ഈ കടയുടെ ഉടമയുടെ നമ്പർ മാറ്റി. നിങ്ങൾ റദ്ദാക്കിയില്ലെങ്കിൽ കട തുറക്കുന്ന എല്ലാ ഫോണുകളും ${when}-ന് പ്രവർത്തിക്കില്ല.`,
    bannerCodesMade: (when, label) => `${when}-ന് പുതിയ റിക്കവറി കോഡുകൾ ഉണ്ടാക്കി${label ? ` (${label})` : ""}. നിങ്ങളല്ലേ? ആ ഫോൺ നീക്കൂ.`, bannerRemoved: (when, label) => `${when}-ന് ഒരു ഫോൺ നീക്കി${label ? ` (${label})` : ""}.`,
    bannerCodes: "നിങ്ങളുടെ സ്വന്തം കോഡുകൾ ഇപ്പോൾ ഉണ്ടാക്കൂ, അത് നിങ്ങളുടെ കയ്യിൽ മാത്രമിരിക്കട്ടെ.", makeCodes: "എന്റെ കോഡുകൾ ഉണ്ടാക്കൂ", refused: "അത് നടന്നില്ല. സൈൻ ഔട്ട് ചെയ്ത് ഫോണിന്റെ ഫിംഗർപ്രിന്റ് ഉപയോഗിച്ച് സൈൻ ഇൻ ചെയ്ത് വീണ്ടും ശ്രമിക്കൂ.", operator: "നിങ്ങളുടെ ഓപ്പറേറ്റർ", openPhones: "നിങ്ങളുടെ ഫോണുകൾ",
  },
  kn: {
    title: "ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಬಲ್ಲ ಫೋನ್‌ಗಳು", link: "ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಬಲ್ಲ ಫೋನ್‌ಗಳು", intro: "ಈ ಫೋನ್‌ಗಳು ಮಾತ್ರ ನಿಮ್ಮ ಅಂಗಡಿಯ ಆಪ್ ತೆರೆಯಬಲ್ಲವು. ನಿಮಗೆ ಗೊತ್ತಿಲ್ಲದ ಒಂದು ಕಂಡರೆ ಅದನ್ನು ತೆಗೆಯಿರಿ.",
    thisPhone: "ಈ ಫೋನ್", aPhone: "ಒಂದು ಫೋನ್", added: (d) => `${d} ರಂದು ಸೇರಿಸಲಾಗಿದೆ`,
    via: { setup: "ಸೆಟಪ್ QR ಕೋಡ್‌ನಿಂದ", recovery: "ರಿಕವರಿ ಕೋಡ್‌ನಿಂದ", own_code: "ನಿಮ್ಮ ಸ್ವಂತ ರಿಕವರಿ ಕೋಡ್‌ನಿಂದ", own_phone: "ನಿಮ್ಮ ಸ್ವಂತ ಫೋನ್‌ನಿಂದ", reset: "Geometer ನಿಮ್ಮ ಸೈನ್ ಇನ್ ರೀಸೆಟ್ ಮಾಡಿದ ನಂತರ" },
    lastUsed: (d) => `ಕೊನೆಯ ಬಳಕೆ ${d}`, neverUsed: "ಇನ್ನೂ ಬಳಸಿಲ್ಲ", remove: "ತೆಗೆಯಿರಿ", removeTitle: "ಈ ಫೋನ್ ತೆಗೆಯಬೇಕೇ?", removeAsk: (w) => `${w} ಇನ್ನು ಮುಂದೆ ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಲು ಆಗುವುದಿಲ್ಲ.`,
    removeYes: "ಹೌದು, ತೆಗೆಯಿರಿ", keep: "ಬೇಡ, ಇರಲಿ",
    lastTitle: "ಇದು ನಿಮ್ಮ ಒಂದೇ ಫೋನ್", lastAsk: "ಇದನ್ನು ತೆಗೆದರೆ ನಿಮ್ಮ ಸ್ವಂತ ರಿಕವರಿ ಕೋಡ್‌ಗಳಿಂದ ಅಥವಾ ಆಪರೇಟರ್ ಸಹಾಯದಿಂದ ಮಾತ್ರ ಮತ್ತೆ ಒಳಗೆ ಬರಬಹುದು; ಅದಕ್ಕೆ 2 ದಿನ ಹಿಡಿಯುತ್ತದೆ. ಆದರೂ ತೆಗೆಯಬೇಕೇ?", lastYes: "ಹೌದು, ನನ್ನ ಒಂದೇ ಫೋನ್ ತೆಗೆಯಿರಿ",
    removed: "ಆ ಫೋನ್ ತೆಗೆಯಲಾಗಿದೆ.", add: "ಫೋನ್ ಸೇರಿಸಿ", addNote: "ಈ ಪರದೆಯಲ್ಲಿ ಒಮ್ಮೆ ಮಾತ್ರ ಕೆಲಸ ಮಾಡುವ ಕೋಡ್ ತೋರಿಸುತ್ತದೆ. 15 ನಿಮಿಷದೊಳಗೆ ಹೊಸ ಫೋನ್‌ನ ಕ್ಯಾಮೆರಾದಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.",
    addTitle: "ಹೊಸ ಫೋನ್ ಸೇರಿಸಿ", addHow: (t) => `ಇದನ್ನು ಹೊಸ ಫೋನ್‌ನ ಕ್ಯಾಮೆರಾದಿಂದ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ, ಅದರ ಫಿಂಗರ್‌ಪ್ರಿಂಟ್ ರೀಡರ್ ಮುಟ್ಟಿ. ಇದು ಒಮ್ಮೆ ಮಾತ್ರ, ${t} ವರೆಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ.`,
    codes: "ನಿಮ್ಮ ಸ್ವಂತ ರಿಕವರಿ ಕೋಡ್‌ಗಳು", codesNone: "ನೀವು ಇನ್ನೂ ಸ್ವಂತ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿಲ್ಲ.", codesHave: (d) => `ನೀವು ${d} ರಂದು ಸ್ವಂತ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿದಿರಿ. ಅವು ನಿಮ್ಮ ಬಳಿ ಮಾತ್ರ ಇವೆ.`,
    codesMake: "ನನ್ನ ಸ್ವಂತ ರಿಕವರಿ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿ", codesRemake: "ಹೊಸ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿ", codesNote: "ಕೋಡ್‌ಗಳು ಒಮ್ಮೆ ಮಾತ್ರ ತೋರುತ್ತವೆ. ಆಪರೇಟರ್ ಪ್ರಿಂಟ್ ಮಾಡಿದ ಕೋಡ್‌ಗಳು ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ.",
    codesTitle: "ನಿಮ್ಮ ರಿಕವರಿ ಕೋಡ್‌ಗಳು", codesShow: "ಇವನ್ನು ಬರೆದಿಟ್ಟು ಸುರಕ್ಷಿತವಾಗಿ ಇಡಿ. ಪ್ರತಿಯೊಂದೂ ಒಮ್ಮೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ, ಮತ್ತೆ ತೋರಿಸುವುದಿಲ್ಲ. ಆಪರೇಟರ್ ಪ್ರಿಂಟ್ ಮಾಡಿದ ಕೋಡ್‌ಗಳು ಇನ್ನು ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ.",
    needPasskey: "ಕೋಡ್ ಮಾಡಲು ಅಥವಾ ಫೋನ್ ಸೇರಿಸಲು ಸೈನ್ ಔಟ್ ಆಗಿ, ಫೋನ್‌ನ ಫಿಂಗರ್‌ಪ್ರಿಂಟ್ ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್‌ನಿಂದ ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.", back: "ನಿಮ್ಮ ಅಂಗಡಿಗೆ ಹಿಂತಿರುಗಿ",
    onePhone: "ಈಗ ಒಂದು ಫೋನ್ ಮಾತ್ರ ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಬಲ್ಲದು.", noPhones: "ಈಗ ಯಾವ ಫೋನ್ ಕೂಡ ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯಲಾರದು. ರಿಕವರಿ ಕೋಡ್‌ಗಳನ್ನು ಬಳಸಿ, ಅಥವಾ ಆಪರೇಟರ್ ಅವರನ್ನು ಕೇಳಿ.",
    bannerNew: (when, label) => `${when} ರಂದು ಹೊಸ ಫೋನ್ ಸೇರಿಸಲಾಗಿದೆ${label ? ` (${label})` : ""}. ನೀವಲ್ಲವೇ? ಅದನ್ನು ತೆಗೆಯಿರಿ.`, itWasMe: "ನಾನೇ", removeIt: "ತೆಗೆಯಿರಿ",
    bannerRequest: (by, when) => `${by} ನಿಮ್ಮ ಅಂಗಡಿ ತೆರೆಯುವ ಎಲ್ಲಾ ಫೋನ್‌ಗಳನ್ನು ತೆಗೆಯಲು ಕೇಳಿದ್ದಾರೆ. ನೀವು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ ${when} ರಂದು ಆಗುತ್ತದೆ.`, cancel: "ಮನವಿ ರದ್ದುಗೊಳಿಸಿ", cancelled: "ರದ್ದಾಗಿದೆ. ನಿಮ್ಮ ಫೋನ್‌ಗಳು ಹಾಗೆಯೇ ಇರುತ್ತವೆ.",
    labelNote: "ಪ್ರತಿ ಫೋನ್ ಸೇರಿಸುವಾಗ ತನ್ನ ಬಗ್ಗೆ ಹೇಳಿದ ಹೆಸರುಗಳು ಇವು.",
    alertsTitle: "ನಿಮ್ಮ ಫೋನ್‌ಗಳಲ್ಲಿನ ಅಲರ್ಟ್‌ಗಳು", alertsNote: "ಈ ಫೋನ್‌ಗಳಿಗೆ ನಿಮ್ಮ ಅಂಗಡಿಯ ಅಲರ್ಟ್‌ಗಳು ಬರುತ್ತವೆ. ನಿಮಗೆ ಗೊತ್ತಿಲ್ಲದ್ದನ್ನು ನಿಲ್ಲಿಸಿ.", alertSince: (d) => `${d} ರಿಂದ ಅಲರ್ಟ್‌ಗಳು`, stop: "ನಿಲ್ಲಿಸಿ",
    bannerNumber: "ಆಪರೇಟರ್‌ನ ಪ್ಯಾನೆಲ್‌ನಲ್ಲಿ ಮಾಲೀಕರ ನಂಬರ್ ಬೇರೆಯಾಗಿ ತೋರುತ್ತಿದೆ. ನಿಮ್ಮ ಸಂದೇಶಗಳು ಈಗಲೂ ನಿಮ್ಮ ನಂಬರ್‌ಗೇ ಬರುತ್ತವೆ.",
    bannerOwner: (when) => `ಈ ಅಂಗಡಿಯ ಮಾಲೀಕರ ನಂಬರ್ ಬದಲಾಯಿಸಲಾಗಿದೆ. ನೀವು ರದ್ದುಗೊಳಿಸದಿದ್ದರೆ ಅಂಗಡಿ ತೆರೆಯುವ ಎಲ್ಲಾ ಫೋನ್‌ಗಳು ${when} ರಂದು ಕೆಲಸ ಮಾಡುವುದಿಲ್ಲ.`,
    bannerCodesMade: (when, label) => `${when} ರಂದು ಹೊಸ ರಿಕವರಿ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಲಾಗಿದೆ${label ? ` (${label})` : ""}. ನೀವಲ್ಲವೇ? ಆ ಫೋನ್ ತೆಗೆಯಿರಿ.`, bannerRemoved: (when, label) => `${when} ರಂದು ಒಂದು ಫೋನ್ ತೆಗೆಯಲಾಗಿದೆ${label ? ` (${label})` : ""}.`,
    bannerCodes: "ನಿಮ್ಮ ಸ್ವಂತ ಕೋಡ್‌ಗಳನ್ನು ಈಗಲೇ ಮಾಡಿ, ಅವು ನಿಮ್ಮ ಬಳಿ ಮಾತ್ರ ಇರಲಿ.", makeCodes: "ನನ್ನ ಕೋಡ್‌ಗಳನ್ನು ಮಾಡಿ", refused: "ಅದು ಆಗಲಿಲ್ಲ. ಸೈನ್ ಔಟ್ ಆಗಿ, ಫೋನ್‌ನ ಫಿಂಗರ್‌ಪ್ರಿಂಟ್‌ನಿಂದ ಸೈನ್ ಇನ್ ಮಾಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.", operator: "ನಿಮ್ಮ ಆಪರೇಟರ್", openPhones: "ನಿಮ್ಮ ಫೋನ್‌ಗಳು",
  },
};

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
/** The content policy of every page here: no script anywhere, forms to this site only. */
export const PHONES_POLICY = CSP;

const shell = (language: Language, title: string, body: Raw): string =>
  `<!doctype html>${html`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="same-origin"><title>${title}</title><style>${raw(OWNER_CSS)}</style></head><body>
<main class="wrap">${body}</main></body></html>`.markup}`;

const csrfField = (csrf: string | undefined): Raw => (csrf ? html`<input type="hidden" name="csrf" value="${csrf}">` : html``);
const labelOf = (p: { label?: string }, w: Words): string => p.label ?? w.aPhone;

/** A small form that posts one tap to <base>/phones/<what>. */
const tap = (base: string, what: string, csrf: string | undefined, label: string, fields: Record<string, string> = {}, quiet = false): Raw =>
  html`<form method="post" action="${base}/phones/${what}">${csrfField(csrf)}${Object.entries(fields).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<button type="submit" class="${quiet ? "no" : ""}">${label}</button></form>`;

/**
 * The banners at the top of the owner's other pages (the main page, listings, stock, limits): the Operator's pending request (with Cancel), a phone added since this phone
 * last looked (with Remove it and It was me), and the prompt to make the owner's own codes. Empty when there is nothing to say.
 */
export function phonesBanner(o: { base: string; language: Language; csrf?: string; view: PhonesAnswer; operatorName?: string }): string {
  const w = WORDS[o.language];
  const v = o.view;
  const parts: Raw[] = [];
  if (v.removal) parts.push(html`<div class="notice" role="alert"><p>${v.removal.kind === "owner_change" ? w.bannerOwner(dayAndTime(v.removal.effectiveAt, o.language)) : w.bannerRequest(v.removal.askedBy || o.operatorName || w.operator, dayAndTime(v.removal.effectiveAt, o.language))}</p>${tap(o.base, "cancel", o.csrf, w.cancel)}</div>`);
  // "It was me" dismisses up to the moment these banners reach (v.seenThrough), not to whatever happened after the page was drawn
  const dismiss = tap(o.base, "dismiss", o.csrf, w.itWasMe, { through: String(v.seenThrough) }, true);
  for (const p of v.announce.slice(-3)) {
    parts.push(html`<div class="notice" role="alert"><p>${w.bannerNew(dayAndTime(p.madeAt, o.language), p.label ?? "")}</p>
<p><a class="btn" href="${o.base}/phones?remove=${p.id}&amp;lang=${o.language}">${w.removeIt}</a></p>${dismiss}</div>`);
  }
  for (const n of v.news.slice(-3)) {
    parts.push(html`<div class="notice" role="alert"><p>${n.kind === "codes" ? w.bannerCodesMade(dayAndTime(n.at, o.language), n.label ?? "") : w.bannerRemoved(dayAndTime(n.at, o.language), n.label ?? "")}</p>${dismiss}</div>`);
  }
  if (v.numberDiffers) parts.push(html`<div class="notice" role="status"><p>${w.bannerNumber}</p></div>`);
  // the prompt only for a phone that can do it (a passkey session) and once the owner holds a phone of their own: right after the first sign-in
  if (v.ownCodesAt === undefined && v.passkeySession && v.phones.length > 0) parts.push(html`<div class="notice" role="status"><p>${w.bannerCodes}</p>${tap(o.base, "codes", o.csrf, w.makeCodes)}</div>`);
  return parts.map((p) => p.markup).join("");
}

/** Put a banner at the top of an owner page: just inside its first <main class="wrap">, which every owner page has. A page without one is left as it is. */
export const withBanner = (page: string, banner: string): string => (banner === "" ? page : page.replace('<main class="wrap">', `<main class="wrap">${banner}`));

/** The phones page. `notice`: what happened a moment ago. `help`: the "write to Geometer" line, only on Geometer's own Operator server. */
export function phonesPage(o: { base: string; language: Language; csrf?: string; view: PhonesAnswer; notice?: "removed" | "cancelled" | "refused"; hosted: boolean; signOut?: { action: string; label: string } }): string {
  const w = WORDS[o.language];
  const v = o.view;
  const lang = o.language;
  const rows = v.phones.map((p) => html`<section class="card"><h2>${labelOf(p, w)}${p.mine ? html` <small class="note">· ${w.thisPhone}</small>` : ""}</h2>
<p class="note">${w.added(dayOnly(p.madeAt, lang))}, ${w.via[p.via as keyof Words["via"]] ?? w.via.setup}<br>${p.usedAt !== undefined ? w.lastUsed(dayAndTime(p.usedAt, lang)) : w.neverUsed}</p>
${v.passkeySession ? html`<p><a class="btn quiet" href="${o.base}/phones?remove=${p.id}&amp;lang=${lang}">${w.remove}</a></p>` : ""}</section>`);
  const state = v.phones.length === 0 ? html`<p class="notice">${w.noPhones}</p>` : v.phones.length === 1 ? html`<p class="note">${w.onePhone}</p>` : "";
  const banners = phonesBanner({ base: o.base, language: lang, ...(o.csrf ? { csrf: o.csrf } : {}), view: v });
  const codes = html`<h2>${w.codes}</h2>${v.ownCodesAt !== undefined ? html`<p class="calm">${w.codesHave(dayOnly(v.ownCodesAt, lang))}</p>` : html`<p class="note">${w.codesNone}</p>`}
<p class="note">${w.codesNote}</p>${v.passkeySession ? tap(o.base, "codes", o.csrf, v.ownCodesAt !== undefined ? w.codesRemake : w.codesMake, {}, v.ownCodesAt !== undefined) : html`<p class="notice">${w.needPasskey}</p>${o.signOut ? html`<form method="post" action="${o.signOut.action}">${csrfField(o.csrf)}<button class="no full" type="submit">${o.signOut.label}</button></form>` : ""}`}`;
  // the alerts that reach the owner, each with the phone it came from; a passkey session may stop one (so an alert the owner does not know can be ended)
  const alertsList = (v.alerts ?? []).length === 0 ? "" : html`<h2>${w.alertsTitle}</h2><p class="note">${w.alertsNote}</p>${(v.alerts ?? []).map((a) => html`<section class="card"><h3>${a.label ?? w.aPhone}</h3><p class="note">${w.alertSince(dayOnly(a.madeAt, lang))}</p>${v.passkeySession ? tap(o.base, "alert-stop", o.csrf, w.stop, { id: a.id }, true) : ""}</section>`)}`;
  const add = v.passkeySession ? html`<h2>${w.add}</h2><p class="note">${w.addNote}</p>${tap(o.base, "add", o.csrf, w.add, {}, true)}` : "";
  return shell(lang, w.title, html`<h1>${w.title}</h1>
${o.notice ? html`<p class="notice" role="status">${o.notice === "removed" ? w.removed : o.notice === "cancelled" ? w.cancelled : w.refused}</p>` : ""}
${raw(banners)}<p class="note">${w.intro}</p>${state}${rows}${v.phones.length > 0 ? html`<p class="note">${w.labelNote}</p>` : ""}${add}${alertsList}${codes}
${o.hosted ? html`<p class="note">${LOST_HELP[lang]}</p>` : ""}
<p><a href="${o.base}/?lang=${lang}">${w.back}</a></p>`);
}

/**
 * The confirm page for removing one phone. The first confirm is for every phone; for the LAST one the runtime refuses a plain remove, and this page is shown a second
 * time in stronger words (`last`) whose button sends the runtime's explicit "confirm_last". The owner is asked twice, in plain words, before the only phone goes.
 */
export function removePhonePage(o: { base: string; language: Language; csrf?: string; id: string; label?: string; last: boolean }): string {
  const w = WORDS[o.language];
  const what = o.label ?? w.aPhone;
  return shell(o.language, o.last ? w.lastTitle : w.removeTitle, html`<h1>${o.last ? w.lastTitle : w.removeTitle}</h1>
<p>${o.last ? w.lastAsk : w.removeAsk(what)}</p>
<form method="post" action="${o.base}/phones/remove">${csrfField(o.csrf)}<input type="hidden" name="id" value="${o.id}"><input type="hidden" name="lang" value="${o.language}">${o.last ? html`<input type="hidden" name="confirm_last" value="yes">` : ""}<button type="submit" class="full">${o.last ? w.lastYes : w.removeYes}</button></form>
<p><a class="btn quiet full" href="${o.base}/phones?lang=${o.language}">${w.keep}</a></p>`);
}

/** The owner's new recovery codes, shown ONCE (the page is sent with no-store and not kept anywhere). */
export function ownCodesPage(o: { base: string; language: Language; codes: readonly string[] }): string {
  const w = WORDS[o.language];
  return shell(o.language, w.codesTitle, html`<h1>${w.codesTitle}</h1><p class="notice" role="note">${w.codesShow}</p>
<ol class="codes">${o.codes.map((c) => html`<li><code>${printedCode(c)}</code></li>`)}</ol>
<p><a class="btn" href="${o.base}/phones?lang=${o.language}">${w.back}</a></p>`);
}

/** "Add a phone": the one-use address as a QR, for the new phone's camera. Shown once. */
export function addPhonePage(o: { base: string; language: Language; url: string; expiresAt: number }): string {
  const w = WORDS[o.language];
  return shell(o.language, w.addTitle, html`<h1>${w.addTitle}</h1><p>${w.addHow(dayAndTime(o.expiresAt, o.language))}</p>
<figure class="qr">${raw(textQrSvg(`${o.url}?lang=${o.language}`, { width: 280 }))}</figure>
<p class="note"><code class="addr">${o.url}</code></p>
<p><a class="btn quiet" href="${o.base}/phones?lang=${o.language}">${w.back}</a></p>`);
}
