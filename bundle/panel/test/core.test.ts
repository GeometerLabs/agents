// The panel's foundations: encryption at rest, accounts and invites, signed sessions and CSRF tokens, and the login rate limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createAccounts, hashPassphrase, passphraseProblem, verifyPassphrase } from "../accounts.ts";
import { createLimiter } from "../ratelimit.ts";
import { createSessions } from "../session.ts";
import { createStore } from "../store.ts";
import { VaultError, createVault, loadKeyFile, plainVault } from "../vault.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "geo-panel-core-"));
const KEY = randomBytes(32);
const filesIn = (dir: string): string[] => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));

// ---- encryption at rest -----------------------------------------------------------------------------------------------------------------

test("sealed text round-trips, is different every time, and is bound to the record's name", () => {
  const vault = createVault(KEY);
  const a = vault.seal("hello Divya", "accounts.json");
  assert.notEqual(a, vault.seal("hello Divya", "accounts.json"));
  assert.ok(a.startsWith("geo1.") && !a.includes("Divya"));
  assert.equal(vault.open(a, "accounts.json"), "hello Divya");
  assert.throws(() => vault.open(a, "invites.json"), /another record/u); // a file copied over another one does not open
});

test("a changed byte, a wrong key and a plain file are all refused with a sentence, never read as empty", () => {
  const vault = createVault(KEY);
  const sealed = vault.seal("secret-ish", "x.json");
  const flipped = sealed.slice(0, -3) + (sealed.endsWith("AAA") ? "BBB" : "AAA");
  assert.throws(() => vault.open(flipped, "x.json"), VaultError);
  assert.throws(() => createVault(randomBytes(32)).open(sealed, "x.json"), /data key is not the one/u);
  assert.throws(() => vault.open('{"accounts":[]}', "accounts.json"), /not encrypted/u); // a downgrade to plain JSON
  assert.throws(() => plainVault.open(sealed, "x.json"), /without its data key/u);
  assert.throws(() => vault.open("geo1.AAAA", "x.json"), /damaged/u);
  assert.throws(() => createVault(Buffer.alloc(16)), /32 bytes/u);
});

test("with a key, the panel's files hold no readable data; a tampered file is refused; without a key they are plain JSON", () => {
  const dir = tmp();
  const store = createStore(join(dir, "panel"), createVault(KEY));
  store.write("accounts.json", { schema: 1, accounts: [{ name: "Divya Marker", handle: "divya.marker" }] });
  store.write("drafts/d1.json", { phone: "+919800000001" });
  for (const f of filesIn(join(dir, "panel"))) {
    const bytes = readFileSync(f, "utf8");
    assert.ok(bytes.startsWith("geo1."), f);
    assert.ok(!/Divya|marker|9198000|accounts/u.test(bytes), `${f} shows plain text`);
    assert.equal(statSync(f).mode & 0o077, 0, "only the panel can read it");
  }
  assert.deepEqual(store.read<{ accounts: { name: string }[] }>("accounts.json")?.accounts[0].name, "Divya Marker");
  const file = join(dir, "panel", "accounts.json");
  const bytes = readFileSync(file, "utf8");
  writeFileSync(file, bytes.slice(0, 20) + (bytes[20] === "A" ? "B" : "A") + bytes.slice(21));
  assert.throws(() => store.read("accounts.json"), VaultError);
  const plain = createStore(join(dir, "plain"), plainVault);
  plain.write("accounts.json", { schema: 1, accounts: [] });
  assert.ok(readFileSync(join(dir, "plain", "accounts.json"), "utf8").includes('"accounts"'));
  assert.throws(() => plain.write("../escape.json", {}), /not a name/u);
  assert.throws(() => plain.read("Accounts.JSON"), /not a name/u);
});

test("the data key file: hex, base64 and raw all load; inside the data folder, readable by others, or the wrong size is refused", () => {
  const root = tmp();
  const data = join(root, "panel");
  mkdirSync(data);
  const put = (name: string, content: string | Buffer, mode = 0o600) => { const p = join(root, name); writeFileSync(p, content, { mode }); chmodSync(p, mode); return p; };
  assert.deepEqual(loadKeyFile(put("hex.key", `${KEY.toString("hex")}\n`), data), KEY);
  assert.deepEqual(loadKeyFile(put("b64.key", KEY.toString("base64")), data), KEY);
  assert.deepEqual(loadKeyFile(put("raw.key", KEY), data), KEY);
  const inside = join(data, "k.key");
  writeFileSync(inside, KEY.toString("hex"), { mode: 0o600 });
  assert.throws(() => loadKeyFile(inside, data), /inside the panel's data folder/u);
  assert.throws(() => loadKeyFile(put("open.key", KEY.toString("hex"), 0o644), data), /read by other users/u);
  assert.throws(() => loadKeyFile(put("short.key", "abcd"), data), /must hold 32 bytes/u);
  assert.throws(() => loadKeyFile(join(root, "missing.key"), data), /is not there/u);
});

// ---- accounts ----------------------------------------------------------------------------------------------------------------------------------

test("passphrases are hashed with scrypt and a salt of their own, and verified without leaking which part was wrong", async () => {
  const a = await hashPassphrase("correct horse battery");
  const b = await hashPassphrase("correct horse battery");
  assert.match(a, /^scrypt\$16384\$8\$1\$/u);
  assert.notEqual(a, b);
  assert.ok(!a.includes("correct"));
  assert.equal(await verifyPassphrase("correct horse battery", a), true);
  assert.equal(await verifyPassphrase("correct horse batterY", a), false);
  assert.equal(await verifyPassphrase("x", "not a hash"), false);
  assert.equal(passphraseProblem("short", "divya"), "short");
  assert.equal(passphraseProblem("divya.partner", "divya.partner"), "same-as-handle");
  assert.equal(passphraseProblem("a long enough passphrase", "divya"), undefined);
});

test("an account exists only through an invite link that works once; the role comes from the invite", async () => {
  let t = Date.parse("2026-11-03T10:00:00Z");
  const dir = join(tmp(), "p");
  const accounts = createAccounts(createStore(dir, createVault(KEY)), () => t);
  const { token } = accounts.createInvite({ role: "partner", note: "Divya, Kochi", createdBy: "owner" });
  assert.equal(accounts.inviteStatus(token), "ok");
  assert.equal(accounts.inviteStatus("made-up-token"), "unknown");
  for (const f of filesIn(dir)) assert.ok(!readFileSync(f, "utf8").includes(token), "the invite token is never kept, only its hash");
  const form = { handle: "Divya.K", name: "Divya", passphrase: "a long enough passphrase", language: "ml" };
  assert.deepEqual(await accounts.redeem("made-up-token", form), { ok: false, reason: "invite-unknown" });
  assert.deepEqual(await accounts.redeem(token, { ...form, handle: "x" }), { ok: false, reason: "handle-bad" });
  assert.deepEqual(await accounts.redeem(token, { ...form, passphrase: "short" }), { ok: false, reason: "short" });
  assert.deepEqual(await accounts.redeem(token, { ...form, language: "fr" }), { ok: false, reason: "language-bad" });
  const made = await accounts.redeem(token, form);
  assert.ok(made.ok && made.account.role === "partner" && made.account.handle === "divya.k" && made.account.language === "ml");
  assert.deepEqual(await accounts.redeem(token, { ...form, handle: "other.one" }), { ok: false, reason: "invite-used" });
  assert.equal(accounts.inviteStatus(token), "used");
  assert.equal(accounts.count(), 1);
  // a second invite for the same handle is refused, and an invite that ran out of time is refused
  const second = accounts.createInvite({ role: "builder", note: "", createdBy: "owner", ttlHours: 1 });
  assert.deepEqual(await accounts.redeem(second.token, form), { ok: false, reason: "handle-taken" });
  t += 2 * 3_600_000;
  assert.equal(accounts.inviteStatus(second.token), "expired");
  assert.deepEqual(await accounts.redeem(second.token, { ...form, handle: "late.one" }), { ok: false, reason: "invite-expired" });
});

test("two people redeeming one invite at once make one account", async () => {
  const accounts = createAccounts(createStore(join(tmp(), "p"), plainVault));
  const { token } = accounts.createInvite({ role: "builder", note: "", createdBy: "owner" });
  const results = await Promise.all([1, 2, 3].map((n) => accounts.redeem(token, { handle: `person.${n}`, name: `P${n}`, passphrase: "a long enough passphrase", language: "en" })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(accounts.count(), 1);
});

test("signing in: the right passphrase finds the account; a wrong one or an unknown handle finds nothing; signing out everywhere raises the version", async () => {
  const accounts = createAccounts(createStore(join(tmp(), "p"), plainVault));
  const { token } = accounts.createInvite({ role: "builder", note: "", createdBy: "owner" });
  const made = await accounts.redeem(token, { handle: "arjun", name: "Arjun", passphrase: "a long enough passphrase", language: "en" });
  assert.ok(made.ok);
  assert.equal((await accounts.authenticate("ARJUN", "a long enough passphrase"))?.id, made.ok ? made.account.id : "");
  assert.equal(await accounts.authenticate("arjun", "a long enough passphrasE"), undefined);
  assert.equal(await accounts.authenticate("nobody", "a long enough passphrase"), undefined);
  accounts.bumpSessions(made.ok ? made.account.id : "");
  assert.equal(accounts.byHandle("arjun")?.sessionVersion, 2);
});

// ---- sessions and CSRF -----------------------------------------------------------------------------------------------------------

test("a session cookie is signed, HttpOnly and SameSite=Strict (and Secure with the __Host- prefix over HTTPS); a changed or expired one is no session", () => {
  let now = 1_000_000;
  const secret = randomBytes(32);
  const https = createSessions(secret, { secure: true, now: () => now, maxAgeSeconds: 100 });
  const { setCookie, session } = https.issue("acc_1", 3);
  assert.match(setCookie, /^__Host-geo=v1\./u);
  for (const attr of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/", "Max-Age=100"]) assert.ok(setCookie.includes(attr), attr);
  assert.ok(!createSessions(secret, { secure: false }).issue("acc_1", 1).setCookie.includes("Secure"));
  const header = setCookie.split(";")[0];
  assert.deepEqual(https.read(header), session);
  assert.equal(https.read(header.slice(0, -2) + "xx"), undefined);
  const forged = header.replace(/v1\.[^.]+/u, `v1.${Buffer.from(JSON.stringify({ ...session, accountId: "acc_2" })).toString("base64url")}`);
  assert.equal(https.read(forged), undefined);
  assert.equal(createSessions(randomBytes(32), { secure: true, now: () => now }).read(header), undefined); // another server's key
  now += 101_000;
  assert.equal(https.read(header), undefined);
  assert.equal(https.read(undefined), undefined);
  assert.match(https.clear(), /Max-Age=0/u);
});

test("a form's token fits the session it was made for and no other; the sign-in form has its own anonymous token", () => {
  const sessions = createSessions(randomBytes(32), { secure: false });
  const a = sessions.issue("acc_1", 1).session;
  const b = sessions.issue("acc_1", 1).session;
  assert.equal(sessions.csrfOk(a, sessions.csrf(a)), true);
  assert.equal(sessions.csrfOk(a, sessions.csrf(b)), false);
  assert.equal(sessions.csrfOk(a, undefined), false);
  assert.equal(sessions.csrfOk(a, ""), false);
  const first = sessions.pre(undefined);
  assert.ok(first.setCookie);
  const cookie = first.setCookie!.split(";")[0];
  assert.equal(sessions.pre(cookie).token, first.token);
  assert.equal(sessions.preOk(cookie, first.token), true);
  assert.equal(sessions.preOk(cookie, "nope"), false);
  assert.equal(sessions.preOk(undefined, first.token), false);
  assert.equal(sessions.preOk(sessions.pre(undefined).setCookie!.split(";")[0], first.token), false); // another visitor's cookie
});

// ---- the login rate limit ----------------------------------------------------------------------------------------------------------

test("after the limit, even the right answer waits; the window slides; a success clears only its own key", () => {
  let now = 0;
  const limiter = createLimiter(3, 60_000, () => now);
  for (let i = 0; i < 3; i++) { assert.equal(limiter.blocked("k"), 0); limiter.fail("k"); now += 1000; }
  assert.ok(limiter.blocked("k") > 0, "three failures block the key");
  assert.equal(limiter.blocked("other"), 0);
  now += 56_000;
  assert.ok(limiter.blocked("k") > 0 && limiter.blocked("k") <= 3);
  now += 5000;
  assert.equal(limiter.blocked("k"), 0);
  limiter.fail("a"); limiter.fail("a"); limiter.fail("b");
  limiter.clear("a");
  assert.deepEqual([limiter.blocked("a"), limiter.blocked("b")], [0, 0]);
});
