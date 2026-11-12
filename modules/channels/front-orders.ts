// Item 11h: the public front's routes for an Orders shop (front.ts hands them over when the shop's template is Orders; the owner's page and the QR code stay front.ts's):
//
//   GET  /s/<shop>/                      the menu page (?lang=, ?date=)                        POST /s/<shop>/order        start an order (a form)
//   GET  /s/<shop>/order/<handle>        an order's own page                                   POST .../order/<handle>/cancel, .../order/<handle>/paid
//   ...  /s/<shop>/api/v1/...            the ordering API (api.ts orderApiRequest)             POST /s/<shop>/mcp          the same operations for AI assistants
//
// The same checks as Bookings' routes, before anything reaches the runtime: the per-address limits (a start counts as a booking start, against the address and the
// shop; a cancel or a claim as an act; wrong handles as guesses), the shape of every field, and an Origin check on every form. The form sends item ids and
// quantities only: no price is ever read from a request.
import { BackendError } from "./backend.ts";
import { HANDLE, NONCE, handleFromNonce, handleHash, newHandle } from "./handle.ts";
import { orderApiOperation, orderApiRequest } from "./api.ts";
import { ordersServer, serverPost } from "./mcp.ts";
import { OpError } from "./ops.ts";
import type { OrderOps } from "./order-ops.ts";
import { menuPage, orderPage } from "./order-page.ts";
import { PAGE } from "./words.ts";
import { ORDER_PAGE } from "./words-orders-fees.ts";
import type { FrontKit, RouteArgs } from "./front.ts";

/** The order's lines from the form's `qty_<item id>` fields: only the shop's items, only quantities above zero. */
function formLines(form: URLSearchParams, itemIds: readonly string[]): { item_id: string; qty: number }[] {
  const lines: { item_id: string; qty: number }[] = [];
  for (const id of itemIds) {
    const raw = (form.get(`qty_${id}`) ?? "").trim();
    if (!/^\d{1,2}$/u.test(raw)) continue;
    const qty = Number(raw);
    if (qty > 0) lines.push({ item_id: id, qty });
  }
  return lines;
}

/** One request to an Orders shop's customer side. `ops`: the operations for the API, MCP and the page (the page waits less, so a slow step shows "pending"). */
export async function orderRoute(kit: FrontKit, a: RouteArgs, ops: { web: OrderOps; mcp: OrderOps; page: OrderOps }): Promise<void> {
  const { req, res, url, shop, name, rest, method, address, pages } = a;
  const { limiter } = kit;
  const tooMany = () => kit.sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.tooMany}</p>`, { "retry-after": "300" });
  if (!shop.backend.orderOffer) return kit.sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");

  // ---- the API and the MCP endpoint ----
  if (rest.startsWith("/api/v1")) {
    const op = orderApiOperation(method, rest);
    if (!limiter.take(op === "start_order" ? "book" : op === "cancel_order" ? "act" : "read", address) || (op === "start_order" && !limiter.take("shopStarts", `shop:${name}`))) return kit.sendJson(res, 429, { error: { code: "too_many", message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
    if (op && (op === "order_status" || op === "payment_instructions" || op === "cancel_order") && limiter.over("wrong", address)) return kit.sendJson(res, 429, { error: { code: "too_many", message: "Too many unknown handles from this address." } });
    let body: unknown;
    if (method === "POST") {
      if (!/^application\/json\b/iu.test(String(req.headers["content-type"] ?? ""))) return kit.sendJson(res, 415, { error: { code: "bad_request", message: "Send JSON (content-type: application/json)." } });
      const text = await kit.readBody(req, kit.maxJson);
      try { body = text === undefined ? undefined : JSON.parse(text); } catch { body = undefined; }
      if (body === undefined) return kit.sendJson(res, 400, { error: { code: "bad_request", message: "The body must be JSON of at most 16 KB." } });
    } else if (method !== "GET") return kit.sendJson(res, 405, { error: { code: "bad_request", message: "Use GET or POST." } }, { allow: "GET, POST" });
    const answer = await orderApiRequest(ops.web, { method, path: rest, query: url.searchParams, body, publicUrl: shop.publicUrl });
    if (answer.status === 404 && op && op !== "list_items") limiter.take("wrong", address);
    return kit.sendJson(res, answer.status, answer.body);
  }
  if (rest === "/mcp") {
    if (method !== "POST") return kit.sendJson(res, 405, { error: "This MCP endpoint answers POST with JSON; it offers no event stream." }, { allow: "POST" });
    if (!kit.sameOrigin(req, shop)) return kit.sendJson(res, 403, { error: "Calls from another site's page are refused." });
    const text = await kit.readBody(req, kit.maxJson);
    let body: unknown;
    try { body = text === undefined ? undefined : JSON.parse(text); } catch { body = undefined; }
    if (body === undefined) return kit.sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "The body must be JSON of at most 16 KB." } });
    // the same per-address limits as the page and the API: a start counts as a booking start, a cancel as an act, everything else as a read
    const messages = (Array.isArray(body) ? body : [body]) as { method?: string; params?: { name?: string } }[];
    for (const msg of messages) {
      const tool = msg?.method === "tools/call" ? msg.params?.name : undefined;
      if (!limiter.take(tool === "start_order" ? "book" : tool === "cancel_order" ? "act" : "read", address) || (tool === "start_order" && !limiter.take("shopStarts", `shop:${name}`))) return kit.sendJson(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests from this address. Wait a few minutes." } }, { "retry-after": "300" });
    }
    const offer = await shop.backend.orderOffer();
    const answer = await serverPost(ordersServer(ops.mcp, offer.shop.name), body);
    if (answer.status === 202) { res.writeHead(202, { "cache-control": "no-store" }); res.end(); return; }
    return kit.sendJson(res, answer.status, answer.body);
  }

  // ---- the menu page ----
  if (rest === "/" && method === "GET") {
    if (!limiter.take("read", address)) return tooMany();
    const offer = await shop.backend.orderOffer();
    const language = kit.languageOf(req, url, offer.shop.languages);
    const date = url.searchParams.get("date") ?? undefined;
    return kit.sendHtml(res, 200, menuPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, ...(date ? { date } : {}), nonce: newHandle(), ...(pages ? { pages } : {}) }));
  }
  if (rest === "/order" && method === "POST") {
    if (!kit.sameOrigin(req, shop)) return kit.sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
    const form = new URLSearchParams((await kit.readBody(req, kit.maxForm)) ?? "");
    const offer = await shop.backend.orderOffer();
    const language = kit.languageOf(req, url, offer.shop.languages, form);
    const date = form.get("date") ?? "";
    const slotId = form.get("slot") ?? "";
    const lines = formLines(form, offer.items.map((i) => i.id));
    const way = offer.days.find((d) => d.date === date)?.slots.find((x) => x.id === slotId)?.mode;
    const again = (error: string, status: number) => kit.sendHtml(res, status, menuPage({
      shop: { name, publicUrl: shop.publicUrl }, offer, language, date, error, nonce: newHandle(), ...(pages ? { pages } : {}),
      values: { name: form.get("name") ?? "", phone: form.get("phone") ?? "", address: form.get("address") ?? "", slot: slotId, qty: Object.fromEntries(lines.map((l) => [l.item_id, String(l.qty)])) },
    }));
    if (!limiter.take("book", address) || !limiter.take("shopStarts", `shop:${name}`)) return again(PAGE[language].tooMany, 429);
    if (lines.length === 0 || !way) return again(ORDER_PAGE[language].badForm, 400);
    // the same form sent twice (a double tap) is the same order: its handle comes from the form's nonce and what it asks for
    const nonce = form.get("nonce") ?? "";
    const fixed = NONCE.test(nonce) ? { handle: handleFromNonce(nonce, [date, slotId, JSON.stringify(lines), form.get("phone") ?? ""]) } : undefined;
    try {
      const answer = await ops.page.start_order({ items: lines, date, way, slot_id: slotId, address: form.get("address") ?? "", name: form.get("name"), phone: form.get("phone"), language }, fixed) as { handle: string };
      return kit.redirect(res, `${shop.publicUrl}/order/${answer.handle}?lang=${language}`);
    } catch (e) {
      if (e instanceof BackendError) throw e;
      return again(e instanceof OpError && e.code === "paused" ? ORDER_PAGE[language].paused : ORDER_PAGE[language].badForm, 400);
    }
  }
  const o = /^\/order\/([^/]+)(\/cancel|\/paid)?$/u.exec(rest);
  if (o) {
    const handle = o[1];
    if (limiter.over("wrong", address)) return tooMany();
    if (!HANDLE.test(handle)) { limiter.take("wrong", address); return kit.sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>"); }
    const offer = await shop.backend.orderOffer();
    const viewNow = () => shop.backend.orderView!(handleHash(handle));
    if (o[2] && method === "POST") {
      if (!kit.sameOrigin(req, shop)) return kit.sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
      const form = new URLSearchParams((await kit.readBody(req, kit.maxForm)) ?? "");
      const language = kit.languageOf(req, url, offer.shop.languages, form);
      if (!limiter.take("act", address)) return kit.sendHtml(res, 429, orderPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, handle, view: await viewNow(), notice: PAGE[language].tooMany }));
      try { if (o[2] === "/cancel") await ops.page.cancel_order({ handle }); else await ops.page.say_paid(handle); }
      catch (e) { if (e instanceof BackendError) throw e; limiter.take("wrong", address); }
      return kit.redirect(res, `${shop.publicUrl}/order/${handle}?lang=${language}`);
    }
    if (method !== "GET" || o[2]) return kit.sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" });
    if (!limiter.take("read", address)) return tooMany();
    const view = await viewNow();
    if (!view) limiter.take("wrong", address);
    const language = kit.languageOf(req, url, offer.shop.languages);
    return kit.sendHtml(res, view ? 200 : 404, orderPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, handle, view }), { "x-robots-tag": "noindex" });
  }
  return kit.sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
}
