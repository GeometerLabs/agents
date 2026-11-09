// What a Guard outage does to a task (modules/runtime/guard-wait.ts). The first tests are the table from `waitsForGuard` in faults.ts, one row per error kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, ConflictError, GuardAlreadyDoneError, GuardConflictError, GuardError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardSuspendedError, GuardUnauthenticatedError, GuardUnavailableError, NotSentError, TimeoutError, WindowClosedError, waitsForGuard } from "../../core/faults.ts";
import type { GuardInfo, SentCall } from "../../core/faults.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fakeClock } from "../../core/clock.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import type { ActionRecord } from "../../record/record.ts";
import { GUARD_WAIT_ENTRY } from "../../unfinished/registry.ts";
import { obligations, DEFAULT_OPTIONS } from "../../unfinished/index.ts";
import { createRuntimeCore } from "../core.ts";
import type { RuntimeEvent } from "../events.ts";
import { GUARD_WAIT_MS } from "../guard-wait.ts";
import { snapshotCodec } from "../snapshot.ts";
import { SCHEMA_VERSION, openStore } from "../store.ts";

const call: SentCall = { method: "POST", path: "/x" };
const guard = (code: string, more: Partial<GuardInfo> = {}): GuardInfo => ({ decision: "deny", code, sent: "no", retry: "later", ...more });

const WAIT = "waits", END = "does not wait";
const rows: [string, unknown, string][] = [
  ["connection refused", new NotSentError("x", "ECONNREFUSED"), WAIT],
  ["host not found (a stopped Guard's name is gone from Docker's DNS)", new NotSentError("x", "ENOTFOUND"), WAIT],
  ["no route to the host", new NotSentError("x", "EHOSTUNREACH"), WAIT],
  ["a not-sent error with no code (a fake's)", new NotSentError("x"), WAIT],
  ["a wrong address is not an outage", new NotSentError("x", "ERR_INVALID_URL"), END],
  ["Guard cannot decide: no policy, store down", new GuardUnavailableError(503, "x", guard("guard_unavailable"), call), WAIT],
  ["the kill switch: a person stopped the shop on purpose, not an outage", new GuardUnavailableError(503, "refused by the Guard: kill switch engaged: stopped by Divya", guard("guard_unavailable", { reason: "kill switch engaged: stopped by Divya" }), call), END],
  ["Guard's self-check failed: not ready", new GuardUnavailableError(503, "x", guard("guard_unavailable", { reason_code: "self_check_failed" }), call), WAIT],
  ["Guard is busy for a moment", new GuardUnavailableError(503, "x", guard("busy"), call, 1), WAIT],
  ["the provider is away and this Guard is up", new GuardUnavailableError(502, "x", guard("provider_unreachable"), call), END],
  ["no reply: it may have happened", new TimeoutError("x"), END],
  ["504 Guard-Outcome: unknown: never repeated", new GuardOutcomeUnknownError(504, "x", guard("outcome_unknown", { decision: "unknown", sent: "unknown", retry: "do_not_repeat" }), call), END],
  ["the licence (402): its own once-only handling", new GuardSuspendedError(402, "x", guard("subscription_suspended", { retry: "no" }), call), END],
  ["held for a person", new GuardHeldError(202, "x", guard("held_for_approval", { decision: "hold", retry: "after_approval" }), call, "ap-1", null), END],
  ["refused by a rule", new GuardRefusedError(403, "x", guard("refused_by_policy", { retry: "no" }), call, "rule"), END],
  ["refused by a limit", new GuardRefusedError(403, "x", guard("refused_by_policy", { retry: "no" }), call, "limit"), END],
  ["the same action with other arguments", new GuardConflictError(409, "x", guard("conflict", { retry: "no" }), call), END],
  ["settled as done by a person", new GuardAlreadyDoneError(409, "x", guard("conflict", { reason_code: "already_done", retry: "no" }), call), END],
  ["a wrong agent credential is a setup mistake", new GuardUnauthenticatedError(401, "x", guard("unauthenticated", { retry: "no" }), call), END],
  ["a decision this code does not know", new GuardError(500, "x", guard("something_new"), call), END],
  ["the service's own error", new ApiError(500, "x"), END],
  ["the service's own conflict", new ConflictError("x"), END],
  ["WhatsApp's closed window", new WindowClosedError(), END],
  ["a bug in the agent", new Error("x"), END],
];

for (const [name, error, expected] of rows) test(`${expected}: ${name}`, () => assert.equal(waitsForGuard(error), expected === WAIT));

// ---- the store ------------------------------------------------------------------------------------------------------------------------------------------------------

const message = (id: string, from = "+919800000002") => ({ kind: "message" as const, message: { id, from, text: "hello", timestamp: 1000 } });

test("a parked task stays pending, says what it waits for, and does not use up a try", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-wait-"));
  const db = openStore(dir);
  try {
    db.saveEvents([message("a")], 1000);
    const id = db.nextPending()!.id;
    assert.equal(db.nextPending()!.waitingOn, null);
    assert.equal(db.startAttempt(id), 1);
    db.parkTask(id, "payments", 5000, "Razorpay: could not connect (ECONNREFUSED).");
    const parked = db.nextPending()!;
    assert.deepEqual([parked.state, parked.attempts, parked.waitingOn, parked.retryAt], ["pending", 0, "payments", 5000]);
    assert.deepEqual(db.taskCounts(), { pending: 1, done: 0, failed: 0 });
    db.postponeTask(id, 9000);
    assert.deepEqual([db.nextPending()!.retryAt, db.nextPending()!.attempts], [9000, 0]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a commit clears the wait, and a commit with failedWith ends the task as failed", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-wait-"));
  const db = openStore(dir);
  try {
    db.saveEvents([message("a"), message("b")], 1000);
    db.parkTask("message:a", "calendar", 5000, "down");
    db.commitStep({ taskId: "message:a", snapshot: "{}", entries: [], nowMs: 2000 });
    assert.equal(db.nextPending()!.id, "message:b");
    assert.deepEqual([db.nextPending()!.waitingOn, db.nextPending()!.retryAt], [null, null]);
    db.commitStep({ taskId: "message:b", snapshot: "{}", entries: [], nowMs: 3000, failedWith: "The Guard stayed down." });
    assert.deepEqual(db.taskCounts(), { pending: 0, done: 1, failed: 1 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a database written by the version before this one gets the waiting columns and keeps its pending task", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-wait-"));
  const raw = new DatabaseSync(join(dir, "agent.db"));
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("CREATE TABLE tasks (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL, received_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')), attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT); CREATE TABLE state (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL, saved_at INTEGER NOT NULL); CREATE TABLE record (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, conversation TEXT NOT NULL, booking TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, entry TEXT NOT NULL); CREATE TABLE window (phone TEXT PRIMARY KEY, last_inbound_at INTEGER NOT NULL); PRAGMA user_version = 1");
  raw.prepare("INSERT INTO tasks (id, kind, payload, received_at) VALUES ('message:old', 'message', '{}', 1000)").run();
  raw.close();
  const db = openStore(dir);
  try {
    assert.equal(SCHEMA_VERSION, 2);
    const t = db.nextPending()!;
    assert.deepEqual([t.id, t.waitingOn, t.retryAt], ["message:old", null, null]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

// ---- the runtime, with a toy template ---------------------------------------------------------------------------------------------------------------------------------

interface Toy { seen: string[]; next: number; ai?: Record<string, unknown> }
const codec = snapshotCodec<Toy>(1, [{ name: "next", kind: "count" }, { name: "ai", kind: "optional-object" }]);
const START = Date.parse("2026-11-02T04:30:00Z");

interface Ctx { event: RuntimeEvent; store: Toy; record: ActionRecord; payments: any; messaging: any; id: string }

/**
 * A toy agent over two services a test can take down. `down` holds the Guards that are unreachable now. `links` and `sent` are what reached the provider, which is what the
 * tests read: a step that repeats a call shows up here, whatever the record says.
 */
function world(handler: (c: Ctx) => Promise<void>, overrides: { guardWaitMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guard-wait-"));
  const clock = fakeClock(START);
  const down = new Set<string>();
  const errors = new Map<string, Error>(); // what a Guard answers instead of being unreachable, for the kinds a test wants to try
  const links: string[] = [];
  const sent: string[] = [];
  let handled = 0;
  let probes = 0;
  const gate = (service: string) => { const e = errors.get(service); if (e) throw e; if (down.has(service)) throw new NotSentError(`${service}: could not connect (ECONNREFUSED).`, "ECONNREFUSED"); };
  const services = {
    payments: {
      async listRequests(q: { reference_id: string }) { probes += q.reference_id === "guard-wait-probe" ? 1 : 0; gate("payments"); return links.filter((l) => l === q.reference_id); },
      async createRequest(r: { reference_id: string }) { gate("payments"); links.push(r.reference_id); return { id: r.reference_id }; },
    },
    messaging: {
      async sendText(_to: string, text: string) { gate("messaging"); sent.push(text); return { id: `m-${sent.length}` }; },
      async ping() { probes++; gate("messaging"); return {}; },
    },
  };
  const gaveUp: { kind: string; service: string; tell: boolean }[] = [];
  const logs: string[] = [];
  const open = () => {
    const db = openStore(join(dir, "data"));
    return {
      db,
      runtime: createRuntimeCore<Toy, { timezone: string }, never>({
        settings: { timezone: "Asia/Kolkata" }, store: db, clock, messaging: createFakeMessaging(clock), pathwayVersion: "0.0.1", retryDelaysMs: [0, 0, 0], guardLookAgainMs: [1_000, 2_000, 4_000], log: (l) => logs.push(l), ...overrides,
        kit: {
          pathway: "toy", casesName: "toys", services: services as unknown as Record<string, unknown>,
          createStore: () => ({ seen: [], next: 1 }), serialize: codec.serialize, parse: (json) => ({ seen: [], ...codec.parse(json) }),
          createAgent: ({ store, record, services: s }) => ({
            async handle(event) { handled++; await handler({ event, store, record, payments: (s as any).payments, messaging: (s as any).messaging, id: `o-${store.next}` }); },
            async giveUp(event, why) {
              gaveUp.push({ kind: event.kind, service: why.service, tell: why.tell });
              record.append({ conversation: event.kind === "message" ? event.message.from : "owner", booking: null, action: GUARD_WAIT_ENTRY, inputs: {}, outcome: "failed", language: "en", refs: { service: why.service } });
            },
          }),
          countCases: () => ({}), casesOf: () => [], refundContext: () => null,
        },
      }),
    };
  };
  const first = open();
  return {
    clock, down, errors, links, sent, gaveUp, logs, get handled() { return handled; }, get probes() { return probes; },
    ...first, reopen: open, cleanup: () => rmSync(dir, { recursive: true, force: true }),
    msg: (id: string, from = "+919800000002") => message(id, from),
  };
}

/** Let the clock go by (the time the runtime waits between looks at a Guard), then run what can run now. */
const run = async (w: ReturnType<typeof world>, advanceMs = 0) => { if (advanceMs) w.clock.advance(advanceMs); w.runtime.kick(); await w.runtime.idle(); };

test("a step that finds its Guard down keeps nothing, waits without using up a try, and runs once when the Guard is back", async () => {
  const w = world(async ({ event, messaging, payments, id }) => {
    if (event.kind !== "message") return;
    if ((await payments.listRequests({ reference_id: id })).length === 0) await payments.createRequest({ reference_id: id });
    await messaging.sendText(event.message.from, `link ${id}`);
  });
  try {
    w.down.add("payments");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    assert.deepEqual([w.links, w.sent, w.runtime.status().tasks.pending, w.runtime.status().tasks.failed], [[], [], 1, 0]);
    assert.equal(w.db.nextPending()!.attempts, 0, "a try was not used up");
    assert.equal((w.runtime.status() as any).waitingForGuard, "payments");
    assert.equal(w.logs.filter((l) => /cannot be reached/u.test(l)).length, 1);

    w.down.delete("payments");
    await run(w, 2_000);
    assert.deepEqual([w.links, w.sent], [["o-1"], ["link o-1"]]);
    assert.deepEqual(w.runtime.status().tasks, { pending: 0, done: 1, failed: 0 });
    assert.equal(w.logs.filter((l) => /answers again/u.test(l)).length, 1);
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("a failure the agent swallows still stops the step: its sorry never goes out, and the rerun finds what the first try made", async () => {
  const w = world(async ({ event, messaging, payments, id }) => {
    if (event.kind !== "message") return;
    if ((await payments.listRequests({ reference_id: id })).length === 0) await payments.createRequest({ reference_id: id });
    // the agent's own catch-all, as in `say`, a `.catch(() => false)` beside a read, or `ensureLink`
    try { await messaging.sendText(event.message.from, `link ${id}`); } catch { await messaging.sendText(event.message.from, "sorry").catch(() => undefined); }
  });
  try {
    w.down.add("messaging");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    assert.deepEqual(w.links, ["o-1"], "the link was made before the Guard was found down");
    assert.deepEqual(w.sent, [], "the sorry stayed unsent");
    w.down.delete("messaging");
    await run(w, 2_000);
    assert.deepEqual([w.links, w.sent], [["o-1"], ["link o-1"]], "the link was found again, not made twice");
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("while the head of the queue waits, later messages wait behind it, and the Guard is asked only when its time comes", async () => {
  const w = world(async ({ event, messaging }) => { if (event.kind === "message") await messaging.sendText(event.message.from, `re ${event.message.id}`); });
  try {
    w.down.add("messaging");
    w.runtime.submit([w.msg("a"), w.msg("b", "+919800000003"), w.msg("c")]);
    await run(w);
    assert.equal(w.handled, 1, "only the head was tried");
    const asked = w.probes;
    for (let i = 0; i < 20; i++) await run(w); // kicks with no time passing: new messages arriving, ticks
    assert.equal(w.handled, 1);
    assert.equal(w.probes, asked, "not asked before its time");
    await run(w, 1_000);
    assert.equal(w.probes, asked + 1, "asked once when its time came");
    assert.equal(w.handled, 1, "no step runs while the Guard does not answer");
    w.down.delete("messaging");
    await run(w, 2_000);
    await run(w, 4_000);
    assert.deepEqual(w.sent, ["re a", "re b", "re c"], "in the order they arrived");
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("a send already made means the step cannot wait or run again: it finishes as it is, once", async () => {
  const w = world(async ({ event, messaging, payments }) => {
    if (event.kind !== "message") return;
    await messaging.sendText(event.message.from, "hello");
    await payments.listRequests({ reference_id: "x" }).catch(() => undefined); // this one finds the payments Guard down, after the send
  });
  try {
    w.down.add("payments");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    assert.deepEqual([w.sent, w.handled], [["hello"], 1]);
    assert.deepEqual(w.runtime.status().tasks, { pending: 0, done: 1, failed: 0 });
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("a step that sent something and then threw on a Guard that is down is not run again: it ends once, and the to-do list has it", async () => {
  const w = world(async ({ event, messaging, payments }) => {
    if (event.kind !== "message") return;
    await messaging.sendText(event.message.from, "hello");
    await payments.listRequests({ reference_id: "x" }); // uncaught, as a read in some steps is
  });
  try {
    w.down.add("payments");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    assert.deepEqual(w.sent, ["hello"], "sent once, not once per retry");
    assert.equal(w.handled, 1);
    assert.deepEqual(w.gaveUp, [{ kind: "message", service: "payments", tell: false }], "the customer already heard something, so is not told again");
    assert.deepEqual(w.runtime.status().tasks, { pending: 0, done: 0, failed: 1 });
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("past the bound the step runs once more with waiting off, the owner's list gets one item, and later messages stop waiting for that Guard", async () => {
  let reachedPayments = 0;
  const w = world(async ({ event, messaging, payments }) => {
    if (event.kind !== "message") return;
    try { reachedPayments++; await payments.listRequests({ reference_id: "x" }); await messaging.sendText(event.message.from, "link"); }
    catch { await messaging.sendText(event.message.from, "could not make the link"); } // the template's own words
  });
  try {
    w.down.add("payments");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    assert.equal(reachedPayments, 1);
    await run(w, GUARD_WAIT_MS);
    assert.deepEqual(w.sent, ["could not make the link"], "its last try used the template's own path, once");
    assert.deepEqual(w.gaveUp, [{ kind: "message", service: "payments", tell: false }], "one item, and the customer was not told twice");
    assert.deepEqual(w.runtime.status().tasks, { pending: 0, done: 1, failed: 0 });
    assert.deepEqual(obligations.detect({ template: "toy", entries: w.db.loadState().record, cases: [], nowMs: w.clock.now(), options: DEFAULT_OPTIONS }).found.map((o) => o.kind), ["message_unanswered"]);

    // the Guard is still down: the next message does not wait another 15 minutes, it takes today's path at once
    w.runtime.submit([w.msg("b")]);
    await run(w);
    assert.deepEqual(w.sent, ["could not make the link", "could not make the link"]);
    assert.equal(w.runtime.status().tasks.pending, 0);
    assert.equal(w.gaveUp.length, 2, "and it is on the list too");

    // once the Guard answers again a later outage waits again
    w.down.delete("payments");
    w.runtime.submit([w.msg("c")]);
    await run(w);
    w.down.add("payments");
    w.runtime.submit([w.msg("d")]);
    await run(w);
    assert.equal(w.runtime.status().tasks.pending, 1, "a new outage waits again");
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("past the bound, a step that throws on the down Guard still ends once: the customer is told and the to-do list has it", async () => {
  const w = world(async ({ event, payments }) => { if (event.kind === "message") await payments.listRequests({ reference_id: "x" }); });
  try {
    w.down.add("payments");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    await run(w, GUARD_WAIT_MS);
    assert.deepEqual(w.gaveUp, [{ kind: "message", service: "payments", tell: true }]);
    assert.deepEqual(w.runtime.status().tasks, { pending: 0, done: 0, failed: 1 });
    await run(w, GUARD_WAIT_MS);
    assert.equal(w.gaveUp.length, 1, "once");
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("a waiting task survives a restart: it picks up, and the bound still counts from when the message arrived", async () => {
  const w = world(async ({ event, messaging, payments }) => {
    if (event.kind !== "message") return;
    await payments.listRequests({ reference_id: "x" });
    await messaging.sendText(event.message.from, "done");
  });
  try {
    w.down.add("payments");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    await w.runtime.close();

    const again = w.reopen();
    assert.equal((again.runtime.status() as any).waitingForGuard, "payments", "still waiting after the restart");
    again.runtime.kick();
    await again.runtime.idle();
    assert.equal(again.db.nextPending()!.attempts, 0);
    w.down.delete("payments");
    w.clock.advance(1_000);
    again.runtime.kick();
    await again.runtime.idle();
    assert.deepEqual(w.sent, ["done"]);
    assert.deepEqual(again.runtime.status().tasks, { pending: 0, done: 1, failed: 0 });
    await again.runtime.close();
  } finally { w.cleanup(); }
});

test("a restart after the bound has passed ends the task at once rather than waiting another 15 minutes", async () => {
  const w = world(async ({ event, payments }) => { if (event.kind === "message") await payments.listRequests({ reference_id: "x" }); });
  try {
    w.down.add("payments");
    w.runtime.submit([w.msg("a")]);
    await run(w);
    await w.runtime.close();
    w.clock.advance(GUARD_WAIT_MS);
    const again = w.reopen();
    again.runtime.kick();
    await again.runtime.idle();
    assert.equal(w.gaveUp.length, 1);
    assert.deepEqual(again.runtime.status().tasks, { pending: 0, done: 0, failed: 1 });
    await again.runtime.close();
  } finally { w.cleanup(); }
});

test("a busy Guard's Retry-After sets the next look, not the backing-off delay", async () => {
  const w = world(async ({ event, messaging, payments }) => {
    if (event.kind !== "message") return;
    await payments.listRequests({ reference_id: "x" });
    await messaging.sendText(event.message.from, "ok");
  });
  try {
    w.errors.set("payments", new GuardUnavailableError(503, "Guard is busy", guard("busy"), call, 3));
    w.runtime.submit([w.msg("a")]);
    await run(w);
    assert.equal(w.db.nextPending()!.retryAt, w.clock.now() + 3_000);
    w.errors.delete("payments");
    await run(w, 3_000);
    assert.deepEqual(w.sent, ["ok"]);
  } finally { await w.runtime.close(); w.cleanup(); }
});

test("a tick that is thrown away does not send its reminder again on the next tick", async () => {
  let failTick = true;
  const w = world(async ({ event, messaging, payments }) => {
    if (event.kind !== "tick") return;
    await messaging.sendText("+919800000002", "reminder"); // a reminder, then a hold's expiry that reads a payment link
    if (failTick) await payments.listRequests({ reference_id: "x" });
  });
  try {
    w.down.add("payments");
    await w.runtime.tick();
    await w.runtime.tick();
    await w.runtime.tick();
    assert.deepEqual(w.sent, ["reminder"], "not once a tick for as long as the outage lasts");
    w.down.delete("payments");
    failTick = false;
    await w.runtime.tick();
    assert.deepEqual(w.sent, ["reminder"]);
    await w.runtime.tick();
    assert.deepEqual(w.sent, ["reminder", "reminder"], "the next saved tick's own reminder goes out");
  } finally { await w.runtime.close(); w.cleanup(); }
});
