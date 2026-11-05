// The runtime: the agent, the durable store and the task runner, wired so that every step is saved whole or not at all.
//
// How a step works:
//  1. Build a FRESH store and record from the last saved state, and a fresh agent over them. (The agent keeps nothing
//     of its own between steps, so this costs little, and it is what makes a retry start clean.)
//  2. Let the agent handle the event. It changes the store and appends to the record as it goes, in memory only.
//  3. Save, in one transaction: the new snapshot, the record entries the step made, and the task's "done" mark.
//  4. Only then does this process treat the new state as the saved one.
// If step 2 or 3 throws, nothing was saved and nothing in memory is reused, so there is nothing to undo. If the process
// dies anywhere in 1 to 3, the task is still pending on disk and runs again from the last saved state.
import { createAgent } from "../src/agent.ts";
import type { AgentEvent } from "../src/agent.ts";
import { createStore } from "../src/booking.ts";
import type { Store } from "../src/booking.ts";
import type { RefundIssueKind } from "../../../modules/payments/refunds.ts";
import type { Calendar } from "../src/adapters/calendar.ts";
import type { Messaging } from "../../../modules/messaging/messaging.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import { summaryOf } from "../../../modules/understanding/ai-state.ts";
import type { AiPolicy, AiSummary } from "../../../modules/understanding/ai-state.ts";
import type { Payments } from "../../../modules/payments/payments.ts";
import type { Clock } from "../../../modules/core/clock.ts";
import { createRecord } from "../../../modules/record/record.ts";
import type { ActionRecord, RecordEntry } from "../../../modules/record/record.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { serviceName } from "../src/settings.ts";
import { HOUR } from "../../../modules/core/time.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../modules/language/languages.ts";
import type { IncomingEvent } from "./events.ts";
import { parseStore, serializeStore } from "./snapshot.ts";
import type { DurableStore, TaskCounts, WindowStore } from "./store.ts";
import { createRunner } from "./tasks.ts";

export const PATHWAY = "bookings";
/** Wait before the first, second and third retry; so four tries in all. */
export const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

export interface Services { calendar: Calendar; payments: Payments; messaging: Messaging }

export interface RuntimeOptions {
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  services: Services;
  parser: IntentParser;
  pathwayVersion: string;
  /** The monthly AI allowance and the outside switch for this shop (modules/understanding/ai-state.ts). Left out: no limit and no switch. */
  ai?: AiPolicy;
  /** The monthly report to the owner (report/monthly-job.ts). Left out: none is made and nothing is sent. */
  report?: MonthlyReportSetup;
  retryDelaysMs?: number[];
  /** Runs around every agent step (`run` is the step itself). A seam for tests, to see order, hold a step or make one fail. */
  aroundStep?: (event: AgentEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

/** Counts only: never a name, a number or a word of a message. A heartbeat can carry this as it is. */
export interface Status {
  pathway: string;
  version: string;
  bookings: Record<string, number>; // by state; a state with no bookings is left out
  refunds: RefundCounts;
  tasks: TaskCounts;
  oldestPendingAt: string | null;
  lastStepAt: string | null;
  lastFailureAt: string | null;
  recordLength: number;
  /** Running totals since `startedAt` (this process): tasks finished and failed attempts. A new `startedAt` means the totals started again from zero. */
  steps: number;
  errors: number;
  startedAt: string;
  /** This month's understanding: messages read at each step, the estimated cost in micro-rupees, the allowance, and whether the agent is in button mode and why. Counts only. */
  ai: AiSummary;
}

/**
 * Refunds, counted. `waitingForOwner`: Guard holds them and the approvals relay has asked (or will ask) the owner. `beingSentAgain`: nothing
 * went out and the agent is trying again. `needBuilder`: refunds that need the builder and NOT the owner, by why: an unclear outcome
 * (`unknown`, `uncertain`, `unconfirmed`), Guard said no (`refused`, `failed`), the owner never answered (`expired`), or Guard let a refund
 * above the limit through unheld (`unheld`: its threshold does not match the settings).
 */
export interface RefundCounts {
  waitingForOwner: number;
  beingSentAgain: number;
  needBuilder: Partial<Record<RefundIssueKind, number>> & { total: number };
}

/** What the approvals relay may know about a refund Guard is holding, found by the receipt the agent put on it (the booking id and the payment). Read-only. */
export interface RefundContext {
  booking: string;
  customerPhone: string;
  businessName: string;
  timeZone: string;
  /** The owner's language, and the service named in it. */
  ownerLanguage: Language;
  serviceName: string;
  slotMs: number;
  paymentId: string;
  amountPaise: number;
  approval: string;
  expiresAtMs: number | null;
}

export interface Runtime {
  /** The WhatsApp windows, for the live adapters. */
  readonly window: WindowStore;
  /** Save events as tasks. They are on disk when this returns; call `kick` afterwards to let the queue run. */
  submit(events: IncomingEvent[]): { saved: number; duplicates: number };
  kick(): void;
  tick(): Promise<void>;
  idle(): Promise<void>;
  status(): Status;
  /** The held refund with this receipt, for the approvals relay to cross-check against what Guard says it holds; null if none is held. */
  refundContext(receipt: string): RefundContext | null;
  ready(): { ok: true } | { ok: false; reason: string };
  close(): Promise<void>;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { settings, store: db, clock, services, parser, pathwayVersion } = options;
  const policy: AiPolicy = options.ai ?? {};
  const log = options.log ?? (() => undefined);

  // What the last saved step left. Replaced only after a save succeeds. The status reads these, never a step in progress.
  const saved = db.loadState();
  let snapshot = saved.snapshot ?? serializeStore(createStore());
  let entries: readonly RecordEntry[] = saved.record;
  let bookings = countByState(parseStore(snapshot));
  let refunds = countRefunds(parseStore(snapshot));

  const monthly = options.report ? createMonthlyReport(options.report) : undefined;
  let lastReportError = { same: "", at: 0 };

  async function step(event: AgentEvent, taskId?: string): Promise<void> {
    const store = parseStore(snapshot);
    const record = createRecord(clock, entries);
    const agent = createAgent({ settings, clock, ...services, parser, record, store, ai: policy });
    const run = () => agent.handle(event);
    await (options.aroundStep ? options.aroundStep(event, run) : run());

    // The monthly report rides on the clock's beat, after the agent's own work. It saves twice itself (before it sends, and after), through `save`. A report that cannot be
    // made is said once and never holds up the beat: holds still expire and reminders still go.
    if (event.kind === "tick" && monthly) {
      try { await monthly.run({ settings, clock, messaging: services.messaging, record, store, log, save: () => save(store, record) }); }
      catch (e) {
        // said once, and again each hour it goes on: the paths in the message (a new random folder each time) are left out of the comparison
        const same = (e as NodeJS.ErrnoException).code ?? (e as Error).message.replace(/\S*[\\/]\S*/gu, "…");
        if (same !== lastReportError.same || clock.now() - lastReportError.at >= HOUR) { log(`The monthly report could not be made: ${(e as Error).message}`); lastReportError = { same, at: clock.now() }; }
      }
    }
    save(store, record, taskId);
  }

  /** Save what the step has done so far, whole or not at all, and only then treat it as the saved state. */
  function save(store: Store, record: ActionRecord, taskId?: string): void {
    const after = serializeStore(store);
    const all = record.entries();
    if (taskId === undefined && after === snapshot && all.length === entries.length) return; // a quiet tick has nothing to save
    const fresh = all.slice(entries.length);
    db.commitStep({ taskId, snapshot: after, entries: fresh, nowMs: clock.now() });
    snapshot = after;
    entries = all;
    // The builder or partner is told once, here, when the agent moves to buttons: the agent writes one ai_mode line per episode (its reason is in the line and in /status).
    for (const e of fresh) {
      if (e.action !== "ai_mode") continue;
      if (e.refs.mode === "step_paused") log(`The ${e.refs.step} model kept failing, so the agent skips it until ${e.refs.until} and the language model reads each message meanwhile. The record's ai_mode line says why; /status shows when the pause ends.`);
      else if (e.refs.mode === "step_resumed") log(`The ${e.refs.step} model answered again, so the agent asks it first again.`);
      else log(`The agent now answers with buttons and lists, no AI (${e.refs.reason}). The record's ai_mode line says why; /status counts the month.`);
    }
    bookings = countByState(store);
    const was = refunds.needBuilder.total;
    refunds = countRefunds(store);
    if (refunds.needBuilder.total > was) log(`A refund needs the builder, not the owner (${describe(refunds.needBuilder)}). The record says why; /status counts them.`);
  }

  const startedAt = new Date(clock.now()).toISOString();
  const runner = createRunner({ db, step, retryDelaysMs: options.retryDelaysMs ?? RETRY_DELAYS_MS, log, now: () => clock.now() });
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

  return {
    window: { lastInboundAt: (phone) => db.lastInboundAt(phone) },
    submit: (events) => db.saveEvents(events, clock.now()),
    kick: runner.kick,
    tick: runner.tick,
    idle: runner.idle,

    status: () => ({
      pathway: PATHWAY,
      version: pathwayVersion,
      bookings,
      refunds,
      tasks: db.taskCounts(),
      oldestPendingAt: iso(db.oldestPendingAt()),
      lastStepAt: iso(runner.lastStepAt()),
      lastFailureAt: iso(runner.lastFailureAt()),
      recordLength: entries.length,
      ...runner.counters(),
      startedAt,
      ai: summaryOf(parseStore(snapshot), policy, clock.now(), settings.timezone),
    }),

    refundContext(receipt) {
      const store = parseStore(snapshot);
      const match = /^(b-\d+):/u.exec(receipt);
      const b = match ? store.bookings.get(match[1]) : undefined;
      const hold = b?.pending.find((p) => p.kind === "guard_hold" && p.receipt === receipt);
      if (!b || !hold || hold.kind !== "guard_hold" || b.startMs === undefined) return null;
      const service = settings.services.find((s) => s.id === b.serviceId);
      if (!service) return null;
      return {
        booking: b.id, customerPhone: b.customer, businessName: settings.name, timeZone: settings.timezone,
        ownerLanguage: settings.owner.language, serviceName: serviceName(service, settings.owner.language), slotMs: b.startMs,
        paymentId: hold.paymentId, amountPaise: hold.amountInr * 100, approval: hold.approval, expiresAtMs: hold.expiresAtMs,
      };
    },

    ready() {
      try { db.ping(); } catch (e) { return { ok: false, reason: `The store cannot be read: ${(e as Error).message}` }; }
      return runner.health();
    },

    async close() {
      await runner.stop();
      db.close();
    },
  };
}

function countRefunds(store: Store): RefundCounts {
  const counts: RefundCounts = { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } };
  for (const b of store.bookings.values()) {
    for (const p of b.pending) {
      if (p.kind === "guard_hold") counts.waitingForOwner++;
      else if (p.kind === "refund_retry") counts.beingSentAgain++;
    }
    for (const issue of b.refundIssues ?? []) {
      counts.needBuilder[issue.kind] = (counts.needBuilder[issue.kind] ?? 0) + 1;
      counts.needBuilder.total++;
    }
  }
  return counts;
}

const describe = (needBuilder: RefundCounts["needBuilder"]) => Object.entries(needBuilder).filter(([kind, n]) => kind !== "total" && n > 0).map(([kind, n]) => `${n} ${kind}`).join(", ");

function countByState(store: Store): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of store.bookings.values()) counts[b.state] = (counts[b.state] ?? 0) + 1;
  return counts;
}
