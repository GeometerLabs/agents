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
import type { Language } from "../../../../../modules/language/languages.ts";
import { META_LANGUAGE, createMetaCatalogue, fillBody, metaBody } from "../../../../../modules/language/meta-templates.ts";
import type { MetaTemplate } from "../../../../../modules/language/meta-templates.ts";
import { serviceName } from "../settings.ts";
import type { Settings } from "../settings.ts";
import { inr, need, slot } from "./templates.ts";
import { formatInr } from "../../../../../modules/language/format.ts";
import type { MessageFacts, TemplateId } from "./templates.ts";

/** The record values a template can use, and where each comes from. */
export type Slot = "business" | "service" | "slot" | "deposit" | "refund" | "hours" | "phone" | "ref" | "code" | "approvalHours" | "upiCode" | "marked" | "left" | "partner" | "upcoming";
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
  upiCode: (f) => need(f, "upiCode"),
  marked: (f) => formatInr(need(f, "markedInr")),
  left: (f) => formatInr(need(f, "leftInr")),
  partner: (f) => need(f, "partner"),
  upcoming: (f) => String(need(f, "upcomingCount")),
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
  // 8 Nov: three owner notices that go out unprompted. A refund a person at the server settled as made (Guard's already_done), and, when a refund needs several
  // people (B37), the word to the ones who did not answer that it was approved by the others or refused by one of them. "Waiting for N more" is a reply to the
  // person's own message, inside their window, so it needs no template.
  {
    name: "owner_refund_settled", usedFor: "owner_refund_settled", audience: "owner",
    bodies: {
      en: "Refund done: {refund} for {phone}. The person who set up your agent checked it and marked it as made, so it is not sent a second time.",
      hi: "रिफंड हो गया: {phone} को {refund}। आपका एजेंट सेट करने वाले व्यक्ति ने इसे जाँचकर पूरा हुआ दर्ज किया है, इसलिए यह दोबारा नहीं भेजा जाएगा।",
      ml: "റീഫണ്ട് പൂർത്തിയായി: ഉപഭോക്താവ് {phone}, {refund}. നിങ്ങളുടെ ഏജന്റ് ക്രമീകരിച്ച വ്യക്തി ഇത് പരിശോധിച്ച് നടന്നതായി രേഖപ്പെടുത്തി, അതിനാൽ ഇത് വീണ്ടും അയയ്ക്കില്ല.",
      kn: "ರೀಫಂಡ್ ಆಗಿದೆ: ಗ್ರಾಹಕರು {phone}, {refund}. ನಿಮ್ಮ ಏಜೆಂಟ್ ಅನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರು ಇದನ್ನು ಪರಿಶೀಲಿಸಿ ಆಗಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಮತ್ತೆ ಕಳುಹಿಸುವುದಿಲ್ಲ.",
    },
  },
  {
    name: "owner_approval_closed", usedFor: "owner_approval_closed", audience: "owner",
    bodies: {
      en: "The {refund} refund for {phone} has been approved by the others, so your answer is no longer needed. Thank you.",
      hi: "सूचना: {phone} को {refund} के रिफंड को दूसरों ने मंज़ूरी दे दी है, इसलिए अब आपके जवाब की ज़रूरत नहीं है। धन्यवाद।",
      ml: "അറിയിപ്പ്: ഉപഭോക്താവ് {phone}: {refund} റീഫണ്ടിന് മറ്റുള്ളവർ അനുമതി നൽകി, അതിനാൽ ഇനി നിങ്ങളുടെ മറുപടി ആവശ്യമില്ല. നന്ദി.",
      kn: "ಸೂಚನೆ: ಗ್ರಾಹಕರು {phone}: {refund} ರೀಫಂಡ್‌ಗೆ ಇತರರು ಅನುಮತಿ ನೀಡಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಈಗ ನಿಮ್ಮ ಉತ್ತರ ಬೇಕಿಲ್ಲ. ಧನ್ಯವಾದ.",
    },
  },
  {
    name: "owner_approval_refused", usedFor: "owner_approval_refused", audience: "owner",
    bodies: {
      en: "The {refund} refund for {phone} was refused by one of the people who approve refunds, so it will not be sent, and they will be told.",
      hi: "सूचना: {phone} को {refund} के रिफंड को मंज़ूरी देने वालों में से एक ने मना कर दिया है, इसलिए यह नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा।",
      ml: "അറിയിപ്പ്: ഉപഭോക്താവ് {phone}: {refund} റീഫണ്ട് അനുമതി നൽകുന്നവരിൽ ഒരാൾ നിരസിച്ചു, അതിനാൽ ഇത് അയയ്ക്കില്ല, അവരെ അറിയിക്കും.",
      kn: "ಸೂಚನೆ: ಗ್ರಾಹಕರು {phone}: {refund} ರೀಫಂಡ್ ಅನ್ನು ಅನುಮತಿ ನೀಡುವವರಲ್ಲಿ ಒಬ್ಬರು ನಿರಾಕರಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.",
    },
  },
  // The licence's service notices to the owner (B13): the one plain notice at the wind-down and at the final stop, which the owner may get on a day they have not written.
  {
    name: "owner_service_paused", usedFor: "owner_licence_paused", audience: "owner",
    bodies: {
      en: "Notice: online booking for {business} is paused for now. Existing bookings, cancellations and refunds still go through. Please contact {partner}.",
      hi: "सूचना: {business} की ऑनलाइन बुकिंग अभी रुकी हुई है। पहले की बुकिंग, रद्द करना और रिफंड पहले की तरह चलते रहेंगे। इस बारे में कृपया {partner} से संपर्क करें।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. നിലവിലുള്ള ബുക്കിംഗുകളും റദ്ദാക്കലുകളും റീഫണ്ടുകളും തുടർന്നും നടക്കും. ഇതിനെക്കുറിച്ച് ദയവായി {partner}-നെ ബന്ധപ്പെടൂ.",
      kn: "ಸೂಚನೆ: {business}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಈಗಿರುವ ಬುಕಿಂಗ್‌ಗಳು, ರದ್ದತಿಗಳು ಮತ್ತು ರೀಫಂಡ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ. ಈ ಬಗ್ಗೆ ದಯವಿಟ್ಟು {partner} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    },
  },
  {
    name: "owner_service_stopped", usedFor: "owner_licence_stopped", audience: "owner",
    bodies: {
      en: "Notice: online booking for {business} has stopped, because the service from {partner} has ended. Bookings after today still in your calendar: {upcoming}. To keep it running with another local partner, write to hello@geometer.dev and Geometer will connect you.",
      hi: "सूचना: {business} की ऑनलाइन बुकिंग बंद हो गई है, क्योंकि {partner} की सेवा समाप्त हो गई है। आज के बाद की जो बुकिंग आपके कैलेंडर में हैं: {upcoming}। इसे किसी दूसरे स्थानीय पार्टनर के साथ जारी रखने के लिए hello@geometer.dev पर लिखें, Geometer आपको जोड़ देगा।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് നിർത്തി, കാരണം {partner} നൽകിയിരുന്ന സേവനം അവസാനിച്ചു. ഇന്നിന് ശേഷം നിങ്ങളുടെ കലണ്ടറിലുള്ള ബുക്കിംഗുകൾ: {upcoming}. മറ്റൊരു പ്രാദേശിക പാർട്ണറുമായി ഇത് തുടരാൻ hello@geometer.dev എന്ന വിലാസത്തിലേക്ക് എഴുതൂ, Geometer നിങ്ങളെ ബന്ധിപ്പിക്കും.",
      kn: "ಸೂಚನೆ: {business}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ನಿಂತಿದೆ, ಏಕೆಂದರೆ {partner} ನೀಡುತ್ತಿದ್ದ ಸೇವೆ ಮುಗಿದಿದೆ. ಇಂದಿನ ನಂತರ ನಿಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿರುವ ಬುಕಿಂಗ್‌ಗಳು: {upcoming}. ಇನ್ನೊಬ್ಬ ಸ್ಥಳೀಯ ಪಾರ್ಟ್ನರ್ ಜೊತೆ ಇದನ್ನು ಮುಂದುವರಿಸಲು hello@geometer.dev ವಿಳಾಸಕ್ಕೆ ಬರೆಯಿರಿ, Geometer ನಿಮ್ಮನ್ನು ಜೋಡಿಸುತ್ತದೆ.",
    },
  },
  // UPI shops (B33). The messages that can go when the person has not written today: the customer's "booked", "after the hold", "your refund is coming" and
  // "your refund was sent"; the owner's "a payment to check", "the customer says they paid", "a refund to send" and its reminder. The owner's answers to their
  // own replies need none. The owner's code is a value like any other: it is in the message the owner reads, and nowhere a customer sees.
  {
    name: "booking_confirmed_upi", usedFor: "upi_booked", audience: "customer",
    bodies: {
      en: "Booked! {service} on {slot}. The owner has confirmed your {deposit} deposit. Cancel at least {hours} hours before the start for a refund.",
      hi: "बुक हो गया! {service}, {slot}। मालिक ने आपका {deposit} जमा पक्का कर दिया है। रिफंड के लिए शुरू होने से कम से कम {hours} घंटे पहले रद्द करें।",
      ml: "ബുക്ക് ആയി! {service}, {slot}. നിങ്ങളുടെ {deposit} അഡ്വാൻസ് ഉടമ ഉറപ്പിച്ചു. പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് {hours} മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം.",
      kn: "ಬುಕ್ ಆಗಿದೆ! {service}, {slot}. ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣವನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದ್ದಾರೆ. ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ {hours} ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ.",
    },
  },
  {
    name: "booking_upi_after_hold", usedFor: "upi_late_received", audience: "customer",
    bodies: {
      en: "The owner confirmed your {marked} payment after the hold on {slot} had ended, so it is not booked. The owner will contact you about booking again or sending the money back.",
      hi: "मालिक ने आपका {marked} पेमेंट {slot} की रोक खत्म होने के बाद पक्का किया, इसलिए बुकिंग नहीं हुई है। मालिक आपसे दोबारा बुकिंग या पैसे वापस भेजने के बारे में बात करेंगे।",
      ml: "നിങ്ങളുടെ {marked} ഉടമ ഉറപ്പിച്ചത് {slot}-ന്റെ പിടിച്ചുവെക്കൽ അവസാനിച്ച ശേഷമാണ്, അതിനാൽ ബുക്ക് ആയിട്ടില്ല. വീണ്ടും ബുക്ക് ചെയ്യുന്നതിനെക്കുറിച്ചോ പണം തിരികെ അയക്കുന്നതിനെക്കുറിച്ചോ ഉടമ നിങ്ങളെ ബന്ധപ്പെടും.",
      kn: "ನಿಮ್ಮ {marked} ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು {slot} ರ ಕಾಯ್ದಿರಿಸುವಿಕೆ ಮುಗಿದ ನಂತರ ಖಚಿತಪಡಿಸಿದರು, ಆದ್ದರಿಂದ ಬುಕ್ ಆಗಿಲ್ಲ. ಮತ್ತೆ ಬುಕ್ ಮಾಡುವ ಅಥವಾ ಹಣ ಮರಳಿ ಕಳುಹಿಸುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.",
    },
  },
  {
    name: "upi_refund_coming", usedFor: "upi_refund_owed", audience: "customer",
    bodies: {
      en: "The owner will send {refund} back to you by UPI. I'll message you when they mark it sent.",
      hi: "मालिक {refund} UPI से आपको वापस भेजेंगे। जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।",
      ml: "ഉടമ {refund} UPI വഴി നിങ്ങൾക്ക് തിരികെ അയക്കും. അയച്ചതായി ഉടമ രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.",
      kn: "ಮಾಲೀಕರು {refund} ಅನ್ನು UPI ಮೂಲಕ ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ. ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.",
    },
  },
  {
    name: "upi_refund_marked_sent", usedFor: "upi_refund_sent", audience: "customer",
    bodies: {
      en: "The owner has marked your {refund} refund for booking {ref} as sent by UPI. Please check your UPI app.",
      hi: "मालिक ने बुकिंग {ref} का आपका {refund} रिफंड UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देखें।",
      ml: "ബുക്കിംഗ് {ref}-ന്റെ നിങ്ങളുടെ {refund} റീഫണ്ട് UPI വഴി അയച്ചതായി ഉടമ രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ.",
      kn: "ಬುಕಿಂಗ್ {ref} ರ ನಿಮ್ಮ {refund} ರೀಫಂಡ್ ಅನ್ನು UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಮಾಲೀಕರು ದಾಖಲಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ.",
    },
  },
  {
    name: "owner_upi_check", usedFor: "owner_upi_expected", audience: "owner",
    bodies: {
      en: 'UPI payment to check: customer {phone} will pay the {deposit} deposit for {service} on {slot} (booking {ref}). When it shows in your UPI app, tap Received or reply "received {upiCode}". If a different amount came, reply "received {upiCode}" and the amount.',
      hi: 'जाँचने के लिए UPI पेमेंट: ग्राहक {phone} बुकिंग {ref} ({service}, {slot}) के लिए {deposit} जमा भेजेंगे। जब यह आपके UPI ऐप में दिखे, तो "मिल गया" दबाएँ या "received {upiCode}" लिखकर भेजें। अगर कोई और रकम आई है, तो "received {upiCode}" के बाद रकम लिखें।',
      ml: 'പരിശോധിക്കാനുള്ള UPI പണമടവ്: ഉപഭോക്താവ് {phone}, ബുക്കിംഗ് {ref} ({service}, {slot}) എന്നതിനായി {deposit} അഡ്വാൻസ് അയക്കും. നിങ്ങളുടെ UPI ആപ്പിൽ കാണുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received {upiCode}" എന്ന് മറുപടി അയക്കുക. മറ്റൊരു തുക ആണ് വന്നതെങ്കിൽ "received {upiCode}" എന്നതിന് ശേഷം തുക എഴുതുക.',
      kn: 'ಪರಿಶೀಲಿಸಬೇಕಾದ UPI ಪಾವತಿ: ಗ್ರಾಹಕರು {phone} ಬುಕಿಂಗ್ {ref} ({service}, {slot}) ಗಾಗಿ {deposit} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸುತ್ತಾರೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಂಡಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received {upiCode}" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ "received {upiCode}" ನಂತರ ಮೊತ್ತ ಬರೆಯಿರಿ.',
    },
  },
  {
    name: "owner_upi_customer_says_paid", usedFor: "owner_upi_claim", audience: "owner",
    bodies: {
      en: 'Customer {phone} says they have paid the {deposit} deposit for booking {ref}. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received {upiCode}".',
      hi: 'ग्राहक {phone} कह रहे हैं कि उन्होंने बुकिंग {ref} का {deposit} जमा भेज दिया है। स्क्रीनशॉट सबूत नहीं है: अपना UPI ऐप देखें। पैसे दिखें तो "मिल गया" दबाएँ या "received {upiCode}" लिखकर भेजें।',
      ml: 'ഉപഭോക്താവ് {phone} ബുക്കിംഗ് {ref}-ന്റെ {deposit} അഡ്വാൻസ് അയച്ചെന്ന് പറയുന്നു. സ്ക്രീൻഷോട്ട് തെളിവല്ല: നിങ്ങളുടെ UPI ആപ്പ് നോക്കുക. പണം ഉണ്ടെങ്കിൽ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received {upiCode}" എന്ന് മറുപടി അയക്കുക.',
      kn: 'ಗ್ರಾಹಕರು {phone} ಬುಕಿಂಗ್ {ref} ರ {deposit} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸಿದ್ದೇವೆ ಎನ್ನುತ್ತಿದ್ದಾರೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ: ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ. ಹಣ ಇದ್ದರೆ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received {upiCode}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  {
    // asked again from the unfinished-work list (B31) when the owner marked part of a deposit and has not marked the rest: the owner may not have written today
    name: "owner_upi_part_marked", usedFor: "owner_upi_part", audience: "owner",
    bodies: {
      en: 'You marked {marked} for booking {ref}, but the deposit is {deposit}, so it is not booked yet. The slot stays held until the hold ends. When the other {left} arrives, tap Received or reply "received {upiCode}".',
      hi: 'आपने बुकिंग {ref} के लिए {marked} दर्ज किया, पर जमा {deposit} है, इसलिए अभी बुकिंग नहीं हुई। रोक का समय खत्म होने तक स्लॉट रुका रहेगा। बाकी {left} आने पर "मिल गया" दबाएँ या "received {upiCode}" लिखकर भेजें।',
      ml: 'ബുക്കിംഗ് {ref}-ന് നിങ്ങൾ {marked} രേഖപ്പെടുത്തി, പക്ഷേ അഡ്വാൻസ് {deposit} ആണ്, അതിനാൽ ഇതുവരെ ബുക്ക് ആയിട്ടില്ല. പിടിച്ചുവെക്കൽ സമയം തീരും വരെ സ്ലോട്ട് പിടിച്ചുവെക്കും. ബാക്കി {left} എത്തുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received {upiCode}" എന്ന് മറുപടി അയക്കുക.',
      kn: 'ಬುಕಿಂಗ್ {ref} ಗೆ ನೀವು {marked} ದಾಖಲಿಸಿದ್ದೀರಿ, ಆದರೆ ಮುಂಗಡ ಹಣ {deposit}, ಆದ್ದರಿಂದ ಇನ್ನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಕಾಯ್ದಿರಿಸುವ ಸಮಯ ಮುಗಿಯುವವರೆಗೆ ಸ್ಲಾಟ್ ಕಾಯ್ದಿರುತ್ತದೆ. ಉಳಿದ {left} ಬಂದಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received {upiCode}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  {
    name: "owner_upi_refund_to_send", usedFor: "owner_upi_refund_owed", audience: "owner",
    bodies: {
      en: 'Refund to send: {refund} by UPI to customer {phone} (booking {ref}). The agent never sends money. When you have sent it, tap Refund sent or reply "refunded {upiCode}".',
      hi: 'वापस भेजना है: ग्राहक {phone} (बुकिंग {ref}) को UPI से {refund}। एजेंट कभी पैसे नहीं भेजता। भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded {upiCode}" लिखकर भेजें।',
      ml: 'തിരികെ അയക്കേണ്ടത്: ഉപഭോക്താവ് {phone}-ന് (ബുക്കിംഗ് {ref}) UPI വഴി {refund}. ഏജന്റ് ഒരിക്കലും പണം അയക്കില്ല. അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded {upiCode}" എന്ന് മറുപടി അയക്കുക.',
      kn: 'ಮರಳಿ ಕಳುಹಿಸಬೇಕು: ಗ್ರಾಹಕರು {phone} (ಬುಕಿಂಗ್ {ref}) ಅವರಿಗೆ UPI ಮೂಲಕ {refund}. ಏಜೆಂಟ್ ಎಂದಿಗೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded {upiCode}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  {
    name: "owner_upi_refund_reminder", usedFor: "owner_upi_refund_reminder", audience: "owner",
    bodies: {
      en: 'Reminder: {refund} is still owed back to customer {phone} (booking {ref}). When you have sent it by UPI, tap Refund sent or reply "refunded {upiCode}".',
      hi: 'याद दिलाना: ग्राहक {phone} (बुकिंग {ref}) को {refund} अभी भी वापस देना है। UPI से भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded {upiCode}" लिखकर भेजें।',
      ml: 'ഓർമ്മപ്പെടുത്തൽ: ഉപഭോക്താവ് {phone}-ന് (ബുക്കിംഗ് {ref}) {refund} ഇനിയും തിരികെ നൽകാനുണ്ട്. UPI വഴി അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded {upiCode}" എന്ന് മറുപടി അയക്കുക.',
      kn: 'ನೆನಪಿಸುವುದು: ಗ್ರಾಹಕರು {phone} (ಬುಕಿಂಗ್ {ref}) ಅವರಿಗೆ {refund} ಇನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded {upiCode}" ಎಂದು ಉತ್ತರಿಸಿ.',
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
    bookingRef: "b-3", customerPhone: "+919811111111", approvalCode: "K7M2QX", approvalHours: 24, approvalsLeft: 1,
    upiId: "glowsalon@okicici", payee: settings.name, upiCode: "P4XR9T", markedInr: settings.deposit.amountInr, leftInr: settings.deposit.amountInr,
    partner: "Divya, local partner", upcomingCount: 3,
  };
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
export const metaSubmissions = (settings: Settings) => catalogue.submissions((language) => exampleFacts(settings, language));
