// THE RECORD, THE REPORT AND THE LICENCE (group vii of the contract, README.md): the SQLite file's format (one a Go runtime must write byte for byte as TypeScript does, so a shop can
// move between the two), the record that cannot be changed or deleted and that never holds a customer's number as itself, the monthly report written once on the first morning of the
// month into the report folder, and the licence lease (licence.json): the wind-down, the final stop, the owner's notice once. Expected values from test/store, record-decisions,
// licence, report-monthly, report-monthly-config. A guards shop for the licence (the Guards' wire is the witness), a fakes shop on the test clock for the report.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { CUSTOMER, HOUR, OWNER_NUMBER, TZ, contract, makeShop, openStart, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { fixture } from "./guards.ts";

const shops: Shop[] = [];
const reportDirs: string[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const d of reportDirs) rmSync(d, { recursive: true, force: true }); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const link = (s: Shop) => s.guards!.standins.fakes.payments.links()[0];

describe("the store's file", () => {
  contract("agent.db is SQLite in WAL mode with the tables a port must write, at a schema version, and the record cannot be changed or deleted", async () => {
    const s = await boot({ mode: "guards" });
    await s.book(); await s.settle();
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"));
    try {
      assert.equal((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
      const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      assert.equal(version, 5, "the store's schema version: a port writes the same layout (modules/runtime/store.ts MIGRATIONS)");
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
      for (const t of ["record", "shop_key", "state_rows", "state_shape", "tasks", "window"]) assert.ok(tables.includes(t), `table ${t} in ${tables.join(",")}`);
      const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      assert.deepEqual(cols("record"), ["seq", "time", "conversation", "booking", "action", "outcome", "entry"]);
      assert.deepEqual(cols("tasks"), ["seq", "id", "kind", "payload", "received_at", "state", "attempts", "last_error", "waiting_on", "retry_at"]);
      assert.deepEqual(cols("window"), ["phone", "last_inbound_at"]);
      assert.deepEqual(cols("shop_key"), ["id", "private_key", "created_at"]);
      const lines = (db.prepare("SELECT COUNT(*) AS n FROM record").get() as { n: number }).n;
      assert.ok(lines > 0);
      assert.throws(() => db.prepare("UPDATE record SET outcome = 'x'").run(), /the record is append-only/u, "no line can be changed");
      assert.throws(() => db.prepare("DELETE FROM record").run(), /the record is append-only/u, "no line can be deleted");
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM record").get() as { n: number }).n, lines);
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

  contract("the record holds no customer words and no customer name: a message is kept by its id and what the shop read from it, never the words", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, "hello there, I am Asha");
    await s.book({ name: "Asha Verma" });
    await s.stop();
    const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
    try {
      const entries = (db.prepare("SELECT entry FROM record").all() as { entry: string }[]).map((r) => r.entry).join("\n");
      assert.ok(entries.length > 100);
      assert.ok(!entries.includes("hello there"), "no customer words in the record");
      assert.ok(!entries.includes("Asha Verma"), "no customer name in the record");
    } finally { db.close(); }
  });

  contract("the shop makes its own signing key once and keeps it across restarts", async () => {
    const s = await boot();
    const key = () => { const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true }); try { return JSON.stringify(db.prepare("SELECT * FROM shop_key").all()); } finally { db.close(); } };
    const first = key();
    assert.notEqual(first, "[]");
    await s.stop(); await s.start();
    assert.equal(key(), first);
  });
});

describe("the licence", () => {
  const PAID_THROUGH = Math.floor(Date.now() / 1000) - 5 * 86_400;
  const lease = (state: "active" | "wind_down" | "stopped", o: { notice?: "wind_down" | "stop" | null; paidThrough?: number } = {}) => ({
    schema: 1, newest_issued_at: Math.floor(Date.now() / 1000), extension_until: 0, partner: "Divya, local Operator",
    shop: { id: "glow-salon", plan: "business", state, paid_through: o.paidThrough ?? PAID_THROUGH, grace_days: 30, expires: Math.floor(Date.now() / 1000) + 30 * 86_400, stop_at: state === "stopped" ? Math.floor(Date.now() / 1000) - 3600 : state === "wind_down" ? Math.floor(Date.now() / 1000) + 60 * 86_400 : null, export_until: null, notice: o.notice ?? null },
  });
  const PAUSED = "Sorry, online booking is paused for now. Please contact Glow Salon directly.";

  contract("in the wind-down a request to book is paused: no booking, no hold, no link, and nothing kept to do later; the page says the shop is paused", async () => {
    const s = await boot({ mode: "guards", licence: lease("wind_down") });
    const offer = (await s.call("/internal/channel/offer")).body;
    assert.equal(offer.shop.paused, true);
    const { hash } = await s.book();
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "refused");
    assert.equal(s.guards!.of("calendar", "POST").length, 0);
    assert.equal(s.guards!.of("payments", "POST").length, 0);
    assert.deepEqual((await s.status()).bookings, {}, "no draft is kept as a promise");
    const r = s.record().filter((x) => x.action === "new_work");
    assert.deepEqual(r.map((x) => x.outcome), ["blocked"]);
    // and on WhatsApp the customer is told, once, in the shop's words, with no menu that would end in "paused"
    await s.inbound(CUSTOMER, "haircut tomorrow at 6pm");
    assert.equal(s.sent(CUSTOMER).at(-1)!.text, PAUSED);
    await s.inbound(CUSTOMER, "hi");
    assert.equal(s.sent(CUSTOMER).at(-1)!.text, PAUSED);
    assert.equal(s.guards!.of("calendar", "POST").length, 0);
  });

  contract("a deposit paid from a link sent before the wind-down still books, a cancellation still refunds, and back to normal takes new bookings at once", async () => {
    const s = await boot({ mode: "guards" });
    const { hash } = await s.book();
    s.writeLicence(lease("wind_down"));
    await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    assert.equal((await s.request(hash)).body.status, "booked", "money owed to a customer's booking is honoured");
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 1, "the refund goes on");
    s.writeLicence(lease("active"));
    const again = await s.book({ name: "Ravi", phone: "+919822222222", startMs: openStart(Date.now(), 4) });
    assert.ok(["held", "refused"].includes((await s.request(again.hash)).body.status));
    assert.notEqual((await s.request(again.hash)).body.reason, "licence");
  });

  contract("the final stop closes the open deposit links once through the payments service and sends nothing more; a payment made before is still recorded", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1 });
    const open = await s.book();
    const paid = await s.book({ name: "Ravi", phone: "+919822222222", startMs: openStart(Date.now(), 4) });
    const second = s.guards!.standins.fakes.payments.links()[1];
    const paidEvents = s.guards!.pay(second.id);
    s.writeLicence(lease("stopped", { notice: "stop" }));
    await sleep(3500); await s.settle();
    const cancels = s.guards!.of("payments", "POST", /\/cancel$/u);
    assert.equal(cancels.filter((c) => c.path.includes(link(s).id)).length, 1, "the open link is closed, once");
    await sleep(2500);
    assert.equal(s.guards!.of("payments", "POST", /\/cancel$/u).filter((c) => c.path.includes(link(s).id)).length, 1, "and not again on the next beats");
    await s.events(paidEvents.map((event) => ({ kind: "payment_event", event }))); await s.settle();
    assert.ok(s.record().some((r) => r.action === "record_deposit"), "the payment made before is recorded");
    void open; void paid;
  });

  contract("the owner is sent one service notice at the wind-down and one at the final stop, as a template, once each, and again only for a new paid_through", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1, licence: lease("wind_down", { notice: "wind_down" }) });
    const toOwner = () => s.guards!.of("messaging", "POST").filter((c) => c.body.to === OWNER_NUMBER);
    await sleep(3000);
    assert.equal(toOwner().length, 1, "one notice");
    assert.equal(toOwner()[0].body.type, "template", "the owner has not written today: a template");
    await sleep(2500);
    assert.equal(toOwner().length, 1, "not again on the next beats");
    s.writeLicence(lease("stopped", { notice: "stop" }));
    await sleep(3500);
    assert.equal(toOwner().length, 2, "one more at the final stop");
    s.writeLicence(lease("stopped", { notice: "stop", paidThrough: PAID_THROUGH + 86_400 }));
    await sleep(3500);
    assert.equal(toOwner().length, 3, "a new paid_through is a new notice");
  });

  contract("a licence file that does not read never restricts by accident: the last good reading stands", async () => {
    const s = await boot({ mode: "guards", licence: lease("wind_down") });
    assert.equal((await s.call("/internal/channel/offer")).body.shop.paused, true);
    await sleep(1100);
    writeFileSync(join(s.client, "licence.json"), "{ half");
    await sleep(100);
    assert.equal((await s.call("/internal/channel/offer")).body.shop.paused, true, "a torn file leaves the last good reading standing");
  });

  contract("Guard's own licence refusal (402 subscription_suspended) while the shop's file says 'in order' is the shop's own pause: asked once, the slot let go, nobody told to do anything", async () => {
    const s = await boot({ mode: "guards" });
    s.guards!.calendar.answer(fixture("guard-responses.json").suspended, { times: 1, match: (c) => c.method === "POST" && /\/events$/u.test(c.path) });
    const { hash } = await s.book();
    assert.equal((await s.request(hash)).body.status, "not_held");
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u).length, 1, "asked once");
    assert.equal(s.guards!.of("payments", "POST").length, 0, "no link was made without a hold");
    assert.deepEqual(s.guards!.of("messaging").filter((c) => c.body.to === OWNER_NUMBER), [], "the owner is not asked to do anything");
    assert.ok(s.record().some((r) => r.outcome === "blocked"));
  });
});

describe("the monthly report", () => {
  const dec1 = zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, TZ);
  /** A UPI fakes shop (no Guard, so the test clock may move it) with a `report` block, and one booking marked paid in November: a quiet month sends no report. */
  async function reporting(): Promise<{ s: Shop; dir: string }> {
    const dir = join(tmpdir(), `bookings-report-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    reportDirs.push(dir);
    const s = await makeShop({ tickSeconds: 1, settings: { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } }, runtime: { report: { preparedBy: "Divya, local Operator", innovator: false, pageBaseUrl: "https://reports.example/r", pagesDir: dir, source: "test-mode" } } });
    shops.push(s); await s.start();
    await s.book({ startMs: zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 11, minute: 0 }, TZ) });
    const [item] = (await s.ownerView()).body.items;
    await s.channelEvents([{ kind: "owner_action", id: "m-1", action: "received", case: "b-1", digest: item.digest }], { owner: true }); await s.settle();
    return { s, dir };
  }
  const folders = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

  contract("nothing is made before the first morning of the month; on it, one report folder appears with a page that names the shop, and it is not made again on the next beats or after a restart", async () => {
    const { s, dir } = await reporting();
    s.advance(dec1 - s.now() - 10 * HOUR);           // Nov 30 23:30
    await sleep(2200);
    assert.deepEqual(folders(dir), [], "not yet: the report goes from 09:00 on the 1st");
    s.advance(10 * HOUR);                            // Dec 1 09:30
    for (let i = 0; i < 40 && folders(dir).length === 0; i++) await sleep(250);
    const made = folders(dir);
    assert.equal(made.length, 1, "one report");
    assert.match(made[0], /^[A-Za-z0-9_-]{16,}$/u, "the folder is named by a random token, so the page is not guessable");
    const files = readdirSync(join(dir, made[0]));
    const page = files.find((f) => f.endsWith(".html"));
    assert.ok(page, files.join(","));
    assert.match(readFileSync(join(dir, made[0], page!), "utf8"), /Glow Salon/u);
    await sleep(2500);
    assert.equal(folders(dir).length, 1, "not again on the next beats");
    await s.stop(); await s.start();
    await sleep(2500);
    assert.equal(folders(dir).length, 1, "nor after a restart");
  });

  contract("a shop with no `report` block in runtime.json makes none and says nothing", async () => {
    const s = await boot({ tickSeconds: 1, settings: { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } } });
    await s.book({ startMs: zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 11, minute: 0 }, TZ) });
    s.advance(dec1 - s.now());
    await sleep(2500);
    assert.ok(!existsSync(join(s.root, "reports")));
    assert.equal((await s.status()).tasks.failed, 0);
  });
});
