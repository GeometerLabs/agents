// Item 11d: what Bookings' booking page, its API, the MCP endpoint and the owner's private page may READ, built from the shop's saved state and settings. Used by the
// runtime (server/runtime.ts, the channel kit) for the reads, and by the agent (src/agent.ts) to check that an owner's press matches what waits now.
//
// Everything here is an allowlist: a field is in a view because the page shows it. Never the owner's one-use code, never another customer, never a record line. The
// payment link and the shop's UPI ID are shown because the customer pays with them (they are on the WhatsApp message too).
import { createHash } from "node:crypto";
import { leftOn } from "../../../../modules/payments/owner-marked/ledger.ts";
import type { MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { OwnerActionName } from "../../../../modules/channels/events.ts";
import { addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { serviceName } from "./settings.ts";
import type { Settings } from "./settings.ts";
import type { Booking, Store } from "./booking.ts";

/** A service as the page shows it: its first name in each language, its price (the list price, the only price ever quoted) and how long it takes. */
export interface PublicService { id: string; names: Record<Language, string>; priceInr: number; durationMinutes: number }

export const publicServices = (settings: Settings): PublicService[] =>
  settings.services.map((s) => ({ id: s.id, names: Object.fromEntries(LANGUAGES.map((l) => [l, serviceName(s, l)])) as Record<Language, string>, priceInr: s.priceInr, durationMinutes: s.durationMinutes }));

/** What the page says about the shop and its rules. `paused`: the shop's licence takes no new bookings now. */
export function shopInfo(settings: Settings, paused: boolean) {
  const marked = ownerMarkedOf(settings.payment);
  return {
    name: settings.name, ...(settings.address ? { address: settings.address } : {}), timezone: settings.timezone, languages: settings.languages,
    deposit: { amountInr: settings.deposit.amountInr, holdMinutes: settings.deposit.holdMinutes },
    cancellation: { windowHours: settings.cancellation.windowHours },
    payment: marked ? { kind: "upi" as const, payee: marked.payTo.name } : { kind: "link" as const },
    paused,
    // item 11f: the customer view shows the week's hours (the same settings the agent books against)
    hours: settings.openingHours,
  };
}

/** A booking's state as its page says it. */
export type PublicStatus = "not_held" | "held" | "checking" | "booked" | "expired" | "cancelled" | "done";
const STATUS: Record<Booking["state"], PublicStatus> = {
  enquiry: "not_held", confirming_details: "not_held", awaiting_deposit: "held", needs_owner: "checking", confirmed: "booked", expired: "expired", cancelled: "cancelled", completed: "done",
};

const requestOf = (store: Store, b: Booking): MarkedRequest | undefined => store.upi?.requests.find((r) => r.id === b.linkId);

/**
 * One request by its handle's hash, as its own page may show it. Null when the store has none (the runtime then says whether its task is still waiting). A refused
 * request says only why, as a name the page words; a booking says its state, what it is for, how to pay while it is held, and the messages the agent gave it.
 */
export function bookingView(settings: Settings, store: Store, handleHash: string) {
  const request = store.channel?.requests[handleHash];
  // item 11h: a WhatsApp booking's own page, by the link last sent on WhatsApp (a newer one replaced any older, which then opens nothing)
  const byLink = request ? undefined : [...store.bookings.values()].find((x) => x.pageLink === handleHash && !x.channel);
  if (!request && !byLink) return null;
  const messages = (to: string) => (store.channel?.outbox ?? []).filter((m) => m.to === to).map((m) => ({ atMs: m.atMs, text: m.text }));
  if (request && (request.refused !== undefined || request.booking === undefined)) return { status: "refused" as const, reason: request.refused ?? "unknown", channel: request.channel };
  const b = byLink ?? store.bookings.get(request!.booking!);
  if (!b || (!byLink && b.handle !== handleHash)) return null;
  const status = STATUS[b.state];
  const service = settings.services.find((s) => s.id === b.serviceId);
  const marked = ownerMarkedOf(settings.payment);
  let pay: { kind: "upi"; link: string; payTo: { id: string; name: string }; amountPaise: number; leftPaise: number; note: string } | { kind: "link"; url: string } | undefined;
  if (status === "held") {
    const r = marked ? requestOf(store, b) : undefined;
    // after a part was marked, the link (and its QR) asks for what is left, the same amount the page states; a whole deposit keeps the request's own link
    if (marked && r) { const left = leftOn(r); pay = { kind: "upi", link: left > 0 && left < r.amountPaise ? marked.payLink({ amountPaise: left, note: r.reference }) : r.link, payTo: marked.payTo, amountPaise: r.amountPaise, leftPaise: left, note: r.reference }; }
    else if (!marked && b.linkUrl) pay = { kind: "link", url: b.linkUrl };
  }
  return {
    status, ref: b.id, channel: b.channel,
    ...(service ? { service: publicServices({ ...settings, services: [service] })[0] } : {}),
    ...(b.startMs !== undefined ? { startMs: b.startMs, endMs: b.endMs } : {}),
    depositInr: b.depositInr ?? settings.deposit.amountInr,
    ...(status === "held" && b.holdExpiresAt !== undefined ? { holdExpiresAt: b.holdExpiresAt } : {}),
    ...(pay ? { pay } : {}),
    // a WhatsApp booking's page shows and lets the customer pay; cancelling and "I have paid" stay on WhatsApp, where the customer is known by their number
    canCancel: !byLink && (status === "held" || status === "booked" || status === "checking"),
    canSayPaid: !byLink && status === "held" && pay?.kind === "upi",
    // its messages are WhatsApp's, not kept here: the page shows none of them
    messages: byLink ? [] : messages(b.customer),
    ...refundOf(store, b),
  };
}

/**
 * Item 11h (decision 45): a refund on this booking as the record holds it, for its own page (a customer without WhatsApp sees it there): the owner's call on a late
 * cancellation still open ("asked"), and on a UPI shop the refund the owner owes ("owed"), marked sent ("sent") or kept ("kept"). The newest refund counts.
 */
function refundOf(store: Store, b: Booking): { refund?: { state: "asked" | "owed" | "sent" | "kept"; amountInr: number } } {
  const owed = (store.upi?.refunds ?? []).filter((r) => r.caseId === b.id).at(-1);
  if (owed) return { refund: { state: owed.state === "done" ? "sent" : owed.state === "kept" ? "kept" : "owed", amountInr: owed.amountPaise / 100 } };
  const asked = b.pending.find((p) => p.kind === "refund");
  return asked && asked.kind === "refund" ? { refund: { state: "asked", amountInr: asked.amountInr } } : {};
}

/** What waits for the owner, as the owner's page shows it and the agent checks a press against. `code` is for the agent only and is never sent out (ownerView). */
export interface OwnerItem {
  kind: "deposit" | "refund_owed" | "late_refund" | "calendar";
  case: string;
  /** The digest of exactly what is shown: what it is, its amount and how far it has got. A press with another digest does nothing (agent.ts onOwnerAction). */
  digest: string;
  actions: OwnerActionName[];
  amountPaise: number;
  customer: { phone: string; name?: string };
  channel: "whatsapp" | "web" | "mcp";
  serviceId?: string;
  startMs?: number;
  /** For a refund owed: why, in the template's words ("cancelled", ...). */
  why?: string;
  /** The owner-marked one-use code the press stands for (the same the WhatsApp button carries). Never leaves the runtime. */
  code?: string;
}

const digestOf = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const customerOf = (b: Booking | undefined, phone: string) => (b?.contact ? { phone: b.contact.phone, ...(b.contact.name ? { name: b.contact.name } : {}) } : { phone });
const channelOf = (b: Booking | undefined): OwnerItem["channel"] => b?.channel ?? "whatsapp";

/**
 * Everything the owner can answer from their page: a deposit to mark received (UPI), a refund the owner owes and marks sent (UPI), a late cancellation's refund the agent
 * asked about ("approve b-3" / "deny b-3"), and a paid booking the calendar would not confirm ("retry b-3" / "approve b-3" to cancel and refund). Only what the agent
 * would act on now: the first thing waiting on a booking (the agent answers `pending[0]`), and a mark request whose booking still waits for its deposit.
 * And the coming bookings of the next seven days, for an owner who has no WhatsApp day list.
 */
export function ownerItems(settings: Settings, store: Store, nowMs?: number): { items: OwnerItem[]; upcoming: { case: string; startMs: number; serviceId?: string; customer: { phone: string; name?: string }; channel: OwnerItem["channel"]; state: string }[] } {
  const items: OwnerItem[] = [];
  for (const r of store.upi?.requests ?? []) {
    const b = store.bookings.get(r.reference);
    if (!b || b.state !== "awaiting_deposit" || !r.code || (r.status !== "created" && r.status !== "partially_paid")) continue;
    const left = leftOn(r);
    items.push({ kind: "deposit", case: b.id, digest: digestOf(["deposit", b.id, r.id, left, r.marks.length, r.usedCodes.length]), actions: ["received"], amountPaise: left, customer: customerOf(b, b.customer), channel: channelOf(b), ...(b.serviceId ? { serviceId: b.serviceId } : {}), ...(b.startMs !== undefined ? { startMs: b.startMs } : {}), code: r.code });
  }
  for (const r of store.upi?.refunds ?? []) {
    if (r.state !== "owed" || !r.code) continue;
    const b = store.bookings.get(r.caseId);
    items.push({ kind: "refund_owed", case: r.caseId, digest: digestOf(["refund_owed", r.caseId, r.id, r.amountPaise, r.keepAllowed === true, r.usedCodes.length]), actions: r.keepAllowed ? ["refunded", "kept"] : ["refunded"], amountPaise: r.amountPaise, customer: customerOf(b, r.customer), channel: channelOf(b), ...(b?.serviceId ? { serviceId: b.serviceId } : {}), ...(b?.startMs !== undefined ? { startMs: b.startMs } : {}), why: r.why, code: r.code });
  }
  for (const b of store.bookings.values()) {
    const p = b.pending[0];
    if (!p) continue;
    const at = { ...(b.serviceId ? { serviceId: b.serviceId } : {}), ...(b.startMs !== undefined ? { startMs: b.startMs } : {}) };
    if (p.kind === "refund") items.push({ kind: "late_refund", case: b.id, digest: digestOf(["late_refund", b.id, p.paymentId, p.amountInr * 100]), actions: ["approve", "deny"], amountPaise: p.amountInr * 100, customer: customerOf(b, b.customer), channel: channelOf(b), ...at });
    else if (p.kind === "calendar" && b.depositInr !== undefined) items.push({ kind: "calendar", case: b.id, digest: digestOf(["calendar", b.id, b.depositPaymentId ?? "", b.startMs ?? 0]), actions: ["retry", "approve"], amountPaise: b.depositInr * 100, customer: customerOf(b, b.customer), channel: channelOf(b), ...at });
  }
  const now = nowMs ?? Date.now();
  const end = zonedToMs(addDays(localParts(now, settings.timezone), 8), { hour: 0, minute: 0 }, settings.timezone);
  const upcoming = [...store.bookings.values()]
    .filter((b) => (b.state === "confirmed" || b.state === "needs_owner") && b.startMs !== undefined && b.startMs >= now - 2 * 3_600_000 && b.startMs < end)
    .sort((x, y) => (x.startMs as number) - (y.startMs as number)).slice(0, 50)
    .map((b) => ({ case: b.id, startMs: b.startMs as number, ...(b.serviceId ? { serviceId: b.serviceId } : {}), customer: customerOf(b, b.customer), channel: channelOf(b), state: b.state }));
  return { items, upcoming };
}

/** The owner's page's read: the items without their codes, the services' names, and the shop's name and the owner's language. */
export function ownerView(settings: Settings, store: Store, nowMs?: number) {
  const { items, upcoming } = ownerItems(settings, store, nowMs);
  return {
    shop: { name: settings.name, timezone: settings.timezone, ownerLanguage: settings.owner.language },
    services: publicServices(settings),
    items: items.map(({ code: _code, ...shown }) => shown),
    upcoming,
  };
}
