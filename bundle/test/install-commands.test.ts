// The bundle commands the one-step install (install.sh, plan item 14b) stands on: `pair` (a one-time code exchanged once with fleet, the answer kept at once, the code
// never kept), `init --pairing` (the server's id, fleet's address and licence key from the pairing, and the trial lease taken in before anything starts), a folder
// with no model until the panel's first run, `up` (the panel and HTTPS with no shop yet), `licence lease` by hand, and the whole-server verbs kept apart from
// one shop's kill switch. Against a fleet stand-in on 127.0.0.1 and the fake Docker of world.ts; nothing here reaches a real service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { main } from "../geometer.ts";
import { serverProblems, upServer } from "../deploy.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { checkAnswer, pairServer, readPairing } from "../lib/pairing.ts";
import { licencePaths } from "../lib/licence.ts";
import { loadServer, parseServer } from "../lib/server.ts";
import { loadState, saveState } from "../lib/state.ts";
import { kidOf } from "../../modules/licence/token.ts";
import { lease, PIN, TEST_PUBLIC_HEX } from "./licence-helpers.ts";
import { panelRuntime } from "./helpers.ts";
import { world } from "./world.ts";

const KEY = `gfk_${"A".repeat(43)}`;
const CODE = "gfp_abcd-efgh-jkmn-pqrs-tvwx-yz23";
const GEOMETER = new URL("../geometer.ts", import.meta.url).pathname;

async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

/** Fleet's pairing route, standing in: answers what `answer` says, and remembers each body it was sent. */
async function fakeFleet(answer: (body: unknown) => { status: number; body: unknown }) {
  const bodies: unknown[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c: Buffer) => { raw += c.toString(); });
    req.on("end", () => {
      const body = req.url === "/v1/pair" && req.method === "POST" ? JSON.parse(raw) : undefined;
      bodies.push(body);
      const a = body === undefined ? { status: 404, body: { error: "There is nothing here." } } : answer(body);
      res.writeHead(a.status, { "content-type": "application/json" }); res.end(JSON.stringify(a.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, bodies, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

const goodAnswer = (deployment = "ravi-abcdef", trial: string | null = lease(1, 1_796_668_200, [], deployment)) => ({
  status: 200, body: { deployment_id: deployment, deployment_key: KEY, fleet_url: null, licence_keys: [TEST_PUBLIC_HEX], trial_lease: trial, account_name: "Ravi Builds" },
});

test("pair sends the code once and keeps the answer at once: the key alone in fleet_key (0600), the rest in pairing.json, the code nowhere", async () => {
  const fleet = await fakeFleet(() => goodAnswer());
  const dir = join(mkdtempSync(join(tmpdir(), "geo-pair-")), "server");
  try {
    const p = await pairServer({ dir, fleetUrl: fleet.url, code: ` ${CODE}\n`, now: new Date("2026-11-11T10:00:00Z") });
    assert.deepEqual(fleet.bodies, [{ code: CODE }], "exactly {code}, trimmed, sent once");
    assert.equal(p.deploymentId, "ravi-abcdef");
    assert.equal(p.fleetUrl, fleet.url, "fleet named no address, so the one paired with is kept");
    assert.equal(readFileSync(join(dir, "fleet_key"), "utf8"), `${KEY}\n`);
    assert.equal(statSync(join(dir, "fleet_key")).mode & 0o777, 0o600);
    const info = readFileSync(join(dir, "pairing.json"), "utf8");
    assert.ok(!info.includes(KEY) && !info.includes(CODE) && !info.includes(CODE.replaceAll("-", "")), "pairing.json holds neither the key nor the code");
    assert.equal(readPairing(dir).accountName, "Ravi Builds");
    await assert.rejects(pairServer({ dir, fleetUrl: fleet.url, code: CODE, now: new Date() }), /already paired.*Nothing was sent/u);
    assert.equal(fleet.bodies.length, 1, "a second pairing of the same folder sends nothing");
  } finally { await fleet.close(); rmSync(join(dir, ".."), { recursive: true, force: true }); }
});

test("pair refuses before sending anything when the code or fleet's address is wrong, and says when the code was spent", async () => {
  const root = mkdtempSync(join(tmpdir(), "geo-pair-"));
  const fleet = await fakeFleet((body) => ((body as { code: string }).code === CODE ? { status: 401, body: { error: "That pairing code was not accepted. It may be mistyped, already used, or older than 120 minutes." } } : goodAnswer()));
  try {
    await assert.rejects(pairServer({ dir: join(root, "a"), fleetUrl: fleet.url, code: "123456", now: new Date() }), /not a pairing code.*Nothing was sent/u);
    await assert.rejects(pairServer({ dir: join(root, "a"), fleetUrl: "http://fleet.example.com", code: CODE, now: new Date() }), /must start with https/u);
    assert.equal(fleet.bodies.length, 0);
    await assert.rejects(pairServer({ dir: join(root, "a"), fleetUrl: fleet.url, code: CODE, now: new Date() }), /Fleet did not pair this server: That pairing code was not accepted/u);
    assert.ok(!existsSync(join(root, "a", "fleet_key")) && !existsSync(join(root, "a", "pairing.json")));
    await assert.rejects(pairServer({ dir: join(root, "b"), fleetUrl: "http://127.0.0.1:9", code: CODE, now: new Date(), timeoutMs: 3000 }), /could not be reached.*The code was not used/u);
    const odd = await fakeFleet(() => ({ status: 200, body: { ...goodAnswer().body, deployment_key: "not-a-key" } }));
    try { await assert.rejects(pairServer({ dir: join(root, "c"), fleetUrl: odd.url, code: CODE, now: new Date() }), /could not be used.*no usable deployment key.*used up/u); } finally { await odd.close(); }
    assert.ok(!existsSync(join(root, "c", "fleet_key")), "nothing from a malformed answer is written");
    for (const bad of [{ ...goodAnswer().body, deployment_id: "9876543210" }, { ...goodAnswer().body, licence_keys: ["xyz"] }, { ...goodAnswer().body, trial_lease: "<html>" }, { ...goodAnswer().body, fleet_url: "http://fleet.example.com" }]) assert.equal(checkAnswer(bad, fleet.url).ok, false, JSON.stringify(bad));
  } finally { await fleet.close(); rmSync(root, { recursive: true, force: true }); }
});

test("`geometer pair` reads the code on standard input, never its command line, and prints neither the code nor the key", async () => {
  const fleet = await fakeFleet(() => goodAnswer());
  const root = mkdtempSync(join(tmpdir(), "geo-pair-"));
  try {
    const child = promisify(execFile)(process.execPath, [GEOMETER, "pair", join(root, "server"), "--fleet-url", fleet.url], { timeout: 30_000 });
    child.child.stdin!.end(`${CODE}\n`);
    const r = await child;
    assert.match(r.stdout, /Paired with Geometer's fleet for the account "Ravi Builds". This server is ravi-abcdef/u);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(KEY) && !`${r.stdout}${r.stderr}`.includes(CODE));
    assert.deepEqual(fleet.bodies, [{ code: CODE }]);
  } finally { await fleet.close(); rmSync(root, { recursive: true, force: true }); }
});

test("init --pairing takes the id, fleet's address, the key file and the licence key from the pairing, keeps the trial lease before anything starts, and makes no model", async () => {
  const fleet = await fakeFleet(() => goodAnswer());
  const root = mkdtempSync(join(tmpdir(), "geo-pair-"));
  const dir = join(root, "server");
  try {
    await pairServer({ dir, fleetUrl: fleet.url, code: CODE, now: new Date() });
    // the release's Guard image has another licence key built in: refused before anything is made, and the pairing is kept for the next run
    const wrong = await quiet(() => main(["init", dir, "--pairing", "--domain", "shops.example.com", "--reviewed-by", "ravi@vps", "--panel", "--guard-licence-kid", "0123456789abcdef"]));
    assert.equal(wrong.result, 1);
    assert.match(wrong.err, /not the one built into this release's Guard image.*pairing is kept/u);
    assert.ok(!existsSync(join(dir, "geometer.json")) && existsSync(join(dir, "fleet_key")));
    assert.match((await quiet(() => main(["init", dir, "--pairing", "--id", "other", "--domain", "shops.example.com", "--reviewed-by", "ravi"]))).err, /not the id fleet gave this server/u);
    assert.match((await quiet(() => main(["init", dir, "--pairing", "--fleet-url", "https://x.example", "--domain", "shops.example.com", "--reviewed-by", "ravi"]))).err, /come from the pairing/u);

    const r = await quiet(() => main(["init", dir, "--pairing", "--domain", "shops.example.com", "--reviewed-by", "ravi@vps", "--panel", "--guard-licence-kid", kidOf(Buffer.from(TEST_PUBLIC_HEX, "hex"))]));
    assert.equal(r.result, 0, r.err);
    assert.match(r.out, /this server is ravi-abcdef/u);
    assert.match(r.out, /The trial lease is kept/u);
    const server = loadServer(dir);
    assert.deepEqual({ id: server.id, fleet: server.fleet, licence: server.licence, panel: server.panel, model: server.model.model }, { id: "ravi-abcdef", fleet: { url: fleet.url, keyFile: join(dir, "fleet_key") }, licence: { keys: [TEST_PUBLIC_HEX] }, panel: { enabled: true, mode: "own" }, model: "" });
    assert.ok(existsSync(licencePaths(dir).lease), "the trial lease is in state/licence before the first start");
    assert.match(r.out, /choose the model/u);
  } finally { await fleet.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a folder with no model loads; a deploy refuses until the model is chosen, and model-key asks for the model first", async () => {
  assert.deepEqual(parseServer({ schema: 1, id: "acme", domain: "shops.example.com", reviewedBy: "ravi" }).errors, []);
  assert.match(parseServer({ schema: 1, id: "acme", domain: "shops.example.com", reviewedBy: "ravi", model: { wire: "openai" } }).errors.join(" "), /"model" must say/u);
  const w = world({});
  try {
    const raw = JSON.parse(readFileSync(w.paths.config, "utf8")) as Record<string, unknown>;
    delete raw.model;
    writeFileSync(w.paths.config, JSON.stringify(raw));
    const problems = await serverProblems(w.ctx, loadServer(w.root));
    assert.ok(problems.some((p) => p.rule === "model-not-chosen" && /panel's first run asks for it/u.test(p.message)));
    writeFileSync(join(w.root, "key.txt"), "sk-test-0123456789");
    assert.match((await quiet(() => main(["model-key", join(w.root, "key.txt"), "--server", w.root], w.ctx))).err, /No model is chosen for this server yet/u);
  } finally { w.done(); }
});

test("up brings up the panel, HTTPS and the heartbeat with no shop and no model; once a shop is deployed it refuses and points at deploy", async () => {
  const w = world({}, { panel: { enabled: true } });
  try {
    const raw = JSON.parse(readFileSync(w.paths.config, "utf8")) as Record<string, unknown>;
    delete raw.model;
    writeFileSync(w.paths.config, JSON.stringify(raw));
    const r = await quiet(() => main(["up", "--server", w.root], w.ctx));
    assert.equal(r.result, 0, r.err);
    assert.match(r.out, /The server's own services are up: caddy, inbox, ops, panel, refresher, relay\. The panel answers at https:\/\/shops\.example\.com/u);
    const compose = readFileSync(join(w.root, "generated", "compose.yaml"), "utf8");
    assert.ok(!compose.includes("g-model") && !compose.includes("guard"), "no Guard runs before the first shop");
    assert.ok(w.calls.some((c) => c.args.join(" ").includes("up -d --remove-orphans")));
    assert.ok(existsSync(join(w.root, "secrets", "panel", "data_key")), "the panel's keys are made");
    const again = await quiet(() => main(["up", "--server", w.root], w.ctx));
    assert.match(again.out, /nothing changed/u, "a second run changes nothing");

    const state = loadState(w.root);
    state.shops["glow-salon"] = { index: 1, guards: {}, lockHistory: [], applied: {} as never };
    saveState(w.root, state);
    await assert.rejects(upServer(w.ctx), /already runs glow-salon.*geometer deploy/u);
  } finally { w.done(); }
});

test("licence lease takes a lease given by hand, for this server only", async () => {
  const w = world({}, { ...PIN });
  try {
    writeFileSync(join(w.root, "lease.gl1"), lease(3, 1_796_668_200));
    const r = await quiet(() => main(["licence", "lease", join(w.root, "lease.gl1"), "--server", w.root], w.ctx));
    assert.equal(r.result, 0, r.err + r.out);
    assert.match(r.out, /Kept: a lease for 1 shop on acme-vps-1/u);
    writeFileSync(join(w.root, "other.gl1"), lease(4, 1_796_668_300, undefined, "someone-else"));
    const other = await quiet(() => main(["licence", "lease", join(w.root, "other.gl1"), "--server", w.root], w.ctx));
    assert.equal(other.result, 1);
    assert.match(other.out, /not kept: it is a lease for another server/u);
  } finally { w.done(); }
});

test("the whole server has its own verbs: server stop asks for --confirm and names the shops; stop with no shop points there; status waits for the panel", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  try {
    const state = loadState(w.root);
    state.shops["glow-salon"] = { index: 1, guards: {}, lockHistory: [], applied: {} as never };
    saveState(w.root, state);
    writeFileSync(join(w.root, "generated", "compose.yaml"), "services: {}\n");
    let ps = "caddy\trunning\tUp 2 minutes\npanel\trunning\tUp 2 minutes (healthy)\nops\trunning\tUp 2 minutes\ninbox\trunning\tUp 2 minutes (healthy)\nrelay\trunning\tUp 2 minutes (healthy)\nrefresher\trunning\tUp 2 minutes (healthy)\n";
    const runner = fakeRunner((_c, args) => (args.includes("ps") ? ok(ps) : args.includes("invite") ? ok("https://shops.example.com/join/abc\n") : ok()));
    const ctx = { ...w.ctx, runner };

    const ask = await quiet(() => main(["server", "stop", "--server", w.root], ctx));
    assert.equal(ask.result, 3);
    assert.match(ask.out, /stops EVERY container.*glow-salon.*geometer stop <shop>.*server stop --confirm/su);
    assert.ok(!runner.calls.some((c) => c.args.includes("stop")), "nothing is stopped without --confirm");
    const done = await quiet(() => main(["server", "stop", "--confirm", "--server", w.root], ctx));
    assert.equal(done.result, 0, done.err);
    assert.ok(runner.calls.some((c) => c.args.at(-1) === "stop" && c.args.includes("compose")));

    assert.match((await quiet(() => main(["stop", "--server", w.root], ctx))).err, /Say which shop: stop <shop> \(the kill switch for that one shop.*geometer server stop/u);
    const status = await quiet(() => main(["server", "status", "--server", w.root], ctx));
    assert.equal(status.result, 0, status.out);
    assert.match(status.out, /own services are up; the panel is at https:\/\/shops\.example\.com\. Shops deployed: glow-salon/u);
    ps = ps.replace("Up 2 minutes (healthy)", "Up 5 seconds (health: starting)");
    const starting = await quiet(() => main(["server", "status", "--server", w.root], ctx));
    assert.equal(starting.result, 1);
    assert.match(starting.out, /Not up yet: panel/u);

    const started = await quiet(() => main(["server", "start", "--server", w.root], ctx));
    assert.equal(started.result, 0, started.err);
    assert.ok(runner.calls.some((c) => c.args.at(-1) === "start" && c.args.includes("compose")), "with shops deployed, start puts the containers back as they were");

    await quiet(() => main(["logs", "--server", w.root], ctx));
    assert.deepEqual(runner.calls.at(-1)!.args.slice(-6), ["caddy", "panel", "ops", "inbox", "relay", "refresher"]);
    const invite = await quiet(() => main(["invite", "builder", "--server", w.root], ctx));
    assert.equal(invite.result, 0, invite.err);
    assert.ok(runner.calls.at(-1)!.args.join(" ").endsWith("/app/bundle/panel/main.ts invite --role builder"));
    assert.match((await quiet(() => main(["invite", "--server", w.root], ctx))).err, /invite builder\|partner/u);
  } finally { w.done(); }
});
