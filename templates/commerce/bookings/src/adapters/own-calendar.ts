// The shop's own booking list as a Calendar (B72, 12 Nov 2026). A Bookings shop that has no Google Calendar (settings "calendar": {"module": "own"}) still goes through
// the same agent code: this object answers the Calendar calls from a list kept INSIDE the shop's own saved state (store.ownCalendar), so it is saved and restored with the
// bookings and never forgets on a restart (the fake calendar does). Used by: server/runtime.ts (createAgent), and the agent's owner day list.
//
// What "confirmed" means here, said plainly: the agent reads its write back from this list, so a booking is "booked" when the shop's own record holds it. There is no second
// system that could disagree. The record's notes say "the shop's own booking list" so nobody reads it as Google's word. Limits, approvals and the record are unchanged:
// the double-booking rule still reads this list and `heldByBookings` together.
//
// Adding Google Calendar later loses nothing: the bookings are the store's, this list is only their calendar view (see backfill in agent.ts).
import type { Calendar, CalendarEvent, CalendarPatch, NewCalendarEvent } from "./calendar.ts";
import type { Store } from "../booking.ts";

/** How long an event that has ended stays in the list before it is dropped, so the saved state does not grow with the shop's age. */
const KEEP_AFTER_END_MS = 2 * 24 * 3_600_000;

export function createOwnCalendar(store: Store, now: () => number): Calendar {
  const list = (): Record<string, CalendarEvent> => (store.ownCalendar ??= { events: {}, next: 1 }).events;
  const overlaps = (e: { start: number; end: number }, start: number, end: number) => e.start < end && start < e.end;
  // why: an event whose time is long past is of no use to the double-booking rule; dropping it keeps the saved state small
  const prune = () => { for (const [id, e] of Object.entries(list())) if (e.end + KEEP_AFTER_END_MS < now()) delete list()[id]; };

  return {
    async insert(event: NewCalendarEvent) {
      prune();
      const state = (store.ownCalendar ??= { events: {}, next: 1 });
      const e: CalendarEvent = { ...event, id: `own_${state.next++}` };
      state.events[e.id] = e;
      return { ...e };
    },
    async get(id) { const e = list()[id]; return e ? { ...e } : null; },
    async list(query = {}) {
      return Object.values(list())
        .filter((e) => (query.bookingRef === undefined || e.bookingRef === query.bookingRef)
          && (query.from === undefined || e.end > query.from) && (query.to === undefined || e.start < query.to))
        .map((e) => ({ ...e }));
    },
    async update(id, patch: CalendarPatch) {
      const e = list()[id];
      if (!e) throw new Error("No such event in the booking list.");
      const changed = { ...e, ...patch };
      // an event that is no longer tentative has no hold end; leave the field out rather than keep a stale one
      if (changed.status === "confirmed") delete changed.holdExpiresAt;
      list()[id] = changed;
      return { ...changed };
    },
    async delete(id) { delete list()[id]; },
    async freeBusy(from, to) { return Object.values(list()).filter((e) => overlaps(e, from, to)).map((e) => ({ start: e.start, end: e.end })); },
    async conflicts(start, end) { return Object.values(list()).filter((e) => overlaps(e, start, end)).map((e) => ({ ...e })); },
  };
}
