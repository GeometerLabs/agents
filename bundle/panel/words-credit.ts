// The words of the credit book's phone form (24 Nov 2026; the Fees template's `creditBook` variant, decision 63): the shop and who owes what today (one person a line), the
// reminders' rules, what each rule means, and what is refused, in English, Hindi, Malayalam and Kannada. They live here, found by the panel's own language name (languages.ts
// `wordsLanguage`), so the shared words files change by nothing; Hindi, Malayalam and Kannada are machine-written and are on the review sheets (review.ts, ids "credit.*") until
// a native reader has signed them.
import type { Language } from "../../modules/language/languages.ts";
import { wordsLanguage } from "./languages.ts";
import type { Words } from "./words.ts";

export interface CreditWords {
  steps: { business: string; rules: string };
  business: { name: string; address: string; people: string; peopleHelp: string; numbersNote: string };
  rules: { every: string; everyHelp: string; hour: string; most: string; maxPerPerson: string; maxPerPersonHelp: string; partAllowed: string; partMin: string; refund: string; refundHelp: string; firstNote: string };
  /** The shop page: the book in one line. */
  summary: (people: number, owedInr: string) => string;
  problems: {
    tooMany: (n: number) => string;
    lineBad: (row: number) => string;
    number: (row: number) => string;
    amount: (row: number) => string;
    twice: (row: number) => string;
    everyBad: string; hourBad: string; mostBad: string; maxBad: string; partBad: string; refundBad: string;
  };
}

export const CREDIT_WORDS: Record<Language, CreditWords> = {
  en: {
    steps: { business: "The shop and who owes what", rules: "Reminders and limits" },
    business: {
      name: "Shop name", address: "Address (optional)", people: "Who owes what today",
      peopleHelp: "One person on each line: their name, their WhatsApp number, what they owe in rupees. Example: Ramesh, 98450 12345, 2400. Leave it empty to start with nobody; the owner adds people later on WhatsApp (\"Ramesh owes 2400\").",
      numbersNote: "The numbers stay on the shop's server. Nothing is sent to anyone now: each person gets a first message only when the owner taps Ask, and reminders only after they say yes.",
    },
    rules: {
      every: "A reminder at most every (days)", everyHelp: "Reminders go only to people who said yes, at the hour below, while something is owed.",
      hour: "Reminder hour (6 to 21)", most: "Most reminders to one person in a month",
      maxPerPerson: "Most one account may show (₹)", maxPerPersonHelp: "A payment link is never for more. It does not stop the owner writing credit; it stops a mistyped amount.",
      partAllowed: "Customers may pay part", partMin: "Least part payment (₹)",
      refund: "Refund the agent may ask for on its own (₹)", refundHelp: "Above this, the owner approves each refund.",
      firstNote: "Cash paid at the counter is the owner's mark (\"Ramesh paid 1000\"), never a confirmed payment. A UPI payment counts only when the owner marks it received.",
    },
    summary: (p, owed) => `${p} people in the book · ${owed} owed at setup`,
    problems: {
      tooMany: (n) => `At most ${n} people here. A bigger book is set up by a builder.`,
      lineBad: (r) => `Line ${r}: write the name, the WhatsApp number and the amount, with commas between.`,
      number: (r) => `Line ${r}: the WhatsApp number does not look right. Write ten digits, or + and the country code.`,
      amount: (r) => `Line ${r}: what they owe must be whole rupees above 0, at most the most one account may show.`,
      twice: (r) => `Line ${r}: this name or number is already on an earlier line. Give each person a name the owner can tell apart.`,
      everyBad: "How often a reminder may go must be from 1 to 60 days.", hourBad: "The reminder hour must be from 6 to 21.", mostBad: "The most reminders in a month must be from 1 to 12.",
      maxBad: "The most one account may show must be whole rupees from 1 to 10,00,000.", partBad: "The least part payment must be whole rupees above 0.", refundBad: "The refund limit must be whole rupees.",
    },
  },
  hi: {
    steps: { business: "दुकान और किस पर कितना बाकी", rules: "याद और सीमाएँ" },
    business: {
      name: "दुकान का नाम", address: "पता (ज़रूरी नहीं)", people: "आज किस पर कितना बाकी है",
      peopleHelp: "हर लाइन पर एक व्यक्ति: नाम, WhatsApp नंबर, बाकी रकम रुपये में। उदाहरण: Ramesh, 98450 12345, 2400। खाली छोड़ें तो किसी के बिना शुरू होगा; मालिक बाद में WhatsApp पर जोड़ते हैं (\"Ramesh owes 2400\")।",
      numbersNote: "नंबर दुकान के सर्वर पर ही रहते हैं। अभी किसी को कुछ नहीं भेजा जाता: हर व्यक्ति को पहला संदेश तभी जाता है जब मालिक पूछें दबाएँ, और याद उनके हाँ कहने के बाद ही।",
    },
    rules: {
      every: "याद ज़्यादा से ज़्यादा हर (दिन)", everyHelp: "याद सिर्फ़ उन्हें जाती है जिन्होंने हाँ कहा, नीचे दिए घंटे पर, जब तक कुछ बाकी है।",
      hour: "याद का घंटा (6 से 21)", most: "एक व्यक्ति को एक महीने में ज़्यादा से ज़्यादा याद",
      maxPerPerson: "एक खाते में ज़्यादा से ज़्यादा (₹)", maxPerPersonHelp: "भुगतान लिंक कभी इससे ज़्यादा का नहीं होता। यह उधार लिखने से नहीं रोकता; गलत टाइप हुई रकम रोकता है।",
      partAllowed: "ग्राहक कुछ हिस्सा भर सकते हैं", partMin: "सबसे कम हिस्सा (₹)",
      refund: "एजेंट ख़ुद जितना रिफंड माँग सकता है (₹)", refundHelp: "इससे ऊपर हर रिफंड मालिक मंज़ूर करते हैं।",
      firstNote: "काउंटर पर दिया नकद मालिक का निशान है (\"Ramesh paid 1000\"), पक्का भुगतान नहीं। UPI भुगतान तभी गिना जाता है जब मालिक उसे मिला हुआ दर्ज करें।",
    },
    summary: (p, owed) => `खाते में ${p} लोग · सेटअप पर ${owed} बाकी`,
    problems: {
      tooMany: (n) => `यहाँ ज़्यादा से ज़्यादा ${n} लोग। बड़ा खाता कोई बिल्डर सेट करता है।`,
      lineBad: (r) => `लाइन ${r}: नाम, WhatsApp नंबर और रकम, बीच में कॉमा लगाकर लिखें।`,
      number: (r) => `लाइन ${r}: WhatsApp नंबर सही नहीं लगता। दस अंक लिखें, या + और देश का कोड।`,
      amount: (r) => `लाइन ${r}: बाकी रकम 0 से ऊपर पूरे रुपये में हो, एक खाते की सीमा तक।`,
      twice: (r) => `लाइन ${r}: यह नाम या नंबर पहले की लाइन में है। हर व्यक्ति को ऐसा नाम दें जिसे मालिक अलग पहचान सकें।`,
      everyBad: "याद कितनी बार जाए, यह 1 से 60 दिन हो।", hourBad: "याद का घंटा 6 से 21 के बीच हो।", mostBad: "महीने में ज़्यादा से ज़्यादा याद 1 से 12 हो।",
      maxBad: "एक खाते की सीमा 1 से 10,00,000 पूरे रुपये हो।", partBad: "सबसे कम हिस्सा 0 से ऊपर पूरे रुपये हो।", refundBad: "रिफंड सीमा पूरे रुपये में हो।",
    },
  },
  ml: {
    steps: { business: "കടയും ആര് എത്ര തരാനുണ്ട് എന്നതും", rules: "ഓർമ്മപ്പെടുത്തലുകളും പരിധികളും" },
    business: {
      name: "കടയുടെ പേര്", address: "വിലാസം (നിർബന്ധമില്ല)", people: "ഇന്ന് ആര് എത്ര തരാനുണ്ട്",
      peopleHelp: "ഓരോ വരിയിലും ഒരാൾ: പേര്, WhatsApp നമ്പർ, തരാനുള്ള തുക രൂപയിൽ. ഉദാഹരണം: Ramesh, 98450 12345, 2400. ആരുമില്ലാതെ തുടങ്ങാൻ ഒഴിച്ചിടുക; ഉടമ പിന്നീട് WhatsApp-ൽ ചേർക്കും (\"Ramesh owes 2400\").",
      numbersNote: "നമ്പറുകൾ കടയുടെ സെർവറിൽ മാത്രം നിൽക്കും. ഇപ്പോൾ ആർക്കും ഒന്നും അയയ്ക്കില്ല: ഉടമ ചോദിക്കൂ അമർത്തുമ്പോൾ മാത്രം ഓരോരുത്തർക്കും ആദ്യ സന്ദേശം, അവർ സമ്മതിച്ചതിനു ശേഷം മാത്രം ഓർമ്മപ്പെടുത്തലുകൾ.",
    },
    rules: {
      every: "ഓർമ്മപ്പെടുത്തൽ പരമാവധി ഓരോ (ദിവസം)", everyHelp: "സമ്മതിച്ചവർക്ക് മാത്രം, താഴെയുള്ള മണിക്കൂറിൽ, എന്തെങ്കിലും ബാക്കിയുള്ളപ്പോൾ ഓർമ്മപ്പെടുത്തലുകൾ പോകും.",
      hour: "ഓർമ്മപ്പെടുത്തലിന്റെ മണിക്കൂർ (6 മുതൽ 21)", most: "ഒരാൾക്ക് ഒരു മാസത്തിൽ പരമാവധി ഓർമ്മപ്പെടുത്തലുകൾ",
      maxPerPerson: "ഒരു അക്കൗണ്ടിൽ പരമാവധി (₹)", maxPerPersonHelp: "പേയ്മെന്റ് ലിങ്ക് ഒരിക്കലും ഇതിൽ കൂടില്ല. ഇത് കടം എഴുതുന്നത് തടയില്ല; തെറ്റായി ടൈപ്പ് ചെയ്ത തുക തടയും.",
      partAllowed: "ഉപഭോക്താക്കൾക്ക് ഭാഗം അടയ്ക്കാം", partMin: "ഏറ്റവും കുറഞ്ഞ ഭാഗം (₹)",
      refund: "ഏജന്റിന് സ്വയം ചോദിക്കാവുന്ന റീഫണ്ട് (₹)", refundHelp: "ഇതിനു മുകളിൽ ഓരോ റീഫണ്ടും ഉടമ അംഗീകരിക്കണം.",
      firstNote: "കൗണ്ടറിൽ നൽകിയ പണം ഉടമയുടെ അടയാളമാണ് (\"Ramesh paid 1000\"), ഉറപ്പായ പേയ്മെന്റ് അല്ല. ഉടമ കിട്ടി എന്ന് രേഖപ്പെടുത്തുമ്പോൾ മാത്രം UPI പേയ്മെന്റ് കണക്കാക്കും.",
    },
    summary: (p, owed) => `കണക്കിൽ ${p} പേർ · സജ്ജീകരണ സമയത്ത് ${owed} ബാക്കി`,
    problems: {
      tooMany: (n) => `ഇവിടെ പരമാവധി ${n} പേർ. വലിയ കണക്ക് ഒരു ബിൽഡർ സജ്ജമാക്കും.`,
      lineBad: (r) => `വരി ${r}: പേര്, WhatsApp നമ്പർ, തുക എന്നിവ കോമ ഇട്ട് എഴുതുക.`,
      number: (r) => `വരി ${r}: WhatsApp നമ്പർ ശരിയല്ലെന്ന് തോന്നുന്നു. പത്ത് അക്കങ്ങൾ, അല്ലെങ്കിൽ + ഉം രാജ്യ കോഡും എഴുതുക.`,
      amount: (r) => `വരി ${r}: തരാനുള്ള തുക 0-ന് മുകളിൽ പൂർണ്ണ രൂപയിൽ, ഒരു അക്കൗണ്ടിന്റെ പരിധി വരെ ആയിരിക്കണം.`,
      twice: (r) => `വരി ${r}: ഈ പേരോ നമ്പറോ മുമ്പത്തെ വരിയിലുണ്ട്. ഉടമയ്ക്ക് തിരിച്ചറിയാവുന്ന പേര് നൽകുക.`,
      everyBad: "ഓർമ്മപ്പെടുത്തലിന്റെ ഇടവേള 1 മുതൽ 60 ദിവസം വരെ ആയിരിക്കണം.", hourBad: "ഓർമ്മപ്പെടുത്തലിന്റെ മണിക്കൂർ 6 മുതൽ 21 വരെ ആയിരിക്കണം.", mostBad: "മാസത്തിലെ പരമാവധി ഓർമ്മപ്പെടുത്തലുകൾ 1 മുതൽ 12 വരെ ആയിരിക്കണം.",
      maxBad: "ഒരു അക്കൗണ്ടിന്റെ പരിധി 1 മുതൽ 10,00,000 വരെ പൂർണ്ണ രൂപ ആയിരിക്കണം.", partBad: "ഏറ്റവും കുറഞ്ഞ ഭാഗം 0-ന് മുകളിൽ പൂർണ്ണ രൂപ ആയിരിക്കണം.", refundBad: "റീഫണ്ട് പരിധി പൂർണ്ണ രൂപയിൽ ആയിരിക്കണം.",
    },
  },
  kn: {
    steps: { business: "ಅಂಗಡಿ ಮತ್ತು ಯಾರು ಎಷ್ಟು ಕೊಡಬೇಕು", rules: "ನೆನಪುಗಳು ಮತ್ತು ಮಿತಿಗಳು" },
    business: {
      name: "ಅಂಗಡಿಯ ಹೆಸರು", address: "ವಿಳಾಸ (ಐಚ್ಛಿಕ)", people: "ಇಂದು ಯಾರು ಎಷ್ಟು ಕೊಡಬೇಕು",
      peopleHelp: "ಪ್ರತಿ ಸಾಲಿನಲ್ಲಿ ಒಬ್ಬರು: ಹೆಸರು, WhatsApp ಸಂಖ್ಯೆ, ಕೊಡಬೇಕಾದ ಮೊತ್ತ ರೂಪಾಯಿಯಲ್ಲಿ. ಉದಾಹರಣೆ: Ramesh, 98450 12345, 2400. ಯಾರೂ ಇಲ್ಲದೆ ಶುರು ಮಾಡಲು ಖಾಲಿ ಬಿಡಿ; ಮಾಲೀಕರು ನಂತರ WhatsApp-ನಲ್ಲಿ ಸೇರಿಸುತ್ತಾರೆ (\"Ramesh owes 2400\").",
      numbersNote: "ಸಂಖ್ಯೆಗಳು ಅಂಗಡಿಯ ಸರ್ವರ್‌ನಲ್ಲೇ ಇರುತ್ತವೆ. ಈಗ ಯಾರಿಗೂ ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ: ಮಾಲೀಕರು ಕೇಳಿ ಒತ್ತಿದಾಗ ಮಾತ್ರ ಪ್ರತಿಯೊಬ್ಬರಿಗೆ ಮೊದಲ ಸಂದೇಶ, ಅವರು ಒಪ್ಪಿದ ನಂತರವೇ ನೆನಪುಗಳು.",
    },
    rules: {
      every: "ನೆನಪು ಹೆಚ್ಚೆಂದರೆ ಪ್ರತಿ (ದಿನ)", everyHelp: "ಒಪ್ಪಿದವರಿಗೆ ಮಾತ್ರ, ಕೆಳಗಿನ ಗಂಟೆಗೆ, ಏನಾದರೂ ಬಾಕಿ ಇರುವವರೆಗೆ ನೆನಪುಗಳು ಹೋಗುತ್ತವೆ.",
      hour: "ನೆನಪಿನ ಗಂಟೆ (6 ರಿಂದ 21)", most: "ಒಬ್ಬರಿಗೆ ಒಂದು ತಿಂಗಳಲ್ಲಿ ಹೆಚ್ಚೆಂದರೆ ನೆನಪುಗಳು",
      maxPerPerson: "ಒಂದು ಖಾತೆಯಲ್ಲಿ ಹೆಚ್ಚೆಂದರೆ (₹)", maxPerPersonHelp: "ಪಾವತಿ ಲಿಂಕ್ ಎಂದಿಗೂ ಇದಕ್ಕಿಂತ ಹೆಚ್ಚಿರುವುದಿಲ್ಲ. ಇದು ಸಾಲ ಬರೆಯುವುದನ್ನು ತಡೆಯುವುದಿಲ್ಲ; ತಪ್ಪಾಗಿ ಟೈಪ್ ಮಾಡಿದ ಮೊತ್ತವನ್ನು ತಡೆಯುತ್ತದೆ.",
      partAllowed: "ಗ್ರಾಹಕರು ಭಾಗ ಪಾವತಿಸಬಹುದು", partMin: "ಕನಿಷ್ಠ ಭಾಗ (₹)",
      refund: "ಏಜೆಂಟ್ ತಾನೇ ಕೇಳಬಹುದಾದ ರೀಫಂಡ್ (₹)", refundHelp: "ಇದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಪ್ರತಿ ರೀಫಂಡ್‌ಗೆ ಮಾಲೀಕರ ಒಪ್ಪಿಗೆ ಬೇಕು.",
      firstNote: "ಕೌಂಟರ್‌ನಲ್ಲಿ ಕೊಟ್ಟ ನಗದು ಮಾಲೀಕರ ಗುರುತು (\"Ramesh paid 1000\"), ಖಚಿತ ಪಾವತಿ ಅಲ್ಲ. ಮಾಲೀಕರು ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿದಾಗ ಮಾತ್ರ UPI ಪಾವತಿ ಎಣಿಕೆಯಾಗುತ್ತದೆ.",
    },
    summary: (p, owed) => `ಲೆಕ್ಕದಲ್ಲಿ ${p} ಜನ · ಹೊಂದಿಸುವಾಗ ${owed} ಬಾಕಿ`,
    problems: {
      tooMany: (n) => `ಇಲ್ಲಿ ಹೆಚ್ಚೆಂದರೆ ${n} ಜನ. ದೊಡ್ಡ ಲೆಕ್ಕವನ್ನು ಬಿಲ್ಡರ್ ಹೊಂದಿಸುತ್ತಾರೆ.`,
      lineBad: (r) => `ಸಾಲು ${r}: ಹೆಸರು, WhatsApp ಸಂಖ್ಯೆ ಮತ್ತು ಮೊತ್ತವನ್ನು ಅಲ್ಪವಿರಾಮದಿಂದ ಬೇರ್ಪಡಿಸಿ ಬರೆಯಿರಿ.`,
      number: (r) => `ಸಾಲು ${r}: WhatsApp ಸಂಖ್ಯೆ ಸರಿಯಾಗಿ ಕಾಣುತ್ತಿಲ್ಲ. ಹತ್ತು ಅಂಕೆಗಳು, ಅಥವಾ + ಮತ್ತು ದೇಶದ ಕೋಡ್ ಬರೆಯಿರಿ.`,
      amount: (r) => `ಸಾಲು ${r}: ಕೊಡಬೇಕಾದ ಮೊತ್ತ 0 ಕ್ಕಿಂತ ಹೆಚ್ಚು ಪೂರ್ಣ ರೂಪಾಯಿಯಲ್ಲಿ, ಒಂದು ಖಾತೆಯ ಮಿತಿಯವರೆಗೆ ಇರಬೇಕು.`,
      twice: (r) => `ಸಾಲು ${r}: ಈ ಹೆಸರು ಅಥವಾ ಸಂಖ್ಯೆ ಹಿಂದಿನ ಸಾಲಿನಲ್ಲಿದೆ. ಮಾಲೀಕರು ಗುರುತಿಸಬಹುದಾದ ಹೆಸರು ನೀಡಿ.`,
      everyBad: "ನೆನಪಿನ ಅಂತರ 1 ರಿಂದ 60 ದಿನ ಇರಬೇಕು.", hourBad: "ನೆನಪಿನ ಗಂಟೆ 6 ರಿಂದ 21 ಇರಬೇಕು.", mostBad: "ತಿಂಗಳ ಹೆಚ್ಚೆಂದರೆ ನೆನಪುಗಳು 1 ರಿಂದ 12 ಇರಬೇಕು.",
      maxBad: "ಒಂದು ಖಾತೆಯ ಮಿತಿ 1 ರಿಂದ 10,00,000 ಪೂರ್ಣ ರೂಪಾಯಿ ಇರಬೇಕು.", partBad: "ಕನಿಷ್ಠ ಭಾಗ 0 ಕ್ಕಿಂತ ಹೆಚ್ಚು ಪೂರ್ಣ ರೂಪಾಯಿ ಇರಬೇಕು.", refundBad: "ರೀಫಂಡ್ ಮಿತಿ ಪೂರ್ಣ ರೂಪಾಯಿಯಲ್ಲಿ ಇರಬೇಕು.",
    },
  },
};

/** The credit book's words for the panel's words of one language. */
export const creditWords = (w: Words): CreditWords => CREDIT_WORDS[wordsLanguage(w)];
