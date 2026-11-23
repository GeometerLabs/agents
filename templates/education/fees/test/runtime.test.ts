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
const at = (day: number, hour: number, minute = 0, month = 11) => zonedToMs({ year: 2026, month, day }, { hour, minute }, "Asia/Kolkata");

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
