// A student who joins mid-month (the centre's rule), back dues carried as fees of their own, and one reminder for a parent with several open fees (17 Nov 2026).
// Run on the example centre and its in-memory stand-ins (src/harness.ts). What these tests keep true: the default rule changes nothing; a part month is priced by the
// centre's rule and not chased before the student came; a late fee never lands on a fee the day the student arrives or on a back due; a parent with two open fees gets
// ONE message, every fee on its own line with its OWN link, and a payment on one link is counted on that fee only; a paid fee is not listed again; STOP is STOP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { ROHAN_PARENT, SHARMA_PARENT, createWorld } from "../src/harness.ts";
import { feeForMonth, parseJoined } from "../src/joining.ts";
import { parseSettings, validateSettings } from "../src/settings.ts";

const raw = () => JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8")) as Record<string, any>;
/** The example centre with a change to Rohan Mehta's row (class 10, ₹1,800 a month) and, optionally, a rule for a part month. */
function withRohan(change: Record<string, unknown>, rule?: string) {
  const r = raw();
  r.students = r.students.map((s: any) => (s.name === "Rohan Mehta" ? { ...s, ...change } : s));
  if (rule) r.joiningMidMonth = rule;
  return parseSettings(r);
}
const at = (month: number, day: number, hour = 11) => zonedToMs({ year: 2026, month, day }, { hour, minute: 0 }, "Asia/Kolkata");
const rohanDues = (w: ReturnType<typeof createWorld>) => [...w.store.dues.values()].filter((d) => d.studentName === "Rohan Mehta");

test("the part-month sum: usual ignores the day, full and prorata price it, nextMonth starts next month, and months around the joining month are plain", () => {
  const joined = parseJoined("2026-11-20")!;
  assert.deepEqual(feeForMonth("usual", 1800, joined, 2026, 11), { owed: true, feeInr: 1800 });
  assert.deepEqual(feeForMonth("full", 1800, joined, 2026, 11), { owed: true, feeInr: 1800, part: { rule: "full", joined: "2026-11-20", days: 11, daysInMonth: 30 } });
  assert.deepEqual(feeForMonth("prorata", 1800, joined, 2026, 11), { owed: true, feeInr: 660, part: { rule: "prorata", joined: "2026-11-20", days: 11, daysInMonth: 30 } });
  assert.deepEqual(feeForMonth("nextMonth", 1800, joined, 2026, 11), { owed: false, why: "next_month" });
  assert.deepEqual(feeForMonth("prorata", 1800, joined, 2026, 12), { owed: true, feeInr: 1800 }, "the month after is the whole fee");
  assert.deepEqual(feeForMonth("prorata", 1800, joined, 2026, 10), { owed: false, why: "not_joined_yet" }, "nothing before the student came");
  assert.deepEqual(feeForMonth("prorata", 1800, parseJoined("2026-11-01")!, 2026, 11), { owed: true, feeInr: 1800 }, "joined on the 1st: not a part month");
  assert.equal((feeForMonth("prorata", 1, parseJoined("2026-11-30")!, 2026, 11) as { feeInr: number }).feeInr, 1, "never below one rupee");
  assert.equal(parseJoined("2026-02-30"), undefined);
  assert.equal(parseJoined("20-11-2026"), undefined);
});

test("settings: the new keys are checked in plain words, and a centre that sets none keeps the settings it had", () => {
  assert.equal("joiningMidMonth" in parseSettings(raw()), false, "the default is not written into the settings");
  const bad = (change: (r: Record<string, any>) => void) => { const r = raw(); change(r); const v = validateSettings(r); return v.ok ? [] : v.errors.join(" "); };
  assert.match(String(bad((r) => { r.joiningMidMonth = "half"; })), /joiningMidMonth/u);
  assert.match(String(bad((r) => { r.students[0].joined = "2026-13-01"; })), /joining day/u);
  assert.match(String(bad((r) => { r.students[0].backDues = [{ month: "2026-9", amountInr: 100 }]; })), /backDues/u);
  assert.match(String(bad((r) => { r.students[0].backDues = [{ month: "2026-09", amountInr: 99_999 }]; })), /backDues/u, "above the batch's fee a payment link could not be made");
  assert.match(String(bad((r) => { r.students[0].backDues = [{ month: "2026-09", amountInr: 100 }, { month: "2026-09", amountInr: 200 }]; })), /twice/u);
  const ok = parseSettings({ ...raw(), joiningMidMonth: "prorata" });
  assert.equal(ok.joiningMidMonth, "prorata");
});

test("joiningMidMonth prorata: a student who joins on the 20th, first seen on the 25th, is charged the 11 days left, once, due on the joining day, with no late fee yet", async () => {
  const w = createWorld({ settings: withRohan({ joined: "2026-11-20" }, "prorata"), nowMs: at(11, 25) });
  await w.tick();
  const dues = rohanDues(w);
  assert.equal(dues.length, 1, "only the new student: the other months were never chased (the agent first ran on the 25th)");
  assert.equal(w.store.dues.size, 1);
  assert.equal(dues[0].feeInr, 660);
  assert.equal(dues[0].dueDate.day, 20, "due on the day they joined, because the usual due day (the 5th) had gone");
  assert.equal(dues[0].lateFeeInr, 0);
  assert.deepEqual(dues[0].partMonth, { rule: "prorata", joined: "2026-11-20", days: 11, daysInMonth: 30 });
  assert.equal(w.textsTo(ROHAN_PARENT).length, 1, "the reminders that had passed go as one message");
  assert.match(w.lastTextTo(ROHAN_PARENT), /₹660/u);
  assert.equal(w.linkFor("Rohan Mehta")!.amount, 66_000, "the payment link is for exactly the part-month fee");
  await w.tick();
  assert.equal(w.store.dues.size, 1, "a second beat opens nothing twice");
  await w.goto({ year: 2026, month: 11, day: 27 });
  assert.equal(rohanDues(w)[0].lateFeeInr, 100, "the grace days counted from the joining day, then the late fee came");
});

test("joiningMidMonth full: the whole fee for the joining month", async () => {
  const w = createWorld({ settings: withRohan({ joined: "2026-11-20" }, "full"), nowMs: at(11, 25) });
  await w.tick();
  assert.equal(rohanDues(w)[0].feeInr, 1800);
  assert.equal(rohanDues(w)[0].partMonth?.rule, "full");
});

test("joiningMidMonth nextMonth: nothing for the joining month, the whole fee from the next", async () => {
  const w = createWorld({ settings: withRohan({ joined: "2026-11-20" }, "nextMonth"), nowMs: at(11, 25) });
  await w.tick();
  assert.equal(w.store.dues.size, 0);
  await w.goto({ year: 2026, month: 12, day: 2 });
  assert.deepEqual(rohanDues(w).map((d) => [d.month, d.feeInr]), [["2026-12", 1800]]);
});

test("the default rule changes nothing: a joined date is ignored, and a month whose first reminder day came before the agent first ran is still not chased", async () => {
  const w = createWorld({ settings: withRohan({ joined: "2026-11-20" }), nowMs: at(11, 25) });
  await w.tick();
  assert.equal(w.store.dues.size, 0, "exactly as before the rule existed");
  const same = createWorld({ settings: parseSettings(raw()), nowMs: at(11, 25) });
  await same.tick();
  assert.equal(same.store.dues.size, 0);
});

test("a student who has not joined yet is not charged for a month they were not there", async () => {
  const w = createWorld({ settings: withRohan({ joined: "2026-12-10" }, "prorata") });
  await w.tick();
  await w.advance(61);
  assert.equal(rohanDues(w).length, 0, "November: the other students are opened, Rohan is not");
  assert.equal(w.store.dues.size, 4);
});

test("back dues: an earlier unpaid month is carried as a fee of its own and listed with this month's in one message; each is paid on its own link; a paid one is not listed again", async () => {
  const w = createWorld({ settings: withRohan({ backDues: [{ month: "2026-09", amountInr: 900 }] }) });
  await w.tick();
  await w.advance(61); // 10:00 on the 2nd: the first reminder day
  const dues = rohanDues(w);
  assert.deepEqual(dues.map((d) => [d.month, d.feeInr, !!d.backDue]), [["2026-09", 900, true], ["2026-11", 1800, false]]);
  const texts = w.textsTo(ROHAN_PARENT);
  assert.equal(texts.length, 1, "one message");
  const [sept, nov] = dues;
  assert.ok(texts[0].includes(w.payments.links().find((l) => l.id === sept.currentLinkId)!.pay_url) && texts[0].includes(w.payments.links().find((l) => l.id === nov.currentLinkId)!.pay_url), "each fee has its own link in it");
  assert.match(texts[0], /Sep 2026: ₹900/u);
  assert.match(texts[0], /Nov 2026: ₹1,800/u);
  assert.equal(w.messaging.sentTo(ROHAN_PARENT)[0].templateName, "fee_reminder_family");
  assert.equal(sept.lateFeeInr, 0);

  // the parent pays the September link only: that fee is paid and November is untouched
  w.payments.customerPays(sept.currentLinkId!);
  await w.deliverPaymentEvents();
  assert.equal(sept.state, "paid");
  assert.equal(nov.state, "open");
  assert.equal(nov.payments.length, 0, "the payment was allocated to the fee its link is for");
  await w.goto({ year: 2026, month: 11, day: 5 });
  assert.equal(sept.lateFeeInr, 0);
  const last = w.lastTextTo(ROHAN_PARENT);
  assert.match(last, /Nov 2026/u);
  assert.doesNotMatch(last, /Sep 2026/u, "no reminder for a period already paid");
});

test("back dues are opened once, not again on every beat", async () => {
  const w = createWorld({ settings: withRohan({ backDues: [{ month: "2026-09", amountInr: 900 }] }) });
  await w.tick();
  await w.advance(61);
  const before = w.store.dues.size;
  await w.advance(60);
  await w.goto({ year: 2026, month: 11, day: 3 });
  assert.equal(w.store.dues.size, before);
});

test("one message about two children: the Sharmas get one reminder with each child's fee and each child's own link", async () => {
  const w = createWorld();
  await w.tick();
  await w.advance(61);
  const texts = w.textsTo(SHARMA_PARENT);
  assert.equal(texts.length, 1);
  for (const name of ["Aarav Sharma", "Anaya Sharma"]) assert.ok(texts[0].includes(name), name);
  for (const name of ["Aarav Sharma", "Anaya Sharma"]) assert.ok(texts[0].includes(w.linkFor(name)!.pay_url), `${name}'s own link`);
  assert.equal(w.messaging.sentTo(SHARMA_PARENT)[0].templateName, "fee_reminder_family", "outside the 24-hour window it goes as the approved template");
  assert.equal(w.textsTo(ROHAN_PARENT).length, 1, "a parent with one child is reminded exactly as before");
  assert.ok(w.record.entries().every((e) => e.action !== "send_message" || e.outcome === "confirmed"), "the outgoing check passed every message");
  assert.equal(w.dueOf("Aarav Sharma")!.remindersSent, 1);
  assert.equal(w.dueOf("Anaya Sharma")!.remindersSent, 1, "the reminder counts for both fees, so the cap holds for each");
});

test("payment allocation stays exact: a payment on one child's link is that child's, and the next reminder lists only the child still owing", async () => {
  const w = createWorld();
  await w.tick();
  await w.advance(61);
  w.pays("Aarav Sharma");
  await w.deliverPaymentEvents();
  assert.equal(w.dueOf("Aarav Sharma")!.state, "paid");
  assert.equal(w.dueOf("Anaya Sharma")!.payments.length, 0);
  await w.goto({ year: 2026, month: 11, day: 5 });
  const last = w.lastTextTo(SHARMA_PARENT);
  assert.ok(last.includes("Anaya Sharma") && last.includes(w.linkFor("Anaya Sharma")!.pay_url));
  assert.ok(!last.includes("Aarav Sharma"), "the paid child is not in it");
});

test("STOP is STOP: a parent who stopped gets no family reminder", async () => {
  const w = createWorld();
  await w.tick();
  await w.advance(61);
  await w.say("STOP", { from: SHARMA_PARENT });
  const before = w.textsTo(SHARMA_PARENT).length;
  await w.goto({ year: 2026, month: 11, day: 5 });
  assert.equal(w.textsTo(SHARMA_PARENT).length, before);
});

test("a centre with a page: the one reminder carries the parent's private page too, and keeps only its hash", async () => {
  const w = createWorld({ pageBase: () => "https://pages.example/bright-tuition" });
  await w.tick();
  await w.advance(61);
  const sent = w.messaging.sentTo(SHARMA_PARENT);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateName, "fee_reminder_family_page");
  const page = /https:\/\/pages\.example\/bright-tuition\/f\/([A-Za-z0-9_-]{32})/u.exec(sent[0].text)?.[1];
  assert.ok(page);
  assert.ok(!JSON.stringify(w.store).includes(page!), "never the link itself in the saved state");
  assert.ok(w.store.parentLinks![SHARMA_PARENT].hash);
});
