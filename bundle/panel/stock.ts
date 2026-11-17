// The phone setup for a Stock orders shop (a salon, a small retailer or an input dealer that reorders from a few suppliers): the two forms (the shop with its suppliers and
// its catalogue lines; then the two limits, the most one order may be worth and the month's budget), what they refuse in the person's own language, how they become the settings a
// builder would write, and the shop page's pieces. Languages, accounts, character and checks are the shared steps (setup.ts). `validateSettings` of the template is the last gate.
//
// The form is plain, like Orders': one box with a supplier on each line ("Ravi Traders, +919876500001") and one with a catalogue line on each ("hair colour, Ravi Traders, box,
// 1200"). Words of the forms are here in four languages (machine-written Hindi, Malayalam and Kannada, on the review sheets: STOCK_PANEL_WORDS), found by the panel's own `Words`
// language name, so the shared words files change only by one template name each. The shop's runtime.json has WhatsApp and nothing else: a supplier is reached on it.
import type { Language } from "../../modules/language/languages.ts";
import { formatInr } from "../../modules/language/format.ts";
import { limitLinesOf, limitsOf } from "../../templates/commerce/stock-orders/report/certificate.ts";
import { validateSettings, nameIn } from "../../templates/commerce/stock-orders/src/settings.ts";
import type { Settings } from "../../templates/commerce/stock-orders/src/settings.ts";
import { idsFrom } from "./fees.ts";
import { newPayment } from "./setup.ts";
import type { Body, Built, Draft, StepResult } from "./setup.ts";
import type { ShopMeta } from "./shops.ts";
import { whatsappDraftOf } from "./setup.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";
import { KEEP, keepHidden } from "./keep.ts";
import { wordsLanguage } from "./languages.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import type { Helpers } from "./views-fees.ts";
import type { Ctx, TemplateMessages, TemplateSummary } from "./views.ts";

export const MAX_SUPPLIERS = 12;
export const MAX_LINES = 40;

/** What the form shows and sends back. Every value is text, as typed. */
export interface StockForm {
  address: string;
  /** One supplier on each line: name, WhatsApp number. */
  suppliers: string;
  /** One catalogue line on each: item, supplier, unit, price, and (left out or typed) how many a low-stock mark orders. */
  catalogue: string;
  maxPerOrderInr: string; monthlyBudgetInr: string;
  /** Kept from a shop being changed so its orders still find their lines: the id a name had. What the form has no box for (the follow-up hours, the most units, a supplier's approval) is put back by keep.ts from the saved settings. */
  keep?: { ids: Record<string, string> };
}

// ---- the words of the forms, in four languages -------------------------------------------------------------------------------------

export interface StockPanelWords {
  steps: { business: string; rules: string };
  business: { name: string; address: string; suppliers: string; suppliersHelp: string; catalogue: string; catalogueHelp: string };
  rules: { cap: string; capHelp: string; budget: string; budgetHelp: string };
  problems: {
    noSuppliers: string; tooManySuppliers: (n: number) => string; supplierBad: (row: number) => string; supplierTwice: (row: number, name: string) => string; numberTwice: (row: number) => string;
    noLines: string; tooManyLines: (n: number) => string; lineBad: (row: number) => string; lineSupplier: (row: number, name: string) => string; priceBad: (row: number) => string; reorderBad: (row: number) => string; lineTwice: (row: number) => string;
    capBad: string; budgetBad: string; capAbovePrice: (price: string) => string; capAboveBudget: string;
  };
  shop: { suppliers: string; catalogue: string; rules: string; messages: { heading: string; line: (perOrder: number) => string; note: string }; states: Record<string, string> };
}

const states = (a: [string, string, string, string, string, string]): Record<string, string> => ({ awaiting_approval: a[0], approved: a[1], sent: a[2], send_unknown: a[3], supplier_declined: a[4], cancelled: a[5] });

export const STOCK_PANEL_WORDS: Record<Language, StockPanelWords> = {
  en: {
    steps: { business: "Shop, suppliers and catalogue", rules: "Limits" },
    business: {
      name: "Shop name", address: "Address", suppliers: "Suppliers", suppliersHelp: "One supplier on each line: the name, then the WhatsApp number with +91. Example: Ravi Traders, +919876500001",
      catalogue: "What you order", catalogueHelp: "One line for each thing you order: item, supplier, pack, last price in rupees. Optionally, how many to order when you say it is low. Example: hair colour, Ravi Traders, box, 1200, 10",
    },
    rules: { cap: "Most one order may be worth (rupees)", capHelp: "A hard stop: your yes cannot raise it. You can tighten it later by a tap.", budget: "Most the month's orders may add up to (rupees)", budgetHelp: "Kept for an order when you approve it." },
    problems: {
      noSuppliers: "Add at least one supplier.", tooManySuppliers: (n) => `This form takes at most ${n} suppliers.`, supplierBad: (r) => `Supplier line ${r}: write the name, then the WhatsApp number with +91.`,
      supplierTwice: (r, n) => `Supplier line ${r}: ${n} is listed twice.`, numberTwice: (r) => `Supplier line ${r}: that number is another supplier's already.`,
      noLines: "Add at least one line of what you order.", tooManyLines: (n) => `This form takes at most ${n} lines.`, lineBad: (r) => `Line ${r}: write the item, the supplier, the pack and the price, separated by commas.`,
      lineSupplier: (r, n) => `Line ${r}: ${n} is not in your suppliers.`, priceBad: (r) => `Line ${r}: the price must be a number of rupees above 0, with at most two decimals.`, reorderBad: (r) => `Line ${r}: the number to order when low must be a whole number of 1 or more.`,
      lineTwice: (r) => `Line ${r}: the same item, supplier and pack is listed twice.`,
      capBad: "The most one order may be worth must be a whole number of rupees above 0.", budgetBad: "The month's budget must be a whole number of rupees above 0.",
      capAbovePrice: (p) => `One unit costs ${p}, more than the most one order may be worth: it could never be ordered. Raise the limit or fix the price.`, capAboveBudget: "The most for one order is above the month's budget. Make the order limit the smaller number.",
    },
    shop: { suppliers: "Suppliers", catalogue: "What you order", rules: "Limits", messages: { heading: "Messages for one order", line: (n) => `About ${n} messages for each order: the order to the supplier, up to two asks if they are silent, and notes to you.`, note: "A planning figure, not a limit. Replies come on top." }, states: states(["Waiting for your yes", "Being sent", "With the supplier", "Maybe sent", "Supplier cannot supply", "Cancelled"]) },
  },
  hi: {
    steps: { business: "दुकान, सप्लायर और सूची", rules: "सीमाएँ" },
    business: {
      name: "दुकान का नाम", address: "पता", suppliers: "सप्लायर", suppliersHelp: "हर लाइन में एक सप्लायर: नाम, फिर +91 के साथ WhatsApp नंबर। जैसे: Ravi Traders, +919876500001",
      catalogue: "आप क्या मँगाते हैं", catalogueHelp: "जो मँगाते हैं उसकी हर चीज़ की एक लाइन: चीज़, सप्लायर, पैक, पिछला दाम रुपये में। चाहें तो कम होने पर कितना मँगाना है। जैसे: हेयर कलर, Ravi Traders, डिब्बा, 1200, 10",
    },
    rules: { cap: "एक ऑर्डर कितने का हो सकता है (रुपये)", capHelp: "यह पक्की रोक है: आपकी हाँ इसे नहीं बढ़ा सकती। बाद में एक टैप से इसे और कम कर सकते हैं।", budget: "महीने के ऑर्डर कुल कितने हो सकते हैं (रुपये)", budgetHelp: "ऑर्डर मंज़ूर करते ही उसके लिए रख लिया जाता है।" },
    problems: {
      noSuppliers: "कम से कम एक सप्लायर जोड़ें।", tooManySuppliers: (n) => `इस फ़ॉर्म में ज़्यादा से ज़्यादा ${n} सप्लायर आते हैं।`, supplierBad: (r) => `सप्लायर लाइन ${r}: नाम लिखें, फिर +91 के साथ WhatsApp नंबर।`,
      supplierTwice: (r, n) => `सप्लायर लाइन ${r}: ${n} दो बार लिखा है।`, numberTwice: (r) => `सप्लायर लाइन ${r}: यह नंबर पहले से दूसरे सप्लायर का है।`,
      noLines: "जो मँगाते हैं उसकी कम से कम एक लाइन जोड़ें।", tooManyLines: (n) => `इस फ़ॉर्म में ज़्यादा से ज़्यादा ${n} लाइनें आती हैं।`, lineBad: (r) => `लाइन ${r}: चीज़, सप्लायर, पैक और दाम कॉमा से अलग करके लिखें।`,
      lineSupplier: (r, n) => `लाइन ${r}: ${n} आपके सप्लायरों में नहीं है।`, priceBad: (r) => `लाइन ${r}: दाम 0 से ऊपर रुपयों की संख्या होना चाहिए, ज़्यादा से ज़्यादा दो दशमलव।`, reorderBad: (r) => `लाइन ${r}: कम होने पर मँगाने की संख्या 1 या उससे ज़्यादा पूरी संख्या होनी चाहिए।`,
      lineTwice: (r) => `लाइन ${r}: वही चीज़, सप्लायर और पैक दो बार लिखा है।`,
      capBad: "एक ऑर्डर की सीमा 0 से ऊपर पूरे रुपये होनी चाहिए।", budgetBad: "महीने का बजट 0 से ऊपर पूरे रुपये होना चाहिए।",
      capAbovePrice: (p) => `एक नग ${p} का है, जो एक ऑर्डर की सीमा से ज़्यादा है: उसे कभी मँगाया नहीं जा सकेगा। सीमा बढ़ाएँ या दाम ठीक करें।`, capAboveBudget: "एक ऑर्डर की सीमा महीने के बजट से ऊपर है। ऑर्डर की सीमा छोटी रखें।",
    },
    shop: { suppliers: "सप्लायर", catalogue: "आप क्या मँगाते हैं", rules: "सीमाएँ", messages: { heading: "एक ऑर्डर के संदेश", line: (n) => `हर ऑर्डर पर लगभग ${n} संदेश: सप्लायर को ऑर्डर, चुप रहने पर दो बार तक पूछना, और आपको सूचनाएँ।`, note: "यह अंदाज़ा है, सीमा नहीं। जवाब इसके ऊपर आते हैं।" }, states: states(["आपकी हाँ का इंतज़ार", "भेजा जा रहा है", "सप्लायर के पास", "शायद भेजा गया", "सप्लायर नहीं दे सकता", "रद्द"]) },
  },
  ml: {
    steps: { business: "കട, സപ്ലയർമാർ, പട്ടിക", rules: "പരിധികൾ" },
    business: {
      name: "കടയുടെ പേര്", address: "വിലാസം", suppliers: "സപ്ലയർമാർ", suppliersHelp: "ഓരോ വരിയിലും ഒരു സപ്ലയർ: പേര്, പിന്നെ +91 സഹിതം WhatsApp നമ്പർ. ഉദാഹരണം: Ravi Traders, +919876500001",
      catalogue: "നിങ്ങൾ ഓർഡർ ചെയ്യുന്നവ", catalogueHelp: "ഓർഡർ ചെയ്യുന്ന ഓരോന്നിനും ഒരു വരി: സാധനം, സപ്ലയർ, പായ്ക്ക്, അവസാന വില രൂപയിൽ. വേണമെങ്കിൽ, കുറവാണെന്ന് പറയുമ്പോൾ എത്ര ഓർഡർ ചെയ്യണം. ഉദാഹരണം: ഹെയർ കളർ, Ravi Traders, ബോക്സ്, 1200, 10",
    },
    rules: { cap: "ഒരു ഓർഡറിന് പരമാവധി മൂല്യം (രൂപ)", capHelp: "ഇത് ഉറച്ച പരിധിയാണ്: നിങ്ങളുടെ സമ്മതം ഇത് കൂട്ടില്ല. പിന്നീട് ഒരു ടാപ്പിൽ ഇത് കുറയ്ക്കാം.", budget: "മാസത്തെ ഓർഡറുകൾ ആകെ പരമാവധി (രൂപ)", budgetHelp: "ഒരു ഓർഡർ അനുവദിക്കുമ്പോൾ അതിനായി മാറ്റിവയ്ക്കും." },
    problems: {
      noSuppliers: "ഒരു സപ്ലയറെങ്കിലും ചേർക്കുക.", tooManySuppliers: (n) => `ഈ ഫോമിൽ പരമാവധി ${n} സപ്ലയർമാർ.`, supplierBad: (r) => `സപ്ലയർ വരി ${r}: പേരും പിന്നെ +91 സഹിതം WhatsApp നമ്പറും എഴുതുക.`,
      supplierTwice: (r, n) => `സപ്ലയർ വരി ${r}: ${n} രണ്ടുതവണ ഉണ്ട്.`, numberTwice: (r) => `സപ്ലയർ വരി ${r}: ഈ നമ്പർ മറ്റൊരു സപ്ലയറുടേതാണ്.`,
      noLines: "ഓർഡർ ചെയ്യുന്നവയുടെ ഒരു വരിയെങ്കിലും ചേർക്കുക.", tooManyLines: (n) => `ഈ ഫോമിൽ പരമാവധി ${n} വരികൾ.`, lineBad: (r) => `വരി ${r}: സാധനം, സപ്ലയർ, പായ്ക്ക്, വില എന്നിവ കോമ കൊണ്ട് വേർതിരിച്ച് എഴുതുക.`,
      lineSupplier: (r, n) => `വരി ${r}: ${n} നിങ്ങളുടെ സപ്ലയർമാരിൽ ഇല്ല.`, priceBad: (r) => `വരി ${r}: വില 0-ന് മുകളിലുള്ള രൂപയുടെ സംഖ്യയായിരിക്കണം, പരമാവധി രണ്ട് ദശാംശം.`, reorderBad: (r) => `വരി ${r}: കുറയുമ്പോൾ ഓർഡർ ചെയ്യേണ്ട എണ്ണം 1 ഓ അതിൽ കൂടുതലോ ഉള്ള പൂർണ്ണസംഖ്യ ആയിരിക്കണം.`,
      lineTwice: (r) => `വരി ${r}: ഒരേ സാധനം, സപ്ലയർ, പായ്ക്ക് രണ്ടുതവണ ഉണ്ട്.`,
      capBad: "ഒരു ഓർഡറിന്റെ പരിധി 0-ന് മുകളിലുള്ള പൂർണ്ണ രൂപയായിരിക്കണം.", budgetBad: "മാസത്തെ ബജറ്റ് 0-ന് മുകളിലുള്ള പൂർണ്ണ രൂപയായിരിക്കണം.",
      capAbovePrice: (p) => `ഒന്നിന് ${p} വിലയുണ്ട്, ഒരു ഓർഡറിന്റെ പരിധിയേക്കാൾ കൂടുതൽ: ഇത് ഒരിക്കലും ഓർഡർ ചെയ്യാനാകില്ല. പരിധി കൂട്ടുക അല്ലെങ്കിൽ വില ശരിയാക്കുക.`, capAboveBudget: "ഒരു ഓർഡറിന്റെ പരിധി മാസത്തെ ബജറ്റിനേക്കാൾ കൂടുതലാണ്. ഓർഡർ പരിധി ചെറിയ സംഖ്യയാക്കുക.",
    },
    shop: { suppliers: "സപ്ലയർമാർ", catalogue: "നിങ്ങൾ ഓർഡർ ചെയ്യുന്നവ", rules: "പരിധികൾ", messages: { heading: "ഒരു ഓർഡറിന്റെ സന്ദേശങ്ങൾ", line: (n) => `ഓരോ ഓർഡറിനും ഏകദേശം ${n} സന്ദേശങ്ങൾ: സപ്ലയർക്കുള്ള ഓർഡർ, മറുപടി ഇല്ലെങ്കിൽ രണ്ടുവരെ ചോദ്യങ്ങൾ, നിങ്ങൾക്കുള്ള അറിയിപ്പുകൾ.`, note: "ഇത് ഒരു കണക്കുകൂട്ടൽ മാത്രമാണ്, പരിധിയല്ല. മറുപടികൾ ഇതിനുപുറമെ." }, states: states(["നിങ്ങളുടെ സമ്മതത്തിനായി കാത്തിരിക്കുന്നു", "അയയ്ക്കുന്നു", "സപ്ലയറുടെ പക്കൽ", "ഒരുപക്ഷേ അയച്ചു", "സപ്ലയർക്ക് നൽകാനാവില്ല", "റദ്ദാക്കി"]) },
  },
  kn: {
    steps: { business: "ಅಂಗಡಿ, ಸರಬರಾಜುದಾರರು, ಪಟ್ಟಿ", rules: "ಮಿತಿಗಳು" },
    business: {
      name: "ಅಂಗಡಿಯ ಹೆಸರು", address: "ವಿಳಾಸ", suppliers: "ಸರಬರಾಜುದಾರರು", suppliersHelp: "ಪ್ರತಿ ಸಾಲಿನಲ್ಲಿ ಒಬ್ಬ ಸರಬರಾಜುದಾರ: ಹೆಸರು, ನಂತರ +91 ಸಹಿತ WhatsApp ಸಂಖ್ಯೆ. ಉದಾಹರಣೆ: Ravi Traders, +919876500001",
      catalogue: "ನೀವು ಆರ್ಡರ್ ಮಾಡುವುದು", catalogueHelp: "ಆರ್ಡರ್ ಮಾಡುವ ಪ್ರತಿಯೊಂದಕ್ಕೂ ಒಂದು ಸಾಲು: ವಸ್ತು, ಸರಬರಾಜುದಾರ, ಪ್ಯಾಕ್, ಕೊನೆಯ ಬೆಲೆ ರೂಪಾಯಿಗಳಲ್ಲಿ. ಬೇಕಿದ್ದರೆ, ಕಡಿಮೆ ಎಂದಾಗ ಎಷ್ಟು ಆರ್ಡರ್ ಮಾಡಬೇಕು. ಉದಾಹರಣೆ: ಹೇರ್ ಕಲರ್, Ravi Traders, ಬಾಕ್ಸ್, 1200, 10",
    },
    rules: { cap: "ಒಂದು ಆರ್ಡರ್ ಗರಿಷ್ಠ ಎಷ್ಟು ಮೌಲ್ಯದ್ದಾಗಬಹುದು (ರೂಪಾಯಿ)", capHelp: "ಇದು ಗಟ್ಟಿ ಮಿತಿ: ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇದನ್ನು ಹೆಚ್ಚಿಸಲಾರದು. ನಂತರ ಒಂದು ಟ್ಯಾಪ್‌ನಲ್ಲಿ ಇದನ್ನು ಇನ್ನೂ ಕಡಿಮೆ ಮಾಡಬಹುದು.", budget: "ತಿಂಗಳ ಆರ್ಡರ್‌ಗಳು ಒಟ್ಟು ಗರಿಷ್ಠ ಎಷ್ಟು (ರೂಪಾಯಿ)", budgetHelp: "ಆರ್ಡರ್ ಒಪ್ಪಿದ ತಕ್ಷಣ ಅದಕ್ಕಾಗಿ ಮೀಸಲಿಡಲಾಗುತ್ತದೆ." },
    problems: {
      noSuppliers: "ಕನಿಷ್ಠ ಒಬ್ಬ ಸರಬರಾಜುದಾರರನ್ನು ಸೇರಿಸಿ.", tooManySuppliers: (n) => `ಈ ಫಾರ್ಮ್‌ನಲ್ಲಿ ಗರಿಷ್ಠ ${n} ಸರಬರಾಜುದಾರರು.`, supplierBad: (r) => `ಸರಬರಾಜುದಾರ ಸಾಲು ${r}: ಹೆಸರು, ನಂತರ +91 ಸಹಿತ WhatsApp ಸಂಖ್ಯೆ ಬರೆಯಿರಿ.`,
      supplierTwice: (r, n) => `ಸರಬರಾಜುದಾರ ಸಾಲು ${r}: ${n} ಎರಡು ಬಾರಿ ಇದೆ.`, numberTwice: (r) => `ಸರಬರಾಜುದಾರ ಸಾಲು ${r}: ಈ ಸಂಖ್ಯೆ ಈಗಾಗಲೇ ಇನ್ನೊಬ್ಬ ಸರಬರಾಜುದಾರರದು.`,
      noLines: "ಆರ್ಡರ್ ಮಾಡುವುದರ ಕನಿಷ್ಠ ಒಂದು ಸಾಲು ಸೇರಿಸಿ.", tooManyLines: (n) => `ಈ ಫಾರ್ಮ್‌ನಲ್ಲಿ ಗರಿಷ್ಠ ${n} ಸಾಲುಗಳು.`, lineBad: (r) => `ಸಾಲು ${r}: ವಸ್ತು, ಸರಬರಾಜುದಾರ, ಪ್ಯಾಕ್ ಮತ್ತು ಬೆಲೆಯನ್ನು ಅಲ್ಪವಿರಾಮದಿಂದ ಬೇರ್ಪಡಿಸಿ ಬರೆಯಿರಿ.`,
      lineSupplier: (r, n) => `ಸಾಲು ${r}: ${n} ನಿಮ್ಮ ಸರಬರಾಜುದಾರರಲ್ಲಿ ಇಲ್ಲ.`, priceBad: (r) => `ಸಾಲು ${r}: ಬೆಲೆ 0 ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ರೂಪಾಯಿ ಸಂಖ್ಯೆಯಾಗಿರಬೇಕು, ಗರಿಷ್ಠ ಎರಡು ದಶಮಾಂಶ.`, reorderBad: (r) => `ಸಾಲು ${r}: ಕಡಿಮೆ ಎಂದಾಗ ಆರ್ಡರ್ ಮಾಡುವ ಸಂಖ್ಯೆ 1 ಅಥವಾ ಹೆಚ್ಚಿನ ಪೂರ್ಣಸಂಖ್ಯೆ ಆಗಿರಬೇಕು.`,
      lineTwice: (r) => `ಸಾಲು ${r}: ಅದೇ ವಸ್ತು, ಸರಬರಾಜುದಾರ ಮತ್ತು ಪ್ಯಾಕ್ ಎರಡು ಬಾರಿ ಇದೆ.`,
      capBad: "ಒಂದು ಆರ್ಡರ್‌ನ ಮಿತಿ 0 ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಪೂರ್ಣ ರೂಪಾಯಿಗಳಾಗಿರಬೇಕು.", budgetBad: "ತಿಂಗಳ ಬಜೆಟ್ 0 ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಪೂರ್ಣ ರೂಪಾಯಿಗಳಾಗಿರಬೇಕು.",
      capAbovePrice: (p) => `ಒಂದಕ್ಕೆ ${p} ಬೆಲೆ, ಒಂದು ಆರ್ಡರ್‌ನ ಮಿತಿಗಿಂತ ಹೆಚ್ಚು: ಇದನ್ನು ಎಂದಿಗೂ ಆರ್ಡರ್ ಮಾಡಲಾಗದು. ಮಿತಿ ಹೆಚ್ಚಿಸಿ ಅಥವಾ ಬೆಲೆ ಸರಿಪಡಿಸಿ.`, capAboveBudget: "ಒಂದು ಆರ್ಡರ್‌ನ ಮಿತಿ ತಿಂಗಳ ಬಜೆಟ್‌ಗಿಂತ ಹೆಚ್ಚಿದೆ. ಆರ್ಡರ್ ಮಿತಿಯನ್ನು ಚಿಕ್ಕ ಸಂಖ್ಯೆಯನ್ನಾಗಿ ಮಾಡಿ.",
    },
    shop: { suppliers: "ಸರಬರಾಜುದಾರರು", catalogue: "ನೀವು ಆರ್ಡರ್ ಮಾಡುವುದು", rules: "ಮಿತಿಗಳು", messages: { heading: "ಒಂದು ಆರ್ಡರ್‌ನ ಸಂದೇಶಗಳು", line: (n) => `ಪ್ರತಿ ಆರ್ಡರ್‌ಗೆ ಸುಮಾರು ${n} ಸಂದೇಶಗಳು: ಸರಬರಾಜುದಾರರಿಗೆ ಆರ್ಡರ್, ಉತ್ತರ ಇಲ್ಲದಿದ್ದರೆ ಎರಡು ಬಾರಿಯವರೆಗೆ ಕೇಳುವುದು, ಮತ್ತು ನಿಮಗೆ ಸೂಚನೆಗಳು.`, note: "ಇದು ಯೋಜನೆಯ ಅಂದಾಜು, ಮಿತಿಯಲ್ಲ. ಉತ್ತರಗಳು ಇದರ ಮೇಲೆ ಬರುತ್ತವೆ." }, states: states(["ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ", "ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ", "ಸರಬರಾಜುದಾರರ ಬಳಿ", "ಬಹುಶಃ ಕಳುಹಿಸಲಾಗಿದೆ", "ಸರಬರಾಜುದಾರರಿಂದ ಆಗದು", "ರದ್ದು"]) },
  },
};

/** The stock words for the panel's words of one language (found by its language name, so the shared words files need no new section). */
export const stockWords = (w: Words): StockPanelWords => STOCK_PANEL_WORDS[wordsLanguage(w)];
const stockOf = (draft: Draft): StockForm => (draft as unknown as { stock: StockForm }).stock;

// ---- reading the two boxes ----------------------------------------------------------------------------------------------------------

const text = (v: string | undefined, max = 120) => (v ?? "").trim().slice(0, max);
const lines = (v: string): string[] => v.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "");
const PHONE = /^\+\d{10,15}$/u;
const MONEY = /^\d{1,7}(?:\.\d{1,2})?$/u;
const WHOLE = /^\d{1,9}$/u;
const wholeAbove0 = (v: string) => WHOLE.test(v) && Number(v) >= 1;

/** One supplier line: the name (which may hold a comma) and the number after the last comma. */
export function supplierLine(line: string): { name: string; number: string } | undefined {
  const i = line.lastIndexOf(",");
  if (i < 1) return undefined;
  const name = line.slice(0, i).trim();
  const number = line.slice(i + 1).replace(/[\s-]/gu, "");
  return name !== "" && PHONE.test(number) ? { name, number } : undefined;
}

/** One catalogue line: item, supplier, unit, price, and optionally the number to order when low. */
export function catalogueLine(line: string): { item: string; supplier: string; unit: string; price: string; reorder?: string } | undefined {
  const p = line.split(",").map((x) => x.trim());
  if (p.length < 4 || p.length > 5 || p.slice(0, 4).some((x) => x === "")) return undefined;
  return { item: p[0], supplier: p[1], unit: p[2], price: p[3].replace(/^₹\s*/u, ""), ...(p[4] ? { reorder: p[4] } : {}) };
}

// ---- the draft ----------------------------------------------------------------------------------------------------------------------------

const emptyShopForm = (): Draft["form"] => ({ name: "", language: "en", services: [], deposit: "", opens: "", closes: "", days: [] });

export function newStockDraft(id: string, accountId: string, template: Template, example: Settings, now: string): Draft {
  return {
    id, accountId, template: template.id, createdAt: now, editing: false, saved: false,
    form: emptyShopForm(), windowHours: "", primaryLanguage: example.languages[0], otherLanguages: [], ownerLanguage: example.owner.language, ownerNumber: "",
    whatsapp: { businessNumber: "", numberId: "" }, calendar: { id: "" }, gateway: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: 0,
    stock: { address: "", suppliers: "", catalogue: "", maxPerOrderInr: String(example.limits.maxPerOrderInr), monthlyBudgetInr: String(example.limits.monthlyBudgetInr) } satisfies StockForm,
  } as Draft;
}

export function stockDraftFromShop(id: string, accountId: string, templateId: string, shopId: string, s: Settings, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft {
  const first = s.languages[0];
  const ids: Record<string, string> = {};
  const name = (id2: string, list: { id: string; names: Settings["items"][number]["names"] }[]) => nameIn(list.find((x) => x.id === id2)!.names, first);
  const suppliers = s.suppliers.map((x) => { ids[`s:${x.name.toLowerCase()}`] = x.id; return `${x.name}, ${x.whatsapp}`; }).join("\n");
  const catalogue = s.catalogue.map((l) => {
    const item = name(l.item, s.items); const unit = name(l.unit, s.units);
    ids[`i:${item.toLowerCase()}`] = l.item; ids[`u:${unit.toLowerCase()}`] = l.unit;
    return `${item}, ${s.suppliers.find((x) => x.id === l.supplier)!.name}, ${unit}, ${l.priceInr}${l.reorderQty ? `, ${l.reorderQty}` : ""}`;
  }).join("\n");
  return {
    id, accountId, template: templateId, createdAt: now, shopId, editing: true, saved: true, form: { ...emptyShopForm(), name: s.name }, windowHours: "",
    primaryLanguage: first, otherLanguages: s.languages.slice(1), ownerLanguage: s.owner.language, ownerNumber: s.owner.whatsapp, whatsapp: whatsappDraftOf(meta, runtime),
    calendar: { id: "" }, gateway: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: Number.MAX_SAFE_INTEGER,
    stock: { address: s.address ?? "", suppliers, catalogue, maxPerOrderInr: String(s.limits.maxPerOrderInr), monthlyBudgetInr: String(s.limits.monthlyBudgetInr), keep: { ids } } satisfies StockForm,
  } as Draft;
}

// ---- step 1: the shop, its suppliers and its catalogue ---------------------------------------------------------------------------------

export function applyStockBusiness(draft: Draft, body: Body, w: Words): StepResult {
  const s = w.setup.problems;
  const p = stockWords(w).problems;
  const problems: string[] = [];
  const name = text(body.name, 80);
  const suppliers = (body.suppliers ?? "").slice(0, 5000);
  const catalogue = (body.catalogue ?? "").slice(0, 20_000);
  if (name === "") problems.push(s.nameEmpty);
  draft.form = { ...draft.form, name };
  draft.stock = { ...stockOf(draft), address: text(body.address, 120), suppliers, catalogue };
  const sup = lines(suppliers);
  const names = new Set<string>();
  const numbers = new Set<string>();
  if (sup.length === 0) problems.push(p.noSuppliers);
  else if (sup.length > MAX_SUPPLIERS) problems.push(p.tooManySuppliers(MAX_SUPPLIERS));
  else sup.forEach((line, i) => {
    const x = supplierLine(line);
    if (!x) { problems.push(p.supplierBad(i + 1)); return; }
    if (names.has(x.name.toLowerCase())) problems.push(p.supplierTwice(i + 1, x.name));
    if (numbers.has(x.number)) problems.push(p.numberTwice(i + 1));
    names.add(x.name.toLowerCase()); numbers.add(x.number);
  });
  const rows = lines(catalogue);
  const seen = new Set<string>();
  if (rows.length === 0) problems.push(p.noLines);
  else if (rows.length > MAX_LINES) problems.push(p.tooManyLines(MAX_LINES));
  else rows.forEach((line, i) => {
    const l = catalogueLine(line);
    if (!l) { problems.push(p.lineBad(i + 1)); return; }
    if (!names.has(l.supplier.toLowerCase())) problems.push(p.lineSupplier(i + 1, l.supplier));
    if (!MONEY.test(l.price) || Number(l.price) <= 0) problems.push(p.priceBad(i + 1));
    if (l.reorder !== undefined && !wholeAbove0(l.reorder)) problems.push(p.reorderBad(i + 1));
    const key = `${l.item}~${l.supplier}~${l.unit}`.toLowerCase();
    if (seen.has(key)) problems.push(p.lineTwice(i + 1));
    seen.add(key);
  });
  return { problems };
}

// ---- step 2: the two limits ---------------------------------------------------------------------------------------------------------------

export function applyStockRules(draft: Draft, body: Body, w: Words): StepResult {
  const p = stockWords(w).problems;
  const problems: string[] = [];
  const next: StockForm = { ...stockOf(draft), maxPerOrderInr: text(body.maxPerOrderInr, 9), monthlyBudgetInr: text(body.monthlyBudgetInr, 9) };
  if (!wholeAbove0(next.maxPerOrderInr)) problems.push(p.capBad);
  if (!wholeAbove0(next.monthlyBudgetInr)) problems.push(p.budgetBad);
  if (wholeAbove0(next.maxPerOrderInr) && wholeAbove0(next.monthlyBudgetInr) && Number(next.maxPerOrderInr) > Number(next.monthlyBudgetInr)) problems.push(p.capAboveBudget);
  const dearest = Math.max(0, ...lines(stockOf(draft).catalogue).map(catalogueLine).flatMap((l) => (l && MONEY.test(l.price) ? [Number(l.price)] : [])));
  if (wholeAbove0(next.maxPerOrderInr) && dearest > Number(next.maxPerOrderInr)) problems.push(p.capAbovePrice(formatInr(dearest)));
  draft.stock = next;
  return { problems };
}

// ---- the settings, and the runtime -----------------------------------------------------------------------------------------------------------

/**
 * The form becomes the Stock orders settings; `validateSettings` is the last word. `saved` is the shop's settings.json as written, for a shop being changed: the follow-up hours,
 * the most units in one order and each supplier's aliases, language and approval are put back from it (keep.ts), so an edit never approves a supplier the owner had not.
 */
export function buildStockSettings(draft: Draft, _example: Settings, saved?: unknown): Built {
  const f = stockOf(draft);
  const languages: Language[] = [draft.primaryLanguage as Language, ...(draft.otherLanguages as Language[])];
  const named = (n: string) => Object.fromEntries(languages.map((l) => [l, [n]]));
  const keep = f.keep ?? { ids: {} };
  const sup = lines(f.suppliers).map(supplierLine).flatMap((x) => (x ? [x] : []));
  const supplierIds = idsFrom(sup.map((x) => x.name), "supplier", sup.map((x) => keep.ids[`s:${x.name.toLowerCase()}`]));
  const rows = lines(f.catalogue).map(catalogueLine).flatMap((x) => (x ? [x] : []));
  const uniq = (list: string[]) => [...new Map(list.map((n) => [n.toLowerCase(), n])).values()];
  const itemNames = uniq(rows.map((r) => r.item));
  const unitNames = uniq(rows.map((r) => r.unit));
  const itemIds = idsFrom(itemNames, "item", itemNames.map((n) => keep.ids[`i:${n.toLowerCase()}`]));
  const unitIds = idsFrom(unitNames, "unit", unitNames.map((n) => keep.ids[`u:${n.toLowerCase()}`]));
  const idOf = (list: string[], ids: string[], n: string) => ids[list.findIndex((x) => x.toLowerCase() === n.toLowerCase())];
  const raw = {
    name: draft.form.name, ...(f.address !== "" ? { address: f.address } : {}), timezone: (saved as { timezone?: string } | undefined)?.timezone ?? "Asia/Kolkata", languages,
    owner: { whatsapp: draft.ownerNumber, language: draft.ownerLanguage },
    items: itemNames.map((n, i) => ({ id: itemIds[i], names: named(n) })), units: unitNames.map((n, i) => ({ id: unitIds[i], names: named(n) })),
    suppliers: sup.map((x, i) => ({ id: supplierIds[i], name: x.name, aliases: [], whatsapp: x.number, language: languages[0], approved: true })),
    catalogue: rows.map((r) => ({
      item: idOf(itemNames, itemIds, r.item), supplier: supplierIds[sup.findIndex((x) => x.name.toLowerCase() === r.supplier.toLowerCase())] ?? r.supplier, unit: idOf(unitNames, unitIds, r.unit),
      priceInr: Number(r.price), ...(r.reorder ? { reorderQty: Number(r.reorder) } : {}),
    })),
    limits: { maxPerOrderInr: Number(f.maxPerOrderInr), monthlyBudgetInr: Number(f.monthlyBudgetInr) },
  };
  const written = saved === undefined ? raw : keepHidden(raw, saved, KEEP["stock-orders"]);
  const checked = validateSettings(written);
  return checked.ok ? ({ ok: true, settings: checked.settings as never, raw: written } as Built) : { ok: false, errors: checked.errors };
}

/** The limits as one sentence each, in the person's language: the same lines the go-live certificate prints. */
export function stockLimitLines(draft: Draft, example: Settings, language: Language, saved?: Settings): string[] {
  const asked = draft.ownerNumber === "" ? { ...draft, ownerNumber: example.owner.whatsapp } : draft;
  const settings = saved ?? (() => { const built = buildStockSettings(asked, example); return built.ok ? (built.settings as unknown as Settings) : undefined; })();
  return settings ? limitLinesOf(limitsOf(settings), language) : [];
}

/** runtime.json: WhatsApp and nothing else (no payments, no calendar). With no number the services are empty, and the check says plainly that the shop needs WhatsApp. */
export function runtimeForStock(phoneNumberId: string, serverModel?: { wire: string; model: string }): Record<string, unknown> {
  return {
    mode: "live", tickSeconds: 30,
    services: { ...(phoneNumberId !== "" ? { messaging: { phoneNumberId } } : {}), timeoutMs: 20_000 },
    ...(serverModel ? { parser: { wire: serverModel.wire, model: serverModel.model } } : {}),
  };
}

// ---- the pages ------------------------------------------------------------------------------------------------------------------------------

const area = (id: string, label: string, value: string, rows: number, help?: string): Raw =>
  html`<label class="field"><span>${label}</span><textarea name="${id}" rows="${rows}" autocomplete="off" spellcheck="false">${value}</textarea>${help ? html`<p class="help">${help}</p>` : ""}</label>`;

export function stockBusinessBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, h: Helpers): Raw {
  const b = stockWords(c.w).business;
  const f = stockOf(d);
  return html`<form method="post" action="${action}">${h.csrf}
  ${h.text(b.name, "name", d.form.name, { max: 80 })}
  ${h.text(b.address, "address", f.address, { max: 120 })}
  ${area("suppliers", b.suppliers, f.suppliers, 4, b.suppliersHelp)}
  ${area("catalogue", b.catalogue, f.catalogue, 8, b.catalogueHelp)}
  ${back}${next}</form>`;
}

export function stockRulesBody(c: Ctx, d: Draft, action: string, back: Raw | string, next: Raw, linesOut: string[], h: Helpers): Raw {
  const r = stockWords(c.w).rules;
  const f = stockOf(d);
  return html`<form method="post" action="${action}">${h.csrf}
  ${h.text(r.cap, "maxPerOrderInr", f.maxPerOrderInr, { mode: "numeric", max: 9, help: r.capHelp })}
  ${h.text(r.budget, "monthlyBudgetInr", f.monthlyBudgetInr, { mode: "numeric", max: 9, help: r.budgetHelp })}
  ${linesOut.length > 0 ? html`<h2>${c.w.setup.depositStep.whatThisMeans}</h2><ul class="plain">${linesOut.map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>` : ""}
  ${back}${next}</form>`;
}

export function summaryStock(c: Ctx, s: Settings) {
  const w = stockWords(c.w).shop;
  const language = s.languages.includes(c.lang as Language) ? (c.lang as Language) : s.languages[0];
  return {
    heading: w.catalogue, rulesHeading: w.rules,
    lines: [
      ...s.catalogue.map((l) => `${nameIn(s.items.find((i) => i.id === l.item)!.names, language)} · ${s.suppliers.find((x) => x.id === l.supplier)!.name} · ${nameIn(s.units.find((u) => u.id === l.unit)!.names, language)} · ${formatInr(l.priceInr)}`),
    ],
    languages: s.languages.join(", "), owner: s.owner.whatsapp,
  } satisfies TemplateSummary;
}

/** About how many messages one order makes: the order, the asks of a silent supplier (the settings' follow-up hours) and the notes to the owner. A planning figure, not a limit. */
export function stockMessageCeiling(c: Ctx, s: Settings, _included: number | null): TemplateMessages {
  const w = stockWords(c.w).shop.messages;
  const perOrder = 1 + s.followUpHours.length + 3;
  return { heading: w.heading, lines: [w.line(perOrder)], note: w.note };
}
