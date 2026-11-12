// The public front of a server's shops: https://<server>/s/<shop>/... Caddy sends /s/* here (bundle/generate/compose.ts). For each shop it serves:
//
//   GET  /s/<shop>/                      the booking page (?lang=, ?service=, ?date=)          POST /s/<shop>/book        start a booking (a form)
//   GET  /s/<shop>/b/<handle>            a booking's own page                                   POST .../b/<handle>/cancel, .../b/<handle>/paid
//   GET  /s/<shop>/qr.svg                a QR code of the booking page, for the counter
//   ...  /s/<shop>/api/v1/...            the booking API (api.ts)                               POST /s/<shop>/mcp         the same operations for AI assistants (mcp.ts)
//   GET  /s/<shop>/o/<owner token>       the owner's private approvals page                     POST /s/<shop>/o/<owner token>   an answer
//
// What it holds: for each shop, the runtime's CHANNEL token (backend.ts runtimeBackend) and, for a shop whose Guard holds refunds, the relay's token. Neither acts for
// the owner without the owner's link: the runtime and the relay check it against their own copy of its hash. What it does before anything reaches a runtime: the
// per-address limits (limits.ts), the shape of every field, and an Origin check on every form, so another site cannot post one for a visitor. It keeps nothing.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { textQrSvg } from "../qr/svg.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { apiOperation, apiRequest } from "./api.ts";
import { BackendError } from "./backend.ts";
import type { ChannelBackend, RelayBackend } from "./backend.ts";
import { HANDLE, handleHash } from "./handle.ts";
import { createLimiter } from "./limits.ts";
import type { Limiter } from "./limits.ts";
import { mcpPost } from "./mcp.ts";
import { OpError, createOps } from "./ops.ts";
import type { Ops } from "./ops.ts";
import { OWNER_TOKEN } from "./owner-link.ts";
import { OWNER, PAGE } from "./words.ts";
import { bookingPage, statusPage } from "./page.ts";
import { ownerLinkGone, ownerPage } from "./owner-page.ts";

export interface FrontShop {
  /** https://<server>/s/<shop>: every address the pages and answers give starts with it. */
  publicUrl: string;
  backend: ChannelBackend;
  /** Only for a shop whose Guard holds refunds for the owner (a gateway shop). */
  relay?: RelayBackend;
}

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

/** The front for every shop of a server, as one request handler. */
export function frontHandler(options: FrontOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const limiter = options.limiter ?? createLimiter();
  const log = options.log ?? (() => undefined);
  const ops = new Map<string, { web: Ops; mcp: Ops; page: Ops }>();
  const opsOf = (name: string, shop: FrontShop) => {
    let o = ops.get(name);
    if (!o) {
      const make = (channel: "web" | "mcp", waitMs?: number) => createOps({ backend: shop.backend, publicUrl: shop.publicUrl, channel, ...(waitMs !== undefined ? { waitMs } : {}) });
      o = { web: make("web", options.waitMs), mcp: make("mcp", options.waitMs), page: make("web", Math.min(options.waitMs ?? 2_000, 2_000)) };
      ops.set(name, o);
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

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://front");
    const m = /^\/s\/([a-z0-9][a-z0-9-]{0,39})(\/.*)?$/u.exec(url.pathname);
    const shop = m ? options.shops[m[1]] : undefined;
    if (!m || !shop) return sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
    const name = m[1];
    const rest = m[2] ?? "";
    const method = req.method ?? "GET";
    const address = addressOf(req);
    const o = opsOf(name, shop);
    const tooMany = () => sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.tooMany}</p>`, { "retry-after": "300" });

    if (rest === "") { res.writeHead(301, { location: `${shop.publicUrl}/` }); res.end(); return; }

    // ---- the API and the MCP endpoint ----
    if (rest.startsWith("/api/v1")) {
      const op = apiOperation(method, rest);
      if (!limiter.take(op === "start_booking" ? "book" : op === "cancel_booking" ? "act" : "read", address)) return sendJson(res, 429, { error: { code: "too_many", message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
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
        if (!limiter.take(tool === "start_booking" ? "book" : tool === "cancel_booking" ? "act" : "read", address)) return sendJson(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
      }
      const offer = await shop.backend.offer({});
      const answer = await mcpPost(o.mcp, offer.shop.name, body);
      if (answer.status === 202) { res.writeHead(202, { "cache-control": "no-store" }); res.end(); return; }
      return sendJson(res, answer.status, answer.body);
    }

    // ---- the owner's page ----
    const owner = /^\/o\/([^/]+)$/u.exec(rest);
    if (owner) return ownerRoute(req, res, url, shop, owner[1], address);

    // ---- the booking page ----
    if (rest === "/qr.svg" && method === "GET") {
      if (!limiter.take("read", address)) return tooMany();
      const svg = textQrSvg(`${shop.publicUrl}/`, { label: `${shop.publicUrl}/` });
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
      return sendHtml(res, 200, bookingPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, ...(offer.serviceId ? { serviceId: offer.serviceId } : {}), ...(date ? { date } : {}) }));
    }
    if (rest === "/book" && method === "POST") {
      if (!sameOrigin(req, shop)) return sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      const offerAll = await shop.backend.offer({});
      const language = languageOf(req, url, offerAll.shop.languages, form);
      const service = form.get("service") ?? "";
      const again = async (error: string, status: number) => {
        const offer = await shop.backend.offer({ serviceId: service, days: 7 });
        return sendHtml(res, status, bookingPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, serviceId: service, error, values: { name: form.get("name") ?? "", phone: form.get("phone") ?? "" } }));
      };
      if (!limiter.take("book", address)) return again(PAGE[language].tooMany, 429);
      try {
        const answer = await o.page.start_booking({ service_id: service, start: Number(form.get("start")), name: form.get("name"), phone: form.get("phone"), language }) as { handle: string };
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

  /** The owner's page and its answers. A wrong or revoked link is refused by the runtime itself; the front only counts it, so guessing is slowed too. */
  async function ownerRoute(req: IncomingMessage, res: ServerResponse, url: URL, shop: FrontShop, token: string, address: string): Promise<void> {
    const method = req.method ?? "GET";
    const base = `${shop.publicUrl}/o/${token}`;
    const fallback: Language = (LANGUAGES.includes(url.searchParams.get("lang") as Language) ? url.searchParams.get("lang") : "en") as Language;
    const gone = () => { limiter.take("wrong", address); return sendHtml(res, 403, ownerLinkGone(fallback), { "x-robots-tag": "noindex" }); };
    if (limiter.over("wrong", address)) return sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.tooMany}</p>`, { "retry-after": "3600" });
    if (!OWNER_TOKEN.test(token)) return gone();
    if (!limiter.take(method === "POST" ? "act" : "read", address)) return sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.tooMany}</p>`, { "retry-after": "300" });
    const view = await shop.backend.owner(token);
    if (!view) return gone();
    const asked = url.searchParams.get("lang");
    const language: Language = asked && LANGUAGES.includes(asked as Language) ? asked as Language : view.shop.ownerLanguage;
    const w = OWNER[language];

    if (method === "POST") {
      if (!sameOrigin(req, shop)) return sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
      const form = new URLSearchParams((await readBody(req, MAX_FORM)) ?? "");
      const source = form.get("source"); const action = form.get("action") ?? ""; const theCase = form.get("case") ?? ""; const digest = form.get("digest") ?? "";
      let result: keyof typeof w.result = "error";
      try {
        if (source === "relay" && shop.relay && (action === "approve" || action === "deny") && /^[0-9a-f]{32}$/u.test(digest)) {
          const r = await shop.relay.decide(token, theCase, digest, action);
          result = r === "refused" ? "denied_link" : r === "recorded" ? "done" : r === "expired" ? "expired" : r === "failed" ? "error" : "changed";
        } else if (source === "runtime") {
          const shown = view.items.find((i) => i.case === theCase && i.digest === digest && i.actions.includes(action));
          if (!shown) result = "changed"; // already answered (here or on WhatsApp), or changed since the page was drawn: nothing is sent
          else {
            const r = await shop.backend.submit([{ kind: "owner_action", id: randomUUID(), action: action as never, case: theCase, digest }], token);
            if (r === "refused") result = "denied_link";
            else {
              // give the step a moment, so the list the owner sees next shows the answer done
              const deadline = Date.now() + (options.waitMs ?? 3_000);
              while (Date.now() < deadline) { const now = await shop.backend.owner(token); if (!now || !now.items.some((i) => i.digest === digest)) break; await new Promise((r2) => setTimeout(r2, 200)); }
              result = "done";
            }
          }
        }
      } catch (e) { log(`An owner's answer could not be passed on: ${(e as Error).message}`); result = "error"; }
      return redirect(res, `${base}?lang=${language}&n=${result}`);
    }
    if (method !== "GET") return sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET, POST" });
    let relayAsks: Awaited<ReturnType<NonNullable<FrontShop["relay"]>["asks"]>> = [];
    if (shop.relay) { try { relayAsks = (await shop.relay.asks(token)) ?? []; } catch (e) { log(`The approvals relay could not be read: ${(e as Error).message}`); } }
    const n = url.searchParams.get("n");
    const notice = n && n in w.result ? w.result[n as keyof typeof w.result] : undefined;
    return sendHtml(res, 200, ownerPage({ base, language, view, relayAsks, ...(notice ? { notice } : {}) }), { "x-robots-tag": "noindex" });
  }

  return (req, res) => {
    route(req, res).catch((e) => {
      log(`The front could not answer a request: ${(e as Error).message}`);
      if (!res.headersSent) sendHtml(res, 503, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.calendarUnread}</p>`, { "retry-after": "60" });
    });
  };
}
