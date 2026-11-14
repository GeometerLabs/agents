// The Money section of the owner's app, as one HTML fragment (the figures are owner-money.ts, the words words-owner.ts). Built here and NOT wired into
// channels/owner-page.ts: a later step puts it in the page and serves the export links.
//
// Phone first, and only the page's own look: the cards, stamps and big `.amt` figures of channels/look.ts (`.item`, `.top`, `.stamp`, `.amt`, `.calm`, `.row`,
// `.btn.quiet`, `.note`, `.machine`), so it needs no style and no script. Every figure is bold and large; a list says what to do in one sentence. Every value goes
// through html`` (escaped by default). Amounts are written from integer paise, whole rupees without decimals, with Indian grouping (language/format.ts).
import { html } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { formatDate, formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { localParts } from "../core/time.ts";
import { fyPeriodOf } from "./periods.ts";
import { OWNER_MONEY_WORDS } from "./words-owner.ts";
import type { MoneyView, NotMatched } from "./owner-money.ts";

/** The addresses of the three downloads (the routes are wired later). Handed in so this file knows no route. */
export interface ExportLinks { thisMonth: string; lastMonth: string; year: string }

/** "₹1,200", or "₹1,200.50" when the paise are not whole rupees: integer arithmetic, never a float's rounding. */
export function inr(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const rest = Math.abs(paise % 100);
  return rest === 0 ? formatInr(rupees) : `${formatInr(rupees)}.${String(rest).padStart(2, "0")}`;
}

export function ownerMoneySection(view: MoneyView, language: Language, links: ExportLinks, timeZone: string, nowMs: number): Raw {
  const w = OWNER_MONEY_WORDS[language];
  const ref = (c: string | null): string => c ?? w.aCase;
  const fig = (tone: string, label: string, paise: number, note?: string): Raw =>
    html`<div class="item s-${tone}"><div class="top"><span class="stamp">${label}</span><span class="amt">${inr(paise)}</span></div>${note ? html`<p class="note">${note}</p>` : ""}</div>`;
  const m = view.month;
  const owed = view.owedBack.length === 0
    ? html`<p class="calm">${w.owedNone}</p>`
    : view.owedBack.map((o) => html`<div class="item s-wait"><div class="top"><span class="amt">${inr(o.paise)}</span></div><p>${(o.why === "owner_pays_upi" ? w.owedUpi : w.owedService)(ref(o.case))}</p></div>`);
  const sentence = (n: NotMatched): string => {
    switch (n.kind) {
      case "upi_claim": return w.upiClaim(inr(n.paise), ref(n.case));
      case "gateway": return w.gateway(inr(n.paise), ref(n.case), formatDate(localParts(n.sinceMs, timeZone), language));
      case "untold_refund": return w.untold(inr(n.paise), ref(n.case));
    }
  };
  const unmatched = view.notMatched.length === 0
    ? html`<p class="calm">${w.notMatchedNone}</p>`
    : view.notMatched.map((n) => html`<div class="item s-info"><p>${sentence(n)}</p></div>`);
  const fy = fyPeriodOf(nowMs, timeZone);
  return html`<section class="money" lang="${language}">
<h2>${w.title}</h2>
${w.machine ? html`<p class="machine">${w.machine}</p>` : ""}
<h3>${w.today}</h3>
${fig("ok", w.received, view.today.received.paise, w.payments(view.today.received.count))}
${fig("info", w.givenBack, view.today.givenBack.paise, w.refunds(view.today.givenBack.count))}
<h3>${w.month}</h3>
${fig("ok", w.received, m.received.paise, w.payments(m.received.count))}
${fig("info", w.givenBack, m.givenBack.paise, w.refunds(m.givenBack.count))}
${m.keptPaise !== 0 ? fig("plain", w.kept, m.keptPaise) : ""}
${m.gatewayChargesPaise !== 0 ? fig("plain", w.charges, m.gatewayChargesPaise) : ""}
${m.stillToCome ? fig("wait", w.stillToCome, m.stillToCome.paise, w.fees(m.stillToCome.count)) : ""}
${view.byWord.length > 0 ? html`<div class="item s-plain"><p><b>${w.byWordTitle}</b></p>${view.byWord.map((b) => html`<p>${w.byWordRow(inr(b.paise), ref(b.case))}</p>`)}</div>` : ""}
<h3>${w.owedTitle}</h3>
${owed}
<h3>${w.notMatchedTitle}</h3>
${unmatched}
<div class="card"><h3>${w.accountantTitle}</h3><p class="note">${w.accountantNote}</p>
<div class="row"><a class="btn quiet" href="${links.thisMonth}" download>${w.thisMonth}</a><a class="btn quiet" href="${links.lastMonth}" download>${w.lastMonth}</a><a class="btn quiet" href="${links.year}" download>${w.thisYear(fy)}</a></div></div>
<p class="note">${w.scope}</p>
</section>`;
}
