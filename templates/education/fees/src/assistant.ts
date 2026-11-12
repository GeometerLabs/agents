// Fees as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts): who owes, what waits for the owner, and a message to a parent. Reads and `prepare`
// are pure over the store, so the morning line reads them with no agent. What waits is read from the owner page's own list (src/channel.ts ownerItems, item 11h), so
// "what needs me", the morning line's count, the mood and the owner's page always show the same things: a payment a parent says they made and a refund the owner owes
// (a UPI centre; answered with the same button and one-use code the owner's WhatsApp message carries), a waiver or a refund a parent asked for ("approve q-3" / "deny q-3").
// Cancelling or refunding a fee from the chat is not offered in the first release (modules/Deferred.md): the owner answers a parent's refund request as before, and
// the card for it is that answer.
import { checkWords, ownerReply } from "../../../../modules/assistant/wire.ts";
import type { Executed, OwnerSkill, OweRow, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { markButtonId } from "../../../../modules/payments/owner-marked/owner.ts";
import { ownerItems } from "./channel.ts";
import type { OwnerItem } from "./channel.ts";
import { balancePaise, monthLabel, openDues } from "./due.ts";
import type { Due, Store } from "./due.ts";
import type { Settings } from "./settings.ts";

export interface FeesSkillDeps {
  settings: Settings;
  store: Store;
  nowMs: () => number;
  optedOut: (phone: string) => boolean;
  /** The agent's own handling of the owner's reply (`onOwnerMessage`). Left out: a read-only skill (the morning line). */
  answer?: (msg: InboundMessage) => Promise<void>;
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
    return { ok: false, why: "not_here" };
  }

  async function execute(a: CardAction): Promise<Executed> {
    const d = store.dues.get(a.case);
    if (!deps.answer || !d || a.kind !== "answer") return { ok: false, note: "failed" };
    const item = waitingOn(d).find((i) => i.kind === a.fields.itemKind);
    if (!item) return { ok: false, note: "failed" };
    // the very reply the owner could give on WhatsApp: the mark's button (with its code), or "approve q-3" / "deny q-3"
    await deps.answer(ownerReply(settings.owner.whatsapp, deps.nowMs(), d.id, "buttonId" in item.reply ? { buttonId: item.reply.buttonId } : { text: `${a.fields.answer === "no" ? item.no : item.yes} ${item.reply.request}` }));
    return { ok: true, note: "done" };
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
