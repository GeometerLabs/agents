// How the public front (front.ts) reaches a shop's runtime and its approvals relay: the shapes they answer with, and small HTTP clients for them. Used by front.ts, and
// by tests that stand in for a runtime. The front holds the runtime's CHANNEL token (never the inbox's) and the relay's token; neither lets it act for the owner without
// the owner's link, which the runtime and the relay each check against their own copy of its hash (owner-link.ts).
import type { Language } from "../language/languages.ts";
import type { ChannelEvent } from "./events.ts";
import { OWNER_LINK_HEADER } from "./owner-link.ts";

/** A service as the page shows it (templates' channel.ts publicServices). */
export interface OfferService { id: string; names: Record<Language, string>; priceInr: number; durationMinutes: number }
export interface ShopInfo {
  name: string; address?: string; timezone: string; languages: Language[];
  deposit: { amountInr: number; holdMinutes: number }; cancellation: { windowHours: number };
  payment: { kind: "upi"; payee: string } | { kind: "link" };
  paused: boolean;
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
}

/** A refund Guard holds for the owner, as the relay shows it to the owner's page (modules/approvals/relay.ts ownerAsks). */
export interface RelayAsk { approval: string; digest: string; amountPaise: number; customerPhone: string | null; booking: string | null; serviceName?: string; slotMs?: number; untilMs: number }
export type RelayDecision = "recorded" | "gone" | "changed" | "expired" | "failed";

/** What the front asks of a runtime. */
export interface ChannelBackend {
  offer(q: { serviceId?: string; fromDate?: string; days?: number }): Promise<Offer>;
  /** Save events; `ownerToken` with an owner_action. "refused": the runtime said no (the owner's link, mostly). */
  submit(events: ChannelEvent[], ownerToken?: string): Promise<"saved" | "refused">;
  view(handleHash: string): Promise<BookingView | null>;
  /** Null when the owner's link is not (or no longer) valid. */
  owner(ownerToken: string): Promise<OwnerView | null>;
}

/** What the front asks of the approvals relay, for a shop whose Guard holds refunds for the owner (a gateway shop). */
export interface RelayBackend {
  asks(ownerToken: string): Promise<RelayAsk[] | null>;
  decide(ownerToken: string, approval: string, digest: string, decision: "approve" | "deny"): Promise<RelayDecision | "refused">;
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
  const headers = (owner?: string) => ({ authorization: `Bearer ${o.token}`, "content-type": "application/json", ...(owner ? { [OWNER_LINK_HEADER]: owner } : {}) });
  const json = async <T>(r: Response): Promise<T> => { if (!r.ok) throw new BackendError(`The shop's system answered ${r.status}.`); return await r.json() as T; };
  return {
    async offer(q) {
      const p = new URLSearchParams();
      if (q.serviceId) p.set("service", q.serviceId);
      if (q.fromDate) p.set("from", q.fromDate);
      if (q.days) p.set("days", String(q.days));
      return json<Offer>(await call(`${o.url}/internal/channel/offer?${p}`, { headers: headers() }, timeout));
    },
    async submit(events, ownerToken) {
      const r = await call(`${o.url}/internal/channel/events`, { method: "POST", headers: headers(ownerToken), body: JSON.stringify({ events }) }, timeout);
      if (r.status === 403) return "refused";
      if (!r.ok) throw new BackendError(`The shop's system answered ${r.status}.`);
      return "saved";
    },
    async view(handleHash) {
      const r = await call(`${o.url}/internal/channel/request?handle=${handleHash}`, { headers: headers() }, timeout);
      if (r.status === 404) return null;
      return json<BookingView>(r);
    },
    async owner(ownerToken) {
      const r = await call(`${o.url}/internal/channel/owner`, { headers: headers(ownerToken) }, timeout);
      if (r.status === 403) return null;
      return json<OwnerView>(r);
    },
  };
}

/** The relay's owner-page routes (modules/approvals/server.ts), for one shop, with the relay's token. */
export function relayBackend(o: { url: string; token: string; timeoutMs?: number }): RelayBackend {
  const timeout = o.timeoutMs ?? 8_000; // a decision waits for Guard and the runtime to be told
  const headers = (owner: string) => ({ authorization: `Bearer ${o.token}`, "content-type": "application/json", [OWNER_LINK_HEADER]: owner });
  return {
    async asks(ownerToken) {
      const r = await call(`${o.url}/owner/asks`, { headers: headers(ownerToken) }, timeout);
      if (r.status === 403) return null;
      if (!r.ok) throw new BackendError(`The approvals relay answered ${r.status}.`);
      return ((await r.json()) as { asks: RelayAsk[] }).asks;
    },
    async decide(ownerToken, approval, digest, decision) {
      const r = await call(`${o.url}/owner/decide`, { method: "POST", headers: headers(ownerToken), body: JSON.stringify({ approval, digest, decision }) }, timeout);
      if (r.status === 403) return "refused";
      if (!r.ok) throw new BackendError(`The approvals relay answered ${r.status}.`);
      return ((await r.json()) as { result: RelayDecision }).result;
    },
  };
}
