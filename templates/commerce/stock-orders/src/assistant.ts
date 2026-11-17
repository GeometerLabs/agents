// Stock orders as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts): the open supplier orders, what waits for the owner, the numbers the owner's talk
// may rest on, and what a supplier may be told about their own orders. Reads and `prepare` are pure over the store, so the morning line and the owner's app read them with
// no agent. The acts are the agent's own paths, handed in as `acts` (agent.ts): an approval and a "no" are the very approve() and decline() of the order card, and a cancel
// is the owner's "cancel po-3". The skill adds no other way to act: it cannot message a supplier, pay anyone, or change a quantity or a price.
//
// One order, one approval. The assistant's card for an order that waits is bound to EXACTLY the action the agent's own card is (order.ts approvalAction), so the digests are
// the same: a change under either (the quantity, the price, the month) voids both, and a tap on either approves the order once, because execute calls the same approve()
// and approve() refuses an order that is no longer waiting.
import { approvalAction, SKILL, isOpen, reservedPaise, monthOf, currentLine } from "./order.ts";
import type { PurchaseOrder, Store } from "./order.ts";
import { itemOf, nameIn, supplierOf, unitOf } from "./settings.ts";
import type { Settings } from "./settings.ts";
import type { Executed, OpenRow, OwnerSkill, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import type { PublicContext, TalkSource } from "../../../../modules/assistant/talk-types.ts";
import { formatInr } from "../../../../modules/language/format.ts";

/** The agent's own paths the skill's acts use. Each returns whether it did the thing (false: the order was no longer as the card showed). */
export interface StockActs {
  approve(o: PurchaseOrder): Promise<boolean>;
  decline(o: PurchaseOrder): Promise<boolean>;
  cancel(o: PurchaseOrder): Promise<boolean>;
}

export interface StockSkillDeps {
  settings: Settings;
  store: Store;
  nowMs: () => number;
  optedOut: (phone: string) => boolean;
  /** Left out: a read-only skill (the morning line, the owner's app): acts are prepared and refused as `not_here`. */
  acts?: StockActs;
}

const ROUTING_WORDS = { en: ["supplier", "stock", "reorder"], hi: ["सप्लायर", "स्टॉक"], ml: ["സപ്ലയർ", "സ്റ്റോക്ക്"], kn: ["ಸರಬರಾಜುದಾರ", "ಸ್ಟಾಕ್"] } as const;

export function stockSkill(deps: StockSkillDeps): OwnerSkill {
  const { settings, store } = deps;
  const lang = settings.owner.language;
  const what = (o: PurchaseOrder): string => `${o.qty} ${nameIn(unitOf(settings, o.unit).names, lang)} ${nameIn(itemOf(settings, o.item).names, lang)}`;
  const who = (o: PurchaseOrder): string => supplierOf(settings, o.supplier).name;
  const awaiting = (): PurchaseOrder[] => [...store.orders.values()].filter((o) => o.state === "awaiting_approval");

  /** The action an approval is bound to, from the order and its catalogue line as they are now; undefined when the line is gone. */
  const approvalOf = (o: PurchaseOrder): CardAction | undefined => {
    const line = currentLine(settings, o);
    return line ? approvalAction(settings, o, line, deps.nowMs()) : undefined;
  };

  function prepare(p: Proposal): Prepared {
    const o = store.orders.get(p.case);
    if (p.kind === "limit") return { ok: false, why: "not_here" }; // limits are the limits skill's (limits-card.ts)
    if (!o) return { ok: false, why: "no_case" };
    if (p.kind === "answer") {
      if (o.state !== "awaiting_approval") return { ok: false, why: "nothing_waiting" };
      const action = approvalOf(o);
      if (!action) return { ok: false, why: "not_live" };
      return { ok: true, action, shown: { who: who(o), what: what(o), amountPaise: o.totalPaise } };
    }
    if (p.kind === "cancel") {
      // an order that has not gone out (waiting, refused by WhatsApp, held back) can be cancelled; once the supplier has it, it cannot be taken back from here
      if (o.state === "awaiting_approval" || o.state === "send_failed" || o.state === "send_blocked") {
        return { ok: true, action: { kind: "cancel", skill: SKILL, case: o.id, fields: { who: who(o), state: o.state, qty: o.qty, totalPaise: o.totalPaise, amountPaise: 0 } }, shown: { who: who(o), what: what(o), amountPaise: 0 } };
      }
      return { ok: false, why: o.state === "approved" ? "busy" : "not_live" };
    }
    return { ok: false, why: "not_here" }; // no refund (nothing was paid by this agent), and no free-text message to a supplier from the chat
  }

  async function execute(a: CardAction): Promise<Executed> {
    const o = store.orders.get(a.case);
    if (!o || !deps.acts) return { ok: false, note: "failed" };
    if (a.kind === "order") return (a.fields.answer === "no" ? await deps.acts.decline(o) : await deps.acts.approve(o)) ? { ok: true, note: "done" } : { ok: false, note: "failed" };
    if (a.kind === "cancel") return (await deps.acts.cancel(o)) ? { ok: true, note: "done" } : { ok: false, note: "failed" };
    return { ok: false, note: "failed" };
  }

  /**
   * The reads the owner's talk rests on: counts and money, never a supplier's number or a line of a message. A supplier's talk (publicContext) gets only that supplier's own
   * open orders: never the budget, the cap, another supplier's lines or the prices of other suppliers.
   */
  const talkReads: Pick<OwnerSkill, "facts" | "publicContext"> = {
    facts(nowMs) {
      const all = [...store.orders.values()];
      const month = monthOf(nowMs, settings.timezone);
      const reserved = reservedPaise(store, month);
      const open = all.filter(isOpen);
      const silent = open.filter((o) => o.ack === "none").length;
      return [
        { id: "r:budget", kind: "record", text: `This month's supplier orders reserved ${formatInr(reserved / 100)} of the ${formatInr(settings.limits.monthlyBudgetInr)} budget. The most one order may be worth is ${formatInr(settings.limits.maxPerOrderInr)}.`, amountsInr: [reserved / 100, settings.limits.monthlyBudgetInr, settings.limits.maxPerOrderInr] },
        { id: "r:orders", kind: "record", text: `Supplier orders still to arrive: ${open.length}. Waiting for the owner's yes: ${awaiting().length}. Not answered by the supplier: ${silent}.` },
      ] satisfies TalkSource[];
    },
    publicContext(phone) {
      const supplier = settings.suppliers.find((s) => s.whatsapp.replace(/\D/gu, "") === phone.replace(/\D/gu, ""));
      const sources: TalkSource[] = [{ id: "s:shop", kind: "setting", text: `${settings.name} orders from its suppliers on WhatsApp.`, literals: [settings.name] }];
      if (supplier) {
        for (const o of store.orders.values()) {
          if (o.supplier !== supplier.id || !isOpen(o)) continue;
          sources.push({ id: `r:${o.id}`, kind: "record", text: `Order ${o.id} to this supplier: ${o.qty} ${nameIn(unitOf(settings, o.unit).names, supplier.language)} ${nameIn(itemOf(settings, o.item).names, supplier.language)}.`, literals: [o.id] });
        }
      }
      return { sources, links: [] } satisfies PublicContext;
    },
  };

  return {
    name: SKILL,
    ...talkReads,
    routing: {
      refs: /^po-\d{1,6}$/u,
      buttonPrefixes: ["ack:", "nack:", "pick:"],
      words: ROUTING_WORDS,
      liveCaseOf: () => undefined, // suppliers' messages are read by the agent itself; this skill serves the owner
    },
    open(): OpenRow[] {
      return [...store.orders.values()].filter((o) => o.state === "awaiting_approval" || isOpen(o)).map((o) => ({ case: o.id, who: who(o), what: what(o), amountPaise: o.totalPaise, state: o.state }));
    },
    waiting(): WaitingItem[] {
      return awaiting().map((o) => ({ case: o.id, kind: "order_approval", amountPaise: o.totalPaise, who: who(o), what: what(o), money: true, yes: "approve", no: "decline" }));
    },
    // orders the owner must look at: the supplier's silence, an order WhatsApp refused or a check held back (the owner's to-do, never a card)
    problems: () => [...store.orders.values()].filter((o) => o.state === "send_failed" || o.state === "send_blocked" || o.state === "send_unknown" || (o.silentToldMs !== undefined && o.ack === "none" && isOpen(o))).length,
    prepare,
    execute,
  };
}
