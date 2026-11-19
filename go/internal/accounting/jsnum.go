// The few JavaScript number and date behaviours the books copy, in one place, so every file that reads a number out of a record's refs or a time out of its entry reads it the way the
// TypeScript does. Why they matter: refs are text, and the TypeScript turns them into numbers three different ways (a strict check `Number.isSafeInteger(n) && String(n) === text`, a bare
// `Number(text)`, and a `Number(text)` kept only if it is a safe integer), so "1e3", " 5 ", "0x10", "" and "abc" mean different things in different places. JSNumber is the ECMAScript
// StringToNumber for what a ref can hold; JSNumberString is Number::toString (a message prints a number the way JavaScript does); parseISO is Date.parse for the form the record writes
// (`new Date(ms).toISOString()`) and a few others. JavaScript numbers beyond 2^53 are out of scope: a figure is an int64 here, and a ref beyond 2^53 is not "safe" in either language.
package accounting

import (
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/language"
)

var (
	decimalNumber = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
	hexNumber     = regexp.MustCompile(`^0[xX][0-9a-fA-F]+$`)
	octNumber     = regexp.MustCompile(`^0[oO][0-7]+$`)
	binNumber     = regexp.MustCompile(`^0[bB][01]+$`)
)

// JSNumber is `Number(text)` for a string (ECMAScript StringToNumber): white space and line terminators are trimmed first (JavaScript's `\s`, language.TrimJS), the empty string is 0,
// "Infinity" with an optional sign is infinite, 0x, 0o and 0b give hex, octal and binary (unsigned only), and a decimal may have a sign, a point and an exponent ("1e3" is 1000, ".5" is
// 0.5, "5." is 5). Anything else, including "1_000", "1,5", "0x", "+0x10" and "1e", is NaN.
func JSNumber(text string) float64 {
	s := language.TrimJS(text)
	if s == "" {
		return 0
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	radix := 0
	switch {
	case hexNumber.MatchString(s):
		radix = 16
	case octNumber.MatchString(s):
		radix = 8
	case binNumber.MatchString(s):
		radix = 2
	}
	if radix != 0 {
		n, ok := new(big.Int).SetString(s[2:], radix)
		if !ok {
			return math.NaN()
		}
		f, _ := new(big.Float).SetInt(n).Float64()
		return f
	}
	if !decimalNumber.MatchString(s) {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil && !math.IsInf(f, 0) { // an overflow is Infinity, as in JavaScript; anything else the pattern let through cannot fail
		return math.NaN()
	}
	return f
}

// IsSafeInteger is Number.isSafeInteger.
func IsSafeInteger(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0) && f == math.Trunc(f) && math.Abs(f) <= 9007199254740991
}

// JSNumberString is `String(n)` (Number::toString): the shortest digits that read back as the same double, in plain form for 1e-6 <= |n| < 1e21 and with an exponent otherwise.
func JSNumberString(x float64) string {
	switch {
	case math.IsNaN(x):
		return "NaN"
	case x == 0:
		return "0" // also for -0, as String(-0) is "0"
	case math.IsInf(x, 1):
		return "Infinity"
	case math.IsInf(x, -1):
		return "-Infinity"
	case x < 0:
		return "-" + JSNumberString(-x)
	}
	e := strconv.FormatFloat(x, 'e', -1, 64) // d.ddde+XX
	mant, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	n, _ := strconv.Atoi(exp)
	n++ // the value is 0.digits x 10^n
	k := len(digits)
	switch {
	case k <= n && n <= 21:
		return digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return "0." + strings.Repeat("0", -n) + digits
	}
	sign := "+"
	if n-1 < 0 {
		sign = "-"
	}
	abs := n - 1
	if abs < 0 {
		abs = -abs
	}
	if k == 1 {
		return digits + "e" + sign + strconv.Itoa(abs)
	}
	return digits[:1] + "." + digits[1:] + "e" + sign + strconv.Itoa(abs)
}

// canonicalInt reads text as `Number.isSafeInteger(n) && String(n) === text` does: only the plain decimal form of a safe integer passes (no sign but "-", no leading zero, no space, no
// exponent, no "-0"). ok is false for anything else. The caller adds its own sign and size rules (paise: above 0; whole: 0 or more).
func canonicalInt(text string) (int64, bool) {
	f := JSNumber(text)
	if !IsSafeInteger(f) || JSNumberString(f) != text {
		return 0, false
	}
	return int64(f), true
}

// RoundHalfUp is Math.round: halves go towards +Infinity (2.5 is 3, -2.5 is -2), and the value is rounded from the double it is, so 0.49999999999999994 is 0 (floor(x + 0.5) would say 1).
func RoundHalfUp(x float64) float64 {
	r := math.Floor(x)
	if x-r >= 0.5 {
		return r + 1
	}
	return r
}

// parseISO is Date.parse for the times the record holds: "2026-11-01T10:00:00.000Z" (what toISOString writes), the same with an offset or without milliseconds, and a bare date (UTC).
// ok is false where Date.parse gives NaN. Epoch milliseconds, as an int64.
func parseISO(s string) (int64, bool) {
	for _, layout := range []string{"2006-01-02T15:04:05.999999999Z07:00", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli(), true
		}
	}
	return 0, false
}
