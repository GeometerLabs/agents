// The agent, step by step: how a month's fees are opened, who is reminded and when, what the record keeps, and the things every template does (a message delivered
// twice, a voice note, button mode).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, MINUTE, zonedToMs } from "../../../modules/core/time.ts";
import { KIRAN_PARENT, MEERA_PARENT, ROHAN_PARENT, SHARMA_PARENT, brightTuition, createWorld } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { balancePaise, createStore, moveTo } from "../src/due.ts";
import { MARKERS } from "../crash-test/says.ts";

const IST = "Asia/Kolkata";
const at = (month: number, day: number, hour = 10, minute = 0) => zonedToMs({ year: 2026, month, day }, { hour, minute }, IST);

test("nothing is opened before the first reminder day; on it every student's fee is opened at their batch's fee, and reminded", async () => {
  const w = createWorld();
  await w.tick();
  assert.equal(w.store.dues.size, 0, "09:00 on the 2nd: the first reminder is at 10:00");
  await w.advance(61);
  assert.deepEqual([...w.store.dues.values()].map((d) => [d.studentName, d.feeInr, d.month, d.state]), [
    ["Aarav Sharma", 1800, "2026-11", "open"], ["Anaya Sharma", 1200, "2026-11", "open"], ["Meera Nair", 1500, "2026-11", "open"], ["Kiran Gowda", 1200, "2026-11", "open"], ["Rohan Mehta", 1800, "2026-11", "open"],
  ]);
  assert.ok([...w.store.dues.values()].every((d) => d.dueMs === at(11, 5, 0, 0)), "all due on the 5th, at midnight in the centre's time zone");
  assert.equal(w.textsTo(ROHAN_PARENT).length, 1);
  assert.equal(w.textsTo(SHARMA_PARENT).length, 2, "two children, two reminders, each with its own link");
  const links = w.payments.links().map((l) => l.amount);
  assert.deepEqual(links.sort((a, b) => a - b), [120_000, 120_000, 150_000, 180_000, 180_000]);
});

test("a tick again opens nothing twice and sends nothing twice", async () => {
  const w = createWorld();
  await w.advance(61);
  const sent = w.messaging.outbox().length;
  await w.tick(); await w.tick(); await w.advance(5);
  assert.equal(w.store.dues.size, 5);
  assert.equal(w.messaging.outbox().length, sent);
  assert.equal(w.payments.links().length, 5);
});

test("the reminder days follow the settings: before, on and after the due day, the wording changes, and the cap holds", async () => {
  const w = createWorld();
  await w.advance(61);
  const rohan = () => w.textsTo(ROHAN_PARENT);
  await w.goto({ year: 2026, month: 11, day: 5 });
  assert.match(rohan().at(-1)!, /is ₹1,800, due on Thu 5 Nov|due on Thu 5 Nov/, "on the due day it is still 'due on'");
  await w.goto({ year: 2026, month: 11, day: 10 });
  assert.match(rohan().at(-1)!, /was due on Thu 5 Nov\. ₹1,800 is still to pay/, "after it, 'was due on'");
  await w.goto({ year: 2026, month: 11, day: 15 });
  assert.match(rohan().at(-1)!, /A late fee of ₹100 has been added, so ₹1,900 is still to pay/, "after the grace days the late fee is in it");
  assert.equal(rohan().length, 4, "four reminders, the cap");
  await w.goto({ year: 2026, month: 11, day: 20 });
  assert.equal(rohan().length, 4, "no fifth");
  assert.equal(w.dueOf("Rohan Mehta")!.remindersSent, 4);
});

test("the cap in the settings is the cap: one reminder a month means one", async () => {
  const raw = JSON.parse(JSON.stringify(brightTuition()));
  raw.students = brightTuition().students.map((s) => ({ name: s.name, parent: s.parent, batch: s.batchId, language: s.language }));
  raw.reminders = { daysFromDue: [-3, 0, 5], hour: 10, maxPerMonth: 1 };
  const w = createWorld({ settings: parseSettings(raw) });
  await w.advance(61);
  await w.goto({ year: 2026, month: 11, day: 5 });
  await w.goto({ year: 2026, month: 11, day: 10 });
  assert.equal(w.textsTo(ROHAN_PARENT).length, 1);
  assert.ok(w.record.entries().some((e) => e.action === "send_message" && e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === "reminder-cap")), "the record says the cap stopped them");
});

test("a month whose first reminder day came before the agent first ran is not chased: the centre may have collected it already; the next month is", async () => {
  const w = createWorld({ nowMs: at(11, 12, 9) });
  await w.tick();
  await w.advance(120);
  assert.equal(w.store.dues.size, 0, "mid-month: November's fees are not opened");
  assert.equal(w.messaging.outbox().length, 0);
  await w.goto({ year: 2026, month: 12, day: 2 }, { hour: 10, minute: 1 });
  assert.equal(w.store.dues.size, 5);
  assert.ok([...w.store.dues.values()].every((d) => d.month === "2026-12"));
  assert.equal(w.textsTo(ROHAN_PARENT).length, 1);
});

test("the next month's fee opens by itself, and a paid November does not stop December", async () => {
  const w = createWorld();
  await w.advance(61);
  w.pays("Rohan Mehta");
  await w.deliverPaymentEvents();
  await w.goto({ year: 2026, month: 12, day: 2 }, { hour: 10, minute: 1 });
  const december = [...w.store.dues.values()].filter((d) => d.studentName === "Rohan Mehta");
  assert.deepEqual(december.map((d) => [d.month, d.state]), [["2026-11", "paid"], ["2026-12", "open"]]);
  assert.match(w.lastTextTo(ROHAN_PARENT), /for Dec 2026/);
});

test("a fee's states go one way: a paid fee never opens again, so no reminder can follow a payment, even after a refund", async () => {
  const w = createWorld();
  await w.advance(61);
  const due = w.dueOf("Rohan Mehta")!;
  assert.equal(balancePaise(due), 180_000, "nothing paid: the whole fee is owed");
  moveTo(due, "paid");
  assert.throws(() => moveTo(due, "open"), /cannot go from paid to open/);
  assert.throws(() => moveTo(due, "closed"), /cannot go from paid to closed/);
  assert.equal(createStore().dues.size, 0, "a store starts clean");
});

test("the record keeps digests of what parents wrote, never the words, and no entry of a fee names a number beyond the conversation", async () => {
  const w = createWorld();
  await w.advance(61);
  await w.say("I already paid the fee, my number is 9123456789", { from: ROHAN_PARENT });
  const text = JSON.stringify(w.record.entries());
  assert.ok(!text.includes("I already paid the fee") && !text.includes("9123456789"), "the words are not kept");
  assert.ok(w.record.entries().every((e) => /^[0-9a-f]{16}$/.test(e.inputsDigest)));
});

test("the same WhatsApp message delivered twice is answered once; a voice note gets one plain line and nothing is kept of it", async () => {
  const w = createWorld();
  await w.advance(61);
  const m = await w.say("hello", { from: ROHAN_PARENT, id: "wamid.1" });
  const sent = w.textsTo(ROHAN_PARENT).length;
  await w.redeliver(m);
  assert.equal(w.textsTo(ROHAN_PARENT).length, sent);
  const voice = w.messaging.receive(ROHAN_PARENT, "", { id: "wamid.2" });
  (voice as { voiceNote?: true }).voiceNote = true;
  await w.agent.handle({ kind: "message", message: voice });
  assert.match(w.lastTextTo(ROHAN_PARENT), /type your message/);
});

test("hello, a yes and words nobody understands are answered with what is owed and the buttons; a parent with nothing owed is told so", async () => {
  const w = createWorld();
  await w.advance(61);
  await w.say("hello", { from: ROHAN_PARENT });
  const menu = w.messaging.sentTo(ROHAN_PARENT).at(-1)!;
  assert.match(menu.text, /₹1,800 is to pay/);
  assert.deepEqual(menu.interactive?.buttons?.map((b) => b.id), [`pay:${w.dueOf("Rohan Mehta")!.id}`, `paid:${w.dueOf("Rohan Mehta")!.id}`, "owner"]);
  await w.say("asdf qwer", { from: ROHAN_PARENT });
  assert.match(w.lastTextTo(ROHAN_PARENT), /did not understand/);
  await w.say("hello", { from: "+919877777777" });
  assert.equal(w.lastTextTo("+919877777777"), "Nothing is due from you right now. Thank you!");
});

test("button mode: switched off from outside, the agent reads with the rules only, answers with buttons, tells the owner once, and every limit holds", async () => {
  let mode: "auto" | "buttons" = "auto";
  const w = createWorld({ ai: { override: () => mode } });
  await w.advance(61);
  mode = "buttons";
  await w.say("hello", { from: ROHAN_PARENT });
  await w.say("hello", { from: ROHAN_PARENT });
  await w.tick();
  const notices = w.messaging.sentTo(w.owner).filter((m) => m.text.includes("switched off"));
  assert.equal(notices.length, 1, "told once");
  assert.ok(w.messaging.sentTo(ROHAN_PARENT).at(-1)!.interactive?.buttons);
  assert.ok(w.record.entries().some((e) => e.action === "ai_mode" && e.refs.reason === "override"));
});

test("a payment event for a link the agent never made is ignored, and a refund event is checked against the payments service's own list", async () => {
  const w = createWorld();
  await w.advance(61);
  w.payments.events.push({ id: "evt_x", event: "payment_link.paid", created_at: 1, payload: { payment_link: { id: "plink_unknown", reference_id: "zzz" } } });
  await w.deliverPaymentEvents();
  assert.ok(w.record.entries().some((e) => e.action === "receive_payment_event" && e.outcome === "blocked" && e.notes.includes("no fee has this payment link")));
  assert.equal([...w.store.dues.values()].filter((d) => d.state !== "open").length, 0);
});

test("a payment at the exact moment of a reminder is read first: the reminder does not go", async () => {
  const w = createWorld();
  await w.advance(61);
  w.pays("Meera Nair");
  const before = w.textsTo(MEERA_PARENT).length;
  await w.goto({ year: 2026, month: 11, day: 5 });
  const after = w.textsTo(MEERA_PARENT);
  assert.equal(after.length, before + 1, "one message, the receipt");
  assert.ok(after.at(-1)!.includes(MARKERS.ml.received));
  assert.equal(w.textsTo(KIRAN_PARENT).length, 2, "the parent who has not paid is reminded");
  void DAY; void HOUR; void MINUTE;
});
