// Package directory is the directory of local shops (modules/discovery of the TypeScript tree) written in Go: it reads the signed feeds shops publish, keeps a search index, asks the
// shops about the ten results it is about to show, puts results in THE fair order, and serves a page, a JSON search, an MCP endpoint and a signed Agent Card. Decision 61, wave 1c.
//
// This file: the few JavaScript behaviours the TypeScript code leans on and Go does not have, written once so every other file says which one it means. Lengths and slices of
// text are counted in UTF-16 code units (`"é".length`, `slice(0, 40)`), a URLSearchParams reads `+` as a space and never rejects a pair, and `toLowerCase` is the full Unicode
// mapping with the final-sigma rule.
package directory

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/signing"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

// utf16Len is JavaScript's `s.length`.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// sliceUTF16 is JavaScript's `s.slice(0, n)`: the first n UTF-16 code units. A cut inside a surrogate pair keeps JavaScript's lone surrogate, which has no UTF-8 form, so it
// becomes U+FFFD here (the same thing node:sqlite and a UTF-8 response do to it).
func sliceUTF16(s string, n int) string {
	if utf16Len(s) <= n {
		return s
	}
	u := utf16.Encode([]rune(s))
	return string(utf16.Decode(u[:n]))
}

// jsLower is JavaScript's `toLowerCase()`: the full case mapping (İ becomes i and a combining dot) and the final sigma.
func jsLower(s string) string { return cases.Lower(language.Und).String(s) }

// nfc is `normalize("NFC")`.
func nfc(s string) string { return norm.NFC.String(s) }

// isWellFormed is `String.prototype.isWellFormed`: a Go string is well formed unless it holds bytes that are not UTF-8 (JavaScript's lone surrogate).
func isWellFormed(s string) bool { return utf8.ValidString(s) }

// formValues reads a query string or a form body as `new URLSearchParams(text)` does: pairs split at `&`, the name and value at the first `=`, `+` is a space, `%XX` is a byte, a
// bad `%` is kept as it is, the bytes are read as UTF-8 with U+FFFD for bad ones. `get` of a name is the FIRST pair with it. Go's url.ParseQuery would reject a `;` and keep bad bytes.
type formValues []struct{ k, v string }

func parseForm(text string) formValues {
	var out formValues
	for _, part := range strings.Split(text, "&") {
		if part == "" {
			continue
		}
		k, v, _ := strings.Cut(part, "=")
		out = append(out, struct{ k, v string }{formDecode(k), formDecode(v)})
	}
	return out
}

func formDecode(s string) string {
	s = strings.ReplaceAll(s, "+", " ")
	var b []byte
	for i := 0; i < len(s); i++ {
		if s[i] == '%' && i+2 < len(s) && isHex(s[i+1]) && isHex(s[i+2]) {
			b = append(b, unhex(s[i+1])<<4|unhex(s[i+2]))
			i += 2
			continue
		}
		b = append(b, s[i])
	}
	return replaceBadBytes(b)
}

func isHex(c byte) bool { return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F' }
func unhex(c byte) byte {
	switch {
	case c >= 'a':
		return c - 'a' + 10
	case c >= 'A':
		return c - 'A' + 10
	}
	return c - '0'
}

// get is URLSearchParams.get: the first value of a name, and whether there is one.
func (f formValues) get(name string) (string, bool) {
	for _, p := range f {
		if p.k == name {
			return p.v, true
		}
	}
	return "", false
}

// encodeForm is URLSearchParams.toString for a list of pairs in the order given (the page builds its addresses with it): space is `+`, and everything but `*-._` and the
// letters and digits is percent-encoded as UTF-8 in capitals.
func encodeForm(pairs [][2]string) string {
	var b strings.Builder
	for i, p := range pairs {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(formEncode(p[0]))
		b.WriteByte('=')
		b.WriteString(formEncode(p[1]))
	}
	return b.String()
}

func formEncode(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '*', c == '-', c == '.', c == '_':
			b.WriteByte(c)
		case c == ' ':
			b.WriteByte('+')
		default:
			b.WriteString("%" + strings.ToUpper(string("0123456789abcdef"[c>>4])+string("0123456789abcdef"[c&15])))
		}
	}
	return b.String()
}

// encodeURIComponent is JavaScript's: everything but letters, digits and `-_.!~*'()` is percent-encoded as UTF-8 in capitals (Go's url.QueryEscape differs: space is `+`).
func encodeURIComponent(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', strings.IndexByte("-_.!~*'()", c) >= 0:
			b.WriteByte(c)
		default:
			b.WriteString("%" + strings.ToUpper(string("0123456789abcdef"[c>>4])+string("0123456789abcdef"[c&15])))
		}
	}
	return b.String()
}

// replaceBadBytes reads bytes as UTF-8 the way TextDecoder does for the cases that matter here: each byte that is not part of a good sequence becomes U+FFFD.
func replaceBadBytes(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var out strings.Builder
	for len(b) > 0 {
		r, n := utf8.DecodeRune(b)
		if r == utf8.RuneError && n == 1 {
			out.WriteRune('\uFFFD')
		} else {
			out.WriteRune(r)
		}
		b = b[n:]
	}
	return out.String()
}

// marshalNoEscape writes a value as JSON the way JSON.stringify does for what the directory serves (no HTML escaping). Go always writes U+2028 and U+2029 as escapes where
// JavaScript writes them as they are; both read back as the same text.
func marshalNoEscape(v any) ([]byte, error) { return signing.Marshal(v) }

// jsDateParse is `Date.parse` for the forms the formats use: an ISO date or date-time with Z or an offset (a date-time with no zone is local time in JavaScript, and the directory runs
// in UTC, so it is read as UTC). A day up to 31 is read in any month and rolls over, as V8's does. Other forms (RFC 1123 and the rest of the legacy parser) are NOT read: ok is false,
// which makes an answer "not from just now" and a `confirmed` date ignored, never a wrong one accepted.
func jsDateParse(s string) (int64, bool) {
	m := dateRE.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	n := func(i int) int { x, _ := strconv.Atoi(m[i]); return x }
	year, mo, d := n(1), 1, 1
	if m[2] != "" {
		mo = n(2)
	}
	if m[3] != "" {
		d = n(3)
	}
	h, mi, se, ms := 0, 0, 0, 0
	if m[4] != "" {
		h, mi = n(4), n(5)
		if m[6] != "" {
			se = n(6)
		}
		if m[7] != "" {
			f := (m[7] + "00")[:3]
			ms, _ = strconv.Atoi(f)
		}
	}
	if mo < 1 || mo > 12 || d < 1 || d > 31 || mi > 59 || se > 59 || h > 24 || (h == 24 && (mi != 0 || se != 0 || ms != 0)) {
		return 0, false
	}
	t := time.Date(year, time.Month(mo), d, h, mi, se, ms*1_000_000, time.UTC).UnixMilli()
	if m[8] != "" && m[8] != "Z" {
		sign := int64(1)
		if m[8][0] == '-' {
			sign = -1
		}
		oh, _ := strconv.Atoi(m[8][1:3])
		om, _ := strconv.Atoi(m[8][4:6])
		t -= sign * int64(oh*60+om) * 60_000
	}
	return t, true
}

var dateRE = regexp.MustCompile(`^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,}))?)?(Z|[+-]\d{2}:\d{2})?)?$`)

// isJSSpace is a character JavaScript's `trim` and `\s` take for white space (ECMAScript white space and line terminators).
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0xfeff, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// jsTrim is `String.prototype.trim`. It is not strings.TrimSpace, which also trims U+0085 and keeps U+FEFF.
func jsTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }
