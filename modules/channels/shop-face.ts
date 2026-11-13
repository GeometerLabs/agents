// The customer view's head on the shop's page (plan item 11f, decision 44): the shop's character, its hours this week, "message us on WhatsApp", and the partner's
// small line. Rendered by page.ts on the booking page (in the visitor's language, from what the runtime's offer says and the shop's pages file), plain HTML and an
// inline picture: no script, nothing fetched, so the page's content policy stays "no script".
//
// The character (item 11i): the picture of the mood the public sees now (all well, busy or closed; character.ts publicFace), drawn by DiceBear on the shop's own
// server and saved with the shop (bundle/character/render.ts). The front adds it to the offer as a data: address (front.ts withFace), because the pages load images
// only from data. Its alt text and the line beside it say the mood in words. A shop whose pictures are not drawn yet shows its name and hours without a face: the
// earlier placeholder (a coloured circle with a letter) is gone, by the owner's rule of DiceBear's own drawings only. Placing it in the page's design is the later
// design pass's; this is the minimal placement in the head.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { WEEKDAY_NAMES } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { ShopInfo } from "./backend.ts";
import { partnerLine } from "./owner-session.ts";
import { FACE_WORDS } from "../assistant/character.ts";
import type { PagesFile } from "./pages-file.ts";

const WORDS: Record<Language, { whatsapp: string; hours: string; closed: string; assistant: (name: string) => string }> = {
  en: { whatsapp: "Message us on WhatsApp", hours: "Opening hours", closed: "closed", assistant: (name) => `${name}, the shop's assistant` },
  hi: { whatsapp: "WhatsApp पर हमें मैसेज करें", hours: "खुलने का समय", closed: "बंद", assistant: (name) => `${name}, दुकान का असिस्टेंट` },
  ml: { whatsapp: "WhatsApp-ൽ ഞങ്ങൾക്ക് സന്ദേശം അയയ്ക്കൂ", hours: "പ്രവർത്തന സമയം", closed: "അടച്ചിരിക്കും", assistant: (name) => `${name}, കടയുടെ അസിസ്റ്റന്റ്` },
  kn: { whatsapp: "WhatsApp ನಲ್ಲಿ ನಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ", hours: "ತೆರೆಯುವ ಸಮಯ", closed: "ಮುಚ್ಚಿರುತ್ತದೆ", assistant: (name) => `${name}, ಅಂಗಡಿಯ ಸಹಾಯಕ` },
};

const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The character's picture with its mood in words (alt text), or nothing when the shop has no picture yet. */
export function characterPicture(shop: Pick<ShopInfo, "name" | "character">, language: Language): Raw | "" {
  const c = shop.character;
  if (!c?.picture || !c.face) return "";
  return html`<img class="face-c" src="${c.picture}" width="72" height="72" alt="${`${WORDS[language].assistant(c.name)}: ${FACE_WORDS[language][c.face]}`}">`;
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

/** The head of the customer view: the character in its public mood (with the mood in words), the hours, and the WhatsApp link when the shop's number is known. */
export function shopFace(o: { shop: Pick<ShopInfo, "name" | "hours" | "character">; language: Language; pages?: PagesFile }): Raw {
  const w = WORDS[o.language];
  const c = o.shop.character;
  return html`<section class="face" aria-label="${o.shop.name}">${characterPicture(o.shop, o.language)}<div>
${c ? html`<p class="note">${w.assistant(c.name)}${c.face && c.picture ? ` · ${FACE_WORDS[o.language][c.face]}` : ""}</p>` : ""}
${o.shop.hours ? html`<details><summary>${w.hours}</summary><ul class="list">${hoursLines(o.shop.hours, o.language).map((l) => html`<li>${l}</li>`)}</ul></details>` : ""}
${o.pages?.whatsapp ? html`<p><a class="btn" href="${waLink(o.pages.whatsapp)}" rel="noopener">${w.whatsapp}</a></p>` : ""}
</div></section>`;
}

/** The face's few rules, added to the page's own style sheet. */
export const FACE_CSS = raw(`.face{display:flex;gap:12px;align-items:flex-start;margin:0 0 12px}.face-c{flex:none;border-radius:14px}.face .btn{margin-top:6px}.face details{margin:4px 0}`);

/** The partner's line, for the bottom of the customer view (owner-session.ts writes it). */
export const facePartnerLine = (language: Language, pages?: PagesFile): Raw => partnerLine(language, pages?.panelUrl);
