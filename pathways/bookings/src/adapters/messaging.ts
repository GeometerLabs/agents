// Messaging: WhatsApp-shaped (inbound messages with ids, an outbox, the 24-hour window, approved templates, STOP).
// The fake's outbox is the independent witness for "nothing was sent after STOP" and "the message says what the record says".
import type { Clock } from "../clock.ts";
import { HOUR } from "../time.ts";
import type { Language } from "../settings.ts";
import { ApiError, TimeoutError, WindowClosedError, createFaults } from "./faults.ts";
import type { FaultOptions } from "./faults.ts";

export interface InboundMessage {
  id: string; // WhatsApp's message id (wamid...): the same id arriving twice is a duplicate delivery
  from: string; // E.164 number, for example +919811111111
  text: string;
  timestamp: number; // epoch ms
}

export interface OutboundMessage {
  id: string;
  to: string;
  kind: "text" | "template";
  text: string;
  templateName?: string;
  language?: Language;
  sentAt: number;
  /** True when the fake had already seen this person send STOP. A correct agent never produces one. */
  afterOptOut: boolean;
}

export interface TemplateMessage { name: string; language: Language; text: string }

export interface Messaging {
  /** Free-form text. Only allowed while the customer's 24-hour window is open. */
  sendText(to: string, text: string): Promise<OutboundMessage>;
  /** A pre-approved template; the only way to start a conversation after the window has closed. */
  sendTemplate(to: string, template: TemplateMessage): Promise<OutboundMessage>;
  /** Did this person message us in the last 24 hours? */
  isWindowOpen(to: string): Promise<boolean>;
  getMessage(id: string): Promise<OutboundMessage | null>;
}

/** lostReply: the message goes out, the reply is lost. error: the provider refuses. */
export type MessagingFault = "lostReply" | "error";
export type MessagingOp = "sendText" | "sendTemplate";

export interface FakeMessaging extends Messaging {
  /** A person sends us a message (this opens their window). Pass the same `id` again, or call deliver twice, for a duplicate. */
  receive(from: string, text: string, options?: { id?: string }): InboundMessage;
  outbox(): OutboundMessage[];
  sentTo(number: string): OutboundMessage[];
  isOptedOut(number: string): boolean;
  /** Which templates the provider has approved, as "name:language". */
  approve(name: string, language: Language): void;
  inject(op: MessagingOp, mode: MessagingFault, options?: FaultOptions): void;
}

export function createFakeMessaging(clock: Clock): FakeMessaging {
  const outbox: OutboundMessage[] = [];
  const lastInbound = new Map<string, number>();
  const optedOut = new Set<string>();
  const approved = new Set<string>();
  const faults = createFaults<MessagingOp, MessagingFault>();
  let inboundSeq = 1;
  let outboundSeq = 1;

  const windowOpen = (to: string) => {
    const last = lastInbound.get(to);
    return last !== undefined && clock.now() - last < 24 * HOUR;
  };

  function store(message: Omit<OutboundMessage, "id" | "sentAt" | "afterOptOut">): OutboundMessage {
    const m: OutboundMessage = { ...message, id: `wamid.out_${outboundSeq++}`, sentAt: clock.now(), afterOptOut: optedOut.has(message.to) };
    outbox.push(m);
    return m;
  }

  return {
    inject: faults.inject,
    outbox: () => outbox.map((m) => ({ ...m })),
    sentTo: (number) => outbox.filter((m) => m.to === number).map((m) => ({ ...m })),
    isOptedOut: (number) => optedOut.has(number),
    approve: (name, language) => { approved.add(`${name}:${language}`); },

    receive(from, text, options = {}) {
      lastInbound.set(from, clock.now());
      if (text.trim().toUpperCase() === "STOP") optedOut.add(from);
      return { id: options.id ?? `wamid.in_${inboundSeq++}`, from, text, timestamp: clock.now() };
    },

    async sendText(to, text) {
      const fault = faults.take("sendText");
      if (fault === "error") throw new ApiError(500, "The provider could not take the message.");
      if (!windowOpen(to)) throw new WindowClosedError();
      const m = store({ to, kind: "text", text });
      if (fault === "lostReply") throw new TimeoutError("send message");
      return { ...m };
    },

    async sendTemplate(to, template) {
      const fault = faults.take("sendTemplate");
      if (fault === "error") throw new ApiError(500, "The provider could not take the message.");
      if (!approved.has(`${template.name}:${template.language}`)) throw new ApiError(400, `The template ${template.name} (${template.language}) is not approved.`);
      const m = store({ to, kind: "template", text: template.text, templateName: template.name, language: template.language });
      if (fault === "lostReply") throw new TimeoutError("send template");
      return { ...m };
    },

    async isWindowOpen(to) { return windowOpen(to); },
    async getMessage(id) {
      const m = outbox.find((x) => x.id === id);
      return m ? { ...m } : null;
    },
  };
}
