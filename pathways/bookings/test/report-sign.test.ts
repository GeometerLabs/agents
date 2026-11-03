// Signing and checking. A signed file must round-trip; a changed byte, anywhere, must fail; a document re-signed with
// someone else's key must be recognisably someone else's; and the key pair must never be made inside a repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { glowSalon } from "../src/harness.ts";
import { canonicalJson } from "../src/record.ts";
import { buildGoLiveCertificate } from "../report/certificate.ts";
import { digestOf, sha256, verificationCode } from "../report/digest.ts";
import { PRIVATE_KEY_FILE, PUBLIC_KEY_FILE, assertOutsideRepository, generateKeyFiles, gitRootOf } from "../report/keys.ts";
import { envelopeFile, keyIdOf, loadPrivateKey, publicKeyHex, seal, trustedKeyId, verifyEnvelopeText } from "../report/sign.ts";
import type { Envelope } from "../report/sign.ts";

const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));
const SCRIPTS = fileURLToPath(new URL("../scripts/", import.meta.url));
const scratch = () => mkdtempSync(join(tmpdir(), "geometer-report-test-"));
const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });

// a small, real document: the go-live certificate for Glow Salon (no hand-check run needed: the counts are passed in)
const smallDocument = () => buildGoLiveCertificate({ settings: glowSalon(), handCheck: { held: 33, total: 33, checks: 196, failedTitles: [] }, issuedAt: Date.parse("2027-02-04T10:30:00+05:30"), preparedBy: "Divya, local partner" });

test("a signed file round-trips, and says only what a signature shows", () => {
  const keys = generateKeyFiles(join(scratch(), "keys"));
  const key = loadPrivateKey(keys.privateKeyPath);
  const text = envelopeFile(seal(smallDocument(), key));
  const v = verifyEnvelopeText(text);
  assert.equal(v.unchanged, true);
  assert.equal(v.signed, true);
  assert.equal(v.trusted, false, "no trusted key was named");
  assert.equal(v.keyId, keys.keyId);
  assert.ok(v.checks.every((c) => c.ok) && v.checks.length >= 6);
  assert.ok(v.summary.includes("does not show who holds that key") && v.summary.includes("does not show the numbers are true"));
  assert.ok(v.notChecked.some((n) => n.includes("numbers are true")) && v.notChecked.some((n) => n.includes("proves nothing about who it belongs to")) && v.notChecked.some((n) => n.includes("ledger")));
  // naming the key as trusted, three ways
  for (const spec of [keys.publicKeyPath, keys.publicKey, keys.keyId]) {
    const t = verifyEnvelopeText(text, [trustedKeyId(spec)]);
    assert.equal(t.trusted, true, spec);
    assert.ok(t.summary.includes("a key you trust") && t.summary.includes("does not show the numbers are true"));
  }
  const other = generateKeyPairSync("ed25519").privateKey;
  const wrong = verifyEnvelopeText(text, [keyIdOf(publicKeyHex(other))]);
  assert.equal(wrong.unchanged, true);
  assert.equal(wrong.trusted, false);
  assert.ok(wrong.summary.includes("not a key you named"));
});

test("the file is the canonical JSON of the whole envelope and one newline; the signature covers a prefix and the canonical document", () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const env = seal(smallDocument(), key);
  const text = envelopeFile(env);
  assert.equal(text, `${canonicalJson(env)}\n`);
  assert.ok(!text.includes(" \"") && !text.slice(0, -1).includes("\n"));
  assert.equal(env.digest, sha256(canonicalJson(env.document)));
  assert.equal(env.code, verificationCode(env.digest));
  assert.match(env.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(env.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(env.signature!.keyId, keyIdOf(env.signature!.publicKey));
  assert.match(env.signature!.value, /^[0-9a-f]{128}$/);
  // the signature is Ed25519 over "geo-document/1\n" + the canonical document: check it independently with node:crypto
  assert.equal(verify(null, Buffer.from(`geo-document/1\n${canonicalJson(env.document)}`), createPublicKey(key), Buffer.from(env.signature!.value, "hex")), true);
  assert.equal(verify(null, Buffer.from(canonicalJson(env.document)), createPublicKey(key), Buffer.from(env.signature!.value, "hex")), false, "the prefix is part of what is signed");
  // the same document always has the same digest, whatever order its keys were built in
  assert.equal(digestOf({ b: 1, a: [2, { d: 1, c: 2 }] }), digestOf({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(seal(smallDocument()).digest, seal(smallDocument()).digest);
});

test("a changed byte anywhere in a signed file fails, and so does a missing, added or reordered one", () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const bytes = Buffer.from(envelopeFile(seal(smallDocument(), key)), "utf8");
  assert.ok(bytes.length > 2000);
  const attempts: [string, Buffer][] = [];
  for (let i = 0; i < bytes.length; i++) {
    const flipped = Buffer.from(bytes);
    flipped[i] ^= 0x01;
    attempts.push([`flip bit 0 of byte ${i}`, flipped]);
    const flipped2 = Buffer.from(bytes);
    flipped2[i] ^= 0x20;
    attempts.push([`flip bit 5 of byte ${i}`, flipped2]);
  }
  for (const at of [0, 1, 17, 500, bytes.length - 1, bytes.length]) {
    if (at < bytes.length) attempts.push([`delete byte ${at}`, Buffer.concat([bytes.subarray(0, at), bytes.subarray(at + 1)])]);
    attempts.push([`insert a space at ${at}`, Buffer.concat([bytes.subarray(0, at), Buffer.from(" "), bytes.subarray(at)])]);
  }
  attempts.push(["empty", Buffer.alloc(0)], ["no newline at the end", bytes.subarray(0, -1)], ["two newlines at the end", Buffer.concat([bytes, Buffer.from("\n")])], ["CRLF at the end", Buffer.concat([bytes.subarray(0, -1), Buffer.from("\r\n")])]);
  let passed = 0;
  for (const [what, b] of attempts) {
    const v = verifyEnvelopeText(b.toString("utf8"));
    if (v.unchanged) { passed++; assert.fail(`${what} was accepted`); }
  }
  assert.equal(passed, 0);
  assert.ok(attempts.length > 4000, `${attempts.length} different edits tried`);
  assert.equal(verifyEnvelopeText(bytes.toString("utf8")).unchanged, true, "and the untouched file is accepted");
});

test("a file that says the same thing in other spelling is refused: pretty-printed, keys reordered, escaped characters", () => {
  const env = seal(smallDocument(), generateKeyPairSync("ed25519").privateKey);
  const canonical = envelopeFile(env);
  assert.equal(verifyEnvelopeText(canonical).unchanged, true);
  assert.equal(verifyEnvelopeText(`${JSON.stringify(env, null, 2)}\n`).unchanged, false);
  assert.equal(verifyEnvelopeText(`${JSON.stringify(env)}\n`).unchanged, false, "JSON.stringify keeps the keys in the order they were built, not sorted");
  assert.equal(verifyEnvelopeText(canonical.replace("Glow Salon", "Glow\\u0020Salon")).unchanged, false);
  assert.equal(verifyEnvelopeText(canonical.replace("{", "{ ")).unchanged, false);
  const v = verifyEnvelopeText(`${JSON.stringify(env, null, 2)}\n`);
  assert.ok(v.checks.some((c) => c.name.includes("canonical form") && !c.ok));
});

test("every field is bound: a wrong digest, code, key id, public key or signature is refused, each on its own", () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const env = seal(smallDocument(), key) as Envelope<ReturnType<typeof smallDocument>>;
  const file = (e: unknown) => `${canonicalJson(e)}\n`;
  const other = seal(smallDocument(), generateKeyPairSync("ed25519").privateKey);
  const cases: [string, unknown][] = [
    ["digest of another document", { ...env, digest: other.digest.replace(/.$/, "0") }],
    ["code of another document", { ...env, code: "0000-0000" }],
    ["document changed, digest and signature kept", { ...env, document: { ...env.document, preparedBy: "Someone else" } }],
    ["document and digest changed, signature kept", (() => { const d = { ...env.document, preparedBy: "Someone else" }; const e = seal(d); return { ...env, document: d, digest: e.digest, code: e.code }; })()],
    ["key id of another key", { ...env, signature: { ...env.signature!, keyId: other.signature!.keyId } }],
    ["public key of another key", { ...env, signature: { ...env.signature!, publicKey: other.signature!.publicKey } }],
    ["signature of another document", { ...env, signature: { ...env.signature!, value: other.signature!.value } }],
    ["an extra field", { ...env, note: "hello" }],
    ["a missing field", (({ code: _code, ...rest }) => rest)(env)],
    ["another format name", { ...env, format: "geometer-document/2" }],
    ["the signature taken out of a signed file but the document changed", { ...env, document: { ...env.document, preparedBy: "x" }, signature: null }],
  ];
  for (const [what, e] of cases) assert.equal(verifyEnvelopeText(file(e)).unchanged, false, what);
});

test("anyone can sign a changed document with their own key: it passes as unchanged, and is recognised as not yours", () => {
  const mine = generateKeyFiles(join(scratch(), "mine"));
  const theirs = generateKeyPairSync("ed25519").privateKey;
  const forged = seal({ ...smallDocument(), preparedBy: "Not Divya" }, theirs);
  const text = envelopeFile(forged);
  const alone = verifyEnvelopeText(text);
  assert.equal(alone.unchanged, true, "a file is only ever checked against itself");
  assert.equal(alone.trusted, false);
  assert.ok(alone.notChecked.some((n) => n.includes("anyone can change a document and sign it again with their own key")));
  const named = verifyEnvelopeText(text, [mine.keyId]);
  assert.equal(named.trusted, false);
  assert.ok(named.checks.some((c) => c.name === "Signed by a key you trust" && !c.ok));
});

test("an unsigned file can only be checked against its digest, and says so", () => {
  const v = verifyEnvelopeText(envelopeFile(seal(smallDocument())));
  assert.equal(v.unchanged, true);
  assert.equal(v.signed, false);
  assert.ok(v.summary.includes("not signed") && v.notChecked.some((n) => n.includes("Who issued it")));
  const withTrust = verifyEnvelopeText(envelopeFile(seal(smallDocument())), ["key:" + "0".repeat(64)]);
  assert.equal(withTrust.trusted, false);
});

test("a key file other people can read is refused; the key is read from the path the caller gives", () => {
  const dir = scratch();
  const keys = generateKeyFiles(join(dir, "k"));
  assert.ok(loadPrivateKey(keys.privateKeyPath));
  chmodSync(keys.privateKeyPath, 0o644);
  assert.throws(() => loadPrivateKey(keys.privateKeyPath), /can be read by other people.*chmod 600/);
  assert.throws(() => loadPrivateKey(join(dir, "nope.pem")), /no key file at/);
  const rsa = join(dir, "rsa.pem");
  writeFileSync(rsa, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  assert.throws(() => loadPrivateKey(rsa), /not an Ed25519 key/);
  assert.throws(() => trustedKeyId("not a key"), /not a public key file/);
});

test("the key pair is made outside any repository, with the private half readable only by its owner, and never overwritten", () => {
  const dir = scratch();
  const keys = generateKeyFiles(join(dir, "geometer-keys"));
  assert.equal(statSync(keys.privateKeyPath).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "geometer-keys")).mode & 0o077, 0, "the folder is private too");
  assert.deepEqual(readdirSync(join(dir, "geometer-keys")).sort(), [PRIVATE_KEY_FILE, PUBLIC_KEY_FILE]);
  assert.match(readFileSync(keys.privateKeyPath, "utf8"), /BEGIN PRIVATE KEY/);
  assert.ok(!readFileSync(keys.publicKeyPath, "utf8").includes("PRIVATE"));
  assert.equal(keyIdOf(keys.publicKey), keys.keyId);
  assert.throws(() => generateKeyFiles(join(dir, "geometer-keys")), /already a key.*not overwritten/);
});

test("the key pair is refused inside a repository: this one, a worktree (whose .git is a file), a link into it, and a folder not made yet", () => {
  const dir = scratch();
  assert.throws(() => generateKeyFiles(join(REPOSITORY, "pathways", "bookings", "keys")), /inside the git repository/);
  assert.throws(() => generateKeyFiles(join(REPOSITORY, "a", "b", "c", "does-not-exist-yet")), /inside the git repository|inside/);
  assert.throws(() => generateKeyFiles(REPOSITORY), /inside the git repository/);
  assert.ok(!existsSync(join(REPOSITORY, "pathways", "bookings", "keys")));
  // a worktree: .git is a file
  const tree = join(dir, "worktree");
  mkdirSync(tree);
  writeFileSync(join(tree, ".git"), "gitdir: /somewhere/else/.git/worktrees/x\n");
  assert.equal(gitRootOf(join(tree, "deep", "er")), tree.startsWith("/var/") ? `/private${tree}` : tree);
  assert.throws(() => generateKeyFiles(join(tree, "keys")), /inside the git repository/);
  // a link from outside into a repository
  symlinkSync(join(REPOSITORY, "pathways"), join(dir, "link"));
  assert.throws(() => generateKeyFiles(join(dir, "link", "keys")), /inside the git repository/);
  assert.ok(!existsSync(join(REPOSITORY, "pathways", "keys")));
  // outside everything is fine
  assert.doesNotThrow(() => assertOutsideRepository(join(dir, "fresh", "folder")));
  assert.equal(gitRootOf(dir), null);
});

test("scripts/report-key.ts makes a key outside the repository and refuses one inside it", () => {
  const dir = scratch();
  const ok = run("report-key.ts", join(dir, "keys"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.includes("Key id") && ok.stdout.includes(PRIVATE_KEY_FILE) && existsSync(join(dir, "keys", PRIVATE_KEY_FILE)));
  const again = run("report-key.ts", join(dir, "keys"));
  assert.equal(again.status, 1);
  assert.ok(again.stderr.includes("not overwritten"));
  const inside = run("report-key.ts", join(REPOSITORY, "pathways", "bookings", "keys-test"));
  assert.equal(inside.status, 1);
  assert.ok(inside.stderr.includes("inside the git repository") && !existsSync(join(REPOSITORY, "pathways", "bookings", "keys-test")));
  assert.equal(run("report-key.ts").status, 64);
});

test("scripts/verify-report.ts: 0 for a file you trust, 1 for a changed one or a key you did not name, 3 for an unsigned one, 64 for no file", () => {
  const dir = scratch();
  const keys = generateKeyFiles(join(dir, "keys"));
  const key = loadPrivateKey(keys.privateKeyPath);
  const signed = join(dir, "signed.json");
  const unsigned = join(dir, "unsigned.json");
  const tampered = join(dir, "tampered.json");
  writeFileSync(signed, envelopeFile(seal(smallDocument(), key)));
  writeFileSync(unsigned, envelopeFile(seal(smallDocument())));
  writeFileSync(tampered, readFileSync(signed, "utf8").replace("Divya", "Dxvya"));
  const alone = run("verify-report.ts", signed);
  assert.equal(alone.status, 0, alone.stdout);
  assert.ok(alone.stdout.includes("What was checked") && alone.stdout.includes("What was NOT checked") && alone.stdout.includes("numbers are true"));
  assert.equal(run("verify-report.ts", signed, "--trust-key", keys.publicKeyPath).status, 0);
  assert.equal(run("verify-report.ts", signed, "--trust-key", "key:" + "0".repeat(64)).status, 1);
  const bad = run("verify-report.ts", tampered, "--trust-key", keys.publicKeyPath);
  assert.equal(bad.status, 1);
  assert.ok(bad.stdout.includes("FAILED") && bad.stdout.includes("Do not rely on it"));
  assert.equal(run("verify-report.ts", unsigned).status, 3);
  assert.equal(run("verify-report.ts").status, 64);
  assert.equal(run("verify-report.ts", join(dir, "missing.json")).status, 64);
  assert.equal(run("verify-report.ts", signed, "--trust-key", "nonsense").status, 64);
});
