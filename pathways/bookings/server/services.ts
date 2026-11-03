// The services the agent talks to. In "fakes" mode they are the in-memory stand-ins, good for a local run (they forget
// everything when the process stops). In "live" mode they are the real adapters, loaded only then, each pointing at a Guard
// that holds the keys. The runtime holds no service key and no webhook secret.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createFakeMessaging } from "../src/adapters/messaging.ts";
import type { Messaging } from "../src/adapters/messaging.ts";
import { createFakePayments } from "../src/adapters/payments.ts";
import type { Clock } from "../src/clock.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { LANGUAGES } from "../src/settings.ts";
import { ClientError } from "./config.ts";
import type { RuntimeConfig } from "./config.ts";
import type { Services } from "./runtime.ts";
import type { WindowStore } from "./store.ts";

/** The shape of src/adapters/live/index.ts. */
export interface LiveModule {
  createLiveAdapters(services: NonNullable<RuntimeConfig["services"]>, deps: { clock: Clock; window: WindowStore }): Services;
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
    return live.createLiveAdapters(config.services!, { clock: deps.clock, window: deps.window });
  }

  const fake = createFakeMessaging(deps.clock);
  for (const name of Object.values(TEMPLATE_NAMES)) for (const language of LANGUAGES) fake.approve(name, language);
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
