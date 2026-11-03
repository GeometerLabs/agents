// A fake machine for the deployer's tests: a Runner that answers `docker` the way a healthy server would, a Guard tool that "compiles" and "verifies" without
// Docker, and a clock that does not wait. Every call is recorded so a test can say what was started and what was not.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../deploy.ts";
import type { GuardTool, TripwireResult } from "../generate/verify.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import type { RunResult } from "../lib/runner.ts";
import { prepareSecretsRoot, secretFile, writeSecretFile } from "../lib/secrets.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, panelRuntime, tempServer } from "./helpers.ts";

export const GOOD: TripwireResult = { ok: true, passed: 4, of: 4, notSelfTestable: ["rule refund-once: whether a repeat is stopped depends on the intent ledger"], failedRules: [], text: "" };

export interface World {
  ctx: Context;
  root: string;
  paths: ReturnType<typeof tempServer>["paths"];
  calls: { command: string; args: string[] }[];
  /** Admin calls the fake ops container was asked for, as `service METHOD path`. */
  admin: string[];
  /** Make verify-bundle fail for a service, naming rules. */
  failVerify(service: string, rules: string[]): void;
  /** Make the "running" Guard report another policy than the one compiled. */
  runningDigest: Map<string, string>;
  handIn(shop: string, files?: Record<string, string>): void;
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
  const failing = new Map<string, string[]>();
  const compiled = new Map<string, string>(); // service -> digest, from the spec's name
  const runningDigest = new Map<string, string>();
  const digestByName = new Map<string, string>();
  const tool: GuardTool = {
    async compile(specText) {
      const spec = JSON.parse(specText) as { tool: string; tenant: string; name: string; version: number };
      const digest = digestOf(specText);
      digestByName.set(spec.name, digest);
      return { ok: true, result: { digest, tool: spec.tool, tenant: spec.tenant, version: spec.version, text: JSON.stringify({ compiled: spec }) } };
    },
    async verify(bundleText, toml) {
      const name = /^deployment = "([^"]+)"/mu.exec(toml)?.[1] ?? "";
      const service = name === "" ? "" : toml.includes('tool = "model"') ? "g-model" : `g-${name}`;
      const rules = failing.get(service);
      void bundleText;
      return rules ? { ok: false, passed: 0, of: 4, notSelfTestable: [], failedRules: rules, text: "tripwire failed" } : GOOD;
    },
  };
  const runner = fakeRunner((command, args): RunResult => {
    calls.push({ command, args });
    const joined = args.join(" ");
    if (args[0] === "image") return ok("sha256:imageid");
    if (args[0] === "compose" && joined.includes("exec -T ops")) {
      const i = args.findIndex((a) => a.endsWith("/ops.ts"));
      const [verb, ...rest] = args.slice(i + 1);
      if (verb === "admin") {
        const [service, method, path] = rest;
        admin.push(`${service} ${method} ${path}`);
        if (path === "/admin/status") {
          const name = service === "g-model" ? [...digestByName.keys()].find((n) => n.endsWith("-model")) : service.slice(2);
          const spec = [...digestByName.entries()].find(([n]) => n === name);
          return ok(JSON.stringify({ status: 200, body: { policy: { digest: runningDigest.get(service) ?? spec?.[1] }, tripwires: { ran: true, ok: true, passed: 4, of: 4, failed: [], not_self_testable_items: [{ item: "rule refund-once" }] }, kill_switch: { on: false } } }));
        }
        return ok(JSON.stringify({ status: 200, body: {} }));
      }
      if (verb === "stop") { admin.push(`stop ${rest.join(" ")}`); return ok(JSON.stringify({ shop: rest[0], on: rest[1] === "on", reason: `stopped by ${rest[2]}`, results: [{ guard: "g-x", status: 200 }] })); }
      if (verb === "issue-approver") return ok(`gg_${"a".repeat(32)}`);
      return ok("{}");
    }
    return ok();
  });
  const ctx: Context = { dir: t.root, appDir: new URL("../../", import.meta.url).pathname.replace(/\/$/u, ""), runner, tool, log: () => undefined, now: () => new Date("2026-11-04T10:00:00Z"), sleep: async () => undefined, docker: "docker", waitSeconds: 1 };
  void compiled;
  return {
    ctx, root: t.root, paths: t.paths, calls, admin, runningDigest,
    failVerify: (service, rules) => failing.set(service, rules),
    handIn(shop, files = secretsFor(shop)) { const dir = join(t.paths.secretsInbox, shop); mkdirSync(dir, { recursive: true }); for (const [n, v] of Object.entries(files)) writeFileSync(join(dir, n), v); },
    done: t.done,
  };
}

export const composeCalls = (w: World) => w.calls.filter((c) => c.args[0] === "compose").map((c) => c.args.slice(c.args.indexOf("--project-directory") + 2));
export const read = (path: string) => readFileSync(path, "utf8");
export { CALENDAR_ID, PHONE_NUMBER_ID, existsSync };
