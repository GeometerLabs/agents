// The shape of the server: who is on which network, who can read which secret folder, and what is never mounted. These are the claims of the architecture,
// checked on the generated compose entries (JavaScript objects, before they are written as YAML).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressing, caddyfile, composeServer, yaml } from "../generate/compose.ts";
import type { ShopDeploy } from "../generate/compose.ts";
import { names } from "../generate/shop.ts";
import { serverConfig } from "./helpers.ts";

const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence" };
const shop = (name: string, index: number): ShopDeploy => ({ name, index, pathwayDir: "/repo/templates/commerce/bookings", guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard(name, kind), tenant: name })) });
const build = (shops: ShopDeploy[], change: Record<string, unknown> = {}) => composeServer(serverConfig({ panel: { enabled: true }, ...change }), dirs, shops, { panel: { user: "501:20", shareAddress: "calendar@x.iam.gserviceaccount.com" } });
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
  // item 11h: the push sender reaches the push services; the push Guards (fwd-*-push) do not reach out at all: they are on `push` with the sender only
  assert.deepEqual(onEgress, ["fwd-bright-tuition-calendar", "fwd-bright-tuition-razorpay", "fwd-bright-tuition-whatsapp", "fwd-glow-salon-calendar", "fwd-glow-salon-razorpay", "fwd-glow-salon-whatsapp", "fwd-model", "ops", "push", "refresher"]);
  const onPush = Object.keys(c.services).filter((s) => nets(c, s).includes("push"));
  assert.ok(onPush.includes("push") && onPush.every((s) => s === "push" || /^fwd-.+-push$/u.test(s)), `only the push sender and push Guards are on push: ${onPush.join(", ")}`);
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
  for (const f of ["inbox", "relay", "refresher", "ops", "g-model"]) assert.equal(holders(f).length, 1, f);
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

test("the runtime mounts its folder, the pathway, the shared modules, its data volume and its own credentials, and waits for its own three Guards to be healthy (not the shared model Guard)", () => {
  const c = two();
  assert.deepEqual(mounts(c, "rt-glow-salon"), ["/repo/templates/commerce/bookings:/pathway:ro", "/repo/modules:/modules:ro", "/srv/generated/shops/glow-salon/client:/client:ro", "/srv/secrets/rt-glow-salon:/run/secrets:ro", "rt-data-glow-salon:/home/node"]);
  assert.deepEqual(Object.keys(c.services["rt-glow-salon"].block.depends_on as object).sort(), ["g-glow-salon-calendar", "g-glow-salon-razorpay", "g-glow-salon-whatsapp"]);
  assert.deepEqual(c.services["rt-glow-salon"].block.command, ["node", "/pathway/server/main.ts", "--client", "/client"]);
});

test("a runtime mounts its template and the shared modules from the folders of whichever shape the version was kept in: this repository's, a kept checkout laid out the same way, or one from before the templates were grouped by domain", () => {
  const mountsOf = (pathwayDir: string) => mounts(build([{ ...shop("glow-salon", 1), pathwayDir }]), "rt-glow-salon").slice(0, 2);
  assert.deepEqual(mountsOf("/repo/templates/commerce/bookings"), ["/repo/templates/commerce/bookings:/pathway:ro", "/repo/modules:/modules:ro"]);
  assert.deepEqual(mountsOf("/srv/server/templates/commerce/bookings@0.2.0"), ["/srv/server/templates/commerce/bookings@0.2.0:/pathway:ro", "/srv/server/modules:/modules:ro"]);
  assert.deepEqual(mountsOf("/srv/server/pathways/bookings@0.1.0"), ["/srv/server/pathways/bookings@0.1.0:/pathway:ro", "/srv/server/modules:/modules:ro"]);
});

test("the panel is told where the domain folders of the templates are, in the app folder it mounts", () => {
  const c = two();
  const env = c.services.panel.block.environment as Record<string, string>;
  assert.equal(env.PANEL_TEMPLATES_DIR, "/app/templates");
  assert.equal(env.PANEL_PATHWAYS_DIR, undefined);
  assert.ok(mounts(c, "panel").includes("/repo:/app:ro"));
});

test("the Calendar Guard reads only its own shop's token (a sub-folder of the token volume), after the refresher has made one", () => {
  const c = two();
  const m = JSON.parse(mounts(c, "g-glow-salon-calendar").find((x) => x.startsWith("{"))!);
  assert.deepEqual(m, { type: "volume", source: "google-auth", target: "/run/google", read_only: true, volume: { subpath: "glow-salon" } });
  assert.deepEqual(c.services["g-glow-salon-calendar"].block.depends_on, { "fwd-glow-salon-calendar": { condition: "service_started" }, refresher: { condition: "service_healthy" } });
  assert.ok(!mounts(c, "g-glow-salon-razorpay").some((x) => x.includes("google")));
});

test("the lease's folder is mounted read-only on every shop Guard, and on nothing else (not the model Guard, not the runtime)", () => {
  const c = two();
  const holders = Object.keys(c.services).filter((s) => mounts(c, s).includes("/srv/state/licence:/run/geometer/licence:ro")).sort();
  assert.deepEqual(holders, ["bright-tuition", "glow-salon"].flatMap((shop) => ["calendar", "razorpay", "whatsapp"].map((k) => `g-${shop}-${k}`)).sort());
  assert.ok(Object.keys(c.services).every((s) => holders.includes(s) || !mounts(c, s).some((m) => m.includes("/srv/state"))), "no other service sees state/");
});

test("no service copies a database continuously: the nightly snapshot is a short-lived job, not a container that runs all the time", () => {
  const c = two();
  assert.equal(c.services.litestream, undefined);
  assert.ok(!JSON.stringify(c).includes("litestream"), "nothing in compose names Litestream");
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
  const own = composeServer(serverConfig({ panel: { enabled: true } }), dirs, [], { opsUser: "501:20" });
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

// ---- the optional speech service (plan 11d, bundle/services/speech) ----------------------------------------------------------------------

test("speech is OFF unless the server turns it on: no service, no network, no model folder in the Compose file", () => {
  const c = two();
  assert.equal(c.services["geometer-speech"], undefined);
  assert.doesNotMatch(c.compose, /geometer-speech|\n  speech:/);
  const parsed = serverConfig({ speech: { enabled: false } });
  assert.equal(parsed.speech, undefined);
});

test("speech ON: one container alone on an internal network with no way out, no published port, a read-only root, models mounted read-only", () => {
  const server = serverConfig({ panel: { enabled: true }, speech: { enabled: true } });
  assert.equal(server.speech?.image, "geo-speech:0.1.0");
  const c = composeServer(server, dirs, [shop("glow-salon", 1)], { speech: { image: server.speech!.image, modelsDir: "/srv/speech-models" } });
  const s = c.services["geometer-speech"].block;
  assert.deepEqual(Object.keys(s.networks as object), ["speech"], "the speech network is its only network");
  assert.match(c.compose, /\n  speech:\n    internal: true/, "the speech network has no route out");
  assert.equal(s.ports, undefined, "nothing is published on the host");
  assert.equal(s.read_only, true);
  assert.deepEqual(s.cap_drop, ["ALL"]);
  assert.deepEqual(s.volumes, ["/srv/speech-models:/models:ro"]);
  assert.equal(Object.keys(c.services).filter((n) => nets(c, n).includes("speech")).join(), "geometer-speech", "no other service shares its network until the speech Guard is placed");
  assert.equal((s.environment as Record<string, string>).SPEECH_TOKEN_FILE, undefined, "no token on a private network");
  assert.ok(addressing(server).subnets.speech.startsWith("10.231.233."), "its subnet is fixed and does not overlap the others");
  assert.equal(new Set(Object.values(addressing(server).subnets)).size, Object.keys(addressing(server).subnets).length);
});

test("speech ON with a token file: the service refuses to start without it", () => {
  const server = serverConfig({ speech: { enabled: true, image: "registry.example/geo-speech:9", modelsDir: "/data/models" } });
  const c = composeServer(server, dirs, [], { speech: { image: server.speech!.image, modelsDir: server.speech!.modelsDir!, tokenFile: "/srv/secrets/speech_token" } });
  const s = c.services["geometer-speech"].block;
  assert.equal(s.image, "registry.example/geo-speech:9");
  assert.deepEqual(s.environment, { SPEECH_MODELS_DIR: "/models", SPEECH_PORT: "8080", SPEECH_TOKEN_FILE: "/run/secrets/speech_token", SPEECH_REQUIRE_TOKEN: "1" });
  assert.deepEqual(c.services["geometer-speech"].files, ["/srv/secrets/speech_token"]);
});

test("a malformed speech block in geometer.json is refused in words", () => {
  assert.throws(() => serverConfig({ speech: { enabled: true, modelsDir: "relative/path" } }), /"speech" must say/);
  assert.throws(() => serverConfig({ speech: "yes" }), /"speech" must say/);
});
