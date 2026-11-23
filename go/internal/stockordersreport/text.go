// The owner layer: templates/commerce/stock-orders/report/text.ts. A WhatsApp-ready text of six short lines, in the owner's language, that a shop owner can read in ten seconds: what was
// ordered and what came of it, what went wrong with the supplier, the month's budget, what the limits stopped, and what was not checked. Lines are "label: number", so no number needs a case
// ending in Malayalam or Kannada. Every number and amount is read from the report (which counted the record and the orders); the words come from strings.ts (words.go). Also the go-live
// sentences every monthly document uses (`goLiveLines`).
//
// Where Go differs from JavaScript: the rule list is sorted by count with a STABLE sort over the rules in their own order (ties keep that order, as the TypeScript's sort does); the
// sentence-ending "।" or "." is chosen by language as in the TypeScript.
package stockordersreport

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// whenText is `${formatDate(d, language)} ${d.year}`.
func whenText(d zone.Date, lang string) string {
	return fmt.Sprintf("%s %d", language.Formats(lang).Date(d.Year, d.Month, d.Day), d.Year)
}

// GoLiveLines is goLiveLines: what a monthly document says about the go-live checks, as sentences in the shop's language: no certificate was given, one was given and could not be
// trusted, or one was read and says what its checks ran on (with its date, the counts it states, and the key that signed it). Never a grade.
func GoLiveLines(g report.GoLiveFinding, lang string) []string {
	s := StringsOf(lang)
	switch g.Status {
	case "none":
		return []string{s.GoLive.None}
	case "untrusted":
		return []string{s.GoLive.Untrusted}
	case "own":
		held := Fill(s.Cert.Held, strconv.Itoa(g.Held), strconv.Itoa(g.Total), strconv.Itoa(g.Failed), strconv.Itoa(g.NotTested))
		return []string{Fill(s.GoLive.Own, whenText(g.IssuedOn, lang)), held, Fill(s.GoLive.SignedWith, g.SignedBy)}
	case "example":
		return []string{Fill(s.GoLive.Example, whenText(g.IssuedOn, lang)), Fill(s.GoLive.SignedWith, g.SignedBy)}
	}
	return []string{Fill(s.GoLive.Different, whenText(g.IssuedOn, lang)), Fill(s.GoLive.SignedWith, g.SignedBy)} // "different"
}

// NotCheckedList is notCheckedList: what was not checked, as the owner's short form names it: the things an owner would expect, then how many more the full report lists.
func NotCheckedList(r *Report, lang string) string {
	s := StringsOf(lang)
	named := []string{s.NotChecked.Whatsapp, s.NotChecked.Supplier, s.NotChecked.Paying, s.NotChecked.Review}
	others := len(r.NotTested) + len(r.NotCounted) - len(named)
	return strings.Join(append(named, Fill(s.More, strconv.Itoa(max(0, others)))), " · ")
}

// BudgetValue is budgetValue: what the approved orders hold out of the month's budget, then the owner's own note when there is one. Used by the text and the WhatsApp message.
func BudgetValue(r *Report, lang string) string {
	s := StringsOf(lang)
	held := Fill(s.BudgetOf, report.Rupees(r.Budget.UsedPaise), report.Rupees(r.Budget.MonthlyPaise))
	if r.MarkedPaidByOwner > 0 {
		return fmt.Sprintf("%s · %s: %d", held, s.Label.MarkedPaid, r.MarkedPaidByOwner)
	}
	return held
}

func pair(label string, value any) string { return fmt.Sprintf("%s: %v", label, value) }

// nonEmpty is `.filter(Boolean)`.
func nonEmpty(parts ...string) []string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// OwnerText is ownerText: the six lines for one language.
func OwnerText(r *Report, lang string) string {
	s := StringsOf(lang)
	o := &r.Orders
	title := strings.Join(nonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), s.SourceTag[r.Source]), " · ")
	ordersLine := strings.Join([]string{pair(s.Label.Placed, o.Placed), pair(s.Label.Acknowledged, o.Acknowledged), pair(s.Label.ReceivedFull, o.ReceivedFull),
		pair(s.Label.PartReceived, o.PartReceived), pair(s.Label.WrongItem, o.WrongItem)}, " · ")
	supplierLine := strings.Join([]string{pair(s.Label.SupplierSaidNo, o.DeclinedBySupplier), pair(s.Label.NoAnswer, o.Silent), pair(s.Label.NeverSent, o.NeverSent)}, " · ")
	budgetLine := pair(s.Label.BudgetUsed, BudgetValue(r, lang))

	var byCount []string // ties keep the rules' own order
	for _, id := range RuleIDs() {
		if r.Stopped.ByRule[id] > 0 {
			byCount = append(byCount, id)
		}
	}
	sort.SliceStable(byCount, func(i, j int) bool { return r.Stopped.ByRule[byCount[j]]-r.Stopped.ByRule[byCount[i]] < 0 })
	var shown []string
	for _, id := range byCount[:min(3, len(byCount))] {
		shown = append(shown, pair(s.Stop[id], r.Stopped.ByRule[id]))
	}
	stoppedLine := pair(s.Label.Stopped, 0)
	if r.Stopped.Total != 0 {
		more := ""
		if len(byCount) > 3 {
			more = " · …"
		}
		stoppedLine = pair(s.Label.Stopped, r.Stopped.Total) + " (" + strings.Join(shown, " · ") + more + ")"
	}
	dot := "."
	if lang == "hi" {
		dot = "।"
	}
	notChecked := pair(s.Label.NotChecked, NotCheckedList(r, lang)) + dot + " " + s.HandRun
	return strings.Join([]string{title, ordersLine, supplierLine, budgetLine, stoppedLine, notChecked}, "\n")
}
