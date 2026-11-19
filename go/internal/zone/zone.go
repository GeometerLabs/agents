// Package zone is modules/core/time.ts in Go: instants are epoch milliseconds, "local" values are read in a shop's time zone. The TypeScript uses Intl only to convert between the
// two; here Go's time package does it, from the zone database inside the binary (time/tzdata). The functions copy the TypeScript line by line, including zonedToMs's two-pass
// guess (which settles zones whose offset changes near the guess, and decides which side of a gap or an overlap a wall-clock time lands on), so the books, the report and the
// document numbers cut the record at the same moments as the TypeScript does. The tests compare against vectors the TypeScript wrote (scripts/gen_locale.ts).
package zone

import (
	"fmt"
	"sync"
	"time"
	_ "time/tzdata" // the zone database in the binary: a shop's time zone needs nothing from the machine
)

// Date is core/time.ts LocalDate (month 1 to 12).
type Date struct{ Year, Month, Day int }

// Parts is core/time.ts LocalParts: the date and the 24-hour clock, with the weekday (0 = Sunday).
type Parts struct {
	Date
	Hour, Minute, Weekday int
}

const (
	Minute int64 = 60_000
	Hour   int64 = 3_600_000
	Day    int64 = 24 * Hour
)

var locations sync.Map // name -> *time.Location

func location(name string) *time.Location {
	if l, ok := locations.Load(name); ok {
		return l.(*time.Location)
	}
	l, err := time.LoadLocation(name)
	if err != nil {
		// JavaScript's Intl.DateTimeFormat throws a RangeError for a bad name; a shop's settings are checked at setup, so reaching here is a programming fault
		panic(fmt.Sprintf("invalid time zone: %q", name))
	}
	locations.Store(name, l)
	return l
}

// Valid is isValidTimeZone.
func Valid(name string) bool {
	defer func() { _ = recover() }()
	location(name)
	return true
}

// LocalParts is localParts: the calendar date and clock time at an instant, in a time zone.
func LocalParts(ms int64, timeZone string) Parts {
	t := time.UnixMilli(ms).In(location(timeZone))
	d := Date{t.Year(), int(t.Month()), t.Day()}
	return Parts{Date: d, Hour: t.Hour(), Minute: t.Minute(), Weekday: WeekdayOf(d)}
}

// utc is Date.UTC(year, month-1, day, hour, minute) in milliseconds; like JavaScript's, a day or month out of range rolls over.
func utc(y, m, d, h, mi int) int64 {
	return time.Date(y, time.Month(m), d, h, mi, 0, 0, time.UTC).UnixMilli()
}

// WeekdayOf is weekdayOf: 0 = Sunday ... 6 = Saturday.
func WeekdayOf(d Date) int {
	return int(time.Date(d.Year, time.Month(d.Month), d.Day, 0, 0, 0, 0, time.UTC).Weekday())
}

// AddDays is addDays: UTC date arithmetic, so month ends and leap days roll over with no time zone in it.
func AddDays(d Date, days int) Date {
	t := time.Date(d.Year, time.Month(d.Month), d.Day+days, 0, 0, 0, 0, time.UTC)
	return Date{t.Year(), int(t.Month()), t.Day()}
}

// DaysBetween is daysBetween: whole days from a to b (positive when b is later).
func DaysBetween(a, b Date) int {
	return int((utc(b.Year, b.Month, b.Day, 0, 0) - utc(a.Year, a.Month, a.Day, 0, 0)) / int64(Day))
}

// ZonedToMs is zonedToMs: the instant at which the clock in a time zone shows this date and time.
func ZonedToMs(d Date, hour, minute int, timeZone string) int64 {
	asUTC := utc(d.Year, d.Month, d.Day, hour, minute)
	guess := asUTC
	for i := 0; i < 2; i++ { // a second pass settles zones whose offset changes near the guess
		p := LocalParts(guess, timeZone)
		shown := utc(p.Year, p.Month, p.Day, p.Hour, p.Minute)
		guess += asUTC - shown
	}
	return guess
}
