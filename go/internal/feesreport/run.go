// Making the files: templates/education/fees/report/run.ts `writeFeesReport`. Everything is written into the one folder the caller names and nowhere else: file names are fixed here and
// never contain a path (report.Writer). A signed paper also carries its signed summary (item 17b) in its QR and link, made here with the same key; the page and the short texts print it,
// and the monthly job puts it in the owner's WhatsApp message. An unsigned paper keeps the older #digest link. Fees has no monthly record certificate, so only the report is written.
//
// `writeGoLiveCertificate` is not ported (the go-live certificate is the CLI's and the deployer's: see Deferred.md).
package feesreport

import (
	"crypto/ed25519"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Run is ReportRun: what writeFeesReport needs.
type Run struct {
	Settings Settings
	Entries  []accounting.Entry
	// Dues are the fees as they are now: what is still to collect is read from them.
	Dues     []Due
	Month    string // "2026-11"
	Language string // "hi", "en", "ml", "kn" or "both"
	Out      string
	Source   string
	Key      ed25519.PrivateKey // nil: the papers are not signed
	// PreparedBy is who set the agent up as the caller wrote it; nil is left undefined (the report then says null).
	PreparedBy *string
	Innovator  bool
	GoLive     *report.GoLiveFinding
	Now        int64 // epoch milliseconds the report is made at
	// Tenant is the ledger tenant (the centre's id on the server): the report is anchored to its record's head. "" leaves the anchor null (run.ts: `run.tenant ?`).
	Tenant string
}

// Written is what WriteFeesReport returns: the files, the owner's texts, the check code, the sealed report and the report's check link ("" when the report is not signed).
type Written struct {
	Files      []string
	OwnerTexts []string
	Code       string
	Report     SealedReport
	Check      string
}

// WriteFeesReport is writeFeesReport(run): the monthly report (page, owner text in each language, signed data).
func WriteFeesReport(run Run) (Written, error) {
	tz, _ := run.Settings["timezone"].(string)
	from, to, err := report.MonthRange(run.Month, tz)
	if err != nil {
		return Written{}, err
	}
	in := Input{Settings: run.Settings, Entries: run.Entries, Dues: run.Dues, From: from, To: to, Source: run.Source, MadeAt: run.Now, PreparedBy: run.PreparedBy,
		Innovator: run.Innovator, GoLive: run.GoLive}
	if run.Tenant != "" {
		t := run.Tenant
		in.LedgerTenant = &t
	}
	doc, err := BuildFeesReport(in)
	if err != nil {
		return Written{}, err
	}
	sealed := SealReport(doc, run.Key)
	check, err := report.SummaryLinkFor(sealed.Envelope, ReportSummaryFields(doc), run.Key) // the same key as the paper's, or none
	if err != nil {
		return Written{}, err
	}
	w, err := report.NewWriter(run.Out)
	if err != nil {
		return Written{}, err
	}
	page, err := ReportPage(sealed, run.Language, check)
	if err != nil {
		return Written{}, err
	}
	writes := [][2]string{
		{fmt.Sprintf("report-%s.json", run.Month), report.EnvelopeFile(sealed.Envelope)},
		{fmt.Sprintf("report-%s-%s.html", run.Month, run.Language), page},
	}
	var ownerTexts []string
	for _, l := range report.LanguagesOf(run.Language) {
		t := OwnerText(doc, l)
		ownerTexts = append(ownerTexts, t)
		writes = append(writes, [2]string{fmt.Sprintf("owner-%s-%s.txt", run.Month, l), t + "\n"})
	}
	for _, f := range writes {
		if err := w.Write(f[0], f[1]); err != nil {
			return Written{}, err
		}
	}
	return Written{Files: w.Files, OwnerTexts: ownerTexts, Code: sealed.Envelope.Code, Report: sealed, Check: check}, nil
}
