// The assistant's own part of a shop's store (item 11e, decision 43). It is plain JSON, kept by the template under `assistant` and written by its snapshot codec as an
// "optional-object" (modules/runtime/snapshot.ts). So it is saved in the same step, in one transaction, with the cases an act changes (modules/runtime/core.ts).
// Used by cards.ts, conversation.ts and morning.ts; each template's store and codec carry it.
//
// What it holds: the cards (an exact action waiting for the owner's tap, and the last few closed ones), the actions the owner said no to (a no is final for 24 hours),
// the days the owner closed, what can still be undone, and the last few lines of the owner's talk in the app. It holds no customer's words except a message the owner
// asked to send, which goes with its card; the card closes when it is sent or refused, and the words go with it after a day (compactAssistant).
import { DAY } from "../core/time.ts";

/** What a card does when the owner taps yes: the skill, the case and the exact fields the skill read from its store. Immutable once the card is made. */
export interface CardAction {
  /** "refund" | "cancel" | "answer" (to something already waiting) | "message". */
  kind: string;
  skill: string;
  case: string;
  /** Every value the act uses, exactly: amounts in paise, payment ids, the recipient's number, the words of a message. The digest is over these. */
  fields: Record<string, string | number | boolean>;
}

export type CardState = "open" | "done" | "refused" | "void" | "expired";

export interface CardRecord {
  /** "c-3": shown to nobody, used in the record. */
  id: string;
  /** The hash of the one-use code (cards.ts codeHash). The code itself is only in the message the owner got. */
  codeHash: string;
  action: CardAction;
  /** What the owner asked, as the skill's `prepare` took it (skill.ts Proposal). On the tap it is prepared again from this, so "refund b-14" with no amount follows the deposit as it is then. */
  proposal: Record<string, unknown>;
  digest: string;
  state: CardState;
  createdAtMs: number;
  expiresAtMs: number;
  closedAtMs?: number;
  /** A void card: the card made with the action as it is now. */
  replacedBy?: string;
  /**
   * The card's question in the owner's language, as the WhatsApp card asks it but without its code (words.ts cardQuestion): what the owner's page shows beside the
   * card's buttons (integration of items 11d and 11e). Written from the same saved fields; it goes with the card when the card is compacted.
   */
  question?: string;
}

/** A no is final for that exact action (the same digest) for this long: the owner is not asked about it again. The relay's rule for Guard's holds is the same 24 hours. */
export const REFUSED_FOR_MS = DAY;

export interface UndoRecord {
  /** "u-2" */
  id: string;
  /** A closed day (undo: open it again) or a booking moved by the owner (undo: move it back, if that time is still free). */
  kind: "close_day" | "move";
  skill: string;
  /** close_day: the date closed, "2026-11-16". move: the booking's date before the move. */
  date: string;
  /** close_day: the cases whose customers were asked to pick another day. Undo tells those still on that day that their booking stands. */
  asked: string[];
  /** move: the booking, and where it was and went. */
  case?: string;
  fromMs?: number;
  toMs?: number;
  atMs: number;
  untilMs: number;
  done?: boolean;
}

/** How long an act can be undone. */
export const UNDO_FOR_MS = DAY;

/** One line of the owner's talk in the app, shown on the page (newest last). */
export interface TalkLine { atMs: number; from: "owner" | "assistant"; text: string }
export const TALK_LINES = 20;

export interface AssistantState {
  /** The last number given to a card or an undo ("c-3", "u-4"); never given twice, so a record line names one thing. */
  seq: number;
  cards: CardRecord[];
  refused: { digest: string; atMs: number; card: string }[];
  /** Dates the owner closed, "2026-11-16", in order. */
  closedDays: string[];
  undo: UndoRecord[];
  talk: TalkLine[];
}

export const emptyAssistantState = (): AssistantState => ({ seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [] });

/** The state in a store, made on first use. A store from before the assistant has none, and loads as it was. */
export function assistantOf(store: { assistant?: AssistantState }): AssistantState {
  if (!store.assistant) store.assistant = emptyAssistantState();
  return store.assistant;
}

/** The next id with this letter ("c", "u"). */
export function nextId(state: AssistantState, letter: string): string {
  state.seq += 1;
  return `${letter}-${state.seq}`;
}

/** Closed cards kept for the record's sake (a tap on an old card is answered "already done"); older ones go. */
export const KEEP_CLOSED_CARDS = 30;

/**
 * Take off what is no longer needed: closed cards beyond the last few and older than a day (with them, a message's words), refusals older than their 24 hours,
 * undo records past their time, past closed days and old talk. Run on the tick. What happened stays in the record, which is never touched here. Returns how much went.
 */
export function compactAssistant(state: AssistantState, nowMs: number, todayIso: string): number {
  let gone = 0;
  const closed = state.cards.filter((c) => c.state !== "open");
  const keepClosed = new Set(closed.slice(-KEEP_CLOSED_CARDS).filter((c) => (c.closedAtMs ?? c.createdAtMs) > nowMs - DAY).map((c) => c.id));
  const cards = state.cards.filter((c) => c.state === "open" || keepClosed.has(c.id));
  gone += state.cards.length - cards.length;
  state.cards = cards;
  const refused = state.refused.filter((r) => r.atMs > nowMs - REFUSED_FOR_MS);
  gone += state.refused.length - refused.length;
  state.refused = refused;
  const undo = state.undo.filter((u) => !u.done && u.untilMs > nowMs);
  gone += state.undo.length - undo.length;
  state.undo = undo;
  const days = state.closedDays.filter((d) => d >= todayIso);
  gone += state.closedDays.length - days.length;
  state.closedDays = days;
  if (state.talk.length > TALK_LINES) { gone += state.talk.length - TALK_LINES; state.talk = state.talk.slice(-TALK_LINES); }
  return gone;
}
