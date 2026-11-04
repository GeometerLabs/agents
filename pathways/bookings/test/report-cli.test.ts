// The scripts, run for real: client-report.ts, go-live-certificate.ts and report-example.ts. They write only into --out,
// they refuse to guess what the numbers were counted from, and what they write verifies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyFiles } from "../report/keys.ts";
import { verifyEnvelopeText } from "../report/sign.ts";
import { runBusyMonth } from "../report/example-month.ts";
import { bannedIn } from "../report/strings.ts";

const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));
const SETTINGS = fileURLToPath(new URL("../settings/glow-salon.example.json", import.meta.url));
const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
const tree = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

async function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), "geometer-cli-test-"));
  const { world } = await runBusyMonth();
  writeFileSync(join(dir, "record.json"), JSON.stringify(world.record.entries()));
  writeFileSync(join(dir, "bookings.json"), JSON.stringify([...world.store.bookings.values()]));
  copyFileSync(SETTINGS, join(dir, "settings.json"));
  const keys = generateKeyFiles(join(dir, "keys"));
  return { dir, keys, args: ["--settings", join(dir, "settings.json"), "--record", join(dir, "record.json"), "--bookings", join(dir, "bookings.json"), "--month", "2026-11", "--now", "2026-12-02T10:00:00+05:30"] };
}

test("client-report.ts writes the report and the monthly certificate for the shop's language, signed, and only into --out", async () => {
  const { dir, keys, args } = await fixtures();
  const before = tree(dir);
  const out = join(dir, "out");
  const r = run("client-report.ts", ...args, "--lang", "hi", "--out", out, "--source", "stand-in", "--key", keys.privateKeyPath, "--prepared-by", "Divya, local partner");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(out), ["certificate-2026-11-hi.html", "certificate-2026-11-hi.txt", "certificate-2026-11.json", "owner-2026-11-hi.txt", "report-2026-11-hi.html", "report-2026-11.json"]);
  assert.deepEqual(tree(dir).filter((p) => !p.startsWith("out")), before, "nothing was written anywhere but --out");
  assert.ok(r.stdout.includes("Signed with your key") && r.stdout.includes("हुई बुकिंग: 26"));
  const owner = readFileSync(join(out, "owner-2026-11-hi.txt"), "utf8");
  assert.ok(owner.split("\n").filter(Boolean).length <= 5 && bannedIn(owner, "hi").length === 0);
  for (const file of ["report-2026-11.json", "certificate-2026-11.json"]) {
    const v = verifyEnvelopeText(readFileSync(join(out, file), "utf8"));
    assert.equal(v.unchanged, true, file);
    assert.equal(v.keyId, keys.keyId);
  }
  const v = run("verify-report.ts", join(out, "report-2026-11.json"), "--trust-key", keys.publicKeyPath);
  assert.equal(v.status, 0, v.stdout);
});

test("client-report.ts with --lang both writes two owner messages and one page; without --key it says the files are not signed", async () => {
  const { dir, args } = await fixtures();
  const out = join(dir, "both");
  const r = run("client-report.ts", ...args, "--lang", "both", "--out", out, "--source", "test-mode");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(out), ["certificate-2026-11-both.html", "certificate-2026-11-en.txt", "certificate-2026-11-hi.txt", "certificate-2026-11.json", "owner-2026-11-en.txt", "owner-2026-11-hi.txt", "report-2026-11-both.html", "report-2026-11.json"]);
  assert.ok(r.stdout.includes("NOT signed"));
  assert.ok(readFileSync(join(out, "owner-2026-11-en.txt"), "utf8").split("\n")[0].includes("test mode, test money"));
  assert.equal(verifyEnvelopeText(readFileSync(join(out, "report-2026-11.json"), "utf8")).signed, false);
});

test("client-report.ts will not guess: no --source, a bad language, a bad month, a missing file are each said in plain words", async () => {
  const { dir, args } = await fixtures();
  const out = join(dir, "never");
  const noSource = run("client-report.ts", ...args, "--lang", "en", "--out", out);
  assert.equal(noSource.status, 64);
  assert.ok(noSource.stderr.includes("what the numbers were counted from") && noSource.stderr.includes("stand-in | test-mode | live"));
  assert.equal(run("client-report.ts", ...args, "--lang", "ta", "--out", out, "--source", "live").status, 64);
  assert.ok(run("client-report.ts", ...args, "--lang", "ta", "--out", out, "--source", "live").stderr.includes("--lang hi | en | ml | kn | both"));
  const badMonth = run("client-report.ts", ...args.map((a) => (a === "2026-11" ? "November" : a)), "--lang", "en", "--out", out, "--source", "live");
  assert.equal(badMonth.status, 1);
  assert.ok(badMonth.stderr.includes("not a month"));
  const missing = run("client-report.ts", ...args.map((a) => (a.endsWith("record.json") ? join(dir, "nope.json") : a)), "--lang", "en", "--out", out, "--source", "live");
  assert.equal(missing.status, 64);
  assert.ok(missing.stderr.includes("cannot read the record"));
  assert.equal(run("client-report.ts", ...args, "--lang", "en", "--source", "live").status, 64, "no --out");
  assert.equal(run("client-report.ts", "--bogus").status, 64);
  assert.ok(!existsSync(out), "nothing was written when it stopped");
  const asFile = join(dir, "afile");
  writeFileSync(asFile, "x");
  assert.equal(run("client-report.ts", ...args, "--lang", "en", "--out", asFile, "--source", "live").status, 1);
});

test("go-live-certificate.ts runs the hand check and writes the certificate in the shop's language", async () => {
  const { dir, keys } = await fixtures();
  const out = join(dir, "golive");
  const r = run("go-live-certificate.ts", "--settings", join(dir, "settings.json"), "--lang", "ml", "--out", out, "--key", keys.privateKeyPath, "--prepared-by", "Divya, local partner", "--now", "2027-02-04T10:30:00+05:30");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(tree(out), ["go-live-certificate-ml.html", "go-live-certificate-ml.txt", "go-live-certificate.json"]);
  const text = readFileSync(join(out, "go-live-certificate-ml.txt"), "utf8");
  assert.ok(text.includes("34 സാഹചര്യങ്ങളിൽ 34 എണ്ണം") && text.includes("stand-in services") && text.includes("പരിശോധനാ സർട്ടിഫിക്കറ്റ്") && text.includes("Divya, local partner"));
  const v = verifyEnvelopeText(readFileSync(join(out, "go-live-certificate.json"), "utf8"));
  assert.equal(v.unchanged && v.signed, true);
  const en = run("go-live-certificate.ts", "--settings", join(dir, "settings.json"), "--lang", "en", "--out", join(dir, "golive-en"));
  assert.ok(en.stdout.includes("Held 34 of 34 situations. 0 failed. 14 not tested.") && en.stdout.includes("NOT signed"));
});

test("go-live-certificate.ts for another shop's settings says the situations did not run on them", async () => {
  const { dir } = await fixtures();
  const other = JSON.parse(readFileSync(SETTINGS, "utf8"));
  other.name = "Bright Salon";
  other.deposit.amountInr = 100;
  writeFileSync(join(dir, "bright.json"), JSON.stringify(other));
  const r = run("go-live-certificate.ts", "--settings", join(dir, "bright.json"), "--lang", "en", "--out", join(dir, "bright"));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("Held 34 of 34 situations. 0 failed. 15 not tested.") && r.stdout.includes("they ran on the example shop, Glow Salon"));
  assert.ok(r.stdout.includes("Deposit ₹100"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ name: "" }));
  const refused = run("go-live-certificate.ts", "--settings", bad, "--lang", "en", "--out", join(dir, "bad-out"));
  assert.equal(refused.status, 64);
  assert.ok(refused.stderr.includes("The settings need fixing") && !existsSync(join(dir, "bad-out")));
});

test("report-example.ts makes a sample of everything, in all four languages and both, under the folder it is given, and it verifies", () => {
  const out = join(mkdtempSync(join(tmpdir(), "geometer-example-")), "sample");
  const r = run("report-example.ts", "--out", out);
  assert.equal(r.status, 0, r.stderr);
  const files = tree(out);
  for (const language of ["hi", "en", "ml", "kn", "both"]) {
    for (const f of [`report-2026-11-${language}.html`, `certificate-2026-11-${language}.html`, `go-live-certificate-${language}.html`]) assert.ok(files.includes(f), f);
  }
  for (const language of ["hi", "en", "ml", "kn"]) for (const f of [`owner-2026-11-${language}.txt`, `certificate-2026-11-${language}.txt`, `go-live-certificate-${language}.txt`]) assert.ok(files.includes(f), f);
  assert.ok(files.includes("example-public-key.pem") && !files.some((f) => f.includes("report-key.pem") || f.includes("PRIVATE")));
  for (const f of files.filter((n) => n.endsWith(".pem"))) assert.ok(!readFileSync(join(out, f), "utf8").includes("PRIVATE"));
  for (const f of ["report-2026-11.json", "certificate-2026-11.json", "go-live-certificate.json"]) {
    const v = run("verify-report.ts", join(out, f), "--trust-key", join(out, "example-public-key.pem"));
    assert.equal(v.status, 0, `${f}: ${v.stdout}`);
  }
  assert.ok(readFileSync(join(out, "owner-2026-11-en.txt"), "utf8").includes("Bookings made: 26"));
});

test("the default sample folder is ignored by git, so a sample never lands in a commit", () => {
  const ignore = readFileSync(fileURLToPath(new URL("../../../.gitignore", import.meta.url)), "utf8");
  assert.ok(ignore.split("\n").includes("pathways/bookings/report-sample/"));
});
