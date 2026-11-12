// The B14 proof and the load measurement, on real Docker. ONE script, meant to be run inside ONE hold of the heavy lock:
//
//   /path/to/heavy.sh node bundle/test/proof/run.ts [--shops 1,5,10,25] [--only phase,phase] [--load-seconds 120] [--keep]
//
// It builds a throwaway server folder, brings the real bundle up with docker compose (the real Guard image, one set of stand-ins per shop as the providers, MinIO
// as the bucket, the real fleet service on the host), and records what it sees in $PROOF_DIR/results.json and results.txt. Every bundle container runs inside
// ONE parent cgroup capped at 2 CPUs and 4 GiB (the 2 vCPU / 4 GB server of B14 item 4; the stand-ins, MinIO and the probes are outside it). Everything it creates
// is named geometer-proof-* and is removed at the end (volumes, networks, containers, the cgroup); it never deletes an image. The `agent` phase (B51) adds an agent
// someone else wrote (proof-agent, the example agent run from this machine through Caddy) beside the shops, and keeps it for the phases after it.
//
// The Guard image must read `[licence]` and have RFC 8032's published test key built in (monorepo ADR-0062): the proof pins that key in geometer.json and signs
// its leases with it (test/licence-helpers.ts). GUARD_IMAGE names the image (default geo-guard:local-b14, built locally, never pushed). Since decision 39 (monorepo
// ADR-0070) a shop the lease does not list has no licence at its Guards, so the proof sets the server up the new way: `init --licence-key` (what pairing gives),
// then the lease pairing and the first heartbeat would bring, listing every shop the proof may add, written before the first deploy.
import { spawn, spawnSync } from "node:child_process";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
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
import { runBackup, runDrill, restoreAgent, restoreShop } from "../../backup/jobs.ts";
import { addAgent, deployAgent } from "../../agent/deploy.ts";
import { recordAgent } from "../../agent/records.ts";
import { decrypt, encrypt, generateIdentity } from "../../backup/age.ts";
import { loadState } from "../../lib/state.ts";
import { clientLicenceFile, licencePaths, syncLicence } from "../../lib/licence.ts";
import { loadServer } from "../../lib/server.ts";
import { yaml } from "../../generate/compose.ts";
import type { Runner } from "../../lib/runner.ts";
import { TEST_PUBLIC_HEX, signTest } from "../licence-helpers.ts";
import { AGENT_INDEX, AGENT_NAME, OWNER, calendarOf, phoneOf, secretsOf, shopName } from "./shops.ts";

const APP = new URL("../../../", import.meta.url).pathname.replace(/\/$/u, "");
const EXAMPLE = join(APP, "templates/commerce/bookings/clients/glow-salon.example");
const MONOREPO = process.env.GEOMETER_MONOREPO ?? "/Users/navaltharun/Work/geometer/monorepo";
const SCRATCH = process.env.PROOF_DIR ?? mkdtempSync(join(tmpdir(), "geometer-proof-"));
const GUARD_IMAGE = process.env.GUARD_IMAGE ?? "geo-guard:local-b14";
const args = process.argv.slice(2);
const SIZES = (args.includes("--shops") ? args[args.indexOf("--shops") + 1] : "1,5,10,25").split(",").map(Number);
const KEEP = args.includes("--keep");
/** `--only kill,licence`: run those phases (and the deploy of one shop they need); the default is every phase. */
const ONLY = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : undefined;
const runs = (phase: string) => !ONLY || ONLY.has(phase);
/** The reference_id prefix of the payment links the kill phase makes by calling a Guard directly (no runtime, no booking): the outage phase's per-booking check leaves them out. */
const RAW_LOAD_REF = "load-";
const LOAD_SECONDS = args.includes("--load-seconds") ? Number(args[args.indexOf("--load-seconds") + 1]) : 120;
/** `--heartbeat 10`: the heartbeat every 10 s. Left out, the real default: the disk-write and CPU figures are then what a real shop would see. */
const HEARTBEAT = args.includes("--heartbeat") ? Number(args[args.indexOf("--heartbeat") + 1]) : undefined;
const SERVER = join(SCRATCH, "server");
/** What the stand-in WhatsApp answers for any phone number id (modules/standins/whatsapp.ts). */
const STANDIN_BUSINESS_NUMBER = "+15550000000";
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
  const files: Record<string, string> = { ...secretsOf(i), "google_service_account.json": SA(i) };
  for (const [n, v] of Object.entries(files)) writeFileSync(join(inbox, n), v);
}

// ---------------------------------------------------------------------------------------------------------------------------------- the machine

function ctxFor(tool?: GuardTool): Context {
  return { dir: SERVER, appDir: APP, runner: cappedRunner, tool: tool ?? dockerGuardTool(GUARD_IMAGE, realRunner, join(SERVER, "state", "work")), log: say, now: () => new Date(), sleep, docker: "docker", waitSeconds: 150, extraComposeFiles: [testCompose] };
}

// ---------------------------------------------------------------------------------------------------------------------------------- the 2 CPU / 4 GiB cap

/** The parent cgroup every bundle container is started in (cgroup v2, Docker's cgroupfs driver), and its limits: the B14 server's 2 vCPUs and 4 GiB. */
const CAP_CGROUP = "geometer-proof-cap";
const CAP = { cpus: 2, memoryBytes: 4 * 1024 ** 3 };
/** The test's own containers (stand-ins, bucket, probe): outside the cap, as the providers and the bucket are outside a real server. */
const TEST_SERVICES = new Set(["standins", "minio", "panel-probe"]);

/** The services of the generated compose file, read from it (the keys under `services:`). */
function bundleServices(): string[] {
  if (!existsSync(composeFile)) return [];
  const lines = readFileSync(composeFile, "utf8").split("\n");
  const start = lines.indexOf("services:"); const end = lines.findIndex((l, i) => i > start && /^[a-z]/u.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).map((l) => /^  ([A-Za-z0-9_.-]+):$/u.exec(l)?.[1]).filter((x): x is string => !!x);
}

/** The test's compose file, merged over the generated one: the stand-ins, MinIO and the panel's probe, and every bundle service inside the capped cgroup. */
function writeTestCompose(): void {
  const user = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
  const services: Record<string, any> = {
    standins: { image: "node:26-alpine", user: "1000:1000", init: true, restart: "unless-stopped", command: ["node", "/app/bundle/test/proof/standins.ts"], volumes: [`${APP}:/app:ro`], networks: ["egress", "front"], ports: ["127.0.0.1:18791:8790"],
      healthcheck: { test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8791/_state"], interval: "3s", timeout: "3s", retries: 20, start_period: "3s" } },
    "panel-probe": { image: "node:26-alpine", user, command: ["sleep", "100000"], volumes: [`${join(SERVER, "secrets", "panel")}:/run/secrets:ro`], networks: ["panel"] },
    minio: { image: "minio/minio:latest", command: ["server", "/data"], environment: { MINIO_ROOT_USER: "proofkey", MINIO_ROOT_PASSWORD: "proofsecret123", MINIO_PROMETHEUS_AUTH_TYPE: "public" }, volumes: [`${join(SCRATCH, "minio")}:/data`], networks: ["egress"], ports: ["127.0.0.1:19000:9000"] },
  };
  for (const svc of bundleServices()) if (!TEST_SERVICES.has(svc)) services[svc] = { ...services[svc], cgroup_parent: `/${CAP_CGROUP}` };
  if (services.refresher) services.refresher.depends_on = { standins: { condition: "service_healthy" } };
  writeFileSync(testCompose, `${yaml({ services, networks: { egress: {}, front: {}, panel: {} } })}\n`);
}

/** The deployer's runner, with one addition for the test: before each `compose up`, the test's file names every service the generated file now has, so each is capped. */
const cappedRunner: Runner = { run(command, a, o) { if (command === "docker" && a[0] === "compose" && a.includes("up")) writeTestCompose(); return realRunner.run(command, a, o); } };

/** A privileged one-off in the Docker VM's own cgroup namespace (the only way to set a parent cgroup's limits on Docker Desktop). */
const inVm = (script: string) => dk(["run", "--rm", "--privileged", "--cgroupns=host", "-v", "/sys/fs/cgroup:/sys/fs/cgroup", "alpine:3.22", "sh", "-c", script], { timeout: 60_000 });
let capDir = "";
function setCap(): boolean {
  const r = inVm(`d=$(find /sys/fs/cgroup -maxdepth 4 -type d -name ${CAP_CGROUP} | head -1); [ -n "$d" ] || exit 3; echo ${CAP.cpus * 100000} 100000 > $d/cpu.max && echo ${CAP.memoryBytes} > $d/memory.max && echo $d && cat $d/cpu.max $d/memory.max`);
  capDir = r.out.trim().split("\n")[0] ?? "";
  results.cap = { dir: capDir, set: r.code === 0, cpuMax: r.out.trim().split("\n")[1], memoryMax: r.out.trim().split("\n")[2], note: "every bundle container is in this one cgroup; the Docker daemon, the VM's kernel and the test's stand-ins, MinIO and probes are not" };
  return r.code === 0;
}
interface CapReading { atMs: number; cpuUsec: number; memoryBytes: number; peakBytes: number; readBytes: number; writeBytes: number; oomKills: number; throttledUsec: number }
function readCap(): CapReading | undefined {
  if (!capDir) return undefined;
  const r = inVm(`cd ${capDir} && grep -E '^(usage_usec|throttled_usec) ' cpu.stat && echo mem $(cat memory.current) && echo peak $(cat memory.peak 2>/dev/null || echo 0) && echo oom $(grep '^oom_kill ' memory.events | cut -d' ' -f2) && awk '{for(i=2;i<=NF;i++){split($i,a,"=");if(a[1]=="rbytes")r+=a[2];if(a[1]=="wbytes")w+=a[2]}}END{print "io",r+0,w+0}' io.stat`);
  const v = (k: string) => Number(new RegExp(`^${k} (\\d+)`, "mu").exec(r.out)?.[1] ?? NaN);
  const io = /^io (\d+) (\d+)/mu.exec(r.out);
  return { atMs: Date.now(), cpuUsec: v("usage_usec"), memoryBytes: v("mem"), peakBytes: v("peak"), readBytes: Number(io?.[1] ?? NaN), writeBytes: Number(io?.[2] ?? NaN), oomKills: v("oom"), throttledUsec: v("throttled_usec") };
}
/**
 * What each bundle container has written so far (`io.stat`, its own cgroup), so the writes can be told apart: the runtime's SQLite, a Guard's evidence, ops. A container's cgroup
 * directory carries its id, which `docker ps` gives.
 */
function writesByContainer(): Map<string, number> {
  const out = new Map<string, number>();
  if (!capDir) return out;
  const names = dk(["ps", "--format", "{{.ID}} {{.Names}}", "--filter", `name=${PROJECT}-`]).out.trim().split("\n").map((l) => l.split(" "));
  const r = inVm(`cd ${capDir} && for d in */; do n=\${d%/}; w=$(awk '{for(i=2;i<=NF;i++){split($i,a,"=");if(a[1]=="wbytes")w+=a[2]}}END{print w+0}' "$d/io.stat" 2>/dev/null); echo "$n $w"; done`);
  for (const line of r.out.trim().split("\n")) {
    const [dir, w] = line.split(" ");
    const found = names.find(([id]) => dir?.includes(id));
    if (found) out.set(found[1].replace(`${PROJECT}-`, "").replace(/-1$/u, ""), Number(w));
  }
  return out;
}

/** MiB per hour per shop written in this window, by kind of container. */
function writesPerGroup(a: Map<string, number>, b: Map<string, number>, hours: number, shops: number): Record<string, number> {
  const by: Record<string, number> = {};
  for (const [name, after] of b) { const g = group(name); by[g] = (by[g] ?? 0) + (after - (a.get(name) ?? after)); }
  return Object.fromEntries(Object.entries(by).map(([g, bytes]) => [g, +((bytes / MiB) / shops / hours).toFixed(1)]));
}

const removeCap = () => inVm(`for d in $(find /sys/fs/cgroup -maxdepth 4 -type d -name ${CAP_CGROUP}); do rmdir $d; done; echo done`);

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
  // the agent someone else wrote (the agent phase) is counted apart, so the shops' per-shop figures stay comparable with the runs before it
  if (name.startsWith(`g-${AGENT_NAME}-`)) return "own agent's Guards";
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
  for (const image of ["busybox:1.37.0", "node:26-alpine", "caddy:2.8.4-alpine", "minio/minio:latest", "alpine:3.22", GUARD_IMAGE]) {
    const have = dk(["image", "inspect", "--format", "{{.Id}}", image]).code === 0;
    const pulled = have ? { code: 0, err: "" } : GUARD_IMAGE === image ? { code: 1, err: "the Guard image is not on this machine" } : dk(["pull", "-q", image], { timeout: 900_000 });
    check(`image ${image}`, pulled.code === 0, have ? "already here" : pulled.code === 0 ? "pulled" : pulled.err.slice(0, 120));
    if (pulled.code !== 0) throw new Error(`cannot go on without ${image}`);
  }
  results.imageVersions = Object.fromEntries(["busybox:1.37.0", "node:26-alpine", "caddy:2.8.4-alpine"].map((i) => [i, dk(["image", "inspect", "--format", "{{.Size}} bytes, {{.Architecture}}", i]).out.trim()]));
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
  // --licence-key: RFC 8032's published test key, the one built into the proof's Guard image (anyone can sign with it, never a production key); pairing gives a server its key
  let code = await main(["init", SERVER, "--id", "proof", "--domain", "localhost", "--reviewed-by", "builder-proof", "--model-wire", "openai", "--model", "gpt-4o-mini", "--http-port", "18080", "--https-port", "18443",
    "--snapshots-url", "s3://geo-snaps/proof", "--snapshots-endpoint", "http://minio:9000", "--age-identity-out", identityFile, "--fleet-url", "http://host.docker.internal:18790", "--fleet-key-file", "fleet_key", "--guard-image", GUARD_IMAGE, "--panel",
    "--licence-key", TEST_PUBLIC_HEX]);
  if (code !== 0) throw new Error("init failed");
  const conf = JSON.parse(readFileSync(join(SERVER, "geometer.json"), "utf8"));
  conf.upstreams = { razorpay: { host: "standins:8790", tls: false }, whatsapp: { host: "standins:8790", tls: false }, calendar: { host: "standins:8790", tls: false }, model: { host: "standins:8791", tls: false } };
  // the load must not meet the shops' own hourly caps (the proof measures the server, not the caps): every count is raised, and the report says so
  if (HEARTBEAT !== undefined) conf.heartbeatSeconds = HEARTBEAT;
  conf.panel = { enabled: true, mode: "own" }; conf.limits = { razorpayLinksPerHour: 1_000_000, whatsappMessagesPerHour: 1_000_000, calendarEventsCreatedPerHour: 1_000_000, calendarEventsDeletedPerDay: 1_000_000 };
  writeFileSync(join(SERVER, "geometer.json"), JSON.stringify(conf, null, 2));
  // the lease pairing and the first heartbeat would bring (the proof's fleet signs none: it has no licence key), every proof shop in order, before the first deploy
  handLease(1).forEach((l) => say(`   ${l}`));
  mkdirSync(join(SCRATCH, "minio", "geo-snaps"), { recursive: true });
  writeTestCompose();
  writeFileSync(join(SCRATCH, "model-key"), "sk-proof-model-key-0123456789\n"); writeFileSync(join(SCRATCH, "bucket-key"), "proofkey:proofsecret123\n");
  for (const a of [["model-key", join(SCRATCH, "model-key")], ["backup-key", "snapshots", join(SCRATCH, "bucket-key")]]) if (await main([...a, "--server", SERVER]) !== 0) throw new Error(`${a[0]} failed`);

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
    await sleep(70_000); // steady state: the first heartbeat is in, the model Guard has been quiet
    measure("1 shop (idle)", 1);

    check("every bundle container is inside one cgroup capped at 2 CPUs and 4 GiB", setCap(), results.cap);
    say(`   the cap: ${JSON.stringify(results.cap)}`);
    const phase = async (name: string, ...steps: (() => Promise<unknown>)[]) => {
      if (!runs(name)) return;
      for (const step of steps) { try { await step(); } catch (e) { check(`the ${name} phase ran to its end`, false, (e as Error).stack?.split("\n").slice(0, 3).join(" | ") ?? String(e)); } }
    };
    await phase("licence-block", licenceBlockOnGuards);
    await phase("panel", panelContainer, shopKeyMounts);
    await phase("isolation", () => isolation(1), hostileRuntime);
    await phase("panelAccess", () => panelAccess(1));
    await phase("kill", killUnderLoad, killEachGuardUnderLoad);
    await phase("outage", guardOutage);
    await phase("held", heldRefundSurvives, heldRefundThroughRuntime);
    await phase("licence", licenceWindDown);
    await phase("tripwire", () => tripwireForced(fleetAdmin, fleetLog));
    await phase("webhook", webhookThroughCaddy);
    await phase("stop", stopPersists);
    await phase("outputs", deployerOutputs);
    await phase("data", dataDuties);
    await phase("agent", ownAgent);
    await phase("model", modelGuard);
    measure("1 shop (after the checks above)", 1);
    await phase("load", () => loadStep(1));

    for (const size of SIZES.filter((s) => s > 1 && runs("load"))) {
      say(`\n== scale to ${size} shops ==`);
      const have = Object.keys(loadState(SERVER).shops).length;
      for (let i = have + 1; i <= size; i++) await addShop(i);
      t0 = Date.now();
      const r = await deploy(ctx);
      results[`deploy${size}Seconds`] = Math.round((Date.now() - t0) / 1000);
      check(`deploy ${size} shops: every Guard proven`, r.length === size && r.every((x) => x.proven.passed === x.proven.of), r.map((x) => x.proven.line).slice(0, 2));
      await sleep(80_000);
      // `ps -a`, so a container that is not running is listed too (and named), not left out of the count; read again for up to a minute
      let mustBeHealthy: string[][] = []; let notHealthy: string[] = [];
      for (let i = 0; i < 7; i++) {
        const ps = dc(["ps", "-a", "--format", "{{.Service}}\t{{.Status}}"]).out.trim().split("\n").map((l) => l.split("\t"));
        mustBeHealthy = ps.filter(([n]) => /^(g-|rt-|inbox$|relay$|refresher$)/u.test(n));
        notHealthy = mustBeHealthy.filter(([, st]) => !/\(healthy\)/u.test(st ?? "")).map(([n, st]) => `${n}: ${st}`);
        if (notHealthy.length === 0 && mustBeHealthy.length >= size * 4 + 4) break;
        await sleep(10_000);
      }
      check(`after scaling to ${size} shops every Guard, runtime and shared service is (healthy)`, notHealthy.length === 0 && mustBeHealthy.length >= size * 4 + 4, { listed: mustBeHealthy.length, expected: size * 4 + 4, notHealthy: notHealthy.slice(0, 5) });
      const newest = shopName(size);
      const viaModel = nodeEval(`rt-${newest}`, `fetch('http://g-model:8080/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer ${readSecret(`rt-${newest}`, "agent_model")}','content-type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'user',content:'hi'}]})}).then(r=>console.log(r.status))`).out.trim();
      check(`the newest shop's runtime reaches the model Guard after the scale step (its namespace was not stranded)`, viaModel === "200", viaModel);
      measure(`${size} shops (idle)`, size);
      if (size === SIZES.filter((s) => s > 1)[0] && runs("isolation")) { await isolation(size); await panelAccess(size); }
      await phase("load", () => loadStep(size));
    }
    if (runs("load")) loadSummary();
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
  const broken: GuardTool = { readsLicence: () => real.readsLicence!(), compile: (s) => real.compile(s), verify: (bundle, toml) => real.verify(bundle, toml.replace(/^tool = "razorpay"$/mu, 'tool = "whatsapp"')) };
  let shown = "";
  try { await deploy(ctxFor(broken)); } catch (e) { if (e instanceof Refused) shown = e.problems.map((p) => `  - [${p.rule}] ${p.message}`).join("\n"); else throw e; }
  say(`deploy with a mismatched tool name refused:\n${shown}`);
  results.refusalDeploy = shown;
  check("deploy refuses a Guard whose guard.toml names another tool, and starts nothing", shown !== "" && dk(["ps", "-q", "--filter", `name=${PROJECT}`]).out.trim() === "" && !existsSync(composeFile), shown.slice(0, 300));
  // 3. the whole deploy, with a rule that would let a forbidden call through (the Calendar-style exact pin swapped for every suffix a tripwire could use)
  const weak: GuardTool = { readsLicence: () => real.readsLicence!(), compile: (specText) => { const spec = JSON.parse(specText); if (spec.tool === "whatsapp") spec.rules = [{ id: "own-number-only", kind: "argument_allowlist", operation: "send", field: "phone_number_id", allowed_suffixes: [..."xqzkjvw0123456789-_.abcdefghilmnoprstuy"] }]; return real.compile(JSON.stringify(spec)); }, verify: (b, t) => real.verify(b, t) };
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
  // A phone number standing on its own: not digits inside a longer token. A record entry's inputs digest is hex ("k-c615919191044749"), and so are the export's
  // hidden numbers ("c-…", "p-…"); either can hold "91" and ten digits by chance, which is no phone number (the 12 Nov run failed on exactly that). A number in a
  // field or a sentence has no letter, digit or hyphen right before it.
  const phones = JSON.stringify(files).match(/(?<![0-9A-Za-z-])\+?91\d{10}(?!\d)/gu) ?? [];
  check("the record and the bookings are exported for the monthly report, as lists, with no phone number in them", files.every((f) => Array.isArray(f)) && phones.length === 0, { record: files[0]?.length, bookings: files[1]?.length, phones: phones.length });
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
(async()=>{while(Date.now()-t0<24000){const started=Date.now()-t0;try{const r=await fetch('http://g-glow-salon-razorpay:8080/v1/payment_links',{method:'POST',headers:{authorization:'Bearer ${agent}','content-type':'application/json'},body:JSON.stringify({amount:20000,currency:'INR',description:'load',reference_id:'${RAW_LOAD_REF}'+started+'-'+Math.random()}),signal:AbortSignal.timeout(2500)});if(r.status===200||r.status===201)ok++;else if(r.status===403||r.status===503)refused++;else other++;await r.arrayBuffer()}catch(e){unreachable++}await new Promise(r=>setTimeout(r,80))}
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
  const paid = stand("/_standin/razorpay/pay", { request_id: linkId, deliver: false });
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
  say("\n== nightly snapshot, drill, restore ==");
  const objects = (dir: string) => sh("find", [join(SCRATCH, "minio", dir), "-type", "f", "-not", "-name", "xl.meta.tmp"]).out.trim().split("\n").filter(Boolean).length;
  const snap = await runBackup(ctxFor()); snap.lines.forEach(say);
  check("the nightly snapshot ran and every file in the bucket is age-encrypted", snap.ok && objects("geo-snaps") > 0, { objects: objects("geo-snaps") });
  // MinIO stores objects as xl.meta and part files (small ones inline); the bytes of an age file are in them as written, and a plain SQLite file would show its header
  const grep = (pattern: string, dir: string) => sh("sh", ["-c", `grep -rlaF "${pattern}" "${join(SCRATCH, "minio", dir)}" | wc -l`]).out.trim();
  const ageFiles = Number(grep("age-encryption.org/v1", "geo-snaps")), plainFiles = Number(grep("SQLite format 3", "geo-snaps"));
  check("every snapshot object is an age file and none holds a plain SQLite database", ageFiles > 0 && plainFiles === 0, { ageFiles, plainFiles });
  const drill = await runDrill(ctxFor()); drill.lines.forEach(say);
  check("the weekly drill, without the key, reads the newest snapshot back unchanged and its record is the start of the live record", drill.ok, drill.lines);
  // restore: put the shop's data back from the newest snapshot; the runtime starts in its restored mode
  check("restore puts the shop's data back from the newest snapshot", (await restoreShop(ctxFor(), "glow-salon", { identity: join(SCRATCH, "age-identity.txt") }).then((m) => { say(m); return true; }).catch((e) => { say(String(e)); return false; })), "");
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

// ---------------------------------------------------------------------------------------------------------------------------------- B51: an agent someone else wrote
//
// The example agent (bundle/examples/own-agent/agent.js), run as a builder runs it: a separate program on this machine, outside every network of the bundle, calling its
// Guards through Caddy's https://localhost:18443/g/<agent>/<service> addresses with the one credential `agent add` made. On Razorpay: an agent on the default UPI module
// has no payment Guard, and the owner-marked desk that would take its UPI money is not served on a server yet (B71), so the held refund, the owner's approval and a
// payment Guard's backup need a gateway. Then its record, its backup, the drill and `restore`, and a hostile container on the network its Guards share with Caddy.

/** One call through Caddy, as the builder's agent makes it: the status and the start of the answer. The credential is an argument to curl, never in a line said. */
function viaCaddy(method: string, path: string, credential?: string, body?: unknown): { status: string; body: string } {
  const r = sh("curl", ["-sk", "-X", method, `https://localhost:18443${path}`, ...(credential ? ["-H", `authorization: Bearer ${credential}`] : []), "-H", "content-type: application/json", ...(body ? ["--data-binary", JSON.stringify(body)] : []), "-w", "\n%{http_code}", "--max-time", "20"]);
  const lines = r.out.trimEnd().split("\n");
  return { status: lines.at(-1) ?? "", body: lines.slice(0, -1).join("\n").slice(0, 200) };
}

async function ownAgent() {
  say(`\n== an agent someone else wrote (B51): ${AGENT_NAME}, behind its own Guards ==`);
  const ctx = ctxFor();
  const customer = "+919811111190";
  const st = () => control(AGENT_NAME, "/_standin/state");
  const guards = ["razorpay", "whatsapp", "calendar"].map((k) => `g-${AGENT_NAME}-${k}`);
  const opsAdmin = (svc: string, path: string) => JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", svc, "GET", path]).out.trim().split("\n").at(-1) ?? "{}");
  // agent add (the function, as the command does; neither prints a credential since 12 Nov 2026) and the shop's own keys, handed in under the names a shop's are
  addAgent(SERVER, AGENT_NAME, { upstreams: "razorpay,whatsapp,calendar", deposit: "200", "refund-limit": "100", "owner-whatsapp": OWNER, "whatsapp-number-id": phoneOf(AGENT_INDEX), "calendar-id": calendarOf(AGENT_INDEX) }, (p) => readFileSync(p, "utf8"), new Date());
  const inbox = join(SERVER, "secrets-inbox", AGENT_NAME); mkdirSync(inbox, { recursive: true });
  const s = secretsOf(AGENT_INDEX);
  for (const [n, v] of Object.entries({ razorpay_key: s.razorpay_key, whatsapp_token: s.whatsapp_token, whatsapp_app_secret: s.whatsapp_app_secret, whatsapp_verify_token: s.whatsapp_verify_token, "google_service_account.json": SA(AGENT_INDEX) })) writeFileSync(join(inbox, n), v);
  const t0 = Date.now();
  const deployed = await deployAgent(ctx, AGENT_NAME);
  results.agentDeploySeconds = Math.round((Date.now() - t0) / 1000);
  check("agent deploy: its three Guards start in the generated compose file and every tripwire passes on the running Guards", deployed.proven.passed === deployed.proven.of && deployed.proven.of > 0, deployed.proven.line);
  await waitFor("the agent's Guards", () => guards.every(healthy), 120);
  check("its Guards are (healthy), on the gate network with Caddy", guards.every(healthy) && dk(["network", "inspect", `${PROJECT}_gate`, "--format", "{{.Internal}}"]).out.trim() === "true", dc(["ps", "--format", "{{.Service}} {{.Status}}", ...guards]).out.trim().split("\n"));
  // one credential per Guard since 12 Nov 2026 (agent/credentials.ts): the agent sends each its own, and one Guard's opens nothing at another's
  const credentialOf = (kind: string) => readFileSync(secretFile(SERVER, "agents", AGENT_NAME, `${kind}_token`), "utf8").trim();
  const credential = credentialOf("razorpay");

  // ---- the agent's story, through Caddy: a deposit, a booking, a message, and a refund above the owner's limit
  const caFile = join(SCRATCH, "caddy-root.crt");
  viaCaddy("GET", `/g/${AGENT_NAME}/razorpay/v1/payment_links`); // Caddy makes its local certificates on the first handshake
  writeFileSync(caFile, dc(["exec", "-T", "caddy", "cat", "/data/caddy/pki/authorities/local/root.crt"]).out);
  await customerWrites(AGENT_NAME, customer, "hi"); // the customer wrote first, so a plain message can go back (WhatsApp's 24-hour window)
  const base = `https://localhost:18443/g/${AGENT_NAME}`;
  const child = spawn("node", [join(APP, "bundle/examples/own-agent/agent.js")], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_EXTRA_CA_CERTS: caFile, GEOMETER_RAZORPAY_URL: `${base}/razorpay`, GEOMETER_CALENDAR_URL: `${base}/calendar`, GEOMETER_WHATSAPP_URL: `${base}/whatsapp`, GEOMETER_RAZORPAY_CREDENTIAL: credentialOf("razorpay"), GEOMETER_CALENDAR_CREDENTIAL: credentialOf("calendar"), GEOMETER_WHATSAPP_CREDENTIAL: credentialOf("whatsapp"), CALENDAR_ID: calendarOf(AGENT_INDEX), PHONE_NUMBER_ID: phoneOf(AGENT_INDEX), CUSTOMER: customer, BOOKING: "pa-1", DEPOSIT_INR: "200" } });
  let out = ""; child.stdout.on("data", (c: Buffer) => { out += c.toString(); }); child.stderr.on("data", (c: Buffer) => { out += c.toString(); });
  const exited = new Promise<number>((resolve) => { const t = setTimeout(() => { child.kill(); resolve(-1); }, 420_000); child.on("close", (c) => { clearTimeout(t); resolve(c ?? -1); }); });
  // the customer pays at Razorpay; the agent sees it by looking at its link (every 15 s)
  let linkId: string | undefined;
  await waitFor("the agent's deposit link at Razorpay", async () => { linkId = ((await st()).links ?? []).find((l: { id: string; status: string }) => l.status === "created")?.id; return !!linkId; }, 90);
  if (linkId) await control(AGENT_NAME, "/_standin/razorpay/pay", { request_id: linkId });
  // the relay finds the held refund at Guard and asks the owner on WhatsApp with a one-use code; the owner answers, as an owner does
  let code: string | undefined;
  const asked = async () => ((await st()).outbox ?? []).filter((m: { to: string; text: string }) => digits(m.to) === digits(OWNER) && /approve\s+[A-Z0-9]{6}/u.test(m.text));
  await waitFor("the relay's question to the owner", async () => { const m = (await asked()).at(-1); code = m ? /approve\s+([A-Z0-9]{6})/u.exec(m.text)?.[1] : undefined; return !!code; }, 180);
  const heldAt = ((await st()).refunds ?? []).length;
  check("a refund above the owner's limit is HELD by its Guard (the agent was answered 202) and nothing is refunded while the owner has not answered", /Held for the owner/u.test(out) && heldAt === 0 && !!code, { refunds: heldAt, asked: code ? "a code was sent to the owner" : "no question to the owner", agentSaid: out.trim().split("\n").slice(-3) });
  if (code) await customerWrites(AGENT_NAME, OWNER, `approve ${code}`);
  const exit = await exited;
  const refunds = ((await st()).refunds ?? []) as { id: string; amount: number }[];
  const consumed = opsAdmin(guards[0], "/admin/approvals?state=consumed").body?.approvals?.length;
  check("the owner's approval lets the agent's identical retry through once: one refund at Razorpay, one approval used, the owner asked once", exit === 0 && /Refunded once:/u.test(out) && refunds.length === 1 && consumed === 1 && (await asked()).length === 1, { exit, refunds: refunds.length, approvalsUsed: consumed, ownerAsked: (await asked()).length, agentSaid: out.trim().split("\n").slice(-2) });

  // ---- its record: from what the Guards decided and what the services hold, through the real ops container
  const rec = await recordAgent(ctx, AGENT_NAME);
  const entries = (() => { try { return JSON.parse(readFileSync(join(SERVER, "exports", AGENT_NAME, "record.json"), "utf8")) as { action: string; outcome: string; refs: Record<string, string> }[]; } catch { return []; } })();
  const n = (action: string, outcome: string) => entries.filter((e) => e.action === action && e.outcome === outcome).length;
  const counts = { link: n("create_deposit_link", "confirmed"), deposit: n("record_deposit", "confirmed"), booking: n("confirm_booking", "confirmed"), held: n("refund", "held_for_owner"), approved: entries.filter((e) => e.action === "owner_decision" && e.refs?.command === "approve").length, refund: n("refund", "confirmed"), messages: n("send_message", "confirmed") };
  check("its record is built from its Guards' decisions and the services' own state: the link, the deposit, the booking, the hold, the owner's approval and the refund Razorpay holds", counts.link === 1 && counts.deposit === 1 && counts.booking === 1 && counts.held === 1 && counts.approved === 1 && counts.refund === 1 && counts.messages >= 2 && entries.find((e) => e.action === "refund" && e.outcome === "confirmed")?.refs?.refundId === refunds[0]?.id, { ...counts, entries: entries.length, problems: rec.problems });
  check("and no phone number is in it", entries.length > 0 && !JSON.stringify(entries).includes(digits(customer)) && !JSON.stringify(entries).includes(digits(OWNER)), "");

  // ---- a hostile agent container: on the network its Guards share with Caddy, it reaches its own Guards' agent ports and nothing else
  const targets: [string, string, number, boolean][] = [
    ...guards.map((g): [string, string, number, boolean] => [`its own ${g.split("-").at(-1)} Guard's agent port`, g, 8080, true]),
    ["its razorpay Guard's admin port (loopback only)", guards[0], 8082, false],
    ["its razorpay Guard's admin forwarder, by name", guards[0], 8190, false],
    [`its razorpay Guard's admin forwarder at ${adminIpOf(guards[0])}`, adminIpOf(guards[0]), 8190, false],
    ["the shop's razorpay Guard, by name", "g-glow-salon-razorpay", 8080, false],
    [`the shop's razorpay Guard at ${adminIpOf("g-glow-salon-razorpay")}`, adminIpOf("g-glow-salon-razorpay"), 8080, false],
    ["the shop's runtime", "rt-glow-salon", 8780, false],
    ["the model Guard", "g-model", 8080, false],
    ["the inbox", "inbox", 8788, false], ["the relay", "relay", 8795, false], ["ops", "ops", 80, false],
    ["MinIO (the bucket)", "minio", 9000, false], ["the stand-in providers", "standins", 8790, false],
    ["a public address, 1.1.1.1:443", "1.1.1.1", 443, false], ["fleet on the host, host.docker.internal:18790", "host.docker.internal", 18790, false],
  ];
  const script = `const net=require('net');const t=${JSON.stringify(targets.map(([, h, p]) => [h, p]))};(async()=>{const r=[];for(const [h,p] of t){r.push(await new Promise((ok)=>{if(!h)return ok('DID-NOT-RUN');const s=net.connect({host:h,port:p,timeout:3000});s.on('connect',()=>{s.destroy();ok('REACHED')});s.on('timeout',()=>{s.destroy();ok('TIMEOUT')});s.on('error',(e)=>ok('ERR '+e.code))}))}console.log(JSON.stringify(r))})()`;
  const hostile = dk(["run", "--rm", "--name", `${PROJECT}-hostile-agent`, "--network", `${PROJECT}_gate`, "--cap-drop", "ALL", "--read-only", "node:26-alpine", "node", "-e", script], { timeout: 240_000 });
  const got = (() => { try { return JSON.parse(hostile.out.trim().split("\n").at(-1) ?? "[]") as string[]; } catch { return [] as string[]; } })();
  targets.forEach(([label, , , reach], i) => { const r = got[i] ?? `DID-NOT-RUN (${hostile.err.trim().slice(0, 80)})`; check(`hostile agent container on the gate network: ${label} -> ${r}`, reach ? r === "REACHED" : UNREACHABLE.test(r), r); });
  // and through Caddy, from outside, as the agent itself calls: its credential opens its own Guards' routes, within its limits, and nothing else
  const noKey = viaCaddy("GET", `/g/${AGENT_NAME}/razorpay/v1/payment_links`);
  const adminPath = viaCaddy("GET", `/g/${AGENT_NAME}/razorpay/admin/status`, credential);
  const shopsGuard = viaCaddy("GET", "/g/glow-salon/razorpay/v1/payment_links", credential);
  const notDeposit = viaCaddy("POST", `/g/${AGENT_NAME}/razorpay/v1/payment_links`, credential, { amount: 99900, currency: "INR", reference_id: "pa-x", description: "not the deposit" });
  const otherNumber = viaCaddy("POST", `/g/${AGENT_NAME}/whatsapp/v26.0/${phoneOf(1)}/messages`, credentialOf("whatsapp"), { messaging_product: "whatsapp", to: digits(customer), type: "text", text: { body: "from another number" } });
  const crossGuard = viaCaddy("GET", `/g/${AGENT_NAME}/whatsapp/v26.0/${phoneOf(AGENT_INDEX)}`, credentialOf("razorpay"));
  const shopKey = viaCaddy("GET", `/g/${AGENT_NAME}/razorpay/v1/payment_links`, readSecret("rt-glow-salon", "agent_razorpay"));
  check("through Caddy: no credential is refused at its Guard", /^40[13]$/u.test(noKey.status), noKey);
  check("through Caddy: its credential does not open a Guard's admin API (only the agent port is behind /g/)", adminPath.status !== "200" || !/tripwires|kill_switch/u.test(adminPath.body), adminPath);
  check("through Caddy: a shop's Guards are not served under /g/ at all", !/^2\d\d$/u.test(shopsGuard.status) && !/payment_links|items/u.test(shopsGuard.body), shopsGuard);
  check("through Caddy: a payment link that is not the deposit, and a message from another shop's number, are refused by its Guards (403)", notDeposit.status === "403" && otherNumber.status === "403", { link: notDeposit.status, message: otherNumber.status });
  check("through Caddy: a shop runtime's credential opens nothing at the agent's Guard", /^40[13]$/u.test(shopKey.status), shopKey.status);
  check("through Caddy: the agent's Razorpay credential opens nothing at its WhatsApp Guard (one credential per Guard)", /^40[13]$/u.test(crossGuard.status), crossGuard.status);

  // ---- its backup: the nightly snapshot, the drill without the key, and `restore`
  const snap = await runBackup(ctx); snap.lines.forEach(say);
  const line = snap.lines.find((l) => l.startsWith(`${AGENT_NAME}:`)) ?? "";
  const lastSeq = Number(/record at entry #(\d+)/u.exec(line)?.[1] ?? NaN);
  check("the nightly snapshot holds the agent: its record and each Guard's store, 5 objects", /snapshot \S+ written \(5 objects/u.test(line), line);
  const dir = join(SCRATCH, "minio", "geo-snaps", "proof", AGENT_NAME);
  const files = sh("find", [dir, "-type", "f", "-not", "-name", "xl.meta.tmp"]).out.trim().split("\n").filter(Boolean).length;
  const grep = (pattern: string) => Number(sh("sh", ["-c", `grep -rlaF "${pattern}" "${dir}" | wc -l`]).out.trim());
  check("every object of it in the bucket is an age file; none holds the record or a Guard's store readable", files > 0 && grep("age-encryption.org/v1") >= 5 && grep("create_deposit_link") === 0 && grep("SQLite format 3") === 0, { files, ageFiles: grep("age-encryption.org/v1") });
  const drill = await runDrill(ctx); drill.lines.forEach(say);
  const dl = drill.lines.find((l) => l.startsWith(`${AGENT_NAME}:`)) ?? "";
  check("the weekly drill, without the key: the agent's objects read back unchanged, its record the start of the live one, the key in its manifest the one in use", /restore drill passed/u.test(dl) && /its manifest holds the fingerprint key this server uses/u.test(dl), dl);
  let said = "";
  try { said = await restoreAgent(ctx, AGENT_NAME, { identity: join(SCRATCH, "age-identity.txt") }); } catch (e) { said = `FAILED: ${(e as Error).message}`; }
  say(said);
  check("restore <agent> tries each Guard's backup first, then puts back its Guards' stores, its record and its key, and says what a restore loses", /is restored from the snapshot of/u.test(said) && /calendar, razorpay, whatsapp Guards' stores|razorpay, whatsapp, calendar Guards' stores/u.test(said) && /calls the agent made after it are not in the Guards or the record/u.test(said), said.slice(0, 300));
  await waitFor("the agent's Guards after the restore", () => guards.every(healthy), 120);
  const record = (() => { try { return JSON.parse(readFileSync(join(SERVER, "state", "records", `${AGENT_NAME}.json`), "utf8")) as { entries: { action: string }[] }; } catch { return { entries: [] }; } })();
  const reviews = nodeEval("relay", `fetch('http://${adminIpOf(guards[0])}:8190/admin/reviews',{headers:{authorization:'Bearer ${readSecret("relay", `${AGENT_NAME}/read_token`)}'}}).then(r=>console.log(r.status))`).out.trim();
  check("after it: its Guards are (healthy), the approval the owner gave is in the restored store, the relay's renewed credential reads its Guard, and the record ends with a 'restored' entry after the snapshot's", guards.every(healthy) && opsAdmin(guards[0], "/admin/approvals?state=consumed").body?.approvals?.length === 1 && reviews === "200" && record.entries.length === lastSeq + 1 && record.entries.at(-1)?.action === "restored", { healthy: guards.every(healthy), reviews, entries: record.entries.length, snapshotAt: lastSeq });
  const again = await recordAgent(ctx, AGENT_NAME);
  const after = (() => { try { return JSON.parse(readFileSync(join(SERVER, "exports", AGENT_NAME, "record.json"), "utf8")) as { action: string; outcome: string }[]; } catch { return []; } })();
  check("the next record pass after the restore writes nothing twice (one refund, one deposit)", after.filter((e) => e.action === "refund" && e.outcome === "confirmed").length === 1 && after.filter((e) => e.action === "record_deposit").length === 1, { added: again.added, problems: again.problems });
  results.ownAgent = { deploySeconds: results.agentDeploySeconds, proven: deployed.proven.line, record: counts, hostile: Object.fromEntries(targets.map(([label], i) => [label, got[i]])), snapshot: line, drill: dl, restore: said.slice(0, 600) }; save();
}

// ---------------------------------------------------------------------------------------------------------------------------------- B14, through the runtime

/** The test's way to the stand-ins (published on the host's loopback only): play a shop's customer, pay a link, read what the provider holds. */
const STANDINS = "http://127.0.0.1:18791";
async function control(shop: string, path: string, body?: unknown): Promise<any> {
  // a read is tried three times (a busy stand-in can be slow to hand over a large state); a POST once, since it plays a customer or a payment
  let last = "";
  for (let i = 0; i < (body === undefined ? 3 : 1); i++) {
    try {
      const r = await fetch(`${STANDINS}/_proof/${shop}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      return await r.json();
    } catch (e) { last = `${(e as Error).message} ${String((e as { cause?: unknown }).cause ?? "")}`.trim(); await sleep(1000); }
  }
  say(`(the stand-ins' ${path} for ${shop} did not answer: ${last})`);
  return { error: last };
}
const digits = (n: string) => n.replace(/\D/gu, "");
const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);

/** Each shop's customers, one new number for each request, and a slot of their own: day 2 onwards, 10 am to 6 pm on the hour, Sundays skipped (Glow Salon is closed). */
const seqs = new Map<number, number>();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function nextCustomer(i: number): { from: string; text: string } {
  const k = (seqs.get(i) ?? 0) + 1; seqs.set(i, k);
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  let day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 2));
  // nine slots a working day (10 am to 6 pm), so the k-th request is on working day floor((k - 1) / 9) from the day after tomorrow, Sundays skipped
  for (let n = Math.floor((k - 1) / 9); ; day = new Date(day.getTime() + DAY_S * 1000)) { if (day.getUTCDay() === 0) continue; if (n === 0) break; n--; }
  const hour = 10 + ((k - 1) % 9);
  const when = `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} at ${hour > 12 ? hour - 12 : hour}${hour >= 12 ? "pm" : "am"}`;
  return { from: `+9197${String(i).padStart(2, "0")}${String(k).padStart(6, "0")}`, text: `I want a beard trim ${when}` };
}

interface Sent { shop: string; from: string; at: number; ok: boolean }
/** A customer writes: the shop's stand-in records the message and hands the signed webhook to the inbox, which answers once the runtime has saved it. */
async function customerWrites(shop: string, from: string, text: string): Promise<Sent> {
  const r = await control(shop, "/_standin/whatsapp/inbound", { from, text });
  return { shop, from, at: Number(r.message?.timestamp ?? Date.now()), ok: r.delivered?.[0]?.status === 200 };
}

/**
 * Traffic through the runtime: for each shop, a new customer asks for a booking every `60 / perMinute` seconds (with some jitter), and every second deposit link
 * that appears is paid (the payment's webhooks go to the inbox as Razorpay's would). Returns what was sent; the replies are read from the stand-ins afterwards.
 */
async function drive(shops: number, seconds: number, perMinute: number, label: string): Promise<{ sent: Sent[]; paid: number; samples: CapReading[]; stats: { name: string; cpu: number; mib: number }[] }> {
  const sent: Sent[] = []; let paid = 0; const samples: CapReading[] = []; let stats: { name: string; cpu: number; mib: number }[] = [];
  const end = Date.now() + seconds * 1000;
  const gap = 60_000 / perMinute;
  const writer = async (i: number) => {
    await sleep(Math.random() * gap);
    while (Date.now() < end) {
      const c = nextCustomer(i);
      sent.push(await customerWrites(shopName(i), c.from, c.text));
      await sleep(gap * (0.7 + Math.random() * 0.6));
    }
  };
  const payer = async (i: number) => {
    const seen = new Set<string>();
    while (Date.now() < end) {
      await sleep(4000);
      const st = await control(shopName(i), "/_standin/state");
      for (const l of (st.links ?? []) as { id: string; status: string }[]) {
        if (l.status !== "created" || seen.has(l.id)) continue;
        seen.add(l.id);
        if (seen.size % 2 === 0) { const r = await control(shopName(i), "/_standin/razorpay/pay", { request_id: l.id }); if (r.payment) paid++; }
      }
    }
  };
  const sampler = async () => {
    while (Date.now() < end) {
      const r = readCap(); if (r) samples.push(r);
      if (stats.length === 0 && Date.now() > end - seconds * 500) stats = containerStats();
      await sleep(10_000);
    }
  };
  say(`   ${label}: ${shops} shop(s), a customer every ${(gap / 1000).toFixed(0)} s per shop for ${seconds} s, every second link paid`);
  await Promise.all([...Array.from({ length: shops }, (_, k) => writer(k + 1)), ...Array.from({ length: shops }, (_, k) => payer(k + 1)), sampler()]);
  return { sent, paid, samples, stats };
}

/** CPU and memory of each bundle container now (`docker stats`, one reading). */
function containerStats(): { name: string; cpu: number; mib: number }[] {
  const r = dk(["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"], { timeout: 120_000 });
  return r.out.trim().split("\n").filter((l) => l.startsWith(`${PROJECT}-`)).map((l) => {
    const [name, cpu, usage] = l.split("\t");
    const m = /^([\d.]+)\s*([KMG]i?)B/u.exec(usage ?? "");
    return { name: name.replace(`${PROJECT}-`, "").replace(/-1$/u, ""), cpu: Number((cpu ?? "0").replace("%", "")), mib: m ? Number(m[1]) * (m[2].startsWith("G") ? 1024 : m[2].startsWith("K") ? 1 / 1024 : 1) : 0 };
  });
}

/** For each message sent, the first message back to that customer (the stand-in's own outbox and clock): the time a customer waits for an answer. */
async function latencies(sent: Sent[], waitSeconds = 90): Promise<{ answered: number; waits: number[]; unanswered: Sent[] }> {
  const shops = [...new Set(sent.map((s) => s.shop))];
  let outboxes = new Map<string, { to: string; sentAt: number }[]>();
  const read = async () => { outboxes = new Map(await Promise.all(shops.map(async (s) => [s, ((await control(s, "/_standin/state")).outbox ?? []) as { to: string; sentAt: number }[]] as const))); };
  const firstReply = (s: Sent) => (outboxes.get(s.shop) ?? []).filter((m) => digits(m.to) === digits(s.from) && m.sentAt >= s.at).map((m) => m.sentAt).sort((a, b) => a - b)[0];
  const deadline = Date.now() + waitSeconds * 1000;
  do { await read(); if (sent.filter((s) => s.ok).every((s) => firstReply(s) !== undefined)) break; await sleep(3000); } while (Date.now() < deadline);
  const waits: number[] = []; const unanswered: Sent[] = [];
  for (const s of sent.filter((x) => x.ok)) { const r = firstReply(s); if (r === undefined) unanswered.push(s); else waits.push(r - s.at); }
  return { answered: waits.length, waits: waits.sort((a, b) => a - b), unanswered };
}
const pct = (xs: number[], p: number) => (xs.length === 0 ? NaN : xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]);

/** The runtime's record, read from its own database (read-only, in a one-off container on its volume): each entry with its time, action, outcome and rule ids. */
function recordOf(shop: string): { seq: number; time: string; action: string; outcome: string; booking: string | null; conversation: string; rules: string[]; notes: string; refs: Record<string, string>; hash: string }[] {
  const r = dk(["run", "--rm", "--network", "none", "--user", "1000:1000", "-v", `${PROJECT}_rt-data-${shop}:/d`, "node:26-alpine", "node", "-e",
    `const {DatabaseSync}=require('node:sqlite');const {createHash}=require('node:crypto');const db=new DatabaseSync('/d/data/agent.db',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');const rows=db.prepare('SELECT entry FROM record ORDER BY seq').all();console.log(JSON.stringify(rows.map(r=>{const e=JSON.parse(r.entry);return {seq:e.seq,time:e.time,action:e.action,outcome:e.outcome,booking:e.booking,conversation:e.conversation,rules:(e.decisions||[]).map(d=>d.ruleId+':'+d.verdict),notes:String(e.notes||'').slice(0,200),refs:e.refs||{},hash:createHash('sha256').update(r.entry).digest('hex').slice(0,16)}})))`], { timeout: 120_000 });
  try { return JSON.parse(r.out.trim().split("\n").at(-1) ?? "[]"); } catch { say(`(could not read ${shop}'s record: ${r.err.slice(0, 200)})`); return []; }
}

// ---------------------------------------------------------------------------------------------------------------------------------- the licence block (D83)

/** The block on the running Guards: each per-shop Guard has read `[licence]`, for this server and shop, with the test key built in; the model Guard has none. */
async function licenceBlockOnGuards() {
  say("\n== Guard's licence block (D83) ==");
  const view = (svc: string) => JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", svc, "GET", "/admin/licence"]).out.trim().split("\n").at(-1) ?? "{}");
  for (const kind of ["razorpay", "whatsapp", "calendar"]) {
    const svc = `g-glow-salon-${kind}`;
    const v = view(svc);
    const toml = readFileSync(join(SERVER, "generated", "guards", svc, "guard.toml"), "utf8");
    check(`${svc}: guard.toml has [licence] for server "proof" and shop glow-salon, and the running Guard reports it with the test key built in`,
      /\n\[licence\]\n/u.test(toml) && v.status === 200 && v.body?.configured === true && v.body?.deployment === "proof" && v.body?.shop === "glow-salon" && v.body?.keys?.[0]?.kid === "21fe31dfa154a261" && v.body?.keys?.[0]?.test_key === true,
      { configured: v.body?.configured, deployment: v.body?.deployment, shop: v.body?.shop, keys: v.body?.keys, keys_from: v.body?.keys_from, state: v.body?.state, note: v.body?.note });
  }
  const model = view("g-model");
  check("the model Guard has no licence block (it serves every shop)", model.body?.configured === false && !readFileSync(join(SERVER, "generated", "guards", "g-model", "guard.toml"), "utf8").includes("[licence]"), model.body?.note);
  const tw = JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", "g-glow-salon-razorpay", "GET", "/admin/status"]).out.trim().split("\n").at(-1) ?? "{}").body?.tripwires;
  results.licenceTripwires = { razorpay: tw ? `${tw.passed} of ${tw.of}` : null };
  say(`   the Razorpay Guard's tripwires with the licence block: ${tw?.passed} of ${tw?.of} (ADR-0062: 8 become 10 with the block)`);
  const mount = dk(["inspect", containerOf("g-glow-salon-razorpay"), "--format", "{{range .Mounts}}{{if eq .Destination \"/run/geometer/licence\"}}{{.Source}} rw={{.RW}}{{end}}{{end}}"]).out.trim();
  check("the server's state/licence/ folder is mounted read-only in the Guard (the folder, not single files)", mount.endsWith("rw=false") && mount.includes("state/licence"), mount);
}

// ---------------------------------------------------------------------------------------------------------------------------------- item 6: the panel container

async function panelContainer() {
  say("\n== the panel container (B14 item 6) ==");
  const id = containerOf("panel");
  const up = await waitFor("the panel to be healthy", () => healthy("panel"), 90);
  check("the panel container starts and is (healthy)", up, dc(["ps", "panel"]).out.trim().split("\n").at(-1));
  const facts = JSON.parse(dk(["inspect", id, "--format", "{{json .}}"]).out || "{}");
  const user = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
  check("it runs read-only, as the deployer's user (not root), with every capability dropped, on the front and panel networks only",
    facts.HostConfig?.ReadonlyRootfs === true && facts.Config?.User === user && (facts.HostConfig?.CapDrop ?? []).includes("ALL") && Object.keys(facts.NetworkSettings?.Networks ?? {}).sort().join(",") === `${PROJECT}_front,${PROJECT}_panel`,
    { readOnly: facts.HostConfig?.ReadonlyRootfs, user: facts.Config?.User, capDrop: facts.HostConfig?.CapDrop, networks: Object.keys(facts.NetworkSettings?.Networks ?? {}) });
  const viaCaddy = sh("curl", ["-sk", "-o", "/dev/null", "-w", "%{http_code}", "https://localhost:18443/healthz"]).out;
  check("Caddy reaches it: https://localhost:18443/healthz answers 200", viaCaddy === "200", viaCaddy);
  const invite = exec("panel", ["node", "/app/bundle/panel/main.ts", "invite", "--role", "builder"]);
  check("`invite --role builder` inside the container prints a sign-in link", /https:\/\/localhost:18443\/\S+/u.test(invite.out), (invite.out || invite.err).trim().slice(0, 160).replace(/\/join\/\S+/u, "/join/..."));
  // The shop was added from the command line, so the panel's store has no WhatsApp business number and the check would say not_configured without asking the Guard. The number
  // goes where the panel's own setup keeps it, in the real container, with the panel's own code: making the whole shop through the panel's forms would need an account, a
  // sign-in and the vault, which is another proof.
  const number = exec("panel", ["node", "--input-type=module", "-e", `import { configFromEnv } from '/app/bundle/panel/config.ts'; import { createShops } from '/app/bundle/panel/shops.ts'; import { openStores } from '/app/bundle/panel/server.ts'; const c = configFromEnv(process.env); const { store } = openStores(c); const shops = createShops(c, store); const m = shops.meta('glow-salon'); shops.saveMeta('glow-salon', { ...m, whatsapp: { ...m.whatsapp, businessNumber: '${STANDIN_BUSINESS_NUMBER}' } }); console.log('saved');`]);
  check("the shop's WhatsApp number is in the panel's store, where its setup keeps it", number.out.trim().endsWith("saved"), number.out.trim().slice(-80) || number.err.slice(0, 200));
  const connection = exec("panel", ["node", "/app/bundle/services/connection-check.ts", "glow-salon"], { timeout: 120_000 });
  const parsed = (() => { try { return JSON.parse(connection.out.trim().split("\n").at(-1) ?? "{}"); } catch { return { raw: (connection.out || connection.err).slice(0, 300) }; } })();
  results.panelConnectionCheck = parsed;
  check("the connection check runs inside the real panel container, through the shop's Guards with the panel's own agent", connection.code === 0 && !parsed.raw, parsed);
  const seen = (parsed as { connections?: { service: string; code: string }[] }).connections ?? [];
  check("WhatsApp, Razorpay and the calendar are each confirmed through the shop's Guards (WhatsApp no longer not_configured)", ["whatsapp", "razorpay", "calendar"].every((k) => seen.find((c) => c.service === k)?.code === "confirmed"), seen.map((c) => `${c.service}: ${c.code}`));
}

// ---------------------------------------------------------------------------------------------------------------------------------- the shop's fingerprint key (B69)
//
// What B69's own tests could not see: the files on a real server, the containers' users, and the variable reaching the runtime through compose. The runtime refuses to start
// in live mode without its record key, so a runtime that is up has read one; these checks say which one, and that the shop's key itself stays where it belongs.

async function shopKeyMounts() {
  say("\n== the shop's fingerprint key on a real server (B69) ==");
  const shop = "glow-salon";
  const me = process.getuid?.() ?? -1;
  const keyFile = secretFile(SERVER, "person-keys", shop);
  const recordFile = secretFile(SERVER, `rt-${shop}`, "record_key");
  const panelCopy = secretFile(SERVER, "panel", "person-keys", shop);
  const modeOf = (f: string) => (existsSync(f) ? (statSync(f).mode & 0o777).toString(8) : "missing");
  check("the shop's key is 0600 and the deployer's own on the server", modeOf(keyFile) === "600" && statSync(keyFile).uid === me, { mode: modeOf(keyFile), uid: existsSync(keyFile) ? statSync(keyFile).uid : null, deployer: me });
  check("the panel's copy is 0600 and the deployer's own (the panel runs as the deployer's user)", modeOf(panelCopy) === "600" && statSync(panelCopy).uid === me, { mode: modeOf(panelCopy) });
  check("the runtime's record key is a key made from it, not the key itself, readable by the runtime's own user (0644)", modeOf(recordFile) === "644" && readFileSync(recordFile, "utf8").trim() !== readFileSync(keyFile, "utf8").trim(), { mode: modeOf(recordFile) });
  const env = dk(["inspect", containerOf(`rt-${shop}`), "--format", "{{json .Config.Env}} {{.Config.User}}"]).out.trim();
  check("compose hands the runtime RECORD_KEY_FILE=/run/secrets/record_key", env.includes("RECORD_KEY_FILE=/run/secrets/record_key"), env.replace(/[A-Za-z0-9_]*TOKEN[^",]*/gu, "…").slice(0, 200));
  const inside = nodeEval(`rt-${shop}`, "const fs=require('fs');const f=process.env.RECORD_KEY_FILE;let k='';try{k=fs.readFileSync(f,'utf8').trim()}catch(e){k='ERR '+e.code}console.log(JSON.stringify({uid:process.getuid(),readable:/^[0-9a-f]{64}$/.test(k),shopKey:fs.existsSync('/run/secrets/person-keys')}))").out.trim().split("\n").at(-1) ?? "{}";
  const seen = (() => { try { return JSON.parse(inside); } catch { return { raw: inside }; } })();
  check("inside the runtime: not root, its record key readable as 64 hex digits, and no copy of the shop's key", seen.uid > 0 && seen.readable === true && seen.shopKey === false, seen);
  check("the runtime that read it is up and (healthy): in live mode it does not start without the file", healthy(`rt-${shop}`), dc(["ps", `rt-${shop}`]).out.trim().split("\n").at(-1));
  const panel = nodeEval("panel", `const fs=require('fs');const f='/run/secrets/person-keys/${shop}';try{const s=fs.statSync(f);console.log(JSON.stringify({uid:process.getuid(),owner:s.uid,mode:(s.mode&0o777).toString(8),readable:/^[0-9a-f]{64}$/.test(fs.readFileSync(f,'utf8').trim())}))}catch(e){console.log(JSON.stringify({error:e.code}))}`).out.trim().split("\n").at(-1) ?? "{}";
  const p = (() => { try { return JSON.parse(panel); } catch { return { raw: panel }; } })();
  check("inside the panel: its copy of the key is mounted 0600, owned by the user the panel runs as (not root), and readable", p.mode === "600" && p.uid > 0 && p.owner === p.uid && p.readable === true, p);
  results.shopKey = { deployerIsRoot: me === 0, runtime: seen, panel: p, note: me === 0 ? "the deployer ran as root: the panel ran as 1000 and its files were handed to that user" : "the deployer ran as a normal user, so the root deployer's path (files chowned to 1000) was not run here" };
  save();
}

// ---------------------------------------------------------------------------------------------------------------------------------- item 2: a hostile runtime

/** What a runtime someone took over would try, from inside its container. Only TCP connections and DNS lookups: no request is sent to any real service. */
async function hostileRuntime() {
  say("\n== a hostile runtime (B14 item 2): every way out it could try ==");
  const rt = "rt-glow-salon";
  const tries: Record<string, string> = {};
  const attempt = (label: string, host: string, port: number) => { const got = host === "" ? "DID-NOT-RUN (no address)" : probe(rt, host, port); tries[label] = got; check(`hostile runtime: ${label} -> ${got}`, UNREACHABLE.test(got), got); };
  const real = ["api.razorpay.com", "graph.facebook.com", "www.googleapis.com", "oauth2.googleapis.com", "api.openai.com", "api.anthropic.com"];
  for (const h of real) attempt(`${h}:443 by name`, h, 443);
  // their addresses, looked up on the host (a DNS lookup, nothing sent to the services), then tried from inside by address
  const { lookup } = await import("node:dns/promises");
  for (const h of real) { const ip = await lookup(h, { family: 4 }).then((a) => a.address).catch(() => ""); attempt(`${h}:443 by its address ${ip}`, ip, 443); }
  const dns = nodeEval(rt, "require('dns').promises.lookup('api.razorpay.com').then(a=>console.log('RESOLVED '+a.address)).catch(e=>console.log('ERR '+e.code))").out.trim().split("\n").at(-1) ?? "";
  tries["DNS lookup of api.razorpay.com from inside"] = dns;
  check(`hostile runtime: a DNS lookup of a provider's name from inside fails (no DNS way out) -> ${dns}`, /^ERR (ENOTFOUND|EAI_AGAIN|ESERVFAIL|ECONNREFUSED)$/u.test(dns), dns);
  const gateway = dk(["network", "inspect", `${PROJECT}_net-glow-salon`, "--format", "{{(index .IPAM.Config 0).Gateway}}"]).out.trim();
  attempt("host.docker.internal:18790 (fleet, on the host)", "host.docker.internal", 18790);
  attempt(`its network's gateway ${gateway || "(none)"}:18790`, gateway, 18790);
  attempt(`its network's gateway ${gateway || "(none)"}:22`, gateway, 22);
  attempt("the cloud metadata address 169.254.169.254:80", "169.254.169.254", 80);
  attempt("a public IPv6 address [2606:4700:4700::1111]:443", "2606:4700:4700::1111", 443);
  attempt(`the stand-ins' published port on the host, 127.0.0.1:18791 (its own loopback)`, "127.0.0.1", 18791);
  const sock = nodeEval(rt, "console.log(require('fs').existsSync('/var/run/docker.sock')?'PRESENT':'ABSENT')").out.trim();
  check("hostile runtime: no Docker socket in the container", sock === "ABSENT", sock);
  // Guard as an open proxy: a request in absolute form for MinIO, and a call with MinIO's name in Host. Guard sends only to its one upstream, and only routes it lists.
  const agent = readSecret(rt, "agent_razorpay");
  // the request is written and the socket left open (a half-close before the answer can end the exchange); the answer is read until Guard closes it
  const raw = (request: string) => nodeEval(rt, `const s=require('net').connect(8080,'g-glow-salon-razorpay',()=>s.write(${JSON.stringify(request)}));let d='';s.setTimeout(8000,()=>s.destroy());s.on('data',c=>{d+=c;if(/\\r\\n\\r\\n/.test(d)&&d.length>400)s.destroy()});s.on('close',()=>{const i=d.indexOf('\\r\\n\\r\\n');console.log((d.split('\\r\\n')[0]||'NO-ANSWER')+' | '+(i<0?'':d.slice(i+4,i+200)).replace(/\\s+/g,' '))});s.on('error',e=>console.log('ERR '+e.code))`).out.trim().split("\n").at(-1) ?? "";
  const absolute = raw(`GET http://minio:9000/geo-snaps/ HTTP/1.1\r\nHost: minio:9000\r\nAuthorization: Bearer ${agent}\r\nConnection: close\r\n\r\n`);
  check("hostile runtime: Guard does not fetch an absolute-form address for it (MinIO): it answers itself, and not with MinIO's answer", /^HTTP\/1\.1 [3-5]\d\d/u.test(absolute) && !/<\?xml|ListBucket|AccessDenied|MinIO/iu.test(absolute), absolute.slice(0, 200));
  const hostTrick = raw(`GET /v1/payment_links?reference_id=x HTTP/1.1\r\nHost: minio:9000\r\nAuthorization: Bearer ${agent}\r\nConnection: close\r\n\r\n`);
  check("hostile runtime: a foreign Host header never reaches MinIO: the answer is Guard's own or its one upstream's (the Razorpay stand-in), never MinIO's", /^HTTP\/1\.1 \d{3}/u.test(hostTrick) && !/<\?xml|ListBucket|AccessDenied|MinIO/iu.test(hostTrick), hostTrick.slice(0, 200));
  // the control: Guard's own namespace (its forwarder's) does reach the provider. Only Guard can get out.
  const out = dk(["exec", containerOf("fwd-glow-salon-razorpay"), "wget", "-q", "-O", "-", "-T", "3", "http://standins:8791/_state"]);
  check("control: from the Guard's own network namespace the provider IS reachable (so 'unreachable' above means something)", out.code === 0 && out.out.includes("tokens"), out.out.trim().slice(0, 80) || out.err.trim().slice(0, 120));
  results.hostileRuntime = tries; save();
}

// ---------------------------------------------------------------------------------------------------------------------------------- item 1: each Guard killed under load

const KIND_ACTIONS: Record<string, string[]> = {
  razorpay: ["create_deposit_link", "refund", "cancel_deposit_link"],
  calendar: ["hold_slot", "confirm_booking", "reschedule_booking"],
  whatsapp: ["send_message"],
};
/** What the shop's provider holds for one service: every call it took (Razorpay, the calendar) or every message it sent (WhatsApp). */
async function providerCount(shop: string, kind: string): Promise<number> {
  const st = await control(shop, "/_standin/state");
  return kind === "razorpay" ? (st.calls?.payments?.length ?? -1) : kind === "calendar" ? (st.calls?.calendar?.length ?? -1) : (st.outbox?.length ?? -1);
}

async function killEachGuardUnderLoad() {
  say("\n== kill each of the shop's Guards under load, the traffic going through the runtime (B14 item 1) ==");
  const shop = "glow-salon";
  const out: Record<string, unknown> = {};
  for (const kind of ["razorpay", "calendar", "whatsapp"]) {
    const svc = `g-${shop}-${kind}`;
    const driving = drive(1, 50, 12, `kill ${kind}`);
    await sleep(12_000);
    dk(["kill", containerOf(svc)]); // SIGKILL by hand: Docker does not restart it, so it stays down until it is started again
    const downFrom = Date.now();
    await sleep(1500); // a call already past the Guard when it died may still land
    const atKill = await providerCount(shop, kind);
    await sleep(15_000);
    const beforeRestart = await providerCount(shop, kind);
    const downTo = Date.now();
    dc(["up", "-d", "--no-deps", svc]);
    const back = await waitFor(`${svc} to be ready again`, () => healthy(svc), 90);
    const load = await driving;
    await sleep(35_000); // a tick of the runtime (30 s) after the Guard is back: anything it would do again, it has done
    const answers = await latencies(load.sent, 30);
    const st = await control(shop, "/_standin/state");
    const record = recordOf(shop);
    const window = record.filter((e) => { const t = Date.parse(e.time); return t >= downFrom + 1500 && t <= downTo - 500 && KIND_ACTIONS[kind].includes(e.action); });
    const outcomes = window.reduce<Record<string, number>>((m, e) => { m[e.outcome] = (m[e.outcome] ?? 0) + 1; return m; }, {});
    const twice = repeated(st);
    out[kind] = { sent: load.sent.length, delivered: load.sent.filter((s) => s.ok).length, answered: answers.answered, downSeconds: Math.round((downTo - downFrom) / 1000), providerAtKill: atKill, providerBeforeRestart: beforeRestart, entriesWhileDown: window.length, outcomesWhileDown: outcomes, twice };
    say(`   ${kind}: ${JSON.stringify(out[kind])}`);
    check(`${kind} Guard killed under load: nothing reached the ${kind} stand-in while it was down (${atKill} -> ${beforeRestart} over ${Math.round((downTo - downFrom) / 1000)} s)`, atKill >= 0 && atKill === beforeRestart, { atKill, beforeRestart });
    // a step whose first call cannot reach the Guard (the calendar is asked first, about the slot) ends before it records anything, and the task runner tries
    // the whole step again after its wait; a step that gets further records the call it could not make as failed. Either way nothing is recorded as done.
    const tasks = (() => { try { return (JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "observe"]).out.trim().split("\n").at(-1) ?? "{}") as { shops: { id: string; status?: { tasks?: unknown } }[] }).shops.find((x) => x.id === shop)?.status?.tasks; } catch { return undefined; } })();
    (out[kind] as Record<string, unknown>).tasksAfter = tasks;
    check(`${kind} Guard killed: the runtime recorded nothing it does through that Guard as done while it was down (${window.length} entries: ${JSON.stringify(outcomes)}), and every message was answered once the Guard was back (${answers.answered} of ${load.sent.filter((s) => s.ok).length})`,
      !outcomes.confirmed && (kind === "whatsapp" || answers.answered === load.sent.filter((s) => s.ok).length), { outcomes, tasks });
    check(`${kind} Guard restarted: it is ready again, and nothing was sent twice (no second link or event for a booking, no message twice)`, back && twice.links.length === 0 && twice.events.length === 0 && twice.messages.length === 0, twice);
  }
  results.killEachGuard = out; save();
}

// ---------------------------------------------------------------------------------------------------------------------------------- a Guard down for minutes
//
// The kill phase's Guards are back within 17 s, inside what the runner used to retry. This one is longer than any retry budget: the Guard stays down for several minutes while
// customers keep writing and links keep being paid, and the runtime is restarted once while it is down. What decides it is the provider's own side, read back from the stand-ins.

/** What went to the provider twice: a booking's second link or event, or the same words to the same customer twice (the owner's notices can repeat for two bookings, so they are left out). */
function repeated(st: any): { links: string[]; events: string[]; messages: string[] } {
  const links = ((st.links ?? []) as { reference_id: string }[]).reduce<Record<string, number>>((m, l) => { m[l.reference_id] = (m[l.reference_id] ?? 0) + 1; return m; }, {});
  const events = ((st.calendar ?? []) as { bookingRef?: string; status?: string }[]).filter((e) => e.status !== "cancelled").reduce<Record<string, number>>((m, e) => { const k = e.bookingRef ?? "?"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const texts = ((st.outbox ?? []) as { to: string; text: string }[]).filter((x) => digits(x.to) !== digits(OWNER)).reduce<Record<string, number>>((m, x) => { const k = `${digits(x.to)}|${x.text}`; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return { links: Object.entries(links).filter(([, n]) => n > 1).map(([k]) => k), events: Object.entries(events).filter(([, n]) => n > 1).map(([k]) => k), messages: Object.entries(texts).filter(([, n]) => n > 1).map(([k]) => k.slice(0, 80)) };
}

const tasksOf = (shop: string): { pending?: number; done?: number; failed?: number } | undefined => {
  try { return (JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "observe"]).out.trim().split("\n").at(-1) ?? "{}") as { shops: { id: string; status?: { tasks?: { pending?: number; done?: number; failed?: number } } }[] }).shops.find((x) => x.id === shop)?.status?.tasks; } catch { return undefined; }
};

async function guardOutage() {
  say("\n== a Guard down for several minutes under traffic, the runtime restarted while it is down ==");
  const shop = "glow-salon";
  const out: Record<string, unknown> = {};
  for (const kind of ["razorpay", "whatsapp"]) {
    const svc = `g-${shop}-${kind}`;
    const failedBefore = tasksOf(shop)?.failed ?? 0;
    const driving = drive(1, 240, 6, `outage ${kind}`);
    await sleep(20_000);
    dk(["kill", containerOf(svc)]); // by hand: Docker does not restart it, so it stays down until it is started again
    const downFrom = Date.now();
    await sleep(1500);
    const atKill = await providerCount(shop, kind);
    await sleep(90_000);
    dc(["restart", `rt-${shop}`], { timeout: 120_000 }); // the wait is on disk: the restart must not lose it
    const backUp = await waitFor(`rt-${shop} to be ready again`, () => healthy(`rt-${shop}`), 90);
    const pendingWhileDown = tasksOf(shop)?.pending ?? -1;
    await sleep(90_000);
    const beforeRestart = await providerCount(shop, kind);
    const downTo = Date.now();
    dc(["up", "-d", "--no-deps", svc]);
    const guardBack = await waitFor(`${svc} to be ready again`, () => healthy(svc), 90);
    const load = await driving;
    const drained = await waitFor("every waiting task to finish", () => tasksOf(shop)?.pending === 0, 300);
    const answers = await latencies(load.sent, 60);
    const delivered = load.sent.filter((s) => s.ok).length;
    const after = await control(shop, "/_standin/state");
    const twice = repeated(after);
    const failedAfter = tasksOf(shop)?.failed ?? -1;
    // each payment's work done once: every paid link's booking is confirmed in the calendar, by exactly one event (the provider's own records, not the runtime's word)
    // Only links that belong to a booking: the kill phase's raw Guard calls (RAW_LOAD_REF) make links with no booking behind them, by design, and the drive()'s payer pays any open link, those too; booking ids are "b-N", so the prefix cannot match a booking's link.
    const paidRefs = ((after.links ?? []) as { reference_id: string; status: string }[]).filter((l) => l.status === "paid" && !l.reference_id.startsWith(RAW_LOAD_REF)).map((l) => l.reference_id);
    const confirmedBy = ((after.calendar ?? []) as { bookingRef?: string; status?: string }[]).filter((e) => e.status === "confirmed").reduce<Record<string, number>>((m, e) => { const k = e.bookingRef ?? "?"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const notConfirmedOnce = paidRefs.filter((r) => confirmedBy[r] !== 1);
    out[kind] = { downSeconds: Math.round((downTo - downFrom) / 1000), sent: load.sent.length, delivered, answered: answers.answered, longestWaitSeconds: Math.round((answers.waits.at(-1) ?? 0) / 1000), providerAtKill: atKill, providerBeforeRestart: beforeRestart, pendingWhileDown, failedTasksDuring: failedAfter - failedBefore, runtimeRestartedWhileDown: backUp, paidLinks: paidRefs.length, paidNotConfirmedOnce: notConfirmedOnce, twice };
    say(`   ${kind}: ${JSON.stringify(out[kind])}`);
    check(`${kind} Guard down ${Math.round((downTo - downFrom) / 1000)} s: nothing reached the ${kind} provider while it was down (${atKill} -> ${beforeRestart})`, atKill >= 0 && atKill === beforeRestart, { atKill, beforeRestart });
    check(`${kind} Guard down: the messages waited on disk, through a restart of the runtime (${pendingWhileDown} pending just after the restart)`, backUp && pendingWhileDown >= 1, { pendingWhileDown, backUp });
    check(`${kind} Guard back: the waiting work finished, every message was answered (${answers.answered} of ${delivered}) and no task failed`, guardBack && drained && answers.answered === delivered && failedAfter - failedBefore === 0, { answered: answers.answered, delivered, drained, failed: failedAfter - failedBefore });
    check(`${kind} Guard back: nothing was sent to a provider twice (no second link or event for a booking, no message twice)`, twice.links.length === 0 && twice.events.length === 0 && twice.messages.length === 0, twice);
    check(`${kind} Guard back: each payment's work was done once: every paid link's booking is confirmed in the calendar by one event (${paidRefs.length} paid)`, paidRefs.length > 0 && notConfirmedOnce.length === 0, { paid: paidRefs.length, notConfirmedOnce });
  }
  results.guardOutage = out; save();
}

// ---------------------------------------------------------------------------------------------------------------------------------- item 3: a held refund, through the runtime

async function heldRefundThroughRuntime() {
  say("\n== a refund held for the owner survives restarting Guard and the runtime, through the runtime itself (B14 item 3) ==");
  const shop = "glow-salon";
  const st = () => control(shop, "/_standin/state");
  const c = nextCustomer(1);
  const wrote = await customerWrites(shop, c.from, c.text);
  let link: { id: string; pay_url: string } | undefined;
  // the link's address exactly as the message gives it (plink3 is the start of plink381, so a "contains" would find the wrong one)
  // Any https address in the customer's messages, compared whole with each link's own: the stand-in gateway's links are https://pay.example/<id> since B71 (b9e0976),
  // no longer rzp.io, and a pattern for one provider's host found none of them.
  await waitFor("the deposit link", async () => { const s = await st(); const urls = ((s.outbox ?? []) as { to: string; text: string }[]).filter((m) => digits(m.to) === digits(c.from)).flatMap((m) => m.text.match(/https:\/\/[^\s]+/gu) ?? []).map((u) => u.replace(/[.,;:!?)]+$/u, "")); link = ((s.links ?? []) as { id: string; pay_url: string }[]).find((l) => urls.includes(l.pay_url)); return !!link; }, 60);
  if (!link) { check("a booking through the runtime gets its deposit link (the start of the held-refund check)", false, { wrote }); return; }
  const refundsBefore = ((await st()).refunds ?? []).length;
  await control(shop, "/_standin/razorpay/pay", { request_id: link.id });
  const booked = await waitFor("'Booked!'", async () => ((await st()).outbox ?? []).some((m: { to: string; text: string }) => digits(m.to) === digits(c.from) && /^Booked!/u.test(m.text)), 60);
  check("the customer paid the deposit and the runtime booked it (the calendar and the payment record agree)", booked, link.id);
  await customerWrites(shop, c.from, "please cancel my booking");
  let held: { seq: number; refs: Record<string, string> } | undefined;
  await waitFor("the refund to be held for the owner", () => { held = recordOf(shop).find((e) => e.action === "refund" && e.outcome === "held_for_owner" && e.conversation.endsWith(digits(c.from).slice(-6))); return !!held; }, 60);
  const approval = held?.refs.approval;
  const reviews = () => nodeEval("relay", `fetch('http://${adminIpOf(`g-${shop}-razorpay`)}:8190/admin/reviews',{headers:{authorization:'Bearer ${readSecret("relay", `${shop}/read_token`)}'}}).then(async r=>console.log(r.status+' '+(await r.text())))`).out.trim();
  check("the cancellation's refund (₹200, above the owner's ₹100) is HELD by Guard, the runtime records it as held for the owner, nothing is refunded", !!approval && reviews().includes(approval!) && ((await st()).refunds ?? []).length === refundsBefore, { approval, refunds: ((await st()).refunds ?? []).length - refundsBefore });
  const before = recordOf(shop);
  dc(["restart", `g-${shop}-razorpay`]); await waitFor("the Guard", () => healthy(`g-${shop}-razorpay`), 90);
  dc(["restart", `rt-${shop}`]); await waitFor("the runtime", () => healthy(`rt-${shop}`), 90);
  const after = recordOf(shop);
  const intact = before.length > 0 && after.length >= before.length && before.every((e, i) => after[i]?.hash === e.hash);
  check(`after restarting both, the runtime's record is intact: the ${before.length} entries before are the first ${before.length} after, byte for byte`, intact, { before: before.length, after: after.length });
  check("and the hold is still there under the SAME approval, and still nothing is refunded", !!approval && reviews().includes(approval!) && ((await st()).refunds ?? []).length === refundsBefore, { approval });
  // the owner answers on WhatsApp, as an owner does: "approve <code>" from the code the relay sent
  let code: string | undefined;
  await waitFor("the relay's question to the owner", async () => { const m = ((await st()).outbox ?? []).filter((x: { to: string; text: string }) => digits(x.to) === digits(OWNER) && /approve\s+[A-HJKMNP-Z2-9]{6}/u.test(x.text)).at(-1); code = m ? /approve\s+([A-HJKMNP-Z2-9]{6})/u.exec(m.text)?.[1] : undefined; return !!code; }, 60);
  check("the approvals relay asked the owner on WhatsApp, with a one-use code", !!code, code ? "a code was sent" : "no code");
  if (code) await customerWrites(shop, OWNER, `approve ${code}`);
  const once = await waitFor("the refund", async () => ((await st()).refunds ?? []).length === refundsBefore + 1, 90);
  await sleep(35_000); // a tick: the runtime would try again now if it were going to
  const refunds = ((await st()).refunds ?? []).length - refundsBefore;
  const final = recordOf(shop);
  const confirmed = final.filter((e) => e.action === "refund" && e.outcome === "confirmed" && e.conversation === held?.conversation);
  check("the owner's approval sends it exactly once: one refund at the provider, one 'confirmed' refund in the record", once && refunds === 1 && confirmed.length === 1, { refundsAtProvider: refunds, confirmedInRecord: confirmed.length });
  check("and the record is still intact after it (every earlier entry unchanged)", after.every((e, i) => final[i]?.hash === e.hash), { entries: final.length });
  results.heldRefundThroughRuntime = { approval, recordBefore: before.length, recordAfterRestart: after.length, recordAtEnd: final.length, refunds };
}

// ---------------------------------------------------------------------------------------------------------------------------------- item 5: the licence

/** Every shop the proof may add, up to its largest load step: a lease must list each, or a release's Guard has no licence for it (decision 39). */
const PROOF_SHOPS = Array.from({ length: Math.max(1, ...SIZES) }, (_, i) => shopName(i + 1));
/** A shop in order for 30 days, as fleet lists a shop its trial covers (monorepo ADR-0070). */
const inOrder = (id: string) => ({ id, plan: "business", state: "active", paid_through: nowS() + 30 * DAY_S, grace_days: 0, expires: nowS() + 30 * DAY_S, stop_at: null, export_until: null, notice: null });
/**
 * A lease for this server, signed with RFC 8032's published test key (the key built into the proof's Guard), handed in as fleet's answer, and taken by the deployer.
 * It lists every proof shop in order, and the agent someone else wrote (the `agent` phase): an own agent's Guards are held to the lease by its name, as a shop's are
 * (bundle/agent/deploy.ts, B13), and fleet lists it once a heartbeat reports it, as it does a shop (the heartbeat's `agents`, fleet's admitTrialShops). Without it
 * every call the agent makes is refused with Guard's 402 subscription_suspended. `glowEntry` puts glow-salon in another state (the licence phase's wind-down,
 * stop and restore). The runtimes' own licence files are written for the shops only: an own agent has no runtime of ours.
 */
function handLease(serial: number, glowEntry?: Record<string, unknown>): string[] {
  const shops = [...PROOF_SHOPS, AGENT_NAME].map((id) => (id === "glow-salon" && glowEntry ? { id, plan: "business", grace_days: 30, ...glowEntry } : inOrder(id)));
  const token = signTest({ v: 1, kind: "lease", deployment: "proof", serial, issued_at: nowS(), shops });
  mkdirSync(join(SERVER, "fleet"), { recursive: true });
  writeFileSync(join(SERVER, "fleet", "lease"), `${token}\n`);
  return syncLicence(SERVER, loadServer(SERVER), PROOF_SHOPS, new Date());
}
const guardView = (svc: string) => JSON.parse(exec("ops", ["node", "/app/bundle/services/ops.ts", "admin", svc, "GET", "/admin/licence"]).out.trim().split("\n").at(-1) ?? "{}").body ?? {};
const SHOP_GUARDS = ["razorpay", "whatsapp", "calendar"].map((k) => `g-glow-salon-${k}`);
async function guardsSay(state: string): Promise<boolean> { return waitFor(`every Guard to say ${state}`, () => SHOP_GUARDS.every((g) => guardView(g).state === state), 30); }

async function licenceWindDown() {
  say("\n== the licence: a wind-down lease, at Guard and at the runtime (B14 item 5, D83) ==");
  const shop = "glow-salon";
  const rt = `rt-${shop}`;
  const st = () => control(shop, "/_standin/state");
  const agent = (k: string) => readSecret(rt, `agent_${k}`);
  const call = (kind: string, method: string, path: string, body?: unknown) => { const r = nodeEval(rt, `fetch('http://g-${shop}-${kind}:8080${path}',{method:'${method}',headers:{authorization:'Bearer ${agent(kind)}','content-type':'application/json'}${body ? `,body:${JSON.stringify(JSON.stringify(body))}` : ""}}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json().catch(()=>null)})))`); try { return JSON.parse(r.out.trim().split("\n").at(-1) ?? "{}") as { status: number; body: any }; } catch { return { status: 0, body: r.err.slice(0, 200) }; } };
  const newLink = (ref: string) => call("razorpay", "POST", "/v1/payment_links", { amount: 20000, currency: "INR", description: "licence check", reference_id: ref });
  const insert = (ref: string) => call("calendar", "POST", `/calendar/v3/calendars/${encodeURIComponent(calendarOf(1))}/events`, { summary: "licence check", start: { dateTime: new Date(Date.now() + 30 * DAY_S * 1000).toISOString() }, end: { dateTime: new Date(Date.now() + 30 * DAY_S * 1000 + 1800_000).toISOString() }, extendedProperties: { private: { bookingRef: ref } } });
  const sendTo = (to: string) => call("whatsapp", "POST", `/v21.0/${phoneOf(1)}/messages`, { messaging_product: "whatsapp", to, type: "text", text: { body: "licence check" } });
  const suspended = (r: { status: number; body: any }) => r.status === 402 && r.body?.guard?.code === "subscription_suspended" && r.body?.guard?.reason_code === "subscription_suspended" && r.body?.guard?.sent === "no";
  // a link made and paid while the shop is in order (not handed to the runtime), so a refund is owed during the wind-down
  const before = newLink("lic-before");
  const paid = await control(shop, "/_standin/razorpay/pay", { request_id: before.body?.id, deliver: false });
  const second = newLink("lic-cancel-me");
  const now = nowS();
  const lines = handLease(2, { state: "wind_down", paid_through: now - 35 * DAY_S, expires: now - 5 * DAY_S, stop_at: now + 25 * DAY_S, export_until: null, notice: "wind_down" });
  lines.forEach((l) => say(`   ${l}`));
  const panel = readStatus(SERVER, shop)?.licence?.state;
  const agree = await guardsSay("wind_down");
  const views = Object.fromEntries(SHOP_GUARDS.map((g) => [g, guardView(g)]));
  check("a wind-down lease (signed with the test key, handed in as fleet's answer): every Guard's GET /admin/licence shows the state the panel shows", panel === "wind_down" && agree && SHOP_GUARDS.every((g) => views[g].lease?.serial === 2 && views[g].keys?.[0]?.test_key === true),
    { panel, guards: Object.fromEntries(SHOP_GUARDS.map((g) => [g, { state: views[g].state, refuses_now: views[g].refuses_now, serial: views[g].lease?.serial }])) });
  const counts0 = await st();
  const link = newLink("lic-new-work"); const event = insert("lic-new-work");
  check("in the wind-down Guard refuses a new payment link with its own 402 subscription_suspended (not a policy denial), nothing sent", suspended(link), { status: link.status, code: link.body?.guard?.code, reason: String(link.body?.guard?.reason ?? "").slice(0, 120) });
  check("and a new calendar event, the same way", suspended(event), { status: event.status, code: event.body?.guard?.code });
  const counts1 = await st();
  const n = (x: any, k: string) => (Array.isArray(x?.[k]) ? x[k].length : -1);
  check("and neither reached the provider", n(counts1, "links") >= 0 && n(counts1, "links") === n(counts0, "links") && n(counts1, "calendar") === n(counts0, "calendar"), { links: [n(counts0, "links"), n(counts1, "links")], events: [n(counts0, "calendar"), n(counts1, "calendar")] });
  const refund = call("razorpay", "POST", `/v1/payments/${paid.payment?.id}/refund`, { amount: 5000, speed: "normal", receipt: "lic-before:refund" });
  const cancel = call("razorpay", "POST", `/v1/payment_links/${second.body?.id}/cancel`);
  check("a refund owed still goes through in the wind-down (₹50, under the owner's limit), and so does closing a link", refund.status === 200 && cancel.status === 200 && ((await st()).refunds ?? []).length === (counts0.refunds ?? []).length + 1, { refund: refund.status, cancel: cancel.status });
  const send = sendTo("919811199999");
  check("a message to a customer still goes in the wind-down (only the final stop holds sends back)", !suspended(send), { status: send.status });
  // the runtime's own check refuses the same new work: a customer asks to book, and is told the shop's online booking is paused
  const c = nextCustomer(1);
  await customerWrites(shop, c.from, c.text);
  await sleep(3000);
  const counts2 = await st();
  const reply = ((counts2.outbox ?? []) as { to: string; text: string }[]).filter((m) => digits(m.to) === digits(c.from)).at(-1)?.text ?? "";
  const own = recordOf(shop).filter((e) => e.action === "new_work").at(-1);
  check("the runtime refuses the same new work by its own check: 'paused, contact the shop', nothing held, no link", /paused/iu.test(reply) && n(counts2, "links") === n(counts1, "links") && n(counts2, "calendar") === n(counts1, "calendar") && own?.outcome === "blocked" && own.rules.includes("subscription_suspended:block"),
    { reply: reply.slice(0, 80), newWork: own?.notes.slice(0, 80) });
  // a builder edits the runtime's licence file to say the shop is in order: Guard still refuses, and the runtime takes Guard's 402 as its own pause, once
  const file = clientLicenceFile(SERVER, shop);
  const kept = readFileSync(file, "utf8");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(kept), shop: null })); utimesSync(file, new Date(), new Date());
  await sleep(1500);
  const t = nextCustomer(1);
  const callsBefore = (await st()).calls?.calendar?.length ?? 0;
  const tamperedAt = Date.now();
  await customerWrites(shop, t.from, t.text);
  await sleep(4000);
  const counts3 = await st();
  const reply3 = ((counts3.outbox ?? []) as { to: string; text: string }[]).filter((m) => digits(m.to) === digits(t.from)).at(-1)?.text ?? "";
  const byGuard = recordOf(shop).filter((e) => Date.parse(e.time) >= tamperedAt - 2000 && e.action === "hold_slot" && e.outcome === "blocked" && e.rules.includes("subscription_suspended:block"));
  check("with the runtime's file edited to 'in order', Guard still refuses the hold (402); the runtime records it once as blocked and tells the customer 'paused'; nothing reached the provider",
    /paused/iu.test(reply3) && n(counts3, "links") === n(counts2, "links") && n(counts3, "calendar") === n(counts2, "calendar") && byGuard.length === 1,
    { reply: reply3.slice(0, 80), blockedByGuard: byGuard.length, calendarCalls: (counts3.calls?.calendar?.length ?? 0) - callsBefore });
  syncLicence(SERVER, loadServer(SERVER), [shop], new Date()); // the deployer puts the runtime's file back
  check("the deployer puts the runtime's licence file back on its next pass", readFileSync(file, "utf8") === kept, "");
  // the final stop: sends are held back too, except to the owner
  handLease(3, { state: "stopped", paid_through: now - 70 * DAY_S, expires: now - 9 * DAY_S, stop_at: now - DAY_S, export_until: now + 150 * DAY_S, notice: "stop" });
  const stopped = await guardsSay("stopped");
  const toCustomer = sendTo("919811199999"); const toOwner = sendTo(digits(OWNER));
  check("the final stop: every Guard says stopped, as the panel does; a send to a customer is refused (402), a send to the owner's number goes", stopped && readStatus(SERVER, shop)?.licence?.state === "stopped" && suspended(toCustomer) && !suspended(toOwner) && toOwner.status !== 0,
    { panel: readStatus(SERVER, shop)?.licence?.state, toCustomer: toCustomer.status, toOwner: toOwner.status });
  // in order again: a newer lease lifts it, at Guard and at the runtime
  handLease(4, { state: "active", paid_through: now + 30 * DAY_S, expires: now + 30 * DAY_S, stop_at: null, export_until: null, notice: null });
  const active = await guardsSay("active");
  const again = newLink("lic-after");
  check("a newer lease in order lifts it: every Guard says active, as the panel does, and a new link is made again", active && readStatus(SERVER, shop)?.licence?.state === "active" && (again.status === 200 || again.status === 201), { panel: readStatus(SERVER, shop)?.licence?.state, link: again.status });
  results.licence = { views: Object.fromEntries(SHOP_GUARDS.map((g) => [g, guardView(g)])) }; save();
}

// ---------------------------------------------------------------------------------------------------------------------------------- item 4: load, under the cap

/** The bound the shops-per-server count is judged by: a customer's first answer within 5 seconds, 95 times in 100. */
const LATENCY_BOUND_P95_MS = 5_000;
/** Each shop: a new customer every 15 s (240 an hour, several times a busy salon's busiest hour), half the deposit links paid. */
const LOAD_PER_MINUTE = 4;
const MiB = 1024 * 1024;

/** The proof's volumes, by kind, in bytes: `du` in one read-only one-off container that mounts them all. */
function volumeSizes(): { runtimes: number; guards: number; other: number; byName: Record<string, number> } {
  const vols = dk(["volume", "ls", "-q", "--filter", `name=${PROJECT}_`]).out.trim().split("\n").filter(Boolean);
  const r = dk(["run", "--rm", "--network", "none", ...vols.flatMap((v) => ["-v", `${v}:/v/${v.replace(`${PROJECT}_`, "")}:ro`]), "alpine:3.22", "du", "-sk", ...vols.map((v) => `/v/${v.replace(`${PROJECT}_`, "")}`)], { timeout: 300_000 });
  if (r.code !== 0) return { runtimes: NaN, guards: NaN, other: NaN, byName: {} };
  const byName = Object.fromEntries(r.out.trim().split("\n").map((l) => l.split("\t")).filter((x) => x.length === 2).map(([kb, path]) => [path.replace("/v/", ""), Number(kb) * 1024]));
  const sum = (f: (n: string) => boolean) => Object.entries(byName).filter(([n]) => f(n)).reduce((a, [, b]) => a + b, 0);
  return { runtimes: sum((n) => n.startsWith("rt-data-")), guards: sum((n) => n.startsWith("gs-") && n !== "gs-model"), other: sum((n) => !n.startsWith("rt-data-") && !(n.startsWith("gs-") && n !== "gs-model")), byName };
}

/** MinIO's own count of the requests it served, by S3 API (its Prometheus endpoint, public in the test's MinIO only). */
async function minioOps(): Promise<Record<string, number>> {
  for (const [path, metric, label] of [["/minio/v2/metrics/cluster", "minio_s3_requests_total", "api"], ["/minio/v2/metrics/node", "minio_s3_requests_total", "api"], ["/minio/metrics/v3/api/requests", "minio_api_requests_total", "name"]]) {
    try {
      const t = await (await fetch(`http://127.0.0.1:19000${path}`, { signal: AbortSignal.timeout(10_000) })).text();
      const out: Record<string, number> = {};
      for (const m of t.matchAll(new RegExp(`^${metric}\\{([^}]*)\\}\\s+([\\d.e+]+)$`, "gmu"))) { const api = new RegExp(`${label}="([^"]+)"`, "u").exec(m[1])?.[1] ?? "?"; out[api] = (out[api] ?? 0) + Number(m[2]); }
      if (Object.keys(out).length > 0) return out;
    } catch { /* the next path */ }
  }
  return {};
}
const opsDelta = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
const cores = (a?: CapReading, b?: CapReading) => (a && b ? +((b.cpuUsec - a.cpuUsec) / ((b.atMs - a.atMs) * 1000)).toFixed(3) : NaN);

/**
 * The size of the agent's saved state. Until layout 3 every step wrote all of it again; since then (modules/runtime/store.ts) a step writes only the rows it changed, so
 * this is what the state holds, not what a step writes. Read from either layout: the pieces (shape and rows) or the old one-row table.
 */
function snapshotBytes(shop: string): number {
  const r = dk(["run", "--rm", "--network", "none", "--user", "1000:1000", "-v", `${PROJECT}_rt-data-${shop}:/d`, "node:26-alpine", "node", "-e", "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/d/data/agent.db',{readOnly:true});let n;try{n=db.prepare('SELECT coalesce((SELECT length(shape) FROM state_shape),0)+coalesce((SELECT sum(length(value)) FROM state_rows),0) AS n').get().n}catch{n=db.prepare('SELECT length(snapshot) AS n FROM state').get()?.n ?? 0}console.log(n)"], { timeout: 60_000 });
  return Number(r.out.trim().split("\n").at(-1) ?? NaN);
}

const loads: Record<number, any> = {};
async function loadStep(size: number) {
  say(`\n== load at ${size} shop(s), every bundle container inside 2 CPUs and 4 GiB (B14 item 4) ==`);
  // a quiet minute first: the CPU, and the bucket's operations (none expected between nightly snapshots), with nothing asked of the shops
  const opsIdleA = await minioOps(); const idleA = readCap(); const writesIdleA = writesByContainer(); await sleep(60_000); const idleB = readCap(); const writesIdleB = writesByContainer(); const opsIdleB = await minioOps();
  const idleHours = idleA && idleB ? (idleB.atMs - idleA.atMs) / 3_600_000 : 1 / 60;
  const diskBefore = volumeSizes();
  const opsA = await minioOps(); const capA = readCap(); const writesA = writesByContainer();
  const load = await drive(size, LOAD_SECONDS, LOAD_PER_MINUTE, `load ${size}`);
  const capB = readCap(); const writesB = writesByContainer(); const opsB = await minioOps();
  const answers = await latencies(load.sent);
  const diskAfter = volumeSizes();
  const hours = (capB && capA ? capB.atMs - capA.atMs : LOAD_SECONDS * 1000) / 3_600_000;
  const peakCores = load.samples.slice(1).map((s, k) => cores(load.samples[k], s)).filter((x) => Number.isFinite(x));
  const r = {
    shops: size, seconds: LOAD_SECONDS, perShopPerMinute: LOAD_PER_MINUTE, sent: load.sent.length, delivered: load.sent.filter((s) => s.ok).length, answered: answers.answered, paid: load.paid,
    latencyMs: { p50: pct(answers.waits, 50), p95: pct(answers.waits, 95), max: answers.waits.at(-1) ?? NaN },
    cpuCores: { idle: cores(idleA, idleB), load: cores(capA, capB), peak10s: peakCores.length ? Math.max(...peakCores) : NaN, throttledSeconds: capA && capB ? +((capB.throttledUsec - capA.throttledUsec) / 1e6).toFixed(1) : NaN },
    memoryMiB: { atEnd: capB ? +(capB.memoryBytes / MiB).toFixed(0) : NaN, peakSinceStart: capB ? +(capB.peakBytes / MiB).toFixed(0) : NaN, oomKills: capB?.oomKills },
    diskMiB: { runtimesNow: +(diskAfter.runtimes / MiB).toFixed(2), guardsNow: +(diskAfter.guards / MiB).toFixed(2), growthDuringLoad: +(((diskAfter.runtimes + diskAfter.guards) - (diskBefore.runtimes + diskBefore.guards)) / MiB).toFixed(2) },
    diskWritesMiBPerShopPerHour: capA && capB ? +(((capB.writeBytes - capA.writeBytes) / MiB) / size / hours).toFixed(1) : NaN,
    diskWritesIdleMiBPerShopPerHour: idleA && idleB ? +(((idleB.writeBytes - idleA.writeBytes) / MiB) / size / idleHours).toFixed(1) : NaN,
    // each message's share: the load's writes above the quiet rate, spread over the messages. Fixed amount per hour + this per message is a real shop's figure.
    diskWritesPerMessageMiB: capA && capB && idleA && idleB && load.sent.length > 0 ? +((((capB.writeBytes - capA.writeBytes) - (idleB.writeBytes - idleA.writeBytes) * (hours / idleHours)) / MiB) / load.sent.length).toFixed(3) : NaN,
    writesIdleByGroup: writesPerGroup(writesIdleA, writesIdleB, idleHours, size),
    writesLoadByGroup: writesPerGroup(writesA, writesB, hours, size),
    snapshotBytes: snapshotBytes(shopName(1)),
    bucketOpsPerShopPerHour: Object.fromEntries(Object.entries(opsDelta(opsA, opsB)).map(([k, v]) => [k, Math.round((v as number) / size / hours)])),
    bucketOpsIdlePerShopPerHour: Object.fromEntries(Object.entries(opsDelta(opsIdleA, opsIdleB)).map(([k, v]) => [k, Math.round((v as number) / size / idleHours)])),
    topContainersCpu: load.stats.filter((c) => !TEST_SERVICES.has(c.name)).sort((a, b) => b.cpu - a.cpu).slice(0, 6),
    unanswered: answers.unanswered.length,
  };
  loads[size] = r; results.load = loads; save();
  say(`   ${JSON.stringify(r)}`);
  check(`load at ${size} shop(s): every message the inbox took was answered`, r.delivered === r.sent && answers.unanswered.length === 0, { sent: r.sent, delivered: r.delivered, answered: r.answered });
  check(`load at ${size} shop(s): no container was killed for memory inside the 4 GiB cap`, (capB?.oomKills ?? 1) === 0, { oomKills: capB?.oomKills });
  say(`   ${size} shop(s): p95 answer ${r.latencyMs.p95} ms (bound ${LATENCY_BOUND_P95_MS} ms), CPU ${r.cpuCores.load} of 2 cores, memory ${r.memoryMiB.atEnd} MiB of 4096`);
}

function loadSummary() {
  const sizes = Object.keys(loads).map(Number).sort((a, b) => a - b);
  say(`\nLOAD (2 CPUs, 4 GiB for every bundle container together; a customer every 15 s per shop, half the links paid; ${LOAD_SECONDS} s each; bound: p95 first answer <= ${LATENCY_BOUND_P95_MS} ms)`);
  say("  shops  sent  answered  p50 ms  p95 ms  max ms  CPU idle  CPU load  CPU peak  MiB end  MiB peak  disk MiB/shop  writes MiB/shop/h");
  for (const n of sizes) { const r = loads[n]; say(`  ${String(n).padStart(5)}  ${String(r.sent).padStart(4)}  ${String(r.answered).padStart(8)}  ${String(r.latencyMs.p50).padStart(6)}  ${String(r.latencyMs.p95).padStart(6)}  ${String(r.latencyMs.max).padStart(6)}  ${String(r.cpuCores.idle).padStart(8)}  ${String(r.cpuCores.load).padStart(8)}  ${String(r.cpuCores.peak10s).padStart(8)}  ${String(r.memoryMiB.atEnd).padStart(7)}  ${String(r.memoryMiB.peakSinceStart).padStart(8)}  ${String(+((r.diskMiB.runtimesNow + r.diskMiB.guardsNow) / n).toFixed(2)).padStart(13)}  ${String(r.diskWritesMiBPerShopPerHour).padStart(17)}`); }
  const within = sizes.filter((n) => loads[n].latencyMs.p95 <= LATENCY_BOUND_P95_MS && loads[n].unanswered === 0);
  const largest = within.at(-1);
  const ceilingFound = sizes.some((n) => !within.includes(n));
  results.loadVerdict = { bound: `p95 first answer <= ${LATENCY_BOUND_P95_MS} ms, every message answered`, within, largest, ceilingFound, note: ceilingFound ? `the largest count measured within the bound is ${largest}` : `every count measured (up to ${largest}) stayed within the bound: the ceiling was not found` };
  say(`  ${String((results.loadVerdict as { note: string }).note)}`);
  save();
}


if (import.meta.main) {
  try { await main_(); } catch (e) { say(`\nTHE PROOF STOPPED: ${(e as Error).stack ?? e}`); results.error = String(e); }
  finally {
    results.finishedAt = new Date().toISOString();
    results.summary = { passed: (results.checks as { ok: boolean }[]).filter((c) => c.ok).length, failed: (results.checks as { ok: boolean }[]).filter((c) => !c.ok).map((c) => (c as unknown as { name: string }).name) };
    save();
    if (!KEEP) {
      say("\n== cleanup ==");
      const standinsLog = dc(["logs", "--no-color", "--tail", "60", "standins"]).out;
      results.standinsLog = standinsLog.split("\n").filter((l) => /stand-ins: |Error|restart/iu.test(l)).slice(-20); save();
      say(`the stand-ins' own errors: ${(results.standinsLog as string[]).length} (in results.json)`);
      dc(["down", "-v", "--remove-orphans", "--timeout", "10"], { timeout: 600_000 });
      for (const row of dk(["ps", "-a", "--filter", "name=geometer-job", "-q"]).out.trim().split("\n").filter(Boolean)) dk(["rm", "-f", row]);
      for (const v of dk(["volume", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean)) dk(["volume", "rm", "-f", v]);
      for (const n of dk(["network", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean)) dk(["network", "rm", n]);
      say(`the capped cgroup removed: ${removeCap().out.trim()}`);
      say(`left behind: containers ${dk(["ps", "-a", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean).length}, volumes ${dk(["volume", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean).length}, networks ${dk(["network", "ls", "-q", "--filter", `name=${PROJECT}`]).out.trim().split("\n").filter(Boolean).length}`);
    }
    say(`\n${JSON.stringify(results.summary)}`);
    process.exit((results.summary as { failed: string[] }).failed.length === 0 && !results.error ? 0 : 1);
  }

}
