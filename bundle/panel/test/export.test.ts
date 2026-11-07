// The shop export (B38), through the panel's download: everything that is the shop's in open files, a manifest the open check reads, signed papers the report verifier reads, and no
// key or secret anywhere. It is built from files only, so a stopped shop and a lapsed plan export like any other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBusyMonth } from "../../../templates/commerce/bookings/report/example-month.ts";
import { runBusyMonth as runFeesMonth } from "../../../templates/education/fees/report/example-month.ts";
import { envelopeFile, seal } from "../../../modules/report/sign.ts";
import { checkPackage, describe as describeCheck } from "../../export/check.ts";
import { fromTarGz } from "../../export/tar.ts";
import { WORDS } from "../languages.ts";
import { NOW, accountIdOf, boot, papers } from "./helpers.ts";
import type { Boot, Browser } from "./helpers.ts";

const VERIFY = new URL("../../../templates/commerce/bookings/scripts/verify-report.ts", import.meta.url).pathname;
const SECRETS = { razorpay_key: "rzp_test_SENTINELKEYID1:SENTINELKEYSECRET2", whatsapp_token: "SENTINELWHATSAPPTOKEN3", whatsapp_app_secret: "SENTINELAPPSECRET4", razorpay_webhook_secret: "SENTINELWEBHOOK5" };
const applied = () => ({ updatedAt: new Date(NOW - 5 * 60_000).toISOString(), deploy: { state: "applied", at: new Date(NOW - 3600_000).toISOString() }, limits: { proven: 9, of: 9, unprovable: [] }, versions: { pathway: "0.1.0", bundle: "0.1.0" } });

/** The bytes of every file the download holds, with the folder name taken off. */
async function download(who: Browser, shop: string): Promise<{ status: number; files: Map<string, Buffer>; name: string; disposition: string }> {
  const r = await who.bytes(`/shops/${shop}/export`);
  if (r.status !== 200) return { status: r.status, files: new Map(), name: "", disposition: "" };
  const all = fromTarGz(r.body);
  const [top] = [...all.keys()][0].split("/");
  return { status: r.status, files: new Map([...all].map(([p, c]) => [p.slice(top.length + 1), c])), name: top, disposition: r.headers.get("content-disposition") ?? "" };
}

function plantSecrets(b: Boot, shop: string): void {
  mkdirSync(join(b.dir, "secrets-inbox", shop), { recursive: true });
  for (const [name, text] of Object.entries(SECRETS)) writeFileSync(join(b.dir, "secrets-inbox", shop, name), text);
  mkdirSync(join(b.dir, "shops", shop), { recursive: true });
}

function noSecretsIn(files: Map<string, Buffer>, b: Boot): void {
  const sessionSecret = (() => { try { return readFileSync(join(b.dir, "panel", "session-secret"), "utf8").trim(); } catch { return undefined; } })();
  const dataKey = b.config.dataKeyFile ? readFileSync(b.config.dataKeyFile, "utf8").trim() : undefined;
  const forbidden = [...Object.values(SECRETS), ...Object.values(SECRETS).flatMap((v) => v.split(":")), ...(sessionSecret ? [sessionSecret] : []), ...(dataKey ? [dataKey] : []), "BEGIN PRIVATE KEY", "sessionVersion"];
  for (const [path, content] of files) for (const word of forbidden) assert.ok(!content.toString("utf8").includes(word), `${path} holds "${word.slice(0, 12)}…"`);
  assert.ok(![...files.keys()].some((p) => /secret|\.pem$|\.key$/u.test(p)), [...files.keys()].join());
}

async function bookingsShop(b: Boot, arjun: Browser) {
  b.addShop("glow-salon", { name: "Glow Salon" });
  b.status("glow-salon", applied());
  plantSecrets(b, "glow-salon");
  writeFileSync(join(b.dir, "shops", "glow-salon", "pins.json"), JSON.stringify({ schema: 1, checkedAt: new Date(NOW).toISOString(), whatsapp: { phoneNumberId: "100000000000001", displayNumber: "+919000011111" }, calendar: { calendarId: "glowsalon@group.calendar.google.com" }, razorpay: { keyId: "rzp_test_SENTINELKEYID1", mode: "test" } }));
  const month = await runBusyMonth();
  mkdirSync(join(b.dir, "exports", "glow-salon"), { recursive: true });
  writeFileSync(join(b.dir, "exports", "glow-salon", "record.json"), JSON.stringify(month.world.record.entries()));
  writeFileSync(join(b.dir, "exports", "glow-salon", "bookings.json"), JSON.stringify([...month.world.store.bookings.values()]));
  assert.equal((await arjun.post("/shops/glow-salon/report", { month: "2026-11" }, "/shops/glow-salon")).status, 303);
  // a go-live certificate, as the panel keeps it
  papers(b, "glow-salon").make("glow-salon", "go-live", (dir) => {
    writeFileSync(join(dir, "go-live-certificate.json"), envelopeFile(seal({ pathway: { name: "bookings" }, note: "made for this test" })));
    writeFileSync(join(dir, "go-live-certificate.html"), "<p>go-live</p>");
  });
  return month;
}

test("the download is a folder of open files with a manifest, and it is whole: every file is the one the manifest names", async () => {
  const b = await boot({}, { signing: true, key: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const month = await bookingsShop(b, arjun);
    const d = await download(arjun, "glow-salon");
    assert.equal(d.status, 200);
    assert.match(d.disposition, /^attachment; filename="geometer-export-glow-salon-\d{8}\.tar\.gz"$/u);
    for (const f of ["README.txt", "manifest.json", "SHA256SUMS", "settings.json", "limits.json", "accounts.json", "status.json"]) assert.ok(d.files.has(f), `${f}: ${[...d.files.keys()].join()}`);
    assert.ok(!d.files.has("assignment.json"), "nobody has moved this shop");
    assert.ok(d.files.has("history/settings-history.jsonl") && d.files.has("record/record.jsonl") && d.files.has("record/cases.jsonl"));
    assert.ok([...d.files.keys()].some((p) => /^reports\/2026-11\/report-2026-11\.json$/u.test(p)), "the monthly report");
    assert.ok(d.files.has("certificates/go-live/go-live-certificate.json"), "the go-live certificate");
    const check = checkPackage(d.files);
    assert.ok(check.ok, describeCheck(check));
    const manifest = JSON.parse(d.files.get("manifest.json")!.toString("utf8"));
    assert.equal(manifest.format, "geometer-shop-export/1");
    assert.equal(manifest.template, "bookings");
    assert.equal(manifest.counts.recordEntries, month.world.record.entries().length);
    assert.equal(manifest.counts.cases, month.world.store.bookings.size);
    assert.equal(manifest.exportedBy.name, "ARJUN");
    // the record is JSON lines, one entry each, in order, and the cases too
    const lines = d.files.get("record/record.jsonl")!.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((e) => e.seq), month.world.record.entries().map((e) => e.seq));
    assert.equal(d.files.get("record/cases.jsonl")!.toString("utf8").trim().split("\n").length, month.world.store.bookings.size);
    // settings are the server's bytes; the limits carry the policy digest and Guard's refund spec; the accounts are names, not keys
    assert.equal(d.files.get("settings.json")!.toString("utf8"), readFileSync(join(b.dir, "shops", "glow-salon", "settings.json"), "utf8"));
    const limits = JSON.parse(d.files.get("limits.json")!.toString("utf8"));
    assert.match(limits.policyDigest, /^sha256:|^[0-9a-f]{16,}/u);
    assert.ok(limits.razorpay && typeof limits.razorpay === "object");
    assert.deepEqual(limits.provenAtLastDeploy, { proven: 9, of: 9, unprovable: [] });
    const accounts = JSON.parse(d.files.get("accounts.json")!.toString("utf8"));
    assert.equal(accounts.whatsapp.phoneNumberId, "100000000000001");
    assert.equal(accounts.payments.mode, "test");
    assert.ok(!("keyId" in accounts.payments));
    // no history was kept before this feature: it says so instead of making one up
    assert.equal(d.files.get("history/settings-history.jsonl")!.length, 0);
    assert.ok(manifest.notes.some((n: string) => /No earlier versions of the settings/u.test(n)));
  } finally { await b.close(); }
});

test("no key and no secret is in the download: not the keys handed in, not the panel's secrets, not a signing key", async () => {
  const b = await boot({}, { signing: true, key: true });
  try {
    const arjun = await b.account("arjun", "builder");
    await bookingsShop(b, arjun);
    const d = await download(arjun, "glow-salon");
    assert.equal(d.status, 200);
    noSecretsIn(d.files, b);
    // the archive itself, not only the files in it
    const raw = (await arjun.bytes("/shops/glow-salon/export")).body;
    for (const v of Object.values(SECRETS)) assert.ok(!raw.includes(Buffer.from(v)));
    // and the builder refuses to put one in even if one got into a file it reads
    writeFileSync(join(b.dir, "shops", "glow-salon", "settings-history.jsonl"), `{"note":"-----BEGIN PRIVATE KEY-----"}\n`);
    const refused = await arjun.get("/shops/glow-salon/export");
    assert.equal(refused.status, 409);
    assert.ok(/looks as if it holds a private key/u.test(refused.plain), refused.plain.slice(0, 400));
  } finally { await b.close(); }
});

test("the open verifiers read it: the report verifier checks the signed papers in the download, and a changed paper fails", async () => {
  const b = await boot({}, { signing: true, key: true });
  const scratch = mkdtempSync(join(tmpdir(), "geo-export-"));
  try {
    const arjun = await b.account("arjun", "builder");
    await bookingsShop(b, arjun);
    const d = await download(arjun, "glow-salon");
    const report = d.files.get("reports/2026-11/report-2026-11.json")!;
    const file = join(scratch, "report-2026-11.json");
    writeFileSync(file, report);
    const ok = spawnSync("node", [VERIFY, file], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /Unchanged since key:/u);
    const changed = join(scratch, "changed.json");
    writeFileSync(changed, report.toString("utf8").replace("Glow Salon", "Glow Saloon"));
    assert.equal(spawnSync("node", [VERIFY, changed], { encoding: "utf8" }).status, 1);
    // the package check does the same over every signed paper, from a folder it was unpacked into
    const folder = join(scratch, "unpacked");
    for (const [p, c] of d.files) { mkdirSync(join(folder, p, ".."), { recursive: true }); writeFileSync(join(folder, p), c); }
    const run = spawnSync("node", [new URL("../../export/check.ts", import.meta.url).pathname, folder], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /Whole: every file/u);
    assert.match(run.stdout, /unchanged .*reports\/2026-11\/report-2026-11\.json/u);
    writeFileSync(join(folder, "record", "record.jsonl"), "{}\n");
    const bad = spawnSync("node", [new URL("../../export/check.ts", import.meta.url).pathname, folder], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /record\/record\.jsonl is not the file the manifest names/u);
    // sha256sum -c reads SHA256SUMS too
    const sums = d.files.get("SHA256SUMS")!.toString("utf8");
    assert.ok(sums.split("\n").filter(Boolean).every((l) => /^[0-9a-f]{64}  \S+$/u.test(l)));
  } finally { rmSync(scratch, { recursive: true, force: true }); await b.close(); }
});

test("it works for a shop that is stopped, whose plan lapsed, and whose runtime does not answer", async () => {
  const b = await boot({ runtimeUrl: "http://127.0.0.1:9/{shop}" }, { signing: true });
  try {
    const arjun = await b.account("arjun", "builder");
    await bookingsShop(b, arjun);
    b.status("glow-salon", { ...applied(), stopped: { at: new Date(NOW - HOUR_MS).toISOString() } });
    mkdirSync(join(b.dir, "fleet"), { recursive: true });
    writeFileSync(join(b.dir, "fleet", "glow-salon.json"), JSON.stringify({ schema: 1, at: new Date(NOW).toISOString(), plan: null, allowance: null, innovator: false, ai: "normal", warn: ["subscription_lapsed"] }));
    const d = await download(arjun, "glow-salon");
    assert.equal(d.status, 200);
    assert.ok(checkPackage(d.files).ok);
    // the last deploy failed and its message names a missing secret file: that is a sentence, not a secret, and the shop still gets its files
    b.status("glow-salon", { ...applied(), deploy: { state: "failed", at: new Date(NOW).toISOString(), message: "razorpay_key is missing for glow-salon; whatsapp_token too" } });
    const failed = await download(arjun, "glow-salon");
    assert.equal(failed.status, 200);
    assert.match(failed.files.get("status.json")!.toString("utf8"), /razorpay_key is missing/u);
    // a shop whose status file is gone and that was never exported still exports what it has, and says what it does not
    rmSync(join(b.dir, "status", "glow-salon.json"));
    rmSync(join(b.dir, "exports", "glow-salon"), { recursive: true, force: true });
    const bare = await download(arjun, "glow-salon");
    assert.equal(bare.status, 200);
    assert.ok(checkPackage(bare.files).ok);
    const manifest = JSON.parse(bare.files.get("manifest.json")!.toString("utf8"));
    assert.ok(manifest.notes.some((n: string) => /had not yet exported this shop's record/u.test(n)));
    assert.equal(manifest.counts.recordEntries, 0);
  } finally { await b.close(); }
});
const HOUR_MS = 3_600_000;

test("only a person who can see the shop can take its files: another partner gets the same 404 as for a shop that is not there", async () => {
  const b = await boot({}, { signing: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const divya = await b.account("divya", "partner");
    const meera = await b.account("meera", "partner");
    b.addShop("glow-salon", { name: "Glow Salon", ownerId: accountIdOf(b, "divya"), ownerName: "DIVYA" });
    void arjun;
    assert.equal((await divya.bytes("/shops/glow-salon/export")).status, 200);
    assert.equal((await meera.bytes("/shops/glow-salon/export")).status, 404);
    assert.equal((await meera.bytes("/shops/not-a-shop/export")).status, 404);
    const stranger = b.browser();
    assert.equal((await stranger.bytes("/shops/glow-salon/export")).status, 303);
    // the shop page has the way in, in every language
    for (const l of ["en", "hi", "ml", "kn"] as const) {
      await divya.get(`/lang/${l}?next=/shops`);
      const page = (await divya.get("/shops/glow-salon")).plain;
      assert.ok(page.includes(WORDS[l].takeOut.heading) && page.includes(WORDS[l].takeOut.notIn), l);
    }
  } finally { await b.close(); }
});

test("a Fees centre exports its fees in place of bookings, and its report verifies", async () => {
  const b = await boot({}, { signing: true });
  const scratch = mkdtempSync(join(tmpdir(), "geo-export-"));
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("sunrise-tuition", { name: "Sunrise Tuition" });
    const dir = join(b.dir, "shops", "sunrise-tuition");
    cpSync(new URL("../../../templates/education/fees/settings/bright-tuition.example.json", import.meta.url).pathname, join(dir, "settings.json"));
    writeFileSync(join(dir, "pathway.lock"), "fees@0.1.0\n");
    writeFileSync(join(dir, "runtime.json"), JSON.stringify({ mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: "100000000000001" }, timeoutMs: 20000 } }));
    const month = await runFeesMonth();
    mkdirSync(join(b.dir, "exports", "sunrise-tuition"), { recursive: true });
    writeFileSync(join(b.dir, "exports", "sunrise-tuition", "record.json"), JSON.stringify(month.world.record.entries()));
    writeFileSync(join(b.dir, "exports", "sunrise-tuition", "dues.json"), JSON.stringify([...month.world.store.dues.values()]));
    assert.equal((await arjun.post("/shops/sunrise-tuition/report", { month: "2026-11" }, "/shops/sunrise-tuition")).status, 303);
    const d = await download(arjun, "sunrise-tuition");
    assert.equal(d.status, 200);
    assert.ok(checkPackage(d.files).ok);
    const manifest = JSON.parse(d.files.get("manifest.json")!.toString("utf8"));
    assert.equal(manifest.template, "fees");
    assert.equal(manifest.counts.cases, month.world.store.dues.size);
    assert.ok(manifest.counts.cases > 0);
    const report = [...d.files].find(([p]) => /^reports\/2026-11\/report-2026-11\.json$/u.test(p));
    assert.ok(report);
    writeFileSync(join(scratch, "r.json"), report[1]);
    assert.equal(spawnSync("node", [VERIFY, join(scratch, "r.json")], { encoding: "utf8" }).status, 0);
  } finally { rmSync(scratch, { recursive: true, force: true }); await b.close(); }
});
