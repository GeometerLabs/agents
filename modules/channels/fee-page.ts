// Item 11h: a Fees centre's pages, as plain HTML: the centre's own page (who it is, and that fees are paid from each parent's private link), a parent's private page
// (their students' fees, how to pay each, "I have paid", and what the centre's record shows), and a payment's confirmation page (one fee, "confirmed" only when the
// centre's record shows it paid). Rendered by the public front (front-fees.ts) from what the centre's runtime answers (backend.ts feesOffer, parentView,
// feeConfirmView). The booking page's rules (page.ts): no script, nothing loaded from anywhere, forms post only to the page itself, the UPI QR code inline.
//
// No page here takes a phone number, and none shows one: a parent's fees are reached only through the private link the centre gave them.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { localParts } from "../core/time.ts";
import { MONTH_NAMES, formatDate, formatInr } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { textQrSvg } from "../qr/svg.ts";
import type { FeeConfirmView, FeeLine, FeesOffer, ParentView } from "./backend.ts";
import { PAGE } from "./words.ts";
import { FEE_PAGE } from "./words-orders-fees.ts";
import { layout } from "./page.ts";
import type { PageShop } from "./page.ts";
import { facePartnerLine, shopFace } from "./shop-face.ts";
import type { PagesFile } from "./pages-file.ts";

/** "November 2026", in the reader's language, from a fee's month ("2026-11"). */
export const monthText = (month: string, language: Language): string => {
  const [year, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[language][m - 1]} ${year}`;
};

/** The centre's own page: who it is, and how parents reach their fees (the private link in the centre's reminder). No form: a number typed here would open nothing. */
export function feesCentrePage(o: { shop: PageShop; offer: FeesOffer; language: Language; pages?: PagesFile }): string {
  const w = FEE_PAGE[o.language];
  const s = o.offer.shop;
  const face = shopFace({ shop: s, language: o.language, ...(o.pages ? { pages: o.pages } : {}) });
  return layout({ shop: s, language: o.language, title: w.title(s.name), selfPath: `${o.shop.publicUrl}/`, face, foot: facePartnerLine(o.language, o.pages), body: html`<p>${s.paused ? w.paused : w.centreIntro}</p>` });
}

/** The amounts of one fee, as the record holds them. */
function amounts(f: FeeLine, language: Language): Raw {
  const w = FEE_PAGE[language];
  return html`<p>${w.fee(formatInr(f.feeInr))}${f.lateFeeInr > 0 ? html`<br>${w.late(formatInr(f.lateFeeInr))}` : ""}${f.waivedInr > 0 ? html`<br>${w.waived(formatInr(f.waivedInr))}` : ""}${f.paidInr > 0 ? html`<br>${w.paidSoFar(formatInr(f.paidInr))}` : ""}${f.state === "open" ? html`<br><b>${w.balance(formatInr(f.balanceInr))}</b>` : ""}</p>`;
}

/** How to pay one fee: the UPI request (a button that opens the parent's UPI app, and its QR code) or the centre's payment link. */
function payBox(f: FeeLine, language: Language): Raw | string {
  const p = PAGE[language];
  const w = FEE_PAGE[language];
  if (f.pay?.kind === "upi") {
    const amount = formatInr(f.pay.leftPaise / 100);
    return html`<p><b>${p.upiPay(amount, f.pay.payTo.name, f.pay.payTo.id)}</b></p><p><a class="btn" href="${f.pay.link}">${p.openUpi}</a></p>
<p class="note">${p.scan}</p><div class="qr">${raw(textQrSvg(f.pay.link, { label: p.upiPay(amount, f.pay.payTo.name, f.pay.payTo.id) }))}</div><p class="note">${w.afterPay}</p>`;
  }
  if (f.pay?.kind === "link") return html`<p><a class="btn" href="${f.pay.url}" rel="noreferrer">${w.payLink(formatInr(f.balanceInr))}</a></p>`;
  return "";
}

/** A fee's heading: the student, the batch and the month, and its due date. */
const feeHead = (f: FeeLine, timeZone: string, language: Language): Raw =>
  html`<h3>${FEE_PAGE[language].feeHead(f.student, f.batch[language], monthText(f.month, language))}</h3><p class="note">${FEE_PAGE[language].dueOn(formatDate(localParts(f.dueMs, timeZone), language))}</p>`;

/**
 * A parent's private page: their students, then each fee with its amounts; an open one with how to pay and "I have paid" (both forms post to this page's own
 * address, with a nonce so a double tap is one press). `base` is <the centre's page>/f/<link>.
 */
export function parentPage(o: { shop: PageShop; offer: FeesOffer; language: Language; base: string; view: ParentView; nonce: string; notice?: string }): string {
  const w = FEE_PAGE[o.language];
  const s = o.offer.shop;
  const tz = s.timezone;
  const form = (action: "pay" | "paid", dueId: string, label: string, quiet: boolean) => html`<form method="post" action="${o.base}/${action}"><input type="hidden" name="due" value="${dueId}"><input type="hidden" name="lang" value="${o.language}"><input type="hidden" name="nonce" value="${o.nonce}"><button${quiet ? raw(' class="quiet"') : ""} type="submit">${label}</button></form>`;
  const fees = o.view.dues.map((f) => {
    let state: Raw | string = "";
    if (f.state === "paid") state = html`<p class="status">${w.statePaid}</p>`;
    else if (f.state === "closed") state = html`<p class="status">${w.stateClosed}</p>`;
    else if (s.paused) state = html`<p class="warn">${w.paused}</p>`;
    else state = html`${f.claimed ? html`<p class="note" role="status">${w.claimed}</p>` : ""}${f.pay ? payBox(f, o.language) : form("pay", f.id, w.showPay, false)}${f.canSayPaid ? form("paid", f.id, w.paid, true) : ""}`;
    return html`<div class="box">${feeHead(f, tz, o.language)}${amounts(f, o.language)}${state}</div>`;
  });
  const open = o.view.dues.some((f) => f.state === "open");
  return layout({
    shop: s, language: o.language, title: w.title(s.name), selfPath: o.base, ...(open ? { refreshSeconds: 60 } : {}),
    body: html`<p class="note">${w.privateNote}</p>${o.notice ? html`<p class="note" role="status">${o.notice}</p>` : ""}
<h2>${w.students}</h2><ul class="list">${o.view.students.map((x) => html`<li>${x.name} <small class="note">(${x.batch[o.language]})</small></li>`)}</ul>
<h2>${w.fees}</h2>${o.view.dues.length > 0 ? fees : html`<p>${w.none}</p>`}`,
  });
}

/** The page a link that opens nothing shows: no centre's name, nothing to learn, and what to do. */
export function parentLinkGone(o: { shop: PageShop; offer: FeesOffer; language: Language; selfPath: string }): string {
  return layout({ shop: o.offer.shop, language: o.language, title: FEE_PAGE[o.language].title(o.offer.shop.name), selfPath: o.selfPath, body: html`<p class="status warn">${FEE_PAGE[o.language].gone}</p>` });
}

/** A payment's confirmation page: one fee, and what the centre's record shows now. Refreshes itself while the centre has still to confirm it. */
export function feeConfirmPage(o: { shop: PageShop; offer: FeesOffer; language: Language; handle: string; view: FeeConfirmView | null }): string {
  const w = FEE_PAGE[o.language];
  const s = o.offer.shop;
  const self = `${o.shop.publicUrl}/fee/${o.handle}`;
  const title = w.confirmTitle;
  const v = o.view;
  if (!v) return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status warn">${w.refused.unknown}</p>` });
  if (v.status === "pending") return layout({ shop: s, language: o.language, title, selfPath: self, refreshSeconds: 2, body: html`<p class="status">${w.pending}</p><p class="note">${w.keepConfirm}</p>` });
  if (v.status === "not_done") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status warn">${w.notDone}</p>` });
  if (v.status === "refused") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status warn">${w.refused[v.reason] ?? w.refused.unknown}</p>` });
  const f = v.due;
  const month = monthText(f.month, o.language);
  const line = v.status === "confirmed" ? w.confirmed(f.student, month, formatInr(f.paidInr))
    : v.status === "closed" ? w.closed(f.student, month)
    : v.status === "part" ? w.part(formatInr(f.paidInr), formatInr(f.balanceInr))
    : v.status === "waiting" ? w.waiting(f.student, month) : w.open(formatInr(f.balanceInr), f.student, month);
  const done = v.status === "confirmed" || v.status === "closed";
  return layout({
    shop: s, language: o.language, title, selfPath: self, ...(done ? {} : { refreshSeconds: 15 }),
    body: html`<p class="status${done ? "" : " warn"}">${line}</p><div class="box">${feeHead(f, s.timezone, o.language)}${amounts(f, o.language)}${done ? "" : payBox(f, o.language)}</div><p class="note">${w.keepConfirm}</p>`,
  });
}
