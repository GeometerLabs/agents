// Item 11d: what Bookings' booking page, its API, the MCP endpoint and the owner's private page may READ, built from the shop's saved state and settings. Used by the
// runtime (go/internal/bookings, the Go runtime, the channel kit) for the reads, and by the agent (src/agent.ts) to check that an owner's press matches what waits now.
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
import { formatSlot } from "../../../../modules/language/format.ts";
import { caseDocuments } from "../../../../modules/accounting/case-documents.ts";
import type { DocumentsKey } from "../../../../modules/accounting/case-documents.ts";
import { accountantFiles } from "../../../../modules/accounting/export.ts";
import { ownerMoney } from "../../../../modules/accounting/owner-money.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { bookingsJournal } from "./accounting.ts";
import { serviceName } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { isChatConversation } from "../../../../modules/channels/conversation.ts";
import { guestLabel } from "../../../../modules/channels/chat-guest.ts";
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
 * The one lookup of a page's booking by its handle's hash, shared by the page's own read (bookingView) and its receipts (documentsOf), so they can never find
 * different bookings: a web or MCP request's booking (whose own handle must match), or (item 11h) a WhatsApp booking's own page, by the link last sent on WhatsApp
 * (the last four links sent open it: a newer one no longer kills the one the customer already has open).
 */
function lookup(store: Store, handleHash: string) {
  const request = store.channel?.requests[handleHash];
  const byLink = request ? undefined : [...store.bookings.values()].find((x) => (x.pageLink === handleHash || x.pageLinksBefore?.includes(handleHash)) && !x.channel);
  const found = byLink ?? (request && request.refused === undefined && request.booking !== undefined ? store.bookings.get(request.booking) : undefined);
  return { request, byLink, booking: found && (byLink || found.handle === handleHash) ? found : undefined };
}

/**
 * One request by its handle's hash, as its own page may show it. Null when the store has none (the runtime then says whether its task is still waiting). A refused
 * request says only why, as a name the page words; a booking says its state, what it is for, how to pay while it is held, and the messages the agent gave it.
 */
export function bookingView(settings: Settings, store: Store, handleHash: string, nowMs: number = Date.now()) {
  const { request, byLink, booking } = lookup(store, handleHash);
  if (!request && !byLink) return null;
  const messages = (to: string) => (store.channel?.outbox ?? []).filter((m) => m.to === to).map((m) => ({ atMs: m.atMs, text: m.text }));
  if (request && (request.refused !== undefined || request.booking === undefined)) return { status: "refused" as const, reason: request.refused ?? "unknown", channel: request.channel };
  const b = booking;
  if (!b) return null;
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
    // money clarity: also after the hold ended, while the owner could still mark the request (lateClaimable): the customer may have paid as the time ran out
    canSayPaid: !byLink && ((status === "held" && pay?.kind === "upi") || (status === "expired" && lateClaimable(store, b, nowMs))),
    // the customer has already said they paid: the page says so, and the owner's page lists it first
    claimed: !byLink && b.claimAtMs !== undefined,
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

/** How long after a hold ended the owner's page still lists "money may have come", and the customer's page still takes "I have paid": a UPI payment made as the time ran out. */
export const LATE_WINDOW_MS = 48 * 3_600_000;
/** A claim made after the hold ended stays listed (and takeable) for longer: the owner may only see the payment in their UPI app days later. */
export const LATE_CLAIM_WINDOW_MS = 14 * 24 * 3_600_000;

/**
 * An expired booking whose UPI request is still open to a mark (its one-use code stays live after the hold ended, ledger.ts closeRequest) and has none: money may have
 * come as the time ran out. Only a UPI shop has one. Bounded in time so an old, forgotten hold is not listed forever.
 */
function lateRequest(store: Store, b: Booking, nowMs: number): MarkedRequest | undefined {
  if (b.state !== "expired") return undefined;
  const r = requestOf(store, b);
  if (!r || !r.code || r.marks.length > 0 || b.depositPaymentId) return undefined;
  const since = b.claimAtMs !== undefined ? Math.max(b.claimAtMs, r.closedAtMs ?? 0) : (r.closedAtMs ?? 0);
  return nowMs - since < (b.claimAtMs !== undefined ? LATE_CLAIM_WINDOW_MS : LATE_WINDOW_MS) ? r : undefined;
}
const lateClaimable = (store: Store, b: Booking, nowMs: number): boolean => lateRequest(store, b, nowMs) !== undefined;

/** What waits for the owner, as the owner's page shows it and the agent checks a press against. `code` is for the agent only and is never sent out (ownerView). */
export interface OwnerItem {
  kind: "deposit" | "late_deposit" | "refund_owed" | "late_refund" | "calendar";
  case: string;
  /** The digest of exactly what is shown: what it is, its amount and how far it has got. A press with another digest does nothing (agent.ts onOwnerAction). */
  digest: string;
  actions: OwnerActionName[];
  amountPaise: number;
  customer: { phone: string; name?: string };
  channel: "whatsapp" | "web" | "mcp" | "chat";
  serviceId?: string;
  startMs?: number;
  /** For a refund owed: why, in the template's words ("cancelled", ...). */
  why?: string;
  /**
   * Money clarity: when the customer said they paid, and the UPI reference they typed. NOT in the digest: a customer's press must not make the owner's own press stale.
   * A `late_deposit` is a hold that ended where money may have come anyway (listed for 48 hours, or 14 days after a claim); "received" on it is the late mark.
   */
  claimedAtMs?: number;
  upiRef?: string;
  /** The owner-marked one-use code the press stands for (the same the WhatsApp button carries). Never leaves the runtime. */
  code?: string;
}

const digestOf = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const plainCustomerOf = (b: Booking | undefined, phone: string) => (b?.contact ? { phone: b.contact.phone, ...(b.contact.name ? { name: b.contact.name } : {}) } : { phone });
const claimOf = (b: Booking): { claimedAtMs?: number; upiRef?: string } => ({ ...(b.claimAtMs !== undefined ? { claimedAtMs: b.claimAtMs } : {}), ...(b.claimRef ? { upiRef: b.claimRef } : {}) });
const plainChannelOf = (b: Booking | undefined): OwnerItem["channel"] => b?.channel ?? "whatsapp";

/**
 * Everything the owner can answer from their page: a deposit to mark received (UPI), a refund the owner owes and marks sent (UPI), a late cancellation's refund the agent
 * asked about ("approve b-3" / "deny b-3"), and a paid booking the calendar would not confirm ("retry b-3" / "approve b-3" to cancel and refund). Only what the agent
 * would act on now: the first thing waiting on a booking (the agent answers `pending[0]`), and a mark request whose booking still waits for its deposit.
 * And the coming bookings of the next seven days, for an owner who has no WhatsApp day list.
 */
export function ownerItems(settings: Settings, store: Store, nowMs?: number): { items: OwnerItem[]; upcoming: { case: string; startMs: number; serviceId?: string; customer: { phone: string; name?: string }; channel: OwnerItem["channel"]; state: string }[] } {
  const items: OwnerItem[] = [];
  // 17 Nov 2026: a guest of the shop's chat is "Chat guest 3" to the owner (chat-guest.ts), never "chat:..."; their number is the words, so the page shows no phone for them
  const customerOf = (b: Booking | undefined, phone: string): { phone: string; name?: string } => (isChatConversation(phone) ? { phone: "", name: guestLabel(store.channel, phone, settings.owner.language) } : plainCustomerOf(b, phone));
  const channelOf = (b: Booking | undefined): OwnerItem["channel"] => (b && isChatConversation(b.customer) ? "chat" : plainChannelOf(b));
  for (const r of store.upi?.requests ?? []) {
    const b = store.bookings.get(r.reference);
    if (!b || b.state !== "awaiting_deposit" || !r.code || (r.status !== "created" && r.status !== "partially_paid")) continue;
    const left = leftOn(r);
    items.push({ kind: "deposit", case: b.id, digest: digestOf(["deposit", b.id, r.id, left, r.marks.length, r.usedCodes.length]), actions: ["received"], amountPaise: left, customer: customerOf(b, b.customer), channel: channelOf(b), ...(b.serviceId ? { serviceId: b.serviceId } : {}), ...(b.startMs !== undefined ? { startMs: b.startMs } : {}), ...claimOf(b), code: r.code });
  }
  // money clarity: a hold that ended where money may have come anyway. The owner's "received" is the same mark as on WhatsApp; after the close it is the late mark
  // (agent.ts lateMark): owed back (with "keep" offered, for a booking made by hand), never booked again by itself. No ledger rule changes.
  const nowMs0 = nowMs ?? Date.now();
  for (const b of store.bookings.values()) {
    const r = lateRequest(store, b, nowMs0);
    if (!r?.code) continue;
    items.push({ kind: "late_deposit", case: b.id, digest: digestOf(["late_deposit", b.id, r.id, r.amountPaise, r.usedCodes.length]), actions: ["received"], amountPaise: r.amountPaise, customer: customerOf(b, b.customer), channel: channelOf(b), ...(b.serviceId ? { serviceId: b.serviceId } : {}), ...(b.startMs !== undefined ? { startMs: b.startMs } : {}), ...claimOf(b), code: r.code });
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

/**
 * The documents (receipts, refund notes) of the booking the page with this handle's hash opens, newest first, drawn in the page's language. The booking is found by
 * `lookup`, the page's own lookup, so another booking's number is never among them. What each document is for: the service and the slot, in the customer's language.
 */
export function documentsOf(settings: Settings, store: Store, entries: readonly RecordEntry[], key: DocumentsKey, language: Language) {
  const b = "handle" in key ? lookup(store, key.handle).booking : undefined;
  const whatFor = (caseId: string, l: Language): string => {
    const x = store.bookings.get(caseId);
    const service = settings.services.find((s) => s.id === x?.serviceId);
    return [service ? serviceName(service, l) : "", x?.startMs !== undefined ? formatSlot(x.startMs, settings.timezone, l) : ""].filter(Boolean).join(", ");
  };
  return caseDocuments({ journal: bookingsJournal(entries), cases: b ? [b.id] : [], shop: { name: settings.name, address: settings.address ?? "", timezone: settings.timezone }, language, whatFor });
}

/**
 * The accountant's files for a period, from the record (modules/accounting/export.ts), with the two best-effort Tally files. No company name is put in them: the
 * accountant's Tally company may be named differently from the shop, so the import goes into the company that is open.
 */
export const exportFilesOf = (settings: Settings, entries: readonly RecordEntry[], period: string) =>
  accountantFiles({ journal: bookingsJournal(entries), entries, period, timeZone: settings.timezone, tally: {} });

/**
 * The owner's page's read: the items without their codes, the services' names, the shop's name and the owner's language, and the Money section's figures worked out
 * from the record (`entries`). A refund made whose customer was not told is passed with its booking (an UntoldRefund has no case of its own).
 */
export function ownerView(settings: Settings, store: Store, nowMs: number | undefined, entries: readonly RecordEntry[]) {
  const { items, upcoming } = ownerItems(settings, store, nowMs);
  return {
    shop: { name: settings.name, timezone: settings.timezone, ownerLanguage: settings.owner.language },
    services: publicServices(settings),
    items: items.map(({ code: _code, ...shown }) => shown),
    upcoming,
    money: ownerMoney({
      journal: bookingsJournal(entries), entries, nowMs: nowMs ?? Date.now(), timeZone: settings.timezone,
      refundsUntold: [...store.bookings.values()].flatMap((b) => (b.refundsUntold ?? []).map((u) => ({ case: b.id, amountInr: u.amountInr }))),
    }),
  };
}
