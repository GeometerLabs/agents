// The approvals relay's own SQLite file (node:sqlite, no dependencies). It must survive a restart for one reason above the rest: a relay that
// forgot which approvals it had already asked about would ask the owner again. It holds
//   asks       one row per approval Guard held: its one-use code (as a hash, and in the clear only until the message is out), where the
//              ask and the answer have got to, and what is left to tell Guard, the runtime and the owner
//   messages   the owner's replies, saved before they are answered (the inbox is told 200 only after that), each id once
//   guesses    codes that matched no ask, with the time, for the lockout
//   alerts     things the builder must look at, in plain words, once per approval and kind
//   meta       the owner's last message time (for WhatsApp's 24-hour window)
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type AskState =
  | "waiting_context" // Guard holds it; the runtime has not (yet) shown the matching booking
  | "sending" // a code is made; the message to the owner is not yet out
  | "asked" // the owner has the message; the code is live until it expires
  | "deciding" // the owner's answer is being recorded with Guard: the code is used up
  | "decided" // Guard has the answer
  | "expired" // the code ran out unanswered
  | "alerted"; // not asked: the builder was told why

export interface Ask {
  approval: string;
  state: AskState;
  codeHash: string | null;
  /** In the clear only while state is "sending", so a failed send can go again with the same code. */
  code: string | null;
  receipt: string;
  booking: string | null;
  paymentId: string;
  amountPaise: number;
  customerPhone: string | null;
  language: string | null;
  /** The runtime's view of the booking when the ask was made (JSON): what the owner's message and its replies are written from. */
  context: string | null;
  firstSeenMs: number;
  askedAtMs: number | null;
  /** When the code stops working: Guard's expiry less a margin. */
  codeExpiresAtMs: number | null;
  guardExpiresAtMs: number;
  approvalHours: number;
  decision: "approve" | "deny" | null;
  guardTold: boolean;
  runtimeTold: boolean;
  ownerTold: boolean;
  lateReplied: boolean;
  sendTries: number;
}

export interface OwnerMessage { id: string; from: string; text: string; timestamp: number; receivedMs: number }

export const hashCode = (code: string): string => createHash("sha256").update(`approval-code:${code.toUpperCase()}`).digest("hex");

const MIGRATIONS = [`
  CREATE TABLE asks (
    approval TEXT PRIMARY KEY, state TEXT NOT NULL, code_hash TEXT UNIQUE, code TEXT, receipt TEXT NOT NULL, booking TEXT, payment_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL, customer_phone TEXT, language TEXT, context TEXT, first_seen_ms INTEGER NOT NULL, asked_at_ms INTEGER, code_expires_at_ms INTEGER,
    guard_expires_at_ms INTEGER NOT NULL, approval_hours INTEGER NOT NULL, decision TEXT, guard_told INTEGER NOT NULL DEFAULT 0,
    runtime_told INTEGER NOT NULL DEFAULT 0, owner_told INTEGER NOT NULL DEFAULT 0, late_replied INTEGER NOT NULL DEFAULT 0, send_tries INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE messages (id TEXT PRIMARY KEY, sender TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, received_ms INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL);
  CREATE TABLE guesses (at_ms INTEGER NOT NULL);
  CREATE TABLE alerts (approval TEXT NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (approval, kind));
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`];

const flag = (n: unknown) => Number(n) === 1;
const toAsk = (r: Record<string, any>): Ask => ({
  approval: r.approval, state: r.state, codeHash: r.code_hash, code: r.code, receipt: r.receipt, booking: r.booking, paymentId: r.payment_id, amountPaise: Number(r.amount_paise),
  customerPhone: r.customer_phone, language: r.language, context: r.context, firstSeenMs: Number(r.first_seen_ms), askedAtMs: r.asked_at_ms === null ? null : Number(r.asked_at_ms),
  codeExpiresAtMs: r.code_expires_at_ms === null ? null : Number(r.code_expires_at_ms), guardExpiresAtMs: Number(r.guard_expires_at_ms), approvalHours: Number(r.approval_hours),
  decision: r.decision, guardTold: flag(r.guard_told), runtimeTold: flag(r.runtime_told), ownerTold: flag(r.owner_told), lateReplied: flag(r.late_replied), sendTries: Number(r.send_tries),
});

export interface RelayStore {
  ask(approval: string): Ask | undefined;
  askByCode(code: string): Ask | undefined;
  asks(state?: AskState[]): Ask[];
  insertAsk(a: Pick<Ask, "approval" | "state" | "receipt" | "paymentId" | "amountPaise" | "firstSeenMs" | "guardExpiresAtMs" | "approvalHours"> & Partial<Ask>): void;
  updateAsk(approval: string, changes: Partial<Omit<Ask, "approval">>): void;
  /** Move to `to` only if it is in `from` now. True if this call made the move: the one use of a code is this compare-and-set. */
  moveAsk(approval: string, from: AskState[], to: AskState, changes?: Partial<Omit<Ask, "approval" | "state">>): boolean;
  /** Save owner messages; ids already seen are skipped. Returns how many were new. */
  saveMessages(messages: Omit<OwnerMessage, "receivedMs">[], nowMs: number): { saved: number; duplicates: number };
  unprocessed(): OwnerMessage[];
  markProcessed(id: string): void;
  addGuess(nowMs: number): void;
  guessesSince(sinceMs: number): number;
  /** Record an alert once per approval and kind. True if it is new. */
  addAlert(approval: string, kind: string, note: string, nowMs: number): boolean;
  alerts(): { approval: string; kind: string; note: string; atMs: number }[];
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  ping(): void;
  close(): void;
}

export function openRelayStore(dir: string): RelayStore {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "relay.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (version > MIGRATIONS.length) { db.close(); throw new Error("The approvals relay's data was written by a newer version."); }
  for (let v = version; v < MIGRATIONS.length; v++) { db.exec("BEGIN"); db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec("COMMIT"); }

  const columns: Record<string, string> = {
    state: "state", codeHash: "code_hash", code: "code", receipt: "receipt", booking: "booking", paymentId: "payment_id", amountPaise: "amount_paise", customerPhone: "customer_phone",
    language: "language", context: "context", firstSeenMs: "first_seen_ms", askedAtMs: "asked_at_ms", codeExpiresAtMs: "code_expires_at_ms", guardExpiresAtMs: "guard_expires_at_ms", approvalHours: "approval_hours",
    decision: "decision", guardTold: "guard_told", runtimeTold: "runtime_told", ownerTold: "owner_told", lateReplied: "late_replied", sendTries: "send_tries",
  };
  const column = (key: string) => { const c = columns[key]; if (!c) throw new Error(`no such column ${key}`); return c; };
  const value = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null)) as string | number | null;
  const getAsk = db.prepare("SELECT * FROM asks WHERE approval = ?");
  const getByHash = db.prepare("SELECT * FROM asks WHERE code_hash = ?");
  let nextSeq = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM messages").get() as { n: number }).n;

  function set(approval: string, changes: Record<string, unknown>, where = "") {
    const keys = Object.keys(changes);
    if (keys.length === 0) return 0;
    const result = db.prepare(`UPDATE asks SET ${keys.map((k) => `${column(k)} = ?`).join(", ")} WHERE approval = ?${where}`).run(...keys.map((k) => value(changes[k])), approval);
    return Number(result.changes);
  }

  return {
    ask: (approval) => { const r = getAsk.get(approval) as Record<string, any> | undefined; return r ? toAsk(r) : undefined; },
    askByCode: (code) => { const r = getByHash.get(hashCode(code)) as Record<string, any> | undefined; return r ? toAsk(r) : undefined; },
    asks: (state) => (db.prepare(`SELECT * FROM asks${state ? ` WHERE state IN (${state.map(() => "?").join(",")})` : ""} ORDER BY first_seen_ms`).all(...(state ?? [])) as Record<string, any>[]).map(toAsk),
    insertAsk(a) {
      const full = a as unknown as Record<string, unknown>;
      const keys = Object.keys(full).filter((k) => k !== "approval");
      db.prepare(`INSERT INTO asks (approval, ${keys.map(column).join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`).run(a.approval, ...keys.map((k) => value(full[k])));
    },
    updateAsk: (approval, changes) => { set(approval, changes); },
    moveAsk(approval, from, to, changes = {}) {
      return set(approval, { ...changes, state: to }, ` AND state IN (${from.map((s) => `'${s}'`).join(",")})`) === 1;
    },
    saveMessages(messages, nowMs) {
      db.exec("BEGIN");
      try {
        const insert = db.prepare("INSERT OR IGNORE INTO messages (id, sender, body, ts, received_ms, seq) VALUES (?, ?, ?, ?, ?, ?)");
        let saved = 0;
        for (const m of messages) if (Number(insert.run(m.id, m.from, m.text, m.timestamp, nowMs, ++nextSeq).changes) === 1) saved++;
        db.exec("COMMIT");
        return { saved, duplicates: messages.length - saved };
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    unprocessed: () => (db.prepare("SELECT * FROM messages WHERE processed = 0 ORDER BY seq").all() as Record<string, any>[]).map((r) => ({ id: r.id, from: r.sender, text: r.body, timestamp: Number(r.ts), receivedMs: Number(r.received_ms) })),
    markProcessed: (id) => { db.prepare("UPDATE messages SET processed = 1, body = '' WHERE id = ?").run(id); }, // what the owner wrote is not kept once it has been answered
    addGuess: (nowMs) => { db.prepare("INSERT INTO guesses (at_ms) VALUES (?)").run(nowMs); },
    guessesSince: (sinceMs) => (db.prepare("SELECT COUNT(*) AS n FROM guesses WHERE at_ms >= ?").get(sinceMs) as { n: number }).n,
    addAlert: (approval, kind, note, nowMs) => Number(db.prepare("INSERT OR IGNORE INTO alerts (approval, kind, note, at_ms) VALUES (?, ?, ?, ?)").run(approval, kind, note, nowMs).changes) === 1,
    alerts: () => (db.prepare("SELECT * FROM alerts ORDER BY at_ms").all() as Record<string, any>[]).map((r) => ({ approval: r.approval, kind: r.kind, note: r.note, atMs: Number(r.at_ms) })),
    getMeta: (key) => (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value,
    setMeta: (key, v) => { db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, v); },
    ping: () => { db.prepare("SELECT 1").get(); },
    close: () => db.close(),
  };
}
