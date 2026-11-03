// The calendar: Google-Calendar-shaped, with an in-memory fake that doubles as the dev harness.
// The fake's own store is the record the agent must read back before it says "booked".
import { ApiError, ConflictError, TimeoutError, createFaults } from "./faults.ts";
import type { FaultOptions } from "./faults.ts";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: number; // epoch ms
  end: number;
  /** "tentative" is a hold on the slot; "confirmed" is a booking. */
  status: "tentative" | "confirmed";
  /** Our booking id, kept on the event (Google's extendedProperties.private) so a lost reply can be looked up. */
  bookingRef: string;
  holdExpiresAt?: number;
}

export type NewCalendarEvent = Omit<CalendarEvent, "id">;
export type CalendarPatch = Partial<Pick<CalendarEvent, "summary" | "start" | "end" | "status" | "holdExpiresAt">>;
export interface Busy { start: number; end: number }

export interface Calendar {
  insert(event: NewCalendarEvent): Promise<CalendarEvent>;
  get(id: string): Promise<CalendarEvent | null>;
  list(query?: { from?: number; to?: number; bookingRef?: string }): Promise<CalendarEvent[]>;
  update(id: string, patch: CalendarPatch): Promise<CalendarEvent>;
  delete(id: string): Promise<void>;
  freeBusy(from: number, to: number): Promise<Busy[]>;
  /** Events overlapping [start, end). */
  conflicts(start: number, end: number): Promise<CalendarEvent[]>;
}

/**
 * How a fake call can go wrong:
 *  - silentFailure: the call answers "ok" but nothing is stored (the clinic story: "booked", but no event).
 *  - lostReply: the call is stored, then the reply is lost (the client sees a timeout).
 *  - conflict: someone else took the slot a moment ago; their event is stored and the call is refused (insert).
 *  - error: the service answers 500.
 */
export type CalendarFault = "silentFailure" | "lostReply" | "conflict" | "error";
export type CalendarOp = "insert" | "get" | "list" | "update" | "delete" | "freeBusy" | "conflicts";

export interface FakeCalendar extends Calendar {
  /** Everything actually stored, which is what a test asserts against. */
  events(): CalendarEvent[];
  /** An event made by someone else (the owner's own entry, another booking channel). */
  addForeignEvent(start: number, end: number, summary?: string): CalendarEvent;
  inject(op: CalendarOp, mode: CalendarFault, options?: FaultOptions): void;
  /** Every call made, in order, whether it worked or not. */
  calls: { op: CalendarOp }[];
}

export function createFakeCalendar(): FakeCalendar {
  const store = new Map<string, CalendarEvent>();
  const faults = createFaults<CalendarOp, CalendarFault>();
  const calls: { op: CalendarOp }[] = [];
  let nextId = 1;

  const newId = () => `ev_${nextId++}`;
  const overlaps = (e: { start: number; end: number }, start: number, end: number) => e.start < end && start < e.end;

  /** Read operations can only fail with an error. */
  function begin(op: CalendarOp): CalendarFault | undefined {
    calls.push({ op });
    const fault = faults.take(op);
    if (fault === "error") throw new ApiError(500, `calendar ${op}: internal error`);
    return fault;
  }

  return {
    calls,
    events: () => [...store.values()].map((e) => ({ ...e })),
    inject: faults.inject,
    addForeignEvent(start, end, summary = "Busy") {
      const e: CalendarEvent = { id: newId(), summary, start, end, status: "confirmed", bookingRef: "foreign" };
      store.set(e.id, e);
      return { ...e };
    },

    async insert(event) {
      const fault = begin("insert");
      const e: CalendarEvent = { ...event, id: newId() };
      if (fault === "silentFailure") return { ...e }; // looks saved, is not
      if (fault === "conflict") {
        const other: CalendarEvent = { id: newId(), summary: "Busy", start: e.start, end: e.end, status: "confirmed", bookingRef: "foreign" };
        store.set(other.id, other);
        throw new ConflictError("That time was just taken.");
      }
      store.set(e.id, e);
      if (fault === "lostReply") throw new TimeoutError("calendar insert");
      return { ...e };
    },

    async get(id) {
      begin("get");
      const e = store.get(id);
      return e ? { ...e } : null;
    },

    async list(query = {}) {
      begin("list");
      return [...store.values()]
        .filter((e) => (query.bookingRef === undefined || e.bookingRef === query.bookingRef)
          && (query.from === undefined || e.end > query.from) && (query.to === undefined || e.start < query.to))
        .map((e) => ({ ...e }));
    },

    async update(id, patch) {
      const fault = begin("update");
      const e = store.get(id);
      if (!e) throw new ApiError(404, "No such event.");
      const changed: CalendarEvent = { ...e, ...patch };
      if (fault === "silentFailure") return { ...changed }; // says it changed, nothing did
      store.set(id, changed);
      if (fault === "lostReply") throw new TimeoutError("calendar update");
      return { ...changed };
    },

    async delete(id) {
      const fault = begin("delete");
      if (fault === "silentFailure") return;
      store.delete(id);
      if (fault === "lostReply") throw new TimeoutError("calendar delete");
    },

    async freeBusy(from, to) {
      begin("freeBusy");
      return [...store.values()].filter((e) => overlaps(e, from, to)).map((e) => ({ start: e.start, end: e.end }));
    },

    async conflicts(start, end) {
      begin("conflicts");
      return [...store.values()].filter((e) => overlaps(e, start, end)).map((e) => ({ ...e }));
    },
  };
}
