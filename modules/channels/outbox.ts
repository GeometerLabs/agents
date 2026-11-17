// The messaging a template's agent is given when the shop has channels: a message to a channel's conversation ("web:...", "mcp:...", and W1's guest chats "chat:...") is kept in the step's store, for that
// booking's page and API to show; any other message goes to the shop's WhatsApp, as before. Used by a template's runtime (Bookings: server/runtime.ts), which builds it
// over each step's own store, so the message is saved whole or not at all with the step.
//
// Why: everything the agent says goes through one `say` (modules/messaging/say.ts), which renders the words from the record, runs the limits on them (message matches
// record, "booked" only when recorded, STOP) and reads the message back. Keeping that one exit for web customers means the words on the booking page are the same checked
// words a WhatsApp customer gets, and no money sentence is written twice. And a number typed on a web form is never messaged on WhatsApp: a fake booking cannot make
// the shop message a stranger, at the shop's cost.
//
// `base` left out: the shop has no WhatsApp (yet). A message to a WhatsApp number is then refused as definitely not sent (the record says "failed"), and the owner sees
// what waits for them on their private approvals page (modules/channels/owner-page.ts), which is built from the saved state, never from messages.
//
// Item 11h: `onKeep` is told of each message kept for a page's conversation, so a customer who allowed alerts on that page gets the same words as a web push
// (modules/push/push.ts `customer`). It is told after the message is kept, and what it does cannot fail the send.
import type { Clock } from "../core/clock.ts";
import { ApiError } from "../core/faults.ts";
import type { Messaging, OutboundMessage } from "../messaging/messaging.ts";
import type { InteractiveMessage } from "../language/interactive.ts";
import { isChannelConversation, isChatConversation } from "./conversation.ts";
import { CHAT_THREAD_MAX, OUTBOX_PER_CONVERSATION } from "./state.ts";
import type { ChannelState, ChatChoice } from "./state.ts";

/** The buttons or the list rows of an interactive message, as a chat thread keeps them (W1): the page draws them as tiles and a tap is checked against them. */
export function choicesOf(m: InteractiveMessage): ChatChoice[] {
  if (m.buttons) return m.buttons.map((b) => ({ id: b.id, title: b.title }));
  return (m.list?.rows ?? []).map((r) => ({ id: r.id, title: r.title, ...(r.description ? { hint: r.description } : {}), list: true as const }));
}

export function channelMessaging(base: Messaging | undefined, state: () => ChannelState, clock: Clock, onKeep?: (to: string, text: string) => void): Messaging {
  /** Keep the message; the conversation keeps its latest OUTBOX_PER_CONVERSATION. */
  function keep(to: string, kind: OutboundMessage["kind"], text: string, choices?: ChatChoice[]): OutboundMessage {
    const s = state();
    // W1: only a chat thread keeps the choices (a booking's page draws its own buttons), and it keeps more lines than a booking's page does
    const message = { id: `ch-${++s.seq}`, to, text, atMs: clock.now(), ...(choices && choices.length > 0 && isChatConversation(to) ? { choices } : {}) };
    s.outbox.push(message);
    const mine = s.outbox.filter((m) => m.to === to);
    const cap = isChatConversation(to) ? CHAT_THREAD_MAX : OUTBOX_PER_CONVERSATION;
    if (mine.length > cap) { const drop = new Set(mine.slice(0, mine.length - cap)); s.outbox = s.outbox.filter((m) => !drop.has(m)); }
    try { onKeep?.(to, text); } catch { /* an alert that could not be queued never fails the page's message */ }
    return { id: message.id, to, kind, text, sentAt: message.atMs, afterOptOut: false };
  }
  const noWhatsApp = () => new ApiError(400, "This shop has no WhatsApp number yet, so nothing was sent; the owner's page shows what waits for them.");
  const find = (id: string): OutboundMessage | null => {
    if (id === "ch-0") return { id, to: "", kind: "image", text: "", sentAt: clock.now(), afterOptOut: false }; // the chat's skipped picture (sendImage below)
    const m = state().outbox.find((x) => x.id === id);
    return m ? { id: m.id, to: m.to, kind: "text", text: m.text, sentAt: m.atMs, afterOptOut: false } : null;
  };

  const messaging: Messaging = {
    async sendText(to, text) { if (isChannelConversation(to)) return keep(to, "text", text); if (!base) throw noWhatsApp(); return base.sendText(to, text); },
    // a channel's page has no approved templates and no 24-hour window: the words alone are kept
    async sendTemplate(to, template) { if (isChannelConversation(to)) return keep(to, "text", template.text); if (!base) throw noWhatsApp(); return base.sendTemplate(to, template); },
    // buttons and lists are WhatsApp's: a booking's page has its own, so only the words above them are kept; a chat thread keeps the choices too, to draw them as taps
    async sendInteractive(to, message) {
      if (isChannelConversation(to)) return keep(to, "text", message.body, choicesOf(message));
      if (!base) throw noWhatsApp();
      if (!base.sendInteractive) throw new ApiError(400, "This WhatsApp provider has no buttons.");
      return base.sendInteractive(to, message);
    },
    // a channel's page draws its own QR code from the payment link, so a picture is not kept
    async isWindowOpen(to) { return isChannelConversation(to) ? true : base ? base.isWindowOpen(to) : false; },
    async getMessage(id) { return id.startsWith("ch-") ? find(id) : base ? base.getMessage(id) : null; },
  };
  if (base?.sendDocument) messaging.sendDocument = (to, doc) => (isChannelConversation(to) ? Promise.reject(new ApiError(400, "A booking page takes no documents.")) : base.sendDocument!(to, doc));
  // a chat draws no picture either: the booking's own page, whose address the message carries, has the QR code. The send is answered as done and keeps nothing, so a UPI hold made
  // in a chat does not log a failed picture; a booking page's conversation still refuses it.
  if (base?.sendImage) messaging.sendImage = (to, image) => (isChatConversation(to) ? Promise.resolve({ id: "ch-0", to, kind: "image", text: "", sentAt: clock.now(), afterOptOut: false }) : isChannelConversation(to) ? Promise.reject(new ApiError(400, "A booking page draws its own QR code.")) : base.sendImage!(to, image));
  if (base?.ping) messaging.ping = () => base.ping!();
  return messaging;
}
