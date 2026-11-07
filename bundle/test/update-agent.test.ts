// `geometer update` for an agent someone else wrote (B53 with B52): the crash test is run on the agent's own settings at the version last recorded as in service and at the version in
// agent.json, the two answers are compared the way a template's hand checks are, and the agent is moved (recorded at the new version, with a go-live certificate) or held back (the old
// version stays in service, no certificate for the new one, the situation named). The crash test is answered by a stand-in in the very JSON the real one prints, except in the one test
// that runs the real thing: a good version in service, a broken one held back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { addAgent } from "../agent/deploy.ts";
import { notTestedFor } from "../agent/crash-test/run.ts";
import type { CrashResult } from "../agent/crash-test/run.ts";
import { issueGoLive, recordService } from "../agent/crash-test/golive.ts";
import { setAgent } from "../agent/folder.ts";
import { main } from "../geometer.ts";
import { realRunner } from "../lib/runner.ts";
import { loadState } from "../lib/state.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, panelRuntime } from "./helpers.ts";
import { BINARY, skipWithoutBinary } from "./real-guard.ts";
import { world } from "./world.ts";
import type { World } from "./world.ts";

const EXAMPLES = new URL("../examples/own-agent/", import.meta.url).pathname;
const flags = { "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
const TITLES = ["A normal booking", "Razorpay created the link but the reply was lost", "Razorpay made the refund but the reply was lost", "Razorpay key expired"];
const LOST_REFUND = "Razorpay made the refund but the reply was lost";
const ALL_TITLES = Array.from({ length: 10 }, (_, i) => `situation ${i}`);

async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

/** What the crash test prints with --json: these situations, the ones named failing not holding. */
function answer(version: string, failing: string[] = [], titles = TITLES): CrashResult {
  const situations = titles.map((title, i) => ({ id: `s${i}`, title, held: !failing.includes(title), how: "", checks: [failing.includes(title) ? { label: "A check", passed: false, detail: "what the stand-ins hold" } : { label: "A check", passed: true, detail: "" }] }));
  const held = situations.filter((s) => s.held).length;
  return { format: "geometer-agent-crash-test/1", agent: "my-agent", version, held, total: situations.length, failed: situations.length - held, situations, notRun: [], notTested: notTestedFor([]), tookMs: 1000 };
}

/** The agent crash test the update starts, answered here; remembers which version it was asked about, in order. */
function crashTestStandIn(w: World, answerFor: (version: string) => CrashResult | { code: number; stderr: string }) {
  const asked: string[] = [];
  const next = w.ctx.runner.run.bind(w.ctx.runner);
  w.ctx.runner.run = async (command, args, options) => {
    if (command === process.execPath && args[1] === "agent" && args[2] === "crash-test") {
      const version = args[args.indexOf("--version") + 1];
      asked.push(version);
      const a = answerFor(version);
      return "format" in a ? { code: a.failed === 0 ? 0 : 1, stdout: `  1/${a.total}  progress\n${JSON.stringify(a)}\n`, stderr: "" } : { code: a.code, stdout: "", stderr: a.stderr };
    }
    return next(command, args, options);
  };
  return asked;
}

const update = (w: World, ...args: string[]) => quiet(() => main(["update", ...args, "--server", w.root], w.ctx));
const rollback = (w: World, ...args: string[]) => quiet(() => main(["rollback", ...args, "--server", w.root], w.ctx));
const certificate = (w: World) => join(w.paths.exportsOf("my-agent"), "go-live-certificate.json");
const inService = (w: World) => loadState(w.root).agents?.["my-agent"]?.service;
const set = (w: World, version: string) => setAgent(w.root, "my-agent", { version });

function tree(root: string, into: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) tree(path, into); else into[path] = readFileSync(path, "utf8");
  }
  return into;
}

/** A server with one agent that can be crash-tested, and no shop. */
function agentServer(run = "node app.js --at {version}", version = "v1"): World {
  const w = world({});
  addAgent(w.root, "my-agent", { ...flags, run, version }, () => "", new Date("2026-11-05T09:00:00Z"));
  return w;
}

test("the first update of an agent records the version it is at when everything holds, with a go-live certificate, and checks nothing before it", async () => {
  const w = agentServer(); try {
    const asked = crashTestStandIn(w, (v) => answer(v));
    const r = await update(w);
    assert.equal(r.result, 0, r.out);
    assert.deepEqual(asked, ["v1"], "there is nothing recorded to compare with, so only this version is tried");
    assert.match(r.out, /✓ my-agent +is recorded at v1: nothing was recorded before\. Held 4 of 4 on its own settings\./);
    assert.match(r.out, /Moved 1, held back 0, unchanged 0, skipped 0\./);
    assert.deepEqual([inService(w)!.version, inService(w)!.held, inService(w)!.of], ["v1", 4, 4]);
    const cert = JSON.parse(readFileSync(certificate(w), "utf8")).document;
    assert.deepEqual([cert.pathway, cert.checks.held, cert.checks.total], [{ name: "own-agent", version: "v1" }, 4, 4]);
    assert.equal(loadState(w.root).update!.steps["my-agent"].status, "moved");
    // and the same command again has nothing to do
    asked.length = 0;
    const again = await update(w);
    assert.match(again.out, /= my-agent +unchanged\. Already on v1\./);
    assert.deepEqual(asked, [], "a version that is in service is not tried again");
  } finally { w.done(); }
});

test("a new version is tried beside the one in service: it moves when it holds everything that held, and is held back, with the situation named, when it does worse", async () => {
  const w = agentServer(); try {
    const failsAt = new Map<string, string[]>();
    const asked = crashTestStandIn(w, (v) => answer(v, failsAt.get(v)));
    await update(w);
    const first = JSON.parse(readFileSync(certificate(w), "utf8"));

    // v2 holds all: moved
    set(w, "v2"); asked.length = 0;
    const moved = await update(w);
    assert.deepEqual(asked, ["v1", "v2"], "the version in service first, then the new one");
    assert.match(moved.out, /✓ my-agent +moved from v1 to v2\. Held 4 of 4 on its own settings \(4 of 4 before\)\./);
    assert.equal(moved.result, 0);
    assert.equal(inService(w)!.version, "v2");
    assert.equal(JSON.parse(readFileSync(certificate(w), "utf8")).document.pathway.version, "v2", "the go-live certificate is the new version's");
    const v2cert = readFileSync(certificate(w), "utf8");

    // v3 loses a situation v2 held: held back
    failsAt.set("v3", [LOST_REFUND]); set(w, "v3"); asked.length = 0;
    const held = await update(w);
    assert.deepEqual(asked, ["v2", "v3"]);
    assert.equal(held.result, 1);
    assert.match(held.out, /✗ my-agent +HELD BACK\. Held 3 of 4 at v3; 4 of 4 held at v2\. Now failing: Razorpay made the refund but the reply was lost\. Keep running v2: v3 gets no go-live certificate\./);
    assert.match(held.out, /- Razorpay made the refund but the reply was lost: A check: what the stand-ins hold/);
    assert.match(held.out, /Moved 0, held back 1, unchanged 0, skipped 0\./);
    assert.equal(inService(w)!.version, "v2", "the version in service is still v2");
    assert.equal(readFileSync(certificate(w), "utf8"), v2cert, "and the certificate is still v2's: v3 got none");
    assert.equal(loadState(w.root).update!.steps["my-agent"].status, "held-back");
    assert.notEqual(first.document.pathway.version, "v2");

    // a situation that fails at both versions does not hold the agent back: it is no worse off than it was
    failsAt.set("v2", ["Razorpay key expired"]); failsAt.set("v5", ["Razorpay key expired"]);
    set(w, "v5");
    const same = await update(w);
    assert.match(same.out, /✓ my-agent +moved from v2 to v5\. Held 3 of 4 on its own settings \(3 of 4 before\)\./);
  } finally { w.done(); }
});

test("a first version with a situation failing is held back (nothing is recorded to say it is no worse), and one that is no longer tried is named apart from one that fails", async () => {
  const w = agentServer(); try {
    let v1Fails = true;
    crashTestStandIn(w, (v) => (v === "v1" ? answer(v, v1Fails ? ["Razorpay key expired"] : []) : answer(v, [], TITLES.slice(0, 3))));
    const first = await update(w);
    assert.equal(first.result, 1);
    assert.match(first.out, /HELD BACK\. Held 3 of 4 at v1\. Now failing: Razorpay key expired\. v1 gets no go-live certificate\./);
    assert.equal(inService(w), undefined);
    assert.equal(existsSync(certificate(w)), false);
    // v1 is then fixed and recorded (by `agent go-live`), and v2 stops trying one of the situations
    v1Fails = false;
    recordService(w.ctx, "my-agent", answer("v1"), "CODE");
    set(w, "v2");
    const dropped = await update(w);
    assert.match(dropped.out, /HELD BACK\. Held 3 of 3 at v2; 4 of 4 held at v1\. No longer checked at v2: Razorpay key expired\. Keep running v1/);
  } finally { w.done(); }
});

test("an update that cannot run the crash test says why and holds the agent back: at the old version, at the new one, or when nothing could be run", async () => {
  const w = agentServer(); try {
    let mode: "good" | "old-broken" | "new-broken" | "nothing" = "good";
    crashTestStandIn(w, (v) => {
      if (mode === "old-broken" && v === "v1") return { code: 2, stderr: "The agent did not start: the agent stopped by itself with exit code 1 before it answered. It printed: Error: Cannot find module './app.js'" };
      if (mode === "new-broken" && v === "v2") return { code: 2, stderr: "geo-guard did not start" };
      if (mode === "nothing") return { ...answer(v, [], []), notRun: [{ id: "x", title: "A normal booking", reason: "the agent has nothing at /webhooks/whatsapp (HTTP 404)" }] };
      return answer(v);
    });
    await update(w);
    set(w, "v2");
    mode = "old-broken";
    const old = await update(w);
    assert.match(old.out, /HELD BACK\. The crash test could not be run at v1, the version it was last checked at, so there is nothing to compare v2 with \(The agent did not start: .*Cannot find module.*\)\. Keep running v1\./);
    mode = "new-broken";
    const young = await update(w);
    assert.match(young.out, /HELD BACK\. The crash test could not be run at v2 \(geo-guard did not start\)\. Keep running v1\./);
    mode = "nothing";
    const none = await update(w);
    assert.match(none.out, /HELD BACK\. No situation could be run at v2: A normal booking \(the agent has nothing at \/webhooks\/whatsapp \(HTTP 404\)\)\. Keep running v1\./);
    assert.equal(inService(w)!.version, "v1");
  } finally { w.done(); }
});

test("a dry run tries the versions and says what would happen, and writes nothing", async () => {
  const w = agentServer(); try {
    crashTestStandIn(w, (v) => answer(v));
    await update(w);
    set(w, "v2");
    const before = tree(w.root);
    const r = await update(w, "--dry-run");
    assert.match(r.out, /^Dry run: nothing was changed\./u);
    assert.match(r.out, /✓ my-agent +would move from v1 to v2\. Held 4 of 4 on its own settings \(4 of 4 before\)\./);
    assert.deepEqual(tree(w.root), before, "every file under the server folder is as it was");
  } finally { w.done(); }
});

test("an agent with a command but no version is skipped and told how to say it; a command that never uses the version is told it compared the same code with itself; rollback has nothing to roll back", async () => {
  const w = world({ "glow-salon": panelRuntime() }); try {
    addAgent(w.root, "my-agent", { ...flags, run: "node app.js" }, () => "", new Date("2026-11-05T09:00:00Z"));
    crashTestStandIn(w, (v) => answer(v));
    const none = await quiet(() => main(["update", "--shops", "my-agent", "--server", w.root], w.ctx));
    assert.match(none.out, /- my-agent +skipped\. agent\.json has no version, so there is no new version to check\. Say which version your agent is at: geometer agent set my-agent --version <version>\./);
    set(w, "v1"); await update(w, "--shops", "my-agent");
    set(w, "v2");
    const same = await update(w, "--shops", "my-agent");
    assert.match(same.out, /✓ my-agent +moved from v1 to v2\./);
    assert.match(same.out, /Note: the run command does not use \{version\} or \$GEOMETER_AGENT_VERSION, so both crash tests started the same code\./);
    const back = await rollback(w, "my-agent");
    assert.match(back.out, /- my-agent +skipped\. Geometer does not run an agent you wrote, so there is nothing for it to roll back\./);
  } finally { w.done(); }
});

test("a real update: the good example is in service, the broken one is held back because of the one refund situation it fails, and the good one is still in service", { skip: skipWithoutBinary }, async () => {
  const w = world({}); try {
    addAgent(w.root, "my-agent", { ...flags, run: `node ${EXAMPLES}{version}.js`, version: "server" }, () => "", new Date("2026-11-05T09:00:00Z"));
    // the crash test is its own program, started through the runner: here it is really started, with the Guard program of this computer
    const next = w.ctx.runner.run.bind(w.ctx.runner);
    const asked: string[] = [];
    w.ctx.runner.run = (command, args, options) => {
      if (command === process.execPath && args[1] === "agent" && args[2] === "crash-test") { asked.push(args[args.indexOf("--version") + 1]); return realRunner.run(command, args, { ...options, env: { ...options?.env, GEO_GUARD_BIN: BINARY } }); }
      return next(command, args, options);
    };
    // the good example is already in service, with its certificate (a first update, and `agent go-live`, make these; the stand-in tests above do that)
    const inServiceNow = answer("server", [], ALL_TITLES);
    recordService(w.ctx, "my-agent", inServiceNow, issueGoLive(w.ctx, "my-agent", inServiceNow).code);
    const certificateBefore = readFileSync(certificate(w), "utf8");
    set(w, "server-broken");
    const bad = await update(w);
    assert.deepEqual(asked, ["server", "server-broken"]);
    assert.equal(bad.result, 1, bad.out);
    assert.match(bad.out, /✗ my-agent +HELD BACK\. Held 9 of 10 at server-broken; 10 of 10 held at server\. Now failing: Razorpay made the refund but the reply was lost\. Keep running server: server-broken gets no go-live certificate\./);
    assert.match(bad.out, /After the answer was lost the agent did not ask for the refund again: Guard saw 3 more refund requests/);
    assert.equal(inService(w)!.version, "server");
    assert.equal(readFileSync(certificate(w), "utf8"), certificateBefore);
  } finally { w.done(); }
});

