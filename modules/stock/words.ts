// Every line people read about the stock count, in English, Hindi, Malayalam and Kannada (block S, phase A3): the owner's Stock page in their app, the one-line "running low" and
// the question that starts a reorder, and the morning line's "running low". One file, so the owner's page, the assistant's words and the review sheets read the same lines. The
// Hindi, Malayalam and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts, ids "stockline.*"; the English is the reference). The names "STOCK_WORDS" and
// "stock.*" already belong to the Stock orders template (modules/channels/words-stock.ts), so this file's are STOCK_LINE_WORDS and "stockline.*". No word here says goods are safe or
// guaranteed; a count is "what the owner says there is", never a promise, and no line names a customer.
import type { Language } from "../language/languages.ts";

export interface StockLineWords {
  title: string;
  intro: string;
  empty: string;
  /** "12 left" */
  left: (n: number, unit?: string) => string;
  soldOut: string;
  low: string;
  lowMark: (n: number) => string;
  setCount: string;
  newCount: string;
  save: string;
  soldOne: string;
  soldMany: string;
  stop: string;
  stopHelp: string;
  addTitle: string;
  addItem: string;
  addCount: string;
  addLow: string;
  addButton: string;
  nothingToAdd: string;
  history: string;
  moves: { started: string; sold: string; returned: string; received: string; corrected: string };
  /** "short by 2": a sale was bigger than the count. */
  short: (n: number) => string;
  kinds: { listing: string; menu: string; supply: string };
  saved: string;
  notices: { stale: string; bad_count: string; bad_low: string; bad_id: string; bad_text: string; exists: string; full: string; no_such_line: string; unit: string };
  /** The owner's talk line when a count reaches the low mark and there is no supplier to ask. */
  runningLow: (name: string, n: number) => string;
  /** The question that starts the reorder: the card's first line. */
  reorderAsk: (name: string, n: number, supplier: string) => string;
  /** The morning line's part: "running low: 2". */
  morningLow: (n: string) => string;
  /** A delivery that was not added because its unit is not the unit counted. */
  unitRefused: (name: string, unit: string) => string;
}

export const STOCK_LINE_WORDS: Record<Language, StockLineWords> = {
  en: {
    title: "Stock", intro: "Count what you want to keep track of. An item you do not count works as before.", empty: "Nothing is counted yet.",
    left: (n, unit) => `${n}${unit ? ` ${unit}` : ""} left`, soldOut: "Sold out", low: "Running low", lowMark: (n) => `Tell me at ${n} or less`,
    setCount: "Set the count", newCount: "How many are there now?", save: "Save", soldOne: "Sold 1", soldMany: "Sold", stop: "Stop counting", stopHelp: "The item works as before, with no count.",
    addTitle: "Count another item", addItem: "Item", addCount: "How many are there now?", addLow: "Tell me when it is down to (optional)", addButton: "Start counting", nothingToAdd: "Every item is counted already.",
    history: "Lately",
    moves: { started: "Counting started", sold: "Sold", returned: "Put back", received: "Received", corrected: "Count corrected" },
    short: (n) => `short by ${n}`,
    kinds: { listing: "On your page", menu: "On your menu", supply: "From your suppliers" },
    saved: "Saved.",
    notices: {
      stale: "The count changed while you were looking. Check it and save again.", bad_count: "A count is a whole number, 0 or more.", bad_low: "The low mark is a whole number, 0 or more.",
      bad_id: "That item is not one this shop has.", bad_text: "That name or unit is too long.", exists: "That item is counted already.", full: "That is the most items a shop can count.",
      no_such_line: "That item is not counted.", unit: "That delivery is in another unit than the count, so it was not added.",
    },
    runningLow: (name, n) => `${name} is running low (${n} left).`,
    reorderAsk: (name, n, supplier) => `${name} is low (${n} left). Order from ${supplier}?`,
    morningLow: (n) => `running low: ${n}`,
    unitRefused: (name, unit) => `A delivery of ${name} was not added to the count: the count is in ${unit} and the delivery is in another unit.`,
  },
  hi: {
    title: "स्टॉक", intro: "जिन चीज़ों का हिसाब रखना है उनकी गिनती रखें। जिसे आप नहीं गिनते वह पहले की तरह चलता है।", empty: "अभी कुछ भी गिना नहीं गया है।",
    left: (n, unit) => `${n}${unit ? ` ${unit}` : ""} बचे`, soldOut: "बिक गया", low: "कम पड़ रहा है", lowMark: (n) => `${n} या उससे कम होने पर बताएँ`,
    setCount: "गिनती तय करें", newCount: "अभी कितने हैं?", save: "सहेजें", soldOne: "1 बिका", soldMany: "बिका", stop: "गिनना बंद करें", stopHelp: "यह चीज़ बिना गिनती के पहले की तरह चलेगी।",
    addTitle: "एक और चीज़ गिनें", addItem: "चीज़", addCount: "अभी कितने हैं?", addLow: "कितने बचने पर बताएँ (चाहें तो)", addButton: "गिनना शुरू करें", nothingToAdd: "हर चीज़ पहले से गिनी जा रही है।",
    history: "हाल में",
    moves: { started: "गिनती शुरू हुई", sold: "बिका", returned: "वापस जोड़ा", received: "मिला", corrected: "गिनती सुधारी" },
    short: (n) => `${n} कम थे`,
    kinds: { listing: "आपके पेज पर", menu: "आपके मेन्यू में", supply: "आपके सप्लायर से" },
    saved: "सहेज लिया।",
    notices: {
      stale: "देखते समय गिनती बदल गई। उसे जाँचकर फिर सहेजें।", bad_count: "गिनती पूरी संख्या होती है, 0 या उससे ज़्यादा।", bad_low: "कम की सीमा पूरी संख्या होती है, 0 या उससे ज़्यादा।",
      bad_id: "यह चीज़ इस दुकान की नहीं है।", bad_text: "वह नाम या इकाई बहुत लंबी है।", exists: "यह चीज़ पहले से गिनी जा रही है।", full: "एक दुकान इससे ज़्यादा चीज़ें नहीं गिन सकती।",
      no_such_line: "यह चीज़ गिनी नहीं जा रही।", unit: "वह डिलीवरी गिनती की इकाई से अलग इकाई में है, इसलिए नहीं जोड़ी गई।",
    },
    runningLow: (name, n) => `${name} कम पड़ रहा है (${n} बचे)।`,
    reorderAsk: (name, n, supplier) => `${name} कम है (${n} बचे)। ${supplier} से मँगवाएँ?`,
    morningLow: (n) => `कम पड़ रहे: ${n}`,
    unitRefused: (name, unit) => `${name} की डिलीवरी गिनती में नहीं जोड़ी गई: गिनती ${unit} में है और डिलीवरी दूसरी इकाई में है।`,
  },
  ml: {
    title: "സ്റ്റോക്ക്", intro: "കണക്ക് വയ്ക്കേണ്ട സാധനങ്ങൾ എണ്ണി വയ്ക്കുക. എണ്ണാത്ത സാധനം മുമ്പത്തെ പോലെ തന്നെ.", empty: "ഇതുവരെ ഒന്നും എണ്ണിയിട്ടില്ല.",
    left: (n, unit) => `${n}${unit ? ` ${unit}` : ""} ബാക്കി`, soldOut: "വിറ്റുതീർന്നു", low: "കുറഞ്ഞുവരുന്നു", lowMark: (n) => `${n} അല്ലെങ്കിൽ അതിൽ കുറവായാൽ അറിയിക്കുക`,
    setCount: "എണ്ണം സജ്ജമാക്കുക", newCount: "ഇപ്പോൾ എത്രയുണ്ട്?", save: "സേവ് ചെയ്യുക", soldOne: "1 വിറ്റു", soldMany: "വിറ്റു", stop: "എണ്ണുന്നത് നിർത്തുക", stopHelp: "ഈ സാധനം എണ്ണമില്ലാതെ മുമ്പത്തെ പോലെ പ്രവർത്തിക്കും.",
    addTitle: "മറ്റൊരു സാധനം എണ്ണുക", addItem: "സാധനം", addCount: "ഇപ്പോൾ എത്രയുണ്ട്?", addLow: "എത്രയായാൽ അറിയിക്കണം (വേണമെങ്കിൽ)", addButton: "എണ്ണിത്തുടങ്ങുക", nothingToAdd: "എല്ലാ സാധനങ്ങളും ഇപ്പോൾ തന്നെ എണ്ണുന്നുണ്ട്.",
    history: "സമീപകാലം",
    moves: { started: "എണ്ണൽ തുടങ്ങി", sold: "വിറ്റു", returned: "തിരികെ ചേർത്തു", received: "കിട്ടി", corrected: "എണ്ണം തിരുത്തി" },
    short: (n) => `${n} കുറവായിരുന്നു`,
    kinds: { listing: "നിങ്ങളുടെ പേജിൽ", menu: "നിങ്ങളുടെ മെനുവിൽ", supply: "നിങ്ങളുടെ സപ്ലയർമാരിൽ നിന്ന്" },
    saved: "സേവ് ചെയ്തു.",
    notices: {
      stale: "നോക്കിക്കൊണ്ടിരിക്കെ എണ്ണം മാറി. പരിശോധിച്ച് വീണ്ടും സേവ് ചെയ്യുക.", bad_count: "എണ്ണം 0 അല്ലെങ്കിൽ അതിലധികമായ പൂർണ്ണസംഖ്യയാണ്.", bad_low: "കുറവിന്റെ പരിധി 0 അല്ലെങ്കിൽ അതിലധികമായ പൂർണ്ണസംഖ്യയാണ്.",
      bad_id: "ഈ സാധനം ഈ കടയുടേതല്ല.", bad_text: "ആ പേരോ യൂണിറ്റോ വളരെ നീളമുള്ളതാണ്.", exists: "ഈ സാധനം ഇപ്പോൾ തന്നെ എണ്ണുന്നുണ്ട്.", full: "ഒരു കടയ്ക്ക് ഇതിലധികം സാധനങ്ങൾ എണ്ണാൻ കഴിയില്ല.",
      no_such_line: "ഈ സാധനം എണ്ണുന്നില്ല.", unit: "ആ ഡെലിവറി എണ്ണത്തിന്റെ യൂണിറ്റിൽ നിന്ന് വ്യത്യസ്തമായ യൂണിറ്റിലാണ്, അതിനാൽ ചേർത്തില്ല.",
    },
    runningLow: (name, n) => `${name} കുറഞ്ഞുവരുന്നു (${n} ബാക്കി).`,
    reorderAsk: (name, n, supplier) => `${name} കുറവാണ് (${n} ബാക്കി). ${supplier}-ൽ നിന്ന് ഓർഡർ ചെയ്യട്ടെ?`,
    morningLow: (n) => `കുറഞ്ഞുവരുന്നവ: ${n}`,
    unitRefused: (name, unit) => `${name}-ന്റെ ഡെലിവറി എണ്ണത്തിൽ ചേർത്തില്ല: എണ്ണം ${unit}-ലാണ്, ഡെലിവറി മറ്റൊരു യൂണിറ്റിലാണ്.`,
  },
  kn: {
    title: "ಸ್ಟಾಕ್", intro: "ಲೆಕ್ಕ ಇಡಬೇಕಾದ ವಸ್ತುಗಳನ್ನು ಎಣಿಸಿ. ಎಣಿಸದ ವಸ್ತು ಮೊದಲಿನಂತೆಯೇ ಇರುತ್ತದೆ.", empty: "ಇನ್ನೂ ಏನನ್ನೂ ಎಣಿಸಿಲ್ಲ.",
    left: (n, unit) => `${n}${unit ? ` ${unit}` : ""} ಉಳಿದಿದೆ`, soldOut: "ಮಾರಾಟವಾಗಿದೆ", low: "ಕಡಿಮೆಯಾಗುತ್ತಿದೆ", lowMark: (n) => `${n} ಅಥವಾ ಕಡಿಮೆಯಾದಾಗ ತಿಳಿಸಿ`,
    setCount: "ಎಣಿಕೆ ಹೊಂದಿಸಿ", newCount: "ಈಗ ಎಷ್ಟಿದೆ?", save: "ಉಳಿಸಿ", soldOne: "1 ಮಾರಾಟವಾಯಿತು", soldMany: "ಮಾರಾಟವಾಯಿತು", stop: "ಎಣಿಸುವುದನ್ನು ನಿಲ್ಲಿಸಿ", stopHelp: "ಈ ವಸ್ತು ಎಣಿಕೆ ಇಲ್ಲದೆ ಮೊದಲಿನಂತೆ ನಡೆಯುತ್ತದೆ.",
    addTitle: "ಇನ್ನೊಂದು ವಸ್ತುವನ್ನು ಎಣಿಸಿ", addItem: "ವಸ್ತು", addCount: "ಈಗ ಎಷ್ಟಿದೆ?", addLow: "ಎಷ್ಟಕ್ಕೆ ಇಳಿದಾಗ ತಿಳಿಸಬೇಕು (ಬೇಕಿದ್ದರೆ)", addButton: "ಎಣಿಸಲು ಶುರುಮಾಡಿ", nothingToAdd: "ಎಲ್ಲ ವಸ್ತುಗಳನ್ನೂ ಈಗಾಗಲೇ ಎಣಿಸಲಾಗುತ್ತಿದೆ.",
    history: "ಇತ್ತೀಚೆಗೆ",
    moves: { started: "ಎಣಿಕೆ ಶುರುವಾಯಿತು", sold: "ಮಾರಾಟವಾಯಿತು", returned: "ವಾಪಸ್ ಸೇರಿಸಲಾಯಿತು", received: "ಬಂದಿತು", corrected: "ಎಣಿಕೆ ಸರಿಪಡಿಸಲಾಯಿತು" },
    short: (n) => `${n} ಕಡಿಮೆ ಇತ್ತು`,
    kinds: { listing: "ನಿಮ್ಮ ಪುಟದಲ್ಲಿ", menu: "ನಿಮ್ಮ ಮೆನುವಿನಲ್ಲಿ", supply: "ನಿಮ್ಮ ಸರಬರಾಜುದಾರರಿಂದ" },
    saved: "ಉಳಿಸಲಾಗಿದೆ.",
    notices: {
      stale: "ನೀವು ನೋಡುತ್ತಿರುವಾಗ ಎಣಿಕೆ ಬದಲಾಯಿತು. ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಉಳಿಸಿ.", bad_count: "ಎಣಿಕೆ 0 ಅಥವಾ ಹೆಚ್ಚಿನ ಪೂರ್ಣ ಸಂಖ್ಯೆ.", bad_low: "ಕಡಿಮೆ ಮಿತಿ 0 ಅಥವಾ ಹೆಚ್ಚಿನ ಪೂರ್ಣ ಸಂಖ್ಯೆ.",
      bad_id: "ಈ ವಸ್ತು ಈ ಅಂಗಡಿಯದಲ್ಲ.", bad_text: "ಆ ಹೆಸರು ಅಥವಾ ಘಟಕ ತುಂಬಾ ಉದ್ದವಾಗಿದೆ.", exists: "ಈ ವಸ್ತುವನ್ನು ಈಗಾಗಲೇ ಎಣಿಸಲಾಗುತ್ತಿದೆ.", full: "ಒಂದು ಅಂಗಡಿ ಇದಕ್ಕಿಂತ ಹೆಚ್ಚು ವಸ್ತುಗಳನ್ನು ಎಣಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.",
      no_such_line: "ಈ ವಸ್ತುವನ್ನು ಎಣಿಸುತ್ತಿಲ್ಲ.", unit: "ಆ ಡೆಲಿವರಿ ಎಣಿಕೆಯ ಘಟಕಕ್ಕಿಂತ ಬೇರೆ ಘಟಕದಲ್ಲಿದೆ, ಆದ್ದರಿಂದ ಸೇರಿಸಲಿಲ್ಲ.",
    },
    runningLow: (name, n) => `${name} ಕಡಿಮೆಯಾಗುತ್ತಿದೆ (${n} ಉಳಿದಿದೆ).`,
    reorderAsk: (name, n, supplier) => `${name} ಕಡಿಮೆ ಇದೆ (${n} ಉಳಿದಿದೆ). ${supplier} ಅವರಿಂದ ಆರ್ಡರ್ ಮಾಡಲೇ?`,
    morningLow: (n) => `ಕಡಿಮೆಯಾಗುತ್ತಿರುವವು: ${n}`,
    unitRefused: (name, unit) => `${name} ಡೆಲಿವರಿಯನ್ನು ಎಣಿಕೆಗೆ ಸೇರಿಸಲಿಲ್ಲ: ಎಣಿಕೆ ${unit}ನಲ್ಲಿದೆ, ಡೆಲಿವರಿ ಬೇರೆ ಘಟಕದಲ್ಲಿದೆ.`,
  },
};

/** Every line in one language by id, with sample values, for the review sheets (bundle/panel/review.ts, ids "stockline.*"). */
export function stockReviewLines(language: Language): Record<string, string> {
  const w = STOCK_LINE_WORDS[language];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(w)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "object") for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = v2 as string;
  }
  out.left = w.left(12, "kg");
  out.lowMark = w.lowMark(3);
  out.short = w.short(2);
  out.runningLow = w.runningLow("Rice 5 kg", 3);
  out.reorderAsk = w.reorderAsk("Rice 5 kg", 3, "Ravi Traders");
  out.morningLow = w.morningLow("2");
  out.unitRefused = w.unitRefused("Rice 5 kg", "bag");
  return out;
}
