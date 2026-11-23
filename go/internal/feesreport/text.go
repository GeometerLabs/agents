// The owner layer: templates/education/fees/report/text.ts. A WhatsApp-ready text of five lines (six for a centre with Classes), in the centre's language, that a centre owner can read in
// ten seconds: money first (collected, old dues collected when there are some, still to collect, given back), then reminders and what was taken off, what the owner was asked, what the
// limits stopped, and what was not checked. Lines are "label: number", so no number needs a case ending in Malayalam or Kannada. Every number and amount is read from the report (which
// counted the record); the words come from strings.ts (words.go). Also the go-live sentences every monthly document uses (`goLiveLines`).
//
// Where Go differs from JavaScript: the rule list is sorted by count with a STABLE sort over the rules in their own order (ties keep that order, as the TypeScript's sort does); the
// sentence-ending "।" or "." is chosen by language as in the TypeScript.
package feesreport

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

// GoLiveLines is goLiveLines: what a monthly document says about the go-live checks, as sentences in the centre's language: no certificate was given, one was given and could not be
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

// NotCheckedList is notCheckedList: what was not checked, as the owner's short form names it: the things an owner would expect, then how many more the full report lists. A UPI centre
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

func nonEmpty(parts ...string) []string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// sourceTag is `s.sourceTag[report.source]`.
func sourceTag(s *Strings, r *Report) string { return s.SourceTag[r.Source] }

// stillToCollectText is "₹4,500 (3 students)", or ₹0 when nothing is open.
func stillToCollectText(r *Report, s *Strings) string {
	if r.Fees.StillToCollect.Count > 0 {
		return fmt.Sprintf("%s (%d %s)", report.Rupees(r.Fees.StillToCollect.Paise), r.Fees.StillToCollect.Count, s.Label.Students)
	}
	return report.Rupees(0)
}

// OwnerText is ownerText: the five lines (six with Classes) for one language.
func OwnerText(r *Report, lang string) string {
	s := StringsOf(lang)
	collectedLabel, oldDuesLabel, givenBackLabel := moneyLabels(lang, r.UPI())
	title := strings.Join(nonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), sourceTag(s, r)), " · ")
	oldDues, givenBack := "", ""
	if r.Money.OldDues != nil { // only when an old due was paid this period
		oldDues = pair(oldDuesLabel, report.Rupees(r.Money.OldDues.Paise))
	}
	if r.Money.GivenBack.Count > 0 {
		givenBack = pair(givenBackLabel, report.Rupees(r.Money.GivenBack.Paise))
	}
	moneyLine := strings.Join(nonEmpty(pair(collectedLabel, report.Rupees(r.Money.Collected.Paise)), oldDues, pair(s.Label.StillToCollect, stillToCollectText(r, s)), givenBack), " · ")
	doneLine := strings.Join([]string{pair(s.Label.RemindersSent, r.Reminders.Sent), pair(s.Label.TakenOff, report.Rupees(r.Waivers.Total.Paise)),
		pair(s.Label.WasAsked, r.Owner.Asked), pair(s.Label.Approved, r.Owner.Approved), pair(s.Label.SaidNo, r.Owner.Denied)}, " · ")
	// Classes: one more line, only for a centre that has it (a Fees centre's five lines are as they were)
	classLine := ""
	if c := r.Classes; c != nil {
		classLine = strings.Join([]string{pair(s.Classes.Held, c.Held), pair(s.Classes.LinksSent, c.LinksSent), pair(s.Classes.Attendance, c.AttendanceMarked),
			pair(s.Classes.MissedNotes, c.MissedNotes), pair(s.Classes.Doubts, c.Doubts)}, " · ")
	}

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
	lines := []string{title, moneyLine, doneLine}
	if classLine != "" {
		lines = append(lines, classLine)
	}
	return strings.Join(append(lines, stoppedLine, notChecked), "\n")
}

// OwnerTexts is ownerTexts: the owner's messages for a language choice: one, or two for "both".
func OwnerTexts(r *Report, lang string) []string {
	var out []string
	for _, l := range report.LanguagesOf(lang) {
		out = append(out, OwnerText(r, l))
	}
	return out
}
