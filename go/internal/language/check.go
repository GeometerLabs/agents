package language

// The outgoing check (modules/language/check.ts `checkText`): read the FINAL text of a message, find every amount, date, time, number and link in it, and compare each with what
// the record holds (Facts). Anything the record cannot explain fails the check, and a message that fails is not sent (fail closed). The patterns are check.ts's own sources
// (patterns.json). The problems are check.ts's sentences, word for word, because the record keeps them.
//
// Not here: the moments a message may state (`shownMs`, `momentsMs`), which only a booking's or a free-time list's messages carry; the owner's talk of a listings-only shop has none,
// so every date or time in it is unexplained, as it is in TypeScript with no moments.

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Facts is CheckFacts without the moments.
type Facts struct {
	AmountsInr []float64
	Counts     []float64
	Links      []string
	Literals   []string
}

// CheckText returns the problems (none: the text may go).
func CheckText(final string, f Facts) []string {
	amounts, counts, urls := map[float64]bool{}, map[float64]bool{}, map[string]bool{}
	for _, v := range f.AmountsInr {
		amounts[v] = true
	}
	list := make([]float64, 0, len(amounts))
	for v := range amounts {
		list = append(list, v)
	}
	sort.Float64s(list)
	for _, v := range f.Counts {
		counts[v] = true
	}
	for _, l := range f.Links {
		urls[strings.ToLower(l)] = true
	}
	var lits []string
	for _, l := range f.Literals {
		if l != "" {
			lits = append(lits, Plain(l))
		}
	}
	sort.SliceStable(lits, func(i, j int) bool { return UTF16Len(lits[i]) > UTF16Len(lits[j]) })

	var problems []string
	text := Plain(final)
	trailing := P("check.trailing")
	upi := P("check.upi").All(text)
	for _, u := range upi {
		cleaned := trailing.Replace(u.Group(0), "")
		if !urls[strings.ToLower(cleaned)] {
			problems = append(problems, fmt.Sprintf(`The message has the UPI link "%s", which is not the payment request in the record.`, cleaned))
		}
	}
	text = mask(text, upi)
	for _, lit := range lits {
		re, err := Compile(jsEscape(lit), "giu")
		if err != nil { // never for an escaped literal; if it were, the check fails closed rather than stop the step
			problems = append(problems, "The message could not be checked against the record.")
			continue
		}
		text = re.ReplaceFunc(text, func(m *Match) string { return strings.Repeat(" ", UTF16Len(m.Group(0))) })
	}
	links := P("check.url").All(text)
	for _, u := range links {
		cleaned := trailing.Replace(u.Group(0), "")
		if !urls[strings.ToLower(cleaned)] {
			problems = append(problems, fmt.Sprintf(`The message has the link "%s", which is not the payment link in the record.`, cleaned))
		}
	}
	text = mask(text, links)
	dates, times := P("check.date").All(text), P("check.time").All(text)
	for _, d := range dates {
		problems = append(problems, fmt.Sprintf(`The message says the date "%s", but the record has no date for this conversation.`, d.Group(0)))
	}
	for _, t := range times {
		problems = append(problems, fmt.Sprintf(`The message says the time "%s", but the record has no time for this conversation.`, t.Group(0)))
	}
	text = mask(text, append(dates, times...))
	money := P("check.amount").All(text)
	for _, m := range money {
		v, _ := strconv.ParseFloat(strings.ReplaceAll(m.Group(1), ",", ""), 64)
		if !amounts[v] {
			record := "no amounts for this conversation"
			if len(list) > 0 {
				parts := make([]string, len(list))
				for i, a := range list {
					parts[i] = FormatInr(a)
				}
				record = strings.Join(parts, ", ")
			}
			problems = append(problems, fmt.Sprintf("The message says %s, but the record only has %s.", FormatInr(v), record))
		}
	}
	text = mask(text, money)
	for _, d := range digitsRe.FindAllString(text, -1) {
		v, _ := strconv.ParseFloat(d, 64)
		if !counts[v] {
			problems = append(problems, fmt.Sprintf("The message has the number %s, which is not in the record for this conversation.", d))
		}
	}
	if P("check.quantity_word").Test(text) || P("check.quantity_stem").Test(text) {
		problems = append(problems, "The message spells out a quantity in words (hundred, thousand, सौ, हज़ार, നൂറ്, ನೂರು ...), which cannot be checked against the record.")
	}
	return dedupe(problems)
}

var digitsRe = regexp.MustCompile(`\d+`)

// mask is check.ts `mask`: each match replaced by as many spaces as its UTF-16 length.
func mask(text string, ms []*Match) string {
	sort.Slice(ms, func(i, j int) bool { return ms[i].Start() > ms[j].Start() })
	for _, m := range ms {
		text = text[:m.Start()] + strings.Repeat(" ", UTF16Len(text[m.Start():m.End()])) + text[m.End():]
	}
	return text
}

// jsEscape is check.ts `escapeRe`: the characters a JavaScript pattern gives a meaning, escaped.
func jsEscape(s string) string {
	var b strings.Builder
	for _, r := range s {
		if strings.ContainsRune(`.*+?^${}()|[]\`, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func dedupe(xs []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// FormatInr is format.ts `formatInr`: "₹" and JavaScript's toLocaleString("en-IN") (Indian grouping: the last three digits, then pairs; at most three decimals, rounded half away
// from zero as ICU does, trailing zeros dropped).
func FormatInr(rupees float64) string {
	neg := rupees < 0
	r := math.Abs(rupees)
	s := strconv.FormatFloat(math.Round(r*1000)/1000, 'f', 3, 64)
	whole, frac, _ := strings.Cut(s, ".")
	frac = strings.TrimRight(frac, "0")
	var g string
	if len(whole) <= 3 {
		g = whole
	} else {
		g = whole[len(whole)-3:]
		rest := whole[:len(whole)-3]
		for len(rest) > 2 {
			g = rest[len(rest)-2:] + "," + g
			rest = rest[:len(rest)-2]
		}
		g = rest + "," + g
	}
	if frac != "" {
		g += "." + frac
	}
	if neg {
		g = "-" + g
	}
	return "₹" + g
}
