// Start one shop's agent: read its folder, open its store, wire the services, resume what was left pending, listen, and keep the clock ticking. main.ts is a thin command
// line around this; the tests start it directly. The start itself, and the reading of messages and of the report block, are the same for every template
// (modules/runtime/start.ts); this file gives them Orders' reading, its report and its runtime.
import { buildVoice } from "../../../../modules/voice/config.ts";
import { folderQrImages } from "../../../../modules/payments/owner-marked/qr-image.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import type { PaymentSettings } from "../../../../modules/payments/providers/index.ts";
import { createOrdersModelParser, createOrdersRouter } from "../src/adapters/reading.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { readGoLive } from "../report/cli.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { licenceReader } from "../../../../modules/runtime/config.ts";
import { termsReader } from "../../../../modules/terms/reader.ts";
import { buildUnderstanding as understanding, monthlyReportSetup as reportSetup, parserArguments, readToken, startRuntimeClient } from "../../../../modules/runtime/start.ts";
import type { RunningClient as SharedRunningClient } from "../../../../modules/runtime/start.ts";
import { loadClient, pathwayVersion } from "./config.ts";
import type { ClientFolder } from "./config.ts";
import { createRuntime } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import { buildServices } from "./services.ts";
import type { LiveModule } from "./services.ts";
import { OWNER_UNDERSTANDING } from "../../../../modules/assistant/understanding.ts";
import type { OwnerParser } from "../../../../modules/assistant/reading.ts";

export { parserArguments, readToken };

export interface StartOptions {
  clientFolder: string;
  /** A file holding the internal bearer token (INTERNAL_TOKEN_FILE). */
  tokenFile: string | undefined;
  /** A file holding the record's key (RECORD_KEY_FILE, B69); needed in live mode. Left out: the environment's. */
  recordKeyFile?: string;
  /** Item 11h: a file holding the channel token (CHANNEL_TOKEN_FILE) for the shop's page, its API, MCP and the owner's page. Left out: the environment's, or none. */
  channelTokenFile?: string;
  clock?: Clock;
  /** Instead of what runtime.json says (its `parser`, or the rule parser when it has none). A test seam. */
  parser?: IntentParser;
  log?: (line: string) => void;
  loadLive?: () => Promise<LiveModule>;
}

export type RunningClient = SharedRunningClient<ClientFolder["settings"], Runtime> & { client: ClientFolder };

/**
 * How this shop reads messages and what it may spend: the three steps from runtime.json (rules always; a System One decision model if `decision` is set; a small
 * language model if `parser` is set), and the monthly allowance and outside switch. A step whose key is named but not in the environment is OFF, with a line saying
 * so: nothing is ever sent to a paid service without its key. With neither step, the rule parser reads everything.
 */
export function buildUnderstanding(client: ClientFolder, deps: { clock: Clock; env?: Record<string, string | undefined>; log: (line: string) => void }): { parser: IntentParser; ai: AiPolicy } {
  return understanding(client, deps, { createRuleParser, createModelParser: createOrdersModelParser as never, createRouter: createOrdersRouter as never });
}

/**
 * The monthly report to the owner (report/monthly-job.ts), from the `report` block of runtime.json. Without the block there is none, and nothing is sent. The signing key and
 * the go-live certificate are read here, so a path that cannot be read stops the start with a plain sentence rather than failing on the 1st of the month.
 */
export function monthlyReportSetup(client: ClientFolder, log: (line: string) => void): MonthlyReportSetup | undefined {
  return reportSetup(client, log, readGoLive) as MonthlyReportSetup | undefined;
}

export async function startClient(options: StartOptions): Promise<RunningClient> {
  return await startRuntimeClient<ClientFolder["settings"], Runtime>(options, {
    casesName: "orders",
    loadClient,
    async build(client, { store, clock, log, recordKey, ownerSignin }) {
      const built = await buildServices(client.runtime, { clock, window: { lastInboundAt: (phone) => store.lastInboundAt(phone) }, say: log, loadLive: options.loadLive, payment: client.settings.payment });
      // An owner-marked shop's QR pictures (UPI) go into the folder the monthly report's pages are served from (read-only, no listing), under random names (B33).
      const report = client.runtime.report;
      const services = ownerMarkedOf((client.settings as { payment?: PaymentSettings }).payment) && report ? { ...built, qrImage: folderQrImages({ dir: report.pagesDir, baseUrl: report.pageBaseUrl, log }) } : built;
      // The steps, the allowance and the outside switch (see buildUnderstanding). A model behind a Guard gets no provider key from here; with an `agentTokenFile` it
      // gets this agent's credential for that Guard; a provider reached directly gets the key its `keyEnv` names, from the environment, and nothing else.
      const reading = buildUnderstanding(client as ClientFolder, { clock, log });
      // B29: voice notes, only for a shop whose runtime.json has a `speech` block (the bundle writes it only when the server holds the provider's key).
      const speech = client.runtime.speech;
      const voice = speech ? buildVoice(speech, { clock, languages: client.settings.languages, log }) : undefined;
      // Item 11e: the shop's assistant reads the owner's words through the same steps, with the owner's reading (modules/assistant/reading.ts). Only when it is on.
      const ownerParser = client.settings.assistant ? understanding(client as ClientFolder, { clock, log: () => undefined }, OWNER_UNDERSTANDING as never).parser as OwnerParser : undefined;
      return createRuntime({ settings: client.settings, store, clock, services, ...(voice ? { voice } : {}), parser: options.parser ?? reading.parser, ...(ownerParser ? { ownerParser } : {}), ai: reading.ai, report: monthlyReportSetup(client as ClientFolder, log), pathwayVersion: pathwayVersion(), licence: licenceReader(client.folder, clock), terms: termsReader(client.folder), ...(recordKey ? { recordKey } : {}), ...(ownerSignin ? { ownerSignin } : {}), log });
    },
  }) as RunningClient;
}
