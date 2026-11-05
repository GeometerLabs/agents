// The Malayalam and Kannada words a customer may use, kept as plain lists so there is one place to read them, to extend
// them, and to hand them to a native speaker (REVIEW-ml.md and REVIEW-kn.md are written from these lists and from the
// templates). dates.ts and rule-parser.ts build their patterns from here. Machine-written: not yet reviewed by a native speaker.
//
// What the lists mean for matching (see wordRe in dates.ts):
//  - Malayalam and Kannada are written with endings stuck to the word ("നാളെ" + "യ്ക്ക്", "ಮಂಗಳವಾರ" + "ದಂದು"), so a word in
//    Malayalam or Kannada letters also matches when more letters follow it, unless a list is marked "exact" below.
//  - Latin-letter spellings ("nale", "gante") are common on WhatsApp, so they are listed too, and match as whole words.
//  - Zero-width joiners and Malayalam/Kannada digits are removed before matching, so they are not listed.
//  - Numbers spelled out as words ("ആറ് മണി", "ಆರು ಗಂಟೆ") are NOT read yet (Deferred.md): the customer is asked again.

export interface Words {
  today: string[];
  tomorrow: string[];
  dayAfterTomorrow: string[];
  /** Taken out before looking for "today": "ഇന്നലെ" begins like "ഇന്ന്", and a booking cannot be for yesterday. */
  yesterday: string[];
  /** Sunday first, the same order as Date#getDay(). */
  weekdays: string[][];
  /** Just before a weekday: "next Tuesday" (the Tuesday of the next calendar week). */
  next: string[];
  /** Just before a weekday: "this Tuesday". */
  thisWeek: string[];
  /** January first. Exact (a month name is short and is also a common word). */
  months: string[][];
  morning: string[];
  afternoon: string[];
  evening: string[];
  night: string[];
  /** Greetings that name a part of the day; they are not a time ("good morning"). */
  greetingsWithTime: string[];
  /** Follows the hour: "6 മണി", "6 ಗಂಟೆ". Exact. */
  oclock: string[];
  /** Exact. */
  yes: string[];
  /** Exact. */
  no: string[];
  /** Exact. */
  greeting: string[];
  book: string[];
  cancel: string[];
  /** Phrases that start the way a request to move a booking starts: the last word may continue ("മാറ്റ" + "ണം"). */
  reschedule: string[];
  /** A message that is only this (a few words) means STOP. Exact. */
  stop: string[];
  /** Phrases that start the way "no more messages" starts. */
  stopPhrases: string[];
  free: string[];
  /** Follows a price: "300 രൂപയ്ക്ക്", "300 ರೂಪಾಯಿಗೆ", "300 rupa". */
  rupee: string[];
  /** A word for "rules" and a word for "forget/ignore" near each other is an attempt to change the rules. */
  overrideTopics: string[];
  overrideVerbs: string[];
  /** Words in Latin letters that show the customer is writing this language. */
  hints: string[];
}

export const WORDS: Record<"ml" | "kn", Words> = {
  ml: {
    today: ["ഇന്ന്", "ഇന്നു", "ഇന്നത്തെ", "ഇന്നത്തേക്ക്", "innu", "innathe"],
    tomorrow: ["നാളെ", "നാളത്തേക്ക്", "നാളത്തെ", "nale", "naale", "naalathe"],
    dayAfterTomorrow: ["മറ്റന്നാൾ", "മറ്റെന്നാൾ", "mattannal", "mattannaal", "matannal"],
    yesterday: ["ഇന്നലെ", "innale"],
    weekdays: [
      ["ഞായർ", "ഞായറാഴ്ച", "njayar", "njayarazhcha", "njaayar"],
      ["തിങ്കൾ", "തിങ്കളാഴ്ച", "thinkal", "thinkalazhcha"],
      ["ചൊവ്വ", "ചൊവ്വാഴ്ച", "chovva", "chovvazhcha", "chovvaazhcha"],
      ["ബുധൻ", "ബുധനാഴ്ച", "budhan", "budhanazhcha"],
      ["വ്യാഴം", "വ്യാഴാഴ്ച", "vyazham", "vyazhazhcha"],
      ["വെള്ളി", "വെള്ളിയാഴ്ച", "velli", "velliyazhcha"],
      ["ശനി", "ശനിയാഴ്ച", "shani", "shaniyazhcha"],
    ],
    next: ["അടുത്ത", "adutha"],
    thisWeek: ["ഈ", "ee"],
    months: [
      ["ജനുവരി"], ["ഫെബ്രുവരി"], ["മാർച്ച്"], ["ഏപ്രിൽ"], ["മേയ്", "മെയ്"], ["ജൂൺ"],
      ["ജൂലൈ"], ["ഓഗസ്റ്റ്", "ആഗസ്റ്റ്"], ["സെപ്റ്റംബർ"], ["ഒക്ടോബർ"], ["നവംബർ"], ["ഡിസംബർ"],
    ],
    morning: ["രാവിലെ", "രാവിലത്തെ", "പുലർച്ചെ", "raavile", "ravile"],
    afternoon: ["ഉച്ചയ്ക്ക്", "ഉച്ചക്ക്", "ഉച്ചകഴിഞ്ഞ്", "uchakku", "uchaku"],
    evening: ["വൈകുന്നേരം", "വൈകുന്നേരത്തെ", "വൈകുന്നേരത്തേക്ക്", "വൈകീട്ട്", "വൈകിട്ട്", "സന്ധ്യക്ക്", "vaikunneram", "vaikittu"],
    night: ["രാത്രി", "rathri", "raathri"],
    greetingsWithTime: ["സുപ്രഭാതം", "ശുഭ രാത്രി", "ശുഭരാത്രി", "ശുഭ സായാഹ്നം", "ഗുഡ് മോർണിംഗ്", "ഗുഡ് ഈവനിംഗ്", "ഗുഡ് നൈറ്റ്"],
    oclock: ["മണി", "മണിക്ക്", "മണിയോടെ", "mani", "manikku"],
    yes: ["ശരി", "ശെരി", "ശരിയാണ്", "അതെ", "ആണ്", "ഓക്കെ", "ഓകെ", "ഓക്കേ", "സമ്മതം", "ഉവ്വ്", "sheri", "seri", "athe", "aanu"],
    no: ["വേണ്ട", "വേണ്ടാ", "അല്ല", "ഇല്ല", "venda", "alla", "illa"],
    greeting: ["നമസ്കാരം", "ഹലോ", "ഹായ്", "namaskaram"],
    book: ["ബുക്ക്", "ബുക്കിംഗ്", "ബുക്കിങ്", "അപ്പോയിന്റ്മെന്റ്", "വേണം", "venam"],
    cancel: ["റദ്ദ്", "റദ്ദാക്കണം", "റദ്ദാക്കൂ", "റദ്ദാക്കി", "ക്യാൻസൽ", "കാൻസൽ", "radd", "kyansal"],
    reschedule: ["സമയം മാറ്റ", "തീയതി മാറ്റ", "ദിവസം മാറ്റ", "മാറ്റി വയ്ക്ക", "മാറ്റി വെക്ക", "റീഷെഡ്യൂൾ", "samayam maatt", "samayam matt", "time maatt", "time matt", "date maatt"],
    stop: ["സ്റ്റോപ്പ്", "നിർത്തൂ", "നിർത്തുക"],
    stopPhrases: ["മെസ്സേജ് നിർത്ത", "മെസേജ് നിർത്ത", "സന്ദേശം നിർത്ത", "മെസ്സേജ് അയക്കരുത്", "മെസ്സേജ് അയയ്ക്കരുത്", "മെസ്സേജ് വേണ്ട", "സന്ദേശം വേണ്ട", "message venda", "msg venda"],
    free: ["ഫ്രീ", "സൗജന്യം", "പൈസ വേണ്ട", "കാശ് വേണ്ട"],
    rupee: ["രൂപ", "രൂ", "rupa", "rupaya", "rupayakku", "roopa", "roopakku"],
    overrideTopics: ["നിയമ", "നിർദ്ദേശ", "ചട്ട"],
    overrideVerbs: ["മറ", "അവഗണി", "ലംഘി", "ഒഴിവാക്ക"],
    hints: ["innu", "mani", "manikku", "venam", "venda", "aanu", "ente", "njan", "enikku", "ningal", "ningalude", "cheyyamo", "cheyyan", "sheri", "athe", "pattumo", "pattum", "mattannal", "chovvazhcha", "adutha", "vaikunneram", "raavile", "uchakku", "rathri"],
  },
  kn: {
    today: ["ಇಂದು", "ಇಂದಿನ", "ಇಂದಿಗೆ", "ಇವತ್ತು", "ಇವತ್ತಿನ", "ಇವತ್ತಿಗೆ", "indu", "ivattu"],
    tomorrow: ["ನಾಳೆ", "naale", "nale"],
    dayAfterTomorrow: ["ನಾಡಿದ್ದು", "ನಾಡಿದ್ದಿಗೆ", "ನಾಡಿದ್ದಿನ", "naadiddu", "nadiddu", "naadidhu"],
    yesterday: ["ನಿನ್ನೆ", "ninne"],
    weekdays: [
      ["ಭಾನುವಾರ", "ರವಿವಾರ", "bhanuvara", "bhanuvaara", "ravivara"],
      ["ಸೋಮವಾರ", "somavara", "somavaara"],
      ["ಮಂಗಳವಾರ", "mangalavara", "mangalavaara"],
      ["ಬುಧವಾರ", "budhavara", "budhavaara"],
      ["ಗುರುವಾರ", "guruvara", "guruvaara"],
      ["ಶುಕ್ರವಾರ", "shukravara", "shukravaara"],
      ["ಶನಿವಾರ", "shanivara", "shanivaara"],
    ],
    next: ["ಮುಂದಿನ", "mundina"],
    thisWeek: ["ಈ", "ee"],
    months: [
      ["ಜನವರಿ"], ["ಫೆಬ್ರವರಿ"], ["ಮಾರ್ಚ್"], ["ಏಪ್ರಿಲ್"], ["ಮೇ"], ["ಜೂನ್"],
      ["ಜುಲೈ"], ["ಆಗಸ್ಟ್"], ["ಸೆಪ್ಟೆಂಬರ್"], ["ಅಕ್ಟೋಬರ್"], ["ನವೆಂಬರ್"], ["ಡಿಸೆಂಬರ್"],
    ],
    morning: ["ಬೆಳಿಗ್ಗೆ", "ಬೆಳಗ್ಗೆ", "belagge", "beligge"],
    afternoon: ["ಮಧ್ಯಾಹ್ನ", "madhyahna", "madhyaanha"],
    evening: ["ಸಂಜೆ", "sanje"],
    night: ["ರಾತ್ರಿ", "ratri", "raatri"],
    greetingsWithTime: ["ಶುಭೋದಯ", "ಶುಭ ರಾತ್ರಿ", "ಶುಭ ಸಂಜೆ", "ಶುಭ ಮಧ್ಯಾಹ್ನ", "ಗುಡ್ ಮಾರ್ನಿಂಗ್", "ಗುಡ್ ಈವ್ನಿಂಗ್", "ಗುಡ್ ನೈಟ್"],
    oclock: ["ಗಂಟೆ", "ಗಂಟೆಗೆ", "ಗಂಟೆಯ", "gante", "gantege"],
    yes: ["ಹೌದು", "ಸರಿ", "ಸರಿಯಾಗಿದೆ", "ಓಕೆ", "ಒಪ್ಪಿಗೆ", "ಆಯ್ತು", "ಆಗಲಿ", "houdu", "sari", "aytu", "ayithu", "agali"],
    no: ["ಬೇಡ", "ಇಲ್ಲ", "ಅಲ್ಲ", "beda", "illa", "alla"],
    greeting: ["ನಮಸ್ಕಾರ", "ಹಲೋ", "ಹಾಯ್", "namaskara"],
    book: ["ಬುಕ್", "ಬುಕಿಂಗ್", "ಅಪಾಯಿಂಟ್ಮೆಂಟ್", "ಬೇಕು", "ಬೇಕಾಗಿದೆ", "ಬೇಕಿತ್ತು", "beku", "bekittu"],
    cancel: ["ರದ್ದು", "ರದ್ದುಗೊಳಿಸಿ", "ರದ್ದು ಮಾಡಿ", "ಕ್ಯಾನ್ಸಲ್", "ಕ್ಯಾನ್ಸೆಲ್", "raddu"],
    reschedule: ["ಸಮಯ ಬದಲಾಯಿಸ", "ಸಮಯ ಬದಲಿಸ", "ಸಮಯ ಬದಲಾವಣೆ", "ದಿನಾಂಕ ಬದಲಾಯಿಸ", "ದಿನ ಬದಲಾಯಿಸ", "ಮುಂದೂಡ", "ರೀಶೆಡ್ಯೂಲ್", "samaya badalayis", "samaya badalis", "time badalayis"],
    stop: ["ಸ್ಟಾಪ್", "ನಿಲ್ಲಿಸಿ", "ನಿಲ್ಲಿಸು"],
    stopPhrases: ["ಮೆಸೇಜ್ ನಿಲ್ಲಿಸ", "ಸಂದೇಶ ನಿಲ್ಲಿಸ", "ಮೆಸೇಜ್ ಬೇಡ", "ಸಂದೇಶ ಬೇಡ", "ಮೆಸೇಜ್ ಕಳುಹಿಸಬೇಡ", "message beda", "message nillisi"],
    free: ["ಉಚಿತ", "ಫ್ರೀ", "ಹಣ ಬೇಡ", "ದುಡ್ಡು ಬೇಡ"],
    rupee: ["ರೂಪಾಯಿ", "ರೂ", "rupayi", "rupayige", "ruppayi"],
    overrideTopics: ["ನಿಯಮ", "ನಿರ್ದೇಶನ", "ಸೂಚನೆ"],
    overrideVerbs: ["ಮರೆ", "ಮರೆತ", "ನಿರ್ಲಕ್ಷಿಸ", "ಉಲ್ಲಂಘಿಸ", "ಬಿಡ"],
    hints: ["indu", "ivattu", "gante", "gantege", "beku", "bekagilla", "madi", "maadi", "houdu", "sari", "aytu", "naadiddu", "sanje", "belagge", "mundina", "beda", "naanu", "nanage", "nimma", "madtira", "maaditira"],
  },
};

/** One list from both languages, for patterns that do not care which of the two the customer wrote. */
export function inBoth(pick: (w: Words) => string[]): string[] {
  return [...pick(WORDS.ml), ...pick(WORDS.kn)];
}
