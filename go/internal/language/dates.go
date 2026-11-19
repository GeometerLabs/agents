package language

// Date phrases the owner typed, in Hindi, English, Malayalam or Kannada (modules/language/dates.ts `findDatePhrase` and `resolveDate`), with the TypeScript's own patterns
// (patterns.json). The rules for the loose phrases are dates.ts's, word for word: "today", "tomorrow", "the day after"; "next Tuesday" is the Tuesday of the next calendar week
// (weeks run Monday to Sunday); "this Tuesday" the one of this week, today included, or the next if it has passed; a plain "Tuesday" the first one AFTER today; a written date
// ("11 nov", "nov 11", "10 നവംബർ") the next time it comes round. The time phrases of dates.ts (a booking move's) are not here: a listings-only shop reads none.

import (
	"regexp"
	"strconv"
	"time"
)

// DatePhrase is dates.ts `DatePhrase`: Kind "relative" (Offset 0, 1 or 2), "weekday" (Weekday 0 = Sunday; Which "next", "this" or "plain") or "calendar" (Day, Month).
type DatePhrase struct {
	Kind    string
	Offset  int
	Weekday int
	Which   string
	Day     int
	Month   int
}

var (
	// findWrittenDate's two inline patterns (dates.ts); `after`'s look-ahead (not a digit, not a time word) is checked by hand: a shorter day number would fail it too.
	dayBefore = regexp.MustCompile(`(\d{1,2})(?:st|nd|rd|th)?[` + JSSpace + `]*(?:of[` + JSSpace + `]+)?$`)
	dayAfter  = regexp.MustCompile(`^[` + JSSpace + `]*(\d{1,2})`)
	timeWord  = regexp.MustCompile(`^[` + JSSpace + `]*(?::|am|pm|बजे|മണി|ಗಂಟೆ)`)
)

// writtenDate is dates.ts `findWrittenDate`: for each month in turn, its first mention with a day number before or after it, the day 1 to 31. A month name alone is a word ("may").
func writtenDate(text string) (day, month int, ok bool) {
	for m := 1; m <= 12; m++ {
		hit := P("dates.month." + strconv.Itoa(m)).Find(text)
		if hit == nil {
			continue
		}
		var digits string
		if b := dayBefore.FindStringSubmatch(text[:hit.Start()]); b != nil {
			digits = b[1]
		} else if a := dayAfter.FindStringSubmatchIndex(text[hit.End():]); a != nil {
			rest := text[hit.End()+a[3]:]
			if !(len(rest) > 0 && rest[0] >= '0' && rest[0] <= '9') && !timeWord.MatchString(rest) {
				digits = text[hit.End()+a[2] : hit.End()+a[3]]
			}
		}
		if n, err := strconv.Atoi(digits); err == nil && n >= 1 && n <= 31 {
			return n, m, true
		}
	}
	return 0, 0, false
}

// FindDatePhrase is dates.ts `findDatePhrase`: the first date phrase in the text, or nil. A word for yesterday is taken out first; then a written date, the day after tomorrow,
// tomorrow, today, and a weekday (with "next" or "this" just before it), in that order.
func FindDatePhrase(raw string) *DatePhrase {
	text := P("dates.yesterday").Replace(Canon(raw), " ")
	if d, m, ok := writtenDate(text); ok {
		return &DatePhrase{Kind: "calendar", Day: d, Month: m}
	}
	for _, rel := range []struct {
		name   string
		offset int
	}{{"dates.day_after", 2}, {"dates.tomorrow", 1}, {"dates.today", 0}} {
		if P(rel.name).Test(text) {
			return &DatePhrase{Kind: "relative", Offset: rel.offset}
		}
	}
	for w := 0; w < 7; w++ {
		hit := P("dates.weekday." + strconv.Itoa(w)).Find(text)
		if hit == nil {
			continue
		}
		before := text[:hit.Start()]
		which := "plain"
		if P("dates.next").Test(before) {
			which = "next"
		} else if P("dates.this").Test(before) {
			which = "this"
		}
		return &DatePhrase{Kind: "weekday", Weekday: w, Which: which}
	}
	return nil
}

// ResolveDate is dates.ts `resolveDate`: the calendar date a phrase names, seen from `now` in the shop's zone; ok is false for a date that does not exist (31 November).
// The weekday rules are TypeScript's: weeks run Monday to Sunday.
func ResolveDate(p DatePhrase, now time.Time) (y int, m time.Month, d int, ok bool) {
	ty, tm, td := now.Date()
	at := func(offset int) (int, time.Month, int, bool) {
		t := time.Date(ty, tm, td+offset, 12, 0, 0, 0, time.UTC)
		return t.Year(), t.Month(), t.Day(), true
	}
	switch p.Kind {
	case "relative":
		return at(p.Offset)
	case "calendar":
		// time.Date rolls 31 November over into December, as Date.UTC does in core/time.ts `daysBetween`: the comparison is TypeScript's
		year := ty
		if time.Date(year, time.Month(p.Month), p.Day, 0, 0, 0, 0, time.UTC).Before(time.Date(ty, tm, td, 0, 0, 0, 0, time.UTC)) {
			year++ // already gone this year: next year
		}
		if time.Date(year, time.Month(p.Month), p.Day, 0, 0, 0, 0, time.UTC).Month() != time.Month(p.Month) {
			return 0, 0, 0, false
		}
		return year, time.Month(p.Month), p.Day, true
	}
	monday := func(w int) int { return (w + 6) % 7 }
	target, today := monday(p.Weekday), monday(int(now.Weekday()))
	var offset int
	switch p.Which {
	case "next":
		offset = 7 - today + target
	case "this":
		offset = target - today
		if target < today {
			offset += 7
		}
	default:
		offset = (target - today + 7) % 7
		if offset == 0 {
			offset = 7
		}
	}
	return at(offset)
}
