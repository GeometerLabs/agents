// The runtime: the agent, the durable store and the task runner, wired so that every step is saved whole or not at all. How a step works, and why a crash leaves nothing
// half done, is explained once for every template in modules/runtime/core.ts. This file gives it Bookings: its store, its agent, how its bookings are counted and how a
// held refund is found from its receipt.
import { createAgent } from "../src/agent.ts";
import type { AgentEvent } from "../src/agent.ts";
import { createStore } from "../src/booking.ts";
import type { Store } from "../src/booking.ts";
import type { Calendar } from "../src/adapters/calendar.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Payments } from "../../../../modules/payments/payments.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { serviceName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { RETRY_DELAYS_MS, createRuntimeCore } from "../../../../modules/runtime/core.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { createBookingsLicenceNotice } from "./licence.ts";
import type { BaseStatus, RefundCounts, Runtime as CoreRuntime, RuntimeKit } from "../../../../modules/runtime/core.ts";
import { parseStore, serializeStore } from "./snapshot.ts";
import type { DurableStore } from "./store.ts";

export const PATHWAY = "bookings";
export { RETRY_DELAYS_MS };
export type { RefundCounts };

export interface Services { calendar: Calendar; payments: Payments; messaging: Messaging; /** A UPI shop: where its QR pictures go (modules/payments/upi/qr-image.ts). Left out: the words alone. */ qrImage?: (text: string) => Promise<string | null> }

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
  /** The shop's licence right now (modules/licence; the start reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
  retryDelaysMs?: number[];
  /** Runs around every agent step (`run` is the step itself). A seam for tests, to see order, hold a step or make one fail. */
  aroundStep?: (event: AgentEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

/** Counts only: never a name, a number or a word of a message. A heartbeat can carry this as it is. `bookings` is the bookings by state; a state with none is left out. */
export type Status = BaseStatus & { bookings: Record<string, number> };

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

export type Runtime = CoreRuntime<Status, RefundContext>;

function countByState(store: Store): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of store.bookings.values()) counts[b.state] = (counts[b.state] ?? 0) + 1;
  return counts;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { settings, clock, services, parser } = options;
  const policy: AiPolicy = options.ai ?? {};
  const kit: RuntimeKit<Store, Settings, RefundContext> = {
    pathway: PATHWAY,
    casesName: "bookings",
    createStore,
    serialize: serializeStore,
    parse: parseStore,
    createAgent: ({ store, record }) => createAgent({ settings, clock, ...services, parser, record, store, ai: policy, ...(options.licence ? { licence: options.licence } : {}) }),
    countCases: countByState,
    casesOf: (store) => store.bookings.values(),
    refundContext(store, _settings, receipt) {
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
  };
  return createRuntimeCore({
    settings, store: options.store, clock, messaging: services.messaging, pathwayVersion: options.pathwayVersion, kit, ai: policy,
    monthly: options.report ? createMonthlyReport(options.report) : undefined,
    ...(options.licence ? { licence: options.licence, licenceNotice: createBookingsLicenceNotice(settings, options.licence) } : {}),
    retryDelaysMs: options.retryDelaysMs, aroundStep: options.aroundStep as never, log: options.log,
  }) as unknown as Runtime;
}
