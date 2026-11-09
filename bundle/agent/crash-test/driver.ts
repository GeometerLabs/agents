// How the crash test drives an agent someone else wrote (the "driver contract"; the README says it in a page). The agent is started as a program, on its own port, with the addresses of
// the three Guards and the one credential in its environment; the crash test then plays the customer (signed WhatsApp webhooks to the agent) and the provider (signed Razorpay webhooks),
// and makes things go wrong at the stand-in services behind the Guards. Nothing here asks the agent what it did.
//
// What the agent has to be: a program that listens on PORT and takes
//   POST <driver.whatsappPath>  default /webhooks/whatsapp   Meta's webhook, signed with the app secret in X-Hub-Signature-256
//   POST <driver.razorpayPath>  default /webhooks/razorpay   Razorpay's webhook, signed with the webhook secret in X-Razorpay-Signature, with the event id in X-Razorpay-Event-Id
// and answers 2xx once it has taken the event. Its calls to the services go to the addresses in its environment, as B51 already asks of it.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { isAbsolute, join } from "node:path";
import type { AgentFile, AgentDriver } from "../folder.ts";

/** The words the scripted customer writes, unless agent.json says otherwise. `{offer}` and `{claim}` are filled in with amounts that appear on no price list. */
export const DEFAULT_SAYS = {
  book: ["I want to book"],
  cancel: "Please cancel my booking",
  haggle: "Can you do it for ₹{offer}?",
  refundMore: "Cancel my booking and refund my ₹{claim}",
} as const;

export const DEFAULT_BOOKED_WORDS = "\\b(booked|confirmed)\\b";

export interface ResolvedDriver {
  whatsappPath: string;
  razorpayPath: string;
  says: { book: string[]; cancel: string; haggle: string; refundMore: string };
  /** Which of the lines the builder wrote themselves (the rest are the defaults), for the output. */
  own: { book: boolean; cancel: boolean; haggle: boolean; refundMore: boolean };
  bookedWords: RegExp;
  startMs: number;
  situationMs: number;
  cwd?: string;
}

export function resolveDriver(driver: AgentDriver | undefined): ResolvedDriver {
  const says = driver?.says ?? {};
  return {
    whatsappPath: driver?.whatsappPath ?? "/webhooks/whatsapp",
    razorpayPath: driver?.razorpayPath ?? "/webhooks/razorpay",
    says: {
      book: says.book === undefined ? [...DEFAULT_SAYS.book] : Array.isArray(says.book) ? says.book : [says.book],
      cancel: says.cancel ?? DEFAULT_SAYS.cancel, haggle: says.haggle ?? DEFAULT_SAYS.haggle, refundMore: says.refundMore ?? DEFAULT_SAYS.refundMore,
    },
    own: { book: says.book !== undefined, cancel: says.cancel !== undefined, haggle: says.haggle !== undefined, refundMore: says.refundMore !== undefined },
    bookedWords: new RegExp(driver?.bookedWords ?? DEFAULT_BOOKED_WORDS, "iu"),
    startMs: (driver?.startSeconds ?? 20) * 1000,
    situationMs: (driver?.situationSeconds ?? 40) * 1000,
    ...(driver?.cwd !== undefined ? { cwd: driver.cwd } : {}),
  };
}

/** The agent cannot be driven this way. It is not a failure of the agent: the situation is named as not run, with this reason. */
export class NotDrivable extends Error {}

/** The agent did not start, or stopped. This one is a result: the output it left is shown. */
export class AgentDidNotStart extends Error {}

/** The run command, with `{version}` filled in. */
export const commandFor = (agent: AgentFile, version: string | undefined, override?: string): string | undefined => {
  const command = override ?? agent.run;
  return command === undefined ? undefined : command.replaceAll("{version}", version ?? agent.version ?? "");
};

/** Where the run command starts. */
export const workingFolder = (agentFolder: string, driver: ResolvedDriver): string => (driver.cwd === undefined ? agentFolder : isAbsolute(driver.cwd) ? driver.cwd : join(agentFolder, driver.cwd));

export interface ContractEnv {
  port: number;
  /** The Guards' addresses for the services the agent uses; a service it does not use has no entry. */
  razorpay?: string;
  /** The owner-marked desk (UPI, B71), when the agent takes money that way: it has no Guard, because UPI has no API. */
  upi?: string;
  calendar?: string;
  whatsapp?: string;
  credential: string;
  calendarId?: string;
  phoneNumberId?: string;
  whatsappAppSecret: string;
  razorpayWebhookSecret: string;
  depositInr: number;
  priceInr: number;
  ownerWhatsapp: string;
  version?: string;
  /** How long the agent should wait between two sends of a refund Guard is holding: short here, minutes in life. */
  retryMs: number;
}

/**
 * The environment the agent is started with. The names are the ones examples/own-agent/agent.js reads; a run command can copy them into the names the agent reads
 * (`RAZORPAY_BASE_URL=$GEOMETER_RAZORPAY_URL node app.js`), since it is run by `sh -c`.
 */
export function contractEnv(c: ContractEnv): Record<string, string> {
  const env: Record<string, string | undefined> = {
    PORT: String(c.port), GEOMETER_PORT: String(c.port),
    GEOMETER_RAZORPAY_URL: c.razorpay, GEOMETER_UPI_URL: c.upi, GEOMETER_CALENDAR_URL: c.calendar, GEOMETER_WHATSAPP_URL: c.whatsapp, GEOMETER_CREDENTIAL: c.credential,
    CALENDAR_ID: c.calendarId, PHONE_NUMBER_ID: c.phoneNumberId,
    GEOMETER_WHATSAPP_APP_SECRET: c.whatsappAppSecret, GEOMETER_RAZORPAY_WEBHOOK_SECRET: c.razorpayWebhookSecret,
    GEOMETER_DEPOSIT_INR: String(c.depositInr), GEOMETER_PRICE_INR: String(c.priceInr), GEOMETER_OWNER_WHATSAPP: c.ownerWhatsapp,
    GEOMETER_AGENT_VERSION: c.version, GEOMETER_RETRY_MS: String(c.retryMs), GEOMETER_CRASH_TEST: "1",
  };
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
}

export interface AgentProcess {
  url: string;
  alive(): boolean;
  /** The last lines the agent printed (standard output and error), for when it did not start or stopped. */
  output(): string;
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// An agent runs in a process group of its own, so Ctrl-C at the terminal does not reach it. If the crash test itself ends (Ctrl-C, a kill, a crash of its own), every agent still running
// is ended with it, so none is left holding a port.
const running = new Set<number>();
let hooked = false;
function endWithMe(pid: number): void {
  running.add(pid);
  if (hooked) return;
  hooked = true;
  process.on("exit", () => { for (const group of running) { try { process.kill(-group, "SIGKILL"); } catch { /* already gone */ } } });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => process.exit(130));
}

/**
 * Start the agent: `sh -c <command>` in its own process group, so that stopping it stops everything the command started. Resolves when the port answers (any HTTP answer will do;
 * a 404 is an answer). Rejects, with what the agent printed, when it ends first or does not answer in time.
 */
export async function startAgent(o: { command: string; cwd: string; env: Record<string, string>; port: number; startMs: number }): Promise<AgentProcess> {
  const child: ChildProcess = spawn("sh", ["-c", o.command], { cwd: o.cwd, env: { ...process.env, ...o.env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  if (child.pid !== undefined) { endWithMe(child.pid); child.once("exit", () => running.delete(child.pid!)); }
  let printed = "";
  const keep = (c: Buffer) => { printed = (printed + c.toString("utf8")).slice(-4000); };
  child.stdout!.on("data", keep); child.stderr!.on("data", keep);
  let spawnError = "";
  child.on("error", (e) => { spawnError = e.message; });
  // a program that was ended by a signal has an exit code of null and a signal code: both mean it is gone
  const ended = () => child.exitCode !== null || child.signalCode !== null;
  const tail = () => printed.split("\n").map((l) => l.trim()).filter(Boolean).slice(-6).join(" | ").slice(0, 600);
  const stop = async () => {
    if (child.pid === undefined || ended()) return;
    const group = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch { /* already gone */ } };
    group("SIGTERM");
    for (let i = 0; i < 20 && !ended(); i++) await sleep(100);
    if (!ended()) group("SIGKILL");
    // the shell may be gone while something it started is not: the whole group is told to end either way
    group("SIGKILL");
    running.delete(child.pid);
  };
  const url = `http://127.0.0.1:${o.port}`;
  const started = Date.now();
  for (;;) {
    if (spawnError) { await stop(); throw new AgentDidNotStart(`the run command could not be started (${spawnError})`); }
    if (ended()) throw new AgentDidNotStart(`the agent stopped by itself with exit code ${child.exitCode} before it answered${tail() ? `. It printed: ${tail()}` : ""}`);
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }).then((r) => r.arrayBuffer()); break; } catch { /* not listening yet */ }
    if (Date.now() - started > o.startMs) { await stop(); throw new AgentDidNotStart(`the agent did not answer on port ${o.port} in ${Math.round(o.startMs / 1000)} seconds${tail() ? `. It printed: ${tail()}` : ""}`); }
    await sleep(100);
  }
  return { url, alive: () => !ended(), output: tail, stop };
}
