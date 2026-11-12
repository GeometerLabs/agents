// Every message the Fees agent sends, per language. There is NO model-written text: each message is one of these templates, and every amount, date, student,
// batch and link in it is rendered from the record (the facts), never typed by hand and never translated. Adding a language means adding one more object below; the
// type makes sure none is missing. The Hindi, Malayalam and Kannada are machine-written: a native speaker must read them before a real centre sees them
// (REVIEW-ml.md and REVIEW-kn.md list every line).
import { formatDate, formatInr } from "../../../../../modules/language/format.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { localParts } from "../../../../../modules/core/time.ts";

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
  /** A refund that needs several people (B37): how many more approvals it waits for after this person's. Made by the approvals relay from Guard's answer. */
  approvalsLeft?: number;
  /** UPI centres (B33): the centre's UPI ID and the name parents see; the owner's one-use code for a payment or refund (only ever in a message to the owner). */
  upiId?: string;
  payee?: string;
  upiCode?: string;
  /** The licence's service notices (B13): who the owner should contact (the partner who set the centre up), and the count the final stop's notice states. */
  partner?: string;
  openFeesCount?: number;
}

export type TemplateId =
  // to the parent: the reminders, which go out on their own (each is also a WhatsApp template, fees/src/language/meta-templates.ts)
  | "fee_reminder" | "fee_overdue" | "fee_overdue_late" | "fee_received" | "fee_part_received"
  // to the parent: answers to what they wrote or tapped
  | "fee_pay_link" | "fee_already_paid" | "fee_claim_partial" | "fee_claim_not_found" | "fee_nothing_due"
  | "fee_waiver_asked" | "fee_waiver_applied" | "fee_waiver_cleared" | "fee_waiver_denied" | "fee_discount_to_owner" | "fee_request_waiting"
  | "fee_refund_asked" | "fee_refund_too_much" | "fee_refund_none" | "fee_refund_done" | "fee_refund_pending" | "fee_refund_checking" | "fee_refund_confirmed" | "fee_refund_approved" | "fee_refund_denied" | "fee_refund_expired"
  | "fee_link_failed" | "fee_menu" | "fee_didnt_understand" | "fee_told_owner" | "fee_couldnt_tell_owner" | "voice_note" | "voice_note_retry"
  // to the owner. Every line starts and ends with fixed words, because each one that goes out unasked is also a WhatsApp template (meta-templates.ts) and
  // Meta rejects a body that starts or ends with a value. The one exception is the reply to the owner's own message, which needs no template.
  | "owner_waiver_request" | "owner_waiver_applied" | "owner_refund_request" | "owner_discount_note" | "owner_payment_claim" | "owner_overpayment" | "owner_link_failed" | "owner_request_stale"
  | "owner_message_held" | "owner_opted_out" | "owner_unknown_command" | "owner_wants_to_talk"
  // button mode: the agent reads with the rules only and answers with buttons (modules/understanding/ai-state.ts). Each says why, and that every limit still holds.
  | "owner_ai_allowance" | "owner_ai_off" | "owner_ai_fault"
  // sent by the approvals relay, not by the agent: the ask for a refund Guard is holding, and the answers to the owner's reply
  | "owner_refund_needs_approval" | "owner_approval_done" | "owner_approval_denied" | "owner_approval_expired" | "owner_approval_failed"
  // the relay again, when a refund needs several people (B37): this person's approval is in and more are needed; the others approved it; one person refused it
  | "owner_approval_waiting" | "owner_approval_closed" | "owner_approval_refused"
  // the agent: a person at the server settled an uncertain refund as made (Guard's already_done), so it is done and not sent again
  | "owner_refund_settled"
  | UpiTemplateId | LicenceTemplateId | GuardWaitTemplateId;

/**
 * The licence's wind-down and final stop (plan B13; modules/licence). The parent's line answers a request to pay while online fee payment is paused; the owner's two
 * are the one service notice for each `paid_through` (WhatsApp utility templates). About the service, never about Geometer's fee; they name who to contact.
 */
export type LicenceTemplateId = "fee_paused" | "owner_licence_paused" | "owner_licence_stopped";

/**
 * The wait for a Guard is over (modules/runtime/guard-wait.ts, 15 minutes from the message) and this message's work was not done: the customer hears that it was
 * not finished, that the fee system is not answering, that the message is on the owner's to-do list (the record line the panel's list reads, `message_unanswered`),
 * and to write again later or contact the shop. Nothing more is promised: nobody is messaged by the code and nothing is tried again by itself (11 Nov 2026).
 */
export type GuardWaitTemplateId = "fee_wait_over";

/** UPI centres only (B33): the parent pays the centre's own UPI ID and the owner marks it received; refunds are sent by the owner. */
export type UpiTemplateId =
  | "fee_upi_qr_caption" | "fee_upi_claim" | "fee_upi_refund_owed" | "fee_upi_refund_sent"
  | "owner_fee_upi_expected" | "owner_fee_upi_claim" | "owner_fee_upi_marked" | "owner_fee_upi_part" | "owner_fee_upi_already" | "owner_fee_upi_unknown"
  | "owner_fee_upi_refund_owed" | "owner_fee_upi_refund_reminder" | "owner_fee_upi_refund_marked";

/** Which approved WhatsApp template carries a message once the parent's 24-hour window has closed and no exact template fits. */
export const TEMPLATE_NAMES = { customer: "fee_update", reminder: "fee_reminder_notice", owner: "owner_notice" } as const;

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
type Money = "feeInr" | "lateFeeInr" | "balanceInr" | "paidInr" | "receivedInr" | "waiverInr" | "refundInr" | "waiverLimitInr";
export const inr = (f: MessageFacts, key: Money) => formatInr(need(f, key));
/**
 * Where to pay, as the messages say it: the payment link; for a UPI centre the `upi://pay` link with the centre's UPI ID and name after it, since WhatsApp does not
 * open upi:// links and a parent can pay by hand from those. One value, so every message that asks for money, and its WhatsApp template, says it the same way.
 */
export const payTo = (f: MessageFacts): string => (f.upiId ? `${need(f, "link")} (UPI ID ${f.upiId}, ${need(f, "payee")})` : need(f, "link"));
export const dueDate = (f: MessageFacts) => formatDate(localParts(need(f, "dueMs"), f.timeZone), f.language);

const en: BaseSet = {
  fee_reminder: (f) => `Fee reminder from ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} is ${inr(f, "balanceInr")}, due on ${dueDate(f)}. Pay here: ${payTo(f)} Reply STOP if you do not want these reminders.`,
  fee_overdue: (f) => `Fee reminder from ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} was due on ${dueDate(f)}. ${inr(f, "balanceInr")} is still to pay: ${payTo(f)} Reply STOP if you do not want these reminders.`,
  fee_overdue_late: (f) => `Fee reminder from ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} was due on ${dueDate(f)}. A late fee of ${inr(f, "lateFeeInr")} has been added, so ${inr(f, "balanceInr")} is still to pay: ${payTo(f)} Reply STOP if you do not want these reminders.`,
  fee_received: (f) => `Thank you! ${f.businessName} has received ${inr(f, "receivedInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. Nothing more is due. Your receipt number is ${need(f, "dueRef")}.`,
  fee_part_received: (f) => `Thank you! ${f.businessName} has received ${inr(f, "receivedInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. ${inr(f, "balanceInr")} is still to pay. Pay the rest here: ${payTo(f)} Reply STOP if you do not want these reminders.`,
  fee_pay_link: (f) => `Pay ${inr(f, "balanceInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} here: ${payTo(f)}`,
  fee_already_paid: (f) => `Yes, we can see your payment of ${inr(f, "paidInr")} for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. Nothing more is due. Thank you.`,
  fee_claim_partial: (f) => `We can see ${inr(f, "paidInr")} paid for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}, so ${inr(f, "balanceInr")} is still to pay. Pay the rest here: ${payTo(f)}`,
  fee_claim_not_found: (f) => `We cannot see a payment yet for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. If you paid just now, it can take a few minutes to show. I have asked the owner to check. If it did not go through, you can pay here: ${payTo(f)}`,
  fee_nothing_due: () => "Nothing is due from you right now. Thank you!",
  fee_waiver_asked: (f) => `I cannot change the fee myself. I have asked the owner about taking ${inr(f, "waiverInr")} off ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. You will hear back here.`,
  fee_waiver_applied: (f) => `Done. ${inr(f, "waiverInr")} is taken off ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. ${inr(f, "balanceInr")} is now to pay: ${payTo(f)}`,
  fee_waiver_cleared: (f) => `Done. ${inr(f, "waiverInr")} is taken off ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. Nothing more is due.`,
  fee_waiver_denied: (f) => `The owner has decided not to change ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. ${inr(f, "balanceInr")} is still to pay: ${payTo(f)}`,
  fee_discount_to_owner: (f) => `I cannot change the fee myself. I have told the owner that you asked about ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. They will message you here.`,
  fee_request_waiting: (f) => `The owner has already been asked about ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. You will hear back here.`,
  fee_refund_asked: (f) => `I have asked the owner about refunding ${inr(f, "refundInr")} of the ${inr(f, "paidInr")} you paid for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. You will hear back here.`,
  fee_refund_too_much: (f) => `Our record shows ${inr(f, "paidInr")} paid for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}, so I cannot pass on a request for more than that. Tell me the amount you want back, or talk to the owner.`,
  fee_refund_none: (f) => `There is no payment on record for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}, so there is nothing to refund.`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} is being refunded to you.`,
  fee_refund_pending: (f) => `The owner will confirm your ${inr(f, "refundInr")} refund shortly.`,
  fee_refund_checking: (f) => `We are checking your ${inr(f, "refundInr")} refund and will message you as soon as it is confirmed.`,
  fee_refund_confirmed: (f) => `Your ${inr(f, "refundInr")} refund is confirmed and is on its way back to you.`,
  fee_refund_approved: (f) => `The owner approved your refund. ${inr(f, "refundInr")} is on its way.`,
  fee_refund_denied: () => "The owner has decided not to refund this payment.",
  fee_refund_expired: (f) => `The owner did not answer in time about your ${inr(f, "refundInr")} refund, so it has not been sent. Please contact ${f.businessName} directly.`,
  fee_link_failed: () => "Sorry, I could not make the payment link just now, so I have not sent it. I have told the owner. Please try again in a few minutes.",
  fee_menu: (f) => `Hello! This is ${f.businessName}. ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}: ${inr(f, "balanceInr")} is to pay. What would you like to do?`,
  fee_didnt_understand: () => "Sorry, I did not understand. Please tap one of the buttons below, or talk to the owner.",
  fee_told_owner: () => "I have told the owner that you would like to talk. They will message you here.",
  fee_couldnt_tell_owner: () => "Sorry, I could not reach the owner just now. Please try again in a few minutes.",
  voice_note: () => "Please type your message; I cannot listen to voice notes yet.",
  voice_note_retry: () => "I couldn't make out that voice note. Please type your message instead.",

  owner_waiver_request: (f) => `Approval needed: ${need(f, "customerPhone")} asks to take ${inr(f, "waiverInr")} off ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. The fee is ${inr(f, "feeInr")} and ${inr(f, "balanceInr")} is to pay now. Reply "approve ${need(f, "requestRef")}" or "deny ${need(f, "requestRef")}".`,
  owner_waiver_applied: (f) => `Done within your ${inr(f, "waiverLimitInr")} limit: ${inr(f, "waiverInr")} taken off ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} (${need(f, "customerPhone")}). ${inr(f, "balanceInr")} is now to pay.`,
  owner_refund_request: (f) => `Approval needed: ${need(f, "customerPhone")} asks for ${inr(f, "refundInr")} back of the ${inr(f, "paidInr")} paid for ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")}. Reply "approve ${need(f, "requestRef")}" or "deny ${need(f, "requestRef")}".`,
  owner_discount_note: (f) => `Parent ${need(f, "customerPhone")} asked for a discount on ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} (${inr(f, "feeInr")}) without saying how much. Please message them. Nothing was changed.`,
  owner_payment_claim: (f) => `Parent ${need(f, "customerPhone")} says they paid ${need(f, "studentName")}'s ${need(f, "batchName")} fee for ${need(f, "monthLabel")} (${inr(f, "feeInr")}), but the payment record shows ${inr(f, "paidInr")}. Please check and message them.`,
  owner_overpayment: (f) => `Parent ${need(f, "customerPhone")} paid more than was due for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")}. The extra ${inr(f, "refundInr")} is being refunded.`,
  // 11 Nov (B71, second part): says what happened and what the owner can do, for every module (it told the owner to check one gateway by name and said "No reminder went out", which
  // was wrong for a UPI centre and for a parent who asked for the link). Sent from three places (agent.ts): a reminder (it stays due and is tried again), a parent
  // asking to pay, and a waiver whose new link failed (the parent is told to try again in a few minutes).
  owner_link_failed: (f) => `Could not make the payment link for ${need(f, "studentName")}'s fee for ${need(f, "monthLabel")} (${need(f, "customerPhone")}), so the parent has not been sent it. It is tried again at the next reminder, or when the parent asks again. If this keeps happening, check your payment account or tell the person who set up your agent.`,
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
  owner_approval_waiting: (f) => `Thank you. Your approval of the ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} is recorded. Approvals still needed from the others: ${need(f, "approvalsLeft")}. It is sent only once they are given.`,
  owner_approval_closed: (f) => `The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} has been approved by the others, so your answer is no longer needed. Thank you.`,
  owner_approval_refused: (f) => `The ${inr(f, "refundInr")} refund for ${need(f, "customerPhone")} was refused by one of the people who approve refunds, so it will not be sent, and they will be told.`,
  owner_refund_settled: (f) => `Refund done: ${inr(f, "refundInr")} for ${need(f, "customerPhone")}. The person who set up your agent checked it and marked it as made, so it is not sent a second time.`,
};

const hi: BaseSet = {
  fee_reminder: (f) => `फीस की याद: ${f.businessName}। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस ${inr(f, "balanceInr")} है, देय तारीख ${dueDate(f)}। यहाँ भुगतान करें: ${payTo(f)} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_overdue: (f) => `फीस की याद: ${f.businessName}। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस ${dueDate(f)} तक देनी थी। ${inr(f, "balanceInr")} अभी बाकी है: ${payTo(f)} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_overdue_late: (f) => `फीस की याद: ${f.businessName}। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस ${dueDate(f)} तक देनी थी। ${inr(f, "lateFeeInr")} की देर की फीस जुड़ गई है, इसलिए ${inr(f, "balanceInr")} अभी बाकी है: ${payTo(f)} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_received: (f) => `धन्यवाद! ${f.businessName} को ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "receivedInr")} मिल गए। अब कुछ बाकी नहीं है। आपकी रसीद संख्या ${need(f, "dueRef")} है।`,
  fee_part_received: (f) => `धन्यवाद! ${f.businessName} को ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "receivedInr")} मिल गए। ${inr(f, "balanceInr")} अभी बाकी है। बाकी यहाँ भरें: ${payTo(f)} ये याद दिलाने वाले संदेश नहीं चाहिए तो STOP लिखें।`,
  fee_pay_link: (f) => `${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "balanceInr")} यहाँ भरें: ${payTo(f)}`,
  fee_already_paid: (f) => `हाँ, ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस का ${inr(f, "paidInr")} का भुगतान हमें दिख रहा है। अब कुछ बाकी नहीं है। धन्यवाद।`,
  fee_claim_partial: (f) => `${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस में ${inr(f, "paidInr")} भरे दिख रहे हैं, इसलिए ${inr(f, "balanceInr")} अभी बाकी है। बाकी यहाँ भरें: ${payTo(f)}`,
  fee_claim_not_found: (f) => `${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस का भुगतान अभी हमें नहीं दिख रहा। अगर अभी भरा है तो दिखने में कुछ मिनट लग सकते हैं। मैंने मालिक से जाँचने को कहा है। अगर भुगतान नहीं हुआ तो यहाँ भर सकते हैं: ${payTo(f)}`,
  fee_nothing_due: () => "अभी आपकी ओर से कुछ बाकी नहीं है। धन्यवाद!",
  fee_waiver_asked: (f) => `फीस मैं खुद नहीं बदल सकता। मैंने मालिक से पूछा है कि ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम किए जाएँ या नहीं। जवाब यहीं मिलेगा।`,
  fee_waiver_applied: (f) => `हो गया। ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम कर दिए गए हैं। अब ${inr(f, "balanceInr")} भरने हैं: ${payTo(f)}`,
  fee_waiver_cleared: (f) => `हो गया। ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम कर दिए गए हैं। अब कुछ बाकी नहीं है।`,
  fee_waiver_denied: (f) => `मालिक ने ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस न बदलने का फ़ैसला किया है। ${inr(f, "balanceInr")} अभी बाकी है: ${payTo(f)}`,
  fee_discount_to_owner: (f) => `फीस मैं खुद नहीं बदल सकता। मैंने मालिक को बता दिया है कि आपने ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के बारे में पूछा है। वे आपको यहीं संदेश भेजेंगे।`,
  fee_request_waiting: (f) => `${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के बारे में मालिक से पहले ही पूछा जा चुका है। जवाब यहीं मिलेगा।`,
  fee_refund_asked: (f) => `मैंने मालिक से पूछा है कि ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के भरे हुए ${inr(f, "paidInr")} में से ${inr(f, "refundInr")} लौटाए जाएँ या नहीं। जवाब यहीं मिलेगा।`,
  fee_refund_too_much: (f) => `हमारे रिकॉर्ड में ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस के ${inr(f, "paidInr")} भरे हैं, इसलिए इससे ज़्यादा की माँग मैं आगे नहीं भेज सकता। जितनी रकम वापस चाहिए वह बताइए, या मालिक से बात करें।`,
  fee_refund_none: (f) => `${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस का कोई भुगतान रिकॉर्ड में नहीं है, इसलिए लौटाने को कुछ नहीं है।`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} आपको लौटाए जा रहे हैं।`,
  fee_refund_pending: (f) => `मालिक जल्दी ही आपके ${inr(f, "refundInr")} के रिफंड की पुष्टि करेंगे।`,
  fee_refund_checking: (f) => `हम आपके ${inr(f, "refundInr")} के रिफंड की जाँच कर रहे हैं, पुष्टि होते ही आपको संदेश भेजेंगे।`,
  fee_refund_confirmed: (f) => `आपके ${inr(f, "refundInr")} के रिफंड की पुष्टि हो गई है। यह आपको वापस भेजा जा रहा है।`,
  fee_refund_approved: (f) => `मालिक ने आपका रिफंड मंज़ूर कर दिया है। ${inr(f, "refundInr")} रास्ते में हैं।`,
  fee_refund_denied: () => "मालिक ने इस भुगतान को वापस न करने का फ़ैसला किया है।",
  fee_refund_expired: (f) => `मालिक ने आपके ${inr(f, "refundInr")} के रिफंड पर समय पर जवाब नहीं दिया, इसलिए वह नहीं भेजा गया। कृपया ${f.businessName} से सीधे संपर्क करें।`,
  fee_link_failed: () => "क्षमा करें, अभी भुगतान लिंक नहीं बन पाया, इसलिए भेजा नहीं गया। मैंने मालिक को बता दिया है। कृपया कुछ मिनट बाद फिर कोशिश करें।",
  fee_menu: (f) => `नमस्ते! यह ${f.businessName} है। ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस: ${inr(f, "balanceInr")} भरने हैं। आप क्या करना चाहेंगे?`,
  fee_didnt_understand: () => "क्षमा करें, मैं समझ नहीं पाया। कृपया नीचे का कोई बटन दबाएँ, या मालिक से बात करें।",
  fee_told_owner: () => "मैंने मालिक को बता दिया है कि आप बात करना चाहते हैं। वे आपको यहीं संदेश भेजेंगे।",
  fee_couldnt_tell_owner: () => "क्षमा करें, अभी मालिक तक बात नहीं पहुँच पाई। कृपया कुछ मिनट बाद फिर कोशिश करें।",
  voice_note: () => "कृपया अपना संदेश लिखकर भेजें; मैं अभी वॉइस नोट नहीं सुन सकता।",
  voice_note_retry: () => "मैं यह वॉइस नोट समझ नहीं पाया। कृपया अपना संदेश लिखकर भेजिए।",

  owner_waiver_request: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम करने को कहा है। फीस ${inr(f, "feeInr")} है और अभी ${inr(f, "balanceInr")} भरने हैं। "approve ${need(f, "requestRef")}" या "deny ${need(f, "requestRef")}" लिखकर जवाब दें।`,
  owner_waiver_applied: (f) => `आपकी ${inr(f, "waiverLimitInr")} की सीमा के अंदर हो गया: ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस से ${inr(f, "waiverInr")} कम किए (${need(f, "customerPhone")})। अब ${inr(f, "balanceInr")} भरने हैं।`,
  owner_refund_request: (f) => `मंज़ूरी चाहिए: ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस के भरे ${inr(f, "paidInr")} में से ${inr(f, "refundInr")} वापस माँगे हैं। "approve ${need(f, "requestRef")}" या "deny ${need(f, "requestRef")}" लिखकर जवाब दें।`,
  owner_discount_note: (f) => `अभिभावक ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस (${inr(f, "feeInr")}) पर छूट माँगी, पर कितनी यह नहीं बताया। कृपया उन्हें संदेश भेजें। कुछ बदला नहीं गया।`,
  owner_payment_claim: (f) => `अभिभावक ${need(f, "customerPhone")} कहते हैं कि उन्होंने ${need(f, "studentName")} की ${need(f, "batchName")} की ${need(f, "monthLabel")} की फीस (${inr(f, "feeInr")}) भर दी है, पर भुगतान रिकॉर्ड में ${inr(f, "paidInr")} दिख रहे हैं। कृपया जाँचकर उन्हें संदेश भेजें।`,
  owner_overpayment: (f) => `अभिभावक ${need(f, "customerPhone")} ने ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस से ज़्यादा भर दिया। फालतू ${inr(f, "refundInr")} लौटाए जा रहे हैं।`,
  // owner_link_failed rewritten 11 Nov (B71): machine-written, waits for a native speaker's review like the rest of this pack
  owner_link_failed: (f) => `भुगतान लिंक नहीं बन पाया: ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस (${need(f, "customerPhone")}), इसलिए अभिभावक को लिंक नहीं भेजा गया। अगले याद दिलाने वाले संदेश पर, या अभिभावक के फिर पूछने पर, लिंक दोबारा बनाने की कोशिश होगी। अगर ऐसा बार-बार हो, तो अपना पेमेंट अकाउंट देखें या आपका एजेंट सेट करने वाले व्यक्ति को बताएँ।`,
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
  owner_approval_waiting: (f) => `धन्यवाद। ${need(f, "customerPhone")} के ${inr(f, "refundInr")} के रिफंड पर आपकी मंज़ूरी दर्ज हो गई है। दूसरों से अभी इतनी मंज़ूरी और चाहिए: ${need(f, "approvalsLeft")}। वे मिलने पर ही रिफंड भेजा जाएगा।`,
  owner_approval_closed: (f) => `सूचना: ${need(f, "customerPhone")} के ${inr(f, "refundInr")} के रिफंड को दूसरों ने मंज़ूरी दे दी है, इसलिए अब आपके जवाब की ज़रूरत नहीं है। धन्यवाद।`,
  owner_approval_refused: (f) => `सूचना: ${need(f, "customerPhone")} के ${inr(f, "refundInr")} के रिफंड को मंज़ूरी देने वालों में से एक ने मना कर दिया है, इसलिए यह नहीं भेजा जाएगा, और उन्हें बता दिया जाएगा।`,
  owner_refund_settled: (f) => `रिफंड हो गया: ${need(f, "customerPhone")} को ${inr(f, "refundInr")}। आपका एजेंट सेट करने वाले व्यक्ति ने इसे जाँचकर पूरा हुआ दर्ज किया है, इसलिए यह दोबारा नहीं भेजा जाएगा।`,
};

const ml: BaseSet = {
  fee_reminder: (f) => `ഫീസ് ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് ${inr(f, "balanceInr")} ആണ്, അടയ്ക്കേണ്ട തീയതി ${dueDate(f)}. ഇവിടെ അടയ്ക്കാം: ${payTo(f)} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_overdue: (f) => `ഫീസ് ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് ${dueDate(f)}-ന് അടയ്ക്കേണ്ടതായിരുന്നു. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്: ${payTo(f)} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_overdue_late: (f) => `ഫീസ് ഓർമ്മപ്പെടുത്തൽ: ${f.businessName}. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് ${dueDate(f)}-ന് അടയ്ക്കേണ്ടതായിരുന്നു. ${inr(f, "lateFeeInr")} വൈകിയ ഫീസ് ചേർത്തിട്ടുണ്ട്, അതിനാൽ ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്: ${payTo(f)} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_received: (f) => `നന്ദി! ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "receivedInr")} ${f.businessName}-ന് ലഭിച്ചു. ഇനി ഒന്നും അടയ്ക്കാനില്ല. നിങ്ങളുടെ രസീത് നമ്പർ ${need(f, "dueRef")} ആണ്.`,
  fee_part_received: (f) => `നന്ദി! ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "receivedInr")} ${f.businessName}-ന് ലഭിച്ചു. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്. ബാക്കി ഇവിടെ അടയ്ക്കാം: ${payTo(f)} ഈ ഓർമ്മപ്പെടുത്തലുകൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.`,
  fee_pay_link: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "balanceInr")} ഇവിടെ അടയ്ക്കാം: ${payTo(f)}`,
  fee_already_paid: (f) => `അതെ, ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ ${inr(f, "paidInr")} പേയ്മെന്റ് ഞങ്ങൾക്ക് കാണാം. ഇനി ഒന്നും അടയ്ക്കാനില്ല. നന്ദി.`,
  fee_claim_partial: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ ${inr(f, "paidInr")} അടച്ചതായി കാണാം, അതിനാൽ ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്. ബാക്കി ഇവിടെ അടയ്ക്കാം: ${payTo(f)}`,
  fee_claim_not_found: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിന്റെ പേയ്മെന്റ് ഇതുവരെ ഞങ്ങൾക്ക് കാണാനില്ല. ഇപ്പോൾ അടച്ചതാണെങ്കിൽ കാണാൻ കുറച്ച് മിനിറ്റ് എടുക്കാം. പരിശോധിക്കാൻ ഉടമയോട് പറഞ്ഞിട്ടുണ്ട്. പേയ്മെന്റ് നടന്നിട്ടില്ലെങ്കിൽ ഇവിടെ അടയ്ക്കാം: ${payTo(f)}`,
  fee_nothing_due: () => "ഇപ്പോൾ നിങ്ങൾ ഒന്നും അടയ്ക്കാനില്ല. നന്ദി!",
  fee_waiver_asked: (f) => `ഫീസ് മാറ്റാൻ എനിക്ക് സ്വയം കഴിയില്ല. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറയ്ക്കാമോ എന്ന് ഉടമയോട് ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ ലഭിക്കും.`,
  fee_waiver_applied: (f) => `ശരി. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറച്ചിട്ടുണ്ട്. ഇനി ${inr(f, "balanceInr")} അടയ്ക്കണം: ${payTo(f)}`,
  fee_waiver_cleared: (f) => `ശരി. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറച്ചിട്ടുണ്ട്. ഇനി ഒന്നും അടയ്ക്കാനില്ല.`,
  fee_waiver_denied: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസ് മാറ്റേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്: ${payTo(f)}`,
  fee_discount_to_owner: (f) => `ഫീസ് മാറ്റാൻ എനിക്ക് സ്വയം കഴിയില്ല. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിനെക്കുറിച്ച് നിങ്ങൾ ചോദിച്ചതായി ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ തന്നെ സന്ദേശം അയയ്ക്കും.`,
  fee_request_waiting: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിനെക്കുറിച്ച് ഉടമയോട് നേരത്തേ ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ ലഭിക്കും.`,
  fee_refund_asked: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസായി അടച്ച ${inr(f, "paidInr")}-ൽ നിന്ന് ${inr(f, "refundInr")} തിരികെ നൽകാമോ എന്ന് ഉടമയോട് ചോദിച്ചിട്ടുണ്ട്. മറുപടി ഇവിടെ തന്നെ ലഭിക്കും.`,
  fee_refund_too_much: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസായി ${inr(f, "paidInr")} അടച്ചതായാണ് ഞങ്ങളുടെ രേഖയിൽ ഉള്ളത്, അതിനാൽ അതിൽ കൂടുതലുള്ള അഭ്യർത്ഥന എനിക്ക് കൈമാറാൻ കഴിയില്ല. തിരികെ വേണ്ട തുക പറയൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ.`,
  fee_refund_none: (f) => `${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിന്റെ പേയ്മെന്റ് രേഖയിൽ ഇല്ല, അതിനാൽ തിരികെ നൽകാൻ ഒന്നുമില്ല.`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} നിങ്ങൾക്ക് തിരികെ നൽകുന്നു.`,
  fee_refund_pending: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് ഉടമ ഉടൻ സ്ഥിരീകരിക്കും.`,
  fee_refund_checking: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് ഞങ്ങൾ പരിശോധിക്കുകയാണ്, സ്ഥിരീകരിച്ചാലുടൻ സന്ദേശം അയയ്ക്കാം.`,
  fee_refund_confirmed: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് ഉറപ്പായി. അത് തിരികെ വരുന്നുണ്ട്.`,
  fee_refund_approved: (f) => `ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. ${inr(f, "refundInr")} വഴിയിലാണ്.`,
  fee_refund_denied: () => "ഈ പേയ്മെന്റ് തിരികെ നൽകേണ്ടതില്ലെന്ന് ഉടമ തീരുമാനിച്ചു.",
  fee_refund_expired: (f) => `നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ടിനെക്കുറിച്ച് ഉടമ സമയത്തിനുള്ളിൽ മറുപടി നൽകിയില്ല, അതിനാൽ അത് അയച്ചിട്ടില്ല. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടുക.`,
  fee_link_failed: () => "ക്ഷമിക്കണം, ഇപ്പോൾ പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ അയച്ചിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.",
  fee_menu: (f) => `നമസ്കാരം! ഇത് ${f.businessName} ആണ്. ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ്: ${inr(f, "balanceInr")} അടയ്ക്കാനുണ്ട്. നിങ്ങൾ എന്താണ് ചെയ്യാൻ ആഗ്രഹിക്കുന്നത്?`,
  fee_didnt_understand: () => "ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. ദയവായി താഴെയുള്ള ഒരു ബട്ടൺ അമർത്തൂ, അല്ലെങ്കിൽ ഉടമയോട് സംസാരിക്കൂ.",
  fee_told_owner: () => "നിങ്ങൾക്ക് സംസാരിക്കണമെന്ന് ഉടമയെ അറിയിച്ചിട്ടുണ്ട്. അവർ ഇവിടെ തന്നെ സന്ദേശം അയയ്ക്കും.",
  fee_couldnt_tell_owner: () => "ക്ഷമിക്കണം, ഇപ്പോൾ ഉടമയെ അറിയിക്കാൻ കഴിഞ്ഞില്ല. കുറച്ച് മിനിറ്റിനു ശേഷം വീണ്ടും ശ്രമിക്കൂ.",
  voice_note: () => "ദയവായി സന്ദേശം ടൈപ്പ് ചെയ്യൂ; എനിക്ക് ഇപ്പോൾ വോയ്സ് നോട്ട് കേൾക്കാൻ കഴിയില്ല.",
  voice_note_retry: () => "ആ വോയ്‌സ് നോട്ട് എനിക്ക് മനസ്സിലായില്ല. ദയവായി നിങ്ങളുടെ സന്ദേശം ടൈപ്പ് ചെയ്ത് അയയ്ക്കൂ.",

  owner_waiver_request: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറയ്ക്കാൻ ആവശ്യപ്പെടുന്നു. ഫീസ് ${inr(f, "feeInr")} ആണ്, ഇപ്പോൾ ${inr(f, "balanceInr")} അടയ്ക്കാനുണ്ട്. "approve ${need(f, "requestRef")}" അല്ലെങ്കിൽ "deny ${need(f, "requestRef")}" എന്ന് മറുപടി നൽകുക.`,
  owner_waiver_applied: (f) => `നിങ്ങളുടെ ${inr(f, "waiverLimitInr")} പരിധിക്കുള്ളിൽ ചെയ്തു: ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ നിന്ന് ${inr(f, "waiverInr")} കുറച്ചു (${need(f, "customerPhone")}). ഇനി ${inr(f, "balanceInr")} അടയ്ക്കണം.`,
  owner_refund_request: (f) => `അനുമതി വേണം: ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസായി അടച്ച ${inr(f, "paidInr")}-ൽ നിന്ന് ${inr(f, "refundInr")} തിരികെ ചോദിക്കുന്നു. "approve ${need(f, "requestRef")}" അല്ലെങ്കിൽ "deny ${need(f, "requestRef")}" എന്ന് മറുപടി നൽകുക.`,
  owner_discount_note: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസിൽ (${inr(f, "feeInr")}) ഇളവ് ചോദിച്ചു, എത്രയെന്ന് പറഞ്ഞില്ല. ദയവായി അവർക്ക് സന്ദേശം അയയ്ക്കൂ. ഒന്നും മാറ്റിയിട്ടില്ല.`,
  owner_payment_claim: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "batchName")} ${need(f, "monthLabel")} ഫീസ് (${inr(f, "feeInr")}) അടച്ചു എന്ന് പറയുന്നു, പക്ഷേ പേയ്മെന്റ് രേഖയിൽ ${inr(f, "paidInr")} മാത്രമാണ് കാണുന്നത്. ദയവായി പരിശോധിച്ച് അവർക്ക് സന്ദേശം അയയ്ക്കൂ.`,
  owner_overpayment: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിനേക്കാൾ കൂടുതൽ അടച്ചു. അധികമായ ${inr(f, "refundInr")} തിരികെ നൽകുന്നു.`,
  // owner_link_failed rewritten 11 Nov (B71): machine-written, waits for a native speaker's review (REVIEW-ml.md)
  owner_link_failed: (f) => `പേയ്മെന്റ് ലിങ്ക് ഉണ്ടാക്കാൻ കഴിഞ്ഞില്ല: ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസ് (${need(f, "customerPhone")}), അതിനാൽ രക്ഷിതാവിന് ലിങ്ക് അയച്ചിട്ടില്ല. അടുത്ത ഓർമ്മപ്പെടുത്തലിലോ രക്ഷിതാവ് വീണ്ടും ചോദിക്കുമ്പോഴോ വീണ്ടും ശ്രമിക്കും. ഇത് ആവർത്തിച്ചാൽ, നിങ്ങളുടെ പേയ്മെന്റ് അക്കൗണ്ട് പരിശോധിക്കൂ, അല്ലെങ്കിൽ നിങ്ങളുടെ ഏജന്റ് സജ്ജമാക്കിയ ആളെ അറിയിക്കൂ.`,
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
  owner_approval_waiting: (f) => `നന്ദി. ${need(f, "customerPhone")}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ടിനുള്ള നിങ്ങളുടെ അനുമതി രേഖപ്പെടുത്തി. ഇനി മറ്റുള്ളവരിൽ നിന്ന് വേണ്ട അനുമതികൾ: ${need(f, "approvalsLeft")}. അവ ലഭിച്ച ശേഷമേ ഇത് അയയ്ക്കൂ.`,
  owner_approval_closed: (f) => `അറിയിപ്പ്: ${need(f, "customerPhone")}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ടിന് മറ്റുള്ളവർ അനുമതി നൽകി, അതിനാൽ ഇനി നിങ്ങളുടെ മറുപടി ആവശ്യമില്ല. നന്ദി.`,
  owner_approval_refused: (f) => `അറിയിപ്പ്: ${need(f, "customerPhone")}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ട് അനുമതി നൽകുന്നവരിൽ ഒരാൾ നിരസിച്ചു, അതിനാൽ ഇത് അയയ്ക്കില്ല, അവരെ അറിയിക്കും.`,
  owner_refund_settled: (f) => `റീഫണ്ട് പൂർത്തിയായി: ${need(f, "customerPhone")}-ന്റെ ${inr(f, "refundInr")}. നിങ്ങളുടെ ഏജന്റ് സജ്ജമാക്കിയ ആൾ ഇത് പരിശോധിച്ച് നടന്നതായി രേഖപ്പെടുത്തി, അതിനാൽ ഇത് വീണ്ടും അയയ്ക്കില്ല.`,
};

const kn: BaseSet = {
  fee_reminder: (f) => `ಶುಲ್ಕದ ನೆನಪು: ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕ ${inr(f, "balanceInr")}, ಕೊನೆಯ ದಿನಾಂಕ ${dueDate(f)}. ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_overdue: (f) => `ಶುಲ್ಕದ ನೆನಪು: ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕವನ್ನು ${dueDate(f)}ರಂದು ಪಾವತಿಸಬೇಕಿತ್ತು. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ: ${payTo(f)} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_overdue_late: (f) => `ಶುಲ್ಕದ ನೆನಪು: ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕವನ್ನು ${dueDate(f)}ರಂದು ಪಾವತಿಸಬೇಕಿತ್ತು. ${inr(f, "lateFeeInr")} ತಡ ಶುಲ್ಕ ಸೇರಿಸಲಾಗಿದೆ, ಆದ್ದರಿಂದ ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ: ${payTo(f)} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_received: (f) => `ಧನ್ಯವಾದ! ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "receivedInr")} ${f.businessName}-ಗೆ ಸಿಕ್ಕಿದೆ. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ. ನಿಮ್ಮ ರಸೀದಿ ಸಂಖ್ಯೆ ${need(f, "dueRef")}.`,
  fee_part_received: (f) => `ಧನ್ಯವಾದ! ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "receivedInr")} ${f.businessName}-ಗೆ ಸಿಕ್ಕಿದೆ. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ. ಉಳಿದದ್ದನ್ನು ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)} ಈ ನೆನಪುಗಳು ಬೇಡವಾದರೆ STOP ಎಂದು ಉತ್ತರಿಸಿ.`,
  fee_pay_link: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "balanceInr")} ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)}`,
  fee_already_paid: (f) => `ಹೌದು, ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ${inr(f, "paidInr")} ಪಾವತಿ ನಮಗೆ ಕಾಣಿಸುತ್ತಿದೆ. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ. ಧನ್ಯವಾದ.`,
  fee_claim_partial: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದಲ್ಲಿ ${inr(f, "paidInr")} ಪಾವತಿಯಾಗಿರುವುದು ಕಾಣಿಸುತ್ತಿದೆ, ಆದ್ದರಿಂದ ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ. ಉಳಿದದ್ದನ್ನು ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${payTo(f)}`,
  fee_claim_not_found: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ ಪಾವತಿ ಇನ್ನೂ ನಮಗೆ ಕಾಣಿಸುತ್ತಿಲ್ಲ. ಈಗಷ್ಟೇ ಪಾವತಿಸಿದ್ದರೆ ಕಾಣಿಸಲು ಕೆಲವು ನಿಮಿಷ ಬೇಕಾಗಬಹುದು. ಪರಿಶೀಲಿಸಲು ಮಾಲೀಕರಿಗೆ ಹೇಳಿದ್ದೇನೆ. ಪಾವತಿ ಆಗದಿದ್ದರೆ ಇಲ್ಲಿ ಪಾವತಿಸಬಹುದು: ${payTo(f)}`,
  fee_nothing_due: () => "ಈಗ ನಿಮ್ಮಿಂದ ಏನೂ ಬಾಕಿ ಇಲ್ಲ. ಧನ್ಯವಾದ!",
  fee_waiver_asked: (f) => `ಶುಲ್ಕವನ್ನು ನಾನೇ ಬದಲಾಯಿಸಲು ಆಗುವುದಿಲ್ಲ. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಬಹುದೇ ಎಂದು ಮಾಲೀಕರನ್ನು ಕೇಳಿದ್ದೇನೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ.`,
  fee_waiver_applied: (f) => `ಆಯಿತು. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲಾಗಿದೆ. ಈಗ ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು: ${payTo(f)}`,
  fee_waiver_cleared: (f) => `ಆಯಿತು. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲಾಗಿದೆ. ಇನ್ನೇನೂ ಬಾಕಿ ಇಲ್ಲ.`,
  fee_waiver_denied: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕವನ್ನು ಬದಲಾಯಿಸದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ: ${payTo(f)}`,
  fee_discount_to_owner: (f) => `ಶುಲ್ಕವನ್ನು ನಾನೇ ಬದಲಾಯಿಸಲು ಆಗುವುದಿಲ್ಲ. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದ ಬಗ್ಗೆ ನೀವು ಕೇಳಿದ್ದನ್ನು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.`,
  fee_request_waiting: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದ ಬಗ್ಗೆ ಮಾಲೀಕರನ್ನು ಈಗಾಗಲೇ ಕೇಳಲಾಗಿದೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ.`,
  fee_refund_asked: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕವಾಗಿ ಪಾವತಿಸಿದ ${inr(f, "paidInr")}ರಲ್ಲಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿಸಬಹುದೇ ಎಂದು ಮಾಲೀಕರನ್ನು ಕೇಳಿದ್ದೇನೆ. ಉತ್ತರ ಇಲ್ಲಿಯೇ ಸಿಗುತ್ತದೆ.`,
  fee_refund_too_much: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕವಾಗಿ ${inr(f, "paidInr")} ಪಾವತಿಯಾಗಿದೆ ಎಂದು ನಮ್ಮ ದಾಖಲೆಯಲ್ಲಿದೆ, ಆದ್ದರಿಂದ ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಕೋರಿಕೆಯನ್ನು ನಾನು ಮುಂದೆ ಕಳುಹಿಸಲು ಆಗುವುದಿಲ್ಲ. ಹಿಂತಿರುಗಿ ಬೇಕಾದ ಮೊತ್ತ ತಿಳಿಸಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.`,
  fee_refund_none: (f) => `${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದ ಯಾವುದೇ ಪಾವತಿ ದಾಖಲೆಯಲ್ಲಿ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಹಿಂತಿರುಗಿಸಲು ಏನೂ ಇಲ್ಲ.`,
  fee_refund_done: (f) => `${inr(f, "refundInr")} ನಿಮಗೆ ಹಿಂತಿರುಗಿಸಲಾಗುತ್ತಿದೆ.`,
  fee_refund_pending: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಮಾಲೀಕರು ಶೀಘ್ರದಲ್ಲೇ ದೃಢೀಕರಿಸುತ್ತಾರೆ.`,
  fee_refund_checking: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇವೆ, ದೃಢವಾದ ತಕ್ಷಣ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇವೆ.`,
  fee_refund_confirmed: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಖಚಿತವಾಗಿದೆ. ಅದು ಮರಳಿ ಬರುತ್ತಿದೆ.`,
  fee_refund_approved: (f) => `ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಅನ್ನು ಒಪ್ಪಿದ್ದಾರೆ. ${inr(f, "refundInr")} ದಾರಿಯಲ್ಲಿದೆ.`,
  fee_refund_denied: () => "ಈ ಪಾವತಿಯನ್ನು ಹಿಂತಿರುಗಿಸದಿರಲು ಮಾಲೀಕರು ತೀರ್ಮಾನಿಸಿದ್ದಾರೆ.",
  fee_refund_expired: (f) => `ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಬಗ್ಗೆ ಮಾಲೀಕರು ಸಮಯಕ್ಕೆ ಉತ್ತರಿಸಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಅದನ್ನು ಕಳುಹಿಸಿಲ್ಲ. ದಯವಿಟ್ಟು ${f.businessName}-ನ್ನು ನೇರವಾಗಿ ಸಂಪರ್ಕಿಸಿ.`,
  fee_link_failed: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಕಳುಹಿಸಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  fee_menu: (f) => `ನಮಸ್ಕಾರ! ಇದು ${f.businessName}. ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕ: ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು. ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?`,
  fee_didnt_understand: () => "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಳಗಿನ ಒಂದು ಬಟನ್ ಒತ್ತಿ, ಅಥವಾ ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತನಾಡಿ.",
  fee_told_owner: () => "ನೀವು ಮಾತನಾಡಲು ಬಯಸುತ್ತೀರಿ ಎಂದು ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಅವರು ಇಲ್ಲಿಯೇ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತಾರೆ.",
  fee_couldnt_tell_owner: () => "ಕ್ಷಮಿಸಿ, ಈಗ ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಲು ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  voice_note: () => "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ; ನನಗೆ ಇನ್ನೂ ವಾಯ್ಸ್ ನೋಟ್ ಕೇಳಲು ಆಗುವುದಿಲ್ಲ.",
  voice_note_retry: () => "ಆ ವಾಯ್ಸ್ ನೋಟ್ ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಟೈಪ್ ಮಾಡಿ ಕಳುಹಿಸಿ.",

  owner_waiver_request: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲು ಕೇಳಿದ್ದಾರೆ. ಶುಲ್ಕ ${inr(f, "feeInr")}, ಈಗ ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು. "approve ${need(f, "requestRef")}" ಅಥವಾ "deny ${need(f, "requestRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_waiver_applied: (f) => `ನಿಮ್ಮ ${inr(f, "waiverLimitInr")} ಮಿತಿಯೊಳಗೆ ಮಾಡಲಾಗಿದೆ: ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದಿಂದ ${inr(f, "waiverInr")} ಕಡಿಮೆ ಮಾಡಲಾಗಿದೆ (${need(f, "customerPhone")}). ಈಗ ${inr(f, "balanceInr")} ಪಾವತಿಸಬೇಕು.`,
  owner_refund_request: (f) => `ಅನುಮತಿ ಬೇಕು: ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕವಾಗಿ ಪಾವತಿಸಿದ ${inr(f, "paidInr")}ರಲ್ಲಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿ ಕೇಳಿದ್ದಾರೆ. "approve ${need(f, "requestRef")}" ಅಥವಾ "deny ${need(f, "requestRef")}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_discount_note: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕದ (${inr(f, "feeInr")}) ಮೇಲೆ ರಿಯಾಯಿತಿ ಕೇಳಿದ್ದಾರೆ, ಎಷ್ಟು ಎಂದು ಹೇಳಿಲ್ಲ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ. ಏನನ್ನೂ ಬದಲಾಯಿಸಿಲ್ಲ.`,
  owner_payment_claim: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "batchName")} ${need(f, "monthLabel")} ಶುಲ್ಕ (${inr(f, "feeInr")}) ಪಾವತಿಸಿದ್ದೇನೆ ಎನ್ನುತ್ತಾರೆ, ಆದರೆ ಪಾವತಿ ದಾಖಲೆಯಲ್ಲಿ ${inr(f, "paidInr")} ಮಾತ್ರ ಕಾಣಿಸುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  owner_overpayment: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರು ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕಕ್ಕಿಂತ ಹೆಚ್ಚು ಪಾವತಿಸಿದ್ದಾರೆ. ಹೆಚ್ಚುವರಿ ${inr(f, "refundInr")} ಹಿಂತಿರುಗಿಸಲಾಗುತ್ತಿದೆ.`,
  // owner_link_failed rewritten 11 Nov (B71): machine-written, waits for a native speaker's review (REVIEW-kn.md)
  owner_link_failed: (f) => `ಪಾವತಿ ಲಿಂಕ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ: ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕ (${need(f, "customerPhone")}), ಆದ್ದರಿಂದ ಪೋಷಕರಿಗೆ ಲಿಂಕ್ ಕಳುಹಿಸಿಲ್ಲ. ಮುಂದಿನ ನೆನಪಿನ ಸಂದೇಶದಲ್ಲಿ ಅಥವಾ ಪೋಷಕರು ಮತ್ತೆ ಕೇಳಿದಾಗ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲಾಗುತ್ತದೆ. ಇದು ಮತ್ತೆ ಮತ್ತೆ ಆದರೆ, ನಿಮ್ಮ ಪಾವತಿ ಖಾತೆಯನ್ನು ಪರಿಶೀಲಿಸಿ ಅಥವಾ ನಿಮ್ಮ ಏಜೆಂಟ್ ಅನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರಿಗೆ ತಿಳಿಸಿ.`,
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
  owner_approval_waiting: (f) => `ಧನ್ಯವಾದ. ${need(f, "customerPhone")} ಅವರ ${inr(f, "refundInr")} ರೀಫಂಡ್‌ಗೆ ನಿಮ್ಮ ಅನುಮತಿ ದಾಖಲಾಗಿದೆ. ಇನ್ನೂ ಇತರರಿಂದ ಬೇಕಾದ ಅನುಮತಿಗಳು: ${need(f, "approvalsLeft")}. ಅವು ಸಿಕ್ಕ ನಂತರವೇ ಇದನ್ನು ಕಳುಹಿಸಲಾಗುವುದು.`,
  owner_approval_closed: (f) => `ಸೂಚನೆ: ${need(f, "customerPhone")} ಅವರ ${inr(f, "refundInr")} ರೀಫಂಡ್‌ಗೆ ಇತರರು ಅನುಮತಿ ನೀಡಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಈಗ ನಿಮ್ಮ ಉತ್ತರ ಬೇಕಿಲ್ಲ. ಧನ್ಯವಾದ.`,
  owner_approval_refused: (f) => `ಸೂಚನೆ: ${need(f, "customerPhone")} ಅವರ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು ಅನುಮತಿ ನೀಡುವವರಲ್ಲಿ ಒಬ್ಬರು ನಿರಾಕರಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಕಳುಹಿಸುವುದಿಲ್ಲ, ಅವರಿಗೆ ತಿಳಿಸಲಾಗುವುದು.`,
  owner_refund_settled: (f) => `ರೀಫಂಡ್ ಆಗಿದೆ: ${need(f, "customerPhone")} ಅವರ ${inr(f, "refundInr")}. ನಿಮ್ಮ ಏಜೆಂಟ್ ಅನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರು ಇದನ್ನು ಪರಿಶೀಲಿಸಿ ಆಗಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದಾರೆ, ಆದ್ದರಿಂದ ಇದನ್ನು ಮತ್ತೆ ಕಳುಹಿಸುವುದಿಲ್ಲ.`,
};

// ---- UPI, marked paid by the owner (plan B33; modules/payments/owner-marked) ------------------------------------------------------------
// A centre that takes UPI: the parent pays the centre's own UPI ID (the QR picture, and the link with the UPI ID in every message that asks for money), and a
// payment counts only when the owner marks it received (the "Received" button, or "received <code>"). These messages never say the agent checked a payment. A
// refund is sent by the owner, and the parent hears "sent" only after the owner marks it so. Hindi, Malayalam and Kannada are machine-written and wait for a native
// speaker's review (REVIEW-ml.md, REVIEW-kn.md).
const payee = (f: MessageFacts) => need(f, "payee");
const code = (f: MessageFacts) => need(f, "upiCode");

const upiEn: UpiSet = {
  fee_upi_qr_caption: (f) => `Scan to pay ${inr(f, "balanceInr")} by UPI to ${payee(f)} for ${need(f, "studentName")}'s fee (${need(f, "dueRef")}).`,
  fee_upi_claim: (f) => `Thank you. The owner will look for your payment for ${need(f, "studentName")}'s ${need(f, "monthLabel")} fee in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message.`,
  fee_upi_refund_owed: (f) => `The owner will send ${inr(f, "refundInr")} back to you by UPI for ${need(f, "studentName")}'s fee. I'll message you when they mark it sent.`,
  fee_upi_refund_sent: (f) => `The owner has marked your ${inr(f, "refundInr")} refund for ${need(f, "studentName")}'s fee (${need(f, "dueRef")}) as sent by UPI. Please check your UPI app.`,
  owner_fee_upi_expected: (f) => `UPI payment to check: parent ${need(f, "customerPhone")} has been asked for ${inr(f, "balanceInr")} for ${need(f, "studentName")}'s ${need(f, "monthLabel")} fee (fee ${need(f, "dueRef")}). When it shows in your UPI app, tap Received or reply "received ${code(f)}". If a different amount came, reply "received ${code(f)}" and the amount.`,
  owner_fee_upi_claim: (f) => `Parent ${need(f, "customerPhone")} says they have paid ${need(f, "studentName")}'s ${need(f, "monthLabel")} fee (fee ${need(f, "dueRef")}). A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received ${code(f)}".`,
  owner_fee_upi_marked: (f) => `Thank you. ${inr(f, "receivedInr")} for fee ${need(f, "dueRef")} is marked paid by you.`,
  owner_fee_upi_part: (f) => `Thank you. ${inr(f, "receivedInr")} for fee ${need(f, "dueRef")} is marked paid by you. ${inr(f, "balanceInr")} is still to pay; when it arrives, tap Received or reply "received ${code(f)}".`,
  owner_fee_upi_already: () => "That payment is already marked. It is counted once.",
  owner_fee_upi_unknown: () => "I don't know that code. Please use the code in my latest message about the payment.",
  owner_fee_upi_refund_owed: (f) => `Refund to send: ${inr(f, "refundInr")} by UPI to parent ${need(f, "customerPhone")} (fee ${need(f, "dueRef")}). The agent never sends money. When you have sent it, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_fee_upi_refund_reminder: (f) => `Reminder: ${inr(f, "refundInr")} is still owed back to parent ${need(f, "customerPhone")} (fee ${need(f, "dueRef")}). When you have sent it by UPI, tap Refund sent or reply "refunded ${code(f)}".`,
  owner_fee_upi_refund_marked: (f) => `Thank you. The ${inr(f, "refundInr")} refund for fee ${need(f, "dueRef")} is marked sent, and the parent has been told.`,
};

const upiHi: UpiSet = {
  fee_upi_qr_caption: (f) => `${need(f, "studentName")} की फीस (${need(f, "dueRef")}) के लिए ${payee(f)} को UPI से ${inr(f, "balanceInr")} भेजने के लिए स्कैन करें।`,
  fee_upi_claim: (f) => `धन्यवाद। मालिक अपने UPI ऐप में ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस का आपका भुगतान देखकर पक्का करेंगे, फिर मैं आपको संदेश भेजूँगा। स्क्रीनशॉट भुगतान का सबूत नहीं है, इसलिए कृपया उस संदेश का इंतज़ार करें।`,
  fee_upi_refund_owed: (f) => `मालिक ${need(f, "studentName")} की फीस के ${inr(f, "refundInr")} UPI से आपको वापस भेजेंगे। जब वे इसे भेजा हुआ दर्ज करेंगे, मैं आपको संदेश भेजूँगा।`,
  fee_upi_refund_sent: (f) => `मालिक ने ${need(f, "studentName")} की फीस (${need(f, "dueRef")}) का आपका ${inr(f, "refundInr")} रिफंड UPI से भेजा हुआ दर्ज किया है। कृपया अपना UPI ऐप देखें।`,
  owner_fee_upi_expected: (f) => `जाँचने के लिए UPI भुगतान: अभिभावक ${need(f, "customerPhone")} से ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस (${need(f, "dueRef")}) के ${inr(f, "balanceInr")} माँगे गए हैं। जब यह आपके UPI ऐप में दिखे, तो "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें। अगर कोई और रकम आई है, तो "received ${code(f)}" के बाद रकम लिखें।`,
  owner_fee_upi_claim: (f) => `अभिभावक ${need(f, "customerPhone")} कह रहे हैं कि उन्होंने ${need(f, "studentName")} की ${need(f, "monthLabel")} की फीस (${need(f, "dueRef")}) भर दी है। स्क्रीनशॉट सबूत नहीं है: अपना UPI ऐप देखें। पैसे दिखें तो "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें।`,
  owner_fee_upi_marked: (f) => `धन्यवाद। फीस ${need(f, "dueRef")} के ${inr(f, "receivedInr")} आपने मिला हुआ दर्ज किया है।`,
  owner_fee_upi_part: (f) => `धन्यवाद। फीस ${need(f, "dueRef")} के ${inr(f, "receivedInr")} आपने मिला हुआ दर्ज किया है। ${inr(f, "balanceInr")} अभी बाकी है; आने पर "मिल गया" दबाएँ या "received ${code(f)}" लिखकर भेजें।`,
  owner_fee_upi_already: () => "यह भुगतान पहले ही दर्ज है। इसे एक ही बार गिना गया है।",
  owner_fee_upi_unknown: () => "मैं यह कोड नहीं पहचानता। कृपया उस भुगतान के बारे में मेरे सबसे नए संदेश वाला कोड इस्तेमाल करें।",
  owner_fee_upi_refund_owed: (f) => `वापस भेजना है: अभिभावक ${need(f, "customerPhone")} (फीस ${need(f, "dueRef")}) को UPI से ${inr(f, "refundInr")}। एजेंट कभी पैसे नहीं भेजता। भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded ${code(f)}" लिखकर भेजें।`,
  owner_fee_upi_refund_reminder: (f) => `याद दिलाना: अभिभावक ${need(f, "customerPhone")} (फीस ${need(f, "dueRef")}) को ${inr(f, "refundInr")} अभी भी वापस देना है। UPI से भेजने के बाद "रिफंड भेज दिया" दबाएँ या "refunded ${code(f)}" लिखकर भेजें।`,
  owner_fee_upi_refund_marked: (f) => `धन्यवाद। फीस ${need(f, "dueRef")} का ${inr(f, "refundInr")} रिफंड भेजा हुआ दर्ज हो गया है, और अभिभावक को बता दिया गया है।`,
};

const upiMl: UpiSet = {
  fee_upi_qr_caption: (f) => `${need(f, "studentName")}-ന്റെ ഫീസിനായി (${need(f, "dueRef")}) ${payee(f)}-ന് UPI വഴി ${inr(f, "balanceInr")} അയക്കാൻ സ്കാൻ ചെയ്യൂ.`,
  fee_upi_claim: (f) => `നന്ദി. ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിന്റെ നിങ്ങളുടെ പണമടവ് ഉടമ അവരുടെ UPI ആപ്പിൽ നോക്കി ഉറപ്പിക്കും, പിന്നെ ഞാൻ നിങ്ങൾക്ക് സന്ദേശം അയക്കും. സ്ക്രീൻഷോട്ട് പണമടച്ചതിന്റെ തെളിവല്ല, അതിനാൽ ആ സന്ദേശത്തിനായി കാത്തിരിക്കൂ.`,
  fee_upi_refund_owed: (f) => `ഉടമ ${need(f, "studentName")}-ന്റെ ഫീസിൽ നിന്ന് ${inr(f, "refundInr")} UPI വഴി നിങ്ങൾക്ക് തിരികെ അയക്കും. അയച്ചതായി ഉടമ രേഖപ്പെടുത്തുമ്പോൾ ഞാൻ സന്ദേശം അയക്കും.`,
  fee_upi_refund_sent: (f) => `ഉടമ ${need(f, "studentName")}-ന്റെ ഫീസിന്റെ (${need(f, "dueRef")}) നിങ്ങളുടെ ${inr(f, "refundInr")} റീഫണ്ട് UPI വഴി അയച്ചതായി രേഖപ്പെടുത്തി. ദയവായി നിങ്ങളുടെ UPI ആപ്പ് നോക്കൂ.`,
  owner_fee_upi_expected: (f) => `പരിശോധിക്കാനുള്ള UPI പണമടവ്: രക്ഷിതാവ് ${need(f, "customerPhone")}-നോട് ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസിനായി (${need(f, "dueRef")}) ${inr(f, "balanceInr")} ചോദിച്ചിട്ടുണ്ട്. നിങ്ങളുടെ UPI ആപ്പിൽ കാണുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക. മറ്റൊരു തുക ആണ് വന്നതെങ്കിൽ "received ${code(f)}" എന്നതിന് ശേഷം തുക എഴുതുക.`,
  owner_fee_upi_claim: (f) => `രക്ഷിതാവ് ${need(f, "customerPhone")} പറയുന്നു: ${need(f, "studentName")}-ന്റെ ${need(f, "monthLabel")} ഫീസ് (${need(f, "dueRef")}) അടച്ചു. സ്ക്രീൻഷോട്ട് തെളിവല്ല: നിങ്ങളുടെ UPI ആപ്പ് നോക്കുക. പണം ഉണ്ടെങ്കിൽ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_fee_upi_marked: (f) => `നന്ദി. ഫീസ് ${need(f, "dueRef")}-ന്റെ ${inr(f, "receivedInr")} നിങ്ങൾ കിട്ടിയതായി രേഖപ്പെടുത്തി.`,
  owner_fee_upi_part: (f) => `നന്ദി. ഫീസ് ${need(f, "dueRef")}-ന്റെ ${inr(f, "receivedInr")} നിങ്ങൾ കിട്ടിയതായി രേഖപ്പെടുത്തി. ${inr(f, "balanceInr")} ഇനിയും അടയ്ക്കാനുണ്ട്; അത് എത്തുമ്പോൾ "കിട്ടി" അമർത്തുക, അല്ലെങ്കിൽ "received ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_fee_upi_already: () => "ആ പണമടവ് ഇതിനകം രേഖപ്പെടുത്തിയിട്ടുണ്ട്. അത് ഒരു തവണ മാത്രം കണക്കാക്കും.",
  owner_fee_upi_unknown: () => "ആ കോഡ് എനിക്ക് അറിയില്ല. ആ പണമടവിനെക്കുറിച്ചുള്ള എന്റെ ഏറ്റവും പുതിയ സന്ദേശത്തിലെ കോഡ് ഉപയോഗിക്കുക.",
  owner_fee_upi_refund_owed: (f) => `തിരികെ അയക്കേണ്ടത്: രക്ഷിതാവ് ${need(f, "customerPhone")}-ന് (ഫീസ് ${need(f, "dueRef")}) UPI വഴി ${inr(f, "refundInr")}. ഏജന്റ് ഒരിക്കലും പണം അയക്കില്ല. അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_fee_upi_refund_reminder: (f) => `ഓർമ്മപ്പെടുത്തൽ: രക്ഷിതാവ് ${need(f, "customerPhone")}-ന് (ഫീസ് ${need(f, "dueRef")}) ${inr(f, "refundInr")} ഇനിയും തിരികെ നൽകാനുണ്ട്. UPI വഴി അയച്ച ശേഷം "റീഫണ്ട് അയച്ചു" അമർത്തുക, അല്ലെങ്കിൽ "refunded ${code(f)}" എന്ന് മറുപടി അയക്കുക.`,
  owner_fee_upi_refund_marked: (f) => `നന്ദി. ഫീസ് ${need(f, "dueRef")}-ന്റെ ${inr(f, "refundInr")} റീഫണ്ട് അയച്ചതായി രേഖപ്പെടുത്തി, രക്ഷിതാവിനെ അറിയിച്ചു.`,
};

const upiKn: UpiSet = {
  fee_upi_qr_caption: (f) => `${need(f, "studentName")} ಅವರ ಶುಲ್ಕಕ್ಕಾಗಿ (${need(f, "dueRef")}) ${payee(f)} ಗೆ UPI ಮೂಲಕ ${inr(f, "balanceInr")} ಪಾವತಿಸಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.`,
  fee_upi_claim: (f) => `ಧನ್ಯವಾದ. ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕದ ನಿಮ್ಮ ಪಾವತಿಯನ್ನು ಮಾಲೀಕರು ತಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡಿ ಖಚಿತಪಡಿಸುತ್ತಾರೆ, ನಂತರ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪಾವತಿಯ ಪುರಾವೆ ಅಲ್ಲ, ಆದ್ದರಿಂದ ದಯವಿಟ್ಟು ಆ ಸಂದೇಶಕ್ಕಾಗಿ ಕಾಯಿರಿ.`,
  fee_upi_refund_owed: (f) => `ಮಾಲೀಕರು ${need(f, "studentName")} ಅವರ ಶುಲ್ಕದ ${inr(f, "refundInr")} ಅನ್ನು UPI ಮೂಲಕ ನಿಮಗೆ ಮರಳಿ ಕಳುಹಿಸುತ್ತಾರೆ. ಕಳುಹಿಸಿದೆ ಎಂದು ಅವರು ದಾಖಲಿಸಿದಾಗ ನಾನು ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇನೆ.`,
  fee_upi_refund_sent: (f) => `ಮಾಲೀಕರು ${need(f, "studentName")} ಅವರ ಶುಲ್ಕದ (${need(f, "dueRef")}) ನಿಮ್ಮ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಅನ್ನು UPI ಮೂಲಕ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ದಾಖಲಿಸಿದ್ದಾರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ.`,
  owner_fee_upi_expected: (f) => `ಪರಿಶೀಲಿಸಬೇಕಾದ UPI ಪಾವತಿ: ಪೋಷಕರು ${need(f, "customerPhone")} ಅವರಿಗೆ ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕಕ್ಕಾಗಿ (${need(f, "dueRef")}) ${inr(f, "balanceInr")} ಕೇಳಲಾಗಿದೆ. ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಕಂಡಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ. ಬೇರೆ ಮೊತ್ತ ಬಂದಿದ್ದರೆ "received ${code(f)}" ನಂತರ ಮೊತ್ತ ಬರೆಯಿರಿ.`,
  owner_fee_upi_claim: (f) => `ಪೋಷಕರು ${need(f, "customerPhone")} ಹೇಳುತ್ತಿದ್ದಾರೆ: ${need(f, "studentName")} ಅವರ ${need(f, "monthLabel")} ಶುಲ್ಕ (${need(f, "dueRef")}) ಪಾವತಿಸಿದ್ದೇವೆ. ಸ್ಕ್ರೀನ್‌ಶಾಟ್ ಪುರಾವೆ ಅಲ್ಲ: ನಿಮ್ಮ UPI ಆ್ಯಪ್ ನೋಡಿ. ಹಣ ಇದ್ದರೆ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_fee_upi_marked: (f) => `ಧನ್ಯವಾದ. ಶುಲ್ಕ ${need(f, "dueRef")} ರ ${inr(f, "receivedInr")} ಬಂದಿದೆ ಎಂದು ನೀವು ದಾಖಲಿಸಿದ್ದೀರಿ.`,
  owner_fee_upi_part: (f) => `ಧನ್ಯವಾದ. ಶುಲ್ಕ ${need(f, "dueRef")} ರ ${inr(f, "receivedInr")} ಬಂದಿದೆ ಎಂದು ನೀವು ದಾಖಲಿಸಿದ್ದೀರಿ. ${inr(f, "balanceInr")} ಇನ್ನೂ ಬಾಕಿ ಇದೆ; ಅದು ಬಂದಾಗ "ಬಂದಿದೆ" ಒತ್ತಿ, ಅಥವಾ "received ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_fee_upi_already: () => "ಆ ಪಾವತಿ ಈಗಾಗಲೇ ದಾಖಲಾಗಿದೆ. ಅದನ್ನು ಒಂದೇ ಬಾರಿ ಎಣಿಸಲಾಗುತ್ತದೆ.",
  owner_fee_upi_unknown: () => "ಆ ಕೋಡ್ ನನಗೆ ಗೊತ್ತಿಲ್ಲ. ಆ ಪಾವತಿಯ ಬಗ್ಗೆ ನನ್ನ ಇತ್ತೀಚಿನ ಸಂದೇಶದಲ್ಲಿರುವ ಕೋಡ್ ಬಳಸಿ.",
  owner_fee_upi_refund_owed: (f) => `ಮರಳಿ ಕಳುಹಿಸಬೇಕು: ಪೋಷಕರು ${need(f, "customerPhone")} (ಶುಲ್ಕ ${need(f, "dueRef")}) ಅವರಿಗೆ UPI ಮೂಲಕ ${inr(f, "refundInr")}. ಏಜೆಂಟ್ ಎಂದಿಗೂ ಹಣ ಕಳುಹಿಸುವುದಿಲ್ಲ. ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_fee_upi_refund_reminder: (f) => `ನೆನಪಿಸುವುದು: ಪೋಷಕರು ${need(f, "customerPhone")} (ಶುಲ್ಕ ${need(f, "dueRef")}) ಅವರಿಗೆ ${inr(f, "refundInr")} ಇನ್ನೂ ಮರಳಿ ಕೊಡಬೇಕಿದೆ. UPI ಮೂಲಕ ಕಳುಹಿಸಿದ ನಂತರ "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ" ಒತ್ತಿ, ಅಥವಾ "refunded ${code(f)}" ಎಂದು ಉತ್ತರಿಸಿ.`,
  owner_fee_upi_refund_marked: (f) => `ಧನ್ಯವಾದ. ಶುಲ್ಕ ${need(f, "dueRef")} ರ ${inr(f, "refundInr")} ರೀಫಂಡ್ ಕಳುಹಿಸಲಾಗಿದೆ ಎಂದು ದಾಖಲಾಗಿದೆ, ಪೋಷಕರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
};

// ---- the licence's wind-down and final stop (plan B13) --------------------------------------------------------------------------------------------------
// The parent hears that online fee payment is paused and to contact the centre: no promise to collect later. The owner hears once, plainly, and is told who to
// contact; the final stop's notice says the partner's service has ended, how many are still open, and that hello@geometer.dev will connect the owner with another local partner (no copy of the records goes to the owner: it goes only to the builder or partner). Hindi, Malayalam and
// Kannada are machine-written, like the rest of those packs, and wait for a native speaker's review (REVIEW-ml.md, REVIEW-kn.md).
const partner = (f: MessageFacts) => need(f, "partner");
const openFees = (f: MessageFacts) => need(f, "openFeesCount");

const licenceEn: LicenceSet = {
  fee_paused: (f) => `Online fee payment is paused for now. Please contact ${f.businessName} directly.`,
  owner_licence_paused: (f) => `Notice: online fee payment for ${f.businessName} is paused for now. Fees already paid, and refunds, still go through. Please contact ${partner(f)}.`,
  owner_licence_stopped: (f) => `Notice: online fee collection for ${f.businessName} has stopped, because the service from ${partner(f)} has ended. Fees from your students still open: ${openFees(f)}. To keep it running with another local partner, write to hello@geometer.dev and Geometer will connect you.`,
};
const licenceHi: LicenceSet = {
  fee_paused: (f) => `ऑनलाइन फ़ीस भुगतान अभी रुका हुआ है। कृपया सीधे ${f.businessName} से संपर्क करें।`,
  owner_licence_paused: (f) => `सूचना: ${f.businessName} का ऑनलाइन फ़ीस भुगतान अभी रुका हुआ है। जमा हो चुकी फ़ीस और रिफंड पहले की तरह चलते रहेंगे। इस बारे में कृपया ${partner(f)} से संपर्क करें।`,
  owner_licence_stopped: (f) => `सूचना: ${f.businessName} की ऑनलाइन फ़ीस वसूली बंद हो गई है, क्योंकि ${partner(f)} की सेवा समाप्त हो गई है। आपके विद्यार्थियों की बाकी फ़ीस: ${openFees(f)}। इसे किसी दूसरे स्थानीय पार्टनर के साथ जारी रखने के लिए hello@geometer.dev पर लिखें, Geometer आपको जोड़ देगा।`,
};
const licenceMl: LicenceSet = {
  fee_paused: (f) => `ഓൺലൈൻ ഫീസ് അടയ്ക്കൽ തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. ദയവായി ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
  owner_licence_paused: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഓൺലൈൻ ഫീസ് അടയ്ക്കൽ തൽക്കാലം നിർത്തിവച്ചിരിക്കുന്നു. അടച്ച ഫീസും റീഫണ്ടുകളും തുടർന്നും നടക്കും. ഇതിനെക്കുറിച്ച് ദയവായി ${partner(f)}-നെ ബന്ധപ്പെടൂ.`,
  owner_licence_stopped: (f) => `അറിയിപ്പ്: ${f.businessName}-ന്റെ ഓൺലൈൻ ഫീസ് പിരിവ് നിർത്തി, കാരണം ${partner(f)} നൽകിയിരുന്ന സേവനം അവസാനിച്ചു. നിങ്ങളുടെ വിദ്യാർത്ഥികളുടെ ബാക്കിയുള്ള ഫീസുകൾ: ${openFees(f)}. മറ്റൊരു പ്രാദേശിക പാർട്ണറുമായി ഇത് തുടരാൻ hello@geometer.dev എന്ന വിലാസത്തിലേക്ക് എഴുതൂ, Geometer നിങ്ങളെ ബന്ധിപ്പിക്കും.`,
};
const licenceKn: LicenceSet = {
  fee_paused: (f) => `ಆನ್‌ಲೈನ್ ಶುಲ್ಕ ಪಾವತಿ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನೇರವಾಗಿ ${f.businessName} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_paused: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಶುಲ್ಕ ಪಾವತಿ ಸದ್ಯಕ್ಕೆ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಈಗಾಗಲೇ ಪಾವತಿಸಿದ ಶುಲ್ಕಗಳು ಮತ್ತು ರೀಫಂಡ್‌ಗಳು ಮುಂದುವರಿಯುತ್ತವೆ. ಈ ಬಗ್ಗೆ ದಯವಿಟ್ಟು ${partner(f)} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
  owner_licence_stopped: (f) => `ಸೂಚನೆ: ${f.businessName}-ನ ಆನ್‌ಲೈನ್ ಶುಲ್ಕ ಸಂಗ್ರಹ ನಿಂತಿದೆ, ಏಕೆಂದರೆ ${partner(f)} ನೀಡುತ್ತಿದ್ದ ಸೇವೆ ಮುಗಿದಿದೆ. ನಿಮ್ಮ ವಿದ್ಯಾರ್ಥಿಗಳ ಬಾಕಿ ಶುಲ್ಕಗಳು: ${openFees(f)}. ಇನ್ನೊಬ್ಬ ಸ್ಥಳೀಯ ಪಾರ್ಟ್ನರ್ ಜೊತೆ ಇದನ್ನು ಮುಂದುವರಿಸಲು hello@geometer.dev ವಿಳಾಸಕ್ಕೆ ಬರೆಯಿರಿ, Geometer ನಿಮ್ಮನ್ನು ಜೋಡಿಸುತ್ತದೆ.`,
};

// ---- the wait for a Guard is over (checkpoint item 8, 11 Nov 2026) ------------------------------------------------------------------------------------------------
// Hindi, Malayalam and Kannada are machine-written, like the rest of those packs, and wait for a native speaker's review (the REVIEW sheets list them; Deferred.md says so).
// The shop's name is not given a case ending: the sentence that names it is built the way `fee_paused` is.
const waitEn: GuardWaitSet = {
  fee_wait_over: (f) => `Sorry, I could not finish your request: the fee system is not answering just now. Your message is on the owner's to-do list. Please write again later, or contact ${f.businessName} directly.`,
};
const waitHi: GuardWaitSet = {
  fee_wait_over: (f) => `क्षमा करें, मैं आपका अनुरोध पूरा नहीं कर पाया: फ़ीस सिस्टम अभी जवाब नहीं दे रहा है। आपका संदेश मालिक की काम की सूची में है। कृपया बाद में फिर लिखें, या सीधे ${f.businessName} से संपर्क करें।`,
};
const waitMl: GuardWaitSet = {
  fee_wait_over: (f) => `ക്ഷമിക്കണം, നിങ്ങളുടെ അഭ്യർത്ഥന പൂർത്തിയാക്കാൻ കഴിഞ്ഞില്ല: ഫീസ് സംവിധാനം ഇപ്പോൾ പ്രതികരിക്കുന്നില്ല. നിങ്ങളുടെ സന്ദേശം ഉടമയുടെ ചെയ്യാനുള്ള കാര്യങ്ങളുടെ പട്ടികയിലുണ്ട്. ദയവായി പിന്നീട് വീണ്ടും എഴുതൂ, അല്ലെങ്കിൽ ${f.businessName}-നെ നേരിട്ട് ബന്ധപ്പെടൂ.`,
};
const waitKn: GuardWaitSet = {
  fee_wait_over: (f) => `ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಆಗಲಿಲ್ಲ: ಶುಲ್ಕ ವ್ಯವಸ್ಥೆ ಈಗ ಪ್ರತಿಕ್ರಿಯಿಸುತ್ತಿಲ್ಲ. ನಿಮ್ಮ ಸಂದೇಶ ಮಾಲೀಕರ ಮಾಡಬೇಕಾದ ಕೆಲಸಗಳ ಪಟ್ಟಿಯಲ್ಲಿದೆ. ದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಬರೆಯಿರಿ, ಅಥವಾ ನೇರವಾಗಿ ${f.businessName} ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
};

export const TEMPLATES: Record<Language, TemplateSet> = { en: { ...en, ...upiEn, ...licenceEn, ...waitEn }, hi: { ...hi, ...upiHi, ...licenceHi, ...waitHi }, ml: { ...ml, ...upiMl, ...licenceMl, ...waitMl }, kn: { ...kn, ...upiKn, ...licenceKn, ...waitKn } };

/** Write one message from the record. Throws if the record lacks something the message needs. */
export function render(id: TemplateId, facts: MessageFacts): string {
  return TEMPLATES[facts.language][id](facts);
}
