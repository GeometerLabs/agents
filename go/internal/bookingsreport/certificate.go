// The monthly record certificate: templates/commerce/bookings/report/certificate.ts (`buildMonthlyCertificate`, `monthlyCertificateText`, `monthlySection`, `monthlyCertificatePage`).
// It is made from a SEALED monthly report: what was counted from the record, what was not counted, what was not tested, and the digests of the report and the record it came from.
// It states facts and counts; it never grades. Every number, amount and date is read from the report, and written by the per-language formatters; the words around them are words.go.
//
// NOT ported here, on purpose: the go-live CERTIFICATE (`buildGoLiveCertificate`, `goLivePage`, `goLiveText`, `goLiveSection`, `limitLines`, `summariseRun`, `summariseHandCheck`,
// `notTestedFor`): it is made from one run of the hand check (crash-test/situations.ts) and the CLI and the deployer write it; the Bookings runtime never makes one, it only READS one
// (golive.go). They stay TypeScript (Explanation.md).
package bookingsreport

import (
	"crypto/ed25519"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

const formatMonthlyCertificate = "geometer-monthly-certificate/1"

// MonthlyCertificate is certificate.ts MonthlyCertificate.
type MonthlyCertificate struct {
	Pathway    Pathway
	Source     string
	ShopName   string
	TimeZone   string
	PreparedBy *string
	IssuedAt   string
	IssuedOn   zone.Date
	Report     *MonthlyReport // the report it was made from (the period, the digests and the figures are copied from it)
	Counted    struct {
		BookingsMade, Cancelled     int
		DepositsPaise, RefundsPaise int64
		Stopped, UnconfirmedOpen    int
		Asked, Approved, Denied     int
	}
	ReportDigest, ReportCode string
}

// BuildMonthlyCertificate is buildMonthlyCertificate(report, issuedAt): issuedAt is epoch milliseconds, passed in so the same input gives the same certificate.
func BuildMonthlyCertificate(sr SealedReport, issuedAt int64) *MonthlyCertificate {
	r := sr.Doc
	day := zone.LocalParts(issuedAt, r.TimeZone)
	c := &MonthlyCertificate{Pathway: r.Pathway, Source: r.Source, ShopName: r.ShopName, TimeZone: r.TimeZone, PreparedBy: r.PreparedBy, IssuedAt: isoOf(issuedAt), IssuedOn: day.Date,
		Report: r, ReportDigest: sr.Envelope.Digest, ReportCode: sr.Envelope.Code}
	c.Counted.BookingsMade, c.Counted.Cancelled = r.Bookings.Made, r.Bookings.Cancelled
	c.Counted.DepositsPaise, c.Counted.RefundsPaise = r.Money.Deposits.Paise, r.Money.Refunds.Paise
	c.Counted.Stopped, c.Counted.UnconfirmedOpen = r.Stopped.Total, r.Unconfirmed.OpenOnBookings
	c.Counted.Asked, c.Counted.Approved, c.Counted.Denied = r.Owner.Asked, r.Owner.Approved, r.Owner.Denied
	return c
}

// UPI is the certificate's `paidBy === "owner-marked"`.
func (c *MonthlyCertificate) UPI() bool { return c.Report.PaidBy == "owner-marked" }

// Tree is the certificate as the tree that is sealed; the optional keys are spreads in the TypeScript (innovator, paidBy), left out when the report has none.
func (c *MonthlyCertificate) Tree() map[string]any {
	r := c.Report
	n := c.Counted
	out := map[string]any{
		"format": formatMonthlyCertificate, "pathway": map[string]any{"name": c.Pathway.Name, "version": c.Pathway.Version}, "source": c.Source,
		"shop": map[string]any{"name": c.ShopName, "timeZone": c.TimeZone}, "preparedBy": strTree(c.PreparedBy), "issuedAt": c.IssuedAt, "issuedOn": dateTree(c.IssuedOn),
		"period": periodTree(r),
		"counted": map[string]any{"bookingsMade": n.BookingsMade, "cancelled": n.Cancelled, "depositsPaise": n.DepositsPaise, "refundsPaise": n.RefundsPaise, "stopped": n.Stopped,
			"unconfirmedOpen": n.UnconfirmedOpen, "asked": n.Asked, "approved": n.Approved, "denied": n.Denied},
		"record":       map[string]any{"entries": r.Record.Entries, "digest": r.Record.Digest},
		"report":       map[string]any{"digest": c.ReportDigest, "code": c.ReportCode},
		"policyDigest": r.PolicyDig, "notCounted": stringsTree(r.NotCounted), "notTested": stringsTree(r.NotTested), "goLive": GoLiveTree(r.GoLive), "anchor": r.Anchor.Tree(),
	}
	if r.Innovator {
		out["innovator"] = true
	}
	if r.PaidBy != "" {
		out["paidBy"] = r.PaidBy
	}
	return out
}

// SealedCertificate is a monthly certificate with its seal.
type SealedCertificate struct {
	Envelope report.Envelope
	Doc      *MonthlyCertificate
}

// SealCertificate is seal(certificate, key).
func SealCertificate(c *MonthlyCertificate, key ed25519.PrivateKey) SealedCertificate {
	return SealedCertificate{Envelope: report.Seal(c.Tree(), key), Doc: c}
}

// countedPairs is countedPairs: the counted facts as "label: number" pairs, in the shop's words.
func countedPairs(c *MonthlyCertificate, lang string) []string {
	s := StringsOf(lang)
	n := c.Counted
	depositsLabel, givenBackLabel := moneyLabels(lang, c.UPI())
	return []string{
		pair(s.Label.BookingsMade, n.BookingsMade), pair(s.Label.Cancelled, n.Cancelled), pair(depositsLabel, report.Rupees(n.DepositsPaise)), pair(givenBackLabel, report.Rupees(n.RefundsPaise)),
		pair(s.Label.WasAsked, n.Asked), pair(s.Label.Approved, n.Approved), pair(s.Label.SaidNo, n.Denied), pair(s.Label.StoppedByLimits, n.Stopped), pair(s.Label.NotConfirmed, n.UnconfirmedOpen),
	}
}

func mapIDs(ids []string, words map[string]string) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = words[id]
	}
	return out
}

// MonthlyCertificateText is monthlyCertificateText: the monthly record certificate as a short text. It ends with the signed summary link when the certificate is signed (check), else the
// short /verify/#code.
func MonthlyCertificateText(sc SealedCertificate, lang, check string) string {
	s := StringsOf(lang)
	c := sc.Doc
	r := c.Report
	tag := s.SourceTag[c.Source]
	period := report.PeriodLabel(r.Period, lang)
	head := report.OneLine(c.ShopName) + " · " + s.Agent + " · " + s.MonthlyCert + " · " + period
	if tag != "" {
		head += " · " + tag
	}
	var tail strings.Builder
	if c.PreparedBy != nil && *c.PreparedBy != "" {
		tail.WriteString(s.Page.SetUpBy + ": " + report.OneLine(*c.PreparedBy) + " · ")
	}
	if r.Innovator {
		tail.WriteString(report.BadgeText(lang) + " · ")
	}
	tail.WriteString(s.Page.AgentVersion + ": " + c.Pathway.Name + " " + c.Pathway.Version + " · " + s.Page.Code + ": " + sc.Envelope.Code)
	if check == "" {
		tail.WriteString(" · " + report.VerifyCodePath(sc.Envelope.Code))
	}
	lines := []string{
		head,
		Fill(s.Cert.CountedIntro, period) + " " + strings.Join(countedPairs(c, lang), " · "),
		s.Page.NotCountedHeading + ": " + strings.Join(mapIDs(r.NotCounted, s.NotCounted), " · "),
		s.Label.NotChecked + ": " + strings.Join(mapIDs(r.NotTested, s.NotTested), " · "),
		strings.Join(GoLiveLines(r.GoLive, lang), " "),
		s.HandRun,
		tail.String(),
	}
	if check != "" {
		lines = append(lines, report.CheckGenuine(lang)+": "+check)
	}
	return strings.Join(lines, "\n")
}

// MonthlySection is monthlySection: one language's section of the certificate page.
func MonthlySection(sc SealedCertificate, lang, check string) (string, error) {
	s := StringsOf(lang)
	c := sc.Doc
	r := c.Report
	tag := ""
	if s.SourceTag[c.Source] != "" {
		tag = `<p class="tag">` + e(s.SourceTag[c.Source]) + "</p>"
	}
	badge := ""
	if r.Innovator {
		badge = `<p class="badge">` + e(report.BadgeText(lang)) + "</p>"
	}
	period := report.PeriodLabel(r.Period, lang)
	var rows [][]string
	for _, p := range countedPairs(c, lang) {
		i := strings.LastIndex(p, ": ")
		rows = append(rows, []string{e(p[:i]), e(p[i+2:])})
	}
	extra := [][2]string{{s.Page.AgentVersion, c.Pathway.Name + " " + c.Pathway.Version}, {s.Cert.Date, whenText(c.IssuedOn, lang)}}
	if c.PreparedBy != nil && *c.PreparedBy != "" {
		extra = append(extra, [2]string{s.Page.SetUpBy, *c.PreparedBy})
	}
	extra = append(extra, [2]string{s.Page.RecordDigest, r.Record.Digest}, [2]string{s.MonthlyReport + " (" + s.Page.Digest + ")", c.ReportDigest},
		[2]string{s.MonthlyReport + " (" + s.Page.Code + ")", c.ReportCode}, [2]string{s.Page.LimitsDigest, r.PolicyDig})
	seal, err := sealBlock(s, sc.Envelope, extra, check)
	if err != nil {
		return "", err
	}
	return `<section class="doc" lang="` + lang + `">
<header class="head"><p class="kicker">` + e(s.Agent) + "</p><h1>" + e(c.ShopName) + `</h1><p class="period">` + e(s.MonthlyCert) + " · " + e(period) + "</p>" + tag + badge + `</header>
<p class="note">` + e(s.SourceLong[c.Source]) + " " + e(s.HandRun) + `</p>
<h2>` + e(Fill(s.Cert.CountedIntro, period)) + "</h2>\n" + report.Table([]report.TableHead{{Text: s.Page.Item}, {Text: s.Page.Count, N: true}}, rows) + `
<h2>` + e(s.GoLive.Heading) + "</h2>" + GoLiveBlock(r.GoLive, lang) + `
<div class="warn"><h2>` + e(s.Page.NotCountedHeading) + "</h2>" + report.List(mapIDs(r.NotCounted, s.NotCounted)) + "<h2>" + e(s.Page.NotTestedHeading) + "</h2>" + report.List(mapIDs(r.NotTested, s.NotTested)) + `</div>
<p class="small">` + e(s.Page.NotAGrade) + `</p>
` + seal + `
</section>`, nil
}

// MonthlyCertificatePage is monthlyCertificatePage: the page for one language, or Hindi and English together; check is its signed summary link, "" when it is not signed.
func MonthlyCertificatePage(sc SealedCertificate, lang, check string) (string, error) {
	langs := report.LanguagesOf(lang)
	sections := make([]string, len(langs))
	for i, l := range langs {
		sec, err := MonthlySection(sc, l, check)
		if err != nil {
			return "", err
		}
		sections[i] = sec
	}
	return report.Page(sc.Doc.ShopName+" · "+StringsOf(langs[0]).MonthlyCert, langs[0], sections), nil
}
