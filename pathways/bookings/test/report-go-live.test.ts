// The monthly report is told what the go-live checks ran on. It reads the go-live certificate, checks its signature the way verify-report.ts does,
// compares the settings the situations ran on with this shop's own, and says which of five things is true: the checks ran on this shop's own
// settings (and when), on Glow Salon's example, on some other settings, a certificate was given that could not be trusted, or none was given.
// Library tests use a canned hand-check summary for speed; the script tests at the end run the real hand check on real settings files, because
// the digest has to survive being written to JSON and read back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_TESTED } from "../crash-test/not-tested.ts";
import { formatDate } from "../src/language/format.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES, parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { buildGoLiveCertificate, buildMonthlyCertificate, monthlyCertificatePage, monthlyCertificateText } from "../report/certificate.ts";
import type { HandCheckSummary } from "../report/certificate.ts";
import { buildMonthlyReport, monthRange, policyDigest } from "../report/data.ts";
import type { GoLiveFinding } from "../report/data.ts";
import { runBusyMonth } from "../report/example-month.ts";
import { readGoLiveCertificate } from "../report/go-live.ts";
import { reportPage } from "../report/html.ts";
import { generateKeyFiles } from "../report/keys.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal, verifyEnvelopeText } from "../report/sign.ts";
import { STRINGS, bannedIn } from "../report/strings.ts";
import { goLiveLines, ownerText } from "../report/text.ts";

const glow = glowSalon();
const bright = parseSettings({ ...JSON.parse(JSON.stringify(glow)), name: "Bright Salon", deposit: { amountInr: 100, holdMinutes: 20 } });
const elsewhere = parseSettings({ ...JSON.parse(JSON.stringify(glow)), name: "Elsewhere Salon", deposit: { amountInr: 150, holdMinutes: 10 } });
const ISSUED = Date.parse("2027-02-04T10:30:00+05:30"); // Thu 4 Feb 2027
const THU_4_FEB = "Thu 4 Feb 2027";
const issuer = generateKeyPairSync("ed25519").privateKey;
const stranger = generateKeyPairSync("ed25519").privateKey;
const issuerId = keyIdOf(publicKeyHex(issuer));

/** A hand-check summary for settings: what a real run on them would count (the numbers are canned; the script tests below use the real thing). */
const ranOn = (shop: Settings, more: Partial<HandCheckSummary> = {}): HandCheckSummary => ({ held: 33, total: 33, checks: 201, failedTitles: [], ranOn: policyDigest(shop), ...more });
/** The go-live certificate file for a shop, as go-live-certificate.ts writes it. */
const certificateFile = (shop: Settings, summary: HandCheckSummary, key: typeof issuer | null = issuer) => envelopeFile(seal(buildGoLiveCertificate({ settings: shop, handCheck: summary, issuedAt: ISSUED }), key ?? undefined));

const report = (shop: Settings, goLive?: GoLiveFinding) => buildMonthlyReport({ settings: shop, entries: [], bookings: [], ...monthRange("2026-11", shop.timezone), source: "stand-in", madeAt: ISSUED, goLive });
const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const dateIn = (language: (typeof LANGUAGES)[number]) => `${formatDate({ year: 2027, month: 2, day: 4 }, language)} 2027`;
const baseList = NOT_TESTED.map((n) => n.id);

// ---- reading the certificate: the five cases -----------------------------------------------------------------------------------

test("(a) a good signature and a digest that is this shop's own: the checks ran on this shop's settings, on that date, with the certificate's own counts and its key", () => {
  const read = readGoLiveCertificate(certificateFile(bright, ranOn(bright)), bright);
  assert.deepEqual(read.finding, { status: "own", code: read.finding.status === "own" ? read.finding.code : "", signedBy: issuerId, issuedOn: { year: 2027, month: 2, day: 4 }, held: 33, total: 33, failed: 0, notRun: 0, notTested: 14 });
  assert.match((read.finding as { code: string }).code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/u);
  assert.ok(read.said.includes("this shop's own settings") && read.said.includes("2027-02-04") && read.said.includes(issuerId) && read.said.includes("held 33 of 33"), read.said);
  const r = report(bright, read.finding);
  assert.deepEqual(r.notTested, baseList, "nothing is added: the checks ran on this shop");
  // and the default path: a monthly report for Glow Salon with Glow Salon's certificate
  const glowRead = readGoLiveCertificate(certificateFile(glow, ranOn(glow)), glow);
  assert.equal(glowRead.finding.status, "own");
  assert.deepEqual(report(glow, glowRead.finding).notTested, baseList);
});

test("(a) a certificate that states situations it could not run, or that some did not hold, says so only as counts: nothing is added or hidden", () => {
  const skipped = readGoLiveCertificate(certificateFile(bright, ranOn(bright, { held: 30, total: 30, notRun: ["Cancellation after the window", "Late cancellation"] })), bright);
  assert.ok(skipped.finding.status === "own" && skipped.finding.notRun === 2 && skipped.finding.notTested === 15);
  assert.deepEqual(report(bright, skipped.finding).notTested, [...baseList, "situations-skipped"]);
  const failed = readGoLiveCertificate(certificateFile(bright, ranOn(bright, { held: 31, failedTitles: ["A", "B"], total: 33 })), bright);
  assert.ok(failed.finding.status === "own" && failed.finding.failed === 2 && failed.finding.held === 31);
  assert.ok(goLiveLines(failed.finding, "en").includes("Held 31 of 33 situations. 2 failed. 14 not tested."), "the certificate's own counts, as it states them");
  assert.ok(failed.said.includes("2 failed"));
});

test("(b) a good signature and Glow Salon's digest on another shop: the checks ran on the example shop, which is named; this shop's settings stay in the not-tested list", () => {
  const read = readGoLiveCertificate(certificateFile(glow, ranOn(glow)), bright);
  assert.equal(read.finding.status, "example");
  assert.ok(!("held" in read.finding), "no count from settings that are not this shop's");
  assert.ok(read.said.includes("Glow Salon's example settings") && read.said.includes("not on this shop's"), read.said);
  const r = report(bright, read.finding);
  assert.deepEqual(r.notTested, [...baseList, "own-settings"]);
  assert.ok(goLiveLines(r.goLive, "en")[0].includes("the example shop, Glow Salon, not on this shop's own settings"));
  // the old way of making a certificate (a run on Glow Salon's settings shown for another shop's) reads the same
  const old = readGoLiveCertificate(certificateFile(bright, { held: 33, total: 33, checks: 201, failedTitles: [] }), bright);
  assert.equal(old.finding.status, "example");
});

test("(b) a good signature and some other shop's digest: different settings, Glow Salon is not named, and the not-tested list says so", () => {
  const read = readGoLiveCertificate(certificateFile(elsewhere, ranOn(elsewhere)), bright);
  assert.equal(read.finding.status, "different");
  assert.ok(!("held" in read.finding) && !read.said.includes("Glow Salon"), read.said);
  const r = report(bright, read.finding);
  assert.deepEqual(r.notTested, [...baseList, "other-settings"]);
  assert.ok(!goLiveLines(r.goLive, "en").join(" ").includes("Glow Salon"));
  // and Glow Salon given another shop's certificate is "different" too, not "own"
  assert.equal(readGoLiveCertificate(certificateFile(bright, ranOn(bright)), glow).finding.status, "different");
});

test("(c) a tampered certificate, an unsigned one, a re-spaced one, one that is not a go-live certificate, junk and an empty file are each 'could not be trusted'", () => {
  const good = certificateFile(bright, ranOn(bright));
  const monthly = envelopeFile(seal(report(bright), issuer)); // signed, and valid, but a monthly report
  const monthlyCert = envelopeFile(seal(buildMonthlyCertificate(seal(report(bright), issuer), ISSUED), issuer));
  const thin = envelopeFile(seal({ format: "geometer-go-live-certificate/1", checkedPolicyDigest: policyDigest(bright) }, issuer)); // signed, called a go-live certificate, has none of the fields
  const bad: [string, string][] = [
    ["a count was changed", good.replace('"held":33', '"held":34')],
    ["the digest it ran on was swapped for this shop's", good.replace(/"checkedPolicyDigest":"sha256:[0-9a-f]{64}"/u, `"checkedPolicyDigest":"${policyDigest(elsewhere)}"`)],
    ["it was re-spaced", `${JSON.stringify(JSON.parse(good), null, 2)}\n`],
    ["it is not signed", certificateFile(bright, ranOn(bright), null)],
    ["a signed monthly report", monthly],
    ["a signed monthly certificate", monthlyCert],
    ["a signed document with the go-live format and no fields", thin],
    ["not JSON", "this is not a certificate"],
    ["an empty file", ""],
    ["an empty object", "{}\n"],
  ];
  for (const [what, text] of bad) {
    const read = readGoLiveCertificate(text, bright);
    assert.deepEqual(read.finding, { status: "untrusted" }, what);
    assert.ok(read.said.startsWith("The go-live certificate could not be trusted (") && read.said.includes("so it was not used"), `${what}: ${read.said}`);
    assert.deepEqual(report(bright, read.finding).notTested, [...baseList, "go-live-untrusted"], what);
  }
});

test("a certificate edited and signed again with someone else's key still reads, but the report names that key, so the reader can see it is not the issuer's", () => {
  const forged = envelopeFile(seal({ ...JSON.parse(certificateFile(bright, ranOn(bright, { held: 30, total: 33, failedTitles: ["x", "y", "z"] }))).document, checks: { held: 33, total: 33, failed: 0, failedTitles: [], checks: 201 } }, stranger));
  const read = readGoLiveCertificate(forged, bright);
  assert.ok(read.finding.status === "own" && read.finding.signedBy === keyIdOf(publicKeyHex(stranger)) && read.finding.signedBy !== issuerId);
  assert.ok(goLiveLines(read.finding, "en").at(-1)!.includes(read.finding.signedBy) && goLiveLines(read.finding, "en").at(-1)!.includes("does not show who holds it"));
  assert.ok(read.said.includes("does not show who holds that key"));
});

test("(d) no certificate given: the report says so, for every shop, and the sentence is plain", () => {
  for (const shop of [glow, bright]) {
    const r = report(shop);
    assert.deepEqual(r.goLive, { status: "none" });
    assert.deepEqual(r.notTested, [...baseList, "no-go-live-certificate"]);
    assert.deepEqual(goLiveLines(r.goLive, "en"), ["No go-live certificate was given, so this document does not say what the go-live checks ran on."]);
    assert.ok(STRINGS.en.notTested["no-go-live-certificate"].includes("no go-live certificate was given"));
  }
});

// ---- the words, in every language and every layer -----------------------------------------------------------------------------

test("every case is said in each language in the owner's text lines, the report page, the monthly certificate text and page; no sentence has a number or date of its own, and no word grades", () => {
  const own = readGoLiveCertificate(certificateFile(bright, ranOn(bright)), bright).finding;
  const example = readGoLiveCertificate(certificateFile(glow, ranOn(glow)), bright).finding;
  const different = readGoLiveCertificate(certificateFile(elsewhere, ranOn(elsewhere)), bright).finding;
  const cases: [string, GoLiveFinding][] = [["own", own], ["example", example], ["different", different], ["untrusted", { status: "untrusted" }], ["none", { status: "none" }]];
  for (const [name, finding] of cases) {
    const r = report(bright, finding);
    const env = seal(r);
    const cert = seal(buildMonthlyCertificate(env, ISSUED));
    assert.deepEqual(cert.document.goLive, finding, `${name}: the monthly certificate carries the same finding`);
    for (const language of LANGUAGES) {
      const s = STRINGS[language];
      const date = dateIn(language);
      const expected = {
        own: [s.goLive.own(date), s.cert.held(33, 33, 0, 14), s.goLive.signedWith(issuerId)],
        example: [s.goLive.example(date), s.goLive.signedWith(issuerId)],
        different: [s.goLive.different(date), s.goLive.signedWith(issuerId)],
        untrusted: [s.goLive.untrusted], none: [s.goLive.none],
      }[name]!;
      assert.deepEqual(goLiveLines(finding, language), expected, `${name} ${language}`);
      const page = words(reportPage(env, language));
      const certText = monthlyCertificateText(cert, language);
      const certPage = words(monthlyCertificatePage(cert, language));
      for (const line of expected) for (const [where, text] of [["report page", page], ["certificate text", certText], ["certificate page", certPage]] as const) assert.ok(text.includes(line), `${name} ${language}: ${where} says: ${line}`);
      assert.ok(page.includes(s.goLive.heading));
      const owner = ownerText(r, language).split("\n");
      assert.equal(owner.length, 5, `${name} ${language}: still five lines`);
      for (const text of [page, certText, certPage, ...owner, ...expected]) assert.deepEqual(bannedIn(text, language), [], `${name} ${language}`);
    }
    if (name === "own") assert.ok(words(reportPage(env, "en")).includes(`The go-live checks ran on this shop's own settings, in the go-live certificate of ${THU_4_FEB}.`));
  }
  // the sentences themselves carry no digit: the date, the counts and the key are filled in
  for (const language of LANGUAGES) {
    const g = STRINGS[language].goLive;
    for (const text of [g.heading, g.untrusted, g.none, ...Object.values(STRINGS[language].notTested)]) assert.ok(!/\d/u.test(text), `${language}: ${text}`);
    for (const text of [g.own("DATE"), g.example("DATE"), g.different("DATE"), g.signedWith("KEY")]) assert.ok(!/\d/u.test(text), `${language}: ${text}`);
  }
});

test("the owner's five lines point to the go-live case through the not-checked line only; the line count and the counts above it do not change", () => {
  const without = ownerText(report(bright), "en").split("\n");
  const withOwn = ownerText(report(bright, readGoLiveCertificate(certificateFile(bright, ranOn(bright)), bright).finding), "en").split("\n");
  assert.equal(without.length, 5);
  assert.equal(withOwn.length, 5);
  assert.deepEqual(withOwn.slice(0, 4), without.slice(0, 4));
  assert.ok(without[4].includes("and 17 more") && withOwn[4].includes("and 16 more"), `${without[4]} / ${withOwn[4]}`);
});

// ---- the scripts, run for real ----------------------------------------------------------------------------------------------------

const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));
const GLOW_FILE = fileURLToPath(new URL("../settings/glow-salon.example.json", import.meta.url));
const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
const tree = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
const SIX = ["certificate-2026-11-en.html", "certificate-2026-11-en.txt", "certificate-2026-11.json", "owner-2026-11-en.txt", "report-2026-11-en.html", "report-2026-11.json"];

test("scripts: go-live-certificate.ts then client-report.ts --go-live on the same settings file is (a); the same certificate on another shop's file is (b) and names Glow Salon; another shop's own certificate is 'different'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geometer-golive-"));
  const { world } = await runBusyMonth();
  writeFileSync(join(dir, "record.json"), JSON.stringify(world.record.entries()));
  writeFileSync(join(dir, "bookings.json"), JSON.stringify([...world.store.bookings.values()]));
  copyFileSync(GLOW_FILE, join(dir, "glow.json"));
  const brightJson = JSON.parse(readFileSync(GLOW_FILE, "utf8"));
  brightJson.name = "Bright Salon";
  brightJson.deposit.amountInr = 100;
  writeFileSync(join(dir, "bright.json"), JSON.stringify(brightJson));
  const keys = generateKeyFiles(join(dir, "keys"));
  const common = ["--record", join(dir, "record.json"), "--bookings", join(dir, "bookings.json"), "--month", "2026-11", "--lang", "en", "--source", "stand-in", "--key", keys.privateKeyPath, "--now", "2026-12-02T10:00:00+05:30"];
  const certify = (settings: string, out: string, ...more: string[]) => run("go-live-certificate.ts", "--settings", join(dir, settings), "--lang", "en", "--out", join(dir, out), "--key", keys.privateKeyPath, "--now", "2026-12-01T09:00:00+05:30", ...more);
  const reportFor = (settings: string, out: string, ...more: string[]) => run("client-report.ts", "--settings", join(dir, settings), ...common, "--out", join(dir, out), ...more);
  const doc = (out: string, file = "report-2026-11.json") => JSON.parse(readFileSync(join(dir, out, file), "utf8")).document;

  // (a) Glow Salon, and another shop, each with its own certificate
  assert.equal(certify("glow.json", "glow-cert").status, 0);
  const a = reportFor("glow.json", "glow-a", "--go-live", join(dir, "glow-cert", "go-live-certificate.json"));
  assert.equal(a.status, 0, a.stderr);
  assert.ok(a.stdout.includes("says its checks ran on this shop's own settings: held 38 of 38, 0 failed") && a.stdout.includes(keys.keyId), a.stdout);
  assert.deepEqual(tree(join(dir, "glow-a")), SIX);
  assert.equal(doc("glow-a").goLive.status, "own");
  assert.deepEqual(doc("glow-a").notTested, baseList);
  assert.deepEqual(doc("glow-a", "certificate-2026-11.json").goLive, doc("glow-a").goLive, "the monthly certificate carries it too");
  assert.ok(readFileSync(join(dir, "glow-a", "certificate-2026-11-en.txt"), "utf8").includes("The go-live checks ran on this shop's own settings, in the go-live certificate of Tue 1 Dec 2026."));
  assert.equal(certify("bright.json", "bright-cert").status, 0);
  const brightOwn = reportFor("bright.json", "bright-a", "--go-live", join(dir, "bright-cert", "go-live-certificate.json"));
  assert.equal(brightOwn.status, 0, brightOwn.stderr);
  assert.equal(doc("bright-a").goLive.status, "own", "the digest survives being written to JSON and read back");
  assert.deepEqual(doc("bright-a").notTested, baseList);
  const verified = run("verify-report.ts", join(dir, "bright-a", "report-2026-11.json"), "--trust-key", keys.publicKeyPath);
  assert.equal(verified.status, 0, verified.stdout);

  // (b) Glow Salon's certificate on Bright Salon's settings; Bright's on Glow's
  const example = reportFor("bright.json", "bright-b", "--go-live", join(dir, "glow-cert", "go-live-certificate.json"));
  assert.equal(example.status, 0);
  assert.ok(example.stdout.includes("Glow Salon's example settings, not on this shop's"), example.stdout);
  assert.equal(doc("bright-b").goLive.status, "example");
  assert.deepEqual(doc("bright-b").notTested, [...baseList, "own-settings"]);
  assert.ok(readFileSync(join(dir, "bright-b", "owner-2026-11-en.txt"), "utf8").trimEnd().split("\n").length === 5);
  const different = reportFor("glow.json", "glow-b", "--go-live", join(dir, "bright-cert", "go-live-certificate.json"));
  const sentence = different.stdout.split("\n").find((l) => l.startsWith("The go-live certificate"))!;
  assert.ok(sentence.includes("different settings from this shop's") && !sentence.includes("Glow Salon"), sentence);
  assert.equal(doc("glow-b").goLive.status, "different");

  // (c) every way a certificate cannot be trusted: a plain sentence, exit 0, and the same six files
  const good = readFileSync(join(dir, "glow-cert", "go-live-certificate.json"), "utf8");
  writeFileSync(join(dir, "tampered.json"), good.replace('"held":38', '"held":37'));
  const unsigned = run("go-live-certificate.ts", "--settings", join(dir, "glow.json"), "--lang", "en", "--out", join(dir, "unsigned"));
  assert.equal(unsigned.status, 0);
  const notACertificate = join(dir, "glow-a", "report-2026-11.json"); // signed, valid, but a monthly report
  writeFileSync(join(dir, "junk.json"), "this is not a certificate");
  const cases: [string, string, string][] = [
    ["tampered", join(dir, "tampered.json"), "the file has been changed"],
    ["unsigned", join(dir, "unsigned", "go-live-certificate.json"), "it is not signed"],
    ["a monthly report", notACertificate, "it is not a go-live certificate"],
    ["junk", join(dir, "junk.json"), "the file has been changed, or it is not a report or certificate file"],
    ["missing", join(dir, "nope.json"), `I cannot read ${join(dir, "nope.json")}`],
  ];
  for (const [what, file, reason] of cases) {
    const out = `untrusted-${what.replace(/\W/gu, "")}`;
    const r = reportFor("glow.json", out, "--go-live", file);
    assert.equal(r.status, 0, `${what}: the report is still made (${r.stderr})`);
    assert.ok(r.stdout.includes("The go-live certificate could not be trusted (") && r.stdout.includes(reason) && r.stdout.includes("so it was not used"), `${what}: ${r.stdout}`);
    assert.deepEqual(tree(join(dir, out)), SIX, what);
    assert.equal(doc(out).goLive.status, "untrusted", what);
    assert.deepEqual(doc(out).notTested, [...baseList, "go-live-untrusted"], what);
    assert.ok(readFileSync(join(dir, out, "report-2026-11-en.html"), "utf8").includes("could not be trusted"), what);
  }

  // (d) nothing given
  const none = reportFor("glow.json", "none");
  assert.equal(none.status, 0);
  assert.ok(none.stdout.includes("No go-live certificate was given"), none.stdout);
  assert.deepEqual(doc("none").goLive, { status: "none" });
  assert.deepEqual(doc("none").notTested, [...baseList, "no-go-live-certificate"]);
  assert.ok(readFileSync(join(dir, "none", "certificate-2026-11-en.txt"), "utf8").includes("No go-live certificate was given"));
  assert.ok(verifyEnvelopeText(readFileSync(join(dir, "none", "report-2026-11.json"), "utf8")).unchanged);
});
