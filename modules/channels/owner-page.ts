// The owner's private approvals page: what waits for the owner's answer, each with its buttons, and the coming bookings. Rendered by the public front (front.ts) from
// the runtime's owner read (the agent's own asks and the UPI marks, templates' channel.ts ownerView) and, for a shop whose Guard holds refunds, the approvals relay's
// asks (modules/approvals/relay.ts ownerAsks). For a shop on WhatsApp it is one more way to answer, never a replacement: the same answer on WhatsApp still works, and
// whichever comes first counts.
//
// Each button posts the digest of exactly what the page showed. The authority (the runtime for its asks and marks, the relay for a refund Guard holds) compares it with
// what waits now and does nothing when they differ: a changed amount needs a new yes, and an answer already given (here or on WhatsApp) cannot be given twice.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { formatInr, formatSlot } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { OwnerItemView, OwnerView, RelayAsk } from "./backend.ts";
import { OWNER, PAGE } from "./words.ts";

const CSS = `
:root{--ink:#10231a;--mute:#4b5d52;--line:#cfe3d6;--g9:#14532d;--g7:#15803d;--g1:#dcfce7;--amber:#92400e;--amber-bg:#fffbeb}
*{box-sizing:border-box}body{margin:0;color:var(--ink);font:17px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Devanagari","Noto Sans Malayalam","Noto Sans Kannada",sans-serif}
main{max-width:34rem;margin:0 auto;padding:0 16px 40px}header{background:var(--g9);color:#fff;margin:0 -16px 16px;padding:18px 16px}header h1{margin:0;font-size:1.25rem}
.note{color:var(--mute);font-size:.9rem}.machine,.notice{background:var(--amber-bg);color:var(--amber);padding:8px 10px;border-radius:8px;font-size:.95rem}
.item{border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px}.item form{display:inline}button{margin:10px 8px 0 0;font-size:1rem;padding:10px 14px;border-radius:10px;border:0;background:var(--g7);color:#fff;cursor:pointer}
button.no{background:#fff;color:var(--g9);border:1px solid var(--line)}ul{padding-left:18px}
`;

export interface OwnerPageInput {
  base: string; // https://<server>/s/<shop>/o/<token>: the page posts its answers to <base>/answer
  language: Language;
  view: OwnerView;
  relayAsks: RelayAsk[];
  notice?: string;
}

/** One answer button: posts what it stands for and the digest of what the page shows. */
function button(base: string, f: { source: "runtime" | "relay"; action: string; case: string; digest: string }, label: string, quiet = false): Raw {
  return html`<form method="post" action="${base}/answer"><input type="hidden" name="source" value="${f.source}"><input type="hidden" name="action" value="${f.action}"><input type="hidden" name="case" value="${f.case}"><input type="hidden" name="digest" value="${f.digest}"><button${quiet ? raw(' class="no"') : ""} type="submit">${label}</button></form>`;
}

export function ownerPage(o: OwnerPageInput): string {
  const w = OWNER[o.language];
  const v = o.view;
  const tz = v.shop.timezone;
  const service = (id?: string) => v.services.find((s) => s.id === id)?.names[o.language] ?? "";
  const what = (i: { serviceId?: string; startMs?: number }) => [service(i.serviceId), i.startMs !== undefined ? formatSlot(i.startMs, tz, o.language) : ""].filter(Boolean).join(", ");
  const who = (c: OwnerItemView["customer"], ch: OwnerItemView["channel"]) => w.who(c.name, c.phone, w.from[ch]);
  const item = (i: OwnerItemView): Raw => {
    const amount = formatInr(i.amountPaise / 100);
    const b = (action: string, label: string, quiet = false) => button(o.base, { source: "runtime", action, case: i.case, digest: i.digest }, label, quiet);
    if (i.kind === "deposit") return html`<div class="item"><p>${w.deposit(who(i.customer, i.channel), amount, what(i))}</p>${b("received", w.received(amount))}</div>`;
    if (i.kind === "refund_owed") return html`<div class="item"><p>${w.refundOwed(who(i.customer, i.channel), amount, i.why ?? "")}</p>${b("refunded", w.refundSent)}${i.actions.includes("kept") ? b("kept", w.kept, true) : ""}</div>`;
    if (i.kind === "late_refund") return html`<div class="item"><p>${w.lateRefund(who(i.customer, i.channel), what(i), amount)}</p>${b("approve", w.refundIt)}${b("deny", w.keepIt, true)}</div>`;
    return html`<div class="item"><p>${w.calendar(who(i.customer, i.channel), what(i), amount)}</p>${b("retry", w.retry)}${b("approve", w.cancelRefund, true)}</div>`;
  };
  const ask = (a: RelayAsk): Raw => {
    const b = (action: "approve" | "deny", label: string, quiet = false) => button(o.base, { source: "relay", action, case: a.approval, digest: a.digest }, label, quiet);
    const detail = [a.serviceName, a.slotMs !== undefined ? formatSlot(a.slotMs, tz, o.language) : ""].filter(Boolean).join(", ");
    return html`<div class="item"><p>${w.guardRefund(a.customerPhone ?? "", formatInr(a.amountPaise / 100), detail || (a.booking ?? ""), formatSlot(a.untilMs, tz, o.language))}</p>${b("approve", w.approve)}${b("deny", w.deny, true)}</div>`;
  };
  const waiting = [...o.relayAsks.map(ask), ...v.items.map(item)];
  const machine = PAGE[o.language].machine;
  return `<!doctype html>${html`<html lang="${o.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>${w.title(v.shop.name)}</title><style>${raw(CSS)}</style></head><body><main><header><h1>${w.title(v.shop.name)}</h1></header>
${machine ? html`<p class="machine">${machine}</p>` : ""}
${o.notice ? html`<p class="notice" role="status">${o.notice}</p>` : ""}
<p class="note">${w.privateNote}</p>
<h2>${w.waiting}</h2>
${waiting.length > 0 ? waiting : html`<p>${w.none}</p>`}
<h2>${w.upcoming}</h2>
${v.upcoming.length > 0 ? html`<ul>${v.upcoming.map((u) => html`<li>${formatSlot(u.startMs, tz, o.language)}: ${service(u.serviceId)} · ${who(u.customer, u.channel)}</li>`)}</ul>` : html`<p>${w.noneComing}</p>`}
</main></body></html>`.markup}`;
}

/** The page shown when the link is not (or no longer) valid: no shop name, nothing to learn. */
export function ownerLinkGone(language: Language): string {
  return `<!doctype html>${html`<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>-</title><style>${raw(CSS)}</style></head><body><main><p>${OWNER[language].result.denied_link}</p></main></body></html>`.markup}`;
}
