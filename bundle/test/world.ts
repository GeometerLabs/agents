// A fake machine for the deployer's tests: a Runner that answers `docker` the way a healthy server would, a Guard tool that "compiles" and "verifies" without
// Docker, and a clock that does not wait. Every call is recorded so a test can say what was started and what was not.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../deploy.ts";
import type { GuardTool, TripwireResult } from "../generate/verify.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { REPORT_KEY_JOB } from "../lib/report-key.ts";
import type { RunResult } from "../lib/runner.ts";
import { prepareSecretsRoot, secretFile, writeSecretFile } from "../lib/secrets.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, panelRuntime, tempServer } from "./helpers.ts";
import { TEST_PUBLIC_HEX } from "./licence-helpers.ts";
import { kidOf } from "../../modules/licence/token.ts";

/** The kid of RFC 8032's published test key: what the test image has built in. */
const TEST_KID = kidOf(Buffer.from(TEST_PUBLIC_HEX, "hex"));

export const GOOD: TripwireResult = { ok: true, passed: 4, of: 4, notSelfTestable: ["rule refund-once: whether a repeat is stopped depends on the intent ledger"], failedRules: [], text: "" };

export interface World {
  ctx: Context;
  root: string;
  paths: ReturnType<typeof tempServer>["paths"];
  calls: { command: string; args: string[] }[];
  /** Admin calls the fake ops container was asked for, as `service METHOD path`. */
  admin: string[];
  /** The JSON body of each admin call that had one, as `service METHOD path body` (a rotation's retire call says when the old credential stops). */
  adminBodies: string[];
  /** What an admin call answers, by `service METHOD path` (the path as asked, query included). Left out: 200 with an empty body (or the Guard's status, for /admin/status). */
  adminAnswers: Map<string, { status: number; body: unknown }>;
  /** Make verify-bundle fail for a service, naming rules. */
  failVerify(service: string, rules: string[]): void;
  /** Make the "running" Guard report another policy than the one compiled. */
  runningDigest: Map<string, string>;
  handIn(shop: string, files?: Record<string, string>): void;
  /** What `ops observe` answers (the runtime and Guard statuses the deployer's status refresh reads). */
  observe: { shops: unknown[] };
  /** Make `ops stop` answer these Guard statuses (default: all 200). */
  stopStatuses: number[];
  /** What a shop's runtime answers to `ops recover` (default 200); 0 is "could not be reached". */
  recover: { status: number };
  /**
   * The licence (B13, decision 39): whether the fake Guard image reads `[licence]`, and the key ids the "running" Guards report as built in. The default is the test
   * image's: it reads the block and has RFC 8032's published test key, the one tempServer pins. A Guard whose guard.toml had the block reports it in /admin/status,
   * as the real one does.
   */
  guardLicence: { reads: boolean; kids: string[] };
  /** The guard.toml each service was last verified with. */
  tomls: Map<string, string>;
  done(): void;
}

const digestOf = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

export function secretsFor(shop: string): Record<string, string> {
  return { razorpay_key: "rzp_test_abcdefghij:supersecretvalue123", whatsapp_token: "EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", razorpay_webhook_secret: "webhook-secret-0123456789", whatsapp_app_secret: "meta-app-secret-0123456789", whatsapp_verify_token: "verify-token-0123456789", "google_service_account.json": JSON.stringify({ client_email: `${shop}@x.iam.gserviceaccount.com`, private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", token_uri: "https://oauth2.googleapis.com/token" }) };
}

export function world(shops: Record<string, ReturnType<typeof panelRuntime> | null> = { "glow-salon": panelRuntime() }, serverChange: Record<string, unknown> = {}): World {
  const t = tempServer(shops, serverChange);
  prepareSecretsRoot(t.root);
  writeSecretFile(secretFile(t.root, "g-model", serverChange.model && (serverChange.model as { wire: string }).wire === "anthropic" ? "model_api_key" : "model_authorization"), "Bearer sk-test-model-key-0123456789");
  const calls: { command: string; args: string[] }[] = [];
  const admin: string[] = [];
  const adminBodies: string[] = [];
  const adminAnswers = new Map<string, { status: number; body: unknown }>();
  const observe: { shops: unknown[] } = { shops: [] };
  const stopStatuses: number[] = [200, 200, 200, 200];
  const recover = { status: 200 };
  const failing = new Map<string, string[]>();
  const runningDigest = new Map<string, string>();
  const digestByName = new Map<string, string>();
  const guardLicence = { reads: true, kids: [TEST_KID] as string[] };
  const tomls = new Map<string, string>();
  const serviceOf = (toml: string) => { const name = /^deployment = "([^"]+)"/mu.exec(toml)?.[1] ?? ""; return name === "" ? "" : toml.includes('tool = "model"') ? "g-model" : `g-${name}`; };
  const tool: GuardTool = {
    readsLicence: async () => guardLicence.reads,
    async compile(specText) {
      const spec = JSON.parse(specText) as { tool: string; tenant: string; name: string; version: number };
      const digest = digestOf(specText);
      digestByName.set(spec.name, digest);
      return { ok: true, result: { digest, tool: spec.tool, tenant: spec.tenant, version: spec.version, text: JSON.stringify({ compiled: spec }) } };
    },
    async verify(_bundle, toml) {
      const service = serviceOf(toml);
      tomls.set(service, toml);
      const rules = failing.get(service);
      return rules ? { ok: false, passed: 0, of: 4, notSelfTestable: [], failedRules: rules, text: "tripwire failed" } : GOOD;
    },
  };
  const runner = fakeRunner((command, args, options): RunResult => {
    calls.push({ command, args });
    const joined = args.join(" ");
    // the deployer's short-lived copy of the paper key for a shop runtime (lib/report-key.ts): do what the container does, as far as a test can (the file is the test
    // user's, not uid 1000's), and answer as the container would on a real server
    if (args[0] === "run" && args.includes(REPORT_KEY_JOB)) {
      const out = args[args.indexOf("-v") + 1].replace(/:\/out$/u, "");
      const name = args[args.indexOf("-e") + 2];
      writeFileSync(join(out, name), options.input ?? "", { mode: 0o600 });
      return ok(JSON.stringify({ sha256: createHash("sha256").update(options.input ?? "").digest("hex"), uid: 1000, gid: 1000, mode: 0o600 }));
    }
    if (args[0] === "image") return ok("sha256:imageid");
    if (args[0] === "compose" && joined.includes("exec -T ops")) {
      const i = args.findIndex((a) => a.endsWith("/ops.ts"));
      const [verb, ...rest] = args.slice(i + 1);
      if (verb === "admin") {
        const [service, method, path, body] = rest;
        admin.push(`${service} ${method} ${path}`);
        if (body !== undefined) adminBodies.push(`${service} ${method} ${path} ${body}`);
        const preset = adminAnswers.get(`${service} ${method} ${path}`);
        if (preset) return ok(JSON.stringify(preset));
        if (path === "/admin/status") {
          const name = service === "g-model" ? [...digestByName.keys()].find((n) => n.endsWith("-model")) : service.slice(2);
          const spec = [...digestByName.entries()].find(([n]) => n === name);
          const block = /\n\[licence\]\n([\s\S]*)$/u.exec(tomls.get(service) ?? "")?.[1];
          const licence = block ? { configured: true, deployment: /^deployment = "([^"]+)"/mu.exec(block)?.[1], shop: /^shop = "([^"]+)"/mu.exec(block)?.[1], keys: guardLicence.kids.map((kid) => ({ kid, test_key: kid === TEST_KID })), keys_from: "GEO_GUARD_LICENCE_KEYS" } : undefined;
          return ok(JSON.stringify({ status: 200, body: { policy: { digest: runningDigest.get(service) ?? spec?.[1] }, tripwires: { ran: true, ok: true, passed: 4, of: 4, failed: [], not_self_testable_items: [{ item: "rule refund-once" }] }, kill_switch: { on: false }, ...(licence ? { licence } : {}) } }));
        }
        return ok(JSON.stringify({ status: 200, body: {} }));
      }
      if (verb === "stop") { admin.push(`stop ${rest.join(" ")}`); return ok(JSON.stringify({ shop: rest[0], on: rest[1] === "on", reason: rest[2] === "-" ? rest.slice(3).join(" ") : `stopped by ${rest[2]} at 2026-11-04T10:00:00.000Z: ${rest.slice(3).join(" ")}`, results: stopStatuses.map((status) => ({ guard: "g-x", status })) })); }
      if (verb === "recover") { admin.push(`recover ${rest.join(" ")}`); return ok(JSON.stringify({ shop: rest[0], status: recover.status })); }
      if (verb === "observe") return ok(JSON.stringify({ ...observe, model: {} }));
      if (verb === "issue-approver") return ok(`gg_${"a".repeat(32)}`);
      return ok("{}");
    }
    return ok();
  });
  const ctx: Context = { dir: t.root, appDir: new URL("../../", import.meta.url).pathname.replace(/\/$/u, ""), runner, tool, log: () => undefined, now: () => new Date("2026-11-04T10:00:00Z"), sleep: async () => undefined, docker: "docker", waitSeconds: 1 };
  return {
    ctx, root: t.root, paths: t.paths, calls, admin, adminBodies, adminAnswers, runningDigest, observe, stopStatuses, recover, guardLicence, tomls,
    failVerify: (service, rules) => failing.set(service, rules),
    handIn(shop, files = secretsFor(shop)) { const dir = join(t.paths.secretsInbox, shop); mkdirSync(dir, { recursive: true }); for (const [n, v] of Object.entries(files)) writeFileSync(join(dir, n), v); },
    done: t.done,
  };
}

export const composeCalls = (w: World) => w.calls.filter((c) => c.args[0] === "compose").map((c) => c.args.slice(c.args.indexOf("--project-directory") + 2));
export const read = (path: string) => readFileSync(path, "utf8");
export { CALENDAR_ID, PHONE_NUMBER_ID, existsSync };
