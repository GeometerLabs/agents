// Messaging: WhatsApp-shaped (inbound messages with ids, an outbox, the 24-hour window, approved templates, STOP).
// The fake's outbox is the independent witness for "nothing was sent after STOP" and "the message says what the record says".
import type { Clock } from "../core/clock.ts";
import { HOUR } from "../core/time.ts";
import type { Language } from "../language/languages.ts";
import { interactiveText } from "../language/interactive.ts";
import type { InteractiveMessage } from "../language/interactive.ts";
import { ApiError, TimeoutError, WindowClosedError, createFaults } from "../core/faults.ts";
import type { FaultOptions } from "../core/faults.ts";

export interface InboundMessage {
  id: string; // WhatsApp's message id (wamid...): the same id arriving twice is a duplicate delivery
  from: string; // E.164 number, for example +919811111111
  text: string; // empty for a voice note
  timestamp: number; // epoch ms
  /**
   * True when the customer sent a voice note or an audio file instead of words. Only the fact is carried: the audio is never fetched or kept,
   * and no media id or link travels with the message. The agent answers it with one plain line asking the customer to type (plan B29 is the real voice module).
   */
  voiceNote?: true;
  /**
   * True when the person sent a picture (a screenshot of a payment, say) instead of words. Like a voice note, only the fact is carried: the picture is never fetched,
   * looked at or kept, and no media id travels with the message. A picture is never proof of anything to the agent.
   */
  image?: true;
  /**
   * Set when the customer tapped a button or a list row instead of writing: the id that row had when we sent it (language/interactive.ts), and which kind it was.
   * `text` is the row's title, as WhatsApp sends it. The agent looks the id up and reads no words, so no model is asked.
   */
  reply?: { id: string; kind: "button" | "list" };
}

/**
 * What WhatsApp said LATER about a message we sent (a status webhook, read by webhooks.ts parseWhatsAppStatuses): it reached the person's phone, they read it, or it
 * failed and never arrived. The send call's own answer is only "accepted" and is none of these. Only these three are kept: "sent" and Gupshup's "enqueued" say no
 * more than the accepted send did.
 */
export interface MessageStatus {
  /**
   * The ids the report gives the message, most specific first: Meta's wamid, or Gupshup's own id (`gs_id`) and then the other id it sends. The record is searched
   * for any of them: the send call's reply gave one, and Gupshup's examples disagree about which field repeats it.
   */
  ids: string[];
  status: "delivered" | "read" | "failed";
  /** The person it was for, E.164, when the report names them. */
  to?: string;
  /** When WhatsApp says it happened, epoch ms. */
  timestamp: number;
  /** "failed" only: the provider's code (131047: the 24-hour window had closed) and its short title. Never the message's words. */
  error?: { code?: number; title?: string };
}

export interface OutboundMessage {
  id: string;
  to: string;
  kind: "text" | "template" | "interactive" | "document" | "image";
  /** For an interactive message, the body and then each option on its own line (interactiveText): what the outgoing check read. */
  text: string;
  /** Interactive only: the buttons or the list that went with the body. */
  interactive?: InteractiveMessage;
  /** Document only: the file WhatsApp was asked to fetch and show (`text` is its caption, or its file name). */
  document?: DocumentMessage;
  /** Image only: the picture WhatsApp was asked to fetch and show (`text` is its caption). */
  image?: ImageMessage;
  templateName?: string;
  language?: Language;
  sentAt: number;
  /** True when the fake had already seen this person send STOP. A correct agent never produces one. */
  afterOptOut: boolean;
  /** Live only: what the provider said when it took the message ("accepted", or "held_for_quality_assessment"). Taken is not delivered. */
  acceptedAs?: string;
}

/**
 * `text` is the whole rendered message (what the outgoing check read, and all the fake needs). A real provider sends the approved
 * template `name` with the numbered `parameters` ({{1}}, {{2}} ...) instead, and its approved wording must come out as `text`.
 */
export interface TemplateMessage { name: string; language: Language; text: string; parameters?: string[] }

/**
 * A file sent by its address: WhatsApp fetches `link` itself (it must be https and reachable from the internet) and shows it under `filename`. WhatsApp accepts only
 * some file types as documents (PDF, plain text, Word, Excel, PowerPoint; not HTML), so the caller sends a type from that list. A session message, like free text.
 */
export interface DocumentMessage { link: string; filename: string; caption?: string }

/** Why a document cannot be sent, in plain words, or null. Checked before anything goes out (WhatsApp: https link, a caption up to 1024 characters). */
export function documentProblem(doc: DocumentMessage): string | null {
  if (!/^https:\/\/[^\s]+$/u.test(doc.link)) return "the link must start with https:// and hold no spaces";
  if (doc.filename.trim() === "" || doc.filename.length > 240 || /[\\/\n\r]/u.test(doc.filename)) return "the file name must be 1 to 240 characters with no slash or line break";
  if (doc.caption !== undefined && (doc.caption.length > 1024 || doc.caption.trim() === "")) return "the caption must be 1 to 1024 characters, or left out";
  return null;
}

/**
 * A picture sent by its address, like a document: WhatsApp fetches `link` itself (https, reachable from the internet) and shows it with the caption. A PNG or a
 * JPEG of at most 5 MB. A session message, like free text: only while the person's 24-hour window is open. (A UPI QR code goes this way: modules/payments/owner-marked/qr-image.ts.)
 */
export interface ImageMessage { link: string; caption?: string }

/** Why an image cannot be sent, in plain words, or null. Checked before anything goes out (WhatsApp: https link, a caption up to 1024 characters). */
export function imageProblem(image: ImageMessage): string | null {
  if (!/^https:\/\/[^\s]+$/u.test(image.link)) return "the link must start with https:// and hold no spaces";
  if (image.caption !== undefined && (image.caption.length > 1024 || image.caption.trim() === "")) return "the caption must be 1 to 1024 characters, or left out";
  return null;
}

export interface Messaging {
  /** Free-form text. Only allowed while the customer's 24-hour window is open. */
  sendText(to: string, text: string): Promise<OutboundMessage>;
  /** A pre-approved template; the only way to start a conversation after the window has closed. */
  sendTemplate(to: string, template: TemplateMessage): Promise<OutboundMessage>;
  /**
   * Reply buttons (up to 3) or a list (up to 10 rows). Like free text, only while the customer's 24-hour window is open. Optional: a provider without it gets the
   * same message as plain text, with the options written out.
   */
  sendInteractive?(to: string, message: InteractiveMessage): Promise<OutboundMessage>;
  /** A file by its address (see DocumentMessage). Like free text, only while the customer's 24-hour window is open. Optional: a provider without it is simply not asked. */
  sendDocument?(to: string, doc: DocumentMessage): Promise<OutboundMessage>;
  /** A picture by its address (see ImageMessage). Like free text, only while the person's 24-hour window is open. Optional: a provider without it is not asked, and the words go alone. */
  sendImage?(to: string, image: ImageMessage): Promise<OutboundMessage>;
  /** Did this person message us in the last 24 hours? */
  isWindowOpen(to: string): Promise<boolean>;
  getMessage(id: string): Promise<OutboundMessage | null>;
  /**
   * A plain read that reaches this service's Guard and changes nothing, so a task waiting for it can ask whether it is back (runtime/guard-wait.ts). `getMessage` cannot be
   * the read: on the live adapter it answers from memory and never reaches Guard. Optional: a provider without it is looked at by running the step.
   */
  ping?(): Promise<unknown>;
}

/** lostReply: the message goes out, the reply is lost. error: the provider refuses. */
export type MessagingFault = "lostReply" | "error";
export type MessagingOp = "sendText" | "sendTemplate" | "sendInteractive" | "sendDocument" | "sendImage";

export interface FakeMessaging extends Messaging {
  sendInteractive(to: string, message: InteractiveMessage): Promise<OutboundMessage>;
  sendDocument(to: string, doc: DocumentMessage): Promise<OutboundMessage>;
  sendImage(to: string, image: ImageMessage): Promise<OutboundMessage>;
  /** A person sends us a message (this opens their window). Pass the same `id` again, or call deliver twice, for a duplicate. `image`: they sent a picture (its words, if any, are `text`). */
  receive(from: string, text: string, options?: { id?: string; reply?: { id: string; kind: "button" | "list" }; image?: boolean }): InboundMessage;
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
      return { id: options.id ?? `wamid.in_${inboundSeq++}`, from, text, timestamp: clock.now(), ...(options.reply ? { reply: options.reply } : {}), ...(options.image ? { image: true as const } : {}) };
    },

    async sendText(to, text) {
      const fault = faults.take("sendText");
      if (fault === "error") throw new ApiError(500, "The provider could not take the message.");
      if (!windowOpen(to)) throw new WindowClosedError();
      const m = store({ to, kind: "text", text });
      if (fault === "lostReply") throw new TimeoutError("send message");
      return { ...m };
    },

    async sendInteractive(to, message) {
      const fault = faults.take("sendInteractive");
      if (fault === "error") throw new ApiError(500, "The provider could not take the message.");
      if (!windowOpen(to)) throw new WindowClosedError();
      const m = store({ to, kind: "interactive", text: interactiveText(message), interactive: structuredClone(message) });
      if (fault === "lostReply") throw new TimeoutError("send interactive message");
      return { ...m };
    },

    async sendDocument(to, doc) {
      const fault = faults.take("sendDocument");
      if (fault === "error") throw new ApiError(500, "The provider could not take the message.");
      if (!windowOpen(to)) throw new WindowClosedError();
      const problem = documentProblem(doc);
      if (problem) throw new ApiError(400, `The document cannot be sent: ${problem}.`);
      const m = store({ to, kind: "document", text: doc.caption ?? doc.filename, document: { ...doc } });
      if (fault === "lostReply") throw new TimeoutError("send document");
      return { ...m };
    },

    async sendImage(to, image) {
      const fault = faults.take("sendImage");
      if (fault === "error") throw new ApiError(500, "The provider could not take the message.");
      if (!windowOpen(to)) throw new WindowClosedError();
      const problem = imageProblem(image);
      if (problem) throw new ApiError(400, `The image cannot be sent: ${problem}.`);
      const m = store({ to, kind: "image", text: image.caption ?? "", image: { ...image } });
      if (fault === "lostReply") throw new TimeoutError("send image");
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
