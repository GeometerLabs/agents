package guard

// What JavaScript does to JSON, URLs and numbers that Go does differently, and the narrowing helpers of modules/core/json.ts. A request's bytes are part of the contract (Guard binds
// an approval to the digest of the exact call, and `60000` is not `"60000"`), so every request body is written by JSText, which gives the bytes JSON.stringify gives, and every
// path and query by EncodeURIComponent and QueryString, which give what encodeURIComponent and URLSearchParams give.
//
// Money: a reply's numbers are decoded with UseNumber and read as integers only (Int). TypeScript's `num` passes any finite number, so a fractional amount would pass there; here it
// reads as absent, and the caller's "has no amount" error follows. No amount is ever a float in Go.

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// Object is a decoded JSON object (core/json.ts `Json`).
type Object = map[string]any

// JSText is JSON.stringify(v) for the values the clients send: Go's encoder with no HTML escaping (JSON.stringify leaves < > & raw), no trailing newline, and U+2028 / U+2029
// written raw as JavaScript writes them (Go writes  ). A struct's fields come in the order they are declared, which is the TypeScript object literal's order.
func JSText(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	s := strings.TrimSuffix(buf.String(), "\n")
	if !strings.Contains(s, "\\u2028") && !strings.Contains(s, "\\u2029") {
		return s, nil
	}
	// walk the escapes, so that an escaped backslash followed by the letters u2028 is left alone
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			if s[i+1] == 'u' && i+6 <= len(s) && (s[i+2:i+6] == "2028" || s[i+2:i+6] == "2029") {
				if s[i+5] == '8' {
					out.WriteString("\u2028")
				} else {
					out.WriteString("\u2029")
				}
				i += 5
				continue
			}
			out.WriteByte(s[i])
			out.WriteByte(s[i+1])
			i++
			continue
		}
		out.WriteByte(s[i])
	}
	return out.String(), nil
}

// MustJSText is JSText for values that cannot fail to encode (strings, integers, structs of them).
func MustJSText(v any) string {
	s, err := JSText(v)
	if err != nil {
		panic(err)
	}
	return s
}

const uriUnreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

// EncodeURIComponent is JavaScript's encodeURIComponent: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is %XX in UTF-8, upper-case hex. (url.PathEscape differs: it keeps @ : & = + $ ,
// and encodes others.)
func EncodeURIComponent(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if strings.IndexByte(uriUnreserved, c) >= 0 {
			b.WriteByte(c)
		} else {
			b.WriteString("%" + strings.ToUpper(strconv.FormatInt(int64(c)+256, 16)[1:]))
		}
	}
	return b.String()
}

// Param is one query or form field; the order given is the order sent (URLSearchParams keeps insertion order, url.Values.Encode sorts).
type Param struct{ Key, Value string }

// QueryString is URLSearchParams.toString(): application/x-www-form-urlencoded, a space as +, and only A-Z a-z 0-9 * - . _ left bare (so ~ is %7E and ! ' ( ) are encoded).
func QueryString(params []Param) string {
	var b strings.Builder
	enc := func(s string) {
		for i := 0; i < len(s); i++ {
			c := s[i]
			switch {
			case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '*', c == '-', c == '.', c == '_':
				b.WriteByte(c)
			case c == ' ':
				b.WriteByte('+')
			default:
				b.WriteString("%" + strings.ToUpper(strconv.FormatInt(int64(c)+256, 16)[1:]))
			}
		}
	}
	for i, p := range params {
		if i > 0 {
			b.WriteByte('&')
		}
		enc(p.Key)
		b.WriteByte('=')
		enc(p.Value)
	}
	return b.String()
}

// Itoa is String(n) for an integer.
func Itoa(n int64) string { return strconv.FormatInt(n, 10) }

// Decode is JSON.parse for a reply: numbers stay as json.Number (so an amount is never rounded through a float), and anything after the value is an error, as in JavaScript.
func Decode(text string) (any, error) {
	dec := json.NewDecoder(strings.NewReader(text))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err == nil {
		return nil, errTrailing
	} else if err.Error() != "EOF" {
		return nil, err
	}
	return v, nil
}

type decodeError string

func (e decodeError) Error() string { return string(e) }

const errTrailing = decodeError("unexpected data after the JSON value")

// ---- the narrowing helpers (core/json.ts) --------------------------------------------------------------------------------------

// IsObject is the plain-object check: a JSON object, never an array or null.
func IsObject(v any) (Object, bool) { o, ok := v.(map[string]any); return o, ok }

// AsArray returns the list, or nil for anything else, so a missing list in a reply reads as empty.
func AsArray(v any) []any { a, _ := v.([]any); return a }

// Str is a reply field as a string, never coerced: a wrong type reads as absent.
func Str(v any) (string, bool) { s, ok := v.(string); return s, ok }

// Int reads a reply field as a whole number: a JSON number with no fraction that a JavaScript number holds exactly (|n| <= 2^53). A fraction, a string or null reads as absent: money
// is integer paise and times are whole seconds, and Go keeps no float of either.
func Int(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	if i, err := strconv.ParseInt(string(n), 10, 64); err == nil {
		return i, i <= 1<<53 && i >= -(1<<53)
	}
	f, err := strconv.ParseFloat(string(n), 64) // 12.0 and 1.2e3 are whole numbers in JavaScript too
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) || f != math.Trunc(f) || math.Abs(f) > 1<<53 {
		return 0, false
	}
	return int64(f), true
}

// Number reads any finite JSON number, as a float64, for the fields that are not money or times (a Retry-After, a count): TypeScript's `num`.
func Number(v any) (float64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := strconv.ParseFloat(string(n), 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return 0, false
	}
	return f, true
}

// Get reads a member of an object (absent for anything that is not one).
func Get(v any, key string) any {
	if o, ok := v.(map[string]any); ok {
		return o[key]
	}
	return nil
}
