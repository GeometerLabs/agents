// Two customers for the last slot at the same moment: only one may get it (plan checkpoint item 8, 11 Nov 2026; docs/product/intent-and-outcomes.md, "Candidate failure
// tests"). What makes it so, and what each test pins:
//   - one message at a time: the runtime never runs two steps of a shop together (modules/runtime/tasks.ts), so the look at the slot and the hold a step makes are never
//     split by another customer's step. Pinned by holding a step half-way and showing the other customer's step has not started.
//   - the hold is the booking's own: the shop's saved bookings say which times are held (agent.ts, heldByBookings), not only the calendar's list. Shown with a calendar
//     whose list never shows a hold: before 11 Nov both customers got the time; now the second is told it is taken.
//   - the calendar is read again after the hold is written: Google takes an overlapping event without a word, so an event someone else wrote at the same moment makes
//     this booking let go of the time and offer another, and a read that fails keeps nothing.
//   - a hold nobody pays ends by itself, and the time can be booked again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER } from "../src/harness.ts";
import { ApiError } from "../../../../modules/core/faults.ts";
import type { Calendar } from "../src/adapters/calendar.ts";
import type { RuntimeEvent } from "../../../../modules/runtime/events.ts";
import { createKit } from "./runtime-kit.ts";
import type { Kit } from "./runtime-kit.ts";

const BOOK = "I want a haircut tomorrow at 6pm";
const OTHER = "+919822222222";
const told = (kit: Kit, phone: string) => kit.messaging.sentTo(phone).map((m) => m.text).join("\n");
/** The calendar's events on the asked time (tomorrow, 6 pm): the haircut is 30 minutes. */
const onTheTime = (kit: Kit) => kit.calendar.events().filter((e) => e.start === kit.calendar.events()[0]?.start);
const entriesOf = (db: ReturnType<Kit["open"]>["db"], action: string) => db.loadState().record.filter((e) => e.action === action);

test("one message at a time: while one customer's step is half-way, the other customer's step has not started", async () => {
  const kit = createKit();
  let started = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const { runtime } = kit.open({
    async aroundStep(event: RuntimeEvent, run) {
      if (event.kind !== "message") return run();
      started++;
      if (started === 1) await held; // the first customer's step stops here, before it has looked at the calendar
      return run();
    },
  });
  try {
    runtime.submit([{ kind: "message", message: kit.messaging.receive(CUSTOMER, BOOK) }, { kind: "message", message: kit.messaging.receive(OTHER, BOOK) }]);
    runtime.kick();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.equal(started, 1, "the second step waits for the first to end");
    release();
    await runtime.idle();
    assert.equal(started, 2);
    assert.equal(runtime.status().tasks.done, 2);
  } finally { await runtime.close(); kit.cleanup(); }
});

test("two customers ask for the same time at the same moment: one gets it, the other is told it is taken and offered others", async () => {
  const kit = createKit();
  const { runtime } = kit.open();
  try {
    await Promise.all([kit.say(runtime, BOOK), kit.say(runtime, BOOK, { from: OTHER })]);
    assert.equal(onTheTime(kit).length, 1, "one hold on the time");
    assert.deepEqual(runtime.status().bookings.awaiting_deposit, 1);
    assert.match(told(kit, CUSTOMER), /₹200/u, "the first asked gets the deposit link");
    assert.match(told(kit, OTHER), /not available/u);
    assert.equal(kit.payments.links().length, 1, "and only one deposit link was made");
  } finally { await runtime.close(); kit.cleanup(); }
});

test("a calendar whose list does not show the first hold: the second customer is still refused, by the shop's own bookings", async () => {
  const kit = createKit();
  // A list that lags behind a write (or a hold whose write never showed there): the calendar never shows a tentative event to the look before a hold.
  const lagging: Calendar = new Proxy(kit.calendar, {
    get(t, property) {
      if (property === "conflicts") return async (start: number, end: number) => (await t.conflicts(start, end)).filter((e) => e.status !== "tentative");
      return Reflect.get(t, property, t);
    },
  });
  const { runtime, db } = kit.open({ services: { calendar: lagging, payments: kit.payments, messaging: kit.messaging } });
  try {
    await kit.say(runtime, BOOK);
    await kit.say(runtime, BOOK, { from: OTHER });
    assert.equal(kit.calendar.events().length, 1, "no second hold");
    assert.equal(kit.payments.links().length, 1);
    assert.match(told(kit, OTHER), /not available/u);
    const blocked = entriesOf(db, "hold_slot").filter((e) => e.outcome === "blocked");
    assert.equal(blocked.length, 1);
    assert.ok(blocked[0].decisions.some((d) => d.ruleId === "no-double-booking" && d.verdict === "block"), "the double-booking limit said no");
  } finally { await runtime.close(); kit.cleanup(); }
});

test("someone else writes an event on the same time while the hold is written: the hold is let go, and the customer is offered another time", async () => {
  const kit = createKit();
  // The owner (or another booking channel) writes on the same time at the same moment. Google keeps both events.
  const raced: Calendar = new Proxy(kit.calendar, {
    get(t, property) {
      if (property === "insert") return async (event: Parameters<Calendar["insert"]>[0]) => { const made = await t.insert(event); t.addForeignEvent(event.start, event.end, "Walk-in"); return made; };
      return Reflect.get(t, property, t);
    },
  });
  const { runtime, db } = kit.open({ services: { calendar: raced, payments: kit.payments, messaging: kit.messaging } });
  try {
    await kit.say(runtime, BOOK);
    assert.deepEqual(kit.calendar.events().map((e) => e.bookingRef), ["foreign"], "this booking's hold was taken away again; the other event stays");
    assert.equal(kit.payments.links().length, 0, "no deposit link for a time that is not held");
    assert.match(told(kit, CUSTOMER), /not available/u);
    assert.equal(runtime.status().bookings.awaiting_deposit, undefined);
    assert.deepEqual(entriesOf(db, "hold_slot").map((e) => e.outcome), ["attempted", "blocked"], "the record shows the shop's hold, then why it was let go");
    assert.match(entriesOf(db, "hold_slot")[1].notes ?? "", /another event was written on this time/u);
    assert.deepEqual(entriesOf(db, "release_slot").map((e) => e.outcome), ["confirmed"]);
  } finally { await runtime.close(); kit.cleanup(); }
});

test("the calendar cannot be read again after the hold is written: the hold is not kept, and nothing is booked", async () => {
  const kit = createKit();
  let looks = 0;
  const failing: Calendar = new Proxy(kit.calendar, {
    get(t, property) {
      if (property === "conflicts") return async (start: number, end: number) => { if (++looks === 2) throw new ApiError(503, "calendar conflicts: backend error"); return t.conflicts(start, end); };
      return Reflect.get(t, property, t);
    },
  });
  const { runtime, db } = kit.open({ services: { calendar: failing, payments: kit.payments, messaging: kit.messaging } });
  try {
    await kit.say(runtime, BOOK);
    assert.equal(looks, 2, "the look before the hold, and the look after it");
    assert.equal(kit.calendar.events().length, 0);
    assert.equal(kit.payments.links().length, 0);
    assert.match(told(kit, CUSTOMER), /couldn't hold/u);
    assert.deepEqual(entriesOf(db, "hold_slot").map((e) => e.outcome), ["attempted", "unconfirmed"]);
  } finally { await runtime.close(); kit.cleanup(); }
});

test("a hold nobody pays ends by itself: the time is free again for the next customer", async () => {
  const kit = createKit();
  const { runtime } = kit.open();
  try {
    await kit.say(runtime, BOOK);
    kit.clock.advance(16 * 60_000); // the hold is 15 minutes
    await runtime.tick();
    assert.equal(runtime.status().bookings.expired, 1);
    await kit.say(runtime, BOOK, { from: OTHER });
    assert.match(told(kit, OTHER), /₹200/u, "the next customer gets the time");
    assert.equal(runtime.status().bookings.awaiting_deposit, 1);
  } finally { await runtime.close(); kit.cleanup(); }
});
