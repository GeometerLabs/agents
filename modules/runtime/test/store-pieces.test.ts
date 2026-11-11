// The runtime's saved state in pieces (store.ts, layout 3): what a step writes no longer grows with the shop's age, and nothing else changes. The snapshot read back is
// the one saved, byte for byte; a save that is rolled back leaves it as it was; two handles on one file stay right; a file of layout 2 is moved over when it is opened;
// and the bundle's export reads either layout. The templates' own tests (store.test.ts, runtime.test.ts) run their real stores through the same code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, joinSnapshot, openStore, readSnapshot, splitSnapshot } from "../store.ts";
import type { RecordEntry } from "../../record/record.ts";

/** A booking about the size of a real one in the proof (about 0.8 KiB written out). */
function booking(n: number, state = "completed") {
  return [`b-${n}`, {
    id: `b-${n}`, customer: `+9198${String(10_000_000 + n).padStart(8, "0")}`, language: "en", state, serviceId: "haircut", date: { year: 2026, month: 11, day: 1 + (n % 28) },
    timePhrase: { kind: "clock", hour: 6, minute: 0, period: "pm" }, time: { hour: 18, minute: 0 }, dateNeedsConfirmation: false, timeInferred: false, startMs: 1_790_000_000_000 + n * 3_600_000,
    endMs: 1_790_000_000_000 + n * 3_600_000 + 1_800_000, eventId: `ev_${n}`, holdExpiresAt: 1_790_000_000_000 + n * 3_600_000 - 900_000, linkId: `plink_${n}`, linkUrl: `https://rzp.io/l/plink${n}`,
    depositPaymentId: `pay_${n}`, depositInr: 200, handledPayments: [`pay_${n}`], reminders: [{ atMs: 1_790_000_000_000 + n * 3_600_000 - 86_400_000, sent: true }], pending: [],
  }] as const;
}

/** A Bookings-shaped snapshot of a shop with `n` past bookings, the way the codec writes it, with a UPI shop's ledger (its lists grow with the shop too). */
function snapshotOf(n: number, extra = 0): string {
  const bookings = Array.from({ length: n + extra }, (_, i) => booking(i + 1, i < n ? "completed" : "awaiting_deposit"));
  const customers = bookings.map(([, b]) => [b.customer, { phone: b.customer, language: "en", optedOut: false }]);
  const requests = Array.from({ length: n + extra }, (_, i) => ({ id: `upi_${i + 1}`, reference: `b-${i + 1}`, amountPaise: 20_000, code: null, usedCodes: [`C${i}`], marks: [{ id: `m_${i}`, amountPaise: 20_000, atMs: i }], status: "paid" }));
  return JSON.stringify({
    format: 1, bookings, customers, seenMessages: bookings.map(([id]) => `wamid.${id}`), seenEvents: bookings.map(([id]) => `evt_${id}`), nextBooking: n + extra + 1,
    ai: { month: "2026-11", messages: n + extra, costMicroInr: 1_000 * (n + extra) }, upi: { seq: n + extra, requests, refunds: [] },
  });
}

function tempDir(): string { return mkdtempSync(join(tmpdir(), "store-pieces-")); }

test("a snapshot taken apart and put back together is the same text, byte for byte; text that would not come back exactly is kept whole", () => {
  const canonical = [
    snapshotOf(3), "{}", '{"format":1}', JSON.stringify({ format: 1, a: [], b: { c: [1, [2, 3], { d: "é ✓ \u0000 😀" }], e: 1e21, f: -0.5 }, "10": [null, true], z: [{ y: 1, x: 2 }] }),
  ];
  for (const text of canonical) {
    const split = splitSnapshot(text);
    assert.equal(joinSnapshot(split), text);
  }
  const lists = splitSnapshot(snapshotOf(3)).lists;
  assert.deepEqual(lists, ['["bookings"]', '["customers"]', '["seenMessages"]', '["seenEvents"]', '["upi","requests"]', '["upi","refunds"]'], "each list of the store, and a UPI shop's ledger's lists one level in");
  for (const kept of ['{ "format": 1 }', "[1,2,3]", '"text"', "not json", '{"a":1.0}']) {
    const split = splitSnapshot(kept);
    assert.deepEqual([split.shape, split.lists.length], [kept, 0], `${kept} is kept whole`);
    assert.equal(joinSnapshot(split), kept);
  }
});

test("a save writes the snapshot in pieces and reads back the same text; a save that is rolled back changes nothing; a later save is right", () => {
  const dir = tempDir();
  const db = openStore(dir);
  try {
    const first = snapshotOf(5);
    db.commitStep({ snapshot: first, entries: [], nowMs: 1 });
    assert.equal(db.loadState().snapshot, first);
    const raw = new DatabaseSync(db.file, { readOnly: true });
    assert.equal((raw.prepare("SELECT count(*) AS n FROM state_rows WHERE list = '[\"bookings\"]'").get() as { n: number }).n, 5, "one row for each booking");
    raw.close();

    const entry = { seq: 1, time: "2026-11-11T10:00:00.000Z", conversation: "+919800000000", booking: null, action: "x", outcome: "confirmed", refs: {}, decisions: [], language: "en", inputsDigest: "d" } as unknown as RecordEntry;
    db.commitStep({ snapshot: snapshotOf(5, 1), entries: [entry], nowMs: 2 });
    assert.throws(() => db.commitStep({ snapshot: snapshotOf(5, 2), entries: [entry], nowMs: 3 }), /UNIQUE|constraint/iu, "the record refuses the same number twice");
    assert.equal(db.loadState().snapshot, snapshotOf(5, 1), "the rolled-back save left the state as it was");
    db.commitStep({ snapshot: snapshotOf(5, 2), entries: [], nowMs: 4 });
    assert.equal(db.loadState().snapshot, snapshotOf(5, 2));
    db.commitStep({ snapshot: snapshotOf(2), entries: [], nowMs: 5 });
    assert.equal(db.loadState().snapshot, snapshotOf(2), "a list that shrank is cut, not left with old rows");
    db.commitStep({ snapshot: '{"format":1}', entries: [], nowMs: 6 });
    assert.equal(db.loadState().snapshot, '{"format":1}', "a snapshot with no lists takes every row away");
    const after = new DatabaseSync(db.file, { readOnly: true });
    assert.equal((after.prepare("SELECT count(*) AS n FROM state_rows").get() as { n: number }).n, 0);
    after.close();
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("two handles on one file: each save is compared with what is stored now, not with what its own handle saw last", () => {
  const dir = tempDir();
  const a = openStore(dir);
  const b = openStore(dir);
  try {
    a.commitStep({ snapshot: snapshotOf(3), entries: [], nowMs: 1 });
    b.commitStep({ snapshot: snapshotOf(3, 2), entries: [], nowMs: 2 });
    a.commitStep({ snapshot: snapshotOf(3, 1), entries: [], nowMs: 3 });
    assert.equal(b.loadState().snapshot, snapshotOf(3, 1));
    assert.equal(a.loadState().snapshot, snapshotOf(3, 1));
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a file of layout 2 is moved into pieces when it is opened, and the bundle's reader reads either layout", () => {
  const dir = tempDir();
  const file = join(dir, "agent.db");
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("CREATE TABLE tasks (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL, received_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')), attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, waiting_on TEXT, retry_at INTEGER); CREATE TABLE state (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot TEXT NOT NULL, saved_at INTEGER NOT NULL); CREATE TABLE record (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, conversation TEXT NOT NULL, booking TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, entry TEXT NOT NULL); CREATE TABLE window (phone TEXT PRIMARY KEY, last_inbound_at INTEGER NOT NULL); PRAGMA user_version = 2");
  const old = snapshotOf(4);
  raw.prepare("INSERT INTO state (id, snapshot, saved_at) VALUES (1, ?, 7)").run(old);
  assert.equal(readSnapshot(raw), old, "a shop held back on an older version: read from the one-row table");
  raw.close();
  const db = openStore(dir);
  try {
    assert.equal(SCHEMA_VERSION, 3);
    assert.equal(db.loadState().snapshot, old, "moved over whole");
    const check = new DatabaseSync(file, { readOnly: true });
    assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'state'").get(), undefined, "the old table is gone, so nothing reads a stale copy of it");
    assert.equal(readSnapshot(check), old, "and the same reader reads the pieces");
    check.close();
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

/** The bytes one save adds to the write-ahead log, which is what it writes (SQLite writes it to the database file once more when it checkpoints). */
function bytesOfOneStep(pastBookings: number): { step: number; snapshot: number } {
  const dir = tempDir();
  const db = openStore(dir);
  try {
    db.commitStep({ snapshot: snapshotOf(pastBookings), entries: [], nowMs: 1 });
    const other = new DatabaseSync(db.file);
    other.exec("PRAGMA wal_checkpoint(TRUNCATE)"); // the log starts empty, so what is in it afterwards is this one step
    other.close();
    assert.equal(statSync(`${db.file}-wal`).size, 0);
    // One step of a busy day: a new booking with its customer, message id, payment event id, ledger request and counters, and one earlier booking changed.
    const next = JSON.parse(snapshotOf(pastBookings, 1)) as { bookings: [string, { state: string }][] };
    next.bookings[0][1].state = "cancelled";
    db.commitStep({ snapshot: JSON.stringify(next), entries: [], nowMs: 2 });
    assert.equal(db.loadState().snapshot, JSON.stringify(next));
    return { step: statSync(`${db.file}-wal`).size, snapshot: JSON.stringify(next).length };
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}

test("what one step writes does not grow with the number of past bookings: 1,000 or 3,000 bookings behind it, the same few pages", () => {
  // What a step writes is the pages of the rows it changed, and the B-tree pages above them. That depth grows by one page each time the state grows about a hundredfold
  // (a run on 11 Nov wrote 4 pages with 10 bookings behind the step and 10 with 2,000), so the two runs compared here are both well past the first few hundred rows.
  const smaller = bytesOfOneStep(1_000);
  const larger = bytesOfOneStep(3_000);
  const page = 4_096 + 24; // a page and its frame header in the log
  assert.ok(Math.abs(larger.step - smaller.step) <= 4 * page, `a step wrote ${smaller.step} bytes with 1,000 bookings behind it and ${larger.step} with 3,000`);
  assert.ok(larger.step <= 16 * page, `a step wrote ${larger.step} bytes`);
  // Before layout 3 the same step wrote the whole snapshot (here about 2.5 MB with 3,000 bookings and their ledger), once into the log and once into the file.
  assert.ok(larger.snapshot > 20 * larger.step, `the snapshot is ${larger.snapshot} bytes and the step wrote ${larger.step}`);
});
