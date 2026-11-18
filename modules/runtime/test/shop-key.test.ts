// The shop's own signing key (modules/runtime/shop-key.ts, store.ts table `shop_key`): made once, kept in the shop's own database, never in a log, carried by the nightly copy of that
// database (VACUUM INTO, which is what the backup takes), so a shop that is restored or moved to another Operator keeps the same key id, and a shop restored from the owner's file
// adopts the key that file carries. Written, not run, in the 18 Nov build stream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generateSigningKey, privateText } from "../../signing/index.ts";
import { SHOP_KEY_FILE, loadShopKey, readShopKeyFile, shopKeyFileText } from "../shop-key.ts";
import { openStore } from "../store.ts";

const dirs: string[] = [];
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), "shop-key-")); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("the key is made once, kept in the shop's own database, and the same after a restart", () => {
  const dir = temp();
  const lines: string[] = [];
  const a = openStore(dir);
  const first = loadShopKey(a, { dataDir: dir, nowMs: 1, log: (l) => lines.push(l) })!;
  assert.match(first.keyId, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(loadShopKey(a, { dataDir: dir, nowMs: 2 })!.keyId, first.keyId, "asked again, the same key");
  a.close();
  const b = openStore(dir);
  assert.equal(loadShopKey(b, { dataDir: dir, nowMs: 3 })!.keyId, first.keyId, "after a restart, the same key");
  // one row, and the log says only the public id
  const db = new DatabaseSync(join(dir, "agent.db"), { readOnly: true });
  assert.equal((db.prepare("SELECT count(*) AS n FROM shop_key").get() as { n: number }).n, 1);
  const secret = (db.prepare("SELECT private_key FROM shop_key").get() as { private_key: string }).private_key;
  db.close();
  b.close();
  assert.ok(lines.length > 0 && lines.every((l) => !l.includes(secret)), "the private key is never logged");
  assert.ok(lines.some((l) => l.includes(first.keyId)));
});

test("the key is in the nightly copy of the database: a shop restored from it, or moved to another Operator, keeps its key id", () => {
  const dir = temp();
  const live = openStore(dir);
  const keyId = loadShopKey(live, { dataDir: dir, nowMs: 1 })!.keyId;
  live.close();
  // what the backup does: VACUUM INTO a copy on a read-only connection
  const copyDir = temp();
  const copy = join(copyDir, "agent.db");
  const src = new DatabaseSync(join(dir, "agent.db"), { readOnly: true });
  src.exec(`VACUUM INTO '${copy.replace(/'/gu, "''")}'`);
  src.close();
  // the "new server": the copy is the shop's database, and nothing else came along
  const moved = openStore(copyDir);
  assert.equal(loadShopKey(moved, { dataDir: copyDir, nowMs: 9 })!.keyId, keyId, "the restored shop has the same key id, so a directory that pinned it still knows it");
  moved.close();
});

test("a shop restored from the owner's file adopts its key once, and a file beside a database that already has a key is ignored", () => {
  const original = generateSigningKey();
  const text = shopKeyFileText(privateText(original));
  assert.equal(readShopKeyFile(text)?.key.keyId, original.keyId);
  assert.equal(readShopKeyFile(text.replace(original.keyId, "x".repeat(43))), undefined, "a key id that does not match the key is refused");
  assert.equal(readShopKeyFile('{"format":"shop-key/1","privateKey":"nope","keyId":"x"}'), undefined);
  assert.equal(readShopKeyFile("not json"), undefined);

  const fresh = temp();
  writeFileSync(join(fresh, SHOP_KEY_FILE), text, { mode: 0o600 });
  const s = openStore(fresh);
  assert.equal(loadShopKey(s, { dataDir: fresh, nowMs: 1 })!.keyId, original.keyId, "the new server's shop has the key the owner's file carried");
  assert.ok(!existsSync(join(fresh, SHOP_KEY_FILE)), "the file is used once and not left beside the database");
  assert.ok(existsSync(join(fresh, `${SHOP_KEY_FILE}.adopted`)));
  s.close();

  const has = temp();
  const t = openStore(has);
  const own = loadShopKey(t, { dataDir: has, nowMs: 1 })!.keyId;
  writeFileSync(join(has, SHOP_KEY_FILE), text);
  assert.equal(loadShopKey(t, { dataDir: has, nowMs: 2 })!.keyId, own, "a key the shop already has is never replaced by a file");
  t.close();

  const bad = temp();
  writeFileSync(join(bad, SHOP_KEY_FILE), "garbage");
  const u = openStore(bad);
  const lines: string[] = [];
  assert.ok(loadShopKey(u, { dataDir: bad, nowMs: 1, log: (l) => lines.push(l) }), "a bad file is ignored and the shop makes its own key");
  assert.ok(lines.some((l) => l.includes("not a good key file")));
  u.close();
});

test("a store with no key table (a test double) gives no key, and the private key is not in the state or the record tables", () => {
  assert.equal(loadShopKey({} as never, { nowMs: 1 }), undefined);
  const dir = temp();
  const s = openStore(dir);
  const key = loadShopKey(s, { dataDir: dir, nowMs: 1 })!;
  s.commitStep({ snapshot: JSON.stringify({ format: 1 }), entries: [], nowMs: 2 });
  s.close();
  const secret = privateText(key);
  const db = new DatabaseSync(join(dir, "agent.db"), { readOnly: true });
  for (const table of ["state_shape", "state_rows", "record", "tasks"]) {
    const rows = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
    assert.ok(!rows.includes(secret), `${table} does not hold the key`);
  }
  db.close();
});
