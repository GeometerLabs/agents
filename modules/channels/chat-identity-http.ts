// The runtime's side of "keep this chat", "open my chat", "I have a new phone" and "delete my chat" (W2, 17 Nov 2026), as one internal route the public front calls with the channel's
// own token (POST /internal/channel/chat-id, runtime/http.ts). The front carries the browser's answers and nothing else: it has no key, no number and no list of who has what.
// Here the runtime, which is the authority, checks them (chat-identity.ts), counts what must be counted, and makes the events only a step may act on (a link to send, a thread to
// forget). Also the two small translations every chat call goes through at the runtime's door:
//   - a guest's hash is resolved to the thread a passkey or link tied it to (chat-identity.ts resolve), so a signed-in phone reads its old thread, its day's caps and its alerts;
//   - a parent's chat names the parent's private link by its hash; the runtime checks that link opens a parent NOW and uses the parent's own thread (handle.ts parentChatHash).
// Answers never say whether a number is known, or why a key was refused beyond "another shop's" or "did not work": nothing here lets a stranger learn who a shop knows.
import { randomUUID } from "node:crypto";
import type { Clock } from "../core/clock.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import type { Push } from "../push/push.ts";
import type { IncomingEvent } from "../runtime/events.ts";
import type { RuntimeChannel } from "../runtime/core.ts";
import type { ChatIdentity, RelyingParty } from "./chat-identity.ts";
import { LINK_TOKEN } from "./chat-identity.ts";
import { chatConversationOf } from "./conversation.ts";
import { HANDLE_HASH, parentChatHash } from "./handle.ts";
import type { PagesFile } from "./pages-file.ts";

export interface ChatIdentityDeps {
  identity: ChatIdentity;
  /** The shop's addresses, read fresh on every call: the RP ID and origin are the shop's own, never a string the front sends. */
  pages: () => PagesFile | undefined;
  shopName: string;
  clock: Clock;
  /** The running runtime's reads and its way to save events (it saves on disk, then `kick` lets the queue run). */
  runtime: { channel?: RuntimeChannel; submit(events: IncomingEvent[]): unknown; kick(): void };
  push?: Push;
}

export interface IdentityAnswer { status: number; body: Record<string, unknown> }
const answer = (status: number, body: Record<string, unknown> = {}): IdentityAnswer => ({ status, body });
/** A phone number as the people on the page type it, by now normalised by the front to digits with the country code. */
const DIGITS = /^[1-9]\d{9,14}$/u;

export function createChatIdentity(deps: ChatIdentityDeps) {
  const { identity, clock } = deps;

  /** The RP ID and origin of the page the browser is on: through the pages domain's door (`url`), or the shop's own server (`base`). From the pages file only. */
  function rpOf(via: unknown): RelyingParty | undefined {
    const p = deps.pages();
    const address = via === "door" && p?.url ? p.url : p?.base;
    if (!address) return undefined;
    const u = new URL(address);
    return { rpId: u.hostname, origin: u.origin };
  }

  /** The parent whose private link has this hash NOW, as the stable ref the runtime's parent read gives; undefined for a link that opens nothing. */
  const parentRefOf = (linkHash: string): string | undefined => {
    const view = deps.runtime.channel?.parent?.(linkHash) as { ref?: unknown } | null | undefined;
    return typeof view?.ref === "string" ? view.ref : undefined;
  };

  return {
    /**
     * A chat send at the door, before its limits and before it is saved: a parent's link becomes the parent's thread (false: that link opens nothing now), any other guest hash is
     * resolved to the thread it is tied to. Mutates the event, which is the runtime's own copy.
     */
    openEvent(e: { handle: string; parent?: string }): boolean {
      if (e.parent !== undefined) {
        const ref = parentRefOf(e.parent);
        if (!ref) return false;
        e.handle = parentChatHash(ref);
        delete e.parent;
        return true;
      }
      e.handle = identity.resolve(e.handle);
      return true;
    },
    /** The same for a read or an alert call: the hash to look the thread up by, or undefined for a parent link that opens nothing now. */
    openRead(handle: string, parent?: string): string | undefined {
      if (parent !== undefined) { const ref = parentRefOf(parent); return ref ? parentChatHash(ref) : undefined; }
      return identity.resolve(handle);
    },

    /** One call from the front. `handle` is the guest's hash for this shop (never the handle); the rest is the op's own. */
    async call(body: Record<string, unknown>): Promise<IdentityAnswer> {
      const now = clock.now();
      const handle = typeof body.handle === "string" && HANDLE_HASH.test(body.handle) ? body.handle : undefined;
      const op = body.op;
      const language: Language = LANGUAGES.includes(body.language as Language) ? body.language as Language : "en";
      const channel = deps.runtime.channel;
      // the confirm page is opened from WhatsApp on any phone: it names a link, not a guest
      if (op === "confirm_state" || op === "confirm_use") {
        const token = typeof body.token === "string" && LINK_TOKEN.test(body.token) ? body.token : undefined;
        if (identity.wrongLinks.locked(now)) return answer(429, { reason: "wait" });
        if (!token) { identity.wrongLinks.note(now); return answer(404, { state: "unknown" }); }
        if (op === "confirm_state") { const state = identity.confirmState(token, now); if (state === "unknown") identity.wrongLinks.note(now); return answer(200, { state }); }
        const r = identity.confirmNumber(token, now);
        if (r.ok) return answer(200, { ok: true });
        if (r.state === "unknown") identity.wrongLinks.note(now);
        return answer(200, { ok: false, state: r.state });
      }
      if (!channel || !handle) return answer(400, { error: "Send a guest's hash." });
      const thread = identity.resolve(handle);
      const seen = channel.chatState(thread);
      const rp = rpOf(body.via);

      // what the page may offer: only after a booking or an order was made (or a thread that has one), and only to a guest whose thread the runtime knows
      if (op === "state") {
        const keys = identity.state(handle);
        const work = channel.chatWork(thread);
        return answer(200, { keys: keys.keys, here: keys.here, number: keys.number, work, offer: seen.known && work > 0 && !keys.here, restored: thread !== handle, known: seen.known });
      }
      if (op === "signin_options") return rp ? answer(200, { options: identity.signinOptions(rp, now) }) : answer(404, { error: "This shop has no page address yet." });
      if (op === "signin") {
        if (!rp) return answer(404, { error: "This shop has no page address yet." });
        const r = identity.signin(handle, rp, body.response as never, now);
        if (r.ok) return answer(200, { ok: true });
        return answer(403, { ok: false, reason: /another shop|not one of this shop/u.test(r.why) ? "other_shop" : "failed" });
      }
      if (op === "keep_options") {
        if (!rp || !seen.known) return answer(404, { error: "There is no chat to keep yet." });
        return answer(200, { options: identity.keepOptions(handle, rp, deps.shopName || "Shop", now) });
      }
      if (op === "keep") {
        if (!rp || !seen.known) return answer(404, { error: "There is no chat to keep yet." });
        const r = identity.keep(handle, rp, body.response as never, now);
        return r.ok ? answer(200, { ok: true }) : answer(403, { ok: false, reason: "failed" });
      }
      if (op === "number") {
        const digits = typeof body.digits === "string" ? body.digits : "";
        if (!DIGITS.test(digits)) return answer(400, { reason: "bad_number" });
        if (!seen.known) return answer(404, { error: "There is no chat yet." });
        // not kept yet: a link goes to the number, and it is the thread's contact only when its holder taps it (chat-link-send.ts, identity.confirmNumber)
        if (!identity.countConfirmAsk(handle, digits, now)) return answer(429, { reason: "wait" });
        deps.runtime.submit([{ kind: "chat_link", id: randomUUID(), what: "confirm", language, phone: digits, handle: thread }]);
        deps.runtime.kick();
        return answer(200, { ok: true, pending: true });
      }
      // "I have a new phone": counted per number and per shop FIRST, then always the same answer, whether or not a thread has the number
      if (op === "recover") {
        const digits = typeof body.digits === "string" ? body.digits : "";
        if (!DIGITS.test(digits)) return answer(400, { reason: "bad_number" });
        if (!identity.countRecoveryAsk(digits, now)) return answer(429, { reason: "wait" });
        deps.runtime.submit([{ kind: "chat_link", id: randomUUID(), what: "recover", language, phone: digits }]);
        deps.runtime.kick();
        return answer(200, { ok: true });
      }
      if (op === "links") {
        if (!identity.numberOf(handle)) return answer(200, { ok: false, reason: "no_number" });
        if (!identity.countLinksAsk(handle, now)) return answer(429, { reason: "wait" });
        deps.runtime.submit([{ kind: "chat_link", id: randomUUID(), what: "links", language, handle: thread }]);
        deps.runtime.kick();
        return answer(200, { ok: true });
      }
      if (op === "link_state" || op === "use_link") {
        const token = typeof body.token === "string" && LINK_TOKEN.test(body.token) ? body.token : undefined;
        if (identity.wrongLinks.locked(now)) return answer(429, { reason: "wait" });
        if (!token) { identity.wrongLinks.note(now); return answer(404, { state: "unknown" }); }
        if (op === "link_state") {
          const state = identity.linkState(token, now);
          if (state === "unknown") identity.wrongLinks.note(now);
          return answer(200, { state });
        }
        const r = identity.useLink(token, handle, now);
        if (r.ok) return answer(200, { ok: true });
        if (r.state === "unknown") identity.wrongLinks.note(now);
        return answer(200, { ok: false, state: r.state });
      }
      // "Delete my chat": the keys, number and ties first (here), then the words by a step (events.ts forget); the alert subscriptions with them
      if (op === "forget") {
        const g = identity.forget(handle);
        deps.push?.forget(chatConversationOf(g));
        deps.runtime.submit([{ kind: "chat_message", id: randomUUID(), handle: g, language, forget: true }]);
        deps.runtime.kick();
        return answer(200, { ok: true });
      }
      return answer(400, { error: "That is not something this route does." });
    },
  };
}
export type ChatIdentityRoutes = ReturnType<typeof createChatIdentity>;
