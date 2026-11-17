// The chat on the shop's page, the shop's side of it (W1, 17 Nov 2026; plan next-phase.md section 1a, "The talk on every door"): what one guest's thread is, how a send is
// run as a step, and what the page may read back. Pure: no disk, no node modules, no network, so the agent that imports it still runs in the browser demo.
//
// Why it looks like this. A guest on the shop's page is a second door to the SAME assistant a WhatsApp customer reaches, so a chat send is not handled here: `chatTurn`
// only turns it into the InboundMessage a WhatsApp customer would have sent (from: the guest's own conversation, "chat:" and 16 hex digits of the guest's hash) and hands
// it to the template's own `onMessage`. That step does what it always does: the template's flow first (book or order, with its buttons and limits), then the customer
// talk of block M with all its checks, then the menu. Replies are written by `say` and kept by the channel outbox (outbox.ts), which a chat thread reads back.
//
// What this adds, and nothing more: the guest's own lines (`said`, in order with the shop's by one counter), the retry that is answered once (a send's id), a tap checked
// against what the shop offered, and the day's caps that must be saved (typed sends that may ask the model, and sends in all). The per-minute rate is in memory, at the
// runtime's door (createHandleRate), because a restart forgetting it costs nothing; a cap that must hold across restarts is in the saved state.
import type { InboundMessage } from "../messaging/messaging.ts";
import { dayLocal, stateFor } from "../understanding/ai-state.ts";
import type { AiStore } from "../understanding/ai-state.ts";
import type { Language } from "../language/languages.ts";
import type { ChatMessage } from "./events.ts";
import { chatConversationOf } from "./conversation.ts";
import { CHAT_THREAD_MAX } from "./state.ts";
import type { ChannelState, ChatChoice, ChatGuest } from "./state.ts";
import { CHAT, QUICK } from "./words-chat.ts";
import type { ChatKind } from "./words-chat.ts";

/**
 * The limits of the chat. The door's per-address limits are the front's (limits.ts); these are the runtime's. A guest's handle costs nothing to make, so none of them
 * rests on the handle alone: the shop-wide ones bound a flood of new handles.
 */
export const CHAT_LIMITS = {
  /** Typed sends that may ask the model, per guest per day (the shop's day). After it the rules and the buttons answer, as in button mode. */
  modelTurnsPerDay: 20,
  /** Sends of any kind per guest per day: a saved cap, so a restart does not forget it. */
  messagesPerDay: 150,
  /** Sends per guest per minute, in memory. */
  perMinute: 8,
  /** Guests never seen before, per shop per hour, in memory: what bounds fresh handles being made to flood the owner's phone or hold the calendar. */
  newGuestsPerHour: 12,
  /** Sends from every guest of the shop together, per ten minutes, in memory. */
  shopPer10Min: 300,
} as const;

/** How many of the shop's latest lines a tap may name: a button from the line before last is still fair, one from an hour ago is not. */
const TAP_WINDOW = 4;

export const newGuest = (now: number, day: string): ChatGuest => ({ startedMs: now, lastMs: now, said: [], day, turns: 0, messages: 0 });

/** One line of a thread as the page reads it: `n` is its place in the conversation (the shared counter), `who` which side. */
export interface ChatLine { n: number; who: "you" | "shop"; text: string; atMs: number; cid?: string; choices?: ChatChoice[] }

/** What a thread read gives the page. `state`: how the guest's latest send stands (`pending`: its step has not run, `failed`: it ended without its work done). */
export interface ChatThread {
  lines: ChatLine[];
  /** True when the guest has had at least one answer: only then are alerts offered (the runtime also refuses a subscription before it). */
  answered: boolean;
  /** The guest's own counts for today, so the page can say "the buttons still work" before the guest hits the cap. */
  capped: boolean;
  /** Days a thread is kept (the shop's retention), for the quiet line under it. */
  retentionDays: number;
}

const numberOf = (id: string): number => Number(id.slice(3)) || 0;

/** Is this a conversation the runtime knows (a guest who has sent something and whose thread has not been cleared)? */
export const chatKnown = (state: ChannelState | undefined, hash: string): boolean => state?.chat?.[chatConversationOf(hash)] !== undefined;

/** Has the shop said anything to this guest yet? */
export const chatAnswered = (state: ChannelState | undefined, hash: string): boolean => (state?.outbox ?? []).some((m) => m.to === chatConversationOf(hash));

/**
 * The guest's thread: the shop's lines (the outbox) and the guest's own, in order, after `after` (0: all). Only the latest shop line carries its choices (an older
 * line's buttons are no longer on offer to draw). An unknown guest has an empty thread: the same answer for a guest never seen and for one at another shop, so a
 * made-up handle learns nothing.
 */
export function chatThread(state: ChannelState | undefined, hash: string, o: { after?: number; retentionDays: number; now: number; dayKey: string }): ChatThread {
  const conversation = chatConversationOf(hash);
  const guest = state?.chat?.[conversation];
  const shop = (state?.outbox ?? []).filter((m) => m.to === conversation);
  const lines: ChatLine[] = [
    ...shop.map((m) => ({ n: numberOf(m.id), who: "shop" as const, text: m.text, atMs: m.atMs, ...(m.choices ? { choices: m.choices } : {}) })),
    ...(guest?.said ?? []).map((m) => ({ n: numberOf(m.id), who: "you" as const, text: m.text, atMs: m.atMs, cid: m.cid })),
  ].sort((a, b) => a.n - b.n);
  const last = lines.at(-1);
  const out = lines.filter((l) => l.n > (o.after ?? 0)).map((l) => (l === last ? l : { n: l.n, who: l.who, text: l.text, atMs: l.atMs, ...(l.cid ? { cid: l.cid } : {}) }));
  return { lines: out, answered: shop.length > 0, capped: guest !== undefined && guest.day === o.dayKey && guest.turns >= CHAT_LIMITS.modelTurnsPerDay, retentionDays: o.retentionDays };
}

/** The shop's day for a moment, the key the saved caps are counted under. */
export const chatDay = (nowMs: number, timeZone: string): string => dayLocal(nowMs, timeZone);

/** What a send turned into: `done`, `repeat` (this id was already answered), `refused` (a tap nothing offered, or the day's sends are used up). */
export type ChatTurnResult = "done" | "repeat" | "refused";

export interface ChatTurnDeps {
  state: ChannelState;
  /** The agent's store, for the month's AI counts: a turn counts against the day's model turns only when a model was really asked during it. */
  ai: AiStore;
  now: number;
  timeZone: string;
  kind: ChatKind;
  /** The template's own message handler: the same step a WhatsApp customer's message takes. */
  run(message: InboundMessage): Promise<void>;
  /** Sets the guest's language (the page's) before the step, so the first answer is in it. */
  setLanguage(conversation: string, language: Language): void;
}

/** The model-asking steps counted so far this month (the decision step and the language model; the rules cost nothing). */
const modelCalls = (ai: AiStore, now: number, timeZone: string): number => { const s = stateFor(ai, now, timeZone); return s.decision + s.model; };

/**
 * Run one send as a step of the template. Idempotent: a send with an id the thread already has is answered once (`repeat`). A tap must name a choice among the shop's
 * latest lines. The guest's line is kept first, so the thread shows it whatever the step then does; `noModel` is set on the message once the day's model turns are used,
 * so the rules and the buttons answer and the talk model is not asked.
 */
export async function chatTurn(d: ChatTurnDeps, e: ChatMessage): Promise<ChatTurnResult> {
  const conversation = chatConversationOf(e.handle);
  const day = chatDay(d.now, d.timeZone);
  const guest = ((d.state.chat ??= {})[conversation] ??= newGuest(d.now, day));
  if (guest.said.some((m) => m.cid === e.id)) return "repeat";
  if (guest.day !== day) { guest.day = day; guest.turns = 0; guest.messages = 0; }
  if (guest.messages >= CHAT_LIMITS.messagesPerDay) return "refused";

  let text: string;
  let say: string;
  let reply: InboundMessage["reply"];
  if (e.tap !== undefined) {
    const offered = d.state.outbox.filter((m) => m.to === conversation).slice(-TAP_WINDOW).flatMap((m) => m.choices ?? []).find((c) => c.id === e.tap);
    if (!offered) return "refused"; // nothing offered this: it is not read as words either, so a made-up id does nothing
    say = text = offered.title;
    reply = { id: offered.id, kind: offered.list ? "list" : "button" };
  } else if (e.quick !== undefined) {
    text = QUICK[d.kind].command[e.quick - 1];
    say = QUICK[d.kind].label[e.language][e.quick - 1];
  } else {
    say = text = e.text ?? "";
  }

  guest.said.push({ id: `ch-${++d.state.seq}`, cid: e.id, text: say, atMs: d.now });
  if (guest.said.length > CHAT_THREAD_MAX) guest.said.splice(0, guest.said.length - CHAT_THREAD_MAX);
  guest.messages++;
  guest.lastMs = d.now;
  d.setLanguage(conversation, e.language);

  const capped = guest.turns >= CHAT_LIMITS.modelTurnsPerDay;
  const before = modelCalls(d.ai, d.now, d.timeZone);
  await d.run({ id: `${conversation}:${e.id}`, from: conversation, text: reply ? "" : text, timestamp: d.now, ...(reply ? { reply } : {}), ...(capped && !reply ? { noModel: true as const } : {}) });
  if (!reply && modelCalls(d.ai, d.now, d.timeZone) > before) guest.turns++;
  return "done";
}

/**
 * A rate counter by key (a guest's hash, or the shop), in memory: `take` says whether one more is allowed in the window and counts it. Used at the runtime's door, before a
 * send is saved as a task, so a flood saves nothing and costs no step.
 */
export function createRate(now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return {
    take(key: string, max: number, perMs: number): boolean {
      const t = now();
      const times = (seen.get(key) ?? []).filter((x) => t - x < perMs);
      if (times.length >= max) { seen.set(key, times); return false; }
      times.push(t);
      seen.set(key, times);
      if (seen.size > 5_000) for (const [k, v] of seen) if (v.every((x) => t - x >= perMs)) seen.delete(k); // a flood of keys cannot grow it without bound
      return true;
    },
  };
}
export type Rate = ReturnType<typeof createRate>;

/** The page's own words for a send that failed to start, for the front's answer: in the guest's language. */
export const chatRateWords = (language: Language): string => CHAT[language].rate;
