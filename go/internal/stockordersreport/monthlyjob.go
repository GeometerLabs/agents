// The monthly job for Stock orders: templates/commerce/stock-orders/report/monthly-job.ts `createMonthlyReport`. Last month's report goes to the owner on WhatsApp, once, from 09:00 on the
// 1st. When it may go, the claim before the send and the ending after, the retries and the quiet month are the same for every template and live in report.MonthlyJob; this file gives that
// job Stock orders' report: the page and the signed data (run.go), and the message built from the report's own counts (whatsapp.go). Stock orders sends no certificate document with it.
//
// How it is wired (the TypeScript's `make(ctx, {month, language, now})` gets the shop's settings, record and store in `ctx`; report.MonthlyJob.Make gets no context): the caller gives a
// `Shop` function, read each time a report is made, so a change to the badge, the name or the settings needs no restart (as `setup.options()` is read each time in the TypeScript).
//
// Each report goes into a folder of its own named by a random token (16 random bytes in hex, as `randomBytes(16).toString("hex")`) so its address cannot be guessed; Token is the test seam
// for the random part.
package stockordersreport

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Options is `setup.options()`: who set the agent up and whether they have the Innovator badge.
type Options struct {
	PreparedBy string
	Innovator  bool
}

// Shop is what a report is made from, read when it is made: the shop's settings, its record (the whole of it, oldest first) and the store's purchase orders.
type Shop struct {
	Settings Settings
	Entries  []accounting.Entry
	Orders   []Order
}

// Setup is MonthlyReportSetup.
type Setup struct {
	// Source is what the numbers were counted from: written on the report and in the message.
	Source string
	// PagesDir and PagesBaseURL: where the report folders go (one folder per report, named by a random token) and the address that folder is served at (https, no trailing slash).
	PagesDir, PagesBaseURL string
	Options                func() Options
	// Key signs the report. nil: it carries a digest and a code and says it is not signed.
	Key ed25519.PrivateKey
	// GoLive is what the go-live certificate the shop was given shows. nil: the report says none was given.
	GoLive func() report.GoLiveFinding
	// Token is the test seam: the random part of the folder name.
	Token func() string
	// Tenant is the ledger tenant (the shop's id on the server, report.tenant in runtime.json): the report is anchored to the head of the record. "": its anchor is null.
	Tenant string
	// Shop reads the shop's settings, record and orders when a report is made.
	Shop func() Shop
}

func randomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// NewMonthlyJob is createMonthlyReport(setup): the job with Stock orders' report.
func NewMonthlyJob(setup Setup) *report.MonthlyJob {
	return &report.MonthlyJob{Make: func(a report.MakeArgs) (report.MadeReport, error) {
		opts := setup.Options()
		shop := setup.Shop()
		token := randomToken()
		if setup.Token != nil {
			token = setup.Token()
		}
		folder := filepath.Join(setup.PagesDir, token)
		prepared := opts.PreparedBy
		run := Run{Settings: shop.Settings, Entries: shop.Entries, Orders: shop.Orders, Month: a.Month, Language: a.Language, Out: folder, Source: setup.Source, Key: setup.Key,
			PreparedBy: &prepared, Innovator: opts.Innovator, Now: a.Now, Tenant: setup.Tenant}
		if setup.GoLive != nil {
			g := setup.GoLive()
			run.GoLive = &g
		}
		made, err := WriteStockReport(run)
		if err != nil {
			return report.MadeReport{}, err
		}
		// the check link is the report's signed summary (run.go) when it is signed, so the owner can tap it and check the report with no file
		message, err := MonthlyReportMessage(made.Report, a.Language, fmt.Sprintf("%s/%s/report-%s-%s.html", setup.PagesBaseURL, token, a.Month, a.Language), made.Check)
		if err != nil {
			return report.MadeReport{}, err
		}
		return report.MadeReport{Code: made.Code, Folder: folder, Page: token, Text: message.Text, Template: message.Template}, nil
	}}
}
