// The monthly report as a WhatsApp message: templates/commerce/stock-orders/report/whatsapp.ts. The owner's lines, in the owner's language, from the numbers the report counted, with the
// name of the builder or Operator who set the agent up and, when they have it, the Innovator badge.
//
// One wording, two ways to send it. The words are written once per language. Inside the owner's 24-hour window they go out as plain text; outside it WhatsApp carries only an approved
// template, so the SAME words are listed for Meta as two utility templates (`stock_monthly_report` and `stock_monthly_report_innovator`) with the numbers as numbered values. Filling a
// template gives back, letter for letter, the plain text. The two templates (name, badge, wording per language) are DATA made by running the TypeScript's `wording()` (words.go), not ported
// code. The check link closing the message is the report's signed summary when the whole message still fits WhatsApp's 1024 characters, else the older #digest link, else the #code link
// (report.MessageCheckLink): one choice per message, so the text and the template agree.
//
// Not ported: `sampleFor`, `sampleMessage`, `exampleValues` and `reportSubmissions` (the sample month and the list submitted to Meta: a command-line and review use, not the runtime's).
//
// Where Go differs from JavaScript: a regular-expression replace with a function inserts the text as it is (no `$` patterns), as regexp.ReplaceAllStringFunc does.
package stockordersreport

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/report"
)

// reportSlots is REPORT_SLOTS: the values in a report message, in the order they come in the wording.
var reportSlots = []string{"title", "placed", "acknowledged", "received", "part", "wrong", "declined", "silent", "neverSent", "budget", "stopped", "notChecked", "code", "link", "check", "builder"}

// Extras is ReportExtras: the report's check code, the address of the full page, the check link and who set the agent up.
type Extras struct{ Code, Link, Check, Builder string }

// reportValues is reportValues: the value of every slot, as the owner reads it.
func reportValues(r *Report, lang string, x Extras) map[string]string {
	s := StringsOf(lang)
	o := &r.Orders
	return map[string]string{
		"title":  strings.Join(report.NonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), s.SourceTag[r.Source]), " · "),
		"placed": strconv.Itoa(o.Placed), "acknowledged": strconv.Itoa(o.Acknowledged), "received": strconv.Itoa(o.ReceivedFull), "part": strconv.Itoa(o.PartReceived), "wrong": strconv.Itoa(o.WrongItem),
		"declined": strconv.Itoa(o.DeclinedBySupplier), "silent": strconv.Itoa(o.Silent), "neverSent": strconv.Itoa(o.NeverSent),
		"budget": BudgetValue(r, lang), "stopped": strconv.Itoa(r.Stopped.Total), "notChecked": NotCheckedList(r, lang),
		"code": x.Code, "link": x.Link, "check": x.Check, "builder": report.OneLine(x.Builder),
	}
}

// ReportMessage is what the owner is sent: the whole message as plain text (and what the template reads as when filled), and the same words as the approved template with its values.
type ReportMessage struct {
	Text     string
	Template report.Template
}

// templateFor is the template a report goes out as: with the Innovator line or without.
func templateFor(r *Report) *reportTemplate {
	for i := range loadWords().Facts.Templates {
		t := &loadWords().Facts.Templates[i]
		if t.Badge == r.Innovator {
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
	text, params, err := report.BuildMessage(report.MessageSpec{
		Body: tpl.Bodies[lang], Slots: reportSlots,
		Values: func(c, _ string) map[string]string {
			return reportValues(r, lang, Extras{Code: sr.Envelope.Code, Link: link, Builder: *r.PreparedBy, Check: c})
		},
		Digest: sr.Envelope.Digest, Code: sr.Envelope.Code, SummaryLink: check, Language: lang, // no refunds are settled by a person's word here: nothing to name
	})
	if err != nil {
		return ReportMessage{}, err
	}
	return ReportMessage{Text: text, Template: report.Template{Name: tpl.Name, Language: lang, Text: text, Parameters: params}}, nil
}
