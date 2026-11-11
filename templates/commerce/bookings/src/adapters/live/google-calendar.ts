// The calendar over Google Calendar API v3, mapped to the Calendar interface.
// No token, no Authorization header: the base URL is a Guard instance in front of https://www.googleapis.com (or a stand-in).
//
// Wire facts this file rests on (Google's own docs; read 3 Nov 2026):
//  - events.insert  POST  /calendar/v3/calendars/{calendarId}/events  (summary, start/end.dateTime in RFC 3339, status
//                   "confirmed" | "tentative" | "cancelled", extendedProperties.private).
//                   https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
//  - events.list    GET   .../events?privateExtendedProperty=name=value&singleEvents=true&timeMin=&timeMax=&pageToken=
//                   timeMin is an exclusive bound on an event's END and timeMax an exclusive bound on its START, so "overlapping
//                   [start, end)" is exactly timeMin=start, timeMax=end. Cancelled events are left out unless showDeleted is set.
//                   https://developers.google.com/workspace/calendar/api/v3/reference/events/list
//  - events.patch   PATCH .../events/{eventId}: the docs say nothing about how extendedProperties merge, so we read the event first
//                   and send the whole private map back. https://developers.google.com/workspace/calendar/api/v3/reference/events/patch
//  - freeBusy       POST  /calendar/v3/freeBusy { timeMin, timeMax, items: [{ id }] }  ->  calendars[id].busy[] and calendars[id].errors[]
//                   https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
//  - errors         { error: { code, message, errors: [{ domain, reason, message }] } }; 404 notFound, 409 duplicate, 410 deleted.
//                   https://developers.google.com/workspace/calendar/api/guides/errors
//
// Times are written as UTC RFC 3339 (the owner's calendar shows them in their own zone); we store epoch milliseconds.
// Google never refuses an overlapping insert. So the agent holds a time in its own saved bookings first, looks at conflicts() before the
// insert, and looks again after it, letting the hold go if someone else's event appeared meanwhile (agent.ts, tryHold; Deferred.md says
// what is left). A 409 can only mean a duplicate id, and is mapped to ConflictError.
import { ApiError, ConflictError } from "../../../../../../modules/core/faults.ts";
import type { Busy, Calendar, CalendarEvent, NewCalendarEvent } from "../calendar.ts";
import { zonedToMs } from "../../../../../../modules/core/time.ts";
import { asArray, createHttp, isObject, str } from "../../../../../../modules/core/http.ts";
import type { Http, HttpReply, Json } from "../../../../../../modules/core/http.ts";

export interface GoogleCalendarConfig { baseUrl: string; calendarId: string; timeoutMs?: number; /** Guard's credential for this agent (never a Google token). Left out, no Authorization header is sent. */ agentToken?: string }

const MAX_PAGES = 20;

// ---- wire <-> our types (pure, exported for the tests) -----------------------------------------------------------------------

export const toRfc3339 = (ms: number) => new Date(ms).toISOString();

export function describeError(reply: HttpReply): string {
  const b = reply.body;
  const m = isObject(b) && isObject(b.error) ? str(b.error.message) : undefined;
  return m ?? `Google Calendar answered ${reply.status}.`;
}

/** Start or end of an event. A timed event has `dateTime`; an all-day event has a bare `date` (midnight in the calendar's own zone). */
function instant(v: unknown, timeZone: string | undefined): number | undefined {
  if (!isObject(v)) return undefined;
  const dateTime = str(v.dateTime);
  if (dateTime) { const t = Date.parse(dateTime); return Number.isNaN(t) ? undefined : t; }
  const date = str(v.date);
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date) : null;
  if (!m) return undefined;
  const day = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  try { return zonedToMs(day, { hour: 0, minute: 0 }, timeZone ?? "UTC"); } catch { return Date.UTC(day.year, day.month - 1, day.day); }
}

/** One Google event as ours. Null for a cancelled event, one with no usable times, or one the owner marked "free" (it does not block time). */
export function toEvent(raw: Json, calendarTimeZone?: string): CalendarEvent | null {
  if (raw.status === "cancelled") return null;
  const start = instant(raw.start, calendarTimeZone);
  const end = instant(raw.end, calendarTimeZone);
  const id = str(raw.id);
  if (start === undefined || end === undefined || id === undefined) return null;
  const priv = isObject(raw.extendedProperties) && isObject(raw.extendedProperties.private) ? raw.extendedProperties.private : {};
  const hold = Number(str(priv.holdExpiresAt));
  return {
    id, summary: str(raw.summary) ?? "", start, end,
    status: raw.status === "tentative" ? "tentative" : "confirmed",
    bookingRef: str(priv.bookingRef) || "foreign", // an event we did not make (the owner's own entry) has no bookingRef
    ...(str(priv.holdExpiresAt) && Number.isFinite(hold) ? { holdExpiresAt: hold } : {}),
  };
}

const isTransparent = (raw: Json) => raw.transparency === "transparent";

/** The parts of our event (or patch) that Google keeps as ordinary fields; the booking id and hold travel as private properties. */
export function toWire(event: Partial<NewCalendarEvent>): Json {
  const out: Json = {};
  if (event.summary !== undefined) out.summary = event.summary;
  if (event.start !== undefined) out.start = { dateTime: toRfc3339(event.start) };
  if (event.end !== undefined) out.end = { dateTime: toRfc3339(event.end) };
  if (event.status !== undefined) out.status = event.status;
  return out;
}

// ---- the adapter -------------------------------------------------------------------------------------------------------------

export function createGoogleCalendar(config: GoogleCalendarConfig): Calendar {
  const http: Http = createHttp(config.baseUrl, "Google Calendar", config.timeoutMs, config.agentToken);
  const base = `/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}`;

  function expectOk(reply: HttpReply): Json {
    if (reply.status === 409) throw new ConflictError(describeError(reply));
    if (reply.status < 200 || reply.status >= 300) throw new ApiError(reply.status, describeError(reply));
    if (!isObject(reply.body)) throw new ApiError(502, "Google Calendar answered with something that is not a record.");
    return reply.body;
  }

  /** Every page of events.list, following nextPageToken. Events that block no time are dropped. */
  async function listRaw(query: { from?: number; to?: number; bookingRef?: string }): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const reply = await http.request("GET", `${base}/events`, {
        query: {
          singleEvents: "true", maxResults: 250, pageToken,
          timeMin: query.from === undefined ? undefined : toRfc3339(query.from),
          timeMax: query.to === undefined ? undefined : toRfc3339(query.to),
          privateExtendedProperty: query.bookingRef === undefined ? undefined : `bookingRef=${query.bookingRef}`,
        },
      });
      const body = expectOk(reply);
      const zone = str(body.timeZone);
      for (const item of asArray(body.items).filter(isObject)) {
        if (isTransparent(item)) continue;
        const e = toEvent(item, zone);
        if (e) events.push(e);
      }
      pageToken = str(body.nextPageToken);
      if (!pageToken) return events;
    }
    throw new ApiError(502, "Google Calendar has more events than this code will page through.");
  }

  /** The private properties we keep on an event: our booking id, and until the booking is paid, when the hold ends. A cleared hold is sent as null, which is how Google removes a private property. */
  const privateOf = (bookingRef: string, holdExpiresAt: number | undefined): Json => ({ bookingRef, holdExpiresAt: holdExpiresAt === undefined ? null : String(holdExpiresAt) });

  async function getRaw(id: string): Promise<Json | null> {
    const reply = await http.request("GET", `${base}/events/${encodeURIComponent(id)}`);
    if (reply.status === 404 || reply.status === 410) return null;
    const raw = expectOk(reply);
    return raw.status === "cancelled" ? null : raw; // a deleted event may still answer, marked cancelled
  }

  return {
    async insert(event) {
      const priv = privateOf(event.bookingRef, event.holdExpiresAt);
      if (priv.holdExpiresAt === null) delete priv.holdExpiresAt; // nothing to remove on a new event
      const body = { ...toWire(event), extendedProperties: { private: priv } };
      const reply = await http.request("POST", `${base}/events`, { query: { sendUpdates: "none" }, body });
      const created = toEvent(expectOk(reply));
      if (!created) throw new ApiError(502, "Google Calendar answered with an event this code cannot read.");
      return created;
    },

    async get(id) {
      const raw = await getRaw(id);
      return raw ? toEvent(raw) : null;
    },

    list: (query = {}) => listRaw(query),

    async update(id, patch) {
      const current = await getRaw(id);
      if (!current) throw new ApiError(404, "No such event.");
      const existing = toEvent(current);
      const bookingRef = existing?.bookingRef === "foreign" ? undefined : existing?.bookingRef; // read the ref we need to keep from the event itself
      const holdExpiresAt = "holdExpiresAt" in patch ? patch.holdExpiresAt : existing?.holdExpiresAt;
      const body: Json = toWire(patch);
      if (bookingRef !== undefined) body.extendedProperties = { private: privateOf(bookingRef, holdExpiresAt) };
      const reply = await http.request("PATCH", `${base}/events/${encodeURIComponent(id)}`, { query: { sendUpdates: "none" }, body });
      const changed = toEvent(expectOk(reply));
      if (!changed) throw new ApiError(502, "Google Calendar answered with an event this code cannot read.");
      return changed;
    },

    async delete(id) {
      const reply = await http.request("DELETE", `${base}/events/${encodeURIComponent(id)}`, { query: { sendUpdates: "none" } });
      if (reply.status === 404 || reply.status === 410) return; // already gone is what was asked for
      if (reply.status < 200 || reply.status >= 300) throw new ApiError(reply.status, describeError(reply));
    },

    async freeBusy(from, to) {
      const reply = await http.request("POST", "/calendar/v3/freeBusy", { body: { timeMin: toRfc3339(from), timeMax: toRfc3339(to), items: [{ id: config.calendarId }] } });
      const body = expectOk(reply);
      const entry = isObject(body.calendars) ? body.calendars[config.calendarId] : undefined;
      if (!isObject(entry)) throw new ApiError(502, "Google Calendar's free/busy answer has nothing for this calendar.");
      // A calendar that could not be read comes back with an error and an empty busy list: that is not "free".
      if (asArray(entry.errors).length > 0) throw new ApiError(502, `Google Calendar could not read this calendar's free/busy (${asArray(entry.errors).map((e) => (isObject(e) ? str(e.reason) : undefined) ?? "unknown").join(", ")}).`);
      return asArray(entry.busy).filter(isObject).flatMap((b): Busy[] => {
        const s = Date.parse(String(b.start));
        const e = Date.parse(String(b.end));
        return Number.isNaN(s) || Number.isNaN(e) ? [] : [{ start: s, end: e }];
      });
    },

    conflicts: (start, end) => listRaw({ from: start, to: end }),
  };
}
