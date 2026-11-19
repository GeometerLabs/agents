// Package report is the generic half of modules/report in Go: the canonical JSON every signed paper is digested over, the digest and short code, the sealed envelope and its
// check, the signed summary a paper carries in its link, the printable page and its words, the once-a-month sender. It knows nothing of Bookings, Fees or Orders: each
// template's own report is written beside it and calls these building blocks. Every function says which TypeScript function it copies; the vectors the Go tests compare with
// are RUN from the TypeScript (scripts/gen_report_vectors.ts), never retyped.
//
// This file is record.ts `canonicalJson` (modules/record/record.ts), the one byte form of a JSON value: keys sorted, no spaces, so the same content has the same bytes and
// the same digest. NOT RFC 8785 (internal/signing is that one) and NOT encoding/json: the TypeScript sorts keys by UTF-16 code unit, writes numbers the way JavaScript's
// Number-to-string does, and writes strings the way JSON.stringify does, and the three differ from Go's in the places named below, so they are copied here.
//
// One difference to know: in the TypeScript a key whose value is undefined is written as "null" by this function (it calls itself on the value), though JSON.stringify of the
// same object would drop it. Go has no undefined: the caller builds trees with no absent keys (leave the key out, or put an explicit nil to get "null").
package report

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// CanonicalJSON is canonicalJson(value). It takes map[string]any, []any, string, bool, nil, the integer and float types, json.Number (read as the double JSON.parse would
// make of it), and, through reflection, other maps with string keys and slices. A struct is a programming error and panics: build a map[string]any instead.
func CanonicalJSON(v any) string {
	var b strings.Builder
	writeCanonical(&b, v)
	return b.String()
}

func writeCanonical(b *strings.Builder, v any) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case string:
		writeJSString(b, x)
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case int:
		writeInt(b, int64(x))
	case int8:
		writeInt(b, int64(x))
	case int16:
		writeInt(b, int64(x))
	case int32:
		writeInt(b, int64(x))
	case int64:
		writeInt(b, x)
	case uint:
		writeUint(b, uint64(x))
	case uint8:
		writeUint(b, uint64(x))
	case uint16:
		writeUint(b, uint64(x))
	case uint32:
		writeUint(b, uint64(x))
	case uint64:
		writeUint(b, x)
	case float32:
		b.WriteString(JSNumber(float64(x)))
	case float64:
		b.WriteString(JSNumber(x))
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sortUTF16(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSString(b, k)
			b.WriteByte(':')
			writeCanonical(b, x[k])
		}
		b.WriteByte('}')
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeCanonical(b, e)
		}
		b.WriteByte(']')
	case []string:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSString(b, e)
		}
		b.WriteByte(']')
	case json.Number: // JSON.parse would have made a double of it
		f, err := strconv.ParseFloat(string(x), 64)
		if err != nil {
			panic(fmt.Sprintf("report: %q is not a number", string(x)))
		}
		b.WriteString(JSNumber(f))
	default:
		writeReflect(b, reflect.ValueOf(v))
	}
}

func writeReflect(b *strings.Builder, rv reflect.Value) {
	switch rv.Kind() {
	case reflect.Map:
		if rv.Type().Key().Kind() != reflect.String {
			panic("report: a map needs string keys")
		}
		m := make(map[string]any, rv.Len())
		for _, k := range rv.MapKeys() {
			m[k.String()] = rv.MapIndex(k).Interface()
		}
		writeCanonical(b, m)
	case reflect.Slice, reflect.Array:
		s := make([]any, rv.Len())
		for i := range s {
			s[i] = rv.Index(i).Interface()
		}
		writeCanonical(b, s)
	case reflect.Pointer, reflect.Interface:
		if rv.IsNil() {
			b.WriteString("null")
			return
		}
		writeCanonical(b, rv.Elem().Interface())
	case reflect.String:
		writeJSString(b, rv.String())
	case reflect.Bool:
		b.WriteString(strconv.FormatBool(rv.Bool()))
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		writeInt(b, rv.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		writeUint(b, rv.Uint())
	case reflect.Float32, reflect.Float64:
		b.WriteString(JSNumber(rv.Float()))
	default:
		panic("report: CanonicalJSON cannot write a " + rv.Type().String() + ": build a map[string]any")
	}
}

// An integer past 2^53 is rounded to the double the TypeScript would have held, so both runtimes write the same digits; below it the digits are the integer's own.
const safe = 1 << 53

func writeInt(b *strings.Builder, n int64) {
	if n > safe || n < -safe {
		b.WriteString(JSNumber(float64(n)))
		return
	}
	b.WriteString(strconv.FormatInt(n, 10))
}

func writeUint(b *strings.Builder, n uint64) {
	if n > safe {
		b.WriteString(JSNumber(float64(n)))
		return
	}
	b.WriteString(strconv.FormatUint(n, 10))
}

// JSNumber is JavaScript's Number-to-string (and JSON.stringify of a number): the shortest digits that read back to the same double, written without an exponent from 1e-6 up
// to (not including) 1e21, integers with no decimal point, -0 as "0", and NaN and the infinities as "null" (what JSON.stringify gives them).
func JSNumber(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null"
	}
	if f == 0 {
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	// 'e' with -1 precision is the shortest round-trip digits: d.ddde+XX
	s := strconv.FormatFloat(f, 'e', -1, 64)
	mant, expText, _ := strings.Cut(s, "e")
	digits := strings.Replace(mant, ".", "", 1)
	exp, _ := strconv.Atoi(expText)
	n := exp + 1 // the value is 0.<digits> x 10^n
	k := len(digits)
	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	e := n - 1
	es := "+"
	if e < 0 {
		es, e = "-", -e
	}
	if k == 1 {
		return sign + digits + "e" + es + strconv.Itoa(e)
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + es + strconv.Itoa(e)
}

// JSONString is JSON.stringify of a string: only the quote, the backslash and the control characters are escaped (\b \f \n \r \t, the rest of U+0000 to U+001F as \u00xx in
// lower case). U+007F, U+2028, U+2029 and everything else are written as they are, which Go's json.Marshal does not (it escapes <, >, & and U+2028/2029). A Go string holding invalid
// UTF-8 is written with U+FFFD in its place, as the TypeScript's UTF-8 encoding of a lone surrogate would give (JSON.stringify itself would write \udXXX, which Go cannot hold).
func JSONString(s string) string {
	var b strings.Builder
	writeJSString(&b, s)
	return b.String()
}

func writeJSString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20:
			b.WriteString(fmt.Sprintf(`\u%04x`, r))
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
}

// sortUTF16 sorts as JavaScript's default Array.prototype.sort does for strings: by UTF-16 code unit (so U+10000 and above, which are surrogates at 0xD800, sort before U+E000 to U+FFFF).
func sortUTF16(keys []string) {
	sort.Slice(keys, func(i, j int) bool { return LessUTF16(keys[i], keys[j]) })
}

// LessUTF16 is JavaScript's `a < b` on strings: compared by UTF-16 code unit.
func LessUTF16(a, b string) bool {
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			return ua[i] < ub[i]
		}
	}
	return len(ua) < len(ub)
}
