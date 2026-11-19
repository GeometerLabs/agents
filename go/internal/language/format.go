package language

// How amounts, dates, times and phone numbers are written, per language: the Go twin of modules/language/format.ts (formatDate, formatTime, formatSlot, groupPhone,
// sentenceStart; formatInr is FormatInr in check.go). It is SHARED: the Bookings words use it now, Orders and Fees will, so a date is written one way by every Go template.
//
// The names of the weekdays and months and the words of each hour are DATA, formats.json, written by go/scripts/gen_bookings_words.ts from format.ts's own tables (it writes a date for
// each weekday and a time for each hour and checks the minutes). Intl is not in the path: format.ts writes them from tables, not from Intl. The two things that are Intl in TypeScript
// are done here without it: the time zone (Go's time package over the zone database the binary carries, as the Bookings rules do) and the rupee grouping (FormatInr).
//
// Where Go and JavaScript differ: sentenceStart upper-cases the first UTF-16 unit with toUpperCase, which can make two letters ("ß" becomes "SS"); Go's unicode.ToUpper keeps one
// rune, so the few letters with a longer upper case are listed in upperLong. A name that opens with a letter outside the BMP is a surrogate pair in JavaScript (charAt(0) is half of
// it, and toUpperCase leaves it); Go takes the whole rune, which has no upper case in those scripts either except Deseret and a few: a service named in one of them is not a case we meet.

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

//go:embed formats.json
var formatsJSON []byte

// Format is one language's way of writing a date and a time of day.
type Format struct {
	Weekdays []string          `json:"weekdays"` // 0 = Sunday, like Date#getDay()
	Months   []string          `json:"months"`   // January is index 0
	Comma    bool              `json:"comma"`    // a comma follows the weekday ("मंगलवार, 11 नवंबर"); English has none ("Tue 11 Nov")
	Time     map[string]string `json:"time"`     // by hour 0-23, with {mm} where the two minute digits go
}

var (
	formatsOnce sync.Once
	formats     map[string]*Format
)

// Formats returns the formats of a language ("en", "hi", "ml", "kn"); an unknown language is English, as the shop's settings never name another.
func Formats(lang string) *Format {
	formatsOnce.Do(func() {
		if err := json.Unmarshal(formatsJSON, &formats); err != nil {
			panic("formats.json is not readable: " + err.Error()) // embedded at build time, so this is a build fault
		}
	})
	if f, ok := formats[lang]; ok {
		return f
	}
	return formats["en"]
}

// Date is format.ts formatDate over a calendar date: "Tue 11 Nov", "मंगलवार, 11 नवंबर". The weekday is computed from the date, never passed in.
func (f *Format) Date(year, month, day int) string {
	wd := time.Date(year, time.Month(month), day, 12, 0, 0, 0, time.UTC).Weekday()
	comma := ""
	if f.Comma {
		comma = ","
	}
	return f.Weekdays[wd] + comma + " " + strconv.Itoa(day) + " " + f.Months[month-1]
}

// TimeOfDay is format.ts formatTime: "6:00 pm", "शाम 6:00 बजे".
func (f *Format) TimeOfDay(hour, minute int) string {
	mm := strconv.Itoa(minute)
	if minute < 10 {
		mm = "0" + mm
	}
	return strings.Replace(f.Time[strconv.Itoa(hour)], "{mm}", mm, 1)
}

// Slot is format.ts formatSlot: the date and the time of an instant in the business's time zone, "Tue 11 Nov, 6:00 pm".
func (f *Format) Slot(ms int64, loc *time.Location) string {
	t := time.UnixMilli(ms).In(loc)
	return f.Date(t.Year(), int(t.Month()), t.Day()) + ", " + f.TimeOfDay(t.Hour(), t.Minute())
}

// SlotDate and SlotTime are the two halves of Slot for an instant, as the lists of free times and the outgoing check use them.
func (f *Format) SlotDate(ms int64, loc *time.Location) string {
	t := time.UnixMilli(ms).In(loc)
	return f.Date(t.Year(), int(t.Month()), t.Day())
}

// SlotTime: see SlotDate.
func (f *Format) SlotTime(ms int64, loc *time.Location) string {
	t := time.UnixMilli(ms).In(loc)
	return f.TimeOfDay(t.Hour(), t.Minute())
}

// GroupPhone is format.ts groupPhone: "+91 98111 11111" for "+919811111111", anything else as it was. JavaScript's /^\+91(\d{5})(\d{5})$/u: \d is ASCII 0-9 only.
func GroupPhone(e164 string) string {
	if len(e164) != 13 || !strings.HasPrefix(e164, "+91") {
		return e164
	}
	for i := 3; i < 13; i++ {
		if e164[i] < '0' || e164[i] > '9' {
			return e164
		}
	}
	return "+91 " + e164[3:8] + " " + e164[8:]
}

// upperLong is the letters whose JavaScript toUpperCase is more than one letter (Unicode's SpecialCasing, the unconditional ones that Go's single-rune mapping does not make).
var upperLong = map[rune]string{'ß': "SS", 'ŉ': "ʼN", 'ǰ': "J̌", 'ﬀ': "FF", 'ﬁ': "FI", 'ﬂ': "FL", 'ﬃ': "FFI", 'ﬄ': "FFL", 'ﬅ': "ST", 'ﬆ': "ST"}

// SentenceStart is format.ts sentenceStart: the first letter capitalised in English ("Haircut on ..."); Hindi, Malayalam and Kannada have no capitals, so they are as they are.
func SentenceStart(text, lang string) string {
	if lang != "en" || text == "" {
		return text
	}
	r, n := utf8.DecodeRuneInString(text)
	if up, ok := upperLong[r]; ok {
		return up + text[n:]
	}
	return string(unicode.ToUpper(r)) + text[n:]
}
