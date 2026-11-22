// The centre's store file and what leaves the centre. agent.db is the shared store (WAL, schema 5, the record append-only) a port must write; a newer schema is refused. A
// parent's number is in the record in ONE place (the conversation) and their words in none (a keyed digest); a parent's private link is kept as a hash and never written in the
// record. A student's name never leaves the centre as itself: not in /status, not in the monthly report's data, and not to a model (the shop's talk is given "your child");
// the owner's page names a parent by a ref. Expected values from test/runtime, channels, talk and the record tests of modules/record.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { startFakeModel } from "../../../../modules/test/contract/fake-model.ts";
import type { FakeModel } from "../../../../modules/test/contract/fake-model.ts";
import { KIRAN, MEERA, ROHAN, SHARMA, at, contract, lines, makeCentre, sleep } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
const closers: FakeModel[] = [];
after(async () => { for (const c of centres) await c.cleanup(); for (const m of closers) await m.close(); });
async function boot(o: CentreOptions = {}): Promise<Centre> { const c = await makeCentre(o); centres.push(c); await c.start(); return c; }
const STUDENTS = ["Aarav Sharma", "Anaya Sharma", "Meera Nair", "Kiran Gowda", "Rohan Mehta", "Aarav", "Rohan"];

describe("the store's file", () => {
  contract("agent.db is SQLite in WAL mode with the tables a port must write, at schema 5, and the record cannot be changed or deleted", async () => {
    const c = await boot({ tickSeconds: 3600 });
    await c.inbound(ROHAN, "hello");
    await c.stop();
    const db = new DatabaseSync(join(c.dataDir, "agent.db"));
    try {
      assert.equal((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 5);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      for (const t of ["record", "shop_key", "state_rows", "state_shape", "tasks", "window"]) assert.ok(tables.includes(t), `table ${t}`);
      const n = (db.prepare("SELECT COUNT(*) AS n FROM record").get() as { n: number }).n;
      assert.ok(n > 0);
      assert.throws(() => db.prepare("UPDATE record SET outcome = 'x'").run(), /the record is append-only/u);
      assert.throws(() => db.prepare("DELETE FROM record").run(), /the record is append-only/u);
    } finally { db.close(); }
  });

  contract("a store from a NEWER schema is refused in a sentence, and the centre does not start on it", async () => {
    const c = await boot({ tickSeconds: 3600 });
    await c.stop();
    const db = new DatabaseSync(join(c.dataDir, "agent.db"));
    db.exec("PRAGMA user_version = 9999");
    db.close();
    await assert.rejects(c.start(), /newer|version|9999/iu);
  });

  contract("the saved state is the TypeScript runtime's, member for member: the fees, the parents' link hashes, the counters and the day the agent first ran", async () => {
    const c = await boot();
    await sleep(1500);
    c.goto(at(2, 10) + 1000);
    await c.waitFor(() => lines(c, "open_fee").length === 5 && lines(c, "parent_link").length === 4, "the month opened");
    await c.stop();
    const db = new DatabaseSync(join(c.dataDir, "agent.db"), { readOnly: true });
    try {
      const shape = db.prepare("SELECT shape, lists FROM state_shape WHERE id = 1").get() as { shape: string; lists: string };
      const members = Object.keys(JSON.parse(shape.shape) as Record<string, unknown>);
      for (const m of ["format", "dues", "customers", "seenMessages", "seenEvents", "nextDue", "nextRequest", "startedAtMs", "upi", "parentLinks"]) assert.ok(members.includes(m), `${m} in the saved state (${members.join(",")})`);
    } finally { db.close(); }
  });
});

describe("what leaves the centre", () => {
  contract("a parent's number is in the record only as the conversation, their words never; /status has no name or number", async () => {
    const c = await boot();
    await sleep(1500);
    c.goto(at(2, 10) + 1000);
    await c.waitFor(() => lines(c, "open_fee").length === 5, "the month opened");
    await c.inbound(ROHAN, "my son Rohan was unwell, the secret word is pineapple");
    await c.stop();
    const db = new DatabaseSync(join(c.dataDir, "agent.db"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT conversation, entry FROM record").all() as { conversation: string; entry: string }[];
      assert.ok(rows.some((r) => r.conversation === ROHAN));
      for (const r of rows) {
        const entry = JSON.parse(r.entry) as Record<string, unknown>;
        const rest = JSON.stringify({ ...entry, conversation: undefined });
        for (const p of [ROHAN, MEERA, KIRAN, SHARMA]) assert.ok(!rest.includes(p.slice(1)), `no number outside the conversation: ${rest.slice(0, 160)}`);
        assert.ok(!rest.includes("pineapple"), "no parent's words");
        assert.match(String(entry.inputsDigest), /^k-[0-9a-f]{16}$/u, "what was said is a keyed digest");
      }
    } finally { db.close(); }
    await c.start();
    const text = JSON.stringify(await c.status());
    for (const s of [...STUDENTS, ROHAN, "pineapple", "Bright"]) assert.ok(!text.includes(s), `${s} is not in /status`);
  });

  contract("the shop's talk is given 'your child', never a student's name or a parent's number; the parent gets the model's checked answer", async () => {
    const said = { sentences: [{ text: "Fees are due on day 5 of the month.", sources: ["s:due"] }], ask_owner: false };
    const talk = await startFakeModel(() => said); closers.push(talk);
    const c = await boot({ settings: { assistant: {} }, runtime: { talk: { wire: "openai", baseUrl: `http://127.0.0.1:${talk.port}/v1`, model: "fake-model", timeoutMs: 5000 } } });
    await sleep(1500);
    c.goto(at(2, 10) + 1000);
    await c.waitFor(() => lines(c, "open_fee").length === 5, "the month opened");
    await c.inbound(ROHAN, "is the weather good for the picnic on saturday");
    assert.ok(talk.calls >= 1, "the talk model was asked");
    const asked = JSON.stringify(talk.requests);
    for (const s of [...STUDENTS, ROHAN, ROHAN.slice(1)]) assert.ok(!asked.includes(s), `${s} never goes to the model`);
    assert.ok(lines(c, "send_message", "confirmed").some((l) => l.conversation === ROHAN && l.refs.to === "customer"));
  });
});
