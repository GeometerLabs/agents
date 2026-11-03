// Start one client's agent: read its folder, open its store, wire the services, resume what was left pending, listen, and keep
// the clock ticking. main.ts is a thin command line around this; the tests start it directly.
import { readFileSync } from "node:fs";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import { systemClock } from "../src/clock.ts";
import type { Clock } from "../src/clock.ts";
import { ClientError, loadClient, pathwayVersion } from "./config.ts";
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
    const services = await buildServices(client.runtime, { clock, window: store, say: log, loadLive: options.loadLive });
    runtime = createRuntime({ settings: client.settings, store, clock, services, parser: options.parser ?? createRuleParser(), pathwayVersion: pathwayVersion(), log });
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
