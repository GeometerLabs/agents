// A restore must not weaken the lock (re-review item A of "no Operator holds a shop hostage"): the snapshot carries every meta value the gate rests on, and a locked shop
// that somehow has no bound owner binds to the owner of its existing passkeys, never to the number the settings say today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { OWNER_ACCESS_FILE, openOwnerAccess } from "../../modules/channels/owner-access.ts";
import { newSetupToken, setupHash } from "../../modules/channels/owner-grants.ts";
import { relyingParty } from "../../modules/channels/webauthn.ts";
import { newSoftPasskey, softRegister } from "../../modules/channels/test/soft-authenticator.ts";
import { putOwnerKeep, readOwnerKeep } from "../backup/owner-keep.ts";

const BASE = "https://pages.example/glow/owner", RP = relyingParty(BASE);
const OWNER = { owner: "+919800000001", base: BASE }, OPERATOR = { owner: "+919811111111", base: BASE };
const T0 = Date.parse("2026-11-19T04:00:00Z");
const iso = (t: number) => new Date(t).toISOString();

function lockedShop(dir: string) {
  const a = openOwnerAccess(join(dir, OWNER_ACCESS_FILE));
  const q = newSetupToken();
  const f = { schema: 1 as const, setup: { sha256: setupHash(q), createdAt: iso(T0), expiresAt: iso(T0 + 9e5) } };
  a.sync(f, T0);
  const o = a.registrationOptions({ kind: "setup", token: q }, f, OWNER, RP, "Glow", T0 + 1000);
  assert.ok(o.ok);
  assert.ok(a.register({ kind: "setup", token: q }, f, OWNER, RP, softRegister(newSoftPasskey(RP.rpId), o.options as never, RP.origin), T0 + 1001, "Android, Chrome").ok);
  return { a, f };
}

test("a restore into an empty data folder keeps the owner binding: the Operator's changed number gives the owner their phones and a request, not zero phones", () => {
  const d1 = mkdtempSync(join(tmpdir(), "restore-a-")); const d2 = mkdtempSync(join(tmpdir(), "restore-b-"));
  try {
    const { a, f } = lockedShop(d1);
    a.sync(f, T0 + 2000); a.close();
    const keep = readOwnerKeep(d1)!;
    assert.ok(keep.ownerAccess.meta.some((m) => m.name === "bound_owner"), "the binding is in the snapshot");
    putOwnerKeep(d2, keep);
    const b = openOwnerAccess(join(d2, OWNER_ACCESS_FILE));
    b.sync(f, T0 + 10_000); b.watchOwner(OPERATOR, T0 + 10_000);
    assert.equal(b.signinOptions(OPERATOR, RP, T0 + 10_000).count, 1, "the owner still signs in, whatever number the settings now say");
    assert.equal(b.pendingRemoval(f, T0 + 10_000)?.kind, "owner_change", "and the change is a request");
    b.close();
  } finally { rmSync(d1, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true }); }
});

test("a locked shop with no bound owner (an old snapshot) is bound to its passkeys' owner, not to the settings' number", () => {
  const d1 = mkdtempSync(join(tmpdir(), "restore-c-"));
  try {
    const { a, f } = lockedShop(d1);
    a.close();
    const db = new DatabaseSync(join(d1, OWNER_ACCESS_FILE)); db.exec("DELETE FROM meta WHERE name IN ('bound_owner', 'bound_number')"); db.close();
    const b = openOwnerAccess(join(d1, OWNER_ACCESS_FILE));
    assert.equal(b.signinOptions(OPERATOR, RP, T0 + 5000).count, 0, "before anything reads the files, no binding yet: the settings' number decides");
    b.sync(f, T0 + 6000); // reading the files binds a locked shop to the owner of its passkeys
    assert.equal(b.signinOptions(OPERATOR, RP, T0 + 7000).count, 1);
    b.watchOwner(OPERATOR, T0 + 7000);
    assert.equal(b.pendingRemoval(f, T0 + 7000)?.kind, "owner_change");
    b.close();
  } finally { rmSync(d1, { recursive: true, force: true }); }
});
