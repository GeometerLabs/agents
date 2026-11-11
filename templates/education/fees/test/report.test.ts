// The monthly Fees report: its numbers are counted from the action record (and the money checked against the stand-in services' own lists), it is signed and shows
// when it has been changed, every layer says what it was counted from and what it did not check, the WhatsApp message is the owner's lines filled into an approved
// template, and the shared monthly job sends it once. The month is the one scripted in report/example-month.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { esc } from "../../../../modules/report/page.ts";
import { MAX_TRIES, lastMonth } from "../../../../modules/report/monthly-job.ts";
import { envelopeFile, seal, verifyEnvelopeText } from "../../../../modules/report/sign.ts";
import { verifyCodeLink, verifyLink } from "../../../../modules/report/verify-link.ts";
import { badgeText } from "../../../../modules/report/text.ts";
import { MARKERS } from "../crash-test/says.ts";
import { NOT_TESTED } from "../crash-test/not-tested.ts";
import { buildFeesReport, NOT_COUNTED, RULE_IDS } from "../report/data.ts";
import type { FeesReport } from "../report/data.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { reportPage } from "../report/html.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportContext } from "../report/monthly-job.ts";
import { writeFeesReport } from "../report/run.ts";
import { STRINGS } from "../report/strings.ts";
import { ownerText } from "../report/text.ts";
import { REPORT_SLOTS, REPORT_TEMPLATES, REPORT_TEMPLATE_NAMES, monthlyReportMessage, reportParameters, reportSlotsOf, reportSubmissions, reportValues } from "../report/whatsapp.ts";
import type { World } from "../src/harness.ts";
import { KIRAN_PARENT, createWorld } from "../src/harness.ts";

const November = (w: World, extra: { source?: "stand-in" | "test-mode" | "live"; innovator?: boolean; preparedBy?: string } = {}): FeesReport =>
  buildFeesReport({
    settings: w.settings, entries: w.record.entries(), dues: [...w.store.dues.values()], ...monthRange("2026-11", w.settings.timezone), source: extra.source ?? "stand-in", madeAt: at(12, 1, 10),
    preparedBy: extra.preparedBy ?? "Divya, local partner", innovator: extra.innovator,
  });

let month: World;
test.before(async () => { month = (await runBusyMonth()).world; });

let dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "geo-fees-report-")); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

test("the month's numbers are the ones the example month was built to hold", () => {
  const r = November(month);
  assert.deepEqual(r.money.collected, { count: 4, paise: 530_000 }, "Rohan 1800, Aarav 1800, Kiran 1100, Meera 600");
  assert.deepEqual(r.money.givenBack, { count: 1, paise: 40_000 }, "the ₹400 Rohan Mehta's parent asked for and the owner approved");
  assert.deepEqual(r.fees, { opened: 5, paidInFull: 3, partlyPaid: 1, stillOpen: 2, stillToCollect: { count: 2, paise: 190_000 } }, "Anaya owes 1200 + 100 late - 300 waived = 1000; Meera owes 900");
  assert.deepEqual(r.waivers, { total: { count: 2, paise: 40_000 }, byOwner: { count: 1, paise: 30_000 }, withinLimit: { count: 1, paise: 10_000 }, lateFeesAdded: { count: 1, paise: 10_000 } });
  assert.deepEqual(r.owner, { asked: 2, approved: 2, denied: 0 }, "the ₹300 waiver and the ₹400 refund");
  assert.equal(r.reminders.sent, 9);
  assert.deepEqual(r.reminders.byLanguage, { hi: 5, en: 1, ml: 2, kn: 1 });
  assert.equal(r.reminders.receipts, 4, "one receipt for each payment");
  assert.equal(r.parents.stopped, 1);
  assert.equal(r.stopped.total, 1);
  assert.equal(r.stopped.byRule["refund-limit"], 1, "a parent asked for ₹5,000 back when ₹1,800 was paid");
  assert.equal(RULE_IDS.reduce((n, id) => n + r.stopped.byRule[id], 0), 1);
  assert.deepEqual(r.period.month, { year: 2026, month: 11 });
  assert.equal(r.source, "stand-in");
  assert.equal(r.anchor, null);
});

test("the money is checked against the payments service's own lists, not against what the agent said", () => {
  const r = November(month);
  const paid = month.payments.links().flatMap((l) => l.payments).reduce((n, p) => n + p.amount, 0);
  assert.equal(r.money.collected.paise, paid, "every payment the service holds is counted, and none twice");
  assert.equal(r.money.collected.count, month.payments.links().flatMap((l) => l.payments).length);
  assert.equal(r.money.givenBack.paise, month.payments.refunds().reduce((n, f) => n + f.amount, 0));
  assert.equal(r.money.givenBack.count, month.payments.refunds().length);
});

test("reminders and receipts are checked against what WhatsApp's outbox holds", () => {
  const r = November(month);
  const parents = ["+919811111111", "+919822222222", "+919833333333", "+919844444444"];
  const texts = parents.flatMap((p) => month.messaging.sentTo(p).map((m) => m.text));
  const byLanguage = Object.fromEntries(LANGUAGES.map((l) => [l, texts.filter((t) => t.startsWith(MARKERS[l].reminder)).length])) as Record<Language, number>;
  assert.deepEqual(r.reminders.byLanguage, byLanguage);
  assert.equal(r.reminders.sent, Object.values(byLanguage).reduce((a, b) => a + b, 0));
});

test("a payment event delivered twice counts one payment; what a parent says counts nothing", async () => {
  const w = createWorld({ nowMs: at(11, 2, 9) });
  await w.goto({ year: 2026, month: 11, day: 2 });
  w.pays("Rohan Mehta");
  await w.deliverPaymentEvents({ twice: true });
  await w.say("I already paid the fee", { from: KIRAN_PARENT }); // Kiran has paid nothing: the record shows nothing
  const r = November(w);
  assert.deepEqual(r.money.collected, { count: 1, paise: 180_000 });
  assert.equal(r.fees.stillOpen, 4);
  assert.equal(r.fees.stillToCollect.paise, (1800 + 1200 + 1500 + 1200) * 100, "four fees are still owed: what a parent says does not mark one paid");
});

test("only the month asked for is counted: October and December hold nothing, and the same record gives the same November", () => {
  const entries = month.record.entries();
  const dues = [...month.store.dues.values()];
  const other = (m: string) => buildFeesReport({ settings: month.settings, entries, dues, ...monthRange(m, month.settings.timezone), source: "stand-in", madeAt: at(12, 1, 10) });
  assert.equal(other("2026-10").record.entries, 0);
  assert.equal(other("2026-10").money.collected.count, 0);
  assert.equal(other("2026-12").record.entries, 0);
  assert.equal(other("2026-12").fees.opened, 0);
  assert.deepEqual(November(month), November(month));
  assert.throws(() => buildFeesReport({ settings: month.settings, entries, dues, from: 5, to: 5, source: "stand-in", madeAt: 0 }), /must end after/);
  assert.throws(() => buildFeesReport({ settings: month.settings, entries, dues, ...monthRange("2026-11", "UTC"), source: "paper" as never, madeAt: 0 }), /counted from/);
});

test("the report is signed, any change to a number is seen, and an unsigned one says so", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("ed25519");
  const signed = seal(November(month), privateKey);
  const text = envelopeFile(signed);
  const checked = verifyEnvelopeText(text);
  assert.ok(checked.unchanged && checked.signed, checked.summary);
  const changed = text.replace('"paise":530000', '"paise":930000');
  assert.notEqual(changed, text);
  assert.equal(verifyEnvelopeText(changed).unchanged, false, "a changed number is seen");
  const unsigned = verifyEnvelopeText(envelopeFile(seal(November(month))));
  assert.ok(unsigned.unchanged && !unsigned.signed);
  assert.match(reportPage(seal(November(month)), "en"), /Not signed/);
});

test("the owner text is five lines in every language, says what it was counted from, and grades nothing", () => {
  const r = November(month);
  for (const language of LANGUAGES) {
    const text = ownerText(r, language);
    assert.equal(text.split("\n").length, 5, language);
    assert.ok(text.includes("₹5,300"), `${language}: ${text}`);
    assert.ok(text.includes("₹1,900"), `${language} still to collect`);
    assert.ok(text.includes(STRINGS[language].sourceTag["stand-in"]), `${language} says it is stand-ins and test money`);
    assert.ok(text.includes(STRINGS[language].handRun), `${language} says the checks were run by hand`);
    assert.deepEqual(bannedIn(text, language), [], `${language}: ${text}`);
  }
  assert.ok(!ownerText(November(month, { source: "live" }), "en").includes("test money"), "a live report carries no stand-in tag");
  assert.match(ownerText(November(month, { source: "test-mode" }), "en"), /test mode, test money/);
});

test("every string the report says is there in all four languages, and none of them promises or grades", () => {
  const flat = (v: unknown, path: string, out: Map<string, string>) => {
    if (typeof v === "string") out.set(path, v);
    else if (typeof v === "function") out.set(path, (v as (n: number) => string)(3));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) flat(x, `${path}.${k}`, out);
  };
  const english = new Map<string, string>();
  flat(STRINGS.en, "", english);
  for (const language of LANGUAGES) {
    const mine = new Map<string, string>();
    flat(STRINGS[language], "", mine);
    assert.deepEqual([...mine.keys()], [...english.keys()], `${language} has the same strings as English`);
    for (const [id, text] of mine) {
      assert.deepEqual(bannedIn(text, language), [], `${language} ${id}: ${text}`);
      if (language !== "en" && id !== ".sourceTag.live") assert.notEqual(text, "", `${language} ${id} is empty`);
    }
  }
  for (const id of RULE_IDS) for (const language of LANGUAGES) assert.ok(STRINGS[language].stop[id], `${language} names the rule ${id}`);
  for (const n of NOT_TESTED) for (const language of LANGUAGES) assert.ok(STRINGS[language].notTested[n.id], `${language} words ${n.id}`);
  for (const id of NOT_COUNTED) for (const language of LANGUAGES) assert.ok(STRINGS[language].notCounted[id], `${language} words ${id}`);
});

test("the page is one self-contained file that lists what was not counted and not tested, escapes the centre's name, and carries the code and digests", () => {
  const report = November(month, { innovator: true });
  const sealed = seal(report);
  // B71 part 2: a UPI centre's report has its own words for the lines that named a gateway, so the page lists the report's own ids
  assert.ok(report.notCounted.every((id) => !(report.paidBy === "owner-marked" && (id === "outside-agent" || id === "cash-and-transfers"))), "a UPI centre gets its UPI lines");
  for (const language of LANGUAGES) {
    const html = reportPage(sealed, language);
    assert.ok(html.includes(sealed.code) && html.includes(sealed.digest), language);
    assert.ok(!/<script|src=|href=|@import|url\(/i.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), `${language}: one file, nothing fetched`);
    for (const id of report.notCounted) assert.ok(html.includes(esc(STRINGS[language].notCounted[id])), `${language} lists ${id}`);
    for (const n of NOT_TESTED) assert.ok(html.includes(esc(STRINGS[language].notTested[n.id])), `${language} lists ${n.id}`);
    assert.ok(html.includes(badgeText(language)), `${language} shows the badge`);
    assert.ok(html.includes("₹5,300"), language);
    assert.deepEqual(bannedIn(html.replace(/<style>[\s\S]*?<\/style>/, ""), language), [], language);
  }
  assert.equal((reportPage(sealed, "both").match(/<section class="doc"/g) ?? []).length, 2, "both is Hindi and English on one page");
  const odd = { ...November(month), shop: { ...November(month).shop, name: "<b>Bright</b> & \"Sons\"" } };
  const page = reportPage(seal(odd), "en");
  assert.ok(!page.includes("<b>Bright</b>") && page.includes("&lt;b&gt;Bright&lt;/b&gt;"));
});

test("the files are written into the one folder named, with plain names", () => {
  const out = tempDir();
  const made = writeFeesReport({ settings: month.settings, entries: month.record.entries(), dues: [...month.store.dues.values()], month: "2026-11", language: "both", out, source: "stand-in", preparedBy: "Divya", now: at(12, 1, 10) });
  assert.deepEqual(readdirSync(out).sort(), ["owner-2026-11-en.txt", "owner-2026-11-hi.txt", "report-2026-11-both.html", "report-2026-11.json"]);
  assert.equal(made.ownerTexts.length, 2);
  assert.ok(verifyEnvelopeText(readFileSync(join(out, "report-2026-11.json"), "utf8")).unchanged);
});

// ---- the WhatsApp message ------------------------------------------------------------------------------------------------------

test("the message is the owner's lines in every language: numbers from the report, the check code, the page address, who set it up", () => {
  const sealed = seal(November(month));
  for (const language of LANGUAGES) {
    const { text, template } = monthlyReportMessage(sealed, language, { link: "https://reports.example.com/r/abc/report-2026-11-en.html" });
    const s = STRINGS[language];
    assert.ok(text.includes(`${s.label.collected}: ₹5,300`), text);
    assert.ok(text.includes(`${s.label.givenBack}: ₹400`), text);
    assert.ok(text.includes(`${s.label.remindersSent}: 9`), text);
    assert.ok(text.includes(`${s.label.takenOff}: ₹400`), text);
    assert.ok(text.includes(`${s.label.wasAsked}: 2`) && text.includes(`${s.label.approved}: 2`) && text.includes(`${s.label.saidNo}: 0`), text);
    assert.ok(text.includes(sealed.code) && text.includes("https://reports.example.com/r/abc/report-2026-11-en.html") && text.includes("Divya, local partner"), text);
    assert.ok(text.startsWith(`${s.monthlyReport}: `), "starts with fixed words");
    assert.ok(text.endsWith("Geometer"), "ends with fixed words");
    assert.equal(template.name, "fee_monthly_report");
    assert.equal(text.split("\n").length, 9, "the owner's lines, the code and page, the check link (item 17b), who set it up");
    // an unsigned report carries the #digest link, or the #code link where the whole message would pass 1024 characters with it (messageCheckLink)
    const checkLine = text.split("\n").find((l) => l.startsWith(`${s.checkGenuine}: `));
    assert.ok(checkLine === `${s.checkGenuine}: ${verifyLink(sealed)}` || (checkLine === `${s.checkGenuine}: ${verifyCodeLink(sealed)}` && text.length - verifyCodeLink(sealed).length + verifyLink(sealed).length > 1024), checkLine ?? "no check line");
    assert.deepEqual(bannedIn(text, language), [], language);
  }
});

test("the Innovator badge is one more line, the last, and only when the report carries the flag; a report that names no one is not turned into a message", () => {
  for (const language of LANGUAGES) {
    const plain = monthlyReportMessage(seal(November(month)), language, { link: "https://x.example.com/a.html" });
    const badge = monthlyReportMessage(seal(November(month, { innovator: true })), language, { link: "https://x.example.com/a.html" });
    assert.equal(plain.template.name, "fee_monthly_report");
    assert.equal(badge.template.name, "fee_monthly_report_innovator");
    assert.ok(!plain.text.includes("★"));
    assert.equal(badge.text.split("\n").at(-1), badgeText(language));
    assert.equal(badge.text.split("\n").length, plain.text.split("\n").length + 1);
  }
  assert.throws(() => monthlyReportMessage(seal({ ...November(month), preparedBy: null }), "en", { link: "https://x.example.com/a.html" }), /names no one/);
});

test("the template follows Meta's rules: numbered values used once, fixed words at both ends, never two values side by side, values on one line; filling it gives back the text", () => {
  const sealed = seal(November(month));
  for (const template of REPORT_TEMPLATES) {
    assert.match(template.name, /^[a-z][a-z0-9_]*$/);
    for (const language of LANGUAGES) {
      const body = template.bodies[language];
      const slots = reportSlotsOf(body);
      assert.deepEqual(slots, REPORT_SLOTS.filter((x) => slots.includes(x)), "values come in the order REPORT_SLOTS lists them");
      assert.equal(new Set(slots).size, slots.length, "each value is used once");
      assert.ok(!/^\{/.test(body) && !/\}$/.test(body), `${template.name} ${language} starts and ends with fixed words`);
      assert.ok(!/\}\s*\{/.test(body), "no two values side by side");
      const meta = metaBody(body);
      assert.ok(!/^\{\{|\}\}$/.test(meta));
      const values = reportValues(sealed.document, language, { code: sealed.code, link: "https://x.example.com/a.html", check: verifyLink(sealed), builder: "Divya  \n Nair" });
      const parameters = reportParameters(template, language, values);
      assert.equal(parameters.length, slots.length);
      for (const p of parameters) assert.ok(!/[\n\t]| {2,}/.test(p), `a value is one line: ${JSON.stringify(p)}`);
      if (template.badge === false && !template.upi) assert.equal(fillBody(meta, parameters), monthlyReportMessage(sealed, language, { link: "https://x.example.com/a.html" }).text.replace("Divya, local partner", "Divya Nair"));
      assert.ok([...meta].length <= 1024);
    }
  }
  // the last two: a UPI centre's (B33), its money labelled as marked paid by the owner
  assert.deepEqual([...REPORT_TEMPLATE_NAMES], ["fee_monthly_report", "fee_monthly_report_innovator", "fee_monthly_report_upi", "fee_monthly_report_upi_innovator"]);
  assert.equal(reportSubmissions().length, 16);
  for (const s of reportSubmissions()) {
    assert.equal(s.category, "UTILITY");
    const examples = s.components[0].example.body_text[0];
    assert.equal(examples.length, (s.components[0].text.match(/\{\{\d+\}\}/g) ?? []).length, "an example for every value");
    assert.ok(examples.every((e) => e !== ""));
  }
});

// ---- the monthly job -------------------------------------------------------------------------------------------------------

const context = (w: World, log: string[] = []): MonthlyReportContext => ({ settings: w.settings, clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, save: () => undefined, log: (l) => log.push(l) });
const approveReports = (w: World) => { for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) w.messaging.approve(name, language); };

test("the shared monthly job sends the Fees report once, on the 1st from 09:00, as a template, with the numbers the stand-ins hold", async () => {
  const { world: w } = await runBusyMonth();
  approveReports(w);
  const dir = tempDir();
  let n = 0;
  const job = createMonthlyReport({ source: "stand-in", pages: { dir, baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, local partner", innovator: false }), token: () => `t${++n}`.padEnd(8, "0") });
  assert.equal(lastMonth(at(12, 1, 9), "Asia/Kolkata"), "2026-11");
  w.clock.set(at(12, 1, 8, 59));
  assert.deepEqual(await job.run(context(w)), { done: false, why: "not-yet" });
  const before = w.messaging.sentTo(w.owner).length;
  w.clock.set(at(12, 1, 9));
  assert.deepEqual(await job.run(context(w)), { done: true, month: "2026-11", outcome: "confirmed", via: "template" });
  const sent = w.messaging.sentTo(w.owner).slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateName, "fee_monthly_report");
  const collected = w.payments.links().flatMap((l) => l.payments).reduce((sum, p) => sum + p.amount, 0) / 100;
  assert.ok(sent[0].text.includes(`Collected: ₹${collected.toLocaleString("en-IN")}`), sent[0].text);
  assert.ok(sent[0].text.includes("Monthly report: Bright Tuition Centre · Nov 2026 · stand-in services, test money"), sent[0].text);
  assert.ok(sent[0].text.includes("https://reports.example.com/r/t1000000/report-2026-11-en.html"), sent[0].text);
  for (const [d, h] of [[1, 9], [1, 15], [2, 9], [15, 10]]) { w.clock.set(at(12, d, h)); await job.run(context(w)); }
  assert.equal(w.messaging.sentTo(w.owner).length, before + 1, "never twice");
  const entries = w.record.entries().filter((e) => e.action === "send_message" && e.refs.report === "2026-11");
  assert.deepEqual(entries.map((e) => e.outcome), ["attempted", "confirmed"]);
  assert.deepEqual(readdirSync(dir), ["t1000000"]);
  assert.deepEqual(readdirSync(join(dir, "t1000000")).sort(), ["owner-2026-11-en.txt", "report-2026-11-en.html", "report-2026-11.json"]);
  assert.ok(MAX_TRIES >= 1);
});

test("a month with nothing in the record gets no message and no entry", async () => {
  const w = createWorld({ nowMs: at(11, 2, 9) });
  approveReports(w);
  const job = createMonthlyReport({ source: "live", pages: { dir: tempDir(), baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya", innovator: true }) });
  w.clock.set(at(12, 1, 10)); // nothing happened in November: no tick has run, so no fee was opened
  assert.deepEqual(await job.run(context(w)), { done: false, why: "quiet" });
  assert.equal(w.record.entries().length, 0);
  assert.equal(w.messaging.sentTo(w.owner).length, 0);
});
