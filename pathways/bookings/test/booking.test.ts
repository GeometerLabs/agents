import { test } from "node:test";
import assert from "node:assert/strict";
import { canMove, createStore, factsFor, latestBooking, moveTo, newDraft, register, reminderSchedule } from "../src/booking.ts";
import { glowSalon } from "../src/harness.ts";
import { HOUR, zonedToMs } from "../src/time.ts";

const settings = glowSalon();

test("the states move only along the flow", () => {
  assert.ok(canMove("enquiry", "confirming_details"));
  assert.ok(canMove("confirming_details", "awaiting_deposit"));
  assert.ok(canMove("awaiting_deposit", "confirmed"));
  assert.ok(canMove("awaiting_deposit", "needs_owner"));
  assert.ok(canMove("needs_owner", "confirmed"));
  assert.ok(canMove("confirmed", "confirmed")); // a reschedule
  assert.ok(canMove("expired", "awaiting_deposit")); // a late payment re-holds the slot
  assert.ok(!canMove("enquiry", "confirmed")); // no booking without a hold and a deposit
  assert.ok(!canMove("awaiting_deposit", "completed"));
  assert.ok(!canMove("cancelled", "confirmed")); // finished is finished
  assert.ok(!canMove("completed", "cancelled"));
});

test("moveTo refuses a move the flow does not allow", () => {
  const b = register(createStore(), newDraft("+911", "en"));
  assert.throws(() => moveTo(b, "confirmed"), /cannot go from enquiry to confirmed/);
  moveTo(b, "awaiting_deposit");
  moveTo(b, "confirmed");
  assert.equal(b.state, "confirmed");
});

test("bookings get ids in order and the latest one in a state is found", () => {
  const store = createStore();
  const a = register(store, newDraft("+911", "en"));
  const b = register(store, newDraft("+911", "en"));
  register(store, newDraft("+912", "en"));
  assert.deepEqual([a.id, b.id], ["b-1", "b-2"]);
  assert.equal(latestBooking(store, "+911", ["enquiry"])?.id, "b-2");
  assert.equal(latestBooking(store, "+911", ["confirmed"]), undefined);
});

test("a message other than the menu may state only this booking's own service and price", () => {
  const b = newDraft("+911", "en");
  b.serviceId = "haircut";
  const own = factsFor(settings, b, "en");
  assert.deepEqual(own.services, [{ name: "haircut", priceInr: 450 }]);
  const menu = factsFor(settings, b, "en", { menu: true });
  assert.equal(menu.services.length, settings.services.length);
  assert.deepEqual(factsFor(settings, null, "en").services, []); // no service chosen yet: no prices at all
});

test("facts carry the Hindi names and the values from the settings and the booking", () => {
  const b = register(createStore(), newDraft("+911", "hi"));
  b.serviceId = "facial";
  b.startMs = zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 18, minute: 0 }, settings.timezone);
  b.linkUrl = "https://rzp.io/l/plink1";
  const f = factsFor(settings, b, "hi");
  assert.equal(f.serviceName, "फेशियल");
  assert.equal(f.priceInr, 900);
  assert.equal(f.depositInr, 200);
  assert.equal(f.holdMinutes, 15);
  assert.equal(f.windowHours, 24);
  assert.equal(f.bookingRef, "b-1");
  assert.equal(f.link, "https://rzp.io/l/plink1");
});

test("reminders are due at 24 and 2 hours before, and a reminder already in the past is skipped", () => {
  const start = zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 18, minute: 0 }, settings.timezone);
  assert.deepEqual(reminderSchedule(settings, start, start - 48 * HOUR).map((r) => r.atMs), [start - 24 * HOUR, start - 2 * HOUR]);
  assert.deepEqual(reminderSchedule(settings, start, start - 5 * HOUR).map((r) => r.atMs), [start - 2 * HOUR]);
  assert.deepEqual(reminderSchedule(settings, start, start - HOUR), []);
});
