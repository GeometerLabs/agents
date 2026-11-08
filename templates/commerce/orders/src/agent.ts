// The Orders agent: handle(event) processes ONE inbound message, ONE payment event, ONE answer of the approvals relay, or ONE tick of the clock, and returns. Each call is a
// separate step, so the engine can later drive the agent one task at a time.
//
// How it stays honest (the design rules in the implementation plan):
//  - "Confirmed" is judged from the payment record and nothing else. An order is confirmed after the payments service's own list (or, for UPI, the owner's mark) shows the
//    whole advance. What a customer says, or a screenshot, never confirms an order; what a webhook says is only a reason to look.
//  - Stock, the day's order count and the cut-off are not the AI's to decide: they are limits (limits.ts) worked out from the settings and the orders themselves. An order
//    waiting for its advance holds its stock only until its hold runs out, and a hold never outlives the cut-off.
//  - After a lost reply it LOOKS before it retries (by the order's reference), so a retry cannot make a second link.
//  - Every customer message is one of the templates, checked against the record before it is sent: the items, the quantities, the amounts, the day, the slot and the place.
//  - A refund is never more than the payment, at most one per payment, and above the limit Guard holds it for the owner.
// The care that is the same for every template is in modules/: sending a message (messaging/say.ts), making a payment link (payments/links.ts), asking for a refund and
// following Guard's hold (payments/refunds.ts) and reading a message with the month's AI allowance (understanding/reader.ts). What is left here is Orders: the menu, the
// slot, the order's states and its words.
//
// A shop that takes UPI (settings "payment": {"module": "upi"}, plan B33) has no payment service the agent can read: the customer pays the shop's own UPI ID and the advance
// counts only when the owner marks it received, from their own number, with a one-use code (modules/payments/upi). The requests and marks live in this agent's store and are
// read through the same Payments shape, so "confirmed only when the payment record shows it" holds, with the owner's marks as that record. A mark after the hold ended never
// confirms an order by itself, and a refund is never sent by the agent: the owner owes it, is reminded, and the customer hears "sent" only after the owner marks it.
//
// The licence (plan B13; modules/licence). While the shop's lease puts it in its WIND-DOWN, the agent takes no new orders: a customer who asks to order is answered "online
// ordering is paused, please contact the shop", no hold or advance link is made, and nothing is kept to do later. Cancellations, refunds owed and payments from links sent
// earlier go on as every day. In the FINAL STOP the agent also closes the open advance links (Razorpay; a UPI shop has none) and sends nothing more.
import { RELAY_CODE_REPLY } from "../../../../modules/approvals/code.ts";
import { HANDOVER_ACTION, handoverHash, parseHandoverReply } from "../../../../modules/approvals/handover.ts";
import { RECOVERY_ENTRY } from "../../../../modules/unfinished/registry.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { HOUR, MINUTE, daysBetween, localParts } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { formatInr } from "../../../../modules/language/format.ts";
import { resolveDate } from "../../../../modules/language/dates.ts";
import type { TimePhrase } from "../../../../modules/language/dates.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { Choice } from "../../../../modules/language/interactive.ts";
import type { InteractiveMessage } from "../../../../modules/language/interactive.ts";
import { LICENCE_RULE, UNRESTRICTED } from "../../../../modules/licence/rules.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import type { InboundMessage, Messaging } from "../../../../modules/messaging/messaging.ts";
import { createSay } from "../../../../modules/messaging/say.ts";
import { ensureLink as makeLink } from "../../../../modules/payments/links.ts";
import type { PaymentEvent, Payments } from "../../../../modules/payments/payments.ts";
import { createRefunds } from "../../../../modules/payments/refunds.ts";
import { emptyUpiState, markReceived, markRefund, oweRefund, reminded, remindersDue, upiPayments } from "../../../../modules/payments/upi/ledger.ts";
import type { OwedRefund, UpiMark, UpiRequest } from "../../../../modules/payments/upi/ledger.ts";
import { parseUpiReply } from "../../../../modules/payments/upi/owner.ts";
import type { UpiReply } from "../../../../modules/payments/upi/owner.ts";
import { UPI_ACTIONS } from "../../../../modules/payments/upi/obligations.ts";
import { upiOf } from "../../../../modules/payments/upi/settings.ts";
import type { Action, ActionRecord, Outcome } from "../../../../modules/record/record.ts";
import { RULES } from "../../../../modules/understanding/model.ts";
import { createReader } from "../../../../modules/understanding/reader.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import { coerceIntent } from "./adapters/model.ts";
import type { Intent, IntentParser, ParseContext, ParseOptions } from "./adapters/model.ts";
import { isPaidClaim, parseIntent } from "./adapters/rule-parser.ts";
import { addLine, countOf, factsFor, fixSlot, latestOrder, moveTo, newDraft, ordersOn, register, slotMoments, takenOf, totalOf } from "./order.ts";
import type { Order, Pending, Store } from "./order.ts";
import { buttonsFor, intentFromReply, itemList, ownerUpiButtons, slotList } from "./language/interactive.ts";
import type { ButtonId } from "./language/interactive.ts";
import { templateMessage } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "./language/templates.ts";
import type { MessageFacts, TemplateId } from "./language/templates.ts";
import { areaOf, checkBeforeCutoff, checkConfirmOnlyWhenRecorded, checkDayCap, checkDeliveryArea, checkMessageMatchesRecord, checkOneAdvancePerOrder, checkOrderSize, checkPriceAtOrAboveMenu, checkRefundLimit, checkStock } from "./limits.ts";
import { advanceFor, allSlots, itemName, itemOf, slotOf } from "./settings.ts";
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
  /** A UPI shop: make the QR picture of a `upi://pay` link and put it where WhatsApp can fetch it; its https address, or null (modules/payments/upi/qr-image.ts). Left out, or null, the words carry the link, the UPI ID and the amount. */
  qrImage?: (text: string) => Promise<string | null>;
  /** The shop's licence right now (modules/licence; the runtime reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
}

export type AgentEvent =
  | { kind: "message"; message: InboundMessage } // a customer's (or the owner's) WhatsApp message
  | { kind: "payment_event"; event: PaymentEvent } // a Razorpay webhook
  // The approvals relay says what the owner decided about a refund Guard is holding. It carries no authority: Guard releases the refund only if its own record says the
  // owner approved, so a forged "approve" makes the agent ask Guard once more and nothing else.
  | { kind: "approval_decision"; approval: string; decision: "approve" | "deny"; id?: string }
  // The panel's to-do list asks the agent to look again or ask again about one order (modules/unfinished). It carries no authority: the agent does what it does every day, through Guard.
  | { kind: "recovery"; id: string; case: string; action: string }
  | { kind: "tick" }; // time has passed: let holds expire and finish the day's orders

export interface Agent { handle(event: AgentEvent): Promise<void> }

/** "I paid" while an advance waits, on a UPI shop: it asks the owner to look. It never marks anything paid. */
type Offer =
  | { kind: "items"; body?: TemplateId[] }
  | { kind: "slots"; windows: { id: string; fromMs: number; toMs: number }[]; body?: TemplateId[] }
  | { kind: "buttons"; buttons: ButtonId[]; body?: TemplateId[] }
  // the owner's UPI buttons ("Received ₹200", "Refund sent"), each carrying its one-use code
  | { kind: "owner_upi"; choices: Choice[]; body?: TemplateId[] };

interface SayArgs { booking: Order | null; phone: string; to: "customer" | "owner"; templates: TemplateId[]; refundInr?: number; shown?: Decision[]; action?: Action; offer?: Offer; image?: { link: string; caption: TemplateId[] }; upiCode?: string; markedInr?: number; leftInr?: number; itemId?: string; leftCount?: number; areas?: boolean }
type More = Omit<SayArgs, "booking" | "phone" | "to" | "templates">;

/** What a step tells the customer along with the words that ask for what is missing. */
interface Ctx { prefix: TemplateId[]; shown: Decision[]; itemId?: string }

export function createAgent(deps: AgentDeps): Agent {
  const { settings, clock, messaging, parser, record, store } = deps;
  // UPI (B33): the requests and the owner's marks live in this agent's own store and are read through the same shape as Razorpay's; deps.payments is never called.
  const upi = upiOf(settings.payment);
  const upiState = upi ? (store.upi ??= emptyUpiState()) : undefined;
  const payments: Payments = upi ? upiPayments(upiState!, upi, clock) : deps.payments;
  const policy: AiPolicy = deps.ai ?? {};
  const licence = deps.licence ?? (() => UNRESTRICTED);
  const tz = settings.timezone;
  const owner = settings.owner.whatsapp;
  const parseContext: ParseContext = { menu: settings.menu, slots: allSlots(settings).map(({ slot }) => ({ id: slot.id, names: slot.names ?? {} })), languages: settings.languages };
  const approveOver = settings.owner.approveOverInr;

  const customerOf = (phone: string) => {
    let c = store.customers.get(phone);
    if (!c) { c = { phone, optedOut: false }; store.customers.set(phone, c); }
    return c;
  };
  const languageOf = (phone: string, o?: Order | null): Language => o?.language ?? store.customers.get(phone)?.language ?? settings.languages[0];

  function log(o: Order | null, phone: string, action: Action, outcome: Outcome, inputs: unknown, more: { decisions?: Decision[]; notes?: string; refs?: Record<string, string>; language?: Language } = {}) {
    return record.append({ conversation: phone, booking: o?.id || null, action, inputs, outcome, language: languageOf(phone, o), ...more });
  }

  // ---- saying things -------------------------------------------------------------------------------------------

  function buildInteractive(offer: Offer, templates: TemplateId[], facts: MessageFacts, language: Language): InteractiveMessage {
    const body = (offer.body ?? templates).map((id) => render(id, facts)).join(" ");
    if (offer.kind === "items") return { body, list: itemList(settings, language) };
    if (offer.kind === "slots") return { body, list: slotList(offer.windows, tz, language) };
    if (offer.kind === "owner_upi") return { body, buttons: offer.choices };
    return { body, buttons: buttonsFor(language, offer.buttons) };
  }

  /**
   * The one way a message leaves the agent (modules/messaging/say.ts): it renders the templates from the record, runs the limits on the final text, sends only if none
   * blocks, and reads the message back from the messaging service. Returns whether it went out. What is Orders' own is given here: the facts, the offers, and the two gates
   * ("confirmed" only when recorded, and the licence's final stop).
   */
  const say = createSay<SayArgs, MessageFacts>({
    messaging,
    voice: {
      render: (id, facts) => render(id as TemplateId, facts),
      templateMessage: (a) => templateMessage({ ...a, ids: a.ids as TemplateId[] }),
      genericNames: { ...TEMPLATE_NAMES, reminder: TEMPLATE_NAMES.customer },
      matches: (text, facts) => checkMessageMatchesRecord({ text, facts }),
    },
    owner: { whatsapp: owner, language: settings.owner.language },
    languageOf: (phone, order) => languageOf(phone, order),
    optedOut: (phone) => customerOf(phone).optedOut,
    factsFor: (a, language) => factsFor(settings, a.booking, language, {
      customerPhone: a.phone, refundInr: a.refundInr, menu: a.templates.includes("menu") || a.offer?.kind === "items", areas: a.areas, itemId: a.itemId, leftCount: a.leftCount,
      ...(a.offer?.kind === "slots" ? { slotChoices: a.offer.windows } : {}), upiCode: a.upiCode, markedInr: a.markedInr, leftInr: a.leftInr, nowMs: clock.now(),
    }),
    interactiveFor: (a, facts, language) => buildInteractive(a.offer!, a.templates, facts, language),
    inputsOf: (a) => ({ refundInr: a.refundInr, ...(a.markedInr !== undefined ? { markedInr: a.markedInr } : {}) }), // never the owner's code
    gates: (a) => [
      ...(a.booking && (a.templates.includes("order_confirmed") || a.templates.includes("upi_order_confirmed")) ? [checkConfirmOnlyWhenRecorded({ record, order: a.booking.id, advancePaise: (a.booking.advanceInr ?? 0) * 100 })] : []),
      ...(licence().state === "stopped" ? [stoppedGate] : []),
    ],
    log: (order, phone, action, outcome, inputs, more) => log(order, phone, action, outcome, inputs, more),
    heldBack: async (a) => { await say({ booking: a.booking, phone: a.phone, to: "owner", templates: ["owner_message_held"] }); },
  });

  const tellCustomer = (o: Order | null, phone: string, templates: TemplateId[], more: More = {}) => say({ booking: o, phone, to: "customer", templates, ...more });
  const tellOwner = (o: Order | null, phone: string, template: TemplateId, more: More = {}) => say({ booking: o, phone, to: "owner", templates: [template], ...more });

  const itemsOffer = (body: TemplateId[]): Offer => ({ kind: "items", body });
  const yesNo = (body: TemplateId[]): Offer => ({ kind: "buttons", buttons: ["yes", "no"], body });
  const cancelOrOwner: Offer = { kind: "buttons", buttons: ["cancel", "owner"] };
  /** A UPI shop's customer, while their advance waits: "I have paid" (the owner is asked to look; nothing is marked paid), cancel, or talk to the owner. */
  const paidCancelOrOwner: Offer = { kind: "buttons", buttons: ["paid", "cancel", "owner"] };
  const waitingOffer = (): Offer => (upi ? paidCancelOrOwner : cancelOrOwner);

  // ---- the licence: no new orders in the wind-down, nothing more sent in the final stop --------------------------

  const stoppedGate: Decision = { ruleId: LICENCE_RULE, verdict: "block", reason: "the shop's licence has reached its final stop, so nothing more is sent from here (the owner's one notice aside); the runtime's own check of the lease" };

  /** A request for new work while online ordering is paused: said in the record, answered "please contact the shop", and nothing kept to do later. */
  async function pausedReply(phone: string, asked: string): Promise<void> {
    const decision: Decision = { ruleId: LICENCE_RULE, verdict: "block", reason: `online ordering is paused: the shop's licence is in its ${licence().state === "stopped" ? "final stop" : "wind-down"}, so no order, hold or advance link is made, and nothing is kept to do later (the runtime's own check of the lease)` };
    log(null, phone, "new_work", "blocked", { asked }, { decisions: [decision], notes: "the customer is told online ordering is paused and to contact the shop" });
    await tellCustomer(null, phone, ["orders_paused"]);
  }

  /** One record line each time the licence restricts the shop, or stops restricting it. Nothing asked during a wind-down is done when it ends: the customer asks again. */
  function noteLicence(): void {
    const l = licence();
    const now = l.restricted ? l.state : "active";
    let was = "active";
    const entries = record.entries();
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].action === "licence") { was = entries[i].refs.state ?? "active"; break; }
    if (now === was) return;
    const notes = now === "wind_down" ? "The shop's licence is in its wind-down (the lease fleet signed, read on this server): no new order or advance link is made, and nothing is kept to do later. Refunds owed, cancellations, existing orders and payments from links sent earlier go on."
      : now === "stopped" ? "The shop's licence has reached its final stop: open advance links are closed and nothing more is sent from here, except the owner's one notice. Payments already made are still recorded and refunds still go through. Nothing is deleted."
      : "The shop's licence is in order again: new orders are taken from now on. Nothing asked during the wind-down is done now; a customer who still wants it asks again.";
    log(null, owner, "licence", "confirmed", { state: now }, { refs: { state: now, ...(l.paidThrough !== null ? { paidThrough: String(l.paidThrough) } : {}) }, notes });
  }

  /** The final stop, once for each `paid_through`: close every open advance link at Razorpay through Guard, so no new payment comes in. A UPI shop has none to close. */
  async function closeLinksAtStop(): Promise<void> {
    const l = licence();
    if (l.state !== "stopped" || upi) return;
    const key = `stop:${l.paidThrough ?? 0}`;
    for (const o of [...store.orders.values()]) {
      if (o.state !== "awaiting_advance" || !o.linkId) continue;
      if (record.entries().some((e) => e.booking === o.id && e.action === "cancel_advance_link" && e.refs.licence === key)) continue;
      const linkId = o.linkId;
      const closed = await payments.cancelPaymentLink(linkId).then(() => payments.fetchPaymentLink(linkId)).then((x) => x?.status === "cancelled").catch(() => false);
      log(o, o.customer, "cancel_advance_link", closed ? "confirmed" : "unconfirmed", { linkId }, { refs: { linkId, licence: key }, notes: closed ? "the final stop of the shop's licence: the open advance link is closed, so no new payment comes in; a payment already made is still recorded" : "the final stop of the shop's licence: the link could not be closed (it may be paid already, or Razorpay did not answer); the owner can close it in Razorpay" });
    }
  }

  // ---- refunds (modules/payments/refunds.ts) ---------------------------------------------------------------------------------
  //
  // A refund above the owner's limit is not decided here. The agent sends it like any other; Guard holds it (HTTP 202) and the approvals relay asks the owner, once, with a
  // code. The agent keeps the approval id and the exact bytes of the held call, and sends those same bytes again only when the relay says the owner approved. Whatever Guard
  // or the service answered, a refund that may have gone out is never sent again.

  const refunds = createRefunds<Order>({
    payments, clock, owner,
    limitInr: () => settings.refund.limitInr,
    log: (o, phone, action, outcome, inputs, more) => log(o, phone, action, outcome, inputs, more),
    tellCustomer: (o, phone, templates, more) => tellCustomer(o, phone, templates as TemplateId[], more),
    tellOwner: (o, phone, template, more) => tellOwner(o, phone, template as TemplateId, more),
    cases: () => store.orders.values(),
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired" },
  });
  const { requestRefund, overLimit } = refunds;
  const afterRefund = (o: Order, result: Parameters<typeof refunds.afterRefund>[1], a: { paymentId: string; amountInr: number; done: { customer: TemplateId; owner?: TemplateId }; held: TemplateId }) => refunds.afterRefund(o, result, a);

  // ---- reading a message, what it cost, the monthly allowance and button mode (modules/understanding/reader.ts) -------------------

  const reader = createReader<Intent, ParseContext, ParseOptions>({
    parser, context: parseContext, coerce: coerceIntent, policy, store, clock, timeZone: tz,
    log: (action, outcome, inputs, more) => log(null, owner, action, outcome, inputs, more),
    tellOwner: async (notice) => { await tellOwner(null, owner, notice === "allowance" ? "owner_ai_allowance" : notice === "override" ? "owner_ai_off" : "owner_ai_fault"); },
  });
  const { readIntent, understandingRefs, countUnderstood, announceButtonMode } = reader;

  // ---- the order: what the customer asked for ------------------------------------------------------------------------------

  /** The slots of a mode whose cut-off has not passed on a date, as windows a list can offer. */
  function openWindows(mode: "pickup" | "delivery", date: LocalDate): { id: string; fromMs: number; toMs: number }[] {
    const probe = { date } as Order;
    return slotMoments(settings, mode, date).filter((w) => { probe.slotId = w.id; return fixSlot(settings, probe) && probe.cutoffMs! > clock.now(); });
  }

  /** The slot a time the customer typed means ("1 pm" is the slot that starts at 1 pm), among the slots of the mode (or both modes). */
  function slotForTime(mode: "pickup" | "delivery" | undefined, phrase: TimePhrase): { id: string; mode: "pickup" | "delivery" }[] {
    const hours = phrase.period ? [phrase.period === "pm" ? (phrase.hour === 12 ? 12 : phrase.hour + 12) : (phrase.hour === 12 ? 0 : phrase.hour)] : phrase.hour >= 1 && phrase.hour <= 11 ? [phrase.hour, phrase.hour + 12] : [phrase.hour];
    return allSlots(settings).filter(({ slot, mode: m }) => (!mode || m === mode) && hours.some((h) => slot.from === `${String(h).padStart(2, "0")}:${String(phrase.minute).padStart(2, "0")}` || slot.from === `${h}:${String(phrase.minute).padStart(2, "0")}`)).map(({ slot, mode: m }) => ({ id: slot.id, mode: m }));
  }

  /** Put what the customer said into the draft. False when a date does not exist (31 November). */
  function fill(o: Order, intent: Intent): boolean {
    if (intent.items && intent.items.length > 0) { o.lines = []; for (const l of intent.items) addLine(o.lines, l.itemId, l.qty); }
    if (intent.date) {
      const r = resolveDate(intent.date, clock.now(), tz);
      if (!r) return false;
      o.date = r.date;
      o.dateNeedsConfirmation = r.needsConfirmation;
    }
    if (intent.mode && settings.delivery === undefined && intent.mode === "delivery") intent.mode = undefined; // the shop does not deliver
    if (intent.mode && intent.mode !== o.mode) {
      o.mode = intent.mode;
      if (o.slotId && slotOf(settings, o.slotId)?.mode !== o.mode) o.slotId = undefined;
      if (o.mode === "pickup") { o.area = undefined; o.address = undefined; o.awaitingAddress = false; }
    }
    if (intent.slotId) { o.slotId = intent.slotId; o.mode = slotOf(settings, intent.slotId)?.mode ?? o.mode; }
    else {
      const found = intent.slotIds ? intent.slotIds.flatMap((id) => { const s = slotOf(settings, id); return s && (!o.mode || s.mode === o.mode) ? [{ id, mode: s.mode }] : []; }) : intent.time ? slotForTime(o.mode, intent.time) : [];
      const modes = new Set(found.map((f) => f.mode));
      if (found.length > 0 && modes.size === 1) { o.slotId = found[0].id; o.mode = found[0].mode; }
    }
    if (intent.slotIds && !o.slotId) o.slotCandidates = intent.slotIds;
    if (!o.slotId && o.mode && o.slotCandidates) {
      const hit = o.slotCandidates.find((id) => slotOf(settings, id)?.mode === o.mode);
      if (hit) o.slotId = hit;
    }
    if (o.slotId) o.slotCandidates = undefined;
    return true;
  }

  const offerPrice = (o: Order, intent: Intent, ctx: Ctx): void => {
    if (intent.offerInr === undefined || o.lines.length === 0) return;
    const item = itemOf(settings, o.lines[0].itemId)!; // a price named is about the first item, one unit; the quote is always the menu price
    const d = checkPriceAtOrAboveMenu({ itemName: itemName(item, "en"), listInr: item.priceInr, proposedInr: intent.offerInr });
    ctx.shown.push(d);
    if (d.verdict === "block") { ctx.prefix.push("price_floor"); ctx.itemId = item.id; }
  };

  interface Availability { blocked: { id: TemplateId; more: More } | null; decisions: Decision[] }

  /** The limits about the order itself: the cut-off, the stock of every item, and the day's count. The slot's moments are fixed first. */
  function availability(o: Order): Availability {
    const now = clock.now();
    const decisions: Decision[] = [];
    fixSlot(settings, o);
    const cut = checkBeforeCutoff({ nowMs: now, cutoffMs: o.cutoffMs! });
    decisions.push(cut);
    if (cut.verdict === "block") return { blocked: { id: "after_cutoff", more: {} }, decisions };
    for (const l of o.lines) {
      const item = itemOf(settings, l.itemId)!;
      const taken = takenOf(store, o.date!, l.itemId, now, o.id);
      const d = checkStock({ itemName: itemName(item, "en"), wanted: l.qty, taken, dailyStock: item.dailyStock });
      decisions.push(d);
      if (d.verdict === "block") {
        const left = Math.max(0, item.dailyStock - taken);
        return { blocked: { id: left === 0 ? "sold_out" : "out_of_stock", more: { itemId: item.id, leftCount: left } }, decisions };
      }
    }
    const cap = checkDayCap({ ordersOnDay: ordersOn(store, o.date!, now, o.id), maxPerDay: settings.orders.maxPerDay });
    decisions.push(cap);
    if (cap.verdict === "block") return { blocked: { id: "day_full", more: {} }, decisions };
    return { blocked: null, decisions };
  }

  /** Ask for what is missing, or go on to the checks and the hold. Each time round, it asks for exactly the next thing. */
  async function proceed(o: Order, ctx: Ctx): Promise<void> {
    const phone = o.customer;
    const now = clock.now();
    const say1 = (templates: TemplateId[], more: More = {}) => tellCustomer(o, phone, [...ctx.prefix, ...templates], { shown: ctx.shown, itemId: ctx.itemId, ...more });
    if (o.lines.length === 0) { await say1(["menu"], { offer: itemsOffer([...ctx.prefix, "pick_items"]) }); return; }
    const size = checkOrderSize({ items: countOf(o.lines), maxItems: settings.orders.maxItemsPerOrder });
    if (size.verdict === "block") { ctx.shown.push(size); o.lines = []; await say1(["too_many_items"], { offer: itemsOffer(["too_many_items"]) }); return; }
    if (!o.date) { await say1(["ask_when"]); return; }
    const today = localParts(now, tz);
    const ahead = daysBetween(today, o.date);
    if (ahead < 0 || ahead > settings.orders.daysAhead) { o.date = undefined; o.dateNeedsConfirmation = false; await say1(["ask_when"]); return; }
    if (o.dateNeedsConfirmation) { await say1(["confirm_details"], { offer: yesNo([...ctx.prefix, "confirm_buttons"]) }); return; }
    if (!o.mode) {
      if (!settings.delivery) o.mode = "pickup";
      else { await say1(["ask_how"], { offer: { kind: "buttons", buttons: ["pickup", "delivery"], body: [...ctx.prefix, "ask_how"] } }); return; }
    }
    if (!o.slotId) {
      const windows = openWindows(o.mode, o.date);
      if (windows.length === 0) {
        // every slot of that day has closed: say so for the first one, and ask for another day
        o.slotId = (o.mode === "pickup" ? settings.pickup.slots : settings.delivery!.slots)[0].id;
        fixSlot(settings, o);
        const cut = checkBeforeCutoff({ nowMs: now, cutoffMs: o.cutoffMs! });
        ctx.shown.push(cut);
        o.slotId = undefined;
        await say1(["after_cutoff"]);
        return;
      }
      await say1(["ask_slot"], { offer: { kind: "slots", windows, body: [...ctx.prefix, "ask_slot"] } });
      return;
    }
    if (o.mode === "delivery" && !o.area) { o.awaitingAddress = true; await say1(["ask_address"], { areas: true }); return; }

    fixSlot(settings, o);
    const avail = availability(o);
    ctx.shown.push(...avail.decisions);
    if (avail.blocked) {
      log(o, phone, "check_order", "blocked", { date: o.date, slot: o.slotId }, { decisions: avail.decisions });
      if (avail.blocked.id === "after_cutoff") o.slotId = undefined;
      await say1([avail.blocked.id], avail.blocked.more);
      return;
    }
    o.totalInr = totalOf(settings, o.lines);
    o.advanceInr = advanceFor(settings, o.totalInr);
    if (approveOver > 0 && o.totalInr > approveOver) {
      moveTo(o, "awaiting_owner");
      o.pending.push({ kind: "big_order", totalInr: o.totalInr, askedAtMs: now });
      log(o, phone, "ask_owner", "held_for_owner", { totalInr: o.totalInr }, { decisions: ctx.shown, notes: `the order's total is above ${formatInr(approveOver)}, the line above which the owner approves an order before any payment is asked; nothing is held and no link is made until then`, refs: { to: "owner", kind: "big_order" } });
      await tellOwner(o, phone, "owner_big_order");
      await tellCustomer(o, phone, ["big_order_asked"], { shown: ctx.shown });
      return;
    }
    await proceedToHold(o, ctx);
  }

  // ---- the hold and the advance --------------------------------------------------------------------------------------------

  // ---- UPI, marked paid by the owner (B33; modules/payments/upi) ------------------------------------------------------------
  //
  // The customer pays the shop's own UPI ID. The agent cannot see that payment; the owner can, in their UPI app. So the advance counts only when the owner marks it
  // received, from their own number, with the one-use code the agent sent only to them. A screenshot, a "paid" button or the words "I paid" ask the owner to look, and mark
  // nothing. A refund is never sent by the agent: the owner owes it, is reminded, and the customer hears "sent" only after the owner marks it so.

  const requestOf = (o: Order): UpiRequest | undefined => upiState?.requests.find((r) => r.id === o.linkId);
  const receivedButtons = (request: UpiRequest, amountPaise: number): Offer | undefined =>
    request.code ? { kind: "owner_upi", choices: ownerUpiButtons(settings.owner.language, { kind: "received", code: request.code, amountInr: amountPaise / 100 }) } : undefined;
  const refundButtons = (r: OwedRefund): Offer | undefined =>
    r.code ? { kind: "owner_upi", choices: ownerUpiButtons(settings.owner.language, { kind: "refund", code: r.code, keepAllowed: r.keepAllowed === true }) } : undefined;
  /** The QR picture of the request's link, made once (best effort: without it the words carry the link, the UPI ID and the amount). */
  async function qrOf(request: UpiRequest): Promise<SayArgs["image"]> {
    if (request.imageLink === undefined && deps.qrImage) request.imageLink = (await deps.qrImage(request.link).catch(() => null)) ?? undefined;
    return request.imageLink ? { link: request.imageLink, caption: ["upi_qr_caption"] } : undefined;
  }

  const advancePaise = (o: Order): number => (o.advanceInr ?? 0) * 100;

  /** Hold the stock, make the advance link, and send the quote. The checks are run again here: the owner's yes can come long after the order was asked. */
  async function proceedToHold(o: Order, ctx: Ctx): Promise<void> {
    const phone = o.customer;
    const now = clock.now();
    if (!licence().takesNewWork) { o.slotId = undefined; if (o.state !== "enquiry") moveTo(o, "enquiry"); return pausedReply(phone, "hold"); } // nothing held, nothing kept for later
    const avail = availability(o);
    if (avail.blocked) {
      log(o, phone, "check_order", "blocked", { date: o.date, slot: o.slotId }, { decisions: avail.decisions });
      if (o.state !== "enquiry") moveTo(o, "enquiry");
      if (avail.blocked.id === "after_cutoff") o.slotId = undefined;
      o.pending = [];
      await tellCustomer(o, phone, [...ctx.prefix, avail.blocked.id], { shown: [...ctx.shown, ...avail.decisions], ...avail.blocked.more });
      return;
    }
    // The hold is the shop's time to pay, and never outlives the cut-off: after the cut-off the stock is back, whatever the hold said.
    o.holdExpiresAt = Math.min(now + settings.advance.holdMinutes * MINUTE, o.cutoffMs!);
    if (o.state === "enquiry" || o.state === "awaiting_owner" || o.state === "expired") moveTo(o, "awaiting_advance");
    o.pending = o.pending.filter((p) => p.kind !== "big_order");
    log(o, phone, "hold_stock", "confirmed", { lines: o.lines, date: o.date, slot: o.slotId, until: o.holdExpiresAt }, { decisions: avail.decisions, notes: "the order's stock and its place in the day's count are held until the hold ends or the cut-off, whichever is first; they are worked out from the orders themselves, not counted" });

    log(o, phone, "create_advance_link", "attempted", { amountPaise: advancePaise(o) });
    const { link, error } = await makeLink(payments, { reference: o.id, amountPaise: advancePaise(o), description: `${settings.name} advance` });
    if (!link) {
      log(o, phone, "create_advance_link", error ? "failed" : "unconfirmed", { amountPaise: advancePaise(o) }, { notes: error ?? "the payments service does not show the link" });
      o.holdExpiresAt = undefined;
      moveTo(o, "enquiry");
      await tellOwner(o, phone, "owner_link_failed");
      await tellCustomer(o, phone, ["link_failed"]);
      return;
    }
    o.linkId = link.id;
    o.linkUrl = link.short_url;
    log(o, phone, "create_advance_link", "confirmed", { amountPaise: advancePaise(o) }, { refs: { linkId: link.id } });
    if (upi) {
      const request = requestOf(o)!;
      if (!record.confirmedRefs(o.id, UPI_ACTIONS.request, "requestId").includes(request.id)) {
        log(o, phone, UPI_ACTIONS.request, "confirmed", { amountPaise: request.amountPaise }, { refs: { requestId: request.id, reference: o.id, amountPaise: String(request.amountPaise) }, notes: "a UPI request to the shop's own UPI ID; it counts as paid only when the owner marks it received" });
      }
      await tellCustomer(o, phone, [...ctx.prefix, "quote_and_link"], { shown: [...ctx.shown, ...avail.decisions], itemId: ctx.itemId, offer: paidCancelOrOwner, image: await qrOf(request) });
      await tellOwner(o, phone, "owner_upi_expected", { upiCode: request.code ?? undefined, offer: receivedButtons(request, request.amountPaise) });
      return;
    }
    await tellCustomer(o, phone, [...ctx.prefix, "quote_and_link"], { shown: [...ctx.shown, ...avail.decisions], itemId: ctx.itemId, offer: cancelOrOwner });
  }

  async function tellAlreadyWaiting(waiting: Order): Promise<void> {
    const request = upi ? requestOf(waiting) : undefined;
    await tellCustomer(waiting, waiting.customer, ["already_waiting"], { offer: waitingOffer(), ...(request ? { image: await qrOf(request) } : {}) });
  }

  async function onOrder(phone: string, intent: Intent): Promise<void> {
    if (!licence().takesNewWork) return pausedReply(phone, "order");
    const language = languageOf(phone);
    const waiting = latestOrder(store, phone, ["awaiting_advance", "awaiting_owner"]);
    let o = latestOrder(store, phone, ["enquiry"]);
    const hasDetails = (intent.items?.length ?? 0) > 0 || intent.date !== undefined || intent.time !== undefined || intent.slotId !== undefined || (intent.slotIds?.length ?? 0) > 0 || intent.mode !== undefined;

    if (!o && waiting) {
      // Already holding an order for this customer: a repeat of the same request gets the same link, not a second hold.
      const probe = newDraft(phone, language);
      Object.assign(probe, { lines: waiting.lines.map((l) => ({ ...l })), date: waiting.date, dateNeedsConfirmation: waiting.dateNeedsConfirmation, mode: waiting.mode, slotId: waiting.slotId, area: waiting.area, address: waiting.address });
      const same = !hasDetails || (fill(probe, intent) && JSON.stringify([probe.lines, probe.date, probe.mode, probe.slotId]) === JSON.stringify([waiting.lines, waiting.date, waiting.mode, waiting.slotId]));
      if (same) { await tellAlreadyWaiting(waiting); return; }
      await cancelWaiting(waiting, "replaced by a new request from the customer");
      // the new draft starts from what the customer said now, with the day, the way and the address they had (a change of item or day, say) carried over
      o = register(store, probe);
    } else if (!o) {
      o = register(store, newDraft(phone, language));
    }
    o.language = language;
    if (!fill(o, intent)) { await tellCustomer(o, phone, ["didnt_understand"], { offer: itemsOffer(["didnt_understand"]) }); return; }
    const ctx: Ctx = { prefix: [], shown: [] };
    offerPrice(o, intent, ctx);
    await proceed(o, ctx);
  }

  /** The next plain message from a customer whose delivery order waits for an address: the address. It names a place on the delivery list or it is not delivered to. */
  async function onAddress(o: Order, text: string): Promise<void> {
    const address = text.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120);
    const decision = checkDeliveryArea({ address, area: settings.delivery?.area ?? [] });
    if (decision.verdict === "block") {
      log(o, o.customer, "check_address", "blocked", { area: null }, { decisions: [decision], notes: "the address names no place on the delivery list; it is not kept" });
      await tellCustomer(o, o.customer, ["outside_area"], { areas: true, shown: [decision], offer: { kind: "buttons", buttons: ["pickup", "owner"], body: ["outside_area"] } });
      return;
    }
    o.area = areaOf(address, settings.delivery!.area)!;
    o.address = address;
    o.awaitingAddress = false;
    log(o, o.customer, "check_address", "confirmed", { area: o.area }, { decisions: [decision], notes: "the address names a place on the delivery list; the address itself goes only to the owner when the order is confirmed" });
    await proceed(o, { prefix: [], shown: [decision] });
  }

  async function onYes(phone: string): Promise<void> {
    const o = latestOrder(store, phone, ["enquiry"]);
    if (o?.dateNeedsConfirmation) { o.dateNeedsConfirmation = false; return proceed(o, { prefix: [], shown: [] }); }
    const waiting = latestOrder(store, phone, ["awaiting_advance", "awaiting_owner"]);
    if (waiting) { await tellAlreadyWaiting(waiting); return; }
    await tellCustomer(null, phone, ["didnt_understand"], { offer: itemsOffer(["didnt_understand"]) });
  }

  async function onNo(phone: string): Promise<void> {
    const o = latestOrder(store, phone, ["enquiry"]);
    if (o?.dateNeedsConfirmation) { o.date = undefined; o.dateNeedsConfirmation = false; await tellCustomer(o, phone, ["ask_when"]); return; }
    await tellCustomer(null, phone, ["didnt_understand"], { offer: itemsOffer(["didnt_understand"]) });
  }

  // ---- the advance: look, count, confirm ------------------------------------------------------------------------------------

  /** Compare the payments service's record of this order's link with what the agent has counted. */
  async function reconcilePayments(o: Order): Promise<void> {
    if (upi) { await reconcileUpi(o); return; }
    if (!o.linkId) return;
    const link = await payments.fetchPaymentLink(o.linkId);
    if (!link) { log(o, o.customer, "record_payment", "failed", { linkId: o.linkId }, { notes: "the payments service has no such link" }); return; }
    for (const payment of link.payments) {
      if (o.handledPayments.includes(payment.id)) continue;
      const rule = checkOneAdvancePerOrder({ record, order: o.id, paymentId: payment.id });
      o.handledPayments.push(payment.id);
      if (rule.verdict === "allow") {
        o.advancePaymentId = payment.id;
        log(o, o.customer, "record_payment", "confirmed", { linkId: link.id, amount: payment.amount }, { decisions: [rule], refs: { paymentId: payment.id, linkId: link.id, amountPaise: String(payment.amount) } });
        await afterAdvance(o);
      } else {
        log(o, o.customer, "record_payment", "blocked", { linkId: link.id, amount: payment.amount }, { decisions: [rule], refs: { paymentId: payment.id, amountPaise: String(payment.amount) } });
        await handleExtraPayment(o, payment.id, payment.amount / 100 - payment.amount_refunded / 100, rule);
      }
    }
  }

  async function afterAdvance(o: Order): Promise<void> {
    if (o.state === "awaiting_advance") return completeOrder(o);
    if (o.state === "expired") {
      // The hold ran out before the money came. If the cut-off has not passed and the stock and the day still allow it, take the order again; if not, give the money back.
      const avail = availability(o);
      log(o, o.customer, "check_order", avail.blocked ? "blocked" : "confirmed", { late: true }, { decisions: avail.decisions, notes: "the advance arrived after the hold ended: the order is taken again only if the cut-off, the stock and the day's limit still allow it" });
      if (!avail.blocked) { moveTo(o, "awaiting_advance"); return completeOrder(o); }
      return refundUnbookable(o, avail.blocked.id === "after_cutoff" ? "cutoff" : "stock");
    }
    return refundUnbookable(o, "inactive");
  }

  /** The advance is recorded: the order is confirmed, the customer is told, and so is the owner (what to prepare, and where it goes). */
  async function completeOrder(o: Order): Promise<void> {
    o.holdExpiresAt = undefined;
    moveTo(o, "confirmed");
    log(o, o.customer, "confirm_order", "confirmed", { lines: o.lines, date: o.date, slot: o.slotId, mode: o.mode }, { notes: "the payment record shows the whole advance" });
    await tellCustomer(o, o.customer, [upi ? "upi_order_confirmed" : "order_confirmed"], { offer: cancelOrOwner });
    await tellOwner(o, o.customer, o.mode === "delivery" ? "owner_delivery_confirmed" : "owner_order_confirmed");
  }

  /** A payment that is not the order's advance (a second payment on the same link): refund it and tell the owner. */
  async function handleExtraPayment(o: Order, paymentId: string, leftInr: number, oneAdvance: Decision): Promise<void> {
    const payment = await payments.fetchPayment(paymentId);
    if (payment && payment.amount_refunded >= payment.amount) return; // already refunded by someone
    const limit = checkRefundLimit({ amountInr: leftInr, limitInr: settings.refund.limitInr, paidInr: leftInr });
    if (limit.verdict === "block") { log(o, o.customer, "refund", "blocked", { paymentId, amountInr: leftInr }, { decisions: [oneAdvance, limit], refs: { paymentId, amountPaise: String(leftInr * 100) } }); return; }
    // Above the limit the agent does not ask the owner: Guard holds the refund, and the approvals relay asks, once.
    const result = await requestRefund(o, paymentId, leftInr, [oneAdvance, limit], limit.verdict !== "allow");
    await afterRefund(o, result, { paymentId, amountInr: leftInr, done: { customer: "duplicate_refund", owner: "owner_duplicate_payment" }, held: "duplicate_refund_pending" });
  }

  /** The advance arrived but there is no order it can confirm: the hold ended and the stock or the cut-off say no, or the order was cancelled. */
  async function refundUnbookable(o: Order, why: "stock" | "cutoff" | "inactive"): Promise<void> {
    const amountInr = o.advanceInr!;
    const limit = checkRefundLimit({ amountInr, limitInr: settings.refund.limitInr, paidInr: amountInr });
    const result = limit.verdict === "block" ? "stopped" : await requestRefund(o, o.advancePaymentId!, amountInr, [limit], limit.verdict !== "allow");
    if (o.state !== "cancelled") moveTo(o, "cancelled");
    await afterRefund(o, result, { paymentId: o.advancePaymentId!, amountInr, done: { customer: why === "stock" ? "stock_gone_refund" : why === "cutoff" ? "cutoff_passed_refund" : "refund_unused", owner: "owner_payment_unused" }, held: "cancelled_refund_pending" });
  }

  // ---- UPI: the owner's marks, refunds owed, claims ---------------------------------------------------------------------------

  /**
   * The owner's marks on this order's request, not counted yet. Each is recorded as "marked paid by owner". The advance counts once the marks add up to all of it; less, and
   * the order stays held and the owner is asked for the rest; more, and the extra is owed back. A mark after the hold ended (or the order was cancelled) never confirms by
   * itself: the owner and the builder are told, and the money is owed back unless the owner takes the order by hand.
   */
  async function reconcileUpi(o: Order): Promise<"confirmed" | "part" | "late" | "extra" | "none"> {
    const request = requestOf(o);
    if (!request) return "none";
    const fresh = request.marks.filter((m) => !o.handledPayments.includes(m.id));
    if (fresh.length === 0) return "none";
    for (const m of fresh) {
      o.handledPayments.push(m.id);
      log(o, o.customer, UPI_ACTIONS.marked, "confirmed", { requestId: request.id, amountPaise: m.amountPaise }, {
        refs: { paymentId: m.id, requestId: request.id, amountPaise: String(m.amountPaise), markedBy: "owner" },
        notes: m.afterClose ? "marked received by the owner after the request was closed: it does not confirm by itself" : "marked paid by owner: from the owner's own number, with a one-use code",
      });
    }
    const freshPaise = fresh.reduce((n, m) => n + m.amountPaise, 0);
    const last = fresh.at(-1)!;
    if (o.advancePaymentId) { // the advance was already whole: this is money beyond it
      await oweBack(o, last.id, freshPaise, "marked received beyond the advance", { customer: "upi_extra_refund_owed" });
      return "extra";
    }
    if (o.state !== "awaiting_advance") { await lateMark(o, last, freshPaise); return "late"; }
    const total = request.marks.reduce((n, m) => n + m.amountPaise, 0);
    if (total < advancePaise(o)) {
      // not the whole advance: not confirmed, the hold stays, and the owner is asked for the rest (a new code; the used one counts nothing again)
      log(o, o.customer, "upi_advance_part", "held_for_owner", { requestId: request.id, markedPaise: total }, { refs: { requestId: request.id, amountPaise: String(total) }, notes: `the owner marked ${formatInr(total / 100)} of the ${formatInr(advancePaise(o) / 100)} advance: not confirmed; the order stays held until the hold ends` });
      await tellOwner(o, o.customer, "owner_upi_part", { markedInr: total / 100, leftInr: (advancePaise(o) - total) / 100, upiCode: request.code ?? undefined, offer: receivedButtons(request, advancePaise(o) - total) });
      return "part";
    }
    o.advancePaymentId = last.id;
    if (total > advancePaise(o)) await oweBack(o, last.id, total - advancePaise(o), "marked received beyond the advance", { customer: "upi_extra_refund_owed" });
    await completeOrder(o);
    return total > advancePaise(o) ? "extra" : "confirmed";
  }

  /** A mark after the hold ended (or after the order was cancelled): recorded as received, never confirmed again by itself. The owner and the builder are told. */
  async function lateMark(o: Order, mark: UpiMark, amountPaise: number): Promise<void> {
    const expired = o.state === "expired";
    (o.refundIssues ??= []).push({ paymentId: mark.id, kind: "late_upi", atMs: clock.now(), note: `The owner marked ${formatInr(amountPaise / 100)} received for ${o.id} after its ${expired ? "hold had ended" : "cancellation"}. It was not confirmed again by itself; the owner owes it back${expired ? " or takes the order by hand" : ""}.` });
    if (!expired) { await oweBack(o, mark.id, amountPaise, "marked received after the order was cancelled", { customer: "upi_refund_owed" }); return; }
    await oweBack(o, mark.id, amountPaise, "marked received after the hold had ended: not confirmed again by itself", { customer: "upi_late_received", ownerTemplate: "owner_upi_late", keepAllowed: true, markedInr: amountPaise / 100 });
  }

  /** A refund the owner owes: recorded, the customer told it will come from the owner, the owner told what to send, with the code. The agent never sends it. */
  async function oweBack(o: Order, paymentId: string, amountPaise: number, why: string, x: { customer: TemplateId; ownerTemplate?: TemplateId; keepAllowed?: boolean; markedInr?: number; decisions?: Decision[] }): Promise<OwedRefund> {
    const r = oweRefund(upiState!, { caseId: o.id, customer: o.customer, paymentId, amountPaise, why, keepAllowed: x.keepAllowed }, clock.now());
    log(o, o.customer, UPI_ACTIONS.refundOwed, "held_for_owner", { paymentId, amountPaise }, { decisions: x.decisions, refs: { refundId: r.id, paymentId, amountPaise: String(amountPaise) }, notes: `owed back by the owner, who sends it from their own UPI app (${why}); the agent never sends it and tracks it until the owner marks it done` });
    const refundInr = amountPaise / 100;
    await tellCustomer(o, o.customer, [x.customer], { refundInr, markedInr: x.markedInr });
    await tellOwner(o, o.customer, x.ownerTemplate ?? "owner_upi_refund_owed", { refundInr, upiCode: r.code ?? undefined, markedInr: x.markedInr, offer: refundButtons(r) });
    return r;
  }

  /** "I have paid", the words, or a screenshot: thanks, the owner will confirm, a screenshot is not proof. The owner is asked to look, at most once an hour per order. */
  async function onPaidClaim(phone: string, via: "button" | "words" | "screenshot"): Promise<void> {
    const o = latestOrder(store, phone, ["awaiting_advance"]);
    const request = o ? requestOf(o) : undefined;
    if (!o || !request) {
      log(null, phone, UPI_ACTIONS.claim, "blocked", { claim: "paid", via }, { notes: "the customer says they paid, and no UPI advance is waiting for them; nothing is marked paid", refs: { to: "owner", via } });
      await tellCustomer(null, phone, ["upi_nothing_waiting"], { offer: { kind: "buttons", buttons: ["owner"] } });
      return;
    }
    await tellCustomer(o, phone, ["upi_paid_claim"]);
    const now = clock.now();
    const recently = o.claimTellAtMs !== undefined && now - o.claimTellAtMs < HOUR;
    let told = recently;
    if (!recently && request.code) { told = await tellOwner(o, phone, "owner_upi_claim", { upiCode: request.code, offer: receivedButtons(request, advancePaise(o) - request.marks.reduce((n, m) => n + m.amountPaise, 0)) }); if (told) o.claimTellAtMs = now; }
    log(o, phone, UPI_ACTIONS.claim, told ? "confirmed" : "failed", { claim: "paid", via }, { refs: { to: "owner", via, requestId: request.id }, notes: `the customer says they paid (${via === "screenshot" ? "a screenshot, which is not proof" : via === "button" ? "the I have paid button" : "in words"}); nothing is marked paid until the owner marks it${recently ? "; the owner was already asked in the last hour" : ""}` });
  }

  /** A picture from a customer. It is never looked at or kept. On a UPI shop it is read as "I paid" (a screenshot is not proof); a Razorpay shop answers nothing. */
  async function onPicture(msg: InboundMessage): Promise<void> {
    const phone = msg.from;
    log(null, phone, "receive_message", "confirmed", { image: true, id: msg.id }, { notes: "a picture: it is not looked at and nothing of it is kept; a picture is never proof of a payment", refs: { messageId: msg.id } });
    if (!upi || customerOf(phone).optedOut) return;
    await onPaidClaim(phone, "screenshot");
  }

  /** The owner's UPI reply: a mark of money received, or a refund marked sent (or kept). A code is used once; the same reply again counts nothing. */
  async function onUpiReply(reply: UpiReply, msg: InboundMessage): Promise<void> {
    const now = clock.now();
    const quietly = (outcome: "already" | "unknown", notes: string) => {
      log(null, owner, "upi_owner_reply", "blocked", { kind: reply.kind, id: msg.id }, { notes, refs: { command: reply.kind } });
      return say({ booking: null, phone: owner, to: "owner", templates: [outcome === "already" ? "owner_upi_already" : "owner_upi_unknown"] });
    };
    if (reply.kind === "received") {
      const result = markReceived(upiState!, reply.code, reply.amountPaise, now);
      if (result.kind === "already" || result.kind === "already_refund") { await quietly("already", "a code that was already used: the payment is counted once"); return; }
      if (result.kind !== "marked") { await quietly("unknown", result.kind === "bad_amount" ? "an amount that cannot be right for this payment" : "a code the agent never issued"); return; }
      const o = store.orders.get(result.request.reference);
      if (!o) { await quietly("unknown", "no order has this request"); return; }
      const outcome = await reconcileUpi(o);
      if (outcome === "confirmed" || outcome === "extra") await tellOwner(o, o.customer, "owner_upi_marked", { markedInr: result.mark.amountPaise / 100 });
      return;
    }
    const result = markRefund(upiState!, reply.code, reply.kind === "kept" ? "kept" : "done", now);
    if (result.kind === "already") { await quietly("already", "a refund code that was already used"); return; }
    if (result.kind !== "done" && result.kind !== "kept") { await quietly("unknown", result.kind === "not_allowed" ? "keeping this money was not offered" : "a code the agent never issued"); return; }
    const r = result.refund;
    const o = store.orders.get(r.caseId) ?? null;
    const refs = { refundId: r.id, paymentId: r.paymentId, amountPaise: String(r.amountPaise) };
    if (result.kind === "kept") {
      log(o, r.customer, UPI_ACTIONS.refundKept, "confirmed", { refundId: r.id }, { refs, notes: "the owner keeps this money for an order they take by hand: nothing is owed back" });
      await tellOwner(o, r.customer, "owner_upi_refund_kept", { refundInr: r.amountPaise / 100 });
      return;
    }
    log(o, r.customer, UPI_ACTIONS.refundDone, "confirmed", { refundId: r.id }, { refs, notes: "the owner marked the refund sent from their UPI app; only now is the customer told it was sent" });
    await tellCustomer(o, r.customer, ["upi_refund_sent"], { refundInr: r.amountPaise / 100 });
    await tellOwner(o, r.customer, "owner_upi_refund_marked", { refundInr: r.amountPaise / 100 });
  }

  /**
   * The unfinished-work list (B31) asks the owner again about a UPI order: each refund still owed (the reminder, with its code and button), and an advance the owner has not
   * finished confirming (the part still to come, or the customer's "I paid"). False when there is nothing UPI to ask about, so the usual asks are tried.
   */
  async function upiAskAgain(o: Order, note: (outcome: Outcome, notes: string) => unknown): Promise<boolean> {
    const owed = upiState!.refunds.filter((r) => r.caseId === o.id && r.state === "owed" && r.code);
    const request = requestOf(o);
    const open = request && request.code && (request.status === "created" || request.status === "partially_paid") && o.state === "awaiting_advance" ? request : undefined;
    if (owed.length === 0 && !open) return false;
    note("attempted", "telling the owner again about a UPI payment or refund");
    let told = true;
    for (const r of owed) told = (await tellOwner(o, o.customer, "owner_upi_refund_reminder", { refundInr: r.amountPaise / 100, upiCode: r.code!, offer: refundButtons(r) })) && told;
    if (open) {
      const markedPaise = open.marks.reduce((n, m) => n + m.amountPaise, 0);
      const left = advancePaise(o) - markedPaise;
      told = (markedPaise > 0
        ? await tellOwner(o, o.customer, "owner_upi_part", { markedInr: markedPaise / 100, leftInr: left / 100, upiCode: open.code!, offer: receivedButtons(open, left) })
        : await tellOwner(o, o.customer, "owner_upi_claim", { upiCode: open.code!, offer: receivedButtons(open, left) })) && told;
    }
    note(told ? "confirmed" : "failed", told ? "the owner was told again" : "the owner could not be told (the limits or the provider said no)");
    return true;
  }

  /** Refunds still owed: remind the owner, once a day, at most three times; after that they stay in the record's unfinished work. */
  async function remindOwedRefunds(now: number): Promise<void> {
    for (const r of remindersDue(upiState!, now)) {
      const o = store.orders.get(r.caseId) ?? null;
      reminded(r, now);
      const told = await tellOwner(o, r.customer, "owner_upi_refund_reminder", { refundInr: r.amountPaise / 100, upiCode: r.code ?? undefined, offer: refundButtons(r) });
      log(o, r.customer, UPI_ACTIONS.refundReminder, told ? "confirmed" : "failed", { refundId: r.id }, { refs: { refundId: r.id, amountPaise: String(r.amountPaise) }, notes: `reminder ${r.reminders} of a refund the owner still owes` });
    }
  }

  // ---- cancelling ------------------------------------------------------------------------------------------------------------

  async function closeLink(o: Order, why: string): Promise<void> {
    if (!o.linkId) return;
    const closed = await payments.cancelPaymentLink(o.linkId).then(() => payments.fetchPaymentLink(o.linkId!)).then((l) => l?.status === "cancelled").catch(() => false);
    log(o, o.customer, "cancel_advance_link", closed ? "confirmed" : "unconfirmed", { linkId: o.linkId }, { notes: closed ? why : "the link could not be closed: it may still be open or already paid" });
    if (upi && closed) log(o, o.customer, UPI_ACTIONS.closed, "confirmed", { requestId: o.linkId }, { refs: { requestId: o.linkId }, notes: `${why}; a mark by the owner that comes later is still recorded, and never confirms an order by itself` });
  }

  /** Give up an order that is waiting for its advance: its stock is free again at once (it is no longer held), and the link is closed. */
  async function cancelWaiting(o: Order, why: string): Promise<void> {
    o.holdExpiresAt = undefined;
    await closeLink(o, why);
    moveTo(o, "cancelled");
    o.pending = [];
    log(o, o.customer, "cancel_order", "confirmed", { state: "awaiting_advance" }, { notes: why });
    await reconcilePayments(o); // a payment that landed just before the cancel is refunded, not forgotten
  }

  /** The hold ran out. Before giving the stock up, look at the payments record: the event may have been lost. */
  async function expireHold(o: Order): Promise<void> {
    await reconcilePayments(o);
    if (o.state !== "awaiting_advance") return;
    await closeLink(o, "the hold ran out");
    moveTo(o, "expired");
    log(o, o.customer, "release_stock", "confirmed", { until: o.holdExpiresAt }, { notes: "the hold ran out before an advance was recorded, so the order's stock and its place in the day's count are free again" });
    await tellCustomer(o, o.customer, ["hold_expired"]);
    if (upi) {
      // part of the advance was marked, and the hold ran out: that part is the customer's, and the owner owes it back
      const marks = requestOf(o)?.marks ?? [];
      const partPaise = marks.reduce((n, m) => n + m.amountPaise, 0);
      if (partPaise > 0) await oweBack(o, marks.at(-1)!.id, partPaise, "part of the advance was marked received, and the hold ran out", { customer: "upi_refund_owed" });
    }
  }

  /** The order a "cancel" means: the paid one first, then one waiting for its owner or its advance, then a draft. */
  const cancellable = (phone: string): Order | undefined => latestOrder(store, phone, ["confirmed"]) ?? latestOrder(store, phone, ["awaiting_advance"]) ?? latestOrder(store, phone, ["awaiting_owner"]) ?? latestOrder(store, phone, ["enquiry"]);

  /** The customer tapped "Cancel order": nothing is cancelled yet. They are asked once, with Yes and No buttons; "Yes, cancel" is the same as typing cancel. */
  async function onCancelAsk(phone: string): Promise<void> {
    const o = cancellable(phone);
    if (!o || o.lines.length === 0) { await tellCustomer(o ?? null, phone, ["no_order_found"], { offer: itemsOffer(["no_order_found"]) }); return; }
    if (o.state !== "confirmed" || o.slotStartMs === undefined) { await onCancel(phone); return; } // nothing is paid: no need to ask twice
    await tellCustomer(o, phone, ["ask_cancel"], { offer: { kind: "buttons", buttons: ["cancelYes", "keep"] } });
  }

  /** "No, keep it": the order is left exactly as it was. */
  async function onKeep(phone: string): Promise<void> {
    const o = cancellable(phone);
    if (!o || o.slotStartMs === undefined) { await tellCustomer(null, phone, ["didnt_understand"], { offer: itemsOffer(["didnt_understand"]) }); return; }
    await tellCustomer(o, phone, ["kept"]);
  }

  /**
   * "Talk to the owner": the owner is told, once an hour for the same customer, and the customer is told the owner will message them. The agent does not reply on the
   * owner's behalf and decides nothing. If the owner could not be told, the customer is told that, and not that the owner will write.
   */
  async function onTalkToOwner(phone: string): Promise<void> {
    const customer = customerOf(phone);
    const now = clock.now();
    const recently = customer.ownerAskedAtMs !== undefined && now - customer.ownerAskedAtMs < HOUR;
    let told = recently;
    if (!recently) {
      told = await tellOwner(null, phone, "owner_wants_to_talk");
      if (told) customer.ownerAskedAtMs = now;
    }
    log(null, phone, "ask_owner", told ? "confirmed" : "failed", { by: "button" }, { refs: { to: "owner" }, notes: recently ? "the owner was already told in the last hour, so not again" : told ? "the customer asked to talk to the owner, and the owner was told" : "the owner could not be told" });
    await tellCustomer(null, phone, [told ? "told_owner" : "couldnt_tell_owner"]);
  }

  async function onCancel(phone: string): Promise<void> {
    const o = cancellable(phone);
    if (!o || o.lines.length === 0) { await tellCustomer(o ?? null, phone, ["no_order_found"], { offer: itemsOffer(["no_order_found"]) }); return; }

    if (o.state === "enquiry" || o.state === "awaiting_owner") {
      moveTo(o, "cancelled");
      o.pending = [];
      log(o, phone, "cancel_order", "confirmed", { state: "draft" });
      await tellCustomer(o, phone, [o.date ? "cancelled_no_advance" : "cancelled_draft"]);
      return;
    }
    if (o.state === "awaiting_advance") {
      await cancelWaiting(o, "cancelled by the customer before paying");
      await tellCustomer(o, phone, ["cancelled_no_advance"]);
      return;
    }

    // A confirmed order. Inside the cancellation window the advance goes back. Above the refund limit Guard holds it for the owner (asked once, by the relay). Outside the
    // window and within the limit, whether to give it back is the owner's call, and the agent asks. Outside the window AND above the limit it is the same one ask, Guard's:
    // asking twice about one refund is what this avoids. Either way the owner is told the order is cancelled, so it is not prepared.
    const hoursLeft = (o.slotStartMs! - clock.now()) / HOUR;
    const inWindow = hoursLeft >= settings.cancellation.windowHours;
    const amountInr = o.advanceInr!;
    o.pending = [];
    moveTo(o, "cancelled");
    log(o, phone, "cancel_order", "confirmed", { hoursLeft: Math.floor(hoursLeft), inWindow });
    await tellOwner(o, phone, "owner_order_cancelled");
    const limit = checkRefundLimit({ amountInr, limitInr: settings.refund.limitInr, paidInr: amountInr });
    if (limit.verdict === "block") { log(o, phone, "refund", "blocked", { paymentId: o.advancePaymentId, amountInr }, { decisions: [limit], refs: { paymentId: o.advancePaymentId!, amountPaise: String(amountInr * 100) } }); return; }
    // UPI: inside the window the advance is owed back by the owner, whatever the limit (the owner sends every UPI refund, so there is no Guard to hold one);
    // outside it the owner decides, as below.
    if (upi && inWindow) { await oweBack(o, o.advancePaymentId!, amountInr * 100, "cancelled inside the cancellation window", { customer: "upi_cancelled_refund_owed", decisions: [limit] }); return; }
    if (!inWindow && (limit.verdict === "allow" || upi)) {
      const late = checkRefundLimit({ amountInr, limitInr: settings.refund.limitInr, paidInr: amountInr, inCancellationWindow: false });
      o.pending.push({ kind: "refund", amountInr, paymentId: o.advancePaymentId!, reason: "late_cancellation", askedAtMs: clock.now() });
      log(o, phone, "refund", "held_for_owner", { paymentId: o.advancePaymentId, amountInr }, { decisions: [late], refs: { paymentId: o.advancePaymentId!, amountPaise: String(amountInr * 100) } });
      await tellCustomer(o, phone, ["cancelled_late"]);
      await tellOwner(o, phone, "owner_late_cancellation");
      return;
    }
    const result = await requestRefund(o, o.advancePaymentId!, amountInr, [limit], limit.verdict !== "allow");
    await afterRefund(o, result, { paymentId: o.advancePaymentId!, amountInr, done: { customer: "cancelled_refund" }, held: inWindow ? "cancelled_refund_pending" : "cancelled_late" });
  }

  // ---- the owner's answers -----------------------------------------------------------------------------------------

  async function onOwnerMessage(msg: InboundMessage): Promise<void> {
    // UPI (B33): "received K7M2QX", "refunded K7M2QX" or a tap on one of those buttons. Only the owner's number reaches here.
    const upiReply = upi ? parseUpiReply(msg) : undefined;
    if (upiReply) return onUpiReply(upiReply, msg);
    if (upi && msg.image) return; // a picture from the owner is not a mark: only the reply with its code is
    // "approve K7M2QX" answers the approvals relay, which reads the owner's messages too (the inbox gives it a copy). It is not for the agent: no reply and no record, so the
    // owner is not told "I didn't understand" about an answer that was understood elsewhere.
    if (RELAY_CODE_REPLY.test(msg.text)) return;
    // "move K7M2QX" is the owner agreeing to hand the shop to another partner or builder (modules/approvals/handover.ts). The record keeps the owner's number and the code's hash.
    const moving = parseHandoverReply(msg.text);
    if (moving) { log(null, owner, HANDOVER_ACTION, "confirmed", { command: "handover" }, { refs: { command: "handover", handover: handoverHash(moving) }, notes: "the owner agreed, from their own number, to hand the shop to another partner or builder. The panel checks the code before it moves anything" }); return; }
    const m = /^\s*(approve|deny)\s+(o-\d+)\s*$/i.exec(msg.text);
    const o = m ? store.orders.get(m[2].toLowerCase()) : undefined;
    const command = m?.[1].toLowerCase();
    const pending = o?.pending[0];
    const said = command ? { command } : undefined; // the record keeps the command in the clear, so a report can count approvals and refusals
    log(o ?? null, owner, "owner_decision", "attempted", { command, ref: m?.[2] }, { refs: said });
    if (!o || !command || !pending) {
      log(o ?? null, owner, "owner_decision", "blocked", { command }, { notes: "not a command for something waiting on the owner", refs: said });
      await say({ booking: null, phone: owner, to: "owner", templates: ["owner_unknown_command"] });
      return;
    }

    if (pending.kind === "guard_hold" || pending.kind === "refund_retry") {
      log(o, owner, "owner_decision", "blocked", { command }, { notes: pending.kind === "guard_hold" ? "this refund is held by Guard: it is answered with the code in the approval message, not with the order reference" : "this refund is being sent again by itself", refs: said });
      return;
    }

    if (pending.kind === "big_order") {
      o.pending = o.pending.filter((p) => p !== pending);
      log(o, owner, "owner_decision", "confirmed", { command }, { refs: said, notes: command === "approve" ? "the owner let the customer pay for this order" : "the owner refused this order" });
      if (command === "deny") { moveTo(o, "cancelled"); await tellCustomer(o, o.customer, ["big_order_denied"]); return; }
      await proceedToHold(o, { prefix: [], shown: [] });
      return;
    }

    if (command === "deny") {
      o.pending.shift();
      log(o, owner, "owner_decision", "confirmed", { command }, { notes: "the owner declined the refund", refs: said });
      await tellCustomer(o, o.customer, ["refund_denied"]);
      return;
    }
    const refund = pending as Extract<Pending, { kind: "refund" }>;
    const limit = checkRefundLimit({ amountInr: refund.amountInr, limitInr: settings.refund.limitInr, paidInr: refund.amountInr, ownerApproved: true });
    log(o, owner, "owner_decision", "confirmed", { command }, { refs: said });
    o.pending = o.pending.filter((x) => x !== pending);
    if (upi) { await oweBack(o, refund.paymentId, refund.amountInr * 100, "the owner approved a refund after a late cancellation", { customer: "upi_refund_owed", decisions: [limit] }); return; }
    const result = await requestRefund(o, refund.paymentId, refund.amountInr, [limit], overLimit(refund.amountInr));
    await afterRefund(o, result, { paymentId: refund.paymentId, amountInr: refund.amountInr, done: { customer: "refund_approved" }, held: "cancelled_refund_pending" });
  }

  // ---- STOP --------------------------------------------------------------------------------------------------------

  async function onStop(phone: string): Promise<void> {
    customerOf(phone).optedOut = true;
    log(null, phone, "opt_out", "confirmed", { by: "STOP" }, { notes: "no more messages to this customer, not even a reply" });
    await tellOwner(null, phone, "owner_opted_out");
  }

  // ---- a voice note ------------------------------------------------------------------------------------------------

  /**
   * A voice note (or an audio file) cannot be listened to yet (plan B29 is the voice module), so the sender gets one plain line asking them to type, in the language this
   * conversation already uses (else the shop's first language). The audio is never fetched or kept, the model is never asked about it, and it does not change the customer's
   * language. STOP means STOP: nothing is sent to a customer who opted out. The owner's messages are commands, so an owner's voice note gets the same line.
   */
  async function onVoiceNote(msg: InboundMessage): Promise<void> {
    const phone = msg.from;
    if (phone === owner) { await say({ booking: null, phone, to: "owner", templates: ["voice_note"], action: "voice_note_reply" }); return; }
    const customer = customerOf(phone);
    log(null, phone, "receive_message", "confirmed", { voiceNote: true, id: msg.id }, { notes: "a voice note: it is not listened to and nothing of it is kept", refs: { messageId: msg.id } });
    if (customer.optedOut) return; // STOP means STOP: nothing goes to them, even if they write again
    await tellCustomer(null, phone, ["voice_note"], { action: "voice_note_reply" });
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  async function onMessage(msg: InboundMessage): Promise<void> {
    if (store.seenMessages.has(msg.id)) {
      log(null, msg.from, "receive_message", "blocked", { id: msg.id }, { notes: `the same WhatsApp message (${msg.id}) was delivered again, so it is ignored` });
      return;
    }
    store.seenMessages.add(msg.id);
    if (msg.voiceNote) return onVoiceNote(msg);
    if (msg.from === owner) return onOwnerMessage(msg);
    if (msg.image) return onPicture(msg);

    const phone = msg.from;
    const customer = customerOf(phone);
    const mode = reader.mode();
    // UPI: "I paid" while an advance waits is read from a few plain words before any model; it is a claim, and the owner is asked to look. It marks nothing paid.
    if (upi && !msg.reply && !customer.optedOut && isPaidClaim(msg.text) && latestOrder(store, phone, ["awaiting_advance"])) {
      log(null, phone, "receive_message", "confirmed", { text: msg.text, id: msg.id }, { refs: { messageId: msg.id, step: "rules" } });
      return onPaidClaim(phone, "words");
    }
    // A delivery order waits for an address: the next plain message is it, unless it is a stop, a cancel, a request to talk to the owner, or a change to pickup.
    const addressing = !msg.reply && !customer.optedOut ? latestOrder(store, phone, ["enquiry"]) : undefined;
    if (addressing?.awaitingAddress) {
      const ruled = parseIntent(msg.text, parseContext);
      if (!["stop", "cancel", "refund", "owner"].includes(ruled.kind) && ruled.mode !== "pickup") {
        log(null, phone, "receive_message", "confirmed", { id: msg.id, address: true }, { refs: { messageId: msg.id, step: "rules" }, notes: "the message is the delivery address" });
        return onAddress(addressing, msg.text);
      }
    }
    // A tap on a button or a list row is read by looking its id up: no words are read, so no model is asked, whatever the mode. An id that is none of ours is read as words.
    const tapped = msg.reply ? intentFromReply(msg.reply.id, settings) : null;
    const { intent, note, understood } = tapped
      ? { intent: tapped, note: undefined, understood: RULES }
      : await readIntent(msg.text, { rulesOnly: mode.buttons || customer.optedOut }); // an opted-out customer gets no reply, so no model is paid to read it
    countUnderstood(understood);
    if (intent.language && settings.languages.includes(intent.language)) customer.language = intent.language;
    const notes = [note, intent.overrideAttempt ? "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing" : undefined].filter(Boolean).join("; ");
    log(null, phone, "receive_message", "confirmed", { text: msg.text, id: msg.id, ...(tapped ? { reply: msg.reply!.id } : {}) }, { notes, refs: { messageId: msg.id, ...understandingRefs(understood, tapped ? msg.reply!.kind : undefined) } });

    try {
      if (intent.kind === "stop") return await onStop(phone);
      if (customer.optedOut) return; // STOP means STOP: nothing goes to them, even if they write again

      switch (intent.kind) {
        case "order": return await onOrder(phone, intent);
        case "yes": return await onYes(phone);
        case "no": return await onNo(phone);
        case "cancel": return await (intent.ask ? onCancelAsk(phone) : onCancel(phone));
        case "refund": return await onCancelAsk(phone);
        case "owner": return await onTalkToOwner(phone);
        case "keep": return await onKeep(phone);
        case "paid": return await (upi ? onPaidClaim(phone, "button") : onPaidOnRazorpay(phone));
        case "greeting": if (!licence().takesNewWork) return await pausedReply(phone, "menu"); await tellCustomer(null, phone, ["menu"], { offer: itemsOffer(["pick_items"]) }); return;
        default: if (!licence().takesNewWork) return await pausedReply(phone, "menu"); await tellCustomer(null, phone, ["didnt_understand"], { offer: itemsOffer(["didnt_understand"]) });
      }
    } finally {
      await announceButtonMode(); // after the customer has their answer
    }
  }

  /** "I have paid" on a Razorpay shop: the agent looks at the payment record again and says what it shows. It never confirms an order on the customer's word. */
  async function onPaidOnRazorpay(phone: string): Promise<void> {
    const o = latestOrder(store, phone, ["awaiting_advance"]);
    if (!o) { await tellCustomer(null, phone, ["didnt_understand"], { offer: itemsOffer(["didnt_understand"]) }); return; }
    await reconcilePayments(o); // if the record shows it, the order is confirmed and the customer told, by the usual path
    if (o.state === "awaiting_advance") await tellAlreadyWaiting(o);
  }

  async function onPaymentEvent(event: PaymentEvent): Promise<void> {
    if (store.seenEvents.has(event.id)) {
      log(null, owner, "receive_payment_event", "blocked", { id: event.id, event: event.event }, { notes: `event ${event.id} was delivered again, so it is ignored` });
      return;
    }
    const orders = [...store.orders.values()];
    if (event.event === "refund.processed") {
      const paymentId = event.payload.refund!.payment_id;
      const o = orders.find((x) => x.handledPayments.includes(paymentId) || x.advancePaymentId === paymentId);
      const refundId = event.payload.refund!.id;
      const listed = (await payments.listRefunds(paymentId)).some((r) => r.id === refundId);
      log(o ?? null, o?.customer ?? owner, "receive_payment_event", listed ? "confirmed" : "unconfirmed", { id: event.id, event: event.event }, { refs: { refundId, paymentId }, notes: "the refund is on the payments service's own list" });
      store.seenEvents.add(event.id);
      return;
    }
    // A real payment.captured names the payment, not its link (Razorpay's body has the order id only): ask the payments service which link it paid.
    const paymentId = event.payload.payment?.id;
    const linkId = event.payload.payment_link?.id ?? event.payload.payment?.link_id
      ?? (paymentId ? (await payments.listPaymentLinks({ payment_id: paymentId }))[0]?.id : undefined);
    const o = linkId ? orders.find((x) => x.linkId === linkId) : undefined;
    if (!o) {
      log(null, owner, "receive_payment_event", "blocked", { id: event.id, event: event.event }, { notes: "no order has this payment link, so the event is ignored" });
      store.seenEvents.add(event.id);
      return;
    }
    log(o, o.customer, "receive_payment_event", "confirmed", { id: event.id, event: event.event }, { refs: { eventId: event.id } });
    await reconcilePayments(o); // the record decides; the event only said to look
    store.seenEvents.add(event.id); // only after it worked: a failed step can be run again with the same event
  }

  async function onTick(): Promise<void> {
    const now = clock.now();
    await announceButtonMode(); // the outside switch can change between messages; the owner hears of it on the next beat
    await refunds.sweep(now); // refunds first, whatever state their order is in (modules/payments/refunds.ts)
    if (upi) await remindOwedRefunds(now);
    await closeLinksAtStop();
    for (const o of [...store.orders.values()]) {
      if (o.state === "awaiting_advance" && o.holdExpiresAt !== undefined && o.holdExpiresAt <= now) await expireHold(o);
      if (o.state === "confirmed" && o.slotEndMs !== undefined && o.slotEndMs <= now) {
        moveTo(o, "completed");
        log(o, o.customer, "complete_order", "confirmed", { endMs: o.slotEndMs });
      }
    }
  }

  // ---- recovery: the panel's to-do list asks the agent to look again, or ask again -----------------------------------------------------------------------
  //   recheck_payment   read the payments service's own list for this order's link, and record any payment not yet counted (the normal path, with its rules)
  //   ask_owner_again   the owner has not answered: send the owner the same notice again (a big order, or a late cancellation's refund, or a UPI payment or refund)
  //   recheck_refund    look again, read-only, for a refund that may have gone (nothing is ever sent again)
  // Nothing here widens a limit: every call is one the agent already makes, and Guard decides each as it does every day.
  async function onRecovery(e: { id: string; case: string; action: string }): Promise<void> {
    const o = store.orders.get(e.case);
    const refs = { action: e.action, recovery: e.id };
    const note = (outcome: Outcome, notes: string) => log(o ?? null, owner, RECOVERY_ENTRY, outcome, { action: e.action, case: e.case }, { notes, refs });
    if (!o) return note("blocked", "no order has this id, so nothing was done");
    if (e.action === "recheck_payment") {
      if (!o.linkId) return note("blocked", "this order has no payment link to look at");
      note("attempted", "looking again at the payments service's list for this order's link");
      await reconcilePayments(o);
      return note("confirmed", "the payments service's list was read; any payment not yet counted was recorded above");
    }
    if (e.action === "ask_owner_again" && upi && (await upiAskAgain(o, note))) return;
    if (e.action === "ask_owner_again") {
      const big = o.pending.find((p): p is Extract<Pending, { kind: "big_order" }> => p.kind === "big_order");
      const refund = o.pending.find((p): p is Extract<Pending, { kind: "refund" }> => p.kind === "refund");
      if (!big && !refund) return note("blocked", "nothing the agent asked the owner is waiting (a refund Guard holds is asked by the approvals relay)");
      note("attempted", "telling the owner again");
      const told = big ? await tellOwner(o, o.customer, "owner_big_order") : await tellOwner(o, o.customer, "owner_late_cancellation");
      if (big) big.askedAtMs = clock.now();
      if (refund) refund.askedAtMs = clock.now();
      return note(told ? "confirmed" : "failed", told ? "the owner was told again" : "the owner could not be told (the limits or the provider said no)");
    }
    if (e.action === "recheck_refund") {
      if (!(o.refundIssues ?? []).some((i) => ["unknown", "uncertain", "unconfirmed", "failed"].includes(i.kind))) return note("blocked", "no refund here is waiting on an unclear outcome");
      note("attempted", "looking again, read-only, for a refund that may have gone");
      const r = await refunds.recheck(o);
      return note("confirmed", `${r.settled} of ${r.looked} refunds now show on the payments service's list; none was sent again`);
    }
    note("blocked", `the agent has no recovery called "${e.action}"`);
  }

  async function handle(event: AgentEvent): Promise<void> {
    noteLicence();
    if (event.kind === "recovery") return onRecovery(event);
    if (event.kind === "message") return onMessage(event.message);
    if (event.kind === "payment_event") return onPaymentEvent(event.event);
    if (event.kind === "approval_decision") return refunds.onApprovalDecision(event);
    return onTick();
  }

  return { handle };
}
