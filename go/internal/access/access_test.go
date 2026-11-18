package access

// Unit tests of the owner-access rules that need no browser: the pure readers (Date.parse, a code as typed, a phone's label), the file's schema and its migrations, and the
// gate's rules driven with passkey and session rows written straight into the store (as the security reviewer's proof scripts did). The WebAuthn ceremonies, the routes and
// the two runtimes on one folder are the contract's (templates/commerce/listings/contract/owner-control.contract.test.ts), which drives both runtimes over HTTP.

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	tHour  = int64(60 * 60_000)
	tDay   = 24 * tHour
	numA   = "+919800000001"
	numB   = "+919822222222"
	tBase  = "https://pages.example/glow/owner"
	tRpID  = "pages.example"
	setupQ = "QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ" // 43 characters, a setup token's shape
)

var t0 = time.Date(2026, 11, 19, 4, 0, 0, 0, time.UTC).UnixMilli()

func iso(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

func open(t *testing.T) *Access {
	t.Helper()
	a, err := Open(filepath.Join(t.TempDir(), OwnerAccessFile))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	return a
}

// grants is a file as the panel writes it, read as the runtime reads it.
func grants(t *testing.T, json string) *Grants {
	t.Helper()
	g := readOwnerGrants([]byte(json), true)
	if g == nil {
		t.Fatalf("the file did not read: %s", json)
	}
	return g
}

func qrFile(token string, at int64, extra string) string {
	return `{"schema":1,"setup":{"sha256":"` + SetupHash(token) + `","createdAt":"` + iso(at) + `","expiresAt":"` + iso(at+SetupMs) + `"}` + extra + `}`
}

// phone writes a passkey made at `at` for `number`, and a session it made, straight into the store (the ceremony is the contract's to test).
func phone(t *testing.T, a *Access, id string, at int64, number string) {
	t.Helper()
	if _, err := a.db.Exec("INSERT INTO passkeys (id, cred_id, jwk, alg, sign_count, backed_up, made_at, owner_key, rp_id, via) VALUES (?, ?, '{}', -7, 0, 0, ?, ?, ?, 'setup')", id, "c"+id, at, OwnerKey(number), tRpID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("INSERT INTO sessions (id, hash, made_at, expires_at, owner_key, base, link_id) VALUES (?, ?, ?, ?, ?, ?, ?)", "s"+id, "h"+id, at, at+SessionMs, OwnerKey(number), tBase, "pk-"+id); err != nil {
		t.Fatal(err)
	}
	// the first passkey of the lock binds the shop, as Register does
	if _, bound := boundKey(a.db); !bound {
		_ = setMeta(a.db, "bound_owner", OwnerKey(number))
		_ = setMeta(a.db, "bound_number", digits(number))
	}
}

func state(t *testing.T, a *Access, g Grant, file *Grants, now int64) string {
	t.Helper()
	s, err := a.GrantState(g, file, now)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func pending(t *testing.T, a *Access, file *Grants, now int64) *Removal {
	t.Helper()
	r, err := a.PendingRemoval(file, now)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestParseJSDateReadsWhatV8Reads(t *testing.T) {
	// each value is what Node 26's Date.parse gave for the same text (the date-only and Z forms do not depend on the zone)
	for text, want := range map[string]int64{
		"2026-11-19T04:00:00.000Z": 1795060800000, "2026-11-19": 1795046400000, "2026-11": 1793491200000, "2026": 1767225600000,
		"2026-02-30": 1772409600000, "2026-11-19T04:00Z": 1795060800000, "2026-11-19T04:00:00.123456Z": 1795060800123, "2026-11-19T04:00:00.1Z": 1795060800100,
		"2026-11-19T24:00:00Z": 1795132800000, "2026-11-19t04:00:00z": 1795060800000, "2026-11-19 04:00:00Z": 1795060800000, "+002026-11-19T04:00:00Z": 1795060800000,
		"2026-11-19T04:00:00+05:30": 1795041000000, "2026-11-19T04:00:00+0530": 1795041000000, "2026-11-31T00:00:00Z": 1796083200000,
	} {
		if got, ok := ParseJSDate(text); !ok || got != want {
			t.Errorf("%q: %d %v, want %d", text, got, ok, want)
		}
	}
	for _, text := range []string{"2026-11-19T24:00:01Z", "2026-13-01", "2026-11-19T04:60:00Z", "2026-11-19T04:00:00.Z", "2026-11-19T4:00:00Z", "-000000-01-01T00:00:00Z", "+999999-01-01T00:00:00Z", "", "soon"} {
		if got, ok := ParseJSDate(text); ok {
			t.Errorf("%q read as %d; Date.parse says NaN", text, got)
		}
	}
	// a date and a time with no offset is the machine's local time, as in JavaScript
	was := time.Local
	time.Local = time.FixedZone("IST", 5*3600+1800)
	defer func() { time.Local = was }()
	if got, _ := ParseJSDate("2026-11-19T04:00:00"); got != 1795041000000 {
		t.Errorf("local time: %d", got)
	}
}

func TestACodeReadsHoweverItIsTyped(t *testing.T) {
	for typed, want := range map[string]string{
		"abcde-fghjk":            "ABCDEFGHJK",
		" abcde  fghjk ":         "ABCDEFGHJK",
		"ＡＢＣＤＥ－ＦＧＨＪＫ":            "ABCDEFGHJK", // full-width letters and the full-width hyphen fold by NFKC, and the dash is then dropped
		"ßßßßß":                  "SSSSSSSSSS", // JavaScript's toUpperCase is the full mapping: ß is SS
		"ABCDE\ufeffFGHJK":       "ABCDEFGHJK", // the byte-order mark is in JavaScript's \s
		"ABCDE\u0085FGHJK":       "ABCDE\u0085FGHJK",
		"abc\u2003de\u3000fghjk": "ABCDEFGHJK",
	} {
		if got := normalCode(typed); got != want {
			t.Errorf("%q: %q, want %q", typed, got, want)
		}
	}
	if !RecoveryShape("23456-789ab") || RecoveryShape("01234-56789") {
		t.Error("the code letters have no look-alikes (no 0, 1)")
	}
	if RecoveryHash("abcde-fghjk") != RecoveryHash("ABCDEFGHJK") {
		t.Error("a code's hash is the hash of its one form")
	}
}

func TestPhoneLabelIsPlatformAndBrowserOnly(t *testing.T) {
	for ua, want := range map[string]string{
		"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36":                   "Android, Chrome",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1": "iPhone, Safari",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0":                                       "Windows, Edge",
		"Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0":                                                                    "Android, Firefox",
		"curl/8": "",
	} {
		if got := PhoneLabel(ua); got != want {
			t.Errorf("%q: %q, want %q", ua, got, want)
		}
	}
	if PhoneLabel(nil) != "" || PhoneLabel(42) != "" {
		t.Error("no User-Agent: no label")
	}
}

func TestTheSchemaIsTheTypeScriptOnesAndAnOldFileIsMigrated(t *testing.T) {
	a := open(t)
	cols := func(table string) string {
		rows, err := a.db.Query("SELECT name FROM pragma_table_info(?)", table)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var names []string
		for rows.Next() {
			var n string
			_ = rows.Scan(&n)
			names = append(names, n)
		}
		return strings.Join(names, ",")
	}
	// label and extended come by ALTER (they are not in the CREATE text), as in TypeScript; told and by_passkey are in the CREATE text of a new file
	for table, want := range map[string]string{
		"passkeys":  "id,cred_id,jwk,alg,sign_count,backed_up,made_at,used_at,removed_at,removed_why,owner_key,rp_id,via,label",
		"removals":  "asked_at,asked_by,seen_at,effective_at,state,at,told,extended",
		"own_codes": "hash,made_at,voided_at,by_passkey",
	} {
		if got := cols(table); got != want {
			t.Errorf("%s: %s, want %s", table, got, want)
		}
	}
	var text string
	_ = a.db.QueryRow("SELECT sql FROM sqlite_master WHERE name = 'removals'").Scan(&text)
	if !strings.Contains(text, "-- 1 once the owner's phones were told") {
		t.Error("the comment inside the removals CREATE is part of its stored text, as TypeScript's is")
	}
	// a file from before the phones list: no label column, a row in it
	dir := t.TempDir()
	db, _ := sql.Open("sqlite", "file:"+filepath.Join(dir, OwnerAccessFile))
	_, _ = db.Exec(`CREATE TABLE passkeys (id TEXT PRIMARY KEY, cred_id TEXT NOT NULL UNIQUE, jwk TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL, backed_up INTEGER NOT NULL,
      made_at INTEGER NOT NULL, used_at INTEGER, removed_at INTEGER, removed_why TEXT, owner_key TEXT NOT NULL, rp_id TEXT NOT NULL, via TEXT NOT NULL);
      CREATE TABLE removals (asked_at TEXT PRIMARY KEY, asked_by TEXT NOT NULL, seen_at INTEGER NOT NULL, effective_at INTEGER NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL);
      INSERT INTO passkeys VALUES ('old1', 'cred', '{}', -7, 0, 0, 1000, NULL, NULL, NULL, 'k', 'pages.example', 'setup');
      INSERT INTO removals VALUES ('x', 'Divya', 1, 2, 'pending', 1);`)
	db.Close()
	b, err := Open(filepath.Join(dir, OwnerAccessFile))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	var label sql.NullString
	var told, extended int
	_ = b.db.QueryRow("SELECT label FROM passkeys WHERE id = 'old1'").Scan(&label)
	_ = b.db.QueryRow("SELECT told, extended FROM removals WHERE asked_at = 'x'").Scan(&told, &extended)
	if label.Valid || told != 1 || extended != 0 {
		t.Errorf("an old row: label %v (none), told %d (1: old requests count as told), extended %d", label, told, extended)
	}
}

func TestAfterTheFirstPasskeyTheOperatorsNewQRAndCardAreRefused(t *testing.T) {
	a := open(t)
	card := "23456789AB"
	f0 := grants(t, qrFile(setupQ, t0, `,"recovery":{"codes":["`+RecoveryHash(card)+`"],"createdAt":"`+iso(t0)+`"}`))
	if s := state(t, a, Grant{Kind: "recovery", Code: card}, f0, t0); s != "valid" {
		t.Fatalf("the card before the lock: %s", s)
	}
	phone(t, a, "p1", t0+1000, numA)
	late := strings.Repeat("L", 43)
	card2 := "CDEFGHJKMN"
	f1 := grants(t, qrFile(late, t0-tHour, `,"recovery":{"codes":["`+RecoveryHash(card)+`","`+RecoveryHash(card2)+`"],"createdAt":"`+iso(t0-tHour)+`"}`))
	if s := state(t, a, Grant{Kind: "setup", Token: late}, f1, t0+2000); s != "unknown" {
		t.Errorf("a QR first seen after the lock (back-dated in the file): %s", s)
	}
	if s := state(t, a, Grant{Kind: "recovery", Code: card2}, f1, t0+2000); s != "unknown" {
		t.Errorf("a card code first seen after the lock: %s", s)
	}
	if s := state(t, a, Grant{Kind: "recovery", Code: card}, f1, t0+2000); s != "valid" {
		t.Errorf("the card seen before the lock: %s", s)
	}
	// a passkeysBefore written into the file after the lock is not taken (the store adopted the file's once, before)
	pb, _ := a.PasskeysBefore(grants(t, `{"schema":1,"passkeysBefore":"`+iso(t0+3000)+`"}`), t0+4000)
	if pb != nil {
		t.Errorf("passkeysBefore after the lock: %d", *pb)
	}
}

func TestFileTimesAreClampedAtFirstSight(t *testing.T) {
	a := open(t)
	// a QR dated 2099 works 15 minutes from first sight
	far := strings.Repeat("F", 43)
	f := grants(t, `{"schema":1,"setup":{"sha256":"`+SetupHash(far)+`","createdAt":"`+iso(t0)+`","expiresAt":"2099-01-01T00:00:00Z"}}`)
	if s := state(t, a, Grant{Kind: "setup", Token: far}, f, t0); s != "valid" {
		t.Fatal(s)
	}
	if s := state(t, a, Grant{Kind: "setup", Token: far}, f, t0+SetupMs); s != "expired" {
		t.Errorf("15 minutes after first sight: %s", s)
	}
	// a sign-out dated 2099 is clamped to the moment it is first seen
	raw := int64(4070908800000)
	if got := a.ClampEndBefore(&raw, t0); got == nil || *got != t0 {
		t.Errorf("sign-out 2099: %v", got)
	}
	// a reset dated 2099 is applied as of now, and a later real reset still applies (its QR works)
	b := open(t)
	phone(t, b, "p1", t0, numA)
	_ = b.Sync(grants(t, `{"schema":1}`), t0+1000)
	forged := &Grants{Reset: readOwnerReset([]byte(`{"schema":1,"at":"2099-01-01T00:00:00Z","reason":"x","by":"y"}`), true)}
	if err := b.Sync(forged, t0+2000); err != nil {
		t.Fatal(err)
	}
	if at, _ := metaNum(b.db, "reset_at"); at != t0+2000 {
		t.Errorf("the forged reset is clamped to now: %d", at)
	}
	rq := strings.Repeat("R", 43)
	actual := &Grants{Reset: readOwnerReset([]byte(`{"schema":1,"at":"`+iso(t0+tDay)+`","reason":"real","by":"Geometer","setup":{"sha256":"`+SetupHash(rq)+`","expiresAt":"`+iso(t0+tDay+tHour)+`"}}`), true)}
	if s := state(t, b, Grant{Kind: "setup", Token: rq}, actual, t0+tDay+1000); s != "valid" {
		t.Errorf("the real reset's QR after a forged one: %s", s)
	}
}

func TestARequestIsTimedFromFirstSightCancelledAndQuietForADay(t *testing.T) {
	a := open(t)
	phone(t, a, "p1", t0, numA)
	ask := func(at int64) *Grants {
		return grants(t, `{"schema":1,"pendingRemoval":{"askedBy":"Divya","askedAt":"`+iso(at)+`","effectiveAt":"`+iso(at+RemovalWaitMs)+`"}}`)
	}
	back := ask(t0 - 10*tDay)
	r := pending(t, a, back, t0+tHour)
	if r == nil || r.EffectiveAt != t0+tHour+RemovalWaitMs || r.Kind != "removal" {
		t.Fatalf("a back-dated request: %+v", r)
	}
	if ok, _ := a.CancelRemoval(back, t0+2*tHour); !ok {
		t.Fatal("the owner cancels")
	}
	if pending(t, a, back, t0+5*tDay) != nil {
		t.Error("the same request is not heard again")
	}
	// a new one right after a cancel waits a day's quiet
	b := open(t)
	phone(t, b, "p1", t0, numA)
	pending(t, b, ask(t0+tHour), t0+tHour)
	_, _ = b.CancelRemoval(nil, t0+2*tHour)
	if pending(t, b, ask(t0+3*tHour), t0+3*tHour) != nil {
		t.Error("within a day of the cancel")
	}
	if r := pending(t, b, ask(t0+3*tHour), t0+2*tHour+tDay+1); r == nil || r.EffectiveAt != t0+2*tHour+tDay+1+RemovalWaitMs {
		t.Errorf("after the quiet: %+v", r)
	}
	// nobody cancels: it applies, the phone and its session stop, the gate opens
	c := open(t)
	phone(t, c, "p1", t0, numA)
	pending(t, c, ask(t0+tHour), t0+tHour)
	locked, _ := c.Locked(ask(t0+tHour), t0+tHour+RemovalWaitMs)
	if locked {
		t.Error("applied after 48 hours: the shop is open")
	}
	var ended sql.NullString
	_ = c.db.QueryRow("SELECT ended_why FROM sessions WHERE id = 'sp1'").Scan(&ended)
	if ended.String != "removal" {
		t.Errorf("the phone's session ended by the removal: %v", ended)
	}
}

func TestARestartExtendsARequestOnce(t *testing.T) {
	a := open(t)
	phone(t, a, "p1", t0, numA)
	f := grants(t, `{"schema":1,"pendingRemoval":{"askedBy":"Op","askedAt":"`+iso(t0+tHour)+`","effectiveAt":"`+iso(t0+49*tHour)+`"}}`)
	pending(t, a, f, t0+tHour)
	now := t0 + tHour
	for i := 0; i < 5; i++ { // a restart every 23 hours
		now += 23 * tHour
		if err := a.NoteStart(now); err != nil {
			t.Fatal(err)
		}
		_ = a.Sync(f, now)
	}
	if r := pending(t, a, f, now); r != nil {
		t.Errorf("restarted every 23 hours for five days, the request still waits: %+v", r)
	}
	notes, _ := a.TakeNotes()
	for _, n := range notes {
		if n.Key != "" {
			t.Errorf("an applied request is told no more: %+v", n)
		}
	}
}

func TestAChangedNumberAfterTheLockIsARequestAndTheSaleBindsTheNewOwner(t *testing.T) {
	a := open(t)
	phone(t, a, "p1", t0, numA)
	if n, _ := a.EffectiveNumber(numB); n != numA {
		t.Errorf("while locked the shop talks to the locked number: %s", n)
	}
	if err := a.WatchOwner(Who{numB, tBase}, t0+tHour); err != nil {
		t.Fatal(err)
	}
	r := pending(t, a, nil, t0+tHour)
	if r == nil || r.Kind != "owner_change" || r.AskedBy != "the owner number" {
		t.Fatalf("the change is a request: %+v", r)
	}
	if !a.NumberDiffers(Who{numB, tBase}) {
		t.Error("the settings name another number")
	}
	// it applies with no restart: the gate opens and the number follows the settings
	if locked, _ := a.Locked(nil, t0+tHour+RemovalWaitMs); locked {
		t.Error("applied")
	}
	if n, _ := a.EffectiveNumber(numB); n != numB {
		t.Errorf("after the change the shop talks to the settings' number: %s", n)
	}
	phone(t, a, "p2", t0+tHour+RemovalWaitMs+1000, numB)
	if n, ok := a.BoundNumber(); !ok || n != digits(numB) {
		t.Errorf("the new owner's phone binds the shop to the new number: %s", n)
	}
}

func TestOwnCodesAndRemovingAPhone(t *testing.T) {
	a := open(t)
	card := "23456789AB"
	f := grants(t, qrFile(setupQ, t0, `,"recovery":{"codes":["`+RecoveryHash(card)+`"],"createdAt":"`+iso(t0)+`"}`))
	_ = a.Sync(f, t0)
	phone(t, a, "p1", t0+1000, numA)
	phone(t, a, "p9", t0+2000, numA)
	own, err := a.MakeOwnCodes("sp1", f, t0+3000)
	if err != nil || len(own) != RecoveryCodes {
		t.Fatal(own, err)
	}
	if s := state(t, a, Grant{Kind: "recovery", Code: card}, f, t0+3500); s != "unknown" {
		t.Errorf("the card after the owner's own codes: %s", s)
	}
	intruder, _ := a.MakeOwnCodes("sp9", f, t0+4000)
	link, _, ok, _ := a.AddPhone("sp9", f, t0+4500)
	if !ok {
		t.Fatal("add a phone")
	}
	if s := state(t, a, Grant{Kind: "recovery", Code: own[0]}, f, t0+5000); s != "valid" {
		t.Errorf("the owner's set after another phone made its own: %s", s)
	}
	rp := RelyingParty{RpID: tRpID, Origin: "https://pages.example"}
	who := Who{numA, tBase}
	if _, _, why, _ := a.RemovePhone("sp1", "p9", who, rp, f, t0+6000, false); why != "" {
		t.Fatalf("remove p9: %s", why)
	}
	if s := state(t, a, Grant{Kind: "recovery", Code: intruder[0]}, f, t0+7000); s != "unknown" {
		t.Errorf("the removed phone's codes: %s", s)
	}
	if s := state(t, a, Grant{Kind: "setup", Token: link}, f, t0+7000); s != "unknown" {
		t.Errorf("the removed phone's link: %s", s)
	}
	if _, _, why, _ := a.RemovePhone("sp1", "p1", who, rp, f, t0+8000, false); why != "last" {
		t.Errorf("the last phone needs the second confirm: %q", why)
	}
	view, _ := a.PhonesView("sp1", who, rp, f, t0+9000)
	if len(view.Phones) != 1 || !view.Phones[0].Mine || view.LockedLast4 != "0001" {
		t.Errorf("the phones page: %+v", view)
	}
}

func TestDismissTakesTheMomentTheBannerShowed(t *testing.T) {
	a := open(t)
	phone(t, a, "p1", t0, numA)
	phone(t, a, "p2", t0+1000, numA)
	rp := RelyingParty{RpID: tRpID, Origin: "https://pages.example"}
	v, _ := a.PhonesView("sp1", Who{numA, tBase}, rp, nil, t0+2000)
	if len(v.Announce) != 1 || v.SeenThrough != t0+1000 {
		t.Fatalf("p2 is news for p1: %+v", v)
	}
	phone(t, a, "p3", t0+3000, numA)
	through := float64(v.SeenThrough) + 0.5 // the page posts a JSON number
	if err := a.Dismiss("sp1", t0+4000, &through); err != nil {
		t.Fatal(err)
	}
	v, _ = a.PhonesView("sp1", Who{numA, tBase}, rp, nil, t0+5000)
	if len(v.Announce) != 1 || v.Announce[0].ID != "p3" {
		t.Errorf("a phone added after the banner showed is still news: %+v", v.Announce)
	}
}
