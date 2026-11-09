// The whole local chain in one process: the stand-in services, the webhook inbox and a Fees runtime in LIVE mode whose live adapters call the stand-ins. A parent's message
// and a payment enter at the stand-ins, travel as signed webhooks to the inbox, are saved by the runtime, handled by the agent, and answered through the live adapters,
// which call the stand-ins back.
//
// In production a real Guard sits between the runtime and each service. Here the WhatsApp URL points straight at the stand-in, and the refunds go through a STUB Guard
// (modules/standins/guard.ts: Guard's documented refund behaviour, built from the same generated spec) so that a refund above the centre's limit is held, and the approvals
// relay (approvals/) runs beside it: it reads the held refunds, asks the owner on the stand-in WhatsApp with a code, and carries the owner's "approve <code>" to the stub
// Guard as a signed answer. The real Guard is not here (test/approvals-guard-binary.test.ts runs it).
//
// Nothing is written to the repository: the secrets (generated here) and a copy of the client folder, with the runtime's data, live in a temp folder that `stop()` removes.
// Used by test/full-chain.test.ts and by the command line (the end of this file):
//
//   node templates/education/fees/scripts/local-stack.ts [--client <folder>] [--free-ports] [--refund-limit <rupees>]        (npm run stack, inside templates/education/fees)
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startInbox } from "../../../../modules/inbox/server.ts";
import type { RunningInbox } from "../../../../modules/inbox/server.ts";
import { createGuardClient, createRuntimeClient } from "../../../../modules/approvals/clients.ts";
import { createRelay } from "../approvals/relay.ts";
import type { Relay } from "../../../../modules/approvals/relay.ts";
import { startRelayServer } from "../../../../modules/approvals/server.ts";
import type { RunningRelayServer } from "../../../../modules/approvals/server.ts";
import { openRelayStore } from "../../../../modules/approvals/store.ts";
import { createWhatsAppMessaging } from "../../../../modules/messaging/whatsapp.ts";
import { razorpayLimitsSpec } from "../src/guard-limits.ts";
import { parseSettings } from "../src/settings.ts";
import { startStubGuard } from "../../../../modules/standins/guard.ts";
import type { RunningStubGuard } from "../../../../modules/standins/guard.ts";
import { startClient } from "../server/start.ts";
import type { RunningClient } from "../server/start.ts";
import { startStandins } from "../standins/server.ts";
import type { RunningStandins } from "../standins/server.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import { systemClock } from "../../../../modules/core/clock.ts";
import type { Clock } from "../../../../modules/core/clock.ts";

const EXAMPLE_CLIENT = new URL("../clients/bright-tuition.example", import.meta.url).pathname;

/** The WhatsApp number the stand-ins answer for (their control routes sign webhooks as coming from it). */
export const PHONE_NUMBER_ID = "100000000000001";

export interface LocalStackOptions {
  /** A client folder to copy (default: the example). The copy lives in the temp folder; its runtime.json is rewritten for this stack. */
  clientFolder?: string;
  /** Shared by the stand-ins and the runtime. Default: the real clock. A test passes a fake one so "the due day" is the same every day. */
  clock?: Clock;
  /** Fixed ports; 0 (the default) picks a free one. The runtime keeps its port when it is stopped and started again. */
  ports?: { standins?: number; inbox?: number; runtime?: number; relay?: number };
  /** Instead of the client's own parser. */
  parser?: IntentParser;
  /** Change the copy's refund limit (whole rupees). Below a fee, a refund of a payment is held for the owner, which is how the approval is tried. */
  refundLimitInr?: number;
  /** How often the approvals relay reads the stub Guard, in milliseconds; 0 (the default) leaves it to the caller (`relay.poll()`), which a test wants. */
  relayPollMs?: number;
  /** One line from the inbox and the runtime, with no body, secret, number or message text in it. Default: nothing. */
  log?: (line: string) => void;
}

export interface LocalStack {
  /** The temp folder: `secrets/` and the client copy with its data. Removed by `stop()`. */
  dir: string;
  /** The client's own folder inside `dir`: stopping the runtime and starting it again continues on the same data. */
  clientFolder: string;
  standins: RunningStandins;
  inbox: RunningInbox;
  /** The stub Guard in front of the refunds, and the approvals relay (its own server, its own token) that reads it. */
  guard: RunningStubGuard;
  relay: Relay;
  relayServer: RunningRelayServer;
  /** The owner's number, from the client's settings. */
  owner: string;
  /** The running runtime, or undefined while it is stopped. */
  runtime: RunningClient | undefined;
  /** Stop the runtime like a crash that lets the step finish: the inbox then answers its providers 503 until `startRuntime`. */
  stopRuntime(): Promise<void>;
  /** Start the runtime on the same data folder and port (what a restart is). */
  startRuntime(): Promise<RunningClient>;
  /** Resolves when the runtime has handled everything it has saved. */
  settle(): Promise<void>;
  /** One pass of the approvals relay, then the runtime catches up. */
  pollRelay(): Promise<void>;
  /** Stop everything and remove the temp folder. */
  stop(): Promise<void>;
}

/** A port nobody is listening on right now. Only the runtime needs one in advance: the inbox has to know where to forward before the runtime exists. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address() as AddressInfo; probe.close(() => resolvePort(port)); });
  });
}

export async function startLocalStack(options: LocalStackOptions = {}): Promise<LocalStack> {
  const clock = options.clock ?? systemClock;
  const log = options.log ?? (() => undefined);
  const dir = mkdtempSync(join(tmpdir(), "geometer-fees-stack-"));
  const closers: (() => Promise<void>)[] = [];
  const stopAll = async () => {
    for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    // Secrets: fresh random values in files that only this temp folder holds. The inbox and the runtime read them as files, as they do in production.
    mkdirSync(join(dir, "secrets"), { mode: 0o700 });
    const files = { razorpay: "razorpay-webhook-secret", whatsapp: "whatsapp-app-secret", verify: "whatsapp-verify-token", token: "internal-token", agent: "guard-agent-token", read: "relay-read-token", notify: "owner-notify-secret", relay: "relay-token" };
    const path = (name: keyof typeof files) => join(dir, "secrets", files[name]);
    for (const name of Object.keys(files) as (keyof typeof files)[]) writeFileSync(path(name), `${randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
    const secret = (name: keyof typeof files) => readFileSync(path(name), "utf8").trim();
    const recordKeyFile = join(dir, "secrets", "record-key"); // B69: the runtime's key for what it writes in the record, as the deploy bundle gives it on a server
    writeFileSync(recordKeyFile, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });

    // A copy of the client, in live mode against the stand-ins. Its old data folder is left behind: this stack starts empty.
    const source = resolve(options.clientFolder ?? EXAMPLE_CLIENT);
    const clientFolder = join(dir, basename(source));
    cpSync(source, clientFolder, { recursive: true, filter: (from) => basename(from) !== "data" });
    if (options.refundLimitInr !== undefined) {
      const given = JSON.parse(readFileSync(join(clientFolder, "settings.json"), "utf8"));
      writeFileSync(join(clientFolder, "settings.json"), JSON.stringify({ ...given, refund: { limitInr: options.refundLimitInr } }, null, 2));
    }
    const settings = parseSettings(JSON.parse(readFileSync(join(clientFolder, "settings.json"), "utf8")));

    const runtimePort = options.ports?.runtime ? options.ports.runtime : await freePort();
    const relayPort = options.ports?.relay ? options.ports.relay : await freePort();
    // The inbox first (it only needs to know where the runtime will be), then the stand-ins (they deliver to the inbox), then the runtime (it calls the stand-ins).
    const inbox = await startInbox({
      runtimeUrl: `http://127.0.0.1:${runtimePort}`, internalToken: secret("token"), razorpayWebhookSecret: secret("razorpay"),
      whatsappAppSecret: secret("whatsapp"), whatsappVerifyToken: secret("verify"), log,
      // the owner's replies also go to the approvals relay, with the relay's own token
      relayUrl: `http://127.0.0.1:${relayPort}`, relayToken: secret("relay"), ownerWhatsapp: settings.owner.whatsapp,
    }, { port: options.ports?.inbox ?? 0 });
    closers.push(() => inbox.close());
    const standins = await startStandins({
      clock, inboxUrl: inbox.url, razorpayWebhookSecret: secret("razorpay"), whatsappAppSecret: secret("whatsapp"), phoneNumberId: PHONE_NUMBER_ID,
    }, { port: options.ports?.standins ?? 0 });
    closers.push(() => standins.close());
    const guard = await startStubGuard({
      clock, upstreamUrl: standins.url, spec: razorpayLimitsSpec(settings, { tenant: "local-stack", version: 1, reviewedBy: "local-stack" }),
      agentToken: secret("agent"), approver: { id: "owner-local", secret: secret("notify") }, readToken: secret("read"),
    });
    closers.push(() => guard.close());

    // the approvals relay: it holds the owner's secret and its own token; the runtime holds neither
    const store = openRelayStore(join(dir, "relay"));
    closers.push(async () => store.close());
    const relay = createRelay({
      clock, store, ownerWhatsapp: settings.owner.whatsapp, log,
      guard: createGuardClient({ adminUrl: guard.adminUrl, readToken: secret("read"), approverId: "owner-local", approverSecret: secret("notify"), now: () => clock.now() }),
      runtime: createRuntimeClient({ url: `http://127.0.0.1:${runtimePort}`, token: secret("token") }),
      // the relay's own way out to WhatsApp (in production a Guard of its own; here the stand-in), with the owner's window known from the owner's own messages
      messaging: createWhatsAppMessaging({ baseUrl: standins.url, phoneNumberId: PHONE_NUMBER_ID, timeoutMs: 3000 },
        { clock, window: { lastInboundAt: (phone) => (phone.replace(/\D/gu, "") === settings.owner.whatsapp.replace(/\D/gu, "") ? Number(store.getMeta("owner_last_inbound")) || undefined : undefined) } }),
    });
    closers.push(() => relay.stop());
    const relayServer = await startRelayServer(relay, { token: secret("relay"), port: relayPort });
    closers.push(() => relayServer.close());
    if (options.relayPollMs) relay.start(options.relayPollMs);

    const stack: LocalStack = {
      dir, clientFolder, standins, inbox, guard, relay, relayServer, owner: settings.owner.whatsapp, runtime: undefined,
      async stopRuntime() { const running = stack.runtime; stack.runtime = undefined; await running?.stop(); },
      async startRuntime() {
        let given: Record<string, unknown> = {};
        try { given = JSON.parse(readFileSync(join(clientFolder, "runtime.json"), "utf8")); } catch { /* no runtime.json: the client check says so below */ }
        const services = { payments: { baseUrl: guard.agentUrl, agentTokenFile: path("agent") }, messaging: { baseUrl: standins.url, phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 3000 };
        writeFileSync(join(clientFolder, "runtime.json"), JSON.stringify({ ...given, mode: "live", host: "127.0.0.1", port: runtimePort, dataDir: "data", services }, null, 2));
        stack.runtime = await startClient({ clientFolder, tokenFile: path("token"), recordKeyFile, clock, parser: options.parser, log });
        return stack.runtime;
      },
      settle: async () => { await stack.runtime?.runtime.idle(); },
      async pollRelay() { await relay.poll(); await stack.runtime?.runtime.idle(); await relay.poll(); await relay.idle(); },
      stop: async () => { await stack.stopRuntime(); await stopAll(); },
    };
    await stack.startRuntime();
    return stack;
  } catch (e) {
    await stopAll();
    throw e;
  }
}

// ---- the command line ---------------------------------------------------------------------------------------------------------

const DEFAULT_PORTS = { standins: 8790, inbox: 8788, runtime: 8780, relay: 8795 };

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node templates/education/fees/scripts/local-stack.ts [--client <folder>] [--free-ports] [--refund-limit <rupees>]\n  --client        a client folder to copy (default: the Bright Tuition Centre example)\n  --refund-limit  the refund limit in whole rupees; a refund above it is held for the owner, which is how to try an approval\n  --free-ports    pick free ports instead of 8780, 8788, 8790 and 8795");
    return;
  }
  const at = args.indexOf("--client");
  const known = ["--client", "--free-ports", "--refund-limit", "--help", "-h"];
  const limitAt = args.indexOf("--refund-limit");
  const refundLimitInr = limitAt === -1 ? undefined : Number(args[limitAt + 1]);
  if (args.some((a, i) => a.startsWith("-") && !known.includes(a)) || (at !== -1 && (args[at + 1] === undefined || args[at + 1].startsWith("--")))
    || (limitAt !== -1 && !(Number.isInteger(refundLimitInr) && (refundLimitInr as number) >= 0))) {
    console.error("I don't know that option. Use --client <folder>, --free-ports, --refund-limit <whole rupees> or --help.");
    process.exit(2);
  }

  let stack: LocalStack;
  try {
    stack = await startLocalStack({ clientFolder: at === -1 ? undefined : args[at + 1], ports: args.includes("--free-ports") ? {} : DEFAULT_PORTS, refundLimitInr, relayPollMs: 2000, log: (line) => console.log(`  ${line}`) });
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    console.error(error.code === "EADDRINUSE" ? `A port this stack needs is already in use (${error.message}). Stop what is using it, or run with --free-ports.` : error instanceof Error && error.constructor.name === "ClientError" ? error.message : `The stack could not start: ${error.stack ?? error}`);
    process.exit(1);
  }

  const { settings } = stack.runtime!.client;
  const standins = `localhost:${stack.standins.port}`;
  console.log(`Geometer · Fees · local stack for ${settings.name}. Stand-in services, test money, nothing real is contacted.`);
  console.log(`  Stand-ins (Razorpay and WhatsApp; control routes under /_standin/):  ${stack.standins.url}`);
  console.log(`  Inbox (checks each signed webhook, hands it on):                     ${stack.inbox.url}`);
  console.log(`  Agent runtime (live mode, its adapters call the stand-ins):          ${stack.runtime!.server.url}`);
  console.log(`  Stub Guard (the refunds go through it; a refund above the limit is held):  ${stack.guard.agentUrl}`);
  console.log(`  Approvals relay (reads the held refunds, asks the owner, carries the answer): ${stack.relayServer.url}`);
  console.log(`  Secrets and data: ${stack.dir} (removed when you stop)`);
  console.log("The agent opens a month's fees on its first reminder day (3 days before the due day in the example), so with the real clock nothing happens until then. To see a month, run the");
  console.log("end-to-end test (test/full-chain.test.ts), which moves a fake clock, or walk it by hand:");
  console.log(`  curl -s -X POST ${standins}/_standin/whatsapp/inbound -d '{"from":"${settings.students[0].parent}","text":"I already paid"}'   # a parent writes`);
  console.log(`  curl -s -X POST ${standins}/_standin/razorpay/pay -d '{"link_id":"plink_1"}'   # they pay a fee link (the first link is plink_1; later ones are in the state)`);
  console.log(`  curl -s ${standins}/_standin/state   # what the stand-ins hold: the outbox, the links, the payments`);
  console.log(`To see an approval, start with --refund-limit ${Math.max(0, Math.min(...settings.batches.map((b) => b.monthlyFeeInr)) - 1)} (below the cheapest fee), let a parent pay, and write "refund" as that parent.`);
  console.log(`  The refund is held; within a couple of seconds the owner (${settings.owner.whatsapp}) is asked, with a code, in the state's outbox. Then:`);
  console.log(`  curl -s -X POST ${standins}/_standin/whatsapp/inbound -d '{"from":"${settings.owner.whatsapp}","text":"approve <the code>"}'   # the owner answers; the refund is made once`);
  console.log("Press Ctrl+C to stop.");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => { void stack.stop().then(() => process.exit(0), (e: Error) => { console.error(e.message); process.exit(1); }); });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
