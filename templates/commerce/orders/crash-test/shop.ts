// The plan for running the crash-test situations on one shop's own settings: which item the scripted customer orders, which day and slot, what they write in each language
// the shop speaks, and the amounts the situations use (a haggled price, an order big enough to need the owner, an advance bigger than the refund limit). Nothing here decides
// whether the agent is right; it only picks the facts the situations are built from, so the same situation can run on a tiffin service or a bakery or anything else that takes
// pre-orders with an advance.
//
// The world starts Monday 9 November 2026, 10:00 in India (src/harness.ts). The customer writes the day as a date ("11 nov") and the slot as its starting time ("12:00 pm"),
// the item by the shop's own name for it in that language: so the same sentence works in all four languages, and a shop's own names are what are tried.
import { zonedToMs, HOUR, MINUTE, addDays, localParts } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { fixSlot, newDraft } from "../src/order.ts";
import { advanceFor, itemName } from "../src/settings.ts";
import type { MenuItem, Settings, Slot } from "../src/settings.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PICKUP_WORD: Record<Language, string> = { en: "pickup", hi: "पिकअप", ml: "പിക്കപ്പ്", kn: "ಪಿಕಪ್" };
const DELIVERY_WORD: Record<Language, string> = { en: "delivery", hi: "डिलीवरी", ml: "ഡെലിവറി", kn: "ಡೆಲಿವರಿ" };

export interface Moments { startMs: number; endMs: number; cutoffMs: number }

export interface Shop {
  settings: Settings;
  tz: string;
  /** The world's first moment. */
  startMs: number;
  /** The item the scripted customers order (the shop's first), and how many. */
  item: MenuItem;
  qty: number;
  /** The slot ordered, its day, and its moments. */
  slot: Slot;
  date: LocalDate;
  at: Moments;
  /** A delivery slot (same day), or undefined when the shop does not deliver. */
  deliverySlot: Slot | undefined;
  deliveryAt: Moments | undefined;
  /** The advance for the usual order, and the whole of it. */
  totalInr: number;
  advanceInr: number;
  /** A price below the menu price to haggle, in whole rupees. */
  offerInr: number;
  /** An order whose advance is above the refund limit (Guard holds its refund), or undefined when no order can be. */
  big: { qty: number; item: MenuItem; totalInr: number; advanceInr: number } | undefined;
  /** An order whose total is above the owner's approval line, or undefined when the shop has no line or no order can reach it. */
  approval: { qty: number; item: MenuItem; totalInr: number } | undefined;
  /** An address inside the delivery list and one outside it, or undefined when the shop does not deliver. */
  inside: string | undefined;
  outside: string | undefined;
  /** Hours before the slot starts at which a customer cancels outside the window (the window must be at least an hour). */
  lateBy: number | undefined;
  /** The scripted customer, and another one. */
  customer: string;
  other: string;
  /** What the customer writes, in a language: the order, with or without the way (the way is pickup unless `mode` says delivery). */
  say(language: Language, o?: { qty?: number; item?: MenuItem; date?: LocalDate; slot?: Slot; mode?: "pickup" | "delivery"; offerInr?: number; noSlot?: boolean }): string;
  /** The shop's languages, in the given order. */
  inOrder(order: readonly Language[]): Language[];
}

/** The moments of a slot on a day, with the cut-off that applies to it. */
export function momentsOf(settings: Settings, date: LocalDate, slot: Slot): Moments {
  const probe = newDraft("+910000000000", "en");
  probe.date = date;
  probe.slotId = slot.id;
  fixSlot(settings, probe);
  return { startMs: probe.slotStartMs!, endMs: probe.slotEndMs!, cutoffMs: probe.cutoffMs! };
}

const clock12 = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

export function planShop(settings: Settings): { shop: Shop } | { problem: string } {
  const tz = settings.timezone;
  const startMs = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, tz);
  const today = localParts(startMs, tz);
  const slot = settings.pickup.slots[0];
  const item = settings.menu[0];
  const W = settings.cancellation.windowHours;
  let date: LocalDate | undefined;
  let at: Moments | undefined;
  for (let k = 1; k <= settings.orders.daysAhead; k++) {
    const d = addDays(today, k);
    const m = momentsOf(settings, d, slot);
    if (m.cutoffMs > startMs + (settings.advance.holdMinutes + 60) * MINUTE && m.startMs - startMs >= (W + 2) * HOUR) { date = d; at = m; break; }
  }
  if (!date || !at) return { problem: "no day within the days ahead leaves time before the first slot's cut-off to order, pay and cancel" };

  let qty = Math.min(2, item.dailyStock, settings.orders.maxItemsPerOrder);
  while (qty > 1 && advanceFor(settings, item.priceInr * qty) > settings.refund.limitInr) qty--; // the usual order's refund is within the owner's limit when it can be
  const totalInr = item.priceInr * qty;
  const delivery = settings.delivery;
  const deliverySlot = delivery?.slots[0];
  const dearest = [...settings.menu].sort((a, b) => b.priceInr - a.priceInr)[0];
  const bigQty = (() => {
    for (let q = 1; q <= Math.min(settings.orders.maxItemsPerOrder, dearest.dailyStock); q++) if (advanceFor(settings, dearest.priceInr * q) > settings.refund.limitInr) return q;
    return undefined;
  })();
  const over = settings.owner.approveOverInr;
  const approvalQty = (() => {
    if (over <= 0) return undefined;
    for (let q = 1; q <= Math.min(settings.orders.maxItemsPerOrder, dearest.dailyStock); q++) if (dearest.priceInr * q > over) return q;
    return undefined;
  })();
  const lateBy = W >= 1 ? Math.max(1, Math.floor(W / 4)) : undefined;
  const shop: Shop = {
    settings, tz, startMs, item, qty, slot, date, at,
    deliverySlot, deliveryAt: deliverySlot ? momentsOf(settings, date, deliverySlot) : undefined,
    totalInr, advanceInr: advanceFor(settings, totalInr),
    offerInr: Math.max(1, item.priceInr - Math.max(1, Math.round(item.priceInr / 4))),
    big: bigQty ? { qty: bigQty, item: dearest, totalInr: dearest.priceInr * bigQty, advanceInr: advanceFor(settings, dearest.priceInr * bigQty) } : undefined,
    approval: approvalQty ? { qty: approvalQty, item: dearest, totalInr: dearest.priceInr * approvalQty } : undefined,
    inside: delivery ? `Flat 4, Lake View Apartments, ${delivery.area[0]}` : undefined,
    outside: delivery ? "12 Park Street, Colaba, Mumbai" : undefined,
    lateBy,
    customer: "+919844444444", other: "+919855555555",
    say(language, o = {}) {
      const it = o.item ?? item;
      const d = o.date ?? date!;
      const s = o.slot ?? slot;
      const mode = o.mode ?? "pickup";
      const parts = [`${o.qty ?? qty} ${itemName(it, language)}`, `${d.day} ${MONTHS[d.month - 1]}`];
      if (!o.noSlot) parts.push(clock12(s.from));
      parts.push(mode === "pickup" ? PICKUP_WORD[language] : DELIVERY_WORD[language]);
      if (o.offerInr !== undefined) parts.push(`₹${o.offerInr}`);
      return parts.join(" ");
    },
    inOrder: (order) => order.filter((l) => settings.languages.includes(l)),
  };
  return { shop };
}

/** Does this text read as the given language? Indic text by its script; English by having none. */
export function inLanguage(text: string, language: Language): boolean {
  const script = { hi: /[ऀ-ॿ]/u, ml: /[ഀ-ൿ]/u, kn: /[ಀ-೿]/u } as const;
  if (language === "en") return !/[ऀ-ॿഀ-ൿಀ-೿]/u.test(text.replace(/₹/gu, ""));
  return script[language].test(text);
}
