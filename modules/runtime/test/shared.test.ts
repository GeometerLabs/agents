// The shared process (modules/runtime/shared.ts), with stand-in shops: a shop is found from its folder and started alone; a new shop is picked up without touching the others and
// without a restart; a changed shop restarts by itself; a removed shop is let go (stopped, and "nothing here" after); one that fails to start never stops the rest; a request goes
// to the shop its path names and to no other; the process stays healthy whatever its shops do. The real shops on it are tested in templates/commerce/listings/test.
import { createServer } from "node:http";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderSource, startShared } from "../shared.ts";
import type { HeldShop, ShopPaths, SharedProcess } from "../shared.ts";

const dirs: string[] = [];
const procs: SharedProcess[] = [];
after(async () => { for (const p of procs) await p.stop(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A shop's whole folder, as the deployer writes it (the lock last). */
function folder(root: string, name: string, text = "a"): void {
  const client = join(root, "clients", name, "client");
  mkdirSync(client, { recursive: true });
  mkdirSync(join(root, "secrets", name), { recursive: true });
  for (const f of ["internal_token", "channel_token", "record_key"]) writeFileSync(join(root, "secrets", name, f), `${f}-${name}`);
  writeFileSync(join(client, "settings.json"), JSON.stringify({ name, text }));
  writeFileSync(join(client, "runtime.json"), "{}");
  writeFileSync(join(client, "pathway.lock"), "listings@0.1.0\n");
}

/** A stand-in shop: its own little server that answers with its own name, and remembers it was stopped. */
function standIn(log: string[], failFor: ReadonlySet<string> = new Set()) {
  const open = new Map<string, { server: ReturnType<typeof createServer>; stopped: boolean }>();
  const starts: string[] = [];
  const start = async (p: ShopPaths): Promise<HeldShop> => {
    if (failFor.has(p.name)) throw new Error(`${p.name}: these settings need fixing\n- something`);
    starts.push(p.name);
    const server = createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ shop: p.name, path: req.url, auth: req.headers.authorization ?? null })); });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const entry = { server, stopped: false };
    open.set(p.name, entry);
    log.push(`start ${p.name}`);
    return { server: { port: (server.address() as { port: number }).port }, stop: async () => { entry.stopped = true; log.push(`stop ${p.name}`); await new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }); } };
  };
  return { start, open, starts };
}

async function get(p: SharedProcess, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const r = await fetch(`${p.url}${path}`, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function boot(names: string[], o: { fail?: string[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "shared-"));
  dirs.push(root);
  for (const n of names) folder(root, n);
  const log: string[] = [];
  const fake = standIn(log, new Set(o.fail ?? []));
  const source = folderSource({ clientsDir: join(root, "clients"), secretsDir: join(root, "secrets") });
  const p = await startShared({ source, start: fake.start, port: 0, scanSeconds: 3600, log: (l) => log.push(l) });
  procs.push(p);
  return { root, log, fake, p };
}

test("every complete shop folder is started, each on a port of its own, and a request goes to the shop its path names", async () => {
  const { p, fake } = await boot(["glow-pets", "sree-cycles"]);
  assert.deepEqual(p.held(), ["glow-pets", "sree-cycles"]);
  assert.deepEqual((await get(p, "/shop/glow-pets/anything?x=1")).body, { shop: "glow-pets", path: "/anything?x=1", auth: null });
  assert.equal((await get(p, "/shop/sree-cycles/status", { authorization: "Bearer t" })).body.auth, "Bearer t", "the shop's own credential passes on untouched: the check is the shop's");
  assert.deepEqual((await get(p, "/shared/shops")).body, { shops: ["glow-pets", "sree-cycles"] });
  assert.notEqual(fake.open.get("glow-pets")!.server.address(), fake.open.get("sree-cycles")!.server.address());
  assert.equal((await get(p, "/shop/nobody/status")).status, 404, "a shop that is not held has nothing here");
  assert.equal((await get(p, "/glow-pets/status")).status, 404, "only /shop/<name>/... is routed");
});

test("a new shop is picked up by looking at the folder: no other shop is restarted and nothing is told to restart", async () => {
  const { root, p, fake, log } = await boot(["glow-pets"]);
  folder(root, "new-shop");
  const r = await p.scan();
  assert.deepEqual(r.started, ["new-shop"]);
  assert.deepEqual(r.restarted, []);
  assert.deepEqual(fake.starts, ["glow-pets", "new-shop"], "glow-pets was started once and never again");
  assert.ok(!log.some((l) => l === "stop glow-pets"));
  assert.equal((await get(p, "/shop/new-shop/x")).body.shop, "new-shop");
});

test("a folder that is not whole is not started; the lock is written last, so a shop half written never runs", async () => {
  const { root, p } = await boot([]);
  mkdirSync(join(root, "clients", "half", "client"), { recursive: true });
  writeFileSync(join(root, "clients", "half", "client", "settings.json"), "{}");
  assert.deepEqual((await p.scan()).started, []);
  folder(root, "half");
  assert.deepEqual((await p.scan()).started, ["half"]);
});

test("a shop whose files changed restarts alone; the one beside it keeps its port", async () => {
  const { root, p, fake } = await boot(["a-shop", "b-shop"]);
  const portB = (fake.open.get("b-shop")!.server.address() as { port: number }).port;
  writeFileSync(join(root, "clients", "a-shop", "client", "settings.json"), JSON.stringify({ name: "a-shop", text: "changed" }));
  const r = await p.scan();
  assert.deepEqual(r.restarted, ["a-shop"]);
  assert.deepEqual(r.started, []);
  assert.equal(fake.open.get("a-shop")!.stopped, false, "the new one is running");
  assert.equal((fake.open.get("b-shop")!.server.address() as { port: number }).port, portB);
  assert.equal(fake.starts.filter((n) => n === "b-shop").length, 1);
});

test("a shop whose folder goes (a removed shop, or one that moved into a runtime of its own) is let go: stopped, and answered as nothing here; the others go on", async () => {
  const { root, p, fake } = await boot(["a-shop", "b-shop"]);
  rmSync(join(root, "clients", "b-shop", "client", "pathway.lock")); // the deployer takes the lock first
  const r = await p.scan();
  assert.deepEqual(r.letGo, ["b-shop"]);
  assert.equal(fake.open.get("b-shop")!.stopped, true, "its step finished and its store was closed");
  assert.equal((await get(p, "/shop/b-shop/healthz")).status, 404);
  assert.deepEqual((await get(p, "/shared/shops")).body, { shops: ["a-shop"] }, "the deployer reads this to know the file is not open any more");
  assert.equal((await get(p, "/shop/a-shop/healthz")).status, 200);
});

test("a shop that is stopping is still NAMED until its store is closed: a deployer must not copy a file that is open", async () => {
  const root = mkdtempSync(join(tmpdir(), "shared-"));
  dirs.push(root);
  folder(root, "slow");
  let release!: () => void;
  const gate = new Promise<void>((ok) => { release = ok; });
  let closed = false;
  const p = await startShared({
    source: folderSource({ clientsDir: join(root, "clients"), secretsDir: join(root, "secrets") }), port: 0, scanSeconds: 3600,
    start: async () => ({ server: { port: 9 }, stop: async () => { await gate; closed = true; } }),
  });
  procs.push(p);
  rmSync(join(root, "clients", "slow", "client", "pathway.lock"));
  const letting = p.scan();
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(closed, false);
  assert.deepEqual((await get(p, "/shared/shops")).body, { shops: ["slow"] }, "still named while its step finishes and its store closes");
  assert.equal((await get(p, "/shop/slow/status")).status, 404, "but no longer served");
  release();
  await letting;
  assert.equal(closed, true);
  assert.deepEqual((await get(p, "/shared/shops")).body, { shops: [] }, "named no more once it is closed");
});

test("a shop that fails to start is logged and skipped, said once, tried again only after a back-off or when its files change; the process stays healthy", async () => {
  const { root, p, log } = await boot(["good", "bad"], { fail: ["bad"] });
  assert.deepEqual(p.held(), ["good"]);
  assert.ok(log.some((l) => l.startsWith("bad: it did not start") && l.includes("the other shops go on")));
  const again = await p.scan();
  assert.deepEqual(again.failed, [{ shop: "bad", why: "waiting to be tried again" }], "not tried again at once: a back-off");
  assert.equal(log.filter((l) => l.startsWith("bad: it did not start")).length, 1, "said once");
  assert.equal((await get(p, "/healthz")).status, 200);
  assert.equal((await get(p, "/readyz")).body.ok, true);
  writeFileSync(join(root, "clients", "bad", "client", "settings.json"), "{\"fixed\":true}");
  assert.deepEqual((await p.scan()).failed.map((f) => f.shop), ["bad"], "tried again after its files changed (and failed again here, as the stand-in is told to)");
});

test("one shop's files never reach another: the folder source names each shop's own token files", () => {
  const source = folderSource({ clientsDir: "/shops", secretsDir: "/run/secrets" });
  assert.deepEqual(source.paths("a-shop"), { name: "a-shop", clientFolder: "/shops/a-shop/client", tokenFile: "/run/secrets/a-shop/internal_token", channelTokenFile: "/run/secrets/a-shop/channel_token", recordKeyFile: "/run/secrets/a-shop/record_key" });
  assert.ok(!JSON.stringify(source.paths("a-shop")).includes("b-shop"));
});

test("a folder whose name is not a shop name (capitals, a dot, an underscore) is never started", async () => {
  const { root, p } = await boot([]);
  mkdirSync(join(root, "clients", "Not_A_Shop", "client"), { recursive: true });
  mkdirSync(join(root, "clients", ".moved-x", "client"), { recursive: true });
  assert.deepEqual((await p.scan()).started, []);
});

test("a shop whose store throws on every step leaves the other shop answering; it is restarted ALONE, after a back-off that doubles, and the process lives", async () => {
  const root = mkdtempSync(join(tmpdir(), "shared-"));
  dirs.push(root);
  folder(root, "good"); folder(root, "broken");
  const log: string[] = [];
  const fake = standIn(log);
  let clock = 1_000_000;
  const p = await startShared({
    source: folderSource({ clientsDir: join(root, "clients"), secretsDir: join(root, "secrets") }), port: 0, scanSeconds: 3600, backoffMs: 1000, now: () => clock, log: (l) => log.push(l),
    start: fake.start,
    // the broken shop's /readyz says what a runtime says when `db.ping()` throws: the store cannot be read. The good shop's answers.
    probe: async (port) => port !== (fake.open.get("broken")?.server.address() as { port: number } | undefined)?.port,
  });
  procs.push(p);
  assert.deepEqual(fake.starts, ["good", "broken"]);
  await p.scan(); await p.scan();
  assert.deepEqual(fake.starts, ["good", "broken"], "two bad looks are not yet a restart");
  const r = await p.scan();
  assert.deepEqual(r.letGo, ["broken"], "the third bad look stops that shop alone");
  assert.equal((await get(p, "/shop/good/x")).body.shop, "good", "the other shop answers throughout");
  assert.equal((await get(p, "/healthz")).status, 200);
  assert.deepEqual((await p.scan()).failed, [{ shop: "broken", why: "waiting to be tried again" }], "not started again at once");
  clock += 1001;
  assert.deepEqual((await p.scan()).started, ["broken"], "started again after the pause, alone");
  assert.equal(fake.starts.filter((n) => n === "good").length, 1, "the good shop was never restarted");
  // broken again three looks later: the pause is twice as long
  await p.scan(); await p.scan(); await p.scan();
  clock += 1500;
  assert.deepEqual((await p.scan()).failed, [{ shop: "broken", why: "waiting to be tried again" }], "the second pause is 2 s, not 1 s");
  clock += 600;
  assert.deepEqual((await p.scan()).started, ["broken"]);
  assert.equal(fake.starts.filter((n) => n === "good").length, 1);
});
