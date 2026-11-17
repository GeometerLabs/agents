// The Stock orders agent: handle(event) processes ONE inbound WhatsApp message (the owner's or a supplier's) or ONE tick of the clock, and returns. Each call is a separate
// step, so the engine can later drive the agent one task at a time.
//
// How it stays honest (the design rules in the catalogue's "What adding Guard actually requires", section T07):
//  - The agent builds the exact order and the owner approves THAT: a card bound to the supplier, the supplier's number, the item, the unit, the quantity, the unit price, the
//    total in paise and the budget month (modules/assistant/cards.ts). On the owner's tap the order is read again as it is NOW and compared with the card; if anything
//    differs (the quantity was changed, the settings' price moved, the month turned) nothing is sent and a new card is made. A card answered once, replaced, or run out does
//    nothing when tapped again.
//  - The month's budget is not a counter: it is worked out from the orders (order.ts reservedPaise). It is checked and reserved in ONE synchronous step with the approval
//    (approve() below has no await inside it), so two orders racing for the last of the budget cannot both get it.
//  - The order message goes only through createSay (modules/messaging/say.ts), whose gates include `send-only-when-approved`, and only by SEND ONCE (modules/messaging/send-once.ts):
//    the step records an intent, and after the step is saved the runtime writes a claim, saves, sends and writes the ending. A claim with no ending (the process died) or a lost
//    reply means it may still have gone out: the order is marked `send_unknown`, is NEVER sent again by itself, the owner is asked ("They got it" / "Send it again", a fresh act
//    of theirs) and the supplier is asked about the same order number ("this is not a new order") when the follow-up time comes. A refusal that says nothing went out is tried
//    again an hour later, three tries at most. A request (the owner's WhatsApp message id) makes at most one order.
//  - What the supplier said, what arrived and whether it was paid are three different things (order.ts): the supplier's OK is not receipt, and the owner's receipt mark is not
//    payment. Only an answer from the supplier's own number counts as the supplier's. This agent never pays anyone: "paid po-3" is the owner's own note.
//  - Everything a message states (items, units, quantities, amounts, order numbers) is written from the record by a fixed template and read back against it before it is sent.
//  - The agent never guesses: an item, a supplier, a unit or a quantity it cannot tell is asked (a list or a question), and a unit is never converted into another.
// The care that is the same for every template is in modules/: sending a message (messaging/say.ts), the approval cards (assistant/cards.ts), reminders (reminders/), the
// record (record/). What is left here is stock orders: the catalogue, the order's states and its words.
import type { Clock } from "../../../../modules/core/clock.ts";
import type { RuntimeEvent } from "../../../../modules/runtime/events.ts";
import type { OwnerAction } from "../../../../modules/channels/events.ts";
import { assistantForAgent } from "../../../../modules/assistant/wire.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import type { TalkModel } from "../../../../modules/understanding/talk.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import { stockSkill } from "./assistant.ts";
import { CHAT_LIMITS } from "./chat-limits.ts";
import { ownerItems } from "./channel.ts";
import { HOUR, localParts } from "../../../../modules/core/time.ts";
import { canon } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { MONTH_NAMES } from "../../../../modules/language/format.ts";
import type { InteractiveMessage } from "../../../../modules/language/interactive.ts";
import { clip } from "../../../../modules/language/interactive.ts";
import { actionDigest, cardButtonId, cardByCode, cardById, closeCard, expireCards, judgeCard, judgeReply, makeCard, openCards, parseCardReply } from "../../../../modules/assistant/cards.ts";
import type { CardReply } from "../../../../modules/assistant/cards.ts";
import type { CardAction, CardRecord } from "../../../../modules/assistant/state.ts";
import { assistantOf } from "../../../../modules/assistant/state.ts";
import type { InboundMessage, Messaging } from "../../../../modules/messaging/messaging.ts";
import { createSay } from "../../../../modules/messaging/say.ts";
import type { SaidOutcome } from "../../../../modules/messaging/say.ts";
import { nextIntentId, openRefusals, openUnknowns, queueSend, resolveUnknown, retryNow, runSendOnce, sendOnceOf } from "../../../../modules/messaging/send-once.ts";
import type { SendEnding, SendIntent } from "../../../../modules/messaging/send-once.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import { strictest } from "../../../../modules/limits/limits.ts";
import type { Action, ActionRecord, Outcome } from "../../../../modules/record/record.ts";
import { scheduleAround, takeDue } from "../../../../modules/reminders/reminders.ts";
import { NO_RE, YES_RE, isStop } from "../../../../modules/understanding/rules.ts";
import { LABELS, pickId, supplierButtonId } from "./language/labels.ts";
import { TEMPLATE_NAMES, STATE_WORDS, money, render } from "./language/templates.ts";
import type { MessageFacts, StateKey, StatusRow, TemplateId } from "./language/templates.ts";
import { templateMessage } from "./language/meta-templates.ts";
import { checkApprovalMatches, checkApprovedSupplier, checkMessageMatchesRecord, checkOneOrderPerRequest, checkQuantity, checkSendOnlyWhenApproved, proposalChecks } from "./limits.ts";
import { SKILL, approvalAction, createStore, currentLine, holdsBudget, isOpen, monthOf, nextOrderId, orderRefOf, reservedPaise, totalOfPaise, unansweredFor, unitPaiseOf } from "./order.ts";
import type { Asking, PurchaseOrder, Store } from "./order.ts";
import { quantityIn, readOwnerText, supplierIn, unitIn, padded } from "./reading.ts";
import type { Reading } from "./reading.ts";
import { itemOf, lineByKey, lineKey, nameIn, supplierOf, unitOf } from "./settings.ts";
import type { Line, Settings, Supplier } from "./settings.ts";

export interface AgentDeps {
  settings: Settings;
  clock: Clock;
  messaging: Messaging;
  record: ActionRecord;
  store: Store;
  /** The shop's AI allowance and outside switch (modules/understanding/ai-state.ts), for the assistant's reading. Left out: none. */
  ai?: AiPolicy;
  /** How the shop's assistant reads the owner's words (modules/assistant/reading.ts). Left out: the rules alone. The assistant is on only with an "assistant" settings block. */
  ownerParser?: OwnerParser;
  /** The talk model (block M). Left out: no talk. */
  talker?: TalkModel;
  /**
   * Who sends the messages the step asked for (send once, modules/messaging/send-once.ts). The runtime sets this: the step only records them, and the runtime sends them after
   * the step is saved (`agent.sendOnce.run`). Left out (the harness, the browser demo, tests that drive the agent alone): `handle` sends them itself when its step ends, through
   * the same claim-send-ending code, with nothing to save.
   */
  sendLater?: boolean;
}

/** What the runtime hands the agent: a WhatsApp message, the clock, or an owner's press or words from their page. Every other kind is the runtime's own and does nothing here. */
export type AgentEvent = RuntimeEvent;

export interface Agent {
  handle(event: AgentEvent): Promise<void>;
  /** The messages the step asked for, sent once (see `sendLater`). The runtime calls it after the step's save. */
  sendOnce: { run(save: () => void): Promise<void> };
}

/** The two messages that go through send once: the order itself (it commits the owner, so a repeat can mean goods twice), and a reminder to the supplier about it. */
const ORDER_KIND = "purchase_order";
const CHECK_KIND = "supplier_check";

/** What goes with the words: the approval card's buttons, a list of ways to order, or the supplier's OK / cannot-supply buttons. */
type Offer = { kind: "card"; code: string; body?: TemplateId[] } | { kind: "choices"; options: string[]; body?: TemplateId[] } | { kind: "supplier"; body?: TemplateId[] };

interface SayArgs {
  /** The order the message is about, or null (a draft that was never made, a message about no order). */
  booking: PurchaseOrder | null;
  phone: string;
  to: "customer" | "owner";
  templates: TemplateId[];
  shown?: Decision[];
  action?: Action;
  offer?: Offer;
  /** Facts the message needs that the order does not hold: the budget's figures, the month, a number the owner wrote. */
  facts?: Partial<MessageFacts>;
}

/** The card is for 24 hours (modules/assistant/cards.ts); an owner who is asked and does not answer is not asked again by itself. */
const ASKING_FOR_MS = 6 * HOUR;
const HANDLED_KEEP = 500;

export function createAgent(deps: AgentDeps): Agent {
  const { settings, clock, messaging, record, store } = deps;
  const owner = settings.owner.whatsapp;
  const tz = settings.timezone;
  const digits = (n: string) => n.replace(/\D/gu, "");
  const supplierByNumber = (from: string): Supplier | undefined => settings.suppliers.find((s) => digits(s.whatsapp) === digits(from));
  const ownerLanguage = settings.owner.language;
  const cards = () => assistantOf(store);

  const languageOf = (phone: string): Language => (digits(phone) === digits(owner) ? ownerLanguage : supplierByNumber(phone)?.language ?? settings.languages[0]);

  function log(o: PurchaseOrder | null, phone: string, action: Action, outcome: Outcome, inputs: unknown, more: { decisions?: Decision[]; notes?: string; refs?: Record<string, string> } = {}) {
    return record.append({ conversation: phone, booking: o?.id || null, action, inputs, outcome, language: languageOf(phone), ...more });
  }

  // ---- the facts a message is written from ---------------------------------------------------------------------------------------

  const monthLabel = (ms: number): string => { const p = localParts(ms, tz); return `${MONTH_NAMES.en[p.month - 1]} ${p.year}`; };

  /** The budget's figures for a month, with one order left out of what is reserved (the one being decided), in rupees. */
  function budgetFacts(exceptId?: string, totalPaise = 0): Partial<MessageFacts> {
    const month = monthOf(clock.now(), tz);
    const reserved = reservedPaise(store, month, exceptId);
    const budget = settings.limits.monthlyBudgetInr;
    return { budgetInr: budget, reservedInr: reserved / 100, leftInr: Math.max(0, budget * 100 - reserved - totalPaise) / 100, capInr: settings.limits.maxPerOrderInr, monthLabel: monthLabel(clock.now()) };
  }

  function factsFor(a: SayArgs, language: Language): MessageFacts {
    const o = a.booking;
    const base: MessageFacts = { language, timeZone: tz, businessName: settings.name };
    if (o) {
      const supplier = supplierOf(settings, o.supplier);
      Object.assign(base, {
        supplierName: supplier.name, itemName: nameIn(itemOf(settings, o.item).names, language), unitName: nameIn(unitOf(settings, o.unit).names, language),
        qty: o.qty, unitPriceInr: o.unitPaise / 100, totalInr: o.totalPaise / 100, ...(o.id ? { orderRef: o.id } : {}),
      });
    }
    const facts = { ...base, ...(a.facts ?? {}) } as MessageFacts;
    if (a.offer?.kind === "choices") {
      facts.choices = a.offer.options.map((k) => {
        const l = lineByKey(settings, k)!;
        return { supplierName: supplierOf(settings, l.supplier).name, unitName: nameIn(unitOf(settings, l.unit).names, language), priceInr: l.priceInr };
      });
    }
    return facts;
  }

  function interactiveFor(a: SayArgs, facts: MessageFacts, language: Language): InteractiveMessage {
    const offer = a.offer!;
    const body = (offer.body ?? a.templates).map((id) => render(id, facts)).join(" ");
    const labels = LABELS[language];
    if (offer.kind === "card") return { body, buttons: [{ id: cardButtonId("yes", offer.code), title: labels.approve }, { id: cardButtonId("no", offer.code), title: labels.decline }] };
    if (offer.kind === "supplier") return { body, buttons: [{ id: supplierButtonId("ack", a.booking!.id), title: labels.supplierYes }, { id: supplierButtonId("nack", a.booking!.id), title: labels.supplierNo }] };
    return {
      body,
      list: {
        button: labels.choose,
        rows: offer.options.map((k, i) => {
          const c = facts.choices![i];
          return { id: pickId(i), title: clip(`${c.supplierName} (${c.unitName})`, 24), description: clip(`${money(c.priceInr)} / ${c.unitName}`, 72) };
        }),
      },
    };
  }

  /**
   * The one way a message leaves the agent: rendered from the record, checked against it, sent, read back. "customer" is the supplier here. The gates: opt-out and
   * message-matches-record (shared), and `send-only-when-approved` for every message that carries or repeats an order.
   */
  const say = createSay<SayArgs, MessageFacts>({
    messaging,
    voice: {
      render: (id, facts) => render(id as TemplateId, facts),
      templateMessage: (a) => templateMessage({ ...a, ids: a.ids as TemplateId[] }),
      genericNames: { ...TEMPLATE_NAMES, reminder: TEMPLATE_NAMES.customer },
      matches: (text, facts) => checkMessageMatchesRecord({ text, facts }),
    },
    owner: { whatsapp: owner, language: ownerLanguage },
    languageOf: (phone) => languageOf(phone),
    optedOut: (phone) => store.optedOut.has(digits(phone)),
    factsFor: (a, language) => factsFor(a, language),
    interactiveFor: (a, facts, language) => interactiveFor(a, facts, language),
    inputsOf: () => ({}), // never the owner's one-use code
    gates: (a) => (a.to === "customer" && a.templates.some((t) => t === "supplier_order" || t === "supplier_check") && a.booking
      ? [checkSendOnlyWhenApproved({ approved: a.booking.approvedMs !== undefined && holdsBudget(a.booking), supplier: supplierOf(settings, a.booking.supplier) })] : []),
    log: (order, phone, action, outcome, inputs, more) => log(order, phone, action, outcome, inputs, more),
    heldBack: async (a) => { if (a.booking?.id) await tellOwner(a.booking, "owner_message_held"); },
  });

  const tellOwner = (o: PurchaseOrder | null, template: TemplateId | TemplateId[], more: Partial<SayArgs> = {}) =>
    say({ booking: o, phone: owner, to: "owner", templates: Array.isArray(template) ? template : [template], ...more });
  const tellSupplier = (o: PurchaseOrder, supplier: Supplier, template: TemplateId, more: Partial<SayArgs> = {}) =>
    say({ booking: o, phone: supplier.whatsapp, to: "customer", templates: [template], ...more });

  // ---- the owner's catalogue questions ---------------------------------------------------------------------------------------------

  const itemNames = (language: Language): string[] => settings.items.map((i) => nameIn(i.names, language));
  const approvedLines = (): Line[] => settings.catalogue.filter((l) => supplierOf(settings, l.supplier).approved);
  const draftOf = (line: Line, qty: number): PurchaseOrder => ({
    id: "", requestId: "", lowStock: false, supplier: line.supplier, line: lineKey(line), item: line.item, unit: line.unit, qty, unitPaise: unitPaiseOf(line), totalPaise: totalOfPaise(unitPaiseOf(line), qty),
    state: "void", createdMs: clock.now(), ack: "none", receipt: "none", receivedQty: 0, asks: [],
  });

  /** An example request in the owner's language, from the catalogue's first line: what "I could not tell" suggests. */
  function exampleRequest(language: Language): string {
    const l = settings.catalogue[0];
    return `order ${l.reorderQty ?? 10} ${nameIn(unitOf(settings, l.unit).names, language)} ${nameIn(itemOf(settings, l.item).names, language)} from ${supplierOf(settings, l.supplier).name}`;
  }
  const didntUnderstand = () => tellOwner(null, "didnt_understand", { facts: { orderRef: "po-1", example: exampleRequest(ownerLanguage) } });

  const stateKeyOf = (o: PurchaseOrder): StateKey => {
    if (o.state === "awaiting_approval") return "awaiting";
    if (o.state === "approved") return "sending";
    if (o.state === "send_unknown") return "unknown";
    if (o.state === "send_failed") return "failed";
    if (o.state === "send_blocked") return "blocked";
    if (o.receipt === "part") return "part";
    return o.ack === "accepted" ? "accepted" : "sent";
  };
  const stateWord = (o: PurchaseOrder, language: Language): string => STATE_WORDS[language][stateKeyOf(o)];

  // ---- a request becomes an order with a card --------------------------------------------------------------------------------------

  /** A line of the catalogue and a quantity, from one request: the checks, then the order and its card, or the plain reason it was not made. */
  async function propose(args: { requestId: string; lowStock: boolean; line: Line; qty: number; phone: string }): Promise<void> {
    const { requestId, lowStock, line, qty, phone } = args;
    const supplier = supplierOf(settings, line.supplier);
    const once = checkOneOrderPerRequest({ requestId, requests: store.requests });
    if (once.verdict !== "allow") { log(null, phone, "propose_order", "blocked", { requestId }, { decisions: [once], notes: once.reason }); return; }
    // a low-stock mark never makes a second order while one for the same line is still open
    const open = lowStock ? [...store.orders.values()].find((o) => o.line === lineKey(line) && (o.state === "awaiting_approval" || isOpen(o))) : undefined;
    if (open) { await tellOwner(open, "already_open"); log(open, phone, "propose_order", "blocked", { requestId, lowStock }, { notes: "an order for this line is already open" }); return; }

    const draft = draftOf(line, qty);
    const month = monthOf(clock.now(), tz);
    const reserved = reservedPaise(store, month);
    const decisions = proposalChecks({ settings, supplier, qty, totalPaise: draft.totalPaise, reservedPaise: reserved });
    const worst = strictest(decisions);
    if (worst.verdict !== "allow") {
      const template: TemplateId = ({ "approved-supplier-only": "blocked_supplier", "order-quantity": "blocked_qty", "per-order-cap": "blocked_cap", "monthly-budget": "blocked_budget" } as Record<string, TemplateId>)[worst.ruleId] ?? "blocked_budget";
      log(null, phone, "propose_order", "blocked", { requestId, line: lineKey(line), qty }, { decisions, notes: worst.reason });
      await tellOwner(draft, template, { facts: { ...budgetFacts(), saidQty: qty, maxQty: settings.limits.maxQuantity } });
      return;
    }
    const order: PurchaseOrder = { ...draft, id: nextOrderId(store), requestId, lowStock, state: "awaiting_approval", createdMs: clock.now() };
    store.orders.set(order.id, order);
    store.requests.set(requestId, order.id);
    log(order, phone, "propose_order", "held_for_owner", { requestId, line: lineKey(line), qty, totalPaise: order.totalPaise }, { decisions, notes: "waiting for the owner's approval" });
    await showCard(order, []);
  }

  /** The card's action, from the order as it stands and the catalogue as it stands now: exactly the fields the owner approves (order.ts approvalAction, shared with the assistant and the page). */
  const actionOf = (o: PurchaseOrder, line: Line): CardAction => approvalAction(settings, o, line, clock.now());

  /** Make (or remake) the order's card and show it. Any older open card of this order is void first (modules/assistant/cards.ts makeCard). */
  async function showCard(o: PurchaseOrder, prefix: TemplateId[]): Promise<void> {
    const line = currentLine(settings, o)!;
    const { card, code } = makeCard(cards(), actionOf(o, line), { kind: "order", order: o.id }, clock.now());
    log(o, owner, "ask_owner", "held_for_owner", { card: card.id, digest: card.digest }, { refs: { card: card.id, kind: "order_approval" } });
    const facts = budgetFacts(o.id, o.totalPaise);
    await tellOwner(o, [...prefix, "card"], { offer: { kind: "card", code, body: [...prefix, "card"] }, facts: { ...facts, code } });
  }

  // ---- the owner answers a card ----------------------------------------------------------------------------------------------------

  /** Is the card's order still exactly what it showed? Read as the order and the catalogue are NOW (the judge compares the digests). */
  function currentOf(card: CardRecord): { ok: true; action: CardAction } | { ok: false; why: string } {
    const o = store.orders.get(card.action.case);
    if (!o || o.state !== "awaiting_approval") return { ok: false, why: "the order is not waiting for approval any more" };
    const line = currentLine(settings, o);
    if (!line) return { ok: false, why: "the item is no longer in the catalogue" };
    return { ok: true, action: actionOf(o, line) };
  }

  const onCardReply = (reply: CardReply): Promise<void> => applyVerdict(judgeReply(cards(), reply, clock.now(), currentOf));

  /** The one place a card's verdict becomes what the owner is told and what happens: a tap or a typed code on WhatsApp, or a press on the owner's page (by card id and digest). */
  async function applyVerdict(verdict: ReturnType<typeof judgeReply>): Promise<void> {
    switch (verdict.verdict) {
      case "unknown": await tellOwner(null, "card_unknown"); return;
      case "closed": await tellOwner(null, "card_closed"); return;
      case "gone": closeCard(cards(), verdict.card, "void", clock.now()); await tellOwner(null, "card_closed"); return;
      case "expired": {
        closeCard(cards(), verdict.card, "expired", clock.now());
        const o = store.orders.get(verdict.card.action.case);
        if (o && o.state === "awaiting_approval") o.state = "void";
        await tellOwner(null, "card_expired");
        return;
      }
      case "refuse": {
        closeCard(cards(), verdict.card, "refused", clock.now());
        await decline(store.orders.get(verdict.card.action.case)!, verdict.card);
        return;
      }
      case "changed": {
        // the order, the price or the month moved since the card was shown: that approval does not count. The order is brought up to date and asked about again.
        closeCard(cards(), verdict.card, "void", clock.now());
        const o = store.orders.get(verdict.card.action.case)!;
        const line = currentLine(settings, o)!;
        const same = checkApprovalMatches({ same: false, what: "price or month" });
        o.unitPaise = unitPaiseOf(line);
        o.totalPaise = totalOfPaise(o.unitPaise, o.qty);
        log(o, owner, "owner_decision", "blocked", { decision: "approve", card: verdict.card.id }, { decisions: [same], notes: same.reason, refs: { card: verdict.card.id } });
        await recheckAndShow(o, ["card_changed"]);
        return;
      }
      case "do": await approve(store.orders.get(verdict.card.action.case)!, verdict.card); return;
    }
  }

  /** After a change the order is checked again (cap, budget) before a new card is shown; a change that now breaks a limit ends the order. */
  async function recheckAndShow(o: PurchaseOrder, prefix: TemplateId[]): Promise<void> {
    const decisions = proposalChecks({ settings, supplier: supplierOf(settings, o.supplier), qty: o.qty, totalPaise: o.totalPaise, reservedPaise: reservedPaise(store, monthOf(clock.now(), tz), o.id) });
    const worst = strictest(decisions);
    if (worst.verdict !== "allow") {
      o.state = "void";
      const template: TemplateId = ({ "approved-supplier-only": "blocked_supplier", "order-quantity": "blocked_qty", "per-order-cap": "blocked_cap", "monthly-budget": "blocked_budget" } as Record<string, TemplateId>)[worst.ruleId] ?? "blocked_budget";
      log(o, owner, "propose_order", "blocked", { qty: o.qty, totalPaise: o.totalPaise }, { decisions, notes: worst.reason });
      await tellOwner(o, template, { facts: { ...budgetFacts(o.id), saidQty: o.qty, maxQty: settings.limits.maxQuantity } });
      return;
    }
    await showCard(o, prefix);
  }

  /**
   * The approval. Everything from the checks to the reservation is ONE synchronous step (no await): the budget is read from the orders, checked and reserved by
   * changing this order's state before anything else can run, so two approvals racing for the last of the budget cannot both be given it.
   */
  async function approve(o: PurchaseOrder, card?: CardRecord): Promise<boolean> {
    if (o.state !== "awaiting_approval") return false; // answered, cancelled or voided since: one approval only
    const supplier = supplierOf(settings, o.supplier);
    const month = monthOf(clock.now(), tz);
    const decisions = proposalChecks({ settings, supplier, qty: o.qty, totalPaise: o.totalPaise, reservedPaise: reservedPaise(store, month, o.id) });
    const worst = strictest(decisions);
    const cardRef = card ? { card: card.id } : {};
    if (worst.verdict !== "allow") {
      closeOrderCards(o, "void");
      o.state = "void";
      log(o, owner, "owner_decision", "blocked", { decision: "approve", ...cardRef }, { decisions, notes: worst.reason, refs: { ...cardRef } });
      const template: TemplateId = worst.ruleId === "approved-supplier-only" ? "blocked_supplier" : worst.ruleId === "per-order-cap" ? "blocked_cap" : "blocked_budget";
      await tellOwner(o, template, { facts: { ...budgetFacts(o.id), saidQty: o.qty, maxQty: settings.limits.maxQuantity } });
      return false;
    }
    closeOrderCards(o, "done");
    o.state = "approved";
    o.approvedMs = clock.now();
    o.budgetMonth = month;
    const matched = checkApprovalMatches({ same: true });
    log(o, owner, "owner_decision", "confirmed", { decision: "approve", ...cardRef, ...(card ? { digest: card.digest } : {}), totalPaise: o.totalPaise }, { decisions: [...decisions, matched], notes: "the owner approved exactly this order; the budget is reserved", refs: { ...cardRef, evidence: "owner_marked", month } });
    // ---- end of the one step; the rest talks to WhatsApp ----
    await tellOwner(o, "order_approved", { facts: budgetFacts(o.id, o.totalPaise) });
    queueOrder(o);
    return true;
  }

  /** Close every open approval card of this order (the agent's own and the assistant's for the same order): an answered order has no card left to tap. */
  function closeOrderCards(o: PurchaseOrder, to: "done" | "void" | "refused"): void {
    for (const c of cards().cards) if (c.state === "open" && c.action.skill === SKILL && c.action.kind === "order" && c.action.case === o.id) closeCard(cards(), c, to, clock.now());
  }

  /** The owner said no to an order that waits (a "no" on the card, or on the assistant's card for it). Nothing is reserved or sent. */
  async function decline(o: PurchaseOrder, card?: CardRecord): Promise<boolean> {
    if (o.state !== "awaiting_approval") return false;
    closeOrderCards(o, "refused");
    o.state = "declined";
    log(o, owner, "owner_decision", "confirmed", { decision: "decline", ...(card ? { card: card.id } : {}) }, { refs: { evidence: "owner_marked", ...(card ? { card: card.id } : {}) } });
    await tellOwner(o, "order_declined");
    return true;
  }

  // ---- the order goes to the supplier ---------------------------------------------------------------------------------------------

  /**
   * Ask for the order message to go, ONCE. Only an approved order is queued, and an order that is not "approved" (already sent, unknown, failed) never is from here. The step
   * does not send: it records the intent (message id, supplier, template, values, the order) and the runtime sends it after the step is saved, writing a claim first and
   * the ending after (send once). If the process dies in between, the order is marked `send_unknown` and is never sent again by itself (settleIntent below).
   */
  function queueOrder(o: PurchaseOrder): void {
    if (o.state !== "approved") return;
    const state = sendOnceOf(store);
    if (state.intents.some((i) => i.caseId === o.id && i.kind === ORDER_KIND && (i.status === "queued" || i.status === "claimed" || i.status === "failed"))) return; // one live message per order
    const supplier = supplierOf(settings, o.supplier);
    queueSend(state, { id: nextIntentId(state, o.id, ORDER_KIND), kind: ORDER_KIND, caseId: o.id, to: supplier.whatsapp, toName: supplier.name, templates: ["supplier_order"], values: { orderRef: o.id, supplierName: supplier.name, qty: o.qty, unitPriceInr: o.unitPaise / 100, totalInr: o.totalPaise / 100 }, createdMs: clock.now() });
  }

  /** Ask for a reminder to the supplier about the SAME order (never a new order). Its ending is recorded; a reminder whose outcome is unknown is not sent again by itself either. */
  function queueCheck(o: PurchaseOrder): void {
    const state = sendOnceOf(store);
    const supplier = supplierOf(settings, o.supplier);
    queueSend(state, { id: nextIntentId(state, o.id, CHECK_KIND), kind: CHECK_KIND, caseId: o.id, to: supplier.whatsapp, toName: supplier.name, templates: ["supplier_check"], values: { orderRef: o.id, supplierName: supplier.name }, createdMs: clock.now() });
  }

  // ---- send once: how the runtime sends what the step asked for (modules/messaging/send-once.ts) -----------------------------------

  const intentAction = (i: SendIntent): Action => (i.kind === ORDER_KIND ? "send_order" : "ask_supplier_again");
  const intentRefs = (i: SendIntent) => ({ intent: i.id, kind: i.kind, to: "customer" });

  /** Send the intent through the one way out (say: gates, words, read-back), unless the order has moved on since it was asked for: then nothing goes and the line says so. */
  async function deliverIntent(i: SendIntent): Promise<SaidOutcome> {
    const o = store.orders.get(i.caseId);
    const stale = !o || (i.kind === ORDER_KIND ? o.state !== "approved" : o.ack !== "none" || (o.state !== "sent" && o.state !== "send_unknown"));
    if (stale) { log(o ?? null, i.to, intentAction(i), "blocked", { intent: i.id }, { refs: intentRefs(i), notes: "the order is not in the state this message was asked for in, so nothing was sent" }); return "held_back"; }
    return say.outcome({
      booking: o, phone: i.to, to: "customer", templates: i.templates as TemplateId[], action: intentAction(i), facts: i.values as Partial<MessageFacts>,
      ...(i.kind === ORDER_KIND ? { offer: { kind: "supplier" as const } } : {}),
    });
  }

  /** The order moves with the ending, in the store and saved with it, so the order's state and the message's ending are one fact. A reminder moves nothing. */
  function settleIntent(i: SendIntent, ending: SendEnding): void {
    const o = store.orders.get(i.caseId);
    if (!o || i.kind !== ORDER_KIND || o.state !== "approved" || ending === "failed") return; // `failed` waits for its next try
    if (ending === "gave_up") { o.state = "send_failed"; return; }
    if (ending === "blocked") { o.state = "send_blocked"; return; }
    o.sentMs = clock.now();
    o.state = ending === "confirmed" ? "sent" : "send_unknown";
    o.asks = scheduleAround(o.sentMs, settings.followUpHours.map((h) => h * HOUR), o.sentMs);
  }

  /** After the ending is saved: the owner is told what happened to the order message, once. */
  async function tellIntent(i: SendIntent, ending: SendEnding): Promise<void> {
    const o = store.orders.get(i.caseId);
    if (!o || i.kind !== ORDER_KIND) return;
    if (ending === "confirmed" && o.state === "sent") await tellOwner(o, "sent_ok");
    else if (ending === "unconfirmed" && o.state === "send_unknown") await tellOwner(o, "sent_unknown");
    else if (ending === "gave_up" && o.state === "send_failed") await tellOwner(o, "send_failed");
    else if (ending === "blocked" && o.state === "send_blocked") await tellOwner(o, "send_blocked");
  }

  const sendOnce = {
    run: async (save: () => void): Promise<void> => {
      if (!store.sendOnce) return; // nothing was ever asked for: leave the saved state as it is
      await runSendOnce({
        state: sendOnceOf(store), now: () => clock.now(), save,
        recordClaim: (i) => { log(store.orders.get(i.caseId) ?? null, i.to, intentAction(i), "attempted", { intent: i.id }, { refs: intentRefs(i) }); },
        recordEnding: (i, ending, note) => { log(store.orders.get(i.caseId) ?? null, i.to, intentAction(i), ending, { intent: i.id }, { notes: note, refs: intentRefs(i) }); },
        deliver: deliverIntent, settle: settleIntent, notify: tellIntent,
      });
    },
  };

  /** The order message the owner was asked about, that may or may not have gone out and that they have not answered yet. */
  const unsureOf = (o: PurchaseOrder): SendIntent | undefined => (o.state === "send_unknown" ? openUnknowns(store.sendOnce, ORDER_KIND).find((i) => i.caseId === o.id) : undefined);

  /** The order message WhatsApp refused (nothing went out) that is waiting for its next try: the owner has been shown it, with "Try now" and "Cancel order". */
  const refusedOf = (o: PurchaseOrder): SendIntent | undefined => (o.state === "approved" ? openRefusals(store.sendOnce, ORDER_KIND).find((i) => i.caseId === o.id) : undefined);

  /** "Try now": the same intent is due at once. Only while it is refused with tries left; it counts as one of the three tries. */
  async function onTryNow(o: PurchaseOrder): Promise<void> {
    const i = refusedOf(o);
    if (!i || !retryNow(sendOnceOf(store), i.id)) return;
    log(o, owner, "owner_decision", "confirmed", { decision: "try_now", intent: i.id }, { notes: "the owner asked to try the refused order message now; nothing was sent yet", refs: { evidence: "owner_marked", intent: i.id } });
  }

  /** "Cancel order" on a refused message: the retries stop (the intent is given up) and the existing cancel path frees the budget. */
  async function onCancelRefused(o: PurchaseOrder): Promise<void> {
    const i = refusedOf(o);
    if (!i) return;
    i.status = "gave_up";
    o.state = "send_failed"; // the state the cancel path already accepts: nothing went out
    await onCancel(o);
  }

  /** "They got it": the owner's word that the supplier has the order. Nothing is sent; the order is with the supplier as far as the owner says, and the supplier is still asked on schedule. */
  async function onGotIt(o: PurchaseOrder): Promise<void> {
    const u = unsureOf(o);
    if (!u || !resolveUnknown(sendOnceOf(store), u.id, "owner_got_it")) return;
    o.state = "sent";
    log(o, owner, "owner_decision", "confirmed", { decision: "supplier_got_it", intent: u.id }, { notes: "the owner says the supplier got the order; nothing was sent", refs: { evidence: "owner_marked", intent: u.id } });
  }

  /** "Send it again": the owner's own act, a NEW message with a new claim. Never made by the machine: the first one may have gone out, and only the owner can accept that risk. */
  async function onSendAgain(o: PurchaseOrder): Promise<void> {
    const u = unsureOf(o);
    if (!u || !resolveUnknown(sendOnceOf(store), u.id, "owner_send_again")) return;
    o.state = "approved";
    log(o, owner, "owner_decision", "confirmed", { decision: "send_again", intent: u.id }, { notes: "the owner chose to send the order again, knowing the first may have reached the supplier", refs: { evidence: "owner_marked", intent: u.id } });
    queueOrder(o);
  }

  // ---- the supplier answers --------------------------------------------------------------------------------------------------------

  async function onSupplierMessage(m: InboundMessage, supplier: Supplier): Promise<void> {
    log(null, m.from, "receive_message", "confirmed", { text: m.text, reply: m.reply?.id }, { refs: { from: "supplier", supplier: supplier.id, messageId: m.id } });
    if (isStop(canon(m.text))) {
      store.optedOut.add(digits(m.from));
      log(null, m.from, "opt_out", "confirmed", {}, { refs: { supplier: supplier.id } });
      await tellOwner(null, "owner_supplier_stopped", { facts: { supplierName: supplier.name } });
      return;
    }
    // which order: a button names it; a typed answer may name it; otherwise the one order this supplier has not answered yet
    const tapped = m.reply ? /^(ack|nack):(po-\d+)$/u.exec(m.reply.id) : null;
    const typedRef = tapped ? undefined : orderRefOf(m.text);
    const answerRef = tapped?.[2] ?? typedRef;
    const t = canon(m.text);
    const yes = tapped ? tapped[1] === "ack" : YES_RE.test(t) && !NO_RE.test(t);
    const no = tapped ? tapped[1] === "nack" : NO_RE.test(t) && !YES_RE.test(t);
    const waiting = unansweredFor(store, supplier.id);
    const target = answerRef ? store.orders.get(answerRef) : waiting.length === 1 ? waiting[0] : undefined;
    if (target && target.supplier !== supplier.id) { log(target, m.from, "supplier_reply", "blocked", {}, { notes: "that order is not this supplier's" }); return; }
    if (!yes && !no) {
      if (waiting.length === 0) return;
      if (waiting.length === 1) await tellSupplier(waiting[0], supplier, "supplier_unclear");
      else await tellSupplier(waiting[0], supplier, "supplier_which", { facts: { refs: waiting.map((o) => o.id) } });
      return;
    }
    if (!target) {
      // a bare "ok" with several orders waiting (or none) is never applied to one of them by guess
      if (waiting.length > 1) await tellSupplier(waiting[0], supplier, "supplier_which", { facts: { refs: waiting.map((o) => o.id) } });
      else log(null, m.from, "supplier_reply", "blocked", {}, { notes: "no order of this supplier is waiting for an answer" });
      return;
    }
    if (target.ack !== "none" || (target.state !== "sent" && target.state !== "send_unknown")) { log(target, m.from, "supplier_reply", "blocked", {}, { notes: "this order was answered already or is not out with the supplier" }); return; }
    target.ack = yes ? "accepted" : "declined";
    target.ackMs = clock.now();
    for (const r of target.asks) r.sent = true; // no more asking: they answered
    if (!yes) target.state = "supplier_declined"; // the budget is released: it is worked out from the state
    else if (target.state === "send_unknown") target.state = "sent"; // the supplier's own reply shows the order did arrive
    log(target, m.from, "supplier_reply", "confirmed", { answer: yes ? "accepted" : "declined" }, { refs: { evidence: "supplier_reply", supplier: supplier.id, messageId: m.id } });
    await tellSupplier(target, supplier, yes ? "supplier_thanks_yes" : "supplier_thanks_no");
    await tellOwner(target, yes ? "owner_supplier_accepted" : "owner_supplier_declined");
  }

  // ---- the owner's commands about an order -----------------------------------------------------------------------------------------

  /** The order a command is about: named, or the only one that fits (by the item if one is named). Undefined when there is none or several. */
  function targetOf(r: Extract<Reading, { kind: "command" }>, fits: (o: PurchaseOrder) => boolean): PurchaseOrder | undefined {
    if (r.ref) return store.orders.get(r.ref);
    const all = [...store.orders.values()].filter((o) => fits(o) && (!r.item || o.item === r.item));
    return all.length === 1 ? all[0] : undefined;
  }

  async function onCommand(r: Extract<Reading, { kind: "command" }>, m: InboundMessage): Promise<void> {
    const o = targetOf(r, (x) => (r.command === "change" ? x.state === "awaiting_approval" : r.command === "send" ? x.state === "send_failed" : r.command === "cancel" ? x.state === "awaiting_approval" || x.state === "send_failed" || x.state === "send_blocked" : holdsBudget(x)));
    if (!o) {
      if (r.ref) await tellOwner(null, "no_such_order", { facts: { orderRef: r.ref } });
      else await tellStatus(); // no number and no single fit: the open list shows the numbers
      return;
    }
    switch (r.command) {
      case "receive": case "wrong": await onReceipt(o, r.command === "wrong" ? "wrong" : r.qty, m); return;
      case "paid": return onPaid(o);
      case "cancel": return onCancel(o);
      case "send": return onResend(o);
      case "change": return onChange(o, r.qty);
    }
  }

  async function onReceipt(o: PurchaseOrder, said: number | "wrong" | undefined, m: InboundMessage): Promise<void> {
    if (!holdsBudget(o) || o.receipt === "full" || o.receipt === "wrong_item") { await tellOwner(o, "order_not_open", { facts: { stateWord: stateWord(o, ownerLanguage) } }); return; }
    const remaining = o.qty - o.receivedQty;
    if (said === "wrong") {
      o.receipt = "wrong_item"; o.receiptMs = clock.now();
      log(o, owner, "mark_receipt", "confirmed", { receipt: "wrong_item" }, { refs: { evidence: "owner_marked", receipt: "wrong_item", messageId: m.id } });
      await tellOwner(o, "received_wrong");
      return;
    }
    const qty = said ?? remaining;
    if (qty < 1 || qty > remaining) { await tellOwner(o, "receive_too_many", { facts: { saidQty: qty, moreQty: remaining, receivedQty: o.receivedQty } }); return; }
    o.receivedQty += qty;
    o.receipt = o.receivedQty >= o.qty ? "full" : "part";
    o.receiptMs = clock.now();
    log(o, owner, "mark_receipt", "confirmed", { qty, receivedQty: o.receivedQty }, { refs: { evidence: "owner_marked", receipt: o.receipt, messageId: m.id } });
    await tellOwner(o, o.receipt === "full" ? "received_full" : "received_part", { facts: { receivedQty: o.receivedQty, moreQty: o.qty - o.receivedQty } });
  }

  async function onPaid(o: PurchaseOrder): Promise<void> {
    if (!holdsBudget(o)) { await tellOwner(o, "order_not_open", { facts: { stateWord: stateWord(o, ownerLanguage) } }); return; }
    o.paidOutsideMs = clock.now();
    log(o, owner, "mark_paid_outside", "confirmed", {}, { notes: "the owner says they paid the supplier themselves; this agent pays nothing and cannot check it", refs: { evidence: "owner_marked" } });
    await tellOwner(o, "paid_outside_noted");
  }

  async function onCancel(o: PurchaseOrder): Promise<void> {
    if (o.state === "awaiting_approval") {
      for (const c of cards().cards) if (c.state === "open" && c.action.case === o.id) closeCard(cards(), c, "void", clock.now());
    } else if (o.state !== "send_failed" && o.state !== "send_blocked") {
      await tellOwner(o, holdsBudget(o) ? "cannot_cancel" : "order_not_open", { facts: { stateWord: stateWord(o, ownerLanguage) } });
      return;
    }
    o.state = "cancelled";
    log(o, owner, "owner_decision", "confirmed", { decision: "cancel" }, { notes: "cancelled before it was with the supplier; the budget is released", refs: { evidence: "owner_marked" } });
    await tellOwner(o, "cancelled");
  }

  async function onResend(o: PurchaseOrder): Promise<void> {
    // only an order the provider refused (so nothing went out) is sent again; one whose reply was lost is never sent again as an order
    if (o.state !== "send_failed") { await tellOwner(o, "order_not_open", { facts: { stateWord: stateWord(o, ownerLanguage) } }); return; }
    o.state = "approved";
    log(o, owner, "owner_decision", "confirmed", { decision: "send_again" }, { refs: { evidence: "owner_marked" } });
    queueOrder(o);
  }

  async function onChange(o: PurchaseOrder, qty: number | undefined): Promise<void> {
    if (qty === undefined) { await didntUnderstand(); return; }
    if (o.state !== "awaiting_approval") { await tellOwner(o, "order_not_open", { facts: { stateWord: stateWord(o, ownerLanguage) } }); return; }
    const line = currentLine(settings, o)!;
    const q = checkQuantity({ qty, maxQuantity: settings.limits.maxQuantity });
    if (q.verdict !== "allow") { await tellOwner(draftOf(line, qty), "blocked_qty", { facts: { saidQty: qty, maxQty: settings.limits.maxQuantity } }); return; }
    o.qty = qty;
    o.unitPaise = unitPaiseOf(line);
    o.totalPaise = totalOfPaise(o.unitPaise, qty);
    log(o, owner, "change_order", "held_for_owner", { qty, totalPaise: o.totalPaise }, { notes: "the order changed, so its earlier card no longer counts" });
    await recheckAndShow(o, ["card_changed"]);
  }

  /** The approved order that was asked to change: a message after approval cannot change it. */
  async function afterApproval(r: Reading, o: PurchaseOrder | undefined): Promise<boolean> {
    if (r.kind === "command" && r.command === "change" && o && holdsBudget(o)) { await tellOwner(o, "cannot_change"); return true; }
    return false;
  }

  async function tellStatus(): Promise<void> {
    const month = monthOf(clock.now(), tz);
    const open = [...store.orders.values()].filter((o) => o.state === "awaiting_approval" || isOpen(o)).slice(-8);
    const language = ownerLanguage;
    const lines: StatusRow[] = open.map((o) => ({ ref: o.id, itemName: nameIn(itemOf(settings, o.item).names, language), unitName: nameIn(unitOf(settings, o.unit).names, language), supplierName: supplierOf(settings, o.supplier).name, qty: o.qty, receivedQty: o.receivedQty, totalInr: o.totalPaise / 100, stateWord: stateWord(o, language) }));
    const reserved = reservedPaise(store, month) / 100;
    await tellOwner(null, open.length === 0 ? "status_empty" : "status", { facts: { lines, budgetInr: settings.limits.monthlyBudgetInr, reservedInr: reserved, monthLabel: monthLabel(clock.now()) } });
  }

  // ---- reading a request and asking what it cannot tell -------------------------------------------------------------------------

  /** Settle a request on one line and a quantity, or ask for the quantity. */
  async function settle(args: { requestId: string; lowStock: boolean; line: Line; qty?: number; phone: string }): Promise<void> {
    const qty = args.qty ?? (args.lowStock ? args.line.reorderQty : undefined);
    if (qty === undefined) {
      store.asking = { kind: "qty", requestId: args.requestId, lowStock: args.lowStock, item: args.line.item, options: [lineKey(args.line)], askedMs: clock.now() };
      await tellOwner(draftOf(args.line, 1), "ask_qty");
      return;
    }
    await propose({ requestId: args.requestId, lowStock: args.lowStock, line: args.line, qty, phone: args.phone });
  }

  async function askWhich(args: { requestId: string; lowStock: boolean; item: string; qty?: number; lines: Line[] }): Promise<void> {
    const options = args.lines.slice(0, 10).map(lineKey);
    store.asking = { kind: "line", requestId: args.requestId, lowStock: args.lowStock, item: args.item, ...(args.qty !== undefined ? { qty: args.qty } : {}), options, askedMs: clock.now() };
    await tellOwner(null, "ask_line", { offer: { kind: "choices", options }, facts: { itemName: nameIn(itemOf(settings, args.item).names, ownerLanguage) } });
  }

  async function onRequest(r: Extract<Reading, { kind: "order" }>, m: InboundMessage): Promise<void> {
    const language = ownerLanguage;
    if (!r.item) { await tellOwner(null, "item_unknown", { facts: { options: itemNames(language) } }); return; }
    // a supplier the owner named that is not on the list (or is paused) is refused before anything else
    if (r.unknownSupplier || (r.supplier && !supplierOf(settings, r.supplier).approved)) {
      const named = r.supplier ? supplierOf(settings, r.supplier) : undefined;
      const decision = checkApprovedSupplier({ supplier: named, named: r.unknownSupplier });
      log(null, owner, "propose_order", "blocked", { requestId: m.id, supplier: r.supplier ?? "unknown" }, { decisions: [decision], notes: decision.reason });
      await tellOwner(null, "blocked_supplier", { facts: { supplierName: named?.name ?? r.unknownSupplier! } });
      return;
    }
    let lines = settings.catalogue.filter((l) => l.item === r.item);
    if (lines.length === 0) { await tellOwner(null, "item_unknown", { facts: { options: itemNames(language) } }); return; }
    if (r.supplier) {
      const theirs = lines.filter((l) => l.supplier === r.supplier);
      lines = theirs.length > 0 ? theirs : lines.filter((l) => supplierOf(settings, l.supplier).approved);
    } else {
      const ok = lines.filter((l) => supplierOf(settings, l.supplier).approved);
      if (ok.length === 0) {
        const decision = checkApprovedSupplier({ supplier: supplierOf(settings, lines[0].supplier) });
        log(null, owner, "propose_order", "blocked", { requestId: m.id }, { decisions: [decision], notes: decision.reason });
        await tellOwner(null, "blocked_supplier", { facts: { supplierName: supplierOf(settings, lines[0].supplier).name } });
        return;
      }
      lines = ok;
    }
    if (lines.length === 0) { await tellOwner(null, "item_unknown", { facts: { options: itemNames(language) } }); return; }
    if (r.unit) {
      const byUnit = lines.filter((l) => l.unit === r.unit);
      if (byUnit.length > 0) lines = byUnit; // else the unit asked for is not sold that way: the owner is asked, nothing is converted
    }
    if (lines.length === 1 && (!r.unit || lines[0].unit === r.unit)) { await settle({ requestId: m.id, lowStock: r.lowStock, line: lines[0], ...(r.qty !== undefined ? { qty: r.qty } : {}), phone: owner }); return; }
    await askWhich({ requestId: m.id, lowStock: r.lowStock, item: r.item, ...(r.qty !== undefined ? { qty: r.qty } : {}), lines });
  }

  /** The owner's answer to a question the agent asked (a list row, a supplier or unit named, or the number). Returns false when the message is not an answer. */
  async function onAnswer(m: InboundMessage, a: Asking): Promise<boolean> {
    if (clock.now() - a.askedMs > ASKING_FOR_MS) { store.asking = undefined; return false; }
    if (a.kind === "qty") {
      const q = quantityIn(m.text);
      if (q === undefined) return false;
      store.asking = undefined;
      await propose({ requestId: a.requestId, lowStock: a.lowStock, line: lineByKey(settings, a.options[0])!, qty: q, phone: owner });
      return true;
    }
    let key: string | undefined;
    const picked = m.reply ? /^pick:(\d+)$/u.exec(m.reply.id) : null;
    if (picked) key = a.options[Number(picked[1])];
    else {
      const words = padded(m.text);
      const supplier = supplierIn(settings, words);
      const unit = unitIn(settings, words);
      const fit = a.options.map((k) => lineByKey(settings, k)!).filter((l) => (!supplier || l.supplier === supplier) && (!unit || l.unit === unit));
      if ((supplier || unit) && fit.length === 1) key = lineKey(fit[0]);
    }
    if (!key) return false;
    store.asking = undefined;
    const qty = a.qty ?? quantityIn(picked ? "" : m.text);
    await settle({ requestId: a.requestId, lowStock: a.lowStock, line: lineByKey(settings, key)!, ...(qty !== undefined ? { qty } : {}), phone: owner });
    return true;
  }

  // ---- inbound ----------------------------------------------------------------------------------------------------------------------

  async function onOwnerMessage(m: InboundMessage): Promise<void> {
    log(null, owner, "receive_message", "confirmed", { text: m.text, reply: m.reply?.id }, { refs: { from: "owner", messageId: m.id } });
    const card = parseCardReply(m);
    if (card) {
      // One judge for each card: the agent's own order card is judged here; any other card (a limit, a cancel) is the assistant's, whose judge reads its own proposal.
      const found = cardByCode(cards(), card.code);
      if (assistant && found && !isOrderCard(found)) { await assistant.onOwnerMessage(m); return; }
      await onCardReply(card);
      return;
    }
    const reading = readOwnerText(settings, m.text);
    // an answer to a question of ours comes first, unless the owner wrote a new request or a command
    if (store.asking && !(reading.kind === "command" || reading.kind === "status" || (reading.kind === "order" && reading.item))) {
      if (await onAnswer(m, store.asking)) return;
    } else if (store.asking && m.reply?.id.startsWith("pick:")) {
      if (await onAnswer(m, store.asking)) return;
    }
    switch (reading.kind) {
      case "status": await tellStatus(); return;
      case "command": {
        const named = reading.ref ? store.orders.get(reading.ref) : undefined;
        if (await afterApproval(reading, named)) return;
        await onCommand(reading, m);
        return;
      }
      case "order": {
        if (reading.tied) { await tellOwner(null, "item_unknown", { facts: { options: itemNames(ownerLanguage) } }); return; }
        await onRequest(reading, m);
        return;
      }
      case "other": if (assistant && (await assistant.onOwnerMessage(m))) return; await didntUnderstand(); return;
    }
  }

  async function handleMessage(m: InboundMessage): Promise<void> {
    // a message the provider delivers twice is handled once: it can make no second order, no second approval
    if (store.handled.has(m.id)) { log(null, m.from, "receive_message", "blocked", {}, { notes: "this message was delivered twice and handled once", refs: { messageId: m.id } }); return; }
    store.handled.add(m.id);
    // a Set keeps insertion order, so the oldest ids go first
    for (const old of store.handled) { if (store.handled.size <= HANDLED_KEEP) break; store.handled.delete(old); }
    if (digits(m.from) === digits(owner)) { await onOwnerMessage(m); return; }
    const supplier = supplierByNumber(m.from);
    if (supplier) { await onSupplierMessage(m, supplier); return; }
    log(null, m.from, "receive_message", "blocked", {}, { notes: "this number is neither the owner's nor a listed supplier's, so nothing is done", refs: { messageId: m.id } });
  }

  // ---- the clock --------------------------------------------------------------------------------------------------------------------

  async function tick(): Promise<void> {
    if (store.asking && clock.now() - store.asking.askedMs > ASKING_FOR_MS) store.asking = undefined;
    // An order that waits must always have a card to answer. Whoever expires cards first (this tick or the assistant's), an order left with no open card is closed here and the
    // owner is told, so no order is stranded awaiting an answer nobody can give.
    for (const o of store.orders.values()) {
      if (o.state === "awaiting_approval" && !openCards(cards(), clock.now()).some((c) => c.action.skill === SKILL && c.action.kind === "order" && c.action.case === o.id)) {
        o.state = "void";
        log(o, owner, "owner_decision", "blocked", { decision: "expired" }, { notes: "the card ran out; nothing was sent" });
        await tellOwner(o, "card_expired");
      }
    }
    for (const card of expireCards(cards(), clock.now())) {
      const o = store.orders.get(card.action.case);
      if (o && o.state === "awaiting_approval") { o.state = "void"; log(o, owner, "owner_decision", "blocked", { decision: "expired", card: card.id }, { notes: "the card ran out; nothing was sent" }); await tellOwner(o, "card_expired"); }
    }
    // a supplier who has not answered is asked again about the SAME order (never a new one); after the last ask the owner is told once
    for (const o of [...store.orders.values()]) {
      if (o.ack !== "none" || (o.state !== "sent" && o.state !== "send_unknown") || o.asks.length === 0) continue;
      const due = takeDue(o.asks, clock.now());
      if (!due.due) continue;
      queueCheck(o);
      if (o.asks.every((r) => r.sent) && o.silentToldMs === undefined) {
        o.silentToldMs = clock.now();
        await tellOwner(o, "owner_supplier_silent", { facts: { hours: Math.round((clock.now() - (o.sentMs ?? clock.now())) / HOUR) } });
      }
    }
  }

  // ---- the owner's page (an owner_action: the runtime has checked the owner's link or session before the event was saved) ------------------------------

  /** Is this the agent's own approval card (judged here), as against one of the assistant's? */
  const isOrderCard = (c: CardRecord): boolean => c.action.skill === SKILL && c.proposal.kind === "order";

  async function onOwnerAction(e: OwnerAction): Promise<void> {
    const page = { channel: "owner_page", action: e.action };
    if (e.action === "card_yes" || e.action === "card_no") {
      const found = cardById(cards(), e.case);
      if (found && !isOrderCard(found)) {
        if (!assistant) { log(null, owner, "owner_page_action", "blocked", { action: e.action, case: e.case }, { refs: page, notes: "a card's answer came for a shop without the assistant: nothing was done" }); return; }
        return assistant.onPageCard({ card: e.case, digest: e.digest, answer: e.action === "card_yes" ? "yes" : "no" });
      }
      if (!found || found.digest !== e.digest) { log(null, owner, "owner_page_action", "blocked", { action: e.action, case: e.case }, { refs: page, notes: "the owner's page showed a card that is not the one waiting now: nothing was done" }); return; }
      log(null, owner, "owner_page_action", "confirmed", { action: e.action, case: e.case }, { refs: page, notes: "pressed by the owner on their page; the card's own binding decides, as for a tap on WhatsApp" });
      return applyVerdict(judgeCard(found, e.action === "card_yes" ? "yes" : "no", clock.now(), currentOf));
    }
    // the other buttons answer one thing the page listed, bound by its digest: a press for something that has changed since does nothing
    const item = ownerItems(settings, store, clock.now(), cards()).find((x) => x.case === e.case && x.digest === e.digest && x.actions.includes(e.action));
    const o = store.orders.get(e.case) ?? null;
    if (!item || !o) { log(o, owner, "owner_page_action", "blocked", { action: e.action, case: e.case }, { refs: page, notes: "what the owner's page showed is not what waits now (already answered or changed): nothing was done" }); return; }
    log(o, owner, "owner_page_action", "confirmed", { action: e.action, case: e.case }, { refs: page, notes: "pressed by the owner on their page; done exactly as the same words on WhatsApp" });
    if (e.action === "received") return onReceipt(o, undefined, { id: `owner-page:${e.id}`, from: owner, text: "", timestamp: clock.now() });
    if (e.action === "retry") return askSupplierAgain(o);
    if (e.action === "try_now") return onTryNow(o);
    if (e.action === "cancel_order") return onCancelRefused(o);
    if (e.action === "got_it") return onGotIt(o);
    if (e.action === "send_again") return onSendAgain(o);
  }

  /** Ask the supplier about the SAME order now (the page's "ask again"): never a new order, and only an order the supplier has not answered. */
  async function askSupplierAgain(o: PurchaseOrder): Promise<void> {
    if (o.ack !== "none" || (o.state !== "sent" && o.state !== "send_unknown")) return;
    o.askedMs = clock.now(); // the page's digest reads it, so a second press of the same button does nothing
    queueCheck(o);
  }

  // ---- the shop's assistant (modules/assistant): on only with an "assistant" settings block. Its acts are this agent's own paths ----------------------------------
  const assistant = assistantForAgent({
    limits: CHAT_LIMITS, // "Limits, tightened by a tap": the owner may tighten the per-order cap and the monthly budget by a card
    settings, store, clock, messaging, record, policy: deps.ai ?? {}, ...(deps.ownerParser ? { ownerParser: deps.ownerParser } : {}), ...(deps.talker ? { talker: deps.talker } : {}),
    skill: stockSkill({
      settings, store, nowMs: () => clock.now(), optedOut: (phone) => store.optedOut.has(digits(phone)),
      acts: { approve: (o) => approve(o), decline: (o) => decline(o), cancel: async (o) => { await onCancel(o); return o.state === "cancelled"; } },
    }),
    log: (caseId, phone, action, outcome, inputs, more) => log(caseId ? store.orders.get(caseId) ?? null : null, phone, action as Action, outcome, inputs, more),
    // the AI allowance or a model fault: written in the record only (no owner template for it yet; Deferred)
    ownerNotice: async (notice) => { log(null, owner, "assistant_notice" as Action, "failed", { notice }, { notes: `the shop's assistant could not read the owner's words (${notice})` }); },
    languageOf: (phone) => languageOf(phone),
    optedOut: (phone) => store.optedOut.has(digits(phone)),
  });

  /** One event, the step's work. What it asks to be sent (the order, a reminder) is only recorded here: see `queueOrder`. */
  async function dispatch(event: AgentEvent): Promise<void> {
    if (event.kind === "tick") { await tick(); await assistant?.onTick(); return; }
    if (event.kind === "message") return handleMessage(event.message);
    if (event.kind === "owner_action") return onOwnerAction(event);
    if (event.kind === "owner_message") {
      if (!assistant) { log(null, owner, "owner_page_message", "blocked", {}, { refs: { channel: "owner_page" }, notes: "the owner's talk box is the shop's assistant's, and this shop has none: nothing was read" }); return; }
      return assistant.onPageMessage({ id: `owner-page:${event.id}`, from: owner, text: event.text, timestamp: clock.now() });
    }
    // every other kind (a sign-in, a limit settling, a recovery, a payment event) is the runtime's own: Stock orders has no payments and nothing to recover by hand
  }

  return {
    async handle(event) {
      await dispatch(event);
      // Run alone (the harness, the browser demo) there is no runtime to send after a save, so the step sends what it asked for as its last act, through the same
      // claim-send-ending code (nothing to save here). The runtime sets `sendLater` and calls `sendOnce.run` itself, after its save.
      if (!deps.sendLater) await sendOnce.run(() => undefined);
    },
    sendOnce,
  };
}

export { createStore };
