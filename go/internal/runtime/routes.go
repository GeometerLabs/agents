package runtime

// What the four routes of this wave share (owner-limits and limit-changes, owner-file, push): one small struct hung on the Runtime so runtime.go carries a single new field and three
// one-line calls (New, Start, Close), and the passkey seam they need from the owner's sign-in.
//
// The seam, and why it exists: three of the routes must know more about an owner's session than "it is good": was it made with a PASSKEY (the limits page, as TypeScript's
// `checkPasskey`), which passkey (a push subscription is tied to the phone it was made from, `passkeyOf`), and does the owner hold a passkey at all, so the Operator's link is closed
// (`lockState().locked`). `internal/access` does not export these yet (the owner-control work ports them), so the questions are asked through PasskeySessions. The default answers them
// by READING owner-access.sqlite read-only, the same file `access` writes (sessions.link_id is "pk-<passkey id>" for a passkey session; the lock is the first passkey made since the gate
// last opened). It never writes, and when the file cannot be read every answer is "no" (the safe side: nothing that needs a passkey is allowed). When `access` exports the same, call
// SetPasskeySessions with an implementation over it and the file reader is not used.

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/push"
	_ "modernc.org/sqlite"
)

// PasskeySessions answers what the limits and push routes need to know about an owner's session. A token is the session's secret as the front sends it; the caller has already checked
// that it is a good session where that matters.
type PasskeySessions interface {
	// IsPasskeySession: the session was made by a passkey (a sign-in link makes one that is not).
	IsPasskeySession(token string) bool
	// PasskeyOf is the id of the passkey (the owner's phone) the session was made by, or "" for a link session.
	PasskeyOf(token string) string
	// Locked: the owner holds a passkey, so the Operator's setup QR, card and link open nothing new (the Operator's own link may not change alerts).
	Locked() bool
}

// routes is the state of this wave's routes on one Runtime.
type routes struct {
	push     *push.Push
	sender   *push.Sender
	pushCfg  pushConfig
	passkeys PasskeySessions
	fileMu   sync.Mutex // the owner's file is taken once: one request at a time checks and marks it
}

// SetPasskeySessions replaces the default file reader (see the top of this file).
func (r *Runtime) SetPasskeySessions(p PasskeySessions) { r.routes.passkeys = p }

// initRoutes opens what the routes keep (the push store, when the shop has a channel token) and chooses the default seam.
func (r *Runtime) initRoutes() error {
	r.routes = &routes{passkeys: &fileSessions{file: filepath.Join(r.o.Client.Config.DataDir, access.OwnerAccessFile)}}
	return r.initPush()
}

// startRoutes starts what runs on its own: the push sender, when push is on.
func (r *Runtime) startRoutes() {
	if r.routes.push != nil && r.routes.push.On {
		r.routes.sender.Start()
	}
}

// closeRoutes stops the sender and closes what was opened.
func (r *Runtime) closeRoutes() {
	if r.routes.sender != nil {
		r.routes.sender.Stop()
	}
	if r.routes.push != nil {
		_ = r.routes.push.Store().Close()
	}
	if f, ok := r.routes.passkeys.(*fileSessions); ok {
		f.close()
	}
}

// PasskeySession: the session is good AND was made with a passkey (TypeScript `checkPasskey`).
func (r *Runtime) PasskeySession(token string) bool {
	return token != "" && r.SessionOK(token) && r.routes.passkeys.IsPasskeySession(token)
}

// ---- the default seam: owner-access.sqlite, read only ---------------------------------------------------------------------------------------------------------

type fileSessions struct {
	file string
	mu   sync.Mutex
	db   *sql.DB
}

// conn opens the file read-only the first time it is wanted; nil when it is not there (no channel token, or not made yet), tried again at the next question.
func (f *fileSessions) conn() *sql.DB {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.db == nil {
		db, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: f.file, RawQuery: "mode=ro&_pragma=busy_timeout(3000)"}).String())
		if err != nil {
			return nil
		}
		db.SetMaxOpenConns(1)
		f.db = db
	}
	return f.db
}

func (f *fileSessions) close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.db != nil {
		_ = f.db.Close()
		f.db = nil
	}
}

// linkID is the session's `link_id`: "pk-<passkey id>" when a passkey made it. The hash is owner-access.ts `sessionHash`.
func (f *fileSessions) linkID(token string) string {
	db := f.conn()
	if db == nil {
		return ""
	}
	h := sha256.Sum256([]byte("owner-session:" + token))
	var id string
	if db.QueryRow("SELECT link_id FROM sessions WHERE hash = ?", hex.EncodeToString(h[:])).Scan(&id) != nil {
		return ""
	}
	return id
}

func (f *fileSessions) IsPasskeySession(token string) bool {
	return strings.HasPrefix(f.linkID(token), "pk-")
}

func (f *fileSessions) PasskeyOf(token string) string {
	id, ok := strings.CutPrefix(f.linkID(token), "pk-")
	if !ok {
		return ""
	}
	var one int
	if db := f.conn(); db == nil || db.QueryRow("SELECT 1 FROM passkeys WHERE id = ?", id).Scan(&one) != nil {
		return "" // the phone's row is gone: the session is no phone's (owner-access.ts subjectOf)
	}
	return id
}

// meta reads one number the store keeps in its meta table (owner-access.ts metaNum).
func (f *fileSessions) meta(name string) (float64, bool) {
	db := f.conn()
	if db == nil {
		return 0, false
	}
	var v string
	if db.QueryRow("SELECT value FROM meta WHERE name = ?", name).Scan(&v) != nil {
		return 0, false
	}
	n, err := strconv.ParseFloat(v, 64)
	return n, err == nil
}

// Locked is owner-access.ts `locked`: the first passkey made since the gate last opened (rows the owner later took away still count: the owner held one), or Geometer's reset window (from
// the reset until the owner's first passkey after it). It does not run the store's `reconcile` (the Operator's pending request, applied after its wait): that belongs to the owner-control port.
func (f *fileSessions) Locked() bool {
	db := f.conn()
	if db == nil {
		return false
	}
	reopen, _ := f.meta("reopen_at")
	var first sql.NullInt64
	if db.QueryRow("SELECT min(made_at) FROM passkeys WHERE made_at >= ?", int64(reopen)).Scan(&first) == nil && first.Valid {
		return true
	}
	if reset, ok := f.meta("reset_at"); ok {
		var one int
		return db.QueryRow("SELECT 1 FROM passkeys WHERE made_at >= ? LIMIT 1", int64(reset)).Scan(&one) != nil
	}
	return false
}
