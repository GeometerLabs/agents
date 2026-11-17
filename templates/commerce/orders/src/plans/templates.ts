// The words of monthly plans (17 Nov 2026), in the four languages, written like every other message of this agent: each one a template filled only from the record, never
// typed by hand and never translated by a model, and every amount, day, count and name in it checked against the facts before it is sent. They are kept in this folder and
// handed the few helpers of language/templates.ts (so this file imports nothing from it at run time, and the two cannot wait for each other when loaded).
// The Hindi, Malayalam and Kannada are machine-written; a native speaker must read them before a real shop sees them (the REVIEW sheets list every line).
// Three go out unasked, often in a closed 24-hour window, and are WhatsApp templates too (language/meta-templates.ts): the renewal, the pause and the skip. Those bodies start
// and end with fixed words, because Meta rejects a body that starts or ends with a value.
import type { Language } from "../../../../../modules/language/languages.ts";
import type { MessageFacts } from "../language/templates.ts";

export type PlanTemplateId =
  // to the customer, answering what they wrote
  | "plan_choose" | "plan_quote" | "plan_active" | "plan_full" | "plan_none" | "plan_pause_done" | "plan_skip_done" | "plan_resume_done" | "plan_cutoff_refused" | "plan_no_meal" | "plan_cancelled"
  // to the customer, unasked: the renewal and its end, the hold that ran out, and the credit going back
  | "plan_renewal" | "plan_lapsed" | "plan_hold_expired" | "plan_credit_refund" | "plan_credit_refund_pending"
  // to the owner
  | "owner_plan_started" | "owner_plan_cancelled";

/** The record's values a plan message may use beyond the order's own: how many meals, how many days were not taken, and the period's first and last day (as moments). */
export interface PlanFacts { meals?: number; creditDays?: number; fromMs?: number; toMs?: number }

type Template = (f: MessageFacts) => string;
export type PlanSet = Record<PlanTemplateId, Template>;

/** What language/templates.ts hands in: its own helpers, so the words here are filled exactly as the others are. */
export interface PlanHelpers {
  need: <K extends keyof MessageFacts>(f: MessageFacts, key: K) => NonNullable<MessageFacts[K]>;
  inr: (f: MessageFacts, key: "totalInr" | "advanceInr" | "refundInr") => string;
  /** The day of the message ("Mon 16 Nov"): the facts' `dateMs`. */
  day: (f: MessageFacts) => string;
  /** A moment as a day ("Mon 16 Nov"). */
  dayAt: (f: MessageFacts, ms: number) => string;
  /** The moment a day closes, "Sun 15 Nov, 8:00 pm". */
  cutAt: (f: MessageFacts) => string;
  how: (f: MessageFacts) => string;
  /** Where to pay: the link, with the UPI ID and name after it on a UPI shop. */
  payTo: (f: MessageFacts) => string;
}

export function planTemplates(h: PlanHelpers): Record<Language, PlanSet> {
  const { need, inr, day, dayAt, cutAt, how, payTo } = h;
  const items = (f: MessageFacts) => need(f, "itemsText");
  /** A plan fact, or a refusal to write the message at all (the same rule `need` has for the order's facts). */
  const plan = <K extends keyof PlanFacts>(f: MessageFacts, key: K): NonNullable<PlanFacts[K]> => {
    const v = need(f, "plan")[key];
    if (v === undefined) throw new Error(`The message needs "plan.${key}" from the record, and the record does not have it.`);
    return v as NonNullable<PlanFacts[K]>;
  };
  const meals = (f: MessageFacts) => plan(f, "meals");
  const from = (f: MessageFacts) => dayAt(f, plan(f, "fromMs"));
  const to = (f: MessageFacts) => dayAt(f, plan(f, "toMs"));
  const credit = (f: MessageFacts) => plan(f, "creditDays");
  const ref = (f: MessageFacts) => need(f, "orderRef");
  const phone = (f: MessageFacts) => need(f, "customerPhone");

  const en: PlanSet = {
    plan_choose: (f) => `Which plan would you like? ${items(f)}. Please write its name.`,
    plan_quote: (f) => `Your ${items(f)} plan: ${meals(f)} meals from ${from(f)} to ${to(f)}, ${inr(f, "advanceInr")} for the month. Pay here: ${payTo(f)}. Your plan starts when the payment is recorded.`,
    plan_active: (f) => `Your ${items(f)} plan is on: ${meals(f)} meals from ${from(f)} to ${to(f)}. You can skip a day or pause until its cut-off (for ${from(f)}: ${cutAt(f)}), and write "cancel plan" to stop.`,
    plan_full: (f) => `Sorry, the ${items(f)} slot is full for the days you asked, so I could not start your plan. Please talk to the owner.`,
    plan_none: () => "You have no plan with us yet. Write \"monthly plan\" to start one.",
    plan_pause_done: (f) => `Your ${items(f)} plan is paused from ${day(f)}. No meals are sent from then, and the paused days are counted as credit at the end of the month. Write "resume" with a day to start again.`,
    plan_skip_done: (f) => `Skipped: no ${items(f)} meal on ${day(f)}. It is counted as credit at the end of the month.`,
    plan_resume_done: (f) => `Your ${items(f)} plan starts again from ${day(f)}.`,
    plan_cutoff_refused: (f) => `Sorry, it is too late for ${day(f)}: that day closed at ${cutAt(f)}. Nothing was changed.`,
    plan_no_meal: (f) => `There is no meal of your ${items(f)} plan on ${day(f)}, or it is already skipped or paused. Nothing was changed.`,
    plan_cancelled: (f) => `Your ${items(f)} plan is cancelled. No meal is sent or charged for the days after the ones already closed.${f.refundInr !== undefined ? ` ${inr(f, "refundInr")} for ${credit(f)} meals not sent is being refunded.` : ""}`,
    plan_renewal: (f) => `Your ${items(f)} plan renews from ${day(f)}. Amount ${inr(f, "advanceInr")} (plan price ${inr(f, "totalInr")}). Please pay by ${cutAt(f)}: ${need(f, "link")}. Thank you.`,
    plan_lapsed: (f) => `Your ${items(f)} plan was not renewed in time, so it has stopped. Write "monthly plan" to start again.`,
    plan_hold_expired: (f) => `The hold on your ${items(f)} plan has ended because the payment was not received in time. Write "monthly plan" to start again.`,
    plan_credit_refund: (f) => `${inr(f, "refundInr")} for ${credit(f)} meals of your ${items(f)} plan that were not sent is being refunded.`,
    plan_credit_refund_pending: (f) => `The owner will confirm your ${inr(f, "refundInr")} refund for ${credit(f)} meals of your ${items(f)} plan shortly.`,
    owner_plan_started: (f) => `New monthly plan ${ref(f)}: ${phone(f)}, ${items(f)}, ${meals(f)} meals from ${from(f)} to ${to(f)}, ${how(f)}.`,
    owner_plan_cancelled: (f) => `Plan ${ref(f)} (${items(f)}, ${phone(f)}) is cancelled. Do not make meals for the days after the cancellation.`,
  };

  const hi: PlanSet = {
    plan_choose: (f) => `आप कौन सा प्लान लेना चाहेंगे? ${items(f)}। कृपया उसका नाम लिखिए।`,
    plan_quote: (f) => `आपका ${items(f)} प्लान: ${from(f)} से ${to(f)} तक ${meals(f)} भोजन, महीने के ${inr(f, "advanceInr")}। यहाँ भुगतान करें: ${payTo(f)}। भुगतान दर्ज होते ही आपका प्लान शुरू हो जाएगा।`,
    plan_active: (f) => `आपका ${items(f)} प्लान चालू है: ${from(f)} से ${to(f)} तक ${meals(f)} भोजन। आप किसी दिन की अंतिम समय-सीमा तक उसे छोड़ सकते हैं या रोक सकते हैं (${from(f)} के लिए: ${cutAt(f)}), और बंद करने के लिए "cancel plan" लिखें।`,
    plan_full: (f) => `माफ़ कीजिए, आपके बताए दिनों के लिए ${items(f)} का स्लॉट भरा हुआ है, इसलिए प्लान शुरू नहीं हो सका। कृपया मालिक से बात करें।`,
    plan_none: () => "आपका हमारे साथ अभी कोई प्लान नहीं है। शुरू करने के लिए \"monthly plan\" लिखें।",
    plan_pause_done: (f) => `आपका ${items(f)} प्लान ${day(f)} से रोक दिया गया है। तब से कोई भोजन नहीं भेजा जाएगा, और रुके हुए दिन महीने के अंत में क्रेडिट गिने जाएंगे। फिर शुरू करने के लिए दिन के साथ "resume" लिखें।`,
    plan_skip_done: (f) => `छोड़ दिया गया: ${day(f)} को ${items(f)} भोजन नहीं भेजा जाएगा। यह महीने के अंत में क्रेडिट गिना जाएगा।`,
    plan_resume_done: (f) => `आपका ${items(f)} प्लान ${day(f)} से फिर शुरू हो रहा है।`,
    plan_cutoff_refused: (f) => `माफ़ कीजिए, ${day(f)} के लिए अब देर हो चुकी है: वह दिन ${cutAt(f)} पर बंद हो गया। कुछ भी बदला नहीं गया।`,
    plan_no_meal: (f) => `${day(f)} को आपके ${items(f)} प्लान का कोई भोजन नहीं है, या वह पहले ही छोड़ा या रोका जा चुका है। कुछ भी बदला नहीं गया।`,
    plan_cancelled: (f) => `आपका ${items(f)} प्लान रद्द हो गया है। पहले से बंद हो चुके दिनों के बाद कोई भोजन नहीं भेजा जाएगा और न ही पैसे लिए जाएंगे।${f.refundInr !== undefined ? ` न भेजे गए ${credit(f)} भोजन के ${inr(f, "refundInr")} आपको वापस किए जा रहे हैं।` : ""}`,
    plan_renewal: (f) => `आपका ${items(f)} प्लान ${day(f)} से नवीनीकृत हो रहा है। राशि ${inr(f, "advanceInr")} (प्लान की कीमत ${inr(f, "totalInr")})। कृपया ${cutAt(f)} तक भुगतान करें: ${need(f, "link")}। धन्यवाद।`,
    plan_lapsed: (f) => `आपका ${items(f)} प्लान समय पर नवीनीकृत नहीं हुआ, इसलिए बंद हो गया है। फिर शुरू करने के लिए "monthly plan" लिखें।`,
    plan_hold_expired: (f) => `आपके ${items(f)} प्लान की रोक खत्म हो गई क्योंकि भुगतान समय पर नहीं मिला। फिर शुरू करने के लिए "monthly plan" लिखें।`,
    plan_credit_refund: (f) => `आपके ${items(f)} प्लान के न भेजे गए ${credit(f)} भोजन के ${inr(f, "refundInr")} आपको वापस किए जा रहे हैं।`,
    plan_credit_refund_pending: (f) => `आपके ${items(f)} प्लान के ${credit(f)} भोजन के ${inr(f, "refundInr")} की वापसी की पुष्टि मालिक जल्द करेंगे।`,
    owner_plan_started: (f) => `नया मासिक प्लान ${ref(f)}: ${phone(f)}, ${items(f)}, ${from(f)} से ${to(f)} तक ${meals(f)} भोजन, ${how(f)}।`,
    owner_plan_cancelled: (f) => `प्लान ${ref(f)} (${items(f)}, ${phone(f)}) रद्द हो गया है। रद्द करने के बाद के दिनों के लिए भोजन न बनाएं।`,
  };

  const ml: PlanSet = {
    plan_choose: (f) => `ഏത് പ്ലാൻ വേണം? ${items(f)}. ദയവായി അതിന്റെ പേര് എഴുതൂ.`,
    plan_quote: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാൻ: ${from(f)} മുതൽ ${to(f)} വരെ ${meals(f)} ഭക്ഷണം, മാസത്തിന് ${inr(f, "advanceInr")}. ഇവിടെ പണമടയ്ക്കൂ: ${payTo(f)}. പണമടച്ചത് രേഖപ്പെടുത്തിയാൽ പ്ലാൻ തുടങ്ങും.`,
    plan_active: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാൻ തുടങ്ങി: ${from(f)} മുതൽ ${to(f)} വരെ ${meals(f)} ഭക്ഷണം. ഒരു ദിവസത്തിന്റെ അവസാന സമയം വരെ അത് ഒഴിവാക്കാം അല്ലെങ്കിൽ നിർത്തിവയ്ക്കാം (${from(f)}-ന്: ${cutAt(f)}), നിർത്താൻ "cancel plan" എന്ന് എഴുതൂ.`,
    plan_full: (f) => `ക്ഷമിക്കണം, നിങ്ങൾ പറഞ്ഞ ദിവസങ്ങളിൽ ${items(f)} സ്ലോട്ട് നിറഞ്ഞു, അതിനാൽ പ്ലാൻ തുടങ്ങാൻ കഴിഞ്ഞില്ല. ദയവായി ഉടമയോട് സംസാരിക്കൂ.`,
    plan_none: () => "നിങ്ങൾക്ക് ഇതുവരെ ഞങ്ങളുടെ കൂടെ പ്ലാൻ ഇല്ല. തുടങ്ങാൻ \"monthly plan\" എന്ന് എഴുതൂ.",
    plan_pause_done: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാൻ ${day(f)} മുതൽ നിർത്തിവച്ചു. അന്നുമുതൽ ഭക്ഷണം അയയ്ക്കില്ല, നിർത്തിയ ദിവസങ്ങൾ മാസാവസാനം ക്രെഡിറ്റായി കണക്കാക്കും. വീണ്ടും തുടങ്ങാൻ ഒരു ദിവസത്തോടൊപ്പം "resume" എഴുതൂ.`,
    plan_skip_done: (f) => `ഒഴിവാക്കി: ${day(f)}-ന് ${items(f)} ഭക്ഷണം അയയ്ക്കില്ല. അത് മാസാവസാനം ക്രെഡിറ്റായി കണക്കാക്കും.`,
    plan_resume_done: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാൻ ${day(f)} മുതൽ വീണ്ടും തുടങ്ങും.`,
    plan_cutoff_refused: (f) => `ക്ഷമിക്കണം, ${day(f)}-ന് ഇനി വൈകിപ്പോയി: ആ ദിവസം ${cutAt(f)}-ന് അടച്ചു. ഒന്നും മാറ്റിയിട്ടില്ല.`,
    plan_no_meal: (f) => `${day(f)}-ന് നിങ്ങളുടെ ${items(f)} പ്ലാനിൽ ഭക്ഷണമില്ല, അല്ലെങ്കിൽ അത് ഇതിനകം ഒഴിവാക്കുകയോ നിർത്തിവയ്ക്കുകയോ ചെയ്തു. ഒന്നും മാറ്റിയിട്ടില്ല.`,
    plan_cancelled: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാൻ റദ്ദാക്കി. ഇതിനകം അടച്ച ദിവസങ്ങൾക്ക് ശേഷം ഭക്ഷണം അയയ്ക്കുകയോ പണം ഈടാക്കുകയോ ചെയ്യില്ല.${f.refundInr !== undefined ? ` അയയ്ക്കാത്ത ${credit(f)} ഭക്ഷണത്തിന്റെ ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നു.` : ""}`,
    plan_renewal: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാൻ ${day(f)} മുതൽ പുതുക്കുന്നു. തുക ${inr(f, "advanceInr")} (പ്ലാൻ വില ${inr(f, "totalInr")}). ദയവായി ${cutAt(f)}-നകം പണമടയ്ക്കൂ: ${need(f, "link")}. നന്ദി.`,
    plan_lapsed: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാൻ സമയത്തിന് പുതുക്കിയില്ല, അതിനാൽ നിലച്ചു. വീണ്ടും തുടങ്ങാൻ "monthly plan" എന്ന് എഴുതൂ.`,
    plan_hold_expired: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാനിന്റെ കാത്തിരിപ്പ് അവസാനിച്ചു, കാരണം പണം സമയത്തിന് കിട്ടിയില്ല. വീണ്ടും തുടങ്ങാൻ "monthly plan" എന്ന് എഴുതൂ.`,
    plan_credit_refund: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാനിൽ അയയ്ക്കാത്ത ${credit(f)} ഭക്ഷണത്തിന്റെ ${inr(f, "refundInr")} തിരികെ നൽകുന്നു.`,
    plan_credit_refund_pending: (f) => `നിങ്ങളുടെ ${items(f)} പ്ലാനിലെ ${credit(f)} ഭക്ഷണത്തിന്റെ ${inr(f, "refundInr")} റീഫണ്ട് ഉടമ ഉടൻ സ്ഥിരീകരിക്കും.`,
    owner_plan_started: (f) => `പുതിയ മാസ പ്ലാൻ ${ref(f)}: ${phone(f)}, ${items(f)}, ${from(f)} മുതൽ ${to(f)} വരെ ${meals(f)} ഭക്ഷണം, ${how(f)}.`,
    owner_plan_cancelled: (f) => `പ്ലാൻ ${ref(f)} (${items(f)}, ${phone(f)}) റദ്ദാക്കി. റദ്ദാക്കിയതിന് ശേഷമുള്ള ദിവസങ്ങളിൽ ഭക്ഷണം ഉണ്ടാക്കരുത്.`,
  };

  const kn: PlanSet = {
    plan_choose: (f) => `ಯಾವ ಪ್ಲಾನ್ ಬೇಕು? ${items(f)}. ದಯವಿಟ್ಟು ಅದರ ಹೆಸರು ಬರೆಯಿರಿ.`,
    plan_quote: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್: ${from(f)} ರಿಂದ ${to(f)} ವರೆಗೆ ${meals(f)} ಊಟ, ತಿಂಗಳಿಗೆ ${inr(f, "advanceInr")}. ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)}. ಪಾವತಿ ದಾಖಲಾದ ಮೇಲೆ ಪ್ಲಾನ್ ಶುರುವಾಗುತ್ತದೆ.`,
    plan_active: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್ ಶುರುವಾಗಿದೆ: ${from(f)} ರಿಂದ ${to(f)} ವರೆಗೆ ${meals(f)} ಊಟ. ಒಂದು ದಿನದ ಕೊನೆಯ ಸಮಯದವರೆಗೆ ಅದನ್ನು ಬಿಡಬಹುದು ಅಥವಾ ನಿಲ್ಲಿಸಬಹುದು (${from(f)} ಗೆ: ${cutAt(f)}), ನಿಲ್ಲಿಸಲು "cancel plan" ಎಂದು ಬರೆಯಿರಿ.`,
    plan_full: (f) => `ಕ್ಷಮಿಸಿ, ನೀವು ಕೇಳಿದ ದಿನಗಳಿಗೆ ${items(f)} ಸ್ಲಾಟ್ ತುಂಬಿದೆ, ಆದ್ದರಿಂದ ಪ್ಲಾನ್ ಶುರು ಮಾಡಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.`,
    plan_none: () => "ನಿಮಗೆ ಇನ್ನೂ ನಮ್ಮಲ್ಲಿ ಪ್ಲಾನ್ ಇಲ್ಲ. ಶುರು ಮಾಡಲು \"monthly plan\" ಎಂದು ಬರೆಯಿರಿ.",
    plan_pause_done: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್ ಅನ್ನು ${day(f)} ರಿಂದ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಅಂದಿನಿಂದ ಊಟ ಕಳುಹಿಸುವುದಿಲ್ಲ, ನಿಲ್ಲಿಸಿದ ದಿನಗಳನ್ನು ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ಕ್ರೆಡಿಟ್ ಎಂದು ಎಣಿಸಲಾಗುತ್ತದೆ. ಮತ್ತೆ ಶುರು ಮಾಡಲು ಒಂದು ದಿನದ ಜೊತೆ "resume" ಎಂದು ಬರೆಯಿರಿ.`,
    plan_skip_done: (f) => `ಬಿಟ್ಟಿದೆ: ${day(f)} ರಂದು ${items(f)} ಊಟ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಅದನ್ನು ತಿಂಗಳ ಕೊನೆಯಲ್ಲಿ ಕ್ರೆಡಿಟ್ ಎಂದು ಎಣಿಸಲಾಗುತ್ತದೆ.`,
    plan_resume_done: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್ ${day(f)} ರಿಂದ ಮತ್ತೆ ಶುರುವಾಗುತ್ತದೆ.`,
    plan_cutoff_refused: (f) => `ಕ್ಷಮಿಸಿ, ${day(f)} ಗೆ ಈಗ ತಡವಾಗಿದೆ: ಆ ದಿನ ${cutAt(f)} ಕ್ಕೆ ಮುಚ್ಚಿದೆ. ಏನನ್ನೂ ಬದಲಾಯಿಸಿಲ್ಲ.`,
    plan_no_meal: (f) => `${day(f)} ರಂದು ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್‌ನಲ್ಲಿ ಊಟ ಇಲ್ಲ, ಅಥವಾ ಅದನ್ನು ಈಗಾಗಲೇ ಬಿಡಲಾಗಿದೆ ಅಥವಾ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಏನನ್ನೂ ಬದಲಾಯಿಸಿಲ್ಲ.`,
    plan_cancelled: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್ ರದ್ದಾಗಿದೆ. ಈಗಾಗಲೇ ಮುಚ್ಚಿದ ದಿನಗಳ ನಂತರ ಊಟ ಕಳುಹಿಸುವುದಿಲ್ಲ, ಹಣವನ್ನೂ ಪಡೆಯುವುದಿಲ್ಲ.${f.refundInr !== undefined ? ` ಕಳುಹಿಸದ ${credit(f)} ಊಟದ ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿಸಲಾಗುತ್ತಿದೆ.` : ""}`,
    plan_renewal: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್ ${day(f)} ರಿಂದ ನವೀಕರಣವಾಗುತ್ತಿದೆ. ಮೊತ್ತ ${inr(f, "advanceInr")} (ಪ್ಲಾನ್ ಬೆಲೆ ${inr(f, "totalInr")}). ದಯವಿಟ್ಟು ${cutAt(f)} ರೊಳಗೆ ಪಾವತಿಸಿ: ${need(f, "link")}. ಧನ್ಯವಾದ.`,
    plan_lapsed: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್ ಸಮಯಕ್ಕೆ ನವೀಕರಣವಾಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ನಿಂತಿದೆ. ಮತ್ತೆ ಶುರು ಮಾಡಲು "monthly plan" ಎಂದು ಬರೆಯಿರಿ.`,
    plan_hold_expired: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್‌ನ ಕಾಯ್ದಿರಿಸುವಿಕೆ ಮುಗಿದಿದೆ, ಏಕೆಂದರೆ ಪಾವತಿ ಸಮಯಕ್ಕೆ ಬರಲಿಲ್ಲ. ಮತ್ತೆ ಶುರು ಮಾಡಲು "monthly plan" ಎಂದು ಬರೆಯಿರಿ.`,
    plan_credit_refund: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್‌ನಲ್ಲಿ ಕಳುಹಿಸದ ${credit(f)} ಊಟದ ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿಸಲಾಗುತ್ತಿದೆ.`,
    plan_credit_refund_pending: (f) => `ನಿಮ್ಮ ${items(f)} ಪ್ಲಾನ್‌ನ ${credit(f)} ಊಟದ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಮಾಲೀಕರು ಶೀಘ್ರದಲ್ಲೇ ಖಚಿತಪಡಿಸುತ್ತಾರೆ.`,
    owner_plan_started: (f) => `ಹೊಸ ತಿಂಗಳ ಪ್ಲಾನ್ ${ref(f)}: ${phone(f)}, ${items(f)}, ${from(f)} ರಿಂದ ${to(f)} ವರೆಗೆ ${meals(f)} ಊಟ, ${how(f)}.`,
    owner_plan_cancelled: (f) => `ಪ್ಲಾನ್ ${ref(f)} (${items(f)}, ${phone(f)}) ರದ್ದಾಗಿದೆ. ರದ್ದತಿಯ ನಂತರದ ದಿನಗಳಿಗೆ ಊಟ ಮಾಡಬೇಡಿ.`,
  };

  return { en, hi, ml, kn };
}
