// Things going wrong on purpose. Every fake takes a fault plan: "the next insert saves, then times out".
// The errors below are what a real client library would throw, so the agent's handling is the real handling.

/** The call may or may not have happened: the reply never came back. */
export class TimeoutError extends Error {
  constructor(what: string) {
    super(`${what}: no reply (timed out)`);
    this.name = "TimeoutError";
  }
}

/** The service answered with an error status. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Nothing was sent: the connection was refused or the host is unknown. (A timeout or a cut connection is a TimeoutError: that call may have happened.) */
export class NotSentError extends ApiError {
  /** Node's network error code, when one caused this. `waitsForGuard` reads it to tell an unreachable Guard from an address that was wrong to begin with. */
  code?: string;
  constructor(message: string, code?: string) {
    super(503, message);
    this.name = "NotSentError";
    if (code !== undefined) this.code = code;
  }
}

// 409 gets its own class because a conflict (slot taken, already paid) is a normal answer the agent handles, not a failure to retry.
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, message);
    this.name = "ConflictError";
  }
}

/** WhatsApp refuses free-form text once the customer's 24-hour window has closed. */
export class WindowClosedError extends ApiError {
  constructor() {
    super(400, "The customer's 24-hour window is closed: send an approved template instead.");
    this.name = "WindowClosedError";
  }
}

export interface FaultOptions {
  times?: number; // how many calls it hits (default 1)
  after?: number; // let this many calls through first (default 0)
}

interface Plan<Mode> { mode: Mode; times: number; after: number }

export interface Faults<Op extends string, Mode extends string> {
  /** Plan a fault for an operation. Several plans for one operation are used in the order they were added. */
  inject(op: Op, mode: Mode, options?: FaultOptions): void;
  /** Called by the fake at the start of an operation: the fault to apply to this call, if any. */
  take(op: Op): Mode | undefined;
  /** What `take` would give next, without using it up. */
  peek(op: Op): Mode | undefined;
  clear(): void;
}

// Each fake gets its own plan list so a test can script one failure on one operation without affecting others.
export function createFaults<Op extends string, Mode extends string>(): Faults<Op, Mode> {
  const plans = new Map<Op, Plan<Mode>[]>();
  return {
    inject(op, mode, options = {}) {
      const list = plans.get(op) ?? [];
      list.push({ mode, times: options.times ?? 1, after: options.after ?? 0 });
      plans.set(op, list);
    },
    take(op) {
      const list = plans.get(op);
      if (!list || list.length === 0) return undefined;
      const plan = list[0];
      if (plan.after > 0) { plan.after -= 1; return undefined; }
      plan.times -= 1;
      if (plan.times <= 0) list.shift();
      return plan.mode;
    },
    peek(op) {
      const plan = plans.get(op)?.[0];
      return plan && plan.after <= 0 ? plan.mode : undefined;
    },
    clear() { plans.clear(); },
  };
}

// ---- Guard's own answers ---------------------------------------------------------------------------------------------------------
// A Guard in front of a service answers for itself when it decides a call (hold, refuse, cannot decide, outcome unknown). Those
// answers carry a `guard` object (see monorepo docs/guard-for-pathways.md) and are NEVER the service's reply, whatever their HTTP
// status: a held call is a 202. http.ts turns each into one of the errors below before any adapter reads a body. They extend
// ApiError, so code that already treats an ApiError as "this did not work" keeps doing so.

/** The `guard` object of a Guard answer, as Guard sent it. */
export interface GuardInfo {
  decision: string; // hold, deny, unknown
  code: string; // held_for_approval, refused_by_policy, conflict, unauthenticated, guard_unavailable, busy, provider_unreachable, outcome_unknown
  sent: string; // "no", or "unknown" for a lost answer
  retry: string; // after_approval, no, later, do_not_repeat
  /** A finer reason beside `code`, when Guard gives one: limit_exceeded, self_check_failed, already_done, subscription_suspended, denied_by_approver. A client that does not read it behaves as before. */
  reason_code?: string;
  reason?: string; // plain words, for a person
  detail?: unknown;
}

/** The call as the adapter sent it. `body` is the exact text that went out: a held call is sent again with these same bytes. */
export interface SentCall { method: string; path: string; body?: string }

// Carries what Guard decided and the call it stopped, so the agent can tell a policy refusal from a service error and not retry it.
export class GuardError extends ApiError {
  guard: GuardInfo;
  call: SentCall;
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall) {
    super(status, message);
    this.name = "GuardError";
    this.guard = guard;
    this.call = call;
  }
}

/** Held for a person (HTTP 202). Nothing was done. `approval` is null when only a person at the server can resolve it: it cannot be approved on WhatsApp. */
export class GuardHeldError extends GuardError {
  approval: string | null;
  expiresAtMs: number | null;
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall, approval: string | null, expiresAtMs: number | null) {
    super(status, message, guard, call);
    this.name = "GuardHeldError";
    this.approval = approval;
    this.expiresAtMs = expiresAtMs;
  }
}

/** Refused (403): by a rule (or a route the policy does not list), or by a limit counted over time. Do not retry. */
export class GuardRefusedError extends GuardError {
  kind: "rule" | "limit";
  /** The rule's or limit's id when the reason names one. */
  ruleId?: string;
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall, kind: "rule" | "limit", ruleId?: string) {
    super(status, message, guard, call);
    this.name = "GuardRefusedError";
    this.kind = kind;
    this.ruleId = ruleId;
  }
}

/**
 * How long Guard refuses the identical call after a person denied it (monorepo ADR-0061, addendum of 12 Nov 2026: the owner's decision). Guard's own number
 * (`DENIED_REPEAT_MS`); here for the stand-in Guard and for the approvals relay, which does not ask about such a call either.
 */
export const DENIED_REPEAT_MS = 24 * 3_600_000;

/**
 * The owner said no (403 `refused_by_policy` with `reason_code: "denied_by_approver"`; monorepo ADR-0061, addendum of 12 Nov 2026). A person denied this exact
 * call less than 24 hours ago, so Guard refused the identical call at once and asked nobody again. It is the owner's no, not a broken rule: never sent again,
 * never tried another way, and the customer is told the refund was not made. `approval` is the request that was denied, `untilMs` when the identical call
 * would be held and asked about again. It is a GuardRefusedError, so code that does not know it still never retries it.
 */
export class GuardDeniedError extends GuardRefusedError {
  approval?: string;
  deniedAtMs?: number;
  untilMs?: number;
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall) {
    super(status, message, guard, call, "rule");
    this.name = "GuardDeniedError";
    const d = typeof guard.detail === "object" && guard.detail !== null ? guard.detail as Record<string, unknown> : {};
    if (typeof d.approval === "string" && d.approval.length > 0) this.approval = d.approval.slice(0, 200);
    if (typeof d.denied_at_ms === "number" && Number.isSafeInteger(d.denied_at_ms)) this.deniedAtMs = d.denied_at_ms;
    if (typeof d.until_ms === "number" && Number.isSafeInteger(d.until_ms)) this.untilMs = d.until_ms;
  }
}

/** Guard cannot decide, is busy, or cannot reach the service: nothing was sent. Retry later. */
export class GuardUnavailableError extends GuardError {
  retryAfterSeconds?: number;
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall, retryAfterSeconds?: number) {
    super(status, message, guard, call);
    this.name = "GuardUnavailableError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The service may have acted and the answer was lost (504, Guard-Outcome: unknown). NEVER send it again. */
export class GuardOutcomeUnknownError extends GuardError {
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall) {
    super(status, message, guard, call);
    this.name = "GuardOutcomeUnknownError";
  }
}

/** No or wrong agent credential: a mistake in how this deployment was set up. */
export class GuardUnauthenticatedError extends GuardError {
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall) {
    super(status, message, guard, call);
    this.name = "GuardUnauthenticatedError";
  }
}

/** The same business action again with other arguments (409). Do not retry. */
export class GuardConflictError extends GuardError {
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall) {
    super(status, message, guard, call);
    this.name = "GuardConflictError";
  }
}

/**
 * The identical call again after a person at the server settled it as `happened` (409 `conflict` with `reason_code: "already_done"`, Guard's ADR-0060).
 * It is DONE, by that person's word: never send it again, and never tell anyone it failed. There is no reply of the service's to give back (it was lost,
 * or it was a 5xx). `confirmedBy` is who settled it (`operator:<admin id>`), `intent` Guard's record of the action, when Guard names them.
 * It is a GuardConflictError, so code that does not know it still never sends it again.
 */
export class GuardAlreadyDoneError extends GuardConflictError {
  confirmedBy?: string;
  intent?: string;
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall) {
    super(status, message, guard, call);
    this.name = "GuardAlreadyDoneError";
    const d = typeof guard.detail === "object" && guard.detail !== null ? guard.detail as Record<string, unknown> : {};
    if (typeof d.confirmed_by === "string" && d.confirmed_by.length > 0) this.confirmedBy = d.confirmed_by.slice(0, 200);
    if (typeof d.intent === "string" && d.intent.length > 0) this.intent = d.intent.slice(0, 200);
  }
}

/**
 * Guard's own licence refusal (HTTP 402, `code` and `reason_code` both `subscription_suspended`; monorepo ADR-0062): the shop's licence is in its wind-down (no new
 * payment link or calendar event) or its final stop (no send either, except to the owner), as Guard read fleet's signed lease. Nothing was sent. It is the same
 * refusal as the runtime's own licence check (`LICENCE_RULE`), made outside the runtime: never retried, never kept to do later, and the customer is told to contact
 * the shop. It stays refused until a newer lease restores the shop. Refunds, cancellations, reads and changes to existing bookings are never refused this way.
 */
export class GuardSuspendedError extends GuardError {
  /** `wind_down` or `stopped`, and the operation Guard held back, when Guard names them. */
  state?: string;
  operation?: string;
  constructor(status: number, message: string, guard: GuardInfo, call: SentCall) {
    super(status, message, guard, call);
    this.name = "GuardSuspendedError";
    const d = typeof guard.detail === "object" && guard.detail !== null ? guard.detail as Record<string, unknown> : {};
    if (typeof d.state === "string" && d.state.length > 0) this.state = d.state.slice(0, 40);
    if (typeof d.operation === "string" && d.operation.length > 0) this.operation = d.operation.slice(0, 80);
  }
}

/** True for an error that says the call may have gone through: no reply came back, or Guard said the outcome is unknown. */
export const mayHaveHappened = (e: unknown): boolean => e instanceof TimeoutError || e instanceof GuardOutcomeUnknownError;

/**
 * Does this failure keep a saved task waiting for its Guard (modules/runtime/guard-wait.ts) instead of ending now? Only "the Guard could not be reached or is not ready, and
 * nothing was sent" does. This is the one table of what each kind means for waiting; modules/runtime/test/guard-wait.test.ts has one row per kind.
 *
 *   NotSentError, a network code                 waits: the connection never opened, so the Guard is down and the provider saw nothing. Trying later cannot do the work twice.
 *   NotSentError, ERR_INVALID_URL                ends now: the address is wrong, and waiting does not mend it.
 *   GuardUnavailableError guard_unavailable      waits: no policy, store down, failed self-check. Guard says `sent: no`, `retry: later`.
 *   ... with the kill switch engaged             does not wait: a person stopped the shop on purpose (`geometer stop`, a stop from the panel, a deploy that found a
 *                                                mismatch). It is not an outage, so a message must not sit 15 minutes and then be filed as one; today's handling stays.
 *                                                Guard says so only in its reason ("kill switch engaged: <why>", monorepo docs/guard-for-pathways.md), so that is what is read.
 *   GuardUnavailableError busy                   waits: Guard is at capacity for a moment, and says `sent: no`.
 *   GuardUnavailableError provider_unreachable   ends now: the Guard is up and it is the provider that is away, so it is not this rule's case. Today's handling stays.
 *   TimeoutError                                 never waits: the call may have reached the provider, and waiting means running it again.
 *   GuardOutcomeUnknownError                     never waits, never repeated: 504 `Guard-Outcome: unknown`, the provider may have acted.
 *   GuardSuspendedError                          never waits: the shop's licence (402). It stays refused until a newer lease and keeps its once-only handling.
 *   GuardHeldError                               never waits: a person decides it. The agent keeps the held call and sends it only after approval.
 *   GuardRefusedError, GuardConflictError        never waits: a rule, a limit or a different action said no, and the same call gets the same answer.
 *   GuardAlreadyDoneError                        never waits: a person settled it as done, so nothing is left to do.
 *   GuardDeniedError                             never waits: a person said no to this exact call, and Guard refuses it for a day without asking again.
 *   GuardUnauthenticatedError                    never waits: a mistake in this deployment's credential, not an outage.
 *   GuardError (any other)                       never waits: a decision this code does not know is not taken to mean "try later".
 *   ApiError, ConflictError, WindowClosedError   never waits: the service itself answered.
 *
 * Anything else (a bug in the agent) is not a Guard's, so it does not wait either: the task runner's usual retries apply.
 */
export function waitsForGuard(e: unknown): boolean {
  if (e instanceof NotSentError) return e.code !== "ERR_INVALID_URL";
  if (e instanceof GuardUnavailableError) return e.guard.code !== "provider_unreachable" && !KILL_SWITCH.test(e.guard.reason ?? "");
  return false;
}

/** Guard's reason when its kill switch is on: "kill switch engaged: <the reason given>". */
const KILL_SWITCH = /^kill switch engaged\b/iu;
