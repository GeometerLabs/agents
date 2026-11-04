// The shape of the server: who is on which network, who can read which secret folder, and what is never mounted. These are the claims of the architecture,
// checked on the generated compose entries (JavaScript objects, before they are written as YAML).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressing, caddyfile, composeServer, yaml } from "../generate/compose.ts";
import type { ShopDeploy } from "../generate/compose.ts";
import { names } from "../generate/shop.ts";
import { serverConfig } from "./helpers.ts";

const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json" };
const shop = (name: string, index: number): ShopDeploy => ({ name, index, pathwayDir: "/repo/pathways/bookings", guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard(name, kind), tenant: name })) });
const build = (shops: ShopDeploy[], change: Record<string, unknown> = {}, backup = true) => composeServer(serverConfig({ panel: { enabled: true }, ...change }), dirs, shops, { backup, panel: { user: "501:20", shareAddress: "calendar@x.iam.gserviceaccount.com" } });
const nets = (c: ReturnType<typeof build>, svc: string): string[] => { const n = c.services[svc].block.networks as Record<string, unknown> | string[] | undefined; return n === undefined ? [] : Array.isArray(n) ? n : Object.keys(n); };
const mounts = (c: ReturnType<typeof build>, svc: string): string[] => ((c.services[svc].block.volumes as unknown[]) ?? []).map((v) => typeof v === "string" ? v : JSON.stringify(v));
const two = () => build([shop("glow-salon", 1), shop("bright-tuition", 2)]);

test("a runtime is on ONE internal network, shared with its own Guards and the model Guard, and on no other network", () => {
  const c = two();
  assert.deepEqual(nets(c, "rt-glow-salon"), ["net-glow-salon"]);
  for (const svc of ["fwd-glow-salon-razorpay", "fwd-glow-salon-whatsapp", "fwd-glow-salon-calendar"]) assert.ok(nets(c, svc).includes("net-glow-salon") && !nets(c, svc).includes("net-bright-tuition"), svc);
  assert.deepEqual(nets(c, "fwd-model").sort(), ["admin", "egress", "net-bright-tuition", "net-glow-salon"]);
  const compose = c.compose;
  for (const n of ["net-glow-salon", "net-bright-tuition", "admin"]) assert.match(compose, new RegExp(`\\n  ${n}:\\n    internal: true`), `${n} has no way out`);
  assert.doesNotMatch(compose, /\n  (front|egress):\n    internal/);
});

test("only Guards (and the few services that must call out) are on the egress network; the runtime and Caddy never are", () => {
  const c = two();
  const onEgress = Object.keys(c.services).filter((s) => nets(c, s).includes("egress")).sort();
  assert.deepEqual(onEgress, ["fwd-bright-tuition-calendar", "fwd-bright-tuition-razorpay", "fwd-bright-tuition-whatsapp", "fwd-glow-salon-calendar", "fwd-glow-salon-razorpay", "fwd-glow-salon-whatsapp", "fwd-model", "litestream", "ops", "refresher"]);
  for (const g of ["g-glow-salon-razorpay", "g-model"]) assert.match(String(c.services[g].block.network_mode), /^service:fwd-/, `${g} joins its forwarder's namespace`);
  assert.deepEqual(nets(c, "caddy"), ["front"]);
  assert.deepEqual(nets(c, "inbox").sort(), ["admin", "front"]);
});

test("a runtime's network holds ONLY the runtime, its own three Guards, the model Guard and its door: not the inbox, the relay or ops, which the runtime could otherwise connect to", () => {
  const c = two();
  const members = (net: string) => Object.keys(c.services).filter((s) => nets(c, s).includes(net)).sort();
  assert.deepEqual(members("net-glow-salon"), ["door-glow-salon", "fwd-glow-salon-calendar", "fwd-glow-salon-razorpay", "fwd-glow-salon-whatsapp", "fwd-model", "rt-glow-salon"]);
  assert.deepEqual(members("net-bright-tuition"), ["door-bright-tuition", "fwd-bright-tuition-calendar", "fwd-bright-tuition-razorpay", "fwd-bright-tuition-whatsapp", "fwd-model", "rt-bright-tuition"]);
  assert.deepEqual((c.services["fwd-glow-salon-razorpay"].block.networks as Record<string, { aliases?: string[] }>)["net-glow-salon"].aliases, ["g-glow-salon-razorpay"], "the runtime finds its Guard by the Guard's name");
  const door = c.services["door-glow-salon"].block;
  const ip = ((door.networks as Record<string, { ipv4_address?: string }>).admin).ipv4_address!;
  assert.deepEqual(door.command, ["nc", "-ll", "-s", ip, "-p", "8780", "-e", "nc", "rt-glow-salon", "8780"]);
  assert.match(ip, /^10\.231\.24\d\.\d+$/, "the door listens only on the admin network, where the runtime is not");
});

test("each Guard shares its forwarder's network namespace; the forwarder listens only on an address of the admin network and passes bytes to the Guard's loopback", () => {
  const c = two();
  const addresses = new Set<string>();
  for (const [name, s] of Object.entries(c.services).filter(([n]) => n.startsWith("fwd-"))) {
    const ip = ((s.block.networks as Record<string, { ipv4_address?: string }>).admin).ipv4_address!;
    assert.match(ip, /^10\.231\.24\d\.\d+$/);
    assert.ok(!addresses.has(ip), `${ip} is used once`); addresses.add(ip);
    assert.deepEqual((s.block.command as string[]).slice(0, 5), ["nc", "-ll", "-s", ip, "-p"]);
    assert.deepEqual((s.block.command as string[]).slice(-3), ["nc", "127.0.0.1", "8082"]);
    const guard = "g-" + name.slice(4);
    assert.equal(c.services[guard].block.network_mode, `service:${name}`, `${guard} joins ${name}`);
    assert.equal(c.services[guard].block.networks, undefined, "a container that joins a namespace has no networks of its own");
  }
  assert.equal(addresses.size, 7);
  assert.equal(addressing(serverConfig()).adminIp("x", "razorpay", 1), "10.231.240.20");
});

test("each secret folder is mounted into the one container that needs it, and nothing else", () => {
  const c = two();
  const holders = (folder: string) => Object.keys(c.services).filter((s) => mounts(c, s).some((m) => m.startsWith(`/srv/secrets/${folder}:`) || m.includes(`/srv/secrets/${folder}/`))).sort();
  assert.deepEqual(holders("g-glow-salon-razorpay"), ["g-glow-salon-razorpay"]);
  assert.deepEqual(holders("g-glow-salon-whatsapp"), ["g-glow-salon-whatsapp"]);
  assert.deepEqual(holders("rt-glow-salon"), ["rt-glow-salon"]);
  for (const f of ["inbox", "relay", "refresher", "ops", "litestream", "g-model"]) assert.equal(holders(f).length, 1, f);
  assert.deepEqual(holders("inbox"), ["inbox"]);
  assert.deepEqual(holders("panel"), ["panel"], "the panel's keys and its agent token are in a folder only the panel mounts");
  assert.ok(!mounts(c, "caddy").some((m) => m.includes("/srv/secrets/")), "Caddy sees no secrets folder");
});

test("nothing mounts the Docker socket, nothing is privileged, every program of ours runs without root and with a read-only filesystem", () => {
  const c = two();
  assert.doesNotMatch(c.compose, /docker\.sock/);
  assert.doesNotMatch(c.compose, /privileged/);
  for (const [name, s] of Object.entries(c.services)) {
    if (name.startsWith("fwd-") || name === "caddy") continue;
    assert.ok(["1000:1000", "65532:65532"].includes(String(s.block.user)) || (name === "panel" && !String(s.block.user).startsWith("0:")), `${name} runs as ${String(s.block.user)}`);
    assert.equal(s.block.read_only, true, name);
    assert.deepEqual(s.block.cap_drop, ["ALL"], name);
  }
});

test("the runtime mounts its folder, the pathway, its data volume and its own credentials, and waits for its own three Guards to be healthy (not the shared model Guard)", () => {
  const c = two();
  assert.deepEqual(mounts(c, "rt-glow-salon"), ["/repo/pathways/bookings:/pathway:ro", "/srv/generated/shops/glow-salon/client:/client:ro", "/srv/secrets/rt-glow-salon:/run/secrets:ro", "rt-data-glow-salon:/home/node"]);
  assert.deepEqual(Object.keys(c.services["rt-glow-salon"].block.depends_on as object).sort(), ["g-glow-salon-calendar", "g-glow-salon-razorpay", "g-glow-salon-whatsapp"]);
  assert.deepEqual(c.services["rt-glow-salon"].block.command, ["node", "/pathway/server/main.ts", "--client", "/client"]);
});

test("the Calendar Guard reads only its own shop's token (a sub-folder of the token volume), after the refresher has made one", () => {
  const c = two();
  const m = JSON.parse(mounts(c, "g-glow-salon-calendar").find((x) => x.startsWith("{"))!);
  assert.deepEqual(m, { type: "volume", source: "google-auth", target: "/run/google", read_only: true, volume: { subpath: "glow-salon" } });
  assert.deepEqual(c.services["g-glow-salon-calendar"].block.depends_on, { "fwd-glow-salon-calendar": { condition: "service_started" }, refresher: { condition: "service_healthy" } });
  assert.ok(!mounts(c, "g-glow-salon-razorpay").some((x) => x.includes("google")));
});

test("litestream streams only the runtimes' databases: no Guard store is mounted into it", () => {
  const c = two();
  assert.deepEqual(mounts(c, "litestream").filter((m) => !m.includes("litestream.yml")), ["rt-data-glow-salon:/data/glow-salon", "rt-data-bright-tuition:/data/bright-tuition"]);
  assert.equal(build([shop("a", 1)], {}, false).services.litestream, undefined, "no backup configured, no litestream");
});

test("Caddy sends /c/* to the inbox and everything else to the panel (it serves from the root), and makes its own certificate only for a local name", () => {
  const server = serverConfig({ panel: { enabled: true } });
  const real = caddyfile(server);
  assert.match(real, /^shops\.example\.com \{$/m);
  assert.doesNotMatch(real, /tls internal/);
  assert.match(real, /handle \/c\/\* \{\n\t\treverse_proxy inbox:8788/);
  assert.match(real, /handle \{\n\t\treverse_proxy panel:8790/);
  const local = caddyfile(serverConfig({ domain: "localhost" }));
  assert.match(local, /^https:\/\/localhost \{$/m); assert.match(local, /tls internal/);
  assert.match(local, /respond "Geometer" 404/, "no panel, nothing else is served");
  assert.doesNotMatch(local, /reverse_proxy panel/, "and no route to a panel that is not there");
  assert.doesNotMatch(real, /reverse_proxy relay/, "the relay is for the inbox to call, not for the internet");
});

test("the YAML writer quotes every scalar, so a path or an address can never be misread", () => {
  assert.equal(yaml({ a: "yes", b: "10.231.0.1", c: ["x: y", "- z"], d: { e: true, f: 8080 }, "g-h": null }), 'a: "yes"\nb: "10.231.0.1"\nc:\n  - "x: y"\n  - "- z"\nd:\n  e: true\n  f: 8080\ng-h: null');
});

test("ops sees the deployer's status files read-only (for the backup times and the counts in the heartbeat), writes only the fleet folder, and still holds no folder the panel's contract does not name", () => {
  const c = two();
  assert.deepEqual(mounts(c, "ops"), ["/repo:/app:ro", "/srv/generated/ops:/etc/geometer:ro", "/srv/secrets/ops:/run/secrets:ro", "/srv/status:/server/status:ro", "/srv/fleet:/server/fleet"]);
  assert.doesNotMatch(JSON.stringify(c.services.ops.block), /docker\.sock|\/srv\/state|\/srv\/shops|\/srv\/secrets-inbox/);
  assert.deepEqual(mounts(c, "ops").filter((m) => !m.endsWith(":ro")), ["/srv/fleet:/server/fleet"], "the only writable bind mount");
  assert.equal(c.services.ops.block.user, "1000:1000", "the node user unless the deployer says who runs ops");
  const own = composeServer(serverConfig({ panel: { enabled: true } }), dirs, [], { backup: false, opsUser: "501:20" });
  assert.equal(own.services.ops.block.user, "501:20", "the user who runs the deployer, as the panel does, so both can read what ops writes");
});

test("the panel: on front and its own network only, as the user who runs the deployer, with exactly the folders the contract gives it and no others", () => {
  const c = two();
  const p = c.services.panel.block;
  assert.deepEqual(nets(c, "panel").sort(), ["front", "panel"], "no egress, no admin network");
  assert.equal(p.user, "501:20");
  assert.deepEqual(mounts(c, "panel"), ["/repo:/app:ro", "/srv/secrets/panel:/run/secrets:ro", "/srv/shops:/server/shops", "/srv/secrets-inbox:/server/secrets-inbox", "/srv/requests:/server/requests", "/srv/status:/server/status:ro", "/srv/fleet:/server/fleet:ro", "/srv/exports:/server/exports:ro", "/srv/panel:/server/panel", "/srv/geometer.json:/server/geometer.json:ro"]);
  assert.doesNotMatch(JSON.stringify(p), /docker\.sock|\/srv\/state|\/srv\/generated|"\/srv\/secrets:/);
  const env = p.environment as Record<string, string>;
  assert.deepEqual([env.PANEL_SERVER_DIR, env.PANEL_MODE, env.PANEL_PORT, env.PANEL_TRUST_PROXY, env.PANEL_DATA_KEY_FILE, env.PANEL_SIGNING_KEY_FILE], ["/server", "own", "8790", "1", "/run/secrets/data_key", "/run/secrets/signing_key"]);
  assert.deepEqual([env.PANEL_GUARD_URL, env.PANEL_GUARD_AGENT_TOKEN_FILE, env.PANEL_WEBHOOK_URL], ["http://g-{shop}-{kind}:8080", "/run/secrets/guard_agent_token", "https://shops.example.com/c/{shop}/webhooks/{kind}"]);
  assert.equal(env.PANEL_PUBLIC_URL, "https://shops.example.com");
  assert.equal(env.PANEL_CALENDAR_SHARE_ADDRESS, "calendar@x.iam.gserviceaccount.com");
  assert.equal(p.read_only, true);
});

test("the panel reaches each shop's three Guards by name on its own network, at an address of the forwarder that listens there for the agent port only", () => {
  const c = two();
  for (const kind of ["razorpay", "whatsapp", "calendar"]) {
    const f = (c.services[`fwd-glow-salon-${kind}`].block.networks as Record<string, { ipv4_address?: string; aliases?: string[] }>).panel;
    assert.match(f.ipv4_address!, /^10\.231\.22\d\.\d+$/);
    assert.deepEqual(f.aliases, [`g-glow-salon-${kind}`]);
  }
  assert.equal((c.services["fwd-model"].block.networks as Record<string, unknown>).panel, undefined, "the model Guard is not the panel's to read");
  assert.equal((c.services["door-glow-salon"].block.networks as Record<string, unknown>).panel, undefined, "nor is the runtime");
  const cmd = c.services["fwd-glow-salon-razorpay"].block.command as string[];
  assert.ok(cmd[3].startsWith("10.231.240."), "the admin forwarder still listens on the admin address alone");
  assert.match(c.compose, /\n  panel:\n    internal: true/);
  assert.equal(build([shop("a", 1)], { panel: { enabled: false } }).services.panel, undefined);
});

test("hosted mode is passed to the panel", () => {
  assert.equal((build([shop("a", 1)], { panel: { enabled: true, mode: "hosted" } }).services.panel.block.environment as Record<string, string>).PANEL_MODE, "hosted");
});
