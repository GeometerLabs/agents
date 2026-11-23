// The shop's file (group D, README.md): agent.db is the store every runtime writes (SQLite in WAL mode at the schema version, the tables a port must write, the record that cannot
// be changed or deleted); the record keeps what people wrote only as a keyed digest; the saved state is the TypeScript codec's, member for member (orders, handled, requests,
// optedOut, seq, asking, assistant, sendOnce), so a shop moves between runtimes and loses nothing; a restore moves every id counter on by 100000 once. From test/runtime.test.ts.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { MEENA, contract, orderAndApprove, shops } from "./harness.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });

describe("the store's file", () => {
  contract("agent.db is SQLite in WAL mode with the tables a port must write, at schema version 5, and the record cannot be changed or deleted", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"));
    try {
      assert.equal((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 5);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
      for (const t of ["record", "shop_key", "state_rows", "state_shape", "tasks", "window"]) assert.ok(tables.includes(t), t);
      assert.throws(() => db.prepare("UPDATE record SET outcome = 'x'").run(), /append-only/u);
      assert.throws(() => db.prepare("DELETE FROM record").run(), /append-only/u);
    } finally { db.close(); }
  });

  contract("the saved state is the codec's: format 1, then orders, handled, requests, optedOut, seq, and the optional members only once they are set", async () => {
    const s = await made.boot();
    await s.ownerSays("order hair oil from meena");
    await s.inbound(MEENA, "STOP");
    const saved = s.saved();
    assert.deepEqual(Object.keys(saved).slice(0, 6), ["format", "orders", "handled", "requests", "optedOut", "seq"]);
    assert.equal(saved.format, 1);
    assert.equal(saved.asking.kind, "qty");
    assert.deepEqual(saved.optedOut, ["919876500002"], "a number kept as digits only");
    assert.equal(saved.sendOnce, undefined, "left out until the first order is approved");
    await s.ownerSays("6");
    await s.ownerSays(`yes ${s.code()}`);
    const after1 = s.saved();
    assert.equal(after1.asking, undefined);
    assert.ok(after1.sendOnce, "kept once an order message was asked for");
    const o = after1.orders["po-1"];
    for (const k of ["id", "requestId", "lowStock", "supplier", "line", "item", "unit", "qty", "unitPaise", "totalPaise", "state", "createdMs", "ack", "receipt", "receivedQty", "asks"]) assert.ok(k in o, `the order has ${k}`);
    assert.equal(o.line, "hair-oil~meena-beauty~bottle");
    assert.deepEqual(after1.requests, [[o.requestId, "po-1"]], "one request, one order: kept as the Map's entries");
  });

  contract("what people wrote is in the record only as a keyed digest; a message id only as a fingerprint", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders please, Asha here");
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT entry FROM record").all() as { entry: string }[];
      assert.ok(rows.length > 2);
      for (const r of rows) {
        assert.ok(!r.entry.includes("Asha here") && !r.entry.includes("please"), "none of the owner's words");
        assert.match(String((JSON.parse(r.entry) as { inputsDigest?: string }).inputsDigest), /^k-[0-9a-f]{16}$/u);
      }
      assert.ok(!rows.map((r) => r.entry).join("").includes("wamid"), "a WhatsApp message id is kept as a fingerprint only");
    } finally { db.close(); }
  });

  contract("a restore moves every id counter on by 100000 once: the next order after po-1 is po-100002, and the note is put away", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    await s.stop();
    writeFileSync(join(s.dataDir, "restored.json"), JSON.stringify({ snapshot: "20261119T013000Z", restoredAt: new Date().toISOString(), lastSeq: null }));
    await s.start();
    await s.ownerSays("order 12 shampoo from meena");
    assert.ok(s.order("po-100002"), JSON.stringify(Object.keys(s.saved().orders)));
    assert.ok(s.record().some((l) => l.action === "restored"));
    assert.ok(!existsSync(join(s.dataDir, "restored.json")));
    assert.ok(readdirSync(s.dataDir).some((f) => f.startsWith("restored.json.done-")));
  });
});
