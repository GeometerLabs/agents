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
import { RELAY_CODE_REPLY } from "../../../../modules/approvals/code.ts";
import { approverNumbers, ownerAsked } from "../../../../modules/approvals/people.ts";
import { ApiError, TimeoutError } from "../../../../modules/core/faults.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { HOUR, MINUTE, addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { InteractiveMessage } from "../../../../modules/language/interactive.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import type { InboundMessage, Messaging } from "../../../../modules/messaging/messaging.ts";
import { createSay } from "../../../../modules/messaging/say.ts";
import { ensureLink as makeLink } from "../../../../modules/payments/links.ts";
import type { Payment, PaymentEvent, PaymentLink, Payments } from "../../../../modules/payments/payments.ts";
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
import { buttonsFor, intentFromReply } from "./language/interactive.ts";
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
}

export type AgentEvent =
  | { kind: "message"; message: InboundMessage } // a parent's (or the owner's) WhatsApp message
  | { kind: "payment_event"; event: PaymentEvent } // a Razorpay webhook
  // The approvals relay says what the owner decided about a refund Guard is holding. It carries no authority: Guard releases the refund only if its own record says the
  // owner approved, so a forged "approve" makes the agent ask Guard once more and nothing else.
  | { kind: "approval_decision"; approval: string; decision: "approve" | "deny"; id?: string }
  | { kind: "tick" }; // time has passed: open the month's fees, add late fees and send due reminders

export interface Agent { handle(event: AgentEvent): Promise<void> }

const MIDNIGHT = { hour: 0, minute: 0 };
const HOURLY = HOUR; // the owner is told about the same parent at most this often

type Offer = { kind: "buttons"; buttons: ButtonId[]; dueId?: string; body?: TemplateId[] };
interface SayArgs { booking: Due | null; phone: string; to: "customer" | "owner"; templates: TemplateId[]; receivedInr?: number; waiverInr?: number; refundInr?: number; paidInr?: number; requestRef?: string; shown?: Decision[]; reminder?: boolean; readOk?: boolean; action?: Action; offer?: Offer }

export function createAgent(deps: AgentDeps): Agent {
  const { settings, clock, payments, messaging, parser, record, store } = deps;
  const policy: AiPolicy = deps.ai ?? {};
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
    factsFor: (a, language) => factsFor(settings, a.booking, language, { customerPhone: a.phone, refundInr: a.refundInr, receivedInr: a.receivedInr, waiverInr: a.waiverInr, requestRef: a.requestRef, paidInr: a.paidInr }),
    interactiveFor: (a, facts, language): InteractiveMessage => {
      const offer = a.offer!;
      return { body: (offer.body ?? a.templates).map((id) => render(id, facts)).join(" "), buttons: buttonsFor(language, offer.buttons, offer.dueId) };
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

  // ---- the payment record: look, count, settle ------------------------------------------------------------------------

  /**
   * Read every payment on this fee's links from the payments service and count the ones not counted yet. `ok` is false if any link could not be read just now: what
   * could not be read is not known, and a reminder never goes out on a record that could not be read.
   */
  async function reconcile(due: Due): Promise<{ ok: boolean; fresh: CountedPayment[] }> {
    const fresh: CountedPayment[] = [];
    let ok = true;
    for (const link of due.links) {
      let found: PaymentLink | null;
      try { found = await payments.fetchPaymentLink(link.id); } catch (e) {
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
        log(due, due.customer, "record_payment", "confirmed", { linkId: link.id, amount: p.amount }, { refs: { paymentId: p.id, linkId: link.id, amountPaise: String(p.amount) } });
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
      else receipt = await tellCustomer(due, due.customer, ["fee_part_received"], { receivedInr: useful / 100, offer: feeButtons(due, ["pay", "owner"]) });
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
  async function currentLink(due: Due): Promise<{ ok: true } | { ok: false; why: string }> {
    const balance = balancePaise(due);
    if (balance <= 0) return { ok: false, why: "nothing is owed" };
    const old = linkOf(due);
    if (old && old.amountPaise - paidOnLink(due, old.id) === balance) return { ok: true };
    if (balance % 100 !== 0) return { ok: false, why: "the balance is not a whole number of rupees" };
    const decision = checkFeeLink({ amountInr: balance / 100, balanceInr: balance / 100, highestInr });
    if (decision.verdict === "block") { log(due, due.customer, "create_fee_link", "blocked", { amountPaise: balance }, { decisions: [decision] }); return { ok: false, why: decision.reason }; }
    const sequence = due.linkSeq + 1;
    const reference = `${due.id}.${sequence}`;
    log(due, due.customer, "create_fee_link", "attempted", { amountPaise: balance, reference }, { decisions: [decision] });
    const { link, error } = await makeLink(payments, {
      reference, amountPaise: balance, description: `${settings.name}: ${due.studentName}, ${due.batchId}, ${due.month}`,
      acceptPartial: settings.partPayments.allowed, minPartialPaise: Math.min(settings.partPayments.minInr * 100, balance),
    });
    if (!link) {
      log(due, due.customer, "create_fee_link", error ? "failed" : "unconfirmed", { amountPaise: balance, reference }, { notes: error ?? "the payments service does not show the link", refs: { reference } });
      return { ok: false, why: error ?? "the payments service does not show the link" };
    }
    due.linkSeq = sequence;
    due.links.push({ id: link.id, url: link.short_url, reference, amountPaise: link.amount });
    due.currentLinkId = link.id;
    log(due, due.customer, "create_fee_link", "confirmed", { amountPaise: balance, reference }, { refs: { linkId: link.id, reference, amountPaise: String(balance) } });
    if (old) {
      const closed = await payments.cancelPaymentLink(old.id).then(() => payments.fetchPaymentLink(old.id)).then((l) => l?.status === "cancelled").catch(() => false);
      log(due, due.customer, "cancel_fee_link", closed ? "confirmed" : "unconfirmed", { linkId: old.id }, { refs: { linkId: old.id }, notes: closed ? "the amount owed changed, so the old link was closed" : "the old link could not be closed (it has a part payment on it, or the payments service did not answer): it stays open, and anything it collects beyond what is owed is given back" });
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
    const sent = await tellCustomer(due, due.customer, [template], { reminder: true, readOk: true, offer: feeButtons(due) });
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
    const due = targetDue(phone, intent);
    if (!due) { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const { fresh } = await reconcile(due);
    const { receipt } = await settle(due, fresh);
    if (due.state !== "open") { if (!receipt) await tellCustomer(due, phone, ["fee_already_paid"]); return; }
    const link = await currentLink(due);
    if (!link.ok) { await tellCustomer(due, phone, ["fee_link_failed"], { offer: ownerButton }); await tellOwner(due, phone, "owner_link_failed"); return; }
    await tellCustomer(due, phone, ["fee_pay_link"], { offer: feeButtons(due, ["paid", "owner"]) });
  }

  /** "I already paid." The payment record is read again and answers; what the parent says marks nothing. If the record shows nothing, the owner is told, once an hour. */
  async function onPaidClaim(phone: string, intent: Intent): Promise<void> {
    const due = targetDue(phone, intent, { allowPaid: true });
    if (!due) { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const { fresh } = await reconcile(due);
    const { receipt } = await settle(due, fresh);
    if (receipt) return; // the parent has just been told what the record holds
    if (due.state !== "open" && paidPaise(due) > 0) { await tellCustomer(due, phone, ["fee_already_paid"]); return; }
    if (due.state !== "open") { await tellCustomer(null, phone, ["fee_nothing_due"]); return; }
    const link = await currentLink(due);
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
    if (limit.verdict === "hold_for_owner") {
      // above the owner's limit: Guard holds it and the approvals relay asks the owner, once. The agent does not ask a second time.
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
    // "approve K7M2QX" answers the approvals relay, which reads the owner's messages too (the inbox gives it a copy). It is not for the agent.
    if (RELAY_CODE_REPLY.test(msg.text)) return;
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
    // with other approvers (B37) the owner is named as asking for it: if Guard holds it, someone else approves it
    const result = await requestRefund(due, pending.paymentId, pending.amountInr, [once, limit], overLimit(pending.amountInr), askedByOwner);
    await afterRefund(due, result, { paymentId: pending.paymentId, amountInr: pending.amountInr, done: { customer: "fee_refund_approved" }, held: "fee_refund_pending", requestedBy: askedByOwner });
  }

  // ---- events --------------------------------------------------------------------------------------------------------------

  async function onMessage(msg: InboundMessage): Promise<void> {
    if (store.seenMessages.has(msg.id)) {
      log(null, msg.from, "receive_message", "blocked", { id: msg.id }, { notes: `the same WhatsApp message (${msg.id}) was delivered again, so it is ignored` });
      return;
    }
    store.seenMessages.add(msg.id);
    // B37: another approver's "approve K7M2QX" is the approvals relay's (the inbox gives it a copy): no reply and no record here, as for the owner's
    if (approverDigits.has(msg.from.replace(/\D/gu, "")) && RELAY_CODE_REPLY.test(msg.text)) return;
    if (msg.voiceNote) return onVoiceNote(msg);
    if (msg.from === owner) return onOwnerMessage(msg);

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
    if (event.event === "refund.processed") {
      const paymentId = event.payload.refund!.payment_id;
      const due = dues.find((x) => x.payments.some((p) => p.id === paymentId));
      const refundId = event.payload.refund!.id;
      const listed = (await payments.listRefunds(paymentId)).some((r) => r.id === refundId);
      log(due ?? null, due?.customer ?? owner, "receive_payment_event", listed ? "confirmed" : "unconfirmed", { id: event.id, event: event.event }, { refs: { refundId, paymentId }, notes: "the refund is on the payments service's own list" });
      store.seenEvents.add(event.id);
      return;
    }
    // A real payment.captured names the payment, not its link: ask the payments service which link it paid.
    const paymentId = event.payload.payment?.id;
    const linkId = event.payload.payment_link?.id ?? event.payload.payment?.link_id
      ?? (paymentId ? (await payments.listPaymentLinks({ payment_id: paymentId }))[0]?.id : undefined);
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
    openMonthlyFees();
    for (const due of [...store.dues.values()]) {
      if (due.state !== "open") continue;
      await addLateFee(due);
      if (due.state === "open") await remind(due);
    }
  }

  async function handle(event: AgentEvent): Promise<void> {
    if (event.kind === "message") return onMessage(event.message);
    if (event.kind === "payment_event") return onPaymentEvent(event.event);
    if (event.kind === "approval_decision") return refunds.onApprovalDecision(event);
    return onTick();
  }

  return { handle };
}
