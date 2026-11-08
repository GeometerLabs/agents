// The go-live certificate for Orders: made from one run of the hand check, signed, read back by the monthly report, and the report says what its checks ran on. The reading
// itself is shared with the other templates (modules/report/go-live.ts); what is tried here is Orders' own: its limits in plain words, its digests, and the scripts. Library
// tests use a canned hand-check summary for speed; the script tests at the end run the real hand check on a real settings file, because the digest has to survive being
// written to JSON and read back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { generateKeyFiles } from "../../../../modules/report/keys.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal, verifyEnvelopeText } from "../../../../modules/report/sign.ts";
import { notTestedOf } from "../crash-test/not-tested.ts";
import { runOn } from "../crash-test/situations.ts";
import { annapurna } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { buildGoLiveCertificate, goLivePage, goLiveText, limitLines, summariseRun } from "../report/certificate.ts";
import type { HandCheckSummary } from "../report/certificate.ts";
import { buildOrdersReport, policyDigest } from "../report/data.ts";
import type { GoLiveFinding } from "../report/data.ts";
import { readGoLiveCertificate } from "../report/go-live.ts";
import { reportPage } from "../report/html.ts";
import { STRINGS } from "../report/strings.ts";
import { goLiveLines, ownerText } from "../report/text.ts";

const example = annapurna();
const raw = () => JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins.example.json", import.meta.url), "utf8"));
const shop = parseSettings({ ...raw(), name: "Sunrise Tiffins", refund: { limitInr: 250 } });
const elsewhere = parseSettings({ ...raw(), name: "Elsewhere Kitchen", orders: { maxPerDay: 3, maxItemsPerOrder: 5, daysAhead: 2 } });
const ISSUED = Date.parse("2027-02-04T10:30:00+05:30");
const issuer = generateKeyPairSync("ed25519").privateKey;
const stranger = generateKeyPairSync("ed25519").privateKey;
const issuerId = keyIdOf(publicKeyHex(issuer));

/** A hand-check summary for settings: what a real run on them would count (canned here; the script tests below use the real thing). */
const ranOn = (s: Settings, more: Partial<HandCheckSummary> = {}): HandCheckSummary => ({ held: 17, total: 17, checks: 120, failedTitles: [], ranOn: policyDigest(s), ...more });
const certificateFile = (s: Settings, summary: HandCheckSummary, key: typeof issuer | null = issuer) => envelopeFile(seal(buildGoLiveCertificate({ settings: s, handCheck: summary, issuedAt: ISSUED }), key ?? undefined));
const report = (s: Settings, goLive?: GoLiveFinding) => buildOrdersReport({ settings: s, entries: [], orders: [], ...monthRange("2026-11", s.timezone), source: "stand-in", madeAt: ISSUED, goLive });
const baseList = notTestedOf(shop).map((n) => n.id);
const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// ---- the five things a report can be told --------------------------------------------------------------------------------------

test("(a) a good signature and a digest that is this shop's own: the checks ran on this shop's settings, on that date, with the certificate's own counts and its key", () => {
  const read = readGoLiveCertificate(certificateFile(shop, ranOn(shop)), shop);
  assert.equal(read.finding.status, "own");
  if (read.finding.status !== "own") return;
  assert.deepEqual([read.finding.signedBy, read.finding.issuedOn, read.finding.held, read.finding.total, read.finding.failed, read.finding.notRun, read.finding.notTested], [issuerId, { year: 2027, month: 2, day: 4 }, 17, 17, 0, 0, baseList.length]);
  assert.ok(read.said.includes("this shop's own settings") && read.said.includes("2027-02-04") && read.said.includes("held 17 of 17"), read.said);
  const r = report(shop, read.finding);
  assert.deepEqual(r.notTested, baseList, "nothing is added to the not-tested list when the checks ran on this shop's own settings with nothing left out");
  assert.deepEqual(r.goLive, read.finding);
});

test("(b) the digest is the example shop's: the checks ran on Annapurna Tiffins, and the report says so and keeps this shop's own settings in the not-tested list", () => {
  const read = readGoLiveCertificate(certificateFile(example, ranOn(example)), shop);
  assert.equal(read.finding.status, "example");
  assert.match(read.said, /Annapurna Tiffins.s example settings/);
  assert.deepEqual(report(shop, read.finding).notTested, [...baseList, "own-settings"]);
});

test("(c) any other digest: the checks ran on different settings, and the report says so", () => {
  const read = readGoLiveCertificate(certificateFile(elsewhere, ranOn(elsewhere)), shop);
  assert.equal(read.finding.status, "different");
  assert.deepEqual(report(shop, read.finding).notTested, [...baseList, "other-settings"]);
});

test("(d) a file that cannot be trusted is never used: unsigned, changed, not a certificate, or a certificate of another template", () => {
  const unsigned = readGoLiveCertificate(certificateFile(shop, ranOn(shop), null), shop);
  assert.equal(unsigned.finding.status, "untrusted");
  assert.match(unsigned.said, /not signed/);
  const changed = certificateFile(shop, ranOn(shop)).replace('"held":17', '"held":16');
  assert.equal(readGoLiveCertificate(changed, shop).finding.status, "untrusted");
  assert.equal(readGoLiveCertificate("{}", shop).finding.status, "untrusted");
  assert.equal(readGoLiveCertificate("not json", shop).finding.status, "untrusted");
  const aReport = envelopeFile(seal(report(shop), issuer));
  assert.equal(readGoLiveCertificate(aReport, shop).finding.status, "untrusted", "a signed monthly report is not a go-live certificate");
  // a go-live certificate of the Fees template, signed and whole, with the digest of this very shop: still not used
  const other = { ...buildGoLiveCertificate({ settings: shop, handCheck: ranOn(shop), issuedAt: ISSUED }), pathway: { name: "fees", version: "0.1.0" } };
  const fees = readGoLiveCertificate(envelopeFile(seal(other, issuer)), shop);
  assert.equal(fees.finding.status, "untrusted");
  assert.match(fees.said, /go-live certificate of the fees template, not orders/);
  assert.deepEqual(report(shop, fees.finding).notTested, [...baseList, "go-live-untrusted"]);
});

test("(e) no certificate at all is its own answer, and a stranger's key is named but does not make the certificate untrue or true", () => {
  assert.deepEqual(report(shop).goLive, { status: "none" });
  assert.deepEqual(report(shop).notTested, [...baseList, "no-go-live-certificate"]);
  const read = readGoLiveCertificate(certificateFile(shop, ranOn(shop), stranger), shop);
  assert.equal(read.finding.status, "own");
  assert.ok(read.said.includes(keyIdOf(publicKeyHex(stranger))) && read.said.includes("does not show who holds that key"));
});

test("a run that skipped situations says so: the counts leave them out, the certificate names them, and the report keeps 'situations skipped' in its list", () => {
  const summary = ranOn(shop, { held: 15, total: 15, notRun: ["An address outside the delivery area", "A refund above the limit is held by Guard"] });
  const cert = buildGoLiveCertificate({ settings: shop, handCheck: summary, issuedAt: ISSUED });
  assert.deepEqual(cert.checks.notRun, summary.notRun);
  assert.ok(cert.notTested.includes("situations-skipped"));
  const read = readGoLiveCertificate(certificateFile(shop, summary), shop);
  assert.equal(read.finding.status === "own" && read.finding.notRun, 2);
  assert.deepEqual(report(shop, read.finding).notTested, [...baseList, "situations-skipped"]);
});

// ---- the certificate in words ---------------------------------------------------------------------------------------------------

test("the limits are in plain words in every language, with the shop's own numbers and no customer's number, UPI id or address", () => {
  const cert = buildGoLiveCertificate({ settings: example, handCheck: ranOn(example), issuedAt: ISSUED, preparedBy: "Divya, local partner" });
  const text = JSON.stringify(cert);
  assert.ok(!text.includes(example.owner.whatsapp) && !text.includes("annapurna@okicici") && !text.includes(example.address!));
  const en = limitLines(cert, "en");
  assert.equal(en.length, 9);
  for (const must of ["No order is confirmed until the payment record (or your UPI mark) shows the whole advance", "veg thali ₹120 (12)", "At most 8 orders a day, 10 items in one order, up to 7 days ahead", "orders close at 20:00, 1 day before",
    "50% of the price is paid as the advance; the order is held 30 minutes", "Delivery only to: Kakkanad, Edappally, Infopark", "Cancel at least 6 hours before the slot", "Refunds above ₹300 only with your OK", "An order above ₹1,000 waits for your OK"]) {
    assert.ok(en.some((line) => line.includes(must)), must);
  }
  for (const l of LANGUAGES) {
    const lines = limitLines(cert, l);
    assert.equal(lines.length, 9, l);
    const joined = lines.join("\n");
    for (const n of ["120", "300", "1,000", "Kakkanad", "20:00"]) assert.ok(joined.includes(n), `${l}: ${n}`);
    assert.equal(bannedIn(joined, l).length, 0, `${l}: ${bannedIn(joined, l).join(" ")}`);
  }
  // a shop that does not deliver, takes the whole price and never asks about size says so
  const { delivery: _delivery, ...rest } = raw();
  const plain = buildGoLiveCertificate({ settings: parseSettings({ ...rest, advance: { mode: "full", percent: 100, holdMinutes: 20 }, owner: { ...rest.owner, approveOverInr: 0 } }), handCheck: ranOn(example), issuedAt: ISSUED });
  const lines = limitLines(plain, "en");
  assert.ok(lines.includes("Pickup only, no delivery") && lines.includes("No order waits for your OK because of its size"));
  assert.ok(lines.some((x) => x.startsWith("The whole price is paid as the advance")), lines.join("\n"));
  assert.ok(!JSON.stringify(lines).includes("100%"));
});

test("the text and the page: held N of M, what did not hold, what was not tested, how it was run, the code, and no grading word in any language", () => {
  const failed = ranOn(example, { held: 16, failedTitles: ["A refund above the limit is held by Guard"] });
  for (const summary of [ranOn(example), failed]) {
    const sealed = seal(buildGoLiveCertificate({ settings: example, handCheck: summary, issuedAt: ISSUED, preparedBy: "Divya, local partner" }), issuer);
    for (const l of LANGUAGES) {
      const text = goLiveText(sealed, l);
      const s = STRINGS[l];
      assert.ok(text.includes(s.cert.held(summary.held, 17, 17 - summary.held, baseList.length)), `${l}: held line`);
      assert.ok(text.includes(sealed.code) && text.includes(`/verify/#${sealed.code}`) && text.includes("Divya, local partner"), l);
      assert.ok(text.includes(s.cert.handRunLine) && text.includes(s.notTested["upi-not-automatic"]), l);
      if (summary.held < 17) assert.ok(text.includes("A refund above the limit is held by Guard"), l);
      assert.equal(bannedIn(text, l).length, 0, `${l}: ${bannedIn(text, l).join(" ")}`);
      const page = words(goLivePage(sealed, l));
      assert.ok(page.includes(sealed.digest) && page.includes(sealed.code) && page.includes(s.cert.intro) && page.includes(s.cert.notAGrade), l);
      assert.equal(bannedIn(page, l).length, 0, `${l} page: ${bannedIn(page, l).join(" ")}`);
    }
    assert.ok(goLivePage(sealed, "both").includes('lang="hi"') && goLivePage(sealed, "both").includes('lang="en"'));
  }
});

test("the monthly report page and owner text say what the go-live checks ran on, in every language, and the owner's text stays five lines", () => {
  const read = readGoLiveCertificate(certificateFile(shop, ranOn(shop)), shop);
  const sealed = seal(report(shop, read.finding), issuer);
  for (const l of LANGUAGES) {
    const page = words(reportPage(sealed, l));
    for (const line of goLiveLines(read.finding, l)) assert.ok(page.includes(line), `${l}: ${line}`);
    assert.equal(ownerText(sealed.document, l).split("\n").length, 5, "still five lines");
    assert.equal(bannedIn(page, l).length, 0, `${l}: ${bannedIn(page, l).join(" ")}`);
  }
  const none = seal(report(shop), issuer);
  assert.ok(words(reportPage(none, "en")).includes(STRINGS.en.goLive.none));
});

// ---- the scripts, on real files ---------------------------------------------------------------------------------------------------

const script = (name: string) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const run = (name: string, args: string[]) => spawnSync(process.execPath, [script(name), ...args], { encoding: "utf8" });

test("go-live-certificate.ts runs the real hand check on a shop's own settings file and writes a signed certificate that client-report.ts reads back as 'own'", () => {
  const dir = mkdtempSync(join(tmpdir(), "orders-golive-"));
  const settingsFile = join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ ...raw(), name: "Sunrise Tiffins", refund: { limitInr: 250 } }));
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
  assert.equal(cert.checks.total + (cert.checks.notRun?.length ?? 0), 19, "every situation is either run or named as not run");
  assert.equal(cert.policyDigest, cert.checkedPolicyDigest, "the checks ran on this shop's own settings, and the digest survived being written down");

  // the report script reads it back
  const record = join(dir, "record.json"); const orders = join(dir, "orders.json");
  writeFileSync(record, "[]"); writeFileSync(orders, "[]");
  const reported = run("client-report.ts", ["--settings", settingsFile, "--record", record, "--orders", orders, "--month", "2027-01", "--lang", "en", "--out", join(dir, "report"), "--source", "stand-in", "--go-live", join(out, "go-live-certificate.json"), "--key", keys.privateKeyPath]);
  assert.equal(reported.status, 0, reported.stdout + reported.stderr);
  assert.match(reported.stdout, /says its checks ran on this shop's own settings/);
  const json = JSON.parse(readFileSync(join(dir, "report", "report-2027-01.json"), "utf8")) as { document: { goLive: { status: string } } };
  assert.equal(json.document.goLive.status, "own");

  // without the file, or with a damaged one, the report is still made and says so
  const without = run("client-report.ts", ["--settings", settingsFile, "--record", record, "--orders", orders, "--month", "2027-01", "--lang", "en", "--out", join(dir, "report2"), "--source", "stand-in"]);
  assert.equal(without.status, 0, without.stdout + without.stderr);
  assert.match(without.stdout, /NOT signed/);
  assert.match(without.stdout, /No go-live certificate was given/);
  writeFileSync(join(dir, "damaged.json"), file.replace('"held":', '"held":1'));
  const damaged = run("client-report.ts", ["--settings", settingsFile, "--record", record, "--orders", orders, "--month", "2027-01", "--lang", "en", "--out", join(dir, "report3"), "--source", "stand-in", "--go-live", join(dir, "damaged.json")]);
  assert.equal(damaged.status, 0);
  assert.match(damaged.stdout, /could not be trusted/);
  // a missing option is said in a sentence, with no stack
  const usage = run("client-report.ts", ["--settings", settingsFile]);
  assert.equal(usage.status, 64);
  assert.match(usage.stderr, /Say which month/);
});

test("go-live-certificate.ts exits 64 with a sentence when the settings cannot be read, and the hand check on the example shop holds", async () => {
  const ran = await runOn(example);
  assert.equal(summariseRun(ran).held, summariseRun(ran).total);
  assert.equal(summariseRun(ran).total, 17);
  const dir = mkdtempSync(join(tmpdir(), "orders-golive-bad-"));
  const bad = run("go-live-certificate.ts", ["--settings", join(dir, "nowhere.json"), "--lang", "en", "--out", dir]);
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /cannot read the settings file/);
});
