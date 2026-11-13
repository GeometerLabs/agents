// The public front of a server's shops: https://<server>/s/<shop>/... Caddy sends /s/* here (bundle/generate/compose.ts). For each shop it serves:
//
//   GET  /s/<shop>/                      the booking page (?lang=, ?service=, ?date=)          POST /s/<shop>/book        start a booking (a form)
//   GET  /s/<shop>/b/<handle>            a booking's own page                                   POST .../b/<handle>/cancel, .../b/<handle>/paid
//   GET  /s/<shop>/qr.svg                a QR code of the booking page, for the counter
//   ...  /s/<shop>/api/v1/...            the booking API (api.ts)                               POST /s/<shop>/mcp         the same operations for AI assistants (mcp.ts)
//   GET  /s/<shop>/o/<owner token>       the owner's private approvals page                     POST /s/<shop>/o/<owner token>   an answer
//   ...  /s/<shop>/owner/...             item 11f: the owner's view, signed in by a one-time link on WhatsApp (owner-session.ts)
//   With the shop's assistant (item 11e), both owner addresses are also the owner's app: <owner base>/ (the page), /manifest.webmanifest, /sw.js, /talk (the talk
//   box's words) and /voice (a hold-to-record recording); the page's one script runs by a nonce in that response's content policy (appPolicy).
//
// Item 11i, the shop's character: every shop's mood pictures (drawn on its server, bundle/character/render.ts) are public at stable addresses, for the shop's own
// page, Streetlist and WhatsApp (which fetches the PNG and WebP itself):
//   GET  /s/<shop>/character/<well|needs|wrong|closed|busy>.<svg|png|webp>   one mood's picture: an ETag (its sha256), a day's cache, `?v=` ignored (links carry it)
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
import { ownerLinkGone, ownerPage } from "./owner-page.ts";
import type { OwnerCred } from "./backend.ts";
import { CSRF_HEADER, csrfMatches, ownerSessionRoute } from "./owner-session.ts";
import type { PagesFile } from "./pages-file.ts";
import { MAX_VOICE_BYTES } from "./owner-audio.ts";
import { OWNER_MESSAGE_MAX } from "./events.ts";
import { OWNER_APP_SW, ownerAppManifest } from "../assistant/app/pwa.ts";
import { createOrderOps } from "./order-ops.ts";
import type { OrderOps } from "./order-ops.ts";
import { orderRoute } from "./front-orders.ts";
import { feeRoute } from "./front-fees.ts";
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
  kind?: "bookings" | "orders" | "fees";
  /** Item 11i: the shop's character pictures (character-files.ts characterReader over its folder), read on every request. Left out: the shop shows no face. */
  character?: () => CharacterFiles | undefined;
}

/** Item 11i: the picture addresses the front answers: one mood, or `now`, in one of the three formats. */
const PICTURE_PATH = new RegExp(`^/character/(${[...FACES, "now"].join("|")})\\.(${PICTURE_FORMATS.join("|")})$`, "u");

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
  languageOf(req: IncomingMessage, url: URL, offered: readonly Language[], form?: URLSearchParams): Language;
  sameOrigin(req: IncomingMessage, shop: FrontShop): boolean;
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

/** The pages' content policy: no script at all, nothing loaded from anywhere, no frame, forms only to this site, no referrer. */
export const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "content-security-policy": PAGE_POLICY, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" };
/**
 * The owner's app page (item 11e, on the owner's link and the signed-in view): PAGE_POLICY and exactly what the app needs, each at its own address under the owner's
 * base: its one inline script by this response's nonce, the recording's POST, its service worker and its manifest. The pages origin is shared by every shop on the
 * pages domain, so nothing here says 'self': no other page there may run script, register a worker or be posted to. Every other page keeps PAGE_POLICY.
 */
export const appPolicy = (base: string, nonce: string): string =>
  `${PAGE_POLICY}; script-src 'nonce-${nonce}'; connect-src ${base}/voice; worker-src ${base}/sw.js; manifest-src ${base}/manifest.webmanifest`;
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
  const kit: FrontKit = { limiter, log, ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}), maxForm: MAX_FORM, maxJson: MAX_JSON, sendHtml, sendJson, redirect, readBody, languageOf, sameOrigin };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://front");
    const m = /^\/s\/([a-z0-9][a-z0-9-]{0,39})(\/.*)?$/u.exec(url.pathname);
    const found = m ? options.shops[m[1]] : undefined;
    if (!m || !found) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    // item 11f: through the front door, every address is written under the pages domain, but only for the slug this shop's own pages file names
    const pages = found.pages?.();
    const door = req.headers[DOOR_HEADER];
    const doorShop: FrontShop = typeof door === "string" && pages?.slug !== undefined && pages.url !== undefined && door === pages.slug ? { ...found, publicUrl: pages.url } : found;
    // item 11i: every offer a page is drawn from carries the shop's public face (withFace)
    const shop: FrontShop = found.character ? { ...doorShop, backend: withFace(doorShop.backend, found.character) } : doorShop;
    const name = m[1];
    const rest = m[2] ?? "";
    const method = req.method ?? "GET";
    const address = addressOf(req);
    const o = opsOf(name, shop);
    const tooMany = () => sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.tooMany}</p>`, { "retry-after": "300" });

    if (rest === "") { res.writeHead(301, { location: `${shop.publicUrl}/` }); res.end(); return; }

    // ---- item 11i: the character's pictures (every template's shop has them) ----
    const picture = PICTURE_PATH.exec(rest);
    if (picture) return pictureRoute(req, res, found, picture[1] as Face | "now", picture[2] as PictureFormat, method, address);

    // item 11h: an Orders shop's and a Fees centre's customer side are their own; the owner's page and the QR code below are every shop's
    const ownerPath = /^\/o\/[^/]+(\/.*)?$/u.test(rest) || rest === "/owner" || rest.startsWith("/owner/");
    if ((shop.kind === "orders" || shop.kind === "fees") && !ownerPath && rest !== "/qr.svg") {
      const args: RouteArgs = { req, res, url, shop, name, rest, method, address, ...(pages ? { pages } : {}) };
      return shop.kind === "orders" ? orderRoute(kit, args, orderOpsOf(name, shop)) : feeRoute(kit, args);
    }

    // ---- the API and the MCP endpoint ----
    if (rest.startsWith("/api/v1")) {
      const op = apiOperation(method, rest);
      if (!limiter.take(op === "start_booking" ? "book" : op === "cancel_booking" ? "act" : "read", address) || (op === "start_booking" && !limiter.take("shopStarts", `shop:${name}`))) return sendJson(res, 429, { error: { code: "too_many", message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
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
        if (!limiter.take(tool === "start_booking" ? "book" : tool === "cancel_booking" ? "act" : "read", address) || (tool === "start_booking" && !limiter.take("shopStarts", `shop:${name}`))) return sendJson(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
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
        limiter, sendHtml, sendJson, readBody,
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
    const b = /^\/b\/([^/]+)(\/cancel|\/paid)?$/u.exec(rest);
    if (b) {
      const handle = b[1];
      if (limiter.over("wrong", address)) return tooMany();
      if (!HANDLE.test(handle)) { limiter.take("wrong", address); return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>"); }
      const offer = await shop.backend.offer({});
      if (b[2] && method === "POST") {
        if (!sameOrigin(req, shop)) return sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
        const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
        const language = languageOf(req, url, offer.shop.languages, form);
        if (!limiter.take("act", address)) return sendHtml(res, 429, statusPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, handle, view: await shop.backend.view(handleHash(handle)), notice: PAGE[language].tooMany }));
        try { if (b[2] === "/cancel") await o.page.cancel_booking({ handle }); else await o.page.say_paid(handle); }
        catch (e) { if (e instanceof BackendError) throw e; limiter.take("wrong", address); }
        return redirect(res, `${shop.publicUrl}/b/${handle}?lang=${language}`);
      }
      if (method !== "GET" || b[2]) return sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" });
      if (!limiter.take("read", address)) return tooMany();
      const view = await shop.backend.view(handleHash(handle));
      if (!view) limiter.take("wrong", address);
      const language = languageOf(req, url, offer.shop.languages);
      return sendHtml(res, view ? 200 : 404, statusPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, handle, view }), { "x-robots-tag": "noindex" });
    }
    return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
  }

  /**
   * Item 11i: one of the shop's mood pictures. A fixed mood is cached a day (its address changes with the set's `?v=`, and its ETag with its bytes); `now` is the
   * mood the public sees at this minute, asked of the runtime, and cached a minute. Images only, with their own strict policy (an SVG opened on its own runs no
   * script and loads nothing). Readable from any site (Streetlist shows the faces), never framed.
   */
  async function pictureRoute(req: IncomingMessage, res: ServerResponse, found: FrontShop, face: Face | "now", format: PictureFormat, method: string, address: string): Promise<void> {
    if (method !== "GET" && method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" }); res.end(); return; }
    // only `now` asks the runtime, so only it counts against the address's reads; a fixed mood is a small file, and WhatsApp's fetchers (many shops' pictures from a
    // few addresses at 08:00) must not be refused one, or the morning template whose header it is would not be delivered
    if (face === "now" && !limiter.take("read", address)) { res.writeHead(429, { "retry-after": "60", "cache-control": "no-store" }); res.end(); return; }
    const files = found.character?.();
    let mood: Face | undefined = face === "now" ? undefined : face;
    if (face === "now" && files) mood = (await found.backend.offer({})).shop.character?.face; // the runtime's own answer: no picture is needed to pick one
    const pic = files && mood ? files.picture(mood, format) : undefined;
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
  async function ownerAnswer(shop: FrontShop, token: OwnerCred, state: NonNullable<Awaited<ReturnType<typeof ownerState>>>, a: { source?: unknown; action?: unknown; case?: unknown; digest?: unknown }): Promise<OwnerResult> {
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
        if (!card || (action === "card_no" && !card.hasNo)) return "changed";
        const r = await shop.backend.submit([{ kind: "owner_action", id: randomUUID(), action, case: theCase, digest }], token);
        if (r === "refused") return "denied_link";
        const deadline = Date.now() + (options.waitMs ?? 3_000);
        while (Date.now() < deadline) { const now = await shop.backend.owner(token); if (!now || !now.app?.cards.some((c) => c.id === theCase)) return "done"; await new Promise((r2) => setTimeout(r2, 200)); }
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
      ...state.view.items.map((i) => ({ source: "runtime", kind: i.kind, case: i.case, digest: i.digest, actions: i.actions, amount_paise: i.amountPaise, customer: i.customer, channel: i.channel, ...(i.serviceId ? { service_id: i.serviceId } : {}), ...(i.what ? { what: i.what } : {}), ...(i.startMs !== undefined ? { start_ms: i.startMs } : {}), ...(i.why ? { why: i.why } : {}) })),
    ],
    upcoming: state.view.upcoming,
    // item 11h (Fees): the parents and their private links, answered like the items: {"source": "runtime", "action": "send_link" | "revoke_link", "case": <ref>, "digest"}
    ...(state.view.parents ? { parents: state.view.parents.map((p) => ({ source: "runtime", case: p.ref, digest: p.digest, phone: p.phone, students: p.students, link: p.link, ...(p.sinceMs !== undefined ? { since_ms: p.sinceMs } : {}), actions: p.link === "active" ? ["send_link", "revoke_link"] : ["send_link"] })) } : {}),
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
    const json = sub.startsWith("/api/") || sub === "/voice";
    const fallback: Language = (LANGUAGES.includes(url.searchParams.get("lang") as Language) ? url.searchParams.get("lang") : "en") as Language;
    const gone = () => {
      if (o.onGone) return o.onGone(); // a session that ended is not a guess: no wrong count, back to sign in
      limiter.take("wrong", address); return json ? sendJson(res, 403, { error: { code: "denied_link", message: OWNER.en.result.denied_link } }) : sendHtml(res, 403, ownerLinkGone(fallback), { "x-robots-tag": "noindex" });
    };
    const slow = (retry: string) => (json ? sendJson(res, 429, { error: { code: "too_many", message: PAGE.en.tooMany } }, { "retry-after": retry }) : sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.tooMany}</p>`, { "retry-after": retry }));
    if (limiter.over("wrong", address)) return slow("3600");
    if (typeof token === "string" && !OWNER_TOKEN.test(token)) return gone();
    /** A signed-in owner's POST must carry the session's form token; the panel's link is its own secret and needs none. */
    const csrfOk = (given: unknown) => o.csrf === undefined || (typeof token === "object" && "session" in token && csrfMatches(token.session, given));
    // item 11e: the owner's app lives at the same base: the page also at "<base>/" (a service worker controls only pages inside its scope, <base>/), and its four routes
    const routes: Record<string, string> = { "": "GET", "/": "GET", "/answer": "POST", "/api/v1/state": "GET", "/api/v1/answer": "POST", "/manifest.webmanifest": "GET", "/sw.js": "GET", "/talk": "POST", "/voice": "POST" };
    if (routes[sub] === undefined) return json ? sendJson(res, 404, { error: { code: "not_found", message: "GET /api/v1/state or POST /api/v1/answer." } }) : sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    if (routes[sub] !== method) return json ? sendJson(res, 405, { error: { code: "bad_request", message: `Use ${routes[sub]} here.` } }, { allow: routes[sub] }) : sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: routes[sub] });
    if (!limiter.take(method === "POST" ? "act" : "read", address)) return slow("300");
    if (method === "POST" && !sameOrigin(req, shop)) return json ? sendJson(res, 403, { error: { code: "bad_request", message: "Calls from another site's page are refused." } }) : sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
    const state = await ownerState(shop, token);
    if (!state) return gone();
    const asked = url.searchParams.get("lang");
    const language: Language = asked && LANGUAGES.includes(asked as Language) ? asked as Language : state.view.shop.ownerLanguage;
    const w = OWNER[language];

    if (sub === "/api/v1/state") return sendJson(res, 200, ownerJson(state), { "x-robots-tag": "noindex" });

    // ---- item 11e: the owner's app (only for a shop with the assistant) ----
    const app = state.view.app;
    if (!app && (sub === "/manifest.webmanifest" || sub === "/sw.js" || sub === "/talk" || sub === "/voice")) return json ? sendJson(res, 404, { error: { code: "not_found", message: "This shop has no assistant." } }) : sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    if (app && sub === "/manifest.webmanifest") {
      // item 11i: the installed app's icon is the character in its "all well" picture when the shop has one (a data: address, so nothing is fetched)
      const icon = shop.character?.()?.picture("well", "svg");
      const body = JSON.stringify(ownerAppManifest({ base, shop: state.view.shop.name, language, colour: themeColour(app.character), ...(icon ? { iconSvg: icon.bytes.toString("utf8") } : {}) }));
      res.writeHead(200, { "content-type": "application/manifest+json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" });
      res.end(body);
      return;
    }
    if (app && sub === "/sw.js") {
      // the worker may fetch only the page itself (it keeps the last one for reading offline); it never sends a tap or a message later (assistant/app/pwa.ts)
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": Buffer.byteLength(OWNER_APP_SW), "cache-control": "no-cache", "content-security-policy": `default-src 'none'; connect-src ${base}/`, "x-content-type-options": "nosniff" });
      res.end(OWNER_APP_SW);
      return;
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
      if (!/^audio\/ogg\b/iu.test(type)) return sendJson(res, 415, { error: { code: "bad_request", message: "Send the recording as audio/ogg (Opus)." } });
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
      const result = await ownerAnswer(shop, token, state, { source: form.get("source"), action: form.get("action"), case: form.get("case"), digest: form.get("digest") });
      return redirect(res, `${base}?lang=${language}&n=${result}`);
    }
    const n = url.searchParams.get("n");
    const notice = n && n in w.result ? w.result[n as keyof typeof w.result] : undefined;
    // the owner's app runs one script of ours: a fresh nonce for this response, in its content policy and on that script, and nothing else may run
    const nonce = app ? randomBytes(16).toString("base64") : undefined;
    // item 11i: the owner's app shows the character in the shop's real mood (all five moods: this is the owner's own view)
    const facePic = state.view.app ? shop.character?.()?.picture(state.view.app.face, "svg") : undefined;
    return sendHtml(res, 200, ownerPage({ base, language, view: state.view, relayAsks: state.relayAsks, ...(facePic ? { picture: svgDataUri(facePic.bytes) } : {}), ...(notice ? { notice } : {}), ...(o.csrf ? { csrf: o.csrf } : {}), ...(o.signOut ? { signOut: o.signOut } : {}), ...(nonce ? { nonce } : {}) }), { "x-robots-tag": "noindex", ...(nonce ? { "content-security-policy": appPolicy(base, nonce) } : {}) });
  }

  return (req, res) => {
    route(req, res).catch((e) => {
      log(`The front could not answer a request: ${(e as Error).message}`);
      if (!res.headersSent) sendHtml(res, 503, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.calendarUnread}</p>`, { "retry-after": "60" });
    });
  };
}
