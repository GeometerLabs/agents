// The owner's passkeys (plan item 11h, decisions 45 and 46): the checks of webauthn.ts on a real Chromium authenticator's answers and on a software one's, and
// the runtime's store (owner-access.ts) with the partner's setup QR and recovery card (owner-grants.ts): one use, that shop only, the expiry, a cancelled prompt
// that does not burn the QR, another shop's passkey on the same pages domain refused, a replayed answer refused, the counter, recovery, and "remove the passkeys".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOwnerAccess } from "../owner-access.ts";
import type { RelyingParty } from "../owner-access.ts";
import { RECOVERY_CODE, SETUP_MS, grantInFile, newRecoveryCode, newSetupToken, normalCode, printedCode, readOwnerGrants, recoveryHash, setupHash } from "../owner-grants.ts";
import type { OwnerGrants } from "../owner-grants.ts";
import { PasskeyError, readCbor, relyingParty, verifyAssertion, verifyRegistration } from "../webauthn.ts";
import { newSoftPasskey, softRegister, softSignin } from "./soft-authenticator.ts";

const T0 = Date.parse("2026-11-14T10:00:00Z");
const BASE = "https://pages.example/glow/owner";
const RP: RelyingParty = relyingParty(BASE);
const OWNER = { owner: "+919800000001", base: BASE };

function store() {
  const dir = mkdtempSync(join(tmpdir(), "passkeys-"));
  const access = openOwnerAccess(join(dir, "owner-access.sqlite"));
  return { access, done: () => { access.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function grants(o: { token?: string; codes?: string[]; at?: number; passkeysBefore?: number } = {}): OwnerGrants {
  const at = o.at ?? T0;
  return {
    schema: 1,
    ...(o.token ? { setup: { sha256: setupHash(o.token), createdAt: new Date(at).toISOString(), expiresAt: new Date(at + SETUP_MS).toISOString() } } : {}),
    ...(o.codes ? { recovery: { codes: o.codes.map(recoveryHash), createdAt: new Date(at).toISOString() } } : {}),
    ...(o.passkeysBefore !== undefined ? { passkeysBefore: new Date(o.passkeysBefore).toISOString() } : {}),
  };
}

// ---- webauthn.ts --------------------------------------------------------------------------------------------------------------------------------------------

const FIXTURE = join(import.meta.dirname, "fixtures", "passkey-chromium.json");
test("a real browser's passkey (Chromium's authenticator): its registration and its sign-in verify; any other origin, challenge or RP ID is refused", { skip: existsSync(FIXTURE) ? false : "no fixture captured" }, () => {
  const f = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const u = (s: string) => Buffer.from(s, "base64url");
  const reg = { clientDataJSON: u(f.registration.clientDataJSON), attestationObject: u(f.registration.attestationObject) };
  const cred = verifyRegistration(reg, { challenge: f.registrationChallenge, origin: f.origin, rpId: f.rpId });
  assert.equal(cred.id, f.registration.id);
  assert.equal(f.assertion.userHandle, f.userId, "the browser returns the user id the shop gave");
  const signin = { clientDataJSON: u(f.assertion.clientDataJSON), authenticatorData: u(f.assertion.authenticatorData), signature: u(f.assertion.signature) };
  const after = verifyAssertion(signin, cred, { challenge: f.signinChallenge, origin: f.origin, rpId: f.rpId });
  assert.ok(after.signCount >= 0);
  assert.throws(() => verifyRegistration(reg, { challenge: f.registrationChallenge, origin: "https://evil.example", rpId: f.rpId }), PasskeyError);
  assert.throws(() => verifyAssertion(signin, cred, { challenge: f.registrationChallenge, origin: f.origin, rpId: f.rpId }), PasskeyError, "another challenge");
  assert.throws(() => verifyAssertion(signin, cred, { challenge: f.signinChallenge, origin: f.origin, rpId: "other.example" }), PasskeyError, "another RP ID");
  assert.throws(() => verifyAssertion(signin, { ...cred, signCount: after.signCount + 1 }, { challenge: f.signinChallenge, origin: f.origin, rpId: f.rpId }), /counter/u);
});

test("webauthn.ts: ES256 and Ed25519; the wrong ceremony, a phone that did not check the fingerprint, a tampered signature and a counter that went back are refused; 0 after 0 is accepted", () => {
  for (const alg of [-7, -8] as const) {
    const p = newSoftPasskey(RP.rpId, { alg });
    const challenge = "c".repeat(43);
    const reg = softRegister(p, { challenge }, RP.origin);
    const u = (s: string) => Buffer.from(s, "base64url");
    const cred = verifyRegistration({ clientDataJSON: u(reg.clientDataJSON), attestationObject: u(reg.attestationObject) }, { challenge, ...RP });
    assert.equal(cred.alg, alg);
    const a = softSignin(p, { challenge }, RP.origin);
    const args = { clientDataJSON: u(a.clientDataJSON), authenticatorData: u(a.authenticatorData), signature: u(a.signature) };
    assert.deepEqual(verifyAssertion(args, cred, { challenge, ...RP }), { signCount: 1 });
    const bad = Buffer.from(args.signature); bad[bad.length - 1] ^= 1;
    assert.throws(() => verifyAssertion({ ...args, signature: bad }, cred, { challenge, ...RP }), /signature/u);
    assert.throws(() => verifyAssertion(args, { ...cred, signCount: 1 }, { challenge, ...RP }), /counter/u, "the same counter again: a copy");
    const create = softSignin(p, { challenge }, RP.origin, { type: "webauthn.create" });
    assert.throws(() => verifyAssertion({ clientDataJSON: u(create.clientDataJSON), authenticatorData: u(create.authenticatorData), signature: u(create.signature) }, cred, { challenge, ...RP }), /webauthn.get/u);
    const noUv = softSignin(p, { challenge }, RP.origin, { flags: 0x01 });
    assert.throws(() => verifyAssertion({ clientDataJSON: u(noUv.clientDataJSON), authenticatorData: u(noUv.authenticatorData), signature: u(noUv.signature) }, cred, { challenge, ...RP }), /fingerprint/u);
  }
  // a synced passkey that always says 0
  const synced = newSoftPasskey(RP.rpId);
  const u = (s: string) => Buffer.from(s, "base64url");
  const reg = softRegister(synced, { challenge: "d".repeat(43) }, RP.origin);
  const cred = verifyRegistration({ clientDataJSON: u(reg.clientDataJSON), attestationObject: u(reg.attestationObject) }, { challenge: "d".repeat(43), ...RP });
  const a = softSignin(synced, { challenge: "e".repeat(43) }, RP.origin, { still: true });
  assert.deepEqual(verifyAssertion({ clientDataJSON: u(a.clientDataJSON), authenticatorData: u(a.authenticatorData), signature: u(a.signature) }, cred, { challenge: "e".repeat(43), ...RP }), { signCount: 0 });
  // CBOR: definite lengths only, nothing left over, keys once
  assert.throws(() => readCbor(Buffer.from([0x5f])), /indefinite/u);
  assert.throws(() => readCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02])), /twice/u);
});

// ---- the setup QR and the recovery card (owner-grants.ts) ---------------------------------------------------------------------------------------------

test("the setup QR and the recovery card: hashes only in the file, a setup QR runs out, a code reads however it is typed, a broken file grants nothing", () => {
  const token = newSetupToken(); const code = newRecoveryCode();
  assert.match(code, RECOVERY_CODE);
  const file = readOwnerGrants(JSON.stringify(grants({ token, codes: [code] })))!;
  assert.ok(!JSON.stringify(file).includes(token) && !JSON.stringify(file).includes(code), "only hashes");
  assert.equal(grantInFile({ kind: "setup", token }, file, T0 + SETUP_MS - 1), "valid");
  assert.equal(grantInFile({ kind: "setup", token }, file, T0 + SETUP_MS), "expired");
  assert.equal(grantInFile({ kind: "setup", token: newSetupToken() }, file, T0), "unknown", "another QR (or this one replaced)");
  assert.equal(grantInFile({ kind: "recovery", code: printedCode(code).toLowerCase().replace("-", " - ") }, file, T0), "valid");
  assert.equal(normalCode(" ab-cd "), "ABCD");
  assert.equal(grantInFile({ kind: "recovery", code: newRecoveryCode() }, file, T0), "unknown");
  assert.equal(readOwnerGrants("{nope"), undefined);
  assert.deepEqual(readOwnerGrants(JSON.stringify({ schema: 1, setup: { sha256: "x", createdAt: "now", expiresAt: "later" }, recovery: { codes: ["zz"] } })), { schema: 1 });
});

// ---- the runtime's store ------------------------------------------------------------------------------------------------------------------------------

test("registration from the partner's QR: the QR is used up only when the passkey is kept, once; a cancelled prompt does not burn it; then a session", () => {
  const { access, done } = store(); try {
    const token = newSetupToken(); const file = grants({ token }); const g = { kind: "setup" as const, token };
    const first = access.registrationOptions(g, file, OWNER, RP, "Glow", T0);
    assert.ok(first.ok);
    const o1 = first.options as { challenge: string; user: { id: string }; rp: { id: string }; authenticatorSelection: { userVerification: string } };
    assert.equal(o1.rp.id, "pages.example"); assert.equal(o1.authenticatorSelection.userVerification, "required");
    // the owner cancels the fingerprint prompt: nothing comes back, and the QR still works
    assert.equal(access.grantState(g, file, T0 + 1000), "valid");
    const again = access.registrationOptions(g, file, OWNER, RP, "Glow", T0 + 2000);
    assert.ok(again.ok);
    const o2 = again.options as typeof o1;
    assert.equal(o2.user.id, o1.user.id, "one user id for this shop");
    const phone = newSoftPasskey(RP.rpId);
    const done1 = access.register(g, file, OWNER, RP, softRegister(phone, o2, RP.origin), T0 + 3000);
    assert.ok(done1.ok, JSON.stringify(done1));
    assert.ok(access.check(done1.session, OWNER, T0 + 4000), "a session for this browser");
    assert.equal(access.grantState(g, file, T0 + 4000), "used");
    // the same QR again, from another phone: used
    assert.deepEqual(access.registrationOptions(g, file, OWNER, RP, "Glow", T0 + 5000), { ok: false, state: "used" });
    // the earlier challenge, answered late by a second phone: refused (the QR is used)
    assert.equal(access.register(g, file, OWNER, RP, softRegister(newSoftPasskey(RP.rpId), o1, RP.origin), T0 + 6000).ok, false);
    assert.equal(access.passkeys(OWNER, RP).length, 1);
  } finally { done(); }
});

test("the QR is this shop's only and runs out: another shop's QR, an expired one and a replaced one register nothing; an answer for another challenge or origin is refused", () => {
  const { access, done } = store(); try {
    const token = newSetupToken(); const file = grants({ token });
    const other = { kind: "setup" as const, token: newSetupToken() }; // the QR the partner made for another shop: that shop's file names it, this one does not
    assert.deepEqual(access.registrationOptions(other, file, OWNER, RP, "Glow", T0), { ok: false, state: "unknown" });
    assert.deepEqual(access.registrationOptions({ kind: "setup", token }, file, OWNER, RP, "Glow", T0 + SETUP_MS), { ok: false, state: "expired" });
    const newer = grants({ token: newSetupToken(), at: T0 + 60_000 });
    assert.deepEqual(access.registrationOptions({ kind: "setup", token }, newer, OWNER, RP, "Glow", T0 + 61_000), { ok: false, state: "unknown" }, "a fresh QR replaces the old");
    const g = { kind: "setup" as const, token };
    const r = access.registrationOptions(g, file, OWNER, RP, "Glow", T0); assert.ok(r.ok);
    const opts = r.options as { challenge: string; user: { id: string } };
    const phone = newSoftPasskey(RP.rpId);
    assert.equal(access.register(g, file, OWNER, RP, softRegister(phone, opts, "https://evil.example"), T0 + 1).ok, false, "another origin");
    assert.equal(access.register(g, file, OWNER, RP, softRegister(phone, { ...opts, challenge: "x".repeat(43) }, RP.origin), T0 + 1).ok, false, "a challenge never made");
    assert.equal(access.register(g, file, OWNER, RP, softRegister(phone, opts, RP.origin, { rpId: "evil.example" }), T0 + 1).ok, false, "a passkey for another site");
    assert.equal(access.register(g, file, OWNER, RP, softRegister(phone, opts, RP.origin, { flags: 0x01 }), T0 + 1).ok, false, "no fingerprint or screen lock");
    assert.equal(access.register(g, file, OWNER, RP, softRegister(phone, opts, RP.origin), T0 + 6 * 60_000).ok, false, "the challenge ran out");
    assert.equal(access.grantState(g, file, T0 + 1), "valid", "none of these used the QR up");
  } finally { done(); }
});

test("sign-in with the passkey: no WhatsApp, a session; a replayed answer, another shop's passkey on the same pages domain, a removed one and a new owner are refused", () => {
  const glow = store(); const veena = store(); try {
    const reg = (s: ReturnType<typeof store>, phone: ReturnType<typeof newSoftPasskey>, base = BASE) => {
      const token = newSetupToken(); const file = grants({ token }); const g = { kind: "setup" as const, token };
      const who = { ...OWNER, base };
      const o = s.access.registrationOptions(g, file, who, RP, "x", T0); assert.ok(o.ok);
      const r = s.access.register(g, file, who, RP, softRegister(phone, o.options as never, RP.origin), T0 + 1); assert.ok(r.ok, JSON.stringify(r));
    };
    const glowPhone = newSoftPasskey(RP.rpId); reg(glow, glowPhone);
    const veenaPhone = newSoftPasskey(RP.rpId); reg(veena, veenaPhone, "https://pages.example/veena/owner");

    const o = glow.access.signinOptions(OWNER, RP, T0 + 10_000);
    assert.equal(o.count, 1);
    const opts = o.options as { challenge: string; allowCredentials: { id: string }[]; rpId: string };
    assert.deepEqual(opts.allowCredentials.map((c) => c.id), [glowPhone.credId.toString("base64url")], "only this shop's passkey is offered");
    const answer = softSignin(glowPhone, opts, RP.origin);
    const ok = glow.access.signin(answer, OWNER, RP, T0 + 11_000);
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.ok(glow.access.check(ok.session, OWNER, T0 + 12_000));
    assert.equal(glow.access.signin(answer, OWNER, RP, T0 + 12_000).ok, false, "the same answer again: the challenge was used");

    // the other shop's passkey, on the same pages domain (same RP ID, same origin): unknown here, even with a challenge this shop made
    const o2 = glow.access.signinOptions(OWNER, RP, T0 + 20_000);
    const theirs = glow.access.signin(softSignin(veenaPhone, o2.options as never, RP.origin), OWNER, RP, T0 + 21_000);
    assert.deepEqual(theirs, { ok: false, why: "This passkey is not one of this shop's." });
    // this shop's passkey but the other shop's user handle (the phone mixed them up): refused
    const o3 = glow.access.signinOptions(OWNER, RP, T0 + 22_000);
    assert.equal(glow.access.signin(softSignin(glowPhone, o3.options as never, RP.origin, { userHandle: "A".repeat(22) }), OWNER, RP, T0 + 23_000).ok, false);

    // a counter that goes back (a copied key)
    const o4 = glow.access.signinOptions(OWNER, RP, T0 + 30_000);
    glowPhone.count -= 1;
    assert.match((glow.access.signin(softSignin(glowPhone, o4.options as never, RP.origin, { still: true }), OWNER, RP, T0 + 31_000) as { why: string }).why, /counter/u);

    // a new owner number in the settings: the old owner's passkey no longer signs in
    assert.equal(glow.access.signinOptions({ ...OWNER, owner: "+919800000002" }, RP, T0 + 40_000).count, 0);
    // the panel's "remove the owner's passkeys": made before it, not offered and not taken
    assert.equal(glow.access.signinOptions(OWNER, RP, T0 + 50_000, T0 + 45_000).count, 0);
    const o5 = glow.access.signinOptions(OWNER, RP, T0 + 50_000);
    assert.equal(glow.access.signin(softSignin(glowPhone, o5.options as never, RP.origin), OWNER, RP, T0 + 51_000, T0 + 45_000).ok, false);
  } finally { glow.done(); veena.done(); }
});

test("a lost phone: a code from the recovery card registers a new passkey once; the other codes stay; wrong codes are counted per shop", () => {
  const { access, done } = store(); try {
    const codes = [newRecoveryCode(), newRecoveryCode(), newRecoveryCode()];
    const file = grants({ codes });
    const g = { kind: "recovery" as const, code: printedCode(codes[1]) };
    const o = access.registrationOptions(g, file, OWNER, RP, "Glow", T0); assert.ok(o.ok);
    const r = access.register(g, file, OWNER, RP, softRegister(newSoftPasskey(RP.rpId), o.options as never, RP.origin), T0 + 1);
    assert.ok(r.ok);
    assert.equal(access.grantState({ kind: "recovery", code: codes[1] }, file, T0 + 2), "used", "however it is typed, that code is used");
    assert.equal(access.grantState({ kind: "recovery", code: codes[0] }, file, T0 + 2), "valid");
    assert.equal(access.grantState({ kind: "recovery", code: codes[0] }, grants({ codes: [newRecoveryCode()] }), T0 + 2), "unknown", "a new card replaces every old code");
    for (let i = 0; i < 20; i++) { assert.equal(access.codesLocked(T0 + 10 + i), false); access.noteWrongCode(T0 + 10 + i); }
    assert.equal(access.codesLocked(T0 + 100), true);
    assert.equal(access.codesLocked(T0 + 24 * 60 * 60_000 + 100), false, "a day later");
  } finally { done(); }
});

test("a flood of challenges keeps the store small and never locks the owner out: the oldest open ones go, the newest always works", () => {
  const { access, done } = store(); try {
    const token = newSetupToken(); const file = grants({ token }); const g = { kind: "setup" as const, token };
    const o = access.registrationOptions(g, file, OWNER, RP, "Glow", T0); assert.ok(o.ok);
    const phone = newSoftPasskey(RP.rpId);
    assert.ok(access.register(g, file, OWNER, RP, softRegister(phone, o.options as never, RP.origin), T0 + 1).ok);
    // three addresses ask for 1,000 challenges in a few minutes
    for (let i = 0; i < 1000; i++) access.signinOptions(OWNER, RP, T0 + 1000 + i);
    // the owner, now: a fresh challenge, answered at once
    const mine = access.signinOptions(OWNER, RP, T0 + 5000);
    assert.ok(mine.options, "the owner still gets a challenge");
    assert.ok(access.signin(softSignin(phone, mine.options as never, RP.origin), OWNER, RP, T0 + 5001).ok, "and signs in");
  } finally { done(); }
});
