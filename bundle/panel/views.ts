// Every page the panel shows, as a function from a small view model to HTML. The shell and the style are the demo's (templates/commerce/bookings/demo/page.css,
// read, not copied) plus panel.css. No page needs JavaScript: a cheap phone loads plain forms and links. Every value goes through html``, which
// escapes by default, so a shop named <script> is text everywhere. Words come from words.ts (four languages) and, for the certificate line and
// "Show what we did", from the report's own strings.
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { languageOptions } from "../../templates/commerce/bookings/demo/personalise.ts";
import type { ShopForm } from "../../templates/commerce/bookings/demo/personalise.ts";
import { STRINGS } from "../../templates/commerce/bookings/report/strings.ts";
import { formatRupees } from "./cost.ts";
import type { CostLine, MonthlyCost } from "./cost.ts";
import type { CheckResult } from "./checks.ts";
import type { LiveView, ShopStatus } from "./contract.ts";
import { html, raw } from "./html.ts";
import type { Raw } from "./html.ts";
import type { PlanView } from "./plan.ts";
import { formatInr } from "../../modules/language/format.ts";
import type { Obligation } from "../../modules/unfinished/index.ts";
import type { ShopInbox } from "./inbox.ts";
import type { Draft } from "./setup.ts";
import type { Template } from "./templates.ts";
import type { Unmet, StoredChecks } from "./golive.ts";
import type { Words } from "./words.ts";
import { feesBusinessBody, feesRulesBody } from "./views-fees.ts";
import type { activityFees, messageCeiling, summaryFees } from "./views-fees.ts";

const css = readFileSync(new URL("../../templates/commerce/bookings/demo/page.css", import.meta.url), "utf8") + readFileSync(new URL("./panel.css", import.meta.url), "utf8");

export interface Ctx {
  w: Words;
  lang: Language;
  nonce: string;
  /** The signed-in person, if any. */
  who?: { name: string; role: "builder" | "partner" };
  csrf: string;
  /** Machine-written language, not yet read by a native speaker. */
  draftLanguage: boolean;
  path: string;
  /** Builders on a server that lets them invite people. */
  canInvite: boolean;
}

const dateFmt = (lang: string) => new Intl.DateTimeFormat(`${lang}-IN-u-nu-latn`, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
export const when = (iso: string | undefined | null, lang: string): string => (iso && Number.isFinite(Date.parse(iso)) ? dateFmt(lang).format(new Date(iso)) : "");

const csrf = (c: Ctx) => html`<input type="hidden" name="_csrf" value="${c.csrf}">`;
const roleWord = (c: Ctx, role: "builder" | "partner") => c.w.roles[role];

export function layout(c: Ctx, title: string, body: Raw, options: { nav?: boolean } = {}): string {
  const showNav = options.nav !== false && c.who;
  return html`<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f6b45">
<meta name="robots" content="noindex">
<title>${title} · ${c.w.appName}</title>
<style nonce="${c.nonce}">${raw(css)}</style>
</head>
<body>
<header class="topbar"><div class="wrap">
  <a class="brand" href="/">${c.w.appName}</a>
  ${c.who ? html`<div class="who">${c.who.name} · ${roleWord(c, c.who.role)}</div>` : ""}
</div></header>
<div class="wrap">
  <nav class="langs" aria-label="${c.w.languageName}">${LANGUAGES.map((l) => html`<a href="/lang/${l}?next=${encodeURIComponent(c.path)}" lang="${l}" ${l === c.lang ? raw('aria-current="true"') : ""}>${languageName(l)}</a>`)}</nav>
  <main>${body}</main>
  ${c.draftLanguage ? html`<p class="draft">${c.w.draftNote}</p>` : ""}
</div>
${showNav ? html`<nav class="tabbar" aria-label="${c.w.appName}">
  <a class="tab" href="/shops">${c.w.nav.shops}</a>
  <a class="tab" href="/inbox">${c.w.inbox.nav}</a>
  <a class="tab" href="/setup">${c.w.nav.setUp}</a>
  ${c.canInvite ? html`<a class="tab" href="/invite">${c.w.nav.invite}</a>` : ""}
  <form method="post" action="/logout" class="tab" style="padding:0"><input type="hidden" name="_csrf" value="${c.csrf}"><button class="tab" type="submit" style="width:100%">${c.w.nav.signOut}</button></form>
</nav>` : ""}
</body>
</html>`.markup;
}

export const languageName = (l: Language): string => languageOptions().find((o) => o.code === l)?.label.split(" · ")[0] ?? l;

// ---- sign in, invitations ---------------------------------------------------------------------------------------------------------------

export function loginPage(c: Ctx, o: { error?: string; handle?: string; hostedNote: boolean }): string {
  const w = c.w.login;
  return layout(c, w.title, html`<h1>${w.title}</h1>
${o.error ? html`<ul class="errors" role="alert"><li>${o.error}</li></ul>` : ""}
<form method="post" action="/login" autocomplete="off">${csrf(c)}
  <label class="field"><span>${w.handle}</span><input name="handle" value="${o.handle ?? ""}" autocomplete="username" autocapitalize="none" required></label>
  <label class="field"><span>${w.passphrase}</span><input name="passphrase" type="password" autocomplete="current-password" required></label>
  <button class="btn primary" type="submit">${w.button}</button>
</form>
<p class="note">${w.byInvitation}</p>`, { nav: false });
}

export function joinPage(c: Ctx, o: { token: string; role: "builder" | "partner"; error?: string; values: { name: string; handle: string; language: string } }): string {
  const w = c.w.join;
  return layout(c, w.title(roleWord(c, o.role)), html`<h1>${w.title(roleWord(c, o.role))}</h1>
<p>${w.intro}</p>
${o.error ? html`<ul class="errors" role="alert"><li>${o.error}</li></ul>` : ""}
<form method="post" action="/join" autocomplete="off">${csrf(c)}<input type="hidden" name="token" value="${o.token}">
  <label class="field"><span>${w.name}</span><input name="name" value="${o.values.name}" maxlength="80" required></label>
  <label class="field"><span>${w.handle}</span><input name="handle" value="${o.values.handle}" autocapitalize="none" maxlength="40" required><p class="help">${w.handleHelp}</p></label>
  <label class="field"><span>${w.passphrase}</span><input name="passphrase" type="password" autocomplete="new-password" required><p class="help">${w.passphraseHelp}</p></label>
  <label class="field"><span>${w.language}</span><select name="language">${languageOptions().map((l) => html`<option value="${l.code}" ${l.code === o.values.language ? raw("selected") : ""}>${l.label}</option>`)}</select></label>
  <button class="btn primary" type="submit">${w.button}</button>
</form>`, { nav: false });
}

export function invitePage(c: Ctx, o: { link?: string; hostedOnly: boolean }): string {
  const w = c.w.invite;
  if (o.hostedOnly) return layout(c, w.title, html`<h1>${w.title}</h1><p>${w.hostedOnly}</p>`);
  return layout(c, w.title, html`<h1>${w.title}</h1>
${o.link ? html`<div class="notice"><p>${w.made}</p><code class="addr">${o.link}</code><p class="note">${w.copy}</p></div>` : ""}
<form method="post" action="/invite" autocomplete="off">${csrf(c)}
  <label class="field"><span>${w.role}</span><select name="role"><option value="partner">${c.w.roles.partner}</option><option value="builder">${c.w.roles.builder}</option></select></label>
  <label class="field"><span>${w.note}</span><input name="note" maxlength="120"></label>
  <button class="btn primary" type="submit">${w.button}</button>
</form>`);
}

// ---- the shops --------------------------------------------------------------------------------------------------------------------------

export interface ShopCardView { id: string; name: string; live: LiveView; limits?: { proven: number; of: number }; version?: string; setUpBy?: string }

const liveLine = (c: Ctx, live: LiveView): Raw => html`<span class="state ${live.code}">${c.w.live[live.code]}</span>`;

export function shopsPage(c: Ctx, o: { all: boolean; cards: ShopCardView[] }): string {
  const w = c.w.shops;
  return layout(c, o.all ? w.titleAll : w.title, html`<h1>${o.all ? w.titleAll : w.title}</h1>
${o.cards.length === 0 ? html`<p class="big">${w.empty}</p><a class="btn primary" href="/setup">${w.setUp}</a>` : html`<div class="cards">${o.cards.map((s) => html`<a class="shopcard ${s.live.code}" href="/shops/${s.id}">
  <div class="name">${s.name}</div>
  <div>${liveLine(c, s.live)}</div>
  <div class="meta">${s.limits ? w.limits(s.limits.proven, s.limits.of) : w.limitsUnknown}${s.version ? html` · ${w.version(s.version)}` : ""}</div>
  <div class="meta">${s.setUpBy ? w.setUpBy(s.setUpBy) : w.setUpOnServer}</div></a>`)}</div>`}`);
}

// ---- the unfinished-work inbox (B31) ------------------------------------------------------------------------------------------------------------------

/** One obligation as one plain sentence, in the reader's language. A kind with no words (a module added one) is still said, in the fallback sentence. */
export function sentenceOf(c: Ctx, o: Obligation): string {
  const w = c.w.inbox;
  if (!Object.hasOwn(w.kinds, o.kind)) return w.fallback(o.kind, o.caseId);
  const f = o.facts;
  const amount = typeof f.amountInr === "number" ? formatInr(f.amountInr) : "";
  const noun = String(f.holder ?? f.what ?? "");
  return w.kinds[o.kind](o.caseId, amount, typeof f.hours === "number" ? f.hours : 0, Object.hasOwn(w.variants, noun) ? w.variants[noun] : "");
}

function inboxItems(c: Ctx, shop: ShopInbox): Raw {
  const w = c.w.inbox;
  if (!shop.asOf && shop.items.length === 0) return html`<p class="note">${w.notShared}</p>`;
  return html`${shop.items.length === 0 ? html`<p class="note">${w.empty}</p>` : html`<ul class="plain">${shop.items.map((o) => html`<li class="warn"><span class="mark">!</span><span>${sentenceOf(c, o)}${o.sinceMs !== null ? html`<br><small class="note">${w.since(when(new Date(o.sinceMs).toISOString(), c.lang))}</small>` : ""}${recoveryButtons(c, shop.id, o)}</span></li>`)}</ul>`}
${shop.failed.length > 0 ? html`<p class="note">${w.failedKinds}</p>` : ""}
${shop.asOf ? html`<p class="note">${w.asOf(when(shop.asOf, c.lang))}</p>` : ""}`;
}

function recoveryButtons(_c: Ctx, _shop: string, _o: Obligation): Raw { return raw(""); }

export function inboxPage(c: Ctx, o: { shops: ShopInbox[]; notice?: string }): string {
  const w = c.w.inbox;
  const total = o.shops.reduce((n, s) => n + s.items.length, 0);
  return layout(c, w.title, html`<h1>${w.title}</h1>
<p>${w.intro}</p>
${o.notice ? html`<div class="notice" role="status">${o.notice}</div>` : ""}
<p class="big">${total === 0 ? w.empty : w.count(total)}</p>
${o.shops.map((s) => html`<h2><a href="/shops/${s.id}">${s.name}</a></h2>${inboxItems(c, s)}`)}
<p class="note">${w.actionNote}</p>
<p class="note">${w.help}</p>`);
}

export interface ShopView {
  id: string;
  name: string;
  live: LiveView;
  status: ShopStatus | undefined;
  stopRequestedAt?: string;
  summary: { services: string[]; hours: string[]; deposit: string; cancel: string; languages: string; owner: string } | undefined;
  /** Bookings' running-cost model. A Fees centre has none (it has `fees`): the model is of bookings, and a wrong cost line is worse than none. */
  cost?: MonthlyCost;
  /** What a Fees centre's page shows in place of Bookings' summary, activity and cost. */
  fees?: { summary: ReturnType<typeof summaryFees>; activity?: ReturnType<typeof activityFees>; messages: ReturnType<typeof messageCeiling> };
  /** Fleet's last word on the shop's plan (plan.ts). Left out when fleet has said nothing. */
  plan?: PlanView;
  activity?: { made: number; cancelled: number; moved: number; deposits: number; refunds: number; saidNo: number; owner: { asked: number; approved: number; denied: number } };
  liveCounts?: { bookings: Record<string, number>; waitingForOwner: number; needBuilder: number };
  /** This shop's unfinished work (B31), read from its exported record. */
  inbox?: ShopInbox;
  papers: { goLive: string[]; monthly: string[]; canMakeReport: boolean; month: string };
  isBuilder: boolean;
  details?: { statusJson: string; pins: string; runtimeJson: string };
  limitsText: string[];
  notice?: string;
}

/** The plan: its name and included messages, the Innovator badge, the price, and what fleet wants the partner to know (button mode, warnings). */
function planBlock(c: Ctx, p: PlanView): Raw {
  const w = c.w.plan;
  const price = p.price ? (p.innovator && p.price.yoursPaise !== p.price.listPaise ? w.priceInnovator(formatRupees(p.price.listPaise), formatRupees(p.price.yoursPaise)) : w.price(formatRupees(p.price.listPaise))) : "";
  const warns = p.warn.filter((k): k is keyof typeof w.warn => k in w.warn);
  return html`<h2>${w.heading}</h2>
${p.plan ? html`<p class="big">${w.is(w.names[p.plan])}${p.innovator ? html` <span class="state live">${w.innovator}</span>` : ""}</p>
<ul class="plain">
  ${p.allowance !== null ? html`<li class="info"><span class="mark">·</span><span>${w.included(p.allowance)}</span></li>` : ""}
  ${price ? html`<li class="info"><span class="mark">·</span><span>${price}<br><small class="note">${w.priceNote}</small></span></li>` : ""}
</ul>` : html`<p class="note">${w.none}</p>`}
${p.buttons ? html`<div class="notice" role="status"><b>${w.buttons}</b><br>${w.buttonsWhy[p.reason === "overage_unfunded" ? "overage_unfunded" : "other"]}</div>` : ""}
${warns.length > 0 ? html`<ul class="plain">${warns.map((k) => html`<li class="warn"><span class="mark">!</span><span>${w.warn[k]}</span></li>`)}</ul>` : ""}`;
}

function costTable(c: Ctx, cost: MonthlyCost): Raw {
  const w = c.w.cost;
  const amount = (l: CostLine): string => (l.state === "unknown" ? w.unknown : formatRupees(l.paise as number));
  return html`<h2>${w.heading}</h2>
<table class="cost"><tbody>
${cost.lines.map((l) => html`<tr><td>${w.lines[l.id]}${l.plan ? ` (${c.w.plan.names[l.plan]})` : ""}<small>${w.payer[l.payer]}</small></td><td class="n">${amount(l)}</td></tr>`)}
<tr class="total"><td>${cost.total.complete ? w.total : w.subtotal(cost.total.unknown.length)}</td><td class="n">${formatRupees(cost.total.paise)}</td></tr>
</tbody></table>
<p class="note">${cost.basis === "early-estimate" ? w.early : w.fromRecord(cost.bookings)} ${w.assumption(cost.assumptions.bookingsPerMonth)} ${w.priceList(cost.priceList.date)}</p>
<ul class="note">${cost.caveats.filter((k) => k !== "early-estimate").map((k) => html`<li>${w.caveats[k as keyof typeof w.caveats]}</li>`)}</ul>`;
}

/** The Fees centre's settings in plain words: its batches with their fees, the rules (the certificate's own lines), the languages and the owner. */
function feesSummaryBlock(c: Ctx, v: ShopView): Raw {
  const w = c.w.shop;
  const f = v.fees!;
  return html`<ul class="plain">
  <li class="info"><span class="mark">·</span><span><b>${w.summaryFees}</b><br>${f.summary.batches.map((b) => html`${b}<br>`)}</span></li>
  <li class="info"><span class="mark">·</span><span>${w.summaryLanguages}: ${f.summary.languages}<br>${w.summaryOwner}: ${f.summary.owner}</span></li>
</ul>
<h3>${w.summaryRules}</h3>`;
}

function feesActivityBlock(c: Ctx, v: ShopView): Raw {
  const w = c.w.shop;
  const a = c.w.feesShop.activity;
  const x = v.fees!.activity;
  if (!x) return html`<p class="note">${w.noRecord}</p>`;
  return html`<ul class="plain">
  <li><span class="mark">·</span><span>${a.opened}: ${x.opened} · ${a.paidInFull}: ${x.paidInFull} · ${a.partlyPaid}: ${x.partlyPaid} · ${a.stillOpen}: ${x.stillOpen}</span></li>
  <li><span class="mark">·</span><span>${a.collected}: ${formatRupees(x.collected)} · ${a.stillToCollect}: ${formatRupees(x.stillToCollect)}</span></li>
  <li><span class="mark">·</span><span>${a.reminders}: ${x.reminders} · ${w.saidNo}: ${x.saidNo}</span></li>
  <li><span class="mark">·</span><span><b>${w.approvals}</b><br>${w.approvalsLine(x.owner.asked, x.owner.approved, x.owner.denied)}</span></li>
</ul>`;
}

function feesMessagesBlock(c: Ctx, m: ReturnType<typeof messageCeiling>): Raw {
  const w = c.w.feesShop.messages;
  return html`<h2>${w.heading}</h2>
<ul class="plain"><li class="info"><span class="mark">·</span><span>${w.ceiling(m.students, m.mostReminders, m.ceiling)}</span></li>${m.included !== null ? html`<li class="info"><span class="mark">·</span><span>${w.included(m.included)}</span></li>` : ""}</ul>
<p class="note">${w.note}</p>`;
}

export function shopPage(c: Ctx, v: ShopView): string {
  const w = c.w.shop;
  const status = v.status;
  const whyList = v.live.why.map((k) => html`<li>${c.w.why[k]}</li>`);
  return layout(c, v.name, html`<h1>${v.name}</h1>
${v.notice ? html`<div class="notice" role="status">${v.notice}</div>` : ""}
<p class="big">${liveLine(c, v.live)}</p>
${v.stopRequestedAt && v.live.code === "stopping" ? html`<p>${w.stopAsked(when(v.stopRequestedAt, c.lang))}</p>` : ""}
${whyList.length > 0 ? html`<ul>${whyList}</ul>` : ""}

<h2>${w.status}</h2>
<ul class="plain">
  <li><span class="mark">${status?.limits ? (status.limits.proven === status.limits.of ? "✓" : "!") : "·"}</span><span>${status?.limits ? c.w.shops.limits(status.limits.proven, status.limits.of) : c.w.shops.limitsUnknown}${status?.limits && status.limits.unprovable.length > 0 ? html`<br><small class="note">${w.unprovable(status.limits.unprovable.join(", "))}</small>` : ""}</span></li>
  <li class="info"><span class="mark">·</span><span>${status?.deploy?.at ? w.lastDeploy(when(status.deploy.at, c.lang)) : w.neverDeployed}${status?.versions ? html`<br><small class="note">${w.versions(status.versions.pathway ?? "?", status.versions.bundle ?? "?")}</small>` : ""}</span></li>
  <li class="info"><span class="mark">·</span><span>${status?.backups?.lastCopyAt ? w.backupCopy(when(status.backups.lastCopyAt, c.lang)) : w.backupNone}<br>${status?.backups?.lastDrillAt ? w.backupDrill(when(status.backups.lastDrillAt, c.lang), status.backups.drillOk === true) : w.backupDrillNone}</span></li>
</ul>

<h2>${w.activity}</h2>
${v.fees ? feesActivityBlock(c, v) : ""}
${v.activity ? html`<ul class="plain">
  <li><span class="mark">·</span><span>${w.made}: ${v.activity.made} · ${w.cancelled}: ${v.activity.cancelled} · ${w.moved}: ${v.activity.moved}</span></li>
  <li><span class="mark">·</span><span>${w.deposits}: ${v.activity.deposits} · ${w.refunds}: ${v.activity.refunds} · ${w.saidNo}: ${v.activity.saidNo}</span></li>
  <li><span class="mark">·</span><span><b>${w.approvals}</b><br>${w.approvalsLine(v.activity.owner.asked, v.activity.owner.approved, v.activity.owner.denied)}</span></li>
</ul>` : v.fees?.activity ? "" : html`<p class="note">${w.noRecord}</p>`}
${v.liveCounts ? html`<ul class="plain">
  ${Object.entries(v.liveCounts.bookings).map(([state, n]) => html`<li class="info"><span class="mark">${n}</span><span>${(v.fees ? w.feeStates : w.bookingStates)[state] ?? state}</span></li>`)}
  ${v.liveCounts.waitingForOwner > 0 ? html`<li class="warn"><span class="mark">!</span><span>${w.waiting(v.liveCounts.waitingForOwner)}</span></li>` : ""}
  ${v.liveCounts.needBuilder > 0 ? html`<li class="warn"><span class="mark">!</span><span>${w.needBuilder(v.liveCounts.needBuilder)}</span></li>` : ""}
</ul>` : ""}
<p class="note">${c.w.common.counts}</p>

${v.inbox ? html`<h2>${c.w.inbox.title}</h2>${inboxItems(c, v.inbox)}` : ""}

<h2>${w.settings}</h2>
${v.fees ? feesSummaryBlock(c, v) : ""}
${v.summary ? html`<ul class="plain">
  <li class="info"><span class="mark">·</span><span><b>${w.summaryServices}</b><br>${v.summary.services.map((s) => html`${s}<br>`)}</span></li>
  <li class="info"><span class="mark">·</span><span><b>${w.summaryHours}</b><br>${v.summary.hours.map((s) => html`${s}<br>`)}</span></li>
  <li class="info"><span class="mark">·</span><span>${v.summary.deposit}<br>${v.summary.cancel}</span></li>
  <li class="info"><span class="mark">·</span><span>${w.summaryLanguages}: ${v.summary.languages}<br>${w.summaryOwner}: ${v.summary.owner}</span></li>
</ul>` : ""}
<ul class="plain">${v.limitsText.map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>
<form method="post" action="/shops/${v.id}/edit">${csrf(c)}<button class="btn" type="submit">${w.settingsEdit}</button></form>

${v.plan ? planBlock(c, v.plan) : ""}

${v.cost ? costTable(c, v.cost) : v.fees ? feesMessagesBlock(c, v.fees.messages) : ""}

<h2>${w.papers}</h2>
<ul class="linklist">
  ${v.papers.goLive.filter((f) => f.endsWith(".html")).map((f) => html`<li><a href="/shops/${v.id}/docs/go-live/${f}">${w.goLive}${f.includes("-") ? html` (${f.replace(/^.*-([a-z]{2})\.html$/u, "$1")})` : ""}</a></li>`)}
  ${v.papers.monthly.filter((f) => f.endsWith(".html")).map((f) => html`<li><a href="/shops/${v.id}/docs/monthly/${f}">${w.monthly}: ${f.split("/")[0]}</a></li>`)}
</ul>
${v.papers.goLive.length === 0 ? html`<p class="note">${w.goLiveNone}</p>` : ""}
${v.papers.canMakeReport ? html`<form method="post" action="/shops/${v.id}/report">${csrf(c)}<input type="hidden" name="month" value="${v.papers.month}"><button class="btn" type="submit">${w.makeReport(v.papers.month)}</button></form>` : html`<p class="note">${w.reportNoRecord}</p>`}

${v.live.code !== "stopped" && v.live.code !== "stopping" ? html`<p><a class="btn danger" href="/shops/${v.id}/stop">${w.stop}</a></p>` : ""}

${v.isBuilder && v.details ? html`<details class="what"><summary>${STRINGS[c.lang].page.showWhatWeDid}</summary>
  <h2>${w.detailsDeploy}</h2><p>${status?.deploy?.message ?? w.detailsNothing}</p>
  <h2>${w.detailsPins}</h2><pre>${v.details.pins}</pre>
  <h2>${w.detailsStatusFile}</h2><pre>${v.details.statusJson}</pre>
  ${v.cost ? html`<h2>${w.detailsPrices(v.cost.priceList.date)}</h2><pre>sha256 ${v.cost.priceList.sha256}
${v.cost.lines.map((l) => `${l.id}: ${l.uses.join(", ") || "-"} (${l.quality ?? "-"})`).join("\n")}</pre>` : ""}
  <pre>${v.details.runtimeJson}</pre>
</details>` : ""}
`);
}

export function stopPage(c: Ctx, o: { id: string; name: string; already: boolean; at?: string }): string {
  const w = c.w.shop;
  return layout(c, w.stopTitle(o.name), html`<h1>${w.stopTitle(o.name)}</h1>
${o.already ? html`<div class="notice">${w.stopAsked(when(o.at, c.lang))}</div><p class="note">${w.stopOnly}</p>` : html`<p class="big">${w.stopText}</p>
<form method="post" action="/shops/${o.id}/stop">${csrf(c)}<button class="btn danger primary" type="submit">${w.stopConfirm}</button> <a class="btn" href="/shops/${o.id}">${c.w.common.back}</a></form>`}
<p><a href="/shops/${o.id}">${c.w.common.back}</a></p>`);
}

// ---- the setup --------------------------------------------------------------------------------------------------------------------------

export function setupStartPage(c: Ctx, templates: Template[]): string {
  const w = c.w.setup;
  return layout(c, w.title, html`<h1>${w.title}</h1>
<p class="big">${w.chooseTemplate}</p>
<div class="cards">${templates.map((t) => t.setup === "bookings" || t.setup === "fees" ? html`<form method="post" action="/setup">${csrf(c)}<input type="hidden" name="template" value="${t.id}">
  <button class="btn primary" type="submit" style="width:100%">${w.templateNames[t.id] ?? t.id} · ${w.start}</button></form>` : html`<div class="shopcard"><div class="name">${w.templateNames[t.id] ?? t.id}</div><div class="meta">${w.templateElsewhere}</div></div>`)}</div>`);
}

const stepsBar = (c: Ctx, steps: string[], now: number): Raw => html`<ol class="steps" aria-label="${c.w.setup.progress(now + 1, steps.length)}">${steps.map((_, i) => html`<li class="${i < now ? "done" : i === now ? "now" : ""}"></li>`)}</ol>`;
const errorsBox = (c: Ctx, problems: string[]): Raw => (problems.length === 0 ? raw("") : html`<div class="errors" role="alert"><b>${c.w.setup.problemsTitle}</b><ul>${problems.map((p) => html`<li>${p}</li>`)}</ul></div>`);
const text = (label: string, name: string, value: string, o: { type?: string; help?: string; mode?: string; autocomplete?: string; max?: number } = {}): Raw =>
  html`<label class="field"><span>${label}</span><input name="${name}" type="${o.type ?? "text"}" value="${value}" ${o.mode ? raw(`inputmode="${o.mode}"`) : ""} autocomplete="${o.autocomplete ?? "off"}" maxlength="${o.max ?? 120}">${o.help ? html`<p class="help">${o.help}</p>` : ""}</label>`;
/** A secret box: never filled with a value. When the secret already arrived it says when, and an empty box keeps it. */
const secret = (c: Ctx, label: string, name: string, receivedAt: string | undefined, kind: "password" | "textarea" = "password"): Raw => html`<label class="field"><span>${label}</span>
  ${kind === "textarea" ? html`<textarea name="${name}" autocomplete="off" spellcheck="false"></textarea>` : html`<input name="${name}" type="password" autocomplete="new-password" spellcheck="false" maxlength="2000">`}
  <p class="help">${receivedAt ? html`✓ ${c.w.setup.accounts.received(when(receivedAt, c.lang))} ${c.w.setup.accounts.keepEmpty}` : c.w.setup.accounts.neverShown}</p></label>`;

export interface StepView {
  draft: Draft;
  template: Template;
  steps: string[];
  now: number;
  problems: string[];
  limits: { price: string; hours: string; deposit: string; refund: string; booked: string; language: string; charge: string };
  /** A Fees centre's limits in plain words (the certificate's lines), shown under the rules step. Empty until the form builds. */
  feesLines?: string[];
  receipts: Partial<Record<string, string>>;
  shareAddress: string | undefined;
  webhookUrl: string | undefined;
}

export function setupStepPage(c: Ctx, v: StepView, step: "business" | "deposit" | "languages" | "accounts"): string {
  const w = c.w.setup;
  const d = v.draft;
  const isFees = v.template.setup === "fees";
  const title = isFees && (step === "business" || step === "deposit") ? w.fees.steps[step === "business" ? "business" : "rules"] : w.steps[step];
  const head = html`<p class="note">${w.progress(v.now + 1, v.steps.length)}</p>${stepsBar(c, v.steps, v.now)}<h1>${title}</h1>${errorsBox(c, v.problems)}`;
  const back = v.now > 0 ? html`<a class="btn" href="/setup/${d.id}/${v.now}">${c.w.common.back}</a> ` : "";
  const next = html`<button class="btn primary" type="submit">${c.w.common.next}</button>`;
  const shared = { csrf: csrf(c), text };
  let body: Raw;
  if (isFees && step === "business") body = feesBusinessBody(c, d, `/setup/${d.id}/${v.now + 1}`, back, next, shared);
  else if (isFees && step === "deposit") body = feesRulesBody(c, d, `/setup/${d.id}/${v.now + 1}`, back, next, v.feesLines ?? [], shared);
  else if (step === "business") {
    const b = w.business;
    body = html`<form method="post" action="/setup/${d.id}/${v.now + 1}">${csrf(c)}
  ${text(b.name, "name", d.form.name, { max: 80 })}
  <h2>${b.services}</h2><p class="note">${b.hint}</p>
  ${d.form.services.map((r, i) => html`<div class="svc"><input type="hidden" name="svc_id_${i}" value="${r.id}">
    ${text(b.serviceName, `svc_name_${i}`, r.name, { max: 80 })}${text(b.also, `svc_also_${i}`, r.also, { max: 200 })}
    <div class="row">${text(b.price, `svc_price_${i}`, r.price, { mode: "numeric", max: 9 })}${text(b.minutes, `svc_minutes_${i}`, r.minutes, { mode: "numeric", max: 3 })}</div></div>`)}
  <div class="row">${text(b.opens, "opens", d.form.opens, { type: "time", max: 5 })}${text(b.closes, "closes", d.form.closes, { type: "time", max: 5 })}</div>
  <div class="field"><span>${b.openOn}</span><div class="days">${b.dayNames.map((n, i) => html`<label><input type="checkbox" name="day_${i}" ${d.form.days[i] ? raw("checked") : ""}> ${n}</label>`)}</div></div>
  ${back}${next}</form>`;
  } else if (step === "deposit") {
    const s = w.depositStep;
    body = html`<form method="post" action="/setup/${d.id}/${v.now + 1}">${csrf(c)}
  ${text(s.amount, "deposit", d.form.deposit, { mode: "numeric", max: 9 })}
  ${text(s.window, "window", d.windowHours, { mode: "numeric", max: 3, help: s.windowHint })}
  <h2>${s.whatThisMeans}</h2>
  <ul class="plain">${Object.values(v.limits).map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>
  ${back}${next}</form>`;
  } else if (step === "languages") {
    const s = w.languagesStep;
    const options = languageOptions();
    body = html`<form method="post" action="/setup/${d.id}/${v.now + 1}">${csrf(c)}
  <label class="field"><span>${s.main}</span><select name="primary">${options.map((o) => html`<option value="${o.code}" ${o.code === d.primaryLanguage ? raw("selected") : ""}>${o.label}</option>`)}</select></label>
  <div class="field"><span>${s.also}</span><div class="days">${options.map((o) => html`<label><input type="checkbox" name="lang_${o.code}" ${d.otherLanguages.includes(o.code) ? raw("checked") : ""}> ${o.label.split(" · ")[0]}</label>`)}</div><p class="help">${s.hint}</p></div>
  <label class="field"><span>${s.ownerLanguage}</span><select name="ownerLanguage">${options.map((o) => html`<option value="${o.code}" ${o.code === d.ownerLanguage ? raw("selected") : ""}>${o.label}</option>`)}</select></label>
  ${text(s.ownerNumber, "ownerNumber", d.ownerNumber, { type: "tel", mode: "tel", max: 30, help: s.ownerNumberHelp })}
  ${back}${next}</form>`;
  } else {
    const a = w.accounts;
    const t = v.template;
    const guide = (steps: string[]) => html`<ol class="guide">${steps.map((s) => html`<li>${s}</li>`)}</ol>`;
    body = html`<p>${a.intro}</p><form method="post" action="/setup/${d.id}/${v.now + 1}" autocomplete="off">${csrf(c)}
  ${t.accounts.includes("whatsapp") ? html`<h2>${a.whatsapp.title}</h2><p>${a.whatsapp.intro}</p>${guide(a.whatsapp.steps)}
    ${text(a.whatsapp.number, "waNumber", d.whatsapp.businessNumber, { type: "tel", mode: "tel", max: 30 })}${text(a.whatsapp.numberId, "waNumberId", d.whatsapp.numberId, { mode: "numeric", max: 20 })}
    ${secret(c, a.whatsapp.token, "waToken", v.receipts.whatsapp_token)}${secret(c, a.whatsapp.appSecret, "waAppSecret", v.receipts.whatsapp_app_secret)}` : ""}
  ${t.accounts.includes("calendar") ? html`<h2>${a.calendar.title}</h2><p>${a.calendar.intro}</p>${guide(a.calendar.steps)}
    ${v.shareAddress ? html`<p>${a.calendar.shareAddress}</p><code class="addr">${v.shareAddress}</code>` : html`<p class="note">${a.calendar.noAddress}</p>`}
    ${text(a.calendar.id, "calId", d.calendar.id, { max: 200 })}
    ${v.shareAddress ? "" : secret(c, a.calendar.json, "calJson", v.receipts["google_service_account.json"], "textarea")}` : ""}
  ${t.accounts.includes("razorpay") ? html`<h2>${a.razorpay.title}</h2><p>${a.razorpay.intro}</p>${guide(a.razorpay.steps)}
    ${v.webhookUrl ? html`<code class="addr">${a.razorpay.webhookUrl(v.webhookUrl)}</code>` : ""}
    <div class="field"><span>${a.razorpay.mode}</span><div class="days">
      <label><input type="radio" name="rzpMode" value="live" ${d.razorpay.mode === "live" ? raw("checked") : ""}> ${a.razorpay.modeLive}</label>
      <label><input type="radio" name="rzpMode" value="test" ${d.razorpay.mode === "test" ? raw("checked") : ""}> ${a.razorpay.modeTest}</label></div></div>
    ${text(a.razorpay.keyId, "rzpKeyId", d.razorpay.keyId, { max: 60 })}${secret(c, a.razorpay.keySecret, "rzpKeySecret", v.receipts.razorpay_key)}${secret(c, a.razorpay.webhookSecret, "rzpWebhook", v.receipts.razorpay_webhook_secret)}` : ""}
  ${back}${next}</form>`;
  }
  return layout(c, title, html`${head}${body}`);
}

export interface ChecksView {
  draft: Draft;
  steps: string[];
  now: number;
  saved: boolean;
  problems: string[];
  checks: StoredChecks | undefined;
  settingsOk: boolean;
  deployApplied: { at?: string } | undefined;
  limits: { proven: number; of: number } | undefined;
  guardConfigured: boolean;
  unmet: Unmet[];
  ready: boolean;
  cost?: MonthlyCost;
  /** A Fees centre: its limits in plain words and the messages its rules allow, in place of Bookings' limits, cost table and bookings estimate. */
  fees?: { lines: string[]; messages: ReturnType<typeof messageCeiling> };
  certificate: string | undefined;
  shopId: string | undefined;
}

const mark = (state: "ok" | "bad" | "wait") => (state === "ok" ? "✓" : state === "bad" ? "!" : "…");
const row = (state: "ok" | "bad" | "wait", body: Raw): Raw => html`<li class="${state === "ok" ? "" : state}"><span class="mark">${mark(state)}</span><span>${body}</span></li>`;

function checkLine(c: Ctx, r: CheckResult): Raw {
  const w = c.w.setup.checks;
  const found = r.confirmed;
  let title: string;
  let text: string;
  const generic = (code: CheckResult["code"]): string => (code === "refused_by_guard" && r.detail ? w.guardWords(r.detail) : w.generic[code as keyof typeof w.generic] ?? w.generic.unexpected_response);
  if (r.service === "whatsapp") {
    title = w.whatsapp.title;
    text = r.code === "confirmed" ? w.whatsapp.confirmed(found?.displayNumber ?? "") : r.code === "account_mismatch" ? w.whatsapp.differs(r.foundEnding ?? "") : r.code === "not_found" ? w.whatsapp.notFound : generic(r.code);
  } else if (r.service === "razorpay") {
    title = w.razorpay.title;
    text = r.code === "confirmed" ? w.razorpay.confirmed(found?.mode === "live" ? c.w.setup.accounts.razorpay.modeLive : c.w.setup.accounts.razorpay.modeTest) : r.code === "account_mismatch" ? w.razorpay.differs : r.code === "wrong_mode" ? w.razorpay.wrongMode : generic(r.code);
  } else {
    title = w.calendar.title;
    text = r.code === "confirmed" ? w.calendar.confirmed(found?.calendarName ?? found?.calendarId ?? "") : r.code === "account_mismatch" ? w.calendar.differs : r.code === "not_found" ? w.calendar.notFound : r.code === "not_writable" ? w.calendar.notWritable(r.detail ?? "") : generic(r.code);
  }
  return row(r.ok ? "ok" : "bad", html`<b>${title}</b><br>${text}${r.service === "razorpay" && r.ok ? html`<br><small class="note">${w.razorpayWhose}</small>` : ""}`);
}

export function setupChecksPage(c: Ctx, v: ChecksView): string {
  const w = c.w.setup;
  const k = w.checks;
  const d = v.draft;
  const head = html`<p class="note">${w.progress(v.now + 1, v.steps.length)}</p>${stepsBar(c, v.steps, v.now)}<h1>${w.steps.checks}</h1>${errorsBox(c, v.problems)}`;
  const hand = v.checks?.hand;
  const back = html`<a class="btn" href="/setup/${d.id}/${v.now}">${c.w.common.back}</a>`;
  if (!v.saved) {
    return layout(c, w.steps.checks, html`${head}<p class="big">${k.saveFirst}</p>
<ul class="plain">${limitLines(c, d, v).map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>
<form method="post" action="/setup/${d.id}/save">${csrf(c)}<button class="btn primary" type="submit">${k.saveButton}</button> ${back}</form>`);
  }
  const rows: Raw[] = [
    row(v.settingsOk ? "ok" : "bad", html`${k.settingsOk}`),
    row(hand ? (hand.total > 0 && hand.held === hand.total ? "ok" : "bad") : "wait", html`<b>${k.handCheck}</b><br>${hand ? STRINGS[c.lang].cert.held(hand.held, hand.total, hand.failed, hand.notTested) : k.handNotRun}${hand && hand.failedTitles.length > 0 ? html`<ul>${hand.failedTitles.map((t) => html`<li>${t}</li>`)}</ul>` : ""}`),
    row(v.deployApplied ? "ok" : "wait", html`<b>${k.deploy}</b><br>${v.deployApplied ? k.deployApplied(when(v.deployApplied.at, c.lang)) : k.deployNot}`),
    row(v.limits && v.limits.proven === v.limits.of && v.limits.of > 0 ? "ok" : "wait", html`${v.limits ? k.limitsProven(v.limits.proven, v.limits.of) : k.limitsNot}`),
    ...(v.checks?.connections ? v.checks.connections.map((r) => checkLine(c, r)) : [row("wait", html`${v.guardConfigured ? k.waiting : k.guardNotSet}`)]),
  ];
  return layout(c, w.steps.checks, html`${head}
<div class="notice" role="status">${k.saved}</div>
<ul class="checks">${rows}</ul>
<p class="note">${k.readOnly}</p>
<form method="post" action="/setup/${d.id}/check">${csrf(c)}<button class="btn primary" type="submit">${k.runButton}</button></form>
${v.cost ? html`${costTable(c, v.cost)}
<form method="post" action="/setup/${d.id}/expected" style="margin-top:12px">${csrf(c)}${text(k.bookingsExpected, "expectedBookings", d.expectedBookings, { mode: "numeric", max: 6 })}<button class="btn" type="submit">${c.w.common.save}</button></form>` : v.fees ? feesMessagesBlock(c, v.fees.messages) : ""}
<h2>${w.depositStep.whatThisMeans}</h2>
<ul class="plain">${limitLines(c, d, v).map((t) => html`<li><span class="mark">✓</span><span>${t}</span></li>`)}</ul>
${v.ready
    ? html`<div class="notice"><p class="big">${k.ready}</p><p class="note">${k.switchOn}</p>${v.certificate ? html`<a class="btn primary" href="${v.certificate}">${k.certificate}</a>` : ""}</div>`
    : v.unmet.length > 0 ? html`<p class="big">${k.notReady(v.unmet.length)}</p>` : html`<form method="post" action="/setup/${d.id}/ready">${csrf(c)}<button class="btn primary" type="submit" style="width:100%">${k.readyButton}</button></form>`}
${v.shopId ? html`<p><a href="/shops/${v.shopId}">${c.w.nav.shops}</a></p>` : ""}
<p>${back}</p>`);
}

/** The limits to show on the checks page: Bookings' seven sentences, or a Fees centre's lines (the certificate's own words). */
const limitLines = (c: Ctx, d: Draft, v: ChecksView): string[] => (v.fees ? v.fees.lines : Object.values(limitList(c, d)));

/** The seven limits as one benefit sentence each, with this shop's own numbers. */
export function limitList(c: Ctx, d: Draft, hold = 15): { price: string; hours: string; deposit: string; refund: string; booked: string; language: string; charge: string } {
  const l = c.w.setup.limits;
  const deposit = /^\d{1,9}$/u.test(d.form.deposit) ? Number(d.form.deposit) : 200;
  const window = /^\d{1,3}$/u.test(d.windowHours) ? Number(d.windowHours) : 24;
  const amount = `₹${deposit.toLocaleString("en-IN")}`;
  return { price: l.price, hours: l.hours, deposit: l.deposit(amount, hold), refund: l.refund(window, amount), booked: l.booked, language: l.language, charge: l.charge };
}

export function errorPage(c: Ctx, status: number, message: string): string {
  return layout(c, String(status), html`<h1>${message}</h1><p><a class="btn" href="/">${c.w.common.back}</a></p>`, { nav: Boolean(c.who) });
}

export const _forTests = { dateFmt, languageName };
