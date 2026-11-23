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
import type { PageAudio } from "../voice/turn.ts";
import type { BudgetConfig } from "../budget/budget.ts";
import { dayLocal, stateFor } from "../understanding/ai-state.ts";
import type { AiStore } from "../understanding/ai-state.ts";
import type { Language } from "../language/languages.ts";
import { block } from "../limits/limits.ts";
import type { Decision } from "../limits/limits.ts";
import { CHAT_TEXT_MAX } from "./events.ts";
import type { ChatMessage } from "./events.ts";
import { chatConversationOf, isChatConversation } from "./conversation.ts";
import { CHAT_THREAD_MAX } from "./state.ts";
import type { ChannelState, ChatChoice, ChatGuest, ChatMoment } from "./state.ts";
import { nextGuestNumber } from "./chat-guest.ts";
import { CHAT, QUICK } from "./words-chat.ts";
import { CHAT_MORE } from "./words-chat-more.ts";
import type { ChatKind } from "./words-chat.ts";

/**
 * The limits of the chat. The door's per-address limits are the front's (limits.ts); these are the runtime's. A guest's handle costs nothing to make, so none of them
 * rests on the handle alone: the shop-wide ones bound a flood of new handles.
 */
export const CHAT_LIMITS = {
  /** Sends of any kind per guest per day: a saved cap, so a restart does not forget it. */
  messagesPerDay: 150,
  /** Sends per guest per minute, in memory. */
  perMinute: 8,
  /** Guests never seen before, per shop per hour, in memory: what bounds fresh handles being made to flood the owner's phone or hold the calendar. */
  newGuestsPerHour: 12,
  /** Sends from every guest of the shop together, per ten minutes, in memory. */
  shopPer10Min: 300,
  /** Times one guest may make the shop tell the owner (on WhatsApp) per day (the shop's day): a saved cap. After it the guest is told, truthfully, that the owner could not be told just now. */
  pingsPerDay: 3,
} as const;

/**
 * Typed sends that may ask the model, per guest per day (the shop's day); after it the rules and the buttons answer, as in button mode. The number is the price list's
 * (`ai.daily.customer-talk.per-guest`, decision 62), written into the shop's runtime.json as `budget.guestTurnsPerDay` by the bundle. GUEST_TURNS_BEFORE_62 is used only for a shop
 * whose runtime.json has no such number (a list from before 20 Nov, or no budget); it is the old constant, kept so such a shop is never left with no limit, and goes when every list in force has the entry.
 */
export const GUEST_TURNS_BEFORE_62 = 20;
export const guestTurnsPerDay = (budget?: Pick<BudgetConfig, "guestTurnsPerDay">): number => budget?.guestTurnsPerDay ?? GUEST_TURNS_BEFORE_62;

/** How many of the shop's latest lines a tap may name: a button from the line before last is still fair, one from an hour ago is not. */
const TAP_WINDOW = 4;

export const newGuest = (now: number, day: string): ChatGuest => ({ startedMs: now, lastMs: now, said: [], day, turns: 0, messages: 0 });

/** One line of a thread as the page reads it: `n` is its place in the conversation (the shared counter), `who` which side. */
export interface ChatLine { n: number; who: "you" | "shop"; text: string; atMs: number; cid?: string; choices?: ChatChoice[]; /** The record confirmed something with this line (state.ts ChatMoment): the page marks it. */ moment?: ChatMoment }

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

/** What the page reads of a chat: the thread, how the latest send stands, the character's small-talk personality (settings.assistant.character) and whether hold-to-talk is on. The signboard's paint is not here: it travels in the shop's pages file (pages-file.ts). It lives here, beside ChatThread, because the front reads it (backend.ts); the runtime that writes it is Go since 0.2.0. */
export interface ChatRead extends ChatThread {
  send?: "pending" | "done" | "failed";
  personality?: string;
  /** Hold-to-talk is on (the shop has a voice service): the page draws the button; without it there is none, not a hidden one. */
  listen?: true;
}

/**
 * The guest's thread: the shop's lines (the outbox) and the guest's own, in order, after `after` (0: all). Only the latest shop line carries its choices (an older
 * line's buttons are no longer on offer to draw). An unknown guest has an empty thread: the same answer for a guest never seen and for one at another shop, so a
 * made-up handle learns nothing.
 */
export function chatThread(state: ChannelState | undefined, hash: string, o: { after?: number; retentionDays: number; now: number; dayKey: string; /** the shop's budget: its per-guest daily turns (guestTurnsPerDay) */ budget?: BudgetConfig }): ChatThread {
  const conversation = chatConversationOf(hash);
  const guest = state?.chat?.[conversation];
  const shop = (state?.outbox ?? []).filter((m) => m.to === conversation);
  const lines: ChatLine[] = [
    ...shop.map((m) => ({ n: numberOf(m.id), who: "shop" as const, text: m.text, atMs: m.atMs, ...(m.choices ? { choices: m.choices } : {}), ...(m.moment ? { moment: m.moment } : {}) })),
    ...(guest?.said ?? []).map((m) => ({ n: numberOf(m.id), who: "you" as const, text: m.text, atMs: m.atMs, cid: m.cid })),
  ].sort((a, b) => a.n - b.n);
  const last = lines.at(-1);
  const out = lines.filter((l) => l.n > (o.after ?? 0)).map((l) => (l === last ? l : { n: l.n, who: l.who, text: l.text, atMs: l.atMs, ...(l.cid ? { cid: l.cid } : {}), ...(l.moment ? { moment: l.moment } : {}) }));
  return { lines: out, answered: shop.length > 0, capped: guest !== undefined && guest.day === o.dayKey && guest.turns >= guestTurnsPerDay(o.budget), retentionDays: o.retentionDays };
}

/**
 * W2, "delete my chat": the thread's words go, the guest's own lines and the shop's lines to it, with the day's counts. The runtime's HTTP layer has already taken the guest's passkeys,
 * number and ties away (chat-identity.ts forget) and the alert subscriptions; the record keeps its digests and the bookings and payments keep what the law needs (a booking or an order
 * is the shop's own, not the chat's). A booking that finishes later may still write one line to this conversation; nothing reads it (the cookie is cleared, so the guest's hash is
 * never asked for again) and the retention takes it off with the rest.
 */
export function forgetChat(state: ChannelState, conversation: string): void {
  if (state.chat) { delete state.chat[conversation]; if (Object.keys(state.chat).length === 0) delete state.chat; }
  state.outbox = state.outbox.filter((m) => m.to !== conversation);
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
  /** Hold-to-talk: the recording a send's `voice` reference names, from the runtime's memory (templates' runtime.ts chatAudio). Left out: the shop has no voice service. */
  audio?(ref: string): PageAudio | undefined;
  /** The shop's model budget (policy.budget): where one guest's daily model turns are read from (guestTurnsPerDay). */
  budget?: BudgetConfig;
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
  if (e.forget) { forgetChat(d.state, conversation); return "done"; } // before anything is made or counted: a deleted chat leaves no guest behind
  const day = chatDay(d.now, d.timeZone);
  const guest = ((d.state.chat ??= {})[conversation] ??= newGuest(d.now, day));
  if (guest.said.some((m) => m.cid === e.id)) return "repeat";
  if (guest.day !== day) { guest.day = day; guest.turns = 0; guest.messages = 0; }
  if (guest.messages >= CHAT_LIMITS.messagesPerDay) return "refused";

  let text = "";
  let say: string;
  let reply: InboundMessage["reply"];
  if (e.voice !== undefined) {
    // hold-to-talk: the bubble says "Voice message" until the agent's own listener has heard it (onHeard below puts the words in), so the guest never sees a blank
    say = CHAT_MORE[e.language].voiceNote;
  } else if (e.tap !== undefined) {
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

  const line = { id: `ch-${++d.state.seq}`, cid: e.id, text: say, atMs: d.now };
  guest.said.push(line);
  if (guest.said.length > CHAT_THREAD_MAX) guest.said.splice(0, guest.said.length - CHAT_THREAD_MAX);
  guest.messages++;
  guest.lastMs = d.now;
  guest.n ??= nextGuestNumber(d.state); // the owner's name for this guest, "Chat guest 3" (chat-guest.ts), given once at the first send
  d.setLanguage(conversation, e.language);

  const capped = guest.turns >= guestTurnsPerDay(d.budget);
  const before = modelCalls(d.ai, d.now, d.timeZone);
  // a recording is listened to only while the day's model turns last, and always counts as one of them (listening is paid, whatever the words then need); a capped guest's recording is not
  // handed over, so the agent answers it as it answers a note it could not use: with the line asking them to type
  const audio = e.voice !== undefined && !capped ? d.audio?.(e.voice) : undefined;
  await d.run({
    id: `${conversation}:${e.id}`, from: conversation, text: reply ? "" : text, timestamp: d.now, ...(reply ? { reply } : {}), ...(capped && !reply ? { noModel: true as const } : {}),
    ...(e.voice !== undefined ? { voiceNote: true as const, ...(audio ? { audio, onHeard: (heard: string) => { line.text = [...heard.trim()].slice(0, CHAT_TEXT_MAX).join("") || say; } } : {}) } : {}),
  });
  if (!reply && ((e.voice !== undefined && audio !== undefined) || modelCalls(d.ai, d.now, d.timeZone) > before)) guest.turns++;
  return "done";
}

/**
 * May the shop tell the owner (on WhatsApp) about this chat guest now? At most `pingsPerDay` times a guest a day, counted in the saved state, so fresh handles cannot make the
 * owner's phone ring without end and a restart does not forget the count. Counts the ping when it says yes. Anything that is not a chat guest is not limited here.
 */
export const GUEST_PINGS: readonly string[] = ["owner_wants_to_talk", "owner_opted_out", "owner_upi_expected", "owner_upi_claim"];

/**
 * The gate a template's say runs for a message to the owner about a chat guest: the owner notices a guest can start (they asked to talk, sent STOP, a UPI hold was made, they
 * say they paid) are bounded per guest per day. Work the owner must see anyway (a refund, a payment already marked) is not in the list and is never held here; the owner's page
 * lists every deposit and request whatever this says. Returns the decision to add to the message's gates, or nothing.
 */
export function chatPingGate(state: ChannelState | undefined, a: { to: string; phone: string; templates: readonly string[] }, now: number, timeZone: string): Decision[] {
  if (a.to !== "owner" || !isChatConversation(a.phone) || !a.templates.some((t) => GUEST_PINGS.includes(t))) return [];
  return chatMayPing(state, a.phone, now, timeZone) ? [] : [block("chat-pings-per-guest", `this chat guest has already made the shop tell the owner ${CHAT_LIMITS.pingsPerDay} times today; no more today (the owner's page still lists whatever waits for them)`)];
}

export function chatMayPing(state: ChannelState | undefined, conversation: string, now: number, timeZone: string): boolean {
  const guest = state?.chat?.[conversation];
  if (!guest) return true;
  const day = chatDay(now, timeZone);
  if (guest.pingDay !== day) { guest.pingDay = day; guest.pings = 0; }
  if ((guest.pings ?? 0) >= CHAT_LIMITS.pingsPerDay) return false;
  guest.pings = (guest.pings ?? 0) + 1;
  return true;
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
