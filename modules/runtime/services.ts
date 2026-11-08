// The services an agent talks to, for every template. In "fakes" mode they are the in-memory stand-ins, good for a local run (they forget everything when the process
// stops). In "live" mode they are the real adapters, loaded only then, each pointing at a Guard that holds the keys. The runtime holds no service key and no webhook secret.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Clock } from "../core/clock.ts";
import { LANGUAGES } from "../language/languages.ts";
import { createFakeMessaging } from "../messaging/messaging.ts";
import type { Messaging } from "../messaging/messaging.ts";
import { ClientError } from "./config.ts";
import type { LiveServicesConfig, ServiceConfig } from "./config.ts";
import type { WindowStore } from "./store.ts";

/** The services as the live adapters take them: each Guard's credential for this agent has been read from its file. */
export type LiveServices = { [service: string]: (Omit<ServiceConfig, "agentTokenFile"> & { agentToken?: string }) | number | undefined } & { timeoutMs?: number };

/** Read the files that hold this agent's credential for each Guard. The credential is never logged and never part of the config the runtime keeps. */
export function readAgentTokens(config: NonNullable<LiveServicesConfig>, names: readonly string[]): LiveServices {
  const out: LiveServices = {};
  for (const name of names) {
    if (config[name] === undefined) continue; // a service the shop does not have (a UPI shop has no payment service)
    const { agentTokenFile, ...rest } = config[name] as ServiceConfig;
    let token: string | undefined;
    if (agentTokenFile) {
      try { token = readFileSync(agentTokenFile, "utf8").trim(); } catch { throw new ClientError(`I could not read the agent credential file ${agentTokenFile} (services.*.agentTokenFile).`); }
      if (token.length === 0) throw new ClientError(`The agent credential file ${agentTokenFile} is empty.`);
    }
    out[name] = { ...rest, ...(token !== undefined ? { agentToken: token } : {}) };
  }
  if (typeof config.timeoutMs === "number") out.timeoutMs = config.timeoutMs;
  return out;
}

/**
 * Load a pathway's live adapters (dynamic import, so fakes mode never touches them). Says so plainly if this build does not have them. `module` is the address of the
 * pathway's `src/adapters/live/index.ts`, which exports `createLiveAdapters(services, { clock, window })`.
 */
export async function loadLiveAdapters<Adapters>(module: URL): Promise<{ createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore }): Adapters }> {
  if (!existsSync(fileURLToPath(module))) {
    throw new ClientError('Live mode needs the live service adapters (src/adapters/live/index.ts), and this build of the pathway does not have them. Set "mode" to "fakes" in runtime.json for a local run, or use a pathway version that includes them.');
  }
  return await import(module.href);
}

/**
 * The stand-in WhatsApp for a local run: the in-memory fake, with every template of the pathway approved in every language, that shows what it "sends" through `say`.
 * It never hears that a customer wrote (nobody calls its receive), so its window is closed and replies go as templates.
 */
export function standInMessaging(clock: Clock, templateNames: readonly string[], say: (line: string) => void = () => undefined): Messaging {
  const fake = createFakeMessaging(clock);
  for (const name of templateNames) for (const language of LANGUAGES) fake.approve(name, language);
  return {
    async sendText(to, text) { const m = await fake.sendText(to, text); say(`[stand-in WhatsApp] to ${to}: ${text}`); return m; },
    async sendTemplate(to, template) { const m = await fake.sendTemplate(to, template); say(`[stand-in WhatsApp] to ${to}: ${template.text}`); return m; },
    isWindowOpen: (to) => fake.isWindowOpen(to),
    getMessage: (id) => fake.getMessage(id),
  };
}
