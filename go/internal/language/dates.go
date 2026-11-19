package language

// Date phrases the owner typed, in Hindi, English, Malayalam or Kannada (modules/language/dates.ts `findDatePhrase` and `resolveDate`), with the TypeScript's own patterns
// (patterns.json). The rules for the loose phrases are dates.ts's, word for word: "today", "tomorrow", "the day after"; "next Tuesday" is the Tuesday of the next calendar week
// (weeks run Monday to Sunday); "this Tuesday" the one of this week, today included, or the next if it has passed; a plain "Tuesday" the first one AFTER today; a written date
// ("11 nov", "nov 11", "10 നവംബർ") the next time it comes round. A customer's time of day (dates.ts `findTimePhrase`) is FindTimePhrase.

import (
	"regexp"
	"strconv"
	"strings"
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

// JSON is the phrase in dates.ts's own shape ({"kind":"relative","offsetDays":1}, ...), as an Intent carries it.
func (p DatePhrase) JSON() map[string]any {
	switch p.Kind {
	case "relative":
		return map[string]any{"kind": p.Kind, "offsetDays": p.Offset}
	case "weekday":
		return map[string]any{"kind": p.Kind, "weekday": p.Weekday, "which": p.Which}
	}
	return map[string]any{"kind": p.Kind, "day": p.Day, "month": p.Month}
}

var (
	// findWrittenDate's two inline patterns (dates.ts); `after`'s look-ahead (not a digit, not a time word) is checked by hand: a shorter day number would fail it too.
	dayBefore = regexp.MustCompile(`(\d{1,2})(?:st|nd|rd|th)?[` + JSSpace + `]*(?:of[` + JSSpace + `]+)?$`)
	dayAfter  = regexp.MustCompile(`^[` + JSSpace + `]*(\d{1,2})`)
	timeWord  = regexp.MustCompile(`^[` + JSSpace + `]*(?::|am|pm|बजे|മണി|ಗಂಟೆ)`)
)

// writtenDate is dates.ts `findWrittenDate`: for each month in turn, its first mention with a day number before or after it, the day 1 to 31. A month name alone is a word ("may").
// start and end are where the date sits in the text (bytes), for BlankWrittenDate.
func writtenDate(text string) (day, month, start, end int, ok bool) {
	for m := 1; m <= 12; m++ {
		hit := P("dates.month." + strconv.Itoa(m)).Find(text)
		if hit == nil {
			continue
		}
		var digits string
		if b := dayBefore.FindStringSubmatchIndex(text[:hit.Start()]); b != nil {
			digits, start, end = text[b[2]:b[3]], b[0], hit.End()
		} else if a := dayAfter.FindStringSubmatchIndex(text[hit.End():]); a != nil {
			rest := text[hit.End()+a[3]:]
			if !(len(rest) > 0 && rest[0] >= '0' && rest[0] <= '9') && !timeWord.MatchString(rest) {
				digits, start, end = text[hit.End()+a[2]:hit.End()+a[3]], hit.Start(), hit.End()+a[3]
			}
		}
		if n, err := strconv.Atoi(digits); err == nil && n >= 1 && n <= 31 {
			return n, m, start, end, true
		}
	}
	return 0, 0, 0, 0, false
}

// BlankWrittenDate is dates.ts `blankWrittenDate`: the text with a written date ("നവംബർ 10") blanked out, so its day number is not read as an hour or a price ("10ಕ್ಕೆ"). As in
// JavaScript, one space for each UTF-16 unit of what is blanked.
func BlankWrittenDate(text string) string {
	if _, _, start, end, ok := writtenDate(text); ok {
		return text[:start] + strings.Repeat(" ", UTF16Len(text[start:end])) + text[end:]
	}
	return text
}

// FindDatePhrase is dates.ts `findDatePhrase`: the first date phrase in the text, or nil. A word for yesterday is taken out first; then a written date, the day after tomorrow,
// tomorrow, today, and a weekday (with "next" or "this" just before it), in that order.
func FindDatePhrase(raw string) *DatePhrase {
	text := P("dates.yesterday").Replace(Canon(raw), " ")
	if d, m, _, _, ok := writtenDate(text); ok {
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

// TimePhrase is dates.ts `TimePhrase`: a time as written. Hour is 1-12 when Period ("am" or "pm") is given, otherwise as typed (0-23).
type TimePhrase struct {
	Hour, Minute int
	Period       string
}

// JSON is the phrase in dates.ts's own shape ({"hour":6,"minute":0,"period":"pm"}; no period member when none was said).
func (t TimePhrase) JSON() map[string]any {
	m := map[string]any{"hour": t.Hour, "minute": t.Minute}
	if t.Period != "" {
		m["period"] = t.Period
	}
	return m
}

// FindTimePhrase is dates.ts `findTimePhrase`: the first time of day in the message, or nil ("6pm", "6:30 pm", "18:00", "6 बजे", "शाम 6 बजे", "evening 6", "വൈകുന്നേരം 6
// മണിക്ക്", "ಸಂಜೆ 6 ಗಂಟೆಗೆ"), with the TypeScript's patterns tried in its order. Without am or pm, an hour of 1 to 12 takes its half of the day from a word for a part of the day,
// not counting a greeting ("good morning" is not a time).
func FindTimePhrase(raw string) *TimePhrase {
	text := Canon(raw)
	var found *TimePhrase
	if m := P("dates.time.clock").Find(text); m != nil {
		found = &TimePhrase{Hour: atoi(m.Group(1)), Minute: atoi(m.Group(2))}
		if p := m.Group(3); p != "" {
			found.Period = map[bool]string{true: "am", false: "pm"}[p[0] == 'a']
		}
	} else if m := P("dates.time.ampm").Find(text); m != nil {
		found = &TimePhrase{Hour: atoi(m.Group(1)), Period: map[bool]string{true: "am", false: "pm"}[m.Group(2)[0] == 'a']}
	} else {
		m := P("dates.time.clock_word").Find(text)
		if m == nil {
			m = P("dates.time.kannada_hour").Find(BlankWrittenDate(text)) // "ನವೆಂಬರ್ 10ಕ್ಕೆ" is the 10th, not ten o'clock
		}
		for _, name := range []string{"dates.time.period_then_hour", "dates.time.hour_then_period", "dates.time.at_hour"} {
			if m != nil {
				break
			}
			m = P(name).Find(text)
		}
		if m != nil {
			found = &TimePhrase{Hour: atoi(m.Group(1))}
			if m.Group(2) != "" {
				found.Minute = atoi(m.Group(2))
			}
		}
	}
	if found == nil || found.Hour > 23 || found.Minute > 59 {
		return nil
	}
	if found.Period == "" && found.Hour >= 1 && found.Hour <= 12 {
		plain := P("dates.greeting_with_time").Replace(text, " ")
		for _, kind := range []string{"morning", "afternoon", "evening", "night"} { // PERIOD_WORD_LISTS's order
			if !P("dates.period." + kind).Test(plain) {
				continue
			}
			switch {
			case kind == "morning":
				found.Period = "am"
			case kind == "afternoon" || kind == "evening":
				found.Period = "pm"
			case found.Hour >= 6 && found.Hour <= 11:
				found.Period = "pm" // night: 8 is 8 pm, but 12 and 2 are after midnight
			default:
				found.Period = "am"
			}
			break
		}
	}
	return found
}

// atoi reads the digits a pattern took (ASCII: `\d` is ASCII in JavaScript and in RE2, and Canon has turned the Indian digits into them).
func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
