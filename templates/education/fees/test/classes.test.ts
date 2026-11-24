// Classes (the Fees add-on, owner decision 50): the settings block, the timetable and access rules, and the agent's behaviour on the dev harness (consent, the class link at the
// clock, the entitlement check at send time, attendance and the missed-class note, doubts, STOP), the saved state, the reading-material page's read and its folder, the owner's
// page, the report's counts, and the crash-test situations. A centre without the block must behave exactly as Fees does.
import { goSkip } from "../../../../modules/crash-test/go-shop.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MINUTE, zonedToMs } from "../../../../modules/core/time.ts";
import { brightTuition, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings, validateSettings } from "../src/settings.ts";
import { checkClassAccess, checkNoteAfterMark, nextClass, occurrencesBetween } from "../src/classes/rules.ts";
import { isClassLink, readContactWords, readTeacherCommand } from "../src/classes/parse.ts";
import { materialView, ownerClassesView } from "../src/classes/view.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { buildFeesReport } from "../report/data.ts";
import { ownerText } from "../report/text.ts";
import { buildClassSituations } from "../crash-test/classes.ts";
import { runSituation } from "../../../../modules/crash-test/situations.ts";
import { checkChannelEvent } from "../../../../modules/channels/events.ts";

const raw = () => JSON.parse(readFileSync(new URL("../settings/bright-tuition-classes.example.json", import.meta.url), "utf8")) as Record<string, any>;
const classesSettings = () => parseSettings(raw());
const AARAV = "+919811111111"; // a parent (hi): Aarav in class 10, Anaya in class 8
const ROHAN = "+919844444444"; // an adult student (en) in class 10
const LINK = "https://meet.google.com/abc-defg-hij";
const tz = "Asia/Kolkata";
const day = (d: number, h: number, m = 0) => zonedToMs({ year: 2026, month: 11, day: d }, { hour: h, minute: m }, tz);

/** The teacher pastes the class 10 link; the lead window of Monday 2 Nov 17:00 opens (the question goes out); the parent answers yes; the link goes. */
async function agreedMonday(w: World) {
  await w.ownerSays("link class 10 " + LINK);
  w.clock.set(day(2, 16, 31)); await w.tick();
  await w.say("yes", { from: AARAV });
  await w.tick();
}

// ---- settings ------------------------------------------------------------------------------------------------------------------------------------

test("the classes block is read, defaults are filled, and a wrong one is said in plain words", () => {
  const s = classesSettings();
  assert.equal(s.classes!.linkLeadMinutes, 30);
  assert.equal(s.classes!.materialMaxMb, 10);
  assert.deepEqual(s.classes!.timetable["class-10"].map((x) => [x.day, x.hour, x.minute, x.minutes]), [[1, 17, 0, 60], [4, 17, 0, 60]]);
  assert.equal(s.students.find((x) => x.name === "Rohan Mehta")!.adult, true);
  const bad = (change: (r: Record<string, any>) => void) => { const r = raw(); change(r); const v = validateSettings(r); assert.equal(v.ok, false); return v.ok ? "" : v.errors.join("\n"); };
  assert.match(bad((r) => { r.classes.timetable["nope"] = [{ day: "mon", time: "17:00" }]; }), /not one of the batches/u);
  assert.match(bad((r) => { r.classes.timetable["class-9"] = [{ day: "xyz", time: "17:00" }]; }), /needs a day/u);
  assert.match(bad((r) => { r.classes.timetable["class-9"] = [{ day: "mon", time: "25:00" }]; }), /start time/u);
  assert.match(bad((r) => { r.classes.linkLeadMinutes = 2; }), /linkLeadMinutes/u);
  assert.match(bad((r) => { r.classes.materialMaxMb = 0; }), /materialMaxMb/u);
  assert.match(bad((r) => { r.classes.colour = 1; }), /colour/u);
  assert.equal(s.classes!.oldDuesStopLink, false, "left out: an old due does not stop the link");
  assert.match(bad((r) => { r.classes.oldDuesStopLink = "yes"; }), /oldDuesStopLink.*true or false/u, "a non-boolean is refused in plain words");
  assert.match(bad((r) => { r.classes.oldDuesStopLink = 1; }), /oldDuesStopLink/u);
  const strict = raw(); strict.classes.oldDuesStopLink = true;
  assert.equal(parseSettings(strict).classes!.oldDuesStopLink, true);
});

test("a centre without the block is exactly as it was: no classes key, and no Classes code runs", async () => {
  const w = createWorld({ settings: brightTuition() });
  assert.equal("classes" in w.settings, false);
  await w.tick();
  await w.say("when is the next class?", { from: AARAV });
  assert.equal(w.store.classes, undefined, "nothing of Classes is kept");
  assert.ok(!w.record.entries().some((e) => String(e.action).startsWith("class_")));
});

// ---- rules ---------------------------------------------------------------------------------------------------------------------------------------

test("the timetable gives each class once, the next class is the one not yet over, and ids are stable", () => {
  const { classes } = classesSettings();
  const week = occurrencesBetween(classes!, tz, day(2, 0), day(9, 0));
  assert.deepEqual(week.map((o) => o.id), ["class-10@202611021700", "class-8@202611031600", "class-9@202611041630", "class-10@202611051700", "class-8@202611061600"]);
  assert.equal(nextClass(classes!, tz, "class-10", day(2, 17, 30))!.id, "class-10@202611021700", "a class in progress is still next");
  assert.equal(nextClass(classes!, tz, "class-10", day(2, 18, 1))!.id, "class-10@202611051700");
  assert.equal(nextClass(classes!, tz, "no-batch", day(2, 9)), undefined);
});

test("class-access: paid or within the grace days only, with the boundary the late fee uses, and a record that cannot be read sends nothing", () => {
  const due = { year: 2026, month: 11, day: 5 };
  const base = { inBatch: true, consent: "yes" as const, readOk: true, graceDays: 5, timeZone: tz };
  const fee = (balancePaise: number, state: "open" | "paid" | "closed" = "open") => [{ state, dueDate: due, balancePaise }];
  assert.equal(checkClassAccess({ ...base, fees: fee(100_000), nowMs: day(10, 23, 59) }).verdict, "allow", "the last day of the grace days");
  assert.equal(checkClassAccess({ ...base, fees: fee(100_000), nowMs: day(11, 0, 0) }).verdict, "block", "the day the late fee would be added");
  assert.equal(checkClassAccess({ ...base, fees: fee(0, "paid"), nowMs: day(20, 9) }).verdict, "allow");
  assert.equal(checkClassAccess({ ...base, fees: fee(100_000, "closed"), nowMs: day(20, 9) }).verdict, "allow");
  assert.equal(checkClassAccess({ ...base, fees: fee(100_000), nowMs: day(8, 9), readOk: false }).verdict, "block");
  assert.equal(checkClassAccess({ ...base, fees: [], nowMs: day(8, 9), inBatch: false }).verdict, "block");
  assert.equal(checkClassAccess({ ...base, fees: [], nowMs: day(8, 9), consent: "waiting" }).verdict, "block");
  assert.equal(checkClassAccess({ ...base, fees: [], nowMs: day(8, 9), consent: "no" }).verdict, "block");
  assert.equal(checkClassAccess({ ...base, fees: [], nowMs: day(8, 9), consent: "adult" }).verdict, "allow");
  assert.equal(checkNoteAfterMark({ mark: "absent", closed: true }).verdict, "allow");
  assert.equal(checkNoteAfterMark({ mark: "absent", closed: false }).verdict, "block");
  assert.equal(checkNoteAfterMark({ mark: "present", closed: true }).verdict, "block");
  assert.equal(checkNoteAfterMark({ mark: undefined, closed: true }).verdict, "block");
});

test("the class words and the teacher's commands are read by fixed lists; STOP and fee words are never taken", () => {
  const ask = (t: string, consentPending = false) => readContactWords(t, { consentPending });
  assert.deepEqual(ask("when is the next class?"), { kind: "next" });
  assert.deepEqual(ask("अगली क्लास कब है"), { kind: "next" });
  assert.deepEqual(ask("please send the notes"), { kind: "material" });
  assert.deepEqual(ask("doubt"), { kind: "doubt" });
  assert.deepEqual(ask("Doubt: how do I solve 2x + 3 = 11?"), { kind: "doubt", text: "how do I solve 2x + 3 = 11?" });
  assert.deepEqual(ask("yes", true), { kind: "consent", answer: "yes" });
  assert.equal(ask("yes", false), null);
  assert.equal(ask("STOP", true), null);
  assert.equal(ask("I want to pay the fee"), null);
  assert.deepEqual(readTeacherCommand("link class 10 https://zoom.us/j/123?pwd=a"), { kind: "link", batch: "class 10", which: "batch", url: "https://zoom.us/j/123?pwd=a" });
  assert.deepEqual(readTeacherCommand("link class-9 next https://meet.google.com/x-y"), { kind: "link", batch: "class-9", which: "next", url: "https://meet.google.com/x-y" });
  assert.deepEqual(readTeacherCommand("absent 2, 5"), { kind: "absent", numbers: [2, 5] });
  assert.deepEqual(readTeacherCommand("present"), { kind: "present" });
  assert.deepEqual(readTeacherCommand("link class 10 http://not-https.example/x"), { kind: "bad" });
  assert.equal(readTeacherCommand("approve q-3"), null);
  assert.equal(isClassLink("https://meet.example/x."), false, "a link ending in punctuation is not one the check could read");
  assert.equal(isClassLink("https://meet.example"), false, "a link with no path is not one the check can allow");
});

// ---- the agent -------------------------------------------------------------------------------------------------------------------------------------

test("the first message asks consent, nothing else of Classes goes before the answer, then the link goes once, shortly before the class", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await w.ownerSays(`link class 10 ${LINK}`);
  assert.match(w.lastTextTo(w.owner), /class link for class 10 is saved/u);
  w.clock.set(day(2, 16, 20)); await w.tick();
  assert.equal(w.messaging.sentTo(ROHAN).filter((m) => m.text.includes(LINK)).length, 0, "before the lead window");
  w.clock.set(day(2, 16, 31)); await w.tick();
  assert.equal(w.messaging.sentTo(AARAV).filter((m) => m.text.includes(LINK)).length, 0, "no link before the contact agreed");
  assert.ok(w.record.entries().some((e) => e.action === "class_consent" && e.conversation === AARAV), "the first question was asked");
  assert.equal(w.messaging.sentTo(ROHAN).filter((m) => m.text.includes(LINK)).length, 1, "an adult student needs no consent: their link went");
  await w.say("yes", { from: AARAV });
  await w.tick();
  await w.tick();
  assert.equal(w.messaging.sentTo(AARAV).filter((m) => m.text.includes(LINK)).length, 1, "once, however often the clock beats");
  const sent = w.record.entries().find((e) => e.conversation === AARAV && e.refs.templates === "class_link")!;
  assert.ok(sent.decisions.some((d) => d.ruleId === "class-access" && d.verdict === "allow"), "the access decision is recorded beside the message");
});

test("class-access and a back due: by default only ordinary fees decide; with oldDuesStopLink a back due blocks like any fee; waived or paid changes nothing", () => {
  const base = { inBatch: true, consent: "yes" as const, readOk: true, graceDays: 5, timeZone: tz, nowMs: day(12, 9) };
  const old = (state: "open" | "paid" | "closed" = "open") => ({ state, dueDate: { year: 2026, month: 9, day: 1 }, balancePaise: state === "open" ? 90_000 : 0, backDue: true });
  const ordinary = { state: "open" as const, dueDate: { year: 2026, month: 11, day: 5 }, balancePaise: 180_000 };
  const inGrace = { ...ordinary, dueDate: { year: 2026, month: 11, day: 10 } };
  // only a back due is unpaid: the link and the material go by default, and the record says why
  const byDefault = checkClassAccess({ ...base, fees: [old(), inGrace] });
  assert.equal(byDefault.verdict, "allow");
  assert.match(byDefault.reason, /old due does not stop the class link/u);
  assert.equal(checkClassAccess({ ...base, oldDuesStopLink: false, fees: [old()] }).verdict, "allow");
  // the centre asked for the stricter rule: the same back due now blocks, and the reason names it
  const strict = checkClassAccess({ ...base, oldDuesStopLink: true, fees: [old(), inGrace] });
  assert.equal(strict.verdict, "block");
  assert.match(strict.reason, /old due/u);
  // an ordinary fee past its grace days blocks in both cases
  assert.equal(checkClassAccess({ ...base, fees: [old(), ordinary] }).verdict, "block");
  assert.equal(checkClassAccess({ ...base, oldDuesStopLink: true, fees: [old(), ordinary] }).verdict, "block");
  // a paid or waived (closed) back due changes nothing either way
  for (const state of ["paid", "closed"] as const) {
    assert.equal(checkClassAccess({ ...base, fees: [old(state), inGrace] }).verdict, "allow");
    assert.equal(checkClassAccess({ ...base, oldDuesStopLink: true, fees: [old(state), inGrace] }).verdict, "allow");
  }
});

test("a back due and the class link, end to end: it goes by default, is held with oldDuesStopLink, and the back due is still opened and reminded", async () => {
  const run = async (stop: boolean) => {
    const r = raw(); r.classes.oldDuesStopLink = stop;
    r.students = r.students.map((x: any) => (x.name === "Rohan Mehta" ? { ...x, backDues: [{ month: "2026-09", amountInr: 900 }] } : x));
    const w = createWorld({ settings: parseSettings(r) });
    await w.tick();
    await w.ownerSays(`link class 10 ${LINK}`);
    w.clock.set(day(2, 16, 31)); await w.tick(); await w.tick();
    const back = [...w.store.dues.values()].find((d) => d.studentName === "Rohan Mehta" && d.backDue);
    assert.ok(back && back.state === "open" && back.lateFeeInr === 0, "the back due is opened, open, and never given a late fee");
    const linked = w.messaging.sentTo(ROHAN).filter((m) => m.text.includes(LINK)).length;
    // the material page reads the same rule from the saved state
    const material = materialView(w.settings, w.store, ROHAN, "class-10", day(2, 16, 31));
    return { linked, material };
  };
  const byDefault = await run(false);
  assert.equal(byDefault.linked, 1, "a student whose only unpaid fee is a back due gets the class link");
  assert.ok(byDefault.material, "and the reading material");
  const strict = await run(true);
  assert.equal(strict.linked, 0, "with oldDuesStopLink the same student gets neither");
  assert.equal(strict.material, null);
});

test("a student whose fee is past its grace days gets no link, and gets it after paying (the record is read again at send time)", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await w.ownerSays(`link class 10 ${LINK}`);
  const start = day(12, 16, 31); // Thursday 12 Nov: a class 10 class day, after the grace days of November's fee
  w.clock.set(start); await w.tick();
  const count = () => w.messaging.sentTo(ROHAN).filter((m) => m.text.includes(LINK)).length;
  assert.equal(count(), 0);
  assert.ok(w.record.entries().some((e) => e.action === "class_access" && e.outcome === "blocked" && e.conversation === ROHAN));
  const blocked = w.record.entries().filter((e) => e.action === "class_access" && e.conversation === ROHAN).length;
  await w.tick();
  assert.equal(w.record.entries().filter((e) => e.action === "class_access" && e.conversation === ROHAN).length, blocked, "the line is written once, not at every beat");
  w.pays("Rohan Mehta"); await w.deliverPaymentEvents();
  w.clock.set(start + 6 * MINUTE); await w.tick();
  assert.equal(count(), 1);
});

test("a link changed before sending is the one sent; one changed after sending is sent once more, each link once", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await w.ownerSays(`link class 10 ${LINK}`);
  await w.ownerSays("link class 10 https://meet.example/changed-link");
  w.clock.set(day(2, 16, 31)); await w.tick();
  const rohan = () => w.messaging.sentTo(ROHAN).map((m) => m.text);
  assert.ok(rohan().some((t) => t.includes("changed-link")) && !rohan().some((t) => t.includes("abc-defg")));
  await w.ownerSays(`link class 10 ${LINK}`);
  await w.tick();
  await w.tick();
  assert.equal(rohan().filter((t) => t.includes("abc-defg")).length, 1);
  assert.equal(rohan().filter((t) => t.includes("changed-link")).length, 1);
});

test("attendance: asked once after the class, marked by numbers, the note goes only to a student marked absent and only after that", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await agreedMonday(w);
  w.clock.set(day(2, 18, 5)); await w.tick();
  const asks = () => w.record.entries().filter((e) => e.conversation === w.owner && e.refs.templates === "owner_class_attendance");
  assert.equal(asks().length, 1);
  await w.tick();
  assert.equal(asks().length, 1, "asked once");
  assert.equal(w.record.entries().filter((e) => e.refs.templates === "class_missed_note").length, 0, "no note before the teacher marks");
  await w.ownerSays("class");
  assert.match(w.lastTextTo(w.owner), /1 Aarav Sharma, 2 Rohan Mehta/u);
  await w.ownerSays("absent 9");
  assert.match(w.lastTextTo(w.owner), /could not read/u, "a number off the list does nothing");
  await w.ownerSays("absent 2");
  assert.match(w.lastTextTo(w.owner), /1 present, 1 absent/u);
  assert.equal(w.record.entries().filter((e) => e.conversation === ROHAN && e.refs.templates === "class_missed_note").length, 1);
  assert.equal(w.record.entries().filter((e) => e.conversation === AARAV && e.refs.templates === "class_missed_note").length, 0, "a student marked present is not told");
  const [entry] = w.record.entries().filter((e) => e.action === "class_attendance");
  assert.equal(entry.refs.present, "1");
  await w.tick();
  await w.ownerSays("absent 2");
  assert.equal(w.record.entries().filter((e) => e.refs.templates === "class_missed_note").length, 1, "never twice");
});

test("one tap: the Everyone came button confirms the class and sends no note", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await agreedMonday(w);
  w.clock.set(day(2, 18, 5)); await w.tick();
  await w.ownerSays("class");
  await w.tap("cls:att:class-10@202611021700:all", { from: w.owner });
  assert.equal(w.record.entries().filter((e) => e.action === "class_attendance").length, 1);
  assert.equal(w.record.entries().filter((e) => e.refs.templates === "class_missed_note").length, 0);
});

test("a doubt is collected and handed to the teacher; the agent never answers it; STOP is not a doubt", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await w.say("doubt", { from: AARAV });
  assert.match(w.lastTextTo(AARAV), /एक ही संदेश/u);
  await w.say("how do I solve 2x + 3 = 11", { from: AARAV });
  assert.equal(w.store.classes!.doubts.length, 1);
  assert.equal(w.store.classes!.doubts[0].text, "how do I solve 2x + 3 = 11");
  await w.tick();
  assert.match(w.lastTextTo(w.owner), /Doubts waiting/u);
  await w.ownerSays("doubts");
  assert.match(w.lastTextTo(w.owner), /2x \+ 3 = 11/u, "the teacher reads it, digits and all");
  assert.ok(!w.textsTo(AARAV).some((t) => /x = 4/u.test(t)), "no subject answer");
  await w.ownerSays(`answered ${w.store.classes!.doubts[0].id}`);
  assert.equal(w.store.classes!.doubts[0].state, "answered");
  await w.say("doubt", { from: AARAV });
  await w.say("STOP", { from: AARAV });
  assert.equal(w.store.classes!.doubts.length, 1, "STOP is never taken as a doubt");
  assert.equal(w.messaging.isOptedOut(AARAV), true);
});

test("when is the next class: answered from the timetable, in the parent's language, for each child", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await w.say("when is the next class?", { from: AARAV });
  const text = w.lastTextTo(AARAV);
  assert.match(text, /Aarav Sharma/u);
  assert.match(text, /Anaya Sharma/u);
  assert.match(text, /सोमवार, 2 नवंबर/u);
});

test("STOP means STOP: a contact who stopped is sent no class link and no question", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await w.say("STOP", { from: AARAV });
  const before = w.messaging.sentTo(AARAV).length;
  await w.ownerSays(`link class 10 ${LINK}`);
  w.clock.set(day(2, 16, 31)); await w.tick();
  assert.equal(w.messaging.sentTo(AARAV).length, before);
});

test("the saved state keeps Classes between steps", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await agreedMonday(w);
  const back = parseStore(serializeStore(w.store));
  assert.deepEqual(back.classes, w.store.classes);
  assert.ok(Object.keys(back.classes!.sessions).length > 0);
});

// ---- material, owner's page, report, crash test -----------------------------------------------------------------------------------------------------

test("the reading-material page opens only for a student in the batch, who agreed and whose fee is paid or within the grace days", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await agreedMonday(w);
  const s = w.settings;
  assert.ok(materialView(s, w.store, AARAV, "class-10", day(3, 9)));
  assert.equal(materialView(s, w.store, AARAV, "class-9", day(3, 9)), null, "no student of theirs in that batch");
  assert.equal(materialView(s, w.store, undefined, "class-10", day(3, 9)), null, "a link no one has");
  assert.equal(materialView({ ...s, students: s.students.filter((x) => x.name !== "Aarav Sharma") }, w.store, AARAV, "class-10", day(3, 9)), null, "removed from the batch");
  assert.equal(materialView(s, w.store, AARAV, "class-10", day(12, 9)), null, "past the grace days with the fee unpaid");
  assert.equal(materialView(brightTuition(), w.store, AARAV, "class-10", day(3, 9)), null, "a centre without Classes");
});

test("the owner's page lists the class waiting for attendance and the doubt, and a press is bound to its digest", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await agreedMonday(w);
  await w.say("doubt: what is a prime number", { from: AARAV });
  w.clock.set(day(2, 18, 5)); await w.tick();
  const view = ownerClassesView(w.settings, w.store, w.clock.now())!;
  assert.equal(view.pending.length, 1);
  assert.equal(view.doubts.length, 1);
  const c = view.pending[0];
  assert.equal(checkChannelEvent({ kind: "owner_action", id: "a-1", action: "absent", case: `${c.case}.2`, digest: c.digest }).ok, true);
  await w.agent.handle({ kind: "owner_action", id: "a-1", action: "absent", case: `${c.case}.2`, digest: "0".repeat(32) });
  assert.equal(ownerClassesView(w.settings, w.store, w.clock.now())!.pending[0].students[1].missed, false, "a wrong digest does nothing");
  await w.agent.handle({ kind: "owner_action", id: "a-2", action: "absent", case: `${c.case}.2`, digest: c.digest });
  const after = ownerClassesView(w.settings, w.store, w.clock.now())!.pending[0];
  assert.equal(after.students[1].missed, true);
  assert.notEqual(after.digest, c.digest, "the digest follows what is shown");
  await w.agent.handle({ kind: "owner_action", id: "a-3", action: "present", case: c.case, digest: c.digest });
  assert.equal(w.store.classes!.sessions["class-10@202611021700"].closedAtMs, undefined, "an old digest does nothing");
  await w.agent.handle({ kind: "owner_action", id: "a-4", action: "present", case: after.case, digest: after.digest });
  assert.ok(w.store.classes!.sessions["class-10@202611021700"].closedAtMs);
  assert.equal(w.record.entries().filter((e) => e.conversation === ROHAN && e.refs.templates === "class_missed_note").length, 1);
  const d = ownerClassesView(w.settings, w.store, w.clock.now())!.doubts[0];
  await w.agent.handle({ kind: "owner_action", id: "a-5", action: "answered", case: d.case, digest: d.digest });
  assert.equal(ownerClassesView(w.settings, w.store, w.clock.now())!.doubts.length, 0);
});

test("the monthly report counts classes held, links sent, students marked, notes and doubts; a Fees centre's report has none of it", async () => {
  const w = createWorld({ settings: classesSettings() });
  await w.tick();
  await agreedMonday(w);
  await w.say("doubt: what is a prime number", { from: AARAV });
  w.clock.set(day(2, 18, 5)); await w.tick();
  await w.ownerSays("absent 2");
  const from = zonedToMs({ year: 2026, month: 11, day: 1 }, { hour: 0, minute: 0 }, tz);
  const to = zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 0, minute: 0 }, tz);
  const report = buildFeesReport({ settings: w.settings, entries: w.record.entries(), dues: [...w.store.dues.values()], from, to, source: "stand-in", madeAt: to });
  assert.deepEqual(report.classes, { held: 1, linksSent: 2, attendanceMarked: 2, missedNotes: 1, doubts: 1 });
  assert.match(ownerText(report, "en"), /Classes held: 1/u);
  const plain = buildFeesReport({ settings: brightTuition(), entries: [], dues: [], from, to, source: "stand-in", madeAt: to });
  assert.equal("classes" in plain, false);
  assert.doesNotMatch(ownerText(plain, "en"), /Classes held/u);
});

test("the crash-test situations of Classes hold", { skip: goSkip("fees") }, async () => {
  const list = buildClassSituations(classesSettings());
  assert.equal(list.length, 5);
  for (const situation of list) {
    const result = await runSituation(situation);
    assert.ok(result.held, `${situation.id}: ${result.checks.filter((c) => !c.passed).map((c) => `${c.label} ${c.detail}`).join("; ")}`);
  }
  assert.equal(buildClassSituations(brightTuition()).length, 0, "a Fees centre has none");
});
