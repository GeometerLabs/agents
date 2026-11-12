// The runtime: the agent, the durable store and the task runner, wired so that every step is saved whole or not at all. How a step works, and why a crash leaves nothing
// half done, is explained once for every template in modules/runtime/core.ts. This file gives it Bookings: its store, its agent, how its bookings are counted and how a
// held refund is found from its receipt.
import { createAgent } from "../src/agent.ts";
import type { AgentEvent } from "../src/agent.ts";
import { createStore } from "../src/booking.ts";
import type { Store } from "../src/booking.ts";
import type { Calendar } from "../src/adapters/calendar.ts";
import { createOwnCalendar } from "../src/adapters/own-calendar.ts";
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
import { parseStore, serializeStore, keepStoreCounters, skipStoreCounters } from "./snapshot.ts";
import { createMorningJob } from "../../../../modules/assistant/morning.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import { bookingsSkill } from "../src/assistant.ts";
import type { DurableStore } from "./store.ts";

export const PATHWAY = "bookings";
export { RETRY_DELAYS_MS };
export type { RefundCounts };

export interface Services { /** Left out for a shop with no Google Calendar (B72): the agent then uses the shop's own booking list (src/adapters/own-calendar.ts). */ calendar?: Calendar; payments: Payments; messaging: Messaging; /** A UPI shop: where its QR pictures go (modules/payments/owner-marked/qr-image.ts). Left out: the words alone. */ qrImage?: (text: string) => Promise<string | null> }

export interface RuntimeOptions {
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  services: Services;
  parser: IntentParser;
  pathwayVersion: string;
  /** The monthly AI allowance and the outside switch for this shop (modules/understanding/ai-state.ts). Left out: no limit and no switch. */
  ai?: AiPolicy;
  /** The record's key (B69, RECORD_KEY_FILE): the inputs' digest and message ids are written with it. Left out (fakes mode): written plain. */
  recordKey?: Buffer;
  /** The monthly report to the owner (report/monthly-job.ts). Left out: none is made and nothing is sent. */
  report?: MonthlyReportSetup;
  /** The shop's licence right now (modules/licence; the start reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
  /** B72: the shop terms the owner can agree to on WhatsApp (modules/terms/reader.ts). Left out: off. */
  terms?: () => import("../../../../modules/terms/terms.ts").TermsFile | undefined;
  /** Item 11e: the owner's router for the shop's assistant (modules/assistant/reading.ts). Left out: the rules alone read the owner's words. */
  ownerParser?: OwnerParser;
  retryDelaysMs?: number[];
  guardWaitMs?: number;
  guardLookAgainMs?: number[];
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
  /** B37: who asked for this refund (the owner, by their command, in a shop with other approvers). The relay never asks them to approve it. */
  requestedBy?: string[];
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
    skipCounters: skipStoreCounters,
    keepCounters: keepStoreCounters,
    services: services as unknown as Record<string, unknown>,
    createAgent: ({ store, record, services: watched }) => createAgent({ settings, clock, ...(watched as unknown as Services), calendar: (watched as unknown as Services).calendar ?? createOwnCalendar(store, () => clock.now()), parser, record, store, ai: policy, ...(options.licence ? { licence: options.licence } : {}), ...(options.terms ? { terms: options.terms } : {}), ...(options.ownerParser ? { ownerParser: options.ownerParser } : {}) }),
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
        paymentId: hold.paymentId, amountPaise: hold.amountInr * 100, approval: hold.approval, expiresAtMs: hold.expiresAtMs, ...(hold.requestedBy ? { requestedBy: hold.requestedBy } : {}),
      };
    },
  };
  return createRuntimeCore({
    settings, store: options.store, clock, messaging: services.messaging, pathwayVersion: options.pathwayVersion, kit, ai: policy,
    monthly: options.report ? createMonthlyReport(options.report) : undefined,
    // Item 11e: the owner's morning line, from Bookings read-only over the store (no acts; the record's money lines are the job's own to read)
    ...(settings.assistant ? { daily: createMorningJob<Store>({
      shop: { name: settings.name, timezone: settings.timezone, owner: settings.owner, settings: settings.assistant },
      skills: (store) => [bookingsSkill({ settings, store, nowMs: () => clock.now(), entries: () => [], optedOut: (phone) => store.customers.get(phone)?.optedOut ?? false })],
    }) } : {}),
    ...(options.licence ? { licence: options.licence, licenceNotice: createBookingsLicenceNotice(settings, options.licence) } : {}),
    ...(options.recordKey ? { recordKey: options.recordKey } : {}), retryDelaysMs: options.retryDelaysMs, guardWaitMs: options.guardWaitMs, guardLookAgainMs: options.guardLookAgainMs, aroundStep: options.aroundStep as never, log: options.log,
  }) as unknown as Runtime;
}
