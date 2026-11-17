// More words of the chat on the shop's page (17 Nov 2026), in four languages, kept apart from words-chat.ts so each can be read on its own review sheet: the moments the
// shop's record marks (a booking or order confirmed, a payment received), hold-to-talk, and the "Chat with us" button on the shop's other pages. Hindi, Malayalam and Kannada
// are machine-written and wait for a native reader (bundle/panel/review.ts lists each on the review sheet).
//
// Plain and short. A moment says what the shop's own record holds, never more: the animation beside it is a picture of that sentence, not a promise. "Payment received" is said
// only after the shop's record has the payment (for UPI, after the owner marked it).
import type { Language } from "../language/languages.ts";

export interface ChatMoreWords {
  /** The two moments the record marks, and the shop's greeting's one quiet line. */
  confirmed: string; paid: string;
  /** Hold to talk: the button, while recording, while the shop listens, the label of a voice send that could not be heard, and the one line for a phone that cannot record. */
  hold: string; release: string; listening: string; voiceNote: string; micBlocked: string;
  /** The button on the shop's booking, order and centre pages, and what a screen reader says it opens. */
  link: string; linkAbout: string;
}

export const CHAT_MORE: Record<Language, ChatMoreWords> = {
  en: {
    confirmed: "Confirmed. The shop's own record has it.", paid: "Payment received. The shop's own record has it.",
    hold: "Hold to talk", release: "Release to send", listening: "Listening", voiceNote: "Voice message", micBlocked: "The microphone is off for this page. You can type instead.",
    link: "Chat with us", linkAbout: "Opens the chat with the shop",
  },
  hi: {
    confirmed: "पक्का हो गया। दुकान के अपने रिकॉर्ड में है।", paid: "भुगतान मिल गया। दुकान के अपने रिकॉर्ड में है।",
    hold: "बोलने के लिए दबाकर रखें", release: "भेजने के लिए छोड़ें", listening: "सुन रहे हैं", voiceNote: "आवाज़ का संदेश", micBlocked: "इस पेज के लिए माइक्रोफ़ोन बंद है। आप लिखकर भेज सकते हैं।",
    link: "हमसे चैट करें", linkAbout: "दुकान से चैट खुलती है",
  },
  ml: {
    confirmed: "ഉറപ്പായി. കടയുടെ സ്വന്തം രേഖയിൽ ഉണ്ട്.", paid: "പണം കിട്ടി. കടയുടെ സ്വന്തം രേഖയിൽ ഉണ്ട്.",
    hold: "സംസാരിക്കാൻ അമർത്തിപ്പിടിക്കൂ", release: "അയയ്ക്കാൻ വിടൂ", listening: "കേൾക്കുന്നു", voiceNote: "ശബ്ദ സന്ദേശം", micBlocked: "ഈ പേജിന് മൈക്രോഫോൺ ഓഫാണ്. പകരം ടൈപ്പ് ചെയ്യാം.",
    link: "ഞങ്ങളോട് ചാറ്റ് ചെയ്യൂ", linkAbout: "കടയുമായുള്ള ചാറ്റ് തുറക്കും",
  },
  kn: {
    confirmed: "ಖಚಿತವಾಯಿತು. ಅಂಗಡಿಯ ಸ್ವಂತ ದಾಖಲೆಯಲ್ಲಿ ಇದೆ.", paid: "ಹಣ ಬಂದಿದೆ. ಅಂಗಡಿಯ ಸ್ವಂತ ದಾಖಲೆಯಲ್ಲಿ ಇದೆ.",
    hold: "ಮಾತನಾಡಲು ಒತ್ತಿ ಹಿಡಿಯಿರಿ", release: "ಕಳುಹಿಸಲು ಬಿಡಿ", listening: "ಕೇಳಲಾಗುತ್ತಿದೆ", voiceNote: "ಧ್ವನಿ ಸಂದೇಶ", micBlocked: "ಈ ಪುಟಕ್ಕೆ ಮೈಕ್ರೊಫೋನ್ ಆಫ್ ಆಗಿದೆ. ಬದಲಿಗೆ ಟೈಪ್ ಮಾಡಬಹುದು.",
    link: "ನಮ್ಮೊಂದಿಗೆ ಚಾಟ್ ಮಾಡಿ", linkAbout: "ಅಂಗಡಿಯೊಂದಿಗೆ ಚಾಟ್ ತೆರೆಯುತ್ತದೆ",
  },
};
