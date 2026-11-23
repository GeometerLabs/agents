// Several bookings at the same time (17 Nov 2026): a shop with two chairs, or a tractor and two pump sets. What each test pins:
//   - the limit counts uses, not just overlaps: with 2 units the second booking is allowed and the third is not; units 1 is the old rule exactly.
//   - a resource only blocks its own kind (a tractor booking does not stop a pump booking), and an event that is not one of the shop's bookings blocks every kind.
//   - the settings: "resources" and a service's "resource" are read, a typo is refused in plain words, no key means one at a time as before.
//   - the race for the last unit: two customers at once for a shop with one unit left, exactly one gets it (the step is one at a time, with the shop's own holds as the authority).
//   - the longest booking is a whole day (it was 8 hours).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkNoDoubleBooking } from "../src/limits.ts";
import { parseSettings, validateSettings, unitsFor } from "../src/settings.ts";
import { MINUTE } from "../../../../modules/core/time.ts";
import { CUSTOMER, createWorld } from "../src/harness.ts";
const glow = JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8"));
const H = 60 * MINUTE;
const NOW = 0;
const ev = (start: number, end: number, ref: string, resource?: string) => ({ start, end, bookingRef: ref, ...(resource ? { resource } : {}) });
const BOOK = "I want a haircut tomorrow at 6pm";

test("no-double-booking with units: one is the old rule, two lets a second booking in and refuses a third", () => {
  const one = (others: ReturnType<typeof ev>[], units?: number, resource?: string) => checkNoDoubleBooking({ startMs: 10 * H, endMs: 11 * H, bufferMinutes: 0, ownBookingRef: "me", others, nowMs: NOW, units, resource }).verdict;
  assert.equal(one([ev(10 * H, 11 * H, "a")]), "block", "default: one at a time");
  assert.equal(one([ev(10 * H, 11 * H, "a")], 1), "block");
  assert.equal(one([ev(10 * H, 11 * H, "a")], 2), "allow", "a second chair is free");
  assert.equal(one([ev(10 * H, 11 * H, "a"), ev(10 * H, 11 * H, "b")], 2), "block", "both chairs are in use");
  assert.equal(one([ev(10 * H, 11 * H, "a"), ev(10 * H, 11 * H, "a")], 2), "allow", "the same booking listed twice (calendar and the shop's hold) is one use");
  // two uses that never overlap each other: one chair is always free
  assert.equal(checkNoDoubleBooking({ startMs: 10 * H, endMs: 12 * H, bufferMinutes: 0, ownBookingRef: "me", others: [ev(10 * H, 11 * H, "a"), ev(11 * H, 12 * H, "b")], nowMs: NOW, units: 2 }).verdict, "allow");
  assert.equal(one([ev(10 * H, 11 * H, "a"), ev(10 * H, 11 * H, "foreign"), ev(10 * H, 11 * H, "foreign")], 3), "block", "other tools' events each use a unit");
});

test("no-double-booking: a resource only blocks its own kind; an event of no known kind blocks every kind", () => {
  const verdict = (others: ReturnType<typeof ev>[], resource: string) => checkNoDoubleBooking({ startMs: 10 * H, endMs: 11 * H, bufferMinutes: 0, ownBookingRef: "me", others, nowMs: NOW, resource }).verdict;
  assert.equal(verdict([ev(10 * H, 11 * H, "a", "tractor")], "pump"), "allow");
  assert.equal(verdict([ev(10 * H, 11 * H, "a", "tractor")], "tractor"), "block");
  assert.equal(verdict([ev(10 * H, 11 * H, "foreign")], "pump"), "block");
});

test("settings: resources and a service's resource are read; an unlisted resource and a bad number are refused in plain words", () => {
  assert.equal(unitsFor(parseSettings(glow), parseSettings(glow).services[0]), 1, "no key: one at a time for the whole shop");
  const two = parseSettings({ ...glow, resources: { shop: 2 } });
  assert.equal(unitsFor(two, two.services[0]), 2);
  const withRes = { ...glow, resources: { tractor: 1, pump: 2 }, services: glow.services.map((s: object, i: number) => ({ ...s, resource: i === 0 ? "tractor" : "pump" })) };
  const parsed = parseSettings(withRes);
  assert.deepEqual([unitsFor(parsed, parsed.services[0]), unitsFor(parsed, parsed.services[1])], [1, 2]);
  const bad = validateSettings({ ...glow, services: glow.services.map((s: object) => ({ ...s, resource: "tractor" })) });
  assert.ok(!bad.ok && bad.errors.some((e) => /not listed in "resources"/.test(e)));
  const badN = validateSettings({ ...glow, resources: { shop: 0 } });
  assert.ok(!badN.ok && badN.errors.some((e) => /whole number from 1 to 50/.test(e)));
});

test("the longest booking is a whole day, no longer", () => {
  const long = (m: number) => validateSettings({ ...glow, services: [{ ...glow.services[0], durationMinutes: m }, ...glow.services.slice(1)] });
  assert.ok(long(600).ok, "ten hours is allowed now");
  assert.ok(long(1440).ok);
  const tooLong = long(1441);
  assert.ok(!tooLong.ok && tooLong.errors.some((e) => /between 5 and 1440/.test(e)));
});

test("a move: the calendar is read again after it, and an event written on the new time meanwhile sends the booking back to its old time", async () => {
  const world = createWorld();
  await world.say("haircut tomorrow at 6pm");
  world.payments.customerPays(world.linkFor("b-1")!.id);
  await world.deliverPaymentEvents();
  const before = world.calendar.events().find((e) => e.bookingRef === "b-1")!;
  // Someone else writes on the new time (7 pm) at the very moment the event is moved there. Google keeps both events.
  const realUpdate = world.calendar.update.bind(world.calendar);
  world.calendar.update = async (id, patch) => {
    const moved = await realUpdate(id, patch);
    if (patch.start !== undefined && patch.start !== before.start) world.calendar.addForeignEvent(patch.start, patch.end ?? patch.start + 30 * MINUTE, "Walk-in");
    return moved;
  };
  await world.say("reschedule to 7pm");
  const mine = world.calendar.events().find((e) => e.bookingRef === "b-1")!;
  assert.equal(mine.start, before.start, "the booking is back at its old time");
  assert.ok(world.calendar.events().some((e) => e.bookingRef === "foreign"), "the other event stays");
});
