// The durable store: what is saved, what survives, and what the database itself refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createWorld, CUSTOMER } from "../src/harness.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { SCHEMA_VERSION, openStore } from "../server/store.ts";
import type { IncomingEvent } from "../server/events.ts";
import { createKit } from "./runtime-kit.ts";

const message = (id: string, from = CUSTOMER, timestamp = 1_000): IncomingEvent => ({ kind: "message", message: { id, from, text: "hi", timestamp } });
const payment = (id: string): IncomingEvent => ({ kind: "payment_event", event: { id, event: "payment_link.paid", created_at: 1, payload: { payment_link: { id: "plink_1", reference_id: "b-1" } } } });

test("the store survives a round trip through JSON with its Maps, Sets, order and counter", async () => {
  const w = createWorld();
  await w.say("I want a haircut tomorrow at 6pm");
  await w.say("hello", { from: "+919822222222" });
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  const back = parseStore(serializeStore(w.store));
  assert.ok(back.bookings instanceof Map && back.customers instanceof Map && back.seenMessages instanceof Set && back.seenEvents instanceof Set);
  assert.deepEqual([...back.customers.keys()], [...w.store.customers.keys()]); // same order
  assert.equal(back.nextBooking, w.store.nextBooking);
  assert.ok(back.seenMessages.size === 2 && back.seenEvents.size >= 1);
  assert.equal(back.bookings.get("b-1")?.state, "confirmed");
  assert.notEqual(back.bookings.get("b-1"), w.store.bookings.get("b-1")); // a copy, sharing nothing
  assert.equal(serializeStore(back), serializeStore(w.store));
});

test("a snapshot from another format is refused in plain words", () => {
  assert.throws(() => parseStore('{"format":99}'), /not in a format this version can read/);
});

test("a new store is in WAL mode at the current schema version, and reopening keeps it", () => {
  const kit = createKit();
  try {
    const { db } = kit.open();
    const check = new DatabaseSync(db.file);
    assert.equal((check.prepare("PRAGMA journal_mode").get() as any).journal_mode, "wal");
    assert.equal((check.prepare("PRAGMA user_version").get() as any).user_version, SCHEMA_VERSION);
    check.close();
    db.close();
    openStore(join(kit.dir, "data")).close();
  } finally { kit.cleanup(); }
});

test("data written by a newer version is refused, not guessed at", () => {
  const kit = createKit();
  try {
    const { db } = kit.open();
    db.close();
    const raw = new DatabaseSync(db.file);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();
    assert.throws(() => openStore(join(kit.dir, "data")), /newer version of the runtime/);
  } finally { kit.cleanup(); }
});

test("an event id seen before is not saved again, and a message id is not a payment event id", () => {
  const kit = createKit();
  try {
    const { db } = kit.open();
    assert.deepEqual(db.saveEvents([message("m1"), payment("m1"), message("m1")], 5_000), { saved: 2, duplicates: 1 });
    assert.deepEqual(db.saveEvents([message("m1")], 6_000), { saved: 0, duplicates: 1 });
    assert.deepEqual(db.taskCounts(), { pending: 2, done: 0, failed: 0 });
    assert.equal(db.nextPending()?.id, "message:m1"); // in the order they came
  } finally { kit.cleanup(); }
});

test("the WhatsApp window is saved with the event, keeps the latest time, never runs ahead of now, and survives a reopen", () => {
  const kit = createKit();
  try {
    const { db } = kit.open();
    db.saveEvents([message("m1", CUSTOMER, 1_000)], 9_000);
    db.saveEvents([message("m2", CUSTOMER, 500)], 9_000); // an older message arriving late does not move it back
    assert.equal(db.lastInboundAt(CUSTOMER), 1_000);
    db.saveEvents([message("m3", "+919833333333", 99_000)], 9_000); // a clock set ahead is held to now
    assert.equal(db.lastInboundAt("+919833333333"), 9_000);
    assert.equal(db.lastInboundAt("+919844444444"), undefined);
    db.close();
    assert.equal(openStore(join(kit.dir, "data")).lastInboundAt(CUSTOMER), 1_000);
  } finally { kit.cleanup(); }
});

test("attempts are counted before a step runs, and a task finished keeps no message text", () => {
  const kit = createKit();
  try {
    const { db } = kit.open();
    db.saveEvents([message("m1")], 1);
    assert.match(db.nextPending()!.payload, /"text":"hi"/);
    assert.equal(db.startAttempt("message:m1"), 1);
    db.failTask("message:m1", "boom", false);
    assert.deepEqual([db.nextPending()?.attempts, db.nextPending()?.lastError], [1, "boom"]);
    assert.equal(db.startAttempt("message:m1"), 2);
    db.commitStep({ taskId: "message:m1", snapshot: "{}", entries: [], nowMs: 2 });
    assert.deepEqual(db.taskCounts(), { pending: 0, done: 1, failed: 0 });
    const row = new DatabaseSync(db.file).prepare("SELECT payload, last_error FROM tasks").get() as any;
    assert.deepEqual({ ...row }, { payload: "{}", last_error: null });
  } finally { kit.cleanup(); }
});

test("a step is saved whole or not at all, and the record cannot be changed or deleted", async () => {
  const kit = createKit();
  try {
    const { runtime, db } = kit.open();
    await kit.say(runtime, "I want a haircut tomorrow at 6pm");
    const before = db.loadState();
    assert.ok(before.record.length > 5);

    // A second writer claiming the same record numbers is refused, and the snapshot and "done" mark go with it.
    db.saveEvents([message("late")], 1);
    assert.throws(() => db.commitStep({ taskId: "message:late", snapshot: '{"format":1}', entries: [before.record[0]], nowMs: 2 }), /UNIQUE|constraint/i);
    assert.equal(db.loadState().snapshot, before.snapshot);
    assert.equal(db.taskCounts().pending, 1);

    const raw = new DatabaseSync(db.file);
    assert.throws(() => raw.exec("UPDATE record SET outcome = 'confirmed'"), /append-only/);
    assert.throws(() => raw.exec("DELETE FROM record"), /append-only/);
    raw.close();
  } finally { kit.cleanup(); }
});
