// The client health and margin pages (B32) and the template vote page (B56). Plain forms and links, no script. The words are in words-health.ts.
import { formatRupees } from "./cost.ts";
import type { Attention, CostId, CostItem, CostNote, Entries, ShopMargin, Sum } from "./health.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import { layout, when } from "./views.ts";
import type { Ctx } from "./views.ts";
import { HEALTH_WORDS } from "./words-health.ts";
import type { HealthWords } from "./words-health.ts";
import type { VoteRound } from "./votes.ts";

export interface ShopHealth { id: string; name: string; attention: Attention; margin: ShopMargin; entries: Entries | undefined }

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
/** Paise as rupees, with a minus sign when below zero. */
export const money = (paise: number): string => (paise < 0 ? `−${formatRupees(-paise)}` : formatRupees(paise));
const amountText = (paise: number | null | undefined): string => (paise === null || paise === undefined ? "" : (paise / 100).toFixed(2).replace(/\.00$/u, ""));

const noteWord = (h: HealthWords, n: CostNote, item: CostItem): string => {
  const w = h.cost.notes;
  switch (n) {
    case "builder-licence": return w.builderLicence;
    case "included": return w.included;
    case "estimate": return w.estimate;
    case "no-record": return w.noRecord;
    case "no-plan": return w.noPlan;
    case "no-price": return w.noPrice;
    case "no-minutes": return w.noMinutes;
    case "no-rate": return w.noRate;
    case "floor": return w.floor(item.unpriced ?? 0);
  }
};

function attentionList(c: Ctx, h: HealthWords, a: Attention): Raw {
  const w = h.attention;
  const items: Raw[] = [];
  if (!a.recordShared) items.push(html`<li class="info"><span class="mark">·</span><span>${w.notShared}</span></li>`);
  for (const [kind, n] of Object.entries(a.unfinished)) items.push(html`<li class="warn"><span class="mark">!</span><span>${Object.hasOwn(w.kind, kind) ? w.kind[kind] : w.otherKind}: ${n}</span></li>`);
  if (a.licence && a.licence !== "active") items.push(html`<li class="warn"><span class="mark">!</span><span>${c.w.licence.states[a.licence]}</span></li>`);
  if (a.heartbeat.at) items.push(html`<li class="${a.heartbeat.stale ? "warn" : "info"}"><span class="mark">${a.heartbeat.stale ? "!" : "·"}</span><span>${a.heartbeat.stale ? w.heartbeatStale(when(a.heartbeat.at, c.lang)) : w.heartbeat(when(a.heartbeat.at, c.lang))}</span></li>`);
  else items.push(html`<li class="info"><span class="mark">·</span><span>${w.heartbeatNone}</span></li>`);
  for (const k of a.warn) if (Object.hasOwn(c.w.plan.warn, k)) items.push(html`<li class="warn"><span class="mark">!</span><span>${c.w.plan.warn[k as keyof typeof c.w.plan.warn]}</span></li>`);
  if (a.buttons) items.push(html`<li class="warn"><span class="mark">!</span><span>${w.buttons}</span></li>`);
  if (a.drill.days !== undefined) items.push(html`<li class="${a.drill.ok === false ? "warn" : "info"}"><span class="mark">${a.drill.ok === false ? "!" : "·"}</span><span>${a.drill.ok === false ? w.drillFailed(a.drill.days) : w.drill(a.drill.days)}</span></li>`);
  else items.push(html`<li class="info"><span class="mark">·</span><span>${w.drillNone}</span></li>`);
  return html`<ul class="plain">${items}</ul>`;
}

const LINE_WORD = (h: HealthWords, id: CostId): string => h.cost.lines[id];

function costTable(h: HealthWords, m: ShopMargin): Raw {
  const w = h.cost;
  return html`<table class="cost"><tbody>
${m.items.map((i) => html`<tr><td>${LINE_WORD(h, i.id)}${i.minutes !== undefined ? ` · ${w.minutes(i.minutes)}` : ""}${i.notes.length > 0 ? html`<small>${i.notes.map((n) => noteWord(h, n, i)).join(" · ")}</small>` : ""}</td><td class="n">${i.paise === null ? w.unknown : money(i.paise)}</td></tr>`)}
<tr class="total"><td>${m.cost.complete ? w.total : w.subtotal(m.cost.unknown.length)}</td><td class="n">${money(m.cost.paise)}</td></tr>
</tbody></table>`;
}

/** What you charge, what you keep: the price, the margin (or why it is unknown), and the setup fee. */
function marginBlock(h: HealthWords, m: ShopMargin): Raw {
  const w = h.margin;
  return html`<table class="cost"><tbody>
<tr><td>${w.yourPrice}</td><td class="n">${m.pricePaise === null ? h.cost.unknown : money(m.pricePaise)}</td></tr>
<tr class="total"><td>${w.heading}: ${w.keep}</td><td class="n">${m.margin === null ? h.cost.unknown : money(m.margin.paise)}</td></tr>
</tbody></table>
${m.margin === null ? html`<p class="note">${w.unknownPrice}</p>` : ""}
${m.margin && !m.margin.complete ? html`<p class="note">${w.before(m.cost.unknown.map((id) => LINE_WORD(h, id)).join(", "))}</p>` : ""}
${m.margin && m.margin.paise < 0 ? html`<p class="note">${w.negative}</p>` : ""}
${m.setupFeePaise !== null ? html`<p class="note">${w.setupOnce(money(m.setupFeePaise))}</p>` : ""}`;
}

function totalBlock(h: HealthWords, s: Sum): Raw {
  const w = h.all;
  return html`<h2>${w.heading}</h2>
<p class="big">${w.keep}: ${s.marginPaise === null ? w.unknown : money(s.marginPaise)}</p>
<p class="note">${w.shops(s.priced, s.shops)}${s.marginPaise !== null && s.priced < s.shops ? html` ${w.partial(s.priced, s.shops)}` : ""}${s.marginPaise !== null && !s.complete && !s.costsKnown ? html` ${h.margin.notFinal}` : ""}</p>
${s.setupPaise > 0 ? html`<p class="note">${w.setup}: ${money(s.setupPaise)}</p>` : ""}`;
}

// Overview across a person's shops: one row per shop plus the summed margin, used by the Health tab in server.ts.
export function healthPage(c: Ctx, o: { shops: ShopHealth[]; sum: Sum; month: string; innovator: boolean }): string {
  const h = HEALTH_WORDS[c.lang];
  const needing = o.shops.filter((s) => s.attention.needs).length;
  return layout(c, h.title, html`<h1>${h.title}</h1>
<p>${h.intro}</p>
${o.shops.length === 0 ? html`<p class="big">${h.none}</p>` : html`
<p class="big">${needing === 0 ? h.attention.ok : h.attention.needs(needing)}</p>
${totalBlock(h, o.sum)}
<div class="cards">${o.shops.map((s) => html`<a class="shopcard ${s.attention.needs ? "warn" : ""}" href="/health/${s.id}">
  <div class="name">${s.name}</div>
  <div class="meta">${!s.attention.recordShared ? h.attention.notShared : s.attention.unfinishedTotal > 0 ? h.attention.unfinished(s.attention.unfinishedTotal) : h.attention.ok}</div>
  <div class="meta">${h.margin.keep}: <b>${s.margin.margin === null ? h.cost.unknown : money(s.margin.margin.paise)}</b></div>${s.margin.margin && !s.margin.margin.complete ? html`
  <div class="meta">${h.margin.notFinal}</div>` : ""}</a>`)}</div>`}
${o.innovator ? html`<p><a class="btn" href="/vote">${h.vote.link}</a></p>` : ""}`);
}

// One shop's health and cost page with the partner's own entries form; `values` refills the form after a refused entry.
export function shopHealthPage(c: Ctx, o: { shop: ShopHealth; month: string; saved?: boolean; problem?: keyof HealthWords["problems"]; values?: Record<string, string> }): string {
  const h = HEALTH_WORDS[c.lang];
  const s = o.shop;
  const e = s.entries;
  const v = o.values ?? {
    price: amountText(e?.pricePaise), setup: amountText(e?.setupFeePaise), minutes: e?.supportMonth === o.month && e.supportMinutes !== undefined ? String(e.supportMinutes) : "", rate: amountText(e?.supportPaisePerHour),
  };
  return layout(c, `${s.name} · ${h.title}`, html`<h1>${s.name}</h1>
${o.saved ? html`<div class="notice" role="status">${h.saved}</div>` : ""}${o.problem ? html`<div class="notice" role="alert">${h.problems[o.problem]}</div>` : ""}
<h2>${h.attention.heading}</h2>
${attentionList(c, h, s.attention)}
${s.attention.unfinishedTotal > 0 ? html`<p><a class="btn" href="/inbox">${h.attention.todo}</a></p>` : ""}
<h2>${h.month(o.month)}</h2>
${costTable(h, s.margin)}
<h2>${h.margin.heading}</h2>
${marginBlock(h, s.margin)}
<h2>${h.charge.heading}</h2>
<form method="post" action="/health/${s.id}">${csrf(c)}
<label class="field">${h.charge.price} <input name="price" inputmode="decimal" autocomplete="off" value="${v.price}"></label>
<label class="field">${h.charge.setup} <input name="setup" inputmode="decimal" autocomplete="off" value="${v.setup}"></label>
<label class="field">${h.charge.minutes} <input name="minutes" inputmode="numeric" autocomplete="off" value="${v.minutes}"></label>
<label class="field">${h.charge.rate} <input name="rate" inputmode="decimal" autocomplete="off" value="${v.rate}"></label>
<p class="note">${h.charge.hint}</p><p class="note">${h.charge.privacy}</p>
<button class="btn primary" type="submit">${h.charge.save}</button></form>
<p><a href="/health">${c.w.common.back}</a> · <a href="/shops/${s.id}">${h.open}</a></p>`);
}

// The template vote for Innovators (votes.ts); `refused` is shown when the round does not accept the pick.
export function votePage(c: Ctx, o: { round: VoteRound; mine: string | undefined; counts: Record<string, number> | undefined; saved?: boolean; refused?: boolean }): string {
  const h = HEALTH_WORDS[c.lang];
  const w = h.vote;
  return layout(c, w.title, html`<h1>${w.title}</h1>
<p>${w.intro}</p>
${o.saved ? html`<div class="notice" role="status">${w.saved}</div>` : ""}${o.refused ? html`<div class="notice" role="alert">${w.refused}</div>` : ""}
<form method="post" action="/vote">${csrf(c)}
<h2>${w.yours}</h2>${o.mine ? "" : html`<p class="note">${w.none}</p>`}
${o.round.options.map((opt) => html`<label class="field"><input type="radio" name="option" value="${opt.id}"${o.mine === opt.id ? raw(" checked") : raw("")} required> ${opt.label[c.lang]}</label>`)}
<button class="btn primary" type="submit">${o.mine ? w.change : w.button}</button></form>
<h2>${w.results}</h2>
${o.counts ? html`<ul class="plain">${o.round.options.map((opt) => html`<li class="info"><span class="mark">·</span><span>${opt.label[c.lang]}: <b>${w.votes(o.counts![opt.id] ?? 0)}</b></span></li>`)}</ul><p class="note">${w.note}</p>` : html`<p class="note">${w.hidden}</p>`}
<p><a href="/health">${c.w.common.back}</a></p>`);
}
