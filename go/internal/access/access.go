package access

// The owner's sessions, sign-in links and passkeys, and who controls them ("no Operator holds a shop hostage", owner control, 19 Nov 2026), in the file beside the store
// (owner-access.sqlite). The Go twin of modules/channels/owner-access.ts, function for function and statement for statement: the same tables, created by the same text (so the
// `sqlite_master` of a file made here is byte for byte the one TypeScript makes), the same safe ALTERs in the same order, the same meta keys, the same rules in the same order.
// So a shop moves between the two runtimes, and the deployer's backup (bundle/backup/owner-keep.ts) reads and restores either's file.
//
// The rules, each in one place (the TypeScript header says the same; every check below says WHY where it is made):
//   - a link is 32 random bytes, works once, for SigninLinkMs; a session is 32 random bytes, lasts SessionMs, at most MaxSessions at once (the oldest ends);
//   - a link or a session is good only for the owner and the owner's address (`base`) it was made for; once the owner holds a passkey, "the owner" is the identity the shop
//     was LOCKED with (meta bound_owner), never whatever number the Operator's settings say now;
//   - a passkey challenge works once, for ChallengeMs, for one ceremony; a grant is used up only in the transaction that keeps the credential and makes the session;
//   - the shop is LOCKED once any passkey has been made since the gate last opened (meta reopen_at). A setup QR or a recovery code works only if THIS store first saw it
//     (grants_seen) no later than that first passkey; times from files are clamped to this runtime's clock at first sight;
//   - the Operator's "remove the owner's passkeys", and a changed owner number after the lock, are REQUESTS this store times itself (RemovalWaitMs from first sight), which
//     the owner can cancel; Geometer's reset (the admin's own file) reopens the gate at once and voids everything made before it.
//
// Concurrency: TypeScript runs each HTTP handler's owner calls without interleaving (one thread, no await between them). The Go runtime has concurrent handlers and a ticking
// goroutine, so its caller (go/internal/runtime owner.go) holds ONE lock across each handler's whole owner sequence and the tick's owner part. Inside this package every helper
// takes the `q` it runs on (the file, or the open transaction): the file has one connection, so a helper that used the file while a transaction or a row set is open would wait
// for ever.

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

const (
	SigninLinkMs  = 10 * 60_000
	SessionMs     = 30 * 24 * 60 * 60_000
	MaxSessions   = 5
	ChallengeMs   = 5 * 60_000
	WrongCodeMax  = 20
	ChallengeKept = 300
	MaxPasskeys   = 8
	day           = 24 * 60 * 60_000
)

// schema is modules/channels/owner-access.ts's CREATE text, copied character for character (indentation, line breaks and the comment inside `removals` included): SQLite keeps
// each statement's text in sqlite_master, and the contract (cross-restart.test.ts) compares the two runtimes' files by that text. Never tidy it.
const schema = `
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
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY, cred_id TEXT NOT NULL UNIQUE, jwk TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL, backed_up INTEGER NOT NULL,
      made_at INTEGER NOT NULL, used_at INTEGER, removed_at INTEGER, removed_why TEXT, owner_key TEXT NOT NULL, rp_id TEXT NOT NULL, via TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('register', 'signin')), grant_hash TEXT, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS grants_used (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, used_at INTEGER NOT NULL, passkey_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wrong_codes (at INTEGER NOT NULL);
    -- the Operator's QR and card hashes as THIS store first saw them: the gate (see the header) compares first_seen with the first passkey
    CREATE TABLE IF NOT EXISTS grants_seen (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, first_seen INTEGER NOT NULL, voided_at INTEGER);
    -- the owner's own recovery codes (hashes only, made from the owner's app) and "add a phone" links; the Operator's file never holds these
    -- by_passkey: the phone that made each set of codes and each "add a phone" link, so removing that phone takes back what it made (a removed phone must not keep a way in)
    CREATE TABLE IF NOT EXISTS own_codes (hash TEXT PRIMARY KEY, made_at INTEGER NOT NULL, voided_at INTEGER, by_passkey TEXT);
    CREATE TABLE IF NOT EXISTS own_setups (hash TEXT PRIMARY KEY, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, voided_at INTEGER, by_passkey TEXT);
    -- news the other phones are told once: codes made, a phone removed (a phone ADDED is read from the passkeys table)
    CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('codes', 'removed')), label TEXT, by_id TEXT);
    -- the Operator's removal requests as this store timed them: seen_at is when WE first saw the request, effective_at = seen_at + REMOVAL_WAIT_MS
    CREATE TABLE IF NOT EXISTS removals (
      asked_at TEXT PRIMARY KEY, asked_by TEXT NOT NULL, seen_at INTEGER NOT NULL, effective_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'cancelled', 'applied', 'withdrawn')), at INTEGER NOT NULL,
      -- 1 once the owner's phones were told and the record line written (the tick does both, then sets this); see takeNotes
      told INTEGER NOT NULL DEFAULT 1
    );
    -- what each phone (a passkey, or a session made by a link) has been told about: new passkeys made after "through" are announced to it until it dismisses them
    CREATE TABLE IF NOT EXISTS phone_seen (subject TEXT PRIMARY KEY, through INTEGER NOT NULL);
  `

// migrations are owner-access.ts's safe ALTERs, in its order: each adds a column only when a file made before it lacks it. Their order changes the stored CREATE text, so it is
// the TypeScript order, not a tidier one.
var migrations = []struct{ table, column, ddl string }{
	// the phones list's coarse label (owner-phones.ts); an old row keeps NULL and shows as "a phone"
	{"passkeys", "label", "ALTER TABLE passkeys ADD COLUMN label TEXT"},
	// at most one restart-extension per request: a runtime restarted every few hours must not postpone a request for ever
	{"removals", "extended", "ALTER TABLE removals ADD COLUMN extended INTEGER NOT NULL DEFAULT 0"},
	// the request notice is kept in the file (a restart before the tick used to lose it); old rows count as told
	{"removals", "told", "ALTER TABLE removals ADD COLUMN told INTEGER NOT NULL DEFAULT 1"},
	// the phone that made each set of own codes and each "add a phone" link, so removing that phone takes them back
	{"own_codes", "by_passkey", "ALTER TABLE own_codes ADD COLUMN by_passkey TEXT"},
	{"own_setups", "by_passkey", "ALTER TABLE own_setups ADD COLUMN by_passkey TEXT"},
}

// Who is the owner now: their number (or the marker for none) and the address of their page. A session is good only for this pair.
type Who struct{ Owner, Base string }

// RelyingParty is the passkey's relying party: the host of the owner's page, and its origin.
type RelyingParty struct{ RpID, Origin string }

// Access is an open owner-access file. It is NOT safe for concurrent use on its own: the runtime holds its owner lock around every sequence of calls (see the header).
type Access struct {
	db *sql.DB
	// notes are what reconcile found that the record should say once and that are not a request (a reset, a request applied); a request's notice is a row (removals.told)
	notes []Note
}

// Open opens (or makes) the file, and adds the columns a file from before lacks.
func Open(file string) (*Access, error) {
	db, err := sql.Open("sqlite", "file:"+file+"?_txlock=immediate&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	for _, m := range migrations {
		have, err := hasColumn(db, m.table, m.column)
		if err != nil {
			db.Close()
			return nil, err
		}
		if !have {
			if _, err := db.Exec(m.ddl); err != nil {
				db.Close()
				return nil, err
			}
		}
	}
	return &Access{db: db}, nil
}

func hasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return false, err
		}
		for i, c := range cols {
			if c == "name" {
				if n, ok := vals[i].(string); ok && n == column {
					return true, nil
				}
			}
		}
	}
	return false, rows.Err()
}

// Close closes the file.
func (a *Access) Close() error { return a.db.Close() }

// digits is `number.replace(/\D/gu, "")`: JavaScript's \d is ASCII 0-9 only, even with the u flag.
func digits(number string) string {
	var b strings.Builder
	for _, r := range number {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// OwnerKey is the owner's number kept only as a hash: enough to tell that the settings now name someone else.
func OwnerKey(number string) string { return sha("owner-number:" + digits(number)) }

func linkHash(token string) string    { return sha("owner-signin:" + token) }
func sessionHash(token string) string { return sha("owner-session:" + token) }

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// newID is a short id for the record and the panel (never the token, never its hash).
func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// DBError is a database failure inside a rule. TypeScript's node:sqlite throws on one, so the call stops (an HTTP 500, a failed step); here a helper that meets one PANICS
// with a DBError rather than reading it as "no row" (which would fail OPEN: "not locked", "no reset window", "no cool-down"). The runtime recovers it into an error at its
// edges (the HTTP server, the step, the start).
type DBError struct{ Err error }

func (e DBError) Error() string { return "the owner-access store failed: " + e.Err.Error() }

// found is "a row came back": true for a row, false for none, and a panic (DBError) for anything else.
func found(err error) bool {
	if err == nil {
		return true
	}
	if err == sql.ErrNoRows {
		return false
	}
	panic(DBError{err})
}

// must is a statement that cannot be left half done: a failure panics (DBError), as TypeScript throws.
func must(err error) {
	if err != nil {
		panic(DBError{err})
	}
}

// Recover turns a DBError panic back into an error (deferred by the runtime at its edges); any other panic goes on.
func Recover(err *error) {
	if p := recover(); p != nil {
		if d, ok := p.(DBError); ok {
			*err = d
			return
		}
		panic(p)
	}
}

// execer is the file or an open transaction: every helper runs on the one it is given.
type execer interface {
	Exec(string, ...any) (sql.Result, error)
	QueryRow(string, ...any) *sql.Row
	Query(string, ...any) (*sql.Rows, error)
}

// tx runs `work` in one transaction (BEGIN IMMEDIATE, from the file's _txlock); an error rolls it back, and so does a panic (a DBError from a helper), which then goes on:
// a transaction left open would hold the file's one connection, and every later owner call would wait for ever instead of failing.
func (a *Access) tx(work func(x execer) error) error {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	done := false
	defer func() {
		if !done {
			_ = tx.Rollback()
		}
	}()
	err = work(tx)
	done = true
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ---- meta: the gate's own values, as TEXT, numbers written as JavaScript's String(n) writes an integer ------------------------------------------------------

func metaStr(q execer, name string) (string, bool) {
	var v string
	if !found(q.QueryRow("SELECT value FROM meta WHERE name = ?", name).Scan(&v)) {
		return "", false
	}
	return v, true
}

// metaNum is `Number(value)` for the values this store writes (integers). A value that does not read as a number counts as absent.
func metaNum(q execer, name string) (int64, bool) {
	v, ok := metaStr(q, name)
	if !ok {
		return 0, false
	}
	n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil {
		f, err2 := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err2 != nil {
			return 0, false
		}
		n = int64(f)
	}
	return n, true
}

// metaOr is `metaNum(name) ?? or`.
func metaOr(q execer, name string, or int64) int64 {
	if n, ok := metaNum(q, name); ok {
		return n
	}
	return or
}

func setMeta(q execer, name, value string) error {
	_, err := q.Exec("INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", name, value)
	return err
}

func setMetaNum(q execer, name string, v int64) error {
	return setMeta(q, name, strconv.FormatInt(v, 10))
}

// raiseMeta moves a cut-off forward only, never back.
func raiseMeta(q execer, name string, v int64) error {
	if v > metaOr(q, name, 0) {
		return setMetaNum(q, name, v)
	}
	return nil
}

// ---- links and sessions ---------------------------------------------------------------------------------------------------------------------------------

// Session is a session just made: its token (given once), short id and end.
type Session struct {
	Token     string
	ID        string
	ExpiresAt int64
}

// startSession is a new session for the browser that just proved it is the owner's (a link used up, or a passkey). The token is returned ONCE.
func startSession(x execer, key, base, from string, now int64) (Session, error) {
	s := Session{Token: newToken(), ID: newID(), ExpiresAt: now + SessionMs}
	if _, err := x.Exec("INSERT INTO sessions (id, hash, made_at, expires_at, owner_key, base, link_id) VALUES (?, ?, ?, ?, ?, ?, ?)", s.ID, sessionHash(s.Token), now, s.ExpiresAt, key, base, from); err != nil {
		return s, err
	}
	// at most MaxSessions live at once: the oldest ends, so a phone lost long ago does not stay signed in for ever behind newer ones
	live, err := strings1(x, "SELECT id FROM sessions WHERE ended_at IS NULL AND expires_at > ? ORDER BY made_at DESC", now)
	if err != nil {
		return s, err
	}
	if len(live) > MaxSessions {
		for _, old := range live[MaxSessions:] {
			if _, err := x.Exec("UPDATE sessions SET ended_at = ?, ended_why = 'too_many' WHERE id = ?", now, old); err != nil {
				return s, err
			}
		}
	}
	return s, nil
}

// strings1 is the first column of every row, read whole before anything else runs on the one connection.
func strings1(q execer, query string, args ...any) ([]string, error) {
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// TryAttempt counts one request for a link if the shop's limits allow it. Every attempt counts, whether or not a link then goes out, so the record's lines about links are bounded.
func (a *Access) TryAttempt(now int64) bool {
	_, err := a.db.Exec("DELETE FROM attempts WHERE at <= ?", now-linkLimits[1].perMs)
	must(err)
	for _, w := range linkLimits {
		var n int64
		must(a.db.QueryRow("SELECT count(*) FROM attempts WHERE at > ?", now-w.perMs).Scan(&n))
		if n >= w.max {
			return false
		}
	}
	_, err = a.db.Exec("INSERT INTO attempts (at) VALUES (?)", now)
	must(err)
	return true
}

// Issue is owner-access.ts issue: a new sign-in link for the owner (by their number) and this address; any link still issued is replaced, so only the newest works. The token
// goes into the message and is never kept: only its hash is.
func (a *Access) Issue(who Who, via string, now int64) (id, token string, expiresAt int64, err error) {
	token, id, expiresAt = newToken(), newID(), now+SigninLinkMs
	err = a.tx(func(x execer) error {
		if _, err := x.Exec("UPDATE links SET state = 'replaced' WHERE state = 'issued'"); err != nil {
			return err
		}
		_, err := x.Exec("INSERT INTO links (id, hash, made_at, expires_at, state, via, owner_key, base) VALUES (?, ?, ?, ?, 'issued', ?, ?, ?)", id, linkHash(token), now, expiresAt, via, OwnerKey(who.Owner), who.Base)
		return err
	})
	return id, token, expiresAt, err
}

// Unsent is owner-access.ts unsent: the send failed before anything went out, so the link can never be used (nobody has it).
func (a *Access) Unsent(id string) {
	_, err := a.db.Exec("UPDATE links SET state = 'unsent' WHERE id = ? AND state = 'issued'", id)
	must(err)
}

// Link limits: 3 requests a quarter of an hour, 10 a day. A person who taps twice is served; a flood is not.
var linkLimits = []struct{ max, perMs int64 }{{3, 15 * 60_000}, {10, day}}

// LinkState is what a sign-in link is now: valid, used, expired, replaced or unknown. Nothing is used up. A link for another owner or another address is unknown.
func (a *Access) LinkState(token string, who Who, now int64) string {
	if !ownerToken.MatchString(token) {
		return "unknown"
	}
	var state, key, base string
	var expires int64
	have := found(a.db.QueryRow("SELECT state, owner_key, base, expires_at FROM links WHERE hash = ?", linkHash(token)).Scan(&state, &key, &base, &expires))
	// a link names the owner by their NUMBER (ownerKey, as TypeScript's linkState does), not the locked identity: it was sent to that number
	if !have || key != OwnerKey(who.Owner) || base != who.Base || state == "unsent" {
		return "unknown"
	}
	if state == "used" || state == "replaced" {
		return state
	}
	if expires > now {
		return "valid"
	}
	return "expired"
}

// Consume uses a link up and opens a session for the browser that opened it. The link turns from issued to used in ONE statement that also checks it has not run out, so two
// presses can never both get a session.
func (a *Access) Consume(token string, who Who, now int64) (s Session, state string, err error) {
	if st := a.LinkState(token, who, now); st != "valid" {
		return s, st, nil
	}
	var id, key, base string
	if err := a.db.QueryRow("SELECT id, owner_key, base FROM links WHERE hash = ?", linkHash(token)).Scan(&id, &key, &base); err != nil {
		return s, "unknown", err
	}
	r, err := a.db.Exec("UPDATE links SET state = 'used', used_at = ? WHERE id = ? AND state = 'issued' AND expires_at > ?", now, id, now)
	if err != nil {
		return s, "unknown", err
	}
	if n, _ := r.RowsAffected(); n != 1 {
		return s, "used", nil
	}
	s, err = startSession(a.db, key, base, id, now)
	return s, "", err
}

type sessionRow struct {
	id, linkID, ownerKey, base string
	madeAt, expiresAt          int64
	ended                      bool
}

func (a *Access) sessionByHash(token string) (sessionRow, bool) {
	var r sessionRow
	var ended sql.NullInt64
	if !found(a.db.QueryRow("SELECT id, link_id, made_at, expires_at, ended_at, owner_key, base FROM sessions WHERE hash = ?", sessionHash(token)).Scan(&r.id, &r.linkID, &r.madeAt, &r.expiresAt, &ended, &r.ownerKey, &r.base)) {
		return r, false
	}
	r.ended = ended.Valid
	return r, true
}

// Check: is this session good now, for this owner at this address, made after the panel's last "sign out every device" (endBefore, already clamped)? Its short id when it is.
func (a *Access) Check(token string, who Who, now int64, endBefore *int64) (string, bool) {
	if !ownerToken.MatchString(token) {
		return "", false
	}
	r, ok := a.sessionByHash(token)
	if !ok || r.ended || r.expiresAt <= now {
		return "", false
	}
	// another owner now, or the shop's page moved. Once the owner holds a passkey, "the owner" is the identity the shop was locked with (effKey), NOT whatever number the
	// Operator's settings form says now: a changed number must neither lock the owner out nor let a session for the new number in.
	if r.ownerKey != a.effKey(a.db, who) || r.base != who.Base {
		return "", false
	}
	// Once the owner holds a passkey the panel's "sign out every device" ends WhatsApp-link sessions only. A passkey session ends by the owner's own action, an applied removal
	// or number change, or Geometer's reset: otherwise the button, pressed every few seconds beside a removal request, would keep the owner out for its whole 48 hours.
	if endBefore != nil && r.madeAt < *endBefore {
		if _, locked := lockAt(a.db); !(strings.HasPrefix(r.linkID, "pk-") && locked) {
			return "", false
		}
	}
	return r.id, true
}

// CheckPasskey: the session is good now AND was made by a PASSKEY (a sign-in or the first registration), not by a link: a link on WhatsApp is whoever holds the phone, a passkey
// is the owner's own finger or face.
func (a *Access) CheckPasskey(token string, who Who, now int64, endBefore *int64) (string, bool) {
	id, ok := a.Check(token, who, now, endBefore)
	if !ok {
		return "", false
	}
	r, found := a.sessionByHash(token)
	if !found || !strings.HasPrefix(r.linkID, "pk-") {
		return "", false
	}
	return id, true
}

// End is the owner signing out on this browser: the session ends. Its short id, or "" when there was none live.
func (a *Access) End(token string, now int64) string {
	if !ownerToken.MatchString(token) {
		return ""
	}
	r, ok := a.sessionByHash(token)
	if !ok || r.ended {
		return ""
	}
	_, err := a.db.Exec("UPDATE sessions SET ended_at = ?, ended_why = 'signed_out' WHERE id = ?", now, r.id)
	must(err)
	return r.id
}

// EndAllBefore is the panel's "sign out every device", seen for the first time: every session made before it is marked ended (once locked, passkey sessions excepted, as Check
// says why), and the moment is remembered so it is said once. Returns how many ended, or -1 when this moment was already handled.
func (a *Access) EndAllBefore(endBefore, now int64) (int64, error) {
	if seen, ok := metaNum(a.db, "end_before"); ok && seen >= endBefore {
		return -1, nil
	}
	locked := 0
	if _, ok := lockAt(a.db); ok {
		locked = 1
	}
	r, err := a.db.Exec("UPDATE sessions SET ended_at = ?, ended_why = 'panel' WHERE ended_at IS NULL AND made_at < ? AND NOT (link_id LIKE 'pk-%' AND ?)", now, endBefore, locked)
	if err != nil {
		return 0, err
	}
	if err := setMetaNum(a.db, "end_before", endBefore); err != nil {
		return 0, err
	}
	n, _ := r.RowsAffected()
	return n, nil
}

// ClampEndBefore is the panel's "sign out every device" moment, clamped to this runtime's clock the first time each value is seen. A file value in the future would refuse every
// session, including the passkey sign-in that follows, for as long as it lasts (a total lockout by one form); clamped, it ends the sessions made before the runtime saw it and
// never one made after.
func (a *Access) ClampEndBefore(raw *int64, now int64) *int64 {
	if raw == nil {
		return nil
	}
	if seen, ok := metaNum(a.db, "eb_raw"); !ok || seen != *raw {
		must(setMetaNum(a.db, "eb_raw", *raw))
		must(setMetaNum(a.db, "eb_val", min(*raw, now)))
	}
	if v, ok := metaNum(a.db, "eb_val"); ok {
		return &v
	}
	return nil
}

// ---- the wrong recovery codes count -------------------------------------------------------------------------------------------------------------------------

// CodesLocked: too many wrong recovery codes for this shop today? (Each wrong one counts; a right one does not.)
func (a *Access) CodesLocked(now int64) bool {
	_, err := a.db.Exec("DELETE FROM wrong_codes WHERE at <= ?", now-day)
	must(err)
	var n int
	must(a.db.QueryRow("SELECT count(*) FROM wrong_codes").Scan(&n))
	return n >= WrongCodeMax
}

// NoteWrongCode counts one wrong recovery code.
func (a *Access) NoteWrongCode(now int64) {
	_, err := a.db.Exec("INSERT INTO wrong_codes (at) VALUES (?)", now)
	must(err)
}

var challengeText = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
