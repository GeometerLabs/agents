// Every message the Fees agent sends, per language. There is NO model-written text: each message is one of these templates, and every amount, date, student,
// batch and link in it is rendered from the record (the facts), never typed by hand and never translated. Adding a language means adding one more object below; the
// type makes sure none is missing. The Hindi, Malayalam and Kannada are machine-written: a native speaker must read them before a real centre sees them
// (REVIEW-ml.md and REVIEW-kn.md list every line).
import { formatDate, formatInr } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { localParts } from "../../../../modules/core/time.ts";

/** The values of this student-month's record that a message may use. The outgoing check reads the same object. */
export interface MessageFacts {
  language: Language;
  timeZone: string;
  businessName: string;
  studentName?: string;
  batchName?: string;
  /** "November 2026", in the parent's language. */
  monthLabel?: string;
  feeInr?: number;
  lateFeeInr?: number;
  /** What is still to pay, from the payment record. */
  balanceInr?: number;
  /** What the payment record shows paid. */
  paidInr?: number;
  /** The payment this message is about, when it is one payment. */
  receivedInr?: number;
  waiverInr?: number;
  refundInr?: number;
  /** The owner's waiver limit, for the note that a waiver was done within it. */
  waiverLimitInr?: number;
  /** The due date, at midnight in the centre's time zone. */
  dueMs?: number;
  graceDays?: number;
  /** The payment link from the payments service's record. */
  link?: string;
  /** The fee's reference, "f-3": also the receipt number. */
  dueRef?: string;
  /** The reference of a request waiting for the owner, "q-2". */
  requestRef?: string;
  customerPhone?: string;
  /** The one-use code the owner sends back to approve or deny a refund Guard is holding (never a reference). Made by the approvals relay. */
  approvalCode?: string;
  /** How many hours the owner has to answer. */
  approvalHours?: number;
}

export type TemplateId =
  // to the parent: the reminders, which go out on their own (each is also a WhatsApp template, fees/src/language/meta-templates.ts)
  | "fee_reminder" | "fee_overdue" | "fee_overdue_late" | "fee_received" | "fee_part_received"
  // to the parent: answers to what they wrote or tapped
  | "fee_pay_link" | "fee_already_paid" | "fee_claim_partial" | "fee_claim_not_found" | "fee_nothing_due"
  | "fee_waiver_asked" | "fee_waiver_applied" | "fee_waiver_cleared" | "fee_waiver_denied" | "fee_discount_to_owner" | "fee_request_waiting"
  | "fee_refund_asked" | "fee_refund_too_much" | "fee_refund_none" | "fee_refund_done" | "fee_refund_pending" | "fee_refund_checking" | "fee_refund_approved" | "fee_refund_denied" | "fee_refund_expired"
  | "fee_link_failed" | "fee_menu" | "fee_didnt_understand" | "fee_told_owner" | "fee_couldnt_tell_owner" | "voice_note"
  // to the owner. Every line starts and ends with fixed words, because each one that goes out unasked is also a WhatsApp template (meta-templates.ts) and
  // Meta rejects a body that starts or ends with a value. The one exception is the reply to the owner's own message, which needs no template.
  | "owner_waiver_request" | "owner_waiver_applied" | "owner_refund_request" | "owner_discount_note" | "owner_payment_claim" | "owner_overpayment" | "owner_link_failed" | "owner_request_stale"
  | "owner_message_held" | "owner_opted_out" | "owner_unknown_command" | "owner_wants_to_talk"
  // button mode: the agent reads with the rules only and answers with buttons (modules/understanding/ai-state.ts). Each says why, and that every limit still holds.
  | "owner_ai_allowance" | "owner_ai_off" | "owner_ai_fault"
  // sent by the approvals relay, not by the agent: the ask for a refund Guard is holding, and the answers to the owner's reply
  | "owner_refund_needs_approval" | "owner_approval_done" | "owner_approval_denied" | "owner_approval_expired" | "owner_approval_failed";

/** Which approved WhatsApp template carries a message once the parent's 24-hour window has closed and no exact template fits. */
export const TEMPLATE_NAMES = { customer: "fee_update", reminder: "fee_reminder_notice", owner: "owner_notice" } as const;

type Template = (f: MessageFacts) => string;
type TemplateSet = Record<TemplateId, Template>;

/** A template asks for a value the record does not have: refuse to write the message at all. */
export function need<K extends keyof MessageFacts>(f: MessageFacts, key: K): NonNullable<MessageFacts[K]> {
  const value = f[key];
  if (value === undefined) throw new Error(`The message needs "${String(key)}" from the record, and the record does not have it.`);
  return value as NonNullable<MessageFacts[K]>;
}
type Money = "feeInr" | "lateFeeInr" | "balanceInr" | "paidInr" | "receivedInr" | "waiverInr" | "refundInr" | "waiverLimitInr";
export const inr = (f: MessageFacts, key: Money) => formatInr(need(f, key));
export const dueDate = (f: MessageFacts) => formatDate(localParts(need(f, "dueMs"), f.timeZone), f.language);

const en: TemplateSet = {
  fee_reminder: (f) => `Fee reminder from ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} is ${inr(f, "balanceInr")}, due on ${dueDate(f)}. Pay here: ${need(f, "link")} Reply STOP if you do not want these reminders.`,
  fee_overdue: (f) => `Fee reminder from ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} was due on ${dueDate(f)}. ${inr(f, "balanceInr")} is still to pay: ${need(f, "link")} Reply STOP if you do not want these reminders.`,
  fee_overdue_late: (f) => `Fee reminder from ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} was due on ${dueDate(f)}. A late fee of ${inr(f, "lateFeeInr")} has been added, so ${inr(f, "balanceInr")} is still to pay: ${need(f, "link")} Reply STOP if you do not want these reminders.`,
  fee_received: (f) => `Thank you! ${f.businessName} has received ${inr(f, "receivedInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. Nothing more is due. Your receipt number is ${need(f, "dueRef")}.`,
  fee_part_received: (f) => `Thank you! ${f.businessName} has received ${inr(f, "receivedInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. ${inr(f, "balanceInr")} is still to pay. Pay the rest here: ${need(f, "link")} Reply STOP if you do not want these reminders.`,
  fee_pay_link: (f) => `Pay ${inr(f, "balanceInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} here: ${need(f, "link")}`,
  fee_already_paid: (f) => `Yes, we can see your payment of ${inr(f, "paidInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. Nothing more is due. Thank you.`,
  fee_claim_partial: (f) => `We can see ${inr(f, "paidInr")} paid for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}, so ${inr(f, "balanceInr")} is still to pay. Pay the rest here: ${need(f, "link")}`,
  fee_claim_not_found: (f) => `We cannot see a payment yet for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. If you paid just now, it can take a few minutes to show. I have asked the owner to check. If it did not go through, you can pay here: ${need(f, "link")}`,
  fee_nothing_due: () => "Nothing is due from you right now. Thank you!",
  fee_waiver_asked: (f) => `I cannot change the fee myself. I have asked the owner about taking ${inr(f, "waiverInr")} off ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. You will hear back here.`,
  fee_waiver_applied: (f) => `Done. ${inr(f, "waiverInr")} is taken off ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. ${inr(f, "balanceInr")} is now to pay: ${need(f, "link")}`,
  fee_waiver_cleared: (f) => `Done. ${inr(f, "waiverInr")} is taken off ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. Nothing more is due.`,
  fee_waiver_denied: (f) => `The owner has decided not to change ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. ${inr(f, "balanceInr")} is still to pay: ${need(f, "link")}`,
  fee_discount_to_owner: (f) => `I cannot change the fee myself. I have told the owner that you asked about ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. They will message you here.`,
  fee_request_waiting: (f) => `The owner has already been asked about ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. You will hear back here.`,
  fee_refund_asked: (f) => `I have asked the owner about refunding ${inr(f, "refundInr")} of the ${inr(f, "paidInr")} you paid for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. You will hear back here.`,
  fee_refund_too_much: (f) => `Our record shows ${inr(f, "paidInr")} paid for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}, so I cannot pass on a request for more than that. Tell me the amount you want back, or talk to the owner.`,
  fee_refund_none: (f) => `There is no payment on record for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}, so there is nothing to refund.`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} is being refunded to you.`,
  fee_refund_pending: (f) => `The owner will confirm your ${inr(f, "refundInr")} refund shortly.`,
  fee_refund_checking: (f) => `We are checking your ${inr(f, "refundInr")} refund and will message you as soon as it is confirmed.`,
  fee_refund_approved: (f) => `The owner approved your refund. ${inr(f, "refundInr")} is on its way.`,
  fee_refund_denied: () => "The owner has decided not to refund this payment.",
  fee_refund_expired: (f) => `The owner did not answer in time about your ${inr(f, "refundInr")} refund, so it has not been sent. Please contact ${f.businessName} directly.`,
  fee_link_failed: () => "Sorry, I could not make the payment link just now, so I have not sent it. I have told the owner. Please try again in a few minutes.",
  fee_menu: (f) => `Hello! This is ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}: ${inr(f, "balanceInr")} is to pay. What would you like to do?`,
  fee_didnt_understand: () => "Sorry, I did not understand. Please tap one of the buttons below, or talk to the owner.",
  fee_told_owner: () => "I have told the owner that you would like to talk. They will message you here.",
  fee_couldnt_tell_owner: () => "Sorry, I could not reach the owner just now. Please try again in a few minutes.",
  voice_note: () => "Please type your message; I cannot listen to voice notes yet.",

  owner_waiver_request: (f) => `Approval needed: ${need(f, "customerPhone")} asks to take ${inr(f, "waiverInr")} off ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. The fee is ${inr(f, "feeInr")} and ${inr(f, "balanceInr")} is to pay now. Reply "approve ${need(f, "requestRef")}" or "deny ${need(f, "requestRef")}".`,
  owner_waiver_applied: (f) => `Done within your ${inr(f, "waiverLimitInr")} limit: ${inr(f, "waiverInr")} taken off ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} (${need(f, "customerPhone")}). ${inr(f, "balanceInr")} is now to pay.`,
  owner_refund_request: (f) => `Approval needed: ${need(f, "customerPhone")} asks for ${inr(f, "refundInr")} back of the ${inr(f, "paidInr")} paid for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. Reply "approve ${need(f, "requestRef")}" or "deny ${need(f, "requestRef")}".`,
  owner_discount_note: (f) => `Parent ${need(f, "customerPhone")} asked for a discount on ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} (${inr(f, "feeInr")}) without saying how much. Please message them. Nothing was changed.`,
  owner_payment_claim: (f) => `Parent ${need(f, "customerPhone")} says they paid ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} (${inr(f, "feeInr")}), but the payment record shows ${inr(f, "paidInr")}. Please check and message them.`,
  owner_overpayment: (f) => `Parent ${need(f, "customerPhone")} paid more than was due for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. The extra ${inr(f, "refundInr")} is being refunded.`,
  owner_link_failed: (f) => `Could not make the payment link for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")} (${need(f, "customerPhone")}). No reminder went out. Please check Razorpay.`,
  owner_request_stale: (f) => `Not done: ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")} (${need(f, "customerPhone")}) changed since you were asked, so nothing was applied. If it still matters, the parent can ask again.`,
  owner_message_held: (f) => `A message to ${need(f, "customerPhone")} was held back because it did not match the fee record. Nothing was sent.`,
  owner_opted_out: (f) => `Parent ${need(f, "customerPhone")} sent STOP. No more messages will go to them.`,
  owner_unknown_command: () => `I did not understand that. Reply "approve" or "deny" followed by the request reference.`,
  owner_wants_to_talk: (f) => `Parent ${need(f, "customerPhone")} would like to talk to you. Please message them.`,
  owner_ai_allowance: (f) => `Notice: this month's AI allowance for ${f.businessName} is used up, so the agent now answers with buttons. It still sends reminders and takes payments, and every limit still holds. The person who set it up has been told. Normal service returns next month.`,
  owner_ai_off: (f) => `Notice: the AI that reads messages for ${f.businessName} has been switched off for now. The agent keeps working with buttons, and every limit still holds. The person who set it up has been told.`,
  owner_ai_fault: (f) => `Notice: the AI that reads messages for ${f.businessName} is not answering right now, so the agent is using buttons. It still sends reminders and takes payments, and every limit still holds. It will try the AI again in a few minutes.`,
  owner_refund_needs_approval: (f) => `Approval needed: refund ${inr(f, "refundInr")} for ${need(f, "customerPhone")} (${need(f, "studentName")}, ${need(f, "monthLabel")}). Reply "approve ${need(f, "approvalCode")}" or "deny ${need(f, "approvalCode")}" within ${need(f, "approvalHours")} hours.`,
  owner_approval_done: (f) => `Thank you. The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} is being sent, and they will be told.`,
  owner_approval_denied: (f) => `Understood. The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} will not be sent, and they will be told.`,
  owner_approval_expired: (f) => `That request ran out before you answered, so nothing was refunded: ${inr(f, "refundInr")} for ${need(f, "customerPhone")}.`,
  owner_approval_failed: () => "I could not record your answer just now. Please send it again in a few minutes.",
};

const hi: TemplateSet = {
  fee_reminder: (f) => `फीस की याद: ${f.businessName}। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस ${inr(f, "balanceInr")} है, देय तारीख ${dueDate(f)}। यहाँ भुगतान करें: ${need(f, "link")} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_overdue: (f) => `फीस की याद: ${f.businessName}। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस ${dueDate(f)} तक देनी थी। ${inr(f, "balanceInr")} अभी बाकी है: ${need(f, "link")} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_overdue_late: (f) => `फीस की याद: ${f.businessName}। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस ${dueDate(f)} तक देनी थी। ${inr(f, "lateFeeInr")} की देर की फीस जुड़ गई है, इसलिए ${inr(f, "balanceInr")} अभी बाकी है: ${need(f, "link")} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_received: (f) => `धन्यवाद! ${f.businessName} को ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "receivedInr")} मिल गए। अब कुछ बाकी नहीं है। आपकी रसीद संख्या ${need(f, "dueRef")} है।`,
  fee_part_received: (f) => `धन्यवाद! ${f.businessName} को ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "receivedInr")} मिल गए। ${inr(f, "balanceInr")} अभी बाकी है। बाकी यहाँ भरें: ${need(f, "link")} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_pay_link: (f) => `${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "balanceInr")} यहाँ भरें: ${need(f, "link")}`,
  fee_already_paid: (f) => `हाँ, ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस का ${inr(f, "paidInr")} का भुगतान हमें दिख रहा है। अब कुछ बाकी नहीं है। धन्यवाद।`,
  fee_claim_partial: (f) => `${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस में ${inr(f, "paidInr")} भरे दिख रहे हैं, इसलिए ${inr(f, "balanceInr")} अभी बाकी है। बाकी यहाँ भरें: ${need(f, "link")}`,
  fee_claim_not_found: (f) => `${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस का भुगतान अभी हमें नहीं दिख रहा। अगर अभी भरा है तो दिखने में कुछ मिनट लग सकते हैं। मैंने मालिक से जाँचने को कहा है। अगर भुगतान नहीं हुआ तो यहाँ भर सकते हैं: ${need(f, "link")}`,
  fee_nothing_due: () => "अभी आपकी ओर से कुछ बाकी नहीं है। धन्यवाद!",
  fee_waiver_asked: (f) => `फीस मैं खुद नहीं बदल सकता। मैंने मालिक से पूछा है कि ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम किए जाएँ या नहीं। जवाब यहीं मिलेगा।`,
  fee_waiver_applied: (f) => `हो गया। ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम कर दिए गए हैं। अब ${inr(f, "balanceInr")} भरने हैं: ${need(f, "link")}`,
  fee_waiver_cleared: (f) => `हो गया। ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम कर दिए गए हैं। अब कुछ बाकी नहीं है।`,
  fee_waiver_denied: (f) => `मालिक ने ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस न बदलने का फ़ैसला किया है। ${inr(f, "balanceInr")} अभी बाकी है: ${need(f, "link")}`,
  fee_discount_to_owner: (f) => `फीस मैं खुद नहीं बदल सकता। मैंने मालिक को बता दिया है कि आपने ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के बारे में पूछा है। वे आपको यहीं संदेश भेजेंगे।`,
  fee_request_waiting: (f) => `${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के बारे में मालिक से पहले ही पूछा जा चुका है। जवाब यहीं मिलेगा।`,
  fee_refund_asked: (f) => `मैंने मालिक से पूछा है कि ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के भरे हुए ${inr(f, "paidInr")} में से ${inr(f, "refundInr")} लौटाए जाएँ या नहीं। जवाब यहीं मिलेगा।`,
  fee_refund_too_much: (f) => `हमारे रिकॉर्ड में ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "paidInr")} भरे हैं, इसलिए इससे ज़्यादा की माँग मैं आगे नहीं भेज सकता। जितनी रकम वापस चाहिए वह बताइए, या मालिक से बात करें।`,
  fee_refund_none: (f) => `${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस का कोई भुगतान रिकॉर्ड में नहीं है, इसलिए लौटाने को कुछ नहीं है।`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} आपको लौटाए जा रहे हैं।`,
  fee_refund_pending: (f) => `मालिक जल्दी ही आपके ${inr(f, "refundInr")} के रिफंड की पुष्टि करेंगे।`,
  fee_refund_checking: (f) => `हम आपके ${inr(f, "refundInr")} के रिफंड की जाँच कर रहे हैं, पुष्टि होते ही आपको संदेश भेजेंगे।`,
  fee_refund_approved: (f) => `मालिक ने आपका रिफंड मंज़ूर कर दिया है। ${inr(f, "refundInr")} रास्ते में हैं।`,
  fee_refund_denied: () => "मालिक ने इस भुगतान को वापस न करने का फ़ैसला किया है।",
  fee_refund_expired: (f) => `मालिक ने आपके ${inr(f, "refundInr")} के रिफंड पर समय पर जवाब नहीं दिया, इसलिए वह नहीं भेजा गया। कृपया ${f.businessName} से सीधे संपर्क करें।`,
  fee_link_failed: () => "क्षमा करें, अभी भुगतान लिंक नहीं बन पाया, इसलिए भेजा नहीं गया। मैंने मालिक को बता दिया है। कृपया कुछ मिनट बाद फिर कोशिश करें।",
  fee_menu: (f) => `नमस्ते! यह ${f.businessName} है। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस: ${inr(f, "balanceInr")} भरने हैं। आप क्या करना चाहेंगे?`,
  fee_didnt_understand: () => "क्षमा करें, मैं समझ नहीं पाया। कृपया नीचे का कोई बटन दबाएँ, या मालिक से बात करें।",
  fee_told_owner: () => "मैंने मालिक को बता दिया है कि आप बात करना चाहते हैं। वे आपको यहीं संदेश भेजेंगे।",
  fee_couldnt_tell_owner: () => "क्षमा करें, अभी मालिक तक बात नहीं पहुँच पाई। कृपया कुछ मिनट बाद फिर कोशिश करें।",
  voice_note: () => "कृपया अपना संदेश लिखकर भेजें; मैं अभी वॉइस नोट नहीं सुन सकता।",

  owner_waiver_request: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम करने को कहा है। फीस ${inr(f, "feeInr")} है और अभी ${inr(f, "balanceInr")} भरने हैं। "approve ${need(f, "requestRef")}" या "deny ${need(f, "requestRef")}" लिखकर जवाब दें।`,
  owner_waiver_applied: (f) => `आपकी ${inr(f, "waiverLimitInr")} की सीमा के अंदर हो गया: ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम किए (${need(f, "customerPhone")})। अब ${inr(f, "balanceInr")} भरने हैं।`,
  owner_refund_request: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के भरे ${inr(f, "paidInr")} में से ${inr(f, "refundInr")} वापस माँगे हैं। "approve ${need(f, "requestRef")}" या "deny ${need(f, "requestRef")}" लिखकर जवाब दें।`,
  owner_discount_note: (f) => `अभिभावक ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस (${inr(f, "feeInr")}) पर छूट माँगी, पर कितनी यह नहीं बताया। कृपया उन्हें संदेश भेजें। कुछ बदला नहीं गया।`,
  owner_payment_claim: (f) => `अभिभावक ${need(f, "customerPhone")} कहते हैं कि उन्होंने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस (${inr(f, "feeInr")}) भर दी है, पर भुगतान रिकॉर्ड में ${inr(f, "paidInr")} दिख रहे हैं। कृपया जाँचकर उन्हें संदेश भेजें।`,
  owner_overpayment: (f) => `अभिभावक ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ज़्यादा भर दिया। फालतू ${inr(f, "refundInr")} लौटाए जा रहे हैं।`,
  owner_link_failed: (f) => `भुगतान लिंक नहीं बन पाया: ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस (${need(f, "customerPhone")})। कोई याद दिलाने वाला संदेश नहीं गया। कृपया Razorpay देख लें।`,
  owner_request_stale: (f) => `नहीं हुआ: ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस (${need(f, "customerPhone")}) आपसे पूछने के बाद बदल गई, इसलिए कुछ लागू नहीं किया गया। ज़रूरत हो तो अभिभावक फिर पूछ सकते हैं।`,
  owner_message_held: (f) => `${need(f, "customerPhone")} को जाने वाला एक संदेश रोक दिया गया क्योंकि वह फीस के रिकॉर्ड से मेल नहीं खाता था। कुछ भेजा नहीं गया।`,
  owner_opted_out: (f) => `अभिभावक ${need(f, "customerPhone")} ने STOP भेजा है। अब उन्हें कोई संदेश नहीं जाएगा।`,
  owner_unknown_command: () => `मैं समझ नहीं पाया। "approve" या "deny" लिखें, और उसके बाद अनुरोध का नंबर।`,
  owner_wants_to_talk: (f) => `अभिभावक ${need(f, "customerPhone")} आपसे बात करना चाहते हैं। कृपया उन्हें संदेश भेजें।`,
  owner_ai_allowance: (f) => `सूचना: ${f.businessName} के लिए इस महीने का AI कोटा पूरा हो गया है, इसलिए एजेंट अब बटन से जवाब देगा। याद दिलाना और भुगतान लेना फिर भी चलेगा और हर सीमा पहले की तरह लागू रहेगी। जिसने इसे सेट किया है उसे बता दिया गया है। अगले महीने सामान्य सेवा फिर शुरू होगी।`,
  owner_ai_off: (f) => `सूचना: ${f.businessName} के संदेश पढ़ने वाला AI अभी बंद कर दिया गया है। एजेंट बटन से काम करता रहेगा और हर सीमा पहले की तरह लागू रहेगी। जिसने इसे सेट किया है उसे बता दिया गया है।`,
  owner_ai_fault: (f) => `सूचना: ${f.businessName} के संदेश पढ़ने वाला AI अभी जवाब नहीं दे रहा है, इसलिए एजेंट बटन से काम कर रहा है। याद दिलाना और भुगतान लेना फिर भी चलेगा और हर सीमा पहले की तरह लागू रहेगी। कुछ मिनट बाद एजेंट फिर AI आज़माएगा।`,
  owner_refund_needs_approval: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} (${need(f, "studentName")}, ${need(f, "monthLabel")}) को ${inr(f, "refundInr")} का रिफंड। ${need(f, "approvalHours")} घंटे के अंदर "approve ${need(f, "approvalCode")}" या "deny ${need(f, "approvalCode")}" लिखकर जवाब दें।`,
  owner_approval_done: (f) => `धन्यवाद। ${need(f, "customerPhone")} का ${inr(f, "refundInr")} का रिफंड भेजा जा रहा है, और उन्हें बता दिया जाएगा।`,
  owner_approval_denied: (f) => `समझ गया। ${need(f, "customerPhone")} का ${inr(f, "refundInr")} का रिफंड नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा।`,
  owner_approval_expired: (f) => `आपके जवाब देने से पहले ही वह अनुरोध समाप्त हो गया, इसलिए कुछ वापस नहीं हुआ: ${need(f, "customerPhone")}, ${inr(f, "refundInr")}।`,
  owner_approval_failed: () => "आपका जवाब अभी दर्ज नहीं हो पाया। कृपया कुछ मिनट बाद फिर भेजें।",
};

const ml: TemplateSet = {
  fee_reminder: (f) => `ഫീസ് ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് ${inr(f, "balanceInr")} ആണ്, അടയ്ക്കേണ്ട തീയതി ${dueDate(f)}. ഇവിടെ അടയ്ക്കാം: ${need(f, "link")} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_overdue: (f) => `ഫീസ് ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് ${dueDate(f)}-ന് അടയ്ക്കേണ്ടതായിരുന്നു. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്: ${need(f, "link")} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_overdue_late: (f) => `ഫീസ് ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് ${dueDate(f)}-ന് അടയ്ക്കേണ്ടതായിരുന്നു. ${inr(f, "lateFeeInr")} വൈകിയ ഫീസ് ചേർത്തിട്ടുണ്ട്, അതിനാൽ ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്: ${need(f, "link")} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_received: (f) => `നന്ദി! ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "receivedInr")} ${f.businessName}-ന് ലഭിച്ചു. ഇനി ഒന്നും അടയ്ക്കാനില്ല. നിങ്ങളുടെ രസീത് നമ്പർ ${need(f, "dueRef")} ആണ്.`,
  fee_part_received: (f) => `നന്ദി! ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "receivedInr")} ${f.businessName}-ന് ലഭിച്ചു. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്. ബാക്കി ഇവിടെ അടയ്ക്കാം: ${need(f, "link")} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_pay_link: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "balanceInr")} ഇവിടെ അടയ്ക്കാം: ${need(f, "link")}`,
  fee_already_paid: (f) => `അതെ, ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "paidInr")} പേയ്മെന്റ് ഞങ്ങൾക്ക് കാണാം. ഇനി ഒന്നും അടയ്ക്കാനില്ല. നന്ദി.`,
  fee_claim_partial: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ ${inr(f, "paidInr")} അടച്ചതായി കാണാം, അതിനാൽ ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്. ബാക്കി ഇവിടെ അടയ്ക്കാം: ${need(f, "link")}`,
  fee_claim_not_found: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ പേയ്മെന്റ് ഇതുവരെ ഞങ്ങൾക്ക് കാണാനില്ല. ഇപ്പോൾ അടച്ചതാണെങ്കിൽ കാണാൻ കുറച്ച് മിനിറ്റ് എടുക്കാം. പരിശോധിക്കാൻ ഉടമയോട് പറഞ്ഞിട്ടുണ്ട്. പേയ്മെന്റ് നടന്നിട്ടില്ലെങ്കിൽ ഇവിടെ അടയ്ക്കാം: ${need(f, "link")}`,
  fee_nothing_due: () => "ഇപ്പോൾ നിങ്ങൾ ഒന്നും അടയ്ക്കാനില്ല. നന്ദി!",
  fee_waiver_asked: (f) => `ഫീസ് മാറ്റാൻ എനിക്ക് സ്വയം കഴിയില്ല. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറയ്ക്കാമോ എന്ന് ഉടമയോട് ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ ലഭിക്കും.`,
  fee_waiver_applied: (f) => `ശരി. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറച്ചിട്ടുണ്ട്. ഇനി ${inr(f, "balanceInr")} അടയ്ക്കണം: ${need(f, "link")}`,
  fee_waiver_cleared: (f) => `ശരി. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറച്ചിട്ടുണ്ട്. ഇനി ഒന്നും അടയ്ക്കാനില്ല.`,
  fee_waiver_denied: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസ് മാറ്റേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്: ${need(f, "link")}`,
  fee_discount_to_owner: (f) => `ഫീസ് മാറ്റാൻ എനിക്ക് സ്വയം കഴിയില്ല. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിനെക്കുറിച്ച് നിങ്ങൾ ചോദിച്ചതായി ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ തന്നെ സന്ദേശം അയയ്ക്കും.`,
  fee_request_waiting: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിനെക്കുറിച്ച് ഉടമയോട് നേരത്തേ ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ ലഭിക്കും.`,
  fee_refund_asked: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസായി അടച്ച ${inr(f, "paidInr")}-ൽ നിന്ന് ${inr(f, "refundInr")} തിരികെ നൽകാമോ എന്ന് ഉടമയോട് ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ ലഭിക്കും.`,
  fee_refund_too_much: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസായി ${inr(f, "paidInr")} അടച്ചതായാണ് ഞങ്ങളുടെ രേഖയിൽ ഉള്ളത്, അതിനാൽ അതിൽ കൂടുതലുള്ള അഭ്യർത്ഥന എനിക്ക് കൈമാറാൻ കഴിയില്ല. തിരികെ വേണ്ട തുക പറയൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ.`,
  fee_refund_none: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിന്റെ പേയ്മെന്റ് രേഖയിൽ ഇല്ല, അതിനാൽ തിരികെ നൽകാൻ ഒന്നുമില്ല.`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നു.`,
  fee_refund_pending: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് ഉടമ ഉടൻ സ്ഥിരീകരിക്കും.`,
  fee_refund_checking: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് ഞങ്ങൾ പരിശോധിക്കുകയാണ്, സ്ഥിരീകരിച്ചാലുടൻ സന്ദേശം അയയ്ക്കാം.`,
  fee_refund_approved: (f) => `ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. ${inr(f, "refundInr")} വഴിയിലാണ്.`,
  fee_refund_denied: () => "ഈ പേയ്മെന്റ് തിരികെ നൽകേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു.",
  fee_refund_expired: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ടിനെക്കുറിച്ച് ഉടമ സമയത്തിനുള്ളിൽ മറുപടി നൽകിയില്ല, അതിനാൽ അത് അയച്ചിട്ടില്ല. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടുക.`,
  fee_link_failed: () => "ക്ഷമിക്കണം, ഇപ്പോൾ പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ അയച്ചിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.",
  fee_menu: (f) => `നമസ്കാരം! ഇത് ${f.businessName} ആണ്. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ്: ${inr(f, "balanceInr")} അടയ്ക്കാനുണ്ട്. നിങ്ങൾ എന്താണ് ചെയ്യാൻ ആഗ്രഹിക്കുന്നത്?`,
  fee_didnt_understand: () => "ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. ദയവായി താഴെയുള്ള ഒരു ബട്ടൺ അമർത്തൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ.",
  fee_told_owner: () => "നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ തന്നെ സന്ദേശം അയയ്ക്കും.",
  fee_couldnt_tell_owner: () => "ക്ഷമിക്കണം, ഇപ്പോൾ ഉടമയെ അറിയിക്കാൻ കഴിഞ്ഞില്ല. കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.",
  voice_note: () => "ദയവായി സന്ദേശം ടൈപ്പ് ചെയ്യൂ; എനിക്ക് ഇപ്പോൾ വോയ്സ് നോട്ട് കേൾക്കാൻ കഴിയില്ല.",

  owner_waiver_request: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറയ്ക്കാൻ ആവശ്യപ്പെടുന്നു. ഫീസ് ${inr(f, "feeInr")} ആണ്, ഇപ്പോൾ ${inr(f, "balanceInr")} അടയ്ക്കാനുണ്ട്. "approve ${need(f, "requestRef")}" അല്ലെങ്കിൽ "deny ${need(f, "requestRef")}" എന്ന് മറുപടി നൽകുക.`,
  owner_waiver_applied: (f) => `നിങ്ങളുടെ ${inr(f, "waiverLimitInr")} പരിധിക്കുള്ളിൽ ചെയ്തു: ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറച്ചു (${need(f, "customerPhone")}). ഇനി ${inr(f, "balanceInr")} അടയ്ക്കണം.`,
  owner_refund_request: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസായി അടച്ച ${inr(f, "paidInr")}-ൽ നിന്ന് ${inr(f, "refundInr")} തിരികെ ചോദിക്കുന്നു. "approve ${need(f, "requestRef")}" അല്ലെങ്കിൽ "deny ${need(f, "requestRef")}" എന്ന് മറുപടി നൽകുക.`,
  owner_discount_note: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ (${inr(f, "feeInr")}) ഇളവ് ചോദിച്ചു, എത്രയെന്ന് പറഞ്ഞില്ല. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ. ഒന്നും മാറ്റിയിട്ടില്ല.`,
  owner_payment_claim: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് (${inr(f, "feeInr")}) അടച്ചു എന്ന് പറയുന്നു, പക്ഷേ പേയ്മെന്റ് രേഖയിൽ ${inr(f, "paidInr")} മാത്രമാണ് കാണുന്നത്. ദയവായി പരിശോധിച്ച് അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_overpayment: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിനേക്കാൾ കൂടുതൽ അടച്ചു. അധികമായ ${inr(f, "refundInr")} തിരികെ നൽകുന്നു.`,
  owner_link_failed: (f) => `പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല: ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസ് (${need(f, "customerPhone")}). ഓർമ്മപ്പെടുത്തൽ പോയിട്ടില്ല. ദയവായി Razorpay പരിശോധിക്കൂ.`,
  owner_request_stale: (f) => `ചെയ്തിട്ടില്ല: ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസ് (${need(f, "customerPhone")}) നിങ്ങളോട് ചോദിച്ചതിനുശേഷം മാറി, അതിനാൽ ഒന്നും നടപ്പാക്കിയിട്ടില്ല. ആവശ്യമെങ്കിൽ രക്ഷിതാവിന് വീണ്ടും ചോദിക്കാം.`,
  owner_message_held: (f) => `${need(f, "customerPhone")}-ന് അയയ്ക്കേണ്ടിയിരുന്ന ഒരു സന്ദേശം ഫീസ് രേഖയുമായി പൊരുത്തപ്പെടാത്തതിനാൽ തടഞ്ഞുവച്ചു. ഒന്നും അയച്ചിട്ടില്ല.`,
  owner_opted_out: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} STOP അയച്ചു. ഇനി അവർക്ക് സന്ദേശങ്ങൾ അയയ്ക്കില്ല.`,
  owner_unknown_command: () => `എനിക്ക് മനസ്സിലായില്ല. "approve" അല്ലെങ്കിൽ "deny" എന്ന് എഴുതി, അതിനു ശേഷം അഭ്യർത്ഥനയുടെ നമ്പർ എഴുതൂ.`,
  owner_wants_to_talk: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} നിങ്ങളോട് സംസാരിക്കാൻ ആഗ്രഹിക്കുന്നു. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_ai_allowance: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഈ മാസത്തെ AI പരിധി കഴിഞ്ഞു, അതിനാൽ ഏജന്റ് ഇനി ബട്ടണുകളിലൂടെ മറുപടി നൽകും. ഓർമ്മപ്പെടുത്തലും പേയ്മെന്റ് സ്വീകരിക്കലും തുടരും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. ഇത് സജ്ജമാക്കിയ ആളെ അറിയിച്ചിട്ടുണ്ട്. അടുത്ത മാസം സാധാരണ സേവനം തിരികെ വരും.`,
  owner_ai_off: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI തൽക്കാലം ഓഫ് ചെയ്തിരിക്കുന്നു. ഏജന്റ് ബട്ടണുകളിലൂടെ പ്രവർത്തിക്കും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. ഇത് സജ്ജമാക്കിയ ആളെ അറിയിച്ചിട്ടുണ്ട്.`,
  owner_ai_fault: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ സന്ദേശങ്ങൾ വായിക്കുന്ന AI ഇപ്പോൾ മറുപടി നൽകുന്നില്ല, അതിനാൽ ഏജന്റ് ബട്ടണുകൾ ഉപയോഗിക്കുന്നു. ഓർമ്മപ്പെടുത്തലും പേയ്മെന്റ് സ്വീകരിക്കലും തുടരും, എല്ലാ പരിധികളും മുമ്പത്തെപ്പോലെ പാലിക്കും. കുറച്ച് മിനിറ്റിനുശേഷം ഏജന്റ് വീണ്ടും AI പരീക്ഷിക്കും.`,
  owner_refund_needs_approval: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")} (${need(f, "studentName")}, ${need(f, "monthLabel")}) എന്നവർക്ക് ${inr(f, "refundInr")} റീഫണ്ട്. ${need(f, "approvalHours")} മണിക്കൂറിനുള്ളിൽ "approve ${need(f, "approvalCode")}" അല്ലെങ്കിൽ "deny ${need(f, "approvalCode")}" എന്ന് മറുപടി നൽകുക.`,
  owner_approval_done: (f) => `നന്ദി. ${need(f, "customerPhone")}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ട് അയയ്ക്കുന്നു, അവരെ അറിയിക്കും.`,
  owner_approval_denied: (f) => `മനസ്സിലായി. ${need(f, "customerPhone")}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ട് അയയ്ക്കില്ല, അവരെ അറിയിക്കും.`,
  owner_approval_expired: (f) => `നിങ്ങൾ മറുപടി നൽകുന്നതിന് മുമ്പേ ആ അഭ്യർത്ഥനയുടെ സമയം കഴിഞ്ഞു, അതിനാൽ ഒന്നും തിരികെ നൽകിയിട്ടില്ല: ${need(f, "customerPhone")}, ${inr(f, "refundInr")}.`,
  owner_approval_failed: () => "നിങ്ങളുടെ മറുപടി ഇപ്പോൾ രേഖപ്പെടുത്താൻ കഴിഞ്ഞില്ല. കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും അയയ്ക്കൂ.",
};

const kn: TemplateSet = {
  fee_reminder: (f) => `ಶುಲ್ಕದ ನೆನಪು: ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕ ${inr(f, "balanceInr")}, ಕೊನೆಯ ದಿನಾಂಕ ${dueDate(f)}. ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${need(f, "link")} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_overdue: (f) => `ಶುಲ್ಕದ ನೆನಪು: ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕವನ್ನು ${dueDate(f)}ರಂದು ಪಾವತಿಸಬೇಕಿತ್ತು. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ: ${need(f, "link")} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_overdue_late: (f) => `ಶುಲ್ಕದ ನೆನಪು: ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕವನ್ನು ${dueDate(f)}ರಂದು ಪಾವತಿಸಬೇಕಿತ್ತು. ${inr(f, "lateFeeInr")} ತಡ ಶುಲ್ಕ ಸೇರಿಸಲಾಗಿದೆ, ಆದ್ದರಿಂದ ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ: ${need(f, "link")} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_received: (f) => `ಧನ್ಯವಾದ! ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "receivedInr")} ${f.businessName}-ಗೆ ಸಿಕ್ಕಿದೆ. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ. ನಿಮ್ಮ ರಸೀದಿ ಸಂಖ್ಯೆ ${need(f, "dueRef")}.`,
  fee_part_received: (f) => `ಧನ್ಯವಾದ! ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "receivedInr")} ${f.businessName}-ಗೆ ಸಿಕ್ಕಿದೆ. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ. ಉಳಿದದ್ದನ್ನು ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${need(f, "link")} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_pay_link: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "balanceInr")} ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${need(f, "link")}`,
  fee_already_paid: (f) => `ಹೌದು, ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "paidInr")} ಪಾವತಿ ನಮಗೆ ಕಾಣಿಸುತ್ತಿದೆ. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ. ಧನ್ಯವಾದ.`,
  fee_claim_partial: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದಲ್ಲಿ ${inr(f, "paidInr")} ಪಾವತಿಯಾಗಿರುವುದು ಕಾಣಿಸುತ್ತಿದೆ, ಆದ್ದರಿಂದ ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ. ಉಳಿದದ್ದನ್ನು ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${need(f, "link")}`,
  fee_claim_not_found: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ಪಾವತಿ ಇನ್ನೂ ನಮಗೆ ಕಾಣಿಸುತ್ತಿಲ್ಲ. ಈಗಷ್ಟೇ ಪಾವತಿಸಿದ್ದರೆ ಕಾಣಿಸಲು ಕೆಲವು ನಿಮಿಷ ಬೇಕಾಗಬಹುದು. ಪರಿಶೀಲಿಸಲು ಮಾಲೀಕರಿಗೆ ಹೇಳಿದ್ದೇನೆ. ಪಾವತಿ ಆಗದಿದ್ದರೆ ಇಲ್ಲಿ ಪಾವತಿಸಬಹುದು: ${need(f, "link")}`,
  fee_nothing_due: () => "ಈಗ ನಿಮ್ಮಿಂದ ಏನೂ ಬಾಕಿ ಇಲ್ಲ. ಧನ್ಯವಾದ!",
  fee_waiver_asked: (f) => `ಶುಲ್ಕವನ್ನು ನಾನೇ ಬದಲಾಯಿಸಲು ಆಗುವುದಿಲ್ಲ. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಬಹುದೇ ಎಂದು ಮಾಲೀಕರನ್ನು ಕೇಳಿದ್ದೇನೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ.`,
  fee_waiver_applied: (f) => `ಆಯಿತು. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲಾಗಿದೆ. ಈಗ ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು: ${need(f, "link")}`,
  fee_waiver_cleared: (f) => `ಆಯಿತು. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲಾಗಿದೆ. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ.`,
  fee_waiver_denied: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕವನ್ನು ಬದಲಾಯಿಸದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ: ${need(f, "link")}`,
  fee_discount_to_owner: (f) => `ಶುಲ್ಕವನ್ನು ನಾನೇ ಬದಲಾಯಿಸಲು ಆಗುವುದಿಲ್ಲ. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದ ಬಗ್ಗೆ ನೀವು ಕೇಳಿದ್ದನ್ನು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.`,
  fee_request_waiting: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದ ಬಗ್ಗೆ ಮಾಲೀಕರನ್ನು ಈಗಾಗಲೇ ಕೇಳಲಾಗಿದೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ.`,
  fee_refund_asked: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕವಾಗಿ ಪಾವತಿಸಿದ ${inr(f, "paidInr")}ರಲ್ಲಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿಸಬಹುದೇ ಎಂದು ಮಾಲೀಕರನ್ನು ಕೇಳಿದ್ದೇನೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ.`,
  fee_refund_too_much: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕವಾಗಿ ${inr(f, "paidInr")} ಪಾವತಿಯಾಗಿದೆ ಎಂದು ನಮ್ಮ ದಾಖಲೆಯಲ್ಲಿದೆ, ಆದ್ದರಿಂದ ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಕೋರಿಕೆಯನ್ನು ನಾನು ಮುಂದೆ ಕಳುಹಿಸಲು ಆಗುವುದಿಲ್ಲ. ಹಿಂತಿರುಗಿ ಬೇಕಾದ ಮೊತ್ತ ತಿಳಿಸಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.`,
  fee_refund_none: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದ ಯಾವುದೇ ಪಾವತಿ ದಾಖಲೆಯಲ್ಲಿ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಹಿಂತಿರುಗಿಸಲು ಏನೂ ಇಲ್ಲ.`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} ನಿಮಗೆ ಹಿಂತಿರುಗಿಸಲಾಗುತ್ತಿದೆ.`,
  fee_refund_pending: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಮಾಲೀಕರು ಶೀಘ್ರದಲ್ಲೇ ದೃಢೀಕರಿಸುತ್ತಾರೆ.`,
  fee_refund_checking: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇವೆ, ದೃಢವಾದ ತಕ್ಷಣ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇವೆ.`,
  fee_refund_approved: (f) => `ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಅನ್ನು ಒಪ್ಪಿದ್ದಾರೆ. ${inr(f, "refundInr")} ದಾರಿಯಲ್ಲಿದೆ.`,
  fee_refund_denied: () => "ಈ ಪಾವತಿಯನ್ನು ಹಿಂತಿರುಗಿಸದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ.",
  fee_refund_expired: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಬಗ್ಗೆ ಮಾಲೀಕರು ಸಮಯಕ್ಕೆ ಉತ್ತರಿಸಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಅದನ್ನು ಕಳುಹಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು ${f.businessName}-ನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ.`,
  fee_link_failed: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಕಳುಹಿಸಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  fee_menu: (f) => `ನಮಸ್ಕಾರ! ಇದು ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕ: ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು. ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?`,
  fee_didnt_understand: () => "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಳಗಿನ ಒಂದು ಬಟನ್ ಒತ್ತಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.",
  fee_told_owner: () => "ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.",
  fee_couldnt_tell_owner: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  voice_note: () => "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ; ನನಗೆ ಇನ್ನೂ ವಾಯ್ಸ್ ನೋಟ್ ಕೇಳಲು ಆಗುವುದಿಲ್ಲ.",

  owner_waiver_request: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲು ಕೇಳಿದ್ದಾರೆ. ಶುಲ್ಕ ${inr(f, "feeInr")}, ಈಗ ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು. "approve ${need(f, "requestRef")}" ಅಥವಾ "deny ${need(f, "requestRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_waiver_applied: (f) => `ನಿಮ್ಮ ${inr(f, "waiverLimitInr")} ಮಿತಿಯೊಳಗೆ ಮಾಡಲಾಗಿದೆ: ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲಾಗಿದೆ (${need(f, "customerPhone")}). ಈಗ ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು.`,
  owner_refund_request: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕವಾಗಿ ಪಾವತಿಸಿದ ${inr(f, "paidInr")}ರಲ್ಲಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿ ಕೇಳಿದ್ದಾರೆ. "approve ${need(f, "requestRef")}" ಅಥವಾ "deny ${need(f, "requestRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_discount_note: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ (${inr(f, "feeInr")}) ಮೇಲೆ ರಿಯಾಯಿತಿ ಕೇಳಿದ್ದಾರೆ, ಎಷ್ಟು ಎಂದು ಹೇಳಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ. ಏನನ್ನೂ ಬದಲಾಯಿಸಿಲ್ಲ.`,
  owner_payment_claim: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕ (${inr(f, "feeInr")}) ಪಾವತಿಸಿದ್ದೇನೆ ಎನ್ನುತ್ತಾರೆ, ಆದರೆ ಪಾವತಿ ದಾಖಲೆಯಲ್ಲಿ ${inr(f, "paidInr")} ಮಾತ್ರ ಕಾಣಿಸುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_overpayment: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕಕ್ಕಿಂತ ಹೆಚ್ಚು ಪಾವತಿಸಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿಸಲಾಗುತ್ತಿದೆ.`,
  owner_link_failed: (f) => `ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ: ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕ (${need(f, "customerPhone")}). ಯಾವುದೇ ನೆನಪು ಹೋಗಿಲ್ಲ. ದಯವಿಟ್ಟು Razorpay ಪರಿಶೀಲಿಸಿ.`,
  owner_request_stale: (f) => `ಮಾಡಿಲ್ಲ: ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕ (${need(f, "customerPhone")}) ನಿಮ್ಮನ್ನು ಕೇಳಿದ ನಂತರ ಬದಲಾಗಿದೆ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಜಾರಿಗೊಳಿಸಿಲ್ಲ. ಅಗತ್ಯವಿದ್ದರೆ ಪೋಷಕರು ಮತ್ತೆ ಕೇಳಬಹುದು.`,
  owner_message_held: (f) => `${need(f, "customerPhone")} ಅವರಿಗೆ ಹೋಗಬೇಕಿದ್ದ ಒಂದು ಸಂದೇಶ ಶುಲ್ಕದ ದಾಖಲೆಗೆ ಹೊಂದಿಕೆಯಾಗದ ಕಾರಣ ತಡೆಹಿಡಿಯಲಾಗಿದೆ. ಏನನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ.`,
  owner_opted_out: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು STOP ಕಳುಹಿಸಿದ್ದಾರೆ. ಇನ್ನು ಅವರಿಗೆ ಸಂದೇಶಗಳನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
  owner_unknown_command: () => `ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. "approve" ಅಥವಾ "deny" ಎಂದು ಬರೆದು, ನಂತರ ಕೋರಿಕೆಯ ಸಂಖ್ಯೆ ಬರೆಯಿರಿ.`,
  owner_wants_to_talk: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುತ್ತಾರೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_ai_allowance: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಈ ತಿಂಗಳ AI ಮಿತಿ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಈಗ ಬಟನ್‌ಗಳ ಮೂಲಕ ಉತ್ತರಿಸುತ್ತದೆ. ನೆನಪಿಸುವುದು ಮತ್ತು ಪಾವತಿ ತೆಗೆದುಕೊಳ್ಳುವುದು ಮುಂದುವರಿಯುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. ಮುಂದಿನ ತಿಂಗಳು ಸಾಮಾನ್ಯ ಸೇವೆ ಮರಳುತ್ತದೆ.`,
  owner_ai_off: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಸದ್ಯಕ್ಕೆ ಆಫ್ ಮಾಡಲಾಗಿದೆ. ಏಜೆಂಟ್ ಬಟನ್‌ಗಳಿಂದ ಕೆಲಸ ಮುಂದುವರಿಸುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
  owner_ai_fault: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಸಂದೇಶಗಳನ್ನು ಓದುವ AI ಈಗ ಉತ್ತರಿಸುತ್ತಿಲ್ಲ, ಆದ್ದರಿಂದ ಏಜೆಂಟ್ ಬಟನ್‌ಗಳನ್ನು ಬಳಸುತ್ತಿದೆ. ನೆನಪಿಸುವುದು ಮತ್ತು ಪಾವತಿ ತೆಗೆದುಕೊಳ್ಳುವುದು ಮುಂದುವರಿಯುತ್ತದೆ, ಎಲ್ಲಾ ಮಿತಿಗಳು ಮೊದಲಿನಂತೆಯೇ ಪಾಲನೆಯಾಗುತ್ತವೆ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಏಜೆಂಟ್ ಮತ್ತೆ AI ಪ್ರಯತ್ನಿಸುತ್ತದೆ.`,
  owner_refund_needs_approval: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} (${need(f, "studentName")}, ${need(f, "monthLabel")}) ಅವರಿಗೆ ${inr(f, "refundInr")} ರೀಫಂಡ್. ${need(f, "approvalHours")} ಗಂಟೆಯೊಳಗೆ "approve ${need(f, "approvalCode")}" ಅಥವಾ "deny ${need(f, "approvalCode")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_approval_done: (f) => `ಧನ್ಯವಾದ. ${need(f, "customerPhone")} ಅವರ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_approval_denied: (f) => `ಅರ್ಥವಾಯಿತು. ${need(f, "customerPhone")} ಅವರ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_approval_expired: (f) => `ನೀವು ಉತ್ತರಿಸುವ ಮೊದಲೇ ಆ ಕೋರಿಕೆಯ ಸಮಯ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಏನನ್ನೂ ಮರಳಿ ಕೊಟ್ಟಿಲ್ಲ: ${need(f, "customerPhone")}, ${inr(f, "refundInr")}.`,
  owner_approval_failed: () => "ನಿಮ್ಮ ಉತ್ತರವನ್ನು ಈಗ ದಾಖಲಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಕಳುಹಿಸಿ.",
};

export const TEMPLATES: Record<Language, TemplateSet> = { en, hi, ml, kn };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
