// The Fees agent: handle(event) processes ONE inbound message, ONE payment event, ONE answer of the approvals relay, or ONE tick of the clock, and returns. Each call is
// a separate step, so the engine can later drive the agent one task at a time.
//
// How it stays honest (the design rules in the implementation plan):
//  - "Paid" is judged from the payments service's own record and nothing else. Before a reminder goes out, and when a parent says "I already paid", the agent reads
//    the payments on the fee's links again. What a parent says never marks a fee paid; what a webhook says is only a reason to look.
//  - After a lost reply it LOOKS before it retries (by the fee's reference), so a retry cannot make a second link.
//  - Every parent message is one of the templates, checked against the record before it is sent. "Received" goes out only when the record holds the money.
//  - A discount or a waiver is never offered. A request above the waiver limit goes to the owner for THAT amount on THAT fee at THAT balance, and is applied only if it
//    is still exactly that when the owner says yes. A refund is never more than the payment, at most one per payment, and above the limit Guard holds it.
// The care that is the same for every template is in modules/: sending a message (messaging/say.ts), making a payment link (payments/links.ts), asking for a refund and
// following Guard's hold (payments/refunds.ts), reading a message with the month's AI allowance (understanding/reader.ts) and reminders (reminders/reminders.ts).
// What is left here is Fees: the student's fee for a month, its states and its words.
//
// What the centre's payment module can do decides every payment branch, never its name (B71: modules/payments/providers). A module that cannot confirm a payment by
// itself (UPI, the default, plan B33) has no payment service the agent can read: the parent pays the centre directly and a payment counts only when the owner marks it
// received, from their own number, with a one-use code (modules/payments/owner-marked). The requests and marks live in this agent's store and are read through the same
// Payments shape, so the owner's marks are counted by the same `count` a gateway's payments are: "paid is judged from the payment record" is one flow. With a module
// that cannot refund by itself a refund is never sent by the agent: the owner owes it, is reminded, and the parent hears "sent" only after the owner marks it. A
// screenshot asks the owner to look.
//
// The licence (plan B13; modules/licence). While the centre's lease puts it in its WIND-DOWN, the agent takes no new work: a parent who asks to pay is answered "online
// fee payment is paused, please contact the centre", no new fee link is made, no month's fees are opened, no late fee is added and the reminders that fall due are passed
// over (none is kept to send later). Payments from links sent earlier are still counted, receipts still go, and refunds go on. In the FINAL STOP the agent also closes the
// open fee links (where the module can cancel one) and sends nothing more. This is the runtime's own check of the lease: Guard's offline check (`subscription_suspended`)
// is not built yet.
import { RELAY_CODE_REPLY } from "../../../../modules/approvals/code.ts";
import { approverNumbers, ownerAsked } from "../../../../modules/approvals/people.ts";
import { HANDOVER_ACTION, handoverHash, parseHandoverReply } from "../../../../modules/approvals/handover.ts";
import { handleOwnerTerms } from "../../../../modules/terms/owner.ts";
import type { TermsFile } from "../../../../modules/terms/terms.ts";
import { GUARD_WAIT_ENTRY, RECOVERY_ENTRY, guardWaitLine } from "../../../../modules/unfinished/registry.ts";
import { ApiError, TimeoutError } from "../../../../modules/core/faults.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { HOUR, MINUTE, addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { LICENCE_RULE, UNRESTRICTED, guardLicenceDecision } from "../../../../modules/licence/rules.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { InteractiveMessage } from "../../../../modules/language/interactive.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import type { InboundMessage, Messaging } from "../../../../modules/messaging/messaging.ts";
import { createSay } from "../../../../modules/messaging/say.ts";
import { detectLanguage } from "../../../../modules/understanding/rules.ts";
import { ensureLink as makeLink } from "../../../../modules/payments/links.ts";
import type { Payment, PaymentEvent, PaymentRequest, Payments } from "../../../../modules/payments/payments.ts";
import { createRefunds } from "../../../../modules/payments/refunds.ts";
import type { Action, ActionRecord, Outcome } from "../../../../modules/record/record.ts";
import { takeDue } from "../../../../modules/reminders/reminders.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import { RULES } from "../../../../modules/understanding/model.ts";
import { createReader } from "../../../../modules/understanding/reader.ts";
import { coerceIntent } from "./adapters/model.ts";
import type { Intent, IntentParser, ParseOptions } from "./adapters/model.ts";
import { balanceInr, balancePaise, duesOf, factsFor, monthKey, moveTo, newDue, newRequestId, openDues, owedPaise, paidPaise, register } from "./due.ts";
import type { CountedPayment, Customer, Due, Pending, Store } from "./due.ts";
import { LABELS, buttonsFor, intentFromReply } from "./language/interactive.ts";
import type { Choice } from "../../../../modules/language/interactive.ts";
import { emptyMarkState, markReceived, markRefund, oweRefund, reminded, remindersDue, markedPayments } from "../../../../modules/payments/owner-marked/ledger.ts";
import type { OwedRefund, MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { parseMarkReply } from "../../../../modules/payments/owner-marked/owner.ts";
import type { MarkReply } from "../../../../modules/payments/owner-marked/owner.ts";
import { ownerMarkChoices } from "../../../../modules/payments/owner-marked/buttons.ts";
import { MARK_ACTIONS } from "../../../../modules/payments/owner-marked/obligations.ts";
import { capabilitiesOf, ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import type { ButtonId } from "./language/interactive.ts";
import { templateMessage } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "./language/templates.ts";
import type { MessageFacts, TemplateId } from "./language/templates.ts";
import { checkFeeLink, checkMessageMatchesRecord, checkNoReminderOncePaid, checkOneRefundPerPayment, checkPaidOnlyWhenRecorded, checkReminderCap, checkRefundLimit, checkWaiver } from "./limits.ts";
import { highestDueInr } from "./settings.ts";
import type { Settings } from "./settings.ts";

export interface AgentDeps {
  settings: Settings;
  clock: Clock;
  payments: Payments;
  messaging: Messaging;
  parser: IntentParser;
  record: ActionRecord;
  store: Store;
  /** The monthly AI allowance and the outside switch (modules/understanding/ai-state.ts). Left out: no limit, no switch; a model that fails still puts the agent in button mode for a few minutes. */
  ai?: AiPolicy;
  /** An owner-marked centre: make the QR picture of its pay link and put it where WhatsApp can fetch it (modules/payments/owner-marked/qr-image.ts). Left out, or null: the words carry the link and the UPI ID. */
  qrImage?: (text: string) => Promise<string | null>;
  /** The centre's licence right now (modules/licence; the runtime reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
  /** B72: the shop terms the owner can read and agree to on WhatsApp (modules/terms). Left out, or returning undefined: the feature is off for this shop. */
  terms?: () => TermsFile | undefined;
}

export type AgentEvent =
  | { kind: "message"; message: InboundMessage } // a parent's (or the owner's) WhatsApp message
  | { kind: "payment_event"; event: PaymentEvent } // a gateway's webhook, read by the inbox into the neutral events
  // The approvals relay says what the owner decided about a refund Guard is holding. It carries no authority: Guard releases the refund only if its own record says the
  // owner approved, so a forged "approve" makes the agent ask Guard once more and nothing else.
  | { kind: "approval_decision"; approval: string; decision: "approve" | "deny"; id?: string }
  // The panel's to-do list asks the agent to look again or ask again about one fee (modules/unfinished). It carries no authority: the agent does what it does every day, through Guard.
  | { kind: "recovery"; id: string; case: string; action: string }
  | { kind: "tick" }; // time has passed: open the month's fees, add late fees and send due reminders

export interface Agent {
  handle(event: AgentEvent): Promise<void>;
  /** The wait for a Guard is over and this event's work is not done (modules/runtime/guard-wait.ts). With `tell`, the parent also gets the centre's words for it. */
  giveUp(event: AgentEvent, why: { service: string; tell: boolean }): Promise<void>;
}

const MIDNIGHT = { hour: 0, minute: 0 };
const HOURLY = HOUR; // the owner is told about the same parent at most this often

/** Buttons with words above them; `choices` are the owner's UPI buttons (each carries its one-use code) instead of the named ones. */
type Offer = { kind: "buttons"; buttons: ButtonId[]; dueId?: string; body?: TemplateId[]; choices?: Choice[] };
interface SayArgs { booking: Due | null; phone: string; to: "customer" | "owner"; templates: TemplateId[]; receivedInr?: number; waiverInr?: number; refundInr?: number; paidInr?: number; requestRef?: string; shown?: Decision[]; reminder?: boolean; readOk?: boolean; action?: Action; offer?: Offer; image?: { link: string; caption: TemplateId[] }; upiCode?: string }

export function createAgent(deps: AgentDeps): Agent {
  const { settings, clock, messaging, parser, record, store } = deps;
  // B71: what the payment module can do, asked once. A module that cannot confirm a payment by itself is marked paid by the owner: the requests and the owner's
  // marks live in this agent's own store (its `upi` key, as it always was) and are read through the same Payments shape as a gateway's, and deps.payments is never
  // called. One that cannot refund by itself has the owner pay refunds back, tracked in the same store.
  const can = capabilitiesOf(settings.payment);
  const ownerConfirms = !can.confirmsAutomatically;
  const ownerRefunds = !can.refundsAutomatically;
  const marked = ownerMarkedOf(settings.payment);
  if (ownerConfirms && !marked) throw new Error("This payment module cannot confirm a payment by itself and says no way for the owner to be paid: it cannot run.");
  const markState = ownerConfirms || ownerRefunds ? (store.upi ??= emptyMarkState()) : undefined;
  const payments: Payments = ownerConfirms ? markedPayments(markState!, marked!.payLink, clock) : deps.payments;
  const policy: AiPolicy = deps.ai ?? {};
  const licence = deps.licence ?? (() => UNRESTRICTED);
  const tz = settings.timezone;
  const owner = settings.owner.whatsapp;
  // B37: with other approvers, a refund the owner's own command asks for names the owner (Geo-Requested-By), and the others' code replies are the relay's
  const askedByOwner = ownerAsked(settings.approvers);
  const approverDigits = approverNumbers(settings.approvers);
  const parseContext = { languages: settings.languages };
  const highestInr = highestDueInr(settings);
  store.startedAtMs ??= clock.now(); // the day this agent first ran: a month whose first reminder day was before it is not chased

  const customerOf = (phone: string): Customer => {
    let c = store.customers.get(phone);
    if (!c) { c = { phone, optedOut: false }; store.customers.set(phone, c); }
    return c;
  };
  const languageOf = (phone: string, due?: Due | null): Language => due?.language ?? store.customers.get(phone)?.language ?? settings.languages[0];

  function log(due: Due | null, phone: string, action: Action, outcome: Outcome, inputs: unknown, more: { decisions?: Decision[]; notes?: string; refs?: Record<string, string>; language?: Language } = {}) {
    return record.append({ conversation: phone, booking: due?.id || null, action, inputs, outcome, language: languageOf(phone, due), ...more });
  }

  // ---- saying things ---------------------------------------------------------------------------------------------

  /**
   * The one way a message leaves the agent (modules/messaging/say.ts). What is Fees' own is given here: the facts, the buttons, and the gates. A reminder passes
   * three: no reminder once the payment record shows the fee paid (judged from what the agent has just read, and not sent at all if it could not be read), no more than
   * the monthly cap, and STOP. "Received" and "nothing more is due" pass the check that the payment record holds the money.
   */
  const say = createSay<SayArgs, MessageFacts>({
    messaging,
    voice: {
      render: (id, facts) => render(id as TemplateId, facts),
      templateMessage: (a) => templateMessage({ ...a, ids: a.ids as TemplateId[] }),
      genericNames: TEMPLATE_NAMES,
      matches: (text, facts) => checkMessageMatchesRecord({ text, facts }),
    },
    owner: { whatsapp: owner, language: settings.owner.language },
    languageOf: (phone, due) => languageOf(phone, due),
    optedOut: (phone) => customerOf(phone).optedOut,
    factsFor: (a, language) => factsFor(settings, a.booking, language, { customerPhone: a.phone, refundInr: a.refundInr, receivedInr: a.receivedInr, waiverInr: a.waiverInr, requestRef: a.requestRef, paidInr: a.paidInr, upiCode: a.upiCode }),
    interactiveFor: (a, facts, language): InteractiveMessage => {
      const offer = a.offer!;
      return { body: (offer.body ?? a.templates).map((id) => render(id, facts)).join(" "), buttons: offer.choices ?? buttonsFor(language, offer.buttons, offer.dueId) };
    },
    inputsOf: (a) => ({ refundInr: a.refundInr, receivedInr: a.receivedInr, waiverInr: a.waiverInr, requestRef: a.requestRef }),
    gates: (a) => {
      const due = a.booking;
      const out: Decision[] = [];
      if (a.to === "customer" && a.reminder && due) {
        out.push(checkNoReminderOncePaid({ record, dueId: due.id, owedPaise: owedPaise(due), readOk: a.readOk === true }));
        out.push(checkReminderCap({ sent: due.remindersSent, maxPerMonth: settings.reminders.maxPerMonth }));
      }
      if (due && a.templates.some((t) => t === "fee_received" || t === "fee_already_paid")) out.push(checkPaidOnlyWhenRecorded({ record, dueId: due.id, owedPaise: owedPaise(due), needsAll: true }));
      if (due && a.templates.includes("fee_part_received")) out.push(checkPaidOnlyWhenRecorded({ record, dueId: due.id, owedPaise: owedPaise(due), needsAll: false }));
      if (licence().state === "stopped") out.push(stoppedGate);
      return out;
    },
    log: (due, phone, action, outcome, inputs, more) => log(due, phone, action, outcome, inputs, more),
    heldBack: async (a) => { await say({ booking: a.booking, phone: a.phone, to: "owner", templates: ["owner_message_held"] }); },
  });

  type More = Omit<SayArgs, "booking" | "phone" | "to" | "templates">;
  const tellCustomer = (due: Due | null, phone: string, templates: TemplateId[], more: More = {}) => say({ booking: due, phone, to: "customer", templates, ...more });
  const tellOwner = (due: Due | null, phone: string, template: TemplateId, more: More = {}) => say({ booking: due, phone, to: "owner", templates: [template], ...more });

  /** What goes with a message to a parent as tappable buttons: pay now, I have paid, talk to the owner. */
  const feeButtons = (due: Due, buttons: ButtonId[] = ["pay", "paid", "owner"]): Offer => ({ kind: "buttons", buttons, dueId: due.id });
  const ownerButton: Offer = { kind: "buttons", buttons: ["owner"] };

  // ---- refunds, shared with every template (modules/payments/refunds.ts) ----------------------------------------------

  const refunds = createRefunds<Due>({
    payments, clock, owner,
    limitInr: () => settings.refund.limitInr,
    log: (due, phone, action, outcome, inputs, more) => log(due, phone, action, outcome, inputs, more),
    tellCustomer: (due, phone, templates, more) => tellCustomer(due, phone, templates as TemplateId[], more),
    tellOwner: (due, phone, template, more) => tellOwner(due, phone, template as TemplateId, more),
    cases: () => store.dues.values(),
    ids: { checking: "fee_refund_checking", denied: "fee_refund_denied", approved: "fee_refund_approved", expired: "fee_refund_expired", settled: "owner_refund_settled" },
  });
  const { requestRefund, afterRefund, overLimit } = refunds;

  // ---- reading a message, what it cost, the monthly allowance and button mode (modules/understanding/reader.ts) -----------

  const reader = createReader<Intent, { languages: Language[] }, ParseOptions>({
    parser, context: parseContext, coerce: coerceIntent, policy, store, clock, timeZone: tz,
    log: (action, outcome, inputs, more) => log(null, owner, action, outcome, inputs, more),
    tellOwner: async (notice) => { await tellOwner(null, owner, notice === "allowance" ? "owner_ai_allowance" : notice === "override" ? "owner_ai_off" : "owner_ai_fault"); },
  });
  const { readIntent, understandingRefs, countUnderstood, announceButtonMode } = reader;

  // ---- owner-marked: paid when the owner marks it (B33; modules/payments/owner-marked) -------------------------------------------
  //
  // The parent pays the centre's own UPI ID; the agent cannot see that payment, the owner can. A payment counts only when the owner marks it received with the
  // one-use code the agent sent only to them. A screenshot, the "I have paid" button or the words ask the owner to look and mark nothing. Refunds are owed by the
  // owner, reminded, and "sent" is said only after the owner marks it so.

  const requestById = (id: string | undefined): MarkedRequest | undefined => (id ? markState?.requests.find((r) => r.id === id) : undefined);
  const markLabels = () => LABELS[settings.owner.language];
  const receivedButtons = (request: MarkedRequest | undefined, amountPaise: number): Offer | undefined =>
    request?.code && amountPaise > 0 ? { kind: "buttons", buttons: [], choices: ownerMarkChoices(markLabels(), { kind: "received", code: request.code, amountInr: amountPaise / 100 }) } : undefined;
  const refundButtons = (r: OwedRefund): Offer | undefined =>
    r.code ? { kind: "buttons", buttons: [], choices: ownerMarkChoices(markLabels(), { kind: "refund", code: r.code, keepAllowed: false }) } : undefined;

  /** The QR picture of the fee's current request, made once (best effort: the words carry the link and the UPI ID anyway). */
  async function qrOf(due: Due): Promise<SayArgs["image"]> {
    const request = ownerConfirms ? requestById(due.currentLinkId) : undefined;
    if (!request) return undefined;
    if (request.imageLink === undefined && deps.qrImage) request.imageLink = (await deps.qrImage(request.link).catch(() => null)) ?? undefined;
    return request.imageLink ? { link: request.imageLink, caption: ["fee_upi_qr_caption"] } : undefined;
  }

  /** A request was made for what is owed: in the record, and the owner told what to look for, with the code and the Received button. Once per request. */
  async function markedRequestMade(due: Due, requestId: string, rest: boolean): Promise<void> {
    const request = requestById(requestId)!;
    log(due, due.customer, MARK_ACTIONS.request, "confirmed", { amountPaise: request.amountPaise }, { refs: { requestId, reference: request.reference, amountPaise: String(request.amountPaise) }, notes: "a UPI request to the centre's own UPI ID; it counts as paid only when the owner marks it received" });
    if (rest) return; // the rest after a part the owner just marked: the owner's answer to that mark carries this request's code
    await tellOwner(due, due.customer, "owner_fee_upi_expected", { upiCode: request.code ?? undefined, offer: receivedButtons(request, request.amountPaise) });
  }

  /** "I have paid", the words, or a screenshot, with the fee still open: thanks, the owner will confirm, a screenshot is not proof. The owner is asked, once an hour. */
  async function markClaim(due: Due, phone: string, via: "button" | "words" | "screenshot", linkOk: boolean): Promise<void> {
    const request = requestById(due.currentLinkId);
    await tellCustomer(due, phone, ["fee_upi_claim"], linkOk ? { offer: feeButtons(due, ["pay", "owner"]) } : {});
    const now = clock.now();
    const recently = due.claimTellAtMs !== undefined && now - due.claimTellAtMs < HOURLY;
    let told = recently;
    if (!recently && request?.code) { told = await tellOwner(due, phone, "owner_fee_upi_claim", { upiCode: request.code, offer: receivedButtons(request, balancePaise(due)) }); if (told) due.claimTellAtMs = now; }
    log(due, phone, MARK_ACTIONS.claim, told ? "confirmed" : "failed", { claim: "paid", via }, { refs: { to: "owner", via, ...(request ? { requestId: request.id } : {}) }, notes: `the parent says the fee is paid (${via === "screenshot" ? "a screenshot, which is not proof" : via === "button" ? "the I have paid button" : "in words"}); nothing is marked paid until the owner marks it${recently ? "; the owner was already asked in the last hour" : ""}` });
  }

  /** A picture from a parent: never looked at or kept. On a UPI centre it is read as "I paid" (a screenshot is not proof); a centre whose gateway confirms by itself answers nothing, as before. */
  async function onPicture(msg: InboundMessage): Promise<void> {
    const phone = msg.from;
    log(null, phone, "receive_message", "confirmed", { image: true, id: msg.id }, { notes: "a picture: it is not looked at and nothing of it is kept; a picture is never proof of a payment", refs: { messageId: msg.id } });
    if (!ownerConfirms || customerOf(phone).optedOut) return;
    await onPaidClaim(phone, { kind: "paid" }, "screenshot");
  }

  /** A refund the owner owes: recorded, the parent told it will come from the owner, the owner told what to send, with the code. The agent never sends it. */
  async function oweBack(due: Due, paymentId: string, amountPaise: number, why: string, decisions: Decision[] = []): Promise<OwedRefund> {
    const r = oweRefund(markState!, { caseId: due.id, customer: due.customer, paymentId, amountPaise, why }, clock.now());
    log(due, due.customer, MARK_ACTIONS.refundOwed, "held_for_owner", { paymentId, amountPaise }, { decisions, refs: { refundId: r.id, paymentId, amountPaise: String(amountPaise) }, notes: `owed back by the owner, who sends it from their own UPI app (${why}); the agent never sends it and tracks it until the owner marks it done` });
    await tellCustomer(due, due.customer, ["fee_upi_refund_owed"], { refundInr: amountPaise / 100 });
    await tellOwner(due, due.customer, "owner_fee_upi_refund_owed", { refundInr: amountPaise / 100, upiCode: r.code ?? undefined, offer: refundButtons(r) });
    return r;
  }

  /** The owner's UPI reply: money received on a request, or a refund marked sent. A code is used once; the same reply again counts nothing. */
  async function onOwnerMark(reply: MarkReply, msg: InboundMessage): Promise<void> {
    const now = clock.now();
    const quietly = (outcome: "already" | "unknown", notes: string) => {
      log(null, owner, "upi_owner_reply", "blocked", { kind: reply.kind, id: msg.id }, { notes, refs: { command: reply.kind } });
      return say({ booking: null, phone: owner, to: "owner", templates: [outcome === "already" ? "owner_fee_upi_already" : "owner_fee_upi_unknown"] });
    };
    if (reply.kind === "received") {
      const result = markReceived(markState!, reply.code, reply.amountPaise, now);
      if (result.kind === "already" || result.kind === "already_refund") { await quietly("already", "a code that was already used: the payment is counted once"); return; }
      if (result.kind !== "marked") { await quietly("unknown", result.kind === "bad_amount" ? "an amount that cannot be right for this payment" : "a code the agent never issued"); return; }
      const due = store.dues.get(result.request.reference.split(".")[0]);
      if (!due) { await quietly("unknown", "no fee has this request"); return; }
      const { fresh } = await reconcile(due); // the owner's mark is now on the payment record: count it the usual way
      await settle(due, fresh);
      if (due.state !== "open") await closeOpenRequests(due);
      const current = requestById(due.currentLinkId);
      if (due.state === "open" && balancePaise(due) > 0) await tellOwner(due, due.customer, "owner_fee_upi_part", { receivedInr: result.mark.amountPaise / 100, upiCode: current?.code ?? undefined, offer: receivedButtons(current, balancePaise(due)) });
      else await tellOwner(due, due.customer, "owner_fee_upi_marked", { receivedInr: result.mark.amountPaise / 100 });
      return;
    }
    const result = markRefund(markState!, reply.code, reply.kind === "kept" ? "kept" : "done", now);
    if (result.kind === "already") { await quietly("already", "a refund code that was already used"); return; }
    if (result.kind !== "done") { await quietly("unknown", result.kind === "not_allowed" ? "keeping this money was not offered" : "a code the agent never issued"); return; }
    const r = result.refund;
    const due = store.dues.get(r.caseId) ?? null;
    log(due, r.customer, MARK_ACTIONS.refundDone, "confirmed", { refundId: r.id }, { refs: { refundId: r.id, paymentId: r.paymentId, amountPaise: String(r.amountPaise) }, notes: "the owner marked the refund sent from their UPI app; only now is the parent told it was sent" });
    await tellCustomer(due, r.customer, ["fee_upi_refund_sent"], { refundInr: r.amountPaise / 100 });
    await tellOwner(due, r.customer, "owner_fee_upi_refund_marked", { refundInr: r.amountPaise / 100 });
  }

  /** A fee that is settled has nothing more to ask for: its open requests are closed (a later mark on one is still recorded, and any extra is owed back). */
  async function closeOpenRequests(due: Due): Promise<void> {
    for (const l of due.links) {
      const request = requestById(l.id);
      if (!request || (request.status !== "created" && request.status !== "partially_paid")) continue;
      await payments.cancelRequest(l.id);
      log(due, due.customer, MARK_ACTIONS.closed, "confirmed", { requestId: l.id }, { refs: { requestId: l.id }, notes: "the fee is settled, so nothing more is asked on this request" });
    }
  }

  /** Refunds still owed: remind the owner, once a day, at most three times; after that they stay in the record's unfinished work. */
  async function remindOwedRefunds(now: number): Promise<void> {
    for (const r of remindersDue(markState!, now)) {
      const due = store.dues.get(r.caseId) ?? null;
      reminded(r, now);
      const told = await tellOwner(due, r.customer, "owner_fee_upi_refund_reminder", { refundInr: r.amountPaise / 100, upiCode: r.code ?? undefined, offer: refundButtons(r) });
      log(due, r.customer, MARK_ACTIONS.refundReminder, told ? "confirmed" : "failed", { refundId: r.id }, { refs: { refundId: r.id, amountPaise: String(r.amountPaise) }, notes: `reminder ${r.reminders} of a refund the owner still owes` });
    }
  }

  /** The unfinished-work list (B31) asks the owner again: each refund still owed, and an open fee's request the parent says they paid. False when there is nothing UPI to ask. */
  async function markAskAgain(due: Due, note: (outcome: Outcome, notes: string) => unknown): Promise<boolean> {
    const owed = markState!.refunds.filter((r) => r.caseId === due.id && r.state === "owed" && r.code);
    const request = due.state === "open" ? requestById(due.currentLinkId) : undefined;
    const open = request?.code && (request.status === "created" || request.status === "partially_paid") ? request : undefined;
    if (owed.length === 0 && !open) return false;
    note("attempted", "telling the owner again about a UPI payment or refund");
    let told = true;
    for (const r of owed) told = (await tellOwner(due, r.customer, "owner_fee_upi_refund_reminder", { refundInr: r.amountPaise / 100, upiCode: r.code!, offer: refundButtons(r) })) && told;
    if (open) told = (await tellOwner(due, due.customer, "owner_fee_upi_claim", { upiCode: open.code!, offer: receivedButtons(open, balancePaise(due)) })) && told;
    note(told ? "confirmed" : "failed", told ? "the owner was told again" : "the owner could not be told (the limits or the provider said no)");
    return true;
  }

  // ---- the payment record: look, count, settle ------------------------------------------------------------------------

  /**
   * Read every payment on this fee's links from the payments service and count the ones not counted yet. `ok` is false if any link could not be read just now: what
   * could not be read is not known, and a reminder never goes out on a record that could not be read.
   */
  async function reconcile(due: Due): Promise<{ ok: boolean; fresh: CountedPayment[] }> {
    const fresh: CountedPayment[] = [];
    let ok = true;
    for (const link of due.links) {
      let found: PaymentRequest | null;
      try { found = await payments.fetchRequest(link.id); } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
        ok = false;
        log(due, due.customer, "record_payment", "failed", { linkId: link.id }, { notes: `the payments service could not be read just now (${(e as Error).message})`, refs: { linkId: link.id } });
        continue;
      }
      if (!found) { ok = false; log(due, due.customer, "record_payment", "failed", { linkId: link.id }, { notes: "the payments service has no such link", refs: { linkId: link.id } }); continue; }
      for (const p of found.payments) {
        if (due.payments.some((x) => x.id === p.id)) continue;
        const counted: CountedPayment = { id: p.id, amountPaise: p.amount, linkId: link.id };
        due.payments.push(counted);
        fresh.push(counted);
        if (ownerConfirms) log(due, due.customer, MARK_ACTIONS.marked, "confirmed", { requestId: link.id, amount: p.amount }, { refs: { paymentId: p.id, linkId: link.id, requestId: link.id, amountPaise: String(p.amount), markedBy: "owner" }, notes: found.status === "cancelled" ? "marked received by the owner on a request the agent had replaced (the amount changed): it counts toward the fee" : "marked paid by owner: from the owner's own number, with a one-use code" });
        else log(due, due.customer, "record_payment", "confirmed", { linkId: link.id, amount: p.amount }, { refs: { paymentId: p.id, linkId: link.id, amountPaise: String(p.amount) } });
      }
    }
    return { ok, fresh };
  }

  /**
   * What the record now shows, and what to do about it: move the fee to paid when the record covers what is owed, tell the parent about the payments just counted, and
   * give back what was paid beyond what is owed. Returns whether the parent was sent a receipt in this step (so a reply does not say it twice).
   */
  async function settle(due: Due, fresh: CountedPayment[]): Promise<{ receipt: boolean }> {
    if (fresh.length === 0 && !(due.state === "open" && balancePaise(due) <= 0 && due.payments.length > 0)) return { receipt: false };
    const owed = owedPaise(due);
    const paid = paidPaise(due);
    const freshPaise = fresh.reduce((n, p) => n + p.amountPaise, 0);
    const before = paid - freshPaise;
    const excess = Math.max(0, paid - Math.max(owed, before)); // what came with these payments beyond what was owed
    const useful = freshPaise - excess;
    if (due.state === "open" && paid >= owed && due.payments.length > 0) {
      moveTo(due, "paid");
      log(due, due.customer, "settle_fee", "confirmed", { paidPaise: paid, owedPaise: owed }, { refs: { amountPaise: String(paid) } });
    }
    let receipt = false;
    if (useful > 0) {
      if (paid >= owed) { receipt = await tellCustomer(due, due.customer, ["fee_received"], { receivedInr: useful / 100 }); }
      else {
        if (!can.takesPartPayments) await currentLink(due); // a request is for one amount: a new one for exactly the rest, so the link in the receipt asks for what is still owed
        receipt = await tellCustomer(due, due.customer, ["fee_part_received"], { receivedInr: useful / 100, offer: feeButtons(due, ["pay", "owner"]) });
      }
    }
    if (excess > 0) await refundExcess(due, fresh, excess);
    return { receipt };
  }

  /** More was paid than is owed (a second payment, or the old link paid after a waiver): give the extra back, newest payment first, within the refund limit. */
  async function refundExcess(due: Due, fresh: CountedPayment[], excessPaise: number): Promise<void> {
    let left = excessPaise;
    for (const counted of [...fresh].reverse()) {
      if (left <= 0) break;
      const payment: Payment | null = await payments.fetchPayment(counted.id).catch(() => null);
      const give = Math.min(left, counted.amountPaise - (payment?.amount_refunded ?? 0));
      if (give < 100) continue;
      const amountInr = Math.floor(give / 100);
      left -= amountInr * 100;
      const once = checkOneRefundPerPayment({ paymentId: counted.id, refundedPaise: payment?.amount_refunded ?? 0 });
      const limit = checkRefundLimit({ amountInr, limitInr: settings.refund.limitInr, paidInr: counted.amountPaise / 100 });
      if (once.verdict === "block" || limit.verdict === "block") { log(due, due.customer, "refund", "blocked", { paymentId: counted.id, amountInr }, { decisions: [once, limit], refs: { paymentId: counted.id, amountPaise: String(amountInr * 100) } }); continue; }
      if (ownerRefunds) { await oweBack(due, counted.id, amountInr * 100, "paid more than was owed", [once, limit]); continue; }
      const result = await requestRefund(due, counted.id, amountInr, [once, limit], limit.verdict !== "allow");
      await afterRefund(due, result, { paymentId: counted.id, amountInr, done: { customer: "fee_refund_done", owner: "owner_overpayment" }, held: "fee_refund_pending" });
    }
  }

  // ---- payment links: one for what is still owed ---------------------------------------------------------------------

  const linkOf = (due: Due) => due.links.find((l) => l.id === due.currentLinkId);
  const paidOnLink = (due: Due, linkId: string) => due.payments.filter((p) => p.linkId === linkId).reduce((n, p) => n + p.amountPaise, 0);

  /**
   * The link a parent should pay now, made for exactly what is still owed. The current link stays if what is left on it is what is owed; if the amount changed (a late
   * fee, a waiver) a new link is made for the new balance and the old one is closed, if it can still be closed (a link with a part payment cannot be: it stays open, and
   * anything it collects beyond what is owed is given back).
   */
  // ---- the licence: no new work in the wind-down, nothing more sent in the final stop ----------------------------------------------------------------------

  const stoppedGate: Decision = { ruleId: LICENCE_RULE, verdict: "block", reason: "the centre's licence has reached its final stop, so nothing more is sent from here (the owner's one notice aside); the runtime's own check of the lease" };
  const pausedDecision = (): Decision => ({ ruleId: LICENCE_RULE, verdict: "block", reason: `online fee payment is paused: the centre's licence is in its ${licence().state === "stopped" ? "final stop" : "wind-down"}, so no new fee link is made, and nothing is kept to do later (the runtime's own check of the lease)` });

  /** A request for new work while online fee payment is paused: said in the record, answered "please contact the centre", and nothing kept to do later. */
  async function pausedReply(phone: string, asked: string): Promise<void> {
    log(null, phone, "new_work", "blocked", { asked }, { decisions: [pausedDecision()], notes: "the parent is told online fee payment is paused and to contact the centre" });
    await tellCustomer(null, phone, ["fee_paused"]);
  }

  /** One record line each time the licence restricts the centre, or stops restricting it. Nothing asked during a wind-down is done when it ends: the parent asks again. */
  function noteLicence(): void {
    const l = licence();
    const now = l.restricted ? l.state : "active";
    let was = "active";
    const entries = record.entries();
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].action === "licence") { was = entries[i].refs.state ?? "active"; break; }
    if (now === was) return;
    const notes = now === "wind_down" ? "The centre's licence is in its wind-down (the lease fleet signed, read on this server): no new fee link is made, no month's fees are opened and no late fee is added, and nothing is kept to do later. Payments from links sent earlier, receipts and refunds go on."
      : now === "stopped" ? "The centre's licence has reached its final stop: open fee links are closed and nothing more is sent from here, except the owner's one notice. Payments already made are still recorded and refunds still go through. Nothing is deleted."
      : "The centre's licence is in order again: fees are collected from now on. Nothing asked during the wind-down is done now; a parent who still wants it asks again.";
    log(null, owner, "licence", "confirmed", { state: now }, { refs: { state: now, ...(l.paidThrough !== null ? { paidThrough: String(l.paidThrough) } : {}) }, notes });
  }

  /** The final stop, once for each `paid_through`: close every open fee link at the gateway through Guard, so no new payment comes in. A module that cannot cancel a request (UPI) has none to close. */
  async function closeLinksAtStop(): Promise<void> {
    const l = licence();
    if (l.state !== "stopped" || !can.cancels) return;
    const key = `stop:${l.paidThrough ?? 0}`;
    for (const due of [...store.dues.values()]) {
      const linkId = due.state === "open" ? due.currentLinkId : undefined;
      if (!linkId) continue;
      if (record.entries().some((e) => e.booking === due.id && e.action === "cancel_fee_link" && e.refs.licence === key)) continue;
      const closed = await payments.cancelRequest(linkId).then(() => payments.fetchRequest(linkId)).then((x) => x?.status === "cancelled").catch(() => false);
      log(due, due.customer, "cancel_fee_link", closed ? "confirmed" : "unconfirmed", { linkId }, { refs: { linkId, licence: key }, notes: closed ? "the final stop of the centre's licence: the open fee link is closed, so no new payment comes in; a payment already made is still recorded" : "the final stop of the centre's licence: the link could not be closed (it may have a payment on it, or the gateway did not answer); the owner can close it in the gateway's own dashboard" });
    }
  }

  /** `paused`: no link because of the centre's licence (the runtime's own check, or Guard's 402): nothing is tried again and nothing is kept to do later. */
  async function currentLink(due: Due): Promise<{ ok: true } | { ok: false; why: string; paused?: true }> {
    const balance = balancePaise(due);
    if (balance <= 0) return { ok: false, why: "nothing is owed" };
    const old = linkOf(due);
    // A module whose request is for one exact amount (UPI: the payer's app cannot change it) needs a request of its own for the rest after a part; one that takes
    // part payments keeps the open link for the rest.
    if (old && (!can.takesPartPayments ? old.amountPaise === balance && paidOnLink(due, old.id) === 0 : old.amountPaise - paidOnLink(due, old.id) === balance)) return { ok: true };
    if (!licence().takesNewWork) { log(due, due.customer, "create_fee_link", "blocked", { amountPaise: balance }, { decisions: [pausedDecision()] }); return { ok: false, why: "online fee payment is paused (the centre's licence)", paused: true }; }
    if (balance % 100 !== 0) return { ok: false, why: "the balance is not a whole number of rupees" };
    const decision = checkFeeLink({ amountInr: balance / 100, balanceInr: balance / 100, highestInr });
    if (decision.verdict === "block") { log(due, due.customer, "create_fee_link", "blocked", { amountPaise: balance }, { decisions: [decision] }); return { ok: false, why: decision.reason }; }
    const sequence = due.linkSeq + 1;
    const reference = `${due.id}.${sequence}`;
    log(due, due.customer, "create_fee_link", "attempted", { amountPaise: balance, reference }, { decisions: [decision] });
    const { link, error, suspended } = await makeLink(payments, {
      reference, amountPaise: balance, description: `${settings.name}: ${due.studentName}, ${due.batchId}, ${due.month}`,
      acceptPartial: settings.partPayments.allowed, minPartialPaise: Math.min(settings.partPayments.minInr * 100, balance),
    });
    if (!link && suspended) { // Guard held the link back for the licence (ADR-0062): the centre's own pause, said as Guard's. Not tried again, nothing kept for later.
      log(due, due.customer, "create_fee_link", "blocked", { amountPaise: balance, reference }, { decisions: [guardLicenceDecision(suspended.guard.reason)], notes: suspended.message, refs: { reference } });
      return { ok: false, why: "online fee payment is paused (the centre's licence)", paused: true };
    }
    if (!link) {
      log(due, due.customer, "create_fee_link", error ? "failed" : "unconfirmed", { amountPaise: balance, reference }, { notes: error ?? "the payments service does not show the link", refs: { reference } });
      return { ok: false, why: error ?? "the payments service does not show the link" };
    }
    due.linkSeq = sequence;
    due.links.push({ id: link.id, url: link.pay_url, reference, amountPaise: link.amount });
    due.currentLinkId = link.id;
    log(due, due.customer, "create_fee_link", "confirmed", { amountPaise: balance, reference }, { refs: { linkId: link.id, reference, amountPaise: String(balance) } });
    if (ownerConfirms) await markedRequestMade(due, link.id, paidPaise(due) > 0);
    if (old) {
      const closed = await payments.cancelRequest(old.id).then(() => payments.fetchRequest(old.id)).then((l) => l?.status === "cancelled").catch(() => false);
      log(due, due.customer, "cancel_fee_link", closed ? "confirmed" : "unconfirmed", { linkId: old.id }, { refs: { linkId: old.id }, notes: closed ? "the amount owed changed, so the old link was closed" : "the old link could not be closed (it has a part payment on it, or the payments service did not answer): it stays open, and anything it collects beyond what is owed is given back" });
      if (ownerConfirms && closed) log(due, due.customer, MARK_ACTIONS.closed, "confirmed", { requestId: old.id }, { refs: { requestId: old.id }, notes: "the amount owed changed, so a new request was made; a mark the owner makes on this one later still counts toward the fee" });
    }
    return { ok: true };
  }

  // ---- opening the month's fees, late fees and reminders (the clock) --------------------------------------------------

  const dueDateOf = (year: number, month: number): LocalDate => ({ year, month, day: settings.due.day });
  const dueMsOf = (date: LocalDate) => zonedToMs(date, MIDNIGHT, tz);
  const reminderMoments = (date: LocalDate) => settings.reminders.daysFromDue.map((d) => zonedToMs(addDays(date, d), { hour: settings.reminders.hour, minute: 0 }, tz));

  /** The month this student's fee is due in, for this month and the next one, opened once the first reminder's moment has come. */
  function openMonthlyFees(): void {
    const now = clock.now();
    const today = localParts(now, tz);
    const next = today.month === 12 ? { year: today.year + 1, month: 1 } : { year: today.year, month: today.month + 1 };
    for (const student of settings.students) {
      for (const m of [{ year: today.year, month: today.month }, next]) {
        const key = monthKey(m);
        if ([...store.dues.values()].some((d) => d.customer === student.parent && d.studentName === student.name && d.month === key)) continue;
        const date = dueDateOf(m.year, m.month);
        const moments = reminderMoments(date);
        if (now < Math.min(...moments)) continue;
        if (Math.min(...moments) < store.startedAtMs) continue; // its first reminder day came before the agent first ran: that month is not chased
        const due = register(store, newDue(settings, student, student.language ?? store.customers.get(student.parent)?.language ?? settings.languages[0], key, date, dueMsOf(date)));
        // Every reminder day is kept, the ones that have passed too: opened on the first reminder's day, or later, the ones already due go as ONE message (the shared rule).
        due.reminders = moments.map((atMs) => ({ atMs, sent: false }));
        log(due, due.customer, "open_fee", "confirmed", { month: key, feeInr: due.feeInr }, { refs: { month: key, amountPaise: String(due.feeInr * 100) }, notes: `the fee for ${due.studentName}, ${key}, is open` });
      }
    }
  }

  /** The grace days are over and the fee is not paid: add the late fee once. It is read from the payment record first, so a fee paid on the last day gets none. */
  async function addLateFee(due: Due): Promise<void> {
    if (settings.lateFeeInr <= 0 || due.lateFeeInr > 0 || due.state !== "open") return;
    if (customerOf(due.customer).optedOut) return; // a parent who has asked for no messages cannot be told of a new charge, so none is added
    const after = zonedToMs(addDays(due.dueDate, settings.due.graceDays + 1), MIDNIGHT, tz);
    if (clock.now() < after) return;
    const { fresh } = await reconcile(due);
    await settle(due, fresh);
    if (due.state !== "open") return;
    due.lateFeeInr = settings.lateFeeInr;
    log(due, due.customer, "add_late_fee", "confirmed", { amountPaise: settings.lateFeeInr * 100 }, { refs: { amountPaise: String(settings.lateFeeInr * 100) }, notes: `the grace days are over and the payment record shows the fee unpaid` });
    if (due.remindersSent < settings.reminders.maxPerMonth && !due.reminders.some((r) => !r.sent)) due.reminders.push({ atMs: clock.now(), sent: false }); // the parent should hear of it
  }

  /**
   * A reminder has fallen due: look at the payment record first. If it covers the fee, say so and send nothing more. If it could not be read, send nothing and
   * try again at the next beat. Otherwise make sure the link is for what is owed, and send the one reminder.
   */
  async function remind(due: Due): Promise<void> {
    const now = clock.now();
    if (!due.reminders.some((r) => !r.sent && r.atMs <= now)) return;
    const { ok, fresh } = await reconcile(due);
    await settle(due, fresh);
    if (due.state !== "open") { takeDue(due.reminders, now); return; } // paid or waived: the reminder is not sent, and the ones to come are over
    if (customerOf(due.customer).optedOut) { takeDue(due.reminders, now); return; }
    if (!ok) {
      if (due.readNoteAtMs === undefined || now - due.readNoteAtMs >= 30 * MINUTE) {
        due.readNoteAtMs = now;
        log(due, due.customer, "send_message", "blocked", { reminder: true }, { decisions: [checkNoReminderOncePaid({ record, dueId: due.id, owedPaise: owedPaise(due), readOk: false })], notes: "the reminder waits until the payment record can be read", refs: { to: "customer" } });
      }
      return;
    }
    const link = await currentLink(due);
    if (!link.ok && link.paused) { takeDue(due.reminders, now); return; } // the licence: passed over, never sent later (as in the wind-down)
    if (!link.ok) {
      if (due.linkFailTellAtMs === undefined || now - due.linkFailTellAtMs >= HOURLY) {
        due.linkFailTellAtMs = now;
        await tellOwner(due, due.customer, "owner_link_failed");
      }
      return; // the reminder stays due and is tried again
    }
    takeDue(due.reminders, now);
    const startOfToday = zonedToMs({ year: localParts(now, tz).year, month: localParts(now, tz).month, day: localParts(now, tz).day }, MIDNIGHT, tz);
    const template: TemplateId = due.lateFeeInr > 0 ? "fee_overdue_late" : startOfToday > due.dueMs ? "fee_overdue" : "fee_reminder";
    const sent = await tellCustomer(due, due.customer, [template], { reminder: true, readOk: true, offer: feeButtons(due), image: await qrOf(due) });
    if (sent) due.remindersSent += 1;
  }

  // ---- which fee a message is about -----------------------------------------------------------------------------------

  /** The parent's own fee a button named, or their oldest open one; failing that, their latest. A forged id that names someone else's fee names nothing. */
  function targetDue(phone: string, intent: Intent, options: { allowPaid?: boolean } = {}): Due | undefined {
    const own = duesOf(store, phone);
    if (intent.dueId) { const named = own.find((d) => d.id === intent.dueId); if (named) return named; }
    return openDues(store, phone)[0] ?? (options.allowPaid ? own[0] : undefined);
  }

  // ---- what a parent says ------------------------------------------------------------------------------------------------

  async function onPay(phone: string, intent: Intent): Promise<void> {
    if (!licence().takesNewWork) return pausedReply(phone, "pay");
    const due = targetDue(phone, intent);
    if (!due) { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const { fresh } = await reconcile(due);
    const { receipt } = await settle(due, fresh);
    if (due.state !== "open") { if (!receipt) await tellCustomer(due, phone, ["fee_already_paid"]); return; }
    const link = await currentLink(due);
    if (!link.ok && link.paused) return pausedReply(phone, "pay"); // Guard held the link back for the licence: the centre's own pause
    if (!link.ok) { await tellCustomer(due, phone, ["fee_link_failed"], { offer: ownerButton }); await tellOwner(due, phone, "owner_link_failed"); return; }
    await tellCustomer(due, phone, ["fee_pay_link"], { offer: feeButtons(due, ["paid", "owner"]), image: await qrOf(due) });
  }

  /** "I already paid." The payment record is read again and answers; what the parent says marks nothing. If the record shows nothing, the owner is told, once an hour. */
  async function onPaidClaim(phone: string, intent: Intent, via: "button" | "words" | "screenshot" = intent.dueId ? "button" : "words"): Promise<void> {
    const due = targetDue(phone, intent, { allowPaid: true });
    if (!due) { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const { fresh } = await reconcile(due);
    const { receipt } = await settle(due, fresh);
    if (receipt) return; // the parent has just been told what the record holds
    if (due.state !== "open" && paidPaise(due) > 0) { await tellCustomer(due, phone, ["fee_already_paid"]); return; }
    if (due.state !== "open") { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const link = await currentLink(due);
    if (ownerConfirms) { await markClaim(due, phone, via, link.ok); return; }
    if (paidPaise(due) > 0) {
      if (link.ok) await tellCustomer(due, phone, ["fee_claim_partial"], { offer: feeButtons(due, ["pay", "owner"]) });
      return;
    }
    // nothing in the record: not marked paid, not believed. The parent is told what the record shows and the owner is told, once an hour.
    log(due, phone, "ask_owner", "confirmed", { claim: "paid" }, { notes: "the parent says the fee is paid and the payment record shows nothing; the fee stays open", refs: { to: "owner" } });
    if (link.ok) await tellCustomer(due, phone, ["fee_claim_not_found"], { offer: feeButtons(due, ["pay", "owner"]) });
    const now = clock.now();
    if (due.claimTellAtMs === undefined || now - due.claimTellAtMs >= HOURLY) { due.claimTellAtMs = now; await tellOwner(due, phone, "owner_payment_claim"); }
  }

  /** A discount or a waiver is never offered. When a parent asks, the owner is asked for the exact amount, or, within the limit, it is done and the owner is told. */
  async function onDiscount(phone: string, intent: Intent): Promise<void> {
    if (!licence().takesNewWork) return pausedReply(phone, "discount");
    const due = targetDue(phone, intent);
    if (!due) { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const { fresh } = await reconcile(due);
    await settle(due, fresh);
    if (due.state !== "open") { await tellCustomer(due, phone, ["fee_already_paid"]); return; }
    if (due.pending.some((p) => p.kind === "waiver")) { await tellCustomer(due, phone, ["fee_request_waiting"], { offer: ownerButton }); return; }
    if (due.waiverDenied) { const link = await currentLink(due); if (link.ok) await tellCustomer(due, phone, ["fee_waiver_denied"], { offer: feeButtons(due, ["pay", "owner"]) }); return; }
    const amountInr = intent.amountInr;
    const decision = amountInr === undefined ? undefined : checkWaiver({ amountInr, balanceInr: balanceInr(due), alreadyWaivedInr: due.waivedInr, limitInr: settings.waiver.limitInr });
    if (amountInr === undefined || decision!.verdict === "block") {
      // no usable amount: nothing to apply and nothing to approve, so the owner is told and decides what to say
      const now = clock.now();
      let told = due.discountTellAtMs !== undefined && now - due.discountTellAtMs < HOURLY; // this kind of notice only: "talk to the owner" does not keep it quiet
      if (!told) { told = await tellOwner(due, phone, "owner_discount_note"); if (told) due.discountTellAtMs = now; }
      log(due, phone, "ask_owner", told ? "confirmed" : "failed", { claim: "discount" }, { decisions: decision ? [decision] : undefined, refs: { to: "owner" }, notes: "a discount was asked for without a usable amount; nothing was changed" });
      await tellCustomer(due, phone, [told ? "fee_discount_to_owner" : "fee_couldnt_tell_owner"], { offer: feeButtons(due, ["pay", "owner"]) });
      return;
    }
    if (decision!.verdict === "allow") { await applyWaiver(due, amountInr, "limit", [decision!]); return; }
    // above the limit: the owner is asked, for this amount, on this fee, at this balance
    const request: Pending = { kind: "waiver", id: newRequestId(store), amountInr, balanceAtAskInr: balanceInr(due), askedAtMs: clock.now() };
    due.pending.push(request);
    log(due, phone, "waiver_request", "held_for_owner", { amountInr, balanceInr: request.balanceAtAskInr }, { decisions: [decision!], refs: { request: request.id, amountPaise: String(amountInr * 100) } });
    await tellOwner(due, phone, "owner_waiver_request", { waiverInr: amountInr, requestRef: request.id });
    await tellCustomer(due, phone, ["fee_waiver_asked"], { waiverInr: amountInr, offer: feeButtons(due, ["pay", "owner"]) });
  }

  /** Take `amountInr` off the fee (within the limit, or because the owner said yes), make the link for the new balance, and tell the parent. */
  async function applyWaiver(due: Due, amountInr: number, by: "limit" | "owner", decisions: Decision[]): Promise<void> {
    due.waivedInr += amountInr;
    log(due, due.customer, "waive_fee", "confirmed", { amountInr }, { decisions, refs: { amountPaise: String(amountInr * 100), by }, notes: by === "owner" ? "the owner approved this waiver" : "within the waiver limit" });
    if (balancePaise(due) <= 0) {
      moveTo(due, paidPaise(due) > 0 ? "paid" : "closed");
      log(due, due.customer, "settle_fee", "confirmed", { waived: true }, { refs: { amountPaise: String(paidPaise(due)) }, notes: "the waiver covers what was left" });
      await tellCustomer(due, due.customer, ["fee_waiver_cleared"], { waiverInr: amountInr });
    } else {
      const link = await currentLink(due);
      if (link.ok) await tellCustomer(due, due.customer, ["fee_waiver_applied"], { waiverInr: amountInr, offer: feeButtons(due, ["pay", "owner"]) });
      else if (!licence().takesNewWork) await tellCustomer(due, due.customer, ["fee_paused"]); // the waiver is recorded; paying the rest online waits for the centre
      else { await tellCustomer(due, due.customer, ["fee_link_failed"], { offer: ownerButton }); await tellOwner(due, due.customer, "owner_link_failed"); }
    }
    if (by === "limit") await tellOwner(due, due.customer, "owner_waiver_applied", { waiverInr: amountInr });
  }

  /** A parent asks for money back. Never more than a payment on record; one refund for a payment; above the limit Guard holds it, otherwise the owner decides. */
  async function onRefundAsk(phone: string, intent: Intent): Promise<void> {
    const own = duesOf(store, phone);
    const named = intent.dueId ? own.find((d) => d.id === intent.dueId) : undefined;
    const withPayments = named ?? own.find((d) => d.payments.length > 0) ?? own[0];
    if (!withPayments) { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const due = withPayments;
    const { fresh } = await reconcile(due);
    await settle(due, fresh);
    if (due.pending.some((p) => p.kind === "refund_request" || p.kind === "guard_hold" || p.kind === "refund_retry")) { await tellCustomer(due, phone, ["fee_request_waiting"], { offer: ownerButton }); return; }
    // a refund is against one payment: the biggest one that has not been refunded
    const candidates: { payment: CountedPayment; refundedPaise: number }[] = [];
    for (const counted of due.payments) {
      const payment = await payments.fetchPayment(counted.id).catch(() => null);
      candidates.push({ payment: counted, refundedPaise: payment?.amount_refunded ?? 0 });
    }
    const open = candidates.filter((c) => c.refundedPaise === 0).sort((a, b) => b.payment.amountPaise - a.payment.amountPaise);
    if (open.length === 0) { await tellCustomer(due, phone, ["fee_refund_none"], { offer: ownerButton }); return; }
    const target = open[0].payment;
    const paidInr = target.amountPaise / 100;
    const requested = intent.amountInr ?? paidInr;
    const once = checkOneRefundPerPayment({ paymentId: target.id, refundedPaise: 0 });
    const limit = checkRefundLimit({ amountInr: requested, limitInr: settings.refund.limitInr, paidInr });
    if (limit.verdict === "block") {
      log(due, phone, "refund", "blocked", { paymentId: target.id, amountInr: requested }, { decisions: [once, limit], refs: { paymentId: target.id, amountPaise: String(requested * 100) }, notes: "the parent asked for more than the payment on record" });
      await tellCustomer(due, phone, ["fee_refund_too_much"], { paidInr, offer: ownerButton });
      return;
    }
    if (limit.verdict === "hold_for_owner" && !ownerRefunds) {
      // above the owner's limit: Guard holds it and the approvals relay asks the owner, once. The agent does not ask a second time. (When the owner pays refunds by hand, the owner decides any refund below.)
      const result = await requestRefund(due, target.id, requested, [once, limit], true);
      await afterRefund(due, result, { paymentId: target.id, amountInr: requested, done: { customer: "fee_refund_done" }, held: "fee_refund_pending" });
      return;
    }
    // within the limit, but a refund a parent asks for is not owed on its own: the owner decides
    const request: Pending = { kind: "refund_request", id: newRequestId(store), amountInr: requested, paymentId: target.id, askedAtMs: clock.now() };
    due.pending.push(request);
    log(due, phone, "refund", "held_for_owner", { paymentId: target.id, amountInr: requested }, { decisions: [once, limit], refs: { request: request.id, paymentId: target.id, amountPaise: String(requested * 100) } });
    await tellOwner(due, phone, "owner_refund_request", { refundInr: requested, paidInr, requestRef: request.id });
    await tellCustomer(due, phone, ["fee_refund_asked"], { refundInr: requested, paidInr, offer: ownerButton });
  }

  /**
   * "Talk to the owner": the owner is told, once an hour for the same parent, and the parent is told the owner will message them. The agent does not reply on the
   * owner's behalf and decides nothing. If the owner could not be told, the parent is told that, and not that the owner will write.
   */
  async function onTalkToOwner(phone: string): Promise<void> {
    const customer = customerOf(phone);
    const now = clock.now();
    const recently = customer.ownerAskedAtMs !== undefined && now - customer.ownerAskedAtMs < HOURLY;
    let told = recently;
    if (!recently) {
      told = await tellOwner(null, phone, "owner_wants_to_talk");
      if (told) customer.ownerAskedAtMs = now;
    }
    log(null, phone, "ask_owner", told ? "confirmed" : "failed", { by: "button" }, { refs: { to: "owner" }, notes: recently ? "the owner was already told in the last hour, so not again" : told ? "the parent asked to talk to the owner, and the owner was told" : "the owner could not be told" });
    await tellCustomer(null, phone, [told ? "fee_told_owner" : "fee_couldnt_tell_owner"]);
  }

  /** A greeting, a yes or a no, or words that are none of these: what is owed, with the buttons; or that nothing is. */
  async function onMenu(phone: string, understood: boolean): Promise<void> {
    if (!licence().takesNewWork) return pausedReply(phone, "menu");
    const due = openDues(store, phone)[0];
    if (!due) { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const { fresh } = await reconcile(due);
    const { receipt } = await settle(due, fresh);
    if (due.state !== "open") { if (!receipt) await tellCustomer(due, phone, ["fee_already_paid"]); return; }
    await currentLink(due);
    if (understood) await tellCustomer(due, phone, ["fee_menu"], { offer: feeButtons(due) });
    else await tellCustomer(due, phone, ["fee_didnt_understand"], { offer: feeButtons(due) });
  }

  async function onStop(phone: string): Promise<void> {
    customerOf(phone).optedOut = true;
    log(null, phone, "opt_out", "confirmed", { by: "STOP" }, { notes: "no more messages to this parent, not even a reply; any reminder that falls due is stopped by the limits" });
    await tellOwner(null, phone, "owner_opted_out");
  }

  /** A voice note cannot be listened to yet (plan B29 is the voice module), so the sender gets one plain line asking them to type. The audio is never fetched or kept. */
  async function onVoiceNote(msg: InboundMessage): Promise<void> {
    const phone = msg.from;
    if (phone === owner) { await say({ booking: null, phone, to: "owner", templates: ["voice_note"], action: "voice_note_reply" }); return; }
    const customer = customerOf(phone);
    log(null, phone, "receive_message", "confirmed", { voiceNote: true, id: msg.id }, { notes: "a voice note: it is not listened to and nothing of it is kept", refs: { messageId: msg.id } });
    if (customer.optedOut) return; // STOP means STOP
    await tellCustomer(null, phone, ["voice_note"], { action: "voice_note_reply" });
  }

  // ---- the owner's answers ------------------------------------------------------------------------------------------------

  const requestOf = (id: string): { due: Due; pending: Extract<Pending, { kind: "waiver" | "refund_request" }> } | undefined => {
    for (const due of store.dues.values()) for (const p of due.pending) if ((p.kind === "waiver" || p.kind === "refund_request") && p.id === id) return { due, pending: p };
    return undefined;
  };

  async function onOwnerMessage(msg: InboundMessage): Promise<void> {
    // Owner-marked (B33): "received K7M2QX", "refunded K7M2QX" or a tap on one of those buttons. Only the owner's number reaches here.
    const markReply = markState ? parseMarkReply(msg) : undefined;
    if (markReply) return onOwnerMark(markReply, msg);
    if (msg.image) return; // a picture from the owner is not a mark: only the reply with its code is
    // "approve K7M2QX" answers the approvals relay, which reads the owner's messages too (the inbox gives it a copy). It is not for the agent.
    if (RELAY_CODE_REPLY.test(msg.text)) return;
    // "move K7M2QX" is the owner agreeing to hand the shop to another partner or builder (modules/approvals/handover.ts). The record keeps the owner's number and the code's hash; the panel does the rest.
    const moving = parseHandoverReply(msg.text);
    if (moving) { log(null, owner, HANDOVER_ACTION, "confirmed", { command: "handover" }, { refs: { command: "handover", handover: handoverHash(moving) }, notes: "the owner agreed, from their own number, to hand the shop to another partner or builder. The panel checks the code before it moves anything" }); return; }
    // B72: "terms" sends the shop terms to the owner and "I agree" records the agreement (modules/terms/owner.ts). Off unless the shop was handed a terms file.
    if (await handleOwnerTerms(msg, { setup: deps.terms?.(), shopName: settings.name, ownerNumber: owner, ownerLanguage: settings.owner.language, messaging, record, log: (action, outcome, inputs, more) => log(null, owner, action, outcome, inputs, more) })) return;
    const m = /^\s*(approve|deny)\s+(q-\d+)\s*$/i.exec(msg.text);
    const command = m?.[1].toLowerCase() as "approve" | "deny" | undefined;
    const found = m ? requestOf(m[2].toLowerCase()) : undefined;
    const said = command ? { command } : undefined; // the record keeps the command in the clear, so a report can count approvals and refusals
    log(found?.due ?? null, owner, "owner_decision", "attempted", { command, ref: m?.[2] }, { refs: said });
    if (!found || !command) {
      log(found?.due ?? null, owner, "owner_decision", "blocked", { command }, { notes: "not a command for something waiting on the owner", refs: said });
      await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] });
      return;
    }
    const { due, pending } = found;
    due.pending = due.pending.filter((x) => x !== pending); // answered once, whatever happens next: the same words again find nothing waiting

    if (pending.kind === "waiver") {
      if (command === "deny") {
        log(due, owner, "owner_decision", "confirmed", { command }, { notes: "the owner declined the waiver", refs: said });
        due.waiverDenied = true;
        const link = await currentLink(due);
        if (link.ok) await tellCustomer(due, due.customer, ["fee_waiver_denied"], { offer: feeButtons(due, ["pay", "owner"]) });
        return;
      }
      // Only this exact action: the same amount, on the same fee, at the same balance. The record is read again first.
      const { fresh } = await reconcile(due);
      await settle(due, fresh);
      if (due.state !== "open" || balanceInr(due) !== pending.balanceAtAskInr) {
        log(due, owner, "owner_decision", "blocked", { command }, { notes: `the fee changed since the owner was asked (the balance was ${pending.balanceAtAskInr} and is ${balanceInr(due)}, or the fee is no longer open), so the waiver was not applied`, refs: said });
        await tellOwner(due, due.customer, "owner_request_stale");
        return;
      }
      const decision = checkWaiver({ amountInr: pending.amountInr, balanceInr: balanceInr(due), alreadyWaivedInr: due.waivedInr, limitInr: settings.waiver.limitInr, ownerApproved: true });
      if (decision.verdict !== "allow") { log(due, owner, "owner_decision", "blocked", { command }, { decisions: [decision], refs: said }); await tellOwner(due, due.customer, "owner_request_stale"); return; }
      log(due, owner, "owner_decision", "confirmed", { command }, { decisions: [decision], refs: said });
      await applyWaiver(due, pending.amountInr, "owner", [decision]);
      return;
    }

    // a refund the parent asked for, within the limit
    if (command === "deny") {
      log(due, owner, "owner_decision", "confirmed", { command }, { notes: "the owner declined the refund", refs: said });
      await tellCustomer(due, due.customer, ["fee_refund_denied"]);
      return;
    }
    const payment = await payments.fetchPayment(pending.paymentId).catch(() => null);
    const once = checkOneRefundPerPayment({ paymentId: pending.paymentId, refundedPaise: payment?.amount_refunded ?? 0 });
    const limit = checkRefundLimit({ amountInr: pending.amountInr, limitInr: settings.refund.limitInr, paidInr: (payment?.amount ?? 0) / 100, ownerApproved: true });
    if (once.verdict === "block" || limit.verdict === "block") {
      log(due, owner, "owner_decision", "blocked", { command }, { decisions: [once, limit], refs: said });
      await tellOwner(due, due.customer, "owner_request_stale");
      return;
    }
    log(due, owner, "owner_decision", "confirmed", { command }, { decisions: [once, limit], refs: said });
    if (ownerRefunds) { await oweBack(due, pending.paymentId, pending.amountInr * 100, "the owner approved the refund the parent asked for", [once, limit]); return; }
    // with other approvers (B37) the owner is named as asking for it: if Guard holds it, someone else approves it
    const result = await requestRefund(due, pending.paymentId, pending.amountInr, [once, limit], overLimit(pending.amountInr), askedByOwner);
    await afterRefund(due, result, { paymentId: pending.paymentId, amountInr: pending.amountInr, done: { customer: "fee_refund_approved" }, held: "fee_refund_pending", requestedBy: askedByOwner });
  }

  // ---- events --------------------------------------------------------------------------------------------------------------

  async function onMessage(msg: InboundMessage): Promise<void> {
    if (store.seenMessages.has(msg.id)) {
      log(null, msg.from, "receive_message", "blocked", { id: msg.id }, { notes: "the same WhatsApp message was delivered again, so it is ignored" });
      return;
    }
    store.seenMessages.add(msg.id);
    // B37: another approver's "approve K7M2QX" is the approvals relay's (the inbox gives it a copy): no reply and no record here, as for the owner's
    if (approverDigits.has(msg.from.replace(/\D/gu, "")) && RELAY_CODE_REPLY.test(msg.text)) return;
    if (msg.voiceNote) return onVoiceNote(msg);
    if (msg.from === owner) return onOwnerMessage(msg);
    if (msg.image) return onPicture(msg);

    const phone = msg.from;
    const customer = customerOf(phone);
    const mode = reader.mode();
    // A tap on a button is read by looking its id up: no words are read, so no model is asked, whatever the mode. An id that is none of ours is read as words.
    const tapped = msg.reply ? intentFromReply(msg.reply.id) : null;
    const { intent, note, understood } = tapped
      ? { intent: tapped, note: undefined, understood: RULES }
      : await readIntent(msg.text, { rulesOnly: mode.buttons || customer.optedOut }); // an opted-out parent gets no reply, so no model is paid to read it
    countUnderstood(understood);
    if (intent.language && settings.languages.includes(intent.language)) {
      customer.language = intent.language;
      for (const due of duesOf(store, phone)) due.language = intent.language; // every fee of the parent, paid ones too: a refund is asked about a paid fee
    }
    const notes = [note, intent.overrideAttempt ? "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing" : undefined].filter(Boolean).join("; ");
    log(null, phone, "receive_message", "confirmed", { text: msg.text, id: msg.id, ...(tapped ? { reply: msg.reply!.id } : {}) }, { notes, refs: { messageId: msg.id, ...understandingRefs(understood, tapped ? msg.reply!.kind : undefined) } });

    try {
      if (intent.kind === "stop") return await onStop(phone);
      if (customer.optedOut) return; // STOP means STOP: nothing goes to them, even if they write again
      switch (intent.kind) {
        case "pay": return await onPay(phone, intent);
        case "paid": return await onPaidClaim(phone, intent);
        case "discount": return await onDiscount(phone, intent);
        case "refund": return await onRefundAsk(phone, intent);
        case "owner": return await onTalkToOwner(phone);
        case "greeting": case "yes": case "no": return await onMenu(phone, true);
        default: await onMenu(phone, false);
      }
    } finally {
      await announceButtonMode(); // after the parent has their answer
    }
  }

  async function onPaymentEvent(event: PaymentEvent): Promise<void> {
    if (store.seenEvents.has(event.id)) {
      log(null, owner, "receive_payment_event", "blocked", { id: event.id, event: event.event }, { notes: `event ${event.id} was delivered again, so it is ignored` });
      return;
    }
    const dues = [...store.dues.values()];
    if (event.event === "refund.done") {
      const paymentId = event.payload.refund!.payment_id;
      const due = dues.find((x) => x.payments.some((p) => p.id === paymentId));
      const refundId = event.payload.refund!.id;
      const listed = (await payments.listRefunds(paymentId)).some((r) => r.id === refundId);
      log(due ?? null, due?.customer ?? owner, "receive_payment_event", listed ? "confirmed" : "unconfirmed", { id: event.id, event: event.event }, { refs: { refundId, paymentId }, notes: "the refund is on the payments service's own list" });
      store.seenEvents.add(event.id);
      return;
    }
    // A payment.received may name the payment and not its request: ask the payments service which request it paid.
    const paymentId = event.payload.payment?.id;
    const linkId = event.payload.request?.id ?? event.payload.payment?.request_id
      ?? (paymentId ? (await payments.listRequests({ payment_id: paymentId }))[0]?.id : undefined);
    const due = linkId ? dues.find((x) => x.links.some((l) => l.id === linkId)) : undefined;
    if (!due) {
      log(null, owner, "receive_payment_event", "blocked", { id: event.id, event: event.event }, { notes: "no fee has this payment link, so the event is ignored" });
      store.seenEvents.add(event.id);
      return;
    }
    log(due, due.customer, "receive_payment_event", "confirmed", { id: event.id, event: event.event }, { refs: { eventId: event.id } });
    const { fresh } = await reconcile(due); // the record decides; the event only said to look
    await settle(due, fresh);
    store.seenEvents.add(event.id); // only after it worked: a failed step can be run again with the same event
  }

  async function onTick(): Promise<void> {
    const now = clock.now();
    await announceButtonMode(); // the outside switch can change between messages; the owner hears of it on the next beat
    await refunds.sweep(now); // refunds first, whatever state their fee is in
    if (markState) await remindOwedRefunds(now);
    await closeLinksAtStop();
    const working = licence().takesNewWork;
    if (working) openMonthlyFees(); // in the wind-down no month's fees are opened: nothing is kept to chase later
    for (const due of [...store.dues.values()]) {
      if (due.state !== "open") continue;
      if (!working) { takeDue(due.reminders, now); continue; } // a reminder that falls due in the wind-down is passed over, never sent later; no late fee is added
      await addLateFee(due);
      if (due.state === "open") await remind(due);
    }
  }

  // ---- recovery: the panel's to-do list asks the agent to look again, or ask again -----------------------------------------------------------------------
  //   recheck_payment   read the payments service's own list for this fee's links and count any payment not yet counted (the normal path, with its rules)
  //   ask_owner_again   the owner has not answered a waiver or a refund request: send the owner the same notice again
  //   recheck_refund    look again, read-only, for a refund that may have gone (nothing is ever sent again)
  // Nothing here widens a limit: every call is one the agent already makes, and Guard decides each as it does every day.
  async function onRecovery(e: { id: string; case: string; action: string }): Promise<void> {
    const due = store.dues.get(e.case);
    const refs = { action: e.action, recovery: e.id };
    const say = (outcome: Outcome, notes: string) => log(due ?? null, owner, RECOVERY_ENTRY, outcome, { action: e.action, case: e.case }, { notes, refs });
    if (!due) return say("blocked", "no fee has this id, so nothing was done");
    if (e.action === "recheck_payment") {
      if (due.links.length === 0) return say("blocked", "this fee has no payment link to look at");
      say("attempted", "looking again at the payments service's list for this fee's links");
      const { ok, fresh } = await reconcile(due);
      await settle(due, fresh);
      return say(ok ? "confirmed" : "failed", ok ? "the payments service's list was read; any payment not yet counted was recorded above" : "the payments service could not be read whole just now; nothing was changed");
    }
    if (e.action === "ask_owner_again" && markState && (await markAskAgain(due, say))) return;
    if (e.action === "ask_owner_again") {
      const waiting = due.pending.find((p) => p.kind === "waiver" || p.kind === "refund_request");
      if (!waiting) return say("blocked", "nothing the agent asked the owner is waiting (a refund Guard holds is asked by the approvals relay)");
      say("attempted", "telling the owner again");
      const told = waiting.kind === "waiver"
        ? await tellOwner(due, due.customer, "owner_waiver_request", { waiverInr: waiting.amountInr, requestRef: waiting.id })
        : await tellOwner(due, due.customer, "owner_refund_request", { refundInr: waiting.amountInr, paidInr: paidPaise(due) / 100, requestRef: waiting.id });
      return say(told ? "confirmed" : "failed", told ? "the owner was told again" : "the owner could not be told (the limits or the provider said no)");
    }
    if (e.action === "recheck_refund") {
      if (!(due.refundIssues ?? []).some((i) => ["unknown", "uncertain", "unconfirmed", "failed"].includes(i.kind))) return say("blocked", "no refund here is waiting on an unclear outcome");
      say("attempted", "looking again, read-only, for a refund that may have gone");
      const r = await refunds.recheck(due);
      return say("confirmed", `${r.settled} of ${r.looked} refunds now show on the payments service's list; none was sent again`);
    }
    say("blocked", `the agent has no recovery called "${e.action}"`);
  }

  async function handle(event: AgentEvent): Promise<void> {
    noteLicence();
    if (event.kind === "recovery") return onRecovery(event);
    if (event.kind === "message") return onMessage(event.message);
    if (event.kind === "payment_event") return onPaymentEvent(event.event);
    if (event.kind === "approval_decision") return refunds.onApprovalDecision(event);
    return onTick();
  }

  /**
   * `fee_wait_over` (11 Nov 2026): the request was not finished, the system is not answering just now, the message is on the owner's to-do list (the line written below,
   * which the panel's list reads), and to write again later or contact the shop directly. Nothing else is promised, because nothing else happens: nobody is messaged
   * and nothing is tried again by itself. Sent only when the customer heard nothing from this step (`why.tell`).
   */
  async function giveUp(event: AgentEvent, why: { service: string; tell: boolean }): Promise<void> {
    const phone = event.kind === "message" ? event.message.from : owner;
    if (event.kind === "message" && why.tell) {
      // The step that would have noted a new customer's language was thrown away, so it is read again here from the message, by the rules alone (no model is asked);
      // without it a first message would be answered in the shop's first language, whatever the customer wrote in. A language already on record is kept.
      const customer = customerOf(phone);
      const spoken = detectLanguage(event.message.text);
      if (customer.language === undefined && spoken !== undefined && settings.languages.includes(spoken)) customer.language = spoken;
    }
    const told = event.kind === "message" && why.tell ? await tellCustomer(null, phone, ["fee_wait_over"]) : false;
    const line = guardWaitLine(event, why, told);
    log(null, phone, GUARD_WAIT_ENTRY, "failed", line.inputs, { notes: line.notes, refs: line.refs });
  }

  return { handle, giveUp };
}
