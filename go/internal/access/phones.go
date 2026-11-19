package access

// "Phones that can open your shop": the owner's own view and control (owner-access.ts phonesView, dismiss, removePhone, makeOwnCodes, addPhone; owner-phones.ts phoneLabel).
// Every call names a session the caller has already checked. What only a PASSKEY session may do (remove a phone, make codes, add a phone) is refused here for a session made
// by a link too, because a WhatsApp link is whoever holds that phone.

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"github.com/GeometerLabs/agents/go/internal/language"
	"math/big"
	"regexp"
	"strings"
)

// ---- the coarse label of a phone ----------------------------------------------------------------------------------------------------------------------------

var (
	edge    = regexp.MustCompile(`EdgA?/|Edg/`)
	opera   = regexp.MustCompile(`OPR/|Opera`)
	firefox = regexp.MustCompile(`FxiOS|Firefox/`)
	chrome  = regexp.MustCompile(`CriOS|Chrome/`)
	mac     = regexp.MustCompile(`Macintosh|Mac OS X`)
	linux   = regexp.MustCompile(`Linux|X11`)
)

// PhoneLabel is owner-phones.ts phoneLabel: a coarse label from a browser's User-Agent, like "Android, Chrome": the platform and the browser, nothing finer (no model, no
// version, no address), because the label only has to help an owner tell their own phones apart and spot one that is not theirs. Unknown parts are left out; with neither the
// label is "" and the page says "a phone". The User-Agent itself is never kept.
func PhoneLabel(userAgent any) string {
	ua, _ := userAgent.(string)
	ua = language.UTF16SliceFFFD(ua, 400)
	// order matters: an iPad or iPhone UA also says "Mac OS X"; an Android UA also says "Linux"
	platform := ""
	switch {
	case strings.Contains(ua, "iPhone"):
		platform = "iPhone"
	case strings.Contains(ua, "iPad"):
		platform = "iPad"
	case strings.Contains(ua, "Android"):
		platform = "Android"
	case strings.Contains(ua, "CrOS"):
		platform = "Chromebook"
	case strings.Contains(ua, "Windows"):
		platform = "Windows"
	case mac.MatchString(ua):
		platform = "Mac"
	case linux.MatchString(ua):
		platform = "Linux"
	}
	// order matters again: Edge, Opera and Samsung's browser all say "Chrome"; Chrome says "Safari"; iOS Chrome and Firefox say CriOS and FxiOS
	browser := ""
	switch {
	case edge.MatchString(ua):
		browser = "Edge"
	case opera.MatchString(ua):
		browser = "Opera"
	case strings.Contains(ua, "SamsungBrowser"):
		browser = "Samsung Internet"
	case firefox.MatchString(ua):
		browser = "Firefox"
	case chrome.MatchString(ua):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	var parts []string
	for _, p := range []string{platform, browser} {
		if p != "" {
			parts = append(parts, p)
		}
	}
	return strings.Join(parts, ", ")
}

// ---- who a session is ---------------------------------------------------------------------------------------------------------------------------------------

// subject is a session's subject for the "new phone" banner, and the passkey it was made by (if any).
type subject struct {
	subject string
	passkey string // "" for a session made by a link
	madeAt  int64
	via     string
}

func subjectOf(q execer, sessionID string) (subject, bool) {
	var linkID string
	var madeAt int64
	if !found(q.QueryRow("SELECT link_id, made_at FROM sessions WHERE id = ?", sessionID).Scan(&linkID, &madeAt)) {
		return subject{}, false
	}
	if strings.HasPrefix(linkID, "pk-") {
		var pkMade int64
		var via string
		if found(q.QueryRow("SELECT made_at, via FROM passkeys WHERE id = ?", linkID[3:]).Scan(&pkMade, &via)) {
			return subject{subject: "pk:" + linkID[3:], passkey: linkID[3:], madeAt: pkMade, via: via}, true
		}
	}
	return subject{subject: "s:" + sessionID, madeAt: madeAt}, true
}

// PasskeyOfSession is the passkey id a session was made by, or "" for a session made by a link.
func (a *Access) PasskeyOfSession(sessionID string) string {
	me, _ := subjectOf(a.db, sessionID)
	return me.passkey
}

// ---- the phones page ------------------------------------------------------------------------------------------------------------------------------------

// Phone is one phone as the owner's page lists it. Times are milliseconds.
type Phone struct {
	ID     string `json:"id"`
	MadeAt int64  `json:"madeAt"`
	UsedAt *int64 `json:"usedAt,omitempty"`
	Via    string `json:"via"`
	Label  string `json:"label,omitempty"`
}

// MyPhone is a phone with "this phone" marked.
type MyPhone struct {
	Phone
	Mine bool `json:"mine"`
}

// News is codes made or a phone removed by ANOTHER phone since this phone last dismissed the news.
type News struct {
	Kind  string `json:"kind"`
	At    int64  `json:"at"`
	Label string `json:"label,omitempty"`
}

// PhonesView is what the owner's phones page and the banners need (owner-access.ts PhonesView).
type PhonesView struct {
	Phones []MyPhone `json:"phones"`
	// Announce: phones made since this phone last dismissed the news (never this phone itself)
	Announce []Phone `json:"announce"`
	News     []News  `json:"news"`
	// SeenThrough: the moment the banner reaches, for "It was me" to dismiss exactly that much
	SeenThrough    int64    `json:"seenThrough"`
	Removal        *Removal `json:"removal,omitempty"`
	OwnCodesAt     *int64   `json:"ownCodesAt,omitempty"`
	PasskeySession bool     `json:"passkeySession"`
	// LockedLast4: the last 4 digits of the number the shop is locked with, so the owner can catch a wrong one; absent while not locked or the digits are unknown
	LockedLast4 string `json:"lockedLast4,omitempty"`
}

func phoneOf(r passkeyRow) Phone {
	p := Phone{ID: r.ID, MadeAt: r.MadeAt, Via: r.Via}
	if r.UsedAt.Valid {
		u := r.UsedAt.Int64
		p.UsedAt = &u
	}
	if r.Label.Valid {
		p.Label = r.Label.String
	}
	return p
}

// PhonesView is each phone (this one marked), the phones made since this phone last dismissed the news, the news from other phones, the Operator's request if one waits,
// whether the owner holds their own codes, and the locked number's last 4 digits. nil when the session is unknown.
func (a *Access) PhonesView(sessionID string, who Who, rp RelyingParty, file *Grants, now int64) (*PhonesView, error) {
	if err := a.reconcile(file, now); err != nil {
		return nil, err
	}
	q := a.db
	me, ok := subjectOf(q, sessionID)
	if !ok {
		return nil, nil
	}
	var pb *int64
	if v, ok := metaNum(q, "passkeys_before"); ok {
		pb = &v
	}
	phones, err := a.goodPhones(who, rp, pb)
	if err != nil {
		return nil, err
	}
	// What this phone has been told. A phone the OWNER added themselves (from their own phone, or with their own code) starts from its own birth. Any other phone (the
	// Operator's QR, the card, a reset) starts from 0 and so sees every other phone once: an Operator's phone made before the owner's must not sit unannounced.
	fresh := me.madeAt
	if me.passkey != "" && me.via != "own_phone" && me.via != "own_code" {
		fresh = 0
	}
	// `through` may be a fraction (the page posts a JSON number), so it is read and compared as SQLite and JavaScript do: a number, not an integer
	through := float64(fresh)
	var seen sql.NullFloat64
	if found(q.QueryRow("SELECT through FROM phone_seen WHERE subject = ?", me.subject).Scan(&seen)) && seen.Valid {
		through = seen.Float64
	}
	byMe := me.passkey
	if byMe == "" {
		byMe = me.subject
	}
	rows, err := q.Query("SELECT kind, at, label, by_id FROM news WHERE at > ? ORDER BY at", through)
	if err != nil {
		return nil, err
	}
	news := []News{}
	var newsAts []int64
	for rows.Next() {
		var n News
		var label, by sql.NullString
		if err := rows.Scan(&n.Kind, &n.At, &label, &by); err != nil {
			rows.Close()
			return nil, err
		}
		if by.Valid && by.String == byMe { // the phone that did it is not told
			continue
		}
		n.Label = label.String
		news = append(news, n)
		newsAts = append(newsAts, n.At)
	}
	rows.Close()
	removal, err := a.PendingRemoval(file, now)
	if err != nil {
		return nil, err
	}
	var codesAt sql.NullInt64
	must(q.QueryRow("SELECT max(made_at) AS at FROM own_codes WHERE voided_at IS NULL").Scan(&codesAt))
	v := &PhonesView{Phones: []MyPhone{}, Announce: []Phone{}, News: news, Removal: removal, PasskeySession: me.passkey != ""}
	var seenThrough int64
	for _, r := range phones {
		v.Phones = append(v.Phones, MyPhone{Phone: phoneOf(r), Mine: r.ID == me.passkey})
		if float64(r.MadeAt) > through && r.ID != me.passkey {
			v.Announce = append(v.Announce, phoneOf(r))
			seenThrough = max(seenThrough, r.MadeAt)
		}
	}
	for _, at := range newsAts {
		seenThrough = max(seenThrough, at)
	}
	v.SeenThrough = seenThrough
	if codesAt.Valid {
		c := codesAt.Int64
		v.OwnCodesAt = &c
	}
	if n, ok := a.BoundNumber(); ok && n != "" {
		v.LockedLast4 = n[max(0, len(n)-4):]
	}
	return v, nil
}

// Dismiss: this phone has seen the news about every phone made so far, up to the moment the banner SHOWED (the page posts it), never up to "the newest phone now": one added
// between the page and the tap must still be announced. A phone made later brings the banner back.
func (a *Access) Dismiss(sessionID string, now int64, through *float64) error {
	q := a.db
	me, ok := subjectOf(q, sessionID)
	if !ok {
		return nil
	}
	var latest float64
	if through != nil {
		latest = min(*through, float64(now))
	} else {
		var pk, nw sql.NullInt64
		must(q.QueryRow("SELECT max(made_at) AS at FROM passkeys").Scan(&pk))
		must(q.QueryRow("SELECT max(at) AS at FROM news").Scan(&nw))
		latest = float64(min(now, max(pk.Int64, nw.Int64)))
	}
	// an integral moment is written as an integer, as JavaScript's number is bound (SQLite keeps 3 and 3.0 the same in an INTEGER column anyway)
	var value any = latest
	if latest == float64(int64(latest)) {
		value = int64(latest)
	}
	_, err := q.Exec("INSERT INTO phone_seen (subject, through) VALUES (?, ?) ON CONFLICT(subject) DO UPDATE SET through = max(through, excluded.through)", me.subject, value)
	return err
}

// Removed is the phone the owner removed.
type Removed struct {
	ID    string
	Label string
}

// RemovePhone: the owner removes one phone; it stops working at once, and so does every session it made, and what it made (its codes, its "add a phone" links). The LAST phone
// is refused (why "last") unless confirmLast (the page asks twice, in plain words, before it sends it). why "unknown": no such phone, or not a passkey session.
func (a *Access) RemovePhone(sessionID, phoneID string, who Who, rp RelyingParty, file *Grants, now int64, confirmLast bool) (removed Removed, wasLast bool, why string, err error) {
	if err := a.reconcile(file, now); err != nil {
		return removed, false, "", err
	}
	// only a PASSKEY session may take a phone away: a WhatsApp link is whoever holds that phone, and must not be able to strip every phone of the owner
	me, ok := subjectOf(a.db, sessionID)
	if !ok || me.passkey == "" {
		return removed, false, "unknown", nil
	}
	var pb *int64
	if v, ok := metaNum(a.db, "passkeys_before"); ok {
		pb = &v
	}
	phones, err := a.goodPhones(who, rp, pb)
	if err != nil {
		return removed, false, "", err
	}
	var target *passkeyRow
	for i := range phones {
		if phones[i].ID == phoneID {
			target = &phones[i]
		}
	}
	if target == nil {
		return removed, false, "unknown", nil
	}
	wasLast = len(phones) == 1
	if wasLast && !confirmLast {
		return removed, wasLast, "last", nil
	}
	var label any
	if target.Label.Valid {
		label = target.Label.String
	}
	err = a.tx(func(x execer) error {
		if _, err := x.Exec("UPDATE passkeys SET removed_at = ?, removed_why = 'owner' WHERE id = ? AND removed_at IS NULL", now, target.ID); err != nil {
			return err
		}
		if _, err := x.Exec("UPDATE sessions SET ended_at = ?, ended_why = 'phone_removed' WHERE link_id = ? AND ended_at IS NULL", now, "pk-"+target.ID); err != nil {
			return err
		}
		// what the removed phone made goes with it: its recovery codes and its "add a phone" links are a way back in that the owner never chose to keep. WHY the one
		// exception: a phone removing ITSELF as the last phone is the owner's own, twice-confirmed choice, and the confirm page promises "you can only get back in with your own
		// recovery codes" (owner-phones-page.ts lastAsk). Those codes were made by that same phone, so voiding them would leave the owner nothing. A phone removed by ANOTHER
		// phone is different (an intruder phone must not keep a way back), so its codes go; its "add a phone" links go in both cases (a link is a way in for whoever holds it).
		keepCodes := wasLast && target.ID == me.passkey
		if !keepCodes {
			if _, err := x.Exec("UPDATE own_codes SET voided_at = ? WHERE by_passkey = ? AND voided_at IS NULL", now, target.ID); err != nil {
				return err
			}
		}
		if _, err := x.Exec("UPDATE own_setups SET voided_at = ? WHERE by_passkey = ? AND voided_at IS NULL", now, target.ID); err != nil {
			return err
		}
		_, err := x.Exec("INSERT INTO news (at, kind, label, by_id) VALUES (?, 'removed', ?, ?)", now, label, me.passkey)
		return err
	})
	if err != nil {
		return removed, false, "", err
	}
	return Removed{ID: target.ID, Label: target.Label.String}, wasLast, "", nil
}

// newRecoveryCode is ten letters of the code alphabet (no look-alikes), each drawn uniformly: about 48 bits.
func newRecoveryCode() string {
	b := make([]byte, 10)
	n := big.NewInt(int64(len(recoveryLetters)))
	for i := range b {
		k, err := rand.Int(rand.Reader, n)
		if err != nil {
			panic(err) // the system's randomness failed: nothing safe can be made
		}
		b[i] = recoveryLetters[k.Int64()]
	}
	return string(b)
}

// MakeOwnCodes: the owner makes their OWN recovery codes, from a passkey session only (a link on WhatsApp is whoever holds the phone). Shown ONCE by the caller. Every QR and
// code hash the Operator's file has ever shown this store stops working (so a copy of the printed card the Operator kept is worth nothing), and so does this phone's earlier set;
// another phone's set stays (a phone that makes codes must not be able to void the owner's real ones, and removing it takes back its own). nil when not a passkey session.
func (a *Access) MakeOwnCodes(sessionID string, file *Grants, now int64) ([]string, error) {
	if err := a.reconcile(file, now); err != nil {
		return nil, err
	}
	me, ok := subjectOf(a.db, sessionID)
	if !ok || me.passkey == "" {
		return nil, nil
	}
	codes := make([]string, RecoveryCodes)
	for i := range codes {
		codes[i] = newRecoveryCode()
	}
	err := a.tx(func(x execer) error {
		if _, err := x.Exec("UPDATE own_codes SET voided_at = ? WHERE voided_at IS NULL AND by_passkey = ?", now, me.passkey); err != nil {
			return err
		}
		// EVERY QR and code hash the Operator's file has ever shown this store, whatever "kind" the file put it under: a card code's hash staged in the QR's slot would otherwise
		// survive the owner's own codes and come back later
		if _, err := x.Exec("UPDATE grants_seen SET voided_at = ? WHERE voided_at IS NULL", now); err != nil {
			return err
		}
		for _, c := range codes {
			if _, err := x.Exec("INSERT INTO own_codes (hash, made_at, by_passkey) VALUES (?, ?, ?)", RecoveryHash(c), now, me.passkey); err != nil {
				return err
			}
		}
		var label sql.NullString
		found(x.QueryRow("SELECT label FROM passkeys WHERE id = ?", me.passkey).Scan(&label))
		var l any
		if label.Valid {
			l = label.String
		}
		_, err := x.Exec("INSERT INTO news (at, kind, label, by_id) VALUES (?, 'codes', ?, ?)", now, l, me.passkey)
		return err
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// AddPhone: "add a phone", a one-use setup link made by the owner's own phone (a passkey session only), for SetupMs. The token is returned ONCE; the page shows it as a QR.
// ok false when not a passkey session.
func (a *Access) AddPhone(sessionID string, file *Grants, now int64) (token string, expiresAt int64, ok bool, err error) {
	if err := a.reconcile(file, now); err != nil {
		return "", 0, false, err
	}
	me, found := subjectOf(a.db, sessionID)
	if !found || me.passkey == "" {
		return "", 0, false, nil
	}
	if _, err := a.db.Exec("DELETE FROM own_setups WHERE expires_at < ?", now-day); err != nil {
		return "", 0, false, err
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token = base64.RawURLEncoding.EncodeToString(b)
	if _, err := a.db.Exec("INSERT INTO own_setups (hash, made_at, expires_at, by_passkey) VALUES (?, ?, ?, ?)", SetupHash(token), now, now+SetupMs, me.passkey); err != nil {
		return "", 0, false, err
	}
	return token, now + SetupMs, true, nil
}

// Passkeys are the owner's passkeys here, for their page and the counts (when each was made and last used). No key, no id the browser knows.
func (a *Access) Passkeys(who Who, rp RelyingParty, before *int64) ([]Phone, error) {
	rows, err := a.goodPhones(who, rp, before)
	if err != nil {
		return nil, err
	}
	out := []Phone{}
	for _, r := range rows {
		out = append(out, phoneOf(r))
	}
	return out, nil
}
