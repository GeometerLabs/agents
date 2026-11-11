// B72 (12 Nov 2026): Google Calendar is optional for Bookings. A shop whose settings say {"calendar": {"module": "own"}} runs on its own booking list:
//   - a booking is held, paid and confirmed with no Google Calendar at all, and the record says it was read from the shop's own list;
//   - the double-booking rule still holds on that list (the second customer is told the time is taken);
//   - the owner sends "today" or "tomorrow" and gets that day's bookings, in the owner's language, and nothing for a day with none;
//   - a Google Calendar added later is filled from the booking list once, nothing is lost or doubled, and the booking stays booked;
//   - settings without a "calendar" key are Google Calendar shops, as before, and a malformed key is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, CUSTOMER, OTHER_CUSTOMER } from "../src/harness.ts";
import { createAgent } from "../src/agent.ts";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { calendarModule, validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { serializeStore, parseStore } from "../server/snapshot.ts";
import { guardsOf, hasCalendar } from "../../../../bundle/lib/kinds.ts";
import { KINDS } from "../../../../bundle/lib/kinds.ts";

const example = JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8"));
const parse = (extra: object): Settings => { const r = validateSettings({ ...example, ...extra }); assert.ok(r.ok, JSON.stringify(r)); return (r as { settings: Settings }).settings; };
const own = parse({ calendar: { module: "own" } });
const BOOK = "haircut tomorrow at 6pm";

async function bookedWorld(extra: { settings?: Settings } = {}) {
  const w = createWorld({ settings: extra.settings ?? own, ownCalendar: true });
  await w.say(BOOK);
  await w.ownerMarksReceived("b-1");
  return w;
}

test("a booking is held, paid and confirmed on the shop's own list, with no Google Calendar, and the record says where it was read from", async () => {
  const w = await bookedWorld();
  assert.equal(w.store.bookings.get("b-1")?.state, "confirmed");
  assert.equal(w.store.ownCalendar && Object.keys(w.store.ownCalendar.events).length, 1);
  const confirmed = w.record.entries().find((e) => e.action === "confirm_booking" && e.outcome === "confirmed");
  assert.match(confirmed?.notes ?? "", /shop's own booking list/u);
  assert.match(w.textsTo(CUSTOMER).join("\n"), /Booked!/u);
});

test("the second customer cannot take the same time on the own list", async () => {
  const w = await bookedWorld();
  await w.say(BOOK, { from: OTHER_CUSTOMER });
  assert.match(w.lastTextTo(OTHER_CUSTOMER), /not available|can't|taken/iu);
  assert.equal(w.store.bookings.get("b-2")?.state === "confirmed", false);
});

test("the owner asks for the day's bookings: tomorrow lists the booking, today says there are none", async () => {
  const w = await bookedWorld();
  await w.say("tomorrow", { from: w.owner });
  const listed = w.lastTextTo(w.owner);
  assert.match(listed, /Your bookings tomorrow:/u);
  assert.match(listed, new RegExp(`${CUSTOMER.replace("+", "\\+")} \\(b-1\\)`, "u"));
  await w.say("today", { from: w.owner });
  assert.equal(w.lastTextTo(w.owner), "No bookings today.");
  assert.ok(w.record.entries().some((e) => e.action === "owner_day_list" && e.outcome === "confirmed"), "the record keeps that the owner asked");
});

test("a customer who writes 'today' is a customer, not the owner: no day list goes to them", async () => {
  const w = await bookedWorld();
  await w.say("today", { from: OTHER_CUSTOMER });
  assert.doesNotMatch(w.textsTo(OTHER_CUSTOMER).join("\n"), /Your bookings/u);
});

test("the own list survives a restart: it is part of the saved state", async () => {
  const w = await bookedWorld();
  const back = parseStore(serializeStore(w.store));
  assert.deepEqual(back.ownCalendar, w.store.ownCalendar);
});

test("adding a Google Calendar later writes the coming bookings to it once and loses none", async () => {
  const w = await bookedWorld();
  await w.tick(); // an own-list shop remembers that its bookings are on the list
  assert.deepEqual(w.store.calendarState, { kind: "own" });
  const google = createFakeCalendar();
  const later = createAgent({ settings: parse({ calendar: { module: "google" } }), clock: w.clock, calendar: google, payments: w.payments, messaging: w.messaging, parser: createRuleParser(), record: w.record, store: w.store });
  await later.handle({ kind: "tick" });
  assert.equal(google.events().filter((e) => e.bookingRef === "b-1" && e.status === "confirmed").length, 1);
  assert.deepEqual(w.store.calendarState, { kind: "google" });
  assert.equal(w.store.bookings.get("b-1")?.state, "confirmed", "still booked");
  await later.handle({ kind: "tick" });
  assert.equal(google.events().filter((e) => e.bookingRef === "b-1").length, 1, "a second beat writes nothing more");
});

test("settings: no calendar key is a Google Calendar shop; a malformed one is refused; the own list drops the calendar Guard", () => {
  assert.equal(calendarModule(parse({})), "google");
  assert.equal(calendarModule(own), "own");
  assert.equal(validateSettings({ ...example, calendar: { module: "paper" } }).ok, false);
  assert.equal(validateSettings({ ...example, calendar: "own" }).ok, false);
  assert.ok(guardsOf(KINDS.bookings, parse({})).includes("calendar"));
  assert.ok(!guardsOf(KINDS.bookings, own).includes("calendar"));
  assert.equal(hasCalendar(KINDS.bookings, own), false);
  assert.equal(hasCalendar(KINDS.bookings, parse({ calendar: { module: "google" } })), true);
});
