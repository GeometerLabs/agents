package push

// The push store (modules/push/store.ts): the shop's VAPID key, the phones that allowed alerts, the owner's choice of WhatsApp, push or both, and the waiting pushes. It is the TypeScript
// runtime's own file, push.sqlite in the data folder, with the same tables and columns (including the two added later, `signer` and `ref`), so a subscription made by one runtime is seen
// by the other when they take turns on one folder, and the VAPID key made by one signs for the other (browsers subscribed to that key's public half).
//
// What is kept of a subscription is its push service's host, its path and its two keys: together they are a secret (whoever holds them can encrypt to that phone), so they stay in
// this file only; the record and the exports name a subscription by its short id.

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"sync"
	"unicode/utf16"

	_ "modernc.org/sqlite"
)

// File is the store's name in the data folder.
const File = "push.sqlite"

// Phones the owner keeps alerts on, and phones per customer page.
const (
	OwnerPhones    = 5
	CustomerPhones = 2
	// MaxTries is how many times a push is tried before it is given up (a push service down for a while); MaxWaitMs is how long it is kept waiting at most.
	MaxTries  = 6
	MaxWaitMs = 12 * 60 * 60_000
)

// OwnerChoices are where alerts to the owner may go; "whatsapp" is the default until the owner turns alerts on in their app.
var OwnerChoices = []string{"whatsapp", "push", "both"}

// Subscription is a browser's PushSubscription.toJSON().
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Sub is a kept subscription, for the sender. Signer is "own" (the shop's VAPID key) or "streetlist" (Streetlist's relay signs).
type Sub struct {
	ID, Who, Host, Path string
	P256dh, Auth        []byte
	Signer              string
}

// Waiting is one waiting push.
type Waiting struct {
	ID, Kind, Title, Body, Tag string
	MadeAt                     int64
	Tries                      int
	Sub                        Sub
}

// ShapeProblem is what a body that is not {endpoint, keys: {p256dh, auth}} (strings all) is told.
const ShapeProblem = "a subscription is {endpoint, keys: {p256dh, auth}}"

func userInfo(u *url.URL) bool {
	if u.User == nil {
		return false
	}
	pw, _ := u.User.Password()
	return u.User.Username() != "" || pw != ""
}

// SubscriptionProblem is why a browser's subscription is refused, or "": an https address at one of the push services the Guard allows, a P-256 key and a 16-byte auth secret. The
// address is read as JavaScript's `new URL` reads it where it matters here: the default port 443 is no port, and an empty "#" is no fragment.
func SubscriptionProblem(endpoint, p256dh, auth string) string {
	if utf16Len(endpoint) > 1000 {
		return ShapeProblem
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "the endpoint is not an address"
	}
	if u.Scheme != "https" || (u.Port() != "" && u.Port() != "443") || userInfo(u) || u.Fragment != "" {
		return "the endpoint must be a plain https address"
	}
	if !hostAllowed(u.Hostname()) {
		return "the push service " + u.Hostname() + " is not one this shop sends to"
	}
	key := decodeB64URL(p256dh)
	if !IsUncompressedP256(key) {
		return "p256dh is not a P-256 public key"
	}
	if _, err := ecdhPublic(key); err != nil {
		return "p256dh is not a point on P-256"
	}
	if len(decodeB64URL(auth)) != 16 {
		return "auth is not 16 bytes"
	}
	return ""
}

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// Store is an open push store. Every call takes the lock, so the HTTP routes and the sender never interleave a multi-statement change.
type Store struct {
	mu sync.Mutex
	db *sql.DB
}

// Open opens (making it if need be) the store at file.
func Open(file string) (*Store, error) {
	db, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: file, RawQuery: "_pragma=busy_timeout(5000)"}).String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subs (
      id TEXT PRIMARY KEY, who TEXT NOT NULL, host TEXT NOT NULL, path TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      made_at INTEGER NOT NULL, dead_at INTEGER, dead_why TEXT, UNIQUE (host, path)
    );
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY, sub_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, tag TEXT NOT NULL,
      made_at INTEGER NOT NULL, next_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK (state IN ('waiting', 'sent', 'gone', 'refused', 'failed')), done_at INTEGER, status INTEGER
    );
    CREATE INDEX IF NOT EXISTS queue_waiting ON queue (state, next_at);
  `); err != nil {
		db.Close()
		return nil, err
	}
	s := &Store{db: db}
	// an older store has no `signer` (W3) or `ref` (owner's item 2) column and CREATE TABLE IF NOT EXISTS would not add it, so it is added once, here (the TypeScript store does the same)
	for _, c := range [][2]string{{"signer", "TEXT NOT NULL DEFAULT 'own'"}, {"ref", "TEXT"}} {
		has, err := s.hasColumn("subs", c[0])
		if err != nil {
			db.Close()
			return nil, err
		}
		if !has {
			if _, err := db.Exec("ALTER TABLE subs ADD COLUMN " + c[0] + " " + c[1]); err != nil {
				db.Close()
				return nil, err
			}
		}
	}
	return s, nil
}

func (s *Store) hasColumn(table, col string) (bool, error) {
	rows, err := s.db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == col {
			return true, nil
		}
	}
	return false, rows.Err()
}

// Close closes the file.
func (s *Store) Close() error { return s.db.Close() }

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Vapid is the shop's VAPID key, made once on first use and kept here (the shop's own server is the only place it lives).
func (s *Store) Vapid() (VapidKeys, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var have string
	err := s.db.QueryRow("SELECT value FROM meta WHERE name = 'vapid'").Scan(&have)
	if errors.Is(err, sql.ErrNoRows) {
		k, err := NewVapidKeys()
		if err != nil {
			return VapidKeys{}, err
		}
		b, _ := json.Marshal(k)
		// a second maker (the other runtime, started at the same moment) leaves the first key in place
		if _, err := s.db.Exec("INSERT INTO meta (name, value) VALUES ('vapid', ?) ON CONFLICT(name) DO NOTHING", string(b)); err != nil {
			return VapidKeys{}, err
		}
		err = s.db.QueryRow("SELECT value FROM meta WHERE name = 'vapid'").Scan(&have)
		if err != nil {
			return VapidKeys{}, err
		}
	} else if err != nil {
		return VapidKeys{}, err
	}
	var k VapidKeys
	return k, json.Unmarshal([]byte(have), &k)
}

// pathOf is what the store keys a subscription by: the address's path and query, as JavaScript's `${pathname}${search}`.
func pathOf(u *url.URL) string {
	p := u.EscapedPath()
	if p == "" {
		p = "/"
	}
	if u.RawQuery != "" {
		p += "?" + u.RawQuery
	}
	return p
}

type subRow struct {
	id, who, host, path, p256dh, auth, signer string
	madeAt                                    int64
}

func (r subRow) sub() Sub {
	return Sub{ID: r.id, Who: r.who, Host: r.host, Path: r.path, P256dh: decodeB64URL(r.p256dh), Auth: decodeB64URL(r.auth), Signer: map[bool]string{true: "streetlist", false: "own"}[r.signer == "streetlist"]}
}

func (s *Store) live(who string) ([]subRow, error) {
	rows, err := s.db.Query("SELECT id, who, host, path, p256dh, auth, made_at, signer FROM subs WHERE who = ? AND dead_at IS NULL ORDER BY made_at", who)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []subRow
	for rows.Next() {
		var r subRow
		if err := rows.Scan(&r.id, &r.who, &r.host, &r.path, &r.p256dh, &r.auth, &r.madeAt, &r.signer); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Subscribe keeps a browser's subscription for `who` ("owner", or a customer page's conversation). The same address again is the same subscription (moved to `who` if a page passed it
// on). `ref` is the passkey (phone) of the owner it was made from, or "". Returns its short id, or why it was refused.
func (s *Store) Subscribe(who string, sub Subscription, now int64, signer, ref string) (id string, why string, err error) {
	if p := SubscriptionProblem(sub.Endpoint, sub.P256dh, sub.Auth); p != "" {
		return "", p, nil
	}
	u, _ := url.Parse(sub.Endpoint)
	path := pathOf(u)
	s.mu.Lock()
	defer s.mu.Unlock()
	id = newID()
	var old string
	if e := s.db.QueryRow("SELECT id FROM subs WHERE host = ? AND path = ?", u.Hostname(), path).Scan(&old); e == nil {
		id = old
	} else if !errors.Is(e, sql.ErrNoRows) {
		return "", "", e
	}
	var refArg any
	if ref != "" {
		refArg = ref
	}
	if _, err = s.db.Exec(`INSERT INTO subs (id, who, host, path, p256dh, auth, made_at, signer, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host, path) DO UPDATE SET who = excluded.who, p256dh = excluded.p256dh, auth = excluded.auth, made_at = excluded.made_at, signer = excluded.signer, ref = excluded.ref, dead_at = NULL, dead_why = NULL`,
		id, who, u.Hostname(), path, sub.P256dh, sub.Auth, now, signer, refArg); err != nil {
		return "", "", err
	}
	max := CustomerPhones
	if who == "owner" {
		max = OwnerPhones
	}
	rows, err := s.live(who)
	if err != nil {
		return "", "", err
	}
	if extra := len(rows) - max; extra > 0 {
		for _, r := range rows[:extra] {
			if err := s.drop(r.id, "too_many", now); err != nil {
				return "", "", err
			}
		}
	}
	return id, "", nil
}

// Unsubscribe: the browser said it no longer wants alerts (or the page dropped them): the subscription ends.
func (s *Store) Unsubscribe(who, endpoint string, now int64) (bool, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var id string
	if e := s.db.QueryRow("SELECT id FROM subs WHERE who = ? AND host = ? AND path = ? AND dead_at IS NULL", who, u.Hostname(), pathOf(u)).Scan(&id); e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return false, nil
		}
		return false, e
	}
	return true, s.drop(id, "unsubscribed", now)
}

// drop ends a subscription: the push service said it is gone (404, 410), the owner turned alerts off, or a newer one took its place. Its waiting pushes go too. The caller holds the lock.
func (s *Store) drop(id, why string, now int64) error {
	if _, err := s.db.Exec("UPDATE subs SET dead_at = ?, dead_why = ? WHERE id = ? AND dead_at IS NULL", now, why, id); err != nil {
		return err
	}
	_, err := s.db.Exec("UPDATE queue SET state = 'gone', done_at = ? WHERE sub_id = ? AND state = 'waiting'", now, id)
	return err
}

// Drop is `drop` for the sender, which ends a subscription it found dead.
func (s *Store) Drop(id, why string, now int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.drop(id, why, now)
}

func (s *Store) idsWhere(where string, args ...any) ([]string, error) {
	rows, err := s.db.Query("SELECT id FROM subs WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// DropRef: the owner removed a phone: every subscription made from it ends, and its waiting pushes go. Returns how many.
func (s *Store) DropRef(ref string, now int64) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids, err := s.idsWhere("ref = ? AND dead_at IS NULL", ref)
	for _, id := range ids {
		if err == nil {
			err = s.drop(id, "phone_removed", now)
		}
	}
	return len(ids), err
}

// OwnerSub is one of the owner's live alert subscriptions, for the owner's phones page: which phone it came from, and when.
type OwnerSub struct {
	ID, Ref string
	MadeAt  int64
}

// OwnerSubs lists the owner's live alert subscriptions.
func (s *Store) OwnerSubs() ([]OwnerSub, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query("SELECT id, ref, made_at FROM subs WHERE who = 'owner' AND dead_at IS NULL ORDER BY made_at")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OwnerSub
	for rows.Next() {
		var o OwnerSub
		var ref sql.NullString
		if err := rows.Scan(&o.ID, &ref, &o.MadeAt); err != nil {
			return nil, err
		}
		o.Ref = ref.String
		out = append(out, o)
	}
	return out, rows.Err()
}

// DropOwnerSub: the owner stops one alert subscription from their phones page. True when it was theirs and live.
func (s *Store) DropOwnerSub(id string, now int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids, err := s.idsWhere("id = ? AND who = 'owner' AND dead_at IS NULL", id)
	if err != nil || len(ids) == 0 {
		return false, err
	}
	return true, s.drop(ids[0], "owner_stopped", now)
}

// DropUnbound: the shop was locked by the owner's first passkey, so every owner subscription made before it, or from a link, has no phone to answer to and ends. Returns how many.
func (s *Store) DropUnbound(now int64) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids, err := s.idsWhere("who = 'owner' AND ref IS NULL AND dead_at IS NULL")
	for _, id := range ids {
		if err == nil {
			err = s.drop(id, "lock", now)
		}
	}
	return len(ids), err
}

// Forget is W2's "delete my chat" (store.ts forget): every live phone of `who` ends with the reason "forgotten" and its waiting pushes go (the same end as an unsubscribe).
// Returns how many.
func (s *Store) Forget(who string, now int64) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.live(who)
	if err != nil {
		return 0, err
	}
	for _, r := range rows {
		if err := s.drop(r.id, "forgotten", now); err != nil {
			return 0, err
		}
	}
	return len(rows), nil
}

// Phones is how many phones get `who`'s alerts now.
func (s *Store) Phones(who string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var n int
	err := s.db.QueryRow("SELECT count(*) FROM subs WHERE who = ? AND dead_at IS NULL", who).Scan(&n)
	return n, err
}

// Choice is the owner's choice now; "whatsapp" until the owner picks.
func (s *Store) Choice() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var v string
	err := s.db.QueryRow("SELECT value FROM meta WHERE name = 'owner_choice'").Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "whatsapp", nil
	}
	for _, c := range OwnerChoices {
		if c == v {
			return v, err
		}
	}
	return "whatsapp", err
}

// SetChoice keeps the owner's choice.
func (s *Store) SetChoice(c string) error {
	ok := false
	for _, x := range OwnerChoices {
		ok = ok || x == c
	}
	if !ok {
		return errors.New("The owner's choice is one of " + strings.Join(OwnerChoices, ", ") + ".")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec("INSERT INTO meta (name, value) VALUES ('owner_choice', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", c)
	return err
}

// Enqueue queues one alert for every live phone of `who`. Nothing is queued for nobody: it returns the queued ids (none when no phone allowed alerts).
func (s *Store) Enqueue(who, kind, title, body, tag string, now int64) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	subs, err := s.live(who)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, sub := range subs {
		id := newID()
		if _, err := s.db.Exec("INSERT INTO queue (id, sub_id, kind, title, body, tag, made_at, next_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting')", id, sub.id, kind, title, body, tag, now, now); err != nil {
			return ids, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// Due is the pushes due now, oldest first (a push waiting too long is given up first).
func (s *Store) Due(now int64, limit int) ([]Waiting, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.db.Exec("UPDATE queue SET state = 'failed', done_at = ? WHERE state = 'waiting' AND made_at < ?", now, now-MaxWaitMs); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`SELECT q.id, q.kind, q.title, q.body, q.tag, q.made_at, q.tries, s.id, s.who, s.host, s.path, s.p256dh, s.auth, s.signer
        FROM queue q JOIN subs s ON s.id = q.sub_id WHERE q.state = 'waiting' AND q.next_at <= ? AND s.dead_at IS NULL ORDER BY q.made_at LIMIT ?`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Waiting
	for rows.Next() {
		var w Waiting
		var r subRow
		if err := rows.Scan(&w.ID, &w.Kind, &w.Title, &w.Body, &w.Tag, &w.MadeAt, &w.Tries, &r.id, &r.who, &r.host, &r.path, &r.p256dh, &r.auth, &r.signer); err != nil {
			return nil, err
		}
		w.Sub = r.sub()
		out = append(out, w)
	}
	return out, rows.Err()
}

// Settle records what came of one try: "sent", "gone" (the subscription too), "refused" (the Guard's rules or its daily count: not tried again), "failed", or "later".
func (s *Store) Settle(id, outcome string, now int64, status int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var st any
	if status != 0 {
		st = status
	}
	if outcome == "later" {
		var tries int
		_ = s.db.QueryRow("SELECT tries FROM queue WHERE id = ?", id).Scan(&tries)
		tries++
		if tries >= MaxTries {
			_, err := s.db.Exec("UPDATE queue SET state = 'failed', tries = ?, done_at = ?, status = ? WHERE id = ?", tries, now, st, id)
			return err
		}
		// 30 s, 1 min, 2 min, 4 min ...: a push service down for a few minutes still gets the alert
		_, err := s.db.Exec("UPDATE queue SET tries = ?, next_at = ?, status = ? WHERE id = ?", tries, now+30_000*(int64(1)<<(tries-1)), st, id)
		return err
	}
	_, err := s.db.Exec("UPDATE queue SET state = ?, done_at = ?, status = ?, tries = tries + 1 WHERE id = ?", outcome, now, st, id)
	return err
}

// Tidy: old rows go: done pushes after a week, dead subscriptions after 30 days.
func (s *Store) Tidy(now int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.db.Exec("DELETE FROM queue WHERE state != 'waiting' AND done_at < ?", now-7*24*60*60_000); err != nil {
		return err
	}
	_, err := s.db.Exec("DELETE FROM subs WHERE dead_at IS NOT NULL AND dead_at < ? AND id NOT IN (SELECT sub_id FROM queue)", now-30*24*60*60_000)
	return err
}
