// The runtime: the Stock orders agent, the durable store and the task runner, wired so that every step is saved whole or not at all. How a step works, and why a crash leaves
// nothing half done, is explained once for every template in modules/runtime/core.ts. This file gives it Stock orders: its store, its agent, how its orders are counted and the
// owner's page.
//
// A step is saved when it ends, so a message sent INSIDE a step could go out twice if the process died after WhatsApp took it and before the save. The order message (and the
// reminder to the supplier) is therefore not sent by the step: the step records an intent, and this runtime sends it after the step's save with a saved claim before the send
// and a saved ending after (modules/messaging/send-once.ts, called from modules/runtime/core.ts). A claim with no ending is never sent again; the owner is asked. A step that
// only finds Guard down is thrown away before anything is sent. Messages that are only words to the owner still go in the step: a repeat of those is a nuisance, not a debt.
import { createAgent } from "../src/agent.ts";
import type { AgentEvent } from "../src/agent.ts";
import { createStore } from "../src/order.ts";
import type { Store } from "../src/order.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import type { Settings } from "../src/settings.ts";
import { RETRY_DELAYS_MS, createRuntimeCore } from "../../../../modules/runtime/core.ts";
import { createLimitsKit } from "../../../../modules/limits/runtime-limits.ts";
import { CHAT_LIMITS } from "../src/chat-limits.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import type { BaseStatus, RefundCounts, Runtime as CoreRuntime, RuntimeKit } from "../../../../modules/runtime/core.ts";
import { parseStore, serializeStore, keepStoreCounters, skipStoreCounters } from "./snapshot.ts";
import { createMorningJob } from "../../../../modules/assistant/morning.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import { stockSkill } from "../src/assistant.ts";
import type { DurableStore } from "./store.ts";
import type { OwnerSignin } from "../../../../modules/channels/owner-signin.ts";
import type { CharacterPictures } from "../../../../modules/assistant/character.ts";
import { ownerAppView } from "../../../../modules/assistant/app/view.ts";
import { ownerView } from "../src/channel.ts";
import { SKILL } from "../src/order.ts";

import { PATHWAY } from "./config.ts";
export { PATHWAY };
export { RETRY_DELAYS_MS };
export type { RefundCounts };

/** Stock orders calls one service: WhatsApp. It has no payments and no calendar. */
export interface Services { messaging: Messaging }

export interface RuntimeOptions {
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  services: Services;
  pathwayVersion: string;
  /** The monthly AI allowance and the outside switch for this shop (modules/understanding/ai-state.ts). Left out: no limit and no switch. */
  ai?: AiPolicy;
  /** The record's key (B69, RECORD_KEY_FILE): the inputs' digest and message ids are written with it. Left out (fakes mode): written plain. */
  recordKey?: Buffer;
  /** The monthly report to the owner (report/monthly-job.ts). Left out: none is made and nothing is sent. */
  report?: MonthlyReportSetup;
  /** The shop's licence right now (modules/licence; the start reads client/licence.json). Left out: never restricted. */
  licence?: () => LicenceNow;
  /** How the shop's assistant reads the owner's words (modules/assistant/reading.ts). Left out: the rules alone. */
  ownerParser?: OwnerParser;
  /** The shop's talk model (modules/assistant/understanding.ts buildTalker). Left out: no talk. */
  talker?: import("../../../../modules/understanding/talk.ts").TalkModel;
  /** The owner's sign-in on the shop's page (modules/channels/owner-signin.ts), made by the shared start. Left out: none. */
  ownerSignin?: OwnerSignin;
  /** The shop's web push: a message to the owner is also pushed to the phones that allowed alerts. Left out: none. */
  push?: import("../../../../modules/push/push.ts").Push;
  /** The character's mood pictures (pages.json), for the morning line. Left out: none sent. */
  pictures?: () => CharacterPictures | undefined;
  retryDelaysMs?: number[];
  guardWaitMs?: number;
  guardLookAgainMs?: number[];
  /** Runs around every agent step (`run` is the step itself). A seam for tests, to see order, hold a step or make one fail. */
  aroundStep?: (event: AgentEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

/** Counts only: never a name, a number or a word of a message. A heartbeat can carry this as it is. `orders` is the purchase orders by state; a state with none is left out. */
export type Status = BaseStatus & { orders: Record<string, number> };

/** Stock orders holds no refund, so there is nothing for the approvals relay to look up. */
export type RefundContext = never;
export type Runtime = CoreRuntime<Status, RefundContext>;

function countByState(store: Store): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of store.orders.values()) counts[o.state] = (counts[o.state] ?? 0) + 1;
  return counts;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { settings, clock, services } = options;
  const policy: AiPolicy = options.ai ?? {};
  const skillOver = (store: Store) => stockSkill({ settings, store, nowMs: () => clock.now(), optedOut: (phone) => store.optedOut.has(phone.replace(/\D/gu, "")) });
  const kit: RuntimeKit<Store, Settings, RefundContext> = {
    pathway: PATHWAY,
    casesName: "orders",
    createStore,
    serialize: serializeStore,
    parse: parseStore,
    skipCounters: skipStoreCounters,
    keepCounters: keepStoreCounters,
    services: services as unknown as Record<string, unknown>,
    // the step's watched services, when the runtime hands them (guard-wait.ts), else the shop's own
    createAgent: ({ store, record, services: watched }) => createAgent({
      settings, clock, messaging: ((watched ?? services) as unknown as Services).messaging, record, store, ai: policy, sendLater: true, // the runtime sends the order message after the step is saved (modules/messaging/send-once.ts)
      ...(options.ownerParser ? { ownerParser: options.ownerParser } : {}), ...(options.talker ? { talker: options.talker } : {}),
    }),
    countCases: countByState,
    casesOf: () => [], // no refunds here: nothing is held for the owner by a payments Guard
    refundContext: () => null,
    // The owner's page only: Stock orders has no customers, so the public offer and the request view have nothing to show (modules/channels/front.ts answers 404 for a "stock" shop).
    channel: {
      offer: async () => ({ kind: "stock", shop: { name: settings.name } }),
      view: () => null,
      owner: (store) => {
        const view = ownerView(settings, store, clock.now());
        if (!settings.assistant) return view;
        const app = ownerAppView({ skills: [skillOver(store)], state: store.assistant, nowMs: clock.now(), timeZone: settings.timezone, settings: settings.assistant });
        // an order that waits is already an item (its own approval card): the app's list leaves out the cards for it, so one order is never shown twice
        return { ...view, app: { ...app, cards: app.cards.filter((c) => !(c.skill === SKILL && c.kind === "order")), listen: false } };
      },
    },
  };

  return createRuntimeCore({
    // "Limits, tightened by a tap": the cap and the budget the owner may tighten, put into the settings the agent reads before every step (modules/limits/runtime-limits.ts)
    limits: createLimitsKit({ declared: CHAT_LIMITS, settings, clock, owner: settings.owner }),
    settings, store: options.store, clock, messaging: services.messaging, pathwayVersion: options.pathwayVersion, kit, ai: policy,
    monthly: options.report ? createMonthlyReport(options.report) : undefined,
    // the owner's morning line, from this template's skill read-only over the store
    ...(settings.assistant ? { daily: createMorningJob<Store>({
      shop: { name: settings.name, timezone: settings.timezone, owner: settings.owner, settings: settings.assistant, ...(options.pictures ? { pictures: options.pictures } : {}) },
      skills: (store) => [skillOver(store)],
    }) } : {}),
    ...(options.licence ? { licence: options.licence } : {}),
    ...(options.recordKey ? { recordKey: options.recordKey } : {}), ...(options.ownerSignin ? { ownerSignin: options.ownerSignin } : {}), retryDelaysMs: options.retryDelaysMs, guardWaitMs: options.guardWaitMs, guardLookAgainMs: options.guardLookAgainMs, aroundStep: options.aroundStep as never, log: options.log,
  }) as unknown as Runtime;
}
