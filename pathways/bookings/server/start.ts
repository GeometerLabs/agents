// Start one client's agent: read its folder, open its store, wire the services, resume what was left pending, listen, and keep
// the clock ticking. main.ts is a thin command line around this; the tests start it directly.
import { readFileSync } from "node:fs";
import { createModelParser } from "../src/adapters/model-llm.ts";
import type { ModelConfig } from "../../../modules/understanding/model-llm.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import { systemOneFromEnv } from "../../../modules/understanding/system-one.ts";
import { createRouter } from "../src/adapters/understanding.ts";
import type { DecisionStep, ModelStep } from "../../../modules/understanding/router.ts";
import type { AiPolicy } from "../../../modules/understanding/ai-state.ts";
import { systemClock } from "../../../modules/core/clock.ts";
import type { Clock } from "../../../modules/core/clock.ts";
import { ClientError, aiOverrideReader, loadClient, pathwayVersion } from "./config.ts";
import type { ClientFolder } from "./config.ts";
import { createRuntime } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import { startServer } from "./server.ts";
import type { RunningServer } from "./server.ts";
import { buildServices } from "./services.ts";
import type { LiveModule } from "./services.ts";
import { openStore } from "./store.ts";
import { startTicker } from "./ticker.ts";

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

export interface RunningClient {
  client: ClientFolder;
  runtime: Runtime;
  server: RunningServer;
  /** Stop listening and ticking, finish the step in hand, close the store. What is still pending runs at the next start. */
  stop(): Promise<void>;
}

const MIN_TOKEN_LENGTH = 16;

/**
 * The model parser's config and a fetch that presents a credential, if there is one: this agent's credential for the model's Guard (`agentTokenFile`), or the provider's
 * own key from the environment variable `keyEnv` names. Never both, and never a key in runtime.json. The key is sent only in the Authorization header of calls to the
 * configured address and is not logged or put in an error.
 */
export function parserArguments(config: NonNullable<ClientFolder["runtime"]["parser"]>, env: Record<string, string | undefined> = process.env): [ModelConfig, typeof fetch?] {
  const { agentTokenFile, provider: _provider, keyEnv, ...model } = config;
  const bearer = (token: string): typeof fetch => (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } });
  if (keyEnv) {
    const key = env[keyEnv]?.trim();
    return key ? [model, bearer(key)] : [model];
  }
  if (!agentTokenFile) return [model];
  let token: string;
  try { token = readFileSync(agentTokenFile, "utf8").trim(); } catch { throw new ClientError(`I could not read the agent credential file ${agentTokenFile} (parser.agentTokenFile).`); }
  if (token.length === 0) throw new ClientError(`The agent credential file ${agentTokenFile} is empty.`);
  return [model, bearer(token)];
}

/**
 * How this client reads messages and what it may spend: the three steps from runtime.json (rules always; a System One decision model if `decision` is set; a small
 * language model if `parser` is set), and the monthly allowance and outside switch. A step whose key is named but not in the environment is OFF, with a line saying
 * so: nothing is ever sent to a paid service without its key. With neither step, the rule parser reads everything, as before.
 */
export function buildUnderstanding(client: ClientFolder, deps: { clock: Clock; env?: Record<string, string | undefined>; log: (line: string) => void }): { parser: IntentParser; ai: AiPolicy } {
  const env = deps.env ?? process.env;
  const rt = client.runtime;
  let decision: DecisionStep | undefined;
  let model: ModelStep | undefined;
  if (rt.decision) {
    const d = rt.decision;
    const step = systemOneFromEnv({ baseUrl: d.baseUrl, model: d.model, kind: d.provider, keyEnv: d.keyEnv, ...(d.timeoutMs !== undefined ? { timeoutMs: d.timeoutMs } : {}) }, env);
    if (step) decision = { client: step, ...(d.threshold !== undefined ? { threshold: d.threshold } : {}), ...(d.languages ? { languages: d.languages } : {}) };
    else deps.log(`Step 1 (the decision model) is off: ${d.keyEnv} is not set, so nothing is sent to ${d.provider}.`);
  }
  if (rt.parser) {
    if (rt.parser.keyEnv && !env[rt.parser.keyEnv]?.trim()) deps.log(`Step 2 (the language model) is off: ${rt.parser.keyEnv} is not set, so nothing is sent to ${rt.parser.provider ?? new URL(rt.parser.baseUrl).hostname}.`);
    else model = { parser: createModelParser(...parserArguments(rt.parser, env)), provider: rt.parser.provider ?? new URL(rt.parser.baseUrl).hostname, model: rt.parser.model };
  }
  const parser = decision || model ? createRouter({ decision, model, now: () => deps.clock.now() }) : createRuleParser();
  const ai: AiPolicy = {
    override: aiOverrideReader(client.folder, rt.ai === "buttons" ? "buttons" : "auto"),
    ...(rt.allowance ? { allowance: { ...(rt.allowance.messages !== undefined ? { messages: rt.allowance.messages } : {}), ...(rt.allowance.costInr !== undefined ? { costMicroInr: Math.round(rt.allowance.costInr * 1_000_000) } : {}) } } : {}),
    ...(rt.pauseMinutes !== undefined ? { pauseMinutes: rt.pauseMinutes } : {}),
  };
  return { parser, ai };
}

/** The token is a file, never a command-line argument or a value in runtime.json, so it stays out of process lists and git. */
export function readToken(file: string | undefined): string {
  if (!file) throw new ClientError("Set INTERNAL_TOKEN_FILE to a file that holds the internal token the inbox sends (for example: openssl rand -hex 32 > token.txt).");
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { throw new ClientError(`I could not read the internal token file ${file} (INTERNAL_TOKEN_FILE).`); }
  const token = text.trim();
  if (token.length < MIN_TOKEN_LENGTH) throw new ClientError(`The internal token in ${file} is too short to be safe (${token.length} characters; at least ${MIN_TOKEN_LENGTH}). Make a new one with: openssl rand -hex 32`);
  return token;
}

export async function startClient(options: StartOptions): Promise<RunningClient> {
  const log = options.log ?? ((line: string) => console.log(line));
  const clock = options.clock ?? systemClock;
  const client = loadClient(options.clientFolder); // refuses a wrong pathway version before anything is opened
  const token = readToken(options.tokenFile);

  const store = openStore(client.runtime.dataDir);
  let runtime: Runtime;
  try {
    const services = await buildServices(client.runtime, { clock, window: { lastInboundAt: (phone) => store.lastInboundAt(phone) }, say: log, loadLive: options.loadLive });
    // The steps, the allowance and the outside switch (see buildUnderstanding). A model behind a Guard gets no provider key from here; with an `agentTokenFile` it
    // gets this agent's credential for that Guard; a provider reached directly gets the key its `keyEnv` names, from the environment, and nothing else.
    const understanding = buildUnderstanding(client, { clock, log });
    runtime = createRuntime({ settings: client.settings, store, clock, services, parser: options.parser ?? understanding.parser, ai: understanding.ai, pathwayVersion: pathwayVersion(), log });
  } catch (e) {
    store.close();
    throw e;
  }

  const before = runtime.status();
  if (client.runtime.mode === "fakes" && before.recordLength > 0) {
    log("Warning: this data folder remembers earlier bookings, but the stand-in services start empty every run, so they will disagree. For a local run, use a new data folder.");
  }
  let server: RunningServer;
  try {
    server = await startServer(runtime, { token, host: client.runtime.host, port: client.runtime.port, log });
  } catch (e) {
    await runtime.close();
    throw e;
  }
  runtime.kick(); // any task saved but not finished when the last process stopped runs now
  if (before.tasks.pending > 0) log(`Picking up ${before.tasks.pending} saved task(s) that had not finished.`);
  const ticker = startTicker(runtime, client.runtime.tickSeconds * 1000);

  return {
    client, runtime, server,
    async stop() {
      ticker.stop();
      await server.close();
      await runtime.close();
    },
  };
}
