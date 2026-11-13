// A shop's public booking page, as plain HTML: phone-first, no JavaScript needed to book (a page that is still waiting refreshes itself with a meta tag), in the
// shop's languages (English, Hindi, Malayalam, Kannada; the last three machine-written and marked). Rendered by the public front (front.ts) from what the shop's
// runtime answers (backend.ts): the services and prices from the shop's settings, the free times from the same source the agent books against, and a booking's
// state, payment details and messages from its saved record. Nothing on the page is written from anything the customer typed except their own name, escaped.
//
// The page's rules (a content policy the front sends): no script, nothing loaded from anywhere, no frame, forms post only to the page itself. The UPI QR code is an
// inline SVG made here from the payment link (modules/qr), and the "Pay in your UPI app" button is the same link (upi://pay?...), which opens the customer's UPI app.
//
// The look (item 11i's design pass, 14 Nov 2026) is the shared one in look.ts (CUSTOMER_CSS): the head with the shop's character on every page, a state as a stamp in its
// meaning's colour (stateBlock), services and times as large tiles, the shop's messages as coloured bubbles, the AI assistants' note folded at the foot.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { localParts } from "../core/time.ts";
import { formatDate, formatInr, formatSlot, formatTime } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { textQrSvg } from "../qr/svg.ts";
import type { BookingView, Offer, PayInstructions } from "./backend.ts";
import { PAGE } from "./words.ts";
import { facePartnerLine, shopFace, shopHead } from "./shop-face.ts";
import { CUSTOMER_CSS } from "./look.ts";
import { STAMP, STAMP_TONE } from "./words-look.ts";
import type { StampKey, Tone } from "./words-look.ts";
import { CONFIRM } from "./words-confirm.ts";
import type { PagesFile } from "./pages-file.ts";


// The shop's messages keep their own line breaks (look.ts `.msgs li`, white-space: pre-line): Bookings' quote puts the UPI ID and who confirms on lines of their own.

export interface PageShop { name: string; publicUrl: string }

/**
 * The whole page: the head (the shop's character, name and mood, and the language links), the note that says a language is machine-written, and the content.
 * Shared with item 11h's pages (order-page.ts, fee-page.ts), so every customer view of a shop looks and behaves the same. `face`: the front page's extras under
 * the head (shop-face.ts shopFace: WhatsApp and the hours); `foot`: the partner's line. A page that reloads itself (`refreshSeconds`) shows the head without the
 * face's picture, so a phone waiting on it does not fetch the picture again every few seconds.
 */
export function layout(o: { shop: Pick<Offer["shop"], "name" | "address" | "languages" | "character">; language: Language; title: string; body: Raw; refreshSeconds?: number; selfPath: string; query?: Record<string, string>; face?: Raw; foot?: Raw }): string {
  const w = PAGE[o.language];
  const link = (l: Language) => { const q = new URLSearchParams({ ...(o.query ?? {}), lang: l }); return `${o.selfPath}?${q}`; };
  // theme-color: the phone's bar takes the head's tint, so the page and the bar read as one
  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#e2f2e9">
${o.refreshSeconds ? raw(`<meta http-equiv="refresh" content="${o.refreshSeconds}">`) : ""}<title>${o.title}</title><style>${raw(CUSTOMER_CSS)}</style></head>
<body><header class="head"><div class="wrap">${shopHead({ shop: o.shop, language: o.language, picture: !o.refreshSeconds })}
${o.shop.languages.length > 1 ? html`<p class="langs" aria-label="${w.language}">${o.shop.languages.map((l) => (l === o.language ? html`<b>${LANGUAGE_LABEL[l]}</b>` : html`<a href="${link(l)}" hreflang="${l}">${LANGUAGE_LABEL[l]}</a>`))}</p>` : ""}</div></header>
<main class="wrap">${w.machine ? html`<p class="machine">${w.machine}</p>` : ""}
${o.face ?? ""}${o.body}${o.foot ?? ""}
</main></body></html>`.markup}`;
}

/**
 * A state on a customer's page: its stamp, in its meaning's colour, over the sentence that says it (words-look.ts). `tone` overrides the stamp's own colour (a
 * refund that was sent is green, one still to come is amber). `id` goes on the sentence, where links and tests find it.
 */
export function stateBlock(key: StampKey, language: Language, text: string, o: { tone?: Tone; role?: "status" | "alert"; id?: string } = {}): Raw {
  return html`<div class="state s-${o.tone ?? STAMP_TONE[key]}"${o.role ? raw(` role="${o.role}"`) : ""}><span class="stamp">${STAMP[language][key]}</span><p class="status"${o.id ? raw(` id="${o.id}"`) : ""}>${text}</p></div>`;
}

/** A line from the front that is not a state (too many requests, a form to check): red, no stamp, read out at once. */
export const errorBlock = (text: string): Raw => html`<div class="state s-bad" role="alert"><p class="status">${text}</p></div>`;

export const LANGUAGE_LABEL: Record<Language, string> = { en: "English", hi: "हिन्दी", ml: "മലയാളം", kn: "ಕನ್ನಡ" };

const dateOf = (iso: string) => { const [year, month, day] = iso.split("-").map(Number); return { year, month, day }; };

/** The footer every page has: what an AI assistant can do here, the API, and that the shop's limits apply, folded under its title. */
function footer(shop: PageShop, language: Language): Raw {
  const w = PAGE[language];
  // folded: a customer rarely needs it, and it is the page's longest paragraph
  return html`<footer><details><summary>${w.assistantsTitle}</summary><p class="note">${w.assistants(`${shop.publicUrl}/mcp`, `${shop.publicUrl}/api/v1`)}</p></details></footer>`;
}

/**
 * The booking page: the services; with a service chosen, its free days and times; with a day, the form (a time, the name and the number). `offer` is the runtime's
 * answer for the chosen service (or the services alone). `error` is a plain line from the front (too many requests, a form to check).
 */
export function bookingPage(o: { shop: PageShop; offer: Offer; language: Language; serviceId?: string; date?: string; error?: string; values?: { name?: string; phone?: string }; /** The form's random nonce (handle.ts handleFromNonce): a second tap is the same booking. */ nonce?: string; /** Item 11f: the shop's page addresses (its WhatsApp number, the panel's link). */ pages?: PagesFile }): string {
  const w = PAGE[o.language];
  const s = o.offer.shop;
  // item 11f: the customer view's head (the character, the hours, WhatsApp) and the partner's small line
  const face = shopFace({ shop: s, language: o.language, ...(o.pages ? { pages: o.pages } : {}) });
  const foot = facePartnerLine(o.language, o.pages);
  const tz = s.timezone;
  const self = `${o.shop.publicUrl}/`;
  const q = (extra: Record<string, string>) => `${self}?${new URLSearchParams({ lang: o.language, ...extra })}`;
  if (s.paused) return layout({ shop: s, language: o.language, title: w.title(s.name), selfPath: self, face, foot, body: html`${stateBlock("paused", o.language, w.paused)}${footer(o.shop, o.language)}` });
  const deposit = formatInr(s.deposit.amountInr);
  const chosen = o.offer.services.find((x) => x.id === o.serviceId);
  const services = html`<h2>${w.pickService}</h2><ul class="list">${o.offer.services.map((x) => html`<li><a class="choice${x.id === chosen?.id ? " on" : ""}" href="${q({ service: x.id })}"${x.id === chosen?.id ? raw(' aria-current="true"') : ""}><b>${x.names[o.language]}</b><span>${formatInr(x.priceInr)}</span><small class="note">${w.minutes(x.durationMinutes)}</small></a></li>`)}</ul>`;
  let times: Raw | string = "";
  if (chosen) {
    const days = o.offer.days ?? [];
    const open = days.filter((d) => d.starts.length > 0);
    const day = days.find((d) => d.date === o.date && d.starts.length > 0) ?? open[0];
    if (o.offer.calendarUnread) times = html`<h2>${w.pickTime}</h2>${errorBlock(w.calendarUnread)}`;
    else if (!day) times = html`<h2>${w.pickTime}</h2><p class="card">${w.noDays}</p>`;
    else {
      times = html`<h2>${w.pickTime}</h2>
<p class="days">${days.map((d) => (d.date === day.date ? html`<b aria-current="date">${formatDate(dateOf(d.date), o.language)}</b>` : d.starts.length > 0 ? html`<a href="${q({ service: chosen.id, date: d.date })}">${formatDate(dateOf(d.date), o.language)}</a>` : ""))}</p>
<form method="post" action="${o.shop.publicUrl}/book">
<input type="hidden" name="service" value="${chosen.id}"><input type="hidden" name="lang" value="${o.language}">${o.nonce ? html`<input type="hidden" name="nonce" value="${o.nonce}">` : ""}
<div class="slots">${day.starts.map((t, i) => html`<label><input type="radio" name="start" value="${t}" required${i === 0 ? raw(" checked") : ""}><span>${formatTime(localParts(t, tz), o.language)}</span></label>`)}</div>
<h2>${w.yourDetails}</h2>
<label class="f" for="name">${w.name}</label><input type="text" id="name" name="name" required maxlength="60" autocomplete="name" value="${o.values?.name ?? ""}">
<label class="f" for="phone">${w.phone}</label><input type="tel" id="phone" name="phone" required maxlength="20" autocomplete="tel" inputmode="tel" value="${o.values?.phone ?? ""}">
<p class="note">${w.phoneNote}</p>
<button type="submit" class="full">${w.hold}</button>
<p class="note">${w.cancelRule(s.cancellation.windowHours)}</p>
</form>`;
    }
  }
  return layout({
    shop: s, language: o.language, title: w.title(s.name), selfPath: self, face, foot, query: { ...(chosen ? { service: chosen.id } : {}), ...(o.date ? { date: o.date } : {}) },
    body: html`<p>${w.intro(deposit, s.payment.kind === "upi")}</p>${o.error ? errorBlock(o.error) : ""}${services}${times}${footer(o.shop, o.language)}`,
  });
}

/**
 * How to pay by UPI, the same box on a booking's, an order's and a fee's page: the amount and who to, the button that opens the customer's UPI app, the code to
 * scan (on a white ground, so a camera reads it in any theme), what happens next and, where the page has it, "I have paid" (posting to `paid.action`).
 */
export function upiBox(o: { pay: Extract<PayInstructions, { kind: "upi" }>; language: Language; afterPay: string; paidAction?: string }): Raw {
  const p = PAGE[o.language];
  const label = p.upiPay(formatInr(o.pay.leftPaise / 100), o.pay.payTo.name, o.pay.payTo.id);
  return html`<div class="box pay"><p class="amount"><b>${label}</b></p><a class="btn full" href="${o.pay.link}">${p.openUpi}</a>
<p class="note">${p.scan}</p><div class="qr">${raw(textQrSvg(o.pay.link, { label }))}</div><p class="note">${o.afterPay}</p>
${o.paidAction ? html`<form method="post" action="${o.paidAction}"><input type="hidden" name="lang" value="${o.language}"><button class="quiet full" type="submit">${p.paid}</button></form>` : ""}</div>`;
}

/** The shop's messages about a booking or an order, newest first, as bubbles with the time under each. */
export function messageList(messages: readonly { atMs: number; text: string }[], timeZone: string, language: Language): Raw | "" {
  if (messages.length === 0) return "";
  return html`<h2>${PAGE[language].messages}</h2><ul class="msgs">${[...messages].reverse().map((m) => html`<li>${m.text}<small class="note">${formatSlot(m.atMs, timeZone, language)}</small></li>`)}</ul>`;
}

/** The stamp of a booking's or an order's state. */
export const STAMP_OF: Record<string, StampKey> = { held: "held", checking: "checking", booked: "booked", confirmed: "confirmed", expired: "expired", cancelled: "cancelled", done: "done", not_held: "notHeld" };
/** A refund's colour: on its way or being decided waits (amber), sent is done (green), kept is closed (grey). */
export const REFUND_TONE: Record<"asked" | "owed" | "sent" | "kept", Tone> = { asked: "wait", owed: "wait", sent: "ok", kept: "plain" };

/**
 * A booking's own page: where it has got to, how to pay while it is held, cancel, and the shop's messages about it. Refreshes itself while something is still to come.
 * Item 11h (decision 45): it is the customer's confirmation page without WhatsApp: the refund as the record holds it, a calendar file (`ics`), and (`alerts`, already
 * drawn, with the push service's script) "Tell me on this phone".
 */
export function statusPage(o: { shop: PageShop; offer: Offer; language: Language; handle: string; view: BookingView | null; notice?: string; ics?: string; alerts?: string }): string {
  const w = PAGE[o.language];
  const s = o.offer.shop;
  const tz = s.timezone;
  const self = `${o.shop.publicUrl}/b/${o.handle}`;
  const v = o.view;
  const title = w.title(s.name);
  const again = html`<p><a class="btn" href="${o.shop.publicUrl}/?lang=${o.language}">${w.again}</a></p>`;
  if (!v) return layout({ shop: s, language: o.language, title, selfPath: self, body: html`${stateBlock("unknown", o.language, w.unknown)}${again}` });
  if (v.status === "pending") return layout({ shop: s, language: o.language, title, selfPath: self, refreshSeconds: 2, body: html`${stateBlock("holding", o.language, w.pending, { role: "status" })}<p class="note">${w.keepLink}</p>` });
  if (v.status === "not_done") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`${stateBlock("notDone", o.language, w.notDone)}${again}` });
  if (v.status === "refused") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`${stateBlock("refused", o.language, w.refused[v.reason] ?? w.refused.unknown)}${again}` });

  const what = html`${v.service ? html`<div class="card sum"><p><b>${v.service.names[o.language]}</b> · ${formatInr(v.service.priceInr)}${v.startMs !== undefined ? html`<br>${formatSlot(v.startMs, tz, o.language)}` : ""}<br><small class="note">${w.note(v.ref)}</small></p></div>` : ""}`;
  const line = v.status === "held" ? w.held(v.holdExpiresAt !== undefined ? formatSlot(v.holdExpiresAt, tz, o.language) : "")
    : v.status === "booked" ? w.booked(v.startMs !== undefined ? formatSlot(v.startMs, tz, o.language) : "")
    : v.status === "checking" ? w.checking : v.status === "expired" ? w.expired : v.status === "cancelled" ? w.cancelled : v.status === "done" ? w.done : w.notHeld;
  let pay: Raw | string = "";
  if (v.status === "held" && v.pay?.kind === "upi") pay = upiBox({ pay: v.pay, language: o.language, afterPay: w.afterPay, ...(v.canSayPaid ? { paidAction: `${self}/paid` } : {}) });
  else if (v.status === "held" && v.pay?.kind === "link") pay = html`<div class="box pay"><a class="btn full" href="${v.pay.url}" rel="noreferrer">${w.linkPay(formatInr(v.depositInr))}</a></div>`;
  const cancel = v.canCancel ? html`<form method="post" action="${self}/cancel"><input type="hidden" name="lang" value="${o.language}"><button class="quiet full" type="submit">${w.cancel}</button><p class="note">${w.cancelRule(s.cancellation.windowHours)}</p></form>` : "";
  const c = CONFIRM[o.language];
  const refund = v.refund ? stateBlock("refund", o.language, c.refund[v.refund.state](formatInr(v.refund.amountInr)), { tone: REFUND_TONE[v.refund.state], id: "refund" }) : "";
  const calendar = o.ics ? html`<div class="card"><a class="btn quiet full" href="${o.ics}" download>${c.ics}</a><p class="note">${c.icsNote}</p></div>` : "";
  const sad = v.status === "not_held" || v.status === "expired";
  return layout({
    shop: s, language: o.language, title, selfPath: self,
    // held: look again every 15 s, so "Booked" shows once the owner marks the payment; checking: every 30 s
    ...(v.status === "held" ? { refreshSeconds: 15 } : v.status === "checking" ? { refreshSeconds: 30 } : {}),
    body: html`${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : ""}${stateBlock(STAMP_OF[v.status] ?? "notHeld", o.language, line)}${refund}${what}${pay}${calendar}${o.alerts ? raw(o.alerts) : ""}${sad ? again : ""}${cancel}${messageList(v.messages, tz, o.language)}<p class="note">${w.keepLink}</p>${footer(o.shop, o.language)}`,
  });
}
