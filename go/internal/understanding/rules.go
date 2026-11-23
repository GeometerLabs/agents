package understanding

// What every template's rule parser reads the same way in a customer's words (modules/understanding/rules.ts): STOP, a trick ("ignore your rules"), the language a message is
// written in, and a price written in it. The patterns are the TypeScript's own, generated into language/patterns.json (rules.*) by go/scripts/gen_patterns.ts; this file only
// tries them in the TypeScript's order. Yes, no and a greeting are the patterns rules.yes, rules.no and rules.greeting, used as they are. Nothing here decides anything: amounts,
// hours and slots are decided by the template's limits.

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

var (
	devanagari = regexp.MustCompile(`[\x{0900}-\x{097F}]`)
	malayalam  = regexp.MustCompile(`[\x{0D00}-\x{0D7F}]`)
	kannada    = regexp.MustCompile(`[\x{0C80}-\x{0CFF}]`)
	latinWord  = regexp.MustCompile(`[a-z]{4,}`)
)

// DetectLanguage is rules.ts `detectLanguage`: by script first (Devanagari, Malayalam, Kannada) on the words as they came, then by Latin-letter words after Canon; "" when the
// words do not say (a bare "ok").
func DetectLanguage(text string) string {
	t := language.Canon(text)
	switch {
	case devanagari.MatchString(text):
		return "hi"
	case malayalam.MatchString(text):
		return "ml"
	case kannada.MatchString(text):
		return "kn"
	case language.P("rules.roman_hindi").Test(t):
		return "hi"
	case language.P("rules.roman_malayalam").Test(t):
		return "ml"
	case language.P("rules.roman_kannada").Test(t):
		return "kn"
	case language.P("rules.english").Test(t) || latinWord.MatchString(t):
		return "en"
	}
	return ""
}

// FindOffer is rules.ts `findOffer` on words after Canon: a price the customer proposed, in rupees (-1 when none). Cues are explicit (₹, Rs, "में", "for"), so a time like "6 बजे"
// is never a price. Each pattern in turn, its first match that is big enough (in "ಸಂಜೆ 6ಕ್ಕೆ ... 300ಕ್ಕೆ" the 6 is an hour); "free" and its translations are 0.
func FindOffer(t string) int64 {
	offers := language.Offers()
	for i, re := range language.Ps("rules.offer.") {
		text := t
		if offers[i].SkipWrittenDate {
			text = language.BlankWrittenDate(t) // "ನವೆಂಬರ್ 28ಕ್ಕೆ" is a date, not a price of 28
		}
		for _, m := range re.Global(true).All(text) {
			// Number(digits without commas): a float, as JavaScript reads it, so a run of digits too long for an integer is simply too big
			n, err := strconv.ParseFloat(strings.ReplaceAll(m.Group(1), ",", ""), 64)
			if err == nil && n >= offers[i].Minimum && n <= 1_000_000 {
				return int64(n)
			}
		}
	}
	if language.P("rules.free").Test(t) {
		return 0
	}
	return -1
}

// AsksDiscount is rules.ts `asksDiscount` on words after Canon (E1, 24 Nov 2026): a numberless ask for a lower price ("any discount?", "कुछ कम करो"), in the four languages. The
// parsers set it only when no price was named. The pattern is rules.ts DISCOUNT_ASK_RE, handed over by go/scripts/gen_patterns.ts.
func AsksDiscount(t string) bool { return language.P("rules.discount_ask").Test(t) }

// IsStop is rules.ts `isStop` on words after Canon: "stop" on its own or with a few words around it, never a sentence that merely contains the word.
func IsStop(t string) bool {
	n := len(strings.FieldsFunc(language.TrimJS(t), language.IsJSSpace)) // t.trim().split(/\s+/u).filter(Boolean)
	return (n <= 4 && language.P("rules.stop_words").Test(t)) || (n <= 5 && (language.P("rules.stop_hindi").Test(t) || language.P("rules.stop_dravidian").Test(t)))
}

// IsOverrideAttempt is rules.ts `isOverrideAttempt` on words after Canon: did the message try to change the agent's rules?
func IsOverrideAttempt(t string) bool {
	for _, re := range language.Ps("rules.override.") {
		if re.Test(t) {
			return true
		}
	}
	return false
}
