// The words of the credit book (src/credit/settings.ts), per language: every message the shop's *khata* sends, as fixed templates written from the record (the facts), never
// from a model and never from the owner's or a customer's words. Same rules as src/language/templates.ts, which spreads these sets into its own (TEMPLATES), so the outgoing
// check, the WhatsApp template list, the generated Go words and the review sheets cover them with no extra wiring.
//
// Why a set of its own: a credit book writes to an ADULT about their OWN account ("your account at Sri Lakshmi Hardware"), never to a parent about a child's fee for a month.
// The Fees messages a credit account's paths reach (a reminder, a receipt, "I have paid", a refund, the owner's notes) each have a credit twin here; the agent chooses the twin
// for a credit account (go/internal/fees credit.go creditTwin). The facts are the Fees facts: `studentName` is the person's name in the book, `dueRef` their account's entry, and
// `roster` the owner's list of who owes what (a literal, only ever sent to the owner, as Classes' roster is).
//
// This file imports only TYPES from templates.ts (and writes its own `need`), because templates.ts imports this file's sets at load: a runtime import back would make a loop.
// Hindi, Malayalam and Kannada are MACHINE-WRITTEN and wait for a native speaker (REVIEW-hi.md, REVIEW-ml.md, REVIEW-kn.md list every line). No message says "safe",
// "guaranteed" or promises a payment: it says what the shop's record shows.
import { formatInr } from "../../../../../modules/language/format.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { MessageFacts } from "../language/templates.ts";

export type CreditTemplateId =
  // to the customer (an adult, about their own account): the first question (sent only after the owner's tap), the answers, the reminder, receipts and replies
  | "credit_consent_ask" | "credit_consent_yes" | "credit_reminder" | "credit_received" | "credit_part_received" | "credit_pay_link" | "credit_already_paid"
  | "credit_claim_partial" | "credit_claim_not_found" | "credit_upi_claim" | "credit_menu" | "credit_discount_to_owner" | "credit_request_waiting"
  | "credit_refund_asked" | "credit_refund_too_much" | "credit_refund_none" | "credit_upi_qr_caption" | "credit_upi_refund_owed" | "credit_upi_refund_sent"
  | "credit_chat_public" | "credit_paused" | "credit_wait_over"
  // to the owner: what the owner wrote, read back; the list; the first question asked and answered; and the credit twins of the Fees notes
  | "owner_credit_added" | "owner_credit_added_known" | "owner_credit_need_number" | "owner_credit_asked" | "owner_credit_already_asked" | "owner_credit_already_yes"
  | "owner_credit_stopped" | "owner_credit_yes" | "owner_credit_paid" | "owner_credit_cleared" | "owner_credit_paid_too_much" | "owner_credit_nothing_owed"
  | "owner_credit_unknown_person" | "owner_credit_too_much" | "owner_credit_list" | "owner_credit_list_empty" | "owner_credit_number_owner" | "owner_credit_number_taken"
  | "owner_credit_help" | "owner_credit_wrote" | "owner_credit_claim" | "owner_credit_upi_claim" | "owner_credit_upi_expected" | "owner_credit_upi_marked"
  | "owner_credit_upi_part" | "owner_credit_link_failed" | "owner_credit_discount_note" | "owner_credit_refund_request" | "owner_credit_overpayment"
  | "owner_credit_opted_out" | "owner_credit_wants_to_talk" | "owner_credit_request_stale" | "owner_credit_upi_refund_owed" | "owner_credit_upi_refund_reminder"
  | "owner_credit_upi_refund_marked";

type Template = (f: MessageFacts) => string;
type Set = Record<CreditTemplateId, Template>;

function need<K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> {
  const value = f[key];
  if (value === undefined) throw new Error(`The message needs "${String(key)}" from the record, and the record does not have it.`);
  return value as NonNullable<MessageFacts[K]>;
}
type Money = "feeInr" | "balanceInr" | "paidInr" | "receivedInr" | "refundInr";
const inr = (f: MessageFacts, key: Money) => formatInr(need(f, key));
/** templates.ts payTo, written again here only as the same one line (a runtime import of templates.ts would loop): the link, or for a UPI shop the link with its UPI ID and payee. */
const payTo = (f: MessageFacts): string => (f.upiId ? `${need(f, "link")} (UPI ID ${f.upiId}, ${need(f, "payee")})` : need(f, "link"));
const name = (f: MessageFacts) => need(f, "studentName");
const phone = (f: MessageFacts) => need(f, "customerPhone");
const ref = (f: MessageFacts) => need(f, "dueRef");
const req = (f: MessageFacts) => need(f, "requestRef");
const code = (f: MessageFacts) => need(f, "upiCode");
const payee = (f: MessageFacts) => need(f, "payee");

const en: Set = {
  credit_consent_ask: (f) => `Hello ${name(f)}, this is ${f.businessName}. Our book shows ${inr(f, "balanceInr")} to pay on your account. May we send you payment reminders on WhatsApp? Reply YES, or reply STOP and we will not message you.`,
  credit_consent_yes: (f) => `Thank you. ${f.businessName} will send you a reminder now and then while something is owed on your account. Reply STOP at any time to end them.`,
  credit_reminder: (f) => `Hello ${name(f)}, a reminder from ${f.businessName}: ${inr(f, "balanceInr")} is still to pay on your account. Pay here: ${payTo(f)} Reply STOP if you do not want these reminders.`,
  credit_received: (f) => `Thank you! ${f.businessName} has recorded ${inr(f, "receivedInr")} paid on your account. Nothing more is owed. Your receipt number is ${ref(f)}.`,
  credit_part_received: (f) => `Thank you! ${f.businessName} has recorded ${inr(f, "receivedInr")} paid on your account. ${inr(f, "balanceInr")} is still to pay: ${payTo(f)} Reply STOP if you do not want these reminders.`,
  credit_pay_link: (f) => `Pay ${inr(f, "balanceInr")} on your account at ${f.businessName} here: ${payTo(f)}`,
  credit_already_paid: (f) => `Our record shows ${inr(f, "paidInr")} paid on your account, and nothing more is owed. Thank you.`,
  credit_claim_partial: (f) => `Our record shows ${inr(f, "paidInr")} paid on your account, so ${inr(f, "balanceInr")} is still to pay. Pay the rest here: ${payTo(f)}`,
  credit_claim_not_found: (f) => `We cannot see a payment on your account yet. If you paid just now, it can take a few minutes to show. I have asked the owner to check. If it did not go through, you can pay here: ${payTo(f)}`,
  credit_upi_claim: () => "Thank you. The owner will look for your payment in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message.",
  credit_menu: (f) => `Hello! This is ${f.businessName}. ${inr(f, "balanceInr")} is to pay on your account. What would you like to do?`,
  credit_discount_to_owner: () => "I cannot change what is owed myself. I have told the owner that you asked. They will message you here.",
  credit_request_waiting: () => "The owner has already been asked about your account. You will hear back here.",
  credit_refund_asked: (f) => `I have asked the owner about refunding ${inr(f, "refundInr")} of the ${inr(f, "paidInr")} you paid on your account. You will hear back here.`,
  credit_refund_too_much: (f) => `Our record shows ${inr(f, "paidInr")} paid on your account, so I cannot pass on a request for more than that. Tell me the amount you want back, or talk to the owner.`,
  credit_refund_none: () => "There is no payment on record on your account, so there is nothing to refund.",
  credit_upi_qr_caption: (f) => `Scan to pay ${inr(f, "balanceInr")} by UPI to ${payee(f)} (${ref(f)}).`,
  credit_upi_refund_owed: (f) => `The owner will send ${inr(f, "refundInr")} back to you by UPI. I'll message you when they mark it sent.`,
  credit_upi_refund_sent: (f) => `The owner has marked your ${inr(f, "refundInr")} refund (${ref(f)}) as sent by UPI. Please check your UPI app.`,
  credit_chat_public: () => "This chat answers questions about the shop. To reach the owner, tap the button below.",
  credit_paused: (f) => `Online payment is paused for now. Please contact ${f.businessName} directly.`,
  credit_wait_over: (f) => `Sorry, I could not finish your request: the shop's system is not answering just now. Your message is on the owner's to-do list. Please write again later, or contact ${f.businessName} directly.`,

  owner_credit_added: (f) => `Written in the book: ${name(f)} (${phone(f)}) owes ${inr(f, "balanceInr")} in all. Nothing is sent to them until you tap Ask, or reply "ask ${name(f)}".`,
  owner_credit_added_known: (f) => `Written in the book: ${name(f)} owes ${inr(f, "balanceInr")} in all.`,
  owner_credit_need_number: (f) => `Not written yet: send ${name(f)}'s WhatsApp number with their name. The number stays in the shop.`,
  owner_credit_asked: (f) => `Asked ${name(f)} (${phone(f)}) if WhatsApp reminders are fine. Reminders start only after they say yes.`,
  owner_credit_already_asked: (f) => `${name(f)} was already asked. Reminders start only after they say yes.`,
  owner_credit_already_yes: (f) => `${name(f)} already said yes to WhatsApp reminders.`,
  owner_credit_stopped: (f) => `${name(f)} sent STOP, so nothing more is sent to them.`,
  owner_credit_yes: (f) => `Credit book: ${name(f)} (${phone(f)}) said yes to WhatsApp reminders. The first goes in a few days if something is still owed.`,
  owner_credit_paid: (f) => `Noted as paid by your mark: ${name(f)} paid ${inr(f, "receivedInr")}. ${inr(f, "balanceInr")} is still owed.`,
  owner_credit_cleared: (f) => `Noted as paid by your mark: ${name(f)} paid ${inr(f, "receivedInr")}. Nothing more is owed.`,
  owner_credit_paid_too_much: (f) => `Not written: ${name(f)} owes only ${inr(f, "balanceInr")}. Send the amount again.`,
  owner_credit_nothing_owed: (f) => `${name(f)} owes nothing in the book.`,
  owner_credit_unknown_person: (f) => `${name(f)} is not in the book. To add them, write their name, "owes" and the amount.`,
  owner_credit_too_much: (f) => `Not written: one account may show at most ${inr(f, "feeInr")}, and ${name(f)}'s would show more.`,
  owner_credit_list: (f) => `Who owes what: ${need(f, "roster")}`,
  owner_credit_list_empty: () => "Nobody owes anything in the book.",
  owner_credit_number_owner: (f) => `That is your own number. Send ${name(f)}'s WhatsApp number.`,
  owner_credit_number_taken: () => "That number is already another person's account in the book. One number is one account.",
  owner_credit_help: () => `For the credit book, write a name with "owes" or "paid" and the amount, "who owes" for the list, or "ask" and a name to ask about reminders. A number is kept only in the shop.`,
  owner_credit_wrote: (f) => `Credit book: ${name(f)} (${phone(f)}) wrote to the shop before saying yes to reminders, so nothing was sent to them. Please message them.`,
  owner_credit_claim: (f) => `Credit book: ${name(f)} (${phone(f)}) says they paid, but the payment record shows ${inr(f, "paidInr")}. Please check and message them.`,
  owner_credit_upi_claim: (f) => `Credit book: ${name(f)} (${phone(f)}) says they have paid. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received ${code(f)}".`,
  owner_credit_upi_expected: (f) => `UPI payment to check: ${name(f)} (${phone(f)}) has been asked for ${inr(f, "balanceInr")} (${ref(f)}). When it shows in your UPI app, tap Received or reply "received ${code(f)}". If a different amount came, reply "received ${code(f)}" and the amount.`,
  owner_credit_upi_marked: (f) => `Thank you. ${inr(f, "receivedInr")} on ${name(f)}'s account is marked paid by you.`,
  owner_credit_upi_part: (f) => `Thank you. ${inr(f, "receivedInr")} on ${name(f)}'s account is marked paid by you. ${inr(f, "balanceInr")} is still owed; when it arrives, tap Received or reply "received ${code(f)}".`,
  owner_credit_link_failed: (f) => `Could not make the payment link for ${name(f)}'s account (${phone(f)}), so it was not sent. It is tried again at the next reminder, or when they ask again. If this keeps happening, check your payment account or tell the person who set up your agent.`,
  owner_credit_discount_note: (f) => `Credit book: ${name(f)} (${phone(f)}) asked for a discount on what they owe (${inr(f, "balanceInr")}). Please message them. Nothing was changed.`,
  owner_credit_refund_request: (f) => `Approval needed: ${name(f)} (${phone(f)}) asks for ${inr(f, "refundInr")} back of the ${inr(f, "paidInr")} paid on their account. Reply "approve ${req(f)}" or "deny ${req(f)}".`,
  owner_credit_overpayment: (f) => `Credit book: ${name(f)} (${phone(f)}) paid more than was owed. The extra ${inr(f, "refundInr")} is being refunded.`,
  owner_credit_opted_out: (f) => `Credit book: ${name(f)} (${phone(f)}) sent STOP. No more messages will go to them.`,
  owner_credit_wants_to_talk: (f) => `Credit book: ${name(f)} (${phone(f)}) would like to talk to you. Please message them.`,
  owner_credit_request_stale: (f) => `Not done: ${name(f)}'s account (${phone(f)}) changed since you were asked, so nothing was applied.`,
  owner_credit_upi_refund_owed: (f) => `Refund to send: ${inr(f, "refundInr")} by UPI to ${name(f)} (${phone(f)}). The agent never sends money. When you have sent it, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_credit_upi_refund_reminder: (f) => `Reminder: ${inr(f, "refundInr")} is still owed back to ${name(f)} (${phone(f)}). When you have sent it by UPI, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_credit_upi_refund_marked: (f) => `Thank you. The ${inr(f, "refundInr")} refund to ${name(f)} is marked sent, and they have been told.`,
};

const hi: Set = {
  credit_consent_ask: (f) => `नमस्ते ${name(f)}, यह ${f.businessName} है। हमारे खाते में आपके नाम ${inr(f, "balanceInr")} बाकी दिख रहे हैं। क्या हम आपको WhatsApp पर भुगतान की याद भेज सकते हैं? हाँ के लिए YES लिखें, या STOP लिखें तो हम आपको संदेश नहीं भेजेंगे।`,
  credit_consent_yes: (f) => `धन्यवाद। जब तक आपके खाते में कुछ बाकी है, ${f.businessName} आपको कभी-कभी याद भेजेगा। इन्हें बंद करने के लिए कभी भी STOP लिखें।`,
  credit_reminder: (f) => `नमस्ते ${name(f)}, ${f.businessName} की ओर से याद: आपके खाते में ${inr(f, "balanceInr")} अभी बाकी है। यहाँ भुगतान करें: ${payTo(f)} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  credit_received: (f) => `धन्यवाद! ${f.businessName} ने आपके खाते में ${inr(f, "receivedInr")} का भुगतान दर्ज कर लिया है। अब कुछ बाकी नहीं है। आपकी रसीद संख्या ${ref(f)} है।`,
  credit_part_received: (f) => `धन्यवाद! ${f.businessName} ने आपके खाते में ${inr(f, "receivedInr")} का भुगतान दर्ज कर लिया है। ${inr(f, "balanceInr")} अभी बाकी है: ${payTo(f)} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  credit_pay_link: (f) => `${f.businessName} में अपने खाते के ${inr(f, "balanceInr")} यहाँ भरें: ${payTo(f)}`,
  credit_already_paid: (f) => `हमारे रिकॉर्ड में आपके खाते में ${inr(f, "paidInr")} का भुगतान दिख रहा है, और अब कुछ बाकी नहीं है। धन्यवाद।`,
  credit_claim_partial: (f) => `हमारे रिकॉर्ड में आपके खाते में ${inr(f, "paidInr")} भरे दिख रहे हैं, इसलिए ${inr(f, "balanceInr")} अभी बाकी है। बाकी यहाँ भरें: ${payTo(f)}`,
  credit_claim_not_found: (f) => `आपके खाते में अभी कोई भुगतान हमें नहीं दिख रहा। अगर अभी भरा है तो दिखने में कुछ मिनट लग सकते हैं। मैंने मालिक से जाँचने को कहा है। अगर भुगतान नहीं हुआ तो यहाँ भर सकते हैं: ${payTo(f)}`,
  credit_upi_claim: () => "धन्यवाद। मालिक अपने UPI ऐप में आपका भुगतान देखकर पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा। स्क्रीनशॉट भुगतान का सबूत नहीं है, इसलिए कृपया उस संदेश का इंतज़ार करें।",
  credit_menu: (f) => `नमस्ते! यह ${f.businessName} है। आपके खाते में ${inr(f, "balanceInr")} भरना बाकी है। आप क्या करना चाहेंगे?`,
  credit_discount_to_owner: () => "बाकी रकम मैं खुद नहीं बदल सकता। मैंने मालिक को बता दिया है कि आपने पूछा है। वे आपको यहीं संदेश भेजेंगे।",
  credit_request_waiting: () => "आपके खाते के बारे में मालिक से पहले ही पूछा जा चुका है। जवाब आपको यहीं मिलेगा।",
  credit_refund_asked: (f) => `आपने अपने खाते में जो ${inr(f, "paidInr")} भरे, उनमें से ${inr(f, "refundInr")} लौटाने के बारे में मैंने मालिक से पूछा है। जवाब आपको यहीं मिलेगा।`,
  credit_refund_too_much: (f) => `हमारे रिकॉर्ड में आपके खाते में ${inr(f, "paidInr")} का भुगतान है, इसलिए इससे ज़्यादा की माँग मैं आगे नहीं भेज सकता। बताइए कितनी रकम वापस चाहिए, या मालिक से बात करें।`,
  credit_refund_none: () => "आपके खाते में कोई भुगतान दर्ज नहीं है, इसलिए लौटाने को कुछ नहीं है।",
  credit_upi_qr_caption: (f) => `${payee(f)} को UPI से ${inr(f, "balanceInr")} भरने के लिए स्कैन करें (${ref(f)})।`,
  credit_upi_refund_owed: (f) => `मालिक ${inr(f, "refundInr")} आपको UPI से वापस भेजेंगे। जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  credit_upi_refund_sent: (f) => `मालिक ने आपका ${inr(f, "refundInr")} का रिफंड (${ref(f)}) UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देखें।`,
  credit_chat_public: () => "यह चैट दुकान के बारे में सवालों के जवाब देती है। मालिक से बात करने के लिए नीचे का बटन दबाइए।",
  credit_paused: (f) => `ऑनलाइन भुगतान अभी रुका हुआ है। कृपया सीधे ${f.businessName} से संपर्क करें।`,
  credit_wait_over: (f) => `क्षमा करें, मैं आपका अनुरोध पूरा नहीं कर पाया: दुकान का सिस्टम अभी जवाब नहीं दे रहा है। आपका संदेश मालिक की काम की सूची में है। कृपया बाद में फिर लिखें, या सीधे ${f.businessName} से संपर्क करें।`,

  owner_credit_added: (f) => `खाते में लिखा गया: ${name(f)} (${phone(f)}) पर कुल ${inr(f, "balanceInr")} बाकी है। जब तक आप Ask न दबाएँ या "ask ${name(f)}" न लिखें, उन्हें कुछ नहीं भेजा जाएगा।`,
  owner_credit_added_known: (f) => `खाते में लिखा गया: ${name(f)} पर कुल ${inr(f, "balanceInr")} बाकी है।`,
  owner_credit_need_number: (f) => `अभी लिखा नहीं गया: ${name(f)} का WhatsApp नंबर उनके नाम के साथ भेजें। नंबर दुकान में ही रहता है।`,
  owner_credit_asked: (f) => `${name(f)} (${phone(f)}) से पूछा गया कि WhatsApp पर याद भेजना ठीक है या नहीं। याद उनके हाँ कहने के बाद ही शुरू होगी।`,
  owner_credit_already_asked: (f) => `${name(f)} से पहले ही पूछा जा चुका है। याद उनके हाँ कहने के बाद ही शुरू होगी।`,
  owner_credit_already_yes: (f) => `${name(f)} पहले ही WhatsApp पर याद के लिए हाँ कह चुके हैं।`,
  owner_credit_stopped: (f) => `${name(f)} ने STOP भेजा था, इसलिए उन्हें अब कुछ नहीं भेजा जाता।`,
  owner_credit_yes: (f) => `खाता: ${name(f)} (${phone(f)}) ने WhatsApp पर याद के लिए हाँ कहा। अगर कुछ बाकी रहा तो पहली याद कुछ दिनों में जाएगी।`,
  owner_credit_paid: (f) => `आपके निशान से भुगतान दर्ज: ${name(f)} ने ${inr(f, "receivedInr")} दिए। ${inr(f, "balanceInr")} अभी बाकी है।`,
  owner_credit_cleared: (f) => `आपके निशान से भुगतान दर्ज: ${name(f)} ने ${inr(f, "receivedInr")} दिए। अब कुछ बाकी नहीं है।`,
  owner_credit_paid_too_much: (f) => `दर्ज नहीं हुआ: ${name(f)} पर सिर्फ़ ${inr(f, "balanceInr")} बाकी है। रकम फिर से भेजें।`,
  owner_credit_nothing_owed: (f) => `खाते में ${name(f)} पर कुछ बाकी नहीं है।`,
  owner_credit_unknown_person: (f) => `${name(f)} खाते में नहीं हैं। जोड़ने के लिए उनका नाम, "owes" और रकम लिखें।`,
  owner_credit_too_much: (f) => `दर्ज नहीं हुआ: एक खाते में ज़्यादा से ज़्यादा ${inr(f, "feeInr")} हो सकते हैं, और ${name(f)} का खाता इससे ज़्यादा हो जाता।`,
  owner_credit_list: (f) => `किस पर कितना बाकी: ${need(f, "roster")}`,
  owner_credit_list_empty: () => "खाते में किसी पर कुछ बाकी नहीं है।",
  owner_credit_number_owner: (f) => `यह आपका अपना नंबर है। ${name(f)} का WhatsApp नंबर भेजें।`,
  owner_credit_number_taken: () => "यह नंबर खाते में पहले से किसी और का है। एक नंबर, एक खाता।",
  owner_credit_help: () => `खाते के लिए नाम के साथ "owes" या "paid" और रकम लिखें, सूची के लिए "who owes", या याद के बारे में पूछने के लिए "ask" और नाम। नंबर सिर्फ़ दुकान में रहता है।`,
  owner_credit_wrote: (f) => `खाता: ${name(f)} (${phone(f)}) ने याद के लिए हाँ कहने से पहले दुकान को लिखा, इसलिए उन्हें कुछ नहीं भेजा गया। कृपया उन्हें संदेश भेजें।`,
  owner_credit_claim: (f) => `खाता: ${name(f)} (${phone(f)}) कहते हैं कि उन्होंने भुगतान कर दिया, पर भुगतान रिकॉर्ड में ${inr(f, "paidInr")} दिख रहा है। कृपया जाँचें और उन्हें संदेश भेजें।`,
  owner_credit_upi_claim: (f) => `खाता: ${name(f)} (${phone(f)}) कहते हैं कि उन्होंने भुगतान कर दिया है। स्क्रीनशॉट सबूत नहीं है: अपना UPI ऐप देखें। भुगतान दिखे तो Received दबाएँ या "received ${code(f)}" लिखें।`,
  owner_credit_upi_expected: (f) => `जाँचने के लिए UPI भुगतान: ${name(f)} (${phone(f)}) से ${inr(f, "balanceInr")} माँगे गए हैं (${ref(f)})। आपके UPI ऐप में दिखे तो Received दबाएँ या "received ${code(f)}" लिखें। अलग रकम आई हो तो "received ${code(f)}" और रकम लिखें।`,
  owner_credit_upi_marked: (f) => `धन्यवाद। ${name(f)} के खाते में ${inr(f, "receivedInr")} आपके द्वारा भुगतान के रूप में दर्ज हैं।`,
  owner_credit_upi_part: (f) => `धन्यवाद। ${name(f)} के खाते में ${inr(f, "receivedInr")} आपके द्वारा भुगतान के रूप में दर्ज हैं। ${inr(f, "balanceInr")} अभी बाकी है; आने पर Received दबाएँ या "received ${code(f)}" लिखें।`,
  owner_credit_link_failed: (f) => `${name(f)} के खाते (${phone(f)}) का भुगतान लिंक नहीं बन सका, इसलिए नहीं भेजा गया। अगली याद पर या उनके फिर पूछने पर दोबारा कोशिश होगी। ऐसा बार-बार हो तो अपना भुगतान खाता देखें या एजेंट सेट करने वाले व्यक्ति को बताएँ।`,
  owner_credit_discount_note: (f) => `खाता: ${name(f)} (${phone(f)}) ने बाकी रकम (${inr(f, "balanceInr")}) पर छूट माँगी है। कृपया उन्हें संदेश भेजें। कुछ बदला नहीं गया।`,
  owner_credit_refund_request: (f) => `मंज़ूरी चाहिए: ${name(f)} (${phone(f)}) अपने खाते में भरे ${inr(f, "paidInr")} में से ${inr(f, "refundInr")} वापस माँग रहे हैं। "approve ${req(f)}" या "deny ${req(f)}" लिखें।`,
  owner_credit_overpayment: (f) => `खाता: ${name(f)} (${phone(f)}) ने बाकी से ज़्यादा भर दिया। ज़्यादा ${inr(f, "refundInr")} लौटाए जा रहे हैं।`,
  owner_credit_opted_out: (f) => `खाता: ${name(f)} (${phone(f)}) ने STOP भेजा। उन्हें अब कोई संदेश नहीं जाएगा।`,
  owner_credit_wants_to_talk: (f) => `खाता: ${name(f)} (${phone(f)}) आपसे बात करना चाहते हैं। कृपया उन्हें संदेश भेजें।`,
  owner_credit_request_stale: (f) => `नहीं हुआ: आपसे पूछे जाने के बाद ${name(f)} का खाता (${phone(f)}) बदल गया, इसलिए कुछ लागू नहीं किया गया।`,
  owner_credit_upi_refund_owed: (f) => `भेजना है: ${inr(f, "refundInr")} UPI से ${name(f)} (${phone(f)}) को। एजेंट कभी पैसे नहीं भेजता। भेज दें तो Refund sent दबाएँ या "refunded ${code(f)}" लिखें।`,
  owner_credit_upi_refund_reminder: (f) => `याद: ${name(f)} (${phone(f)}) को ${inr(f, "refundInr")} अभी लौटाने बाकी हैं। UPI से भेज दें तो Refund sent दबाएँ या "refunded ${code(f)}" लिखें।`,
  owner_credit_upi_refund_marked: (f) => `धन्यवाद। ${name(f)} का ${inr(f, "refundInr")} का रिफंड भेजा हुआ दर्ज है, और उन्हें बता दिया गया है।`,
};

const ml: Set = {
  credit_consent_ask: (f) => `നമസ്കാരം ${name(f)}, ഇത് ${f.businessName} ആണ്. ഞങ്ങളുടെ കണക്കിൽ നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "balanceInr")} അടയ്ക്കാനുണ്ട്. WhatsApp-ൽ പണമടയ്ക്കാനുള്ള ഓർമ്മപ്പെടുത്തലുകൾ അയയ്ക്കട്ടെ? YES എന്ന് മറുപടി നൽകുക, അല്ലെങ്കിൽ STOP എന്ന് മറുപടി നൽകിയാൽ ഞങ്ങൾ സന്ദേശം അയയ്ക്കില്ല.`,
  credit_consent_yes: (f) => `നന്ദി. നിങ്ങളുടെ അക്കൗണ്ടിൽ എന്തെങ്കിലും ബാക്കിയുള്ളിടത്തോളം ${f.businessName} ഇടയ്ക്ക് ഓർമ്മപ്പെടുത്തൽ അയയ്ക്കും. നിർത്താൻ എപ്പോൾ വേണമെങ്കിലും STOP എന്ന് മറുപടി നൽകുക.`,
  credit_reminder: (f) => `നമസ്കാരം ${name(f)}, ${f.businessName}-ൽ നിന്നുള്ള ഓർമ്മപ്പെടുത്തൽ: നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്. ഇവിടെ അടയ്ക്കാം: ${payTo(f)} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  credit_received: (f) => `നന്ദി! നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "receivedInr")} അടച്ചതായി ${f.businessName} രേഖപ്പെടുത്തി. ഇനി ഒന്നും അടയ്ക്കാനില്ല. നിങ്ങളുടെ രസീത് നമ്പർ ${ref(f)} ആണ്.`,
  credit_part_received: (f) => `നന്ദി! നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "receivedInr")} അടച്ചതായി ${f.businessName} രേഖപ്പെടുത്തി. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്: ${payTo(f)} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  credit_pay_link: (f) => `${f.businessName}-ലെ നിങ്ങളുടെ അക്കൗണ്ടിലെ ${inr(f, "balanceInr")} ഇവിടെ അടയ്ക്കാം: ${payTo(f)}`,
  credit_already_paid: (f) => `ഞങ്ങളുടെ രേഖയിൽ നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "paidInr")} അടച്ചതായി കാണുന്നു, ഇനി ഒന്നും അടയ്ക്കാനില്ല. നന്ദി.`,
  credit_claim_partial: (f) => `ഞങ്ങളുടെ രേഖയിൽ നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "paidInr")} അടച്ചതായി കാണുന്നു, അതിനാൽ ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്. ബാക്കി ഇവിടെ അടയ്ക്കാം: ${payTo(f)}`,
  credit_claim_not_found: (f) => `നിങ്ങളുടെ അക്കൗണ്ടിൽ ഇതുവരെ ഒരു പേയ്മെന്റും കാണുന്നില്ല. ഇപ്പോൾ അടച്ചതാണെങ്കിൽ കാണാൻ കുറച്ച് മിനിറ്റ് എടുക്കാം. ഉടമയോട് പരിശോധിക്കാൻ പറഞ്ഞിട്ടുണ്ട്. അടവ് നടന്നില്ലെങ്കിൽ ഇവിടെ അടയ്ക്കാം: ${payTo(f)}`,
  credit_upi_claim: () => "നന്ദി. ഉടമ അവരുടെ UPI ആപ്പിൽ നിങ്ങളുടെ പേയ്മെന്റ് നോക്കി ഉറപ്പാക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയയ്ക്കും. സ്ക്രീൻഷോട്ട് പേയ്മെന്റിന്റെ തെളിവല്ല, അതിനാൽ ആ സന്ദേശത്തിനായി കാത്തിരിക്കുക.",
  credit_menu: (f) => `നമസ്കാരം! ഇത് ${f.businessName} ആണ്. നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "balanceInr")} അടയ്ക്കാനുണ്ട്. എന്താണ് ചെയ്യേണ്ടത്?`,
  credit_discount_to_owner: () => "ബാക്കി തുക എനിക്ക് സ്വയം മാറ്റാൻ കഴിയില്ല. നിങ്ങൾ ചോദിച്ചതായി ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ സന്ദേശം അയയ്ക്കും.",
  credit_request_waiting: () => "നിങ്ങളുടെ അക്കൗണ്ടിനെക്കുറിച്ച് ഉടമയോട് ഇതിനകം ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ ലഭിക്കും.",
  credit_refund_asked: (f) => `നിങ്ങളുടെ അക്കൗണ്ടിൽ അടച്ച ${inr(f, "paidInr")}-ൽ നിന്ന് ${inr(f, "refundInr")} തിരികെ നൽകുന്നതിനെക്കുറിച്ച് ഉടമയോട് ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ ലഭിക്കും.`,
  credit_refund_too_much: (f) => `ഞങ്ങളുടെ രേഖയിൽ നിങ്ങളുടെ അക്കൗണ്ടിൽ ${inr(f, "paidInr")} അടച്ചതായി കാണുന്നു, അതിൽ കൂടുതലുള്ള അഭ്യർത്ഥന എനിക്ക് കൈമാറാൻ കഴിയില്ല. തിരികെ വേണ്ട തുക പറയൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ.`,
  credit_refund_none: () => "നിങ്ങളുടെ അക്കൗണ്ടിൽ ഒരു പേയ്മെന്റും രേഖപ്പെടുത്തിയിട്ടില്ല, അതിനാൽ തിരികെ നൽകാൻ ഒന്നുമില്ല.",
  credit_upi_qr_caption: (f) => `${payee(f)}-ന് UPI വഴി ${inr(f, "balanceInr")} അടയ്ക്കാൻ സ്കാൻ ചെയ്യുക (${ref(f)}).`,
  credit_upi_refund_owed: (f) => `ഉടമ ${inr(f, "refundInr")} UPI വഴി നിങ്ങൾക്ക് തിരികെ അയയ്ക്കും. അയച്ചതായി അവർ രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയയ്ക്കും.`,
  credit_upi_refund_sent: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് (${ref(f)}) UPI വഴി അയച്ചതായി ഉടമ രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ.`,
  credit_chat_public: () => "ഈ ചാറ്റ് കടയെക്കുറിച്ചുള്ള ചോദ്യങ്ങൾക്ക് മറുപടി നൽകുന്നു. ഉടമയെ ബന്ധപ്പെടാൻ താഴെയുള്ള ബട്ടൺ അമർത്തുക.",
  credit_paused: (f) => `ഓൺലൈൻ പണമടയ്ക്കൽ തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
  credit_wait_over: (f) => `ക്ഷമിക്കണം, നിങ്ങളുടെ അഭ്യർത്ഥന പൂർത്തിയാക്കാൻ കഴിഞ്ഞില്ല: കടയുടെ സംവിധാനം ഇപ്പോൾ പ്രതികരിക്കുന്നില്ല. നിങ്ങളുടെ സന്ദേശം ഉടമയുടെ ചെയ്യാനുള്ള കാര്യങ്ങളുടെ പട്ടികയിലുണ്ട്. ദയവായി പിന്നീട് വീണ്ടും എഴുതൂ, അല്ലെങ്കിൽ ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,

  owner_credit_added: (f) => `കണക്കിൽ എഴുതി: ${name(f)} (${phone(f)}) ആകെ ${inr(f, "balanceInr")} തരാനുണ്ട്. നിങ്ങൾ Ask അമർത്തുകയോ "ask ${name(f)}" എന്ന് മറുപടി നൽകുകയോ ചെയ്യുന്നതുവരെ അവർക്ക് ഒന്നും അയയ്ക്കില്ല.`,
  owner_credit_added_known: (f) => `കണക്കിൽ എഴുതി: ${name(f)} ആകെ ${inr(f, "balanceInr")} തരാനുണ്ട്.`,
  owner_credit_need_number: (f) => `ഇതുവരെ എഴുതിയിട്ടില്ല: ${name(f)}-ന്റെ WhatsApp നമ്പർ പേരിനൊപ്പം അയയ്ക്കൂ. നമ്പർ കടയിൽ മാത്രം നിൽക്കും.`,
  owner_credit_asked: (f) => `WhatsApp ഓർമ്മപ്പെടുത്തലുകൾ ശരിയാണോ എന്ന് ${name(f)} (${phone(f)})-നോട് ചോദിച്ചു. അവർ സമ്മതിച്ചതിനു ശേഷം മാത്രമേ ഓർമ്മപ്പെടുത്തലുകൾ തുടങ്ങൂ.`,
  owner_credit_already_asked: (f) => `${name(f)}-നോട് ഇതിനകം ചോദിച്ചു. അവർ സമ്മതിച്ചതിനു ശേഷം മാത്രമേ ഓർമ്മപ്പെടുത്തലുകൾ തുടങ്ങൂ.`,
  owner_credit_already_yes: (f) => `${name(f)} ഇതിനകം WhatsApp ഓർമ്മപ്പെടുത്തലുകൾക്ക് സമ്മതിച്ചു.`,
  owner_credit_stopped: (f) => `${name(f)} STOP അയച്ചിരുന്നു, അതിനാൽ അവർക്ക് ഇനി ഒന്നും അയയ്ക്കില്ല.`,
  owner_credit_yes: (f) => `കണക്ക്: ${name(f)} (${phone(f)}) WhatsApp ഓർമ്മപ്പെടുത്തലുകൾക്ക് സമ്മതിച്ചു. എന്തെങ്കിലും ബാക്കിയുണ്ടെങ്കിൽ ആദ്യത്തേത് കുറച്ച് ദിവസത്തിനുള്ളിൽ പോകും.`,
  owner_credit_paid: (f) => `നിങ്ങളുടെ അടയാളത്തിൽ അടച്ചതായി രേഖപ്പെടുത്തി: ${name(f)} ${inr(f, "receivedInr")} തന്നു. ${inr(f, "balanceInr")} ഇനിയും തരാനുണ്ട്.`,
  owner_credit_cleared: (f) => `നിങ്ങളുടെ അടയാളത്തിൽ അടച്ചതായി രേഖപ്പെടുത്തി: ${name(f)} ${inr(f, "receivedInr")} തന്നു. ഇനി ഒന്നും തരാനില്ല.`,
  owner_credit_paid_too_much: (f) => `എഴുതിയില്ല: ${name(f)} ${inr(f, "balanceInr")} മാത്രമേ തരാനുള്ളൂ. തുക വീണ്ടും അയയ്ക്കൂ.`,
  owner_credit_nothing_owed: (f) => `കണക്കിൽ ${name(f)} ഒന്നും തരാനില്ല.`,
  owner_credit_unknown_person: (f) => `${name(f)} കണക്കിലില്ല. ചേർക്കാൻ അവരുടെ പേരും "owes" എന്നും തുകയും എഴുതൂ.`,
  owner_credit_too_much: (f) => `എഴുതിയില്ല: ഒരു അക്കൗണ്ടിൽ പരമാവധി ${inr(f, "feeInr")} മാത്രമേ കാണിക്കാവൂ, ${name(f)}-ന്റേത് അതിൽ കൂടും.`,
  owner_credit_list: (f) => `ആര് എത്ര തരാനുണ്ട്: ${need(f, "roster")}`,
  owner_credit_list_empty: () => "കണക്കിൽ ആരും ഒന്നും തരാനില്ല.",
  owner_credit_number_owner: (f) => `അത് നിങ്ങളുടെ സ്വന്തം നമ്പറാണ്. ${name(f)}-ന്റെ WhatsApp നമ്പർ അയയ്ക്കൂ.`,
  owner_credit_number_taken: () => "ആ നമ്പർ കണക്കിൽ ഇതിനകം മറ്റൊരാളുടെ അക്കൗണ്ടാണ്. ഒരു നമ്പർ ഒരു അക്കൗണ്ട്.",
  owner_credit_help: () => `കണക്കിനായി ഒരു പേരിനൊപ്പം "owes" അല്ലെങ്കിൽ "paid" എന്നും തുകയും എഴുതൂ, പട്ടികയ്ക്ക് "who owes", ഓർമ്മപ്പെടുത്തലുകളെക്കുറിച്ച് ചോദിക്കാൻ "ask" എന്നും പേരും. നമ്പർ കടയിൽ മാത്രം സൂക്ഷിക്കും.`,
  owner_credit_wrote: (f) => `കണക്ക്: ഓർമ്മപ്പെടുത്തലുകൾക്ക് സമ്മതിക്കുന്നതിന് മുമ്പ് ${name(f)} (${phone(f)}) കടയിലേക്ക് എഴുതി, അതിനാൽ അവർക്ക് ഒന്നും അയച്ചില്ല. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_credit_claim: (f) => `കണക്ക്: ${name(f)} (${phone(f)}) അടച്ചു എന്ന് പറയുന്നു, പക്ഷേ പേയ്മെന്റ് രേഖയിൽ ${inr(f, "paidInr")} ആണ് കാണുന്നത്. ദയവായി പരിശോധിച്ച് അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_credit_upi_claim: (f) => `കണക്ക്: ${name(f)} (${phone(f)}) അടച്ചു എന്ന് പറയുന്നു. സ്ക്രീൻഷോട്ട് തെളിവല്ല: നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ. അത് അവിടെ ഉണ്ടെങ്കിൽ Received അമർത്തുക അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി നൽകുക.`,
  owner_credit_upi_expected: (f) => `പരിശോധിക്കാനുള്ള UPI പേയ്മെന്റ്: ${name(f)} (${phone(f)})-നോട് ${inr(f, "balanceInr")} ചോദിച്ചിട്ടുണ്ട് (${ref(f)}). നിങ്ങളുടെ UPI ആപ്പിൽ കാണുമ്പോൾ Received അമർത്തുക അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി നൽകുക. മറ്റൊരു തുകയാണ് വന്നതെങ്കിൽ "received ${code(f)}" എന്നും തുകയും എഴുതൂ.`,
  owner_credit_upi_marked: (f) => `നന്ദി. ${name(f)}-ന്റെ അക്കൗണ്ടിൽ ${inr(f, "receivedInr")} നിങ്ങൾ അടച്ചതായി രേഖപ്പെടുത്തി.`,
  owner_credit_upi_part: (f) => `നന്ദി. ${name(f)}-ന്റെ അക്കൗണ്ടിൽ ${inr(f, "receivedInr")} നിങ്ങൾ അടച്ചതായി രേഖപ്പെടുത്തി. ${inr(f, "balanceInr")} ഇനിയും തരാനുണ്ട്; അത് വരുമ്പോൾ Received അമർത്തുക അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി നൽകുക.`,
  owner_credit_link_failed: (f) => `${name(f)}-ന്റെ അക്കൗണ്ടിന് (${phone(f)}) പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ അയച്ചില്ല. അടുത്ത ഓർമ്മപ്പെടുത്തലിലോ അവർ വീണ്ടും ചോദിക്കുമ്പോഴോ വീണ്ടും ശ്രമിക്കും. ഇത് ആവർത്തിച്ചാൽ നിങ്ങളുടെ പേയ്മെന്റ് അക്കൗണ്ട് നോക്കൂ, അല്ലെങ്കിൽ ഏജന്റ് സജ്ജമാക്കിയ ആളെ അറിയിക്കൂ.`,
  owner_credit_discount_note: (f) => `കണക്ക്: ${name(f)} (${phone(f)}) തരാനുള്ള തുകയിൽ (${inr(f, "balanceInr")}) കിഴിവ് ചോദിച്ചു. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ. ഒന്നും മാറ്റിയിട്ടില്ല.`,
  owner_credit_refund_request: (f) => `അനുമതി വേണം: ${name(f)} (${phone(f)}) അവരുടെ അക്കൗണ്ടിൽ അടച്ച ${inr(f, "paidInr")}-ൽ നിന്ന് ${inr(f, "refundInr")} തിരികെ ചോദിക്കുന്നു. "approve ${req(f)}" അല്ലെങ്കിൽ "deny ${req(f)}" എന്ന് മറുപടി നൽകുക.`,
  owner_credit_overpayment: (f) => `കണക്ക്: ${name(f)} (${phone(f)}) തരാനുള്ളതിൽ കൂടുതൽ അടച്ചു. അധികമുള്ള ${inr(f, "refundInr")} തിരികെ നൽകുന്നു.`,
  owner_credit_opted_out: (f) => `കണക്ക്: ${name(f)} (${phone(f)}) STOP അയച്ചു. അവർക്ക് ഇനി സന്ദേശങ്ങൾ പോകില്ല.`,
  owner_credit_wants_to_talk: (f) => `കണക്ക്: ${name(f)} (${phone(f)}) നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_credit_request_stale: (f) => `ചെയ്തില്ല: നിങ്ങളോട് ചോദിച്ചതിനു ശേഷം ${name(f)}-ന്റെ അക്കൗണ്ട് (${phone(f)}) മാറി, അതിനാൽ ഒന്നും പ്രയോഗിച്ചില്ല.`,
  owner_credit_upi_refund_owed: (f) => `അയയ്ക്കാനുള്ള റീഫണ്ട്: ${inr(f, "refundInr")} UPI വഴി ${name(f)} (${phone(f)})-ന്. ഏജന്റ് ഒരിക്കലും പണം അയയ്ക്കില്ല. അയച്ചു കഴിഞ്ഞാൽ Refund sent അമർത്തുക അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി നൽകുക.`,
  owner_credit_upi_refund_reminder: (f) => `ഓർമ്മപ്പെടുത്തൽ: ${name(f)} (${phone(f)})-ന് ${inr(f, "refundInr")} ഇനിയും തിരികെ നൽകാനുണ്ട്. UPI വഴി അയച്ചു കഴിഞ്ഞാൽ Refund sent അമർത്തുക അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി നൽകുക.`,
  owner_credit_upi_refund_marked: (f) => `നന്ദി. ${name(f)}-നുള്ള ${inr(f, "refundInr")} റീഫണ്ട് അയച്ചതായി രേഖപ്പെടുത്തി, അവരെ അറിയിച്ചിട്ടുണ്ട്.`,
};

const kn: Set = {
  credit_consent_ask: (f) => `ನಮಸ್ಕಾರ ${name(f)}, ಇದು ${f.businessName}. ನಮ್ಮ ಲೆಕ್ಕದಲ್ಲಿ ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "balanceInr")} ಪಾವತಿಸಲು ಬಾಕಿ ಇದೆ. WhatsApp-ನಲ್ಲಿ ಪಾವತಿಯ ನೆನಪುಗಳನ್ನು ಕಳುಹಿಸಬಹುದೇ? YES ಎಂದು ಉತ್ತರಿಸಿ, ಅಥವಾ STOP ಎಂದು ಉತ್ತರಿಸಿದರೆ ನಾವು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  credit_consent_yes: (f) => `ಧನ್ಯವಾದ. ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ಏನಾದರೂ ಬಾಕಿ ಇರುವವರೆಗೆ ${f.businessName} ಆಗಾಗ ನೆನಪು ಕಳುಹಿಸುತ್ತದೆ. ನಿಲ್ಲಿಸಲು ಯಾವಾಗ ಬೇಕಾದರೂ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  credit_reminder: (f) => `ನಮಸ್ಕಾರ ${name(f)}, ${f.businessName} ಕಡೆಯಿಂದ ನೆನಪು: ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "balanceInr")} ಇನ್ನೂ ಪಾವತಿಸಲು ಬಾಕಿ ಇದೆ. ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  credit_received: (f) => `ಧನ್ಯವಾದ! ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "receivedInr")} ಪಾವತಿಯಾಗಿದೆ ಎಂದು ${f.businessName} ದಾಖಲಿಸಿದೆ. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ. ನಿಮ್ಮ ರಸೀದಿ ಸಂಖ್ಯೆ ${ref(f)}.`,
  credit_part_received: (f) => `ಧನ್ಯವಾದ! ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "receivedInr")} ಪಾವತಿಯಾಗಿದೆ ಎಂದು ${f.businessName} ದಾಖಲಿಸಿದೆ. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ: ${payTo(f)} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  credit_pay_link: (f) => `${f.businessName}-ನಲ್ಲಿ ನಿಮ್ಮ ಖಾತೆಯ ${inr(f, "balanceInr")} ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)}`,
  credit_already_paid: (f) => `ನಮ್ಮ ದಾಖಲೆಯಲ್ಲಿ ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "paidInr")} ಪಾವತಿಯಾಗಿದೆ, ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ. ಧನ್ಯವಾದ.`,
  credit_claim_partial: (f) => `ನಮ್ಮ ದಾಖಲೆಯಲ್ಲಿ ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "paidInr")} ಪಾವತಿಯಾಗಿದೆ, ಆದ್ದರಿಂದ ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ. ಉಳಿದದ್ದನ್ನು ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)}`,
  credit_claim_not_found: (f) => `ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ಇನ್ನೂ ಯಾವುದೇ ಪಾವತಿ ಕಾಣುತ್ತಿಲ್ಲ. ಈಗಷ್ಟೇ ಪಾವತಿಸಿದ್ದರೆ ಕಾಣಲು ಕೆಲವು ನಿಮಿಷ ಆಗಬಹುದು. ಪರಿಶೀಲಿಸಲು ಮಾಲೀಕರಿಗೆ ಹೇಳಿದ್ದೇನೆ. ಪಾವತಿ ಆಗದಿದ್ದರೆ ಇಲ್ಲಿ ಪಾವತಿಸಬಹುದು: ${payTo(f)}`,
  credit_upi_claim: () => "ಧನ್ಯವಾದ. ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನಿಮ್ಮ ಪಾವತಿಯನ್ನು ನೋಡಿ ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪಾವತಿಯ ಪುರಾವೆ ಅಲ್ಲ, ದಯವಿಟ್ಟು ಆ ಸಂದೇಶಕ್ಕಾಗಿ ಕಾಯಿರಿ.",
  credit_menu: (f) => `ನಮಸ್ಕಾರ! ಇದು ${f.businessName}. ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "balanceInr")} ಪಾವತಿಸಲು ಬಾಕಿ ಇದೆ. ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?`,
  credit_discount_to_owner: () => "ಬಾಕಿ ಮೊತ್ತವನ್ನು ನಾನೇ ಬದಲಿಸಲು ಆಗುವುದಿಲ್ಲ. ನೀವು ಕೇಳಿದ್ದನ್ನು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲೇ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.",
  credit_request_waiting: () => "ನಿಮ್ಮ ಖಾತೆಯ ಬಗ್ಗೆ ಮಾಲೀಕರನ್ನು ಈಗಾಗಲೇ ಕೇಳಲಾಗಿದೆ. ಉತ್ತರ ನಿಮಗೆ ಇಲ್ಲೇ ಸಿಗುತ್ತದೆ.",
  credit_refund_asked: (f) => `ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ನೀವು ಪಾವತಿಸಿದ ${inr(f, "paidInr")} ರಲ್ಲಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿಸುವ ಬಗ್ಗೆ ಮಾಲೀಕರನ್ನು ಕೇಳಿದ್ದೇನೆ. ಉತ್ತರ ನಿಮಗೆ ಇಲ್ಲೇ ಸಿಗುತ್ತದೆ.`,
  credit_refund_too_much: (f) => `ನಮ್ಮ ದಾಖಲೆಯಲ್ಲಿ ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${inr(f, "paidInr")} ಪಾವತಿಯಾಗಿದೆ, ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಕೋರಿಕೆಯನ್ನು ನಾನು ಮುಂದೆ ಕಳುಹಿಸಲು ಆಗುವುದಿಲ್ಲ. ಎಷ್ಟು ಹಿಂತಿರುಗಬೇಕು ಎಂದು ಹೇಳಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.`,
  credit_refund_none: () => "ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ಯಾವುದೇ ಪಾವತಿ ದಾಖಲಾಗಿಲ್ಲ, ಆದ್ದರಿಂದ ಹಿಂತಿರುಗಿಸಲು ಏನೂ ಇಲ್ಲ.",
  credit_upi_qr_caption: (f) => `${payee(f)} ಅವರಿಗೆ UPI ಮೂಲಕ ${inr(f, "balanceInr")} ಪಾವತಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ (${ref(f)}).`,
  credit_upi_refund_owed: (f) => `ಮಾಲೀಕರು ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ನಿಮಗೆ ಹಿಂತಿರುಗಿಸುತ್ತಾರೆ. ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  credit_upi_refund_sent: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ (${ref(f)}) UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ಮಾಲೀಕರು ದಾಖಲಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ.`,
  credit_chat_public: () => "ಈ ಚಾಟ್ ಅಂಗಡಿಯ ಬಗ್ಗೆ ಪ್ರಶ್ನೆಗಳಿಗೆ ಉತ್ತರಿಸುತ್ತದೆ. ಮಾಲೀಕರನ್ನು ತಲುಪಲು ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ.",
  credit_paused: (f) => `ಆನ್‌ಲೈನ್ ಪಾವತಿ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನೇರವಾಗಿ ${f.businessName} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  credit_wait_over: (f) => `ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಆಗಲಿಲ್ಲ: ಅಂಗಡಿಯ ವ್ಯವಸ್ಥೆ ಈಗ ಪ್ರತಿಕ್ರಿಯಿಸುತ್ತಿಲ್ಲ. ನಿಮ್ಮ ಸಂದೇಶ ಮಾಲೀಕರ ಮಾಡಬೇಕಾದ ಕೆಲಸಗಳ ಪಟ್ಟಿಯಲ್ಲಿದೆ. ದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಬರೆಯಿರಿ, ಅಥವಾ ನೇರವಾಗಿ ${f.businessName} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,

  owner_credit_added: (f) => `ಲೆಕ್ಕದಲ್ಲಿ ಬರೆಯಲಾಗಿದೆ: ${name(f)} (${phone(f)}) ಒಟ್ಟು ${inr(f, "balanceInr")} ಕೊಡಬೇಕು. ನೀವು Ask ಒತ್ತುವವರೆಗೆ ಅಥವಾ "ask ${name(f)}" ಎಂದು ಉತ್ತರಿಸುವವರೆಗೆ ಅವರಿಗೆ ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  owner_credit_added_known: (f) => `ಲೆಕ್ಕದಲ್ಲಿ ಬರೆಯಲಾಗಿದೆ: ${name(f)} ಒಟ್ಟು ${inr(f, "balanceInr")} ಕೊಡಬೇಕು.`,
  owner_credit_need_number: (f) => `ಇನ್ನೂ ಬರೆದಿಲ್ಲ: ${name(f)} ಅವರ WhatsApp ಸಂಖ್ಯೆಯನ್ನು ಅವರ ಹೆಸರಿನೊಂದಿಗೆ ಕಳುಹಿಸಿ. ಸಂಖ್ಯೆ ಅಂಗಡಿಯಲ್ಲೇ ಇರುತ್ತದೆ.`,
  owner_credit_asked: (f) => `WhatsApp ನೆನಪುಗಳು ಸರಿಯೇ ಎಂದು ${name(f)} (${phone(f)}) ಅವರನ್ನು ಕೇಳಲಾಗಿದೆ. ಅವರು ಒಪ್ಪಿದ ನಂತರವೇ ನೆನಪುಗಳು ಶುರುವಾಗುತ್ತವೆ.`,
  owner_credit_already_asked: (f) => `${name(f)} ಅವರನ್ನು ಈಗಾಗಲೇ ಕೇಳಲಾಗಿದೆ. ಅವರು ಒಪ್ಪಿದ ನಂತರವೇ ನೆನಪುಗಳು ಶುರುವಾಗುತ್ತವೆ.`,
  owner_credit_already_yes: (f) => `${name(f)} ಈಗಾಗಲೇ WhatsApp ನೆನಪುಗಳಿಗೆ ಒಪ್ಪಿದ್ದಾರೆ.`,
  owner_credit_stopped: (f) => `${name(f)} STOP ಕಳುಹಿಸಿದ್ದರು, ಆದ್ದರಿಂದ ಅವರಿಗೆ ಇನ್ನೇನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  owner_credit_yes: (f) => `ಲೆಕ್ಕ: ${name(f)} (${phone(f)}) WhatsApp ನೆನಪುಗಳಿಗೆ ಒಪ್ಪಿದ್ದಾರೆ. ಏನಾದರೂ ಬಾಕಿ ಇದ್ದರೆ ಮೊದಲನೆಯದು ಕೆಲವು ದಿನಗಳಲ್ಲಿ ಹೋಗುತ್ತದೆ.`,
  owner_credit_paid: (f) => `ನಿಮ್ಮ ಗುರುತಿನಿಂದ ಪಾವತಿ ದಾಖಲಾಗಿದೆ: ${name(f)} ${inr(f, "receivedInr")} ಕೊಟ್ಟರು. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ.`,
  owner_credit_cleared: (f) => `ನಿಮ್ಮ ಗುರುತಿನಿಂದ ಪಾವತಿ ದಾಖಲಾಗಿದೆ: ${name(f)} ${inr(f, "receivedInr")} ಕೊಟ್ಟರು. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ.`,
  owner_credit_paid_too_much: (f) => `ದಾಖಲಿಸಿಲ್ಲ: ${name(f)} ಕೇವಲ ${inr(f, "balanceInr")} ಕೊಡಬೇಕು. ಮೊತ್ತವನ್ನು ಮತ್ತೆ ಕಳುಹಿಸಿ.`,
  owner_credit_nothing_owed: (f) => `ಲೆಕ್ಕದಲ್ಲಿ ${name(f)} ಏನೂ ಕೊಡಬೇಕಿಲ್ಲ.`,
  owner_credit_unknown_person: (f) => `${name(f)} ಲೆಕ್ಕದಲ್ಲಿ ಇಲ್ಲ. ಸೇರಿಸಲು ಅವರ ಹೆಸರು, "owes" ಮತ್ತು ಮೊತ್ತ ಬರೆಯಿರಿ.`,
  owner_credit_too_much: (f) => `ದಾಖಲಿಸಿಲ್ಲ: ಒಂದು ಖಾತೆಯಲ್ಲಿ ಹೆಚ್ಚೆಂದರೆ ${inr(f, "feeInr")} ಇರಬಹುದು, ${name(f)} ಅವರದು ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಾಗುತ್ತದೆ.`,
  owner_credit_list: (f) => `ಯಾರು ಎಷ್ಟು ಕೊಡಬೇಕು: ${need(f, "roster")}`,
  owner_credit_list_empty: () => "ಲೆಕ್ಕದಲ್ಲಿ ಯಾರೂ ಏನೂ ಕೊಡಬೇಕಿಲ್ಲ.",
  owner_credit_number_owner: (f) => `ಅದು ನಿಮ್ಮದೇ ಸಂಖ್ಯೆ. ${name(f)} ಅವರ WhatsApp ಸಂಖ್ಯೆ ಕಳುಹಿಸಿ.`,
  owner_credit_number_taken: () => "ಆ ಸಂಖ್ಯೆ ಲೆಕ್ಕದಲ್ಲಿ ಈಗಾಗಲೇ ಇನ್ನೊಬ್ಬರ ಖಾತೆ. ಒಂದು ಸಂಖ್ಯೆ, ಒಂದು ಖಾತೆ.",
  owner_credit_help: () => `ಲೆಕ್ಕಕ್ಕಾಗಿ ಹೆಸರಿನೊಂದಿಗೆ "owes" ಅಥವಾ "paid" ಮತ್ತು ಮೊತ್ತ ಬರೆಯಿರಿ, ಪಟ್ಟಿಗೆ "who owes", ನೆನಪುಗಳ ಬಗ್ಗೆ ಕೇಳಲು "ask" ಮತ್ತು ಹೆಸರು. ಸಂಖ್ಯೆ ಅಂಗಡಿಯಲ್ಲೇ ಇರುತ್ತದೆ.`,
  owner_credit_wrote: (f) => `ಲೆಕ್ಕ: ನೆನಪುಗಳಿಗೆ ಒಪ್ಪುವ ಮೊದಲೇ ${name(f)} (${phone(f)}) ಅಂಗಡಿಗೆ ಬರೆದರು, ಆದ್ದರಿಂದ ಅವರಿಗೆ ಏನೂ ಕಳುಹಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_credit_claim: (f) => `ಲೆಕ್ಕ: ${name(f)} (${phone(f)}) ಪಾವತಿಸಿದ್ದೇವೆ ಎನ್ನುತ್ತಾರೆ, ಆದರೆ ಪಾವತಿ ದಾಖಲೆಯಲ್ಲಿ ${inr(f, "paidInr")} ಕಾಣುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_credit_upi_claim: (f) => `ಲೆಕ್ಕ: ${name(f)} (${phone(f)}) ಪಾವತಿಸಿದ್ದೇವೆ ಎನ್ನುತ್ತಾರೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ: ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ. ಅಲ್ಲಿ ಕಂಡರೆ Received ಒತ್ತಿ ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_credit_upi_expected: (f) => `ಪರಿಶೀಲಿಸಬೇಕಾದ UPI ಪಾವತಿ: ${name(f)} (${phone(f)}) ಅವರಿಂದ ${inr(f, "balanceInr")} ಕೇಳಲಾಗಿದೆ (${ref(f)}). ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಂಡಾಗ Received ಒತ್ತಿ ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ "received ${code(f)}" ಮತ್ತು ಮೊತ್ತ ಬರೆಯಿರಿ.`,
  owner_credit_upi_marked: (f) => `ಧನ್ಯವಾದ. ${name(f)} ಅವರ ಖಾತೆಯಲ್ಲಿ ${inr(f, "receivedInr")} ನೀವು ಪಾವತಿಯಾಗಿದೆ ಎಂದು ಗುರುತಿಸಿದ್ದೀರಿ.`,
  owner_credit_upi_part: (f) => `ಧನ್ಯವಾದ. ${name(f)} ಅವರ ಖಾತೆಯಲ್ಲಿ ${inr(f, "receivedInr")} ನೀವು ಪಾವತಿಯಾಗಿದೆ ಎಂದು ಗುರುತಿಸಿದ್ದೀರಿ. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ; ಬಂದಾಗ Received ಒತ್ತಿ ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_credit_link_failed: (f) => `${name(f)} ಅವರ ಖಾತೆಗೆ (${phone(f)}) ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಕಳುಹಿಸಿಲ್ಲ. ಮುಂದಿನ ನೆನಪಿನಲ್ಲಿ ಅಥವಾ ಅವರು ಮತ್ತೆ ಕೇಳಿದಾಗ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತದೆ. ಇದು ಮತ್ತೆ ಮತ್ತೆ ಆದರೆ ನಿಮ್ಮ ಪಾವತಿ ಖಾತೆ ನೋಡಿ ಅಥವಾ ಏಜೆಂಟ್ ಹೊಂದಿಸಿದವರಿಗೆ ತಿಳಿಸಿ.`,
  owner_credit_discount_note: (f) => `ಲೆಕ್ಕ: ${name(f)} (${phone(f)}) ಕೊಡಬೇಕಾದ ಮೊತ್ತದ (${inr(f, "balanceInr")}) ಮೇಲೆ ರಿಯಾಯಿತಿ ಕೇಳಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ. ಏನನ್ನೂ ಬದಲಿಸಿಲ್ಲ.`,
  owner_credit_refund_request: (f) => `ಅನುಮೋದನೆ ಬೇಕು: ${name(f)} (${phone(f)}) ತಮ್ಮ ಖಾತೆಯಲ್ಲಿ ಪಾವತಿಸಿದ ${inr(f, "paidInr")} ರಲ್ಲಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿ ಕೇಳುತ್ತಿದ್ದಾರೆ. "approve ${req(f)}" ಅಥವಾ "deny ${req(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_credit_overpayment: (f) => `ಲೆಕ್ಕ: ${name(f)} (${phone(f)}) ಕೊಡಬೇಕಾದುದಕ್ಕಿಂತ ಹೆಚ್ಚು ಪಾವತಿಸಿದ್ದಾರೆ. ಹೆಚ್ಚಿನ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿಸಲಾಗುತ್ತಿದೆ.`,
  owner_credit_opted_out: (f) => `ಲೆಕ್ಕ: ${name(f)} (${phone(f)}) STOP ಕಳುಹಿಸಿದ್ದಾರೆ. ಅವರಿಗೆ ಇನ್ನು ಸಂದೇಶಗಳು ಹೋಗುವುದಿಲ್ಲ.`,
  owner_credit_wants_to_talk: (f) => `ಲೆಕ್ಕ: ${name(f)} (${phone(f)}) ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_credit_request_stale: (f) => `ಆಗಲಿಲ್ಲ: ನಿಮ್ಮನ್ನು ಕೇಳಿದ ನಂತರ ${name(f)} ಅವರ ಖಾತೆ (${phone(f)}) ಬದಲಾಗಿದೆ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಅನ್ವಯಿಸಿಲ್ಲ.`,
  owner_credit_upi_refund_owed: (f) => `ಕಳುಹಿಸಬೇಕಾದ ರೀಫಂಡ್: ${inr(f, "refundInr")} UPI ಮೂಲಕ ${name(f)} (${phone(f)}) ಅವರಿಗೆ. ಏಜೆಂಟ್ ಎಂದಿಗೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಕಳುಹಿಸಿದ ನಂತರ Refund sent ಒತ್ತಿ ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_credit_upi_refund_reminder: (f) => `ನೆನಪು: ${name(f)} (${phone(f)}) ಅವರಿಗೆ ${inr(f, "refundInr")} ಇನ್ನೂ ಹಿಂತಿರುಗಿಸಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ನಂತರ Refund sent ಒತ್ತಿ ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_credit_upi_refund_marked: (f) => `ಧನ್ಯವಾದ. ${name(f)} ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ದಾಖಲಾಗಿದೆ, ಮತ್ತು ಅವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
};

export const CREDIT_TEMPLATES: Record<Language, Set> = { en, hi, ml, kn };

/**
 * The credit book's messages that go out on the agent's own, so often outside the 24-hour window (meta-templates.ts makes each a WhatsApp template): the first question (after the
 * owner's tap), the reminder, the receipts, and what the owner is told unasked. Every one starts and ends with fixed words, as Meta asks. [template name, the message it carries, who].
 */
export const CREDIT_META: readonly [string, CreditTemplateId, "customer" | "owner"][] = [
  ["credit_consent_ask", "credit_consent_ask", "customer"],
  ["credit_reminder", "credit_reminder", "customer"],
  ["credit_received", "credit_received", "customer"],
  ["credit_part_received", "credit_part_received", "customer"],
  ["owner_credit_said_yes", "owner_credit_yes", "owner"],
  ["owner_credit_wrote_first", "owner_credit_wrote", "owner"],
  ["owner_credit_claimed", "owner_credit_claim", "owner"],
  ["owner_credit_upi_claimed", "owner_credit_upi_claim", "owner"],
  ["owner_credit_upi_check", "owner_credit_upi_expected", "owner"],
  ["owner_credit_refund_asks", "owner_credit_refund_request", "owner"],
  ["owner_credit_stopped_msgs", "owner_credit_opted_out", "owner"],
  ["owner_credit_wants_you", "owner_credit_wants_to_talk", "owner"],
  ["owner_credit_overpaid", "owner_credit_overpayment", "owner"],
  ["owner_credit_discount_asked", "owner_credit_discount_note", "owner"],
  ["owner_credit_refund_owed", "owner_credit_upi_refund_owed", "owner"],
  ["owner_credit_refund_due", "owner_credit_upi_refund_reminder", "owner"],
  ["owner_credit_link_failed", "owner_credit_link_failed", "owner"],
];

/**
 * The words the OWNER writes to the credit book, in every language at once (an owner may mix them): read by the Go runtime's credit reader (go/internal/fees credit_read.go), which
 * builds each list with language.WordRe as the Fees rule parser builds FEE_WORDS, after language.Canon (lower case, the Indian scripts' digits as 0-9). Generated into
 * go/internal/fees/reading.json by go/scripts/gen_fees_words.ts; nothing is typed twice.
 *  - owes / paid: the word that makes "Ramesh owes 2,400" an entry and "Ramesh paid 1,000" the owner's mark; the name is the words left when the amount, the number and these are taken out
 *  - list: "who owes" and its words, the owner's list of who owes what
 *  - ask: "ask Ramesh", the typed twin of the owner's tap that sends the first question
 *  - filler: words taken out of a name ("ne", "par", "rs", "rupees"), so "रमेश ने 1000 दिए" names रमेश
 * "owes" is the credit book's own word; "paid" is read as the credit book's only for a name in the book, so another part of the same shop keeps its own words (decision 65).
 */
export const CREDIT_WORDS = {
  owes: ["owes", "owe", "has to pay", "to pay", "due", "udhaar", "udhar", "udhari", "baki", "baaki", "उधार", "उधारी", "बाकी", "बाक़ी", "देना है", "देने हैं", "തരാനുണ്ട്", "കടം", "ബാക്കി", "ಕೊಡಬೇಕು", "ಬಾಕಿ", "ಸಾಲ", "ಉದ್ರಿ"],
  paid: ["paid", "gave", "has paid", "jama", "diye", "diya", "दिए", "दिये", "दिया", "जमा", "चुकाए", "चुकाया", "भरे", "भरा", "തന്നു", "അടച്ചു", "നൽകി", "ಕೊಟ್ಟರು", "ಕೊಟ್ಟ", "ಕೊಟ್ಟಿದ್ದಾರೆ", "ಪಾವತಿಸಿದರು", "ಕಟ್ಟಿದರು"],
  list: ["who owes", "who owes what", "khata", "credit list", "udhaar list", "किस पर कितना", "कौन कितना", "खाता", "उधार सूची", "ആര് എത്ര", "കണക്ക്", "ಯಾರು ಎಷ್ಟು", "ಲೆಕ್ಕ", "ಖಾತೆ"],
  ask: ["ask", "पूछो", "पूछें", "ചോദിക്കൂ", "ಕೇಳಿ"],
  filler: ["rs", "rs.", "inr", "rupees", "rupaye", "₹", "has", "is", "ne", "par", "ka", "ki", "ke", "ko", "se", "ने", "पर", "का", "की", "के", "को", "से", "रुपये", "रुपए", "രൂപ", "ರೂಪಾಯಿ", "ರೂ"],
} as const;
