// Orders as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts): the open orders, what waits for the owner (a big order to accept, or a late
// cancellation's refund, answered with the owner's own "approve o-5" / "deny o-5"), and a message to a customer. Reads and `prepare` are pure over the store.
// Cancelling or refunding an order from the chat is not offered in the first release (modules/Deferred.md).
import { checkWords, ownerReply } from "../../../../modules/assistant/wire.ts";
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

const ROUTING_WORDS = { en: ["order", "orders", "buy"], hi: ["ऑर्डर", "आर्डर", "order"], ml: ["ഓർഡർ"], kn: ["ಆರ್ಡರ್"] } as const;
/** The orders the owner thinks of as open: waiting for them, for the advance, or confirmed and not yet done. */
const OPEN: Order["state"][] = ["awaiting_owner", "awaiting_advance", "confirmed"];

export function ordersSkill(deps: OrdersSkillDeps): OwnerSkill {
  const { store, settings } = deps;
  /** The order's lines in the owner's language, "2 × cake, 1 × bread", from the shop's own menu. */
  const what = (o: Order) => o.lines.map((l) => { const item = settings.menu.find((m) => m.id === l.itemId); return `${l.qty} × ${item ? itemName(item, settings.owner.language) : l.itemId}`; }).join(", ");

  function waitingOn(o: Order): (WaitingItem & { fields: CardAction["fields"] })[] {
    const p = o.pending[0];
    if (p?.kind === "big_order") return [{ case: o.id, kind: "big_order", amountPaise: p.totalInr * 100, who: o.customer, what: what(o), money: true, yes: "approve", no: "deny", fields: { amountPaise: p.totalInr * 100, askedAtMs: p.askedAtMs } }];
    if (p?.kind === "refund") return [{ case: o.id, kind: "late_refund", amountPaise: p.amountInr * 100, who: o.customer, what: what(o), money: true, yes: "approve", no: "deny", fields: { amountPaise: p.amountInr * 100, paymentId: p.paymentId } }];
    return [];
  }

  function prepare(p: Proposal): Prepared {
    const o = store.orders.get(p.case);
    if (!o) return { ok: false, why: "no_case" };
    if (p.kind === "answer") {
      const item = waitingOn(o).find((i) => i.kind === p.itemKind);
      if (!item) return { ok: false, why: "nothing_waiting" };
      return { ok: true, action: { kind: "answer", skill: "orders", case: o.id, fields: { who: o.customer, itemKind: item.kind, answer: p.answer, ...item.fields } }, shown: { who: item.who, what: item.what, amountPaise: item.amountPaise } };
    }
    if (p.kind === "message") {
      const refused = checkWords(p.words, { optedOut: deps.optedOut(o.customer), amountsPaise: [o.totalInr, o.advanceInr].map((v) => (v === undefined ? undefined : v * 100)) });
      if (refused) return { ok: false, why: refused };
      return { ok: true, action: { kind: "message", skill: "orders", case: o.id, fields: { who: o.customer, phone: o.customer, words: p.words } }, shown: { who: o.customer, what: what(o), amountPaise: 0, words: p.words } };
    }
    return { ok: false, why: "not_here" };
  }

  async function execute(a: CardAction): Promise<Executed> {
    const o = store.orders.get(a.case);
    if (!deps.answer || !o || a.kind !== "answer") return { ok: false, note: "failed" };
    const item = waitingOn(o).find((i) => i.kind === a.fields.itemKind);
    if (!item) return { ok: false, note: "failed" };
    await deps.answer(ownerReply(deps.settings.owner.whatsapp, deps.nowMs(), o.id, { text: `${a.fields.answer === "no" ? item.no : item.yes} ${o.id}` }));
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
      for (const o of store.orders.values()) if (OPEN.includes(o.state)) rows.push({ case: o.id, who: o.customer, what: what(o), amountPaise: (o.totalInr ?? 0) * 100, state: o.state });
      return rows;
    },
    waiting: () => [...store.orders.values()].flatMap((o) => waitingOn(o).map(({ fields: _f, ...item }) => item)),
    problems: () => [...store.orders.values()].reduce((n, o) => n + (o.refundIssues ?? []).length, 0),
    prepare,
    execute,
  };
}
