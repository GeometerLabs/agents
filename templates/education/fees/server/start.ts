// Start one centre's agent: read its folder, open its store, wire the services, resume what was left pending, listen, and keep the clock ticking. main.ts is a thin command
// line around this; the tests start it directly. The start itself, and the reading of messages and of the report block, are the same for every template
// (modules/runtime/start.ts); this file gives them Fees' reading, its report and its runtime.
import { createFeesModelParser, createFeesRouter } from "../src/adapters/reading.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { readGoLive } from "../report/cli.ts";
import type { MonthlyReportSetup } from "../report/monthly-job.ts";
import { buildUnderstanding as understanding, monthlyReportSetup as reportSetup, parserArguments, readToken, startRuntimeClient } from "../../../../modules/runtime/start.ts";
import type { RunningClient as SharedRunningClient } from "../../../../modules/runtime/start.ts";
import { loadClient, pathwayVersion } from "./config.ts";
import type { ClientFolder } from "./config.ts";
import { createRuntime } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import { buildServices } from "./services.ts";
import type { LiveModule } from "./services.ts";

export { parserArguments, readToken };

export interface StartOptions {
  clientFolder: string;
  /** A file holding the internal bearer token (INTERNAL_TOKEN_FILE). */
  tokenFile: string | undefined;
  clock?: Clock;
  /** Instead of what runtime.json says (its `parser`, or the rule parser when it has none). A test seam. */
  parser?: IntentParser;
  log?: (line: string) => void;
  loadLive?: () => Promise<LiveModule>;
}

export type RunningClient = SharedRunningClient<ClientFolder["settings"], Runtime> & { client: ClientFolder };

/**
 * How this centre reads messages and what it may spend: the three steps from runtime.json (rules always; a System One decision model if `decision` is set; a small
 * language model if `parser` is set), and the monthly allowance and outside switch. A step whose key is named but not in the environment is OFF, with a line saying
 * so: nothing is ever sent to a paid service without its key. With neither step, the rule parser reads everything.
 */
export function buildUnderstanding(client: ClientFolder, deps: { clock: Clock; env?: Record<string, string | undefined>; log: (line: string) => void }): { parser: IntentParser; ai: AiPolicy } {
  return understanding(client, deps, { createRuleParser, createModelParser: createFeesModelParser as never, createRouter: createFeesRouter as never });
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
    casesName: "fees",
    loadClient,
    async build(client, { store, clock, log }) {
      const services = await buildServices(client.runtime, { clock, window: { lastInboundAt: (phone) => store.lastInboundAt(phone) }, say: log, loadLive: options.loadLive });
      // The steps, the allowance and the outside switch (see buildUnderstanding). A model behind a Guard gets no provider key from here; with an `agentTokenFile` it
      // gets this agent's credential for that Guard; a provider reached directly gets the key its `keyEnv` names, from the environment, and nothing else.
      const reading = buildUnderstanding(client as ClientFolder, { clock, log });
      return createRuntime({ settings: client.settings, store, clock, services, parser: options.parser ?? reading.parser, ai: reading.ai, report: monthlyReportSetup(client as ClientFolder, log), pathwayVersion: pathwayVersion(), log });
    },
  }) as RunningClient;
}
