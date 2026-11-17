// "Limits, tightened by a tap" needs to tell a session made with a PASSKEY from one made by a link on WhatsApp (owner-access.ts checkPasskey): the owner's limits page lets
// only the first change a limit. This uses the real store with a software passkey, as passkeys.test.ts does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOwnerAccess } from "../owner-access.ts";
import { SETUP_MS, newSetupToken, setupHash } from "../owner-grants.ts";
import type { OwnerGrants } from "../owner-grants.ts";
import { relyingParty } from "../webauthn.ts";
import { newSoftPasskey, softRegister, softSignin } from "./soft-authenticator.ts";

const T0 = Date.parse("2026-11-17T10:00:00Z");
const BASE = "https://pages.example/glow/owner";
const RP = relyingParty(BASE);
const OWNER = { owner: "+919800000001", base: BASE };

test("a session made by a link is good but is not a passkey session; one made by a passkey (the first registration, or a later sign-in) is both", () => {
  const dir = mkdtempSync(join(tmpdir(), "passkey-session-"));
  const access = openOwnerAccess(join(dir, "owner-access.sqlite"));
  try {
    const link = access.issue({ ...OWNER, via: "whatsapp", now: T0 });
    const byLink = access.consume(link.token, OWNER, T0 + 1000);
    assert.ok(byLink.ok);
    if (!byLink.ok) return;
    assert.ok(access.check(byLink.session, OWNER, T0 + 2000), "the link's session is good");
    assert.equal(access.checkPasskey(byLink.session, OWNER, T0 + 2000), undefined, "but it is not a passkey session");

    const token = newSetupToken();
    const file: OwnerGrants = { schema: 1, setup: { sha256: setupHash(token), createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + SETUP_MS).toISOString() } };
    const grant = { kind: "setup" as const, token };
    const opts = access.registrationOptions(grant, file, OWNER, RP, "Glow", T0);
    assert.ok(opts.ok);
    if (!opts.ok) return;
    const phone = newSoftPasskey(RP.rpId);
    const registered = access.register(grant, file, OWNER, RP, softRegister(phone, opts.options as never, RP.origin), T0 + 3000);
    assert.ok(registered.ok);
    if (!registered.ok) return;
    assert.ok(access.checkPasskey(registered.session, OWNER, T0 + 4000), "the session the registration made is a passkey session");

    const signin = access.signinOptions(OWNER, RP, T0 + 5000);
    assert.ok(signin.options);
    const again = access.signin(softSignin(phone, signin.options as never, RP.origin), OWNER, RP, T0 + 6000);
    assert.ok(again.ok);
    if (!again.ok) return;
    assert.ok(access.checkPasskey(again.session, OWNER, T0 + 7000), "and so is a later passkey sign-in");
    assert.equal(access.checkPasskey("x".repeat(43), OWNER, T0 + 7000), undefined, "a token nobody has is neither");
    assert.equal(access.checkPasskey(registered.session, { ...OWNER, owner: "+919800000002" }, T0 + 7000), undefined, "another owner's number is refused");
  } finally { access.close(); rmSync(dir, { recursive: true, force: true }); }
});
