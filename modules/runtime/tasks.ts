// The step runner: handles saved tasks one at a time, in the order they arrived, and runs the clock's ticks through the
// same queue, so two steps never overlap. A step that throws is tried again after a wait, a few times, and then the
// task is marked failed and the queue goes on with the next one (a customer waiting behind a broken message is worse
// than a broken message).
//
// A step that found its Guard down is different (guard-wait.ts): the task is not broken, so its tries are not used up. It stays at the head of the queue, saved with the
// time to look again, and the queue sleeps. Order stays shop-wide; guard-wait.ts says why. The wait has an end (`guardWaitMs`), after which the step runs once more with
// waiting off and the queue goes on.
//
// "Tried again" starts from the last saved state, not from wherever the failed step stopped: see runtime.ts. A step that Guard refused for the shop's licence
// (a GuardSuspendedError that reached this far) is NOT tried again: it would be refused the same way until a newer lease, and nothing is kept to do later.
import { GuardSuspendedError } from "../core/faults.ts";
import type { RuntimeEvent } from "./events.ts";
import { GUARD_LOOK_AGAIN_MS, GUARD_WAIT_MS, WaitingForGuard } from "./guard-wait.ts";
import type { DurableStore } from "./store.ts";

export interface RunnerOptions {
  db: Pick<DurableStore, "nextPending" | "startAttempt" | "failTask" | "parkTask" | "postponeTask">;
  /** Handle one event and save the result. For a saved task, `taskId` is marked done in the same save. `lastTry`: the wait for its Guard is over, so the step runs with waiting off. */
  step: (event: RuntimeEvent, taskId?: string, options?: { lastTry?: boolean }) => Promise<void>;
  /** How long to wait before the first retry, the second and so on. The number of tries is one more than this list is long. */
  retryDelaysMs: number[];
  log: (line: string) => void;
  /** Has this service's Guard come back? Asked before a waiting step runs again. Left out: the step itself is the look. */
  guardAnswers?: (service: string) => Promise<boolean>;
  /** How long a task may wait for its Guard, from when it arrived (GUARD_WAIT_MS). */
  guardWaitMs?: number;
  /** How long between looks at a Guard that is down (GUARD_LOOK_AGAIN_MS). */
  guardLookAgainMs?: number[];
}

export interface TaskRunner {
  /** Start on any pending task (a no-op if already going). Called after events are saved, and on start for those left over. */
  kick(): void;
  /** One tick of the clock through the queue. Skipped if a tick is already waiting. Never rejects. */
  tick(): Promise<void>;
  /** Resolves when nothing is running and nothing can run now: nothing is pending, or what is pending waits for a Guard. */
  idle(): Promise<void>;
  health(): { ok: true } | { ok: false; reason: string };
  lastStepAt(): number | null;
  lastFailureAt(): number | null;
  /** Running totals since this process started: tasks finished, and attempts (of a task or of a tick) that failed. A heartbeat sends the difference. */
  counters(): { steps: number; errors: number };
  /** Finish the step in hand, leave the rest pending for the next start. */
  stop(): Promise<void>;
}

// One runner handles one task at a time in arrival order so two steps for the same shop never run at once; retries use the given delays.
export function createRunner(options: RunnerOptions & { now: () => number }): TaskRunner {
  const { db, step, retryDelaysMs, log, now } = options;
  const maxAttempts = retryDelaysMs.length + 1;
  const guardWaitMs = options.guardWaitMs ?? GUARD_WAIT_MS;
  const lookAgainMs = options.guardLookAgainMs ?? GUARD_LOOK_AGAIN_MS;
  let queue: Promise<unknown> = Promise.resolve(); // the serial queue: each step starts when the one before it has ended
  let going = false;
  let drained: Promise<void> = Promise.resolve();
  let tickWaiting = false;
  let stopped = false;
  let broken: string | undefined;
  let wake: (() => void) | undefined;
  let lastStep: number | null = null;
  let lastFailure: number | null = null;
  let steps = 0;
  let errors = 0;
  // One line when a Guard is found down and one when the queue moves again, not one for every look: an outage is one event in the logs.
  let waitingOn: string | undefined;
  let looksAgain = 0;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;

  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };

  const sleep = (ms: number) => ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => {
    const timer = setTimeout(() => { wake = undefined; resolve(); }, ms);
    wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
  });

  const failed = (what: string, e: unknown) => {
    lastFailure = now();
    errors++;
    log(`${what}: ${(e as Error)?.message ?? e}`);
  };

  /** The next look at a Guard that is down: a little later each time, up to the last delay. */
  const nextLook = () => lookAgainMs[Math.min(looksAgain++, lookAgainMs.length - 1)];

  /** Start the queue again at this time. An unref'd timer, so a waiting task never keeps a stopping process alive. Armed fresh each time, so there is only ever one. */
  function wakeAt(atMs: number): void {
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => { wakeTimer = undefined; kick(); }, Math.max(atMs - now(), 100));
    wakeTimer.unref?.();
  }

  async function runTask(id: string, payload: string, lastTry: boolean): Promise<void> {
    for (;;) {
      const attempt = db.startAttempt(id); // saved before the step runs: a step that kills the process still counts
      try {
        await oneAtATime(() => step(JSON.parse(payload) as RuntimeEvent, id, lastTry ? { lastTry: true } : undefined));
        lastStep = now();
        steps++;
        if (waitingOn !== undefined) { log(`The ${waitingOn} Guard answers again, so the queue goes on.`); waitingOn = undefined; looksAgain = 0; }
        return;
      } catch (e) {
        if (e instanceof WaitingForGuard) {
          // Guard's `Retry-After`, when it is only busy; otherwise the backing-off look. Waiting is not a failure, so no error is counted and the try is given back.
          const delay = e.retryAfterSeconds !== undefined ? Math.max(e.retryAfterSeconds * 1_000, 1_000) : nextLook();
          db.parkTask(id, e.service, now() + delay, e.message);
          if (waitingOn !== e.service) { log(`The ${e.service} Guard cannot be reached or is not ready, so this shop's messages wait for it (at most ${Math.round(guardWaitMs / 60_000)} minutes each): ${e.message}`); waitingOn = e.service; }
          return;
        }
        const last = attempt >= maxAttempts || e instanceof GuardSuspendedError;
        db.failTask(id, (e as Error)?.message ?? String(e), last);
        failed(`Task ${id} failed (try ${attempt} of ${maxAttempts})${last ? ", so it is marked failed and the queue goes on" : ""}`, e);
        if (last || stopped) return;
        await sleep(retryDelaysMs[attempt - 1]);
        if (stopped) return;
      }
    }
  }

  async function drain(): Promise<void> {
    for (;;) {
      const task = stopped ? undefined : db.nextPending();
      if (!task) { going = false; return; } // cleared in the same breath as the last look, so a task saved just now is never missed
      broken = undefined;
      if (task.attempts >= maxAttempts) { // it was already tried that many times and the process died each time
        db.failTask(task.id, "The process stopped while this task was running, too many times.", true);
        failed(`Task ${task.id} is marked failed: it was running each time the process stopped`, new Error("too many interrupted tries"));
        continue;
      }
      let lastTry = false;
      if (task.waitingOn !== null) {
        if (now() >= task.receivedAt + guardWaitMs) lastTry = true;
        else {
          // Only when the time saved on the task has come, not at a kick that came early (a new message, a tick): so there is no loop, however busy the shop is.
          if (now() < (task.retryAt ?? 0)) { going = false; wakeAt(task.retryAt!); return; }
          if (options.guardAnswers && !(await options.guardAnswers(task.waitingOn))) {
            const delay = nextLook();
            db.postponeTask(task.id, now() + delay);
            going = false;
            wakeAt(now() + delay);
            return;
          }
        }
      }
      await runTask(task.id, task.payload, lastTry);
    }
  }

  function kick(): void {
    if (going || stopped) return;
    going = true;
    drained = drain().catch((e) => { going = false; broken = (e as Error).message; failed("The queue could not read its tasks", e); });
  }

  return {
    kick,

    async tick() {
      kick(); // a queue that stopped because the database failed starts again when it comes back
      if (tickWaiting || stopped) return;
      tickWaiting = true;
      await oneAtATime(async () => {
        tickWaiting = false;
        try {
          await step({ kind: "tick" });
          lastStep = now();
        } catch (e) {
          failed("A tick failed (the next one will try again)", e);
        }
      });
    },

    async idle() {
      for (;;) {
        const seen = queue;
        await drained;
        await seen;
        if (!going && seen === queue) return;
      }
    },

    health: () => broken ? { ok: false, reason: broken } : stopped ? { ok: false, reason: "The runtime is shutting down." } : { ok: true },
    lastStepAt: () => lastStep,
    lastFailureAt: () => lastFailure,
    counters: () => ({ steps, errors }),

    async stop() {
      stopped = true;
      clearTimeout(wakeTimer);
      wake?.();
      await drained;
      await queue;
    },
  };
}
