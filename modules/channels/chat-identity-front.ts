// The public front's routes for a guest's identity in the chat (W2, 17 Nov 2026): chat-front.ts hands them every address under <chat>/id:
//
//   GET  <chat>/id/state              what the page may offer this guest (keep this chat, been here before, send my link, delete) as JSON
//   POST <chat>/id/keep-options       the phone's prompt to keep this chat (a key pair, unlocked by the fingerprint, face or screen lock)
//   POST <chat>/id/keep               the phone's answer
//   POST <chat>/id/signin-options     the phone's prompt to open the chat here (for a new phone, the old one can sign it in by its QR: no restriction on where the key is)
//   POST <chat>/id/signin             the phone's answer
//   POST <chat>/id/number             the WhatsApp number the guest gives for a new phone
//   POST <chat>/id/recover            "I have a new phone": a one-use link is sent to the number (the answer is the same whether or not the shop has it)
//   POST <chat>/id/links              "send me my booking link", to the number the guest gave
//   POST <chat>/id/forget             delete my chat (the cookie is cleared with the answer)
//   GET  <chat>/id/confirm/<token>    the page the number-confirming link opens (WhatsApp, any phone): one button, a form post       POST <chat>/id/confirm   the button: the number becomes the thread's contact
//   GET  <chat>/id/back/<token>       the page the new-phone link opens: one button, which is a form post (a GET, a scanner or a preview uses nothing up)
//   POST <chat>/id/back               the button: the link is used up and this phone is tied to the thread
//
// The front keeps nothing and checks no key: it carries the browser's answers and the guest's hash (the cookie's handle hashed with the shop's name) to the runtime, which is the
// authority (chat-identity.ts). Its own work is the limits per address, the Origin check, the shape of a number, and the cookie (cleared when the chat is deleted, made when a link
// is opened on a phone with none). A parent's private chat has none of this: their link is their identity.
import { esc } from "../core/html.ts";
import { guestCookie } from "./chat-front.ts"; // used when a request is handled, never while the modules load (chat-front.ts imports this file)
import type { FrontKit, RouteArgs } from "./front.ts";
import { PAGE_POLICY, PAGE_REFERRER } from "./front.ts"; // used when a request is handled, never while the modules load (front.ts imports chat-front.ts)
import { guestHash, newGuestHandle } from "./handle.ts";
import { normalisePhone } from "./contact.ts";
import { CHAT_CSS } from "./look.ts";
import { IDENTITY } from "./words-chat-identity.ts";
import type { Language } from "../language/languages.ts";

/** The ops the page's script may name, and the runtime's op each one is. Anything else is a plain not-found. */
const OPS: Record<string, string> = { "keep-options": "keep_options", keep: "keep", "signin-options": "signin_options", signin: "signin", number: "number", recover: "recover", links: "links", forget: "forget" };

const NOT_FOUND = "<!doctype html><p>There is nothing here.</p>";
const clearCookie = (path: string): string => `__Secure-geo-chat=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export interface IdentityRouteArgs {
  /** Everything after <chat>: "/id", "/id/state", "/id/back/<token>" ... */
  sub: string;
  /** The guest's hash for this shop, from the cookie (undefined: no cookie yet). */
  hash: string | undefined;
  /** https://<page>/chat, and the cookie's path. */
  base: string;
  path: string;
  languageOf: () => Promise<Language>;
}

export async function identityRoute(kit: FrontKit, a: RouteArgs & { viaDoor: boolean }, c: IdentityRouteArgs): Promise<void> {
  const { req, res, shop, name, method, address } = a;
  const { limiter } = kit;
  const backend = shop.backend;
  const via = a.viaDoor ? "door" : "direct";
  const tooMany = () => kit.sendJson(res, 429, { error: "wait" }, { "retry-after": "60" });
  if (!backend.chatId) return kit.sendHtml(res, 404, NOT_FOUND);

  // ---- the page the number-confirming link opens (from WhatsApp, on any phone: it names a link, not a guest) ----
  const confirm = /^\/id\/confirm(?:\/([A-Za-z0-9_-]{43}))?$/u.exec(c.sub);
  if (confirm) {
    const language = await c.languageOf();
    const w = IDENTITY[language];
    const frame = (text: string, form: string, tail = "") => kit.sendHtml(res, 200, `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="${PAGE_REFERRER}"><title>${esc(w.confirmHead)}</title><style>${CHAT_CSS}</style></head><body class="chat"><main class="thread"><div class="wrap"><h1>${esc(w.confirmHead)}</h1><div class="card"><p>${esc(text)}</p>${form}</div></div></main></body></html>`, { "content-security-policy": PAGE_POLICY, "x-robots-tag": "noindex" });
    if (method === "GET" && confirm[1]) {
      if (!limiter.take("read", address) || limiter.over("wrong", address)) return kit.sendHtml(res, 429, NOT_FOUND, { "retry-after": "60" });
      const r = await backend.chatId({ op: "confirm_state", token: confirm[1], via });
      const state = (r.body.state as string | undefined) ?? "unknown";
      if (state === "unknown") limiter.take("wrong", address);
      // looking uses nothing up: the button's post does
      return state === "valid"
        ? frame(w.confirmBody, `<form method="post" action="${esc(c.base)}/id/confirm"><input type="hidden" name="token" value="${esc(confirm[1])}"><input type="hidden" name="lang" value="${language}"><button type="submit">${esc(w.confirmButton)}</button></form>`)
        : frame(state === "expired" ? w.backExpired : w.backUsed, "");
    }
    if (method === "POST" && !confirm[1]) {
      if (!kit.sameOrigin(req, shop)) return kit.sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
      if (!limiter.take("chat", address) || limiter.over("wrong", address)) return kit.sendHtml(res, 429, NOT_FOUND, { "retry-after": "60" });
      const token = new URLSearchParams((await kit.readBody(req, kit.maxForm)) ?? "").get("token") ?? "";
      const r = await backend.chatId({ op: "confirm_use", token, via });
      if (r.body.ok === true) return frame(w.confirmDone, "");
      limiter.take("wrong", address);
      return frame(r.body.state === "expired" ? w.backExpired : w.backUsed, "");
    }
    return kit.sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET, POST" });
  }

  // ---- the page the new-phone link opens ----
  const back = /^\/id\/back(?:\/([A-Za-z0-9_-]{43}))?$/u.exec(c.sub);
  if (back) {
    const language = await c.languageOf();
    const w = IDENTITY[language];
    const page = (state: "valid" | "used" | "expired" | "replaced" | "unknown", token: string, extra: Record<string, string> = {}) => {
      const text = state === "valid" ? w.backBody : state === "expired" ? w.backExpired : w.backUsed;
      const form = state === "valid" ? `<form method="post" action="${esc(c.base)}/id/back"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="lang" value="${language}"><button type="submit">${esc(w.backButton)}</button></form>` : `<p><a class="btn quiet" href="${esc(c.base)}?lang=${language}">${esc(w.backButton)}</a></p>`;
      kit.sendHtml(res, 200, `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="${PAGE_REFERRER}"><title>${esc(w.backHead)}</title><style>${CHAT_CSS}</style></head><body class="chat"><main class="thread"><div class="wrap"><h1>${esc(w.backHead)}</h1><div class="card"><p>${esc(text)}</p>${form}</div></div></main></body></html>`,
        { "content-security-policy": PAGE_POLICY, "x-robots-tag": "noindex", ...extra });
    };
    if (method === "GET") {
      if (!back[1] || !limiter.take("read", address) || limiter.over("wrong", address)) return kit.sendHtml(res, back[1] ? 429 : 404, NOT_FOUND);
      // a phone with no cookie gets one now, so the button's post has a guest to tie; the link itself is not used up by looking at it
      let cookie: string | undefined;
      let hash = c.hash;
      if (!hash && limiter.take("chatStarts", address)) { const fresh = newGuestHandle(); cookie = guestCookie(c.path, fresh); hash = guestHash(name, fresh); }
      const r = hash ? await backend.chatId({ op: "link_state", handle: hash, token: back[1], via }) : { status: 429, body: { state: "unknown" } };
      const state = (r.body.state as "valid" | "used" | "expired" | "replaced" | "unknown" | undefined) ?? "unknown";
      if (state === "unknown") limiter.take("wrong", address);
      return page(state, back[1], cookie ? { "set-cookie": cookie } : {});
    }
    if (method === "POST" && !back[1]) {
      if (!kit.sameOrigin(req, shop)) return kit.sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
      if (!limiter.take("chat", address) || limiter.over("wrong", address)) return kit.sendHtml(res, 429, NOT_FOUND, { "retry-after": "60" });
      const form = new URLSearchParams((await kit.readBody(req, kit.maxForm)) ?? "");
      const token = form.get("token") ?? "";
      if (!c.hash) return kit.sendHtml(res, 400, "<!doctype html><p>Open the link again.</p>");
      const r = await backend.chatId({ op: "use_link", handle: c.hash, token, via });
      if (r.body.ok === true) return kit.redirect(res, `${c.base}?lang=${await c.languageOf()}`);
      limiter.take("wrong", address);
      return kit.redirect(res, `${c.base}/id/back/${/^[A-Za-z0-9_-]{43}$/u.test(token) ? token : ""}`);
    }
    return kit.sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET, POST" });
  }

  // ---- what the page may offer ----
  if (c.sub === "/id/state" && method === "GET") {
    if (!limiter.take("read", address)) return tooMany();
    if (!c.hash) return kit.sendJson(res, 200, { keys: 0, here: false, number: false, work: 0, offer: false, restored: false, known: false });
    const r = await backend.chatId({ op: "state", handle: c.hash, via });
    return kit.sendJson(res, r.status, r.body);
  }

  // ---- the page's own calls ----
  const op = /^\/id\/([a-z-]+)$/u.exec(c.sub)?.[1];
  if (!op || !Object.hasOwn(OPS, op) || method !== "POST") return kit.sendHtml(res, 404, NOT_FOUND);
  if (!kit.sameOrigin(req, shop)) return kit.sendJson(res, 403, { error: "Calls from another site's page are refused." });
  if (!c.hash) return kit.sendJson(res, 400, { error: "Open the chat page first." });
  if (limiter.over("wrong", address) || !limiter.take(op === "recover" ? "signin" : "chat", address)) return tooMany();
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse((await kit.readBody(req, kit.maxJson)) || "{}") as Record<string, unknown>; } catch { return kit.sendJson(res, 400, { error: "Send JSON." }); }
  const body: Record<string, unknown> = { op: OPS[op], handle: c.hash, via, language: await c.languageOf() };
  if (op === "keep" || op === "signin") body.response = raw.response;
  if (op === "number" || op === "recover") {
    const number = normalisePhone(raw.number); // "+" and the digits with the country code, or nothing
    if (!number) return kit.sendJson(res, 400, { ok: false, reason: "bad_number" });
    body.digits = number.slice(1);
  }
  const r = await backend.chatId(body);
  if ((op === "keep" || op === "signin") && r.status !== 200) limiter.take("wrong", address);
  // the chat is gone from the shop; the phone forgets its guest too, so the next visit is a fresh guest
  return kit.sendJson(res, r.status, r.body, op === "forget" && r.status === 200 ? { "set-cookie": clearCookie(c.path) } : undefined);
}
