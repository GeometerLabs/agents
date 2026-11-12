// The one way a message leaves an agent, for every template. It renders the templates from the record, runs the limits on the final text, sends only if
// none blocks, and reads the message back from the messaging service. It returns whether the message went out.
//
// What a template gives this file: its words (`voice`), the facts those words are written from, the buttons or lists it can offer, and the gates of its own
// (Bookings: no reminder after a cancellation, "booked" only when recorded; Fees: no reminder once paid). The care is the same for all:
//  - the opt-out gate and the message-matches-record gate always run, on the whole text the customer will see (the words, then each option);
//  - buttons and lists are a session message, like free text: only while the 24-hour window is open and only if they fit WhatsApp's limits, and otherwise the
//    same words go out as plain text, so nothing is lost;
//  - a message that cannot go as text goes as an approved template when the window is closed;
//  - a lost reply may still have gone out, so it is not sent again, because there is no way to look it up;
//  - a picture that goes with the words (a UPI QR code) is sent first, by its address, only while the window is open; its caption passes the same check, and if
//    it cannot go the words still do (they carry everything the picture does);
//  - buttons can go to the owner too (UPI's "Received" button): the template says which messages offer them.
import type { Language } from "../language/languages.ts";
import { interactiveProblem, interactiveText } from "../language/interactive.ts";
import type { InteractiveMessage } from "../language/interactive.ts";
import { ApiError, GuardSuspendedError, WindowClosedError, mayHaveHappened } from "../core/faults.ts";
import { guardLicenceDecision } from "../licence/rules.ts";
import { checkOptOut, strictest } from "../limits/limits.ts";
import type { Decision } from "../limits/limits.ts";
import type { Action, Outcome } from "../record/record.ts";
import { imageProblem } from "./messaging.ts";
import type { Messaging, OutboundMessage, TemplateMessage } from "./messaging.ts";
import { isChannelConversation } from "../channels/conversation.ts";

/** What every message to say carries. A template adds its own fields (an amount, a time), which only its own `factsFor` reads. */
export interface SayArgs {
  /** The booking or fee the message is about, or null. The shared code never looks inside it. */
  booking: unknown;
  /** The customer's number (the record is kept under it, and the message goes there when it is for the customer). */
  phone: string;
  to: "customer" | "owner";
  /** The templates, in order; their texts are joined with a space. */
  templates: string[];
  /** Decisions worth recording alongside the message (for example "price floor held") that do not gate it. */
  shown?: Decision[];
  /** A reminder: sent by the clock, not as a reply, so the template's reminder gate applies and the reminder template name is used outside the window. */
  reminder?: boolean;
  /** The record's name for this message: a reply to a voice note is its own action. */
  action?: Action;
  /** Buttons or a list to go with the words; the template knows what its offers are. */
  offer?: { kind: string; body?: string[] };
  /** A picture to send before the words (a UPI QR code): its https address, and the templates that make its caption. */
  image?: { link: string; caption: string[] };
}

export interface SayVoice<Facts extends { language: Language }> {
  /** One template, written from the facts. Throws if the record lacks something it needs. */
  render(id: string, facts: Facts): string;
  /** The WhatsApp template that carries this text once the window has closed. */
  templateMessage(a: { ids: string[]; language: Language; facts: Facts; text: string; generic: string }): TemplateMessage;
  /** The generic template names, for a message that is not one of the approved templates. */
  genericNames: { customer: string; reminder: string; owner: string };
  /** message-matches-record: the text against the facts. */
  matches(text: string, facts: Facts): Decision;
}

export interface SayDeps<A extends SayArgs, Facts extends { language: Language }> {
  messaging: Messaging;
  voice: SayVoice<Facts>;
  /** The owner's number and language (a message to the owner goes there, in that language). */
  owner: { whatsapp: string; language: Language };
  /** The language this customer's conversation is in. */
  languageOf(phone: string, booking: A["booking"]): Language;
  optedOut(phone: string): boolean;
  /** The facts this message is written from, and the outgoing check reads. */
  factsFor(a: A, language: Language): Facts;
  /** The buttons or list for an offer (the words above them are `a.offer.body ?? a.templates`). May throw: the words then go out as plain text. */
  interactiveFor?(a: A, facts: Facts, language: Language): InteractiveMessage;
  /** The template's own gates, after the shared ones, in the order the template wants them recorded. */
  gates?(a: A, optedOut: boolean): Decision[];
  /** What the record keeps of the request (not the text). */
  inputsOf?(a: A): Record<string, unknown>;
  log(booking: A["booking"], phone: string, action: Action, outcome: Outcome, inputs: unknown, more: { decisions?: Decision[]; notes?: string; refs?: Record<string, string>; language?: Language }): void;
  /** A message to a customer was held back because it did not match the record: tell the owner. */
  heldBack(a: A): Promise<void>;
}

// The one exit for outgoing text: limits run on the final rendered text, so nothing reaches a customer that skipped a check.
export function createSay<A extends SayArgs, Facts extends { language: Language }>(deps: SayDeps<A, Facts>): (a: A) => Promise<boolean> {
  const { messaging, voice, owner, log } = deps;

  /** The picture before the words: best effort. Inside the window only, with a caption that passes the check; whatever happens, the words go next. */
  async function sendImage(a: A, toNumber: string, facts: Facts, language: Language, inputs: Record<string, unknown>, decisions: Decision[]): Promise<void> {
    const image = a.image!;
    if (typeof messaging.sendImage !== "function") return;
    let caption: string;
    try { caption = image.caption.map((id) => voice.render(id, facts)).join(" "); } catch (e) { log(a.booking, a.phone, "send_message", "blocked", { ...inputs, image: true }, { notes: (e as Error).message, refs: { to: a.to, image: "qr" }, language }); return; }
    const check = voice.matches(caption, facts);
    const problem = imageProblem({ link: image.link, caption });
    if (check.verdict !== "allow" || problem) { log(a.booking, a.phone, "send_message", "blocked", { ...inputs, image: true }, { decisions: [check], notes: problem ?? check.reason, refs: { to: a.to, image: "qr" }, language }); return; }
    if (!(await messaging.isWindowOpen(toNumber).catch(() => false))) return; // a picture is a session message: outside the window the words go alone
    try {
      const sent = await messaging.sendImage(toNumber, { link: image.link, caption });
      const seen = await messaging.getMessage(sent.id);
      log(a.booking, a.phone, "send_message", seen ? "confirmed" : "unconfirmed", { ...inputs, image: true }, { decisions: [...decisions, check], refs: { messageId: sent.id, templates: image.caption.join("+"), to: a.to, image: "qr" }, language });
    } catch (e) {
      if (e instanceof GuardSuspendedError) { log(a.booking, a.phone, "send_message", "blocked", { ...inputs, image: true }, { decisions: [...decisions, check, guardLicenceDecision(e.guard.reason)], notes: e.message, refs: { to: a.to, image: "qr" }, language }); return; }
      log(a.booking, a.phone, "send_message", mayHaveHappened(e) ? "unconfirmed" : "failed", { ...inputs, image: true }, { notes: (e as Error).message, refs: { to: a.to, image: "qr" }, language });
    }
  }

  return async function say(a: A): Promise<boolean> {
    const toCustomer = a.to === "customer";
    const action = a.action ?? "send_message";
    const toNumber = toCustomer ? a.phone : owner.whatsapp;
    const language = toCustomer ? deps.languageOf(a.phone, a.booking) : owner.language;
    const offer = a.offer; // the owner gets buttons only where a template offers them (UPI's "Received")
    const facts = deps.factsFor({ ...a, offer } as A, language);
    const inputs = { to: a.to, templates: a.templates, ...(deps.inputsOf ? deps.inputsOf({ ...a, offer } as A) : {}), ...(offer ? { offer: offer.kind } : {}) };
    let text: string;
    try {
      text = a.templates.map((id) => voice.render(id, facts)).join(" ");
    } catch (e) {
      log(a.booking, a.phone, action, "blocked", inputs, { notes: (e as Error).message, decisions: a.shown, refs: { to: a.to }, language });
      return false;
    }

    // Buttons and lists are a session message, like free text: only while the window is open, and only if they fit WhatsApp's limits. Otherwise: the plain words, as before.
    let interactive: InteractiveMessage | undefined;
    if (offer && deps.interactiveFor && typeof messaging.sendInteractive === "function") {
      try { interactive = deps.interactiveFor({ ...a, offer } as A, facts, language); } catch { interactive = undefined; }
      if (interactive && (interactiveProblem(interactive) !== null || !(await messaging.isWindowOpen(toNumber).catch(() => false)))) interactive = undefined;
    }
    const shownText = interactive ? interactiveText(interactive) : text;

    const optedOut = deps.optedOut(a.phone);
    const gates: Decision[] = [
      checkOptOut({ toCustomer, customerOptedOut: optedOut }),
      voice.matches(shownText, facts),
    ];
    if (interactive) gates.push(voice.matches(text, facts)); // the plain words may be sent instead, so they must hold too
    if (deps.gates) gates.push(...deps.gates({ ...a, offer } as A, optedOut));
    const decisions = [...(a.shown ?? []), ...gates];
    const worst = strictest(gates);
    if (worst.verdict !== "allow") {
      log(a.booking, a.phone, action, "blocked", inputs, { decisions, notes: worst.reason, refs: { to: a.to }, language });
      if (toCustomer && worst.ruleId === "message-matches-record") await deps.heldBack(a);
      return false;
    }

    if (a.image) await sendImage(a, toNumber, facts, language, inputs, decisions);

    try {
      let sent: OutboundMessage;
      let asButtons = false;
      if (interactive) {
        try {
          sent = await messaging.sendInteractive!(toNumber, interactive);
          asButtons = true;
        } catch (e) {
          // Refused outright (a 4xx): nothing went out, so the same words go out as plain text. A lost reply or a 5xx may have gone out and is not sent again.
          // Guard's licence refusal is not tried again in another form: it would be refused the same way.
          if (mayHaveHappened(e) || e instanceof WindowClosedError || e instanceof GuardSuspendedError || !(e instanceof ApiError) || e.status >= 500) throw e;
          sent = await messaging.sendText(toNumber, text);
        }
      } else {
        sent = (await messaging.isWindowOpen(toNumber))
          ? await messaging.sendText(toNumber, text)
          : await messaging.sendTemplate(toNumber, voice.templateMessage({ ids: a.templates, language, facts, text, generic: !toCustomer ? voice.genericNames.owner : a.reminder ? voice.genericNames.reminder : voice.genericNames.customer }));
      }
      const seen = await messaging.getMessage(sent.id); // read back from the provider's own outbox
      // item 11d: a message kept for a booking page (modules/channels/outbox.ts) names its channel, so nothing counts it as a WhatsApp message (bundle/lib/usage.ts)
      const channel: Record<string, string> = isChannelConversation(toNumber) ? { channel: toNumber.slice(0, toNumber.indexOf(":")) } : {};
      log(a.booking, a.phone, action, seen ? "confirmed" : "unconfirmed", inputs, { decisions, refs: { messageId: sent.id, templates: (asButtons ? offer?.body ?? a.templates : a.templates).join("+"), to: a.to, ...(asButtons ? { interactive: interactive!.list ? "list" : "buttons" } : {}), ...channel }, language });
      return seen !== null;
    } catch (e) {
      // Guard held it back for the shop's licence (the final stop): nothing went out, and it is the runtime's own licence refusal, made outside it. Recorded once, plainly.
      if (e instanceof GuardSuspendedError) {
        log(a.booking, a.phone, action, "blocked", inputs, { decisions: [...decisions, guardLicenceDecision(e.guard.reason)], notes: e.message, refs: { to: a.to }, language });
        return false;
      }
      // a lost reply may still have gone out; it is not sent again, because there is no way to look it up
      log(a.booking, a.phone, action, mayHaveHappened(e) ? "unconfirmed" : "failed", inputs, { decisions, notes: (e as Error).message, refs: { to: a.to }, language });
      return false;
    }
  };
}
