// What a Guard outage does to a task (modules/runtime/guard-wait.ts). The first tests are the table from `waitsForGuard` in faults.ts, one row per error kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, ConflictError, GuardAlreadyDoneError, GuardConflictError, GuardError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardSuspendedError, GuardUnauthenticatedError, GuardUnavailableError, NotSentError, TimeoutError, WindowClosedError, waitsForGuard } from "../../core/faults.ts";
import type { GuardInfo, SentCall } from "../../core/faults.ts";

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
