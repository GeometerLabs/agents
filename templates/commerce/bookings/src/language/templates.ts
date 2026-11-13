// Every message the agent sends, per language. v0 has NO model-written text: each message is one of these templates,
// and every amount, date, time, service and link in it is rendered from the record (the facts), never typed by hand
// and never translated. Adding a language means adding one more object below; the type makes sure none is missing.
//
// How they read (14 Nov 2026, the owner's direction after seeing the UPI story): like a friendly shop assistant on WhatsApp. One or two short
// sentences and then the one thing to do; everyday words; the service and the time named instead of an internal id (a customer never sees
// "b-3"); a phone number grouped the way people write it ("+91 98111 11111"); the service capitalised when it opens an English sentence.
// What every line still means, word changes or not: the agent never says it checked a payment (the owner confirms a UPI payment); nothing
// is booked until the record says so; a screenshot is not proof; the cancellation rule and who sends a refund. The tests and the crash test
// hold those meanings. A raw `upi://pay?...` link never appears in a message: WhatsApp does not make it tappable and it reads as broken,
// so a UPI shop's customer gets the UPI ID in words and the QR picture (upi_qr_caption), and a gateway's https link stays on a line of its own.
import type { Language } from "../../../../../modules/language/languages.ts";
import { formatInr, formatSlot, formatTime, groupPhone, sentenceStart } from "../../../../../modules/language/format.ts";
import { localParts } from "../../../../../modules/core/time.ts";

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
  /** The owner asked for a day's bookings ("today", "tomorrow"): which day, and each booking on it (B72). Only ever in the reply to the owner's own message. */
  day?: "today" | "tomorrow";
  dayBookings?: { slotMs: number; serviceName: string; customerPhone: string; ref: string }[];
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
  | "reminder" | "didnt_understand" | "refund_checking" | "refund_confirmed" | "refund_expired" | "voice_note" | "voice_note_retry"
  // the turns that come with buttons or a list (language/interactive.ts): pick a service, pick a time, are you sure, "talk to the owner"
  | "pick_service" | "pick_slot" | "confirm_buttons" | "ask_cancel" | "kept" | "told_owner" | "couldnt_tell_owner"
  // to the owner. Every line starts and ends with fixed words, because each one is also a WhatsApp template (meta-templates.ts) and
  // Meta rejects a body that starts or ends with a value. The one exception is the reply to the owner's own message, which needs no template.
  | "owner_refund_needs_approval" | "owner_cant_confirm" | "owner_late_cancellation" | "owner_duplicate_payment"
  | "owner_payment_unused" | "owner_not_booked" | "owner_reschedule_failed"
  | "owner_message_held" | "owner_opted_out" | "owner_unknown_command" | "owner_wants_to_talk" | "owner_day_bookings"
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
/** This booking's service, to open a sentence ("Haircut on Tue 10 Nov ..."): capitalised in English only (format.ts sentenceStart). */
export const Service = (f: MessageFacts) => sentenceStart(need(f, "serviceName"), f.language);
/** The customer's number as people write it ("+91 98111 11111"); the check holds this form too (check.ts). Only ever in a message to the owner. */
export const phone = (f: MessageFacts) => groupPhone(need(f, "customerPhone"));
/**
 * The owner's day list: a heading that names the day, then one short line per booking: the time, the service and the customer's number. The date is in the
 * heading, so a row does not repeat it, and the booking's id is left out: nothing on the list is typed back. The words around it are per language.
 */
function dayList(f: MessageFacts, words: { heading: Record<"today" | "tomorrow", string>; none: Record<"today" | "tomorrow", string> }): string {
  const day = f.day ?? "today";
  const rows = f.dayBookings ?? [];
  if (rows.length === 0) return words.none[day];
  return [words.heading[day], ...rows.map((r) => `- ${formatTime(localParts(r.slotMs, f.timeZone), f.language)}: ${r.serviceName}, ${groupPhone(r.customerPhone)}`)].join("\n");
}
const menuList = (f: MessageFacts) => f.services.map((s) => `${s.name} ${formatInr(s.priceInr)}`).join(", ");

const en: BaseSet = {
  menu: (f) => `Hi! Welcome to ${f.businessName}. We do: ${menuList(f)}. Which one would you like, and when?`,
  ask_when: (f) => `When would you like your ${need(f, "serviceName")}? Tell me the day and time.`,
  ask_new_time: () => "Which day and time would suit you instead?",
  price_floor: (f) => `Our ${need(f, "serviceName")} is ${inr(f, "priceInr")}. Sorry, I can't go lower than that.`,
  confirm_details: (f) => `Just checking: ${need(f, "serviceName")} on ${slot(f)}? Reply "yes" to go ahead.`,
  // The gateway's link is https and WhatsApp makes it tappable; it goes on a line of its own, after the words, so the message reads first and the link is easy to tap.
  quote_and_link: (f) => `${Service(f)} on ${slot(f)} is free! It's ${inr(f, "priceInr")}. Pay a ${inr(f, "depositInr")} deposit to book it, and I'll hold the slot for ${need(f, "holdMinutes")} minutes.\nPay ${inr(f, "depositInr")} here: ${need(f, "link")}`,
  // After price_floor has already said the price, the quote does not repeat it.
  slot_and_link: (f) => `${slot(f)} is free! Pay a ${inr(f, "depositInr")} deposit to book it, and I'll hold the slot for ${need(f, "holdMinutes")} minutes.\nPay ${inr(f, "depositInr")} here: ${need(f, "link")}`,
  already_waiting: (f) => `I'm still holding ${slot(f)} for you. Pay the ${inr(f, "depositInr")} deposit to book it.\nPay ${inr(f, "depositInr")} here: ${need(f, "link")}`,
  slot_unavailable: (f) => `Sorry, ${slot(f)} is not available. What other time would work for you?`,
  outside_hours: (f) => `Sorry, we're closed at ${slot(f)}. What other time would work for you?`,
  hold_failed: (f) => `Sorry, I couldn't hold ${slot(f)} just now, so nothing is booked. I've let the owner know. Please try again in a few minutes.`,
  link_failed: () => "Sorry, I couldn't make the payment link just now, so nothing is booked. I've let the owner know.",
  booked: (f) => `You're booked! ${Service(f)}, ${slot(f)}. We got your ${inr(f, "depositInr")} deposit. Can't make it? Cancel at least ${need(f, "windowHours")} hours before and your deposit comes back.`,
  couldnt_confirm: (f) => `We got your ${inr(f, "depositInr")} deposit, but I couldn't confirm ${slot(f)} in our calendar yet, so it's not booked. I've told the owner, and they'll get in touch with you.`,
  hold_expired: (f) => `I've let go of ${slot(f)}, as the deposit didn't come in time. Message me if you'd still like to book.`,
  slot_gone_refund: (f) => `Sorry! Your ${inr(f, "depositInr")} payment came in after the hold on ${slot(f)} ended, and that time is now taken. We're refunding ${inr(f, "refundInr")} to you.`,
  refund_unbooked: (f) => `Your ${inr(f, "depositInr")} payment came in, but there's no booking open for it. We're refunding ${inr(f, "refundInr")} to you.`,
  reschedule_failed: (f) => `Sorry, I couldn't move your booking to ${slot(f)} in our calendar. I've told the owner, and they'll get in touch with you.`,
  duplicate_refund: (f) => `You paid the deposit twice. We're refunding the extra ${inr(f, "refundInr")} to you.`,
  duplicate_refund_pending: (f) => `You paid the deposit twice. The extra ${inr(f, "refundInr")} comes back to you once the owner approves it.`,
  cancelled_refund: (f) => `Done, your booking for ${slot(f)} is cancelled. We're refunding your ${inr(f, "refundInr")} deposit.`,
  cancelled_refund_pending: (f) => `Done, your booking for ${slot(f)} is cancelled. The owner will confirm your ${inr(f, "refundInr")} refund soon.`,
  cancelled_late: (f) => `Done, your booking for ${slot(f)} is cancelled. As it's less than ${need(f, "windowHours")} hours before the start, the owner will decide about your ${inr(f, "depositInr")} deposit and let you know.`,
  cancelled_no_deposit: (f) => `Done, ${slot(f)} is cancelled. You weren't charged anything.`,
  no_booking_found: () => "I couldn't find a booking to change. Tell me the service, day and time, and I'll book it for you.",
  refund_approved: (f) => `Good news: the owner approved your refund. ${inr(f, "refundInr")} is on its way to you.`,
  refund_denied: (f) => `Sorry, the owner has decided not to refund the ${inr(f, "depositInr")} deposit.`,
  rescheduled: (f) => `Done! Your ${need(f, "serviceName")} is now on ${slot(f)}.`,
  reminder: (f) => `Hi! Just a reminder: your ${need(f, "serviceName")} at ${f.businessName} is on ${slot(f)}. See you then!`,
  didnt_understand: () => "Sorry, I didn't catch that. Which service would you like, and on what day and time?",
  voice_note: () => "Sorry, I can't listen to voice notes yet. Could you type your message?",
  voice_note_retry: () => "Sorry, I couldn't make out that voice note. Could you type it instead?",
  pick_service: (f) => `Hi! Welcome to ${f.businessName}. What would you like to book?`,
  pick_slot: (f) => `When would you like your ${need(f, "serviceName")}? Pick a time below, or type the day and time you'd like.`,
  confirm_buttons: (f) => `Just checking: ${need(f, "serviceName")} on ${slot(f)}. Is that right?`,
  ask_cancel: (f) => `Do you want to cancel your booking for ${slot(f)}?`,
  kept: (f) => `No problem, your booking for ${slot(f)} stays as it is.`,
  told_owner: () => "I've told the owner you'd like to talk. They'll message you here.",
  couldnt_tell_owner: () => "Sorry, I couldn't reach the owner just now. Please try again in a few minutes.",
  refund_checking: (f) => `We're checking on your ${inr(f, "refundInr")} refund, and I'll message you as soon as it's confirmed.`,
  refund_confirmed: (f) => `Your ${inr(f, "refundInr")} refund is confirmed and on its way back to you.`,
  refund_expired: (f) => `Sorry, the owner didn't answer in time about your ${inr(f, "refundInr")} refund, so it hasn't been sent. Please contact ${f.businessName} directly.`,

  owner_refund_needs_approval: (f) => `A refund needs your OK: ${inr(f, "refundInr")} to ${phone(f)} (${need(f, "serviceName")}, ${slot(f)}). Reply "approve ${need(f, "approvalCode")}" or "deny ${need(f, "approvalCode")}" within ${need(f, "approvalHours")} hours.`,
  owner_cant_confirm: (f) => `Please check: the ${need(f, "serviceName")} on ${slot(f)} for ${phone(f)} didn't go into the calendar, so it's NOT booked. Their ${inr(f, "depositInr")} deposit is recorded. Reply "retry ${need(f, "bookingRef")}" to try the calendar again, or "approve ${need(f, "bookingRef")}" to cancel it and refund the deposit.`,
  owner_late_cancellation: (f) => `Late cancellation: ${phone(f)} cancelled the ${need(f, "serviceName")} on ${slot(f)}, less than ${need(f, "windowHours")} hours before the start. Their deposit is ${inr(f, "depositInr")}. Reply "approve ${need(f, "bookingRef")}" to refund it or "deny ${need(f, "bookingRef")}" to keep it.`,
  owner_duplicate_payment: (f) => `Heads up: ${phone(f)} paid the deposit twice for the ${need(f, "serviceName")} on ${slot(f)}. The extra ${inr(f, "refundInr")} was refunded to them.`,
  // A late payment (the hold had ended and the time was taken) and a payment for a booking that was cancelled get one line: the owner can do nothing about either, the money is back.
  owner_payment_unused: (f) => `Heads up: ${phone(f)} paid ${inr(f, "depositInr")} for ${slot(f)}, but that booking was no longer open (its hold had ended, or it was cancelled). ${inr(f, "refundInr")} was refunded to them.`,
  // The slot could not be held, or the payment link could not be made: either way nothing is booked and the customer has been told to try again.
  owner_not_booked: (f) => `Heads up: I couldn't set up the ${need(f, "serviceName")} on ${slot(f)} for ${phone(f)}, because the calendar or the payment link didn't work. Nothing is booked.`,
  owner_reschedule_failed: (f) => `Heads up: I couldn't move the ${need(f, "serviceName")} for ${phone(f)} to ${slot(f)} in the calendar. Please check their booking.`,
  owner_message_held: (f) => `Heads up: I held back a message to ${phone(f)} because it didn't match the booking record. Nothing was sent.`,
  owner_opted_out: (f) => `Heads up: ${phone(f)} sent STOP, so I won't message them again.`,
  owner_unknown_command: () => `Sorry, I didn't get that. Reply "approve", "deny" or "retry" followed by the booking number.`,
  owner_day_bookings: (f) => dayList(f, { heading: { today: "Today's bookings:", tomorrow: "Tomorrow's bookings:" }, none: { today: "No bookings today.", tomorrow: "No bookings tomorrow." } }),
  owner_approval_done: (f) => `Thanks! The ${inr(f, "refundInr")} refund to ${phone(f)} is being sent, and I'll let them know.`,
  owner_approval_denied: (f) => `Okay, the ${inr(f, "refundInr")} refund to ${phone(f)} won't be sent. I'll let them know.`,
  owner_approval_expired: (f) => `That refund request (${inr(f, "refundInr")} to ${phone(f)}) ran out before you answered, so nothing was refunded.`,
  owner_approval_failed: () => "Sorry, I couldn't save your answer just now. Please send it again in a few minutes.",
  owner_approval_waiting: (f) => `Thanks, your OK for the ${inr(f, "refundInr")} refund to ${phone(f)} is saved. OKs still needed from the others: ${need(f, "approvalsLeft")}. It goes out only once they're in.`,
  owner_approval_closed: (f) => `No need to answer: the others have approved the ${inr(f, "refundInr")} refund to ${phone(f)}. Thank you!`,
  owner_approval_refused: (f) => `One of the people who approve refunds said no to the ${inr(f, "refundInr")} refund to ${phone(f)}, so it won't be sent. I'll let the customer know.`,
  owner_refund_settled: (f) => `Refund done: ${inr(f, "refundInr")} to ${phone(f)}. The person who set up your agent checked it and marked it as made, so it won't be sent a second time.`,
  owner_wants_to_talk: (f) => `A customer would like to talk to you: ${phone(f)}. Please message them when you can.`,
  owner_ai_allowance: (f) => `Heads up: this month's AI allowance for ${f.businessName} is used up, so I'm answering with buttons and lists for now. I still take bookings, and all your limits still apply. The person who set me up knows. Normal service is back next month.`,
  owner_ai_off: (f) => `Heads up: the AI that reads messages for ${f.businessName} is switched off for now. I keep taking bookings with buttons and lists, and all your limits still apply. The person who set me up knows.`,
  owner_ai_fault: (f) => `Heads up: the AI that reads messages for ${f.businessName} isn't answering right now, so I'm using buttons and lists. I still take bookings, and all your limits still apply. I'll try the AI again in a few minutes.`,
};

const hi: BaseSet = {
  menu: (f) => `नमस्ते! ${f.businessName} में आपका स्वागत है। हमारे यहाँ ये मिलता है: ${menuList(f)}। बताइए, कौन सा चाहिए और कब?`,
  ask_when: (f) => `आपको ${need(f, "serviceName")} कब चाहिए? बस दिन और समय बता दीजिए।`,
  ask_new_time: () => "इसकी जगह कौन सा दिन और समय ठीक रहेगा?",
  price_floor: (f) => `हमारा ${need(f, "serviceName")} ${inr(f, "priceInr")} का है। माफ़ कीजिए, इससे कम में नहीं हो पाएगा।`,
  confirm_details: (f) => `एक बार देख लीजिए: ${need(f, "serviceName")}, ${slot(f)}। ठीक है तो "हाँ" लिख दीजिए।`,
  quote_and_link: (f) => `${need(f, "serviceName")} के लिए ${slot(f)} खाली है! कीमत ${inr(f, "priceInr")} है। बुक करने के लिए ${inr(f, "depositInr")} जमा करें, मैं स्लॉट ${need(f, "holdMinutes")} मिनट रोककर रखूँगा।\nयहाँ से ${inr(f, "depositInr")} जमा करें: ${need(f, "link")}`,
  slot_and_link: (f) => `${slot(f)} खाली है! बुक करने के लिए ${inr(f, "depositInr")} जमा करें, मैं स्लॉट ${need(f, "holdMinutes")} मिनट रोककर रखूँगा।\nयहाँ से ${inr(f, "depositInr")} जमा करें: ${need(f, "link")}`,
  already_waiting: (f) => `आपका ${slot(f)} का स्लॉट अभी रोका हुआ है। बुक करने के लिए ${inr(f, "depositInr")} जमा कर दीजिए।\nयहाँ से ${inr(f, "depositInr")} जमा करें: ${need(f, "link")}`,
  slot_unavailable: (f) => `माफ़ कीजिए, ${slot(f)} खाली नहीं है। कोई और समय बताइए?`,
  outside_hours: (f) => `माफ़ कीजिए, ${slot(f)} पर हम बंद रहते हैं। कोई और समय बताइए?`,
  hold_failed: (f) => `माफ़ कीजिए, अभी ${slot(f)} का स्लॉट रोक नहीं पाया, इसलिए कुछ भी बुक नहीं हुआ है। मैंने मालिक को बता दिया है। थोड़ी देर बाद फिर कोशिश कीजिए।`,
  link_failed: () => "माफ़ कीजिए, अभी पेमेंट लिंक नहीं बन पाया, इसलिए कुछ भी बुक नहीं हुआ है। मैंने मालिक को बता दिया है।",
  booked: (f) => `बुक हो गया! ${need(f, "serviceName")}, ${slot(f)}। आपका ${inr(f, "depositInr")} जमा हमें मिल गया। नहीं आ पा रहे? शुरू होने से कम से कम ${need(f, "windowHours")} घंटे पहले रद्द कर दीजिए, आपका जमा वापस मिल जाएगा।`,
  couldnt_confirm: (f) => `आपका ${inr(f, "depositInr")} जमा मिल गया है, पर ${slot(f)} अभी हमारे कैलेंडर में पक्का नहीं हो पाया, इसलिए बुकिंग नहीं हुई है। मैंने मालिक को बता दिया है, वे आपसे बात करेंगे।`,
  hold_expired: (f) => `${slot(f)} का स्लॉट मैंने छोड़ दिया है, क्योंकि जमा समय पर नहीं आया। अब भी बुक करना चाहें तो मुझे लिख दीजिए।`,
  slot_gone_refund: (f) => `माफ़ कीजिए! आपका ${inr(f, "depositInr")} का पेमेंट तब आया जब ${slot(f)} की रोक खत्म हो चुकी थी, और वह समय अब किसी और को मिल गया है। ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  refund_unbooked: (f) => `आपका ${inr(f, "depositInr")} का पेमेंट आया, पर उसके लिए कोई बुकिंग खुली नहीं थी। ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  reschedule_failed: (f) => `माफ़ कीजिए, आपकी बुकिंग को ${slot(f)} पर हमारे कैलेंडर में नहीं ले जा पाया। मैंने मालिक को बता दिया है, वे आपसे बात करेंगे।`,
  duplicate_refund: (f) => `आपने जमा दो बार भर दिया। एक्स्ट्रा ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  duplicate_refund_pending: (f) => `आपने जमा दो बार भर दिया। एक्स्ट्रा ${inr(f, "refundInr")} मालिक के हाँ करते ही आपको वापस मिल जाएगा।`,
  cancelled_refund: (f) => `हो गया, ${slot(f)} की आपकी बुकिंग रद्द हो गई। आपका ${inr(f, "refundInr")} जमा वापस किया जा रहा है।`,
  cancelled_refund_pending: (f) => `हो गया, ${slot(f)} की आपकी बुकिंग रद्द हो गई। आपके ${inr(f, "refundInr")} के रिफंड पर मालिक जल्दी ही पक्का करेंगे।`,
  cancelled_late: (f) => `हो गया, ${slot(f)} की आपकी बुकिंग रद्द हो गई। शुरू होने में ${need(f, "windowHours")} घंटे से कम बचे थे, इसलिए आपके ${inr(f, "depositInr")} जमा पर मालिक फ़ैसला करेंगे और आपको बताएँगे।`,
  cancelled_no_deposit: (f) => `हो गया, ${slot(f)} की बुकिंग रद्द हो गई। आपसे कुछ भी नहीं लिया गया।`,
  no_booking_found: () => "मुझे बदलने के लिए कोई बुकिंग नहीं मिली। सेवा, दिन और समय बताइए, मैं आपके लिए बुक कर दूँगा।",
  refund_approved: (f) => `खुशखबरी: मालिक ने आपका रिफंड मंज़ूर कर दिया है। ${inr(f, "refundInr")} आपको वापस भेजा जा रहा है।`,
  refund_denied: (f) => `माफ़ कीजिए, मालिक ने ${inr(f, "depositInr")} का जमा वापस न करने का फ़ैसला किया है।`,
  rescheduled: (f) => `हो गया! आपका ${need(f, "serviceName")} अब ${slot(f)} पर है।`,
  reminder: (f) => `नमस्ते! याद दिला दूँ: ${f.businessName} में आपका ${need(f, "serviceName")} ${slot(f)} पर है। मिलते हैं!`,
  refund_checking: (f) => `आपके ${inr(f, "refundInr")} के रिफंड की जाँच चल रही है। पक्का होते ही मैं आपको मैसेज करूँगा।`,
  refund_confirmed: (f) => `आपका ${inr(f, "refundInr")} का रिफंड पक्का हो गया है और आपको वापस भेजा जा रहा है।`,
  refund_expired: (f) => `माफ़ कीजिए, मालिक ने आपके ${inr(f, "refundInr")} के रिफंड पर समय पर जवाब नहीं दिया, इसलिए वह अभी नहीं भेजा गया। कृपया सीधे ${f.businessName} से बात कर लीजिए।`,
  didnt_understand: () => "माफ़ कीजिए, समझ नहीं आया। आपको कौन सी सेवा चाहिए, और किस दिन, किस समय?",
  voice_note: () => "माफ़ कीजिए, मैं अभी वॉइस नोट नहीं सुन सकता। क्या आप लिखकर भेज देंगे?",
  voice_note_retry: () => "माफ़ कीजिए, यह वॉइस नोट समझ नहीं आया। क्या आप लिखकर भेज देंगे?",
  pick_service: (f) => `नमस्ते! ${f.businessName} में आपका स्वागत है। क्या बुक करना है?`,
  pick_slot: (f) => `आपको ${need(f, "serviceName")} कब चाहिए? नीचे से समय चुनिए, या अपना दिन और समय लिख दीजिए।`,
  confirm_buttons: (f) => `एक बार देख लीजिए: ${need(f, "serviceName")}, ${slot(f)}। सही है?`,
  ask_cancel: (f) => `क्या आप ${slot(f)} की अपनी बुकिंग रद्द करना चाहते हैं?`,
  kept: (f) => `ठीक है, ${slot(f)} की आपकी बुकिंग वैसी ही रहेगी।`,
  told_owner: () => "मैंने मालिक को बता दिया है कि आप बात करना चाहते हैं। वे आपको यहीं मैसेज करेंगे।",
  couldnt_tell_owner: () => "माफ़ कीजिए, अभी मालिक तक बात नहीं पहुँची। थोड़ी देर बाद फिर कोशिश कीजिए।",

  owner_refund_needs_approval: (f) => `रिफंड के लिए आपकी हाँ चाहिए: ग्राहक ${phone(f)} (${need(f, "serviceName")}, ${slot(f)}) को ${inr(f, "refundInr")}। ${need(f, "approvalHours")} घंटे के अंदर "approve ${need(f, "approvalCode")}" या "deny ${need(f, "approvalCode")}" लिखकर भेजिए।`,
  owner_cant_confirm: (f) => `ज़रा देख लीजिए: ग्राहक ${phone(f)} का ${need(f, "serviceName")}, ${slot(f)} कैलेंडर में नहीं चढ़ा, इसलिए बुकिंग पक्की नहीं है। उनका ${inr(f, "depositInr")} जमा दर्ज है। कैलेंडर फिर आज़माने के लिए "retry ${need(f, "bookingRef")}" लिखिए, या बुकिंग रद्द करके जमा लौटाने के लिए "approve ${need(f, "bookingRef")}" लिखिए।`,
  owner_late_cancellation: (f) => `देर से रद्द: ग्राहक ${phone(f)} ने ${need(f, "serviceName")}, ${slot(f)} शुरू होने से ${need(f, "windowHours")} घंटे से कम पहले रद्द किया। उनका जमा ${inr(f, "depositInr")} है। लौटाने के लिए "approve ${need(f, "bookingRef")}" लिखिए, रखने के लिए "deny ${need(f, "bookingRef")}" लिखिए।`,
  owner_duplicate_payment: (f) => `ध्यान दें: ग्राहक ${phone(f)} ने ${need(f, "serviceName")}, ${slot(f)} के लिए जमा दो बार भर दिया। एक्स्ट्रा ${inr(f, "refundInr")} उन्हें वापस कर दिया गया है।`,
  owner_payment_unused: (f) => `ध्यान दें: ग्राहक ${phone(f)} ने ${slot(f)} के लिए ${inr(f, "depositInr")} भेजे, पर वह बुकिंग अब खुली नहीं थी (स्लॉट की रोक खत्म हो गई थी, या बुकिंग रद्द हो गई थी)। ${inr(f, "refundInr")} उन्हें वापस कर दिया गया है।`,
  owner_not_booked: (f) => `ध्यान दें: ग्राहक ${phone(f)} के ${need(f, "serviceName")}, ${slot(f)} की बुकिंग नहीं बन पाई, क्योंकि कैलेंडर या पेमेंट लिंक ने काम नहीं किया। कुछ भी बुक नहीं हुआ है।`,
  owner_reschedule_failed: (f) => `ध्यान दें: ग्राहक ${phone(f)} का ${need(f, "serviceName")} कैलेंडर में ${slot(f)} पर नहीं जा पाया। कृपया उनकी बुकिंग देख लीजिए।`,
  owner_message_held: (f) => `ध्यान दें: ग्राहक ${phone(f)} को जाने वाला एक मैसेज मैंने रोक लिया, क्योंकि वह बुकिंग रिकॉर्ड से मेल नहीं खाता था। कुछ भी नहीं भेजा गया।`,
  owner_opted_out: (f) => `ध्यान दें: ग्राहक ${phone(f)} ने STOP भेजा है, इसलिए अब मैं उन्हें मैसेज नहीं करूँगा।`,
  owner_unknown_command: () => `माफ़ कीजिए, समझ नहीं आया। "approve", "deny" या "retry" लिखिए, और उसके बाद बुकिंग नंबर।`,
  owner_day_bookings: (f) => dayList(f, { heading: { today: "आज की बुकिंग:", tomorrow: "कल की बुकिंग:" }, none: { today: "आज कोई बुकिंग नहीं है।", tomorrow: "कल कोई बुकिंग नहीं है।" } }),
  owner_approval_done: (f) => `शुक्रिया! ग्राहक ${phone(f)} को ${inr(f, "refundInr")} का रिफंड भेजा जा रहा है, और मैं उन्हें बता दूँगा।`,
  owner_approval_denied: (f) => `ठीक है, ग्राहक ${phone(f)} को ${inr(f, "refundInr")} का रिफंड नहीं भेजा जाएगा। मैं उन्हें बता दूँगा।`,
  owner_approval_expired: (f) => `आपके जवाब से पहले ही वह रिफंड रिक्वेस्ट (${inr(f, "refundInr")}, ग्राहक ${phone(f)}) खत्म हो गई, इसलिए कुछ भी वापस नहीं किया गया।`,
  owner_approval_failed: () => "माफ़ कीजिए, अभी आपका जवाब सेव नहीं हो पाया। थोड़ी देर बाद फिर भेज दीजिए।",
  owner_approval_waiting: (f) => `शुक्रिया, ग्राहक ${phone(f)} को ${inr(f, "refundInr")} के रिफंड पर आपकी हाँ दर्ज हो गई। दूसरों से अभी और हाँ चाहिए: ${need(f, "approvalsLeft")}। उनके आने के बाद ही रिफंड जाएगा।`,
  owner_approval_closed: (f) => `जवाब देने की ज़रूरत नहीं: दूसरों ने ग्राहक ${phone(f)} को ${inr(f, "refundInr")} का रिफंड मंज़ूर कर दिया है। शुक्रिया!`,
  owner_approval_refused: (f) => `रिफंड मंज़ूर करने वालों में से एक ने ग्राहक ${phone(f)} को ${inr(f, "refundInr")} के रिफंड के लिए मना कर दिया, इसलिए वह नहीं भेजा जाएगा। मैं ग्राहक को बता दूँगा।`,
  owner_refund_settled: (f) => `रिफंड हो गया: ग्राहक ${phone(f)} को ${inr(f, "refundInr")}। आपका एजेंट सेट करने वाले ने इसे जाँचकर भेजा हुआ दर्ज कर दिया है, इसलिए यह दोबारा नहीं जाएगा।`,
  owner_wants_to_talk: (f) => `एक ग्राहक आपसे बात करना चाहते हैं: ${phone(f)}। समय मिलते ही उन्हें मैसेज कर दीजिए।`,
  owner_ai_allowance: (f) => `ध्यान दें: ${f.businessName} का इस महीने का AI कोटा खत्म हो गया है, इसलिए अभी मैं बटन और लिस्ट से जवाब दे रहा हूँ। बुकिंग फिर भी चलती रहेगी और आपकी सारी सीमाएँ पहले जैसी लागू हैं। जिसने मुझे सेट किया है, उसे पता है। अगले महीने सब पहले जैसा हो जाएगा।`,
  owner_ai_off: (f) => `ध्यान दें: ${f.businessName} के मैसेज पढ़ने वाला AI अभी बंद है। मैं बटन और लिस्ट से बुकिंग लेता रहूँगा, और आपकी सारी सीमाएँ पहले जैसी लागू हैं। जिसने मुझे सेट किया है, उसे पता है।`,
  owner_ai_fault: (f) => `ध्यान दें: ${f.businessName} के मैसेज पढ़ने वाला AI अभी जवाब नहीं दे रहा, इसलिए मैं बटन और लिस्ट से काम कर रहा हूँ। बुकिंग फिर भी चलती रहेगी और आपकी सारी सीमाएँ पहले जैसी लागू हैं। कुछ मिनट बाद मैं AI को फिर आज़माऊँगा।`,
};

// Malayalam and Kannada. Machine-written: a native speaker must read every line (REVIEW-ml.md, REVIEW-kn.md) before a real
// shop uses them. Choices that keep them safe for any shop: no service name or business name gets a case ending glued on
// (so "ഹെയർകട്ട് വില ₹450", "ಹೇರ್ ಕಟ್ ಬೆಲೆ ₹450", never a form that depends on the name's last letter), the date and time are
// written as a unit or in brackets, and owner commands stay in Latin letters ("approve b-3") with the meaning in the owner's language.
const ml: BaseSet = {
  menu: (f) => `നമസ്കാരം! ${f.businessName}-ലേക്ക് സ്വാഗതം. ഞങ്ങളുടെ സേവനങ്ങൾ: ${menuList(f)}. ഏത് സേവനമാണ് വേണ്ടത്, എപ്പോൾ വേണം?`,
  ask_when: (f) => `${need(f, "serviceName")} എപ്പോൾ വേണം? ദിവസവും സമയവും പറഞ്ഞാൽ മതി.`,
  ask_new_time: () => "പകരം ഏത് ദിവസവും സമയവും ആണ് സൗകര്യം?",
  price_floor: (f) => `${need(f, "serviceName")} വില ${inr(f, "priceInr")} ആണ്. ക്ഷമിക്കണം, ഇതിൽ കുറയ്ക്കാൻ കഴിയില്ല.`,
  confirm_details: (f) => `ഒന്ന് ഉറപ്പിക്കട്ടെ: ${need(f, "serviceName")}, ${slot(f)}. തുടരാൻ "ശരി" എന്ന് മറുപടി തരൂ.`,
  // The gateway's link is https and WhatsApp makes it tappable; it goes on a line of its own, after the words.
  quote_and_link: (f) => `${need(f, "serviceName")}, ${slot(f)} ഒഴിവുണ്ട്! വില ${inr(f, "priceInr")}. ബുക്ക് ചെയ്യാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ, ${need(f, "holdMinutes")} മിനിറ്റ് ഈ സ്ലോട്ട് ഞാൻ നിങ്ങൾക്കായി മാറ്റിവയ്ക്കാം.\n${inr(f, "depositInr")} ഇവിടെ അടയ്ക്കൂ: ${need(f, "link")}`,
  // After price_floor has already said the price, the quote does not repeat it.
  slot_and_link: (f) => `${slot(f)} ഒഴിവുണ്ട്! ബുക്ക് ചെയ്യാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ, ${need(f, "holdMinutes")} മിനിറ്റ് ഈ സ്ലോട്ട് ഞാൻ നിങ്ങൾക്കായി മാറ്റിവയ്ക്കാം.\n${inr(f, "depositInr")} ഇവിടെ അടയ്ക്കൂ: ${need(f, "link")}`,
  already_waiting: (f) => `${slot(f)} ഇപ്പോഴും നിങ്ങൾക്കായി മാറ്റിവച്ചിട്ടുണ്ട്. ബുക്ക് ചെയ്യാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ.\n${inr(f, "depositInr")} ഇവിടെ അടയ്ക്കൂ: ${need(f, "link")}`,
  slot_unavailable: (f) => `ക്ഷമിക്കണം, ${slot(f)} ഒഴിവില്ല. മറ്റൊരു സമയം പറയാമോ?`,
  outside_hours: (f) => `ക്ഷമിക്കണം, ${slot(f)} ഞങ്ങൾ അടച്ചിരിക്കും. മറ്റൊരു സമയം പറയാമോ?`,
  hold_failed: (f) => `ക്ഷമിക്കണം, ${slot(f)} ഇപ്പോൾ മാറ്റിവയ്ക്കാൻ പറ്റിയില്ല, അതുകൊണ്ട് ഒന്നും ബുക്ക് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് ഒന്നുകൂടി ശ്രമിക്കൂ.`,
  link_failed: () => "ക്ഷമിക്കണം, പേയ്മെന്റ് ലിങ്ക് ഇപ്പോൾ ഉണ്ടാക്കാൻ പറ്റിയില്ല, അതുകൊണ്ട് ഒന്നും ബുക്ക് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്.",
  booked: (f) => `ബുക്ക് ആയി! ${need(f, "serviceName")}, ${slot(f)}. നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് കിട്ടി. വരാൻ പറ്റില്ലെങ്കിൽ ${need(f, "windowHours")} മണിക്കൂർ മുമ്പെങ്കിലും റദ്ദാക്കൂ, അഡ്വാൻസ് തിരികെ കിട്ടും.`,
  couldnt_confirm: (f) => `നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് കിട്ടി, പക്ഷേ ${slot(f)} ഞങ്ങളുടെ കലണ്ടറിൽ ഉറപ്പിക്കാൻ ഇതുവരെ പറ്റിയില്ല, അതുകൊണ്ട് ബുക്ക് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്, അവർ നിങ്ങളെ ബന്ധപ്പെടും.`,
  hold_expired: (f) => `അഡ്വാൻസ് സമയത്തിനുള്ളിൽ കിട്ടാത്തതുകൊണ്ട് ${slot(f)} ഞാൻ വിട്ടുകൊടുത്തു. ഇനിയും ബുക്ക് ചെയ്യണമെങ്കിൽ എനിക്ക് മെസ്സേജ് അയക്കൂ.`,
  slot_gone_refund: (f) => `ക്ഷമിക്കണം! നിങ്ങളുടെ ${inr(f, "depositInr")} പേയ്മെന്റ് വന്നപ്പോഴേക്കും സ്ലോട്ട് (${slot(f)}) മാറ്റിവച്ച സമയം കഴിഞ്ഞിരുന്നു, ആ സമയം ഇപ്പോൾ മറ്റൊരാൾക്ക് പോയി. ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്.`,
  refund_unbooked: (f) => `നിങ്ങളുടെ ${inr(f, "depositInr")} പേയ്മെന്റ് വന്നു, പക്ഷേ അതിന് തുറന്നിരിക്കുന്ന ബുക്കിംഗ് ഒന്നുമില്ല. ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്.`,
  reschedule_failed: (f) => `ക്ഷമിക്കണം, ബുക്കിംഗ് പുതിയ സമയത്തേക്ക് (${slot(f)}) മാറ്റാൻ ഞങ്ങളുടെ കലണ്ടറിൽ പറ്റിയില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്, അവർ നിങ്ങളെ ബന്ധപ്പെടും.`,
  duplicate_refund: (f) => `നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികം അടച്ച ${inr(f, "refundInr")} തിരികെ നൽകുന്നുണ്ട്.`,
  duplicate_refund_pending: (f) => `നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികം അടച്ച ${inr(f, "refundInr")} ഉടമ അംഗീകരിച്ചാൽ തിരികെ കിട്ടും.`,
  cancelled_refund: (f) => `ബുക്കിംഗ് റദ്ദാക്കിയിട്ടുണ്ട് (${slot(f)}). നിങ്ങളുടെ ${inr(f, "refundInr")} അഡ്വാൻസ് തിരികെ നൽകുന്നുണ്ട്.`,
  cancelled_refund_pending: (f) => `ബുക്കിംഗ് റദ്ദാക്കിയിട്ടുണ്ട് (${slot(f)}). നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് ഉടമ ഉടൻ ഉറപ്പാക്കും.`,
  cancelled_late: (f) => `ബുക്കിംഗ് റദ്ദാക്കിയിട്ടുണ്ട് (${slot(f)}). തുടങ്ങാൻ ${need(f, "windowHours")} മണിക്കൂറിൽ കുറവേ ഉള്ളൂ, അതുകൊണ്ട് നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസിന്റെ കാര്യം ഉടമ തീരുമാനിച്ച് അറിയിക്കും.`,
  cancelled_no_deposit: (f) => `ബുക്കിംഗ് റദ്ദാക്കിയിട്ടുണ്ട് (${slot(f)}). പണമൊന്നും ഈടാക്കിയിട്ടില്ല.`,
  no_booking_found: () => "മാറ്റാൻ ബുക്കിംഗ് ഒന്നും കണ്ടില്ല. സേവനം, ദിവസം, സമയം എന്നിവ പറഞ്ഞാൽ ഞാൻ ബുക്ക് ചെയ്യാം.",
  refund_approved: (f) => `സന്തോഷവാർത്ത: ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ വരുന്നുണ്ട്.`,
  refund_denied: (f) => `ക്ഷമിക്കണം, ${inr(f, "depositInr")} അഡ്വാൻസ് തിരികെ നൽകേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു.`,
  rescheduled: (f) => `മാറ്റിയിട്ടുണ്ട്! ${need(f, "serviceName")}, പുതിയ സമയം: ${slot(f)}.`,
  reminder: (f) => `നമസ്കാരം! ഒരു ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}-ൽ നിങ്ങളുടെ ${need(f, "serviceName")} ബുക്കിംഗ് ${slot(f)} ആണ്. കാണാം!`,
  didnt_understand: () => "ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. ഏത് സേവനം, ഏത് ദിവസം, ഏത് സമയം എന്ന് ഒന്നുകൂടി പറയാമോ?",
  voice_note: () => "ക്ഷമിക്കണം, വോയ്സ് നോട്ട് ഇപ്പോൾ കേൾക്കാൻ പറ്റില്ല. ടൈപ്പ് ചെയ്ത് അയക്കാമോ?",
  voice_note_retry: () => "ക്ഷമിക്കണം, ആ വോയ്സ് നോട്ട് എനിക്ക് മനസ്സിലായില്ല. ടൈപ്പ് ചെയ്ത് അയക്കാമോ?",
  pick_service: (f) => `നമസ്കാരം! ${f.businessName}-ലേക്ക് സ്വാഗതം. ഏത് സേവനമാണ് ബുക്ക് ചെയ്യേണ്ടത്?`,
  pick_slot: (f) => `${need(f, "serviceName")} എപ്പോൾ വേണം? താഴെ നിന്ന് ഒരു സമയം തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ ദിവസവും സമയവും ടൈപ്പ് ചെയ്യൂ.`,
  confirm_buttons: (f) => `ഒന്ന് ഉറപ്പിക്കട്ടെ: ${need(f, "serviceName")}, ${slot(f)}. ഇത് ശരിയാണോ?`,
  ask_cancel: (f) => `ബുക്കിംഗ് (${slot(f)}) റദ്ദാക്കണോ?`,
  kept: (f) => `ശരി, ബുക്കിംഗ് (${slot(f)}) അതുപോലെ തന്നെ ഉണ്ട്.`,
  told_owner: () => "നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ മെസ്സേജ് അയക്കും.",
  couldnt_tell_owner: () => "ക്ഷമിക്കണം, ഇപ്പോൾ ഉടമയെ കിട്ടിയില്ല. കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് ഒന്നുകൂടി ശ്രമിക്കൂ.",
  refund_checking: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് നോക്കിക്കൊണ്ടിരിക്കുകയാണ്, ഉറപ്പായാൽ ഉടൻ ഞാൻ മെസ്സേജ് അയക്കാം.`,
  refund_confirmed: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് ഉറപ്പായി, തിരികെ വരുന്നുണ്ട്.`,
  refund_expired: (f) => `ക്ഷമിക്കണം, നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ടിനെക്കുറിച്ച് ഉടമ സമയത്തിനുള്ളിൽ മറുപടി തന്നില്ല, അതുകൊണ്ട് അത് അയച്ചിട്ടില്ല. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,

  owner_refund_needs_approval: (f) => `റീഫണ്ടിന് നിങ്ങളുടെ അനുമതി വേണം. കസ്റ്റമർ ${phone(f)} (${need(f, "serviceName")}, ${slot(f)}): ${inr(f, "refundInr")}. ${need(f, "approvalHours")} മണിക്കൂറിനുള്ളിൽ "approve ${need(f, "approvalCode")}" അല്ലെങ്കിൽ "deny ${need(f, "approvalCode")}" എന്ന് മറുപടി അയക്കൂ.`,
  owner_cant_confirm: (f) => `ഒന്ന് നോക്കണം: കസ്റ്റമർ ${phone(f)} (${need(f, "serviceName")}, ${slot(f)}) കലണ്ടറിൽ കയറിയില്ല, അതുകൊണ്ട് ബുക്ക് ആയിട്ടില്ല. അവരുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് രേഖപ്പെടുത്തിയിട്ടുണ്ട്. കലണ്ടറിൽ വീണ്ടും ശ്രമിക്കാൻ "retry ${need(f, "bookingRef")}" എന്ന് അയക്കൂ, അല്ലെങ്കിൽ ബുക്കിംഗ് റദ്ദാക്കി അഡ്വാൻസ് തിരികെ നൽകാൻ "approve ${need(f, "bookingRef")}" എന്ന് അയക്കൂ.`,
  owner_late_cancellation: (f) => `വൈകിയുള്ള റദ്ദാക്കൽ: കസ്റ്റമർ ${phone(f)} (${need(f, "serviceName")}, ${slot(f)}) തുടങ്ങാൻ ${need(f, "windowHours")} മണിക്കൂറിൽ കുറവുള്ളപ്പോൾ റദ്ദാക്കി. അഡ്വാൻസ് ${inr(f, "depositInr")}. തിരികെ നൽകാൻ "approve ${need(f, "bookingRef")}" എന്നും, അഡ്വാൻസ് വയ്ക്കാൻ "deny ${need(f, "bookingRef")}" എന്നും അയക്കൂ.`,
  owner_duplicate_payment: (f) => `അറിയിപ്പ്: കസ്റ്റമർ ${phone(f)}, ${need(f, "serviceName")} (${slot(f)}), അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികം അടച്ച ${inr(f, "refundInr")} തിരികെ നൽകി.`,
  // A late payment (the hold had ended and the time was taken) and a payment for a booking that was cancelled get one line: the owner can do nothing about either, the money is back.
  owner_payment_unused: (f) => `അറിയിപ്പ്: കസ്റ്റമർ ${phone(f)} ${inr(f, "depositInr")} അടച്ചു (${slot(f)}), പക്ഷേ ആ ബുക്കിംഗ് അപ്പോൾ തുറന്നിരുന്നില്ല (മാറ്റിവച്ച സമയം കഴിഞ്ഞിരുന്നു, അല്ലെങ്കിൽ റദ്ദാക്കിയിരുന്നു). ${inr(f, "refundInr")} തിരികെ നൽകി.`,
  // The slot could not be held, or the payment link could not be made: either way nothing is booked and the customer has been told to try again.
  owner_not_booked: (f) => `അറിയിപ്പ്: കസ്റ്റമർ ${phone(f)} (${need(f, "serviceName")}, ${slot(f)}) ബുക്ക് ചെയ്യാൻ പറ്റിയില്ല, കലണ്ടറോ പേയ്മെന്റ് ലിങ്കോ ശരിയായില്ല. ഒന്നും ബുക്ക് ആയിട്ടില്ല.`,
  owner_reschedule_failed: (f) => `അറിയിപ്പ്: കസ്റ്റമർ ${phone(f)} (${need(f, "serviceName")}) പുതിയ സമയത്തേക്ക് (${slot(f)}) കലണ്ടറിൽ മാറ്റാൻ പറ്റിയില്ല. ദയവായി അവരുടെ ബുക്കിംഗ് ഒന്ന് നോക്കൂ.`,
  owner_message_held: (f) => `അറിയിപ്പ്: ${phone(f)} നമ്പറിലേക്കുള്ള ഒരു മെസ്സേജ് ബുക്കിംഗ് രേഖയുമായി ചേരാത്തതുകൊണ്ട് ഞാൻ നിർത്തിവച്ചു. ഒന്നും അയച്ചിട്ടില്ല.`,
  owner_opted_out: (f) => `അറിയിപ്പ്: കസ്റ്റമർ ${phone(f)} STOP അയച്ചു, അതുകൊണ്ട് ഇനി അവർക്ക് മെസ്സേജ് അയക്കില്ല.`,
  owner_unknown_command: () => `ക്ഷമിക്കണം, മനസ്സിലായില്ല. "approve", "deny" അല്ലെങ്കിൽ "retry" എന്ന് എഴുതി അതിന് ശേഷം ബുക്കിംഗ് നമ്പർ അയക്കൂ.`,
  owner_day_bookings: (f) => dayList(f, { heading: { today: "ഇന്നത്തെ ബുക്കിംഗുകൾ:", tomorrow: "നാളത്തെ ബുക്കിംഗുകൾ:" }, none: { today: "ഇന്ന് ബുക്കിംഗുകളൊന്നും ഇല്ല.", tomorrow: "നാളെ ബുക്കിംഗുകളൊന്നും ഇല്ല." } }),
  owner_approval_done: (f) => `നന്ദി! ${phone(f)} നമ്പറിലേക്കുള്ള ${inr(f, "refundInr")} റീഫണ്ട് അയക്കുന്നുണ്ട്, അവരെ ഞാൻ അറിയിക്കാം.`,
  owner_approval_denied: (f) => `ശരി, ${phone(f)} നമ്പറിലേക്കുള്ള ${inr(f, "refundInr")} റീഫണ്ട് അയക്കില്ല. അവരെ ഞാൻ അറിയിക്കാം.`,
  owner_approval_expired: (f) => `ആ റീഫണ്ട് അഭ്യർത്ഥന (${inr(f, "refundInr")}, ${phone(f)}) നിങ്ങൾ മറുപടി തരുന്നതിന് മുമ്പ് തീർന്നുപോയി, അതുകൊണ്ട് ഒന്നും തിരികെ നൽകിയിട്ടില്ല.`,
  owner_approval_failed: () => "ക്ഷമിക്കണം, നിങ്ങളുടെ മറുപടി ഇപ്പോൾ സേവ് ചെയ്യാൻ പറ്റിയില്ല. കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് ഒന്നുകൂടി അയക്കൂ.",
  owner_approval_waiting: (f) => `നന്ദി, ${phone(f)} നമ്പറിലേക്കുള്ള ${inr(f, "refundInr")} റീഫണ്ടിന് നിങ്ങളുടെ അനുമതി രേഖപ്പെടുത്തി. മറ്റുള്ളവരിൽ നിന്ന് ഇനി വേണ്ട അനുമതികൾ: ${need(f, "approvalsLeft")}. അവ കിട്ടിയാൽ മാത്രമേ അയക്കൂ.`,
  owner_approval_closed: (f) => `മറുപടി വേണ്ട: ${phone(f)} നമ്പറിലേക്കുള്ള ${inr(f, "refundInr")} റീഫണ്ടിന് മറ്റുള്ളവർ അനുമതി നൽകി. നന്ദി!`,
  owner_approval_refused: (f) => `റീഫണ്ടിന് അനുമതി നൽകുന്നവരിൽ ഒരാൾ ${phone(f)} നമ്പറിലേക്കുള്ള ${inr(f, "refundInr")} റീഫണ്ടിന് "വേണ്ട" എന്ന് പറഞ്ഞു, അതുകൊണ്ട് അത് അയക്കില്ല. കസ്റ്റമറെ ഞാൻ അറിയിക്കാം.`,
  owner_refund_settled: (f) => `റീഫണ്ട് കഴിഞ്ഞു: ${phone(f)} നമ്പറിലേക്ക് ${inr(f, "refundInr")}. നിങ്ങളുടെ ഏജന്റ് സെറ്റ് ചെയ്ത വ്യക്തി ഇത് പരിശോധിച്ച് അയച്ചതായി രേഖപ്പെടുത്തി, അതുകൊണ്ട് ഇത് വീണ്ടും അയക്കില്ല.`,
  owner_wants_to_talk: (f) => `ഒരു കസ്റ്റമർ നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു: ${phone(f)}. സൗകര്യം പോലെ അവർക്ക് മെസ്സേജ് അയക്കൂ.`,
  owner_ai_allowance: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഈ മാസത്തെ AI പരിധി തീർന്നു, അതുകൊണ്ട് തൽക്കാലം ബട്ടണുകളും ലിസ്റ്റുകളും ഉപയോഗിച്ചാണ് ഞാൻ മറുപടി തരുന്നത്. ബുക്കിംഗ് തുടർന്നും എടുക്കും, നിങ്ങളുടെ എല്ലാ പരിധികളും ബാധകമാണ്. എന്നെ സെറ്റ് ചെയ്ത വ്യക്തിക്ക് അറിയാം. അടുത്ത മാസം പഴയതുപോലെ ആകും.`,
  owner_ai_off: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ മെസ്സേജുകൾ വായിക്കുന്ന AI തൽക്കാലം ഓഫ് ആണ്. ബട്ടണുകളും ലിസ്റ്റുകളും ഉപയോഗിച്ച് ഞാൻ ബുക്കിംഗ് എടുക്കുന്നത് തുടരും, നിങ്ങളുടെ എല്ലാ പരിധികളും ബാധകമാണ്. എന്നെ സെറ്റ് ചെയ്ത വ്യക്തിക്ക് അറിയാം.`,
  owner_ai_fault: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ മെസ്സേജുകൾ വായിക്കുന്ന AI ഇപ്പോൾ മറുപടി തരുന്നില്ല, അതുകൊണ്ട് ഞാൻ ബട്ടണുകളും ലിസ്റ്റുകളും ഉപയോഗിക്കുന്നു. ബുക്കിംഗ് തുടർന്നും എടുക്കും, നിങ്ങളുടെ എല്ലാ പരിധികളും ബാധകമാണ്. കുറച്ച് മിനിറ്റ് കഴിഞ്ഞ് ഞാൻ AI വീണ്ടും നോക്കും.`,
};

const kn: BaseSet = {
  menu: (f) => `ನಮಸ್ಕಾರ! ${f.businessName}-ಗೆ ಸ್ವಾಗತ. ನಮ್ಮ ಸೇವೆಗಳು: ${menuList(f)}. ನಿಮಗೆ ಯಾವುದು ಬೇಕು, ಯಾವಾಗ ಬೇಕು?`,
  ask_when: (f) => `${need(f, "serviceName")} ಯಾವಾಗ ಬೇಕು? ದಿನ ಮತ್ತು ಸಮಯ ತಿಳಿಸಿ.`,
  ask_new_time: () => "ಬೇರೆ ಯಾವ ದಿನ, ಯಾವ ಸಮಯ ನಿಮಗೆ ಆಗುತ್ತದೆ?",
  price_floor: (f) => `${need(f, "serviceName")} ಬೆಲೆ ${inr(f, "priceInr")}. ಕ್ಷಮಿಸಿ, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.`,
  confirm_details: (f) => `ಒಮ್ಮೆ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳುತ್ತೇನೆ: ${need(f, "serviceName")}, ${slot(f)}. ಮುಂದುವರಿಯಲು "ಹೌದು" ಎಂದು ಉತ್ತರಿಸಿ.`,
  // The gateway's link is https and WhatsApp makes it tappable; it goes on a line of its own, after the words, so the message reads first and the link is easy to tap.
  quote_and_link: (f) => `${need(f, "serviceName")} (${slot(f)}) ಖಾಲಿ ಇದೆ! ಬೆಲೆ ${inr(f, "priceInr")}. ಬುಕ್ ಮಾಡಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಟ್ಟಿ, ${need(f, "holdMinutes")} ನಿಮಿಷ ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸುತ್ತೇನೆ.\nಇಲ್ಲಿ ${inr(f, "depositInr")} ಪಾವತಿಸಿ: ${need(f, "link")}`,
  // After price_floor has already said the price, the quote does not repeat it.
  slot_and_link: (f) => `${slot(f)} ಖಾಲಿ ಇದೆ! ಬುಕ್ ಮಾಡಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಟ್ಟಿ, ${need(f, "holdMinutes")} ನಿಮಿಷ ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸುತ್ತೇನೆ.\nಇಲ್ಲಿ ${inr(f, "depositInr")} ಪಾವತಿಸಿ: ${need(f, "link")}`,
  already_waiting: (f) => `ನಿಮ್ಮ ಸ್ಲಾಟ್ (${slot(f)}) ಇನ್ನೂ ಕಾಯ್ದಿರಿಸಿದ್ದೇನೆ. ಬುಕ್ ಮಾಡಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಟ್ಟಿ.\nಇಲ್ಲಿ ${inr(f, "depositInr")} ಪಾವತಿಸಿ: ${need(f, "link")}`,
  slot_unavailable: (f) => `ಕ್ಷಮಿಸಿ, ${slot(f)} ಲಭ್ಯವಿಲ್ಲ. ಬೇರೆ ಯಾವ ಸಮಯ ನಿಮಗೆ ಆಗುತ್ತದೆ?`,
  outside_hours: (f) => `ಕ್ಷಮಿಸಿ, ${slot(f)} ನಾವು ಮುಚ್ಚಿರುತ್ತೇವೆ. ಬೇರೆ ಯಾವ ಸಮಯ ನಿಮಗೆ ಆಗುತ್ತದೆ?`,
  hold_failed: (f) => `ಕ್ಷಮಿಸಿ, ಈಗ ${slot(f)} ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸಲು ಆಗಲಿಲ್ಲ, ಹಾಗಾಗಿ ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಕೆಲವು ನಿಮಿಷ ಬಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
  link_failed: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ, ಹಾಗಾಗಿ ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ.",
  booked: (f) => `ಬುಕ್ ಆಗಿದೆ! ${need(f, "serviceName")}, ${slot(f)}. ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ. ಬರಲು ಆಗದಿದ್ದರೆ ಕನಿಷ್ಠ ${need(f, "windowHours")} ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿ, ಮುಂಗಡ ಹಣ ಮರಳಿ ಸಿಗುತ್ತದೆ.`,
  couldnt_confirm: (f) => `ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ, ಆದರೆ ನಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ${slot(f)} ಇನ್ನೂ ಖಚಿತವಾಗಿಲ್ಲ, ಹಾಗಾಗಿ ಬುಕ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ, ಅವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.`,
  hold_expired: (f) => `ಮುಂಗಡ ಹಣ ಸಮಯಕ್ಕೆ ಬರದ ಕಾರಣ ${slot(f)} ಸ್ಲಾಟ್ ಬಿಟ್ಟುಬಿಟ್ಟಿದ್ದೇನೆ. ಇನ್ನೂ ಬುಕ್ ಮಾಡಬೇಕಿದ್ದರೆ ನನಗೆ ಮೆಸೇಜ್ ಮಾಡಿ.`,
  slot_gone_refund: (f) => `ಕ್ಷಮಿಸಿ! ${slot(f)} ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದ ಮೇಲೆ ನಿಮ್ಮ ${inr(f, "depositInr")} ಪಾವತಿ ಬಂತು, ಈಗ ಆ ಸಮಯ ಬೇರೆಯವರಿಗೆ ಹೋಗಿದೆ. ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಿದ್ದೇವೆ.`,
  refund_unbooked: (f) => `ನಿಮ್ಮ ${inr(f, "depositInr")} ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಅದಕ್ಕೆ ಯಾವ ಬುಕಿಂಗ್ ಕೂಡ ತೆರೆದಿಲ್ಲ. ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಿದ್ದೇವೆ.`,
  reschedule_failed: (f) => `ಕ್ಷಮಿಸಿ, ನಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ನಿಮ್ಮ ಬುಕಿಂಗ್ ಬದಲಾಯಿಸಲು ಆಗಲಿಲ್ಲ (ಹೊಸ ಸಮಯ: ${slot(f)}). ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ, ಅವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.`,
  duplicate_refund: (f) => `ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಕಟ್ಟಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಿದ್ದೇವೆ.`,
  duplicate_refund_pending: (f) => `ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಕಟ್ಟಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮಾಲೀಕರು ಒಪ್ಪಿದ ಮೇಲೆ ನಿಮಗೆ ಮರಳಿ ಬರುತ್ತದೆ.`,
  cancelled_refund: (f) => `ಆಯಿತು, ನಿಮ್ಮ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ನಿಮ್ಮ ${inr(f, "refundInr")} ಮುಂಗಡ ಹಣವನ್ನು ಮರಳಿ ಕಳುಹಿಸುತ್ತಿದ್ದೇವೆ.`,
  cancelled_refund_pending: (f) => `ಆಯಿತು, ನಿಮ್ಮ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಬಗ್ಗೆ ಮಾಲೀಕರು ಸ್ವಲ್ಪ ಹೊತ್ತಿನಲ್ಲೇ ಖಚಿತಪಡಿಸುತ್ತಾರೆ.`,
  cancelled_late: (f) => `ಆಯಿತು, ನಿಮ್ಮ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ಶುರುವಾಗಲು ${need(f, "windowHours")} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಸಮಯ ಇರುವುದರಿಂದ, ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣದ ಬಗ್ಗೆ ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿ ನಿಮಗೆ ತಿಳಿಸುತ್ತಾರೆ.`,
  cancelled_no_deposit: (f) => `ಆಯಿತು, ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ನಿಮ್ಮಿಂದ ಯಾವ ಹಣವೂ ಪಡೆದಿಲ್ಲ.`,
  no_booking_found: () => "ಬದಲಾಯಿಸಲು ಯಾವ ಬುಕಿಂಗ್ ಕೂಡ ಸಿಗಲಿಲ್ಲ. ಸೇವೆ, ದಿನ, ಸಮಯ ತಿಳಿಸಿ, ನಾನು ಬುಕ್ ಮಾಡುತ್ತೇನೆ.",
  refund_approved: (f) => `ಒಳ್ಳೆಯ ಸುದ್ದಿ: ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಒಪ್ಪಿದ್ದಾರೆ. ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಬರುತ್ತಿದೆ.`,
  refund_denied: (f) => `ಕ್ಷಮಿಸಿ, ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣವನ್ನು ಮರಳಿ ಕೊಡದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ.`,
  rescheduled: (f) => `ಆಯಿತು! ${need(f, "serviceName")} ಹೊಸ ಸಮಯ: ${slot(f)}.`,
  reminder: (f) => `ನಮಸ್ಕಾರ! ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ: ${f.businessName}-ನಲ್ಲಿ ನಿಮ್ಮ ${need(f, "serviceName")} ಬುಕಿಂಗ್ ಇದೆ (${slot(f)}). ಅಲ್ಲಿ ಸಿಗೋಣ!`,
  didnt_understand: () => "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಯಾವ ಸೇವೆ ಬೇಕು, ಯಾವ ದಿನ, ಯಾವ ಸಮಯಕ್ಕೆ?",
  voice_note: () => "ಕ್ಷಮಿಸಿ, ನನಗೆ ಇನ್ನೂ ವಾಯ್ಸ್ ನೋಟ್ ಕೇಳಲು ಆಗುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಟೈಪ್ ಮಾಡಿ ಕಳುಹಿಸುತ್ತೀರಾ?",
  voice_note_retry: () => "ಕ್ಷಮಿಸಿ, ಆ ವಾಯ್ಸ್ ನೋಟ್ ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಟೈಪ್ ಮಾಡಿ ಕಳುಹಿಸುತ್ತೀರಾ?",
  pick_service: (f) => `ನಮಸ್ಕಾರ! ${f.businessName}-ಗೆ ಸ್ವಾಗತ. ಯಾವ ಸೇವೆ ಬುಕ್ ಮಾಡಬೇಕು?`,
  pick_slot: (f) => `${need(f, "serviceName")} ಯಾವಾಗ ಬೇಕು? ಕೆಳಗಿನಿಂದ ಒಂದು ಸಮಯ ಆರಿಸಿ, ಅಥವಾ ನಿಮಗೆ ಬೇಕಾದ ದಿನ, ಸಮಯ ಟೈಪ್ ಮಾಡಿ.`,
  confirm_buttons: (f) => `ಒಮ್ಮೆ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳುತ್ತೇನೆ: ${need(f, "serviceName")}, ${slot(f)}. ಸರಿಯೇ?`,
  ask_cancel: (f) => `ನಿಮ್ಮ ಬುಕಿಂಗ್ (${slot(f)}) ರದ್ದು ಮಾಡಬೇಕೇ?`,
  kept: (f) => `ಸರಿ, ನಿಮ್ಮ ಬುಕಿಂಗ್ (${slot(f)}) ಹಾಗೆಯೇ ಇರುತ್ತದೆ.`,
  told_owner: () => "ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತಾರೆ.",
  couldnt_tell_owner: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಲು ಆಗಲಿಲ್ಲ. ಕೆಲವು ನಿಮಿಷ ಬಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  refund_checking: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇವೆ. ಖಚಿತವಾದ ತಕ್ಷಣ ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.`,
  refund_confirmed: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಖಚಿತವಾಗಿದೆ, ಅದು ನಿಮಗೆ ಮರಳಿ ಬರುತ್ತಿದೆ.`,
  refund_expired: (f) => `ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಬಗ್ಗೆ ಮಾಲೀಕರು ಸಮಯಕ್ಕೆ ಉತ್ತರಿಸಲಿಲ್ಲ, ಹಾಗಾಗಿ ಅದನ್ನು ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು ${f.businessName} ಅವರನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ.`,

  owner_refund_needs_approval: (f) => `ಒಪ್ಪಿಗೆ ಬೇಕು: ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್ (${need(f, "serviceName")}, ${slot(f)}). ${need(f, "approvalHours")} ಗಂಟೆಯೊಳಗೆ "approve ${need(f, "approvalCode")}" ಅಥವಾ "deny ${need(f, "approvalCode")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_cant_confirm: (f) => `ಗಮನಿಸಿ: ${phone(f)} ಅವರ ${need(f, "serviceName")} ಬುಕಿಂಗ್ (${slot(f)}) ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಸೇರಲಿಲ್ಲ, ಹಾಗಾಗಿ ಬುಕ್ ಆಗಿಲ್ಲ. ಅವರ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ದಾಖಲಾಗಿದೆ. ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು "retry ${need(f, "bookingRef")}" ಎಂದು, ಬುಕಿಂಗ್ ರದ್ದು ಮಾಡಿ ಮುಂಗಡ ಹಣ ಮರಳಿ ಕೊಡಲು "approve ${need(f, "bookingRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_late_cancellation: (f) => `ತಡವಾದ ರದ್ದತಿ: ${phone(f)} ಅವರು ${need(f, "serviceName")} ಬುಕಿಂಗ್ (${slot(f)}) ಶುರುವಾಗಲು ${need(f, "windowHours")} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಇರುವಾಗ ರದ್ದು ಮಾಡಿದ್ದಾರೆ. ಅವರ ಮುಂಗಡ ಹಣ ${inr(f, "depositInr")}. ಮರಳಿ ಕೊಡಲು "approve ${need(f, "bookingRef")}" ಎಂದು, ಇಟ್ಟುಕೊಳ್ಳಲು "deny ${need(f, "bookingRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_duplicate_payment: (f) => `ಗಮನಿಸಿ: ${phone(f)} ಅವರು ${need(f, "serviceName")} ಬುಕಿಂಗ್‌ಗೆ (${slot(f)}) ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಕಟ್ಟಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಅವರಿಗೆ ಮರಳಿ ಕಳುಹಿಸಲಾಗಿದೆ.`,
  // A late payment (the hold had ended and the time was taken) and a payment for a booking that was cancelled get one line: the owner can do nothing about either, the money is back.
  owner_payment_unused: (f) => `ಗಮನಿಸಿ: ${phone(f)} ಅವರು ${inr(f, "depositInr")} ಕಟ್ಟಿದ್ದಾರೆ (ಬುಕಿಂಗ್: ${slot(f)}), ಆದರೆ ಆ ಬುಕಿಂಗ್ ಆಗ ತೆರೆದಿರಲಿಲ್ಲ (ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದಿತ್ತು, ಅಥವಾ ರದ್ದಾಗಿತ್ತು). ${inr(f, "refundInr")} ಅವರಿಗೆ ಮರಳಿ ಕಳುಹಿಸಲಾಗಿದೆ.`,
  // The slot could not be held, or the payment link could not be made: either way nothing is booked and the customer has been told to try again.
  owner_not_booked: (f) => `ಗಮನಿಸಿ: ${phone(f)} ಅವರಿಗೆ ${need(f, "serviceName")} ಬುಕಿಂಗ್ (${slot(f)}) ಸಿದ್ಧಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಏಕೆಂದರೆ ಕ್ಯಾಲೆಂಡರ್ ಅಥವಾ ಪಾವತಿ ಲಿಂಕ್ ಕೆಲಸ ಮಾಡಲಿಲ್ಲ. ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ.`,
  owner_reschedule_failed: (f) => `ಗಮನಿಸಿ: ${phone(f)} ಅವರ ${need(f, "serviceName")} ಬುಕಿಂಗ್ ಅನ್ನು ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಬದಲಾಯಿಸಲು ಆಗಲಿಲ್ಲ (ಹೊಸ ಸಮಯ: ${slot(f)}). ದಯವಿಟ್ಟು ಅವರ ಬುಕಿಂಗ್ ನೋಡಿ.`,
  owner_message_held: (f) => `ಗಮನಿಸಿ: ${phone(f)} ಅವರಿಗೆ ಕಳುಹಿಸಬೇಕಿದ್ದ ಒಂದು ಮೆಸೇಜ್ ಬುಕಿಂಗ್ ದಾಖಲೆಗೆ ಹೊಂದಿಕೆಯಾಗದ ಕಾರಣ ತಡೆಹಿಡಿದಿದ್ದೇನೆ. ಏನೂ ಕಳುಹಿಸಿಲ್ಲ.`,
  owner_opted_out: (f) => `ಗಮನಿಸಿ: ${phone(f)} ಅವರು STOP ಕಳುಹಿಸಿದ್ದಾರೆ, ಹಾಗಾಗಿ ಇನ್ನು ಅವರಿಗೆ ಮೆಸೇಜ್ ಮಾಡುವುದಿಲ್ಲ.`,
  owner_unknown_command: () => `ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. "approve", "deny" ಅಥವಾ "retry" ಎಂದು ಬರೆದು, ಅದರ ಜೊತೆ ಬುಕಿಂಗ್ ನಂಬರ್ ಬರೆಯಿರಿ.`,
  owner_day_bookings: (f) => dayList(f, { heading: { today: "ಇಂದಿನ ಬುಕಿಂಗ್‌ಗಳು:", tomorrow: "ನಾಳೆಯ ಬುಕಿಂಗ್‌ಗಳು:" }, none: { today: "ಇಂದು ಬುಕಿಂಗ್‌ಗಳು ಇಲ್ಲ.", tomorrow: "ನಾಳೆ ಬುಕಿಂಗ್‌ಗಳು ಇಲ್ಲ." } }),
  owner_approval_done: (f) => `ಧನ್ಯವಾದ! ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸುತ್ತಿದ್ದೇವೆ, ಅವರಿಗೆ ತಿಳಿಸುತ್ತೇನೆ.`,
  owner_approval_denied: (f) => `ಸರಿ, ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಅವರಿಗೆ ತಿಳಿಸುತ್ತೇನೆ.`,
  owner_approval_expired: (f) => `ಆ ರೀಫಂಡ್ ಬೇಡಿಕೆ (${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")}) ನೀವು ಉತ್ತರಿಸುವ ಮೊದಲೇ ಮುಗಿದುಹೋಯಿತು, ಹಾಗಾಗಿ ಏನೂ ರೀಫಂಡ್ ಆಗಿಲ್ಲ.`,
  owner_approval_failed: () => "ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ಉತ್ತರ ಈಗ ಉಳಿಸಲು ಆಗಲಿಲ್ಲ. ಕೆಲವು ನಿಮಿಷ ಬಿಟ್ಟು ಮತ್ತೆ ಕಳುಹಿಸಿ.",
  owner_approval_waiting: (f) => `ಧನ್ಯವಾದ, ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕೊಡಲು ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ದಾಖಲಾಗಿದೆ. ಇತರರಿಂದ ಇನ್ನೂ ಬೇಕಾದ ಒಪ್ಪಿಗೆ: ${need(f, "approvalsLeft")}. ಅವರ ಒಪ್ಪಿಗೆ ಬಂದ ಮೇಲೆಯೇ ಹಣ ಹೋಗುತ್ತದೆ.`,
  owner_approval_closed: (f) => `ಉತ್ತರಿಸುವ ಅಗತ್ಯವಿಲ್ಲ: ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್‌ಗೆ ಇತರರು ಈಗಾಗಲೇ ಒಪ್ಪಿದ್ದಾರೆ. ಧನ್ಯವಾದ!`,
  owner_approval_refused: (f) => `ಒಪ್ಪಿಗೆ ಕೊಡುವವರಲ್ಲಿ ಒಬ್ಬರು ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಬೇಡ ಎಂದಿದ್ದಾರೆ, ಹಾಗಾಗಿ ಅದನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ. ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸುತ್ತೇನೆ.`,
  owner_refund_settled: (f) => `ರೀಫಂಡ್ ಆಗಿದೆ: ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")}. ನಿಮ್ಮ ಏಜೆಂಟ್ ಸಿದ್ಧಪಡಿಸಿದವರು ಇದನ್ನು ನೋಡಿ ಆಗಿದೆ ಎಂದು ಗುರುತಿಸಿದ್ದಾರೆ, ಹಾಗಾಗಿ ಇದು ಎರಡನೇ ಬಾರಿ ಹೋಗುವುದಿಲ್ಲ.`,
  owner_wants_to_talk: (f) => `ಒಬ್ಬ ಗ್ರಾಹಕರು ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ: ${phone(f)}. ಸಾಧ್ಯವಾದಾಗ ಅವರಿಗೆ ಮೆಸೇಜ್ ಮಾಡಿ.`,
  owner_ai_allowance: (f) => `ಗಮನಿಸಿ: ${f.businessName}-ನ ಈ ತಿಂಗಳ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಹಾಗಾಗಿ ಈಗ ಬಟನ್ ಮತ್ತು ಪಟ್ಟಿಗಳ ಮೂಲಕ ಉತ್ತರಿಸುತ್ತಿದ್ದೇನೆ. ಬುಕಿಂಗ್ ಇನ್ನೂ ತೆಗೆದುಕೊಳ್ಳುತ್ತೇನೆ, ನಿಮ್ಮ ಎಲ್ಲಾ ಮಿತಿಗಳೂ ಹಾಗೆಯೇ ಇರುತ್ತವೆ. ನನ್ನನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ಗೊತ್ತಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಎಂದಿನಂತೆ ನಡೆಯುತ್ತದೆ.`,
  owner_ai_off: (f) => `ಗಮನಿಸಿ: ${f.businessName}-ನ ಮೆಸೇಜ್ ಓದುವ AI ಸದ್ಯಕ್ಕೆ ಆಫ್ ಆಗಿದೆ. ಬಟನ್ ಮತ್ತು ಪಟ್ಟಿಗಳಿಂದ ಬುಕಿಂಗ್ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ, ನಿಮ್ಮ ಎಲ್ಲಾ ಮಿತಿಗಳೂ ಹಾಗೆಯೇ ಇರುತ್ತವೆ. ನನ್ನನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ಗೊತ್ತಿದೆ.`,
  owner_ai_fault: (f) => `ಗಮನಿಸಿ: ${f.businessName}-ನ ಮೆಸೇಜ್ ಓದುವ AI ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ, ಹಾಗಾಗಿ ಬಟನ್ ಮತ್ತು ಪಟ್ಟಿಗಳನ್ನು ಬಳಸುತ್ತಿದ್ದೇನೆ. ಬುಕಿಂಗ್ ಇನ್ನೂ ತೆಗೆದುಕೊಳ್ಳುತ್ತೇನೆ, ನಿಮ್ಮ ಎಲ್ಲಾ ಮಿತಿಗಳೂ ಹಾಗೆಯೇ ಇರುತ್ತವೆ. ಕೆಲವು ನಿಮಿಷ ಬಿಟ್ಟು AI ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುತ್ತೇನೆ.`,
};

// ---- UPI, marked paid by the owner (plan B33; modules/payments/owner-marked) ------------------------------------------------------------
// A shop that takes UPI: the customer pays the shop's own UPI ID, and the booking is made only when the owner taps "Received" (or replies "received <code>"). These
// messages never say a payment was checked by the agent: the owner confirms it. A refund is sent by the owner from their own UPI app, and the customer hears "sent"
// only after the owner marks it so. The owner's lines start and end with fixed words, as every owner line does (several are WhatsApp templates: meta-templates.ts).
// The customer's words carry the UPI ID and the payee in plain text, and never the `upi://` link itself (WhatsApp does not open it): the QR picture of that link goes
// just before the words when it can (agent.ts qrOf; a booking page draws its own button and QR). The owner's one-use code is written once, at the end, as the typed
// stand-in for the button ("(or reply: received 7P52KF)"); no customer line carries it, and no customer line names the booking's id.
// The owner's claim, part, marked, late, refund-marked and refund-kept lines name only the amount, the customer's number and the code: the UPI desk for an agent
// someone else wrote (modules/payments/owner-marked/desk.ts, bundle/services/desk.ts) sends the same lines with no service or slot (and the last two with no number),
// so a line that needed them would not be written at all and the owner would not be told.
// Hindi, Malayalam and Kannada are machine-written, like the rest of those packs, and wait for a native speaker's review (REVIEW-ml.md, REVIEW-kn.md).

const payee = (f: MessageFacts) => need(f, "payee");
const upiId = (f: MessageFacts) => need(f, "upiId");
const code = (f: MessageFacts) => need(f, "upiCode");
const marked = (f: MessageFacts) => formatInr(need(f, "markedInr"));
const left = (f: MessageFacts) => formatInr(need(f, "leftInr"));

const upiEn: UpiSet = {
  upi_quote_and_link: (f) => `${Service(f)} on ${slot(f)} is free! It's ${inr(f, "priceInr")}. Pay a ${inr(f, "depositInr")} deposit to book it, and I'll hold the slot for ${need(f, "holdMinutes")} minutes.\nUPI ID: ${upiId(f)} (${payee(f)})\nThe owner will confirm your payment, then I'll message you.`,
  upi_slot_and_link: (f) => `${slot(f)} is free! Pay a ${inr(f, "depositInr")} deposit to book it, and I'll hold the slot for ${need(f, "holdMinutes")} minutes.\nUPI ID: ${upiId(f)} (${payee(f)})\nThe owner will confirm your payment, then I'll message you.`,
  upi_already_waiting: (f) => `I'm still holding ${slot(f)} for you. Pay the ${inr(f, "depositInr")} deposit to book it.\nUPI ID: ${upiId(f)} (${payee(f)})\nThe owner will confirm your payment, then I'll message you.`,
  upi_qr_caption: (f) => `Scan to pay the ${inr(f, "depositInr")} deposit to ${payee(f)} by UPI.`,
  upi_booked: (f) => `You're booked! ${Service(f)}, ${slot(f)}. The owner has confirmed your ${inr(f, "depositInr")} deposit. Can't make it? Cancel at least ${need(f, "windowHours")} hours before and your deposit comes back.`,
  upi_paid_claim: (f) => `Thanks! The owner will check their UPI app for your ${inr(f, "depositInr")}, then I'll message you. Please wait for that message: a screenshot alone isn't proof of payment.`,
  upi_nothing_waiting: () => "Thanks! I don't have a UPI payment waiting from you right now, so there's nothing for the owner to confirm. If you paid for something else, please talk to the owner.",
  upi_hold_expired: (f) => `I've let go of ${slot(f)}, as the owner hadn't confirmed your deposit in time. If you've already paid, the owner will get in touch. Message me if you'd still like to book.`,
  upi_late_received: (f) => `The owner confirmed your ${marked(f)} payment, but only after the hold on ${slot(f)} had ended, so it's not booked. The owner will get in touch about booking again or sending your money back.`,
  upi_refund_owed: (f) => `The owner will send ${inr(f, "refundInr")} back to you by UPI. I'll message you once they mark it as sent.`,
  upi_cancelled_refund_owed: (f) => `Done, your booking for ${slot(f)} is cancelled. The owner will send your ${inr(f, "refundInr")} back by UPI, and I'll message you once they mark it as sent.`,
  upi_extra_refund_owed: (f) => `You paid more than the deposit. The owner will send the extra ${inr(f, "refundInr")} back to you by UPI, and I'll message you once they mark it as sent.`,
  upi_refund_sent: (f) => `The owner has marked your ${inr(f, "refundInr")} refund as sent by UPI. Please check your UPI app.`,

  owner_upi_expected: (f) => `New booking to check: ${need(f, "serviceName")}, ${slot(f)}, ${phone(f)}. They'll pay a ${inr(f, "depositInr")} deposit by UPI. When you see it in your UPI app, tap Received (or reply: received ${code(f)}, adding the amount if it's different).`,
  owner_upi_claim: (f) => `A customer says they've paid: ${inr(f, "depositInr")} from ${phone(f)}. Please check your UPI app first (a screenshot isn't proof), then tap Received (or reply: received ${code(f)}).`,
  owner_upi_marked: (f) => `Got it: you marked ${marked(f)} from ${phone(f)} as received. Thank you!`,
  owner_upi_part: (f) => `You marked ${marked(f)} from ${phone(f)}, but the deposit is ${inr(f, "depositInr")}, so it's not booked yet. I'll keep holding the slot until the hold ends. When the other ${left(f)} comes in, tap Received (or reply: received ${code(f)}).`,
  owner_upi_already: () => "That payment is already marked, so it counts only once.",
  owner_upi_unknown: () => "Sorry, I don't recognise that code. Please use the one in my latest message about this payment.",
  owner_upi_late: (f) => `You marked ${marked(f)} from ${phone(f)} as received after their hold had ended, so it wasn't booked by itself. Please book them yourself, or send the ${inr(f, "refundInr")} back by UPI. Then tap Refund sent or Kept for booking (or reply: refunded ${code(f)} or kept ${code(f)}).`,
  owner_upi_refund_owed: (f) => `Refund to send: ${inr(f, "refundInr")} by UPI to ${phone(f)}. I never send money myself. Once you've sent it, tap Refund sent (or reply: refunded ${code(f)}).`,
  owner_upi_refund_reminder: (f) => `Reminder: ${inr(f, "refundInr")} is still owed back to ${phone(f)}. Once you've sent it by UPI, tap Refund sent (or reply: refunded ${code(f)}).`,
  owner_upi_refund_marked: (f) => `Thanks! The ${inr(f, "refundInr")} refund is marked as sent, and the customer has been told.`,
  owner_upi_refund_kept: (f) => `Noted: you're keeping the ${inr(f, "refundInr")} for a booking you make yourself. Nothing more is owed back.`,
};

const upiHi: UpiSet = {
  upi_quote_and_link: (f) => `${need(f, "serviceName")} के लिए ${slot(f)} खाली है! कीमत ${inr(f, "priceInr")} है। बुक करने के लिए ${inr(f, "depositInr")} जमा करें, मैं स्लॉट ${need(f, "holdMinutes")} मिनट रोककर रखूँगा।\nUPI ID: ${upiId(f)} (${payee(f)})\nमालिक आपका पेमेंट पक्का करेंगे, फिर मैं आपको मैसेज करूँगा।`,
  upi_slot_and_link: (f) => `${slot(f)} खाली है! बुक करने के लिए ${inr(f, "depositInr")} जमा करें, मैं स्लॉट ${need(f, "holdMinutes")} मिनट रोककर रखूँगा।\nUPI ID: ${upiId(f)} (${payee(f)})\nमालिक आपका पेमेंट पक्का करेंगे, फिर मैं आपको मैसेज करूँगा।`,
  upi_already_waiting: (f) => `आपका ${slot(f)} का स्लॉट अभी रोका हुआ है। बुक करने के लिए ${inr(f, "depositInr")} जमा कर दीजिए।\nUPI ID: ${upiId(f)} (${payee(f)})\nमालिक आपका पेमेंट पक्का करेंगे, फिर मैं आपको मैसेज करूँगा।`,
  upi_qr_caption: (f) => `${payee(f)} को UPI से ${inr(f, "depositInr")} जमा करने के लिए स्कैन करें।`,
  upi_booked: (f) => `बुक हो गया! ${need(f, "serviceName")}, ${slot(f)}। मालिक ने आपका ${inr(f, "depositInr")} जमा पक्का कर दिया है। नहीं आ पा रहे? शुरू होने से कम से कम ${need(f, "windowHours")} घंटे पहले रद्द कर दीजिए, आपका जमा वापस मिल जाएगा।`,
  upi_paid_claim: (f) => `शुक्रिया! मालिक अपने UPI ऐप में आपके ${inr(f, "depositInr")} देखेंगे, फिर मैं आपको मैसेज करूँगा। कृपया उस मैसेज का इंतज़ार कीजिए, क्योंकि सिर्फ़ स्क्रीनशॉट से पेमेंट पक्का नहीं होता।`,
  upi_nothing_waiting: () => "शुक्रिया! अभी आपका कोई UPI पेमेंट पक्का होने का इंतज़ार नहीं कर रहा, इसलिए मालिक के पास पक्का करने को कुछ नहीं है। अगर आपने किसी और चीज़ के लिए पैसे भेजे हैं, तो मालिक से बात कर लीजिए।",
  upi_hold_expired: (f) => `${slot(f)} का स्लॉट मैंने छोड़ दिया है, क्योंकि मालिक ने समय पर आपका जमा पक्का नहीं किया। अगर आप पैसे भेज चुके हैं, तो मालिक आपसे बात करेंगे। अब भी बुक करना चाहें तो मुझे लिख दीजिए।`,
  upi_late_received: (f) => `मालिक ने आपका ${marked(f)} का पेमेंट ${slot(f)} की रोक खत्म होने के बाद पक्का किया, इसलिए बुकिंग नहीं हुई है। दोबारा बुकिंग या पैसे वापस भेजने के बारे में मालिक आपसे बात करेंगे।`,
  upi_refund_owed: (f) => `मालिक ${inr(f, "refundInr")} UPI से आपको वापस भेजेंगे। जब वे भेजा हुआ दर्ज कर देंगे, मैं आपको मैसेज करूँगा।`,
  upi_cancelled_refund_owed: (f) => `हो गया, ${slot(f)} की आपकी बुकिंग रद्द हो गई। मालिक आपका ${inr(f, "refundInr")} UPI से वापस भेजेंगे, और भेजा हुआ दर्ज करते ही मैं आपको मैसेज करूँगा।`,
  upi_extra_refund_owed: (f) => `आपने जमा से ज़्यादा भेज दिया है। मालिक एक्स्ट्रा ${inr(f, "refundInr")} UPI से वापस भेजेंगे, और भेजा हुआ दर्ज करते ही मैं आपको मैसेज करूँगा।`,
  upi_refund_sent: (f) => `मालिक ने आपका ${inr(f, "refundInr")} का रिफंड UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देख लीजिए।`,

  owner_upi_expected: (f) => `जाँचने के लिए नई बुकिंग: ${need(f, "serviceName")}, ${slot(f)}, ग्राहक ${phone(f)}। वे UPI से ${inr(f, "depositInr")} जमा भेजेंगे। अपने UPI ऐप में दिखे तो "मिल गया" दबाइए (या लिखिए: received ${code(f)}; रकम अलग हो तो उसे साथ में लिख दीजिए)।`,
  owner_upi_claim: (f) => `ग्राहक कह रहे हैं कि पेमेंट कर दिया है: ${phone(f)} से ${inr(f, "depositInr")}। पहले अपना UPI ऐप देख लीजिए (स्क्रीनशॉट सबूत नहीं होता), फिर "मिल गया" दबाइए (या लिखिए: received ${code(f)})।`,
  owner_upi_marked: (f) => `समझ गया: आपने ग्राहक ${phone(f)} के ${marked(f)} मिला हुआ दर्ज कर दिया। शुक्रिया!`,
  owner_upi_part: (f) => `आपने ग्राहक ${phone(f)} के ${marked(f)} दर्ज किए, पर जमा ${inr(f, "depositInr")} है, इसलिए अभी बुकिंग नहीं हुई। रोक खत्म होने तक मैं स्लॉट रोककर रखूँगा। बाकी ${left(f)} आ जाए तो "मिल गया" दबाइए (या लिखिए: received ${code(f)})।`,
  owner_upi_already: () => "यह पेमेंट पहले ही दर्ज हो चुका है, इसलिए एक ही बार गिना जाएगा।",
  owner_upi_unknown: () => "माफ़ कीजिए, यह कोड मैं पहचान नहीं पाया। इस पेमेंट के बारे में मेरे सबसे नए मैसेज वाला कोड भेजिए।",
  owner_upi_late: (f) => `आपने ग्राहक ${phone(f)} के ${marked(f)} उनकी रोक खत्म होने के बाद मिला हुआ दर्ज किए, इसलिए बुकिंग अपने-आप नहीं हुई। कृपया उनकी बुकिंग खुद कर दीजिए, या ${inr(f, "refundInr")} UPI से वापस भेज दीजिए। फिर "रिफंड भेज दिया" या "बुकिंग के लिए रखा" दबाइए (या लिखिए: refunded ${code(f)} या kept ${code(f)})।`,
  owner_upi_refund_owed: (f) => `वापस भेजना है: ग्राहक ${phone(f)} को UPI से ${inr(f, "refundInr")}। मैं खुद कभी पैसे नहीं भेजता। आप भेज दें तो "रिफंड भेज दिया" दबाइए (या लिखिए: refunded ${code(f)})।`,
  owner_upi_refund_reminder: (f) => `याद दिलाना: ग्राहक ${phone(f)} को ${inr(f, "refundInr")} अभी भी वापस देना बाकी है। UPI से भेज दें तो "रिफंड भेज दिया" दबाइए (या लिखिए: refunded ${code(f)})।`,
  owner_upi_refund_marked: (f) => `शुक्रिया! ${inr(f, "refundInr")} का रिफंड भेजा हुआ दर्ज हो गया, और ग्राहक को बता दिया गया है।`,
  owner_upi_refund_kept: (f) => `ठीक है: ${inr(f, "refundInr")} आप अपनी खुद की बुकिंग के लिए रख रहे हैं। अब कुछ वापस देना बाकी नहीं है।`,
};

const upiMl: UpiSet = {
  upi_quote_and_link: (f) => `${need(f, "serviceName")}, ${slot(f)} ഒഴിവുണ്ട്! വില ${inr(f, "priceInr")}. ബുക്ക് ചെയ്യാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ, ${need(f, "holdMinutes")} മിനിറ്റ് ഈ സ്ലോട്ട് ഞാൻ നിങ്ങൾക്കായി മാറ്റിവയ്ക്കാം.\nUPI ID: ${upiId(f)} (${payee(f)})\nനിങ്ങളുടെ പേയ്മെന്റ് ഉടമ ഉറപ്പിക്കും, അതിനുശേഷം ഞാൻ മെസ്സേജ് അയക്കാം.`,
  upi_slot_and_link: (f) => `${slot(f)} ഒഴിവുണ്ട്! ബുക്ക് ചെയ്യാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ, ${need(f, "holdMinutes")} മിനിറ്റ് ഈ സ്ലോട്ട് ഞാൻ നിങ്ങൾക്കായി മാറ്റിവയ്ക്കാം.\nUPI ID: ${upiId(f)} (${payee(f)})\nനിങ്ങളുടെ പേയ്മെന്റ് ഉടമ ഉറപ്പിക്കും, അതിനുശേഷം ഞാൻ മെസ്സേജ് അയക്കാം.`,
  upi_already_waiting: (f) => `${slot(f)} ഇപ്പോഴും നിങ്ങൾക്കായി മാറ്റിവച്ചിട്ടുണ്ട്. ബുക്ക് ചെയ്യാൻ ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കൂ.\nUPI ID: ${upiId(f)} (${payee(f)})\nനിങ്ങളുടെ പേയ്മെന്റ് ഉടമ ഉറപ്പിക്കും, അതിനുശേഷം ഞാൻ മെസ്സേജ് അയക്കാം.`,
  upi_qr_caption: (f) => `UPI വഴി ${inr(f, "depositInr")} അഡ്വാൻസ് അടയ്ക്കാൻ സ്കാൻ ചെയ്യൂ (${payee(f)}).`,
  upi_booked: (f) => `ബുക്ക് ആയി! ${need(f, "serviceName")}, ${slot(f)}. നിങ്ങളുടെ ${inr(f, "depositInr")} അഡ്വാൻസ് ഉടമ ഉറപ്പിച്ചു. വരാൻ പറ്റില്ലെങ്കിൽ ${need(f, "windowHours")} മണിക്കൂർ മുമ്പെങ്കിലും റദ്ദാക്കൂ, അഡ്വാൻസ് തിരികെ കിട്ടും.`,
  upi_paid_claim: (f) => `നന്ദി! ഉടമ അവരുടെ UPI ആപ്പിൽ നിങ്ങളുടെ ${inr(f, "depositInr")} നോക്കും, അതിനുശേഷം ഞാൻ മെസ്സേജ് അയക്കാം. ആ മെസ്സേജ് വരുന്നത് വരെ കാത്തിരിക്കൂ: സ്ക്രീൻഷോട്ട് മാത്രം പേയ്മെന്റിന്റെ തെളിവാകില്ല.`,
  upi_nothing_waiting: () => "നന്ദി! ഇപ്പോൾ നിങ്ങളുടെ UPI പേയ്മെന്റ് ഒന്നും കാത്തിരിക്കുന്നില്ല, അതുകൊണ്ട് ഉടമയ്ക്ക് ഉറപ്പിക്കാൻ ഒന്നുമില്ല. വേറെ എന്തിനെങ്കിലും പണം അടച്ചതാണെങ്കിൽ ദയവായി ഉടമയോട് സംസാരിക്കൂ.",
  upi_hold_expired: (f) => `ഉടമ സമയത്തിനുള്ളിൽ അഡ്വാൻസ് ഉറപ്പിക്കാത്തതുകൊണ്ട് ${slot(f)} ഞാൻ വിട്ടുകൊടുത്തു. നിങ്ങൾ പണം അടച്ചിട്ടുണ്ടെങ്കിൽ ഉടമ നിങ്ങളെ ബന്ധപ്പെടും. ഇനിയും ബുക്ക് ചെയ്യണമെങ്കിൽ എനിക്ക് മെസ്സേജ് അയക്കൂ.`,
  upi_late_received: (f) => `നിങ്ങളുടെ ${marked(f)} പേയ്മെന്റ് ഉടമ ഉറപ്പിച്ചത് സ്ലോട്ട് (${slot(f)}) മാറ്റിവച്ച സമയം കഴിഞ്ഞാണ്, അതുകൊണ്ട് ബുക്ക് ആയിട്ടില്ല. വീണ്ടും ബുക്ക് ചെയ്യുന്ന കാര്യമോ പണം തിരികെ അയക്കുന്ന കാര്യമോ ഉടമ നിങ്ങളെ ബന്ധപ്പെട്ട് പറയും.`,
  upi_refund_owed: (f) => `ഉടമ ${inr(f, "refundInr")} UPI വഴി നിങ്ങൾക്ക് തിരികെ അയക്കും. അയച്ചതായി ഉടമ രേഖപ്പെടുത്തിയാൽ ഞാൻ മെസ്സേജ് അയക്കാം.`,
  upi_cancelled_refund_owed: (f) => `ബുക്കിംഗ് റദ്ദാക്കിയിട്ടുണ്ട് (${slot(f)}). നിങ്ങളുടെ ${inr(f, "refundInr")} ഉടമ UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തിയാൽ ഞാൻ മെസ്സേജ് അയക്കാം.`,
  upi_extra_refund_owed: (f) => `നിങ്ങൾ അഡ്വാൻസിനേക്കാൾ കൂടുതൽ അടച്ചു. അധികമുള്ള ${inr(f, "refundInr")} ഉടമ UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തിയാൽ ഞാൻ മെസ്സേജ് അയക്കാം.`,
  upi_refund_sent: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് UPI വഴി അയച്ചതായി ഉടമ രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് ഒന്ന് നോക്കൂ.`,

  owner_upi_expected: (f) => `പുതിയ ബുക്കിംഗ് പരിശോധിക്കാനുണ്ട്: ${need(f, "serviceName")}, ${slot(f)}, ${phone(f)}. ${inr(f, "depositInr")} അഡ്വാൻസ് UPI വഴി അടയ്ക്കും. നിങ്ങളുടെ UPI ആപ്പിൽ കണ്ടാൽ "കിട്ടി" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: received ${code(f)}, തുക വേറെയാണെങ്കിൽ അതും കൂടെ എഴുതൂ).`,
  owner_upi_claim: (f) => `കസ്റ്റമർ പണം അടച്ചെന്ന് പറയുന്നു: ${phone(f)}, ${inr(f, "depositInr")}. ആദ്യം നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ (സ്ക്രീൻഷോട്ട് തെളിവല്ല), എന്നിട്ട് "കിട്ടി" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: received ${code(f)}).`,
  owner_upi_marked: (f) => `നന്ദി! കസ്റ്റമർ ${phone(f)}: ${marked(f)} കിട്ടിയതായി നിങ്ങൾ രേഖപ്പെടുത്തി.`,
  owner_upi_part: (f) => `നിങ്ങൾ ${marked(f)} രേഖപ്പെടുത്തി (കസ്റ്റമർ ${phone(f)}), പക്ഷേ അഡ്വാൻസ് ${inr(f, "depositInr")} ആണ്, അതുകൊണ്ട് ഇതുവരെ ബുക്ക് ആയിട്ടില്ല. മാറ്റിവച്ച സമയം തീരുന്നത് വരെ ഞാൻ സ്ലോട്ട് പിടിച്ചുവയ്ക്കും. ബാക്കി ${left(f)} കൂടി കിട്ടിയാൽ "കിട്ടി" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: received ${code(f)}).`,
  owner_upi_already: () => "ആ പേയ്മെന്റ് ഇതിനകം രേഖപ്പെടുത്തിയതാണ്, അതുകൊണ്ട് ഒരു തവണ മാത്രമേ കണക്കാക്കൂ.",
  owner_upi_unknown: () => "ക്ഷമിക്കണം, ആ കോഡ് എനിക്ക് മനസ്സിലായില്ല. ഈ പേയ്മെന്റിനെക്കുറിച്ചുള്ള എന്റെ ഏറ്റവും പുതിയ മെസ്സേജിലെ കോഡ് ഉപയോഗിക്കൂ.",
  owner_upi_late: (f) => `മാറ്റിവച്ച സമയം കഴിഞ്ഞ ശേഷമാണ് നിങ്ങൾ ${marked(f)} കിട്ടിയതായി രേഖപ്പെടുത്തിയത് (കസ്റ്റമർ ${phone(f)}), അതുകൊണ്ട് തനിയെ ബുക്ക് ആയില്ല. അവരുടെ ബുക്കിംഗ് നിങ്ങൾ തന്നെ ചെയ്യൂ, അല്ലെങ്കിൽ ${inr(f, "refundInr")} UPI വഴി തിരികെ അയക്കൂ. എന്നിട്ട് "റീഫണ്ട് അയച്ചു" അല്ലെങ്കിൽ "ബുക്കിംഗിനായി വെച്ചു" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: refunded ${code(f)} അല്ലെങ്കിൽ kept ${code(f)}).`,
  owner_upi_refund_owed: (f) => `തിരികെ അയക്കാനുണ്ട്: കസ്റ്റമർ ${phone(f)}, UPI വഴി ${inr(f, "refundInr")}. പണം ഞാൻ ഒരിക്കലും സ്വയം അയക്കില്ല. നിങ്ങൾ അയച്ചുകഴിഞ്ഞാൽ "റീഫണ്ട് അയച്ചു" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: refunded ${code(f)}).`,
  owner_upi_refund_reminder: (f) => `ഓർമ്മപ്പെടുത്തൽ: ${inr(f, "refundInr")} ഇനിയും തിരികെ നൽകാനുണ്ട് (കസ്റ്റമർ ${phone(f)}). UPI വഴി അയച്ചുകഴിഞ്ഞാൽ "റീഫണ്ട് അയച്ചു" ടാപ്പ് ചെയ്യൂ (അല്ലെങ്കിൽ ഇങ്ങനെ മറുപടി അയക്കൂ: refunded ${code(f)}).`,
  owner_upi_refund_marked: (f) => `നന്ദി! ${inr(f, "refundInr")} റീഫണ്ട് അയച്ചതായി രേഖപ്പെടുത്തി, കസ്റ്റമറെ അറിയിച്ചിട്ടുമുണ്ട്.`,
  owner_upi_refund_kept: (f) => `ശരി, ${inr(f, "refundInr")} നിങ്ങൾ തന്നെ ചെയ്യുന്ന ബുക്കിംഗിനായി വെച്ചു. ഇനി ഒന്നും തിരികെ നൽകാനില്ല.`,
};

const upiKn: UpiSet = {
  upi_quote_and_link: (f) => `${need(f, "serviceName")} (${slot(f)}) ಖಾಲಿ ಇದೆ! ಬೆಲೆ ${inr(f, "priceInr")}. ಬುಕ್ ಮಾಡಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಟ್ಟಿ, ${need(f, "holdMinutes")} ನಿಮಿಷ ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸುತ್ತೇನೆ.\nUPI ID: ${upiId(f)} (${payee(f)})\nನಿಮ್ಮ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ಆಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.`,
  upi_slot_and_link: (f) => `${slot(f)} ಖಾಲಿ ಇದೆ! ಬುಕ್ ಮಾಡಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಟ್ಟಿ, ${need(f, "holdMinutes")} ನಿಮಿಷ ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸುತ್ತೇನೆ.\nUPI ID: ${upiId(f)} (${payee(f)})\nನಿಮ್ಮ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ಆಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.`,
  upi_already_waiting: (f) => `ನಿಮ್ಮ ಸ್ಲಾಟ್ (${slot(f)}) ಇನ್ನೂ ಕಾಯ್ದಿರಿಸಿದ್ದೇನೆ. ಬುಕ್ ಮಾಡಲು ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಟ್ಟಿ.\nUPI ID: ${upiId(f)} (${payee(f)})\nನಿಮ್ಮ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ಆಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.`,
  upi_qr_caption: (f) => `UPI ಮೂಲಕ ${payee(f)} ಅವರಿಗೆ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಟ್ಟಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.`,
  upi_booked: (f) => `ಬುಕ್ ಆಗಿದೆ! ${need(f, "serviceName")}, ${slot(f)}. ನಿಮ್ಮ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣವನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದ್ದಾರೆ. ಬರಲು ಆಗದಿದ್ದರೆ ಕನಿಷ್ಠ ${need(f, "windowHours")} ಗಂಟೆ ಮೊದಲು ರದ್ದು ಮಾಡಿ, ಮುಂಗಡ ಹಣ ಮರಳಿ ಸಿಗುತ್ತದೆ.`,
  upi_paid_claim: (f) => `ಧನ್ಯವಾದ! ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನಿಮ್ಮ ${inr(f, "depositInr")} ನೋಡಿ ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ಆಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ. ಅಲ್ಲಿಯವರೆಗೆ ದಯವಿಟ್ಟು ಕಾಯಿರಿ: ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಒಂದೇ ಪಾವತಿಗೆ ಪುರಾವೆ ಆಗುವುದಿಲ್ಲ.`,
  upi_nothing_waiting: () => "ಧನ್ಯವಾದ! ಈಗ ನಿಮ್ಮ ಯಾವ UPI ಪಾವತಿಯೂ ಬಾಕಿ ಇಲ್ಲ, ಹಾಗಾಗಿ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಲು ಏನೂ ಇಲ್ಲ. ಬೇರೆ ಯಾವುದಕ್ಕಾದರೂ ಹಣ ಕಳುಹಿಸಿದ್ದರೆ ದಯವಿಟ್ಟು ಮಾಲೀಕರ ಜೊತೆ ಮಾತನಾಡಿ.",
  upi_hold_expired: (f) => `ಮಾಲೀಕರು ಮುಂಗಡ ಹಣವನ್ನು ಸಮಯಕ್ಕೆ ಖಚಿತಪಡಿಸದ ಕಾರಣ ${slot(f)} ಸ್ಲಾಟ್ ಬಿಟ್ಟುಬಿಟ್ಟಿದ್ದೇನೆ. ನೀವು ಈಗಾಗಲೇ ಹಣ ಕಳುಹಿಸಿದ್ದರೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ. ಇನ್ನೂ ಬುಕ್ ಮಾಡಬೇಕಿದ್ದರೆ ನನಗೆ ಮೆಸೇಜ್ ಮಾಡಿ.`,
  upi_late_received: (f) => `ನಿಮ್ಮ ${marked(f)} ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದರು, ಆದರೆ ${slot(f)} ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದ ಮೇಲೆ, ಹಾಗಾಗಿ ಬುಕ್ ಆಗಿಲ್ಲ. ಮತ್ತೆ ಬುಕ್ ಮಾಡುವ ಬಗ್ಗೆ ಅಥವಾ ಹಣ ಮರಳಿ ಕಳುಹಿಸುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.`,
  upi_refund_owed: (f) => `ಮಾಲೀಕರು ನಿಮಗೆ UPI ಮೂಲಕ ${inr(f, "refundInr")} ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ. ಅವರು ಕಳುಹಿಸಿದೆ ಎಂದು ಗುರುತಿಸಿದ ಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.`,
  upi_cancelled_refund_owed: (f) => `ಆಯಿತು, ನಿಮ್ಮ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ (${slot(f)}). ಮಾಲೀಕರು ನಿಮ್ಮ ${inr(f, "refundInr")} ಮುಂಗಡ ಹಣವನ್ನು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಅವರು ಕಳುಹಿಸಿದೆ ಎಂದು ಗುರುತಿಸಿದ ಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.`,
  upi_extra_refund_owed: (f) => `ನೀವು ಮುಂಗಡ ಹಣಕ್ಕಿಂತ ಹೆಚ್ಚು ಕಳುಹಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮಾಲೀಕರು UPI ಮೂಲಕ ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಅವರು ಕಳುಹಿಸಿದೆ ಎಂದು ಗುರುತಿಸಿದ ಮೇಲೆ ನಾನು ನಿಮಗೆ ಮೆಸೇಜ್ ಮಾಡುತ್ತೇನೆ.`,
  upi_refund_sent: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಮಾಲೀಕರು ಗುರುತಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ.`,

  owner_upi_expected: (f) => `ಚೆಕ್ ಮಾಡಬೇಕಾದ ಹೊಸ ಬುಕಿಂಗ್: ${need(f, "serviceName")}, ${slot(f)}, ${phone(f)}. ಅವರು UPI ಮೂಲಕ ${inr(f, "depositInr")} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸುತ್ತಾರೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಹಣ ಕಂಡಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: received ${code(f)}; ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ ಮೊತ್ತವನ್ನೂ ಸೇರಿಸಿ).`,
  owner_upi_claim: (f) => `ಗ್ರಾಹಕರು ಹಣ ಕಟ್ಟಿದ್ದೇನೆ ಎನ್ನುತ್ತಿದ್ದಾರೆ: ${phone(f)}, ${inr(f, "depositInr")}. ಮೊದಲು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ (ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ), ಹಣ ಬಂದಿದ್ದರೆ "ಬಂದಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: received ${code(f)}).`,
  owner_upi_marked: (f) => `ಸರಿ, ${phone(f)} ಅವರ ${marked(f)} ಬಂದಿದೆ ಎಂದು ನೀವು ಗುರುತಿಸಿದ್ದೀರಿ. ಧನ್ಯವಾದ!`,
  owner_upi_part: (f) => `ನೀವು ${phone(f)} ಅವರ ${marked(f)} ಗುರುತಿಸಿದ್ದೀರಿ, ಆದರೆ ಮುಂಗಡ ಹಣ ${inr(f, "depositInr")}, ಹಾಗಾಗಿ ಇನ್ನೂ ಬುಕ್ ಆಗಿಲ್ಲ. ಕಾಯ್ದಿರಿಸುವ ಸಮಯ ಮುಗಿಯುವವರೆಗೆ ಸ್ಲಾಟ್ ಹಾಗೆಯೇ ಇರುತ್ತದೆ. ಉಳಿದ ${left(f)} ಬಂದಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: received ${code(f)}).`,
  owner_upi_already: () => "ಆ ಪಾವತಿ ಈಗಾಗಲೇ ಗುರುತಿಸಲಾಗಿದೆ, ಹಾಗಾಗಿ ಒಮ್ಮೆ ಮಾತ್ರ ಲೆಕ್ಕಕ್ಕೆ ಬರುತ್ತದೆ.",
  owner_upi_unknown: () => "ಕ್ಷಮಿಸಿ, ಆ ಕೋಡ್ ನನಗೆ ಗೊತ್ತಿಲ್ಲ. ಈ ಪಾವತಿಯ ಬಗ್ಗೆ ನನ್ನ ಇತ್ತೀಚಿನ ಮೆಸೇಜಿನಲ್ಲಿರುವ ಕೋಡ್ ಬಳಸಿ.",
  owner_upi_late: (f) => `ನೀವು ${phone(f)} ಅವರ ${marked(f)} ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿದಾಗ ಸ್ಲಾಟ್ ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದಿತ್ತು, ಹಾಗಾಗಿ ತಾನಾಗಿ ಬುಕ್ ಆಗಲಿಲ್ಲ. ಅವರಿಗೆ ನೀವೇ ಬುಕ್ ಮಾಡಿ, ಅಥವಾ ${inr(f, "refundInr")} UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸಿ. ಆಮೇಲೆ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಅಥವಾ "ಬುಕಿಂಗ್‌ಗೆ ಇಟ್ಟಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: refunded ${code(f)} ಅಥವಾ kept ${code(f)}).`,
  owner_upi_refund_owed: (f) => `ಕಳುಹಿಸಬೇಕಾದ ರೀಫಂಡ್: ${phone(f)} ಅವರಿಗೆ UPI ಮೂಲಕ ${inr(f, "refundInr")}. ನಾನು ಯಾವತ್ತೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ನೀವು ಕಳುಹಿಸಿದ ಮೇಲೆ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: refunded ${code(f)}).`,
  owner_upi_refund_reminder: (f) => `ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ: ${phone(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ಇನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ಮೇಲೆ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ (ಅಥವಾ ಹೀಗೆ ಉತ್ತರಿಸಿ: refunded ${code(f)}).`,
  owner_upi_refund_marked: (f) => `ಧನ್ಯವಾದ! ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ ಎಂದು ಗುರುತಿಸಿದ್ದೇನೆ, ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ.`,
  owner_upi_refund_kept: (f) => `ಸರಿ: ${inr(f, "refundInr")} ಅನ್ನು ನೀವೇ ಮಾಡುವ ಬುಕಿಂಗ್‌ಗಾಗಿ ಇಟ್ಟುಕೊಳ್ಳುತ್ತಿದ್ದೀರಿ. ಇನ್ನು ಏನೂ ಮರಳಿ ಕೊಡಬೇಕಿಲ್ಲ.`,
};

// ---- the licence's wind-down and final stop (plan B13) --------------------------------------------------------------------------------------------------
// The customer hears that online booking is paused and to contact the shop: no promise to book later. The owner hears once, plainly, and is told who to contact; the
// final stop's notice says the partner's service has ended, how many bookings are still in the calendar, and that hello@geometer.dev will connect the owner with another local partner (no copy of the records goes to the owner: it goes only to the builder or partner). Hindi, Malayalam and Kannada are
// machine-written, like the rest of those packs, and wait for a native speaker's review (REVIEW-ml.md, REVIEW-kn.md).
const partner = (f: MessageFacts) => need(f, "partner");
const upcoming = (f: MessageFacts) => need(f, "upcomingCount");

const licenceEn: LicenceSet = {
  booking_paused: (f) => `Sorry, online booking is paused for now. Please contact ${f.businessName} directly.`,
  owner_licence_paused: (f) => `Heads up: online booking for ${f.businessName} is paused for now. Bookings you already have, cancellations and refunds still go through. To sort it out, please contact ${partner(f)}.`,
  owner_licence_stopped: (f) => `Heads up: online booking for ${f.businessName} has stopped, because the service from ${partner(f)} has ended. Bookings still in your calendar after today: ${upcoming(f)}. To keep it going with another local partner, write to hello@geometer.dev and Geometer will put you in touch.`,
};
const licenceHi: LicenceSet = {
  booking_paused: (f) => `माफ़ कीजिए, ऑनलाइन बुकिंग अभी रुकी हुई है। कृपया सीधे ${f.businessName} से बात कर लीजिए।`,
  owner_licence_paused: (f) => `ध्यान दें: ${f.businessName} की ऑनलाइन बुकिंग अभी रुकी हुई है। आपकी पुरानी बुकिंग, कैंसिल और रिफंड पहले की तरह चलते रहेंगे। इसके लिए कृपया ${partner(f)} से बात कर लीजिए।`,
  owner_licence_stopped: (f) => `ध्यान दें: ${f.businessName} की ऑनलाइन बुकिंग बंद हो गई है, क्योंकि ${partner(f)} की सेवा खत्म हो गई है। आज के बाद आपके कैलेंडर में ${upcoming(f)} बुकिंग बाकी हैं। किसी दूसरे लोकल पार्टनर के साथ इसे जारी रखना हो तो hello@geometer.dev पर लिखिए, Geometer आपको मिलवा देगा।`,
};
const licenceMl: LicenceSet = {
  booking_paused: (f) => `ക്ഷമിക്കണം, ഓൺലൈൻ ബുക്കിംഗ് തൽക്കാലം നിർത്തിവച്ചിരിക്കുകയാണ്. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
  owner_licence_paused: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് തൽക്കാലം നിർത്തിവച്ചിരിക്കുകയാണ്. ഇപ്പോഴുള്ള ബുക്കിംഗുകളും റദ്ദാക്കലുകളും റീഫണ്ടുകളും പതിവുപോലെ നടക്കും. ഇത് ശരിയാക്കാൻ ദയവായി ${partner(f)}-നെ ബന്ധപ്പെടൂ.`,
  owner_licence_stopped: (f) => `അറിയിപ്പ്: ${partner(f)} നൽകിയിരുന്ന സേവനം അവസാനിച്ചതുകൊണ്ട് ${f.businessName}-ന്റെ ഓൺലൈൻ ബുക്കിംഗ് നിന്നു. ഇന്നിന് ശേഷം നിങ്ങളുടെ കലണ്ടറിലുള്ള ബുക്കിംഗുകൾ: ${upcoming(f)}. മറ്റൊരു പ്രാദേശിക പാർട്ണറുമായി തുടരാൻ hello@geometer.dev എന്ന വിലാസത്തിലേക്ക് എഴുതൂ, Geometer നിങ്ങളെ ബന്ധിപ്പിക്കും.`,
};
const licenceKn: LicenceSet = {
  booking_paused: (f) => `ಕ್ಷಮಿಸಿ, ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಿದ್ದೇವೆ. ದಯವಿಟ್ಟು ${f.businessName} ಅವರನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_paused: (f) => `ಗಮನಿಸಿ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಈಗಾಗಲೇ ಇರುವ ಬುಕಿಂಗ್‌ಗಳು, ರದ್ದತಿಗಳು ಮತ್ತು ರೀಫಂಡ್‌ಗಳು ಮೊದಲಿನಂತೆಯೇ ನಡೆಯುತ್ತವೆ. ಇದನ್ನು ಸರಿಪಡಿಸಲು ದಯವಿಟ್ಟು ${partner(f)} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_stopped: (f) => `ಗಮನಿಸಿ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಬುಕಿಂಗ್ ನಿಂತಿದೆ, ಏಕೆಂದರೆ ${partner(f)} ಅವರ ಸೇವೆ ಮುಗಿದಿದೆ. ಇಂದಿನ ನಂತರ ನಿಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಇನ್ನೂ ಇರುವ ಬುಕಿಂಗ್‌ಗಳು: ${upcoming(f)}. ಇನ್ನೊಬ್ಬ ಸ್ಥಳೀಯ ಪಾರ್ಟ್ನರ್ ಜೊತೆ ಮುಂದುವರಿಸಲು hello@geometer.dev ವಿಳಾಸಕ್ಕೆ ಬರೆಯಿರಿ, Geometer ನಿಮ್ಮನ್ನು ಜೋಡಿಸುತ್ತದೆ.`,
};

// ---- the wait for a Guard is over (checkpoint item 8, 11 Nov 2026) ------------------------------------------------------------------------------------------------
// Hindi, Malayalam and Kannada are machine-written, like the rest of those packs, and wait for a native speaker's review (the REVIEW sheets list them; Deferred.md says so).
// The shop's name is not given a case ending: the sentence that names it is built the way `booking_paused` is.
const waitEn: GuardWaitSet = {
  wait_over: (f) => `Sorry, I couldn't finish that: the booking system isn't answering just now. Your message is on the owner's to-do list. Please write again later, or contact ${f.businessName} directly.`,
};
const waitHi: GuardWaitSet = {
  wait_over: (f) => `माफ़ कीजिए, मैं यह पूरा नहीं कर पाया: बुकिंग सिस्टम अभी जवाब नहीं दे रहा। आपका मैसेज मालिक की काम की लिस्ट में है। कृपया बाद में फिर लिखिए, या सीधे ${f.businessName} से बात कर लीजिए।`,
};
const waitMl: GuardWaitSet = {
  wait_over: (f) => `ക്ഷമിക്കണം, അത് പൂർത്തിയാക്കാൻ പറ്റിയില്ല: ബുക്കിംഗ് സിസ്റ്റം ഇപ്പോൾ പ്രതികരിക്കുന്നില്ല. നിങ്ങളുടെ മെസ്സേജ് ഉടമയുടെ ചെയ്യാനുള്ള കാര്യങ്ങളുടെ ലിസ്റ്റിലുണ്ട്. ദയവായി പിന്നീട് വീണ്ടും എഴുതൂ, അല്ലെങ്കിൽ ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
};
const waitKn: GuardWaitSet = {
  wait_over: (f) => `ಕ್ಷಮಿಸಿ, ಇದನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಆಗಲಿಲ್ಲ: ಬುಕಿಂಗ್ ಸಿಸ್ಟಮ್ ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ. ನಿಮ್ಮ ಮೆಸೇಜ್ ಮಾಲೀಕರ ಮಾಡಬೇಕಾದ ಕೆಲಸಗಳ ಪಟ್ಟಿಯಲ್ಲಿದೆ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ಮೇಲೆ ಮತ್ತೆ ಬರೆಯಿರಿ, ಅಥವಾ ${f.businessName} ಅವರನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ.`,
};

export const TEMPLATES: Record<Language, TemplateSet> = { en: { ...en, ...upiEn, ...licenceEn, ...waitEn }, hi: { ...hi, ...upiHi, ...licenceHi, ...waitHi }, ml: { ...ml, ...upiMl, ...licenceMl, ...waitMl }, kn: { ...kn, ...upiKn, ...licenceKn, ...waitKn } };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
