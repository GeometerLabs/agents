// The owner's side of a Fees centre: the licence (the wind-down pauses new fee work and says so; the final stop closes the open links once; the owner's one notice), the shop's
// assistant over the Fees skill ("who owes fees" from the saved fees; a waiting waiver as a card whose yes is the owner's own "approve q-1"; without an "assistant" block nothing
// changes), the owner's talk box, the panel's to-do list asking the owner again, and the monthly report on the first morning of the month, once. Expected values from
// test/licence, assistant, assistant-money, recovery, report and old-dues-report.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MEERA, OWNER_NUMBER, ROHAN, at, contract, lease, lines, makeCentre, sleep } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });
async function boot(o: CentreOptions = {}): Promise<Centre> { const c = await makeCentre(o); centres.push(c); await c.start(); return c; }
async function guardsCentre(o: CentreOptions = {}): Promise<Centre> {
  const c = await boot({ mode: "guards", ...o });
  await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
  return c;
}
const last = (c: Centre, to: string): string => c.sent(to).at(-1)?.text ?? "";
const PAUSED = /online fee payment is paused/iu;

describe("the licence", () => {
  contract("in the wind-down the page says paused, a parent asking to pay is told so and no request is made; back in order, fees are collected again", async () => {
    const c = await guardsCentre();
    const requests = () => lines(c, "upi_request").length;
    const before = requests();
    c.writeLicence(lease("wind_down"));
    await c.waitFor(async () => (await c.call("/internal/channel/offer")).body.shop.paused === true, "the page says paused");
    await c.inbound(ROHAN, "please send the payment link");
    assert.match(last(c, ROHAN), PAUSED);
    assert.equal(requests(), before, "no new request in the wind-down");
    assert.ok(lines(c, "new_work", "blocked").length >= 1);
    assert.ok(lines(c, "licence").some((l) => l.refs.state === "wind_down"), "the record says the licence restricts the centre");
    c.writeLicence(lease("active"));
    await c.waitFor(async () => (await c.call("/internal/channel/offer")).body.shop.paused === false, "the page in order again");
    await c.inbound(ROHAN, "please send the payment link");
    assert.match(last(c, ROHAN), /^Pay ₹1,800/u);
  });

  contract("the owner is sent one service notice at the wind-down, as a template, once; the final stop closes a Razorpay centre's open links once", async () => {
    const c = await guardsCentre({ example: "razorpay" });
    await c.inbound(ROHAN, "pay");
    const link = c.guards!.standins.fakes.payments.links().find((l) => l.reference_id === "f-2.1")!;
    const toOwner = () => c.guards!.of("messaging", "POST").filter((x) => x.body.to === OWNER_NUMBER);
    const before = toOwner().length;
    c.writeLicence(lease("wind_down", { notice: "wind_down" }));
    await c.waitFor(() => toOwner().length === before + 1, "one notice to the owner");
    assert.equal(toOwner().at(-1)!.body.type, "template");
    await sleep(2500);
    assert.equal(toOwner().length, before + 1, "not again on the next beats");
    c.writeLicence(lease("stopped", { notice: "stop" }));
    await c.waitFor(() => c.guards!.of("payments", "POST", /\/cancel$/u).some((x) => x.path.includes(link.id)), "the open link closed");
    await sleep(2500);
    assert.equal(c.guards!.of("payments", "POST", /\/cancel$/u).filter((x) => x.path.includes(link.id)).length, 1, "once");
    assert.ok(lines(c, "cancel_fee_link").some((l) => l.refs.licence !== undefined));
  });
});

describe("the owner's page", () => {
  contract("the page lists the centre, every parent once (by a ref, with their students and whether a link is out), the open fees to mark by hand, and no codes; without the assistant there is no app", async () => {
    const c = await guardsCentre();
    const view = (await c.ownerView()).body;
    assert.equal(view.kind, "fees");
    assert.deepEqual(view.shop, { name: "Bright Tuition Centre (UPI)", timezone: "Asia/Kolkata", ownerLanguage: "en" });
    assert.deepEqual(view.parents.map((p: { students: string[] }) => p.students), [["Aarav Sharma", "Anaya Sharma"], ["Meera Nair"], ["Kiran Gowda"], ["Rohan Mehta"]]);
    for (const p of view.parents) { assert.match(p.ref, /^p-[0-9a-f]{12}$/u); assert.match(p.digest, /^[0-9a-f]{32}$/u); }
    assert.deepEqual(view.cash.map((x: { case: string }) => x.case), ["f-1", "f-2"]);
    assert.equal(view.app, undefined);
    assert.ok(view.money, "the money section, worked out from the record");
    assert.equal(view.classes, undefined, "a centre without Classes has no classes section");
  });

  contract("the talk box and a card's answer on a centre without the assistant are refused in the record and do nothing", async () => {
    const c = await guardsCentre();
    await c.channelEvents([{ kind: "owner_message", id: "om-1", text: "who owes fees" }], { owner: true }); await c.settle();
    assert.equal(lines(c, "owner_page_message", "blocked").length, 1);
    await c.ownerAction("card_yes", "c-1", "0".repeat(32));
    assert.equal(lines(c, "owner_page_action", "blocked").length, 1);
    await c.inbound(OWNER_NUMBER, "who owes fees");
    assert.match(last(c, OWNER_NUMBER), /understand/iu, "the owner's free words get the usual answer");
  });
});

describe("the shop's assistant on a Fees centre", () => {
  contract("'who owes fees' answers from the saved fees; 'what needs me' shows a waiting waiver as a card whose Approve is the owner's own 'approve q-1'", async () => {
    const c = await guardsCentre({ settings: { assistant: {} } });
    await c.inbound(OWNER_NUMBER, "who owes fees");
    const owes = last(c, OWNER_NUMBER);
    assert.match(owes, /^Fees not paid yet: 2\n/u);
    assert.match(owes, /Rohan Mehta, /u);
    assert.match(owes, /Meera Nair, /u);
    await c.inbound(ROHAN, "please waive ₹500");
    await c.inbound(OWNER_NUMBER, "what needs me");
    const card = c.sent(OWNER_NUMBER).filter((m) => m.interactive?.buttons?.some((b: { id: string }) => b.id.startsWith("card-"))).at(-1)!;
    assert.match(card.text, /^Waive ₹500 of Rohan Mehta's fee \(/u);
    await c.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    assert.equal(lines(c, "owner_decision", "confirmed").filter((l) => l.refs.command === "approve").length, 1);
    assert.equal(lines(c, "waive_fee", "confirmed").length, 1);
    const app = (await c.ownerView()).body.app;
    assert.ok(app, "with the assistant the owner's page has the app view");
  });

  contract("'cancel f-2' is a card of the owner's own; its yes waives the whole balance and closes the fee", async () => {
    const c = await guardsCentre({ settings: { assistant: {} } });
    await c.inbound(OWNER_NUMBER, "cancel f-2");
    const card = c.sent(OWNER_NUMBER).filter((m) => m.interactive?.buttons?.some((b: { id: string }) => b.id.startsWith("card-"))).at(-1);
    assert.ok(card, "a card");
    await c.tap(card!.interactive.buttons[0].id, { from: OWNER_NUMBER });
    assert.deepEqual((await c.status()).fees, { open: 1, closed: 1 });
    assert.ok(lines(c, "waive_fee", "confirmed").some((l) => l.booking === "f-2" && l.refs.amountPaise === "180000"));
  });
});

describe("the panel's to-do list", () => {
  contract("ask_owner_again tells the owner again about a waiver waiting; recheck_payment reads the record again and changes nothing that is not there", async () => {
    const c = await guardsCentre();
    await c.inbound(ROHAN, "please waive ₹500");
    const asked = () => c.sent(OWNER_NUMBER).filter((m) => m.text.startsWith("Approval needed")).length;
    const before = asked();
    const r = await c.call("/internal/recover", { body: { id: "r-1", case: "f-2", action: "ask_owner_again" } });
    assert.equal(r.status, 200);
    await c.settle();
    assert.equal(asked(), before + 1);
    assert.ok(lines(c, "recovery").some((l) => l.outcome === "confirmed"));
    await c.call("/internal/recover", { body: { id: "r-2", case: "f-1", action: "recheck_payment" } }); await c.settle();
    assert.ok(lines(c, "recovery").some((l) => l.refs.recovery === "r-2"));
    assert.deepEqual((await c.status()).fees, { open: 2 });
    assert.equal((await c.status()).tasks.failed, 0);
  });
});

describe("the monthly report", () => {
  contract("nothing before 09:00 on the 1st; then one report folder for November, with the centre's page and data, made once even across a restart", async () => {
    const dir = join(await (async () => { const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); return mkdtempSync(join(tmpdir(), "fees-report-")); })(), "reports");
    mkdirSync(dir, { recursive: true });
    const withReport = await makeCentre({ runtime: { report: { preparedBy: "Divya, local Operator", innovator: false, pageBaseUrl: "https://reports.example/r", pagesDir: dir, source: "test-mode" } } });
    centres.push(withReport);
    await withReport.start();
    await withReport.started();
    withReport.goto(at(2, 10) + 1000);
    await withReport.waitFor(() => lines(withReport, "open_fee").length === 5, "November's fees");
    // the report's folder is the one with the report in it; a UPI centre's QR pictures are folders of their own beside it (upi-qr.png, under random names)
    const folders = () => (existsSync(dir) ? readdirSync(dir).filter((f) => readdirSync(join(dir, f)).some((x) => x.startsWith("report-"))) : []);
    const qr = () => (existsSync(dir) ? readdirSync(dir).filter((f) => readdirSync(join(dir, f)).includes("upi-qr.png")) : []);
    withReport.goto(at(30, 23, 30));
    await sleep(2200);
    assert.deepEqual(folders(), [], "not before the 1st");
    assert.ok(qr().length >= 1, "a UPI reminder's QR picture, in a folder of its own under a random name");
    assert.ok(qr().every((f) => /^[0-9a-f]{32}$/u.test(f)));
    withReport.goto(at(1, 9, 30, 12));
    await withReport.waitFor(() => folders().length === 1, "one report folder");
    await sleep(1500);
    const made = folders();
    assert.match(made[0], /^[A-Za-z0-9_-]{16,}$/u);
    const files = readdirSync(join(dir, made[0]));
    assert.ok(files.includes("report-2026-11.json"), files.join(", "));
    assert.ok(files.includes("report-2026-11-en.html"), files.join(", "));
    const data = readFileSync(join(dir, made[0], "report-2026-11.json"), "utf8");
    assert.match(data, /Bright Tuition Centre/u);
    assert.ok(!data.includes(ROHAN) && !data.includes(MEERA), "no parent's number in the report's data");
    await sleep(2500);
    assert.equal(folders().length, 1, "not again on the next beats");
    await withReport.stop(); await withReport.start();
    await sleep(2500);
    assert.equal(folders().length, 1, "nor after a restart");
  });
});
