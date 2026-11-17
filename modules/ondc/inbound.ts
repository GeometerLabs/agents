// Inbound: a Beckn or ONDC request (select, init, confirm, cancel) to the neutral intent a template's own flow would act on: the lines and quantities, the way and slot, the
// customer's contact, the cancellation reason in our words.
//
// The rule that shapes it: an incoming message is a CLAIM, never a fact. Whatever totals, prices or times it carries are read as claims and compared with what the shop's own
// catalogue says; the intent carries OUR recomputed total, and every disagreement is a flag (`total_mismatch`, `line_price_mismatch`, `unknown_item`, `slot_not_offered` and so on).
// The template recomputes again when it acts (its own code prices an order); nothing here decides anything. The customer's phone stays inside the shop: the intent holds it for the
// template's own flow (which keeps `contact` on the order) and a digest `contactRef` for the record and any log, so nothing downstream needs to print the number.
// Both wire dialects are read: retail 1.2.x (`quantity.count`, `start`/`end`, `Self-Pickup`) and the services and B2B one (`quantity.selected.count`, `stops`).
import { createHash } from "node:crypto";
import { localParts } from "../core/time.ts";
import { paiseOf } from "./money.ts";
import { reasonOfCode } from "./states.ts";
import type { Catalogue, CancelReason } from "./types.ts";

export type InboundFlag =
  | { kind: "total_mismatch"; claimedPaise: number; ourPaise: number }
  | { kind: "line_price_mismatch"; itemId: string; claimedPaise: number; ourPaise: number }
  | { kind: "unknown_item"; itemId: string }
  | { kind: "bad_quantity"; itemId: string }
  | { kind: "bad_amount"; where: string }
  | { kind: "wrong_provider"; providerId: string }
  | { kind: "slot_not_offered"; fromIso: string }
  | { kind: "unknown_cancel_code"; code: string }
  | { kind: "not_a_request"; why: string };

export interface InboundIntent {
  action: "select" | "init" | "confirm" | "cancel" | "unknown";
  /** The order id the buyer app gave (confirm) or is asking about (cancel). */
  networkOrderId?: string;
  lines: { itemId: string; qty: number }[];
  mode?: "pickup" | "delivery";
  slot?: { slotId: string; date: string; fromMs: number; toMs: number };
  /** Delivery: the pincode asked for, to check against the shop's places. */
  areaCode?: string;
  contact?: { name?: string; phone: string };
  contactRef?: string;
  /** What the shop's own catalogue makes of these lines, in paise: the only total anyone should act on. */
  ourTotalPaise: number;
  /** What the message claims, when it claims one. */
  claimedTotalPaise?: number;
  cancel?: { code: string; reason?: CancelReason };
  flags: InboundFlag[];
}

type J = Record<string, unknown>;
const obj = (v: unknown): J | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as J) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** A digest of a contact, so the record can name it without holding it. */
export const contactRef = (phone: string): string => createHash("sha256").update(`ondc-contact:${phone.replace(/\D/gu, "")}`).digest("hex").slice(0, 16);

const pad = (n: number) => String(n).padStart(2, "0");

/** Read one request. `book` is the shop's own catalogue: its prices decide, its slots say which times exist. */
export function readRequest(body: unknown, book: Catalogue): InboundIntent {
  const root = obj(body);
  const context = obj(root?.context);
  const message = obj(root?.message);
  const flags: InboundFlag[] = [];
  const empty = (why: string): InboundIntent => ({ action: "unknown", lines: [], ourTotalPaise: 0, flags: [{ kind: "not_a_request", why }] });
  if (!context || !message) return empty("a request has a context and a message");
  const action = str(context.action);
  if (action !== "select" && action !== "init" && action !== "confirm" && action !== "cancel") return empty(`the action "${String(action)}" is not one the shop answers`);
  const order = obj(message.order);

  if (action === "cancel") {
    const code = str(message.cancellation_reason_id) ?? str(order?.cancellation_reason_id);
    const reason = code ? reasonOfCode(code) : undefined;
    if (code && !reason) flags.push({ kind: "unknown_cancel_code", code });
    return { action, networkOrderId: str(message.order_id) ?? str(order?.id), lines: [], ourTotalPaise: 0, ...(code ? { cancel: { code, ...(reason ? { reason } : {}) } } : {}), flags };
  }
  if (!order) return empty("the message has no order");

  const providerId = str(obj(order.provider)?.id);
  if (providerId && providerId !== book.seller.id) flags.push({ kind: "wrong_provider", providerId });

  const lines: { itemId: string; qty: number }[] = [];
  let ours = 0;
  const unit = new Map<string, number>();
  for (const raw of arr(order.items)) {
    const it = obj(raw);
    const id = str(it?.id);
    const q = obj(it?.quantity);
    const qty = (q?.count ?? obj(q?.selected)?.count) as unknown;
    const known = book.items.find((x) => x.id === id);
    if (!id || !known) { flags.push({ kind: "unknown_item", itemId: id ?? "" }); continue; }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > known.maxPerOrder) { flags.push({ kind: "bad_quantity", itemId: id }); continue; }
    const have = lines.find((l) => l.itemId === id);
    if (have) have.qty += qty; else lines.push({ itemId: id, qty });
    unit.set(id, known.pricePaise);
    ours += known.pricePaise * qty;
  }

  // the claims: the quote's total and each line's unit price, compared and never used
  let claimed: number | undefined;
  const quote = obj(order.quote);
  if (quote) {
    const total = obj(quote.price);
    if (total) {
      if (total.currency !== undefined && total.currency !== "INR") flags.push({ kind: "bad_amount", where: "quote.price.currency" });
      claimed = paiseOf(total.value);
      if (claimed === undefined) flags.push({ kind: "bad_amount", where: "quote.price.value" });
      else if (claimed !== ours) flags.push({ kind: "total_mismatch", claimedPaise: claimed, ourPaise: ours });
    }
    for (const raw of arr(quote.breakup)) {
      const b = obj(raw);
      const id = str(b?.["@ondc/org/item_id"]) ?? str(obj(b?.item)?.id);
      const claim = paiseOf(obj(obj(b?.item)?.price)?.value);
      const mine = id ? unit.get(id) : undefined;
      if (id && mine !== undefined && claim !== undefined && claim !== mine && (b?.["@ondc/org/title_type"] === "item" || obj(obj(b?.item)?.price))) flags.push({ kind: "line_price_mismatch", itemId: id, claimedPaise: claim, ourPaise: mine });
    }
  }

  // the way and the slot: retail puts the type on the fulfillment and the time on `start` (pickup) or `end` (delivery); services put them in `stops`
  const f = obj(arr(order.fulfillments)[0]);
  const type = str(f?.type);
  const mode: "pickup" | "delivery" | undefined = type === "Delivery" ? "delivery" : type === "Self-Pickup" || type === "Pickup" || type === "Store-Service" ? "pickup" : undefined;
  const stops = arr(f?.stops).map(obj);
  const side = mode === "delivery" ? "end" : "start";
  const timed = obj(f?.[side]) ?? stops.find((s) => s?.type === side) ?? stops[0];
  const range = obj(obj(timed?.time)?.range);
  let slot: InboundIntent["slot"];
  const from = str(range?.start) ? Date.parse(str(range?.start)!) : NaN;
  const to = str(range?.end) ? Date.parse(str(range?.end)!) : NaN;
  if (Number.isFinite(from) && Number.isFinite(to)) {
    const a = localParts(from, book.seller.timezone);
    const b = localParts(to, book.seller.timezone);
    const hm = (p: { hour: number; minute: number }) => `${pad(p.hour)}:${pad(p.minute)}`;
    const found = book.slots.find((s) => (mode === undefined || s.mode === mode) && s.from === hm(a) && s.to === hm(b));
    if (found) slot = { slotId: found.id, date: `${a.year}-${pad(a.month)}-${pad(a.day)}`, fromMs: from, toMs: to };
    else flags.push({ kind: "slot_not_offered", fromIso: new Date(from).toISOString() });
  }
  const areaCode = str(obj(obj(obj(f?.end)?.location)?.address)?.area_code) ?? str(obj(stops.find((s) => s?.type === "end")?.location)?.area_code);

  const phone = str(obj(obj(f?.end)?.contact)?.phone) ?? str(obj(timed?.contact)?.phone) ?? str(obj(order.billing)?.phone);
  const name = str(obj(obj(f?.end)?.person)?.name) ?? str(obj(timed?.person)?.name) ?? str(obj(order.billing)?.name);
  return {
    action, networkOrderId: str(order.id), lines, ...(mode ? { mode } : {}), ...(slot ? { slot } : {}), ...(areaCode ? { areaCode } : {}),
    ...(phone ? { contact: { ...(name ? { name } : {}), phone }, contactRef: contactRef(phone) } : {}),
    ourTotalPaise: ours, ...(claimed !== undefined ? { claimedTotalPaise: claimed } : {}), flags,
  };
}
