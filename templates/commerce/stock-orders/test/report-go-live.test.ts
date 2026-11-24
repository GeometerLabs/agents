// The go-live certificate for Stock orders: made from one run of the hand check (runOn), signed, read back by the monthly report, and the report says what its checks ran on.
// The reading itself is shared with the other templates (modules/report/go-live.ts); what is tried here is Stock orders' own: its limits in plain words, its digests, and
// that the certificate states facts and counts and never grades. One test runs the real hand check on the example shop; the rest use a canned hand-check summary for speed.
// Written 17 Nov 2026; not yet run (the owner's instruction: all suites run together later).
import { goSkip } from "../../../../modules/crash-test/go-shop.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal, verifyEnvelopeText } from "../../../../modules/report/sign.ts";
import { checkSummaryLink } from "../../../../modules/report/summary-sign.ts";
import type { ListedSigner } from "../../../../modules/report/summary-sign.ts";
import { notTestedOf } from "../crash-test/not-tested.ts";
import { runOn } from "../crash-test/situations.ts";
import { glowSalon } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { buildGoLiveCertificate, goLivePage, goLiveText, limitLines, summariseRun } from "../report/certificate.ts";
import type { HandCheckSummary } from "../report/certificate.ts";
import { buildStockReport, policyDigest } from "../report/data.ts";
import type { GoLiveFinding } from "../report/data.ts";
import { readGoLive } from "../report/cli.ts";
import { readGoLiveCertificate } from "../report/go-live.ts";
import { reportPage } from "../report/html.ts";
import { writeGoLiveCertificate } from "../report/run.ts";
import { STRINGS } from "../report/strings.ts";
import { goLiveLines, ownerText } from "../report/text.ts";

const example = glowSalon();
const raw = () => JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8"));
const shop = parseSettings({ ...raw(), name: "Sunrise Salon", limits: { ...raw().limits, monthlyBudgetInr: 15000 } });
const elsewhere = parseSettings({ ...raw(), name: "Elsewhere Salon", limits: { ...raw().limits, maxPerOrderInr: 3000 } });
const ISSUED = Date.parse("2027-02-04T10:30:00+05:30");
const issuer = generateKeyPairSync("ed25519").privateKey;
const stranger = generateKeyPairSync("ed25519").privateKey;
const issuerId = keyIdOf(publicKeyHex(issuer));
const LIST: ListedSigner[] = [{ key_id: issuerId, public_key: publicKeyHex(issuer), kind: "builder", name: "Kiran, Kiran Tech", since: "2026-11-17" }];

/** A hand-check summary for settings: what a real run on them would count (canned here; the first test uses the real thing). */
const ranOn = (s: Settings, more: Partial<HandCheckSummary> = {}): HandCheckSummary => ({ held: 17, total: 17, checks: 120, failedTitles: [], ranOn: policyDigest(s), ...more });
const certificateFile = (s: Settings, summary: HandCheckSummary, key: typeof issuer | null = issuer) => envelopeFile(seal(buildGoLiveCertificate({ settings: s, handCheck: summary, issuedAt: ISSUED }), key ?? undefined));
const report = (s: Settings, goLive?: GoLiveFinding) => buildStockReport({ settings: s, entries: [], orders: [], ...monthRange("2026-11", s.timezone), source: "stand-in", madeAt: ISSUED, goLive });
const baseList = notTestedOf(shop).map((n) => n.id);
const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const FORBIDDEN = /\b(safe|safely|guaranteed?|proves?|proven|certified|founders?|founding|earn|earnings?|income|bot)\b|100 ?%/i;

let dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "geo-stock-golive-")); dirs.push(d); return d; };
test.afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

// ---- from the real hand check --------------------------------------------------------------------------------------------------

test("a certificate made from a real run of the hand check on the example shop states its counts, what it did not test, and the settings the checks ran on", { skip: goSkip("stock-orders") }, async () => {
  const run = await runOn(example);
  const summary = summariseRun(run);
  assert.equal(summary.total, run.results.length);
  assert.equal(summary.total, 17);
  assert.equal(summary.held, run.results.filter((r) => r.held).length);
  assert.equal(summary.ranOn, policyDigest(example));
  assert.ok(summary.checks > summary.total, "more than one check per situation");
  const cert = buildGoLiveCertificate({ settings: example, handCheck: summary, issuedAt: ISSUED, preparedBy: "Divya, local Operator" });
  assert.equal(cert.pathway.name, "stock-orders");
  assert.equal(cert.source, "stand-in");
  assert.equal(cert.checks.total, 17);
  assert.equal(cert.checks.held + cert.checks.failed, 17);
  assert.deepEqual(cert.notTested, notTestedOf(example).map((n) => n.id), "the hand check's own list, and nothing added: it ran on this shop's own settings with nothing left out");
  assert.equal(cert.policyDigest, cert.checkedPolicyDigest);
  assert.deepEqual(cert.issuedOn, { year: 2027, month: 2, day: 4 });
  assert.equal(cert.anchor, null);
  // facts and counts, never a grade: no word a grade would use is in any language's text or page
  const sealed = seal(cert);
  for (const l of LANGUAGES) {
    const text = goLiveText(sealed, l);
    assert.ok(text.includes(STRINGS[l].cert.held(cert.checks.held, 17, cert.checks.failed, cert.notTested.length)), `${l}: the held line`);
    assert.ok(text.includes(STRINGS[l].cert.handRunLine), `${l}: how the checks were run`);
    for (const doc of [text, words(goLivePage(sealed, l))]) { assert.equal(FORBIDDEN.test(doc), false, `${l}: ${doc.match(FORBIDDEN)?.[0]}`); assert.deepEqual(bannedIn(doc, l), [], l); }
  }
});

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

test("(b) the digest is the example shop's: the checks ran on Glow Unisex Salon, and the report says so and keeps this shop's own settings in the not-tested list", () => {
  const read = readGoLiveCertificate(certificateFile(example, ranOn(example)), shop);
  assert.equal(read.finding.status, "example");
  assert.match(read.said, /Glow Unisex Salon.s example settings/);
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
  const other = { ...buildGoLiveCertificate({ settings: shop, handCheck: ranOn(shop), issuedAt: ISSUED }), pathway: { name: "orders", version: "0.1.0" } };
  const orders = readGoLiveCertificate(envelopeFile(seal(other, issuer)), shop);
  assert.equal(orders.finding.status, "untrusted", "a go-live certificate of the Orders template, signed and whole, with the digest of this very shop: still not used");
  assert.match(orders.said, /stock-orders/);
  assert.deepEqual(report(shop, orders.finding).notTested, [...baseList, "go-live-untrusted"]);
});

test("(e) no certificate at all is its own answer, and a stranger's key is named but does not make the certificate untrue or true", () => {
  assert.deepEqual(report(shop).goLive, { status: "none" });
  assert.deepEqual(report(shop).notTested, [...baseList, "no-go-live-certificate"]);
  const read = readGoLiveCertificate(certificateFile(shop, ranOn(shop), stranger), shop);
  assert.equal(read.finding.status, "own");
  assert.ok(read.said.includes(keyIdOf(publicKeyHex(stranger))) && read.said.includes("does not show who holds that key"));
});

test("a run that skipped situations says so: the counts leave them out, the certificate names them, and the report keeps 'situations skipped' in its list", () => {
  const summary = ranOn(shop, { held: 15, total: 15, notRun: ["A supplier on the list but not approved", "A low-stock mark with no reorder quantity"] });
  const cert = buildGoLiveCertificate({ settings: shop, handCheck: summary, issuedAt: ISSUED });
  assert.deepEqual(cert.checks.notRun, summary.notRun);
  assert.ok(cert.notTested.includes("situations-skipped"));
  const read = readGoLiveCertificate(certificateFile(shop, summary), shop);
  assert.equal(read.finding.status === "own" && read.finding.notRun, 2);
  assert.deepEqual(report(shop, read.finding).notTested, [...baseList, "situations-skipped"]);
});

test("a certificate of checks that ran on other settings lists 'own-settings' as not tested", () => {
  const cert = buildGoLiveCertificate({ settings: shop, handCheck: { held: 17, total: 17, checks: 100, failedTitles: [] }, issuedAt: ISSUED });
  assert.equal(cert.checkedPolicyDigest, policyDigest(example), "left out, the checks ran on the example shop");
  assert.notEqual(cert.policyDigest, cert.checkedPolicyDigest);
  assert.deepEqual(cert.notTested, [...baseList, "own-settings"]);
});

// ---- the certificate in words --------------------------------------------------------------------------------------------------

test("the limits are in plain words in every language, with the shop's own numbers and no phone number or address", () => {
  const cert = buildGoLiveCertificate({ settings: example, handCheck: ranOn(example), issuedAt: ISSUED });
  const en = limitLines(cert, "en");
  assert.equal(en.length, 6);
  for (const must of ["Nothing goes to a supplier until you approve that exact order", "Budget for the month: ₹20,000", "One order is at most ₹12,000", "At most 200 units", "2 approved suppliers; 1 on the list but paused", "after 4, 24 hours"]) assert.ok(en.some((line) => line.includes(must)), must);
  for (const l of LANGUAGES) {
    const joined = limitLines(cert, l).join("\n");
    for (const n of ["20,000", "12,000", "200", "4, 24"]) assert.ok(joined.includes(n), `${l}: ${n}`);
  }
  const everything = JSON.stringify(cert) + LANGUAGES.map((l) => goLiveText(seal(cert), l) + goLivePage(seal(cert), l)).join("\n");
  for (const n of [example.owner.whatsapp, ...example.suppliers.map((s) => s.whatsapp), example.address!]) assert.equal(everything.includes(n), false, n);
  assert.deepEqual(cert.limits.suppliers, { approved: 2, paused: 1 });
});

test("the text and page carry the code, the date, who set it up, the checks' counts and what was not tested, in every language", () => {
  const summary = ranOn(example, { held: 16, total: 17, failedTitles: ["The supplier's reply is lost"] });
  const sealed = seal(buildGoLiveCertificate({ settings: example, handCheck: summary, issuedAt: ISSUED, preparedBy: "Divya, local Operator" }));
  for (const l of LANGUAGES) {
    const s = STRINGS[l];
    const text = goLiveText(sealed, l);
    assert.ok(text.includes(s.cert.held(16, 17, 1, sealed.document.notTested.length)), `${l}: held line`);
    assert.ok(text.includes(sealed.code) && text.includes(`/verify/#${sealed.code}`) && text.includes("Divya, local Operator"), l);
    assert.ok(text.includes(s.cert.didNotHold) && text.includes("The supplier's reply is lost"), `${l}: names what did not hold`);
    assert.ok(text.includes(s.notTested.paying) && text.includes(s.cert.handRunLine), l);
    assert.ok(words(goLivePage(sealed, l)).includes(s.cert.notAGrade), l);
  }
});

test("the report page and owner text carry what the go-live finding says, in every language", () => {
  const own: GoLiveFinding = readGoLiveCertificate(certificateFile(shop, ranOn(shop)), shop).finding;
  for (const finding of [own, { status: "none" } as GoLiveFinding, { status: "untrusted" } as GoLiveFinding]) {
    const r = report(shop, finding);
    for (const l of LANGUAGES) {
      const html = words(reportPage(seal(r), l));
      for (const line of goLiveLines(finding, l)) assert.ok(html.includes(line), `${l} ${finding.status}: ${line.slice(0, 40)}`);
      assert.ok(ownerText(r, l).includes(STRINGS[l].label.notChecked), l);
    }
  }
});

// ---- the files and the readers -------------------------------------------------------------------------------------------------

test("a signed certificate's files carry a summary link that is genuine, from stand-in services, with the day it was issued", () => {
  const out = tempDir();
  const made = writeGoLiveCertificate({ settings: example, handCheck: ranOn(example, { held: 16, total: 17 }), language: "ml", out, key: issuer, preparedBy: "Divya, local Operator", now: ISSUED });
  assert.deepEqual(readdirSync(out).sort(), ["go-live-certificate-ml.html", "go-live-certificate-ml.txt", "go-live-certificate.json"]);
  const link = [...made.texts[0].matchAll(/https:\/\/geometer\.dev\/verify\/#s1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu)][0][0];
  assert.equal(made.texts[0].split("\n").at(-1), `${STRINGS.ml.checkGenuine}: ${link}`);
  assert.ok(readFileSync(join(out, "go-live-certificate-ml.html"), "utf8").includes(link));
  const check = checkSummaryLink(link, LIST);
  assert.ok(check.status === "genuine" && check.summary.layout === 3 && check.summary.source === "stand-in" && check.summary.period === "2027-02-04" && check.summary.pathway === "stock-orders");
  assert.deepEqual(check.status === "genuine" && check.summary.figures.slice(0, 3), [16, 17, 1]);
  const v = verifyEnvelopeText(readFileSync(join(out, "go-live-certificate.json"), "utf8"));
  assert.ok(v.unchanged && v.signed, v.summary);
});

test("readGoLive: no file is none, a missing file is untrusted, a good file is read, and none of them stops the report", () => {
  assert.equal(readGoLive(undefined, shop).finding.status, "none");
  const missing = readGoLive("/nonexistent/go-live-certificate.json", shop);
  assert.equal(missing.finding.status, "untrusted");
  assert.match(missing.said, /could not be trusted/);
  const dir = tempDir();
  writeFileSync(join(dir, "ok.json"), certificateFile(shop, ranOn(shop)));
  assert.equal(readGoLive(join(dir, "ok.json"), shop).finding.status, "own");
  writeFileSync(join(dir, "bad.json"), "{");
  assert.equal(readGoLive(join(dir, "bad.json"), shop).finding.status, "untrusted");
});

test("the command line says in a sentence what to do when it is asked for nothing, and writes nothing", () => {
  const cli = fileURLToPath(new URL("../report/cli.ts", import.meta.url));
  const none = spawnSync(process.execPath, [cli], { encoding: "utf8" });
  assert.equal(none.status, 64);
  assert.match(none.stderr, /Say what to make: report or go-live/);
  const noOut = spawnSync(process.execPath, [cli, "report"], { encoding: "utf8" });
  assert.equal(noOut.status, 64);
  assert.match(noOut.stderr, /--out/);
});
