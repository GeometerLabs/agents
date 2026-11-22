// The report page, the builder layer: templates/commerce/orders/report/html.ts. A printable page, self-contained (one file, inline CSS, no script, no external font, image or link), that
// shows the same numbers as the owner's text, a table per limit, a plans block for a shop with plans, and a "Show what we did" section with the counts by action and outcome. Every value
// that reaches the page is escaped (report.Esc); the shop's name comes from the settings file.
//
// Where Go differs from JavaScript: `Array.prototype.sort()` with no comparator (the actions and outcomes of the by-action table) is UTF-16 order, report.LessUTF16; a number is written
// with strconv (String(n)). The report's tables are built with report.Table, whose cells are passed in already escaped, as in the TypeScript.
package ordersreport

import (
	"crypto/ed25519"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/accounting/render"
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

func amountCells(a accounting.Amount) []string {
	return []string{report.Fig(strconv.Itoa(a.Count)), report.Fig(report.Rupees(a.Paise))}
}

// plansSection is plansSection: the monthly plans' counts as a small table, for a shop with plans only.
func plansSection(p *PlansReport, lang string) string {
	w := PlanWordsOf(lang)
	rows := [][2]string{{w.Active, strconv.Itoa(p.Active)}, {w.Started, strconv.Itoa(p.Started)}, {w.Renewals, strconv.Itoa(p.Renewals)}, {w.Meals, strconv.Itoa(p.MealsDelivered)},
		{w.CreditDays, strconv.FormatInt(p.Credits.Days, 10)}, {w.Carried, report.Rupees(p.Credits.CarriedPaise)}, {w.Refunded, report.Rupees(p.Credits.RefundedPaise)},
		{w.Cancelled, strconv.Itoa(p.Cancelled)}, {w.Lapsed, strconv.Itoa(p.Lapsed)}}
	cells := make([][]string, len(rows))
	for i, x := range rows {
		cells[i] = []string{e(x[0]), report.Fig(x[1])}
	}
	return "<h2>" + e(w.Heading) + "</h2>" + report.Table([]report.TableHead{{Text: w.Heading}, {Text: "", N: true}}, cells)
}

// ReportSection is reportSection: one language's section of the report page. check is the report's signed summary link, "" for a report that is not signed.
func ReportSection(sr SealedReport, lang, check string) (string, error) {
	s := StringsOf(lang)
	r := sr.Doc
	p := &s.Page
	collectedLabel, givenBackLabel := moneyLabels(lang, r.UPI())
	madeMs, _ := accounting.ParseISO(r.MadeAt)
	made := zone.LocalParts(madeMs, r.TimeZone)
	madeOn := fmt.Sprintf("%s %d", language.Formats(lang).Date(made.Date.Year, made.Date.Month, made.Date.Day), made.Year)
	tag := s.SourceTag[r.Source]
	source := tag // `s.sourceTag[r.source] || p.liveServices`
	if source == "" {
		source = p.LiveServices
	}

	rowsNumbers := [][]string{append([]string{e(collectedLabel)}, amountCells(r.Money.Collected)...)}
	if r.Money.BalanceCollected != nil {
		rowsNumbers = append(rowsNumbers, append([]string{e(s.Label.BalanceCollected)}, amountCells(*r.Money.BalanceCollected)...))
	}
	rowsNumbers = append(rowsNumbers, append([]string{e(givenBackLabel)}, amountCells(r.Money.GivenBack)...))
	// refunds a person settled by their word (B75): one row per person, "Settled by <who>, by their word", never counted as given back
	for _, w := range r.Money.SettledByWord {
		rowsNumbers = append(rowsNumbers, append([]string{e(report.SettledByWord(lang, report.SettledWho(w.By)))}, amountCells(accounting.Amount{Count: w.Count, Paise: w.Paise})...))
	}
	rowsNumbers = append(rowsNumbers,
		[]string{e(p.OrdersTaken), fign(r.Orders.Taken), ""},
		[]string{e(p.OrdersCompleted), fign(r.Orders.Completed), ""},
		[]string{e(p.OrdersCancelled), fign(r.Orders.Cancelled), ""},
		[]string{e(p.HoldsRanOut), fign(r.Orders.HoldsRanOut), ""},
		[]string{e(s.Label.WasAsked), fign(r.Owner.Asked), ""},
		[]string{e(s.Label.Approved), fign(r.Owner.Approved), ""},
		[]string{e(s.Label.SaidNo), fign(r.Owner.Denied), ""},
		[]string{e(p.StoppedCustomers), fign(r.Customers.Stopped), ""},
	)
	head3 := []report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}, {Text: p.Amount, N: true}}
	numbers := report.Table(head3, rowsNumbers)
	sold := report.Table(head3, [][]string{
		{e(p.SoldOrders), fign(r.Sold.Orders), ""},
		{e(p.Pickup), fign(r.Sold.Pickup), ""},
		{e(p.Delivery), fign(r.Sold.Delivery), ""},
		append([]string{e(s.Label.StillToCollect)}, amountCells(r.Sold.ToCollect)...),
	})
	var items string
	if len(r.Sold.Items) > 0 {
		var rows [][]string
		for _, it := range r.Sold.Items {
			rows = append(rows, []string{e(it.Names[lang]), strconv.Itoa(it.Qty)})
		}
		items = report.Table([]report.TableHead{{Text: p.ItemsSold}, {Text: p.Count, N: true}}, rows)
	} else {
		items = "<p>" + e(p.ItemsSold) + ": " + e(p.NoItems) + "</p>"
	}
	var ruleRows [][]string
	for _, id := range RuleIDs() {
		ruleRows = append(ruleRows, []string{e(s.Stop[id]) + " <code>" + e(id) + "</code>", strconv.Itoa(r.Stopped.ByRule[id])})
	}
	rules := report.Table([]report.TableHead{{Text: p.Rule}, {Text: p.Times, N: true}}, ruleRows)
	messages := report.Table([]report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}}, [][]string{
		{e(p.ToYou), strconv.Itoa(r.Messages.ToOwner)},
		{e(p.HeldBack), strconv.Itoa(r.Messages.HeldBack)},
	})

	// the by-action table: actions and outcomes in UTF-16 order, as sort() with no comparator
	var actions []string
	outcomeSet := map[string]bool{}
	for a, outs := range r.Record.ByAction {
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
	actionHead := []report.TableHead{{Text: p.Action}}
	for _, o := range outcomes {
		actionHead = append(actionHead, report.TableHead{Text: o, N: true})
	}
	var actionRows [][]string
	for _, a := range actions {
		row := []string{"<code>" + e(a) + "</code>"}
		for _, o := range outcomes {
			if n, ok := r.Record.ByAction[a][o]; ok {
				row = append(row, strconv.Itoa(n))
			} else {
				row = append(row, "")
			}
		}
		actionRows = append(actionRows, row)
	}
	byAction := report.Table(actionHead, actionRows)

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
	money := ""
	if r.Accounting != nil {
		money = render.MoneyBlock(r.Accounting.Summary, accounting.BlockWords(lang), render.BlockOptions{BooksOnly: r.Money.BooksOnly})
	}
	plans := ""
	if r.Plans != nil {
		plans = plansSection(r.Plans, lang)
	}

	return `<section class="doc" lang="` + lang + `">
<header class="head"><p class="kicker">` + e(s.Agent) + " · " + e(s.MonthlyReport) + "</p><h1>" + e(r.ShopName) + `</h1><p class="period">` + e(report.PeriodLabel(r.Period, lang)) + "</p>" + tagHTML + badge + `</header>
<p class="note">` + e(s.HandRun) + `</p>
<div class="cards">
<div class="card"><strong class="hi">` + e(report.Rupees(r.Money.Collected.Paise)) + "</strong><span>" + e(collectedLabel) + `</span></div>
<div class="card"><strong>` + e(report.Rupees(r.Sold.ToCollect.Paise)) + "</strong><span>" + e(s.Label.StillToCollect) + `</span></div>
<div class="card"><strong>` + strconv.Itoa(r.Orders.Taken) + "</strong><span>" + e(s.Label.OrdersTaken) + `</span></div>
<div class="card"><strong>` + strconv.Itoa(r.Orders.Cancelled) + "</strong><span>" + e(s.Label.Cancelled) + `</span></div>
</div>
<h2>` + e(p.Numbers) + "</h2>" + numbers + "\n" + money + "\n" + plans + `
<h2>` + e(p.SoldHeading) + "</h2>" + sold + items + `
<h2>` + e(p.StoppedHeading) + "</h2>" + rules + `
<h2>` + e(p.MessagesHeading) + "</h2>" + messages + `
<dl><dt>` + e(p.Unconfirmed) + "</dt><dd>" + strconv.Itoa(r.Unconfirmed.Open) + `</dd></dl>
<h2>` + e(s.GoLive.Heading) + "</h2>" + GoLiveBlock(r.GoLive, lang) + `
<div class="warn"><h2>` + e(p.NotCountedHeading) + "</h2>" + report.List(notCounted) + "<h2>" + e(p.NotTestedHeading) + "</h2>" + report.List(notTested) + `</div>
<p class="note">` + e(s.Promise) + `</p>
<p class="small">` + e(p.NotAGrade) + `</p>
` + seal + `
<p class="small">` + e(s.HelpLine) + `</p>
<details><summary>` + e(p.ShowWhatWeDid) + `</summary>
<h2>` + e(p.ByActionHeading) + "</h2>" + byAction + `
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
