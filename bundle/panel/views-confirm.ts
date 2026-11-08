// The pages behind a one-time confirmation link (confirmations.ts). Plain forms, no JavaScript. English only for now: the person who opens one is the builder who
// was working in Claude Code (Deferred.md in plugin/). Every value goes through html``, which escapes it.
import type { ChangeRow } from "../lib/limits-draft.ts";
import { html } from "./html.ts";
import type { CheckResult } from "./checks.ts";
import type { Unmet } from "./golive.ts";
import { layout } from "./views.ts";
import type { Ctx } from "./views.ts";

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
const show = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v));

export function confirmGonePage(c: Ctx, why: "used" | "expired" | "unknown"): string {
  const text = { used: "This link has already been used.", expired: "This link has run out.", unknown: "This link is not one we made." }[why];
  return layout(c, "Confirm", html`<h1>${text}</h1><p>Ask Claude Code for a new one. A link works once and runs out after two hours.</p>`);
}

export function confirmLimitsPage(c: Ctx, o: { token: string; shopName: string; shopId: string; rows: ChangeRow[]; note: string; problems: string[]; done: boolean }): string {
  return layout(c, "Confirm a limit change", html`<h1>${o.done ? "Done" : "Confirm a limit change"}</h1>
<p class="note">For ${o.shopName} (${o.shopId}). Claude Code drafted this. Nothing changes until you press the button.</p>
${o.note ? html`<p>${o.note}</p>` : ""}
${o.problems.length > 0 ? html`<ul class="errors" role="alert">${o.problems.map((p) => html`<li>${p}</li>`)}</ul>` : ""}
${o.rows.length > 0 ? html`<table><thead><tr><th>Limit</th><th>Now</th><th>After</th><th></th></tr></thead><tbody>${o.rows.map((r) => html`<tr><td>${r.label}</td><td>${show(r.from)}</td><td>${show(r.to)}</td><td>${r.verdict === "tighter" ? "tighter" : "refused"}</td></tr>`)}</tbody></table>` : ""}
${o.done ? html`<div class="notice"><p class="big">The new limits are saved.</p><p class="note">The server's deployer applies them to the shop's Guards and checks them again. Look at the shop's page, or run <code>geometer status</code>, to see that it has.</p></div>`
  : o.problems.length === 0 ? html`<p>Every limit above is tighter than before. To make a limit looser, use the shop's edit page instead: a link like this one never does.</p>
<form method="post" action="/confirm/${o.token}">${csrf(c)}<button class="btn primary" type="submit">Save these tighter limits</button></form>` : ""}
<p><a class="btn" href="/shops/${o.shopId}">Back to the shop</a></p>`);
}

const unmetText: Record<Unmet, string> = {
  "hand-check": "The hand check has not been run, or something in it did not hold.", deploy: "The deployer has not applied the shop's latest settings yet.",
  limits: "Not every limit is shown to hold on the running Guards yet.", connections: "The connection checks (WhatsApp, Razorpay, calendar, through the Guards) have not all passed.", "settings-changed": "The settings changed after the hand check ran.",
};

export function confirmGoLivePage(c: Ctx, o: {
  token: string; shopName: string; shopId: string; unmet: Unmet[]; hand?: { held: number; total: number; failedTitles: string[]; notTested: number };
  connections: CheckResult[] | null; templates: string[]; problems: string[]; done: boolean; certificate?: string;
}): string {
  return layout(c, "Confirm go-live", html`<h1>${o.done ? "Ready to go live" : "Confirm go-live"}</h1>
<p class="note">For ${o.shopName} (${o.shopId}). Claude Code asked for this. Only you can say yes, here.</p>
${o.problems.length > 0 ? html`<ul class="errors" role="alert">${o.problems.map((p) => html`<li>${p}</li>`)}</ul>` : ""}
${o.hand ? html`<p>Hand check: held ${o.hand.held} of ${o.hand.total}.${o.hand.failedTitles.length > 0 ? html` Did not hold: ${o.hand.failedTitles.join("; ")}.` : ""} ${o.hand.notTested} things are listed as not tested on the certificate.</p>` : html`<p>The checks run when you press the button.</p>`}
${o.connections ? html`<ul>${o.connections.map((r) => html`<li>${r.service}: ${r.ok ? "passed" : `did not pass (${r.code})`}</li>`)}</ul>` : ""}
${o.unmet.length > 0 ? html`<p>Still in the way:</p><ul>${o.unmet.map((u) => html`<li>${unmetText[u]}</li>`)}</ul>` : ""}
${o.done ? html`<div class="notice"><p class="big">The go-live certificate is made.</p>${o.certificate ? html`<a class="btn primary" href="${o.certificate}">Open the certificate</a>` : ""}</div>`
  : html`<div class="notice"><p class="big">WhatsApp templates: not checked by Geometer.</p><p class="note">Geometer cannot ask Meta whether these are approved. Open your WhatsApp Business account and look. Your answer below is written down as what you said, not as something we checked.</p>
<ul>${o.templates.map((t) => html`<li>${t}</li>`)}</ul></div>
<form method="post" action="/confirm/${o.token}">${csrf(c)}
  <label class="field"><span><input type="checkbox" name="templates_seen" value="yes"> I have seen Meta approve every WhatsApp template listed above.</span></label>
  <label class="field"><span><input type="checkbox" name="keys_in_guard" value="yes"> I handed in every key through the panel or the secrets inbox, and none is in a file Claude Code can read.</span></label>
  <button class="btn primary" type="submit">Run the checks and make the go-live certificate</button>
</form>`}
<p><a class="btn" href="/shops/${o.shopId}">Back to the shop</a></p>`);
}
