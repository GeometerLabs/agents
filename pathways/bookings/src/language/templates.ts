// Every message the agent sends, per language. v0 has NO model-written text: each message is one of these templates,
// and every amount, date, time, service and link in it is rendered from the record (the facts), never typed by hand
// and never translated. Adding a language means adding one more object below; the type makes sure none is missing.
import type { Language } from "../settings.ts";
import { formatInr, formatSlot } from "./format.ts";

/** The values of this conversation's record that a message may use. The outgoing check reads the same object. */
export interface MessageFacts {
  language: Language;
  timeZone: string;
  businessName: string;
  /** Every service with its list price, named in this language (for the menu, and so the check knows them). */
  services: { name: string; priceInr: number }[];
  serviceName?: string;
  priceInr?: number; // the list price of this booking's service
  depositInr?: number;
  refundInr?: number;
  slotMs?: number; // the booking's start
  link?: string; // the payment link from the payments service's record
  holdMinutes?: number;
  windowHours?: number;
  bookingRef?: string; // "b-3"
  customerPhone?: string;
  /** The one-use code the owner sends back to approve or deny a refund Guard is holding (never the booking ref). Made by the approvals relay. */
  approvalCode?: string;
  /** How many hours the owner has to answer. */
  approvalHours?: number;
}

export type TemplateId =
  // to the customer
  | "menu" | "ask_when" | "ask_new_time" | "price_floor" | "confirm_details" | "quote_and_link" | "slot_and_link" | "already_waiting"
  | "slot_unavailable" | "outside_hours" | "hold_failed" | "link_failed" | "booked" | "couldnt_confirm" | "hold_expired"
  | "slot_gone_refund" | "refund_unbooked" | "reschedule_failed" | "duplicate_refund" | "duplicate_refund_pending" | "cancelled_refund" | "cancelled_refund_pending"
  | "cancelled_late" | "cancelled_no_deposit" | "no_booking_found" | "refund_approved" | "refund_denied" | "rescheduled"
  | "reminder" | "didnt_understand" | "refund_checking" | "refund_expired" | "voice_note"
  // to the owner. Every line starts and ends with fixed words, because each one is also a WhatsApp template (meta-templates.ts) and
  // Meta rejects a body that starts or ends with a value. The one exception is the reply to the owner's own message, which needs no template.
  | "owner_refund_needs_approval" | "owner_cant_confirm" | "owner_late_cancellation" | "owner_duplicate_payment"
  | "owner_payment_unused" | "owner_not_booked" | "owner_reschedule_failed"
  | "owner_message_held" | "owner_opted_out" | "owner_unknown_command"
  // sent by the approvals relay, not by the agent: the ask for a refund Guard is holding, and the answers to the owner's reply
  | "owner_approval_done" | "owner_approval_denied" | "owner_approval_expired" | "owner_approval_failed";

/** Which approved WhatsApp template carries a message once the customer's 24-hour window has closed. */
export const TEMPLATE_NAMES = { customer: "booking_update", reminder: "booking_reminder", owner: "owner_notice" } as const;

type Template = (f: MessageFacts) => string;
type TemplateSet = Record<TemplateId, Template>;

/** A template asks for a value the record does not have: refuse to write the message at all. */
export function need<K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> {
  const value = f[key];
  if (value === undefined) throw new Error(`The message needs "${String(key)}" from the record, and the record does not have it.`);
  return value as NonNullable<MessageFacts[K]>;
}
export const slot = (f: MessageFacts) => formatSlot(need(f, "slotMs"), f.timeZone, f.language);
export const inr = (f: MessageFacts, key: "priceInr" | "depositInr" | "refundInr") => formatInr(need(f, key));
const menuList = (f: MessageFacts) => f.services.map((s) => `${s.name} ${formatInr(s.priceInr)}`).join(", ");

const en: TemplateSet = {
  menu: (f) => `Hello! Welcome to ${f.businessName}. We offer: ${menuList(f)}. Tell me which service, day and time you would like.`,
  ask_when: (f) => `Which day and time would you like for your ${need(f, "serviceName")}?`,
  ask_new_time: () => "Which day and time would you like instead?",
  price_floor: (f) => `Our ${need(f, "serviceName")} is ${inr(f, "priceInr")}, and I can't go lower than that.`,
  confirm_details: (f) => `Just to be sure: ${need(f, "serviceName")} on ${slot(f)}. Reply "yes" to continue.`,
  quote_and_link: (f) => `Our ${need(f, "serviceName")} is ${inr(f, "priceInr")}. ${slot(f)} is free. Pay a ${inr(f, "depositInr")} deposit to confirm: ${need(f, "link")} (I'll hold the slot for ${need(f, "holdMinutes")} minutes.)`,
  // After price_floor has already said the price, the quote does not repeat it.
  slot_and_link: (f) => `${slot(f)} is free. Pay a ${inr(f, "depositInr")} deposit to confirm: ${need(f, "link")} (I'll hold the slot for ${need(f, "holdMinutes")} minutes.)`,
  already_waiting: (f) => `Your slot (${slot(f)}) is already held. Pay the ${inr(f, "depositInr")} deposit to confirm: ${need(f, "link")}`,
  slot_unavailable: (f) => `Sorry, ${slot(f)} is not available. Please suggest another time.`,
  outside_hours: (f) => `Sorry, we are closed at ${slot(f)}. Please suggest another time.`,
  hold_failed: (f) => `Sorry, I couldn't hold ${slot(f)} just now, so nothing is booked. I've told the owner. Please try again in a few minutes.`,
  link_failed: () => "Sorry, I couldn't create the payment link just now, so nothing is booked. I've told the owner.",
  booked: (f) => `Booked! ${need(f, "serviceName")} on ${slot(f)}. Your ${inr(f, "depositInr")} deposit is received. Cancel at least ${need(f, "windowHours")} hours before the start for a refund.`,
  couldnt_confirm: (f) => `We received your ${inr(f, "depositInr")} deposit, but I couldn't confirm ${slot(f)} in our calendar yet, so it is not booked. I've told the owner, who will contact you.`,
  hold_expired: (f) => `The hold on ${slot(f)} has ended because the deposit was not received in time. Message me if you'd still like to book.`,
  slot_gone_refund: (f) => `Your ${inr(f, "depositInr")} payment arrived after the hold on ${slot(f)} ended, and that time has been taken. ${inr(f, "refundInr")} is being refunded to you.`,
  refund_unbooked: (f) => `Your ${inr(f, "depositInr")} payment arrived, but there is no active booking for it. ${inr(f, "refundInr")} is being refunded to you.`,
  reschedule_failed: (f) => `Sorry, I couldn't confirm moving your booking to ${slot(f)} in our calendar. I've told the owner, who will contact you.`,
  duplicate_refund: (f) => `You paid the deposit twice. The extra ${inr(f, "refundInr")} is being refunded.`,
  duplicate_refund_pending: (f) => `You paid the deposit twice. The extra ${inr(f, "refundInr")} will be refunded once the owner approves.`,
  cancelled_refund: (f) => `Your booking for ${slot(f)} is cancelled. Your ${inr(f, "refundInr")} deposit is being refunded.`,
  cancelled_refund_pending: (f) => `Your booking for ${slot(f)} is cancelled. The owner will confirm your ${inr(f, "refundInr")} refund shortly.`,
  cancelled_late: (f) => `Your booking for ${slot(f)} is cancelled. As it is less than ${need(f, "windowHours")} hours before the start, the owner will decide about your ${inr(f, "depositInr")} deposit and message you.`,
  cancelled_no_deposit: (f) => `Your slot on ${slot(f)} is cancelled. Nothing was charged.`,
  no_booking_found: () => "I couldn't find a booking to change. Tell me the service, day and time and I'll book it.",
  refund_approved: (f) => `The owner approved your refund. ${inr(f, "refundInr")} is on its way.`,
  refund_denied: (f) => `The owner has decided not to refund the ${inr(f, "depositInr")} deposit.`,
  rescheduled: (f) => `Done. Your ${need(f, "serviceName")} is moved to ${slot(f)}.`,
  reminder: (f) => `Reminder: your ${need(f, "serviceName")} at ${f.businessName} is on ${slot(f)}.`,
  didnt_understand: () => "Sorry, I didn't understand. Please tell me the service, day and time you would like.",
  voice_note: () => "Please type your message; I can't listen to voice notes yet.",
  refund_checking: (f) => `We are checking your ${inr(f, "refundInr")} refund and will message you as soon as it is confirmed.`,
  refund_expired: (f) => `The owner did not answer in time about your ${inr(f, "refundInr")} refund, so it has not been sent. Please contact ${f.businessName} directly.`,

  owner_refund_needs_approval: (f) => `Approval needed: refund ${inr(f, "refundInr")} for ${need(f, "customerPhone")} (${need(f, "serviceName")}, ${slot(f)}). Reply "approve ${need(f, "approvalCode")}" or "deny ${need(f, "approvalCode")}" within ${need(f, "approvalHours")} hours.`,
  owner_cant_confirm: (f) => `Could not confirm ${need(f, "customerPhone")}'s ${need(f, "serviceName")} on ${slot(f)} in the calendar, so it is NOT booked. Their ${inr(f, "depositInr")} deposit is recorded. Reply "retry ${need(f, "bookingRef")}" to check the calendar again, or "approve ${need(f, "bookingRef")}" to cancel it and refund the deposit.`,
  owner_late_cancellation: (f) => `Customer ${need(f, "customerPhone")} cancelled ${need(f, "serviceName")} on ${slot(f)} less than ${need(f, "windowHours")} hours before the start. Deposit ${inr(f, "depositInr")}. Reply "approve ${need(f, "bookingRef")}" to refund it or "deny ${need(f, "bookingRef")}" to keep it.`,
  owner_duplicate_payment: (f) => `Customer ${need(f, "customerPhone")} paid the deposit twice for ${need(f, "serviceName")} on ${slot(f)}. The extra ${inr(f, "refundInr")} was refunded.`,
  // A late payment (the hold had ended and the time was taken) and a payment for a booking that was cancelled get one line: the owner can do nothing about either, the money is back.
  owner_payment_unused: (f) => `A ${inr(f, "depositInr")} payment from ${need(f, "customerPhone")} arrived for ${slot(f)}, but that booking was no longer active (its hold had ended, or it was cancelled). ${inr(f, "refundInr")} was refunded.`,
  // The slot could not be held, or the payment link could not be made: either way nothing is booked and the customer has been told to try again.
  owner_not_booked: (f) => `Could not set up ${need(f, "customerPhone")}'s ${need(f, "serviceName")} on ${slot(f)}: the calendar or the payment link did not work. Nothing is booked.`,
  owner_reschedule_failed: (f) => `Could not confirm moving ${need(f, "customerPhone")}'s ${need(f, "serviceName")} to ${slot(f)} in the calendar. Please check their booking.`,
  owner_message_held: (f) => `A message to ${need(f, "customerPhone")} was held back because it did not match the booking record. Nothing was sent.`,
  owner_opted_out: (f) => `Customer ${need(f, "customerPhone")} sent STOP. No more messages will go to them.`,
  owner_unknown_command: () => `I didn't understand that. Reply "approve", "deny" or "retry" followed by the booking reference.`,
  owner_approval_done: (f) => `Thank you. The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} is being sent, and they will be told.`,
  owner_approval_denied: (f) => `Understood. The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} will not be sent, and they will be told.`,
  owner_approval_expired: (f) => `That request ran out before you answered, so nothing was refunded: ${inr(f, "refundInr")} for ${need(f, "customerPhone")}.`,
  owner_approval_failed: () => "I could not record your answer just now. Please send it again in a few minutes.",
};

const hi: TemplateSet = {
  menu: (f) => `नमस्ते! ${f.businessName} में आपका स्वागत है। हमारी सेवाएँ: ${menuList(f)}। बताइए आपको कौन सी सेवा, किस दिन और किस समय चाहिए?`,
  ask_when: (f) => `आपको ${need(f, "serviceName")} के लिए कौन सा दिन और समय चाहिए?`,
  ask_new_time: () => "आपको इसकी जगह कौन सा दिन और समय चाहिए?",
  price_floor: (f) => `हमारा ${need(f, "serviceName")} ${inr(f, "priceInr")} का है, इससे कम में नहीं हो पाएगा।`,
  confirm_details: (f) => `पक्का करने के लिए: ${need(f, "serviceName")}, ${slot(f)}। आगे बढ़ने के लिए "हाँ" लिखें।`,
  quote_and_link: (f) => `हमारा ${need(f, "serviceName")} ${inr(f, "priceInr")} है। ${slot(f)} खाली है। ${inr(f, "depositInr")} जमा करके पक्का करें: ${need(f, "link")} (स्लॉट ${need(f, "holdMinutes")} मिनट के लिए रोका गया है।)`,
  slot_and_link: (f) => `${slot(f)} खाली है। ${inr(f, "depositInr")} जमा करके पक्का करें: ${need(f, "link")} (स्लॉट ${need(f, "holdMinutes")} मिनट के लिए रोका गया है।)`,
  already_waiting: (f) => `आपका स्लॉट (${slot(f)}) रोका हुआ है। पक्का करने के लिए ${inr(f, "depositInr")} जमा करें: ${need(f, "link")}`,
  slot_unavailable: (f) => `माफ़ कीजिए, ${slot(f)} खाली नहीं है। कृपया कोई और समय बताइए।`,
  outside_hours: (f) => `माफ़ कीजिए, ${slot(f)} पर हम बंद रहते हैं। कृपया कोई और समय बताइए।`,
  hold_failed: (f) => `माफ़ कीजिए, अभी ${slot(f)} का स्लॉट रोक नहीं पाया, इसलिए कुछ भी बुक नहीं हुआ है। मैंने मालिक को बता दिया है। कृपया कुछ मिनट बाद फिर कोशिश करें।`,
  link_failed: () => "माफ़ कीजिए, अभी पेमेंट लिंक नहीं बन पाया, इसलिए कुछ भी बुक नहीं हुआ है। मैंने मालिक को बता दिया है।",
  booked: (f) => `बुक हो गया! ${need(f, "serviceName")}, ${slot(f)}। आपका ${inr(f, "depositInr")} जमा हो गया है। रिफंड के लिए शुरू होने से कम से कम ${need(f, "windowHours")} घंटे पहले रद्द करें।`,
  couldnt_confirm: (f) => `आपका ${inr(f, "depositInr")} जमा मिल गया है, लेकिन ${slot(f)} को हमारे कैलेंडर में अभी पक्का नहीं कर पाया, इसलिए बुकिंग पक्की नहीं है। मैंने मालिक को बता दिया है, वे आपसे संपर्क करेंगे।`,
  hold_expired: (f) => `${slot(f)} का स्लॉट छोड़ दिया गया है क्योंकि जमा राशि समय पर नहीं मिली। फिर से बुक करना चाहें तो मुझे लिखें।`,
  slot_gone_refund: (f) => `आपका ${inr(f, "depositInr")} का भुगतान ${slot(f)} का स्लॉट छूटने के बाद आया, और वह समय अब किसी और को मिल चुका है। ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  refund_unbooked: (f) => `आपका ${inr(f, "depositInr")} का भुगतान आया, लेकिन इसके लिए कोई चालू बुकिंग नहीं है। ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  reschedule_failed: (f) => `माफ़ कीजिए, आपकी बुकिंग को ${slot(f)} पर ले जाना हमारे कैलेंडर में पक्का नहीं कर पाया। मैंने मालिक को बता दिया है, वे आपसे संपर्क करेंगे।`,
  duplicate_refund: (f) => `आपने जमा राशि दो बार भर दी। अतिरिक्त ${inr(f, "refundInr")} वापस किया जा रहा है।`,
  duplicate_refund_pending: (f) => `आपने जमा राशि दो बार भर दी। अतिरिक्त ${inr(f, "refundInr")} मालिक की मंज़ूरी के बाद वापस किया जाएगा।`,
  cancelled_refund: (f) => `${slot(f)} की आपकी बुकिंग रद्द हो गई है। आपका ${inr(f, "refundInr")} जमा वापस किया जा रहा है।`,
  cancelled_refund_pending: (f) => `${slot(f)} की आपकी बुकिंग रद्द हो गई है। आपके ${inr(f, "refundInr")} के रिफंड की पुष्टि मालिक जल्द करेंगे।`,
  cancelled_late: (f) => `${slot(f)} की आपकी बुकिंग रद्द हो गई है। यह शुरू होने से ${need(f, "windowHours")} घंटे से कम पहले है, इसलिए आपके ${inr(f, "depositInr")} जमा पर मालिक फ़ैसला करेंगे और आपको बताएँगे।`,
  cancelled_no_deposit: (f) => `${slot(f)} का आपका स्लॉट रद्द हो गया है। कोई शुल्क नहीं लिया गया।`,
  no_booking_found: () => "मुझे बदलने के लिए कोई बुकिंग नहीं मिली। सेवा, दिन और समय बताइए, मैं बुक कर दूँगा।",
  refund_approved: (f) => `मालिक ने आपके रिफंड को मंज़ूरी दे दी है। ${inr(f, "refundInr")} आपको वापस भेजा जा रहा है।`,
  refund_denied: (f) => `मालिक ने ${inr(f, "depositInr")} का जमा वापस न करने का फ़ैसला किया है।`,
  rescheduled: (f) => `हो गया। आपका ${need(f, "serviceName")} अब ${slot(f)} पर है।`,
  reminder: (f) => `याद दिलाना: ${f.businessName} में आपका ${need(f, "serviceName")} ${slot(f)} पर है।`,
  refund_checking: (f) => `आपके ${inr(f, "refundInr")} के रिफंड की जाँच हो रही है। पुष्टि होते ही मैं आपको संदेश भेजूँगा।`,
  refund_expired: (f) => `मालिक ने समय पर आपके ${inr(f, "refundInr")} के रिफंड पर जवाब नहीं दिया, इसलिए वह अभी नहीं भेजा गया है। कृपया ${f.businessName} से सीधे संपर्क करें।`,
  didnt_understand: () => "माफ़ कीजिए, मैं समझ नहीं पाया। कृपया सेवा, दिन और समय बताइए।",
  voice_note: () => "कृपया अपना संदेश लिखकर भेजिए; मैं अभी वॉइस नोट नहीं सुन सकता।",

  owner_refund_needs_approval: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} (${need(f, "serviceName")}, ${slot(f)}) को ${inr(f, "refundInr")} का रिफंड। ${need(f, "approvalHours")} घंटे के अंदर "approve ${need(f, "approvalCode")}" या "deny ${need(f, "approvalCode")}" लिखकर जवाब दें।`,
  owner_cant_confirm: (f) => `ग्राहक ${need(f, "customerPhone")} का ${need(f, "serviceName")}, ${slot(f)} कैलेंडर में पक्का नहीं हो पाया, इसलिए बुकिंग पक्की नहीं है। उनका ${inr(f, "depositInr")} जमा दर्ज है। कैलेंडर फिर जाँचने के लिए "retry ${need(f, "bookingRef")}" लिखें, या बुकिंग रद्द करके जमा लौटाने के लिए "approve ${need(f, "bookingRef")}"।`,
  owner_late_cancellation: (f) => `ग्राहक ${need(f, "customerPhone")} ने ${need(f, "serviceName")}, ${slot(f)} शुरू होने से ${need(f, "windowHours")} घंटे से कम पहले रद्द किया। जमा ${inr(f, "depositInr")}। लौटाने के लिए "approve ${need(f, "bookingRef")}", रखने के लिए "deny ${need(f, "bookingRef")}" लिखें।`,
  owner_duplicate_payment: (f) => `ग्राहक ${need(f, "customerPhone")} ने ${need(f, "serviceName")}, ${slot(f)} के लिए जमा दो बार भरा। अतिरिक्त ${inr(f, "refundInr")} वापस कर दिया गया।`,
  owner_payment_unused: (f) => `ग्राहक ${need(f, "customerPhone")} का ${inr(f, "depositInr")} का भुगतान ${slot(f)} की उस बुकिंग के लिए आया जो अब चालू नहीं थी (स्लॉट छूट गया था या बुकिंग रद्द हो गई थी)। ${inr(f, "refundInr")} वापस कर दिया गया।`,
  owner_not_booked: (f) => `ग्राहक ${need(f, "customerPhone")} के ${need(f, "serviceName")}, ${slot(f)} के लिए बुकिंग तैयार नहीं हो पाई: कैलेंडर या पेमेंट लिंक ने काम नहीं किया। कुछ भी बुक नहीं हुआ।`,
  owner_reschedule_failed: (f) => `ग्राहक ${need(f, "customerPhone")} का ${need(f, "serviceName")} कैलेंडर में ${slot(f)} पर ले जाना पक्का नहीं हो पाया। कृपया उनकी बुकिंग जाँच लें।`,
  owner_message_held: (f) => `ग्राहक ${need(f, "customerPhone")} को जाने वाला एक संदेश रोक दिया गया क्योंकि वह बुकिंग रिकॉर्ड से मेल नहीं खाता था। कुछ नहीं भेजा गया।`,
  owner_opted_out: (f) => `ग्राहक ${need(f, "customerPhone")} ने STOP भेजा है। अब उन्हें कोई संदेश नहीं जाएगा।`,
  owner_unknown_command: () => `मैं समझ नहीं पाया। "approve", "deny" या "retry" लिखें और उसके बाद बुकिंग का रेफ़रेंस।`,
  owner_approval_done: (f) => `धन्यवाद। ${need(f, "customerPhone")} को ${inr(f, "refundInr")} का रिफंड भेजा जा रहा है, और उन्हें बता दिया जाएगा।`,
  owner_approval_denied: (f) => `समझ गया। ${need(f, "customerPhone")} को ${inr(f, "refundInr")} का रिफंड नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा।`,
  owner_approval_expired: (f) => `वह अनुरोध आपके जवाब से पहले ही समाप्त हो गया, इसलिए कुछ भी वापस नहीं किया गया: ${need(f, "customerPhone")} के लिए ${inr(f, "refundInr")}।`,
  owner_approval_failed: () => "अभी आपका जवाब दर्ज नहीं कर पाया। कृपया कुछ मिनट बाद फिर भेजें।",
};

// Malayalam and Kannada. Machine-written: a native speaker must read every line (REVIEW-ml.md, REVIEW-kn.md) before a real
// shop uses them. Choices that keep them safe for any shop: no service name or business name gets a case ending glued on
// (so "ഹെയർകട്ട് വില ₹450", "ಹೇರ್ ಕಟ್ ಬೆಲೆ ₹450", never a form that depends on the name's last letter), the date and time are
// written as a unit or in brackets, and owner commands stay in Latin letters ("approve b-3") with the meaning in the owner's language.
const ml: TemplateSet = {
  menu: (f) => `നമസ്കാരം! ${f.businessName}-ലേക്ക് സ്വാഗതം. ഞങ്ങളുടെ സേവനങ്ങൾ: ${menuList(f)}. ഏത് സേവനം, ഏത് ദിവസം, ഏത് സമയം വേണമെന്ന് പറയൂ.`,
  ask_when: (f) => `${need(f, "serviceName")} ഏത് ദിവസം, ഏത് സമയത്ത് വേണം?`,
  ask_new_time: () => "പകരം ഏത് ദിവസം, ഏത് സമയം വേണം?",
  price_floor: (f) => `${need(f, "serviceName")} വില ${inr(f, "priceInr")} ആണ്. ക്ഷമിക്കണം, ഇതിൽ കുറയ്ക്കാൻ കഴിയില്ല.`,
  confirm_details: (f) => `ഉറപ്പിക്കാൻ: ${need(f, "serviceName")}, ${slot(f)}. തുടരാൻ "ശരി" എന്ന് മറുപടി അയയ്ക്കൂ.`,
  quote_and_link: (f) => `${need(f, "serviceName")} വില ${inr(f, "priceInr")} ആണ്. ${slot(f)} ഒഴിവുണ്ട്. ബുക്കിംഗ് ഉറപ്പിക്കാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ: ${need(f, "link")} (ഈ സമയം ${need(f, "holdMinutes")} മിനിറ്റ് നിങ്ങൾക്കായി മാറ്റിവച്ചിട്ടുണ്ട്.)`,
  // After price_floor has already said the price, the quote does not repeat it.
  slot_and_link: (f) => `${slot(f)} ഒഴിവുണ്ട്. ബുക്കിംഗ് ഉറപ്പിക്കാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ: ${need(f, "link")} (ഈ സമയം ${need(f, "holdMinutes")} മിനിറ്റ് നിങ്ങൾക്കായി മാറ്റിവച്ചിട്ടുണ്ട്.)`,
  already_waiting: (f) => `നിങ്ങളുടെ സമയം (${slot(f)}) മാറ്റിവച്ചിട്ടുണ്ട്. ഉറപ്പിക്കാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ: ${need(f, "link")}`,
  slot_unavailable: (f) => `ക്ഷമിക്കണം, ${slot(f)} ഒഴിവില്ല. ദയവായി മറ്റൊരു സമയം പറയാമോ?`,
  outside_hours: (f) => `ക്ഷമിക്കണം, ${slot(f)} ഞങ്ങൾ അടച്ചിരിക്കും. ദയവായി മറ്റൊരു സമയം പറയാമോ?`,
  hold_failed: (f) => `ക്ഷമിക്കണം, ഇപ്പോൾ ${slot(f)} നിങ്ങൾക്കായി മാറ്റിവയ്ക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഒന്നും ബുക്ക് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.`,
  link_failed: () => "ക്ഷമിക്കണം, ഇപ്പോൾ പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഒന്നും ബുക്ക് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്.",
  booked: (f) => `ബുക്ക് ആയി! ${need(f, "serviceName")}, ${slot(f)}. നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് ലഭിച്ചു. പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് ${need(f, "windowHours")} മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം.`,
  couldnt_confirm: (f) => `നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് ലഭിച്ചു, പക്ഷേ ${slot(f)} ഞങ്ങളുടെ കലണ്ടറിൽ ഇതുവരെ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ബുക്കിംഗ് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്, അവർ നിങ്ങളെ ബന്ധപ്പെടും.`,
  hold_expired: (f) => `അഡ്വാൻസ് സമയത്ത് ലഭിക്കാത്തതിനാൽ ${slot(f)} നിങ്ങൾക്കായി മാറ്റിവച്ചത് ഒഴിവാക്കി. ഇനിയും ബുക്ക് ചെയ്യണമെങ്കിൽ എനിക്ക് മെസ്സേജ് അയയ്ക്കൂ.`,
  slot_gone_refund: (f) => `നിങ്ങളുടെ ${inr(f, "depositInr")} പേയ്മെന്റ് എത്തിയപ്പോഴേക്കും ${slot(f)} മാറ്റിവച്ചത് അവസാനിച്ചിരുന്നു, ആ സമയം മറ്റൊരാൾക്ക് നൽകിക്കഴിഞ്ഞു. ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്.`,
  refund_unbooked: (f) => `നിങ്ങളുടെ ${inr(f, "depositInr")} പേയ്മെന്റ് ലഭിച്ചു, പക്ഷേ അതിന് ഇപ്പോൾ ഒരു ബുക്കിംഗും ഇല്ല. ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്.`,
  reschedule_failed: (f) => `ക്ഷമിക്കണം, നിങ്ങളുടെ ബുക്കിംഗ് മാറ്റുന്നത് (പുതിയ സമയം: ${slot(f)}) ഞങ്ങളുടെ കലണ്ടറിൽ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്, അവർ നിങ്ങളെ ബന്ധപ്പെടും.`,
  duplicate_refund: (f) => `നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച ${inr(f, "refundInr")} തിരികെ നൽകുന്നുണ്ട്.`,
  duplicate_refund_pending: (f) => `നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച ${inr(f, "refundInr")} ഉടമ അംഗീകരിച്ച ശേഷം തിരികെ നൽകും.`,
  cancelled_refund: (f) => `ബുക്കിംഗ് റദ്ദാക്കി (${slot(f)}). നിങ്ങളുടെ ${inr(f, "refundInr")} അഡ്വാൻസ് തിരികെ നൽകുന്നുണ്ട്.`,
  cancelled_refund_pending: (f) => `ബുക്കിംഗ് റദ്ദാക്കി (${slot(f)}). നിങ്ങളുടെ ${inr(f, "refundInr")} തിരികെ നൽകുന്ന കാര്യം ഉടമ ഉടൻ ഉറപ്പാക്കും.`,
  cancelled_late: (f) => `ബുക്കിംഗ് റദ്ദാക്കി (${slot(f)}). തുടങ്ങാൻ ${need(f, "windowHours")} മണിക്കൂറിൽ താഴെ മാത്രം ബാക്കിയുള്ളതിനാൽ, നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസിന്റെ കാര്യത്തിൽ ഉടമ തീരുമാനിച്ച് നിങ്ങളെ അറിയിക്കും.`,
  cancelled_no_deposit: (f) => `ബുക്കിംഗ് റദ്ദാക്കി (${slot(f)}). പണം ഒന്നും ഈടാക്കിയിട്ടില്ല.`,
  no_booking_found: () => "മാറ്റാൻ ബുക്കിംഗ് ഒന്നും കണ്ടില്ല. സേവനം, ദിവസം, സമയം എന്നിവ പറയൂ, ഞാൻ ബുക്ക് ചെയ്യാം.",
  refund_approved: (f) => `ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. ${inr(f, "refundInr")} തിരികെ വരുന്നുണ്ട്.`,
  refund_denied: (f) => `${inr(f, "depositInr")} അഡ്വാൻസ് തിരികെ നൽകേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു.`,
  rescheduled: (f) => `മാറ്റിയിട്ടുണ്ട്. ${need(f, "serviceName")} പുതിയ സമയം: ${slot(f)}.`,
  reminder: (f) => `ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}-ൽ നിങ്ങളുടെ ${need(f, "serviceName")} ബുക്കിംഗ് സമയം: ${slot(f)}.`,
  refund_checking: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് പരിശോധിക്കുകയാണ്. ഉറപ്പാകുന്ന ഉടൻ ഞാൻ സന്ദേശം അയയ്ക്കാം.`,
  refund_expired: (f) => `ഉടമ സമയത്തിനുള്ളിൽ നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ടിനെക്കുറിച്ച് മറുപടി നൽകിയില്ല, അതിനാൽ അത് ഇതുവരെ അയച്ചിട്ടില്ല. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
  didnt_understand: () => "ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. ദയവായി സേവനം, ദിവസം, സമയം എന്നിവ പറയൂ.",
  voice_note: () => "ദയവായി നിങ്ങളുടെ സന്ദേശം ടൈപ്പ് ചെയ്ത് അയയ്ക്കൂ; എനിക്ക് ഇപ്പോൾ വോയ്‌സ് നോട്ടുകൾ കേൾക്കാൻ കഴിയില്ല.",

  owner_refund_needs_approval: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")} (${need(f, "serviceName")}, ${slot(f)}) എന്നവർക്ക് ${inr(f, "refundInr")} റീഫണ്ട്. ${need(f, "approvalHours")} മണിക്കൂറിനുള്ളിൽ "approve ${need(f, "approvalCode")}" അല്ലെങ്കിൽ "deny ${need(f, "approvalCode")}" എന്ന് മറുപടി അയയ്ക്കൂ.`,
  owner_cant_confirm: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} കലണ്ടറിൽ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ബുക്കിംഗ് ആയിട്ടില്ല. അവരുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് രേഖപ്പെടുത്തിയിട്ടുണ്ട്. കലണ്ടർ വീണ്ടും നോക്കാൻ "retry ${need(f, "bookingRef")}" എന്നും, ബുക്കിംഗ് റദ്ദാക്കി അഡ്വാൻസ് തിരികെ നൽകാൻ "approve ${need(f, "bookingRef")}" എന്നും മറുപടി അയയ്ക്കൂ.`,
  owner_late_cancellation: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} തുടങ്ങാൻ ${need(f, "windowHours")} മണിക്കൂറിൽ താഴെ ബാക്കിയുള്ളപ്പോൾ റദ്ദാക്കി. അഡ്വാൻസ് ${inr(f, "depositInr")}. തിരികെ നൽകാൻ "approve ${need(f, "bookingRef")}" എന്നും, നിങ്ങൾ വയ്ക്കാൻ "deny ${need(f, "bookingRef")}" എന്നും മറുപടി അയയ്ക്കൂ.`,
  owner_duplicate_payment: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} — അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി വന്ന ${inr(f, "refundInr")} തിരികെ നൽകി.`,
  owner_payment_unused: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${slot(f)} ബുക്കിംഗിനായി ${inr(f, "depositInr")} പേയ്മെന്റ് വന്നു, പക്ഷേ ആ ബുക്കിംഗ് അപ്പോൾ നിലവിലില്ലായിരുന്നു (മാറ്റിവച്ച സമയം കഴിഞ്ഞിരുന്നു, അല്ലെങ്കിൽ റദ്ദാക്കിയിരുന്നു). ${inr(f, "refundInr")} തിരികെ നൽകി.`,
  owner_not_booked: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} — കലണ്ടറോ പേയ്മെന്റ് ലിങ്കോ പ്രവർത്തിച്ചില്ല, അതിനാൽ ബുക്കിംഗ് ഒരുക്കാൻ കഴിഞ്ഞില്ല. ഒന്നും ബുക്ക് ആയിട്ടില്ല.`,
  owner_reschedule_failed: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${need(f, "serviceName")} — പുതിയ സമയം ${slot(f)} കലണ്ടറിൽ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി അവരുടെ ബുക്കിംഗ് പരിശോധിക്കൂ.`,
  owner_message_held: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: അയയ്ക്കാനിരുന്ന ഒരു സന്ദേശം ബുക്കിംഗ് രേഖയുമായി പൊരുത്തപ്പെടാത്തതിനാൽ തടഞ്ഞു. ഒന്നും അയച്ചിട്ടില്ല.`,
  owner_opted_out: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")} STOP അയച്ചു. ഇനി അവർക്ക് സന്ദേശങ്ങൾ അയയ്ക്കില്ല.`,
  owner_unknown_command: () => `എനിക്ക് മനസ്സിലായില്ല. "approve", "deny" അല്ലെങ്കിൽ "retry" എന്ന് എഴുതി അതിനു ശേഷം ബുക്കിംഗ് റഫറൻസ് എഴുതൂ.`,
  owner_approval_done: (f) => `നന്ദി. ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${inr(f, "refundInr")} റീഫണ്ട് അയയ്ക്കുന്നുണ്ട്, അവരെ അറിയിക്കും.`,
  owner_approval_denied: (f) => `മനസ്സിലായി. ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${inr(f, "refundInr")} റീഫണ്ട് അയയ്ക്കില്ല, അവരെ അറിയിക്കും.`,
  owner_approval_expired: (f) => `നിങ്ങൾ മറുപടി നൽകുന്നതിന് മുമ്പ് ആ അഭ്യർത്ഥനയുടെ സമയം കഴിഞ്ഞു, അതിനാൽ ഒന്നും തിരികെ നൽകിയില്ല: ഉപഭോക്താവ് ${need(f, "customerPhone")}, ${inr(f, "refundInr")}.`,
  owner_approval_failed: () => "നിങ്ങളുടെ മറുപടി ഇപ്പോൾ രേഖപ്പെടുത്താൻ കഴിഞ്ഞില്ല. ദയവായി കുറച്ച് മിനിറ്റുകൾക്ക് ശേഷം വീണ്ടും അയയ്ക്കൂ.",
};

const kn: TemplateSet = {
  menu: (f) => `ನಮಸ್ಕಾರ! ${f.businessName}-ಗೆ ಸ್ವಾಗತ. ನಮ್ಮ ಸೇವೆಗಳು: ${menuList(f)}. ಯಾವ ಸೇವೆ, ಯಾವ ದಿನ, ಯಾವ ಸಮಯ ಬೇಕು ಎಂದು ತಿಳಿಸಿ.`,
  ask_when: (f) => `${need(f, "serviceName")} ಯಾವ ದಿನ, ಯಾವ ಸಮಯಕ್ಕೆ ಬೇಕು?`,
  ask_new_time: () => "ಬದಲಿಗೆ ಯಾವ ದಿನ, ಯಾವ ಸಮಯ ಬೇಕು?",
  price_floor: (f) => `${need(f, "serviceName")} ಬೆಲೆ ${inr(f, "priceInr")}. ಕ್ಷಮಿಸಿ, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.`,
  confirm_details: (f) => `ಖಚಿತಪಡಿಸಲು: ${need(f, "serviceName")}, ${slot(f)}. ಮುಂದುವರಿಯಲು "ಹೌದು" ಎಂದು ಉತ್ತರಿಸಿ.`,
  quote_and_link: (f) => `${need(f, "serviceName")} ಬೆಲೆ ${inr(f, "priceInr")}. ${slot(f)} ಖಾಲಿ ಇದೆ. ಬುಕಿಂಗ್ ಖಚಿತಪಡಿಸಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಪಾವತಿಸಿ: ${need(f, "link")} (ಈ ಸಮಯವನ್ನು ${need(f, "holdMinutes")} ನಿಮಿಷ ನಿಮಗಾಗಿ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.)`,
  // After price_floor has already said the price, the quote does not repeat it.
  slot_and_link: (f) => `${slot(f)} ಖಾಲಿ ಇದೆ. ಬುಕಿಂಗ್ ಖಚಿತಪಡಿಸಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಪಾವತಿಸಿ: ${need(f, "link")} (ಈ ಸಮಯವನ್ನು ${need(f, "holdMinutes")} ನಿಮಿಷ ನಿಮಗಾಗಿ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.)`,
  already_waiting: (f) => `ನಿಮ್ಮ ಸಮಯ (${slot(f)}) ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ. ಖಚಿತಪಡಿಸಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಪಾವತಿಸಿ: ${need(f, "link")}`,
  slot_unavailable: (f) => `ಕ್ಷಮಿಸಿ, ${slot(f)} ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ಸಮಯ ತಿಳಿಸಿ.`,
  outside_hours: (f) => `ಕ್ಷಮಿಸಿ, ${slot(f)} ನಾವು ಮುಚ್ಚಿರುತ್ತೇವೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಸಮಯ ತಿಳಿಸಿ.`,
  hold_failed: (f) => `ಕ್ಷಮಿಸಿ, ಈಗ ${slot(f)} ಸಮಯವನ್ನು ನಿಮಗಾಗಿ ಕಾಯ್ದಿರಿಸಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
  link_failed: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ.",
  booked: (f) => `ಬುಕ್ ಆಗಿದೆ! ${need(f, "serviceName")}, ${slot(f)}. ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ. ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ ${need(f, "windowHours")} ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ.`,
  couldnt_confirm: (f) => `ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ, ಆದರೆ ${slot(f)} ಸಮಯವನ್ನು ನಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಇನ್ನೂ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬುಕಿಂಗ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ, ಅವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.`,
  hold_expired: (f) => `ಮುಂಗಡ ಹಣ ಸಮಯಕ್ಕೆ ಸಿಗದ ಕಾರಣ ${slot(f)} ನಿಮಗಾಗಿ ಕಾಯ್ದಿರಿಸಿದ್ದನ್ನು ಬಿಡುಗಡೆ ಮಾಡಲಾಗಿದೆ. ಇನ್ನೂ ಬುಕ್ ಮಾಡಬೇಕಾದರೆ ನನಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  slot_gone_refund: (f) => `ನಿಮ್ಮ ${inr(f, "depositInr")} ಪಾವತಿ ಬರುವ ವೇಳೆಗೆ ${slot(f)} ಕಾಯ್ದಿರಿಸಿದ್ದು ಮುಗಿದಿತ್ತು, ಆ ಸಮಯ ಬೇರೆಯವರಿಗೆ ಹೋಗಿದೆ. ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  refund_unbooked: (f) => `ನಿಮ್ಮ ${inr(f, "depositInr")} ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಅದಕ್ಕೆ ಈಗ ಯಾವುದೇ ಬುಕಿಂಗ್ ಇಲ್ಲ. ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  reschedule_failed: (f) => `ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ಬುಕಿಂಗ್ ಬದಲಾವಣೆಯನ್ನು (ಹೊಸ ಸಮಯ: ${slot(f)}) ನಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ, ಅವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.`,
  duplicate_refund: (f) => `ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  duplicate_refund_pending: (f) => `ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮಾಲೀಕರು ಒಪ್ಪಿದ ನಂತರ ಮರಳಿ ಕೊಡಲಾಗುವುದು.`,
  cancelled_refund: (f) => `ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ನಿಮ್ಮ ${inr(f, "refundInr")} ಮುಂಗಡ ಹಣ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  cancelled_refund_pending: (f) => `ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ನಿಮ್ಮ ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ಶೀಘ್ರದಲ್ಲೇ ಖಚಿತಪಡಿಸುತ್ತಾರೆ.`,
  cancelled_late: (f) => `ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ಪ್ರಾರಂಭಕ್ಕೆ ${need(f, "windowHours")} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಸಮಯ ಇರುವುದರಿಂದ, ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣದ ಬಗ್ಗೆ ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿ ನಿಮಗೆ ತಿಳಿಸುತ್ತಾರೆ.`,
  cancelled_no_deposit: (f) => `ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ಯಾವುದೇ ಹಣ ಪಡೆದಿಲ್ಲ.`,
  no_booking_found: () => "ಬದಲಾಯಿಸಲು ಯಾವುದೇ ಬುಕಿಂಗ್ ಸಿಗಲಿಲ್ಲ. ಸೇವೆ, ದಿನ, ಸಮಯ ತಿಳಿಸಿ, ನಾನು ಬುಕ್ ಮಾಡುತ್ತೇನೆ.",
  refund_approved: (f) => `ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಒಪ್ಪಿದ್ದಾರೆ. ${inr(f, "refundInr")} ಮರಳಿ ಬರುತ್ತಿದೆ.`,
  refund_denied: (f) => `${inr(f, "depositInr")} ಮುಂಗಡ ಹಣವನ್ನು ಮರಳಿ ಕೊಡದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ.`,
  rescheduled: (f) => `ಆಯಿತು. ${need(f, "serviceName")} ಹೊಸ ಸಮಯ: ${slot(f)}.`,
  reminder: (f) => `ನೆನಪಿಸುವುದು: ${f.businessName}-ನಲ್ಲಿ ನಿಮ್ಮ ${need(f, "serviceName")} ಬುಕಿಂಗ್ ಸಮಯ: ${slot(f)}.`,
  refund_checking: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇವೆ. ಖಚಿತವಾದ ತಕ್ಷಣ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  refund_expired: (f) => `ಮಾಲೀಕರು ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಬಗ್ಗೆ ಉತ್ತರಿಸಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಅದನ್ನು ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು ${f.businessName} ಅವರನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ.`,
  didnt_understand: () => "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಸೇವೆ, ದಿನ, ಸಮಯ ತಿಳಿಸಿ.",
  voice_note: () => "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ ಕಳುಹಿಸಿ; ನನಗೆ ಈಗ ವಾಯ್ಸ್ ನೋಟ್ ಕೇಳಲು ಆಗುವುದಿಲ್ಲ.",

  owner_refund_needs_approval: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} (${need(f, "serviceName")}, ${slot(f)}) ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್. ${need(f, "approvalHours")} ಗಂಟೆಯೊಳಗೆ "approve ${need(f, "approvalCode")}" ಅಥವಾ "deny ${need(f, "approvalCode")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_cant_confirm: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬುಕಿಂಗ್ ಆಗಿಲ್ಲ. ಅವರ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ದಾಖಲಾಗಿದೆ. ಕ್ಯಾಲೆಂಡರ್ ಮತ್ತೆ ನೋಡಲು "retry ${need(f, "bookingRef")}" ಎಂದು, ಬುಕಿಂಗ್ ರದ್ದು ಮಾಡಿ ಮುಂಗಡ ಹಣ ಹಿಂತಿರುಗಿಸಲು "approve ${need(f, "bookingRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_late_cancellation: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} ಪ್ರಾರಂಭಕ್ಕೆ ${need(f, "windowHours")} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಇರುವಾಗ ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ. ಮುಂಗಡ ${inr(f, "depositInr")}. ಹಿಂತಿರುಗಿಸಲು "approve ${need(f, "bookingRef")}" ಎಂದು, ಇಟ್ಟುಕೊಳ್ಳಲು "deny ${need(f, "bookingRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_duplicate_payment: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} — ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡಲಾಗಿದೆ.`,
  owner_payment_unused: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${slot(f)} ಬುಕಿಂಗ್‌ಗಾಗಿ ${inr(f, "depositInr")} ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಆ ಬುಕಿಂಗ್ ಆಗ ಚಾಲ್ತಿಯಲ್ಲಿ ಇರಲಿಲ್ಲ (ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದಿತ್ತು, ಅಥವಾ ರದ್ದಾಗಿತ್ತು). ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡಲಾಗಿದೆ.`,
  owner_not_booked: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${need(f, "serviceName")}, ${slot(f)} — ಕ್ಯಾಲೆಂಡರ್ ಅಥವಾ ಪಾವತಿ ಲಿಂಕ್ ಕೆಲಸ ಮಾಡಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬುಕಿಂಗ್ ಸಿದ್ಧಪಡಿಸಲು ಆಗಲಿಲ್ಲ. ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ.`,
  owner_reschedule_failed: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${need(f, "serviceName")} — ಹೊಸ ಸಮಯ ${slot(f)} ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರ ಬುಕಿಂಗ್ ಪರಿಶೀಲಿಸಿ.`,
  owner_message_held: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ಕಳುಹಿಸಬೇಕಿದ್ದ ಒಂದು ಸಂದೇಶ ಬುಕಿಂಗ್ ದಾಖಲೆಗೆ ಹೊಂದಿಕೆಯಾಗದ ಕಾರಣ ತಡೆಹಿಡಿಯಲಾಗಿದೆ. ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ.`,
  owner_opted_out: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} STOP ಕಳುಹಿಸಿದ್ದಾರೆ. ಇನ್ನು ಅವರಿಗೆ ಸಂದೇಶಗಳನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  owner_unknown_command: () => `ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. "approve", "deny" ಅಥವಾ "retry" ಎಂದು ಬರೆದು, ನಂತರ ಬುಕಿಂಗ್ ರೆಫರೆನ್ಸ್ ಬರೆಯಿರಿ.`,
  owner_approval_done: (f) => `ಧನ್ಯವಾದ. ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_approval_denied: (f) => `ಅರ್ಥವಾಯಿತು. ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_approval_expired: (f) => `ನೀವು ಉತ್ತರಿಸುವ ಮೊದಲೇ ಆ ವಿನಂತಿಯ ಸಮಯ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಮರಳಿ ಕೊಟ್ಟಿಲ್ಲ: ಗ್ರಾಹಕರು ${need(f, "customerPhone")}, ${inr(f, "refundInr")}.`,
  owner_approval_failed: () => "ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಈಗ ದಾಖಲಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಕಳುಹಿಸಿ.",
};

export const TEMPLATES: Record<Language, TemplateSet> = { en, hi, ml, kn };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
