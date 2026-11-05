// Google Calendar API v3's wire format in front of createFakeCalendar(). The paths and bodies are the ones the live adapter speaks
// (see src/adapters/live/google-calendar.ts for the docs they come from).
//
// One difference from the fake, on purpose: the live adapter cannot tell conflicts() from list() (both are events.list over a time range),
// so the fake's separate "conflicts" operation, and any fault planned on it, is not reachable over HTTP. Plan faults on "list" instead.
import { ApiError, ConflictError, TimeoutError } from "../../../modules/core/faults.ts";
import type { CalendarEvent, CalendarPatch, FakeCalendar } from "../src/adapters/calendar.ts";
import { LostReply, ok } from "../../../modules/standins/http.ts";
import type { Handler, StandinReply } from "../../../modules/standins/http.ts";

const error = (status: number, message: string, reason: string): StandinReply => ({ status, body: { error: { errors: [{ domain: "global", reason, message }], code: status, message } } });

function fromError(e: unknown): StandinReply {
  if (e instanceof TimeoutError) throw new LostReply();
  if (e instanceof ConflictError) return error(409, "The requested identifier already exists.", "duplicate"); // the only 409 Google has
  if (e instanceof ApiError) return error(e.status, e.status === 404 ? "Not Found" : e.message, e.status === 404 ? "notFound" : "backendError");
  throw e;
}

export function wireEvent(e: CalendarEvent): Record<string, unknown> {
  return {
    kind: "calendar#event", id: e.id, status: e.status, summary: e.summary, start: { dateTime: new Date(e.start).toISOString() }, end: { dateTime: new Date(e.end).toISOString() },
    ...(e.bookingRef === "foreign" ? {} : { extendedProperties: { private: { bookingRef: e.bookingRef, ...(e.holdExpiresAt === undefined ? {} : { holdExpiresAt: String(e.holdExpiresAt) }) } } }),
  };
}

const ms = (v: any): number | undefined => (typeof v?.dateTime === "string" && !Number.isNaN(Date.parse(v.dateTime)) ? Date.parse(v.dateTime) : undefined);

/**
 * `calendarId` makes the calendar-metadata read (GET /calendar/v3/calendars/{id}) answer for that one calendar and 404 for any other, as Google does for
 * a calendar the account cannot see; left out, any id is answered. `accessRole` is what events.list reports about the account's role on it ("owner"
 * by default; "reader" is how a calendar shared without "Make changes to events" looks).
 */
export function calendarStandin(calendar: FakeCalendar, options: { pageSize?: number; timeZone?: string; calendarId?: string; accessRole?: string } = {}): Handler {
  const pageSize = options.pageSize ?? 250;
  return async ({ method, path, query, body }) => {
    const metadata = /^\/calendar\/v3\/calendars\/([^/]+)$/u.exec(path);
    if (metadata && method === "GET") {
      const id = decodeURIComponent(metadata[1]);
      if (options.calendarId !== undefined && id.toLowerCase() !== options.calendarId.toLowerCase()) return error(404, "Not Found", "notFound");
      return ok({ kind: "calendar#calendar", etag: '"standin"', id: options.calendarId ?? id, summary: "Stand-in calendar", timeZone: options.timeZone ?? "Asia/Kolkata" });
    }
    const events = /^\/calendar\/v3\/calendars\/[^/]+\/events(?:\/([^/]+))?$/u.exec(path);
    if (!events && path !== "/calendar/v3/freeBusy") return undefined;
    try {
      if (path === "/calendar/v3/freeBusy" && method === "POST") {
        const busy = await calendar.freeBusy(Date.parse(body.timeMin), Date.parse(body.timeMax));
        const calendars = Object.fromEntries((body.items ?? []).map((i: { id: string }) => [i.id, { busy: busy.map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() })) }]));
        return ok({ kind: "calendar#freeBusy", timeMin: body.timeMin, timeMax: body.timeMax, calendars });
      }
      if (!events) return undefined;
      const id = events[1] ? decodeURIComponent(events[1]) : undefined;

      if (!id && method === "POST") {
        const priv = body?.extendedProperties?.private ?? {};
        const hold = Number(priv.holdExpiresAt);
        const created = await calendar.insert({
          summary: body?.summary ?? "", start: ms(body?.start) ?? NaN, end: ms(body?.end) ?? NaN, status: body?.status === "tentative" ? "tentative" : "confirmed",
          bookingRef: priv.bookingRef ?? "foreign", ...(priv.holdExpiresAt !== undefined && Number.isFinite(hold) ? { holdExpiresAt: hold } : {}),
        });
        return ok(wireEvent(created));
      }
      if (!id && method === "GET") {
        const property = query.get("privateExtendedProperty");
        const bookingRef = property?.startsWith("bookingRef=") ? property.slice("bookingRef=".length) : undefined;
        const timeMin = query.get("timeMin");
        const timeMax = query.get("timeMax");
        const all = await calendar.list({ bookingRef, from: timeMin ? Date.parse(timeMin) : undefined, to: timeMax ? Date.parse(timeMax) : undefined });
        const size = Math.min(Number(query.get("maxResults")) || pageSize, pageSize);
        const offset = Number(query.get("pageToken") ?? 0) || 0;
        const page = all.slice(offset, offset + size);
        return ok({ kind: "calendar#events", summary: "Stand-in calendar", timeZone: options.timeZone ?? "Asia/Kolkata", accessRole: options.accessRole ?? "owner", items: page.map(wireEvent), ...(offset + size < all.length ? { nextPageToken: String(offset + size) } : {}) });
      }
      if (id && method === "GET") {
        const found = await calendar.get(id);
        return found ? ok(wireEvent(found)) : error(404, "Not Found", "notFound");
      }
      if (id && method === "PATCH") {
        const patch: CalendarPatch = {};
        if (typeof body?.summary === "string") patch.summary = body.summary;
        if (ms(body?.start) !== undefined) patch.start = ms(body.start);
        if (ms(body?.end) !== undefined) patch.end = ms(body.end);
        if (body?.status === "tentative" || body?.status === "confirmed") patch.status = body.status;
        const priv = body?.extendedProperties?.private;
        if (priv && "holdExpiresAt" in priv) patch.holdExpiresAt = priv.holdExpiresAt === null ? undefined : Number(priv.holdExpiresAt); // null removes a private property
        return ok(wireEvent(await calendar.update(id, patch)));
      }
      if (id && method === "DELETE") {
        await calendar.delete(id);
        return { status: 204 };
      }
      return undefined;
    } catch (e) {
      return fromError(e);
    }
  };
}
