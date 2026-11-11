// Every message the agent sends, per language. v0 has NO model-written text: each message is one of these templates,
// and every amount, date, time, service and link in it is rendered from the record (the facts), never typed by hand
// and never translated. Adding a language means adding one more object below; the type makes sure none is missing.
import type { Language } from "../../../../../modules/language/languages.ts";
import { formatInr, formatSlot } from "../../../../../modules/language/format.ts";

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
  /** The free times a list message offers, when it offers any (language/interactive.ts): each date and time in the message must be one of these, or the booking's own. */
  slotChoices?: number[];
  link?: string; // the payment link from the payments service's record
  holdMinutes?: number;
  windowHours?: number;
  bookingRef?: string; // "b-3"
  customerPhone?: string;
  /** The one-use code the owner sends back to approve or deny a refund Guard is holding (never the booking ref). Made by the approvals relay. */
  approvalCode?: string;
  /** How many hours the owner has to answer. */
  approvalHours?: number;
  /** A refund that needs several people (B37): how many more approvals it waits for after this person's. Made by the approvals relay from Guard's answer. */
  approvalsLeft?: number;
  /** UPI shops (B33): the shop's UPI ID and the name its customers see. */
  upiId?: string;
  payee?: string;
  /** UPI: the owner's one-use code for this payment or refund (modules/payments/owner-marked/ledger.ts). Only ever in a message to the owner. */
  upiCode?: string;
  /** UPI: what the owner marked received, and what is still to come, in whole rupees. */
  markedInr?: number;
  leftInr?: number;
  /** The licence's service notices (B13): who the owner should contact (the partner who set the shop up), and the count the final stop's notice states. */
  partner?: string;
  upcomingCount?: number;
}

export type TemplateId =
  // to the customer
  | "menu" | "ask_when" | "ask_new_time" | "price_floor" | "confirm_details" | "quote_and_link" | "slot_and_link" | "already_waiting"
  | "slot_unavailable" | "outside_hours" | "hold_failed" | "link_failed" | "booked" | "couldnt_confirm" | "hold_expired"
  | "slot_gone_refund" | "refund_unbooked" | "reschedule_failed" | "duplicate_refund" | "duplicate_refund_pending" | "cancelled_refund" | "cancelled_refund_pending"
  | "cancelled_late" | "cancelled_no_deposit" | "no_booking_found" | "refund_approved" | "refund_denied" | "rescheduled"
  | "reminder" | "didnt_understand" | "refund_checking" | "refund_expired" | "voice_note"
  // the turns that come with buttons or a list (language/interactive.ts): pick a service, pick a time, are you sure, "talk to the owner"
  | "pick_service" | "pick_slot" | "confirm_buttons" | "ask_cancel" | "kept" | "told_owner" | "couldnt_tell_owner"
  // to the owner. Every line starts and ends with fixed words, because each one is also a WhatsApp template (meta-templates.ts) and
  // Meta rejects a body that starts or ends with a value. The one exception is the reply to the owner's own message, which needs no template.
  | "owner_refund_needs_approval" | "owner_cant_confirm" | "owner_late_cancellation" | "owner_duplicate_payment"
  | "owner_payment_unused" | "owner_not_booked" | "owner_reschedule_failed"
  | "owner_message_held" | "owner_opted_out" | "owner_unknown_command" | "owner_wants_to_talk"
  // button mode: the agent reads with the rules only and answers with buttons and lists (modules/understanding/ai-state.ts). Each says why, and that every limit still holds.
  | "owner_ai_allowance" | "owner_ai_off" | "owner_ai_fault"
  // sent by the approvals relay, not by the agent: the ask for a refund Guard is holding, and the answers to the owner's reply
  | "owner_approval_done" | "owner_approval_denied" | "owner_approval_expired" | "owner_approval_failed"
  // the relay again, when a refund needs several people (B37): this person's approval is in and more are needed; the others approved it; one person refused it
  | "owner_approval_waiting" | "owner_approval_closed" | "owner_approval_refused"
  // the agent: a person at the server settled an uncertain refund as made (Guard's already_done), so it is done and not sent again
  | "owner_refund_settled"
  | UpiTemplateId | LicenceTemplateId | GuardWaitTemplateId;

/**
 * The licence's wind-down and final stop (plan B13; modules/licence). The customer's line answers a request for new work while online booking is paused; the owner's
 * two are the one service notice for each `paid_through` (WhatsApp utility templates). About the service, never about money; they name who to contact.
 */
export type LicenceTemplateId = "booking_paused" | "owner_licence_paused" | "owner_licence_stopped";

/**
 * The wait for a Guard is over (modules/runtime/guard-wait.ts, 15 minutes from the message) and this message's work was not done: the customer hears that it was
 * not finished, that the booking system is not answering, that the message is on the owner's to-do list (the record line the panel's list reads, `message_unanswered`),
 * and to write again later or contact the shop. Nothing more is promised: nobody is messaged by the code and nothing is tried again by itself (11 Nov 2026).
 */
export type GuardWaitTemplateId = "wait_over";

/** UPI shops only (B33): the deposit is paid to the shop's own UPI ID and marked paid by the owner; refunds are sent by the owner. */
export type UpiTemplateId =
  | "upi_quote_and_link" | "upi_slot_and_link" | "upi_already_waiting" | "upi_qr_caption" | "upi_booked" | "upi_paid_claim" | "upi_nothing_waiting" | "upi_hold_expired"
  | "upi_late_received" | "upi_refund_owed" | "upi_cancelled_refund_owed" | "upi_extra_refund_owed" | "upi_refund_sent"
  | "owner_upi_expected" | "owner_upi_claim" | "owner_upi_marked" | "owner_upi_part" | "owner_upi_already" | "owner_upi_unknown" | "owner_upi_late"
  | "owner_upi_refund_owed" | "owner_upi_refund_reminder" | "owner_upi_refund_marked" | "owner_upi_refund_kept";

/** Which approved WhatsApp template carries a message once the customer's 24-hour window has closed. */
export const TEMPLATE_NAMES = { customer: "booking_update", reminder: "booking_reminder", owner: "owner_notice" } as const;

type Template = (f: MessageFacts) => string;
type TemplateSet = Record<TemplateId, Template>;
type BaseSet = Record<Exclude<TemplateId, UpiTemplateId | GuardWaitTemplateId>, Template>;
type UpiSet = Record<UpiTemplateId, Template>;
type LicenceSet = Record<LicenceTemplateId, Template>;
type GuardWaitSet = Record<GuardWaitTemplateId, Template>;

/** A template asks for a value the record does not have: refuse to write the message at all. */
export function need<K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> {
  const value = f[key];
  if (value === undefined) throw new Error(`The message needs "${String(key)}" from the record, and the record does not have it.`);
  return value as NonNullable<MessageFacts[K]>;
}
export const slot = (f: MessageFacts) => formatSlot(need(f, "slotMs"), f.timeZone, f.language);
export const inr = (f: MessageFacts, key: "priceInr" | "depositInr" | "refundInr") => formatInr(need(f, key));
const menuList = (f: MessageFacts) => f.services.map((s) => `${s.name} ${formatInr(s.priceInr)}`).join(", ");

const en: BaseSet = {
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
  pick_service: (f) => `Hello! Welcome to ${f.businessName}. Which service would you like?`,
  pick_slot: (f) => `When would you like your ${need(f, "serviceName")}? Pick a time below, or write the day and time you prefer.`,
  confirm_buttons: (f) => `Just to be sure: ${need(f, "serviceName")} on ${slot(f)}. Is that right?`,
  ask_cancel: (f) => `Do you want to cancel your booking for ${slot(f)}?`,
  kept: (f) => `Okay, your booking for ${slot(f)} stays as it is.`,
  told_owner: () => "I've told the owner that you would like to talk. They will message you here.",
  couldnt_tell_owner: () => "Sorry, I couldn't reach the owner just now. Please try again in a few minutes.",
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
  owner_approval_waiting: (f) => `Thank you. Your approval of the ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} is recorded. Approvals still needed from the others: ${need(f, "approvalsLeft")}. It is sent only once they are given.`,
  owner_approval_closed: (f) => `The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} has been approved by the others, so your answer is no longer needed. Thank you.`,
  owner_approval_refused: (f) => `The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} was refused by one of the people who approve refunds, so it will not be sent, and they will be told.`,
  owner_refund_settled: (f) => `Refund done: ${inr(f, "refundInr")} for ${need(f, "customerPhone")}. The person who set up your agent checked it and marked it as made, so it is not sent a second time.`,
  owner_wants_to_talk: (f) => `Customer ${need(f, "customerPhone")} would like to talk to you. Please message them.`,
  owner_ai_allowance: (f) => `Notice: this month's AI allowance for ${f.businessName} is used up, so the agent now answers with buttons and lists. It still books, and every limit still holds. The person who set it up has been told. Normal service returns next month.`,
  owner_ai_off: (f) => `Notice: the AI that reads messages for ${f.businessName} has been switched off for now. The agent keeps booking with buttons and lists, and every limit still holds. The person who set it up has been told.`,
  owner_ai_fault: (f) => `Notice: the AI that reads messages for ${f.businessName} is not answering right now, so the agent is using buttons and lists. It still books, and every limit still holds. It will try the AI again in a few minutes.`,
};

const hi: BaseSet = {
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
  pick_service: (f) => `नमस्ते! ${f.businessName} में आपका स्वागत है। आपको कौन सी सेवा चाहिए?`,
  pick_slot: (f) => `आपको ${need(f, "serviceName")} के लिए कब आना है? नीचे से समय चुनिए, या अपना पसंदीदा दिन और समय लिखिए।`,
  confirm_buttons: (f) => `पक्का करने के लिए: ${need(f, "serviceName")}, ${slot(f)}। क्या यह सही है?`,
  ask_cancel: (f) => `क्या आप ${slot(f)} की अपनी बुकिंग रद्द करना चाहते हैं?`,
  kept: (f) => `ठीक है, ${slot(f)} की आपकी बुकिंग जैसी थी वैसी ही रहेगी।`,
  told_owner: () => "मैंने मालिक को बता दिया है कि आप बात करना चाहते हैं। वे आपको यहीं संदेश भेजेंगे।",
  couldnt_tell_owner: () => "माफ़ कीजिए, अभी मालिक तक संदेश नहीं पहुँचा पाया। कृपया कुछ मिनट बाद फिर कोशिश करें।",

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
  owner_approval_waiting: (f) => `धन्यवाद। ${need(f, "customerPhone")} को ${inr(f, "refundInr")} के रिफंड पर आपकी मंज़ूरी दर्ज हो गई है। दूसरों से अभी इतनी मंज़ूरी और चाहिए: ${need(f, "approvalsLeft")}। वे मिलने पर ही रिफंड भेजा जाएगा।`,
  owner_approval_closed: (f) => `सूचना: ${need(f, "customerPhone")} को ${inr(f, "refundInr")} के रिफंड को दूसरों ने मंज़ूरी दे दी है, इसलिए अब आपके जवाब की ज़रूरत नहीं है। धन्यवाद।`,
  owner_approval_refused: (f) => `सूचना: ${need(f, "customerPhone")} को ${inr(f, "refundInr")} के रिफंड को मंज़ूरी देने वालों में से एक ने मना कर दिया है, इसलिए यह नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा।`,
  owner_refund_settled: (f) => `रिफंड हो गया: ${need(f, "customerPhone")} को ${inr(f, "refundInr")}। आपका एजेंट सेट करने वाले व्यक्ति ने इसे जाँचकर पूरा हुआ दर्ज किया है, इसलिए यह दोबारा नहीं भेजा जाएगा।`,
  owner_wants_to_talk: (f) => `ग्राहक ${need(f, "customerPhone")} आपसे बात करना चाहते हैं। कृपया उन्हें संदेश भेजें।`,
  owner_ai_allowance: (f) => `सूचना: ${f.businessName} के लिए इस महीने का AI कोटा पूरा हो गया है, इसलिए एजेंट अब बटन और सूचियों से जवाब देगा। बुकिंग फिर भी होगी और हर सीमा पहले की तरह लागू रहेगी। जिसने इसे सेट किया है उसे बता दिया गया है। अगले महीने सामान्य सेवा फिर शुरू होगी।`,
  owner_ai_off: (f) => `सूचना: ${f.businessName} के संदेश पढ़ने वाला AI अभी बंद कर दिया गया है। एजेंट बटन और सूचियों से बुकिंग करता रहेगा और हर सीमा पहले की तरह लागू रहेगी। जिसने इसे सेट किया है उसे बता दिया गया है।`,
  owner_ai_fault: (f) => `सूचना: ${f.businessName} के संदेश पढ़ने वाला AI अभी जवाब नहीं दे रहा है, इसलिए एजेंट बटन और सूचियों से काम कर रहा है। बुकिंग फिर भी होगी और हर सीमा पहले की तरह लागू रहेगी। कुछ मिनट बाद एजेंट फिर AI आज़माएगा।`,
};

// Malayalam and Kannada. Machine-written: a native speaker must read every line (REVIEW-ml.md, REVIEW-kn.md) before a real
// shop uses them. Choices that keep them safe for any shop: no service name or business name gets a case ending glued on
// (so "ഹെയർകട്ട് വില ₹450", "ಹೇರ್ ಕಟ್ ಬೆಲೆ ₹450", never a form that depends on the name's last letter), the date and time are
// written as a unit or in brackets, and owner commands stay in Latin letters ("approve b-3") with the meaning in the owner's language.
const ml: BaseSet = {
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
  pick_service: (f) => `നമസ്കാരം! ${f.businessName}-ലേക്ക് സ്വാഗതം. ഏത് സേവനമാണ് വേണ്ടത്?`,
  pick_slot: (f) => `${need(f, "serviceName")} എപ്പോൾ വേണം? താഴെ നിന്ന് ഒരു സമയം തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ ഇഷ്ടമുള്ള ദിവസവും സമയവും എഴുതൂ.`,
  confirm_buttons: (f) => `ഉറപ്പിക്കാൻ: ${need(f, "serviceName")}, ${slot(f)}. ഇത് ശരിയാണോ?`,
  ask_cancel: (f) => `${slot(f)} ലെ നിങ്ങളുടെ ബുക്കിംഗ് റദ്ദാക്കണോ?`,
  kept: (f) => `ശരി, ${slot(f)} ലെ നിങ്ങളുടെ ബുക്കിംഗ് അതുപോലെ തന്നെ തുടരും.`,
  told_owner: () => "നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ തന്നെ നിങ്ങൾക്ക് സന്ദേശം അയയ്ക്കും.",
  couldnt_tell_owner: () => "ക്ഷമിക്കണം, ഇപ്പോൾ ഉടമയെ അറിയിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.",

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
  owner_approval_waiting: (f) => `നന്ദി. ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${inr(f, "refundInr")} റീഫണ്ടിനുള്ള നിങ്ങളുടെ അനുമതി രേഖപ്പെടുത്തി. ഇനി മറ്റുള്ളവരിൽ നിന്ന് വേണ്ട അനുമതികൾ: ${need(f, "approvalsLeft")}. അവ ലഭിച്ച ശേഷമേ ഇത് അയയ്ക്കൂ.`,
  owner_approval_closed: (f) => `അറിയിപ്പ്: ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${inr(f, "refundInr")} റീഫണ്ടിന് മറ്റുള്ളവർ അനുമതി നൽകി, അതിനാൽ ഇനി നിങ്ങളുടെ മറുപടി ആവശ്യമില്ല. നന്ദി.`,
  owner_approval_refused: (f) => `അറിയിപ്പ്: ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${inr(f, "refundInr")} റീഫണ്ട് അനുമതി നൽകുന്നവരിൽ ഒരാൾ നിരസിച്ചു, അതിനാൽ ഇത് അയയ്ക്കില്ല, അവരെ അറിയിക്കും.`,
  owner_refund_settled: (f) => `റീഫണ്ട് പൂർത്തിയായി: ഉപഭോക്താവ് ${need(f, "customerPhone")}, ${inr(f, "refundInr")}. നിങ്ങളുടെ ഏജന്റ് ക്രമീകരിച്ച വ്യക്തി ഇത് പരിശോധിച്ച് നടന്നതായി രേഖപ്പെടുത്തി, അതിനാൽ ഇത് വീണ്ടും അയയ്ക്കില്ല.`,
  owner_wants_to_talk: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")} നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_ai_allowance: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഈ മാസത്തെ AI പരിധി തീർന്നു, അതിനാൽ ഏജന്റ് ഇനി ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് മറുപടി നൽകും. ബുക്കിംഗ് തുടർന്നും നടക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ തന്നെ പാലിക്കും. ഇത് ക്രമീകരിച്ച വ്യക്തിയെ അറിയിച്ചിട്ടുണ്ട്. അടുത്ത മാസം സാധാരണ സേവനം തിരിച്ചെത്തും.`,
  owner_ai_off: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI തൽക്കാലം ഓഫ് ചെയ്തിരിക്കുന്നു. ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് ബുക്കിംഗ് തുടരും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ തന്നെ പാലിക്കും. ഇത് ക്രമീകരിച്ച വ്യക്തിയെ അറിയിച്ചിട്ടുണ്ട്.`,
  owner_ai_fault: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI ഇപ്പോൾ മറുപടി നൽകുന്നില്ല, അതിനാൽ ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിക്കുന്നു. ബുക്കിംഗ് തുടർന്നും നടക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ തന്നെ പാലിക്കും. കുറച്ച് മിനിറ്റിനു ശേഷം ഏജന്റ് വീണ്ടും AI പരീക്ഷിക്കും.`,
};

const kn: BaseSet = {
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
  pick_service: (f) => `ನಮಸ್ಕಾರ! ${f.businessName}-ಗೆ ಸ್ವಾಗತ. ಯಾವ ಸೇವೆ ಬೇಕು?`,
  pick_slot: (f) => `${need(f, "serviceName")} ಯಾವಾಗ ಬೇಕು? ಕೆಳಗಿನಿಂದ ಒಂದು ಸಮಯ ಆಯ್ಕೆಮಾಡಿ, ಅಥವಾ ನಿಮಗೆ ಇಷ್ಟವಾದ ದಿನ ಮತ್ತು ಸಮಯ ಬರೆಯಿರಿ.`,
  confirm_buttons: (f) => `ಖಚಿತಪಡಿಸಲು: ${need(f, "serviceName")}, ${slot(f)}. ಇದು ಸರಿಯೇ?`,
  ask_cancel: (f) => `${slot(f)} ರ ನಿಮ್ಮ ಬುಕಿಂಗ್ ರದ್ದು ಮಾಡಬೇಕೇ?`,
  kept: (f) => `ಸರಿ, ${slot(f)} ರ ನಿಮ್ಮ ಬುಕಿಂಗ್ ಹಾಗೆಯೇ ಇರುತ್ತದೆ.`,
  told_owner: () => "ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.",
  couldnt_tell_owner: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",

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
  owner_approval_waiting: (f) => `ಧನ್ಯವಾದ. ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${inr(f, "refundInr")} ರೀಫಂಡ್‌ಗೆ ನಿಮ್ಮ ಅನುಮತಿ ದಾಖಲಾಗಿದೆ. ಇನ್ನೂ ಇತರರಿಂದ ಬೇಕಾದ ಅನುಮತಿಗಳು: ${need(f, "approvalsLeft")}. ಅವು ಸಿಕ್ಕ ನಂತರವೇ ಇದನ್ನು ಕಳುಹಿಸಲಾಗುವುದು.`,
  owner_approval_closed: (f) => `ಸೂಚನೆ: ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${inr(f, "refundInr")} ರೀಫಂಡ್‌ಗೆ ಇತರರು ಅನುಮತಿ ನೀಡಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಈಗ ನಿಮ್ಮ ಉತ್ತರ ಬೇಕಿಲ್ಲ. ಧನ್ಯವಾದ.`,
  owner_approval_refused: (f) => `ಸೂಚನೆ: ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಅನುಮತಿ ನೀಡುವವರಲ್ಲಿ ಒಬ್ಬರು ನಿರಾಕರಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_refund_settled: (f) => `ರೀಫಂಡ್ ಆಗಿದೆ: ಗ್ರಾಹಕರು ${need(f, "customerPhone")}, ${inr(f, "refundInr")}. ನಿಮ್ಮ ಏಜೆಂಟ್ ಅನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರು ಇದನ್ನು ಪರಿಶೀಲಿಸಿ ಆಗಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಮತ್ತೆ ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  owner_wants_to_talk: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_ai_allowance: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಈ ತಿಂಗಳ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಈಗ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳ ಮೂಲಕ ಉತ್ತರಿಸುತ್ತದೆ. ಬುಕಿಂಗ್ ಮುಂದುವರಿಯುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಸಾಮಾನ್ಯ ಸೇವೆ ಮರಳುತ್ತದೆ.`,
  owner_ai_off: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಸದ್ಯಕ್ಕೆ ಆಫ್ ಮಾಡಲಾಗಿದೆ. ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳಿಂದ ಬುಕಿಂಗ್ ಮುಂದುವರಿಸುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
  owner_ai_fault: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳನ್ನು ಬಳಸುತ್ತಿದೆ. ಬುಕಿಂಗ್ ಮುಂದುವರಿಯುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಏಜೆಂಟ್ ಮತ್ತೆ AI ಪ್ರಯತ್ನಿಸುತ್ತದೆ.`,
};

// ---- UPI, marked paid by the owner (plan B33; modules/payments/owner-marked) ------------------------------------------------------------
// A shop that takes UPI: the customer pays the shop's own UPI ID, and the booking is made only when the owner taps "Received" (or replies "received <code>"). These
// messages never say a payment was checked by the agent: the owner confirms it. A refund is sent by the owner from their own UPI app, and the customer hears "sent"
// only after the owner marks it so. The owner's lines start and end with fixed words, as every owner line does (several are WhatsApp templates: meta-templates.ts).
// Hindi, Malayalam and Kannada are machine-written, like the rest of those packs, and wait for a native speaker's review (REVIEW-ml.md, REVIEW-kn.md).

const payee = (f: MessageFacts) => need(f, "payee");
const upiId = (f: MessageFacts) => need(f, "upiId");
const code = (f: MessageFacts) => need(f, "upiCode");
const marked = (f: MessageFacts) => formatInr(need(f, "markedInr"));
const left = (f: MessageFacts) => formatInr(need(f, "leftInr"));

const upiEn: UpiSet = {
  upi_quote_and_link: (f) => `Our ${need(f, "serviceName")} is ${inr(f, "priceInr")}. ${slot(f)} is free. To confirm, pay the ${inr(f, "depositInr")} deposit by UPI to ${payee(f)} (UPI ID ${upiId(f)}): ${need(f, "link")} I'll hold the slot for ${need(f, "holdMinutes")} minutes. The owner confirms the payment, then I'll message you.`,
  upi_slot_and_link: (f) => `${slot(f)} is free. To confirm, pay the ${inr(f, "depositInr")} deposit by UPI to ${payee(f)} (UPI ID ${upiId(f)}): ${need(f, "link")} I'll hold the slot for ${need(f, "holdMinutes")} minutes. The owner confirms the payment, then I'll message you.`,
  upi_already_waiting: (f) => `Your slot (${slot(f)}) is held. Pay the ${inr(f, "depositInr")} deposit by UPI to ${payee(f)} (UPI ID ${upiId(f)}): ${need(f, "link")} The owner confirms the payment, then I'll message you.`,
  upi_qr_caption: (f) => `Scan to pay ${inr(f, "depositInr")} by UPI to ${payee(f)} for booking ${need(f, "bookingRef")}.`,
  upi_booked: (f) => `Booked! ${need(f, "serviceName")} on ${slot(f)}. The owner has confirmed your ${inr(f, "depositInr")} deposit. Cancel at least ${need(f, "windowHours")} hours before the start for a refund.`,
  upi_paid_claim: (f) => `Thank you. The owner will look for your ${inr(f, "depositInr")} payment in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message.`,
  upi_nothing_waiting: () => "Thank you. No UPI payment is waiting for you just now, so there is nothing for the owner to confirm. If you paid for something else, please talk to the owner.",
  upi_hold_expired: (f) => `The hold on ${slot(f)} has ended because the owner had not confirmed the deposit in time. If you have already paid, the owner will contact you. Message me if you'd still like to book.`,
  upi_late_received: (f) => `The owner confirmed your ${marked(f)} payment after the hold on ${slot(f)} had ended, so it is not booked. The owner will contact you about booking again or sending the money back.`,
  upi_refund_owed: (f) => `The owner will send ${inr(f, "refundInr")} back to you by UPI. I'll message you when they mark it sent.`,
  upi_cancelled_refund_owed: (f) => `Your booking for ${slot(f)} is cancelled. The owner will send your ${inr(f, "refundInr")} back to you by UPI, and I'll message you when they mark it sent.`,
  upi_extra_refund_owed: (f) => `You paid more than the deposit. The owner will send the extra ${inr(f, "refundInr")} back to you by UPI, and I'll message you when they mark it sent.`,
  upi_refund_sent: (f) => `The owner has marked your ${inr(f, "refundInr")} refund for booking ${need(f, "bookingRef")} as sent by UPI. Please check your UPI app.`,

  owner_upi_expected: (f) => `UPI payment to check: customer ${need(f, "customerPhone")} will pay the ${inr(f, "depositInr")} deposit for ${need(f, "serviceName")} on ${slot(f)} (booking ${need(f, "bookingRef")}). When it shows in your UPI app, tap Received or reply "received ${code(f)}". If a different amount came, reply "received ${code(f)}" and the amount.`,
  owner_upi_claim: (f) => `Customer ${need(f, "customerPhone")} says they have paid the ${inr(f, "depositInr")} deposit for booking ${need(f, "bookingRef")}. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received ${code(f)}".`,
  owner_upi_marked: (f) => `Thank you. ${marked(f)} for booking ${need(f, "bookingRef")} is marked paid by you.`,
  owner_upi_part: (f) => `You marked ${marked(f)} for booking ${need(f, "bookingRef")}, but the deposit is ${inr(f, "depositInr")}, so it is not booked yet. The slot stays held until the hold ends. When the other ${left(f)} arrives, tap Received or reply "received ${code(f)}".`,
  owner_upi_already: () => "That payment is already marked. It is counted once.",
  owner_upi_unknown: () => "I don't know that code. Please use the code in my latest message about the payment.",
  owner_upi_late: (f) => `You marked ${marked(f)} received for booking ${need(f, "bookingRef")} after its hold had ended, so it was not booked again by itself. Book customer ${need(f, "customerPhone")} again yourself, or send the ${inr(f, "refundInr")} back by UPI. Then tap Refund sent or Kept for booking, or reply "refunded ${code(f)}" or "kept ${code(f)}".`,
  owner_upi_refund_owed: (f) => `Refund to send: ${inr(f, "refundInr")} by UPI to customer ${need(f, "customerPhone")} (booking ${need(f, "bookingRef")}). The agent never sends money. When you have sent it, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_upi_refund_reminder: (f) => `Reminder: ${inr(f, "refundInr")} is still owed back to customer ${need(f, "customerPhone")} (booking ${need(f, "bookingRef")}). When you have sent it by UPI, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_upi_refund_marked: (f) => `Thank you. The ${inr(f, "refundInr")} refund for booking ${need(f, "bookingRef")} is marked sent, and the customer has been told.`,
  owner_upi_refund_kept: (f) => `Noted. The ${inr(f, "refundInr")} for booking ${need(f, "bookingRef")} is kept for a booking you make yourself. Nothing more is owed back.`,
};

const upiHi: UpiSet = {
  upi_quote_and_link: (f) => `हमारा ${need(f, "serviceName")} ${inr(f, "priceInr")} है। ${slot(f)} खाली है। पक्का करने के लिए ${inr(f, "depositInr")} जमा UPI से ${payee(f)} (UPI ID ${upiId(f)}) को भेजें: ${need(f, "link")} स्लॉट ${need(f, "holdMinutes")} मिनट के लिए रोका गया है। पैसे आने पर मालिक पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा।`,
  upi_slot_and_link: (f) => `${slot(f)} खाली है। पक्का करने के लिए ${inr(f, "depositInr")} जमा UPI से ${payee(f)} (UPI ID ${upiId(f)}) को भेजें: ${need(f, "link")} स्लॉट ${need(f, "holdMinutes")} मिनट के लिए रोका गया है। पैसे आने पर मालिक पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा।`,
  upi_already_waiting: (f) => `आपका स्लॉट (${slot(f)}) रोका हुआ है। ${inr(f, "depositInr")} जमा UPI से ${payee(f)} (UPI ID ${upiId(f)}) को भेजें: ${need(f, "link")} पैसे आने पर मालिक पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा।`,
  upi_qr_caption: (f) => `बुकिंग ${need(f, "bookingRef")} के लिए ${payee(f)} को UPI से ${inr(f, "depositInr")} भेजने के लिए स्कैन करें।`,
  upi_booked: (f) => `बुक हो गया! ${need(f, "serviceName")}, ${slot(f)}। मालिक ने आपका ${inr(f, "depositInr")} जमा पक्का कर दिया है। रिफंड के लिए शुरू होने से कम से कम ${need(f, "windowHours")} घंटे पहले रद्द करें।`,
  upi_paid_claim: (f) => `धन्यवाद। मालिक अपने UPI ऐप में आपका ${inr(f, "depositInr")} देखकर पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा। स्क्रीनशॉट पेमेंट का सबूत नहीं है, इसलिए कृपया उस संदेश का इंतज़ार करें।`,
  upi_nothing_waiting: () => "धन्यवाद। अभी आपका कोई UPI पेमेंट बाकी नहीं है, इसलिए मालिक के पास पक्का करने को कुछ नहीं है। अगर आपने किसी और चीज़ के लिए पैसे भेजे हैं, तो कृपया मालिक से बात करें।",
  upi_hold_expired: (f) => `${slot(f)} की रोक खत्म हो गई, क्योंकि मालिक ने समय पर जमा पक्का नहीं किया। अगर आप पैसे भेज चुके हैं, तो मालिक आपसे संपर्क करेंगे। अगर आप अब भी बुक करना चाहते हैं, तो मुझे संदेश भेजें।`,
  upi_late_received: (f) => `मालिक ने आपका ${marked(f)} पेमेंट ${slot(f)} की रोक खत्म होने के बाद पक्का किया, इसलिए बुकिंग नहीं हुई है। मालिक आपसे दोबारा बुकिंग या पैसे वापस भेजने के बारे में बात करेंगे।`,
  upi_refund_owed: (f) => `मालिक ${inr(f, "refundInr")} UPI से आपको वापस भेजेंगे। जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  upi_cancelled_refund_owed: (f) => `${slot(f)} की आपकी बुकिंग रद्द हो गई है। मालिक आपका ${inr(f, "refundInr")} UPI से वापस भेजेंगे, और जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  upi_extra_refund_owed: (f) => `आपने जमा से ज़्यादा पैसे भेजे हैं। मालिक ज़्यादा भेजे गए ${inr(f, "refundInr")} UPI से वापस भेजेंगे, और जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  upi_refund_sent: (f) => `मालिक ने बुकिंग ${need(f, "bookingRef")} का आपका ${inr(f, "refundInr")} रिफंड UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देखें।`,

  owner_upi_expected: (f) => `जाँचने के लिए UPI पेमेंट: ग्राहक ${need(f, "customerPhone")} बुकिंग ${need(f, "bookingRef")} (${need(f, "serviceName")}, ${slot(f)}) के लिए ${inr(f, "depositInr")} जमा भेजेंगे। जब यह आपके UPI ऐप में दिखे, तो "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें। अगर कोई और रकम आई है, तो "received ${code(f)}" के बाद रकम लिखें।`,
  owner_upi_claim: (f) => `ग्राहक ${need(f, "customerPhone")} कह रहे हैं कि उन्होंने बुकिंग ${need(f, "bookingRef")} का ${inr(f, "depositInr")} जमा भेज दिया है। स्क्रीनशॉट सबूत नहीं है: अपना UPI ऐप देखें। पैसे दिखें तो "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें।`,
  owner_upi_marked: (f) => `धन्यवाद। बुकिंग ${need(f, "bookingRef")} के ${marked(f)} आपने मिला हुआ दर्ज किया है।`,
  owner_upi_part: (f) => `आपने बुकिंग ${need(f, "bookingRef")} के लिए ${marked(f)} दर्ज किया, पर जमा ${inr(f, "depositInr")} है, इसलिए अभी बुकिंग नहीं हुई। रोक का समय खत्म होने तक स्लॉट रुका रहेगा। बाकी ${left(f)} आने पर "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें।`,
  owner_upi_already: () => "यह पेमेंट पहले ही दर्ज है। इसे एक ही बार गिना गया है।",
  owner_upi_unknown: () => "मैं यह कोड नहीं पहचानता। कृपया उस पेमेंट के बारे में मेरे सबसे नए संदेश वाला कोड इस्तेमाल करें।",
  owner_upi_late: (f) => `आपने बुकिंग ${need(f, "bookingRef")} के ${marked(f)} उसकी रोक खत्म होने के बाद दर्ज किए, इसलिए बुकिंग अपने-आप दोबारा नहीं हुई। ग्राहक ${need(f, "customerPhone")} की बुकिंग खुद दोबारा करें, या ${inr(f, "refundInr")} UPI से वापस भेजें। फिर "रिफंड भेज दिया" या "बुकिंग के लिए रखा" दबाएँ, या "refunded ${code(f)}" या "kept ${code(f)}" लिखकर भेजें।`,
  owner_upi_refund_owed: (f) => `वापस भेजना है: ग्राहक ${need(f, "customerPhone")} (बुकिंग ${need(f, "bookingRef")}) को UPI से ${inr(f, "refundInr")}। एजेंट कभी पैसे नहीं भेजता। भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded ${code(f)}" लिखकर भेजें।`,
  owner_upi_refund_reminder: (f) => `याद दिलाना: ग्राहक ${need(f, "customerPhone")} (बुकिंग ${need(f, "bookingRef")}) को ${inr(f, "refundInr")} अभी भी वापस देना है। UPI से भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded ${code(f)}" लिखकर भेजें।`,
  owner_upi_refund_marked: (f) => `धन्यवाद। बुकिंग ${need(f, "bookingRef")} का ${inr(f, "refundInr")} रिफंड भेजा हुआ दर्ज हो गया है, और ग्राहक को बता दिया गया है।`,
  owner_upi_refund_kept: (f) => `ठीक है। बुकिंग ${need(f, "bookingRef")} के ${inr(f, "refundInr")} आपकी खुद की हुई बुकिंग के लिए रखे गए हैं। अब कुछ वापस देना बाकी नहीं है।`,
};

const upiMl: UpiSet = {
  upi_quote_and_link: (f) => `ഞങ്ങളുടെ ${need(f, "serviceName")} ${inr(f, "priceInr")} ആണ്. ${slot(f)} ഒഴിവാണ്. ഉറപ്പിക്കാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് UPI വഴി ${payee(f)}-ന് (UPI ID ${upiId(f)}) അയക്കൂ: ${need(f, "link")} സ്ലോട്ട് ${need(f, "holdMinutes")} മിനിറ്റ് പിടിച്ചുവെക്കും. പണം എത്തുമ്പോൾ ഉടമ ഉറപ്പിക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയക്കും.`,
  upi_slot_and_link: (f) => `${slot(f)} ഒഴിവാണ്. ഉറപ്പിക്കാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് UPI വഴി ${payee(f)}-ന് (UPI ID ${upiId(f)}) അയക്കൂ: ${need(f, "link")} സ്ലോട്ട് ${need(f, "holdMinutes")} മിനിറ്റ് പിടിച്ചുവെക്കും. പണം എത്തുമ്പോൾ ഉടമ ഉറപ്പിക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയക്കും.`,
  upi_already_waiting: (f) => `നിങ്ങളുടെ സ്ലോട്ട് (${slot(f)}) പിടിച്ചുവെച്ചിട്ടുണ്ട്. ${inr(f, "depositInr")} അഡ്വാൻസ് UPI വഴി ${payee(f)}-ന് (UPI ID ${upiId(f)}) അയക്കൂ: ${need(f, "link")} പണം എത്തുമ്പോൾ ഉടമ ഉറപ്പിക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയക്കും.`,
  upi_qr_caption: (f) => `ബുക്കിംഗ് ${need(f, "bookingRef")}-നായി ${payee(f)}-ന് UPI വഴി ${inr(f, "depositInr")} അയക്കാൻ സ്കാൻ ചെയ്യൂ.`,
  upi_booked: (f) => `ബുക്ക് ആയി! ${need(f, "serviceName")}, ${slot(f)}. നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് ഉടമ ഉറപ്പിച്ചു. പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് ${need(f, "windowHours")} മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം.`,
  upi_paid_claim: (f) => `നന്ദി. ഉടമ അവരുടെ UPI ആപ്പിൽ നിങ്ങളുടെ ${inr(f, "depositInr")} നോക്കി ഉറപ്പിക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയക്കും. സ്ക്രീൻഷോട്ട് പണമടച്ചതിന്റെ തെളിവല്ല, അതിനാൽ ആ സന്ദേശത്തിനായി കാത്തിരിക്കൂ.`,
  upi_nothing_waiting: () => "നന്ദി. ഇപ്പോൾ നിങ്ങളുടെ ഒരു UPI പണമടവും ബാക്കിയില്ല, അതിനാൽ ഉടമയ്ക്ക് ഉറപ്പിക്കാൻ ഒന്നുമില്ല. മറ്റെന്തിനെങ്കിലും പണം അയച്ചിട്ടുണ്ടെങ്കിൽ ദയവായി ഉടമയോട് സംസാരിക്കൂ.",
  upi_hold_expired: (f) => `ഉടമ സമയത്തിനുള്ളിൽ അഡ്വാൻസ് ഉറപ്പിക്കാത്തതിനാൽ ${slot(f)}-ന്റെ പിടിച്ചുവെക്കൽ അവസാനിച്ചു. നിങ്ങൾ ഇതിനകം പണം അയച്ചിട്ടുണ്ടെങ്കിൽ ഉടമ നിങ്ങളെ ബന്ധപ്പെടും. ഇനിയും ബുക്ക് ചെയ്യണമെങ്കിൽ എനിക്ക് സന്ദേശം അയക്കൂ.`,
  upi_late_received: (f) => `നിങ്ങളുടെ ${marked(f)} ഉടമ ഉറപ്പിച്ചത് ${slot(f)}-ന്റെ പിടിച്ചുവെക്കൽ അവസാനിച്ച ശേഷമാണ്, അതിനാൽ ബുക്ക് ആയിട്ടില്ല. വീണ്ടും ബുക്ക് ചെയ്യുന്നതിനെക്കുറിച്ചോ പണം തിരികെ അയക്കുന്നതിനെക്കുറിച്ചോ ഉടമ നിങ്ങളെ ബന്ധപ്പെടും.`,
  upi_refund_owed: (f) => `ഉടമ ${inr(f, "refundInr")} UPI വഴി നിങ്ങൾക്ക് തിരികെ അയക്കും. അയച്ചതായി ഉടമ രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.`,
  upi_cancelled_refund_owed: (f) => `${slot(f)}-ലെ നിങ്ങളുടെ ബുക്കിംഗ് റദ്ദാക്കി. ഉടമ നിങ്ങളുടെ ${inr(f, "refundInr")} UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.`,
  upi_extra_refund_owed: (f) => `നിങ്ങൾ അഡ്വാൻസിനേക്കാൾ കൂടുതൽ അയച്ചു. അധികമായ ${inr(f, "refundInr")} ഉടമ UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.`,
  upi_refund_sent: (f) => `ബുക്കിംഗ് ${need(f, "bookingRef")}-ന്റെ നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് UPI വഴി അയച്ചതായി ഉടമ രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ.`,

  owner_upi_expected: (f) => `പരിശോധിക്കാനുള്ള UPI പണമടവ്: ഉപഭോക്താവ് ${need(f, "customerPhone")}, ബുക്കിംഗ് ${need(f, "bookingRef")} (${need(f, "serviceName")}, ${slot(f)}) എന്നതിനായി ${inr(f, "depositInr")} അഡ്വാൻസ് അയക്കും. നിങ്ങളുടെ UPI ആപ്പിൽ കാണുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക. മറ്റൊരു തുക ആണ് വന്നതെങ്കിൽ "received ${code(f)}" എന്നതിന് ശേഷം തുക എഴുതുക.`,
  owner_upi_claim: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")} ബുക്കിംഗ് ${need(f, "bookingRef")}-ന്റെ ${inr(f, "depositInr")} അഡ്വാൻസ് അയച്ചെന്ന് പറയുന്നു. സ്ക്രീൻഷോട്ട് തെളിവല്ല: നിങ്ങളുടെ UPI ആപ്പ് നോക്കുക. പണം ഉണ്ടെങ്കിൽ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_marked: (f) => `നന്ദി. ബുക്കിംഗ് ${need(f, "bookingRef")}-ന്റെ ${marked(f)} നിങ്ങൾ കിട്ടിയതായി രേഖപ്പെടുത്തി.`,
  owner_upi_part: (f) => `ബുക്കിംഗ് ${need(f, "bookingRef")}-ന് നിങ്ങൾ ${marked(f)} രേഖപ്പെടുത്തി, പക്ഷേ അഡ്വാൻസ് ${inr(f, "depositInr")} ആണ്, അതിനാൽ ഇതുവരെ ബുക്ക് ആയിട്ടില്ല. പിടിച്ചുവെക്കൽ സമയം തീരും വരെ സ്ലോട്ട് പിടിച്ചുവെക്കും. ബാക്കി ${left(f)} എത്തുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_already: () => "ആ പണമടവ് ഇതിനകം രേഖപ്പെടുത്തിയിട്ടുണ്ട്. അത് ഒരു തവണ മാത്രം കണക്കാക്കും.",
  owner_upi_unknown: () => "ആ കോഡ് എനിക്ക് അറിയില്ല. ആ പണമടവിനെക്കുറിച്ചുള്ള എന്റെ ഏറ്റവും പുതിയ സന്ദേശത്തിലെ കോഡ് ഉപയോഗിക്കുക.",
  owner_upi_late: (f) => `ബുക്കിംഗ് ${need(f, "bookingRef")}-ന്റെ പിടിച്ചുവെക്കൽ അവസാനിച്ച ശേഷമാണ് നിങ്ങൾ ${marked(f)} കിട്ടിയതായി രേഖപ്പെടുത്തിയത്, അതിനാൽ അത് സ്വയം വീണ്ടും ബുക്ക് ആയില്ല. ഉപഭോക്താവ് ${need(f, "customerPhone")}-നെ നിങ്ങൾ തന്നെ വീണ്ടും ബുക്ക് ചെയ്യുക, അല്ലെങ്കിൽ ${inr(f, "refundInr")} UPI വഴി തിരികെ അയക്കുക. പിന്നെ "റീഫണ്ട് അയച്ചു" അല്ലെങ്കിൽ "ബുക്കിംഗിനായി വെച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" അല്ലെങ്കിൽ "kept ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_refund_owed: (f) => `തിരികെ അയക്കേണ്ടത്: ഉപഭോക്താവ് ${need(f, "customerPhone")}-ന് (ബുക്കിംഗ് ${need(f, "bookingRef")}) UPI വഴി ${inr(f, "refundInr")}. ഏജന്റ് ഒരിക്കലും പണം അയക്കില്ല. അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_refund_reminder: (f) => `ഓർമ്മപ്പെടുത്തൽ: ഉപഭോക്താവ് ${need(f, "customerPhone")}-ന് (ബുക്കിംഗ് ${need(f, "bookingRef")}) ${inr(f, "refundInr")} ഇനിയും തിരികെ നൽകാനുണ്ട്. UPI വഴി അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_refund_marked: (f) => `നന്ദി. ബുക്കിംഗ് ${need(f, "bookingRef")}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ട് അയച്ചതായി രേഖപ്പെടുത്തി, ഉപഭോക്താവിനെ അറിയിച്ചു.`,
  owner_upi_refund_kept: (f) => `ശരി. ബുക്കിംഗ് ${need(f, "bookingRef")}-ന്റെ ${inr(f, "refundInr")} നിങ്ങൾ തന്നെ ചെയ്യുന്ന ബുക്കിംഗിനായി വെച്ചു. ഇനി ഒന്നും തിരികെ നൽകാനില്ല.`,
};

const upiKn: UpiSet = {
  upi_quote_and_link: (f) => `ನಮ್ಮ ${need(f, "serviceName")} ${inr(f, "priceInr")}. ${slot(f)} ಖಾಲಿ ಇದೆ. ಖಚಿತಪಡಿಸಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣವನ್ನು UPI ಮೂಲಕ ${payee(f)} (UPI ID ${upiId(f)}) ಗೆ ಕಳುಹಿಸಿ: ${need(f, "link")} ಸ್ಲಾಟ್ ಅನ್ನು ${need(f, "holdMinutes")} ನಿಮಿಷ ಕಾಯ್ದಿರಿಸುತ್ತೇನೆ. ಹಣ ಬಂದಾಗ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_slot_and_link: (f) => `${slot(f)} ಖಾಲಿ ಇದೆ. ಖಚಿತಪಡಿಸಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣವನ್ನು UPI ಮೂಲಕ ${payee(f)} (UPI ID ${upiId(f)}) ಗೆ ಕಳುಹಿಸಿ: ${need(f, "link")} ಸ್ಲಾಟ್ ಅನ್ನು ${need(f, "holdMinutes")} ನಿಮಿಷ ಕಾಯ್ದಿರಿಸುತ್ತೇನೆ. ಹಣ ಬಂದಾಗ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_already_waiting: (f) => `ನಿಮ್ಮ ಸ್ಲಾಟ್ (${slot(f)}) ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ. ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣವನ್ನು UPI ಮೂಲಕ ${payee(f)} (UPI ID ${upiId(f)}) ಗೆ ಕಳುಹಿಸಿ: ${need(f, "link")} ಹಣ ಬಂದಾಗ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_qr_caption: (f) => `ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ಗಾಗಿ ${payee(f)} ಗೆ UPI ಮೂಲಕ ${inr(f, "depositInr")} ಪಾವತಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.`,
  upi_booked: (f) => `ಬುಕ್ ಆಗಿದೆ! ${need(f, "serviceName")}, ${slot(f)}. ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣವನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದ್ದಾರೆ. ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ ${need(f, "windowHours")} ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ.`,
  upi_paid_claim: (f) => `ಧನ್ಯವಾದ. ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನಿಮ್ಮ ${inr(f, "depositInr")} ನೋಡಿ ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪಾವತಿಯ ಪುರಾವೆ ಅಲ್ಲ, ಆದ್ದರಿಂದ ದಯವಿಟ್ಟು ಆ ಸಂದೇಶಕ್ಕಾಗಿ ಕಾಯಿರಿ.`,
  upi_nothing_waiting: () => "ಧನ್ಯವಾದ. ಈಗ ನಿಮ್ಮ ಯಾವುದೇ UPI ಪಾವತಿ ಬಾಕಿ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಲು ಏನೂ ಇಲ್ಲ. ಬೇರೆ ಯಾವುದಕ್ಕಾದರೂ ಹಣ ಕಳುಹಿಸಿದ್ದರೆ ದಯವಿಟ್ಟು ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.",
  upi_hold_expired: (f) => `ಮಾಲೀಕರು ಸಮಯಕ್ಕೆ ಮುಂಗಡ ಹಣವನ್ನು ಖಚಿತಪಡಿಸದ ಕಾರಣ ${slot(f)} ರ ಕಾಯ್ದಿರಿಸುವಿಕೆ ಮುಗಿದಿದೆ. ನೀವು ಈಗಾಗಲೇ ಹಣ ಕಳುಹಿಸಿದ್ದರೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ. ಇನ್ನೂ ಬುಕ್ ಮಾಡಬೇಕಿದ್ದರೆ ನನಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  upi_late_received: (f) => `ನಿಮ್ಮ ${marked(f)} ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ${slot(f)} ರ ಕಾಯ್ದಿರಿಸುವಿಕೆ ಮುಗಿದ ನಂತರ ಖಚಿತಪಡಿಸಿದರು, ಆದ್ದರಿಂದ ಬುಕ್ ಆಗಿಲ್ಲ. ಮತ್ತೆ ಬುಕ್ ಮಾಡುವ ಅಥವಾ ಹಣ ಮರಳಿ ಕಳುಹಿಸುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.`,
  upi_refund_owed: (f) => `ಮಾಲೀಕರು ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ. ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_cancelled_refund_owed: (f) => `${slot(f)} ರ ನಿಮ್ಮ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ. ಮಾಲೀಕರು ನಿಮ್ಮ ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_extra_refund_owed: (f) => `ನೀವು ಮುಂಗಡ ಹಣಕ್ಕಿಂತ ಹೆಚ್ಚು ಕಳುಹಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಅನ್ನು ಮಾಲೀಕರು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_refund_sent: (f) => `ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ರ ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಮಾಲೀಕರು ದಾಖಲಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ.`,

  owner_upi_expected: (f) => `ಪರಿಶೀಲಿಸಬೇಕಾದ UPI ಪಾವತಿ: ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಬುಕಿಂಗ್ ${need(f, "bookingRef")} (${need(f, "serviceName")}, ${slot(f)}) ಗಾಗಿ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸುತ್ತಾರೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಂಡಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ "received ${code(f)}" ನಂತರ ಮೊತ್ತ ಬರೆಯಿರಿ.`,
  owner_upi_claim: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ರ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸಿದ್ದೇವೆ ಎನ್ನುತ್ತಿದ್ದಾರೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ: ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ. ಹಣ ಇದ್ದರೆ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_marked: (f) => `ಧನ್ಯವಾದ. ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ರ ${marked(f)} ಬಂದಿದೆ ಎಂದು ನೀವು ದಾಖಲಿಸಿದ್ದೀರಿ.`,
  owner_upi_part: (f) => `ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ಗೆ ನೀವು ${marked(f)} ದಾಖಲಿಸಿದ್ದೀರಿ, ಆದರೆ ಮುಂಗಡ ಹಣ ${inr(f, "depositInr")}, ಆದ್ದರಿಂದ ಇನ್ನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಕಾಯ್ದಿರಿಸುವ ಸಮಯ ಮುಗಿಯುವವರೆಗೆ ಸ್ಲಾಟ್ ಕಾಯ್ದಿರುತ್ತದೆ. ಉಳಿದ ${left(f)} ಬಂದಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_already: () => "ಆ ಪಾವತಿ ಈಗಾಗಲೇ ದಾಖಲಾಗಿದೆ. ಅದನ್ನು ಒಂದೇ ಬಾರಿ ಎಣಿಸಲಾಗುತ್ತದೆ.",
  owner_upi_unknown: () => "ಆ ಕೋಡ್ ನನಗೆ ಗೊತ್ತಿಲ್ಲ. ಆ ಪಾವತಿಯ ಬಗ್ಗೆ ನನ್ನ ಇತ್ತೀಚಿನ ಸಂದೇಶದಲ್ಲಿರುವ ಕೋಡ್ ಬಳಸಿ.",
  owner_upi_late: (f) => `ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ರ ಕಾಯ್ದಿರಿಸುವಿಕೆ ಮುಗಿದ ನಂತರ ನೀವು ${marked(f)} ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದೀರಿ, ಆದ್ದರಿಂದ ಅದು ತಾನಾಗಿ ಮತ್ತೆ ಬುಕ್ ಆಗಲಿಲ್ಲ. ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಅವರನ್ನು ನೀವೇ ಮತ್ತೆ ಬುಕ್ ಮಾಡಿ, ಅಥವಾ ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸಿ. ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಅಥವಾ "ಬುಕಿಂಗ್‌ಗೆ ಇಟ್ಟಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಅಥವಾ "kept ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_refund_owed: (f) => `ಮರಳಿ ಕಳುಹಿಸಬೇಕು: ಗ್ರಾಹಕರು ${need(f, "customerPhone")} (ಬುಕಿಂಗ್ ${need(f, "bookingRef")}) ಅವರಿಗೆ UPI ಮೂಲಕ ${inr(f, "refundInr")}. ಏಜೆಂಟ್ ಎಂದಿಗೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_refund_reminder: (f) => `ನೆನಪಿಸುವುದು: ಗ್ರಾಹಕರು ${need(f, "customerPhone")} (ಬುಕಿಂಗ್ ${need(f, "bookingRef")}) ಅವರಿಗೆ ${inr(f, "refundInr")} ಇನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_refund_marked: (f) => `ಧನ್ಯವಾದ. ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ರ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ದಾಖಲಾಗಿದೆ, ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
  owner_upi_refund_kept: (f) => `ಸರಿ. ಬುಕಿಂಗ್ ${need(f, "bookingRef")} ರ ${inr(f, "refundInr")} ಅನ್ನು ನೀವೇ ಮಾಡುವ ಬುಕಿಂಗ್‌ಗಾಗಿ ಇಡಲಾಗಿದೆ. ಇನ್ನು ಏನನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿಲ್ಲ.`,
};

// ---- the licence's wind-down and final stop (plan B13) --------------------------------------------------------------------------------------------------
// The customer hears that online booking is paused and to contact the shop: no promise to book later. The owner hears once, plainly, and is told who to contact; the
// final stop's notice says the partner's service has ended, how many bookings are still in the calendar, and that hello@geometer.dev will connect the owner with another local partner (no copy of the records goes to the owner: it goes only to the builder or partner). Hindi, Malayalam and Kannada are
// machine-written, like the rest of those packs, and wait for a native speaker's review (REVIEW-ml.md, REVIEW-kn.md).
const partner = (f: MessageFacts) => need(f, "partner");
const upcoming = (f: MessageFacts) => need(f, "upcomingCount");

const licenceEn: LicenceSet = {
  booking_paused: (f) => `Online booking is paused for now. Please contact ${f.businessName} directly.`,
  owner_licence_paused: (f) => `Notice: online booking for ${f.businessName} is paused for now. Existing bookings, cancellations and refunds still go through. Please contact ${partner(f)}.`,
  owner_licence_stopped: (f) => `Notice: online booking for ${f.businessName} has stopped, because the service from ${partner(f)} has ended. Bookings after today still in your calendar: ${upcoming(f)}. To keep it running with another local partner, write to hello@geometer.dev and Geometer will connect you.`,
};
const licenceHi: LicenceSet = {
  booking_paused: (f) => `ऑनलाइन बुकिंग अभी रुकी हुई है। कृपया सीधे ${f.businessName} से संपर्क करें।`,
  owner_licence_paused: (f) => `सूचना: ${f.businessName} की ऑनलाइन बुकिंग अभी रुकी हुई है। पहले की बुकिंग, रद्द करना और रिफंड पहले की तरह चलते रहेंगे। इस बारे में कृपया ${partner(f)} से संपर्क करें।`,
  owner_licence_stopped: (f) => `सूचना: ${f.businessName} की ऑनलाइन बुकिंग बंद हो गई है, क्योंकि ${partner(f)} की सेवा समाप्त हो गई है। आज के बाद की जो बुकिंग आपके कैलेंडर में हैं: ${upcoming(f)}। इसे किसी दूसरे स्थानीय पार्टनर के साथ जारी रखने के लिए hello@geometer.dev पर लिखें, Geometer आपको जोड़ देगा।`,
};
const licenceMl: LicenceSet = {
  booking_paused: (f) => `ഓൺലൈൻ ബുക്കിംഗ് തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
  owner_licence_paused: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. നിലവിലുള്ള ബുക്കിംഗുകളും റദ്ദാക്കലുകളും റീഫണ്ടുകളും തുടർന്നും നടക്കും. ഇതിനെക്കുറിച്ച് ദയവായി ${partner(f)}-നെ ബന്ധപ്പെടൂ.`,
  owner_licence_stopped: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് നിർത്തി, കാരണം ${partner(f)} നൽകിയിരുന്ന സേവനം അവസാനിച്ചു. ഇന്നിന് ശേഷം നിങ്ങളുടെ കലണ്ടറിലുള്ള ബുക്കിംഗുകൾ: ${upcoming(f)}. മറ്റൊരു പ്രാദേശിക പാർട്ണറുമായി ഇത് തുടരാൻ hello@geometer.dev എന്ന വിലാസത്തിലേക്ക് എഴുതൂ, Geometer നിങ്ങളെ ബന്ധിപ്പിക്കും.`,
};
const licenceKn: LicenceSet = {
  booking_paused: (f) => `ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನೇರವಾಗಿ ${f.businessName} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_paused: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಈಗಿರುವ ಬುಕಿಂಗ್‌ಗಳು, ರದ್ದತಿಗಳು ಮತ್ತು ರೀಫಂಡ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ. ಈ ಬಗ್ಗೆ ದಯವಿಟ್ಟು ${partner(f)} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_stopped: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ನಿಂತಿದೆ, ಏಕೆಂದರೆ ${partner(f)} ನೀಡುತ್ತಿದ್ದ ಸೇವೆ ಮುಗಿದಿದೆ. ಇಂದಿನ ನಂತರ ನಿಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿರುವ ಬುಕಿಂಗ್‌ಗಳು: ${upcoming(f)}. ಇನ್ನೊಬ್ಬ ಸ್ಥಳೀಯ ಪಾರ್ಟ್ನರ್ ಜೊತೆ ಇದನ್ನು ಮುಂದುವರಿಸಲು hello@geometer.dev ವಿಳಾಸಕ್ಕೆ ಬರೆಯಿರಿ, Geometer ನಿಮ್ಮನ್ನು ಜೋಡಿಸುತ್ತದೆ.`,
};

// ---- the wait for a Guard is over (checkpoint item 8, 11 Nov 2026) ------------------------------------------------------------------------------------------------
// Hindi, Malayalam and Kannada are machine-written, like the rest of those packs, and wait for a native speaker's review (the REVIEW sheets list them; Deferred.md says so).
// The shop's name is not given a case ending: the sentence that names it is built the way `booking_paused` is.
const waitEn: GuardWaitSet = {
  wait_over: (f) => `Sorry, I could not finish your request: the booking system is not answering just now. Your message is on the owner's to-do list. Please write again later, or contact ${f.businessName} directly.`,
};
const waitHi: GuardWaitSet = {
  wait_over: (f) => `माफ़ कीजिए, मैं आपका अनुरोध पूरा नहीं कर पाया: बुकिंग सिस्टम अभी जवाब नहीं दे रहा है। आपका संदेश मालिक की काम की सूची में है। कृपया बाद में फिर लिखें, या सीधे ${f.businessName} से संपर्क करें।`,
};
const waitMl: GuardWaitSet = {
  wait_over: (f) => `ക്ഷമിക്കണം, നിങ്ങളുടെ അഭ്യർത്ഥന പൂർത്തിയാക്കാൻ കഴിഞ്ഞില്ല: ബുക്കിംഗ് സംവിധാനം ഇപ്പോൾ പ്രതികരിക്കുന്നില്ല. നിങ്ങളുടെ സന്ദേശം ഉടമയുടെ ചെയ്യാനുള്ള കാര്യങ്ങളുടെ പട്ടികയിലുണ്ട്. ദയവായി പിന്നീട് വീണ്ടും എഴുതൂ, അല്ലെങ്കിൽ ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
};
const waitKn: GuardWaitSet = {
  wait_over: (f) => `ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಆಗಲಿಲ್ಲ: ಬುಕಿಂಗ್ ವ್ಯವಸ್ಥೆ ಈಗ ಪ್ರತಿಕ್ರಿಯಿಸುತ್ತಿಲ್ಲ. ನಿಮ್ಮ ಸಂದೇಶ ಮಾಲೀಕರ ಮಾಡಬೇಕಾದ ಕೆಲಸಗಳ ಪಟ್ಟಿಯಲ್ಲಿದೆ. ದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಬರೆಯಿರಿ, ಅಥವಾ ನೇರವಾಗಿ ${f.businessName} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
};

export const TEMPLATES: Record<Language, TemplateSet> = { en: { ...en, ...upiEn, ...licenceEn, ...waitEn }, hi: { ...hi, ...upiHi, ...licenceHi, ...waitHi }, ml: { ...ml, ...upiMl, ...licenceMl, ...waitMl }, kn: { ...kn, ...upiKn, ...licenceKn, ...waitKn } };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
