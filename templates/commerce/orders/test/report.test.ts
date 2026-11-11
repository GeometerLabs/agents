// The monthly Orders report: its numbers are counted from the action record (and the money checked against the stand-ins' own lists), it is signed and shows when it has
// been changed, every layer says what it was counted from and what it did not check, the WhatsApp message is the owner's lines filled into an approved template, and
// the shared monthly job sends it once. The month is the one scripted in report/example-month.ts (a UPI shop); a Razorpay shop is tried on a short script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { esc } from "../../../../modules/report/page.ts";
import { MAX_TRIES, lastMonth } from "../../../../modules/report/monthly-job.ts";
import { envelopeFile, seal, verifyEnvelopeText } from "../../../../modules/report/sign.ts";
import { verifyLink } from "../../../../modules/report/verify-link.ts";
import { badgeText } from "../../../../modules/report/text.ts";
import { NOT_TESTED, notTestedOf } from "../crash-test/not-tested.ts";
import { NOT_COUNTED, RULE_IDS, buildOrdersReport } from "../report/data.ts";
import type { OrdersReport } from "../report/data.ts";
import { at, phone, runBusyMonth } from "../report/example-month.ts";
import { reportPage } from "../report/html.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportContext } from "../report/monthly-job.ts";
import { writeOrdersReport } from "../report/run.ts";
import { STRINGS } from "../report/strings.ts";
import { ownerText } from "../report/text.ts";
import { REPORT_SLOTS, REPORT_TEMPLATES, REPORT_TEMPLATE_NAMES, monthlyReportMessage, reportParameters, reportSlotsOf, reportSubmissions, reportValues } from "../report/whatsapp.ts";
import type { World } from "../src/harness.ts";
import { annapurnaRazorpay, createWorld } from "../src/harness.ts";

const November = (w: World, extra: { source?: "stand-in" | "test-mode" | "live"; innovator?: boolean; preparedBy?: string } = {}): OrdersReport =>
  buildOrdersReport({
    settings: w.settings, entries: w.record.entries(), orders: [...w.store.orders.values()], ...monthRange("2026-11", w.settings.timezone), source: extra.source ?? "stand-in", madeAt: at(12, 1, 10),
    preparedBy: extra.preparedBy ?? "Divya, local partner", innovator: extra.innovator,
  });

let month: World;
test.before(async () => { month = (await runBusyMonth()).world; });

let dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "geo-orders-report-")); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

/** The words no owner document may use, in any language's page, text or message. */
const FORBIDDEN = /\b(safe|safely|guaranteed?|proves?|proven|certified|founders?|founding)\b|100 ?%/i;

test("the month's numbers are the ones the example month was built to hold", () => {
  const r = November(month);
  assert.deepEqual(r.money.collected, { count: 7, paise: 166_000 }, "120 + 80 + 60 + 560 + 480 + 120 + 240 marked paid by the owner");
  assert.deepEqual(r.money.givenBack, { count: 2, paise: 18_000 }, "60 for the early cancellation, 120 for the late one the owner approved");
  assert.equal(r.paidBy, "owner-marked");
  assert.deepEqual(r.orders, { taken: 7, completed: 4, cancelled: 2, holdsRanOut: 2 });
  assert.deepEqual(r.sold, {
    orders: 5, pickup: 4, delivery: 1, toCollect: { count: 1, paise: 24_000 },
    items: [{ id: "veg-thali", names: { en: "veg thali", hi: "वेज थाली", ml: "veg thali", kn: "veg thali" }, qty: 10 }, { id: "chicken-meal", names: { en: "chicken meal", hi: "चिकन मील", ml: "chicken meal", kn: "chicken meal" }, qty: 11 }],
  });
  assert.deepEqual(r.owner, { asked: 2, approved: 2, denied: 0 }, "the big order and the late cancellation");
  assert.equal(r.customers.stopped, 1);
  assert.equal(r.stopped.total, 5);
  for (const id of ["price-at-or-above-menu", "order-size", "within-stock", "before-cutoff", "within-delivery-area"] as const) assert.equal(r.stopped.byRule[id], 1, id);
  assert.equal(RULE_IDS.reduce((n, id) => n + r.stopped.byRule[id], 0), 5, "every stop is under one rule");
  assert.equal(r.unconfirmed.open, 0);
  assert.deepEqual(r.period.month, { year: 2026, month: 11 });
  assert.equal(r.source, "stand-in");
  assert.equal(r.anchor, null);
});

test("the money is checked against the owner's marks and the owed refunds the stand-in ledger holds, not against what the agent said", () => {
  const r = November(month);
  const marks = month.store.upi!.requests.flatMap((q) => q.marks);
  assert.equal(r.money.collected.paise, marks.reduce((n, m) => n + m.amountPaise, 0), "every mark is counted, and none twice");
  assert.equal(r.money.collected.count, marks.length);
  const done = month.store.upi!.refunds.filter((x) => x.state === "done");
  assert.equal(r.money.givenBack.paise, done.reduce((n, x) => n + x.amountPaise, 0));
  assert.equal(r.money.givenBack.count, done.length);
  // what is sold and what is left to collect come from the orders themselves
  const confirmed = [...month.store.orders.values()].filter((o) => o.state === "confirmed");
  assert.equal(r.sold.toCollect.paise, confirmed.reduce((n, o) => n + ((o.totalInr ?? 0) - (o.advanceInr ?? 0)) * 100, 0));
});

test("one scripted stop is exactly one stop: a check and the message that repeats it are not two, whichever way the cut-off or the area stops an order", async () => {
  const stops = async (script: (w: World) => Promise<void>) => {
    const w = createWorld({ nowMs: at(11, 9, 10), interactive: false });
    await script(w);
    return buildOrdersReport({ settings: w.settings, entries: w.record.entries(), orders: [...w.store.orders.values()], ...monthRange("2026-11", w.settings.timezone), source: "stand-in", madeAt: at(12, 1, 10) }).stopped;
  };
  const one = (s: Awaited<ReturnType<typeof stops>>, id: (typeof RULE_IDS)[number]) => { assert.equal(s.total, 1, JSON.stringify(s)); assert.equal(s.byRule[id], 1, id); };
  one(await stops(async (w) => { await w.say("1 veg thali 9 nov 12:00 pm pickup", { from: phone(1) }); }), "before-cutoff"); // the slot is chosen, its cut-off has passed (check_order)
  one(await stops(async (w) => { await w.goto({ year: 2026, month: 11, day: 9 }, { hour: 20, minute: 0 }); await w.say("1 curd 9 nov pickup", { from: phone(1) }); }), "before-cutoff"); // every slot of the day has closed (no check)
  one(await stops(async (w) => { await w.say("1 veg thali 11 nov 7:30 pm delivery", { from: phone(1) }); await w.say("12 Park Street, Colaba, Mumbai", { from: phone(1) }); }), "within-delivery-area");
  one(await stops(async (w) => { await w.say("13 veg thali 11 nov 12:00 pm pickup", { from: phone(1) }); }), "order-size");
  one(await stops(async (w) => { await w.say("1 veg thali 11 nov 12:00 pm pickup ₹50", { from: phone(1) }); }), "price-at-or-above-menu");
  assert.equal((await stops(async (w) => { await w.say("1 veg thali 11 nov 12:00 pm pickup", { from: phone(1) }); })).total, 0, "an order the limits allow stops nothing");
});

test("a Razorpay shop: a payment event delivered twice is one payment, a refund is counted once at the amount the payments service holds, and the money is not labelled owner-marked", async () => {
  const w = createWorld({ settings: annapurnaRazorpay(), nowMs: at(11, 2, 9), interactive: false });
  await w.say("2 veg thali 5 nov 7:00 pm pickup", { from: phone(1) });
  w.pays(phone(1));
  await w.deliverPaymentEvents({ twice: true });
  await w.say("2 veg thali 6 nov 7:00 pm pickup", { from: phone(2) });
  w.pays(phone(2));
  await w.deliverPaymentEvents();
  await w.say("cancel my order", { from: phone(2) }); // well before the window: the advance goes back
  await w.deliverPaymentEvents();
  await w.say("I already paid", { from: phone(3) }); // says nothing is paid
  const r = November(w);
  const paid = w.payments.links().flatMap((l) => l.payments);
  assert.deepEqual(r.money.collected, { count: 2, paise: paid.reduce((n, p) => n + p.amount, 0) });
  assert.equal(r.money.collected.count, paid.length);
  assert.deepEqual(r.money.givenBack, { count: w.payments.refunds().length, paise: w.payments.refunds().reduce((n, f) => n + f.amount, 0) });
  assert.equal(r.money.givenBack.count, 1);
  assert.equal(r.paidBy, undefined, "a Razorpay shop's bytes carry no owner-marked label");
  assert.deepEqual(r.orders, { taken: 2, completed: 0, cancelled: 1, holdsRanOut: 0 });
  assert.match(ownerText(r, "en"), /^Annapurna Tiffins · Nov 2026 · stand-in services, test money\nAdvance collected: ₹/, "labelled as collected, not marked by the owner");
});

test("an order cancelled before it was ever confirmed is not an order cancelled; a hold that runs out is counted once", async () => {
  const w = createWorld({ nowMs: at(11, 2, 9), interactive: false });
  await w.say("1 veg thali 5 nov 7:00 pm pickup", { from: phone(1) });
  await w.say("cancel my order", { from: phone(1) }); // before paying
  await w.say("1 veg thali 5 nov 7:00 pm pickup", { from: phone(2) });
  await w.advance(60); // the hold (30 minutes) runs out
  await w.advance(60);
  const r = November(w);
  assert.deepEqual(r.orders, { taken: 0, completed: 0, cancelled: 0, holdsRanOut: 1 });
  assert.deepEqual(r.money.collected, { count: 0, paise: 0 });
  assert.equal(r.sold.orders, 0);
});

test("only the month asked for is counted: October and December hold nothing, and the same record gives the same November", () => {
  const entries = month.record.entries();
  const orders = [...month.store.orders.values()];
  const other = (m: string) => buildOrdersReport({ settings: month.settings, entries, orders, ...monthRange(m, month.settings.timezone), source: "stand-in", madeAt: at(12, 1, 10) });
  assert.equal(other("2026-10").record.entries, 0);
  assert.equal(other("2026-10").money.collected.count, 0);
  assert.equal(other("2026-12").record.entries, 0);
  assert.equal(other("2026-12").sold.orders, 0);
  assert.deepEqual(November(month), November(month));
  assert.throws(() => buildOrdersReport({ settings: month.settings, entries, orders, from: 5, to: 5, source: "stand-in", madeAt: 0 }), /must end after/);
  assert.throws(() => buildOrdersReport({ settings: month.settings, entries, orders, ...monthRange("2026-11", "UTC"), source: "paper" as never, madeAt: 0 }), /counted from/);
});

test("the report is signed, any change to a number is seen, and an unsigned one says so", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("ed25519");
  const signed = seal(November(month), privateKey);
  const text = envelopeFile(signed);
  const checked = verifyEnvelopeText(text);
  assert.ok(checked.unchanged && checked.signed, checked.summary);
  const changed = text.replace('"paise":166000', '"paise":966000');
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
    assert.ok(text.includes("₹1,660") && text.includes("₹240") && text.includes("₹180"), `${language}: ${text}`);
    assert.ok(text.includes(`${STRINGS[language].label.ordersTaken}: 7`) && text.includes(`${STRINGS[language].label.cancelled}: 2`), `${language}: ${text}`);
    assert.ok(text.includes(STRINGS[language].upiLabel.collected), `${language}: a UPI shop's advance is labelled as marked by the owner`);
    assert.ok(text.includes(STRINGS[language].sourceTag["stand-in"]), `${language} says it is stand-ins and test money`);
    assert.ok(text.includes(STRINGS[language].handRun), `${language} says the checks were run by hand`);
    assert.deepEqual(bannedIn(text, language), [], `${language}: ${text}`);
    assert.doesNotMatch(text, FORBIDDEN, language);
  }
  assert.ok(!ownerText(November(month, { source: "live" }), "en").includes("test money"), "a live report carries no stand-in tag");
  assert.match(ownerText(November(month, { source: "test-mode" }), "en"), /test mode, test money/);
});

test("every string the report says is there in all four languages, none of them promises or grades, and the help line and the one assurance are word for word", () => {
  const flat = (v: unknown, path: string, out: Map<string, string>) => {
    if (typeof v === "string") out.set(path, v);
    else if (typeof v === "function") out.set(path, (v as (...a: unknown[]) => string)(3, 3, 3, 3));
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
      assert.doesNotMatch(text, FORBIDDEN, `${language} ${id}: ${text}`);
      if (id !== ".sourceTag.live") assert.notEqual(text, "", `${language} ${id} is empty`);
    }
  }
  for (const id of RULE_IDS) for (const language of LANGUAGES) assert.ok(STRINGS[language].stop[id], `${language} names the rule ${id}`);
  for (const n of NOT_TESTED) for (const language of LANGUAGES) assert.ok(STRINGS[language].notTested[n.id], `${language} words ${n.id}`);
  for (const id of NOT_COUNTED) for (const language of LANGUAGES) assert.ok(STRINGS[language].notCounted[id], `${language} words ${id}`);
  assert.equal(STRINGS.en.helpLine, "Write to support. A person answers.");
  assert.equal(STRINGS.en.promise, "No order confirmed without the payment record (or your confirmation for UPI); every refund tracked.");
  assert.equal(STRINGS.en.notTested["native-review"].includes("Hindi, Malayalam and Kannada"), true, "the machine-written languages are marked as waiting for a native speaker");
});

test("the page is one self-contained file that lists what was not counted and not tested, escapes the shop's name, and carries the code, digests, help line and the one assurance", () => {
  const report = November(month, { innovator: true });
  const sealed = seal(report);
  // B71 part 2: a UPI shop's report has its own words for the lines that named a gateway, so the page lists the report's own ids
  assert.ok(report.notCounted.every((id) => !(report.paidBy === "owner-marked" && id === "outside-agent")), "a UPI shop gets its UPI lines");
  for (const language of LANGUAGES) {
    const html = reportPage(sealed, language);
    assert.ok(html.includes(sealed.code) && html.includes(sealed.digest), language);
    assert.ok(!/<script|src=|href=|@import|url\(/i.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), `${language}: one file, nothing fetched`);
    for (const id of report.notCounted) assert.ok(html.includes(esc(STRINGS[language].notCounted[id])), `${language} lists ${id}`);
    for (const n of notTestedOf(month.settings)) assert.ok(html.includes(esc(STRINGS[language].notTested[n.id])), `${language} lists ${n.id}`);
    assert.ok(html.includes(badgeText(language)), `${language} shows the badge`);
    assert.ok(html.includes("₹1,660") && html.includes(esc(STRINGS[language].helpLine)) && html.includes(esc(STRINGS[language].promise)), language);
    const visible = html.replace(/<style>[\s\S]*?<\/style>/, "");
    assert.deepEqual(bannedIn(visible, language), [], language);
    assert.doesNotMatch(visible, FORBIDDEN, language);
  }
  assert.ok(reportPage(sealed, "hi").includes("वेज थाली"), "Hindi item names");
  assert.equal((reportPage(sealed, "both").match(/<section class="doc"/g) ?? []).length, 2, "both is Hindi and English on one page");
  const odd = { ...November(month), shop: { ...November(month).shop, name: "<b>Annapurna</b> & \"Sons\"" } };
  const page = reportPage(seal(odd), "en");
  assert.ok(!page.includes("<b>Annapurna</b>") && page.includes("&lt;b&gt;Annapurna&lt;/b&gt;"));
});

test("the files are written into the one folder named, with plain names", () => {
  const out = tempDir();
  const made = writeOrdersReport({ settings: month.settings, entries: month.record.entries(), orders: [...month.store.orders.values()], month: "2026-11", language: "both", out, source: "stand-in", preparedBy: "Divya", now: at(12, 1, 10) });
  assert.deepEqual(readdirSync(out).sort(), ["owner-2026-11-en.txt", "owner-2026-11-hi.txt", "report-2026-11-both.html", "report-2026-11.json"]);
  assert.equal(made.ownerTexts.length, 2);
  assert.ok(verifyEnvelopeText(readFileSync(join(out, "report-2026-11.json"), "utf8")).unchanged);
});

// ---- the WhatsApp message ------------------------------------------------------------------------------------------------------

test("the message is the owner's lines in every language: numbers from the report, the check code, the page address, the help line, who set it up", () => {
  const sealed = seal(November(month));
  for (const language of LANGUAGES) {
    const { text, template } = monthlyReportMessage(sealed, language, { link: "https://reports.example.com/r/abc/report-2026-11-en.html" });
    const s = STRINGS[language];
    assert.ok(text.includes(`${s.upiLabel.collected}: ₹1,660`), text);
    assert.ok(text.includes(`${s.upiLabel.givenBack}: ₹180`), text);
    assert.ok(text.includes(`${s.label.stillToCollect}: ₹240 (${s.label.orders}: 1)`), text);
    assert.ok(text.includes(`${s.label.ordersTaken}: 7`) && text.includes(`${s.label.cancelled}: 2`), text);
    assert.ok(text.includes(`${s.label.wasAsked}: 2`) && text.includes(`${s.label.approved}: 2`) && text.includes(`${s.label.saidNo}: 0`), text);
    assert.ok(text.includes(sealed.code) && text.includes("https://reports.example.com/r/abc/report-2026-11-en.html") && text.includes("Divya, local partner"), text);
    assert.ok(text.includes(s.helpLine), "the help line");
    assert.ok(text.startsWith(`${s.monthlyReport}: `), "starts with fixed words");
    assert.ok(text.endsWith("Geometer"), "ends with fixed words");
    assert.equal(template.name, "order_monthly_report_upi", "a UPI shop's money is labelled as marked by the owner");
    assert.equal(text.split("\n").length, 10, "the owner's lines, the code and page, the check link (item 17b), who set it up");
    assert.ok(text.includes(`${s.checkGenuine}: ${verifyLink(sealed)}`), "an unsigned report carries the #digest link");
    assert.deepEqual(bannedIn(text, language), [], language);
    assert.doesNotMatch(text, FORBIDDEN, language);
  }
});

test("the Innovator badge is one more line, the last, and only when the report carries the flag; a report that names no one is not turned into a message", async () => {
  for (const language of LANGUAGES) {
    const plain = monthlyReportMessage(seal(November(month)), language, { link: "https://x.example.com/a.html" });
    const badge = monthlyReportMessage(seal(November(month, { innovator: true })), language, { link: "https://x.example.com/a.html" });
    assert.equal(plain.template.name, "order_monthly_report_upi");
    assert.equal(badge.template.name, "order_monthly_report_upi_innovator");
    assert.ok(!plain.text.includes("★"));
    assert.equal(badge.text.split("\n").at(-1), badgeText(language));
    assert.equal(badge.text.split("\n").length, plain.text.split("\n").length + 1);
  }
  // a Razorpay shop uses the plain names
  const w = createWorld({ settings: annapurnaRazorpay(), nowMs: at(11, 2, 9), interactive: false });
  const razorpay = November(w);
  assert.equal(monthlyReportMessage(seal(razorpay), "en", { link: "https://x.example.com/a.html" }).template.name, "order_monthly_report");
  assert.equal(monthlyReportMessage(seal({ ...razorpay, innovator: true as const }), "en", { link: "https://x.example.com/a.html" }).template.name, "order_monthly_report_innovator");
  assert.ok(monthlyReportMessage(seal(razorpay), "en", { link: "https://x.example.com/a.html" }).text.includes("Advance collected: ₹0"));
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
      if (template.upi && !template.badge) assert.equal(fillBody(meta, parameters), monthlyReportMessage(sealed, language, { link: "https://x.example.com/a.html" }).text.replace("Divya, local partner", "Divya Nair"));
      assert.ok([...meta].length <= 1024);
    }
  }
  assert.deepEqual([...REPORT_TEMPLATE_NAMES], ["order_monthly_report", "order_monthly_report_innovator", "order_monthly_report_upi", "order_monthly_report_upi_innovator"]);
  assert.equal(reportSubmissions().length, 16);
  for (const s of reportSubmissions()) {
    assert.equal(s.category, "UTILITY");
    const examples = s.components[0].example.body_text[0];
    assert.equal(examples.length, (s.components[0].text.match(/\{\{\d+\}\}/g) ?? []).length, "an example for every value");
    assert.ok(examples.every((e) => e !== ""));
    assert.doesNotMatch(s.components[0].text, FORBIDDEN);
  }
});

// ---- the monthly job -------------------------------------------------------------------------------------------------------

const context = (w: World, log: string[] = []): MonthlyReportContext => ({ settings: w.settings, clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, save: () => undefined, log: (l) => log.push(l) });
const approveReports = (w: World) => { for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) w.messaging.approve(name, language); };

test("the shared monthly job sends the Orders report once, on the 1st from 09:00, as a template, with the numbers the stand-ins hold", async () => {
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
  assert.equal(sent[0].templateName, "order_monthly_report_upi");
  const marked = w.store.upi!.requests.flatMap((q) => q.marks).reduce((sum, m) => sum + m.amountPaise, 0) / 100;
  assert.ok(sent[0].text.includes(`Advance marked paid by owner: ₹${marked.toLocaleString("en-IN")}`), sent[0].text);
  assert.ok(sent[0].text.includes("Monthly report: Annapurna Tiffins · Nov 2026 · stand-in services, test money"), sent[0].text);
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
  w.clock.set(at(12, 1, 10)); // nothing happened in November
  assert.deepEqual(await job.run(context(w)), { done: false, why: "quiet" });
  assert.equal(w.record.entries().length, 0);
  assert.equal(w.messaging.sentTo(w.owner).length, 0);
});
