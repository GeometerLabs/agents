// The step runner: handles saved tasks one at a time, in the order they arrived, and runs the clock's ticks through the
// same queue, so two steps never overlap. A step that throws is tried again after a wait, a few times, and then the
// task is marked failed and the queue goes on with the next one (a customer waiting behind a broken message is worse
// than a broken message).
//
// "Tried again" starts from the last saved state, not from wherever the failed step stopped: see runtime.ts.
import type { AgentEvent } from "../src/agent.ts";
import type { DurableStore } from "./store.ts";

export interface RunnerOptions {
  db: Pick<DurableStore, "nextPending" | "startAttempt" | "failTask">;
  /** Handle one event and save the result. For a saved task, `taskId` is marked done in the same save. */
  step: (event: AgentEvent, taskId?: string) => Promise<void>;
  /** How long to wait before the first retry, the second and so on. The number of tries is one more than this list is long. */
  retryDelaysMs: number[];
  log: (line: string) => void;
}

export interface TaskRunner {
  /** Start on any pending task (a no-op if already going). Called after events are saved, and on start for those left over. */
  kick(): void;
  /** One tick of the clock through the queue. Skipped if a tick is already waiting. Never rejects. */
  tick(): Promise<void>;
  /** Resolves when nothing is running and nothing is pending. */
  idle(): Promise<void>;
  health(): { ok: true } | { ok: false; reason: string };
  lastStepAt(): number | null;
  lastFailureAt(): number | null;
  /** Finish the step in hand, leave the rest pending for the next start. */
  stop(): Promise<void>;
}

export function createRunner(options: RunnerOptions & { now: () => number }): TaskRunner {
  const { db, step, retryDelaysMs, log, now } = options;
  const maxAttempts = retryDelaysMs.length + 1;
  let queue: Promise<unknown> = Promise.resolve(); // the serial queue: each step starts when the one before it has ended
  let going = false;
  let drained: Promise<void> = Promise.resolve();
  let tickWaiting = false;
  let stopped = false;
  let broken: string | undefined;
  let wake: (() => void) | undefined;
  let lastStep: number | null = null;
  let lastFailure: number | null = null;

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
    log(`${what}: ${(e as Error)?.message ?? e}`);
  };

  async function runTask(id: string, payload: string): Promise<void> {
    for (;;) {
      const attempt = db.startAttempt(id); // saved before the step runs: a step that kills the process still counts
      try {
        await oneAtATime(() => step(JSON.parse(payload) as AgentEvent, id));
        lastStep = now();
        return;
      } catch (e) {
        const last = attempt >= maxAttempts;
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
      await runTask(task.id, task.payload);
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

    async stop() {
      stopped = true;
      wake?.();
      await drained;
      await queue;
    },
  };
}
