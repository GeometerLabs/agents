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
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { formatInr, formatSlot } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { OwnerItemView, OwnerView, RelayAsk } from "./backend.ts";
import { OWNER, PAGE } from "./words.ts";
import { OWNER_MORE } from "./words-orders-fees.ts";
import { CARD_LABELS } from "../assistant/words.ts";
import { characterLine, talkBox } from "../assistant/app/talk.ts";
import { LOOK_COLOURS } from "../assistant/app/pwa.ts";

const CSS = `
:root{--ink:#10231a;--mute:#4b5d52;--line:#cfe3d6;--g9:#14532d;--g7:#15803d;--g1:#dcfce7;--amber:#92400e;--amber-bg:#fffbeb}
*{box-sizing:border-box}body{margin:0;color:var(--ink);font:17px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Devanagari","Noto Sans Malayalam","Noto Sans Kannada",sans-serif}
main{max-width:34rem;margin:0 auto;padding:0 16px 40px}header{background:var(--g9);color:#fff;margin:0 -16px 16px;padding:18px 16px}header h1{margin:0;font-size:1.25rem}
.note{color:var(--mute);font-size:.9rem}.machine,.notice{background:var(--amber-bg);color:var(--amber);padding:8px 10px;border-radius:8px;font-size:.95rem}
.item{border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px}.item form{display:inline}button{margin:10px 8px 0 0;font-size:1rem;padding:10px 14px;border-radius:10px;border:0;background:var(--g7);color:#fff;cursor:pointer}
button.no{background:#fff;color:var(--g9);border:1px solid var(--line)}ul{padding-left:18px}
.who-am-i{font-size:1.05rem}.dot{display:inline-block;width:.9em;height:.9em;border-radius:50%;vertical-align:middle}.sr{position:absolute;left:-9999px}
.talk textarea{width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px}.talk-owner{color:var(--mute)}
`;

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
  /** Item 11h: the owner's "Alerts on this phone" box (modules/push/pages.ts), already drawn, when the shop has web push. */
  alerts?: string;
}

/** One answer button: posts what it stands for and the digest of what the page shows. */
function button(base: string, f: { source: "runtime" | "relay"; action: string; case: string; digest: string }, label: string, quiet = false, csrf?: string): Raw {
  return html`<form method="post" action="${base}/answer">${csrf ? html`<input type="hidden" name="csrf" value="${csrf}">` : ""}<input type="hidden" name="source" value="${f.source}"><input type="hidden" name="action" value="${f.action}"><input type="hidden" name="case" value="${f.case}"><input type="hidden" name="digest" value="${f.digest}"><button${quiet ? raw(' class="no"') : ""} type="submit">${label}</button></form>`;
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
    if (i.kind === "deposit") return html`<div class="item"><p>${w.deposit(who(i.customer, i.channel), amount, what(i))}</p>${b("received", w.received(amount))}</div>`;
    if (i.kind === "refund_owed") return html`<div class="item"><p>${w.refundOwed(who(i.customer, i.channel), amount, i.why ?? "")}</p>${b("refunded", w.refundSent)}${i.actions.includes("kept") ? b("kept", v.kind === "orders" ? more.keptOrder : w.kept, true) : ""}</div>`;
    if (i.kind === "late_refund" && v.kind === "orders") return html`<div class="item"><p>${more.lateOrder(who(i.customer, i.channel), what(i), amount)}</p>${b("approve", more.giveBack)}${b("deny", more.keepAdvance, true)}</div>`;
    if (i.kind === "late_refund") return html`<div class="item"><p>${w.lateRefund(who(i.customer, i.channel), what(i), amount)}</p>${b("approve", w.refundIt)}${b("deny", w.keepIt, true)}</div>`;
    if (i.kind === "big_order") return html`<div class="item"><p>${more.bigOrder(who(i.customer, i.channel), what(i), amount)}</p>${b("approve", more.accept)}${b("deny", more.refuse, true)}</div>`;
    const student = i.customer.name ?? i.customer.phone;
    if (i.kind === "waiver") return html`<div class="item"><p>${more.waiver(student, what(i), amount)}</p>${b("approve", more.waiveIt)}${b("deny", more.dontWaive, true)}</div>`;
    if (i.kind === "refund_request") return html`<div class="item"><p>${more.refundRequest(student, what(i), amount)}</p>${b("approve", more.refundIt)}${b("deny", more.dontRefund, true)}</div>`;
    return html`<div class="item"><p>${w.calendar(who(i.customer, i.channel), what(i), amount)}</p>${b("retry", w.retry)}${b("approve", w.cancelRefund, true)}</div>`;
  };
  // item 11h (Fees): each parent and their private link; a press carries the digest of the link's state as shown, so it is done once
  const parents = v.parents ? html`<h2>${more.parents}</h2><p class="note">${more.parentsNote}</p>${v.parents.map((p) => {
    const b = (action: string, label: string, quiet = false) => button(o.base, { source: "runtime", action, case: p.ref, digest: p.digest }, label, quiet, o.csrf);
    return html`<div class="item"><p>${more.parentRow(p.students.join(", "), p.phone)}<br><small class="note">${p.link === "active" && p.sinceMs !== undefined ? more.linkActive(formatSlot(p.sinceMs, tz, o.language)) : more.linkNone}</small></p>${b("send_link", more.sendLink)}${p.link === "active" ? b("revoke_link", more.revokeLink, true) : ""}</div>`;
  })}` : "";
  const coming = v.kind === "fees" ? "" : html`<h2>${v.kind === "orders" ? more.upcomingOrders : w.upcoming}</h2>
${v.upcoming.length > 0 ? html`<ul>${v.upcoming.map((u) => html`<li>${formatSlot(u.startMs, tz, o.language)}: ${u.what ?? service(u.serviceId)} · ${who(u.customer, u.channel)}</li>`)}</ul>` : html`<p>${v.kind === "orders" ? more.noneComingOrders : w.noneComing}</p>`}`;
  const ask = (a: RelayAsk): Raw => {
    const b = (action: "approve" | "deny", label: string, quiet = false) => button(o.base, { source: "relay", action, case: a.approval, digest: a.digest }, label, quiet, o.csrf);
    const detail = [a.serviceName, a.slotMs !== undefined ? formatSlot(a.slotMs, tz, o.language) : ""].filter(Boolean).join(", ");
    return html`<div class="item"><p>${w.guardRefund(a.customerPhone ?? "", formatInr(a.amountPaise / 100), detail || (a.booking ?? ""), formatSlot(a.untilMs, tz, o.language))}</p>${b("approve", w.approve)}${b("deny", w.deny, true)}</div>`;
  };
  // item 11e: the assistant's open cards, with the same question and buttons as on WhatsApp, answered by the card's id and digest (never its code)
  const labels = CARD_LABELS[o.language];
  const card = (c: NonNullable<OwnerView["app"]>["cards"][number]): Raw => {
    const b = (action: "card_yes" | "card_no", label: string, quiet = false) => button(o.base, { source: "runtime", action, case: c.id, digest: c.digest }, label, quiet, o.csrf);
    const message = c.kind === "message";
    return html`<div class="item"><p>${c.question ?? `${c.case}: ${c.who}${c.amountPaise > 0 ? `, ${formatInr(c.amountPaise / 100)}` : ""}`}</p>${b("card_yes", message ? labels.send : labels.approve)}${c.hasNo ? b("card_no", message ? labels.dontSend : labels.refuse, true) : ""}</div>`;
  };
  // a card that answers something already waiting (kind "answer") is the same thing as that item, whose own buttons are right here: only the assistant's own acts
  // (cancel, refund, a message) are shown as cards, so the page never lists one thing twice
  const waiting = [...o.relayAsks.map(ask), ...v.items.map(item), ...(v.app?.cards ?? []).filter((c) => c.kind !== "answer").map(card)];
  const machine = PAGE[o.language].machine;
  const app = v.app;
  const colour = app ? LOOK_COLOURS[app.character.look.colour] ?? LOOK_COLOURS.teal : undefined;
  // the manifest is behind the owner's cookie on the signed-in view, so it is fetched with the browser's credentials (a manifest fetch leaves them out otherwise)
  // item 11h: with alerts, the manifest too (an iPhone shows web push only to an app added to the home screen)
  const appHead = app || o.alerts ? html`<link rel="manifest" href="${o.base}/manifest.webmanifest" crossorigin="use-credentials"><meta name="theme-color" content="${colour ?? LOOK_COLOURS.leaf}">` : "";
  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>${w.title(v.shop.name)}</title><style>${raw(CSS)}</style>${appHead}</head><body><main><header><h1>${w.title(v.shop.name)}</h1></header>
${app ? raw(characterLine({ language: o.language, name: app.character.name, colour: colour!, mood: app.mood })) : ""}
${machine ? html`<p class="machine">${machine}</p>` : ""}
${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : ""}
<p class="note">${w.privateNote}</p>
<h2>${w.waiting}</h2>
${waiting.length > 0 ? waiting : html`<p>${w.none}</p>`}
${coming}${parents}
${app ? raw(talkBox({ base: o.base, language: o.language, lines: app.talk, assistantName: app.character.name, ...(o.nonce ? { nonce: o.nonce } : {}), ...(o.csrf ? { csrf: o.csrf } : {}), listen: app.listen === true })) : ""}
${o.alerts ? raw(o.alerts) : ""}
${o.signOut ? html`<form method="post" action="${o.signOut.action}">${o.csrf ? html`<input type="hidden" name="csrf" value="${o.csrf}">` : ""}<button class="no" type="submit">${o.signOut.label}</button></form>` : ""}
</main></body></html>`.markup}`;
}

/** The page shown when the link is not (or no longer) valid: no shop name, nothing to learn. */
export function ownerLinkGone(language: Language): string {
  return `<!doctype html>${html`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>-</title><style>${raw(CSS)}</style></head><body><main><p>${OWNER[language].result.denied_link}</p></main></body></html>`.markup}`;
}
