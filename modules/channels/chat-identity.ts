// Who a chat guest is, kept by the shop's own runtime (W2, 17 Nov 2026; plan next-phase.md section 1a, "The talk on every door": the identity bullet and "No login anywhere").
// A guest on the shop's page is a cookie and nothing more (W1). This file adds what lets a customer keep their chat and their own bookings or orders when the phone changes,
// with nothing typed and nothing remembered: the phone's own key pair (a passkey), unlocked by the fingerprint, face or screen lock, or, when that is not to hand, a one-use
// link sent to the WhatsApp number the customer gave. Opened by the runtime's start and used by the runtime's HTTP layer and the core's link step only: no agent imports it
// (it uses node:sqlite), and the front never sees a key or a hash of one, it only carries the browser's answers.
//
// How it fits the owner's design (owner-access.ts, webauthn.ts) and where it differs, and why:
//   - the checks are the same ones (webauthn.ts): attestation "none", the RP ID's hash, user presence AND user verification (the fingerprint or screen lock), the signature and
//     the counter rule (a copied key shows itself by going back; a synced passkey that always says 0 is accepted);
//   - credentials are this shop's alone (this file is this shop's runtime's own): a passkey made for another shop on the same pages domain (the same RP ID) is unknown here and
//     refused; the phone may still list it in its own chooser, so the page says what to do ("that one is for another shop");
//   - each thread has its OWN WebAuthn user id (the owner has one per shop): a shop has many customers, and one id per shop would make a second customer on the same phone
//     replace the first one's passkey (a passkey is stored per RP ID and user id);
//   - sign-in asks for no list of credentials (a new phone has no cookie to say who it is), so the passkeys are discoverable (`residentKey: "required"`) and found by the id
//     the phone sends and checked against the user id it names; no restriction to the phone's own authenticator, so the old phone can sign the new one in by the standard
//     cross-device QR with the phones side by side;
//   - a signed-in phone is not given the old cookie (the runtime keeps only one-way hashes of handles and cannot): the NEW phone's own guest hash is ALIASED to the thread's.
//     `resolve` is applied once at the runtime's door, so everything after it (the thread, the day's caps, alerts, the guest's bookings and orders) reads the same conversation.
//
// The one-use link to the number the customer gave ("I have a new phone"): 32 random bytes, only their hash kept, 15 minutes, one use, a newer link replaces an older one for
// that thread. Opening it (a GET) uses nothing up, so a scanner or a preview cannot burn it; pressing the page's button does (`useLink`), and the new phone is then aliased to the
// thread. Sends are limited per number and per shop, and wrong links are counted per shop, so neither a stranger's phone nor the record can be flooded.
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ALGORITHMS, PasskeyError, verifyAssertion, verifyRegistration } from "./webauthn.ts";
import type { StoredCredential } from "./webauthn.ts";

export const CHAT_IDENTITY_FILE = "chat-identity.sqlite";
export const CHAT_CHALLENGE_MS = 5 * 60_000;
/** The most passkeys one thread keeps (a phone, a new phone, a tablet). The one used longest ago goes first. */
export const MAX_KEYS_PER_THREAD = 5;
/** A recovery link works once, for this long. */
export const RECOVERY_LINK_MS = 15 * 60_000;
/** Open challenges kept at most: a flood pushes the oldest out, never the newest. */
export const CHALLENGES_KEPT = 300;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Recovery sends: per number (two an hour, three a day) and per shop (five in a quarter of an hour, twenty a day). Every ask counts, whether or not a link then goes out. */
export const RECOVERY_LIMITS = {
  perNumber: [{ max: 2, perMs: HOUR }, { max: 3, perMs: DAY }],
  perShop: [{ max: 5, perMs: 15 * 60_000 }, { max: 20, perMs: DAY }],
} as const;
/** "Send me my booking link": three a day for a thread. */
export const LINKS_PER_DAY = 3;
/** Wrong or used-up recovery links a shop takes in a day before it stops looking (the front's per-address count comes first). */
export const WRONG_LINK_LIMIT = 20;

export interface RelyingParty { rpId: string; origin: string }
export interface RegistrationResponse { clientDataJSON: string; attestationObject: string }
export interface AssertionResponse { id: string; clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string }

/** A recovery link's token: 32 random bytes in base64url. */
export const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/u;

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const tokenHash = (token: string): string => sha(`chat-recovery:${token}`);
const confirmHash = (token: string): string => sha(`chat-confirm:${token}`);
const challengeHash = (c: string): string => sha(`chat-challenge:${c}`);
/** A number as the identity file keeps it for lookup: the digits only, hashed. */
export const numberKey = (digits: string): string => sha(`chat-number:${digits.replace(/\D/gu, "")}`);
const b64 = (s: unknown, max: number): Buffer | undefined => (typeof s === "string" && s.length > 0 && s.length <= max && /^[A-Za-z0-9_-]+$/u.test(s) ? Buffer.from(s, "base64url") : undefined);

export function openChatIdentity(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (guest TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS creds (
      id TEXT PRIMARY KEY, cred_id TEXT NOT NULL UNIQUE, guest TEXT NOT NULL, jwk TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL, backed_up INTEGER NOT NULL,
      made_at INTEGER NOT NULL, used_at INTEGER, rp_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('register', 'signin')), guest TEXT, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS alias (from_hash TEXT PRIMARY KEY, to_hash TEXT NOT NULL, made_at INTEGER NOT NULL);
    -- the phones (guest hashes) that kept the chat or opened it with a key: a phone restored only by a link is not one, so it is still offered a key of its own
    CREATE TABLE IF NOT EXISTS phones (hash TEXT PRIMARY KEY, guest TEXT NOT NULL, made_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS contact (guest TEXT PRIMARY KEY, number TEXT NOT NULL, key TEXT NOT NULL, made_at INTEGER NOT NULL);
    -- a number typed on the keep box waits here until its owner taps the link sent to it (confirmNumber); only then does it become the thread's contact
    CREATE TABLE IF NOT EXISTS pending (hash TEXT PRIMARY KEY, id TEXT NOT NULL, guest TEXT NOT NULL, number TEXT NOT NULL, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('issued', 'used', 'replaced', 'unsent')));
    CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, id TEXT NOT NULL, guest TEXT NOT NULL, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, state TEXT NOT NULL CHECK (state IN ('issued', 'used', 'replaced', 'unsent')));
    CREATE TABLE IF NOT EXISTS attempts (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL);
  `);

  /** The thread a guest hash names now: itself, or the thread a passkey or a link tied it to. One step only: an alias never points at an alias. */
  const resolve = (hash: string): string => (db.prepare("SELECT to_hash FROM alias WHERE from_hash = ?").get(hash) as { to_hash: string } | undefined)?.to_hash ?? hash;

  /** This thread's WebAuthn user id: 16 random bytes made once, so a phone keeps one passkey per thread and per shop even though every shop shares the RP ID. */
  function userId(guest: string): string {
    const have = (db.prepare("SELECT user_id FROM users WHERE guest = ?").get(guest) as { user_id: string } | undefined)?.user_id;
    if (have) return have;
    db.prepare("INSERT INTO users (guest, user_id) VALUES (?, ?) ON CONFLICT(guest) DO NOTHING").run(guest, randomBytes(16).toString("base64url"));
    return (db.prepare("SELECT user_id FROM users WHERE guest = ?").get(guest) as { user_id: string }).user_id;
  }

  /** Count one try against windows for a key; false when a window is full (nothing is counted then). */
  function take(kind: string, key: string, windows: readonly { max: number; perMs: number }[], now: number): boolean {
    db.prepare("DELETE FROM attempts WHERE at <= ?").run(now - DAY);
    for (const w of windows) {
      const n = (db.prepare("SELECT count(*) AS n FROM attempts WHERE kind = ? AND key = ? AND at > ?").get(kind, key, now - w.perMs) as { n: number }).n;
      if (n >= w.max) return false;
    }
    db.prepare("INSERT INTO attempts (kind, key, at) VALUES (?, ?, ?)").run(kind, key, now);
    return true;
  }

  /** A fresh challenge, kept as a hash. Past CHALLENGES_KEPT open ones the OLDEST go, never the new one. */
  function newChallenge(kind: "register" | "signin", guest: string | null, now: number): string {
    db.prepare("DELETE FROM challenges WHERE expires_at <= ?").run(now - DAY);
    db.prepare("DELETE FROM challenges WHERE hash IN (SELECT hash FROM challenges WHERE used_at IS NULL ORDER BY made_at DESC LIMIT -1 OFFSET ?)").run(CHALLENGES_KEPT - 1);
    const c = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO challenges (hash, kind, guest, made_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(challengeHash(c), kind, guest, now, now + CHAT_CHALLENGE_MS);
    return c;
  }
  /** The challenge the browser's client data names, if it is one of ours for this ceremony (and for this thread, at registration), unused and in time. */
  function challengeOf(clientData: Buffer, kind: "register" | "signin", now: number, guest?: string): string | undefined {
    let c: unknown;
    try { c = (JSON.parse(clientData.toString("utf8")) as { challenge?: unknown }).challenge; } catch { return undefined; }
    if (typeof c !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(c)) return undefined;
    const r = db.prepare("SELECT kind, guest, expires_at, used_at FROM challenges WHERE hash = ?").get(challengeHash(c)) as { kind: string; guest: string | null; expires_at: number; used_at: number | null } | undefined;
    if (!r || r.kind !== kind || r.used_at !== null || r.expires_at <= now || (guest !== undefined && r.guest !== guest)) return undefined;
    return c;
  }

  type CredRow = { id: string; cred_id: string; guest: string; jwk: string; alg: number; sign_count: number; backed_up: number; made_at: number; rp_id: string };

  const api = {
    resolve,

    /**
     * What the page may be told about a guest (never a key): how many keys keep this thread, whether THIS phone kept it or opened it with one (`here`: a phone brought back by a link
     * has none of its own and is offered one), and whether a number was given for a new phone.
     */
    state(hash: string): { keys: number; here: boolean; number: boolean } {
      const g = resolve(hash);
      return { keys: (db.prepare("SELECT count(*) AS n FROM creds WHERE guest = ?").get(g) as { n: number }).n, here: db.prepare("SELECT 1 FROM phones WHERE hash = ? AND guest = ?").get(hash, g) !== undefined, number: db.prepare("SELECT 1 FROM contact WHERE guest = ?").get(g) !== undefined };
    },

    /** What navigator.credentials.create is handed to keep THIS thread on the phone: a challenge bound to the thread, this thread's own user id, a discoverable key, the user verified. */
    keepOptions(hash: string, rp: RelyingParty, shopName: string, now: number): Record<string, unknown> {
      const guest = resolve(hash);
      const have = (db.prepare("SELECT cred_id FROM creds WHERE guest = ? AND rp_id = ?").all(guest, rp.rpId) as { cred_id: string }[]).map((r) => r.cred_id);
      return {
        challenge: newChallenge("register", guest, now),
        rp: { id: rp.rpId, name: shopName },
        user: { id: userId(guest), name: `${shopName} chat`, displayName: `${shopName} chat` },
        pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: "public-key", alg })),
        // no authenticatorAttachment: a phone's own lock, a synced passkey or another device are all fine. A key the phone can find again by itself (discoverable) is what a new phone signs in with.
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none", timeout: CHAT_CHALLENGE_MS,
        excludeCredentials: have.map((id) => ({ type: "public-key", id })),
      };
    },

    /** Finish keeping the chat: the answer checked (webauthn.ts) against the challenge made for THIS thread, then the key kept for it, in one transaction. */
    keep(hash: string, rp: RelyingParty, response: RegistrationResponse, now: number): { ok: true } | { ok: false; why: string } {
      const guest = resolve(hash);
      const clientData = b64(response?.clientDataJSON, 4096); const attestation = b64(response?.attestationObject, 16_384);
      if (!clientData || !attestation) return { ok: false, why: "The browser's answer is not complete." };
      const challenge = challengeOf(clientData, "register", now, guest);
      if (!challenge) return { ok: false, why: "The answer is for no challenge of this chat that is still open." };
      let cred: StoredCredential;
      try { cred = verifyRegistration({ clientDataJSON: clientData, attestationObject: attestation }, { challenge, ...rp }); }
      catch (e) { if (e instanceof PasskeyError) return { ok: false, why: e.message }; throw e; }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (Number(db.prepare("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL").run(now, challengeHash(challenge)).changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, why: "That challenge was used already." }; }
        if (db.prepare("SELECT 1 FROM creds WHERE cred_id = ?").get(cred.id)) { db.exec("ROLLBACK"); return { ok: false, why: "This passkey is already kept here." }; }
        db.prepare("INSERT INTO creds (id, cred_id, guest, jwk, alg, sign_count, backed_up, made_at, rp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(randomBytes(6).toString("hex"), cred.id, guest, JSON.stringify(cred.jwk), cred.alg, cred.signCount, cred.backedUp ? 1 : 0, now, rp.rpId);
        const kept = db.prepare("SELECT id FROM creds WHERE guest = ? ORDER BY coalesce(used_at, made_at) DESC").all(guest) as { id: string }[];
        for (const old of kept.slice(MAX_KEYS_PER_THREAD)) db.prepare("DELETE FROM creds WHERE id = ?").run(old.id);
        db.prepare("INSERT INTO phones (hash, guest, made_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET guest = excluded.guest, made_at = excluded.made_at").run(hash, guest, now);
        db.exec("COMMIT");
        return { ok: true };
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },

    /** What navigator.credentials.get is handed: a challenge and NO list (a new phone cannot say who it is), the user verified, nothing restricting where the key lives. */
    signinOptions(rp: RelyingParty, now: number): Record<string, unknown> {
      return { challenge: newChallenge("signin", null, now), rpId: rp.rpId, userVerification: "required", timeout: CHAT_CHALLENGE_MS, allowCredentials: [] };
    },

    /**
     * Finish a sign-in from this phone (`hash` is the guest hash of the cookie it holds): a challenge of ours, unused and in time; a passkey THIS shop keeps (another shop's is
     * unknown here); the thread's own user id when the phone names one; the signature, the verified user and the counter (webauthn.ts). Then the phone's hash is aliased to the
     * thread, in one transaction with the challenge used up and the counter moved. Returns the thread's hash, which the caller does not pass on to the browser.
     */
    signin(hash: string, rp: RelyingParty, response: AssertionResponse, now: number): { ok: true; thread: string } | { ok: false; why: string } {
      const clientData = b64(response?.clientDataJSON, 4096); const authData = b64(response?.authenticatorData, 4096); const signature = b64(response?.signature, 1024);
      if (!clientData || !authData || !signature || typeof response?.id !== "string" || !/^[A-Za-z0-9_-]{16,1400}$/u.test(response.id)) return { ok: false, why: "The browser's answer is not complete." };
      const challenge = challengeOf(clientData, "signin", now);
      if (!challenge) return { ok: false, why: "The answer is for no sign-in challenge that is still open." };
      const row = db.prepare("SELECT * FROM creds WHERE cred_id = ?").get(response.id) as CredRow | undefined;
      if (!row || row.rp_id !== rp.rpId) return { ok: false, why: "This passkey is not one of this shop's." };
      if (response.userHandle !== undefined && response.userHandle !== "" && response.userHandle !== userId(row.guest)) return { ok: false, why: "This passkey was made for another shop." };
      let next: { signCount: number };
      try { next = verifyAssertion({ clientDataJSON: clientData, authenticatorData: authData, signature }, { id: row.cred_id, jwk: JSON.parse(row.jwk), alg: row.alg as StoredCredential["alg"], signCount: row.sign_count, backedUp: row.backed_up === 1 }, { challenge, ...rp }); }
      catch (e) { if (e instanceof PasskeyError) return { ok: false, why: e.message }; throw e; }
      db.exec("BEGIN IMMEDIATE");
      try {
        if (Number(db.prepare("UPDATE challenges SET used_at = ? WHERE hash = ? AND used_at IS NULL").run(now, challengeHash(challenge)).changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, why: "That challenge was used already." }; }
        // the counter moves only from the value just checked: two answers racing with the same counter cannot both pass
        if (Number(db.prepare("UPDATE creds SET sign_count = ?, used_at = ? WHERE id = ? AND sign_count = ?").run(next.signCount, now, row.id, row.sign_count).changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, why: "The passkey's counter moved meanwhile." }; }
        api.tie(hash, row.guest, now);
        db.prepare("INSERT INTO phones (hash, guest, made_at) VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET guest = excluded.guest, made_at = excluded.made_at").run(hash, row.guest, now);
        db.exec("COMMIT");
        return { ok: true, thread: row.guest };
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },

    /** This phone's guest hash now names `thread` (its own bookings, orders, lines and caps). A phone that already is the thread needs no alias. */
    tie(hash: string, thread: string, now: number): void {
      if (hash === thread) return;
      db.prepare("INSERT INTO alias (from_hash, to_hash, made_at) VALUES (?, ?, ?) ON CONFLICT(from_hash) DO UPDATE SET to_hash = excluded.to_hash, made_at = excluded.made_at").run(hash, thread, now);
    },

    // ---- the number the customer gave, for a new phone ----

    /** The number (digits, country code first) the customer gave for a new phone. One per thread; a new one replaces it. */
    setNumber(hash: string, digits: string, now: number): void {
      db.prepare("INSERT INTO contact (guest, number, key, made_at) VALUES (?, ?, ?, ?) ON CONFLICT(guest) DO UPDATE SET number = excluded.number, key = excluded.key, made_at = excluded.made_at").run(resolve(hash), digits, numberKey(digits), now);
    },
    numberOf(hash: string): string | undefined { return (db.prepare("SELECT number FROM contact WHERE guest = ?").get(resolve(hash)) as { number: string } | undefined)?.number; },
    /** The thread most lately given this number, if any (a thread with a passkey or a booking is no likelier than another: the number is unverified, so a link only ever goes TO the number). */
    guestOfNumber(digits: string): string | undefined { return (db.prepare("SELECT guest FROM contact WHERE key = ? ORDER BY made_at DESC LIMIT 1").get(numberKey(digits)) as { guest: string } | undefined)?.guest; },

    /** One ask for a link to a number, counted first whether or not anything is then sent: per number and per shop. False: wait. */
    countRecoveryAsk(digits: string, now: number): boolean {
      return take("recover-shop", "shop", RECOVERY_LIMITS.perShop, now) && take("recover-number", numberKey(digits), RECOVERY_LIMITS.perNumber, now);
    },
    /**
     * One "send me my booking link", counted: three a day for the thread, three a day for the number it goes to and twenty a day for the shop, so several threads naming one number (or
     * many threads at one shop) cannot make the shop's WhatsApp send more. False too when the thread has no number.
     */
    countLinksAsk(hash: string, now: number): boolean {
      const g = resolve(hash);
      const number = api.numberOf(g);
      if (!number) return false;
      return take("links", g, [{ max: LINKS_PER_DAY, perMs: DAY }], now) && take("links-number", numberKey(number), [{ max: LINKS_PER_DAY, perMs: DAY }], now) && take("links-shop", "shop", [{ max: 20, perMs: DAY }], now);
    },

    /** A new one-use link for a thread; every older unused one for it stops working (one works at a time). The token is returned ONCE and never kept. */
    issueLink(guest: string, now: number): { id: string; token: string; expiresAt: number } {
      const token = randomBytes(32).toString("base64url");
      const id = randomBytes(6).toString("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE links SET state = 'replaced' WHERE guest = ? AND state = 'issued'").run(guest);
        db.prepare("INSERT INTO links (hash, id, guest, made_at, expires_at, state) VALUES (?, ?, ?, ?, ?, 'issued')").run(tokenHash(token), id, guest, now, now + RECOVERY_LINK_MS);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return { id, token, expiresAt: now + RECOVERY_LINK_MS };
    },
    /** The send failed before anything went out: nobody has the link. */
    linkUnsent(id: string): void { db.prepare("UPDATE links SET state = 'unsent' WHERE id = ? AND state = 'issued'").run(id); },

    /** What a link is now, for the page that shows its button. Nothing is used up. */
    linkState(token: string, now: number): "valid" | "used" | "expired" | "replaced" | "unknown" {
      if (!LINK_TOKEN.test(token)) return "unknown";
      const r = db.prepare("SELECT state, expires_at FROM links WHERE hash = ?").get(tokenHash(token)) as { state: string; expires_at: number } | undefined;
      if (!r || r.state === "unsent") return "unknown";
      if (r.state === "used" || r.state === "replaced") return r.state;
      return r.expires_at > now ? "valid" : "expired";
    },
    /** Wrong links today, for the shop's own cap (a right one does not count). */
    wrongLinks: {
      locked: (now: number): boolean => { db.prepare("DELETE FROM attempts WHERE at <= ?").run(now - DAY); return (db.prepare("SELECT count(*) AS n FROM attempts WHERE kind = 'wrong-link' AND at > ?").get(now - DAY) as { n: number }).n >= WRONG_LINK_LIMIT; },
      note: (now: number): void => { db.prepare("INSERT INTO attempts (kind, key, at) VALUES ('wrong-link', 'shop', ?)").run(now); },
    },
    /**
     * Use a link up and tie THIS phone's guest hash to the link's thread, in one statement that also checks it has not run out, so two presses (two tabs, a scanner and a person)
     * can never both win. Returns the thread's hash (kept from the browser).
     */
    useLink(token: string, hash: string, now: number): { ok: true; thread: string } | { ok: false; state: "used" | "expired" | "replaced" | "unknown" } {
      const state = api.linkState(token, now);
      if (state !== "valid") return { ok: false, state };
      const r = db.prepare("SELECT guest FROM links WHERE hash = ?").get(tokenHash(token)) as { guest: string };
      db.exec("BEGIN IMMEDIATE");
      try {
        const used = db.prepare("UPDATE links SET state = 'used', used_at = ? WHERE hash = ? AND state = 'issued' AND expires_at > ?").run(now, tokenHash(token), now);
        if (Number(used.changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, state: "used" }; }
        api.tie(hash, r.guest, now);
        db.exec("COMMIT");
        return { ok: true, thread: r.guest };
      } catch (e) { if (db.isTransaction) db.exec("ROLLBACK"); throw e; }
    },

    /**
     * "Delete my chat", this side: the thread's passkeys, user id, number, links and every phone tied to it are gone, and so is this phone's own tie. The words and the thread are
     * taken off by the step that follows (chat.ts `forgetChat`). Returns the thread's hash, for that step.
     */
    forget(hash: string): string {
      const g = resolve(hash);
      api.dropThread(g);
      db.prepare("DELETE FROM alias WHERE from_hash = ?").run(hash);
      return g;
    },

    /** Everything this side keeps for one thread: keys, user id, number, a number waiting to be confirmed, links, the phones that hold a key and every phone tied to it. */
    dropThread(g: string): void {
      for (const sql of ["DELETE FROM creds WHERE guest = ?", "DELETE FROM phones WHERE guest = ?", "DELETE FROM users WHERE guest = ?", "DELETE FROM contact WHERE guest = ?", "DELETE FROM pending WHERE guest = ?", "DELETE FROM links WHERE guest = ?", "DELETE FROM alias WHERE to_hash = ?"]) db.prepare(sql).run(g);
    },

    /**
     * Retention: a thread the shop has cleared (its words, after the conversation retention) takes its keys, number and ties with it. `live` says whether the shop still has the
     * thread. Returns how many threads were dropped.
     */
    dropGone(live: (thread: string) => boolean): number {
      const all = new Set((db.prepare("SELECT guest AS g FROM creds UNION SELECT guest FROM contact UNION SELECT guest FROM pending UNION SELECT guest FROM links UNION SELECT to_hash FROM alias").all() as { g: string }[]).map((r) => r.g));
      let n = 0;
      for (const g of all) if (!live(g)) { api.dropThread(g); n++; }
      return n;
    },

    // ---- a number counts only once its owner has tapped the link sent to it ----

    /** A new one-use link asking whoever holds this number to confirm it for the thread (a newer one replaces an older). The token is returned ONCE, to the step that sends it. */
    issueConfirm(guest: string, digits: string, now: number): { id: string; token: string } {
      const token = randomBytes(32).toString("base64url");
      const id = randomBytes(6).toString("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE pending SET state = 'replaced' WHERE guest = ? AND state = 'issued'").run(guest);
        db.prepare("INSERT INTO pending (hash, id, guest, number, made_at, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, 'issued')").run(confirmHash(token), id, guest, digits, now, now + RECOVERY_LINK_MS);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return { id, token };
    },
    confirmUnsent(id: string): void { db.prepare("UPDATE pending SET state = 'unsent' WHERE id = ? AND state = 'issued'").run(id); },
    /** What a confirm link is now (looking uses nothing up). */
    confirmState(token: string, now: number): "valid" | "used" | "expired" | "replaced" | "unknown" {
      if (!LINK_TOKEN.test(token)) return "unknown";
      const r = db.prepare("SELECT state, expires_at FROM pending WHERE hash = ?").get(confirmHash(token)) as { state: string; expires_at: number } | undefined;
      if (!r || r.state === "unsent") return "unknown";
      if (r.state === "used" || r.state === "replaced") return r.state;
      return r.expires_at > now ? "valid" : "expired";
    },
    /** The button: in one statement the link is used up and the number becomes the thread's contact. */
    confirmNumber(token: string, now: number): { ok: true } | { ok: false; state: "used" | "expired" | "replaced" | "unknown" } {
      const state = api.confirmState(token, now);
      if (state !== "valid") return { ok: false, state };
      const r = db.prepare("SELECT guest, number FROM pending WHERE hash = ?").get(confirmHash(token)) as { guest: string; number: string };
      db.exec("BEGIN IMMEDIATE");
      try {
        const used = db.prepare("UPDATE pending SET state = 'used' WHERE hash = ? AND state = 'issued' AND expires_at > ?").run(confirmHash(token), now);
        if (Number(used.changes) !== 1) { db.exec("ROLLBACK"); return { ok: false, state: "used" }; }
        api.setNumber(r.guest, r.number, now);
        db.exec("COMMIT");
        return { ok: true };
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    /** One ask to confirm a number: counted per number and per shop like a recovery ask, and five a day for the thread. */
    countConfirmAsk(hash: string, digits: string, now: number): boolean {
      return take("confirm", resolve(hash), [{ max: 5, perMs: DAY }], now) && api.countRecoveryAsk(digits, now);
    },

    /**
     * What is kept past its use goes: a number is kept for the thread's retention (30 days from when it was given: the thread is cleared then, and the number is not worth keeping
     * without it), a link a day after it ran out, a tie and a phone's mark twice the cookie's life. A key is the customer's own and stays until they delete the chat.
     */
    purge(now: number, retentionDays = 30): void {
      db.prepare("DELETE FROM contact WHERE made_at < ?").run(now - retentionDays * DAY);
      db.prepare("DELETE FROM pending WHERE expires_at < ?").run(now - DAY);
      db.prepare("DELETE FROM links WHERE expires_at < ?").run(now - DAY);
      db.prepare("DELETE FROM alias WHERE made_at < ?").run(now - 2 * retentionDays * DAY);
      db.prepare("DELETE FROM phones WHERE made_at < ?").run(now - 2 * retentionDays * DAY);
    },

    close(): void { if (db.isOpen) db.close(); },
  };
  return api;
}
export type ChatIdentity = ReturnType<typeof openChatIdentity>;
