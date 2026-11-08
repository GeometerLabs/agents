// Every message the Orders agent sends, per language. There is NO model-written text: each message is one of these templates, and every item, quantity, amount, day, time,
// place and link in it is rendered from the record (the facts), never typed by hand and never translated. Adding a language means adding one more object below; the type
// makes sure none is missing. The Hindi, Malayalam and Kannada are machine-written: a native speaker must read them before a real shop sees them (REVIEW-hi.md,
// REVIEW-ml.md and REVIEW-kn.md list every line).
import { formatDate, formatInr, formatTime } from "../../../../../modules/language/format.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { localParts } from "../../../../../modules/core/time.ts";

/** The values of this order's record that a message may use. The outgoing check reads the same object. */
export interface MessageFacts {
  language: Language;
  timeZone: string;
  businessName: string;
  /** Every item with its price, named in this language (for the menu, and so the check knows them). */
  menu: { name: string; priceInr: number }[];
  /** The order's lines as words, "2 × Veg thali, 1 × Curd", and the quantities they hold. */
  itemsText?: string;
  quantities?: number[];
  /** One item, for a message about it (the price floor, the stock). */
  itemName?: string;
  priceInr?: number;
  /** How many of that item are left for the day. */
  leftCount?: number;
  totalInr?: number;
  advanceInr?: number;
  /** What is left to pay when the order is collected or delivered: the total less the advance. */
  balanceInr?: number;
  refundInr?: number;
  /** The order's day at midnight, its window (start and end) and the moment orders for it close. */
  dateMs?: number;
  slotFromMs?: number;
  slotToMs?: number;
  cutoffMs?: number;
  /** The windows a list message offers: each window's times must be one of these, or the order's own. */
  slotChoices?: { fromMs: number; toMs: number }[];
  mode?: "pickup" | "delivery";
  /** The place in the shop's delivery list the address named. */
  area?: string;
  /** The address as the customer wrote it. Only ever in a message to the owner. */
  address?: string;
  /** The places the shop delivers to (for the message that says an address is outside them). */
  areas?: string[];
  link?: string; // the payment link from the payments service's record
  holdMinutes?: number;
  windowHours?: number;
  maxItems?: number;
  orderRef?: string; // "o-3"
  customerPhone?: string;
  /** The one-use code the owner sends back to approve or deny a refund Guard is holding (never the order ref). Made by the approvals relay. */
  approvalCode?: string;
  /** How many hours the owner has to answer. */
  approvalHours?: number;
  /** UPI shops (B33): the shop's UPI ID and the name its customers see. */
  upiId?: string;
  payee?: string;
  /** UPI: the owner's one-use code for this payment or refund (modules/payments/upi/ledger.ts). Only ever in a message to the owner. */
  upiCode?: string;
  /** UPI: what the owner marked received, and what is still to come, in whole rupees. */
  markedInr?: number;
  leftInr?: number;
  /** The licence's service notices (B13): who the owner should contact (the partner who set the shop up), the counts the final stop's notice states, and the free export's last day. */
  partner?: string;
  upcomingCount?: number;
  openCount?: number;
  licenceDateMs?: number;
}

export type TemplateId =
  // to the customer: asking what is missing
  | "menu" | "pick_items" | "ask_when" | "ask_how" | "ask_slot" | "ask_address" | "confirm_details" | "confirm_buttons"
  // to the customer: what the rules say no to
  | "price_floor" | "too_many_items" | "out_of_stock" | "sold_out" | "day_full" | "after_cutoff" | "outside_area"
  // to the customer: the quote, the order, and what happens to the money
  | "quote_and_link" | "already_waiting" | "link_failed" | "order_confirmed" | "hold_expired" | "stock_gone_refund" | "cutoff_passed_refund" | "refund_unused"
  | "duplicate_refund" | "duplicate_refund_pending" | "cancelled_refund" | "cancelled_refund_pending" | "cancelled_late" | "cancelled_no_advance" | "no_order_found"
  | "refund_approved" | "refund_denied" | "refund_checking" | "refund_expired" | "big_order_asked" | "big_order_denied"
  | "didnt_understand" | "voice_note" | "ask_cancel" | "kept" | "told_owner" | "couldnt_tell_owner"
  // to the owner. Every line starts and ends with fixed words, because each one that goes out unasked is also a WhatsApp template (meta-templates.ts) and Meta rejects a body
  // that starts or ends with a value. The one exception is the reply to the owner's own message, which needs no template.
  | "owner_order_confirmed" | "owner_big_order" | "owner_order_cancelled" | "owner_late_cancellation" | "owner_duplicate_payment" | "owner_payment_unused" | "owner_link_failed"
  | "owner_message_held" | "owner_opted_out" | "owner_unknown_command" | "owner_wants_to_talk"
  // button mode: the agent reads with the rules only and answers with buttons and lists (modules/understanding/ai-state.ts). Each says why, and that every limit still holds.
  | "owner_ai_allowance" | "owner_ai_off" | "owner_ai_fault"
  // sent by the approvals relay, not by the agent: the ask for a refund Guard is holding, and the answers to the owner's reply
  | "owner_refund_needs_approval" | "owner_approval_done" | "owner_approval_denied" | "owner_approval_expired" | "owner_approval_failed"
  | UpiTemplateId | LicenceTemplateId;

/**
 * The licence's wind-down and final stop (plan B13; modules/licence). The customer's line answers a request for a new order while ordering is paused; the owner's two are
 * the one service notice for each `paid_through` (WhatsApp utility templates). About the service, never about Geometer's fee; they name who to contact.
 */
export type LicenceTemplateId = "orders_paused" | "owner_licence_paused" | "owner_licence_stopped";

/** UPI shops only (B33): the advance is paid to the shop's own UPI ID and marked paid by the owner; refunds are sent by the owner. */
export type UpiTemplateId =
  | "upi_qr_caption" | "upi_paid_claim" | "upi_nothing_waiting" | "upi_late_received" | "upi_refund_owed" | "upi_cancelled_refund_owed" | "upi_extra_refund_owed" | "upi_refund_sent"
  | "owner_upi_expected" | "owner_upi_claim" | "owner_upi_marked" | "owner_upi_part" | "owner_upi_already" | "owner_upi_unknown" | "owner_upi_late"
  | "owner_upi_refund_owed" | "owner_upi_refund_reminder" | "owner_upi_refund_marked" | "owner_upi_refund_kept";

/** Which approved WhatsApp template carries a message once the customer's 24-hour window has closed and no exact template fits. */
export const TEMPLATE_NAMES = { customer: "order_update", owner: "order_owner_notice" } as const;

type Template = (f: MessageFacts) => string;
type TemplateSet = Record<TemplateId, Template>;
type BaseSet = Record<Exclude<TemplateId, UpiTemplateId | LicenceTemplateId>, Template>;
type UpiSet = Record<UpiTemplateId, Template>;
type LicenceSet = Record<LicenceTemplateId, Template>;

/** A template asks for a value the record does not have: refuse to write the message at all. */
export function need<K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> {
  const value = f[key];
  if (value === undefined) throw new Error(`The message needs "${String(key)}" from the record, and the record does not have it.`);
  return value as NonNullable<MessageFacts[K]>;
}
type Money = "priceInr" | "totalInr" | "advanceInr" | "balanceInr" | "refundInr" | "markedInr" | "leftInr";
export const inr = (f: MessageFacts, key: Money) => formatInr(need(f, key));
const clock = (f: MessageFacts, ms: number) => formatTime(localParts(ms, f.timeZone), f.language);
const dateOf = (f: MessageFacts, ms: number) => formatDate(localParts(ms, f.timeZone), f.language);
/** The day of the order, "Thu 12 Nov". */
export const day = (f: MessageFacts) => dateOf(f, f.dateMs ?? need(f, "slotFromMs"));
const WINDOW: Record<Language, (a: string, b: string) => string> = {
  en: (a, b) => `${a} to ${b}`, hi: (a, b) => `${a} से ${b} तक`, ml: (a, b) => `${a} മുതൽ ${b} വരെ`, kn: (a, b) => `${a} ರಿಂದ ${b} ವರೆಗೆ`,
};
/** The day and the window, "Thu 12 Nov, 12:00 pm to 1:00 pm". */
export const when = (f: MessageFacts) => `${dateOf(f, need(f, "slotFromMs"))}, ${WINDOW[f.language](clock(f, need(f, "slotFromMs")), clock(f, need(f, "slotToMs")))}`;
/** The moment orders close, "Wed 11 Nov, 8:00 pm". */
export const cutAt = (f: MessageFacts) => `${dateOf(f, need(f, "cutoffMs"))}, ${clock(f, need(f, "cutoffMs"))}`;
const HOW: Record<Language, { pickup: string; delivery: (area: string) => string }> = {
  en: { pickup: "pickup", delivery: (a) => `delivery to ${a}` },
  hi: { pickup: "पिकअप", delivery: (a) => `${a} में डिलीवरी` },
  ml: { pickup: "പിക്കപ്പ്", delivery: (a) => `${a}-ലേക്ക് ഡെലിവറി` },
  kn: { pickup: "ಪಿಕಪ್", delivery: (a) => `${a} ಗೆ ಡೆಲಿವರಿ` },
};
/** "pickup" or "delivery to Kakkanad". */
export const how = (f: MessageFacts) => (need(f, "mode") === "pickup" ? HOW[f.language].pickup : HOW[f.language].delivery(need(f, "area")));
const items = (f: MessageFacts) => need(f, "itemsText");
const menuList = (f: MessageFacts) => f.menu.map((i) => `${i.name} ${formatInr(i.priceInr)}`).join(", ");
/**
 * Where to pay, as the messages say it: the payment link; for a UPI shop the `upi://pay` link with the shop's UPI ID and name after it, since WhatsApp does not open
 * upi:// links and a customer can pay by hand from those. One value, so every message that asks for money, and its WhatsApp template, says it the same way.
 */
export const payTo = (f: MessageFacts): string => (f.upiId ? `${need(f, "link")} (UPI ID ${f.upiId}, ${need(f, "payee")})` : need(f, "link"));
const places = (f: MessageFacts) => need(f, "areas").join(", ");
/** The rest of an order after the advance: nothing, or what is paid on collection or delivery. */
const rest = (f: MessageFacts): string => {
  const left = need(f, "balanceInr");
  const pickup = need(f, "mode") === "pickup";
  if (f.language === "en") return left === 0 ? "Paid in full." : `${inr(f, "balanceInr")} is to pay on ${pickup ? "pickup" : "delivery"}.`;
  if (f.language === "hi") return left === 0 ? "पूरा भुगतान हो चुका है।" : `${inr(f, "balanceInr")} ${pickup ? "पिकअप" : "डिलीवरी"} पर देने हैं।`;
  if (f.language === "ml") return left === 0 ? "മുഴുവൻ തുകയും അടച്ചു." : `${inr(f, "balanceInr")} ${pickup ? "പിക്കപ്പിന്" : "ഡെലിവറിക്ക്"} അടയ്ക്കണം.`;
  return left === 0 ? "ಪೂರ್ಣ ಹಣ ಪಾವತಿಯಾಗಿದೆ." : `${inr(f, "balanceInr")} ${pickup ? "ಪಿಕಪ್" : "ಡೆಲಿವರಿ"} ಸಮಯದಲ್ಲಿ ಪಾವತಿಸಬೇಕು.`;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const en: BaseSet = {
  menu: (f) => `Hello! Welcome to ${f.businessName}. Our menu: ${menuList(f)}. Tell me what you would like, how many, which day, and pickup or delivery.`,
  pick_items: (f) => `Hello! Welcome to ${f.businessName}. What would you like to order?`,
  ask_when: (f) => `Which day would you like your ${items(f)} for?`,
  ask_how: () => "Would you like to pick it up, or have it delivered?",
  ask_slot: (f) => `Which time on ${day(f)}? Pick a slot below, or write the time you prefer.`,
  ask_address: (f) => `Where should we deliver? Please write your area and full address. We deliver to: ${places(f)}.`,
  confirm_details: (f) => `Just to be sure: ${items(f)} on ${day(f)}. Reply "yes" to continue.`,
  confirm_buttons: (f) => `Just to be sure: ${items(f)} on ${day(f)}. Is that right?`,
  price_floor: (f) => `Our ${need(f, "itemName")} is ${inr(f, "priceInr")}, and I can't go lower than that.`,
  too_many_items: (f) => `Sorry, one order can have at most ${need(f, "maxItems")} items. Please send a smaller order, or talk to the owner.`,
  out_of_stock: (f) => `Sorry, only ${need(f, "leftCount")} ${need(f, "itemName")} left for ${day(f)}. Please change the order, or pick another day.`,
  sold_out: (f) => `Sorry, ${need(f, "itemName")} is sold out for ${day(f)}. Please pick something else, or another day.`,
  day_full: (f) => `Sorry, we cannot take any more orders for ${day(f)}. Please pick another day.`,
  after_cutoff: (f) => `Sorry, orders for ${when(f)} closed at ${cutAt(f)}. Please pick another day or time.`,
  outside_area: (f) => `Sorry, we do not deliver to that address. We deliver to: ${places(f)}. You can pick up instead.`,
  quote_and_link: (f) => `${items(f)} for ${when(f)}, ${how(f)}. Total ${inr(f, "totalInr")}. To confirm, pay ${inr(f, "advanceInr")} here: ${payTo(f)} (I'll hold your order for ${need(f, "holdMinutes")} minutes.)${f.upiId ? " The owner confirms the payment, then I'll message you." : ""}`,
  already_waiting: (f) => `Your order (${items(f)}, ${when(f)}) is held. Pay ${inr(f, "advanceInr")} to confirm: ${payTo(f)}${f.upiId ? " The owner confirms the payment, then I'll message you." : ""}`,
  link_failed: () => "Sorry, I couldn't create the payment link just now, so nothing is ordered. I've told the owner. Please try again in a few minutes.",
  order_confirmed: (f) => `Confirmed! ${items(f)} for ${when(f)}, ${how(f)}. ${f.upiId ? "The owner has confirmed" : "We have received"} your advance of ${inr(f, "advanceInr")}. ${rest(f)} Cancel at least ${need(f, "windowHours")} hours before the start for a refund.`,
  hold_expired: (f) => `The hold on your order (${items(f)}, ${when(f)}) has ended because the advance was not received in time. Message me if you'd still like to order.`,
  stock_gone_refund: (f) => `Your payment of ${inr(f, "advanceInr")} arrived after the hold on your order ended, and ${items(f)} for ${day(f)} is no longer available. ${inr(f, "refundInr")} is being refunded to you.`,
  cutoff_passed_refund: (f) => `Your payment of ${inr(f, "advanceInr")} arrived after the hold on your order ended, and orders for ${day(f)} have closed (${cutAt(f)}). ${inr(f, "refundInr")} is being refunded to you.`,
  refund_unused: (f) => `Your payment of ${inr(f, "advanceInr")} arrived, but there is no active order for it. ${inr(f, "refundInr")} is being refunded to you.`,
  duplicate_refund: (f) => `You paid the advance twice. The extra ${inr(f, "refundInr")} is being refunded.`,
  duplicate_refund_pending: (f) => `You paid the advance twice. The extra ${inr(f, "refundInr")} will be refunded once the owner approves.`,
  cancelled_refund: (f) => `Your order for ${when(f)} is cancelled. Your ${inr(f, "refundInr")} advance is being refunded.`,
  cancelled_refund_pending: (f) => `Your order for ${when(f)} is cancelled. The owner will confirm your ${inr(f, "refundInr")} refund shortly.`,
  cancelled_late: (f) => `Your order for ${when(f)} is cancelled. As it is less than ${need(f, "windowHours")} hours before the start, the owner will decide about your ${inr(f, "advanceInr")} advance and message you.`,
  cancelled_no_advance: (f) => `Your order for ${day(f)} is cancelled. Nothing was charged.`,
  no_order_found: () => "I couldn't find an order to change. Tell me what you'd like, how many and which day, and I'll set it up.",
  refund_approved: (f) => `The owner approved your refund. ${inr(f, "refundInr")} is on its way.`,
  refund_denied: (f) => `The owner has decided not to refund the ${inr(f, "advanceInr")} advance.`,
  refund_checking: (f) => `We are checking your ${inr(f, "refundInr")} refund and will message you as soon as it is confirmed.`,
  refund_expired: (f) => `The owner did not answer in time about your ${inr(f, "refundInr")} refund, so it has not been sent. Please contact ${f.businessName} directly.`,
  big_order_asked: (f) => `Your order (${items(f)}, ${when(f)}) is a big one, so I have asked the owner to approve it. You will hear back here.`,
  big_order_denied: (f) => `Sorry, the owner cannot take your order for ${day(f)}. Nothing was charged.`,
  didnt_understand: () => "Sorry, I didn't understand. Please tell me what you would like to order, how many, and which day.",
  voice_note: () => "Please type your message; I can't listen to voice notes yet.",
  ask_cancel: (f) => `Do you want to cancel your order for ${when(f)}?`,
  kept: (f) => `Okay, your order for ${when(f)} stays as it is.`,
  told_owner: () => "I've told the owner that you would like to talk. They will message you here.",
  couldnt_tell_owner: () => "Sorry, I couldn't reach the owner just now. Please try again in a few minutes.",

  owner_order_confirmed: (f) => `New order ${need(f, "orderRef")} from ${need(f, "customerPhone")}: ${items(f)} for ${when(f)}, ${how(f)}${f.address ? ` (address: ${f.address})` : ""}. Total ${inr(f, "totalInr")}, advance ${inr(f, "advanceInr")} paid, ${inr(f, "balanceInr")} to collect. Nothing more to do now.`,
  owner_big_order: (f) => `Approval needed: ${need(f, "customerPhone")} wants ${items(f)} for ${when(f)}, ${how(f)}. Total ${inr(f, "totalInr")}. Reply "approve ${need(f, "orderRef")}" to let them pay, or "deny ${need(f, "orderRef")}".`,
  owner_order_cancelled: (f) => `Customer ${need(f, "customerPhone")} cancelled order ${need(f, "orderRef")}: ${items(f)} for ${when(f)}. Please do not prepare it.`,
  owner_late_cancellation: (f) => `Customer ${need(f, "customerPhone")} cancelled order ${need(f, "orderRef")} (${items(f)}, ${when(f)}) less than ${need(f, "windowHours")} hours before the start. Advance ${inr(f, "advanceInr")}. Reply "approve ${need(f, "orderRef")}" to refund it or "deny ${need(f, "orderRef")}" to keep it.`,
  owner_duplicate_payment: (f) => `Customer ${need(f, "customerPhone")} paid the advance twice for order ${need(f, "orderRef")} (${items(f)}, ${when(f)}). The extra ${inr(f, "refundInr")} was refunded.`,
  owner_payment_unused: (f) => `A ${inr(f, "advanceInr")} payment from ${need(f, "customerPhone")} arrived for order ${need(f, "orderRef")} (${day(f)}), but it was no longer active (its hold had ended and it could not be taken again, or it was cancelled). ${inr(f, "refundInr")} was refunded.`,
  owner_link_failed: (f) => `Could not make the payment link for order ${need(f, "orderRef")} from ${need(f, "customerPhone")}. Nothing is ordered. Please check your payment account.`,
  owner_message_held: (f) => `A message to ${need(f, "customerPhone")} was held back because it did not match the order record. Nothing was sent.`,
  owner_opted_out: (f) => `Customer ${need(f, "customerPhone")} sent STOP. No more messages will go to them.`,
  owner_unknown_command: () => `I didn't understand that. Reply "approve" or "deny" followed by the order reference.`,
  owner_wants_to_talk: (f) => `Customer ${need(f, "customerPhone")} would like to talk to you. Please message them.`,
  owner_ai_allowance: (f) => `Notice: this month's AI allowance for ${f.businessName} is used up, so the agent now answers with buttons and lists. It still takes orders, and every limit still holds. The person who set it up has been told. Normal service returns next month.`,
  owner_ai_off: (f) => `Notice: the AI that reads messages for ${f.businessName} has been switched off for now. The agent keeps taking orders with buttons and lists, and every limit still holds. The person who set it up has been told.`,
  owner_ai_fault: (f) => `Notice: the AI that reads messages for ${f.businessName} is not answering right now, so the agent is using buttons and lists. It still takes orders, and every limit still holds. It will try the AI again in a few minutes.`,
  owner_refund_needs_approval: (f) => `Approval needed: refund ${inr(f, "refundInr")} for ${need(f, "customerPhone")} (order ${need(f, "orderRef")}, ${day(f)}). Reply "approve ${need(f, "approvalCode")}" or "deny ${need(f, "approvalCode")}" within ${need(f, "approvalHours")} hours.`,
  owner_approval_done: (f) => `Thank you. The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} is being sent, and they will be told.`,
  owner_approval_denied: (f) => `Understood. The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} will not be sent, and they will be told.`,
  owner_approval_expired: (f) => `That request ran out before you answered, so nothing was refunded: ${inr(f, "refundInr")} for ${need(f, "customerPhone")}.`,
  owner_approval_failed: () => "I could not record your answer just now. Please send it again in a few minutes.",
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Hindi
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const hi: BaseSet = {
  menu: (f) => `नमस्ते! ${f.businessName} में आपका स्वागत है। हमारा मेन्यू: ${menuList(f)}। बताइए आपको क्या चाहिए, कितना, किस दिन, और पिकअप या डिलीवरी।`,
  pick_items: (f) => `नमस्ते! ${f.businessName} में आपका स्वागत है। आप क्या ऑर्डर करना चाहेंगे?`,
  ask_when: (f) => `आपका ${items(f)} किस दिन के लिए चाहिए?`,
  ask_how: () => "आप खुद लेने आएँगे, या डिलीवरी चाहिए?",
  ask_slot: (f) => `${day(f)} को किस समय? नीचे से समय चुनिए, या अपना पसंदीदा समय लिखिए।`,
  ask_address: (f) => `डिलीवरी कहाँ करनी है? कृपया अपना इलाका और पूरा पता लिखिए। हम यहाँ डिलीवरी करते हैं: ${places(f)}।`,
  confirm_details: (f) => `पक्का करने के लिए: ${items(f)}, ${day(f)}। आगे बढ़ने के लिए "हाँ" लिखें।`,
  confirm_buttons: (f) => `पक्का करने के लिए: ${items(f)}, ${day(f)}। क्या यह सही है?`,
  price_floor: (f) => `हमारा ${need(f, "itemName")} ${inr(f, "priceInr")} का है, इससे कम में नहीं हो पाएगा।`,
  too_many_items: (f) => `माफ़ कीजिए, एक ऑर्डर में ज़्यादा से ज़्यादा ${need(f, "maxItems")} चीज़ें हो सकती हैं। कृपया छोटा ऑर्डर भेजिए, या मालिक से बात कीजिए।`,
  out_of_stock: (f) => `माफ़ कीजिए, ${day(f)} के लिए ${need(f, "itemName")} सिर्फ़ ${need(f, "leftCount")} बचे हैं। कृपया ऑर्डर बदलिए, या कोई और दिन चुनिए।`,
  sold_out: (f) => `माफ़ कीजिए, ${day(f)} के लिए ${need(f, "itemName")} ख़त्म हो चुका है। कृपया कुछ और चुनिए, या कोई और दिन।`,
  day_full: (f) => `माफ़ कीजिए, ${day(f)} के लिए अब और ऑर्डर नहीं ले सकते। कृपया कोई और दिन चुनिए।`,
  after_cutoff: (f) => `माफ़ कीजिए, ${when(f)} के ऑर्डर ${cutAt(f)} पर बंद हो गए। कृपया कोई और दिन या समय चुनिए।`,
  outside_area: (f) => `माफ़ कीजिए, हम उस पते पर डिलीवरी नहीं करते। हम यहाँ डिलीवरी करते हैं: ${places(f)}। आप खुद आकर ले जा सकते हैं।`,
  quote_and_link: (f) => `${items(f)}, ${when(f)}, ${how(f)}। कुल ${inr(f, "totalInr")}। पक्का करने के लिए ${inr(f, "advanceInr")} यहाँ भेजें: ${payTo(f)} (आपका ऑर्डर ${need(f, "holdMinutes")} मिनट के लिए रोका गया है।)${f.upiId ? " पैसे आने पर मालिक पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा।" : ""}`,
  already_waiting: (f) => `आपका ऑर्डर (${items(f)}, ${when(f)}) रोका हुआ है। पक्का करने के लिए ${inr(f, "advanceInr")} भेजें: ${payTo(f)}${f.upiId ? " पैसे आने पर मालिक पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा।" : ""}`,
  link_failed: () => "माफ़ कीजिए, अभी पेमेंट लिंक नहीं बन पाया, इसलिए कुछ भी ऑर्डर नहीं हुआ है। मैंने मालिक को बता दिया है। कृपया कुछ मिनट बाद फिर कोशिश करें।",
  order_confirmed: (f) => `ऑर्डर पक्का! ${items(f)}, ${when(f)}, ${how(f)}। ${f.upiId ? "मालिक ने आपका" : "हमें आपका"} ${inr(f, "advanceInr")} का एडवांस ${f.upiId ? "पक्का कर दिया है" : "मिल गया है"}। ${rest(f)} रिफंड के लिए शुरू होने से कम से कम ${need(f, "windowHours")} घंटे पहले रद्द करें।`,
  hold_expired: (f) => `आपके ऑर्डर (${items(f)}, ${when(f)}) की रोक खत्म हो गई क्योंकि एडवांस समय पर नहीं मिला। अब भी ऑर्डर करना चाहें तो मुझे लिखें।`,
  stock_gone_refund: (f) => `आपका ${inr(f, "advanceInr")} का भुगतान ऑर्डर की रोक खत्म होने के बाद आया, और ${day(f)} के लिए ${items(f)} अब उपलब्ध नहीं है। ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  cutoff_passed_refund: (f) => `आपका ${inr(f, "advanceInr")} का भुगतान ऑर्डर की रोक खत्म होने के बाद आया, और ${day(f)} के ऑर्डर बंद हो चुके हैं (${cutAt(f)})। ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  refund_unused: (f) => `आपका ${inr(f, "advanceInr")} का भुगतान आया, लेकिन इसके लिए कोई चालू ऑर्डर नहीं है। ${inr(f, "refundInr")} आपको वापस किया जा रहा है।`,
  duplicate_refund: (f) => `आपने एडवांस दो बार भर दिया। अतिरिक्त ${inr(f, "refundInr")} वापस किया जा रहा है।`,
  duplicate_refund_pending: (f) => `आपने एडवांस दो बार भर दिया। अतिरिक्त ${inr(f, "refundInr")} मालिक की मंज़ूरी के बाद वापस किया जाएगा।`,
  cancelled_refund: (f) => `${when(f)} का आपका ऑर्डर रद्द हो गया है। आपका ${inr(f, "refundInr")} एडवांस वापस किया जा रहा है।`,
  cancelled_refund_pending: (f) => `${when(f)} का आपका ऑर्डर रद्द हो गया है। आपके ${inr(f, "refundInr")} के रिफंड की पुष्टि मालिक जल्द करेंगे।`,
  cancelled_late: (f) => `${when(f)} का आपका ऑर्डर रद्द हो गया है। यह शुरू होने से ${need(f, "windowHours")} घंटे से कम पहले है, इसलिए आपके ${inr(f, "advanceInr")} एडवांस पर मालिक फ़ैसला करेंगे और आपको बताएँगे।`,
  cancelled_no_advance: (f) => `${day(f)} का आपका ऑर्डर रद्द हो गया है। कोई शुल्क नहीं लिया गया।`,
  no_order_found: () => "मुझे बदलने के लिए कोई ऑर्डर नहीं मिला। बताइए क्या चाहिए, कितना और किस दिन, मैं ऑर्डर बना दूँगा।",
  refund_approved: (f) => `मालिक ने आपके रिफंड को मंज़ूरी दे दी है। ${inr(f, "refundInr")} आपको वापस भेजा जा रहा है।`,
  refund_denied: (f) => `मालिक ने ${inr(f, "advanceInr")} का एडवांस वापस न करने का फ़ैसला किया है।`,
  refund_checking: (f) => `आपके ${inr(f, "refundInr")} के रिफंड की जाँच हो रही है। पुष्टि होते ही मैं आपको संदेश भेजूँगा।`,
  refund_expired: (f) => `मालिक ने समय पर आपके ${inr(f, "refundInr")} के रिफंड पर जवाब नहीं दिया, इसलिए वह अभी नहीं भेजा गया है। कृपया ${f.businessName} से सीधे संपर्क करें।`,
  big_order_asked: (f) => `आपका ऑर्डर (${items(f)}, ${when(f)}) बड़ा है, इसलिए मैंने मालिक से मंज़ूरी माँगी है। जवाब यहीं मिलेगा।`,
  big_order_denied: (f) => `माफ़ कीजिए, मालिक ${day(f)} का आपका ऑर्डर नहीं ले पाएँगे। कोई शुल्क नहीं लिया गया।`,
  didnt_understand: () => "माफ़ कीजिए, मैं समझ नहीं पाया। कृपया बताइए क्या ऑर्डर करना है, कितना और किस दिन।",
  voice_note: () => "कृपया अपना संदेश लिखकर भेजिए; मैं अभी वॉइस नोट नहीं सुन सकता।",
  ask_cancel: (f) => `क्या आप ${when(f)} का अपना ऑर्डर रद्द करना चाहते हैं?`,
  kept: (f) => `ठीक है, ${when(f)} का आपका ऑर्डर जैसा है वैसा ही रहेगा।`,
  told_owner: () => "मैंने मालिक को बता दिया है कि आप बात करना चाहते हैं। वे यहीं आपको संदेश भेजेंगे।",
  couldnt_tell_owner: () => "माफ़ कीजिए, अभी मालिक तक बात नहीं पहुँच पाई। कृपया कुछ मिनट बाद फिर कोशिश करें।",

  owner_order_confirmed: (f) => `नया ऑर्डर ${need(f, "orderRef")}, ग्राहक ${need(f, "customerPhone")}: ${items(f)}, ${when(f)}, ${how(f)}${f.address ? ` (पता: ${f.address})` : ""}। कुल ${inr(f, "totalInr")}, एडवांस ${inr(f, "advanceInr")} मिल चुका, ${inr(f, "balanceInr")} लेने हैं। अभी कुछ करना बाकी नहीं है।`,
  owner_big_order: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} को ${items(f)} चाहिए, ${when(f)}, ${how(f)}। कुल ${inr(f, "totalInr")}। भुगतान की अनुमति के लिए "approve ${need(f, "orderRef")}" या मना करने के लिए "deny ${need(f, "orderRef")}" लिखें।`,
  owner_order_cancelled: (f) => `ग्राहक ${need(f, "customerPhone")} ने ऑर्डर ${need(f, "orderRef")} रद्द किया: ${items(f)}, ${when(f)}। कृपया इसे तैयार न करें।`,
  owner_late_cancellation: (f) => `ग्राहक ${need(f, "customerPhone")} ने ऑर्डर ${need(f, "orderRef")} (${items(f)}, ${when(f)}) शुरू होने से ${need(f, "windowHours")} घंटे से कम पहले रद्द किया। एडवांस ${inr(f, "advanceInr")}। लौटाने के लिए "approve ${need(f, "orderRef")}" या रखने के लिए "deny ${need(f, "orderRef")}" लिखें।`,
  owner_duplicate_payment: (f) => `ग्राहक ${need(f, "customerPhone")} ने ऑर्डर ${need(f, "orderRef")} (${items(f)}, ${when(f)}) का एडवांस दो बार भरा। अतिरिक्त ${inr(f, "refundInr")} वापस कर दिया गया।`,
  owner_payment_unused: (f) => `ग्राहक ${need(f, "customerPhone")} का ${inr(f, "advanceInr")} का भुगतान ऑर्डर ${need(f, "orderRef")} (${day(f)}) के लिए आया, पर वह ऑर्डर अब चालू नहीं था (रोक खत्म हो चुकी थी और दोबारा नहीं लिया जा सका, या रद्द था)। ${inr(f, "refundInr")} वापस कर दिया गया।`,
  owner_link_failed: (f) => `ग्राहक ${need(f, "customerPhone")} के ऑर्डर ${need(f, "orderRef")} के लिए पेमेंट लिंक नहीं बन पाया। कुछ भी ऑर्डर नहीं हुआ है। कृपया अपना पेमेंट अकाउंट देखें।`,
  owner_message_held: (f) => `ग्राहक ${need(f, "customerPhone")} को भेजा जाने वाला एक संदेश रोक दिया गया क्योंकि वह ऑर्डर रिकॉर्ड से मेल नहीं खाता था। कुछ भी नहीं भेजा गया।`,
  owner_opted_out: (f) => `ग्राहक ${need(f, "customerPhone")} ने STOP भेजा है। अब उन्हें कोई संदेश नहीं जाएगा।`,
  owner_unknown_command: () => `मैं समझ नहीं पाया। "approve" या "deny" लिखिए और उसके बाद ऑर्डर नंबर।`,
  owner_wants_to_talk: (f) => `ग्राहक ${need(f, "customerPhone")} आपसे बात करना चाहते हैं। कृपया उन्हें संदेश भेजें।`,
  owner_ai_allowance: (f) => `सूचना: ${f.businessName} का इस महीने का AI कोटा खत्म हो गया है, इसलिए एजेंट अब बटन और सूचियों से जवाब देगा। ऑर्डर फिर भी लिए जाएँगे, और हर सीमा पहले की तरह लागू रहेगी। इसे सेट करने वाले को बता दिया गया है। सामान्य सेवा अगले महीने लौटेगी।`,
  owner_ai_off: (f) => `सूचना: ${f.businessName} के संदेश पढ़ने वाला AI अभी बंद कर दिया गया है। एजेंट बटन और सूचियों से ऑर्डर लेता रहेगा, और हर सीमा पहले की तरह लागू रहेगी। इसे सेट करने वाले को बता दिया गया है।`,
  owner_ai_fault: (f) => `सूचना: ${f.businessName} के संदेश पढ़ने वाला AI अभी जवाब नहीं दे रहा, इसलिए एजेंट बटन और सूचियाँ इस्तेमाल कर रहा है। ऑर्डर फिर भी लिए जाएँगे, और हर सीमा पहले की तरह लागू रहेगी। कुछ मिनट बाद एजेंट AI को फिर आज़माएगा।`,
  owner_refund_needs_approval: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} (ऑर्डर ${need(f, "orderRef")}, ${day(f)}) को ${inr(f, "refundInr")} का रिफंड। ${need(f, "approvalHours")} घंटे के भीतर "approve ${need(f, "approvalCode")}" या "deny ${need(f, "approvalCode")}" लिखकर भेजें।`,
  owner_approval_done: (f) => `धन्यवाद। ${need(f, "customerPhone")} का ${inr(f, "refundInr")} रिफंड भेजा जा रहा है, और उन्हें बता दिया जाएगा।`,
  owner_approval_denied: (f) => `समझ गया। ${need(f, "customerPhone")} का ${inr(f, "refundInr")} रिफंड नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा।`,
  owner_approval_expired: (f) => `आपके जवाब देने से पहले ही वह अनुरोध खत्म हो गया, इसलिए कुछ वापस नहीं किया गया: ${need(f, "customerPhone")}, ${inr(f, "refundInr")}।`,
  owner_approval_failed: () => "मैं अभी आपका जवाब दर्ज नहीं कर पाया। कृपया कुछ मिनट बाद फिर भेजें।",
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Malayalam
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const ml: BaseSet = {
  menu: (f) => `നമസ്കാരം! ${f.businessName}-ലേക്ക് സ്വാഗതം. ഞങ്ങളുടെ മെനു: ${menuList(f)}. എന്താണ് വേണ്ടത്, എത്ര, ഏത് ദിവസം, പിക്കപ്പ് ആണോ ഡെലിവറി ആണോ എന്ന് പറയൂ.`,
  pick_items: (f) => `നമസ്കാരം! ${f.businessName}-ലേക്ക് സ്വാഗതം. എന്താണ് ഓർഡർ ചെയ്യേണ്ടത്?`,
  ask_when: (f) => `നിങ്ങളുടെ ${items(f)} ഏത് ദിവസത്തേക്ക് വേണം?`,
  ask_how: () => "നിങ്ങൾ വന്ന് എടുക്കുമോ, അതോ ഡെലിവറി വേണോ?",
  ask_slot: (f) => `${day(f)} ഏത് സമയം? താഴെ നിന്ന് ഒരു സമയം തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ ഇഷ്ടമുള്ള സമയം എഴുതൂ.`,
  ask_address: (f) => `എവിടെയാണ് ഡെലിവറി വേണ്ടത്? നിങ്ങളുടെ സ്ഥലവും പൂർണ്ണ വിലാസവും എഴുതൂ. ഞങ്ങൾ ഡെലിവറി ചെയ്യുന്നത്: ${places(f)}.`,
  confirm_details: (f) => `ഉറപ്പിക്കാൻ: ${items(f)}, ${day(f)}. തുടരാൻ "ശരി" എന്ന് മറുപടി അയയ്ക്കൂ.`,
  confirm_buttons: (f) => `ഉറപ്പിക്കാൻ: ${items(f)}, ${day(f)}. ഇത് ശരിയാണോ?`,
  price_floor: (f) => `${need(f, "itemName")} വില ${inr(f, "priceInr")} ആണ്. ക്ഷമിക്കണം, ഇതിൽ കുറയ്ക്കാൻ കഴിയില്ല.`,
  too_many_items: (f) => `ക്ഷമിക്കണം, ഒരു ഓർഡറിൽ പരമാവധി ${need(f, "maxItems")} സാധനങ്ങൾ മാത്രം. ദയവായി ചെറിയ ഓർഡർ അയയ്ക്കൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ.`,
  out_of_stock: (f) => `ക്ഷമിക്കണം, ${day(f)}-ന് ${need(f, "itemName")} ${need(f, "leftCount")} എണ്ണം മാത്രമേ ബാക്കിയുള്ളൂ. ദയവായി ഓർഡർ മാറ്റൂ, അല്ലെങ്കിൽ മറ്റൊരു ദിവസം തിരഞ്ഞെടുക്കൂ.`,
  sold_out: (f) => `ക്ഷമിക്കണം, ${day(f)}-ന് ${need(f, "itemName")} തീർന്നു. ദയവായി മറ്റൊന്ന് തിരഞ്ഞെടുക്കൂ, അല്ലെങ്കിൽ മറ്റൊരു ദിവസം.`,
  day_full: (f) => `ക്ഷമിക്കണം, ${day(f)}-ന് ഇനി ഓർഡറുകൾ എടുക്കാൻ കഴിയില്ല. ദയവായി മറ്റൊരു ദിവസം തിരഞ്ഞെടുക്കൂ.`,
  after_cutoff: (f) => `ക്ഷമിക്കണം, ${when(f)}-ലേക്കുള്ള ഓർഡറുകൾ ${cutAt(f)}-ന് അവസാനിച്ചു. ദയവായി മറ്റൊരു ദിവസമോ സമയമോ തിരഞ്ഞെടുക്കൂ.`,
  outside_area: (f) => `ക്ഷമിക്കണം, ആ വിലാസത്തിലേക്ക് ഞങ്ങൾ ഡെലിവറി ചെയ്യുന്നില്ല. ഞങ്ങൾ ഡെലിവറി ചെയ്യുന്നത്: ${places(f)}. പകരം വന്ന് എടുക്കാം.`,
  quote_and_link: (f) => `${items(f)}, ${when(f)}, ${how(f)}. ആകെ ${inr(f, "totalInr")}. ഉറപ്പിക്കാൻ ${inr(f, "advanceInr")} ഇവിടെ അടയ്ക്കൂ: ${payTo(f)} (ഓർഡർ ${need(f, "holdMinutes")} മിനിറ്റ് നിങ്ങൾക്കായി മാറ്റിവച്ചിട്ടുണ്ട്.)${f.upiId ? " പണം എത്തുമ്പോൾ ഉടമ ഉറപ്പിക്കും, പിന്നെ ഞാൻ സന്ദേശം അയയ്ക്കും." : ""}`,
  already_waiting: (f) => `നിങ്ങളുടെ ഓർഡർ (${items(f)}, ${when(f)}) മാറ്റിവച്ചിട്ടുണ്ട്. ഉറപ്പിക്കാൻ ${inr(f, "advanceInr")} അടയ്ക്കൂ: ${payTo(f)}${f.upiId ? " പണം എത്തുമ്പോൾ ഉടമ ഉറപ്പിക്കും, പിന്നെ ഞാൻ സന്ദേശം അയയ്ക്കും." : ""}`,
  link_failed: () => "ക്ഷമിക്കണം, ഇപ്പോൾ പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ഒന്നും ഓർഡർ ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.",
  order_confirmed: (f) => `ഓർഡർ ഉറപ്പായി! ${items(f)}, ${when(f)}, ${how(f)}. നിങ്ങളുടെ ${inr(f, "advanceInr")} അഡ്വാൻസ് ${f.upiId ? "ഉടമ ഉറപ്പിച്ചു" : "ലഭിച്ചു"}. ${rest(f)} പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് ${need(f, "windowHours")} മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം.`,
  hold_expired: (f) => `അഡ്വാൻസ് സമയത്ത് ലഭിക്കാത്തതിനാൽ നിങ്ങളുടെ ഓർഡർ (${items(f)}, ${when(f)}) മാറ്റിവച്ചത് ഒഴിവാക്കി. ഇനിയും ഓർഡർ ചെയ്യണമെങ്കിൽ എനിക്ക് മെസ്സേജ് അയയ്ക്കൂ.`,
  stock_gone_refund: (f) => `നിങ്ങളുടെ ${inr(f, "advanceInr")} പേയ്മെന്റ് ഓർഡർ മാറ്റിവച്ചത് അവസാനിച്ച ശേഷമാണ് എത്തിയത്, ${day(f)}-ന് ${items(f)} ഇപ്പോൾ ലഭ്യമല്ല. ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്.`,
  cutoff_passed_refund: (f) => `നിങ്ങളുടെ ${inr(f, "advanceInr")} പേയ്മെന്റ് ഓർഡർ മാറ്റിവച്ചത് അവസാനിച്ച ശേഷമാണ് എത്തിയത്, ${day(f)}-ലെ ഓർഡറുകൾ അവസാനിച്ചു (${cutAt(f)}). ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്.`,
  refund_unused: (f) => `നിങ്ങളുടെ ${inr(f, "advanceInr")} പേയ്മെന്റ് ലഭിച്ചു, പക്ഷേ അതിന് ഇപ്പോൾ ഒരു ഓർഡറും ഇല്ല. ${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നുണ്ട്.`,
  duplicate_refund: (f) => `നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച ${inr(f, "refundInr")} തിരികെ നൽകുന്നുണ്ട്.`,
  duplicate_refund_pending: (f) => `നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച ${inr(f, "refundInr")} ഉടമ അംഗീകരിച്ച ശേഷം തിരികെ നൽകും.`,
  cancelled_refund: (f) => `${when(f)}-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. നിങ്ങളുടെ ${inr(f, "refundInr")} അഡ്വാൻസ് തിരികെ നൽകുന്നുണ്ട്.`,
  cancelled_refund_pending: (f) => `${when(f)}-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. നിങ്ങളുടെ ${inr(f, "refundInr")} തിരികെ നൽകുന്ന കാര്യം ഉടമ ഉടൻ ഉറപ്പാക്കും.`,
  cancelled_late: (f) => `${when(f)}-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. തുടങ്ങാൻ ${need(f, "windowHours")} മണിക്കൂറിൽ താഴെ മാത്രം ബാക്കിയുള്ളതിനാൽ, നിങ്ങളുടെ ${inr(f, "advanceInr")} അഡ്വാൻസിന്റെ കാര്യത്തിൽ ഉടമ തീരുമാനിച്ച് നിങ്ങളെ അറിയിക്കും.`,
  cancelled_no_advance: (f) => `${day(f)}-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. പണം ഒന്നും ഈടാക്കിയിട്ടില്ല.`,
  no_order_found: () => "മാറ്റാൻ ഓർഡർ ഒന്നും കണ്ടില്ല. എന്താണ് വേണ്ടത്, എത്ര, ഏത് ദിവസം എന്ന് പറയൂ, ഞാൻ ഓർഡർ ചെയ്യാം.",
  refund_approved: (f) => `ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. ${inr(f, "refundInr")} തിരികെ വരുന്നുണ്ട്.`,
  refund_denied: (f) => `${inr(f, "advanceInr")} അഡ്വാൻസ് തിരികെ നൽകേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു.`,
  refund_checking: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് പരിശോധിക്കുകയാണ്. ഉറപ്പാകുന്ന ഉടൻ ഞാൻ സന്ദേശം അയയ്ക്കാം.`,
  refund_expired: (f) => `ഉടമ സമയത്തിനുള്ളിൽ നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ടിനെക്കുറിച്ച് മറുപടി നൽകിയില്ല, അതിനാൽ അത് ഇതുവരെ അയച്ചിട്ടില്ല. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
  big_order_asked: (f) => `നിങ്ങളുടെ ഓർഡർ (${items(f)}, ${when(f)}) വലുതാണ്, അതിനാൽ ഉടമയോട് അനുമതി ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ കിട്ടും.`,
  big_order_denied: (f) => `ക്ഷമിക്കണം, ${day(f)}-ലെ നിങ്ങളുടെ ഓർഡർ ഉടമയ്ക്ക് എടുക്കാൻ കഴിയില്ല. പണം ഒന്നും ഈടാക്കിയിട്ടില്ല.`,
  didnt_understand: () => "ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. ദയവായി എന്താണ് ഓർഡർ ചെയ്യേണ്ടത്, എത്ര, ഏത് ദിവസം എന്ന് പറയൂ.",
  voice_note: () => "ദയവായി നിങ്ങളുടെ സന്ദേശം ടൈപ്പ് ചെയ്ത് അയയ്ക്കൂ; എനിക്ക് ഇപ്പോൾ വോയ്‌സ് നോട്ടുകൾ കേൾക്കാൻ കഴിയില്ല.",
  ask_cancel: (f) => `${when(f)}-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കണോ?`,
  kept: (f) => `ശരി, ${when(f)}-ലെ നിങ്ങളുടെ ഓർഡർ അതുപോലെ തന്നെ തുടരും.`,
  told_owner: () => "നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ തന്നെ നിങ്ങൾക്ക് സന്ദേശം അയയ്ക്കും.",
  couldnt_tell_owner: () => "ക്ഷമിക്കണം, ഇപ്പോൾ ഉടമയെ അറിയിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.",

  owner_order_confirmed: (f) => `പുതിയ ഓർഡർ ${need(f, "orderRef")}, ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${items(f)}, ${when(f)}, ${how(f)}${f.address ? ` (വിലാസം: ${f.address})` : ""}. ആകെ ${inr(f, "totalInr")}, അഡ്വാൻസ് ${inr(f, "advanceInr")} ലഭിച്ചു, ${inr(f, "balanceInr")} വാങ്ങാനുണ്ട്. ഇപ്പോൾ ഒന്നും ചെയ്യാനില്ല.`,
  owner_big_order: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")}-ന് ${items(f)} വേണം, ${when(f)}, ${how(f)}. ആകെ ${inr(f, "totalInr")}. പണമടയ്ക്കാൻ അനുവദിക്കാൻ "approve ${need(f, "orderRef")}" എന്നും, നിരസിക്കാൻ "deny ${need(f, "orderRef")}" എന്നും മറുപടി അയയ്ക്കൂ.`,
  owner_order_cancelled: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")} ഓർഡർ ${need(f, "orderRef")} റദ്ദാക്കി: ${items(f)}, ${when(f)}. ദയവായി ഇത് തയ്യാറാക്കരുത്.`,
  owner_late_cancellation: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ഓർഡർ ${need(f, "orderRef")} (${items(f)}, ${when(f)}) തുടങ്ങാൻ ${need(f, "windowHours")} മണിക്കൂറിൽ താഴെ ബാക്കിയുള്ളപ്പോൾ റദ്ദാക്കി. അഡ്വാൻസ് ${inr(f, "advanceInr")}. തിരികെ നൽകാൻ "approve ${need(f, "orderRef")}" എന്നും, നിങ്ങൾ വയ്ക്കാൻ "deny ${need(f, "orderRef")}" എന്നും മറുപടി അയയ്ക്കൂ.`,
  owner_duplicate_payment: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ഓർഡർ ${need(f, "orderRef")} (${items(f)}, ${when(f)}) — അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി വന്ന ${inr(f, "refundInr")} തിരികെ നൽകി.`,
  owner_payment_unused: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: ഓർഡർ ${need(f, "orderRef")} (${day(f)}) ന് ${inr(f, "advanceInr")} പേയ്മെന്റ് വന്നു, പക്ഷേ ആ ഓർഡർ അപ്പോൾ നിലവിലില്ലായിരുന്നു (മാറ്റിവച്ച സമയം കഴിഞ്ഞിരുന്നു, വീണ്ടും എടുക്കാനും കഴിഞ്ഞില്ല, അല്ലെങ്കിൽ റദ്ദാക്കിയിരുന്നു). ${inr(f, "refundInr")} തിരികെ നൽകി.`,
  owner_link_failed: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}-ന്റെ ഓർഡർ ${need(f, "orderRef")}-ന് പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല. ഒന്നും ഓർഡർ ആയിട്ടില്ല. ദയവായി നിങ്ങളുടെ പേയ്മെന്റ് അക്കൗണ്ട് പരിശോധിക്കൂ.`,
  owner_message_held: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")}: അയയ്ക്കാനിരുന്ന ഒരു സന്ദേശം ഓർഡർ രേഖയുമായി പൊരുത്തപ്പെടാത്തതിനാൽ തടഞ്ഞു. ഒന്നും അയച്ചിട്ടില്ല.`,
  owner_opted_out: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")} STOP അയച്ചു. ഇനി അവർക്ക് സന്ദേശങ്ങൾ അയയ്ക്കില്ല.`,
  owner_unknown_command: () => `എനിക്ക് മനസ്സിലായില്ല. "approve" അല്ലെങ്കിൽ "deny" എന്ന് എഴുതി അതിനു ശേഷം ഓർഡർ റഫറൻസ് എഴുതൂ.`,
  owner_wants_to_talk: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")} നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_ai_allowance: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഈ മാസത്തെ AI പരിധി തീർന്നു, അതിനാൽ ഏജന്റ് ഇനി ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് മറുപടി നൽകും. ഓർഡറുകൾ തുടർന്നും എടുക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. ഇത് ക്രമീകരിച്ചവരെ അറിയിച്ചിട്ടുണ്ട്. അടുത്ത മാസം സാധാരണ സേവനം തിരിച്ചുവരും.`,
  owner_ai_off: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI തൽക്കാലം ഓഫ് ചെയ്തിരിക്കുന്നു. ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിച്ച് ഓർഡറുകൾ തുടർന്നും എടുക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. ഇത് ക്രമീകരിച്ചവരെ അറിയിച്ചിട്ടുണ്ട്.`,
  owner_ai_fault: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI ഇപ്പോൾ മറുപടി നൽകുന്നില്ല, അതിനാൽ ഏജന്റ് ബട്ടണുകളും പട്ടികകളും ഉപയോഗിക്കുന്നു. ഓർഡറുകൾ തുടർന്നും എടുക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. കുറച്ച് മിനിറ്റിനു ശേഷം ഏജന്റ് വീണ്ടും AI ശ്രമിക്കും.`,
  owner_refund_needs_approval: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")}-ന് (ഓർഡർ ${need(f, "orderRef")}, ${day(f)}) ${inr(f, "refundInr")} റീഫണ്ട്. ${need(f, "approvalHours")} മണിക്കൂറിനുള്ളിൽ "approve ${need(f, "approvalCode")}" അല്ലെങ്കിൽ "deny ${need(f, "approvalCode")}" എന്ന് മറുപടി അയയ്ക്കൂ.`,
  owner_approval_done: (f) => `നന്ദി. ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${inr(f, "refundInr")} റീഫണ്ട് അയയ്ക്കുന്നുണ്ട്, അവരെ അറിയിക്കും.`,
  owner_approval_denied: (f) => `മനസ്സിലായി. ഉപഭോക്താവ് ${need(f, "customerPhone")}: ${inr(f, "refundInr")} റീഫണ്ട് അയയ്ക്കില്ല, അവരെ അറിയിക്കും.`,
  owner_approval_expired: (f) => `നിങ്ങൾ മറുപടി നൽകുന്നതിന് മുമ്പ് ആ അഭ്യർത്ഥനയുടെ സമയം കഴിഞ്ഞു, അതിനാൽ ഒന്നും തിരികെ നൽകിയില്ല: ഉപഭോക്താവ് ${need(f, "customerPhone")}, ${inr(f, "refundInr")}.`,
  owner_approval_failed: () => "നിങ്ങളുടെ മറുപടി ഇപ്പോൾ രേഖപ്പെടുത്താൻ കഴിഞ്ഞില്ല. ദയവായി കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും അയയ്ക്കൂ.",
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Kannada
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const kn: BaseSet = {
  menu: (f) => `ನಮಸ್ಕಾರ! ${f.businessName}-ಗೆ ಸ್ವಾಗತ. ನಮ್ಮ ಮೆನು: ${menuList(f)}. ಏನು ಬೇಕು, ಎಷ್ಟು, ಯಾವ ದಿನ, ಪಿಕಪ್ ಅಥವಾ ಡೆಲಿವರಿ ಎಂದು ತಿಳಿಸಿ.`,
  pick_items: (f) => `ನಮಸ್ಕಾರ! ${f.businessName}-ಗೆ ಸ್ವಾಗತ. ಏನು ಆರ್ಡರ್ ಮಾಡಬೇಕು?`,
  ask_when: (f) => `ನಿಮ್ಮ ${items(f)} ಯಾವ ದಿನಕ್ಕೆ ಬೇಕು?`,
  ask_how: () => "ನೀವೇ ಬಂದು ತೆಗೆದುಕೊಳ್ಳುತ್ತೀರಾ, ಅಥವಾ ಡೆಲಿವರಿ ಬೇಕೇ?",
  ask_slot: (f) => `${day(f)} ಯಾವ ಸಮಯ? ಕೆಳಗಿನಿಂದ ಒಂದು ಸಮಯ ಆಯ್ಕೆಮಾಡಿ, ಅಥವಾ ನಿಮಗೆ ಇಷ್ಟವಾದ ಸಮಯ ಬರೆಯಿರಿ.`,
  ask_address: (f) => `ಎಲ್ಲಿಗೆ ಡೆಲಿವರಿ ಮಾಡಬೇಕು? ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪ್ರದೇಶ ಮತ್ತು ಪೂರ್ಣ ವಿಳಾಸ ಬರೆಯಿರಿ. ನಾವು ಡೆಲಿವರಿ ಮಾಡುವ ಸ್ಥಳಗಳು: ${places(f)}.`,
  confirm_details: (f) => `ಖಚಿತಪಡಿಸಲು: ${items(f)}, ${day(f)}. ಮುಂದುವರಿಯಲು "ಹೌದು" ಎಂದು ಉತ್ತರಿಸಿ.`,
  confirm_buttons: (f) => `ಖಚಿತಪಡಿಸಲು: ${items(f)}, ${day(f)}. ಇದು ಸರಿಯೇ?`,
  price_floor: (f) => `${need(f, "itemName")} ಬೆಲೆ ${inr(f, "priceInr")}. ಕ್ಷಮಿಸಿ, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.`,
  too_many_items: (f) => `ಕ್ಷಮಿಸಿ, ಒಂದು ಆರ್ಡರ್‌ನಲ್ಲಿ ಗರಿಷ್ಠ ${need(f, "maxItems")} ವಸ್ತುಗಳು ಮಾತ್ರ. ದಯವಿಟ್ಟು ಚಿಕ್ಕ ಆರ್ಡರ್ ಕಳುಹಿಸಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.`,
  out_of_stock: (f) => `ಕ್ಷಮಿಸಿ, ${day(f)} ಕ್ಕೆ ${need(f, "itemName")} ${need(f, "leftCount")} ಮಾತ್ರ ಉಳಿದಿದೆ. ದಯವಿಟ್ಟು ಆರ್ಡರ್ ಬದಲಿಸಿ, ಅಥವಾ ಬೇರೆ ದಿನ ಆಯ್ಕೆಮಾಡಿ.`,
  sold_out: (f) => `ಕ್ಷಮಿಸಿ, ${day(f)} ಕ್ಕೆ ${need(f, "itemName")} ಖಾಲಿಯಾಗಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಏನಾದರೂ ಆಯ್ಕೆಮಾಡಿ, ಅಥವಾ ಬೇರೆ ದಿನ.`,
  day_full: (f) => `ಕ್ಷಮಿಸಿ, ${day(f)} ಕ್ಕೆ ಇನ್ನು ಆರ್ಡರ್ ತೆಗೆದುಕೊಳ್ಳಲು ಆಗುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನ ಆಯ್ಕೆಮಾಡಿ.`,
  after_cutoff: (f) => `ಕ್ಷಮಿಸಿ, ${when(f)} ರ ಆರ್ಡರ್‌ಗಳು ${cutAt(f)} ಕ್ಕೆ ಮುಗಿದಿವೆ. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನ ಅಥವಾ ಸಮಯ ಆಯ್ಕೆಮಾಡಿ.`,
  outside_area: (f) => `ಕ್ಷಮಿಸಿ, ಆ ವಿಳಾಸಕ್ಕೆ ನಾವು ಡೆಲಿವರಿ ಮಾಡುವುದಿಲ್ಲ. ನಾವು ಡೆಲಿವರಿ ಮಾಡುವ ಸ್ಥಳಗಳು: ${places(f)}. ಬದಲಿಗೆ ನೀವೇ ಬಂದು ತೆಗೆದುಕೊಳ್ಳಬಹುದು.`,
  quote_and_link: (f) => `${items(f)}, ${when(f)}, ${how(f)}. ಒಟ್ಟು ${inr(f, "totalInr")}. ಖಚಿತಪಡಿಸಲು ${inr(f, "advanceInr")} ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)} (ನಿಮ್ಮ ಆರ್ಡರ್ ಅನ್ನು ${need(f, "holdMinutes")} ನಿಮಿಷ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.)${f.upiId ? " ಹಣ ಬಂದಾಗ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ." : ""}`,
  already_waiting: (f) => `ನಿಮ್ಮ ಆರ್ಡರ್ (${items(f)}, ${when(f)}) ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ. ಖಚಿತಪಡಿಸಲು ${inr(f, "advanceInr")} ಪಾವತಿಸಿ: ${payTo(f)}${f.upiId ? " ಹಣ ಬಂದಾಗ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ." : ""}`,
  link_failed: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಏನೂ ಆರ್ಡರ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  order_confirmed: (f) => `ಆರ್ಡರ್ ಖಚಿತವಾಗಿದೆ! ${items(f)}, ${when(f)}, ${how(f)}. ನಿಮ್ಮ ${inr(f, "advanceInr")} ಮುಂಗಡ ಹಣ ${f.upiId ? "ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಿದ್ದಾರೆ" : "ಸಿಕ್ಕಿದೆ"}. ${rest(f)} ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ ${need(f, "windowHours")} ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ.`,
  hold_expired: (f) => `ಮುಂಗಡ ಹಣ ಸಮಯಕ್ಕೆ ಸಿಗದ ಕಾರಣ ನಿಮ್ಮ ಆರ್ಡರ್ (${items(f)}, ${when(f)}) ಕಾಯ್ದಿರಿಸಿದ್ದನ್ನು ಬಿಡುಗಡೆ ಮಾಡಲಾಗಿದೆ. ಇನ್ನೂ ಆರ್ಡರ್ ಮಾಡಬೇಕಾದರೆ ನನಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  stock_gone_refund: (f) => `ನಿಮ್ಮ ${inr(f, "advanceInr")} ಪಾವತಿ ಆರ್ಡರ್ ಕಾಯ್ದಿರಿಸಿದ್ದು ಮುಗಿದ ನಂತರ ಬಂದಿದೆ, ಮತ್ತು ${day(f)} ಕ್ಕೆ ${items(f)} ಈಗ ಲಭ್ಯವಿಲ್ಲ. ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  cutoff_passed_refund: (f) => `ನಿಮ್ಮ ${inr(f, "advanceInr")} ಪಾವತಿ ಆರ್ಡರ್ ಕಾಯ್ದಿರಿಸಿದ್ದು ಮುಗಿದ ನಂತರ ಬಂದಿದೆ, ಮತ್ತು ${day(f)} ರ ಆರ್ಡರ್‌ಗಳು ಮುಗಿದಿವೆ (${cutAt(f)}). ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  refund_unused: (f) => `ನಿಮ್ಮ ${inr(f, "advanceInr")} ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಅದಕ್ಕೆ ಈಗ ಯಾವುದೇ ಆರ್ಡರ್ ಇಲ್ಲ. ${inr(f, "refundInr")} ನಿಮಗೆ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  duplicate_refund: (f) => `ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  duplicate_refund_pending: (f) => `ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮಾಲೀಕರು ಒಪ್ಪಿದ ನಂತರ ಮರಳಿ ಕೊಡಲಾಗುವುದು.`,
  cancelled_refund: (f) => `${when(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ನಿಮ್ಮ ${inr(f, "refundInr")} ಮುಂಗಡ ಹಣ ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.`,
  cancelled_refund_pending: (f) => `${when(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ನಿಮ್ಮ ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ಶೀಘ್ರದಲ್ಲೇ ಖಚಿತಪಡಿಸುತ್ತಾರೆ.`,
  cancelled_late: (f) => `${when(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ಪ್ರಾರಂಭಕ್ಕೆ ${need(f, "windowHours")} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಸಮಯ ಇರುವುದರಿಂದ, ನಿಮ್ಮ ${inr(f, "advanceInr")} ಮುಂಗಡ ಹಣದ ಬಗ್ಗೆ ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿ ನಿಮಗೆ ತಿಳಿಸುತ್ತಾರೆ.`,
  cancelled_no_advance: (f) => `${day(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ಯಾವುದೇ ಹಣ ಪಡೆದಿಲ್ಲ.`,
  no_order_found: () => "ಬದಲಾಯಿಸಲು ಯಾವುದೇ ಆರ್ಡರ್ ಸಿಗಲಿಲ್ಲ. ಏನು ಬೇಕು, ಎಷ್ಟು, ಯಾವ ದಿನ ತಿಳಿಸಿ, ನಾನು ಆರ್ಡರ್ ಮಾಡುತ್ತೇನೆ.",
  refund_approved: (f) => `ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಒಪ್ಪಿದ್ದಾರೆ. ${inr(f, "refundInr")} ಮರಳಿ ಬರುತ್ತಿದೆ.`,
  refund_denied: (f) => `${inr(f, "advanceInr")} ಮುಂಗಡ ಹಣವನ್ನು ಮರಳಿ ಕೊಡದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ.`,
  refund_checking: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇವೆ. ಖಚಿತವಾದ ತಕ್ಷಣ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  refund_expired: (f) => `ಮಾಲೀಕರು ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಬಗ್ಗೆ ಉತ್ತರಿಸಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಅದನ್ನು ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು ${f.businessName} ಅವರನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ.`,
  big_order_asked: (f) => `ನಿಮ್ಮ ಆರ್ಡರ್ (${items(f)}, ${when(f)}) ದೊಡ್ಡದಾಗಿದೆ, ಆದ್ದರಿಂದ ಮಾಲೀಕರ ಒಪ್ಪಿಗೆ ಕೇಳಿದ್ದೇನೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ.`,
  big_order_denied: (f) => `ಕ್ಷಮಿಸಿ, ${day(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ಅನ್ನು ಮಾಲೀಕರು ತೆಗೆದುಕೊಳ್ಳಲು ಆಗುವುದಿಲ್ಲ. ಯಾವುದೇ ಹಣ ಪಡೆದಿಲ್ಲ.`,
  didnt_understand: () => "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಏನು ಆರ್ಡರ್ ಮಾಡಬೇಕು, ಎಷ್ಟು, ಯಾವ ದಿನ ತಿಳಿಸಿ.",
  voice_note: () => "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ ಕಳುಹಿಸಿ; ನನಗೆ ಈಗ ವಾಯ್ಸ್ ನೋಟ್ ಕೇಳಲು ಆಗುವುದಿಲ್ಲ.",
  ask_cancel: (f) => `${when(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದು ಮಾಡಬೇಕೇ?`,
  kept: (f) => `ಸರಿ, ${when(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ಹಾಗೆಯೇ ಇರುತ್ತದೆ.`,
  told_owner: () => "ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.",
  couldnt_tell_owner: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",

  owner_order_confirmed: (f) => `ಹೊಸ ಆರ್ಡರ್ ${need(f, "orderRef")}, ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${items(f)}, ${when(f)}, ${how(f)}${f.address ? ` (ವಿಳಾಸ: ${f.address})` : ""}. ಒಟ್ಟು ${inr(f, "totalInr")}, ಮುಂಗಡ ${inr(f, "advanceInr")} ಸಿಕ್ಕಿದೆ, ${inr(f, "balanceInr")} ಪಡೆಯಬೇಕು. ಈಗ ಏನೂ ಮಾಡಬೇಕಿಲ್ಲ.`,
  owner_big_order: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} ಅವರಿಗೆ ${items(f)} ಬೇಕು, ${when(f)}, ${how(f)}. ಒಟ್ಟು ${inr(f, "totalInr")}. ಪಾವತಿಗೆ ಅನುಮತಿಸಲು "approve ${need(f, "orderRef")}" ಎಂದು, ನಿರಾಕರಿಸಲು "deny ${need(f, "orderRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_order_cancelled: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಆರ್ಡರ್ ${need(f, "orderRef")} ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ: ${items(f)}, ${when(f)}. ದಯವಿಟ್ಟು ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಬೇಡಿ.`,
  owner_late_cancellation: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ಆರ್ಡರ್ ${need(f, "orderRef")} (${items(f)}, ${when(f)}) ಪ್ರಾರಂಭಕ್ಕೆ ${need(f, "windowHours")} ಗಂಟೆಗಿಂತ ಕಡಿಮೆ ಇರುವಾಗ ರದ್ದುಗೊಳಿಸಿದ್ದಾರೆ. ಮುಂಗಡ ${inr(f, "advanceInr")}. ಹಿಂತಿರುಗಿಸಲು "approve ${need(f, "orderRef")}" ಎಂದು, ಇಟ್ಟುಕೊಳ್ಳಲು "deny ${need(f, "orderRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_duplicate_payment: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ಆರ್ಡರ್ ${need(f, "orderRef")} (${items(f)}, ${when(f)}) — ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡಲಾಗಿದೆ.`,
  owner_payment_unused: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ಆರ್ಡರ್ ${need(f, "orderRef")} (${day(f)}) ಗಾಗಿ ${inr(f, "advanceInr")} ಪಾವತಿ ಬಂದಿದೆ, ಆದರೆ ಆ ಆರ್ಡರ್ ಆಗ ಚಾಲ್ತಿಯಲ್ಲಿ ಇರಲಿಲ್ಲ (ಕಾಯ್ದಿರಿಸಿದ ಸಮಯ ಮುಗಿದಿತ್ತು ಮತ್ತು ಮತ್ತೆ ತೆಗೆದುಕೊಳ್ಳಲು ಆಗಲಿಲ್ಲ, ಅಥವಾ ರದ್ದಾಗಿತ್ತು). ${inr(f, "refundInr")} ಮರಳಿ ಕೊಡಲಾಗಿದೆ.`,
  owner_link_failed: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಅವರ ಆರ್ಡರ್ ${need(f, "orderRef")} ಗೆ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ. ಏನೂ ಆರ್ಡರ್ ಆಗಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪಾವತಿ ಖಾತೆಯನ್ನು ನೋಡಿ.`,
  owner_message_held: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ಕಳುಹಿಸಬೇಕಿದ್ದ ಒಂದು ಸಂದೇಶ ಆರ್ಡರ್ ದಾಖಲೆಗೆ ಹೊಂದಿಕೆಯಾಗದ ಕಾರಣ ತಡೆಹಿಡಿಯಲಾಗಿದೆ. ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ.`,
  owner_opted_out: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} STOP ಕಳುಹಿಸಿದ್ದಾರೆ. ಇನ್ನು ಅವರಿಗೆ ಸಂದೇಶಗಳನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  owner_unknown_command: () => `ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. "approve" ಅಥವಾ "deny" ಎಂದು ಬರೆದು, ನಂತರ ಆರ್ಡರ್ ರೆಫರೆನ್ಸ್ ಬರೆಯಿರಿ.`,
  owner_wants_to_talk: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_ai_allowance: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಈ ತಿಂಗಳ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಈಗ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳ ಮೂಲಕ ಉತ್ತರಿಸುತ್ತದೆ. ಆರ್ಡರ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಸಾಮಾನ್ಯ ಸೇವೆ ಮರಳುತ್ತದೆ.`,
  owner_ai_off: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಸದ್ಯಕ್ಕೆ ಆಫ್ ಮಾಡಲಾಗಿದೆ. ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳಿಂದ ಆರ್ಡರ್ ತೆಗೆದುಕೊಳ್ಳುವುದನ್ನು ಮುಂದುವರಿಸುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
  owner_ai_fault: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಬಟನ್‌ಗಳು ಮತ್ತು ಪಟ್ಟಿಗಳನ್ನು ಬಳಸುತ್ತಿದೆ. ಆರ್ಡರ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಏಜೆಂಟ್ ಮತ್ತೆ AI ಪ್ರಯತ್ನಿಸುತ್ತದೆ.`,
  owner_refund_needs_approval: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} (ಆರ್ಡರ್ ${need(f, "orderRef")}, ${day(f)}) ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್. ${need(f, "approvalHours")} ಗಂಟೆಯೊಳಗೆ "approve ${need(f, "approvalCode")}" ಅಥವಾ "deny ${need(f, "approvalCode")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_approval_done: (f) => `ಧನ್ಯವಾದ. ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_approval_denied: (f) => `ಅರ್ಥವಾಯಿತು. ಗ್ರಾಹಕರು ${need(f, "customerPhone")}: ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_approval_expired: (f) => `ನೀವು ಉತ್ತರಿಸುವ ಮೊದಲೇ ಆ ವಿನಂತಿಯ ಸಮಯ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಮರಳಿ ಕೊಟ್ಟಿಲ್ಲ: ಗ್ರಾಹಕರು ${need(f, "customerPhone")}, ${inr(f, "refundInr")}.`,
  owner_approval_failed: () => "ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಈಗ ದಾಖಲಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಕಳುಹಿಸಿ.",
};

// ---- UPI, marked paid by the owner (plan B33; modules/payments/upi) ------------------------------------------------------------
// A shop that takes UPI: the customer pays the shop's own UPI ID, and the order is confirmed only when the owner taps "Received" (or replies "received <code>"). These
// messages never say a payment was checked by the agent: the owner confirms it. A refund is sent by the owner from their own UPI app, and the customer hears "sent" only
// after the owner marks it so. The owner's lines start and end with fixed words, as every owner line does (several are WhatsApp templates: meta-templates.ts).

const payee = (f: MessageFacts) => need(f, "payee");
const code = (f: MessageFacts) => need(f, "upiCode");
const ref = (f: MessageFacts) => need(f, "orderRef");
const marked = (f: MessageFacts) => formatInr(need(f, "markedInr"));
const left = (f: MessageFacts) => formatInr(need(f, "leftInr"));

const upiEn: UpiSet = {
  upi_qr_caption: (f) => `Scan to pay ${inr(f, "advanceInr")} by UPI to ${payee(f)} for order ${ref(f)}.`,
  upi_paid_claim: (f) => `Thank you. The owner will look for your ${inr(f, "advanceInr")} payment in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message.`,
  upi_nothing_waiting: () => "Thank you. No UPI payment is waiting for you just now, so there is nothing for the owner to confirm. If you paid for something else, please talk to the owner.",
  upi_late_received: (f) => `The owner confirmed your ${marked(f)} payment after the hold on your order for ${day(f)} had ended, so the order is not confirmed. The owner will contact you about ordering again or sending the money back.`,
  upi_refund_owed: (f) => `The owner will send ${inr(f, "refundInr")} back to you by UPI. I'll message you when they mark it sent.`,
  upi_cancelled_refund_owed: (f) => `Your order for ${when(f)} is cancelled. The owner will send your ${inr(f, "refundInr")} back to you by UPI, and I'll message you when they mark it sent.`,
  upi_extra_refund_owed: (f) => `You paid more than the advance. The owner will send the extra ${inr(f, "refundInr")} back to you by UPI, and I'll message you when they mark it sent.`,
  upi_refund_sent: (f) => `The owner has marked your ${inr(f, "refundInr")} refund for order ${ref(f)} as sent by UPI. Please check your UPI app.`,

  owner_upi_expected: (f) => `UPI payment to check: customer ${need(f, "customerPhone")} will pay the ${inr(f, "advanceInr")} advance for order ${ref(f)} (${items(f)}, ${when(f)}). When it shows in your UPI app, tap Received or reply "received ${code(f)}". If a different amount came, reply "received ${code(f)}" and the amount.`,
  owner_upi_claim: (f) => `Customer ${need(f, "customerPhone")} says they have paid the ${inr(f, "advanceInr")} advance for order ${ref(f)}. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received ${code(f)}".`,
  owner_upi_marked: (f) => `Thank you. ${marked(f)} for order ${ref(f)} is marked paid by you.`,
  owner_upi_part: (f) => `You marked ${marked(f)} for order ${ref(f)}, but the advance is ${inr(f, "advanceInr")}, so it is not confirmed yet. The order stays held until the hold ends. When the other ${left(f)} arrives, tap Received or reply "received ${code(f)}".`,
  owner_upi_already: () => "That payment is already marked. It is counted once.",
  owner_upi_unknown: () => "I don't know that code. Please use the code in my latest message about the payment.",
  owner_upi_late: (f) => `You marked ${marked(f)} received for order ${ref(f)} after its hold had ended, so it was not confirmed again by itself. Take customer ${need(f, "customerPhone")}'s order again yourself, or send the ${inr(f, "refundInr")} back by UPI. Then tap Refund sent or Kept for order, or reply "refunded ${code(f)}" or "kept ${code(f)}".`,
  owner_upi_refund_owed: (f) => `Refund to send: customer ${need(f, "customerPhone")} (order ${ref(f)}) is owed ${inr(f, "refundInr")} by UPI. The agent never sends money. After you send it, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_upi_refund_reminder: (f) => `Reminder: customer ${need(f, "customerPhone")} (order ${ref(f)}) is still owed ${inr(f, "refundInr")}. After you send it by UPI, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_upi_refund_marked: (f) => `Thank you. The ${inr(f, "refundInr")} refund for order ${ref(f)} is marked sent, and the customer has been told.`,
  owner_upi_refund_kept: (f) => `Okay. The ${inr(f, "refundInr")} for order ${ref(f)} is kept for an order you take by hand. Nothing more is owed back.`,
};

const upiHi: UpiSet = {
  upi_qr_caption: (f) => `ऑर्डर ${ref(f)} के लिए ${payee(f)} को UPI से ${inr(f, "advanceInr")} भेजने के लिए स्कैन करें।`,
  upi_paid_claim: (f) => `धन्यवाद। मालिक अपने UPI ऐप में आपका ${inr(f, "advanceInr")} देखकर पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा। स्क्रीनशॉट पेमेंट का सबूत नहीं है, इसलिए कृपया उस संदेश का इंतज़ार करें।`,
  upi_nothing_waiting: () => "धन्यवाद। अभी आपका कोई UPI पेमेंट बाकी नहीं है, इसलिए मालिक के पास पक्का करने को कुछ नहीं है। अगर आपने किसी और चीज़ के लिए पैसे भेजे हैं, तो कृपया मालिक से बात करें।",
  upi_late_received: (f) => `मालिक ने आपका ${marked(f)} पेमेंट ${day(f)} के ऑर्डर की रोक खत्म होने के बाद पक्का किया, इसलिए ऑर्डर पक्का नहीं हुआ है। मालिक आपसे दोबारा ऑर्डर या पैसे वापस भेजने के बारे में बात करेंगे।`,
  upi_refund_owed: (f) => `मालिक ${inr(f, "refundInr")} UPI से आपको वापस भेजेंगे। जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  upi_cancelled_refund_owed: (f) => `${when(f)} का आपका ऑर्डर रद्द हो गया है। मालिक आपका ${inr(f, "refundInr")} UPI से वापस भेजेंगे, और जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  upi_extra_refund_owed: (f) => `आपने एडवांस से ज़्यादा पैसे भेजे हैं। मालिक ज़्यादा भेजे गए ${inr(f, "refundInr")} UPI से वापस भेजेंगे, और जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  upi_refund_sent: (f) => `मालिक ने ऑर्डर ${ref(f)} का आपका ${inr(f, "refundInr")} रिफंड UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देखें।`,

  owner_upi_expected: (f) => `जाँचने के लिए UPI पेमेंट: ग्राहक ${need(f, "customerPhone")} ऑर्डर ${ref(f)} (${items(f)}, ${when(f)}) के लिए ${inr(f, "advanceInr")} एडवांस भेजेंगे। जब यह आपके UPI ऐप में दिखे, तो "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें। अगर कोई और रकम आई है, तो "received ${code(f)}" के बाद रकम लिखें।`,
  owner_upi_claim: (f) => `ग्राहक ${need(f, "customerPhone")} कह रहे हैं कि उन्होंने ऑर्डर ${ref(f)} का ${inr(f, "advanceInr")} एडवांस भेज दिया है। स्क्रीनशॉट सबूत नहीं है: अपना UPI ऐप देखें। पैसे दिखें तो "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें।`,
  owner_upi_marked: (f) => `धन्यवाद। ऑर्डर ${ref(f)} के ${marked(f)} आपने मिला हुआ दर्ज किया है।`,
  owner_upi_part: (f) => `आपने ऑर्डर ${ref(f)} के लिए ${marked(f)} दर्ज किया, पर एडवांस ${inr(f, "advanceInr")} है, इसलिए ऑर्डर अभी पक्का नहीं हुआ। रोक का समय खत्म होने तक ऑर्डर रुका रहेगा। बाकी ${left(f)} आने पर "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें।`,
  owner_upi_already: () => "यह पेमेंट पहले ही दर्ज है। इसे एक ही बार गिना गया है।",
  owner_upi_unknown: () => "मैं यह कोड नहीं पहचानता। कृपया उस पेमेंट के बारे में मेरे सबसे नए संदेश वाला कोड इस्तेमाल करें।",
  owner_upi_late: (f) => `आपने ऑर्डर ${ref(f)} के ${marked(f)} उसकी रोक खत्म होने के बाद दर्ज किए, इसलिए ऑर्डर अपने-आप दोबारा पक्का नहीं हुआ। ग्राहक ${need(f, "customerPhone")} का ऑर्डर खुद दोबारा लें, या ${inr(f, "refundInr")} UPI से वापस भेजें। फिर "रिफंड भेज दिया" या "ऑर्डर के लिए रखा" दबाएँ, या "refunded ${code(f)}" या "kept ${code(f)}" लिखकर भेजें।`,
  owner_upi_refund_owed: (f) => `वापस भेजना है: ग्राहक ${need(f, "customerPhone")} (ऑर्डर ${ref(f)}) को UPI से ${inr(f, "refundInr")}। एजेंट कभी पैसे नहीं भेजता। भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded ${code(f)}" लिखकर भेजें।`,
  owner_upi_refund_reminder: (f) => `याद दिलाना: ग्राहक ${need(f, "customerPhone")} (ऑर्डर ${ref(f)}) को ${inr(f, "refundInr")} अभी भी वापस देना है। UPI से भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded ${code(f)}" लिखकर भेजें।`,
  owner_upi_refund_marked: (f) => `धन्यवाद। ऑर्डर ${ref(f)} का ${inr(f, "refundInr")} रिफंड भेजा हुआ दर्ज हो गया है, और ग्राहक को बता दिया गया है।`,
  owner_upi_refund_kept: (f) => `ठीक है। ऑर्डर ${ref(f)} के ${inr(f, "refundInr")} आपके खुद लिए गए ऑर्डर के लिए रखे गए हैं। अब कुछ वापस देना बाकी नहीं है।`,
};

const upiMl: UpiSet = {
  upi_qr_caption: (f) => `ഓർഡർ ${ref(f)}-നായി ${payee(f)}-ന് UPI വഴി ${inr(f, "advanceInr")} അയക്കാൻ സ്കാൻ ചെയ്യൂ.`,
  upi_paid_claim: (f) => `നന്ദി. ഉടമ അവരുടെ UPI ആപ്പിൽ നിങ്ങളുടെ ${inr(f, "advanceInr")} നോക്കി ഉറപ്പിക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയക്കും. സ്ക്രീൻഷോട്ട് പണമടച്ചതിന്റെ തെളിവല്ല, അതിനാൽ ആ സന്ദേശത്തിനായി കാത്തിരിക്കൂ.`,
  upi_nothing_waiting: () => "നന്ദി. ഇപ്പോൾ നിങ്ങളുടെ ഒരു UPI പണമടവും ബാക്കിയില്ല, അതിനാൽ ഉടമയ്ക്ക് ഉറപ്പിക്കാൻ ഒന്നുമില്ല. മറ്റെന്തിനെങ്കിലും പണം അയച്ചിട്ടുണ്ടെങ്കിൽ ദയവായി ഉടമയോട് സംസാരിക്കൂ.",
  upi_late_received: (f) => `നിങ്ങളുടെ ${marked(f)} ഉടമ ഉറപ്പിച്ചത് ${day(f)}-ലെ ഓർഡർ മാറ്റിവച്ചത് അവസാനിച്ച ശേഷമാണ്, അതിനാൽ ഓർഡർ ഉറപ്പായിട്ടില്ല. വീണ്ടും ഓർഡർ ചെയ്യുന്നതിനെക്കുറിച്ചോ പണം തിരികെ അയക്കുന്നതിനെക്കുറിച്ചോ ഉടമ നിങ്ങളെ ബന്ധപ്പെടും.`,
  upi_refund_owed: (f) => `ഉടമ ${inr(f, "refundInr")} UPI വഴി നിങ്ങൾക്ക് തിരികെ അയക്കും. അയച്ചതായി ഉടമ രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.`,
  upi_cancelled_refund_owed: (f) => `${when(f)}-ലെ നിങ്ങളുടെ ഓർഡർ റദ്ദാക്കി. ഉടമ നിങ്ങളുടെ ${inr(f, "refundInr")} UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.`,
  upi_extra_refund_owed: (f) => `നിങ്ങൾ അഡ്വാൻസിനേക്കാൾ കൂടുതൽ അയച്ചു. അധികമായ ${inr(f, "refundInr")} ഉടമ UPI വഴി തിരികെ അയക്കും, അയച്ചതായി രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.`,
  upi_refund_sent: (f) => `ഓർഡർ ${ref(f)}-ന്റെ നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് UPI വഴി അയച്ചതായി ഉടമ രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ.`,

  owner_upi_expected: (f) => `പരിശോധിക്കാനുള്ള UPI പണമടവ്: ഉപഭോക്താവ് ${need(f, "customerPhone")}, ഓർഡർ ${ref(f)} (${items(f)}, ${when(f)}) എന്നതിനായി ${inr(f, "advanceInr")} അഡ്വാൻസ് അയക്കും. നിങ്ങളുടെ UPI ആപ്പിൽ കാണുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക. മറ്റൊരു തുക ആണ് വന്നതെങ്കിൽ "received ${code(f)}" എന്നതിന് ശേഷം തുക എഴുതുക.`,
  owner_upi_claim: (f) => `ഉപഭോക്താവ് ${need(f, "customerPhone")} ഓർഡർ ${ref(f)}-ന്റെ ${inr(f, "advanceInr")} അഡ്വാൻസ് അയച്ചെന്ന് പറയുന്നു. സ്ക്രീൻഷോട്ട് തെളിവല്ല: നിങ്ങളുടെ UPI ആപ്പ് നോക്കുക. പണം ഉണ്ടെങ്കിൽ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_marked: (f) => `നന്ദി. ഓർഡർ ${ref(f)}-ന്റെ ${marked(f)} നിങ്ങൾ കിട്ടിയതായി രേഖപ്പെടുത്തി.`,
  owner_upi_part: (f) => `ഓർഡർ ${ref(f)}-ന് നിങ്ങൾ ${marked(f)} രേഖപ്പെടുത്തി, പക്ഷേ അഡ്വാൻസ് ${inr(f, "advanceInr")} ആണ്, അതിനാൽ ഇതുവരെ ഉറപ്പായിട്ടില്ല. മാറ്റിവച്ച സമയം തീരും വരെ ഓർഡർ പിടിച്ചുവെക്കും. ബാക്കി ${left(f)} എത്തുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_already: () => "ആ പണമടവ് ഇതിനകം രേഖപ്പെടുത്തിയിട്ടുണ്ട്. അത് ഒരു തവണ മാത്രം കണക്കാക്കും.",
  owner_upi_unknown: () => "ആ കോഡ് എനിക്ക് അറിയില്ല. ആ പണമടവിനെക്കുറിച്ചുള്ള എന്റെ ഏറ്റവും പുതിയ സന്ദേശത്തിലെ കോഡ് ഉപയോഗിക്കുക.",
  owner_upi_late: (f) => `ഓർഡർ ${ref(f)}-ന്റെ മാറ്റിവച്ച സമയം അവസാനിച്ച ശേഷമാണ് നിങ്ങൾ ${marked(f)} കിട്ടിയതായി രേഖപ്പെടുത്തിയത്, അതിനാൽ അത് സ്വയം വീണ്ടും ഉറപ്പായില്ല. ഉപഭോക്താവ് ${need(f, "customerPhone")}-ന്റെ ഓർഡർ നിങ്ങൾ തന്നെ വീണ്ടും എടുക്കുക, അല്ലെങ്കിൽ ${inr(f, "refundInr")} UPI വഴി തിരികെ അയക്കുക. പിന്നെ "റീഫണ്ട് അയച്ചു" അല്ലെങ്കിൽ "ഓർഡറിനായി വെച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" അല്ലെങ്കിൽ "kept ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_refund_owed: (f) => `തിരികെ അയക്കേണ്ടത്: ഉപഭോക്താവ് ${need(f, "customerPhone")}-ന് (ഓർഡർ ${ref(f)}) UPI വഴി ${inr(f, "refundInr")}. ഏജന്റ് ഒരിക്കലും പണം അയക്കില്ല. അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_refund_reminder: (f) => `ഓർമ്മപ്പെടുത്തൽ: ഉപഭോക്താവ് ${need(f, "customerPhone")}-ന് (ഓർഡർ ${ref(f)}) ${inr(f, "refundInr")} ഇനിയും തിരികെ നൽകാനുണ്ട്. UPI വഴി അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_upi_refund_marked: (f) => `നന്ദി. ഓർഡർ ${ref(f)}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ട് അയച്ചതായി രേഖപ്പെടുത്തി, ഉപഭോക്താവിനെ അറിയിച്ചു.`,
  owner_upi_refund_kept: (f) => `ശരി. ഓർഡർ ${ref(f)}-ന്റെ ${inr(f, "refundInr")} നിങ്ങൾ തന്നെ എടുക്കുന്ന ഓർഡറിനായി വെച്ചു. ഇനി ഒന്നും തിരികെ നൽകാനില്ല.`,
};

const upiKn: UpiSet = {
  upi_qr_caption: (f) => `ಆರ್ಡರ್ ${ref(f)} ಗಾಗಿ ${payee(f)} ಗೆ UPI ಮೂಲಕ ${inr(f, "advanceInr")} ಪಾವತಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.`,
  upi_paid_claim: (f) => `ಧನ್ಯವಾದ. ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನಿಮ್ಮ ${inr(f, "advanceInr")} ನೋಡಿ ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪಾವತಿಯ ಪುರಾವೆ ಅಲ್ಲ, ಆದ್ದರಿಂದ ದಯವಿಟ್ಟು ಆ ಸಂದೇಶಕ್ಕಾಗಿ ಕಾಯಿರಿ.`,
  upi_nothing_waiting: () => "ಧನ್ಯವಾದ. ಈಗ ನಿಮ್ಮ ಯಾವುದೇ UPI ಪಾವತಿ ಬಾಕಿ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಮಾಲೀಕರು ಖಚಿತಪಡಿಸಲು ಏನೂ ಇಲ್ಲ. ಬೇರೆ ಯಾವುದಕ್ಕಾದರೂ ಹಣ ಕಳುಹಿಸಿದ್ದರೆ ದಯವಿಟ್ಟು ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.",
  upi_late_received: (f) => `ನಿಮ್ಮ ${marked(f)} ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ${day(f)} ರ ಆರ್ಡರ್ ಕಾಯ್ದಿರಿಸಿದ್ದು ಮುಗಿದ ನಂತರ ಖಚಿತಪಡಿಸಿದರು, ಆದ್ದರಿಂದ ಆರ್ಡರ್ ಖಚಿತವಾಗಿಲ್ಲ. ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡುವ ಅಥವಾ ಹಣ ಮರಳಿ ಕಳುಹಿಸುವ ಬಗ್ಗೆ ಮಾಲೀಕರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.`,
  upi_refund_owed: (f) => `ಮಾಲೀಕರು ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ. ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_cancelled_refund_owed: (f) => `${when(f)} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ. ಮಾಲೀಕರು ನಿಮ್ಮ ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_extra_refund_owed: (f) => `ನೀವು ಮುಂಗಡ ಹಣಕ್ಕಿಂತ ಹೆಚ್ಚು ಕಳುಹಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಅನ್ನು ಮಾಲೀಕರು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ, ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  upi_refund_sent: (f) => `ಆರ್ಡರ್ ${ref(f)} ರ ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಮಾಲೀಕರು ದಾಖಲಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ.`,

  owner_upi_expected: (f) => `ಪರಿಶೀಲಿಸಬೇಕಾದ UPI ಪಾವತಿ: ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಆರ್ಡರ್ ${ref(f)} (${items(f)}, ${when(f)}) ಗಾಗಿ ${inr(f, "advanceInr")} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸುತ್ತಾರೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಂಡಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ "received ${code(f)}" ನಂತರ ಮೊತ್ತ ಬರೆಯಿರಿ.`,
  owner_upi_claim: (f) => `ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಆರ್ಡರ್ ${ref(f)} ರ ${inr(f, "advanceInr")} ಮುಂಗಡ ಹಣ ಕಳುಹಿಸಿದ್ದೇವೆ ಎನ್ನುತ್ತಿದ್ದಾರೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ: ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ. ಹಣ ಇದ್ದರೆ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_marked: (f) => `ಧನ್ಯವಾದ. ಆರ್ಡರ್ ${ref(f)} ರ ${marked(f)} ಬಂದಿದೆ ಎಂದು ನೀವು ದಾಖಲಿಸಿದ್ದೀರಿ.`,
  owner_upi_part: (f) => `ಆರ್ಡರ್ ${ref(f)} ಗೆ ನೀವು ${marked(f)} ದಾಖಲಿಸಿದ್ದೀರಿ, ಆದರೆ ಮುಂಗಡ ಹಣ ${inr(f, "advanceInr")}, ಆದ್ದರಿಂದ ಇನ್ನೂ ಖಚಿತವಾಗಿಲ್ಲ. ಕಾಯ್ದಿರಿಸುವ ಸಮಯ ಮುಗಿಯುವವರೆಗೆ ಆರ್ಡರ್ ಕಾಯ್ದಿರುತ್ತದೆ. ಉಳಿದ ${left(f)} ಬಂದಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_already: () => "ಆ ಪಾವತಿ ಈಗಾಗಲೇ ದಾಖಲಾಗಿದೆ. ಅದನ್ನು ಒಂದೇ ಬಾರಿ ಎಣಿಸಲಾಗುತ್ತದೆ.",
  owner_upi_unknown: () => "ಆ ಕೋಡ್ ನನಗೆ ಗೊತ್ತಿಲ್ಲ. ಆ ಪಾವತಿಯ ಬಗ್ಗೆ ನನ್ನ ಇತ್ತೀಚಿನ ಸಂದೇಶದಲ್ಲಿರುವ ಕೋಡ್ ಬಳಸಿ.",
  owner_upi_late: (f) => `ಆರ್ಡರ್ ${ref(f)} ರ ಕಾಯ್ದಿರಿಸುವಿಕೆ ಮುಗಿದ ನಂತರ ನೀವು ${marked(f)} ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದೀರಿ, ಆದ್ದರಿಂದ ಅದು ತಾನಾಗಿ ಮತ್ತೆ ಖಚಿತವಾಗಲಿಲ್ಲ. ಗ್ರಾಹಕರು ${need(f, "customerPhone")} ಅವರ ಆರ್ಡರ್ ಅನ್ನು ನೀವೇ ಮತ್ತೆ ತೆಗೆದುಕೊಳ್ಳಿ, ಅಥವಾ ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ಮರಳಿ ಕಳುಹಿಸಿ. ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಅಥವಾ "ಆರ್ಡರ್‌ಗೆ ಇಟ್ಟಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಅಥವಾ "kept ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_refund_owed: (f) => `ಮರಳಿ ಕಳುಹಿಸಬೇಕು: ಗ್ರಾಹಕರು ${need(f, "customerPhone")} (ಆರ್ಡರ್ ${ref(f)}) ಅವರಿಗೆ UPI ಮೂಲಕ ${inr(f, "refundInr")}. ಏಜೆಂಟ್ ಎಂದಿಗೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_refund_reminder: (f) => `ನೆನಪಿಸುವುದು: ಗ್ರಾಹಕರು ${need(f, "customerPhone")} (ಆರ್ಡರ್ ${ref(f)}) ಅವರಿಗೆ ${inr(f, "refundInr")} ಇನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_upi_refund_marked: (f) => `ಧನ್ಯವಾದ. ಆರ್ಡರ್ ${ref(f)} ರ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ದಾಖಲಾಗಿದೆ, ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
  owner_upi_refund_kept: (f) => `ಸರಿ. ಆರ್ಡರ್ ${ref(f)} ರ ${inr(f, "refundInr")} ಅನ್ನು ನೀವೇ ತೆಗೆದುಕೊಳ್ಳುವ ಆರ್ಡರ್‌ಗಾಗಿ ಇಡಲಾಗಿದೆ. ಇನ್ನು ಏನನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿಲ್ಲ.`,
};

// ---- the licence's wind-down and final stop (plan B13) --------------------------------------------------------------------------------------------------
// The customer hears that ordering is paused and to contact the shop: no promise to take the order later. The owner hears once, plainly, and is told who to contact; the
// final stop's notice says nothing is deleted, what is still open, and until when the free copy of the records can be had.
const partner = (f: MessageFacts) => need(f, "partner");
const until = (f: MessageFacts) => formatDate(localParts(need(f, "licenceDateMs"), f.timeZone), f.language);
const upcoming = (f: MessageFacts) => need(f, "upcomingCount");
const open = (f: MessageFacts) => need(f, "openCount");

const licenceEn: LicenceSet = {
  orders_paused: (f) => `Online ordering is paused for now. Please contact ${f.businessName} directly.`,
  owner_licence_paused: (f) => `Notice: online ordering for ${f.businessName} is paused for now. Existing orders, cancellations and refunds still go through. Please contact ${partner(f)}.`,
  owner_licence_stopped: (f) => `Notice: online ordering for ${f.businessName} has stopped. Nothing is deleted. Orders to come: ${upcoming(f)}. Other open items: ${open(f)}. ${partner(f)} can give you the full list and a free copy of all your records until ${until(f)}.`,
};
const licenceHi: LicenceSet = {
  orders_paused: (f) => `ऑनलाइन ऑर्डर अभी रुके हुए हैं। कृपया सीधे ${f.businessName} से संपर्क करें।`,
  owner_licence_paused: (f) => `सूचना: ${f.businessName} के ऑनलाइन ऑर्डर अभी रुके हुए हैं। पहले के ऑर्डर, रद्द करना और रिफंड पहले की तरह चलते रहेंगे। इस बारे में कृपया ${partner(f)} से संपर्क करें।`,
  owner_licence_stopped: (f) => `सूचना: ${f.businessName} के ऑनलाइन ऑर्डर बंद हो गए हैं। कुछ भी मिटाया नहीं गया है। आने वाले ऑर्डर: ${upcoming(f)}। बाकी खुले काम: ${open(f)}। पूरी सूची और आपके सभी रिकॉर्ड की मुफ़्त कॉपी ${until(f)} तक ${partner(f)} से मिल सकती है।`,
};
const licenceMl: LicenceSet = {
  orders_paused: (f) => `ഓൺലൈൻ ഓർഡർ തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
  owner_licence_paused: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഓൺലൈൻ ഓർഡർ തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. നിലവിലുള്ള ഓർഡറുകളും റദ്ദാക്കലുകളും റീഫണ്ടുകളും തുടർന്നും നടക്കും. ഇതിനെക്കുറിച്ച് ദയവായി ${partner(f)}-നെ ബന്ധപ്പെടൂ.`,
  owner_licence_stopped: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഓൺലൈൻ ഓർഡർ നിർത്തി. ഒന്നും മായ്ച്ചിട്ടില്ല. വരാനുള്ള ഓർഡറുകൾ: ${upcoming(f)}. മറ്റ് തീരാത്ത കാര്യങ്ങൾ: ${open(f)}. മുഴുവൻ പട്ടികയും നിങ്ങളുടെ എല്ലാ രേഖകളുടെയും സൗജന്യ പകർപ്പും ${until(f)} വരെ ${partner(f)} നൽകും.`,
};
const licenceKn: LicenceSet = {
  orders_paused: (f) => `ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನೇರವಾಗಿ ${f.businessName} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_paused: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಈಗಿರುವ ಆರ್ಡರ್‌ಗಳು, ರದ್ದತಿಗಳು ಮತ್ತು ರೀಫಂಡ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ. ಈ ಬಗ್ಗೆ ದಯವಿಟ್ಟು ${partner(f)} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_stopped: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಆರ್ಡರ್ ನಿಂತಿದೆ. ಏನನ್ನೂ ಅಳಿಸಿಲ್ಲ. ಮುಂದಿನ ಆರ್ಡರ್‌ಗಳು: ${upcoming(f)}. ಉಳಿದ ಬಾಕಿ ಕೆಲಸಗಳು: ${open(f)}. ಪೂರ್ಣ ಪಟ್ಟಿ ಮತ್ತು ನಿಮ್ಮ ಎಲ್ಲಾ ದಾಖಲೆಗಳ ಉಚಿತ ಪ್ರತಿಯನ್ನು ${until(f)} ವರೆಗೆ ${partner(f)} ನೀಡುತ್ತಾರೆ.`,
};

export const TEMPLATES: Record<Language, TemplateSet> = { en: { ...en, ...upiEn, ...licenceEn }, hi: { ...hi, ...upiHi, ...licenceHi }, ml: { ...ml, ...upiMl, ...licenceMl }, kn: { ...kn, ...upiKn, ...licenceKn } };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
