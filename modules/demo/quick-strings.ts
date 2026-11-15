// The words on the hosted demo's screens (quick.ts), in the four languages. Only the demo's chrome is here: what the agent says to the customer, the parent and the owner
// is the template's own text (src/language/), never written again for the demo.
// MACHINE-WRITTEN (14 November 2026): the hi, ml and kn lines need a native speaker's review before Operators or shops rely on them (modules/Deferred.md lists this).
import type { Language } from "../language/languages.ts";

export interface QuickWords {
  banner: string;
  /** The tab for the person writing to the shop; a template may override it (Fees: the parent). */
  customer: string;
  owner: string;
  ownerEmpty: string;
  chatEmpty: string;
  typeHere: string;
  typeOwner: string;
  send: string;
  pay: string;
  time1h: string;
  time1d: string;
  reset: string;
  trySaying: string;
  clock: string;
  language: string;
  choose: string;
  full: string;
  note: string;
  /** The page's title, before the template's name. */
  title: string;
}

export const QUICK_WORDS: Record<Language, QuickWords> = {
  en: {
    banner: "Demo · test money · nothing real is sent", customer: "Customer", owner: "Owner", ownerEmpty: "Nothing for the owner yet.",
    chatEmpty: "No messages yet. Tap a suggestion or type as the customer.", typeHere: "Type as the customer…", typeOwner: "Type as the owner…", send: "Send",
    pay: "Pay with test money", time1h: "1 hour passes", time1d: "1 day passes", reset: "Start again", trySaying: "Try saying", clock: "Demo clock", language: "Language",
    choose: "Choose", full: "This demo has had a lot of messages. Press Start again.",
    note: "Practice stand-ins for WhatsApp and payments. Nothing is saved: it starts fresh each time it is opened.", title: "Demo",
  },
  hi: {
    banner: "डेमो · टेस्ट पैसा · कुछ भी असली नहीं भेजा जाता", customer: "ग्राहक", owner: "मालिक", ownerEmpty: "मालिक के लिए अभी कुछ नहीं।",
    chatEmpty: "अभी कोई संदेश नहीं। कोई सुझाव दबाइए या ग्राहक की तरह लिखिए।", typeHere: "ग्राहक की तरह लिखें…", typeOwner: "मालिक की तरह लिखें…", send: "भेजें",
    pay: "टेस्ट पैसे से भुगतान करें", time1h: "1 घंटा बीतता है", time1d: "1 दिन बीतता है", reset: "फिर से शुरू करें", trySaying: "ये लिखकर देखें", clock: "डेमो घड़ी", language: "भाषा",
    choose: "चुनिए", full: "इस डेमो में बहुत संदेश हो गए। 'फिर से शुरू करें' दबाइए।",
    note: "WhatsApp और पेमेंट की जगह अभ्यास वाले नकली सिस्टम हैं। कुछ भी सहेजा नहीं जाता: हर बार खोलने पर नए सिरे से शुरू होता है।", title: "डेमो",
  },
  ml: {
    banner: "ഡെമോ · ടെസ്റ്റ് പണം · യഥാർത്ഥമായി ഒന്നും അയയ്ക്കില്ല", customer: "കസ്റ്റമർ", owner: "ഉടമ", ownerEmpty: "ഉടമയ്ക്ക് ഇതുവരെ ഒന്നുമില്ല.",
    chatEmpty: "ഇതുവരെ സന്ദേശങ്ങളില്ല. ഒരു നിർദ്ദേശം തൊടൂ, അല്ലെങ്കിൽ കസ്റ്റമറായി ടൈപ്പ് ചെയ്യൂ.", typeHere: "കസ്റ്റമറായി ടൈപ്പ് ചെയ്യൂ…", typeOwner: "ഉടമയായി ടൈപ്പ് ചെയ്യൂ…", send: "അയയ്ക്കൂ",
    pay: "ടെസ്റ്റ് പണം അടയ്ക്കൂ", time1h: "1 മണിക്കൂർ കഴിയുന്നു", time1d: "1 ദിവസം കഴിയുന്നു", reset: "വീണ്ടും തുടങ്ങൂ", trySaying: "ഇങ്ങനെ പറഞ്ഞുനോക്കൂ", clock: "ഡെമോ ക്ലോക്ക്", language: "ഭാഷ",
    choose: "തിരഞ്ഞെടുക്കൂ", full: "ഈ ഡെമോയിൽ ഒരുപാട് സന്ദേശങ്ങളായി. 'വീണ്ടും തുടങ്ങൂ' അമർത്തൂ.",
    note: "WhatsApp-നും പേയ്മെന്റിനും പകരം പരിശീലന മാതൃകകളാണ്. ഒന്നും സൂക്ഷിക്കില്ല: തുറക്കുമ്പോഴെല്ലാം പുതിയതായി തുടങ്ങും.", title: "ഡെമോ",
  },
  kn: {
    banner: "ಡೆಮೊ · ಟೆಸ್ಟ್ ಹಣ · ನಿಜವಾದದ್ದು ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ", customer: "ಗ್ರಾಹಕ", owner: "ಮಾಲೀಕ", ownerEmpty: "ಮಾಲೀಕರಿಗೆ ಇನ್ನೂ ಏನೂ ಇಲ್ಲ.",
    chatEmpty: "ಇನ್ನೂ ಸಂದೇಶಗಳಿಲ್ಲ. ಒಂದು ಸಲಹೆಯನ್ನು ಒತ್ತಿ ಅಥವಾ ಗ್ರಾಹಕರಂತೆ ಟೈಪ್ ಮಾಡಿ.", typeHere: "ಗ್ರಾಹಕರಂತೆ ಟೈಪ್ ಮಾಡಿ…", typeOwner: "ಮಾಲೀಕರಂತೆ ಟೈಪ್ ಮಾಡಿ…", send: "ಕಳುಹಿಸಿ",
    pay: "ಟೆಸ್ಟ್ ಹಣ ಪಾವತಿಸಿ", time1h: "1 ಗಂಟೆ ಕಳೆಯುತ್ತದೆ", time1d: "1 ದಿನ ಕಳೆಯುತ್ತದೆ", reset: "ಮತ್ತೆ ಶುರು ಮಾಡಿ", trySaying: "ಹೀಗೆ ಹೇಳಿ ನೋಡಿ", clock: "ಡೆಮೊ ಗಡಿಯಾರ", language: "ಭಾಷೆ",
    choose: "ಆಯ್ಕೆ ಮಾಡಿ", full: "ಈ ಡೆಮೊದಲ್ಲಿ ತುಂಬಾ ಸಂದೇಶಗಳಾದವು. 'ಮತ್ತೆ ಶುರು ಮಾಡಿ' ಒತ್ತಿ.",
    note: "WhatsApp ಮತ್ತು ಪಾವತಿಯ ಬದಲು ಅಭ್ಯಾಸದ ಮಾದರಿಗಳಿವೆ. ಏನನ್ನೂ ಉಳಿಸುವುದಿಲ್ಲ: ತೆರೆದಾಗಲೆಲ್ಲ ಹೊಸದಾಗಿ ಶುರುವಾಗುತ್ತದೆ.", title: "ಡೆಮೊ",
  },
};

/** The name of each language in its own letters: the choice at the top of the page. */
export const QUICK_LANGUAGE_NAMES: Record<Language, string> = { en: "English", hi: "हिन्दी", ml: "മലയാളം", kn: "ಕನ್ನಡ" };
