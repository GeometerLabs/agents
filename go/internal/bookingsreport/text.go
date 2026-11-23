// The owner layer: templates/commerce/bookings/report/text.ts. A WhatsApp-ready text of five lines, in the shop's language, that a shop owner can read in ten seconds: money and bookings
// first, then what they were asked, what the limits stopped, and what was not checked. Lines are "label: number", so no number needs a case ending in Malayalam or Kannada. Every number
// and amount is read from the report (which counted the record); the words come from strings.ts (words.go). Also the go-live sentences every monthly document uses (`goLiveLines`).
//
// Where Go differs from JavaScript: the rule list is sorted by count with a STABLE sort over the rules in their own order (ties keep that order, as the TypeScript's sort does);
// the sentence-ending "।" or "." is chosen by language as in the TypeScript.
package bookingsreport

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/report"
)

// certHeld is cert.held(held, total, failed, notTested).
func certHeld(s *Strings, held, total, failed, notTested int) string {
	return Fill(s.Cert.Held, strconv.Itoa(held), strconv.Itoa(total), strconv.Itoa(failed), strconv.Itoa(notTested))
}

// GoLiveLines is goLiveLines: what a monthly document says about the go-live checks, as sentences in the shop's language (report.GoLiveLines over this template's words).
func GoLiveLines(g report.GoLiveFinding, lang string) []string {
	s := StringsOf(lang)
	return report.GoLiveLines(g, goLiveWords(s), lang)
}

// goLiveWords is the part of the strings the go-live sentences and block use.
func goLiveWords(s *Strings) report.GoLiveWords {
	return report.GoLiveWords{None: s.GoLive.None, Untrusted: s.GoLive.Untrusted, Own: s.GoLive.Own, Example: s.GoLive.Example, Different: s.GoLive.Different, SignedWith: s.GoLive.SignedWith, Held: s.Cert.Held}
}

// NotCheckedList is notCheckedList: what was not checked, as the owner's short form names it: the items an owner would expect, then how many more the full report lists.
func NotCheckedList(r *MonthlyReport, lang string) string {
	s := StringsOf(lang)
	var named []string
	for _, n := range append(NotTestedList(), UpiNotTestedList()...) {
		if n.ForOwner && has(r.NotTested, n.ID) {
			named = append(named, s.NotTested[n.ID])
		}
	}
	others := len(r.NotTested) + len(r.NotCounted) - len(named)
	return strings.Join(append(named, Fill(s.More, strconv.Itoa(others))), " · ")
}

func pair(label string, value any) string { return fmt.Sprintf("%s: %v", label, value) }

// OwnerText is ownerText: the five lines for one language.
func OwnerText(r *MonthlyReport, lang string) string {
	s := StringsOf(lang)
	depositsLabel, givenBackLabel := moneyLabels(lang, r.UPI())
	nonEmpty := func(parts ...string) []string {
		var out []string
		for _, p := range parts {
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	tag := s.SourceTag[r.Source]
	title := strings.Join(nonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), tag), " · ")
	cancelled, givenBack := "", ""
	if r.Bookings.Cancelled > 0 {
		cancelled = pair(s.Label.Cancelled, r.Bookings.Cancelled)
	}
	if r.Money.Refunds.Count > 0 {
		givenBack = pair(givenBackLabel, report.Rupees(r.Money.Refunds.Paise))
	}
	moneyAndBookings := strings.Join(nonEmpty(pair(s.Label.BookingsMade, r.Bookings.Made), cancelled, pair(depositsLabel, report.Rupees(r.Money.Deposits.Paise)), givenBack), " · ")
	notConfirmed := ""
	if r.Unconfirmed.OpenOnBookings > 0 {
		notConfirmed = pair(s.Label.NotConfirmed, r.Unconfirmed.OpenOnBookings)
	}
	asked := strings.Join(nonEmpty(pair(s.Label.WasAsked, r.Owner.Asked), pair(s.Label.Approved, r.Owner.Approved), pair(s.Label.SaidNo, r.Owner.Denied), notConfirmed), " · ")

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
	var stoppedLine string
	if r.Stopped.Total == 0 {
		stoppedLine = pair(s.Label.StoppedByLimits, 0)
	} else {
		more := ""
		if len(byCount) > 3 {
			more = " · …"
		}
		stoppedLine = pair(s.Label.StoppedByLimits, r.Stopped.Total) + " (" + strings.Join(shown, " · ") + more + ")"
	}
	dot := "."
	if lang == "hi" {
		dot = "।"
	}
	notChecked := pair(s.Label.NotChecked, NotCheckedList(r, lang)) + dot + " " + s.HandRun
	// E1, the discount authority: one line, only when the month has a discount
	lines := []string{title, moneyAndBookings, asked, stoppedLine}
	if d := r.Discounts; d != nil {
		lines = append(lines, strings.Join([]string{pair(s.Discounts.Given, fmt.Sprintf("%s (%d)", report.Rupees(d.Given.Paise), d.Given.Count)), pair(s.Discounts.Asked, int(d.Asked)), pair(s.Discounts.Refused, int(d.Refused))}, " · "))
	}
	return strings.Join(append(lines, notChecked), "\n")
}

// OwnerTexts is ownerTexts: the owner's messages for a language choice: one, or two for "both".
func OwnerTexts(r *MonthlyReport, lang string) []string {
	var out []string
	for _, l := range report.LanguagesOf(lang) {
		out = append(out, OwnerText(r, l))
	}
	return out
}
