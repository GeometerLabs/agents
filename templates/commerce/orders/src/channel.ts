// Item 11h: what Orders' part of the shop page, its API, the MCP endpoint and the owner's page may READ, built from the shop's saved state and settings. Used by the
// runtime (go/internal/orders, the Go runtime, the channel kit) for the reads, by the agent (src/agent.ts) to check that an owner's press matches what waits now, and by the assistant's
// skill (src/assistant.ts), so "what needs me", the owner's page and the mood always list the same things. The pattern is Bookings' (templates/commerce/bookings/src/
// channel.ts).
//
// Everything here is an allowlist: a field is in a view because the page shows it. Never the owner's one-use code, never another customer, never a record line, and
// never the delivery address as typed (only its place on the shop's list). Prices are the shop's own, from the settings: nothing in a view is worked out from what a
// customer sent.
import { planName, planTypeOf } from "./plans/settings.ts";
import { createHash } from "node:crypto";
import { leftOn } from "../../../../modules/payments/owner-marked/ledger.ts";
import type { MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { OwnerActionName } from "../../../../modules/channels/events.ts";
import type { OrderOffer, OrderView, PayInstructions } from "../../../../modules/channels/backend.ts";
import { addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { formatDate } from "../../../../modules/language/format.ts";
import { caseDocuments } from "../../../../modules/accounting/case-documents.ts";
import type { DocumentsKey } from "../../../../modules/accounting/case-documents.ts";
import { accountantFiles } from "../../../../modules/accounting/export.ts";
import { ownerMoney } from "../../../../modules/accounting/owner-money.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { ordersJournal } from "./accounting.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { allSlots, itemName, itemOf } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { isChatConversation } from "../../../../modules/channels/conversation.ts";
import { guestLabel } from "../../../../modules/channels/chat-guest.ts";
import { countedLeft, fixSlot, itemsText, ordersInSlot, ordersOn, takenOf } from "./order.ts";
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
    // a slot with a limit of its own (`maxOrders`) that is full for the day is not open: the page cannot offer what the agent would refuse (agent.ts availability)
    const slots = allSlots(settings).map(({ slot }) => { const at = slotOn(settings, date, slot.id); const full = slot.maxOrders !== undefined && ordersInSlot(store, date, slot.id, nowMs) >= slot.maxOrders; return { id: slot.id, mode: at.mode, fromMs: at.fromMs, toMs: at.toMs, open: at.cutoffMs > nowMs && !full }; });
    const left = Object.fromEntries(settings.menu.map((i) => [i.id, Math.min(Math.max(0, i.dailyStock - takenOf(store, date, i.id, nowMs)), countedLeft(store, i.id, nowMs) ?? Infinity)]));
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
 * The one lookup of a page's order by its handle's hash, shared by the page's own read (orderView) and its receipts (documentsOf), so they can never find different
 * orders. A refused request has no order; an order answers only to its own handle.
 */
function orderOf(store: Store, handleHash: string): Order | undefined {
  const request = store.channel?.requests[handleHash];
  const o = request && request.refused === undefined && request.booking !== undefined ? store.orders.get(request.booking) : undefined;
  return o && o.handle === handleHash ? o : undefined;
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
  const o = orderOf(store, handleHash);
  if (!o) return null;
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
    claimed: o.claimAtMs !== undefined, // money clarity: the customer has already said they paid
    messages: (store.channel?.outbox ?? []).filter((m) => m.to === o.customer).map((m) => ({ atMs: m.atMs, text: m.text })),
  };
}

/** How long after a hold ended the owner's page still lists "money may have come": a UPI payment made as the time ran out (48 hours; 14 days after the customer said they paid). */
export const LATE_WINDOW_MS = 48 * 3_600_000;
export const LATE_CLAIM_WINDOW_MS = 14 * 24 * 3_600_000;

/**
 * An expired order whose UPI request is still open to a mark (its one-use code stays live after the hold ended, ledger.ts closeRequest) and has none: the customer may have
 * paid as the time ran out. Only a UPI shop has one. Bounded in time, so an old, forgotten hold is not listed for ever. The owner's "received" on it is the same mark as on
 * WhatsApp; after the close the agent treats it as the late mark (agent.ts lateMark): owed back, or kept for an order the owner takes by hand, never confirmed by itself.
 */
function lateRequest(store: Store, o: Order, nowMs: number): MarkedRequest | undefined {
  if (o.state !== "expired") return undefined;
  const r = requestOf(store, o);
  if (!r || !r.code || r.marks.length > 0 || o.advancePaymentId) return undefined;
  const since = o.claimAtMs !== undefined ? Math.max(o.claimAtMs, r.closedAtMs ?? 0) : (r.closedAtMs ?? 0);
  return nowMs - since < (o.claimAtMs !== undefined ? LATE_CLAIM_WINDOW_MS : LATE_WINDOW_MS) ? r : undefined;
}

/** What waits for the owner, as the owner's page shows it and the agent checks a press against. `code` is for the agent only and is never sent out (ownerView). */
export interface OwnerItem {
  kind: "deposit" | "late_deposit" | "refund_owed" | "late_refund" | "big_order";
  case: string;
  /** The digest of exactly what is shown: what it is, its amount and how far it has got. A press with another digest does nothing (agent.ts onOwnerAction). */
  digest: string;
  actions: OwnerActionName[];
  amountPaise: number;
  customer: { phone: string; name?: string };
  channel: "whatsapp" | "web" | "mcp" | "chat";
  /** The order's lines, in the owner's language ("2 × Veg thali, 1 × Curd"); the slot is `startMs`. */
  what: string;
  startMs?: number;
  /** For a refund owed: why, in the template's words. */
  why?: string;
  /** Money clarity: for a `deposit` or a `late_deposit` (a hold that ended where money may have come anyway: "time ran out"), when the customer said they paid and the UPI reference they typed (not in the digest: a customer's press must not stale the owner's). */
  claimedAtMs?: number;
  upiRef?: string;
  /** The owner-marked one-use code the press stands for (the same the WhatsApp button carries). Never leaves the runtime. */
  code?: string;
}

const digestOf = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
/** How the owner knows a customer: the name and the number typed on the page (item 11h), else the WhatsApp number. Never the "web:..." conversation. */
export const customerOf = (o: Order | undefined, phone: string): { phone: string; name?: string } => (o?.contact ? { phone: o.contact.phone, ...(o.contact.name ? { name: o.contact.name } : {}) } : { phone });
const plainCustomerOf = customerOf;
const plainChannelOf = (o: Order | undefined): OwnerItem["channel"] => o?.channel ?? "whatsapp";

/** The order in the owner's words: its lines from the shop's menu ("2 × Veg thali, 1 × Curd"). */
// 23 Nov 2026: a plan type no longer in the settings is named by its id (it threw), as an item no longer on the menu already was; Go's OrderWhat does the same.
export const orderWhat = (settings: Settings, o: Order, language: Language = settings.owner.language): string => {
  if (!o.plan) return itemsText(settings, o.lines, language);
  const type = planTypeOf(settings.plans, o.plan.typeId);
  return `${type ? planName(type, language) : o.plan.typeId} (monthly plan)`;
};

/**
 * Everything the owner can answer from their page: an advance to mark received (UPI), a refund the owner owes and marks sent (UPI), a big order to accept or refuse,
 * and a late cancellation's refund the agent asked about ("approve o-3" / "deny o-3"). Only what the agent would act on now: the first thing waiting on an order (the
 * agent answers `pending[0]`), and a mark request whose order still waits for its advance. And the confirmed orders of the coming week, for the owner's list.
 */
export function ownerItems(settings: Settings, store: Store, nowMs?: number): { items: OwnerItem[]; upcoming: { case: string; startMs: number; what: string; customer: { phone: string; name?: string }; channel: OwnerItem["channel"]; state: string }[] } {
  const items: OwnerItem[] = [];
  // 17 Nov 2026: a guest of the shop's chat is "Chat guest 3" to the owner (chat-guest.ts), never "chat:..."; their number is the words, so the page shows no phone for them
  const customerOf = (o: Order | undefined, phone: string): { phone: string; name?: string } => (isChatConversation(phone) ? { phone: "", name: guestLabel(store.channel, phone, settings.owner.language) } : plainCustomerOf(o, phone));
  const channelOf = (o: Order | undefined): OwnerItem["channel"] => (o && isChatConversation(o.customer) ? "chat" : plainChannelOf(o));
  for (const r of store.upi?.requests ?? []) {
    const o = store.orders.get(r.reference);
    if (!o || o.state !== "awaiting_advance" || !r.code || (r.status !== "created" && r.status !== "partially_paid")) continue;
    const left = leftOn(r);
    items.push({ kind: "deposit", case: o.id, digest: digestOf(["advance", o.id, r.id, left, r.marks.length, r.usedCodes.length]), actions: ["received"], amountPaise: left, customer: customerOf(o, o.customer), channel: channelOf(o), what: orderWhat(settings, o), ...(o.slotStartMs !== undefined ? { startMs: o.slotStartMs } : {}), ...(o.claimAtMs !== undefined ? { claimedAtMs: o.claimAtMs } : {}), ...(o.claimRef ? { upiRef: o.claimRef } : {}), code: r.code });
  }
  // money clarity (the "time ran out" card): a hold that ended where money may have come anyway
  const nowLate = nowMs ?? Date.now();
  for (const o of store.orders.values()) {
    const r = lateRequest(store, o, nowLate);
    if (!r?.code) continue;
    items.push({ kind: "late_deposit", case: o.id, digest: digestOf(["late_advance", o.id, r.id, r.amountPaise, r.usedCodes.length]), actions: ["received"], amountPaise: r.amountPaise, customer: customerOf(o, o.customer), channel: channelOf(o), what: orderWhat(settings, o), ...(o.slotStartMs !== undefined ? { startMs: o.slotStartMs } : {}), ...(o.claimAtMs !== undefined ? { claimedAtMs: o.claimAtMs } : {}), ...(o.claimRef ? { upiRef: o.claimRef } : {}), code: r.code });
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

/**
 * The documents (receipts, refund notes) of the order the page with this handle's hash opens, newest first, drawn in the page's language. The order is found by
 * `orderOf`, the page's own lookup, so another order's number is never among them. What each is for: the items and the day, in the customer's language.
 */
export function documentsOf(settings: Settings, store: Store, entries: readonly RecordEntry[], key: DocumentsKey, language: Language) {
  const o = "handle" in key ? orderOf(store, key.handle) : undefined;
  const whatFor = (caseId: string, l: Language): string => {
    const x = store.orders.get(caseId);
    return x ? [orderWhat(settings, x, l), x.date ? formatDate(x.date, l) : ""].filter(Boolean).join(", ") : "";
  };
  return caseDocuments({ journal: ordersJournal(entries), cases: o ? [o.id] : [], shop: { name: settings.name, address: settings.address ?? "", timezone: settings.timezone }, language, whatFor });
}

/**
 * The accountant's files for a period, from the record (modules/accounting/export.ts), with the two best-effort Tally files. No company name is put in them: the
 * accountant's Tally company may be named differently from the shop, so the import goes into the company that is open.
 */
export const exportFilesOf = (settings: Settings, entries: readonly RecordEntry[], period: string) =>
  accountantFiles({ journal: ordersJournal(entries), entries, period, timeZone: settings.timezone, tally: {} });

/**
 * The owner's page's read: the items without their codes, the shop's name and the owner's language, and the Money section's figures worked out from the record
 * (`entries`). Orders has no services: `what` names each order. A refund made whose customer was not told is passed with its order.
 */
export function ownerView(settings: Settings, store: Store, nowMs: number | undefined, entries: readonly RecordEntry[]) {
  const { items, upcoming } = ownerItems(settings, store, nowMs);
  return {
    shop: { name: settings.name, timezone: settings.timezone, ownerLanguage: settings.owner.language },
    kind: "orders" as const,
    services: [],
    items: items.map(({ code: _code, ...shown }) => shown),
    upcoming,
    money: ownerMoney({
      journal: ordersJournal(entries), entries, nowMs: nowMs ?? Date.now(), timeZone: settings.timezone,
      refundsUntold: [...store.orders.values()].flatMap((o) => (o.refundsUntold ?? []).map((u) => ({ case: o.id, amountInr: u.amountInr }))),
    }),
  };
}
