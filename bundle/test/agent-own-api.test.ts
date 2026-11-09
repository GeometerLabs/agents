// B71 step 6: an agent someone else wrote takes money through its own gateway's API, which has no module in modules/payments/providers. Its Guard's spec is the
// one the builder reviewed with the companies kit (companies/openapi-to-spec.ts), built from the kit's two files on every plan; the rest is the same checked
// deploy as any agent's. The kit's own example (companies/examples/refunds-api) is the API, and the agent is called after its tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addAgent, deployAgent } from "../agent/deploy.ts";
import { agentFromFlags, readAgent } from "../agent/folder.ts";
import type { AgentFlags } from "../agent/folder.ts";
import { planAgent } from "../agent/plan.ts";
import { planCrashTest } from "../agent/crash-test/run.ts";
import { Refused } from "../deploy.ts";
import { slotOf } from "../generate/compose.ts";
import { OWN_API_SECRET } from "../lib/secrets.ts";
import { PHONE_NUMBER_ID, serverConfig, tempServer } from "./helpers.ts";
import { read, secretsFor, world } from "./world.ts";
import { credential, skipWithoutBinary, startRealGuard } from "./real-guard.ts";
import { agentNames } from "../agent/plan.ts";

const NOW = new Date("2026-11-10T09:00:00Z");
const NAME = "brightside"; // the example accept file's tenant
const KIT = new URL("../../companies/examples/refunds-api/", import.meta.url);
const DRAFT = readFileSync(new URL("draft.json", KIT), "utf8");
const ACCEPT_WITH_HOLD = readFileSync(new URL("accept.json", KIT), "utf8");
/** The kit's example as a builder would keep it here: the same, without the rule that holds a refund for a person. */
const ACCEPT = (() => { const a = JSON.parse(ACCEPT_WITH_HOLD); a.suggestions["create_refund-needs-approval"].keep = false; return `${JSON.stringify(a, null, 2)}\n`; })();
const FILES: Record<string, string> = { "draft.json": DRAFT, "accept.json": ACCEPT, "held.json": ACCEPT_WITH_HOLD, "edited-draft.json": DRAFT.replace('"refunds"', '"refundz"') };
const readFile = (path: string): string => { if (!(path in FILES)) throw new Error(`no file ${path}`); return FILES[path]; };
const flags = (change: AgentFlags = {}): AgentFlags => ({
  upstreams: "own-api,whatsapp", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID,
  "gateway-draft": "draft.json", "gateway-accept": "accept.json", "gateway-upstream": "api.brightside.example:443", ...change,
});

test("B71 step 6: an own gateway API is added from the companies kit's two files, and asked for them by name; a held rule and an edited draft are refused before anything is written", () => {
  const made = agentFromFlags(NAME, flags(), readFile, NOW);
  assert.deepEqual(made.agent.upstreams, ["own-api", "whatsapp"]);
  assert.deepEqual(made.agent.ownApi, { upstream: "api.brightside.example:443" });
  assert.deepEqual(made.settings.payment, { module: "own-api" });
  assert.deepEqual(made.ownApi, { draftText: DRAFT, acceptText: ACCEPT }, "the kit's files, byte for byte: the accept file names the draft by its hash");
  const throws = (change: AgentFlags, message: RegExp) => assert.throws(() => agentFromFlags(NAME, flags(change), readFile, NOW), message);
  throws({ "gateway-accept": undefined }, /needs the reviewed rules for it\. Make them with the companies kit/u);
  throws({ "gateway-upstream": "https://api.brightside.example" }, /--gateway-upstream must be host:port/u);
  throws({ "upi-id": "x@okicici", payee: "X" }, /leave out --upi-id and --payee/u);
  throws({ upstreams: "own-api,razorpay,whatsapp" }, /exactly one of upi, razorpay, own-api/u);
  assert.throws(() => agentFromFlags(NAME, { ...flags(), upstreams: "razorpay,whatsapp", "gateway-upstream": undefined, "gateway-draft": undefined }, readFile, NOW), /are for an agent whose --upstreams name own-api/u);
  // a template shop can never choose it: only an agent folder reads "own-api"
  const t = tempServer({});
  try {
    assert.throws(() => addAgent(t.root, NAME, flags({ "gateway-accept": "held.json" }), readFile, NOW), /keeps "create_refund-needs-approval", which holds create_refund for a person's approval\. Geometer asks the owner only about refunds on a gateway it has a module for/u);
    assert.throws(() => addAgent(t.root, NAME, flags({ "gateway-draft": "edited-draft.json" }), readFile, NOW), /made for a different draft/u);
    assert.throws(() => readFileSync(join(t.paths.agent(NAME), "agent.json")), /ENOENT/u, "nothing was written");
    addAgent(t.root, NAME, flags(), readFile, NOW);
    const folder = readAgent(t.root, NAME);
    assert.deepEqual(folder.problems, []);
    assert.deepEqual(folder.ownApi, { draftText: DRAFT, acceptText: ACCEPT });
  } finally { t.done(); }
});

test("B71 step 6: the plan is the kit's spec with the deployment's identity, behind a Guard of its own with one credential file; the payment slot is its address", () => {
  const t = tempServer({});
  try {
    addAgent(t.root, NAME, flags(), readFile, NOW);
    const plan = planAgent(serverConfig(), readAgent(t.root, NAME));
    assert.deepEqual(plan.problems, []);
    assert.equal(plan.desk, undefined, "a Guard, not the desk: the API confirms payments itself");
    assert.deepEqual(plan.guards.map((g) => g.kind), ["own-api", "whatsapp"]);
    const g = plan.guards[0];
    const kit = JSON.parse(readFileSync(new URL("spec.json", KIT), "utf8"));
    assert.deepEqual([g.spec.tenant, g.spec.name, g.spec.version, g.spec.tool], [NAME, `${NAME}-own-api`, 1, "refunds"], "the deployer's identity; the kit's tool");
    assert.deepEqual((g.spec as any).routes, kit.routes, "the routes the builder kept, exactly");
    assert.deepEqual((g.spec as any).rules, kit.rules.filter((r: { kind: string }) => r.kind !== "call_bound_approval"), "the rules the builder kept, exactly");
    assert.deepEqual((g.spec as any).limits, kit.limits);
    assert.equal((g.spec as any).reviewed_by, "priya.nair", "the reviewer's own name stays");
    assert.deepEqual([g.def.tool, g.def.upstream, g.def.secretFile, g.def.headers], ["refunds", "api.brightside.example:443", OWN_API_SECRET, { Authorization: `\${file:/run/secrets/${OWN_API_SECRET}}` }]);
    assert.equal(g.service, `g-${NAME}-own-api`);
    assert.equal(slotOf("own-api"), slotOf("razorpay"), "one way to take money, one address slot");
    // the accept file changed on disk: the next plan builds from it, so an edit the kit would refuse is refused here as well
    writeFileSync(join(t.paths.agent(NAME), "gateway-draft.json"), FILES["edited-draft.json"]);
    assert.match(planAgent(serverConfig(), readAgent(t.root, NAME)).problems.map((p) => p.message).join(" "), /made for a different draft/u);
  } finally { t.done(); }
});

test("B71 step 6: deploy needs the API's own key, keeps it in the Guard's folder only, and no file written beside the Guard holds it; the crash test says it cannot run", async () => {
  const w = world({}); try {
    addAgent(w.root, NAME, flags(), readFile, NOW);
    const { whatsapp_token, whatsapp_app_secret, whatsapp_verify_token } = secretsFor(NAME);
    w.handIn(NAME, { whatsapp_token, whatsapp_app_secret, whatsapp_verify_token });
    const missing = await (async () => { try { await deployAgent(w.ctx, NAME); } catch (e) { if (e instanceof Refused) return e.problems; throw e; } assert.fail("it should have been refused"); })();
    assert.ok(missing.some((p) => p.rule === "secret-missing:gateway_authorization"), JSON.stringify(missing));
    const key = "Bearer sk_live_brightside_0123456789";
    w.handIn(NAME, { gateway_authorization: key });
    const r = await deployAgent(w.ctx, NAME);
    assert.equal(r.connection.baseUrls["own-api"], `https://shops.example.com/g/${NAME}/own-api`);
    assert.equal(read(join(w.paths.secrets, `g-${NAME}-own-api`, OWN_API_SECRET)).trim(), key, "used as handed in: the whole header");
    const toml = read(join(w.paths.generated, "guards", `g-${NAME}-own-api`, "guard.toml"));
    const spec = read(join(w.paths.generated, "guards", `g-${NAME}-own-api`, "spec.json"));
    for (const f of [toml, spec, read(join(w.paths.generated, "compose.yaml"))]) assert.ok(!f.includes("sk_live_brightside"), "the API's key is in no generated file");
    assert.match(toml, /tool = "refunds"/u);
    assert.doesNotMatch(toml, /\[\[approvers\]\]/u, "no approver: no rule of this Guard waits for a person");
    await assert.rejects(() => planCrashTest(w.ctx, NAME, { run: "true" }), /the crash test has no stand-in for it, so it cannot run/u);
  } finally { w.done(); }
});

test("B71 step 6: the real Guard runs the planned spec and enforces what the builder kept: a forbidden call and a refund above the bound are refused before the API is called", { skip: skipWithoutBinary }, async () => {
  const t = tempServer({});
  try {
    addAgent(t.root, NAME, flags(), readFile, NOW);
    const g = planAgent(serverConfig(), readAgent(t.root, NAME)).guards.find((x) => x.kind === "own-api")!;
    const agent = credential();
    const real = await startRealGuard({ def: g.def, spec: g.spec, tenant: NAME, deployment: g.deployment, upstreamPort: 9, agents: [{ id: agentNames.agentId(NAME), token: agent.token }] });
    try {
      const post = (path: string, body: unknown) => fetch(`${real.agentUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${agent.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const transfer = await post("/v1/transfers", { amount: 100, from_account_id: "a", to_account_id: "b" });
      assert.equal(transfer.status, 403, await transfer.text());
      const tooMuch = await post("/v1/refunds", { charge_id: "ch_1", amount: 50_001 });
      assert.equal(tooMuch.status, 403, await tooMuch.text());
    } finally { await real.stop(); }
  } finally { t.done(); }
});
