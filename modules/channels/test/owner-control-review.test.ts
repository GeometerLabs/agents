// The independent review of "no Operator holds a shop hostage" (19 Nov 2026) found ten problems; each test here began as that review's proof script (run on a real SQLite
// store, passkeys inserted directly as no browser is involved) and FAILED before its fix. They are kept apart from owner-control.test.ts so each finding reads as one story.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openOwnerAccess, ownerKey } from "../owner-access.ts";
import type { OwnerAccess, RelyingParty } from "../owner-access.ts";
import { REMOVAL_WAIT_MS, newRecoveryCode, newSetupToken, recoveryHash, setupHash } from "../owner-grants.ts";
import type { OwnerGrants } from "../owner-grants.ts";

const OWN = "+919876543210";
const RP: RelyingParty = { rpId: "pages.example", origin: "https://pages.example" };
const WHO = { owner: OWN, base: "https://pages.example/s/owner" };
const T0 = Date.UTC(2026, 10, 18);
const DAY = 864e5, HOUR = 36e5;

function world() {
  const dir = mkdtempSync(join(tmpdir(), "owner-review-"));
  const path = join(dir, "owner-access.sqlite");
  const access = openOwnerAccess(path);
  const db = new DatabaseSync(path);
  /** A phone: its passkey row and a passkey session, as if registered (no browser here). `owner` is the number it was made for. */
  const phone = (id: string, at: number, via = "setup", owner = OWN) => {
    db.prepare("INSERT INTO passkeys (id, cred_id, jwk, alg, sign_count, backed_up, made_at, owner_key, rp_id, via) VALUES (?,?,'{}',-7,0,0,?,?,?,?)").run(id, `cred-${id}`, at, ownerKey(owner), RP.rpId, via);
    db.prepare("INSERT INTO sessions (id, hash, made_at, expires_at, owner_key, base, link_id) VALUES (?,?,?,?,?,?,?)").run(`s${id}`, `h${id}`, at, at + 30 * DAY, ownerKey(owner), WHO.base, `pk-${id}`);
    return { passkey: id, sid: `s${id}` };
  };
  const qr = (token: string, at: number, expiresAt = at + 15 * 60_000): OwnerGrants["setup"] => ({ sha256: setupHash(token), createdAt: new Date(at).toISOString(), expiresAt: new Date(expiresAt).toISOString() });
  return { access, db, phone, qr, dir, done: () => { db.close(); access.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const f = (o: Partial<OwnerGrants> = {}): OwnerGrants => ({ schema: 1, ...o });
const recovery = (codes: string[], at: number): OwnerGrants["recovery"] => ({ codes: codes.map(recoveryHash), createdAt: new Date(at).toISOString() });

// ---- finding 4: a QR or code prepared before the lock must not survive the lock or the owner's own codes ----
test("finding 4: a QR dated 2099 works for 15 minutes from the runtime's first sight and no longer; own codes void a card hash staged in the QR's slot", () => {
  const w = world(); try {
    const code = newRecoveryCode(); const far = newSetupToken();
    // staged before the lock: a card code's hash in the QR slot, and a QR whose file says 2099
    w.access.sync(f({ setup: { sha256: recoveryHash(code), createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 15 * 60_000).toISOString() } }), T0);
    const staged = f({ setup: w.qr(far, T0 + 1000, Date.parse("2099-01-01T00:00:00Z")) });
    assert.equal(w.access.grantState({ kind: "setup", token: far }, staged, T0 + 1000), "valid", "a fresh QR works");
    const p = w.phone("p1", T0 + 60_000);
    assert.equal(w.access.grantState({ kind: "setup", token: far }, staged, T0 + 16 * 60_000), "expired", "the file's 2099 is not believed: 15 minutes from first sight");
    assert.equal(w.access.grantState({ kind: "setup", token: far }, staged, T0 + 30 * DAY), "expired");
    // the owner makes their own codes: every remembered QR and code hash goes, whatever slot it came from
    assert.equal(w.access.makeOwnCodes(p.sid, undefined, T0 + 2 * HOUR)?.length, 5);
    const back = f({ recovery: recovery([code], T0 + 30 * DAY) });
    assert.equal(w.access.grantState({ kind: "recovery", code }, back, T0 + 30 * DAY), "unknown", "the staged card code does not come back");
  } finally { w.done(); }
});

// ---- finding 5: times read from files are never taken from the future ----
test("finding 5: a future 'sign out every device' never refuses a session made after the runtime saw it; a future reset and a future passkeysBefore are clamped", () => {
  const w = world(); try {
    w.access.sync(f(), T0);
    const raw = Date.parse("2099-01-01T00:00:00Z");
    const eb = w.access.clampEndBefore(raw, T0 + HOUR)!;
    assert.equal(eb, T0 + HOUR, "clamped to the moment the runtime first saw it");
    assert.equal(w.access.check("x".repeat(43), WHO, T0 + 2 * HOUR, eb), undefined);
    // a passkey sign-in made after that is fine: the same value is remembered, not re-clamped to a later "now"
    assert.equal(w.access.clampEndBefore(raw, T0 + 2 * HOUR), T0 + HOUR);
    // a future reset moves no cutoff to 2099, and the real one afterwards still counts
    const g = world(); try {
      g.access.sync(f({ reset: { at: "2099-01-01T00:00:00Z", reason: "x", by: "y" } }), T0);
      assert.ok((g.access.passkeysBefore(undefined, T0 + 1) ?? 0) <= T0 + 1, "the cutoff is not in the future");
      const R = T0 + DAY; const qrTok = newSetupToken();
      const real = f({ reset: { at: new Date(R).toISOString(), reason: "real", by: "geometer" }, setup: g.qr(qrTok, R) });
      g.access.sync(real, R + 1000);
      assert.deepEqual(g.access.takeNotes().map((n) => n.what), ["reset", "reset"], "both were applied once each");
      assert.ok((g.access.passkeysBefore(real, R + 2000) ?? 0) <= R + 2000);
    } finally { g.done(); }
    // a future passkeysBefore at adoption
    const h = world(); try {
      assert.ok((h.access.passkeysBefore(f({ passkeysBefore: "2099-01-01T00:00:00Z" }), T0) ?? 0) <= T0);
    } finally { h.done(); }
  } finally { w.done(); }
});
