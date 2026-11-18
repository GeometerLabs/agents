// The first set-up screens (17 Nov 2026, presets.ts): "What does the shop do?" as big buttons in the Operator's language, one for each trade, plus Something else; and the page behind
// that button, where the Operator writes the trade in their own words and then picks the kind of work from the template list in plain words. Plain forms, no script. This replaces
// the old first screen, which listed the templates by name: an Operator thinks in trades, not in our templates, and the template list now lives under "Something else".
import type { Language } from "../../modules/language/languages.ts";
import { html } from "./html.ts";
import type { Raw } from "./html.ts";
import { MAX_TRADE } from "./presets.ts";
import type { Preset } from "./presets.ts";
import { setupOf } from "./setups.ts";
import type { Template } from "./templates.ts";
import { csrf, layout } from "./views.ts";
import type { Ctx } from "./views.ts";
import { presetWords } from "./words-presets.ts";

const languageOf = (c: Ctx): Language => (c.lang in { en: 1, hi: 1, ml: 1, kn: 1 } ? (c.lang as Language) : "en");

/** The first screen: one big button for each trade whose template this server can set up (a preset whose template is missing is not offered), then "Something else". */
export function setupStartPage(c: Ctx, presets: readonly Preset[]): string {
  const w = c.w.setup;
  const pw = presetWords(c.w);
  const language = languageOf(c);
  return layout(c, w.title, html`<h1>${w.title}</h1>
<p class="big">${pw.question}</p>
<div class="cards">${presets.map((p) => html`<form method="post" action="/setup">${csrf(c)}<input type="hidden" name="preset" value="${p.id}">
  <button class="btn primary wide" type="submit">${p.names[language]}</button></form>`)}
  <a class="btn wide" href="/setup/other">${pw.other}</a></div>`);
}

/**
 * "Something else": the trade in the Operator's own words, then the kind of work. One form: the kind of work is the button that sends it. A form sent by pressing Enter in the box
 * (which would press the first button) sends an empty kind instead and is asked again, so no kind of work is ever chosen for someone.
 */
export function setupOtherPage(c: Ctx, templates: readonly Template[], v: { trade: string; problems: string[] }): string {
  const w = c.w.setup;
  const pw = presetWords(c.w);
  const errors: Raw = v.problems.length === 0 ? html`` : html`<div class="errors" role="alert"><b>${w.problemsTitle}</b><ul>${v.problems.map((p) => html`<li>${p}</li>`)}</ul></div>`;
  return layout(c, w.title, html`<h1>${w.title}</h1>
${errors}
<form method="post" action="/setup">${csrf(c)}<button type="submit" name="template" value="" hidden></button>
  <label class="field"><span>${pw.typedLabel}</span><input name="trade" value="${v.trade}" maxlength="${MAX_TRADE}" autocomplete="off"><p class="help">${pw.typedHelp}</p></label>
  <p class="big">${pw.kindQuestion}</p>
  <div class="cards">${templates.map((t) => t.setup === "bookings" || setupOf(t.setup)
    ? html`<button class="btn primary wide" type="submit" name="template" value="${t.id}">${w.templateNames[t.id] ?? t.id} · ${w.start}</button>`
    : html`<div class="shopcard"><div class="name">${w.templateNames[t.id] ?? t.id}</div><div class="meta">${w.templateElsewhere}</div></div>`)}</div>
</form>`);
}
