// The owner's private approvals page: what waits for the owner's answer, each with its buttons, and the coming bookings. Rendered by the public front (front.ts) from
// the runtime's owner read (the agent's own asks and the UPI marks, templates' channel.ts ownerView) and, for a shop whose Guard holds refunds, the approvals relay's
// asks (modules/approvals/relay.ts ownerAsks). For a shop on WhatsApp it is one more way to answer, never a replacement: the same answer on WhatsApp still works, and
// whichever comes first counts.
//
// Each button posts the digest of exactly what the page showed. The authority (the runtime for its asks and marks, the relay for a refund Guard holds) compares it with
// what waits now and does nothing when they differ: a changed amount needs a new yes, and an answer already given (here or on WhatsApp) cannot be given twice.
//
// Item 11h: the same page for an Orders shop (an advance to mark, a big order to accept, a late cancellation's refund, the coming orders) and a Fees centre (a
// payment a parent says they made, a waiver or a refund a parent asked for, and the parents with their private links: send a new one, or switch it off). Each
// press carries its digest the same way, and the runtime does exactly what the owner's own reply on WhatsApp does.
//
// With the shop's assistant (item 11e, wired here after items 11d and 11f): the same page is the owner's app. The character's line and mood at the top, the
// assistant's cards among what waits (by card id and digest), the talk box at the bottom (modules/assistant/app/talk.ts), and the app's manifest and service worker
// (served by front.ts next to this page). Its one script carries the response's nonce; front.ts puts the same nonce in that response's content policy.
//
// Item 11i's design pass (14 Nov 2026): the shared look (look.ts OWNER_CSS). The head carries the character in the shop's real mood with the mood as a chip in its
// colour; each thing waiting is a card with a tag saying what it is, the amount large, and its two answers side by side (yes in green, no as an outline); the coming
// list is a list of rows; the talk is bubbles. The app's one script sits in the head (look.ts themeScript): it sets a remembered dark pick before the first paint,
// then runs the talk box's and the alerts' parts, so the page still runs exactly one script, by its nonce. Without a nonce (no assistant and no alerts) the page
// runs none and stays light.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { formatInr, formatSlot } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { OwnerItemView, OwnerView, RelayAsk } from "./backend.ts";
import { OWNER, PAGE } from "./words.ts";
import { OWNER_MORE } from "./words-orders-fees.ts";
import { CARD_LABELS } from "../assistant/words.ts";
import { characterLine, talkBox, talkScript } from "../assistant/app/talk.ts";
import { ASSISTANT_OF, themeColour } from "../assistant/character.ts";
import { ALERTS_SCRIPT } from "../push/pages.ts";
import { ICON, OWNER_CSS, themeScript, themeSwitch } from "./look.ts";
import { OWNER_LOOK } from "./words-look.ts";
import type { TagKey, Tone } from "./words-look.ts";


export interface OwnerPageInput {
  base: string; // https://<server>/s/<shop>/o/<token>, or (item 11f) <the shop's address>/owner: the page posts its answers to <base>/answer
  language: Language;
  view: OwnerView;
  relayAsks: RelayAsk[];
  notice?: string;
  /** Item 11f, a signed-in owner: the session's form token, put in every form (the shops share one origin, so a form from another page must not pass). */
  csrf?: string;
  /** Item 11f: where "Sign out" posts (with the form token), for a signed-in owner. */
  signOut?: { action: string; label: string };
  /** Item 11e: the script nonce of this response, when the view has the assistant's app (front.ts puts it in the content policy). */
  nonce?: string;
  /** Item 11h: the owner's "Alerts on this phone" box (modules/push/pages.ts), already drawn without its script (`bare`), when the shop has web push. */
  alerts?: string;
  /** Item 11i: the character's picture in the shop's mood now, as a data: address (front.ts reads it from the shop's own pictures). Left out: none drawn yet. */
  picture?: string;
}

/** One answer button: posts what it stands for and the digest of what the page shows. */
function button(base: string, f: { source: "runtime" | "relay"; action: string; case: string; digest: string }, label: string, quiet = false, csrf?: string): Raw {
  return html`<form method="post" action="${base}/answer">${csrf ? html`<input type="hidden" name="csrf" value="${csrf}">` : ""}<input type="hidden" name="source" value="${f.source}"><input type="hidden" name="action" value="${f.action}"><input type="hidden" name="case" value="${f.case}"><input type="hidden" name="digest" value="${f.digest}"><button class="${quiet ? "no" : "yes"}" type="submit">${label}</button></form>`;
}

/** One thing waiting, as a card: a tag saying what it is (in its meaning's colour), the amount large, the sentence, and its answers side by side. */
function waitingCard(language: Language, o: { tag: TagKey; tone?: Tone; amountPaise: number; text: string; buttons: Raw[] }): Raw {
  return html`<div class="item s-${o.tone ?? "wait"}"><div class="top"><span class="stamp">${OWNER_LOOK[language].tag[o.tag]}</span>${o.amountPaise > 0 ? html`<span class="amt">${formatInr(o.amountPaise / 100)}</span>` : ""}</div><p>${o.text}</p><div class="acts">${o.buttons}</div></div>`;
}

export function ownerPage(o: OwnerPageInput): string {
  const w = OWNER[o.language];
  const more = OWNER_MORE[o.language];
  const v = o.view;
  const tz = v.shop.timezone;
  const service = (id?: string) => v.services.find((s) => s.id === id)?.names[o.language] ?? "";
  // item 11h: an order or a fee says what it is about itself (`what`, in the owner's language); a booking names its service
  const what = (i: { serviceId?: string; startMs?: number; what?: string }) => [i.what ?? service(i.serviceId), i.startMs !== undefined ? formatSlot(i.startMs, tz, o.language) : ""].filter(Boolean).join(", ");
  const from = (ch: OwnerItemView["channel"]) => (v.kind && ch === "web" ? more.webPage : w.from[ch]);
  // a fee is a parent's: the student's name and the parent's number, with no channel to name
  const who = (c: OwnerItemView["customer"], ch: OwnerItemView["channel"]) => (v.kind === "fees" ? `${c.name ? `${c.name}, ` : ""}${c.phone}` : w.who(c.name, c.phone, from(ch)));
  const item = (i: OwnerItemView): Raw => {
    const amount = formatInr(i.amountPaise / 100);
    const b = (action: string, label: string, quiet = false) => button(o.base, { source: "runtime", action, case: i.case, digest: i.digest }, label, quiet, o.csrf);
    const card = (tag: TagKey, text: string, buttons: Raw[], tone?: Tone) => waitingCard(o.language, { tag, ...(tone ? { tone } : {}), amountPaise: i.amountPaise, text, buttons });
    if (i.kind === "deposit") return card("payment", w.deposit(who(i.customer, i.channel), amount, what(i)), [b("received", w.received(amount))]);
    if (i.kind === "refund_owed") return card("refundToSend", w.refundOwed(who(i.customer, i.channel), amount, i.why ?? ""), [b("refunded", w.refundSent), ...(i.actions.includes("kept") ? [b("kept", v.kind === "orders" ? more.keptOrder : w.kept, true)] : [])]);
    if (i.kind === "late_refund" && v.kind === "orders") return card("lateCancel", more.lateOrder(who(i.customer, i.channel), what(i), amount), [b("approve", more.giveBack), b("deny", more.keepAdvance, true)]);
    if (i.kind === "late_refund") return card("lateCancel", w.lateRefund(who(i.customer, i.channel), what(i), amount), [b("approve", w.refundIt), b("deny", w.keepIt, true)]);
    if (i.kind === "big_order") return card("bigOrder", more.bigOrder(who(i.customer, i.channel), what(i), amount), [b("approve", more.accept), b("deny", more.refuse, true)]);
    const student = i.customer.name ?? i.customer.phone;
    if (i.kind === "waiver") return card("waiver", more.waiver(student, what(i), amount), [b("approve", more.waiveIt), b("deny", more.dontWaive, true)]);
    if (i.kind === "refund_request") return card("refundAsked", more.refundRequest(student, what(i), amount), [b("approve", more.refundIt), b("deny", more.dontRefund, true)]);
    return card("calendar", w.calendar(who(i.customer, i.channel), what(i), amount), [b("retry", w.retry), b("approve", w.cancelRefund, true)], "bad");
  };
  // item 11h (Fees): each parent and their private link; a press carries the digest of the link's state as shown, so it is done once
  const parents = v.parents ? html`<h2>${more.parents}</h2><p class="note">${more.parentsNote}</p>${v.parents.map((p) => {
    const b = (action: string, label: string, quiet = false) => button(o.base, { source: "runtime", action, case: p.ref, digest: p.digest }, label, quiet, o.csrf);
    return html`<div class="item s-${p.link === "active" ? "ok" : "plain"}"><p>${more.parentRow(p.students.join(", "), p.phone)}<br><small class="note">${p.link === "active" && p.sinceMs !== undefined ? more.linkActive(formatSlot(p.sinceMs, tz, o.language)) : more.linkNone}</small></p><div class="acts">${b("send_link", more.sendLink)}${p.link === "active" ? b("revoke_link", more.revokeLink, true) : ""}</div></div>`;
  })}` : "";
  const coming = v.kind === "fees" ? "" : html`<h2>${v.kind === "orders" ? more.upcomingOrders : w.upcoming}</h2>
${v.upcoming.length > 0 ? html`<ul class="rows">${v.upcoming.map((u) => html`<li><b>${formatSlot(u.startMs, tz, o.language)}</b><span>${u.what ?? service(u.serviceId)} · ${who(u.customer, u.channel)}</span></li>`)}</ul>` : html`<p class="card">${v.kind === "orders" ? more.noneComingOrders : w.noneComing}</p>`}`;
  const ask = (a: RelayAsk): Raw => {
    const b = (action: "approve" | "deny", label: string, quiet = false) => button(o.base, { source: "relay", action, case: a.approval, digest: a.digest }, label, quiet, o.csrf);
    const detail = [a.serviceName, a.slotMs !== undefined ? formatSlot(a.slotMs, tz, o.language) : ""].filter(Boolean).join(", ");
    return waitingCard(o.language, { tag: "refundToApprove", amountPaise: a.amountPaise, text: w.guardRefund(a.customerPhone ?? "", formatInr(a.amountPaise / 100), detail || (a.booking ?? ""), formatSlot(a.untilMs, tz, o.language)), buttons: [b("approve", w.approve), b("deny", w.deny, true)] });
  };
  // item 11e: the assistant's open cards, with the same question and buttons as on WhatsApp, answered by the card's id and digest (never its code)
  const labels = CARD_LABELS[o.language];
  const card = (c: NonNullable<OwnerView["app"]>["cards"][number]): Raw => {
    const b = (action: "card_yes" | "card_no", label: string, quiet = false) => button(o.base, { source: "runtime", action, case: c.id, digest: c.digest }, label, quiet, o.csrf);
    const message = c.kind === "message";
    return waitingCard(o.language, { tag: message ? "message" : "assistant", tone: message ? "info" : "wait", amountPaise: c.amountPaise, text: c.question ?? `${c.case}: ${c.who}${c.amountPaise > 0 ? `, ${formatInr(c.amountPaise / 100)}` : ""}`, buttons: [b("card_yes", message ? labels.send : labels.approve), ...(c.hasNo ? [b("card_no", message ? labels.dontSend : labels.refuse, true)] : [])] });
  };
  // a card that answers something already waiting (kind "answer") is the same thing as that item, whose own buttons are right here: only the assistant's own acts
  // (cancel, refund, a message) are shown as cards, so the page never lists one thing twice
  const waiting = [...o.relayAsks.map(ask), ...v.items.map(item), ...(v.app?.cards ?? []).filter((c) => c.kind !== "answer").map(card)];
  const machine = PAGE[o.language].machine;
  const app = v.app;
  const colour = app ? themeColour(app.character) : undefined;
  // the manifest is behind the owner's cookie on the signed-in view, so it is fetched with the browser's credentials (a manifest fetch leaves them out otherwise)
  // item 11h: with alerts, the manifest too (an iPhone shows web push only to an app added to the home screen)
  const appHead = app || o.alerts ? html`<link rel="manifest" href="${o.base}/manifest.webmanifest" crossorigin="use-credentials"><meta name="theme-color" content="${colour ?? themeColour(undefined)}">` : "";
  // the app's one script (look.ts themeScript): the dark pick first, then the talk box's and the alerts' parts; only with this response's nonce
  const script = o.nonce ? themeScript([...(app ? [talkScript(o.base)] : []), ...(o.alerts ? [ALERTS_SCRIPT] : [])]) : "";
  const head = app
    ? raw(characterLine({ language: o.language, shop: v.shop.name, ...(app.character.name ? { name: app.character.name } : {}), colour: colour!, face: app.face, ...(o.picture ? { picture: o.picture } : {}), title: v.shop.name }))
    : html`<h1>${v.shop.name}</h1>`;
  // the referrer: the origin only, never this page's address (it holds the owner's link); not "no-referrer", which makes a browser post forms with Origin: null
  // (front.ts PAGE_REFERRER)
  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="strict-origin">
<title>${w.title(v.shop.name)}</title><style>${raw(OWNER_CSS)}</style>${appHead}${script ? html`<script nonce="${o.nonce!}">${raw(script)}</script>` : ""}</head><body class="app">
<header class="head"><div class="wrap"><div class="head-in">${head}</div>${o.nonce ? raw(themeSwitch(OWNER_LOOK[o.language].theme)) : ""}</div></header>
<main class="wrap">${machine ? html`<p class="machine">${machine}</p>` : ""}
${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : ""}
<p class="note private">${raw(ICON.lock)}<span>${w.privateNote}</span></p>
<h2>${w.waiting}</h2>
${waiting.length > 0 ? waiting : html`<p class="calm">${w.none}</p>`}
${coming}${parents}
${app ? raw(talkBox({ base: o.base, language: o.language, lines: app.talk, assistantName: app.character.name ?? ASSISTANT_OF[o.language](v.shop.name), ...(o.csrf ? { csrf: o.csrf } : {}), listen: app.listen === true, bare: true })) : ""}
${o.alerts ? raw(o.alerts) : ""}
${o.signOut ? html`<form method="post" action="${o.signOut.action}">${o.csrf ? html`<input type="hidden" name="csrf" value="${o.csrf}">` : ""}<button class="no full" type="submit">${o.signOut.label}</button></form>` : ""}
</main></body></html>`.markup}`;
}

/** The page shown when the link is not (or no longer) valid: no shop name, nothing to learn. */
export function ownerLinkGone(language: Language): string {
  return `<!doctype html>${html`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>-</title><style>${raw(OWNER_CSS)}</style></head><body><main class="wrap"><p class="state s-bad">${OWNER[language].result.denied_link}</p></main></body></html>`.markup}`;
}
