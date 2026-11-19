// A refund a PERSON settled as made, told apart from a refund the payments service confirmed: modules/report/settled-by-word.ts (B75). What a template counts as "given back" is only
// what the payments service's own record confirmed; what a person at the server settled by their word (Guard's `already_done`) is counted on its own, with who said so. A person's
// settlement is a `refund` / `confirmed` line with `refs.confirmedBy` and no `refs.refundId`. This file only reads lines; how a document shows them is the presentation's (text.go).
//
// Two JavaScript behaviours are copied: `Number(refs.amountPaise)` reads a string the way JavaScript does (an empty or all-space string is 0, "0x10" is 16, "1e2" is 100; anything
// else that is not a number is NaN, which counts the line as missing its amount), and the rows are sorted by `<` on the person's name (by UTF-16 code unit).
package report

import (
	"math"
	"regexp"
	"sort"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// IsSettledByWord is isSettledByWord: a refund a person settled as made, by their word (no provider refund id). Such a line is never a refund made.
func IsSettledByWord(e accounting.Entry) bool {
	by := e.Refs["confirmedBy"]
	_, hasRefund := e.Refs["refundId"]
	return e.Action == "refund" && e.Outcome == "confirmed" && by != "" && !hasRefund
}

var (
	decimalRe = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)
	radixRe   = regexp.MustCompile(`^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$`)
)

// jsNumberOf is Number(string): NaN when the text is not a number JavaScript reads.
func jsNumberOf(s string) float64 {
	s = language.TrimJS(s)
	switch {
	case s == "":
		return 0
	case s == "Infinity" || s == "+Infinity":
		return math.Inf(1)
	case s == "-Infinity":
		return math.Inf(-1)
	case radixRe.MatchString(s):
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		u, err := strconv.ParseUint(s[2:], base, 64)
		if err != nil {
			return math.Inf(1) // too large for 64 bits: far past the safe range either way
		}
		return float64(u)
	case decimalRe.MatchString(s):
		f, err := strconv.ParseFloat(s, 64)
		if err != nil && !math.IsInf(f, 0) {
			return math.NaN()
		}
		return f
	}
	return math.NaN()
}

// SettledByWordOf is settledByWordOf: the settlements by a person's word among entries (the report passes the month's), grouped by who, each payment once, sorted by who so the signed
// bytes do not depend on the record's order. A line with no amount still counts, with nothing added, and is counted in missingAmounts so the report can say its total is short. An
// amount beyond 2^53 paise counts as missing (the TypeScript would add it as a double; no shop has one).
func SettledByWordOf(entries []accounting.Entry) (rows []SettledRow, missingAmounts int) {
	byWho := map[string]*SettledRow{}
	seen := map[string]bool{}
	for _, e := range entries {
		if !IsSettledByWord(e) {
			continue
		}
		key, ok := e.Refs["paymentId"] // by payment, not by line: two lines about one payment are one settlement
		if !ok {
			key = "seq-" + strconv.Itoa(e.Seq)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		by := e.Refs["confirmedBy"]
		row := byWho[by]
		if row == nil {
			row = &SettledRow{By: by}
			byWho[by] = row
		}
		row.Count++
		raw, has := e.Refs["amountPaise"]
		paise := math.NaN()
		if has {
			paise = jsNumberOf(raw)
		}
		if !math.IsNaN(paise) && !math.IsInf(paise, 0) && paise == math.Trunc(paise) && paise >= 0 && paise <= 1<<53 {
			row.Paise += int64(paise)
		} else {
			missingAmounts++
		}
	}
	for _, r := range byWho {
		rows = append(rows, *r)
	}
	sort.Slice(rows, func(i, j int) bool { return LessUTF16(rows[i].By, rows[j].By) })
	return rows, missingAmounts
}
