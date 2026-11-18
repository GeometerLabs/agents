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
import { createOwnerSignin } from "../owner-signin.ts";
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
    signin.tick({ record });
    const lines = () => record.entries().filter((e) => e.action === "owner_session" && (e.refs.what === "removal_asked" || e.refs.what === "removal_extended"));
    assert.equal(alerts.length, 1, "the owner's phones are told once");
    assert.equal(lines().length, 1, "the record has one line for it");
    signin.tick({ record });
    assert.equal(alerts.length, 1, "a second tick does not push again");
    assert.equal(lines().length, 1, "and does not write the line again");
    // the same for a restart AFTER the tell: nothing is told again
    access.close();
    access = openOwnerAccess(path);
    const again = createOwnerSignin({ access, pages: () => PAGES, endBefore: () => undefined, grants: () => ask, owner: { whatsapp: A, language: "en" }, alert: (t) => alerts.push(t.en), shopName: "Glow", clock });
    again.tick({ record });
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
    signin.tick({ record });
    signin.tick({ record });
    assert.equal(record.entries().filter((e) => e.refs.what === "owner_change_asked" || e.refs.what === "removal_extended").length, 1);
    assert.equal(alerts.length, 1);
    access.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
