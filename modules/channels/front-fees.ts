// Item 11h: the public front's routes for a Fees centre (front.ts hands them over when the shop's template is Fees; the owner's page and the QR code stay front.ts's):
//
//   GET  /s/<shop>/                  the centre's page: who it is, and that fees are paid from each parent's private link (no form: a number opens nothing)
//   GET  /s/<shop>/f/<link>          a parent's private page: their students' fees            POST .../f/<link>/pay, .../f/<link>/paid   (a fee, by its id)
//   GET  /s/<shop>/fee/<handle>      a payment's confirmation page, made by "I have paid"
//   GET  .../f/<link>/d/<number>, .../fee/<handle>/d/<number>   one of that page's own receipts (receipts.ts); another parent's number is a plain not-found
//   A centre has no API and no MCP endpoint: a parent's fees are reached only by their private link, which an assistant has no way to be given.
//
// A typed phone number never opens a student's fees: nothing here takes one. The link is a 32-character bearer string the centre gave the parent; the front sends the
// runtime only its HASH (handle.ts parentLinkHash), and the runtime answers for the parent whose saved hash it is now, so a replaced or revoked link opens nothing at
// once. Wrong links count as guesses (limits.ts "wrong"); every form is checked for its Origin; a press goes to the runtime only for a link that opens something now,
// and the runtime checks it again in the step.
import { randomBytes, randomUUID } from "node:crypto";
import { CUSTOMER_SW, customerAlertsBox } from "../push/pages.ts";
import { HANDLE, NONCE, handleFromNonce, handleHash, newHandle, parentLinkHash } from "./handle.ts";
import { feeConfirmPage, feesCentrePage, parentLinkGone, parentPage } from "./fee-page.ts";
import { PAGE } from "./words.ts";
import { DOCUMENT_SUB, documentHtml, receiptsBox, receiptsOf } from "./receipts.ts";
import type { FrontKit, RouteArgs } from "./front.ts";

const DUE_ID = /^f-\d{1,9}$/u;

/** One request to a Fees centre's customer side. */
export async function feeRoute(kit: FrontKit, a: RouteArgs): Promise<void> {
  const { req, res, url, shop, name, rest, method, address, pages } = a;
  const { limiter } = kit;
  const backend = shop.backend;
  const tooMany = () => kit.sendHtml(res, 429, `<!doctype html><meta charset="utf-8"><p>${PAGE.en.tooMany}</p>`, { "retry-after": "300" });
  const nothing = () => kit.sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
  if (!backend.feesOffer || !backend.parentView || !backend.feeConfirmView) return nothing();
  if (rest.startsWith("/api/") || rest === "/api" || rest === "/mcp") return kit.sendJson(res, 404, { error: { code: "not_found", message: "A centre's fees are reached only by a parent's private link: there is no API or MCP endpoint here." } });

  if (rest === "/" && method === "GET") {
    if (!limiter.take("read", address)) return tooMany();
    const offer = await backend.feesOffer();
    return kit.sendHtml(res, 200, feesCentrePage({ shop: { name, publicUrl: shop.publicUrl }, offer, language: kit.languageOf(req, url, offer.shop.languages), ...(pages ? { pages } : {}) }));
  }

  // ---- a parent's private page ----
  // "<link>/" is the page too: a tapped alert opens its worker's scope, which ends in a slash
  const f = /^\/f\/([^/]+)(\/|\/pay|\/paid|\/sw\.js|\/push|\/d\/.+)?$/u.exec(rest);
  if (f) {
    const link = f[1];
    if (limiter.over("wrong", address)) return tooMany();
    const offer = await backend.feesOffer();
    const base = `${shop.publicUrl}/f/${link}`;
    const gone = (language = kit.languageOf(req, url, offer.shop.languages)) => { limiter.take("wrong", address); return kit.sendHtml(res, 404, parentLinkGone({ shop: { name, publicUrl: shop.publicUrl }, offer, language, selfPath: base }), { "x-robots-tag": "noindex" }); };
    if (!HANDLE.test(link)) return gone();
    const linkHash = parentLinkHash(link);
    const sub = f[2] === "/" ? undefined : f[2];
    // batch 3: a parent's alerts on their private page, keyed by the PARENT (the runtime finds them by the link's hash now), so a link made again after a restart does
    // not lose them. The worker is scoped to this page's address, as a booking page's is.
    if (sub === "/push") {
      if (method !== "POST") return kit.sendJson(res, 405, { error: "POST" }, { allow: "POST" });
      if (!kit.sameOrigin(req, shop)) return kit.sendJson(res, 403, { error: "Calls from another site's page are refused." });
      if (!backend.push || !limiter.take("act", address)) return kit.sendJson(res, backend.push ? 429 : 404, { error: "Alerts are not on here." });
      let body: Record<string, unknown>;
      try { body = JSON.parse((await kit.readBody(req, kit.maxForm)) ?? "") as Record<string, unknown>; } catch { return kit.sendJson(res, 400, { error: "Send JSON." }); }
      const r = await backend.push({ op: "customer_subscribe", handle: linkHash, subscription: body.subscription });
      if (r.status === 404) limiter.take("wrong", address);
      return kit.sendJson(res, r.status === 200 ? 200 : r.status === 404 ? 404 : 400, r.status === 200 ? { result: "done" } : { error: String(r.body.error ?? "That was not taken.") });
    }
    if (sub === "/sw.js" && method === "GET") {
      const k = backend.push && (await backend.parentView(linkHash)) ? await backend.push({ op: "key" }).catch(() => undefined) : undefined;
      if (!k || k.body.on !== true) return kit.sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "content-length": Buffer.byteLength(CUSTOMER_SW), "cache-control": "no-cache", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" });
      res.end(CUSTOMER_SW);
      return;
    }
    if ((sub === "/pay" || sub === "/paid") && method === "POST") {
      if (!kit.sameOrigin(req, shop)) return kit.sendHtml(res, 403, "<!doctype html><p>Forms from another site are refused.</p>");
      const form = new URLSearchParams((await kit.readBody(req, kit.maxForm)) ?? "");
      const language = kit.languageOf(req, url, offer.shop.languages, form);
      if (!limiter.take("act", address)) return tooMany();
      const view = await backend.parentView(linkHash);
      if (!view) return gone(language); // only a link that opens something now sends anything; the runtime checks it again in the step
      const dueId = form.get("due") ?? "";
      if (!DUE_ID.test(dueId) || !view.dues.some((d) => d.id === dueId)) return kit.redirect(res, `${base}?lang=${language}`);
      // a double tap is one press: the handle comes from the page's nonce and what it asks for
      const nonce = form.get("nonce") ?? "";
      const handle = NONCE.test(nonce) ? handleFromNonce(nonce, [f[2]!, dueId]) : newHandle();
      const op = sub === "/pay" ? "fee_pay" : "fee_paid";
      await backend.submit([{ kind: "channel_request", id: randomUUID(), channel: "web", op, parent: linkHash, dueId, handle: handleHash(handle), ...(op === "fee_paid" && form.get("upi_ref") ? { upiRef: form.get("upi_ref")! } : {}) }]);
      if (op === "fee_paid") return kit.redirect(res, `${shop.publicUrl}/fee/${handle}?lang=${language}`);
      // "show how to pay": wait a little for the step, so the page that follows shows the payment details
      const deadline = Date.now() + Math.min(kit.waitMs ?? 2_000, 2_000);
      while (Date.now() < deadline) {
        const now = await backend.parentView(linkHash);
        if (!now || now.dues.find((d) => d.id === dueId)?.pay) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      return kit.redirect(res, `${base}?lang=${language}`);
    }
    if (method !== "GET" || (sub && !sub.startsWith("/d/"))) return kit.sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" });
    if (!limiter.take("read", address)) return tooMany();
    const view = await backend.parentView(linkHash);
    if (!view) return gone();
    const language = kit.languageOf(req, url, offer.shop.languages);
    // this parent's receipts: only those of the fees this link opens now (the runtime finds them by the link's hash, so another parent's number is a plain not-found)
    const docs = await receiptsOf(backend, { link: linkHash }, language);
    const docPath = sub ? DOCUMENT_SUB.exec(sub) : null;
    if (docPath) {
      const page = documentHtml(docs, docPath[1], offer.shop.contact?.phone);
      if (!page) { limiter.take("wrong", address); return nothing(); }
      return kit.sendHtml(res, 200, page, { "x-robots-tag": "noindex" });
    }
    const key = backend.push ? await backend.push({ op: "key" }).catch(() => undefined) : undefined;
    const publicKey = key?.body.on === true && typeof key.body.publicKey === "string" ? key.body.publicKey : undefined;
    const scriptNonce = publicKey ? randomBytes(16).toString("base64") : undefined;
    let alerts: string | undefined;
    if (scriptNonce) {
      const st = await backend.push!({ op: "customer_state", handle: linkHash }).catch(() => undefined);
      alerts = customerAlertsBox({ page: base, language, key: publicKey!, phones: Number(st?.body.phones ?? 0), nonce: scriptNonce });
    }
    return kit.sendHtml(res, 200, parentPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, base, view, nonce: newHandle(), receipts: receiptsBox(docs, base, language), ...(alerts ? { alerts } : {}) }), { "x-robots-tag": "noindex", ...(scriptNonce ? { "content-security-policy": kit.customerPolicy(base, scriptNonce) } : {}) });
  }

  // ---- a payment's confirmation page ----
  const c = /^\/fee\/([^/]+)(\/d\/.+)?$/u.exec(rest);
  if (c) {
    const handle = c[1];
    if (limiter.over("wrong", address)) return tooMany();
    if (method !== "GET") return kit.sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" });
    if (!HANDLE.test(handle)) { limiter.take("wrong", address); return nothing(); }
    if (!limiter.take("read", address)) return tooMany();
    const offer = await backend.feesOffer();
    const view = await backend.feeConfirmView(handleHash(handle));
    if (!view) limiter.take("wrong", address);
    const language = kit.languageOf(req, url, offer.shop.languages);
    // the receipts of the fee this confirmation is about (found by the handle's hash, as the page itself is)
    const docs = view && "ref" in view ? await receiptsOf(backend, { handle: handleHash(handle) }, language) : [];
    const docPath = c[2] ? DOCUMENT_SUB.exec(c[2]) : null;
    if (docPath) {
      const page = documentHtml(docs, docPath[1], offer.shop.contact?.phone);
      if (!page) { limiter.take("wrong", address); return nothing(); }
      return kit.sendHtml(res, 200, page, { "x-robots-tag": "noindex" });
    }
    return kit.sendHtml(res, view ? 200 : 404, feeConfirmPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language, handle, view, receipts: receiptsBox(docs, `${shop.publicUrl}/fee/${handle}`, language) }), { "x-robots-tag": "noindex" });
  }
  return nothing();
}
