// The directory's HTTP face: one request handler over the search, the pages, the notices, the MCP endpoint and the Agent Card. SERVER SIDE (it serves a file, the font, and
// answers sockets); it holds no state of its own beyond the in-memory per-address limits. The bundle's service (bundle/services/directory.ts) wires it to a port, a database
// file and the network; the door forwards these addresses to it.
//
//   GET  /search            the people's page (HTML), or the JSON `directory-search/1` when the caller asks for JSON (`Accept: application/json` or `format=json`)
//                           `?ask=<the buyer's own words>` (only where the buyer's assistant is on, assistant.ts): the assistant turns the words into a search; the JSON then also has `assistant`
//   GET  /search/font.woff2 Baloo 2's Latin subset (SIL OFL, channels/fonts/OFL-baloo-2.txt): the page's headings and buttons
//   GET  /order             the page that states the fair order in plain words
//   POST /feed-changed      "my feed changed" (shop-feed-changed/1): a hint only (notices.ts)
//   POST /mcp               the MCP endpoint (mcp.ts): search_listings, get_listing, shop_page, and ask where the assistant is on
//   GET  /.well-known/agent-card.json   the directory's signed A2A Agent Card
//   GET  /healthz           "ok"
//
// Privacy (specs/directory.md): no cookie is ever set, no account exists, and a search is kept as a count only. Per-address limits live in memory (limits.ts). The pages
// send `Referrer-Policy: no-referrer`, so opening a shop's chat from a result does not tell the shop what was searched. The address is the LAST entry of X-Forwarded-For
// (the door appends the real one; anything before it is the visitor's own claim), or the socket's.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serverPost } from "../channels/mcp.ts";
import { LANGS } from "./types.ts";
import type { Lang } from "./types.ts";
import { createLimiter } from "./limits.ts";
import { MAX_NOTICE_BYTES, handleNotice } from "./notices.ts";
import type { NoticeConfig } from "./notices.ts";
import { directoryServer } from "./mcp.ts";
import { EMPTY_FORM, orderPage, pagePolicy, searchPage } from "./page.ts";
import type { FormValues, PageContext, SearchView } from "./page.ts";
import { searchListings } from "./search.ts";
import { MAX_QUESTION, askListings } from "./assistant.ts";
import type { Asked, Assistant } from "./assistant.ts";
import type { SearchDeps, SearchRequest } from "./search.ts";

const MAX_MCP_BYTES = 16 * 1024;
/** What one address may do in a window. A phone shares one address with a street, so these are generous; a program that crawls is stopped. */
export const LIMITS = { search: { max: 40, perMs: 60_000 }, mcp: { max: 90, perMs: 60_000 }, notice: { max: 20, perMs: 60_000 }, pages: { max: 120, perMs: 60_000 } } as const;

export interface DirectoryHttpDeps {
  search: SearchDeps;
  /** The directory's own address, https://<pages domain>. */
  origin: string;
  /** The signed Agent Card (built once at start, or on each call if it changes). */
  card: () => Record<string, unknown>;
  notices: Omit<NoticeConfig, "index">;
  /** The buyer's assistant (assistant.ts). Left out: no "Ask in your own words" box, no `ask` tool, and the search is exactly the plain search. Made only from an approved budget. */
  assistant?: Assistant;
  now?: () => number;
  log?: (line: string) => void;
}

let font: Buffer | undefined;
const fontBytes = (): Buffer => (font ??= readFileSync(new URL("../channels/fonts/baloo-2-latin-wght-normal.woff2", import.meta.url)));

const visitorOf = (req: IncomingMessage): string => String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean).at(-1) ?? req.socket.remoteAddress ?? "unknown";

/** The language of a page: `?lang=`, else the first of the browser's languages we speak, else English. */
export function languageOf(param: string | null, acceptLanguage: string | undefined): Lang {
  if (param !== null && (LANGS as readonly string[]).includes(param)) return param as Lang;
  for (const part of String(acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if ((LANGS as readonly string[]).includes(tag)) return tag as Lang;
  }
  return "en";
}

function readBody(req: IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (Number(req.headers["content-length"] ?? 0) > max) return resolve(undefined);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > max) { resolve(undefined); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });
}

export function directoryHandler(deps: DirectoryHttpDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const now = deps.now ?? Date.now;
  const limiter = createLimiter(LIMITS, now);
  const log = deps.log ?? (() => undefined);
  const base = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

  const send = (res: ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}): void => {
    res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...base, ...extra });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void => send(res, status, JSON.stringify(value), "application/json; charset=utf-8", { "cache-control": "no-store", ...extra });
  const html = (res: ServerResponse, status: number, ctxNonce: string, body: string, extra: Record<string, string> = {}): void =>
    send(res, status, body, "text/html; charset=utf-8", { "content-security-policy": pagePolicy(deps.origin, ctxNonce), "permissions-policy": "geolocation=(self), camera=(), microphone=(), payment=()", ...extra });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", deps.origin);
    const method = req.method ?? "GET";
    const who = visitorOf(req);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/u, "") : url.pathname; // "/order/" is "/order"
    if (path === "/healthz" && method === "GET") return send(res, 200, "ok", "text/plain; charset=utf-8");

    const nonce = randomBytes(16).toString("base64url");
    const ctx = (lang: Lang): PageContext => ({ origin: deps.origin, lang, now: now(), nonce, fontUrl: "/search/font.woff2", assistant: deps.assistant !== undefined });
    const lang = languageOf(url.searchParams.get("lang"), req.headers["accept-language"]);

    if (path === "/search/font.woff2" && (method === "GET" || method === "HEAD")) {
      const bytes = fontBytes();
      res.writeHead(200, { "content-type": "font/woff2", "content-length": bytes.length, "cache-control": "public, max-age=31536000, immutable", ...base });
      return void res.end(method === "HEAD" ? undefined : bytes);
    }
    if (path === "/order" && (method === "GET" || method === "HEAD")) {
      if (!limiter.take("pages", who)) return html(res, 429, nonce, searchPage(ctx(lang), EMPTY_FORM, { state: "busy" }), { "retry-after": "60", "cache-control": "no-store" });
      return html(res, 200, nonce, orderPage(ctx(lang)), { "cache-control": "public, max-age=300" });
    }
    if (path === "/.well-known/agent-card.json" && (method === "GET" || method === "HEAD")) {
      if (!limiter.take("pages", who)) return json(res, 429, { error: "Too many requests; try again in a minute." }, { "retry-after": "60" });
      return json(res, 200, deps.card(), { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });
    }

    if (path === "/search" && (method === "GET" || method === "HEAD")) {
      const p = url.searchParams;
      const asked: SearchRequest = { q: p.get("q") ?? undefined, category: p.get("category") ?? undefined, lat: p.get("lat") ?? undefined, lon: p.get("lon") ?? undefined, town: p.get("town") ?? undefined, radius_km: p.get("radius_km") ?? undefined, lang, offset: p.get("offset") ?? undefined };
      const wantsJson = p.get("format") === "json" || (/application\/json/u.test(String(req.headers.accept ?? "")) && !/text\/html/u.test(String(req.headers.accept ?? "")));
      const ask = deps.assistant ? String(p.get("ask") ?? "").trim().slice(0, MAX_QUESTION) : "";
      let form: FormValues = { q: String(p.get("q") ?? "").slice(0, 200), category: p.get("category") ?? "", town: String(p.get("town") ?? "").slice(0, 80), lat: String(p.get("lat") ?? "").slice(0, 12), lon: String(p.get("lon") ?? "").slice(0, 12), radius_km: p.get("radius_km") ?? "" };
      if (!limiter.take("search", who)) {
        return wantsJson ? json(res, 429, { error: "Too many searches from this address; try again in a minute." }, { "retry-after": "60" }) : html(res, 429, nonce, searchPage(ctx(lang), form, { state: "busy" }), { "retry-after": "60", "cache-control": "no-store", "x-robots-tag": "noindex" });
      }
      form.ask = ask;
      const empty = !form.q && !form.category && !form.town && !form.lat && !form.lon && !ask;
      if (!wantsJson && empty) return html(res, 200, nonce, searchPage(ctx(lang), form, { state: "start" }), { "cache-control": "no-store", "x-robots-tag": "noindex" });
      let view: SearchView;
      let answer: Awaited<ReturnType<typeof searchListings>>;
      let assisted: Asked | undefined;
      try {
        if (ask !== "" && deps.assistant) {
          // "Ask in your own words": the assistant reads the question (cleaned first, never logged), the directory's own code searches and orders, a template line says it
          assisted = await askListings(deps.search, deps.assistant, { question: ask, lang, who, ...(asked.lat && asked.lon ? { lat: String(asked.lat), lon: String(asked.lon) } : {}) });
          answer = assisted.searched;
          form = { ...assisted.form, ask };
        } else answer = await searchListings(deps.search, asked);
      } catch (e) {
        log(`directory: a search failed (${(e as Error).name})`); // the error's kind only, never the search
        return wantsJson ? json(res, 503, { error: "The search is not working right now." }, { "retry-after": "120" }) : html(res, 503, nonce, searchPage(ctx(lang), form, { state: "down" }), { "retry-after": "120", "cache-control": "no-store", "x-robots-tag": "noindex" });
      }
      if (wantsJson) return json(res, answer.ok ? 200 : 400, answer.ok ? { ...answer.answer, ...(assisted ? { assistant: { how: assisted.how, search: assisted.search, line: assisted.line, notice: assisted.notice } } : {}) } : { error: answer.error }, { "access-control-allow-origin": "*", "x-robots-tag": "noindex" });
      view = !answer.ok ? { state: "bad", message: answer.error } : answer.answer.results.length === 0 ? { state: "none" } : { state: "results", answer: answer.answer };
      return html(res, answer.ok ? 200 : 400, nonce, searchPage(ctx(lang), form, view, assisted ? { line: assisted.line, notice: assisted.notice } : undefined), { "cache-control": "no-store", "x-robots-tag": "noindex" });
    }

    if (path === "/feed-changed") {
      if (method !== "POST") return json(res, 405, { error: "Use POST." }, { allow: "POST" });
      if (!limiter.take("notice", who)) return json(res, 429, { ok: false, message: "Too many notices from this address." }, { "retry-after": "60" });
      const text = await readBody(req, MAX_NOTICE_BYTES);
      let body: unknown;
      try { body = text === undefined ? undefined : JSON.parse(text); } catch { body = undefined; }
      if (body === undefined) return json(res, 400, { ok: false, message: "The body must be JSON of at most 2 KB." });
      const a = handleNotice({ index: deps.search.index, ...deps.notices, now }, body);
      return json(res, a.status, a.body);
    }

    if (path === "/mcp") {
      if (method !== "POST") return json(res, 405, { error: "This MCP endpoint answers POST with JSON; it offers no event stream." }, { allow: "POST" });
      const text = await readBody(req, MAX_MCP_BYTES);
      let body: unknown;
      try { body = text === undefined ? undefined : JSON.parse(text); } catch { body = undefined; }
      if (body === undefined) return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body must be JSON of at most 16 KB." } });
      // each tool call counts as a search against the address, as a shop's endpoint counts a call; the protocol's own messages (initialize, list) are cheap and free
      const messages = (Array.isArray(body) ? body : [body]) as { method?: string }[];
      for (const m of messages) if (!limiter.take(m?.method === "tools/call" ? "search" : "mcp", who)) return json(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests from this address; try again in a minute." } }, { "retry-after": "60" });
      const answer = await serverPost(directoryServer(deps.search, { ...(deps.assistant ? { assistant: deps.assistant } : {}), who }), body);
      if (answer.status === 202) { res.writeHead(202, { "cache-control": "no-store", ...base }); return void res.end(); }
      return json(res, answer.status, answer.body, { "access-control-allow-origin": "*" });
    }

    return send(res, 404, "Not here", "text/plain; charset=utf-8", { "cache-control": "no-store" });
  }

  return (req, res) => {
    route(req, res).catch((e) => {
      log(`directory: a request could not be answered (${(e as Error).name})`);
      if (!res.headersSent) send(res, 500, "Something went wrong", "text/plain; charset=utf-8");
    });
  };
}
