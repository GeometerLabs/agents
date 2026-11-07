// The shop export (B38) on the command line and in its parts: `geometer export`, the tar file, the check, and the settings' history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../geometer.ts";
import { buildExport, packageTarGz } from "../export/build.ts";
import { checkPackage, describe as describeCheck, readPackage } from "../export/check.ts";
import { sourcesFor } from "../export/sources.ts";
import { fromTarGz, toTarGz } from "../export/tar.ts";
import { createShops } from "../panel/shops.ts";
import type { Account } from "../panel/accounts.ts";
import type { PanelConfig } from "../panel/config.ts";
import { fakeRunner } from "../lib/runner.ts";
import { panelRuntime } from "./helpers.ts";
import { secretsFor, world } from "./world.ts";

async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

const NOW = Date.parse("2026-11-07T10:00:00+05:30");
const entry = (seq: number, booking: string | null, action: string, outcome: string) => ({ seq, time: new Date(NOW - 3_600_000 * (10 - seq)).toISOString(), conversation: "c-aaaaaaaaaaaa", booking, action, inputsDigest: "0123456789abcdef", outcome, decisions: [], language: "en", notes: "", refs: {} });

function exportRecord(root: string, shop: string): void {
  const dir = join(root, "exports", shop);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "record.json"), JSON.stringify([entry(1, "b-1", "hold_slot", "confirmed"), entry(2, "b-1", "create_deposit_link", "confirmed"), entry(3, null, "receive_message", "confirmed")]));
  writeFileSync(join(dir, "bookings.json"), JSON.stringify([{ id: "b-1", customer: "p-bbbbbbbbbbbb", state: "confirmed", pending: [] }]));
}

test("export on a server with no panel writes the folder and the .tar.gz from the server's files, with no key or secret in either, and says what the panel would have added", async () => {
  const w = world(); const out = mkdtempSync(join(tmpdir(), "geo-out-"));
  try {
    w.handIn("glow-salon");
    exportRecord(w.root, "glow-salon");
    const r = await quiet(() => main(["export", "glow-salon", "--out", out, "--server", w.root], w.ctx));
    assert.equal(r.result, 0, r.err);
    assert.match(r.out, /Exported glow-salon: \d+ files in .*geometer-export-glow-salon-\d{8}/u);
    assert.match(r.out, /the reports and certificates the panel makes are not in this package/u);
    assert.match(r.out, /Every file is the one the manifest names\. No key or secret is in it\./u);
    const [name] = readdirSync(out).filter((f) => !f.endsWith(".tar.gz"));
    assert.ok(existsSync(join(out, `${name}.tar.gz`)));
    const folder = readPackage(join(out, name));
    const archive = readPackage(join(out, `${name}.tar.gz`));
    assert.deepEqual([...folder.keys()].sort(), [...archive.keys()].sort(), "the folder and the archive hold the same files");
    assert.ok(checkPackage(folder).ok);
    const lines = folder.get("record/record.jsonl")!.toString("utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[1]).action, "create_deposit_link");
    // the keys handed in for the shop (and the server's own) are nowhere
    for (const [file, text] of [...folder, ...archive]) for (const secret of Object.values(secretsFor("glow-salon")).flatMap((v) => (v.includes(":") && !v.includes("PRIVATE") ? v.split(":") : [v]))) {
      if (secret.length > 8 && !secret.startsWith("{")) assert.ok(!text.toString("utf8").includes(secret), `${file} holds a secret`);
    }
    // run from a command line the check agrees
    const run = spawnSync("node", [new URL("../export/check.ts", import.meta.url).pathname, join(out, name)], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally { rmSync(out, { recursive: true, force: true }); w.done(); }
});

test("export on a server with a panel asks the panel container (the only one that can open the papers it keeps) and writes what it hands back; when it cannot, it says why", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } }); const out = mkdtempSync(join(tmpdir(), "geo-out-"));
  try {
    exportRecord(w.root, "glow-salon");
    const built = buildExport(sourcesFor(w.root, "glow-salon", { papers: () => [{ path: "go-live/go-live-certificate.html", text: "<p>from the panel</p>" }], meta: () => undefined }), { shop: "glow-salon", now: NOW, exportedBy: { name: "geometer export", role: "server" } });
    const calls: string[][] = [];
    const ctx = { ...w.ctx, runner: fakeRunner((_c, args) => { calls.push(args); return args.includes("/app/bundle/panel/main.ts") ? { code: 0, stdout: `${JSON.stringify({ ok: true, name: built.name, warnings: [], tgz: packageTarGz(built, NOW).toString("base64") })}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" }; }) };
    const r = await quiet(() => main(["export", "glow-salon", "--out", out, "--server", w.root], ctx));
    assert.equal(r.result, 0, r.err);
    const exec = calls.at(-1)!;
    assert.deepEqual(exec.slice(exec.indexOf("exec")), ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "export", "glow-salon", "--json"]);
    assert.ok(existsSync(join(out, built.name, "certificates", "go-live", "go-live-certificate.html")), "what the panel added is in the folder");
    assert.ok(!r.out.includes("not in this package"));
    // the panel says no (no settings): that is the answer, in its words
    const refuses = { ...w.ctx, runner: fakeRunner(() => ({ code: 1, stdout: `${JSON.stringify({ ok: false, error: "There is no settings.json for glow-salon, so there is nothing to export." })}\n`, stderr: "" })) };
    assert.match((await quiet(() => main(["export", "glow-salon", "--out", out, "--server", w.root], refuses))).err, /nothing to export/u);
    // the panel is not running
    const down = { ...w.ctx, runner: fakeRunner(() => ({ code: 1, stdout: "", stderr: 'service "panel" is not running' })) };
    assert.match((await quiet(() => main(["export", "glow-salon", "--out", out, "--server", w.root], down))).err, /panel did not answer .*not running/u);
    assert.match((await quiet(() => main(["export", "--server", w.root], w.ctx))).err, /Say which shop/u);
  } finally { rmSync(out, { recursive: true, force: true }); w.done(); }
});

test("the tar file opens with the system's own tar, keeps long names and any bytes, and is the same bytes for the same files", () => {
  const files = new Map<string, Buffer>([
    ["a/short.txt", Buffer.from("hello\n")],
    [`reports/2026-11/${"x".repeat(90)}.json`, Buffer.from("{}\n")],
    ["binary.bin", Buffer.from([0, 255, 1, 254, 10, 13])],
    ["empty.txt", Buffer.alloc(0)],
    ["exact-block.txt", Buffer.alloc(512, 97)],
  ]);
  const tgz = toTarGz(files, NOW);
  assert.deepEqual(toTarGz(files, NOW), tgz);
  const back = fromTarGz(tgz);
  assert.deepEqual([...back.keys()], [...files.keys()]);
  for (const [p, c] of files) assert.ok(back.get(p)!.equals(c), p);
  const dir = mkdtempSync(join(tmpdir(), "geo-tar-"));
  try {
    writeFileSync(join(dir, "x.tar.gz"), tgz);
    const listed = spawnSync("tar", ["-tzf", join(dir, "x.tar.gz")], { encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split("\n").sort(), [...files.keys()].sort());
    mkdirSync(join(dir, "out"));
    assert.equal(spawnSync("tar", ["-xzf", join(dir, "x.tar.gz"), "-C", join(dir, "out")]).status, 0);
    assert.ok(readFileSync(join(dir, "out", "binary.bin")).equals(files.get("binary.bin")!));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.throws(() => toTarGz(new Map([[`${"y".repeat(300)}`, Buffer.from("x")]]), NOW), /too long/u);
});

test("the check finds a changed file, a missing file, an extra file, a changed hash list and an unsigned or altered paper", () => {
  const w = world();
  exportRecord(w.root, "glow-salon");
  try {
    const built = buildExport(sourcesFor(w.root, "glow-salon", { papers: () => [{ path: "monthly/2026-11/report-2026-11.json", text: "{\"not\":\"a signed paper\"}" }], meta: () => undefined }), { shop: "glow-salon", now: NOW });
    const bad = checkPackage(built.files);
    assert.ok(!bad.ok && bad.problems.some((p) => /reports\/2026-11\/report-2026-11\.json/u.test(p)), "a paper that is not a signed report is flagged");
    const clean = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW });
    assert.ok(checkPackage(clean.files).ok, describeCheck(checkPackage(clean.files)));
    const change = (f: (m: Map<string, Buffer>) => void) => { const m = new Map(clean.files); f(m); return checkPackage(m); };
    assert.ok(change((m) => m.set("settings.json", Buffer.from("{}"))).problems.some((p) => /settings\.json is not the file the manifest names/u.test(p)));
    assert.ok(change((m) => m.delete("limits.json")).problems.some((p) => /limits\.json is missing/u.test(p)));
    assert.ok(change((m) => m.set("extra.txt", Buffer.from("x"))).problems.some((p) => /extra\.txt is in the package but not in the manifest/u.test(p)));
    assert.ok(change((m) => m.set("SHA256SUMS", Buffer.from("0".repeat(64) + "  settings.json\n"))).problems.some((p) => /SHA256SUMS does not match/u.test(p)));
    assert.ok(change((m) => m.delete("SHA256SUMS")).problems.some((p) => /SHA256SUMS is missing/u.test(p)));
    assert.ok(!checkPackage(new Map([["x.txt", Buffer.from("x")]])).ok);
    assert.ok(!checkPackage(new Map([["manifest.json", Buffer.from("{ nope")]])).ok);
  } finally { w.done(); }
});

test("the README names the format and how to check it, says what is left out, ends with the help line, and uses none of the words we do not use", () => {
  const w = world();
  try {
    exportRecord(w.root, "glow-salon");
    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW, exportedBy: { name: "Arjun", role: "builder" } });
    const readme = built.files.get("README.txt")!.toString("utf8");
    for (const part of ["geometer-shop-export/1", "sha256sum -c SHA256SUMS", "node bundle/export/check.ts", "verify-report.ts", "geometer-verify", "No key and no secret", "WhatsApp number", "Write to support. A person answers."]) assert.ok(readme.includes(part), part);
    assert.ok(!/\b(safe|safely|guarantee[ds]?|proves?|certified|100%|founder|founding|communal)\b/iu.test(readme), "the README's own words");
    assert.match(readme, /Made 2026-11-07T04:30:00\.000Z for Arjun \(builder\)/u);
  } finally { w.done(); }
});

test("the settings' history keeps each saved version once, with who saved it, and starts only when the panel starts keeping it", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-hist-"));
  try {
    mkdirSync(join(dir, "shops", "glow-salon"), { recursive: true });
    const shops = createShops({ serverDir: dir, now: () => NOW } as PanelConfig, {} as never);
    const divya = { id: "acc-1", name: "Divya", role: "partner" } as Account;
    shops.recordSettings("glow-salon", { name: "Glow Salon", deposit: { amountInr: 200 } }, divya);
    shops.recordSettings("glow-salon", { deposit: { amountInr: 200 }, name: "Glow Salon" }, divya); // the same settings, keys in another order
    shops.recordSettings("glow-salon", { name: "Glow Salon", deposit: { amountInr: 300 } }, divya);
    const lines = readFileSync(join(dir, "shops", "glow-salon", "settings-history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => l.settings.deposit.amountInr), [200, 300]);
    assert.deepEqual(lines[0].by, { id: "acc-1", name: "Divya", role: "partner" });
    assert.match(lines[0].digest, /^[0-9a-f]{64}$/u);
    assert.notEqual(lines[0].digest, lines[1].digest);
    assert.equal(lines[0].at, new Date(NOW).toISOString());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("limits.json holds the spec the deployer's own generator makes for this server (its approval hours), and says so when the server's settings could not be read", () => {
  for (const [change, ttl] of [[{}, 24 * 3600], [{ approvalHours: 48 }, 48 * 3600]] as const) {
    const w = world({ "glow-salon": panelRuntime() }, change);
    try {
      const limits = JSON.parse(buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW }).files.get("limits.json")!.toString("utf8"));
      assert.equal(limits.razorpay.approval_ttl_seconds, ttl);
      assert.equal(limits.razorpay.name, "glow-salon-razorpay");
      assert.ok(!/could not be read/u.test(limits.note));
    } finally { w.done(); }
  }
  const w = world();
  try {
    rmSync(join(w.root, "geometer.json"));
    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW });
    const limits = JSON.parse(built.files.get("limits.json")!.toString("utf8"));
    assert.ok(limits.razorpay, "still made, with the defaults");
    assert.match(limits.note, /could not be read, so it was made with the default approval time and caps/u);
    assert.ok(built.warnings.some((x) => /could not be read/u.test(x)));
  } finally { w.done(); }
});

test("the guard looks for what a secret looks like, never for a secret's name: a failed deploy that says 'razorpay_key is missing' still exports", () => {
  const w = world();
  try {
    exportRecord(w.root, "glow-salon");
    mkdirSync(join(w.root, "status"), { recursive: true });
    writeFileSync(join(w.root, "status", "glow-salon.json"), JSON.stringify({ updatedAt: new Date(NOW).toISOString(), deploy: { state: "failed", at: new Date(NOW).toISOString(), message: "razorpay_key is missing for glow-salon; the key id rzp_test_abcdefghij does not match, whatsapp_token too" } }));
    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW });
    assert.ok(checkPackage(built.files).ok);
    assert.match(built.files.get("status.json")!.toString("utf8"), /razorpay_key is missing/u);
    // what a secret looks like is still refused
    const mistaken = (text: string) => buildExport({ ...sourcesFor(w.root, "glow-salon"), statusText: () => JSON.stringify({ deploy: { state: "failed", message: text } }) }, { shop: "glow-salon", now: NOW });
    assert.throws(() => mistaken("-----BEGIN PRIVATE KEY-----"), /holds a private key/u);
    assert.throws(() => mistaken(`key rzp_test_abcdefghij:${"s".repeat(24)}`), /holds a Razorpay key with its secret/u);
    assert.throws(() => mistaken(`token EAA${"x".repeat(60)}`), /holds an access token/u);
    assert.throws(() => mistaken(`{"private_key": "${"k".repeat(40)}"}`), /holds a service-account key/u);
  } finally { w.done(); }
});
