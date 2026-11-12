// A shop on its OWN Gupshup account (item 11c, Gupshup's self-serve API), as the deploy bundle and the panel handle it: its WhatsApp Guard fronts api.gupshup.io and adds
// the shop's API key as the `apikey` header from its credential file, its spec allows only the shop's own app and number on both send routes, the licence's final stop
// reads Gupshup's recipient field, the key is handed in as gupshup_apikey, the inbox checks the app name each callback names, the panel's step and check say what they
// can and cannot show, the cost lines name the shop's own Gupshup wallet, and the heartbeat leaves its WhatsApp counts out of fleet's pass-through. A Meta shop's plan
// stays as it was (whatsapp-provider.test.ts checks that). Nothing here touches the real service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { guardToml, whatsappGuardDef } from "../generate/guards.ts";
import { noSecretsIn, toolNamesMatch } from "../generate/rules.ts";
import { planShop } from "../generate/shop.ts";
import { inboxConfig, opsConfig, relayConfig } from "../generate/configs.ts";
import { INTAKE, readSecretFile, secretFile } from "../lib/secrets.ts";
import { loadRouter } from "../services/inbox.ts";
import { buildHeartbeat } from "../services/heartbeat.ts";
import { serverConfig, panelRuntime, tempServer, PHONE_NUMBER_ID } from "./helpers.ts";
import { checkShop, deploy } from "../deploy.ts";
import { kidOf } from "../../modules/licence/token.ts";
import { PIN, TEST_PUBLIC_HEX } from "./licence-helpers.ts";
import { applyAccounts, keepWhatsAppProvider, newDraft, whatsappDraftOf } from "../panel/setup.ts";
import { checkSecret } from "../panel/secrets.ts";
import { checkGupshupSelfServe, checkConnections } from "../panel/checks.ts";
import { PRICES_DIR, loadPriceList, monthlyCost } from "../panel/cost.ts";
import { glowSalon } from "../../templates/commerce/bookings/src/harness.ts";
import { en } from "../panel/words.ts";
import { runningCostItems } from "../panel/health.ts";
import { read, secretsFor, world } from "./world.ts";
import { BINARY, skipWithoutBinary } from "./real-guard.ts";
import { BOOKINGS_SERVICES, readRuntimeConfig } from "../../modules/runtime/config.ts";
import { createLiveMessaging } from "../../modules/messaging/providers.ts";
import { fakeClock } from "../../modules/core/clock.ts";

const SOURCE = "919876543210";
const MESSAGING = { provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: SOURCE };
const plan = (messaging: Record<string, unknown>, withNumberId = true) => {
  const t = tempServer({ "glow-salon": panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { ...(withNumberId ? { phoneNumberId: PHONE_NUMBER_ID } : {}), ...messaging }, timeoutMs: 20_000 } }) });
  try { return planShop(serverConfig(), t.shop("glow-salon")); } finally { t.done(); }
};

test("the shop's WhatsApp Guard fronts api.gupshup.io and adds the key as the apikey header; its spec lists both send routes and the template list, and allows only the shop's own number on a send and its own app on the read", () => {
  const p = plan(MESSAGING, false); // a shop with no Meta number id: its number stands in
  assert.deepEqual(p.problems, []);
  const wa = p.guards.find((g) => g.kind === "whatsapp")!;
  assert.deepEqual(wa.def, { kind: "whatsapp", tool: "whatsapp", upstream: "api.gupshup.io:443", secretFile: "whatsapp_authorization", recipientField: "destination", headers: { apikey: "${file:/run/secrets/whatsapp_authorization}" } });
  assert.deepEqual(wa.upstream, { host: "api.gupshup.io:443", tls: true });
  assert.deepEqual(wa.spec.routes, [
    { method: "POST", path: "/wa/api/v1/msg", operation: "send" }, { method: "POST", path: "/wa/api/v1/template/msg", operation: "send" },
    { method: "GET", path: "/sm/api/v1/template/list/{app_name}", operation: "read_number" },
  ]);
  assert.deepEqual(wa.spec.rules, [
    { id: "own-source-only", kind: "argument_allowlist", operation: "send", field: "source", match: "exact", allowed_values: [SOURCE] },
    { id: "own-app-read", kind: "argument_allowlist", operation: "read_number", field: "app_name", match: "exact", allowed_values: ["Glow_Salon"] },
  ]);
  assert.equal(wa.spec.limits[0].operation, "send", "the hourly cap and the licence's final stop hold templates too: one operation for both sends");
  const toml = guardToml({ def: wa.def, tenant: wa.tenant, deployment: wa.deployment, bundleDigest: "sha256:" + "a".repeat(64), upstream: wa.upstream, adminSha: "b".repeat(64), agents: [{ id: "runtime-x", sha: "c".repeat(64) }] });
  assert.match(toml, /^upstream = "api\.gupshup\.io:443"$/m);
  assert.match(toml, /^apikey = "\$\{file:\/run\/secrets\/whatsapp_authorization\}"$/m);
  assert.ok(!/^Authorization = /m.test(toml), "Gupshup reads apikey, not Authorization");
  assert.deepEqual(toolNamesMatch(wa, toml), []);
  const r = p.runtime as any;
  // Gupshup shows a shop no Meta number id: its number stands in for it
  assert.deepEqual(r.services.messaging, { baseUrl: "http://g-glow-salon-whatsapp:8080", phoneNumberId: SOURCE, ...MESSAGING, agentTokenFile: "/run/secrets/agent_whatsapp" });
  assert.deepEqual(noSecretsIn({ "guard.toml": toml, "runtime.json": JSON.stringify(r), "spec.json": wa.specText }, []), []);
});

test("with the app id given, the template list is read by id; a '+' in the number is dropped from the allowed value; a bad name or number is refused by name", () => {
  const id = "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8";
  const wa = plan({ ...MESSAGING, sourceNumber: `+${SOURCE}`, appId: id }).guards.find((g) => g.kind === "whatsapp")!;
  assert.deepEqual(wa.spec.routes[2], { method: "GET", path: "/wa/app/{app_id}/template", operation: "read_number" });
  assert.deepEqual(wa.spec.rules.map((x: any) => [x.field, x.allowed_values]), [["source", [SOURCE]], ["app_id", [id]]]);
  assert.deepEqual(plan({ ...MESSAGING, appName: "Glow Salon" }).problems.map((x) => x.rule), ["whatsapp-provider"]);
  assert.deepEqual(plan({ ...MESSAGING, sourceNumber: "n/a" }).problems.map((x) => x.rule), ["whatsapp-provider"]);
  assert.deepEqual(plan({ ...MESSAGING }, false).problems, [], "no Meta number id is needed with a number of its own");
  assert.deepEqual(plan({ provider: "gupshup-selfserve" }, false).problems.map((x) => x.rule).includes("whatsapp-number-id"), true, "without either, the number is still asked for");
});

test("the licence's final stop reads Gupshup's own recipient field (destination); a Meta shop still reads 'to'", () => {
  const licence = { deployment: "acme-vps-1", shop: "glow-salon", ownerNumbers: ["+919000000000"] };
  const base = { tenant: "glow-salon", deployment: "glow-salon-whatsapp", bundleDigest: "sha256:" + "0".repeat(64), upstream: { host: "api.gupshup.io:443", tls: true }, adminSha: "0".repeat(64), agents: [{ id: "runtime-x", sha: "c".repeat(64) }] };
  const gupshup = guardToml({ ...base, def: whatsappGuardDef({ provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: SOURCE }), licence: { ...licence, recipientField: "destination" } });
  assert.match(gupshup, /^recipient_field = "destination"$/mu);
  assert.match(guardToml({ ...base, def: whatsappGuardDef(), licence }), /^recipient_field = "to"$/mu);
});

test("the API key is handed in as gupshup_apikey: it fills the WhatsApp Guard's one credential file as handed in, and a short key or one with spaces is refused", () => {
  const intake = INTAKE.gupshup_apikey;
  assert.deepEqual(intake.to("glow-salon"), ["g-glow-salon-whatsapp", "whatsapp_authorization"]);
  assert.equal(intake.make, undefined, "the key goes as it is: Gupshup reads it as a plain header");
  assert.equal(intake.check("sk_" + "x".repeat(30)), undefined);
  for (const bad of ["short", "two words here and more", "a\nb" + "c".repeat(20)]) assert.match(intake.check(bad) ?? "", /gupshup_apikey must be/);
  assert.deepEqual(checkSecret("gupshup_apikey", " " + "k".repeat(32) + " "), { ok: true, text: "k".repeat(32) });
  assert.deepEqual(checkSecret("gupshup_apikey", "has space in it 123456"), { ok: false });
  assert.deepEqual(checkSecret("whatsapp_path_token", "Zk3-mQ9_vT7xLp2Rw8YdNa5c"), { ok: true, text: "Zk3-mQ9_vT7xLp2Rw8YdNa5c" });
  assert.deepEqual(checkSecret("whatsapp_path_token", "short"), { ok: false });
});

test("checking a self-serve shop asks for gupshup_apikey and a path token, not Meta's token and app secret; handed in, it checks out and the key reaches only the WhatsApp Guard's file", async () => {
  const shop = panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: SOURCE, ...MESSAGING }, timeoutMs: 20_000 } });
  const w = world({ "glow-salon": shop });
  try {
    const rules = (await checkShop(w.ctx, "glow-salon")).problems.map((x) => x.rule);
    assert.ok(rules.includes("secret-missing:gupshup_apikey"), JSON.stringify(rules));
    assert.ok(!rules.includes("secret-missing:whatsapp_token") && !rules.includes("secret-missing:gupshup_authorization"));
    const { whatsapp_token: _t, whatsapp_app_secret: _s, whatsapp_verify_token: _v, ...rest } = secretsFor("glow-salon");
    w.handIn("glow-salon", { ...rest, gupshup_apikey: "gupshup-own-account-key-0123456789", whatsapp_path_token: "Zk3-mQ9_vT7xLp2Rw8YdNa5c" });
    const after = await checkShop(w.ctx, "glow-salon");
    assert.deepEqual(after.problems, []);
    assert.equal(readSecretFile(secretFile(w.root, "g-glow-salon-whatsapp", "whatsapp_authorization")), "gupshup-own-account-key-0123456789");
    assert.equal(readSecretFile(secretFile(w.root, "rt-glow-salon", "whatsapp_authorization")), undefined, "the runtime never has it");
  } finally { w.done(); }
});

test("the inbox of a self-serve shop checks the app name each callback names; the relay asks the owner through the shop's Guard with the app's name and number; the ops config marks the shop as paying WhatsApp itself", async () => {
  const base = { index: 0, pathwayDir: "/p", guards: [{ kind: "razorpay" as const, service: "g-a-razorpay", tenant: "a" }, { kind: "whatsapp" as const, service: "g-a-whatsapp", tenant: "a" }], webhooks: { verification: "path-token" as const, hasGoogle: true }, ownerWhatsapp: "+919800000009", phoneNumberId: SOURCE, pathwayVersion: "1" };
  const server = serverConfig();
  const route = { provider: "gupshup-selfserve" as const, appName: "Glow_Salon", sourceNumber: SOURCE };
  const shops = [{ ...base, name: "a", whatsappRoute: route }, { ...base, name: "b" }] as any[];
  const inbox = JSON.parse(inboxConfig(server, shops)).shops;
  assert.deepEqual([inbox.a.gupshupAppName, inbox.a.gupshupAppId, inbox.b.gupshupAppName], ["Glow_Salon", undefined, undefined]);
  const relay = JSON.parse(relayConfig(server, shops)).shops;
  assert.deepEqual([relay.a.provider, relay.a.appName, relay.a.sourceNumber, relay.b.provider], ["gupshup-selfserve", "Glow_Salon", SOURCE, undefined]);
  const ops = JSON.parse(opsConfig(server, shops)).shops;
  assert.deepEqual([ops.a.whatsappPaidBy, ops.b.whatsappPaidBy], ["shop", undefined]);

  const received: any[] = [];
  const runtime: Server = createServer((req, res) => { let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => { received.push(...JSON.parse(raw).events); res.writeHead(200).end("{}"); }); });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const TOKEN = "Zk3-mQ9_vT7xLp2Rw8YdNa5c";
  const secrets: Record<string, string> = { "/s/a/internal_token": "internal-token-of-a-0123456789", "/s/a/razorpay_webhook_secret": "razorpay-secret-of-a", "/s/a/whatsapp_path_token": TOKEN };
  const router = loadRouter({ shops: { a: { runtimeUrl: `http://127.0.0.1:${(runtime.address() as { port: number }).port}`, ownerWhatsapp: "+919800000009", phoneNumberId: SOURCE, gupshupAppName: "Glow_Salon", verification: "path-token", secretsDir: "/s/a" } } } as any, (p: string) => secrets[p], () => {});
  const front = createServer(router);
  await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
  const body = (app: string) => JSON.stringify({ app, timestamp: 1585344476000, version: 2, type: "message-event", payload: { id: "wamid.1", gsId: "gs-1", type: "delivered", destination: "919800000001", payload: { ts: 1585344476 } } });
  const post = (b: string, token = TOKEN) => fetch(`http://127.0.0.1:${(front.address() as { port: number }).port}/c/a/webhooks/whatsapp/${token}`, { method: "POST", body: b, headers: { "content-type": "application/json" } }).then(async (r) => [r.status, await r.json().catch(() => null)]);
  try {
    assert.deepEqual(await post(body("OtherShop")), [200, { forwarded: 0 }], "another app's report is answered and dropped");
    assert.deepEqual((await post(body("Glow_Salon")))[0], 200);
    assert.deepEqual(received.map((e) => [e.kind, e.status.ids, e.status.status]), [["message_status", ["gs-1", "wamid.1"], "delivered"]]);
    assert.equal((await post(body("Glow_Salon"), "wrong-token-wrong-token"))[0], 404, "the path token still guards the route: Gupshup does not sign");
  } finally {
    front.closeAllConnections(); runtime.closeAllConnections();
    await Promise.all([new Promise((r) => front.close(r)), new Promise((r) => runtime.close(r))]);
  }
});

test("the panel's phone step: picking the shop's own Gupshup account asks for the app name, the API key and the callback word (no Meta token), and writes the provider into runtime.json; picking Meta again switches it back", () => {
  const template = { accounts: ["whatsapp"] } as any;
  const draft = newDraft("d1", "acc", { id: "bookings" } as any, glowSalon(), "2026-11-12T00:00:00Z");
  const body = { waNumber: "+91 98765 43210", waProvider: "gupshup-selfserve", waAppName: "Glow_Salon", waApiKey: "k".repeat(32), waPathToken: "Zk3-mQ9_vT7xLp2Rw8YdNa5c" };
  const meta = { schema: 1, receipts: {} } as any;
  const ok = applyAccounts(draft, body, template, meta, true, en);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.secrets.map((s) => s.name), ["gupshup_apikey", "whatsapp_path_token"]);
  assert.deepEqual(draft.whatsapp, { businessNumber: "+919876543210", numberId: SOURCE, provider: "gupshup-selfserve", appName: "Glow_Salon" });
  const bad = applyAccounts(draft, { ...body, waAppName: "Glow Salon!", waApiKey: "" }, template, meta, true, en);
  assert.ok(bad.problems.length >= 2, "a bad app name and a missing key are both said");
  // the key is kept when it arrived before and the box is left empty
  const kept = applyAccounts(draft, { ...body, waApiKey: "", waPathToken: "" }, template, { schema: 1, receipts: { gupshup_apikey: "t", whatsapp_path_token: "t" } } as any, true, en);
  assert.deepEqual([kept.problems, kept.secrets], [[], []]);
  // Meta direct is still asked for what it was: the number id, the token and the app secret
  const metaDraft = newDraft("d2", "acc", { id: "bookings" } as any, glowSalon(), "2026-11-12T00:00:00Z");
  const metaRes = applyAccounts(metaDraft, { waNumber: "+91 98765 43210", waNumberId: "123456789012", waToken: "t".repeat(30), waAppSecret: "s".repeat(30) }, template, meta, true, en);
  assert.deepEqual([metaRes.problems, metaRes.secrets.map((s) => s.name), metaDraft.whatsapp.provider], [[], ["whatsapp_token", "whatsapp_app_secret"], undefined]);

  const fresh = { services: { messaging: { phoneNumberId: SOURCE } } } as any;
  const written = keepWhatsAppProvider(fresh, undefined, draft.whatsapp) as any;
  assert.deepEqual(written.services.messaging, { phoneNumberId: SOURCE, provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: SOURCE });
  const before = { services: { messaging: { provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: SOURCE, appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" } } };
  assert.equal((keepWhatsAppProvider(fresh, before, draft.whatsapp) as any).services.messaging.appId, "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8", "an app id written by hand is kept");
  assert.deepEqual(keepWhatsAppProvider(fresh, before, { businessNumber: "+919876543210", numberId: "123456789012" }), fresh, "the partner chose Meta: written as Meta");
  // a partner-mode shop is still kept as it was
  const partner = keepWhatsAppProvider(fresh, { services: { messaging: { provider: "gupshup", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" } } }, { businessNumber: "x", numberId: "1" }) as any;
  assert.equal(partner.services.messaging.provider, "gupshup");
});

test("the connection check reads the app's template list: it names the app and how many templates are approved, and never claims the number or a send", async () => {
  const reply = (status: number, body: unknown) => ({ request: async () => ({ status, body }) });
  const list = { status: "success", templates: [{ id: "a-1234567", elementName: "x", languageCode: "en", status: "APPROVED" }, { id: "b-1234567", elementName: "y", languageCode: "hi", status: "PENDING" }] };
  const ok = await checkGupshupSelfServe({ baseUrl: "http://g", appName: "Glow_Salon" }, { http: reply(200, list) });
  assert.deepEqual([ok.ok, ok.code, ok.confirmed, ok.notChecked.sort()], [true, "confirmed", { appName: "Glow_Salon", templatesListed: 2, templatesApproved: 1 }, ["sending", "templates-approved", "which-number"]]);
  assert.equal(ok.sentNothing, true);
  assert.deepEqual((await checkGupshupSelfServe({ baseUrl: "http://g", appName: "Glow_Salon" }, { http: reply(401, { status: "error", message: "Authentication Failed" }) })).code, "not_allowed");
  const missing = await checkGupshupSelfServe({ baseUrl: "http://g", appName: "Glow_Salon" }, { http: reply(400, { status: "error", message: "Invalid App Details" }) });
  assert.deepEqual([missing.code, missing.detail], ["not_found", "Invalid App Details"]);
  assert.equal((await checkGupshupSelfServe({ baseUrl: "http://g", appName: "Glow_Salon" }, { http: reply(429, {}) })).code, "rate_limited");
  assert.equal((await checkGupshupSelfServe({ baseUrl: "http://g", appName: "Glow_Salon" }, { http: reply(200, { status: "success" }) })).code, "unexpected_response", "a reply that is no list is not a pass");
  assert.equal((await checkGupshupSelfServe({ baseUrl: "http://g", appName: "bad name" }, { http: reply(200, list) })).code, "not_configured");
  const report = await checkConnections({ gupshupSelfServe: { baseUrl: "http://127.0.0.1:1", appName: "Glow_Salon" }, timeoutMs: 500 });
  assert.deepEqual(report.results.map((r) => r.service), ["whatsapp"], "checked in place of the Meta number read");
  assert.equal(report.results[0].ok, false);
});

test("the cost: a self-serve shop's two WhatsApp lines are an estimate paid from the shop's own Gupshup wallet, not the builder's or partner's; the running-cost list counts nothing for it", () => {
  const prices = loadPriceList(new URL("2026-11-09.json", PRICES_DIR).pathname);
  const wallet = monthlyCost({ settings: glowSalon(), whatsappProvider: "gupshup", whatsappFromShopWallet: true }, prices);
  const builder = monthlyCost({ settings: glowSalon(), whatsappProvider: "gupshup" }, prices);
  const payer = (c: typeof wallet, id: string) => c.lines.find((l) => l.id === id)!.payer;
  assert.deepEqual(["whatsapp", "whatsapp-provider"].map((id) => payer(wallet, id)), ["shop-pays-gupshup-wallet", "shop-pays-gupshup-wallet"]);
  assert.deepEqual(["whatsapp", "whatsapp-provider"].map((id) => payer(builder, id)), ["builder-pays-whatsapp-provider", "builder-pays-whatsapp-provider"]);
  assert.deepEqual(wallet.lines.map((l) => l.paise), builder.lines.map((l) => l.paise), "the estimate is the same sum; only who pays it changes");
  assert.match(en.cost.payer["shop-pays-gupshup-wallet"], /estimate.*shop's own Gupshup wallet, not from Geometer's balance/u);
  const items = runningCostItems({ plan: { paise: 100, notes: [] }, usage: null, modelIncluded: true, entries: undefined, month: "2026-11", whatsappFromShopWallet: true });
  assert.deepEqual(items.find((i) => i.id === "whatsapp"), { id: "whatsapp", paise: 0, notes: ["shop-wallet"] });
  const other = runningCostItems({ plan: { paise: 100, notes: [] }, usage: null, modelIncluded: true, entries: undefined, month: "2026-11" });
  assert.deepEqual(other.find((i) => i.id === "whatsapp"), { id: "whatsapp", paise: null, notes: ["no-record"] });
});

test("the heartbeat keeps a self-serve shop's WhatsApp counts in its baseline but sends zero of them, so fleet's pass-through bills nothing for it; the other counts and other shops are unchanged", () => {
  const usage = (n: number) => ({ messages: 10 + n, byStep: { rules: 5, decision: 3, model: 2 }, modelMicroInr: 1000, whatsapp: { service: 4 + n, utility: 6 + n, marketing: 0, estMicroInr: 50_000 + n, estimated: true } });
  const shop = (id: string, extra: object, u: ReturnType<typeof usage>) => ({ id, pathway: "bookings", pathwayVersion: "1", up: true, ready: true, status: null, guards: [], usage: u, ...extra });
  const now = new Date("2026-11-12T10:00:00Z");
  const first = buildHeartbeat({ deploymentId: "d", bundleVersion: "1", now, baseline: {}, shops: [shop("own", { whatsappPaidBy: "shop" }, usage(0)), shop("hosted", {}, usage(0))] as any });
  const second = buildHeartbeat({ deploymentId: "d", bundleVersion: "1", now, baseline: first.next, usageBaseline: first.nextUsage, shops: [shop("own", { whatsappPaidBy: "shop" }, usage(3)), shop("hosted", {}, usage(3))] as any });
  const sent = Object.fromEntries((second.body as any).agents.map((a: any) => [a.id, a.usage]));
  assert.deepEqual(sent.own.whatsapp, { service: 0, utility: 0, marketing: 0, est_micro_inr: 0 });
  assert.equal(sent.own.messages, 3, "the customers' messages are still counted for the plan");
  assert.deepEqual(sent.hosted.whatsapp, { service: 3, utility: 3, marketing: 0, est_micro_inr: 3 });
  assert.equal(second.nextUsage.own.service, 7, "the baseline still follows the real count");
});

test("deployed, the self-serve shop's WhatsApp Guard file carries the apikey header, Gupshup's host and the licence's recipient field 'destination'; its runtime and inbox are told the app", async () => {
  const shop = panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: SOURCE, ...MESSAGING }, timeoutMs: 20_000 } });
  const w = world({ "glow-salon": shop }, PIN);
  try {
    w.guardLicence.reads = true; w.guardLicence.kids = [kidOf(Buffer.from(TEST_PUBLIC_HEX, "hex"))];
    const { whatsapp_token: _t, whatsapp_app_secret: _s, whatsapp_verify_token: _v, ...rest } = secretsFor("glow-salon");
    w.handIn("glow-salon", { ...rest, gupshup_apikey: "gupshup-own-account-key-0123456789", whatsapp_path_token: "Zk3-mQ9_vT7xLp2Rw8YdNa5c" });
    const [r] = await deploy(w.ctx);
    assert.equal(r.shop, "glow-salon");
    const toml = read(join(w.paths.generated, "guards", "g-glow-salon-whatsapp", "guard.toml"));
    assert.match(toml, /^upstream = "api\.gupshup\.io:443"$/mu);
    assert.match(toml, /^apikey = "\$\{file:\/run\/secrets\/whatsapp_authorization\}"$/mu);
    assert.match(toml, /^recipient_field = "destination"$/mu, "the final stop reads Gupshup's recipient field");
    assert.match(read(join(w.paths.generated, "guards", "g-razorpay".replace("g-razorpay", "g-glow-salon-razorpay"), "guard.toml")), /^recipient_field = "to"$/mu, "another Guard of the same shop is unchanged");
    assert.equal(JSON.parse(read(join(w.paths.generated, "inbox", "inbox.json"))).shops["glow-salon"].gupshupAppName, "Glow_Salon");
  } finally { w.done(); }
});

test("a runtime.json for a self-serve shop is read by the runtime (the app name and number are kept for the live adapter), and a key in it is refused by name", () => {
  const messaging = (extra: Record<string, unknown>) => ({ baseUrl: "http://g:8080", phoneNumberId: SOURCE, ...MESSAGING, ...extra });
  const config = (m: Record<string, unknown>) => readRuntimeConfig({ mode: "live", services: { payments: { baseUrl: "http://g:8080" }, calendar: { baseUrl: "http://g:8080", calendarId: "c" }, messaging: m } }, "/c", BOOKINGS_SERVICES);
  const ok = config(messaging({}));
  assert.ok(ok.ok, JSON.stringify(ok));
  if (ok.ok) assert.deepEqual([(ok.config.services!.messaging as any).appName, (ok.config.services!.messaging as any).sourceNumber, (ok.config.services!.messaging as any).provider], ["Glow_Salon", SOURCE, "gupshup-selfserve"]);
  assert.ok(!config(messaging({ appName: "bad name" })).ok);
  const refused = config(messaging({ apikey: "secret-value" }));
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.ok(!refused.errors.join(" ").includes("secret-value"));
  // the same fields reach createLiveMessaging, which the relay's config also hands them to
  assert.ok(createLiveMessaging({ ...messaging({}), provider: "gupshup-selfserve" } as any, { clock: fakeClock(0), window: { lastInboundAt: () => 0 } }));
});

test("an edited Fees or Orders shop on its own Gupshup account still shows that choice (the draft carries the provider and the app name), and Bookings' does too", () => {
  const meta = { schema: 1, receipts: {}, whatsapp: { businessNumber: "+919876543210" } } as any;
  const runtime = { services: { messaging: { phoneNumberId: SOURCE, ...MESSAGING } } };
  assert.deepEqual(whatsappDraftOf(meta, runtime), { businessNumber: "+919876543210", numberId: SOURCE, provider: "gupshup-selfserve", appName: "Glow_Salon" });
  assert.deepEqual(whatsappDraftOf(meta, { services: { messaging: { phoneNumberId: "123456789012" } } }), { businessNumber: "+919876543210", numberId: "123456789012" });
  assert.deepEqual(whatsappDraftOf(meta, undefined), { businessNumber: "+919876543210", numberId: "" });
  // Bookings, Fees and Orders each build their draft from an existing shop; all three must take the phone step's draft from this one function
  for (const file of ["setup.ts", "fees.ts", "orders.ts"]) assert.match(readFileSync(new URL(`../panel/${file}`, import.meta.url), "utf8"), /whatsapp: whatsappDraftOf\(meta, runtime\)/u, `${file} reads the provider back`);
});

test("the real Guard compiles the self-serve spec (its three routes and both allowlists) and its tripwires hold", { skip: skipWithoutBinary }, () => {
  const wa = plan(MESSAGING).guards.find((g) => g.kind === "whatsapp")!;
  const dir = mkdtempSync(join(tmpdir(), "geo-gupshup-selfserve-"));
  try {
    writeFileSync(join(dir, "spec.json"), wa.specText);
    const compiled = JSON.parse(execFileSync(BINARY, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8" })) as { digest: string; tool: string; tripwires: { passed: number; of: number } };
    assert.equal(compiled.tool, "whatsapp");
    assert.equal(compiled.tripwires.passed, compiled.tripwires.of);
    // and the guard.toml the bundle writes for it: the apikey header, Gupshup's host and the recipient field are read by the binary's own check
    writeFileSync(join(dir, "guard.toml"), guardToml({ def: wa.def, tenant: wa.tenant, deployment: wa.deployment, bundleDigest: compiled.digest, upstream: wa.upstream, adminSha: "b".repeat(64), agents: [{ id: "runtime-glow-salon", sha: "c".repeat(64) }] }));
    assert.match(execFileSync(BINARY, ["verify-bundle", join(dir, "bundle.json"), "--config", join(dir, "guard.toml")], { encoding: "utf8" }), /tripwires: passed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

