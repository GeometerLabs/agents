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

/** The object in the snapshot, and the file it opens to. */
export const OWNER_KEEP_OBJECT = "runtime/owner-keep.json.gz.age";
export const OWNER_KEEP_FILE = "runtime/owner-keep.json";

type Row = Record<string, string | number | null>;
export interface OwnerKeep {
  schema: 1;
  ownerAccess: { meta: Row[]; passkeys: Row[]; grantsUsed: Row[] };
  push: { meta: Row[]; subs: Row[] };
}

/** The meta names each side keeps (anything else in meta, like the sign-out marker, is not carried). */
const ACCESS_META = ["webauthn_user"];
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
  const keep: OwnerKeep = {
    schema: 1,
    ownerAccess: { meta: metaOf(access, ACCESS_META), passkeys: rows(access, "SELECT * FROM passkeys ORDER BY made_at"), grantsUsed: rows(access, "SELECT * FROM grants_used ORDER BY used_at") },
    push: { meta: metaOf(push, PUSH_META), subs: rows(push, "SELECT * FROM subs WHERE dead_at IS NULL ORDER BY made_at") },
  };
  return keep.ownerAccess.passkeys.length === 0 && keep.push.subs.length === 0 ? null : keep;
}

/** Why a file is not an owner-keep file, or null. A restore checks this before anything is stopped. */
export function ownerKeepProblem(v: unknown): string | null {
  const k = v as Partial<OwnerKeep> | null;
  if (!k || typeof k !== "object" || k.schema !== 1 || !k.ownerAccess || !k.push) return "not an owner-keep file (schema 1)";
  for (const a of [k.ownerAccess.meta, k.ownerAccess.passkeys, k.ownerAccess.grantsUsed, k.push.meta, k.push.subs]) if (!Array.isArray(a)) return "a table of it is not a list";
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

export interface Put { passkeys: number; subscriptions: number }

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
