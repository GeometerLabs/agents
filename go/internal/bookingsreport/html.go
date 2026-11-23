// The report page, the builder layer: templates/commerce/bookings/report/html.ts. A printable page, self-contained (one file, inline CSS, no script, no external font, image or link),
// that shows the same numbers as the owner's text, a table per limit, and a "Show what we did" section with the counts by action and outcome, the record's entries (fingerprints only)
// and the digests. Every value that reaches the page is escaped (report.Esc); shop and service names come from the settings file.
//
// Where Go differs from JavaScript: `Array.prototype.sort()` with no comparator (the actions and outcomes of the by-action table) is UTF-16 order, report.LessUTF16; a number is written
// with strconv (String(n)); `x.digest.slice(7, 23)` is a slice of ASCII text. The report's tables are built with report.Table, whose cells are passed in already escaped, as in the TypeScript.
package bookingsreport

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

// SealedReport is a monthly report with its seal: the typed report the pages read, and the envelope (digest, code, signature) made over its tree.
type SealedReport struct {
	Envelope report.Envelope
	Doc      *MonthlyReport
}

// SealReport is seal(report, key): the digest and code always, a signature when a key is given.
func SealReport(r *MonthlyReport, key ed25519.PrivateKey) SealedReport {
	return SealedReport{Envelope: report.Seal(r.Tree(), key), Doc: r}
}

func two(n int) string { return fmt.Sprintf("%02d", n) }

// sealWords is the strings' `page` as the verification block takes it.
func sealWords(s *Strings) report.SealWords {
	p := &s.Page
	return report.SealWords{CheckHeading: p.CheckHeading, Code: p.Code, Digest: p.Digest, SignedBy: p.SignedBy, NotSigned: p.NotSigned, SignatureNote: p.SignatureNote, ScanToCheck: p.ScanToCheck, ScanSummary: p.ScanSummary}
}

// sealBlock is html.ts sealBlock: the verification block (internal/report) with this template's words; check is the paper's signed summary link, "" when it is not signed.
func sealBlock(s *Strings, e report.Envelope, extra [][2]string, check string) (string, error) {
	return report.SealBlock(sealWords(s), e, extra, check)
}

// costText is costText: micro-rupees (1,000,000 = one rupee) as rupees to the paisa, rounded up, so a small cost shows as it is and never as 0.
func costText(micro int64) string {
	return report.Rupees(ceilDiv(micro, 10_000))
}

// ceilDiv is Math.ceil(a / b) for whole numbers.
func ceilDiv(a, b int64) int64 {
	q := a / b
	if a%b > 0 {
		q++
	}
	return q
}

func e(s string) string { return report.Esc(s) }

// GoLiveBlock is goLiveBlock (report.GoLiveBlock over this template's words).
func GoLiveBlock(g report.GoLiveFinding, lang string) string {
	return report.GoLiveBlock(g, goLiveWords(StringsOf(lang)), lang)
}

func fign(n int) string { return report.Fig(strconv.Itoa(n)) }

// WorkBlock is workBlock: the month's work and what it cost: completed, abandoned and unresolved side by side, the cost beside them, and what each word means on the page itself.
func WorkBlock(r *MonthlyReport, s *Strings) string {
	w := r.Work
	k := &s.Work
	unit := k.NoCost
	if w.CostPerCompletedMicroInr != nil {
		unit = costText(*w.CostPerCompletedMicroInr)
	} else if w.NoUnitCost != nil && *w.NoUnitCost == "no-completed-jobs" {
		unit = k.NoCompleted
	}
	cost := k.CostUnknown
	if w.CostMicroInr != nil {
		cost = costText(*w.CostMicroInr)
	}
	rows := [][2]string{{k.Jobs, strconv.Itoa(w.Jobs)}, {k.Completed, strconv.Itoa(w.Completed)}, {k.Abandoned, strconv.Itoa(w.Abandoned)}, {k.Unresolved, strconv.Itoa(w.Unresolved)}}
	if w.SettledByPerson > 0 {
		rows = append(rows, [2]string{k.SettledByPerson, strconv.Itoa(w.SettledByPerson)})
	}
	rows = append(rows, [2]string{k.Cost, cost}, [2]string{k.UnitCost, unit})
	cells := make([][]string, len(rows))
	for i, x := range rows {
		cells[i] = []string{e(x[0]), e(x[1])}
	}
	basis := ""
	if w.CostBasis != nil && *w.CostBasis != "" {
		basis = `<p class="small">` + e(*w.CostBasis) + "</p>"
	}
	return "<h2>" + e(k.Heading) + "</h2>" + report.Table([]report.TableHead{{Text: s.Page.Item}, {Text: s.Page.Count, N: true}}, cells) + "\n" + basis +
		"\n" + `<ul class="small"><li>` + e(k.CompletedMeans) + "</li><li>" + e(k.AbandonedMeans) + "</li><li>" + e(k.UnresolvedMeans) + "</li><li>" + e(k.AbandonedNeverClears) + "</li></ul>"
}

func amountCells(a accounting.Amount) []string {
	return []string{report.Fig(strconv.Itoa(a.Count)), report.Fig(report.Rupees(a.Paise))}
}

// ReportSection is reportSection: one language's section of the report page. check is the report's signed summary link, "" for a report that is not signed.
func ReportSection(sr SealedReport, lang, check string) (string, error) {
	s := StringsOf(lang)
	r := sr.Doc
	p := &s.Page
	depositsLabel, givenBackLabel := moneyLabels(lang, r.UPI())
	madeMs, _ := accounting.ParseISO(r.MadeAt)
	made := zone.LocalParts(madeMs, r.TimeZone)
	madeOn := fmt.Sprintf("%s %d", language.Formats(lang).Date(made.Date.Year, made.Date.Month, made.Date.Day), made.Year)

	rowsNumbers := [][]string{
		{e(s.Label.BookingsMade), fign(r.Bookings.Made), ""},
		{e(s.Label.Cancelled), fign(r.Bookings.Cancelled), ""},
		{e(s.Label.Moved), fign(r.Bookings.Moved), ""},
		{e(p.DroppedBeforeBooked), fign(r.Bookings.DroppedBeforeBooked), ""},
		append([]string{e(depositsLabel)}, amountCells(r.Money.Deposits)...),
		append([]string{e(givenBackLabel)}, amountCells(accounting.Amount{Count: r.Money.Refunds.Count, Paise: r.Money.Refunds.Paise})...),
		append([]string{e(p.GivenBackDeposits)}, amountCells(r.Money.Refunds.OfDeposits)...),
		append([]string{e(p.GivenBackSecond)}, amountCells(r.Money.Refunds.OfSecondPayments)...),
	}
	// refunds a person settled by their word (B75): one row per person, "Settled by <who>, by their word", never counted in the refunds above
	for _, w := range r.Money.SettledByWord {
		rowsNumbers = append(rowsNumbers, append([]string{e(report.SettledByWord(lang, report.SettledWho(w.By)))}, amountCells(accounting.Amount{Count: w.Count, Paise: w.Paise})...))
	}
	rowsNumbers = append(rowsNumbers,
		[]string{e(s.Label.WasAsked), fign(r.Owner.Asked), ""},
		[]string{e(s.Label.Approved), fign(r.Owner.Approved), ""},
		[]string{e(s.Label.SaidNo), fign(r.Owner.Denied), ""},
		[]string{e(p.Retried), fign(r.Owner.Retried), ""},
	)
	numbers := report.Table([]report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}, {Text: p.Amount, N: true}}, rowsNumbers)

	var ruleRows [][]string
	for _, id := range RuleIDs() {
		ruleRows = append(ruleRows, []string{e(s.Stop[id]) + " <code>" + e(id) + "</code>", strconv.Itoa(r.Stopped.ByRule[id])})
	}
	rules := report.Table([]report.TableHead{{Text: p.Rule}, {Text: p.Times, N: true}}, ruleRows)

	languages := []string{"hi", "en", "ml", "kn"}
	msgHead := []report.TableHead{{Text: p.Item}, {Text: p.Count, N: true}}
	for _, l := range languages {
		msgHead = append(msgHead, report.TableHead{Text: s.LanguageName[l], N: true})
	}
	msgRow := func(label string, side Side) []string {
		row := []string{e(label), strconv.Itoa(side.Total)}
		for _, l := range languages {
			row = append(row, strconv.Itoa(side.ByLanguage[l]))
		}
		return row
	}
	heldRow := []string{e(p.HeldBack), strconv.Itoa(r.Messages.HeldBack)}
	for range languages {
		heldRow = append(heldRow, "")
	}
	messages := report.Table(msgHead, [][]string{msgRow(p.ToCustomers, r.Messages.ToCustomers), msgRow(p.ToYou, r.Messages.ToOwner), heldRow})

	var unconfirmed string
	if len(r.Unconfirmed.Rows) == 0 {
		unconfirmed = "<p>" + e(p.Nothing) + "</p>"
	} else {
		var urows [][]string
		for _, x := range r.Unconfirmed.Rows {
			booking := "–"
			if x.Booking != nil {
				booking = *x.Booking
			}
			// a row a person settled by their word says who (B75); one a later step settled says so; the rest are still open
			state := p.StillOpen
			if x.SettledLater {
				if x.SettledByWord != nil && *x.SettledByWord != "" {
					state = report.SettledByWord(lang, report.SettledWho(*x.SettledByWord))
				} else {
					state = p.SettledLater
				}
			}
			urows = append(urows, []string{strconv.Itoa(x.Seq), "<code>" + e(x.Action) + "</code>", "<code>" + e(x.Outcome) + "</code>", e(booking), e(state)})
		}
		unconfirmed = report.Table([]report.TableHead{{Text: p.ColNo, N: true}, {Text: p.ColAction}, {Text: p.ColOutcome}, {Text: p.ColBooking}, {Text: p.StillOpen}}, urows)
	}

	var missing strings.Builder
	for _, m := range []struct {
		label string
		n     int
	}{{p.MissingDepositAmounts, r.Missing.DepositAmounts}, {p.MissingRefundAmounts, r.Missing.RefundAmounts}, {p.MissingOwnerCommands, r.Missing.OwnerCommands}, {p.MissingMessageTargets, r.Missing.MessageTargets}} {
		if m.n > 0 {
			missing.WriteString("<li>" + e(m.label) + ": " + strconv.Itoa(m.n) + "</li>")
		}
	}
	missingHTML := ""
	if missing.Len() > 0 {
		missingHTML = `<div class="warn"><p><b>` + e(p.MissingHeading) + "</b></p><ul>" + missing.String() + "</ul></div>"
	}

	byAction := report.ByActionTable(r.Record.ByAction, p.ColAction) // actions and outcomes in UTF-16 order, as sort() with no comparator

	var entryRows [][]string
	for _, x := range r.Record.Rows {
		ms, _ := accounting.ParseISO(x.Time)
		t := zone.LocalParts(ms, r.TimeZone)
		booking := "–"
		if x.Booking != nil {
			booking = *x.Booking
		}
		entryRows = append(entryRows, []string{strconv.Itoa(x.Seq), e(fmt.Sprintf("%d-%s-%s %s:%s", t.Year, two(t.Month), two(t.Day), two(t.Hour), two(t.Minute))), "<code>" + e(x.Action) + "</code>", "<code>" + e(x.Outcome) + "</code>", e(booking), "<code>" + e(x.Digest[7:23]) + "</code>"})
	}
	entries := report.Table([]report.TableHead{{Text: p.ColNo, N: true}, {Text: p.ColTime + " (" + r.TimeZone + ")"}, {Text: p.ColAction}, {Text: p.ColOutcome}, {Text: p.ColBooking}, {Text: p.ColFingerprint}}, entryRows)

	tag := ""
	if s.SourceTag[r.Source] != "" {
		tag = `<p class="tag">` + e(s.SourceTag[r.Source]) + "</p>"
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
	countedFrom := s.SourceTag[r.Source]
	if countedFrom == "" {
		countedFrom = s.SourceLong[r.Source]
	}
	extra := [][2]string{{p.CountedFrom, countedFrom}, {p.Period, report.PeriodLabel(r.Period, lang)}, {p.AgentVersion, r.Pathway.Name + " " + r.Pathway.Version}, {p.MadeOn, madeOn}}
	if r.PreparedBy != nil && *r.PreparedBy != "" {
		extra = append(extra, [2]string{p.SetUpBy, *r.PreparedBy})
	}
	extra = append(extra, [2]string{p.LimitsDigest, r.PolicyDig}, [2]string{p.RecordDigest, r.Record.Digest})
	seal, err := sealBlock(s, sr.Envelope, extra, check)
	if err != nil {
		return "", err
	}
	money := ""
	if r.Accounting != nil {
		money = render.MoneyBlock(r.Accounting.Summary, accounting.BlockWords(lang), render.BlockOptions{BooksOnly: r.Money.BooksOnly})
	}

	return `<section class="doc" lang="` + lang + `">
<header class="head"><p class="kicker">` + e(s.Agent) + " · " + e(s.MonthlyReport) + "</p><h1>" + e(r.ShopName) + `</h1><p class="period">` + e(report.PeriodLabel(r.Period, lang)) + "</p>" + tag + badge + `</header>
<p class="note">` + e(s.SourceLong[r.Source]) + " " + e(s.HandRun) + `</p>
<div class="cards">
<div class="card"><strong>` + strconv.Itoa(r.Bookings.Made) + "</strong><span>" + e(s.Label.BookingsMade) + `</span></div>
<div class="card"><strong class="hi">` + e(report.Rupees(r.Money.Deposits.Paise)) + "</strong><span>" + e(depositsLabel) + `</span></div>
<div class="card"><strong>` + e(report.Rupees(r.Money.Refunds.Paise)) + "</strong><span>" + e(givenBackLabel) + `</span></div>
<div class="card"><strong>` + strconv.Itoa(r.Stopped.Total) + "</strong><span>" + e(s.Label.StoppedByLimits) + `</span></div>
</div>
<h2>` + e(p.Numbers) + "</h2>" + numbers + "\n" + money + "\n" + WorkBlock(r, s) + "\n" +
		"<h2>" + e(p.StoppedHeading) + "</h2>" + rules + `<p class="small">` + e(p.StoppedNote) + `</p>
<h2>` + e(p.MessagesHeading) + "</h2>" + messages + `
<h2>` + e(p.UnconfirmedHeading) + "</h2>" + unconfirmed + `
<dl><dt>` + e(p.WaitingNow) + "</dt><dd>" + strconv.Itoa(r.AtReportTime.WaitingForOwner) + "</dd><dt>" + e(p.PaidNotBooked) + "</dt><dd>" + strconv.Itoa(r.AtReportTime.PaidNotBooked) + `</dd></dl>
` + missingHTML + `
<h2>` + e(s.GoLive.Heading) + "</h2>" + GoLiveBlock(r.GoLive, lang) + `
<div class="warn"><h2>` + e(p.NotCountedHeading) + "</h2>" + report.List(notCounted) + "<h2>" + e(p.NotTestedHeading) + "</h2>" + report.List(notTested) + `</div>
<p class="small">` + e(p.NotAGrade) + `</p>
` + seal + `
<details><summary>` + e(p.ShowWhatWeDid) + `</summary>
<h2>` + e(p.ByActionHeading) + "</h2>" + byAction + `
<h2>` + e(p.EntriesHeading) + "</h2>" + entries + `
</details>
</section>`, nil
}

// ReportPage is reportPage: the report page for one language, or Hindi and English together ("both").
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
