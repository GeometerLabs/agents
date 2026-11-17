// The services the agent talks to. In "fakes" mode they are the in-memory stand-in WhatsApp, good for a local run (it forgets everything when the process stops). In "live"
// mode it is the real adapter, loaded only then, pointing at a Guard that holds the key. The runtime holds no service key and no webhook secret. Reading the credential
// files and loading the adapter are the same for every template (modules/runtime/services.ts); this file says Stock orders has one service, messaging.
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
  createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore }): Services;
}

/** The services as the live adapter takes them: the Guard's credential for this agent has been read from its file. */
export type LiveServices = { messaging: { baseUrl: string; phoneNumberId: string; agentToken?: string; provider?: "meta" | "gupshup" | "gupshup-selfserve"; appId?: string; appName?: string; sourceNumber?: string }; timeoutMs?: number };

/** Read the file that holds this agent's credential for the WhatsApp Guard. The credential is never logged and never part of the config the runtime keeps. */
export function readAgentTokens(config: NonNullable<RuntimeConfig["services"]>): LiveServices {
  return readTokens(config as never, ["messaging"]) as unknown as LiveServices;
}

const LIVE_MODULE = new URL("../src/adapters/live/index.ts", import.meta.url);

/** Load the live adapter (dynamic import, so fakes mode never touches it). Says so plainly if this build does not have it. */
export async function loadLiveModule(): Promise<LiveModule> {
  return await loadLiveAdapters<Services>(LIVE_MODULE) as unknown as LiveModule;
}

export interface ServicesDeps {
  clock: Clock;
  window: WindowStore;
  /** Where the stand-in WhatsApp shows what it "sends", so a local run can be read. */
  say?: (line: string) => void;
  loadLive?: () => Promise<LiveModule>;
}

export async function buildServices(config: Pick<RuntimeConfig, "mode" | "services">, deps: ServicesDeps): Promise<Services> {
  if (config.mode === "live") {
    const live = await (deps.loadLive ?? loadLiveModule)();
    return live.createLiveAdapters(readAgentTokens(config.services!), { clock: deps.clock, window: deps.window });
  }
  return { messaging: standInMessaging(deps.clock, [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES, ...REPORT_TEMPLATE_NAMES], deps.say) };
}
