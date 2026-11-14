// The customer view's head on the shop's page (plan item 11f, decision 44): the shop's character, its hours this week, "message us on WhatsApp", and the partner's
// small line. Rendered by page.ts on the booking page (in the visitor's language, from what the runtime's offer says and the shop's pages file), plain HTML and an
// inline picture: no script, nothing fetched, so the page's content policy stays "no script".
//
// The character (item 11i): the picture of the mood the public sees now (all well, busy or closed; character.ts publicFace), drawn by DiceBear on the shop's own
// server and saved with the shop (bundle/character/render.ts). The front adds it to the offer as a data: address (front.ts withFace), because the pages load images
// only from data. Its alt text and the line beside it say the mood in words. A shop whose pictures are not drawn yet shows its name and hours without a face: the
// earlier placeholder (a coloured circle with a letter) is gone, by the owner's rule of DiceBear's own drawings only.
//
// The design pass (item 11i, 14 Nov 2026) placed it: the face is the head's one bold element on every customer page (shopHead, drawn by page.ts layout), at
// 84 px on its own DiceBear tile with one soft shadow (look.ts); the hours and WhatsApp stay on the front pages (shopFace). The face stays still: DiceBear's
// motion would need a second, moving set of pictures per shop and twice the bytes on every page (Deferred.md).
import { html } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { WEEKDAY_NAMES } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { ShopInfo } from "./backend.ts";
import { partnerLine } from "./owner-session.ts";
import { ASSISTANT_OF, FACE_WORDS, pictureWords } from "../assistant/character.ts";
import type { PagesFile } from "./pages-file.ts";

const WORDS: Record<Language, { whatsapp: string; hours: string; closed: string }> = {
  en: { whatsapp: "Message us on WhatsApp", hours: "Opening hours", closed: "closed" },
  hi: { whatsapp: "WhatsApp पर हमें मैसेज करें", hours: "खुलने का समय", closed: "बंद" },
  ml: { whatsapp: "WhatsApp-ൽ ഞങ്ങൾക്ക് സന്ദേശം അയയ്ക്കൂ", hours: "പ്രവർത്തന സമയം", closed: "അടച്ചിരിക്കും" },
  kn: { whatsapp: "WhatsApp ನಲ್ಲಿ ನಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ", hours: "ತೆರೆಯುವ ಸಮಯ", closed: "ಮುಚ್ಚಿರುತ್ತದೆ" },
};

const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The character's picture with the shop and the mood in words as its alt text ("Glow Salon's assistant, all well"), or nothing when the shop has no picture yet. */
export function characterPicture(shop: Pick<ShopInfo, "name" | "character">, language: Language): Raw | "" {
  const c = shop.character;
  if (!c?.picture || !c.face) return "";
  return html`<img class="face-c" src="${c.picture}" width="84" height="84" alt="${pictureWords(language, shop.name, c.face, c.name)}">`;
}

/** The week's hours as short lines ("Mon 10:00–20:00", "Sun closed"), Monday first as people read a shop's board. */
export function hoursLines(hours: NonNullable<ShopInfo["hours"]>, language: Language): string[] {
  const w = WORDS[language];
  return [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const h = hours[WEEK[d]];
    return `${WEEKDAY_NAMES[language][d]} ${h ? `${h.open}–${h.close}` : w.closed}`;
  });
}

/** wa.me with the shop's own number: WhatsApp's own link, opening a chat with the shop (nothing of ours in between). */
export const waLink = (number: string): string => `https://wa.me/${number.replace(/\D/gu, "")}`;

/**
 * The head of every customer page (item 11i's design pass: layout() draws it on the front pages and on a booking's, order's or payment's own page alike): the
 * character's tile in its public mood, the shop's name and address, and who the character is with the mood in words, as a chip in the mood's colour (a face never
 * carries the mood alone). A shop whose pictures are not drawn yet shows its name without a face. `picture: false` leaves the face out and keeps the words: for a
 * page that reloads itself every few seconds while it waits, which would fetch the picture again each time (a Pixel Bot face is about 24 KB inline).
 */
export function shopHead(o: { shop: Pick<ShopInfo, "name" | "address" | "character">; language: Language; picture?: boolean }): Raw {
  const c = o.shop.character;
  const mood = c?.face && c.picture ? c.face : undefined;
  return html`<div class="head-in">${o.picture === false ? "" : characterPicture(o.shop, o.language)}<div><h1>${o.shop.name}</h1>${o.shop.address ? html`<p class="where">${o.shop.address}</p>` : ""}
${c ? html`<p class="mood${mood ? ` m-${mood}` : ""}">${ASSISTANT_OF[o.language](o.shop.name, c.name)}${mood ? ` · ${FACE_WORDS[o.language][mood]}` : ""}</p>` : ""}</div></div>`;
}

/** The front page's extras under the head: "message us on WhatsApp" when the shop's number is known, and the week's hours, folded. */
export function shopFace(o: { shop: Pick<ShopInfo, "hours">; language: Language; pages?: PagesFile }): Raw {
  const w = WORDS[o.language];
  if (!o.pages?.whatsapp && !o.shop.hours) return html``;
  return html`<section class="face-x">${o.pages?.whatsapp ? html`<a class="btn wa full" href="${waLink(o.pages.whatsapp)}" rel="noopener">${w.whatsapp}</a>` : ""}
${o.shop.hours ? html`<details class="hours"><summary>${w.hours}</summary><ul>${hoursLines(o.shop.hours, o.language).map((l) => html`<li>${l}</li>`)}</ul></details>` : ""}</section>`;
}

/** The partner's line, for the bottom of the customer view (owner-session.ts writes it). */
export const facePartnerLine = (language: Language, pages?: PagesFile): Raw => partnerLine(language, pages?.panelUrl);
