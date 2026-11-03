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
}

export type TemplateId =
  // to the customer
  | "menu" | "ask_when" | "ask_new_time" | "price_floor" | "confirm_details" | "quote_and_link" | "already_waiting"
  | "slot_unavailable" | "outside_hours" | "hold_failed" | "link_failed" | "booked" | "couldnt_confirm" | "hold_expired"
  | "slot_gone_refund" | "refund_unbooked" | "reschedule_failed" | "duplicate_refund" | "duplicate_refund_pending" | "cancelled_refund" | "cancelled_refund_pending"
  | "cancelled_late" | "cancelled_no_deposit" | "no_booking_found" | "refund_approved" | "refund_denied" | "rescheduled"
  | "reminder" | "didnt_understand"
  // to the owner
  | "owner_refund_needs_approval" | "owner_cant_confirm" | "owner_late_cancellation" | "owner_duplicate_payment"
  | "owner_slot_gone" | "owner_unbooked_payment" | "owner_link_failed" | "owner_hold_failed" | "owner_reschedule_failed"
  | "owner_message_held" | "owner_opted_out" | "owner_unknown_command";

/** Which approved WhatsApp template carries a message once the customer's 24-hour window has closed. */
export const TEMPLATE_NAMES = { customer: "booking_update", reminder: "booking_reminder", owner: "owner_notice" } as const;

type Template = (f: MessageFacts) => string;
type TemplateSet = Record<TemplateId, Template>;

/** A template asks for a value the record does not have: refuse to write the message at all. */
function need<K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> {
  const value = f[key];
  if (value === undefined) throw new Error(`The message needs "${String(key)}" from the record, and the record does not have it.`);
  return value as NonNullable<MessageFacts[K]>;
}
const slot = (f: MessageFacts) => formatSlot(need(f, "slotMs"), f.timeZone, f.language);
const inr = (f: MessageFacts, key: "priceInr" | "depositInr" | "refundInr") => formatInr(need(f, key));
const menuList = (f: MessageFacts) => f.services.map((s) => `${s.name} ${formatInr(s.priceInr)}`).join(", ");

const en: TemplateSet = {
  menu: (f) => `Hello! Welcome to ${f.businessName}. We offer: ${menuList(f)}. Tell me which service, day and time you would like.`,
  ask_when: (f) => `Which day and time would you like for your ${need(f, "serviceName")}?`,
  ask_new_time: () => "Which day and time would you like instead?",
  price_floor: (f) => `Our ${need(f, "serviceName")} is ${inr(f, "priceInr")}, and I can't go lower than that.`,
  confirm_details: (f) => `Just to be sure: ${need(f, "serviceName")} on ${slot(f)}. Reply "yes" to continue.`,
  quote_and_link: (f) => `Our ${need(f, "serviceName")} is ${inr(f, "priceInr")}. ${slot(f)} is free. Pay a ${inr(f, "depositInr")} deposit to confirm: ${need(f, "link")} (I'll hold the slot for ${need(f, "holdMinutes")} minutes.)`,
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

  owner_refund_needs_approval: (f) => `Approval needed: refund ${inr(f, "refundInr")} for ${need(f, "customerPhone")} (${need(f, "serviceName")}, ${slot(f)}). Reply "approve ${need(f, "bookingRef")}" or "deny ${need(f, "bookingRef")}".`,
  owner_cant_confirm: (f) => `Could not confirm ${need(f, "customerPhone")}'s ${need(f, "serviceName")} on ${slot(f)} in the calendar, so it is NOT booked. Their ${inr(f, "depositInr")} deposit is recorded. Reply "retry ${need(f, "bookingRef")}" to check the calendar again, or "approve ${need(f, "bookingRef")}" to cancel it and refund the deposit.`,
  owner_late_cancellation: (f) => `${need(f, "customerPhone")} cancelled ${need(f, "serviceName")} on ${slot(f)} less than ${need(f, "windowHours")} hours before the start. Deposit ${inr(f, "depositInr")}. Reply "approve ${need(f, "bookingRef")}" to refund it or "deny ${need(f, "bookingRef")}" to keep it.`,
  owner_duplicate_payment: (f) => `${need(f, "customerPhone")} paid the deposit twice for ${need(f, "serviceName")} on ${slot(f)}. The extra ${inr(f, "refundInr")} was refunded.`,
  owner_slot_gone: (f) => `A ${inr(f, "depositInr")} payment from ${need(f, "customerPhone")} arrived after the hold on ${slot(f)} ended, and that time was taken. ${inr(f, "refundInr")} was refunded.`,
  owner_unbooked_payment: (f) => `A ${inr(f, "depositInr")} payment from ${need(f, "customerPhone")} arrived for a booking that is no longer active. ${inr(f, "refundInr")} was refunded.`,
  owner_link_failed: (f) => `Could not create a payment link for ${need(f, "customerPhone")}'s ${need(f, "serviceName")} on ${slot(f)}. Nothing is booked.`,
  owner_reschedule_failed: (f) => `Could not confirm moving ${need(f, "customerPhone")}'s ${need(f, "serviceName")} to ${slot(f)} in the calendar. Please check their booking.`,
  owner_hold_failed: (f) => `Could not hold ${slot(f)} in the calendar for ${need(f, "customerPhone")}'s ${need(f, "serviceName")}. Nothing is booked.`,
  owner_message_held: (f) => `A message to ${need(f, "customerPhone")} was held back because it did not match the booking record. Nothing was sent.`,
  owner_opted_out: (f) => `${need(f, "customerPhone")} sent STOP. No more messages will go to them.`,
  owner_unknown_command: () => `I didn't understand that. Reply "approve", "deny" or "retry" followed by the booking reference.`,
};

const hi: TemplateSet = {
  menu: (f) => `नमस्ते! ${f.businessName} में आपका स्वागत है। हमारी सेवाएँ: ${menuList(f)}। बताइए आपको कौन सी सेवा, किस दिन और किस समय चाहिए?`,
  ask_when: (f) => `आपको ${need(f, "serviceName")} के लिए कौन सा दिन और समय चाहिए?`,
  ask_new_time: () => "आपको इसकी जगह कौन सा दिन और समय चाहिए?",
  price_floor: (f) => `हमारा ${need(f, "serviceName")} ${inr(f, "priceInr")} का है, इससे कम में नहीं हो पाएगा।`,
  confirm_details: (f) => `पक्का करने के लिए: ${need(f, "serviceName")}, ${slot(f)}। आगे बढ़ने के लिए "हाँ" लिखें।`,
  quote_and_link: (f) => `हमारा ${need(f, "serviceName")} ${inr(f, "priceInr")} है। ${slot(f)} खाली है। ${inr(f, "depositInr")} जमा करके पक्का करें: ${need(f, "link")} (स्लॉट ${need(f, "holdMinutes")} मिनट के लिए रोका गया है।)`,
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
  didnt_understand: () => "माफ़ कीजिए, मैं समझ नहीं पाया। कृपया सेवा, दिन और समय बताइए।",

  owner_refund_needs_approval: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} (${need(f, "serviceName")}, ${slot(f)}) को ${inr(f, "refundInr")} का रिफंड। जवाब दें "approve ${need(f, "bookingRef")}" या "deny ${need(f, "bookingRef")}"।`,
  owner_cant_confirm: (f) => `${need(f, "customerPhone")} का ${need(f, "serviceName")}, ${slot(f)} कैलेंडर में पक्का नहीं हो पाया, इसलिए बुकिंग पक्की नहीं है। उनका ${inr(f, "depositInr")} जमा दर्ज है। कैलेंडर फिर जाँचने के लिए "retry ${need(f, "bookingRef")}" लिखें, या बुकिंग रद्द करके जमा लौटाने के लिए "approve ${need(f, "bookingRef")}"।`,
  owner_late_cancellation: (f) => `${need(f, "customerPhone")} ने ${need(f, "serviceName")}, ${slot(f)} शुरू होने से ${need(f, "windowHours")} घंटे से कम पहले रद्द किया। जमा ${inr(f, "depositInr")}। लौटाने के लिए "approve ${need(f, "bookingRef")}", रखने के लिए "deny ${need(f, "bookingRef")}" लिखें।`,
  owner_duplicate_payment: (f) => `${need(f, "customerPhone")} ने ${need(f, "serviceName")}, ${slot(f)} के लिए जमा दो बार भरा। अतिरिक्त ${inr(f, "refundInr")} वापस कर दिया गया।`,
  owner_slot_gone: (f) => `${need(f, "customerPhone")} का ${inr(f, "depositInr")} का भुगतान ${slot(f)} का स्लॉट छूटने के बाद आया और वह समय किसी और को मिल गया। ${inr(f, "refundInr")} वापस कर दिया गया।`,
  owner_unbooked_payment: (f) => `${need(f, "customerPhone")} का ${inr(f, "depositInr")} का भुगतान ऐसी बुकिंग के लिए आया जो अब चालू नहीं है। ${inr(f, "refundInr")} वापस कर दिया गया।`,
  owner_link_failed: (f) => `${need(f, "customerPhone")} के ${need(f, "serviceName")}, ${slot(f)} के लिए पेमेंट लिंक नहीं बन पाया। कुछ भी बुक नहीं हुआ।`,
  owner_reschedule_failed: (f) => `${need(f, "customerPhone")} का ${need(f, "serviceName")} कैलेंडर में ${slot(f)} पर ले जाना पक्का नहीं हो पाया। कृपया उनकी बुकिंग जाँच लें।`,
  owner_hold_failed: (f) => `${need(f, "customerPhone")} के ${need(f, "serviceName")} के लिए कैलेंडर में ${slot(f)} रोका नहीं जा सका। कुछ भी बुक नहीं हुआ।`,
  owner_message_held: (f) => `${need(f, "customerPhone")} को जाने वाला एक संदेश रोक दिया गया क्योंकि वह बुकिंग रिकॉर्ड से मेल नहीं खाता था। कुछ नहीं भेजा गया।`,
  owner_opted_out: (f) => `${need(f, "customerPhone")} ने STOP भेजा है। अब उन्हें कोई संदेश नहीं जाएगा।`,
  owner_unknown_command: () => `मैं समझ नहीं पाया। "approve", "deny" या "retry" लिखें और उसके बाद बुकिंग का रेफ़रेंस।`,
};

export const TEMPLATES: Record<Language, TemplateSet> = { en, hi };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
