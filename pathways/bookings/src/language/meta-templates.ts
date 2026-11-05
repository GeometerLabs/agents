// The WhatsApp templates in the form Meta approves them: fixed wording, with numbered {{1}}, {{2}} ... for values that come from the record.
//
// Why these exist: outside the customer's 24-hour window WhatsApp only carries a pre-approved template. Meta will not approve a template
// that is only a variable, and a parameter cannot hold line breaks, so "the whole rendered text" cannot be one parameter. Each template
// below has the wording of ONE message (the one in language/templates.ts that its `usedFor` names), with the record's values as parameters.
// The wording is the same in both places, so what the customer receives is what the outgoing check read; a test and a runtime guard
// (templateMessage below) both insist on it. A message with no template here (or one made of several templates) still goes out as free text
// inside the window, and outside it is refused by the provider, which fails closed. Which messages still need a template: Deferred.md.
//
// Rules kept (Meta's template overview, https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview):
// lowercase names with underscores, one language per submission, an example value for every parameter. Also kept, from Meta's template
// review: a body neither starts nor ends with a parameter. Every body below starts and ends with fixed words.
//
// Hindi, Malayalam and Kannada wording is machine-written like the rest of those packs. A native speaker must read it before it is submitted.
//
// The mechanism is shared (modules/language/meta-templates.ts); this file holds Bookings' templates and the record values they use.
import type { Language } from "../../../../modules/language/languages.ts";
import { META_LANGUAGE, createMetaCatalogue, fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import type { MetaTemplate } from "../../../../modules/language/meta-templates.ts";
import { serviceName } from "../settings.ts";
import type { Settings } from "../settings.ts";
import { inr, need, slot } from "./templates.ts";
import type { MessageFacts, TemplateId } from "./templates.ts";

/** The record values a template can use, and where each comes from. */
export type Slot = "business" | "service" | "slot" | "deposit" | "refund" | "hours" | "phone" | "ref" | "code" | "approvalHours";
const VALUE: Record<Slot, (f: MessageFacts) => string> = {
  business: (f) => f.businessName,
  service: (f) => need(f, "serviceName"),
  slot: (f) => slot(f),
  deposit: (f) => inr(f, "depositInr"),
  refund: (f) => inr(f, "refundInr"),
  hours: (f) => String(need(f, "windowHours")),
  phone: (f) => need(f, "customerPhone"),
  ref: (f) => need(f, "bookingRef"),
  code: (f) => need(f, "approvalCode"),
  approvalHours: (f) => String(need(f, "approvalHours")),
};


export const META_TEMPLATES: readonly MetaTemplate<TemplateId>[] = [
  {
    name: "booking_reminder", usedFor: "reminder", audience: "customer",
    bodies: {
      en: "Reminder: your {service} at {business} is on {slot}.",
      hi: "याद दिलाना: {business} में आपका {service} {slot} पर है।",
      ml: "ഓർമ്മപ്പെടുത്തൽ: {business}-ൽ നിങ്ങളുടെ {service} ബുക്കിംഗ് സമയം: {slot}.",
      kn: "ನೆನಪಿಸುವುದು: {business}-ನಲ್ಲಿ ನಿಮ್ಮ {service} ಬುಕಿಂಗ್ ಸಮಯ: {slot}.",
    },
  },
  {
    name: "booking_confirmed", usedFor: "booked", audience: "customer",
    bodies: {
      en: "Booked! {service} on {slot}. Your {deposit} deposit is received. Cancel at least {hours} hours before the start for a refund.",
      hi: "बुक हो गया! {service}, {slot}। आपका {deposit} जमा हो गया है। रिफंड के लिए शुरू होने से कम से कम {hours} घंटे पहले रद्द करें।",
      ml: "ബുക്ക് ആയി! {service}, {slot}. നിങ്ങളുടെ {deposit} അഡ്വാൻസ് ലഭിച്ചു. പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് {hours} മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം.",
      kn: "ಬುಕ್ ಆಗಿದೆ! {service}, {slot}. ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ. ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ {hours} ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ.",
    },
  },
  {
    name: "booking_not_confirmed", usedFor: "couldnt_confirm", audience: "customer",
    bodies: {
      en: "We received your {deposit} deposit, but I couldn't confirm {slot} in our calendar yet, so it is not booked. I've told the owner, who will contact you.",
      hi: "आपका {deposit} जमा मिल गया है, लेकिन {slot} को हमारे कैलेंडर में अभी पक्का नहीं कर पाया, इसलिए बुकिंग पक्की नहीं है। मैंने मालिक को बता दिया है, वे आपसे संपर्क करेंगे।",
      ml: "നിങ്ങളുടെ {deposit} അഡ്വാൻസ് ലഭിച്ചു, പക്ഷേ {slot} ഞങ്ങളുടെ കലണ്ടറിൽ ഇതുവരെ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ബുക്കിംഗ് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്, അവർ നിങ്ങളെ ബന്ധപ്പെടും.",
      kn: "ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ, ಆದರೆ {slot} ಸಮಯವನ್ನು ನಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಇನ್ನೂ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬುಕಿಂಗ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ, ಅವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.",
    },
  },
  {
    name: "booking_rescheduled", usedFor: "rescheduled", audience: "customer",
    bodies: {
      en: "Done. Your {service} is moved to {slot}.",
      hi: "हो गया। आपका {service} अब {slot} पर है।",
      ml: "മാറ്റിയിട്ടുണ്ട്. {service} പുതിയ സമയം: {slot}.",
      kn: "ಆಯಿತು. {service} ಹೊಸ ಸಮಯ: {slot}.",
    },
  },
  {
    name: "deposit_refund_approved", usedFor: "refund_approved", audience: "customer",
    bodies: {
      en: "The owner approved your refund. {refund} is on its way.",
      hi: "मालिक ने आपके रिफंड को मंज़ूरी दे दी है। {refund} आपको वापस भेजा जा रहा है।",
      ml: "ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. {refund} തിരികെ വരുന്നുണ്ട്.",
      kn: "ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಒಪ್ಪಿದ್ದಾರೆ. {refund} ಮರಳಿ ಬರುತ್ತಿದೆ.",
    },
  },
  {
    name: "deposit_paid_twice", usedFor: "duplicate_refund", audience: "customer",
    bodies: {
      en: "You paid the deposit twice. The extra {refund} is being refunded.",
      hi: "आपने जमा राशि दो बार भर दी। अतिरिक्त {refund} वापस किया जा रहा है।",
      ml: "നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച {refund} തിരികെ നൽകുന്നുണ്ട്.",
      kn: "ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ {refund} ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.",
    },
  },
  {
    name: "owner_approval_request", usedFor: "owner_refund_needs_approval", audience: "owner",
    bodies: {
      en: 'Approval needed: refund {refund} for {phone} ({service}, {slot}). Reply "approve {code}" or "deny {code}" within {approvalHours} hours.',
      hi: 'मंज़ूरी चाहिए: {phone} ({service}, {slot}) को {refund} का रिफंड। {approvalHours} घंटे के अंदर "approve {code}" या "deny {code}" लिखकर जवाब दें।',
      ml: 'അനുമതി വേണം: {phone} ({service}, {slot}) എന്നവർക്ക് {refund} റീഫണ്ട്. {approvalHours} മണിക്കൂറിനുള്ളിൽ "approve {code}" അല്ലെങ്കിൽ "deny {code}" എന്ന് മറുപടി അയയ്ക്കൂ.',
      kn: 'ಅನುಮತಿ ಬೇಕು: {phone} ({service}, {slot}) ಅವರಿಗೆ {refund} ರೀಫಂಡ್. {approvalHours} ಗಂಟೆಯೊಳಗೆ "approve {code}" ಅಥವಾ "deny {code}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  // The other owner notices. The owner usually has not written to the number today, so each notice the agent sends on its own has a template here
  // (only the reply to the owner's own message does not). Two situations share one where a single sentence is true of both: owner_not_booked and
  // owner_payment_unused. Why not one generic owner template: Explanation.md, "Joining it up", 6.
  {
    name: "owner_late_cancellation", usedFor: "owner_late_cancellation", audience: "owner",
    bodies: {
      en: 'Customer {phone} cancelled {service} on {slot} less than {hours} hours before the start. Deposit {deposit}. Reply "approve {ref}" to refund it or "deny {ref}" to keep it.',
      hi: 'ग्राहक {phone} ने {service}, {slot} शुरू होने से {hours} घंटे से कम पहले रद्द किया। जमा {deposit}। लौटाने के लिए "approve {ref}", रखने के लिए "deny {ref}" लिखें।',
      ml: 'ഉപഭോക്താവ് {phone}: {service}, {slot} തുടങ്ങാൻ {hours} മണിക്കൂറിൽ താഴെ ബാക്കിയുള്ളപ്പോൾ റദ്ദാക്കി. അഡ്വാൻസ് {deposit}. തിരികെ നൽകാൻ "approve {ref}" എന്നും, നിങ്ങൾ വയ്ക്കാൻ "deny {ref}" എന്നും മറുപടി അയയ്ക്കൂ.',
      kn: 'ಗ್ರಾಹಕರು {phone}: {service}, {slot} ಪ್ರಾರಂಭಕ್ಕೆ {hours} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಇರುವಾಗ ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ. ಮುಂಗಡ {deposit}. ಹಿಂತಿರುಗಿಸಲು "approve {ref}" ಎಂದು, ಇಟ್ಟುಕೊಳ್ಳಲು "deny {ref}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  {
    name: "owner_cant_confirm", usedFor: "owner_cant_confirm", audience: "owner",
    bodies: {
      en: `Could not confirm {phone}'s {service} on {slot} in the calendar, so it is NOT booked. Their {deposit} deposit is recorded. Reply "retry {ref}" to check the calendar again, or "approve {ref}" to cancel it and refund the deposit.`,
      hi: 'ग्राहक {phone} का {service}, {slot} कैलेंडर में पक्का नहीं हो पाया, इसलिए बुकिंग पक्की नहीं है। उनका {deposit} जमा दर्ज है। कैलेंडर फिर जाँचने के लिए "retry {ref}" लिखें, या बुकिंग रद्द करके जमा लौटाने के लिए "approve {ref}"।',
      ml: 'ഉപഭോക്താവ് {phone}: {service}, {slot} കലണ്ടറിൽ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ബുക്കിംഗ് ആയിട്ടില്ല. അവരുടെ {deposit} അഡ്വാൻസ് രേഖപ്പെടുത്തിയിട്ടുണ്ട്. കലണ്ടർ വീണ്ടും നോക്കാൻ "retry {ref}" എന്നും, ബുക്കിംഗ് റദ്ദാക്കി അഡ്വാൻസ് തിരികെ നൽകാൻ "approve {ref}" എന്നും മറുപടി അയയ്ക്കൂ.',
      kn: 'ಗ್ರಾಹಕರು {phone}: {service}, {slot} ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬುಕಿಂಗ್ ಆಗಿಲ್ಲ. ಅವರ {deposit} ಮುಂಗಡ ಹಣ ದಾಖಲಾಗಿದೆ. ಕ್ಯಾಲೆಂಡರ್ ಮತ್ತೆ ನೋಡಲು "retry {ref}" ಎಂದು, ಬುಕಿಂಗ್ ರದ್ದು ಮಾಡಿ ಮುಂಗಡ ಹಣ ಹಿಂತಿರುಗಿಸಲು "approve {ref}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  {
    name: "owner_not_booked", usedFor: "owner_not_booked", audience: "owner",
    bodies: {
      en: "Could not set up {phone}'s {service} on {slot}: the calendar or the payment link did not work. Nothing is booked.",
      hi: "ग्राहक {phone} के {service}, {slot} के लिए बुकिंग तैयार नहीं हो पाई: कैलेंडर या पेमेंट लिंक ने काम नहीं किया। कुछ भी बुक नहीं हुआ।",
      ml: "ഉപഭോക്താവ് {phone}: {service}, {slot} — കലണ്ടറോ പേയ്മെന്റ് ലിങ്കോ പ്രവർത്തിച്ചില്ല, അതിനാൽ ബുക്കിംഗ് ഒരുക്കാൻ കഴിഞ്ഞില്ല. ഒന്നും ബുക്ക് ആയിട്ടില്ല.",
      kn: "ಗ್ರಾಹಕರು {phone}: {service}, {slot} — ಕ್ಯಾಲೆಂಡರ್ ಅಥವಾ ಪಾವತಿ ಲಿಂಕ್ ಕೆಲಸ ಮಾಡಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬುಕಿಂಗ್ ಸಿದ್ಧಪಡಿಸಲು ಆಗಲಿಲ್ಲ. ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ.",
    },
  },
  {
    name: "owner_move_failed", usedFor: "owner_reschedule_failed", audience: "owner",
    bodies: {
      en: "Could not confirm moving {phone}'s {service} to {slot} in the calendar. Please check their booking.",
      hi: "ग्राहक {phone} का {service} कैलेंडर में {slot} पर ले जाना पक्का नहीं हो पाया। कृपया उनकी बुकिंग जाँच लें।",
      ml: "ഉപഭോക്താവ് {phone}: {service} — പുതിയ സമയം {slot} കലണ്ടറിൽ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി അവരുടെ ബുക്കിംഗ് പരിശോധിക്കൂ.",
      kn: "ಗ್ರಾಹಕರು {phone}: {service} — ಹೊಸ ಸಮಯ {slot} ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರ ಬುಕಿಂಗ್ ಪರಿಶೀಲಿಸಿ.",
    },
  },
  {
    name: "owner_paid_twice", usedFor: "owner_duplicate_payment", audience: "owner",
    bodies: {
      en: "Customer {phone} paid the deposit twice for {service} on {slot}. The extra {refund} was refunded.",
      hi: "ग्राहक {phone} ने {service}, {slot} के लिए जमा दो बार भरा। अतिरिक्त {refund} वापस कर दिया गया।",
      ml: "ഉപഭോക്താവ് {phone}: {service}, {slot} — അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി വന്ന {refund} തിരികെ നൽകി.",
      kn: "ಗ್ರಾಹಕರು {phone}: {service}, {slot} — ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ {refund} ಮರಳಿ ಕೊಡಲಾಗಿದೆ.",
    },
  },
  {
    name: "owner_payment_unused", usedFor: "owner_payment_unused", audience: "owner",
    bodies: {
      en: "A {deposit} payment from {phone} arrived for {slot}, but that booking was no longer active (its hold had ended, or it was cancelled). {refund} was refunded.",
      hi: "ग्राहक {phone} का {deposit} का भुगतान {slot} की उस बुकिंग के लिए आया जो अब चालू नहीं थी (स्लॉट छूट गया था या बुकिंग रद्द हो गई थी)। {refund} वापस कर दिया गया।",
      ml: "ഉപഭോക്താവ് {phone}: {slot} ബുക്കിംഗിനായി {deposit} പേയ്മെന്റ് വന്നു, പക്ഷേ ആ ബുക്കിംഗ് അപ്പോൾ നിലവിലില്ലായിരുന്നു (മാറ്റിവച്ച സമയം കഴിഞ്ഞിരുന്നു, അല്ലെങ്കിൽ റദ്ദാക്കിയിരുന്നു). {refund} തിരികെ നൽകി.",
      kn: "ಗ್ರಾಹಕರು {phone}: {slot} ಬುಕಿಂಗ್‌ಗಾಗಿ {deposit} ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಆ ಬುಕಿಂಗ್ ಆಗ ಚಾಲ್ತಿಯಲ್ಲಿ ಇರಲಿಲ್ಲ (ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದಿತ್ತು, ಅಥವಾ ರದ್ದಾಗಿತ್ತು). {refund} ಮರಳಿ ಕೊಡಲಾಗಿದೆ.",
    },
  },
  {
    name: "owner_message_held", usedFor: "owner_message_held", audience: "owner",
    bodies: {
      en: "A message to {phone} was held back because it did not match the booking record. Nothing was sent.",
      hi: "ग्राहक {phone} को जाने वाला एक संदेश रोक दिया गया क्योंकि वह बुकिंग रिकॉर्ड से मेल नहीं खाता था। कुछ नहीं भेजा गया।",
      ml: "ഉപഭോക്താവ് {phone}: അയയ്ക്കാനിരുന്ന ഒരു സന്ദേശം ബുക്കിംഗ് രേഖയുമായി പൊരുത്തപ്പെടാത്തതിനാൽ തടഞ്ഞു. ഒന്നും അയച്ചിട്ടില്ല.",
      kn: "ಗ್ರಾಹಕರು {phone}: ಕಳುಹಿಸಬೇಕಿದ್ದ ಒಂದು ಸಂದೇಶ ಬುಕಿಂಗ್ ದಾಖಲೆಗೆ ಹೊಂದಿಕೆಯಾಗದ ಕಾರಣ ತಡೆಹಿಡಿಯಲಾಗಿದೆ. ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ.",
    },
  },
  {
    name: "owner_customer_stopped", usedFor: "owner_opted_out", audience: "owner",
    bodies: {
      en: "Customer {phone} sent STOP. No more messages will go to them.",
      hi: "ग्राहक {phone} ने STOP भेजा है। अब उन्हें कोई संदेश नहीं जाएगा।",
      ml: "ഉപഭോക്താവ് {phone} STOP അയച്ചു. ഇനി അവർക്ക് സന്ദേശങ്ങൾ അയയ്ക്കില്ല.",
      kn: "ಗ್ರಾಹಕರು {phone} STOP ಕಳುಹಿಸಿದ್ದಾರೆ. ಇನ್ನು ಅವರಿಗೆ ಸಂದೇಶಗಳನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    },
  },
  // Button mode and "talk to the owner" (modules/understanding/ai-state.ts, interactive.ts): the owner is told once why the agent answers with buttons, or that a customer wants to talk.
  {
    name: "owner_wants_to_talk", usedFor: "owner_wants_to_talk", audience: "owner",
    bodies: {
      en: "Customer {phone} would like to talk to you. Please message them.",
      hi: "ग्राहक {phone} आपसे बात करना चाहते हैं। कृपया उन्हें संदेश भेजें।",
      ml: "ഉപഭോക്താവ് {phone} നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ.",
      kn: "ಗ್ರಾಹಕರು {phone} ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.",
    },
  },
  {
    name: "owner_ai_allowance_used", usedFor: "owner_ai_allowance", audience: "owner",
    bodies: {
      en: "Notice: this month's AI allowance for {business} is used up, so the agent now answers with buttons and lists. It still books, and every limit still holds. The person who set it up has been told. Normal service returns next month.",
      hi: "सूचना: {business} के लिए इस महीने का AI कोटा पूरा हो गया है, इसलिए एजेंट अब बटन और सूचियों से जवाब देगा। बुकिंग फिर भी होगी और हर सीमा पहले की तरह लागू रहेगी। जिसने इसे सेट किया है उसे बता दिया गया है। अगले महीने सामान्य सेवा फिर शुरू होगी।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ ഈ മാസത്തെ AI പരിധി തീർന്നു, അതിനാൽ ഏജന്റ് ഇനി ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് മറുപടി നൽകും. ബുക്കിംഗ് തുടർന്നും നടക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ തന്നെ പാലിക്കും. ഇത് ക്രമീകരിച്ച വ്യക്തിയെ അറിയിച്ചിട്ടുണ്ട്. അടുത്ത മാസം സാധാരണ സേവനം തിരിച്ചെത്തും.",
      kn: "ಸೂಚನೆ: {business}-ನ ಈ ತಿಂಗಳ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಈಗ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳ ಮೂಲಕ ಉತ್ತರಿಸುತ್ತದೆ. ಬುಕಿಂಗ್ ಮುಂದುವರಿಯುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಸಾಮಾನ್ಯ ಸೇವೆ ಮರಳುತ್ತದೆ.",
    },
  },
  {
    name: "owner_ai_switched_off", usedFor: "owner_ai_off", audience: "owner",
    bodies: {
      en: "Notice: the AI that reads messages for {business} has been switched off for now. The agent keeps booking with buttons and lists, and every limit still holds. The person who set it up has been told.",
      hi: "सूचना: {business} के संदेश पढ़ने वाला AI अभी बंद कर दिया गया है। एजेंट बटन और सूचियों से बुकिंग करता रहेगा और हर सीमा पहले की तरह लागू रहेगी। जिसने इसे सेट किया है उसे बता दिया गया है।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI തൽക്കാലം ഓഫ് ചെയ്തിരിക്കുന്നു. ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് ബുക്കിംഗ് തുടരും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ തന്നെ പാലിക്കും. ഇത് ക്രമീകരിച്ച വ്യക്തിയെ അറിയിച്ചിട്ടുണ്ട്.",
      kn: "ಸೂಚನೆ: {business}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಸದ್ಯಕ್ಕೆ ಆಫ್ ಮಾಡಲಾಗಿದೆ. ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳಿಂದ ಬುಕಿಂಗ್ ಮುಂದುವರಿಸುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.",
    },
  },
  {
    name: "owner_ai_not_answering", usedFor: "owner_ai_fault", audience: "owner",
    bodies: {
      en: "Notice: the AI that reads messages for {business} is not answering right now, so the agent is using buttons and lists. It still books, and every limit still holds. It will try the AI again in a few minutes.",
      hi: "सूचना: {business} के संदेश पढ़ने वाला AI अभी जवाब नहीं दे रहा है, इसलिए एजेंट बटन और सूचियों से काम कर रहा है। बुकिंग फिर भी होगी और हर सीमा पहले की तरह लागू रहेगी। कुछ मिनट बाद एजेंट फिर AI आज़माएगा।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI ഇപ്പോൾ മറുപടി നൽകുന്നില്ല, അതിനാൽ ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിക്കുന്നു. ബുക്കിംഗ് തുടർന്നും നടക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ തന്നെ പാലിക്കും. കുറച്ച് മിനിറ്റിനു ശേഷം ഏജന്റ് വീണ്ടും AI പരീക്ഷിക്കും.",
      kn: "ಸೂಚನೆ: {business}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳನ್ನು ಬಳಸುತ್ತಿದೆ. ಬುಕಿಂಗ್ ಮುಂದುವರಿಯುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಏಜೆಂಟ್ ಮತ್ತೆ AI ಪ್ರಯತ್ನಿಸುತ್ತದೆ.",
    },
  },
];

const catalogue = createMetaCatalogue<MessageFacts, TemplateId, Slot>({ templates: META_TEMPLATES, values: VALUE });

/** Every template name, for a provider (or the stand-in) to approve. */
export const META_TEMPLATE_NAMES: readonly string[] = catalogue.names;

export const slotsOf = catalogue.slotsOf;
export const parametersFor = catalogue.parametersFor;
export const templateMessage = catalogue.templateMessage;
export { META_LANGUAGE, fillBody, metaBody };
export type { MetaTemplate };

// ---- the list to submit ------------------------------------------------------------------------------------------------------

/** Example values for Meta's review: a believable Glow Salon booking, in the template's own language. */
export function exampleFacts(settings: Settings, language: Language): MessageFacts {
  return {
    language, timeZone: settings.timezone, businessName: settings.name,
    services: settings.services.map((s) => ({ name: serviceName(s, language), priceInr: s.priceInr })),
    serviceName: serviceName(settings.services[0], language), priceInr: settings.services[0].priceInr,
    depositInr: settings.deposit.amountInr, refundInr: settings.deposit.amountInr,
    slotMs: Date.UTC(2026, 10, 10, 12, 30), // Tue 10 Nov 2026, 6:00 pm in India
    link: "https://rzp.io/i/example", holdMinutes: settings.deposit.holdMinutes, windowHours: settings.cancellation.windowHours,
    bookingRef: "b-3", customerPhone: "+919811111111", approvalCode: "K7M2QX", approvalHours: 24,
  };
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
export const metaSubmissions = (settings: Settings) => catalogue.submissions((language) => exampleFacts(settings, language));
