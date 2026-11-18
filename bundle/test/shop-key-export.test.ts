// The shop's own signing key in "Get my shop's file" (block S phase B2): the export job writes it from the shop's database for the OWNER'S package only, mode 0600; the Operator's package never
// carries it; the owner's package passes the builder's own look for secrets; and a new server that puts the file in the shop's data folder gets the same key id back. Written, not run, in the 18 Nov build stream.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeShopKey } from "../backup/export.ts";
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

test("the export job writes the shop's key from its database, 0600, and writes nothing for a shop with no key (removing an old file)", () => {
  const dataDir = temp();
  const out = temp();
  const store = openStore(dataDir);
  assert.equal(writeShopKey(join(dataDir, "agent.db"), out), false, "no key made yet: nothing written");
  const key = loadShopKey(store, { dataDir, nowMs: 1 })!;
  store.close();
  assert.equal(writeShopKey(join(dataDir, "agent.db"), out), true);
  const file = join(out, SHOP_KEY_FILE);
  assert.equal(statSync(file).mode & 0o777, 0o600, "not readable by others");
  assert.equal(readShopKeyFile(readFileSync(file, "utf8"))?.key.keyId, key.keyId);
  assert.equal(writeShopKey(join(dataDir, "no-such.db"), out), false, "a database that cannot be read writes nothing");
  assert.ok(!existsSync(file), "and a stale key file is not left behind");
});

test("the OWNER's file carries the key and the builder's own look for secrets lets it through; the Operator's package never carries it", () => {
  const dataDir = temp();
  const store = openStore(dataDir);
  const key = loadShopKey(store, { dataDir, nowMs: 1 })!;
  store.close();
  const out = temp();
  writeShopKey(join(dataDir, "agent.db"), out);
  const text = readFileSync(join(out, SHOP_KEY_FILE), "utf8");

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
  const out = temp();
  writeShopKey(join(oldDir, "agent.db"), out);
  const owner = buildExport(sources(readFileSync(join(out, SHOP_KEY_FILE), "utf8")), { shop: "paws", now: NOW, profile: "owner", exportedBy: { name: "test", role: "server" } });
  // the new server: a fresh data folder, with the file the owner's package carried
  const newDir = temp();
  writeFileSync(join(newDir, SHOP_KEY_FILE), owner.files.get("shop-key/shop-key.json")!);
  const moved = openStore(newDir);
  assert.equal(loadShopKey(moved, { dataDir: newDir, nowMs: 5 })!.keyId, original.keyId, "the shop keeps its key, so a directory that pinned it still knows it");
  moved.close();
});
