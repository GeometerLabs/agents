// What the save says when the phone form could not carry a student's earlier details over (item 2 of 17 Nov 2026; keep.ts studentsWithoutSafeMatch): the parent's number changed, and a
// number is the only safe proof that a student of the same name is the same family, so the old dues, joining day and adult mark are not moved to anyone. Found by the panel's own
// language name (languages.ts), four languages; Hindi, Malayalam and Kannada are machine-written and on the review sheets (id "keep.lost").
import type { Language } from "../../modules/language/languages.ts";
import { wordsLanguage } from "./languages.ts";
import type { Words } from "./words.ts";

export interface KeepWords { lost: (name: string) => string }

export const KEEP_WORDS: Record<Language, KeepWords> = {
  en: { lost: (n) => `${n}'s old dues and other earlier details were not kept, because the parent's number changed. Ask your builder to add them again.` },
  hi: { lost: (n) => `${n} का पुराना बकाया और पहले की दूसरी जानकारी नहीं रखी गई, क्योंकि माता-पिता का नंबर बदल गया। अपने बिल्डर से उन्हें फिर से जुड़वाएँ।` },
  ml: { lost: (n) => `${n}-ന്റെ പഴയ കുടിശ്ശികയും മുമ്പത്തെ മറ്റ് വിവരങ്ങളും സൂക്ഷിച്ചില്ല, കാരണം രക്ഷിതാവിന്റെ നമ്പർ മാറി. അവ വീണ്ടും ചേർക്കാൻ നിങ്ങളുടെ ബിൽഡറോട് പറയുക.` },
  kn: { lost: (n) => `${n} ಅವರ ಹಳೆಯ ಬಾಕಿ ಮತ್ತು ಇತರ ಹಿಂದಿನ ವಿವರಗಳನ್ನು ಉಳಿಸಿಕೊಳ್ಳಲಿಲ್ಲ, ಏಕೆಂದರೆ ಪೋಷಕರ ನಂಬರ್ ಬದಲಾಯಿತು. ಅವನ್ನು ಮತ್ತೆ ಸೇರಿಸಲು ನಿಮ್ಮ ಬಿಲ್ಡರ್‌ಗೆ ಹೇಳಿ.` },
};

export const keepWords = (w: Words): KeepWords => KEEP_WORDS[wordsLanguage(w)];
