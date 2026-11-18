// The words of the Classes part of the Fees phone form (17 Nov 2026, item 7): a timetable box, the one switch for old dues, and what is refused, in English, Hindi,
// Malayalam and Kannada. They live here, found by the panel's own language name (languages.ts `wordsLanguage`), so the shared words files change by nothing; Hindi,
// Malayalam and Kannada are machine-written and are on the review sheets (review.ts, ids "classes.*") until a native reader has signed them.
import type { Language } from "../../modules/language/languages.ts";
import { wordsLanguage } from "./languages.ts";
import type { Words } from "./words.ts";

export interface ClassesWords {
  heading: string;
  label: string;
  help: string;
  /** What the teacher does on WhatsApp, so the Operator knows there is nothing to type here. */
  linkNote: string;
  oldDues: string;
  oldDuesHelp: string;
  problems: {
    tooMany: (n: number) => string;
    lineBad: (row: number) => string;
    batch: (row: number, name: string) => string;
    day: (row: number) => string;
    time: (row: number) => string;
    minutes: (row: number) => string;
    twice: (row: number) => string;
  };
}

export const CLASSES_WORDS: Record<Language, ClassesWords> = {
  en: {
    heading: "Classes", label: "Class times",
    help: "Leave this empty if the centre has no set class times. One class on each line: the batch, the day, the start time, how many minutes. Example: Class 8, Mon, 16:00, 45. Write the day as Mon, Tue, Wed, Thu, Fri, Sat or Sun.",
    linkNote: "The teacher sends each class's link on WhatsApp from the owner's number, and the parents get it before the class. There is nothing to type here for the link.",
    oldDues: "An old unpaid month also holds back the class link",
    oldDuesHelp: "Off: only this month's fee holds the link back. On: a student with an old unpaid month does not get the link either.",
    problems: {
      tooMany: (n) => `At most ${n} classes can be written here.`,
      lineBad: (r) => `Class line ${r}: write the batch, the day, the start time and the minutes, separated by commas.`,
      batch: (r, n) => `Class line ${r}: "${n}" is not one of your batches.`,
      day: (r) => `Class line ${r}: the day must be Mon, Tue, Wed, Thu, Fri, Sat or Sun.`,
      time: (r) => `Class line ${r}: the start time must look like 16:00 (24-hour clock).`,
      minutes: (r) => `Class line ${r}: the length must be a whole number of minutes from 10 to 240.`,
      twice: (r) => `Class line ${r}: the same batch, day and time is written twice.`,
    },
  },
  hi: {
    heading: "कक्षाएँ", label: "कक्षाओं का समय",
    help: "अगर केंद्र में कक्षा का तय समय नहीं है तो इसे खाली छोड़ें। हर लाइन में एक कक्षा: बैच, दिन, शुरू होने का समय, कितने मिनट। जैसे: कक्षा 8, Mon, 16:00, 45। दिन ऐसे लिखें: Mon, Tue, Wed, Thu, Fri, Sat, Sun।",
    linkNote: "हर कक्षा का लिंक टीचर मालिक के नंबर से WhatsApp पर भेजते हैं, और माता-पिता को कक्षा से पहले मिल जाता है। लिंक के लिए यहाँ कुछ लिखना नहीं है।",
    oldDues: "पुराना बकाया महीना भी कक्षा का लिंक रोके",
    oldDuesHelp: "बंद: सिर्फ़ इस महीने की फीस लिंक रोकती है। चालू: जिस विद्यार्थी का पुराना महीना बाकी है, उसे भी लिंक नहीं जाता।",
    problems: {
      tooMany: (n) => `यहाँ ज़्यादा से ज़्यादा ${n} कक्षाएँ लिखी जा सकती हैं।`,
      lineBad: (r) => `कक्षा की लाइन ${r}: बैच, दिन, शुरू होने का समय और मिनट कॉमा से अलग करके लिखें।`,
      batch: (r, n) => `कक्षा की लाइन ${r}: "${n}" आपके बैचों में नहीं है।`,
      day: (r) => `कक्षा की लाइन ${r}: दिन Mon, Tue, Wed, Thu, Fri, Sat या Sun होना चाहिए।`,
      time: (r) => `कक्षा की लाइन ${r}: शुरू होने का समय 16:00 जैसा होना चाहिए (24 घंटे की घड़ी)।`,
      minutes: (r) => `कक्षा की लाइन ${r}: समय 10 से 240 के बीच पूरे मिनट होना चाहिए।`,
      twice: (r) => `कक्षा की लाइन ${r}: वही बैच, दिन और समय दो बार लिखा है।`,
    },
  },
  ml: {
    heading: "ക്ലാസുകൾ", label: "ക്ലാസ് സമയം",
    help: "കേന്ദ്രത്തിന് നിശ്ചിത ക്ലാസ് സമയം ഇല്ലെങ്കിൽ ഇത് ഒഴിച്ചിടുക. ഓരോ വരിയിലും ഒരു ക്ലാസ്: ബാച്ച്, ദിവസം, തുടങ്ങുന്ന സമയം, എത്ര മിനിറ്റ്. ഉദാഹരണം: ക്ലാസ് 8, Mon, 16:00, 45. ദിവസം ഇങ്ങനെ എഴുതുക: Mon, Tue, Wed, Thu, Fri, Sat, Sun.",
    linkNote: "ഓരോ ക്ലാസിന്റെയും ലിങ്ക് ടീച്ചർ ഉടമയുടെ നമ്പറിൽ നിന്ന് WhatsApp-ൽ അയയ്ക്കും, ക്ലാസിന് മുമ്പ് രക്ഷിതാക്കൾക്ക് കിട്ടും. ലിങ്കിനായി ഇവിടെ ഒന്നും ടൈപ്പ് ചെയ്യേണ്ട.",
    oldDues: "പഴയ അടയ്ക്കാത്ത മാസവും ക്ലാസ് ലിങ്ക് തടയട്ടെ",
    oldDuesHelp: "ഓഫ്: ഈ മാസത്തെ ഫീസ് മാത്രം ലിങ്ക് തടയും. ഓൺ: പഴയ മാസം അടയ്ക്കാത്ത കുട്ടിക്കും ലിങ്ക് പോകില്ല.",
    problems: {
      tooMany: (n) => `ഇവിടെ പരമാവധി ${n} ക്ലാസുകൾ എഴുതാം.`,
      lineBad: (r) => `ക്ലാസ് വരി ${r}: ബാച്ച്, ദിവസം, തുടങ്ങുന്ന സമയം, മിനിറ്റ് എന്നിവ കോമ കൊണ്ട് വേർതിരിച്ച് എഴുതുക.`,
      batch: (r, n) => `ക്ലാസ് വരി ${r}: "${n}" നിങ്ങളുടെ ബാച്ചുകളിൽ ഇല്ല.`,
      day: (r) => `ക്ലാസ് വരി ${r}: ദിവസം Mon, Tue, Wed, Thu, Fri, Sat അല്ലെങ്കിൽ Sun ആയിരിക്കണം.`,
      time: (r) => `ക്ലാസ് വരി ${r}: തുടങ്ങുന്ന സമയം 16:00 പോലെ ആയിരിക്കണം (24 മണിക്കൂർ ക്ലോക്ക്).`,
      minutes: (r) => `ക്ലാസ് വരി ${r}: ദൈർഘ്യം 10 മുതൽ 240 വരെ പൂർണ്ണ മിനിറ്റ് ആയിരിക്കണം.`,
      twice: (r) => `ക്ലാസ് വരി ${r}: ഒരേ ബാച്ചും ദിവസവും സമയവും രണ്ടുതവണ എഴുതിയിട്ടുണ്ട്.`,
    },
  },
  kn: {
    heading: "ತರಗತಿಗಳು", label: "ತರಗತಿಯ ಸಮಯ",
    help: "ಕೇಂದ್ರಕ್ಕೆ ನಿಗದಿತ ತರಗತಿ ಸಮಯ ಇಲ್ಲದಿದ್ದರೆ ಇದನ್ನು ಖಾಲಿ ಬಿಡಿ. ಪ್ರತಿ ಸಾಲಿನಲ್ಲಿ ಒಂದು ತರಗತಿ: ಬ್ಯಾಚ್, ದಿನ, ಆರಂಭದ ಸಮಯ, ಎಷ್ಟು ನಿಮಿಷ. ಉದಾಹರಣೆ: ತರಗತಿ 8, Mon, 16:00, 45. ದಿನವನ್ನು ಹೀಗೆ ಬರೆಯಿರಿ: Mon, Tue, Wed, Thu, Fri, Sat, Sun.",
    linkNote: "ಪ್ರತಿ ತರಗತಿಯ ಲಿಂಕ್ ಅನ್ನು ಶಿಕ್ಷಕರು ಮಾಲೀಕರ ನಂಬರ್‌ನಿಂದ WhatsApp ನಲ್ಲಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಪೋಷಕರಿಗೆ ತರಗತಿಗೆ ಮೊದಲು ಸಿಗುತ್ತದೆ. ಲಿಂಕ್‌ಗಾಗಿ ಇಲ್ಲಿ ಏನನ್ನೂ ಬರೆಯಬೇಕಿಲ್ಲ.",
    oldDues: "ಹಳೆಯ ಬಾಕಿ ತಿಂಗಳೂ ತರಗತಿ ಲಿಂಕ್ ತಡೆಯಲಿ",
    oldDuesHelp: "ಆಫ್: ಈ ತಿಂಗಳ ಶುಲ್ಕ ಮಾತ್ರ ಲಿಂಕ್ ತಡೆಯುತ್ತದೆ. ಆನ್: ಹಳೆಯ ತಿಂಗಳು ಬಾಕಿ ಇರುವ ವಿದ್ಯಾರ್ಥಿಗೂ ಲಿಂಕ್ ಹೋಗುವುದಿಲ್ಲ.",
    problems: {
      tooMany: (n) => `ಇಲ್ಲಿ ಗರಿಷ್ಠ ${n} ತರಗತಿಗಳನ್ನು ಬರೆಯಬಹುದು.`,
      lineBad: (r) => `ತರಗತಿ ಸಾಲು ${r}: ಬ್ಯಾಚ್, ದಿನ, ಆರಂಭದ ಸಮಯ ಮತ್ತು ನಿಮಿಷಗಳನ್ನು ಅಲ್ಪವಿರಾಮದಿಂದ ಬೇರ್ಪಡಿಸಿ ಬರೆಯಿರಿ.`,
      batch: (r, n) => `ತರಗತಿ ಸಾಲು ${r}: "${n}" ನಿಮ್ಮ ಬ್ಯಾಚ್‌ಗಳಲ್ಲಿ ಇಲ್ಲ.`,
      day: (r) => `ತರಗತಿ ಸಾಲು ${r}: ದಿನ Mon, Tue, Wed, Thu, Fri, Sat ಅಥವಾ Sun ಆಗಿರಬೇಕು.`,
      time: (r) => `ತರಗತಿ ಸಾಲು ${r}: ಆರಂಭದ ಸಮಯ 16:00 ನಂತೆ ಇರಬೇಕು (24 ಗಂಟೆಯ ಗಡಿಯಾರ).`,
      minutes: (r) => `ತರಗತಿ ಸಾಲು ${r}: ಅವಧಿ 10 ರಿಂದ 240 ರವರೆಗಿನ ಪೂರ್ಣ ನಿಮಿಷಗಳಾಗಿರಬೇಕು.`,
      twice: (r) => `ತರಗತಿ ಸಾಲು ${r}: ಅದೇ ಬ್ಯಾಚ್, ದಿನ ಮತ್ತು ಸಮಯ ಎರಡು ಬಾರಿ ಬರೆಯಲಾಗಿದೆ.`,
    },
  },
};

/** The Classes words for the panel's words of one language. */
export const classesWords = (w: Words): ClassesWords => CLASSES_WORDS[wordsLanguage(w)];
