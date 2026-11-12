// Fees as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts): who owes, what waits for the owner (a waiver or a refund a parent asked for, answered
// with the owner's own "approve q-3" / "deny q-3"), and a message to a parent. Reads and `prepare` are pure over the store, so the morning line reads them with no agent.
// Cancelling or refunding a fee from the chat is not offered in the first release (modules/Deferred.md): the owner answers a parent's refund request as before, and
// the card for it is that answer.
import { checkWords, ownerReply } from "../../../../modules/assistant/wire.ts";
import type { Executed, OwnerSkill, OweRow, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
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

  /** What waits on one fee: the first request to the owner (the agent answers its first), as a card can show it. */
  function waitingOn(d: Due): (WaitingItem & { request: string; fields: CardAction["fields"] })[] {
    const p = d.pending[0];
    if (p?.kind === "waiver") return [{ case: d.id, kind: "waiver", amountPaise: p.amountInr * 100, who: d.studentName, what: what(d), money: true, yes: "approve", no: "deny", request: p.id, fields: { request: p.id, amountPaise: p.amountInr * 100, balanceAtAskPaise: p.balanceAtAskInr * 100 } }];
    if (p?.kind === "refund_request") return [{ case: d.id, kind: "refund_request", amountPaise: p.amountInr * 100, who: d.studentName, what: what(d), money: true, yes: "approve", no: "deny", request: p.id, fields: { request: p.id, amountPaise: p.amountInr * 100, paymentId: p.paymentId } }];
    return [];
  }

  function prepare(p: Proposal): Prepared {
    const d = store.dues.get(p.case);
    if (!d) return { ok: false, why: "no_case" };
    if (p.kind === "answer") {
      const item = waitingOn(d).find((i) => i.kind === p.itemKind);
      if (!item) return { ok: false, why: "nothing_waiting" };
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
    await deps.answer(ownerReply(settings.owner.whatsapp, deps.nowMs(), d.id, { text: `${a.fields.answer === "no" ? item.no : item.yes} ${item.request}` }));
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
    waiting: () => [...store.dues.values()].flatMap((d) => waitingOn(d).map(({ request: _r, fields: _f, ...item }) => item)),
    problems: () => [...store.dues.values()].reduce((n, d) => n + (d.refundIssues ?? []).length, 0),
    prepare,
    execute,
  };
}
