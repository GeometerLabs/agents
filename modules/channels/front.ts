// The public front of a server's shops: https://<server>/s/<shop>/... Caddy sends /s/* here (bundle/generate/compose.ts). For each shop it serves:
//
//   GET  /s/<shop>/                      the booking page (?lang=, ?service=, ?date=)          POST /s/<shop>/book        start a booking (a form)
//   GET  /s/<shop>/b/<handle>            a booking's own page                                   POST .../b/<handle>/cancel, .../b/<handle>/paid
//   GET  /s/<shop>/b/<handle>/d/<number>  one of the booking's own receipts (receipts.ts); another booking's number is a plain not-found
//   GET  /s/<shop>/qr.svg                a QR code of the booking page, for the counter
//   ...  /s/<shop>/api/v1/...            the booking API (api.ts)                               POST /s/<shop>/mcp         the same operations for AI assistants (mcp.ts)
//   GET  /s/<shop>/o/<owner token>       the owner's private approvals page                     POST /s/<shop>/o/<owner token>   an answer
//   ...  /s/<shop>/owner/...             item 11f: the owner's view, signed in by a one-time link on WhatsApp (owner-session.ts)
//   With the shop's assistant (item 11e), both owner addresses are also the owner's app: <owner base>/ (the page), /manifest.webmanifest, /sw.js, /talk (the talk
//   box's words) and /voice (a hold-to-record recording, Ogg or WebM Opus); the page's one script runs by a nonce in that response's content policy (appPolicy).
//
// Block S phase B2, the shop's open protocol, for every kind of shop (the key is the runtime's; this front only passes signed documents on, backend.ts shopFeed/shopCheck/shopCard):
//   GET  /s/<shop>/listings.json         the shop's feed, signed (storefront.ts)                GET /s/<shop>/agent-card.json   its A2A Agent Card, signed (shop-card.ts)
//   POST /s/<shop>/api/v1/check          "do you still have these?" (shop-check/1, ops.ts checkItemsOp): counted per SHOP, not per address (limits.ts `check`). A Fees centre and a
//                                         Stock orders shop answer this one route under /api and have no MCP endpoint.
//
// Item 11i, the shop's character: every shop's mood pictures (drawn on its server, bundle/character/render.ts) are public at stable addresses, for the shop's own
// page, Streetlist and WhatsApp (which fetches the PNG and WebP itself):
//   GET  /s/<shop>/character/<well|needs|wrong|closed|busy>.<svg|png|webp>   one mood's picture: an ETag (its sha256), a day's cache, `?v=` ignored (links carry it)
//   GET  /s/<shop>/character/<mood>-anim.svg                                DiceBear's own "slow" animation of that mood (17 Nov 2026), for the chat's head: same cache
//   GET  /s/<shop>/character/now.<svg|png|webp>                             the picture of the mood the PUBLIC sees now (all well, busy or closed: character.ts
//                                                                           publicFace), a minute's cache
// The shop's pages show the same public face in their head (shop-face.ts), as a data: address because the pages load images only from data.
// Item 11h: a shop whose template is Orders or Fees has its own customer side (front-orders.ts: the menu, an order's page, the ordering API and MCP; front-fees.ts: the
// centre's page, a parent's private page and a payment's confirmation page, and no API or MCP). The owner's page and the QR code are the same for every shop.
//
// Item 11f: through the pages domain's front door (bundle/services/door.ts) the same views are at https://<pages domain>/<slug>/...; the door says so with
// `x-geometer-door: <slug>`, and the front then writes every address under that base. Only the slug in the shop's own pages file counts: anything else is ignored.
//
// What it holds: for each shop, the runtime's CHANNEL token (backend.ts runtimeBackend) and, for a shop whose Guard holds refunds, the relay's token. Neither acts for
// the owner without the owner's link: the runtime and the relay check it against their own copy of its hash. What it does before anything reaches a runtime: the
// per-address limits (limits.ts), the shape of every field, and an Origin check on every form, so another site cannot post one for a visitor. It keeps nothing.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { textQrSvg } from "../qr/svg.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { apiOperation, apiRequest } from "./api.ts";
import { BackendError } from "./backend.ts";
import type { ChannelBackend, RelayBackend } from "./backend.ts";
import { HANDLE, NONCE, handleFromNonce, handleHash, newHandle } from "./handle.ts";
import { createLimiter } from "./limits.ts";
import type { Limiter } from "./limits.ts";
import { mcpPost } from "./mcp.ts";
import { OpError, createOps } from "./ops.ts";
import type { Ops } from "./ops.ts";
import { OWNER_TOKEN } from "./owner-link.ts";
import { OWNER, PAGE } from "./words.ts";
import { bookingPage, statusPage } from "./page.ts";
import { bookingIcs } from "./ics.ts";
import { ownerLinkGone, ownerPage } from "./owner-page.ts";
import type { OwnerPageInput } from "./owner-page.ts";
import { LEAVE_PAGE } from "./words-leave.ts";
import { WORDS as LIMITS_PAGE_WORDS, ownerLimitsPage } from "./owner-limits-page.ts";
import { listingsPolicy, ownerListingsPage } from "./owner-listings-page.ts";
import { ownerStockPage, stockPolicy } from "./owner-stock-page.ts";
import { PHONES_POLICY, WORDS as PHONES_WORDS, addPhonePage, ownCodesPage, phonesBanner, phonesPage, removePhonePage, withBanner } from "./owner-phones-page.ts";
import type { PhonesAnswer } from "./owner-phones-page.ts";
import { STOCK_LINE_WORDS } from "../stock/words.ts";
import { storefrontRoute } from "./storefront.ts";
import { LISTING_WORDS } from "../listings/words.ts";
import type { OwnerLimitsView } from "./owner-limits-page.ts";
import { DOCUMENT_SUB, documentHtml, receiptsBox, receiptsOf } from "./receipts.ts";
import { exportPeriods } from "../accounting/periods.ts";
import { CONTACT_HEADER, shopErrorPage } from "./contact-bar.ts";
import { BACK_SOON } from "./words-back-soon.ts";
import type { OwnerCred } from "./backend.ts";
import { CSRF_HEADER, csrfMatches, ownerSessionRoute } from "./owner-session.ts";
import type { PagesFile } from "./pages-file.ts";
import { MAX_VOICE_BYTES } from "./owner-audio.ts";
import { OWNER_MESSAGE_MAX } from "./events.ts";
import { OWNER_APP_SW, ownerAppManifest } from "../assistant/app/pwa.ts";
import { CUSTOMER_SW, customerAlertsBox, ownerAlertsBox, ALERT_WORDS } from "../push/pages.ts";
import { OWNER_CHOICES } from "../push/store.ts";
import { createOrderOps } from "./order-ops.ts";
import type { OrderOps } from "./order-ops.ts";
import { orderRoute } from "./front-orders.ts";
import { feeRoute } from "./front-fees.ts";
import { chatRoute } from "./chat-front.ts";
import { svgDataUri } from "./character-files.ts";
import type { CharacterFiles } from "./character-files.ts";
import { FACES, PICTURE_FORMATS, themeColour } from "../assistant/character.ts";
import type { Face, PictureFormat } from "../assistant/character.ts";

/** The header the pages domain's front door adds: the slug the visitor asked for (bundle/services/door.ts). */
export const DOOR_HEADER = "x-geometer-door";

export interface FrontShop {
  /** https://<server>/s/<shop>: every address the pages and answers give starts with it. */
  publicUrl: string;
  backend: ChannelBackend;
  /** Only for a shop whose Guard holds refunds for the owner (a gateway shop). */
  relay?: RelayBackend;
  /** Item 11f: the shop's page addresses (pages.json), read on every request. Left out: no pages domain and no owner sign-in for this shop. */
  pages?: () => PagesFile | undefined;
  /** Item 11h: the shop's template, which decides its customer side. Left out: Bookings (every shop before item 11h). */
  kind?: "bookings" | "orders" | "fees" | "stock" | "listings";
  /** Item 11i: the shop's character pictures (character-files.ts characterReader over its folder), read on every request. Left out: the shop shows no face. */
  character?: () => CharacterFiles | undefined;
}

/** Item 11i: the picture addresses the front answers: one mood, or `now`, in one of the three formats. */
const PICTURE_PATH = new RegExp(`^/character/(${[...FACES, "now"].join("|")})(-anim)?\\.(${PICTURE_FORMATS.join("|")})$`, "u");

/**
 * Item 11i: the offers a page is drawn from carry the shop's public face as a picture. The runtime says which mood the public sees (`character.face`); this adds
 * that mood's SVG from the shop's own folder as a data: address (the pages load images only from data, PAGE_POLICY). Nothing is fetched, and a shop with no
 * pictures yet simply has no face.
 */
export function withFace(backend: ChannelBackend, files: (() => CharacterFiles | undefined) | undefined): ChannelBackend {
  if (!files) return backend;
  const add = <T extends { shop: { character?: { name?: string; face?: Face; picture?: string } } }>(o: T): T => {
    const c = o.shop.character;
    const svg = c?.face ? files()?.picture(c.face, "svg") : undefined;
    return svg ? { ...o, shop: { ...o.shop, character: { ...c!, picture: svgDataUri(svg.bytes) } } } : o;
  };
  return {
    ...backend,
    offer: async (q) => add(await backend.offer(q)),
    ...(backend.orderOffer ? { orderOffer: async () => add(await backend.orderOffer!()) } : {}),
    ...(backend.feesOffer ? { feesOffer: async () => add(await backend.feesOffer!()) } : {}),
  };
}

/**
 * Batch 5: every offer's shop carries the shop's own phone and map link from its pages.json, so every customer page (the front page, a booking's, an order's, a fee's,
 * and each "not found" or "waiting" state) can show "Call the shop" and a map link without each page being handed the file. Read per request, like the face.
 */
export function withContact(backend: ChannelBackend, pages: (() => PagesFile | undefined) | undefined, chatHref?: string, kind?: "bookings" | "orders" | "fees"): ChannelBackend {
  if (!pages) return backend;
  // `chatHref` (17 Nov 2026): the shop's chat, so every customer page has one clear "Chat with us" button (contact-bar.ts shopContact); only a shop whose runtime has a chat
  // `kind` (19 Nov 2026): the shop's template, so the contact bar's words fit it ("Call the centre" for a tuition centre); left out, they say "shop"
  const add = <T extends { shop: { contact?: { phone?: string; map?: string; chat?: string; kind?: "bookings" | "orders" | "fees" } } }>(o: T): T => {
    const p = pages();
    return p && (p.phone || p.map || chatHref) ? { ...o, shop: { ...o.shop, contact: { ...(p.phone ? { phone: p.phone } : {}), ...(p.map ? { map: p.map } : {}), ...(chatHref ? { chat: chatHref } : {}), ...(kind ? { kind } : {}) } } } : o;
  };
  return {
    ...backend,
    offer: async (q) => add(await backend.offer(q)),
    ...(backend.orderOffer ? { orderOffer: async () => add(await backend.orderOffer!()) } : {}),
    ...(backend.feesOffer ? { feesOffer: async () => add(await backend.feesOffer!()) } : {}),
  };
}

/**
 * Block S: a shop that shows listings has one clear button on its front page to "What we have" (shop-face.ts), with how many it shows now. Added to every offer here, like the contact
 * (withContact), and never from the runtime: the count is what the public read says now. A shop with no listings, or whose runtime cannot be asked, gets no button.
 */
export function withListings(backend: ChannelBackend, href: string): ChannelBackend {
  if (!backend.listings) return backend;
  const add = async <T extends { shop: { listings?: { count: number; href: string } } }>(o: T): Promise<T> => {
    try {
      const n = (await backend.listings!())?.listings.length ?? 0;
      return n > 0 ? { ...o, shop: { ...o.shop, listings: { count: n, href } } } : o;
    } catch { return o; }
  };
  return {
    ...backend,
    offer: async (q) => add(await backend.offer(q)),
    ...(backend.orderOffer ? { orderOffer: async () => add(await backend.orderOffer!()) } : {}),
    ...(backend.feesOffer ? { feesOffer: async () => add(await backend.feesOffer!()) } : {}),
  };
}

/** Item 11h: what front.ts lends the per-template routes (front-orders.ts, front-fees.ts), so every route answers, counts and checks the same way. */
export interface FrontKit {
  limiter: Limiter;
  log: (line: string) => void;
  waitMs?: number;
  maxForm: number;
  maxJson: number;
  sendHtml(res: ServerResponse, status: number, body: string, extra?: Record<string, string>): void;
  sendJson(res: ServerResponse, status: number, value: unknown, extra?: Record<string, string>): void;
  redirect(res: ServerResponse, to: string): void;
  readBody(req: IncomingMessage, max: number): Promise<string | undefined>;
  /** A body as bytes (a guest's recording), or undefined past `max`. */
  readBytes(req: IncomingMessage, max: number): Promise<Buffer | undefined>;
  languageOf(req: IncomingMessage, url: URL, offered: readonly Language[], form?: URLSearchParams): Language;
  sameOrigin(req: IncomingMessage, shop: FrontShop): boolean;
  /** The content policy of a customer page that runs the alerts script (customerPagePolicy), for the per-template routes. */
  customerPolicy(page: string, nonce: string): string;
}
/** One request, as front.ts has read it: the shop (its addresses already under the pages domain when the door sent it), its name, the path under it, the visitor. */
export interface RouteArgs { req: IncomingMessage; res: ServerResponse; url: URL; shop: FrontShop; name: string; rest: string; method: string; address: string; pages?: PagesFile }

export interface FrontOptions {
  shops: Record<string, FrontShop>;
  limiter?: Limiter;
  /** Behind Caddy the socket's address is Caddy's: the LAST entry of this header is the visitor's. Left out: the socket's address. */
  sourceIpHeader?: string;
  /** How long an answer waits for the shop's step to run (start, cancel, an owner's press). Tests make it short. */
  waitMs?: number;
  log?: (line: string) => void;
}

/** The pages' content policy: no script at all, nothing loaded from anywhere, no frame, forms only to this site. */
export const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
/**
 * The pages' referrer policy: the origin only, never the address. An address here can be a secret (a booking's handle, the owner's link), so no page ever sends
 * its path or query in a Referer. It is "strict-origin" and not "no-referrer" because, under "no-referrer", a browser sends `Origin: null` with every form it posts
 * (the Fetch standard, "append a request Origin header"), and every form here is checked against its Origin (sameOrigin): a real browser's booking, cancel, "I have
 * paid", the owner's answers and the sign-in were all refused with 403 (found by item 11i's design pass in headless Chromium; the tests post with fetch, which
 * always sends the real Origin). The owner's pages say the same in a meta tag (owner-page.ts, owner-session.ts).
 */
export const PAGE_REFERRER = "strict-origin";
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_POLICY, "x-content-type-options": "nosniff", "referrer-policy": PAGE_REFERRER, "cache-control": "no-store" };
/**
 * The owner's app page (item 11e, on the owner's link and the signed-in view): PAGE_POLICY and exactly what the app needs, each at its own address under the owner's
 * base: its one inline script by this response's nonce, the recording's POST, its service worker and its manifest. The pages origin is shared by every shop on the
 * pages domain, so nothing here says 'self': no other page there may run script, register a worker or be posted to. Every other page keeps PAGE_POLICY.
 */
export const appPolicy = (base: string, nonce: string): string =>
  `${PAGE_POLICY}; script-src 'nonce-${nonce}'; connect-src ${base}/voice ${base}/push/subscribe ${base}/push/unsubscribe; worker-src ${base}/sw.js; manifest-src ${base}/manifest.webmanifest`;
/**
 * Item 11h: a customer's booking or order page with its "Tell me on this phone" button: PAGE_POLICY and that page's own worker and its one POST, each at its own
 * address under that page (`page`, no trailing slash), never 'self'. Money clarity: the page's own address is a connect source too, for the UPI box's quiet look for a
 * change (upi-script.ts: a GET of this very page, nothing sent), and the script may run on a page with no alerts (a held UPI deposit).
 */
export const customerPagePolicy = (page: string, nonce: string): string => `${PAGE_POLICY}; script-src 'nonce-${nonce}'; connect-src ${page}/push ${page}; worker-src ${page}/sw.js`;
const MAX_FORM = 4 * 1024;
const MAX_JSON = 16 * 1024;

function sendHtml(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...HTML_HEADERS, "content-length": Buffer.byteLength(body), ...extra });
  res.end(body);
}
function sendJson(res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
  res.end(body);
}
const redirect = (res: ServerResponse, to: string) => { res.writeHead(303, { location: to, "cache-control": "no-store" }); res.end(); };

function readBody(req: IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (Number(req.headers["content-length"] ?? 0) > max) { resolve(undefined); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > max) { resolve(undefined); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });
}

/** A body as bytes (a recording), or undefined past `max`. */
function readBytes(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    if (Number(req.headers["content-length"] ?? 0) > max) { resolve(undefined); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > max) { resolve(undefined); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(undefined));
  });
}

/** The front for every shop of a server, as one request handler. */
export function frontHandler(options: FrontOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const limiter = options.limiter ?? createLimiter();
  const log = options.log ?? (() => undefined);
  const ops = new Map<string, { web: Ops; mcp: Ops; page: Ops }>();
  const orderOps = new Map<string, { web: OrderOps; mcp: OrderOps; page: OrderOps }>();
  /** Item 11h: an Orders shop's operations, made once per shop and address, like Bookings' below. */
  const orderOpsOf = (name: string, shop: FrontShop) => {
    let o = orderOps.get(`${name} ${shop.publicUrl}`);
    if (!o) {
      const make = (channel: "web" | "mcp", waitMs?: number) => createOrderOps({ backend: shop.backend, publicUrl: shop.publicUrl, channel, ...(waitMs !== undefined ? { waitMs } : {}) });
      o = { web: make("web", options.waitMs), mcp: make("mcp", options.waitMs), page: make("web", Math.min(options.waitMs ?? 2_000, 2_000)) };
      orderOps.set(`${name} ${shop.publicUrl}`, o);
    }
    return o;
  };
  const opsOf = (name: string, shop: FrontShop) => {
    // by the address too: an answer through the pages domain names that domain's addresses (item 11f)
    let o = ops.get(`${name} ${shop.publicUrl}`);
    if (!o) {
      const make = (channel: "web" | "mcp", waitMs?: number) => createOps({ backend: shop.backend, publicUrl: shop.publicUrl, channel, ...(waitMs !== undefined ? { waitMs } : {}) });
      o = { web: make("web", options.waitMs), mcp: make("mcp", options.waitMs), page: make("web", Math.min(options.waitMs ?? 2_000, 2_000)) };
      ops.set(`${name} ${shop.publicUrl}`, o);
    }
    return o;
  };

  const addressOf = (req: IncomingMessage): string => {
    const header = options.sourceIpHeader ? req.headers[options.sourceIpHeader.toLowerCase()] : undefined;
    const list = typeof header === "string" ? header.split(",").map((x) => x.trim()).filter(Boolean) : [];
    return list.at(-1) ?? req.socket.remoteAddress ?? "unknown";
  };

  /** The visitor's language among the shop's: ?lang= (or the form's), else the browser's first that the shop has, else the shop's first. */
  function languageOf(req: IncomingMessage, url: URL, offered: readonly Language[], form?: URLSearchParams): Language {
    const asked = form?.get("lang") ?? url.searchParams.get("lang");
    if (asked && offered.includes(asked as Language)) return asked as Language;
    for (const part of String(req.headers["accept-language"] ?? "").split(",")) {
      const l = part.trim().slice(0, 2).toLowerCase() as Language;
      if (offered.includes(l)) return l;
    }
    return offered[0] ?? "en";
  }

  /** A form must come from this site: a browser always says where a POST came from, and another site's page is refused. */
  const sameOrigin = (req: IncomingMessage, shop: FrontShop): boolean => {
    const origin = req.headers.origin;
    return origin === undefined || origin === new URL(shop.publicUrl).origin;
  };
  const kit: FrontKit = { limiter, log, ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}), maxForm: MAX_FORM, maxJson: MAX_JSON, sendHtml, sendJson, redirect, readBody, readBytes, languageOf, sameOrigin, customerPolicy: customerPagePolicy };

  /** The Operator each request's shop names, for the catch-all error page below (which has no shop in hand). */
  const partnerOf = new WeakMap<ServerResponse, NonNullable<PagesFile["partner"]>>();
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://front");
    const m = /^\/s\/([a-z0-9][a-z0-9-]{0,39})(\/.*)?$/u.exec(url.pathname);
    const found = m ? options.shops[m[1]] : undefined;
    if (!m || !found) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    // item 11f: through the front door, every address is written under the pages domain, but only for the slug this shop's own pages file names
    const pages = found.pages?.();
    const door = req.headers[DOOR_HEADER];
    const viaDoorShop: FrontShop = typeof door === "string" && pages?.slug !== undefined && pages.url !== undefined && door === pages.slug ? { ...found, publicUrl: pages.url } : found;
    // a listings-only shop has no chat (18 Nov 2026): the backend never offers one, so no page, contact bar or feed points at it
    const doorShop: FrontShop = found.kind === "listings" ? { ...viaDoorShop, backend: { ...viaDoorShop.backend, chat: undefined } } : viaDoorShop;
    // item 11i: every offer a page is drawn from carries the shop's public face (withFace)
    const withPicture: FrontShop = found.character ? { ...doorShop, backend: withFace(doorShop.backend, found.character) } : doorShop;
    // batch 5: and the shop's phone and map link (withContact)
    const withContacts: FrontShop = found.pages ? { ...withPicture, backend: withContact(withPicture.backend, found.pages, withPicture.backend.chat ? `${doorShop.publicUrl}/chat` : undefined, found.kind === "orders" || found.kind === "fees" || found.kind === "bookings" ? found.kind : undefined) } : withPicture;
    // block S: and the button to "What we have" when the shop shows listings
    const shop: FrontShop = { ...withContacts, backend: withListings(withContacts.backend, `${doorShop.publicUrl}/shop`) };
    if (pages?.partner) partnerOf.set(res, pages.partner);
    // batch 3: name the shop's Operator for the door, whose error pages (a shop that is down) have nobody else to ask; the door keeps it and never passes it on
    if (typeof door === "string" && pages?.partner) res.setHeader(CONTACT_HEADER, Buffer.from(JSON.stringify({ n: pages.partner.name, p: pages.partner.phone }), "utf8").toString("base64url"));
    const name = m[1];
    const rest = m[2] ?? "";
    const method = req.method ?? "GET";
    const address = addressOf(req);
    const o = opsOf(name, shop);
    // the visitor's language and the Operator's number, not one English line (batch 3)
    const tooMany = () => { const l = languageOf(req, url, LANGUAGES); return sendHtml(res, 429, shopErrorPage(l, PAGE[l].tooMany, pages?.partner), { "retry-after": "300" }); };

    if (rest === "") { res.writeHead(301, { location: `${shop.publicUrl}/` }); res.end(); return; }

    // ---- item 11i: the character's pictures (every template's shop has them) ----
    const picture = PICTURE_PATH.exec(rest);
    // `<mood>-anim.svg` is DiceBear's animation of a fixed mood: no `now`, no PNG or WebP of it (a sticker or a profile photo cannot move)
    if (picture && picture[2] && (picture[1] === "now" || picture[3] !== "svg")) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    if (picture) return pictureRoute(req, res, found, picture[1] as Face | "now", picture[3] as PictureFormat, method, address, picture[2] !== undefined);

    // Listings-only shops (18 Nov 2026) have no chat: there is no agent behind it to answer. "Ask about this" falls back to the shop's phone (storefront.ts), and the chat's address is not
    // offered on any page (the contact bar's `chat` comes from `backend.chat`, which is taken away where `doorShop` is made).
    if (shop.kind === "listings" && (rest === "/chat" || rest.startsWith("/chat/"))) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    // W1: the chat on the shop's page, for every kind of shop, before the shop's own customer routes (an Orders or Fees shop would not otherwise reach it).
    // `viaDoor`: the page is served on the Streetlist pages domain, the only place that shows the Streetlist mark.
    if (rest === "/chat" || rest.startsWith("/chat/")) return chatRoute(kit, { req, res, url, shop, name, rest, method, address, ...(pages ? { pages } : {}), viaDoor: viaDoorShop !== found });

    // block S: the storefront ("What we have"), its open feed and its photos, for every kind of shop (a Stock orders shop shows none by default, and these then answer not-found)
    if (rest === "/shop" || rest === "/listings.json" || rest === "/agent-card.json" || rest.startsWith("/listings/photo/")) return storefrontRoute(kit, { req, res, url, shop, name, rest, method, address, ...(pages ? { pages } : {}) });

    // item 11h: an Orders shop's and a Fees centre's customer side are their own; the owner's page and the QR code below are every shop's
    const ownerPath = /^\/o\/[^/]+(\/.*)?$/u.test(rest) || rest === "/owner" || rest.startsWith("/owner/");
    // Stock orders talks to suppliers on WhatsApp and has no customers: only the owner's page (and the character's pictures above) is here, never a booking page, API or MCP
    // block S phase B2: a shop with no booking or order API still answers "do you still have these?" at /api/v1/check (and nothing else under /api): it falls through to the API block below
    const checkOnly = rest === "/api/v1/check" && (shop.kind === "stock" || shop.kind === "fees" || shop.kind === "listings");
    // a listings-only shop's own address (its page link, its QR code) is its storefront: "What we have"
    if (shop.kind === "listings" && rest === "/") return redirect(res, `${shop.publicUrl}/shop`);
    if ((shop.kind === "stock" || shop.kind === "listings") && !ownerPath && rest !== "/qr.svg" && !checkOnly) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    if ((shop.kind === "orders" || shop.kind === "fees") && !ownerPath && rest !== "/qr.svg" && !checkOnly) {
      const args: RouteArgs = { req, res, url, shop, name, rest, method, address, ...(pages ? { pages } : {}) };
      return shop.kind === "orders" ? orderRoute(kit, args, orderOpsOf(name, shop)) : feeRoute(kit, args);
    }

    // ---- the API and the MCP endpoint ----
    if (rest.startsWith("/api/v1")) {
      const op = apiOperation(method, rest);
      // a check ("do you still have these?") is counted against the SHOP, not the address: a directory reaches every shop from one address (limits.ts `check`)
      if (!(op === "check_items" ? limiter.take("check", `shop:${name}`) : limiter.take(op === "start_booking" ? "book" : op === "cancel_booking" ? "act" : "read", address)) || (op === "start_booking" && !limiter.take("shopStarts", `shop:${name}`))) return sendJson(res, 429, { error: { code: "too_many", message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
      if (op && (op === "booking_status" || op === "payment_instructions" || op === "cancel_booking") && limiter.over("wrong", address)) return sendJson(res, 429, { error: { code: "too_many", message: "Too many unknown handles from this address." } });
      let body: unknown;
      if (method === "POST") {
        if (!/^application\/json\b/iu.test(String(req.headers["content-type"] ?? ""))) return sendJson(res, 415, { error: { code: "bad_request", message: "Send JSON (content-type: application/json)." } });
        const text = await readBody(req, MAX_JSON);
        try { body = text === undefined ? undefined : JSON.parse(text); } catch { body = undefined; }
        if (body === undefined) return sendJson(res, 400, { error: { code: "bad_request", message: "The body must be JSON of at most 16 KB." } });
      } else if (method !== "GET") return sendJson(res, 405, { error: { code: "bad_request", message: "Use GET or POST." } }, { allow: "GET, POST" });
      const answer = await apiRequest(o.web, { method, path: rest, query: url.searchParams, body, publicUrl: shop.publicUrl });
      if (answer.status === 404 && op && op !== "free_slots") limiter.take("wrong", address);
      return sendJson(res, answer.status, answer.body);
    }
    if (rest === "/mcp") {
      if (method !== "POST") return sendJson(res, 405, { error: "This MCP endpoint answers POST with JSON; it offers no event stream." }, { allow: "POST" });
      if (!sameOrigin(req, shop)) return sendJson(res, 403, { error: "Calls from another site's page are refused." }); // the protocol asks servers to check Origin
      const text = await readBody(req, MAX_JSON);
      let body: unknown;
      try { body = text === undefined ? undefined : JSON.parse(text); } catch { body = undefined; }
      if (body === undefined) return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body must be JSON of at most 16 KB." } });
      // the same per-address limits as the page and the API: a start counts as a booking, everything else as a read
      const messages = (Array.isArray(body) ? body : [body]) as { method?: string; params?: { name?: string } }[];
      for (const msg of messages) {
        const tool = msg?.method === "tools/call" ? msg.params?.name : undefined;
        if (!(tool === "check_items" ? limiter.take("check", `shop:${name}`) : limiter.take(tool === "start_booking" ? "book" : tool === "cancel_booking" ? "act" : "read", address)) || (tool === "start_booking" && !limiter.take("shopStarts", `shop:${name}`))) return sendJson(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
      }
      const offer = await shop.backend.offer({});
      const answer = await mcpPost(o.mcp, offer.shop.name, body);
      if (answer.status === 202) { res.writeHead(202, { "cache-control": "no-store" }); res.end(); return; }
      return sendJson(res, answer.status, answer.body);
    }

    // ---- the owner's page ----
    const owner = /^\/o\/([^/]+)(\/.*)?$/u.exec(rest);
    if (owner) return ownerRoute(req, res, url, shop, owner[2] ?? "", address, { cred: owner[1], base: `${shop.publicUrl}/o/${owner[1]}` });
    // item 11f: the owner's view signed in from WhatsApp, with item 11d's page behind the session
    if (rest === "/owner" || rest.startsWith("/owner/")) {
      return ownerSessionRoute({
        limiter, sendHtml, sendJson, readBody, policy: PAGE_POLICY,
        ownerRoute: (sub, o) => ownerRoute(req, res, url, shop, sub, address, o),
      }, { req, res, url, base: shop.publicUrl, sub: rest.slice("/owner".length), address, backend: shop.backend, pages, sameOrigin: sameOrigin(req, shop) });
    }

    // ---- the booking page ----
    if (rest === "/qr.svg" && method === "GET") {
      if (!limiter.take("read", address)) return tooMany();
      // item 11f: the stable page address when the shop has one (it survives a rename and a new domain), else this page's own
      const qrTarget = pages?.pageUrl ?? `${shop.publicUrl}/`;
      const svg = textQrSvg(qrTarget, { label: qrTarget });
      res.writeHead(200, { "content-type": "image/svg+xml", "content-length": Buffer.byteLength(svg), "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": PAGE_POLICY });
      res.end(svg);
      return;
    }
    if (rest === "/" && method === "GET") {
      if (!limiter.take("read", address)) return tooMany();
      const service = url.searchParams.get("service") ?? undefined;
      const date = url.searchParams.get("date") ?? undefined;
      // a week of days from today; the chosen date (if one of them) picks which day's times the form shows
      const offer = await shop.backend.offer({ ...(service && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(service) ? { serviceId: service } : {}), days: 7 });
      const language = languageOf(req, url, offer.shop.languages);
      return sendHtml(res, 200, bookingPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, ...(offer.serviceId ? { serviceId: offer.serviceId } : {}), ...(date ? { date } : {}), nonce: newHandle(), ...(pages ? { pages } : {}) }));
    }
    if (rest === "/book" && method === "POST") {
      if (!sameOrigin(req, shop)) return sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      const offerAll = await shop.backend.offer({});
      const language = languageOf(req, url, offerAll.shop.languages, form);
      const service = form.get("service") ?? "";
      const again = async (error: string, status: number) => {
        const offer = await shop.backend.offer({ serviceId: service, days: 7 });
        return sendHtml(res, status, bookingPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, serviceId: service, error, values: { name: form.get("name") ?? "", phone: form.get("phone") ?? "" }, nonce: newHandle(), ...(pages ? { pages } : {}) }));
      };
      if (!limiter.take("book", address) || !limiter.take("shopStarts", `shop:${name}`)) return again(PAGE[language].tooMany, 429);
      // the same form sent twice (a double tap) is the same booking: its handle comes from the form's nonce and what it asks for
      const nonce = form.get("nonce") ?? "";
      const fixed = NONCE.test(nonce) ? { handle: handleFromNonce(nonce, [service, form.get("start") ?? "", form.get("phone") ?? ""]) } : undefined;
      try {
        const answer = await o.page.start_booking({ service_id: service, start: Number(form.get("start")), name: form.get("name"), phone: form.get("phone"), language }, fixed) as { handle: string };
        return redirect(res, `${shop.publicUrl}/b/${answer.handle}?lang=${language}`);
      } catch (e) {
        if (e instanceof BackendError) throw e;
        return again(e instanceof OpError && e.code === "paused" ? PAGE[language].paused : PAGE[language].badForm, 400);
      }
    }
    // a booking's own page. Item 11h: also its calendar file, and (with web push) its worker and "Tell me on this phone"; "<page>/" is the page too, because a
    // tapped alert opens its worker's scope, which ends in a slash
    const b = /^\/b\/([^/]+)(\/|\/cancel|\/paid|\/booking\.ics|\/sw\.js|\/push|\/d\/.+)?$/u.exec(rest);
    if (b) {
      const handle = b[1];
      const sub = b[2] === "/" ? undefined : b[2];
      if (limiter.over("wrong", address)) return tooMany();
      if (!HANDLE.test(handle)) { limiter.take("wrong", address); return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>"); }
      const offer = await shop.backend.offer({});
      const self = `${shop.publicUrl}/b/${handle}`;
      if ((sub === "/cancel" || sub === "/paid") && method === "POST") {
        if (!sameOrigin(req, shop)) return sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
        const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
        const language = languageOf(req, url, offer.shop.languages, form);
        if (!limiter.take("act", address)) return sendHtml(res, 429, statusPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, handle, view: await shop.backend.view(handleHash(handle)), notice: PAGE[language].tooMany }));
        try { if (sub === "/cancel") await o.page.cancel_booking({ handle }); else await o.page.say_paid(handle, form.get("upi_ref") ?? undefined); }
        catch (e) { if (e instanceof BackendError) throw e; limiter.take("wrong", address); }
        return redirect(res, `${self}?lang=${language}`);
      }
      // item 11h: a customer's alerts, on a page made on the page or through MCP (the runtime refuses any other)
      if (sub === "/push") {
        if (method !== "POST") return sendJson(res, 405, { error: "POST" }, { allow: "POST" });
        if (!sameOrigin(req, shop)) return sendJson(res, 403, { error: "Calls from another site's page are refused." });
        if (!shop.backend.push || !limiter.take("act", address)) return sendJson(res, shop.backend.push ? 429 : 404, { error: "Alerts are not on here." });
        let body: Record<string, unknown>;
        try { body = JSON.parse((await readBody(req, MAX_FORM)) ?? "") as Record<string, unknown>; } catch { return sendJson(res, 400, { error: "Send JSON." }); }
        const r = await shop.backend.push({ op: "customer_subscribe", handle: handleHash(handle), subscription: body.subscription });
        if (r.status === 404) limiter.take("wrong", address);
        return sendJson(res, r.status === 200 ? 200 : r.status === 404 ? 404 : 400, r.status === 200 ? { result: "done" } : { error: String(r.body.error ?? "That was not taken.") });
      }
      if (method !== "GET") return sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" });
      if (!limiter.take("read", address)) return tooMany();
      const view = await shop.backend.view(handleHash(handle));
      if (!view) limiter.take("wrong", address);
      const language = languageOf(req, url, offer.shop.languages);
      // the booking's receipts: only those of the case this handle opens (the runtime finds them by the handle's hash, so another case's number is a plain not-found)
      const docs = view && "ref" in view ? await receiptsOf(shop.backend, { handle: handleHash(handle) }, language) : [];
      const docPath = sub ? DOCUMENT_SUB.exec(sub) : null;
      if (docPath) {
        const page = documentHtml(docs, docPath[1], offer.shop.contact?.phone);
        if (!page) { limiter.take("wrong", address); return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>"); }
        return sendHtml(res, 200, page, { "x-robots-tag": "noindex" });
      }
      // item 11h: the calendar file, made from the saved booking (never with the page's address in it: ics.ts)
      if (sub === "/booking.ics") {
        const ics = view ? bookingIcs({ view, shop: offer.shop, language, handleHash: handleHash(handle), host: new URL(shop.publicUrl).hostname, nowMs: Date.now() }) : undefined;
        if (!ics) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
        res.writeHead(200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="booking-${"ref" in view! ? view.ref : "b"}.ics"`, "content-length": Buffer.byteLength(ics), "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" });
        res.end(ics);
        return;
      }
      // item 11h: the alerts' worker, scoped to this one page (its address is <page>/sw.js, so its scope can be no wider than <page>/)
      const alertsOn = view !== null && "ref" in view && (view.channel === "web" || view.channel === "mcp") && shop.backend.push !== undefined;
      const key = alertsOn ? await shop.backend.push!({ op: "key" }).catch(() => undefined) : undefined;
      const publicKey = key?.body.on === true && typeof key.body.publicKey === "string" ? key.body.publicKey : undefined;
      if (sub === "/sw.js") {
        if (!publicKey) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": Buffer.byteLength(CUSTOMER_SW), "cache-control": "no-cache", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" });
        res.end(CUSTOMER_SW);
        return;
      }
      const live = view !== null && "ref" in view && (view.status === "held" || view.status === "booked" || view.status === "checking");
      // one nonce for whatever script this response has: the alerts' (a page made on the page or through MCP, with push on) and/or the UPI box's (money clarity: a held UPI
      // deposit; its script copies the UPI ID and looks for a change without redrawing the QR)
      const upiHeld = view !== null && "ref" in view && view.status === "held" && view.pay?.kind === "upi";
      const withAlerts = publicKey !== undefined && live;
      const nonce = withAlerts || upiHeld ? randomBytes(16).toString("base64") : undefined;
      let phones = 0;
      if (nonce && withAlerts) { const st = await shop.backend.push!({ op: "customer_state", handle: handleHash(handle) }).catch(() => undefined); phones = Number(st?.body.phones ?? 0); }
      const alerts = nonce && withAlerts ? customerAlertsBox({ page: self, language, key: publicKey!, phones, nonce }) : undefined;
      const ics = view && "ref" in view && view.startMs !== undefined && view.status !== "expired" && view.status !== "not_held" ? `${self}/booking.ics?lang=${language}` : undefined;
      return sendHtml(res, view ? 200 : 404, statusPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, handle, view, receipts: receiptsBox(docs, self, language), ...(ics ? { ics } : {}), ...(alerts ? { alerts } : {}), ...(nonce ? { nonce } : {}) }), { "x-robots-tag": "noindex", ...(nonce ? { "content-security-policy": customerPagePolicy(self, nonce) } : {}) });
    }
    return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
  }

  /**
   * Item 11i: one of the shop's mood pictures. A fixed mood is cached a day (its address changes with the set's `?v=`, and its ETag with its bytes); `now` is the
   * mood the public sees at this minute, asked of the runtime, and cached a minute. Images only, with their own strict policy (an SVG opened on its own runs no
   * script and loads nothing). Readable from any site (Streetlist shows the faces), never framed.
   */
  async function pictureRoute(req: IncomingMessage, res: ServerResponse, found: FrontShop, face: Face | "now", format: PictureFormat, method: string, address: string, animated = false): Promise<void> {
    if (method !== "GET" && method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" }); res.end(); return; }
    // only `now` asks the runtime, so only it counts against the address's reads; a fixed mood is a small file, and WhatsApp's fetchers (many shops' pictures from a
    // few addresses at 08:00) must not be refused one, or the morning template whose header it is would not be delivered
    if (face === "now" && !limiter.take("read", address)) { res.writeHead(429, { "retry-after": "60", "cache-control": "no-store" }); res.end(); return; }
    const files = found.character?.();
    let mood: Face | undefined = face === "now" ? undefined : face;
    if (face === "now" && files) mood = (await found.backend.offer({})).shop.character?.face; // the runtime's own answer: no picture is needed to pick one
    const pic = files && mood ? (animated ? files.animation?.(mood) : files.picture(mood, format)) : undefined;
    if (!pic) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(method === "HEAD" ? undefined : "There is no picture here."); return; }
    const etag = `"${pic.sha256.slice(0, 32)}"`;
    const headers: Record<string, string> = {
      "cache-control": face === "now" ? "public, max-age=60" : "public, max-age=86400", etag, "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "cross-origin-resource-policy": "cross-origin",
    };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, { ...headers, "content-type": pic.type, "content-length": String(pic.bytes.length) });
    res.end(method === "HEAD" ? undefined : pic.bytes);
  }

  // ---- the owner's private page ---------------------------------------------------------------------------------------------------------------------
  //
  // One state and one way to answer, behind the same private link, rendered two ways: the HTML page, and a small versioned JSON pair for the owner's app that another
  // job builds on (decision 43, item 11e). Every check is the authority's own (the runtime and the relay compare the link with their copy of its hash, and an answer's
  // digest with what waits now); the front only counts wrong links, so guessing is slowed too.
  //   GET  /o/<token>                     the page             POST /o/<token>/answer           a form answer (source, action, case, digest), then back to the page
  //   GET  /o/<token>/api/v1/state        the state as JSON    POST /o/<token>/api/v1/answer    the same answer as JSON: {"result": "done" | "changed" | ...}

  /** What waits for the owner: the runtime's asks and marks, and the relay's Guard-held refunds, in one list, each with where its answer goes. Null: the link is not valid. */
  async function ownerState(shop: FrontShop, token: OwnerCred) {
    const view = await shop.backend.owner(token);
    if (!view) return null;
    let relayAsks: Awaited<ReturnType<RelayBackend["asks"]>> = [];
    if (shop.relay) { try { relayAsks = (await shop.relay.asks(token)) ?? []; } catch (e) { log(`The approvals relay could not be read: ${(e as Error).message}`); } }
    return { view, relayAsks: relayAsks ?? [] };
  }

  type OwnerResult = "done" | "sent" | "changed" | "expired" | "error" | "denied_link";
  /** One answer, to the authority it belongs to. The result names what happened; nothing is done unless the authority found exactly what was shown. */
  async function ownerAnswer(shop: FrontShop, token: OwnerCred, state: NonNullable<Awaited<ReturnType<typeof ownerState>>>, a: { source?: unknown; action?: unknown; case?: unknown; digest?: unknown; amount?: unknown }): Promise<OwnerResult> {
    const action = typeof a.action === "string" ? a.action : ""; const theCase = typeof a.case === "string" ? a.case : ""; const digest = typeof a.digest === "string" ? a.digest : "";
    if (!/^[0-9a-f]{32}$/u.test(digest)) return "changed";
    try {
      if (a.source === "relay") {
        if (!shop.relay || (action !== "approve" && action !== "deny")) return "changed";
        const r = await shop.relay.decide(token, theCase, digest, action);
        return r === "refused" ? "denied_link" : r === "recorded" ? "done" : r === "expired" ? "expired" : r === "failed" ? "error" : "changed";
      }
      if (a.source !== "runtime") return "changed";
      // item 11e: one of the assistant's cards, by its id and digest (no code is ever on the page); the runtime's card binding decides what happens
      if (action === "card_yes" || action === "card_no") {
        const card = state.view.app?.cards.find((c) => c.id === theCase && c.digest === digest);
        // Stock orders lists its own approval card as an item (case = the card's id), not in the app's cards
        const itemCard = state.view.items.find((i) => i.case === theCase && i.digest === digest && i.actions.includes(action));
        if ((!card && !itemCard) || (card && action === "card_no" && !card.hasNo)) return "changed";
        const r = await shop.backend.submit([{ kind: "owner_action", id: randomUUID(), action, case: theCase, digest }], token);
        if (r === "refused") return "denied_link";
        const deadline = Date.now() + (options.waitMs ?? 3_000);
        while (Date.now() < deadline) { const now = await shop.backend.owner(token); if (!now || (!now.app?.cards.some((c) => c.id === theCase) && !now.items.some((i) => i.case === theCase && i.digest === digest))) return "done"; await new Promise((r2) => setTimeout(r2, 200)); }
        return "sent";
      }
      // item 11h (Fees): a parent's private link, sent anew or switched off, bound to the link's state as the page showed it
      if (action === "send_link" || action === "revoke_link") {
        const parent = state.view.parents?.find((p) => p.ref === theCase && p.digest === digest);
        if (!parent || (action === "revoke_link" && parent.link !== "active")) return "changed";
        const r = await shop.backend.submit([{ kind: "owner_action", id: randomUUID(), action, case: theCase, digest }], token);
        if (r === "refused") return "denied_link";
        const deadline = Date.now() + (options.waitMs ?? 3_000);
        while (Date.now() < deadline) { const now = await shop.backend.owner(token); if (!now || !now.parents?.some((p) => p.digest === digest)) return "done"; await new Promise((r2) => setTimeout(r2, 200)); }
        return "sent";
      }
      // money clarity (Fees): an open fee marked paid by hand (cash, or a transfer the agent cannot see), bound to the fee as the page showed it
      if (action === "cash" || action === "bank") {
        const shown = state.view.cash?.find((c) => c.case === theCase && c.digest === digest);
        if (!shown) return "changed";
        // a part: whole rupees typed on the page, more than nothing and less than the balance shown (the agent checks it again against the fee as it stands)
        const typed = typeof a.amount === "string" || typeof a.amount === "number" ? String(a.amount).trim() : "";
        const partPaise = typed === "" ? undefined : /^\d{1,9}$/u.test(typed) ? Number(typed) * 100 : -1;
        if (partPaise !== undefined && (partPaise < 100 || partPaise >= shown.amountPaise)) return "changed";
        const r = await shop.backend.submit([{ kind: "owner_action", id: randomUUID(), action, case: theCase, digest, ...(partPaise !== undefined ? { amountPaise: partPaise } : {}) }], token);
        if (r === "refused") return "denied_link";
        const deadline = Date.now() + (options.waitMs ?? 3_000);
        while (Date.now() < deadline) { const now = await shop.backend.owner(token); if (!now || !now.cash?.some((c) => c.digest === digest)) return "done"; await new Promise((r2) => setTimeout(r2, 200)); }
        return "sent";
      }
      // Classes (Fees add-on): the teacher's marks and "answered", bound to the class or doubt as the page showed it (its digest); the agent checks it again in the step
      if (action === "present" || action === "absent" || action === "answered") {
        const base = theCase.split(".")[0];
        const shown = action === "answered" ? state.view.classes?.doubts.some((d) => d.case === theCase && d.digest === digest) : state.view.classes?.pending.some((c) => c.case === base && c.digest === digest);
        if (!shown) return "changed";
        const r = await shop.backend.submit([{ kind: "owner_action", id: randomUUID(), action, case: theCase, digest }], token);
        if (r === "refused") return "denied_link";
        const deadline = Date.now() + (options.waitMs ?? 3_000);
        while (Date.now() < deadline) { const now = await shop.backend.owner(token); if (!now || !(now.classes?.pending.some((c) => c.digest === digest) || now.classes?.doubts.some((d) => d.digest === digest))) return "done"; await new Promise((r2) => setTimeout(r2, 200)); }
        return "sent";
      }
      const shown = state.view.items.find((i) => i.case === theCase && i.digest === digest && i.actions.includes(action));
      if (!shown) return "changed"; // already answered (here or on WhatsApp), or changed since it was shown: nothing is sent
      const r = await shop.backend.submit([{ kind: "owner_action", id: randomUUID(), action: action as never, case: theCase, digest }], token);
      if (r === "refused") return "denied_link";
      // give the step a moment, so what the owner sees next shows the answer done
      const deadline = Date.now() + (options.waitMs ?? 3_000);
      while (Date.now() < deadline) { const now = await shop.backend.owner(token); if (!now || !now.items.some((i) => i.digest === digest)) return "done"; await new Promise((r2) => setTimeout(r2, 200)); }
      return "sent"; // saved, and not done yet when the page looked (a Guard the step waits for): the page says so, not "done"
    } catch (e) { log(`An owner's answer could not be passed on: ${(e as Error).message}`); return "error"; }
  }

  /** After the owner's words went to the runtime: wait until the page's talk has the assistant's answer (or the wait is over), so the page that follows shows it. */
  async function settleTalk(shop: FrontShop, token: OwnerCred, before: string, waitMs: number): Promise<"done" | "sent"> {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const talk = (await shop.backend.owner(token))?.app?.talk ?? [];
      if (JSON.stringify(talk) !== before && talk.at(-1)?.from === "assistant") return "done";
    }
    return "sent";
  }

  /** The state as the JSON endpoint gives it: one `waiting` list, each item saying where its answer goes (`source`), and the coming bookings. */
  const ownerJson = (state: NonNullable<Awaited<ReturnType<typeof ownerState>>>) => ({
    version: 1,
    shop: state.view.shop,
    services: state.view.services,
    waiting: [
      ...state.relayAsks.map((x) => ({ source: "relay", kind: "guard_refund", case: x.approval, digest: x.digest, actions: ["approve", "deny"], amount_paise: x.amountPaise, customer: { phone: x.customerPhone }, booking: x.booking, ...(x.serviceName ? { service_name: x.serviceName } : {}), ...(x.slotMs !== undefined ? { start_ms: x.slotMs } : {}), until_ms: x.untilMs })),
      ...state.view.items.map((i) => ({ source: "runtime", kind: i.kind, case: i.case, digest: i.digest, actions: i.actions, amount_paise: i.amountPaise, customer: i.customer, channel: i.channel, ...(i.serviceId ? { service_id: i.serviceId } : {}), ...(i.what ? { what: i.what } : {}), ...(i.startMs !== undefined ? { start_ms: i.startMs } : {}), ...(i.why ? { why: i.why } : {}), ...(i.claimedAtMs !== undefined ? { claimed_at_ms: i.claimedAtMs } : {}), ...(i.upiRef ? { upi_ref: i.upiRef } : {}) })),
    ],
    upcoming: state.view.upcoming,
    // item 11h (Fees): the parents and their private links, answered like the items: {"source": "runtime", "action": "send_link" | "revoke_link", "case": <ref>, "digest"}
    ...(state.view.parents ? { parents: state.view.parents.map((p) => ({ source: "runtime", case: p.ref, digest: p.digest, phone: p.phone, students: p.students, link: p.link, ...(p.sinceMs !== undefined ? { since_ms: p.sinceMs } : {}), actions: p.link === "active" ? ["send_link", "revoke_link"] : ["send_link"] })) } : {}),
    // money clarity (Fees): the open fees that can be marked paid by hand: {"source": "runtime", "action": "cash", "case": <fee>, "digest"}
    ...(state.view.cash ? { cash: state.view.cash.map((c) => ({ source: "runtime", case: c.case, digest: c.digest, student: c.student, what: c.what, amount_paise: c.amountPaise, actions: ["cash", "bank"] })) } : {}),
    // item 11e: the assistant's open cards, answered like the items: {"source": "runtime", "action": "card_yes" | "card_no", "case": <card id>, "digest"}
    ...(state.view.app ? { cards: state.view.app.cards.map((c) => ({ source: "runtime", case: c.id, digest: c.digest, actions: c.hasNo ? ["card_yes", "card_no"] : ["card_yes"], kind: c.kind, booking: c.case, amount_paise: c.amountPaise, who: c.who, until_ms: c.expiresAtMs, ...(c.question ? { question: c.question } : {}) })) } : {}),
  });

  /**
   * One request of the owner's page, for a credential at a base: the panel-made link at /o/<token> (item 11d), or (item 11f) a session at <base>/owner, whose every
   * POST must also carry the session's form token (`csrf`) and whose end (`onGone`) sends the owner back to sign in.
   */
  async function ownerRoute(req: IncomingMessage, res: ServerResponse, url: URL, shop: FrontShop, sub: string, address: string, o: { cred: OwnerCred; base: string; csrf?: string; signOut?: { action: string; label: string }; onGone?: () => void }): Promise<void> {
    const method = req.method ?? "GET";
    const token = o.cred;
    const base = o.base;
    const json = sub.startsWith("/api/") || sub === "/voice" || sub === "/listings/photo" || sub === "/push/subscribe" || sub === "/push/unsubscribe";
    const fallback: Language = (LANGUAGES.includes(url.searchParams.get("lang") as Language) ? url.searchParams.get("lang") : "en") as Language;
    const gone = () => {
      if (o.onGone) return o.onGone(); // a session that ended is not a guess: no wrong count, back to sign in
      limiter.take("wrong", address); return json ? sendJson(res, 403, { error: { code: "denied_link", message: OWNER.en.result.denied_link } }) : sendHtml(res, 403, ownerLinkGone(fallback, shop.pages?.()?.partner), { "x-robots-tag": "noindex" });
    };
    const slow = (retry: string) => (json ? sendJson(res, 429, { error: { code: "too_many", message: PAGE.en.tooMany } }, { "retry-after": retry }) : sendHtml(res, 429, shopErrorPage(fallback, PAGE[fallback].tooMany, shop.pages?.()?.partner), { "retry-after": retry }));
    if (limiter.over("wrong", address)) return slow("3600");
    if (typeof token === "string" && !OWNER_TOKEN.test(token)) return gone();
    /** A signed-in owner's POST must carry the session's form token; the panel's link is its own secret and needs none. */
    const csrfOk = (given: unknown) => o.csrf === undefined || (typeof token === "object" && "session" in token && csrfMatches(token.session, given));
    // item 11e: the owner's app lives at the same base: the page also at "<base>/" (a service worker controls only pages inside its scope, <base>/), and its four routes
    const routes: Record<string, string> = { "": "GET", "/": "GET", "/answer": "POST", "/api/v1/state": "GET", "/api/v1/answer": "POST", "/manifest.webmanifest": "GET", "/sw.js": "GET", "/talk": "POST", "/voice": "POST", "/limits": "GET", "/limits/set": "POST", "/listings": "GET", "/listings/op": "POST", "/stock": "GET", "/stock/op": "POST", "/listings/photo": "POST", "/push/subscribe": "POST", "/push/unsubscribe": "POST", "/push/choice": "POST", "/leave": "POST", "/phones": "GET", "/phones/remove": "POST", "/phones/dismiss": "POST", "/phones/cancel": "POST", "/phones/codes": "POST", "/phones/add": "POST" };
    // the accountant's files: <owner app>/accounting/<period>/<file>, for the signed-in owner's session only (handled below, once the session is known good)
    const accounting = /^\/accounting\/([^/]+)(?:\/([^/]+))?$/u.exec(sub);
    // block S: the owner's own view of one of their photos, by its id (a draft's, a waiting one): <owner app>/listings/p/<id>
    const ownPhoto = /^\/listings\/p\/(ph-[0-9a-f]{12})$/u.exec(sub);
    // "Get my shop's file": <owner app>/file/<id>, the owner's SESSION only, once (handled below with the accountant's files)
    const fileRoute = /^\/file\/([A-Za-z0-9_-]{32,64})$/u.exec(sub);
    if (accounting || ownPhoto || fileRoute) { if (method !== "GET") return sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" }); }
    else if (routes[sub] === undefined) return json ? sendJson(res, 404, { error: { code: "not_found", message: "GET /api/v1/state or POST /api/v1/answer." } }) : sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    if (!accounting && !ownPhoto && !fileRoute && routes[sub] !== method) return json ? sendJson(res, 405, { error: { code: "bad_request", message: `Use ${routes[sub]} here.` } }, { allow: routes[sub] }) : sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: routes[sub] });
    if (!limiter.take(method === "POST" ? "act" : "read", address)) return slow("300");
    if (method === "POST" && !sameOrigin(req, shop)) return json ? sendJson(res, 403, { error: { code: "bad_request", message: "Calls from another site's page are refused." } }) : sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
    const state = await ownerState(shop, token);
    if (!state) return gone();
    const asked = url.searchParams.get("lang");
    const language: Language = asked && LANGUAGES.includes(asked as Language) ? asked as Language : state.view.shop.ownerLanguage;
    const w = OWNER[language];

    if (accounting) {
      // only the owner's SESSION, never the panel's link; the runtime checks the session again, so the front's word is not the only gate. Only this month, last month and the
      // financial year (taken from the runtime's own clock, as the page's links are), and only the files that period has: anything else is a plain not-found.
      const session = typeof token === "object" && "session" in token ? token.session : undefined;
      const money = state.view.money;
      const nothing = () => sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
      if (!session || !money || !shop.backend.accountantFiles) return nothing();
      const wanted = exportPeriods(money.period);
      if (![wanted.thisMonth, wanted.lastMonth, wanted.year].includes(accounting[1])) return nothing();
      const files = await shop.backend.accountantFiles({ session }, accounting[1]);
      if (files === null) return gone();
      const file = accounting[2] === undefined ? undefined : files.find((f) => f.name === accounting[2]);
      if (!file) return nothing();
      res.writeHead(200, {
        "content-type": file.name.endsWith(".csv") ? "text/csv; charset=utf-8" : file.name.endsWith(".xml") ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${file.name}"`,
        "content-length": Buffer.byteLength(file.content), "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'",
      });
      res.end(file.content);
      return;
    }
    // ---- "Get my shop's file" and "Change my Operator" (block S): only a signed-in owner's SESSION may ask or take; the panel's link, which the Operator made, opens neither ----
    const ownSession = typeof token === "object" && "session" in token ? token.session : undefined;
    // owner's item 2: the banners (a new phone, the Operator's request to remove every phone, the prompt to make the owner's own codes) on the owner's pages, for a
    // signed-in session only; the runtime says what is true, and a failure to ask leaves the page without a banner rather than without the page
    let banner = "";
    if (ownSession && method === "GET" && shop.backend.phones && ["", "/", "/limits", "/listings", "/stock"].includes(sub)) {
      try {
        const r = await shop.backend.phones(ownSession, { op: "list" });
        if (r.status === 200) banner = phonesBanner({ base, language, ...(o.csrf ? { csrf: o.csrf } : {}), view: r.body as unknown as PhonesAnswer, ...(shop.pages?.()?.partner ? { operatorName: shop.pages()!.partner!.name } : {}) });
      } catch (e) { log(`The owner's phones could not be read for a banner: ${(e as Error).message}`); }
    }
    if (fileRoute) {
      const gone404 = () => sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>", { "x-robots-tag": "noindex" });
      if (!ownSession || !shop.backend.ownerFileBytes) return gone404();
      const got = await shop.backend.ownerFileBytes({ session: ownSession }, fileRoute[1]);
      if (!got) return gone404();
      res.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="${got.name.replace(/[^A-Za-z0-9._-]/gu, "_")}"`, "content-length": got.bytes.length, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'" });
      res.end(got.bytes);
      return;
    }
    // ---- owner's item 2: "Phones that can open your shop". Only a signed-in owner's SESSION (the panel's link, which the Operator made, has none); every rule is the runtime's ----
    const phonesAt = (n?: string) => `${base}/phones?lang=${language}${n ? `&n=${n}` : ""}`;
    if (sub === "/phones" || sub.startsWith("/phones/")) {
      const ph = shop.backend.phones;
      if (!ownSession || !ph) return redirect(res, `${base}/?lang=${language}`);
      const noStore = { "x-robots-tag": "noindex", "cache-control": "no-store", "content-security-policy": PHONES_POLICY };
      const hosted = shop.pages?.()?.hosted === true;
      const listed = await ph(ownSession, { op: "list" });
      if (listed.status === 403) return gone();
      const view = listed.body as unknown as PhonesAnswer;
      if (sub === "/phones") {
        const rm = url.searchParams.get("remove");
        if (rm) {
          const p = view.phones.find((x) => x.id === rm);
          return p ? sendHtml(res, 200, removePhonePage({ base, language, ...(o.csrf ? { csrf: o.csrf } : {}), id: p.id, ...(p.label ? { label: p.label } : {}), last: false }), noStore) : redirect(res, phonesAt());
        }
        const n = url.searchParams.get("n");
        return sendHtml(res, 200, phonesPage({ base, language, ...(o.csrf ? { csrf: o.csrf } : {}), view, hosted, ...(n === "removed" || n === "cancelled" || n === "refused" ? { notice: n } : {}), ...(o.signOut ? { signOut: o.signOut } : {}) }), noStore);
      }
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      if (sub === "/phones/dismiss") { const through = Number(form.get("through")); await ph(ownSession, { op: "dismiss", ...(Number.isFinite(through) && through > 0 ? { through } : {}) }); return redirect(res, `${base}/?lang=${language}`); }
      if (sub === "/phones/cancel") { await ph(ownSession, { op: "cancel_removal" }); return redirect(res, phonesAt("cancelled")); }
      if (sub === "/phones/remove") {
        const id = form.get("id") ?? "";
        const r = await ph(ownSession, { op: "remove", id, confirm_last: form.get("confirm_last") === "yes" });
        // 409: it is the LAST phone, and the owner has confirmed once; ask again, in stronger words (the runtime refuses it without the second yes)
        if (r.status === 409) return sendHtml(res, 200, removePhonePage({ base, language, ...(o.csrf ? { csrf: o.csrf } : {}), id, ...(view.phones.find((x) => x.id === id)?.label ? { label: view.phones.find((x) => x.id === id)!.label! } : {}), last: true }), noStore);
        return redirect(res, r.status === 200 ? phonesAt("removed") : r.status === 403 ? phonesAt("refused") : phonesAt());
      }
      if (sub === "/phones/codes") {
        const r = await ph(ownSession, { op: "codes" });
        return r.status === 200 && Array.isArray(r.body.codes) ? sendHtml(res, 200, ownCodesPage({ base, language, codes: (r.body.codes as unknown[]).map(String) }), noStore) : redirect(res, phonesAt("refused"));
      }
      const r = await ph(ownSession, { op: "add_phone" });
      return r.status === 200 && typeof r.body.url === "string" ? sendHtml(res, 200, addPhonePage({ base, language, url: r.body.url, expiresAt: Number(r.body.expires_at_ms) }), noStore) : redirect(res, phonesAt("refused"));
    }
    if (sub === "/leave") {
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      const what = form.get("what");
      if (!ownSession || !state.view.app || (what !== "file" && what !== "operator")) return redirect(res, `${base}/?lang=${language}`);
      // the same words the owner would type: the assistant reads them by rule and writes the ask in the record (conversation.ts leave), marked as coming from the page
      const before = JSON.stringify(state.view.app.talk);
      const r = await shop.backend.submit([{ kind: "owner_message", id: randomUUID(), text: what === "file" ? "get my shop's file" : "change my operator" }], token);
      if (r === "refused") return gone();
      await settleTalk(shop, token, before, options.waitMs ?? 3_000);
      return redirect(res, `${base}/?lang=${language}&n=leave`);
    }
    if (sub === "/api/v1/state") return sendJson(res, 200, ownerJson(state), { "x-robots-tag": "noindex" });

    // ---- item 11e: the owner's app (the talk box and recordings only for a shop with the assistant; item 11h: the manifest and the worker for every shop) ----
    const app = state.view.app;
    if (!app && (sub === "/talk" || sub === "/voice")) return json ? sendJson(res, 404, { error: { code: "not_found", message: "This shop has no assistant." } }) : sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    // ---- item 11h: the owner's alerts (web push). The runtime checks the owner's credential and keeps the subscription; the form token is checked here ----
    if (sub === "/push/subscribe" || sub === "/push/unsubscribe") {
      if (!shop.backend.push) return sendJson(res, 404, { error: { code: "not_found", message: "Alerts are not on for this shop." } });
      if (!csrfOk(req.headers[CSRF_HEADER])) return sendJson(res, 403, { error: { code: "bad_request", message: `Send the session's form token in ${CSRF_HEADER}.` } });
      let body: Record<string, unknown>;
      try { body = JSON.parse((await readBody(req, MAX_FORM)) ?? "") as Record<string, unknown>; } catch { return sendJson(res, 400, { error: { code: "bad_request", message: "Send JSON." } }); }
      const r = await shop.backend.push(sub === "/push/subscribe" ? { op: "owner_subscribe", subscription: body.subscription } : { op: "owner_unsubscribe", endpoint: body.endpoint }, token);
      if (r.status === 403) return gone();
      return sendJson(res, r.status === 200 ? 200 : 400, r.status === 200 ? { result: "done", phones: r.body.phones } : { error: { code: "bad_request", message: String(r.body.error ?? "That subscription was not taken.") } });
    }
    if (sub === "/push/choice") {
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      const choice = form.get("choice") ?? "";
      if (shop.backend.push && (OWNER_CHOICES as readonly string[]).includes(choice)) { const r = await shop.backend.push({ op: "owner_choice", choice }, token); if (r.status === 403) return gone(); }
      return redirect(res, `${base}/?lang=${language}&n=alerts`);
    }
    if (sub === "/manifest.webmanifest") {
      // item 11i: the installed app's icon is the character in its "all well" picture when the shop has one (a data: address, so nothing is fetched)
      const icon = app ? shop.character?.()?.picture("well", "svg") : undefined;
      const body = JSON.stringify(ownerAppManifest({ base, shop: state.view.shop.name, language, colour: themeColour(app?.character), ...(icon ? { iconSvg: icon.bytes.toString("utf8") } : {}) }));
      res.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" });
      res.end(body);
      return;
    }
    if (sub === "/sw.js") {
      // the worker may fetch only the page itself (it keeps the last one for reading offline); it never sends a tap or a message later (assistant/app/pwa.ts).
      // Item 11h: it also shows the owner's alerts, and a tap opens this page
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": Buffer.byteLength(OWNER_APP_SW), "cache-control": "no-cache", "content-security-policy": `default-src 'none'; connect-src ${base}/`, "x-content-type-options": "nosniff" });
      res.end(OWNER_APP_SW);
      return;
    }
    // ---- "Limits, tightened by a tap": the owner's limits page. Reading needs the owner's credential; changing needs a session made with a PASSKEY, which the runtime checks ----
    if (sub === "/limits" || sub === "/limits/set") {
      if (!shop.backend.limits) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
      const got = await shop.backend.limits(token);
      if (got.status === 403) return gone();
      if (got.status !== 200 || !Array.isArray(got.body.limits)) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
      const view = got.body as unknown as OwnerLimitsView;
      if (sub === "/limits") {
        const n = url.searchParams.get("n");
        return sendHtml(res, 200, withBanner(ownerLimitsPage({ base, language, view, ...(o.csrf ? { csrf: o.csrf } : {}), ...(o.signOut ? { signOut: o.signOut } : {}), ...(n === "asked" || n === "refused" ? { notice: n } : {}) }), banner), { "x-robots-tag": "noindex", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
      }
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      const row = view.limits.find((l) => l.id === form.get("limit"));
      const to = Number(form.get("to"));
      // the page's own pre-check, so the owner hears "not allowed" at once; the runtime decides again, in its step, against what is in force then
      if (!view.passkey || !row || !Number.isSafeInteger(to) || to < row.bounds.min || to > row.bounds.max || to === row.inForce) return redirect(res, `${base}/limits?lang=${language}&n=refused`);
      const r = await shop.backend.limits(token, { id: randomUUID(), limit: row.id, to });
      if (r.status === 403 && r.body.state !== "passkey_needed") return gone();
      return redirect(res, `${base}/limits?lang=${language}&n=${r.status === 200 ? "asked" : "refused"}`);
    }
    // ---- block S: the owner's listings page. Everything here is the owner's own: the runtime checks their link or session again on every call ----
    if (sub === "/listings" || sub === "/listings/op" || sub === "/listings/photo" || ownPhoto) {
      const backend = shop.backend;
      if (!backend.ownerListings) return json ? sendJson(res, 404, { error: { code: "not_found", message: "This shop has no listings." } }) : sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
      if (ownPhoto) {
        const got = await backend.listingPhoto?.(ownPhoto[1], token);
        if (!got) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
        res.writeHead(200, { "content-type": got.type, "content-length": got.bytes.length, "x-content-type-options": "nosniff", "cache-control": "private, max-age=600", "content-security-policy": "default-src 'none'", "x-robots-tag": "noindex" });
        res.end(got.bytes);
        return;
      }
      if (sub === "/listings/photo") {
        const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (type !== "image/jpeg" && type !== "image/webp") return sendJson(res, 415, { error: "Send the photo as image/jpeg or image/webp." });
        if (!csrfOk(req.headers[CSRF_HEADER])) return sendJson(res, 403, { error: `Send the session's form token in ${CSRF_HEADER}.` });
        const bytes = await readBytes(req, 1_600_000);
        if (!bytes || bytes.length === 0) return sendJson(res, 413, { error: LISTING_WORDS[language].refusal.photo.too_big, why: "too_big" });
        const r = await backend.ownerPhoto!(token, { bytes, type });
        if (r.status === 403) return gone();
        const why = typeof r.body.why === "string" ? r.body.why : undefined;
        return sendJson(res, r.status === 200 ? 200 : r.status, r.status === 200 ? { photo: r.body.photo } : { why, error: why && why in LISTING_WORDS[language].refusal.photo ? LISTING_WORDS[language].refusal.photo[why as "empty"] : LISTING_WORDS[language].refusal.photo.unreadable });
      }
      if (sub === "/listings") {
        const got = await backend.ownerListings(token);
        if (got.status === 403) return gone();
        if (got.status !== 200) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
        const nonce = randomUUID().replace(/-/gu, "");
        const n = url.searchParams.get("n") ?? undefined;
        return sendHtml(res, 200, withBanner(ownerListingsPage({ base, language, view: got.body as unknown as Parameters<typeof ownerListingsPage>[0]["view"], nonce, ...(o.csrf ? { csrf: o.csrf } : {}), ...(n && /^[a-z_]{1,30}$/u.test(n) ? { notice: n } : {}) }), banner), { "x-robots-tag": "noindex", "content-security-policy": listingsPolicy(base, nonce) });
      }
      // POST /listings/op: one form, one op; the runtime checks it against the shop's rules first and says why not
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      const num = (k: string): number | undefined => { const v = (form.get(k) ?? "").trim(); return v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v); };
      const words = (k: string): string | null => { const v = (form.get(k) ?? "").trim(); return v === "" ? null : v; };
      const id = form.get("id") ?? "";
      const kind = form.get("op");
      let op: Record<string, unknown> | undefined;
      if (kind === "publish_form") op = { op: kind, category: form.get("category") ?? "", title: (form.get("title") ?? "").trim(), photos: form.getAll("photos").slice(0, 3), ...(num("price") !== undefined ? { priceInr: num("price") } : {}), ...(words("note") ? { priceNote: words("note") } : {}) };
      else if (kind === "edit") op = { op: kind, id, ...(words("title") ? { title: words("title") } : {}), category: form.get("category") ?? undefined, priceInr: num("price") ?? null, priceNote: words("note") };
      else if (kind === "confirm") op = { op: kind, id, confirmedMs: Number(form.get("confirmedMs")) };
      else if (kind === "sold" || kind === "remove") op = { op: kind, id };
      else if (kind === "shop") {
        const lat = num("lat");
        const lon = num("lon");
        op = { op: kind, visible: form.get("visible") === "1", town: words("town"), pincode: words("pincode"), registration: words("registration"), point: lat !== undefined && lon !== undefined ? { lat, lon } : null };
      }
      if (!op) return redirect(res, `${base}/listings?lang=${language}&n=empty`);
      const r = await backend.ownerListings(token, { id: randomUUID(), op });
      if (r.status === 403) return gone();
      const why = typeof r.body.why === "string" && /^[a-z_]{1,30}$/u.test(r.body.why) ? r.body.why : "empty";
      return redirect(res, `${base}/listings?lang=${language}&n=${r.status === 200 ? "saved" : why}`);
    }
    // ---- block S phase A3: the owner's Stock page (the one shared stock count). The runtime checks the owner's link or session again on every call ----
    if (sub === "/stock" || sub === "/stock/op") {
      const backend = shop.backend;
      if (!backend.ownerStock) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
      if (sub === "/stock") {
        const got = await backend.ownerStock(token, undefined, language);
        if (got.status === 403) return gone();
        if (got.status !== 200) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
        const n = url.searchParams.get("n") ?? undefined;
        return sendHtml(res, 200, withBanner(ownerStockPage({ base, language, view: got.body as unknown as Parameters<typeof ownerStockPage>[0]["view"], rid: () => randomUUID(), ...(o.csrf ? { csrf: o.csrf } : {}), ...(n && /^[a-z_]{1,30}$/u.test(n) ? { notice: n } : {}) }), banner), { "x-robots-tag": "noindex", "content-security-policy": stockPolicy(base) });
      }
      // POST /stock/op: one form, one op; the runtime checks it against the shop's rules first and says why not. The form's `rid` is the request id, so a double tap is one change.
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      const num = (k: string): number | undefined => { const v = (form.get(k) ?? "").trim(); return v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v); };
      const id = form.get("id") ?? "";
      const kind = form.get("op");
      const rid = /^[A-Za-z0-9-]{1,64}$/u.test(form.get("rid") ?? "") ? form.get("rid")! : randomUUID();
      let op: Record<string, unknown> | undefined;
      if (kind === "start") op = { op: kind, id, count: num("count") ?? -1, ...(num("low") !== undefined ? { low: num("low") } : {}) };
      else if (kind === "correct") op = { op: kind, id, to: num("to") ?? -1, ...(num("shown") !== undefined ? { shown: num("shown") } : {}) };
      else if (kind === "sold") op = { op: kind, id, qty: num("qty") ?? 1 };
      else if (kind === "low") op = { op: kind, id, low: num("low") ?? null };
      else if (kind === "stop") op = { op: kind, id };
      if (!op) return redirect(res, `${base}/stock?lang=${language}&n=bad_count`);
      const r = await backend.ownerStock(token, { id: rid, op });
      if (r.status === 403) return gone();
      const why = typeof r.body.why === "string" && /^[a-z_]{1,30}$/u.test(r.body.why) ? r.body.why : "bad_count";
      return redirect(res, `${base}/stock?lang=${language}&n=${r.status === 200 ? "saved" : why}`);
    }
    if (app && sub === "/talk") {
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      const text = (form.get("text") ?? "").trim();
      if (text.length === 0 || text.length > OWNER_MESSAGE_MAX) return redirect(res, `${base}/?lang=${language}`);
      const before = JSON.stringify(app.talk);
      const r = await shop.backend.submit([{ kind: "owner_message", id: randomUUID(), text }], token);
      if (r === "refused") return gone();
      await settleTalk(shop, token, before, options.waitMs ?? 3_000);
      return redirect(res, `${base}/?lang=${language}`);
    }
    if (app && sub === "/voice") {
      if (!app.listen || !shop.backend.ownerVoice) return sendJson(res, 404, { error: { code: "not_found", message: "Voice is not on for this shop's assistant." } });
      const type = String(req.headers["content-type"] ?? "");
      // item 11i: Ogg Opus, or WebM Opus (what Android's Chrome records); the voice service reads the length from the bytes themselves either way
      if (!/^audio\/(ogg|webm)\b/iu.test(type)) return sendJson(res, 415, { error: { code: "bad_request", message: "Send the recording as audio/ogg or audio/webm (Opus)." } });
      if (!csrfOk(req.headers[CSRF_HEADER])) return sendJson(res, 403, { error: { code: "bad_request", message: `Send the session's form token in ${CSRF_HEADER}.` } });
      const bytes = await readBytes(req, MAX_VOICE_BYTES);
      if (!bytes || bytes.length === 0) return sendJson(res, 413, { error: { code: "bad_request", message: "A recording of at most 30 seconds." } });
      const before = JSON.stringify(app.talk);
      const r = await shop.backend.ownerVoice(token, { bytes, mime: type });
      if (r === "refused") return gone();
      if (r === "off") return sendJson(res, 404, { error: { code: "not_found", message: "Voice is not on for this shop's assistant." } });
      // listening takes longer than a press: the page reloads to show the answer either way
      return sendJson(res, 200, { result: await settleTalk(shop, token, before, (options.waitMs ?? 3_000) * 4) });
    }
    if (sub === "/api/v1/answer") {
      if (!/^application\/json\b/iu.test(String(req.headers["content-type"] ?? ""))) return sendJson(res, 415, { error: { code: "bad_request", message: "Send JSON (content-type: application/json)." } });
      let body: Record<string, unknown> | undefined;
      try { const text = await readBody(req, MAX_FORM); body = text === undefined ? undefined : JSON.parse(text) as Record<string, unknown>; } catch { body = undefined; }
      if (!body || typeof body !== "object") return sendJson(res, 400, { error: { code: "bad_request", message: 'Send {"source", "action", "case", "digest"} as the state gave them.' } });
      if (!csrfOk(req.headers[CSRF_HEADER])) return sendJson(res, 403, { error: { code: "bad_request", message: `Send the session's form token in ${CSRF_HEADER}.` } });
      const result = await ownerAnswer(shop, token, state, body);
      return sendJson(res, result === "denied_link" ? 403 : 200, { result });
    }
    if (sub === "/answer") {
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      if (!csrfOk(form.get("csrf"))) return sendHtml(res, 403, "<!doctype html><p>Forms from another page are refused.</p>");
      const result = await ownerAnswer(shop, token, state, { source: form.get("source"), action: form.get("action"), case: form.get("case"), digest: form.get("digest"), amount: form.get("amount") });
      return redirect(res, `${base}?lang=${language}&n=${result}`);
    }
    const n = url.searchParams.get("n");
    // the "leave with your shop" part of the page: for a signed-in session of a shop with the assistant only
    let leave: OwnerPageInput["leave"];
    if (ownSession && state.view.app) {
      const file = shop.backend.ownerFile ? await shop.backend.ownerFile({ session: ownSession }).catch(() => null) : null;
      leave = { file: file ?? { state: "none" }, ...(o.csrf ? { csrf: o.csrf } : {}) };
    }
    const notice = n === "alerts" ? ALERT_WORDS[language].saved : n === "leave" ? LEAVE_PAGE[language].asked : n && n in w.result ? w.result[n as keyof typeof w.result] : undefined;
    // item 11h: the owner's alerts box, when the shop has push (its runtime says so, and its public key)
    let pushState: { key: string; state: { choice: string; phones: number; whatsapp: boolean } } | undefined;
    if (shop.backend.push) {
      try {
        const k = await shop.backend.push({ op: "key" });
        const st = k.body.on === true ? await shop.backend.push({ op: "owner_state" }, token) : undefined;
        if (k.body.on === true && typeof k.body.publicKey === "string" && st?.status === 200) pushState = { key: k.body.publicKey, state: { choice: String(st.body.choice), phones: Number(st.body.phones ?? 0), whatsapp: st.body.whatsapp === true } };
      } catch (e) { log(`The shop's alerts could not be read: ${(e as Error).message}`); }
    }
    // the owner's app runs our scripts only: a fresh nonce for this response, in its content policy and on those scripts, and nothing else may run
    const nonce = app || pushState ? randomBytes(16).toString("base64") : undefined;
    // bare: the box without its script, which runs inside the page's one script (owner-page.ts, look.ts themeScript)
    const alerts = pushState ? ownerAlertsBox({ base, language, key: pushState.key, state: pushState.state, ...(o.csrf ? { csrf: o.csrf } : {}), bare: true }) : undefined;
    // item 11i: the owner's app shows the character in the shop's real mood (all five moods: this is the owner's own view)
    const facePic = state.view.app ? shop.character?.()?.picture(state.view.app.face, "svg") : undefined;
    return sendHtml(res, 200, withBanner(ownerPage({ base, language, view: state.view, relayAsks: state.relayAsks, ...(typeof token === "object" && "session" in token && shop.backend.accountantFiles ? { exportLinks: { base: `${base}/accounting` } } : {}), ...(leave ? { leave } : {}), ...(app && shop.backend.ownerStock ? { stockLink: { href: `${base}/stock?lang=${language}`, label: STOCK_LINE_WORDS[language].title } } : {}), ...(app && shop.backend.ownerListings ? { listingsLink: { href: `${base}/listings?lang=${language}`, label: LISTING_WORDS[language].owner.link } } : {}), ...(facePic ? { picture: svgDataUri(facePic.bytes) } : {}), ...(notice ? { notice } : {}), ...(o.csrf ? { csrf: o.csrf } : {}), ...(o.signOut ? { signOut: o.signOut } : {}), ...(shop.backend.limits ? { limitsLink: { href: `${base}/limits?lang=${language}`, label: LIMITS_PAGE_WORDS[language].title } } : {}), ...(ownSession && shop.backend.phones ? { phonesLink: { href: `${base}/phones?lang=${language}`, label: PHONES_WORDS[language].link } } : {}), ...(nonce ? { nonce } : {}), ...(shop.pages?.()?.partner ? { partner: shop.pages()!.partner! } : {}), ...(pushState ? { alertPhones: pushState.state.phones } : {}), ...(url.searchParams.get("first") === "1" ? { firstSignIn: true } : {}), ...(alerts ? { alerts } : {}) }), banner), { "x-robots-tag": "noindex", ...(nonce ? { "content-security-policy": appPolicy(base, nonce) } : {}) });
  }

  return (req, res) => {
    route(req, res).catch((e) => {
      log(`The front could not answer a request: ${(e as Error).message}`);
      if (!res.headersSent) {
        // the shop's runtime did not answer: in the visitor's language, with the Operator's number when this shop's file names one (partnerOf, set when the shop was found)
        const l = languageOf(req, new URL(req.url ?? "/", "http://front"), LANGUAGES);
        // a shop the shared process paused (a shop that kept stopping its worker): the "back soon" sentence, and a long Retry-After, not the generic text
        if (e instanceof BackendError && e.backSoon) return sendHtml(res, 503, shopErrorPage(l, BACK_SOON[l], partnerOf.get(res)), { "retry-after": "3600" });
        sendHtml(res, 503, shopErrorPage(l, PAGE[l].calendarUnread, partnerOf.get(res)), { "retry-after": "60" });
      }
    });
  };
}
