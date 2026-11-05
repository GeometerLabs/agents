// The cost meter's counting (B45): record entries to cumulative counts. Counts only, one adapter for the new record fields, and a message with no such
// fields is a rules message that cost nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../pathways/bookings/server/store.ts";
import { runExports } from "../backup/jobs.ts";
import { exportShop } from "../backup/export.ts";
import { deploy } from "../deploy.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { readStatus } from "../lib/status.ts";
import { FIELDS, isCustomerMessage, summarizeUsage, understandingOf, usageRatesFrom, whatsappTypeOf } from "../lib/usage.ts";
import { latestPriceList, latestProposedPriceList } from "../panel/cost.ts";
import { createWorld } from "../../pathways/bookings/src/harness.ts";
import { parseIntent } from "../../pathways/bookings/src/adapters/rule-parser.ts";
import { createMonthlyReport } from "../../pathways/bookings/report/monthly-job.ts";
import { REPORT_TEMPLATE_NAMES } from "../../pathways/bookings/report/whatsapp.ts";
import { LANGUAGES } from "../../pathways/bookings/src/settings.ts";
import { zonedToMs } from "../../pathways/bookings/src/time.ts";
import { world } from "./world.ts";

const RATES = usageRatesFrom([latestProposedPriceList()!, latestPriceList()]);
const entry = (action: string, outcome: string, more: Record<string, unknown> = {}) => ({ seq: 1, time: "2026-11-04T10:00:00Z", conversation: "c-1", booking: null, action, inputsDigest: "d", outcome, decisions: [], language: "en", notes: "", refs: {}, ...more });
/** A customer message whose record says how it was understood, in the names FIELDS holds (so a rename there is followed by every test). */
const understood = (step: string, cost = 0, more: Record<string, unknown> = {}) =>
  entry("receive_message", "confirmed", { [FIELDS.container]: { [FIELDS.step]: step, [FIELDS.provider]: "deepinfra", [FIELDS.model]: "deepseek-v4.1-flash", [FIELDS.inputTokens]: 2000, [FIELDS.outputTokens]: 150, [FIELDS.costMicroInr]: cost, ...more } });
const reply = (to: "customer" | "owner", templates: string, outcome = "confirmed") => entry("send_message", outcome, { refs: { to, templates, messageId: "m1" } });

test("a customer message is a confirmed receive_message; a repeated delivery (blocked), an owner command and a payment event are not", () => {
  assert.equal(isCustomerMessage(entry("receive_message", "confirmed")), true);
  assert.equal(isCustomerMessage(entry("receive_message", "blocked")), false);
  assert.equal(isCustomerMessage(entry("receive_payment_event", "confirmed")), false);
  assert.equal(isCustomerMessage(entry("owner_decision", "confirmed")), false);
  assert.equal(isCustomerMessage(null), false);
  assert.equal(isCustomerMessage("receive_message"), false);
});

test("the adapter reads the understanding fields, from the nested object or from the entry itself, and nothing else", () => {
  const u = understandingOf(understood("model", 14_000));
  assert.deepEqual(u, { step: "model", provider: "deepinfra", model: "deepseek-v4.1-flash", inputTokens: 2000, outputTokens: 150, costMicroInr: 14_000 });
  const flat = understandingOf({ ...entry("receive_message", "confirmed"), [FIELDS.step]: "decision", [FIELDS.costMicroInr]: 6 });
  assert.deepEqual([flat?.step, flat?.costMicroInr, flat?.inputTokens], ["decision", 6, 0]);
});

test("absent or malformed fields make no understanding: the message is a rules message with no spend", () => {
  for (const bad of [entry("receive_message", "confirmed"), understood("telepathy"), understood(""), { ...entry("receive_message", "confirmed"), [FIELDS.container]: "x" }, { ...entry("receive_message", "confirmed"), [FIELDS.container]: { [FIELDS.step]: 3 } }, null, 7, []]) {
    assert.equal(understandingOf(bad), undefined);
  }
  // a known step with a bad number keeps the step and counts the number as 0 (never NaN, never negative, never a fraction)
  for (const cost of [-5, 1.5, "9.5", "-3", "abc", "", null, Number.NaN, Infinity, "1".repeat(16)]) assert.equal(understandingOf(understood("model", cost as never))!.costMicroInr, 0);
  // the record's refs hold every value as a decimal string: those are read as the numbers they are
  assert.deepEqual(understandingOf(understood("model", "34104" as never, { [FIELDS.inputTokens]: "2184", [FIELDS.outputTokens]: "150" })), { step: "model", provider: "deepinfra", model: "deepseek-v4.1-flash", inputTokens: 2184, outputTokens: 150, costMicroInr: 34_104 });
  const t = summarizeUsage([entry("receive_message", "confirmed"), understood("telepathy", 99)], RATES);
  assert.deepEqual([t.messages, t.byStep, t.modelMicroInr], [2, { rules: 2, decision: 0, model: 0 }, 0]);
});

test("messages are counted by the step that read them, and the model spend is the record's own estimate", () => {
  const t = summarizeUsage([
    entry("receive_message", "confirmed"), understood("rules"), understood("decision", 6), understood("decision", 6), understood("model", 14_000),
    entry("receive_message", "blocked", { notes: "the same WhatsApp message was delivered again" }), // not a message
    entry("receive_message", "confirmed", { notes: "a voice note: it is not listened to and nothing of it is kept" }), // a voice note is a received message the agent handled
  ], RATES);
  assert.deepEqual([t.messages, t.byStep, t.modelMicroInr], [6, { rules: 3, decision: 2, model: 1 }, 14_012]);
  assert.equal(t.byStep.rules + t.byStep.decision + t.byStep.model, t.messages);
});

test("outgoing messages are typed from what the record holds: owner notices and reminders are utility, every other reply is service", () => {
  assert.equal(whatsappTypeOf(reply("customer", "booked")), "service");
  assert.equal(whatsappTypeOf(reply("customer", "menu")), "service");
  assert.equal(whatsappTypeOf(reply("customer", "reminder")), "utility");
  assert.equal(whatsappTypeOf(reply("customer", "booked+reminder")), "utility");
  assert.equal(whatsappTypeOf(reply("owner", "owner_message_held")), "utility");
  assert.equal(whatsappTypeOf(entry("voice_note_reply", "confirmed", { refs: { to: "customer", templates: "voice_note" } })), "service");
  assert.equal(whatsappTypeOf(reply("customer", "booked", "unconfirmed")), "service", "it left; the provider's outbox could not be read back");
  for (const outcome of ["blocked", "failed", "held_for_owner", "attempted"]) assert.equal(whatsappTypeOf(reply("customer", "booked", outcome)), undefined, outcome);
  assert.equal(whatsappTypeOf(entry("receive_message", "confirmed")), undefined);
  assert.equal(whatsappTypeOf(entry("send_message", "confirmed")), "service", "an old entry with no refs is a service reply");
});

test("the WhatsApp estimate is gross: GST included, before the free replies, rounded up once; a missing rate makes it 0 and says so", () => {
  const entries = [reply("customer", "booked"), reply("customer", "booked"), reply("customer", "reminder"), reply("owner", "owner_message_held")];
  const t = summarizeUsage(entries, RATES);
  assert.deepEqual([t.whatsapp.service, t.whatsapp.utility, t.whatsapp.marketing], [2, 2, 0]);
  // 4 messages at INR 0.115 = 460,000 micro-rupees, plus 18% GST = 542,800
  assert.deepEqual([t.whatsapp.estMicroInr, t.whatsapp.estimated], [542_800, true]);
  const noGst = summarizeUsage(entries, { ...RATES, gstBasisPoints: undefined });
  assert.deepEqual([noGst.whatsapp.estMicroInr, noGst.whatsapp.estimated], [0, false], "not a guess");
  const noRates = summarizeUsage(entries, {});
  assert.deepEqual([noRates.whatsapp.estMicroInr, noRates.whatsapp.estimated], [0, false]);
  const quiet = summarizeUsage([understood("rules")], {});
  assert.deepEqual([quiet.whatsapp.estMicroInr, quiet.whatsapp.estimated], [0, true], "nothing sent, nothing to price");
  const odd = summarizeUsage([reply("customer", "booked")], { serviceMicroInr: 1, gstBasisPoints: 1800 });
  assert.equal(odd.whatsapp.estMicroInr, 2, "1.18 rounds up to 2");
});

test("the totals hold numbers and nothing else: no text of an entry can get into them", () => {
  const secret = "I want to book for Priya on 9876543210";
  const t = summarizeUsage([understood("model", 5, { note: secret }), entry("receive_message", "confirmed", { notes: secret, inputsDigest: secret, conversation: "+919876543210" })], RATES);
  assert.doesNotMatch(JSON.stringify(t), /Priya|9876543210/u);
  const walk = (v: unknown): void => { if (typeof v === "object" && v !== null) Object.values(v).forEach(walk); else assert.ok(typeof v === "number" || typeof v === "boolean", `only numbers and flags, got ${typeof v}`); };
  walk(t);
});

test("the export job counts the shop's record: the totals come back with the export, and the files still hold no number", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-usage-")); try {
    const store = openStore(join(dir, "rt"));
    const entries = [understood("decision", 6), understood("model", 14_000), entry("receive_message", "confirmed"), reply("customer", "booked"), reply("owner", "owner_message_held")].map((e, i) => ({ ...e, seq: i + 1, conversation: "+919811111111" }));
    store.commitStep({ snapshot: JSON.stringify({ format: 1, bookings: [], customers: [], seenMessages: [], seenEvents: [], nextBooking: 1 }), entries: entries as never, nowMs: Date.now() });
    store.close();
    const r = exportShop({ name: "s", db: join(dir, "rt", "agent.db"), out: join(dir, "out", "s") }, RATES);
    assert.deepEqual([r.ok, r.entries], [true, 5]);
    assert.deepEqual([r.usage!.messages, r.usage!.byStep, r.usage!.modelMicroInr, r.usage!.whatsapp.service, r.usage!.whatsapp.utility], [3, { rules: 1, decision: 1, model: 1 }, 14_006, 1, 1]);
    assert.ok(!readFileSync(join(dir, "out", "s", "record.json"), "utf8").includes("919811111111"));
    // with no rates passed it reads the bundle's own price lists, the way the export container does
    assert.equal(exportShop({ name: "s", db: join(dir, "rt", "agent.db"), out: join(dir, "out", "s") }).usage!.whatsapp.estimated, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the deployer writes the counts into the shop's status file and leaves the shop's 'confirmed' time alone", async () => {
  const w = world();
  try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const before = readStatus(w.root, "glow-salon")!;
    assert.equal(before.usage, undefined);
    const totals = { messages: 40, byStep: { rules: 12, decision: 25, model: 3 }, modelMicroInr: 51_000, whatsapp: { service: 120, utility: 30, marketing: 0, estMicroInr: 20_000, estimated: true } };
    w.ctx.now = () => new Date("2026-11-04T10:15:00Z");
    w.ctx.runner = fakeRunner(() => ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, entries: 9, bookings: 1, usage: totals }, { name: "ghost", ok: true, entries: 1, bookings: 0, usage: totals }] })));
    const r = await runExports(w.ctx);
    assert.equal(r.ok, true);
    const after = readStatus(w.root, "glow-salon")!;
    assert.deepEqual(after.usage, { ...totals, at: "2026-11-04T10:15:00.000Z" });
    assert.equal(after.updatedAt, before.updatedAt, "a count is not a confirmation of the shop");
    assert.equal(readStatus(w.root, "ghost"), undefined, "a shop the deployer does not run gets no file");
  } finally { w.done(); }
});

test("the pathway's own record is what the meter reads: a rules message, a decision-model message and a priced language-model message, as the agent writes them", async () => {
  const understood = (step: "rules" | "decision" | "model", cost: number | null) => ({ step, provider: step === "model" ? "deepinfra" : step === "decision" ? "laya" : "rules", model: step === "model" ? "deepseek-ai/DeepSeek-V4.1-Flash" : step === "decision" ? "laya" : "rule-parser", inputTokens: 2184, outputTokens: 150, costMicroInr: cost, rateDate: cost === null ? null : "2026-11-05", tried: ["rules" as const], failed: [] });
  const queue = [understood("model", 34_104), understood("decision", 0), understood("model", null)];
  const parser = { parse: async (t: string, c: never) => parseIntent(t, c), parseDetailed: async (t: string, c: never) => ({ intent: parseIntent(t, c), understood: queue.shift() }) };
  const w = createWorld({ parser });
  await w.say("hello");
  await w.say("hello again", { from: "+919822222222" });
  await w.say("and again", { from: "+919833333333" });
  const refs = w.record.entries().filter(isCustomerMessage).map((e) => e.refs);
  assert.equal(refs[0].costMicroInr, "34104", "the pathway writes strings");
  const u = understandingOf(w.record.entries().filter(isCustomerMessage)[0]);
  assert.deepEqual(u, { step: "model", provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash", inputTokens: 2184, outputTokens: 150, costMicroInr: 34_104 });
  const t = summarizeUsage(w.record.entries(), RATES);
  assert.deepEqual([t.messages, t.byStep, t.modelMicroInr], [3, { rules: 0, decision: 1, model: 2 }, 34_104]);
  const plain = createWorld();
  await plain.say("hello");
  assert.deepEqual(summarizeUsage(plain.record.entries(), RATES).byStep, { rules: 1, decision: 0, model: 0 }, "a rules-only agent's messages are rules messages");
});

test("the monthly report to the owner (B54) is counted as one utility message, from the entries the job really writes: the claim costs nothing, the ending is utility", async () => {
  const w = createWorld();
  for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) w.messaging.approve(name, language);
  await w.say("haircut tomorrow at 6pm");
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  const before = w.record.entries().length;
  const dir = mkdtempSync(join(tmpdir(), "geo-usage-report-"));
  try {
    w.clock.set(zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, w.settings.timezone));
    const job = createMonthlyReport({ source: "live", pages: { dir, baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, local partner", innovator: false }) });
    await job.run({ settings: w.settings, clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, save: () => undefined });
    const written = w.record.entries().slice(before);
    assert.deepEqual(written.map((e) => [e.action, e.outcome, e.refs.to, e.refs.report]), [["send_message", "attempted", "owner", "2026-11"], ["send_message", "confirmed", "owner", "2026-11"]]);
    assert.deepEqual(written.map(whatsappTypeOf), [undefined, "utility"]);
    const was = summarizeUsage(w.record.entries().slice(0, before), RATES).whatsapp;
    const now = summarizeUsage(w.record.entries(), RATES).whatsapp;
    assert.deepEqual([now.utility - was.utility, now.service - was.service, now.marketing - was.marketing], [1, 0, 0]);
    assert.ok(now.estMicroInr > was.estMicroInr, "and the estimate counts it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
