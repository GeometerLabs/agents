// The monthly job (B54): last month's report reaches the owner on WhatsApp once, on the first morning of the month in the shop's time zone, even across a restart.
// The messaging fake's outbox is the witness for "sent"; the record is the job's only memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { ApiError, NotSentError, TimeoutError } from "../src/adapters/faults.ts";
import { createRecord } from "../src/record.ts";
import { zonedToMs } from "../src/time.ts";
import { MAX_TRIES, RETRY_AFTER_MS, createMonthlyReport, lastMonth, nothingWasSent, sendFrom } from "../report/monthly-job.ts";
import type { MonthlyReportContext, MonthlyReportSetup } from "../report/monthly-job.ts";
import { REPORT_TEMPLATE_NAMES } from "../report/whatsapp.ts";
import { LANGUAGES } from "../src/settings.ts";
import { MINUTE } from "../src/time.ts";
import { createKit } from "./runtime-kit.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, minute = 0, year = 2026) => zonedToMs({ year, month, day }, { hour, minute }, TZ);
const BASE = "https://reports.example.com/r";

let dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "geo-monthly-")); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

function setup(o: { innovator?: boolean; dir?: string } = {}): MonthlyReportSetup & { made: string[] } {
  const made: string[] = [];
  let n = 0;
  return { made, source: "live", pages: { dir: o.dir ?? tempDir(), baseUrl: BASE }, options: () => ({ preparedBy: "Divya, local partner", innovator: o.innovator === true }), token: () => { const t = `t${++n}`.padEnd(8, "0"); made.push(t); return t; } };
}

/** A shop with a November: one haircut booked on 3 Nov and its deposit paid. The report templates are approved, as they are in production. */
async function novemberWorld(): Promise<World> {
  const w = createWorld();
  for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) w.messaging.approve(name, language);
  await w.say("haircut tomorrow at 6pm");
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  return w;
}

/** The next `times` sends of a template fail with this error and send nothing; after that the real one works. `calls` counts every try. */
function refuse(w: World, times: number, error: () => Error): { calls: number } {
  const real = w.messaging.sendTemplate.bind(w.messaging);
  const seen = { calls: 0 };
  w.messaging.sendTemplate = async (to, template) => { if (seen.calls++ < times) throw error(); return real(to, template); };
  return seen;
}
const refused = () => new ApiError(400, "Template name does not exist in the translation.");

const context = (w: World, log: string[] = [], save: () => void = () => undefined): MonthlyReportContext => ({ settings: w.settings, clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, save, log: (l) => log.push(l) });
const toOwner = (w: World) => w.messaging.sentTo(w.owner);
const mine = (w: World) => w.record.entries().filter((e) => e.action === "send_message" && e.refs.report === "2026-11");

test("lastMonth and sendFrom use the shop's own time zone: the 1st at 09:00 there, and January looks back to December", () => {
  assert.equal(lastMonth(at(12, 1, 9), TZ), "2026-11");
  assert.equal(lastMonth(at(1, 1, 9, 0, 2027), TZ), "2026-12");
  assert.equal(lastMonth(at(12, 31, 23, 59), TZ), "2026-11");
  assert.equal(sendFrom(at(12, 17, 15), TZ), at(12, 1, 9));
  // 08:30 in India is still the 30th for a clock in New York, and 03:00 UTC on the 1st is 22:00 on the 30th there
  const instant = Date.UTC(2026, 11, 1, 3, 30);
  assert.equal(sendFrom(instant, TZ), instant, "09:00 in India is 03:30 UTC");
  assert.equal(lastMonth(Date.UTC(2026, 11, 1, 3, 30), "America/New_York"), "2026-10", "it is still November there");
  assert.equal(lastMonth(Date.UTC(2026, 11, 1, 3, 30), "Pacific/Auckland"), "2026-11", "and already December in Auckland");
});

test("nothing before 09:00 on the 1st; at 09:00 the owner gets the month's report once, as a template, with the numbers the fakes hold", async () => {
  const w = await novemberWorld();
  const dir = tempDir();
  const job = createMonthlyReport(setup({ dir }));
  const log: string[] = [];
  w.clock.set(at(11, 30, 23, 59));
  assert.deepEqual(await job.run(context(w)), { done: false, why: "quiet" }, "on 30 November the month that ended is October, and the shop did nothing in October");
  w.clock.set(at(12, 1, 8, 59));
  assert.deepEqual(await job.run(context(w)), { done: false, why: "not-yet" });
  assert.equal(toOwner(w).length, 0);

  w.clock.set(at(12, 1, 9));
  const first = await job.run(context(w, log));
  assert.deepEqual(first, { done: true, month: "2026-11", outcome: "confirmed", via: "template" });
  const [sent] = toOwner(w);
  assert.equal(toOwner(w).length, 1);
  assert.equal(sent.kind, "template", "the owner has not written today, so WhatsApp carries only a template");
  assert.equal(sent.templateName, "monthly_report");
  const deposit = w.linkFor("b-1")!.payments.reduce((sum, p) => sum + p.amount, 0) / 100; // what the payments fake holds, not what the agent said
  assert.ok(sent.text.includes(`Bookings made: 1 · Deposits collected: ₹${deposit}`), sent.text);
  assert.ok(sent.text.includes("Monthly report: Glow Salon · Nov 2026"), sent.text);
  assert.ok(sent.text.includes("Set up by: Divya, local partner · Geometer"), sent.text);
  assert.ok(sent.text.includes(`${BASE}/t1000000/report-2026-11-en.html`), sent.text);
  assert.ok(!sent.text.includes("★"), "no badge");

  // later ticks, the rest of the day, the next day: nothing more
  for (const [d, h] of [[1, 9], [1, 12], [2, 9], [15, 10]]) { w.clock.set(at(12, d, h)); await job.run(context(w)); }
  assert.equal(toOwner(w).length, 1);
  assert.deepEqual(mine(w).map((e) => e.outcome), ["attempted", "confirmed"], "recorded: the claim, then how it ended");
  assert.equal(mine(w)[1].refs.via, "template");
  assert.equal(mine(w)[1].refs.messageId, sent.id);
  assert.ok(log.some((l) => l.includes("2026-11") && l.includes("sent")));
  // the page, the certificate and the signed data are in a folder named by the random part, and nowhere else
  assert.deepEqual(readdirSync(dir), ["t1000000"]);
  assert.deepEqual(readdirSync(join(dir, "t1000000")).sort(), ["certificate-2026-11-en.html", "certificate-2026-11-en.txt", "certificate-2026-11.json", "owner-2026-11-en.txt", "report-2026-11-en.html", "report-2026-11.json"]);
});

test("a restart never sends it twice: a new job over the saved record finds the month done", async () => {
  const w = await novemberWorld();
  const dir = tempDir();
  w.clock.set(at(12, 1, 9, 5));
  await createMonthlyReport(setup({ dir })).run(context(w));
  assert.equal(toOwner(w).length, 1);
  assert.ok(existsSync(join(dir, "t1000000", "report-2026-11-en.html")) && existsSync(join(dir, "t1000000", "certificate-2026-11-en.txt")) && existsSync(join(dir, "t1000000", "report-2026-11.json")));

  for (let restart = 0; restart < 3; restart++) {
    const afterRestart = createMonthlyReport(setup({ dir })); // a new process: it remembers nothing but the record
    w.clock.advanceMinutes(60);
    assert.deepEqual(await afterRestart.run({ ...context(w), record: createRecord(w.clock, w.record.entries()) }), { done: false, why: "already" });
  }
  assert.equal(toOwner(w).length, 1);
});

test("a process that dies between the send and the save of how it ended does not send again: the claim was saved first, and the restart records that it may have gone out", async () => {
  const w = await novemberWorld();
  const job = createMonthlyReport(setup());
  w.clock.set(at(12, 1, 9));
  let saves = 0;
  let onDisk = w.record.entries();
  const crashing = context(w, [], () => { saves++; if (saves === 2) throw new Error("power cut"); onDisk = w.record.entries(); });
  await assert.rejects(() => job.run(crashing), /power cut/);
  assert.equal(toOwner(w).length, 1, "it went out");
  assert.deepEqual(onDisk.filter((e) => e.refs.report === "2026-11").map((e) => e.outcome), ["attempted"], "only the claim reached the disk");

  // the restart: a new record from what was saved, a new job
  const record = createRecord(w.clock, onDisk);
  const log: string[] = [];
  const restarted = createMonthlyReport(setup());
  w.clock.advanceMinutes(2);
  assert.deepEqual(await restarted.run({ ...context(w, log), record }), { done: false, why: "already" });
  assert.equal(toOwner(w).length, 1, "not sent again");
  const ending = record.entries().filter((e) => e.refs.report === "2026-11");
  assert.deepEqual(ending.map((e) => e.outcome), ["attempted", "unconfirmed"]);
  assert.match(ending[1].notes, /may or may not have reached/);
  assert.ok(log.some((l) => /may or may not have reached/.test(l)));
  w.clock.advanceMinutes(24 * 60);
  await restarted.run({ ...context(w), record });
  assert.equal(toOwner(w).length, 1);
  assert.equal(record.entries().filter((e) => e.refs.report === "2026-11").length, 2, "and nothing more is written");
});

test("a lost reply may have gone out, so it is recorded as unconfirmed and never sent again", async () => {
  const w = await novemberWorld();
  const job = createMonthlyReport(setup());
  w.messaging.inject("sendTemplate", "lostReply");
  w.clock.set(at(12, 1, 10));
  assert.deepEqual(await job.run(context(w)), { done: true, month: "2026-11", outcome: "unconfirmed", via: "template" });
  assert.equal(toOwner(w).length, 1);
  w.clock.set(at(12, 3, 10));
  await job.run(context(w));
  await createMonthlyReport(setup()).run(context(w));
  assert.equal(toOwner(w).length, 1);
});

test("a refusal sent nothing, so it is tried again after an hour, three times at most, and then left for the builder with a line in the log", async () => {
  const w = await novemberWorld();
  const job = createMonthlyReport(setup());
  const log: string[] = [];
  refuse(w, 5, refused);
  w.clock.set(at(12, 1, 9));
  assert.deepEqual(await job.run(context(w, log)), { done: true, month: "2026-11", outcome: "failed", via: "template" });
  assert.equal(toOwner(w).length, 0);
  assert.match(log.at(-1)!, /could not be sent.*tried again in an hour \(try 1 of 3\)/);

  w.clock.advance(RETRY_AFTER_MS - MINUTE);
  assert.deepEqual(await job.run(context(w, log)), { done: false, why: "waiting" });
  w.clock.advance(2 * MINUTE);
  assert.equal((await job.run(context(w, log)) as { outcome: string }).outcome, "failed");
  w.clock.advance(RETRY_AFTER_MS + MINUTE);
  assert.equal((await job.run(context(w, log)) as { outcome: string }).outcome, "failed");
  assert.match(log.at(-1)!, /last try/);
  assert.equal(mine(w).filter((e) => e.outcome === "failed").length, MAX_TRIES);
  for (let day = 2; day < 6; day++) { w.clock.set(at(12, day, 10)); assert.deepEqual(await job.run(context(w, log)), { done: false, why: "gave-up" }); }
  assert.equal(toOwner(w).length, 0);
  // a new process finds the same
  assert.deepEqual(await createMonthlyReport(setup()).run(context(w, log)), { done: false, why: "gave-up" });
});

test("only an answer that says nothing was sent is tried again: a 5xx, a reply with no message id, a timeout or a surprise might come after WhatsApp took the message, so they are never sent twice", async () => {
  assert.deepEqual([new ApiError(400, "x"), new ApiError(404, "x"), new NotSentError("connection refused")].map(nothingWasSent), [true, true, true]);
  assert.deepEqual([new ApiError(500, "x"), new ApiError(502, "WhatsApp accepted the call but gave no message id."), new ApiError(503, "paused"), new TimeoutError("send"), new Error("surprise")].map(nothingWasSent), [false, false, false, false, false]);
  for (const error of [() => new ApiError(500, "The provider could not take the message."), () => new ApiError(502, "WhatsApp accepted the call but gave no message id."), () => new ApiError(503, "WhatsApp has paused sending."), () => new TimeoutError("send template"), () => new Error("surprise")]) {
    const w = await novemberWorld();
    const tries = refuse(w, 1, error);
    const job = createMonthlyReport(setup());
    w.clock.set(at(12, 1, 9));
    assert.equal((await job.run(context(w)) as { outcome: string }).outcome, "unconfirmed", error().message);
    for (const later of [RETRY_AFTER_MS + MINUTE, 5 * RETRY_AFTER_MS, 24 * RETRY_AFTER_MS]) { w.clock.advance(later); await job.run(context(w)); await createMonthlyReport(setup()).run(context(w)); }
    assert.equal(tries.calls, 1, `${error().message}: the send was tried once and never again`);
    assert.deepEqual(mine(w).map((e) => e.outcome), ["attempted", "unconfirmed"]);
  }
  // and a connection that was refused sent nothing, so it is tried again like any clean refusal
  const w = await novemberWorld();
  const tries = refuse(w, 1, () => new NotSentError("connect ECONNREFUSED"));
  const job = createMonthlyReport(setup());
  w.clock.set(at(12, 1, 9));
  assert.equal((await job.run(context(w)) as { outcome: string }).outcome, "failed");
  w.clock.advance(RETRY_AFTER_MS);
  assert.equal((await job.run(context(w)) as { outcome: string }).outcome, "confirmed");
  assert.equal(tries.calls, 2);
  assert.equal(toOwner(w).length, 1);
});

test("once WhatsApp has taken the message, an error reading it back (even a 4xx) is not a refusal: it went out, so it is unconfirmed and not sent again", async () => {
  const w = await novemberWorld();
  w.messaging.getMessage = async () => { throw new ApiError(404, "no such message"); };
  const job = createMonthlyReport(setup());
  w.clock.set(at(12, 1, 9));
  assert.equal((await job.run(context(w)) as { outcome: string }).outcome, "unconfirmed");
  w.clock.advance(3 * RETRY_AFTER_MS);
  await job.run(context(w));
  assert.equal(toOwner(w).length, 1);
});

test("a refusal that clears is tried again an hour later and then sent once", async () => {
  const w = await novemberWorld();
  const job = createMonthlyReport(setup());
  refuse(w, 1, refused);
  w.clock.set(at(12, 1, 9));
  assert.equal((await job.run(context(w)) as { outcome: string }).outcome, "failed");
  w.clock.advance(RETRY_AFTER_MS);
  assert.equal((await job.run(context(w)) as { outcome: string }).outcome, "confirmed");
  assert.equal(toOwner(w).length, 1);
  assert.deepEqual(mine(w).map((e) => e.outcome), ["attempted", "failed", "attempted", "confirmed"]);
  w.clock.advance(5 * RETRY_AFTER_MS);
  await job.run(context(w));
  assert.equal(toOwner(w).length, 1);
});

test("when the owner's window is open the same words go as plain text, then the certificate's text as a document, once", async () => {
  const closed = await novemberWorld();
  const open = await novemberWorld();
  const options = { dir: tempDir() };
  const asTemplate = (await (async () => { closed.clock.set(at(12, 1, 9)); await createMonthlyReport({ ...setup(options), token: () => "fixedtoken0" }).run(context(closed)); return toOwner(closed)[0]; })());
  open.clock.set(at(11, 30, 20));
  open.messaging.receive(open.owner, "hello"); // the owner writes, which opens their 24-hour window
  open.clock.set(at(12, 1, 9));
  const job = createMonthlyReport({ ...setup(options), token: () => "fixedtoken0" });
  assert.deepEqual(await job.run(context(open)), { done: true, month: "2026-11", outcome: "confirmed", via: "text" });
  const [text, doc] = toOwner(open);
  assert.equal(text.kind, "text");
  assert.equal(text.text, asTemplate.text, "a template and a plain message say exactly the same");
  assert.equal(doc.kind, "document");
  assert.deepEqual(doc.document, { link: `${BASE}/fixedtoken0/certificate-2026-11-en.txt`, filename: "certificate-2026-11-en.txt", caption: doc.text });
  assert.match(doc.text, /^Monthly record certificate · Code: [0-9A-Z]{4}-[0-9A-Z]{4}$/u);
  assert.ok(readFileSync(join(options.dir, "fixedtoken0", "certificate-2026-11-en.txt"), "utf8").includes(doc.text.slice(-9)), "the code in the caption is the certificate's");
  assert.deepEqual(open.record.entries().filter((e) => e.refs.reportFile === "2026-11").map((e) => e.outcome), ["attempted", "confirmed"]);
  open.clock.set(at(12, 2, 9));
  await job.run(context(open));
  assert.equal(toOwner(open).length, 2, "neither the text nor the document is sent again");
});

test("a document that WhatsApp refuses costs nothing: the report itself has already gone, and nothing is tried again", async () => {
  const w = await novemberWorld();
  w.clock.set(at(11, 30, 21));
  w.messaging.receive(w.owner, "hello"); // the owner writes, so their window is open on the morning of the 1st
  w.messaging.inject("sendDocument", "error");
  w.clock.set(at(12, 1, 9));
  const job = createMonthlyReport(setup());
  assert.equal((await job.run(context(w)) as { outcome: string }).outcome, "confirmed");
  assert.deepEqual(toOwner(w).map((m) => m.kind), ["text"]);
  assert.deepEqual(w.record.entries().filter((e) => e.refs.reportFile).map((e) => e.outcome), ["attempted", "unconfirmed"]);
  w.clock.set(at(12, 2, 9));
  await job.run(context(w));
  assert.deepEqual(toOwner(w).map((m) => m.kind), ["text"]);
});

test("a month with nothing in the record gets no message and no entry, and a month that holds only the job's own entries is just as quiet", async () => {
  const w = createWorld();
  for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) w.messaging.approve(name, language);
  const job = createMonthlyReport(setup());
  w.clock.set(at(12, 1, 10));
  assert.deepEqual(await job.run(context(w)), { done: false, why: "quiet" });
  assert.equal(toOwner(w).length, 0);
  assert.equal(w.record.entries().length, 0, "not even a note in the record");

  // a real November, reported on 1 Dec; December itself is then empty except for the job's own entries
  const busy = await novemberWorld();
  busy.clock.set(at(12, 1, 9));
  const busyJob = createMonthlyReport(setup());
  await busyJob.run(context(busy));
  busy.clock.set(at(1, 1, 9, 0, 2027));
  assert.deepEqual(await busyJob.run(context(busy)), { done: false, why: "quiet" });
  assert.deepEqual(await createMonthlyReport(setup()).run(context(busy)), { done: false, why: "quiet" });
  assert.equal(toOwner(busy).length, 1, "December's report does not exist, because December held nothing but November's report going out");
});

test("only the month that just ended is reported: a job that is switched on late does not make up the months before", async () => {
  const w = await novemberWorld(); // all of the shop's activity is on 3 and 4 November
  const job = createMonthlyReport(setup());
  w.clock.set(at(2, 10, 10, 0, 2027)); // February: the month that ended is January, which held nothing
  assert.deepEqual(await job.run(context(w)), { done: false, why: "quiet" });
  assert.equal(toOwner(w).length, 0);
  // but a late start in the same month still reports last month
  const late = await novemberWorld();
  late.clock.set(at(12, 20, 16));
  assert.equal((await createMonthlyReport(setup()).run(context(late)) as { month: string }).month, "2026-11");
});

test("the Innovator template goes out only when the flag is on, and a change to the flag shows on the next report with no restart", async () => {
  const plain = await novemberWorld();
  const badged = await novemberWorld();
  plain.clock.set(at(12, 1, 9));
  badged.clock.set(at(12, 1, 9));
  await createMonthlyReport(setup()).run(context(plain));
  await createMonthlyReport(setup({ innovator: true })).run(context(badged));
  assert.equal(toOwner(plain)[0].templateName, "monthly_report");
  assert.ok(!toOwner(plain)[0].text.includes("★"));
  assert.equal(toOwner(badged)[0].templateName, "monthly_report_innovator");
  assert.ok(toOwner(badged)[0].text.endsWith("\n★ Innovator"), toOwner(badged)[0].text);
  // the flag is read when the report is made
  const flag = { on: false };
  const job = createMonthlyReport({ ...setup(), options: () => ({ preparedBy: "Divya, local partner", innovator: flag.on }) });
  const w = await novemberWorld();
  w.clock.set(at(12, 1, 9));
  flag.on = true;
  await job.run(context(w));
  assert.equal(toOwner(w)[0].templateName, "monthly_report_innovator");
});

test("the page the link points to carries the same badge, and the same code the message gives", async () => {
  const w = await novemberWorld();
  const dir = tempDir();
  w.clock.set(at(12, 1, 9));
  await createMonthlyReport(setup({ innovator: true, dir })).run(context(w));
  const code = /: ([0-9A-Z]{4}-[0-9A-Z]{4}) · /u.exec(toOwner(w)[0].text)![1];
  const page = readFileSync(join(dir, "t1000000", "report-2026-11-en.html"), "utf8");
  assert.ok(page.includes(`<p class="badge">★ Innovator</p>`) && page.includes(code));
  assert.ok(readFileSync(join(dir, "t1000000", "certificate-2026-11-en.txt"), "utf8").includes("★ Innovator"));
  assert.ok(readFileSync(join(dir, "t1000000", "report-2026-11.json"), "utf8").includes('"innovator": true') || readFileSync(join(dir, "t1000000", "report-2026-11.json"), "utf8").includes('"innovator":true'));
});

// ---- inside the runtime: saved twice, riding on the clock's beat ----

async function runtimeWithNovember(kit: ReturnType<typeof createKit>, options: Parameters<ReturnType<typeof createKit>["open"]>[0]) {
  for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) kit.messaging.approve(name, language);
  const opened = kit.open(options);
  await kit.say(opened.runtime, "haircut tomorrow at 6pm");
  kit.payments.customerPays(kit.linkFor("b-1")!.id);
  await kit.deliverPaymentEvents(opened.runtime);
  return opened;
}

test("in the runtime the report goes out on the first tick after 09:00 on the 1st, is saved with its claim and ending, and a restart on the same folder sends nothing", async () => {
  const kit = createKit();
  try {
    const lines: string[] = [];
    const report = setup({ dir: join(kit.dir, "reports") });
    const first = await runtimeWithNovember(kit, { report, log: (l) => lines.push(l) });
    kit.clock.set(at(12, 1, 8, 30));
    await first.runtime.tick();
    assert.equal(kit.messaging.sentTo(kit.settings.owner.whatsapp).length, 0);
    kit.clock.set(at(12, 1, 9, 1));
    await first.runtime.tick();
    await first.runtime.tick();
    const owner = kit.messaging.sentTo(kit.settings.owner.whatsapp);
    assert.equal(owner.length, 1);
    assert.equal(owner[0].templateName, "monthly_report");
    assert.deepEqual(first.db.loadState().record.filter((e) => e.refs.report === "2026-11").map((e) => e.outcome), ["attempted", "confirmed"]);
    assert.equal(first.runtime.status().recordLength, first.db.loadState().record.length);
    await first.runtime.close();

    const second = kit.open({ report: setup({ dir: join(kit.dir, "reports") }), log: (l) => lines.push(l) });
    kit.clock.set(at(12, 1, 9, 10));
    await second.runtime.tick();
    kit.clock.set(at(12, 2, 9));
    await second.runtime.tick();
    assert.equal(kit.messaging.sentTo(kit.settings.owner.whatsapp).length, 1, "the same one");
    assert.equal(second.db.loadState().record.filter((e) => e.refs.report === "2026-11").length, 2);
  } finally { kit.cleanup(); }
});

test("in the runtime a crash after the send and before the ending is saved leaves the claim, and the restart does not send again", async () => {
  const kit = createKit();
  try {
    const lines: string[] = [];
    const report = setup({ dir: join(kit.dir, "reports") });
    // the store the runtime is given refuses to save the step that carries the ending, as a power cut would
    const doomed = { cut: false };
    const first = await runtimeWithNovember(kit, { report, log: (l) => lines.push(l) });
    await first.runtime.close();
    const { openStore } = await import("../server/store.ts");
    const real = openStore(join(kit.dir, "data"));
    const faulty = { ...real, commitStep: (step: Parameters<typeof real.commitStep>[0]) => { if (doomed.cut && step.entries.some((e) => e.refs.report === "2026-11" && e.outcome === "confirmed")) throw new Error("power cut"); real.commitStep(step); }, close: () => real.close() };
    const { createRuntime } = await import("../server/runtime.ts");
    const { createRuleParser } = await import("../src/adapters/rule-parser.ts");
    const runtime = createRuntime({ settings: kit.settings, store: faulty, clock: kit.clock, services: { calendar: kit.calendar, payments: kit.payments, messaging: kit.messaging }, parser: createRuleParser(), pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0], report: setup({ dir: join(kit.dir, "reports") }), log: (l) => lines.push(l) });
    doomed.cut = true;
    kit.clock.set(at(12, 1, 9, 1));
    await runtime.tick();
    assert.equal(kit.messaging.sentTo(kit.settings.owner.whatsapp).length, 1, "it went out");
    assert.deepEqual(real.loadState().record.filter((e) => e.refs.report === "2026-11").map((e) => e.outcome), ["attempted"], "only the claim was saved");
    assert.ok(lines.some((l) => /power cut/.test(l)));
    await runtime.close();

    const second = kit.open({ report: setup({ dir: join(kit.dir, "reports") }), log: (l) => lines.push(l) });
    kit.clock.set(at(12, 1, 9, 5));
    await second.runtime.tick();
    kit.clock.set(at(12, 3, 9));
    await second.runtime.tick();
    assert.equal(kit.messaging.sentTo(kit.settings.owner.whatsapp).length, 1, "not sent again");
    assert.deepEqual(second.db.loadState().record.filter((e) => e.refs.report === "2026-11").map((e) => e.outcome), ["attempted", "unconfirmed"]);
  } finally { kit.cleanup(); }
});

test("a report that cannot be made is said once and never holds up the beat: a hold still expires", async () => {
  const kit = createKit();
  try {
    const lines: string[] = [];
    const blocker = join(kit.dir, "not-a-folder");
    writeFileSync(blocker, "a file where the report folder should be");
    const { runtime } = await runtimeWithNovember(kit, { report: setup({ dir: blocker }), log: (l) => lines.push(l) });
    // a second customer asks for a time and does not pay; the hold runs out on the beat even though the report cannot be made
    await kit.say(runtime, "facial the day after tomorrow at 11am", { from: "+919822222222" });
    const held = () => runtime.status().bookings.awaiting_deposit ?? 0;
    assert.equal(held(), 1);
    kit.clock.set(at(12, 1, 9, 1));
    await runtime.tick();
    await runtime.tick();
    await runtime.tick();
    assert.equal(held(), 0, "the hold expired");
    assert.equal(lines.filter((l) => /monthly report could not be made/.test(l)).length, 1, lines.join("\n"));
    assert.equal(kit.messaging.sentTo(kit.settings.owner.whatsapp).length, 0);
    assert.equal(runtime.status().recordLength > 0, true);
  } finally { kit.cleanup(); }
});
