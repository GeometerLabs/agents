// "No Operator holds a shop hostage" (owner's item 2), the runtime's side: the real owner-access store with software passkeys. It shows the rules the Operator cannot
// bend, because the runtime (owner-access.ts) is the authority and the panel's files are only asked:
//   - the owner's phones: a coarse label from the browser, how each came to be, last used, "this phone"; an old row from before the label shows no label;
//   - removing a phone: the owner may; the LAST one only with an explicit second confirm; a removed phone's sessions end;
//   - a new phone is announced to every OTHER phone until that phone dismisses it;
//   - the owner's own recovery codes void the Operator's printed card, and only a passkey session may make them;
//   - once the owner holds a passkey the Operator's QR and card made afterwards are refused, whatever the file says;
//   - the Operator's "remove the passkeys" is a request the runtime times itself: it shows, the owner cancels, or it applies after 48 hours (a fake clock), and only then a
//     new QR works; a back-dated request does not apply at once; a passkeysBefore written straight into the file is ignored;
//   - Geometer's reset (a separate file): voids everything, ends sessions, cancels the request, and its own QR works once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openOwnerAccess } from "../owner-access.ts";
import type { OwnerAccess, RelyingParty } from "../owner-access.ts";
import { OWNER_GRANTS_FILE, OWNER_RESET_FILE, REMOVAL_WAIT_MS, newRecoveryCode, newSetupToken, ownerGrantsReader, recoveryHash, setupHash } from "../owner-grants.ts";
import type { Grant, OwnerGrants } from "../owner-grants.ts";
import { NEW_PHONE_ALERT, phoneLabel } from "../owner-phones.ts";
import { addPhonePage, phonesBanner, phonesPage, removePhonePage, withBanner, WORDS } from "../owner-phones-page.ts";
import type { PhonesAnswer } from "../owner-phones-page.ts";
import { relyingParty } from "../webauthn.ts";
import { newSoftPasskey, softRegister } from "./soft-authenticator.ts";

const T0 = Date.parse("2026-11-19T04:00:00Z");
const HOUR = 60 * 60_000;
const BASE = "https://pages.example/glow/owner";
const RP: RelyingParty = relyingParty(BASE);
const OWNER = { owner: "+919800000001", base: BASE };
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** The Operator's file as the deployer copies it: a QR, a card, and perhaps a request. */
function file(o: { token?: string; codes?: string[]; at?: number; pending?: { askedAt: number; by?: string }; passkeysBefore?: number; reset?: { at: number; reason?: string; by?: string } } = {}): OwnerGrants {
  const at = o.at ?? T0;
  return {
    schema: 1,
    ...(o.token ? { setup: { sha256: setupHash(o.token), createdAt: new Date(at).toISOString(), expiresAt: new Date(at + 60 * 60_000).toISOString() } } : {}),
    ...(o.codes ? { recovery: { codes: o.codes.map(recoveryHash), createdAt: new Date(at).toISOString() } } : {}),
    ...(o.passkeysBefore !== undefined ? { passkeysBefore: new Date(o.passkeysBefore).toISOString() } : {}),
    ...(o.pending ? { pendingRemoval: { askedBy: o.pending.by ?? "Divya", askedAt: new Date(o.pending.askedAt).toISOString(), effectiveAt: new Date(o.pending.askedAt + REMOVAL_WAIT_MS).toISOString() } } : {}),
    // Geometer's reset carries its own QR (the token given for the file), exactly as the admin's file does; the panel's slot is empty in a reset
    ...(o.reset ? { reset: { at: new Date(o.reset.at).toISOString(), reason: o.reset.reason ?? "owner lost every phone", by: o.reset.by ?? "Naval", ...(o.token ? { setup: { sha256: setupHash(o.token), expiresAt: new Date(o.reset.at + 60 * 60_000).toISOString() } } : {}) } } : {}),
  };
}

function store() {
  const dir = mkdtempSync(join(tmpdir(), "owner-control-"));
  const path = join(dir, "owner-access.sqlite");
  const access = openOwnerAccess(path);
  return { access, path, dir, done: () => { access.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** Register one phone with the grant, return its session and the passkey id. */
function register(access: OwnerAccess, g: Grant, f: OwnerGrants, now: number, label = "Android, Chrome") {
  const o = access.registrationOptions(g, f, OWNER, RP, "Glow", now);
  assert.ok(o.ok, JSON.stringify(o));
  const r = access.register(g, f, OWNER, RP, softRegister(newSoftPasskey(RP.rpId), o.options as never, RP.origin), now + 1, label);
  assert.ok(r.ok, JSON.stringify(r));
  const sid = access.check(r.session, OWNER, now + 2)!.id;
  return { session: r.session, sid, passkey: r.passkey };
}
const view = (access: OwnerAccess, sid: string, f: OwnerGrants, now: number) => access.phonesView(sid, OWNER, RP, f, now)!;

test("phoneLabel: platform and browser only, nothing finer; unknown parts are left out; the User-Agent is never the label", () => {
  assert.equal(phoneLabel(ANDROID), "Android, Chrome");
  assert.equal(phoneLabel(IPHONE), "iPhone, Safari");
  assert.equal(phoneLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0"), "Windows, Edge");
  assert.equal(phoneLabel("Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0"), "Android, Firefox");
  assert.equal(phoneLabel("curl/8"), "");
  assert.equal(phoneLabel(undefined), "");
  assert.ok(!phoneLabel(ANDROID).includes("Pixel") && !phoneLabel(ANDROID).includes("120"));
});

test("the owner's phones: each with its label, how it was added, last used and 'this phone'; an old row from before the label shows no label", () => {
  const { access, path, done } = store(); try {
    const token = newSetupToken(); const f = file({ token });
    const a = register(access, { kind: "setup", token }, f, T0, "Android, Chrome");
    const v = view(access, a.sid, f, T0 + 10);
    assert.equal(v.phones.length, 1);
    assert.deepEqual([v.phones[0].label, v.phones[0].via, v.phones[0].mine, v.phones[0].usedAt], ["Android, Chrome", "setup", true, undefined]);
    assert.equal(v.passkeySession, true);
    assert.equal(v.ownCodesAt, undefined);
    // a row made before the label existed has none, and the page says "A phone"
    const raw = new DatabaseSync(path); raw.exec("UPDATE passkeys SET label = NULL"); raw.close();
    const old = view(access, a.sid, f, T0 + 11);
    assert.equal(old.phones[0].label, undefined);
    assert.ok(phonesPage({ base: BASE, language: "en", view: { ...old, language: "en", now: T0 }, hosted: false }).includes(WORDS.en.aPhone));
    // a recovery code adds a second phone, and says so
    const code = newRecoveryCode();
    const f2 = file({ token, codes: [code] });
    access.sync(f2, T0 + 20); // seen before the first passkey? no: after. The card is made by the Operator after the first passkey and must be refused (below).
    assert.equal(access.grantState({ kind: "recovery", code }, f2, T0 + 30), "unknown");
  } finally { done(); }
  // the migration: a store made before the label column opens, keeps its rows, and shows them with no label
  const old = mkdtempSync(join(tmpdir(), "owner-control-old-"));
  try {
    const p = join(old, "owner-access.sqlite");
    const db = new DatabaseSync(p);
    db.exec(`CREATE TABLE passkeys (id TEXT PRIMARY KEY, cred_id TEXT NOT NULL UNIQUE, jwk TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL, backed_up INTEGER NOT NULL,
      made_at INTEGER NOT NULL, used_at INTEGER, removed_at INTEGER, removed_why TEXT, owner_key TEXT NOT NULL, rp_id TEXT NOT NULL, via TEXT NOT NULL);`);
    db.exec("INSERT INTO passkeys VALUES ('old1', 'cred', '{}', -7, 0, 0, 1000, NULL, NULL, NULL, 'k', 'pages.example', 'setup')");
    db.close();
    const access = openOwnerAccess(p); // migrates
    const cols = (new DatabaseSync(p).prepare("PRAGMA table_info(passkeys)").all() as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes("label"), "the label column was added");
    assert.deepEqual(access.passkeys(OWNER, RP), [], "the old row belongs to another owner key here, so it is not listed; the point is that opening did not fail");
    const row = new DatabaseSync(p).prepare("SELECT id, label FROM passkeys").get() as { id: string; label: string | null };
    assert.deepEqual([row.id, row.label], ["old1", null], "the old row is kept, with no label");
    access.close();
  } finally { rmSync(old, { recursive: true, force: true }); }
});

test("removing a phone: the owner may, the last one only with the second confirm, and a removed phone's sessions end", () => {
  const { access, done } = store(); try {
    const t1 = newSetupToken(); const f = file({ token: t1 });
    const a = register(access, { kind: "setup", token: t1 }, f, T0, "Android, Chrome");
    // a second phone from the owner's own app ("add a phone")
    const add = access.addPhone(a.sid, f, T0 + 1000)!;
    assert.ok(add.token);
    const b = register(access, { kind: "setup", token: add.token }, f, T0 + 2000, "iPhone, Safari");
    assert.equal(access.passkeys(OWNER, RP).length, 2);
    assert.equal(access.passkeys(OWNER, RP).find((p) => p.id === b.passkey)!.via, "own_phone");
    // remove the second: allowed without any second confirm; its session ends; the first still opens
    const r1 = access.removePhone(a.sid, b.passkey, OWNER, RP, f, T0 + 3000, false);
    assert.ok(r1.ok && r1.removed.label === "iPhone, Safari" && r1.wasLast === false);
    assert.equal(access.check(b.session, OWNER, T0 + 3001), undefined, "the removed phone's session ended");
    assert.ok(access.check(a.session, OWNER, T0 + 3001));
    assert.equal(access.removePhone(a.sid, b.passkey, OWNER, RP, f, T0 + 3002, false).ok, false, "already gone");
    // the last one: refused until the owner confirms twice
    assert.deepEqual(access.removePhone(a.sid, a.passkey, OWNER, RP, f, T0 + 4000, false), { ok: false, why: "last" });
    assert.equal(access.passkeys(OWNER, RP).length, 1, "refused: nothing changed");
    const last = access.removePhone(a.sid, a.passkey, OWNER, RP, f, T0 + 5000, true);
    assert.ok(last.ok && last.wasLast);
    assert.equal(access.passkeys(OWNER, RP).length, 0);
    assert.equal(access.signinOptions(OWNER, RP, T0 + 6000).count, 0, "no phone opens the shop now");
  } finally { done(); }
});

test("a new phone is announced to every OTHER phone until that phone dismisses it; the new phone itself is not told about itself", () => {
  const { access, done } = store(); try {
    const t1 = newSetupToken(); const f = file({ token: t1 });
    const a = register(access, { kind: "setup", token: t1 }, f, T0, "Android, Chrome");
    assert.deepEqual(view(access, a.sid, f, T0 + 10).announce, [], "nothing new yet");
    const add = access.addPhone(a.sid, f, T0 + 1000)!;
    const b = register(access, { kind: "setup", token: add.token }, f, T0 + 2000, "iPhone, Safari");
    const seenByA = view(access, a.sid, f, T0 + 3000).announce;
    assert.equal(seenByA.length, 1);
    assert.deepEqual([seenByA[0].id, seenByA[0].label, seenByA[0].madeAt], [b.passkey, "iPhone, Safari", T0 + 2001]);
    assert.deepEqual(view(access, b.sid, f, T0 + 3000).announce, [], "the new phone is not told about itself");
    // it stays until dismissed, whatever the time
    assert.equal(view(access, a.sid, f, T0 + 40 * HOUR).announce.length, 1);
    access.dismiss(a.sid, T0 + 3500);
    assert.equal(view(access, a.sid, f, T0 + 41 * HOUR).announce.length, 0);
    // a third phone brings it back for the others
    const add2 = access.addPhone(a.sid, f, T0 + 50 * HOUR)!;
    register(access, { kind: "setup", token: add2.token }, f, T0 + 50 * HOUR + 1000, "Windows, Edge");
    assert.equal(view(access, a.sid, f, T0 + 51 * HOUR).announce.length, 1);
    assert.equal(view(access, b.sid, f, T0 + 51 * HOUR).announce.length, 1, "b had not dismissed anything: it is told about the third phone (made after b)");
    // a session made by a WhatsApp link is announced to as well (keyed by that session)
    const link = access.issue({ ...OWNER, via: "whatsapp", now: T0 + 52 * HOUR });
    const byLink = access.consume(link.token, OWNER, T0 + 52 * HOUR + 1);
    assert.ok(byLink.ok);
    assert.equal(view(access, byLink.id, f, T0 + 52 * HOUR + 2).announce.length, 0, "it signed in after those phones were added");
    assert.equal(view(access, byLink.id, f, T0 + 52 * HOUR + 2).passkeySession, false);
  } finally { done(); }
});

test("the new-phone alert says the day, the time and the label, in all four languages, with no link and no code", () => {
  const at = Date.UTC(2026, 10, 19, 10, 12);
  const alert = NEW_PHONE_ALERT(at, "Android, Chrome");
  for (const lang of ["en", "hi", "ml", "kn"] as const) { assert.match(alert[lang], /Android, Chrome/u); assert.doesNotMatch(alert[lang], /https?:/u); }
  assert.match(alert.en, /A new phone was added to your shop on .*Not you\?/u);
});

test("the owner's own recovery codes: shown once, made only from a passkey session, and every code of the Operator's printed card stops working", () => {
  const { access, done } = store(); try {
    const t1 = newSetupToken(); const card = [newRecoveryCode(), newRecoveryCode()];
    const f = file({ token: t1, codes: card });
    const a = register(access, { kind: "setup", token: t1 }, f, T0);
    // before: the card works (it was in the file before the first passkey)
    assert.equal(access.grantState({ kind: "recovery", code: card[0] }, f, T0 + 10), "valid");
    // a session made by a link cannot make codes
    const link = access.issue({ ...OWNER, via: "whatsapp", now: T0 + 20 });
    const byLink = access.consume(link.token, OWNER, T0 + 21);
    assert.ok(byLink.ok);
    assert.equal(access.makeOwnCodes(byLink.id, f, T0 + 22), undefined, "a WhatsApp link is whoever holds the phone");
    const own = access.makeOwnCodes(a.sid, f, T0 + 30)!;
    assert.equal(own.length, 5);
    assert.equal(access.grantState({ kind: "recovery", code: card[0] }, f, T0 + 31), "unknown", "the Operator's card is void");
    assert.equal(access.grantState({ kind: "recovery", code: card[1] }, f, T0 + 31), "unknown");
    assert.equal(access.grantState({ kind: "recovery", code: own[0] }, f, T0 + 31), "valid", "the owner's own code works, though no file names it");
    assert.equal(view(access, a.sid, f, T0 + 32).ownCodesAt, T0 + 30);
    // an own code registers a phone, once
    const second = register(access, { kind: "recovery", code: own[2] }, f, T0 + 40, "iPhone, Safari");
    assert.equal(access.passkeys(OWNER, RP).find((p) => p.id === second.passkey)!.via, "own_code", "made with the owner's own code");
    assert.equal(access.grantState({ kind: "recovery", code: own[2] }, f, T0 + 50), "used");
    // new codes void the old set
    const again = access.makeOwnCodes(a.sid, f, T0 + 60)!;
    assert.equal(access.grantState({ kind: "recovery", code: own[0] }, f, T0 + 61), "unknown");
    assert.equal(access.grantState({ kind: "recovery", code: again[0] }, f, T0 + 61), "valid");
    // and a hand-written file that brings the card back changes nothing: those hashes were seen and voided
    assert.equal(access.grantState({ kind: "recovery", code: card[0] }, file({ token: t1, codes: card, at: T0 + 100 }), T0 + 100), "unknown");
  } finally { done(); }
});

test("after the owner's first passkey the Operator's new QR and new card do not work, whatever the file says; before it, they work as they did", () => {
  const { access, done } = store(); try {
    // before: a QR made now is fine, and so is a second one (the panel works as today)
    const q1 = newSetupToken(); const q2 = newSetupToken();
    assert.equal(access.grantState({ kind: "setup", token: q1 }, file({ token: q1 }), T0), "valid");
    assert.equal(access.grantState({ kind: "setup", token: q2 }, file({ token: q2, at: T0 + 1000 }), T0 + 1000), "valid");
    assert.equal(access.locked(file({ token: q2 }), T0 + 1000), false);
    register(access, { kind: "setup", token: q2 }, file({ token: q2, at: T0 + 1000 }), T0 + 2000);
    assert.equal(access.locked(undefined, T0 + 3000), true, "the owner holds a passkey: locked");
    // after: a QR and a card the Operator makes now are refused, even with a back-dated createdAt
    const q3 = newSetupToken(); const card = [newRecoveryCode()];
    const late = file({ token: q3, codes: card, at: T0 }); // createdAt says "before the first passkey": a lie the runtime does not believe
    assert.equal(access.grantState({ kind: "setup", token: q3 }, late, T0 + 4000), "unknown");
    assert.equal(access.grantState({ kind: "recovery", code: card[0] }, late, T0 + 4000), "unknown");
    assert.deepEqual(access.registrationOptions({ kind: "setup", token: q3 }, late, OWNER, RP, "Glow", T0 + 4000), { ok: false, state: "unknown" });
  } finally { done(); }
});

test("a passkeysBefore written straight into the Operator's file is ignored once the owner holds a passkey", () => {
  const { access, done } = store(); try {
    const t1 = newSetupToken(); const f = file({ token: t1 });
    const a = register(access, { kind: "setup", token: t1 }, f, T0);
    assert.equal(access.passkeysBefore(f, T0 + 10), undefined);
    const forged = file({ passkeysBefore: T0 + 5000 });
    assert.equal(access.passkeysBefore(forged, T0 + 6000), undefined, "the file's own value is not taken");
    assert.equal(access.signinOptions(OWNER, RP, T0 + 6000, access.passkeysBefore(forged, T0 + 6000)).count, 1, "the owner still signs in");
    assert.ok(access.check(a.session, OWNER, T0 + 6000));
  } finally { done(); }
});

test("a shop from before this rule keeps the QR, the card and the passkeysBefore it had: they are adopted once, as of the first passkey", () => {
  const { access, path, done } = store(); try {
    // make the passkey the old way, then forget that the gate ever ran (an upgrade): delete the adoption marker and the seen table's rows
    const t1 = newSetupToken(); const card = [newRecoveryCode()]; const f = file({ token: t1, codes: card, passkeysBefore: T0 - 1000 });
    register(access, { kind: "setup", token: t1 }, f, T0);
    const db = new DatabaseSync(path); db.exec("DELETE FROM meta WHERE name IN ('adopted', 'passkeys_before'); DELETE FROM grants_seen;"); db.close();
    assert.equal(access.passkeysBefore(f, T0 + 5000), T0 - 1000, "adopted once");
    assert.equal(access.grantState({ kind: "recovery", code: card[0] }, f, T0 + 5000), "valid", "the card printed before the upgrade still works");
    assert.equal(access.passkeysBefore(file({ passkeysBefore: T0 + 9000 }), T0 + 9500), T0 - 1000, "and the file no longer sets it");
  } finally { done(); }
});

test("the Operator's removal request: the runtime times it from first sight, the owner sees it, cancels it, or it applies after 48 hours and only then a new QR works", () => {
  const { access, done } = store(); try {
    const t1 = newSetupToken(); const f0 = file({ token: t1 });
    const a = register(access, { kind: "setup", token: t1 }, f0, T0);
    const b = register(access, { kind: "setup", token: access.addPhone(a.sid, f0, T0 + 1000)!.token }, f0, T0 + 2000, "iPhone, Safari");
    // the Operator asks at T0+1h (the file says the effect is 48 hours later, but the runtime's own clock decides)
    const ask = T0 + HOUR;
    const f1 = file({ pending: { askedAt: ask, by: "Divya" } });
    assert.equal(access.pendingRemoval(f1, ask + 5000)?.askedBy, "Divya");
    const seen = view(access, a.sid, f1, ask + 6000);
    assert.equal(seen.removal?.effectiveAt, ask + 5000 + REMOVAL_WAIT_MS, "48 hours from when the runtime first saw it");
    assert.equal(view(access, b.sid, f1, ask + 6000).removal?.askedBy, "Divya", "every phone sees it");
    assert.deepEqual(access.takeNotes().map((n) => n.what), ["removal_asked"], "said once in the record");
    // one second before the wait is over: nothing applies
    const almost = ask + 5000 + REMOVAL_WAIT_MS - 1000;
    assert.equal(access.passkeys(OWNER, RP, access.passkeysBefore(f1, almost)).length, 2);
    assert.equal(access.locked(f1, almost), true);
    // the wait is over: every passkey made before it stops, sessions end, the gate opens
    const after = ask + 5000 + REMOVAL_WAIT_MS + 1000;
    const pb = access.passkeysBefore(f1, after);
    assert.equal(pb, ask + 5000 + REMOVAL_WAIT_MS);
    assert.equal(access.passkeys(OWNER, RP, pb).length, 0);
    assert.equal(access.check(a.session, OWNER, after), undefined, "sessions ended");
    assert.deepEqual(access.takeNotes().map((n) => n.what), ["removal_applied"]);
    assert.equal(access.locked(f1, after), false, "the gate is open");
    // only now may the Operator's new QR work, and the owner registers a phone with it
    const q = newSetupToken();
    const f2 = { ...file({ token: q, at: after }), pendingRemoval: f1.pendingRemoval };
    assert.equal(access.grantState({ kind: "setup", token: q }, f2, after + 10), "valid");
    const c = register(access, { kind: "setup", token: q }, f2, after + 20);
    assert.ok(access.passkeys(OWNER, RP, access.passkeysBefore(f2, after + 30)).some((p) => p.id === c.passkey));
    // the same request, still in the file, is not applied again and does not lock the new phone out
    assert.equal(access.passkeys(OWNER, RP, access.passkeysBefore(f2, after + 40 * HOUR)).length, 1);
    assert.equal(access.locked(f2, after + 40 * HOUR), true, "locked again: the owner holds a passkey made after the gate opened");
  } finally { done(); }
});

test("the owner cancels the Operator's request on any phone; the same request is not heard again, a new one starts a new wait", () => {
  const { access, done } = store(); try {
    const t1 = newSetupToken(); const f0 = file({ token: t1 });
    const a = register(access, { kind: "setup", token: t1 }, f0, T0);
    const f1 = file({ pending: { askedAt: T0 + HOUR } });
    assert.ok(access.pendingRemoval(f1, T0 + HOUR + 1));
    assert.equal(access.cancelRemoval(f1, T0 + 2 * HOUR), true);
    assert.equal(access.pendingRemoval(f1, T0 + 3 * HOUR), undefined);
    // the file still holds the request, and 48 hours pass: nothing happens
    const late = T0 + 3 * REMOVAL_WAIT_MS;
    assert.equal(access.passkeysBefore(f1, late), undefined);
    assert.equal(access.passkeys(OWNER, RP, undefined).length, 1);
    assert.ok(access.check(a.session, OWNER, T0 + 5 * HOUR));
    // a new request (a new askedAt) is a new wait
    const f2 = file({ pending: { askedAt: late + HOUR } });
    assert.ok(access.pendingRemoval(f2, late + HOUR + 1));
    assert.equal(access.cancelRemoval(f2, late + 2 * HOUR), true);
    assert.equal(access.cancelRemoval(f2, late + 3 * HOUR), false, "nothing waiting");
  } finally { done(); }
});

test("a back-dated request does not apply at once; a request before the owner holds any passkey is not a request at all", () => {
  const { access, done } = store(); try {
    const q = newSetupToken();
    // before the first passkey: a request in the file is ignored (the panel works as it did, and a removal then needs no wait)
    assert.equal(access.pendingRemoval(file({ pending: { askedAt: T0 - 10 * REMOVAL_WAIT_MS } }), T0), undefined);
    register(access, { kind: "setup", token: q }, file({ token: q }), T0 + 10);
    // the file claims the request was made ten days ago: the runtime counts from now
    const f = file({ pending: { askedAt: T0 - 10 * REMOVAL_WAIT_MS } });
    const p = access.pendingRemoval(f, T0 + 1000)!;
    assert.equal(p.effectiveAt, T0 + 1000 + REMOVAL_WAIT_MS);
    assert.equal(access.passkeysBefore(f, T0 + 2000), undefined, "not applied");
  } finally { done(); }
});

test("Geometer's reset: the old QR, the card, the owner's own codes and every session stop; a pending request is cancelled; the one new QR works once", () => {
  const { access, done } = store(); try {
    const t1 = newSetupToken(); const card = [newRecoveryCode()];
    const f0 = file({ token: t1, codes: card });
    const a = register(access, { kind: "setup", token: t1 }, f0, T0);
    const own = access.makeOwnCodes(a.sid, f0, T0 + 10)!;
    access.sync(file({ pending: { askedAt: T0 + HOUR } }), T0 + HOUR + 1);
    assert.ok(access.pendingRemoval(file({ pending: { askedAt: T0 + HOUR } }), T0 + HOUR + 2));
    access.takeNotes();
    // the admin's command: its own file, and a grants file holding ONLY the new QR
    const at = T0 + 2 * HOUR; const fresh = newSetupToken();
    const f1 = file({ token: fresh, at, reset: { at, reason: "owner lost every phone; checked on a video call", by: "Naval" } });
    delete f1.setup; // the reset's QR is in the reset, never in the panel's slot
    assert.equal(access.passkeysBefore(f1, at + 5), at);
    assert.deepEqual(access.takeNotes().map((n) => n.what), ["reset"]);
    assert.equal(access.check(a.session, OWNER, at + 6), undefined, "every session ended");
    assert.equal(access.passkeys(OWNER, RP, at).length, 0, "every phone stopped");
    assert.equal(access.pendingRemoval(f1, at + 7), undefined, "the pending request is cancelled");
    assert.equal(access.grantState({ kind: "setup", token: t1 }, f1, at + 8), "unknown");
    assert.equal(access.grantState({ kind: "recovery", code: card[0] }, f1, at + 8), "unknown");
    assert.equal(access.grantState({ kind: "recovery", code: own[0] }, f1, at + 8), "unknown", "the owner's own codes too");
    assert.equal(access.grantState({ kind: "setup", token: fresh }, f1, at + 8), "valid", "the new QR");
    const c = register(access, { kind: "setup", token: fresh }, f1, at + 20, "Android, Chrome");
    assert.equal(access.passkeys(OWNER, RP, access.passkeysBefore(f1, at + 30))[0].via, "reset", "the list says Geometer reset it");
    assert.equal(access.grantState({ kind: "setup", token: fresh }, f1, at + 40), "used", "once");
    assert.ok(access.check(c.session, OWNER, at + 50));
    // the reset is applied once: asked again with the same file, it changes nothing
    access.passkeysBefore(f1, at + 60);
    assert.deepEqual(access.takeNotes(), []);
    assert.ok(access.check(c.session, OWNER, at + 70));
  } finally { done(); }
});

test("the runtime's reader takes Geometer's reset only from its own file: a reset written into the Operator's file is never read", () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-control-files-"));
  try {
    const grants = join(dir, OWNER_GRANTS_FILE); const reset = join(dir, OWNER_RESET_FILE);
    const read = ownerGrantsReader(grants, reset);
    writeFileSync(grants, JSON.stringify({ schema: 1, reset: { at: new Date(T0).toISOString(), reason: "forged", by: "Operator" } }));
    assert.equal(read()?.reset, undefined, "a forged reset in the panel's file");
    writeFileSync(reset, JSON.stringify({ schema: 1, at: new Date(T0).toISOString(), reason: "owner lost every phone", by: "Naval" }));
    assert.deepEqual(read()?.reset, { at: new Date(T0).toISOString(), reason: "owner lost every phone", by: "Naval" }); // no QR in this one: setup is optional
    rmSync(grants);
    assert.equal(read()?.reset?.by, "Naval", "a reset with no grants file still reads");
    writeFileSync(reset, "{nope");
    assert.equal(read(), undefined, "a broken reset grants nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the phones page, the banners and the confirms: every state drawn, in each language, with forms and no script", () => {
  const phone = (id: string, o: Partial<PhonesAnswer["phones"][number]> = {}) => ({ id, madeAt: T0, via: "setup", mine: false, ...o });
  const base: PhonesAnswer = { language: "en", now: T0 + 5000, phones: [phone("aaaaaaaaaaaa", { label: "Android, Chrome", mine: true, usedAt: T0 + 1000 })], announce: [], news: [], seenThrough: 0, passkeySession: true };
  for (const lang of ["en", "hi", "ml", "kn"] as const) {
    const w = WORDS[lang];
    // one phone, no codes yet: the prompt banner, the one-phone line, "this phone", Remove, add and make-codes buttons
    const one = phonesPage({ base: "https://x/owner", language: lang, csrf: "c".repeat(32), view: { ...base, language: lang }, hosted: false });
    assert.match(one, new RegExp(`<h1>${w.title}</h1>`, "u"));
    assert.ok(one.includes(w.thisPhone) && one.includes("Android, Chrome") && one.includes(w.onePhone) && one.includes(w.bannerCodes) && one.includes('action="https://x/owner/phones/add"'));
    assert.doesNotMatch(one, /<script/u);
    assert.ok(!one.includes("hello@geometer.dev"), "a builder's server shows no line about Geometer");
    assert.ok(phonesPage({ base: "https://x/owner", language: lang, view: { ...base, language: lang }, hosted: true }).includes("hello@geometer.dev"), "Geometer's own server shows it");
    // many phones, an old row with no label, a pending request, a new phone to announce
    const many: PhonesAnswer = { ...base, language: lang, seenThrough: T0 + 2000, phones: [phone("aaaaaaaaaaaa", { label: "Android, Chrome", mine: true }), phone("bbbbbbbbbbbb")], announce: [phone("bbbbbbbbbbbb", { label: "iPhone, Safari", madeAt: T0 + 2000 })], ownCodesAt: T0, removal: { kind: "removal", askedBy: "Divya", askedAt: new Date(T0).toISOString(), seenAt: T0, effectiveAt: T0 + REMOVAL_WAIT_MS } };
    const m = phonesPage({ base: "https://x/owner", language: lang, csrf: "c".repeat(32), view: many, hosted: false });
    assert.ok(m.includes(w.aPhone) && m.includes("iPhone, Safari") && m.includes(w.cancel) && m.includes(w.itWasMe) && m.includes('action="https://x/owner/phones/cancel"') && m.includes("Divya"));
    assert.ok(!m.includes(w.bannerCodes), "codes are made: no prompt");
    // no phone at all, and a link session (no add, no codes)
    const none = phonesPage({ base: "https://x/owner", language: lang, view: { ...base, language: lang, phones: [], passkeySession: false }, hosted: false });
    assert.ok(none.includes(w.noPhones) && !none.includes('phones/add"') && !none.includes('phones/codes"'));
    // the confirm pages: first for any phone, second for the last (a different button and words)
    const c1 = removePhonePage({ base: "https://x/owner", language: lang, csrf: "c".repeat(32), id: "bbbbbbbbbbbb", label: "iPhone, Safari", last: false });
    const c2 = removePhonePage({ base: "https://x/owner", language: lang, csrf: "c".repeat(32), id: "bbbbbbbbbbbb", last: true });
    assert.ok(c1.includes(w.removeYes) && !c1.includes('name="confirm_last"'));
    assert.ok(c2.includes(w.lastYes) && c2.includes('name="confirm_last" value="yes"') && c2.includes(w.lastTitle));
    // the add page: the one-use address as a QR and in words
    const add = addPhonePage({ base: "https://x/owner", language: lang, url: "https://x/owner/setup/" + "a".repeat(43), expiresAt: T0 });
    assert.ok(add.includes("<svg") && add.includes("/owner/setup/"));
  }
  // the banner goes inside the first <main class="wrap"> of any owner page, and nothing when there is nothing to say
  const b = phonesBanner({ base: "https://x/owner", language: "en", csrf: "c".repeat(32), view: { ...base, announce: [phone("bbbbbbbbbbbb", { label: "iPhone, Safari", madeAt: T0 + 2000 })], ownCodesAt: T0 } });
  assert.match(b, /A new phone was added on .*\(iPhone, Safari\)\. Not you\? Remove it\./u);
  assert.ok(b.includes("phones?remove=bbbbbbbbbbbb") && b.includes("It was me"));
  assert.equal(phonesBanner({ base: "https://x/owner", language: "en", view: { ...base, ownCodesAt: T0 } }), "");
  assert.equal(withBanner('<main class="wrap"><h1>x</h1></main>', b).startsWith('<main class="wrap"><div class="notice"'), true);
  assert.equal(withBanner("<p>no main</p>", ""), "<p>no main</p>");
});
