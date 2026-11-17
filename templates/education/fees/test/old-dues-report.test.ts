// Old dues on the monthly report (the owner's decision, 17 Nov 2026: "old dues collected on a separate line"). A student's `backDues` are earlier months unpaid when the agent
// started, each opened once as a fee of its own with `backDue`. The report tells their payments apart from the period's own fees, from the record and the books (never from
// what a parent said); the two parts add up exactly to the books' received figure; the page, the text and the summary show the extra line only when old dues were paid, so a
// centre without them gets the report it always got; a part payment counts only what came in; a refund stays in "given back" as before; and the accountant's files mark every
// line of an old due with "old due <month>" (the books post it as an ordinary fee: each centre's accountant moves it where they prefer).
// Written 17 Nov 2026; not yet run (the owner's instruction: all suites run together later).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { accountantFiles } from "../../../../modules/accounting/export.ts";
import { figuresOf } from "../../../../modules/accounting/figures.ts";
import { journal } from "../../../../modules/accounting/journal.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { seal } from "../../../../modules/report/sign.ts";
import { layoutOf } from "../../../../modules/report/summary.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { buildFeesReport } from "../report/data.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { reportSection } from "../report/html.ts";
import { sampleReport } from "../report/review.ts";
import { STRINGS } from "../report/strings.ts";
import { reportSummaryFields } from "../report/summary.ts";
import { ownerText } from "../report/text.ts";
import { REPORT_SLOTS, REPORT_TEMPLATES, reportValues } from "../report/whatsapp.ts";
import { FEES_LEGACY, feesJournal, oldDueOf } from "../src/accounting.ts";
import { ROHAN_PARENT, brightTuition, createWorld } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";

const key = generateKeyPairSync("ed25519").privateKey;
const rawSettings = () => JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8")) as Record<string, any>;
const withBackDue = () => {
  const r = rawSettings();
  r.students = r.students.map((s: any) => (s.name === "Rohan Mehta" ? { ...s, backDues: [{ month: "2026-09", amountInr: 900 }] } : s));
  return parseSettings(r);
};

// ---- hand-made records: the edges -------------------------------------------------------------------------------------------------------------

let seq = 0;
const entry = (action: string, outcome: string, refs: Record<string, string>, booking: string | null, time = "2026-11-10T05:00:00.000Z"): RecordEntry =>
  ({ seq: ++seq, time, conversation: "+910000000001", booking, action, inputs: {}, outcome, decisions: [], refs, notes: "", language: "en" }) as unknown as RecordEntry;

/** A back due d-1 (September, ₹900) and this month's fee d-2 (November, ₹1,800), each with a payment as given. */
function record(oldPaise: string | null, newPaise: string | null, more: RecordEntry[] = []): RecordEntry[] {
  seq = 0;
  return [
    entry("open_fee", "confirmed", { month: "2026-09", amountPaise: "90000", backDue: "true" }, "d-1", "2026-11-02T05:00:00.000Z"),
    entry("open_fee", "confirmed", { month: "2026-11", amountPaise: "180000" }, "d-2", "2026-11-02T05:00:00.000Z"),
    ...(oldPaise ? [entry("record_payment", "confirmed", { paymentId: "pay_old", amountPaise: oldPaise }, "d-1")] : []),
    ...(newPaise ? [entry("record_payment", "confirmed", { paymentId: "pay_new", amountPaise: newPaise }, "d-2")] : []),
    ...more,
  ];
}
const settings = brightTuition();
const build = (entries: RecordEntry[], from = "2026-11") => buildFeesReport({ settings, entries, dues: [], ...monthRange(from, settings.timezone), source: "stand-in", madeAt: at(12, 1, 10), preparedBy: "Divya, local Operator" });
const received = (entries: RecordEntry[]) => figuresOf(journal(entries, FEES_LEGACY), entries, FEES_LEGACY, "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", { ownerMarks: false }).received;

test("a month with an old due paid: this month's fees and old dues collected are two figures that add up to the books' received", () => {
  const entries = record("90000", "180000");
  const r = build(entries);
  assert.deepEqual(r.money.collected, { count: 1, paise: 180_000 });
  assert.deepEqual(r.money.oldDues, { count: 1, paise: 90_000 });
  const books = received(entries);
  assert.equal(r.money.collected.paise + r.money.oldDues!.paise, books.paise);
  assert.equal(r.money.collected.count + r.money.oldDues!.count, books.count);
});

test("a back due paid in part counts only what came in; one paid by two payments counts both", () => {
  const entries = record("30000", null, [entry("record_payment", "confirmed", { paymentId: "pay_old2", amountPaise: "20000" }, "d-1")]);
  const r = build(entries);
  assert.deepEqual(r.money.oldDues, { count: 2, paise: 50_000 }, "₹300 and ₹200 of the ₹900 owed");
  assert.deepEqual(r.money.collected, { count: 0, paise: 0 });
  assert.equal(r.money.collected.paise + r.money.oldDues!.paise, received(entries).paise);
});

test("a month with no old due paid has no old-dues figure at all, and an old due paid last month is not this month's", () => {
  const none = build(record(null, "180000"));
  assert.equal("oldDues" in none.money, false);
  assert.deepEqual(none.money.collected, { count: 1, paise: 180_000 });
  const entries = record("90000", "180000");
  entries.find((e) => e.refs.paymentId === "pay_old")!.time = "2026-10-20T05:00:00.000Z"; // the old due was paid in October (so it was opened before, too)
  entries.find((e) => e.action === "open_fee" && e.booking === "d-1")!.time = "2026-10-01T05:00:00.000Z";
  assert.equal("oldDues" in build(entries).money, false);
  assert.equal(build(entries, "2026-10").money.oldDues?.paise, 90_000);
});

test("a refunded payment on an old due follows the existing given-back rule: the refund is in given back, the payment stays in old dues collected", () => {
  const entries = record("90000", null, [entry("refund", "confirmed", { paymentId: "pay_old", amountPaise: "90000", refundId: "rfnd_1" }, "d-1")]);
  const r = build(entries);
  assert.deepEqual(r.money.givenBack, { count: 1, paise: 90_000 });
  assert.deepEqual(r.money.oldDues, { count: 1, paise: 90_000 });
  assert.equal(r.money.collected.paise + r.money.oldDues!.paise, received(entries).paise);
});

test("a UPI centre's marks on an old due are split the same way", () => {
  const upi = parseSettings(JSON.parse(readFileSync(new URL("../settings/bright-tuition-upi.example.json", import.meta.url), "utf8")));
  seq = 0;
  const entries = [
    entry("open_fee", "confirmed", { month: "2026-09", amountPaise: "90000", backDue: "true" }, "d-1", "2026-11-02T05:00:00.000Z"),
    entry("owner_marked_paid", "confirmed", { paymentId: "mark_1", amountPaise: "40000", markedBy: "owner", via: "cash" }, "d-1"),
  ];
  const r = buildFeesReport({ settings: upi, entries, dues: [], ...monthRange("2026-11", upi.timezone), source: "stand-in", madeAt: at(12, 1, 10), preparedBy: "Divya" });
  assert.deepEqual(r.money.oldDues, { count: 1, paise: 40_000 });
  assert.equal(r.money.collected.paise + r.money.oldDues!.paise, figuresOf(journal(entries, FEES_LEGACY), entries, FEES_LEGACY, "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", { ownerMarks: true }).received.paise);
});

// ---- the agent's own record -------------------------------------------------------------------------------------------------------------------

test("in the agent's own run, the September back due paid on its own link shows on its own line and the November fee on the other", async () => {
  const w = createWorld({ settings: withBackDue() });
  await w.tick();
  await w.advance(61);
  const sept = [...w.store.dues.values()].find((d) => d.studentName === "Rohan Mehta" && d.backDue)!;
  assert.ok(sept, "the back due was opened");
  w.payments.customerPays(sept.currentLinkId!);
  await w.deliverPaymentEvents();
  w.pays("Aarav Sharma");
  await w.deliverPaymentEvents();
  const entries = w.record.entries();
  assert.ok(entries.some((e) => e.action === "open_fee" && e.refs.backDue === "true"), "the record names the back due");
  const r = buildFeesReport({ settings: w.settings, entries, dues: [...w.store.dues.values()], ...monthRange("2026-11", w.settings.timezone), source: "stand-in", madeAt: at(12, 1, 10), preparedBy: "Divya" });
  assert.equal(r.money.oldDues?.paise, 90_000);
  assert.ok(r.money.collected.paise > 0);
  assert.equal(r.money.collected.paise + r.money.oldDues!.paise, figuresOf(feesJournal(entries), entries, FEES_LEGACY, new Date(r.period.from).toISOString(), new Date(r.period.to).toISOString(), { ownerMarks: false }).received.paise);
  assert.ok(ROHAN_PARENT);
});

test("a centre without old dues gets the same report: no old-dues figure in the data, the page, the text, the summary or the message", async () => {
  const month = (await runBusyMonth()).world;
  const r = buildFeesReport({ settings: month.settings, entries: month.record.entries(), dues: [...month.store.dues.values()], ...monthRange("2026-11", month.settings.timezone), source: "stand-in", madeAt: at(12, 1, 10), preparedBy: "Divya, local Operator" });
  assert.equal("oldDues" in r.money, false);
  assert.equal(reportSummaryFields(r).layout, 4);
  assert.equal(reportSummaryFields(r).figures.length, 9);
  for (const language of LANGUAGES) {
    assert.equal(reportSection(seal(r, key) as never, language).includes(STRINGS[language].label.oldDuesCollected), false, language);
    assert.equal(ownerText(r, language).includes(STRINGS[language].label.oldDuesCollected), false, language);
    const v = reportValues(r, language, { code: "7K2M-9QXD", link: "https://example.test/r", check: "https://example.test/c", builder: "Divya" });
    assert.equal(v.collected.includes(STRINGS[language].label.oldDuesCollected), false, language);
  }
});

// ---- the documents ----------------------------------------------------------------------------------------------------------------------------

const withOld = () => ({ ...sampleReport(), money: { collected: { count: 41, paise: 12_000_000 }, givenBack: { count: 1, paise: 150_000 }, oldDues: { count: 2, paise: 300_000 } } });

test("with old dues the page, the text and the message each say it in four languages, in plain words", () => {
  const r = withOld();
  for (const language of LANGUAGES) {
    const label = STRINGS[language].label.oldDuesCollected;
    assert.ok(label.length > 0 && label !== STRINGS.en.label.oldDuesCollected || language === "en");
    assert.deepEqual(bannedIn(`${label} ${STRINGS[language].upiLabel.oldDuesCollected}`, language), []);
    assert.equal(/earn|income/iu.test(`${label} ${STRINGS[language].upiLabel.oldDuesCollected}`), false);
    assert.ok(reportSection(seal(r, key) as never, language).includes(label), `page ${language}`);
    assert.ok(ownerText(r, language).includes(`${label}: ₹3,000`), `text ${language}`);
    const v = reportValues(r, language, { code: "7K2M-9QXD", link: "https://example.test/r", check: "https://example.test/c", builder: "Divya" });
    assert.ok(v.collected.startsWith("₹1,20,000") && v.collected.includes(`${label}: ₹3,000`), `message ${language}`);
  }
  // the Meta template bodies are the same for both: the line is inside the collected value, so no template is added or changed
  assert.equal(REPORT_TEMPLATES.length, 4);
  for (const t of REPORT_TEMPLATES) for (const l of LANGUAGES) assert.equal(t.bodies[l].includes("oldDues"), false);
  assert.equal(REPORT_SLOTS.includes("oldDues" as never), false);
});

test("the signed summary of a month with old dues is layout 7 (layout 4 and the old dues last); without them it is layout 4", () => {
  const r = withOld();
  const f = reportSummaryFields(r);
  assert.equal(f.layout, 7);
  assert.equal(f.figures.length, layoutOf(7)!.figures.length);
  assert.equal(f.figures.at(-1), 300_000);
  assert.equal(layoutOf(7)!.figures.at(-1)!.id, "oldDues");
  assert.deepEqual(layoutOf(7)!.figures.slice(0, 9), layoutOf(4)!.figures);
  assert.equal(reportSummaryFields(sampleReport()).layout, 4);
});

test("the accountant's files mark each line of an old due (the fee, its payments) with 'old due <month>' and leave the other lines and a centre without old dues alone", () => {
  const entries = record("90000", "180000");
  const j = feesJournal(entries);
  const files = (oldDue?: ReturnType<typeof oldDueOf>) => accountantFiles({ journal: j, entries, period: "2026-11", timeZone: settings.timezone, tally: {}, ...(oldDue ? { oldDueOf: oldDue } : {}) });
  const csvOf = (f: { name: string; content: string }[]) => f.find((x) => x.name === "journal-2026-11.csv")!.content.trim().split("\r\n").map((l) => l.split(","));
  const marked = csvOf(files(oldDueOf(entries)));
  assert.equal(marked[0].at(-1), "note");
  const byCase = (c: string) => marked.slice(1).filter((row) => row[8] === c);
  assert.ok(byCase("d-1").length >= 4 && byCase("d-1").every((row) => row.at(-1) === "old due 2026-09"), "the back due's bill and its payment, every line");
  assert.ok(byCase("d-2").length >= 4 && byCase("d-2").every((row) => row.at(-1) === ""), "this month's fee is not marked");
  const tally = files(oldDueOf(entries)).find((x) => x.name === "tally-vouchers.xml")!.content;
  assert.match(tally, /<NARRATION>[^<]*d-1[^<]*old due 2026-09<\/NARRATION>/u);
  assert.doesNotMatch(tally.match(/<NARRATION>[^<]*d-2[^<]*<\/NARRATION>/gu)!.join(""), /old due/u);
  assert.match(files(oldDueOf(entries)).find((x) => x.name === "README.txt")!.content, /old due 2026-09/u);
  // no old due in the record: the files are byte for byte what they are without the option
  const plain = record(null, "180000").filter((e) => e.refs.backDue !== "true");
  const jp = feesJournal(plain);
  const a = accountantFiles({ journal: jp, entries: plain, period: "2026-11", timeZone: settings.timezone, tally: {} });
  const b = accountantFiles({ journal: jp, entries: plain, period: "2026-11", timeZone: settings.timezone, tally: {}, oldDueOf: oldDueOf(plain) });
  assert.deepEqual(b, a);
});
