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
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/report"
)

// reportSlots is REPORT_SLOTS: the values in a report message, in the order they come in the wording.
var reportSlots = []string{"title", "placed", "acknowledged", "received", "part", "wrong", "declined", "silent", "neverSent", "budget", "stopped", "notChecked", "code", "link", "check", "builder"}

var slotRe = regexp.MustCompile(`\{([A-Za-z]+)\}`)
var metaSlotRe = regexp.MustCompile(`\{\{([0-9]+)\}\}`)

// metaBody is metaBody: the body as Meta wants it: {slot} turned into {{1}}, {{2}} ... in order.
func metaBody(body string) string {
	n := 0
	return slotRe.ReplaceAllStringFunc(body, func(string) string { n++; return "{{" + strconv.Itoa(n) + "}}" })
}

// fillBody is fillBody: a Meta body ({{1}} ...) filled with its parameters: what the owner will read. A number with no parameter is empty.
func fillBody(meta string, parameters []string) string {
	return metaSlotRe.ReplaceAllStringFunc(meta, func(m string) string {
		n, _ := strconv.Atoi(m[2 : len(m)-2])
		if n >= 1 && n <= len(parameters) {
			return parameters[n-1]
		}
		return ""
	})
}

// reportSlotsOf is reportSlotsOf: the values a body names, in order. A name this file does not know is a mistake in the wording, and says so.
func reportSlotsOf(body string) ([]string, error) {
	var out []string
	for _, m := range slotRe.FindAllStringSubmatch(body, -1) {
		if !has(reportSlots, m[1]) {
			return nil, fmt.Errorf("The report template body has an unknown value {%s}.", m[1])
		}
		out = append(out, m[1])
	}
	return out, nil
}

// Extras is ReportExtras: the report's check code, the address of the full page, the check link and who set the agent up.
type Extras struct{ Code, Link, Check, Builder string }

// reportValues is reportValues: the value of every slot, as the owner reads it.
func reportValues(r *Report, lang string, x Extras) map[string]string {
	s := StringsOf(lang)
	o := &r.Orders
	return map[string]string{
		"title":  strings.Join(nonEmpty(report.OneLine(r.ShopName), report.PeriodLabel(r.Period, lang), s.SourceTag[r.Source]), " · "),
		"placed": strconv.Itoa(o.Placed), "acknowledged": strconv.Itoa(o.Acknowledged), "received": strconv.Itoa(o.ReceivedFull), "part": strconv.Itoa(o.PartReceived), "wrong": strconv.Itoa(o.WrongItem),
		"declined": strconv.Itoa(o.DeclinedBySupplier), "silent": strconv.Itoa(o.Silent), "neverSent": strconv.Itoa(o.NeverSent),
		"budget": BudgetValue(r, lang), "stopped": strconv.Itoa(r.Stopped.Total), "notChecked": NotCheckedList(r, lang),
		"code": x.Code, "link": x.Link, "check": x.Check, "builder": report.OneLine(x.Builder),
	}
}

// reportParameters is reportParameters: the parameters of a template body in the order its {{1}}, {{2}} ... take them. A value is one line: Meta refuses a line break, a tab or a run of
// spaces in one.
func reportParameters(body string, values map[string]string) ([]string, error) {
	slots, err := reportSlotsOf(body)
	if err != nil {
		return nil, err
	}
	out := make([]string, len(slots))
	for i, sl := range slots {
		out[i] = report.OneLine(values[sl])
	}
	return out, nil
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
	body := templateFor(r).Bodies[lang]
	extras := Extras{Code: sr.Envelope.Code, Link: link, Builder: *r.PreparedBy}
	var fillErr error
	fill := func(check string) string {
		x := extras
		x.Check = check
		params, err := reportParameters(body, reportValues(r, lang, x))
		if err != nil {
			fillErr = err
		}
		return fillBody(metaBody(body), params)
	}
	chosen, err := report.MessageCheckLink(fill, sr.Envelope.Digest, sr.Envelope.Code, check)
	if err != nil {
		return ReportMessage{}, err
	}
	x := extras
	x.Check = chosen
	parameters, err := reportParameters(body, reportValues(r, lang, x))
	if err == nil {
		err = fillErr
	}
	if err != nil {
		return ReportMessage{}, err
	}
	text := fillBody(metaBody(body), parameters)
	return ReportMessage{Text: text, Template: report.Template{Name: templateFor(r).Name, Language: lang, Text: text, Parameters: parameters}}, nil
}
