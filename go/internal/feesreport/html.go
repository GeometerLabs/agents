// The report page, the builder layer: templates/education/fees/report/html.ts. A printable page, self-contained (one file, inline CSS, no script, no external font, image or link), that
// shows the same numbers as the owner's text, a table per limit, the books' "Money this month" block, a Classes block for a centre that has them, and a "Show what we did" section with
// the counts by action and outcome. Every value that reaches the page is escaped (report.Esc); the centre's name comes from the settings file. No student's name is on it: the report
// does not hold one.
//
// Where Go differs from JavaScript: `Array.prototype.sort()` with no comparator (the actions and outcomes of the by-action table) is UTF-16 order (report.ByActionTable); a number is
// written with strconv (String(n)). The report's tables are built with report.Table, whose cells are passed in already escaped, as in the TypeScript.
package feesreport

import (
	"crypto/ed25519"
	"fmt"
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

// GoLiveBlock is goLiveBlock: the go-live checks, in sentences: green when a go-live certificate shows they ran on this centre's own settings, amber for everything else.
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

// ReportSection is reportSection: one language's section of the report page. check is the report's signed summary link, "" for a report that is not signed.
func ReportSection(sr SealedReport, lang, check string) (string, error) {
	s := StringsOf(lang)
	r := sr.Doc
	p := &s.Page
	collectedLabel, oldDuesLabel, givenBackLabel := moneyLabels(lang, r.UPI())
	madeMs, _ := accounting.ParseISO(r.MadeAt)
	made := zone.LocalParts(madeMs, r.TimeZone)
	madeOn := fmt.Sprintf("%s %d", language.Formats(lang).Date(made.Date.Year, made.Date.Month, made.Date.Day), made.Year)
	tag := s.SourceTag[r.Source]
	source := tag // `s.sourceTag[r.source] || p.liveServices`
	if source == "" {
		source = p.LiveServices
	}

	rowsNumbers := [][]string{append([]string{e(collectedLabel)}, amountCells(r.Money.Collected)...)}
	if r.Money.OldDues != nil { // only when an old due was paid this period
		rowsNumbers = append(rowsNumbers, append([]string{e(oldDuesLabel)}, amountCells(*r.Money.OldDues)...))
	}
	rowsNumbers = append(rowsNumbers, append([]string{e(givenBackLabel)}, amountCells(r.Money.GivenBack)...))
	// refunds a person settled by their word (B75): one row per person, "Settled by <who>, by their word", never counted as given back
	for _, w := range r.Money.SettledByWord {
		rowsNumbers = append(rowsNumbers, append([]string{e(report.SettledByWord(lang, report.SettledWho(w.By)))}, amountCells(accounting.Amount{Count: w.Count, Paise: w.Paise})...))
	}
	rowsNumbers = append(rowsNumbers,
		[]string{e(p.Opened), fign(r.Fees.Opened), ""},
		[]string{e(p.PaidInFull), fign(r.Fees.PaidInFull), ""},
		[]string{e(p.PartlyPaid), fign(r.Fees.PartlyPaid), ""},
		append([]string{e(s.Label.StillToCollect)}, amountCells(r.Fees.StillToCollect)...),
		append([]string{e(p.ByOwner)}, amountCells(r.Waivers.ByOwner)...),
		append([]string{e(p.WithinLimit)}, amountCells(r.Waivers.WithinLimit)...),
		append([]string{e(p.LateFeesAdded)}, amountCells(r.Waivers.LateFeesAdded)...),
		[]string{e(s.Label.WasAsked), fign(r.Owner.Asked), ""},
		[]string{e(s.Label.Approved), fign(r.Owner.Approved), ""},
		[]string{e(s.Label.SaidNo), fign(r.Owner.Denied), ""},
		[]string{e(p.StoppedParents), fign(r.Parents.Stopped), ""},
	)
	if c := r.Classes; c != nil {
		rowsNumbers = append(rowsNumbers,
			[]string{e(s.Classes.Held), fign(c.Held), ""}, []string{e(s.Classes.LinksSent), fign(c.LinksSent), ""}, []string{e(s.Classes.Attendance), fign(c.AttendanceMarked), ""},
			[]string{e(s.Classes.MissedNotes), fign(c.MissedNotes), ""}, []string{e(s.Classes.Doubts), fign(c.Doubts), ""})
	}
	numbers := report.Table([]report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}, {Text: p.Amount, N: true}}, rowsNumbers)

	var ruleRows [][]string
	for _, id := range RuleIDs() {
		ruleRows = append(ruleRows, []string{e(s.Stop[id]) + " <code>" + e(id) + "</code>", strconv.Itoa(r.Stopped.ByRule[id])})
	}
	rules := report.Table([]report.TableHead{{Text: p.Rule}, {Text: p.Times, N: true}}, ruleRows)

	langs := loadWords().Facts.Languages
	msgHead := []report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}}
	remindersRow := []string{e(p.RemindersToParents), strconv.Itoa(r.Reminders.Sent)}
	blank := func(first string, n int) []string {
		row := []string{e(first), strconv.Itoa(n)}
		for range langs {
			row = append(row, "")
		}
		return row
	}
	for _, l := range langs {
		msgHead = append(msgHead, report.TableHead{Text: s.LanguageName[l], N: true})
		remindersRow = append(remindersRow, strconv.Itoa(r.Reminders.ByLanguage[l]))
	}
	messages := report.Table(msgHead, [][]string{remindersRow, blank(p.ReceiptsToParents, r.Reminders.Receipts), blank(p.ToYou, r.Messages.ToOwner), blank(p.HeldBack, r.Messages.HeldBack)})
	byAction := report.ByActionTable(r.Record.ByAction, p.Action)

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
		money = render.MoneyBlock(r.Accounting.Summary, accounting.BlockWords(lang), render.BlockOptions{ToCome: true, BooksOnly: r.Money.BooksOnly})
	}

	return `<section class="doc" lang="` + lang + `">
<header class="head"><p class="kicker">` + e(s.Agent) + " · " + e(s.MonthlyReport) + "</p><h1>" + e(r.ShopName) + `</h1><p class="period">` + e(report.PeriodLabel(r.Period, lang)) + "</p>" + tagHTML + badge + `</header>
<p class="note">` + e(s.HandRun) + `</p>
<div class="cards">
<div class="card"><strong class="hi">` + e(report.Rupees(r.Money.Collected.Paise)) + "</strong><span>" + e(collectedLabel) + `</span></div>
<div class="card"><strong>` + e(report.Rupees(r.Fees.StillToCollect.Paise)) + "</strong><span>" + e(s.Label.StillToCollect) + `</span></div>
<div class="card"><strong>` + e(report.Rupees(r.Waivers.Total.Paise)) + "</strong><span>" + e(s.Label.TakenOff) + `</span></div>
<div class="card"><strong>` + strconv.Itoa(r.Reminders.Sent) + "</strong><span>" + e(s.Label.RemindersSent) + `</span></div>
</div>
<h2>` + e(p.Numbers) + "</h2>" + numbers + "\n" + money + `
<h2>` + e(p.StoppedHeading) + "</h2>" + rules + `
<h2>` + e(p.MessagesHeading) + "</h2>" + messages + `
<dl><dt>` + e(p.Unconfirmed) + "</dt><dd>" + strconv.Itoa(r.Unconfirmed.Open) + `</dd></dl>
<h2>` + e(s.GoLive.Heading) + "</h2>" + GoLiveBlock(r.GoLive, lang) + `
<div class="warn"><h2>` + e(p.NotCountedHeading) + "</h2>" + report.List(notCounted) + "<h2>" + e(p.NotTestedHeading) + "</h2>" + report.List(notTested) + `</div>
<p class="small">` + e(p.NotAGrade) + `</p>
` + seal + `
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
