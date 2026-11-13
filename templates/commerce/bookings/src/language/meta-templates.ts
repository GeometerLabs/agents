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
import { Service, inr, need, phone, slot } from "./templates.ts";
import { formatInr } from "../../../../../modules/language/format.ts";
import type { MessageFacts, TemplateId } from "./templates.ts";

/** The record values a template can use, and where each comes from. */
export type Slot = "business" | "service" | "Service" | "slot" | "deposit" | "refund" | "hours" | "phone" | "ref" | "code" | "approvalHours" | "upiCode" | "marked" | "left" | "partner" | "upcoming";
const VALUE: Record<Slot, (f: MessageFacts) => string> = {
  business: (f) => f.businessName,
  service: (f) => need(f, "serviceName"),
  // the service opening a sentence ("You're booked! Haircut, ..."): capitalised in English, as templates.ts writes it
  Service: (f) => Service(f),
  slot: (f) => slot(f),
  deposit: (f) => inr(f, "depositInr"),
  refund: (f) => inr(f, "refundInr"),
  hours: (f) => String(need(f, "windowHours")),
  phone: (f) => phone(f), // grouped ("+91 98111 11111"), as templates.ts writes it
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
      en: "Hi! Just a reminder: your {service} at {business} is on {slot}. See you then!",
      hi: "नमस्ते! याद दिला दूँ: {business} में आपका {service} {slot} पर है। मिलते हैं!",
      ml: "നമസ്കാരം! ഒരു ഓർമ്മപ്പെടുത്തൽ: {business}-ൽ നിങ്ങളുടെ {service} ബുക്കിംഗ് {slot} ആണ്. കാണാം!",
      kn: "ನಮಸ್ಕಾರ! ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ: {business}-ನಲ್ಲಿ ನಿಮ್ಮ {service} ಬುಕಿಂಗ್ ಇದೆ ({slot}). ಅಲ್ಲಿ ಸಿಗೋಣ!",
    },
  },
  {
    name: "booking_confirmed", usedFor: "booked", audience: "customer",
    bodies: {
      en: "You're booked! {Service}, {slot}. We got your {deposit} deposit. Can't make it? Cancel at least {hours} hours before and your deposit comes back.",
      hi: "बुक हो गया! {service}, {slot}। आपका {deposit} जमा हमें मिल गया। नहीं आ पा रहे? शुरू होने से कम से कम {hours} घंटे पहले रद्द कर दीजिए, आपका जमा वापस मिल जाएगा।",
      ml: "ബുക്ക് ആയി! {service}, {slot}. നിങ്ങളുടെ {deposit} അഡ്വാൻസ് കിട്ടി. വരാൻ പറ്റില്ലെങ്കിൽ {hours} മണിക്കൂർ മുമ്പെങ്കിലും റദ്ദാക്കൂ, അഡ്വാൻസ് തിരികെ കിട്ടും.",
      kn: "ಬುಕ್ ಆಗಿದೆ! {service}, {slot}. ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ. ಬರಲು ಆಗದಿದ್ದರೆ ಕನಿಷ್ಠ {hours} ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿ, ಮುಂಗಡ ಹಣ ಮರಳಿ ಸಿಗುತ್ತದೆ.",
    },
  },
  {
    name: "booking_not_confirmed", usedFor: "couldnt_confirm", audience: "customer",
    bodies: {
      en: "We got your {deposit} deposit, but I couldn't confirm {slot} in our calendar yet, so it's not booked. I've told the owner, and they'll get in touch with you.",
      hi: "आपका {deposit} जमा मिल गया है, पर {slot} अभी हमारे कैलेंडर में पक्का नहीं हो पाया, इसलिए बुकिंग नहीं हुई है। मैंने मालिक को बता दिया है, वे आपसे बात करेंगे।",
      ml: "നിങ്ങളുടെ {deposit} അഡ്വാൻസ് കിട്ടി, പക്ഷേ {slot} ഞങ്ങളുടെ കലണ്ടറിൽ ഉറപ്പിക്കാൻ ഇതുവരെ പറ്റിയില്ല, അതുകൊണ്ട് ബുക്ക് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്, അവർ നിങ്ങളെ ബന്ധപ്പെടും.",
      kn: "ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ, ಆದರೆ ನಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ {slot} ಇನ್ನೂ ಖಚಿತವಾಗಿಲ್ಲ, ಹಾಗಾಗಿ ಬುಕ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ, ಅವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.",
    },
  },
  {
    name: "booking_rescheduled", usedFor: "rescheduled", audience: "customer",
    bodies: {
      en: "Done! Your {service} is now on {slot}.",
      hi: "हो गया! आपका {service} अब {slot} पर है।",
      ml: "മാറ്റിയിട്ടുണ്ട്! {service}, പുതിയ സമയം: {slot}.",
      kn: "ಆಯಿತು! {service} ಹೊಸ ಸಮಯ: {slot}.",
    },
  },
  {
    name: "deposit_refund_approved", usedFor: "refund_approved", audience: "customer",
    bodies: {
      en: "Good news: the owner approved your refund. {refund} is on its way to you.",
      hi: "खुशखबरी: मालिक ने आपका रिफंड मंज़ूर कर दिया है। {refund} आपको वापस भेजा जा रहा है।",
      ml: "സന്തോഷവാർത്ത: ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. {refund} നിങ്ങൾക്ക് തിരികെ വരുന്നുണ്ട്.",
      kn: "ಒಳ್ಳೆಯ ಸುದ್ದಿ: ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಒಪ್ಪಿದ್ದಾರೆ. {refund} ನಿಮಗೆ ಮರಳಿ ಬರುತ್ತಿದೆ.",
    },
  },
  {
    // 12 Nov 2026: the word "we will message you as soon as it is confirmed" (refund_checking) promised. The payments service's list can settle the refund days later
    // (a person's look, or the provider's refund.done), outside the customer's 24-hour window, so it needs a template of its own.
    name: "deposit_refund_confirmed", usedFor: "refund_confirmed", audience: "customer",
    bodies: {
      en: "Your {refund} refund is confirmed and on its way back to you.",
      hi: "आपका {refund} का रिफंड पक्का हो गया है और आपको वापस भेजा जा रहा है।",
      ml: "നിങ്ങളുടെ {refund} റീഫണ്ട് ഉറപ്പായി, തിരികെ വരുന്നുണ്ട്.",
      kn: "ನಿಮ್ಮ {refund} ರೀಫಂಡ್ ಖಚಿತವಾಗಿದೆ, ಅದು ನಿಮಗೆ ಮರಳಿ ಬರುತ್ತಿದೆ.",
    },
  },
  {
    name: "deposit_paid_twice", usedFor: "duplicate_refund", audience: "customer",
    bodies: {
      en: "You paid the deposit twice. We're refunding the extra {refund} to you.",
      hi: "आपने जमा दो बार भर दिया। एक्स्ट्रा {refund} आपको वापस किया जा रहा है।",
      ml: "നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികം അടച്ച {refund} തിരികെ നൽകുന്നുണ്ട്.",
      kn: "ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಕಟ್ಟಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ {refund} ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಿದ್ದೇವೆ.",
    },
  },
  {
    name: "owner_approval_request", usedFor: "owner_refund_needs_approval", audience: "owner",
    bodies: {
      en: "A refund needs your OK: {refund} to {phone} ({service}, {slot}). Reply \"approve {code}\" or \"deny {code}\" within {approvalHours} hours.",
      hi: "रिफंड के लिए आपकी हाँ चाहिए: ग्राहक {phone} ({service}, {slot}) को {refund}। {approvalHours} घंटे के अंदर \"approve {code}\" या \"deny {code}\" लिखकर भेजिए।",
      ml: "റീഫണ്ടിന് നിങ്ങളുടെ അനുമതി വേണം. കസ്റ്റമർ {phone} ({service}, {slot}): {refund}. {approvalHours} മണിക്കൂറിനുള്ളിൽ \"approve {code}\" അല്ലെങ്കിൽ \"deny {code}\" എന്ന് മറുപടി അയക്കൂ.",
      kn: 'ಒಪ್ಪಿಗೆ ಬೇಕು: {phone} ಅವರಿಗೆ {refund} ರೀಫಂಡ್ ({service}, {slot}). {approvalHours} ಗಂಟೆಯೊಳಗೆ "approve {code}" ಅಥವಾ "deny {code}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  // The other owner notices. The owner usually has not written to the number today, so each notice the agent sends on its own has a template here
  // (only the reply to the owner's own message does not). Two situations share one where a single sentence is true of both: owner_not_booked and
  // owner_payment_unused. Why not one generic owner template: Explanation.md, "Joining it up", 6.
  {
    name: "owner_late_cancellation", usedFor: "owner_late_cancellation", audience: "owner",
    bodies: {
      en: "Late cancellation: {phone} cancelled the {service} on {slot}, less than {hours} hours before the start. Their deposit is {deposit}. Reply \"approve {ref}\" to refund it or \"deny {ref}\" to keep it.",
      hi: "देर से रद्द: ग्राहक {phone} ने {service}, {slot} शुरू होने से {hours} घंटे से कम पहले रद्द किया। उनका जमा {deposit} है। लौटाने के लिए \"approve {ref}\" लिखिए, रखने के लिए \"deny {ref}\" लिखिए।",
      ml: "വൈകിയുള്ള റദ്ദാക്കൽ: കസ്റ്റമർ {phone} ({service}, {slot}) തുടങ്ങാൻ {hours} മണിക്കൂറിൽ കുറവുള്ളപ്പോൾ റദ്ദാക്കി. അഡ്വാൻസ് {deposit}. തിരികെ നൽകാൻ \"approve {ref}\" എന്നും, അഡ്വാൻസ് വയ്ക്കാൻ \"deny {ref}\" എന്നും അയക്കൂ.",
      kn: 'ತಡವಾದ ರದ್ದತಿ: {phone} ಅವರು {service} ಬುಕಿಂಗ್ ({slot}) ಶುರುವಾಗಲು {hours} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಇರುವಾಗ ರದ್ದು ಮಾಡಿದ್ದಾರೆ. ಅವರ ಮುಂಗಡ ಹಣ {deposit}. ಮರಳಿ ಕೊಡಲು "approve {ref}" ಎಂದು, ಇಟ್ಟುಕೊಳ್ಳಲು "deny {ref}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  {
    name: "owner_cant_confirm", usedFor: "owner_cant_confirm", audience: "owner",
    bodies: {
      en: "Please check: the {service} on {slot} for {phone} didn't go into the calendar, so it's NOT booked. Their {deposit} deposit is recorded. Reply \"retry {ref}\" to try the calendar again, or \"approve {ref}\" to cancel it and refund the deposit.",
      hi: "ज़रा देख लीजिए: ग्राहक {phone} का {service}, {slot} कैलेंडर में नहीं चढ़ा, इसलिए बुकिंग पक्की नहीं है। उनका {deposit} जमा दर्ज है। कैलेंडर फिर आज़माने के लिए \"retry {ref}\" लिखिए, या बुकिंग रद्द करके जमा लौटाने के लिए \"approve {ref}\" लिखिए।",
      ml: "ഒന്ന് നോക്കണം: കസ്റ്റമർ {phone} ({service}, {slot}) കലണ്ടറിൽ കയറിയില്ല, അതുകൊണ്ട് ബുക്ക് ആയിട്ടില്ല. അവരുടെ {deposit} അഡ്വാൻസ് രേഖപ്പെടുത്തിയിട്ടുണ്ട്. കലണ്ടറിൽ വീണ്ടും ശ്രമിക്കാൻ \"retry {ref}\" എന്ന് അയക്കൂ, അല്ലെങ്കിൽ ബുക്കിംഗ് റദ്ദാക്കി അഡ്വാൻസ് തിരികെ നൽകാൻ \"approve {ref}\" എന്ന് അയക്കൂ.",
      kn: 'ಗಮನಿಸಿ: {phone} ಅವರ {service} ಬುಕಿಂಗ್ ({slot}) ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಸೇರಲಿಲ್ಲ, ಹಾಗಾಗಿ ಬುಕ್ ಆಗಿಲ್ಲ. ಅವರ {deposit} ಮುಂಗಡ ಹಣ ದಾಖಲಾಗಿದೆ. ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು "retry {ref}" ಎಂದು, ಬುಕಿಂಗ್ ರದ್ದು ಮಾಡಿ ಮುಂಗಡ ಹಣ ಮರಳಿ ಕೊಡಲು "approve {ref}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
  {
    name: "owner_not_booked", usedFor: "owner_not_booked", audience: "owner",
    bodies: {
      en: "Heads up: I couldn't set up the {service} on {slot} for {phone}, because the calendar or the payment link didn't work. Nothing is booked.",
      hi: "ध्यान दें: ग्राहक {phone} के {service}, {slot} की बुकिंग नहीं बन पाई, क्योंकि कैलेंडर या पेमेंट लिंक ने काम नहीं किया। कुछ भी बुक नहीं हुआ है।",
      ml: "അറിയിപ്പ്: കസ്റ്റമർ {phone} ({service}, {slot}) ബുക്ക് ചെയ്യാൻ പറ്റിയില്ല, കലണ്ടറോ പേയ്മെന്റ് ലിങ്കോ ശരിയായില്ല. ഒന്നും ബുക്ക് ആയിട്ടില്ല.",
      kn: "ಗಮನಿಸಿ: {phone} ಅವರಿಗೆ {service} ಬುಕಿಂಗ್ ({slot}) ಸಿದ್ಧಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಏಕೆಂದರೆ ಕ್ಯಾಲೆಂಡರ್ ಅಥವಾ ಪಾವತಿ ಲಿಂಕ್ ಕೆಲಸ ಮಾಡಲಿಲ್ಲ. ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ.",
    },
  },
  {
    name: "owner_move_failed", usedFor: "owner_reschedule_failed", audience: "owner",
    bodies: {
      en: "Heads up: I couldn't move the {service} for {phone} to {slot} in the calendar. Please check their booking.",
      hi: "ध्यान दें: ग्राहक {phone} का {service} कैलेंडर में {slot} पर नहीं जा पाया। कृपया उनकी बुकिंग देख लीजिए।",
      ml: "അറിയിപ്പ്: കസ്റ്റമർ {phone} ({service}) പുതിയ സമയത്തേക്ക് ({slot}) കലണ്ടറിൽ മാറ്റാൻ പറ്റിയില്ല. ദയവായി അവരുടെ ബുക്കിംഗ് ഒന്ന് നോക്കൂ.",
      kn: "ಗಮನಿಸಿ: {phone} ಅವರ {service} ಬುಕಿಂಗ್ ಅನ್ನು ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಬದಲಾಯಿಸಲು ಆಗಲಿಲ್ಲ (ಹೊಸ ಸಮಯ: {slot}). ದಯವಿಟ್ಟು ಅವರ ಬುಕಿಂಗ್ ನೋಡಿ.",
    },
  },
  {
    name: "owner_paid_twice", usedFor: "owner_duplicate_payment", audience: "owner",
    bodies: {
      en: "Heads up: {phone} paid the deposit twice for the {service} on {slot}. The extra {refund} was refunded to them.",
      hi: "ध्यान दें: ग्राहक {phone} ने {service}, {slot} के लिए जमा दो बार भर दिया। एक्स्ट्रा {refund} उन्हें वापस कर दिया गया है।",
      ml: "അറിയിപ്പ്: കസ്റ്റമർ {phone}, {service} ({slot}), അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികം അടച്ച {refund} തിരികെ നൽകി.",
      kn: "ಗಮನಿಸಿ: {phone} ಅವರು {service} ಬುಕಿಂಗ್‌ಗೆ ({slot}) ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಕಟ್ಟಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ {refund} ಅವರಿಗೆ ಮರಳಿ ಕಳುಹಿಸಲಾಗಿದೆ.",
    },
  },
  {
    name: "owner_payment_unused", usedFor: "owner_payment_unused", audience: "owner",
    bodies: {
      en: "Heads up: {phone} paid {deposit} for {slot}, but that booking was no longer open (its hold had ended, or it was cancelled). {refund} was refunded to them.",
      hi: "ध्यान दें: ग्राहक {phone} ने {slot} के लिए {deposit} भेजे, पर वह बुकिंग अब खुली नहीं थी (स्लॉट की रोक खत्म हो गई थी, या बुकिंग रद्द हो गई थी)। {refund} उन्हें वापस कर दिया गया है।",
      ml: "അറിയിപ്പ്: കസ്റ്റമർ {phone} {deposit} അടച്ചു ({slot}), പക്ഷേ ആ ബുക്കിംഗ് അപ്പോൾ തുറന്നിരുന്നില്ല (മാറ്റിവച്ച സമയം കഴിഞ്ഞിരുന്നു, അല്ലെങ്കിൽ റദ്ദാക്കിയിരുന്നു). {refund} തിരികെ നൽകി.",
      kn: "ಗಮನಿಸಿ: {phone} ಅವರು {deposit} ಕಟ್ಟಿದ್ದಾರೆ (ಬುಕಿಂಗ್: {slot}), ಆದರೆ ಆ ಬುಕಿಂಗ್ ಆಗ ತೆರೆದಿರಲಿಲ್ಲ (ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದಿತ್ತು, ಅಥವಾ ರದ್ದಾಗಿತ್ತು). {refund} ಅವರಿಗೆ ಮರಳಿ ಕಳುಹಿಸಲಾಗಿದೆ.",
    },
  },
  {
    name: "owner_message_held", usedFor: "owner_message_held", audience: "owner",
    bodies: {
      en: "Heads up: I held back a message to {phone} because it didn't match the booking record. Nothing was sent.",
      hi: "ध्यान दें: ग्राहक {phone} को जाने वाला एक मैसेज मैंने रोक लिया, क्योंकि वह बुकिंग रिकॉर्ड से मेल नहीं खाता था। कुछ भी नहीं भेजा गया।",
      ml: "അറിയിപ്പ്: {phone} നമ്പറിലേക്കുള്ള ഒരു മെസ്സേജ് ബുക്കിംഗ് രേഖയുമായി ചേരാത്തതുകൊണ്ട് ഞാൻ നിർത്തിവച്ചു. ഒന്നും അയച്ചിട്ടില്ല.",
      kn: "ಗಮನಿಸಿ: {phone} ಅವರಿಗೆ ಕಳುಹಿಸಬೇಕಿದ್ದ ಒಂದು ಮೆಸೇಜ್ ಬುಕಿಂಗ್ ದಾಖಲೆಗೆ ಹೊಂದಿಕೆಯಾಗದ ಕಾರಣ ತಡೆಹಿಡಿದಿದ್ದೇನೆ. ಏನೂ ಕಳುಹಿಸಿಲ್ಲ.",
    },
  },
  {
    name: "owner_customer_stopped", usedFor: "owner_opted_out", audience: "owner",
    bodies: {
      en: "Heads up: {phone} sent STOP, so I won't message them again.",
      hi: "ध्यान दें: ग्राहक {phone} ने STOP भेजा है, इसलिए अब मैं उन्हें मैसेज नहीं करूँगा।",
      ml: "അറിയിപ്പ്: കസ്റ്റമർ {phone} STOP അയച്ചു, അതുകൊണ്ട് ഇനി അവർക്ക് മെസ്സേജ് അയക്കില്ല.",
      kn: "ಗಮನಿಸಿ: {phone} ಅವರು STOP ಕಳುಹಿಸಿದ್ದಾರೆ, ಹಾಗಾಗಿ ಇನ್ನು ಅವರಿಗೆ ಮೆಸೇಜ್ ಮಾಡುವುದಿಲ್ಲ.",
    },
  },
  // Button mode and "talk to the owner" (modules/understanding/ai-state.ts, interactive.ts): the owner is told once why the agent answers with buttons, or that a customer wants to talk.
  {
    name: "owner_wants_to_talk", usedFor: "owner_wants_to_talk", audience: "owner",
    bodies: {
      en: "A customer would like to talk to you: {phone}. Please message them when you can.",
      hi: "एक ग्राहक आपसे बात करना चाहते हैं: {phone}। समय मिलते ही उन्हें मैसेज कर दीजिए।",
      ml: "ഒരു കസ്റ്റമർ നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു: {phone}. സൗകര്യം പോലെ അവർക്ക് മെസ്സേജ് അയക്കൂ.",
      kn: "ಒಬ್ಬ ಗ್ರಾಹಕರು ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ: {phone}. ಸಾಧ್ಯವಾದಾಗ ಅವರಿಗೆ ಮೆಸೇಜ್ ಮಾಡಿ.",
    },
  },
  {
    name: "owner_ai_allowance_used", usedFor: "owner_ai_allowance", audience: "owner",
    bodies: {
      en: "Heads up: this month's AI allowance for {business} is used up, so I'm answering with buttons and lists for now. I still take bookings, and all your limits still apply. The person who set me up knows. Normal service is back next month.",
      hi: "ध्यान दें: {business} का इस महीने का AI कोटा खत्म हो गया है, इसलिए अभी मैं बटन और लिस्ट से जवाब दे रहा हूँ। बुकिंग फिर भी चलती रहेगी और आपकी सारी सीमाएँ पहले जैसी लागू हैं। जिसने मुझे सेट किया है, उसे पता है। अगले महीने सब पहले जैसा हो जाएगा।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ ഈ മാസത്തെ AI പരിധി തീർന്നു, അതുകൊണ്ട് തൽക്കാലം ബട്ടണുകളും ലിസ്റ്റുകളും ഉപയോഗിച്ചാണ് ഞാൻ മറുപടി തരുന്നത്. ബുക്കിംഗ് തുടർന്നും എടുക്കും, നിങ്ങളുടെ എല്ലാ പരിധികളും ബാധകമാണ്. എന്നെ സെറ്റ് ചെയ്ത വ്യക്തിക്ക് അറിയാം. അടുത്ത മാസം പഴയതുപോലെ ആകും.",
      kn: "ಗಮನಿಸಿ: {business}-ನ ಈ ತಿಂಗಳ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಹಾಗಾಗಿ ಈಗ ಬಟನ್ ಮತ್ತು ಪಟ್ಟಿಗಳ ಮೂಲಕ ಉತ್ತರಿಸುತ್ತಿದ್ದೇನೆ. ಬುಕಿಂಗ್ ಇನ್ನೂ ತೆಗೆದುಕೊಳ್ಳುತ್ತೇನೆ, ನಿಮ್ಮ ಎಲ್ಲಾ ಮಿತಿಗಳೂ ಹಾಗೆಯೇ ಇರುತ್ತವೆ. ನನ್ನನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ಗೊತ್ತಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಎಂದಿನಂತೆ ನಡೆಯುತ್ತದೆ.",
    },
  },
  {
    name: "owner_ai_switched_off", usedFor: "owner_ai_off", audience: "owner",
    bodies: {
      en: "Heads up: the AI that reads messages for {business} is switched off for now. I keep taking bookings with buttons and lists, and all your limits still apply. The person who set me up knows.",
      hi: "ध्यान दें: {business} के मैसेज पढ़ने वाला AI अभी बंद है। मैं बटन और लिस्ट से बुकिंग लेता रहूँगा, और आपकी सारी सीमाएँ पहले जैसी लागू हैं। जिसने मुझे सेट किया है, उसे पता है।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ മെസ്സേജുകൾ വായിക്കുന്ന AI തൽക്കാലം ഓഫ് ആണ്. ബട്ടണുകളും ലിസ്റ്റുകളും ഉപയോഗിച്ച് ഞാൻ ബുക്കിംഗ് എടുക്കുന്നത് തുടരും, നിങ്ങളുടെ എല്ലാ പരിധികളും ബാധകമാണ്. എന്നെ സെറ്റ് ചെയ്ത വ്യക്തിക്ക് അറിയാം.",
      kn: "ಗಮನಿಸಿ: {business}-ನ ಮೆಸೇಜ್ ಓದುವ AI ಸದ್ಯಕ್ಕೆ ಆಫ್ ಆಗಿದೆ. ಬಟನ್ ಮತ್ತು ಪಟ್ಟಿಗಳಿಂದ ಬುಕಿಂಗ್ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ, ನಿಮ್ಮ ಎಲ್ಲಾ ಮಿತಿಗಳೂ ಹಾಗೆಯೇ ಇರುತ್ತವೆ. ನನ್ನನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ಗೊತ್ತಿದೆ.",
    },
  },
  {
    name: "owner_ai_not_answering", usedFor: "owner_ai_fault", audience: "owner",
    bodies: {
      en: "Heads up: the AI that reads messages for {business} isn't answering right now, so I'm using buttons and lists. I still take bookings, and all your limits still apply. I'll try the AI again in a few minutes.",
      hi: "ध्यान दें: {business} के मैसेज पढ़ने वाला AI अभी जवाब नहीं दे रहा, इसलिए मैं बटन और लिस्ट से काम कर रहा हूँ। बुकिंग फिर भी चलती रहेगी और आपकी सारी सीमाएँ पहले जैसी लागू हैं। कुछ मिनट बाद मैं AI को फिर आज़माऊँगा।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ മെസ്സേജുകൾ വായിക്കുന്ന AI ഇപ്പോൾ മറുപടി തരുന്നില്ല, അതുകൊണ്ട് ഞാൻ ബട്ടണുകളും ലിസ്റ്റുകളും ഉപയോഗിക്കുന്നു. ബുക്കിംഗ് തുടർന്നും എടുക്കും, നിങ്ങളുടെ എല്ലാ പരിധികളും ബാധകമാണ്. കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് ഞാൻ AI വീണ്ടും നോക്കും.",
      kn: "ಗಮನಿಸಿ: {business}-ನ ಮೆಸೇಜ್ ಓದುವ AI ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ, ಹಾಗಾಗಿ ಬಟನ್ ಮತ್ತು ಪಟ್ಟಿಗಳನ್ನು ಬಳಸುತ್ತಿದ್ದೇನೆ. ಬುಕಿಂಗ್ ಇನ್ನೂ ತೆಗೆದುಕೊಳ್ಳುತ್ತೇನೆ, ನಿಮ್ಮ ಎಲ್ಲಾ ಮಿತಿಗಳೂ ಹಾಗೆಯೇ ಇರುತ್ತವೆ. ಕೆಲವು ನಿಮಿಷ ಬಿಟ್ಟು AI ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುತ್ತೇನೆ.",
    },
  },
  // 8 Nov: three owner notices that go out unprompted. A refund a person at the server settled as made (Guard's already_done), and, when a refund needs several
  // people (B37), the word to the ones who did not answer that it was approved by the others or refused by one of them. "Waiting for N more" is a reply to the
  // person's own message, inside their window, so it needs no template.
  {
    name: "owner_refund_settled", usedFor: "owner_refund_settled", audience: "owner",
    bodies: {
      en: "Refund done: {refund} to {phone}. The person who set up your agent checked it and marked it as made, so it won't be sent a second time.",
      hi: "रिफंड हो गया: ग्राहक {phone} को {refund}। आपका एजेंट सेट करने वाले ने इसे जाँचकर भेजा हुआ दर्ज कर दिया है, इसलिए यह दोबारा नहीं जाएगा।",
      ml: "റീഫണ്ട് കഴിഞ്ഞു: {phone} നമ്പറിലേക്ക് {refund}. നിങ്ങളുടെ ഏജന്റ് സെറ്റ് ചെയ്ത വ്യക്തി ഇത് പരിശോധിച്ച് അയച്ചതായി രേഖപ്പെടുത്തി, അതുകൊണ്ട് ഇത് വീണ്ടും അയക്കില്ല.",
      kn: "ರೀಫಂಡ್ ಆಗಿದೆ: {phone} ಅವರಿಗೆ {refund}. ನಿಮ್ಮ ಏಜೆಂಟ್ ಸಿದ್ಧಪಡಿಸಿದವರು ಇದನ್ನು ನೋಡಿ ಆಗಿದೆ ಎಂದು ಗುರುತಿಸಿದ್ದಾರೆ, ಹಾಗಾಗಿ ಇದು ಎರಡನೇ ಬಾರಿ ಹೋಗುವುದಿಲ್ಲ.",
    },
  },
  {
    name: "owner_approval_closed", usedFor: "owner_approval_closed", audience: "owner",
    bodies: {
      en: "No need to answer: the others have approved the {refund} refund to {phone}. Thank you!",
      hi: "जवाब देने की ज़रूरत नहीं: दूसरों ने ग्राहक {phone} को {refund} का रिफंड मंज़ूर कर दिया है। शुक्रिया!",
      ml: "മറുപടി വേണ്ട: {phone} നമ്പറിലേക്കുള്ള {refund} റീഫണ്ടിന് മറ്റുള്ളവർ അനുമതി നൽകി. നന്ദി!",
      kn: "ಉತ್ತರಿಸುವ ಅಗತ್ಯವಿಲ್ಲ: {phone} ಅವರಿಗೆ {refund} ರೀಫಂಡ್‌ಗೆ ಇತರರು ಈಗಾಗಲೇ ಒಪ್ಪಿದ್ದಾರೆ. ಧನ್ಯವಾದ!",
    },
  },
  {
    name: "owner_approval_refused", usedFor: "owner_approval_refused", audience: "owner",
    bodies: {
      en: "One of the people who approve refunds said no to the {refund} refund to {phone}, so it won't be sent. I'll let the customer know.",
      hi: "रिफंड मंज़ूर करने वालों में से एक ने ग्राहक {phone} को {refund} के रिफंड के लिए मना कर दिया, इसलिए वह नहीं भेजा जाएगा। मैं ग्राहक को बता दूँगा।",
      ml: "റീഫണ്ടിന് അനുമതി നൽകുന്നവരിൽ ഒരാൾ {phone} നമ്പറിലേക്കുള്ള {refund} റീഫണ്ടിന് \"വേണ്ട\" എന്ന് പറഞ്ഞു, അതുകൊണ്ട് അത് അയക്കില്ല. കസ്റ്റമറെ ഞാൻ അറിയിക്കാം.",
      kn: "ಒಪ್ಪಿಗೆ ಕೊಡುವವರಲ್ಲಿ ಒಬ್ಬರು {phone} ಅವರಿಗೆ {refund} ರೀಫಂಡ್ ಬೇಡ ಎಂದಿದ್ದಾರೆ, ಹಾಗಾಗಿ ಅದನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ. ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸುತ್ತೇನೆ.",
    },
  },
  // The licence's service notices to the owner (B13): the one plain notice at the wind-down and at the final stop, which the owner may get on a day they have not written.
  {
    name: "owner_service_paused", usedFor: "owner_licence_paused", audience: "owner",
    bodies: {
      en: "Heads up: online booking for {business} is paused for now. Bookings you already have, cancellations and refunds still go through. To sort it out, please contact {partner}.",
      hi: "ध्यान दें: {business} की ऑनलाइन बुकिंग अभी रुकी हुई है। आपकी पुरानी बुकिंग, कैंसिल और रिफंड पहले की तरह चलते रहेंगे। इसके लिए कृपया {partner} से बात कर लीजिए।",
      ml: "അറിയിപ്പ്: {business}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് തൽക്കാലം നിർത്തിവച്ചിരിക്കുകയാണ്. ഇപ്പോഴുള്ള ബുക്കിംഗുകളും റദ്ദാക്കലുകളും റീഫണ്ടുകളും പതിവുപോലെ നടക്കും. ഇത് ശരിയാക്കാൻ ദയവായി {partner}-നെ ബന്ധപ്പെടൂ.",
      kn: "ಗಮನಿಸಿ: {business}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಈಗಾಗಲೇ ಇರುವ ಬುಕಿಂಗ್‌ಗಳು, ರದ್ದತಿಗಳು ಮತ್ತು ರೀಫಂಡ್‌ಗಳು ಮೊದಲಿನಂತೆಯೇ ನಡೆಯುತ್ತವೆ. ಇದನ್ನು ಸರಿಪಡಿಸಲು ದಯವಿಟ್ಟು {partner} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    },
  },
  {
    name: "owner_service_stopped", usedFor: "owner_licence_stopped", audience: "owner",
    bodies: {
      en: "Heads up: online booking for {business} has stopped, because the service from {partner} has ended. Bookings still in your calendar after today: {upcoming}. To keep it going with another local partner, write to hello@geometer.dev and Geometer will put you in touch.",
      hi: "ध्यान दें: {business} की ऑनलाइन बुकिंग बंद हो गई है, क्योंकि {partner} की सेवा खत्म हो गई है। आज के बाद आपके कैलेंडर में {upcoming} बुकिंग बाकी हैं। किसी दूसरे लोकल पार्टनर के साथ इसे जारी रखना हो तो hello@geometer.dev पर लिखिए, Geometer आपको मिलवा देगा।",
      ml: "അറിയിപ്പ്: {partner} നൽകിയിരുന്ന സേവനം അവസാനിച്ചതുകൊണ്ട് {business}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് നിന്നു. ഇന്നിന് ശേഷം നിങ്ങളുടെ കലണ്ടറിലുള്ള ബുക്കിംഗുകൾ: {upcoming}. മറ്റൊരു പ്രാദേശിക പാർട്ണറുമായി തുടരാൻ hello@geometer.dev എന്ന വിലാസത്തിലേക്ക് എഴുതൂ, Geometer നിങ്ങളെ ബന്ധിപ്പിക്കും.",
      kn: "ಗಮನಿಸಿ: {business}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ನಿಂತಿದೆ, ಏಕೆಂದರೆ {partner} ಅವರ ಸೇವೆ ಮುಗಿದಿದೆ. ಇಂದಿನ ನಂತರ ನಿಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಇನ್ನೂ ಇರುವ ಬುಕಿಂಗ್‌ಗಳು: {upcoming}. ಇನ್ನೊಬ್ಬ ಸ್ಥಳೀಯ ಪಾರ್ಟ್ನರ್ ಜೊತೆ ಮುಂದುವರಿಸಲು hello@geometer.dev ವಿಳಾಸಕ್ಕೆ ಬರೆಯಿರಿ, Geometer ನಿಮ್ಮನ್ನು ಜೋಡಿಸುತ್ತದೆ.",
    },
  },
  // UPI shops (B33). The messages that can go when the person has not written today: the customer's "booked", "after the hold", "your refund is coming" and
  // "your refund was sent"; the owner's "a payment to check", "the customer says they paid", "a refund to send" and its reminder. The owner's answers to their
  // own replies need none. The owner's code is a value like any other: it is in the message the owner reads, and nowhere a customer sees.
  {
    name: "booking_confirmed_upi", usedFor: "upi_booked", audience: "customer",
    bodies: {
      en: "You're booked! {Service}, {slot}. The owner has confirmed your {deposit} deposit. Can't make it? Cancel at least {hours} hours before and your deposit comes back.",
      hi: "बुक हो गया! {service}, {slot}। मालिक ने आपका {deposit} जमा पक्का कर दिया है। नहीं आ पा रहे? शुरू होने से कम से कम {hours} घंटे पहले रद्द कर दीजिए, आपका जमा वापस मिल जाएगा।",
      ml: "ബുക്ക് ആയി! {service}, {slot}. നിങ്ങളുടെ {deposit} അഡ്വാൻസ് ഉടമ ഉറപ്പിച്ചു. വരാൻ പറ്റില്ലെങ്കിൽ {hours} മണിക്കൂർ മുമ്പെങ്കിലും റദ്ദാക്കൂ, അഡ്വാൻസ് തിരികെ കിട്ടും.",
      kn: "ಬುಕ್ ಆಗಿದೆ! {service}, {slot}. ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣವನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದ್ದಾರೆ. ಬರಲು ಆಗದಿದ್ದರೆ ಕನಿಷ್ಠ {hours} ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿ, ಮುಂಗಡ ಹಣ ಮರಳಿ ಸಿಗುತ್ತದೆ.",
    },
  },
  {
    name: "booking_upi_after_hold", usedFor: "upi_late_received", audience: "customer",
    bodies: {
      en: "The owner confirmed your {marked} payment, but only after the hold on {slot} had ended, so it's not booked. The owner will get in touch about booking again or sending your money back.",
      hi: "मालिक ने आपका {marked} का पेमेंट {slot} की रोक खत्म होने के बाद पक्का किया, इसलिए बुकिंग नहीं हुई है। दोबारा बुकिंग या पैसे वापस भेजने के बारे में मालिक आपसे बात करेंगे।",
      ml: "നിങ്ങളുടെ {marked} പേയ്മെന്റ് ഉടമ ഉറപ്പിച്ചത് സ്ലോട്ട് ({slot}) മാറ്റിവച്ച സമയം കഴിഞ്ഞാണ്, അതുകൊണ്ട് ബുക്ക് ആയിട്ടില്ല. വീണ്ടും ബുക്ക് ചെയ്യുന്ന കാര്യമോ പണം തിരികെ അയക്കുന്ന കാര്യമോ ഉടമ നിങ്ങളെ ബന്ധപ്പെട്ട് പറയും.",
      kn: "ನಿಮ್ಮ {marked} ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದರು, ಆದರೆ {slot} ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದ ಮೇಲೆ, ಹಾಗಾಗಿ ಬುಕ್ ಆಗಿಲ್ಲ. ಮತ್ತೆ ಬುಕ್ ಮಾಡುವ ಬಗ್ಗೆ ಅಥವಾ ಹಣ ಮರಳಿ ಕಳುಹಿಸುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.",
    },
  },
  {
    name: "upi_refund_coming", usedFor: "upi_refund_owed", audience: "customer",
    bodies: {
      en: "The owner will send {refund} back to you by UPI. I'll message you once they mark it as sent.",
      hi: "मालिक {refund} UPI से आपको वापस भेजेंगे। जब वे भेजा हुआ दर्ज कर देंगे, मैं आपको मैसेज करूँगा।",
      ml: "ഉടമ {refund} UPI വഴി നിങ്ങൾക്ക് തിരികെ അയക്കും. അയച്ചതായി ഉടമ രേഖപ്പെടുത്തിയാൽ ഞാൻ മെസ്സേജ് അയക്കാം.",
      kn: "ಮಾಲೀಕರು ನಿಮಗೆ UPI ಮೂಲಕ {refund} ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ. ಅವರು ಕಳುಹಿಸಿದೆ ಎಂದು ಗುರುತಿಸಿದ ಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.",
    },
  },
  {
    name: "upi_refund_marked_sent", usedFor: "upi_refund_sent", audience: "customer",
    bodies: {
      en: "The owner has marked your {refund} refund as sent by UPI. Please check your UPI app.",
      hi: "मालिक ने आपका {refund} का रिफंड UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देख लीजिए।",
      ml: "നിങ്ങളുടെ {refund} റീഫണ്ട് UPI വഴി അയച്ചതായി ഉടമ രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് ഒന്ന് നോക്കൂ.",
      kn: "ನಿಮ್ಮ {refund} ರೀಫಂಡ್ UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ.",
    },
  },
  {
    name: "owner_upi_check", usedFor: "owner_upi_expected", audience: "owner",
    bodies: {
      en: "New booking to check: {service}, {slot}, {phone}. They'll pay a {deposit} deposit by UPI. When you see it in your UPI app, tap Received (or reply: received {upiCode}, adding the amount if it's different).",
      hi: "जाँचने के लिए नई बुकिंग: {service}, {slot}, ग्राहक {phone}। वे UPI से {deposit} जमा भेजेंगे। अपने UPI ऐप में दिखे तो \"मिल गया\" दबाइए (या लिखिए: received {upiCode}; रकम अलग हो तो उसे साथ में लिख दीजिए)।",
      ml: "പുതിയ ബുക്കിംഗ് പരിശോധിക്കാനുണ്ട്: {service}, {slot}, {phone}. {deposit} അഡ്വാൻസ് UPI വഴി അടയ്ക്കും. നിങ്ങളുടെ UPI ആപ്പിൽ കണ്ടാൽ \"കിട്ടി\" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: received {upiCode}, തുക വേറെയാണെങ്കിൽ അതും കൂടെ എഴുതൂ).",
      kn: 'ಚೆಕ್ ಮಾಡಬೇಕಾದ ಹೊಸ ಬುಕಿಂಗ್: {service}, {slot}, {phone}. ಅವರು UPI ಮೂಲಕ {deposit} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸುತ್ತಾರೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಹಣ ಕಂಡಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: received {upiCode}; ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ ಮೊತ್ತವನ್ನೂ ಸೇರಿಸಿ).',
    },
  },
  {
    name: "owner_upi_customer_says_paid", usedFor: "owner_upi_claim", audience: "owner",
    bodies: {
      en: "The customer says they've paid: {deposit} for the {service} on {slot}, {phone}. Please check your UPI app first (a screenshot isn't proof), then tap Received (or reply: received {upiCode}).",
      hi: "ग्राहक कह रहे हैं कि पेमेंट कर दिया है: {service}, {slot} के लिए {deposit}, ग्राहक {phone}। पहले अपना UPI ऐप देख लीजिए (स्क्रीनशॉट सबूत नहीं होता), फिर \"मिल गया\" दबाइए (या लिखिए: received {upiCode})।",
      ml: "കസ്റ്റമർ പണം അടച്ചെന്ന് പറയുന്നു: {service} ({slot}), {phone}, {deposit}. ആദ്യം നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ (സ്ക്രീൻഷോട്ട് തെളിവല്ല), എന്നിട്ട് \"കിട്ടി\" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: received {upiCode}).",
      kn: 'ಗ್ರಾಹಕರು ಹಣ ಕಟ್ಟಿದ್ದೇನೆ ಎನ್ನುತ್ತಿದ್ದಾರೆ: {phone}, {service} ({slot}), {deposit}. ಮೊದಲು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ (ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ), ಹಣ ಬಂದಿದ್ದರೆ "ಬಂದಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: received {upiCode}).',
    },
  },
  {
    // asked again from the unfinished-work list (B31) when the owner marked part of a deposit and has not marked the rest: the owner may not have written today
    name: "owner_upi_part_marked", usedFor: "owner_upi_part", audience: "owner",
    bodies: {
      en: "You marked {marked}, but the deposit for the {service} on {slot} is {deposit}, so it's not booked yet. I'll keep holding the slot until the hold ends. When the other {left} comes in, tap Received (or reply: received {upiCode}).",
      hi: "आपने {marked} दर्ज किया, पर {service}, {slot} का जमा {deposit} है, इसलिए अभी बुकिंग नहीं हुई। रोक खत्म होने तक मैं स्लॉट रोककर रखूँगा। बाकी {left} आ जाए तो \"मिल गया\" दबाइए (या लिखिए: received {upiCode})।",
      ml: "നിങ്ങൾ {marked} രേഖപ്പെടുത്തി, പക്ഷേ {service} ({slot}) അഡ്വാൻസ് {deposit} ആണ്, അതുകൊണ്ട് ഇതുവരെ ബുക്ക് ആയിട്ടില്ല. മാറ്റിവച്ച സമയം തീരുന്നത് വരെ ഞാൻ സ്ലോട്ട് പിടിച്ചുവയ്ക്കും. ബാക്കി {left} കൂടി കിട്ടിയാൽ \"കിട്ടി\" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: received {upiCode}).",
      kn: 'ನೀವು {marked} ಗುರುತಿಸಿದ್ದೀರಿ, ಆದರೆ {service} ({slot}) ಮುಂಗಡ ಹಣ {deposit}, ಹಾಗಾಗಿ ಇನ್ನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಕಾಯ್ದಿರಿಸುವ ಸಮಯ ಮುಗಿಯುವವರೆಗೆ ಸ್ಲಾಟ್ ಹಾಗೆಯೇ ಇರುತ್ತದೆ. ಉಳಿದ {left} ಬಂದಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: received {upiCode}).',
    },
  },
  {
    name: "owner_upi_refund_to_send", usedFor: "owner_upi_refund_owed", audience: "owner",
    bodies: {
      en: "Refund to send: {refund} by UPI to {phone}. I never send money myself. Once you've sent it, tap Refund sent (or reply: refunded {upiCode}).",
      hi: "वापस भेजना है: ग्राहक {phone} को UPI से {refund}। मैं खुद कभी पैसे नहीं भेजता। आप भेज दें तो \"रिफंड भेज दिया\" दबाइए (या लिखिए: refunded {upiCode})।",
      ml: "തിരികെ അയക്കാനുണ്ട്: കസ്റ്റമർ {phone}, UPI വഴി {refund}. പണം ഞാൻ ഒരിക്കലും സ്വയം അയക്കില്ല. നിങ്ങൾ അയച്ചുകഴിഞ്ഞാൽ \"റീഫണ്ട് അയച്ചു\" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: refunded {upiCode}).",
      kn: 'ಕಳುಹಿಸಬೇಕಾದ ರೀಫಂಡ್: {phone} ಅವರಿಗೆ UPI ಮೂಲಕ {refund}. ನಾನು ಯಾವತ್ತೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ನೀವು ಕಳುಹಿಸಿದ ಮೇಲೆ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: refunded {upiCode}).',
    },
  },
  {
    name: "owner_upi_refund_reminder", usedFor: "owner_upi_refund_reminder", audience: "owner",
    bodies: {
      en: "Reminder: {refund} is still owed back to {phone}. Once you've sent it by UPI, tap Refund sent (or reply: refunded {upiCode}).",
      hi: "याद दिलाना: ग्राहक {phone} को {refund} अभी भी वापस देना बाकी है। UPI से भेज दें तो \"रिफंड भेज दिया\" दबाइए (या लिखिए: refunded {upiCode})।",
      ml: "ഓർമ്മപ്പെടുത്തൽ: {refund} ഇനിയും തിരികെ നൽകാനുണ്ട് (കസ്റ്റമർ {phone}). UPI വഴി അയച്ചുകഴിഞ്ഞാൽ \"റീഫണ്ട് അയച്ചു\" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: refunded {upiCode}).",
      kn: 'ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ: {phone} ಅವರಿಗೆ {refund} ಇನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ಮೇಲೆ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: refunded {upiCode}).',
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
    partner: "Divya, Sri Sai Digital", upcomingCount: 3,
  };
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
export const metaSubmissions = (settings: Settings) => catalogue.submissions((language) => exampleFacts(settings, language));
