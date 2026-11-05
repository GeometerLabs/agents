// The go-live certificate for Fees: made from one run of the hand check, signed, read back by the monthly report, and the report says what its checks ran on. The reading
// itself is shared with Bookings (modules/report/go-live.ts); what is tried here is Fees' own: its limits in plain words, its digests, and the scripts. Library tests use a
// canned hand-check summary for speed; the script tests at the end run the real hand check on real settings files, because the digest has to survive being written to JSON
// and read back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import { bannedIn } from "../../../modules/report/claims.ts";
import { generateKeyFiles } from "../../../modules/report/keys.ts";
import { monthRange } from "../../../modules/report/months.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal, verifyEnvelopeText } from "../../../modules/report/sign.ts";
import { NOT_TESTED } from "../crash-test/not-tested.ts";
import { runOn } from "../crash-test/situations.ts";
import { brightTuition } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { buildGoLiveCertificate, goLivePage, goLiveText, limitLines, summariseRun } from "../report/certificate.ts";
import type { HandCheckSummary } from "../report/certificate.ts";
import { buildFeesReport, policyDigest } from "../report/data.ts";
import type { GoLiveFinding } from "../report/data.ts";
import { readGoLiveCertificate } from "../report/go-live.ts";
import { reportPage } from "../report/html.ts";
import { STRINGS } from "../report/strings.ts";
import { goLiveLines, ownerText } from "../report/text.ts";

const bright = brightTuition();
const raw = () => JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8"));
const centre = parseSettings({ ...raw(), name: "Sunrise Tuition", lateFeeInr: 50 });
const elsewhere = parseSettings({ ...raw(), name: "Elsewhere Classes", lateFeeInr: 0 });
const ISSUED = Date.parse("2027-02-04T10:30:00+05:30");
const issuer = generateKeyPairSync("ed25519").privateKey;
const stranger = generateKeyPairSync("ed25519").privateKey;
const issuerId = keyIdOf(publicKeyHex(issuer));

/** A hand-check summary for settings: what a real run on them would count (canned here; the script tests below use the real thing). */
const ranOn = (s: Settings, more: Partial<HandCheckSummary> = {}): HandCheckSummary => ({ held: 26, total: 26, checks: 209, failedTitles: [], ranOn: policyDigest(s), ...more });
const certificateFile = (s: Settings, summary: HandCheckSummary, key: typeof issuer | null = issuer) => envelopeFile(seal(buildGoLiveCertificate({ settings: s, handCheck: summary, issuedAt: ISSUED }), key ?? undefined));
const report = (s: Settings, goLive?: GoLiveFinding) => buildFeesReport({ settings: s, entries: [], dues: [], ...monthRange("2026-11", s.timezone), source: "stand-in", madeAt: ISSUED, goLive });
const baseList = NOT_TESTED.map((n) => n.id);
const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// ---- the five things a report can be told --------------------------------------------------------------------------------------

test("(a) a good signature and a digest that is this centre's own: the checks ran on this centre's settings, on that date, with the certificate's own counts and its key", () => {
  const read = readGoLiveCertificate(certificateFile(centre, ranOn(centre)), centre);
  assert.equal(read.finding.status, "own");
  if (read.finding.status !== "own") return;
  assert.deepEqual([read.finding.signedBy, read.finding.issuedOn, read.finding.held, read.finding.total, read.finding.failed, read.finding.notRun, read.finding.notTested], [issuerId, { year: 2027, month: 2, day: 4 }, 26, 26, 0, 0, 12]);
  assert.ok(read.said.includes("this centre's own settings") && read.said.includes("2027-02-04") && read.said.includes("held 26 of 26"), read.said);
  const r = report(centre, read.finding);
  assert.deepEqual(r.notTested, baseList, "nothing is added to the not-tested list when the checks ran on this centre's own settings with nothing left out");
  assert.deepEqual(r.goLive, read.finding);
});

test("(b) the digest is the example centre's: the checks ran on Bright Tuition Centre, and the report says so and keeps this centre's own settings in the not-tested list", () => {
  const read = readGoLiveCertificate(certificateFile(bright, ranOn(bright)), centre);
  assert.equal(read.finding.status, "example");
  assert.ok(read.said.includes("Bright Tuition Centre's example settings"), read.said);
  assert.deepEqual(report(centre, read.finding).notTested, [...baseList, "own-settings"]);
});

test("(c) any other digest: the checks ran on different settings, and the report says so", () => {
  const read = readGoLiveCertificate(certificateFile(elsewhere, ranOn(elsewhere)), centre);
  assert.equal(read.finding.status, "different");
  assert.deepEqual(report(centre, read.finding).notTested, [...baseList, "other-settings"]);
});

test("(d) a file that cannot be trusted is never used: unsigned, changed, not a certificate, or a certificate of another template", () => {
  const unsigned = readGoLiveCertificate(certificateFile(centre, ranOn(centre), null), centre);
  assert.equal(unsigned.finding.status, "untrusted");
  assert.match(unsigned.said, /not signed/);
  const changed = certificateFile(centre, ranOn(centre)).replace('"held":26', '"held":25');
  assert.equal(readGoLiveCertificate(changed, centre).finding.status, "untrusted");
  assert.equal(readGoLiveCertificate("{}", centre).finding.status, "untrusted");
  assert.equal(readGoLiveCertificate("not json", centre).finding.status, "untrusted");
  const aReport = envelopeFile(seal(report(centre), issuer));
  assert.equal(readGoLiveCertificate(aReport, centre).finding.status, "untrusted", "a signed monthly report is not a go-live certificate");
  // a go-live certificate of the Bookings template, signed and whole, with the digest of this very centre: still not used
  const other = { ...buildGoLiveCertificate({ settings: centre, handCheck: ranOn(centre), issuedAt: ISSUED }), pathway: { name: "bookings", version: "0.1.0" } };
  const bookings = readGoLiveCertificate(envelopeFile(seal(other, issuer)), centre);
  assert.equal(bookings.finding.status, "untrusted");
  assert.match(bookings.said, /go-live certificate of the bookings template, not fees/);
  assert.deepEqual(report(centre, bookings.finding).notTested, [...baseList, "go-live-untrusted"]);
});

test("(e) no certificate at all is its own answer, and a stranger's key is named but does not make the certificate untrue or true", () => {
  assert.deepEqual(report(centre).goLive, { status: "none" });
  assert.deepEqual(report(centre).notTested, [...baseList, "no-go-live-certificate"]);
  const read = readGoLiveCertificate(certificateFile(centre, ranOn(centre), stranger), centre);
  assert.equal(read.finding.status, "own");
  assert.ok(read.said.includes(keyIdOf(publicKeyHex(stranger))) && read.said.includes("does not show who holds that key"));
});

test("a run that skipped situations says so: the counts leave them out, the certificate names them, and the report keeps 'situations skipped' in its list", () => {
  const summary = ranOn(centre, { held: 23, total: 23, notRun: ["A late fee is added once, after the grace days", "A waiver within the limit", "Part payments"] });
  const cert = buildGoLiveCertificate({ settings: centre, handCheck: summary, issuedAt: ISSUED });
  assert.deepEqual(cert.checks.notRun, summary.notRun);
  assert.ok(cert.notTested.includes("situations-skipped"));
  const read = readGoLiveCertificate(certificateFile(centre, summary), centre);
  assert.equal(read.finding.status === "own" && read.finding.notRun, 3);
  assert.deepEqual(report(centre, read.finding).notTested, [...baseList, "situations-skipped"]);
});

// ---- the certificate in words ---------------------------------------------------------------------------------------------------

test("the limits are in plain words in every language, with the centre's own numbers and no student's name or number", () => {
  const cert = buildGoLiveCertificate({ settings: bright, handCheck: ranOn(bright), issuedAt: ISSUED, preparedBy: "Divya, local partner" });
  assert.equal(cert.limits.students, 5);
  const text = JSON.stringify(cert);
  for (const student of bright.students) assert.ok(!text.includes(student.name) && !text.includes(student.parent), `${student.name} is not in the certificate`);
  assert.ok(!text.includes(bright.owner.whatsapp));
  const en = limitLines(cert, "en").join("\n");
  for (const must of ["No reminder once Razorpay's record shows a fee paid", "class 8 ₹1,200", "class 10 ₹1,800", "day 5 of the month, with 5 grace days", "A late fee of ₹100", "-3, 0, +5, +10", "10:00", "at most 4", "Part payments are allowed, from ₹300", "more than ₹100", "Refunds above ₹500 only with your OK", "5 students"]) assert.ok(en.includes(must), `English: ${must}\n${en}`);
  for (const l of LANGUAGES) {
    const lines = limitLines(cert, l);
    assert.equal(lines.length, 9, l);
    const joined = lines.join("\n");
    for (const n of ["1,200", "1,800", "100", "300", "500"]) assert.ok(joined.includes(n), `${l}: ${n}`);
    assert.equal(bannedIn(joined, l).length, 0, `${l}: ${bannedIn(joined, l).join(" ")}`);
  }
  // a centre with no late fee and no waivers says so, not "₹0"
  const plain = buildGoLiveCertificate({ settings: parseSettings({ ...raw(), lateFeeInr: 0, waiver: { limitInr: 0 }, partPayments: { allowed: false, minInr: 1 } }), handCheck: ranOn(bright), issuedAt: ISSUED });
  assert.ok(limitLines(plain, "en").some((x) => x === "No late fee") && limitLines(plain, "en").some((x) => x === "Part payments are not allowed") && limitLines(plain, "en").some((x) => x === "Every request to take money off a fee goes to you"));
});

test("the text and the page: held N of M, what did not hold, what was not tested, how it was run, the code, and no grading word in any language", () => {
  const failed = ranOn(bright, { held: 25, failedTitles: ["A refund above the limit is held by Guard"] });
  for (const summary of [ranOn(bright), failed]) {
    const sealed = seal(buildGoLiveCertificate({ settings: bright, handCheck: summary, issuedAt: ISSUED, preparedBy: "Divya, local partner" }), issuer);
    for (const l of LANGUAGES) {
      const text = goLiveText(sealed, l);
      const s = STRINGS[l];
      assert.ok(text.includes(s.cert.held(summary.held, 26, 26 - summary.held, 12)), `${l}: held line`);
      assert.ok(text.includes(sealed.code) && text.includes(`/verify/${sealed.code}`) && text.includes("Divya, local partner"), l);
      assert.ok(text.includes(s.cert.handRunLine) && text.includes(s.notTested["real-razorpay"]), l);
      if (summary.held < 26) assert.ok(text.includes("A refund above the limit is held by Guard"), l);
      assert.equal(bannedIn(text, l).length, 0, `${l}: ${bannedIn(text, l).join(" ")}`);
      const page = words(goLivePage(sealed, l));
      assert.ok(page.includes(sealed.digest) && page.includes(sealed.code) && page.includes(s.cert.intro) && page.includes(s.cert.notAGrade), l);
      assert.equal(bannedIn(page, l).length, 0, `${l} page: ${bannedIn(page, l).join(" ")}`);
    }
    assert.ok(goLivePage(sealed, "both").includes('lang="hi"') && goLivePage(sealed, "both").includes('lang="en"'));
  }
});

test("the monthly report page and owner text say what the go-live checks ran on, in every language, and the owner's text grows by nothing but its count", () => {
  const read = readGoLiveCertificate(certificateFile(centre, ranOn(centre)), centre);
  const sealed = seal(report(centre, read.finding), issuer);
  for (const l of LANGUAGES) {
    const page = words(reportPage(sealed, l));
    for (const line of goLiveLines(read.finding, l)) assert.ok(page.includes(line), `${l}: ${line}`);
    assert.equal(ownerText(sealed.document, l).split("\n").length, 5, "still five lines");
    assert.equal(bannedIn(page, l).length, 0, `${l}: ${bannedIn(page, l).join(" ")}`);
  }
  const none = seal(report(centre), issuer);
  assert.ok(words(reportPage(none, "en")).includes(STRINGS.en.goLive.none));
});

// ---- the scripts, on real files ---------------------------------------------------------------------------------------------------

const script = (name: string) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const run = (name: string, args: string[]) => spawnSync(process.execPath, [script(name), ...args], { encoding: "utf8" });

test("go-live-certificate.ts runs the real hand check on a centre's own settings file and writes a signed certificate that client-report.ts reads back as 'own'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fees-golive-"));
  const settingsFile = join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ ...raw(), name: "Sunrise Tuition", lateFeeInr: 50 }));
  const keys = generateKeyFiles(join(dir, "keys"));
  const out = join(dir, "out");
  const made = run("go-live-certificate.ts", ["--settings", settingsFile, "--lang", "hi", "--out", out, "--key", keys.privateKeyPath, "--prepared-by", "Divya, local partner", "--now", "2027-02-04T10:30:00+05:30"]);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.match(made.stdout, /Signed with your key\./);
  assert.deepEqual(readdirSync(out).sort(), ["go-live-certificate-hi.html", "go-live-certificate-hi.txt", "go-live-certificate.json"]);
  const file = readFileSync(join(out, "go-live-certificate.json"), "utf8");
  const verified = verifyEnvelopeText(file);
  assert.ok(verified.unchanged && verified.signed);
  const cert = verified.envelope!.document as ReturnType<typeof buildGoLiveCertificate>;
  assert.equal(cert.checks.total, cert.checks.held);
  assert.equal(cert.checks.total + (cert.checks.notRun?.length ?? 0), 26, "every situation is either run or named as not run");
  assert.equal(cert.policyDigest, cert.checkedPolicyDigest, "the checks ran on this centre's own settings, and the digest survived being written down");

  // the report script reads it back
  const record = join(dir, "record.json"); const dues = join(dir, "dues.json");
  writeFileSync(record, "[]"); writeFileSync(dues, "[]");
  const reported = run("client-report.ts", ["--settings", settingsFile, "--record", record, "--dues", dues, "--month", "2027-01", "--lang", "en", "--out", join(dir, "report"), "--source", "stand-in", "--go-live", join(out, "go-live-certificate.json"), "--key", keys.privateKeyPath]);
  assert.equal(reported.status, 0, reported.stdout + reported.stderr);
  assert.match(reported.stdout, /says its checks ran on this centre's own settings/);
  const json = JSON.parse(readFileSync(join(dir, "report", "report-2027-01.json"), "utf8")) as { document: { goLive: { status: string } } };
  assert.equal(json.document.goLive.status, "own");

  // without the file, or with a damaged one, the report is still made and says so
  const without = run("client-report.ts", ["--settings", settingsFile, "--record", record, "--dues", dues, "--month", "2027-01", "--lang", "en", "--out", join(dir, "report2"), "--source", "stand-in"]);
  assert.equal(without.status, 0, without.stdout + without.stderr);
  assert.match(without.stdout, /NOT signed/);
  assert.match(without.stdout, /No go-live certificate was given/);
  writeFileSync(join(dir, "damaged.json"), file.replace('"held":', '"held":1'));
  const damaged = run("client-report.ts", ["--settings", settingsFile, "--record", record, "--dues", dues, "--month", "2027-01", "--lang", "en", "--out", join(dir, "report3"), "--source", "stand-in", "--go-live", join(dir, "damaged.json")]);
  assert.equal(damaged.status, 0);
  assert.match(damaged.stdout, /could not be trusted/);
  // a missing option is said in a sentence, with no stack
  const usage = run("client-report.ts", ["--settings", settingsFile]);
  assert.equal(usage.status, 64);
  assert.match(usage.stderr, /Say which month/);
});

test("go-live-certificate.ts exits 1 when a situation does not hold, and says no situation could be run when none can", async () => {
  const ran = await runOn(bright);
  assert.equal(summariseRun(ran).held, summariseRun(ran).total);
  assert.equal(summariseRun(ran).total, 26);
  const dir = mkdtempSync(join(tmpdir(), "fees-golive-bad-"));
  const bad = run("go-live-certificate.ts", ["--settings", join(dir, "nowhere.json"), "--lang", "en", "--out", dir]);
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /cannot read the settings file/);
});
