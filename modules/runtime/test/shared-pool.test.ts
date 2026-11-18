// The shared process with its pool of worker threads (shared-pool.ts), with stand-in shops loaded INSIDE the workers (pool-fake-shop.ts): a shop that loops forever or eats memory takes
// only its own worker's shops out, briefly; it is found through the worker's slot, struck, moved to a worker of its own after two strikes and paused after three more failures there; a shop
// let go closes its store before it is no longer named; and a normal request is routed exactly as before. Every interval is injected so a test takes seconds, not minutes.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderSource, startShared } from "../shared.ts";
import type { SharedProcess } from "../shared.ts";
import type { PoolOptions } from "../shared-pool.ts";

const dirs: string[] = [];
const procs: SharedProcess[] = [];
after(async () => { for (const p of procs) await p.stop(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const FAKE = new URL("./pool-fake-shop.ts", import.meta.url).href;
/** Fast numbers: a ping every 40 ms, a worker silent for 400 ms is blocked, a start again after 20 ms. A worker is given 48 MB so a leak ends in well under a second. */
const FAST: Omit<PoolOptions, "startModule"> = { workers: 2, workerMb: 48, quarantineMb: 48, pingMs: 40, deadAfterMs: 400, restartDelayMs: 20, proxyTimeoutMs: 1500, stopWaitMs: 2000 };

function folder(root: string, name: string, mode = "ok", extra: object = {}): void {
  const client = join(root, "clients", name, "client");
  mkdirSync(client, { recursive: true });
  mkdirSync(join(root, "secrets", name), { recursive: true });
  for (const f of ["internal_token", "channel_token", "record_key"]) writeFileSync(join(root, "secrets", name, f), `${f}-${name}`);
  writeFileSync(join(client, "settings.json"), JSON.stringify({ mode, ...extra }));
  writeFileSync(join(client, "runtime.json"), "{}");
  writeFileSync(join(client, "pathway.lock"), "listings@0.1.0\n");
}

async function boot(shops: Record<string, string>, pool: Partial<PoolOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), "shared-pool-"));
  dirs.push(root);
  for (const [n, mode] of Object.entries(shops)) folder(root, n, mode);
  const log: string[] = [];
  const p = await startShared({
    source: folderSource({ clientsDir: join(root, "clients"), secretsDir: join(root, "secrets") }), port: 0, scanSeconds: 3600, log: (l) => log.push(l),
    pool: { startModule: FAKE, ...FAST, ...pool },
    backSoon: () => ({ html: "<p>back soon</p>", json: { error: { code: "unavailable", message: "back soon" } } }),
  });
  procs.push(p);
  return { root, p, log };
}

/** One request to a shop; never waits longer than 3 s (a hang is a failure of the test, not a wait for it). */
async function call(p: SharedProcess, shop: string, path = "/x", headers: Record<string, string> = {}): Promise<{ status: number; retryAfter: string | null; body: any }> {
  try {
    const r = await fetch(`${p.url}/shop/${shop}${path}`, { headers, signal: AbortSignal.timeout(3000) });
    const text = await r.text();
    return { status: r.status, retryAfter: r.headers.get("retry-after"), body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
  } catch { return { status: 0, retryAfter: null, body: null }; }
}
async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ok()) return; await new Promise((r) => setTimeout(r, 25)); }
  assert.fail(`gave up waiting for: ${what}`);
}
const lostCount = (log: string[], shop: string): number => log.filter((l) => l.includes(`lost; blamed: ${shop}`)).length;
/** Make a shop lose its worker once: wait until it answers, send the request that never returns, wait until the loss is logged. */
async function crashOnce(t: { p: SharedProcess; log: string[] }, shop: string, path = "/spin"): Promise<void> {
  const before = lostCount(t.log, shop);
  await until(`${shop} answers`, async () => (await call(t.p, shop)).status === 200);
  void call(t.p, shop, path);
  await until(`${shop} is blamed`, () => lostCount(t.log, shop) > before);
}

test("K workers share the shops out evenly, and a normal request goes through unchanged: path, query and the shop's own credential", async () => {
  const { p } = await boot({ a: "ok", b: "ok", c: "ok", d: "ok" });
  const pool = p.pool();
  assert.deepEqual(pool.workers.map((w) => w.shops.length), [2, 2], "four shops over two workers, two each");
  assert.ok(pool.workers.every((w) => w.running && !w.quarantine));
  const r = await call(p, "c", "/anything?x=1", { authorization: "Bearer t" });
  assert.deepEqual(r.body, { shop: "c", path: "/anything?x=1", auth: "Bearer t" });
  assert.equal((await call(p, "nobody")).status, 404);
  assert.deepEqual((await (await fetch(`${p.url}/shared/shops`)).json()), { shops: ["a", "b", "c", "d"], paused: [] });
});

test("a shop that loops forever: only its worker's shops are out, briefly, with a quick 503; the others answer throughout; the slot names the culprit, and two strikes put it on a worker of its own", async () => {
  const t = await boot({ a: "spin", b: "ok", c: "ok", d: "ok" }); // a and c share worker w0; b and d share w1
  assert.deepEqual(t.p.pool().workers[0].shops, ["a", "c"]);
  const seen = { b: new Set<number>(), c: new Set<number>(), slow: 0, noRetryAfter: 0 };
  let watching = true;
  const watch = async () => {
    while (watching) {
      for (const shop of ["b", "c"] as const) {
        const started = Date.now(); const r = await call(t.p, shop);
        seen[shop].add(r.status);
        if (Date.now() - started > 1500) seen.slow++;
        if (r.status === 503 && !r.retryAfter) seen.noRetryAfter++;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const watcher = watch();
  await crashOnce(t, "a");
  await until("c is back", async () => (await call(t.p, "c")).status === 200);
  watching = false; await watcher;
  assert.deepEqual([...seen.b], [200], "a shop on another worker answered every time it was asked");
  assert.ok([...seen.c].every((s) => s === 200 || s === 503), `the shop beside it got only 200 or a quick 503, got ${[...seen.c]}`);
  assert.equal(seen.slow, 0, "nothing hung");
  assert.equal(seen.noRetryAfter, 0, "every 503 said when to come back");
  assert.equal(lostCount(t.log, "a"), 1, "the slot named a, not c");
  assert.deepEqual(t.p.pool().quarantined, [], "one strike is not quarantine");
  // the second strike within the window: a goes to a worker of its own, c stays where it was
  await crashOnce(t, "a");
  await until("a is quarantined and up", async () => t.p.pool().quarantined.includes("a") && t.p.pool().workers.some((w) => w.quarantine && w.running) && (await call(t.p, "a")).status === 200);
  const pool = t.p.pool();
  assert.deepEqual(pool.workers.find((w) => w.quarantine)!.shops, ["a"]);
  assert.ok(!pool.workers.find((w) => w.id === "w0")!.shops.includes("a"));
  assert.ok(pool.workers.find((w) => w.id === "w0")!.shops.includes("c"));
  assert.equal((await call(t.p, "c")).status, 200);
  assert.equal(lostCount(t.log, "c"), 0, "c was never blamed");
});

test("a shop that allocates without limit: its worker runs out of memory and restarts, the shop is named, and the other workers answer", async () => {
  const t = await boot({ hog: "leak", b: "ok", c: "ok" }); // hog on w0 with c; b on w1
  await crashOnce(t, "hog", "/leak");
  assert.ok(t.log.some((l) => l.includes("memory limit")), "it was V8's limit that ended the worker");
  assert.equal(lostCount(t.log, "hog"), 1);
  assert.equal((await call(t.p, "b")).status, 200, "the other worker was never touched");
  await until("hog's worker is back with its shops", async () => (await call(t.p, "c")).status === 200 && (await call(t.p, "hog")).status === 200);
  assert.equal((await fetch(`${t.p.url}/healthz`)).status, 200, "the process itself never stopped");
});

test("three more failures on its own worker pause the shop: 'back soon', named by the process, tried again after the pause (one failure then pauses it again), or at once when its files change", async () => {
  const t = await boot({ a: "spin", b: "ok" }, { pauseMs: 1500 });
  await crashOnce(t, "a"); await crashOnce(t, "a"); // two strikes: quarantine
  await until("a is quarantined", () => t.p.pool().quarantined.includes("a"));
  await crashOnce(t, "a"); await crashOnce(t, "a"); await crashOnce(t, "a"); // three failures on its own worker
  await until("a is paused", () => t.p.pool().paused.includes("a"));
  const page = await fetch(`${t.p.url}/shop/a/anything`, { headers: { accept: "text/html" } });
  assert.equal(page.status, 503);
  assert.ok(Number(page.headers.get("retry-after")) > 0);
  assert.match(await page.text(), /back soon/u);
  assert.ok(t.log.some((l) => l.startsWith("a: PAUSED") && l.includes("Operator")), "the process says it, for the Operator");
  const ready = await (await fetch(`${t.p.url}/readyz`)).json() as { ok: boolean; paused: string[] };
  assert.deepEqual([ready.ok, ready.paused], [true, ["a"]], "still ready as a process; the paused shop is named");
  assert.deepEqual((await (await fetch(`${t.p.url}/shared/shops`)).json() as { paused: string[] }).paused, ["a"]);
  assert.equal((await call(t.p, "b")).status, 200, "the other shop answered all along");
  assert.ok(!t.p.pool().workers.some((w) => w.quarantine), "its worker is gone: a paused shop holds no memory");
  // the pause ends by itself; on probation, ONE failure pauses it again
  await until("a is tried again", async () => !t.p.pool().paused.includes("a") && (await call(t.p, "a")).status === 200);
  await crashOnce(t, "a");
  await until("a is paused again at once", () => t.p.pool().paused.includes("a"));
  // or the files change (someone fixed it): the next look starts it at once, with a clean sheet
  writeFileSync(join(t.root, "clients", "a", "client", "settings.json"), JSON.stringify({ mode: "ok" }));
  await t.p.scan();
  assert.deepEqual(t.p.pool().paused, []);
  assert.deepEqual(t.p.pool().quarantined, []);
  assert.equal((await call(t.p, "a")).status, 200);
});

test("a shop let go closes its store BEFORE /shared/shops stops naming it, even though it lives in a worker", async () => {
  const t = await boot({ slow: "ok", other: "ok" });
  writeFileSync(join(t.root, "clients", "slow", "client", "settings.json"), JSON.stringify({ mode: "ok", stopMs: 300 })); // changed files: restarted, and its next stop is slow
  await t.p.scan();
  const closed = join(t.root, "clients", "slow", "closed");
  rmSync(closed, { force: true }); // the restart above closed the first copy; only the next close counts
  rmSync(join(t.root, "clients", "slow", "client", "pathway.lock"));
  const letting = t.p.scan();
  let namedWhileOpen = false; let unnamedAfterClose = false;
  await until("it is no longer named", async () => {
    const shops = ((await (await fetch(`${t.p.url}/shared/shops`)).json()) as { shops: string[] }).shops;
    if (shops.includes("slow")) { if (!existsSync(closed)) namedWhileOpen = true; return false; }
    unnamedAfterClose = existsSync(closed);
    return true;
  });
  await letting;
  assert.ok(namedWhileOpen, "named while its store was still open");
  assert.ok(unnamedAfterClose, "not named until the store was closed");
  assert.equal((await call(t.p, "slow")).status, 404);
  assert.equal((await call(t.p, "other")).status, 200);
});
