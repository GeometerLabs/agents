// What a Guard outage does to a task (modules/runtime/guard-wait.ts). The first tests are the table from `waitsForGuard` in faults.ts, one row per error kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, ConflictError, GuardAlreadyDoneError, GuardConflictError, GuardError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardSuspendedError, GuardUnauthenticatedError, GuardUnavailableError, NotSentError, TimeoutError, WindowClosedError, waitsForGuard } from "../../core/faults.ts";
import type { GuardInfo, SentCall } from "../../core/faults.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  ["Guard cannot decide: kill switch, no policy, store down", new GuardUnavailableError(503, "x", guard("guard_unavailable"), call), WAIT],
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
