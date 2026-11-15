// The Money section of the owner's app, as one HTML fragment (the figures are owner-money.ts, the words words-owner.ts). channels/owner-page.ts puts it in the
// page below what waits for the owner's answer, and channels/front.ts serves the download addresses (only to the owner's signed-in session).
//
// Phone first, and only the page's own look: the cards, stamps and big `.amt` figures of channels/look.ts (`.item`, `.top`, `.stamp`, `.amt`, `.calm`, `.row`,
// `.btn.quiet`, `.note`, `.machine`), so it needs no style and no script. Every figure is bold and large; a list says what to do in one sentence. Every value goes
// through html`` (escaped by default). Amounts are written from integer paise, whole rupees without decimals, with Indian grouping (language/format.ts).
import { html } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { formatDate, formatInr, MONTH_NAMES } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { localParts } from "../core/time.ts";
import { exportNames } from "./export.ts";
import { exportPeriods } from "./periods.ts";
import { OWNER_MONEY_WORDS } from "./words-owner.ts";
import type { MoneyView, NotMatched } from "./owner-money.ts";

/**
 * Where the accountant's files are: `base` is the owner app's accounting address, and a period's files are at `<base>/<period>/<file name>` (export.ts exportNames).
 * Handed in so this file knows no route. Left out (the panel's link page has no signed-in session): the section then shows no download card.
 */
export interface ExportLinks { base: string }

/** "₹1,200", or "₹1,200.50" when the paise are not whole rupees: integer arithmetic, never a float's rounding. */
export function inr(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const rest = Math.abs(paise % 100);
  return rest === 0 ? formatInr(rupees) : `${formatInr(rupees)}.${String(rest).padStart(2, "0")}`;
}

export function ownerMoneySection(view: MoneyView, language: Language, links: ExportLinks | undefined, timeZone: string): Raw {
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
      case "gateway_held": return w.gatewayHeld(inr(n.paise), ref(n.case));
      case "not_through_assistant": return w.notThrough(inr(n.paise));
      case "untold_refund": return w.untold(inr(n.paise), ref(n.case));
    }
  };
  const unmatched = view.notMatched.length === 0
    ? html`<p class="calm">${w.notMatchedNone}</p>`
    : view.notMatched.map((n) => html`<div class="item s-info"><p>${sentence(n)}</p></div>`);
  // the three periods come from the month the runtime says it is (view.period), so the links, their labels and the front's allowed set all follow one clock
  const periods = exportPeriods(view.period);
  const [py, pm] = view.period.split("-").map(Number);
  const rows = (): Raw => {
    const row = (label: string, period: string): Raw => {
      const n = exportNames(period);
      const file = (name: string, text: string): Raw => html`<a class="btn quiet" href="${links!.base}/${period}/${name}">${text}</a>`;
      return html`<p><b>${label}</b></p><div class="row">${file(n.journal, w.fileJournal)}${file(n.documents, w.fileDocuments)}${file(n.readme, w.fileReadme)}</div>`;
    };
    // the WhatsApp link carries the words only, never a file or a customer: the accountant is asked for, the files are sent from the downloads above
    const share = `https://wa.me/?text=${encodeURIComponent(w.shareText(`${MONTH_NAMES[language][pm - 1]} ${py}`))}`;
    return html`${row(w.thisMonth, periods.thisMonth)}${row(w.lastMonth, periods.lastMonth)}${row(w.thisYear(periods.year), periods.year)}<p><a class="btn quiet" href="${share}" rel="noopener">${w.shareWhatsapp}</a></p>`;
  };
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
${links ? html`<div class="card"><h3>${w.accountantTitle}</h3><p class="note">${w.accountantNote}</p>${rows()}</div>` : ""}
<p class="note">${w.scope}</p>
</section>`;
}
