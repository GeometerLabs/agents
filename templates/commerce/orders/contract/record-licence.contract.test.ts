// THE RECORD, THE REPORT AND THE LICENCE (group (vii) of the contract, README.md): the SQLite file's format (a Go runtime writes it as TypeScript does, so a shop can move between
// the two), the record that cannot be changed or deleted and that never holds a customer's number or name as itself, the monthly report written once on the first morning of the
// month into the report folder, and the licence lease (licence.json): the wind-down, the final stop, the owner's notice once. Expected values from test/runtime, licence,
// report and the Bookings contract's same group (the store, the record and the report job are shared by every template). A guards shop for the licence (the Guards' wire is the
// witness), a fakes shop on the test clock for the report.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { CUSTOMER, HOUR, OWNER_NUMBER, SUNITA, at, contract, makeShop, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
const reportDirs: string[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const d of reportDirs) rmSync(d, { recursive: true, force: true }); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const link = (s: Shop, n = 0) => s.guards!.standins.fakes.payments.links()[n];

describe("the store's file", () => {
  contract("agent.db is SQLite in WAL mode with the shared tables at schema version 5, and the record cannot be changed or deleted", async () => {
    const s = await boot({ mode: "guards" });
    await s.order(); await s.settle();
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"));
    try {
      assert.equal((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 5);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      for (const t of ["record", "shop_key", "state_rows", "state_shape", "tasks", "window"]) assert.ok(tables.includes(t), `table ${t}`);
      const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      assert.deepEqual(cols("record"), ["seq", "time", "conversation", "booking", "action", "outcome", "entry"]);
      const lines = (db.prepare("SELECT COUNT(*) AS n FROM record").get() as { n: number }).n;
      assert.ok(lines > 0);
      assert.throws(() => db.prepare("UPDATE record SET outcome = 'x'").run(), /the record is append-only/u);
      assert.throws(() => db.prepare("DELETE FROM record").run(), /the record is append-only/u);
      // the order is kept in the state's rows as the TypeScript codec writes it: a shop moves between the two runtimes and loses nothing
      const state = (db.prepare("SELECT list, value FROM state_rows ORDER BY list, pos").all() as { list: string; value: string }[]);
      const order = state.map((r) => JSON.parse(r.value)).find((v) => Array.isArray(v) && v[0] === "o-1");
      assert.ok(order, `the order is in state_rows: ${state.map((r) => r.list).join(",")}`);
      assert.deepEqual([order[1].id, order[1].state, order[1].advanceInr, order[1].totalInr, order[1].channel], ["o-1", "awaiting_advance", 120, 240, "web"]);
    } finally { db.close(); }
  });

  contract("a store from a NEWER schema is refused in a sentence, and the shop does not start on it", async () => {
    const s = await boot();
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"));
    db.exec("PRAGMA user_version = 9999");
    db.close();
    await assert.rejects(s.start(), /newer|version|9999/iu);
  });

  contract("the record holds a customer's number in ONE place, the conversation; no customer words and no typed name or number anywhere; what was said is a keyed digest", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, "hello there, I am Asha");
    await s.order({ name: "Asha Verma", phone: SUNITA });
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
    try {
      const rows = db.prepare("SELECT conversation, entry FROM record").all() as { conversation: string; entry: string }[];
      assert.ok(rows.length > 4);
      assert.ok(rows.some((r) => r.conversation === CUSTOMER));
      for (const r of rows) {
        const entry = JSON.parse(r.entry) as Record<string, unknown>;
        const rest = JSON.stringify({ ...entry, conversation: undefined });
        assert.ok(!rest.includes(CUSTOMER.slice(1)), `the number is nowhere else in a line: ${rest.slice(0, 200)}`);
        assert.ok(!rest.includes(SUNITA.slice(3)), "the typed number is nowhere in the record");
        assert.ok(!rest.includes("hello there") && !rest.includes("Asha"), "no customer words or name");
        assert.match(String(entry.inputsDigest), /^k-[0-9a-f]{16}$/u);
      }
      assert.ok(!rows.map((r) => r.entry).join("").includes("wamid"), "a message id is kept as a fingerprint only");
    } finally { db.close(); }
  });
});

describe("the licence", () => {
  const PAID_THROUGH = Math.floor(Date.now() / 1000) - 5 * 86_400;
  const lease = (state: "active" | "wind_down" | "stopped", o: { notice?: "wind_down" | "stop" | null; paidThrough?: number } = {}) => ({
    schema: 1, newest_issued_at: Math.floor(Date.now() / 1000), extension_until: 0, partner: "Divya, local Operator",
    shop: { id: "annapurna", plan: "business", state, paid_through: o.paidThrough ?? PAID_THROUGH, grace_days: 30, expires: Math.floor(Date.now() / 1000) + 30 * 86_400, stop_at: state === "stopped" ? Math.floor(Date.now() / 1000) - 3600 : state === "wind_down" ? Math.floor(Date.now() / 1000) + 60 * 86_400 : null, export_until: null, notice: o.notice ?? null },
  });

  contract("in the wind-down a new order is paused: nothing held, no link, nothing kept to do later; the page says the shop is paused and WhatsApp says to contact the shop", async () => {
    const s = await boot({ mode: "guards", licence: lease("wind_down") });
    assert.equal((await s.call("/internal/channel/offer")).body.shop.paused, true);
    const { hash } = await s.order();
    const view = (await s.request(hash)).body;
    assert.deepEqual([view.status, view.reason], ["refused", "paused"]);
    assert.equal(s.guards!.of("payments", "POST").length, 0);
    assert.deepEqual((await s.status()).orders, {});
    await s.inbound(CUSTOMER, `2 veg thali ${s.orderDay().words} 12:00 pm pickup`);
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /paused/iu);
    assert.equal(s.guards!.of("payments", "POST").length, 0);
    assert.ok(s.record().some((r) => r.action === "new_work" && r.outcome === "blocked"));
  });

  contract("an advance paid from a link sent before the wind-down still confirms, a cancellation still refunds, and back to normal takes new orders at once", async () => {
    const s = await boot({ mode: "guards" });
    const { hash } = await s.order();
    s.writeLicence(lease("wind_down"));
    await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    assert.equal((await s.request(hash)).body.status, "confirmed");
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 1, "the refund goes on");
    s.writeLicence(lease("active"));
    const again = await s.order({ phone: "+919822222222" });
    assert.equal((await s.request(again.hash)).body.status, "held");
  });

  contract("the final stop closes the open advance links once and sends nothing more; a payment made before is still recorded", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1 });
    await s.order();
    await s.order({ phone: "+919822222222" });
    const paidEvents = s.guards!.pay(link(s, 1).id);
    s.writeLicence(lease("stopped", { notice: "stop" }));
    await sleep(3500); await s.settle();
    const cancels = () => s.guards!.of("payments", "POST", /\/cancel$/u).filter((c) => c.path.includes(link(s).id));
    assert.equal(cancels().length, 1, "the open link is closed, once");
    await sleep(2500);
    assert.equal(cancels().length, 1, "and not again on the next beats");
    await s.events(paidEvents.map((event) => ({ kind: "payment_event", event }))); await s.settle();
    assert.ok(s.record().some((r) => r.action === "record_payment"), "the payment made before is recorded");
  });

  contract("the owner is sent one notice at the wind-down and one at the final stop, as a template, once each", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1, licence: lease("wind_down", { notice: "wind_down" }) });
    const toOwner = () => s.guards!.of("messaging", "POST").filter((c) => c.body.to === OWNER_NUMBER);
    await sleep(3000);
    assert.equal(toOwner().length, 1, "one notice");
    assert.equal(toOwner()[0].body.type, "template");
    await sleep(2500);
    assert.equal(toOwner().length, 1, "not again on the next beats");
    s.writeLicence(lease("stopped", { notice: "stop" }));
    await sleep(3500);
    assert.equal(toOwner().length, 2, "one more at the final stop");
  });
});

describe("the monthly report", () => {
  const dec1 = at({ year: 2026, month: 12, day: 1 }, 9, 30);
  async function reporting(): Promise<{ s: Shop; dir: string }> {
    const dir = join(tmpdir(), `orders-report-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    reportDirs.push(dir);
    const s = await makeShop({ tickSeconds: 1, runtime: { report: { preparedBy: "Divya, local Operator", innovator: false, pageBaseUrl: "https://reports.example/r", pagesDir: dir, source: "test-mode" } } });
    shops.push(s); await s.start();
    await s.order();
    await s.ownerPress("deposit", "received");
    return { s, dir };
  }
  const folders = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

  contract("nothing is made before the first morning of the month; on it, one report folder appears with the month's files, and not again on the next beats or after a restart", async () => {
    const { s, dir } = await reporting();
    s.advance(dec1 - s.now() - 10 * HOUR);           // Nov 30 23:30
    await sleep(2200);
    assert.deepEqual(folders(dir), [], "not yet");
    s.advance(10 * HOUR);                            // Dec 1 09:30
    for (let i = 0; i < 40 && folders(dir).length === 0; i++) await sleep(250);
    const made = folders(dir);
    assert.equal(made.length, 1);
    assert.match(made[0], /^[A-Za-z0-9_-]{16,}$/u);
    for (let i = 0; i < 40 && readdirSync(join(dir, made[0])).length < 3; i++) await sleep(250);
    const files = readdirSync(join(dir, made[0]));
    assert.deepEqual([...files].sort(), ["owner-2026-11-en.txt", "report-2026-11-en.html", "report-2026-11.json"], "November's report in a folder of its own: the page, the owner's lines and the data (Orders has no monthly record certificate)");
    assert.match(readFileSync(join(dir, made[0], "report-2026-11-en.html"), "utf8"), /Annapurna Tiffins/u);
    assert.match(readFileSync(join(dir, made[0], "report-2026-11.json"), "utf8"), /2026-11/u);
    await sleep(2500);
    assert.equal(folders(dir).length, 1);
    await s.stop(); await s.start();
    await sleep(2500);
    assert.equal(folders(dir).length, 1, "nor after a restart");
  });

  contract("a shop with no `report` block makes none and says nothing", async () => {
    const s = await boot({ tickSeconds: 1 });
    await s.order();
    s.advance(dec1 - s.now());
    await sleep(2500);
    assert.equal((await s.status()).tasks.failed, 0);
    void writeFileSync;
  });
});
