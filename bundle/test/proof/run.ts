// The B14 proof and the memory measurement, on real Docker. ONE script, meant to be run inside ONE hold of the heavy lock:
//
//   /path/to/heavy.sh node bundle/test/proof/run.ts [--shops 1,5,10] [--keep]
//
// It builds a throwaway server folder, brings the real bundle up with docker compose (the real Guard image, the stand-ins as the providers, MinIO as the
// bucket, the real fleet service on the host), and records what it sees in $PROOF_DIR/results.json and results.txt. Everything it creates is named
// geometer-proof-* and is removed at the end (volumes, networks, containers); it never deletes an image.
import { spawn, spawnSync } from "node:child_process";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../geometer.ts";
import { Refused, deploy, renewRelayCredential } from "../../deploy.ts";
import type { Context } from "../../deploy.ts";
import { dockerGuardTool } from "../../generate/verify.ts";
import type { GuardTool } from "../../generate/verify.ts";
import { realRunner } from "../../lib/runner.ts";
import { secretFile } from "../../lib/secrets.ts";
import { readStatus } from "../../lib/status.ts";
import { runBackup, runDrill, restoreShop } from "../../backup/jobs.ts";
import { decrypt, encrypt, generateIdentity } from "../../backup/age.ts";
import { loadState } from "../../lib/state.ts";

const APP = new URL("../../../", import.meta.url).pathname.replace(/\/$/u, "");
const EXAMPLE = join(APP, "pathways/bookings/clients/glow-salon.example");
const MONOREPO = process.env.GEOMETER_MONOREPO ?? "/Users/navaltharun/Work/geometer/monorepo";
const SCRATCH = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), "geometer-proof-"));
const GUARD_IMAGE = process.env.GUARD_IMAGE ?? "geo-guard:0.1.0-alpha.2-pathways.1";
const args = process.argv.slice(2);
const SIZES = (args.includes("--shops") ? args[args.indexOf("--shops") + 1] : "1,5,10").split(",").map(Number);
const KEEP = args.includes("--keep");
const SERVER = join(SCRATCH, "server");
const PROJECT = "geometer-proof";
const results: Record<string, unknown> = { startedAt: new Date().toISOString(), guardImage: GUARD_IMAGE, checks: [] as unknown[] };
const text = join(SCRATCH, "results.txt");
mkdirSync(SCRATCH, { recursive: true });

const say = (line: string) => { console.log(line); appendFileSync(text, `${line}\n`); };
const save = () => writeFileSync(join(SCRATCH, "results.json"), JSON.stringify(results, null, 2));
const check = (name: string, ok: boolean, detail: unknown) => { (results.checks as unknown[]).push({ name, ok, detail }); say(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined || detail === "" ? "" : `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})`}`); save(); return ok; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sh(command: string, a: string[], o: { input?: string; timeout?: number } = {}) {
  const r = spawnSync(command, a, { encoding: "utf8", input: o.input, timeout: o.timeout ?? 300_000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const dk = (a: string[], o?: { input?: string; timeout?: number }) => sh("docker", a, o);
const composeFile = join(SERVER, "generated", "compose.yaml");
const testCompose = join(SCRATCH, "compose.test.yaml");
const dc = (a: string[], o?: { input?: string; timeout?: number }) => dk(["compose", "-f", composeFile, "-f", testCompose, "--project-directory", join(SERVER, "generated"), ...a], o);
const exec = (service: string, a: string[], o?: { input?: string; timeout?: number }) => dc(["exec", "-T", service, ...a], o);
const nodeEval = (service: string, code: string, timeout = 60_000) => exec(service, ["node", "-e", code], { timeout });
const containerOf = (service: string) => dc(["ps", "-q", service]).out.trim();
/** "Up 2 minutes (healthy)" -- and NOT "(unhealthy)", which also contains the word. */
const healthy = (service: string) => /\(healthy\)/u.test(dc(["ps", service]).out);

// ---------------------------------------------------------------------------------------------------------------------------------- the shops

const shopName = (i: number) => (i === 1 ? "glow-salon" : `shop-${String(i).padStart(2, "0")}`);
const phoneOf = (i: number) => `10000000000${String(i).padStart(4, "0")}`;
const calendarOf = (i: number) => `${shopName(i)}@group.calendar.google.com`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = (i: number) => JSON.stringify({ client_email: `${shopName(i)}@proof.iam.gserviceaccount.com`, private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "http://standins:8791/oauth2/token" });

async function addShop(i: number) {
  const name = shopName(i);
  const client = join(SCRATCH, "clients", name);
  rmSync(client, { recursive: true, force: true });
  cpSync(EXAMPLE, client, { recursive: true });
  const settings = JSON.parse(readFileSync(join(client, "settings.json"), "utf8"));
  settings.name = `Proof Salon ${i}`; settings.cancellation.refundLimitInr = 100; // a refund above ₹100 is held for the owner
  writeFileSync(join(client, "settings.json"), JSON.stringify(settings));
  writeFileSync(join(client, "runtime.json"), JSON.stringify({ mode: "live", tickSeconds: 30, services: { payments: {}, calendar: { calendarId: calendarOf(i) }, messaging: { phoneNumberId: phoneOf(i) }, timeoutMs: 20000 } }));
  const code = await main(["shop", "add", name, "--from", client, "--server", SERVER]);
  if (code !== 0) throw new Error(`shop add ${name} failed`);
  const inbox = join(SERVER, "secrets-inbox", name);
  mkdirSync(inbox, { recursive: true });
  const files: Record<string, string> = { razorpay_key: `rzp_test_proof${i}abcdef:secretproof${i}abcdef123`, whatsapp_token: `EAAproof${i}tokentokentokentoken`, razorpay_webhook_secret: `webhook-secret-${i}-0123456789`, whatsapp_app_secret: `meta-app-secret-${i}-0123456789`, whatsapp_verify_token: `verify-token-${i}-0123456789`, "google_service_account.json": SA(i) };
  for (const [n, v] of Object.entries(files)) writeFileSync(join(inbox, n), v);
}

// ---------------------------------------------------------------------------------------------------------------------------------- the machine

function ctxFor(tool?: GuardTool): Context {
  return { dir: SERVER, appDir: APP, runner: realRunner, tool: tool ?? dockerGuardTool(GUARD_IMAGE, realRunner, join(SERVER, "state", "work")), log: say, now: () => new Date(), sleep, docker: "docker", waitSeconds: 150, extraComposeFiles: [testCompose] };
}

const GiB = 1024;
function stats(): { name: string; mib: number }[] {
  const r = dk(["stats", "--no-stream", "--format", "{{.Name}}\t{{.MemUsage}}"]);
  return r.out.trim().split("\n").filter((l) => l.startsWith(`${PROJECT}-`)).map((l) => {
    const [name, usage] = l.split("\t");
    const m = /^([\d.]+)\s*([KMG]i?)B/u.exec(usage ?? "");
    return { name: name.replace(`${PROJECT}-`, "").replace(/-1$/u, ""), mib: m ? Number(m[1]) * (m[2].startsWith("G") ? GiB : m[2].startsWith("K") ? 1 / 1024 : 1) : 0 };
  });
}
function group(name: string): string {
  if (name === "g-model") return "model Guard";
  if (/^g-.+-(razorpay|whatsapp|calendar)$/u.test(name)) return "shop Guards";
  if (name.startsWith("rt-")) return "runtimes";
  if (name.startsWith("fwd-") || name.startsWith("door-")) return "forwarders and doors";
  if (["standins", "minio"].includes(name)) return "test infrastructure (not counted)";
  return `shared: ${name}`;
}
function measure(label: string, shops: number) {
  const rows = stats();
  const by: Record<string, number[]> = {};
  for (const r of rows) (by[group(r.name)] ??= []).push(r.mib);
  const summary = Object.fromEntries(Object.entries(by).map(([g, v]) => [g, { containers: v.length, meanMiB: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), maxMiB: +Math.max(...v).toFixed(1), totalMiB: +v.reduce((a, b) => a + b, 0).toFixed(1) }]));
  const total = rows.filter((r) => group(r.name) !== "test infrastructure (not counted)").reduce((a, r) => a + r.mib, 0);
  (results.memory ??= {} as Record<string, unknown>) as Record<string, unknown>;
  (results.memory as Record<string, unknown>)[label] = { shops, containers: rows.length, bundleTotalMiB: +total.toFixed(1), groups: summary };
  say(`\nMEMORY (${label}, ${shops} shop(s); docker stats = cgroup memory, not RSS on a VPS): bundle total ${total.toFixed(0)} MiB in ${rows.length} containers`);
  for (const [g, s] of Object.entries(summary)) say(`  ${g.padEnd(34)} ${String(s.containers).padStart(3)} containers  mean ${String(s.meanMiB).padStart(6)}  max ${String(s.maxMiB).padStart(6)}  total ${String(s.totalMiB).padStart(7)} MiB`);
  save();
}

async function waitFor(what: string, test: () => boolean | Promise<boolean>, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds / 2; i++) { if (await test()) return true; await sleep(2000); }
  say(`(timed out waiting for ${what})`);
  return false;
}

/** A connection attempt from inside a container, answered in one word. */
function probe(from: string, host: string, port: number): string {
  const r = nodeEval(from, `const s=require('net').connect({host:'${host}',port:${port},timeout:3000});s.on('connect',()=>{console.log('REACHED');process.exit(0)});s.on('timeout',()=>{console.log('TIMEOUT');process.exit(0)});s.on('error',e=>{console.log('ERR '+e.code);process.exit(0)})`);
  const answer = r.out.trim().split("\n").at(-1) ?? "";
  return /^(REACHED|TIMEOUT|ERR [A-Z_]+)$/u.test(answer) ? answer : `DID-NOT-RUN (${(answer || r.err).trim().slice(0, 80)})`;
}
/** Only an explicit network refusal counts as "not reachable": a probe that failed to run proves nothing. */
const UNREACHABLE = /^(TIMEOUT|ERR (ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET))$/u;
const ipOf = (service: string, network: string): string => dk(["inspect", containerOf(service), "--format", `{{(index .NetworkSettings.Networks "${PROJECT}_${network}").IPAddress}}`]).out.trim();
/** A Guard shares its forwarder's network namespace, so the address on the admin network is the forwarder's. */
const ownerOf = (service: string) => (service.startsWith("g-") ? `fwd-${service.slice(2)}` : service);
const adminIpOf = (service: string) => ipOf(ownerOf(service), "admin");
const readSecret = (container: string, file: string) => readFileSync(secretFile(SERVER, container, ...file.split("/")), "utf8").trim();

/** The two things the design leans on, tried in a minute before anything is built: a busybox `nc` can forward into a joined container's loopback, and the images are here. */
async function smoke(): Promise<void> {
  say("== prerequisites ==");
  for (const image of ["busybox:1.37.0", "node:26-alpine", "caddy:2.8.4-alpine", "litestream/litestream:0.5.17-scratch", "minio/minio:latest", "alpine:3.22", GUARD_IMAGE]) {
    const have = dk(["image", "inspect", "--format", "{{.Id}}", image]).code === 0;
    const pulled = have ? { code: 0, err: "" } : GUARD_IMAGE === image ? { code: 1, err: "the Guard image is not on this machine" } : dk(["pull", "-q", image], { timeout: 900_000 });
    check(`image ${image}`, pulled.code === 0, have ? "already here" : pulled.code === 0 ? "pulled" : pulled.err.slice(0, 120));
    if (pulled.code !== 0) throw new Error(`cannot go on without ${image}`);
  }
  results.imageVersions = Object.fromEntries(["busybox:1.37.0", "node:26-alpine", "caddy:2.8.4-alpine", "litestream/litestream:0.5.17-scratch"].map((i) => [i, dk(["image", "inspect", "--format", "{{.Size}} bytes, {{.Architecture}}", i]).out.trim()]));
  say("== smoke: can a busybox nc forward into a joined container's loopback? ==");
  const net = "geometer-smoke";
  dk(["rm", "-f", `${net}-fwd`, `${net}-app`]); dk(["network", "rm", net]);
  dk(["network", "create", "--internal", "--subnet", "10.239.77.0/24", net]);
  dk(["run", "-d", "--name", `${net}-fwd`, "--network", net, "--ip", "10.239.77.5", "--user", "65532:65532", "--read-only", "--cap-drop", "ALL", "busybox:1.37.0", "nc", "-ll", "-s", "10.239.77.5", "-p", "8190", "-e", "nc", "127.0.0.1", "8082"]);
  dk(["run", "-d", "--name", `${net}-app`, "--network", `container:${net}-fwd`, "node:26-alpine", "node", "-e", "require('http').createServer((q,r)=>r.end('hello '+q.method+' '+q.url)).listen(8082,'127.0.0.1')"]);
  await sleep(4000);
  const get = () => dk(["run", "--rm", "--network", net, "node:26-alpine", "node", "-e", "fetch('http://10.239.77.5:8190/x?y=1',{method:'POST',body:'{}'}).then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log('ERR '+e.message))"]);
  const first = get(); const second = get();
  const direct = dk(["run", "--rm", "--network", net, "node:26-alpine", "node", "-e", "const s=require('net').connect({host:'10.239.77.5',port:8082,timeout:2000});s.on('connect',()=>console.log('REACHED'));s.on('timeout',()=>{console.log('TIMEOUT');process.exit()});s.on('error',e=>console.log('ERR '+e.code))"]);
  dk(["rm", "-f", `${net}-fwd`, `${net}-app`]); dk(["network", "rm", net]);
  check("a busybox nc forwarder carries an HTTP call into the Guard's loopback (twice)", first.out.includes("hello POST /x?y=1") && second.out.includes("hello POST /x?y=1"), first.out.trim() || first.err.slice(0, 160));
  check("and the loopback port itself is not reachable from the network", !direct.out.includes("REACHED"), direct.out.trim());
  if (!first.out.includes("hello POST")) throw new Error("the forwarder design does not work on this Docker; see the smoke output above");
}

async function main_(): Promise<void> {
  say(`proof directory: ${SCRATCH}\nstarted ${results.startedAt}`);
  await smoke();
  // ------------------------------------------------------------------ the server folder, the stand-ins, the bucket, the fleet
  const identityFile = join(SCRATCH, "age-identity.txt");
  rmSync(SERVER, { recursive: true, force: true });
  let code = await main(["init", SERVER, "--id", "proof", "--domain", "localhost", "--reviewed-by", "builder-proof", "--model-wire", "openai", "--model", "gpt-4o-mini", "--http-port", "18080", "--https-port", "18443",
    "--stream-url", "s3://geo-stream/proof", "--stream-endpoint", "http://minio:9000", "--snapshots-url", "s3://geo-snaps/proof", "--snapshots-endpoint", "http://minio:9000", "--age-identity-out", identityFile, "--fleet-url", "http://host.docker.internal:18790", "--fleet-key-file", "fleet_key", "--guard-image", GUARD_IMAGE, "--panel"]);
  if (code !== 0) throw new Error("init failed");
  const conf = JSON.parse(readFileSync(join(SERVER, "geometer.json"), "utf8"));
  conf.upstreams = { razorpay: { host: "standins:8790", tls: false }, whatsapp: { host: "standins:8790", tls: false }, calendar: { host: "standins:8790", tls: false }, model: { host: "standins:8791", tls: false } };
  conf.heartbeatSeconds = 10; conf.panel = { enabled: true, mode: "own" }; conf.limits = { razorpayLinksPerHour: 1_000_000 }; // the load test must not meet the shop's own cap
  writeFileSync(join(SERVER, "geometer.json"), JSON.stringify(conf, null, 2));
  mkdirSync(join(SCRATCH, "minio", "geo-stream"), { recursive: true }); mkdirSync(join(SCRATCH, "minio", "geo-snaps"), { recursive: true });
  writeFileSync(testCompose, `services:
  standins:
    image: node:26-alpine
    user: "1000:1000"
    init: true
    command: ["node", "/app/bundle/test/proof/standins.ts"]
    volumes: ["${APP}:/app:ro"]
    networks: [egress]
    healthcheck: { test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8791/_state"], interval: 3s, timeout: 3s, retries: 20, start_period: 3s }
  refresher:
    depends_on:
      standins: { condition: service_healthy }
  litestream:
    depends_on:
      minio: { condition: service_started }
  panel-probe:
    image: node:26-alpine
    user: "${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}"
    command: ["sleep", "100000"]
    volumes: ["${join(SERVER, "secrets", "panel")}:/run/secrets:ro"]
    networks: [panel]
  minio:
    image: minio/minio:latest
    command: ["server", "/data"]
    environment: { MINIO_ROOT_USER: proofkey, MINIO_ROOT_PASSWORD: proofsecret123 }
    volumes: ["${join(SCRATCH, "minio")}:/data"]
    networks: [egress]
networks:
  egress: {}
  panel: {}
`);
  writeFileSync(join(SCRATCH, "model-key"), "sk-proof-model-key-0123456789\n"); writeFileSync(join(SCRATCH, "bucket-key"), "proofkey:proofsecret123\n");
  for (const a of [["model-key", join(SCRATCH, "model-key")], ["backup-key", "stream", join(SCRATCH, "bucket-key")], ["backup-key", "snapshots", join(SCRATCH, "bucket-key")]]) if (await main([...a, "--server", SERVER]) !== 0) throw new Error(`${a[0]} failed`);

  // the real fleet service, on the host, with its own temp config and data (read-only use of the monorepo)
  const fleetDir = join(SCRATCH, "fleet"); mkdirSync(fleetDir, { recursive: true });
  const fleetConfig = join(fleetDir, "fleet.config.json");
  writeFileSync(fleetConfig, JSON.stringify({ data_dir: join(fleetDir, "data"), listen: { host: "0.0.0.0", port: 18790 }, founder_contact: "founder@example.com", evaluate_every_s: 5, thresholds: { open_grace_s: 5, recover_grace_s: 5 }, notifiers: [{ type: "log" }] }));
  const added = sh("node", [join(MONOREPO, "apps/fleet/main.ts"), "deployment", "add", "proof", "--contact", "builder@example.com", "--config", fleetConfig]);
  const fleetKey = /gfk_[A-Za-z0-9_-]{43}/u.exec(added.out)?.[0];
  const adminOut = sh("node", [join(MONOREPO, "apps/fleet/main.ts"), "admin", "token", "--config", fleetConfig]);
  const fleetAdmin = /gfa_[A-Za-z0-9_-]+/u.exec(adminOut.out)?.[0] ?? /[A-Za-z0-9_-]{30,}/u.exec(adminOut.out)?.[0];
  if (!fleetKey) throw new Error(`could not make a fleet key: ${added.out} ${added.err}`);
  writeFileSync(join(SERVER, "fleet_key"), fleetKey);
  const fleetLog = join(fleetDir, "fleet.log");
  const fleet = spawn("node", [join(MONOREPO, "apps/fleet/main.ts"), "serve", "--config", fleetConfig], { stdio: ["ignore", "pipe", "pipe"] });
  fleet.stdout.on("data", (c: Buffer) => appendFileSync(fleetLog, c)); fleet.stderr.on("data", (c: Buffer) => appendFileSync(fleetLog, c));

  try {
    // ---------------------------------------------------------------- phase: what a refused deploy looks like (real compile and verify-bundle)
    await refusalDemo();

    // ---------------------------------------------------------------- phase: one shop up, measured, proved
    await addShop(1);
    const ctx = ctxFor();
    say("\n== deploy 1 shop ==");
    let t0 = Date.now();
    let res: Awaited<ReturnType<typeof deploy>>;
    try { res = await deploy(ctx); } catch (e) {
      const ps = dc(["ps", "-a", "--format", "{{.Service}}\t{{.Status}}"]).out;
      const bad = ps.trim().split("\n").map((l) => l.split("\t")).filter(([, st]) => st && !/\(healthy\)/u.test(st) && !/^Up /u.test(st)).map(([n]) => n);
      results.diagnosis = { ps, logs: Object.fromEntries(bad.slice(0, 8).map((n) => [n, dc(["logs", "--no-color", "--tail", "25", n]).out.slice(-1800)])) };
      say(`diagnosis:\n${ps}\n${JSON.stringify((results.diagnosis as { logs: unknown }).logs, null, 1).slice(0, 4000)}`);
      throw e;
    }
    results.deployOneShopSeconds = Math.round((Date.now() - t0) / 1000);
    check("deploy: every tripwire passes on the running Guards", res.length === 1 && res[0].proven.passed === res[0].proven.of && res[0].proven.of > 0, res[0]?.proven.line);
    say(`   ${res[0].proven.line}`);
    await sleep(70_000); // steady state: Litestream has settled, the first heartbeat is in, the model Guard has been quiet
    measure("1 shop (idle)", 1);

    await isolation(1);
    await panelAccess(1);
    await killUnderLoad();
    await heldRefundSurvives();
    await tripwireForced(fleetAdmin, fleetLog);
    await webhookThroughCaddy();
    await stopPersists();
    await deployerOutputs();
    await dataDuties();
    await modelGuard();
    measure("1 shop (after the checks above)", 1);

    for (const size of SIZES.filter((s) => s > 1)) {
      say(`\n== scale to ${size} shops ==`);
      const have = Object.keys(loadState(SERVER).shops).length;
      for (let i = have + 1; i <= size; i++) await addShop(i);
      t0 = Date.now();
      const r = await deploy(ctx);
      results[`deploy${size}Seconds`] = Math.round((Date.now() - t0) / 1000);
      check(`deploy ${size} shops: every Guard proven`, r.length === size && r.every((x) => x.proven.passed === x.proven.of), r.map((x) => x.proven.line).slice(0, 2));
      await sleep(80_000);
      const ps = dc(["ps", "--format", "{{.Service}}\t{{.Status}}"]).out.trim().split("\n").map((l) => l.split("\t"));
      const mustBeHealthy = ps.filter(([n]) => /^(g-|rt-|inbox$|relay$|refresher$)/u.test(n));
      const notHealthy = mustBeHealthy.filter(([, st]) => !/\(healthy\)/u.test(st)).map(([n, st]) => `${n}: ${st}`);
      check(`after scaling to ${size} shops every Guard, runtime and shared service is (healthy)`, notHealthy.length === 0 && mustBeHealthy.length >= size * 4 + 4, notHealthy.slice(0, 5));
      const newest = shopName(size);
      const viaModel = nodeEval(`rt-${newest}`, `fetch('http://g-model:8080/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer ${readSecret(`rt-${newest}`, "agent_model")}','content-type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'user',content:'hi'}]})}).then(r=>console.log(r.status))`).out.trim();
      check(`the newest shop's runtime reaches the model Guard after the scale step (its namespace was not stranded)`, viaModel === "200", viaModel);
      measure(`${size} shops (idle)`, size);
      if (size === SIZES.filter((s) => s > 1)[0]) { await isolation(size); await panelAccess(size); }
    }
  } finally {
    results.fleetLog = readFileSync(fleetLog, "utf8").split("\n").filter((l) => /alert|Guard|incident|recover/iu.test(l)).slice(-12);
    fleet.kill();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- phases

async function refusalDemo() {
  say("\n== what a refused deploy looks like (the real binary) ==");
  const real = dockerGuardTool(GUARD_IMAGE, realRunner, join(SCRATCH, "refusal-work"));
  // 1. a rule that would let a forbidden call through: every suffix a tripwire could use is listed
  const spec = { schema: 1, tenant: "demo", tool: "whatsapp", name: "demo-whatsapp", version: 1, reviewed_by: "b", routes: [{ method: "POST", path: "/{version}/{phone_number_id}/messages", operation: "send" }],
    rules: [{ id: "own-number-only", kind: "argument_allowlist", operation: "send", field: "phone_number_id", allowed_suffixes: [..."xqzkjvw0123456789-_.abcdefghilmnoprstuy"] }], limits: [], intents: [], fail_policy: [] };
  const compiled = await real.compile(JSON.stringify(spec));
  results.refusalCompile = compiled.ok ? { ok: true } : { ok: false, problems: compiled.problems };
  say(compiled.ok ? "(the compiler accepted it, which is not expected)" : `compile refused: ${compiled.problems.map((p) => `[${p.rule}] ${p.message}`).join(" | ")}`);
  check("compile refuses a rule that fails its own tripwire", !compiled.ok, compiled.ok ? "" : compiled.problems[0]?.message);
  // 2. the whole deploy, with a tool name in guard.toml that differs from the spec's (the Nov 3 failure: a Guard that looks healthy and protects nothing)
  await addShop(1);
  const broken: GuardTool = { compile: (s) => real.compile(s), verify: (bundle, toml) => real.verify(bundle, toml.replace(/^tool = "razorpay"$/mu, 'tool = "whatsapp"')) };
  let shown = "";
  try { await deploy(ctxFor(broken)); } catch (e) { if (e instanceof Refused) shown = e.problems.map((p) => `  - [${p.rule}] ${p.message}`).join("\n"); else throw e; }
  say(`deploy with a mismatched tool name refused:\n${shown}`);
  results.refusalDeploy = shown;
  check("deploy refuses a Guard whose guard.toml names another tool, and starts nothing", shown !== "" && dk(["ps", "-q", "--filter", `name=${PROJECT}`]).out.trim() === "" && !existsSync(composeFile), shown.slice(0, 300));
  // 3. the whole deploy, with a rule that would let a forbidden call through (the Calendar-style exact pin swapped for every suffix a tripwire could use)
  const weak: GuardTool = { compile: (specText) => { const spec = JSON.parse(specText); if (spec.tool === "whatsapp") spec.rules = [{ id: "own-number-only", kind: "argument_allowlist", operation: "send", field: "phone_number_id", allowed_suffixes: [..."xqzkjvw0123456789-_.abcdefghilmnoprstuy"] }]; return real.compile(JSON.stringify(spec)); }, verify: (b, t) => real.verify(b, t) };
  let weakShown = "";
  try { await deploy(ctxFor(weak)); } catch (e) { if (e instanceof Refused) weakShown = e.problems.map((p) => `  - [${p.rule}] ${p.message}`).join("\n"); else throw e; }
  say(`deploy with a rule that fails its tripwire refused:\n${weakShown}`);
  results.refusalDeployTripwire = weakShown;
  check("deploy refuses a rule that would let a forbidden call through, by the rule's name, and starts nothing", /own-number-only/u.test(weakShown) && /tripwire/iu.test(weakShown) && dk(["ps", "-q", "--filter", `name=${PROJECT}`]).out.trim() === "" && !existsSync(composeFile), weakShown.slice(0, 400));
  rmSync(join(SERVER, "shops", "glow-salon"), { recursive: true, force: true }); rmSync(join(SERVER, "state", "state.json"), { force: true });
}

async function isolation(shops: number) {
  say(`\n== isolation (${shops} shop(s)) ==`);
  const rt = "rt-glow-salon";
  const rows: Record<string, string> = {};
  const attempt = (label: string, host: string, port: number, expect: "REACHED" | "NOT") => {
    if (host === "") { check(`from the runtime: ${label}`, false, "no address was found to try (the probe would prove nothing)"); return; }
    const got = probe(rt, host, port); rows[label] = got;
    check(`from the runtime: ${label} -> ${got}`, expect === "REACHED" ? got === "REACHED" : UNREACHABLE.test(got), got);
  };
  // controls: the same probe from a container that IS meant to reach them must succeed, or "not reachable" above would mean nothing
  const control = (label: string, host: string, port: number) => check(`control, from ops: ${label} -> ${probe("ops", host, port)}`, probe("ops", host, port) === "REACHED", host);
  control("razorpay Guard's admin forwarder", adminIpOf("g-glow-salon-razorpay"), 8190);
  control("the runtime's door", adminIpOf("door-glow-salon"), 8780);
  const sip = ipOf("standins", "egress");
  attempt("its own razorpay Guard (agent port)", "g-glow-salon-razorpay", 8080, "REACHED");
  attempt("its own whatsapp Guard (agent port)", "g-glow-salon-whatsapp", 8080, "REACHED");
  attempt("the model Guard (agent port)", "g-model", 8080, "REACHED");
  attempt("the stand-in provider, by name", "standins", 8790, "NOT");
  attempt(`the stand-in provider, by address ${sip}`, sip, 8790, "NOT");
  attempt("a public address, 1.1.1.1:443", "1.1.1.1", 443, "NOT");
  attempt("a public address, 8.8.8.8:53", "8.8.8.8", 53, "NOT");
  attempt("MinIO (the bucket), by name", "minio", 9000, "NOT");
  attempt("the inbox", "inbox", 8788, "NOT");
  attempt("the relay", "relay", 8795, "NOT");
  attempt("ops", "ops", 80, "NOT");
  attempt("its own Guard's admin port (loopback only, so from outside)", "g-glow-salon-razorpay", 8082, "NOT");
  for (const svc of ["g-glow-salon-razorpay", "g-glow-salon-whatsapp", "g-glow-salon-calendar", "g-model", "door-glow-salon"]) {
    const ip = adminIpOf(svc);
    for (const port of svc.startsWith("door") ? [8780] : [8190, 8080, 8081]) attempt(`${svc}'s address ${ip} on the admin network, port ${port}`, ip, port, "NOT");
  }
  if (shops > 1) {
    const other = shopName(2);
    attempt(`shop ${other}'s razorpay Guard, by name`, `g-${other}-razorpay`, 8080, "NOT");
    attempt(`shop ${other}'s razorpay Guard, by address ${adminIpOf(`g-${other}-razorpay`)}`, adminIpOf(`g-${other}-razorpay`), 8080, "NOT");
    attempt(`shop ${other}'s runtime, by name`, `rt-${other}`, 8780, "NOT");
    const otherNet = ipOf(`rt-${other}`, `net-${other}`);
    attempt(`shop ${other}'s runtime, by its own address ${otherNet}`, otherNet, 8780, "NOT");
    attempt(`shop ${other}'s whatsapp Guard, by name`, `g-${other}-whatsapp`, 8080, "NOT");
  }
  // and the owner of a shop cannot use the other shop's number: the WhatsApp Guard of shop 1 refuses shop 2's phone number id
  const agent = readSecret("rt-glow-salon", "agent_whatsapp");
  const send = (phone: string) => nodeEval(rt, `fetch('http://g-glow-salon-whatsapp:8080/v21.0/${phone}/messages',{method:'POST',headers:{authorization:'Bearer ${agent}','content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:'919800000000',type:'text',text:{body:'hello'}})}).then(async r=>console.log(r.status+' '+(await r.text()).slice(0,160)))`).out.trim();
  const own = send(phoneOf(1)); const foreign = send(phoneOf(2));
  // "let through" means Guard did not refuse: the stand-in's own answer (here its 24-hour-window rule, HTTP 400) has no `guard` object in it
  check("the WhatsApp Guard lets the shop's own number through to the provider", !/"guard":/u.test(own) && !own.startsWith("403") && !own.startsWith("503"), own.slice(0, 120));
  check("the WhatsApp Guard refuses another shop's number (exact allowlist)", foreign.startsWith("403") && /own-number-only/u.test(foreign) && /"guard":/u.test(foreign + '"guard":'), foreign.slice(0, 160));
  results[`isolation${shops}`] = rows; save();
}

/** The panel's own agent at each Guard: its connection-check reads and nothing else, and its network holds nothing else it could use. */
async function panelAccess(shops: number) {
  say(`\n== the panel's access (${shops} shop(s)) ==`);
  const from = "panel-probe";
  const call = (shop: string, kind: string, method: string, path: string, body?: unknown) => {
    const token = readSecret("panel", "guard_agent_token"); // one token for the panel, presented to every Guard (the panel reads a single file)
    const r = nodeEval(from, `fetch('http://g-${shop}-${kind}:8080${path}',{method:'${method}',headers:{authorization:'Bearer ${token}','content-type':'application/json'}${body ? `,body:${JSON.stringify(JSON.stringify(body))}` : ""}}).then(async r=>console.log(r.status+' '+(await r.text()).slice(0,100)))`);
    return r.out.trim() || r.err.trim().slice(0, 120);
  };
  const shop = "glow-salon";
  // allowed = Guard passed it on. This branch's stand-ins have no such GET endpoints (the panel branch adds them), so the stand-in's own 404 is the other good answer.
  const passedOn = (a: string) => a.startsWith("200") || (a.startsWith("404") && /the stand-ins have no GET/u.test(a));
  const wa = call(shop, "whatsapp", "GET", `/v26.0/${phoneOf(1)}?fields=id,display_phone_number`), cal = call(shop, "calendar", "GET", `/calendar/v3/calendars/${encodeURIComponent(calendarOf(1))}`);
  check("the panel reads the shop's WhatsApp number through its Guard (passed on to the provider)", passedOn(wa), wa.slice(0, 100));
  check("the panel reads the shop's calendar through its Guard (passed on to the provider)", passedOn(cal), cal.slice(0, 100));
  const events = call(shop, "calendar", "GET", `/calendar/v3/calendars/${encodeURIComponent(calendarOf(1))}/events?maxResults=1`);
  check("the panel lists one event of the shop's calendar through its Guard (the second half of its calendar check: that is where the access role comes back)", passedOn(events), events.slice(0, 100));
  const otherEvents = shops > 1 ? call(shop, "calendar", "GET", `/calendar/v3/calendars/${encodeURIComponent(calendarOf(2))}/events?maxResults=1`) : "";
  if (shops > 1) check("and cannot list another shop's calendar through this shop's Guard (exact allowlist)", /^403/u.test(otherEvents), otherEvents);
  check("the panel reads the shop's payment links through its Guard", call(shop, "razorpay", "GET", "/v1/payment_links?reference_id=geometer-connection-check").startsWith("200"), "");
  const send = call(shop, "whatsapp", "POST", `/v26.0/${phoneOf(1)}/messages`, { messaging_product: "whatsapp", to: "919800000000", type: "text", text: { body: "hi" } });
  check("the panel cannot SEND a message (its agent is not allowed that operation)", /^403/u.test(send) || /^40[13]/u.test(send), send);
  const link = call(shop, "razorpay", "POST", "/v1/payment_links", { amount: 20000, currency: "INR", description: "x", reference_id: "from-the-panel" });
  check("the panel cannot create a payment link", /^40[13]/u.test(link), link);
  const book = call(shop, "calendar", "POST", `/calendar/v3/calendars/${encodeURIComponent(calendarOf(1))}/events`, { summary: "x" });
  check("the panel cannot write to the calendar", /^40[13]/u.test(book), book);
  const other = shops > 1 ? call(shop, "whatsapp", "GET", `/v26.0/${phoneOf(2)}?fields=id`) : "";
  if (shops > 1) check("and cannot read another shop's number through this shop's Guard (exact allowlist)", /^403/u.test(other), other);
  const R = (label: string, host: string, port: number) => { const got = probe(from, host, port); check(`from the panel's network: ${label} -> ${got}`, UNREACHABLE.test(got), got); };
  R("the shop's runtime, by name", "rt-glow-salon", 8780);
  R("the shop's runtime door", adminIpOf("door-glow-salon"), 8780);
  R("the razorpay Guard's admin forwarder (its admin-network address)", adminIpOf("g-glow-salon-razorpay"), 8190);
  R("the model Guard", "g-model", 8080);
  R("the inbox", "inbox", 8788);
  R("ops", "ops", 80);
  R("a public address", "1.1.1.1", 443);
  R("the stand-in provider", "standins", 8790);
  const reach = probe(from, "g-glow-salon-razorpay", 8080);
  check("a control: the panel's network does reach the Guards' agent ports", reach === "REACHED", reach);
}

/** What the panel reads and writes: a stop request, the status file, the exports. */
async function deployerOutputs() {
  say("\n== the panel's inputs and outputs ==");
  const { processStopRequests, refreshStatuses } = await import("../../apply.ts");
  const { runExports } = await import("../../backup/jobs.ts");
  const ctx = ctxFor();
  const before = readStatus(SERVER, "glow-salon")!;
  await sleep(1100);
  const refreshed = await refreshStatuses(ctx);
  const after = readStatus(SERVER, "glow-salon")!;
  check("the deployer's status refresh confirms the shop from its running Guards (updatedAt moves, N of M from the Guards)", refreshed.includes("glow-salon") && after.updatedAt !== before.updatedAt && after.limits!.proven === after.limits!.of && after.limits!.of > 0, { proven: after.limits?.proven, of: after.limits?.of, updatedAt: after.updatedAt });
  const exp = await runExports(ctx); exp.lines.forEach(say);
  const dir = join(SERVER, "exports", "glow-salon");
  const files = ["record.json", "bookings.json"].map((f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown[]; } catch { return undefined; } });
  check("the record and the bookings are exported for the monthly report, as lists, with no phone number in them", files.every((f) => Array.isArray(f)) && !/\+?91\d{10}/u.test(JSON.stringify(files)), { record: files[0]?.length, bookings: files[1]?.length });
  mkdirSync(join(SERVER, "requests"), { recursive: true });
  const request = join(SERVER, "requests", "glow-salon.stop.json");
  writeFileSync(request, JSON.stringify({ schema: 1, requestId: "req-proof-1", shop: "glow-salon", requestedAt: new Date().toISOString(), requestedBy: { id: "acct-1", name: "Divya", role: "partner" } }));
  const done = await processStopRequests(ctx);
  const status = readStatus(SERVER, "glow-salon")!;
  const killed = JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", "g-glow-salon-whatsapp", "GET", "/admin/status"]).out.trim().split("\n").at(-1) ?? "{}").body?.kill_switch;
  check("a stop request from the panel is carried out on the Guards, shown in status with its request id, and then removed", done.includes("glow-salon") && status.stopped?.requestId === "req-proof-1" && killed?.on === true && !existsSync(request), { requestId: status.stopped?.requestId, by: status.stopped?.by, reason: killed?.reason });
  await main(["start", "glow-salon", "--server", SERVER], ctx);
}

async function killUnderLoad() {
  say("\n== kill the Razorpay Guard under load ==");
  const rt = "rt-glow-salon";
  const agent = readSecret(rt, "agent_razorpay");
  const link = () => JSON.parse(nodeEval("ops", `fetch('http://standins:8790/_standin/state').then(r=>r.json()).then(j=>console.log(JSON.stringify({links:j.links.length,refunds:j.refunds.length})))`).out.trim().split("\n").at(-1) ?? "{}") as { links: number; refunds: number };
  const before = link();
  // 12 requests a second for 24 s from inside the runtime; the Guard is killed 8 s in
  const load = `let ok=0,refused=0,unreachable=0,other=0;const t0=Date.now();const log=[];
(async()=>{while(Date.now()-t0<24000){const started=Date.now()-t0;try{const r=await fetch('http://g-glow-salon-razorpay:8080/v1/payment_links',{method:'POST',headers:{authorization:'Bearer ${agent}','content-type':'application/json'},body:JSON.stringify({amount:20000,currency:'INR',description:'load',reference_id:'load-'+started+'-'+Math.random()}),signal:AbortSignal.timeout(2500)});if(r.status===200||r.status===201)ok++;else if(r.status===403||r.status===503)refused++;else other++;await r.arrayBuffer()}catch(e){unreachable++}await new Promise(r=>setTimeout(r,80))}
console.log(JSON.stringify({ok,refused,unreachable,other}))})()`;
  const child = spawn("docker", ["compose", "-f", composeFile, "-f", testCompose, "--project-directory", join(SERVER, "generated"), "exec", "-T", rt, "node", "-e", load], { stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", (c: Buffer) => { out += c.toString(); });
  await sleep(8000);
  const midLinks = link();
  const killedAt = Date.now();
  dk(["stop", "-t", "0", containerOf("g-glow-salon-razorpay")]); // stopped by hand: Docker does not restart it, so the window is the whole rest of the load
  const afterKillLinks = link();
  await new Promise<void>((resolve) => child.on("close", () => resolve()));
  const after = link();
  const counts = JSON.parse(out.trim().split("\n").at(-1) ?? "{}");
  say(`load results: ${JSON.stringify(counts)}; links at the stand-in: before ${before.links}, 8 s in ${midLinks.links}, just after the kill ${afterKillLinks.links}, at the end ${after.links}`);
  check("under load, some calls went through before the kill", midLinks.links > before.links, { before: before.links, mid: midLinks.links });
  check("after the Razorpay Guard was stopped NOTHING reached the Razorpay stand-in", after.links === afterKillLinks.links && counts.unreachable > 0, { atKill: afterKillLinks.links, atEnd: after.links, unreachable: counts.unreachable, afterSeconds: Math.round((Date.now() - killedAt) / 1000) });
  results.killUnderLoad = { before, midLinks, afterKillLinks, after, counts };
  dc(["up", "-d", "g-glow-salon-razorpay"]);
  await waitFor("the Guard to be ready again", () => healthy("g-glow-salon-razorpay"), 90);
  check("the Guard comes back when started again", healthy("g-glow-salon-razorpay"), "");
  // and a crash (SIGKILL) is restarted by Docker on its own, in the same namespace
  dk(["kill", "--signal", "SIGABRT", containerOf("g-glow-salon-razorpay")]); // a real crash (the process dies); `docker kill` with SIGKILL counts as stopping it by hand, and Docker then does not restart it
  const back = await waitFor("the crashed Guard to be restarted by Docker", () => healthy("g-glow-salon-razorpay"), 90);
  const reach = nodeEval(rt, `fetch('http://g-glow-salon-razorpay:8080/v1/payment_links',{headers:{authorization:'Bearer ${agent}'}}).then(r=>console.log(r.status))`).out.trim();
  check("a crashed Guard is restarted by Docker and answers its runtime again (the forwarder owns the namespace)", back && /^(200|403)$/u.test(reach), reach);
}

function approvalFlow(approvalId: string, decision: "approve" | "deny" = "approve") {
  const secret = readSecret("relay", "glow-salon/owner_notify_secret");
  const ip = adminIpOf("g-glow-salon-razorpay");
  const code = `const c=require('crypto');const raw=JSON.stringify({approval:'${approvalId}',decision:'${decision}',approver:'owner-glow-salon',at_ms:String(Date.now()),nonce:c.randomUUID()});const sig=c.createHmac('sha256','${secret}').update(raw).digest('hex');fetch('http://${ip}:8190/admin/notify',{method:'POST',body:raw,headers:{'content-type':'application/json','x-geo-signature':sig}}).then(async r=>console.log(r.status+' '+(await r.text()).slice(0,120)))`;
  return nodeEval("relay", code).out.trim();
}

async function heldRefundSurvives() {
  say("\n== a held refund survives restarting the runtime and the Guard ==");
  const rt = "rt-glow-salon";
  const agent = readSecret(rt, "agent_razorpay");
  const call = (method: string, path: string, body?: unknown) => { const r = nodeEval(rt, `fetch('http://g-glow-salon-razorpay:8080${path}',{method:'${method}',headers:{authorization:'Bearer ${agent}','content-type':'application/json'}${body ? `,body:${JSON.stringify(JSON.stringify(body))}` : ""}}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json().catch(()=>null)})))`); try { return JSON.parse(r.out.trim().split("\n").at(-1) ?? "{}") as { status: number; body: any }; } catch { return { status: 0, body: r.err }; } };
  const stand = (path: string, body?: unknown) => JSON.parse(nodeEval("ops", `fetch('http://standins:8790${path}',{${body ? `method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}` : ""}}).then(r=>r.text()).then(t=>console.log(t))`).out.trim().split("\n").at(-1) ?? "{}");
  const created = call("POST", "/v1/payment_links", { amount: 20000, currency: "INR", description: "deposit", reference_id: "held-1" });
  const linkId = created.body?.id;
  const paid = stand("/_standin/razorpay/pay", { link_id: linkId, deliver: false });
  const paymentId = paid.payment?.id;
  const refund = { amount: 15000, speed: "normal", receipt: "b-1:pay" };
  const held = call("POST", `/v1/payments/${paymentId}/refund`, refund);
  const approval = held.body?.guard?.detail?.approval;
  check("a refund above the owner's limit is HELD by Guard (202, nothing refunded)", held.status === 202 && held.body?.guard?.decision === "hold" && typeof approval === "string" && (stand("/_standin/state").refunds?.length ?? 1) === 0, { status: held.status, approval, expiresInHours: held.body?.guard?.detail?.expires_at_ms ? +((held.body.guard.detail.expires_at_ms - Date.now()) / 3_600_000).toFixed(1) : null });
  // restart the Guard (its store is on a volume), then the runtime
  dc(["restart", "g-glow-salon-razorpay"]); await waitFor("the Guard", () => healthy("g-glow-salon-razorpay"), 90);
  dc(["restart", "rt-glow-salon"]); await waitFor("the runtime", () => healthy("rt-glow-salon"), 90);
  const again = call("POST", `/v1/payments/${paymentId}/refund`, refund);
  check("after both restarts the same refund is still held, under the SAME approval", again.status === 202 && again.body?.guard?.detail?.approval === approval, { status: again.status, same: again.body?.guard?.detail?.approval === approval });
  const renewed = [await renewRelayCredential(ctxFor(), "glow-salon"), await renewRelayCredential(ctxFor(), "glow-salon")];
  const reviews = nodeEval("relay", `fetch('http://${adminIpOf("g-glow-salon-razorpay")}:8190/admin/reviews',{headers:{authorization:'Bearer ${readSecret("relay", "glow-salon/read_token")}'}}).then(async r=>console.log(r.status+' '+(await r.text())))`).out.trim();
  check("the relay's reading credential can be renewed twice, and the renewed one lists the held refund", renewed.every(Boolean) && reviews.startsWith("200") && reviews.includes(approval), { renewed, reviews: reviews.slice(0, 80) });
  const answer = typeof approval === "string" ? approvalFlow(approval) : "no approval id to answer";
  check("the owner's signed approval is accepted after the restarts", answer.startsWith("200"), answer);
  const sent = call("POST", `/v1/payments/${paymentId}/refund`, refund);
  const refunds = stand("/_standin/state").refunds?.length;
  check("the identical retry then goes through, exactly once", sent.status === 200 && refunds === 1, { status: sent.status, refundsAtProvider: refunds });
  const repeat = call("POST", `/v1/payments/${paymentId}/refund`, refund);
  check("and a repeat of it is answered from Guard's record: nothing is sent again", (repeat.status === 200 || repeat.status === 409 || repeat.status === 202) && stand("/_standin/state").refunds?.length === 1, { status: repeat.status });
}

async function tripwireForced(fleetAdmin: string | undefined, fleetLog: string) {
  say("\n== a forced tripwire failure ==");
  const status = (service: string) => JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", service, "GET", "/admin/status"]).out.trim().split("\n").at(-1) ?? "{}");
  const readyz = () => nodeEval("ops", `fetch('http://${adminIpOf("g-glow-salon-razorpay")}:8081/readyz').then(r=>console.log(r.status))`).out.trim();
  check("before: /readyz is 200", readyz() === "200", "");
  const original = status("g-glow-salon-razorpay").body?.policy?.digest;
  // another process writes a policy for ANOTHER tool into this Guard's store, as a second replica on a shared store could: the case the tripwires exist for
  const volume = (s: string) => `${PROJECT}_gs-glow-salon-${s}`;
  const forge = (activate: string) => dk(["run", "--rm", "--user", "65532:65532", "-v", `${volume("razorpay")}:/a`, "-v", `${volume("whatsapp")}:/b:ro`, "node:26-alpine", "node", "-e",
    `const {DatabaseSync}=require('node:sqlite');const b=new DatabaseSync('/b/state.db',{readOnly:true});const row=b.prepare("select * from bundles where tenant='glow-salon' order by added_ms desc limit 1").get();const a=new DatabaseSync('/a/state.db');a.exec('PRAGMA busy_timeout=5000');
const act=${JSON.stringify(activate)}==='other'?row.digest:${JSON.stringify(original)};if(${JSON.stringify(activate)}==='other')a.prepare("INSERT OR IGNORE INTO bundles(digest,version,tenant,bytes,added_ms) VALUES(?,?,?,?,?)").run(row.digest,99,row.tenant,row.bytes,Date.now());
a.prepare("INSERT INTO policy_log(digest,action,at_ms,note) VALUES(?,?,?,?)").run(act,'activate',Date.now(),'forced by the proof');const gen=a.prepare("select max(gen) g from policy_log").get().g;a.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('generation',?)").run(String(gen));a.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('active_digest',?)").run(act);console.log('ok')`]);
  const f = forge("other");
  say(`forged: ${f.out.trim()} ${f.err.trim().slice(0, 200)}`);
  exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", "g-glow-salon-razorpay", "POST", "/admin/reload", "{}"]);
  let r = readyz();
  if (r === "200") { // a call under a policy the tripwires have not seen runs them on the spot
    nodeEval("rt-glow-salon", `fetch('http://g-glow-salon-razorpay:8080/v1/payment_links',{headers:{authorization:'Bearer ${readSecret("rt-glow-salon", "agent_razorpay")}'}}).then(r=>console.log(r.status))`);
    await waitFor("/readyz to turn 503", () => (r = readyz()) === "503", 40);
  }
  check("a failed tripwire turns /readyz to 503", r === "503", { readyz: r });
  const tw = status("g-glow-salon-razorpay").body?.tripwires;
  check("the Guard says which tripwires failed", tw?.ok === false && Array.isArray(tw?.failed) && tw.failed.length > 0, { passed: tw?.passed, of: tw?.of, failed: tw?.failed });
  const call = nodeEval("rt-glow-salon", `fetch('http://g-glow-salon-razorpay:8080/v1/payment_links',{method:'POST',headers:{authorization:'Bearer ${readSecret("rt-glow-salon", "agent_razorpay")}','content-type':'application/json'},body:JSON.stringify({amount:20000,currency:'INR',description:'x',reference_id:'x-'+Math.random()})}).then(async r=>console.log(r.status+' '+(await r.text()).slice(0,200)))`).out.trim();
  check("and while it is failed every call is refused", call.startsWith("503") && /self-check failed/u.test(call), call.slice(0, 160));
  // the heartbeat says not ready, and fleet's "Guard stopped" alert fires
  const heartbeat = await waitFor("fleet to hear the Guard is not ready", () => /guard_not_ready|Guard stopped|not ready/iu.test(readFileSync(fleetLog, "utf8")), 90);
  const logLines = readFileSync(fleetLog, "utf8").split("\n").filter((l) => /guard|alert/iu.test(l)).slice(-6);
  check("fleet's alert for a Guard that is not ready fires (from the heartbeat the bundle sent)", heartbeat, logLines);
  if (fleetAdmin) {
    const dep = nodeEval("ops", `fetch('http://host.docker.internal:18790/v1/deployments',{headers:{authorization:'Bearer ${fleetAdmin}'}}).then(r=>r.text()).then(t=>console.log(t.slice(0,1500)))`).out.trim();
    results.fleetDeployments = dep.slice(0, 1200);
  }
  forge("original"); dc(["restart", "g-glow-salon-razorpay"]);
  await waitFor("the Guard to recover", () => readyz() === "200", 90);
  check("with the right policy back, /readyz is 200 again", readyz() === "200", "");
}

async function webhookThroughCaddy() {
  say("\n== a signed webhook through Caddy ==");
  const body = JSON.stringify({ event: "payment.captured", created_at: Math.floor(Date.now() / 1000), payload: { payment: { entity: { id: "pay_proof_1", order_id: "order_x", amount: 20000, currency: "INR", status: "captured", notes: {} } } } });
  const sig = (secret: string) => createHmac("sha256", secret).update(body).digest("hex");
  const post = (shop: string, secret: string) => sh("curl", ["-sk", "-o", "/dev/null", "-w", "%{http_code}", "-X", "POST", `https://localhost:18443/c/${shop}/webhooks/razorpay`, "-H", "content-type: application/json", "-H", `x-razorpay-signature: ${sig(secret)}`, "-H", `x-razorpay-event-id: evt_proof_${Math.random()}`, "--data-binary", body]).out;
  const tasks = () => { try { const o = JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "observe"]).out.trim().split("\n").at(-1) ?? "{}") as { shops: { id: string; status?: { tasks?: { pending: number; done: number; failed: number } } }[] }; const t = o.shops.find((s) => s.id === "glow-salon")?.status?.tasks; return (t?.pending ?? 0) + (t?.done ?? 0) + (t?.failed ?? 0); } catch { return -1; } };
  const before = tasks();
  const good = post("glow-salon", readSecret("inbox", "glow-salon/razorpay_webhook_secret"));
  await sleep(2000);
  check("and the runtime saved it (Caddy -> inbox -> door -> runtime)", tasks() === before + 1, { before, after: tasks() });
  const wrong = post("glow-salon", "not-the-secret-of-this-shop");
  const nothing = sh("curl", ["-sk", "-o", "/dev/null", "-w", "%{http_code}", "https://localhost:18443/webhooks/razorpay"]).out;
  check("Caddy -> inbox -> runtime: a correctly signed webhook is accepted", good === "200", good);
  // the unprefixed path is not the inbox's: it goes to the panel (404 from it) or, in a checkout with no panel program, to nothing behind Caddy (502)
  check("a wrongly signed webhook is refused, and the unprefixed path is not served", wrong === "401" && (nothing === "404" || nothing === "502"), { wrong, nothing });
}

async function stopPersists() {
  say("\n== stop ==");
  const code = await main(["stop", "glow-salon", "--reason", "proof", "--server", SERVER], ctxFor());
  const st = (s: string) => JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", s, "GET", "/admin/status"]).out.trim().split("\n").at(-1) ?? "{}").body?.kill_switch;
  check("stop engages the kill switch on the shop's Guards", code === 0 && st("g-glow-salon-razorpay")?.on === true && st("g-glow-salon-whatsapp")?.on === true, st("g-glow-salon-razorpay"));
  check("the stop record says who", /stopped by \S+@\S+/u.test(st("g-glow-salon-razorpay")?.reason ?? "") && readStatus(SERVER, "glow-salon")?.stopped?.by !== undefined, st("g-glow-salon-razorpay")?.reason);
  dc(["restart", "g-glow-salon-razorpay"]); await waitFor("the Guard", () => healthy("g-glow-salon-razorpay"), 90);
  check("the kill switch survives a restart of the Guard", st("g-glow-salon-razorpay")?.on === true, "");
  const refused = nodeEval("rt-glow-salon", `fetch('http://g-glow-salon-razorpay:8080/v1/payment_links',{method:'POST',headers:{authorization:'Bearer ${readSecret("rt-glow-salon", "agent_razorpay")}','content-type':'application/json'},body:JSON.stringify({amount:20000,currency:'INR',description:'x',reference_id:'y'})}).then(async r=>console.log(r.status))`).out.trim();
  check("a stopped shop's Guard refuses new calls", refused === "503", refused);
  await main(["start", "glow-salon", "--server", SERVER], ctxFor());
}

async function dataDuties() {
  say("\n== continuous copy, nightly snapshot, drill, restore ==");
  const objects = (dir: string) => sh("find", [join(SCRATCH, "minio", dir), "-type", "f", "-not", "-name", "xl.meta.tmp"]).out.trim().split("\n").filter(Boolean).length;
  await waitFor("Litestream to copy", () => objects("geo-stream") > 0, 60);
  check("Litestream is streaming the runtime database to the bucket", objects("geo-stream") > 0, { objects: objects("geo-stream") });
  const snap = await runBackup(ctxFor()); snap.lines.forEach(say);
  check("the nightly snapshot ran and every file in the bucket is age-encrypted", snap.ok && objects("geo-snaps") > 0, { objects: objects("geo-snaps") });
  // MinIO stores objects as xl.meta and part files (small ones inline); the bytes of an age file are in them as written, and a plain SQLite file would show its header
  const grep = (pattern: string, dir: string) => sh("sh", ["-c", `grep -rlaF "${pattern}" "${join(SCRATCH, "minio", dir)}" | wc -l`]).out.trim();
  const ageFiles = Number(grep("age-encryption.org/v1", "geo-snaps")), plainFiles = Number(grep("SQLite format 3", "geo-snaps")), plainStream = Number(grep("SQLite format 3", "geo-stream"));
  check("every snapshot object is an age file and none holds a plain SQLite database", ageFiles > 0 && plainFiles === 0, { ageFiles, plainFiles });
  results.streamHoldsPlainSqlite = plainStream; say(`(the continuous copy is not age-encrypted by Litestream 0.5: ${plainStream} plain-SQLite-looking objects in the stream bucket)`);
  const drill = await runDrill(ctxFor()); drill.lines.forEach(say);
  check("the weekly drill restores the continuous copy and it matches the live record", drill.ok, drill.lines);
  // restore: add a record entry, then put the record back from the copy
  check("restore puts the record back from the continuous copy", (await restoreShop(ctxFor(), "glow-salon", {}).then((m) => { say(m); return true; }).catch((e) => { say(String(e)); return false; })), "");
  await waitFor("the runtime", () => healthy("rt-glow-salon"), 90);
  check("the shop is running again after a restore", healthy("rt-glow-salon"), "");
  // age interop with the real tool
  const k = generateIdentity(); const dir = join(SCRATCH, "age"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "id.txt"), k.identity); writeFileSync(join(dir, "ours.age"), encrypt(Buffer.from("hello from node ".repeat(10000)), k.recipient));
  const real = dk(["run", "--rm", "-v", `${dir}:/w`, "alpine:3.22", "sh", "-c", `apk add --no-cache age >/dev/null 2>&1 && age -d -i /w/id.txt /w/ours.age | head -c 16 && age -r ${k.recipient} -o /w/theirs.age /w/id.txt && echo && echo made`], { timeout: 180_000 });
  const theirs = (() => { try { return decrypt(readFileSync(join(dir, "theirs.age")), k.identity).toString().startsWith("AGE-SECRET-KEY"); } catch { return false; } })();
  check("the real `age` opens what this writes, and this opens what `age` writes", real.out.startsWith("hello from node") && theirs, real.err.slice(0, 120) || real.out.slice(0, 40));
}

async function modelGuard() {
  say("\n== the model Guard ==");
  const rt = "rt-glow-salon";
  const agent = readSecret(rt, "agent_model");
  const ask = (model: string) => nodeEval(rt, `fetch('http://g-model:8080/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer ${agent}','content-type':'application/json'},body:JSON.stringify({model:'${model}',messages:[{role:'user',content:'hi'}]})}).then(async r=>console.log(r.status+' '+(await r.text()).slice(0,100)))`).out.trim();
  const pinned = ask("gpt-4o-mini"); const other = ask("gpt-5-expensive");
  check("the model Guard lets the pinned model through with the server's key", pinned.startsWith("200"), pinned);
  check("and refuses any other model", other.startsWith("403"), other);
}

if (import.meta.main) {
  try { await main_(); } catch (e) { say(`\nTHE PROOF STOPPED: ${(e as Error).stack ?? e}`); results.error = String(e); }
  finally {
    results.finishedAt = new Date().toISOString();
    results.summary = { passed: (results.checks as { ok: boolean }[]).filter((c) => c.ok).length, failed: (results.checks as { ok: boolean }[]).filter((c) => !c.ok).map((c) => (c as unknown as { name: string }).name) };
    save();
    if (!KEEP) {
      say("\n== cleanup ==");
      dc(["down", "-v", "--remove-orphans", "--timeout", "10"], { timeout: 600_000 });
      for (const row of dk(["ps", "-a", "--filter", "name=geometer-job", "-q"]).out.trim().split("\n").filter(Boolean)) dk(["rm", "-f", row]);
      for (const v of dk(["volume", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean)) dk(["volume", "rm", "-f", v]);
      for (const n of dk(["network", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean)) dk(["network", "rm", n]);
      say(`left behind: containers ${dk(["ps", "-a", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean).length}, volumes ${dk(["volume", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean).length}, networks ${dk(["network", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean).length}`);
    }
    say(`\n${JSON.stringify(results.summary)}`);
    process.exit((results.summary as { failed: string[] }).failed.length === 0 && !results.error ? 0 : 1);
  }

}
