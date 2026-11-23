// The parts of a template's monthly report that are the same for every template, kept in one place so a template package does not copy them: the JSON tree helpers a sealed report is
// built from, the month's slice of the record and the report's period, the "by action" table, the WhatsApp message mechanics (a `{slot}` body, its Meta form, the parameters, the
// choice of the settled-by-word words and of the check link that keep the message inside WhatsApp's limit), and the random folder name.
//
// Why here: internal/feesreport needs every one of these and they are generic. They are the same code that internal/bookingsreport and internal/ordersreport carry as private copies
// (templates/*/report/*.ts do the same, in modules/report/*.ts for the TypeScript); those two packages are not changed in this stream and can move onto this file (see Deferred.md).
//
// Where Go and JavaScript differ: a tree is map[string]any with ints, strings, bools, nil, []any and json.Number (what CanonicalJSON writes); lengths are UTF-16 units
// (language.UTF16Len); a regular-expression replace with a function inserts the text as it is (no `$` patterns), as regexp.ReplaceAllStringFunc does; `Array.prototype.sort()` with no
// comparator is UTF-16 order (LessUTF16).
package report

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// JSONTree turns a value with JSON tags into the tree CanonicalJSON writes (numbers as json.Number, read as the double JSON.parse would make).
func JSONTree(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var out any
	if err := dec.Decode(&out); err != nil {
		panic(err)
	}
	return out
}

// StrTree is a text that may be null (the TypeScript's `string | null`).
func StrTree(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// StringsTree is a list of texts as a tree list.
func StringsTree(l []string) []any {
	out := make([]any, len(l))
	for i, s := range l {
		out[i] = s
	}
	return out
}

// AmountTree is `{count, paise}`.
func AmountTree(a accounting.Amount) map[string]any {
	return map[string]any{"count": a.Count, "paise": a.Paise}
}

// DateTree is a LocalDate, `{year, month, day}`.
func DateTree(d zone.Date) map[string]any {
	return map[string]any{"year": d.Year, "month": d.Month, "day": d.Day}
}

// PeriodTree is a report's `period`: the ISO bounds, the first and last day, and the month (null unless the period is one whole month).
func PeriodTree(p ReportPeriod, fromIso, toIso string) map[string]any {
	var month any
	if p.Month != nil {
		month = map[string]any{"year": p.Month.Year, "month": p.Month.Month}
	}
	return map[string]any{"from": fromIso, "to": toIso, "firstDay": DateTree(p.FirstDay), "lastDay": DateTree(p.LastDay), "month": month}
}

// ByActionTree is a record's `byAction`: how many entries of each action ended each way.
func ByActionTree(byAction map[string]map[string]int) map[string]any {
	out := map[string]any{}
	for a, outcomes := range byAction {
		m := map[string]any{}
		for o, n := range outcomes {
			m[o] = n
		}
		out[a] = m
	}
	return out
}

// CountByAction is `byAction[e.action][e.outcome]++` over the month's entries.
func CountByAction(month []accounting.Entry) map[string]map[string]int {
	out := map[string]map[string]int{}
	for _, e := range month {
		if out[e.Action] == nil {
			out[e.Action] = map[string]int{}
		}
		out[e.Action][e.Outcome]++
	}
	return out
}

// SplitMonth is the report's two slices of the record: `all` is every entry before `to`, oldest first by its number (a time that does not parse is NaN, and NaN < to is false: it is left
// out), and `month` the ones of them from `from` on. The WHOLE record goes in for the digest and the books; the month is [from, to).
func SplitMonth(entries []accounting.Entry, from, to int64) (all, month []accounting.Entry) {
	for _, e := range entries {
		if t, ok := accounting.ParseISO(e.Time); ok && t < to {
			all = append(all, e)
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].Seq < all[j].Seq })
	for _, e := range all {
		if t, _ := accounting.ParseISO(e.Time); t >= from {
			month = append(month, e)
		}
	}
	return all, month
}

// PeriodOfRange is the report's `period` for [from, to) in a time zone: the first and last local day, and the month when the range is exactly one whole month.
func PeriodOfRange(from, to int64, timeZone string) ReportPeriod {
	first := zone.LocalParts(from, timeZone).Date
	last := zone.LocalParts(to-1, timeZone).Date
	next := zone.Date{Year: first.Year, Month: first.Month + 1, Day: 1}
	if first.Month == 12 {
		next = zone.Date{Year: first.Year + 1, Month: 1, Day: 1}
	}
	p := ReportPeriod{FirstDay: first, LastDay: last}
	if zone.ZonedToMs(zone.Date{Year: first.Year, Month: first.Month, Day: 1}, 0, 0, timeZone) == from && zone.ZonedToMs(next, 0, 0, timeZone) == to {
		p.Month = &YearMonth{Year: first.Year, Month: first.Month}
	}
	return p
}

// ByActionTable is the page's "by action" table: actions and outcomes in UTF-16 order (as sort() with no comparator), one row per action, a cell blank where nothing ended that way.
func ByActionTable(byAction map[string]map[string]int, actionHeading string) string {
	var actions []string
	outcomeSet := map[string]bool{}
	for a, outs := range byAction {
		actions = append(actions, a)
		for o := range outs {
			outcomeSet[o] = true
		}
	}
	var outcomes []string
	for o := range outcomeSet {
		outcomes = append(outcomes, o)
	}
	sort.Slice(actions, func(i, j int) bool { return LessUTF16(actions[i], actions[j]) })
	sort.Slice(outcomes, func(i, j int) bool { return LessUTF16(outcomes[i], outcomes[j]) })
	head := []TableHead{{Text: actionHeading}}
	for _, o := range outcomes {
		head = append(head, TableHead{Text: o, N: true})
	}
	var rows [][]string
	for _, a := range actions {
		row := []string{"<code>" + Esc(a) + "</code>"}
		for _, o := range outcomes {
			if n, ok := byAction[a][o]; ok {
				row = append(row, strconv.Itoa(n))
			} else {
				row = append(row, "")
			}
		}
		rows = append(rows, row)
	}
	return Table(head, rows)
}

// RandomToken is `randomBytes(16).toString("hex")`: the random name of a report's folder, so its address cannot be guessed.
func RandomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

var (
	slotRe     = regexp.MustCompile(`\{([A-Za-z]+)\}`)
	metaSlotRe = regexp.MustCompile(`\{\{([0-9]+)\}\}`)
)

// MetaBody is metaBody: the body as Meta wants it, `{slot}` turned into `{{1}}`, `{{2}}` ... in order.
func MetaBody(body string) string {
	n := 0
	return slotRe.ReplaceAllStringFunc(body, func(string) string { n++; return "{{" + strconv.Itoa(n) + "}}" })
}

// FillBody is fillBody: a Meta body (`{{1}}` ...) filled with its parameters, which is what the person will read. A number with no parameter is empty.
func FillBody(meta string, parameters []string) string {
	return metaSlotRe.ReplaceAllStringFunc(meta, func(m string) string {
		n, _ := strconv.Atoi(m[2 : len(m)-2])
		if n >= 1 && n <= len(parameters) {
			return parameters[n-1]
		}
		return ""
	})
}

// SlotsIn is `reportSlotsOf`: the values a body names, in order. A name the template does not know is a mistake in the wording, and says so.
func SlotsIn(body string, known []string) ([]string, error) {
	var out []string
	for _, m := range slotRe.FindAllStringSubmatch(body, -1) {
		found := false
		for _, k := range known {
			found = found || k == m[1]
		}
		if !found {
			return nil, fmt.Errorf("The report template body has an unknown value {%s}.", m[1])
		}
		out = append(out, m[1])
	}
	return out, nil
}

// MessageSpec is what the owner's message is made from.
type MessageSpec struct {
	// Body is the template's wording with {slot} where a value goes; Slots the names it may use, in the template's order.
	Body  string
	Slots []string
	// Values gives every slot's value with a check link and the "settled by their word" words filled in.
	Values func(check, settled string) map[string]string
	// Digest and Code are the sealed report's; SummaryLink is its signed summary link ("" when it is not signed).
	Digest, Code, SummaryLink string
	// Settled are the refunds people settled by their word (B75), named in Language; More says "and n more".
	Settled  []SettledRow
	Language string
	More     func(n int) string
}

// BuildMessage is `valuesWithCheck` and `monthlyReportMessage`: the plain text and the template's parameters, with one choice per message so the text and the template agree.
// B75: the refunds people settled by their word are named if the message still fits WhatsApp's limit with the shortest check link; otherwise the names are left out (the full report
// names them). Chosen BEFORE the link, so a long month gives up the longer link before it gives up who settled what. The check link is the signed summary if the filled message fits,
// else the older #digest link, else the #code link (MessageCheckLink).
func BuildMessage(s MessageSpec) (text string, parameters []string, err error) {
	var fillErr error
	params := func(check, settled string) []string {
		slots, e := SlotsIn(s.Body, s.Slots)
		if e != nil {
			fillErr = e
		}
		values := s.Values(check, settled)
		out := make([]string, len(slots))
		for i, sl := range slots {
			out[i] = OneLine(values[sl])
		}
		return out
	}
	fill := func(check, settled string) string { return FillBody(MetaBody(s.Body), params(check, settled)) }
	settled, _ := SettledByWordWords(s.Settled, s.Language, s.More, func(words string) bool {
		return language.UTF16Len(fill(VerifyCodeLink(s.Code), words)) <= WhatsAppBodyLimit
	})
	chosen, err := MessageCheckLink(func(c string) string { return fill(c, settled) }, s.Digest, s.Code, s.SummaryLink)
	if err != nil {
		return "", nil, err
	}
	parameters = params(chosen, settled)
	if fillErr != nil {
		return "", nil, fillErr
	}
	return FillBody(MetaBody(s.Body), parameters), parameters, nil
}
