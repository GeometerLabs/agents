package chatid

// Who a chat guest is, kept by the shop's own runtime (modules/channels/chat-identity.ts; W2, 17 Nov 2026): the customer's key pair (a passkey) bound to a thread and used to open it on
// another phone, the number the customer gave for a new phone, the one-use links to it, and the counts that keep all of that from being flooded. The Go twin of the TypeScript, function
// for function: the same file (chat-identity.sqlite, its tables made by the same text, so a shop moves between the two runtimes), the same rules in the same order.
//
// The checks of a ceremony (the challenge, the origin, the relying party's hash, user presence AND user verification, the signature, the counter) are
// github.com/go-webauthn/webauthn's, as in the owner's sign-in (internal/access); what is ours is the shop's rules around it: credentials are this shop's alone (an RP ID is shared by every
// shop on the pages domain, so each thread has its OWN WebAuthn user id, and a key made for another shop is unknown here), the challenge is made for one ceremony and one thread and works
// once, and every change that must hold together (a challenge used up with the key kept, the counter moved with the phone tied) is one transaction.
//
// Concurrency: the file has one connection (the runtime's handlers run in turn through it), as the owner's access file does.

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"

	_ "modernc.org/sqlite"
)

// File is the name of the identity file in the runtime's data folder.
const File = "chat-identity.sqlite"

const (
	hour = 60 * 60_000
	day  = 24 * hour
	// ChallengeMs is how long a challenge lasts (CHAT_CHALLENGE_MS).
	ChallengeMs = 5 * 60_000
	// MaxKeysPerThread is the most passkeys one thread keeps (a phone, a new phone, a tablet). The one used longest ago goes first.
	MaxKeysPerThread = 5
	// RecoveryLinkMs is how long a recovery link works, once.
	RecoveryLinkMs = 15 * 60_000
	// ChallengesKept are the open challenges kept at most: a flood pushes the oldest out, never the newest.
	ChallengesKept = 300
	// LinksPerDay is "send me my booking link": three a day for a thread.
	LinksPerDay = 3
	// WrongLinkLimit is the wrong or used-up recovery links a shop takes in a day before it stops looking (the front's per-address count comes first).
	WrongLinkLimit = 20
)

// Window is one rate window: at most Max in PerMs.
type Window struct {
	Max   int
	PerMs int64
}

// The recovery sends: per number (two an hour, three a day) and per shop (five in a quarter of an hour, twenty a day). Every ask counts, whether or not a link then goes out.
var (
	RecoveryPerNumber = []Window{{2, hour}, {3, day}}
	RecoveryPerShop   = []Window{{5, 15 * 60_000}, {20, day}}
)

// RelyingParty is the page's own address as the shop's pages file names it (never a string the front sends).
type RelyingParty struct{ RpID, Origin string }

// LinkToken is a recovery link's token: 32 random bytes in base64url.
var LinkToken = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// schema is chat-identity.ts's CREATE text, copied character for character (indentation, line breaks and the comments included): SQLite keeps each statement's text in sqlite_master.
const schema = `

    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (guest TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS creds (
      id TEXT PRIMARY KEY, cred_id TEXT NOT NULL UNIQUE, guest TEXT NOT NULL, jwk TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL, backed_up INTEGER NOT NULL,
      made_at INTEGER NOT NULL, used_at INTEGER, rp_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('register', 'signin')), guest TEXT, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS alias (from_hash TEXT PRIMARY KEY, to_hash TEXT NOT NULL, made_at INTEGER NOT NULL);
    -- the phones (guest hashes) that kept the chat or opened it with a key: a phone restored only by a link is not one, so it is still offered a key of its own
    CREATE TABLE IF NOT EXISTS phones (hash TEXT PRIMARY KEY, guest TEXT NOT NULL, made_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS contact (guest TEXT PRIMARY KEY, number TEXT NOT NULL, key TEXT NOT NULL, made_at INTEGER NOT NULL);
    -- a number typed on the keep box waits here until its owner taps the link sent to it (confirmNumber); only then does it become the thread's contact
    CREATE TABLE IF NOT EXISTS pending (hash TEXT PRIMARY KEY, id TEXT NOT NULL, guest TEXT NOT NULL, number TEXT NOT NULL, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('issued', 'used', 'replaced', 'unsent')));
    CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, id TEXT NOT NULL, guest TEXT NOT NULL, made_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, state TEXT NOT NULL CHECK (state IN ('issued', 'used', 'replaced', 'unsent')));
    CREATE TABLE IF NOT EXISTS attempts (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL);
  `

// Store is the identity file.
type Store struct{ db *sql.DB }

// Open opens (and makes) the identity file.
func Open(file string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+file+"?_txlock=immediate&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// Close closes the file.
func (s *Store) Close() error { return s.db.Close() }

func sha(text string) string {
	h := sha256.Sum256([]byte(text))
	return hex.EncodeToString(h[:])
}

func tokenHash(token string) string   { return sha("chat-recovery:" + token) }
func confirmHash(token string) string { return sha("chat-confirm:" + token) }
func challengeHash(c string) string   { return sha("chat-challenge:" + c) }

// NumberKey is a number as the file keeps it for lookup: the digits only, hashed.
func NumberKey(digits string) string {
	var b strings.Builder
	for _, r := range digits {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return sha("chat-number:" + b.String())
}

func random(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Resolve is the thread a guest hash names now: itself, or the thread a passkey or a link tied it to. One step only: an alias never points at an alias. A read that fails answers the hash
// itself, as a guest nobody tied (the thread then simply has nothing of the old one).
func (s *Store) Resolve(hash string) string {
	var to string
	if err := s.db.QueryRow("SELECT to_hash FROM alias WHERE from_hash = ?", hash).Scan(&to); err != nil {
		return hash
	}
	return to
}

// userID is this thread's WebAuthn user id: 16 random bytes made once, so a phone keeps one passkey per thread and per shop even though every shop shares the RP ID.
func (s *Store) userID(guest string) (string, error) {
	var have string
	if err := s.db.QueryRow("SELECT user_id FROM users WHERE guest = ?", guest).Scan(&have); err == nil {
		return have, nil
	}
	if _, err := s.db.Exec("INSERT INTO users (guest, user_id) VALUES (?, ?) ON CONFLICT(guest) DO NOTHING", guest, random(16)); err != nil {
		return "", err
	}
	err := s.db.QueryRow("SELECT user_id FROM users WHERE guest = ?", guest).Scan(&have)
	return have, err
}

// take counts one try against windows for a key; false when a window is full (nothing is counted then).
func (s *Store) take(kind, key string, windows []Window, now int64) bool {
	if _, err := s.db.Exec("DELETE FROM attempts WHERE at <= ?", now-day); err != nil {
		return false // fail closed: a file that cannot be written does not let a flood through
	}
	for _, w := range windows {
		var n int
		if s.db.QueryRow("SELECT count(*) FROM attempts WHERE kind = ? AND key = ? AND at > ?", kind, key, now-w.PerMs).Scan(&n) != nil || n >= w.Max {
			return false
		}
	}
	_, err := s.db.Exec("INSERT INTO attempts (kind, key, at) VALUES (?, ?, ?)", kind, key, now)
	return err == nil
}

// tx runs f in one immediate transaction: it commits when f returns nil, and rolls back for any error (errRefused is a refusal, not a failure).
func (s *Store) tx(f func(x *sql.Tx) error) error {
	x, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := f(x); err != nil {
		_ = x.Rollback()
		return err
	}
	return x.Commit()
}

var errRefused = errors.New("refused")

// ---- the thread's keys ----

// State is what the page may be told about a guest (never a key): how many keys keep this thread, whether THIS phone kept it or opened it with one (`Here`: a phone brought back by a link has
// none of its own and is offered one), and whether a number was given for a new phone.
type State struct {
	Keys   int
	Here   bool
	Number bool
}

// State is chat-identity.ts state.
func (s *Store) State(hash string) State {
	g := s.Resolve(hash)
	var st State
	_ = s.db.QueryRow("SELECT count(*) FROM creds WHERE guest = ?", g).Scan(&st.Keys)
	var one int
	st.Here = s.db.QueryRow("SELECT 1 FROM phones WHERE hash = ? AND guest = ?", hash, g).Scan(&one) == nil
	st.Number = s.db.QueryRow("SELECT 1 FROM contact WHERE guest = ?", g).Scan(&one) == nil
	return st
}

// newChallenge makes a fresh challenge, kept as a hash. Past ChallengesKept open ones the OLDEST go, never the new one.
func (s *Store) newChallenge(kind string, guest *string, now int64) (string, error) {
	if _, err := s.db.Exec("DELETE FROM challenges WHERE expires_at <= ?", now-day); err != nil {
		return "", err
	}
	if _, err := s.db.Exec("DELETE FROM challenges WHERE hash IN (SELECT hash FROM challenges WHERE used_at IS NULL ORDER BY made_at DESC LIMIT -1 OFFSET ?)", ChallengesKept-1); err != nil {
		return "", err
	}
	c := random(32)
	var g any
	if guest != nil {
		g = *guest
	}
	_, err := s.db.Exec("INSERT INTO challenges (hash, kind, guest, made_at, expires_at) VALUES (?, ?, ?, ?, ?)", challengeHash(c), kind, g, now, now+ChallengeMs)
	return c, err
}

// Tie is: this phone's guest hash now names `thread` (its own bookings, orders, lines and caps). A phone that already is the thread needs no alias.
func (s *Store) Tie(hash, thread string, now int64) error { return tie(s.db, hash, thread, now) }

type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func tie(x execer, hash, thread string, now int64) error {
	if hash == thread {
		return nil
	}
	_, err := x.Exec("INSERT INTO alias (from_hash, to_hash, made_at) VALUES (?, ?, ?) ON CONFLICT(from_hash) DO UPDATE SET to_hash = excluded.to_hash, made_at = excluded.made_at", hash, thread, now)
	return err
}

// ---- the number the customer gave, for a new phone ----

// SetNumber is the number (digits, country code first) the customer gave for a new phone. One per thread; a new one replaces it.
func (s *Store) SetNumber(hash, digits string, now int64) error {
	return setNumber(s.db, s.Resolve(hash), digits, now)
}

func setNumber(x execer, guest, digits string, now int64) error {
	_, err := x.Exec("INSERT INTO contact (guest, number, key, made_at) VALUES (?, ?, ?, ?) ON CONFLICT(guest) DO UPDATE SET number = excluded.number, key = excluded.key, made_at = excluded.made_at", guest, digits, NumberKey(digits), now)
	return err
}

// NumberOf is the number the thread gave, or "".
func (s *Store) NumberOf(hash string) string {
	var n string
	_ = s.db.QueryRow("SELECT number FROM contact WHERE guest = ?", s.Resolve(hash)).Scan(&n)
	return n
}

// GuestOfNumber is the thread most lately given this number, if any (a thread with a passkey or a booking is no likelier than another: the number is unverified, so a link only ever goes TO
// the number).
func (s *Store) GuestOfNumber(digits string) string {
	var g string
	_ = s.db.QueryRow("SELECT guest FROM contact WHERE key = ? ORDER BY made_at DESC LIMIT 1", NumberKey(digits)).Scan(&g)
	return g
}

// CountRecoveryAsk counts one ask for a link to a number, whether or not anything is then sent: per number and per shop. False: wait.
func (s *Store) CountRecoveryAsk(digits string, now int64) bool {
	return s.take("recover-shop", "shop", RecoveryPerShop, now) && s.take("recover-number", NumberKey(digits), RecoveryPerNumber, now)
}

// CountLinksAsk counts one "send me my booking link": three a day for the thread, three a day for the number it goes to and twenty a day for the shop, so several threads naming one number
// (or many threads at one shop) cannot make the shop's WhatsApp send more. False too when the thread has no number.
func (s *Store) CountLinksAsk(hash string, now int64) bool {
	g := s.Resolve(hash)
	number := s.NumberOf(g)
	if number == "" {
		return false
	}
	three := []Window{{LinksPerDay, day}}
	return s.take("links", g, three, now) && s.take("links-number", NumberKey(number), three, now) && s.take("links-shop", "shop", []Window{{20, day}}, now)
}

// ---- the one-use link to the number ----

// Issued is a link made: its id, the token (returned ONCE and never kept) and when it runs out.
type Issued struct {
	ID, Token string
	ExpiresAt int64
}

// IssueLink makes a new one-use link for a thread; every older unused one for it stops working (one works at a time).
func (s *Store) IssueLink(guest string, now int64) (Issued, error) {
	i := Issued{ID: randomHex(6), Token: random(32), ExpiresAt: now + RecoveryLinkMs}
	err := s.tx(func(x *sql.Tx) error {
		if _, err := x.Exec("UPDATE links SET state = 'replaced' WHERE guest = ? AND state = 'issued'", guest); err != nil {
			return err
		}
		_, err := x.Exec("INSERT INTO links (hash, id, guest, made_at, expires_at, state) VALUES (?, ?, ?, ?, ?, 'issued')", tokenHash(i.Token), i.ID, guest, now, i.ExpiresAt)
		return err
	})
	return i, err
}

// LinkUnsent: the send failed before anything went out, so nobody has the link.
func (s *Store) LinkUnsent(id string) {
	_, _ = s.db.Exec("UPDATE links SET state = 'unsent' WHERE id = ? AND state = 'issued'", id)
}

// LinkState is what a link is now, for the page that shows its button: "valid", "used", "expired", "replaced" or "unknown". Nothing is used up.
func (s *Store) LinkState(token string, now int64) string {
	return state(s.db, "links", tokenHash, token, now)
}

func state(db *sql.DB, table string, hashOf func(string) string, token string, now int64) string {
	if !LinkToken.MatchString(token) {
		return "unknown"
	}
	var st string
	var expires int64
	if db.QueryRow("SELECT state, expires_at FROM "+table+" WHERE hash = ?", hashOf(token)).Scan(&st, &expires) != nil || st == "unsent" {
		return "unknown"
	}
	if st == "used" || st == "replaced" {
		return st
	}
	if expires > now {
		return "valid"
	}
	return "expired"
}

// WrongLinksLocked: wrong links today have reached the shop's own cap (a right one does not count).
func (s *Store) WrongLinksLocked(now int64) bool {
	_, _ = s.db.Exec("DELETE FROM attempts WHERE at <= ?", now-day)
	var n int
	return s.db.QueryRow("SELECT count(*) FROM attempts WHERE kind = 'wrong-link' AND at > ?", now-day).Scan(&n) != nil || n >= WrongLinkLimit
}

// NoteWrongLink counts one wrong link.
func (s *Store) NoteWrongLink(now int64) {
	_, _ = s.db.Exec("INSERT INTO attempts (kind, key, at) VALUES ('wrong-link', 'shop', ?)", now)
}

// UseLink uses a link up and ties THIS phone's guest hash to the link's thread, in one statement that also checks it has not run out, so two presses (two tabs, a scanner and a person) can
// never both win. It returns the thread's hash (kept from the browser), or the state that stopped it.
func (s *Store) UseLink(token, hash string, now int64) (thread, stopped string, err error) {
	if st := s.LinkState(token, now); st != "valid" {
		return "", st, nil
	}
	var guest string
	if err := s.db.QueryRow("SELECT guest FROM links WHERE hash = ?", tokenHash(token)).Scan(&guest); err != nil {
		return "", "unknown", nil
	}
	err = s.tx(func(x *sql.Tx) error {
		r, err := x.Exec("UPDATE links SET state = 'used', used_at = ? WHERE hash = ? AND state = 'issued' AND expires_at > ?", now, tokenHash(token), now)
		if err != nil {
			return err
		}
		if n, _ := r.RowsAffected(); n != 1 {
			stopped = "used"
			return errRefused
		}
		return tie(x, hash, guest, now)
	})
	if errors.Is(err, errRefused) {
		return "", stopped, nil
	}
	if err != nil {
		return "", "", err
	}
	return guest, "", nil
}

// ---- forgetting ----

// Forget is "delete my chat", this side: the thread's passkeys, user id, number, links and every phone tied to it are gone, and so is this phone's own tie. The words and the thread are taken
// off by the step that follows (runtime ForgetChat). It returns the thread's hash, for that step.
func (s *Store) Forget(hash string) (string, error) {
	g := s.Resolve(hash)
	if err := s.DropThread(g); err != nil {
		return g, err
	}
	_, err := s.db.Exec("DELETE FROM alias WHERE from_hash = ?", hash)
	return g, err
}

// DropThread is everything this side keeps for one thread: keys, user id, number, a number waiting to be confirmed, links, the phones that hold a key and every phone tied to it.
func (s *Store) DropThread(g string) error {
	for _, q := range []string{"DELETE FROM creds WHERE guest = ?", "DELETE FROM phones WHERE guest = ?", "DELETE FROM users WHERE guest = ?", "DELETE FROM contact WHERE guest = ?", "DELETE FROM pending WHERE guest = ?", "DELETE FROM links WHERE guest = ?", "DELETE FROM alias WHERE to_hash = ?"} {
		if _, err := s.db.Exec(q, g); err != nil {
			return err
		}
	}
	return nil
}

// DropGone is retention: a thread the shop has cleared (its words, after the conversation retention) takes its keys, number and ties with it. `live` says whether the shop still has the
// thread. It returns how many threads were dropped.
func (s *Store) DropGone(live func(thread string) bool) (int, error) {
	rows, err := s.db.Query("SELECT guest AS g FROM creds UNION SELECT guest FROM contact UNION SELECT guest FROM pending UNION SELECT guest FROM links UNION SELECT to_hash FROM alias")
	if err != nil {
		return 0, err
	}
	var all []string
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			_ = rows.Close()
			return 0, err
		}
		all = append(all, g)
	}
	_ = rows.Close()
	n := 0
	for _, g := range all {
		if !live(g) {
			if err := s.DropThread(g); err != nil {
				return n, err
			}
			n++
		}
	}
	return n, nil
}

// ---- a number counts only once its owner has tapped the link sent to it ----

// IssueConfirm makes a new one-use link asking whoever holds this number to confirm it for the thread (a newer one replaces an older). The token is returned ONCE, to the step that sends it.
func (s *Store) IssueConfirm(guest, digits string, now int64) (Issued, error) {
	i := Issued{ID: randomHex(6), Token: random(32), ExpiresAt: now + RecoveryLinkMs}
	err := s.tx(func(x *sql.Tx) error {
		if _, err := x.Exec("UPDATE pending SET state = 'replaced' WHERE guest = ? AND state = 'issued'", guest); err != nil {
			return err
		}
		_, err := x.Exec("INSERT INTO pending (hash, id, guest, number, made_at, expires_at, state) VALUES (?, ?, ?, ?, ?, ?, 'issued')", confirmHash(i.Token), i.ID, guest, digits, now, i.ExpiresAt)
		return err
	})
	return i, err
}

// ConfirmUnsent: the confirm link was never sent.
func (s *Store) ConfirmUnsent(id string) {
	_, _ = s.db.Exec("UPDATE pending SET state = 'unsent' WHERE id = ? AND state = 'issued'", id)
}

// ConfirmState is what a confirm link is now (looking uses nothing up).
func (s *Store) ConfirmState(token string, now int64) string {
	return state(s.db, "pending", confirmHash, token, now)
}

// ConfirmNumber is the button: in one statement the link is used up and the number becomes the thread's contact. It returns "" on success, or the state that stopped it.
func (s *Store) ConfirmNumber(token string, now int64) (string, error) {
	if st := s.ConfirmState(token, now); st != "valid" {
		return st, nil
	}
	var guest, number string
	if err := s.db.QueryRow("SELECT guest, number FROM pending WHERE hash = ?", confirmHash(token)).Scan(&guest, &number); err != nil {
		return "unknown", nil
	}
	stopped := ""
	err := s.tx(func(x *sql.Tx) error {
		r, err := x.Exec("UPDATE pending SET state = 'used' WHERE hash = ? AND state = 'issued' AND expires_at > ?", confirmHash(token), now)
		if err != nil {
			return err
		}
		if n, _ := r.RowsAffected(); n != 1 {
			stopped = "used"
			return errRefused
		}
		return setNumber(x, guest, number, now)
	})
	if errors.Is(err, errRefused) {
		return stopped, nil
	}
	return "", err
}

// CountConfirmAsk counts one ask to confirm a number: per number and per shop like a recovery ask, and five a day for the thread.
func (s *Store) CountConfirmAsk(hash, digits string, now int64) bool {
	return s.take("confirm", s.Resolve(hash), []Window{{5, day}}, now) && s.CountRecoveryAsk(digits, now)
}

// Purge: what is kept past its use goes: a number is kept for the thread's retention (30 days from when it was given: the thread is cleared then, and the number is not worth keeping
// without it), a link a day after it ran out, a tie and a phone's mark twice the cookie's life. A key is the customer's own and stays until they delete the chat.
func (s *Store) Purge(now int64, retentionDays int64) {
	for _, q := range []struct {
		sql string
		at  int64
	}{
		{"DELETE FROM contact WHERE made_at < ?", now - retentionDays*day},
		{"DELETE FROM pending WHERE expires_at < ?", now - day},
		{"DELETE FROM links WHERE expires_at < ?", now - day},
		{"DELETE FROM alias WHERE made_at < ?", now - 2*retentionDays*day},
		{"DELETE FROM phones WHERE made_at < ?", now - 2*retentionDays*day},
	} {
		_, _ = s.db.Exec(q.sql, q.at)
	}
}
