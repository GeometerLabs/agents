// Fees as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts): who owes, what waits for the owner, and a message to a parent. Reads and `prepare`
// are pure over the store, so the morning line reads them with no agent. What waits is read from the owner page's own list (src/channel.ts ownerItems, item 11h), so
// "what needs me", the morning line's count, the mood and the owner's page always show the same things: a payment a parent says they made and a refund the owner owes
// (a UPI centre; answered with the same button and one-use code the owner's WhatsApp message carries), a waiver or a refund a parent asked for ("approve q-3" / "deny q-3").
// Cancelling and refunding a fee from the chat (17 Nov 2026) are the agent's own paths, handed in as `acts` (src/agent.ts feesActs), as in Bookings: "cancel f-3" is the
// owner's waiver of the whole balance (the very applyWaiver of "approve q-3") and "refund f-3" is the owner's decision sent as the same refund as "approve q-4". The card
// binds the fee's state, balance, payments counted, waiver and late fee, so a change since voids it, and the act reads the record again on the tap.
import { checkWords, ownerReply } from "../../../../modules/assistant/wire.ts";
import type { Executed, OwnerSkill, OweRow, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import type { RefundResult } from "../../../../modules/payments/refunds.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { markButtonId } from "../../../../modules/payments/owner-marked/owner.ts";
import { ownerItems } from "./channel.ts";
import type { OwnerItem } from "./channel.ts";
import { CASH_LINK, balancePaise, monthLabel, openDues } from "./due.ts";
import type { Due, Store } from "./due.ts";
import type { Settings } from "./settings.ts";

/** The agent's own paths the skill's acts use. Each is the function the agent already runs for the same thing; the skill adds no other way to act. */
export interface FeesActs {
  owner: string;
  /** A UPI centre: the owner pays refunds back from their own app. */
  ownerRefunds: boolean;
  /**
   * Cancel the fee: the owner waives exactly `amountInr`, the whole balance the card showed, after the payment record is read again. False when the fee is no longer open
   * or no longer owes that amount (nothing is done then). The parent is told as for any waiver, and the fee's open links are closed.
   */
  cancelFee(due: Due, amountInr: number): Promise<boolean>;
  /** Refund `amountInr` of one payment on this fee, the way "approve q-4" does (Guard holds it above the limit; a UPI centre's owner owes it). */
  refund(due: Due, paymentId: string, amountInr: number, why: string): Promise<RefundResult | "owed">;
}

export interface FeesSkillDeps {
  settings: Settings;
  store: Store;
  nowMs: () => number;
  optedOut: (phone: string) => boolean;
  /** The agent's own handling of the owner's reply (`onOwnerMessage`). Left out: a read-only skill (the morning line). */
  answer?: (msg: InboundMessage) => Promise<void>;
  /** The record as it is in this step: what was already refunded on a payment. Left out with `acts`: a read-only skill. */
  entries?: () => readonly RecordEntry[];
  /** Left out: a read-only skill (the morning line, the owner's app): cancel and refund are prepared and refused as `not_here`. */
  acts?: FeesActs;
}

/** Fees' words for the router. */
const ROUTING_WORDS = { en: ["fee", "fees", "tuition"], hi: ["फीस", "fees"], ml: ["ഫീസ്"], kn: ["ಫೀಸ್", "ಶುಲ್ಕ"] } as const;

export function feesSkill(deps: FeesSkillDeps): OwnerSkill {
  const { settings, store } = deps;
  const lang = settings.owner.language;
  const what = (d: Due) => monthLabel(d, lang);

  /**
   * What waits for the owner, as a card can show it (and the fields its digest is over), from the owner page's list. The card's fields carry the page item's digest,
   * so a change there (a part marked, a request answered) voids a card made before it, as on the page. `reply` is what a yes sends: the UPI mark's button with its
   * code, or the owner's own "approve q-3".
   */
  type Waiting = WaitingItem & { fields: CardAction["fields"]; reply: { buttonId: string } | { request: string } };
  const ANSWERS: Record<OwnerItem["kind"], { yes: string; no?: string }> = { waiver: { yes: "approve", no: "deny" }, refund_request: { yes: "approve", no: "deny" }, deposit: { yes: "received" }, refund_owed: { yes: "refunded" } };
  function waitingNow(): Waiting[] {
    return ownerItems(settings, store).map((i): Waiting => {
      const d = store.dues.get(i.case);
      const a = ANSWERS[i.kind];
      return {
        case: i.case, kind: i.kind, amountPaise: i.amountPaise, who: d?.studentName ?? i.customer.name ?? i.customer.phone, what: d ? what(d) : i.what, money: true,
        yes: a.yes, ...(a.no ? { no: a.no } : {}), fields: { pageDigest: i.digest, amountPaise: i.amountPaise },
        reply: i.code ? { buttonId: markButtonId(i.kind === "deposit" ? "received" : "refunded", i.code) } : { request: i.request ?? "" },
      };
    });
  }
  const waitingOn = (d: Due): Waiting[] => waitingNow().filter((i) => i.case === d.id);

  function prepare(p: Proposal): Prepared {
    const d = store.dues.get(p.case);
    if (!d) return { ok: false, why: "no_case" };
    if (p.kind === "answer") {
      const item = waitingOn(d).find((i) => i.kind === p.itemKind);
      if (!item) return { ok: false, why: "nothing_waiting" };
      // a mark has no "no": the owner who has not had the money simply does not press
      if (p.answer === "no" && !item.no) return { ok: false, why: "nothing_waiting" };
      return { ok: true, action: { kind: "answer", skill: "fees", case: d.id, fields: { who: d.studentName, itemKind: item.kind, answer: p.answer, ...item.fields } }, shown: { who: item.who, what: item.what, amountPaise: item.amountPaise } };
    }
    if (p.kind === "message") {
      const refused = checkWords(p.words, { optedOut: deps.optedOut(d.customer), amountsPaise: [balancePaise(d), d.feeInr * 100, d.lateFeeInr * 100] });
      if (refused) return { ok: false, why: refused };
      return { ok: true, action: { kind: "message", skill: "fees", case: d.id, fields: { who: d.studentName, phone: d.customer, words: p.words } }, shown: { who: d.studentName, what: what(d), amountPaise: 0, words: p.words } };
    }
    if (!deps.acts) return { ok: false, why: "not_here" };
    return prepareMoney(p, d);
  }

  /** Money already going back on a payment: refunds the record confirmed, and UPI refunds owed or marked sent. */
  const alreadyBack = (paymentId: string): number => {
    let paise = 0;
    for (const e of deps.entries?.() ?? []) if (e.action === "refund" && e.refs.paymentId === paymentId && e.outcome === "confirmed") paise += Number(e.refs.amountPaise ?? 0) || 0;
    for (const r of store.upi?.refunds ?? []) if (r.paymentId === paymentId && r.state !== "kept") paise += r.amountPaise;
    return paise;
  };
  /** A refund Guard holds, one that could not be sent, one the parent asked for and waits for the owner, a waiver waiting, or one with an unclear outcome: answered first, not stacked on. */
  const busy = (d: Due): boolean => d.pending.length > 0 || (d.refundIssues ?? []).length > 0;
  const aboveLimit = (paise: number): boolean => !deps.acts?.ownerRefunds && paise > settings.refund.limitInr * 100;
  /** What the card is bound to: if any of it changes, the card made before is void. */
  const standing = (d: Due) => ({ state: d.state, balancePaise: balancePaise(d), payments: d.payments.length, waivedInr: d.waivedInr, lateFeeInr: d.lateFeeInr });
  const action = (kind: string, d: Due, fields: CardAction["fields"]): CardAction => ({ kind, skill: "fees", case: d.id, fields: { who: d.studentName, ...standing(d), ...fields } });

  function prepareMoney(p: Proposal, d: Due): Prepared {
    if (busy(d)) return { ok: false, why: "busy" };
    if (p.kind === "cancel") {
      // cancelling a fee is taking off what is still owed on it: only an open fee, owing whole rupees
      if (d.state !== "open" || balancePaise(d) <= 0) return { ok: false, why: "not_live" };
      if (balancePaise(d) % 100 !== 0) return { ok: false, why: "too_much" };
      // the card shows no money coming back (a cancel takes off what is owed; it refunds nothing: that is "refund f-3"), so its shown amount is 0; the card is still bound to the balance
      return { ok: true, action: action("cancel", d, { amountPaise: balancePaise(d) }), shown: { who: d.studentName, what: what(d), amountPaise: 0 } };
    }
    if (p.kind !== "refund") return { ok: false, why: "not_here" };
    // a refund of money paid: once the fee no longer asks for money (a fee that is still open is cancelled first, with its own card); one refund for a payment, and never cash
    if (d.state === "open") return { ok: false, why: d.payments.some((x) => x.linkId !== CASH_LINK) ? "cancel_first" : "nothing_paid" };
    const candidates = d.payments.filter((x) => x.linkId !== CASH_LINK && alreadyBack(x.id) === 0).sort((a, b) => b.amountPaise - a.amountPaise);
    if (candidates.length === 0) return { ok: false, why: d.payments.some((x) => x.linkId !== CASH_LINK) ? "already_back" : "nothing_paid" };
    const target = candidates[0];
    const amount = p.amountPaise ?? target.amountPaise;
    if (amount < 100 || amount > target.amountPaise || amount % 100 !== 0) return { ok: false, why: "too_much" }; // refunds go in whole rupees, never above the payment
    return { ok: true, action: action("refund", d, { paymentId: target.id, amountPaise: amount, availablePaise: target.amountPaise }), shown: { who: d.studentName, what: what(d), amountPaise: amount }, ...(aboveLimit(amount) ? { aboveLimit: true } : {}) };
  }

  async function execute(a: CardAction): Promise<Executed> {
    const d = store.dues.get(a.case);
    if (d && deps.acts && (a.kind === "cancel" || a.kind === "refund")) return executeMoney(a, d, deps.acts);
    if (!deps.answer || !d || a.kind !== "answer") return { ok: false, note: "failed" };
    const item = waitingOn(d).find((i) => i.kind === a.fields.itemKind);
    if (!item) return { ok: false, note: "failed" };
    // the very reply the owner could give on WhatsApp: the mark's button (with its code), or "approve q-3" / "deny q-3"
    await deps.answer(ownerReply(settings.owner.whatsapp, deps.nowMs(), d.id, "buttonId" in item.reply ? { buttonId: item.reply.buttonId } : { text: `${a.fields.answer === "no" ? item.no : item.yes} ${item.reply.request}` }));
    return { ok: true, note: "done" };
  }

  async function executeMoney(a: CardAction, d: Due, acts: FeesActs): Promise<Executed> {
    // the same facts as when the card was made: a card made before a payment, a waiver, a late fee or an answer to a parent is void (the module also checks the digest)
    const now = standing(d);
    for (const key of ["state", "balancePaise", "payments", "waivedInr", "lateFeeInr"] as const) if (a.fields[key] !== now[key]) return { ok: false, note: "failed" };
    if (busy(d)) return { ok: false, note: "failed" };
    if (a.kind === "cancel") return (await acts.cancelFee(d, Number(a.fields.amountPaise) / 100)) ? { ok: true, note: "done", told: true } : { ok: false, note: "failed" };
    const result = await acts.refund(d, String(a.fields.paymentId), Number(a.fields.amountPaise) / 100, "refunded by the owner through the shop's assistant");
    return result === "owed" ? { ok: true, note: "owed_by_owner" } : result === "done" ? { ok: true, note: "done" } : result === "held" ? { ok: true, note: "held_by_guard" } : { ok: false, note: "failed" };
  }

  return {
    name: "fees",
    routing: {
      refs: /^[fq]-\d{1,6}$/u,
      buttonPrefixes: ["pay:", "paid:"],
      words: ROUTING_WORDS,
      liveCaseOf: (phone) => openDues(store, phone)[0]?.id,
    },
    owes() {
      const now = deps.nowMs();
      const rows: OweRow[] = [];
      for (const d of store.dues.values()) if (d.state === "open" && d.dueMs <= now && balancePaise(d) > 0) rows.push({ case: d.id, who: d.studentName, what: what(d), amountPaise: balancePaise(d), dueMs: d.dueMs });
      return rows.sort((a, b) => (a.dueMs ?? 0) - (b.dueMs ?? 0));
    },
    waiting: () => waitingNow().map(({ reply: _r, fields: _f, ...item }) => item),
    problems: () => [...store.dues.values()].reduce((n, d) => n + (d.refundIssues ?? []).length, 0),
    prepare,
    execute,
  };
}
