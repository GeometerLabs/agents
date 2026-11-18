// The shop's own signing key in "Get my shop's file" (block S phase B2): the export job reads it from the shop's database and hands it to the deployer, which writes exports/<shop>/shop-key.json as its own user at 0600 (the root job cannot chown, so a file written by the job would be unreadable to the panel), for the OWNER'S package only; the Operator's package never
// carries it; the owner's package passes the builder's own look for secrets; and a new server that puts the file in the shop's data folder gets the same key id back. Written, not run, in the 18 Nov build stream.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shopKeyFileOf } from "../backup/export.ts";
import { placeShopKeyFile, runExports } from "../backup/jobs.ts";
import { deploy } from "../deploy.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { serverPaths } from "../lib/server.ts";
import { panelRuntime } from "./helpers.ts";
import { world } from "./world.ts";
import { buildExport } from "../export/build.ts";
import type { ExportSources } from "../export/build.ts";
import { SHOP_KEY_FILE, loadShopKey, readShopKeyFile } from "../../modules/runtime/shop-key.ts";
import { openStore } from "../../modules/runtime/store.ts";

const dirs: string[] = [];
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), "shop-key-export-")); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const sources = (keyText: string | undefined): ExportSources => ({
  shopFile: (n) => (n === "settings.json" ? JSON.stringify({ name: "Paws" }) : undefined),
  exportFile: (n) => (n === "listings.json" ? JSON.stringify({ seq: 1, items: [], shop: { visible: true } }) : n === "shop-key.json" ? keyText : undefined),
  exportedAt: () => undefined, statusText: () => undefined, papers: () => [], pins: () => undefined, meta: () => undefined,
});
const NOW = Date.UTC(2026, 10, 18);

test("the export job reads the shop's key from its database and hands it back; a shop with no key, or a database it cannot read, gives nothing", () => {
  const dataDir = temp();
  const store = openStore(dataDir);
  assert.equal(shopKeyFileOf(join(dataDir, "agent.db")), undefined, "no key made yet: nothing");
  const key = loadShopKey(store, { dataDir, nowMs: 1 })!;
  store.close();
  const text = shopKeyFileOf(join(dataDir, "agent.db"));
  assert.equal(readShopKeyFile(text!)?.key.keyId, key.keyId);
  assert.equal(shopKeyFileOf(join(dataDir, "no-such.db")), undefined, "a database that cannot be read gives nothing");
});

test("the deployer writes the key file itself: 0600, owned by its own user (so the builder, which runs as that user, reads it), and a gone key removes the old file", () => {
  const dir = temp();
  const text = shopKeyFileOf((() => { const d = temp(); const s = openStore(d); loadShopKey(s, { dataDir: d, nowMs: 1 }); s.close(); return join(d, "agent.db"); })())!;
  const server = join(dir, "server");
  const folder = serverPaths(server).exportsOf("paws");
  mkdirSync(folder, { recursive: true });
  placeShopKeyFile(server, "paws", text);
  const file = join(folder, SHOP_KEY_FILE);
  const st = statSync(file);
  assert.equal(st.mode & 0o777, 0o600, "private: no group, no others");
  assert.equal(st.uid, process.getuid!(), "the deployer's own user wrote it, and the panel's container runs as that user (or as 1000 when the deployer is root and the file is handed to it)");
  accessSync(file, constants.R_OK); // the builder's user reads it
  assert.equal(readFileSync(file, "utf8"), text);
  placeShopKeyFile(server, "paws", undefined);
  assert.ok(!existsSync(file), "a key that is gone is not left behind");
});

test("runExports: the key travels in the job's output, the deployer writes exports/<shop>/shop-key.json 0600 and the owner's file made from the folder carries it", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const d = temp();
    const s = openStore(d); const made = loadShopKey(s, { dataDir: d, nowMs: 1 })!; s.close();
    const keyFile = shopKeyFileOf(join(d, "agent.db"))!;
    w.ctx.runner = fakeRunner(() => ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, entries: 1, bookings: 0, shopKeyFile: keyFile }] })));
    const r = await runExports(w.ctx);
    assert.equal(r.ok, true, r.lines.join("\n"));
    assert.ok(!r.lines.join("\n").includes(made.keyId) && !r.lines.join("\n").includes(JSON.parse(keyFile).privateKey), "the key is not in what the deployer says");
    const file = join(w.paths.exports, "glow-salon", SHOP_KEY_FILE);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    accessSync(file, constants.R_OK);
    // the owner's file built by the process that reads the folder (sourcesFor is what the panel and the deployer both use)
    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, profile: "owner", exportedBy: { name: "test", role: "server" } });
    assert.equal(built.files.get("shop-key/shop-key.json")?.toString("utf8"), keyFile);
  } finally { w.done(); }
});

test("the OWNER's file carries the key and the builder's own look for secrets lets it through; the Operator's package never carries it", () => {
  const dataDir = temp();
  const store = openStore(dataDir);
  const key = loadShopKey(store, { dataDir, nowMs: 1 })!;
  store.close();
  const text = shopKeyFileOf(join(dataDir, "agent.db"))!;

  const owner = buildExport(sources(text), { shop: "paws", now: NOW, profile: "owner", exportedBy: { name: "test", role: "server" } });
  const carried = owner.files.get("shop-key/shop-key.json")?.toString("utf8");
  assert.ok(carried, "the owner's file has the key");
  assert.equal(readShopKeyFile(carried)?.key.keyId, key.keyId);
  assert.ok(owner.manifest.files.some((f) => f.path === "shop-key/shop-key.json"), "listed in the manifest with its hash");
  assert.ok(owner.manifest.notes.some((n) => n.includes("signing key")), "and said in the notes");
  assert.match(owner.files.get("README.txt")!.toString("utf8"), /shop-key\/shop-key\.json is the shop's OWN signing key/u);

  const operator = buildExport(sources(text), { shop: "paws", now: NOW, exportedBy: { name: "test", role: "server" } });
  assert.ok(![...operator.files.keys()].some((k) => k.includes("shop-key")), "the Operator's package has no key");
  assert.ok(!operator.files.get("README.txt")!.toString("utf8").includes("shop-key/"));
  for (const f of operator.files.values()) assert.ok(!f.toString("utf8").includes(JSON.parse(text).privateKey));
  // an owner's file made before the server wrote the key says so, instead of silently leaving it out
  const without = buildExport(sources(undefined), { shop: "paws", now: NOW, profile: "owner", exportedBy: { name: "test", role: "server" } });
  assert.ok(!without.files.has("shop-key/shop-key.json"));
  assert.ok(without.manifest.notes.some((n) => n.includes("signing key is not in this file")));
});

test("moving to another Operator or a new server: the key from the owner's file, put in the new shop's data folder, is the same key id", () => {
  const oldDir = temp();
  const oldStore = openStore(oldDir);
  const original = loadShopKey(oldStore, { dataDir: oldDir, nowMs: 1 })!;
  oldStore.close();
  const owner = buildExport(sources(shopKeyFileOf(join(oldDir, "agent.db"))), { shop: "paws", now: NOW, profile: "owner", exportedBy: { name: "test", role: "server" } });
  // the new server: a fresh data folder, with the file the owner's package carried
  const newDir = temp();
  writeFileSync(join(newDir, SHOP_KEY_FILE), owner.files.get("shop-key/shop-key.json")!);
  const moved = openStore(newDir);
  assert.equal(loadShopKey(moved, { dataDir: newDir, nowMs: 5 })!.keyId, original.keyId, "the shop keeps its key, so a directory that pinned it still knows it");
  moved.close();
});
