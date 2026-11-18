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
import { relyingParty } from "../webauthn.ts";
import { newSoftPasskey, softRegister } from "./soft-authenticator.ts";

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

/** A real registration (a software passkey) with a grant, for the tests that need one. */
function enrol(access: OwnerAccess, who: typeof WHO, file: OwnerGrants, g: Parameters<OwnerAccess["registrationOptions"]>[0], now: number, label = "Android, Chrome") {
  const rp = relyingParty(who.base);
  const o = access.registrationOptions(g, file, who, rp, "Glow", now);
  assert.ok(o.ok, JSON.stringify(o));
  const r = access.register(g, file, who, rp, softRegister(newSoftPasskey(rp.rpId), o.options as never, rp.origin), now + 1, label);
  assert.ok(r.ok, JSON.stringify(r));
  return { session: r.session, id: r.passkey, sid: access.check(r.session, who, now + 2)!.id };
}

// ---- finding 1: the owner's number in the settings is the Operator's to edit; it must not lock the owner out or let the Operator in ----
test("finding 1: after the lock a changed owner number keeps the owner's passkeys and sessions, refuses sessions for the new number, and is a 48-hour request", () => {
  const w = world(); try {
    const NEW = { ...WHO, owner: "+919000000000" };
    const rp = relyingParty(WHO.base);
    const q = newSetupToken(); const f0 = f({ setup: w.qr(q, T0) });
    const a = enrol(w.access, WHO, f0, { kind: "setup", token: q }, T0);
    assert.equal(w.access.passkeys(WHO, rp).length, 1);
    // the Operator saves a new owner number in the settings form
    assert.equal(w.access.passkeys(NEW, rp).length, 1, "the owner's passkeys are still the owner's");
    assert.equal(w.access.signinOptions(NEW, rp, T0 + HOUR).count, 1, "and still sign in");
    assert.ok(w.access.check(a.session, NEW, T0 + HOUR), "the owner's session is still good");
    // WhatsApp: "open my app" from the NEW number gives a link session for the new number: it opens nothing
    const link = w.access.issue({ ...NEW, via: "whatsapp", now: T0 + HOUR });
    const byLink = w.access.consume(link.token, NEW, T0 + HOUR + 1);
    assert.ok(byLink.ok);
    assert.equal(w.access.check(byLink.session, NEW, T0 + HOUR + 2), undefined, "a session for the new number is refused for owner actions");
    // the request: seen by the runtime, shown on the owner's phone, cancellable
    w.access.watchOwner(NEW, T0 + HOUR + 5);
    assert.deepEqual(w.access.takeNotes().map((n) => n.what), ["owner_change_asked"]);
    const v = w.access.phonesView(a.sid, NEW, rp, f0, T0 + HOUR + 6)!;
    assert.deepEqual([v.removal?.kind, v.removal?.effectiveAt], ["owner_change", T0 + HOUR + 5 + REMOVAL_WAIT_MS]);
    assert.equal(w.access.passkeys(NEW, rp, w.access.passkeysBefore(f0, T0 + HOUR + 7)).length, 1, "nothing applied yet");
    // the same request is said once
    w.access.watchOwner(NEW, T0 + 2 * HOUR); assert.deepEqual(w.access.takeNotes(), []);
    // changing the number BACK withdraws the request
    w.access.watchOwner(WHO, T0 + 3 * HOUR);
    assert.equal(w.access.pendingRemoval(f0, T0 + 3 * HOUR + 1), undefined);
  } finally { w.done(); }
});

test("finding 1: if nobody cancels, the number change applies like a removal (phones end, a new QR for the new number works); if the owner cancels it is never heard again", () => {
  const w = world(); try {
    const NEW = { ...WHO, owner: "+919000000000" };
    const rp = relyingParty(WHO.base);
    const q = newSetupToken(); const f0 = f({ setup: w.qr(q, T0) });
    const a = enrol(w.access, WHO, f0, { kind: "setup", token: q }, T0);
    w.access.watchOwner(NEW, T0 + HOUR);
    const due = T0 + HOUR + REMOVAL_WAIT_MS;
    assert.ok(w.access.check(a.session, WHO, due - 1000), "still the owner's until it applies");
    const pb = w.access.passkeysBefore(f0, due + 1000);
    assert.equal(pb, due);
    assert.equal(w.access.check(a.session, NEW, due + 1000), undefined, "sessions ended");
    assert.equal(w.access.passkeys(NEW, rp, pb).length, 0);
    assert.equal(w.access.locked(f0, due + 1000), false, "the gate is open");
    const q2 = newSetupToken();
    const f2 = f({ setup: w.qr(q2, due + 5000) });
    const b = enrol(w.access, NEW, f2, { kind: "setup", token: q2 }, due + 6000);
    assert.ok(w.access.check(b.session, NEW, due + 7000), "the new number's owner holds the shop now (bound to the new number)");
  } finally { w.done(); }
  const c = world(); try {
    const NEW = { ...WHO, owner: "+919000000000" };
    const rp = relyingParty(WHO.base);
    const q = newSetupToken(); const f0 = f({ setup: c.qr(q, T0) });
    const a = enrol(c.access, WHO, f0, { kind: "setup", token: q }, T0);
    c.access.watchOwner(NEW, T0 + HOUR);
    assert.equal(c.access.cancelRemoval(f0, T0 + 2 * HOUR), true);
    c.access.watchOwner(NEW, T0 + 3 * DAY);
    assert.equal(c.access.pendingRemoval(f0, T0 + 3 * DAY), undefined, "a cancelled change is not heard again");
    assert.equal(c.access.passkeys(NEW, rp, c.access.passkeysBefore(f0, T0 + 4 * DAY)).length, 1);
    assert.ok(c.access.check(a.session, WHO, T0 + 4 * DAY));
  } finally { c.done(); }
});

// ---- finding 2: Geometer's reset must not be undone by the panel's own buttons ----
test("finding 2: after a reset the shop stays locked for the Operator until the owner has a phone again; only the reset's own QR works, and the phone is labelled from it", () => {
  const w = world(); try {
    const q0 = newSetupToken(); const f0 = f({ setup: w.qr(q0, T0) });
    w.access.sync(f0, T0);
    w.phone("p1", T0 + 1000);
    const R = T0 + DAY; const adminQr = newSetupToken();
    const reset = { at: new Date(R).toISOString(), reason: "dispute", by: "geometer", setup: { sha256: setupHash(adminQr), expiresAt: new Date(R + HOUR).toISOString() } };
    const admin = f({ reset });
    assert.equal(w.access.locked(admin, R + 5000), true, "no phone exists, yet the panel stays locked: the reset window");
    // the Operator presses "new setup QR" and "print a recovery card" in the panel (the panel writes the grants file; the reset stays in the admin's file)
    const opQr = newSetupToken(); const code = newRecoveryCode();
    const opFile = f({ reset, setup: w.qr(opQr, R + 60_000), recovery: recovery([code], R + 60_000) });
    assert.equal(w.access.grantState({ kind: "setup", token: opQr }, opFile, R + 70_000), "unknown", "the Operator's QR is refused in the window");
    assert.equal(w.access.grantState({ kind: "recovery", code }, opFile, R + 70_000), "unknown", "and so is its card");
    assert.equal(w.access.grantState({ kind: "setup", token: adminQr }, opFile, R + 70_000), "valid", "Geometer's QR is not overwritten by the panel's file");
    assert.equal(w.access.grantState({ kind: "setup", token: adminQr }, opFile, R + 2 * HOUR), "expired");
    // the owner registers with it: labelled "reset", the window closes, and the card staged in the window stays dead
    const a = enrol(w.access, WHO, opFile, { kind: "setup", token: adminQr }, R + 100_000);
    assert.equal(w.access.passkeys(WHO, relyingParty(WHO.base), w.access.passkeysBefore(opFile, R + 200_000))[0].via, "reset");
    assert.equal(w.access.grantState({ kind: "recovery", code }, opFile, R + 30 * DAY), "unknown", "a card made in the window never becomes valid");
    assert.equal(w.access.grantState({ kind: "setup", token: adminQr }, opFile, R + 100_500), "used");
    assert.ok(a.session);
  } finally { w.done(); }
});
