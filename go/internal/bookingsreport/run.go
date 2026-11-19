// Making the files: templates/commerce/bookings/report/run.ts `writeClientReport`. Everything is written into the one folder the caller names and nowhere else: file names are fixed here
// and never contain a path (report.Writer). A signed paper also carries its signed summary (item 17b) in its QR and link, made here with the same key; the page and the short texts print
// it, and the monthly job puts the report's in the owner's WhatsApp message. An unsigned paper keeps the older #digest link.
//
// `writeGoLiveCertificate` is not ported (the go-live certificate is the CLI's and the deployer's: see certificate.go).
package bookingsreport

import (
	"crypto/ed25519"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Run is ReportRun: what writeClientReport needs.
type Run struct {
	Settings Settings
	Entries  []accounting.Entry
	Bookings []Booking
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
	Pathway    *Pathway
	// Tenant is the ledger tenant (the shop's id on the server): the report is anchored to its record's head. "" leaves the anchor null (run.ts: `run.tenant ?`).
	Tenant string
	Cost   *Cost
}

// Written is what WriteClientReport returns: the files, the owner's texts, the two codes, the sealed report and the report's check link ("" when the report is not signed).
type Written struct {
	Files           []string
	OwnerTexts      []string
	Code            string
	CertificateCode string
	Report          SealedReport
	Check           string
}

// WriteClientReport is writeClientReport(run): the monthly report (page, owner text, signed data) and the monthly record certificate (page, text, signed data).
func WriteClientReport(run Run) (Written, error) {
	from, to, err := report.MonthRange(run.Month, mustTimezone(run.Settings))
	if err != nil {
		return Written{}, err
	}
	in := Input{Settings: run.Settings, Entries: run.Entries, Bookings: run.Bookings, From: from, To: to, Source: run.Source, MadeAt: run.Now, PreparedBy: run.PreparedBy,
		Innovator: run.Innovator, GoLive: run.GoLive, Pathway: run.Pathway, Cost: run.Cost}
	if run.Tenant != "" {
		t := run.Tenant
		in.LedgerTenant = &t
	}
	doc, err := BuildMonthlyReport(in)
	if err != nil {
		return Written{}, err
	}
	sealed := SealReport(doc, run.Key)
	cert := SealCertificate(BuildMonthlyCertificate(sealed, run.Now), run.Key)
	reportCheck, err := report.SummaryLinkFor(sealed.Envelope, ReportSummaryFields(doc), run.Key)
	if err != nil {
		return Written{}, err
	}
	certCheck, err := report.SummaryLinkFor(cert.Envelope, CertificateSummaryFields(cert.Doc), run.Key)
	if err != nil {
		return Written{}, err
	}
	w, err := report.NewWriter(run.Out)
	if err != nil {
		return Written{}, err
	}
	langs := report.LanguagesOf(run.Language)
	page, err := ReportPage(sealed, run.Language, reportCheck)
	if err != nil {
		return Written{}, err
	}
	certPage, err := MonthlyCertificatePage(cert, run.Language, certCheck)
	if err != nil {
		return Written{}, err
	}
	writes := [][2]string{
		{fmt.Sprintf("report-%s.json", run.Month), report.EnvelopeFile(sealed.Envelope)},
		{fmt.Sprintf("report-%s-%s.html", run.Month, run.Language), page},
	}
	var ownerTexts []string
	for _, l := range langs {
		t := OwnerText(doc, l)
		ownerTexts = append(ownerTexts, t)
		writes = append(writes, [2]string{fmt.Sprintf("owner-%s-%s.txt", run.Month, l), t + "\n"})
	}
	writes = append(writes, [2]string{fmt.Sprintf("certificate-%s.json", run.Month), report.EnvelopeFile(cert.Envelope)},
		[2]string{fmt.Sprintf("certificate-%s-%s.html", run.Month, run.Language), certPage})
	for _, l := range langs {
		writes = append(writes, [2]string{fmt.Sprintf("certificate-%s-%s.txt", run.Month, l), MonthlyCertificateText(cert, l, certCheck) + "\n"})
	}
	for _, f := range writes {
		if err := w.Write(f[0], f[1]); err != nil {
			return Written{}, err
		}
	}
	return Written{Files: w.Files, OwnerTexts: ownerTexts, Code: sealed.Envelope.Code, CertificateCode: cert.Envelope.Code, Report: sealed, Check: reportCheck}, nil
}

func mustTimezone(s Settings) string {
	tz, _ := s["timezone"].(string)
	return tz
}
