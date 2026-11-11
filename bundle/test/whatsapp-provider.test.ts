// A shop whose WhatsApp goes through Gupshup (item 11b), as the deploy bundle plans it: its WhatsApp Guard fronts partner.gupshup.io with the same credential file
// and header as Meta's, its spec allows only the shop's own Gupshup app, the runtime and the relay are told the provider, the inbox checks the app id, and
// the token is handed in as `gupshup_authorization`. A Meta shop's plan stays exactly as it was. Nothing here touches the real service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { guardDef, guardToml, whatsappGuardDef, whatsappSpec } from "../generate/guards.ts";
import { noSecretsIn, toolNamesMatch } from "../generate/rules.ts";
import { planShop } from "../generate/shop.ts";
import { inboxConfig, relayConfig } from "../generate/configs.ts";
import { INTAKE, readSecretFile, secretFile } from "../lib/secrets.ts";
import { loadRouter } from "../services/inbox.ts";
import { serverConfig, panelRuntime, tempServer, PHONE_NUMBER_ID } from "./helpers.ts";
import { checkShop } from "../deploy.ts";
import { keepWhatsAppProvider, runtimeFor } from "../panel/setup.ts";
import { secretsFor, world } from "./world.ts";
import { BINARY, skipWithoutBinary } from "./real-guard.ts";

const APP = "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8";
const plan = (messaging: Record<string, unknown>) => {
  const t = tempServer({ "glow-salon": panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: PHONE_NUMBER_ID, ...messaging }, timeoutMs: 20_000 } }) });
  try { return planShop(serverConfig(), t.shop("glow-salon")); } finally { t.done(); }
};

test("a Gupshup shop's WhatsApp Guard fronts partner.gupshup.io with the same Authorization file, and its spec allows only the shop's own Gupshup app", () => {
  const p = plan({ provider: "gupshup", appId: APP });
  assert.deepEqual(p.problems, []);
  const wa = p.guards.find((g) => g.kind === "whatsapp")!;
  assert.deepEqual(wa.def, { kind: "whatsapp", tool: "whatsapp", upstream: "partner.gupshup.io:443", secretFile: "whatsapp_authorization", headers: { Authorization: "${file:/run/secrets/whatsapp_authorization}" } });
  assert.deepEqual(wa.upstream, { host: "partner.gupshup.io:443", tls: true });
  assert.deepEqual(wa.spec.routes, [{ method: "POST", path: "/partner/app/{app_id}/v3/message", operation: "send" }, { method: "GET", path: "/partner/app/{app_id}/health", operation: "read_number" }]);
  assert.deepEqual(wa.spec.rules, [
    { id: "own-app-only", kind: "argument_allowlist", operation: "send", field: "app_id", match: "exact", allowed_values: [APP] },
    { id: "own-app-read", kind: "argument_allowlist", operation: "read_number", field: "app_id", match: "exact", allowed_values: [APP] },
  ]);
  assert.equal(wa.spec.limits[0].operation, "send", "the hourly cap, the licence's final stop and the owner's exception read the same operation as Meta's");
  const toml = guardToml({ def: wa.def, tenant: wa.tenant, deployment: wa.deployment, bundleDigest: "sha256:" + "a".repeat(64), upstream: wa.upstream, adminSha: "b".repeat(64), agents: [{ id: "runtime-x", sha: "c".repeat(64) }] });
  assert.match(toml, /^upstream = "partner\.gupshup\.io:443"$/m);
  assert.match(toml, /^Authorization = "\$\{file:\/run\/secrets\/whatsapp_authorization\}"$/m);
  assert.deepEqual(toolNamesMatch(wa, toml), []);
  const r = p.runtime as any;
  assert.deepEqual(r.services.messaging, { baseUrl: "http://g-glow-salon-whatsapp:8080", phoneNumberId: PHONE_NUMBER_ID, provider: "gupshup", appId: APP, agentTokenFile: "/run/secrets/agent_whatsapp" });
  assert.deepEqual(noSecretsIn({ "guard.toml": toml, "runtime.json": JSON.stringify(r), "spec.json": wa.specText }, []), []);
});

test("a Meta shop's WhatsApp Guard, spec and runtime config are what they were: no provider key, Graph's host and paths", () => {
  for (const p of [plan({}), plan({ provider: "meta" })]) {
    assert.deepEqual(p.problems, []);
    const wa = p.guards.find((g) => g.kind === "whatsapp")!;
    assert.deepEqual(wa.def, guardDef("whatsapp"));
    assert.deepEqual(wa.def, whatsappGuardDef());
    assert.equal(wa.def.upstream, "graph.facebook.com:443");
    assert.equal(wa.specText, plan({}).guards.find((g) => g.kind === "whatsapp")!.specText);
    assert.deepEqual(wa.spec, whatsappSpec({ tenant: "glow-salon", name: "glow-salon-whatsapp", version: 1, reviewedBy: "builder-arjun" }, { phoneNumberId: PHONE_NUMBER_ID, messagesPerHour: 200 }));
    assert.deepEqual(Object.keys((p.runtime as any).services.messaging), ["baseUrl", "phoneNumberId", "agentTokenFile"]);
  }
});

test("a provider the bundle cannot plan is refused by name before anything is generated", () => {
  assert.deepEqual(plan({ provider: "gupshup" }).problems.map((x) => x.rule), ["whatsapp-provider"]);
  assert.match(plan({ provider: "gupshup" }).problems[0].message, /appId is needed/);
  assert.deepEqual(plan({ provider: "interakt", appId: APP }).problems.map((x) => x.rule), ["whatsapp-provider"]);
  assert.deepEqual(plan({ provider: "gupshup", appId: APP }).problems, []);
});

test("the Gupshup token is handed in as gupshup_authorization: it fills the WhatsApp Guard's one credential file, as handed in, and a value with spaces or too short is refused", () => {
  const intake = INTAKE.gupshup_authorization;
  assert.deepEqual(intake.to("glow-salon"), ["g-glow-salon-whatsapp", "whatsapp_authorization"]);
  assert.deepEqual(intake.to("glow-salon"), INTAKE.whatsapp_token.to("glow-salon"), "one provider per shop: the same file Meta's token goes to");
  assert.equal(intake.make, undefined, "nothing is added: Gupshup's partner app token goes as it is, with no Bearer");
  assert.equal(intake.check("sk_" + "x".repeat(30)), undefined);
  assert.equal(intake.check("Bearer " + "y".repeat(40)), undefined);
  for (const bad of ["short", "two words here and more", "a\nb" + "c".repeat(20)]) assert.match(intake.check(bad) ?? "", /gupshup_authorization must be/);
});

test("the inbox of a Gupshup shop checks the app id each callback names; the relay asks the owner through the Gupshup Guard; a Meta shop's configs carry neither", async () => {
  const base = { index: 0, pathwayDir: "/p", guards: [{ kind: "razorpay" as const, service: "g-a-razorpay", tenant: "a" }, { kind: "whatsapp" as const, service: "g-a-whatsapp", tenant: "a" }], webhooks: { verification: "path-token" as const, hasGoogle: false, ownGoogleKey: false }, ownerWhatsapp: "+919800000009", phoneNumberId: PHONE_NUMBER_ID };
  const server = serverConfig();
  const inbox = JSON.parse(inboxConfig(server, [{ ...base, name: "a", whatsappRoute: { provider: "gupshup", appId: APP } }, { ...base, name: "b" }])).shops;
  assert.equal(inbox.a.gupshupAppId, APP);
  assert.equal(inbox.b.gupshupAppId, undefined);
  const relay = JSON.parse(relayConfig(server, [{ ...base, name: "a", whatsappRoute: { provider: "gupshup", appId: APP } }, { ...base, name: "b" }])).shops;
  assert.deepEqual([relay.a.provider, relay.a.appId], ["gupshup", APP]);
  assert.deepEqual([relay.b.provider, relay.b.appId], [undefined, undefined]);

  // the inbox the server runs, from that config: another app's report is answered 200 and dropped; this shop's is forwarded
  const received: unknown[] = [];
  const runtime: Server = createServer((req, res) => { let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => { received.push(...JSON.parse(raw).events); res.writeHead(200).end("{}"); }); });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const TOKEN = "Zk3-mQ9_vT7xLp2Rw8YdNa5c";
  const secrets: Record<string, string> = { "/s/a/internal_token": "internal-token-of-a-0123456789", "/s/a/razorpay_webhook_secret": "razorpay-secret-of-a", "/s/a/whatsapp_path_token": TOKEN };
  const router = loadRouter({ shops: { a: { runtimeUrl: `http://127.0.0.1:${(runtime.address() as { port: number }).port}`, ownerWhatsapp: "+919800000009", phoneNumberId: PHONE_NUMBER_ID, gupshupAppId: APP, verification: "path-token", secretsDir: "/s/a" } } }, (p) => secrets[p], () => undefined);
  const front = createServer(router);
  await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
  const body = (app: string) => JSON.stringify({ object: "whatsapp_business_account", gs_app_id: app, entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "1", phone_number_id: PHONE_NUMBER_ID }, statuses: [{ gs_id: "gs-1", id: "wamid.1", recipient_id: "919800000001", status: "failed", timestamp: "1793700000", errors: [{ code: 131047, title: "Message failed to send..." }] }] } }] }] });
  const post = (b: string) => fetch(`http://127.0.0.1:${(front.address() as { port: number }).port}/c/a/webhooks/whatsapp/${TOKEN}`, { method: "POST", body: b, headers: { "content-type": "application/json" } }).then(async (r) => [r.status, await r.json()]);
  try {
    assert.deepEqual(await post(body("ffffffff-0000-0000-0000-000000000000")), [200, { forwarded: 0 }]);
    assert.deepEqual(await post(body(APP)), [200, { forwarded: 1 }]);
    assert.deepEqual(received.map((e: any) => [e.kind, e.status.ids]), [["message_status", ["gs-1", "wamid.1"]]]);
  } finally {
    front.closeAllConnections(); runtime.closeAllConnections();
    await Promise.all([new Promise((r) => front.close(r)), new Promise((r) => runtime.close(r))]);
  }
});

test("checking a Gupshup shop asks for gupshup_authorization and a path token, not Meta's token and app secret; handed in, the shop checks out and the token reaches only the WhatsApp Guard's file", async () => {
  const gupshup = panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: PHONE_NUMBER_ID, provider: "gupshup", appId: APP }, timeoutMs: 20_000 } });
  const w = world({ "glow-salon": gupshup });
  try {
    const before = await checkShop(w.ctx, "glow-salon");
    const rules = before.problems.map((x) => x.rule);
    assert.ok(rules.includes("secret-missing:gupshup_authorization"), JSON.stringify(rules));
    assert.ok(!rules.includes("secret-missing:whatsapp_token"));
    const { whatsapp_token: _t, whatsapp_app_secret: _s, whatsapp_verify_token: _v, ...rest } = secretsFor("glow-salon");
    w.handIn("glow-salon", { ...rest, gupshup_authorization: "gupshup-partner-app-token-0123456789", whatsapp_path_token: "Zk3-mQ9_vT7xLp2Rw8YdNa5c" });
    const after = await checkShop(w.ctx, "glow-salon");
    assert.deepEqual(after.problems, []);
    assert.ok(after.lines.some((l) => l.startsWith("g-glow-salon-whatsapp:")), after.lines.join("\n"));
    assert.equal(readSecretFile(secretFile(w.root, "g-glow-salon-whatsapp", "whatsapp_authorization")), "gupshup-partner-app-token-0123456789", "as handed in: no Bearer added");
    assert.equal(readSecretFile(secretFile(w.root, "rt-glow-salon", "whatsapp_authorization")), undefined, "the runtime never has it");
  } finally { w.done(); }
});

test("a Gupshup shop pinned to a template version whose runtime does not know the provider is refused, by name: its runtime would not start, and Meta's paths are no fallback", () => {
  const t = tempServer({ "glow-salon": panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: PHONE_NUMBER_ID, provider: "gupshup", appId: APP }, timeoutMs: 20_000 } }) });
  try {
    // an older version's check: services.messaging takes only what it took before 11 Nov 2026
    const older = (config: unknown) => {
      const m = (config as { services?: { messaging?: Record<string, unknown> } }).services?.messaging ?? {};
      const unknown = Object.keys(m).filter((k) => !["baseUrl", "phoneNumberId", "agentTokenFile"].includes(k));
      return unknown.length === 0 ? { ok: true } : { ok: false, errors: unknown.map((k) => `I don't know what "${k}" means in services.messaging.`) };
    };
    const p = planShop(serverConfig(), t.shop("glow-salon"), {}, older);
    assert.deepEqual(p.problems.map((x) => x.rule), ["whatsapp-provider-pinned"]);
    assert.match(p.problems[0].message, /cannot send through Gupshup/);
    assert.deepEqual(planShop(serverConfig(), t.shop("glow-salon")).problems, [], "the current version takes it");
  } finally { t.done(); }
});

test("editing a shop in the panel keeps the WhatsApp provider runtime.json names: a Gupshup shop is not saved back to Meta's paths", () => {
  const fresh = runtimeFor("glow@example.com", PHONE_NUMBER_ID);
  assert.deepEqual(keepWhatsAppProvider(fresh, undefined), fresh, "a new shop: as made");
  assert.deepEqual(keepWhatsAppProvider(fresh, { services: { messaging: { phoneNumberId: PHONE_NUMBER_ID } } }), fresh, "a Meta shop: as made");
  const kept = keepWhatsAppProvider(fresh, { services: { messaging: { phoneNumberId: "999", provider: "gupshup", appId: APP } } }) as any;
  assert.deepEqual(kept.services.messaging, { phoneNumberId: PHONE_NUMBER_ID, provider: "gupshup", appId: APP }, "the number id is the form's; the provider and app are kept");
  assert.deepEqual(kept.services.calendar, (fresh as any).services.calendar);
});

test("the real Guard compiles a Gupshup shop's WhatsApp spec and its tripwires show both app allowlists bite", { skip: skipWithoutBinary }, () => {
  const p = plan({ provider: "gupshup", appId: APP });
  const wa = p.guards.find((g) => g.kind === "whatsapp")!;
  const dir = mkdtempSync(join(tmpdir(), "geo-gupshup-guard-"));
  try {
    writeFileSync(join(dir, "spec.json"), wa.specText);
    const compiled = JSON.parse(execFileSync(BINARY, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8" })) as { digest: string; tool: string; tripwires: { passed: number; of: number } };
    assert.equal(compiled.tool, "whatsapp");
    assert.deepEqual([compiled.tripwires.passed, compiled.tripwires.of], [2, 2]);
    writeFileSync(join(dir, "guard.toml"), guardToml({ def: wa.def, tenant: wa.tenant, deployment: wa.deployment, bundleDigest: compiled.digest, upstream: wa.upstream, adminSha: "b".repeat(64), agents: [{ id: "runtime-glow-salon", sha: "c".repeat(64) }] }));
    const verified = execFileSync(BINARY, ["verify-bundle", join(dir, "bundle.json"), "--config", join(dir, "guard.toml")], { encoding: "utf8" });
    assert.match(verified, /tripwires: passed 2 of 2/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
