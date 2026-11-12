// Start one client's agent: read its folder, open its store, wire the services, resume what was left pending, listen, and keep the clock ticking. The same for every
// template; what a template gives is `hooks`: how to read its folder, and how to build its runtime from the store. main.ts is a thin command line around this; the tests
// start it directly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER_LINK_FILE, ownerLinkReader } from "../channels/owner-link.ts";
import { systemClock } from "../core/clock.ts";
import type { Clock } from "../core/clock.ts";
import { loadPrivateKey } from "../report/sign.ts";
import { parseKey } from "../record/key-file.ts";
import type { IntentBase, ParseOptionsBase } from "../understanding/model.ts";
import type { ModelConfig, ModelParser } from "../understanding/model-llm.ts";
import type { AiPolicy } from "../understanding/ai-state.ts";
import { systemOneFromEnv } from "../understanding/system-one.ts";
import { RATES, dayOf, selfHostedRate } from "../understanding/rates.ts";
import type { DecisionStep, ModelStep, RouterOptions } from "../understanding/router.ts";
import { ClientError, aiOverrideReader, modelSwitchReader, reportOptionsReader } from "./config.ts";
import type { ClientFolder } from "./config.ts";
import type { Runtime } from "./core.ts";
import { startServer } from "./http.ts";
import type { RunningServer } from "./http.ts";
import { openStore } from "./store.ts";
import type { DurableStore } from "./store.ts";
import { startTicker } from "./ticker.ts";

export interface StartOptions<Services = unknown> {
  clientFolder: string;
  /** A file holding the internal bearer token (INTERNAL_TOKEN_FILE). */
  tokenFile: string | undefined;
  /** A file holding the record's key (RECORD_KEY_FILE, B69), or the environment's; needed in live mode (see `readRecordKey`). */
  recordKeyFile?: string;
  /** A file holding the channel token (CHANNEL_TOKEN_FILE), or the environment's: the shop's booking page, API and owner page (modules/channels). Left out: none. */
  channelTokenFile?: string;
  clock?: Clock;
  log?: (line: string) => void;
  /** A test seam: how the live adapters are loaded. */
  loadLive?: () => Promise<Services>;
}

export interface RunningClient<Settings = unknown, Rt = Runtime> {
  client: ClientFolder<Settings>;
  runtime: Rt;
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
  const { agentTokenFile, provider: _provider, keyEnv, rate: _rate, ...model } = config; // provider and rate are for pricing (the router), not for the call
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

/** What a template gives to read messages: its rule parser, and its reading given to the two model steps (modules/understanding). */
export interface UnderstandingHooks<Parser, Intent extends IntentBase = IntentBase, Context = unknown, Options extends ParseOptionsBase = ParseOptionsBase> {
  createRuleParser(): Parser;
  createModelParser(config: ModelConfig, fetchFn?: typeof fetch): ModelParser<Intent, Context>;
  createRouter(options: Omit<RouterOptions<Intent, Context, Options>, "reading">): Parser;
}

/**
 * How this client reads messages and what it may spend: the three steps from runtime.json (rules always; a System One decision model if `decision` is set; a small
 * language model if `parser` is set), and the monthly allowance, the outside switch and the AI cap. A step whose key is named but not in the environment is OFF, with
 * a line saying so: nothing is ever sent to a paid service without its key. With neither step, the rule parser reads everything, as before.
 */
export function buildUnderstanding<Parser, Intent extends IntentBase, Context, Options extends ParseOptionsBase>(client: Pick<ClientFolder, "folder" | "runtime">, deps: { clock: Clock; env?: Record<string, string | undefined>; log: (line: string) => void }, hooks: UnderstandingHooks<Parser, Intent, Context, Options>): { parser: Parser; ai: AiPolicy } {
  const env = deps.env ?? process.env;
  const rt = client.runtime;
  let decision: DecisionStep | undefined;
  let model: ModelStep<any, Context> | undefined;
  if (rt.decision) {
    const d = rt.decision;
    const step = systemOneFromEnv({ baseUrl: d.baseUrl, model: d.model, kind: d.provider, keyEnv: d.keyEnv, ...(d.timeoutMs !== undefined ? { timeoutMs: d.timeoutMs } : {}) }, env);
    if (step) decision = { client: step, ...(d.threshold !== undefined ? { threshold: d.threshold } : {}), ...(d.languages ? { languages: d.languages } : {}) };
    else deps.log(`Step 1 (the decision model) is off: ${d.keyEnv} is not set, so nothing is sent to ${d.provider}.`);
  }
  if (rt.parser) {
    if (rt.parser.keyEnv && !env[rt.parser.keyEnv]?.trim()) deps.log(`Step 2 (the language model) is off: ${rt.parser.keyEnv} is not set, so nothing is sent to ${rt.parser.provider ?? new URL(rt.parser.baseUrl).hostname}.`);
    else model = { parser: hooks.createModelParser(...parserArguments(rt.parser, env)), provider: rt.parser.provider ?? new URL(rt.parser.baseUrl).hostname, model: rt.parser.model };
  }
  // B73: a model the builder hosts is priced at the builder's own rate (runtime.json parser.rate), added as one more line of the router's table for this runtime only.
  // Without it the router uses the shared table, which has no line for a self-hosted model, so those calls are counted as unpriced (unknown, never 0).
  const rates = rt.parser?.rate && model ? [...RATES, selfHostedRate(rt.parser.model, rt.parser.rate, dayOf(deps.clock.now()))] : undefined;
  const parser = decision || model ? hooks.createRouter({ decision, model, now: () => deps.clock.now(), ...(rates ? { rates } : {}) }) : hooks.createRuleParser();
  const ai: AiPolicy = {
    override: aiOverrideReader(client.folder, rt.ai === "buttons" ? "buttons" : "auto"),
    model: modelSwitchReader(client.folder, rt.model === "off" ? "off" : "normal"),
    ...(rt.allowance ? { allowance: { ...(rt.allowance.messages !== undefined ? { messages: rt.allowance.messages } : {}), ...(rt.allowance.costInr !== undefined ? { costMicroInr: Math.round(rt.allowance.costInr * 1_000_000) } : {}) } } : {}),
    ...(rt.pauseMinutes !== undefined ? { pauseMinutes: rt.pauseMinutes } : {}),
  };
  return { parser, ai };
}

/** What the monthly report job needs from runtime.json's `report` block (the template's own job takes exactly this). */
export interface MonthlyReportSetupBase<GoLive> {
  source: "stand-in" | "test-mode" | "live";
  pages: { dir: string; baseUrl: string };
  options: () => { preparedBy: string; innovator: boolean };
  key?: ReturnType<typeof loadPrivateKey>;
  goLive?: () => GoLive;
  /** report.tenant: the ledger tenant the report is anchored under. */
  tenant?: string;
}

/**
 * The monthly report to the owner, from the `report` block of runtime.json. Without the block there is none, and nothing is sent. The signing key and the go-live
 * certificate are read here, so a path that cannot be read stops the start with a plain sentence rather than failing on the 1st of the month. `readGoLive` is the
 * template's own reading of a go-live certificate file for this centre's or shop's settings.
 */
export function monthlyReportSetup<Settings, GoLive>(client: Pick<ClientFolder<Settings>, "folder" | "runtime" | "settings">, log: (line: string) => void, readGoLive?: (file: string | undefined, settings: Settings) => { finding: GoLive }): MonthlyReportSetupBase<GoLive> | undefined {
  const r = client.runtime.report;
  if (!r) return undefined;
  let key: MonthlyReportSetupBase<GoLive>["key"];
  if (r.signingKeyFile) {
    try { key = loadPrivateKey(r.signingKeyFile); } catch (e) { throw new ClientError(`I could not use the report signing key ${r.signingKeyFile} (report.signingKeyFile): ${(e as Error).message}`); }
  }
  const source = r.source ?? (client.runtime.mode === "fakes" ? "stand-in" : "test-mode");
  if (!key) log("The monthly report will not be signed (no report.signingKeyFile): it carries a digest and a code, but nothing shows who issued it.");
  return {
    source, pages: { dir: r.pagesDir, baseUrl: r.pageBaseUrl }, options: reportOptionsReader(client.folder, { preparedBy: r.preparedBy, innovator: r.innovator }),
    ...(key ? { key } : {}), ...(r.goLiveFile && readGoLive ? { goLive: () => readGoLive(r.goLiveFile, client.settings).finding } : {}),
    ...(r.tenant ? { tenant: r.tenant } : {}),
  };
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

/**
 * The channel token (modules/channels): what the public front presents to reach this runtime's channel routes, and nothing else. Optional: without the file the shop has
 * no booking page. It is never the inbox's token, so the front cannot send a WhatsApp message or a payment event, and the inbox cannot book from the page.
 */
export function readChannelToken(file: string | undefined): string | undefined {
  if (!file) return undefined;
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { throw new ClientError(`I could not read the channel token file ${file} (CHANNEL_TOKEN_FILE).`); }
  const token = text.trim();
  if (token.length < MIN_TOKEN_LENGTH) throw new ClientError(`The channel token in ${file} is too short to be safe (${token.length} characters; at least ${MIN_TOKEN_LENGTH}). Make a new one with: openssl rand -hex 32`);
  return token;
}

/**
 * The record's key (B69, a key derived from the shop's own): in live mode it is required, because a live record must not write a customer's words as a plain digest that can be tested by
 * guessing, or a WhatsApp message id that can carry the number. The deployer writes the file and names it in RECORD_KEY_FILE. A local run with stand-in services needs none.
 */
export function readRecordKey(mode: "fakes" | "live", file: string | undefined): Buffer | undefined {
  if (!file) {
    if (mode === "live") throw new ClientError("Set RECORD_KEY_FILE to a file that holds the record's key: 64 hex digits, made once and kept with the shop's backups (for example: openssl rand -hex 32 > record.key). The deploy bundle makes and names it.");
    return undefined;
  }
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { throw new ClientError(`I could not read the record's key file ${file} (RECORD_KEY_FILE).`); }
  try { return parseKey(text, `The record's key in ${file}`); } catch (e) { throw new ClientError((e as Error).message); }
}

/** What a template gives the start: how to read its client folder, and how to build its runtime from the opened store. */
export interface StartHooks<Settings, Rt extends StartableRuntime> {
  /** What this template calls its cases, for the one warning that names them: "bookings", "fees". */
  casesName: string;
  loadClient(folder: string): ClientFolder<Settings>;
  build(client: ClientFolder<Settings>, ctx: { store: DurableStore; clock: Clock; log: (line: string) => void; recordKey?: Buffer }): Promise<Rt>;
}

/** The part of a runtime the start uses. */
export type StartableRuntime = Pick<Runtime, "kick" | "close" | "tick" | "submit" | "status" | "refundContext" | "ready" | "idle">;

// The single start sequence every template shares, so recovery of pending work and the order of wiring cannot differ between Bookings and Fees.
export async function startRuntimeClient<Settings, Rt extends StartableRuntime>(options: StartOptions, hooks: StartHooks<Settings, Rt>): Promise<RunningClient<Settings, Rt>> {
  const log = options.log ?? ((line: string) => console.log(line));
  const clock = options.clock ?? systemClock;
  const client = hooks.loadClient(options.clientFolder); // refuses a wrong pathway version before anything is opened
  const token = readToken(options.tokenFile);
  const channelToken = readChannelToken(options.channelTokenFile ?? process.env.CHANNEL_TOKEN_FILE);
  const recordKey = readRecordKey(client.runtime.mode, options.recordKeyFile ?? process.env.RECORD_KEY_FILE);

  const store = openStore(client.runtime.dataDir);
  let runtime: Rt;
  try {
    runtime = await hooks.build(client, { store, clock, log, ...(recordKey ? { recordKey } : {}) });
  } catch (e) {
    store.close();
    throw e;
  }

  const before = runtime.status() as { recordLength: number; tasks: { pending: number } };
  if (client.runtime.mode === "fakes" && before.recordLength > 0) {
    log(`Warning: this data folder remembers earlier ${hooks.casesName}, but the stand-in services start empty every run, so they will disagree. For a local run, use a new data folder.`);
  }
  let server: RunningServer;
  try {
    // the owner's link is read from the client folder on every request (the deployer writes and removes it), so a revoked link stops without a restart
    server = await startServer(runtime, { token, host: client.runtime.host, port: client.runtime.port, log, ...(channelToken ? { channelToken, ownerLink: ownerLinkReader(join(client.folder, OWNER_LINK_FILE)) } : {}) });
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
