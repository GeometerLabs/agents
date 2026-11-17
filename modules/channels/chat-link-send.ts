// Sending a customer the one link they asked for, through the shop's own WhatsApp (W2, 17 Nov 2026). Two uses, both the customer's own asking on the chat page:
//   recover   "I have a new phone": the number they type is looked up among the numbers customers gave (chat-identity.ts); if a thread has it, a one-use link that opens that
//             thread on the new phone goes to that number, as the utility template `chat_new_phone`;
//   links     "Send me my booking link": the shop's own page links already in this thread (a booking's or an order's own page) go to the number this thread gave, as `chat_my_link`.
// It is the core's, like the owner's sign-in (owner-signin.ts): the runtime's HTTP layer makes the event (the front's channel token cannot), the core hands it here before the
// agent sees it, so it changes no booking and the record shows each send. Why a step and not the HTTP route: only a step may write the record, and it has the shop's messaging.
//
// What is kept out on purpose: the link's token is never written (the record's line names its short id), the number is never written (the record's conversation is the thread's
// own "chat:" name), the answer to the customer is the same whether or not a thread has the number (the route says it, so nobody can learn which numbers a shop knows), a number that
// said STOP is not written to, and a shop with no WhatsApp sends nothing. The template path is used because the customer's WhatsApp window is usually closed: a utility template
// is the only message WhatsApp carries then (chat-link-templates.json lists both for Meta; Hindi, Malayalam and Kannada wait for a native reader).
import type { Clock } from "../core/clock.ts";
import { fillBody, metaBody } from "../language/meta-templates.ts";
import type { Language } from "../language/languages.ts";
import type { Messaging, OutboundMessage } from "../messaging/messaging.ts";
import { whatsappOf } from "../push/push.ts";
import type { ActionRecord, Outcome } from "../record/record.ts";
import { nothingWasSent } from "../report/monthly-job.ts";
import type { ChatIdentity } from "./chat-identity.ts";
import { chatConversationOf } from "./conversation.ts";
import type { PagesFile } from "./pages-file.ts";
import type { ChannelState } from "./state.ts";
import { CHAT_LINK_TEMPLATES } from "./words-chat-identity.ts";

/** The runtime's own event for a link to send. Never from outside: the front's channel token can send only the channel events. */
export interface ChatLinkEvent { kind: "chat_link"; id: string; what: "recover" | "links"; language: Language; /** recover: the number asked for (digits). */ phone?: string; /** links: the thread's hash. */ handle?: string }

export interface ChatLinksSetup { identity: ChatIdentity; pages: () => PagesFile | undefined; shopName: string; clock: Clock; log?: (line: string) => void }

/** The most links one "send me my booking link" carries. */
export const LINKS_AT_MOST = 3;

const body = (name: string, language: Language): string => CHAT_LINK_TEMPLATES.find((t) => t.name === name)!.bodies[language];

/** Has the person at this number said STOP to the shop? Every template keeps its customers by number, with `optedOut`. */
function stopped(store: unknown, digits: string): boolean {
  const customers = (store as { customers?: Map<string, { optedOut?: boolean }> }).customers;
  return [digits, `+${digits}`].some((k) => customers?.get?.(k)?.optedOut === true);
}

export function createChatLinks(setup: ChatLinksSetup) {
  const { identity, clock } = setup;
  const log = setup.log ?? (() => undefined);

  /** The shop's own page links in a thread's lines (a booking's or an order's page), the latest few, oldest first. Nothing else a line may carry (a payment link) is sent again. */
  function pageLinks(store: unknown, conversation: string, pages: PagesFile): string[] {
    const mine = [pages.url, pages.base].filter((x): x is string => x !== undefined).map((x) => `${x}/`);
    const seen: string[] = [];
    for (const m of (store as { channel?: ChannelState }).channel?.outbox ?? []) {
      if (m.to !== conversation) continue;
      for (const url of m.text.match(/https:\/\/[^\s<>"]+/gu) ?? []) {
        const clean = url.replace(/[.,;)]+$/u, "");
        if (mine.some((p) => clean.startsWith(p)) && !clean.includes("/chat/") && !seen.includes(clean)) seen.push(clean);
      }
    }
    return seen.slice(-LINKS_AT_MOST);
  }

  async function sendTemplate(wa: Messaging, to: string, name: string, language: Language, values: string[]): Promise<{ sent?: OutboundMessage; outcome: Outcome; note?: string }> {
    let sent: OutboundMessage | undefined;
    try {
      sent = await wa.sendTemplate(to, { name, language, text: fillBody(metaBody(body(name, language)), values), parameters: values });
      return { sent, outcome: (await wa.getMessage(sent.id)) ? "confirmed" : "unconfirmed" };
    } catch (e) {
      return { ...(sent ? { sent } : {}), outcome: !sent && nothingWasSent(e) ? "failed" : "unconfirmed", note: (e as Error).message };
    }
  }

  return {
    takes: (event: { kind: string }): boolean => event.kind === "chat_link",

    /**
     * On the clock's beat: what the identity file keeps past its use goes (chat-identity.ts purge), and a thread the shop has cleared (its words went with the conversation
     * retention, chat.ts compactChannel) takes its keys, number and ties with it. Without the shop's state (a caller that has none) no thread is dropped.
     */
    tick: (ctx?: { store?: unknown }): void => {
      identity.purge(clock.now());
      const chat = ctx?.store === undefined ? undefined : ((ctx.store as { channel?: ChannelState }).channel?.chat ?? {});
      if (chat) identity.dropGone((thread) => chatConversationOf(thread) in chat);
    },

    async run(event: ChatLinkEvent, ctx: { messaging: Messaging; record: ActionRecord; store: unknown }): Promise<void> {
      const now = clock.now();
      const pages = setup.pages();
      const wa = whatsappOf(ctx.messaging);
      if (!pages || !wa) { log("A chat link was asked for, but this shop has no pages file or no WhatsApp: none was sent."); return; }
      const base = pages.url ?? pages.base;

      if (event.what === "recover") {
        const guest = event.phone ? identity.guestOfNumber(event.phone) : undefined;
        if (!guest || !event.phone) { log("A new-phone link was asked for a number no chat gave: none was sent."); return; }
        if (stopped(ctx.store, event.phone)) { log("A new-phone link was asked for a number that said STOP: none was sent."); return; }
        const link = identity.issueLink(guest, now);
        const r = await sendTemplate(wa, `+${event.phone}`, "chat_new_phone", event.language, [setup.shopName, `${base}/chat/id/back/${link.token}`]);
        if (r.outcome === "failed") identity.linkUnsent(link.id); // nobody has it: it can never be used
        ctx.record.append({ conversation: chatConversationOf(guest), action: "chat_link", outcome: r.outcome, inputs: { what: "recover", link: link.id }, language: event.language, ...(r.note ? { notes: r.note } : {}), refs: { to: "customer", what: "recover", link: link.id, ...(r.sent ? { messageId: r.sent.id } : {}) } });
        return;
      }

      const guest = event.handle ? identity.resolve(event.handle) : undefined;
      const number = guest ? identity.numberOf(guest) : undefined;
      if (!guest || !number) { log("A booking link was asked for by a chat that gave no number: none was sent."); return; }
      if (stopped(ctx.store, number)) { log("A booking link was asked for a number that said STOP: none was sent."); return; }
      const conversation = chatConversationOf(guest);
      const links = pageLinks(ctx.store, conversation, pages);
      if (links.length === 0) { ctx.record.append({ conversation, action: "chat_link", outcome: "blocked", inputs: { what: "links" }, language: event.language, notes: "The thread has no booking or order page link to send again.", refs: { to: "customer", what: "links" } }); return; }
      for (const url of links) {
        const r = await sendTemplate(wa, `+${number}`, "chat_my_link", event.language, [setup.shopName, url]);
        ctx.record.append({ conversation, action: "chat_link", outcome: r.outcome, inputs: { what: "links" }, language: event.language, ...(r.note ? { notes: r.note } : {}), refs: { to: "customer", what: "links", ...(r.sent ? { messageId: r.sent.id } : {}) } });
      }
    },
  };
}
export type ChatLinks = ReturnType<typeof createChatLinks>;

/**
 * The owner's sign-in with the chat links added: the core already hands the sign-in its own events before the agent, so one object takes both, and no template has to pass a second
 * thing along. (An event the owner's sign-in does not know is not changed by this.)
 */
export function withChatLinks<S extends { takes(event: { kind: string; message?: unknown }): boolean; run(event: never, ctx: never): Promise<void> }>(signin: S, links: ChatLinks): S {
  return {
    ...signin,
    tick: (ctx: { store?: unknown }) => { links.tick(ctx); (signin as unknown as { tick?(c: unknown): void }).tick?.(ctx); },
    takes: (event: { kind: string; message?: unknown }) => links.takes(event) || signin.takes(event),
    run: (event: { kind: string }, ctx: { messaging: Messaging; record: ActionRecord; store: unknown }) => (event.kind === "chat_link" ? links.run(event as ChatLinkEvent, ctx) : (signin.run as (e: unknown, c: unknown) => Promise<void>)(event, ctx)),
  } as S;
}
