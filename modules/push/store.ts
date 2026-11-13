// Web push on the shop's own server (plan item 11h, decision 45): the shop's VAPID keys, the phones that allowed alerts, the owner's choice of WhatsApp, push or
// both, and the waiting pushes. Kept by the shop's RUNTIME in a small SQLite file of its own (PUSH_FILE, in its data folder, beside the owner's sign-in store), not
// in the agent's saved state: an alert changes no booking, and the queue is drained outside the agent's steps (sender.ts).
//
// Who a push is for:
//   - the owner: subscriptions made on the owner's app, signed in (owner-session.ts), at most OWNER_PHONES at once (the oldest goes);
//   - a customer: subscriptions made on one booking's, order's or fee's own page, keyed by that page's conversation ("web:" and 16 hex digits of its handle's
//     hash), at most CUSTOMER_PHONES each. The handle itself is never kept.
// What is kept of a subscription is its push service's host (one of PUSH_HOSTS), its path, and its two keys: together they are a secret (whoever holds them can
// encrypt to that phone), so they stay in this file only: the record and the exports name a subscription by its short id, never its address.
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PUSH_HOSTS } from "./hosts.ts";
import { isUncompressedP256, newVapidKeys, p256PublicKey } from "./crypto.ts";
import type { VapidKeys } from "./crypto.ts";

export const PUSH_FILE = "push.sqlite";
/** Phones the owner keeps alerts on, and phones per customer page. */
export const OWNER_PHONES = 5;
export const CUSTOMER_PHONES = 2;
/** How many times a push is tried before it is given up (a push service down for a while), and how long it is kept waiting at most. */
export const MAX_TRIES = 6;
export const MAX_WAIT_MS = 12 * 60 * 60_000;

/** The owner's choice: where alerts to the owner go. "whatsapp" is the default until the owner turns alerts on in their app. */
export type OwnerChoice = "whatsapp" | "push" | "both";
export const OWNER_CHOICES: readonly OwnerChoice[] = ["whatsapp", "push", "both"];

/** A subscription as a browser hands it (PushSubscription.toJSON()). */
export interface BrowserSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
/** A kept subscription, for the sender. */
export interface Subscription { id: string; who: string; host: string; path: string; p256dh: Buffer; auth: Buffer }
/** One waiting push. */
export interface Waiting { id: string; sub: Subscription; kind: "owner" | "customer"; title: string; body: string; tag: string; madeAt: number; tries: number }

/** Why a browser's subscription is refused, or null: an https address at one of the push services the Guard allows, a P-256 key and a 16-byte auth secret. */
export function subscriptionProblem(s: unknown): string | null {
  const o = s as Partial<BrowserSubscription> | undefined;
  if (!o || typeof o.endpoint !== "string" || o.endpoint.length > 1000 || !o.keys || typeof o.keys.p256dh !== "string" || typeof o.keys.auth !== "string") return "a subscription is {endpoint, keys: {p256dh, auth}}";
  let u: URL;
  try { u = new URL(o.endpoint); } catch { return "the endpoint is not an address"; }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "" || u.hash !== "") return "the endpoint must be a plain https address";
  if (!PUSH_HOSTS.includes(u.hostname)) return `the push service ${u.hostname} is not one this shop sends to`;
  const key = Buffer.from(o.keys.p256dh, "base64url");
  if (!isUncompressedP256(key)) return "p256dh is not a P-256 public key";
  try { p256PublicKey(o.keys.p256dh); } catch { return "p256dh is not a point on P-256"; }
  if (Buffer.from(o.keys.auth, "base64url").length !== 16) return "auth is not 16 bytes";
  return null;
}

const newId = (): string => randomBytes(6).toString("hex");

export function openPushStore(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subs (
      id TEXT PRIMARY KEY, who TEXT NOT NULL, host TEXT NOT NULL, path TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      made_at INTEGER NOT NULL, dead_at INTEGER, dead_why TEXT, UNIQUE (host, path)
    );
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY, sub_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, tag TEXT NOT NULL,
      made_at INTEGER NOT NULL, next_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK (state IN ('waiting', 'sent', 'gone', 'refused', 'failed')), done_at INTEGER, status INTEGER
    );
    CREATE INDEX IF NOT EXISTS queue_waiting ON queue (state, next_at);
  `);
  type SubRow = { id: string; who: string; host: string; path: string; p256dh: string; auth: string; made_at: number; dead_at: number | null };
  const asSub = (r: SubRow): Subscription => ({ id: r.id, who: r.who, host: r.host, path: r.path, p256dh: Buffer.from(r.p256dh, "base64url"), auth: Buffer.from(r.auth, "base64url") });
  const live = (who: string): SubRow[] => db.prepare("SELECT * FROM subs WHERE who = ? AND dead_at IS NULL ORDER BY made_at").all(who) as SubRow[];

  const api = {
    /** The shop's VAPID keys, made once on first use and kept here (the shop's own server is the only place they live). */
    vapid(): VapidKeys {
      const have = (db.prepare("SELECT value FROM meta WHERE name = 'vapid'").get() as { value: string } | undefined)?.value;
      if (have) return JSON.parse(have) as VapidKeys;
      db.prepare("INSERT INTO meta (name, value) VALUES ('vapid', ?) ON CONFLICT(name) DO NOTHING").run(JSON.stringify(newVapidKeys()));
      return JSON.parse((db.prepare("SELECT value FROM meta WHERE name = 'vapid'").get() as { value: string }).value) as VapidKeys;
    },

    /**
     * Keep a browser's subscription for `who` ("owner", or a customer page's conversation). The same address again is the same subscription (moved to `who` if a
     * page passed it on). Returns its short id, or why it was refused.
     */
    subscribe(who: string, s: BrowserSubscription, now: number): { ok: true; id: string } | { ok: false; why: string } {
      const problem = subscriptionProblem(s);
      if (problem) return { ok: false, why: problem };
      const u = new URL(s.endpoint);
      const path = `${u.pathname}${u.search}`;
      const old = db.prepare("SELECT id FROM subs WHERE host = ? AND path = ?").get(u.hostname, path) as { id: string } | undefined;
      const id = old?.id ?? newId();
      db.prepare(`INSERT INTO subs (id, who, host, path, p256dh, auth, made_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host, path) DO UPDATE SET who = excluded.who, p256dh = excluded.p256dh, auth = excluded.auth, made_at = excluded.made_at, dead_at = NULL, dead_why = NULL`)
        .run(id, who, u.hostname, path, s.keys.p256dh, s.keys.auth, now);
      const max = who === "owner" ? OWNER_PHONES : CUSTOMER_PHONES;
      const rows = live(who);
      for (const r of rows.slice(0, Math.max(0, rows.length - max))) api.drop(r.id, "too_many", now);
      return { ok: true, id };
    },

    /** The browser said it no longer wants alerts (or the page dropped them): the subscription ends. */
    unsubscribe(who: string, endpoint: string, now: number): boolean {
      let u: URL;
      try { u = new URL(endpoint); } catch { return false; }
      const r = db.prepare("SELECT id FROM subs WHERE who = ? AND host = ? AND path = ? AND dead_at IS NULL").get(who, u.hostname, `${u.pathname}${u.search}`) as { id: string } | undefined;
      if (!r) return false;
      api.drop(r.id, "unsubscribed", now);
      return true;
    },

    /** A subscription ends: the push service said it is gone (404, 410), the owner turned alerts off, or a newer one took its place. Its waiting pushes go too. */
    drop(id: string, why: string, now: number): void {
      db.prepare("UPDATE subs SET dead_at = ?, dead_why = ? WHERE id = ? AND dead_at IS NULL").run(now, why, id);
      db.prepare("UPDATE queue SET state = 'gone', done_at = ? WHERE sub_id = ? AND state = 'waiting'").run(now, id);
    },

    /** How many phones get `who`'s alerts now. */
    phones(who: string): number { return live(who).length; },

    /** The owner's choice now; "whatsapp" until the owner picks. */
    choice(): OwnerChoice {
      const v = (db.prepare("SELECT value FROM meta WHERE name = 'owner_choice'").get() as { value: string } | undefined)?.value;
      return OWNER_CHOICES.includes(v as OwnerChoice) ? (v as OwnerChoice) : "whatsapp";
    },
    setChoice(c: OwnerChoice): void {
      if (!OWNER_CHOICES.includes(c)) throw new Error(`The owner's choice is one of ${OWNER_CHOICES.join(", ")}.`);
      db.prepare("INSERT INTO meta (name, value) VALUES ('owner_choice', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(c);
    },

    /**
     * Queue one alert for every live phone of `who`. Nothing is queued for nobody: returns the queued ids (empty when no phone allowed alerts), which the caller
     * reads as "nothing was sent" for the record.
     */
    enqueue(who: string, kind: "owner" | "customer", m: { title: string; body: string; tag: string }, now: number): string[] {
      const ids: string[] = [];
      for (const s of live(who)) {
        const id = newId();
        db.prepare("INSERT INTO queue (id, sub_id, kind, title, body, tag, made_at, next_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting')").run(id, s.id, kind, m.title, m.body, m.tag, now, now);
        ids.push(id);
      }
      return ids;
    },

    /** The pushes due now, oldest first (a push waiting too long is given up first). */
    due(now: number, limit = 20): Waiting[] {
      db.prepare("UPDATE queue SET state = 'failed', done_at = ? WHERE state = 'waiting' AND made_at < ?").run(now, now - MAX_WAIT_MS);
      const rows = db.prepare(`SELECT q.id, q.kind, q.title, q.body, q.tag, q.made_at, q.tries, s.id AS sid, s.who, s.host, s.path, s.p256dh, s.auth, s.made_at AS smade, s.dead_at
        FROM queue q JOIN subs s ON s.id = q.sub_id WHERE q.state = 'waiting' AND q.next_at <= ? AND s.dead_at IS NULL ORDER BY q.made_at LIMIT ?`).all(now, limit) as (SubRow & { sid: string; kind: string; title: string; body: string; tag: string; tries: number; smade: number })[];
      return rows.map((r) => ({ id: r.id, kind: r.kind as Waiting["kind"], title: r.title, body: r.body, tag: r.tag, madeAt: r.made_at, tries: r.tries, sub: asSub({ ...r, id: r.sid, made_at: r.smade }) }));
    },

    /** What came of one try: sent, gone (the subscription too), refused (the Guard's rules or its daily count: not tried again), failed, or try again later. */
    settle(id: string, outcome: "sent" | "gone" | "refused" | "failed" | "later", now: number, status?: number): void {
      if (outcome === "later") {
        const r = db.prepare("SELECT tries FROM queue WHERE id = ?").get(id) as { tries: number } | undefined;
        const tries = (r?.tries ?? 0) + 1;
        if (tries >= MAX_TRIES) { db.prepare("UPDATE queue SET state = 'failed', tries = ?, done_at = ?, status = ? WHERE id = ?").run(tries, now, status ?? null, id); return; }
        // 30 s, 1 min, 2 min, 4 min ...: a push service down for a few minutes still gets the alert
        db.prepare("UPDATE queue SET tries = ?, next_at = ?, status = ? WHERE id = ?").run(tries, now + 30_000 * 2 ** (tries - 1), status ?? null, id);
        return;
      }
      db.prepare("UPDATE queue SET state = ?, done_at = ?, status = ?, tries = tries + 1 WHERE id = ?").run(outcome, now, status ?? null, id);
    },

    /** Counts for the owner's app and the tests: pushes by state since `since`. Never an address or a word. */
    counts(since: number): Record<string, number> {
      const out: Record<string, number> = {};
      for (const r of db.prepare("SELECT state, count(*) AS n FROM queue WHERE made_at >= ? GROUP BY state").all(since) as { state: string; n: number }[]) out[r.state] = r.n;
      return out;
    },

    /** Old rows go: done pushes after a week, dead subscriptions after 30 days. */
    tidy(now: number): void {
      db.prepare("DELETE FROM queue WHERE state != 'waiting' AND done_at < ?").run(now - 7 * 24 * 60 * 60_000);
      db.prepare("DELETE FROM subs WHERE dead_at IS NOT NULL AND dead_at < ? AND id NOT IN (SELECT sub_id FROM queue)").run(now - 30 * 24 * 60 * 60_000);
    },

    close(): void { if (db.isOpen) db.close(); },
  };
  return api;
}
export type PushStore = ReturnType<typeof openPushStore>;
