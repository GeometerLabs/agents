package language

// JavaScript's behaviours that more than one package copies, written once (decision 61, waves 1b and 1c joined them): a slice of text counted in UTF-16 units as it reads once
// written out, JavaScript's lower case, NFC, how TextDecoder reads bytes that are not UTF-8, and Date.parse for the ISO forms the files and formats use. Before, the directory
// (internal/directory jsutil.go), the owner's access (internal/access) and the listings (internal/listings text.go) each had their own copy.

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/cases"
	xlanguage "golang.org/x/text/language"
	xnorm "golang.org/x/text/unicode/norm"
)

// UTF16SliceFFFD is JavaScript's `s.slice(0, n)` as it reads once written out: a cut inside a surrogate pair leaves JavaScript a lone surrogate, which has no UTF-8 form, so it
// becomes U+FFFD (what node:sqlite, JSON in a file and a UTF-8 response make of it). UTF16Slice drops the half instead; the two are kept apart because each is what its callers'
// files have always held.
func UTF16SliceFFFD(s string, n int) string {
	if UTF16Len(s) <= n {
		return s
	}
	return string(utf16.Decode(utf16.Encode([]rune(s))[:n]))
}

var lower = cases.Lower(xlanguage.Und)

// LowerJS is JavaScript's `toLowerCase()`: the full Unicode case mapping (İ becomes i and a combining dot) and the final sigma. Canon uses strings.ToLower, which differs only on
// letters the four languages' words do not hold, and is kept as it is.
func LowerJS(s string) string { return lower.String(s) }

// NFC is `normalize("NFC")`.
func NFC(s string) string { return xnorm.NFC.String(s) }

// DecodeUTF8JS reads bytes as UTF-8 the way TextDecoder (and so `fetch`'s `text()`) does for the cases that matter: each byte that is not part of a good sequence becomes U+FFFD
// (strings.ToValidUTF8 would make a whole run of them one).
func DecodeUTF8JS(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var out strings.Builder
	for len(b) > 0 {
		r, n := utf8.DecodeRune(b)
		if r == utf8.RuneError && n == 1 {
			out.WriteRune('�')
		} else {
			out.WriteRune(r)
		}
		b = b[n:]
	}
	return out.String()
}

// isoTime is the ECMAScript date-time string format (and the few liberties V8 takes with it: a lower-case t or z, a space for the T, an offset without its colon, any number of
// fraction digits). V8 also reads older, looser forms ("Nov 19 2026", RFC 1123); this does not, and such a field is left out, as an unreadable one is (a broken field never widens
// access, and a date a shop wrote so is "not from just now"). Every writer of ours writes toISOString(), which both read the same.
var isoTime = regexp.MustCompile(`^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?)?$`)

// ParseJSDate is Date.parse for those forms: epoch milliseconds, and false for what Date.parse would call NaN (or what this does not read). A date alone is UTC; a date and a time
// with no offset is the machine's local time, as JavaScript reads them (a container has no zone set, so there it is UTC).
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
	if m[4] != "" && m[8] == "" {
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
	// a Date holds at most 8.64e15 ms either side of 1970 (the year 275760); past that Date.parse says NaN
	if ms := t.UnixMilli(); ms > 8_640_000_000_000_000 || ms < -8_640_000_000_000_000 {
		return 0, false
	}
	return t.UnixMilli(), true
}
