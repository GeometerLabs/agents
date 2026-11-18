// A shop put back from a nightly snapshot: the bundle leaves restored.json beside the database; the first start writes ONE `restored` line to the record (refs snapshot, restoredAt, idGap),
// leaves the saved state as it was (a listings-only store has no counter to move on), and renames the note so it is not done twice, even after another restart.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } });

test("a restore note makes one record line, once, and is renamed", async () => {
  const s = await makeShop(); shops.push(s);
  const { mkdirSync } = await import("node:fs"); mkdirSync(s.dataDir, { recursive: true });
  writeFileSync(join(s.dataDir, "restored.json"), JSON.stringify({ snapshot: "2026-11-17", restoredAt: "2026-11-18T05:00:00Z", lastSeq: 7 }));
  await s.start(); await s.settle();
  const lines = () => { const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true }); const r = db.prepare("SELECT action, outcome, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; entry: string }[]; db.close(); return r.filter((x) => x.action === "restored"); };
  assert.equal(lines().length, 1);
  const refs = JSON.parse(lines()[0].entry).refs;
  assert.deepEqual({ snapshot: refs.snapshot, restoredAt: refs.restoredAt, idGap: refs.idGap }, { snapshot: "2026-11-17", restoredAt: "2026-11-18T05:00:00Z", idGap: "100000" });
  assert.equal(existsSync(join(s.dataDir, "restored.json")), false);
  assert.ok(readdirSync(s.dataDir).some((n) => n.startsWith("restored.json.done-")));
  await s.stop(); await s.start(); await s.settle();
  assert.equal(lines().length, 1, "not written twice");
});
