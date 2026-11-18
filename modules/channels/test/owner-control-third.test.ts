// The third review round of "no Operator holds a shop hostage" (19 Nov 2026). Each test began as the reviewer's proof script and failed before its fix:
//   - a request's notice (the owner's push and the record line) lived only in memory, so a restart before the next tick lost it while the 48 hours still ran;
//   - (below, with the effective-number tests) a legitimate sale bound the new owner to the OLD number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { createRecord } from "../../record/record.ts";
import { OWNER_ACCESS_FILE, openOwnerAccess } from "../owner-access.ts";
import type { OwnerAccess } from "../owner-access.ts";
import { newSetupToken, setupHash } from "../owner-grants.ts";
import type { OwnerGrants } from "../owner-grants.ts";
import { createOwnerSignin, followLockedNumber } from "../owner-signin.ts";
import type { PagesFile } from "../pages-file.ts";
import { relyingParty } from "../webauthn.ts";
import { newSoftPasskey, softRegister } from "./soft-authenticator.ts";

const BASE = "https://pages.example/glow";
const OWNER_BASE = `${BASE}/owner`;
const RP = relyingParty(OWNER_BASE);
const A = "+919800000001";
const B = "+919822222222";
const T0 = Date.parse("2026-11-19T04:00:00Z");
const HOUR = 36e5, DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString();
const PAGES: PagesFile = { schema: 1, base: BASE, ownerBase: OWNER_BASE, slug: "glow", url: BASE };
const qr = (token: string, at: number): OwnerGrants => ({ schema: 1, setup: { sha256: setupHash(token), createdAt: iso(at), expiresAt: iso(at + 15 * 60_000) } });

/** A real registration (a soft passkey) for `who`, with the QR `file` carries; returns the passkey session. */
function register(access: OwnerAccess, file: OwnerGrants, token: string, who: { owner: string; base: string }, now: number) {
  const g = { kind: "setup" as const, token };
  const o = access.registrationOptions(g, file, who, RP, "Glow", now);
  if (!o.ok) throw new Error(`no options: ${o.state}`);
  const r = access.register(g, file, who, RP, softRegister(newSoftPasskey(RP.rpId), o.options, RP.origin), now + 1, "Android, Chrome");
  if (!r.ok) throw new Error(`refused: ${r.state}`);
  return r;
}

test("a request seen by an HTTP-style call and then a restart before any tick is still told once: one push, one record line, never twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-third-"));
  const path = join(dir, OWNER_ACCESS_FILE);
  try {
    let access = openOwnerAccess(path);
    const q = newSetupToken(); const f0 = qr(q, T0);
    access.sync(f0, T0);
    register(access, f0, q, { owner: A, base: OWNER_BASE }, T0 + 1000);
    const ask: OwnerGrants = { ...f0, pendingRemoval: { askedBy: "Divya", askedAt: iso(T0 + HOUR), effectiveAt: iso(T0 + 49 * HOUR) } };
    // the panel's /status probe: a reconcile outside the tick. The note used to be queued in memory only.
    access.pendingRemoval(ask, T0 + HOUR);
    access.close();
    // the runtime restarts before its next tick (the store is reopened, a new signin made)
    access = openOwnerAccess(path);
    const clock = fakeClock(T0 + HOUR + 60_000);
    const record = createRecord(clock);
    const alerts: string[] = [];
    const signin = createOwnerSignin({ access, pages: () => PAGES, endBefore: () => undefined, grants: () => ask, owner: { whatsapp: A, language: "en" }, alert: (t) => alerts.push(t.en), shopName: "Glow", clock });
    signin.markTold(signin.tick({ record })); // as the core does, once the step is saved
    const lines = () => record.entries().filter((e) => e.action === "owner_session" && (e.refs.what === "removal_asked" || e.refs.what === "removal_extended"));
    assert.equal(alerts.length, 1, "the owner's phones are told once");
    assert.equal(lines().length, 1, "the record has one line for it");
    signin.markTold(signin.tick({ record })); // as the core does, once the step is saved
    assert.equal(alerts.length, 1, "a second tick does not push again");
    assert.equal(lines().length, 1, "and does not write the line again");
    // the same for a restart AFTER the tell: nothing is told again
    access.close();
    access = openOwnerAccess(path);
    const again = createOwnerSignin({ access, pages: () => PAGES, endBefore: () => undefined, grants: () => ask, owner: { whatsapp: A, language: "en" }, alert: (t) => alerts.push(t.en), shopName: "Glow", clock });
    again.markTold(again.tick({ record })); // as the core does, once the step is saved
    assert.equal(alerts.length, 1, "a restart after the tell does not tell again (the request is 48 hours from due: no extension either)");
    assert.equal(lines().length, 1);
    access.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an owner-number change seen before a restart is told by the tick too, once", () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-third-"));
  const path = join(dir, OWNER_ACCESS_FILE);
  try {
    let access = openOwnerAccess(path);
    const q = newSetupToken(); const f0 = qr(q, T0);
    access.sync(f0, T0);
    register(access, f0, q, { owner: A, base: OWNER_BASE }, T0 + 1000);
    access.watchOwner({ owner: B, base: OWNER_BASE }, T0 + HOUR); // e.g. a phones-page call
    access.close();
    access = openOwnerAccess(path);
    const clock = fakeClock(T0 + HOUR + 60_000);
    const record = createRecord(clock);
    const alerts: string[] = [];
    const signin = createOwnerSignin({ access, pages: () => PAGES, endBefore: () => undefined, grants: () => f0, owner: { whatsapp: B, language: "en" }, alert: (t) => alerts.push(t.en), shopName: "Glow", clock });
    signin.markTold(signin.tick({ record })); // as the core does, once the step is saved
    signin.markTold(signin.tick({ record })); // as the core does, once the step is saved
    assert.equal(record.entries().filter((e) => e.refs.what === "owner_change_asked" || e.refs.what === "removal_extended").length, 1);
    assert.equal(alerts.length, 1);
    access.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the effective owner number: a function evaluated on every use, never a value fixed at start ----
const OWNER_B = { owner: B, base: OWNER_BASE };

/** One "process": a store opened on `path`, the settings object the templates read (with the effective-number getter, as start.ts makes it) and a sign-in over it. */
function boot(path: string, settingsNumber: string, clock: ReturnType<typeof fakeClock>, grants: () => OwnerGrants) {
  const access = openOwnerAccess(path);
  const settings = { owner: { whatsapp: settingsNumber, language: "en" as const } };
  const logs: string[] = [];
  const read = followLockedNumber(settings.owner, access, (l) => logs.push(l));
  const signin = createOwnerSignin({ access, pages: () => PAGES, endBefore: () => undefined, grants, owner: { whatsapp: read, language: "en" }, shopName: "Glow", clock });
  const record = createRecord(clock);
  return { access, settings, signin, record, logs, close: () => access.close() };
}

/** Lock with owner A, the Operator changes the number to B, the restart turns the override on. Returns the open "process" and the clock. */
function lockedWithA(path: string) {
  const clock = fakeClock(T0);
  const q = newSetupToken(); let file = qr(q, T0);
  let p = boot(path, A, clock, () => file);
  p.access.sync(file, T0);
  const first = register(p.access, file, q, { owner: A, base: OWNER_BASE }, T0 + 1000);
  assert.equal(p.access.boundNumber(), A.replace(/\D/gu, ""), "locked with A");
  p.close();
  // the Operator edits the number to B; the runtime restarts
  clock.set(T0 + HOUR);
  p = boot(path, B, clock, () => file);
  assert.equal(p.settings.owner.whatsapp, A, "after the restart the shop still talks to A");
  return { p, clock, first, setFile: (f: OwnerGrants) => { file = f; }, file: () => file };
}

test("a full sale: the change applies after 48 hours with NO restart, the new owner registers, a restart: the shop is bound to B, A's link session is refused, sends go to B", async () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-third-"));
  const path = join(dir, OWNER_ACCESS_FILE);
  try {
    const s = lockedWithA(path);
    let p = s.p;
    // A links a session while A is still the owner (the previous owner's "open my app" later on)
    const aWho = { owner: A, base: OWNER_BASE };
    const aLink = p.access.issue({ ...aWho, via: "whatsapp", now: s.clock.now() });
    const aSession = p.access.consume(aLink.token, aWho, s.clock.now() + 1);
    assert.ok(aSession.ok);
    p.signin.markTold(p.signin.tick({ record: p.record })); // as the core does, once the step is saved // the tick sees the settings name B: a request, and the owner (A) is told
    assert.equal(p.settings.owner.whatsapp, A, "while the request waits, messages still go to A");
    // 48 hours pass; the tick applies the change; NOBODY restarts
    s.clock.set(s.clock.now() + 49 * HOUR);
    p.signin.markTold(p.signin.tick({ record: p.record })); // as the core does, once the step is saved
    assert.equal(p.settings.owner.whatsapp, B, "the change applied: the very next send goes to the settings' number, with no restart");
    // the new owner registers with a new QR (the gate is open)
    const q2 = newSetupToken(); const f2 = qr(q2, s.clock.now()); s.setFile(f2);
    p.access.sync(f2, s.clock.now());
    const reg = register(p.access, f2, q2, { owner: p.settings.owner.whatsapp, base: OWNER_BASE }, s.clock.now() + 1000);
    assert.equal(p.access.boundNumber(), B.replace(/\D/gu, ""), "bound to B, not to the old number");
    p.signin.markTold(p.signin.tick({ record: p.record })); // as the core does, once the step is saved
    // a RESTART
    p.close();
    s.clock.set(s.clock.now() + HOUR);
    p = boot(path, B, s.clock, s.file);
    assert.equal(p.access.boundNumber(), B.replace(/\D/gu, ""));
    assert.equal(p.settings.owner.whatsapp, B, "effective number after the restart is B");
    assert.equal(p.logs.length, 0, "settings and lock agree: nothing to say");
    assert.equal(p.access.pendingRemoval(s.file(), s.clock.now()), undefined, "no request is raised again for B");
    assert.equal(p.access.check(aSession.ok ? aSession.session : "", OWNER_B, s.clock.now()), undefined, "A's link session is refused");
    assert.equal(p.access.check(aSession.ok ? aSession.session : "", aWho, s.clock.now()), undefined, "and refused when asked with A's number too");
    assert.ok(p.access.check(reg.session, OWNER_B, s.clock.now()), "B's passkey session is good");
    // owner sends go to B: the sign-in link goes to B's number, and "open my app" is heard from B only
    assert.equal(p.signin.takes({ kind: "message", message: { id: "m1", from: B, text: "open my app", at: s.clock.now(), kind: "text" } as never }), true);
    assert.equal(p.signin.takes({ kind: "message", message: { id: "m2", from: A, text: "open my app", at: s.clock.now(), kind: "text" } as never }), false, "the previous owner's 'open my app' is not the owner's");
    p.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("after Geometer's reset the number follows the settings with no restart, and a new registration binds to it", () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-third-"));
  const path = join(dir, OWNER_ACCESS_FILE);
  try {
    const s = lockedWithA(path);
    let p = s.p;
    assert.equal(p.settings.owner.whatsapp, A);
    // Geometer resets the shop's sign-in (the admin's file, read by the runtime's own reader)
    const resetQr = newSetupToken();
    const now = s.clock.now() + HOUR;
    s.clock.set(now);
    s.setFile({ schema: 1, reset: { at: iso(now), by: "Geometer", reason: "sold", setup: { sha256: setupHash(resetQr), createdAt: iso(now), expiresAt: iso(now + 15 * 60_000) } } } as OwnerGrants);
    p.signin.markTold(p.signin.tick({ record: p.record })); // as the core does, once the step is saved
    assert.equal(p.settings.owner.whatsapp, B, "the lock is gone: messages follow the settings, no restart needed");
    const reg = register(p.access, s.file(), resetQr, { owner: p.settings.owner.whatsapp, base: OWNER_BASE }, now + 1000);
    assert.equal(p.access.boundNumber(), B.replace(/\D/gu, ""));
    p.close();
    p = boot(path, B, s.clock, s.file);
    assert.equal(p.settings.owner.whatsapp, B);
    assert.ok(p.access.check(reg.session, OWNER_B, now + 2000));
    p.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the hostage case still holds: a change the owner cancels keeps every owner message on A, through restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-third-"));
  const path = join(dir, OWNER_ACCESS_FILE);
  try {
    const s = lockedWithA(path);
    let p = s.p;
    p.signin.markTold(p.signin.tick({ record: p.record })); // as the core does, once the step is saved
    assert.equal(p.access.pendingRemoval(s.file(), s.clock.now())?.kind, "owner_change");
    assert.equal(p.access.cancelRemoval(s.file(), s.clock.now() + 1000), true, "the owner cancels");
    s.clock.set(s.clock.now() + 3 * DAY);
    p.signin.markTold(p.signin.tick({ record: p.record })); // as the core does, once the step is saved
    assert.equal(p.settings.owner.whatsapp, A, "still A, however long the settings say B");
    assert.equal(p.signin.takes({ kind: "message", message: { id: "m1", from: B, text: "open my app", at: s.clock.now(), kind: "text" } as never }), false, "B cannot open the app");
    p.close();
    p = boot(path, B, s.clock, s.file);
    assert.equal(p.settings.owner.whatsapp, A, "and after a restart too");
    p.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the phones page says which number the shop is locked to (last 4 digits), in four languages", async () => {
  const { phonesPage } = await import("../owner-phones-page.ts");
  const dir = mkdtempSync(join(tmpdir(), "owner-third-"));
  try {
    const s = lockedWithA(join(dir, OWNER_ACCESS_FILE));
    const sid = s.first.id;
    const view = s.p.access.phonesView(sid, { owner: A, base: OWNER_BASE }, RP, s.file(), s.clock.now())!;
    assert.equal(view.lockedLast4, "0001");
    for (const [language, mark] of [["en", "ending 0001"], ["hi", "0001"], ["ml", "0001"], ["kn", "0001"]] as const) {
      const page = phonesPage({ base: OWNER_BASE, language, view: { ...view, language, now: s.clock.now() }, hosted: false });
      assert.ok(page.includes(mark), `${language} names the last 4 digits`);
      assert.ok(!page.includes("919800000001"), "never the whole number");
    }
    s.p.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
