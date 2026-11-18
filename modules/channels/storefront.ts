// The shop's storefront, "What we have" (block S, phase A, owner 18 Nov 2026): the page that shows a shop's listings as photo tiles, the open feed at `<shop's page>/listings.json`, and
// the shop's photos at their exact addresses. Rendered by the public front (front.ts) from what the runtime says the PUBLIC may see (backend.ts `listings`): only live listings the owner
// confirmed within the last 30 days, with the price the OWNER set (or "Ask the shop"), how fresh each is in words ("Confirmed today", "Call to check"), and for each a button that opens the
// shop's chat with that listing named ("Ask about this").
//
// Search engines: the shop's pages are `noindex`, and this is the ONE page that drops it, and only while the owner's switch "Show my shop on Streetlist and in search" is on. With the switch on
// the page also carries schema.org JSON-LD and the same data is served at /listings.json; with it off the page is still there for anyone with the address (noindex), and no feed is served.
// A customer's page, a booking, an order, a fee page and the chat stay `noindex` always.
//
// The look is Streetlist's (look.ts: flat colours, the head's green, Baloo 2 for the heading when the shop has the chat's font), 360 px first, every tile with an accessible name, no script.
//
// Block S phase B2, the shop's open protocol: `listings.json` is SIGNED with the shop's own key and `<page>/agent-card.json` is the shop's A2A Agent Card (also signed), both served only while the
// owner's switch is on. The key is the runtime's, never this process's: the front asks the runtime (backend.ts shopFeed, shopCard) for each signed document and passes it on. A shop whose
// runtime cannot sign serves no feed and no card (an unsigned feed is one no directory would take). `POST <page>/api/v1/check` is a shop operation, not a storefront route (ops.ts checkItemsOp).
//
// Photos: `GET <page>/listings/photo/<id>.jpg|webp`, an address built from the photo's own id (never an uploaded name), with its own type, `nosniff` and a year's cache. The page's content policy
// names that one folder in its single `img-src` (never 'self'), like the chat's character pictures.
import { createHash } from "node:crypto";
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import { FEED_MAX_BYTES, buildJsonLd, jsonForScript, photoPath } from "../listings/feed.ts";
import { stateOfPublic } from "../listings/kit.ts";
import type { PublicListingsRead } from "../listings/kit.ts";
import { freshnessOf, isVisible, textIn } from "../listings/listings.ts";
import type { Listing } from "../listings/listings.ts";
import { PHOTO_ID } from "../listings/photo.ts";
import { LISTING_WORDS, freshnessLine, priceLine } from "../listings/words.ts";
import type { Offer } from "./backend.ts";
import type { FrontKit, RouteArgs } from "./front.ts";
import { PAGE_POLICY } from "./front.ts"; // used when a request is handled, never while the modules load (front.ts imports this file)
import { layout } from "./page.ts";
import type { PagesFile } from "./pages-file.ts";
import { shopCard, skillsFor } from "./shop-card.ts";

/** The content policy of the storefront: PAGE_POLICY with its single `img-src` widened by the photos' own folder (and the font's one address when it has one). Never 'self', never a second img-src. */
export const storefrontPolicy = (publicUrl: string, font?: string): string =>
  `${PAGE_POLICY.replace("img-src data:", `img-src data: ${publicUrl}/listings/photo/`)}${font ? `; font-src ${font}` : ""}`;

/** One flat colour per category: a tile with no photo wears it, and its edge carries it. Colours only, never a gradient. */
const CATEGORY_COLOUR: Record<string, string> = { pets: "#f6a609", food: "#d4402a", clothes: "#c4386f", home: "#2e9e5b", electronics: "#285ea8", vehicles: "#5763a8", services: "#136650", other: "#4c585b" };

const STOREFRONT_CSS = `
.sf h2{font-family:var(--display,inherit);font-size:1.5rem;margin:0 0 4px}
.sf .reg{margin:0 0 12px}
.sf-grid{display:grid;gap:12px;grid-template-columns:1fr;margin:12px 0}
@media (min-width:600px){.sf-grid{grid-template-columns:1fr 1fr}}
.sf-tile{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-top:6px solid var(--c,#4c585b);border-radius:14px;overflow:hidden;box-shadow:var(--tile)}
.sf-ph{aspect-ratio:4/3;background:var(--c,#4c585b);display:flex;align-items:center;justify-content:center;color:#fff;font-size:2.4rem;font-weight:800;font-family:var(--display,inherit)}
.sf-ph img{width:100%;height:100%;object-fit:cover;display:block}
.sf-in{padding:12px 14px;display:grid;gap:6px}
.sf-in h3{margin:0;font-family:var(--display,inherit);font-size:1.15rem}
.sf-price{font-weight:800;font-size:1.1rem}
.sf-fresh{display:inline-block;width:fit-content;padding:2px 10px;border-radius:999px;font-size:.88rem;font-weight:650}
.sf-fresh.fresh{background:var(--ok-bg);color:var(--ok)}
.sf-fresh.check{background:var(--wait-bg);color:var(--wait)}
.sf-in .btn{margin-top:4px}
`;

/** The storefront page. `about` marks a listing the visitor came for (its tile is the first target of the address's #fragment). */
export function storefrontPage(o: {
  shop: { name: string; publicUrl: string }; offer: Offer; language: Language; read: PublicListingsRead; nowMs: number; chat: boolean; fontUrl?: string; pages?: PagesFile;
}): string {
  const w = LISTING_WORDS[o.language];
  const { read } = o;
  const state = stateOfPublic(read);
  const visible = isVisible(state);
  const page = `${o.shop.publicUrl}/shop`;
  const feedShop = { name: o.shop.name, page: o.shop.publicUrl, ...(o.offer.shop.contact?.phone ? { phone: o.offer.shop.contact.phone } : {}) };
  // the owner's own word for a pet shop's registration: shown beside the pets, as theirs, never as checked
  const hasPets = read.listings.some((l) => l.category === "pets");
  const anyMachine = read.listings.some((l) => textIn(l, o.language).machine);
  const colourOf = (c: string): string => CATEGORY_COLOUR[c] ?? CATEGORY_COLOUR.other;
  const tile = (l: Listing): Raw => {
    const t = textIn(l, o.language);
    const photo = l.photos[0];
    const fresh = freshnessOf(l, o.nowMs) === "fresh" ? "fresh" : "check";
    const category = (w.categories as Record<string, string>)[l.category] ?? l.category;
    const ask = o.chat ? `${o.shop.publicUrl}/chat?about=${l.id}&lang=${o.language}` : o.offer.shop.contact?.phone ? `tel:${o.offer.shop.contact.phone.replace(/[^+\d]/gu, "")}` : undefined;
    return html`<article class="sf-tile" id="${l.id}" style="--c:${colourOf(l.category)}" aria-labelledby="${l.id}-t">
<div class="sf-ph">${photo ? html`<img src="${o.shop.publicUrl}${photoPath(photo.id, photo.type)}" width="${photo.width}" height="${photo.height}" alt="${w.photoOf(t.title)}" loading="lazy" decoding="async">` : html`<span aria-hidden="true">${[...t.title][0] ?? ""}</span>`}</div>
<div class="sf-in"><h3 id="${l.id}-t">${t.title}</h3>
<p class="sf-price">${priceLine(l.pricePaise, l.priceNote, o.language)}${l.qty !== undefined ? html` <small>· ${w.quantity(l.qty)}</small>` : ""}</p>
${t.text ? html`<p>${t.text}</p>` : ""}
${l.claims && l.claims.length > 0 ? html`<p class="note">${w.ownerSays(l.claims.join("; "))}</p>` : ""}
<p><small class="note">${category}</small></p>
<span class="sf-fresh ${fresh}">${freshnessLine(fresh, l.confirmedMs ?? l.publishedMs ?? l.createdMs, o.nowMs, o.language)}</span>
${ask ? html`<a class="btn" href="${ask}">${w.askAbout}</a>` : ""}</div></article>`;
  };
  const body = html`<section class="sf" aria-labelledby="sf-h"><h2 id="sf-h">${w.heading}</h2>
${hasPets && read.shop.registration ? html`<p class="reg note">${w.registration(read.shop.registration)}</p>` : ""}
${anyMachine ? html`<p class="machine">${w.machine}</p>` : ""}
${read.listings.length > 0 ? html`<div class="sf-grid">${read.listings.map(tile)}</div>` : html`<p class="card">${w.empty}</p>`}</section>`;
  const font = o.fontUrl ? `@font-face{font-family:"Baloo 2";font-style:normal;font-weight:400 800;font-display:swap;src:url(${o.fontUrl}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122}:root{--display:"Baloo 2",system-ui,sans-serif}` : "";
  // schema.org data and the canonical address: only while the switch is on
  const head = visible
    ? raw(`<link rel="canonical" href="${page.replace(/"/gu, "&quot;")}"><link rel="alternate" type="application/json" title="shop-feed/1" href="${o.shop.publicUrl.replace(/"/gu, "&quot;")}/listings.json"><link rel="alternate" type="application/json" title="A2A Agent Card" href="${o.shop.publicUrl.replace(/"/gu, "&quot;")}/agent-card.json"><script type="application/ld+json">${jsonForScript(buildJsonLd(state, feedShop, o.language, o.nowMs))}</script>`)
    : undefined;
  return layout({
    shop: o.offer.shop, language: o.language, title: w.pageTitle(o.shop.name), body, selfPath: page, css: font + STOREFRONT_CSS, indexable: visible,
    ...(head ? { headExtra: head } : {}),
  });
}

/** The storefront's public addresses under a shop's page. `/shop` is the page, `/listings.json` the signed open feed, `/agent-card.json` the signed Agent Card, `/listings/photo/<id>.<ext>` a photo. */
export async function storefrontRoute(kit: FrontKit, a: RouteArgs): Promise<void> {
  const { req, res, url, shop, name, rest, method, address } = a;
  const nothing = () => kit.sendHtml(res, 404, "<!doctype html><p>There is nothing here.</p>");
  const backend = shop.backend;
  if (!backend.listings) return nothing();
  if (method !== "GET" && !(method === "HEAD" && (rest === "/listings.json" || rest === "/agent-card.json"))) return kit.sendHtml(res, 405, "<!doctype html><p>Use GET here.</p>", { allow: "GET" });
  if (!kit.limiter.take("read", address)) return kit.sendHtml(res, 429, "<!doctype html><p>Too many requests. Wait a few minutes.</p>", { "retry-after": "300" });

  // a photo, by its own id
  const photo = /^\/listings\/photo\/(ph-[0-9a-f]{12})\.(jpg|webp)$/u.exec(rest);
  if (photo) {
    if (!PHOTO_ID.test(photo[1]) || !backend.listingPhoto) return nothing();
    const got = await backend.listingPhoto(photo[1]);
    // the type the runtime read from the bytes decides, and must agree with the address's extension: a photo has exactly one address
    if (!got || got.type !== (photo[2] === "jpg" ? "image/jpeg" : "image/webp")) { kit.limiter.take("wrong", address); return nothing(); }
    res.writeHead(200, { "content-type": got.type, "content-length": got.bytes.length, "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable", "content-security-policy": "default-src 'none'", "cross-origin-resource-policy": "cross-origin" });
    res.end(got.bytes);
    return;
  }

  const read = await backend.listings();
  if (!read) return nothing();
  const nowMs = Date.now();

  // the open feed (shop-feed/1): only while the owner's switch is on; GET and HEAD; an ETag, so a reader that sends If-None-Match gets 304 when nothing changed. The runtime builds it and signs it with the
  // shop's key; a signed feed is the same bytes until the shop's record changes (Ed25519 signs the same bytes the same way), so the ETag moves only when the feed does.
  if (rest === "/listings.json" || rest === "/agent-card.json") {
    if (!isVisible(stateOfPublic(read)) || (rest === "/listings.json" ? !backend.shopFeed : !backend.shopCard)) return nothing();
    const offer = await backend.offer({});
    let signed: Record<string, unknown> | null;
    if (rest === "/listings.json") {
      signed = await backend.shopFeed!({ page: shop.publicUrl, name: offer.shop.name, languages: offer.shop.languages, ...(backend.chat ? { chat: `${shop.publicUrl}/chat` } : {}) });
    } else {
      const { skills, mcp } = skillsFor(shop.kind ?? "bookings");
      signed = await backend.shopCard!({ page: shop.publicUrl, card: shopCard({ name: offer.shop.name, page: `${shop.publicUrl}/`, skills, mcp }) });
    }
    if (!signed) return nothing(); // the runtime says the shop shows nothing (the switch is off there, or it has no key)
    const body = JSON.stringify(signed);
    if (rest === "/listings.json" && Buffer.byteLength(body) > FEED_MAX_BYTES) return kit.sendJson(res, 500, { error: "The feed is over 1 MB." });
    const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
    const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=300", etag, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, { ...headers, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(method === "HEAD" ? undefined : body);
    return;
  }

  // the page
  if (rest === "/shop") {
    const offer = backend.feesOffer ? await backend.feesOffer() : await backend.offer({});
    const language = kit.languageOf(req, url, offer.shop.languages);
    const visible = isVisible(stateOfPublic(read));
    const fontUrl = backend.chat ? `${shop.publicUrl}/chat/font.woff2` : undefined;
    const body = storefrontPage({ shop: { name: offer.shop.name || name, publicUrl: shop.publicUrl }, offer: offer as Offer, language, read, nowMs, chat: backend.chat !== undefined, ...(fontUrl ? { fontUrl } : {}), ...(a.pages ? { pages: a.pages } : {}) });
    return kit.sendHtml(res, 200, body, { "content-security-policy": storefrontPolicy(shop.publicUrl, fontUrl), ...(visible ? {} : { "x-robots-tag": "noindex" }) });
  }
  return nothing();
}

