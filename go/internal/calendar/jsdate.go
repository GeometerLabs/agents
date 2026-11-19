// What JavaScript's Date, Number and String do that the Google Calendar client leans on, written for Go: Date.parse of the times Google sends, Date.prototype.toISOString, Date.UTC,
// Number(string), String(value), and the time-zone arithmetic of modules/core/time.ts zonedToMs (for all-day events). Each says which JavaScript behaviour it copies and where Go
// deliberately differs. The vectors (testdata/calendar-vectors.json, made by go/scripts/vectors/calendar.ts) hold what Node answered for the same inputs.
//
// Differences that are on purpose, all in inputs Google never sends:
//   - Date.parse reads the ISO 8601 forms (what Google's RFC 3339 is), the same with a space for the T, and an offset written +HHMM or +HH. V8's older free-form fallback ("Nov 10 2026",
//     "10 Nov 2026 18:00 GMT") is not copied: such a string is NaN here.
//   - A date and time with NO offset is the computer's local time in JavaScript. Here it is UTC (a shop's computer runs on UTC; Google always writes an offset).
//   - time zone names come from Go's time/tzdata (embedded, so a bare container needs no zoneinfo); ICU may know a newer rule or an alias Go does not, and ICU matches a zone name
//     without regard to case, which Go does not.
package calendar

import (
	"errors"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // the zone database inside the program: a shop's container may have none
	"unicode"

	"github.com/GeometerLabs/agents/go/internal/language"
)

const (
	msPerDay = 86_400_000
	maxTime  = 8_640_000_000_000_000 // TimeClip: the furthest instant a Date holds, in milliseconds either side of the epoch
)

// daysFromCivil is the days since 1970-01-01 of a proleptic Gregorian date (month 1-12).
func daysFromCivil(y, m, d int64) int64 {
	if m <= 2 {
		y--
	}
	era := y / 400
	if y < 0 {
		era = (y - 399) / 400
	}
	yoe := y - era*400
	mp := (m + 9) % 12
	doy := (153*mp+2)/5 + d - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return era*146097 + doe - 719468
}

// civilFromDays is the inverse: the year, month (1-12) and day of a count of days since the epoch.
func civilFromDays(z int64) (y, m, d int64) {
	z += 719468
	era := z / 146097
	if z < 0 {
		era = (z - 146096) / 146097
	}
	doe := z - era*146097
	yoe := (doe - doe/1460 + doe/36524 - doe/146096) / 365
	y = yoe + era*400
	doy := doe - (365*yoe + yoe/4 - yoe/100)
	mp := (5*doy + 2) / 153
	d = doy - (153*mp+2)/5 + 1
	if mp < 10 {
		m = mp + 3
	} else {
		m = mp - 9
	}
	if m <= 2 {
		y++
	}
	return
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

// dateUTC is Date.UTC(year, month-1, day, hour, minute): month may run past 12 or below 1 and day and the clock roll over, and a year 0 to 99 means 1900 to 1999 (the oddity of
// Date.UTC, which zonedToMs inherits). ok is false when the result is beyond a Date's range (NaN).
func dateUTC(year, month, day, hour, minute int64) (int64, bool) {
	if year >= 0 && year <= 99 {
		year += 1900
	}
	year += floorDiv(month-1, 12)
	month = ((month-1)%12+12)%12 + 1
	t := (daysFromCivil(year, month, 1)+day-1)*msPerDay + hour*3_600_000 + minute*60_000
	if t > maxTime || t < -maxTime {
		return 0, false
	}
	return t, true
}

// ISOString is new Date(ms).toISOString(): "2026-11-10T12:30:00.000Z", with a six-digit signed year outside 0 to 9999. A time beyond a Date's range is the RangeError JavaScript
// throws ("Invalid time value").
func ISOString(ms int64) (string, error) {
	if ms > maxTime || ms < -maxTime {
		return "", errors.New("Invalid time value")
	}
	days := floorDiv(ms, msPerDay)
	rest := ms - days*msPerDay
	y, m, d := civilFromDays(days)
	var year string
	switch {
	case y >= 0 && y <= 9999:
		year = pad(y, 4)
	case y < 0:
		year = "-" + pad(-y, 6)
	default:
		year = "+" + pad(y, 6)
	}
	return year + "-" + pad(m, 2) + "-" + pad(d, 2) + "T" + pad(rest/3_600_000, 2) + ":" + pad(rest/60_000%60, 2) + ":" + pad(rest/1000%60, 2) + "." + pad(rest%1000, 3) + "Z", nil
}

func pad(n int64, width int) string {
	s := strconv.FormatInt(n, 10)
	for len(s) < width {
		s = "0" + s
	}
	return s
}

// isoDate: the ECMAScript date-time string format as V8 reads it: a date (year, year-month or year-month-day), then optionally a T (or t, or a space), the time, and an offset (Z, z,
// +HH:MM or +HHMM; hours alone are NaN), or a Z straight after a bare date.
var isoDate = regexp.MustCompile(`^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|z|[+-]\d{2}:?\d{2})?|[Zz])?$`)

// ParseDate is Date.parse for the ISO 8601 forms: the milliseconds since the epoch, and false for NaN. A bare date is UTC, a date and time without an offset is read as UTC (see the
// file comment), seconds are optional, a fraction is cut to milliseconds (not rounded), 24:00:00 is the end of the day, a day 29 to 31 past the month's end ROLLS OVER into the next
// month ("2026-02-30" is 2 March, as V8 reads it) while 0 or 32 and up is NaN, and an hour or minute out of range is NaN. "-000000" is no year.
func ParseDate(s string) (int64, bool) {
	m := isoDate.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	num := func(x string) int64 { n, _ := strconv.ParseInt(x, 10, 64); return n }
	if m[1] == "-000000" {
		return 0, false
	}
	year := num(m[1])
	month, day := int64(1), int64(1)
	if m[2] != "" {
		month = num(m[2])
	}
	if m[3] != "" {
		day = num(m[3])
	}
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return 0, false
	}
	var hour, min, sec, frac int64
	if m[4] != "" {
		hour, min = num(m[4]), num(m[5])
		if m[6] != "" {
			sec = num(m[6])
		}
		if m[7] != "" {
			f := (m[7] + "000")[:3]
			frac = num(f)
			if hour == 24 && num(m[7]) != 0 {
				return 0, false
			}
		}
		if hour > 24 || min > 59 || sec > 59 || (hour == 24 && (min != 0 || sec != 0)) {
			return 0, false
		}
	}
	t := (daysFromCivil(year, month, 1)+day-1)*msPerDay + hour*3_600_000 + min*60_000 + sec*1000 + frac
	if z := m[8]; z != "" && z != "Z" && z != "z" {
		digits := strings.ReplaceAll(z[1:], ":", "")
		oh, om := num(digits[:2]), num(digits[2:])
		if oh > 23 || om > 59 {
			return 0, false
		}
		off := (oh*60 + om) * 60_000
		if z[0] == '-' {
			t += off
		} else {
			t -= off
		}
	}
	if t > maxTime || t < -maxTime {
		return 0, false
	}
	return t, true
}

// ---- Number(string) and String(value) ------------------------------------------------------------------------------------------

var decimalLiteral = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$`)

// JSNumber is Number(text): the text trimmed of JavaScript's whitespace, "" is 0, a decimal literal (with a fraction or exponent), a signed Infinity, or 0x / 0o / 0b digits; anything
// else is NaN (the result is NaN, ok true means a number came out, and it may still be infinite).
func JSNumber(text string) (float64, bool) {
	s := language.TrimJS(text)
	if s == "" {
		return 0, true
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1), true
	case "-Infinity":
		return math.Inf(-1), true
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
			n, ok := new(big.Int).SetString(s[2:], base)
			if !ok || strings.ContainsAny(s[2:], "_+-") {
				return 0, false
			}
			f, _ := new(big.Float).SetInt(n).Float64()
			return f, true
		}
	}
	if !decimalLiteral.MatchString(s) {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, false
	}
	return f, true
}

// JSString is String(v) for a decoded JSON value (json.Number for numbers): what `String(b.start)` gives in the free/busy reader, so a number or a list there reads as JavaScript
// reads it (a 2026 is the string "2026", which Date.parse takes as a year).
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case interface{ String() string }: // json.Number
		f, err := strconv.ParseFloat(x.String(), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return x.String()
		}
		return numberString(f)
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				parts[i] = JSString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// numberString is String(number): the shortest digits that read back to the same number, laid out by ECMAScript's rules (plain digits up to 1e21, then an exponent).
func numberString(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	e := strconv.FormatFloat(f, 'e', -1, 64) // d.ddddde+XX
	mant, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	x, _ := strconv.Atoi(exp)
	n := x + 1 // the decimal point sits after n digits
	k := len(digits)
	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	es := strconv.Itoa(n - 1)
	if n-1 >= 0 {
		es = "+" + es
	}
	if k == 1 {
		return sign + digits + "e" + es
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + es
}

// ---- zonedToMs -------------------------------------------------------------------------------------------------------------------

// zonedMidnight is time.ts zonedToMs for midnight of a date in a time zone (what an all-day event means), falling back to Date.UTC when the zone is not one Intl knows, as the
// TypeScript's try/catch does. Two passes settle zones whose offset changes near the guess; the clock is read to the minute, as Intl's formatToParts of minute-resolution fields is.
func zonedMidnight(year, month, day int64, zone string) int64 {
	asUTC, ok := dateUTC(year, month, day, 0, 0)
	if !ok {
		return 0 // Date.UTC would be NaN; no caller can reach it with a four-digit year
	}
	loc, err := location(zone)
	if err != nil {
		return asUTC
	}
	guess := asUTC
	for i := 0; i < 2; i++ {
		t := time.UnixMilli(guess).In(loc)
		shown, _ := dateUTC(int64(t.Year()), int64(t.Month()), int64(t.Day()), int64(t.Hour()), int64(t.Minute()))
		guess += asUTC - shown
	}
	return guess
}

func location(zone string) (*time.Location, error) {
	if zone == "" || zone == "Local" || strings.ContainsFunc(zone, unicode.IsSpace) { // Intl: a RangeError for each
		return nil, errors.New("not a time zone")
	}
	return time.LoadLocation(zone)
}
