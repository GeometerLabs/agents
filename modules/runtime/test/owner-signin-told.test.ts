// "Tells twice rather than never" for the owner's sign-in notices, in the runtime core: a tick's notice is marked told only AFTER the step holding its record line is saved.
// Before this, `signin.tick` marked it told inside the step, so a save that failed (or a crash) between the two lost the notice for good.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import type { ActionRecord } from "../../record/record.ts";
import { createRuntimeCore } from "../core.ts";
import type { OwnerSignin } from "../../channels/owner-signin.ts";
import { snapshotCodec } from "../snapshot.ts";
import { openStore } from "../store.ts";

interface Toy { seen: string[]; next: number; ai?: Record<string, unknown> }
const codec = snapshotCodec<Toy>(1, [{ name: "next", kind: "count" }, { name: "ai", kind: "optional-object" }]);

test("a notice whose step failed to save is told again on the next tick, and not again once saved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "signin-told-"));
  const db = openStore(join(dir, "data"));
  const clock = fakeClock(Date.parse("2026-11-19T04:30:00Z"));
  const logs: string[] = [];
  // a stand-in for the owner's sign-in: one notice, said in the record by `tick` and "told" only when the core says so
  let told = false;
  const said: string[] = [];
  const signin = {
    takes: () => false,
    tick(ctx: { record: ActionRecord }): string[] {
      if (told) return [];
      said.push("removal_asked");
      ctx.record.append({ conversation: "owner", booking: null, action: "owner_session", inputs: { what: "removal_asked" }, outcome: "confirmed", language: "en", refs: {} });
      return ["key-1"];
    },
    markTold(keys: string[]): void { if (keys.includes("key-1")) told = true; },
  } as unknown as OwnerSignin;
  const commit = db.commitStep.bind(db);
  let failNext = true;
  db.commitStep = (step) => { if (failNext) { failNext = false; throw new Error("disk full"); } commit(step); };
  const runtime = createRuntimeCore<Toy, { timezone: string }, never>({
    settings: { timezone: "Asia/Kolkata" }, store: db, clock, messaging: createFakeMessaging(clock), pathwayVersion: "0.0.1", retryDelaysMs: [0], log: (l) => logs.push(l), ownerSignin: signin,
    kit: {
      pathway: "toy", casesName: "toys", services: {},
      createStore: () => ({ seen: [], next: 1 }), serialize: codec.serialize, parse: (json) => ({ seen: [], ...codec.parse(json) }),
      createAgent: () => ({ async handle() { /* nothing */ } }),
      countCases: () => ({}), casesOf: () => [], refundContext: () => null,
    },
  });
  try {
    await runtime.tick().catch(() => undefined); // the save fails: the line is not on disk
    assert.equal(told, false, "a failed save must not mark the notice told");
    assert.equal(db.loadState().record.filter((e) => /owner_session/u.test(e.action)).length, 0);
    await runtime.tick(); // the next tick tells it again, and this time it is saved
    assert.equal(said.length, 2, "told twice rather than never");
    assert.equal(told, true);
    assert.equal(db.loadState().record.filter((e) => /owner_session/u.test(e.action)).length, 1);
    await runtime.tick();
    assert.equal(said.length, 2, "once saved and marked, it is not told again");
  } finally { await runtime.close(); rmSync(dir, { recursive: true, force: true }); }
});
