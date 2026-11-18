// The words of the owner's "Your shop is yours" part (block S, 18 Nov 2026), in English, Hindi, Malayalam and Kannada: the two buttons "Get my shop's file" and "Change my
// Operator", and the state of the file. Plain words, no "export" or "handover". The Hindi, Malayalam and Kannada are machine-written and are on the review sheets
// (bundle/panel/review.ts, "leave with your shop"). Used by owner-page.ts and front.ts.
import type { Language } from "../language/languages.ts";

export interface LeaveWords {
  title: string;
  intro: string;
  fileButton: string;
  fileNone: string;
  fileAsked: string;
  fileReady: (until: string) => string;
  take: string;
  fileTaken: string;
  fileExpired: string;
  operatorButton: string;
  operatorNote: string;
  /** The notice at the top after either button. */
  asked: string;
}

export const LEAVE_PAGE: Record<Language, LeaveWords> = {
  en: {
    title: "Your shop is yours",
    intro: "You can take everything that is yours, or ask for another Operator, whenever you like. Your Operator is not asked for permission.",
    fileButton: "Get my shop's file",
    fileNone: "A file with your shop's settings, records and reports, to keep. It will be here in about half an hour.",
    fileAsked: "Asked. Your file will be here in about half an hour.",
    fileReady: (until) => `Your file is ready. The button below works once, until ${until}.`,
    take: "Take the file",
    fileTaken: "You took your file. Ask again for a new one.",
    fileExpired: "That file ran out. Ask again for a new one.",
    operatorButton: "Change my Operator",
    operatorNote: "Your Operator is told at once. Nothing changes until you agree: you will get a code to send to the shop's WhatsApp number. If nothing happens in 14 days, Geometer will help you.",
    asked: "Done. Asked. Details are in the chat below.",
  },
  hi: {
    title: "आपकी दुकान आपकी है",
    intro: "जो कुछ आपका है उसे आप कभी भी ले सकते हैं, या दूसरा Operator माँग सकते हैं। आपके Operator से इजाज़त नहीं माँगी जाती।",
    fileButton: "मेरी दुकान की फ़ाइल",
    fileNone: "आपकी दुकान की सेटिंग, रिकॉर्ड और रिपोर्ट की एक फ़ाइल, अपने पास रखने के लिए। वह करीब आधे घंटे में यहाँ होगी।",
    fileAsked: "माँग ली गई। फ़ाइल करीब आधे घंटे में यहाँ होगी।",
    fileReady: (until) => `आपकी फ़ाइल तैयार है। नीचे का बटन एक बार चलता है, ${until} तक।`,
    take: "फ़ाइल लें",
    fileTaken: "आपने फ़ाइल ले ली। नई चाहिए तो फिर माँगिए।",
    fileExpired: "वह फ़ाइल पुरानी हो गई। नई के लिए फिर माँगिए।",
    operatorButton: "मेरा Operator बदलें",
    operatorNote: "आपके Operator को तुरंत बताया जाता है। आपकी हाँ के बिना कुछ नहीं बदलता: आपको एक कोड मिलेगा जिसे दुकान के WhatsApp नंबर पर भेजना है। 14 दिन में कुछ न हुआ तो Geometer आपकी मदद करेगा।",
    asked: "हो गया। माँग ली गई। ब्यौरा नीचे की बातचीत में है।",
  },
  ml: {
    title: "നിങ്ങളുടെ കട നിങ്ങളുടേതാണ്",
    intro: "നിങ്ങളുടേതായ എല്ലാം എപ്പോൾ വേണമെങ്കിലും എടുക്കാം, അല്ലെങ്കിൽ മറ്റൊരു Operator-നെ ചോദിക്കാം. നിങ്ങളുടെ Operator-ന്റെ അനുവാദം ചോദിക്കില്ല.",
    fileButton: "എന്റെ കടയുടെ ഫയൽ",
    fileNone: "നിങ്ങളുടെ കടയുടെ സെറ്റിംഗ്സ്, രേഖകൾ, റിപ്പോർട്ടുകൾ എന്നിവയുടെ ഒരു ഫയൽ, സൂക്ഷിക്കാൻ. ഏകദേശം അര മണിക്കൂറിൽ ഇവിടെ എത്തും.",
    fileAsked: "ചോദിച്ചു. ഫയൽ ഏകദേശം അര മണിക്കൂറിൽ ഇവിടെ എത്തും.",
    fileReady: (until) => `നിങ്ങളുടെ ഫയൽ തയ്യാറാണ്. താഴെയുള്ള ബട്ടൺ ഒരു തവണ മാത്രം, ${until} വരെ പ്രവർത്തിക്കും.`,
    take: "ഫയൽ എടുക്കുക",
    fileTaken: "നിങ്ങൾ ഫയൽ എടുത്തു. പുതിയത് വേണമെങ്കിൽ വീണ്ടും ചോദിക്കൂ.",
    fileExpired: "ആ ഫയലിന്റെ സമയം കഴിഞ്ഞു. പുതിയതിന് വീണ്ടും ചോദിക്കൂ.",
    operatorButton: "എന്റെ Operator-നെ മാറ്റുക",
    operatorNote: "നിങ്ങളുടെ Operator-നെ ഉടൻ അറിയിക്കും. നിങ്ങൾ സമ്മതിക്കാതെ ഒന്നും മാറില്ല: കടയുടെ WhatsApp നമ്പറിലേക്ക് അയയ്ക്കാൻ ഒരു കോഡ് കിട്ടും. 14 ദിവസത്തിൽ ഒന്നും നടന്നില്ലെങ്കിൽ Geometer സഹായിക്കും.",
    asked: "ശരി. ചോദിച്ചു. വിവരങ്ങൾ താഴെയുള്ള സംഭാഷണത്തിലുണ്ട്.",
  },
  kn: {
    title: "ನಿಮ್ಮ ಅಂಗಡಿ ನಿಮ್ಮದೇ",
    intro: "ನಿಮ್ಮದಾದ ಎಲ್ಲವನ್ನೂ ಯಾವಾಗ ಬೇಕಾದರೂ ತೆಗೆದುಕೊಳ್ಳಬಹುದು, ಅಥವಾ ಬೇರೆ Operator ಕೇಳಬಹುದು. ನಿಮ್ಮ Operator ಅವರ ಅನುಮತಿ ಕೇಳುವುದಿಲ್ಲ.",
    fileButton: "ನನ್ನ ಅಂಗಡಿಯ ಫೈಲ್",
    fileNone: "ನಿಮ್ಮ ಅಂಗಡಿಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳು, ದಾಖಲೆಗಳು ಮತ್ತು ವರದಿಗಳ ಒಂದು ಫೈಲ್, ಇಟ್ಟುಕೊಳ್ಳಲು. ಸುಮಾರು ಅರ್ಧ ಗಂಟೆಯಲ್ಲಿ ಇಲ್ಲಿ ಬರುತ್ತದೆ.",
    fileAsked: "ಕೇಳಲಾಗಿದೆ. ಫೈಲ್ ಸುಮಾರು ಅರ್ಧ ಗಂಟೆಯಲ್ಲಿ ಇಲ್ಲಿ ಬರುತ್ತದೆ.",
    fileReady: (until) => `ನಿಮ್ಮ ಫೈಲ್ ಸಿದ್ಧ. ಕೆಳಗಿನ ಬಟನ್ ಒಂದೇ ಬಾರಿ, ${until} ವರೆಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ.`,
    take: "ಫೈಲ್ ತೆಗೆದುಕೊಳ್ಳಿ",
    fileTaken: "ನೀವು ಫೈಲ್ ತೆಗೆದುಕೊಂಡಿರಿ. ಹೊಸದು ಬೇಕಾದರೆ ಮತ್ತೆ ಕೇಳಿ.",
    fileExpired: "ಆ ಫೈಲ್‌ನ ಸಮಯ ಮುಗಿಯಿತು. ಹೊಸದಕ್ಕೆ ಮತ್ತೆ ಕೇಳಿ.",
    operatorButton: "ನನ್ನ Operator ಬದಲಿಸಿ",
    operatorNote: "ನಿಮ್ಮ Operator ಗೆ ತಕ್ಷಣ ತಿಳಿಸಲಾಗುತ್ತದೆ. ನೀವು ಒಪ್ಪುವವರೆಗೆ ಏನೂ ಬದಲಾಗುವುದಿಲ್ಲ: ಅಂಗಡಿಯ WhatsApp ಸಂಖ್ಯೆಗೆ ಕಳುಹಿಸಲು ನಿಮಗೆ ಒಂದು ಕೋಡ್ ಸಿಗುತ್ತದೆ. 14 ದಿನದಲ್ಲಿ ಏನೂ ಆಗದಿದ್ದರೆ Geometer ಸಹಾಯ ಮಾಡುತ್ತದೆ.",
    asked: "ಆಯಿತು. ಕೇಳಲಾಗಿದೆ. ವಿವರ ಕೆಳಗಿನ ಮಾತುಕತೆಯಲ್ಲಿದೆ.",
  },
};
