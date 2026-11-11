// The panel's own-agent pages (B51's rest, 12 Nov 2026): the section on the shops page that lists a builder's own agents, and one agent's page (its Guards and their
// credentials' dates, health, what is held for the owner, unfinished work, the last crash test, go-live, the licence line, and the three actions). Plain HTML, no script,
// laid out with the panel's own classes, so it reads at phone width like the rest. Words: words-agents.ts (machine-written outside English, marked by the layout's note).
import { providerById } from "../../modules/payments/providers/index.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import type { AgentView } from "./agents.ts";
import type { LicenceView } from "./licence.ts";
import { layout, licenceBlock, liveLine, sentenceOf, when } from "./views.ts";
import type { Ctx } from "./views.ts";
import { AGENT_WORDS } from "./words-agents.ts";
import type { AgentWords } from "./words-agents.ts";

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;

/** A Guard's kind as the builder knows it: the provider's own name (kept in Latin letters), the desk, or their own gateway. */
export function guardName(a: AgentWords, kind: string): string {
  if (kind === "whatsapp") return "WhatsApp";
  if (kind === "calendar") return "Google Calendar";
  if (kind === "own-api") return a.guards.ownGateway;
  const p = providerById(kind);
  return p?.ownerMarked ? a.guards.desk : p?.displayName ?? kind;
}

/** The shops page's own-agents section: one card each, as a shop's card is. Nothing when the builder has none. */
export function agentsSection(c: Ctx, views: AgentView[]): Raw {
  if (views.length === 0) return raw("");
  const a = AGENT_WORDS[c.lang];
  return html`<h2 class="mt">${a.heading}</h2>
<p class="note">${a.intro}</p>
<div class="cards">${views.map((v) => html`<a class="shopcard ${v.live.code}" href="/agents/${v.id}">
  <div class="name">${v.id}</div>
  <div>${liveLine(c, v.live)}</div>
  <div class="meta">${v.status?.limits ? c.w.shops.limits(v.status.limits.proven, v.status.limits.of) : c.w.shops.limitsUnknown}${v.held && v.held.calls > 0 ? html` · ${a.held.some(v.held.calls)}` : ""}</div>
  ${v.crash && !v.crash.running && !v.crash.error ? html`<div class="meta">${a.crash.heading}: ${a.crash.held(v.crash.held, v.crash.of)}</div>` : ""}</a>`)}</div>`;
}

/** One own agent's page. `price` is the builder licence from the price list in force (server.ts), already written as money. */
export function agentPage(c: Ctx, v: AgentView, o: { licence?: LicenceView; price?: string; notice?: string }): string {
  const a = AGENT_WORDS[c.lang];
  const at = (iso: string) => when(iso, c.lang);
  const crash = v.crash;
  const stopped = v.live.code === "stopped";
  return layout(c, a.title(v.id), html`<p><a href="/shops">${a.back}</a></p>
<h1>${a.title(v.id)}</h1>
${o.notice ? html`<div class="notice" role="status">${o.notice}</div>` : ""}
<p class="big">${liveLine(c, v.live)}</p>
${v.live.why.length > 0 ? html`<ul class="plain">${v.live.why.map((w) => html`<li class="warn"><span class="mark">!</span><span>${c.w.why[w]}</span></li>`)}</ul>` : ""}

<h2>${a.guards.heading}</h2>
<p class="note">${a.guards.intro}</p>
<p>${v.status?.limits ? a.guards.limits(v.status.limits.proven, v.status.limits.of) : a.guards.limitsUnknown}</p>
<ul class="plain">${v.guards.map((g) => html`<li class="info"><span class="mark">·</span><span><b>${guardName(a, g.kind)}</b><br><small class="note">${g.url}</small>${g.since ? html`<br><small>${a.guards.since(at(g.since))}</small>` : ""}${g.oldUntil ? html`<br><small>${a.guards.oldUntil(at(g.oldUntil))}</small>` : ""}</span></li>`)}</ul>
${v.sharedCredential ? html`<div class="notice warn" role="status">${a.guards.shared}</div>` : ""}
<p class="note">${a.guards.file(`secrets/agents/${v.id}/credentials.env`)}</p>

<h2>${a.held.heading}</h2>
<p>${!v.held ? a.held.unknown : v.held.calls === 0 ? a.held.none : a.held.some(v.held.calls)}</p>
${v.held ? html`<p class="note">${a.held.asOf(at(v.held.at))}</p>` : ""}

<h2>${a.unfinished.heading}</h2>
${!v.unfinished.asOf ? html`<p class="note">${a.unfinished.notShared}</p>` : v.unfinished.items.length === 0 ? html`<p>${a.unfinished.none}</p>` : html`<ul class="plain">${v.unfinished.items.map((it) => html`<li class="warn"><span class="mark">!</span><span>${sentenceOf(c, it)}</span></li>`)}</ul>`}
${v.unfinished.asOf ? html`<p class="note">${c.w.inbox.asOf(at(v.unfinished.asOf))}</p>` : ""}

<h2>${a.crash.heading}</h2>
${v.asked.crashTest ? html`<p>${a.crash.waiting}</p>` : ""}
${!crash ? (v.asked.crashTest ? "" : html`<p>${a.crash.never}</p>`) : crash.running ? html`<p>${a.crash.running}</p>` : crash.error ? html`<p class="warn">${a.crash.error(crash.error)}</p>` : html`<p class="big">${a.crash.held(crash.held, crash.of)}</p>
${crash.failed.length > 0 ? html`<p>${a.crash.failed}</p><ul class="plain">${crash.failed.map((t) => html`<li class="warn"><span class="mark">✗</span><span>${t}</span></li>`)}</ul>` : ""}
${crash.notRun.length > 0 ? html`<p>${a.crash.notRun}</p><ul class="plain">${crash.notRun.map((t) => html`<li class="info"><span class="mark">·</span><span>${t}</span></li>`)}</ul>` : ""}`}
${crash && !crash.running ? html`<p class="note">${a.crash.when(at(crash.at), crash.by ?? "")}${crash.version ? html` ${a.crash.version(crash.version)}` : ""}</p>` : ""}

<h2>${a.goLive.heading}</h2>
<p>${v.inService ? html`${a.goLive.inService(v.inService.version ?? "", at(v.inService.at))} ${a.goLive.code(v.inService.code)}` : a.goLive.none}</p>

${o.licence ? licenceBlock(c, o.licence) : ""}
${o.price ? html`<p class="note">${a.licence.price(o.price)}</p>` : ""}

<h2>${a.actions.heading}</h2>
${v.rotation && !v.asked.rotate ? html`<p class="note">${v.rotation.ok ? (v.rotation.oldUntil ? a.actions.rotateDone(at(v.rotation.oldUntil)) : "") : a.actions.rotateFailed}</p>` : ""}
${stopped ? html`<p>${a.actions.stopped}</p>` : v.asked.stop ? html`<p>${a.actions.stopAsked}</p>` : html`<form method="post" action="/agents/${v.id}/stop">${csrf(c)}<button class="btn danger" type="submit">${a.actions.stop}</button></form>
<p class="note">${a.actions.stopNote}</p>`}
${v.asked.crashTest || crash?.running ? "" : html`<form method="post" action="/agents/${v.id}/crash-test">${csrf(c)}<button class="btn" type="submit">${a.actions.crashTest}</button></form>
<p class="note">${a.actions.crashNote}</p>`}
${v.asked.rotate ? html`<p>${a.actions.rotateAsked}</p>` : html`<form method="post" action="/agents/${v.id}/rotate">${csrf(c)}<button class="btn" type="submit">${a.actions.rotate}</button></form>
${v.guards.length > 1 ? html`<p>${v.guards.map((g) => html`<form method="post" action="/agents/${v.id}/rotate" class="inline">${csrf(c)}<input type="hidden" name="guard" value="${g.kind}"><button class="btn" type="submit">${a.actions.rotateOne(guardName(a, g.kind))}</button></form> `)}</p>` : ""}
<p class="note">${a.actions.rotateNote}</p>`}
<p class="note">${a.actions.cliOnly}</p>`);
}
