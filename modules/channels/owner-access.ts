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
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const OWNER_ACCESS_FILE = "owner-access.sqlite";
/** The panel's "sign out every device" (shops/<shop>/owner-sessions.json), copied by the deployer to the runtime's client folder: {schema: 1, endBefore}. */
export const OWNER_SESSIONS_FILE = "owner-sessions.json";

export const SIGNIN_LINK_MS = 10 * 60_000;
export const SESSION_MS = 30 * 24 * 60 * 60_000;
export const MAX_SESSIONS = 5;
/** Link requests per shop: three a quarter of an hour, ten a day. A person who taps twice is served; a flood is not. */
export const LINK_LIMITS = [{ max: 3, perMs: 15 * 60_000 }, { max: 10, perMs: 24 * 60 * 60_000 }] as const;

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
  `);
  type LinkRow = { id: string; made_at: number; expires_at: number; state: string; owner_key: string; base: string };
  type SessionRow = { id: string; made_at: number; expires_at: number; ended_at: number | null; owner_key: string; base: string };
  const linkByHash = db.prepare("SELECT id, made_at, expires_at, state, owner_key, base FROM links WHERE hash = ?");
  const sessionByHash = db.prepare("SELECT id, made_at, expires_at, ended_at, owner_key, base FROM sessions WHERE hash = ?");

  const api = {
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
      const session = newToken();
      const id = newId();
      const expiresAt = now + SESSION_MS;
      db.prepare("INSERT INTO sessions (id, hash, made_at, expires_at, owner_key, base, link_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, sessionHash(session), now, expiresAt, r.owner_key, r.base, r.id);
      // at most MAX_SESSIONS live at once: the oldest ends, so a phone lost long ago does not stay signed in for ever behind newer ones
      const live = db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL AND expires_at > ? ORDER BY made_at DESC").all(now) as { id: string }[];
      for (const old of live.slice(MAX_SESSIONS)) db.prepare("UPDATE sessions SET ended_at = ?, ended_why = 'too_many' WHERE id = ?").run(now, old.id);
      return { ok: true, session, id, expiresAt };
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

    close(): void { if (db.isOpen) db.close(); },
  };
  return api;
}
export type OwnerAccess = ReturnType<typeof openOwnerAccess>;

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
