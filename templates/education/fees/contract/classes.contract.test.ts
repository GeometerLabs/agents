// Classes (Fees grown: a `classes` block in the settings): the teacher's class link goes shortly before each class ONLY to a student in the batch whose contact agreed (an adult
// student needs no consent) and whose fee is paid or within the grace days, judged at the moment of sending; the first class message to a parent is the consent question; the
// attendance is the teacher's, asked once after the class and marked in one message or one press, and a missed-class note goes only to the parent of a student the teacher
// marked absent; a doubt is handed to the teacher; a fee past its grace days stops the link. The reading material is served only to a private link whose parent has a student
// in the batch who may open it now. The fakes centre runs on the test clock (Mon 2 Nov 2026, class 10 meets Mondays and Thursdays at 17:00 for an hour, the link 30 minutes
// before); the material is served from the centre's own folder (guards mode, for the private link). Expected values from test/classes and old-dues-report.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER_NUMBER, ROHAN, SHARMA, at, contract, lines, makeCentre, sends, sleep } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });
async function boot(o: CentreOptions = {}): Promise<Centre> { const c = await makeCentre({ example: "classes", ...o }); centres.push(c); await c.start(); return c; }
const ids = (c: Centre, phone: string): string[] => sends(c, phone).filter((l) => l.refs.to === "customer" && l.outcome === "confirmed").map((l) => l.refs.templates);
const teacher = (c: Centre): string[] => sends(c).filter((l) => l.refs.to === "owner" && l.outcome === "confirmed").map((l) => l.refs.templates);

/** The teacher's link for class 10 is set, and Monday's class 10 window opens at 16:31. */
async function mondayClass(): Promise<Centre> {
  const c = await boot();
  await c.started();
  await c.inbound(OWNER_NUMBER, "link class 10 https://meet.example/abc-defg-hij");
  assert.equal(lines(c, "class_link_set", "confirmed").length, 1, "the teacher's link is kept");
  c.goto(at(2, 16, 31));
  await c.waitFor(() => ids(c, ROHAN).includes("class_link") && ids(c, SHARMA).includes("class_consent_ask"), "the link to the adult student and the consent question to the Sharmas");
  return c;
}

describe("the class link", () => {
  contract("before the class: an adult student gets the link (the class-access rule allowed it); a parent is first asked for consent, and gets the link after 'yes'", async () => {
    const c = await mondayClass();
    const link = sends(c, ROHAN).find((l) => l.refs.templates === "class_link")!;
    assert.ok(link.decisions.some((d) => d.ruleId === "class-access" && d.verdict === "allow"), "the rule is recorded beside the message");
    assert.ok(!ids(c, SHARMA).includes("class_link"), "no link before the parent agreed");
    assert.equal(lines(c, "class_consent", "confirmed").length >= 1, true);
    await c.inbound(SHARMA, "yes");
    assert.ok(lines(c, "class_consent").some((l) => l.refs.answer === "yes"));
    await c.waitFor(() => ids(c, SHARMA).includes("class_link"), "the link to Aarav's parent after the yes");
    await sleep(2200);
    assert.equal(ids(c, ROHAN).filter((t) => t === "class_link").length, 1, "the same link is never sent twice");
  });

  contract("after the class the teacher is asked once; 'absent 1' marks it, and only the parent of the student marked absent gets the missed-class note", async () => {
    const c = await mondayClass();
    await c.inbound(SHARMA, "yes");
    c.goto(at(2, 18, 1));
    await c.waitFor(() => teacher(c).includes("owner_class_attendance"), "the attendance question");
    const view = (await c.ownerView()).body.classes;
    assert.equal(view.pending.length, 1);
    assert.deepEqual(view.pending[0].students.map((s: { n: number; name: string }) => [s.n, s.name]), [[1, "Aarav Sharma"], [2, "Rohan Mehta"]]);
    assert.match(view.pending[0].case, /^k-[0-9a-f]{12}$/u);
    await c.inbound(OWNER_NUMBER, "absent 1");
    const marked = lines(c, "class_attendance", "confirmed");
    assert.equal(marked.length, 1);
    assert.deepEqual([marked[0].refs.present, marked[0].refs.absent], ["1", "1"]);
    await c.waitFor(() => ids(c, SHARMA).includes("class_missed_note"), "the missed-class note");
    assert.ok(!ids(c, ROHAN).includes("class_missed_note"), "no note for a student marked present");
    assert.deepEqual((await c.ownerView()).body.classes.pending, []);
    await sleep(2200);
    assert.equal(teacher(c).filter((t) => t === "owner_class_attendance").length, 1, "asked once");
  });

  contract("the teacher can mark the class from the page: 'present' with the class's digest closes it with everyone present", async () => {
    const c = await mondayClass();
    c.goto(at(2, 18, 1));
    await c.waitFor(async () => (await c.ownerView()).body.classes.pending.length === 1, "a class waiting for attendance");
    const [p] = (await c.ownerView()).body.classes.pending;
    await c.ownerAction("present", p.case, "0".repeat(32));
    assert.equal(lines(c, "class_attendance").length, 0, "a stale digest does nothing");
    await c.ownerAction("present", p.case, p.digest);
    assert.deepEqual([lines(c, "class_attendance")[0].refs.present, lines(c, "class_attendance")[0].refs.absent], ["2", "0"]);
  });

  contract("a fee past its grace days stops the link (the rule's reason is in the record); a doubt is handed to the teacher and answered from the page", async () => {
    const c = await mondayClass();
    // November's fees are due on the 5th with 5 grace days: on Mon 16 Nov Rohan's is late and unpaid
    c.goto(at(16, 16, 31));
    await c.waitFor(() => lines(c, "class_access", "blocked").some((l) => l.conversation === ROHAN), "the link withheld");
    const held = lines(c, "class_access", "blocked").find((l) => l.conversation === ROHAN)!;
    assert.ok(held.decisions.some((d) => d.ruleId === "class-access" && d.verdict === "block"));
    assert.equal(ids(c, ROHAN).filter((t) => t === "class_link").length, 1, "only Monday the 2nd's");
    await c.inbound(ROHAN, "doubt: how do I factorise a quadratic equation");
    assert.equal(lines(c, "class_doubt").length >= 1, true);
    const doubts = (await c.ownerView()).body.classes.doubts;
    assert.equal(doubts.length, 1);
    assert.equal(doubts[0].student, "Rohan Mehta");
    assert.match(doubts[0].text, /factorise a quadratic/u);
    await c.ownerAction("answered", doubts[0].case, doubts[0].digest);
    assert.deepEqual((await c.ownerView()).body.classes.doubts, []);
  });

  contract("'next class' from a parent is answered from the timetable, with no model", async () => {
    const c = await boot();
    await sleep(1200);
    await c.inbound(ROHAN, "when is the next class");
    assert.ok(ids(c, ROHAN).some((t) => t.startsWith("class_")), ids(c, ROHAN).join(","));
  });
});

describe("the reading material", () => {
  /** A guards Classes centre with a PDF and a picture in class 10's folder, and a file kind that is not handed out. */
  async function materialCentre(): Promise<{ c: Centre; hash: string }> {
    const c = await makeCentre({ mode: "guards", example: "classes" }); centres.push(c);
    const folder = join(c.client, "materials", "class-10");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "algebra.pdf"), "%PDF-1.4 algebra");
    writeFileSync(join(folder, "graph.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    writeFileSync(join(folder, "run.sh"), "echo no");
    await c.start();
    await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
    await c.inbound(ROHAN, "hello");
    const row = ((await c.ownerView()).body.parents as { phone: string; ref: string; digest: string }[]).find((p) => p.phone === ROHAN)!;
    await c.ownerAction("send_link", row.ref, row.digest);
    return { c, hash: c.linkOf(ROHAN)!.hash };
  }

  contract("a private link opens its batch's files (only the kinds handed out), a file by its id as a download; another batch, an unknown link or a bad id opens nothing", async () => {
    const { c, hash } = await materialCentre();
    const list = await c.call(`/internal/channel/material?link=${hash}&batch=class-10`);
    assert.equal(list.status, 200);
    assert.equal(list.body.kind, "list");
    assert.deepEqual(list.body.students, ["Rohan Mehta"]);
    assert.deepEqual(list.body.files.map((f: { name: string; bytes: number }) => [f.name, f.bytes]), [["algebra.pdf", 16], ["graph.png", 8]]);
    assert.equal(list.body.left, 1, "the script is not handed out");
    assert.equal(list.body.maxMb, 10);
    const pdf = list.body.files[0];
    assert.match(pdf.id, /^[0-9a-f]{12}$/u);
    const file = await c.call(`/internal/channel/material?link=${hash}&batch=class-10&file=${pdf.id}`);
    assert.deepEqual([file.body.kind, file.body.name, file.body.type, Buffer.from(file.body.base64, "base64").toString()], ["file", "algebra.pdf", "application/pdf", "%PDF-1.4 algebra"]);
    assert.equal((await c.call(`/internal/channel/material?link=${hash}&batch=class-8`)).status, 404, "Rohan has no student in class 8");
    assert.equal((await c.call(`/internal/channel/material?link=${"b".repeat(64)}&batch=class-10`)).status, 404);
    assert.equal((await c.call(`/internal/channel/material?link=${hash}&batch=class-10&file=${"0".repeat(12)}`)).status, 404);
    assert.equal((await c.call(`/internal/channel/material?link=${hash}&batch=..%2Fx`)).status, 400);
    assert.equal((await c.call(`/internal/channel/material?link=${hash}&batch=class-10&file=../x`)).status, 400);
  });
});
