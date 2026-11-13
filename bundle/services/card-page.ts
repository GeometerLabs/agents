// A local partner's calling card as one HTML page (plan item 11g, decision 49): what https://<pages domain>/@<handle> shows. The front door (door.ts) asks fleet for
// the published card (monorepo apps/fleet, GET /v1/partner-cards/<handle>), hands the answer to `cardPage`, and sends the result with its own no-script policy.
//
// WHY IT LOOKS LIKE THIS. The page must open fast on a budget Android phone on a slow connection, so it is plain HTML and one inline style sheet: no script, no
// web font (the phone's own font, with the rounded one first where it has it), no picture to fetch (the face is an inline SVG, cleaned by fleet before it was kept; the
// QR code is an inline SVG made here), and no layout that waits for anything. The look is Streetlist's (the repository `streetlist`, src/styles/site.css): limewash
// paper, ink, shutter green for links, marigold for the partners' colour, flat colours, light for everyone (the owner's 14 Nov rule: no dark theme here, and the page
// does not read the phone's own setting).
//
// WHAT IS ESCAPED. Everything a partner typed (name, introduction, area, service names, shop names) goes through `esc`; the WhatsApp link is built from digits only;
// the face is the one string that is not escaped, because fleet rebuilt it from an allow-list of drawing parts and it is never built from what a visitor sent.
// The words follow the site's rules: no promise of income, no ranks, points or streaks; the partner's own prices are shown as they typed them, and Geometer's
// standing line about WhatsApp charges is always there.
import { textQrSvg } from "../../modules/qr/svg.ts";

/** What fleet's lookup answers for a published card (apps/fleet/src/partner-cards.ts CardLookup, the "active" case). */
export interface PartnerCard {
  handle: string;
  name: string;
  intro: string;
  face: { style: string; svg: string };
  area: string;
  languages: string[];
  /** Digits only, country code first, or null. */
  whatsapp: string | null;
  services: { name: string; monthly: number; setup: number }[];
  shop_count: number;
  shops: { name: string; slug: string }[];
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", hi: "Hindi", ml: "Malayalam", kn: "Kannada", ta: "Tamil", te: "Telugu", mr: "Marathi", bn: "Bengali", gu: "Gujarati", pa: "Punjabi", or: "Odia", ur: "Urdu",
};

/** Text into HTML: the five characters that can change what a page means. */
export const esc = (s: string): string => s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");

/** Rupees with Indian digit grouping (12,34,567), without ICU, which a slim Node image may not carry. */
export function rupees(n: number): string {
  const s = String(Math.max(0, Math.trunc(n)));
  if (s.length <= 3) return `₹${s}`;
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/gu, ",");
  return `₹${head},${s.slice(-3)}`;
}

/** The standing line about WhatsApp charges (plan item 11g): the partner's prices never include them. */
export const WHATSAPP_LINE = "WhatsApp message charges are passed on at cost and paid from the shop's own WhatsApp account.";

const CSS = `
:root{--paper:#f7f8f4;--card:#fff;--ink:#1d2427;--soft:#4c585b;--line:#dde3dc;--green:#136650;--marigold:#f6a609;--tint:#fff1cf;--focus:#1f5fd1}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif}
a{color:var(--green)}
a:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
h1,h2,.brand{font-family:ui-rounded,"Baloo 2","Segoe UI",system-ui,sans-serif;line-height:1.2}
.top{border-bottom:1px solid var(--line);background:var(--card)}
.top div{max-width:40rem;margin:0 auto;padding:12px 16px}
.brand{font-weight:700;font-size:1.15rem;color:var(--ink);text-decoration:none}
main{max-width:40rem;margin:0 auto;padding:20px 16px 40px}
.hero{background:var(--tint);border:1px solid var(--line);border-radius:20px;padding:20px 16px;text-align:center}
.face{width:128px;height:128px;margin:0 auto 8px;border-radius:24px;overflow:hidden;background:var(--card)}
.face svg{display:block;width:100%;height:100%}
h1{font-size:1.7rem;margin:4px 0 0}
.handle{margin:0;color:var(--soft)}
.intro{margin:12px 0 0}
.facts{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.facts li{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:.95rem}
.wa{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:var(--ink);color:#fff;font-weight:700;text-decoration:none;min-height:44px}
.wa:focus-visible{outline-color:var(--focus)}
section{margin-top:28px}
h2{font-size:1.25rem;margin:0 0 10px}
.rows{list-style:none;margin:0;padding:0}
.rows li{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:8px}
.rows b{display:block}
.rows span{color:var(--soft);font-size:.95rem}
.note{color:var(--soft);font-size:.95rem;margin:10px 0 0}
.qr{display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}
.qr svg{width:148px;height:148px;flex:none}
.qr p{margin:0;flex:1 1 12rem;overflow-wrap:anywhere}
footer{margin-top:32px;color:var(--soft);font-size:.9rem}
`;

/** The head every page of the door's Streetlist look shares. `description` is plain text. */
function shell(title: string, description: string, body: string, robots = "index,follow"): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">`
    + `<meta name="theme-color" content="#136650"><meta name="robots" content="${robots}"><meta name="description" content="${esc(description)}"><title>${esc(title)}</title><style>${CSS}</style></head>`
    + `<body><header class="top"><div><a class="brand" href="/">Streetlist</a></div></header><main>${body}</main></body></html>`;
}

/** The friendly page for a handle with no published card (unknown, unpublished, junk, or fleet saying "unknown"). */
export function noCardPage(): string {
  return shell("There is no partner page here", "Check the address, or ask the partner for their link.",
    `<div class="hero"><h1>There is no partner page here</h1><p class="intro">Check the address, or ask the partner for their link.</p><p><a href="/">Back to Streetlist</a></p></div>`, "noindex");
}

/** "2 months" style helpers are avoided on purpose: the page states amounts exactly as the partner set them. */
function serviceRow(s: PartnerCard["services"][number]): string {
  const monthly = s.monthly === 0 ? "No monthly charge" : `${rupees(s.monthly)} a month`;
  const setup = s.setup === 0 ? "no set-up charge" : `${rupees(s.setup)} to set up`;
  return `<li><b>${esc(s.name)}</b><span>${monthly}, ${setup}</span></li>`;
}

/** The whole card as an HTML page. `primary` is the pages domain; the QR code carries this card's own address on it. */
export function cardPage(card: PartnerCard, primary: string): string {
  const address = `https://${primary}/@${card.handle}`;
  const languages = card.languages.map((l) => LANGUAGE_NAMES[l]).filter((l): l is string => l !== undefined);
  const facts = [card.area ? `<li>${esc(card.area)}</li>` : "", languages.length > 0 ? `<li>${esc(languages.join(", "))}</li>` : ""].join("");
  const wa = card.whatsapp && /^\d{8,15}$/u.test(card.whatsapp)
    ? `<a class="wa" href="https://wa.me/${card.whatsapp}?text=${encodeURIComponent("Hello, I found your page on Streetlist.")}">Message on WhatsApp</a>` : "";
  const services = card.services.length > 0
    ? `<section><h2>What I set up and look after</h2><ul class="rows">${card.services.map(serviceRow).join("")}</ul><p class="note">${esc(WHATSAPP_LINE)}</p></section>` : "";
  const named = card.shops.length > 0 ? `<ul class="rows">${card.shops.map((s) => `<li><a href="/${esc(encodeURIComponent(s.slug))}/">${esc(s.name)}</a></li>`).join("")}</ul>` : "";
  const count = card.shop_count > 0
    ? `<section><h2>Local services I look after</h2><p>${card.shop_count === 1 ? "1 local service" : `${card.shop_count} local services`} in all.${card.shops.length > 0 ? " These have said they are happy to be named here:" : " Each is named here only when it says yes."}</p>${named}</section>` : "";
  const body = `<div class="hero"><div class="face" role="img" aria-label="${esc(card.name)}'s character">${card.face.svg}</div><h1>${esc(card.name)}</h1><p class="handle">@${esc(card.handle)}</p>`
    + `${card.intro ? `<p class="intro">${esc(card.intro)}</p>` : ""}${facts ? `<ul class="facts">${facts}</ul>` : ""}${wa}</div>`
    + `${services}${count}`
    + `<section><h2>This page</h2><div class="qr">${textQrSvg(address, { label: `QR code for ${address}`, border: 2 })}<p>Scan to open this page, or share the address:<br><b>${esc(`${primary}/@${card.handle}`)}</b></p></div>`
    + `<p class="note">See how Geometer checks the work these assistants do: <a href="https://geometer.dev/verify">geometer.dev/verify</a></p></section>`
    + `<footer>Streetlist pages are run on Geometer. Questions: <a href="mailto:hello@geometer.dev">hello@geometer.dev</a></footer>`;
  return shell(`${card.name} (@${card.handle}) on Streetlist`, card.intro || `${card.name}, a local partner on Streetlist who looks after local services with their owners.`, body);
}
