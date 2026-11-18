// What the owner would otherwise lose in a restore (pre-release batch 7, item 2): their passkeys and their alert subscriptions.
//
// They live in two small SQLite files of their own beside the shop's agent.db, not in it (modules/channels/owner-access.ts: owner-access.sqlite; modules/push/store.ts:
// push.sqlite), so the nightly snapshot of agent.db never held them, and a restored shop signed the owner out and turned their alerts off until they set both up again.
// This file reads the few tables that matter into ONE small JSON file for the snapshot, and puts them back on a restore:
//   owner-access.sqlite:  passkeys (the public key, the counter, the credential id: no secret, the private half never leaves the phone), grants_used (which setup QR and
//                         recovery codes were used, as hashes, so a used QR does not work again), and the shop's WebAuthn user id (meta webauthn_user, without which the phone
//                         would offer a different passkey for the shop).
//   push.sqlite:          subs (each subscription's push address and its two keys: together a SECRET, whoever holds them can encrypt to that phone), the shop's VAPID keys
//                         (a subscription only accepts pushes signed by the key it was made with, so the keys must come back with it) and the owner's choice (meta owner_choice).
//   chat-identity.sqlite: (W2, 17 Nov 2026) the customers' keys for the chat (public keys and counters), each thread's own WebAuthn user id, the number a guest gave for a new phone,
//                         which phones hold a key and which phones are tied to which thread, so a restored shop does not turn every returning customer back into a stranger.
//                         Not kept: one-time links, challenges and counters (short-lived). The export ("leave with your shop") carries the record, not this file, as it carries
//                         neither owner-access.sqlite nor push.sqlite; and removing a shop removes its whole data volume, this file with it.
// Not kept: sessions (a restore signs the browser in again with the passkey, one tap), one-time links, challenges, counters and the waiting alerts. They are short-lived
// and a restore is a good moment for them to start fresh.
// The file is encrypted to the owner's key like the rest of the snapshot (snapshot.ts). Passkey public keys are not secrets, but the file is handled as the record is, as
// one piece, because the subscriptions in it are.
//
// Put back with the shop's runtime STOPPED, and as a merge: a row the live file already has is left as it is (the live file is newer than any snapshot, and a passkey the owner
// removed since must not come back). The two meta values that tie rows to their key (the WebAuthn user id, the VAPID keys) come from the snapshot only when the live file has
// none of the rows they belong to, so a fresh install that already made its own is not left half old and half new.
//   node bundle/backup/owner-keep.ts import <data folder> <owner-keep.json>        (the restore, in a short-lived container with the shop's data volume)
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { OWNER_ACCESS_FILE, openOwnerAccess } from "../../modules/channels/owner-access.ts";
import { PUSH_FILE, openPushStore } from "../../modules/push/store.ts";
import { CHAT_IDENTITY_FILE, openChatIdentity } from "../../modules/channels/chat-identity.ts";

/** The object in the snapshot, and the file it opens to. */
export const OWNER_KEEP_OBJECT = "runtime/owner-keep.json.gz.age";
export const OWNER_KEEP_FILE = "runtime/owner-keep.json";

type Row = Record<string, string | number | null>;
export interface OwnerKeep {
  schema: 1;
  /** `ownCodes` (owner's item 2): the owner's own recovery codes, as hashes. Left out of a snapshot made before them. */
  ownerAccess: { meta: Row[]; passkeys: Row[]; grantsUsed: Row[]; ownCodes?: Row[]; grantsSeen?: Row[]; removals?: Row[]; ownSetups?: Row[] };
  push: { meta: Row[]; subs: Row[] };
  /** W2: the customers' chat keys and ties. Left out of a snapshot made before it, and when the shop has none. */
  chatIdentity?: { creds: Row[]; users: Row[]; contact: Row[]; phones: Row[]; alias: Row[] };
}
const CHAT_TABLES = ["creds", "users", "contact", "phones", "alias"] as const;

/** The meta names each side keeps (anything else in meta, like the sign-out marker, is not carried). */
// Owner's item 2: the runtime's own gate (owner-access.ts) is carried too, so a shop moved to another server keeps "the owner holds a passkey" and the moment passkeys were
// last cleared; without them a restored shop would take the old Operator card as new.
const ACCESS_META = ["webauthn_user", "passkeys_before", "reopen_at", "reset_at", "adopted"];
const PUSH_META = ["vapid", "owner_choice"];

/** All rows of a query, or none when the file or the table is not there (an older shop, or no sign-in yet). */
function rows(file: string, sql: string, params: string[] = []): Row[] {
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec("PRAGMA busy_timeout = 5000"); return db.prepare(sql).all(...params) as Row[]; } catch { return []; } finally { db.close(); }
}
const metaOf = (file: string, names: string[]): Row[] => rows(file, `SELECT name, value FROM meta WHERE name IN (${names.map(() => "?").join(",")})`, names);

/** What the owner would lose, read from the shop's data folder. Null when there is nothing (no passkey, no subscription): then nothing goes in the snapshot. */
export function readOwnerKeep(dataDir: string): OwnerKeep | null {
  const access = join(dataDir, OWNER_ACCESS_FILE); const push = join(dataDir, PUSH_FILE);
  const chat = join(dataDir, CHAT_IDENTITY_FILE);
  const chatIdentity = { creds: rows(chat, "SELECT * FROM creds ORDER BY made_at"), users: rows(chat, "SELECT * FROM users"), contact: rows(chat, "SELECT * FROM contact"), phones: rows(chat, "SELECT * FROM phones"), alias: rows(chat, "SELECT * FROM alias") };
  const keep: OwnerKeep = {
    schema: 1,
    ownerAccess: { meta: metaOf(access, ACCESS_META), passkeys: rows(access, "SELECT * FROM passkeys ORDER BY made_at"), grantsUsed: rows(access, "SELECT * FROM grants_used ORDER BY used_at"), ownCodes: rows(access, "SELECT * FROM own_codes ORDER BY made_at"), grantsSeen: rows(access, "SELECT * FROM grants_seen ORDER BY first_seen"), removals: rows(access, "SELECT * FROM removals ORDER BY seen_at"), ownSetups: rows(access, "SELECT * FROM own_setups ORDER BY made_at") },
    push: { meta: metaOf(push, PUSH_META), subs: rows(push, "SELECT * FROM subs WHERE dead_at IS NULL ORDER BY made_at") },
  };
  if (chatIdentity.creds.length > 0 || chatIdentity.contact.length > 0) keep.chatIdentity = chatIdentity;
  return keep.ownerAccess.passkeys.length === 0 && keep.push.subs.length === 0 && !keep.chatIdentity ? null : keep;
}

/** Why a file is not an owner-keep file, or null. A restore checks this before anything is stopped. */
export function ownerKeepProblem(v: unknown): string | null {
  const k = v as Partial<OwnerKeep> | null;
  if (!k || typeof k !== "object" || k.schema !== 1 || !k.ownerAccess || !k.push) return "not an owner-keep file (schema 1)";
  for (const a of [k.ownerAccess.meta, k.ownerAccess.passkeys, k.ownerAccess.grantsUsed, k.push.meta, k.push.subs]) if (!Array.isArray(a)) return "a table of it is not a list";
  if (k.chatIdentity !== undefined) for (const t of CHAT_TABLES) if (!Array.isArray(k.chatIdentity[t])) return `the chat identity's ${t} is not a list`;
  return null;
}

/** Insert rows by their own column names, leaving a row that is already there. Only the names the table has are used, so a newer snapshot's extra column cannot break an older runtime. */
function putRows(db: DatabaseSync, table: string, list: Row[]): number {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  let n = 0;
  for (const row of list) {
    const cols = Object.keys(row).filter((c) => have.has(c));
    if (cols.length === 0) continue;
    const r = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c] as string | number | null));
    n += Number(r.changes);
  }
  return n;
}

export interface Put { passkeys: number; subscriptions: number; chatKeys?: number }

/** Put the snapshot's passkeys and subscriptions into the shop's data folder, with the runtime stopped. The stores' own open functions make the tables if the files are new. */
export function putOwnerKeep(dataDir: string, keep: OwnerKeep): Put {
  const problem = ownerKeepProblem(keep);
  if (problem) throw new Error(`the owner's passkeys and alerts in the snapshot cannot be put back: ${problem}`);
  openOwnerAccess(join(dataDir, OWNER_ACCESS_FILE)).close();
  openPushStore(join(dataDir, PUSH_FILE)).close();
  const result: Put = { passkeys: 0, subscriptions: 0 };
  const access = new DatabaseSync(join(dataDir, OWNER_ACCESS_FILE));
  try {
    access.exec("BEGIN IMMEDIATE");
    const live = Number((access.prepare("SELECT count(*) AS n FROM passkeys").get() as { n: number }).n);
    // the user id goes with the passkeys: a live file with passkeys of its own keeps its own id
    if (live === 0) { access.prepare("DELETE FROM meta WHERE name = 'webauthn_user'").run(); }
    putRows(access, "meta", keep.ownerAccess.meta.filter((m) => ACCESS_META.includes(String(m.name))));
    result.passkeys = putRows(access, "passkeys", keep.ownerAccess.passkeys);
    putRows(access, "grants_used", keep.ownerAccess.grantsUsed);
    // the gate's memory comes back too, or a restored shop would take every QR and card in the Operator's file as new (and so as good); voided and cancelled rows stay so
    if (keep.ownerAccess.ownCodes) putRows(access, "own_codes", keep.ownerAccess.ownCodes);
    if (keep.ownerAccess.grantsSeen) putRows(access, "grants_seen", keep.ownerAccess.grantsSeen);
    if (keep.ownerAccess.removals) putRows(access, "removals", keep.ownerAccess.removals);
    if (keep.ownerAccess.ownSetups) putRows(access, "own_setups", keep.ownerAccess.ownSetups);
    access.exec("COMMIT");
  } finally { access.close(); }
  const push = new DatabaseSync(join(dataDir, PUSH_FILE));
  try {
    push.exec("BEGIN IMMEDIATE");
    const live = Number((push.prepare("SELECT count(*) AS n FROM subs WHERE dead_at IS NULL").get() as { n: number }).n);
    if (live === 0) push.prepare("DELETE FROM meta WHERE name = 'vapid'").run();
    // the owner's choice is kept if the live file already has one
    putRows(push, "meta", keep.push.meta.filter((m) => PUSH_META.includes(String(m.name))));
    result.subscriptions = putRows(push, "subs", keep.push.subs);
    push.exec("COMMIT");
  } finally { push.close(); }
  if (keep.chatIdentity) {
    openChatIdentity(join(dataDir, CHAT_IDENTITY_FILE)).close();
    const chat = new DatabaseSync(join(dataDir, CHAT_IDENTITY_FILE));
    try {
      chat.exec("BEGIN IMMEDIATE");
      for (const t of CHAT_TABLES) { const n = putRows(chat, t, keep.chatIdentity[t]); if (t === "creds") result.chatKeys = n; } // a row the live file has is left as it is
      chat.exec("COMMIT");
    } finally { chat.close(); }
  }
  return result;
}

if (import.meta.main) {
  const [cmd, dir, file] = process.argv.slice(2);
  if (cmd !== "import" || !dir || !file) { console.error("usage: owner-keep.ts import <data folder> <owner-keep.json>"); process.exit(2); }
  try {
    const put = putOwnerKeep(dir, JSON.parse(readFileSync(file, "utf8")) as OwnerKeep);
    console.log(JSON.stringify({ ok: true, ...put }));
  } catch (e) { console.log(JSON.stringify({ ok: false, error: (e as Error).message })); process.exit(1); }
}
