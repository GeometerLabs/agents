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

	"github.com/GeometerLabs/agents/go/internal/report"
)

// GoLiveLines is goLiveLines: what a monthly document says about the go-live checks, as sentences in the centre's language (report.GoLiveLines over this template's words).
func GoLiveLines(g report.GoLiveFinding, lang string) []string {
	s := StringsOf(lang)
	return report.GoLiveLines(g, goLiveWords(s), lang)
}

// goLiveWords is the part of the strings the go-live sentences and block use.
func goLiveWords(s *Strings) report.GoLiveWords {
	return report.GoLiveWords{None: s.GoLive.None, Untrusted: s.GoLive.Untrusted, Own: s.GoLive.Own, Example: s.GoLive.Example, Different: s.GoLive.Different, SignedWith: s.GoLive.SignedWith, Held: s.Cert.Held}
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

// sourceTag is `s.sourceTag[report.source]`.
func sourceTag(s *Strings, r *Report) string { return s.SourceTag[r.Source] }

// stillToCollectText is "₹4,500 (3 students)", or ₹0 when nothing is open.
func stillToCollectText(r *Report, s *Strings) string {
	if r.Fees.StillToCollect.Count > 0 {
		who := s.Label.Students
		if r.Credit != nil {
			who = s.Credit.Accounts // a credit book counts accounts, not students
		}
		return fmt.Sprintf("%s (%d %s)", report.Rupees(r.Fees.StillToCollect.Paise), r.Fees.StillToCollect.Count, who)
	}
	return report.Rupees(0)
}

// OwnerText is ownerText: the five lines (six with Classes) for one language.
func OwnerText(r *Report, lang string) string {
	s := StringsOf(lang)
	collectedLabel, oldDuesLabel, givenBackLabel := moneyLabels(lang, r.UPI())
	title := strings.Join(report.NonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), sourceTag(s, r)), " · ")
	oldDues, givenBack := "", ""
	if r.Money.OldDues != nil { // only when an old due was paid this period
		oldDues = pair(oldDuesLabel, report.Rupees(r.Money.OldDues.Paise))
	}
	if r.Money.GivenBack.Count > 0 {
		givenBack = pair(givenBackLabel, report.Rupees(r.Money.GivenBack.Paise))
	}
	moneyLine := strings.Join(report.NonEmpty(pair(collectedLabel, report.Rupees(r.Money.Collected.Paise)), oldDues, pair(s.Label.StillToCollect, stillToCollectText(r, s)), givenBack), " · ")
	doneLine := strings.Join([]string{pair(s.Label.RemindersSent, r.Reminders.Sent), pair(s.Label.TakenOff, report.Rupees(r.Waivers.Total.Paise)),
		pair(s.Label.WasAsked, r.Owner.Asked), pair(s.Label.Approved, r.Owner.Approved), pair(s.Label.SaidNo, r.Owner.Denied)}, " · ")
	// Classes: one more line, only for a centre that has it (a Fees centre's five lines are as they were)
	classLine := ""
	if c := r.Classes; c != nil {
		classLine = strings.Join([]string{pair(s.Classes.Held, c.Held), pair(s.Classes.LinksSent, c.LinksSent), pair(s.Classes.Attendance, c.AttendanceMarked),
			pair(s.Classes.MissedNotes, c.MissedNotes), pair(s.Classes.Doubts, c.Doubts)}, " · ")
	}
	// the credit book: one more line, only for a shop that has it
	creditLine := ""
	if c := r.Credit; c != nil {
		creditLine = strings.Join([]string{pair(s.Credit.OwedAtStart, report.Rupees(c.OwedAtStart.Paise)), pair(s.Credit.CollectedAfterReminder, report.Rupees(c.CollectedAfterReminder.Paise)),
			pair(s.Credit.RemindersSent, c.RemindersSent), pair(s.Credit.RemindersAfterPaid, c.RemindersAfterPaid)}, " · ")
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
	if creditLine != "" {
		lines = append(lines, creditLine)
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
