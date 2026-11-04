// The two certificates. The go-live certificate is made from a real run of the hand check and has to say what the hand check
// says: the same counts, the same list of what was not tested, and "stand-in services". Both certificates state facts,
// list what was not tested, carry a short code and the full digest, and never use a word that grades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HAND_RUN, NOT_TESTED, STAND_IN_SERVICES } from "../crash-test/not-tested.ts";
import { runAll, runOn } from "../crash-test/situations.ts";
import { MONTH_NAMES, formatInr } from "../src/language/format.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES, parseSettings } from "../src/settings.ts";
import { buildGoLiveCertificate, buildMonthlyCertificate, goLivePage, goLiveText, monthlyCertificatePage, monthlyCertificateText, summariseHandCheck, summariseRun } from "../report/certificate.ts";
import type { HandCheckSummary } from "../report/certificate.ts";
import { NOT_COUNTED, buildMonthlyReport, checkedPolicyDigest as checkedGlow, monthRange } from "../report/data.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { seal } from "../report/sign.ts";
import { STRINGS, bannedIn } from "../report/strings.ts";
import { languagesOf } from "../report/text.ts";
import type { ReportLanguage } from "../report/text.ts";

const settings = glowSalon();
const ALL: ReportLanguage[] = [...LANGUAGES, "both"];
const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const ISSUED = Date.parse("2027-02-04T10:30:00+05:30");

let hand: Promise<HandCheckSummary> | undefined;
const handCheck = () => (hand ??= runAll().then(summariseHandCheck));

test("the go-live certificate says what the hand check says: the same counts, the same list, the same words", async () => {
  const summary = await handCheck();
  assert.deepEqual([summary.held, summary.total, summary.failedTitles.length], [34, 34, 0]);
  const env = seal(buildGoLiveCertificate({ settings, handCheck: summary, issuedAt: ISSUED }));
  const cert = env.document;
  assert.deepEqual(cert.checks, { held: 34, total: 34, failed: 0, failedTitles: [], checks: summary.checks });
  assert.deepEqual(cert.notTested, NOT_TESTED.map((n) => n.id), "Glow Salon's own settings are what the situations ran on, so nothing is added");
  assert.ok(goLiveText(env, "en").includes("Held 34 of 34 situations. 0 failed. 14 not tested."));
  // the hand check's own output, run for real: same counts, same list, same phrase
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/hand-check.ts", import.meta.url))], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.ok(run.stdout.includes("Held 34 of 34.  0 failed.  14 not tested."));
  assert.ok(run.stdout.includes(STAND_IN_SERVICES) && run.stdout.includes(HAND_RUN));
  assert.ok(run.stdout.includes(NOT_TESTED.map((n) => n.text).join(" · ")));
  assert.ok(goLiveText(env, "en").includes(STAND_IN_SERVICES), `the certificate says "${STAND_IN_SERVICES}" exactly as the hand check does`);
  assert.ok(goLiveText(env, "en").includes("by hand"));
  for (const language of LANGUAGES) {
    assert.ok(goLiveText(env, language).includes(STAND_IN_SERVICES), `${language}: "${STAND_IN_SERVICES}" is kept in Latin letters beside the translation`);
    assert.ok(words(goLivePage(env, language)).includes(STAND_IN_SERVICES));
  }
  assert.equal(cert.ranAs.against, STAND_IN_SERVICES);
  assert.equal(cert.source, "stand-in");
});

test("a shop whose settings are not the ones the situations ran on gets one more thing not tested, and the policy digests show it", async () => {
  const other = parseSettings({ ...JSON.parse(JSON.stringify(settings)), name: "Bright Salon", deposit: { amountInr: 100, holdMinutes: 20 }, cancellation: { windowHours: 12, refundLimitInr: 150 } });
  const summary = await handCheck();
  const own = seal(buildGoLiveCertificate({ settings, handCheck: summary, issuedAt: ISSUED })).document;
  const bright = seal(buildGoLiveCertificate({ settings: other, handCheck: summary, issuedAt: ISSUED })).document;
  assert.equal(own.policyDigest, own.checkedPolicyDigest);
  assert.notEqual(bright.policyDigest, bright.checkedPolicyDigest);
  assert.equal(bright.checkedPolicyDigest, own.checkedPolicyDigest);
  assert.equal(bright.notTested.length, 15);
  assert.equal(bright.notTested.at(-1), "own-settings");
  const env = seal(bright);
  assert.ok(goLiveText(env, "en").includes("Held 34 of 34 situations. 0 failed. 15 not tested."));
  assert.ok(goLiveText(env, "en").includes("these checks on this shop's own settings (they ran on the example shop, Glow Salon)"));
  for (const language of LANGUAGES) assert.ok(words(goLivePage(env, language)).includes(STRINGS[language].notTested["own-settings"]));
  // and the limits printed are the other shop's, not Glow Salon's
  const text = goLiveText(env, "en");
  assert.ok(text.includes("Deposit ₹100, and the slot is held 20 minutes") && text.includes("at least 12 hours") && text.includes("Refunds above ₹150") && !text.includes("Refunds above ₹200"));
});

test("a certificate made from a run on the shop's own settings has no 'own settings' caveat; one that left situations out says so, in every language", async () => {
  const rental = parseSettings(JSON.parse(readFileSync(new URL("../settings/equipment-rental.example.json", import.meta.url), "utf8")));
  const summary = summariseRun(await runOn(rental));
  assert.deepEqual([summary.held, summary.total, summary.failedTitles.length, summary.notRun], [28, 28, 0, undefined]);
  const own = seal(buildGoLiveCertificate({ settings: rental, handCheck: summary, issuedAt: ISSUED })).document;
  assert.equal(own.policyDigest, own.checkedPolicyDigest, "the situations ran on the settings the certificate shows");
  assert.notEqual(own.checkedPolicyDigest, checkedGlow(), "and those are not Glow Salon's");
  assert.deepEqual(own.notTested, NOT_TESTED.map((n) => n.id), "nothing is added: the checks ran on this shop");
  assert.equal(own.checks.notRun, undefined);
  assert.ok(goLiveText(seal(own), "en").includes("Held 29 of 29 situations. 0 failed. 14 not tested."));
  // situations the shop's settings could not run: they are not in the count, they are named, and they are one more thing not tested
  const left: HandCheckSummary = { ...summary, total: 26, held: 26, notRun: ["Cancellation after the window", "Reschedule a confirmed booking"] };
  const cert = seal(buildGoLiveCertificate({ settings: rental, handCheck: left, issuedAt: ISSUED }));
  assert.equal(cert.document.notTested.at(-1), "situations-skipped");
  assert.deepEqual(cert.document.checks.notRun, left.notRun);
  assert.ok(goLiveText(cert, "en").includes("Held 26 of 26 situations. 0 failed. 15 not tested.") && goLiveText(cert, "en").includes(STRINGS.en.notTested["situations-skipped"]));
  for (const language of LANGUAGES) assert.ok(words(goLivePage(cert, language)).includes(STRINGS[language].notTested["situations-skipped"]), language);
  // a run on Glow Salon's settings, shown for another shop's, still says so (the old way of making a certificate)
  const glowRun = summariseRun(await runOn(settings));
  assert.equal(seal(buildGoLiveCertificate({ settings: rental, handCheck: glowRun, issuedAt: ISSUED })).document.notTested.at(-1), "own-settings");
});

test("the limits are the shop's own, in plain words, in each language: deposit, hold, cancellation window, refund limit, price floor", async () => {
  const env = seal(buildGoLiveCertificate({ settings, handCheck: await handCheck(), issuedAt: ISSUED }));
  for (const language of LANGUAGES) {
    const text = goLiveText(env, language);
    for (const s of settings.services) {
      const name = s.names[language]![0];
      assert.ok(text.includes(`${name} ${formatInr(s.priceInr)}`), `${language}: ${name}`);
    }
    assert.ok(text.includes(formatInr(settings.deposit.amountInr)) && text.includes(String(settings.deposit.holdMinutes)) && text.includes(String(settings.cancellation.windowHours)) && text.includes(formatInr(settings.cancellation.refundLimitInr)));
    assert.ok(text.includes(STRINGS[language].cert.yourLimits));
  }
});

test("the date is the shop's local date, not UTC", async () => {
  const summary = await handCheck();
  const late = Date.parse("2027-02-03T20:00:00Z"); // 01:30 on 4 February in India
  const env = seal(buildGoLiveCertificate({ settings, handCheck: summary, issuedAt: late }));
  assert.deepEqual(env.document.issuedOn, { year: 2027, month: 2, day: 4 });
  assert.ok(goLiveText(env, "en").includes("Thu 4 Feb 2027"));
  assert.ok(goLiveText(env, "ml").includes("4 ഫെബ്രുവരി 2027") && goLiveText(env, "hi").includes("4 फरवरी 2027") && goLiveText(env, "kn").includes("4 ಫೆಬ್ರವರಿ 2027"));
});

test("a failed situation is listed, and the counts change; the certificate does not hide it", async () => {
  const summary: HandCheckSummary = { held: 30, total: 33, checks: 190, failedTitles: ["A normal booking", "STOP ends all messages", "Reschedule a confirmed booking"] };
  const env = seal(buildGoLiveCertificate({ settings, handCheck: summary, issuedAt: ISSUED }));
  assert.equal(env.document.checks.failed, 3);
  const text = goLiveText(env, "en");
  assert.ok(text.includes("Held 30 of 33 situations. 3 failed. 14 not tested.") && text.includes("Did not hold: A normal booking; STOP ends all messages; Reschedule a confirmed booking"));
  for (const language of LANGUAGES) assert.ok(words(goLivePage(env, language)).includes("STOP ends all messages"));
});

test("every language renders both certificates, as a page and as a short text, with the code, the full digest and the lists", async () => {
  const goLive = seal(buildGoLiveCertificate({ settings, handCheck: await handCheck(), issuedAt: ISSUED, preparedBy: "Divya, local partner" }));
  const { world } = await runBusyMonth();
  const { from, to } = monthRange("2026-11", settings.timezone);
  const report = seal(buildMonthlyReport({ settings, entries: world.record.entries(), bookings: [...world.store.bookings.values()], from, to, source: "stand-in", madeAt: at(12, 2, 10) }));
  const monthly = seal(buildMonthlyCertificate(report, at(12, 2, 10)));
  for (const language of ALL) {
    for (const l of languagesOf(language)) {
      const s = STRINGS[l];
      const texts = [goLiveText(goLive, l), monthlyCertificateText(monthly, l)];
      const pages = [words(goLivePage(goLive, l)), words(monthlyCertificatePage(monthly, l))];
      for (const [i, env] of [goLive, monthly].entries()) {
        assert.ok(texts[i].includes(env.code) && texts[i].includes(`/verify/${env.code}`), `${l}: the code and the path in the text`);
        assert.ok(pages[i].includes(env.digest) && pages[i].includes(env.code), `${l}: the full digest and the code on the page`);
        for (const n of NOT_TESTED) assert.ok(texts[i].includes(s.notTested[n.id]) && pages[i].includes(s.notTested[n.id]), `${l}: not tested "${n.id}"`);
        assert.ok(texts[i].includes(s.page.agentVersion) && pages[i].includes("0.1.0"), `${l}: the pathway version`);
        assert.deepEqual(bannedIn(texts[i], l), [], `${l}: banned word in the text`);
        assert.deepEqual(bannedIn(pages[i], l), [], `${l}: banned word on the page`);
      }
      assert.ok(texts[0].includes(s.cert.held(34, 34, 0, 14)) && texts[0].includes("Divya, local partner"));
      assert.ok(texts[1].includes(MONTH_NAMES[l][10]) && texts[1].includes(s.handRun) && texts[1].includes(s.sourceTag["stand-in"]));
      for (const id of NOT_COUNTED) assert.ok(texts[1].includes(s.notCounted[id]) && pages[1].includes(s.notCounted[id]), `${l}: not counted "${id}"`);
    }
    for (const html of [goLivePage(goLive, language), monthlyCertificatePage(monthly, language)]) {
      for (const forbidden of ["<script", "<link", "<img", "url(", "@import", "src=", "href="]) assert.ok(!html.includes(forbidden), `${language} has ${forbidden}`);
      assert.ok(!/https?:|\/\/[a-z]/i.test(html) && html.includes("default-src 'none'") && html.includes("width=device-width"));
    }
  }
});

test("the monthly certificate repeats the report's counts exactly, and points at the report it was made from", async () => {
  const { world } = await runBusyMonth();
  const { from, to } = monthRange("2026-11", settings.timezone);
  const report = seal(buildMonthlyReport({ settings, entries: world.record.entries(), bookings: [...world.store.bookings.values()], from, to, source: "stand-in", madeAt: at(12, 2, 10) }));
  const cert = buildMonthlyCertificate(report, at(12, 2, 11));
  const r = report.document;
  assert.deepEqual(cert.counted, {
    bookingsMade: r.bookings.made, cancelled: r.bookings.cancelled, depositsPaise: r.money.deposits.paise, refundsPaise: r.money.refunds.paise, stopped: r.stopped.total,
    unconfirmedOpen: r.unconfirmed.openOnBookings, asked: r.owner.asked, approved: r.owner.approved, denied: r.owner.denied,
  });
  assert.deepEqual(cert.report, { digest: report.digest, code: report.code });
  assert.deepEqual(cert.record, { entries: r.record.entries, digest: r.record.digest });
  assert.equal(cert.policyDigest, r.policyDigest);
  assert.deepEqual(cert.notTested, r.notTested);
  assert.deepEqual(cert.notCounted, r.notCounted);
  const text = monthlyCertificateText(seal(cert), "en");
  assert.ok(text.includes("Bookings made: 26") && text.includes("Deposits collected: ₹5,400") && text.includes("Given back: ₹1,000") && text.includes("Stopped by your limits: 10"));
  assert.equal(cert.source, "stand-in");
});

test("the certificates carry no phone number and no earnings or grading words in their data", async () => {
  const goLive = seal(buildGoLiveCertificate({ settings, handCheck: await handCheck(), issuedAt: ISSUED }));
  const json = JSON.stringify(goLive);
  assert.ok(!json.includes(settings.owner.whatsapp) && !/\+91\d/.test(json));
  assert.deepEqual(bannedIn(json, "en"), []);
});
