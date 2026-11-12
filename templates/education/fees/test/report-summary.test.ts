// Fees's papers with a signed summary in their link (item 17b; modules/report/summary.ts): a signed monthly report (layout 4) and go-live
// certificate (layout 3) print a summary that checks as genuine against the signer's listed key and says exactly what the paper says; an unsigned one keeps the
// #digest link; and the owner's monthly WhatsApp message carries the summary link when it fits WhatsApp's 1024 characters, the #digest link when it does not.
// Fees has no monthly record certificate yet. Written 11 Nov 2026; not yet run (the owner's instruction: all suites run together later).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brightTuition } from "../src/harness.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { keyIdOf, publicKeyHex, seal } from "../../../../modules/report/sign.ts";
import { verifyCodeLink, verifyLink } from "../../../../modules/report/verify-link.ts";
import { labelledFigures } from "../../../../modules/report/summary.ts";
import { WHATSAPP_BODY_LIMIT, checkSummaryLink, summaryLinkFor } from "../../../../modules/report/summary-sign.ts";
import type { ListedSigner } from "../../../../modules/report/summary-sign.ts";
import type { FeesReport } from "../report/data.ts";
import { reportPage } from "../report/html.ts";
import { sampleReport } from "../report/review.ts";
import { writeGoLiveCertificate } from "../report/run.ts";
import { STRINGS } from "../report/strings.ts";
import { reportSummaryFields } from "../report/summary.ts";
import { REPORT_TEMPLATES, monthlyReportMessage } from "../report/whatsapp.ts";

const { privateKey } = generateKeyPairSync("ed25519");
const publicKey = publicKeyHex(privateKey);
const LIST: ListedSigner[] = [{ key_id: keyIdOf(publicKey), public_key: publicKey, kind: "builder", name: "Kiran, Kiran Tech", since: "2026-11-11" }];
const S1 = /https:\/\/geometer\.dev\/verify\/#s1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu;

let dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "geo-summary-")); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

const live = (o: Partial<FeesReport> = {}): FeesReport => ({ ...sampleReport(), source: "live", preparedBy: "Divya, local partner", ...o });

test("a signed monthly report's summary is genuine under the listed key, names the full report and carries its figures in layout 4", () => {
  const r = live();
  const env = seal(r, privateKey);
  const link = summaryLinkFor(env, reportSummaryFields(r), privateKey)!;
  const check = checkSummaryLink(link, LIST);
  assert.equal(check.status, "genuine");
  if (check.status !== "genuine") return;
  assert.equal(check.summary.layout, 4);
  assert.equal(check.summary.digest, env.digest);
  assert.equal(check.summary.pathway, r.pathway.name);
  assert.equal(check.summary.source, "live");
  assert.deepEqual(labelledFigures(check.summary)!.map((f) => [f.id, f.value]), [["collected", r.money.collected.paise], ["givenBack", r.money.givenBack.paise], ["stillToCollect", r.fees.stillToCollect.paise], ["remindersSent", r.reminders.sent], ["takenOff", r.waivers.total.paise], ["asked", r.owner.asked], ["approved", r.owner.approved], ["saidNo", r.owner.denied], ["stoppedByLimits", r.stopped.total]]);
  const page = reportPage(env, "en", link);
  assert.ok(page.includes(`<a href="${link}" rel="noreferrer">`) && page.includes(STRINGS.en.page.scanSummary));
  const unsigned = reportPage(seal(r), "en");
  assert.ok(!unsigned.includes("#s1.") && unsigned.includes(verifyLink(seal(r))), "an unsigned report keeps the #digest link");
});

test("a UPI centre's summary says its money is what the owner marked", () => {
  const r = live({ paidBy: "owner-marked" });
  const check = checkSummaryLink(summaryLinkFor(seal(r, privateKey), reportSummaryFields(r), privateKey)!, LIST);
  assert.ok(check.status === "genuine" && check.summary.ownerMarked === true);
});

test("a signed go-live certificate ends its text with its summary link, which is genuine and from stand-in services", () => {
  const out = tempDir();
  const made = writeGoLiveCertificate({ settings: brightTuition(), handCheck: { held: 17, total: 17, checks: 90, failedTitles: [] }, language: "ml", out, key: privateKey, preparedBy: "Divya, local partner", now: Date.parse("2026-11-03T10:30:00+05:30") });
  const link = [...made.texts[0].matchAll(S1)][0][0];
  assert.equal(made.texts[0].split("\n").at(-1), `${STRINGS.ml.checkGenuine}: ${link}`);
  assert.ok(readFileSync(join(out, "go-live-certificate-ml.html"), "utf8").includes(link));
  const check = checkSummaryLink(link, LIST);
  assert.ok(check.status === "genuine" && check.summary.layout === 3 && check.summary.source === "stand-in" && check.summary.period === "2026-11-03");
});

test("every report template, in every language, with long names in the centre's own script, stays within WhatsApp's 1024 characters, and uses the longest check link that fits", () => {
  const names: Record<string, { shop: string; by: string }> = {
    en: { shop: "Sri Manjunatha Bright Tuition and Computer Training Centre", by: "Divya Ramakrishnan, Sri Sai Digital Services" },
    hi: { shop: "श्री मंजुनाथ ब्राइट ट्यूशन एंड कंप्यूटर ट्रेनिंग सेंटर", by: "दिव्या रामकृष्णन, श्री साई डिजिटल सर्विसेज़" },
    ml: { shop: "ശ്രീ മഞ്ജുനാഥ ബ്രൈറ്റ് ട്യൂഷൻ ആൻഡ് കമ്പ്യൂട്ടർ ട്രെയിനിംഗ് സെന്റർ", by: "ദിവ്യ രാമകൃഷ്ണൻ, ശ്രീ സായി ഡിജിറ്റൽ സർവീസസ്" },
    kn: { shop: "ಶ್ರೀ ಮಂಜುನಾಥ ಬ್ರೈಟ್ ಟ್ಯೂಷನ್ ಮತ್ತು ಕಂಪ್ಯೂಟರ್ ತರಬೇತಿ ಕೇಂದ್ರ", by: "ದಿವ್ಯಾ ರಾಮಕೃಷ್ಣನ್, ಶ್ರೀ ಸಾಯಿ ಡಿಜಿಟಲ್ ಸರ್ವೀಸಸ್" },
  };
  const page = `https://reports.example.com/r/${"a".repeat(32)}/report-2026-11-en.html`;
  // B75: and with three people who settled refunds by their word (never on a UPI shop: it has no gateway refund to settle)
  const settled = [{ by: "operator:asha.krishnamurthy.support.desk.team.one", count: 3, paise: 1_250_000 }, { by: "operator:ravi.k", count: 1, paise: 20_000 }, { by: "operator:meena", count: 1, paise: 100 }];
  for (const t of REPORT_TEMPLATES) {
    for (const language of LANGUAGES) for (const byWord of t.upi ? [undefined] : [undefined, settled]) {
      const base = sampleReport();
      const r = live({ preparedBy: names[language].by, shop: { ...base.shop, name: names[language].shop }, ...(t.badge ? { innovator: true as const } : {}), ...(t.upi ? { paidBy: "owner-marked" as const } : {}), ...(byWord ? { money: { ...base.money, settledByWord: byWord } } : {}) });
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
  }
});
