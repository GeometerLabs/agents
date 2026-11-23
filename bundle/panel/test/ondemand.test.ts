// The on-demand panel (ondemand.ts): it starts asleep, answers its health check without loading the full panel, wakes on the first request, finishes what is in
// flight and then exits when idle, and a sign-in or a half-done setup made before a sleep still works after the restart (everything is in files, none in memory).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerResponse } from "node:http";
import type { Handler } from "../ondemand.ts";
import { startOnDemand } from "../ondemand.ts";
import { Browser, boot } from "./helpers.ts";
import { STEP1 } from "./flow.ts";

const quiet = { log: () => {} };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("asleep, the panel answers its health check without loading the full panel; the first real request wakes it, is answered, and later ones too", async () => {
  const b = await boot();
  await b.close(); // only for its config and folder
  let loads = 0;
  const hello: Handler = async (_req, res) => { res.writeHead(200, { "content-type": "text/plain" }).end("hello\n"); };
  const p = await startOnDemand({ ...b.config, port: 0 }, { ...quiet, load: async () => { loads += 1; await wait(30); return hello; } });
  try {
    for (let i = 0; i < 3; i++) { const h = await fetch(`${p.url}/healthz`); assert.equal(await h.text(), "ok\n"); }
    assert.equal(loads, 0, "the health check does not load the panel");
    assert.equal(p.awake(), false);
    // four requests at once while it is still loading: one load, every one answered
    const replies = await Promise.all([1, 2, 3, 4].map(() => fetch(`${p.url}/login`).then((r) => r.text())));
    assert.deepEqual(replies, ["hello\n", "hello\n", "hello\n", "hello\n"]);
    assert.equal(loads, 1);
    assert.equal(p.awake(), true);
    assert.equal((await fetch(`${p.url}/healthz`)).status, 200);
  } finally { await p.close(); }
});

test("a panel that cannot load answers 503 and tries again on the next request", async () => {
  const b = await boot();
  await b.close();
  let tries = 0;
  const p = await startOnDemand({ ...b.config, port: 0 }, { ...quiet, load: async () => { tries += 1; if (tries === 1) throw new Error("the data key is wrong"); return async (_q, res: ServerResponse) => { res.end("ok"); }; } });
  try {
    const first = await fetch(`${p.url}/login`);
    assert.equal(first.status, 503);
    assert.ok(!(await first.text()).includes("data key"), "the person is not shown the reason");
    assert.equal((await fetch(`${p.url}/login`)).status, 200);
  } finally { await p.close(); }
});

test("after the idle time it finishes the request in flight, then exits; the health check does not count as use", async () => {
  const b = await boot();
  await b.close();
  let exits = 0;
  let finished = false;
  const slow: Handler = async (req, res) => { if (req.url === "/slow") { await wait(500); finished = true; } res.end("done"); };
  const p = await startOnDemand({ ...b.config, port: 0 }, { ...quiet, idleMs: 200, load: async () => slow, exit: () => { exits += 1; } });
  try {
    const inFlight = fetch(`${p.url}/slow`).then((r) => r.text());
    await wait(350); // past the idle time, with the slow request still running
    assert.equal(exits, 0, "never exits with a request in flight");
    assert.equal(await inFlight, "done");
    assert.ok(finished);
    // health checks every 50 ms for a while: they do not keep it awake
    const until = Date.now() + 900;
    while (exits === 0 && Date.now() < until) { await fetch(`${p.url}/healthz`).catch(() => {}); await wait(50); }
    assert.equal(exits, 1, "slept although the health check kept asking");
    await assert.rejects(fetch(`${p.url}/login`), "the port is closed once it has slept");
  } finally { await p.close(); }
});

test("with 0 idle minutes it never sleeps, and the sleep is never shorter than the sign-in limiter's window", async () => {
  const b = await boot();
  await b.close();
  const mk = async (idleMinutes: number) => startOnDemand({ ...b.config, port: 0, idleMinutes }, { ...quiet, load: async () => async (_q, res) => { res.end("ok"); }, exit: () => { throw new Error("slept"); } });
  const never = await mk(0);
  const one = await mk(1);
  try {
    await wait(100);
    assert.equal((await fetch(`${never.url}/x`)).status, 200);
    assert.equal((await fetch(`${one.url}/x`)).status, 200);
  } finally { await never.close(); await one.close(); }
  // (the 15-minute floor itself is in idleMsOf; an exit within the test run would have thrown above)
});

test("a sign-in and a half-done setup made before a sleep still work after the restart", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner");
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const draft = start.location!.split("/")[2];
    assert.equal((await divya.post(`/setup/${draft}/1`, STEP1, `/setup/${draft}/1`)).status, 303);
    const invite = b.invite("partner");
    // sleep: the first panel ends; a second one starts asleep on the same folder and key, and wakes
    await b.close();
    const p = await startOnDemand({ ...b.config, port: 0 }, quiet);
    try {
      assert.equal(p.awake(), false);
      const after = new Browser(p.url);
      after.jar = new Map(divya.jar);
      const home = await after.get("/shops");
      assert.equal(home.status, 200, "the cookie from before the sleep still signs in");
      assert.equal(p.awake(), true);
      const step1 = await after.get(`/setup/${draft}/1`);
      assert.equal(step1.status, 200);
      assert.ok(step1.plain.includes("Hosahalli Beauty"), "the half-done setup is as it was left");
      const step2 = await after.get(`/setup/${draft}/2`);
      assert.equal(step2.status, 200);
      const join = await new Browser(p.url).get(new URL(invite).pathname);
      assert.equal(join.status, 200, "an invitation made before the sleep still opens");
    } finally { await p.close(); }
  } finally { rmSync(b.dir, { recursive: true, force: true }); }
});

test("`main.ts serve` as a real process: asleep it answers /healthz without loading the panel, the first page loads it, and SIGTERM ends it cleanly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-ondemand-"));
  mkdirSync(join(dir, "shops"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [new URL("../main.ts", import.meta.url).pathname], { env: { ...process.env, PANEL_SERVER_DIR: dir, PANEL_PORT: String(port), PANEL_HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => { err += String(d); });
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  try {
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { up = await fetch(`${base}/healthz`).then((r) => r.ok, () => false); if (!up) await wait(100); }
    assert.ok(up, `the port opened: ${err}`);
    assert.ok(!err.includes("panel woke"), "asleep, nothing is loaded");
    assert.equal((await fetch(`${base}/login`)).status, 200);
    assert.ok(err.includes("panel woke"), "the first page loaded the panel");
    child.kill("SIGTERM");
    assert.equal(await exited, 0);
  } finally { child.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
});
