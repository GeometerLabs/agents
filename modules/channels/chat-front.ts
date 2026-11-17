// The public front's routes for the chat on a shop's page (W1, 17 Nov 2026), for every kind of shop (Bookings, Orders, and a Fees centre's public questions). front.ts hands
// them every address under <shop's page>/chat before it hands the shop to its own customer routes:
//
//   GET  <page>/chat               the chat page (?lang=): drawn here with the thread, one script by a nonce. A visitor with no guest cookie gets one.
//   GET  <page>/chat/thread        the thread after a line, as JSON, and where the latest send stands (?after=N&cid=<id>)
//   POST <page>/chat/send          one send (JSON from the page's script, or the form's own post when there is no script): text, a tap, or one of the three quick taps
//   POST <page>/chat/push          "Tell me on this phone": the guest's alerts, kept by the runtime against their conversation (only after the shop has answered)
//   GET  <page>/chat/sw.js         the alerts' worker (only when the shop has push on), scope <page>/chat/ only
//   GET  <page>/chat/font.woff2    Baloo 2's Latin subset (SIL OFL, fonts/OFL-baloo-2.txt): a year's cache, named in this page's policy only
//
// Who the guest is: a random 32-byte handle in the cookie `__Secure-geo-chat`, HttpOnly, Secure, SameSite=Lax, Path=<the page's path>/chat, so the browser sends it to the chat's
// addresses and nowhere else on the shared pages origin. The front keeps nothing: it sends the runtime only guestHash(shop, handle), which names the guest at THIS shop
// alone, so another shop's guest is not found here whatever the cookie says. The front's own limits (per address, per shop, new handles per address) come before anything is sent.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { GUEST_HANDLE, guestHash, newGuestHandle } from "./handle.ts";
import { chatPage } from "./chat-page.ts";
import { identityRoute } from "./chat-identity-front.ts";
import { identityBlock } from "./chat-identity-page.ts";
import { CHAT } from "./words-chat.ts";
import type { ChatKind } from "./words-chat.ts";
import { CUSTOMER_SW } from "../push/pages.ts";
import { PAGE_POLICY } from "./front.ts"; // used when a request is handled, never while the modules load (front.ts imports this file too)
import type { FrontKit, RouteArgs } from "./front.ts";
import { checkChannelEvent } from "./events.ts";
import type { ChannelEvent } from "./events.ts";
import type { Language } from "../language/languages.ts";
import type { Personality } from "../assistant/personality.ts";
import { PERSONALITIES } from "../assistant/personality.ts";

export const CHAT_COOKIE = "__Secure-geo-chat";
/** The cookie lives as long as a thread is kept by default (the runtime's retention is the same 30 days). */
const COOKIE_SECONDS = 30 * 24 * 3600;

/** The guest's handle from the request's cookies, if one of the right shape is there. */
export function guestFromCookie(header: string | undefined): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at < 0 || part.slice(0, at).trim() !== CHAT_COOKIE) continue;
    const value = part.slice(at + 1).trim();
    if (GUEST_HANDLE.test(value)) return value;
  }
  return undefined;
}

/** The Set-Cookie of a guest's handle, scoped to the chat's own path: HttpOnly (no script reads it), Secure, SameSite=Lax. */
export const guestCookie = (path: string, handle: string): string => `${CHAT_COOKIE}=${handle}; Path=${path}; Max-Age=${COOKIE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;

/**
 * The chat page's content policy: PAGE_POLICY and exactly what the page needs, each at its own address (the pages origin is shared by every shop, so nothing says 'self'):
 * its one script by this response's nonce, the three calls it makes, its alerts' worker, and the one font (this page only; every other page keeps PAGE_POLICY).
 */
export const chatPolicy = (base: string, nonce: string): string =>
  `${PAGE_POLICY}; script-src 'nonce-${nonce}'; connect-src ${base}/send ${base}/thread ${base}/push ${base}/id/; worker-src ${base}/sw.js; font-src ${base}/font.woff2`;

let font: Buffer | undefined;
const fontBytes = (): Buffer => (font ??= readFileSync(new URL("./fonts/baloo-2-latin-wght-normal.woff2", import.meta.url)));

const NOT_FOUND = "<!doctype html><p>There is nothing here.</p>";

/** The shop's public part of its offer, whichever template it is: what the head and the empty chat are drawn from. */
async function shopOf(a: RouteArgs, kind: ChatKind) {
  const b = a.shop.backend;
  if (kind === "orders" && b.orderOffer) return (await b.orderOffer()).shop;
  if (kind === "fees" && b.feesOffer) return (await b.feesOffer()).shop;
  return (await b.offer({})).shop;
}

/**
 * `parent` (W2): the chat on a parent's private fee page, reached by front-fees.ts at <page>/f/<link>/chat with `rest` rewritten to start at "/chat". The parent's link is the
 * identity: there is no cookie, no guest and no keys, the runtime opens the link's hash to the parent's own thread, and the page's note says the chat is theirs.
 */
export async function chatRoute(kit: FrontKit, a: RouteArgs & { viaDoor: boolean; parent?: { link: string; hash: string } }): Promise<void> {
  const { req, res, url, shop, name, rest, method, address } = a;
  const { limiter } = kit;
  const backend = shop.backend;
  const kind: ChatKind = shop.kind ?? "bookings";
  if (!backend.chat) return kit.sendHtml(res, 404, NOT_FOUND);
  const parent = a.parent;
  const base = parent ? `${shop.publicUrl}/f/${parent.link}/chat` : `${shop.publicUrl}/chat`;
  const path = `${new URL(shop.publicUrl).pathname.replace(/\/$/u, "")}/chat`;
  const sub = rest === "/chat" || rest === "/chat/" ? "" : rest.slice("/chat".length);
  const handle = parent ? undefined : guestFromCookie(req.headers.cookie);
  const hash = parent ? parent.hash : handle ? guestHash(name, handle) : undefined;
  const tooMany = (language: Language) => kit.sendJson(res, 429, { error: CHAT[language].rate }, { "retry-after": "60" });

  if (sub === "/font.woff2" && method === "GET") {
    const bytes = fontBytes();
    res.writeHead(200, { "content-type": "font/woff2", "content-length": bytes.length, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
    res.end(bytes);
    return;
  }

  // W2: a guest's identity (keep this chat, a new phone, delete my chat); a parent's chat has none, their link is who they are
  if (sub === "/id" || sub.startsWith("/id/")) {
    if (parent) return kit.sendHtml(res, 404, NOT_FOUND);
    return identityRoute(kit, a, { sub, hash, base, path, languageOf: async () => kit.languageOf(req, url, (await shopOf(a, kind)).languages) });
  }

  if (sub === "/sw.js" && method === "GET") {
    const k = backend.push && !parent ? await backend.push({ op: "key" }).catch(() => undefined) : undefined;
    if (!k || k.body.on !== true) return kit.sendHtml(res, 404, NOT_FOUND);
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": Buffer.byteLength(CUSTOMER_SW), "cache-control": "no-cache", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" });
    res.end(CUSTOMER_SW);
    return;
  }

  if (sub === "/thread" && method === "GET") {
    if (!limiter.take("read", address)) return tooMany("en");
    if (!hash) return kit.sendJson(res, 200, { lines: [], answered: false, capped: false, retentionDays: 30 });
    const after = Number(url.searchParams.get("after") ?? "0");
    const cid = url.searchParams.get("cid") ?? undefined;
    const read = await backend.chat(hash, { ...(Number.isInteger(after) && after > 0 ? { after } : {}), ...(cid && /^[A-Za-z0-9-]{1,64}$/u.test(cid) ? { cid } : {}), ...(parent ? { parent: parent.hash } : {}) });
    return kit.sendJson(res, 200, read);
  }

  if (sub === "/push" && method === "POST") {
    if (!kit.sameOrigin(req, shop)) return kit.sendJson(res, 403, { error: "Calls from another site's page are refused." });
    if (!backend.push || !hash || parent || !limiter.take("chat", address)) return kit.sendJson(res, backend.push && hash ? 429 : 404, { error: "Alerts are not on here." });
    let body: Record<string, unknown>;
    try { body = JSON.parse((await kit.readBody(req, kit.maxForm)) ?? "") as Record<string, unknown>; } catch { return kit.sendJson(res, 400, { error: "Send JSON." }); }
    const r = await backend.push({ op: "customer_subscribe", handle: hash, subscription: body.subscription });
    return kit.sendJson(res, r.status === 200 ? 200 : r.status === 403 ? 403 : r.status === 404 ? 404 : 400, r.status === 200 ? { result: "done" } : { error: String(r.body.error ?? "That was not taken.") });
  }

  if (sub === "/send" && method === "POST") {
    if (!kit.sameOrigin(req, shop)) return kit.sendJson(res, 403, { error: "Calls from another site's page are refused." });
    const json = /^application\/json\b/iu.test(String(req.headers["content-type"] ?? ""));
    const text = await kit.readBody(req, kit.maxForm);
    let raw: Record<string, unknown> = {};
    try { raw = json ? JSON.parse(text ?? "") as Record<string, unknown> : Object.fromEntries(new URLSearchParams(text ?? "")); } catch { return kit.sendJson(res, 400, { error: "Send JSON." }); }
    const offer = await shopOf(a, kind);
    const language = offer.languages.includes(raw.lang as Language) ? raw.lang as Language : kit.languageOf(req, url, offer.languages);
    const back = (notice?: "rate") => kit.redirect(res, `${base}?lang=${language}${notice ? "&notice=rate" : ""}`);
    if (!hash) return json ? kit.sendJson(res, 400, { error: "Open the chat page first." }) : back();
    if (!limiter.take("chat", address) || !limiter.take("shopChats", `shop:${name}`)) return json ? tooMany(language) : back("rate");
    const id = typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/u.test(raw.id) ? raw.id : randomUUID();
    const event = { kind: "chat_message", id, handle: hash, language, ...(parent ? { parent: parent.hash } : {}), ...(raw.tap !== undefined ? { tap: raw.tap } : raw.quick !== undefined ? { quick: Number(raw.quick) } : { text: raw.text }) };
    const checked = checkChannelEvent(event);
    if (!checked.ok) return json ? kit.sendJson(res, 400, { error: checked.error }) : back();
    const r = await backend.submit([checked.event as ChannelEvent]);
    if (r === "slow") return json ? tooMany(language) : back("rate");
    return json ? kit.sendJson(res, 200, { ok: true, id }) : back();
  }

  if (sub === "" && method === "GET") {
    if (!limiter.take("read", address)) return kit.sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${CHAT.en.rate}</p>`, { "retry-after": "60" });
    const offer = await shopOf(a, kind);
    const language = kit.languageOf(req, url, offer.languages);
    let cookie: string | undefined;
    let guest = hash;
    if (!guest && !parent) {
      // a fresh handle costs nothing to make, so how often one address asks for one is counted; past it the page still opens (read-only) and sends nothing until the cookie comes
      if (limiter.take("chatStarts", address)) { const fresh = newGuestHandle(); cookie = guestCookie(path, fresh); guest = guestHash(name, fresh); }
    }
    const thread = guest ? await backend.chat(guest, parent ? { parent: parent.hash } : {}) : { lines: [], answered: false, capped: false, retentionDays: 30 };
    const key = backend.push && !parent ? await backend.push({ op: "key" }).catch(() => undefined) : undefined;
    const pushKey = key?.body.on === true && typeof key.body.publicKey === "string" ? key.body.publicKey : undefined;
    const nonce = randomBytes(16).toString("base64");
    const read = thread as { personality?: string; paint?: string };
    const personality = (PERSONALITIES as readonly string[]).includes(read.personality ?? "") ? read.personality as Personality : undefined;
    const html = chatPage({
      shop: offer, kind, language, base, home: parent ? `${shop.publicUrl}/f/${parent.link}` : shop.publicUrl, nonce, thread,
      identity: identityBlock({ language, base, ...(parent ? { parent: { back: `${shop.publicUrl}/f/${parent.link}?lang=${language}` } } : {}) }),
      ...(personality ? { personality } : {}), ...(read.paint ? { paint: read.paint } : {}), ...(pushKey ? { pushKey } : {}),
      onStreetlist: a.viaDoor, fontUrl: `${base}/font.woff2`, ...(url.searchParams.get("notice") === "rate" ? { notice: "rate" as const } : {}),
    });
    return kit.sendHtml(res, 200, html, { "content-security-policy": chatPolicy(base, nonce), "x-robots-tag": "noindex", ...(cookie ? { "set-cookie": cookie } : {}) });
  }

  return kit.sendHtml(res, 404, NOT_FOUND);
}


