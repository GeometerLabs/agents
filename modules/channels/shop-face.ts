// The customer view's head on the shop's page (plan item 11f, decision 44): the shop's character, its hours this week, "message us on WhatsApp", and the partner's
// small line. Rendered by page.ts on the booking page (in the visitor's language, from what the runtime's offer says and the shop's pages file), plain HTML and an
// inline SVG: no script, nothing fetched, so the page's content policy stays "no script".
//
// The character: decision 43 gives each shop one character (the assistant's, item 11e: a name and a look from fixed options). Its drawings are a separate design
// exploration, so this draws a PLACEHOLDER: a round shape in the look's colour with the shop's first letter. When item 11e's settings reach the offer (`character`),
// its colour and name are used; until then the colour comes from the shop's name, so each shop keeps one.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { WEEKDAY_NAMES } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { ShopInfo } from "./backend.ts";
import { partnerLine } from "./owner-session.ts";
import type { PagesFile } from "./pages-file.ts";

/** The placeholder's colours: item 11e's look colours (modules/assistant/app/pwa.ts LOOK_COLOURS, by the same names), so the placeholder matches the app's bar. */
const COLOURS: Record<string, string> = { teal: "#0f766e", pink: "#be185d", saffron: "#c2410c", indigo: "#4338ca", leaf: "#15803d", clay: "#9a3412" };

const WORDS: Record<Language, { whatsapp: string; hours: string; closed: string; assistant: (name: string) => string }> = {
  en: { whatsapp: "Message us on WhatsApp", hours: "Opening hours", closed: "closed", assistant: (name) => `${name}, the shop's assistant` },
  hi: { whatsapp: "WhatsApp पर हमें मैसेज करें", hours: "खुलने का समय", closed: "बंद", assistant: (name) => `${name}, दुकान का असिस्टेंट` },
  ml: { whatsapp: "WhatsApp-ൽ ഞങ്ങൾക്ക് സന്ദേശം അയയ്ക്കൂ", hours: "പ്രവർത്തന സമയം", closed: "അടച്ചിരിക്കും", assistant: (name) => `${name}, കടയുടെ അസിസ്റ്റന്റ്` },
  kn: { whatsapp: "WhatsApp ನಲ್ಲಿ ನಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ", hours: "ತೆರೆಯುವ ಸಮಯ", closed: "ಮುಚ್ಚಿರುತ್ತದೆ", assistant: (name) => `${name}, ಅಂಗಡಿಯ ಸಹಾಯಕ` },
};

const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** One colour per shop: the character's when the settings name one, else picked from the shop's name, so the placeholder does not change between visits. */
export function placeholderColour(shop: Pick<ShopInfo, "name" | "character">): string {
  const named = shop.character?.look?.colour;
  if (named && COLOURS[named]) return COLOURS[named];
  const list = Object.values(COLOURS);
  let h = 0;
  for (const c of shop.name) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return list[h % list.length];
}

/** The placeholder drawing: a round body in the shop's colour, two eyes and the shop's first letter. Inline SVG, so nothing is loaded. */
export function characterSvg(shop: Pick<ShopInfo, "name" | "character">): Raw {
  const letter = [...shop.name.trim()][0]?.toUpperCase() ?? "S";
  const colour = placeholderColour(shop);
  return html`<svg class="face-c" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${shop.character?.name ?? shop.name}"><circle cx="32" cy="34" r="26" fill="${colour}"/><circle cx="24" cy="28" r="3.5" fill="#fff"/><circle cx="40" cy="28" r="3.5" fill="#fff"/><text x="32" y="50" font-size="16" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif">${letter}</text></svg>`;
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

/** The head of the customer view: the character (placeholder), the hours, and the WhatsApp link when the shop's number is known. */
export function shopFace(o: { shop: Pick<ShopInfo, "name" | "hours" | "character">; language: Language; pages?: PagesFile }): Raw {
  const w = WORDS[o.language];
  const c = o.shop.character;
  return html`<section class="face" aria-label="${o.shop.name}">${characterSvg(o.shop)}<div>
${c ? html`<p class="note">${w.assistant(c.name)}</p>` : ""}
${o.shop.hours ? html`<details><summary>${w.hours}</summary><ul class="list">${hoursLines(o.shop.hours, o.language).map((l) => html`<li>${l}</li>`)}</ul></details>` : ""}
${o.pages?.whatsapp ? html`<p><a class="btn" href="${waLink(o.pages.whatsapp)}" rel="noopener">${w.whatsapp}</a></p>` : ""}
</div></section>`;
}

/** The face's few rules, added to the page's own style sheet. */
export const FACE_CSS = raw(`.face{display:flex;gap:12px;align-items:flex-start;margin:0 0 12px}.face-c{flex:none}.face .btn{margin-top:6px}.face details{margin:4px 0}`);

/** The partner's line, for the bottom of the customer view (owner-session.ts writes it). */
export const facePartnerLine = (language: Language, pages?: PagesFile): Raw => partnerLine(language, pages?.panelUrl);
