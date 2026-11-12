// The runtime's one SQLite file per client agent (Node's built-in node:sqlite, no dependencies). It holds four things:
//   tasks   every event that has been handed to us, saved before we answer, so a restart loses none. A task that waits for a Guard stays `pending` here, with the Guard's
//           service and when to look again, so a waiting task survives a restart and the counts a heartbeat sends do not change shape (guard-wait.ts)
//   state   the agent's Store as one JSON snapshot (see snapshot.ts), kept in pieces (state_shape and state_rows, below)
//   record  the action record, append-only (the database itself refuses an update or a delete)
//   window  when each person last messaged us, for WhatsApp's 24-hour rule
// A step is saved in ONE transaction: the new snapshot, the record entries it made and the task's "done" mark. So after a
// crash you see a step wholly done or not done at all, never half.
//
// THE SNAPSHOT IN PIECES (layout 3, 11 Nov 2026). Until layout 2 the whole snapshot was one row, written again by every step, and a snapshot only grows (every booking,
// order or fee and every message id ever seen stays in it): a year-old salon would have written about 11 MiB a step. Now each list in the snapshot is kept one element
// to a row (`state_rows`): a top-level list (a template's bookings, customers, seen message ids) and a list one level inside a top-level object (a UPI shop's requests and
// refunds). What is left (the counters, the month's AI counts) is a small `state_shape`, with null where each list was. A step writes the shape and only the rows whose
// element changed or is new, so what it writes no longer depends on how old the shop is. The pieces are written in the same transaction as before, so a crash still
// leaves a step whole or absent, and the snapshot read back is byte for byte the one saved (`splitSnapshot` refuses to split any text it could not give back exactly).
// The interface did not change: a step still hands in the whole snapshot, and `loadState` still gives the whole snapshot back.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RecordEntry } from "../record/record.ts";
import { eventKey } from "./events.ts";
import type { IncomingEvent } from "./events.ts";

/** Same shape as the live adapters' WindowStore. */
export interface WindowStore { lastInboundAt(phone: string): number | undefined }

export type TaskState = "pending" | "done" | "failed";

export interface Task {
  id: string; // "message:<wamid>" or "payment_event:<evt>": the event's own id, so a redelivery is the same task
  kind: IncomingEvent["kind"];
  payload: string; // the event as JSON; emptied once the task is done (message text is not kept, only digests in the record)
  receivedAt: number;
  state: TaskState;
  attempts: number; // counted BEFORE a step runs, so a step that kills the process cannot loop forever
  lastError: string | null;
  /** The service whose Guard this task is waiting for ("payments", "calendar", "messaging"), or null when it is not waiting. */
  waitingOn: string | null;
  /** When to look at that Guard again (epoch milliseconds). */
  retryAt: number | null;
}

export interface TaskCounts { pending: number; done: number; failed: number }

export interface DurableStore extends WindowStore {
  readonly file: string;
  /** Save new events as pending tasks and note when each sender last wrote. All or nothing. Ids already seen are skipped. */
  saveEvents(events: IncomingEvent[], nowMs: number): { saved: number; duplicates: number };
  /** The oldest task still pending, if any. */
  nextPending(): Task | undefined;
  /** Count one more attempt, saved at once. Returns the new number. */
  startAttempt(id: string): number;
  /** Keep the error. `final` marks the task failed; otherwise it stays pending for another try. */
  failTask(id: string, error: string, final: boolean): void;
  /**
   * This step found a Guard unreachable and nothing of it was saved: the task stays pending and waits. The attempt `startAttempt` counted is taken back in the same write,
   * because finding a Guard down is not the task's fault and must not use up its tries, while a process that dies inside a step still counts (startAttempt runs before it).
   */
  parkTask(id: string, on: string, retryAt: number, error: string): void;
  /** The Guard still does not answer: look again later. The task's attempts are not touched. */
  postponeTask(id: string, retryAt: number): void;
  taskCounts(): TaskCounts;
  /** Where one task is, by its key (events.ts eventKey): a channel's status read asks this for a request the agent has not run yet. Undefined: no such task. */
  taskState?(key: string): "pending" | "done" | "failed" | undefined;
  oldestPendingAt(): number | null;
  /** What the last saved step left: the agent's snapshot (null before the first step) and the whole record. */
  loadState(): { snapshot: string | null; record: RecordEntry[] };
  /**
   * Save one step: snapshot, new record entries and (for a task) its done mark, in one transaction. `failedWith`: the task ended without its work done (it gave up waiting
   * for a Guard), so it is marked failed instead and keeps its event for a person, in the same transaction as the record entry that says so.
   */
  commitStep(step: { taskId?: string; snapshot: string; entries: readonly RecordEntry[]; nowMs: number; failedWith?: string }): void;
  /**
   * The text of conversations that are over: a failed task keeps its event (the message as the person wrote it) for a person to look at, until `beforeMs`; then
   * only its outcome is kept (its id, kind, state and error). A done task's text is emptied when it is done. Never touches the record. Returns how many were emptied.
   */
  compactTurns(beforeMs: number): number;
  /** Throws if the database cannot be read. */
  ping(): void;
  close(): void;
}

// Each entry is one schema version, applied in order and recorded in PRAGMA user_version. Never edit one that has shipped:
// add a new entry at the end. An entry is SQL, or a function when the data itself has to be moved (it runs inside the version's transaction).
const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
  `
  CREATE TABLE tasks (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE INDEX tasks_by_state ON tasks (state, seq);
  CREATE TABLE state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  );
  CREATE TABLE record (
    seq INTEGER PRIMARY KEY,
    time TEXT NOT NULL,
    conversation TEXT NOT NULL,
    booking TEXT,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    entry TEXT NOT NULL
  );
  CREATE INDEX record_by_booking ON record (booking);
  CREATE TRIGGER record_no_update BEFORE UPDATE ON record BEGIN SELECT RAISE(ABORT, 'the record is append-only'); END;
  CREATE TRIGGER record_no_delete BEFORE DELETE ON record BEGIN SELECT RAISE(ABORT, 'the record is append-only'); END;
  CREATE TABLE window (
    phone TEXT PRIMARY KEY,
    last_inbound_at INTEGER NOT NULL
  );
  `,
  // Waiting for a Guard (guard-wait.ts). Columns, not a new `state`: the CHECK on `state` could only change by rebuilding the table, and a waiting task IS pending.
  `
  ALTER TABLE tasks ADD COLUMN waiting_on TEXT;
  ALTER TABLE tasks ADD COLUMN retry_at INTEGER;
  `,
  // Layout 3: the snapshot in pieces (see the top of this file). The one-row `state` table is moved into them and dropped, so a reader that still asks for it is told
  // so plainly ("no such table") instead of reading a stale or partial snapshot. Going back to a runtime of layout 2 is refused by the deployer (bundle/handcheck.ts).
  (db) => {
    db.exec(`
      CREATE TABLE state_shape (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        shape TEXT NOT NULL,
        lists TEXT NOT NULL,
        version INTEGER NOT NULL,
        saved_at INTEGER NOT NULL
      );
      CREATE TABLE state_rows (
        list TEXT NOT NULL,
        pos INTEGER NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (list, pos)
      ) WITHOUT ROWID;
    `);
    const old = db.prepare("SELECT snapshot, saved_at FROM state WHERE id = 1").get() as { snapshot: string; saved_at: number } | undefined;
    if (old) writeSnapshot(db, undefined, splitSnapshot(old.snapshot), old.saved_at);
    db.exec("DROP TABLE state");
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

function migrate(db: DatabaseSync): void {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current > SCHEMA_VERSION) {
    throw new Error(`This data was written by a newer version of the runtime (schema ${current}; this one knows ${SCHEMA_VERSION}). Update the runtime, or restore an older copy of the data.`);
  }
  for (let version = current; version < SCHEMA_VERSION; version++) {
    inTransaction(db, () => {
      const step = MIGRATIONS[version];
      if (typeof step === "string") db.exec(step); else step(db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

// ---- the snapshot in pieces (layout 3; the top of this file says why) ------------------------------------------------------------------------------------

/** A snapshot taken apart: the shape (the snapshot with null where each list was), the lists' paths in the order they come, and each list's elements as JSON text. */
export interface SplitSnapshot { shape: string; lists: string[]; rows: Map<string, string[]> }

/** The pieces as stored, and the version of the save that wrote them. */
interface Stored { split: SplitSnapshot; version: number }

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Take a snapshot apart: each top-level list, and each list one level inside a top-level object, becomes its elements. Only text that its own parse gives back byte for
 * byte is split (what JSON.stringify writes, which is what every template's codec writes, modules/runtime/snapshot.ts). Anything else (a hand-written test snapshot with
 * spaces, text that is not a JSON object) is kept whole as the shape with no lists, and so is read back exactly as it was given.
 */
export function splitSnapshot(snapshot: string): SplitSnapshot {
  const whole: SplitSnapshot = { shape: snapshot, lists: [], rows: new Map() };
  let top: unknown;
  try { top = JSON.parse(snapshot); } catch { return whole; }
  if (!isPlainObject(top) || JSON.stringify(top) !== snapshot) return whole;
  const lists: string[] = [];
  const rows = new Map<string, string[]>();
  const take = (holder: Record<string, unknown>, key: string, path: string[]): boolean => {
    const value = holder[key];
    if (!Array.isArray(value)) return false;
    const name = JSON.stringify(path);
    lists.push(name);
    rows.set(name, value.map((element) => JSON.stringify(element)));
    holder[key] = null; // the shape keeps the key where it was, so the keys come back in the same order
    return true;
  };
  for (const key of Object.keys(top)) {
    if (key === "__proto__") continue; // no codec writes it; it stays in the shape, never assigned by name (which would set a prototype)
    if (take(top, key, [key])) continue;
    const inner = top[key];
    if (isPlainObject(inner)) for (const key2 of Object.keys(inner)) if (key2 !== "__proto__") take(inner, key2, [key, key2]);
  }
  return { shape: JSON.stringify(top), lists, rows };
}

/** Put a split snapshot back together. For text `splitSnapshot` split, this is that text again, byte for byte: the keys keep their places, and each element is its own JSON. */
export function joinSnapshot(split: SplitSnapshot): string {
  if (split.lists.length === 0) return split.shape;
  const top = JSON.parse(split.shape) as Record<string, unknown>;
  for (const name of split.lists) {
    const path = JSON.parse(name) as string[];
    const items = (split.rows.get(name) ?? []).map((text) => JSON.parse(text) as unknown);
    if (path.length === 1) top[path[0]] = items;
    else (top[path[0]] as Record<string, unknown>)[path[1]] = items;
  }
  return JSON.stringify(top);
}

/** The stored pieces, read whole (the shape row and every element row); undefined before the first save. A list with a missing place is refused, never closed up. */
function readPieces(db: DatabaseSync): Stored | undefined {
  const head = db.prepare("SELECT shape, lists, version FROM state_shape WHERE id = 1").get() as { shape: string; lists: string; version: number } | undefined;
  if (!head) return undefined;
  const lists = JSON.parse(head.lists) as string[];
  const rows = new Map<string, string[]>(lists.map((name) => [name, []]));
  for (const r of db.prepare("SELECT list, pos, value FROM state_rows ORDER BY list, pos").all() as { list: string; pos: number; value: string }[]) {
    const into = rows.get(r.list);
    if (!into || r.pos !== into.length) throw new Error(`The saved state is damaged: list ${r.list} has a row at place ${r.pos} that does not follow on. Restore the database from a snapshot.`);
    into.push(r.value);
  }
  return { split: { shape: head.shape, lists, rows }, version: head.version };
}

/**
 * Write a snapshot's pieces over the stored ones (`before`; undefined when nothing is stored yet). The shape row always (it carries the save's version); of each list
 * only the elements that differ, are new, or are gone. Elements are compared by their place: a template's lists only grow at the end or change in place (snapshot.ts
 * writes Maps and Sets in their own order, and no template deletes from them), so a step writes a few rows. A list that shrinks or moves is written again from the first
 * place that differs, and is still right. Runs inside the caller's transaction. Returns the new version.
 */
function writeSnapshot(db: DatabaseSync, before: Stored | undefined, next: SplitSnapshot, nowMs: number): number {
  const version = (before?.version ?? 0) + 1;
  db.prepare("INSERT INTO state_shape (id, shape, lists, version, saved_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET shape = excluded.shape, lists = excluded.lists, version = excluded.version, saved_at = excluded.saved_at")
    .run(next.shape, JSON.stringify(next.lists), version, nowMs);
  const update = db.prepare("UPDATE state_rows SET value = ? WHERE list = ? AND pos = ?");
  const insert = db.prepare("INSERT INTO state_rows (list, pos, value) VALUES (?, ?, ?)");
  const cut = db.prepare("DELETE FROM state_rows WHERE list = ? AND pos >= ?");
  for (const name of next.lists) {
    const now = next.rows.get(name) ?? [];
    const was = before?.split.rows.get(name) ?? [];
    for (let i = 0; i < now.length; i++) {
      if (i >= was.length) insert.run(name, i, now[i]);
      else if (was[i] !== now[i]) update.run(now[i], name, i);
    }
    if (was.length > now.length) cut.run(name, now.length);
  }
  for (const name of before?.split.lists ?? []) if (!next.rows.has(name)) cut.run(name, 0);
  return version;
}

/**
 * The last saved snapshot, from an open database of either layout. For readers outside the runtime (the bundle's export, bundle/backup/export.ts): a shop held back on a
 * version from before layout 3 still has the one-row `state` table. Null before the first step.
 */
export function readSnapshot(db: DatabaseSync): string | null {
  const has = (table: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
  if (has("state_shape")) { const stored = readPieces(db); return stored ? joinSnapshot(stored.split) : null; }
  if (has("state")) return (db.prepare("SELECT snapshot FROM state WHERE id = 1").get() as { snapshot: string } | undefined)?.snapshot ?? null;
  return null;
}

/** Open (or create) `<dataDir>/agent.db`, ready to use. Only one process may use a data directory at a time. */
export function openStore(dataDir: string): DurableStore {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "agent.db");
  const db = new DatabaseSync(file);
  try {
    const mode = (db.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode: string }).journal_mode;
    if (mode !== "wal") throw new Error(`SQLite would not switch ${file} to write-ahead logging (it said "${mode}"). Use a data directory on a local disk.`);
    db.exec("PRAGMA synchronous = FULL"); // a commit is on disk before we answer 200, even if the power goes
    db.exec("PRAGMA busy_timeout = 5000");
    migrate(db);
  } catch (e) {
    db.close();
    throw e;
  }

  const insertTask = db.prepare("INSERT OR IGNORE INTO tasks (id, kind, payload, received_at) VALUES (?, ?, ?, ?)");
  const noteInbound = db.prepare("INSERT INTO window (phone, last_inbound_at) VALUES (?, ?) ON CONFLICT (phone) DO UPDATE SET last_inbound_at = max(last_inbound_at, excluded.last_inbound_at)");
  const lastInbound = db.prepare("SELECT last_inbound_at FROM window WHERE phone = ?");
  const oldestPending = db.prepare("SELECT id, kind, payload, received_at, state, attempts, last_error, waiting_on, retry_at FROM tasks WHERE state = 'pending' ORDER BY seq LIMIT 1");
  const countAttempt = db.prepare("UPDATE tasks SET attempts = attempts + 1 WHERE id = ? RETURNING attempts");
  const failOne = db.prepare("UPDATE tasks SET last_error = ?, state = ?, waiting_on = NULL, retry_at = NULL WHERE id = ?");
  const finishOne = db.prepare("UPDATE tasks SET state = 'done', payload = '{}', last_error = NULL, waiting_on = NULL, retry_at = NULL WHERE id = ?");
  const parkOne = db.prepare("UPDATE tasks SET waiting_on = ?, retry_at = ?, last_error = ?, attempts = max(attempts - 1, 0) WHERE id = ?");
  const postponeOne = db.prepare("UPDATE tasks SET retry_at = ? WHERE id = ?");
  const counts = db.prepare("SELECT state, count(*) AS n FROM tasks GROUP BY state");
  const oldestAt = db.prepare("SELECT min(received_at) AS at FROM tasks WHERE state = 'pending'");
  const oneState = db.prepare("SELECT state FROM tasks WHERE id = ?");
  const readRecord = db.prepare("SELECT entry FROM record ORDER BY seq");
  const shapeVersion = db.prepare("SELECT version FROM state_shape WHERE id = 1");
  const addEntry = db.prepare("INSERT INTO record (seq, time, conversation, booking, action, outcome, entry) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const emptyOldFailed = db.prepare("UPDATE tasks SET payload = '{}' WHERE state = 'failed' AND payload <> '{}' AND received_at < ?");

  // The pieces as this handle last read or wrote them, so a step is compared with them without reading the whole state again. Trusted only while the stored version is
  // the one it was taken at: another handle on the same file (the tests open two; a restore puts a new file in place) moves the version, and then the rows are read again.
  let held: Stored | undefined;
  /** The stored pieces as they are now. Called inside the save's transaction, so nothing can write between this look and the save. */
  function stored(): Stored | undefined {
    const version = (shapeVersion.get() as { version: number } | undefined)?.version;
    if (version === undefined) return undefined;
    if (held?.version !== version) held = readPieces(db);
    return held;
  }

  return {
    file,

    saveEvents(events, nowMs) {
      return inTransaction(db, () => {
        let saved = 0;
        for (const event of events) {
          if (Number(insertTask.run(eventKey(event), event.kind, JSON.stringify(event), nowMs).changes) === 0) continue;
          saved++;
          // The window opens when the person wrote, not when the step runs: the reply to this very message must find it open.
          if (event.kind === "message") noteInbound.run(event.message.from, Math.min(event.message.timestamp, nowMs));
        }
        return { saved, duplicates: events.length - saved };
      });
    },

    nextPending() {
      const row = oldestPending.get() as Record<string, string | number | null> | undefined;
      if (!row) return undefined;
      return { id: row.id as string, kind: row.kind as Task["kind"], payload: row.payload as string, receivedAt: row.received_at as number, state: row.state as TaskState, attempts: row.attempts as number, lastError: row.last_error as string | null, waitingOn: row.waiting_on as string | null, retryAt: row.retry_at as number | null };
    },

    startAttempt: (id) => (countAttempt.get(id) as { attempts: number }).attempts,
    failTask(id, error, final) { failOne.run(error.slice(0, 500), final ? "failed" : "pending", id); },
    parkTask(id, on, retryAt, error) { parkOne.run(on, retryAt, error.slice(0, 500), id); },
    postponeTask(id, retryAt) { postponeOne.run(retryAt, id); },

    taskCounts() {
      const result: TaskCounts = { pending: 0, done: 0, failed: 0 };
      for (const row of counts.all() as { state: TaskState; n: number }[]) result[row.state] = row.n;
      return result;
    },
    oldestPendingAt: () => (oldestAt.get() as { at: number | null }).at,

    loadState() {
      held = readPieces(db);
      return { snapshot: held ? joinSnapshot(held.split) : null, record: (readRecord.all() as { entry: string }[]).map((r) => JSON.parse(r.entry) as RecordEntry) };
    },

    commitStep({ taskId, snapshot, entries, nowMs, failedWith }) {
      const next = splitSnapshot(snapshot); // outside the transaction: it reads nothing stored
      const saved = inTransaction(db, () => {
        const version = writeSnapshot(db, stored(), next, nowMs);
        for (const e of entries) addEntry.run(e.seq, e.time, e.conversation, e.booking, e.action, e.outcome, JSON.stringify(e));
        if (taskId !== undefined) {
          if (failedWith === undefined) finishOne.run(taskId);
          else failOne.run(failedWith.slice(0, 500), "failed", taskId);
        }
        return { split: next, version };
      });
      held = saved; // only once the transaction is committed: a save that was rolled back leaves this handle's copy as it was
    },

    lastInboundAt: (phone) => (lastInbound.get(phone) as { last_inbound_at: number } | undefined)?.last_inbound_at,
    compactTurns: (beforeMs) => Number(emptyOldFailed.run(beforeMs).changes),
    ping() { db.prepare("SELECT count(*) FROM sqlite_master").get(); },
    taskState(key) { return (oneState.get(key) as { state: "pending" | "done" | "failed" } | undefined)?.state; },
    close() { if (db.isOpen) db.close(); },
  };
}
