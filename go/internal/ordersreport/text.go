// The owner layer: templates/commerce/orders/report/text.ts. A WhatsApp-ready text of five lines, in the shop's language, that a shop owner can read in ten seconds: money first (advance
// collected, still to collect at pickup, given back), then orders taken and cancelled and what the owner was asked, what the limits stopped, and what was not checked. Lines are
// "label: number", so no number needs a case ending in Malayalam or Kannada. Every number and amount is read from the report (which counted the record); the words come from strings.ts
// (words.go). Also the go-live sentences every monthly document uses (`goLiveLines`).
//
// Where Go differs from JavaScript: the rule list is sorted by count with a STABLE sort over the rules in their own order (ties keep that order, as the TypeScript's sort does); the
// sentence-ending "।" or "." is chosen by language as in the TypeScript.
package ordersreport

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/report"
)

// GoLiveLines is goLiveLines: what a monthly document says about the go-live checks, as sentences in the shop's language (report.GoLiveLines over this template's words).
func GoLiveLines(g report.GoLiveFinding, lang string) []string {
	s := StringsOf(lang)
	return report.GoLiveLines(g, goLiveWords(s), lang)
}

// goLiveWords is the part of the strings the go-live sentences and block use.
func goLiveWords(s *Strings) report.GoLiveWords {
	return report.GoLiveWords{None: s.GoLive.None, Untrusted: s.GoLive.Untrusted, Own: s.GoLive.Own, Example: s.GoLive.Example, Different: s.GoLive.Different, SignedWith: s.GoLive.SignedWith, Held: s.Cert.Held}
}

// NotCheckedList is notCheckedList: what was not checked, as the owner's short form names it: the things an owner would expect, then how many more the full report lists. A UPI shop
// (B33): "payments outside Razorpay" and "real Razorpay" do not apply; automatic payment checking does not either, and the line says so.
func NotCheckedList(r *Report, lang string) string {
	s := StringsOf(lang)
	named := []string{s.NotChecked.Cash, s.NotChecked.UPI, s.NotChecked.WhatsApp, s.NotChecked.Razorpay, s.NotChecked.Review}
	if r.UPI() {
		named = []string{s.NotChecked.Cash, s.UpiLabel.NotChecked, s.NotChecked.WhatsApp, s.NotChecked.Review}
	}
	others := len(r.NotTested) + len(r.NotCounted) - len(named)
	return strings.Join(append(named, Fill(s.More, strconv.Itoa(max(0, others)))), " · ")
}

func pair(label string, value any) string { return fmt.Sprintf("%s: %v", label, value) }

// sourceTag is `s.sourceTag[report.source]`.
func sourceTag(s *Strings, r *Report) string { return s.SourceTag[r.Source] }

// OwnerText is ownerText: the five lines for one language.
func OwnerText(r *Report, lang string) string {
	s := StringsOf(lang)
	collectedLabel, givenBackLabel := moneyLabels(lang, r.UPI())
	title := strings.Join(report.NonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), sourceTag(s, r)), " · ")
	balance, toCollect, givenBack := "", report.Rupees(0), ""
	if r.Money.BalanceCollected != nil {
		balance = pair(s.Label.BalanceCollected, report.Rupees(r.Money.BalanceCollected.Paise))
	}
	if r.Sold.ToCollect.Count > 0 {
		toCollect = fmt.Sprintf("%s (%s: %d)", report.Rupees(r.Sold.ToCollect.Paise), s.Label.Orders, r.Sold.ToCollect.Count)
	}
	if r.Money.GivenBack.Count > 0 {
		givenBack = pair(givenBackLabel, report.Rupees(r.Money.GivenBack.Paise))
	}
	moneyLine := strings.Join(report.NonEmpty(pair(collectedLabel, report.Rupees(r.Money.Collected.Paise)), balance, pair(s.Label.StillToCollect, toCollect), givenBack), " · ")
	doneLine := strings.Join([]string{pair(s.Label.OrdersTaken, r.Orders.Taken), pair(s.Label.Cancelled, r.Orders.Cancelled),
		pair(s.Label.WasAsked, r.Owner.Asked), pair(s.Label.Approved, r.Owner.Approved), pair(s.Label.SaidNo, r.Owner.Denied)}, " · ")

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
	stoppedLine := pair(s.Label.StoppedByLimits, 0)
	if r.Stopped.Total != 0 {
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
	return strings.Join([]string{title, moneyLine, doneLine, stoppedLine, notChecked}, "\n")
}

// OwnerTexts is ownerTexts: the owner's messages for a language choice: one, or two for "both".
func OwnerTexts(r *Report, lang string) []string {
	var out []string
	for _, l := range report.LanguagesOf(lang) {
		out = append(out, OwnerText(r, l))
	}
	return out
}
