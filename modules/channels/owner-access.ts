// The owner's sign-in on the shop's page (plan item 11f, decision 44): one-time links sent to the owner's WhatsApp, and the sessions they open. Kept by the shop's
// RUNTIME, which is the authority: it alone makes a link (and sends it, owner-signin.ts), uses one up, makes a session and checks one. The public front only carries
// them (front.ts, owner-session.ts), and the approvals relay asks the runtime about a session rather than trusting the front (relay's ownerSession).
//
// Kept in a small SQLite file of its own in the runtime's data folder (OWNER_ACCESS_FILE), not in the agent's saved state: a sign-in changes no booking, and a link
// must be used up at once, in one statement, while the front waits (the agent's steps run one at a time through a queue). Only SHA-256 hashes of links and sessions
// are kept, never the tokens. What the record says about sign-ins is written by the runtime core from `owner_access` events (owner-signin.ts).
//
// The rules, each in one place here:
//   - a link is 32 random bytes, works once, for SIGNIN_LINK_MS, and a newer link replaces every unused older one (so at most one link works at a time);
//   - links are asked for at most LINK_LIMITS times (every attempt counts, sent or not), so neither the owner's phone nor the record can be flooded;
//   - a session is 32 random bytes, lasts SESSION_MS, at most MAX_SESSIONS at once (the oldest ends);
//   - a link or a session is good only for the owner number and the owner's address (`base`) it was made for: a new owner number in the settings, or a new slug,
//     ends them; and a session made before the panel's "sign out every device" (OWNER_SESSIONS_FILE) is refused.
//
// Item 11h (decisions 45 and 46): passkeys, so the owner signs in without WhatsApp. The Operator's setup QR or a code from the printed recovery card (owner-grants.ts)
// lets the owner register a passkey; later sign-ins use it. Kept here too, because a passkey sign-in makes the same session as a link:
//   - each challenge is 32 random bytes, kept as a hash, works once, for CHALLENGE_MS, for one ceremony (and a registration's for one grant);
//   - a grant is used up only when the registration finishes, in the same transaction that keeps the credential and makes the session, so a cancelled
//     fingerprint prompt does not burn the QR, and two phones racing for one QR get one passkey;
//   - a credential is this runtime's alone: every shop has its own store, so a passkey made for another shop on the same pages domain (the same RP ID) is unknown
//     here; each shop also has its own WebAuthn user id (`userId`), so registering for a second shop never replaces the first shop's passkey on the phone;
//   - a credential is good only for the owner number it was made for, and only if made after the panel's "remove the owner's passkeys" (`passkeysBefore`);
//   - wrong recovery codes are counted per shop (WRONG_CODE_LIMIT a day), on top of the front's per-address count.
//
// "No Operator holds a shop hostage" (owner's item 2). The Operator's files (owner-grants.ts) are never taken at their word once the owner holds a passkey:
//   - the shop is LOCKED once any passkey has been made since the gate last opened (`reopen_at`). A setup QR or a recovery code is good only if THIS store first saw
//     it (`grants_seen`) no later than that first passkey, so an Operator who makes a QR or a card afterwards (a changed panel, or a hand-written file) gets nothing;
//   - `passkeysBefore` is this store's own value (meta `passkeys_before`), not the file's: the file's is adopted once, for shops from before this rule. The
//     Operator's way to lock every phone out is a REQUEST (file.pendingRemoval) which this store times itself, REMOVAL_WAIT_MS from the moment it first saw it (never
//     from the time the file claims, which a hand-written file could back-date), and which the owner can cancel. Only when it applies does the gate reopen;
//   - the owner's OWN recovery codes and "add a phone" links are made and kept here (`own_codes`, `own_setups`), never in the Operator's file;
//   - Geometer's reset (file.reset, from the server admin's own file) reopens the gate at once, voids every QR, card and own code, and ends every session made before it.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { RECOVERY_CODE, RECOVERY_CODES, REMOVAL_WAIT_MS, normalCode, SETUP_MS, grantHash, grantInFile, newRecoveryCode, newSetupToken, recoveryHash, setupHash } from "./owner-grants.ts";
import type { Grant, OwnerGrants } from "./owner-grants.ts";
import { ALGORITHMS, PasskeyError, verifyAssertion, verifyRegistration } from "./webauthn.ts";
import type { StoredCredential } from "./webauthn.ts";
import type { PhoneVia } from "./owner-phones.ts";

const RECOVERY_SHAPE = (code: string): boolean => RECOVERY_CODE.test(normalCode(code));

export const OWNER_ACCESS_FILE = "owner-access.sqlite";
/** The panel's "sign out every device" (shops/<shop>/owner-sessions.json), copied by the deployer to the runtime's client folder: {schema: 1, endBefore}. */
export const OWNER_SESSIONS_FILE = "owner-sessions.json";

export const SIGNIN_LINK_MS = 10 * 60_000;
export const SESSION_MS = 30 * 24 * 60 * 60_000;
export const MAX_SESSIONS = 5;
/** Link requests per shop: three a quarter of an hour, ten a day. A person who taps twice is served; a flood is not. */
export const LINK_LIMITS = [{ max: 3, perMs: 15 * 60_000 }, { max: 10, perMs: 24 * 60 * 60_000 }] as const;

/** Item 11h: how long a passkey challenge works (the phone's prompt and the owner's finger). */
export const CHALLENGE_MS = 5 * 60_000;
/** Item 11h: wrong recovery codes a shop takes in a day before it stops looking (the front's per-address count comes first). */
export const WRONG_CODE_LIMIT = 20;
/** Item 11h: open challenges a shop keeps at most (an owner needs one at a time; a flood pushes the oldest out, never the newest). */
export const CHALLENGES_KEPT = 300;
/** Item 11h: the most passkeys a shop's owner keeps (a phone, a new phone, a tablet ...). The oldest unused one goes first. */
export const MAX_PASSKEYS = 8;
/** A grant's state, for the setup page: what the file says, and whether this runtime has seen it used. */
export type GrantState = "valid" | "used" | "expired" | "unknown";
/** What the relying party is: the owner view's origin and its host (owner-signin.ts reads them from the pages file's ownerBase). */
export interface RelyingParty { rpId: string; origin: string }
/** A browser's registration, as the page posts it (base64url). */
export interface RegistrationResponse { clientDataJSON: string; attestationObject: string }
/** A browser's assertion, as the page posts it (base64url). `id` is the credential's id; `userHandle` the user id it was made for, when the phone sends it. */
export interface AssertionResponse { id: string; clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string }

/** 32 random bytes in base64url: a link's or a session's token. */
export const ACCESS_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
/** The headers the front passes them in, to the runtime (and a session to the relay). */
export const OWNER_SESSION_HEADER = "x-owner-session";
export const OWNER_SIGNIN_HEADER = "x-owner-signin";

export type LinkState = "valid" | "used" | "expired" | "replaced" | "unknown";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const linkHash = (token: string): string => sha(`owner-signin:${token}`);
const sessionHash = (token: string): string => sha(`owner-session:${token}`);
/** The owner's number, kept only as a hash: enough to tell that the settings now name someone else. */
export const ownerKey = (number: string): string => sha(`owner-number:${number.replace(/\D/gu, "")}`);
const newToken = (): string => randomBytes(32).toString("base64url");
/** A short id for the record and the panel (never the token, never its hash). */
const newId = (): string => randomBytes(6).toString("hex");

/** Who the owner is now and where their view is: read fresh by the caller on every call, so a change in the settings or the slug takes effect at once. */
export interface OwnerNow { owner: string; base: string }

/** The panel's "sign out every device": sessions made before this moment are refused. Undefined: no such file (or unreadable: it never widens access). */
export function readEndBefore(file: string): number | undefined {
  try {
    const f = JSON.parse(readFileSync(file, "utf8")) as { schema?: unknown; endBefore?: unknown };
    const at = f.schema === 1 && typeof f.endBefore === "string" ? Date.parse(f.endBefore) : Number.NaN;
    return Number.isFinite(at) ? at : undefined;
  } catch { return undefined; }
}

export function openOwnerAccess(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS attempts (at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
      state TEXT NOT NULL CHECK (state IN ('issued', 'used', 'replaced', 'unsent')), via TEXT NOT NULL, owner_key TEXT NOT NULL, base TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ended_at INTEGER, ended_why TEXT,
      owner_key TEXT NOT NULL, base TEXT NOT NULL, link_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY, cred_id TEXT NOT NULL UNIQUE, jwk TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL, backed_up INTEGER NOT NULL,
      made_at INTEGER NOT NULL, used_at INTEGER, removed_at INTEGER, removed_why TEXT, owner_key TEXT NOT NULL, rp_id TEXT NOT NULL, via TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('register', 'signin')), grant_hash TEXT, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS grants_used (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, used_at INTEGER NOT NULL, passkey_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wrong_codes (at INTEGER NOT NULL);
    -- the Operator's QR and card hashes as THIS store first saw them: the gate (see the header) compares first_seen with the first passkey
    CREATE TABLE IF NOT EXISTS grants_seen (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, first_seen INTEGER NOT NULL, voided_at INTEGER);
    -- the owner's own recovery codes (hashes only, made from the owner's app) and "add a phone" links; the Operator's file never holds these
    CREATE TABLE IF NOT EXISTS own_codes (hash TEXT PRIMARY KEY, made_at INTEGER NOT NULL, voided_at INTEGER);
    CREATE TABLE IF NOT EXISTS own_setups (hash TEXT PRIMARY KEY, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, voided_at INTEGER);
    -- the Operator's removal requests as this store timed them: seen_at is when WE first saw the request, effective_at = seen_at + REMOVAL_WAIT_MS
    CREATE TABLE IF NOT EXISTS removals (
      asked_at TEXT PRIMARY KEY, asked_by TEXT NOT NULL, seen_at INTEGER NOT NULL, effective_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'cancelled', 'applied', 'withdrawn')), at INTEGER NOT NULL
    );
    -- what each phone (a passkey, or a session made by a link) has been told about: new passkeys made after "through" are announced to it until it dismisses them
    CREATE TABLE IF NOT EXISTS phone_seen (subject TEXT PRIMARY KEY, through INTEGER NOT NULL);
  `);
  // A safe migration for a store made before the phones list: the label (coarse platform and browser, owner-phones.ts) is new; an old row keeps NULL and shows as "a phone".
  if (!(db.prepare("PRAGMA table_info(passkeys)").all() as { name: string }[]).some((c) => c.name === "label")) db.exec("ALTER TABLE passkeys ADD COLUMN label TEXT");
  type LinkRow = { id: string; made_at: number; expires_at: number; state: string; owner_key: string; base: string };
  type SessionRow = { id: string; link_id: string; made_at: number; expires_at: number; ended_at: number | null; owner_key: string; base: string };
  const linkByHash = db.prepare("SELECT id, made_at, expires_at, state, owner_key, base FROM links WHERE hash = ?");
  const sessionByHash = db.prepare("SELECT id, link_id, made_at, expires_at, ended_at, owner_key, base FROM sessions WHERE hash = ?");

  /** A new session for the browser that just proved it is the owner's (a link used up, or a passkey). Returns the token ONCE. */
  function startSession(ownerKeyValue: string, baseValue: string, from: string, now: number): { session: string; id: string; expiresAt: number } {
    const session = newToken();
    const id = newId();
    const expiresAt = now + SESSION_MS;
    db.prepare("INSERT INTO sessions (id, hash, made_at, expires_at, owner_key, base, link_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, sessionHash(session), now, expiresAt, ownerKeyValue, baseValue, from);
    // at most MAX_SESSIONS live at once: the oldest ends, so a phone lost long ago does not stay signed in for ever behind newer ones
    const live = db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL AND expires_at > ? ORDER BY made_at DESC").all(now) as { id: string }[];
    for (const old of live.slice(MAX_SESSIONS)) db.prepare("UPDATE sessions SET ended_at = ?, ended_why = 'too_many' WHERE id = ?").run(now, old.id);
    return { session, id, expiresAt };
  }

  // ---- item 11h: passkeys ----
  type PasskeyRow = { id: string; cred_id: string; jwk: string; alg: number; sign_count: number; backed_up: number; made_at: number; owner_key: string; rp_id: string };
  const challengeHash = (c: string): string => sha(`owner-challenge:${c}`);
  /** This shop's WebAuthn user id: 16 random bytes made once, so a phone keeps one passkey per shop even though every shop shares the RP ID. */
  function userId(): string {
    const have = (db.prepare("SELECT value FROM meta WHERE name = 'webauthn_user'").get() as { value: string } | undefined)?.value;
    if (have) return have;
    const made = randomBytes(16).toString("base64url");
    db.prepare("INSERT INTO meta (name, value) VALUES ('webauthn_user', ?) ON CONFLICT(name) DO NOTHING").run(made);
    return (db.prepare("SELECT value FROM meta WHERE name = 'webauthn_user'").get() as { value: string }).value;
  }
  /**
   * A fresh challenge for one ceremony, kept as a hash; the challenge itself goes to the page once. The store keeps at most CHALLENGES_KEPT open ones: past that
   * the OLDEST open ones go, never the new one, so a flood cannot grow the file and cannot lock the owner out either (the owner's own challenge is always the newest,
   * and lives only for the seconds their fingerprint takes).
   */
  function newChallenge(kind: "register" | "signin", now: number, grant?: string): string {
    db.prepare("DELETE FROM challenges WHERE expires_at <= ?").run(now - 24 * 60 * 60_000);
    db.prepare(`DELETE FROM challenges WHERE hash IN (SELECT hash FROM challenges WHERE used_at IS NULL ORDER BY made_at DESC LIMIT -1 OFFSET ?)`).run(CHALLENGES_KEPT - 1);
    const c = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO challenges (hash, kind, grant_hash, made_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(challengeHash(c), kind, grant ?? null, now, now + CHALLENGE_MS);
    return c;
  }
  /** The challenge a browser's client data names, if it is one of ours for this ceremony, unused and in time. */
  function challengeOf(clientDataJSON: Buffer, kind: "register" | "signin", now: number, grant?: string): string | undefined {
    let c: unknown;
    try { c = (JSON.parse(clientDataJSON.toString("utf8")) as { challenge?: unknown }).challenge; } catch { return undefined; }
    if (typeof c !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(c)) return undefined;
    const r = db.prepare("SELECT kind, grant_hash, expires_at, used_at FROM challenges WHERE hash = ?").get(challengeHash(c)) as { kind: string; grant_hash: string | null; expires_at: number; used_at: number | null } | undefined;
    if (!r || r.kind !== kind || r.used_at !== null || r.expires_at <= now || (grant !== undefined && r.grant_hash !== grant)) return undefined;
    return c;
  }
  /** Is a passkey row good now for this owner, on this RP ID, made after the panel's "remove the owner's passkeys"? */
  const passkeyGood = (r: PasskeyRow & { removed_at: number | null }, who: OwnerNow, rp: RelyingParty, passkeysBefore?: number): boolean =>
    r.removed_at === null && r.owner_key === ownerKey(who.owner) && r.rp_id === rp.rpId && (passkeysBefore === undefined || r.made_at >= passkeysBefore);
  const b64 = (s: unknown, max: number): Buffer | undefined => (typeof s === "string" && s.length > 0 && s.length <= max && /^[A-Za-z0-9_-]+$/u.test(s) ? Buffer.from(s, "base64url") : undefined);

  // ---- who controls the owner's sign-in: the gate, the requests, the reset (see the header) ----
  const metaNum = (name: string): number | undefined => { const r = db.prepare("SELECT value FROM meta WHERE name = ?").get(name) as { value: string } | undefined; return r ? Number(r.value) : undefined; };
  const setMeta = (name: string, v: number): void => { db.prepare("INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(name, String(v)); };
  const raiseMeta = (name: string, v: number): void => { if (v > (metaNum(name) ?? 0)) setMeta(name, v); };
  /** When the shop got locked: the first passkey made since the gate last opened (rows the owner or a removal later took away still count: the owner held one). */
  const lockAt = (): number | undefined => {
    const r = db.prepare("SELECT min(made_at) AS m FROM passkeys WHERE made_at >= ?").get(metaNum("reopen_at") ?? 0) as { m: number | null };
    return r.m ?? undefined;
  };
  const endSessionsBefore = (t: number, now: number, why: string): void => { db.prepare("UPDATE sessions SET ended_at = ?, ended_why = ? WHERE ended_at IS NULL AND made_at < ?").run(now, why, t); };
  /** Things the runtime should write in the record once (the tick does), found while reading the files. */
  type Note = { what: "reset"; at: number; reason: string; by: string } | { what: "removal_asked"; askedBy: string; askedAt: string; effectiveAt: number } | { what: "removal_applied"; at: number };
  const notes: Note[] = [];
  /** Remember the QR and the card hashes the file holds now, the first time this store sees each. */
  const noteSeen = (file: OwnerGrants | undefined, firstSeen: number): void => {
    const ins = db.prepare("INSERT OR IGNORE INTO grants_seen (hash, kind, first_seen) VALUES (?, ?, ?)");
    if (file?.setup) ins.run(file.setup.sha256, "setup", firstSeen);
    for (const c of file?.recovery?.codes ?? []) ins.run(c, "recovery", firstSeen);
  };
  /**
   * Read the Operator's and the admin's files into this store's own state. Called by everything that depends on them, so no path can skip it. Idempotent. Order: adopt a
   * shop from before this rule, apply Geometer's reset, remember the QR and card hashes, time the Operator's request, apply a request whose wait is over.
   */
  function reconcile(file: OwnerGrants | undefined, now: number): void {
    if (metaNum("adopted") === undefined) {
      const first = lockAt();
      // a shop whose owner already holds a passkey keeps the QR and card that exist today (first seen "at the first passkey"), and the file's own passkeysBefore, once
      if (file !== undefined || first === undefined) {
        if (file?.passkeysBefore) setMeta("passkeys_before", Date.parse(file.passkeysBefore));
        noteSeen(file, first ?? now);
        setMeta("adopted", 1);
      }
    }
    const reset = file?.reset;
    if (reset && Date.parse(reset.at) > (metaNum("reset_at") ?? 0)) {
      const at = Date.parse(reset.at);
      db.exec("BEGIN IMMEDIATE");
      try {
        setMeta("reset_at", at); raiseMeta("passkeys_before", at); raiseMeta("reopen_at", at);
        // every QR, card, own code and "add a phone" link made before the reset stops; the QR the admin makes with the reset is first seen after it and so works
        db.prepare("UPDATE grants_seen SET voided_at = ? WHERE first_seen < ? AND voided_at IS NULL").run(at, at);
        db.prepare("UPDATE own_codes SET voided_at = ? WHERE voided_at IS NULL").run(at);
        db.prepare("UPDATE own_setups SET voided_at = ? WHERE voided_at IS NULL").run(at);
        db.prepare("UPDATE removals SET state = 'cancelled', at = ? WHERE state = 'pending'").run(at);
        endSessionsBefore(at, now, "reset");
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      notes.push({ what: "reset", at, reason: reset.reason, by: reset.by });
    }
    noteSeen(file, now);
    const p = file?.pendingRemoval;
    if (p && !db.prepare("SELECT 1 FROM removals WHERE asked_at = ?").get(p.askedAt) && lockAt() !== undefined && Date.parse(p.askedAt) > (metaNum("reset_at") ?? 0)) {
      // a request the owner has no way to have seen yet starts its wait NOW, whatever time the file says: a back-dated request must not apply at once
      db.prepare("UPDATE removals SET state = 'withdrawn', at = ? WHERE state = 'pending'").run(now);
      const effectiveAt = now + REMOVAL_WAIT_MS;
      db.prepare("INSERT INTO removals (asked_at, asked_by, seen_at, effective_at, state, at) VALUES (?, ?, ?, ?, 'pending', ?)").run(p.askedAt, p.askedBy, now, effectiveAt, now);
      notes.push({ what: "removal_asked", askedBy: p.askedBy, askedAt: p.askedAt, effectiveAt });
    }
    for (const due of db.prepare("SELECT asked_at, effective_at FROM removals WHERE state = 'pending' AND effective_at <= ?").all(now) as { asked_at: string; effective_at: number }[]) {
      // nobody cancelled in time: every passkey made before the moment stops, every session made before it ends, and the gate opens for a new QR
      db.prepare("UPDATE removals SET state = 'applied', at = ? WHERE asked_at = ?").run(due.effective_at, due.asked_at);
      raiseMeta("passkeys_before", due.effective_at); raiseMeta("reopen_at", due.effective_at);
      endSessionsBefore(due.effective_at, now, "removal");
      notes.push({ what: "removal_applied", at: due.effective_at });
    }
  }
  /** May this QR or card hash work now? Seen by this store, not voided, not before the gate last opened, and (once locked) no later than the first passkey. */
  function grantAllowed(hash: string): boolean {
    const r = db.prepare("SELECT first_seen, voided_at FROM grants_seen WHERE hash = ?").get(hash) as { first_seen: number; voided_at: number | null } | undefined;
    if (!r || r.voided_at !== null || r.first_seen < (metaNum("reopen_at") ?? 0)) return false;
    const locked = lockAt();
    return locked === undefined || r.first_seen <= locked;
  }
  /** A session's subject for the "new phone" banner, and the passkey it was made by (if any). */
  function subjectOf(sessionId: string): { subject: string; passkey?: string; madeAt: number } | undefined {
    const r = db.prepare("SELECT link_id, made_at FROM sessions WHERE id = ?").get(sessionId) as { link_id: string; made_at: number } | undefined;
    if (!r) return undefined;
    if (r.link_id.startsWith("pk-")) { const pk = db.prepare("SELECT made_at FROM passkeys WHERE id = ?").get(r.link_id.slice(3)) as { made_at: number } | undefined; return pk ? { subject: `pk:${r.link_id.slice(3)}`, passkey: r.link_id.slice(3), madeAt: pk.made_at } : { subject: `s:${sessionId}`, madeAt: r.made_at }; }
    return { subject: `s:${sessionId}`, madeAt: r.made_at };
  }
  type PhoneRow = PasskeyRow & { removed_at: number | null; used_at: number | null; via: string; label: string | null };
  const goodPhones = (who: OwnerNow, rp: RelyingParty, passkeysBefore?: number): PhoneRow[] =>
    (db.prepare("SELECT * FROM passkeys WHERE removed_at IS NULL ORDER BY made_at").all() as PhoneRow[]).filter((r) => passkeyGood(r, who, rp, passkeysBefore));

  const api = {
    /** Read the files into this store (see `reconcile`); the runtime's tick calls it so a request or a reset is seen even when nobody opens a page. */
    sync(file: OwnerGrants | undefined, now: number): void { reconcile(file, now); },
    /** What `sync` found that the record should say, once each. */
    takeNotes(): Note[] { return notes.splice(0); },
    /** The moment before which no passkey works: this store's own, never the Operator's file's (see the header). */
    passkeysBefore(file: OwnerGrants | undefined, now: number): number | undefined { reconcile(file, now); return metaNum("passkeys_before"); },
    /** Has the owner a passkey since the gate last opened? Then the Operator's QR and card are closed, and "remove the passkeys" is a request. */
    locked(file: OwnerGrants | undefined, now: number): boolean { reconcile(file, now); return lockAt() !== undefined; },
    /** The Operator's pending request as this store timed it, if one is waiting. */
    pendingRemoval(file: OwnerGrants | undefined, now: number): { askedBy: string; askedAt: string; seenAt: number; effectiveAt: number } | undefined {
      reconcile(file, now);
      const r = db.prepare("SELECT asked_by, asked_at, seen_at, effective_at FROM removals WHERE state = 'pending' ORDER BY seen_at DESC LIMIT 1").get() as { asked_by: string; asked_at: string; seen_at: number; effective_at: number } | undefined;
      return r ? { askedBy: r.asked_by, askedAt: r.asked_at, seenAt: r.seen_at, effectiveAt: r.effective_at } : undefined;
    },
    /** The owner cancels the Operator's request. True when one was waiting. The same request, asked again, is not heard again (a new request needs a new `askedAt`). */
    cancelRemoval(file: OwnerGrants | undefined, now: number): boolean {
      reconcile(file, now);
      return Number(db.prepare("UPDATE removals SET state = 'cancelled', at = ? WHERE state = 'pending'").run(now).changes) > 0;
    },

    /**
     * Count one request for a link, if the shop's limits allow it. Every attempt counts, whether or not a link then goes out (a closed WhatsApp window), so the
     * record's lines about links are bounded too. Old attempts are dropped as it goes.
     */
    tryAttempt(now: number): boolean {
      db.prepare("DELETE FROM attempts WHERE at <= ?").run(now - LINK_LIMITS[1].perMs);
      for (const w of LINK_LIMITS) {
        const n = (db.prepare("SELECT count(*) AS n FROM attempts WHERE at > ?").get(now - w.perMs) as { n: number }).n;
        if (n >= w.max) return false;
      }
      db.prepare("INSERT INTO attempts (at) VALUES (?)").run(now);
      return true;
    },

    /** A new link for the owner as they are now. Every unused older link stops working (`replaced`): one link works at a time. Returns the token ONCE. */
    issue(o: OwnerNow & { via: "page" | "whatsapp"; now: number }): { id: string; token: string; expiresAt: number } {
      const token = newToken();
      const id = newId();
      const expiresAt = o.now + SIGNIN_LINK_MS;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE links SET state = 'replaced' WHERE state = 'issued'").run();
        db.prepare("INSERT INTO links (id, hash, made_at, expires_at, state, via, owner_key, base) VALUES (?, ?, ?, ?, 'issued', ?, ?, ?)").run(id, linkHash(token), o.now, expiresAt, o.via, ownerKey(o.owner), o.base);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return { id, token, expiresAt };
    },

    /** The send failed before anything went out: the link can never be used (nobody has it). */
    unsent(id: string): void { db.prepare("UPDATE links SET state = 'unsent' WHERE id = ? AND state = 'issued'").run(id); },

    /** What a link is now, for the page that shows its button; nothing is used up. A link for another owner or another address is `unknown`. */
    linkState(token: string, who: OwnerNow, now: number): LinkState {
      if (!ACCESS_TOKEN.test(token)) return "unknown";
      const r = linkByHash.get(linkHash(token)) as LinkRow | undefined;
      if (!r || r.owner_key !== ownerKey(who.owner) || r.base !== who.base || r.state === "unsent") return "unknown";
      if (r.state === "used" || r.state === "replaced") return r.state;
      return r.expires_at > now ? "valid" : "expired";
    },

    /**
     * Use a link up and open a session for the browser that opened it. The link turns from `issued` to `used` in ONE statement that also checks it has not run out,
     * so two presses (two tabs, a scanner and a person) can never both get a session. Returns the session token ONCE.
     */
    consume(token: string, who: OwnerNow, now: number): { ok: true; session: string; id: string; expiresAt: number } | { ok: false; state: Exclude<LinkState, "valid"> } {
      const state = api.linkState(token, who, now);
      if (state !== "valid") return { ok: false, state };
      const r = linkByHash.get(linkHash(token)) as LinkRow;
      const used = db.prepare("UPDATE links SET state = 'used', used_at = ? WHERE id = ? AND state = 'issued' AND expires_at > ?").run(now, r.id, now);
      if (Number(used.changes) !== 1) return { ok: false, state: "used" };
      return { ok: true, ...startSession(r.owner_key, r.base, r.id, now) };
    },

    /** Is this session good now, for this owner at this address, made after the panel's last "sign out every device"? Its short id when it is. */
    check(token: string, who: OwnerNow, now: number, endBefore?: number): { id: string } | undefined {
      if (!ACCESS_TOKEN.test(token)) return undefined;
      const r = sessionByHash.get(sessionHash(token)) as SessionRow | undefined;
      if (!r || r.ended_at !== null || r.expires_at <= now) return undefined;
      if (r.owner_key !== ownerKey(who.owner) || r.base !== who.base) return undefined; // another owner now, or the shop's page moved
      if (endBefore !== undefined && r.made_at < endBefore) return undefined;
      return { id: r.id };
    },

    /**
     * Is this session good now AND was it made by a PASSKEY sign-in (or a passkey's first registration), not by a link? The owner's limits page needs it to loosen a
     * limit: a link on WhatsApp can be opened by whoever holds the phone, a passkey is the owner's own finger or face (decision 27: outside the chat).
     */
    checkPasskey(token: string, who: OwnerNow, now: number, endBefore?: number): { id: string } | undefined {
      const ok = this.check(token, who, now, endBefore);
      if (!ok) return undefined;
      const r = sessionByHash.get(sessionHash(token)) as SessionRow | undefined;
      return r && r.link_id.startsWith("pk-") ? ok : undefined;
    },

    /** The owner signs out on this browser: the session ends. Its short id, or undefined when there was none live. */
    end(token: string, now: number): string | undefined {
      if (!ACCESS_TOKEN.test(token)) return undefined;
      const r = sessionByHash.get(sessionHash(token)) as SessionRow | undefined;
      if (!r || r.ended_at !== null) return undefined;
      db.prepare("UPDATE sessions SET ended_at = ?, ended_why = 'signed_out' WHERE id = ?").run(now, r.id);
      return r.id;
    },

    /**
     * The panel's "sign out every device" seen for the first time: every session made before it is marked ended, and the moment is remembered so it is said once.
     * Returns how many ended, or undefined when this moment was already handled. (check() refuses those sessions anyway; this is for the record.)
     */
    endAllBefore(endBefore: number, now: number): number | undefined {
      const seen = (db.prepare("SELECT value FROM meta WHERE name = 'end_before'").get() as { value: string } | undefined)?.value;
      if (seen !== undefined && Number(seen) >= endBefore) return undefined;
      const r = db.prepare("UPDATE sessions SET ended_at = ?, ended_why = 'panel' WHERE ended_at IS NULL AND made_at < ?").run(now, endBefore);
      db.prepare("INSERT INTO meta (name, value) VALUES ('end_before', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(String(endBefore));
      return Number(r.changes);
    },

    // ---- item 11h: passkeys ------------------------------------------------------------------------------------------------------------------------------

    /** A grant (the setup QR's token or a recovery code) as it stands now: the panel's file, and this store's memory of grants used. */
    grantState(g: Grant, file: OwnerGrants | undefined, now: number): GrantState {
      reconcile(file, now);
      const hash = grantHash(g);
      const used = !!db.prepare("SELECT 1 FROM grants_used WHERE hash = ?").get(hash);
      // the owner's own "add a phone" link and own codes live here, not in the Operator's file, so the gate does not apply to them
      if (g.kind === "setup") {
        const own = db.prepare("SELECT expires_at, voided_at FROM own_setups WHERE hash = ?").get(hash) as { expires_at: number; voided_at: number | null } | undefined;
        if (own) return own.voided_at !== null ? "unknown" : used ? "used" : own.expires_at > now ? "valid" : "expired";
      } else if (RECOVERY_SHAPE(g.code)) {
        const own = db.prepare("SELECT voided_at FROM own_codes WHERE hash = ?").get(hash) as { voided_at: number | null } | undefined;
        if (own) return own.voided_at !== null ? "unknown" : used ? "used" : "valid";
      }
      const inFile = grantInFile(g, file, now);
      if (inFile === "unknown" || !grantAllowed(hash)) return "unknown";
      return used ? "used" : inFile;
    },

    /** Item 11h: too many wrong recovery codes for this shop today? (Each wrong one counts; a right one does not.) */
    codesLocked(now: number): boolean {
      db.prepare("DELETE FROM wrong_codes WHERE at <= ?").run(now - 24 * 60 * 60_000);
      return (db.prepare("SELECT count(*) AS n FROM wrong_codes").get() as { n: number }).n >= WRONG_CODE_LIMIT;
    },
    noteWrongCode(now: number): void { db.prepare("INSERT INTO wrong_codes (at) VALUES (?)").run(now); },

    /**
     * What the setup page's script hands to navigator.credentials.create: a challenge for this grant, the RP, this shop's user id, and the passkeys the owner
     * already has here (so a phone that has one is not asked to make a second). Nothing is used up.
     */
    registrationOptions(g: Grant, file: OwnerGrants | undefined, who: OwnerNow, rp: RelyingParty, shopName: string, now: number): { ok: true; options: Record<string, unknown> } | { ok: false; state: Exclude<GrantState, "valid"> } {
      const state = api.grantState(g, file, now);
      if (state !== "valid") return { ok: false, state };
      const have = (db.prepare("SELECT cred_id FROM passkeys WHERE removed_at IS NULL AND owner_key = ? AND rp_id = ?").all(ownerKey(who.owner), rp.rpId) as { cred_id: string }[]).map((r) => r.cred_id);
      let challenge: string;
      try { challenge = newChallenge("register", now, grantHash(g)); } catch (e) { if (e instanceof PasskeyError) return { ok: false, state: "locked" as never }; throw e; }
      return {
        ok: true,
        options: {
          challenge,
          rp: { id: rp.rpId, name: shopName },
          user: { id: userId(), name: shopName, displayName: shopName },
          pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: "public-key", alg })),
          authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
          attestation: "none", timeout: CHALLENGE_MS,
          excludeCredentials: have.map((id) => ({ type: "public-key", id })),
        },
      };
    },

    /**
     * Finish a registration: the browser's answer checked (webauthn.ts) against the challenge made for THIS grant, then, in one transaction, the challenge and the
     * grant used up, the credential kept and a session made for this browser. Returns the session token ONCE.
     */
    register(g: Grant, file: OwnerGrants | undefined, who: OwnerNow, rp: RelyingParty, response: RegistrationResponse, now: number, label = ""):
      { ok: true; session: string; id: string; expiresAt: number; passkey: string } | { ok: false; state: Exclude<GrantState, "valid"> | "refused"; why?: string } {
      const state = api.grantState(g, file, now);
      if (state !== "valid") return { ok: false, state };
      const clientData = b64(response?.clientDataJSON, 4096); const attestation = b64(response?.attestationObject, 16_384);
      if (!clientData || !attestation) return { ok: false, state: "refused", why: "The browser's answer is not complete." };
      const gh = grantHash(g);
      // how this phone got in, for the owner's list: their own app's "add a phone" link, Geometer's reset QR, the Operator's QR, or a recovery code (the card's or their own)
      const via: PhoneVia = g.kind === "recovery" ? "recovery"
        : db.prepare("SELECT 1 FROM own_setups WHERE hash = ?").get(gh) ? "own_phone"
        : file?.reset && file.setup && Date.parse(file.setup.createdAt) >= Date.parse(file.reset.at) ? "reset" : "setup";
      const challenge = challengeOf(clientData, "register", now, gh);
      if (!challenge) return { ok: false, state: "refused", why: "The answer is for no challenge of this setup that is still open." };
      let cred: StoredCredential;
      try { cred = verifyRegistration({ clientDataJSON: clientData, attestationObject: attestation }, { challenge, ...rp }); }
      catch (e) { if (e instanceof PasskeyError) return { ok: false, state: "refused", why: e.message }; throw e; }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (Number(db.prepare("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL").run(now, challengeHash(challenge)).changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, state: "refused", why: "That challenge was used already." }; }
        if (db.prepare("SELECT 1 FROM grants_used WHERE hash = ?").get(gh)) { db.exec("ROLLBACK"); return { ok: false, state: "used" }; }
        if (db.prepare("SELECT 1 FROM passkeys WHERE cred_id = ?").get(cred.id)) { db.exec("ROLLBACK"); return { ok: false, state: "refused", why: "This passkey is already kept here." }; }
        const id = newId();
        db.prepare("INSERT INTO passkeys (id, cred_id, jwk, alg, sign_count, backed_up, made_at, owner_key, rp_id, via, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, cred.id, JSON.stringify(cred.jwk), cred.alg, cred.signCount, cred.backedUp ? 1 : 0, now, ownerKey(who.owner), rp.rpId, via, label ? label.slice(0, 60) : null);
        db.prepare("INSERT INTO grants_used (hash, kind, used_at, passkey_id) VALUES (?, ?, ?, ?)").run(gh, g.kind, now, id);
        // at most MAX_PASSKEYS: the one used longest ago goes
        const kept = db.prepare("SELECT id FROM passkeys WHERE removed_at IS NULL ORDER BY coalesce(used_at, made_at) DESC").all() as { id: string }[];
        for (const old of kept.slice(MAX_PASSKEYS)) db.prepare("UPDATE passkeys SET removed_at = ?, removed_why = 'too_many' WHERE id = ?").run(now, old.id);
        const s = startSession(ownerKey(who.owner), who.base, `pk-${id}`, now);
        db.exec("COMMIT");
        return { ok: true, ...s, passkey: id };
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },

    /**
     * What the sign-in page's script hands to navigator.credentials.get: a challenge and this shop's passkeys for the owner (allowCredentials), so the phone
     * offers this shop's passkey and not another shop's on the same pages domain. `count` 0: the page does not offer the passkey button.
     */
    signinOptions(who: OwnerNow, rp: RelyingParty, now: number, passkeysBefore?: number): { count: number; options?: Record<string, unknown> } {
      const rows = (db.prepare("SELECT * FROM passkeys WHERE removed_at IS NULL").all() as (PasskeyRow & { removed_at: number | null })[]).filter((r) => passkeyGood(r, who, rp, passkeysBefore));
      if (rows.length === 0) return { count: 0 };
      let challenge: string;
      try { challenge = newChallenge("signin", now); } catch (e) { if (e instanceof PasskeyError) return { count: rows.length }; throw e; }
      return { count: rows.length, options: { challenge, rpId: rp.rpId, userVerification: "required", timeout: CHALLENGE_MS, allowCredentials: rows.map((r) => ({ type: "public-key", id: r.cred_id })) } };
    },

    /**
     * Finish a sign-in: a challenge of ours, unused and in time; a passkey this shop keeps for this owner (another shop's is unknown here); this shop's user id
     * when the phone names one; the signature and the counter (webauthn.ts). Then, in one transaction, the challenge used up, the counter moved and a session made.
     */
    signin(response: AssertionResponse, who: OwnerNow, rp: RelyingParty, now: number, passkeysBefore?: number): { ok: true; session: string; id: string; expiresAt: number; passkey: string } | { ok: false; why: string } {
      const clientData = b64(response?.clientDataJSON, 4096); const authData = b64(response?.authenticatorData, 4096); const signature = b64(response?.signature, 1024);
      if (!clientData || !authData || !signature || typeof response?.id !== "string" || !/^[A-Za-z0-9_-]{16,1400}$/u.test(response.id)) return { ok: false, why: "The browser's answer is not complete." };
      const challenge = challengeOf(clientData, "signin", now);
      if (!challenge) return { ok: false, why: "The answer is for no sign-in challenge that is still open." };
      const row = db.prepare("SELECT * FROM passkeys WHERE cred_id = ?").get(response.id) as (PasskeyRow & { removed_at: number | null }) | undefined;
      if (!row || !passkeyGood(row, who, rp, passkeysBefore)) return { ok: false, why: "This passkey is not one of this shop's." };
      if (response.userHandle !== undefined && response.userHandle !== "" && response.userHandle !== userId()) return { ok: false, why: "This passkey was made for another shop." };
      let next: { signCount: number };
      try { next = verifyAssertion({ clientDataJSON: clientData, authenticatorData: authData, signature }, { id: row.cred_id, jwk: JSON.parse(row.jwk), alg: row.alg as StoredCredential["alg"], signCount: row.sign_count, backedUp: row.backed_up === 1 }, { challenge, ...rp }); }
      catch (e) { if (e instanceof PasskeyError) return { ok: false, why: e.message }; throw e; }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (Number(db.prepare("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL").run(now, challengeHash(challenge)).changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, why: "That challenge was used already." }; }
        // the counter moves only from the value just checked: two answers racing with the same counter cannot both pass
        if (Number(db.prepare("UPDATE passkeys SET sign_count = ?, used_at = ? WHERE id = ? AND sign_count = ?").run(next.signCount, now, row.id, row.sign_count).changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, why: "The passkey's counter moved meanwhile." }; }
        const s = startSession(row.owner_key, who.base, `pk-${row.id}`, now);
        db.exec("COMMIT");
        return { ok: true, ...s, passkey: row.id };
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },

    /** The owner's passkeys here, for their page (when each was made and last used). No key, no id the browser knows. */
    passkeys(who: OwnerNow, rp: RelyingParty, passkeysBefore?: number): { id: string; madeAt: number; usedAt?: number; via: string; label?: string }[] {
      return goodPhones(who, rp, passkeysBefore).map((r) => ({ id: r.id, madeAt: r.made_at, ...(r.used_at !== null ? { usedAt: r.used_at } : {}), via: r.via, ...(r.label ? { label: r.label } : {}) }));
    },

    // ---- "Phones that can open your shop": the owner's own view and control (owner's item 2). Every call names a session this store has already checked. ----

    /**
     * What the owner's phones page and the banners need: each phone (this one marked), the phones made since this phone last dismissed the news, the Operator's request
     * if one waits, and whether the owner holds their own recovery codes. `passkeySession`: this session came from a passkey (own codes and "add a phone" need that).
     */
    phonesView(sessionId: string, who: OwnerNow, rp: RelyingParty, file: OwnerGrants | undefined, now: number): PhonesView | undefined {
      reconcile(file, now);
      const me = subjectOf(sessionId);
      if (!me) return undefined;
      const pb = metaNum("passkeys_before");
      const phones = goodPhones(who, rp, pb);
      const through = (db.prepare("SELECT through FROM phone_seen WHERE subject = ?").get(me.subject) as { through: number } | undefined)?.through ?? me.madeAt;
      const removal = api.pendingRemoval(file, now);
      const codes = db.prepare("SELECT max(made_at) AS at FROM own_codes WHERE voided_at IS NULL").get() as { at: number | null };
      const row = (r: PhoneRow) => ({ id: r.id, madeAt: r.made_at, ...(r.used_at !== null ? { usedAt: r.used_at } : {}), via: r.via, ...(r.label ? { label: r.label } : {}) });
      return {
        phones: phones.map((r) => ({ ...row(r), mine: r.id === me.passkey })),
        announce: phones.filter((r) => r.made_at > through && r.id !== me.passkey).map(row),
        ...(removal ? { removal } : {}),
        ownCodesAt: codes.at ?? undefined, passkeySession: me.passkey !== undefined,
      };
    },

    /** This phone has seen the news about every phone made so far: its banner goes (a phone made later brings it back). */
    dismiss(sessionId: string): void {
      const me = subjectOf(sessionId);
      if (!me) return;
      const latest = (db.prepare("SELECT max(made_at) AS at FROM passkeys").get() as { at: number | null }).at ?? me.madeAt;
      db.prepare("INSERT INTO phone_seen (subject, through) VALUES (?, ?) ON CONFLICT(subject) DO UPDATE SET through = max(through, excluded.through)").run(me.subject, latest);
    },

    /**
     * The owner removes one phone: it stops working at once, and so does every session it made. The LAST phone is refused unless `confirmLast` (the page asks twice, in
     * plain words, before it sends it): then the owner holds nothing but their own recovery codes and the Operator's request.
     */
    removePhone(sessionId: string, phoneId: string, who: OwnerNow, rp: RelyingParty, file: OwnerGrants | undefined, now: number, confirmLast: boolean):
      { ok: true; removed: { id: string; label?: string }; wasLast: boolean } | { ok: false; why: "unknown" | "last" } {
      reconcile(file, now);
      if (!subjectOf(sessionId)) return { ok: false, why: "unknown" };
      const phones = goodPhones(who, rp, metaNum("passkeys_before"));
      const target = phones.find((r) => r.id === phoneId);
      if (!target) return { ok: false, why: "unknown" };
      const wasLast = phones.length === 1;
      if (wasLast && !confirmLast) return { ok: false, why: "last" };
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE passkeys SET removed_at = ?, removed_why = 'owner' WHERE id = ? AND removed_at IS NULL").run(now, target.id);
        db.prepare("UPDATE sessions SET ended_at = ?, ended_why = 'phone_removed' WHERE link_id = ? AND ended_at IS NULL").run(now, `pk-${target.id}`);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return { ok: true, removed: { id: target.id, ...(target.label ? { label: target.label } : {}) }, wasLast };
    },

    /**
     * The owner makes their OWN recovery codes (only from a passkey session: a link on WhatsApp is whoever holds the phone). Shown ONCE by the caller. Every code of
     * the Operator's printed card stops working (voided here, so a copy the Operator kept is worth nothing), and so does any earlier set of the owner's own.
     */
    makeOwnCodes(sessionId: string, file: OwnerGrants | undefined, now: number): string[] | undefined {
      reconcile(file, now);
      const me = subjectOf(sessionId);
      if (!me?.passkey) return undefined;
      const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE own_codes SET voided_at = ? WHERE voided_at IS NULL").run(now);
        db.prepare("UPDATE grants_seen SET voided_at = ? WHERE kind = 'recovery' AND voided_at IS NULL").run(now);
        for (const c of codes) db.prepare("INSERT INTO own_codes (hash, made_at) VALUES (?, ?)").run(recoveryHash(c), now);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return codes;
    },

    /** "Add a phone": a one-use setup link made by the owner's own phone (a passkey session only), for SETUP_MS. The token is returned ONCE; the page shows it as a QR. */
    addPhone(sessionId: string, file: OwnerGrants | undefined, now: number): { token: string; expiresAt: number } | undefined {
      reconcile(file, now);
      if (!subjectOf(sessionId)?.passkey) return undefined;
      db.prepare("DELETE FROM own_setups WHERE expires_at < ?").run(now - 24 * 60 * 60_000);
      const token = newSetupToken();
      db.prepare("INSERT INTO own_setups (hash, made_at, expires_at) VALUES (?, ?, ?)").run(setupHash(token), now, now + SETUP_MS);
      return { token, expiresAt: now + SETUP_MS };
    },

    close(): void { if (db.isOpen) db.close(); },
  };
  return api;
}
export type OwnerAccess = ReturnType<typeof openOwnerAccess>;

/** What the owner's phones page needs (see `phonesView`). Times are milliseconds. */
export interface PhoneEntry { id: string; madeAt: number; usedAt?: number; via: string; label?: string }
export interface PhonesView {
  phones: (PhoneEntry & { mine: boolean })[];
  /** Phones made since this phone last dismissed the news (never this phone itself). */
  announce: PhoneEntry[];
  /** The Operator's request to remove every phone, timed by this runtime. */
  removal?: { askedBy: string; askedAt: string; seenAt: number; effectiveAt: number };
  /** When the owner made their own recovery codes (the newest set still good), if they did. */
  ownCodesAt?: number;
  passkeySession: boolean;
}

/**
 * The relay's question to the runtime about a session (GET /internal/owner-session, the runtime's internal token): true only on a 204. Used by the approvals relay
 * for the owner's page, so the relay never takes the front's word for who the owner is. Any failure is "no".
 */
export function ownerSessionChecker(o: { url: string; token: string; timeoutMs?: number }): (session: string) => Promise<boolean> {
  return async (session) => {
    if (!ACCESS_TOKEN.test(session)) return false;
    try {
      const r = await fetch(`${o.url.replace(/\/+$/u, "")}/internal/owner-session`, { headers: { authorization: `Bearer ${o.token}`, [OWNER_SESSION_HEADER]: session }, signal: AbortSignal.timeout(o.timeoutMs ?? 3_000) });
      await r.arrayBuffer().catch(() => undefined);
      return r.status === 204;
    } catch { return false; }
  };
}
