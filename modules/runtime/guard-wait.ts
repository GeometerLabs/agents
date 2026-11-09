// When a Guard cannot be reached, a customer's message waits for it instead of being lost. The same for every template.
//
// An agent's failure handling (`say`, `ensureLink`, the `.catch(() => null)` beside a read) takes a Guard that is down for a provider that said no: it sends "sorry" and the
// step is saved as done, or it throws and the task runs out of tries. Neither keeps the customer's message. So each task's step runs over WATCHED services, and whether it
// is kept is decided after the agent returns, whatever the agent caught or swallowed:
//   - The first call that finds a Guard unreachable or not ready (`waitsForGuard`, faults.ts: the one table of what each failure means) stops the step. From there on no
//     call leaves the step, so the agent's "sorry" and its note to the owner never go out. The step is thrown away whole, which core.ts already makes clean: nothing of it
//     was saved. The task stays pending and waits.
//   - The wait costs nothing that grows: the queue sleeps until the time saved on the task, then asks the Guard one plain read (`guardAnswers`). No step, no model and no
//     message runs until the Guard answers. Backing off to `GUARD_LOOK_AGAIN_MS`'s last value, a Guard that stays down is asked about twice a minute.
//   - A rerun starts from the last saved state, so it depends on what the first try left at the providers. Calendar writes and payment links are found again by their
//     case id ("look first"). A WhatsApp send, a refund, or a write whose outcome is unknown is not: if one of those went out before the Guard was found down, the step is
//     past waiting, keeps today's handling, and is not run again (`oneTime` below).
//   - The wait is bounded by `GUARD_WAIT_MS`. Then the step runs once more with waiting off, so the template's own "could not confirm" words go out (the customer's only if the
//     WhatsApp Guard is up: with it down, nothing can reach them and only the to-do item can be written), and the owner's to-do list gets one item (modules/unfinished).
//
// ORDER STAYS SHOP-WIDE: one task waits at the head of the queue and everything behind it waits too. Letting other conversations go past was tried on paper and refused. A
// thrown-away step has already used the shop's next case number (`b-7`) and may have made a calendar hold and a payment link under it; the step that ran next would take the
// same number, and its "look first" would find the first customer's hold and link. Keeping them apart needs reserved ids and a place in line for payment events that name no
// conversation, and a partial version of that gets two customers' bookings crossed. A Guard that stays down past the bound therefore stops holding the shop up: see `givenUp`.
import { GuardHeldError, GuardUnavailableError, NotSentError, TimeoutError, mayHaveHappened, waitsForGuard } from "../core/faults.ts";
import { MINUTE } from "../core/time.ts";

/**
 * How long a task may wait for its Guard, counted from when the message arrived: 15 minutes. It is the whole shop's silence at its worst, because order is shop-wide, so it
 * is kept short of a customer giving up. It covers a Guard restart, a redeploy and a server reboot with its containers coming back. A Guard still down after that needs a
 * person, and the customer is better off told to try again than left unanswered. It is also the deposit hold's default length, so a customer who paid before an outage is
 * not sitting on a confirmation much past the time the hold was promised for.
 */
export const GUARD_WAIT_MS = 15 * MINUTE;

/** How long to wait before asking the Guard again, doubling up to the last value. Short at first, because most outages are a restart of a few seconds. */
export const GUARD_LOOK_AGAIN_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

/** A step found its Guard down and nothing of it was saved: the task runner keeps the task waiting. Never a failure of the task. */
export class WaitingForGuard extends Error {
  service: string;
  /** Guard's own `Retry-After`, when it gave one (it is only busy for a moment). */
  retryAfterSeconds?: number;
  constructor(service: string, cause: unknown) {
    super((cause as Error)?.message ?? String(cause));
    this.name = "WaitingForGuard";
    this.service = service;
    if (cause instanceof GuardUnavailableError && cause.retryAfterSeconds !== undefined) this.retryAfterSeconds = cause.retryAfterSeconds;
  }
}

// What a method of a service does at the provider. A method on neither list is taken as one-time: an unknown method is never assumed repeatable.
const READS = new Set(["get", "list", "conflicts", "freeBusy", "fetchRequest", "listRequests", "fetchPayment", "listRefunds", "isWindowOpen", "getMessage", "ping"]);
/** Found again on a rerun by the booking or fee they belong to (`ensureEvent`, `removeEvents`, `ensureLink`, `cancelRequest` with its read-back): repeating one finds the first. */
const FOUND_AGAIN = new Set(["insert", "update", "delete", "createRequest", "cancelRequest"]);

export interface StepWatch {
  /** What the agent is given in place of `services`. */
  services: Record<string, unknown> | undefined;
  /** Set when this step found a Guard down and is to be thrown away. */
  readonly stopped: { service: string; error: unknown } | undefined;
  /** The first service found down in this step, even when that did not stop it (waiting off, or a one-time write already went). */
  readonly down: string | undefined;
  /** A send, a refund, a held call or a write of unknown outcome went out: this step cannot be run again. */
  readonly oneTime: boolean;
  /** The services that answered in this step: a Guard given up on that answers is no longer given up on. */
  readonly answered: ReadonlySet<string>;
}

/** Every one-time call of a tick that was thrown away: the next tick gets those answers again instead of repeating the calls. See `sendMemory`. */
export interface SendMemory {
  begin(): void;
  recall(key: string): { value: unknown } | undefined;
  note(key: string, value: unknown): void;
  clear(): void;
}

/**
 * A tick has no saved task to wait with, and it is thrown away whole when anything in it throws (a hold's expiry reading a payment link that a Guard down cannot give). The
 * next tick starts from the same saved state, so without this every reminder it had sent would go out again, once a tick, for as long as the outage lasts. The answers are
 * kept in memory only, until a tick is saved: a restart loses them, as it loses a tick in flight today.
 */
export function sendMemory(): SendMemory {
  let done: [string, unknown][] = [];
  let pool = new Map<string, unknown[]>();
  return {
    begin() {
      pool = new Map();
      for (const [key, value] of done) { const list = pool.get(key); if (list) list.push(value); else pool.set(key, [value]); }
    },
    recall(key) { const list = pool.get(key); return list && list.length > 0 ? { value: list.shift() } : undefined; },
    note(key, value) { done.push([key, value]); },
    clear() { done = []; },
  };
}

interface WatchOptions {
  /** `wait`: a task's step, kept waiting when its Guard is down. `observe`: only note it (a tick, or the last try after the bound). */
  mode: "wait" | "observe";
  /** Guards given up on in this outage: tasks no longer wait for them, so a Guard that stays down does not hold the shop up past the bound. */
  givenUp: ReadonlySet<string>;
  /** Ticks: one-time calls already made by a tick that was thrown away. */
  memory?: SendMemory;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";

/**
 * The services of one step, each call watched. A wrapper handed to `kit.createAgent` rather than a hook in the HTTP client, so the in-memory fakes go through exactly the
 * same decisions as the live adapters. A service that is not an object (`qrImage`, which writes a local file) is passed through untouched: it never reaches a Guard.
 */
export function watchStep(services: Record<string, unknown> | undefined, options: WatchOptions): StepWatch {
  let stopped: StepWatch["stopped"];
  let down: string | undefined;
  let oneTime = false;
  const answered = new Set<string>();

  function failed(service: string, method: string, e: unknown): void {
    if (waitsForGuard(e)) {
      down ??= service;
      if (options.mode === "wait" && !oneTime && !options.givenUp.has(service)) stopped ??= { service, error: e };
      return;
    }
    if (READS.has(method)) return;
    // A held call is real at Guard, and a lost reply or a 5xx may have reached the provider: a rerun would ask or send it again.
    if (e instanceof GuardHeldError || mayHaveHappened(e) || (e as { status?: number })?.status! >= 500) oneTime = true;
  }

  function watched(service: string, target: object): object {
    return new Proxy(target, {
      get(t, property) {
        const value = Reflect.get(t, property, t) as unknown;
        if (typeof value !== "function") return value;
        const method = String(property);
        const oneTimeCall = !READS.has(method) && !FOUND_AGAIN.has(method);
        return (...args: unknown[]) => {
          // Once the step is stopped nothing leaves it: this is what keeps the agent's own "sorry" from going out on a Guard that is up, only to be sent again by the rerun.
          if (stopped) return Promise.reject(new NotSentError(`Not tried: the ${stopped.service} Guard could not be reached, so this step will be run again.`));
          const key = oneTimeCall && options.memory ? `${service}.${method}:${JSON.stringify(args)}` : undefined;
          const again = key === undefined ? undefined : options.memory!.recall(key);
          if (again) return Promise.resolve(again.value);
          const succeeded = (result: unknown) => {
            answered.add(service);
            if (oneTimeCall) { oneTime = true; if (key !== undefined) options.memory!.note(key, result); }
            return result;
          };
          let result: unknown;
          try { result = Reflect.apply(value as (...a: unknown[]) => unknown, t, args); } catch (e) { failed(service, method, e); throw e; }
          return isThenable(result) ? Promise.resolve(result).then(succeeded, (e) => { failed(service, method, e); throw e; }) : result;
        };
      },
    });
  }

  const wrapped = services === undefined ? undefined : Object.fromEntries(Object.entries(services).map(([name, service]) => [name, typeof service === "object" && service !== null ? watched(name, service) : service]));
  return {
    services: wrapped,
    get stopped() { return stopped; },
    get down() { return down; },
    get oneTime() { return oneTime; },
    answered,
  };
}

/** Reads that reach a service's Guard and change nothing. The reference is one no case has, so the provider answers with an empty list. */
const PROBE_REFERENCE = "guard-wait-probe";
const PROBES: Record<string, (service: any) => Promise<unknown> | undefined> = {
  payments: (s) => s.listRequests({ reference_id: PROBE_REFERENCE }),
  calendar: (s) => s.list({ bookingRef: PROBE_REFERENCE }),
  messaging: (s) => s.ping?.(),
};

/**
 * Has this service's Guard come back? Asked before a parked step is run again, so a step that would only find the Guard still down costs no model call. Any answer the Guard
 * gave counts as back, a refusal included: it is reachable and ready enough to decide. A timeout is not an answer. A service with no such read says yes, and the step is the
 * look: the rerun finds out, and the same wait follows.
 */
export async function guardAnswers(service: string, services: Record<string, unknown> | undefined): Promise<boolean> {
  const target = services?.[service];
  const probe = PROBES[service];
  if (typeof target !== "object" || target === null || !probe) return true;
  try {
    await probe(target);
    return true;
  } catch (e) {
    return !(waitsForGuard(e) || e instanceof TimeoutError);
  }
}
