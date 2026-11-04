// The services the agent talks to. In "fakes" mode they are the in-memory stand-ins, good for a local run (they forget
// everything when the process stops). In "live" mode they are the real adapters, loaded only then, each pointing at a Guard
// that holds the keys. The runtime holds no service key and no webhook secret.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createFakeMessaging } from "../src/adapters/messaging.ts";
import type { Messaging } from "../src/adapters/messaging.ts";
import { createFakePayments } from "../src/adapters/payments.ts";
import type { Clock } from "../src/clock.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { LANGUAGES } from "../src/settings.ts";
import { REPORT_TEMPLATE_NAMES } from "../report/whatsapp.ts";
import { ClientError } from "./config.ts";
import type { RuntimeConfig } from "./config.ts";
import type { Services } from "./runtime.ts";
import type { WindowStore } from "./store.ts";

/** The shape of src/adapters/live/index.ts. */
export interface LiveModule {
  createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore }): Services;
}

/** The services as the live adapters take them: each Guard's credential for this agent has been read from its file. */
export type LiveServices = {
  payments: { baseUrl: string; agentToken?: string };
  calendar: { baseUrl: string; calendarId: string; agentToken?: string };
  messaging: { baseUrl: string; phoneNumberId: string; agentToken?: string };
  timeoutMs?: number;
};

/** Read the files that hold this agent's credential for each Guard. The credential is never logged and never part of the config the runtime keeps. */
export function readAgentTokens(config: NonNullable<RuntimeConfig["services"]>): LiveServices {
  const token = (file: string | undefined): { agentToken?: string } => {
    if (!file) return {};
    let text: string;
    try { text = readFileSync(file, "utf8").trim(); } catch { throw new ClientError(`I could not read the agent credential file ${file} (services.*.agentTokenFile).`); }
    if (text.length === 0) throw new ClientError(`The agent credential file ${file} is empty.`);
    return { agentToken: text };
  };
  const { agentTokenFile: p, ...payments } = config.payments;
  const { agentTokenFile: c, ...calendar } = config.calendar;
  const { agentTokenFile: m, ...messaging } = config.messaging;
  return { payments: { ...payments, ...token(p) }, calendar: { ...calendar, ...token(c) }, messaging: { ...messaging, ...token(m) }, ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}) };
}

const LIVE_MODULE = new URL("../src/adapters/live/index.ts", import.meta.url);

/** Load the live adapters (dynamic import, so fakes mode never touches them). Says so plainly if this build does not have them. */
export async function loadLiveModule(): Promise<LiveModule> {
  if (!existsSync(fileURLToPath(LIVE_MODULE))) {
    throw new ClientError('Live mode needs the live service adapters (src/adapters/live/index.ts), and this build of the pathway does not have them. Set "mode" to "fakes" in runtime.json for a local run, or use a pathway version that includes them.');
  }
  return await import(LIVE_MODULE.href) as LiveModule;
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

  const fake = createFakeMessaging(deps.clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...REPORT_TEMPLATE_NAMES]) for (const language of LANGUAGES) fake.approve(name, language);
  const say = deps.say ?? (() => undefined);
  const messaging: Messaging = {
    // The stand-in never hears that a customer wrote (nobody calls its receive), so its window is closed and replies go as templates.
    async sendText(to, text) { const m = await fake.sendText(to, text); say(`[stand-in WhatsApp] to ${to}: ${text}`); return m; },
    async sendTemplate(to, template) { const m = await fake.sendTemplate(to, template); say(`[stand-in WhatsApp] to ${to}: ${template.text}`); return m; },
    isWindowOpen: (to) => fake.isWindowOpen(to),
    getMessage: (id) => fake.getMessage(id),
  };
  return { calendar: createFakeCalendar(), payments: createFakePayments(deps.clock), messaging };
}
