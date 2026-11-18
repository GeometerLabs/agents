// Package access is the owner's way in: the owner's link (a hash in the shop's folder), the sessions and passkeys the runtime keeps in its own file beside the store
// (owner-access.sqlite), the Operator's one-use setup code, recovery card and "remove the owner's passkeys" request, Geometer's reset, and the rules of who controls all of it.
// It is the Go twin of modules/channels (owner-link.ts, owner-grants.ts, pages-file.ts, owner-access.ts, owner-phones.ts, owner-signin.ts, webauthn.ts) and shares their files:
// a session or a passkey made by one runtime is good for the other, and the gate's memory (what was seen when, what was asked, what was reset) is the same rows. The WebAuthn
// ceremony itself (the client data, the attestation, the signature, the counter) is checked by github.com/go-webauthn/webauthn rather than by code of our own.
package access

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

// Header names the front sends the owner's credential in.
const (
	OwnerLinkHeader    = "x-owner-link"
	OwnerSessionHeader = "x-owner-session"
	OwnerSigninHeader  = "x-owner-signin"
)

// Files in the shop's client folder (written by the deployer) and beside the store (written here).
const (
	OwnerLinkFile     = "owner-link.json"
	PagesFile         = "pages.json"
	OwnerGrantsFile   = "owner-grants.json"
	OwnerResetFile    = "owner-reset.json"
	OwnerSessionsFile = "owner-sessions.json"
	OwnerAccessFile   = "owner-access.sqlite"
)

var (
	ownerToken = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	hex64      = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func sha(text string) string { s := sha256.Sum256([]byte(text)); return hex.EncodeToString(s[:]) }

// readFile is "the file's text, or nothing": a file that cannot be read for a moment (a write in the middle) is as if it were not there, and is read again on the next request.
func readFile(file string) ([]byte, bool) { b, err := os.ReadFile(file); return b, err == nil }

// cut is JavaScript's `text.slice(0, n)`: n UTF-16 code units (a pair cut in half leaves a replacement character, where JavaScript leaves a lone surrogate).
func cut(s string, n int) string {
	if u := utf16.Encode([]rune(s)); len(u) > n {
		return string(utf16.Decode(u[:n]))
	}
	return s
}

// ---- times in files: JavaScript's Date.parse --------------------------------------------------------------------------------------------------------------

// isoTime is the ECMAScript date-time string format (and the few liberties V8 takes with it: a lower-case t or z, a space for the T, an offset without its colon, any number of
// fraction digits): what Date.parse reads in owner-grants.json, owner-reset.json and owner-sessions.json. V8 also reads older, looser forms ("Nov 19 2026"); this does not, and
// such a field is left out, as an unreadable one is (a broken field never widens access). The panel and the admin write toISOString(), which both read the same.
var isoTime = regexp.MustCompile(`^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?)?$`)

// ParseJSDate is Date.parse for those forms: epoch milliseconds, and false for what Date.parse would call NaN (or what this does not read). A date alone is UTC; a date and a
// time with no offset is the machine's local time, as JavaScript reads them.
func ParseJSDate(text string) (int64, bool) {
	m := isoTime.FindStringSubmatch(text)
	if m == nil || m[1] == "-000000" {
		return 0, false
	}
	year, _ := strconv.Atoi(m[1])
	num := func(s string, def int) int {
		if s == "" {
			return def
		}
		n, _ := strconv.Atoi(s)
		return n
	}
	month, dayOf := num(m[2], 1), num(m[3], 1)
	hour, minute, second := num(m[4], 0), num(m[5], 0), num(m[6], 0)
	ms := 0
	if m[7] != "" {
		f := (m[7] + "00")[:3] // V8 keeps the first three digits
		ms, _ = strconv.Atoi(f)
	}
	// V8 lets a day run past its month (the 30th of February is the 2nd of March) but not past 31; 24:00 is the next midnight, and nothing after it
	if month < 1 || month > 12 || dayOf < 1 || dayOf > 31 || minute > 59 || second > 59 || hour > 24 || (hour == 24 && (minute != 0 || second != 0 || ms != 0)) {
		return 0, false
	}
	loc := time.UTC
	hasTime := m[4] != ""
	if hasTime && m[8] == "" {
		loc = time.Local
	}
	t := time.Date(year, time.Month(month), dayOf, hour, minute, second, ms*int(time.Millisecond), loc)
	if z := m[8]; z != "" && z != "Z" && z != "z" {
		off := strings.ReplaceAll(z[1:], ":", "")
		oh, _ := strconv.Atoi(off[:2])
		om, _ := strconv.Atoi(off[2:])
		if oh > 23 || om > 59 {
			return 0, false
		}
		shift := time.Duration(oh)*time.Hour + time.Duration(om)*time.Minute
		if z[0] == '+' {
			t = t.Add(-shift)
		} else {
			t = t.Add(shift)
		}
	}
	return t.UnixMilli(), true
}

func timeOf(v any) (string, int64, bool) {
	s, ok := v.(string)
	if !ok {
		return "", 0, false
	}
	t, ok := ParseJSDate(s)
	return s, t, ok
}

// ---- the owner's link ------------------------------------------------------------------------------------------------------------------------------------

// OwnerLinkMatches: the panel-made link against the hash the client folder holds now. Read on every request, so a revoked link stops at once.
func OwnerLinkMatches(file, token string) bool {
	if !ownerToken.MatchString(token) {
		return false
	}
	b, ok := readFile(file)
	if !ok {
		return false
	}
	var f struct {
		Schema    int    `json:"schema"`
		Sha256    string `json:"sha256"`
		CreatedAt string `json:"createdAt"`
	}
	if json.Unmarshal(b, &f) != nil || f.Schema != 1 || !hex64.MatchString(f.Sha256) || f.CreatedAt == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(sha("owner-link:"+token)), []byte(f.Sha256)) == 1
}

// ---- the shop's addresses (pages.json) -------------------------------------------------------------------------------------------------------------------

// Pages is what the shop needs of pages.json: its address on its own server, where the owner's view is, and its page on the pages domain.
type Pages struct {
	Base      string
	OwnerBase string
	URL       string
}

var httpsURL = regexp.MustCompile(`^https://[a-z0-9.-]+(:\d{1,5})?(/[A-Za-z0-9._~%/-]*)?$`)

func isURL(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && len(s) <= 300 && httpsURL.MatchString(s) && !strings.HasSuffix(s, "/")
}

var slug = regexp.MustCompile(`^[a-z0-9-]{3,40}$`)

// ReadPages reads pages.json; nil when the shop has none (then it has no owner sign-in at all).
func ReadPages(file string) *Pages {
	b, ok := readFile(file)
	if !ok {
		return nil
	}
	var f map[string]any
	if json.Unmarshal(b, &f) != nil || f["schema"] != float64(1) {
		return nil
	}
	base, ok1 := isURL(f["base"])
	owner, ok2 := isURL(f["ownerBase"])
	if !ok1 || !ok2 {
		return nil
	}
	p := &Pages{Base: base, OwnerBase: owner}
	if s, ok := f["slug"].(string); ok && slug.MatchString(s) {
		if u, ok := isURL(f["url"]); ok {
			p.URL = u
		}
	}
	return p
}

// ---- the Operator's file (owner-grants.json) and Geometer's reset (owner-reset.json) -----------------------------------------------------------------------------------

// Grants is owner-grants.json, field by field (owner-grants.ts readOwnerGrants), with Geometer's reset merged in from ITS OWN file. A field that does not read is left out, never
// widened: a broken file grants nothing. Times are kept as the file wrote them (a request's askedAt is its key in the store) and as Date.parse reads them.
type Grants struct {
	Setup          *Setup
	Recovery       *Recovery
	PasskeysBefore *string
	passkeysBefore int64
	PendingRemoval *PendingRemoval
	// Reset is NEVER read from owner-grants.json (the Operator's panel writes that file, and a forged reset would reopen the shop to the Operator): ReadGrants fills it from
	// owner-reset.json only, a file the admin writes and the panel never does.
	Reset *Reset
}

// Setup is the setup QR's hash and times.
type Setup struct {
	Sha256, CreatedAt, ExpiresAt string
	expiresAt                    int64
}

// Recovery is the printed card's code hashes.
type Recovery struct {
	Codes     []string
	CreatedAt string
}

// PendingRemoval is the Operator's request to remove every passkey. EffectiveAt is the panel's own reckoning; the store works out its own (RemovalWaitMs from first sight).
type PendingRemoval struct {
	AskedBy, AskedAt, EffectiveAt string
	askedAt                       int64
}

// Reset is Geometer's reset: when, why, by whom, and the reset's own QR.
type Reset struct {
	At, Reason, By string
	at             int64
	Setup          *ResetSetup
}

// ResetSetup is the reset's own QR: it lives in the admin's file and nowhere the panel writes.
type ResetSetup struct {
	Sha256, ExpiresAt string
	expiresAt         int64
}

// readOwnerGrants is owner-grants.ts readOwnerGrants.
func readOwnerGrants(b []byte, ok bool) *Grants {
	if !ok {
		return nil
	}
	var f map[string]any
	if json.Unmarshal(b, &f) != nil || f == nil || f["schema"] != float64(1) {
		return nil
	}
	g := &Grants{}
	if s, ok := f["setup"].(map[string]any); ok {
		h, okH := s["sha256"].(string)
		c, _, okC := timeOf(s["createdAt"])
		e, et, okE := timeOf(s["expiresAt"])
		if okH && hex64.MatchString(h) && okC && okE {
			g.Setup = &Setup{Sha256: h, CreatedAt: c, ExpiresAt: e, expiresAt: et}
		}
	}
	if r, ok := f["recovery"].(map[string]any); ok {
		if codes, ok := r["codes"].([]any); ok && len(codes) <= 20 {
			c, _, okC := timeOf(r["createdAt"])
			all := okC
			list := []string{}
			for _, x := range codes {
				s, isText := x.(string)
				all = all && isText && hex64.MatchString(s)
				list = append(list, s)
			}
			if all {
				g.Recovery = &Recovery{Codes: list, CreatedAt: c}
			}
		}
	}
	if s, t, ok := timeOf(f["passkeysBefore"]); ok {
		g.PasskeysBefore, g.passkeysBefore = &s, t
	}
	if p, ok := f["pendingRemoval"].(map[string]any); ok {
		by, okB := p["askedBy"].(string)
		at, att, okA := timeOf(p["askedAt"])
		eff, _, okE := timeOf(p["effectiveAt"])
		if okB && okA && okE {
			g.PendingRemoval = &PendingRemoval{AskedBy: cut(by, 80), AskedAt: at, EffectiveAt: eff, askedAt: att}
		}
	}
	return g
}

// readOwnerReset is owner-grants.ts readOwnerReset: Geometer's reset file, field by field; anything that does not read is no reset.
func readOwnerReset(b []byte, ok bool) *Reset {
	if !ok {
		return nil
	}
	var f map[string]any
	if json.Unmarshal(b, &f) != nil || f == nil || f["schema"] != float64(1) {
		return nil
	}
	at, att, okA := timeOf(f["at"])
	reason, okR := f["reason"].(string)
	by, okB := f["by"].(string)
	if !okA || !okR || !okB {
		return nil
	}
	r := &Reset{At: at, at: att, Reason: cut(reason, 300), By: cut(by, 80)}
	// the reset's own QR lives HERE, in the admin's file, and nowhere the panel writes: from a reset until the owner's first passkey after it, the runtime accepts only this one
	if s, ok := f["setup"].(map[string]any); ok {
		h, okH := s["sha256"].(string)
		e, et, okE := timeOf(s["expiresAt"])
		if okH && hex64.MatchString(h) && okE {
			r.Setup = &ResetSetup{Sha256: h, ExpiresAt: e, expiresAt: et}
		}
	}
	return r
}

// ReadGrants is owner-grants.ts ownerGrantsReader: the panel's file and Geometer's reset file, read on every call so a new QR, card, request or reset is seen at once. The
// reset is read apart and merged in, so the panel's file can never carry one. nil when there is neither.
func ReadGrants(grantsFile, resetFile string) *Grants {
	reset := readOwnerReset(readFile(resetFile))
	g := readOwnerGrants(readFile(grantsFile))
	if g == nil && reset != nil {
		g = &Grants{}
	}
	if g != nil && reset != nil {
		g.Reset = reset
	}
	return g
}

// ---- grants: the setup QR's token and a recovery code ------------------------------------------------------------------------------------------------------

// Grant is a setup token or a recovery code the owner presents.
type Grant struct {
	Kind  string // "setup" or "recovery"
	Token string // the setup token
	Code  string // the recovery code
}

const recoveryLetters = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

var recoveryCode = regexp.MustCompile(`^[` + recoveryLetters + `]{10}$`)

var upper = cases.Upper(language.Und)

// jsSpace is JavaScript's \s (with the u flag): the Unicode spaces and line ends, and the byte-order mark. Not Go's unicode.IsSpace, which differs (U+0085 is in Go's, U+FEFF
// is not).
func jsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// normalCode is owner-grants.ts normalCode: a code as typed made one form, `typed.normalize("NFKC").toUpperCase().replace(/[\s-]+/gu, "")`. Full-width letters and digits
// fold to plain ones (NFKC), and upper case is the full Unicode mapping JavaScript uses (cases.Upper, not strings.ToUpper: "ß" is "SS" in both).
func normalCode(typed string) string {
	var b strings.Builder
	for _, r := range upper.String(norm.NFKC.String(typed)) {
		if !jsSpace(r) && r != '-' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// RecoveryShape: does the code, as typed, read as one of ours (ten of the code letters)?
func RecoveryShape(code string) bool { return recoveryCode.MatchString(normalCode(code)) }

// SetupHash is the hash a setup token (the Operator's QR, the owner's "add a phone" link, Geometer's reset QR) is named by.
func SetupHash(token string) string { return sha("owner-setup:" + token) }

// RecoveryHash is the hash a recovery code (the card's, or the owner's own) is named by.
func RecoveryHash(code string) string { return sha("owner-recovery:" + normalCode(code)) }

// Hash is the grant's hash, the one the panel's file and this store's memory name it by.
func (g Grant) Hash() string {
	if g.Kind == "setup" {
		return SetupHash(g.Token)
	}
	return RecoveryHash(g.Code)
}

func sameHex(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// InFile is what the file says about a grant now: "valid", "expired" (a setup QR past its time) or "unknown" (not this shop's, replaced, or no file). Whether it was USED is
// the store's to say.
func (g Grant) InFile(file *Grants, now int64) string {
	if file == nil {
		return "unknown"
	}
	if g.Kind == "setup" {
		if !ownerToken.MatchString(g.Token) || file.Setup == nil || !sameHex(g.Hash(), file.Setup.Sha256) {
			return "unknown"
		}
		if file.Setup.expiresAt > now {
			return "valid"
		}
		return "expired"
	}
	if !RecoveryShape(g.Code) || file.Recovery == nil {
		return "unknown"
	}
	h := g.Hash()
	for _, c := range file.Recovery.Codes {
		if sameHex(c, h) {
			return "valid"
		}
	}
	return "unknown"
}

// EndBefore reads owner-sessions.json: the panel's "sign out every device" moment, in epoch ms, as Date.parse reads it; nil when there is none (or it does not read: it never
// widens access). The caller clamps it (Access.ClampEndBefore) before it is used.
func EndBefore(file string) *int64 {
	b, ok := readFile(file)
	if !ok {
		return nil
	}
	var f map[string]any
	if json.Unmarshal(b, &f) != nil || f == nil || f["schema"] != float64(1) {
		return nil
	}
	if _, t, ok := timeOf(f["endBefore"]); ok {
		return &t
	}
	return nil
}
