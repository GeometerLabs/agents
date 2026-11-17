// Orders as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts): the open orders, what waits for the owner, and a message to a customer. Reads and
// `prepare` are pure over the store. What waits is read from the owner page's own list (src/channel.ts ownerItems, item 11h), so "what needs me", the morning line's
// count, the mood and the owner's page always show the same things: an advance to mark received and a refund the owner owes (a UPI shop; answered with the same
// button and one-use code the owner's WhatsApp message carries), a big order to accept, a late cancellation's refund ("approve o-5" / "deny o-5").
// The acts (17 Nov 2026) are the agent's own paths, handed in as `acts` as Bookings' are (templates/commerce/bookings/src/assistant.ts): cancelling releases the stock and
// refunds the advance through the same refund path, limits and Guard as the owner's "approve o-5"; a refund of an advance that is still the shop's does the same. Nothing
// here decides a refund's size beyond what was paid, or moves money another way. With no `acts` (the morning line) the skill only reads.
import { checkWords, ownerReply } from "../../../../modules/assistant/wire.ts";
import { markButtonId } from "../../../../modules/payments/owner-marked/owner.ts";
import { ownerItems } from "./channel.ts";
import type { OwnerItem } from "./channel.ts";
import type { Executed, OpenRow, OwnerSkill, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import type { RefundResult } from "../../../../modules/payments/refunds.ts";
import { LIVE_STATES } from "./order.ts";
import type { Order, Store } from "./order.ts";
import { itemName } from "./settings.ts";
import type { Settings } from "./settings.ts";

/** The agent's own paths the skill's cancel and refund use (17 Nov 2026). Each is the function the agent already runs for the same thing; the skill adds no other way to act. */
export interface OrdersActs {
  /**
   * Cancel a confirmed order the owner's way: its stock is free, it is marked cancelled by the owner, and exactly `amountInr` (the card's amount: the advance less what already
   * went back) is refunded the way the agent refunds (Guard holds it above the limit; a UPI shop's owner owes it). Never asks the owner again: the owner is the one asking.
   */
  cancelPaid(o: Order, amountInr: number, why: string): Promise<RefundResult | "owed">;
  /** Cancel an order still waiting for its advance (or for the owner's yes to a big order): the hold and the link end, nothing was paid. */
  cancelWaiting(o: Order, why: string): Promise<void>;
  /** The customer's line after the owner cancelled an order nothing was paid on. */
  tellCancelled(o: Order): Promise<boolean>;
  /** Refund part or all of an advance that is still the shop's, the way "approve o-5" does. */
  refund(o: Order, paymentId: string, amountInr: number, why: string): Promise<RefundResult | "owed">;
  /** A UPI shop: the owner pays refunds back from their own app, so a refund is never held by Guard for it. */
  ownerRefunds: boolean;
}

export interface OrdersSkillDeps {
  settings: Settings;
  store: Store;
  nowMs: () => number;
  optedOut: (phone: string) => boolean;
  /** The agent's own handling of the owner's reply (`onOwnerMessage`). Left out: a read-only skill (the morning line). */
  answer?: (msg: InboundMessage) => Promise<void>;
  /** The record as it is in this step: what was already refunded on a payment. Left out with `acts`: a read-only skill. */
  entries?: () => readonly RecordEntry[];
  /** The agent's own cancel and refund paths. Left out: a read-only skill (the morning line, the owner's app). */
  acts?: OrdersActs;
}

/** How the owner knows a customer: the name typed on the shop's page (item 11h), else the number (the typed one for a page order, never its "web:..." conversation). */
const whoOf = (o: Order): string => o.contact?.name ?? o.contact?.phone ?? o.customer;

const ROUTING_WORDS = { en: ["order", "orders", "buy"], hi: ["ऑर्डर", "आर्डर", "order"], ml: ["ഓർഡർ"], kn: ["ಆರ್ಡರ್"] } as const;
/** The orders the owner thinks of as open: waiting for them, for the advance, or confirmed and not yet done. */
const OPEN: Order["state"][] = ["awaiting_owner", "awaiting_advance", "confirmed"];

export function ordersSkill(deps: OrdersSkillDeps): OwnerSkill {
  const { store, settings } = deps;
  /** The order's lines in the owner's language, "2 × cake, 1 × bread", from the shop's own menu. */
  const what = (o: Order) => o.lines.map((l) => { const item = settings.menu.find((m) => m.id === l.itemId); return `${l.qty} × ${item ? itemName(item, settings.owner.language) : l.itemId}`; }).join(", ");

  /**
   * What waits for the owner, as a card can show it (and the fields its digest is over), from the owner page's list. The card's fields carry the page item's digest,
   * which covers exactly what is shown (the amount, the marks made, the codes used): a change there voids a card made before it, as on the page. `reply` is what a yes
   * sends: the UPI mark's button with its code, or the owner's own "approve o-3".
   */
  type Waiting = WaitingItem & { fields: CardAction["fields"]; reply: { id: string } | null };
  const ANSWERS: Record<OwnerItem["kind"], { yes: string; no?: string }> = { big_order: { yes: "approve", no: "deny" }, late_refund: { yes: "approve", no: "deny" }, deposit: { yes: "received" }, late_deposit: { yes: "received" }, refund_owed: { yes: "refunded" } };
  function waitingNow(): Waiting[] {
    return ownerItems(settings, store, deps.nowMs()).items.map((i): Waiting => {
      const o = store.orders.get(i.case);
      const a = ANSWERS[i.kind];
      return {
        case: i.case, kind: i.kind, amountPaise: i.amountPaise, who: o ? whoOf(o) : i.customer.name ?? i.customer.phone, what: o ? what(o) : i.what, money: true,
        yes: a.yes, ...(a.no ? { no: a.no } : {}), fields: { pageDigest: i.digest, amountPaise: i.amountPaise },
        reply: i.code && (i.kind === "deposit" || i.kind === "late_deposit" || i.kind === "refund_owed") ? { id: markButtonId(i.kind === "refund_owed" ? "refunded" : "received", i.code) } : null,
      };
    });
  }
  const waitingOn = (o: Order): Waiting[] => waitingNow().filter((i) => i.case === o.id);

  // ---- cancel and refund from the chat (17 Nov 2026) ----
  /** Money already going back on a payment: refunds the record confirmed, and UPI refunds owed or marked sent. One held by Guard or with an unclear outcome makes the order busy (below). */
  const alreadyBack = (paymentId: string): number => {
    let paise = 0;
    for (const e of deps.entries?.() ?? []) if (e.action === "refund" && e.refs.paymentId === paymentId && e.outcome === "confirmed") paise += Number(e.refs.amountPaise ?? 0) || 0;
    for (const r of store.upi?.refunds ?? []) if (r.paymentId === paymentId && r.state !== "kept") paise += r.amountPaise;
    return paise;
  };
  const busy = (o: Order): boolean => o.pending.some((p) => p.kind === "guard_hold" || p.kind === "refund_retry") || (o.refundIssues ?? []).length > 0;
  const aboveLimit = (paise: number): boolean => !deps.acts?.ownerRefunds && paise > settings.refund.limitInr * 100;
  const action = (kind: string, o: Order, fields: CardAction["fields"]): CardAction => ({ kind, skill: "orders", case: o.id, fields: { who: whoOf(o), ...fields } });

  function prepare(p: Proposal): Prepared {
    const o = store.orders.get(p.case);
    if (!o) return { ok: false, why: "no_case" };
    if (p.kind === "answer") {
      const item = waitingOn(o).find((i) => i.kind === p.itemKind);
      if (!item) return { ok: false, why: "nothing_waiting" };
      // a mark has no "no": the owner who has not had the money simply does not press
      if (p.answer === "no" && !item.no) return { ok: false, why: "nothing_waiting" };
      return { ok: true, action: { kind: "answer", skill: "orders", case: o.id, fields: { who: whoOf(o), itemKind: item.kind, answer: p.answer, ...item.fields } }, shown: { who: item.who, what: item.what, amountPaise: item.amountPaise } };
    }
    if (p.kind === "message") {
      const refused = checkWords(p.words, { optedOut: deps.optedOut(o.customer), amountsPaise: [o.totalInr, o.advanceInr].map((v) => (v === undefined ? undefined : v * 100)) });
      if (refused) return { ok: false, why: refused };
      return { ok: true, action: { kind: "message", skill: "orders", case: o.id, fields: { who: whoOf(o), phone: o.customer, words: p.words } }, shown: { who: whoOf(o), what: what(o), amountPaise: 0, words: p.words } };
    }
    if (busy(o)) return { ok: false, why: "busy" };
    if (p.kind === "cancel") {
      // an order nothing was paid on (waiting for its advance, or for the owner's yes to a big one): the hold and the link end
      if (o.state === "awaiting_advance" || o.state === "awaiting_owner") return { ok: true, action: action("cancel", o, { state: o.state, startMs: o.slotStartMs ?? 0, amountPaise: 0 }), shown: { who: whoOf(o), what: what(o), amountPaise: 0 } };
      if (o.state !== "confirmed") return { ok: false, why: o.state === "enquiry" ? "not_booked" : "not_live" };
      const back = o.advancePaymentId && o.advanceInr !== undefined ? Math.max(0, o.advanceInr * 100 - alreadyBack(o.advancePaymentId)) : 0;
      if (back === 0) return { ok: false, why: "already_back" };
      return { ok: true, action: action("cancel", o, { state: o.state, startMs: o.slotStartMs ?? 0, paymentId: o.advancePaymentId ?? "", amountPaise: back }), shown: { who: whoOf(o), what: what(o), amountPaise: back }, ...(aboveLimit(back) ? { aboveLimit: true } : {}) };
    }
    // a refund: of what was paid as the advance, less what is already going back; only once the order no longer stands (an order that stands is cancelled, with its own card)
    if (o.state === "confirmed") return { ok: false, why: "cancel_first" };
    if (!o.advancePaymentId || o.advanceInr === undefined) return { ok: false, why: "nothing_paid" };
    const available = Math.max(0, o.advanceInr * 100 - alreadyBack(o.advancePaymentId));
    if (available === 0) return { ok: false, why: "nothing_paid" };
    const amount = p.amountPaise ?? available;
    if (amount > available || amount % 100 !== 0) return { ok: false, why: "too_much" }; // refunds go in whole rupees, as the shop's settings are
    return { ok: true, action: action("refund", o, { paymentId: o.advancePaymentId, amountPaise: amount, availablePaise: available }), shown: { who: whoOf(o), what: what(o), amountPaise: amount }, ...(aboveLimit(amount) ? { aboveLimit: true } : {}) };
  }

  async function execute(a: CardAction): Promise<Executed> {
    const o = store.orders.get(a.case);
    const acts = deps.acts;
    if (acts && o && (a.kind === "cancel" || a.kind === "refund")) {
      const ofRefund = (r: RefundResult | "owed"): Executed => (r === "owed" ? { ok: true, note: "owed_by_owner" } : r === "done" ? { ok: true, note: "done" } : r === "held" ? { ok: true, note: "held_by_guard" } : { ok: false, note: "failed" });
      if (a.kind === "refund") return ofRefund(await acts.refund(o, String(a.fields.paymentId), Number(a.fields.amountPaise) / 100, "refunded by the owner through the shop's assistant"));
      if (o.state === "awaiting_advance" || o.state === "awaiting_owner") { await acts.cancelWaiting(o, "cancelled by the owner through the shop's assistant"); await acts.tellCancelled(o); return { ok: true, note: "done" }; }
      return ofRefund(await acts.cancelPaid(o, Number(a.fields.amountPaise) / 100, "cancelled by the owner through the shop's assistant"));
    }
    if (!deps.answer || !o || a.kind !== "answer") return { ok: false, note: "failed" };
    const item = waitingOn(o).find((i) => i.kind === a.fields.itemKind);
    if (!item) return { ok: false, note: "failed" };
    // the very reply the owner could give on WhatsApp: the mark's button (with its code), or "approve o-3" / "deny o-3"
    await deps.answer(ownerReply(deps.settings.owner.whatsapp, deps.nowMs(), o.id, item.reply && a.fields.answer !== "no" ? { buttonId: item.reply.id } : { text: `${a.fields.answer === "no" ? item.no : item.yes} ${o.id}` }));
    return { ok: true, note: "done" };
  }

  return {
    name: "orders",
    routing: {
      refs: /^o-\d{1,6}$/u,
      buttonPrefixes: ["item:", "slot:", "pickup", "delivery"],
      words: ROUTING_WORDS,
      liveCaseOf: (phone) => [...store.orders.values()].reverse().find((o) => o.customer === phone && LIVE_STATES.includes(o.state))?.id,
    },
    open() {
      const rows: OpenRow[] = [];
      for (const o of store.orders.values()) if (OPEN.includes(o.state)) rows.push({ case: o.id, who: whoOf(o), what: what(o), amountPaise: (o.totalInr ?? 0) * 100, state: o.state });
      return rows;
    },
    waiting: () => waitingNow().map(({ fields: _f, reply: _r, ...item }) => item),
    problems: () => [...store.orders.values()].reduce((n, o) => n + (o.refundIssues ?? []).length, 0),
    prepare,
    execute,
  };
}
