// The runtime of a listings-only shop: the agent (src/agent.ts), the durable store and the task runner, wired so every step is saved whole or not at all (how that works is
// explained once for every template in modules/runtime/core.ts). This file gives the core this template: an almost empty store (server/snapshot.ts), a status with no cases, and
// an owner's page with nothing waiting. The shop's listings, the storefront, the feed and the owner's listings page all come from the core, the same as for any shop.
import { createAgent } from "../src/agent.ts";
import { createStore } from "../src/state.ts";
import type { Store } from "../src/state.ts";
import { shopSkill } from "../src/assistant.ts";
import { CHAT_LIMITS } from "../src/chat-limits.ts";
import { ownerView } from "../src/channel.ts";
import type { Settings } from "../src/settings.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createLimitsKit } from "../../../../modules/limits/runtime-limits.ts";
import { createMorningJob } from "../../../../modules/assistant/morning.ts";
import { ownerAppView } from "../../../../modules/assistant/app/view.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";
import type { OwnerSignin } from "../../../../modules/channels/owner-signin.ts";
import type { CharacterPictures } from "../../../../modules/assistant/character.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { RETRY_DELAYS_MS, createRuntimeCore } from "../../../../modules/runtime/core.ts";
import type { BaseStatus, Runtime as CoreRuntime, RuntimeKit } from "../../../../modules/runtime/core.ts";
import { parseStore, serializeStore, keepStoreCounters, skipStoreCounters } from "./snapshot.ts";
import type { DurableStore } from "./store.ts";
import { PATHWAY } from "./config.ts";

export { PATHWAY, RETRY_DELAYS_MS };

/** A listings-only shop calls no service. The messaging is the push-only stand-in (the owner's app lists what a push would have said). */
export interface Services { messaging: Messaging }

export interface RuntimeOptions {
  settings: Settings;
  store: DurableStore;
  clock: Clock;
  services: Services;
  pathwayVersion: string;
  ai?: AiPolicy;
  recordKey?: Buffer;
  licence?: () => LicenceNow;
  ownerParser?: OwnerParser;
  talker?: import("../../../../modules/understanding/talk.ts").TalkModel;
  ownerSignin?: OwnerSignin;
  push?: import("../../../../modules/push/push.ts").Push;
  pictures?: () => CharacterPictures | undefined;
  retryDelaysMs?: number[];
  guardWaitMs?: number;
  guardLookAgainMs?: number[];
  aroundStep?: (event: import("../../../../modules/runtime/events.ts").RuntimeEvent, run: () => Promise<void>) => Promise<void>;
  log?: (line: string) => void;
}

/** Counts only. A listings-only shop has no cases, so `listings` (the count of its live listings) is the one number worth a heartbeat. */
export type Status = BaseStatus & { listings: Record<string, number> };
export type Runtime = CoreRuntime<Status, never>;

/** The listings by state, from the saved store: counts only, never a title or a word the owner said. */
function countListings(store: Store): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of store.assistant?.listings?.items ?? []) counts[l.state] = (counts[l.state] ?? 0) + 1;
  return counts;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { settings, clock, services } = options;
  const policy: AiPolicy = options.ai ?? {};
  const kit: RuntimeKit<Store, Settings, never> = {
    pathway: PATHWAY,
    casesName: "listings",
    createStore, serialize: serializeStore, parse: parseStore, skipCounters: skipStoreCounters, keepCounters: keepStoreCounters,
    services: services as unknown as Record<string, unknown>,
    createAgent: ({ store, record }) => createAgent({ settings, clock, messaging: services.messaging, record, store, ai: policy, ...(options.ownerParser ? { ownerParser: options.ownerParser } : {}), ...(options.talker ? { talker: options.talker } : {}) }),
    countCases: countListings,
    casesOf: () => [], // no money is held for the owner here
    refundContext: () => null,
    // The owner's page only. There is no booking page, no order page and no chat: the public side is the storefront ("What we have"), which the core serves for every shop.
    channel: {
      offer: async () => ({ kind: "listings", shop: { name: settings.name } }),
      view: () => null,
      owner: (store) => {
        const app = ownerAppView({ skills: [shopSkill()], state: store.assistant, nowMs: clock.now(), timeZone: settings.timezone, settings: settings.assistant });
        return { ...ownerView(settings), app: { ...app, listen: false } };
      },
    },
  };
  return createRuntimeCore({
    limits: createLimitsKit({ declared: CHAT_LIMITS, settings, clock, owner: settings.owner }),
    settings, store: options.store, clock, messaging: services.messaging, pathwayVersion: options.pathwayVersion, kit, ai: policy,
    // the morning line is a message to the owner: only a shop whose owner can be reached (push on) has one; the owner's app shows the same cards either way
    ...(options.push?.on ? { daily: createMorningJob<Store>({ shop: { name: settings.name, timezone: settings.timezone, owner: settings.owner, settings: settings.assistant, ...(options.pictures ? { pictures: options.pictures } : {}) }, skills: () => [shopSkill()] }) } : {}),
    ...(options.licence ? { licence: options.licence } : {}),
    ...(options.recordKey ? { recordKey: options.recordKey } : {}), ...(options.ownerSignin ? { ownerSignin: options.ownerSignin } : {}),
    retryDelaysMs: options.retryDelaysMs, guardWaitMs: options.guardWaitMs, guardLookAgainMs: options.guardLookAgainMs,
    ...(options.aroundStep ? { aroundStep: options.aroundStep } : {}), ...(options.log ? { log: options.log } : {}),
  }) as unknown as Runtime;
}
