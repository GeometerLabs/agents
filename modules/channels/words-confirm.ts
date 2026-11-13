// The words item 11h adds to a customer's own page (the confirmation page, decision 45) and the keyboard-mic hint, in four languages. Hindi, Malayalam and
// Kannada are machine-written and wait for a native reader (plan item 12), like the rest of the page's words (words.ts), and each page says so in that language.
//
// The refund line says only what the shop's record holds: a refund the owner is deciding on, one that is on its way (the owner still has to send it, on a UPI
// shop), one the owner marked sent, or a deposit the shop kept. It never says the money arrived: only the customer's bank knows that.
import type { Language } from "../language/languages.ts";

export interface ConfirmWords {
  ics: string; icsNote: string;
  refund: { asked: (amount: string) => string; owed: (amount: string) => string; sent: (amount: string) => string; kept: (amount: string) => string };
}
export const CONFIRM: Record<Language, ConfirmWords> = {
  en: {
    ics: "Add to my calendar", icsNote: "Your phone's calendar reminds you, even without WhatsApp.",
    refund: { asked: (a) => `The shop is deciding about a refund of ${a}.`, owed: (a) => `Your refund of ${a} is on its way from the shop.`, sent: (a) => `The shop has sent your refund of ${a}.`, kept: (a) => `The shop decided to keep the deposit of ${a}.` },
  },
  hi: {
    ics: "मेरे कैलेंडर में जोड़ें", icsNote: "आपके फ़ोन का कैलेंडर याद दिला देगा, WhatsApp के बिना भी।",
    refund: { asked: (a) => `${a} के रिफ़ंड पर दुकान फ़ैसला कर रही है।`, owed: (a) => `${a} का रिफ़ंड दुकान से आपके पास आ रहा है।`, sent: (a) => `दुकान ने आपका ${a} का रिफ़ंड भेज दिया है।`, kept: (a) => `दुकान ने ${a} की जमा राशि रखने का फ़ैसला किया है।` },
  },
  ml: {
    ics: "എന്റെ കലണ്ടറിൽ ചേർക്കൂ", icsNote: "WhatsApp ഇല്ലെങ്കിലും നിങ്ങളുടെ ഫോണിലെ കലണ്ടർ ഓർമിപ്പിക്കും.",
    refund: { asked: (a) => `${a} റീഫണ്ടിനെക്കുറിച്ച് കട തീരുമാനിക്കുന്നു.`, owed: (a) => `${a} റീഫണ്ട് കടയിൽ നിന്ന് നിങ്ങളിലേക്ക് വരുന്നു.`, sent: (a) => `കട നിങ്ങളുടെ ${a} റീഫണ്ട് അയച്ചു.`, kept: (a) => `${a} അഡ്വാൻസ് സൂക്ഷിക്കാൻ കട തീരുമാനിച്ചു.` },
  },
  kn: {
    ics: "ನನ್ನ ಕ್ಯಾಲೆಂಡರ್‌ಗೆ ಸೇರಿಸಿ", icsNote: "WhatsApp ಇಲ್ಲದಿದ್ದರೂ ನಿಮ್ಮ ಫೋನ್‌ನ ಕ್ಯಾಲೆಂಡರ್ ನೆನಪಿಸುತ್ತದೆ.",
    refund: { asked: (a) => `${a} ಮರುಪಾವತಿಯ ಬಗ್ಗೆ ಅಂಗಡಿ ನಿರ್ಧರಿಸುತ್ತಿದೆ.`, owed: (a) => `${a} ಮರುಪಾವತಿ ಅಂಗಡಿಯಿಂದ ನಿಮಗೆ ಬರುತ್ತಿದೆ.`, sent: (a) => `ಅಂಗಡಿ ನಿಮ್ಮ ${a} ಮರುಪಾವತಿ ಕಳುಹಿಸಿದೆ.`, kept: (a) => `${a} ಮುಂಗಡವನ್ನು ಇಟ್ಟುಕೊಳ್ಳಲು ಅಂಗಡಿ ನಿರ್ಧರಿಸಿದೆ.` },
  },
};

/**
 * Speaking instead of typing, without our cost (decision 45): the phone keyboard's own microphone (Gboard's voice typing and the like) turns speech into text on the
 * phone, so the recording never reaches the shop's server. Shown by the owner's talk box and by the customer's free-text boxes. Our speech service stays for
 * recorded voice notes.
 */
export const MIC_HINT: Record<Language, string> = {
  en: "Tip: tap the mic on your phone's keyboard to speak instead of typing.",
  hi: "सुझाव: टाइप करने की जगह बोलने के लिए फ़ोन के कीबोर्ड का माइक दबाइए।",
  ml: "ടിപ്പ്: ടൈപ്പ് ചെയ്യുന്നതിന് പകരം സംസാരിക്കാൻ ഫോൺ കീബോർഡിലെ മൈക്ക് അമർത്തൂ.",
  kn: "ಸಲಹೆ: ಟೈಪ್ ಮಾಡುವ ಬದಲು ಮಾತನಾಡಲು ಫೋನ್ ಕೀಬೋರ್ಡ್‌ನ ಮೈಕ್ ಒತ್ತಿ.",
};
