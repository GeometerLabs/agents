// What the Operator's panel says about the owner leaving with their shop (block S, 18 Nov 2026), in English, Hindi, Malayalam and Kannada: that the owner asked for their file
// (no help or permission needed), that the owner asked for another Operator and what to do, and, for the server's admin, the stranded list. Words people read say "Operator" and
// never "export" or "handover". Hindi, Malayalam and Kannada are machine-written and on the review sheets (review.ts, ids "leave.*").
import type { Language } from "../../modules/language/languages.ts";
import { wordsLanguage } from "./languages.ts";
import type { Words } from "./words.ts";

export interface PanelLeaveWords {
  heading: string;
  fileAsked: (when: string) => string;
  fileReady: (until: string) => string;
  fileTaken: string;
  fileExpired: string;
  fileProblem: (why: string) => string;
  fileNote: string;
  operatorAsked: (when: string) => string;
  operatorDo: string;
  operatorStart: string;
  operatorWaiting: string;
  /** "n days left of 14 before Geometer's admin is shown this shop" */
  operatorClock: (daysLeft: number) => string;
  strandedNote: string;
  strandedTitle: string;
  strandedNone: string;
  strandedRow: (shop: string, since: string, operator: string) => string;
}

export const PANEL_LEAVE: Record<Language, PanelLeaveWords> = {
  en: {
    heading: "The owner's own asks",
    fileAsked: (when) => `The owner asked for their shop's file on ${when}. It is made for them and shown only to them. You do not need to do anything.`,
    fileReady: (until) => `The file is ready in the owner's app, until ${until}.`,
    fileTaken: "The owner took their file.",
    fileExpired: "The file ran out before the owner took it. A new ask makes a new one.",
    fileProblem: (why) => `The file could not be made yet: ${why} It is tried again in a few minutes.`,
    fileNote: "Their file is theirs. You are not asked for permission and you cannot stop it.",
    operatorAsked: (when) => `The owner asked for another Operator on ${when}.`,
    operatorDo: "Please move the shop to the Operator the owner wants, with the button below. The owner still agrees with their own code before anything changes.",
    operatorStart: "Move this shop to another Operator",
    operatorWaiting: "A move is waiting for the owner's code.",
    operatorClock: (days) => `If nothing is done, Geometer is shown this shop in ${days} days, and will help the owner.`,
    strandedNote: "These owners asked for another Operator more than 14 days ago and nothing has happened. Geometer helps them find one, from the shop's backups if needed.",
    strandedTitle: "Owners waiting for another Operator",
    strandedNone: "No owner is waiting.",
    strandedRow: (shop, since, operator) => `${shop}: asked on ${since}. Operator now: ${operator}.`,
  },
  hi: {
    heading: "मालिक की अपनी माँगें",
    fileAsked: (when) => `मालिक ने ${when} को अपनी दुकान की फ़ाइल माँगी। वह उन्हीं के लिए बनती है और सिर्फ़ उन्हीं को दिखती है। आपको कुछ करने की ज़रूरत नहीं।`,
    fileReady: (until) => `फ़ाइल मालिक के ऐप में तैयार है, ${until} तक।`,
    fileTaken: "मालिक ने अपनी फ़ाइल ले ली।",
    fileExpired: "मालिक के लेने से पहले फ़ाइल की अवधि पूरी हो गई। नई माँग पर नई बनेगी।",
    fileProblem: (why) => `फ़ाइल अभी बन नहीं सकी: ${why} कुछ मिनट में फिर कोशिश होगी।`,
    fileNote: "उनकी फ़ाइल उन्हीं की है। आपसे इजाज़त नहीं माँगी जाती और आप इसे रोक नहीं सकते।",
    operatorAsked: (when) => `मालिक ने ${when} को दूसरा Operator माँगा।`,
    operatorDo: "कृपया नीचे के बटन से दुकान को उस Operator के पास भेजिए जो मालिक चाहते हैं। कुछ भी बदलने से पहले मालिक अपने कोड से हामी भरते हैं।",
    operatorStart: "इस दुकान को दूसरे Operator को दें",
    operatorWaiting: "एक बदलाव मालिक के कोड का इंतज़ार कर रहा है।",
    operatorClock: (days) => `कुछ न हुआ तो ${days} दिन में Geometer को यह दुकान दिखेगी, और वह मालिक की मदद करेगा।`,
    strandedNote: "इन मालिकों ने 14 दिन से ज़्यादा पहले दूसरा Operator माँगा था और कुछ नहीं हुआ। Geometer उन्हें Operator ढूँढने में मदद करता है, ज़रूरत हो तो दुकान के बैकअप से।",
    strandedTitle: "दूसरे Operator का इंतज़ार करते मालिक",
    strandedNone: "कोई मालिक इंतज़ार में नहीं है।",
    strandedRow: (shop, since, operator) => `${shop}: ${since} को माँगा। अभी का Operator: ${operator}।`,
  },
  ml: {
    heading: "ഉടമയുടെ സ്വന്തം ആവശ്യങ്ങൾ",
    fileAsked: (when) => `ഉടമ ${when} ന് തന്റെ കടയുടെ ഫയൽ ചോദിച്ചു. അത് അവർക്കായി ഉണ്ടാക്കുന്നു, അവർക്ക് മാത്രം കാണിക്കുന്നു. നിങ്ങൾ ഒന്നും ചെയ്യേണ്ടതില്ല.`,
    fileReady: (until) => `ഫയൽ ഉടമയുടെ ആപ്പിൽ തയ്യാറാണ്, ${until} വരെ.`,
    fileTaken: "ഉടമ തന്റെ ഫയൽ എടുത്തു.",
    fileExpired: "ഉടമ എടുക്കുംമുമ്പ് ഫയലിന്റെ സമയം കഴിഞ്ഞു. പുതിയ ആവശ്യത്തിൽ പുതിയത് ഉണ്ടാക്കും.",
    fileProblem: (why) => `ഫയൽ ഇതുവരെ ഉണ്ടാക്കാനായില്ല: ${why} കുറച്ച് മിനിറ്റിൽ വീണ്ടും ശ്രമിക്കും.`,
    fileNote: "അവരുടെ ഫയൽ അവരുടേതാണ്. നിങ്ങളുടെ അനുവാദം ചോദിക്കില്ല, തടയാനും കഴിയില്ല.",
    operatorAsked: (when) => `ഉടമ ${when} ന് മറ്റൊരു Operator-നെ ചോദിച്ചു.`,
    operatorDo: "താഴെയുള്ള ബട്ടൺ ഉപയോഗിച്ച് ഉടമ ആഗ്രഹിക്കുന്ന Operator-ന് കട മാറ്റിനൽകൂ. എന്തെങ്കിലും മാറുംമുമ്പ് ഉടമ സ്വന്തം കോഡ് കൊണ്ട് സമ്മതിക്കും.",
    operatorStart: "ഈ കട മറ്റൊരു Operator-ന് നൽകുക",
    operatorWaiting: "ഒരു മാറ്റം ഉടമയുടെ കോഡിനായി കാത്തിരിക്കുന്നു.",
    operatorClock: (days) => `ഒന്നും ചെയ്തില്ലെങ്കിൽ ${days} ദിവസത്തിൽ ഈ കട Geometer-ന് കാണിക്കും, അവർ ഉടമയെ സഹായിക്കും.`,
    strandedNote: "ഈ ഉടമകൾ 14 ദിവസത്തിലധികം മുമ്പ് മറ്റൊരു Operator-നെ ചോദിച്ചു, ഒന്നും നടന്നിട്ടില്ല. Geometer അവരെ ഒരാളെ കണ്ടെത്താൻ സഹായിക്കുന്നു, വേണമെങ്കിൽ കടയുടെ ബാക്കപ്പിൽ നിന്ന്.",
    strandedTitle: "മറ്റൊരു Operator-നായി കാത്തിരിക്കുന്ന ഉടമകൾ",
    strandedNone: "ആരും കാത്തിരിക്കുന്നില്ല.",
    strandedRow: (shop, since, operator) => `${shop}: ${since} ന് ചോദിച്ചു. ഇപ്പോഴത്തെ Operator: ${operator}.`,
  },
  kn: {
    heading: "ಮಾಲೀಕರ ಸ್ವಂತ ಕೋರಿಕೆಗಳು",
    fileAsked: (when) => `ಮಾಲೀಕರು ${when} ರಂದು ತಮ್ಮ ಅಂಗಡಿಯ ಫೈಲ್ ಕೇಳಿದ್ದಾರೆ. ಅದು ಅವರಿಗಾಗಿ ಮಾಡಲಾಗುತ್ತದೆ ಮತ್ತು ಅವರಿಗೆ ಮಾತ್ರ ತೋರಿಸಲಾಗುತ್ತದೆ. ನೀವು ಏನೂ ಮಾಡಬೇಕಿಲ್ಲ.`,
    fileReady: (until) => `ಫೈಲ್ ಮಾಲೀಕರ ಆ್ಯಪ್‌ನಲ್ಲಿ ಸಿದ್ಧವಾಗಿದೆ, ${until} ವರೆಗೆ.`,
    fileTaken: "ಮಾಲೀಕರು ತಮ್ಮ ಫೈಲ್ ತೆಗೆದುಕೊಂಡರು.",
    fileExpired: "ಮಾಲೀಕರು ತೆಗೆದುಕೊಳ್ಳುವ ಮೊದಲೇ ಫೈಲ್‌ನ ಸಮಯ ಮುಗಿಯಿತು. ಹೊಸ ಕೋರಿಕೆಗೆ ಹೊಸದನ್ನು ಮಾಡಲಾಗುತ್ತದೆ.",
    fileProblem: (why) => `ಫೈಲ್ ಇನ್ನೂ ಮಾಡಲಾಗಲಿಲ್ಲ: ${why} ಕೆಲವು ನಿಮಿಷಗಳಲ್ಲಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತದೆ.`,
    fileNote: "ಅವರ ಫೈಲ್ ಅವರದೇ. ನಿಮ್ಮ ಅನುಮತಿ ಕೇಳುವುದಿಲ್ಲ, ನೀವು ತಡೆಯಲೂ ಆಗುವುದಿಲ್ಲ.",
    operatorAsked: (when) => `ಮಾಲೀಕರು ${when} ರಂದು ಬೇರೆ Operator ಕೇಳಿದ್ದಾರೆ.`,
    operatorDo: "ದಯವಿಟ್ಟು ಕೆಳಗಿನ ಬಟನ್ ಬಳಸಿ ಮಾಲೀಕರು ಬಯಸುವ Operator ಗೆ ಅಂಗಡಿಯನ್ನು ವರ್ಗಾಯಿಸಿ. ಏನಾದರೂ ಬದಲಾಗುವ ಮೊದಲು ಮಾಲೀಕರು ತಮ್ಮ ಕೋಡ್‌ನಿಂದ ಒಪ್ಪುತ್ತಾರೆ.",
    operatorStart: "ಈ ಅಂಗಡಿಯನ್ನು ಬೇರೆ Operator ಗೆ ನೀಡಿ",
    operatorWaiting: "ಒಂದು ಬದಲಾವಣೆ ಮಾಲೀಕರ ಕೋಡ್‌ಗಾಗಿ ಕಾಯುತ್ತಿದೆ.",
    operatorClock: (days) => `ಏನೂ ಮಾಡದಿದ್ದರೆ ${days} ದಿನದಲ್ಲಿ ಈ ಅಂಗಡಿ Geometer ಗೆ ತೋರಿಸಲಾಗುತ್ತದೆ, ಅವರು ಮಾಲೀಕರಿಗೆ ಸಹಾಯ ಮಾಡುತ್ತಾರೆ.`,
    strandedNote: "ಈ ಮಾಲೀಕರು 14 ದಿನಕ್ಕಿಂತ ಹಿಂದೆ ಬೇರೆ Operator ಕೇಳಿದ್ದಾರೆ, ಏನೂ ಆಗಿಲ್ಲ. Geometer ಅವರಿಗೆ ಒಬ್ಬರನ್ನು ಹುಡುಕಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ, ಬೇಕಾದರೆ ಅಂಗಡಿಯ ಬ್ಯಾಕಪ್‌ನಿಂದ.",
    strandedTitle: "ಬೇರೆ Operator ಗಾಗಿ ಕಾಯುತ್ತಿರುವ ಮಾಲೀಕರು",
    strandedNone: "ಯಾವ ಮಾಲೀಕರೂ ಕಾಯುತ್ತಿಲ್ಲ.",
    strandedRow: (shop, since, operator) => `${shop}: ${since} ರಂದು ಕೇಳಿದ್ದಾರೆ. ಈಗಿನ Operator: ${operator}.`,
  },
};

export const panelLeave = (w: Words): PanelLeaveWords => PANEL_LEAVE[wordsLanguage(w)];
