// The few JavaScript behaviours the messaging code copies that Go does not have: `Number(x)`, `String(n)` of a whole number, `new Date(ms).toISOString()` and `s.trim()`. Each is named
// after what it copies, and the vectors (testdata/webhook-vectors.json) hold the TypeScript's answers for the odd inputs.
package messaging

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/language"
)

func trimJS(s string) string { return language.TrimJS(s) }
func itoa(n int) string      { return strconv.Itoa(n) }

var decimalNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

// numberOfString is JavaScript's Number(string): surrounding whitespace (JavaScript's) is ignored, "" is 0, "0x10" "0o7" "0b1" are read in their base (no sign), "Infinity" is infinite,
// a decimal is a decimal (`1e3`, `.5`, `5.`), and anything else (`1_000`, `12px`, `inf`, `nan`, a hex float) is NaN. strconv.ParseFloat alone would accept several of those.
func numberOfString(s string) float64 {
	s = trimJS(s)
	if s == "" {
		return 0
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := 0
		switch s[1] {
		case 'x', 'X':
			base = 16
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			v := 0.0
			for _, c := range s[2:] {
				d := -1
				switch {
				case c >= '0' && c <= '9':
					d = int(c - '0')
				case c >= 'a' && c <= 'f':
					d = int(c-'a') + 10
				case c >= 'A' && c <= 'F':
					d = int(c-'A') + 10
				}
				if d < 0 || d >= base {
					return math.NaN()
				}
				v = v*float64(base) + float64(d)
			}
			return v
		}
	}
	if !decimalNumber.MatchString(s) {
		return math.NaN()
	}
	f, _ := strconv.ParseFloat(s, 64) // an out-of-range number is ±Inf with an error, as JavaScript's is Infinity
	return f
}

// numberOf is `Number(v)` for a decoded JSON value; `present` false is `undefined` (NaN). null is 0, true is 1, false is 0, an array is its elements joined by commas (so [] is 0 and [5] is 5),
// an object is NaN.
func numberOf(v any, present bool) float64 {
	if !present {
		return math.NaN()
	}
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		return numberOfString(x)
	case interface{ Float64() (float64, error) }:
		f, err := x.Float64()
		if err != nil && !math.IsInf(f, 0) {
			return math.NaN()
		}
		return f
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			switch y := e.(type) {
			case nil:
			case string:
				parts[i] = y
			case bool:
				parts[i] = strconv.FormatBool(y)
			default:
				f := numberOf(e, true)
				if math.IsNaN(f) {
					return math.NaN()
				}
				parts[i] = strconv.FormatFloat(f, 'f', -1, 64)
			}
		}
		return numberOfString(strings.Join(parts, ","))
	}
	return math.NaN()
}

// whole turns a JavaScript number that is a whole count of milliseconds into an int64, cut at the 2^53 JavaScript can hold exactly: a Go int64 holds no fraction, and a time here
// is whole milliseconds (the project's rule: times are integers). A fractional part is dropped (the TypeScript would carry it, and `new Date()` drops it anyway).
func whole(f float64) int64 {
	const max = 1 << 53
	switch {
	case f >= max:
		return max
	case f <= -max:
		return -max
	}
	return int64(math.Trunc(f))
}

// isoString is `new Date(ms).toISOString()`. A time outside JavaScript's Date range (more than 8.64e15 ms either way) is the RangeError "Invalid time value", which the TypeScript lets
// escape (a failed status with a huge timestamp makes recordMessageStatus throw); ok is false there. Years past 9999 are written with a sign and six digits, as JavaScript writes them.
func isoString(ms int64) (string, bool) {
	if ms > 8_640_000_000_000_000 || ms < -8_640_000_000_000_000 {
		return "", false
	}
	t := time.UnixMilli(ms).UTC()
	y := t.Year()
	switch {
	case y > 9999:
		return "+" + pad(y, 6) + t.Format("-01-02T15:04:05.000Z"), true
	case y < 0:
		return "-" + pad(-y, 6) + t.Format("-01-02T15:04:05.000Z"), true
	}
	return t.Format("2006-01-02T15:04:05.000Z"), true
}

// ISOString is isoString for other packages (the runtime's status line): `new Date(ms).toISOString()`, and false where JavaScript throws (past ±8.64e15 ms).
func ISOString(ms int64) (string, bool) { return isoString(ms) }

func pad(n, width int) string {
	s := strconv.Itoa(n)
	for len(s) < width {
		s = "0" + s
	}
	return s
}
