// Writes the review sheet a native speaker fills in: every message the Orders agent sends in a language, with what it is meant to say, and every word and phrase it understands
// from a customer in that language. Hindi, Malayalam and Kannada are all machine-written, so all three get a sheet.
//   node templates/commerce/orders/scripts/review-sheet.ts hi > templates/commerce/orders/REVIEW-hi.md   (and ml, kn)
// The sheet is made from the templates, the formatters and the word lists themselves, so it cannot drift from what the agent really says; a test (test/review-sheet.test.ts)
// fails when a committed sheet is missing a line.
import { pathToFileURL } from "node:url";
import { ORDER_WORDS, NUMBER_WORDS, parseIntent } from "../src/adapters/rule-parser.ts";
import type { Intent } from "../src/adapters/model.ts";
import { PLAN_REPORT_WORDS } from "../src/plans/report.ts";
import { PLAN_WORDS } from "../src/plans/words.ts";
import { annapurna } from "../src/harness.ts";
import { LABELS } from "../src/language/interactive.ts";
import { exampleFacts } from "../src/language/meta-templates.ts";
import { TEMPLATES, render } from "../src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../src/language/templates.ts";
import { itemName } from "../src/settings.ts";
import { MONTH_NAMES, WEEKDAY_NAMES, formatDate } from "../../../../modules/language/format.ts";
import { LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import { WORDS } from "../../../../modules/language/words.ts";
import { reportStringRows, sampleOwnerText } from "../report/review.ts";
import { sampleMessage } from "../report/whatsapp.ts";

export type ReviewLanguage = "hi" | "ml" | "kn";

/** When each message is sent, in a line, so the reviewer knows what the customer or the owner has just done. */
const WHEN: Record<TemplateId, string> = {
  menu: "A first hello, or a greeting: the menu with its prices, and the list of items to pick from",
  pick_items: "The words above the list of items",
  ask_when: "The order has items but no day: which day",
  ask_how: "The order has no way yet, and the shop delivers: pickup or delivery (two buttons)",
  ask_slot: "The order has a day but no slot: pick a time from the list of slots still open",
  ask_address: "A delivery order: where to deliver, and the places the shop delivers to",
  confirm_details: "The customer wrote a weekday: the full date is read back, and they say yes",
  confirm_buttons: "The words above the Yes / No buttons of that read-back",
  price_floor: "The customer asked for a lower price: the menu price, and no lower",
  // E1, the discount authority (only a shop with a "discounts" block)
  discount_agreed: "The customer asked for less, within what the agent may take off alone: the price agreed (the quote follows)",
  discount_asked: "The customer asked for less, beyond what the agent may take off alone: the owner is asked, nothing is held yet",
  discount_which: "The customer asked for a discount without naming a price, before saying which item: the agent asks which one",
  discount_approved: "The owner said yes to the price card: the agreed price (the quote and link follow)",
  discount_refused: "The owner said no to the price card: the lowest price, which is the list price (the quote follows)",
  owner_discount_ask: "To the owner: the price card, with the exact price, answered with the reference and the card's code",
  owner_discount_use_code: "To the owner: they wrote \"approve\" or \"deny\" with the reference alone while a price card waits: the exact words to send",
  owner_discount_stale: "To the owner: an answer to a price card that changed or was already answered: nothing was done",
  // "keep one for me", the pickup hold (only a shop whose advance is "none")
  hold_enquiry_asked: "The customer sent a photo or words naming no listed item (a model number): the shop is asked which item it is",
  hold_still_asking: "The customer wrote again while the shop is still asked: no second ask",
  hold_offer: "The owner picked the listed item a photo or model number shows: it is in stock, at its price (the ask for a day follows)",
  hold_usually: "A listed item the customer asked to keep has none that can be kept now: the shop usually carries it",
  hold_only_left: "Fewer of the item can be kept now than the customer asked for: how many",
  hold_asked_shop: "The customer asked to keep a listed item for a pickup time: the shop is asked to say yes (not held yet)",
  hold_held: "The shop said yes and the item is reserved: held until the end of the pickup time; nothing to pay now",
  hold_declined: "The shop said it cannot keep the item",
  hold_ended: "The pickup time ended and the item was not collected: it is no longer kept",
  hold_cancelled: "The customer cancelled a hold: it is no longer kept",
  owner_hold_enquiry: "To the owner: a customer sent a photo or a model number; which listed item is it (\"pick\" or \"deny\")",
  owner_hold_ask: "To the owner: a customer asks to keep an item for a pickup time (\"approve\" or \"deny\")",
  owner_hold_held: "To the owner: an item is now held for a customer; how to mark it collected",
  owner_hold_collected: "To the owner: their \"collected\" was recorded",
  owner_hold_ended: "To the owner: a held item was not collected by the end of its pickup time and is free again",
  owner_hold_cancelled: "To the owner: the customer no longer needs a held item, and it is free again",
  owner_hold_none: "To the owner: \"collected\" for a number with no hold waiting: nothing was marked",
  owner_hold_pick_unclear: "To the owner: their \"pick\" named no listed item, or more than one",
  too_many_items: "One order has more items than the shop allows",
  out_of_stock: "More of an item than is left for the day: how many are left",
  sold_out: "An item is sold out for the day",
  day_full: "The shop takes no more orders for that day",
  slot_full: "A slot has reached its own limit of orders for that day (the slot's own most orders): pick another time or day",
  plan_choose: "A customer asks for a monthly plan and the shop has more than one: the plans with their prices, to choose by name",
  plan_quote: "A monthly plan is held: the meals, the first and last day, the month's price and the payment link (a UPI shop: with the UPI ID, and the owner confirms)",
  plan_active: "The plan's payment is recorded: the meals owed, the month, and when a day closes for skipping or pausing",
  plan_full: "The slot has no place left for the plan's days: the plan is not started",
  plan_none: "A customer asks about a plan and has none",
  plan_pause_done: "The customer paused the plan from a day: no meals from then, the paused days count as credit at the end of the month",
  plan_skip_done: "The customer skipped one meal day before its cut-off: it counts as credit at the end of the month",
  plan_resume_done: "The customer resumed a paused plan from a day",
  plan_cutoff_refused: "A pause, skip or resume came after that day's cut-off: refused, with the cut-off time",
  plan_no_meal: "A skip, pause or resume for a day with no meal, or one already skipped or paused",
  plan_cancelled: "The customer cancelled the plan: no meal is sent or charged after the days already closed",
  plan_renewal: "The month's end: the next month's payment request with the amount (after any credit), the plan price, the pay-by time and the link; no automatic debit",
  plan_lapsed: "The renewal was not paid before its first meal closed: the plan has stopped, nothing is charged",
  plan_hold_expired: "The first payment of a plan did not come in time: the plan was not started",
  plan_credit_refund: "Days of a plan not taken (or unused when it ended) are refunded",
  plan_credit_refund_pending: "The same refund is above the refund limit: waiting for the owner",
  owner_plan_started: "To the owner: a new monthly plan is paid, with its meals, month and way (pickup or delivery)",
  owner_plan_cancelled: "To the owner: a plan was cancelled, so no meals are to be made for the days after it",
  order_reminder: "The reminder before the slot, to a customer whose order is confirmed: the items, when, pickup or delivery, and what is left to pay",
  balance_paid: "The owner marked the balance received at pickup or delivery (or the balance link was paid): thanks, nothing more to pay",
  balance_link: "The owner asked for a link for the balance: the amount left and the link to pay it",
  after_cutoff: "Orders for that day and slot have closed: when they closed",
  outside_area: "A delivery address names no place on the shop's list: the places it delivers to",
  quote_and_link: "The order is held: the items, the day and slot, the total, the advance and the payment link (UPI: with the UPI ID, and the owner confirms)",
  already_waiting: "The customer writes again while an order is held: the same link, not a second order",
  link_failed: "The payment link could not be made: nothing is ordered, the owner is told",
  chat_shop_busy: "A chat guest asks to order while the shop already has as many unpaid orders as its cap (nothing is held, the owner is not asked)",
  order_confirmed: "The payment record shows the advance (Razorpay): the order is confirmed, what is left to pay and the cancellation rule",
  hold_expired: "The hold ended before the advance was recorded",
  stock_gone_refund: "A payment arrived after the hold ended and the stock is gone: it is refunded",
  cutoff_passed_refund: "A payment arrived after the hold ended and orders have closed: it is refunded",
  refund_unused: "A payment arrived for an order that is no longer active: it is refunded",
  duplicate_refund: "The advance was paid twice: the extra is refunded",
  duplicate_refund_pending: "The advance was paid twice and the extra is above the refund limit: waiting for the owner",
  cancelled_refund: "A cancellation inside the window: the advance is refunded",
  cancelled_refund_pending: "A cancellation inside the window with a refund above the limit: waiting for the owner",
  cancelled_late: "A cancellation outside the window: the owner decides about the advance",
  cancelled_no_advance: "An order cancelled before anything was paid",
  cancelled_draft: "An order dropped before it had a day",
  no_order_found: "The customer asked to change or cancel and has no order",
  refund_approved: "The owner approved the refund",
  refund_denied: "The owner said no to the refund",
  refund_checking: "A refund could not be sent yet: it is being checked",
  refund_confirmed: "A refund that was being checked now shows on the payment service's own list: the customer is told, once, as refund_checking promised",
  refund_expired: "The owner did not answer a refund request in time: nothing was sent",
  big_order_asked: "A big order (above the owner's line) waits for the owner",
  big_order_denied: "The owner said no to a big order",
  didnt_understand: "The message was not understood",
  voice_note: "A voice note: it cannot be listened to yet, so they are asked to type",
  voice_note_retry: "The customer sent a voice note and the shop has voice on, but it could not be made out (too long, unclear, or the day's limit): they are asked to type instead",
  ask_cancel: "The customer tapped Cancel order: are you sure (Yes / No buttons)",
  kept: "The customer said no to cancelling: the order stays",
  told_owner: "The customer tapped Talk to the owner: the owner has been asked to message them",
  couldnt_tell_owner: "The owner could not be told just now",
  wait_over: "The shop's system did not answer for 15 minutes from the message (a Guard was down) and the request was not finished: the customer is told so, that the message is on the owner's to-do list, and to write again later or contact the shop. Nothing else is promised",
  owner_order_confirmed: "A pickup order was confirmed: what to prepare, for when, the total, the advance and what to collect",
  owner_delivery_confirmed: "A delivery order was confirmed: the same, with the address the customer wrote",
  owner_big_order: "An order above the owner's line: approve or deny, with the order's reference",
  owner_order_cancelled: "A confirmed order was cancelled: do not prepare it",
  owner_late_cancellation: "A cancellation outside the window: approve (refund) or deny (keep), with the order's reference",
  owner_duplicate_payment: "The advance was paid twice: the extra was refunded",
  owner_payment_unused: "A payment arrived for an order that could not be taken: it was refunded",
  owner_link_failed: "The payment link for an order could not be made",
  owner_balance_marked: "The owner marked the balance of an order received: it is recorded",
  owner_balance_none: "The owner's \"balance\" command has nothing to mark: no confirmed or finished order with a balance left",
  owner_message_held: "A message was held back because it did not match the order record",
  owner_opted_out: "A customer sent STOP",
  owner_unknown_command: "The owner's reply was not approve or deny",
  owner_wants_to_talk: "A customer tapped Talk to the owner (at most once an hour for the same customer)",
  owner_ai_allowance: "Button mode, told once a month: the shop's monthly AI allowance is used up",
  owner_ai_off: "Button mode, told once: the AI was switched off from outside",
  owner_ai_fault: "Button mode, told at most once a day: a model did not answer, so buttons are used for a few minutes",
  owner_refund_needs_approval: "A refund above the limit waits for the owner's one-use code (sent by the approvals relay, never by the agent)",
  owner_approval_done: "The owner approved with the code: the refund is being sent",
  owner_approval_denied: "The owner denied with the code: nothing is sent",
  owner_approval_expired: "The owner answered after the request had run out: nothing was refunded",
  owner_approval_failed: "The owner's answer could not be recorded just now: send it again",
  owner_approval_waiting: "A refund needs several people: this person's approval is in and more are needed",
  owner_approval_closed: "A refund needs several people: the others approved it, so this person's answer is no longer needed",
  owner_approval_refused: "A refund needs several people: one of them refused it, so it is not sent",
  owner_refund_settled: "A person at the server checked an uncertain refund and marked it as made: it is done and not sent again",
  upi_order_confirmed: "UPI shop: the owner marked the advance received: the order is confirmed",
  upi_qr_caption: "UPI shop: the words under the QR picture",
  upi_paid_claim: "UPI shop: the customer says they paid or sends a screenshot (nothing is marked paid)",
  upi_nothing_waiting: "UPI shop: the customer says they paid and no advance is waiting",
  upi_late_received: "UPI shop: the owner marked the advance after the hold ended: the order is not confirmed",
  upi_refund_owed: "UPI shop: a refund the owner will send (the agent never sends it)",
  upi_cancelled_refund_owed: "UPI shop: a cancellation inside the window: the owner will send the refund",
  upi_extra_refund_owed: "UPI shop: the owner marked more than the advance: the owner will send the extra back",
  upi_refund_sent: "UPI shop: the owner marked the refund sent (only then is the customer told)",
  owner_upi_expected: "UPI shop: tells the owner what payment to look for in their UPI app, with the one-use code",
  owner_upi_claim: "UPI shop: the customer says they paid (a screenshot is not proof): the owner is asked to look",
  owner_upi_marked: "UPI shop: the answer to the owner's Received, the order confirmed",
  owner_upi_part: "UPI shop: the answer to the owner's Received, part paid, with the code for the rest",
  owner_upi_already: "UPI shop: the owner used a code that was already used: counted once",
  owner_upi_unknown: "UPI shop: the owner used a code the agent never gave",
  owner_upi_late: "UPI shop: the owner marked the advance after the hold ended: take the order by hand or send the money back",
  owner_upi_refund_owed: "UPI shop: a refund the owner must send from their UPI app, with the code",
  owner_upi_refund_reminder: "UPI shop: a reminder of a refund still owed (once a day, three times at most)",
  owner_upi_refund_marked: "UPI shop: the answer to the owner's Refund sent",
  owner_upi_refund_kept: "UPI shop: the owner kept the money for an order they take by hand",
  orders_paused: "The shop's licence is in its wind-down: the answer to a customer who asks to order. No order, no link, nothing kept for later",
  owner_licence_paused: "The one notice to the owner when the licence winds down: online ordering is paused, who to contact. Never about money",
  owner_licence_stopped: "The one notice to the owner at the licence's final stop: the partner's service has ended, what is still open, and that hello@geometer.dev will connect the owner with another local partner",
};

const cell = (text: string) => text.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const REVIEWER = "Native reviewer: OK / change to …";
const list = (words: readonly string[]) => words.join(" · ");
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function describeIntent(i: Intent): string {
  const parts: string[] = [i.kind];
  if (i.items) parts.push(`items ${i.items.map((l) => `${l.qty}×${l.itemId}`).join(", ")}`);
  if (i.mode) parts.push(i.mode);
  if (i.offerInr !== undefined) parts.push(`price ₹${i.offerInr}`);
  if (i.overrideAttempt) parts.push("flagged as a trick");
  return parts.join(", ");
}

/** Customer sentences, in the language, with what they mean. The sheet shows what the agent reads from each (the example shop's menu is English and Hindi, so Malayalam and Kannada use Latin item names). */
export const EXAMPLES: Record<ReviewLanguage, [string, string][]> = {
  hi: [["कल 2 वेज थाली पिकअप", "2 veg thali tomorrow, pickup"], ["वेज थाली डिलीवरी 12 nov", "veg thali, delivery, 12 Nov"], ["मैंने पेमेंट कर दिया", "I have paid"], ["ऑर्डर रद्द करें", "Cancel my order"], ["मुझे मालिक से बात करनी है", "I want to talk to the owner"], ["पैसे वापस चाहिए", "I want my money back"]],
  ml: [["നാളെ 2 veg thali പിക്കപ്പ്", "2 veg thali tomorrow, pickup"], ["ഞാൻ പണം അടച്ചു", "I paid"], ["ഓർഡർ റദ്ദാക്കൂ", "Cancel my order"], ["എനിക്ക് ഉടമയോട് സംസാരിക്കണം", "I want to talk to the owner"], ["റീഫണ്ട് വേണം", "I want a refund"], ["മെസ്സേജ് നിർത്തൂ", "Stop the messages"]],
  kn: [["ನಾಳೆ 2 veg thali ಪಿಕಪ್", "2 veg thali tomorrow, pickup"], ["ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ", "I paid"], ["ಆರ್ಡರ್ ರದ್ದು ಮಾಡಿ", "Cancel my order"], ["ನನಗೆ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಬೇಕು", "I want to talk to the owner"], ["ರೀಫಂಡ್ ಬೇಕು", "I want a refund"], ["ಮೆಸೇಜ್ ನಿಲ್ಲಿಸಿ", "Stop the messages"]],
};

const SCRIPT: Record<ReviewLanguage, RegExp> = { hi: /[ऀ-ॿ]/u, ml: /[ഀ-ൿ]/u, kn: /[ಀ-೿]/u };
const LATIN = /^[\x20-\x7E]+$/u;

/** The whole sheet for a language, as Markdown. */
export function reviewSheet(language: ReviewLanguage): string {
  const name = LANGUAGE_NAMES[language];
  const shop = annapurna();
  const ids = Object.keys(TEMPLATES[language]) as TemplateId[];
  const facts = (lang: ReviewLanguage | "en"): MessageFacts => ({ ...exampleFacts(shop, lang), menu: shop.menu.map((i) => ({ name: itemName(i, lang), priceInr: i.priceInr })), areas: shop.delivery!.area, itemName: itemName(shop.menu[0], lang), priceInr: shop.menu[0].priceInr, leftCount: 3, maxItems: shop.orders.maxItemsPerOrder, holdMinutes: shop.advance.holdMinutes, link: "https://rzp.io/i/example" });
  const customerFacts = (lang: ReviewLanguage | "en"): MessageFacts => ({ ...facts(lang), advanceInr: 120, totalInr: 240, balanceInr: 120 });
  const messageRows = (owner: boolean) => ids.filter((id) => id.startsWith("owner_") === owner).map((id): string[] => [`\`${id}\``, WHEN[id], render(id, owner ? facts(language) : customerFacts(language)), render(id, owner ? facts("en") : customerFacts("en")), ""]);
  const head = ["Template id", "When it is sent", `Text (${name})`, "Meaning (the English template)", REVIEWER];
  const out: string[] = [];

  out.push(`# Review sheet: ${name} (${language}), Orders`, "");
  out.push("> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**", "");
  out.push(`Every line below is what the Orders agent says or understands in ${name}. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Annapurna Tiffins' (a made-up tiffin service): 2 × veg thali, a total of ₹240, an advance of ₹120.`, "");
  out.push("What to look for first: (1) is each message polite, short and something a food shop would really send; (2) are \"advance\", \"pickup\", \"delivery\", \"cut-off\", \"refund\" and \"owner\" the words people use; (3) is the owner's \"approve\" / \"deny\" / \"received\" left in Latin letters, as the owner types it.", "");
  out.push("Amounts are always written as ₹1,200 with Western digits; items, quantities, days, times, places and links are filled in from the shop's record, never translated.", "");

  out.push(`## 1. Messages to the customer (${ids.filter((id) => !id.startsWith("owner_")).length})`, "", table(head, messageRows(false)), "");
  out.push(`## 2. Messages to the owner (${ids.filter((id) => id.startsWith("owner_")).length})`, "");
  out.push("Most owner messages are also WhatsApp templates, because they are sent by the agent on its own and WhatsApp then carries only an approved template. Meta approves the wording once, so the wording here is what is submitted.", "");
  out.push(table(head, messageRows(true)), "");

  out.push("### The words on the buttons and the lists", "");
  out.push("Some of the messages above come with buttons (up to 3, each 20 letters at most) or a list that the customer taps instead of typing. A label never carries an amount or a date.", "");
  const english = LABELS.en;
  const keys = Object.keys(english) as (keyof typeof english)[];
  out.push(table(["Id", `Text (${name})`, "Meaning (English)", REVIEWER], keys.map((key) => [`\`${key}\``, LABELS[language][key], english[key], ""])), "");

  out.push("## 3. Dates as the agent writes them", "");
  out.push(table(["Weekday", `Written in ${name}`, REVIEWER], WEEKDAY_NAMES[language].map((w, i) => [WEEKDAYS_EN[i], w, ""])), "");
  out.push(table(["Month", `Written in ${name}`, REVIEWER], MONTH_NAMES[language].map((m, i) => [MONTHS_EN[i], m, ""])), "");
  out.push(`Dates are written weekday, day, month ("${formatDate({ year: 2026, month: 11, day: 12 }, language)}"); a time window is written "from … to …" with the part of the day before each time.`, "");

  out.push("## 4. Item names in the example shop (Annapurna Tiffins)", "");
  out.push(table(["Item", `Names in ${name} (the first is what the agent says; the rest are what customers may call it)`, REVIEWER], shop.menu.map((i) => [i.names.en?.[0] ?? i.id, list(i.names[language] ?? ["(the example shop writes English and Hindi: this item has no name in this language)"]), ""])), "");

  out.push("## 5. What the agent understands from a customer", "");
  out.push("Words in Latin letters are how people type the language on WhatsApp. They are listed in one row, with the English ones, because the lists are shared by the languages.", "");
  const own = (w: readonly string[]) => w.filter((x) => SCRIPT[language].test(x));
  const latin = (w: readonly string[]) => w.filter((x) => LATIN.test(x));
  const row = (meaning: string, english: string, w: readonly string[]): string[] => [meaning, english, `${list(own(w))} — Latin letters: ${list(latin(w))}`, ""];
  const understood: string[][] = [
    row("an order (words that mean the customer wants something)", "order, want, need", ORDER_WORDS.order),
    row("pickup", "pickup, collect, take away", ORDER_WORDS.pickup),
    row("delivery", "delivery, deliver", ORDER_WORDS.delivery),
    row("I have paid (a claim; checked against the payment record, never believed on its own)", "paid, I have paid", ORDER_WORDS.paid),
    row("money back", "refund, money back", ORDER_WORDS.refund),
    row("talk to the owner", "owner, talk to", ORDER_WORDS.owner),
    row("a monthly plan (a shop with plans): the word for a plan, and for starting one", "plan, monthly, subscribe, want", [...PLAN_WORDS.plan, ...PLAN_WORDS.subscribe]),
    row("a plan: skip a day", "skip", PLAN_WORDS.skip),
    row("a plan: pause from a day", "pause, hold", PLAN_WORDS.pause),
    row("a plan: resume from a day", "resume, restart", PLAN_WORDS.resume),
    row("a plan: cancel it (with the word for a plan)", "cancel, stop, end", PLAN_WORDS.cancel),
    row("a plan: my plan", "my plan", PLAN_WORDS.mine),
    row("a quantity in words (one to ten in English and Hindi, one to five in Malayalam and Kannada)", "one, two, three", Object.keys(NUMBER_WORDS)),
  ];
  if (language !== "hi") {
    const words = WORDS[language];
    understood.push(["yes (exact)", "yes", list(words.yes), ""], ["no (exact)", "no", list(words.no), ""], ["hello (exact)", "hello", list(words.greeting), ""], ["cancel", "cancel", list(words.cancel), ""],
      ["STOP, on its own or in a few words (exact)", "stop", list(words.stop), ""], ["STOP, as a phrase (the start; the last word may continue)", "stop the messages", list(words.stopPhrases), ""],
      ["rupee, after an amount: \"200 …\"", "rupees", list(words.rupee), ""], ["\"rules\", near a word for \"forget\" (a trick)", "rules, instructions", list(words.overrideTopics), ""], ["\"forget\", near a word for \"rules\" (a trick)", "forget, ignore, break", list(words.overrideVerbs), ""],
      ["Latin-letter words that show the customer writes " + name, "(language hints)", list(words.hints), ""]);
  }
  out.push(table(["Meaning", "English", `Words and phrases (${name} letters first, then the Latin letters people type it in)`, REVIEWER], understood), "");
  out.push("The shop's own item names and its slot names (\"lunch\", \"dinner\") are the shop's settings, written by the person who sets the shop up: they are not in this list.", "");

  out.push("### Whole sentences, and what the agent reads from them", "");
  const context = { menu: shop.menu, slots: [], languages: shop.languages } as never;
  out.push(table(["Customer writes", "Meaning", "The agent reads", REVIEWER], EXAMPLES[language].map(([text, meaning]) => [text, meaning, describeIntent(parseIntent(text, context)), ""])), "");

  out.push("## 6. The monthly report", "");
  out.push("### The monthly plans' lines (a shop with plans only)", "", table(["Where", "Wording", REVIEWER], Object.entries(PLAN_REPORT_WORDS[language]).map(([key, text]) => [key, text, ""])), "");
  out.push("The owner's monthly text is five short lines of \"label: number\". Every number, amount and date is counted from the record and written by the same formatters as the messages; only the words around them are below.", "");
  out.push("### The five lines, with sample numbers", "", "```text", sampleOwnerText(language), "```", "");
  out.push("### The monthly report on WhatsApp, with sample numbers", "", "```text", sampleMessage(language), "```", "");
  out.push("### Every word and phrase of the report", "");
  out.push(table(["Id", `Text (${name})`, "Meaning (English)", REVIEWER], reportStringRows(language).map((r) => [`\`${r.id}\``, r.text, r.english, ""])), "");
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const language = process.argv[2];
  if (language !== "hi" && language !== "ml" && language !== "kn") {
    console.error("Say which language: node templates/commerce/orders/scripts/review-sheet.ts hi   (or ml, kn)");
    process.exitCode = 1;
  } else {
    console.log(reviewSheet(language));
  }
}
