// The runtime's one SQLite file per client agent (Node's built-in node:sqlite, no dependencies). It holds four things:
//   tasks   every event that has been handed to us, saved before we answer, so a restart loses none
//   state   the agent's Store as one JSON snapshot (see snapshot.ts)
//   record  the action record, append-only (the database itself refuses an update or a delete)
//   window  when each person last messaged us, for WhatsApp's 24-hour rule
// A step is saved in ONE transaction: the new snapshot, the record entries it made and the task's "done" mark. So after a
// crash you see a step wholly done or not done at all, never half.
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
  taskCounts(): TaskCounts;
  oldestPendingAt(): number | null;
  /** What the last saved step left: the agent's snapshot (null before the first step) and the whole record. */
  loadState(): { snapshot: string | null; record: RecordEntry[] };
  /** Save one step: snapshot, new record entries and (for a task) its done mark, in one transaction. */
  commitStep(step: { taskId?: string; snapshot: string; entries: readonly RecordEntry[]; nowMs: number }): void;
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
// add a new entry at the end.
const MIGRATIONS: string[] = [
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
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
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
  const oldestPending = db.prepare("SELECT id, kind, payload, received_at, state, attempts, last_error FROM tasks WHERE state = 'pending' ORDER BY seq LIMIT 1");
  const countAttempt = db.prepare("UPDATE tasks SET attempts = attempts + 1 WHERE id = ? RETURNING attempts");
  const failOne = db.prepare("UPDATE tasks SET last_error = ?, state = ? WHERE id = ?");
  const finishOne = db.prepare("UPDATE tasks SET state = 'done', payload = '{}', last_error = NULL WHERE id = ?");
  const counts = db.prepare("SELECT state, count(*) AS n FROM tasks GROUP BY state");
  const oldestAt = db.prepare("SELECT min(received_at) AS at FROM tasks WHERE state = 'pending'");
  const readSnapshot = db.prepare("SELECT snapshot FROM state WHERE id = 1");
  const readRecord = db.prepare("SELECT entry FROM record ORDER BY seq");
  const saveSnapshot = db.prepare("INSERT INTO state (id, snapshot, saved_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET snapshot = excluded.snapshot, saved_at = excluded.saved_at");
  const addEntry = db.prepare("INSERT INTO record (seq, time, conversation, booking, action, outcome, entry) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const emptyOldFailed = db.prepare("UPDATE tasks SET payload = '{}' WHERE state = 'failed' AND payload <> '{}' AND received_at < ?");

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
      return { id: row.id as string, kind: row.kind as Task["kind"], payload: row.payload as string, receivedAt: row.received_at as number, state: row.state as TaskState, attempts: row.attempts as number, lastError: row.last_error as string | null };
    },

    startAttempt: (id) => (countAttempt.get(id) as { attempts: number }).attempts,
    failTask(id, error, final) { failOne.run(error.slice(0, 500), final ? "failed" : "pending", id); },

    taskCounts() {
      const result: TaskCounts = { pending: 0, done: 0, failed: 0 };
      for (const row of counts.all() as { state: TaskState; n: number }[]) result[row.state] = row.n;
      return result;
    },
    oldestPendingAt: () => (oldestAt.get() as { at: number | null }).at,

    loadState() {
      const row = readSnapshot.get() as { snapshot: string } | undefined;
      return { snapshot: row?.snapshot ?? null, record: (readRecord.all() as { entry: string }[]).map((r) => JSON.parse(r.entry) as RecordEntry) };
    },

    commitStep({ taskId, snapshot, entries, nowMs }) {
      inTransaction(db, () => {
        saveSnapshot.run(snapshot, nowMs);
        for (const e of entries) addEntry.run(e.seq, e.time, e.conversation, e.booking, e.action, e.outcome, JSON.stringify(e));
        if (taskId !== undefined) finishOne.run(taskId);
      });
    },

    lastInboundAt: (phone) => (lastInbound.get(phone) as { last_inbound_at: number } | undefined)?.last_inbound_at,
    compactTurns: (beforeMs) => Number(emptyOldFailed.run(beforeMs).changes),
    ping() { db.prepare("SELECT count(*) FROM sqlite_master").get(); },
    close() { if (db.isOpen) db.close(); },
  };
}
