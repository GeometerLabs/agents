// Who to call, on every page (release-flow batches 3 and 5, 14 Nov 2026). Two small pieces, drawn by the pages' own layouts:
//   partnerBar   the Operator's name with "Call" and "WhatsApp" links: at the top of the owner's app and on every error page, so an owner whose page says "ask your Operator"
//                always has the person's number in reach (audit O25). From pages.json's `partner` (the panel's page form writes it).
//   shopContact  the shop's own phone ("Call the shop", "Call the centre" for a tuition centre) and map link: on every customer page (audit C5), so a shop with no WhatsApp can still be reached. The front adds
//                them to each offer's `shop` (front.ts withContact), the way it adds the face, so no page needs pages.json passed in.
// Plain links (tel: and wa.me), no script. The phone numbers were checked when the panel took them and again when the file was read (pages-file.ts).
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import type { Language } from "../language/languages.ts";
import type { PagesFile } from "./pages-file.ts";
import { FIRST_WORDS } from "./words-owner-first.ts";
import { SIGNIN_CSS } from "./look.ts";
import { PAGE } from "./words.ts";
import { CHAT_MORE } from "./words-chat-more.ts";
import { forKind } from "./words-chat.ts";
import type { ChatKind } from "./words-chat.ts";

/**
 * The header the shop's front sets on its pages for the front door (bundle/services/door.ts): the Operator's contact as base64url JSON {n: name, p: "+91...", l?: languages}.
 * The door keeps the last one per shop for its own error pages and removes it before the visitor sees the response.
 */
export const CONTACT_HEADER = "x-geometer-contact";

const digits = (n: string): string => n.replace(/\D/gu, "");
export const telLink = (n: string): string => `tel:+${digits(n)}`;
const waLinkOf = (n: string): string => `https://wa.me/${digits(n)}`;

/** The Operator's name with Call and WhatsApp. Nothing when the shop's file has no Operator yet. */
export function partnerBar(language: Language, pages: Pick<PagesFile, "partner"> | undefined): Raw {
  const p = pages?.partner;
  if (!p) return html``;
  const w = FIRST_WORDS[language];
  return html`<div class="who" role="group" aria-label="${w.partnerNoName}"><b>${w.partner(p.name)}</b><a class="btn quiet" href="${telLink(p.phone)}">${w.call}</a><a class="btn wa" href="${waLinkOf(p.phone)}" rel="noopener">${w.whatsapp}</a></div>`;
}

/** What the front adds to an offer's shop: the shop's phone and map link (either may be missing). */
export interface ShopContact {
  phone?: string; map?: string; chat?: string;
  /** The kind of shop (19 Nov 2026), added by the front from the shop's template, so a tuition centre's page says "Call the centre" (words-chat.ts forKind). Left out (a caller that does not know it): "Call the shop". */
  kind?: ChatKind;
}

/** The shop's call and map links, under the head of a customer page. Nothing when the shop has neither. */
export function shopContact(language: Language, c: ShopContact | undefined): Raw {
  if (!c || (!c.phone && !c.map && !c.chat)) return html``;
  // the same per-kind switch as the chat page uses; with no kind the words come back untouched, i.e. "shop" (the default)
  const w = forKind(c.kind ?? "bookings", language, FIRST_WORDS[language]);
  const more = forKind(c.kind ?? "bookings", language, CHAT_MORE[language]);
  // "Chat with us" first and marigold-free (the page's one inviting action stays its own); a plain link, so it works with no script
  return html`<div class="who">${c.chat ? html`<a class="btn" href="${c.chat}" aria-label="${more.linkAbout}">${more.link}</a>` : ""}${c.phone ? html`<a class="btn quiet" href="${telLink(c.phone)}">${w.shopCall}</a>` : ""}${c.map ? html`<a class="btn quiet" href="${c.map}" rel="noopener">${w.shopMap}</a>` : ""}</div>`;
}

/**
 * Batch 5, "send me this link": a plain WhatsApp share link (the customer picks their own chat) for a booking's private page, so the one way back to the booking is
 * kept in their own messages. A page runs no script, so it is a link, not a button that copies. Shown on a web booking only; a WhatsApp booking already has it in the chat.
 */
export function sendLinkBox(language: Language, shopName: string, pageUrl: string): Raw {
  const w = FIRST_WORDS[language];
  return html`<div class="card"><a class="btn wa full" href="https://wa.me/?text=${encodeURIComponent(`${shopName}: ${pageUrl}`)}" rel="noopener">${w.sendLink}</a><p class="note">${w.sendLinkNote}</p></div>`;
}

/**
 * A short error page of the shop's front (too many requests; the shop's runtime not answering): one sentence in the visitor's language, the machine-written line for
 * Hindi, Malayalam and Kannada, and the Operator's name with Call and WhatsApp when the shop's file names one. It used to be one English sentence with nobody to call.
 */
export function shopErrorPage(language: Language, text: string, partner?: PagesFile["partner"]): string {
  const machine = PAGE[language].machine;
  return `<!doctype html>${html`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${text}</title><style>${raw(SIGNIN_CSS)}</style></head><body><main class="wrap signin">${machine ? html`<p class="machine">${machine}</p>` : ""}<p class="notice" role="alert">${text}</p>${partnerBar(language, partner ? { partner } : undefined)}</main></body></html>`.markup}`;
}
