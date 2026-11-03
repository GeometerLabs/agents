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
  clear(): void;
}

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
    clear() { plans.clear(); },
  };
}
