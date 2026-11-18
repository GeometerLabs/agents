package access

// The owner's sessions, sign-in links and passkeys, in the file beside the store (owner-access.sqlite). The same tables as modules/channels/owner-access.ts, created the same way,
// so either runtime opens the other's file: a session made at one is good at the other, and a passkey registered at one signs in at the other.

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
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
  `

// Who is the owner now: their number (or the marker for none) and the address of their page. A session is good only for this pair.
type Who struct{ Owner, Base string }

// RelyingParty is the passkey's relying party: the host of the owner's page, and its origin.
type RelyingParty struct{ RpID, Origin string }

// Access is an open owner-access file.
type Access struct{ db *sql.DB }

// Open opens (or makes) the file.
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
	return &Access{db}, nil
}

// Close closes the file.
func (a *Access) Close() error { return a.db.Close() }

func ownerKey(number string) string {
	var digits strings.Builder
	for _, r := range number {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	return sha("owner-number:" + digits.String())
}

func linkHash(token string) string    { return sha("owner-signin:" + token) }
func sessionHash(token string) string { return sha("owner-session:" + token) }

func newToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type execer interface {
	Exec(string, ...any) (sql.Result, error)
	QueryRow(string, ...any) *sql.Row
	Query(string, ...any) (*sql.Rows, error)
}

func (a *Access) tx(work func(x execer) error) error {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	if err := work(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Session is a session just made: its token (given once), short id and end.
type Session struct {
	Token     string
	ID        string
	ExpiresAt int64
}

func startSession(x execer, key, base, from string, now int64) (Session, error) {
	s := Session{Token: newToken(), ID: newID(), ExpiresAt: now + SessionMs}
	if _, err := x.Exec("INSERT INTO sessions (id, hash, made_at, expires_at, owner_key, base, link_id) VALUES (?, ?, ?, ?, ?, ?, ?)", s.ID, sessionHash(s.Token), now, s.ExpiresAt, key, base, from); err != nil {
		return s, err
	}
	// at most MAX_SESSIONS live at once: the oldest ends, so a phone lost long ago does not stay signed in for ever behind newer ones
	rows, err := x.Query("SELECT id FROM sessions WHERE ended_at IS NULL AND expires_at > ? ORDER BY made_at DESC", now)
	if err != nil {
		return s, err
	}
	var live []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		live = append(live, id)
	}
	rows.Close()
	if len(live) > MaxSessions {
		for _, old := range live[MaxSessions:] {
			if _, err := x.Exec("UPDATE sessions SET ended_at = ?, ended_why = 'too_many' WHERE id = ?", now, old); err != nil {
				return s, err
			}
		}
	}
	return s, nil
}

// LinkState is what a sign-in link is now: valid, used, expired, replaced or unknown. Nothing is used up.
func (a *Access) LinkState(token string, who Who, now int64) string {
	if !ownerToken.MatchString(token) {
		return "unknown"
	}
	var state, key, base string
	var expires int64
	err := a.db.QueryRow("SELECT state, owner_key, base, expires_at FROM links WHERE hash = ?", linkHash(token)).Scan(&state, &key, &base, &expires)
	if err != nil || key != ownerKey(who.Owner) || base != who.Base || state == "unsent" {
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
	err = a.tx(func(x execer) error {
		var id, key, base string
		if err := x.QueryRow("SELECT id, owner_key, base FROM links WHERE hash = ?", linkHash(token)).Scan(&id, &key, &base); err != nil {
			return err
		}
		r, err := x.Exec("UPDATE links SET state = 'used', used_at = ? WHERE id = ? AND state = 'issued' AND expires_at > ?", now, id, now)
		if err != nil {
			return err
		}
		if n, _ := r.RowsAffected(); n != 1 {
			state = "used"
			return nil
		}
		s, err = startSession(x, key, base, id, now)
		return err
	})
	return s, state, err
}

// Check: is this session good now, for this owner at this address, made after the panel's last "sign out every device"? Its short id when it is.
func (a *Access) Check(token string, who Who, now int64, endBefore *int64) (string, bool) {
	if !ownerToken.MatchString(token) {
		return "", false
	}
	var id, key, base string
	var made, expires int64
	var ended sql.NullInt64
	err := a.db.QueryRow("SELECT id, made_at, expires_at, ended_at, owner_key, base FROM sessions WHERE hash = ?", sessionHash(token)).Scan(&id, &made, &expires, &ended, &key, &base)
	if err != nil || ended.Valid || expires <= now || key != ownerKey(who.Owner) || base != who.Base || (endBefore != nil && made < *endBefore) {
		return "", false
	}
	return id, true
}

// End is the owner signing out on this browser: the session ends. Its short id, or "" when there was none live.
func (a *Access) End(token string, now int64) string {
	if !ownerToken.MatchString(token) {
		return ""
	}
	var id string
	var ended sql.NullInt64
	if err := a.db.QueryRow("SELECT id, ended_at FROM sessions WHERE hash = ?", sessionHash(token)).Scan(&id, &ended); err != nil || ended.Valid {
		return ""
	}
	_, _ = a.db.Exec("UPDATE sessions SET ended_at = ?, ended_why = 'signed_out' WHERE id = ?", now, id)
	return id
}

// EndAllBefore is the panel's "sign out every device", seen for the first time: every session made before it is marked ended, and the moment is remembered so it is said once.
// Returns how many ended, or -1 when this moment was already handled.
func (a *Access) EndAllBefore(endBefore, now int64) (int64, error) {
	var seen string
	err := a.db.QueryRow("SELECT value FROM meta WHERE name = 'end_before'").Scan(&seen)
	if err == nil && seen != "" {
		var n int64
		for _, c := range seen {
			n = n*10 + int64(c-'0')
		}
		if n >= endBefore {
			return -1, nil
		}
	}
	r, err := a.db.Exec("UPDATE sessions SET ended_at = ?, ended_why = 'panel' WHERE ended_at IS NULL AND made_at < ?", now, endBefore)
	if err != nil {
		return 0, err
	}
	_, err = a.db.Exec("INSERT INTO meta (name, value) VALUES ('end_before', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", itoa(endBefore))
	n, _ := r.RowsAffected()
	return n, err
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

// ---- passkeys --------------------------------------------------------------------------------------------------------------------------------------------

var challengeText = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func challengeHash(c string) string { return sha("owner-challenge:" + c) }

// userID is this shop's WebAuthn user id: 16 random bytes made once, so a phone keeps one passkey per shop even though every shop shares the RP ID.
func (a *Access) userID() (string, error) {
	var v string
	if err := a.db.QueryRow("SELECT value FROM meta WHERE name = 'webauthn_user'").Scan(&v); err == nil {
		return v, nil
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	if _, err := a.db.Exec("INSERT INTO meta (name, value) VALUES ('webauthn_user', ?) ON CONFLICT(name) DO NOTHING", base64.RawURLEncoding.EncodeToString(b)); err != nil {
		return "", err
	}
	err := a.db.QueryRow("SELECT value FROM meta WHERE name = 'webauthn_user'").Scan(&v)
	return v, err
}

// newChallenge makes a fresh challenge for one ceremony, kept as a hash; it goes to the page once. At most ChallengeKept are open: past that the OLDEST open ones go, never the new
// one, so a flood cannot grow the file and cannot lock the owner out either.
func (a *Access) newChallenge(kind string, now int64, grant string) (string, error) {
	c := make([]byte, 32)
	_, _ = rand.Read(c)
	text := base64.RawURLEncoding.EncodeToString(c)
	err := a.tx(func(x execer) error {
		if _, err := x.Exec("DELETE FROM challenges WHERE expires_at <= ?", now-day); err != nil {
			return err
		}
		if _, err := x.Exec("DELETE FROM challenges WHERE hash IN (SELECT hash FROM challenges WHERE used_at IS NULL ORDER BY made_at DESC LIMIT -1 OFFSET ?)", ChallengeKept-1); err != nil {
			return err
		}
		var g any
		if grant != "" {
			g = grant
		}
		_, err := x.Exec("INSERT INTO challenges (hash, kind, grant_hash, made_at, expires_at) VALUES (?, ?, ?, ?, ?)", challengeHash(text), kind, g, now, now+ChallengeMs)
		return err
	})
	return text, err
}

// challengeOf is the challenge a browser's client data names, if it is one of ours for this ceremony, unused and in time.
func (a *Access) challengeOf(clientData []byte, kind string, now int64, grant string) string {
	var cd struct {
		Challenge any `json:"challenge"`
	}
	if json.Unmarshal(clientData, &cd) != nil {
		return ""
	}
	c, ok := cd.Challenge.(string)
	if !ok || !challengeText.MatchString(c) {
		return ""
	}
	var k string
	var g sql.NullString
	var expires int64
	var used sql.NullInt64
	if err := a.db.QueryRow("SELECT kind, grant_hash, expires_at, used_at FROM challenges WHERE hash = ?", challengeHash(c)).Scan(&k, &g, &expires, &used); err != nil {
		return ""
	}
	if k != kind || used.Valid || expires <= now || (grant != "" && g.String != grant) {
		return ""
	}
	return c
}

// GrantState: a grant as it stands now: the panel's file, and this store's memory of grants used.
func (a *Access) GrantState(g Grant, file *Grants, now int64) string {
	in := g.InFile(file, now)
	if in == "unknown" {
		return "unknown"
	}
	var one int
	if a.db.QueryRow("SELECT 1 FROM grants_used WHERE hash = ?", g.Hash()).Scan(&one) == nil {
		return "used"
	}
	return in
}

// CodesLocked: too many wrong recovery codes for this shop today? (Each wrong one counts; a right one does not.)
func (a *Access) CodesLocked(now int64) bool {
	_, _ = a.db.Exec("DELETE FROM wrong_codes WHERE at <= ?", now-day)
	var n int
	_ = a.db.QueryRow("SELECT count(*) FROM wrong_codes").Scan(&n)
	return n >= WrongCodeMax
}

// NoteWrongCode counts one wrong recovery code.
func (a *Access) NoteWrongCode(now int64) {
	_, _ = a.db.Exec("INSERT INTO wrong_codes (at) VALUES (?)", now)
}

type passkeyRow struct {
	ID, CredID, JWK, OwnerKey, RpID string
	Alg                             int
	SignCount                       uint32
	BackedUp                        bool
	MadeAt                          int64
}

func (a *Access) passkeyRows(where string, args ...any) ([]passkeyRow, error) {
	rows, err := a.db.Query("SELECT id, cred_id, jwk, alg, sign_count, backed_up, made_at, owner_key, rp_id FROM passkeys WHERE removed_at IS NULL"+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []passkeyRow
	for rows.Next() {
		var r passkeyRow
		var bu int
		if err := rows.Scan(&r.ID, &r.CredID, &r.JWK, &r.Alg, &r.SignCount, &bu, &r.MadeAt, &r.OwnerKey, &r.RpID); err != nil {
			return nil, err
		}
		r.BackedUp = bu == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

// good: is a passkey row good now for this owner, on this RP ID, made after the panel's "remove the owner's passkeys"?
func good(r passkeyRow, who Who, rp RelyingParty, before *int64) bool {
	return r.OwnerKey == ownerKey(who.Owner) && r.RpID == rp.RpID && (before == nil || r.MadeAt >= *before)
}

// Passkeys is how many passkeys the owner has here.
func (a *Access) Passkeys(who Who, rp RelyingParty, before *int64) int {
	rows, _ := a.passkeyRows(" ORDER BY made_at")
	n := 0
	for _, r := range rows {
		if good(r, who, rp, before) {
			n++
		}
	}
	return n
}

func b64(s any, max int) ([]byte, bool) {
	t, ok := s.(string)
	if !ok || t == "" || len(t) > max || !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(t) {
		return nil, false
	}
	b, err := base64.RawURLEncoding.DecodeString(t)
	return b, err == nil
}

var (
	errRefused = errors.New("refused")
	regexp_id  = regexp.MustCompile(`^[A-Za-z0-9_-]+$`) // RE2 refuses a repeat count over 1000, so the length (16 to 1400) is checked by credID
)

// Link limits: 3 requests a quarter of an hour, 10 a day.
var linkLimits = []struct{ max, perMs int64 }{{3, 15 * 60_000}, {10, day}}

// TryAttempt counts one request for a link if the shop's limits allow it. Every attempt counts, whether or not a link then goes out, so the record's lines about links are bounded.
func (a *Access) TryAttempt(now int64) bool {
	_, _ = a.db.Exec("DELETE FROM attempts WHERE at <= ?", now-linkLimits[1].perMs)
	for _, w := range linkLimits {
		var n int64
		_ = a.db.QueryRow("SELECT count(*) FROM attempts WHERE at > ?", now-w.perMs).Scan(&n)
		if n >= w.max {
			return false
		}
	}
	_, _ = a.db.Exec("INSERT INTO attempts (at) VALUES (?)", now)
	return true
}
