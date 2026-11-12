// Item 11h: the public front's routes for a Fees centre (front.ts hands them over when the shop's template is Fees; the owner's page and the QR code stay front.ts's):
//
//   GET  /s/<shop>/                  the centre's page: who it is, and that fees are paid from each parent's private link (no form: a number opens nothing)
//   GET  /s/<shop>/f/<link>          a parent's private page: their students' fees            POST .../f/<link>/pay, .../f/<link>/paid   (a fee, by its id)
//   GET  /s/<shop>/fee/<handle>      a payment's confirmation page, made by "I have paid"
//   A centre has no API and no MCP endpoint: a parent's fees are reached only by their private link, which an assistant has no way to be given.
//
// A typed phone number never opens a student's fees: nothing here takes one. The link is a 32-character bearer string the centre gave the parent; the front sends the
// runtime only its HASH (handle.ts parentLinkHash), and the runtime answers for the parent whose saved hash it is now, so a replaced or revoked link opens nothing at
// once. Wrong links count as guesses (limits.ts "wrong"); every form is checked for its Origin; a press goes to the runtime only for a link that opens something now,
// and the runtime checks it again in the step.
import { randomUUID } from "node:crypto";
import { HANDLE, NONCE, handleFromNonce, handleHash, newHandle, parentLinkHash } from "./handle.ts";
import { feeConfirmPage, feesCentrePage, parentLinkGone, parentPage } from "./fee-page.ts";
import { PAGE } from "./words.ts";
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
  const f = /^\/f\/([^/]+)(\/pay|\/paid)?$/u.exec(rest);
  if (f) {
    const link = f[1];
    if (limiter.over("wrong", address)) return tooMany();
    const offer = await backend.feesOffer();
    const base = `${shop.publicUrl}/f/${link}`;
    const gone = (language = kit.languageOf(req, url, offer.shop.languages)) => { limiter.take("wrong", address); return kit.sendHtml(res, 404, parentLinkGone({ shop: { name, publicUrl: shop.publicUrl }, offer, language, selfPath: base }), { "x-robots-tag": "noindex" }); };
    if (!HANDLE.test(link)) return gone();
    const linkHash = parentLinkHash(link);
    if (f[2] && method === "POST") {
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
      const handle = NONCE.test(nonce) ? handleFromNonce(nonce, [f[2], dueId]) : newHandle();
      const op = f[2] === "/pay" ? "fee_pay" : "fee_paid";
      await backend.submit([{ kind: "channel_request", id: randomUUID(), channel: "web", op, parent: linkHash, dueId, handle: handleHash(handle) }]);
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
    if (method !== "GET" || f[2]) return kit.sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" });
    if (!limiter.take("read", address)) return tooMany();
    const view = await backend.parentView(linkHash);
    if (!view) return gone();
    return kit.sendHtml(res, 200, parentPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language: kit.languageOf(req, url, offer.shop.languages), base, view, nonce: newHandle() }), { "x-robots-tag": "noindex" });
  }

  // ---- a payment's confirmation page ----
  const c = /^\/fee\/([^/]+)$/u.exec(rest);
  if (c) {
    const handle = c[1];
    if (limiter.over("wrong", address)) return tooMany();
    if (method !== "GET") return kit.sendHtml(res, 405, "<!doctype html><p>Use the page's buttons.</p>", { allow: "GET" });
    if (!HANDLE.test(handle)) { limiter.take("wrong", address); return nothing(); }
    if (!limiter.take("read", address)) return tooMany();
    const offer = await backend.feesOffer();
    const view = await backend.feeConfirmView(handleHash(handle));
    if (!view) limiter.take("wrong", address);
    return kit.sendHtml(res, view ? 200 : 404, feeConfirmPage({ shop: { name, publicUrl: shop.publicUrl }, offer, language: kit.languageOf(req, url, offer.shop.languages), handle, view }), { "x-robots-tag": "noindex" });
  }
  return nothing();
}
