// Bookings' papers with a signed summary in their link (item 17b; modules/report/summary.ts): a signed report, monthly record certificate and go-live
// certificate each print a summary that checks as genuine against the signer's listed key and says exactly what the paper says; an unsigned one keeps the
// #digest link; and the owner's monthly WhatsApp message carries the summary link when it fits WhatsApp's 1024 characters, the #digest link when it does not.
// Written 11 Nov 2026; not yet run (the owner's instruction: all suites run together later).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, glowSalon } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { keyIdOf, publicKeyHex, seal } from "../../../../modules/report/sign.ts";
import { verifyCodeLink, verifyLink } from "../../../../modules/report/verify-link.ts";
import { labelledFigures } from "../../../../modules/report/summary.ts";
import { WHATSAPP_BODY_LIMIT, checkSummaryLink, summaryLinkFor } from "../../../../modules/report/summary-sign.ts";
import type { ListedSigner } from "../../../../modules/report/summary-sign.ts";
import type { MonthlyReport } from "../report/data.ts";
import { createMonthlyReport } from "../report/monthly-job.ts";
import type { MonthlyReportContext } from "../report/monthly-job.ts";
import { sampleReport } from "../report/review.ts";
import { writeClientReport, writeGoLiveCertificate } from "../report/run.ts";
import { STRINGS } from "../report/strings.ts";
import { reportSummaryFields } from "../report/summary.ts";
import { REPORT_TEMPLATES, REPORT_TEMPLATE_NAMES, monthlyReportMessage } from "../report/whatsapp.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number) => zonedToMs({ year: 2026, month, day }, { hour, minute: 0 }, TZ);
const { privateKey } = generateKeyPairSync("ed25519");
const publicKey = publicKeyHex(privateKey);
const LIST: ListedSigner[] = [{ key_id: keyIdOf(publicKey), public_key: publicKey, kind: "geometer", name: "Geometer", since: "2026-11-11" }];
const S1 = /https:\/\/geometer\.dev\/verify\/#s1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu;

let dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "geo-summary-")); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

/** A shop with a November: one haircut booked and its deposit paid; the report templates approved. */
async function novemberWorld(): Promise<World> {
  const w = createWorld();
  for (const name of REPORT_TEMPLATE_NAMES) for (const language of LANGUAGES) w.messaging.approve(name, language);
  await w.say("haircut tomorrow at 6pm");
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  return w;
}

test("a signed report and its certificate print a summary link that is genuine under the listed key and says what the paper says", async () => {
  const w = await novemberWorld();
  const out = tempDir();
  const made = writeClientReport({ settings: w.settings, entries: w.record.entries(), bookings: [...w.store.bookings.values()], month: "2026-11", language: "en", out, source: "live", key: privateKey, preparedBy: "Divya, local partner", now: at(12, 1, 9) });
  assert.ok(made.check, "a signed report has a summary link");
  const check = checkSummaryLink(made.check!, LIST);
  assert.equal(check.status, "genuine");
  if (check.status !== "genuine") return;
  const r = made.report.document;
  assert.equal(check.summary.digest, made.report.digest, "it names the full paper");
  assert.deepEqual(check.summary.figures, reportSummaryFields(r).figures);
  assert.deepEqual(labelledFigures(check.summary)!.map((f) => [f.id, f.value]), [["bookingsMade", r.bookings.made], ["deposits", r.money.deposits.paise], ["givenBack", r.money.refunds.paise], ["stoppedByLimits", r.stopped.total], ["asked", r.owner.asked], ["approved", r.owner.approved], ["saidNo", r.owner.denied], ["notConfirmed", r.unconfirmed.openOnBookings]]);
  assert.equal(check.summary.shop, "Glow Salon");
  assert.equal(check.summary.period, "2026-11");
  assert.equal(check.summary.source, "live");
  assert.equal(check.summary.by, "Divya, local partner");
  assert.equal(check.summary.ownerMarked, false);

  const page = readFileSync(join(out, "report-2026-11-en.html"), "utf8");
  assert.ok(page.includes(`<a href="${made.check}" rel="noreferrer">`) && page.includes(STRINGS.en.page.scanSummary) && page.includes('<meta name="referrer" content="no-referrer">'));
  // still self-contained (report-render.test.ts): the one thing a reader can follow is the check link, and nothing is loaded from anywhere
  assert.deepEqual([...page.matchAll(/href="([^"]*)"/gu)].map((m) => m[1]), [made.check]);
  for (const forbidden of ["<script", "<link", "<img", "<iframe", "url(", "@import", "src="]) assert.ok(!page.includes(forbidden), forbidden);
  assert.ok(!/https?:|\/\/[a-z]/iu.test(page.split(made.check!).join("")), "no address but the check link");
  assert.ok(page.includes("default-src 'none'"));
  // the monthly record certificate has its own summary (layout 2), on its page and at the end of its text
  const certPage = readFileSync(join(out, "certificate-2026-11-en.html"), "utf8");
  const certText = readFileSync(join(out, "certificate-2026-11-en.txt"), "utf8");
  const certLink = [...certPage.matchAll(S1)][0][0];
  assert.notEqual(certLink, made.check);
  assert.ok(certText.trimEnd().endsWith(`${STRINGS.en.checkGenuine}: ${certLink}`), certText);
  const cert = checkSummaryLink(certLink, LIST);
  assert.ok(cert.status === "genuine" && cert.summary.layout === 2 && cert.summary.figures[0] === r.bookings.made);
});

test("an unsigned report has no summary: the page keeps the #digest link and the old words", async () => {
  const w = await novemberWorld();
  const out = tempDir();
  const made = writeClientReport({ settings: w.settings, entries: w.record.entries(), bookings: [...w.store.bookings.values()], month: "2026-11", language: "en", out, source: "live", preparedBy: "Divya, local partner", now: at(12, 1, 9) });
  assert.equal(made.check, undefined);
  const page = readFileSync(join(out, "report-2026-11-en.html"), "utf8");
  assert.ok(page.includes(verifyLink(made.report)) && !page.includes("#s1.") && page.includes(STRINGS.en.page.scanToCheck));
  assert.ok(!readFileSync(join(out, "certificate-2026-11-en.txt"), "utf8").includes("#s1."));
});

test("a signed go-live certificate's summary: held, total, failed, not tested, on its date, from stand-in services", () => {
  const out = tempDir();
  const issued = Date.parse("2026-11-03T10:30:00+05:30");
  const made = writeGoLiveCertificate({ settings: glowSalon(), handCheck: { held: 33, total: 33, checks: 196, failedTitles: [] }, language: "hi", out, key: privateKey, preparedBy: "Divya, local partner", now: issued });
  const link = [...made.texts[0].matchAll(S1)][0][0];
  assert.equal(made.texts[0].split("\n").at(-1), `${STRINGS.hi.checkGenuine}: ${link}`, "the text ends with the check link");
  assert.ok(!made.texts[0].includes(`/verify/#${made.code}`), "the short /verify/#code is not printed beside it");
  assert.ok(readFileSync(join(out, "go-live-certificate-hi.html"), "utf8").includes(link));
  const check = checkSummaryLink(link, LIST);
  assert.ok(check.status === "genuine");
  if (check.status !== "genuine") return;
  assert.equal(check.summary.layout, 3);
  assert.equal(check.summary.source, "stand-in", "the hand check runs on stand-in services: the summary can never read as live");
  assert.equal(check.summary.period, "2026-11-03");
  assert.deepEqual(check.summary.figures.slice(0, 3), [33, 33, 0]);
});

test("a UPI shop's summary says its money is what the owner marked", () => {
  const upi: MonthlyReport = { ...sampleReport(), source: "live", preparedBy: "Divya, local partner", paidBy: "owner-marked" };
  const env = seal(upi, privateKey);
  const check = checkSummaryLink(summaryLinkFor(env, reportSummaryFields(upi), privateKey)!, LIST);
  assert.ok(check.status === "genuine" && check.summary.ownerMarked === true);
});

test("the monthly job sends the owner the summary link of the report it signed, and it checks as genuine", async () => {
  const w = await novemberWorld();
  let n = 0;
  const job = createMonthlyReport({ source: "live", pages: { dir: tempDir(), baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, local partner", innovator: false }), key: privateKey, token: () => `t${++n}`.padEnd(8, "0") });
  const context: MonthlyReportContext = { settings: w.settings, clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, save: () => undefined };
  w.clock.set(at(12, 1, 9));
  await job.run(context);
  const [sent] = w.messaging.sentTo(w.owner);
  const link = [...sent.text.matchAll(S1)].map((m) => m[0]);
  assert.equal(link.length, 1, sent.text);
  assert.ok(sent.text.includes(`${STRINGS.en.checkGenuine}: ${link[0]}`));
  assert.equal(checkSummaryLink(link[0], LIST).status, "genuine");
});

test("every report template, in every language, with long names in the shop's own script, stays within WhatsApp's 1024 characters, and uses the longest check link that fits", () => {
  const names: Record<string, { shop: string; by: string }> = {
    en: { shop: "Sri Manjunatha Beauty Parlour and Bridal Studio", by: "Divya Ramakrishnan, Sri Sai Digital Services" },
    hi: { shop: "श्री मंजुनाथ ब्यूटी पार्लर एंड ब्राइडल स्टूडियो", by: "दिव्या रामकृष्णन, श्री साई डिजिटल सर्विसेज़" },
    ml: { shop: "ശ്രീ മഞ്ജുനാഥ ബ്യൂട്ടി പാർലർ ആൻഡ് ബ്രൈഡൽ സ്റ്റുഡിയോ", by: "ദിവ്യ രാമകൃഷ്ണൻ, ശ്രീ സായി ഡിജിറ്റൽ സർവീസസ്" },
    kn: { shop: "ಶ್ರೀ ಮಂಜುನಾಥ ಬ್ಯೂಟಿ ಪಾರ್ಲರ್ ಮತ್ತು ಬ್ರೈಡಲ್ ಸ್ಟುಡಿಯೋ", by: "ದಿವ್ಯಾ ರಾಮಕೃಷ್ಣನ್, ಶ್ರೀ ಸಾಯಿ ಡಿಜಿಟಲ್ ಸರ್ವೀಸಸ್" },
  };
  const link = `https://reports.example.com/r/${"a".repeat(32)}/report-2026-11-en.html`;
  // B75: and with three people who settled refunds by their word (never on a UPI shop: it has no gateway refund to settle)
  const settled = [{ by: "operator:asha.krishnamurthy.support.desk.team.one", count: 3, paise: 1_250_000 }, { by: "operator:ravi.k", count: 1, paise: 20_000 }, { by: "operator:meena", count: 1, paise: 100 }];
  for (const t of REPORT_TEMPLATES) {
    for (const language of LANGUAGES) for (const byWord of t.upi ? [undefined] : [undefined, settled]) {
      const base = sampleReport();
      const r: MonthlyReport = { ...base, source: "live", preparedBy: names[language].by, shop: { ...base.shop, name: names[language].shop }, ...(t.badge ? { innovator: true as const } : {}), ...(t.upi ? { paidBy: "owner-marked" as const } : {}), ...(byWord ? { money: { ...base.money, settledByWord: byWord } } : {}) };
      const env = seal(r, privateKey);
      const summary = summaryLinkFor(env, reportSummaryFields(r), privateKey)!;
      const message = monthlyReportMessage(env, language, { link, check: summary });
      assert.equal(message.template.name, t.name);
      assert.ok(message.text.length <= WHATSAPP_BODY_LIMIT, `${t.name} (${language}): ${message.text.length} characters`);
      // the longest link that fits: the summary, else the #digest link, else the #code link (messageCheckLink)
      const tiers = [summary, verifyLink(env), verifyCodeLink(env)];
      const used = tiers.find((link) => message.text.includes(`${STRINGS[language].checkGenuine}: ${link}\n`))!;
      assert.ok(used, `${t.name} (${language}): the check line carries one of the three links`);
      // the fallback is taken only when the summary would not have fitted
      for (const longer of tiers.slice(0, tiers.indexOf(used))) assert.ok(message.text.length - used.length + longer.length > WHATSAPP_BODY_LIMIT, `${t.name} (${language}): ${longer.slice(0, 40)}… would have fitted`);
      assert.equal(message.template.text, message.text, "the template and the text agree");
    }
  }
});
