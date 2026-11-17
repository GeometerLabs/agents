// The monthly Stock orders report: its numbers are counted from the record and the orders the stand-ins hold, it is signed and shows when it has been changed, every layer
// says what it was counted from and what it did not check, "paid" appears only as the owner's own note, no phone number is in it, the WhatsApp message is the owner's lines
// filled into a template named stock_..., and the shared monthly job sends it once. Written 17 Nov 2026; not yet run (the owner's instruction: all suites run together later).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { lastMonth } from "../../../../modules/report/monthly-job.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal, verifyEnvelopeText } from "../../../../modules/report/sign.ts";
import { labelledFigures } from "../../../../modules/report/summary.ts";
import { WHATSAPP_BODY_LIMIT, checkSummaryLink, summaryLinkFor } from "../../../../modules/report/summary-sign.ts";
import { verifyCodeLink, verifyLink } from "../../../../modules/report/verify-link.ts";
import type { ListedSigner } from "../../../../modules/report/summary-sign.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { notTestedOf } from "../crash-test/not-tested.ts";
import { NOT_COUNTED, RULE_IDS, buildStockReport } from "../report/data.ts";
import type { StockReport } from "../report/data.ts";
import { reportPage } from "../report/html.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportContext } from "../report/monthly-job.ts";
import { reportStringRows, sampleOwnerText, sampleReport } from "../report/review.ts";
import { writeStockReport } from "../report/run.ts";
import { STRINGS } from "../report/strings.ts";
import { reportSummaryFields } from "../report/summary.ts";
import { ownerText } from "../report/text.ts";
import { REPORT_SLOTS, REPORT_TEMPLATES, REPORT_TEMPLATE_NAMES, monthlyReportMessage, reportParameters, reportSlotsOf, reportSubmissions, sampleFor, sampleMessage, templateFor } from "../report/whatsapp.ts";
import { reservedPaise } from "../src/order.ts";
import { KUMAR, MEENA, RAVI, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, minute = 0): number => zonedToMs({ year: 2026, month, day }, { hour, minute }, TZ);
const { privateKey } = generateKeyPairSync("ed25519");
const publicKey = publicKeyHex(privateKey);
const LIST: ListedSigner[] = [{ key_id: keyIdOf(publicKey), public_key: publicKey, kind: "builder", name: "Kiran, Kiran Tech", since: "2026-11-17" }];

/** The words no owner document may use, in any language's page, text or message. */
const FORBIDDEN = /\b(safe|safely|guaranteed?|proves?|proven|certified|founders?|founding|earn|earnings?|income|bot)\b|100 ?%/i;
const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const November = (w: World, extra: { innovator?: boolean; preparedBy?: string } = {}): StockReport =>
  buildStockReport({
    settings: w.settings, entries: w.record.entries(), orders: w.orders(), ...monthRange("2026-11", TZ), source: "stand-in", madeAt: at(12, 1, 10),
    preparedBy: extra.preparedBy ?? "Divya, local Operator", innovator: extra.innovator,
  });

/**
 * A busy first half of November on the example salon:
 *   po-1 hair colour, 10 boxes from Ravi (₹4,500): the supplier says OK, 4 arrive (part)
 *   po-2 hair oil, 6 bottles from Meena (₹720): OK, all arrive, the owner marks it paid
 *   po-3 shampoo, 12 bottles from Ravi (₹2,160): the supplier says no (budget given back)
 *   po-4 towel, 10 pieces from Meena (₹900): OK, the wrong item arrives
 *   po-5 shampoo, 3 bottles from Meena (₹526.50): the supplier never answers
 * and one request the limits stop (500 bottles of hair oil).
 */
async function busyMonth(options: { markPaid?: boolean } = {}): Promise<World> {
  const w = createWorld();
  const orderAndApprove = async (text: string) => { await w.ownerSays(text); await w.ownerSays(w.approveText()); return [...w.store.orders.keys()].at(-1)!; };
  const po1 = await orderAndApprove("order 10 boxes of hair colour from Ravi Traders");
  await w.supplierSays(RAVI, "ok");
  await w.ownerSays(`received ${po1} 4`);
  const po2 = await orderAndApprove("order 6 bottles of hair oil from Meena Beauty Supplies");
  await w.supplierSays(MEENA, "ok");
  await w.ownerSays(`received ${po2}`);
  if (options.markPaid !== false) await w.ownerSays(`paid ${po2}`);
  await orderAndApprove("order 12 bottles of shampoo from Ravi Traders");
  await w.supplierSays(RAVI, "no");
  const po4 = await orderAndApprove("order 10 pieces of towel from Meena Beauty Supplies");
  await w.supplierSays(MEENA, "ok");
  await w.ownerSays(`wrong ${po4}`);
  await orderAndApprove("order 3 bottles of shampoo from Meena Beauty Supplies");
  await w.ownerSays("order 500 bottles of hair oil from Meena Beauty Supplies");
  return w;
}

let month: World;
let quiet: World; // the same month with no "paid" mark
test.before(async () => { month = await busyMonth(); quiet = await busyMonth({ markPaid: false }); });

let dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "geo-stock-report-")); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

test("the month's counts are the ones the scripted month was built to hold", () => {
  const r = November(month);
  assert.deepEqual(r.orders, { placed: 5, sentOut: 5, acknowledged: 3, declinedBySupplier: 1, silent: 1, receivedFull: 1, partReceived: 1, wrongItem: 1, neverSent: 0, sendUnknown: 0 });
  assert.deepEqual(r.owner, { asked: 5, approved: 5, saidNo: 0, voided: 0 });
  assert.deepEqual(r.markedPaidByOwner, { orders: 1 });
  assert.equal(r.source, "stand-in");
  assert.equal(r.anchor, null);
  assert.deepEqual(r.period.month, { year: 2026, month: 11 });
  assert.equal(r.pathway.name, "stock-orders");
  assert.ok(r.stopped.total >= 1 && r.stopped.byRule["order-quantity"] + r.stopped.byRule["per-order-cap"] >= 1, JSON.stringify(r.stopped));
  assert.equal(RULE_IDS.reduce((n, id) => n + r.stopped.byRule[id], 0) >= r.stopped.total, true, "every stop is under at least one rule");
});

test("each supplier's counts are counted from its own orders, under the name the shop gave it", () => {
  const r = November(month);
  assert.deepEqual(r.suppliers, [
    { id: "ravi-traders", name: "Ravi Traders", placed: 2, acknowledged: 1, receivedFull: 0, partReceived: 1, wrongItem: 0, declined: 1, silent: 0 },
    { id: "meena-beauty", name: "Meena Beauty Supplies", placed: 3, acknowledged: 2, receivedFull: 1, partReceived: 0, wrongItem: 1, declined: 0, silent: 1 },
  ]);
  assert.equal(r.suppliers.some((s) => s.id === "kumar-wholesale"), false, "a supplier nothing was ordered from has no row");
  assert.equal(r.suppliers.reduce((n, s) => n + s.placed, 0), r.orders.placed);
});

test("the budget used is what the placed orders hold, the same sum the agent reserves with, and a supplier's no gives it back", () => {
  const r = November(month);
  assert.equal(r.budget.usedPaise, reservedPaise(month.store, "2026-11"));
  assert.equal(r.budget.usedPaise, 450_000 + 72_000 + 90_000 + 52_650, "po-3 was declined by its supplier, so its ₹2,160 is not held");
  assert.equal(r.budget.monthlyPaise, 2_000_000);
  assert.equal(r.budget.leftPaise, 2_000_000 - r.budget.usedPaise);
  assert.equal(r.budget.usedPaise + month.order("po-3")!.totalPaise <= r.budget.monthlyPaise, true);
});

test("an order that was cancelled before it went out is counted as never sent and holds no budget", async () => {
  const w = createWorld({ unapproved: ["stock_order_to_supplier"] });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  assert.equal(w.order("po-1")?.state, "send_failed");
  await w.ownerSays("cancel po-1");
  const r = November(w);
  assert.equal(r.orders.placed, 1);
  assert.equal(r.orders.neverSent, 1);
  assert.equal(r.orders.sentOut, 0);
  assert.equal(r.orders.silent, 0, "nothing went out, so there is no silent supplier");
  assert.equal(r.budget.usedPaise, 0);
  assert.equal(r.budget.usedPaise, reservedPaise(w.store, "2026-11"));
});

test("the month is [from, to): orders approved in another month are not this month's", () => {
  const october = buildStockReport({ settings: month.settings, entries: month.record.entries(), orders: month.orders(), ...monthRange("2026-10", TZ), source: "stand-in", madeAt: at(11, 1, 10) });
  assert.equal(october.orders.placed, 0);
  assert.equal(october.record.entries, 0, "the record is counted by each entry's own time");
  const december = buildStockReport({ settings: month.settings, entries: month.record.entries(), orders: month.orders(), ...monthRange("2026-12", TZ), source: "stand-in", madeAt: at(12, 31, 10) });
  assert.equal(december.orders.placed, 0);
  assert.equal(december.budget.usedPaise, 0);
});

test("\"paid\" is the owner's own note: a separate count, never mixed into acknowledged or received, and the word is not there at all when nothing was marked", () => {
  const paid = November(month);
  const none = November(quiet);
  assert.equal(none.markedPaidByOwner.orders, 0);
  assert.deepEqual(paid.orders, none.orders, "marking an order paid changes no count of what the supplier said or what arrived");
  assert.equal(paid.budget.usedPaise, none.budget.usedPaise);
  for (const l of LANGUAGES) {
    const note = STRINGS[l].label.markedPaid;
    assert.ok(ownerText(paid, l).includes(note), `${l}: the owner's note is shown as the owner's own note`);
    assert.equal(ownerText(none, l).includes(note), false, `${l}: no note, no line`);
    assert.equal(reportPage(seal(none), l).includes(note), false, `${l}: the page too`);
  }
  assert.equal(/\bpaid\b/i.test(ownerText(none, "en")), false);
  assert.equal(/\bpaid\b/i.test(words(reportPage(seal(none), "en"))), false);
  const message = monthlyReportMessage(seal(none), "en", { link: "https://reports.example.com/r/t/report-2026-11-en.html" }).text;
  assert.equal(/\bpaid\b/i.test(message), false);
  assert.ok(monthlyReportMessage(seal(paid), "en", { link: "https://reports.example.com/r/t/report-2026-11-en.html" }).text.includes(`${STRINGS.en.label.markedPaid}: 1`));
  // and the page says the agent pays no one
  assert.ok(STRINGS.en.promise.includes("pays no one") && STRINGS.en.notCounted.payments.includes("pays no one"));
});

test("no phone number is in the report, its pages or its messages: not the owner's, not a supplier's", () => {
  const r = November(month);
  const numbers = [month.settings.owner.whatsapp, RAVI, MEENA, KUMAR, ...month.settings.suppliers.map((s) => s.whatsapp)];
  const sealed = seal(r, privateKey);
  const dir = tempDir();
  const made = writeStockReport({ settings: month.settings, entries: month.record.entries(), orders: month.orders(), month: "2026-11", language: "both", out: dir, source: "stand-in", key: privateKey, preparedBy: "Divya, local Operator", now: at(12, 1, 10) });
  const everything = [JSON.stringify(r), envelopeFile(sealed), ...made.files.map((f) => readFileSync(f, "utf8")), ...LANGUAGES.map((l) => ownerText(r, l)), ...LANGUAGES.map((l) => monthlyReportMessage(sealed, l, { link: "https://reports.example.com/r/t/x.html", ...(made.check ? { check: made.check } : {}) }).text)].join("\n");
  for (const n of numbers) {
    assert.equal(everything.includes(n), false, `the number ${n} is in a document`);
    assert.equal(everything.includes(n.replace(/^\+/, "")), false, `the number ${n} (without the plus) is in a document`);
    assert.equal(everything.includes(n.slice(-10)), false, `the last ten digits of ${n} are in a document`);
  }
  assert.equal(everything.includes(month.settings.address!), false, "the shop's street address is not in it either");
  assert.ok(everything.includes("Ravi Traders") && everything.includes("Meena Beauty Supplies"), "the shop's own supplier names are");
});

test("the report is signed, shows when a number is changed, and an unsigned one says it is not signed", () => {
  const signed = seal(November(month), privateKey);
  const text = envelopeFile(signed);
  const checked = verifyEnvelopeText(text);
  assert.ok(checked.unchanged && checked.signed, checked.summary);
  assert.ok(verifyEnvelopeText(text, [keyIdOf(publicKey)]).trusted, "trusted when its key is the one named");
  const changed = text.replace('"placed":5', '"placed":9');
  assert.notEqual(changed, text);
  assert.equal(verifyEnvelopeText(changed).unchanged, false, "a changed number is seen");
  const unsigned = verifyEnvelopeText(envelopeFile(seal(November(month))));
  assert.ok(unsigned.unchanged && !unsigned.signed);
  assert.match(reportPage(seal(November(month)), "en"), /Not signed/);
});

test("the signed summary link is genuine under the listed key and carries the report's own figures in layout 6", () => {
  const r = November(month);
  const env = seal(r, privateKey);
  const link = summaryLinkFor(env, reportSummaryFields(r), privateKey)!;
  const check = checkSummaryLink(link, LIST);
  assert.equal(check.status, "genuine");
  if (check.status !== "genuine") return;
  assert.equal(check.summary.layout, 6);
  assert.equal(check.summary.digest, env.digest);
  assert.equal(check.summary.pathway, "stock-orders");
  assert.equal(check.summary.ownerMarked, false);
  const o = r.orders;
  assert.deepEqual(labelledFigures(check.summary)!.map((f) => [f.id, f.value]), [
    ["ordersPlaced", o.placed], ["acknowledged", o.acknowledged], ["receivedFull", o.receivedFull], ["partReceived", o.partReceived], ["wrongItem", o.wrongItem], ["supplierSaidNo", o.declinedBySupplier],
    ["noAnswer", o.silent], ["neverSent", o.neverSent], ["budgetUsed", r.budget.usedPaise], ["markedPaid", r.markedPaidByOwner.orders], ["stoppedByLimits", r.stopped.total],
  ]);
  const page = reportPage(env, "en", link);
  assert.ok(page.includes(`<a href="${link}" rel="noreferrer">`) && page.includes(STRINGS.en.page.scanSummary));
});

test("every layer says what it was counted from and that the checks were run by hand, in every language, and lists what was not checked", () => {
  const r = November(month);
  assert.equal(r.notTested.length, notTestedOf(month.settings).length + 1, "the hand check's list, and one more because no go-live certificate was given");
  assert.ok(r.notTested.includes("no-go-live-certificate"));
  assert.deepEqual(r.notCounted, [...NOT_COUNTED]);
  for (const l of LANGUAGES) {
    const s = STRINGS[l];
    const text = ownerText(r, l);
    assert.ok(text.includes(s.sourceTag["stand-in"]) && text.includes(s.handRun) && text.includes(s.label.notChecked), l);
    const html = words(reportPage(seal(r), l));
    for (const id of r.notTested) assert.ok(html.includes(s.notTested[id]), `${l}: ${id}`);
    for (const id of r.notCounted) assert.ok(html.includes(s.notCounted[id]), `${l}: ${id}`);
    assert.ok(html.includes(s.goLive.none) && html.includes(s.promise) && html.includes(s.page.notAGrade), l);
  }
});

test("the owner's text, the page and the message read in four languages with no banned or promising word, and carry the same counts", () => {
  const r = November(month, { innovator: true });
  const sealed = seal(r);
  for (const l of LANGUAGES) {
    const text = ownerText(r, l);
    const page = words(reportPage(sealed, l));
    const message = monthlyReportMessage(sealed, l, { link: "https://reports.example.com/r/t/report-2026-11-en.html" }).text;
    for (const [what, doc] of [["text", text], ["page", page], ["message", message]] as const) {
      assert.equal(FORBIDDEN.test(doc), false, `${l} ${what}: ${doc.match(FORBIDDEN)?.[0]}`);
      assert.deepEqual(bannedIn(doc, l), [], `${l} ${what}`);
    }
    for (const row of reportStringRows(l)) assert.deepEqual(bannedIn(row.text, l), [], `${l} ${row.id}`);
    assert.ok(text.split("\n").length === 6, `${l}: six short lines`);
    assert.ok(text.includes(`${STRINGS[l].label.placed}: 5`) && text.includes(`${STRINGS[l].label.noAnswer}: 1`), l);
    assert.ok(message.includes(STRINGS[l].page.setUpBy) && message.includes("Divya, local Operator"), l);
  }
  assert.ok(ownerText(r, "hi").includes(STRINGS.hi.label.placed), "Hindi text is in Hindi");
});

test("every Hindi, Malayalam and Kannada phrase is in the review rows, with its English beside it, and no phrase is left empty or in English", () => {
  for (const l of ["hi", "ml", "kn"] as const) {
    const rows = reportStringRows(l);
    const en = reportStringRows("en");
    assert.deepEqual(rows.map((x) => x.id).sort(), en.map((x) => x.id).sort(), `${l}: the same phrases as the English, none missing and none extra`);
    assert.ok(rows.length > 100, `${l}: ${rows.length} rows`);
    for (const row of rows) {
      assert.ok(row.english !== "", `${l} ${row.id}: has an English meaning`);
      assert.ok(/[^\u0000-\u007f]/u.test(row.text), `${l} ${row.id}: ${row.text} is not in the language`);
    }
  }
  for (const l of ["hi", "ml", "kn"] as const) assert.ok(sampleOwnerText(l).length > 100);
});

test("the WhatsApp templates are named stock_..., fill to the same words as the plain text, and are listed for Meta with a value for every slot", () => {
  assert.deepEqual([...REPORT_TEMPLATE_NAMES], ["stock_monthly_report", "stock_monthly_report_innovator"]);
  assert.ok(REPORT_TEMPLATE_NAMES.every((n) => n.startsWith("stock_")));
  const r = November(month);
  for (const innovator of [false, true]) for (const l of LANGUAGES) {
    const env = seal({ ...r, ...(innovator ? { innovator: true as const } : {}) });
    const message = monthlyReportMessage(env, l, { link: "https://reports.example.com/r/t/report-2026-11-en.html" });
    const t = templateFor(env.document);
    assert.equal(message.template.name, innovator ? "stock_monthly_report_innovator" : "stock_monthly_report");
    assert.equal(message.template.text, message.text);
    assert.equal(fillBody(metaBody(t.bodies[l]), message.template.parameters!), message.text);
    assert.equal(message.template.parameters!.length, reportSlotsOf(t.bodies[l]).length);
    assert.ok(message.template.parameters!.every((p) => p === p.replace(/\s+/g, " ").trim()), "a value is one line");
    assert.equal(message.text.includes("★ Innovator") || message.text.includes(STRINGS[l].page.code), true);
  }
  for (const t of REPORT_TEMPLATES) for (const l of LANGUAGES) {
    const body = metaBody(t.bodies[l]);
    assert.ok(!/^\{\{\d+\}\}/.test(body) && !/\{\{\d+\}\}\s*$/.test(body), `${t.name} ${l}: starts and ends with fixed words`);
    assert.ok(!/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body), `${t.name} ${l}: no two values side by side`);
    assert.ok(reportParameters(t, l, Object.fromEntries(REPORT_SLOTS.map((s) => [s, "x"])) as never).length === reportSlotsOf(t.bodies[l]).length);
    assert.equal(FORBIDDEN.test(body), false);
  }
  assert.throws(() => reportSlotsOf("hello {nothing}"), /unknown value/);
  const subs = reportSubmissions();
  assert.equal(subs.length, REPORT_TEMPLATES.length * LANGUAGES.length);
  for (const s of subs) assert.equal(s.components[0].example.body_text[0].length, (s.components[0].text.match(/\{\{\d+\}\}/g) ?? []).length, `${s.name} ${s.language}`);
  assert.ok(sampleFor(REPORT_TEMPLATES[1]).innovator === true && sampleFor(REPORT_TEMPLATES[0]).innovator === undefined);
  assert.ok(sampleMessage("en").includes("Innovator"));
});

test("every report template, in every language, with long names in the shop's own script and the owner's note shown, stays within WhatsApp's 1024 characters and uses the longest check link that fits", () => {
  const names: Record<string, { shop: string; by: string }> = {
    en: { shop: "Sri Annapurna Home Tiffins and Evening Snacks Centre", by: "Divya Ramakrishnan, Sri Sai Digital Services" },
    hi: { shop: "श्री अन्नपूर्णा होम टिफ़िन एंड इवनिंग स्नैक्स सेंटर", by: "दिव्या रामकृष्णन, श्री साई डिजिटल सर्विसेज़" },
    ml: { shop: "ശ്രീ അന്നപൂർണ്ണ ഹോം ടിഫിൻസ് ആൻഡ് ഈവനിംഗ് സ്നാക്സ് സെന്റർ", by: "ദിവ്യ രാമകൃഷ്ണൻ, ശ്രീ സായി ഡിജിറ്റൽ സർവീസസ്" },
    kn: { shop: "ಶ್ರೀ ಅನ್ನಪೂರ್ಣ ಹೋಮ್ ಟಿಫಿನ್ಸ್ ಮತ್ತು ಸಂಜೆ ತಿಂಡಿ ಕೇಂದ್ರ", by: "ದಿವ್ಯಾ ರಾಮಕೃಷ್ಣನ್, ಶ್ರೀ ಸಾಯಿ ಡಿಜಿಟಲ್ ಸರ್ವೀಸಸ್" },
  };
  const page = `https://reports.example.com/r/${"a".repeat(32)}/report-2026-11-en.html`;
  for (const t of REPORT_TEMPLATES) for (const language of LANGUAGES) {
    const base = sampleReport();
    const r: StockReport = { ...base, source: "stand-in", preparedBy: names[language].by, shop: { ...base.shop, name: names[language].shop }, ...(t.badge ? { innovator: true as const } : {}),
      markedPaidByOwner: { orders: 12 }, budget: { monthlyPaise: 123_456_700, usedPaise: 98_765_400, leftPaise: 1 } };
    const env = seal(r, privateKey);
    const summary = summaryLinkFor(env, reportSummaryFields(r), privateKey)!;
    const message = monthlyReportMessage(env, language, { link: page, check: summary });
    assert.equal(message.template.name, t.name);
    assert.ok(message.text.length <= WHATSAPP_BODY_LIMIT, `${t.name} (${language}): ${message.text.length} characters`);
    // the longest link that fits: the summary, else the #digest link, else the #code link (messageCheckLink)
    const tiers = [summary, verifyLink(env), verifyCodeLink(env)];
    const used = tiers.find((link) => message.text.includes(`${STRINGS[language].checkGenuine}: ${link}\n`))!;
    assert.ok(used, `${t.name} (${language}): the check line carries one of the three links`);
    for (const longer of tiers.slice(0, tiers.indexOf(used))) assert.ok(message.text.length - used.length + longer.length > WHATSAPP_BODY_LIMIT, `${t.name} (${language}): ${longer.slice(0, 40)}… would have fitted`);
    assert.equal(message.template.text, message.text);
  }
});

test("a report without the person who set the agent up cannot be sent as a message", () => {
  const r = buildStockReport({ settings: month.settings, entries: [], orders: [], ...monthRange("2026-11", TZ), source: "live", madeAt: at(12, 1, 10) });
  assert.throws(() => monthlyReportMessage(seal(r), "en", { link: "https://x.example/r" }), /names no one who set the agent up/);
});

test("the files are written into the one folder named, by fixed names, for one language and for Hindi and English together", () => {
  const out = tempDir();
  const made = writeStockReport({ settings: month.settings, entries: month.record.entries(), orders: month.orders(), month: "2026-11", language: "both", out, source: "stand-in", preparedBy: "Divya", now: at(12, 1, 10) });
  assert.deepEqual(readdirSync(out).sort(), ["owner-2026-11-en.txt", "owner-2026-11-hi.txt", "report-2026-11-both.html", "report-2026-11.json"].sort());
  assert.equal(made.files.length, 4);
  assert.equal(made.check, undefined, "no key, so no signed summary link");
  const one = tempDir();
  writeStockReport({ settings: month.settings, entries: month.record.entries(), orders: month.orders(), month: "2026-11", language: "ml", out: one, source: "stand-in", preparedBy: "Divya", now: at(12, 1, 10) });
  assert.deepEqual(readdirSync(one).sort(), ["owner-2026-11-ml.txt", "report-2026-11-ml.html", "report-2026-11.json"]);
  assert.throws(() => buildStockReport({ settings: month.settings, entries: [], orders: [], from: 5, to: 5, source: "stand-in", madeAt: 0 }), /must end after it starts/);
  assert.throws(() => buildStockReport({ settings: month.settings, entries: [], orders: [], ...monthRange("2026-11", TZ), source: "nope" as never, madeAt: 0 }), /Say what the numbers were counted from/);
});

test("the sample month the review sheets use reads as a month", () => {
  const r = sampleReport();
  assert.equal(r.orders.placed, 9);
  assert.ok(ownerText(r, "en").includes("Budget used: ₹9,000 of ₹20,000"));
});

// ---- the shared monthly job ----------------------------------------------------------------------------------------------------

const context = (w: World, log: string[] = []): MonthlyReportContext => ({ settings: w.settings, clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, save: () => undefined, log: (l) => log.push(l) });
const approveReports = (w: World) => { for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) w.messaging.approve(name, language); };

test("the shared monthly job sends the Stock orders report once, on the 1st from 09:00, as a stock_ template, with the numbers the stand-ins hold", async () => {
  const w = await busyMonth();
  approveReports(w);
  const dir = tempDir();
  let n = 0;
  const job = createMonthlyReport({ source: "stand-in", pages: { dir, baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, local Operator", innovator: false }), token: () => `t${++n}`.padEnd(8, "0") });
  assert.equal(lastMonth(at(12, 1, 9), TZ), "2026-11");
  w.clock.set(at(12, 1, 8, 59));
  assert.deepEqual(await job.run(context(w)), { done: false, why: "not-yet" });
  const before = w.messaging.sentTo(w.owner).length;
  w.clock.set(at(12, 1, 9));
  assert.deepEqual(await job.run(context(w)), { done: true, month: "2026-11", outcome: "confirmed", via: "template" });
  const sent = w.messaging.sentTo(w.owner).slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateName, "stock_monthly_report");
  assert.ok(sent[0].text.includes("*Monthly report: Glow Unisex Salon · Nov 2026 · stand-in services, test money*"), sent[0].text);
  assert.ok(sent[0].text.includes("Orders placed: *5*") && sent[0].text.includes("No answer from the supplier: *1*"), sent[0].text);
  assert.ok(sent[0].text.includes("Budget used: *₹6,646.5 of ₹20,000"), sent[0].text);
  assert.ok(sent[0].text.includes("https://reports.example.com/r/t1000000/report-2026-11-en.html"), sent[0].text);
  for (const [d, h] of [[1, 9], [1, 15], [2, 9], [15, 10]]) { w.clock.set(at(12, d, h)); await job.run(context(w)); }
  assert.equal(w.messaging.sentTo(w.owner).length, before + 1, "never twice");
  const entries = w.record.entries().filter((e) => e.action === "send_message" && e.refs.report === "2026-11");
  assert.deepEqual(entries.map((e) => e.outcome), ["attempted", "confirmed"]);
  assert.deepEqual(readdirSync(dir), ["t1000000"]);
  assert.deepEqual(readdirSync(join(dir, "t1000000")).sort(), ["owner-2026-11-en.txt", "report-2026-11-en.html", "report-2026-11.json"]);
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
