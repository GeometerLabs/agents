// Start one shop's agent: read its folder, open its store, wire the WhatsApp service, resume what was left pending, listen, and keep the clock ticking. main.ts is a thin
// command line around this; the tests start it directly. The start itself, the reading of the owner's words and of the report block are the same for every template
// (modules/runtime/start.ts); this file gives them Stock orders' client, its report and its runtime. Stock orders reads the owner's words by rules; a language model reads
// them only for the shop's assistant, when the settings have an "assistant" block and runtime.json names one.
import { join } from "node:path";
import { PAGES_FILE, pagesReader, picturesOf } from "../../../../modules/channels/pages-file.ts";
import { pushMessaging } from "../../../../modules/push/push.ts";
import { runtimeHasWhatsApp } from "../../../../modules/runtime/config.ts";
import type { Messaging } from "../../../../modules/messaging/messaging.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { readGoLive } from "../report/cli.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { licenceReader } from "../../../../modules/runtime/config.ts";
import { monthlyReportSetup as reportSetup, parserArguments, readToken, startRuntimeClient, buildUnderstanding as understanding } from "../../../../modules/runtime/start.ts";
import type { RunningClient as SharedRunningClient } from "../../../../modules/runtime/start.ts";
import { loadClient, pathwayVersion } from "./config.ts";
import type { ClientFolder } from "./config.ts";
import { createRuntime } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import { buildServices } from "./services.ts";
import type { LiveModule } from "./services.ts";
import { OWNER_UNDERSTANDING, buildTalker } from "../../../../modules/assistant/understanding.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";

export { parserArguments, readToken };

export interface StartOptions {
  clientFolder: string;
  /** A file holding the internal bearer token (INTERNAL_TOKEN_FILE). */
  tokenFile: string | undefined;
  /** A file holding the record's key (RECORD_KEY_FILE, B69); needed in live mode. Left out: the environment's. */
  recordKeyFile?: string;
  /** A file holding the channel token (CHANNEL_TOKEN_FILE) for the owner's page. Left out: the environment's, or none. */
  channelTokenFile?: string;
  clock?: Clock;
  log?: (line: string) => void;
  loadLive?: () => Promise<LiveModule>;
}

export type RunningClient = SharedRunningClient<ClientFolder["settings"], Runtime> & { client: ClientFolder };

/**
 * The monthly report to the owner (report/monthly-job.ts), from the `report` block of runtime.json. Without the block there is none, and nothing is sent. The signing key and
 * the go-live certificate are read here, so a path that cannot be read stops the start with a plain sentence rather than failing on the 1st of the month.
 */
export function monthlyReportSetup(client: ClientFolder, log: (line: string) => void): MonthlyReportSetup | undefined {
  return reportSetup(client, log, readGoLive as never) as MonthlyReportSetup | undefined;
}

export async function startClient(options: StartOptions): Promise<RunningClient> {
  return await startRuntimeClient<ClientFolder["settings"], Runtime>(options, {
    casesName: "orders",
    loadClient,
    async build(client, { store, clock, log, recordKey, ownerSignin, push }) {
      const raw = await buildServices(client.runtime, { clock, window: { lastInboundAt: (phone) => store.lastInboundAt(phone) }, say: log, loadLive: options.loadLive });
      // every message to the owner by the owner's choice of WhatsApp, push or both; the supplier's messages are WhatsApp only (the push wrapper passes them through)
      const services = { messaging: pushMessaging(runtimeHasWhatsApp(client.runtime) ? raw.messaging as Messaging | undefined : undefined, push, () => client.settings.owner.whatsapp, clock) };
      // the allowance and the outside switch, and (only for a shop whose settings have the assistant) the owner's reading and the talk model
      const reading = understanding(client as never, { clock, log: client.settings.assistant ? log : () => undefined }, OWNER_UNDERSTANDING as never);
      const ownerParser = client.settings.assistant ? reading.parser as unknown as OwnerParser : undefined;
      const talker = client.settings.assistant ? buildTalker(client as never, { clock, log }) : undefined;
      return createRuntime({
        settings: client.settings, store, clock, services, ai: reading.ai, ...(ownerParser ? { ownerParser } : {}), ...(talker ? { talker } : {}),
        report: monthlyReportSetup(client as ClientFolder, log), pathwayVersion: pathwayVersion(), licence: licenceReader(client.folder, clock),
        ...(recordKey ? { recordKey } : {}), ...(ownerSignin ? { ownerSignin } : {}), ...(push ? { push } : {}),
        pictures: () => picturesOf(pagesReader(join(client.folder, PAGES_FILE))()), log,
      });
    },
  }) as RunningClient;
}
