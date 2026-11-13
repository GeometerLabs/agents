// `geometer agent add`: an agent someone else wrote, behind the same Guards. The flags make the same settings file a template uses; the Guard specs are byte-for-byte the template's;
// the compose file puts the Guards on their own `gate` network with Caddy and nothing else; and a shop's deploy never takes an agent's Guards away.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOSTED_AGENT_REFUSAL, addAgent, connectionOf, connectionText, deployAgent } from "../agent/deploy.ts";
import { agentFromFlags, readAgent } from "../agent/folder.ts";
import type { AgentFlags } from "../agent/folder.ts";
import { planAgent } from "../agent/plan.ts";
import { recordAgent } from "../agent/records.ts";
import { AGENT_RECORD_EVERY_MS, applyOnce, runDueJobs } from "../apply.ts";
import { Refused, deploy } from "../deploy.ts";
import { ok } from "../lib/runner.ts";
import { agentBaseUrl, caddyfile, composeServer } from "../generate/compose.ts";
import type { AgentDeploy, ShopDeploy } from "../generate/compose.ts";
import { names, planShop } from "../generate/shop.ts";
import { readShop } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { sha256Hex } from "../lib/util.ts";
import { CALENDAR_ID, EXAMPLE_CLIENT, PHONE_NUMBER_ID, panelRuntime, serverConfig, tempServer } from "./helpers.ts";
import { composeCalls, read, secretsFor, world } from "./world.ts";

const NOW = new Date("2026-11-05T09:00:00Z");
const noFiles = (path: string): string => { throw new Error(`no file ${path}`); };
const flags = (change: AgentFlags = {}): AgentFlags => ({ upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID, ...change });
const agentSecrets = (): Record<string, string> => { const s = secretsFor("x"); return { razorpay_key: s.razorpay_key, whatsapp_token: s.whatsapp_token, whatsapp_app_secret: s.whatsapp_app_secret, whatsapp_verify_token: s.whatsapp_verify_token, "google_service_account.json": s["google_service_account.json"] }; };
const refusedWith = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof Refused) return e.problems; throw e; } assert.fail("it should have been refused"); };

test("agent add from flags makes the same settings a template uses, checked by the same validator, and says in plain words what is missing", () => {
  const made = agentFromFlags("my-agent", flags(), noFiles, NOW);
  assert.equal(made.settings.deposit.amountInr, 200);
  assert.equal(made.settings.cancellation.refundLimitInr, 100);
  assert.equal(made.settings.owner.whatsapp, "+919800000001");
  assert.deepEqual(made.agent.upstreams, ["razorpay", "whatsapp", "calendar"]);
  assert.equal(made.agent.whatsapp?.phoneNumberId, PHONE_NUMBER_ID);
  const throws = (change: AgentFlags, message: RegExp) => assert.throws(() => agentFromFlags("my-agent", flags(change), noFiles, NOW), message);
  throws({ upstreams: "razorpay,calendar" }, /--upstreams must include whatsapp/);
  throws({ upstreams: "razorpay,whatsapp,stripe" }, /don't know the service "stripe"/);
  throws({ deposit: undefined }, /Say the deposit and the refund limit/);
  throws({ "owner-whatsapp": undefined }, /Say the owner's WhatsApp number/);
  throws({ deposit: "2.5" }, /--deposit must be a whole number/);
  throws({ "whatsapp-number-id": undefined }, /Say the shop's own WhatsApp phone number id/);
  throws({ "calendar-id": undefined }, /Say the shop's own Google calendar/);
  throws({ hours: "all day" }, /--hours must look like 10:00-20:00/);
  throws({ "refunds-per-day": "0" }, /must be at least 1/);
  throws({ "owner-whatsapp": "call me" }, /These settings need fixing/);
  // a settings file in the templates' format is taken whole
  const fromFile = agentFromFlags("my-agent", { upstreams: "razorpay,whatsapp", settings: "s.json", "whatsapp-number-id": PHONE_NUMBER_ID }, () => readFileSync(join(EXAMPLE_CLIENT, "settings.json"), "utf8"), NOW);
  assert.equal(fromFile.settings.name, "Glow Salon");
  assert.equal(fromFile.agent.calendar, undefined, "no calendar was asked for, so none is pinned");
  assert.throws(() => agentFromFlags("my-agent", { upstreams: "razorpay,whatsapp", settings: "s.json", "whatsapp-number-id": PHONE_NUMBER_ID }, () => '{"name": ""}', NOW), /The settings file needs fixing/);
});

test("B71: an agent takes UPI by default, through the desk: no gateway Guard (the desk's own Guard instead, part 2), the shop's own UPI ID asked for, and one payment module only", () => {
  const upi = { "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID } as AgentFlags;
  assert.throws(() => agentFromFlags("my-agent", upi, noFiles, NOW), /Say where this shop's customers pay\. UPI needs no gateway account: --upi-id/u, "UPI is the default, and its ID is asked for");
  const made = agentFromFlags("my-agent", { ...upi, "upi-id": "GlowSalon@OKICICI", payee: "Glow Salon" }, noFiles, NOW);
  assert.deepEqual(made.agent.upstreams, ["upi", "whatsapp", "calendar"]);
  assert.deepEqual(made.settings.payment, { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } });
  assert.throws(() => agentFromFlags("my-agent", { ...upi, upstreams: "upi,razorpay,whatsapp" }, noFiles, NOW), /exactly one of upi, razorpay/u);
  assert.throws(() => agentFromFlags("my-agent", { ...upi, upstreams: "upi,calendar", "upi-id": "glowsalon@okicici", payee: "Glow Salon" }, noFiles, NOW), /to mark each payment received/u);
  assert.throws(() => agentFromFlags("my-agent", { ...upi, upstreams: "razorpay,whatsapp,calendar", "upi-id": "glowsalon@okicici", payee: "Glow Salon" }, noFiles, NOW), /leave out --upi-id and --payee/u);
  const t = tempServer({});
  try {
    addAgent(t.root, "upi-agent", { ...upi, "upi-id": "glowsalon@okicici", payee: "Glow Salon" }, noFiles, NOW);
    const plan = planAgent(serverConfig(), readAgent(t.root, "upi-agent"));
    assert.deepEqual(plan.problems, []);
    assert.deepEqual(plan.guards.map((g) => g.kind), ["upi", "whatsapp", "calendar"], "UPI has no API on the internet: its Guard is in front of the desk (B71 part 2)");
    assert.equal(plan.guards[0].def.upstream, "relay:8796");
    assert.deepEqual(plan.guards[0].upstream, { host: "relay:8796", tls: false }, "the desk is on the server's own network: plain HTTP, no certificate to check");
    assert.deepEqual(plan.desk, { module: "upi" });
  } finally { t.done(); }
});

test("the same settings give the same Guard specs, byte for byte, whether a template or an agent someone else wrote is behind them", () => {
  const t = tempServer({ "glow-salon": panelRuntime() }); const u = tempServer({});
  try {
    const server = serverConfig();
    const template = planShop(server, readShop(t.root, "glow-salon"));
    assert.deepEqual(template.problems, []);
    addAgent(u.root, "glow-salon", flags({ settings: join(EXAMPLE_CLIENT, "settings.json") }), (p) => readFileSync(p, "utf8"), NOW);
    const agent = planAgent(server, readAgent(u.root, "glow-salon"));
    assert.deepEqual(agent.problems, []);
    assert.deepEqual(agent.guards.map((g) => g.kind), ["razorpay", "whatsapp", "calendar"]);
    for (const g of agent.guards) assert.equal(g.specText, template.guards.find((x) => x.kind === g.kind)!.specText, `${g.kind}: the same bytes`);
  } finally { t.done(); u.done(); }
});

test("caps from the agent's file reach the specs, and a cap that would make an approved refund fail is refused when the agent is planned", () => {
  const u = tempServer({});
  try {
    const server = serverConfig();
    addAgent(u.root, "capped", flags({ "refund-inr-per-day": "500", "refunds-per-day": "3", "links-per-hour": "7", "messages-per-hour": "11" }), noFiles, NOW);
    const plan = planAgent(server, readAgent(u.root, "capped"));
    const limits = (kind: string) => Object.fromEntries((plan.guards.find((g) => g.kind === kind)!.spec.limits as { id: string; cap: string }[]).map((l) => [l.id, l.cap]));
    assert.deepEqual(limits("razorpay"), { "refund-paise-per-day": "50000", "refunds-per-day": "3", "links-per-hour": "7" });
    assert.equal(limits("whatsapp")["messages-per-hour"], "11");
    addAgent(u.root, "too-low", flags({ "refund-inr-per-day": "100" }), noFiles, NOW); // a deposit is ₹200
    assert.match(planAgent(server, readAgent(u.root, "too-low")).problems[0].message, /daily refund cap .* is smaller than one deposit/);
  } finally { u.done(); }
});

test("decision 55: no custom agent runs on Geometer's partner server (panel mode hosted): agent add refuses it; a builder's own server takes it", () => {
  const hosted = tempServer({}, { panel: { enabled: true, mode: "hosted" } });
  try {
    assert.throws(() => addAgent(hosted.root, "my-agent", flags(), noFiles, NOW), (e: Error) => e.message === HOSTED_AGENT_REFUSAL);
    assert.equal(existsSync(hosted.paths.agent("my-agent")), false, "nothing was written");
  } finally { hosted.done(); }
  const own = tempServer({}, { panel: { enabled: true, mode: "own" } });
  try { addAgent(own.root, "my-agent", flags(), noFiles, NOW); } finally { own.done(); }
});

test("a name is used once: an agent cannot take a shop's name, or another agent's", () => {
  const t = tempServer({ "glow-salon": panelRuntime() });
  try {
    assert.throws(() => addAgent(t.root, "glow-salon", flags(), noFiles, NOW), /already a shop called glow-salon/);
    addAgent(t.root, "my-agent", flags(), noFiles, NOW);
    assert.throws(() => addAgent(t.root, "my-agent", flags(), noFiles, NOW), /already an agent called my-agent/);
    assert.throws(() => addAgent(t.root, "My Agent", flags(), noFiles, NOW), /not a usable agent name/);
    // one credential per Guard, made when the agent is added (12 Nov 2026), and the file that hands them to the agent
    const credentials = ["razorpay", "whatsapp", "calendar"].map((k) => read(join(t.paths.secrets, "agents", "my-agent", `${k}_token`)).trim());
    for (const c of credentials) assert.match(c, /^gg_[0-9a-f]{32}$/u);
    assert.equal(new Set(credentials).size, 3, "each Guard has its own");
    assert.equal(existsSync(join(t.paths.secrets, "agents", "my-agent", "agent_token")), false, "no shared credential for a new agent");
    const env = read(join(t.paths.secrets, "agents", "my-agent", "credentials.env"));
    assert.ok(env.includes(`GEOMETER_RAZORPAY_URL=https://shops.example.com/g/my-agent/razorpay\nGEOMETER_RAZORPAY_CREDENTIAL=${credentials[0]}`), "the file holds each Guard's address and credential, in the names the crash test uses");
    assert.ok(!env.includes("GEOMETER_CREDENTIAL="), "no shared name for an agent whose Guards each have their own");
    const text = connectionText("my-agent", connectionOf(t.root, serverConfig(), readAgent(t.root, "my-agent")));
    for (const kind of ["razorpay", "whatsapp", "calendar"]) assert.ok(text.includes(`https://shops.example.com/g/my-agent/${kind}`), `${kind}'s address is printed`);
    assert.ok(text.includes("https://shops.example.com/c/my-agent/webhooks/whatsapp") && text.includes("secrets/agents/my-agent/credentials.env"), "it says where the credentials are");
    for (const c of credentials) assert.ok(!text.includes(c), "and never prints one");
  } finally { t.done(); }
});

// ---- the compose file ----------------------------------------------------------------------------------------------------------------------------

const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence" };
const shopDeploy = (name: string, index: number): ShopDeploy => ({ name, index, pathwayDir: "/repo/templates/commerce/bookings", guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard(name, kind), tenant: name })) });
const agentDeploy = (name: string, index: number, kinds: ("razorpay" | "whatsapp" | "calendar")[] = ["razorpay", "whatsapp", "calendar"]): AgentDeploy => ({ name, index, guards: kinds.map((kind) => ({ kind, service: names.guard(name, kind), tenant: name })) });
const nets = (c: ReturnType<typeof composeServer>, svc: string): string[] => { const n = c.services[svc].block.networks as Record<string, unknown> | undefined; return n === undefined ? [] : Object.keys(n); };

test("an agent's Guards are on the gate network with Caddy and nothing else; the agent has no runtime, door or model Guard, and the shops' networks are as they were", () => {
  const server = serverConfig();
  const plain = composeServer(server, dirs, [shopDeploy("glow-salon", 1)], {});
  const withAgent = composeServer(server, dirs, [shopDeploy("glow-salon", 1)], { agents: [agentDeploy("my-agent", 2)] });
  const members = (c: typeof withAgent, net: string) => Object.keys(c.services).filter((s) => nets(c, s).includes(net)).sort();
  assert.deepEqual(members(withAgent, "gate"), ["caddy", "fwd-my-agent-calendar", "fwd-my-agent-razorpay", "fwd-my-agent-whatsapp"]);
  assert.match(withAgent.compose, /\n  gate:\n    internal: true/, "the gate has no way out");
  assert.deepEqual(nets(withAgent, "caddy").sort(), ["front", "gate"]);
  assert.deepEqual(nets(withAgent, "fwd-my-agent-razorpay").sort(), ["admin", "egress", "gate"], "a Guard reaches its service (egress), the deployer's way in (admin) and Caddy (gate)");
  assert.ok(!Object.keys(withAgent.services).some((s) => s === "rt-my-agent" || s === "door-my-agent"), "nothing of ours runs the agent");
  assert.deepEqual((withAgent.services["fwd-my-agent-razorpay"].block.networks as Record<string, { aliases?: string[] }>).gate.aliases, ["g-my-agent-razorpay"]);
  assert.equal(withAgent.services["g-my-agent-razorpay"].block.network_mode, "service:fwd-my-agent-razorpay");
  assert.deepEqual(nets(withAgent, "fwd-model").sort(), ["admin", "egress", "net-glow-salon"], "the model Guard is still the shops' alone");
  assert.deepEqual(nets(withAgent, "caddy").includes("net-my-agent"), false);
  assert.deepEqual(members(withAgent, "front"), members(plain, "front"), "nothing else joined the front network");
  // the addresses on the admin network are the agent's own
  const ips = Object.keys(withAgent.services).filter((s) => s.startsWith("fwd-")).map((s) => ((withAgent.services[s].block.networks as Record<string, { ipv4_address?: string }>).admin).ipv4_address);
  assert.equal(new Set(ips).size, ips.length, "no two share an address");
  // a server without agents is the server it was: no gate, no route
  assert.doesNotMatch(plain.compose, /gate/u);
  assert.doesNotMatch(plain.caddyfile, /\/g\//u);
  assert.deepEqual(nets(plain, "caddy"), ["front"]);
  assert.equal(plain.caddyfile, caddyfile(server, [], ["glow-salon"]), "an agent adds a path for each of its Guards and changes nothing else in the Caddyfile");
  // the Caddyfile sends each Guard its own path, with the prefix cut off, and nothing else
  assert.match(withAgent.caddyfile, /handle_path \/g\/my-agent\/razorpay\/\* \{\n\t\treverse_proxy g-my-agent-razorpay:8080\n\t\}/);
  assert.equal([...withAgent.caddyfile.matchAll(/handle_path/gu)].length, 3);
  assert.equal(agentBaseUrl(server, "my-agent", "razorpay"), "https://shops.example.com/g/my-agent/razorpay");
  assert.equal(agentBaseUrl(serverConfig({ ports: { https: 8443 } }), "my-agent", "whatsapp"), "https://shops.example.com:8443/g/my-agent/whatsapp");
});

test("an agent that calls only some services gets only those Guards and routes", () => {
  const c = composeServer(serverConfig(), dirs, [], { agents: [agentDeploy("calendar-only", 1, ["calendar"])] });
  assert.deepEqual(Object.keys(c.services).filter((s) => s.includes("calendar-only")).sort(), ["fwd-calendar-only-calendar", "g-calendar-only-calendar"]);
  assert.equal([...c.caddyfile.matchAll(/handle_path/gu)].length, 1);
  assert.match(String((c.services["g-calendar-only-calendar"].block.volumes as unknown[]).map((v) => JSON.stringify(v)).join()), /"subpath":"calendar-only"/, "its calendar Guard reads only its own token folder");
});

// ---- deploying -----------------------------------------------------------------------------------------------------------------------------------

test("agent deploy: the same checked deploy, the credential in every Guard, the reading agent limited to reads, and nothing the agent holds is a service's own key", async () => {
  const w = world({}); try {
    const folder = addAgent(w.root, "my-agent", flags(), noFiles, NOW);
    w.handIn("my-agent", agentSecrets());
    const r = await deployAgent(w.ctx, "my-agent");
    assert.equal(r.proven.line, "12 of 12 limits proven to bite (3 cannot be tested without writing, and are not counted)");
    assert.ok(composeCalls(w).some((c) => c[0] === "up"));
    const compose = read(join(w.paths.generated, "compose.yaml"));
    for (const svc of ["g-my-agent-razorpay", "g-my-agent-whatsapp", "g-my-agent-calendar"]) assert.ok(compose.includes(`${svc}:`), `${svc} is in the compose file`);
    assert.ok(!compose.includes("g-model:"), "a server that holds only agents someone else wrote has no model Guard: nothing of ours calls a model for them");
    const status = readStatus(w.root, "my-agent")!;
    assert.deepEqual([status.deploy.state, status.limits?.proven, status.limits?.of, status.versions?.pathway], ["applied", 12, 12, "own-agent"]);
    assert.equal(status.own?.baseUrls.razorpay, "https://shops.example.com/g/my-agent/razorpay");
    assert.equal(status.own?.whatsappWebhook, "https://shops.example.com/c/my-agent/webhooks/whatsapp");
    const credentialOf = (kind: string) => read(join(w.paths.secrets, "agents", "my-agent", `${kind}_token`)).trim();
    const credential = credentialOf("razorpay");
    assert.ok(!JSON.stringify(r.connection).includes(credential), "the connection the commands print holds no credential");
    assert.equal(r.connection.credentials.file, "secrets/agents/my-agent/credentials.env");
    const toml = (kind: string) => read(join(w.paths.generated, "guards", `g-my-agent-${kind}`, "guard.toml"));
    for (const kind of ["razorpay", "whatsapp", "calendar"]) {
      assert.ok(toml(kind).includes(`token_sha256 = "${sha256Hex(credentialOf(kind))}"`), `the agent's own credential for ${kind} is in that Guard (as a hash)`);
      assert.ok(!toml(kind).includes(credentialOf(kind)), "never in the clear");
      for (const other of ["razorpay", "whatsapp", "calendar"].filter((k) => k !== kind)) assert.ok(!toml(kind).includes(sha256Hex(credentialOf(other))), `${other}'s credential opens nothing at ${kind}'s Guard`);
    }
    assert.deepEqual(Object.keys(status.own?.credentials?.guards ?? {}).sort(), ["calendar", "razorpay", "whatsapp"], "the panel is told since when each Guard's credential is in force");
    assert.equal(status.own?.credentials?.shared, false);
    assert.match(toml("razorpay"), /id = "record-my-agent"[^[]*operations = \["list_links", "read_link", "read_payment", "list_refunds"\]/u, "the reading agent can look and cannot refund");
    assert.match(toml("razorpay"), /\[\[approvers\]\]\nid = "owner-my-agent"/u, "the owner is the one who approves a held refund");
    assert.match(toml("whatsapp"), /id = "relay-my-agent"[^[]*operations = \["send"\]/u);
    assert.match(toml("calendar"), /id = "record-my-agent"[^[]*operations = \["list", "get"\]/u);
    // the service's own keys are in the Guards' folders only, and the agent's folder holds nothing but its credential
    assert.match(read(join(w.paths.secrets, "g-my-agent-razorpay", "razorpay_authorization")), /^Basic /);
    assert.deepEqual(existsSync(join(w.paths.secrets, "agents", "my-agent", "razorpay_authorization")), false);
    for (const f of [toml("razorpay"), toml("whatsapp"), compose]) assert.ok(!f.includes("supersecretvalue123") && !f.includes(credential));
    const state = loadState(w.root);
    assert.deepEqual(Object.keys(state.agents!["my-agent"].guards).sort(), ["calendar", "razorpay", "whatsapp"]);
    assert.equal(state.shops["my-agent"], undefined, "an agent is not a shop: the shops' loops (backups, exports, the panel's status) never see it");
    assert.deepEqual(readAgent(w.root, "my-agent").problems, folder.problems);
  } finally { w.done(); }
});

test("deploying a shop afterwards keeps the agent's Guards in the compose file (else up --remove-orphans would take them away), and the agent and the shop do not share an address", async () => {
  const w = world({ "glow-salon": panelRuntime() }); try {
    w.handIn("glow-salon");
    await deploy(w.ctx, "glow-salon");
    addAgent(w.root, "my-agent", flags(), noFiles, NOW);
    w.handIn("my-agent", agentSecrets());
    await deployAgent(w.ctx, "my-agent");
    const before = loadState(w.root);
    assert.notEqual(before.shops["glow-salon"].index, before.agents!["my-agent"].index);
    // the shop changes (a lower refund limit) and is deployed again
    const settings = JSON.parse(readFileSync(join(w.paths.shop("glow-salon"), "settings.json"), "utf8"));
    settings.cancellation.refundLimitInr = 150;
    writeFileSync(join(w.paths.shop("glow-salon"), "settings.json"), JSON.stringify(settings));
    await deploy(w.ctx, "glow-salon");
    const compose = read(join(w.paths.generated, "compose.yaml"));
    for (const svc of ["g-my-agent-razorpay", "fwd-my-agent-whatsapp", "g-glow-salon-razorpay", "rt-glow-salon"]) assert.ok(compose.includes(`${svc}:`), `${svc} is still in the compose file`);
    assert.match(read(join(w.paths.generated, "Caddyfile")), /handle_path \/g\/my-agent\/razorpay\//);
    assert.ok(existsSync(join(w.paths.generated, "guards", "g-my-agent-razorpay", "guard.toml")), "its Guard files are written again");
    assert.deepEqual(loadState(w.root).agents!["my-agent"].index, before.agents!["my-agent"].index, "an address never moves");
    // the model Guard lists the shop's runtime and not the agent
    assert.ok(read(join(w.paths.generated, "guards", "g-model", "guard.toml")).includes("runtime-glow-salon"));
    assert.ok(!read(join(w.paths.generated, "guards", "g-model", "guard.toml")).includes("my-agent"));
  } finally { w.done(); }
});

test("a broken tripwire or a missing key refuses the agent's deploy, names the rule, and starts and writes nothing", async () => {
  const w = world({}); try {
    addAgent(w.root, "my-agent", flags(), noFiles, NOW);
    const missing = await refusedWith(deployAgent(w.ctx, "my-agent"));
    assert.deepEqual(missing.map((p) => p.rule).sort(), ["secret-missing:google_service_account.json", "secret-missing:razorpay_key", "secret-missing:whatsapp_app_secret", "secret-missing:whatsapp_token", "secret-missing:whatsapp_verify_token"]);
    assert.equal(readStatus(w.root, "my-agent")!.deploy.state, "failed");
    w.handIn("my-agent", agentSecrets());
    w.failVerify("g-my-agent-razorpay", ["refund-needs-owner"]);
    const broken = await refusedWith(deployAgent(w.ctx, "my-agent"));
    assert.deepEqual(broken.map((p) => p.rule), ["tripwire:refund-needs-owner"]);
    assert.deepEqual(composeCalls(w), [], "no docker compose command ran");
    assert.ok(!existsSync(join(w.paths.generated, "compose.yaml")));
    assert.equal(loadState(w.root).agents?.["my-agent"]?.applied, undefined, "nothing was recorded as applied");
  } finally { w.done(); }
});

test("the deployer's loop deploys an agent when its folder or its keys change, leaves it alone otherwise, and keeps its record every five minutes", async () => {
  const w = world({}); try {
    addAgent(w.root, "my-agent", flags(), noFiles, NOW);
    w.handIn("my-agent", agentSecrets());
    assert.deepEqual(await applyOnce(w.ctx), { applied: ["my-agent"], failed: 0, skipped: [] });
    assert.deepEqual(await applyOnce(w.ctx), { applied: [], failed: 0, skipped: ["my-agent"] }, "nothing changed");
    // the owner lowers the limit: a new set of Guard bundles, with a higher version
    const settings = JSON.parse(readFileSync(join(w.paths.agent("my-agent"), "settings.json"), "utf8"));
    settings.cancellation.refundLimitInr = 50;
    writeFileSync(join(w.paths.agent("my-agent"), "settings.json"), JSON.stringify(settings));
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["my-agent"]);
    assert.equal(loadState(w.root).agents!["my-agent"].guards.razorpay.version, 2);
    assert.equal(loadState(w.root).agents!["my-agent"].guards.whatsapp.version, 1, "a Guard whose spec did not change keeps its version");
    // the record job asks ops for what the Guards and the services say, and keeps it
    // (the captured Guards knew the agent as "demo"; this one is "my-agent")
    const facts = JSON.parse(readFileSync(new URL("./fixtures/own-agent-facts.json", import.meta.url), "utf8").replaceAll("agent-demo", "agent-my-agent").replaceAll("relay-demo", "relay-my-agent").replaceAll("record-demo", "record-my-agent"));
    const asked: string[][] = [];
    const runner = { run: (command: string, args: string[], options?: Parameters<typeof w.ctx.runner.run>[2]) => { if (args.includes("agent-facts")) { asked.push(args.slice(args.indexOf("agent-facts"))); return Promise.resolve(ok(JSON.stringify(facts))); } return w.ctx.runner.run(command, args, options); } };
    let clock = Date.parse(facts.at);
    const ctx = { ...w.ctx, runner, now: () => new Date(clock) };
    assert.ok((await runDueJobs(ctx)).includes("agent records"));
    assert.deepEqual(asked.map((a) => a.slice(0, 2)), [["agent-facts", "my-agent"]]);
    assert.deepEqual(JSON.parse(asked[0][2]), { settled: [], paid: [] }, "the first time, everything is asked about");
    assert.equal(JSON.parse(readFileSync(join(w.paths.exportsOf("my-agent"), "record.json"), "utf8")).length, 11);
    clock += 60_000;
    assert.ok(!(await runDueJobs(ctx)).includes("agent records"), "not again within five minutes");
    clock += AGENT_RECORD_EVERY_MS;
    assert.ok((await runDueJobs(ctx)).includes("agent records"));
    assert.equal(JSON.parse(readFileSync(join(w.paths.exportsOf("my-agent"), "record.json"), "utf8")).length, 11, "the same facts add nothing");
    // and the services are not asked again about what the record has settled: the confirmed link, refund and event, and the link whose deposit is in
    const skip = JSON.parse(asked[1][2]) as { settled: string[]; paid: string[] };
    assert.deepEqual(skip.paid, ["b-1"]);
    assert.ok(skip.settled.length >= 5 && skip.settled.every((id) => id.startsWith("gd-")), skip.settled.join());
    // an ops that cannot answer leaves the record as it was and says so
    const dead = await recordAgent({ ...ctx, runner: { run: async () => ({ code: 1, stdout: "", stderr: "container not running" }) } }, "my-agent");
    assert.deepEqual([dead.added, dead.total], [0, 11]);
    assert.match(dead.problems[0], /could not be asked \(container not running\)/);
  } finally { w.done(); }
});

test("a server that holds only agents someone else wrote needs no model key; one with a deployed shop still does", async () => {
  const w = world({}); try {
    rmSync(join(w.paths.secrets, "g-model"), { recursive: true, force: true });
    addAgent(w.root, "my-agent", flags(), noFiles, NOW);
    w.handIn("my-agent", agentSecrets());
    assert.equal((await deployAgent(w.ctx, "my-agent")).proven.passed, 12);
  } finally { w.done(); }
  const s = world({ "glow-salon": panelRuntime() }); try {
    s.handIn("glow-salon");
    await deploy(s.ctx, "glow-salon");
    rmSync(join(s.paths.secrets, "g-model"), { recursive: true, force: true });
    addAgent(s.root, "my-agent", flags(), noFiles, NOW);
    s.handIn("my-agent", agentSecrets());
    assert.deepEqual((await refusedWith(deployAgent(s.ctx, "my-agent"))).map((p) => p.rule), ["secret-missing:model_key"]);
  } finally { s.done(); }
});

test("an agent that calls Razorpay and WhatsApp only needs only their keys", async () => {
  const w = world({}); try {
    addAgent(w.root, "pay-only", flags({ upstreams: "razorpay,whatsapp", "calendar-id": undefined }), noFiles, NOW);
    const { "google_service_account.json": _google, ...rest } = agentSecrets();
    w.handIn("pay-only", rest);
    const r = await deployAgent(w.ctx, "pay-only");
    assert.equal(r.proven.passed, 8);
    assert.deepEqual(Object.keys(r.connection.baseUrls), ["razorpay", "whatsapp"]);
    assert.ok(!read(join(w.paths.generated, "compose.yaml")).includes("g-pay-only-calendar"));
  } finally { w.done(); }
});
