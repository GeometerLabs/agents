// Orders as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts): the open orders, what waits for the owner, and a message to a customer. Reads and
// `prepare` are pure over the store. What waits is read from the owner page's own list (src/channel.ts ownerItems, item 11h), so "what needs me", the morning line's
// count, the mood and the owner's page always show the same things: an advance to mark received and a refund the owner owes (a UPI shop; answered with the same
// button and one-use code the owner's WhatsApp message carries), a big order to accept, a late cancellation's refund ("approve o-5" / "deny o-5").
// Cancelling or refunding an order from the chat is not offered in the first release (modules/Deferred.md).
import { checkWords, ownerReply } from "../../../../modules/assistant/wire.ts";
import { markButtonId } from "../../../../modules/payments/owner-marked/owner.ts";
import { ownerItems } from "./channel.ts";
import type { OwnerItem } from "./channel.ts";
import type { Executed, OpenRow, OwnerSkill, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { LIVE_STATES } from "./order.ts";
import type { Order, Store } from "./order.ts";
import { itemName } from "./settings.ts";
import type { Settings } from "./settings.ts";

export interface OrdersSkillDeps {
  settings: Settings;
  store: Store;
  nowMs: () => number;
  optedOut: (phone: string) => boolean;
  /** The agent's own handling of the owner's reply (`onOwnerMessage`). Left out: a read-only skill (the morning line). */
  answer?: (msg: InboundMessage) => Promise<void>;
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
  const ANSWERS: Record<OwnerItem["kind"], { yes: string; no?: string }> = { big_order: { yes: "approve", no: "deny" }, late_refund: { yes: "approve", no: "deny" }, deposit: { yes: "received" }, refund_owed: { yes: "refunded" } };
  function waitingNow(): Waiting[] {
    return ownerItems(settings, store, deps.nowMs()).items.map((i): Waiting => {
      const o = store.orders.get(i.case);
      const a = ANSWERS[i.kind];
      return {
        case: i.case, kind: i.kind, amountPaise: i.amountPaise, who: o ? whoOf(o) : i.customer.name ?? i.customer.phone, what: o ? what(o) : i.what, money: true,
        yes: a.yes, ...(a.no ? { no: a.no } : {}), fields: { pageDigest: i.digest, amountPaise: i.amountPaise },
        reply: i.code && (i.kind === "deposit" || i.kind === "refund_owed") ? { id: markButtonId(i.kind === "deposit" ? "received" : "refunded", i.code) } : null,
      };
    });
  }
  const waitingOn = (o: Order): Waiting[] => waitingNow().filter((i) => i.case === o.id);

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
    return { ok: false, why: "not_here" };
  }

  async function execute(a: CardAction): Promise<Executed> {
    const o = store.orders.get(a.case);
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
