// The messaging a template's agent is given when the shop has channels: a message to a channel's conversation ("web:...", "mcp:...") is kept in the step's store, for that
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
import type { Clock } from "../core/clock.ts";
import { ApiError } from "../core/faults.ts";
import type { Messaging, OutboundMessage } from "../messaging/messaging.ts";
import { isChannelConversation } from "./handle.ts";
import { OUTBOX_PER_CONVERSATION } from "./state.ts";
import type { ChannelState } from "./state.ts";

export function channelMessaging(base: Messaging | undefined, state: () => ChannelState, clock: Clock): Messaging {
  /** Keep the message; the conversation keeps its latest OUTBOX_PER_CONVERSATION. */
  function keep(to: string, kind: OutboundMessage["kind"], text: string): OutboundMessage {
    const s = state();
    const message = { id: `ch-${++s.seq}`, to, text, atMs: clock.now() };
    s.outbox.push(message);
    const mine = s.outbox.filter((m) => m.to === to);
    if (mine.length > OUTBOX_PER_CONVERSATION) { const drop = new Set(mine.slice(0, mine.length - OUTBOX_PER_CONVERSATION)); s.outbox = s.outbox.filter((m) => !drop.has(m)); }
    return { id: message.id, to, kind, text, sentAt: message.atMs, afterOptOut: false };
  }
  const noWhatsApp = () => new ApiError(400, "This shop has no WhatsApp number yet, so nothing was sent; the owner's page shows what waits for them.");
  const find = (id: string): OutboundMessage | null => {
    const m = state().outbox.find((x) => x.id === id);
    return m ? { id: m.id, to: m.to, kind: "text", text: m.text, sentAt: m.atMs, afterOptOut: false } : null;
  };

  const messaging: Messaging = {
    async sendText(to, text) { if (isChannelConversation(to)) return keep(to, "text", text); if (!base) throw noWhatsApp(); return base.sendText(to, text); },
    // a channel's page has no approved templates and no 24-hour window: the words alone are kept
    async sendTemplate(to, template) { if (isChannelConversation(to)) return keep(to, "text", template.text); if (!base) throw noWhatsApp(); return base.sendTemplate(to, template); },
    // buttons and lists are WhatsApp's: the page has its own, so only the words above them are kept
    async sendInteractive(to, message) {
      if (isChannelConversation(to)) return keep(to, "text", message.body);
      if (!base) throw noWhatsApp();
      if (!base.sendInteractive) throw new ApiError(400, "This WhatsApp provider has no buttons.");
      return base.sendInteractive(to, message);
    },
    // a channel's page draws its own QR code from the payment link, so a picture is not kept
    async isWindowOpen(to) { return isChannelConversation(to) ? true : base ? base.isWindowOpen(to) : false; },
    async getMessage(id) { return id.startsWith("ch-") ? find(id) : base ? base.getMessage(id) : null; },
  };
  if (base?.sendDocument) messaging.sendDocument = (to, doc) => (isChannelConversation(to) ? Promise.reject(new ApiError(400, "A booking page takes no documents.")) : base.sendDocument!(to, doc));
  if (base?.sendImage) messaging.sendImage = (to, image) => (isChannelConversation(to) ? Promise.reject(new ApiError(400, "A booking page draws its own QR code.")) : base.sendImage!(to, image));
  if (base?.ping) messaging.ping = () => base.ping!();
  return messaging;
}
