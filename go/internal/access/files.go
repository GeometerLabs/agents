// Package access is the owner's way in: the owner's link (a hash in the shop's folder), the sessions and passkeys the runtime keeps in its own file beside the store
// (owner-access.sqlite), and the Operator's one-use setup code and recovery card. It is the Go twin of modules/channels (owner-link.ts, owner-grants.ts, pages-file.ts,
// owner-access.ts, owner-signin.ts, webauthn.ts) and shares their files: a session or a passkey made by one runtime is good for the other. The WebAuthn ceremony itself
// (the client data, the attestation, the signature, the counter) is checked by github.com/go-webauthn/webauthn rather than by code of our own.
package access

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode"
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

// ---- the Operator's setup code and recovery card ----------------------------------------------------------------------------------------------------------

// Grants is owner-grants.json: the setup QR's hash, the recovery card's code hashes and the moment before which passkeys are void.
type Grants struct {
	SetupSha       string
	SetupExpires   time.Time
	RecoveryCodes  []string
	PasskeysBefore *time.Time
}

// Grant is a setup token or a recovery code the owner presents.
type Grant struct {
	Kind  string // "setup" or "recovery"
	Token string // the setup token
	Code  string // the recovery code
}

func parseTime(v any) (time.Time, bool) {
	s, ok := v.(string)
	if !ok {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	return t, err == nil
}

// ReadGrants reads owner-grants.json; nil when there is none.
func ReadGrants(file string) *Grants {
	b, ok := readFile(file)
	if !ok {
		return nil
	}
	var f map[string]any
	if json.Unmarshal(b, &f) != nil || f["schema"] != float64(1) {
		return nil
	}
	g := &Grants{}
	if s, ok := f["setup"].(map[string]any); ok {
		h, _ := s["sha256"].(string)
		_, okC := parseTime(s["createdAt"])
		exp, okE := parseTime(s["expiresAt"])
		if hex64.MatchString(h) && okC && okE {
			g.SetupSha, g.SetupExpires = h, exp
		}
	}
	if r, ok := f["recovery"].(map[string]any); ok {
		if codes, ok := r["codes"].([]any); ok && len(codes) <= 20 {
			_, okC := parseTime(r["createdAt"])
			all := okC
			var list []string
			for _, c := range codes {
				s, _ := c.(string)
				all = all && hex64.MatchString(s)
				list = append(list, s)
			}
			if all {
				g.RecoveryCodes = list
			}
		}
	}
	if t, ok := parseTime(f["passkeysBefore"]); ok {
		g.PasskeysBefore = &t
	}
	return g
}

const recoveryLetters = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

var recoveryCode = regexp.MustCompile(`^[` + recoveryLetters + `]{10}$`)

// normalCode is what the owner typed, made one form: upper case, no spaces or dashes. (The TypeScript side first applies NFKC; the owner types ASCII here.)
func normalCode(typed string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(typed) {
		if !unicode.IsSpace(r) && r != '-' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Hash is the grant's hash, the one the panel's file and this store's memory of used grants name it by.
func (g Grant) Hash() string {
	if g.Kind == "setup" {
		return sha("owner-setup:" + g.Token)
	}
	return sha("owner-recovery:" + normalCode(g.Code))
}

func sameHex(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// InFile is what the file says about a grant now: "valid", "expired" (a setup QR past its time) or "unknown" (not this shop's, replaced, or no file). Whether it was USED is the
// store's to say.
func (g Grant) InFile(file *Grants, now int64) string {
	if file == nil {
		return "unknown"
	}
	if g.Kind == "setup" {
		if !ownerToken.MatchString(g.Token) || file.SetupSha == "" || !sameHex(g.Hash(), file.SetupSha) {
			return "unknown"
		}
		if file.SetupExpires.UnixMilli() > now {
			return "valid"
		}
		return "expired"
	}
	if !recoveryCode.MatchString(normalCode(g.Code)) || len(file.RecoveryCodes) == 0 {
		return "unknown"
	}
	for _, c := range file.RecoveryCodes {
		if sameHex(c, g.Hash()) {
			return "valid"
		}
	}
	return "unknown"
}

// EndBefore reads owner-sessions.json: the panel's "sign out every device" moment, in epoch ms; ok=false when there is none.
func EndBefore(file string) (int64, bool) {
	b, ok := readFile(file)
	if !ok {
		return 0, false
	}
	var f struct {
		Schema    int    `json:"schema"`
		EndBefore string `json:"endBefore"`
	}
	if json.Unmarshal(b, &f) != nil || f.Schema != 1 {
		return 0, false
	}
	t, err := time.Parse(time.RFC3339Nano, f.EndBefore)
	if err != nil {
		return 0, false
	}
	return t.UnixMilli(), true
}
