// Orders' view for the ONDC mapping (modules/ondc): this shop's menu and its orders as the neutral types the mapping reads. Small and read-only: it changes nothing in how Orders
// behaves, and it holds no ONDC logic (the mapping is in modules/ondc). A shop's `clientId` is the provider id the mapping uses; the caller gives it, because the settings do not
// hold one. Money: Orders keeps whole rupees, so the view converts to paise exactly. A plan's period payment is an order with no lines and no slot (src/plans), not a meal, so it
// has no ONDC counterpart and the view returns nothing for it.
import { localParts } from "../../../../modules/core/time.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import { paiseOfRupees } from "../../../../modules/ondc/money.ts";
import type { Catalogue, OrderIn, PaymentPart, Party } from "../../../../modules/ondc/types.ts";
import { advanceFor, allSlots, itemName, itemOf } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { takenOf } from "./order.ts";
import type { Order, OrderState, Store } from "./order.ts";

/** Every Orders state, for the mapping's totality test (the test also reads order.ts, so a new state fails there first). */
export type { OrderState };

const party = (settings: Settings, clientId: string): Party => ({ id: clientId, name: settings.name, ...(settings.address ? { address: settings.address } : {}), timezone: settings.timezone });

/** The menu as a catalogue: each item at today's price and what is left of it today, and every pickup and delivery slot. */
export function catalogueOf(settings: Settings, store: Store, clientId: string, nowMs: number): Catalogue {
  const t = localParts(nowMs, settings.timezone);
  const today = { year: t.year, month: t.month, day: t.day };
  return {
    seller: party(settings, clientId),
    items: settings.menu.map((i) => ({ id: i.id, name: itemName(i, settings.languages[0]), pricePaise: paiseOfRupees(i.priceInr), kind: "goods" as const, available: Math.max(0, i.dailyStock - takenOf(store, today, i.id, nowMs)), maxPerOrder: settings.orders.maxItemsPerOrder })),
    slots: allSlots(settings).map(({ slot, mode }) => ({ id: slot.id, mode, from: slot.from, to: slot.to })),
    ...(settings.delivery ? { areas: settings.delivery.area } : {}),
    cancellationWindowHours: settings.cancellation.windowHours,
    nowMs,
  };
}

/** One order as the neutral order; undefined for a plan's period payment. */
export function orderIn(settings: Settings, o: Order, clientId: string, nowMs: number): OrderIn | undefined {
  if (o.plan) return undefined;
  const lines = o.lines.map((l) => ({ itemId: l.itemId, name: itemName(itemOf(settings, l.itemId)!, settings.languages[0]), qty: l.qty, unitPaise: paiseOfRupees(itemOf(settings, l.itemId)!.priceInr) }));
  const totalInr = o.totalInr ?? lines.reduce((n, l) => n + (l.unitPaise / 100) * l.qty, 0);
  const advanceInr = o.advanceInr ?? advanceFor(settings, totalInr);
  const marked = ownerMarkedOf(settings.payment);
  const by = marked ? ("owner-marked" as const) : ("provider" as const);
  const advancePaid = o.state === "confirmed" || o.state === "completed";
  const parts: PaymentPart[] = [{
    kind: "advance", amountPaise: paiseOfRupees(advanceInr), paid: advancePaid, by, reference: o.id,
    ...(o.state === "awaiting_advance" ? (marked ? { uri: marked.payLink({ amountPaise: paiseOfRupees(advanceInr), note: o.id }), method: "upi" as const } : o.linkUrl ? { uri: o.linkUrl, method: "http/get" as const } : {}) : {}),
  }];
  if (totalInr > advanceInr) parts.push({ kind: "balance", amountPaise: paiseOfRupees(totalInr - advanceInr), paid: o.balance?.paid !== undefined, ...(o.balance?.paid ? { by: o.balance.paid.by === "cash" ? ("cash" as const) : o.balance.paid.by === "upi" ? ("owner-marked" as const) : ("provider" as const) } : {}) });
  return {
    seller: party(settings, clientId), ref: o.id, state: o.state, lines, totalPaise: paiseOfRupees(totalInr),
    ...(o.mode ? { mode: o.mode } : {}), ...(o.slotId && o.slotStartMs !== undefined && o.slotEndMs !== undefined ? { slot: { id: o.slotId, fromMs: o.slotStartMs, toMs: o.slotEndMs } } : {}),
    ...(o.area ? { area: o.area } : {}),
    payments: parts, holdIso: `PT${settings.advance.holdMinutes}M`, cancellationWindowHours: settings.cancellation.windowHours,
    // the order does not keep why it was cancelled, so no `cancel` is given; "expired" is its own state and maps to its own reason
    nowMs,
  };
}
