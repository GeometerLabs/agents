// Item 11h: what Orders' part of the shop page, its API, the MCP endpoint and the owner's page may READ, built from the shop's saved state and settings. Used by the
// runtime (server/runtime.ts, the channel kit) for the reads, by the agent (src/agent.ts) to check that an owner's press matches what waits now, and by the assistant's
// skill (src/assistant.ts), so "what needs me", the owner's page and the mood always list the same things. The pattern is Bookings' (templates/commerce/bookings/src/
// channel.ts).
//
// Everything here is an allowlist: a field is in a view because the page shows it. Never the owner's one-use code, never another customer, never a record line, and
// never the delivery address as typed (only its place on the shop's list). Prices are the shop's own, from the settings: nothing in a view is worked out from what a
// customer sent.
import { createHash } from "node:crypto";
import { leftOn } from "../../../../modules/payments/owner-marked/ledger.ts";
import type { MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { OwnerActionName } from "../../../../modules/channels/events.ts";
import type { OrderOffer, OrderView, PayInstructions } from "../../../../modules/channels/backend.ts";
import { addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { allSlots, itemName, itemOf } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { fixSlot, ordersOn, takenOf } from "./order.ts";
import type { Order, OrderState, Store } from "./order.ts";

/** "2026-11-16": a day as the page, the API and the event name it. */
export const isoOf = (d: LocalDate): string => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
/** The day a "YYYY-MM-DD" names, or undefined. */
export function dateOf(iso: string): LocalDate | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (!m) return undefined;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const back = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return back.getUTCFullYear() === d.year && back.getUTCMonth() === d.month - 1 && back.getUTCDate() === d.day ? d : undefined;
}

/** The menu as the page shows it: each item's first name in each language and its price (the shop's own, the only price ever quoted). */
export const publicItems = (settings: Settings) =>
  settings.menu.map((i) => ({ id: i.id, names: Object.fromEntries(LANGUAGES.map((l) => [l, itemName(i, l)])) as Record<Language, string>, priceInr: i.priceInr }));

/** What the page says about the shop and its rules. `paused`: the shop's licence takes no new orders now. */
export function orderShopInfo(settings: Settings, paused: boolean): OrderOffer["shop"] {
  const marked = ownerMarkedOf(settings.payment);
  return {
    name: settings.name, ...(settings.address ? { address: settings.address } : {}), timezone: settings.timezone, languages: settings.languages,
    payment: marked ? { kind: "upi", payee: marked.payTo.name } : { kind: "link" }, paused,
    advance: { mode: settings.advance.mode, percent: settings.advance.percent, holdMinutes: settings.advance.holdMinutes },
    cancellation: { windowHours: settings.cancellation.windowHours },
  };
}

/** One slot's moments on a day, as the agent fixes them (order.ts fixSlot): its window and its cut-off. */
function slotOn(settings: Settings, date: LocalDate, slotId: string): { fromMs: number; toMs: number; cutoffMs: number; mode: "pickup" | "delivery" } {
  const probe = { date, slotId } as Order;
  fixSlot(settings, probe);
  return { fromMs: probe.slotStartMs!, toMs: probe.slotEndMs!, cutoffMs: probe.cutoffMs!, mode: probe.mode! };
}

/**
 * The page's offer: the menu, and each day from today to the shop's last day with its slots (open while their cut-off has not passed), what is left of each item
 * and whether the day's order count is reached. Worked out from the orders themselves, as the agent's own limits are (order.ts takenOf, ordersOn): a number shown
 * here is checked again when the order is made, so two customers for the last one get one hold.
 */
export function orderOffer(settings: Settings, store: Store, nowMs: number, paused: boolean): OrderOffer {
  const today = localParts(nowMs, settings.timezone);
  const days: OrderOffer["days"] = [];
  for (let d = 0; d <= settings.orders.daysAhead; d++) {
    const date = addDays({ year: today.year, month: today.month, day: today.day }, d);
    const slots = allSlots(settings).map(({ slot }) => { const at = slotOn(settings, date, slot.id); return { id: slot.id, mode: at.mode, fromMs: at.fromMs, toMs: at.toMs, open: at.cutoffMs > nowMs }; });
    const left = Object.fromEntries(settings.menu.map((i) => [i.id, Math.max(0, i.dailyStock - takenOf(store, date, i.id, nowMs))]));
    days.push({ date: isoOf(date), slots, left, full: ordersOn(store, date, nowMs) >= settings.orders.maxPerDay });
  }
  return {
    kind: "orders", shop: orderShopInfo(settings, paused), items: publicItems(settings), days,
    ...(settings.delivery ? { delivery: { areas: settings.delivery.area } } : {}), maxItemsPerOrder: settings.orders.maxItemsPerOrder,
  };
}

/** An order's state as its page says it. */
const STATUS: Record<OrderState, Exclude<OrderView["status"], "pending" | "not_done" | "refused">> = {
  enquiry: "not_held", awaiting_owner: "checking", awaiting_advance: "held", confirmed: "confirmed", expired: "expired", cancelled: "cancelled", completed: "done",
};

const requestOf = (store: Store, o: Order): MarkedRequest | undefined => store.upi?.requests.find((r) => r.id === o.linkId);

/** How to pay a held order: the owner-marked UPI request (what is still asked, after a part was marked), or the gateway's link. */
function payOf(settings: Settings, store: Store, o: Order): PayInstructions | undefined {
  const marked = ownerMarkedOf(settings.payment);
  if (marked) {
    const r = requestOf(store, o);
    if (!r) return undefined;
    const left = leftOn(r);
    // after a part was marked, the link (and its QR) asks for what is left, the same amount the page states; a whole advance keeps the request's own link
    return { kind: "upi", link: left > 0 && left < r.amountPaise ? marked.payLink({ amountPaise: left, note: r.reference }) : r.link, payTo: marked.payTo, amountPaise: r.amountPaise, leftPaise: left, note: r.reference };
  }
  return o.linkUrl ? { kind: "link", url: o.linkUrl } : undefined;
}

/**
 * One request by its handle's hash, as its own page may show it. Null when the store has none (the runtime then says whether its task is still waiting). A refused
 * request says only why, as a name the page words; an order says its state, its lines at the shop's prices, its day and slot, how to pay while it is held, and the
 * messages the agent gave it.
 */
export function orderView(settings: Settings, store: Store, handleHash: string): OrderView | null {
  const request = store.channel?.requests[handleHash];
  if (!request) return null;
  if (request.refused !== undefined || request.booking === undefined) return { status: "refused", reason: request.refused ?? "unknown", channel: request.channel };
  const o = store.orders.get(request.booking);
  if (!o || o.handle !== handleHash) return null;
  const status = STATUS[o.state];
  const items = publicItems(settings);
  const pay = status === "held" ? payOf(settings, store, o) : undefined;
  return {
    status, ref: o.id, ...(o.channel ? { channel: o.channel } : {}),
    lines: o.lines.map((l) => ({ itemId: l.itemId, names: items.find((i) => i.id === l.itemId)?.names ?? (Object.fromEntries(LANGUAGES.map((x) => [x, l.itemId])) as Record<Language, string>), qty: l.qty, priceInr: itemOf(settings, l.itemId)?.priceInr ?? 0 })),
    ...(o.totalInr !== undefined ? { totalInr: o.totalInr } : {}), ...(o.advanceInr !== undefined ? { advanceInr: o.advanceInr } : {}),
    ...(o.date ? { date: isoOf(o.date) } : {}), ...(o.mode ? { mode: o.mode } : {}),
    ...(o.slotId && o.slotStartMs !== undefined && o.slotEndMs !== undefined ? { slot: { id: o.slotId, fromMs: o.slotStartMs, toMs: o.slotEndMs } } : {}),
    ...(o.area ? { area: o.area } : {}),
    ...(status === "held" && o.holdExpiresAt !== undefined ? { holdExpiresAt: o.holdExpiresAt } : {}),
    ...(pay ? { pay } : {}),
    // what the WhatsApp "cancel" takes (agent.ts onCancel): one waiting for the owner or its advance ends at once; a confirmed one follows the cancellation window
    canCancel: status === "checking" || status === "held" || status === "confirmed",
    canSayPaid: status === "held" && pay?.kind === "upi",
    messages: (store.channel?.outbox ?? []).filter((m) => m.to === o.customer).map((m) => ({ atMs: m.atMs, text: m.text })),
  };
}

/** What waits for the owner, as the owner's page shows it and the agent checks a press against. `code` is for the agent only and is never sent out (ownerView). */
export interface OwnerItem {
  kind: "deposit" | "refund_owed" | "late_refund" | "big_order";
  case: string;
  /** The digest of exactly what is shown: what it is, its amount and how far it has got. A press with another digest does nothing (agent.ts onOwnerAction). */
  digest: string;
  actions: OwnerActionName[];
  amountPaise: number;
  customer: { phone: string; name?: string };
  channel: "whatsapp" | "web" | "mcp";
  /** The order's lines, in the owner's language ("2 × Veg thali, 1 × Curd"); the slot is `startMs`. */
  what: string;
  startMs?: number;
  /** For a refund owed: why, in the template's words. */
  why?: string;
  /** The owner-marked one-use code the press stands for (the same the WhatsApp button carries). Never leaves the runtime. */
  code?: string;
}

const digestOf = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
/** How the owner knows a customer: the name and the number typed on the page (item 11h), else the WhatsApp number. Never the "web:..." conversation. */
export const customerOf = (o: Order | undefined, phone: string): { phone: string; name?: string } => (o?.contact ? { phone: o.contact.phone, ...(o.contact.name ? { name: o.contact.name } : {}) } : { phone });
const channelOf = (o: Order | undefined): OwnerItem["channel"] => o?.channel ?? "whatsapp";

/** The order in the owner's words: its lines from the shop's menu ("2 × Veg thali, 1 × Curd"). */
export const orderWhat = (settings: Settings, o: Order, language: Language = settings.owner.language): string =>
  o.lines.map((l) => { const item = itemOf(settings, l.itemId); return `${l.qty} × ${item ? itemName(item, language) : l.itemId}`; }).join(", ");

/**
 * Everything the owner can answer from their page: an advance to mark received (UPI), a refund the owner owes and marks sent (UPI), a big order to accept or refuse,
 * and a late cancellation's refund the agent asked about ("approve o-3" / "deny o-3"). Only what the agent would act on now: the first thing waiting on an order (the
 * agent answers `pending[0]`), and a mark request whose order still waits for its advance. And the confirmed orders of the coming week, for the owner's list.
 */
export function ownerItems(settings: Settings, store: Store, nowMs?: number): { items: OwnerItem[]; upcoming: { case: string; startMs: number; what: string; customer: { phone: string; name?: string }; channel: OwnerItem["channel"]; state: string }[] } {
  const items: OwnerItem[] = [];
  for (const r of store.upi?.requests ?? []) {
    const o = store.orders.get(r.reference);
    if (!o || o.state !== "awaiting_advance" || !r.code || (r.status !== "created" && r.status !== "partially_paid")) continue;
    const left = leftOn(r);
    items.push({ kind: "deposit", case: o.id, digest: digestOf(["advance", o.id, r.id, left, r.marks.length, r.usedCodes.length]), actions: ["received"], amountPaise: left, customer: customerOf(o, o.customer), channel: channelOf(o), what: orderWhat(settings, o), ...(o.slotStartMs !== undefined ? { startMs: o.slotStartMs } : {}), code: r.code });
  }
  for (const r of store.upi?.refunds ?? []) {
    if (r.state !== "owed" || !r.code) continue;
    const o = store.orders.get(r.caseId);
    items.push({ kind: "refund_owed", case: r.caseId, digest: digestOf(["refund_owed", r.caseId, r.id, r.amountPaise, r.keepAllowed === true, r.usedCodes.length]), actions: r.keepAllowed ? ["refunded", "kept"] : ["refunded"], amountPaise: r.amountPaise, customer: customerOf(o, r.customer), channel: channelOf(o), what: o ? orderWhat(settings, o) : "", ...(o?.slotStartMs !== undefined ? { startMs: o.slotStartMs } : {}), why: r.why, code: r.code });
  }
  for (const o of store.orders.values()) {
    const p = o.pending[0];
    if (!p) continue;
    const at = o.slotStartMs !== undefined ? { startMs: o.slotStartMs } : {};
    if (p.kind === "big_order") items.push({ kind: "big_order", case: o.id, digest: digestOf(["big_order", o.id, p.totalInr, p.askedAtMs]), actions: ["approve", "deny"], amountPaise: p.totalInr * 100, customer: customerOf(o, o.customer), channel: channelOf(o), what: orderWhat(settings, o), ...at });
    else if (p.kind === "refund") items.push({ kind: "late_refund", case: o.id, digest: digestOf(["late_refund", o.id, p.paymentId, p.amountInr * 100]), actions: ["approve", "deny"], amountPaise: p.amountInr * 100, customer: customerOf(o, o.customer), channel: channelOf(o), what: orderWhat(settings, o), ...at });
  }
  const now = nowMs ?? Date.now();
  const end = zonedToMs(addDays(localParts(now, settings.timezone), 8), { hour: 0, minute: 0 }, settings.timezone);
  const upcoming = [...store.orders.values()]
    .filter((o) => o.state === "confirmed" && o.slotStartMs !== undefined && o.slotStartMs >= now - 2 * 3_600_000 && o.slotStartMs < end)
    .sort((x, y) => (x.slotStartMs as number) - (y.slotStartMs as number)).slice(0, 50)
    .map((o) => ({ case: o.id, startMs: o.slotStartMs as number, what: `${orderWhat(settings, o)}${o.mode === "delivery" && o.area ? ` · ${o.area}` : ""}`, customer: customerOf(o, o.customer), channel: channelOf(o), state: o.state }));
  return { items, upcoming };
}

/** The owner's page's read: the items without their codes, the shop's name and the owner's language. Orders has no services: `what` names each order. */
export function ownerView(settings: Settings, store: Store, nowMs?: number) {
  const { items, upcoming } = ownerItems(settings, store, nowMs);
  return {
    shop: { name: settings.name, timezone: settings.timezone, ownerLanguage: settings.owner.language },
    kind: "orders" as const,
    services: [],
    items: items.map(({ code: _code, ...shown }) => shown),
    upcoming,
  };
}
