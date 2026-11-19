// Package locale is the part of modules/language/format.ts the books, the documents and the report write with: the month and weekday names and the day-part words in four languages
// (names.json, made from the TypeScript by scripts/gen_locale.ts, never retyped), formatDate, formatTime, and the rupee text. The assistant package has its own copies packed with its
// words; the books must not import the assistant (the layering is language <- memory <- understanding <- assistant <- runtime), so this is the small shared part for them.
package locale

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

//go:embed names.json
var namesJSON []byte

var names struct {
	Months   map[string][]string          `json:"months"`
	Weekdays map[string][]string          `json:"weekdays"`
	DayParts map[string]map[string]string `json:"dayParts"`
}

func init() {
	if err := json.Unmarshal(namesJSON, &names); err != nil {
		panic("locale/names.json is not JSON: " + err.Error())
	}
}

// Languages is languages.ts LANGUAGES.
var Languages = []string{"en", "hi", "ml", "kn"}

// Month is MONTH_NAMES[language][month-1] (month 1 to 12).
func Month(language string, month int) string { return names.Months[language][month-1] }

// Weekday is WEEKDAY_NAMES[language][weekday] (0 = Sunday).
func Weekday(language string, weekday int) string { return names.Weekdays[language][weekday] }

// FormatDate is formatDate: "Tue 11 Nov" or "मंगलवार, 11 नवंबर"; the weekday is computed from the date.
func FormatDate(d zone.Date, language string) string {
	w := Weekday(language, zone.WeekdayOf(d))
	m := Month(language, d.Month)
	if language == "en" {
		return w + " " + strconv.Itoa(d.Day) + " " + m
	}
	return w + ", " + strconv.Itoa(d.Day) + " " + m
}

func dayPart(hour int) string {
	switch {
	case hour >= 5 && hour < 12:
		return "morning"
	case hour >= 12 && hour < 16:
		return "noon"
	case hour >= 16 && hour < 20:
		return "evening"
	}
	return "night"
}

// FormatTime is formatTime: "6:00 pm", "शाम 6:00 बजे", "വൈകുന്നേരം 6:00", "ಸಂಜೆ 6:00".
func FormatTime(hour, minute int, language string) string {
	mm := strconv.Itoa(minute)
	if len(mm) < 2 {
		mm = "0" + mm
	}
	h12 := hour % 12
	if h12 == 0 {
		h12 = 12
	}
	if language == "en" {
		ampm := "pm"
		if hour < 12 {
			ampm = "am"
		}
		return strconv.Itoa(h12) + ":" + mm + " " + ampm
	}
	clock := names.DayParts[language][dayPart(hour)] + " " + strconv.Itoa(h12) + ":" + mm
	if language == "hi" {
		return clock + " बजे"
	}
	return clock
}

// group is the en-IN grouping of a non-negative integer's digits: the last three, then pairs (12,34,567).
func group(digits string) string {
	if len(digits) <= 3 {
		return digits
	}
	g := digits[len(digits)-3:]
	rest := digits[:len(digits)-3]
	for len(rest) > 2 {
		g = rest[len(rest)-2:] + "," + g
		rest = rest[:len(rest)-2]
	}
	return rest + "," + g
}

// FormatInrWhole is formatInr for a whole number of rupees: "₹" and toLocaleString("en-IN"): "₹1,25,000", and "₹-5" for a negative number as JavaScript writes it.
func FormatInrWhole(rupees int64) string {
	if rupees < 0 {
		return "₹-" + group(strconv.FormatInt(-rupees, 10))
	}
	return "₹" + group(strconv.FormatInt(rupees, 10))
}

// Inr is owner-money-render.ts `inr`: "₹1,200", or "₹1,200.50" when the paise are not whole rupees, by integer arithmetic. `Math.trunc(paise / 100)` of a negative amount under
// one rupee is -0, which toLocaleString writes "-0", so that case is copied ("₹-0.50").
func Inr(paise int64) string {
	rupees := paise / 100 // Go truncates towards zero, as Math.trunc does
	rest := paise % 100
	if rest < 0 {
		rest = -rest
	}
	text := FormatInrWhole(rupees)
	if rupees == 0 && paise < 0 {
		text = "₹-0"
	}
	if rest == 0 {
		return text
	}
	return text + "." + strings.Repeat("0", 2-len(strconv.FormatInt(rest, 10))) + strconv.FormatInt(rest, 10)
}
