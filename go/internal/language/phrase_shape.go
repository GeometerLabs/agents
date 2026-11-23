package language

// The shapes of a date phrase and a time phrase (modules/language/dates.ts isDatePhrase and isTimePhrase), checked on a value that came from outside: a language model's
// answer is untrusted, so every template's CoerceIntent asks these and refuses a date or a time of any other shape instead of copying it. The checks were Bookings' own
// (intent.go) until 23 Nov 2026; Orders' copied any object. Both now ask this one place, as both TypeScript templates ask dates.ts.
//
// The value is JSON decoded to `any`, so a number is a float64: "whole" is a float64 with no fraction, as JavaScript's Number.isInteger (an infinity is not one).

import "math"

// wholeIn is Number.isInteger(v) && lo <= v <= hi.
func wholeIn(v any, lo, hi float64) bool {
	n, ok := v.(float64)
	return ok && n == math.Trunc(n) && !math.IsInf(n, 0) && n >= lo && n <= hi
}

// IsDatePhrase is dates.ts isDatePhrase: relative 0 to 2 days, a weekday 0 to 6 with "next", "this" or "plain", or a calendar day 1 to 31 of a month 1 to 12.
func IsDatePhrase(v any) bool {
	d, isObj := v.(map[string]any)
	if !isObj {
		return false
	}
	switch d["kind"] {
	case "relative":
		return d["offsetDays"] == 0.0 || d["offsetDays"] == 1.0 || d["offsetDays"] == 2.0
	case "weekday":
		return wholeIn(d["weekday"], 0, 6) && (d["which"] == "next" || d["which"] == "this" || d["which"] == "plain")
	case "calendar":
		return wholeIn(d["day"], 1, 31) && wholeIn(d["month"], 1, 12)
	}
	return false
}

// IsTimePhrase is dates.ts isTimePhrase: hour 0 to 23 and minute 0 to 59; with a period, "am" or "pm" and an hour 1 to 12 ("18:00 pm" would be hour 30). A period given as
// JSON null is not "undefined" in the TypeScript, so it is refused here as well.
func IsTimePhrase(v any) bool {
	t, isObj := v.(map[string]any)
	if !isObj || !wholeIn(t["hour"], 0, 23) || !wholeIn(t["minute"], 0, 59) {
		return false
	}
	p, hasPeriod := t["period"]
	return !hasPeriod || ((p == "am" || p == "pm") && wholeIn(t["hour"], 1, 12))
}
