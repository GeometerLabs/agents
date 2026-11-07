// The Innovator badge (B56) on the monthly report page and its certificate: there only when the flag is on, part of the signed bytes when it is,
// and absent from the bytes when it is not, so every report made without it keeps the digest and code it always had.
import { test } from "node:test";
import assert from "node:assert/strict";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { buildMonthlyReport, reportBytes } from "../report/data.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { buildMonthlyCertificate, monthlyCertificatePage, monthlyCertificateText } from "../report/certificate.ts";
import { reportPage } from "../report/html.ts";
import { seal } from "../../../../modules/report/sign.ts";
import { STRINGS } from "../report/strings.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { BADGE_SYMBOL, badgeText } from "../../../../modules/report/text.ts";
import { writeClientReport } from "../report/run.ts";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const settings = glowSalon();
const range = monthRange("2026-11", settings.timezone);
const made = Date.UTC(2026, 11, 1, 4, 0);
const make = (innovator?: boolean) => buildMonthlyReport({ settings, entries: [], bookings: [], ...range, source: "live", madeAt: made, preparedBy: "Divya, local partner", ...(innovator === undefined ? {} : { innovator }) });

test("the badge is a word and a plain symbol in every language, and none of them is the word 'founding'", () => {
  for (const language of LANGUAGES) {
    const text = badgeText(language);
    assert.ok(text.startsWith(`${BADGE_SYMBOL} `) && text.length > 3, `${language}: ${text}`);
    assert.deepEqual(bannedIn(text, language), [], `${language}: ${text}`);
  }
  assert.equal(badgeText("en"), "★ Innovator");
  for (const language of LANGUAGES) assert.ok(!/found(ing|er)/iu.test(`${STRINGS[language].innovator} ${badgeText(language)}`));
});

test("without the flag the report has no badge and exactly the bytes it had before the flag existed", () => {
  const plain = make();
  assert.ok(!("innovator" in plain));
  assert.equal(reportBytes(make(false)), reportBytes(plain), "false is the same as leaving it out");
  assert.ok(!reportBytes(plain).includes("innovator"));
  assert.equal(seal(make(false)).digest, seal(plain).digest);
});

test("with the flag the badge is in the signed bytes, on the page in every language, and in the certificate (page and text)", () => {
  const plain = seal(make());
  const badged = seal(make(true));
  assert.equal(badged.document.innovator, true);
  assert.notEqual(badged.digest, plain.digest, "the badge is part of what is signed");
  assert.ok(reportBytes(badged.document).includes('"innovator":true'));
  const cert = seal(buildMonthlyCertificate(badged, made));
  const certPlain = seal(buildMonthlyCertificate(plain, made));
  assert.equal(cert.document.innovator, true);
  assert.ok(!("innovator" in certPlain.document));
  for (const language of LANGUAGES) {
    const badge = badgeText(language);
    assert.ok(reportPage(badged, language).includes(`<p class="badge">${badge}</p>`), `${language}: report page`);
    assert.ok(!reportPage(plain, language).includes("badge\">"), `${language}: no badge without the flag`);
    assert.ok(monthlyCertificatePage(cert, language).includes(`<p class="badge">${badge}</p>`), `${language}: certificate page`);
    assert.ok(!monthlyCertificatePage(certPlain, language).includes("badge\">"));
    assert.ok(monthlyCertificateText(cert, language).includes(badge), `${language}: certificate text`);
    assert.ok(!monthlyCertificateText(certPlain, language).includes(BADGE_SYMBOL));
    assert.ok(STRINGS[language].innovator.length > 0);
  }
});

test("writeClientReport puts the badge on the files only when told to, and hands back the sealed report", () => {
  const out = mkdtempSync(join(tmpdir(), "geo-badge-"));
  try {
    const run = { settings, entries: [], bookings: [], month: "2026-11", language: "en" as const, out, source: "live" as const, now: made, preparedBy: "Divya, local partner" };
    const without = writeClientReport(run);
    assert.equal(without.report.code, without.code);
    assert.ok(!readFileSync(join(out, "report-2026-11-en.html"), "utf8").includes("badge\">"));
    const withBadge = writeClientReport({ ...run, innovator: true });
    assert.equal(withBadge.report.document.innovator, true);
    assert.ok(readFileSync(join(out, "report-2026-11-en.html"), "utf8").includes("badge\">"));
    assert.ok(readFileSync(join(out, "certificate-2026-11-en.txt"), "utf8").includes(badgeText("en")));
    assert.notEqual(withBadge.code, without.code);
    assert.equal(readdirSync(out).length, 6, "the report and the certificate as data and page, and the owner's text and the certificate's text");
  } finally { rmSync(out, { recursive: true, force: true }); }
});
