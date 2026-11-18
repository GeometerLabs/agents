// The search page for people, and the page that states the order in plain words (specs/directory.md). Server-rendered HTML, no script needed: the search is a plain form
// (GET /search), the results are a list of photo cards, and every state has a page of its own (start, results, nothing found, a request that did not work, "wait a minute",
// "not working right now"). The one script (by the response's nonce) only adds a "Use my location" button: without it the page does everything else, and the button stays hidden.
//
// The look is Streetlist's (modules/channels/look.ts, the same style sheet the shops' pages use): limewash paper and ink, flat colours, Baloo 2 for the headings and buttons, the
// phone's own font for the words (so Hindi, Malayalam and Kannada stay on the fonts every Android phone has), 360 px first, every tap target at least 44 px, nothing that moves.
// Colour carries meaning as it does on the shops' pages: green for "confirmed", amber for "call to check".
//
// What a card says, in words a visitor needs: the shop's photo (or a flat tile in the kind's colour), the title in the visitor's language, the price or "Ask the shop", how fresh
// ("Confirmed today", "Call to check"), how far (or the town), the shop's name, and "Chat with the shop" (the shop's own chat, with `?about=<id>`). Words an assistant wrote are
// marked. A photo is shown only when it is served from this directory's own address (the pages domain), so opening the page never tells another server who looked.
//
// Pure: it returns strings (and the policy and the script), reads nothing and sends nothing.
import { esc } from "../core/html.ts";
import { CUSTOMER_CSS } from "../channels/look.ts";
import { PAINTS } from "../channels/chat-paint.ts";
import { CATEGORIES, LANGS } from "./types.ts";
import type { Lang } from "./types.ts";
import { DIRECTORY_WORDS, LANGUAGE_LABEL } from "./words.ts";
import type { DirectoryWords } from "./words.ts";
import { dayOf } from "./search.ts";
import type { SearchAnswer, SearchResultItem } from "./search.ts";

/** What the form shows (the buyer's own request, as typed). */
export interface FormValues { q: string; category: string; town: string; lat: string; lon: string; radius_km: string; /** The buyer's words in the "Ask in your own words" box, when they used it. */ ask?: string }
export const EMPTY_FORM: FormValues = { q: "", category: "", town: "", lat: "", lon: "", radius_km: "" };

export type SearchView =
  | { state: "start" }
  | { state: "results"; answer: SearchAnswer }
  | { state: "none" }
  | { state: "bad"; message: string }
  | { state: "busy" }
  | { state: "down" };

export interface PageContext { origin: string; lang: Lang; now: number; nonce: string; fontUrl: string; /** The buyer's assistant is on (assistant.ts): the page shows the "Ask in your own words" box. Off: the page is exactly the plain search. */ assistant?: boolean }

/** What the assistant adds over the results: the short line and, when the words were searched as typed, the one plain notice. */
export interface AssistBits { line: string | null; notice: string | null }

/** The page's content policy: nothing loads but this origin's own photos and the one font; the one script by its nonce; the form posts to /search and nowhere else. */
export const pagePolicy = (origin: string, nonce: string): string =>
  `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'nonce-${nonce}'; form-action ${origin}/search ${origin}/search/ask; frame-ancestors 'none'; base-uri 'none'; connect-src 'none'`;

const FONT_FACE = (url: string): string => `@font-face{font-family:"Baloo 2";font-style:normal;font-weight:400 800;font-display:swap;src:url(${url}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;

/**
 * What a card with no photo shows: a flat tile in one of the five signboard paints Streetlist's own shops wear (channels/chat-paint.ts; each with the one text colour that
 * reads on it at AA), by the item's kind. No new colours are made here.
 */
const KIND_PAINT: Record<string, keyof typeof PAINTS | undefined> = { pets: "marigold", food: "green", clothes: "pink", home: "blue", electronics: "blue", vehicles_and_cycles: "brick", services: "green", other: undefined };
const KIND_TILES = Object.entries(KIND_PAINT).map(([kind, paint]) => (paint ? `.k-${kind}{--k:${PAINTS[paint].hex};--ki:${PAINTS[paint].ink}}` : `.k-${kind}{--k:var(--plain-bg);--ki:var(--ink)}`)).join("");

/** The page's own styles, on top of the shops' style sheet: the form, the photo cards, the kinds' flat colours. Flat colours only, as everywhere. */
const CSS = `
:root{--display:"Baloo 2",system-ui,sans-serif}
h1,h2,.btn,button,.chip{font-family:var(--display)}
.top{background:var(--head);padding:16px 0 14px;margin-bottom:16px}
.top h1{margin:0 0 4px;font-size:1.7rem}
.top p{margin:0;color:var(--soft)}
.top .langs{margin:12px 0 0}
form.search{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:6px 14px 16px;margin:0 0 18px}
form.search label{display:block;margin:14px 0 6px;font-weight:650}
form.search input[type=search],form.search input[type=text],form.search select{width:100%;min-height:48px;padding:10px 12px;border:1.5px solid var(--line2);border-radius:12px;background:var(--card);color:var(--ink);font:inherit}
form.search select{appearance:auto}
form.search .note{margin:6px 0 0}
details.choices{margin:6px 0 0}details.choices summary{display:list-item;padding:11px 0;min-height:44px;cursor:pointer;font-weight:650;color:var(--green)}
form.search .pair{display:grid;gap:0 12px}
@media (min-width:30rem){form.search .pair{grid-template-columns:1fr 1fr}}
#near{margin-top:12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;padding:0}
.chip{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;background:var(--card);border:1.5px solid var(--line2);color:var(--ink);text-decoration:none;font-weight:600}
.chip:hover{border-color:var(--ink)}
.count{margin:0 0 12px;font-weight:650;color:var(--soft)}
.results{display:grid;gap:14px;margin:0;padding:0}
.res{display:grid;overflow:hidden;padding:0;margin:0}
.ph{position:relative;aspect-ratio:4/3;background:var(--k,var(--plain-bg));display:flex;align-items:center;justify-content:center;color:var(--ki,var(--ink));font:650 1.2rem var(--display)}
.ph.no{aspect-ratio:16/5}
.ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.res .body{padding:12px 14px 14px}
.res h2{margin:0 0 6px;font-size:1.25rem}
.tag{display:inline-block;margin:0 0 8px;padding:.15em .6em;border-radius:8px;background:var(--wait-bg);color:var(--wait);font-size:.85rem}
.price{margin:0 0 8px;font:700 1.3rem var(--display)}
.price.ask{font-weight:600;color:var(--soft);font-size:1.1rem}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0 0 6px}
.stamp.ok{background:var(--ok);color:#fff}.stamp.wait{background:var(--mari);color:#2a1a00}
.shop{margin:0 0 4px;font-weight:650}.shop span{font-weight:400;color:var(--soft)}
.res .btn{margin-top:10px;width:100%}
.note.why{margin:4px 0 0}
.more{display:flex;margin:18px 0 0}
.askline{margin:0 0 12px;font-weight:650}
form.ask{margin-bottom:12px}
${KIND_TILES}
.state-page{margin:8px 0 18px}
.state-page h2{margin-top:0}
ol.order{margin:0 0 8px;padding:0 0 0 1.3rem}ol.order li{margin:0 0 .7em}
.never{border-left:6px solid var(--ok);background:var(--ok-bg);border-radius:14px;padding:12px 14px;margin:18px 0}
.never h2{margin:0 0 4px;font-size:1.1rem}.never p{margin:0}
footer.foot{display:flex;flex-wrap:wrap;gap:0 18px;align-items:center}
`;

/** The one script: it shows "Use my location", and on a tap fills the two hidden fields (about a kilometre of detail: two decimals) and sends the form. Nothing else. */
const NEAR_SCRIPT = `(function(){var b=document.getElementById("near");if(!b||!navigator.geolocation)return;b.hidden=false;b.addEventListener("click",function(){b.disabled=true;navigator.geolocation.getCurrentPosition(function(p){var f=b.form;f.elements.lat.value=p.coords.latitude.toFixed(2);f.elements.lon.value=p.coords.longitude.toFixed(2);f.submit()},function(){b.disabled=false},{timeout:10000,maximumAge:600000})})})();`;

const rupees = (value: string): string => {
  const n = Number(value);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** "Confirmed today", "Confirmed yesterday", "Confirmed 3 days ago", from the date the shop last confirmed, counted in India's days. */
export function freshness(w: DirectoryWords, confirmed: string, now: number): string {
  const days = Math.round((Date.parse(`${dayOf(now)}T00:00:00Z`) - Date.parse(`${dayOf(Date.parse(confirmed))}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? w.confirmedToday : days === 1 ? w.confirmedYesterday : w.confirmedDays(days);
}

export const km = (n: number): string => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

/** An address on this directory with these parameters (empty ones left out). */
export function link(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

const formParams = (f: FormValues, lang: Lang, extra: Record<string, string | undefined> = {}) => ({ q: f.q, category: f.category, town: f.town, lat: f.lat, lon: f.lon, radius_km: f.radius_km, lang: lang === "en" ? undefined : lang, ...extra });

function head(ctx: PageContext, title: string, o: { noindex: boolean }): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  return `<!doctype html><html lang="${ctx.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">${o.noindex ? '<meta name="robots" content="noindex">' : ""}<title>${esc(title)} · ${esc(w.title)}</title><style>${FONT_FACE(ctx.fontUrl)}${CUSTOMER_CSS}${CSS}</style></head><body>`;
}

/** The four languages as links that keep the search (the language you read in is the one you are in). */
function langNav(ctx: PageContext, path: string, params: Record<string, string | undefined>): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  return `<nav class="langs" aria-label="${esc(w.language)}">${LANGS.map((l) => (l === ctx.lang ? `<b aria-current="true" lang="${l}">${esc(LANGUAGE_LABEL[l])}</b>` : `<a lang="${l}" hreflang="${l}" href="${esc(link(path, { ...params, lang: l === "en" ? undefined : l }))}">${esc(LANGUAGE_LABEL[l])}</a>`)).join("")}</nav>`;
}

function foot(ctx: PageContext): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  return `<footer class="foot wrap"><a href="${esc(link("/order", { lang: ctx.lang === "en" ? undefined : ctx.lang }))}">${esc(w.orderLink)}</a><a href="/.well-known/agent-card.json" lang="en">${esc(w.assistants)}</a><span>${esc(w.foot)}</span></footer>`;
}

function form(ctx: PageContext, f: FormValues): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  const located = f.lat !== "" && f.lon !== "";
  const kinds = [`<option value=""${f.category === "" ? " selected" : ""}>${esc(w.anyKind)}</option>`, ...CATEGORIES.map((c) => `<option value="${c}"${f.category === c ? " selected" : ""}>${esc(w.kinds[c])}</option>`)].join("");
  const radii = [`<option value=""${f.radius_km === "" ? " selected" : ""}>${esc(w.anyDistance)}</option>`, ...[5, 10, 25, 50].map((n) => `<option value="${n}"${f.radius_km === String(n) ? " selected" : ""}>${esc(w.km(n))}</option>`)].join("");
  const open = f.category !== "" || f.radius_km !== "" || f.town !== "" || located;
  return `<form class="search" action="/search" method="get" role="search">
<label for="q">${esc(w.searchLabel)}</label><input id="q" name="q" type="search" value="${esc(f.q)}" placeholder="${esc(w.placeholder)}" maxlength="200" autocomplete="off" enterkeyhint="search">
<details class="choices"${open ? " open" : ""}><summary>${esc(w.choices)}</summary>
<div class="pair"><div><label for="category">${esc(w.kindLabel)}</label><select id="category" name="category">${kinds}</select></div>
<div><label for="radius">${esc(w.radiusLabel)}</label><select id="radius" name="radius_km">${radii}</select></div></div>
<label for="town">${esc(w.townLabel)}</label><input id="town" name="town" type="text" value="${esc(f.town)}" maxlength="80" autocomplete="address-level2" aria-describedby="town-hint"><p class="note" id="town-hint">${esc(w.townHint)}</p></details>
<input type="hidden" name="lat" value="${esc(f.lat)}"><input type="hidden" name="lon" value="${esc(f.lon)}">
<p class="note" id="near-set"${located ? "" : " hidden"}>${esc(w.nearMeSet)}</p>
<button type="button" id="near" class="quiet" hidden>${esc(w.nearMe)}</button>
${ctx.lang === "en" ? "" : `<input type="hidden" name="lang" value="${ctx.lang}">`}
<button type="submit" class="full">${esc(w.search)}</button>
</form>`;
}

/** "Ask in your own words": one box, a POST form (POST /search/ask, form-encoded, no script), so the words are never in an address. Shown only where the assistant is on. The place the buyer set with "Use my location" travels with it. */
function askBox(ctx: PageContext, f: FormValues): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  if (!ctx.assistant) return "";
  return `<form class="search ask" action="/search/ask" method="post" role="search">
<label for="ask">${esc(w.askLabel)}</label><input id="ask" name="ask" type="text" value="${esc(f.ask ?? "")}" placeholder="${esc(w.askPlaceholder)}" maxlength="200" autocomplete="off" enterkeyhint="send">
${f.lat !== "" && f.lon !== "" ? `<input type="hidden" name="lat" value="${esc(f.lat)}"><input type="hidden" name="lon" value="${esc(f.lon)}">` : ""}${ctx.lang === "en" ? "" : `<input type="hidden" name="lang" value="${ctx.lang}">`}
<button type="submit" class="full">${esc(w.askButton)}</button>
</form>`;
}

function card(ctx: PageContext, r: SearchResultItem): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  const photoOk = r.item.photo !== null && r.item.photo.startsWith(`${ctx.origin}/`);
  const price = r.item.price ? `<p class="price">${esc(rupees(r.item.price.value))}${r.item.price.note ? ` <span class="note">${esc(r.item.price.note)}</span>` : ""}</p>` : `<p class="price ask">${esc(w.ask)}</p>`;
  const sure = r.checked && r.item.availability === "in_stock";
  const fresh = sure ? `<span class="stamp ok">${esc(freshness(w, r.item.confirmed, ctx.now))}</span>` : `<span class="stamp wait">${esc(w.callToCheck)}</span>`;
  const where = r.shop.distanceKm !== null ? w.away(km(r.shop.distanceKm)) : w.inTown(r.shop.town);
  const chat = r.chat + (ctx.lang === "en" ? "" : `&lang=${ctx.lang}`);
  return `<li class="card res"><div class="ph k-${r.item.category}${photoOk ? "" : " no"}">${photoOk ? `<img src="${esc(r.item.photo!)}" alt="${esc(w.photoOf(r.item.title))}" loading="lazy" decoding="async" width="400" height="300">` : `<span>${esc(w.kinds[r.item.category] ?? "")}</span>`}</div>
<div class="body"><h2 lang="${r.item.lang}">${esc(r.item.title)}</h2>${r.item.machineWritten ? `<p class="tag">${esc(w.machine)}</p>` : ""}${price}
<p class="meta">${fresh}<span>${esc(where)}</span></p>${sure ? "" : `<p class="note why">${esc(w.callToCheckWhy)}</p>`}
<p class="shop">${esc(r.shop.name)} <span>· ${esc(r.shop.town)}</span></p>
<a class="btn" href="${esc(chat)}" aria-label="${esc(w.chatLabel(r.shop.name, r.item.title))}">${esc(w.chat)}</a></div></li>`;
}

/** The whole search page for a view. */
export function searchPage(ctx: PageContext, f: FormValues, view: SearchView, assist?: AssistBits): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  const params = formParams(f, ctx.lang);
  let main = "";
  if (view.state === "start") {
    main = `<section class="state-page" aria-labelledby="st"><h2 id="st">${esc(w.startTitle)}</h2><p>${esc(w.startBody)}</p>
<p class="note">${esc(w.tryThese)}</p><ul class="chips">${w.examples.map((e) => `<li><a class="chip" href="${esc(link("/search", { q: e, lang: ctx.lang === "en" ? undefined : ctx.lang }))}">${esc(e)}</a></li>`).join("")}${CATEGORIES.map((c) => `<li><a class="chip" href="${esc(link("/search", { category: c, lang: ctx.lang === "en" ? undefined : ctx.lang }))}">${esc(w.kinds[c])}</a></li>`).join("")}</ul></section>`;
  } else if (view.state === "results") {
    const results = view.answer.results;
    const unanswered = results.filter((r) => !r.checked).length;
    const count = f.q.trim() === "" ? w.resultsNoWords(results.length) : w.resultsFor(results.length, f.q.trim());
    main = `<section aria-labelledby="rs"><h2 id="rs" class="sr">${esc(count)}</h2><p class="count" aria-hidden="true">${esc(count)}</p>${unanswered > 0 ? `<p class="notice" role="status">${esc(w.unanswered(unanswered))}</p>` : ""}
<ul class="results">${results.map((r) => card(ctx, r)).join("")}</ul>
${view.answer.next !== null ? `<a class="btn quiet more" href="${esc(link("/search", { ...params, offset: view.answer.next }))}">${esc(w.more)}</a>` : ""}</section>`;
  } else if (view.state === "none") {
    main = `<section class="state-page card" aria-labelledby="st"><h2 id="st">${esc(w.noneTitle)}</h2><p>${esc(w.noneBody)}</p><a class="btn quiet" href="${esc(link("/search", { lang: ctx.lang === "en" ? undefined : ctx.lang }))}">${esc(w.clear)}</a></section>`;
  } else if (view.state === "bad") {
    main = `<section class="state-page state s-bad" role="alert"><h2>${esc(w.badTitle)}</h2><p lang="en">${esc(view.message)}</p></section>`;
  } else if (view.state === "busy") {
    main = `<section class="state-page state s-wait" role="status"><h2>${esc(w.busyTitle)}</h2><p>${esc(w.busyBody)}</p></section>`;
  } else {
    main = `<section class="state-page state s-info" role="status"><h2>${esc(w.downTitle)}</h2><p>${esc(w.downBody)}</p></section>`;
  }
  if (assist && (view.state === "results" || view.state === "none")) {
    main = `${assist.notice ? `<p class="notice" role="status">${esc(assist.notice)}</p>` : ""}${assist.line ? `<p class="askline" role="status">${esc(assist.line)}</p>` : ""}${main}`;
  }
  const title = f.q.trim() !== "" ? f.q.trim() : w.title;
  return `${head(ctx, title, { noindex: true })}<header class="top"><div class="wrap"><h1>${esc(w.title)}</h1><p>${esc(w.sub)}</p>${langNav(ctx, "/search", { ...formParams(f, ctx.lang), lang: undefined })}</div></header>
<main class="wrap">${askBox(ctx, f)}${form(ctx, f)}${main}</main>${foot(ctx)}<script nonce="${ctx.nonce}">${NEAR_SCRIPT}</script></body></html>`;
}

/** The page that states the order in plain words; linked from every search page. */
export function orderPage(ctx: PageContext): string {
  const w = DIRECTORY_WORDS[ctx.lang];
  return `${head(ctx, w.orderTitle, { noindex: false })}<header class="top"><div class="wrap"><h1>${esc(w.orderTitle)}</h1><p>${esc(w.orderIntro)}</p>${langNav(ctx, "/order", {})}</div></header>
<main class="wrap"><ol class="order">${w.orderSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<section class="never" aria-labelledby="nv"><h2 id="nv">${esc(w.orderNever)}</h2><p>${esc(w.orderNeverBody)}</p></section>
<h2>${esc(w.orderAsk)}</h2><p>${esc(w.orderAskBody)}</p><h2>${esc(w.orderWords)}</h2><p>${esc(w.orderWordsBody)}</p><h2>${esc(w.orderPrivate)}</h2><p>${esc(w.orderPrivateBody)}</p>
<a class="btn quiet" href="${esc(link("/search", { lang: ctx.lang === "en" ? undefined : ctx.lang }))}">${esc(w.back)}</a></main>${foot(ctx)}</body></html>`;
}
