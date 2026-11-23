// The monthly report as a WhatsApp message: templates/education/fees/report/whatsapp.ts. The owner's lines, in the centre's language, from the numbers the report counted, with the name
// of the builder or Operator who set the agent up and, when they have it, the Innovator badge (B56).
//
// One wording, two ways to send it. The words are written once per language. Inside the owner's 24-hour window they go out as plain text; outside it WhatsApp carries only an approved
// template, so the SAME words are listed for Meta as four utility templates (`fee_monthly_report`, `fee_monthly_report_innovator` and the two UPI ones) with the numbers as numbered
// values. Filling a template gives back, letter for letter, the plain text. The four templates (name, badge, upi, wording per language) are DATA made by running the TypeScript's
// `wording()` (words.go), not ported code. The check link closing the message is the report's signed summary when the whole message still fits WhatsApp's 1024 characters, else the older
// #digest link, else the #code link: one choice per message, so the text and the template agree. The mechanics are internal/report's (report.BuildMessage).
//
// Not ported: `exampleValues`, `sampleMessage` and `reportSubmissions` (the sample month and the list submitted to Meta: a command-line and review use, not the runtime's).
package feesreport

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/report"
)

// reportSlots is REPORT_SLOTS: the values in a report message, in the order they come in the wording.
var reportSlots = []string{"title", "collected", "givenBack", "pending", "reminders", "takenOff", "asked", "approved", "saidNo", "stopped", "notChecked", "code", "link", "check", "builder"}

// Extras is ReportExtras: the report's check code, the address of the full page, the check link, who set the agent up, and (B75) the words for refunds people settled by their word
// ("Settled by asha, by their word: 1 (₹200)"), added after the given-back value: they go inside an existing value, so the approved template bodies do not change.
type Extras struct {
	Code, Link, Check, Builder, Settled string
}

// reportValues is reportValues: the value of every slot, as the owner reads it.
func reportValues(r *Report, lang string, x Extras) map[string]string {
	s := StringsOf(lang)
	_, oldDuesLabel, _ := moneyLabels(lang, r.UPI())
	oldDues := ""
	if r.Money.OldDues != nil { // an old due paid this month goes inside the value: the body is one fixed wording, so no template is added or changed
		oldDues = oldDuesLabel + ": " + report.Rupees(r.Money.OldDues.Paise)
	}
	return map[string]string{
		"title":     strings.Join(nonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), sourceTag(s, r)), " · "),
		"collected": strings.Join(nonEmpty(report.Rupees(r.Money.Collected.Paise), oldDues), " · "),
		// what the payment service confirmed given back, then what a person settled by their word (B75), which is never counted in it
		"givenBack": strings.Join(nonEmpty(report.Rupees(r.Money.GivenBack.Paise), x.Settled), " · "),
		"pending":   stillToCollectText(r, s),
		"reminders": strconv.Itoa(r.Reminders.Sent), "takenOff": report.Rupees(r.Waivers.Total.Paise),
		"asked": strconv.Itoa(r.Owner.Asked), "approved": strconv.Itoa(r.Owner.Approved), "saidNo": strconv.Itoa(r.Owner.Denied), "stopped": strconv.Itoa(r.Stopped.Total),
		"notChecked": NotCheckedList(r, lang), "code": x.Code, "link": x.Link, "check": x.Check, "builder": report.OneLine(x.Builder),
	}
}

// ReportMessage is what the owner is sent: the whole message as plain text (and what the template reads as when filled), and the same words as the approved template with its values.
type ReportMessage struct {
	Text     string
	Template report.Template
}

// templateFor is the template a report goes out as: with the Innovator line or without, and a UPI centre's (its money marked paid by the owner) or a gateway centre's.
func templateFor(r *Report) *reportTemplate {
	for i := range loadWords().Facts.Templates {
		t := &loadWords().Facts.Templates[i]
		if t.Badge == r.Innovator && t.UPI == r.UPI() {
			return t
		}
	}
	return nil
}

// MonthlyReportMessage is monthlyReportMessage(report, language, {link, check}): the message for one sealed report, in one language. The builder's name is the report's own `preparedBy`
// (the report cannot be sent without it) and the badge comes from the report's own `innovator` flag, so what the owner reads is what the signed report says. check is the report's signed
// summary link, "" for a report that is not signed: the message then carries the #digest link.
func MonthlyReportMessage(sr SealedReport, lang, link, check string) (ReportMessage, error) {
	r := sr.Doc
	if r.PreparedBy == nil || *r.PreparedBy == "" || report.OneLine(*r.PreparedBy) == "" {
		return ReportMessage{}, fmt.Errorf("The report names no one who set the agent up, and the message says who did.")
	}
	tpl := templateFor(r)
	s := StringsOf(lang)
	text, params, err := report.BuildMessage(report.MessageSpec{
		Body: tpl.Bodies[lang], Slots: reportSlots,
		Values: func(c, settled string) map[string]string {
			return reportValues(r, lang, Extras{Code: sr.Envelope.Code, Link: link, Builder: *r.PreparedBy, Check: c, Settled: settled})
		},
		Digest: sr.Envelope.Digest, Code: sr.Envelope.Code, SummaryLink: check,
		Settled: r.Money.SettledByWord, Language: lang, More: func(n int) string { return Fill(s.More, strconv.Itoa(n)) },
	})
	if err != nil {
		return ReportMessage{}, err
	}
	return ReportMessage{Text: text, Template: report.Template{Name: tpl.Name, Language: lang, Text: text, Parameters: params}}, nil
}
