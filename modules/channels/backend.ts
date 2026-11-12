// How the public front (front.ts) reaches a shop's runtime and its approvals relay: the shapes they answer with, and small HTTP clients for them. Used by front.ts, and
// by tests that stand in for a runtime. The front holds the runtime's CHANNEL token (never the inbox's) and the relay's token; neither lets it act for the owner without
// the owner's link, which the runtime and the relay each check against their own copy of its hash (owner-link.ts).
import type { Language } from "../language/languages.ts";
import type { ChannelEvent } from "./events.ts";
import { OWNER_LINK_HEADER } from "./owner-link.ts";
import { OWNER_SESSION_HEADER, OWNER_SIGNIN_HEADER } from "./owner-access.ts";
import type { LinkState } from "./owner-access.ts";
import type { OwnerAppView } from "../assistant/app/view.ts";

/**
 * Who is acting as the owner: the panel-made private link (item 11d), or a session the runtime made from a one-time WhatsApp link (item 11f). A bare string is a
 * link, as item 11d's callers pass it. The runtime and the relay check either against their own records; the front only carries it.
 */
export type OwnerCred = string | { link: string } | { session: string };
/** The header that carries a credential to the runtime or the relay. */
export function ownerCredHeader(c: OwnerCred | undefined): Record<string, string> {
  if (c === undefined) return {};
  if (typeof c === "string") return { [OWNER_LINK_HEADER]: c };
  return "link" in c ? { [OWNER_LINK_HEADER]: c.link } : { [OWNER_SESSION_HEADER]: c.session };
}

/** A service as the page shows it (templates' channel.ts publicServices). */
export interface OfferService { id: string; names: Record<Language, string>; priceInr: number; durationMinutes: number }
export interface ShopInfo {
  name: string; address?: string; timezone: string; languages: Language[];
  deposit: { amountInr: number; holdMinutes: number }; cancellation: { windowHours: number };
  payment: { kind: "upi"; payee: string } | { kind: "link" };
  paused: boolean;
  /** Item 11f: the week's opening hours ("10:00" to "20:00", null when closed), for the customer view. Left out by a template that has none. */
  hours?: Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", { open: string; close: string } | null>;
  /** Item 11f: the shop's character (item 11e's setting), when the template's settings carry one; the page draws a placeholder in its colour. */
  character?: { name: string; look?: { colour?: string } };
}
export interface Offer { shop: ShopInfo; services: OfferService[]; serviceId?: string; days?: { date: string; starts: number[] }[]; calendarUnread?: boolean }

export type PayInstructions = { kind: "upi"; link: string; payTo: { id: string; name: string }; amountPaise: number; leftPaise: number; note: string } | { kind: "link"; url: string };
export type BookingView =
  | { status: "pending" } | { status: "not_done" }
  | { status: "refused"; reason: string; channel: string }
  | {
    status: "not_held" | "held" | "checking" | "booked" | "expired" | "cancelled" | "done"; ref: string; channel?: string;
    service?: OfferService; startMs?: number; endMs?: number; depositInr: number; holdExpiresAt?: number; pay?: PayInstructions;
    canCancel: boolean; canSayPaid: boolean; messages: { atMs: number; text: string }[];
  };

export interface OwnerItemView {
  kind: "deposit" | "refund_owed" | "late_refund" | "calendar"; case: string; digest: string; actions: string[]; amountPaise: number;
  customer: { phone: string; name?: string }; channel: "whatsapp" | "web" | "mcp"; serviceId?: string; startMs?: number; why?: string;
}
export interface OwnerView {
  shop: { name: string; timezone: string; ownerLanguage: Language };
  services: OfferService[];
  items: OwnerItemView[];
  upcoming: { case: string; startMs: number; serviceId?: string; customer: { phone: string; name?: string }; channel: OwnerItemView["channel"]; state: string }[];
  /**
   * Item 11e: the shop's assistant's view (its open cards, answered by id and digest; the mood; the talk), when the shop has the assistant. Left out otherwise.
   * `listen`: the shop has a voice service, so the page offers hold-to-record.
   */
  app?: OwnerAppView & { listen?: boolean };
}

/** A refund Guard holds for the owner, as the relay shows it to the owner's page (modules/approvals/relay.ts ownerAsks). */
export interface RelayAsk { approval: string; digest: string; amountPaise: number; customerPhone: string | null; booking: string | null; serviceName?: string; slotMs?: number; untilMs: number }
export type RelayDecision = "recorded" | "gone" | "changed" | "expired" | "failed";

/** What the front asks of a runtime. */
export interface ChannelBackend {
  offer(q: { serviceId?: string; fromDate?: string; days?: number }): Promise<Offer>;
  /** Save events; the owner's credential with an owner_action. "refused": the runtime said no (the owner's link or session, mostly). */
  submit(events: ChannelEvent[], owner?: OwnerCred): Promise<"saved" | "refused">;
  view(handleHash: string): Promise<BookingView | null>;
  /** Null when the owner's link or session is not (or no longer) good. */
  owner(owner: OwnerCred): Promise<OwnerView | null>;
  /** Item 11f: what a one-time sign-in link is now (nothing used up). Left out: the shop has no owner sign-in on its page. */
  linkState?(link: string): Promise<LinkState>;
  /** Item 11f: use a sign-in link up; a session for this browser, or why not. */
  signin?(link: string): Promise<{ session: string; expiresAtMs: number } | { state: Exclude<LinkState, "valid"> }>;
  /** Item 11f: end this session. */
  signout?(session: string): Promise<void>;
  /**
   * Items 11d and 11e: a recording from the owner's page, passed to the runtime as it came (the runtime holds it in memory only). "off": the shop's assistant has no
   * voice service; "refused": the owner's credential is not good.
   */
  ownerVoice?(owner: OwnerCred, audio: { bytes: Buffer; mime: string }): Promise<"saved" | "refused" | "off">;
}

/** What the front asks of the approvals relay, for a shop whose Guard holds refunds for the owner (a gateway shop). */
export interface RelayBackend {
  asks(owner: OwnerCred): Promise<RelayAsk[] | null>;
  decide(owner: OwnerCred, approval: string, digest: string, decision: "approve" | "deny"): Promise<RelayDecision | "refused">;
}

export class BackendError extends Error {}

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (e) { throw new BackendError(`The shop's system did not answer (${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}).`); }
  finally { clearTimeout(timer); }
}

/** The runtime's channel routes (modules/runtime/http.ts), through the shop's door, with the channel token. */
export function runtimeBackend(o: { url: string; token: string; timeoutMs?: number }): ChannelBackend {
  const timeout = o.timeoutMs ?? 4_000;
  const headers = (owner?: OwnerCred, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${o.token}`, "content-type": "application/json", ...ownerCredHeader(owner), ...extra });
  const json = async <T>(r: Response): Promise<T> => { if (!r.ok) throw new BackendError(`The shop's system answered ${r.status}.`); return await r.json() as T; };
  return {
    async offer(q) {
      const p = new URLSearchParams();
      if (q.serviceId) p.set("service", q.serviceId);
      if (q.fromDate) p.set("from", q.fromDate);
      if (q.days) p.set("days", String(q.days));
      return json<Offer>(await call(`${o.url}/internal/channel/offer?${p}`, { headers: headers() }, timeout));
    },
    async submit(events, owner) {
      const r = await call(`${o.url}/internal/channel/events`, { method: "POST", headers: headers(owner), body: JSON.stringify({ events }) }, timeout);
      if (r.status === 403) return "refused";
      if (!r.ok) throw new BackendError(`The shop's system answered ${r.status}.`);
      return "saved";
    },
    async view(handleHash) {
      const r = await call(`${o.url}/internal/channel/request?handle=${handleHash}`, { headers: headers() }, timeout);
      if (r.status === 404) return null;
      return json<BookingView>(r);
    },
    async owner(owner) {
      const r = await call(`${o.url}/internal/channel/owner`, { headers: headers(owner) }, timeout);
      if (r.status === 403) return null;
      return json<OwnerView>(r);
    },
    async linkState(link) {
      const r = await call(`${o.url}/internal/channel/owner-signin`, { headers: headers(undefined, { [OWNER_SIGNIN_HEADER]: link }) }, timeout);
      return (await json<{ state: LinkState }>(r)).state;
    },
    async signin(link) {
      const r = await call(`${o.url}/internal/channel/owner-signin`, { method: "POST", headers: headers(undefined, { [OWNER_SIGNIN_HEADER]: link }) }, timeout);
      if (r.status === 403) return { state: (await r.json() as { state: Exclude<LinkState, "valid"> }).state };
      const a = await json<{ session: string; expires_at_ms: number }>(r);
      return { session: a.session, expiresAtMs: a.expires_at_ms };
    },
    async signout(session) {
      await json<unknown>(await call(`${o.url}/internal/channel/owner-signout`, { method: "POST", headers: headers({ session }) }, timeout));
    },
    async ownerVoice(owner, audio) {
      const r = await call(`${o.url}/internal/channel/owner-voice`, { method: "POST", headers: headers(owner, { "content-type": audio.mime }), body: new Uint8Array(audio.bytes) }, timeout);
      if (r.status === 403) return "refused";
      if (r.status === 404) return "off";
      if (!r.ok) throw new BackendError(`The shop's system answered ${r.status}.`);
      return "saved";
    },
  };
}

/** The relay's owner-page routes (modules/approvals/server.ts), for one shop, with the relay's token. */
export function relayBackend(o: { url: string; token: string; timeoutMs?: number }): RelayBackend {
  const timeout = o.timeoutMs ?? 8_000; // a decision waits for Guard and the runtime to be told
  const headers = (owner: OwnerCred) => ({ authorization: `Bearer ${o.token}`, "content-type": "application/json", ...ownerCredHeader(owner) });
  return {
    async asks(owner) {
      const r = await call(`${o.url}/owner/asks`, { headers: headers(owner) }, timeout);
      if (r.status === 403) return null;
      if (!r.ok) throw new BackendError(`The approvals relay answered ${r.status}.`);
      return ((await r.json()) as { asks: RelayAsk[] }).asks;
    },
    async decide(owner, approval, digest, decision) {
      const r = await call(`${o.url}/owner/decide`, { method: "POST", headers: headers(owner), body: JSON.stringify({ approval, digest, decision }) }, timeout);
      if (r.status === 403) return "refused";
      if (!r.ok) throw new BackendError(`The approvals relay answered ${r.status}.`);
      return ((await r.json()) as { result: RelayDecision }).result;
    },
  };
}
