// Bookings' view for the ONDC mapping (modules/ondc): this shop's services and its bookings as the neutral types the mapping reads. Small and read-only: it changes nothing in how
// Bookings behaves and holds no ONDC logic. `clientId` is the provider id the mapping uses (the settings hold none). Money: whole rupees to paise, exactly. The deposit is the
// advance part; what is left of the price is a balance part, paid at the visit (the record does not track that payment, so it is never marked paid here).
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import { paiseOfRupees } from "../../../../modules/ondc/money.ts";
import type { BookingIn, Catalogue, Party, PaymentPart } from "../../../../modules/ondc/types.ts";
import { WEEKDAY_KEYS, serviceName, unitsFor } from "./settings.ts";
import type { Settings } from "./settings.ts";
import type { Booking } from "./booking.ts";

const party = (settings: Settings, clientId: string): Party => ({ id: clientId, name: settings.name, ...(settings.address ? { address: settings.address } : {}), timezone: settings.timezone });

/** The services as a catalogue: price, duration, how many can run at once on the service's resource, and the weekly hours (Monday is "1"). */
export function catalogueOf(settings: Settings, clientId: string, nowMs: number): Catalogue {
  const hours: Record<string, [string, string] | null> = {};
  for (let d = 1; d <= 7; d++) { const h = settings.openingHours[WEEKDAY_KEYS[d % 7]]; hours[String(d)] = h ? [h.open, h.close] : null; }
  return {
    seller: party(settings, clientId),
    items: settings.services.map((s) => ({ id: s.id, name: serviceName(s, settings.languages[0]), pricePaise: paiseOfRupees(s.priceInr), kind: "service" as const, available: unitsFor(settings, s), maxPerOrder: 1, durationMinutes: s.durationMinutes, ...(s.resource ? { resource: s.resource } : {}) })),
    slots: [], hours, slotMinutes: settings.slotMinutes, cancellationWindowHours: settings.cancellation.windowHours, nowMs,
  };
}

/** One booking as the neutral booking; undefined while it has no service or time yet (an enquiry still being filled in). */
export function bookingIn(settings: Settings, b: Booking, clientId: string, nowMs: number): BookingIn | undefined {
  const svc = settings.services.find((s) => s.id === b.serviceId);
  if (!svc || b.startMs === undefined || b.endMs === undefined) return undefined;
  const marked = ownerMarkedOf(settings.payment);
  const by = marked ? ("owner-marked" as const) : ("provider" as const);
  const depositInr = Math.min(b.depositInr ?? settings.deposit.amountInr, svc.priceInr);
  const paid = b.state === "confirmed" || b.state === "completed" || b.state === "needs_owner"; // needs_owner: paid, the calendar would not confirm
  const parts: PaymentPart[] = [{
    kind: "advance", amountPaise: paiseOfRupees(depositInr), paid, by, reference: b.id,
    ...(b.state === "awaiting_deposit" ? (marked ? { uri: marked.payLink({ amountPaise: paiseOfRupees(depositInr), note: b.id }), method: "upi" as const } : b.linkUrl ? { uri: b.linkUrl, method: "http/get" as const } : {}) : {}),
  }];
  if (svc.priceInr > depositInr) parts.push({ kind: "balance", amountPaise: paiseOfRupees(svc.priceInr - depositInr), paid: false });
  return {
    seller: party(settings, clientId), ref: b.id, state: b.state,
    service: { id: svc.id, name: serviceName(svc, settings.languages[0]), pricePaise: paiseOfRupees(svc.priceInr), durationMinutes: svc.durationMinutes, ...(svc.resource ? { resource: svc.resource } : {}) },
    startMs: b.startMs, endMs: b.endMs, payments: parts, holdIso: `PT${settings.deposit.holdMinutes}M`, cancellationWindowHours: settings.cancellation.windowHours, nowMs,
  };
}
