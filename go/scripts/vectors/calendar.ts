// Vector cases for go/internal/calendar: the live Google Calendar client (templates/commerce/bookings/src/adapters/live/google-calendar.ts) run through a Guard stand-in that
// answers from a script (every call's method, request target, headers and body bytes are written down, and every answer the client reads), the in-memory fake and the shop's own
// booking list driven through scripted and seeded-random sequences (inputs and the TypeScript results: no ports, no clock, no network), and the JavaScript behaviours the Go
// code had to copy (Date.parse, toISOString, Number(string), String(value), all-day events in a time zone).
import { createGoogleCalendar, toEvent } from "../../../templates/commerce/bookings/src/adapters/live/google-calendar.ts";
import { createFakeCalendar } from "../../../templates/commerce/bookings/src/adapters/calendar.ts";
import { createOwnCalendar } from "../../../templates/commerce/bookings/src/adapters/own-calendar.ts";
import { recordCase, describeError } from "../lib/record.ts";
import type { Case, Scripted } from "../lib/record.ts";
import { fixture, guardNames, guardReply, ok, status } from "./fixtures.ts";

type Call = { op: string; args: any[] };

/** A patch as the vector writes it: `null` for holdExpiresAt is "the key is there and its value is undefined" (JSON has no undefined). */
const toPatch = (p: any) => { const out: any = { ...p }; if (out.holdExpiresAt === null) out.holdExpiresAt = undefined; return out; };

async function viaClient(name: string, replies: Scripted[], call: Call, opts: { calendarId?: string; agentToken?: string; baseSuffix?: string; closed?: boolean; timeoutMs?: number } = {}): Promise<Case> {
  const calendarId = opts.calendarId ?? "shop@example.com";
  return recordCase(name, replies, async (baseUrl) => {
    const client: any = createGoogleCalendar({ baseUrl, calendarId, timeoutMs: opts.timeoutMs, ...(opts.agentToken ? { agentToken: opts.agentToken } : {}) });
    const args = call.op === "update" ? [call.args[0], toPatch(call.args[1])] : call.args;
    const r = await client[call.op](...args);
    return r === undefined ? null : r;
  }, { baseSuffix: opts.baseSuffix, closed: opts.closed, config: { call, calendarId, agentToken: opts.agentToken ?? "", baseSuffix: opts.baseSuffix ?? "", closed: opts.closed ?? false, timeoutMs: opts.timeoutMs ?? 0 } });
}

const T0 = Date.UTC(2026, 10, 21, 5, 30); // 21 Nov 2026 11:00 in India
const MIN = 60_000;
const gEvent = (id: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({ kind: "calendar#event", id, status: "confirmed", summary: "s", start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() }, ...extra });
const hold = (id: string, ref: string, start: number, holdAt?: string | null, extra: Record<string, unknown> = {}) => gEvent(id, start, start + 45 * MIN, { status: "tentative", extendedProperties: { private: { bookingRef: ref, ...(holdAt === null ? {} : { holdExpiresAt: holdAt ?? "1793000000000" }) } }, ...extra });
const notFound = () => status(404, fixture("google-error-not-found.json"));
const listFx = () => ok(fixture("google-events-list.json"));

export async function cases(): Promise<Case[]> {
  const out: Case[] = [];
  const add = async (...a: Parameters<typeof viaClient>) => { out.push(await viaClient(...a)); };
  const tok = { agentToken: "agent-token-1" };
  const newEvent = { summary: "haircut · +919811111111", start: T0, end: T0 + 45 * MIN, status: "tentative", bookingRef: "b-1", holdExpiresAt: T0 + 30 * MIN };

  // ---- insert
  await add("insert: a tentative hold, with the agent token", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [newEvent] }, tok);
  await add("insert: no token sends no Authorization", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [newEvent] });
  await add("insert: a confirmed booking has no hold member", [ok(gEvent("e2", T0, T0 + 30 * MIN, { extendedProperties: { private: { bookingRef: "b-2" } } }))], { op: "insert", args: [{ summary: "cut", start: T0, end: T0 + 30 * MIN, status: "confirmed", bookingRef: "b-2" }] });
  await add("insert: awkward summary bytes", [ok(hold("e3", "b-3", T0))], { op: "insert", args: [{ ...newEvent, summary: "Cut & colour <deposit> é 日本   \"q\" \\ \t   x", bookingRef: "b 3/é" }] });
  await add("insert: an empty summary is sent", [ok(hold("e3", "b-3", T0))], { op: "insert", args: [{ ...newEvent, summary: "" }] });
  await add("insert: a calendar id that needs escaping", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [newEvent] }, { calendarId: "a b/c:d@e.f#g+h~i'(j)*!" });
  await add("insert: the group calendar id", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [newEvent] }, { calendarId: "abc123@group.calendar.google.com" });
  await add("insert: a path prefix on the base URL", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [newEvent] }, { baseSuffix: "/gcal" });
  await add("insert: a time far in the past (a year before 1000)", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [{ ...newEvent, start: Date.UTC(900, 0, 1), end: Date.UTC(900, 0, 2) }] });
  await add("insert: a time past the year 9999", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [{ ...newEvent, start: Date.UTC(10000, 0, 1), end: Date.UTC(10000, 0, 2) }] });
  await add("insert: a time before the epoch with milliseconds", [ok(hold("e1", "b-1", T0))], { op: "insert", args: [{ ...newEvent, start: -1234567, end: 1 }] });
  await add("insert: the reply is not a record", [{ status: 200, text: "[1]" }], { op: "insert", args: [newEvent] });
  await add("insert: an empty reply", [{ status: 200 }], { op: "insert", args: [newEvent] });
  await add("insert: a reply that is not JSON", [{ status: 200, text: "<html>" }], { op: "insert", args: [newEvent] });
  await add("insert: an event this code cannot read (no times)", [ok({ id: "e1", status: "confirmed" })], { op: "insert", args: [newEvent] });
  await add("insert: a cancelled event in the reply", [ok({ ...hold("e1", "b-1", T0), status: "cancelled" })], { op: "insert", args: [newEvent] });
  await add("insert: a duplicate id is a conflict (409)", [status(409, { error: { code: 409, message: "The requested identifier already exists." } })], { op: "insert", args: [newEvent] });
  await add("insert: a 409 with no message", [status(409, { oops: 1 })], { op: "insert", args: [newEvent] });
  await add("insert: a 403 from Google", [status(403, { error: { code: 403, message: "Forbidden" } })], { op: "insert", args: [newEvent] });
  await add("insert: an empty error message is kept", [status(400, { error: { message: "" } })], { op: "insert", args: [newEvent] });
  await add("insert: a 500 whose body is not Google's", [status(500, { oops: true })], { op: "insert", args: [newEvent] });
  await add("insert: 429", [status(429, { error: { code: 429, message: "Rate Limit Exceeded" } })], { op: "insert", args: [newEvent] });
  await add("insert: a reply that never comes", [{ hang: true }], { op: "insert", args: [newEvent] }, { timeoutMs: 150 });
  await add("insert: a connection cut", [{ cut: true }], { op: "insert", args: [newEvent] });
  await add("insert: nothing listens", [], { op: "insert", args: [newEvent] }, { closed: true });
  for (const n of guardNames) await add(`insert: Guard answer ${n}`, [guardReply(n)], { op: "insert", args: [newEvent] });

  // ---- get
  await add("get: a hold", [ok(hold("e1hold", "b-1", T0))], { op: "get", args: ["e1hold"] });
  await add("get: an id that needs escaping", [ok(hold("e1", "b-1", T0))], { op: "get", args: ["a b/c:d@e#f%g" ] });
  await add("get: 404 is null", [notFound()], { op: "get", args: ["nope"] });
  await add("get: 410 is null", [status(410, { error: { code: 410, message: "Resource has been deleted" } })], { op: "get", args: ["gone"] });
  await add("get: a cancelled event is null", [ok({ id: "e5gone", status: "cancelled" })], { op: "get", args: ["e5gone"] });
  await add("get: a free (transparent) event is still returned", [ok(gEvent("e4", T0, T0 + 60 * MIN, { transparency: "transparent" }))], { op: "get", args: ["e4"] });
  await add("get: an event with no times is null", [ok({ id: "e6", status: "confirmed", summary: "x" })], { op: "get", args: ["e6"] });
  await add("get: an event of the owner's has the booking ref foreign", [ok(gEvent("e7", T0, T0 + 60 * MIN))], { op: "get", args: ["e7"] });
  await add("get: an empty booking ref is foreign", [ok(gEvent("e7", T0, T0 + 60 * MIN, { extendedProperties: { private: { bookingRef: "" } } }))], { op: "get", args: ["e7"] });
  await add("get: a booking ref that is not a string is foreign", [ok(gEvent("e7", T0, T0 + 60 * MIN, { extendedProperties: { private: { bookingRef: 5 } } }))], { op: "get", args: ["e7"] });
  await add("get: extendedProperties that are not records", [ok(gEvent("e7", T0, T0 + 60 * MIN, { extendedProperties: "x" }))], { op: "get", args: ["e7"] });
  await add("get: private that is a list", [ok(gEvent("e7", T0, T0 + 60 * MIN, { extendedProperties: { private: [1] } }))], { op: "get", args: ["e7"] });
  await add("get: a summary that is not a string is empty", [ok(gEvent("e7", T0, T0 + 60 * MIN, { summary: 5 }))], { op: "get", args: ["e7"] });
  await add("get: an unknown status reads as confirmed", [ok(gEvent("e7", T0, T0 + 60 * MIN, { status: "weird" }))], { op: "get", args: ["e7"] });
  await add("get: an id that is not a string", [ok(gEvent("e7", T0, T0 + 60 * MIN, { id: 7 }))], { op: "get", args: ["e7"] });
  await add("get: an empty id is allowed", [ok(gEvent("", T0, T0 + 60 * MIN))], { op: "get", args: ["e7"] });
  await add("get: a hold end that is text with spaces", [ok(hold("e8", "b-8", T0, " 1793000000000 "))], { op: "get", args: ["e8"] });
  await add("get: a hold end in hex", [ok(hold("e8", "b-8", T0, "0x10"))], { op: "get", args: ["e8"] });
  await add("get: a hold end that is not a number", [ok(hold("e8", "b-8", T0, "soon"))], { op: "get", args: ["e8"] });
  await add("get: a hold end of Infinity", [ok(hold("e8", "b-8", T0, "Infinity"))], { op: "get", args: ["e8"] });
  await add("get: an empty hold end", [ok(hold("e8", "b-8", T0, ""))], { op: "get", args: ["e8"] });
  await add("get: a hold end in exponent form", [ok(hold("e8", "b-8", T0, "1.793e12"))], { op: "get", args: ["e8"] });
  await add("get: a hold end of zero", [ok(hold("e8", "b-8", T0, "0"))], { op: "get", args: ["e8"] });
  await add("get: a hold end that is a number, not text", [ok(gEvent("e8", T0, T0 + 60 * MIN, { extendedProperties: { private: { bookingRef: "b-8", holdExpiresAt: 1793000000000 } } }))], { op: "get", args: ["e8"] });
  await add("get: a 500", [status(500, { error: { message: "backend" } })], { op: "get", args: ["e1"] });
  await add("get: Guard busy", [guardReply("busy")], { op: "get", args: ["e1"] });
  await add("get: a reply that never comes", [{ hang: true }], { op: "get", args: ["e1"] }, { timeoutMs: 150 });
  await add("get: an all-day event (calendar zone unknown, so UTC)", [ok({ id: "e9", status: "confirmed", start: { date: "2026-11-11" }, end: { date: "2026-11-12" } })], { op: "get", args: ["e9"] });
  await add("get: dateTime with milliseconds and a negative offset", [ok({ id: "e9", start: { dateTime: "2026-11-10T08:00:00.123-07:00" }, end: { dateTime: "2026-11-10T09:00:00.999-07:00" } })], { op: "get", args: ["e9"] });
  await add("get: a dateTime that is not a date is unreadable", [ok({ id: "e9", start: { dateTime: "tomorrow" }, end: { dateTime: "2026-11-10T09:00:00Z" } })], { op: "get", args: ["e9"] });
  await add("get: an empty dateTime falls back to date", [ok({ id: "e9", start: { dateTime: "", date: "2026-11-11" }, end: { date: "2026-11-12" } })], { op: "get", args: ["e9"] });
  await add("get: a date that is not YYYY-MM-DD", [ok({ id: "e9", start: { date: "2026-11-1" }, end: { date: "2026-11-12" } })], { op: "get", args: ["e9"] });
  await add("get: a date with a day past the month", [ok({ id: "e9", start: { date: "2026-02-30" }, end: { date: "2026-13-45" } })], { op: "get", args: ["e9"] });
  await add("get: a start that is not a record", [ok({ id: "e9", start: "2026-11-10", end: { date: "2026-11-12" } })], { op: "get", args: ["e9"] });

  // ---- list and conflicts
  await add("list: the fixture's events (a hold, the owner's, all day in India, a free one, a cancelled one)", [listFx()], { op: "list", args: [] });
  await add("list: by booking ref", [ok({ items: [hold("e1", "b-1", T0)] })], { op: "list", args: [{ bookingRef: "b-1" }] });
  await add("list: by a booking ref that needs encoding", [ok({ items: [] })], { op: "list", args: [{ bookingRef: "b 1&x=é/+" }] });
  await add("list: an empty booking ref is a filter", [ok({ items: [] })], { op: "list", args: [{ bookingRef: "" }] });
  await add("list: from and to", [ok({ items: [] })], { op: "list", args: [{ from: T0, to: T0 + 3_600_000 }] });
  await add("list: all three", [ok({ items: [] })], { op: "list", args: [{ from: T0, to: T0 + 3_600_000, bookingRef: "b-1" }] });
  await add("list: only from", [ok({ items: [] })], { op: "list", args: [{ from: 0 }] });
  await add("list: with the agent token and an escaped calendar id", [ok({ items: [] })], { op: "list", args: [{ bookingRef: "b-1" }] }, { ...tok, calendarId: "x@y.z" });
  await add("list: no items member", [ok({})], { op: "list", args: [] });
  await add("list: items that is not a list", [ok({ items: "none" })], { op: "list", args: [] });
  await add("list: junk among the items", [ok({ items: ["junk", 5, null, hold("e1", "b-1", T0), [1]] })], { op: "list", args: [] });
  await add("list: all-day events in the calendar's zone (Kolkata)", [ok({ timeZone: "Asia/Kolkata", items: [{ id: "d1", start: { date: "2026-11-11" }, end: { date: "2026-11-12" } }] })], { op: "list", args: [] });
  for (const tz of ["America/New_York", "Europe/London", "Pacific/Auckland", "Asia/Kathmandu", "UTC", "Etc/GMT+5", "Not/AZone", "", "Australia/Lord_Howe", "America/St_Johns"]) {
    for (const day of ["2026-11-01", "2026-03-29", "2026-04-05", "2026-10-25", "2026-03-08"]) {
      await add(`list: all-day ${day} in zone "${tz}"`, [ok({ timeZone: tz, items: [{ id: "d1", start: { date: day }, end: { date: "2026-12-31" } }] })], { op: "list", args: [] });
    }
  }
  await add("list: a timeZone that is not a string", [ok({ timeZone: 5, items: [{ id: "d1", start: { date: "2026-11-11" }, end: { date: "2026-11-12" } }] })], { op: "list", args: [] });
  await add("list: a zone with a transition at midnight (Sao Paulo 2018 style date)", [ok({ timeZone: "America/Sao_Paulo", items: [{ id: "d1", start: { date: "2018-11-04" }, end: { date: "2018-11-05" } }, { id: "d2", start: { date: "2018-02-18" }, end: { date: "2018-02-19" } }] })], { op: "list", args: [] });
  await add("list: a zone with a gap at midnight (Havana 2026-03-08)", [ok({ timeZone: "America/Havana", items: [{ id: "d1", start: { date: "2026-03-08" }, end: { date: "2026-03-09" } }, { id: "d2", start: { date: "2026-11-01" }, end: { date: "2026-11-02" } }] })], { op: "list", args: [] });
  await add("list: old dates (LMT offsets) and a year before 100", [ok({ timeZone: "Asia/Kolkata", items: [{ id: "d1", start: { date: "1880-01-01" }, end: { date: "1880-01-02" } }, { id: "d2", start: { date: "0050-01-01" }, end: { date: "0050-01-02" } }] })], { op: "list", args: [] });
  await add("list: two pages", [ok({ items: [hold("e1", "b-1", T0)], nextPageToken: "tok 1/é" }), ok({ items: [hold("e2", "b-1", T0 + 3_600_000)], nextPageToken: "tok2" }), ok({ items: [hold("e3", "b-1", T0 + 7_200_000)] })], { op: "list", args: [{ bookingRef: "b-1", from: T0, to: T0 + 9 * 3_600_000 }] });
  await add("list: an empty page token ends the paging", [ok({ items: [hold("e1", "b-1", T0)], nextPageToken: "" })], { op: "list", args: [] });
  await add("list: a page token that is not text ends the paging", [ok({ items: [hold("e1", "b-1", T0)], nextPageToken: 5 })], { op: "list", args: [] });
  await add("list: a page that never ends", Array.from({ length: 25 }, (_, i) => ok({ items: [], nextPageToken: `t${i}` })), { op: "list", args: [] });
  await add("list: the second page fails", [ok({ items: [hold("e1", "b-1", T0)], nextPageToken: "t1" }), status(500, { error: { message: "boom" } })], { op: "list", args: [] });
  await add("list: the second page is Guard's refusal", [ok({ items: [hold("e1", "b-1", T0)], nextPageToken: "t1" }), guardReply("refused_limit")], { op: "list", args: [] });
  await add("list: a 404 is an error, not an empty list", [notFound()], { op: "list", args: [] });
  await add("list: a body that is a list", [{ status: 200, text: "[]" }], { op: "list", args: [] });
  await add("list: 409", [status(409, { error: { message: "dup" } })], { op: "list", args: [] });
  for (const n of ["busy", "refused_unlisted", "outcome_unknown", "unauthenticated"]) await add(`list: Guard answer ${n}`, [guardReply(n)], { op: "list", args: [] });
  await add("conflicts: a window", [listFx()], { op: "conflicts", args: [T0 - 15 * MIN, T0 + 60 * MIN] });
  await add("conflicts: nothing there", [ok({ items: [] })], { op: "conflicts", args: [T0, T0 + 1] }, tok);

  // ---- update
  const patchAll = { start: T0 + 30 * MIN, end: T0 + 75 * MIN, status: "confirmed", holdExpiresAt: null };
  await add("update: a hold becomes a booking (the hold is cleared with null)", [ok(hold("e1", "b-1", T0)), ok(gEvent("e1", T0, T0 + 45 * MIN))], { op: "update", args: ["e1", patchAll] }, tok);
  await add("update: the hold moves, the ref is kept", [ok(hold("e1", "b-1", T0)), ok(hold("e1", "b-1", T0, "1793000999000"))], { op: "update", args: ["e1", { start: T0, end: T0 + 45 * MIN, status: "tentative", holdExpiresAt: T0 + 60 * MIN }] });
  await add("update: no hold key keeps the event's own hold", [ok(hold("e1", "b-1", T0, "1793000000123")), ok(hold("e1", "b-1", T0))], { op: "update", args: ["e1", { summary: "renamed" }] });
  await add("update: no hold key and no hold on the event sends null", [ok(hold("e1", "b-1", T0, null)), ok(hold("e1", "b-1", T0))], { op: "update", args: ["e1", { summary: "renamed" }] });
  await add("update: the owner's event (foreign) gets no private map", [ok(gEvent("e2", T0, T0 + 3_600_000)), ok(gEvent("e2", T0, T0 + 3_600_000, { summary: "moved" }))], { op: "update", args: ["e2", { summary: "moved", holdExpiresAt: null }] });
  await add("update: an event that cannot be read (no times) has no private map", [ok({ id: "e2", status: "confirmed" }), ok(gEvent("e2", T0, T0 + 3_600_000))], { op: "update", args: ["e2", { summary: "x" }] });
  await add("update: an empty patch", [ok(hold("e1", "b-1", T0)), ok(hold("e1", "b-1", T0))], { op: "update", args: ["e1", {}] });
  await add("update: an empty summary is sent", [ok(hold("e1", "b-1", T0)), ok(hold("e1", "b-1", T0))], { op: "update", args: ["e1", { summary: "" }] });
  await add("update: an id and a calendar that need escaping", [ok(hold("e1", "b-1", T0)), ok(hold("e1", "b-1", T0))], { op: "update", args: ["e/1 é", { summary: "x" }] }, { calendarId: "a@b.c" });
  await add("update: missing (404 on the read) is an ApiError 404", [notFound()], { op: "update", args: ["nope", { summary: "x" }] });
  await add("update: gone (410 on the read)", [status(410, { error: { message: "gone" } })], { op: "update", args: ["gone", { summary: "x" }] });
  await add("update: cancelled on the read", [ok({ id: "e1", status: "cancelled" })], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: the read fails (500)", [status(500, { error: { message: "boom" } })], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: the patch fails (403)", [ok(hold("e1", "b-1", T0)), status(403, { error: { message: "no" } })], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: the patch is a 409", [ok(hold("e1", "b-1", T0)), status(409, { error: { message: "dup" } })], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: the patch's reply cannot be read", [ok(hold("e1", "b-1", T0)), ok({ id: "e1" })], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: the patch's reply is not a record", [ok(hold("e1", "b-1", T0)), { status: 200, text: "5" }], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: the patch's reply is lost", [ok(hold("e1", "b-1", T0)), { cut: true }], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: the patch is held for approval by Guard", [ok(hold("e1", "b-1", T0)), guardReply("held")], { op: "update", args: ["e1", { summary: "x" }] });
  await add("update: Guard refuses the read", [guardReply("refused_rule")], { op: "update", args: ["e1", { summary: "x" }] });

  // ---- delete
  await add("delete: an event", [{ status: 204 }], { op: "delete", args: ["e1"] }, tok);
  await add("delete: an id that needs escaping", [{ status: 204 }], { op: "delete", args: ["e/1 é@x"] });
  await add("delete: 200 with a body", [ok({})], { op: "delete", args: ["e1"] });
  await add("delete: 404 is done", [notFound()], { op: "delete", args: ["nope"] });
  await add("delete: 410 is done", [status(410, { error: { message: "gone" } })], { op: "delete", args: ["gone"] });
  await add("delete: a 403", [status(403, { error: { message: "no" } })], { op: "delete", args: ["e1"] });
  await add("delete: a 409 is an ApiError here, not a conflict", [status(409, { error: { message: "dup" } })], { op: "delete", args: ["e1"] });
  await add("delete: a 500 with an odd body", [{ status: 500, text: "oops" }], { op: "delete", args: ["e1"] });
  await add("delete: a reply that never comes", [{ hang: true }], { op: "delete", args: ["e1"] }, { timeoutMs: 150 });
  await add("delete: nothing listens", [], { op: "delete", args: ["e1"] }, { closed: true });
  for (const n of ["held", "refused_rule", "denied_by_approver", "already_done", "outcome_unknown", "busy", "suspended", "replayed"]) await add(`delete: Guard answer ${n}`, [guardReply(n)], { op: "delete", args: ["e1"] });

  // ---- freeBusy
  const fb = () => ok(fixture("google-freebusy.json"));
  await add("freeBusy: the shop's calendar", [fb()], { op: "freeBusy", args: [Date.UTC(2026, 10, 10), Date.UTC(2026, 10, 11)] }, tok);
  await add("freeBusy: a calendar that could not be read is not free", [fb()], { op: "freeBusy", args: [Date.UTC(2026, 10, 10), Date.UTC(2026, 10, 11)] }, { calendarId: "broken@example.com" });
  await add("freeBusy: a calendar the answer does not mention", [fb()], { op: "freeBusy", args: [0, 1] }, { calendarId: "other@example.com" });
  await add("freeBusy: errors with no reason, a record with no reason and junk", [ok({ calendars: { "shop@example.com": { errors: [{}, "x", { reason: 5 }, { reason: "backendError" }], busy: [] } } })], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: calendars is not a record", [ok({ calendars: [1] })], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: no calendars member", [ok({})], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: an entry that is not a record", [ok({ calendars: { "shop@example.com": "x" } })], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: no busy member is free", [ok({ calendars: { "shop@example.com": {} } })], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: busy that is not a list", [ok({ calendars: { "shop@example.com": { busy: "x" } } })], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: odd busy rows (junk, a bad date, a year-only number, a list)", [ok({ calendars: { "shop@example.com": { busy: ["x", { start: "2026-11-10T04:30:00Z", end: "2026-11-10T05:00:00.5Z" }, { start: "nope", end: "2026-11-10T05:00:00Z" }, { start: 2026, end: 2027 }, { start: ["2026-11-10T04:30:00Z"], end: [] }, { start: null, end: true }, { end: "2026-11-10T05:00:00Z" }, { start: "2026-11-10T04:30:00+0530", end: "2026-11-10 10:00:00+05:30" }] } } })], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: the id with characters in the body", [ok({ calendars: { "a b\"c@d.e": { busy: [] } } })], { op: "freeBusy", args: [0, 1] }, { calendarId: "a b\"c@d.e" });
  await add("freeBusy: a 404", [notFound()], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: a 409 is a conflict", [status(409, { error: { message: "dup" } })], { op: "freeBusy", args: [0, 1] });
  await add("freeBusy: no reply", [{ hang: true }], { op: "freeBusy", args: [0, 1] }, { timeoutMs: 150 });
  for (const n of guardNames) await add(`freeBusy: Guard answer ${n}`, [guardReply(n)], { op: "freeBusy", args: [0, 3_600_000] });
  return out;
}

// ---- the JavaScript behaviours the Go code copies -----------------------------------------------------------------------------------

export function jsVectors(): unknown {
  const dates = ["2026-11-10T18:00:00+05:30", "2026-11-10T18:00:00Z", "2026-11-10T18:00:00z", "2026-11-10t18:00:00Z", "2026-11-10T18:00:00.5Z", "2026-11-10T18:00:00.123456Z", "2026-11-10T18:00:00.999999Z", "2026-11-10T18:00Z", "2026-11-10T18:00+0530", "2026-11-10T18:00+05", "2026-11-10 18:00:00+05:30", "2026-11-10 18:00:00Z", "2026-11-10", "2026-11", "2026", "2026-02-30", "2026-02-30T10:00:00Z", "2026-02-29", "2024-02-29", "2026-13-01", "2026-11-31", "2026-00-10", "2026-11-00", "2026-11-10T24:00:00Z", "2026-11-10T24:00:00.000Z", "2026-11-10T24:00:01Z", "2026-11-10T24:01:00Z", "2026-11-10T25:00:00Z", "2026-11-10T18:60:00Z", "2026-11-10T18:00:60Z", "+002026-11-10T00:00:00Z", "-000001-01-01T00:00:00Z", "-000000-01-01T00:00:00Z", "+275760-09-13T00:00:00Z", "+275760-09-13T00:00:00.001Z", "-271821-04-20T00:00:00Z", "-271821-04-19T23:59:59.999Z", "", " 2026-11-10T18:00:00Z", "2026-11-10T18:00:00Z ", "2026-11-10T18", "2026-11-10T18:00:00+05:3", "2026-11-10T18:00:00+24:00", "2026-11-10T18:00:00+23:59", "2026-11-10T18:00:00+05:60", "2026-11-10T18:00:00-00:00", "Nov 10 2026", "1234567890123", "5", "-5", "2026.5", "true", "null", "undefined", "0000-01-01T00:00:00Z", "0099-01-01T00:00:00Z", "0100-01-01T00:00:00Z", "1969-12-31T23:59:59.999Z", "1900-01-01T00:00:00Z", "9999-12-31T23:59:59.999Z", "2026-11-10T18:00:00.Z", "2026-1-1", "2026-11-1", "2026-11-10T8:00:00Z", "2026-11-10T18:00:00 +05:30", "2026-11-10T18:00:00 Z", "2026-11-10T18:00:00.1Z", "2026-11-10T18:00:00.12Z", "2026-11-10T18:00:00,5Z", "2026-11-10T18:00:00+05:30:00", "２０２６-11-10", "2026-11-10T18:00:00\n", "2026-11-10Z", "2026-11-10+05:30"];
  const parse = dates.map((input) => { const t = Date.parse(input); return { input, ms: Number.isNaN(t) ? null : t }; });
  const instants = [0, 1, -1, 1793000000000, Date.UTC(2026, 10, 21, 5, 30), -62198755200000, -62135596800000, Date.UTC(9999, 11, 31, 23, 59, 59, 999), 253402300800000, -1234567, 8.64e15, -8.64e15, 8.64e15 + 1, -8.64e15 - 1, 9e15, Number.MAX_SAFE_INTEGER, -62167219200000, -62167219200001, 951782400000, 4107542400000];
  const iso = instants.map((ms) => { try { return { ms, iso: new Date(ms).toISOString() }; } catch (e) { return { ms, error: (e as Error).name + ": " + (e as Error).message }; } });
  const numbers = ["", " ", "0", "-0", "1793000000000", " 12 ", " 12 ", "﻿12", "1e3", "1E3", "1e", "e3", ".5", "5.", ".", "+5", "-5", "+-5", "0x10", "0X1f", "0o17", "0b101", "0b102", "0x", "-0x10", "+0x10", "1_000", "Infinity", "+Infinity", "-Infinity", "infinity", "NaN", "1 2", "12abc", "0.1e1", "1e400", "-1e400", "1.7976931348623157e308", "00012", "1,5", "١٢", "0x1fffffffffffff", "0xffffffffffffffffff", "9007199254740993", "1793000000000.5", "\t\n12\r\n", "1e-7", "٠"];
  const toNumber = numbers.map((input) => { const n = Number(input); return { input, number: Number.isNaN(n) ? "NaN" : n === Infinity ? "Infinity" : n === -Infinity ? "-Infinity" : Object.is(n, -0) ? "-0" : n }; });
  const jsons = ["null", "true", "false", "0", "-0", "1", "2026", "5.5", "1e21", "1e-7", "0.000001", "123456789012345680000", "1.5e300", "-1.5e-300", "12345678901234567890", "0.1", "100", "1e5", "\"text\"", "\"\"", "[]", "[1,2]", "[null,\"a\",[3,4]]", "[[]]", "{}", "{\"a\":1}", "1.7976931348623157e308", "4.9e-324", "123456789.123456789", "1e22", "5e-324", "999999999999999900000", "1e20"];
  const stringed = jsons.map((json) => ({ json, string: String(JSON.parse(json)) }));
  return { parse, iso, toNumber, stringed };
}

/** Raw Google events (and a calendar zone) through the exported toEvent, so the Go reader is held to the same answers outside of a recorded exchange. */
export function eventVectors(): unknown {
  const t = "2026-11-10T10:00:00+05:30";
  const base: any = { id: "x", start: { dateTime: t }, end: { dateTime: "2026-11-10T11:00:00+05:30" } };
  const raws: [string, any, string | undefined][] = [
    ["a timed event", base, undefined],
    ["tentative with a hold", { ...base, status: "tentative", extendedProperties: { private: { bookingRef: "b-1", holdExpiresAt: "1793000000000" } } }, undefined],
    ["cancelled", { ...base, status: "cancelled" }, undefined],
    ["a summary", { ...base, summary: "Dentist" }, undefined],
    ["all-day in Kolkata", { id: "d", start: { date: "2026-11-11" }, end: { date: "2026-11-12" } }, "Asia/Kolkata"],
    ["all-day, no zone", { id: "d", start: { date: "2026-11-11" }, end: { date: "2026-11-12" } }, undefined],
    ["no id", { start: { dateTime: t }, end: { dateTime: t } }, undefined],
    ["no end", { id: "x", start: { dateTime: t } }, undefined],
    ["a hold end of a negative number", { ...base, extendedProperties: { private: { bookingRef: "b", holdExpiresAt: "-5" } } }, undefined],
  ];
  return raws.map(([label, raw, zone]) => { const e = toEvent(raw, zone); return { label, raw, zone: zone ?? null, event: e ? JSON.parse(JSON.stringify(e)) : null }; });
}

// ---- the fake and the own list, driven through the same steps ---------------------------------------------------------------------------

type Step = { op: string; args?: any[] } | { inject: [string, string, { times?: number; after?: number }?] } | { foreign: [number, number, string?] } | { now: number };

/** A small seeded generator (the same sequence every run), so the random-looking scenarios are deterministic. */
function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function randomSteps(seed: number, count: number, faults: boolean, clock: boolean): Step[] {
  const r = lcg(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const steps: Step[] = [];
  const refs = ["b-1", "b-2", "b-3", "b-4"];
  const slot = () => { const s = T0 + Math.floor(r() * 12) * 15 * MIN; return [s, s + (1 + Math.floor(r() * 4)) * 15 * MIN] as const; };
  let ids = 0;
  for (let i = 0; i < count; i++) {
    const n = r();
    if (clock && n < 0.08) { steps.push({ now: T0 + Math.floor(r() * 6) * 24 * 3_600_000 }); continue; }
    if (faults && n < 0.2) {
      steps.push({ inject: [pick(["insert", "get", "list", "update", "delete", "freeBusy", "conflicts"]), pick(["silentFailure", "lostReply", "conflict", "error"]), r() < 0.5 ? { times: 1 + Math.floor(r() * 2), after: Math.floor(r() * 2) } : undefined] });
      continue;
    }
    const k = r();
    const [s, e] = slot();
    if (k < 0.3) { ids++; steps.push({ op: "insert", args: [{ summary: `s${i}`, start: s, end: e, status: pick(["tentative", "confirmed"]), bookingRef: pick(refs), ...(r() < 0.6 ? { holdExpiresAt: s - 30 * MIN } : {}) }] }); }
    else if (k < 0.4 && faults) steps.push({ foreign: [s, e, r() < 0.5 ? "Owner" : undefined] });
    else if (k < 0.55) steps.push({ op: "update", args: [`${clock ? "own" : "ev"}_${1 + Math.floor(r() * (ids + 2))}`, pick<any>([{ status: "confirmed", holdExpiresAt: null }, { start: s, end: e }, { summary: "moved" }, { status: "tentative", holdExpiresAt: s }, {}, { holdExpiresAt: null }])] });
    else if (k < 0.65) steps.push({ op: "get", args: [`${clock ? "own" : "ev"}_${1 + Math.floor(r() * (ids + 2))}`] });
    else if (k < 0.75) steps.push({ op: "delete", args: [`${clock ? "own" : "ev"}_${1 + Math.floor(r() * (ids + 2))}`] });
    else if (k < 0.85) steps.push({ op: "list", args: [pick<any>([{}, { bookingRef: pick(refs) }, { from: s, to: e }, { from: s }, { to: e }, { bookingRef: pick(refs), from: T0, to: T0 + 4 * 3_600_000 }])] });
    else if (k < 0.93) steps.push({ op: "conflicts", args: [s, e] });
    else steps.push({ op: "freeBusy", args: [s - 30 * MIN, e + 30 * MIN] });
  }
  return steps;
}

const plain = <T>(v: T): any => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

async function runSteps(cal: any, steps: Step[], clock: { now: number } | undefined, extra: { foreign?: boolean }): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const step of steps) {
    if ("now" in step) { clock!.now = step.now; results.push(null); continue; }
    if ("inject" in step) { cal.inject(step.inject[0], step.inject[1], step.inject[2]); results.push(null); continue; }
    if ("foreign" in step) { results.push(plain(cal.addForeignEvent(...step.foreign))); continue; }
    const args = step.op === "update" ? [step.args![0], toPatch(step.args![1])] : step.args ?? [];
    try { const v = await cal[step.op](...args); results.push({ ok: plain(v) }); } catch (e) { results.push({ error: plain(describeError(e)) }); }
  }
  return results;
}

export async function fakeScenarios(): Promise<unknown[]> {
  const scripted: [string, Step[]][] = [
    ["insert, read back, move, confirm, delete", [
      { op: "insert", args: [{ summary: "a", start: T0, end: T0 + 45 * MIN, status: "tentative", bookingRef: "b-1", holdExpiresAt: T0 }] },
      { op: "get", args: ["ev_1"] }, { op: "list", args: [{ bookingRef: "b-1" }] },
      { op: "update", args: ["ev_1", { status: "confirmed", holdExpiresAt: null }] }, { op: "get", args: ["ev_1"] },
      { op: "conflicts", args: [T0, T0 + 1] }, { op: "conflicts", args: [T0 + 45 * MIN, T0 + 50 * MIN] }, { op: "freeBusy", args: [T0 - MIN, T0 + MIN] },
      { op: "delete", args: ["ev_1"] }, { op: "delete", args: ["ev_1"] }, { op: "get", args: ["ev_1"] }, { op: "update", args: ["ev_1", { summary: "x" }] }]],
    ["each fault on insert", [
      { inject: ["insert", "silentFailure"] }, { op: "insert", args: [{ summary: "a", start: T0, end: T0 + MIN, status: "tentative", bookingRef: "b-1" }] },
      { inject: ["insert", "lostReply"] }, { op: "insert", args: [{ summary: "b", start: T0, end: T0 + MIN, status: "tentative", bookingRef: "b-2" }] },
      { inject: ["insert", "conflict"] }, { op: "insert", args: [{ summary: "c", start: T0, end: T0 + MIN, status: "tentative", bookingRef: "b-3" }] },
      { inject: ["insert", "error"] }, { op: "insert", args: [{ summary: "d", start: T0, end: T0 + MIN, status: "tentative", bookingRef: "b-4" }] },
      { op: "list", args: [{}] }]],
    ["faults on the other calls, with times and after", [
      { op: "insert", args: [{ summary: "a", start: T0, end: T0 + MIN, status: "confirmed", bookingRef: "b-1" }] },
      { inject: ["update", "silentFailure"] }, { op: "update", args: ["ev_1", { summary: "silent" }] }, { op: "get", args: ["ev_1"] },
      { inject: ["update", "lostReply"] }, { op: "update", args: ["ev_1", { summary: "lost" }] }, { op: "get", args: ["ev_1"] },
      { inject: ["delete", "silentFailure"] }, { op: "delete", args: ["ev_1"] }, { op: "get", args: ["ev_1"] },
      { inject: ["delete", "lostReply"] }, { op: "delete", args: ["ev_1"] }, { op: "get", args: ["ev_1"] },
      { inject: ["list", "error", { times: 2, after: 1 }] }, { op: "list", args: [{}] }, { op: "list", args: [{}] }, { op: "list", args: [{}] }, { op: "list", args: [{}] },
      { inject: ["get", "silentFailure"] }, { op: "get", args: ["ev_1"] },
      { inject: ["freeBusy", "error"] }, { op: "freeBusy", args: [0, 1] }, { op: "freeBusy", args: [0, 1] },
      { inject: ["conflicts", "lostReply"] }, { op: "conflicts", args: [0, 1] },
      { inject: ["update", "error"] }, { op: "update", args: ["missing", {}] }, { op: "update", args: ["missing", {}] },
      { inject: ["insert", "error", { times: 0 }] }, { op: "insert", args: [{ summary: "z", start: 1, end: 2, status: "tentative", bookingRef: "z" }] }, { op: "insert", args: [{ summary: "z", start: 1, end: 2, status: "tentative", bookingRef: "z" }] }]],
    ["foreign events block time", [
      { foreign: [T0, T0 + 60 * MIN] }, { foreign: [T0 + 120 * MIN, T0 + 180 * MIN, "Dentist"] },
      { op: "conflicts", args: [T0 + 30 * MIN, T0 + 150 * MIN] }, { op: "freeBusy", args: [T0, T0 + 200 * MIN] }, { op: "list", args: [{ bookingRef: "foreign" }] }, { op: "list", args: [{ from: T0 + 60 * MIN }] }]],
  ];
  const out: unknown[] = [];
  for (const [name, steps] of scripted) out.push(await runFake(name, steps));
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) out.push(await runFake(`random sequence ${seed}`, randomSteps(seed, 60, true, false)));
  return out;
}

async function runFake(name: string, steps: Step[]) {
  const cal = createFakeCalendar();
  const results = await runSteps(cal, steps, undefined, {});
  return { name, steps, results, events: plain(cal.events()), calls: cal.calls.map((c) => c.op) };
}

export async function ownScenarios(): Promise<unknown[]> {
  const out: unknown[] = [];
  const run = async (name: string, initial: any, now: number, steps: Step[]) => {
    const store: any = initial === undefined ? {} : { ownCalendar: structuredClone(initial) };
    const clock = { now };
    const cal = createOwnCalendar(store, () => clock.now);
    const results = await runSteps(cal, steps, clock, {});
    const events = store.ownCalendar?.events ?? {};
    return { name, initial: initial ?? null, now, steps, results, state: plain(store.ownCalendar ?? null), order: Object.keys(events) };
  };
  const old = { summary: "old", start: T0 - 10 * 86_400_000, end: T0 - 10 * 86_400_000 + MIN, status: "confirmed", bookingRef: "b-0", id: "own_1" };
  const recent = { summary: "recent", start: T0 - 86_400_000, end: T0 - 86_400_000 + MIN, status: "tentative", bookingRef: "b-9", holdExpiresAt: T0, id: "own_2" };
  out.push(await run("a fresh list: insert, read, confirm drops the hold, delete", undefined, T0, [
    { op: "insert", args: [{ summary: "a", start: T0, end: T0 + 45 * MIN, status: "tentative", bookingRef: "b-1", holdExpiresAt: T0 }] },
    { op: "get", args: ["own_1"] }, { op: "list", args: [{ bookingRef: "b-1" }] },
    { op: "update", args: ["own_1", { status: "confirmed" }] }, { op: "get", args: ["own_1"] },
    { op: "update", args: ["own_1", { status: "tentative", holdExpiresAt: T0 }] }, { op: "get", args: ["own_1"] },
    { op: "update", args: ["own_1", { holdExpiresAt: null }] }, { op: "get", args: ["own_1"] },
    { op: "update", args: ["nope", { summary: "x" }] }, { op: "delete", args: ["own_1"] }, { op: "delete", args: ["own_1"] }, { op: "list", args: [{}] }, { op: "conflicts", args: [0, 1] }]));
  out.push(await run("an existing list is pruned on insert, ids go on from next", { events: { own_1: old, own_2: recent }, next: 3 }, T0, [
    { op: "list", args: [{}] }, { op: "insert", args: [{ summary: "n", start: T0, end: T0 + MIN, status: "confirmed", bookingRef: "b-3" }] }, { op: "list", args: [{}] }]));
  out.push(await run("a list is pruned two days after the end, not before", { events: { own_1: old, own_2: recent }, next: 3 }, T0 + 3 * 86_400_000, [
    { op: "insert", args: [{ summary: "n", start: T0, end: T0 + MIN, status: "confirmed", bookingRef: "b-3" }] }, { op: "list", args: [{}] }]));
  out.push(await run("an empty saved list with next 1", { events: {}, next: 1 }, T0, [{ op: "freeBusy", args: [0, 1] }, { op: "insert", args: [{ summary: "n", start: T0, end: T0 + MIN, status: "confirmed", bookingRef: "b-3" }] }]));
  out.push(await run("overlap edges: end is exclusive, start is exclusive of the other's end", undefined, T0, [
    { op: "insert", args: [{ summary: "a", start: T0, end: T0 + 60 * MIN, status: "confirmed", bookingRef: "b-1" }] },
    { op: "conflicts", args: [T0 + 60 * MIN, T0 + 90 * MIN] }, { op: "conflicts", args: [T0 - 30 * MIN, T0] }, { op: "conflicts", args: [T0 + 59 * MIN, T0 + 61 * MIN] }, { op: "freeBusy", args: [T0 - 1, T0 + 1] },
    { op: "list", args: [{ from: T0 + 60 * MIN }] }, { op: "list", args: [{ from: T0 + 59 * MIN }] }, { op: "list", args: [{ to: T0 }] }, { op: "list", args: [{ to: T0 + 1 }] }]));
  for (const seed of [21, 22, 23, 24, 25, 26, 27, 28]) out.push(await run(`random sequence ${seed}`, seed % 2 === 0 ? { events: { own_1: old, own_2: recent }, next: 3 } : undefined, T0, randomSteps(seed, 70, false, true)));
  return out;
}

export async function files(): Promise<[string, unknown][]> {
  // Date.parse reads a date and time with no offset as the computer's LOCAL time, so what Node answers for such a string depends on where the generator runs. The vectors are made
  // with the zone set to UTC (which is what the Go code reads such a string as, and what a shop's computer runs on), so they are the same on every machine.
  const was = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    return [
      ["calendar/testdata/calendar-vectors.json", { cases: await cases() }],
      ["calendar/testdata/js-vectors.json", jsVectors()],
      ["calendar/testdata/event-vectors.json", eventVectors()],
      ["calendar/testdata/fake-vectors.json", await fakeScenarios()],
      ["calendar/testdata/own-vectors.json", await ownScenarios()],
    ];
  } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}
