// The whole local chain in one process: the stand-in services, the webhook inbox and a runtime in LIVE mode whose live adapters call the
// stand-ins. Customer messages and payments enter at the stand-ins, travel as signed webhooks to the inbox, are saved by the runtime, handled
// by the agent, and answered through the live adapters, which call the stand-ins back. In production Guard sits between the runtime and each
// service; here the base URLs point straight at the stand-ins, which is the only difference.
//
// Nothing is written to the repository: the secrets (generated here) and a copy of the client folder, with the runtime's data, live in a
// temp folder that `stop()` removes. Used by test/full-chain.test.ts and by the command line (below).
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { startInbox } from "../inbox/server.ts";
import type { RunningInbox } from "../inbox/server.ts";
import { startClient } from "../server/start.ts";
import type { RunningClient } from "../server/start.ts";
import { startStandins } from "../standins/server.ts";
import type { RunningStandins } from "../standins/server.ts";
import type { IntentParser } from "../src/adapters/model.ts";
import { systemClock } from "../src/clock.ts";
import type { Clock } from "../src/clock.ts";

const EXAMPLE_CLIENT = new URL("../clients/glow-salon.example", import.meta.url).pathname;

/** The WhatsApp number the stand-ins answer for (their control routes sign webhooks as coming from it). */
export const PHONE_NUMBER_ID = "100000000000001";

export interface LocalStackOptions {
  /** A client folder to copy (default: the example). The copy lives in the temp folder; its runtime.json is rewritten for this stack. */
  clientFolder?: string;
  /** Shared by the stand-ins and the runtime. Default: the real clock. A test passes a fake one so "tomorrow" is the same every day. */
  clock?: Clock;
  /** Fixed ports; 0 (the default) picks a free one. The runtime keeps its port when it is stopped and started again. */
  ports?: { standins?: number; inbox?: number; runtime?: number };
  /** Instead of the client's own parser. */
  parser?: IntentParser;
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
  /** The running runtime, or undefined while it is stopped. */
  runtime: RunningClient | undefined;
  /** Stop the runtime like a crash that lets the step finish: the inbox then answers its providers 503 until `startRuntime`. */
  stopRuntime(): Promise<void>;
  /** Start the runtime on the same data folder and port (what a restart is). */
  startRuntime(): Promise<RunningClient>;
  /** Resolves when the runtime has handled everything it has saved. */
  settle(): Promise<void>;
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
  const dir = mkdtempSync(join(tmpdir(), "geometer-stack-"));
  const closers: (() => Promise<void>)[] = [];
  const stopAll = async () => {
    for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    // Secrets: fresh random values in files that only this temp folder holds. The inbox and the runtime read them as files, as they do in production.
    mkdirSync(join(dir, "secrets"), { mode: 0o700 });
    const files = { razorpay: "razorpay-webhook-secret", whatsapp: "whatsapp-app-secret", verify: "whatsapp-verify-token", token: "internal-token" };
    const path = (name: keyof typeof files) => join(dir, "secrets", files[name]);
    for (const name of Object.keys(files) as (keyof typeof files)[]) writeFileSync(path(name), `${randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
    const secret = (name: keyof typeof files) => readFileSync(path(name), "utf8").trim();

    // A copy of the client, in live mode against the stand-ins. Its old data folder is left behind: this stack starts empty.
    const source = resolve(options.clientFolder ?? EXAMPLE_CLIENT);
    const clientFolder = join(dir, basename(source));
    cpSync(source, clientFolder, { recursive: true, filter: (from) => basename(from) !== "data" });

    const runtimePort = options.ports?.runtime ? options.ports.runtime : await freePort();
    // The inbox first (it only needs to know where the runtime will be), then the stand-ins (they deliver to the inbox), then the runtime (it calls the stand-ins).
    const inbox = await startInbox({
      runtimeUrl: `http://127.0.0.1:${runtimePort}`, internalToken: secret("token"), razorpayWebhookSecret: secret("razorpay"),
      whatsappAppSecret: secret("whatsapp"), whatsappVerifyToken: secret("verify"), log,
    }, { port: options.ports?.inbox ?? 0 });
    closers.push(() => inbox.close());
    const standins = await startStandins({
      clock, inboxUrl: inbox.url, razorpayWebhookSecret: secret("razorpay"), whatsappAppSecret: secret("whatsapp"), phoneNumberId: PHONE_NUMBER_ID,
    }, { port: options.ports?.standins ?? 0 });
    closers.push(() => standins.close());

    const stack: LocalStack = {
      dir, clientFolder, standins, inbox, runtime: undefined,
      async stopRuntime() { const running = stack.runtime; stack.runtime = undefined; await running?.stop(); },
      async startRuntime() {
        let given: Record<string, unknown> = {};
        try { given = JSON.parse(readFileSync(join(clientFolder, "runtime.json"), "utf8")); } catch { /* no runtime.json: the client check says so below */ }
        const services = {
          payments: { baseUrl: standins.url }, calendar: { baseUrl: standins.url, calendarId: "shop@example.com" },
          messaging: { baseUrl: standins.url, phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 3000,
        };
        writeFileSync(join(clientFolder, "runtime.json"), JSON.stringify({ ...given, mode: "live", host: "127.0.0.1", port: runtimePort, dataDir: "data", services }, null, 2));
        stack.runtime = await startClient({ clientFolder, tokenFile: path("token"), clock, parser: options.parser, log });
        return stack.runtime;
      },
      settle: async () => { await stack.runtime?.runtime.idle(); },
      stop: async () => { await stack.stopRuntime(); await stopAll(); },
    };
    await stack.startRuntime();
    return stack;
  } catch (e) {
    await stopAll();
    throw e;
  }
}
