// The runtime's cards (item 11e): an act that touches money or a limit, or a message that cannot be taken back, is not done when the owner asks. The assistant shows it
// as a card with the exact change and does it only when the owner taps yes (or types the card's exact code). Used by conversation.ts; the words are words.ts.
//
// The binding, which is the point (modules/Explanation.md, "The card binding"):
//  - a card is a saved, immutable action: the skill, the case and the exact fields the skill read from its store (cards never take a value from a model);
//  - its digest is over those fields; the words the owner reads are written from the same fields;
//  - a fresh one-use code (the approvals alphabet, modules/approvals/code.ts); only its hash is kept, the code is only in the message;
//  - on a tap the skill reads the action again from the store as it is NOW: the same digest, and the saved action is done; another digest (the amount, the payment
//    or the customer changed), and nothing is done, the card is void and a new one is made;
//  - a no is final for that action: the same digest proposed again within 24 hours is refused with words, not shown again;
//  - a tap on a closed card does nothing.
//
// This is the RUNTIME's card, for what the runtime itself decides. A refund Guard holds above the limit is the approvals relay's card (it alone holds the owner's
// approver secret): its buttons carry the relay's code (approval-buttons.ts) and the runtime drops them. The verbs differ on purpose: "yes K7M2QX" here, "approve K7M2QX"
// there, because the relay counts every code it never issued towards its lockout.
import { createHash } from "node:crypto";
import { CODE_PATTERN, newCode } from "../approvals/code.ts";
import { DAY, HOUR } from "../core/time.ts";
import { REFUSED_FOR_MS, nextId } from "./state.ts";
import type { AssistantState, CardAction, CardRecord } from "./state.ts";

/** How long a card can be tapped. A day: the morning's cards are still good in the evening, and an old one cannot be tapped by surprise a week later. */
export const CARD_FOR_MS = DAY;

/** The digest of an action's exact fields: the skill, the kind, the case and every field, in a fixed order. Key order in `fields` does not matter. */
export function actionDigest(a: CardAction): string {
  const fields = Object.keys(a.fields).sort().map((k) => [k, a.fields[k]]);
  return createHash("sha256").update(JSON.stringify(["card", a.skill, a.kind, a.case, fields])).digest("hex").slice(0, 32);
}

/** The hash a card keeps of its code. Salted with its purpose so it can never match a relay code's hash (modules/approvals/store.ts hashes its own way). */
export const codeHash = (code: string): string => createHash("sha256").update(`assistant-card:${code.toUpperCase()}`).digest("hex");

/** The card buttons' ids. A button carries one answer and the one-use code. */
export const CARD_BUTTON = { yes: "card-yes", no: "card-no" } as const;
export const cardButtonId = (answer: keyof typeof CARD_BUTTON, code: string): string => `${CARD_BUTTON[answer]}:${code}`;

const BUTTON_RE = new RegExp(`^card-(yes|no):(${CODE_PATTERN})$`, "u");
/** The typed form: "yes K7M2QX" / "no K7M2QX", in any case. A bare "yes" (or "haan", "ok") never matches: free text never executes. */
const TYPED_RE = new RegExp(`^\\s*(yes|no)\\s+(${CODE_PATTERN})\\s*$`, "iu");

export interface CardReply { answer: "yes" | "no"; code: string; via: "button" | "typed" }

/** A tap on a card's button, or its exact code typed; undefined for anything else. */
export function parseCardReply(m: { text: string; reply?: { id: string } }): CardReply | undefined {
  const tapped = m.reply ? BUTTON_RE.exec(m.reply.id) : null;
  if (tapped) return { answer: tapped[1] as "yes" | "no", code: tapped[2].toUpperCase(), via: "button" };
  const typed = TYPED_RE.exec(m.text);
  return typed ? { answer: typed[1].toLowerCase() as "yes" | "no", code: typed[2].toUpperCase(), via: "typed" } : undefined;
}

/** A no to this exact action in the last 24 hours, if there is one: its time and its card. */
export function refusedBefore(state: AssistantState, digest: string, nowMs: number): { atMs: number; card: string } | undefined {
  return state.refused.find((r) => r.digest === digest && r.atMs > nowMs - REFUSED_FOR_MS);
}

/**
 * A new card for this action. Any open card for the same skill, kind and case is void first: the owner has one live card per thing, and an old one with an old amount
 * can never be tapped after a new one was shown. Returns the card and its code; the code goes into the message and is never saved.
 */
export function makeCard(state: AssistantState, action: CardAction, proposal: Record<string, unknown>, nowMs: number): { card: CardRecord; code: string; voided: CardRecord[] } {
  const digest = actionDigest(action);
  const voided: CardRecord[] = [];
  const id = nextId(state, "c");
  for (const c of state.cards) {
    if (c.state !== "open" || c.action.skill !== action.skill || c.action.kind !== action.kind || c.action.case !== action.case) continue;
    c.state = "void"; c.closedAtMs = nowMs; c.replacedBy = id;
    voided.push(c);
  }
  let code = newCode();
  for (let tries = 0; state.cards.some((c) => c.state === "open" && c.codeHash === codeHash(code)) && tries < 20; tries++) code = newCode();
  const card: CardRecord = { id, codeHash: codeHash(code), action: structuredClone(action), proposal: structuredClone(proposal), digest, state: "open", createdAtMs: nowMs, expiresAtMs: nowMs + CARD_FOR_MS };
  state.cards.push(card);
  return { card, code, voided };
}

/** The card this code belongs to, whatever its state; undefined when no card has it. */
export const cardByCode = (state: AssistantState, code: string): CardRecord | undefined => state.cards.find((c) => c.codeHash === codeHash(code));

/**
 * What a reply to a card comes to, before anything is done. "do": the card is open, in time, and the skill's action now has the card's digest; the caller does it and
 * then calls `closeCard(..., "done")`. "refuse": the owner said no; the caller closes it as refused (and that no is final). Everything else does nothing:
 * "unknown" (no card has the code), "closed" (answered already, void or refused), "expired", "changed" (the action is not what the card showed: void it and make a new
 * card from `now`), "gone" (the action cannot be done at all now).
 */
export type CardVerdict =
  | { verdict: "do"; card: CardRecord }
  | { verdict: "refuse"; card: CardRecord }
  | { verdict: "unknown" }
  | { verdict: "closed"; card: CardRecord }
  | { verdict: "expired"; card: CardRecord }
  | { verdict: "changed"; card: CardRecord; now: CardAction }
  | { verdict: "gone"; card: CardRecord; why: string };

export function judgeReply(state: AssistantState, reply: CardReply, nowMs: number, current: (card: CardRecord) => { ok: true; action: CardAction } | { ok: false; why: string }): CardVerdict {
  const card = cardByCode(state, reply.code);
  if (!card) return { verdict: "unknown" };
  if (card.state !== "open") return { verdict: "closed", card };
  if (nowMs >= card.expiresAtMs) return { verdict: "expired", card };
  if (reply.answer === "no") return { verdict: "refuse", card }; // a no needs no fresh read: it changes nothing
  const now = current(card);
  if (!now.ok) return { verdict: "gone", card, why: now.why };
  if (actionDigest(now.action) !== card.digest) return { verdict: "changed", card, now: now.action };
  return { verdict: "do", card };
}

/** Close a card. A refusal is remembered by its digest, so the same action is not shown again for 24 hours. */
export function closeCard(state: AssistantState, card: CardRecord, to: Exclude<CardRecord["state"], "open">, nowMs: number): void {
  card.state = to;
  card.closedAtMs = nowMs;
  if (to === "refused") state.refused.push({ digest: card.digest, atMs: nowMs, card: card.id });
}

/** Cards past their time, closed as expired (on the tick). Returns them. */
export function expireCards(state: AssistantState, nowMs: number): CardRecord[] {
  const out: CardRecord[] = [];
  for (const c of state.cards) if (c.state === "open" && nowMs >= c.expiresAtMs) { c.state = "expired"; c.closedAtMs = nowMs; out.push(c); }
  return out;
}

/** The open cards, oldest first: what the owner's app and "what needs me" show. */
export const openCards = (state: AssistantState, nowMs: number): CardRecord[] => state.cards.filter((c) => c.state === "open" && nowMs < c.expiresAtMs);

/** How many hours a card has, for the words ("for 24 hours"). */
export const cardHours = (): number => Math.round(CARD_FOR_MS / HOUR);
