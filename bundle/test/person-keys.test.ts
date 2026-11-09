// B69: customers' fingerprints nobody outside the shop can work back. The key is made once per shop, stays 0600, reaches only the jobs and the panel, goes into the nightly snapshot, and is
// nowhere in an export. A shop made before B69 gets one and carries on. Each export says which form it uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { generateIdentity } from "../backup/age.ts";
import { exportShop, fingerprints } from "../backup/export.ts";
import { restoreShop, runExports } from "../backup/jobs.ts";
import { openObject, restoreSnapshot, runRestoreJob } from "../backup/restore-snapshot.ts";
import { snapshotShop } from "../backup/snapshot.ts";
import { folderStore } from "../backup/store.ts";
import { deploy } from "../deploy.ts";
import { buildExport, packageTarGz } from "../export/build.ts";
import { sourcesFor } from "../export/sources.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { RECORD_KEY_FILE, derivedKey, personKeyFile, readSecretFile, secretFile, writeSecretFile } from "../lib/secrets.ts";
import { OLD_PERSON_FORM, PERSON_FORM, personLabel } from "../../modules/record/fingerprint.ts";
import { headOf } from "../../modules/record/ledger.ts";
import { openStore } from "../../templates/commerce/bookings/server/store.ts";
import { PERSON_KEY_HEX, panelRuntime, writePersonKey } from "./helpers.ts";
import { world } from "./world.ts";

const NUMBER = "+919811122233";
const NOW = Date.parse("2026-11-07T10:00:00+05:30");
const mode = (file: string) => statSync(file).mode & 0o777;
const plainSha12 = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

/** A runtime database with one booking and one entry, as a shop's store writes them. */
function shopDb(dir: string, entry: Record<string, unknown> = {}): string {
  const store = openStore(join(dir, "rt"));
  store.commitStep({ snapshot: JSON.stringify({ format: 1, bookings: [["b-1", { id: "b-1", customer: NUMBER, state: "confirmed", serviceId: "haircut", depositInr: 200, reminders: [], pending: [], handledPayments: [] }]], customers: [], seenMessages: [], seenEvents: [], nextBooking: 2 }),
    entries: [{ seq: 1, time: "2026-11-04T10:00:00Z", conversation: NUMBER, booking: "b-1", action: "send_message", inputsDigest: "k-0123456789abcdef", outcome: "confirmed", decisions: [], language: "en", notes: "", refs: { messageId: "m-aaaaaaaaaaaa" }, ...entry } as never], nowMs: NOW });
  store.close();
  return join(dir, "rt", "agent.db");
}

test("deploy makes one key per shop: 0600, kept across deploys; the panel gets a 0600 copy, the runtime only a key derived from it, and no generated file holds either", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const master = readSecretFile(personKeyFile(w.root, "glow-salon"))!;
    assert.match(master, /^[0-9a-f]{64}$/u);
    assert.equal(mode(personKeyFile(w.root, "glow-salon")), 0o600);
    const panelCopy = secretFile(w.root, "panel", "person-keys", "glow-salon");
    assert.equal(readSecretFile(panelCopy), master);
    assert.equal(mode(panelCopy), 0o600);
    const recordKey = readSecretFile(secretFile(w.root, "rt-glow-salon", RECORD_KEY_FILE))!;
    assert.equal(recordKey, derivedKey(master, "record"));
    assert.notEqual(recordKey, master, "the runtime holds a key for its one purpose, not the shop's key");

    w.handIn("glow-salon"); await deploy(w.ctx);
    assert.equal(readSecretFile(personKeyFile(w.root, "glow-salon")), master, "made once and kept");

    const compose = readFileSync(join(w.paths.generated, "compose.yaml"), "utf8");
    assert.match(compose, /RECORD_KEY_FILE:\s*"?\/run\/secrets\/record_key/u);
    assert.match(compose, /PANEL_PERSON_KEYS_DIR:\s*"?\/run\/secrets\/person-keys/u);
    const generated = readdirSync(w.paths.generated, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name), "utf8")).join("\n");
    assert.ok(!generated.includes(master) && !generated.includes(recordKey), "neither key is in any generated file");
  } finally { w.done(); }
});

test("a shop made before B69 has no key: the next export gives it one and nothing crashes, and the job names the key's file without holding it", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    rmSync(join(w.root, "secrets", "person-keys"), { recursive: true, force: true });
    rmSync(secretFile(w.root, "panel", "person-keys"), { recursive: true, force: true });
    rmSync(secretFile(w.root, "rt-glow-salon", RECORD_KEY_FILE), { force: true });

    let job = ""; let flags: string[] = [];
    w.ctx.runner = fakeRunner((_c, args) => {
      flags = args;
      const file = args.find((a) => a.endsWith(":/job/job.json:ro"))!.split(":")[0];
      job = readFileSync(file, "utf8");
      return ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, entries: 1, bookings: 1 }] }));
    });
    const r = await runExports(w.ctx);
    assert.equal(r.ok, true, r.lines.join("\n"));

    const master = readSecretFile(personKeyFile(w.root, "glow-salon"))!;
    assert.match(master, /^[0-9a-f]{64}$/u, "it has a key now");
    assert.equal(readSecretFile(secretFile(w.root, "panel", "person-keys", "glow-salon")), master, "and the panel's copy");
    assert.equal(readSecretFile(secretFile(w.root, "rt-glow-salon", RECORD_KEY_FILE)), derivedKey(master, "record"), "and the runtime's");
    assert.equal(JSON.parse(job).shops[0].personKeyFile, "/run/person-keys/glow-salon");
    assert.ok(!job.includes(master), "the job file (0644, on the host) names the key's file and does not hold the key");
    assert.ok(flags.includes(`${join(w.root, "secrets", "person-keys")}:/run/person-keys:ro`), "mounted read-only");
  } finally { w.done(); }
});

test("the export's fingerprints are keyed: not the plain sha256, different under another key, the same person the same across fields, and the chain's head does not move", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-keyed-"));
  try {
    const db = shopDb(dir);
    const out = join(dir, "out");
    const r = exportShop({ name: "s", db, out, personKeyFile: writePersonKey(dir) });
    assert.equal(r.ok, true, r.error);
    const key = Buffer.from(PERSON_KEY_HEX, "hex");
    const record = JSON.parse(readFileSync(join(out, "record.json"), "utf8")); const bookings = JSON.parse(readFileSync(join(out, "bookings.json"), "utf8"));
    assert.equal(record[0].conversation, personLabel(key, "c", NUMBER));
    assert.equal(bookings[0].customer, personLabel(key, "p", NUMBER));
    assert.equal(record[0].conversation.slice(2), bookings[0].customer.slice(2), "one person, one fingerprint, so a case and its entries still join");
    assert.notEqual(record[0].conversation, `c-${plainSha12(NUMBER)}`, "and it is not the old unkeyed hash anyone could reverse");
    assert.notEqual(personLabel(Buffer.alloc(32, 1), "c", NUMBER), record[0].conversation, "another shop's key gives another fingerprint");
    assert.ok(!JSON.stringify([record, bookings]).includes(NUMBER.slice(1)), "no number in the files");
    assert.equal(JSON.parse(readFileSync(join(out, "ledger.json"), "utf8")).at(-1).hash, headOf(record, "s")!.head, "a fingerprint is not chained, so changing its form moves no hash");

    const form = JSON.parse(readFileSync(join(out, "person-form.json"), "utf8"));
    assert.deepEqual(form, { schema: 1, form: PERSON_FORM, inputs: { keyed: 1, older: 0 }, messageIds: { fingerprinted: 1, older: 0 } });

    assert.equal(exportShop({ name: "t", db, out: join(dir, "t"), personKeyFile: join(dir, "absent") }).ok, false, "no key: not exported, never exported unkeyed");
    assert.ok(!existsSync(join(dir, "t")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("two different people landing on one fingerprint stops the export of that shop, rather than merging them", () => {
  const fp = fingerprints(Buffer.alloc(32, 2), () => "aaaaaaaaaaaa");
  assert.equal(fp("c", "+911"), "c-aaaaaaaaaaaa");
  assert.equal(fp("p", "+911"), "p-aaaaaaaaaaaa", "the same person twice is fine");
  assert.throws(() => fp("c", "+912"), /two different people/u);
});

test("a package holds no byte of the key in any form, says which fingerprint form it uses, and says what the fingerprints do not cover", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } });
  try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const master = readSecretFile(personKeyFile(w.root, "glow-salon"))!;
    const out = join(w.root, "exports", "glow-salon");
    const scratch = mkdtempSync(join(tmpdir(), "geo-keyed-"));
    const result = exportShop({ name: "glow-salon", db: shopDb(scratch), out, personKeyFile: personKeyFile(w.root, "glow-salon") });
    assert.equal(result.ok, true, result.error);
    rmSync(scratch, { recursive: true, force: true });

    const built = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW });
    const everything = [...built.files.values(), gunzipSync(packageTarGz(built, NOW)), ...readdirSync(out).map((f) => readFileSync(join(out, f)))];
    const raw = Buffer.from(master, "hex");
    const derived = Buffer.from(derivedKey(master, "record"), "hex");
    for (const secret of [raw, derived]) for (const needle of [secret, Buffer.from(secret.toString("hex")), Buffer.from(secret.toString("base64")), Buffer.from(secret.toString("base64url"))]) {
      for (const content of everything) assert.equal(content.indexOf(needle), -1, "the shop's key is in the package");
    }

    assert.deepEqual(built.manifest.personFingerprints, { form: PERSON_FORM, keyed: true, inputsKeyed: 1, inputsOlder: 0, messageIdsOlder: 0 });
    assert.deepEqual(built.warnings.filter((x) => /before keyed/u.test(x)), []);
    const readme = built.files.get("README.txt")!.toString("utf8");
    assert.ok(readme.includes(`Form: ${PERSON_FORM}`));
    assert.match(readme, /settings\.json and history\/settings-history\.jsonl are the shop's own settings as written/u, "the people in the settings are said, not passed over");
    assert.match(readme, /Free text: a number or a name/u);
    assert.ok(!/passed around|short hash/u.test(readme), "the old claim is gone");

    // an export made before B69 (no marker) says so, and says what that means
    rmSync(join(out, "person-form.json"));
    const old = buildExport(sourcesFor(w.root, "glow-salon"), { shop: "glow-salon", now: NOW });
    assert.deepEqual(old.manifest.personFingerprints, { form: OLD_PERSON_FORM, keyed: false });
    assert.match(old.files.get("README.txt")!.toString("utf8"), /Anyone holding this package can work those back/u);
    assert.ok(old.warnings.some((x) => /before keyed/u.test(x)));
  } finally { w.done(); }
});

test("the nightly snapshot carries the key inside its encrypted manifest, with no extra object, and both ways of opening a snapshot give it back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-keyed-"));
  try {
    const key = generateIdentity();
    const bucket = join(dir, "bucket");
    const stamp = "20261104T013000Z";
    const r = await snapshotShop({ name: "glow-salon", runtimeDb: shopDb(dir), personKeyFile: writePersonKey(dir), guards: [] }, { stamp, keepDays: 30, recipient: key.recipient, target: { url: bucket }, shops: [] }, folderStore(bucket), join(dir, "scratch"));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.files, 2, "the database and the manifest: the key costs no bucket request of its own");
    assert.ok(!JSON.stringify(r.seal).includes(PERSON_KEY_HEX), "the seal, kept in the clear on the server, does not hold it");
    const sealed = readFileSync(join(bucket, "glow-salon", stamp, "manifest.json.gz.age"));
    assert.equal(sealed.indexOf(Buffer.from(PERSON_KEY_HEX)), -1, "not readable in the bucket");
    assert.equal(JSON.parse(openObject("manifest.json.gz.age", sealed, key.identity).get("manifest.json")!.toString()).personKey, PERSON_KEY_HEX);

    const byHand = join(dir, "by-hand");
    restoreSnapshot(join(bucket, "glow-salon", stamp), key.identity, byHand);
    assert.equal(readFileSync(join(byHand, "person_key"), "utf8").trim(), PERSON_KEY_HEX, "a person opening a snapshot gets the key out with the database");

    const identityFile = join(dir, "identity"); writeFileSync(identityFile, key.identity);
    const out = join(dir, "job-out");
    await runRestoreJob({ target: { url: bucket }, shop: "glow-salon", identityFile, out, nowIso: "2026-11-05T00:00:00.000Z" }, folderStore(bucket));
    assert.equal(readFileSync(join(out, "person_key"), "utf8").trim(), PERSON_KEY_HEX, "`geometer restore` gets it out too");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("`restore` puts the snapshot's key back, with its copies, before the runtime starts; a key a new machine made is kept beside it; a snapshot with no key leaves the shop's as it is", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true }, backup: { snapshots: { url: "s3://snaps/a" }, ageRecipient: generateIdentity().recipient } });
  try {
    writeSecretFile(secretFile(w.root, "backup", "snapshots"), "A:B");
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const fresh = readSecretFile(personKeyFile(w.root, "glow-salon"))!; // what a first deploy on a new machine makes
    const restored = "ab".repeat(32);
    const identity = join(w.root, "owner-key"); writeFileSync(identity, "AGE-SECRET-KEY-1X");
    const run = (key: string | undefined, atStart: () => void) => fakeRunner((_c, args) => {
      if (args.includes("--job")) {
        const work = args.find((a) => a.endsWith(":/out"))!.slice(0, -":/out".length);
        if (key) writeFileSync(join(work, "files", "person_key"), `${key}\n`);
        return ok(JSON.stringify({ ok: true, stamp: "20261104T013000Z", record: { records: 7, lastSeq: 7, lastEntryDigest: "d" } }));
      }
      if (args.includes("start")) atStart();
      return ok("");
    });

    let atStart = "";
    w.ctx.runner = run(restored, () => { atStart = readSecretFile(secretFile(w.root, "rt-glow-salon", RECORD_KEY_FILE))!; });
    const said = await restoreShop(w.ctx, "glow-salon", { identity });
    assert.equal(readSecretFile(personKeyFile(w.root, "glow-salon")), restored);
    assert.equal(mode(personKeyFile(w.root, "glow-salon")), 0o600);
    assert.equal(readSecretFile(secretFile(w.root, "panel", "person-keys", "glow-salon")), restored, "the panel's copy follows");
    assert.equal(atStart, derivedKey(restored, "record"), "the runtime's key is the restored one by the time it starts");
    assert.match(said, /fingerprint key was put back from the snapshot; the one it replaced is kept as glow-salon\.before-restore-/u);
    const kept = readdirSync(join(w.root, "secrets", "person-keys")).find((n) => n.includes("before-restore"))!;
    assert.equal(readFileSync(join(w.root, "secrets", "person-keys", kept), "utf8").trim(), fresh, "the key it replaced is not deleted");
    assert.ok(!said.includes(restored), "the message never holds the key");

    w.ctx.runner = run(restored, () => undefined);
    assert.doesNotMatch(await restoreShop(w.ctx, "glow-salon", { identity }), /fingerprint key/u, "the same key again: nothing to say");

    w.ctx.runner = run(undefined, () => undefined);
    assert.match(await restoreShop(w.ctx, "glow-salon", { identity }), /holds no fingerprint key .* keeps the one it has/u);
    assert.equal(readSecretFile(personKeyFile(w.root, "glow-salon")), restored);

    w.ctx.runner = run("not a key", () => undefined);
    await assert.rejects(restoreShop(w.ctx, "glow-salon", { identity }), /is not a key/u);
    assert.equal(readSecretFile(personKeyFile(w.root, "glow-salon")), restored, "something that is not a key is never put in place");
  } finally { w.done(); }
});
