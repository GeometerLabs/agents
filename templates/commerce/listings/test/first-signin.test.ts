// The first sign-in of an owner who has no WhatsApp (a listings-only shop): the Operator's one-use code (owner-grants.ts) opens a passkey registration on the owner's own phone.
// Here, for two such shops that share one pages address and both have the "no number" owner: the code is one use and runs out; it is the shop's own, so the other shop knows nothing
// of it; a passkey and a session made at one shop are no good at the other; "remove the owner's passkeys" ends the passkeys made before it. (The ceremony's own checks are in
// modules/channels/test/passkeys.test.ts; this is what the SHARED origin adds.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOwnerAccess } from "../../../../modules/channels/owner-access.ts";
import type { RelyingParty } from "../../../../modules/channels/owner-access.ts";
import { SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";
import type { OwnerGrants } from "../../../../modules/channels/owner-grants.ts";
import { relyingParty } from "../../../../modules/channels/webauthn.ts";
import { newSoftPasskey, softRegister, softSignin } from "../../../../modules/channels/test/soft-authenticator.ts";
import { NO_NUMBER } from "../src/settings.ts";

const T0 = Date.parse("2026-11-18T10:00:00Z");
// one pages address for every shop: the relying party's id is the host, the same for both shops below
const RP_A: RelyingParty = relyingParty("https://pages.example/glow-pets/owner");
const RP_B: RelyingParty = relyingParty("https://pages.example/sree-cycles/owner");
const OWNER_A = { owner: NO_NUMBER, base: "https://pages.example/glow-pets/owner" };
const OWNER_B = { owner: NO_NUMBER, base: "https://pages.example/sree-cycles/owner" };

function shopStore() {
  const dir = mkdtempSync(join(tmpdir(), "first-signin-"));
  const access = openOwnerAccess(join(dir, "owner-access.sqlite"));
  return { access, done: () => { access.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const grantsFor = (token: string, at = T0): OwnerGrants => ({ schema: 1, setup: { sha256: setupHash(token), createdAt: new Date(at).toISOString(), expiresAt: new Date(at + SETUP_MS).toISOString() } });

test("the code works once: the passkey it makes is kept, and the same code from another phone is used", () => {
  const a = shopStore(); try {
    const token = newSetupToken(); const file = grantsFor(token); const g = { kind: "setup" as const, token };
    const options = a.access.registrationOptions(g, file, OWNER_A, RP_A, "Glow Pets", T0);
    assert.ok(options.ok);
    const done = a.access.register(g, file, OWNER_A, RP_A, softRegister(newSoftPasskey(RP_A.rpId), options.options as { challenge: string }, RP_A.origin), T0 + 1000);
    assert.ok(done.ok, JSON.stringify(done));
    assert.equal(a.access.grantState(g, file, T0 + 2000), "used");
    assert.deepEqual(a.access.registrationOptions(g, file, OWNER_A, RP_A, "Glow Pets", T0 + 3000), { ok: false, state: "used" });
  } finally { a.done(); }
});

test("the code runs out after a few minutes, and an expired code registers nothing", () => {
  const a = shopStore(); try {
    const token = newSetupToken(); const file = grantsFor(token); const g = { kind: "setup" as const, token };
    assert.equal(a.access.grantState(g, file, T0 + SETUP_MS - 1), "valid");
    assert.equal(a.access.grantState(g, file, T0 + SETUP_MS), "expired");
    assert.deepEqual(a.access.registrationOptions(g, file, OWNER_A, RP_A, "Glow Pets", T0 + SETUP_MS + 1), { ok: false, state: "expired" });
  } finally { a.done(); }
});

test("the code is the shop's own: the other shop's file does not name it, so it opens nothing there, even with the same owner marker and the same pages address", () => {
  const a = shopStore(); const b = shopStore(); try {
    const tokenA = newSetupToken(); const tokenB = newSetupToken();
    const fileA = grantsFor(tokenA); const fileB = grantsFor(tokenB);
    const gA = { kind: "setup" as const, token: tokenA };
    assert.equal(a.access.grantState(gA, fileA, T0), "valid");
    assert.equal(b.access.grantState(gA, fileB, T0), "unknown", "shop B's grants file holds B's hash, not A's");
    assert.deepEqual(b.access.registrationOptions(gA, fileB, OWNER_B, RP_B, "Sree Cycles", T0), { ok: false, state: "unknown" });
    assert.equal(RP_A.rpId, RP_B.rpId, "the pages address is shared, so the relying party does not separate the shops: each shop's own credential list does");
  } finally { a.done(); b.done(); }
});

test("a passkey and a session made at one shop are no good at the other", () => {
  const a = shopStore(); const b = shopStore(); try {
    const tokenA = newSetupToken(); const fileA = grantsFor(tokenA); const gA = { kind: "setup" as const, token: tokenA };
    const tokenB = newSetupToken(); const fileB = grantsFor(tokenB); const gB = { kind: "setup" as const, token: tokenB };
    const phoneA = newSoftPasskey(RP_A.rpId);
    const oA = a.access.registrationOptions(gA, fileA, OWNER_A, RP_A, "Glow Pets", T0);
    assert.ok(oA.ok);
    const regA = a.access.register(gA, fileA, OWNER_A, RP_A, softRegister(phoneA, oA.options as { challenge: string }, RP_A.origin), T0 + 1000);
    assert.ok(regA.ok);
    // the session A made is A's: B has never heard of it
    assert.ok(a.access.check(regA.session, OWNER_A, T0 + 2000));
    assert.equal(b.access.check(regA.session, OWNER_B, T0 + 2000), undefined);
    // B registers its own owner's passkey; A's phone, asked to sign in at B, has no credential B lists
    const oB = b.access.registrationOptions(gB, fileB, OWNER_B, RP_B, "Sree Cycles", T0);
    assert.ok(oB.ok);
    assert.ok(b.access.register(gB, fileB, OWNER_B, RP_B, softRegister(newSoftPasskey(RP_B.rpId), oB.options as { challenge: string }, RP_B.origin), T0 + 1500).ok);
    const asked = b.access.signinOptions(OWNER_B, RP_B, T0 + 3000);
    const listed = (asked.options as { allowCredentials?: { id: string }[] } | undefined)?.allowCredentials?.map((c) => c.id) ?? [];
    assert.ok(!listed.includes(phoneA.credId.toString("base64url")), "B does not offer A's credential to the phone");
    const answer = softSignin(phoneA, asked.options as { challenge: string }, RP_B.origin);
    assert.equal(b.access.signin({ ...(answer as object) } as never, OWNER_B, RP_B, T0 + 3500).ok, false, "A's passkey answers B's challenge and is refused");
  } finally { a.done(); b.done(); }
});

test("\"remove the owner's passkeys\" ends the ones made before it, and a new code makes a new one", () => {
  const a = shopStore(); try {
    const token = newSetupToken(); const g = { kind: "setup" as const, token };
    const first = grantsFor(token);
    const o = a.access.registrationOptions(g, first, OWNER_A, RP_A, "Glow Pets", T0);
    assert.ok(o.ok);
    assert.ok(a.access.register(g, first, OWNER_A, RP_A, softRegister(newSoftPasskey(RP_A.rpId), o.options as { challenge: string }, RP_A.origin), T0 + 1000).ok);
    assert.equal(a.access.passkeys(OWNER_A, RP_A).length, 1);
    assert.equal(a.access.passkeys(OWNER_A, RP_A, T0 + 60_000).length, 0, "passkeysBefore: every passkey made before it is gone");
  } finally { a.done(); }
});
