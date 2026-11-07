// The runtime: the Fees agent, the durable store and the task runner, wired so that every step is saved whole or not at all. How a step works, and why a crash leaves nothing
// half done, is explained once for every template in modules/runtime/core.ts. This file gives it Fees: its store, its agent, how its fees are counted and how a held refund
// is found from its receipt.
import { createAgent } from "../src/agent.ts";
import type { AgentEvent } from "../src/agent.ts";
import { createStore, monthLabel } from "../src/due.ts";
import type { Store } from "../src/due.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Payments } from "../../../../modules/payments/payments.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { batchName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { RETRY_DELAYS_MS, createRuntimeCore } from "../../../../modules/runtime/core.ts";
import type { BaseStatus, RefundCounts, Runtime as CoreRuntime, RuntimeKit } from "../../../../modules/runtime/core.ts";
import { parseStore, serializeStore } from "./snapshot.ts";
import type { DurableStore } from "./store.ts";

export const PATHWAY = "fees";
export { RETRY_DELAYS_MS };
export type { RefundCounts };

/** Fees calls two services: payments and messaging. It has no calendar. */
export interface Services { payments: Payments; messaging: Messaging; /** A UPI shop: where its QR pictures go (modules/payments/upi/qr-image.ts). Left out: the words alone. */ qrImage?: (text: string) => Promise<string | null> }

export interface RuntimeOptions {
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  services: Services;
  parser: IntentParser;
  pathwayVersion: string;
  /** The monthly AI allowance and the outside switch for this centre (modules/understanding/ai-state.ts). Left out: no limit and no switch. */
  ai?: AiPolicy;
  /** The monthly report to the owner (report/monthly-job.ts). Left out: none is made and nothing is sent. */
  report?: MonthlyReportSetup;
  retryDelaysMs?: number[];
  /** Runs around every agent step (`run` is the step itself). A seam for tests, to see order, hold a step or make one fail. */
  aroundStep?: (event: AgentEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

/** Counts only: never a name, a number or a word of a message. A heartbeat can carry this as it is. `fees` is the fees by state (open, paid, closed); a state with none is left out. */
export type Status = BaseStatus & { fees: Record<string, number> };

/**
 * What the approvals relay may know about a refund Guard is holding, found by the receipt the agent put on it (the fee's id and the payment: "f-3:pay_..."). Read-only.
 * `booking` is the fee's id (the shared relay calls any case that). The student, the batch and the month are worded in the OWNER's language, from the fee itself.
 */
export interface RefundContext {
  booking: string;
  customerPhone: string;
  businessName: string;
  timeZone: string;
  ownerLanguage: Language;
  studentName: string;
  batchName: string;
  monthLabel: string;
  paymentId: string;
  amountPaise: number;
  approval: string;
  expiresAtMs: number | null;
}

export type Runtime = CoreRuntime<Status, RefundContext>;

function countByState(store: Store): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const d of store.dues.values()) counts[d.state] = (counts[d.state] ?? 0) + 1;
  return counts;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { settings, clock, services, parser } = options;
  const policy: AiPolicy = options.ai ?? {};
  const kit: RuntimeKit<Store, Settings, RefundContext> = {
    pathway: PATHWAY,
    casesName: "fees",
    createStore,
    serialize: serializeStore,
    parse: parseStore,
    createAgent: ({ store, record }) => createAgent({ settings, clock, ...services, parser, record, store, ai: policy }),
    countCases: countByState,
    casesOf: (store) => store.dues.values(),
    refundContext(store, _settings, receipt) {
      const match = /^(f-\d+):/u.exec(receipt);
      const due = match ? store.dues.get(match[1]) : undefined;
      const hold = due?.pending.find((p) => p.kind === "guard_hold" && p.receipt === receipt);
      if (!due || !hold || hold.kind !== "guard_hold") return null;
      const language = settings.owner.language;
      const batch = settings.batches.find((b) => b.id === due.batchId);
      return {
        booking: due.id, customerPhone: due.customer, businessName: settings.name, timeZone: settings.timezone, ownerLanguage: language,
        studentName: due.studentName, batchName: batch ? batchName(batch, language) : due.batchId, monthLabel: monthLabel(due, language),
        paymentId: hold.paymentId, amountPaise: hold.amountInr * 100, approval: hold.approval, expiresAtMs: hold.expiresAtMs,
      };
    },
  };
  return createRuntimeCore({
    settings, store: options.store, clock, messaging: services.messaging, pathwayVersion: options.pathwayVersion, kit, ai: policy,
    monthly: options.report ? createMonthlyReport(options.report) : undefined,
    retryDelaysMs: options.retryDelaysMs, aroundStep: options.aroundStep as never, log: options.log,
  }) as unknown as Runtime;
}
