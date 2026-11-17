// The words of the panel's first set-up question, "What does the shop do?" (17 Nov 2026, presets.ts): the trade buttons' page, the "Other" page where the Operator writes the trade
// in their own words and then picks the kind of work, the note on a prefilled form, and the label of the trade on the shop's page. They live here, found by the panel's own language
// name (languages.ts `wordsLanguage`), so the shared words files change by nothing. The names of the trades themselves are in each preset file (bundle/panel/presets/*.json). Hindi,
// Malayalam and Kannada are machine-written and on the review sheets (review.ts, ids "preset.words.*" and "preset.<id>.*") until a native reader has signed them.
import type { Language } from "../../modules/language/languages.ts";
import { wordsLanguage } from "./languages.ts";
import type { Words } from "./words.ts";

export interface PresetWords {
  /** The question every new shop starts with. */
  question: string;
  /** The button for a trade that is none of the buttons. */
  other: string;
  /** The Other page: the box for the trade in the Operator's own words, with an example, and the question about the kind of work. */
  typedLabel: string;
  typedHelp: string;
  kindQuestion: string;
  /** Refused: nothing written in the trade box. */
  typedEmpty: string;
  /** The first step of a shop that started from a trade: every price on it is an example. */
  prefillNote: string;
  /** The label before the trade on a shop's page. */
  tradeLabel: string;
}

export const PRESET_WORDS: Record<Language, PresetWords> = {
  en: {
    question: "What does the shop do?", other: "Something else",
    typedLabel: "What does the shop do, in your own words?", typedHelp: "A few words are enough. For example: tailor, florist, tutor.",
    kindQuestion: "Which of these is closest to how it works?",
    typedEmpty: "Write what the shop does, in a few words.",
    prefillNote: "The prices and times here are only examples. Check each one and change it to yours.",
    tradeLabel: "Kind of shop",
  },
  hi: {
    question: "दुकान क्या काम करती है?", other: "कुछ और",
    typedLabel: "आपकी दुकान क्या करती है, अपने शब्दों में?", typedHelp: "कुछ शब्द काफ़ी हैं। जैसे: दर्ज़ी, फूलवाला, ट्यूटर।",
    kindQuestion: "इनमें से कौन-सा आपके काम के सबसे करीब है?",
    typedEmpty: "दुकान क्या करती है, यह कुछ शब्दों में लिखें।",
    prefillNote: "यहाँ के दाम और समय सिर्फ़ उदाहरण हैं। हर एक को जाँचें और अपना लिखें।",
    tradeLabel: "दुकान का प्रकार",
  },
  ml: {
    question: "കട എന്ത് ചെയ്യുന്നു?", other: "മറ്റൊന്ന്",
    typedLabel: "നിങ്ങളുടെ കട എന്ത് ചെയ്യുന്നു, സ്വന്തം വാക്കുകളിൽ?", typedHelp: "കുറച്ച് വാക്കുകൾ മതി. ഉദാഹരണം: തയ്യൽക്കാരൻ, പൂക്കട, ട്യൂട്ടർ.",
    kindQuestion: "ഇവയിൽ ഏതാണ് നിങ്ങളുടെ രീതിയോട് ഏറ്റവും അടുത്തത്?",
    typedEmpty: "കട എന്ത് ചെയ്യുന്നു എന്ന് കുറച്ച് വാക്കുകളിൽ എഴുതുക.",
    prefillNote: "ഇവിടത്തെ വിലകളും സമയങ്ങളും ഉദാഹരണങ്ങൾ മാത്രമാണ്. ഓരോന്നും പരിശോധിച്ച് നിങ്ങളുടേതാക്കി മാറ്റുക.",
    tradeLabel: "കടയുടെ തരം",
  },
  kn: {
    question: "ಅಂಗಡಿ ಏನು ಮಾಡುತ್ತದೆ?", other: "ಬೇರೆ ಏನೋ",
    typedLabel: "ನಿಮ್ಮ ಅಂಗಡಿ ಏನು ಮಾಡುತ್ತದೆ, ನಿಮ್ಮದೇ ಮಾತುಗಳಲ್ಲಿ?", typedHelp: "ಕೆಲವು ಪದಗಳು ಸಾಕು. ಉದಾಹರಣೆ: ದರ್ಜಿ, ಹೂವಿನ ಅಂಗಡಿ, ಟ್ಯೂಟರ್.",
    kindQuestion: "ಇವುಗಳಲ್ಲಿ ಯಾವುದು ನಿಮ್ಮ ಕೆಲಸಕ್ಕೆ ಹತ್ತಿರ?",
    typedEmpty: "ಅಂಗಡಿ ಏನು ಮಾಡುತ್ತದೆ ಎಂದು ಕೆಲವು ಪದಗಳಲ್ಲಿ ಬರೆಯಿರಿ.",
    prefillNote: "ಇಲ್ಲಿನ ಬೆಲೆಗಳು ಮತ್ತು ಸಮಯಗಳು ಉದಾಹರಣೆಗಳು ಮಾತ್ರ. ಪ್ರತಿಯೊಂದನ್ನೂ ಪರಿಶೀಲಿಸಿ ನಿಮ್ಮದಾಗಿ ಬದಲಿಸಿ.",
    tradeLabel: "ಅಂಗಡಿಯ ಬಗೆ",
  },
};

/** The preset words for the panel's words of one language. */
export const presetWords = (w: Words): PresetWords => PRESET_WORDS[wordsLanguage(w)];
