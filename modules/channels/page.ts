// A shop's public booking page, as plain HTML: phone-first, no JavaScript needed to book (a page that is still waiting refreshes itself with a meta tag), in the
// shop's languages (English, Hindi, Malayalam, Kannada; the last three machine-written and marked). Rendered by the public front (front.ts) from what the shop's
// runtime answers (backend.ts): the services and prices from the shop's settings, the free times from the same source the agent books against, and a booking's
// state, payment details and messages from its saved record. Nothing on the page is written from anything the customer typed except their own name, escaped.
//
// The page's rules (a content policy the front sends): no script, nothing loaded from anywhere, no frame, forms post only to the page itself. The UPI QR code is an
// inline SVG made here from the payment link (modules/qr), and the "Pay in your UPI app" button is the same link (upi://pay?...), which opens the customer's UPI app.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { localParts } from "../core/time.ts";
import { formatDate, formatInr, formatSlot, formatTime } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { textQrSvg } from "../qr/svg.ts";
import type { BookingView, Offer } from "./backend.ts";
import { PAGE } from "./words.ts";
import { FACE_CSS, facePartnerLine, shopFace } from "./shop-face.ts";
import type { PagesFile } from "./pages-file.ts";

const CSS = `
:root{--ink:#10231a;--mute:#4b5d52;--line:#cfe3d6;--g9:#14532d;--g7:#15803d;--g1:#dcfce7;--amber:#92400e;--amber-bg:#fffbeb;--bg:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Devanagari","Noto Sans Malayalam","Noto Sans Kannada",sans-serif}
main{max-width:34rem;margin:0 auto;padding:0 16px 40px}header{background:var(--g9);color:#fff;margin:0 -16px 16px;padding:18px 16px}header h1{margin:0;font-size:1.35rem}header p{margin:4px 0 0;opacity:.9}
h2{font-size:1.1rem;margin:22px 0 8px}a{color:var(--g7)}.langs a,.langs b{margin-right:10px}.note{color:var(--mute);font-size:.9rem}.machine{background:var(--amber-bg);color:var(--amber);padding:8px 10px;border-radius:8px;font-size:.9rem}
.list{list-style:none;padding:0;margin:0}.list li{margin:0 0 8px}.choice{display:block;border:1px solid var(--line);border-radius:10px;padding:12px;text-decoration:none;color:var(--ink)}.choice.on{border-color:var(--g7);background:var(--g1)}
.choice span{float:right;font-weight:600}.days a,.days b{display:inline-block;margin:0 6px 8px 0;padding:6px 10px;border:1px solid var(--line);border-radius:999px;text-decoration:none;font-size:.95rem}.days b{background:var(--g1);border-color:var(--g7)}
.slots{display:flex;flex-wrap:wrap;gap:8px}.slots label{border:1px solid var(--line);border-radius:8px;padding:8px 10px}.slots input{margin-right:6px}
label.f{display:block;margin:10px 0 4px;font-weight:600}input[type=text],input[type=tel]{width:100%;font-size:1.05rem;padding:10px;border:1px solid var(--line);border-radius:8px}
button,.btn{display:inline-block;margin-top:14px;font-size:1.05rem;padding:12px 18px;border-radius:10px;border:0;background:var(--g7);color:#fff;text-decoration:none;cursor:pointer}
button.quiet{background:#fff;color:var(--g9);border:1px solid var(--line)}.status{font-size:1.15rem;font-weight:600;margin:16px 0}.box{border:1px solid var(--line);border-radius:12px;padding:14px;margin:14px 0}
.qr svg{width:220px;height:220px;display:block;margin:10px 0}.msgs li{border-left:3px solid var(--line);padding:4px 10px;margin:0 0 8px}.warn{color:var(--amber)}footer{margin-top:28px;border-top:1px solid var(--line);padding-top:12px}
`;

export interface PageShop { name: string; publicUrl: string }

/** The whole page: head, header and the content, with the language links and, for a machine-written language, the note that says so. */
function layout(o: { shop: Offer["shop"]; language: Language; title: string; body: Raw; refreshSeconds?: number; selfPath: string; query?: Record<string, string>; /** Item 11f: the shop's face and the partner's line (the booking page's front). */ face?: Raw; foot?: Raw }): string {
  const w = PAGE[o.language];
  const link = (l: Language) => { const q = new URLSearchParams({ ...(o.query ?? {}), lang: l }); return `${o.selfPath}?${q}`; };
  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
${o.refreshSeconds ? raw(`<meta http-equiv="refresh" content="${o.refreshSeconds}">`) : ""}<title>${o.title}</title><style>${raw(CSS)}${FACE_CSS}</style></head>
<body><main><header><h1>${o.shop.name}</h1>${o.shop.address ? html`<p>${o.shop.address}</p>` : ""}</header>
${o.shop.languages.length > 1 ? html`<p class="langs" aria-label="${w.language}">${o.shop.languages.map((l) => (l === o.language ? html`<b>${LANGUAGE_LABEL[l]}</b>` : html`<a href="${link(l)}" hreflang="${l}">${LANGUAGE_LABEL[l]}</a>`))}</p>` : ""}
${w.machine ? html`<p class="machine">${w.machine}</p>` : ""}
${o.face ?? ""}${o.body}${o.foot ?? ""}
</main></body></html>`.markup}`;
}

const LANGUAGE_LABEL: Record<Language, string> = { en: "English", hi: "हिन्दी", ml: "മലയാളം", kn: "ಕನ್ನಡ" };

const dateOf = (iso: string) => { const [year, month, day] = iso.split("-").map(Number); return { year, month, day }; };

/** The footer every page has: what an AI assistant can do here, the API, and that the shop's limits apply. */
function footer(shop: PageShop, language: Language): Raw {
  const w = PAGE[language];
  return html`<footer><h2>${w.assistantsTitle}</h2><p class="note">${w.assistants(`${shop.publicUrl}/mcp`, `${shop.publicUrl}/api/v1`)}</p></footer>`;
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
  if (s.paused) return layout({ shop: s, language: o.language, title: w.title(s.name), selfPath: self, face, foot, body: html`<p class="status warn">${w.paused}</p>${footer(o.shop, o.language)}` });
  const deposit = formatInr(s.deposit.amountInr);
  const chosen = o.offer.services.find((x) => x.id === o.serviceId);
  const services = html`<h2>${w.pickService}</h2><ul class="list">${o.offer.services.map((x) => html`<li><a class="choice${x.id === chosen?.id ? " on" : ""}" href="${q({ service: x.id })}">${x.names[o.language]}<span>${formatInr(x.priceInr)}</span><br><small class="note">${w.minutes(x.durationMinutes)}</small></a></li>`)}</ul>`;
  let times: Raw | string = "";
  if (chosen) {
    const days = o.offer.days ?? [];
    const open = days.filter((d) => d.starts.length > 0);
    const day = days.find((d) => d.date === o.date && d.starts.length > 0) ?? open[0];
    if (o.offer.calendarUnread) times = html`<h2>${w.pickTime}</h2><p class="warn">${w.calendarUnread}</p>`;
    else if (!day) times = html`<h2>${w.pickTime}</h2><p>${w.noDays}</p>`;
    else {
      times = html`<h2>${w.pickTime}</h2>
<p class="days">${days.map((d) => (d.date === day.date ? html`<b>${formatDate(dateOf(d.date), o.language)}</b>` : d.starts.length > 0 ? html`<a href="${q({ service: chosen.id, date: d.date })}">${formatDate(dateOf(d.date), o.language)}</a>` : ""))}</p>
<form method="post" action="${o.shop.publicUrl}/book">
<input type="hidden" name="service" value="${chosen.id}"><input type="hidden" name="lang" value="${o.language}">${o.nonce ? html`<input type="hidden" name="nonce" value="${o.nonce}">` : ""}
<div class="slots">${day.starts.map((t, i) => html`<label><input type="radio" name="start" value="${t}" required${i === 0 ? raw(" checked") : ""}>${formatTime(localParts(t, tz), o.language)}</label>`)}</div>
<h2>${w.yourDetails}</h2>
<label class="f" for="name">${w.name}</label><input type="text" id="name" name="name" required maxlength="60" autocomplete="name" value="${o.values?.name ?? ""}">
<label class="f" for="phone">${w.phone}</label><input type="tel" id="phone" name="phone" required maxlength="20" autocomplete="tel" inputmode="tel" value="${o.values?.phone ?? ""}">
<p class="note">${w.phoneNote}</p>
<button type="submit">${w.hold}</button>
<p class="note">${w.cancelRule(s.cancellation.windowHours)}</p>
</form>`;
    }
  }
  return layout({
    shop: s, language: o.language, title: w.title(s.name), selfPath: self, face, foot, query: { ...(chosen ? { service: chosen.id } : {}), ...(o.date ? { date: o.date } : {}) },
    body: html`<p>${w.intro(deposit, s.payment.kind === "upi")}</p>${o.error ? html`<p class="status warn" role="alert">${o.error}</p>` : ""}${services}${times}${footer(o.shop, o.language)}`,
  });
}

/** A booking's own page: where it has got to, how to pay while it is held, cancel, and the shop's messages about it. Refreshes itself while something is still to come. */
export function statusPage(o: { shop: PageShop; offer: Offer; language: Language; handle: string; view: BookingView | null; notice?: string }): string {
  const w = PAGE[o.language];
  const s = o.offer.shop;
  const tz = s.timezone;
  const self = `${o.shop.publicUrl}/b/${o.handle}`;
  const v = o.view;
  const title = w.title(s.name);
  const again = html`<p><a class="btn" href="${o.shop.publicUrl}/?lang=${o.language}">${w.again}</a></p>`;
  if (!v) return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status">${w.unknown}</p>${again}` });
  if (v.status === "pending") return layout({ shop: s, language: o.language, title, selfPath: self, refreshSeconds: 2, body: html`<p class="status">${w.pending}</p><p class="note">${w.keepLink}</p>` });
  if (v.status === "not_done") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status warn">${w.notDone}</p>${again}` });
  if (v.status === "refused") return layout({ shop: s, language: o.language, title, selfPath: self, body: html`<p class="status warn">${w.refused[v.reason] ?? w.refused.unknown}</p>${again}` });

  const what = html`${v.service ? html`<p><b>${v.service.names[o.language]}</b> · ${formatInr(v.service.priceInr)}${v.startMs !== undefined ? html`<br>${formatSlot(v.startMs, tz, o.language)}` : ""}<br><small class="note">${w.note(v.ref)}</small></p>` : ""}`;
  const line = v.status === "held" ? w.held(v.holdExpiresAt !== undefined ? formatSlot(v.holdExpiresAt, tz, o.language) : "")
    : v.status === "booked" ? w.booked(v.startMs !== undefined ? formatSlot(v.startMs, tz, o.language) : "")
    : v.status === "checking" ? w.checking : v.status === "expired" ? w.expired : v.status === "cancelled" ? w.cancelled : v.status === "done" ? w.done : w.notHeld;
  let pay: Raw | string = "";
  if (v.status === "held" && v.pay?.kind === "upi") {
    const amount = formatInr(v.pay.leftPaise / 100);
    pay = html`<div class="box"><p><b>${w.upiPay(amount, v.pay.payTo.name, v.pay.payTo.id)}</b></p>
<p><a class="btn" href="${v.pay.link}">${w.openUpi}</a></p>
<p class="note">${w.scan}</p><div class="qr">${raw(textQrSvg(v.pay.link, { label: w.upiPay(amount, v.pay.payTo.name, v.pay.payTo.id) }))}</div>
<p class="note">${w.afterPay}</p>
${v.canSayPaid ? html`<form method="post" action="${self}/paid"><input type="hidden" name="lang" value="${o.language}"><button class="quiet" type="submit">${w.paid}</button></form>` : ""}</div>`;
  } else if (v.status === "held" && v.pay?.kind === "link") {
    pay = html`<div class="box"><p><a class="btn" href="${v.pay.url}" rel="noreferrer">${w.linkPay(formatInr(v.depositInr))}</a></p></div>`;
  }
  const cancel = v.canCancel ? html`<form method="post" action="${self}/cancel"><input type="hidden" name="lang" value="${o.language}"><button class="quiet" type="submit">${w.cancel}</button><p class="note">${w.cancelRule(s.cancellation.windowHours)}</p></form>` : "";
  const messages = v.messages.length > 0 ? html`<h2>${w.messages}</h2><ul class="list msgs">${[...v.messages].reverse().map((m) => html`<li>${m.text}<br><small class="note">${formatSlot(m.atMs, tz, o.language)}</small></li>`)}</ul>` : "";
  return layout({
    shop: s, language: o.language, title, selfPath: self,
    // held: look again every 15 s, so "Booked" shows once the owner marks the payment; checking: every 30 s
    ...(v.status === "held" ? { refreshSeconds: 15 } : v.status === "checking" ? { refreshSeconds: 30 } : {}),
    body: html`${o.notice ? html`<p class="note" role="status">${o.notice}</p>` : ""}<p class="status${v.status === "not_held" || v.status === "expired" ? " warn" : ""}">${line}</p>${what}${pay}${v.status === "not_held" || v.status === "expired" ? again : ""}${cancel}${messages}<p class="note">${w.keepLink}</p>${footer(o.shop, o.language)}`,
  });
}
