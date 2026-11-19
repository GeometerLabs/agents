// Document numbers: one gap-free series per document type, per shop, per Indian financial year (modules/accounting/numbers.ts).
//
// A number is `<series>/<yy-yy>/<n>`, e.g. `RCT/26-27/0007` (CGST Rules r.46(b): consecutive, at most 16 characters, letters, digits, "-" and "/"). It is worked out from the record and never
// kept in a counter, because the record is the only memory saved in the same transaction as the step that issues the document: the next number is the highest one in the record for that
// series and year, plus one. After a `restored` entry (the shop's data came back from a snapshot, so documents a customer holds may be missing from the record) each series jumps on by
// RestoreDocGap, and the numbers skipped are listed in the accountant's export. Where Go differs from the TypeScript: `\d` is ASCII in both (the `u` flag), `$` matches only at the end in both,
// and `Date.parse` is ParseISO (jsnum.go).
package accounting

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// Series is RCT (a receipt for money received), BILL (a bill, or a bill of supply for a composition shop) or CN (a refund note).
type Series string

// SeriesAll is SERIES, in order.
var SeriesAll = []Series{"RCT", "BILL", "CN"}

const (
	// RestoreDocGap is how far a series moves on after a restore: more documents than a busy shop issues in the 30 days a snapshot is kept.
	RestoreDocGap = 10_000
	// RestoredAction is the record's entry for a restore (modules/runtime/restored.ts).
	RestoredAction = "restored"
	// MaxNumberLength is rule 46(b): at most 16 characters.
	MaxNumberLength = 16
)

var numberRE = regexp.MustCompile(`^(RCT|BILL|CN)/(\d{2})-(\d{2})/(\d{4,6})$`)

// DocNumber is numbers.ts DocNumber.
type DocNumber struct {
	Series Series
	FY     string
	N      int64
}

// FYOf is fyOf: the financial year a moment falls in, in the shop's time zone, as "26-27".
func FYOf(ms int64, timeZone string) string {
	p := zone.LocalParts(ms, timeZone)
	start := p.Year - 1
	if p.Month >= 4 {
		start = p.Year
	}
	return fmt.Sprintf("%02d-%02d", ((start%100)+100)%100, (((start+1)%100)+100)%100)
}

// FormatNumber is formatNumber: "RCT/26-27/0007", or the TypeScript's error when the number would pass 16 characters or is not 1 or more.
func FormatNumber(d DocNumber) (string, error) {
	text := string(d.Series) + "/" + d.FY + "/" + padStart(strconv.FormatInt(d.N, 10), 4)
	if !IsSafeInteger(float64(d.N)) || d.N < 1 || len(text) > MaxNumberLength {
		return "", fmt.Errorf("The document number %s is not allowed: a number is 1 or more and at most %d characters long (GST rule 46(b)).", text, MaxNumberLength)
	}
	return text, nil
}

// padStart is String.prototype.padStart(n, "0"): zeros in front of the text itself, so a "-5" becomes "00-5" as in JavaScript.
func padStart(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return strings.Repeat("0", n-len(s)) + s
}

// mustNumber is FormatNumber where the caller has already made the number valid (a number read back from the record).
func mustNumber(d DocNumber) string {
	s, err := FormatNumber(d)
	if err != nil {
		panic(err)
	}
	return s
}

// ParseNumber is parseNumber: a number this package wrote, or ok false for anything else (an older or a foreign form is never guessed at).
func ParseNumber(text string) (DocNumber, bool) {
	m := numberRE.FindStringSubmatch(text)
	if m == nil {
		return DocNumber{}, false
	}
	a, _ := strconv.Atoi(m[2])
	b, _ := strconv.Atoi(m[3])
	if (a+1)%100 != b {
		return DocNumber{}, false
	}
	n, _ := strconv.ParseInt(m[4], 10, 64)
	return DocNumber{Series(m[1]), m[2] + "-" + m[3], n}, true
}

// NextNumber is nextNumber: the next number of this series and year, from the record alone. fyStart is when the year began in the shop's time zone, so a restore earlier in the year still
// moves a series that has issued nothing yet since it.
func NextNumber(entries []Entry, series Series, fy string, fyStart int64) DocNumber {
	var last int64
	lastSeq := 0
	for _, e := range entries {
		doc := e.Refs["doc"]
		if doc == "" { // `e.refs.doc ?` is a truthiness test: a missing and an empty doc are both "no document"
			continue
		}
		if d, ok := ParseNumber(doc); ok && d.Series == series && d.FY == fy && d.N > last {
			last, lastSeq = d.N, e.Seq
		}
	}
	restoredSince := false
	for _, e := range entries {
		if e.Action != RestoredAction || e.Seq <= lastSeq {
			continue
		}
		if t, ok := ParseISO(e.Time); ok && t >= fyStart { // Date.parse gives NaN for a time it cannot read, and NaN >= x is false
			restoredSince = true
			break
		}
	}
	n := last + 1
	if restoredSince {
		n += RestoreDocGap
	}
	return DocNumber{series, fy, n}
}

// FYStartMs is fyStartMs: the first moment of the financial year `fy` ("26-27") in the shop's time zone: 1 April, 00:00.
func FYStartMs(fy string, timeZone string) int64 {
	y, _ := strconv.Atoi(fy[:2])
	return zone.ZonedToMs(zone.Date{Year: 2000 + y, Month: 4, Day: 1}, 0, 0, timeZone)
}
