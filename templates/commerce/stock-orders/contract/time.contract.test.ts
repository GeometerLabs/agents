// The timed work (group T, README.md), on a "fakes" shop whose test clock the test moves: a card that runs out sends nothing; a silent supplier is asked again about the SAME
// order at the follow-up hours, through send once, and after the last ask the owner is told once and the owner's page offers "ask again"; a question the agent put to the owner
// runs out after six hours; the monthly report is made once, on the first morning of the next month. Nothing sent can be read from outside a fakes shop, so the witness is the
// shop's file (the orders, the send-once intents, the record) and the owner's page; cards are answered from the page. From test/agent.test.ts ("a card that ran out"),
// test/channel.test.ts, test/send-once.test.ts (the reminder) and test/report.test.ts.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { HOUR, OWNER, TZ, contract, shops, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";

const made = shops();
const dirs: string[] = [];
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Wait (on the real clock, while the shop beats every second) until `ok` holds. */
async function until(s: Shop, ok: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 80; i++) { if (await ok()) return; await sleep(100); }
  throw new Error(`waited 8 s for ${what}:\n${s.log().slice(-2000)}`);
}
/** The owner's request, and the yes from the owner's page (the card's id and digest). */
async function approved(s: Shop, text = "order 10 boxes of hair colour from Ravi Traders"): Promise<void> {
  await s.ownerSays(text);
  const item = await s.item("po_approval", `po-${s.saved().seq}`);
  assert.ok(item, "the order waits on the owner's page");
  await s.press("card_yes", item);
}

describe("a card runs out", () => {
  contract("after 24 hours the card is closed, the order is void, nothing is sent, and a yes then does nothing", async () => {
    const s = await made.boot({ mode: "fakes", tickSeconds: 1 });
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const item = await s.item("po_approval", "po-1");
    s.advance(25 * HOUR);
    await until(s, () => s.order("po-1").state === "void", "the order to be void");
    assert.ok(s.record().some((l) => l.action === "owner_decision" && l.outcome === "blocked" && /ran out/u.test(l.notes)));
    assert.equal(await s.item("po_approval", "po-1"), undefined);
    await s.press("card_yes", item);
    assert.equal(s.order("po-1").state, "void");
    assert.equal((s.saved().sendOnce?.intents ?? []).length, 0, "no order message was ever asked for");
  });
});

describe("a supplier who stays silent", () => {
  contract("asked again about the same order at 4 and 24 hours, through send once; the owner told once; the page's ask-again asks once more", async () => {
    const s = await made.boot({ mode: "fakes", tickSeconds: 1 });
    await approved(s);
    assert.equal(s.order("po-1").state, "sent");
    assert.deepEqual(s.saved().sendOnce.intents.map((i: any) => [i.kind, i.status]), [["purchase_order", "confirmed"]]);
    s.advance(4 * HOUR + 60_000);
    await until(s, () => s.saved().sendOnce.intents.length === 2 && s.saved().sendOnce.intents[1].status === "confirmed", "the first reminder");
    const reminder = s.saved().sendOnce.intents[1];
    assert.equal(reminder.kind, "supplier_check"); assert.equal(reminder.caseId, "po-1"); assert.deepEqual(reminder.templates, ["supplier_check"]);
    assert.equal(s.order("po-1").silentToldMs, undefined, "the owner is told only after the last ask");
    s.advance(20 * HOUR);
    await until(s, () => s.order("po-1").silentToldMs !== undefined, "the owner told the supplier is silent");
    await until(s, () => s.saved().sendOnce.intents.length === 3, "the second reminder");
    const item = await s.item("po_silent", "po-1");
    assert.deepEqual(item.actions, ["retry"]);
    await s.press("retry", item);
    await s.press("retry", item);
    await until(s, () => s.saved().sendOnce.intents.every((i: any) => i.status === "confirmed"), "the page's reminder to go");
    assert.equal(s.saved().sendOnce.intents.length, 4, "one more reminder for the press, none for the same press again");
    assert.ok(s.saved().sendOnce.intents.every((i: any) => i.caseId === "po-1"), "every reminder is about the same order: never a new order");
    assert.equal(Object.keys(s.saved().orders).length, 1);
    assert.equal(s.record().filter((l) => l.action === "ask_supplier_again" && l.outcome === "confirmed").length, 3);
  });
});

describe("a question runs out", () => {
  contract("an unanswered \"how many?\" is let go after six hours, and a later number makes no order", async () => {
    const s = await made.boot({ mode: "fakes", tickSeconds: 1 });
    await s.ownerSays("order hair oil from meena");
    assert.equal(s.saved().asking.kind, "qty");
    s.advance(7 * HOUR);
    await until(s, () => s.saved().asking === undefined, "the question to be let go");
    await s.ownerSays("6");
    assert.equal(Object.keys(s.saved().orders).length, 0);
  });
});

describe("the monthly report", () => {
  const dec1 = zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, TZ);
  contract("made once on the first morning of the next month, in a folder of its own named by a random token; not again on the next beats or after a restart", async () => {
    const dir = join(tmpdir(), `stock-orders-report-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true }); dirs.push(dir);
    const s = await made.boot({ mode: "fakes", tickSeconds: 1, runtime: { report: { preparedBy: "Divya, local Operator", innovator: false, pageBaseUrl: "https://reports.example/r", pagesDir: dir, source: "test-mode" } } });
    await approved(s);
    const folders = (): string[] => (existsSync(dir) ? readdirSync(dir) : []);
    s.advance(dec1 - s.now() - 10 * HOUR);
    await sleep(2200);
    assert.deepEqual(folders(), [], "not before the morning of the 1st");
    s.advance(10 * HOUR);
    await until(s, () => folders().length === 1, "the report folder");
    const made1 = folders();
    assert.match(made1[0], /^[A-Za-z0-9_-]{16,}$/u);
    await until(s, () => ["report-2026-11.json", "report-2026-11-en.html", "owner-2026-11-en.txt"].every((f) => readdirSync(join(dir, made1[0])).includes(f)), "the report's files");
    const files = readdirSync(join(dir, made1[0])).sort();
    assert.ok(files.includes("report-2026-11.json") && files.includes("report-2026-11-en.html") && files.includes("owner-2026-11-en.txt"), files.join(","));
    const data = readFileSync(join(dir, made1[0], "report-2026-11.json"), "utf8");
    assert.match(data, /Glow Unisex Salon/u);
    assert.ok(!data.includes(OWNER) && !data.includes("919876500001"), "no number of the owner's or a supplier's in the report's data");
    await sleep(2200);
    assert.equal(folders().length, 1);
    await s.stop(); await s.start();
    await sleep(2200);
    assert.equal(folders().length, 1, "nor after a restart");
  });

  // What the report counts and what it leaves out, read from its own files: the month's one approved order, held against the budget under the supplier's own name, the owner's lines in
  // the owner's language, a signed-or-sealed check code, and no phone number in any file of the folder (the owner's, the supplier's, or one written in the shop's settings). From
  // test/report.test.ts. The Go report is proved against the TypeScript's on 31 cases in go/internal/stockordersreport; this is the same truth through the running shop.
  contract("counts the month's approved order under its supplier, says it in the owner's lines, and carries no phone number in any file", async () => {
    const dir = join(tmpdir(), `stock-orders-report-counts-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true }); dirs.push(dir);
    const s = await made.boot({ mode: "fakes", tickSeconds: 1, runtime: { report: { preparedBy: "Divya, local Operator", innovator: false, pageBaseUrl: "https://reports.example/r", pagesDir: dir, source: "test-mode" } } });
    await approved(s);
    s.advance(dec1 - s.now());
    await until(s, () => existsSync(dir) && readdirSync(dir).length === 1, "the report folder");
    const folder = join(dir, readdirSync(dir)[0]);
    await until(s, () => ["report-2026-11.json", "report-2026-11-en.html", "owner-2026-11-en.txt"].every((f) => readdirSync(folder).includes(f)), "the report's files");
    const sealed = JSON.parse(readFileSync(join(folder, "report-2026-11.json"), "utf8"));
    const r = sealed.document;
    assert.equal(r.format, "geometer-stock-orders-report/1");
    assert.equal(r.pathway.name, "stock-orders");
    assert.deepEqual(r.period.month, { year: 2026, month: 11 });
    assert.equal(r.preparedBy, "Divya, local Operator");
    assert.equal(r.source, "test-mode");
    assert.deepEqual([r.orders.placed, r.orders.sentOut, r.orders.silent, r.owner.asked, r.owner.approved], [1, 1, 1, 1, 1], JSON.stringify(r.orders));
    assert.equal(r.budget.usedPaise, 450000, "the approved order holds its ₹4,500 of the month's budget");
    assert.equal(r.budget.usedPaise + r.budget.leftPaise, r.budget.monthlyPaise);
    assert.deepEqual(r.suppliers.map((x: any) => [x.id, x.name, x.placed]), [["ravi-traders", "Ravi Traders", 1]]);
    assert.deepEqual(r.markedPaidByOwner, { orders: 0 });
    assert.match(sealed.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/u);
    const text = readFileSync(join(folder, "owner-2026-11-en.txt"), "utf8").trimEnd().split("\n");
    assert.equal(text.length, 6, "the owner's six lines");
    assert.match(text[0], /Glow Unisex Salon/u);
    assert.match(text[1], /Orders placed: 1\b/u);
    for (const f of readdirSync(folder)) {
      const body = readFileSync(join(folder, f), "utf8");
      for (const n of [OWNER, OWNER.slice(1), "919876500001", "919876500002", "919876500003"]) assert.ok(!body.includes(n), `${f} carries ${n}`);
    }
  });
});
