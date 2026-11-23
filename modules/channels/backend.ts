// How the public front (front.ts) reaches a shop's runtime and its approvals relay: the shapes they answer with, and small HTTP clients for them. Used by front.ts, and
// by tests that stand in for a runtime. The front holds the runtime's CHANNEL token (never the inbox's) and the relay's token; neither lets it act for the owner without
// the owner's link, which the runtime and the relay each check against their own copy of its hash (owner-link.ts).
import type { PublicListingsRead } from "../listings/kit.ts";
import type { Language } from "../language/languages.ts";
import type { ChannelEvent } from "./events.ts";
import { OWNER_LINK_HEADER } from "./owner-link.ts";
import { OWNER_SESSION_HEADER, OWNER_SIGNIN_HEADER } from "./owner-access.ts";
import type { OwnerFileState } from "./owner-file.ts";
import type { LinkState } from "./owner-access.ts";
import type { OwnerAppView } from "../assistant/app/view.ts";
import type { Face } from "../assistant/character.ts";
import type { DocumentsKey } from "../accounting/case-documents.ts";
import type { Document } from "../accounting/documents.ts";
import type { ExportFile } from "../accounting/export.ts";
import type { MoneyView } from "../accounting/owner-money.ts";
import type { ChatRead } from "./chat.ts";

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
  /**
   * Item 11f, 11i: the shop's character, when the shop has the assistant: its name (only when the Operator gave one) and the mood the PUBLIC sees now (all well, busy or closed; character.ts
   * publicFace), from the runtime. `picture` is added by the front, never by the runtime: that mood's SVG as a data: address (front.ts withFace).
   */
  character?: { name?: string; face?: Face; picture?: string };
  /** Batch 5: the shop's own phone and map link, from its pages.json (the front adds them to every offer: front.ts withContact), so every customer page can show them. */
  /** Block S: the shop shows listings (the front adds this to every offer, front.ts withListings): how many, and where "What we have" is. Never from the runtime. */
  listings?: { count: number; href: string };
  contact?: { phone?: string; map?: string; /** The kind of shop, added by the front (front.ts withContact), so the contact bar says centre for a tuition centre (contact-bar.ts). */ kind?: "bookings" | "orders" | "fees"; /** The shop's chat address (17 Nov 2026): the "Chat with us" button on every customer page. Added by the front, only for a shop that has a chat. */ chat?: string };
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
    /** Money clarity: the customer has already said they paid (the owner's page lists it first). */
    claimed?: boolean;
    /** Item 11h: a refund on this booking, as the shop's record holds it (the confirmation page shows it without WhatsApp). */
    refund?: { state: "asked" | "owed" | "sent" | "kept"; amountInr: number };
  };

/**
 * One thing waiting for the owner. Bookings' kinds, and item 11h's: Orders' `deposit` (the advance to mark), `big_order` and `late_refund`; Fees' `deposit` (a
 * payment a parent says they made), `waiver` and `refund_request`. `what` is what it is about, already in the owner's language, for a kind no service names.
 */
export interface OwnerItemView {
  kind: "deposit" | "late_deposit" | "refund_owed" | "late_refund" | "calendar" | "big_order" | "waiver" | "refund_request" | "po_approval" | "po_silent" | "po_receive" | "po_unsure" | "po_refused" | "discount"; case: string; digest: string; actions: string[]; amountPaise: number;
  customer: { phone: string; name?: string }; channel: "whatsapp" | "web" | "mcp" | "chat"; serviceId?: string; startMs?: number; why?: string; what?: string;
  /**
   * Money clarity: for a `deposit` or a `late_deposit`, when the customer said they paid (left out: nobody said so, the hold is only waiting) and the UPI reference they
   * typed. `late_deposit` is a hold that ended where money may have come anyway; "received" on it is the late mark, after which the refund (or keep) card follows.
   */
  claimedAtMs?: number; upiRef?: string;
  /**
   * E1 (24 Nov 2026), kind "discount": the price card's numbers (the item's name in the owner's language, how many, the list price and the price asked for one, the total the card
   * would agree). Never the card's code: the runtime puts it in the answer, as the owner's own "approve b-3 K7M2QX".
   */
  deal?: { name: string; qty: number; listInr: number; offeredInr: number; totalInr: number };
}
/**
 * Item 11h (Fees): a parent as the owner's page lists them, with their private link's state. `ref` names the parent without their number ("p-" and 12 hex digits
 * of its hash); `digest` binds a press to the link state shown, so a "send a new link" pressed twice sends one.
 */
export interface OwnerParentView { ref: string; phone: string; students: string[]; link: "active" | "none"; sinceMs?: number; digest: string }
/**
 * Money clarity (Fees): an open fee the owner may mark as paid in cash (or a bank transfer the agent cannot see), for the owner's folded "paid another way?" list. `digest`
 * binds a press to the fee as shown (its balance and payments), so a stale press or a second one does nothing.
 */
export interface OwnerCashView { case: string; digest: string; student: string; what: string; amountPaise: number }
/** Classes on the owner's page (templates/education/fees/src/classes/view.ts): `case` and `digest` are what a press names and is bound to. */
export interface OwnerClassesView {
  pending: { case: string; digest: string; batch: Record<Language, string>; startMs: number; students: { n: number; name: string; missed: boolean }[] }[];
  doubts: { case: string; digest: string; student: string; batch: Record<Language, string>; text: string; atMs: number }[];
}
/** One account of the credit book on the owner's page (go/internal/fees credit.go creditRows): named by its name and ref, never its number; `askable` when the owner's tap may send the first question. */
export interface OwnerCreditRow { ref: string; name: string; amountPaise: number; consent: "none" | "asked" | "yes"; stopped: boolean; askable: boolean; digest: string }

export interface OwnerView {
  shop: { name: string; timezone: string; ownerLanguage: Language };
  /** Item 11h: the template, for the page's headings. Left out: Bookings. "stock": a Stock orders shop (an owner page only: no public page). "listings": a listings-only shop (an owner page, the storefront and the feed; no chat, nothing waiting). */
  kind?: "orders" | "fees" | "stock" | "listings";
  services: OfferService[];
  items: OwnerItemView[];
  upcoming: { case: string; startMs: number; serviceId?: string; what?: string; customer: { phone: string; name?: string }; channel: OwnerItemView["channel"]; state: string }[];
  /** Item 11h (Fees): the centre's parents and their private links. */
  parents?: OwnerParentView[];
  /** Money clarity (Fees): the open fees the owner may mark paid by hand. */
  cash?: OwnerCashView[];
  /** Classes (Fees add-on): the classes waiting for attendance and the open doubts. Left out by a centre without Classes. */
  classes?: OwnerClassesView;
  /** The credit book (Fees with `creditBook`; owner-credit.ts): who owes what, the owner's alone. Left out for every other shop. */
  credit?: OwnerCreditRow[];
  /**
   * Item 11e: the shop's assistant's view (its open cards, answered by id and digest; the mood; the talk), when the shop has the assistant. Left out otherwise.
   * `listen`: the shop has a voice service, so the page offers hold-to-record.
   */
  app?: OwnerAppView & { listen?: boolean };
  /** The owner's Money section (modules/accounting/owner-money.ts), worked out at the runtime from the shop's accounts. Left out by a runtime that has none. */
  money?: MoneyView;
}

// ---- item 11h: Orders and Fees on the page ----------------------------------------------------------------------------------------------------------------

/** An item of an Orders shop's menu as the page shows it: its first name in each language and the shop's own price, the only price ever quoted. */
export interface OfferItem { id: string; names: Record<Language, string>; priceInr: number }
/** A slot on a day: its window, whether orders for it are still open (its cut-off has not passed), and the names customers call it. */
export interface OrderSlotView { id: string; mode: "pickup" | "delivery"; fromMs: number; toMs: number; open: boolean }
/** What an Orders shop's page offers: the menu, the days with their slots and what is left of each item, and the shop's rules. Prices come from the settings only. */
export interface OrderOffer {
  kind: "orders";
  shop: Pick<ShopInfo, "name" | "address" | "timezone" | "languages" | "payment" | "paused" | "character" | "contact"> & { advance: { mode: "full" | "part"; percent: number; holdMinutes: number }; cancellation: { windowHours: number } };
  items: OfferItem[];
  /** Today and the days ahead the shop takes orders for. `left`: how many of each item are not held yet; `full`: the day's order count is reached. */
  days: { date: string; slots: OrderSlotView[]; left: Record<string, number>; full: boolean }[];
  delivery?: { areas: string[] };
  maxItemsPerOrder: number;
}
/** An order by its handle, as its own page may show it (an allowlist: never the owner's code, never another customer, never the address as typed). */
export type OrderView =
  | { status: "pending" } | { status: "not_done" }
  | { status: "refused"; reason: string; channel: string }
  | {
    status: "not_held" | "checking" | "held" | "confirmed" | "expired" | "cancelled" | "done"; ref: string; channel?: string;
    /** E1 item 4: a line at a price the customer agreed (`priceInr`) has the menu price beside it (`listInr`); the lines add up to `totalInr`. */
    lines: { itemId: string; names: Record<Language, string>; qty: number; priceInr: number; listInr?: number }[];
    totalInr?: number; advanceInr?: number; date?: string; mode?: "pickup" | "delivery"; slot?: { id: string; fromMs: number; toMs: number }; area?: string;
    holdExpiresAt?: number; pay?: PayInstructions; canCancel: boolean; canSayPaid: boolean; messages: { atMs: number; text: string }[]; claimed?: boolean;
  };

/** A Fees centre's public page: only the centre itself. A parent's fees are on their private link, never found by a number. */
export interface FeesOffer { kind: "fees"; shop: Pick<ShopInfo, "name" | "address" | "timezone" | "languages" | "payment" | "paused" | "character" | "contact"> }
/** One student's fee for one month, as the parent's page shows it. Money in whole rupees from the centre's record; `pay` only while something is owed. */
export interface FeeLine {
  id: string; student: string; batch: Record<Language, string>; month: string; dueMs: number;
  feeInr: number; lateFeeInr: number; waivedInr: number; owedInr: number; paidInr: number; balanceInr: number;
  state: "open" | "paid" | "closed"; pay?: PayInstructions; canSayPaid: boolean; claimed: boolean;
}
/** What a parent's private link opens: that parent's students and their fees, and nothing of anyone else's. */
export interface ParentView { /** The parent's stable ref ("p-" and 12 hex digits), for the page's alerts: the runtime keys them by it, never by the link. */ ref?: string; students: { name: string; batch: Record<Language, string> }[]; dues: FeeLine[] }
/**
 * A fee payment's confirmation page, by the handle the parent's press made. `confirmed` only when the centre's record shows the fee paid (the payments service's
 * own list, or the owner's mark on a UPI centre); `waiting` after "I have paid" until then.
 */
export type FeeConfirmView =
  | { status: "pending" } | { status: "not_done" }
  | { status: "refused"; reason: string }
  | { status: "open" | "waiting" | "part" | "confirmed" | "closed"; ref: string; op: "pay" | "paid"; atMs: number; due: FeeLine };

/** A refund Guard holds for the owner, as the relay shows it to the owner's page (modules/approvals/relay.ts ownerAsks). */
export interface RelayAsk { approval: string; digest: string; amountPaise: number; customerPhone: string | null; booking: string | null; serviceName?: string; slotMs?: number; untilMs: number }
export type RelayDecision = "recorded" | "gone" | "changed" | "expired" | "failed";

/** What the front asks of a runtime. */
export interface ChannelBackend {
  offer(q: { serviceId?: string; fromDate?: string; days?: number }): Promise<Offer>;
  /** Save events; the owner's credential with an owner_action. "refused": the runtime said no (the owner's link or session, mostly). */
  submit(events: ChannelEvent[], owner?: OwnerCred): Promise<"saved" | "refused" | "slow">;
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
   * Item 11h: one step of a passkey ceremony, passed to the runtime as it is (the runtime checks everything: go/internal/runtime "owner-passkey"). The answer's
   * status and body, so the front can tell a refusal (403) from a fault.
   */
  passkey?(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
  /**
   * Item 11h: one web push step (the shop's public key, the owner's subscription and choice with the owner's credential, a customer page's subscription by its
   * handle's hash), passed to the runtime, which checks and keeps it (go/internal/runtime "push").
   */
  push?(body: Record<string, unknown>, owner?: OwnerCred): Promise<{ status: number; body: Record<string, unknown> }>;
  /**
   * Owner's item 2: one step of "Phones that can open your shop" (list, dismiss the news, remove one, make the owner's own recovery codes, add a phone, cancel the
   * Operator's request), for the owner's SESSION only (never the panel's link). The runtime checks everything (go/internal/runtime "owner-phones").
   */
  phones?(session: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
  /**
   * "Limits, tightened by a tap": the owner's limits page. With no `post`, a read (the limits, their value in force, the changes, and `passkey`: whether this session was
   * made with a passkey). With `post`, a change; the runtime refuses it (403 `passkey_needed`) unless the session was made with a passkey. Left out: no limits page.
   */
  limits?(owner: OwnerCred, post?: { id: string; limit: string; to: number }): Promise<{ status: number; body: Record<string, unknown> }>;
  /**
   * Block S, the shop's listings. `listings`: what the PUBLIC may see (the runtime decides: live, not hidden, none drafted or sold) and the owner's switch and place; null when the
   * shop has no listings. `listingPhoto`: one photo's bytes, only a public listing's (or, with the owner's credential, any the shop holds). `ownerListings`: the owner's listings page's
   * data, or with `post` an op (the runtime refuses what the shop's rules refuse: 422 with `why`). `ownerPhoto`: a photo from the owner's app, passed to the runtime, which reads the
   * bytes, checks and cleans them (modules/listings/photo.ts). Left out: no listings.
   */
  listings?(): Promise<PublicListingsRead | null>;
  listingPhoto?(id: string, owner?: OwnerCred): Promise<{ type: string; bytes: Buffer } | null>;
  /**
   * Block S phase B2, the shop's open protocol (specs/shop-feed.md, shop-check.md, agent-card.md). The runtime holds the shop's own signing key and the front never does, so the front asks the runtime
   * for each signed document and passes it on. `page` is the shop's page without a trailing slash; the runtime refuses one that is not an address of this shop (its pages file). `null`: the shop shows
   * no listings, or the owner's switch is off (a feed and a card are then not served; a check answers every id gone). Left out: no listings.
   */
  shopFeed?(q: { page: string; name: string; languages: string[]; chat?: string }): Promise<Record<string, unknown> | null>;
  shopCheck?(q: { page: string; ids: string[] }): Promise<Record<string, unknown> | null>;
  shopCard?(q: { page: string; card: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  ownerListings?(owner: OwnerCred, post?: { id: string; op: Record<string, unknown> }): Promise<{ status: number; body: Record<string, unknown> }>;
  ownerPhoto?(owner: OwnerCred, photo: { bytes: Buffer; type: string }): Promise<{ status: number; body: Record<string, unknown> }>;
  /**
   * Block S phase A3, the shop's one stock count (modules/stock). The owner's Stock page's data in their language, or with `post` an op (the runtime refuses what the shop's rules refuse: 422
   * with `why`). Left out: no stock (a shop with no assistant).
   */
  ownerStock?(owner: OwnerCred, post?: { id: string; op: Record<string, unknown> }, language?: string): Promise<{ status: number; body: Record<string, unknown> }>;
  /**
   * Items 11d and 11e: a recording from the owner's page, passed to the runtime as it came (the runtime holds it in memory only). "off": the shop's assistant has no
   * voice service; "refused": the owner's credential is not good.
   */
  ownerVoice?(owner: OwnerCred, audio: { bytes: Buffer; mime: string }): Promise<"saved" | "refused" | "off">;
  /**
   * W1, the chat on the shop's page: a guest's thread by the HASH of their handle (handle.ts guestHash), after line `after`, and where the send `cid` stands. Never throws
   * for an unknown guest: that is an empty thread. Left out: the shop has no chat.
   */
  chat?(guestHash: string, q?: { after?: number; cid?: string; parent?: string }): Promise<ChatRead>;
  /**
   * W2: the guest's identity (keep this chat, open it on another phone, a new phone's link, delete my chat), one call by op (go/internal/runtime). `body` carries the guest's hash
   * as `handle` and the op's own fields; the answer is the runtime's status and JSON. Left out: the shop has no chat identity.
   */
  chatId?(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
  /**
   * W1 hold-to-talk: a guest's recording, passed to the runtime as it came (the runtime holds it in memory only and listens in the guest's step). "off": the shop has no voice
   * service; "slow": the runtime's own per-guest or per-shop rate said wait.
   */
  chatVoice?(guestHash: string, send: { id: string; language: Language }, audio: { bytes: Buffer; mime: string }): Promise<"saved" | "off" | "slow">;
  /** Item 11h: the same reads, for an Orders shop (its offer and an order by its handle's hash). */
  orderOffer?(): Promise<OrderOffer>;
  orderView?(handleHash: string): Promise<OrderView | null>;
  /**
   * The documents of the page with this handle's hash (a parent's page: its link's hash), newest first, in `language`. Their shop phone is empty: the front adds the
   * one from pages.json (withContact). Left out (a stand-in, or a runtime with no accounting): no receipts are listed or served.
   */
  documents?(key: DocumentsKey, language: Language): Promise<Document[]>;
  /** The accountant's files for a period, for a signed-in owner's SESSION only (the runtime refuses anything else); null when the session is not good. */
  accountantFiles?(owner: { session: string }, period: string): Promise<ExportFile[] | null>;
  /** "Get my shop's file" (block S): the state of the owner's file, and (with an id) its bytes once; both for a signed-in owner's SESSION only. Null when the session is not good, or (bytes) there is no such file now. */
  ownerFile?(owner: { session: string }): Promise<OwnerFileState | null>;
  ownerFileBytes?(owner: { session: string }, id: string): Promise<{ name: string; bytes: Buffer } | null>;
  /** Item 11h: the same reads, for a Fees centre: its page, a parent's link by its hash (null: no parent has it now), a confirmation page by its handle's hash. */
  feesOffer?(): Promise<FeesOffer>;
  parentView?(linkHash: string): Promise<ParentView | null>;
  feeConfirmView?(handleHash: string): Promise<FeeConfirmView | null>;
  /**
   * Classes (Fees add-on): a batch's reading material for the parent whose private link has this hash now: the files, or (with `file`) one file's bytes. Null when the link
   * opens nothing or none of the parent's students in the batch may open it now (a student who left the batch or is past their fee's grace days). Left out: no material is served.
   */
  material?(linkHash: string, batchId: string, file?: string): Promise<MaterialAnswer | null>;
}

/** What the reading-material read answers (templates/education/fees/src/classes/view.ts and go/internal/fees make it): the page's words, or one file. */
export type MaterialAnswer =
  | { kind: "list"; batch: Record<Language, string>; students: string[]; files: { id: string; name: string; bytes: number }[]; left: number; maxMb: number }
  | { kind: "file"; name: string; type: string; base64: string };

/** What the front asks of the approvals relay, for a shop whose Guard holds refunds for the owner (a gateway shop). */
export interface RelayBackend {
  asks(owner: OwnerCred): Promise<RelayAsk[] | null>;
  decide(owner: OwnerCred, approval: string, digest: string, decision: "approve" | "deny"): Promise<RelayDecision | "refused">;
}

/** `backSoon`: the shop's shared process has PAUSED it (go/internal/shared answers 503 with the header x-back-soon): the front shows the "back soon" sentence, not a generic error. */
export class BackendError extends Error { backSoon = false; }
const answered = (r: Response): BackendError => { const e = new BackendError(`The shop's system answered ${r.status}.`); e.backSoon = r.status === 503 && r.headers.get("x-back-soon") === "1"; return e; };

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (e) { throw new BackendError(`The shop's system did not answer (${(e as Error).name === "AbortError" ? "timed out" : (e as Error).message}).`); }
  finally { clearTimeout(timer); }
}

/** The runtime's channel routes (go/internal/runtime), through the shop's door, with the channel token. */
export function runtimeBackend(o: { url: string; token: string; timeoutMs?: number }): ChannelBackend {
  const timeout = o.timeoutMs ?? 4_000;
  const headers = (owner?: OwnerCred, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${o.token}`, "content-type": "application/json", ...ownerCredHeader(owner), ...extra });
  const json = async <T>(r: Response): Promise<T> => { if (!r.ok) throw answered(r); return await r.json() as T; };
  const signed = async (r: Response): Promise<Record<string, unknown> | null> => (r.status === 404 ? null : json<Record<string, unknown>>(r));
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
      if (r.status === 429) return "slow"; // W1: the runtime's own per-guest or per-shop rate said wait
      if (!r.ok) throw answered(r);
      return "saved";
    },
    async view(handleHash) {
      const r = await call(`${o.url}/internal/channel/request?handle=${handleHash}`, { headers: headers() }, timeout);
      if (r.status === 404) return null;
      return json<BookingView>(r);
    },
    // item 11h: the same two routes, read as an Orders shop's or a Fees centre's answer (the runtime's template decides what it answers)
    async orderOffer() { return json<OrderOffer>(await call(`${o.url}/internal/channel/offer`, { headers: headers() }, timeout)); },
    async orderView(handleHash) {
      const r = await call(`${o.url}/internal/channel/request?handle=${handleHash}`, { headers: headers() }, timeout);
      return r.status === 404 ? null : json<OrderView>(r);
    },
    async chat(guestHash, q = {}) {
      const p = new URLSearchParams({ handle: guestHash, ...(q.after ? { after: String(q.after) } : {}), ...(q.cid ? { cid: q.cid } : {}), ...(q.parent ? { parent: q.parent } : {}) });
      return json<ChatRead>(await call(`${o.url}/internal/channel/chat?${p}`, { headers: headers() }, timeout));
    },
    async chatId(body) {
      const r = await call(`${o.url}/internal/channel/chat-id`, { method: "POST", headers: headers(), body: JSON.stringify(body) }, timeout);
      if (r.status >= 500) throw answered(r);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async chatVoice(guestHash, send, audio) {
      const p = new URLSearchParams({ handle: guestHash, lang: send.language, id: send.id });
      const r = await call(`${o.url}/internal/channel/chat-voice?${p}`, { method: "POST", headers: headers(undefined, { "content-type": audio.mime }), body: new Uint8Array(audio.bytes) }, timeout);
      if (r.status === 404) return "off";
      if (r.status === 429) return "slow";
      if (!r.ok) throw answered(r);
      return "saved";
    },
    async feesOffer() { return json<FeesOffer>(await call(`${o.url}/internal/channel/offer`, { headers: headers() }, timeout)); },
    async parentView(linkHash) {
      const r = await call(`${o.url}/internal/channel/parent?link=${linkHash}`, { headers: headers() }, timeout);
      return r.status === 404 ? null : json<ParentView>(r);
    },
    async feeConfirmView(handleHash) {
      const r = await call(`${o.url}/internal/channel/request?handle=${handleHash}`, { headers: headers() }, timeout);
      return r.status === 404 ? null : json<FeeConfirmView>(r);
    },
    async material(linkHash, batchId, file) {
      const p = new URLSearchParams({ link: linkHash, batch: batchId, ...(file ? { file } : {}) });
      const r = await call(`${o.url}/internal/channel/material?${p}`, { headers: headers() }, timeout);
      return r.status === 404 ? null : json<MaterialAnswer>(r);
    },
    async documents(key, language) {
      const p = new URLSearchParams("handle" in key ? { handle: key.handle } : { link: key.link });
      p.set("lang", language);
      const r = await call(`${o.url}/internal/channel/documents?${p}`, { headers: headers() }, timeout);
      return (await json<{ documents: Document[] }>(r)).documents;
    },
    async accountantFiles(owner, period) {
      const r = await call(`${o.url}/internal/channel/accounting?period=${encodeURIComponent(period)}`, { headers: headers(owner) }, timeout);
      if (r.status === 403) return null;
      return (await json<{ files: ExportFile[] }>(r)).files;
    },
    async ownerFile(owner) {
      const r = await call(`${o.url}/internal/channel/owner-file`, { headers: headers(owner) }, timeout);
      if (r.status === 403) return null;
      return json<OwnerFileState>(r);
    },
    async ownerFileBytes(owner, id) {
      const r = await call(`${o.url}/internal/channel/owner-file?take=${encodeURIComponent(id)}`, { headers: headers(owner) }, 60_000);
      if (r.status !== 200) return null;
      const name = /filename="([^"]+)"/u.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "shop-file.tar.gz";
      return { name, bytes: Buffer.from(await r.arrayBuffer()) };
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
    async push(body, owner) {
      const r = await call(`${o.url}/internal/channel/push`, { method: "POST", headers: headers(owner), body: JSON.stringify(body) }, timeout);
      if (r.status >= 500) throw answered(r);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async phones(session, body) {
      const r = await call(`${o.url}/internal/channel/owner-phones`, { method: "POST", headers: headers({ session }), body: JSON.stringify(body) }, timeout);
      if (r.status >= 500) throw new BackendError(`The shop's system answered ${r.status}.`);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async limits(owner, post) {
      const r = await call(`${o.url}/internal/channel/owner-limits`, { method: post ? "POST" : "GET", headers: headers(owner), ...(post ? { body: JSON.stringify(post) } : {}) }, timeout);
      if (r.status >= 500) throw answered(r);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async passkey(body) {
      const r = await call(`${o.url}/internal/channel/owner-passkey`, { method: "POST", headers: headers(), body: JSON.stringify(body) }, timeout);
      if (r.status !== 200 && r.status !== 403 && r.status !== 400) throw answered(r);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async signout(session) {
      await json<unknown>(await call(`${o.url}/internal/channel/owner-signout`, { method: "POST", headers: headers({ session }) }, timeout));
    },
    async listings() {
      const r = await call(`${o.url}/internal/channel/listings`, { headers: headers() }, timeout);
      if (r.status === 404) return null;
      return json<PublicListingsRead>(r);
    },
    async listingPhoto(id, owner) {
      const r = await call(`${o.url}/internal/channel/listing-photo?id=${encodeURIComponent(id)}`, { headers: headers(owner) }, timeout);
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw answered(r);
      return { type: r.headers.get("content-type") ?? "application/octet-stream", bytes: Buffer.from(await r.arrayBuffer()) };
    },
    // block S phase B2: the runtime builds and signs; the front only asks. A 404 is "this shop shows nothing", never an error.
    async shopFeed(q) { return signed(await call(`${o.url}/internal/channel/shop-feed`, { method: "POST", headers: headers(), body: JSON.stringify(q) }, timeout)); },
    async shopCheck(q) { return signed(await call(`${o.url}/internal/channel/shop-check`, { method: "POST", headers: headers(), body: JSON.stringify(q) }, timeout)); },
    async shopCard(q) { return signed(await call(`${o.url}/internal/channel/shop-card`, { method: "POST", headers: headers(), body: JSON.stringify(q) }, timeout)); },
    async ownerListings(owner, post) {
      const r = await call(`${o.url}/internal/channel/owner-listing`, { method: post ? "POST" : "GET", headers: headers(owner), ...(post ? { body: JSON.stringify(post) } : {}) }, timeout);
      if (r.status >= 500) throw answered(r);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async ownerStock(owner, post, language) {
      const r = await call(`${o.url}/internal/channel/owner-stock${!post && language ? `?lang=${encodeURIComponent(language)}` : ""}`, { method: post ? "POST" : "GET", headers: headers(owner), ...(post ? { body: JSON.stringify(post) } : {}) }, timeout);
      if (r.status >= 500) throw answered(r);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async ownerPhoto(owner, photo) {
      const r = await call(`${o.url}/internal/channel/owner-photo`, { method: "POST", headers: headers(owner, { "content-type": photo.type }), body: new Uint8Array(photo.bytes) }, timeout);
      if (r.status >= 500) throw answered(r);
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
    },
    async ownerVoice(owner, audio) {
      const r = await call(`${o.url}/internal/channel/owner-voice`, { method: "POST", headers: headers(owner, { "content-type": audio.mime }), body: new Uint8Array(audio.bytes) }, timeout);
      if (r.status === 403) return "refused";
      if (r.status === 404) return "off";
      if (!r.ok) throw answered(r);
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
