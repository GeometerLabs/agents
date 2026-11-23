// The durable store: what is saved, what survives, and what the database itself refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createWorld, CUSTOMER } from "../src/harness.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { SCHEMA_VERSION, openStore } from "../server/store.ts";
import type { IncomingEvent } from "../../../../modules/runtime/events.ts";
const message = (id: string, from = CUSTOMER, timestamp = 1_000): IncomingEvent => ({ kind: "message", message: { id, from, text: "hi", timestamp } });
const payment = (id: string): IncomingEvent => ({ kind: "payment_event", event: { id, event: "request.paid", created_at: 1, payload: { request: { id: "req_1", reference_id: "b-1" } } } });

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
