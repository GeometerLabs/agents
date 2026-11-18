// The owner's listings page in their own app (block S, phase A, owner 18 Nov 2026): what they show on their page, in their language. With the assistant the owner says or types what they
// have in the talk box (after adding a photo here) and taps Show it on a card; this page is the owner's own side of the same thing, and the way without a model: a photo, a title, a price and a
// category in one plain form. It also holds the owner's switch "Show my shop on Streetlist and in search" (off by default), the shop's place (town, pincode, a map point) and the pet-shop
// registration in the owner's own words, and for each listing the one-tap Still have it / Sold / Take off / Change.
//
// The photo: the phone resizes it before sending (a canvas, the longest side 1600 px, re-encoded as JPEG, which drops the location), and the page's one small script does that and posts the
// bytes to the owner's own address (<base>/listings/photo). The server still checks the bytes and cleans them (modules/listings/photo.ts): this script is not trusted. Without script the
// form still works for a photo the owner already added, and every other control is a plain form.
//
// Used by front.ts (GET <base>/listings, POST <base>/listings/op, POST <base>/listings/photo, GET <base>/listings/p/<id>). Hindi, Malayalam and Kannada are machine-written and are on the
// review sheets (bundle/panel/review.ts, ids "listings.*"). Plain language, 360 px first, every state drawn: nothing yet, a draft waiting, live, hidden for want of a confirm.
import { html, raw } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import type { OwnerListingRow, OwnerListingsView } from "../listings/kit.ts";
import { textIn } from "../listings/listings.ts";
import type { Lang } from "../listings/listings.ts";
import { LISTING_WORDS, priceLine } from "../listings/words.ts";
import { STOCK_LINE_WORDS } from "../stock/words.ts";
import { OWNER_CSS } from "./look.ts";

export type ListingsNotice = "saved" | string;

export interface OwnerListingsInput { base: string; language: Language; view: OwnerListingsView; csrf?: string; nonce: string; notice?: ListingsNotice }

/** The one script: resize the chosen photo on a canvas (longest side 1600, JPEG), post it, and add its id to the form. Small on purpose; the server checks what it gets. */
export const LISTINGS_SCRIPT = `
(function(){var f=document.getElementById('ph-file');if(!f)return;var box=document.getElementById('ph-ids');var st=document.getElementById('ph-state');var csrf=f.getAttribute('data-csrf')||'';var url=f.getAttribute('data-url');
f.addEventListener('change',function(){var file=f.files&&f.files[0];if(!file)return;var img=new Image();var u=URL.createObjectURL(file);
img.onload=function(){var s=Math.min(1,1600/Math.max(img.width,img.height));var c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*s));c.height=Math.max(1,Math.round(img.height*s));
c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(u);
c.toBlob(function(b){if(!b)return;fetch(url,{method:'POST',headers:{'content-type':'image/jpeg','x-owner-csrf':csrf},body:b,credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
if(j&&j.photo){var i=document.createElement('input');i.type='hidden';i.name='photos';i.value=j.photo.id;box.appendChild(i);var t=document.createElement('img');t.src=c.toDataURL('image/jpeg',0.3);t.width=64;t.alt='';box.appendChild(t);
st.textContent=st.getAttribute('data-ok').replace('{n}',String(box.querySelectorAll('input').length));}else{st.textContent=(j&&j.error)||st.getAttribute('data-bad');}}).catch(function(){st.textContent=st.getAttribute('data-bad');});},'image/jpeg',0.85);};
img.onerror=function(){st.textContent=st.getAttribute('data-bad');};img.src=u;f.value='';});})();
`;

/** The content policy of this page: PAGE_POLICY's strictness and exactly what the page needs, each at its own address: its one script by nonce, the photo post, and the owner's own photo folder. Never 'self'. */
export const listingsPolicy = (base: string, nonce: string): string =>
  `default-src 'none'; style-src 'unsafe-inline'; img-src data: ${base}/listings/p/; form-action ${base}/listings/op; frame-ancestors 'none'; base-uri 'none'; script-src 'nonce-${nonce}'; connect-src ${base}/listings/photo`;

const FRESH_LABEL = (w: ReturnType<typeof words>, r: OwnerListingRow): string => (r.state === "draft" ? w.draft : r.freshness === "hidden" ? w.hidden : w.live);
const words = (language: Language) => LISTING_WORDS[language].owner;

export function ownerListingsPage(o: OwnerListingsInput): string {
  const W = LISTING_WORDS[o.language];
  const w = W.owner;
  const v = o.view;
  const csrf = o.csrf ? html`<input type="hidden" name="csrf" value="${o.csrf}">` : "";
  const catName = (id: string): string => (W.categories as Record<string, string>)[id] ?? v.categories.find((c) => c.id === id)?.names[o.language as Lang] ?? id;
  const select = (name: string, current?: string) => html`<select name="${name}">${v.categories.map((c) => html`<option value="${c.id}"${c.id === current ? raw(" selected") : ""}>${catName(c.id)}</option>`)}</select>`;
  const notice = o.notice ? (o.notice === "saved" ? w.saved : refusalText(o.language, o.notice)) : undefined;

  const row = (r: OwnerListingRow): ReturnType<typeof html> => {
    const t = textIn({ ...r, state: "live", createdMs: 0, by: "owner", from: "app" } as never, o.language);
    const own = r.words[r.ownerLang]?.title ?? t.title;
    const photo = r.photos[0];
    const form = (fields: ReturnType<typeof html>, button: string, quiet = false) => html`<form method="post" action="${o.base}/listings/op">${csrf}${fields}<button class="${quiet ? "no" : "yes"}" type="submit">${button}</button></form>`;
    const hidden = (name: string, value: string | number) => html`<input type="hidden" name="${name}" value="${String(value)}">`;
    return html`<section class="card s-${r.state === "draft" ? "wait" : r.freshness === "hidden" ? "bad" : "ok"}">
<h3>${photo ? html`<img src="${o.base}/listings/p/${photo.id}" width="56" height="42" alt="" style="vertical-align:middle;border-radius:8px;margin-right:8px">` : ""}${t.title}</h3>
<p>${priceLine(r.pricePaise, r.priceNote, o.language)}${r.qty !== undefined ? ` · ${W.quantity(r.qty)}` : ""} · ${catName(r.category)}</p>
<p class="note"><strong>${r.soldOut ? STOCK_LINE_WORDS[o.language].soldOut : FRESH_LABEL(w, r)}</strong></p>
<div class="acts">
${r.state === "live" ? form(html`${hidden("op", "confirm")}${hidden("id", r.id)}${hidden("confirmedMs", r.confirmedMs ?? 0)}`, r.freshness === "hidden" ? w.confirmAgain : W.yes) : ""}
${r.state === "live" ? form(html`${hidden("op", "sold")}${hidden("id", r.id)}`, w.markSold, true) : ""}
${form(html`${hidden("op", "remove")}${hidden("id", r.id)}`, w.remove, true)}
</div>
<details class="fold"><summary>${w.edit}</summary>
<form method="post" action="${o.base}/listings/op">${csrf}${hidden("op", "edit")}${hidden("id", r.id)}
<label>${w.formTitle} <input name="title" value="${own}" maxlength="80" required></label>
<label>${w.formPrice} <input name="price" type="number" inputmode="decimal" min="1" step="1" value="${r.pricePaise !== undefined ? r.pricePaise / 100 : ""}"></label>
<label>${w.formPriceNote} <input name="note" value="${r.priceNote ?? ""}" maxlength="30"></label>
<label>${w.formCategory} ${select("category", r.category)}</label>
<button class="yes" type="submit">${w.save}</button></form></details></section>`;
  };

  const saveShop = html`<form method="post" action="${o.base}/listings/op" class="card">${csrf}<input type="hidden" name="op" value="shop">
<h2>${w.switchLabel}</h2>
<p class="note">${w.switchNote}</p>
<label><input type="checkbox" name="visible" value="1"${v.shop.visible ? raw(" checked") : ""}> ${w.switchLabel}</label>
<h3>${w.placeHeading}</h3>
<label>${w.town} <input name="town" value="${v.shop.town ?? ""}" maxlength="60"></label>
<label>${w.pincode} <input name="pincode" value="${v.shop.pincode ?? ""}" inputmode="numeric" maxlength="6" pattern="[1-9][0-9]{5}"></label>
<label>${w.lat} <input name="lat" value="${v.shop.lat ?? ""}" inputmode="decimal"></label>
<label>${w.lon} <input name="lon" value="${v.shop.lon ?? ""}" inputmode="decimal"></label>
<label>${w.registration} <input name="registration" value="${v.shop.registration ?? ""}" maxlength="120"></label>
<p class="note">${w.registrationNote}</p>
<button class="yes" type="submit">${w.save}</button></form>`;

  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="same-origin"><title>${w.title}</title><style>${raw(OWNER_CSS)}</style><script nonce="${o.nonce}">${raw(LISTINGS_SCRIPT)}</script></head><body class="app">
<main class="wrap"><h1>${w.title}</h1>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
<p class="note">${w.intro}</p>
<form method="post" action="${o.base}/listings/op" class="card">${csrf}<input type="hidden" name="op" value="publish_form">
<h2>${w.formHeading}</h2><p class="note">${w.formNote}</p>
<div id="ph-ids"></div>
<label>${w.formPhoto} <input id="ph-file" type="file" accept="image/*" data-url="${o.base}/listings/photo" data-csrf="${o.csrf ?? ""}"></label>
<p class="note" id="ph-state" role="status" data-ok="${w.uploaded(0).replace("0", "{n}")}" data-bad="${W.refusal.photo.unreadable}">${v.pending.length > 0 ? w.uploaded(v.pending.length) : ""}</p>
<label>${w.formTitle} <input name="title" maxlength="80" required></label>
<label>${w.formPrice} <input name="price" type="number" inputmode="decimal" min="1" step="1"></label>
<label>${w.formPriceNote} <input name="note" maxlength="30"></label>
<label>${w.formCategory} ${select("category")}</label>
<button class="yes" type="submit">${w.formSubmit}</button></form>
<h2>${w.listHeading}</h2>
${v.listings.length > 0 ? v.listings.map(row) : html`<p class="calm">${w.none}</p>`}
${saveShop}
<p><a href="${o.base}/?lang=${o.language}">${w.back}</a></p></main></body></html>`.markup}`;
}

/** The refusal's words for the page's notice: the runtime's `why`, in the owner's language. */
export function refusalText(language: Language, why: string): string {
  const r = LISTING_WORDS[language].refusal;
  const by: Record<string, string> = {
    protected_animal: r.protectedNote, health_claim: r.health, bad_price: r.badPrice, bad_qty: r.badQty, bad_category: r.badCategory, too_long: r.tooLong, empty: r.empty, bad_place: r.badPlace, bad_text: r.tooLong,
    too_many_photos: r.tooManyPhotos, no_such_listing: r.unknown, not_live: r.gone, not_a_draft: r.gone, full: r.full(50), too_many_drafts: r.tooManyDrafts, day: r.photo.day,
  };
  return by[why] ?? r.unknown;
}
