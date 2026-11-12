// The booking API's operations, once: list the services, the free times, start a booking, its payment instructions, its status, cancel it (and "I have paid", for the
// page). The JSON API (api.ts) and the MCP endpoint (mcp.ts) are two thin maps over these functions, so the two can never offer different things; a test checks that
// their lists match. Used by api.ts, mcp.ts and page.ts.
//
// Every change is an event to the shop's runtime (a channel_request), run as a step through the same agent, limits and Guards as a WhatsApp booking. Nothing here
// decides anything about a booking: it checks the shape of what was asked and passes it on. Times go out as ISO 8601 in the shop's own zone, money in whole rupees
// (the shop's settings are in rupees) and, for a payment, in paise as the UPI link carries it.
import { randomUUID } from "node:crypto";
import { localParts } from "../core/time.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { normaliseName, normalisePhone } from "./contact.ts";
import { HANDLE, handleHash, newHandle } from "./handle.ts";
import type { ChannelName } from "./handle.ts";
import type { BookingView, ChannelBackend, Offer, OfferService } from "./backend.ts";

/** The operations, by the names the API's paths and the MCP tools use. One list: api.ts and mcp.ts are both checked against it. */
export const OPERATIONS = ["list_services", "free_slots", "start_booking", "payment_instructions", "booking_status", "cancel_booking"] as const;
export type OperationName = (typeof OPERATIONS)[number];

/** A refusal with a stable code (for programs) and a plain sentence (for people). */
export class OpError extends Error {
  constructor(readonly code: "bad_request" | "not_found" | "paused" | "unavailable" | "too_many", message: string) { super(message); }
}

/** An epoch time as ISO 8601 in the shop's zone ("2026-11-14T16:00:00+05:30"), so a reader sees the shop's own clock. */
export function isoInZone(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  const offset = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60_000) * 60_000) / 60_000);
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** A start as given: ISO 8601 with a zone ("2026-11-14T16:00:00+05:30" or "...Z"), or epoch milliseconds. Undefined for anything else or a time not on a whole minute. */
export function parseStart(raw: unknown): number | undefined {
  const ms = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(raw) ? Date.parse(raw) : NaN;
  return Number.isInteger(ms) && ms > 0 && ms % 60_000 === 0 ? ms : undefined;
}

const languageOf = (raw: unknown, shop: Offer["shop"]): Language => (LANGUAGES.includes(raw as Language) && shop.languages.includes(raw as Language) ? raw as Language : shop.languages[0]);
const serviceOut = (s: OfferService, language: Language) => ({ id: s.id, name: s.names[language], names: s.names, price_inr: s.priceInr, duration_minutes: s.durationMinutes });

export interface OpsContext {
  backend: ChannelBackend;
  /** https://<server>/s/<shop>: the base of every address an answer gives. */
  publicUrl: string;
  channel: ChannelName;
  /** How long start_booking and cancel_booking wait for the step's outcome before answering "pending". */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The operations over one shop's runtime. */
export function createOps(ctx: OpsContext) {
  const sleep = ctx.sleep ?? pause;
  const waitMs = ctx.waitMs ?? 5_000;

  async function shopOffer(): Promise<Offer> { return ctx.backend.offer({}); }

  function bookingOut(handle: string, v: BookingView, timeZone: string, language: Language) {
    const statusUrl = `${ctx.publicUrl}/b/${handle}`;
    if (v.status === "pending" || v.status === "not_done") return { handle, status: v.status, status_url: statusUrl };
    if (v.status === "refused") return { handle, status: "refused", reason: v.reason, status_url: statusUrl };
    return {
      handle, status: v.status, ref: v.ref, status_url: statusUrl,
      ...(v.service ? { service: serviceOut(v.service, language) } : {}),
      ...(v.startMs !== undefined ? { start: isoInZone(v.startMs, timeZone), ...(v.endMs !== undefined ? { end: isoInZone(v.endMs, timeZone) } : {}) } : {}),
      deposit_inr: v.depositInr,
      ...(v.holdExpiresAt !== undefined ? { hold_expires_at: isoInZone(v.holdExpiresAt, timeZone) } : {}),
      can_cancel: v.canCancel,
      messages: v.messages.map((m) => ({ at: isoInZone(m.atMs, timeZone), text: m.text })),
    };
  }

  /** The booking with this handle; a wrong handle is "not found", whatever the reason, so nothing can be learned by trying. */
  async function viewOf(handle: string): Promise<BookingView> {
    if (!HANDLE.test(handle)) throw new OpError("not_found", "No booking has this handle.");
    const v = await ctx.backend.view(handleHash(handle));
    if (!v) throw new OpError("not_found", "No booking has this handle.");
    return v;
  }

  /** Wait a little for the step to run, so the answer says what happened rather than "pending". */
  async function settle(handle: string, until: (v: BookingView) => boolean): Promise<BookingView> {
    const deadline = Date.now() + waitMs;
    let v = await ctx.backend.view(handleHash(handle));
    while ((!v || !until(v)) && Date.now() < deadline) { await sleep(250); v = await ctx.backend.view(handleHash(handle)); }
    return v ?? { status: "pending" };
  }

  return {
    async list_services(args: { language?: string } = {}) {
      const offer = await shopOffer();
      const language = languageOf(args.language, offer.shop);
      return {
        shop: { name: offer.shop.name, ...(offer.shop.address ? { address: offer.shop.address } : {}), timezone: offer.shop.timezone, languages: offer.shop.languages },
        services: offer.services.map((s) => serviceOut(s, language)),
        deposit_inr: offer.shop.deposit.amountInr, hold_minutes: offer.shop.deposit.holdMinutes, cancellation_window_hours: offer.shop.cancellation.windowHours,
        payment: offer.shop.payment.kind === "upi" ? { kind: "upi", payee: offer.shop.payment.payee, confirmed_by: "the owner, who checks their UPI app" } : { kind: "link" },
        paused: offer.shop.paused,
      };
    },

    async free_slots(args: { service_id?: unknown; date?: unknown; days?: unknown }) {
      if (typeof args.service_id !== "string") throw new OpError("bad_request", "Give service_id: one of the ids list_services gives.");
      if (args.date !== undefined && (typeof args.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(args.date))) throw new OpError("bad_request", "date is YYYY-MM-DD in the shop's zone.");
      const days = args.days === undefined ? 7 : Number(args.days);
      if (!Number.isInteger(days) || days < 1 || days > 14) throw new OpError("bad_request", "days is 1 to 14.");
      const offer = await ctx.backend.offer({ serviceId: args.service_id, ...(typeof args.date === "string" ? { fromDate: args.date } : {}), days });
      if (offer.serviceId !== args.service_id) throw new OpError("not_found", "The shop has no service with that id.");
      if (offer.calendarUnread) throw new OpError("unavailable", "The shop's free times could not be read just now. Try again in a minute.");
      const tz = offer.shop.timezone;
      return { service_id: args.service_id, timezone: tz, paused: offer.shop.paused, days: (offer.days ?? []).map((d) => ({ date: d.date, slots: d.starts.map((s) => ({ start: isoInZone(s, tz), start_ms: s })) })) };
    },

    async start_booking(args: { service_id?: unknown; start?: unknown; name?: unknown; phone?: unknown; language?: unknown }) {
      if (typeof args.service_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(args.service_id)) throw new OpError("bad_request", "Give service_id: one of the ids list_services gives.");
      const startMs = parseStart(args.start);
      if (startMs === undefined) throw new OpError("bad_request", "Give start as one of the times free_slots gives (ISO 8601 with its zone).");
      const name = normaliseName(args.name);
      if (!name) throw new OpError("bad_request", "Give the customer's name: 1 to 60 letters.");
      const phone = normalisePhone(args.phone);
      if (!phone) throw new OpError("bad_request", "Give the customer's phone number: an Indian mobile number, or another country's in full with +.");
      const offer = await shopOffer();
      if (offer.shop.paused) throw new OpError("paused", "Online booking is paused just now: the customer should contact the shop.");
      const handle = newHandle();
      await ctx.backend.submit([{ kind: "channel_request", id: randomUUID(), channel: ctx.channel, op: "book", handle: handleHash(handle), serviceId: args.service_id, startMs, name, phone, language: languageOf(args.language, offer.shop) }]);
      const v = await settle(handle, (x) => x.status !== "pending");
      return bookingOut(handle, v, offer.shop.timezone, languageOf(args.language, offer.shop));
    },

    async payment_instructions(args: { handle?: unknown }) {
      const handle = typeof args.handle === "string" ? args.handle : "";
      const v = await viewOf(handle);
      const offer = await shopOffer();
      if (!("pay" in v) || !v.pay) return { handle, status: v.status, payment: null, note: v.status === "booked" ? "The deposit is paid and the booking is confirmed." : "Nothing is to be paid for this booking now." };
      if (v.pay.kind === "link") return { handle, status: v.status, payment: { kind: "link", url: v.pay.url, amount_inr: v.depositInr }, note: "Pay on the shop's payment link; the booking is confirmed when the payment provider reports it." };
      return {
        handle, status: v.status,
        payment: { kind: "upi", upi_link: v.pay.link, pay_to: { upi_id: v.pay.payTo.id, name: v.pay.payTo.name }, amount_inr: v.pay.leftPaise / 100, amount_paise: v.pay.leftPaise, note: v.pay.note, ...(v.holdExpiresAt !== undefined ? { pay_before: isoInZone(v.holdExpiresAt, offer.shop.timezone) } : {}) },
        note: "The customer pays from their own UPI app to the shop's UPI ID. The owner checks their UPI app and marks it received; only then is the booking confirmed. An assistant cannot mark a payment received.",
      };
    },

    async booking_status(args: { handle?: unknown; language?: unknown }) {
      const handle = typeof args.handle === "string" ? args.handle : "";
      const v = await viewOf(handle);
      const offer = await shopOffer();
      return bookingOut(handle, v, offer.shop.timezone, languageOf(args.language, offer.shop));
    },

    async cancel_booking(args: { handle?: unknown; language?: unknown }) {
      const handle = typeof args.handle === "string" ? args.handle : "";
      const before = await viewOf(handle);
      const offer = await shopOffer();
      if (!("canCancel" in before) || !before.canCancel) return { ...bookingOut(handle, before, offer.shop.timezone, languageOf(args.language, offer.shop)), cancelled: false, note: "This booking cannot be cancelled now." };
      await ctx.backend.submit([{ kind: "channel_request", id: randomUUID(), channel: ctx.channel, op: "cancel", handle: handleHash(handle) }]);
      const v = await settle(handle, (x) => x.status !== before.status || ("messages" in x && x.messages.length !== before.messages.length));
      return { ...bookingOut(handle, v, offer.shop.timezone, languageOf(args.language, offer.shop)), note: "The cancellation follows the shop's rule: inside its window the deposit comes back; later, the owner decides." };
    },

    /** The page's "I have paid" (not an API operation for assistants): the owner is asked to look; nothing is marked paid. */
    async say_paid(handle: string) {
      const v = await viewOf(handle);
      if (!("canSayPaid" in v) || !v.canSayPaid) return false;
      await ctx.backend.submit([{ kind: "channel_request", id: randomUUID(), channel: ctx.channel, op: "paid", handle: handleHash(handle) }]);
      return true;
    },
  };
}
export type Ops = ReturnType<typeof createOps>;
