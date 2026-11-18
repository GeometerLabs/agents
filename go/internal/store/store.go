// Package store is the shop's SQLite file, the same file the TypeScript runtime keeps (modules/runtime/store.ts): the queue of events saved before they are answered, the shop's
// state as one JSON snapshot kept in pieces, the append-only action record, the photos' bytes and the shop's signing key. A step is saved in ONE transaction (the snapshot, the
// record lines it made and the task's "done" mark), so after a crash a step is whole or not there. Pure Go SQLite (modernc.org/sqlite): no cgo, so the binary needs no C library.
package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// Store is an open shop file. Only one process may use a data directory at a time.
type Store struct {
	db   *sql.DB
	File string
	// held is the pieces as this handle last read or wrote them, trusted only while the stored version is the one they were taken at.
	held *stored
}

// Task is one saved event.
type Task struct {
	ID       string
	Kind     string
	Payload  string
	Received int64
	Attempts int
}

// TaskCounts is what /status says of the queue.
type TaskCounts struct {
	Pending int `json:"pending"`
	Done    int `json:"done"`
	Failed  int `json:"failed"`
}

// Entry is one line of the action record: the same members, in the same order, as the TypeScript record writes (modules/record/record.ts RecordEntry). Booking is always null here.
type Entry struct {
	Seq          int               `json:"seq"`
	Time         string            `json:"time"`
	Conversation string            `json:"conversation"`
	Booking      *string           `json:"booking"`
	Action       string            `json:"action"`
	InputsDigest string            `json:"inputsDigest"`
	Outcome      string            `json:"outcome"`
	Decisions    []json.RawMessage `json:"decisions"`
	Language     string            `json:"language"`
	Notes        string            `json:"notes"`
	Refs         map[string]string `json:"refs"`
}

// Photo is one listing photo as kept.
type Photo struct {
	ID     string
	Type   string
	Width  int
	Height int
	Bytes  []byte
	AtMs   int64
}

// Open opens (or makes) <dataDir>/agent.db and brings it to the current schema.
func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	file := filepath.Join(dataDir, "agent.db")
	db, err := sql.Open("sqlite", "file:"+file+"?_txlock=immediate")
	if err != nil {
		return nil, err
	}
	// one connection: SQLite writes one at a time anyway, and a second connection costs memory the shop should not spend
	db.SetMaxOpenConns(1)
	s := &Store{db: db, File: file}
	var mode string
	if err := db.QueryRow("PRAGMA journal_mode = WAL").Scan(&mode); err != nil || mode != "wal" {
		db.Close()
		return nil, fmt.Errorf("SQLite would not switch %s to write-ahead logging (it said %q). Use a data directory on a local disk", file, mode)
	}
	// a commit is on disk before we answer 200, even if the power goes
	for _, p := range []string{"PRAGMA synchronous = FULL", "PRAGMA busy_timeout = 5000"} {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// exec is what both a transaction and the database offer, so a read can run inside a step's transaction or on its own.
type exec interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

// inTx runs work in one transaction. The DSN asks for `BEGIN IMMEDIATE` (_txlock=immediate), as the TypeScript store does, so a second writer waits instead of failing at commit.
func (s *Store) inTx(work func(x exec) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := work(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Store) migrate() error {
	var current int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&current); err != nil {
		return err
	}
	if current > SchemaVersion {
		return fmt.Errorf("this data was written by a newer version of the runtime (schema %d; this one knows %d). Update the runtime, or restore an older copy of the data", current, SchemaVersion)
	}
	for v := current; v < SchemaVersion; v++ {
		err := s.inTx(func(x exec) error {
			if _, err := x.Exec(migrations[v]); err != nil {
				return err
			}
			// layout 3 also takes an old one-row `state` into the pieces and drops it (a file this old is rare: it is a shop that was held back before 11 Nov 2026)
			if v == 2 {
				if err := moveOldState(x); err != nil {
					return err
				}
			}
			_, err := x.Exec(fmt.Sprintf("PRAGMA user_version = %d", v+1))
			return err
		})
		if err != nil {
			return fmt.Errorf("migrating to schema %d: %w", v+1, err)
		}
	}
	return nil
}

func moveOldState(x exec) error {
	var snapshot string
	var saved int64
	err := x.QueryRow("SELECT snapshot, saved_at FROM state WHERE id = 1").Scan(&snapshot, &saved)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = x.Exec("DROP TABLE state")
		return err
	}
	if err != nil {
		return err
	}
	split, err := SplitSnapshot(snapshot)
	if err != nil {
		return err
	}
	if _, err := writeSnapshot(x, nil, split, saved); err != nil {
		return err
	}
	_, err = x.Exec("DROP TABLE state")
	return err
}

// Close closes the file.
func (s *Store) Close() error { return s.db.Close() }

// Ping fails if the database cannot be read.
func (s *Store) Ping() error {
	var n int
	return s.db.QueryRow("SELECT count(*) FROM sqlite_master").Scan(&n)
}

// SaveEvents saves new events as pending tasks, all or nothing; ids already seen are skipped. `keys` and `kinds` and `payloads` are parallel.
func (s *Store) SaveEvents(keys, kinds, payloads []string, nowMs int64) (saved, duplicates int, err error) {
	err = s.inTx(func(x exec) error {
		for i := range keys {
			r, err := x.Exec("INSERT OR IGNORE INTO tasks (id, kind, payload, received_at) VALUES (?, ?, ?, ?)", keys[i], kinds[i], payloads[i], nowMs)
			if err != nil {
				return err
			}
			if n, _ := r.RowsAffected(); n > 0 {
				saved++
			}
		}
		duplicates = len(keys) - saved
		return nil
	})
	return
}

// NextPending is the oldest task still pending.
func (s *Store) NextPending() (*Task, error) {
	var t Task
	err := s.db.QueryRow("SELECT id, kind, payload, received_at, attempts FROM tasks WHERE state = 'pending' ORDER BY seq LIMIT 1").Scan(&t.ID, &t.Kind, &t.Payload, &t.Received, &t.Attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

// StartAttempt counts one more attempt, saved at once, and returns the new number.
func (s *Store) StartAttempt(id string) (int, error) {
	var n int
	err := s.db.QueryRow("UPDATE tasks SET attempts = attempts + 1 WHERE id = ? RETURNING attempts", id).Scan(&n)
	return n, err
}

// FailTask keeps the error; `final` marks the task failed, otherwise it stays pending for another try.
func (s *Store) FailTask(id, msg string, final bool) error {
	state := "pending"
	if final {
		state = "failed"
	}
	_, err := s.db.Exec("UPDATE tasks SET last_error = ?, state = ?, waiting_on = NULL, retry_at = NULL WHERE id = ?", truncate(msg, 500), state, id)
	return err
}

func truncate(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// TaskCounts counts the queue by state.
func (s *Store) TaskCounts() (TaskCounts, error) {
	var c TaskCounts
	rows, err := s.db.Query("SELECT state, count(*) FROM tasks GROUP BY state")
	if err != nil {
		return c, err
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var n int
		if err := rows.Scan(&state, &n); err != nil {
			return c, err
		}
		switch state {
		case "pending":
			c.Pending = n
		case "done":
			c.Done = n
		case "failed":
			c.Failed = n
		}
	}
	return c, rows.Err()
}

// OldestPendingAt is when the oldest pending task arrived, or nil.
func (s *Store) OldestPendingAt() (*int64, error) {
	var at sql.NullInt64
	if err := s.db.QueryRow("SELECT min(received_at) FROM tasks WHERE state = 'pending'").Scan(&at); err != nil {
		return nil, err
	}
	if !at.Valid {
		return nil, nil
	}
	return &at.Int64, nil
}

// LoadState is what the last saved step left: the snapshot (empty before the first step) and the whole record.
func (s *Store) LoadState() (snapshot string, record []Entry, err error) {
	st, err := readPieces(s.db)
	if err != nil {
		return "", nil, err
	}
	s.held = st
	if st != nil {
		if snapshot, err = JoinSnapshot(st.split); err != nil {
			return "", nil, err
		}
	}
	rows, err := s.db.Query("SELECT entry FROM record ORDER BY seq")
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return "", nil, err
		}
		var e Entry
		if err := json.Unmarshal([]byte(text), &e); err != nil {
			return "", nil, err
		}
		record = append(record, e)
	}
	return snapshot, record, rows.Err()
}

// Step is what one step saves.
type Step struct {
	TaskID   string // empty for a tick
	Snapshot string
	Entries  []Entry
	NowMs    int64
}

// CommitStep saves one step: snapshot, new record entries and the task's done mark, in one transaction.
func (s *Store) CommitStep(step Step) error {
	next, err := SplitSnapshot(step.Snapshot)
	if err != nil {
		return err
	}
	var saved *stored
	err = s.inTx(func(x exec) error {
		before, err := s.storedNow(x)
		if err != nil {
			return err
		}
		version, err := writeSnapshot(x, before, next, step.NowMs)
		if err != nil {
			return err
		}
		for _, e := range step.Entries {
			text, err := marshalEntry(e)
			if err != nil {
				return err
			}
			if _, err := x.Exec("INSERT INTO record (seq, time, conversation, booking, action, outcome, entry) VALUES (?, ?, ?, ?, ?, ?, ?)", e.Seq, e.Time, e.Conversation, e.Booking, e.Action, e.Outcome, text); err != nil {
				return err
			}
		}
		if step.TaskID != "" {
			if _, err := x.Exec("UPDATE tasks SET state = 'done', payload = '{}', last_error = NULL, waiting_on = NULL, retry_at = NULL WHERE id = ?", step.TaskID); err != nil {
				return err
			}
		}
		saved = &stored{split: next, version: version}
		return nil
	})
	if err == nil {
		s.held = saved // only once the transaction is committed: a save that was rolled back leaves this handle's copy as it was
	}
	return err
}

func marshalEntry(e Entry) (string, error) {
	if e.Decisions == nil {
		e.Decisions = []json.RawMessage{}
	}
	if e.Refs == nil {
		e.Refs = map[string]string{}
	}
	b, err := json.Marshal(e)
	return string(b), err
}

func (s *Store) storedNow(x exec) (*stored, error) {
	var version sql.NullInt64
	err := x.QueryRow("SELECT version FROM state_shape WHERE id = 1").Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if s.held == nil || s.held.version != int(version.Int64) {
		if s.held, err = readPieces(x); err != nil {
			return nil, err
		}
	}
	return s.held, nil
}

// PutPhoto keeps a photo's cleaned bytes by their own id.
func (s *Store) PutPhoto(p Photo) error {
	_, err := s.db.Exec("INSERT OR REPLACE INTO listing_photos (id, type, width, height, bytes, at_ms) VALUES (?, ?, ?, ?, ?, ?)", p.ID, p.Type, p.Width, p.Height, p.Bytes, p.AtMs)
	return err
}

// Photo is one photo, or nil.
func (s *Store) Photo(id string) (*Photo, error) {
	var p Photo
	err := s.db.QueryRow("SELECT id, type, width, height, bytes, at_ms FROM listing_photos WHERE id = ?", id).Scan(&p.ID, &p.Type, &p.Width, &p.Height, &p.Bytes, &p.AtMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// PrunePhotos deletes every photo whose id is not in keep and is older than olderThanMs.
func (s *Store) PrunePhotos(keep map[string]bool, olderThanMs int64) (int, error) {
	rows, err := s.db.Query("SELECT id FROM listing_photos WHERE at_ms < ?", olderThanMs)
	if err != nil {
		return 0, err
	}
	var gone []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		if !keep[id] {
			gone = append(gone, id)
		}
	}
	rows.Close()
	for _, id := range gone {
		if _, err := s.db.Exec("DELETE FROM listing_photos WHERE id = ?", id); err != nil {
			return 0, err
		}
	}
	return len(gone), nil
}

// ShopKey is the shop's signing key text, or "" when it has none yet.
func (s *Store) ShopKey() (string, error) {
	var k string
	err := s.db.QueryRow("SELECT private_key FROM shop_key WHERE id = 1").Scan(&k)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return k, err
}

// EnsureShopKey keeps `text` as the shop's key if it has none, and returns the key the shop has: reading and keeping happen in one transaction, so two callers never end with two keys.
func (s *Store) EnsureShopKey(text string, nowMs int64) (string, error) {
	var have string
	err := s.inTx(func(x exec) error {
		err := x.QueryRow("SELECT private_key FROM shop_key WHERE id = 1").Scan(&have)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		have = text
		_, err = x.Exec("INSERT OR IGNORE INTO shop_key (id, private_key, created_at) VALUES (1, ?, ?)", text, nowMs)
		return err
	})
	return have, err
}

// IsAppendOnly reports whether an error is the record's own refusal to change.
func IsAppendOnly(err error) bool { return err != nil && strings.Contains(err.Error(), "append-only") }
