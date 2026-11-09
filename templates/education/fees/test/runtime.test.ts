// The Fees runtime keeps the agent honest across restarts: steps are saved whole, run one at a time in order, retried when they fail, and picked up again after a restart.
// The fakes stand for the outside world, so they keep their state across a "restart"; everything the runtime owns is in the temp directory and is rebuilt from it.
// The shared parts (the queue, the store, the retries) are also tried through Bookings; what is Fees' own is tried here: a store with its own fields, and a month that has
// to be chased AFTER a restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { createWorld } from "../src/harness.ts";
import { createStore } from "../src/due.ts";
import { parseStore, serializeStore, skipStoreCounters } from "../server/snapshot.ts";
import { PARENT, createKit } from "./runtime-kit.ts";

const at = (day: number, hour: number, minute = 0, month = 11) => zonedToMs({ year: 2026, month, day }, { hour, minute }, "Asia/Kolkata");

test("a month chased after a restart: the day the agent first ran is remembered, so the reminders still go out on the reminder day", async () => {
  const kit = createKit();
  try {
    // 09:00 on the 2nd: the first tick. The agent notes the day it first ran, and nothing is due yet (reminders are at 10:00).
    const first = kit.open();
    await first.runtime.tick();
    assert.equal(kit.messaging.outbox().length, 0);
    first.db.close(); // the process is gone: the runtime, the store, the agent

    // A new process, a few hours later (the process was down over the 10:00 reminder moment). If the first run's day had not been saved, THIS tick would believe the
    // agent had only just started, and a month whose first reminder moment is before that is not chased: nothing would go out.
    kit.clock.set(at(2, 13));
    const second = kit.open();
    await second.runtime.tick();
    const sent = kit.messaging.outbox().filter((m) => m.to === PARENT);
    assert.equal(sent.length, 2, "the Sharmas have two children: one reminder for each");
    assert.ok(kit.messaging.outbox().length >= 5, "every student's parent was reminded");
    assert.deepEqual(second.runtime.status().fees, { open: 5 });

    // The same story straight through in memory ends exactly the same: the record, the saved state, the links and the outbox.
    const w = createWorld();
    await w.tick();
    await w.goto({ year: 2026, month: 11, day: 2 }, { hour: 13, minute: 0 });
    const saved = second.db.loadState();
    assert.deepEqual(saved.record, w.record.entries());
    assert.equal(saved.snapshot, serializeStore(w.store));
    assert.deepEqual(kit.payments.links(), w.payments.links());
    assert.deepEqual(kit.messaging.outbox(), w.messaging.outbox());
  } finally { kit.cleanup(); }
});

test("a fee paid after a restart ends exactly as it does in the in-memory harness, and a payment event the provider sends again is the same task", async () => {
  const kit = createKit();
  try {
    const w = createWorld();
    await w.tick();
    await w.goto({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 });
    w.pays("Rohan Mehta");
    await w.deliverPaymentEvents();

    const first = kit.open();
    await first.runtime.tick();
    kit.clock.set(at(2, 10));
    await first.runtime.tick();
    first.db.close();
    const second = kit.open();
    const rohan = kit.payments.links().find((l) => l.reference_id.startsWith("f-5"))!; // the fifth student of the example centre
    kit.payments.customerPays(rohan.id);
    await kit.deliverPaymentEvents(second.runtime);
    const again = second.runtime.submit(kit.payments.events.map((event) => ({ kind: "payment_event" as const, event }))); // the provider sends every one again
    assert.deepEqual(again, { saved: 0, duplicates: kit.payments.events.length });
    await second.runtime.idle();

    assert.deepEqual(second.runtime.status().fees, { open: 4, paid: 1 });
    const saved = second.db.loadState();
    assert.deepEqual(saved.record, w.record.entries());
    assert.equal(saved.snapshot, serializeStore(w.store));
    assert.deepEqual(kit.messaging.outbox(), w.messaging.outbox());
  } finally { kit.cleanup(); }
});

test("every field of the store is saved: a store the agent has been using is written whole and read back the same", async () => {
  const w = createWorld({ ai: { allowance: { messages: 100 } } });
  await w.tick();
  await w.goto({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 });
  await w.say("I already paid"); // the first message read: the month's AI counts begin
  await w.ownerSays("hello");
  // every key the live store has is in the snapshot, with the counters and the day the agent first ran among them
  const written = JSON.parse(serializeStore(w.store)) as Record<string, unknown>;
  for (const key of Object.keys(w.store)) assert.ok(key in written, `the store's "${key}" is not saved, so a restart would lose it`);
  for (const key of ["nextDue", "nextRequest", "startedAtMs", "ai"]) assert.ok(key in written, `${key} must be saved`);
  const again = serializeStore(parseStore(serializeStore(w.store)));
  assert.equal(again, serializeStore(w.store), "reading it back and writing it again gives the same bytes");
  const back = parseStore(serializeStore(w.store));
  assert.equal(back.startedAtMs, w.store.startedAtMs);
  assert.equal(back.nextRequest, w.store.nextRequest);
  // after a restore from a snapshot both id counters move on (a fee's id is its payment link's reference), and nothing else changes
  const moved = parseStore(skipStoreCounters(serializeStore(w.store), 100_000));
  assert.deepEqual([moved.nextDue, moved.nextRequest, moved.startedAtMs], [w.store.nextDue + 100_000, w.store.nextRequest + 100_000, w.store.startedAtMs]);
  assert.deepEqual([...moved.dues.keys()], [...w.store.dues.keys()]);
  assert.deepEqual([...back.dues.keys()], [...w.store.dues.keys()], "the fees come back in the same order");
  // a snapshot from before the AI counts or the day of the first run existed still loads
  const bare = JSON.parse(serializeStore(createStore())) as Record<string, unknown>;
  delete bare.startedAtMs; delete bare.ai;
  assert.equal(parseStore(JSON.stringify(bare)).startedAtMs, undefined);
  assert.throws(() => parseStore(JSON.stringify({ ...bare, format: 2 })), /not in a format this version can read/);
  assert.throws(() => parseStore(JSON.stringify({ ...bare, nextDue: "1" })), /not in a format this version can read/);
});

test("a task saved but never run is run when the runtime starts again", async () => {
  const kit = createKit();
  try {
    const first = kit.open();
    const message = kit.messaging.receive(PARENT, "hello");
    first.runtime.submit([{ kind: "message", message }]); // answered 200 here, then the process died before the queue ran
    first.db.close();
    assert.equal(kit.messaging.outbox().length, 0);

    const second = kit.open();
    assert.equal(second.runtime.status().tasks.pending, 1);
    second.runtime.kick(); // what main does on start
    await second.runtime.idle();
    assert.equal(second.runtime.status().tasks.pending, 0);
    assert.equal(second.runtime.status().tasks.done, 1);
    assert.equal(kit.messaging.sentTo(PARENT).length, 1, "the parent was answered");
    assert.deepEqual(second.runtime.submit([{ kind: "message", message }]), { saved: 0, duplicates: 1 }, "the provider's repeat is the same task");
  } finally { kit.cleanup(); }
});

test("a step cut off in the middle runs again from the last saved state, and finds its own payment link instead of making a new one", async () => {
  const kit = createKit();
  try {
    const stuck = new Promise<void>(() => undefined); // never ends: the process is gone
    const first = kit.open();
    await first.runtime.tick(); // 09:00: the day of the first run is saved
    kit.clock.set(at(2, 10));
    // The process dies after the agent has made the links and sent the reminders, but before anything is saved.
    const cut = kit.open({ aroundStep: async (_event, run) => { await run(); await stuck; } });
    void cut.runtime.tick();
    for (let i = 0; i < 200 && kit.messaging.outbox().length < 5; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(kit.payments.links().length, 5, "the links are out in the world ...");
    assert.equal(first.db.loadState().record.length, 0, "... but nothing was saved");
    cut.db.close();
    first.db.close();

    const second = kit.open();
    await second.runtime.tick();
    assert.equal(kit.payments.links().length, 5, "five links, not ten");
    assert.deepEqual(second.runtime.status().fees, { open: 5 });
  } finally { kit.cleanup(); }
});

test("a failing step is tried again, then marked failed, and the queue moves on; a quiet tick writes nothing", async () => {
  const kit = createKit();
  try {
    const tries: string[] = [];
    const { runtime, db } = kit.open({
      retryDelaysMs: [1, 1],
      aroundStep: async (event, run) => {
        if (event.kind === "message") tries.push(event.message.text);
        if (event.kind === "message" && event.message.text === "poison") throw new Error("this one always fails");
        await run();
      },
    });
    runtime.submit([
      { kind: "message", message: kit.messaging.receive(PARENT, "poison") },
      { kind: "message", message: kit.messaging.receive(PARENT, "hello") },
    ]);
    runtime.kick();
    await runtime.idle();
    assert.deepEqual(tries, ["poison", "poison", "poison", "hello"]);
    const status = runtime.status();
    assert.deepEqual(status.tasks, { pending: 0, done: 1, failed: 1 });
    assert.ok(!JSON.stringify(status).includes("poison"), "the status carries counts, not content");
    assert.equal(runtime.ready().ok, true);
    const before = db.loadState().record.length;
    await runtime.tick(); // 09:00: nothing is due, and the day of the first run is the only thing that changes
    await runtime.tick();
    assert.equal(db.loadState().record.length, before, "a quiet tick adds nothing to the record");
  } finally { kit.cleanup(); }
});

test("the status is counts only, names the cases `fees`, and has no `bookings`", async () => {
  const kit = createKit();
  try {
    const { runtime } = kit.open();
    kit.clock.set(at(2, 10));
    await runtime.tick();
    await runtime.tick();
    const status = runtime.status();
    assert.equal(status.pathway, "fees");
    assert.equal(status.version, "0.1.0");
    assert.deepEqual(status.fees, { open: 5 });
    assert.equal("bookings" in status, false);
    assert.deepEqual(status.refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    const text = JSON.stringify(status);
    for (const private_ of [PARENT, "Aarav", "Sharma", "Bright", "rzp.io"]) assert.ok(!text.includes(private_), `${private_} is not in the status`);
  } finally { kit.cleanup(); }
});
