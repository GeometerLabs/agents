// Periods of the books, in the shop's time zone: a day, a month ("2026-11") or an Indian financial year ("26-27") (modules/accounting/periods.ts). One place, because the owner's Money
// section and the accountant's export must cut the record at the same moments, and a shop's day does not begin at midnight UTC. Every range is [FromMs, ToMs): a line at exactly the
// next period's first moment belongs to the next period.
package accounting

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// Range is periods.ts Range.
type Range struct{ FromMs, ToMs int64 }

// DayRange is dayRange: the shop's calendar day that holds this moment.
func DayRange(ms int64, timeZone string) Range {
	p := zone.LocalParts(ms, timeZone)
	day := zone.Date{Year: p.Year, Month: p.Month, Day: p.Day}
	return Range{zone.ZonedToMs(day, 0, 0, timeZone), zone.ZonedToMs(zone.AddDays(day, 1), 0, 0, timeZone)}
}

// MonthRange is monthRange: month 1 to 12 of a year.
func MonthRange(year, month int, timeZone string) Range {
	ny, nm := year, month+1
	if month == 12 {
		ny, nm = year+1, 1
	}
	return Range{zone.ZonedToMs(zone.Date{Year: year, Month: month, Day: 1}, 0, 0, timeZone), zone.ZonedToMs(zone.Date{Year: ny, Month: nm, Day: 1}, 0, 0, timeZone)}
}

// MonthPeriodOf is monthPeriodOf: the month a moment falls in, as "2026-11".
func MonthPeriodOf(ms int64, timeZone string) string {
	p := zone.LocalParts(ms, timeZone)
	return fmt.Sprintf("%d-%02d", p.Year, p.Month)
}

// PreviousMonth is previousMonth: the month before a "2026-11" period ("2025-12" for "2026-01"). The period is a text this package made; a text that is not "yyyy-mm" is not handled.
func PreviousMonth(period string) string {
	ys, ms, _ := strings.Cut(period, "-")
	y, _ := strconv.Atoi(ys)
	m, _ := strconv.Atoi(ms)
	if m == 1 {
		return fmt.Sprintf("%d-12", y-1)
	}
	return fmt.Sprintf("%d-%02d", y, m-1)
}

var (
	monthPeriodRE = regexp.MustCompile(`^(\d{4})-(0[1-9]|1[0-2])$`)
	fyPeriodRE    = regexp.MustCompile(`^(\d{2})-(\d{2})$`)
)

// PeriodRange is periodRange: the range of a period text, or ok false when it is neither "2026-11" nor a financial year "26-27" (the second number must follow the first).
func PeriodRange(period, timeZone string) (Range, bool) {
	if m := monthPeriodRE.FindStringSubmatch(period); m != nil {
		y, _ := strconv.Atoi(m[1])
		mo, _ := strconv.Atoi(m[2])
		return MonthRange(y, mo, timeZone), true
	}
	if y := fyPeriodRE.FindStringSubmatch(period); y != nil {
		a, _ := strconv.Atoi(y[1])
		b, _ := strconv.Atoi(y[2])
		if (a+1)%100 == b {
			return Range{FYStartMs(period, timeZone), FYStartMs(fmt.Sprintf("%s-%02d", y[2], (b+1)%100), timeZone)}, true
		}
	}
	return Range{}, false
}

// ExportPeriods is exportPeriods: the three periods the owner's page offers for download, from the month the runtime says it is now ("2026-11"): this month, last month and the
// financial year that month is in ("26-27").
type ExportPeriodSet struct{ ThisMonth, LastMonth, Year string }

// ExportPeriods builds the set above from the runtime's month.
func ExportPeriods(monthPeriod string) ExportPeriodSet {
	ys, ms, _ := strings.Cut(monthPeriod, "-")
	y, _ := strconv.Atoi(ys)
	m, _ := strconv.Atoi(ms)
	start := y - 1
	if m >= 4 {
		start = y
	}
	two := func(n int) string { return fmt.Sprintf("%02d", ((n%100)+100)%100) }
	return ExportPeriodSet{monthPeriod, PreviousMonth(monthPeriod), two(start) + "-" + two(start+1)}
}
