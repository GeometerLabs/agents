// The Character step's page and the shop page's character block (plan item 11i, decision 47). Apart from views.ts so that file stays the shared shell; the
// logic is character.ts and the drawings are bundle/character/render.ts, served to these pages as images by the panel (server.ts, /character/preview/... and
// /shops/<id>/character/...), so the page itself stays small on a phone and every picture is cached.
//
// No script, as everywhere in the panel: each choice is a button in one form (its name says what it picks), so a tap posts the form and the step comes back with
// the choice made and everything typed kept. Keyboard and screen reader: every picture-button has a label in words ("Face 3 of 8", "Colour 2", a style's name),
// the picked one says so with aria-pressed and a visible "Picked" mark (never colour alone), and each mood picture carries the shop and its mood in words ("Glow
// Salon's assistant, all well"), with the mood shown under it too.
// Enter in the name box means "Next": the form's first button, before the pickers, is a hidden Next for exactly that.
import { ASSISTANT_OF, FACES, FACE_WORDS, CHARACTER_STYLES, STYLE_INFO, pictureWords } from "../../modules/assistant/character.ts";
import type { Face } from "../../modules/assistant/character.ts";
import { PERSONALITIES, greeting } from "../../modules/assistant/personality.ts";
import { STRIP, stripSeeds } from "./character.ts";
import type { CharacterDraft } from "./character.ts";
import { html } from "./html.ts";
import type { Raw } from "./html.ts";
import type { Helpers } from "./views-fees.ts";
import type { Ctx } from "./views.ts";

/** The panel's address of one preview picture: a style's look in a mood ("face" for the rolled face with no mood). */
export const previewSrc = (style: string, colour: string | undefined, seed: string, mood: Face | "face"): string => `/character/preview/${style}/${colour ?? "auto"}/${seed}/${mood}.svg`;

/** The step's form: styles, the row of faces, colours, Roll, the five moods of the picked face, the name and the personality. */
export function characterStepBody(c: Ctx, d: { id: string; shopId?: string; character: CharacterDraft; form: { name: string } }, action: string, back: Raw | string, next: Raw, h: Helpers): Raw {
  const w = c.w.setup.character;
  const ch = d.character;
  const shopId = d.shopId ?? "shop";
  const info = STYLE_INFO[ch.style];
  const seeds = stripSeeds(shopId, ch.roll);
  // the picked face stays in the row even after a roll, so a saved shop's face is never lost from view
  const row = ch.seed && !seeds.includes(ch.seed) ? [ch.seed, ...seeds.slice(0, STRIP - 1)] : seeds;
  const picked = (on: boolean) => (on ? html` <span class="picked">${w.chosenMark}</span>` : "");
  // what the pictures and the greeting say: the shop's name, and the character's only when one was typed (owner, 14 Nov: no names by default)
  const shopName = d.form.name || "Glow Salon";
  const typed = ch.name.trim() || undefined;
  return html`<p>${w.intro}</p><form method="post" action="${action}" class="character">${h.csrf}
  <button class="sr-only" type="submit" name="act" value="next" tabindex="-1" aria-hidden="true">${c.w.common.next}</button>
  <fieldset class="field"><legend>${w.styleLegend}</legend><div class="styles">
  ${CHARACTER_STYLES.map((s) => html`<button class="pick style" type="submit" name="pickStyle" value="${s}" aria-pressed="${s === ch.style ? "true" : "false"}"><img src="${previewSrc(s, s === ch.style ? ch.colour : undefined, ch.seed ?? seeds[0], "well")}" width="56" height="56" alt=""><span>${STYLE_INFO[s].name}${picked(s === ch.style)}</span></button>`)}
  </div></fieldset>
  <fieldset class="field" id="faces"><legend>${w.stripLegend}</legend><p class="help">${w.stripHelp}</p><div class="strip">
  ${row.map((seed, i) => html`<button class="pick face" type="submit" name="pickFace" value="${seed}" aria-pressed="${seed === ch.seed ? "true" : "false"}" aria-label="${w.faceLabel(i + 1, row.length)}"><img src="${previewSrc(ch.style, ch.colour, seed, "face")}" width="80" height="80" alt="">${picked(seed === ch.seed)}</button>`)}
  </div><button class="btn mt" type="submit" name="act" value="roll">${w.roll}</button></fieldset>
  <fieldset class="field"><legend>${w.colourLegend}</legend><div class="swatches">
  <button class="pick swatch" type="submit" name="pickColour" value="auto" aria-pressed="${ch.colour === undefined ? "true" : "false"}" aria-label="${w.autoLabel}"><span class="auto">${w.auto}</span>${picked(ch.colour === undefined)}</button>
  ${info.palette.map((hex, i) => html`<button class="pick swatch" type="submit" name="pickColour" value="${hex}" aria-pressed="${hex === ch.colour ? "true" : "false"}" aria-label="${w.colourLabel(i + 1)}"><svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" fill="#${hex}" stroke="#00000033"/></svg>${picked(hex === ch.colour)}</button>`)}
  </div></fieldset>
  <h2>${w.moodsTitle}</h2><p class="help">${w.moodsHelp}</p>
  <ul class="moods">${FACES.map((f) => html`<li><img src="${previewSrc(ch.style, ch.colour, ch.seed ?? seeds[0], f)}" width="96" height="96" alt="${pictureWords(c.lang, shopName, f, typed)}"><span>${FACE_WORDS[c.lang][f]}</span></li>`)}</ul>
  ${h.text(w.name, "characterName", ch.name, { max: 24, help: w.nameHelp })}
  <fieldset class="field"><legend>${w.personalityLegend}</legend><p class="help">${w.personalityHelp}</p>
  ${PERSONALITIES.map((p) => html`<label class="choice"><input type="radio" name="personality" value="${p}" ${p === ch.personality ? html`checked` : ""}><span>${w.personalities[p]}<small>${w.saysLabel} ${greeting(p, c.lang, shopName, typed)}</small></span></label>`)}
  </fieldset>
  ${back}${next}</form>`;
}

/**
 * What the shop page shows about the character: its saved moods as a row, and the "All well" PNG to put on the shop's WhatsApp profile by hand. `has`: the shop's
 * settings turn the assistant on; `name` only when the partner gave the character one; `version` once its pictures are drawn.
 */
export interface CharacterBlockView { has: boolean; shop: string; name?: string; version?: string }

export function characterBlock(c: Ctx, id: string, v: CharacterBlockView): Raw {
  const w = c.w.setup.character;
  if (!v.has) return html`<h2>${w.shopTitle}</h2><p class="note">${w.shopNone}</p>`;
  const who = html`<p><b>${ASSISTANT_OF[c.lang](v.shop, v.name)}</b></p>`;
  if (!v.version) return html`<h2>${w.shopTitle}</h2>${who}<p class="note">${w.shopNotDrawn}</p>`;
  return html`<h2>${w.shopTitle}</h2>${who}
<ul class="moods">${FACES.map((f) => html`<li><img src="/shops/${id}/character/${f}.svg?v=${v.version}" width="72" height="72" alt="${pictureWords(c.lang, v.shop, f, v.name)}"><span>${FACE_WORDS[c.lang][f]}</span></li>`)}</ul>
<h3>${w.profileTitle}</h3><p class="help">${w.profileHelp}</p>
<p><a class="btn" href="/shops/${id}/character/well.png?v=${v.version}&amp;download=1" download="${id}-whatsapp-photo.png">${w.download}</a></p>`;
}
