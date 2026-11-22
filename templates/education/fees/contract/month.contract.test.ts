// A UPI centre's month on the test clock (fakes mode): November's fees open at the first reminder moment and not before, every parent gets ONE reminder (a family with two
// children one message that lists both), each with the parent's private page; the reminders follow the centre's days and words (before the due day, on it, overdue, overdue with
// the late fee) and stop at the month's cap; the late fee is added once after the grace days; STOP ends every message to that parent and no late fee is added for them; the day
// the agent first ran survives a restart (a process down over the reminder moment still reminds), and a month whose first reminder day was before that is not chased; after a
// restore the fee ids move on by 100000. Observed through the record (agent.db), /status and the owner's page only.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { KIRAN, MEERA, OWNER_NUMBER, ROHAN, SHARMA, at, contract, lines, makeCentre, sends, sleep } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });
async function boot(o: CentreOptions = {}): Promise<Centre> { const c = await makeCentre(o); centres.push(c); await c.start(); return c; }

/** The messages to parents (not the owner) and their template ids, for one parent. */
const toParent = (c: Centre, phone: string): string[] => sends(c, phone).filter((l) => l.refs.to === "customer" && l.outcome === "confirmed").map((l) => l.refs.templates);
const reminderIds = (c: Centre, phone: string): string[] => toParent(c, phone).filter((t) => /^fee_(reminder|overdue)/u.test(t));

/** Start on Mon 2 Nov at 09:00, let the first beat note the day, then go to 10:00 and wait for the five fees and four reminders. */
async function november(o: CentreOptions = {}): Promise<Centre> {
  const c = await boot(o);
  await c.started();
  c.goto(at(2, 10, 0) + 1000);
  await c.waitFor(() => lines(c, "open_fee").length === 5 && [SHARMA, MEERA, KIRAN, ROHAN].every((p) => reminderIds(c, p).length === 1), "five fees opened and four parents reminded");
  return c;
}

describe("the month's fees open on the first reminder day and the reminders go out", () => {
  contract("nothing opens before the first reminder moment; at 10:00 on the 2nd five fees open and each parent gets ONE reminder with their private page", async () => {
    const c = await boot();
    await sleep(2500); // two beats at 09:00
    assert.equal(lines(c, "open_fee").length, 0, "nothing opens at 09:00: the reminder hour is 10:00");
    assert.equal(c.record().length, 0, "a quiet beat writes nothing to the record");
    c.goto(at(2, 10, 0) + 1000);
    await c.waitFor(() => [SHARMA, MEERA, KIRAN, ROHAN].every((p) => reminderIds(c, p).length === 1), "four parents reminded");
    const opened = lines(c, "open_fee", "confirmed");
    assert.deepEqual(opened.map((l) => l.booking), ["f-1", "f-2", "f-3", "f-4", "f-5"], "one fee per student, in the settings' order");
    assert.deepEqual(opened.map((l) => l.refs.month), Array(5).fill("2026-11"));
    assert.deepEqual(opened.map((l) => l.refs.amountPaise), ["180000", "120000", "150000", "120000", "180000"]);
    assert.deepEqual((await c.status()).fees, { open: 5 });
    assert.deepEqual(reminderIds(c, SHARMA), ["fee_reminder_family_page"], "two children, one message that lists both, with the page");
    for (const p of [MEERA, KIRAN, ROHAN]) assert.deepEqual(reminderIds(c, p), ["fee_reminder_page"]);
    // a UPI centre: a request for exactly what is owed per fee, and the owner told what to look for, with the code (the code is never in the record)
    assert.equal(lines(c, "upi_request", "confirmed").length, 5);
    assert.deepEqual(lines(c, "create_fee_link", "confirmed").map((l) => l.refs.reference), ["f-1.1", "f-2.1", "f-3.1", "f-4.1", "f-5.1"]);
    assert.equal(sends(c).filter((l) => l.refs.to === "owner" && l.refs.templates === "owner_fee_upi_expected").length, 5);
    // each parent's private link was kept (its hash only), once
    assert.equal(lines(c, "parent_link", "confirmed").length, 4);
    assert.deepEqual(new Set(lines(c, "parent_link").map((l) => l.conversation)), new Set([SHARMA, MEERA, KIRAN, ROHAN]));
    // the reminder passed the limits: the record was read (no reminder once paid) and the month's cap
    const rohan = sends(c, ROHAN).find((l) => l.refs.templates === "fee_reminder_page")!;
    assert.deepEqual(rohan.decisions.filter((d) => d.verdict !== "allow"), []);
    assert.ok(rohan.decisions.some((d) => d.ruleId === "no-reminder-once-paid"));
    assert.ok(rohan.decisions.some((d) => d.ruleId === "reminder-cap"));
  });

  contract("the reminders follow the centre's days and words, the late fee is added once after the grace days, and the month's cap holds", async () => {
    const c = await november();
    c.goto(at(5, 10, 0) + 1000); // the due day
    await c.waitFor(() => reminderIds(c, ROHAN).length === 2, "the due day's reminder");
    c.goto(at(10, 10, 0) + 1000); // five days after: overdue, no late fee yet (the grace days run to the end of the 10th)
    await c.waitFor(() => reminderIds(c, ROHAN).length === 3, "the overdue reminder");
    assert.equal(lines(c, "add_late_fee").length, 0, "no late fee within the grace days");
    c.goto(at(11, 0, 0) + 1000); // the grace days are over
    await c.waitFor(() => lines(c, "add_late_fee", "confirmed").length === 5, "the late fee on all five fees");
    assert.deepEqual(lines(c, "add_late_fee").map((l) => l.refs.amountPaise), Array(5).fill("10000"));
    c.goto(at(15, 10, 0) + 1000);
    await c.waitFor(() => reminderIds(c, ROHAN).length === 4, "the overdue reminder with the late fee");
    assert.deepEqual(reminderIds(c, ROHAN), ["fee_reminder_page", "fee_reminder_page", "fee_overdue_page", "fee_overdue_late_page"]);
    c.goto(at(20, 10, 0) + 1000);
    await sleep(2500);
    assert.equal(reminderIds(c, ROHAN).length, 4, "at most four reminders for one fee in a month");
    assert.equal(lines(c, "add_late_fee").length, 5, "the late fee is added once");
    // a late fee changes what is owed, so the request for the old amount was replaced by one for the new
    assert.ok(lines(c, "create_fee_link", "confirmed").some((l) => l.booking === "f-5" && l.refs.amountPaise === "190000"));
  });

  contract("STOP ends every message to that parent (the owner is told), no late fee is added for them, and the others go on", async () => {
    const c = await november();
    const a = await c.inbound(ROHAN, "STOP");
    assert.equal(a.status, 200);
    assert.equal(lines(c, "opt_out", "confirmed").length, 1);
    assert.ok(sends(c).some((l) => l.refs.to === "owner" && l.refs.templates === "owner_opted_out"));
    const before = toParent(c, ROHAN).length;
    await c.inbound(ROHAN, "hello?");
    c.goto(at(5, 10, 0) + 1000);
    await c.waitFor(() => reminderIds(c, MEERA).length === 2, "Meera's due-day reminder");
    c.goto(at(11, 0, 0) + 1000);
    await c.waitFor(() => lines(c, "add_late_fee").length === 4, "the late fee for the four others");
    assert.equal(toParent(c, ROHAN).length, before, "nothing more went to the parent who said STOP, not even a reply");
    assert.ok(!lines(c, "add_late_fee").some((l) => l.booking === "f-5"), "no late fee for a parent who cannot be told of it");
  });
});

describe("the beat across restarts", () => {
  contract("the day the agent first ran is saved: a process down over the 10:00 moment still reminds at 13:00", async () => {
    const c = await boot();
    await c.started(); // the first beat at 09:00 notes the day
    await c.stop();
    c.goto(at(2, 13, 0));
    await c.start();
    await c.waitFor(() => [SHARMA, MEERA, KIRAN, ROHAN].every((p) => reminderIds(c, p).length === 1), "the reminders after the restart");
    assert.deepEqual((await c.status()).fees, { open: 5 });
  });

  contract("a centre first started after a month's first reminder day does not chase that month; the next month opens on its day", async () => {
    const c = await boot({ at: at(4, 12, 0) });
    await sleep(2500);
    assert.equal(lines(c, "open_fee").length, 0, "November's first reminder day (the 2nd) was before the agent first ran");
    c.goto(at(2, 10, 0, 12) + 1000);
    await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 5, "December's fees");
    assert.deepEqual(lines(c, "open_fee").map((l) => l.refs.month), Array(5).fill("2026-12"));
  });

  contract("after a restore the next fee's id moves on by 100000, and the restore is on the record once", async () => {
    const c = await november();
    await c.stop();
    writeFileSync(join(c.dataDir, "restored.json"), JSON.stringify({ snapshot: "20261102T013000Z", restoredAt: new Date().toISOString(), lastSeq: null }));
    await c.start();
    await c.waitFor(() => lines(c, "restored").length === 1, "the restored line");
    c.goto(at(2, 10, 0, 12) + 1000);
    await c.waitFor(() => lines(c, "open_fee").length === 10, "December's fees");
    assert.deepEqual(lines(c, "open_fee").slice(5).map((l) => l.booking), ["f-100006", "f-100007", "f-100008", "f-100009", "f-100010"]);
    await c.stop(); await c.start();
    await sleep(1500);
    assert.equal(lines(c, "restored").length, 1, "the note is done with: not twice");
  });

  contract("a step the beat started is finished by the same process: the owner's number is never a parent's conversation", async () => {
    const c = await november();
    // every line of the record has its conversation, and the owner's notices name the PARENT's conversation with `to: owner` (the record keeps a number in one place)
    for (const l of sends(c).filter((x) => x.refs.to === "owner")) assert.notEqual(l.conversation, "", "an owner's notice names whose fee it is about");
    assert.ok(!c.record().some((l) => l.conversation === OWNER_NUMBER && l.action === "open_fee"));
  });
});
