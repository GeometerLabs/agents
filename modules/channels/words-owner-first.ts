// The words of the owner's first sign-in and of "who to call" (release-flow batches 3 and 5, 14 Nov 2026): the passkey page's "open this in Chrome" and "your phone needs
// a screen lock" lines, the "not ready yet" line for a QR scanned in its first seconds, the alerts' second step and top line on the owner's app, the partner's name
// with its call and WhatsApp links, and the shop's own call and map links on the customer pages. One small file, so these lines do not sit among the long per-language
// records of words.ts. English is the source; Hindi, Malayalam and Kannada are machine-written and wait for a native reader (plan item 12). The pages that use them
// already say so in that language (PAGE[language].machine).
import type { Language } from "../language/languages.ts";

export interface FirstWords {
  chromeTitle: string; chromeBody: string; chromeOpen: string; chromeCopy: string; chromeCopied: string;
  noLock: string; notYet: string;
  step2: string; step2Intro: string; alertsOn: (phones: number) => string; alertsOff: string; alertsTurnOn: string;
  partner: (name: string) => string; partnerNoName: string; call: string; whatsapp: string;
  shopCall: string; shopMap: string;
  /** The booking page's "send me this link" (batch 5): a WhatsApp share link, so a customer can keep their private link in their own chat. */
  sendLink: string; sendLinkNote: string;
}

export const FIRST_WORDS: Record<Language, FirstWords> = {
  en: {
    chromeTitle: "This page needs Chrome", chromeBody: "This browser can't set up sign-in on your phone. Open this page in Chrome, or copy the link and paste it into Chrome.",
    chromeOpen: "Open in Chrome", chromeCopy: "Copy link", chromeCopied: "Link copied. Paste it in Chrome.",
    noLock: "Your phone needs a screen lock (PIN, pattern or fingerprint). Set one in Settings, then press again.",
    notYet: "This code isn't working yet. If your partner just showed it, wait 15 seconds and open it again. If it still fails, ask for a new one.",
    step2: "Step 2 of 2: turn on alerts", step2Intro: "Sign-in is done. Now turn on alerts, so this phone buzzes when a payment or a refund needs you.",
    alertsOn: (n) => (n === 1 ? "Alerts: on, on 1 phone" : `Alerts: on, on ${n} phones`), alertsOff: "Alerts: off. You will not hear when something needs you.", alertsTurnOn: "Turn on alerts",
    partner: (name) => `Your partner: ${name}`, partnerNoName: "Your partner", call: "Call", whatsapp: "WhatsApp",
    shopCall: "Call the shop", shopMap: "Find us on the map",
    sendLink: "Send this link to my WhatsApp", sendLinkNote: "This page is the only way to see or cancel your booking. Send the link to yourself to keep it.",
  },
  hi: {
    chromeTitle: "इस पेज के लिए Chrome चाहिए", chromeBody: "यह ब्राउज़र आपके फ़ोन पर साइन-इन नहीं बना सकता। इस पेज को Chrome में खोलिए, या लिंक कॉपी करके Chrome में चिपकाइए।",
    chromeOpen: "Chrome में खोलें", chromeCopy: "लिंक कॉपी करें", chromeCopied: "लिंक कॉपी हो गया। इसे Chrome में चिपकाइए।",
    noLock: "आपके फ़ोन में स्क्रीन लॉक (PIN, पैटर्न या फ़िंगरप्रिंट) होना चाहिए। सेटिंग्स में लगाइए, फिर दोबारा दबाइए।",
    notYet: "यह कोड अभी काम नहीं कर रहा। अगर पार्टनर ने अभी दिखाया है तो 15 सेकंड रुकिए और फिर खोलिए। फिर भी न चले तो नया माँगिए।",
    step2: "दूसरा कदम (2 में से): अलर्ट चालू करें", step2Intro: "साइन-इन हो गया। अब अलर्ट चालू कीजिए, ताकि भुगतान या रिफ़ंड को आपकी ज़रूरत हो तो यह फ़ोन बजे।",
    alertsOn: (n) => `अलर्ट: चालू, ${n} फ़ोन पर`, alertsOff: "अलर्ट: बंद। कुछ ज़रूरी हो तो आपको पता नहीं चलेगा।", alertsTurnOn: "अलर्ट चालू करें",
    partner: (name) => `आपके पार्टनर: ${name}`, partnerNoName: "आपके पार्टनर", call: "कॉल करें", whatsapp: "WhatsApp",
    shopCall: "दुकान को कॉल करें", shopMap: "नक्शे पर देखें",
    sendLink: "यह लिंक मेरे WhatsApp पर भेजें", sendLinkNote: "अपनी बुकिंग देखने या रद्द करने का यही एक पेज है। लिंक को खुद को भेज लीजिए, ताकि रहे।",
  },
  ml: {
    chromeTitle: "ഈ പേജിന് Chrome വേണം", chromeBody: "ഈ ബ്രൗസറിന് നിങ്ങളുടെ ഫോണിൽ സൈൻ ഇൻ സജ്ജമാക്കാനാവില്ല. ഈ പേജ് Chrome-ൽ തുറക്കൂ, അല്ലെങ്കിൽ ലിങ്ക് കോപ്പി ചെയ്ത് Chrome-ൽ പേസ്റ്റ് ചെയ്യൂ.",
    chromeOpen: "Chrome-ൽ തുറക്കൂ", chromeCopy: "ലിങ്ക് കോപ്പി ചെയ്യൂ", chromeCopied: "ലിങ്ക് കോപ്പി ചെയ്തു. Chrome-ൽ പേസ്റ്റ് ചെയ്യൂ.",
    noLock: "നിങ്ങളുടെ ഫോണിന് സ്ക്രീൻ ലോക്ക് (PIN, പാറ്റേൺ അല്ലെങ്കിൽ വിരലടയാളം) വേണം. സെറ്റിംഗ്സിൽ സജ്ജമാക്കി വീണ്ടും അമർത്തൂ.",
    notYet: "ഈ കോഡ് ഇപ്പോൾ പ്രവർത്തിക്കുന്നില്ല. പങ്കാളി ഇപ്പോൾ കാണിച്ചതാണെങ്കിൽ 15 സെക്കൻഡ് കാത്ത് വീണ്ടും തുറക്കൂ. എന്നിട്ടും ശരിയായില്ലെങ്കിൽ പുതിയത് ചോദിക്കൂ.",
    step2: "ഘട്ടം 2 / 2: അലേർട്ടുകൾ ഓണാക്കൂ", step2Intro: "സൈൻ ഇൻ കഴിഞ്ഞു. ഇനി അലേർട്ടുകൾ ഓണാക്കൂ, പേയ്‌മെന്റോ റീഫണ്ടോ നിങ്ങളെ കാത്തിരിക്കുമ്പോൾ ഈ ഫോൺ അറിയിക്കും.",
    alertsOn: (n) => `അലേർട്ടുകൾ: ഓൺ, ${n} ഫോണിൽ`, alertsOff: "അലേർട്ടുകൾ: ഓഫ്. എന്തെങ്കിലും വേണ്ടപ്പോൾ നിങ്ങൾ അറിയില്ല.", alertsTurnOn: "അലേർട്ടുകൾ ഓണാക്കൂ",
    partner: (name) => `നിങ്ങളുടെ പങ്കാളി: ${name}`, partnerNoName: "നിങ്ങളുടെ പങ്കാളി", call: "വിളിക്കൂ", whatsapp: "WhatsApp",
    shopCall: "കടയെ വിളിക്കൂ", shopMap: "മാപ്പിൽ കാണൂ",
    sendLink: "ഈ ലിങ്ക് എന്റെ WhatsApp-ലേക്ക് അയയ്ക്കൂ", sendLinkNote: "ബുക്കിംഗ് കാണാനോ റദ്ദാക്കാനോ ഉള്ള ഒരേയൊരു വഴി ഈ പേജാണ്. ലിങ്ക് സൂക്ഷിക്കാൻ സ്വയം അയച്ചുവയ്ക്കൂ.",
  },
  kn: {
    chromeTitle: "ಈ ಪುಟಕ್ಕೆ Chrome ಬೇಕು", chromeBody: "ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ನಿಮ್ಮ ಫೋನ್‌ನ ಸೈನ್ ಇನ್ ಹೊಂದಿಸಲು ಆಗುವುದಿಲ್ಲ. ಈ ಪುಟವನ್ನು Chrome ನಲ್ಲಿ ತೆರೆಯಿರಿ, ಅಥವಾ ಲಿಂಕ್ ನಕಲಿಸಿ Chrome ನಲ್ಲಿ ಅಂಟಿಸಿ.",
    chromeOpen: "Chrome ನಲ್ಲಿ ತೆರೆಯಿರಿ", chromeCopy: "ಲಿಂಕ್ ನಕಲಿಸಿ", chromeCopied: "ಲಿಂಕ್ ನಕಲಾಗಿದೆ. Chrome ನಲ್ಲಿ ಅಂಟಿಸಿ.",
    noLock: "ನಿಮ್ಮ ಫೋನ್‌ಗೆ ಸ್ಕ್ರೀನ್ ಲಾಕ್ (PIN, ಪ್ಯಾಟರ್ನ್ ಅಥವಾ ಬೆರಳಚ್ಚು) ಬೇಕು. ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ ಹೊಂದಿಸಿ, ಮತ್ತೆ ಒತ್ತಿ.",
    notYet: "ಈ ಕೋಡ್ ಇನ್ನೂ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ. ಪಾಲುದಾರರು ಈಗಷ್ಟೇ ತೋರಿಸಿದ್ದರೆ 15 ಸೆಕೆಂಡ್ ಕಾದು ಮತ್ತೆ ತೆರೆಯಿರಿ. ಆದರೂ ಆಗದಿದ್ದರೆ ಹೊಸದನ್ನು ಕೇಳಿ.",
    step2: "ಹಂತ 2 / 2: ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆನ್ ಮಾಡಿ", step2Intro: "ಸೈನ್ ಇನ್ ಆಯಿತು. ಈಗ ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆನ್ ಮಾಡಿ, ಪಾವತಿ ಅಥವಾ ಮರುಪಾವತಿಗೆ ನಿಮ್ಮ ಅಗತ್ಯವಿದ್ದಾಗ ಈ ಫೋನ್ ತಿಳಿಸುತ್ತದೆ.",
    alertsOn: (n) => `ಎಚ್ಚರಿಕೆಗಳು: ಆನ್, ${n} ಫೋನ್‌ನಲ್ಲಿ`, alertsOff: "ಎಚ್ಚರಿಕೆಗಳು: ಆಫ್. ಏನಾದರೂ ಬೇಕಾದಾಗ ನಿಮಗೆ ಗೊತ್ತಾಗುವುದಿಲ್ಲ.", alertsTurnOn: "ಎಚ್ಚರಿಕೆಗಳನ್ನು ಆನ್ ಮಾಡಿ",
    partner: (name) => `ನಿಮ್ಮ ಪಾಲುದಾರರು: ${name}`, partnerNoName: "ನಿಮ್ಮ ಪಾಲುದಾರರು", call: "ಕರೆ ಮಾಡಿ", whatsapp: "WhatsApp",
    shopCall: "ಅಂಗಡಿಗೆ ಕರೆ ಮಾಡಿ", shopMap: "ನಕ್ಷೆಯಲ್ಲಿ ನೋಡಿ",
    sendLink: "ಈ ಲಿಂಕ್ ನನ್ನ WhatsApp ಗೆ ಕಳುಹಿಸಿ", sendLinkNote: "ಬುಕಿಂಗ್ ನೋಡಲು ಅಥವಾ ರದ್ದು ಮಾಡಲು ಈ ಪುಟವೊಂದೇ ದಾರಿ. ಲಿಂಕ್ ಉಳಿಸಿಕೊಳ್ಳಲು ನಿಮಗೇ ಕಳುಹಿಸಿಕೊಳ್ಳಿ.",
  },
};
