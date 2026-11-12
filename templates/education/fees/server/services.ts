// The services the agent talks to. In "fakes" mode they are the in-memory stand-ins, good for a local run (they forget everything when the process stops). In "live" mode
// they are the real adapters, loaded only then, each pointing at a Guard that holds the keys. The runtime holds no service key and no webhook secret. Reading the
// credential files and loading the adapters are the same for every template (modules/runtime/services.ts); this file says which services Fees has: payments and
// messaging.
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { REPORT_TEMPLATE_NAMES } from "../report/whatsapp.ts";
import { loadLiveAdapters, readAgentTokens as readTokens, standInMessaging } from "../../../../modules/runtime/services.ts";
import type { RuntimeConfig } from "./config.ts";
import type { Services } from "./runtime.ts";
import type { WindowStore } from "./store.ts";

/** The shape of src/adapters/live/index.ts. */
export interface LiveModule {
  createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore; payment?: unknown }): Services;
}

/** The services as the live adapters take them: each Guard's credential for this agent has been read from its file. */
export type LiveServices = {
  payments: { baseUrl: string; agentToken?: string };
  messaging: { baseUrl: string; phoneNumberId: string; agentToken?: string; provider?: "meta" | "gupshup" | "gupshup-selfserve"; appId?: string; appName?: string; sourceNumber?: string }; // provider: modules/messaging/providers.ts
  timeoutMs?: number;
};

/** Read the files that hold this agent's credential for each Guard. The credential is never logged and never part of the config the runtime keeps. */
export function readAgentTokens(config: NonNullable<RuntimeConfig["services"]>): LiveServices {
  return readTokens(config as never, ["payments", "messaging"]) as unknown as LiveServices;
}

const LIVE_MODULE = new URL("../src/adapters/live/index.ts", import.meta.url);

/** Load the live adapters (dynamic import, so fakes mode never touches them). Says so plainly if this build does not have them. */
export async function loadLiveModule(): Promise<LiveModule> {
  return await loadLiveAdapters<Services>(LIVE_MODULE) as unknown as LiveModule;
}

export interface ServicesDeps {
  clock: Clock;
  window: WindowStore;
  /** Where the stand-in WhatsApp shows what it "sends", so a local run can be read. */
  say?: (line: string) => void;
  loadLive?: () => Promise<LiveModule>;
  /** The shop's payment block (settings.payment): which gateway a payments service is (B71). */
  payment?: unknown;
}

export async function buildServices(config: Pick<RuntimeConfig, "mode" | "services">, deps: ServicesDeps): Promise<Services> {
  if (config.mode === "live") {
    const live = await (deps.loadLive ?? loadLiveModule)();
    return live.createLiveAdapters(readAgentTokens(config.services!), { clock: deps.clock, window: deps.window, ...(deps.payment ? { payment: deps.payment } : {}) });
  }
  return { payments: createFakePayments(deps.clock), messaging: standInMessaging(deps.clock, [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES, ...REPORT_TEMPLATE_NAMES], deps.say) };
}
