// A shop's web push, as the rest of the runtime sees it (plan item 11h, decision 45): alerts to the owner by the owner's choice of WhatsApp, push or both, and
// optional alerts to a customer who allowed them on their booking's or order's own page. Made once per runtime by the shared start (modules/runtime/start.ts)
// and handed to:
//   - the template's start, which wraps the shop's messaging with `pushMessaging`, so every message to the owner's number (a payment to check, a refund to approve,
//     "needs you", the morning summary, the sign-in link's answer) also, or only, becomes a push, whichever path sent it;
//   - the template's runtime, whose channel outbox (modules/channels/outbox.ts) calls `customer` when it keeps a message for a page's conversation;
//   - the runtime's HTTP layer, which takes the subscriptions and the choice (modules/runtime/http.ts, "push").
// The words are the same checked words the message would carry (modules/messaging/say.ts ran on them before any send); the push only carries them, encrypted.
import type { Clock } from "../core/clock.ts";
import { ApiError } from "../core/faults.ts";
import type { Messaging, OutboundMessage } from "../messaging/messaging.ts";
import { fitNotification } from "./sender.ts";
import type { PushSender } from "./sender.ts";
import type { BrowserSubscription, OwnerChoice, PushStore } from "./store.ts";

export interface Push {
  /** Is push on for this shop (its runtime has a push Guard)? Off: nothing is queued, and the pages do not offer it. */
  on: boolean;
  /** The shop's VAPID public key, for the pages' `applicationServerKey`. */
  publicKey(): string;
  /** An alert to the owner's phones. The ids queued: none means no phone allowed alerts. */
  owner(text: string, tag?: string): string[];
  /** An alert to a customer page's phones (`conversation`: the page's "web:..." conversation). */
  customer(conversation: string, text: string): string[];
  choice(): OwnerChoice;
  setChoice(c: OwnerChoice): void;
  /** Phones that get the owner's alerts now. */
  ownerPhones(): number;
  subscribe(who: string, s: BrowserSubscription): { ok: true; id: string } | { ok: false; why: string };
  unsubscribe(who: string, endpoint: string): boolean;
  phones(who: string): number;
}

export function createPush(o: { store: PushStore; sender: PushSender; shopName: string; clock: Clock; on: boolean }): Push {
  const { store, sender, clock } = o;
  const queue = (who: string, kind: "owner" | "customer", text: string, tag: string): string[] => {
    if (!o.on) return [];
    const ids = store.enqueue(who, kind, { title: o.shopName || "Shop", body: fitNotification(text), tag }, clock.now());
    if (ids.length > 0) sender.kick();
    return ids;
  };
  return {
    on: o.on,
    publicKey: () => store.vapid().publicKey,
    owner: (text, tag = "owner") => queue("owner", "owner", text, tag),
    customer: (conversation, text) => queue(conversation, "customer", text, "update"),
    choice: () => store.choice(),
    setChoice: (c) => store.setChoice(c),
    ownerPhones: () => store.phones("owner"),
    subscribe: (who, s) => (o.on ? store.subscribe(who, s, clock.now()) : { ok: false, why: "push is not on for this shop" }),
    unsubscribe: (who, endpoint) => store.unsubscribe(who, endpoint, clock.now()),
    phones: (who) => store.phones(who),
  };
}

const sameNumber = (a: string, b: string) => a.replace(/\D/gu, "") === b.replace(/\D/gu, "");

/** Where a wrapped messaging keeps the shop's own WhatsApp (undefined: the shop has none). */
const WHATSAPP = Symbol("the shop's WhatsApp, under the owner's alerts");
/**
 * The shop's WhatsApp alone, never a push: for what must go on WhatsApp or not at all. The owner's one-use sign-in link is one (owner-signin.ts): pushed, it would sit
 * in clear in the push queue (the sign-in store keeps hashes only) and show on a lock screen, and on a shop with no WhatsApp anyone could make one go by asking the
 * page. A messaging that `pushMessaging` did not wrap is returned as it is.
 */
export const whatsappOf = (m: Messaging): Messaging | undefined => (WHATSAPP in m ? (m as unknown as Record<symbol, Messaging | undefined>)[WHATSAPP] : m);

/**
 * Where a message to the owner goes now: the owner's choice, never push alone while no phone has alerts on (the owner would hear nothing), and push alone for a
 * shop with no WhatsApp. "none": a shop with no WhatsApp whose owner has no phone with alerts: nothing can be sent (the owner's app lists it).
 */
export function ownerRoute(push: Push | undefined, hasWhatsApp: boolean): "whatsapp" | "push" | "both" | "none" {
  const phones = push?.on ? push.ownerPhones() : 0;
  if (!hasWhatsApp) return phones > 0 ? "push" : "none";
  if (phones === 0) return "whatsapp";
  return push!.choice();
}

/**
 * The shop's messaging with the owner's alerts by their choice. `base` is the shop's WhatsApp (left out: the shop has none). Messages to anyone else go to `base`
 * unchanged (or are refused as not sent when there is no WhatsApp). A push stands in for a send: its id is "push-..." and `getMessage` knows it, so the record
 * says the alert went, and names it by that id.
 */
export function pushMessaging(base: Messaging | undefined, push: Push | undefined, owner: string, clock: Clock): Messaging {
  const sent = new Map<string, OutboundMessage>();
  const noWhatsApp = () => new ApiError(400, "This shop has no WhatsApp number, and the owner has no phone with alerts on, so nothing was sent; the owner's app shows what waits for them.");
  const isOwner = (to: string) => sameNumber(to, owner);
  /** The alert as a stand-in message, kept so getMessage can answer for it. */
  const asMessage = (to: string, kind: OutboundMessage["kind"], text: string, ids: string[]): OutboundMessage => {
    const m: OutboundMessage = { id: `push-${ids[0]}`, to, kind, text, sentAt: clock.now(), afterOptOut: false, acceptedAs: "push" };
    sent.set(m.id, m);
    if (sent.size > 200) sent.delete(sent.keys().next().value!);
    return m;
  };
  /** One message to the owner: pushed and/or sent on WhatsApp by the route; a push that went makes a failed WhatsApp send not a failure. */
  async function toOwner(to: string, kind: OutboundMessage["kind"], text: string, viaWhatsApp: (() => Promise<OutboundMessage>) | undefined): Promise<OutboundMessage> {
    const route = ownerRoute(push, base !== undefined);
    const ids = route === "push" || route === "both" ? push!.owner(text) : [];
    if ((route === "whatsapp" || route === "both") && viaWhatsApp) {
      try { return await viaWhatsApp(); } catch (e) { if (ids.length === 0) throw e; }
    }
    if (ids.length > 0) return asMessage(to, kind, text, ids);
    if (base && viaWhatsApp) return viaWhatsApp();
    throw noWhatsApp();
  }
  const messaging: Messaging = {
    sendText: (to, text) => (isOwner(to) ? toOwner(to, "text", text, base ? () => base.sendText(to, text) : undefined) : base ? base.sendText(to, text) : Promise.reject(noWhatsApp())),
    sendTemplate: (to, t) => (isOwner(to) ? toOwner(to, "template", t.text, base ? () => base.sendTemplate(to, t) : undefined) : base ? base.sendTemplate(to, t) : Promise.reject(noWhatsApp())),
    // the owner answers a push on their app's page, whose buttons are its own: the alert carries the words above the buttons
    async isWindowOpen(to) {
      if (isOwner(to) && ownerRoute(push, base !== undefined) === "push") return true; // free text is what a push carries; no template is needed
      return base ? base.isWindowOpen(to) : false;
    },
    async getMessage(id) { return id.startsWith("push-") ? sent.get(id) ?? null : base ? base.getMessage(id) : null; },
  };
  // buttons only where there were buttons before (an agent reads `sendInteractive` being there as "this provider has buttons"), or for a shop with no WhatsApp,
  // where only the owner can be reached at all
  if (base?.sendInteractive || (!base && push)) {
    messaging.sendInteractive = (to, m) => {
      if (isOwner(to)) return toOwner(to, "interactive", m.body, base?.sendInteractive ? () => base.sendInteractive!(to, m) : base ? () => base.sendText(to, m.body) : undefined);
      if (!base) return Promise.reject(noWhatsApp());
      if (!base.sendInteractive) return Promise.reject(new ApiError(400, "This WhatsApp provider has no buttons."));
      return base.sendInteractive(to, m);
    };
  }
  // documents and pictures are WhatsApp's: a push carries words only, and the owner's app shows the report and the QR code itself
  if (base?.sendDocument) messaging.sendDocument = (to, doc) => base.sendDocument!(to, doc);
  if (base?.sendImage) messaging.sendImage = (to, image) => base.sendImage!(to, image);
  if (base?.ping) messaging.ping = () => base.ping!();
  Object.defineProperty(messaging, WHATSAPP, { value: base, enumerable: false });
  return messaging;
}
