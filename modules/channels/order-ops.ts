// Item 11h: an Orders shop's operations, once: list the items (with the days, the slots and what is left), start an order, its payment instructions, its status, cancel
// it (and "I have paid", for the page). The JSON API (api.ts ORDER_API_ROUTES) and the MCP endpoint (mcp.ts ORDER_TOOLS) are two thin maps over these functions, as
// Bookings' are over ops.ts, so the two can never offer different things; a test checks that their lists match. Used by api.ts, mcp.ts and front-orders.ts.
//
// Every change is an event to the shop's runtime (a channel_request), run as a step through the Orders agent's own `proceed`: the same size, cut-off, stock, day-count
// and big-order checks, the same hold and advance and the same Guards as a WhatsApp order. Nothing here decides anything about an order and nothing here prices one:
// it checks the shape of what was asked and passes on item ids and quantities; every price comes from the shop's settings in the runtime. No operation can mark a
// payment received or approve a refund: only the owner can, from their own number or their page.
import { randomUUID } from "node:crypto";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { normaliseName, normalisePhone } from "./contact.ts";
import { ADDRESS_MAX, ORDER_LINES_MAX, ORDER_QTY_MAX } from "./events.ts";
import { HANDLE, handleHash, newHandle } from "./handle.ts";
import { OpError, isoInZone } from "./ops.ts";
import type { OpsContext } from "./ops.ts";
import type { OfferItem, OrderOffer, OrderView } from "./backend.ts";

/** The operations, by the names the API's paths and the MCP tools use. One list: api.ts and mcp.ts are both checked against it. */
export const ORDER_OPERATIONS = ["list_items", "start_order", "payment_instructions", "order_status", "cancel_order"] as const;
export type OrderOperationName = (typeof ORDER_OPERATIONS)[number];

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const languageOf = (raw: unknown, shop: OrderOffer["shop"]): Language => (LANGUAGES.includes(raw as Language) && shop.languages.includes(raw as Language) ? raw as Language : shop.languages[0]);
const itemOut = (i: OfferItem, language: Language) => ({ id: i.id, name: i.names[language], names: i.names, price_inr: i.priceInr });

/** An order's lines as given (`items: [{item_id, qty}]`), checked for shape only; the runtime checks each against the shop's menu and limits. */
export function linesOf(raw: unknown): { itemId: string; qty: number }[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > ORDER_LINES_MAX) return undefined;
  const lines: { itemId: string; qty: number }[] = [];
  for (const l of raw) {
    const id = typeof l === "object" && l !== null ? (l as Record<string, unknown>).item_id : undefined;
    const qty = typeof l === "object" && l !== null ? (l as Record<string, unknown>).qty : undefined;
    if (typeof id !== "string" || !ID.test(id) || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > ORDER_QTY_MAX || lines.some((x) => x.itemId === id)) return undefined;
    lines.push({ itemId: id, qty });
  }
  return lines;
}

/** The operations over one Orders shop's runtime. `orderOffer` and `orderView` are the backend's (backend.ts runtimeBackend). */
export function createOrderOps(ctx: OpsContext) {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = ctx.waitMs ?? 5_000;
  const offerOf = async (): Promise<OrderOffer> => {
    if (!ctx.backend.orderOffer) throw new OpError("unavailable", "This shop takes no orders here.");
    return ctx.backend.orderOffer();
  };
  const viewNow = async (handle: string): Promise<OrderView | null> => (ctx.backend.orderView ? ctx.backend.orderView(handleHash(handle)) : null);

  function orderOut(handle: string, v: OrderView, offer: OrderOffer, language: Language) {
    const statusUrl = `${ctx.publicUrl}/order/${handle}`;
    const tz = offer.shop.timezone;
    if (v.status === "pending" || v.status === "not_done") return { handle, status: v.status, status_url: statusUrl };
    if (v.status === "refused") return { handle, status: "refused", reason: v.reason, status_url: statusUrl };
    return {
      handle, status: v.status, ref: v.ref, status_url: statusUrl,
      items: v.lines.map((l) => ({ item_id: l.itemId, name: l.names[language], qty: l.qty, price_inr: l.priceInr })),
      ...(v.totalInr !== undefined ? { total_inr: v.totalInr } : {}), ...(v.advanceInr !== undefined ? { advance_inr: v.advanceInr } : {}),
      ...(v.date ? { date: v.date } : {}), ...(v.mode ? { way: v.mode } : {}),
      ...(v.slot ? { slot: { id: v.slot.id, from: isoInZone(v.slot.fromMs, tz), to: isoInZone(v.slot.toMs, tz) } } : {}),
      ...(v.area ? { area: v.area } : {}),
      ...(v.holdExpiresAt !== undefined ? { hold_expires_at: isoInZone(v.holdExpiresAt, tz) } : {}),
      can_cancel: v.canCancel,
      messages: v.messages.map((m) => ({ at: isoInZone(m.atMs, tz), text: m.text })),
    };
  }

  /** The order with this handle; a wrong handle is "not found", whatever the reason, so nothing can be learned by trying. */
  async function viewOf(handle: string): Promise<OrderView> {
    if (!HANDLE.test(handle)) throw new OpError("not_found", "No order has this handle.");
    const v = await viewNow(handle);
    if (!v) throw new OpError("not_found", "No order has this handle.");
    return v;
  }

  /** Wait a little for the step to run, so the answer says what happened rather than "pending". */
  async function settle(handle: string, until: (v: OrderView) => boolean): Promise<OrderView> {
    const deadline = Date.now() + waitMs;
    let v = await viewNow(handle);
    while ((!v || !until(v)) && Date.now() < deadline) { await sleep(250); v = await viewNow(handle); }
    return v ?? { status: "pending" };
  }

  return {
    async list_items(args: { language?: unknown } = {}) {
      const offer = await offerOf();
      const language = languageOf(args.language, offer.shop);
      const tz = offer.shop.timezone;
      return {
        shop: { name: offer.shop.name, ...(offer.shop.address ? { address: offer.shop.address } : {}), timezone: tz, languages: offer.shop.languages },
        items: offer.items.map((i) => itemOut(i, language)),
        days: offer.days.map((d) => ({ date: d.date, full: d.full, left: d.left, slots: d.slots.map((s) => ({ id: s.id, way: s.mode, from: isoInZone(s.fromMs, tz), to: isoInZone(s.toMs, tz), open: s.open })) })),
        ways: { pickup: true, ...(offer.delivery ? { delivery: { areas: offer.delivery.areas } } : {}) },
        advance: { mode: offer.shop.advance.mode, ...(offer.shop.advance.mode === "part" ? { percent: offer.shop.advance.percent } : {}), hold_minutes: offer.shop.advance.holdMinutes },
        cancellation_window_hours: offer.shop.cancellation.windowHours, max_items_per_order: offer.maxItemsPerOrder,
        payment: offer.shop.payment.kind === "upi" ? { kind: "upi", payee: offer.shop.payment.payee, confirmed_by: "the owner, who checks their UPI app" } : { kind: "link" },
        paused: offer.shop.paused,
      };
    },

    /** `fixed`: the page's form gives the handle it made from its nonce (handle.ts handleFromNonce), so the same form sent twice is one order. */
    async start_order(args: { items?: unknown; date?: unknown; way?: unknown; slot_id?: unknown; address?: unknown; name?: unknown; phone?: unknown; language?: unknown }, fixed?: { handle: string }) {
      const lines = linesOf(args.items);
      if (!lines) throw new OpError("bad_request", `Give items: 1 to ${ORDER_LINES_MAX} of {item_id, qty}, each item once, qty 1 to ${ORDER_QTY_MAX}; item_id from list_items.`);
      if (typeof args.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(args.date)) throw new OpError("bad_request", "Give date: one of the days list_items gives (YYYY-MM-DD).");
      if (args.way !== "pickup" && args.way !== "delivery") throw new OpError("bad_request", 'Give way: "pickup" or "delivery".');
      if (typeof args.slot_id !== "string" || !ID.test(args.slot_id)) throw new OpError("bad_request", "Give slot_id: one of that day's slots from list_items.");
      const address = typeof args.address === "string" ? args.address.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, ADDRESS_MAX) : "";
      if (args.way === "delivery" && !address) throw new OpError("bad_request", "Give address for a delivery: it must name a place on the shop's delivery list.");
      const name = normaliseName(args.name);
      if (!name) throw new OpError("bad_request", "Give the customer's name: 1 to 60 letters.");
      const phone = normalisePhone(args.phone);
      if (!phone) throw new OpError("bad_request", "Give the customer's phone number: an Indian mobile number, or another country's in full with +.");
      const offer = await offerOf();
      if (offer.shop.paused) throw new OpError("paused", "Online ordering is paused just now: the customer should contact the shop.");
      const language = languageOf(args.language, offer.shop);
      const handle = fixed && HANDLE.test(fixed.handle) ? fixed.handle : newHandle();
      await ctx.backend.submit([{ kind: "channel_request", id: randomUUID(), channel: ctx.channel, op: "order", handle: handleHash(handle), lines, date: args.date, mode: args.way, slotId: args.slot_id, ...(args.way === "delivery" ? { address } : {}), name, phone, language }]);
      const v = await settle(handle, (x) => x.status !== "pending");
      return orderOut(handle, v, offer, language);
    },

    async payment_instructions(args: { handle?: unknown }) {
      const handle = typeof args.handle === "string" ? args.handle : "";
      const v = await viewOf(handle);
      const offer = await offerOf();
      const pay = "pay" in v ? v.pay : undefined;
      if (!pay) return { handle, status: v.status, payment: null, note: v.status === "confirmed" ? "The advance is paid and the order is confirmed." : "Nothing is to be paid for this order now." };
      if (pay.kind === "link") return { handle, status: v.status, payment: { kind: "link", url: pay.url, amount_inr: "advanceInr" in v ? v.advanceInr : undefined }, note: "Pay on the shop's payment link; the order is confirmed when the payment provider reports it." };
      return {
        handle, status: v.status,
        payment: { kind: "upi", upi_link: pay.link, pay_to: { upi_id: pay.payTo.id, name: pay.payTo.name }, amount_inr: pay.leftPaise / 100, amount_paise: pay.leftPaise, note: pay.note, ...("holdExpiresAt" in v && v.holdExpiresAt !== undefined ? { pay_before: isoInZone(v.holdExpiresAt, offer.shop.timezone) } : {}) },
        note: "The customer pays from their own UPI app to the shop's UPI ID. The owner checks their UPI app and marks it received; only then is the order confirmed. An assistant cannot mark a payment received.",
      };
    },

    async order_status(args: { handle?: unknown; language?: unknown }) {
      const handle = typeof args.handle === "string" ? args.handle : "";
      const v = await viewOf(handle);
      const offer = await offerOf();
      return orderOut(handle, v, offer, languageOf(args.language, offer.shop));
    },

    async cancel_order(args: { handle?: unknown; language?: unknown }) {
      const handle = typeof args.handle === "string" ? args.handle : "";
      const before = await viewOf(handle);
      const offer = await offerOf();
      const language = languageOf(args.language, offer.shop);
      if (!("canCancel" in before) || !before.canCancel) return { ...orderOut(handle, before, offer, language), cancelled: false, note: "This order cannot be cancelled now." };
      await ctx.backend.submit([{ kind: "channel_request", id: randomUUID(), channel: ctx.channel, op: "cancel", handle: handleHash(handle) }]);
      const v = await settle(handle, (x) => x.status !== before.status || ("messages" in x && x.messages.length !== before.messages.length));
      return { ...orderOut(handle, v, offer, language), note: "The cancellation follows the shop's rule: inside its window the advance comes back; later, the owner decides." };
    },

    /** The page's "I have paid" (not an operation for assistants): the owner is asked to look; nothing is marked paid. */
    async say_paid(handle: string) {
      const v = await viewOf(handle);
      if (!("canSayPaid" in v) || !v.canSayPaid) return false;
      await ctx.backend.submit([{ kind: "channel_request", id: randomUUID(), channel: ctx.channel, op: "paid", handle: handleHash(handle) }]);
      return true;
    },
  };
}
export type OrderOps = ReturnType<typeof createOrderOps>;
