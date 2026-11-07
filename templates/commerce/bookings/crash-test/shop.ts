// The plan for running the crash-test situations on one shop's own settings: which service the scripted customers ask for,
// which days and times are on the shop's grid and inside its hours, what a lower price to haggle for looks like, and which
// language each situation is written in. Nothing here decides whether the agent is right; it only picks the facts the
// situations are built from, so that the same situation can run on a salon, a hiring centre or anything else.
//
// The world always starts on Tuesday 3 November 2026 at 10:00 in the shop's time zone, as it always has. For Glow Salon every
// choice below comes out as it was when they were written by hand: tomorrow at 6pm, a haircut for ₹450, a haggle for ₹300.
import { isDeepStrictEqual } from "node:util";
import { glowSalon } from "../src/harness.ts";
import { hoursOn } from "../src/settings.ts";
import type { Service, Settings } from "../src/settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { MINUTE, addDays, localParts, weekdayOf, zonedToMs } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import type { WhenFacts } from "./says.ts";

/** A day and a time the shop could be booked for, and the instants they come to. */
export interface Slot extends WhenFacts {
  date: LocalDate;
  startMs: number;
  endMs: number;
}

export interface PickOptions {
  /** The first day to look at, counted from today (1 = tomorrow). */
  minOffset?: number;
  /** The start must be at least this long after the world starts. */
  minLeadMs?: number;
  /** There must be room for a second booking after this one (the buffer kept) on the same day. */
  room?: boolean;
  /** Slots this one must not overlap or sit within the buffer of. */
  avoid?: readonly Slot[];
  /** The time of day to stay close to, in minutes since midnight (default 18:00). */
  near?: number;
  /** How many days to look at from `minOffset` (default two weeks). */
  days?: number;
}

export interface Shop {
  settings: Settings;
  tz: string;
  /** The service the scripted customers ask for: the first one in the settings. */
  service: Service;
  languages: readonly Language[];
  /** True for the Glow Salon example, whose sentences are the reviewed ones in SAYS. */
  reviewed: boolean;
  startMs: number;
  today: LocalDate;
  priceInr: number;
  depositInr: number;
  /** A lower price the haggling customer asks for. */
  offerInr: number;
  /** Every price on the list and the deposit: the only amounts a message may carry. */
  listInr: number[];
  /** The reminders, largest first. */
  reminders: number[];
  /** The language a situation is written in: the one it prefers if the shop speaks it, else English, else the shop's first. */
  lang(preferred: Language): Language;
  /** The languages in this order, those the shop speaks. */
  inOrder(order: readonly Language[]): Language[];
  date(offset: number): LocalDate;
  at(offset: number, minutes: number): Slot;
  /** The best slot for the service by the options, or undefined when the shop has none that does. */
  pick(options?: PickOptions): Slot | undefined;
  /** The first slot on the same day that starts after this one ends and its buffer, if it fits in the day. */
  after(slot: Slot): Slot | undefined;
  /** A slot that starts inside this one, on the shop's grid, if the grid has one. */
  inside(slot: Slot): Slot | undefined;
  /** The same weekday in the next calendar week as the slot's date, for "next Tuesday". */
  nextWeekday(from: LocalDate): LocalDate | undefined;
  /** A day the shop is closed, within the next two weeks. */
  closedDate(): LocalDate | undefined;
}

const SEARCH_DAYS = 14;

/**
 * The price a haggling customer asks for: two thirds of the list price, rounded to 10 (to 100 above ₹1,000). The check looks for
 * that number as text in every message, so it must not be part of any price the messages carry; if two thirds is, try a few other
 * fractions before giving up.
 */
export function haggleOffer(service: Service, listInr: number[]): number | undefined {
  const step = service.priceInr >= 1000 ? 100 : 10;
  const shown = listInr.flatMap((n) => [String(n), n.toLocaleString("en-IN")]);
  for (const fraction of [2 / 3, 0.6, 0.7, 0.5, 0.75, 0.55, 0.65]) {
    const offer = Math.round((service.priceInr * fraction) / step) * step;
    if (offer >= 25 && offer < service.priceInr && !shown.some((s) => s.includes(String(offer)))) return offer;
  }
  return undefined;
}

export function planShop(settings: Settings): { shop: Shop } | { problem: string } {
  const service = settings.services[0];
  const tz = settings.timezone;
  const startMs = zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, tz);
  const today = localParts(startMs, tz);
  const listInr = [...new Set([...settings.services.map((s) => s.priceInr), settings.deposit.amountInr])].sort((a, b) => a - b);
  const offerInr = haggleOffer(service, listInr);
  if (offerInr === undefined) return { problem: `No lower price to haggle for can be chosen for ${service.id} (₹${service.priceInr}) without it showing up inside another amount.` };
  const duration = service.durationMinutes;
  const grid = settings.slotMinutes;
  const buffer = settings.bufferMinutes;
  const date = (offset: number): LocalDate => addDays(today, offset);
  const hoursFor = (offset: number) => hoursOn(settings, weekdayOf(date(offset)));

  const at = (offset: number, minutes: number): Slot => {
    const d = date(offset);
    const startAt = zonedToMs(d, { hour: Math.floor(minutes / 60), minute: minutes % 60 }, tz);
    return { offset, date: d, day: d.day, month: d.month, weekday: weekdayOf(d), minutes, startMs: startAt, endMs: startAt + duration * MINUTE };
  };
  /** Every start on the shop's grid that fits inside the opening hours that day. */
  const starts = (offset: number): number[] => {
    const hours = hoursFor(offset);
    if (!hours) return [];
    const out: number[] = [];
    for (let m = Math.ceil(hours.open / grid) * grid; m + duration <= hours.close; m += grid) out.push(m);
    return out;
  };
  const clashes = (a: Slot, b: Slot) => a.startMs < b.endMs + buffer * MINUTE && b.startMs < a.endMs + buffer * MINUTE;

  const shop: Shop = {
    settings, tz, service,
    languages: settings.languages,
    reviewed: isDeepStrictEqual(settings, glowSalon()),
    startMs, today,
    priceInr: service.priceInr,
    depositInr: settings.deposit.amountInr,
    offerInr, listInr,
    reminders: [...settings.reminders.hoursBefore].sort((a, b) => b - a),
    lang(preferred) {
      return settings.languages.includes(preferred) ? preferred : settings.languages.includes("en") ? "en" : settings.languages[0];
    },
    inOrder(order) {
      return order.filter((l) => settings.languages.includes(l));
    },
    date,
    at,
    after(slot) {
      const hours = hoursFor(slot.offset);
      if (!hours) return undefined;
      const earliest = slot.minutes + duration + buffer;
      const m = Math.ceil(earliest / grid) * grid;
      return m + duration <= hours.close ? at(slot.offset, m) : undefined;
    },
    inside(slot) {
      const hours = hoursFor(slot.offset);
      if (!hours) return undefined;
      for (let m = slot.minutes + grid; m < slot.minutes + duration + buffer; m += grid) {
        if (m + duration <= hours.close) return at(slot.offset, m);
      }
      return undefined;
    },
    pick(options = {}) {
      const { minOffset = 1, minLeadMs = 0, room = false, avoid = [], near = 18 * 60, days = SEARCH_DAYS } = options;
      for (let offset = minOffset; offset < minOffset + days; offset++) {
        const found = starts(offset)
          .map((m) => at(offset, m))
          .filter((s) => s.startMs - startMs >= minLeadMs)
          .filter((s) => !room || shop.after(s) !== undefined)
          .filter((s) => avoid.every((other) => !clashes(s, other)))
          .sort((x, y) => Math.abs(x.minutes - near) - Math.abs(y.minutes - near) || y.minutes - x.minutes);
        if (found.length > 0) return found[0];
      }
      return undefined;
    },
    nextWeekday(from) {
      // Weeks run Monday to Sunday: "next Tuesday" is the Tuesday of the calendar week after today's. Prefer the same weekday as `from`.
      const monday = (d: LocalDate) => (weekdayOf(d) + 6) % 7;
      const nextMonday = addDays(today, 7 - monday(today));
      const week = Array.from({ length: 7 }, (_, i) => addDays(nextMonday, i));
      const open = week.filter((d) => hoursOn(settings, weekdayOf(d)) !== null);
      return open.find((d) => weekdayOf(d) === weekdayOf(from)) ?? open[0];
    },
    closedDate() {
      for (let offset = 1; offset <= SEARCH_DAYS; offset++) if (!hoursFor(offset)) return date(offset);
      return undefined;
    },
  };
  return { shop };
}
