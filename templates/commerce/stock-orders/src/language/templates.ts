// Every message the Stock orders agent sends, per language. There is NO model-written text: each message is one of these templates, and every item, quantity, unit, amount,
// supplier and order number in it is rendered from the record (the facts), never typed by hand and never translated. Adding a language means adding one more object; the
// type makes sure none is missing. Hindi, Malayalam and Kannada are machine-written and wait for a native speaker (REVIEW-hi.md, REVIEW-ml.md, REVIEW-kn.md list every line).
//
// A message that goes out unasked is also a WhatsApp template (meta-templates.ts), and Meta rejects a body that starts or ends with a value, so those messages start and
// end with fixed words. The wording of such a template is read out of the message itself, so the Hindi, Malayalam and Kannada exist in one place.
import { formatInr } from "../../../../../modules/language/format.ts";
import type { Language } from "../../../../../modules/language/languages.ts";

/** One order as a row in the status list. */
export interface StatusRow { ref: string; itemName: string; unitName: string; supplierName: string; qty: number; receivedQty: number; totalInr: number; stateWord: string }

/** The values of this order's record that a message may use. The outgoing check reads the same object (check.ts). */
export interface MessageFacts {
  language: Language;
  timeZone: string;
  businessName: string;
  supplierName?: string;
  itemName?: string;
  unitName?: string;
  qty?: number;
  unitPriceInr?: number;
  totalInr?: number;
  orderRef?: string;
  /** The approval card's one-use code (modules/approvals/code.ts); only ever in a message to the owner. */
  code?: string;
  budgetInr?: number;
  /** What the month's other approved orders hold. */
  reservedInr?: number;
  /** What is left of the budget after this order (or, in a block, what was left before it). */
  leftInr?: number;
  capInr?: number;
  limitInr?: number;
  receivedQty?: number;
  moreQty?: number;
  /** A quantity the owner wrote, when it is not the order's own. */
  saidQty?: number;
  maxQty?: number;
  hours?: number;
  /** "Nov 2026": the month the budget is for. */
  monthLabel?: string;
  /** What the order is waiting on, in words ("waiting for your approval"). */
  stateWord?: string;
  /** The ways to order an item, for a list the owner picks from. */
  choices?: { supplierName: string; unitName: string; priceInr: number }[];
  /** Plain words the message repeats as they are: item names, order numbers, an example request. */
  options?: string[];
  refs?: string[];
  example?: string;
  lines?: StatusRow[];
}

export type TemplateId =
  // to a supplier
  | "supplier_order" | "supplier_check" | "supplier_which" | "supplier_unclear" | "supplier_thanks_yes" | "supplier_thanks_no"
  // to the owner: the approval card and what comes of it
  | "card" | "card_changed" | "card_closed" | "card_expired" | "card_unknown" | "order_declined" | "order_approved"
  // to the owner: the order on its way to the supplier
  | "sent_ok" | "sent_unknown" | "send_failed" | "send_blocked" | "owner_supplier_accepted" | "owner_supplier_declined" | "owner_supplier_silent" | "owner_supplier_stopped"
  // to the owner: the delivery, the payment note, changes
  | "received_full" | "received_part" | "received_wrong" | "receive_too_many" | "order_not_open" | "paid_outside_noted" | "cannot_change" | "cancelled" | "cannot_cancel" | "no_such_order"
  // to the owner: what the agent will not guess, and what the limits say no to
  | "ask_line" | "ask_qty" | "item_unknown" | "blocked_supplier" | "blocked_cap" | "blocked_budget" | "blocked_qty" | "already_open" | "status" | "status_empty" | "didnt_understand" | "owner_message_held";

/** Which approved WhatsApp template carries a message once the window has closed and no exact template fits. */
export const TEMPLATE_NAMES = { customer: "stock_supplier_update", owner: "stock_owner_notice" } as const;

type Set = Record<TemplateId, (f: MessageFacts) => string>;

export const need = <K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> => {
  const v = f[key];
  if (v === undefined || v === null) throw new Error(`The record has no ${String(key)} for this message.`);
  return v as NonNullable<MessageFacts[K]>;
};
export const inr = (f: MessageFacts, key: "unitPriceInr" | "totalInr" | "budgetInr" | "reservedInr" | "leftInr" | "capInr" | "limitInr"): string => money(need(f, key));
/** Whole rupees plainly ("₹4,500"), otherwise two decimals ("₹37.50"). The same function the limits' reasons use. */
export function money(rupees: number): string {
  return Number.isInteger(rupees) ? formatInr(rupees) : `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const n = (f: MessageFacts, key: "qty" | "receivedQty" | "moreQty" | "saidQty" | "maxQty" | "hours"): string => String(need(f, key));
const ref = (f: MessageFacts) => need(f, "orderRef");
const sup = (f: MessageFacts) => need(f, "supplierName");
const item = (f: MessageFacts) => need(f, "itemName");
const unit = (f: MessageFacts) => need(f, "unitName");
const code = (f: MessageFacts) => need(f, "code");
const month = (f: MessageFacts) => need(f, "monthLabel");
const list = (xs: readonly string[] | undefined): string => (xs ?? []).join(", ");

/** The order as one line: how many, of what, in which unit, at what price per unit, and the total. The only place an order's money is written out. */
const line: Record<Language, (f: MessageFacts) => string> = {
  en: (f) => `${n(f, "qty")} × ${item(f)} (${unit(f)}), ${inr(f, "unitPriceInr")} per ${unit(f)}, total ${inr(f, "totalInr")}`,
  hi: (f) => `${n(f, "qty")} × ${item(f)} (${unit(f)}), ${inr(f, "unitPriceInr")} प्रति ${unit(f)}, कुल ${inr(f, "totalInr")}`,
  ml: (f) => `${n(f, "qty")} × ${item(f)} (${unit(f)}), ഒരു ${unit(f)}-ന് ${inr(f, "unitPriceInr")}, ആകെ ${inr(f, "totalInr")}`,
  kn: (f) => `${n(f, "qty")} × ${item(f)} (${unit(f)}), ಒಂದು ${unit(f)}ಗೆ ${inr(f, "unitPriceInr")}, ಒಟ್ಟು ${inr(f, "totalInr")}`,
};
export const orderLine = (f: MessageFacts): string => line[f.language](f);

/** The status list's rows. */
const rowText: Record<Language, (r: StatusRow) => string> = {
  en: (r) => `${r.ref}: ${r.qty} × ${r.itemName} (${r.unitName}) from ${r.supplierName}, ${money(r.totalInr)}, ${r.stateWord}`,
  hi: (r) => `${r.ref}: ${r.qty} × ${r.itemName} (${r.unitName}), ${r.supplierName} से, ${money(r.totalInr)}, ${r.stateWord}`,
  ml: (r) => `${r.ref}: ${r.qty} × ${r.itemName} (${r.unitName}), ${r.supplierName}-ൽ നിന്ന്, ${money(r.totalInr)}, ${r.stateWord}`,
  kn: (r) => `${r.ref}: ${r.qty} × ${r.itemName} (${r.unitName}), ${r.supplierName} ಅವರಿಂದ, ${money(r.totalInr)}, ${r.stateWord}`,
};
const rows = (f: MessageFacts): string => (f.lines ?? []).map((r) => rowText[f.language](r)).join("\n");

/** What an order is waiting on, in words: the one list the status and the checks use. */
export type StateKey = "awaiting" | "sending" | "sent" | "unknown" | "accepted" | "part" | "failed" | "blocked";
export const STATE_WORDS: Record<Language, Record<StateKey, string>> = {
  en: { awaiting: "waiting for your approval", sending: "being sent", sent: "sent, no answer yet", unknown: "may not have reached the supplier", accepted: "supplier confirmed, not received yet", part: "part received", failed: "not sent (WhatsApp refused it)", blocked: "not sent (held back)" },
  hi: { awaiting: "आपकी मंज़ूरी का इंतज़ार", sending: "भेजा जा रहा है", sent: "भेजा गया, जवाब नहीं आया", unknown: "शायद सप्लायर तक नहीं पहुँचा", accepted: "सप्लायर ने मान लिया, माल अभी नहीं आया", part: "थोड़ा माल आया", failed: "भेजा नहीं गया (WhatsApp ने मना किया)", blocked: "भेजा नहीं गया (रोका गया)" },
  ml: { awaiting: "നിങ്ങളുടെ അനുമതിക്ക് കാത്തിരിക്കുന്നു", sending: "അയയ്ക്കുന്നു", sent: "അയച്ചു, മറുപടി വന്നിട്ടില്ല", unknown: "വിതരണക്കാരനിൽ എത്തിയോ എന്ന് ഉറപ്പില്ല", accepted: "വിതരണക്കാരൻ സമ്മതിച്ചു, സാധനം എത്തിയിട്ടില്ല", part: "കുറച്ച് സാധനം എത്തി", failed: "അയച്ചില്ല (WhatsApp നിരസിച്ചു)", blocked: "അയച്ചില്ല (തടഞ്ഞു)" },
  kn: { awaiting: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿದೆ", sending: "ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ", sent: "ಕಳುಹಿಸಲಾಗಿದೆ, ಉತ್ತರ ಬಂದಿಲ್ಲ", unknown: "ಪೂರೈಕೆದಾರರಿಗೆ ತಲುಪಿತೇ ಎಂದು ಖಚಿತವಿಲ್ಲ", accepted: "ಪೂರೈಕೆದಾರರು ಒಪ್ಪಿದ್ದಾರೆ, ಸರಕು ಇನ್ನೂ ಬಂದಿಲ್ಲ", part: "ಸ್ವಲ್ಪ ಸರಕು ಬಂದಿದೆ", failed: "ಕಳುಹಿಸಲಿಲ್ಲ (WhatsApp ನಿರಾಕರಿಸಿತು)", blocked: "ಕಳುಹಿಸಲಿಲ್ಲ (ತಡೆಹಿಡಿಯಲಾಗಿದೆ)" },
};

// ---- English ----------------------------------------------------------------------------------------------------------------------
const en: Set = {
  supplier_order: (f) => `New order ${ref(f)} from ${f.businessName}: ${orderLine(f)}. Please reply OK to confirm you can supply it, or NO if you cannot.`,
  supplier_check: (f) => `Reminder about order ${ref(f)} from ${f.businessName}, sent earlier: ${orderLine(f)}. This is the same order, not a new one. Please reply OK to confirm, or NO if you cannot supply it.`,
  supplier_which: (f) => `Several orders from ${f.businessName} are waiting for your answer (${list(f.refs)}). Please answer with the button on the order message, or write OK or NO followed by the order number.`,
  supplier_unclear: (f) => `Thank you for your message. To answer order ${ref(f)} from ${f.businessName}, please reply OK or NO, or use the button on the order message.`,
  supplier_thanks_yes: (f) => `Thank you. Order ${ref(f)} is noted as confirmed by you.`,
  supplier_thanks_no: (f) => `Thank you. Order ${ref(f)} is noted as not supplied by you.`,

  card: (f) => `Order ${ref(f)} for your approval: ${orderLine(f)}, from ${sup(f)}. This month ${inr(f, "reservedInr")} of your ${inr(f, "budgetInr")} budget is reserved, so ${inr(f, "leftInr")} is left after this order. Approve with the button, or reply "yes ${code(f)}". To decline reply "no ${code(f)}".`,
  card_changed: () => "The order changed since that card, so the earlier card no longer counts and nothing was sent. Here is the card as it is now:",
  card_closed: () => "That card was already answered or replaced, so nothing was done.",
  card_expired: () => "That card ran out, so nothing was sent. Ask me again if you still want it.",
  card_unknown: () => "I have no card with that code, so nothing was done.",
  order_declined: (f) => `Order ${ref(f)} is declined. Nothing was sent to ${sup(f)}.`,
  order_approved: (f) => `Order ${ref(f)} is approved: ${orderLine(f)}, from ${sup(f)}. ${inr(f, "totalInr")} is now reserved from this month's budget and ${inr(f, "leftInr")} is left. Sending it to the supplier now.`,

  sent_ok: (f) => `Order ${ref(f)} went to ${sup(f)}. They have not answered yet. I will ask again if they stay silent.`,
  sent_unknown: (f) => `Order ${ref(f)} may or may not have reached ${sup(f)}: WhatsApp did not confirm it. I will not send the order again. I will ask ${sup(f)} about ${ref(f)} instead, and tell you what they say.`,
  send_failed: (f) => `Order ${ref(f)} did not go to ${sup(f)}: WhatsApp refused it, so nothing was sent. The budget stays reserved. Reply "send ${ref(f)}" to try again, or "cancel ${ref(f)}" to release it.`,
  send_blocked: (f) => `Order ${ref(f)} was not sent to ${sup(f)}: a check held it back, for example because they asked for no more messages. Nothing went out. Reply "cancel ${ref(f)}" to release the budget.`,
  owner_supplier_accepted: (f) => `Order ${ref(f)} confirmed by the supplier, ${sup(f)}: ${orderLine(f)}. This means they will supply it, not that it has arrived. When it comes, reply "received ${ref(f)}".`,
  owner_supplier_declined: (f) => `Order ${ref(f)} was declined by the supplier, ${sup(f)}: ${orderLine(f)}. Nothing is coming, and the money reserved is released back to this month's budget. Please choose another supplier.`,
  owner_supplier_silent: (f) => `No answer yet to order ${ref(f)} from the supplier, ${sup(f)}, after ${n(f, "hours")} hours: ${orderLine(f)}. I asked again and will not send a new order. Please call them. The order is not confirmed.`,
  owner_supplier_stopped: (f) => `Supplier ${sup(f)} asked for no more messages, so I will not message them again. Any order waiting for them stays unsent, and I will tell you which.`,

  received_full: (f) => `Marked received, all of it: order ${ref(f)}, ${orderLine(f)}. This is your mark, not the supplier's. Payment is separate: reply "paid ${ref(f)}" when you have paid.`,
  received_part: (f) => `Marked: ${n(f, "receivedQty")} of ${n(f, "qty")} received for order ${ref(f)} (${item(f)}). ${n(f, "moreQty")} still to come. Reply "received ${ref(f)} ${n(f, "moreQty")}" when the rest arrives.`,
  received_wrong: (f) => `Marked: the wrong item came for order ${ref(f)} (${item(f)}). It is not counted as received. Please sort it out with ${sup(f)}: I sent them nothing.`,
  receive_too_many: (f) => `You wrote ${n(f, "saidQty")}, but only ${n(f, "moreQty")} of order ${ref(f)} are still to come. Nothing was marked. Please tell me what actually arrived.`,
  order_not_open: (f) => `Order ${ref(f)} cannot be changed that way now: it is ${need(f, "stateWord")}.`,
  paid_outside_noted: (f) => `Noted: you paid for order ${ref(f)} yourself, outside this chat. I paid nothing and cannot check it: it is only your mark.`,
  cannot_change: (f) => `Order ${ref(f)} is already approved, so it cannot be changed. If it is wrong, ask ${sup(f)} directly, then send me a new request.`,
  cancelled: (f) => `Order ${ref(f)} is cancelled. Nothing was sent, and any budget it held is released.`,
  cannot_cancel: (f) => `Order ${ref(f)} is already with ${sup(f)}, so I cannot cancel it from here. Please tell them yourself.`,
  no_such_order: (f) => `I have no order ${ref(f)}.`,

  ask_line: (f) => `There is more than one way to order ${item(f)}. Which one do you mean?`,
  ask_qty: (f) => `How many ${unit(f)} of ${item(f)} from ${sup(f)} should I order? Reply with a number.`,
  item_unknown: (f) => `I do not have that in your catalogue, so nothing was ordered. I can order: ${list(f.options)}.`,
  blocked_supplier: (f) => `Nothing was ordered: ${sup(f)} is not on your approved supplier list, or is paused. Nothing was sent to anyone.`,
  blocked_cap: (f) => `Nothing was ordered: ${orderLine(f)} is more than the ${inr(f, "capInr")} one order may be worth. Order less, or ask your Operator to change the limit.`,
  blocked_budget: (f) => `Nothing was ordered: ${inr(f, "totalInr")} is more than the ${inr(f, "leftInr")} left of this month's ${inr(f, "budgetInr")} budget (${month(f)}).`,
  blocked_qty: (f) => `Nothing was ordered: ${n(f, "saidQty")} is more than ${n(f, "maxQty")} in one order, which looks like a typing slip. Please write the number again.`,
  already_open: (f) => `Order ${ref(f)} for ${item(f)} from ${sup(f)} is already open, so I did not make another. Reply "status" to see it.`,
  status: (f) => `Open stock orders:\n${rows(f)}\nThis month (${month(f)}): ${inr(f, "reservedInr")} of your ${inr(f, "budgetInr")} budget is reserved.`,
  status_empty: (f) => `No open stock orders. This month (${month(f)}): ${inr(f, "reservedInr")} of your ${inr(f, "budgetInr")} budget is reserved.`,
  didnt_understand: (f) => `I could not tell what you want. You can write, for example, "${need(f, "example")}", "received ${ref(f)}", "paid ${ref(f)}" or "status".`,
  owner_message_held: (f) => `I held back a message about order ${ref(f)} because it did not match my record. Nothing wrong was sent. Please check the order.`,
};

// ---- Hindi (machine-written; waits for a native speaker) ---------------------------------------------------------------------------
const hi: Set = {
  supplier_order: (f) => `नया ऑर्डर ${ref(f)} (${f.businessName} की ओर से): ${orderLine(f)}। कृपया "OK" लिखें अगर आप यह दे सकते हैं, या "NO" अगर नहीं दे सकते।`,
  supplier_check: (f) => `पहले भेजे ऑर्डर ${ref(f)} की याद दिलाना (${f.businessName} की ओर से): ${orderLine(f)}। यह वही ऑर्डर है, नया नहीं। कृपया "OK" लिखें अगर आप दे सकते हैं, या "NO" अगर नहीं दे सकते।`,
  supplier_which: (f) => `${f.businessName} के कई ऑर्डर आपके जवाब का इंतज़ार कर रहे हैं (${list(f.refs)})। कृपया ऑर्डर संदेश के बटन से जवाब दें, या "OK" या "NO" के बाद ऑर्डर नंबर लिखें।`,
  supplier_unclear: (f) => `आपके संदेश के लिए धन्यवाद। ${f.businessName} के ऑर्डर ${ref(f)} का जवाब देने के लिए कृपया "OK" या "NO" लिखें, या ऑर्डर संदेश का बटन दबाएँ।`,
  supplier_thanks_yes: (f) => `धन्यवाद। ऑर्डर ${ref(f)} आपकी ओर से पक्का दर्ज हुआ।`,
  supplier_thanks_no: (f) => `धन्यवाद। ऑर्डर ${ref(f)} आपकी ओर से "नहीं दे सकते" दर्ज हुआ।`,

  card: (f) => `मंज़ूरी के लिए ऑर्डर ${ref(f)}: ${orderLine(f)}, ${sup(f)} से। इस महीने आपके ${inr(f, "budgetInr")} बजट में से ${inr(f, "reservedInr")} रखा जा चुका है, इस ऑर्डर के बाद ${inr(f, "leftInr")} बचेगा। बटन से मंज़ूर करें, या "yes ${code(f)}" लिखें। मना करने के लिए "no ${code(f)}" लिखें।`,
  card_changed: () => "उस कार्ड के बाद ऑर्डर बदल गया, इसलिए पुराना कार्ड मान्य नहीं है और कुछ नहीं भेजा गया। अभी का कार्ड यह है:",
  card_closed: () => "उस कार्ड का जवाब पहले ही दिया जा चुका है या उसकी जगह नया कार्ड आ गया है, इसलिए कुछ नहीं किया गया।",
  card_expired: () => "उस कार्ड का समय ख़त्म हो गया, इसलिए कुछ नहीं भेजा गया। अगर अब भी चाहिए तो फिर कहें।",
  card_unknown: () => "उस कोड का कोई कार्ड मेरे पास नहीं है, इसलिए कुछ नहीं किया गया।",
  order_declined: (f) => `ऑर्डर ${ref(f)} मना कर दिया गया। ${sup(f)} को कुछ नहीं भेजा गया।`,
  order_approved: (f) => `ऑर्डर ${ref(f)} मंज़ूर: ${orderLine(f)}, ${sup(f)} से। इस महीने के बजट से ${inr(f, "totalInr")} रख लिया गया है और ${inr(f, "leftInr")} बचा है। अब सप्लायर को भेज रहा हूँ।`,

  sent_ok: (f) => `ऑर्डर ${ref(f)} ${sup(f)} को भेज दिया गया। उन्होंने अभी जवाब नहीं दिया है। चुप रहने पर मैं फिर पूछूँगा।`,
  sent_unknown: (f) => `ऑर्डर ${ref(f)} ${sup(f)} तक पहुँचा या नहीं, WhatsApp ने पक्का नहीं बताया। मैं ऑर्डर दोबारा नहीं भेजूँगा। इसके बदले ${sup(f)} से ${ref(f)} के बारे में पूछूँगा और आपको बताऊँगा।`,
  send_failed: (f) => `ऑर्डर ${ref(f)} ${sup(f)} को नहीं गया: WhatsApp ने मना कर दिया, इसलिए कुछ नहीं भेजा गया। बजट रखा हुआ है। फिर कोशिश के लिए "send ${ref(f)}" लिखें, या छोड़ने के लिए "cancel ${ref(f)}"।`,
  send_blocked: (f) => `ऑर्डर ${ref(f)} ${sup(f)} को नहीं भेजा गया: एक जाँच ने रोक दिया, जैसे उन्होंने और संदेश न भेजने को कहा हो। कुछ नहीं गया। बजट छोड़ने के लिए "cancel ${ref(f)}" लिखें।`,
  owner_supplier_accepted: (f) => `सप्लायर ${sup(f)} ने ऑर्डर ${ref(f)} पक्का किया: ${orderLine(f)}। इसका मतलब है कि वे देंगे, यह नहीं कि माल आ गया। माल आने पर "received ${ref(f)}" लिखें।`,
  owner_supplier_declined: (f) => `सप्लायर ${sup(f)} ने ऑर्डर ${ref(f)} मना कर दिया: ${orderLine(f)}। माल नहीं आएगा, और रखा हुआ पैसा इस महीने के बजट में वापस आ गया है। कृपया दूसरा सप्लायर चुनें।`,
  owner_supplier_silent: (f) => `सप्लायर ${sup(f)} से ऑर्डर ${ref(f)} का ${n(f, "hours")} घंटे बाद भी जवाब नहीं आया: ${orderLine(f)}। मैंने फिर पूछा और नया ऑर्डर नहीं भेजूँगा। कृपया उन्हें फ़ोन करें। ऑर्डर पक्का नहीं है।`,
  owner_supplier_stopped: (f) => `सप्लायर ${sup(f)} ने और संदेश न भेजने को कहा है, इसलिए मैं उन्हें दोबारा संदेश नहीं भेजूँगा। उनके लिए रुका हुआ ऑर्डर नहीं भेजा जाएगा, मैं बताऊँगा कौन सा।`,

  received_full: (f) => `पूरा माल आया दर्ज: ऑर्डर ${ref(f)}, ${orderLine(f)}। यह आपका दर्ज किया हुआ है, सप्लायर का नहीं। भुगतान अलग बात है: भुगतान करने पर "paid ${ref(f)}" लिखें।`,
  received_part: (f) => `दर्ज: ऑर्डर ${ref(f)} (${item(f)}) के ${n(f, "qty")} में से ${n(f, "receivedQty")} आए। ${n(f, "moreQty")} आना बाकी है। बाकी आने पर "received ${ref(f)} ${n(f, "moreQty")}" लिखें।`,
  received_wrong: (f) => `दर्ज: ऑर्डर ${ref(f)} (${item(f)}) में ग़लत माल आया। इसे आया हुआ नहीं गिना गया। कृपया ${sup(f)} से बात करें: मैंने उन्हें कुछ नहीं भेजा।`,
  receive_too_many: (f) => `आपने ${n(f, "saidQty")} लिखा, पर ऑर्डर ${ref(f)} का सिर्फ़ ${n(f, "moreQty")} आना बाकी है। कुछ दर्ज नहीं हुआ। कृपया बताएँ कि असल में क्या आया।`,
  order_not_open: (f) => `ऑर्डर ${ref(f)} में अभी यह बदलाव नहीं हो सकता: वह ${need(f, "stateWord")}।`,
  paid_outside_noted: (f) => `दर्ज: आपने ऑर्डर ${ref(f)} का भुगतान इस चैट के बाहर ख़ुद किया। मैंने कुछ नहीं चुकाया और जाँच नहीं सकता: यह सिर्फ़ आपका दर्ज किया हुआ है।`,
  cannot_change: (f) => `ऑर्डर ${ref(f)} मंज़ूर हो चुका है, इसलिए बदला नहीं जा सकता। अगर ग़लत है तो ${sup(f)} से सीधे बात करें, फिर मुझे नया अनुरोध भेजें।`,
  cancelled: (f) => `ऑर्डर ${ref(f)} रद्द हुआ। कुछ नहीं भेजा गया, और इसने जो बजट रखा था वह छूट गया।`,
  cannot_cancel: (f) => `ऑर्डर ${ref(f)} पहले ही ${sup(f)} के पास है, इसलिए मैं यहाँ से रद्द नहीं कर सकता। कृपया उन्हें ख़ुद बताएँ।`,
  no_such_order: (f) => `मेरे पास ऑर्डर ${ref(f)} नहीं है।`,

  ask_line: (f) => `${item(f)} मँगाने के एक से ज़्यादा तरीके हैं। आपका मतलब कौन सा है?`,
  ask_qty: (f) => `${sup(f)} से ${item(f)} के कितने ${unit(f)} मँगाऊँ? एक संख्या लिखें।`,
  item_unknown: (f) => `यह आपकी सूची में नहीं है, इसलिए कुछ नहीं मँगाया गया। मैं ये मँगा सकता हूँ: ${list(f.options)}।`,
  blocked_supplier: (f) => `कुछ नहीं मँगाया गया: ${sup(f)} आपकी मंज़ूर सप्लायर सूची में नहीं है, या रोका हुआ है। किसी को कुछ नहीं भेजा गया।`,
  blocked_cap: (f) => `कुछ नहीं मँगाया गया: ${orderLine(f)} एक ऑर्डर की ${inr(f, "capInr")} की हद से ज़्यादा है। कम मँगाएँ, या अपने ऑपरेटर से हद बदलने को कहें।`,
  blocked_budget: (f) => `कुछ नहीं मँगाया गया: ${inr(f, "totalInr")} इस महीने (${month(f)}) के ${inr(f, "budgetInr")} बजट के बचे ${inr(f, "leftInr")} से ज़्यादा है।`,
  blocked_qty: (f) => `कुछ नहीं मँगाया गया: ${n(f, "saidQty")} एक ऑर्डर के ${n(f, "maxQty")} से ज़्यादा है, यह टाइपिंग की ग़लती लगती है। कृपया संख्या फिर लिखें।`,
  already_open: (f) => `${sup(f)} से ${item(f)} का ऑर्डर ${ref(f)} पहले से खुला है, इसलिए दूसरा नहीं बनाया। देखने के लिए "status" लिखें।`,
  status: (f) => `खुले स्टॉक ऑर्डर:\n${rows(f)}\nइस महीने (${month(f)}) आपके ${inr(f, "budgetInr")} बजट में से ${inr(f, "reservedInr")} रखा जा चुका है।`,
  status_empty: (f) => `कोई स्टॉक ऑर्डर खुला नहीं है। इस महीने (${month(f)}) आपके ${inr(f, "budgetInr")} बजट में से ${inr(f, "reservedInr")} रखा जा चुका है।`,
  didnt_understand: (f) => `मैं समझ नहीं पाया कि आप क्या चाहते हैं। आप ऐसे लिख सकते हैं: "${need(f, "example")}", "received ${ref(f)}", "paid ${ref(f)}" या "status"।`,
  owner_message_held: (f) => `ऑर्डर ${ref(f)} के बारे में एक संदेश मैंने रोक लिया क्योंकि वह मेरे रिकॉर्ड से मेल नहीं खाता था। कुछ ग़लत नहीं भेजा गया। कृपया ऑर्डर देख लें।`,
};

// ---- Malayalam (machine-written; waits for a native speaker) -----------------------------------------------------------------------
const ml: Set = {
  supplier_order: (f) => `പുതിയ ഓർഡർ ${ref(f)} (${f.businessName}-ൽ നിന്ന്): ${orderLine(f)}. ഇത് നൽകാൻ കഴിയുമെങ്കിൽ "OK" എന്നും കഴിയില്ലെങ്കിൽ "NO" എന്നും മറുപടി തരൂ.`,
  supplier_check: (f) => `നേരത്തെ അയച്ച ഓർഡർ ${ref(f)}-നെക്കുറിച്ചുള്ള ഓർമ്മപ്പെടുത്തൽ (${f.businessName}-ൽ നിന്ന്): ${orderLine(f)}. ഇത് അതേ ഓർഡറാണ്, പുതിയതല്ല. നൽകാൻ കഴിയുമെങ്കിൽ "OK" എന്നും കഴിയില്ലെങ്കിൽ "NO" എന്നും മറുപടി തരൂ.`,
  supplier_which: (f) => `${f.businessName}-ന്റെ ഒന്നിലധികം ഓർഡറുകൾ നിങ്ങളുടെ മറുപടിക്ക് കാത്തിരിക്കുന്നു (${list(f.refs)}). ഓർഡർ സന്ദേശത്തിലെ ബട്ടൺ ഉപയോഗിക്കൂ, അല്ലെങ്കിൽ "OK" അല്ലെങ്കിൽ "NO" എന്നെഴുതി ഓർഡർ നമ്പർ ചേർക്കൂ.`,
  supplier_unclear: (f) => `നിങ്ങളുടെ സന്ദേശത്തിന് നന്ദി. ${f.businessName}-ന്റെ ഓർഡർ ${ref(f)}-ന് മറുപടി നൽകാൻ "OK" അല്ലെങ്കിൽ "NO" എന്ന് എഴുതൂ, അല്ലെങ്കിൽ ഓർഡർ സന്ദേശത്തിലെ ബട്ടൺ ഉപയോഗിക്കൂ.`,
  supplier_thanks_yes: (f) => `നന്ദി. ഓർഡർ ${ref(f)} നിങ്ങൾ സ്ഥിരീകരിച്ചതായി രേഖപ്പെടുത്തി.`,
  supplier_thanks_no: (f) => `നന്ദി. ഓർഡർ ${ref(f)} നിങ്ങൾക്ക് നൽകാൻ കഴിയില്ലെന്ന് രേഖപ്പെടുത്തി.`,

  card: (f) => `അനുമതിക്കായി ഓർഡർ ${ref(f)}: ${orderLine(f)}, ${sup(f)}-ൽ നിന്ന്. ഈ മാസം നിങ്ങളുടെ ${inr(f, "budgetInr")} ബജറ്റിൽ ${inr(f, "reservedInr")} മാറ്റിവച്ചിട്ടുണ്ട്, ഈ ഓർഡറിന് ശേഷം ${inr(f, "leftInr")} ബാക്കി. ബട്ടൺ അമർത്തി അനുവദിക്കൂ, അല്ലെങ്കിൽ "yes ${code(f)}" എന്ന് മറുപടി നൽകൂ. വേണ്ടെങ്കിൽ "no ${code(f)}" എന്ന് നൽകൂ.`,
  card_changed: () => "ആ കാർഡിന് ശേഷം ഓർഡർ മാറി, അതിനാൽ പഴയ കാർഡ് സാധുവല്ല, ഒന്നും അയച്ചില്ല. ഇപ്പോഴത്തെ കാർഡ് ഇതാ:",
  card_closed: () => "ആ കാർഡിന് ഇതിനകം മറുപടി നൽകി, അല്ലെങ്കിൽ പുതിയ കാർഡ് വന്നു, അതിനാൽ ഒന്നും ചെയ്തില്ല.",
  card_expired: () => "ആ കാർഡിന്റെ സമയം കഴിഞ്ഞു, അതിനാൽ ഒന്നും അയച്ചില്ല. ഇപ്പോഴും വേണമെങ്കിൽ വീണ്ടും പറയൂ.",
  card_unknown: () => "ആ കോഡുള്ള കാർഡ് എന്റെ പക്കലില്ല, അതിനാൽ ഒന്നും ചെയ്തില്ല.",
  order_declined: (f) => `ഓർഡർ ${ref(f)} വേണ്ടെന്ന് വച്ചു. ${sup(f)}-ന് ഒന്നും അയച്ചില്ല.`,
  order_approved: (f) => `ഓർഡർ ${ref(f)} അനുവദിച്ചു: ${orderLine(f)}, ${sup(f)}-ൽ നിന്ന്. ഈ മാസത്തെ ബജറ്റിൽ നിന്ന് ${inr(f, "totalInr")} മാറ്റിവച്ചു, ${inr(f, "leftInr")} ബാക്കി. ഇപ്പോൾ വിതരണക്കാരന് അയയ്ക്കുന്നു.`,

  sent_ok: (f) => `ഓർഡർ ${ref(f)} ${sup(f)}-ന് അയച്ചു. അവർ ഇതുവരെ മറുപടി തന്നിട്ടില്ല. മിണ്ടാതിരുന്നാൽ ഞാൻ വീണ്ടും ചോദിക്കും.`,
  sent_unknown: (f) => `ഓർഡർ ${ref(f)} ${sup(f)}-ൽ എത്തിയോ എന്ന് WhatsApp ഉറപ്പിച്ചില്ല. ഞാൻ ഓർഡർ വീണ്ടും അയയ്ക്കില്ല. പകരം ${sup(f)}-നോട് ${ref(f)}-നെക്കുറിച്ച് ചോദിച്ച് അവർ പറയുന്നത് നിങ്ങളെ അറിയിക്കും.`,
  send_failed: (f) => `ഓർഡർ ${ref(f)} ${sup(f)}-ന് പോയില്ല: WhatsApp നിരസിച്ചു, അതിനാൽ ഒന്നും അയച്ചില്ല. ബജറ്റ് മാറ്റിവച്ചതായി തുടരുന്നു. വീണ്ടും ശ്രമിക്കാൻ "send ${ref(f)}" എന്നും ഒഴിവാക്കാൻ "cancel ${ref(f)}" എന്നും നൽകൂ.`,
  send_blocked: (f) => `ഓർഡർ ${ref(f)} ${sup(f)}-ന് അയച്ചില്ല: ഒരു പരിശോധന തടഞ്ഞു, ഉദാഹരണത്തിന് അവർ ഇനി സന്ദേശം വേണ്ടെന്ന് പറഞ്ഞതിനാൽ. ഒന്നും പോയില്ല. ബജറ്റ് വിടുവിക്കാൻ "cancel ${ref(f)}" എന്ന് നൽകൂ.`,
  owner_supplier_accepted: (f) => `വിതരണക്കാരൻ ${sup(f)} ഓർഡർ ${ref(f)} സ്ഥിരീകരിച്ചു: ${orderLine(f)}. അവർ നൽകും എന്നാണ് ഇതിനർത്ഥം, സാധനം എത്തി എന്നല്ല. സാധനം വരുമ്പോൾ "received ${ref(f)}" എന്ന് നൽകൂ.`,
  owner_supplier_declined: (f) => `വിതരണക്കാരൻ ${sup(f)} ഓർഡർ ${ref(f)} നിരസിച്ചു: ${orderLine(f)}. സാധനം വരില്ല, മാറ്റിവച്ച തുക ഈ മാസത്തെ ബജറ്റിലേക്ക് തിരികെ വന്നു. മറ്റൊരു വിതരണക്കാരനെ തിരഞ്ഞെടുക്കൂ.`,
  owner_supplier_silent: (f) => `വിതരണക്കാരൻ ${sup(f)}-ൽ നിന്ന് ഓർഡർ ${ref(f)}-ന് ${n(f, "hours")} മണിക്കൂറിന് ശേഷവും മറുപടിയില്ല: ${orderLine(f)}. ഞാൻ വീണ്ടും ചോദിച്ചു, പുതിയ ഓർഡർ അയയ്ക്കില്ല. അവരെ വിളിക്കൂ. ഓർഡർ സ്ഥിരീകരിച്ചിട്ടില്ല.`,
  owner_supplier_stopped: (f) => `വിതരണക്കാരൻ ${sup(f)} ഇനി സന്ദേശം വേണ്ടെന്ന് പറഞ്ഞു, അതിനാൽ ഞാൻ അവർക്ക് വീണ്ടും സന്ദേശം അയയ്ക്കില്ല. അവർക്കുള്ള ഓർഡർ അയയ്ക്കാതെ കിടക്കും, ഏതെന്ന് ഞാൻ പറയാം.`,

  received_full: (f) => `മുഴുവൻ സാധനവും കിട്ടി എന്ന് രേഖപ്പെടുത്തി: ഓർഡർ ${ref(f)}, ${orderLine(f)}. ഇത് നിങ്ങളുടെ രേഖപ്പെടുത്തലാണ്, വിതരണക്കാരന്റേതല്ല. പണമടയ്ക്കൽ വേറെയാണ്: അടച്ചാൽ "paid ${ref(f)}" എന്ന് നൽകൂ.`,
  received_part: (f) => `രേഖപ്പെടുത്തി: ഓർഡർ ${ref(f)} (${item(f)}) ലെ ${n(f, "qty")}-ൽ ${n(f, "receivedQty")} കിട്ടി. ${n(f, "moreQty")} വരാനുണ്ട്. ബാക്കി വരുമ്പോൾ "received ${ref(f)} ${n(f, "moreQty")}" എന്ന് നൽകൂ.`,
  received_wrong: (f) => `രേഖപ്പെടുത്തി: ഓർഡർ ${ref(f)} (${item(f)}) ന് തെറ്റായ സാധനം വന്നു. ഇത് കിട്ടിയതായി കണക്കാക്കിയില്ല. ${sup(f)}-നോട് സംസാരിക്കൂ: ഞാൻ അവർക്ക് ഒന്നും അയച്ചിട്ടില്ല.`,
  receive_too_many: (f) => `നിങ്ങൾ ${n(f, "saidQty")} എന്ന് എഴുതി, പക്ഷേ ഓർഡർ ${ref(f)}-ൽ ${n(f, "moreQty")} മാത്രമേ വരാനുള്ളൂ. ഒന്നും രേഖപ്പെടുത്തിയില്ല. യഥാർത്ഥത്തിൽ എന്താണ് വന്നതെന്ന് പറയൂ.`,
  order_not_open: (f) => `ഓർഡർ ${ref(f)} ഇപ്പോൾ ഇങ്ങനെ മാറ്റാനാവില്ല: അത് ${need(f, "stateWord")}.`,
  paid_outside_noted: (f) => `രേഖപ്പെടുത്തി: ഓർഡർ ${ref(f)}-ന്റെ പണം നിങ്ങൾ ഈ ചാറ്റിന് പുറത്ത് സ്വയം അടച്ചു. ഞാൻ ഒന്നും അടച്ചിട്ടില്ല, പരിശോധിക്കാനും കഴിയില്ല: ഇത് നിങ്ങളുടെ രേഖപ്പെടുത്തൽ മാത്രം.`,
  cannot_change: (f) => `ഓർഡർ ${ref(f)} ഇതിനകം അനുവദിച്ചു, അതിനാൽ മാറ്റാനാവില്ല. തെറ്റാണെങ്കിൽ ${sup(f)}-നോട് നേരിട്ട് പറയൂ, എന്നിട്ട് എനിക്ക് പുതിയ അഭ്യർത്ഥന അയയ്ക്കൂ.`,
  cancelled: (f) => `ഓർഡർ ${ref(f)} റദ്ദാക്കി. ഒന്നും അയച്ചില്ല, അത് മാറ്റിവച്ച ബജറ്റ് തിരികെ കിട്ടി.`,
  cannot_cancel: (f) => `ഓർഡർ ${ref(f)} ഇതിനകം ${sup(f)}-ന്റെ പക്കലാണ്, അതിനാൽ ഇവിടെ നിന്ന് റദ്ദാക്കാനാവില്ല. അവരോട് നേരിട്ട് പറയൂ.`,
  no_such_order: (f) => `എന്റെ പക്കൽ ഓർഡർ ${ref(f)} ഇല്ല.`,

  ask_line: (f) => `${item(f)} ഓർഡർ ചെയ്യാൻ ഒന്നിലധികം വഴികളുണ്ട്. ഏതാണ് ഉദ്ദേശിച്ചത്?`,
  ask_qty: (f) => `${sup(f)}-ൽ നിന്ന് ${item(f)} എത്ര ${unit(f)} ഓർഡർ ചെയ്യണം? ഒരു സംഖ്യ നൽകൂ.`,
  item_unknown: (f) => `അത് നിങ്ങളുടെ പട്ടികയിലില്ല, അതിനാൽ ഒന്നും ഓർഡർ ചെയ്തില്ല. ഞാൻ ഓർഡർ ചെയ്യാവുന്നത്: ${list(f.options)}.`,
  blocked_supplier: (f) => `ഒന്നും ഓർഡർ ചെയ്തില്ല: ${sup(f)} നിങ്ങളുടെ അംഗീകൃത വിതരണക്കാരുടെ പട്ടികയിലില്ല, അല്ലെങ്കിൽ നിർത്തിവച്ചിരിക്കുന്നു. ആർക്കും ഒന്നും അയച്ചില്ല.`,
  blocked_cap: (f) => `ഒന്നും ഓർഡർ ചെയ്തില്ല: ${orderLine(f)} ഒരു ഓർഡറിന്റെ ${inr(f, "capInr")} പരിധിയേക്കാൾ കൂടുതലാണ്. കുറച്ച് ഓർഡർ ചെയ്യൂ, അല്ലെങ്കിൽ പരിധി മാറ്റാൻ നിങ്ങളുടെ ഓപ്പറേറ്ററോട് പറയൂ.`,
  blocked_budget: (f) => `ഒന്നും ഓർഡർ ചെയ്തില്ല: ${inr(f, "totalInr")} ഈ മാസത്തെ (${month(f)}) ${inr(f, "budgetInr")} ബജറ്റിൽ ബാക്കിയുള്ള ${inr(f, "leftInr")}-നേക്കാൾ കൂടുതലാണ്.`,
  blocked_qty: (f) => `ഒന്നും ഓർഡർ ചെയ്തില്ല: ${n(f, "saidQty")} ഒരു ഓർഡറിലെ ${n(f, "maxQty")}-നേക്കാൾ കൂടുതലാണ്, ടൈപ്പ് ചെയ്തതിലെ പിഴവാകാം. സംഖ്യ വീണ്ടും എഴുതൂ.`,
  already_open: (f) => `${sup(f)}-ൽ നിന്ന് ${item(f)}-നുള്ള ഓർഡർ ${ref(f)} ഇതിനകം തുറന്നിരിക്കുന്നു, അതിനാൽ മറ്റൊന്ന് ഉണ്ടാക്കിയില്ല. കാണാൻ "status" എന്ന് നൽകൂ.`,
  status: (f) => `തുറന്ന സ്റ്റോക്ക് ഓർഡറുകൾ:\n${rows(f)}\nഈ മാസം (${month(f)}) നിങ്ങളുടെ ${inr(f, "budgetInr")} ബജറ്റിൽ ${inr(f, "reservedInr")} മാറ്റിവച്ചിട്ടുണ്ട്.`,
  status_empty: (f) => `തുറന്ന സ്റ്റോക്ക് ഓർഡറുകളൊന്നുമില്ല. ഈ മാസം (${month(f)}) നിങ്ങളുടെ ${inr(f, "budgetInr")} ബജറ്റിൽ ${inr(f, "reservedInr")} മാറ്റിവച്ചിട്ടുണ്ട്.`,
  didnt_understand: (f) => `നിങ്ങൾക്ക് എന്താണ് വേണ്ടതെന്ന് എനിക്ക് മനസ്സിലായില്ല. ഉദാഹരണത്തിന് ഇങ്ങനെ എഴുതാം: "${need(f, "example")}", "received ${ref(f)}", "paid ${ref(f)}" അല്ലെങ്കിൽ "status".`,
  owner_message_held: (f) => `ഓർഡർ ${ref(f)}-നെക്കുറിച്ചുള്ള ഒരു സന്ദേശം എന്റെ രേഖയുമായി ചേരാത്തതിനാൽ ഞാൻ തടഞ്ഞുവച്ചു. തെറ്റായ ഒന്നും അയച്ചില്ല. ഓർഡർ പരിശോധിക്കൂ.`,
};

// ---- Kannada (machine-written; waits for a native speaker) -------------------------------------------------------------------------
const kn: Set = {
  supplier_order: (f) => `ಹೊಸ ಆರ್ಡರ್ ${ref(f)} (${f.businessName} ಅವರಿಂದ): ${orderLine(f)}. ಇದನ್ನು ಪೂರೈಸಲು ಸಾಧ್ಯವಾದರೆ "OK" ಎಂದು, ಸಾಧ್ಯವಿಲ್ಲದಿದ್ದರೆ "NO" ಎಂದು ಉತ್ತರಿಸಿ.`,
  supplier_check: (f) => `ಈ ಮೊದಲು ಕಳುಹಿಸಿದ ಆರ್ಡರ್ ${ref(f)} ಬಗ್ಗೆ ನೆನಪೋಲೆ (${f.businessName} ಅವರಿಂದ): ${orderLine(f)}. ಇದು ಅದೇ ಆರ್ಡರ್, ಹೊಸದಲ್ಲ. ಪೂರೈಸಲು ಸಾಧ್ಯವಾದರೆ "OK" ಎಂದು, ಸಾಧ್ಯವಿಲ್ಲದಿದ್ದರೆ "NO" ಎಂದು ಉತ್ತರಿಸಿ.`,
  supplier_which: (f) => `${f.businessName} ಅವರ ಹಲವು ಆರ್ಡರ್‌ಗಳು ನಿಮ್ಮ ಉತ್ತರಕ್ಕಾಗಿ ಕಾಯುತ್ತಿವೆ (${list(f.refs)}). ಆರ್ಡರ್ ಸಂದೇಶದ ಬಟನ್ ಬಳಸಿ, ಅಥವಾ "OK" ಅಥವಾ "NO" ಎಂದು ಬರೆದು ಆರ್ಡರ್ ಸಂಖ್ಯೆ ಸೇರಿಸಿ.`,
  supplier_unclear: (f) => `ನಿಮ್ಮ ಸಂದೇಶಕ್ಕೆ ಧನ್ಯವಾದ. ${f.businessName} ಅವರ ಆರ್ಡರ್ ${ref(f)} ಗೆ ಉತ್ತರಿಸಲು "OK" ಅಥವಾ "NO" ಎಂದು ಬರೆಯಿರಿ, ಅಥವಾ ಆರ್ಡರ್ ಸಂದೇಶದ ಬಟನ್ ಬಳಸಿ.`,
  supplier_thanks_yes: (f) => `ಧನ್ಯವಾದ. ಆರ್ಡರ್ ${ref(f)} ಅನ್ನು ನೀವು ಖಚಿತಪಡಿಸಿದ್ದೀರಿ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ.`,
  supplier_thanks_no: (f) => `ಧನ್ಯವಾದ. ಆರ್ಡರ್ ${ref(f)} ಅನ್ನು ನೀವು ಪೂರೈಸಲಾಗದು ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ.`,

  card: (f) => `ಒಪ್ಪಿಗೆಗಾಗಿ ಆರ್ಡರ್ ${ref(f)}: ${orderLine(f)}, ${sup(f)} ಅವರಿಂದ. ಈ ತಿಂಗಳು ನಿಮ್ಮ ${inr(f, "budgetInr")} ಬಜೆಟ್‌ನಲ್ಲಿ ${inr(f, "reservedInr")} ಮೀಸಲಿಡಲಾಗಿದೆ, ಈ ಆರ್ಡರ್ ನಂತರ ${inr(f, "leftInr")} ಉಳಿಯುತ್ತದೆ. ಬಟನ್ ಒತ್ತಿ ಒಪ್ಪಿ, ಅಥವಾ "yes ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇಡವಾದರೆ "no ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  card_changed: () => "ಆ ಕಾರ್ಡ್ ನಂತರ ಆರ್ಡರ್ ಬದಲಾಗಿದೆ, ಹಾಗಾಗಿ ಹಳೆಯ ಕಾರ್ಡ್ ಮಾನ್ಯವಲ್ಲ ಮತ್ತು ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. ಈಗಿನ ಕಾರ್ಡ್ ಇಲ್ಲಿದೆ:",
  card_closed: () => "ಆ ಕಾರ್ಡ್‌ಗೆ ಈಗಾಗಲೇ ಉತ್ತರಿಸಲಾಗಿದೆ ಅಥವಾ ಹೊಸ ಕಾರ್ಡ್ ಬಂದಿದೆ, ಹಾಗಾಗಿ ಏನೂ ಮಾಡಿಲ್ಲ.",
  card_expired: () => "ಆ ಕಾರ್ಡ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ, ಹಾಗಾಗಿ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. ಈಗಲೂ ಬೇಕಿದ್ದರೆ ಮತ್ತೆ ಹೇಳಿ.",
  card_unknown: () => "ಆ ಕೋಡ್‌ನ ಕಾರ್ಡ್ ನನ್ನ ಬಳಿ ಇಲ್ಲ, ಹಾಗಾಗಿ ಏನೂ ಮಾಡಿಲ್ಲ.",
  order_declined: (f) => `ಆರ್ಡರ್ ${ref(f)} ಬೇಡವೆಂದು ಹೇಳಲಾಗಿದೆ. ${sup(f)} ಅವರಿಗೆ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ.`,
  order_approved: (f) => `ಆರ್ಡರ್ ${ref(f)} ಒಪ್ಪಲಾಗಿದೆ: ${orderLine(f)}, ${sup(f)} ಅವರಿಂದ. ಈ ತಿಂಗಳ ಬಜೆಟ್‌ನಿಂದ ${inr(f, "totalInr")} ಮೀಸಲಿಡಲಾಗಿದೆ, ${inr(f, "leftInr")} ಉಳಿದಿದೆ. ಈಗ ಪೂರೈಕೆದಾರರಿಗೆ ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ.`,

  sent_ok: (f) => `ಆರ್ಡರ್ ${ref(f)} ಅನ್ನು ${sup(f)} ಅವರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ. ಅವರು ಇನ್ನೂ ಉತ್ತರಿಸಿಲ್ಲ. ಮೌನವಾಗಿದ್ದರೆ ನಾನು ಮತ್ತೆ ಕೇಳುತ್ತೇನೆ.`,
  sent_unknown: (f) => `ಆರ್ಡರ್ ${ref(f)} ${sup(f)} ಅವರಿಗೆ ತಲುಪಿತೇ ಎಂದು WhatsApp ಖಚಿತಪಡಿಸಲಿಲ್ಲ. ನಾನು ಆರ್ಡರ್ ಅನ್ನು ಮತ್ತೆ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಬದಲಿಗೆ ${sup(f)} ಅವರನ್ನು ${ref(f)} ಬಗ್ಗೆ ಕೇಳಿ, ಅವರು ಹೇಳಿದ್ದನ್ನು ನಿಮಗೆ ತಿಳಿಸುತ್ತೇನೆ.`,
  send_failed: (f) => `ಆರ್ಡರ್ ${ref(f)} ${sup(f)} ಅವರಿಗೆ ಹೋಗಲಿಲ್ಲ: WhatsApp ನಿರಾಕರಿಸಿತು, ಹಾಗಾಗಿ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ. ಬಜೆಟ್ ಮೀಸಲಾಗಿಯೇ ಇದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು "send ${ref(f)}" ಎಂದು, ಬಿಡಲು "cancel ${ref(f)}" ಎಂದು ಬರೆಯಿರಿ.`,
  send_blocked: (f) => `ಆರ್ಡರ್ ${ref(f)} ಅನ್ನು ${sup(f)} ಅವರಿಗೆ ಕಳುಹಿಸಲಿಲ್ಲ: ಒಂದು ಪರಿಶೀಲನೆ ತಡೆಯಿತು, ಉದಾಹರಣೆಗೆ ಅವರು ಇನ್ನು ಸಂದೇಶ ಬೇಡ ಎಂದಿದ್ದರೆ. ಏನೂ ಹೋಗಿಲ್ಲ. ಬಜೆಟ್ ಬಿಡುಗಡೆ ಮಾಡಲು "cancel ${ref(f)}" ಎಂದು ಬರೆಯಿರಿ.`,
  owner_supplier_accepted: (f) => `ಪೂರೈಕೆದಾರ ${sup(f)} ಆರ್ಡರ್ ${ref(f)} ಖಚಿತಪಡಿಸಿದ್ದಾರೆ: ${orderLine(f)}. ಅವರು ಪೂರೈಸುತ್ತಾರೆ ಎಂದರ್ಥ, ಸರಕು ಬಂದಿದೆ ಎಂದಲ್ಲ. ಬಂದಾಗ "received ${ref(f)}" ಎಂದು ಬರೆಯಿರಿ.`,
  owner_supplier_declined: (f) => `ಪೂರೈಕೆದಾರ ${sup(f)} ಆರ್ಡರ್ ${ref(f)} ಅನ್ನು ನಿರಾಕರಿಸಿದ್ದಾರೆ: ${orderLine(f)}. ಸರಕು ಬರುವುದಿಲ್ಲ, ಮೀಸಲಿಟ್ಟ ಹಣ ಈ ತಿಂಗಳ ಬಜೆಟ್‌ಗೆ ಮರಳಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ಪೂರೈಕೆದಾರರನ್ನು ಆರಿಸಿ.`,
  owner_supplier_silent: (f) => `ಪೂರೈಕೆದಾರ ${sup(f)} ಅವರಿಂದ ಆರ್ಡರ್ ${ref(f)} ಗೆ ${n(f, "hours")} ಗಂಟೆಗಳ ನಂತರವೂ ಉತ್ತರ ಬಂದಿಲ್ಲ: ${orderLine(f)}. ನಾನು ಮತ್ತೆ ಕೇಳಿದ್ದೇನೆ ಮತ್ತು ಹೊಸ ಆರ್ಡರ್ ಕಳುಹಿಸುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಕರೆ ಮಾಡಿ. ಆರ್ಡರ್ ಖಚಿತವಾಗಿಲ್ಲ.`,
  owner_supplier_stopped: (f) => `ಪೂರೈಕೆದಾರ ${sup(f)} ಇನ್ನು ಸಂದೇಶ ಬೇಡ ಎಂದಿದ್ದಾರೆ, ಹಾಗಾಗಿ ನಾನು ಅವರಿಗೆ ಮತ್ತೆ ಸಂದೇಶ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಅವರಿಗಾಗಿ ಕಾಯುತ್ತಿರುವ ಆರ್ಡರ್ ಕಳುಹಿಸಲ್ಪಡದೆ ಉಳಿಯುತ್ತದೆ, ಯಾವುದೆಂದು ತಿಳಿಸುತ್ತೇನೆ.`,

  received_full: (f) => `ಪೂರ್ತಿ ಸರಕು ಬಂದಿದೆ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ ${ref(f)}, ${orderLine(f)}. ಇದು ನಿಮ್ಮ ದಾಖಲೆ, ಪೂರೈಕೆದಾರರದ್ದಲ್ಲ. ಪಾವತಿ ಬೇರೆ ವಿಷಯ: ಪಾವತಿಸಿದಾಗ "paid ${ref(f)}" ಎಂದು ಬರೆಯಿರಿ.`,
  received_part: (f) => `ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ ${ref(f)} (${item(f)}) ನ ${n(f, "qty")} ರಲ್ಲಿ ${n(f, "receivedQty")} ಬಂದಿದೆ. ${n(f, "moreQty")} ಬರಬೇಕಿದೆ. ಉಳಿದದ್ದು ಬಂದಾಗ "received ${ref(f)} ${n(f, "moreQty")}" ಎಂದು ಬರೆಯಿರಿ.`,
  received_wrong: (f) => `ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ ${ref(f)} (${item(f)}) ಗೆ ತಪ್ಪು ಸರಕು ಬಂದಿದೆ. ಅದನ್ನು ಬಂದಿದೆ ಎಂದು ಎಣಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು ${sup(f)} ಅವರೊಂದಿಗೆ ಮಾತನಾಡಿ: ನಾನು ಅವರಿಗೆ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ.`,
  receive_too_many: (f) => `ನೀವು ${n(f, "saidQty")} ಎಂದು ಬರೆದಿದ್ದೀರಿ, ಆದರೆ ಆರ್ಡರ್ ${ref(f)} ನ ${n(f, "moreQty")} ಮಾತ್ರ ಬರಬೇಕಿದೆ. ಏನೂ ದಾಖಲಿಸಿಲ್ಲ. ನಿಜವಾಗಿ ಏನು ಬಂತು ಎಂದು ತಿಳಿಸಿ.`,
  order_not_open: (f) => `ಆರ್ಡರ್ ${ref(f)} ಅನ್ನು ಈಗ ಹಾಗೆ ಬದಲಿಸಲಾಗದು: ಅದು ${need(f, "stateWord")}.`,
  paid_outside_noted: (f) => `ದಾಖಲಿಸಲಾಗಿದೆ: ಆರ್ಡರ್ ${ref(f)} ಗೆ ನೀವೇ ಈ ಚಾಟ್‌ನ ಹೊರಗೆ ಪಾವತಿಸಿದ್ದೀರಿ. ನಾನು ಏನನ್ನೂ ಪಾವತಿಸಿಲ್ಲ ಮತ್ತು ಪರಿಶೀಲಿಸಲೂ ಆಗದು: ಇದು ನಿಮ್ಮ ದಾಖಲೆ ಮಾತ್ರ.`,
  cannot_change: (f) => `ಆರ್ಡರ್ ${ref(f)} ಈಗಾಗಲೇ ಒಪ್ಪಲಾಗಿದೆ, ಹಾಗಾಗಿ ಬದಲಿಸಲಾಗದು. ತಪ್ಪಿದ್ದರೆ ${sup(f)} ಅವರಿಗೆ ನೇರವಾಗಿ ಹೇಳಿ, ನಂತರ ನನಗೆ ಹೊಸ ವಿನಂತಿ ಕಳುಹಿಸಿ.`,
  cancelled: (f) => `ಆರ್ಡರ್ ${ref(f)} ರದ್ದಾಗಿದೆ. ಏನೂ ಕಳುಹಿಸಿಲ್ಲ, ಅದು ಮೀಸಲಿಟ್ಟ ಬಜೆಟ್ ಬಿಡುಗಡೆಯಾಗಿದೆ.`,
  cannot_cancel: (f) => `ಆರ್ಡರ್ ${ref(f)} ಈಗಾಗಲೇ ${sup(f)} ಅವರ ಬಳಿ ಇದೆ, ಹಾಗಾಗಿ ಇಲ್ಲಿಂದ ರದ್ದುಮಾಡಲಾಗದು. ದಯವಿಟ್ಟು ಅವರಿಗೆ ನೀವೇ ತಿಳಿಸಿ.`,
  no_such_order: (f) => `ನನ್ನ ಬಳಿ ಆರ್ಡರ್ ${ref(f)} ಇಲ್ಲ.`,

  ask_line: (f) => `${item(f)} ಅನ್ನು ಆರ್ಡರ್ ಮಾಡಲು ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ಮಾರ್ಗಗಳಿವೆ. ನಿಮ್ಮ ಅರ್ಥ ಯಾವುದು?`,
  ask_qty: (f) => `${sup(f)} ಅವರಿಂದ ${item(f)} ನ ಎಷ್ಟು ${unit(f)} ಆರ್ಡರ್ ಮಾಡಲಿ? ಒಂದು ಸಂಖ್ಯೆ ಬರೆಯಿರಿ.`,
  item_unknown: (f) => `ಅದು ನಿಮ್ಮ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ, ಹಾಗಾಗಿ ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ. ನಾನು ಆರ್ಡರ್ ಮಾಡಬಲ್ಲದ್ದು: ${list(f.options)}.`,
  blocked_supplier: (f) => `ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: ${sup(f)} ನಿಮ್ಮ ಒಪ್ಪಿದ ಪೂರೈಕೆದಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ, ಅಥವಾ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಯಾರಿಗೂ ಏನೂ ಕಳುಹಿಸಿಲ್ಲ.`,
  blocked_cap: (f) => `ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: ${orderLine(f)} ಒಂದು ಆರ್ಡರ್‌ನ ${inr(f, "capInr")} ಮಿತಿಗಿಂತ ಹೆಚ್ಚು. ಕಡಿಮೆ ಆರ್ಡರ್ ಮಾಡಿ, ಅಥವಾ ಮಿತಿ ಬದಲಿಸಲು ನಿಮ್ಮ ಆಪರೇಟರ್‌ಗೆ ಹೇಳಿ.`,
  blocked_budget: (f) => `ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: ${inr(f, "totalInr")} ಈ ತಿಂಗಳ (${month(f)}) ${inr(f, "budgetInr")} ಬಜೆಟ್‌ನಲ್ಲಿ ಉಳಿದಿರುವ ${inr(f, "leftInr")} ಗಿಂತ ಹೆಚ್ಚು.`,
  blocked_qty: (f) => `ಏನೂ ಆರ್ಡರ್ ಮಾಡಿಲ್ಲ: ${n(f, "saidQty")} ಒಂದು ಆರ್ಡರ್‌ನ ${n(f, "maxQty")} ಕ್ಕಿಂತ ಹೆಚ್ಚು, ಇದು ಟೈಪಿಂಗ್ ತಪ್ಪಿನಂತೆ ಕಾಣುತ್ತದೆ. ದಯವಿಟ್ಟು ಸಂಖ್ಯೆಯನ್ನು ಮತ್ತೆ ಬರೆಯಿರಿ.`,
  already_open: (f) => `${sup(f)} ಅವರಿಂದ ${item(f)} ಗಾಗಿ ಆರ್ಡರ್ ${ref(f)} ಈಗಾಗಲೇ ತೆರೆದಿದೆ, ಹಾಗಾಗಿ ಇನ್ನೊಂದನ್ನು ಮಾಡಿಲ್ಲ. ನೋಡಲು "status" ಎಂದು ಬರೆಯಿರಿ.`,
  status: (f) => `ತೆರೆದ ಸ್ಟಾಕ್ ಆರ್ಡರ್‌ಗಳು:\n${rows(f)}\nಈ ತಿಂಗಳು (${month(f)}) ನಿಮ್ಮ ${inr(f, "budgetInr")} ಬಜೆಟ್‌ನಲ್ಲಿ ${inr(f, "reservedInr")} ಮೀಸಲಿಡಲಾಗಿದೆ.`,
  status_empty: (f) => `ತೆರೆದ ಸ್ಟಾಕ್ ಆರ್ಡರ್‌ಗಳಿಲ್ಲ. ಈ ತಿಂಗಳು (${month(f)}) ನಿಮ್ಮ ${inr(f, "budgetInr")} ಬಜೆಟ್‌ನಲ್ಲಿ ${inr(f, "reservedInr")} ಮೀಸಲಿಡಲಾಗಿದೆ.`,
  didnt_understand: (f) => `ನಿಮಗೆ ಏನು ಬೇಕೆಂದು ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಉದಾಹರಣೆಗೆ ಹೀಗೆ ಬರೆಯಬಹುದು: "${need(f, "example")}", "received ${ref(f)}", "paid ${ref(f)}" ಅಥವಾ "status".`,
  owner_message_held: (f) => `ಆರ್ಡರ್ ${ref(f)} ಬಗ್ಗೆ ಒಂದು ಸಂದೇಶ ನನ್ನ ದಾಖಲೆಗೆ ಹೊಂದದ ಕಾರಣ ತಡೆಹಿಡಿದಿದ್ದೇನೆ. ತಪ್ಪಾದದ್ದು ಏನೂ ಹೋಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಆರ್ಡರ್ ನೋಡಿ.`,
};

export const TEMPLATES: Record<Language, Set> = { en, hi, ml, kn };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
