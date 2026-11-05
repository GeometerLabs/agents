// The runtime keeps the agent honest across restarts: steps are saved whole, run one at a time in order, retried when they
// fail, and picked up again after a restart. The fakes stand for the outside world, so they keep their state across a
// "restart"; everything the runtime owns is in the temp directory and is rebuilt from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgent } from "../src/agent.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { CUSTOMER, createWorld } from "../src/harness.ts";
import { createRecord } from "../../../modules/record/record.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { createKit } from "./runtime-kit.ts";

const BOOK = "I want a haircut tomorrow at 6pm";

test("a booking finished after a restart ends exactly as it does in the in-memory harness, and a repeated message is ignored", async () => {
  const kit = createKit();
  try {
    // The same story, once straight through in memory ...
    const w = createWorld();
    await w.say(BOOK, { id: "wamid.in_1" });
    w.payments.customerPays(w.linkFor("b-1")!.id);
    await w.deliverPaymentEvents();

    // ... and once with the runtime dropped and rebuilt from disk in the middle (hold and link made, deposit not yet paid).
    const first = kit.open();
    const message = await kit.say(first.runtime, BOOK, { id: "wamid.in_1" });
    assert.equal(kit.calendar.events().length, 1);
    assert.ok(kit.linkFor("b-1"));
    const recordLength = first.runtime.status().recordLength;
    first.db.close(); // gone: the runtime, the queue, the store, the record and the agent
    const second = kit.open();
    assert.equal(second.runtime.status().recordLength, recordLength); // the record came back whole
    kit.payments.customerPays(kit.linkFor("b-1")!.id);
    await kit.deliverPaymentEvents(second.runtime);

    const saved = second.db.loadState();
    assert.deepEqual(saved.record, w.record.entries());
    assert.equal(saved.snapshot, serializeStore(w.store));
    assert.deepEqual(kit.calendar.events(), w.calendar.events());
    assert.deepEqual(kit.payments.links(), w.payments.links());
    assert.deepEqual(kit.messaging.outbox(), w.messaging.outbox());
    assert.equal(second.runtime.status().bookings.confirmed, 1);

    // The provider delivers the first message again. The inbox hands it over; it is the same task, so nothing new happens ...
    const outboxBefore = kit.messaging.outbox().length;
    assert.deepEqual(second.runtime.submit([{ kind: "message", message }]), { saved: 0, duplicates: 1 });
    await second.runtime.idle();
    assert.equal(kit.messaging.outbox().length, outboxBefore);

    // ... and even if it did reach the agent, the saved state has the message id, so the agent itself would ignore it.
    const store = parseStore(saved.snapshot!);
    const record = createRecord(kit.clock, saved.record);
    const agent = createAgent({ settings: kit.settings, clock: kit.clock, calendar: kit.calendar, payments: kit.payments, messaging: kit.messaging, parser: createRuleParser(), record, store });
    await agent.handle({ kind: "message", message });
    assert.equal(kit.messaging.outbox().length, outboxBefore);
    assert.match(record.entries().at(-1)!.notes, /delivered again/);
  } finally { kit.cleanup(); }
});

test("a task saved but never run is run when the runtime starts again", async () => {
  const kit = createKit();
  try {
    const first = kit.open();
    const message = kit.messaging.receive(CUSTOMER, BOOK);
    first.runtime.submit([{ kind: "message", message }]); // answered 200 here, then the process died before the queue ran
    first.db.close();
    assert.equal(kit.calendar.events().length, 0);

    const second = kit.open();
    assert.equal(second.runtime.status().tasks.pending, 1);
    second.runtime.kick(); // what main does on start
    await second.runtime.idle();
    assert.equal(second.runtime.status().tasks.pending, 0);
    assert.equal(second.runtime.status().tasks.done, 1);
    assert.equal(kit.calendar.events().length, 1);
    assert.equal(second.runtime.status().bookings.awaiting_deposit, 1);
  } finally { kit.cleanup(); }
});

test("a step cut off in the middle runs again from the last saved state, and finds its own calendar event and link instead of making new ones", async () => {
  const kit = createKit();
  try {
    const stuck = new Promise<void>(() => undefined); // never ends: the process is gone
    // The process dies after the agent has written to the calendar and the payments service, but before anything is saved.
    const first = kit.open({ aroundStep: async (_event, run) => { await run(); await stuck; } });
    kit.say(first.runtime, BOOK).catch(() => undefined);
    for (let i = 0; i < 200 && kit.messaging.outbox().length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(kit.calendar.events().length, 1); // the effects are out in the world ...
    assert.equal(first.db.loadState().record.length, 0); // ... but nothing was saved
    assert.equal(first.db.nextPending()!.attempts, 1); // and the attempt was counted before it began
    first.db.close();

    const second = kit.open();
    second.runtime.kick();
    await second.runtime.idle();
    assert.equal(kit.calendar.events().length, 1, "one hold, not two");
    assert.equal(kit.payments.links().length, 1, "one link, not two");
    assert.equal(second.runtime.status().bookings.awaiting_deposit, 1);
    assert.equal(second.db.taskCounts().done, 1);
    // The honest part: the quote went to the customer in the first, cut-off run and goes again in the second.
    assert.equal(kit.messaging.sentTo(CUSTOMER).length, 2);
  } finally { kit.cleanup(); }
});

test("a task that was running each time the process died is marked failed instead of looping across restarts", async () => {
  const kit = createKit();
  try {
    const first = kit.open();
    first.runtime.submit([{ kind: "message", message: kit.messaging.receive(CUSTOMER, "hello") }]);
    for (let i = 0; i < 4; i++) first.db.startAttempt("message:wamid.in_1"); // it started four times and never finished
    first.db.close();
    const second = kit.open();
    second.runtime.kick();
    await second.runtime.idle();
    assert.deepEqual(second.runtime.status().tasks, { pending: 0, done: 0, failed: 1 });
    assert.equal(kit.messaging.outbox().length, 0);
  } finally { kit.cleanup(); }
});

test("two events sent at once, and a tick, are handled one at a time in the order they came", async () => {
  const kit = createKit();
  try {
    const seen: string[] = [];
    let inStep = 0;
    let most = 0;
    const { runtime } = kit.open({
      aroundStep: async (event, run) => {
        inStep++; most = Math.max(most, inStep);
        seen.push(event.kind === "message" ? event.message.text : event.kind);
        await new Promise((r) => setTimeout(r, 15)); // long enough for a second step to overlap if it could
        await run();
        inStep--;
      },
    });
    const messages = ["hello", "hi there", "namaste"].map((t) => kit.messaging.receive(CUSTOMER, t));
    runtime.submit(messages.map((message) => ({ kind: "message" as const, message })));
    runtime.kick();
    const tick = runtime.tick();
    runtime.submit([{ kind: "message", message: kit.messaging.receive(CUSTOMER, "one more") }]);
    runtime.kick(); // a second kick while the first is running must not start a second runner
    await Promise.all([tick, runtime.idle()]);
    assert.equal(most, 1, "no two steps overlapped");
    assert.deepEqual(seen.filter((s) => s !== "tick"), ["hello", "hi there", "namaste", "one more"]);
    assert.ok(seen.includes("tick"));
    assert.equal(runtime.status().tasks.done, 4);
  } finally { kit.cleanup(); }
});

test("a failing step is tried again, then marked failed, and the queue moves on", async () => {
  const kit = createKit();
  try {
    const tries: string[] = [];
    const { runtime } = kit.open({
      retryDelaysMs: [1, 1],
      aroundStep: async (event, run) => {
        if (event.kind === "message") tries.push(event.message.text);
        if (event.kind === "message" && event.message.text === "poison") throw new Error("this one always fails");
        await run();
      },
    });
    runtime.submit([
      { kind: "message", message: kit.messaging.receive(CUSTOMER, "poison") },
      { kind: "message", message: kit.messaging.receive(CUSTOMER, "hello") },
    ]);
    runtime.kick();
    await runtime.idle();
    assert.deepEqual(tries, ["poison", "poison", "poison", "hello"]); // three tries, then on to the next
    const status = runtime.status();
    assert.deepEqual(status.tasks, { pending: 0, done: 1, failed: 1 });
    assert.ok(status.lastFailureAt);
    assert.equal(kit.messaging.sentTo(CUSTOMER).length, 1); // the customer who wrote "hello" was answered
    assert.ok(!JSON.stringify(status).includes("poison"), "the status carries counts, not content");
    assert.equal(runtime.ready().ok, true); // a failed task does not make the runtime unready
  } finally { kit.cleanup(); }
});

test("a step that fails after the agent has done its work saves nothing, and its retry starts from the last saved state", async () => {
  const kit = createKit();
  try {
    let failures = 1;
    const { runtime, db } = kit.open({
      retryDelaysMs: [1],
      aroundStep: async (event, run) => {
        await run(); // the agent has changed its store and appended to its record, in memory
        if (event.kind === "message" && failures-- > 0) throw new Error("the process hiccuped before saving");
      },
    });
    await kit.say(runtime, BOOK);
    // Booked once: the failed try left nothing behind in the saved state, so the retry made b-1 again and found its own hold and link.
    assert.equal(runtime.status().tasks.done, 1);
    assert.deepEqual(runtime.status().bookings, { awaiting_deposit: 1 });
    const record = db.loadState().record;
    assert.deepEqual(record.map((e) => e.seq), record.map((_, i) => i + 1));
    assert.equal(record.filter((e) => e.action === "receive_message").length, 1);
    assert.equal(parseStore(db.loadState().snapshot!).nextBooking, 2);
    assert.equal(kit.calendar.events().length, 1);
    assert.equal(kit.payments.links().length, 1);
  } finally { kit.cleanup(); }
});

test("a tick expires a hold that ran out, saves that, and a quiet tick writes nothing", async () => {
  const kit = createKit();
  try {
    const { runtime, db } = kit.open();
    await kit.say(runtime, BOOK);
    const before = db.loadState().record.length;
    await runtime.tick(); // nothing is due
    assert.equal(db.loadState().record.length, before);
    kit.clock.advanceMinutes(kit.settings.deposit.holdMinutes + 1);
    await runtime.tick();
    assert.deepEqual(runtime.status().bookings, { expired: 1 });
    assert.equal(kit.calendar.events().length, 0, "the hold is gone from the calendar");
    assert.ok(db.loadState().record.length > before);
  } finally { kit.cleanup(); }
});
