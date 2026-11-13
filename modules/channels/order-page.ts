// Item 11h: an Orders shop's pages, as plain HTML: the menu page (a day, the items at the shop's own prices with what is left, pickup or delivery and the slot, the
// name and number) and an order's own page (where it stands, how to pay the advance while it is held, "I have paid", cancel, the shop's messages). Rendered by the
// public front (front-orders.ts) from what the shop's runtime answers (backend.ts orderOffer, orderView). The same rules as the booking page (page.ts): no script,
// nothing loaded from anywhere, forms post only to the page itself; a page that is still waiting refreshes itself with a meta tag; the UPI QR code is an inline SVG.
//
// Nothing on these pages is written from what the customer typed except their own name and address, escaped. No price comes from the form: the form sends item ids
// and quantities, and every amount shown is the runtime's, from the shop's settings.
import { MIC_HINT } from "./words-confirm.ts";
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { localParts } from "../core/time.ts";
import { formatDate, formatInr, formatSlot, formatTime } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { textQrSvg } from "../qr/svg.ts";
import type { OrderOffer, OrderView } from "./backend.ts";
import { PAGE } from "./words.ts";
import { ORDER_PAGE } from "./words-orders-fees.ts";
import { layout } from "./page.ts";
import type { PageShop } from "./page.ts";
import { facePartnerLine, shopFace } from "./shop-face.ts";
import type { PagesFile } from "./pages-file.ts";

const dateOf = (iso: string) => { const [year, month, day] = iso.split("-").map(Number); return { year, month, day }; };
/** A slot's window as people read it: "Mon 16 Nov, 12:00–13:00" (the times in the shop's zone). */
export const windowText = (fromMs: number, toMs: number, timeZone: string, language: Language): string => {
  const from = localParts(fromMs, timeZone);
  return `${formatDate(from, language)}, ${formatTime(from, language)}–${formatTime(localParts(toMs, timeZone), language)}`;
};

/** The footer of every Orders page: what an AI assistant can do here, and the API. */
function footer(shop: PageShop, language: Language): Raw {
  return html`<footer><h2>${PAGE[language].assistantsTitle}</h2><p class="note">${ORDER_PAGE[language].assistants(`${shop.publicUrl}/mcp`, `${shop.publicUrl}/api/v1`)}</p></footer>`;
}

/**
 * The menu page: the days (a link each), and for the chosen day one form with the items, the slots and the customer's details. `error` is a plain line from the
 * front (too many requests, a form to check); `values` keeps what the customer typed when the form comes back.
 */
export function menuPage(o: { shop: PageShop; offer: OrderOffer; language: Language; date?: string; error?: string; values?: { name?: string; phone?: string; address?: string; qty?: Record<string, string>; slot?: string }; nonce?: string; pages?: PagesFile }): string {
  const w = ORDER_PAGE[o.language];
  const p = PAGE[o.language];
  const s = o.offer.shop;
  const face = shopFace({ shop: s, language: o.language, ...(o.pages ? { pages: o.pages } : {}) });
  const foot = facePartnerLine(o.language, o.pages);
  const self = `${o.shop.publicUrl}/`;
  const q = (extra: Record<string, string>) => `${self}?${new URLSearchParams({ lang: o.language, ...extra })}`;
  if (s.paused) return layout({ shop: s, language: o.language, title: w.title(s.name), selfPath: self, face, foot, body: html`<p class="status warn">${w.paused}</p>${footer(o.shop, o.language)}` });
  const advance = s.advance.mode === "full" ? w.advanceFull : w.advancePart(s.advance.percent);
  // a day can be ordered for while it has a slot whose cut-off has not passed and its count is not reached
  const open = o.offer.days.filter((d) => !d.full && d.slots.some((x) => x.open));
  const day = open.find((d) => d.date === o.date) ?? open[0];
  let form: Raw | string = html`<p class="status warn">${w.noDays}</p>`;
  if (day) {
    const tz = s.timezone;
    const days = html`<h2>${w.pickDay}</h2><p class="days">${o.offer.days.map((d) => (d.date === day.date ? html`<b>${formatDate(dateOf(d.date), o.language)}</b>` : open.includes(d) ? html`<a href="${q({ date: d.date })}">${formatDate(dateOf(d.date), o.language)}</a>` : ""))}</p>`;
    const items = html`<h2>${w.pickItems}</h2><ul class="list">${o.offer.items.map((i) => {
      const left = day.left[i.id] ?? 0;
      return html`<li><label class="choice">${i.names[o.language]}<span>${formatInr(i.priceInr)}</span><br><small class="note">${left > 0 ? w.left(left) : w.soldOut}</small><br><input type="number" name="qty_${i.id}" min="0" max="${String(Math.max(0, Math.min(left, o.offer.maxItemsPerOrder)))}" value="${o.values?.qty?.[i.id] ?? "0"}" inputmode="numeric"${left > 0 ? "" : raw(" disabled")}></label></li>`;
    })}</ul><p class="note">${w.maxItems(o.offer.maxItemsPerOrder)}</p>`;
    const chosenSlot = o.values?.slot ?? day.slots.find((x) => x.open)?.id;
    const slots = html`<h2>${w.pickSlot}</h2><div class="slots">${day.slots.map((x) => html`<label><input type="radio" name="slot" value="${x.id}" required${x.id === chosenSlot && x.open ? raw(" checked") : ""}${x.open ? "" : raw(" disabled")}>${x.mode === "pickup" ? w.pickup : w.delivery}: ${formatTime(localParts(x.fromMs, tz), o.language)}–${formatTime(localParts(x.toMs, tz), o.language)}${x.open ? "" : html` <small class="note">(${w.slotClosed})</small>`}</label>`)}</div>`;
    const address = o.offer.delivery ? html`<label class="f" for="address">${w.address}</label><input type="text" id="address" name="address" maxlength="120" autocomplete="street-address" value="${o.values?.address ?? ""}"><p class="note">${w.addressNote(o.offer.delivery.areas.join(", "))}</p><p class="note mic">${MIC_HINT[o.language]}</p>` : "";
    form = html`${days}<form method="post" action="${o.shop.publicUrl}/order">
<input type="hidden" name="date" value="${day.date}"><input type="hidden" name="lang" value="${o.language}">${o.nonce ? html`<input type="hidden" name="nonce" value="${o.nonce}">` : ""}
${items}${slots}${address}
<h2>${w.yourDetails}</h2>
<label class="f" for="name">${p.name}</label><input type="text" id="name" name="name" required maxlength="60" autocomplete="name" value="${o.values?.name ?? ""}">
<label class="f" for="phone">${p.phone}</label><input type="tel" id="phone" name="phone" required maxlength="20" autocomplete="tel" inputmode="tel" value="${o.values?.phone ?? ""}">
<p class="note">${w.phoneNote}</p>
<button type="submit">${w.place}</button>
<p class="note">${w.cancelRule(s.cancellation.windowHours)}</p>
</form>`;
  }
  return layout({
    shop: s, language: o.language, title: w.title(s.name), selfPath: self, face, foot, query: o.date ? { date: o.date } : {},
    body: html`<p>${w.intro(advance, s.payment.kind === "upi")}</p>${o.error ? html`<p class="status warn" role="alert">${o.error}</p>` : ""}${form}${footer(o.shop, o.language)}`,
  });
}

/** An order's own page: where it has got to, what it is (at the shop's prices), how to pay while it is held, cancel, and the shop's messages. Refreshes itself while something is still to come. */
export function orderPage(o: { shop: PageShop; offer: OrderOffer; language: Language; handle: string; view: OrderView | null; notice?: string }): string {
  const w = ORDER_PAGE[o.language];
  const p = PAGE[o.language];
  const s = o.offer.shop;
  const tz = s.timezone;
  const self = `${o.shop.publicUrl}/order/${o.handle}`;
  const v = o.view;
  const title = w.title(s.name);
  const again = html`<p><a class="btn" href="${o.shop.publicUrl}/?lang=${o.language}">${w.again}</a></p>`;
  if (!v) return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status">${w.unknown}</p>${again}` });
  if (v.status === "pending") return layout({ shop: s, language: o.language, title, selfPath: self, refreshSeconds: 2, body: html`<p class="status">${w.pending}</p><p class="note">${w.keepLink}</p>` });
  if (v.status === "not_done") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status warn">${p.notDone}</p>${again}` });
  if (v.status === "refused") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status warn">${w.refused[v.reason] ?? w.refused.unknown}</p>${again}` });

  const slot = v.slot ? windowText(v.slot.fromMs, v.slot.toMs, tz, o.language) : "";
  const when = v.mode && slot ? w.when(v.mode, slot, v.area) : slot;
  const what = html`<ul class="list">${v.lines.map((l) => html`<li>${l.qty} × ${l.names[o.language]} <small class="note">(${formatInr(l.priceInr)})</small></li>`)}</ul>
${v.totalInr !== undefined ? html`<p><b>${w.total(formatInr(v.totalInr))}</b>${v.advanceInr !== undefined && v.advanceInr !== v.totalInr ? html`<br>${w.advance(formatInr(v.advanceInr))}` : ""}</p>` : ""}
${when ? html`<p>${when}</p>` : ""}<p><small class="note">${w.note(v.ref)}</small></p>`;
  const line = v.status === "held" ? w.held(v.holdExpiresAt !== undefined ? formatSlot(v.holdExpiresAt, tz, o.language) : "")
    : v.status === "confirmed" ? w.confirmed(when) : v.status === "checking" ? w.checking : v.status === "expired" ? w.expired
    : v.status === "cancelled" ? w.cancelled : v.status === "done" ? w.done : w.notHeld;
  let pay: Raw | string = "";
  if (v.status === "held" && v.pay?.kind === "upi") {
    const amount = formatInr(v.pay.leftPaise / 100);
    pay = html`<div class="box"><p><b>${p.upiPay(amount, v.pay.payTo.name, v.pay.payTo.id)}</b></p>
<p><a class="btn" href="${v.pay.link}">${p.openUpi}</a></p>
<p class="note">${p.scan}</p><div class="qr">${raw(textQrSvg(v.pay.link, { label: p.upiPay(amount, v.pay.payTo.name, v.pay.payTo.id) }))}</div>
<p class="note">${w.afterPay}</p>
${v.canSayPaid ? html`<form method="post" action="${self}/paid"><input type="hidden" name="lang" value="${o.language}"><button class="quiet" type="submit">${p.paid}</button></form>` : ""}</div>`;
  } else if (v.status === "held" && v.pay?.kind === "link") {
    pay = html`<div class="box"><p><a class="btn" href="${v.pay.url}" rel="noreferrer">${p.linkPay(formatInr(v.advanceInr ?? 0))}</a></p></div>`;
  }
  const cancel = v.canCancel ? html`<form method="post" action="${self}/cancel"><input type="hidden" name="lang" value="${o.language}"><button class="quiet" type="submit">${w.cancel}</button><p class="note">${w.cancelRule(s.cancellation.windowHours)}</p></form>` : "";
  const messages = v.messages.length > 0 ? html`<h2>${p.messages}</h2><ul class="list msgs">${[...v.messages].reverse().map((m) => html`<li>${m.text}<br><small class="note">${formatSlot(m.atMs, tz, o.language)}</small></li>`)}</ul>` : "";
  const sad = v.status === "not_held" || v.status === "expired";
  return layout({
    shop: s, language: o.language, title, selfPath: self,
    // held: look again every 15 s, so "Confirmed" shows once the owner marks the payment; waiting for the owner: every 30 s
    ...(v.status === "held" ? { refreshSeconds: 15 } : v.status === "checking" ? { refreshSeconds: 30 } : {}),
    body: html`${o.notice ? html`<p class="note" role="status">${o.notice}</p>` : ""}<p class="status${sad ? " warn" : ""}">${line}</p>${what}${pay}${sad ? again : ""}${cancel}${messages}<p class="note">${w.keepLink}</p>${footer(o.shop, o.language)}`,
  });
}
