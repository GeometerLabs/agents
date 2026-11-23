// The report page, the builder layer: templates/commerce/stock-orders/report/html.ts. A printable page, self-contained (one file, inline CSS, no script, no external font, image or link),
// that shows the same numbers as the owner's text, a table per supplier, the month's budget, what the limits stopped, and a "Show what we did" section with the counts by action and outcome
// and the digests. Every value that reaches the page is escaped (report.Esc); the shop's name and its suppliers' names come from the settings file. The owner's own "marked as paid" note
// has a row only when there is one: this agent pays no one.
//
// Where Go differs from JavaScript: `Array.prototype.sort()` with no comparator (the actions and outcomes of the by-action table) is UTF-16 order, report.LessUTF16; a number is written
// with strconv (String(n)). The report's tables are built with report.Table, whose cells are passed in already escaped, as in the TypeScript.
package stockordersreport

import (
	"crypto/ed25519"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// SealedReport is a report with its seal: the typed report the pages read, and the envelope (digest, code, signature) made over its tree.
type SealedReport struct {
	Envelope report.Envelope
	Doc      *Report
}

// SealReport is seal(report, key): the digest and code always, a signature when a key is given.
func SealReport(r *Report, key ed25519.PrivateKey) SealedReport {
	return SealedReport{Envelope: report.Seal(r.Tree(), key), Doc: r}
}

// sealWords is the strings' `page` as the verification block takes it.
func sealWords(s *Strings) report.SealWords {
	p := &s.Page
	return report.SealWords{CheckHeading: p.CheckHeading, Code: p.Code, Digest: p.Digest, SignedBy: p.SignedBy, NotSigned: p.NotSigned, SignatureNote: p.SignatureNote, ScanToCheck: p.ScanToCheck, ScanSummary: p.ScanSummary}
}

func e(s string) string { return report.Esc(s) }

func fign(n int) string { return report.Fig(strconv.Itoa(n)) }

// GoLiveBlock is goLiveBlock: the go-live checks, in sentences: green when a go-live certificate shows they ran on this shop's own settings, amber for everything else.
func GoLiveBlock(g report.GoLiveFinding, lang string) string {
	class := "warn"
	if g.Status == "own" {
		class = "note"
	}
	var b strings.Builder
	b.WriteString(`<div class="` + class + `">`)
	for _, line := range GoLiveLines(g, lang) {
		b.WriteString("<p>" + e(line) + "</p>")
	}
	b.WriteString("</div>")
	return b.String()
}

// byActionTable is the "Show what we did" table: the counts by action and outcome, the actions and the outcomes in UTF-16 order (as `sort()` with no comparator).
func byActionTable(byAction map[string]map[string]int, actionWord string) string {
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
	sort.Slice(actions, func(i, j int) bool { return report.LessUTF16(actions[i], actions[j]) })
	sort.Slice(outcomes, func(i, j int) bool { return report.LessUTF16(outcomes[i], outcomes[j]) })
	head := []report.TableHead{{Text: actionWord}}
	for _, o := range outcomes {
		head = append(head, report.TableHead{Text: o, N: true})
	}
	var rows [][]string
	for _, a := range actions {
		row := []string{"<code>" + e(a) + "</code>"}
		for _, o := range outcomes {
			if n, ok := byAction[a][o]; ok {
				row = append(row, strconv.Itoa(n))
			} else {
				row = append(row, "")
			}
		}
		rows = append(rows, row)
	}
	return report.Table(head, rows)
}

// ReportSection is reportSection: one language's section of the report page. check is the report's signed summary link, "" for a report that is not signed.
func ReportSection(sr SealedReport, lang, check string) (string, error) {
	s := StringsOf(lang)
	r := sr.Doc
	p := &s.Page
	o := &r.Orders
	madeMs, _ := accounting.ParseISO(r.MadeAt)
	made := zone.LocalParts(madeMs, r.TimeZone)
	madeOn := fmt.Sprintf("%s %d", language.Formats(lang).Date(made.Date.Year, made.Date.Month, made.Date.Day), made.Year)
	tag := s.SourceTag[r.Source]
	source := tag // `s.sourceTag[r.source] || p.liveServices`
	if source == "" {
		source = p.LiveServices
	}

	head2 := []report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}}
	row := func(label string, n int) []string { return []string{e(label), fign(n)} }
	orders := report.Table(head2, [][]string{
		row(s.Label.Placed, o.Placed), row(s.Label.Acknowledged, o.Acknowledged), row(s.Label.ReceivedFull, o.ReceivedFull), row(s.Label.PartReceived, o.PartReceived),
		row(s.Label.WrongItem, o.WrongItem), row(s.Label.SupplierSaidNo, o.DeclinedBySupplier), row(s.Label.NoAnswer, o.Silent), row(s.Label.NeverSent, o.NeverSent),
		row(s.Label.Asked, r.Owner.Asked), row(s.Label.Approved, r.Owner.Approved), row(s.Label.SaidNo, r.Owner.SaidNo),
	})
	money := func(paise int64) string { return report.Fig(report.Rupees(paise)) }
	budget := report.Table([]report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}, {Text: p.Amount, N: true}}, [][]string{
		{e(p.MonthlyBudget), "", money(r.Budget.MonthlyPaise)},
		{e(s.Label.BudgetUsed), "", money(r.Budget.UsedPaise)},
		{e(s.Label.BudgetLeft), "", money(r.Budget.LeftPaise)},
	})
	// the owner's own note, shown only when there is one (the agent pays no one and cannot check it)
	ownersNote := ""
	if r.MarkedPaidByOwner > 0 {
		ownersNote = "<h2>" + e(p.OwnersNoteHeading) + "</h2>" + report.Table(head2, [][]string{row(s.Label.MarkedPaid, r.MarkedPaidByOwner)})
	}
	suppliers := ""
	if len(r.Suppliers) > 0 {
		heads := []report.TableHead{{Text: p.Supplier}}
		for _, w := range []string{s.Label.Placed, s.Label.Acknowledged, s.Label.ReceivedFull, s.Label.PartReceived, s.Label.WrongItem, s.Label.SupplierSaidNo, s.Label.NoAnswer} {
			heads = append(heads, report.TableHead{Text: w, N: true})
		}
		var rows [][]string
		for _, x := range r.Suppliers {
			rows = append(rows, []string{e(x.Name), fign(x.Placed), fign(x.Acknowledged), fign(x.ReceivedFull), fign(x.PartReceived), fign(x.WrongItem), fign(x.Declined), fign(x.Silent)})
		}
		suppliers = report.Table(heads, rows)
	}
	var ruleRows [][]string
	for _, id := range RuleIDs() {
		ruleRows = append(ruleRows, []string{e(s.Stop[id]) + " <code>" + e(id) + "</code>", strconv.Itoa(r.Stopped.ByRule[id])})
	}
	rules := report.Table([]report.TableHead{{Text: p.Rule}, {Text: p.Times, N: true}}, ruleRows)

	tagHTML := ""
	if tag != "" {
		tagHTML = `<p class="tag">` + e(tag) + "</p>"
	}
	badge := ""
	if r.Innovator {
		badge = `<p class="badge">` + e(report.BadgeText(lang)) + "</p>"
	}
	var notCounted, notTested []string
	for _, id := range r.NotCounted {
		notCounted = append(notCounted, s.NotCounted[id])
	}
	for _, id := range r.NotTested {
		notTested = append(notTested, s.NotTested[id])
	}
	extra := [][2]string{{p.CountedFrom, source}, {p.Period, report.PeriodLabel(r.Period, lang)}, {p.AgentVersion, r.Pathway.Name + " " + r.Pathway.Version}, {p.MadeOn, madeOn}}
	if r.PreparedBy != nil && *r.PreparedBy != "" {
		extra = append(extra, [2]string{p.SetUpBy, *r.PreparedBy})
	}
	extra = append(extra, [2]string{p.LimitsDigest, r.PolicyDig}, [2]string{p.RecordDigest, r.Record.Digest})
	seal, err := report.SealBlock(sealWords(s), sr.Envelope, extra, check)
	if err != nil {
		return "", err
	}
	suppliersBlock := ""
	if suppliers != "" {
		suppliersBlock = "<h2>" + e(p.SuppliersHeading) + "</h2>" + suppliers
	}

	return `<section class="doc" lang="` + lang + `">
<header class="head"><p class="kicker">` + e(s.Agent) + " · " + e(s.MonthlyReport) + "</p><h1>" + e(r.ShopName) + `</h1><p class="period">` + e(report.PeriodLabel(r.Period, lang)) + "</p>" + tagHTML + badge + `</header>
<p class="note">` + e(s.HandRun) + `</p>
<div class="cards">
<div class="card"><strong class="hi">` + strconv.Itoa(o.Placed) + "</strong><span>" + e(s.Label.Placed) + `</span></div>
<div class="card"><strong>` + strconv.Itoa(o.ReceivedFull) + "</strong><span>" + e(s.Label.ReceivedFull) + `</span></div>
<div class="card"><strong>` + e(report.Rupees(r.Budget.UsedPaise)) + "</strong><span>" + e(s.Label.BudgetUsed) + `</span></div>
<div class="card"><strong>` + strconv.Itoa(o.Silent) + "</strong><span>" + e(s.Label.NoAnswer) + `</span></div>
</div>
<h2>` + e(p.OrdersHeading) + "</h2>" + orders + `
` + suppliersBlock + `
<h2>` + e(p.BudgetHeading) + "</h2>" + budget + `
` + ownersNote + `
<h2>` + e(p.StoppedHeading) + "</h2>" + rules + `
<dl><dt>` + e(p.Unconfirmed) + "</dt><dd>" + strconv.Itoa(r.UnconfirmedOpen) + `</dd></dl>
<h2>` + e(s.GoLive.Heading) + "</h2>" + GoLiveBlock(r.GoLive, lang) + `
<div class="warn"><h2>` + e(p.NotCountedHeading) + "</h2>" + report.List(notCounted) + "<h2>" + e(p.NotTestedHeading) + "</h2>" + report.List(notTested) + `</div>
<p class="note">` + e(s.Promise) + `</p>
<p class="small">` + e(p.NotAGrade) + `</p>
` + seal + `
<p class="small">` + e(s.HelpLine) + `</p>
<details><summary>` + e(p.ShowWhatWeDid) + `</summary>
<h2>` + e(p.ByActionHeading) + "</h2>" + byActionTable(r.Record.ByAction, p.Action) + `
</details>
</section>`, nil
}

// ReportPage is reportPage: the report page for one language, or Hindi and English together ("both"). check is the report's signed summary link, "" when it is not signed.
func ReportPage(sr SealedReport, lang, check string) (string, error) {
	langs := report.LanguagesOf(lang)
	sections := make([]string, len(langs))
	for i, l := range langs {
		sec, err := ReportSection(sr, l, check)
		if err != nil {
			return "", err
		}
		sections[i] = sec
	}
	return report.Page(sr.Doc.ShopName+" · "+StringsOf(langs[0]).MonthlyReport, langs[0], sections), nil
}
