// The WhatsApp Guard's template routes (25 Nov 2026) on the REAL geo-guard program, in front of the template stand-ins: the panel's agent lists and submits a shop's
// templates in the shop's own account (the Guard adds the key), the runtime's agent cannot submit one, and an account other than the shop's is refused. Meta direct
// (the WhatsApp Business Account id) and Gupshup self-serve (the app id) both. Without the built program the test says it was skipped and why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy } from "../deploy.ts";
import { panelRuntime } from "./helpers.ts";
import { read, world } from "./world.ts";
import { agentOperations, guardToml, whatsappGuardDef, whatsappSpec } from "../generate/guards.ts";
import { STANDIN_PROVIDER_AUTHORIZATION } from "../agent/guard-process.ts";
import { BINARY, credential, skipWithoutBinary, startRealGuard } from "./real-guard.ts";
import { startMetaTemplateStandin } from "../../modules/standins/meta-templates.ts";
import { startGupshupTemplateStandin } from "../../modules/standins/gupshup-templates.ts";
import { guardCall, gupshupProvider, metaProvider, readEntries, run, select } from "../lib/wa-templates.ts";

const WABA = "102290129340398";
const PHONE = "100000000000001";
const APP = "11111111-aaaa-bbbb-cccc-222222222222";
const ID = { tenant: "glow-salon", name: "glow-salon-whatsapp", version: 1, reviewedBy: "builder-arjun" };
const ORDERS = new URL("../../templates/commerce/orders/", import.meta.url).pathname;
const metaOne = () => { const e = readEntries(ORDERS).find((x) => x.name === "order_confirmed" && x.language === "kn")!; return { name: e.name, language: e.language, category: e.category, parameter_format: e.parameter_format, components: e.components }; };
const two = () => select(readEntries(ORDERS), { languages: ["en"], only: ["order_confirmed", "order_hold_ended"] });

test("the spec has template routes only when the account is named, and only the panel's agent may use them", () => {
  const plain = whatsappSpec(ID, { phoneNumberId: PHONE, messagesPerHour: 200 });
  assert.ok(!JSON.stringify(plain).includes("template"), "no account id, no template route: every other shop's spec is as it was");
  assert.deepEqual(agentOperations("whatsapp", plain), { panel: ["read_number"] }, "and its agents' lists are as they were");
  const meta = whatsappSpec(ID, { phoneNumberId: PHONE, messagesPerHour: 200, wabaId: WABA });
  assert.deepEqual(agentOperations("whatsapp", meta), { runtime: ["send", "read_number"], panel: ["read_number", "list_templates", "submit_template"] });
  const gs = whatsappSpec(ID, { phoneNumberId: "919876543210", messagesPerHour: 200, route: { provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: "919876543210", appId: APP } });
  assert.deepEqual(agentOperations("whatsapp", gs), { runtime: ["send", "read_number"], panel: ["read_number", "submit_template"] });
  const gsNoId = whatsappSpec(ID, { phoneNumberId: "919876543210", messagesPerHour: 200, route: { provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: "919876543210" } });
  assert.deepEqual(agentOperations("whatsapp", gsNoId), { panel: ["read_number"] }, "no app id: Gupshup's create call cannot be made, so there is no route for it");
});

test("Meta direct through the real Guard: the panel lists and submits in the shop's own account, the runtime cannot submit, another account is refused", { skip: skipWithoutBinary }, async () => {
  const meta = await startMetaTemplateStandin({ wabaId: WABA, token: STANDIN_PROVIDER_AUTHORIZATION });
  const spec = whatsappSpec(ID, { phoneNumberId: PHONE, messagesPerHour: 200, wabaId: WABA });
  const ops = agentOperations("whatsapp", spec);
  const runtime = credential(); const panel = credential();
  const guard = await startRealGuard({ def: whatsappGuardDef(), spec, tenant: ID.tenant, deployment: "glow-salon-whatsapp", upstreamPort: Number(new URL(meta.url).port),
    agents: [{ id: "runtime-glow-salon", token: runtime.token, operations: ops.runtime }, { id: "panel-glow-salon", token: panel.token, operations: ops.panel }] });
  try {
    const sent = await run({ entries: two(), provider: metaProvider(guardCall(guard.agentUrl, panel.token), WABA), mode: "submit" });
    assert.equal(sent.code, 0, sent.lines.join("\n"));
    assert.equal(sent.sent, 2);
    assert.equal(meta.created.length, 2);
    assert.ok(meta.created.every((c) => c.authorization === STANDIN_PROVIDER_AUTHORIZATION), "the Guard added the key; the panel sent none");
    assert.deepEqual(Object.keys(meta.created[0].body).sort(), ["category", "components", "language", "name", "parameter_format"], "Meta's five fields, through the Guard's body check");
    const again = await run({ entries: two(), provider: metaProvider(guardCall(guard.agentUrl, panel.token), WABA), mode: "submit" });
    assert.equal(again.sent, 0, "the list came back through the Guard, so nothing is sent twice");
    // the runtime's own credential: its send and read are as before, a template is refused by the Guard and never reaches Meta
    const asRuntime = await run({ entries: select(readEntries(ORDERS), { languages: ["hi"], only: ["order_confirmed"] }), provider: metaProvider(guardCall(guard.agentUrl, runtime.token), WABA), mode: "submit" });
    assert.equal(asRuntime.stopped?.kind, "guard", asRuntime.lines.join("\n"));
    // and a create straight from the runtime's credential, without the list first: denied by the Guard and not sent (the count below), never reaching Meta. The Guard of
    // 15 Nov answers an operation outside the agent's list with HTTP 500 "internal error in the Guard" and decision "deny", not a 403 (reported to the monorepo).
    const post = await fetch(`${guard.agentUrl}/v26.0/${WABA}/message_templates`, { method: "POST", headers: { authorization: `Bearer ${runtime.token}`, "content-type": "application/json" }, body: JSON.stringify(metaOne()) });
    const denied = await post.json() as { guard?: { decision?: string; sent?: string } };
    assert.ok(post.status >= 400 && denied.guard?.decision === "deny" && denied.guard.sent === "no", JSON.stringify(denied));
    // another account than the shop's: refused by the exact rule, for the panel too
    const other = await run({ entries: two(), provider: metaProvider(guardCall(guard.agentUrl, panel.token), "999999999999"), mode: "status" });
    assert.equal(other.stopped?.kind, "guard", other.lines.join("\n"));
    assert.equal(meta.created.length, 2, "nothing else reached Meta");
  } finally { await guard.stop(); await meta.close(); }
});

test("Gupshup self-serve through the real Guard: the panel submits to the shop's own app (a form post) and reads the app's list", { skip: skipWithoutBinary }, async () => {
  const g = await startGupshupTemplateStandin({ appId: APP, apikey: STANDIN_PROVIDER_AUTHORIZATION });
  const route = { provider: "gupshup-selfserve" as const, appName: "Glow_Salon", sourceNumber: "919876543210", appId: APP };
  const spec = whatsappSpec(ID, { phoneNumberId: "919876543210", messagesPerHour: 200, route });
  const ops = agentOperations("whatsapp", spec);
  const runtime = credential(); const panel = credential();
  const guard = await startRealGuard({ def: whatsappGuardDef(route), spec, tenant: ID.tenant, deployment: "glow-salon-whatsapp", upstreamPort: Number(new URL(g.url).port),
    agents: [{ id: "runtime-glow-salon", token: runtime.token, operations: ops.runtime }, { id: "panel-glow-salon", token: panel.token, operations: ops.panel }] });
  try {
    const sent = await run({ entries: two(), provider: gupshupProvider(guardCall(guard.agentUrl, panel.token), route), mode: "submit" });
    assert.equal(sent.code, 0, sent.lines.join("\n"));
    assert.equal(g.created.length, 2);
    assert.ok(g.created.every((c) => c.apikey === STANDIN_PROVIDER_AUTHORIZATION && c.appId === APP));
    const status = await run({ entries: two(), provider: gupshupProvider(guardCall(guard.agentUrl, panel.token), route), mode: "status" });
    assert.match(status.lines.join("\n"), /order_confirmed \(en\): submitted/u);
    const asRuntime = await run({ entries: select(readEntries(ORDERS), { languages: ["hi"], only: ["order_confirmed"] }), provider: gupshupProvider(guardCall(guard.agentUrl, runtime.token), route), mode: "submit" });
    assert.equal(asRuntime.stopped?.kind, "guard", asRuntime.lines.join("\n"));
    assert.equal(g.created.length, 2);
  } finally { await guard.stop(); await g.close(); }
});

test("the real Guard compiles both template specs, and their tripwires hold with the agents' operation lists in guard.toml (a deploy and go-live's 'every limit proven' need it)", { skip: skipWithoutBinary }, () => {
  const specs = [
    { spec: whatsappSpec(ID, { phoneNumberId: PHONE, messagesPerHour: 200, wabaId: WABA }), def: whatsappGuardDef(), upstream: "graph.facebook.com:443" },
    (() => { const route = { provider: "gupshup-selfserve" as const, appName: "Glow_Salon", sourceNumber: "919876543210", appId: APP }; return { spec: whatsappSpec(ID, { phoneNumberId: "919876543210", messagesPerHour: 200, route }), def: whatsappGuardDef(route), upstream: "api.gupshup.io:443" }; })(),
  ];
  for (const { spec, def, upstream } of specs) {
    const dir = mkdtempSync(join(tmpdir(), "geo-wa-templates-"));
    try {
      writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
      const compiled = JSON.parse(execFileSync(BINARY, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8" })) as { digest: string; tripwires: { passed: number; of: number } };
      assert.equal(compiled.tripwires.passed, compiled.tripwires.of, `${upstream}: every tripwire passes`);
      const ops = agentOperations("whatsapp", spec);
      const toml = guardToml({ def, tenant: ID.tenant, deployment: "glow-salon-whatsapp", bundleDigest: compiled.digest, upstream: { host: upstream, tls: true }, adminSha: "b".repeat(64),
        agents: [{ id: "runtime-glow-salon", sha: "c".repeat(64), operations: ops.runtime }, { id: "panel-glow-salon", sha: "d".repeat(64), operations: ops.panel }] });
      writeFileSync(join(dir, "guard.toml"), toml);
      assert.match(execFileSync(BINARY, ["verify-bundle", join(dir, "bundle.json"), "--config", join(dir, "guard.toml")], { encoding: "utf8" }), /tripwires: passed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("deployed, a Meta-direct shop with its WhatsApp Business Account id: the Guard has the template routes, guard.toml lists each agent's operations, and the runtime's own config never carries the id", async () => {
  const shop = panelRuntime({ services: { payments: {}, calendar: { calendarId: "glow@example.com" }, messaging: { phoneNumberId: "100000000000001", wabaId: WABA }, timeoutMs: 20_000 } as never });
  const w = world({ "glow-salon": shop }, { panel: { enabled: true } });
  try {
    w.handIn("glow-salon");
    const [r] = await deploy(w.ctx);
    assert.equal(r.shop, "glow-salon");
    const spec = JSON.parse(read(join(w.paths.generated, "guards", "g-glow-salon-whatsapp", "spec.json")));
    assert.ok(spec.routes.some((x: { operation: string; path: string }) => x.operation === "submit_template" && x.path === "/{version}/{waba_id}/message_templates"));
    assert.ok(spec.rules.some((x: { operation: string; allowed_values: string[] }) => x.operation === "submit_template" && x.allowed_values[0] === WABA));
    const toml = read(join(w.paths.generated, "guards", "g-glow-salon-whatsapp", "guard.toml"));
    assert.match(toml, /id = "runtime-glow-salon"\n[^\[]*operations = \["send", "read_number"\]/u, "the runtime may send and read, and not make templates");
    assert.match(toml, /id = "panel-glow-salon"\n[^\[]*operations = \["read_number", "list_templates", "submit_template"\]/u);
    const other = read(join(w.paths.generated, "guards", "g-glow-salon-razorpay", "guard.toml"));
    assert.doesNotMatch(other, /template/u, "another Guard of the shop is as it was");
    const runtime = JSON.parse(read(join(w.paths.generated, "shops", "glow-salon", "client", "runtime.json")));
    assert.equal(runtime.services.messaging.wabaId, undefined, "the runtime never sees the account id");
    assert.equal(runtime.services.messaging.phoneNumberId, "100000000000001");
  } finally { w.done(); }
});
