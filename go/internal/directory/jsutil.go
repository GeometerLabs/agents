// Package directory is the directory of local shops (modules/discovery of the TypeScript tree) written in Go: it reads the signed feeds shops publish, keeps a search index, asks the
// shops about the ten results it is about to show, puts results in THE fair order, and serves a page, a JSON search, an MCP endpoint and a signed Agent Card. Decision 61, wave 1c.
//
// This file: the web-form behaviours of JavaScript the directory leans on and Go does not have (a URLSearchParams reads `+` as a space and never rejects a pair; encodeURIComponent and
// URLSearchParams.toString write what they write), written once so every other file says which one it means. The text behaviours (UTF-16 lengths and slices, `toLowerCase`, NFC,
// `trim` and `\s`, TextDecoder, Date.parse) are internal/language's, shared with the shops' runtime (js.go, text.go there).
package directory

import (
	"strings"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/signing"
)

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
	return language.DecodeUTF8JS(b)
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

// marshalNoEscape writes a value as JSON the way JSON.stringify does for what the directory serves (no HTML escaping). Go always writes U+2028 and U+2029 as escapes where
// JavaScript writes them as they are; both read back as the same text.
func marshalNoEscape(v any) ([]byte, error) { return signing.Marshal(v) }
