// The WhatsApp Guard's template routes (25 Nov 2026) on the REAL geo-guard program, in front of the template stand-ins: the panel's agent lists and submits a shop's
// templates in the shop's own account (the Guard adds the key), the runtime's agent cannot submit one, and an account other than the shop's is refused. Meta direct
// (the WhatsApp Business Account id) and Gupshup self-serve (the app id) both. Without the built program the test says it was skipped and why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentOperations, whatsappGuardDef, whatsappSpec } from "../generate/guards.ts";
import { STANDIN_PROVIDER_AUTHORIZATION } from "../agent/guard-process.ts";
import { credential, skipWithoutBinary, startRealGuard } from "./real-guard.ts";
import { startMetaTemplateStandin } from "../../modules/standins/meta-templates.ts";
import { startGupshupTemplateStandin } from "../../modules/standins/gupshup-templates.ts";
import { guardCall, gupshupProvider, metaProvider, readEntries, run, select } from "../lib/wa-templates.ts";

const WABA = "102290129340398";
const PHONE = "100000000000001";
const APP = "11111111-aaaa-bbbb-cccc-222222222222";
const ID = { tenant: "glow-salon", name: "glow-salon-whatsapp", version: 1, reviewedBy: "builder-arjun" };
const ORDERS = new URL("../../templates/commerce/orders/", import.meta.url).pathname;
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
