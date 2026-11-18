// The owner's Stock page in their own app (block S, phase A3, owner 18 Nov 2026): the items the shop counts, low and sold-out ones first, each with big buttons to correct the count, and a form
// to start counting another item. It is the owner's own side of the one shared stock record (modules/stock): the same count that the shop's page, the open feed, Orders' menu and the Stock
// orders reorder read. Counting is optional per item, so a shop that counts nothing sees "nothing is counted yet" and one form.
//
// Plain forms only: no script, so the page works on any phone browser and its content policy needs no nonce. Every button carries a `rid` (a request id made when the page was drawn), which is
// the key of its effect in the stock record, so a double tap or a refreshed re-send changes the count once; the correction also carries the count the owner was shown (`shown`), so a sale that
// came in while they looked is not overwritten.
//
// Used by front.ts (GET <base>/stock, POST <base>/stock/op). Hindi, Malayalam and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts, ids "stockline.*").
// 360 px first, every state drawn: nothing counted, running low, sold out, fine.
import { html, raw } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import type { OwnerStockView } from "../stock/kit.ts";
import { STOCK_LINE_WORDS } from "../stock/words.ts";
import type { StockRow } from "../stock/stock.ts";
import { OWNER_CSS } from "./look.ts";

export interface OwnerStockInput { base: string; language: Language; view: OwnerStockView; csrf?: string; notice?: string; /** Makes one request id per button (the page's caller passes randomUUID). */ rid: () => string }

/** No script and no image, so the policy allows only the page's own forms. Never 'self'. */
export const stockPolicy = (base: string): string => `default-src 'none'; style-src 'unsafe-inline'; form-action ${base}/stock/op; frame-ancestors 'none'; base-uri 'none'`;

/** The refusal's words for the page's notice: the runtime's `why`, in the owner's language. */
export function stockNotice(language: Language, n: string): string {
  const w = STOCK_LINE_WORDS[language];
  return n === "saved" ? w.saved : (w.notices as Record<string, string>)[n] ?? w.notices.bad_count;
}

export function ownerStockPage(o: OwnerStockInput): string {
  const w = STOCK_LINE_WORDS[o.language];
  const csrf = o.csrf ? html`<input type="hidden" name="csrf" value="${o.csrf}">` : "";
  const hid = (name: string, value: string | number) => html`<input type="hidden" name="${name}" value="${String(value)}">`;
  const notice = o.notice ? stockNotice(o.language, o.notice) : undefined;

  const row = (r: StockRow) => html`<section class="card s-${r.soldOut ? "bad" : r.isLow ? "wait" : "ok"}">
<h3>${r.name}</h3>
<p><strong>${w.left(r.count, r.unit)}</strong>${r.soldOut ? html` · ${w.soldOut}` : r.isLow ? html` · ${w.low}` : ""}</p>
<p class="note">${w.kinds[r.kind]}${r.low !== undefined ? ` · ${w.lowMark(r.low)}` : ""}</p>
<div class="acts">
<form method="post" action="${o.base}/stock/op">${csrf}${hid("op", "sold")}${hid("id", r.id)}${hid("qty", 1)}${hid("rid", o.rid())}<button class="yes" type="submit">${w.soldOne}</button></form>
</div>
<form method="post" action="${o.base}/stock/op" class="acts">${csrf}${hid("op", "correct")}${hid("id", r.id)}${hid("shown", r.count)}${hid("rid", o.rid())}
<label>${w.newCount} <input name="to" type="number" inputmode="numeric" min="0" step="1" value="${r.count}" required></label>
<button class="yes" type="submit">${w.setCount}</button></form>
<details class="fold"><summary>${w.history}</summary><ul>${r.moves.map((m) => html`<li>${w.moves[m.kind]}: ${m.delta > 0 ? "+" : ""}${m.delta} → ${m.after}${m.short ? ` (${w.short(m.short)})` : ""}</li>`)}</ul>
<form method="post" action="${o.base}/stock/op">${csrf}${hid("op", "low")}${hid("id", r.id)}${hid("rid", o.rid())}
<label>${w.addLow} <input name="low" type="number" inputmode="numeric" min="0" step="1" value="${r.low ?? ""}"></label>
<button class="yes" type="submit">${w.save}</button></form>
<form method="post" action="${o.base}/stock/op">${csrf}${hid("op", "stop")}${hid("id", r.id)}${hid("rid", o.rid())}<p class="note">${w.stopHelp}</p><button class="no" type="submit">${w.stop}</button></form></details></section>`;

  const add = o.view.candidates.length === 0 ? html`<p class="calm">${w.nothingToAdd}</p>` : html`<form method="post" action="${o.base}/stock/op" class="card">${csrf}${hid("op", "start")}${hid("rid", o.rid())}
<h2>${w.addTitle}</h2>
<label>${w.addItem} <select name="id">${o.view.candidates.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></label>
<label>${w.addCount} <input name="count" type="number" inputmode="numeric" min="0" step="1" required></label>
<label>${w.addLow} <input name="low" type="number" inputmode="numeric" min="0" step="1"></label>
<button class="yes" type="submit">${w.addButton}</button></form>`;

  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="same-origin"><title>${w.title}</title><style>${raw(OWNER_CSS)}</style></head><body class="app">
<main class="wrap"><h1>${w.title}</h1>
${notice ? html`<p class="notice" role="status">${notice}</p>` : ""}
<p class="note">${w.intro}</p>
${o.view.rows.length > 0 ? o.view.rows.map(row) : html`<p class="calm">${w.empty}</p>`}
${add}
<p><a href="${o.base}/?lang=${o.language}">${w.back}</a></p></main></body></html>`.markup}`;
}
