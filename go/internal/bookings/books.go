package bookings

// The books side of the Bookings runtime: the adapters that join the Bookings state and the shared services to the books (internal/accounting), the report (internal/report) and the
// Bookings report (internal/bookingsreport), which each ask only for small interfaces of their own. One constructor, NewBooks, takes the services of one shop and hands the agent core
// everything it calls:
//
//	books := bookings.NewBooks(bookings.BooksPorts{Messaging: m, Settlements: razorpayClient, Capabilities: razorpay.Capabilities})
//	acct, err := books.Accounting(c.Rec, settings.Timezone, a.c.Now)  // agent.ts bookingsAccounting: every money line goes through acct.Post
//	books.ReadSettlements(c.Rec, acct, owner, settings.Languages[0], now, tz)  // agent.ts onTick: yesterday's settlement rows, once a day
//	report := books.NewMonthlyReport(setup)                      // once per process (the job remembers the month it found done)
//	report.Run(bookings.ReportTick{...})                         // on the clock's beat, after the step
//
// What each adapter is:
//   - Record: accounting.Record (Entries, Append) over the runtime's record writer (*runtime.Recorder): Append is a runtime.NewLine, so the line gets its keyed digest and its sequence
//     number exactly as the agent's own log lines do (record.ts append).
//   - Payments for the settlement read: accounting.Payments over the payments Guard client's optional payments.SettlementReader (the Razorpay recon read); a shop whose provider cannot read
//     settlements (UPI, or none) has none and the read is skipped (agent.ts `if (can.readsSettlements)`).
//   - Messaging for the report: report.Messaging and, when the messaging client can send a file, report.DocumentSender, over messaging.Messaging (which takes a context and has its own error
//     types). Errors are turned into report's faults (reportFault) because the job decides what may be tried again from them: a closed 24-hour window, "nothing was sent" and a refusal.
//   - Bookings for the report: bookingsreport.Booking (the id, the state and how many steps wait) from the Bookings store, oldest first, as the TypeScript passes `[...store.bookings.values()]`.
//   - The settings for the report: the VALIDATED tree (settings_check.go Tree), never the raw file: the policy digest is of the validated settings.
//
// Where Go differs: the TypeScript's calls are async; here they block (the runtime runs a step at a time). A context is taken once, in BooksPorts, and used for every call.

import (
	"context"
	"crypto/ed25519"
	"errors"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// RecordSource is the shop's record as the books use it: the whole of it, and a way to append a line. *runtime.Recorder is one.
type RecordSource interface {
	Entries() []store.Entry
	Append(runtime.NewLine) store.Entry
}

var _ RecordSource = (*runtime.Recorder)(nil)

// BooksPorts are the services the books need. Every field may be nil: no WhatsApp (`services: {}`) means no report is sent; a provider that cannot read settlements means none is read.
type BooksPorts struct {
	// Messaging sends the monthly report to the owner. If it also implements messaging.Documents the certificate goes as a file.
	Messaging messaging.Messaging
	// Settlements is the payments client's settlement read (payments.SettlementReader); Capabilities says whether the provider has one (ReadsSettlements).
	Settlements  payments.SettlementReader
	Capabilities payments.Capabilities
	// Context is used for every call to a service; nil is context.Background().
	Context context.Context
}

// Books is the books side of one shop's runtime.
type Books struct{ p BooksPorts }

// NewBooks is the one constructor of this file: see the file's comment.
func NewBooks(p BooksPorts) *Books {
	if p.Context == nil {
		p.Context = context.Background()
	}
	return &Books{p: p}
}

// ---- the record ----

type recordAdapter struct{ r RecordSource }

func (a recordAdapter) Entries() []accounting.Entry { return a.r.Entries() }

// Append is record.ts append: a line without a case is written with a null `booking`.
func (a recordAdapter) Append(n accounting.NewEntry) accounting.Entry {
	booking := ""
	if n.Booking != nil {
		booking = *n.Booking
	}
	return a.r.Append(runtime.NewLine{Conversation: n.Conversation, Booking: booking, Action: n.Action, Outcome: n.Outcome, Inputs: n.Inputs, Language: n.Language, Notes: n.Notes, Refs: n.Refs})
}

// Record is accounting.Record over the shop's record.
func (b *Books) Record(rec RecordSource) accounting.Record { return recordAdapter{rec} }

type clockFunc func() int64

func (f clockFunc) Now() int64 { return f() }

// Accounting is bookingsAccounting: the shop's accounting over the very record the agent's log appends to, read with Bookings' own action names (accounting.BookingsLegacy).
func (b *Books) Accounting(rec RecordSource, timezone string, now func() int64) (accounting.Accounting, error) {
	return accounting.BookingsAccounting(recordAdapter{rec}, timezone, clockFunc(now))
}

// Journal is bookingsJournal over the record as it is now: what the page's receipts, the owner's Money section and the accountant's files are built from.
func (b *Books) Journal(rec RecordSource) *accounting.Journal {
	return accounting.BookingsJournal(rec.Entries())
}

// ---- the settlement read ----

type settlementPayments struct {
	r   payments.SettlementReader
	ctx context.Context
}

func (settlementPayments) ReadsSettlements() bool { return true }

// ReadSettlements is the provider's report for one day, every page of it; the rows are the same fields in the same units (paise, epoch seconds).
func (s settlementPayments) ReadSettlements(day zone.Date) ([]accounting.SettlementRow, error) {
	rows, err := s.r.ReadSettlements(s.ctx, payments.Day{Year: day.Year, Month: day.Month, Day: day.Day}, 0)
	if err != nil {
		return nil, err
	}
	out := make([]accounting.SettlementRow, len(rows))
	for i, r := range rows {
		out[i] = accounting.SettlementRow(r)
	}
	return out, nil
}

// SettlementPayments is accounting.Payments for the daily settlement read, or nil when this shop's provider reads none (its capabilities say ReadsSettlements false, or the client has no read).
func (b *Books) SettlementPayments() accounting.Payments {
	if !b.p.Capabilities.ReadsSettlements || b.p.Settlements == nil {
		return nil
	}
	return settlementPayments{b.p.Settlements, b.p.Context}
}

// ReadSettlements is the line agent.ts onTick runs: `if (can.readsSettlements) readSettlementsOnce({payments, accounting: books, record, conversation: owner, language: languages[0],
// nowMs, timeZone})`. ran is false (and nothing is written) when this shop's provider reads none. A failed read is in the result (Status "failed"), not an error: the next tick tries again.
func (b *Books) ReadSettlements(rec RecordSource, acct accounting.Accounting, owner, language string, nowMs int64, timeZone string) (res accounting.SettlementsResult, ran bool) {
	p := b.SettlementPayments()
	if p == nil {
		return res, false
	}
	return accounting.ReadSettlementsOnce(accounting.SettlementsInput{Payments: p, Accounting: acct, Record: recordAdapter{rec}, Conversation: owner, Language: language, NowMs: nowMs, TimeZone: timeZone}), true
}

// ---- messaging for the report ----

// reportFault turns a messaging error into the report package's own faults, which the monthly job reads to decide whether a send may be tried again (nothingWasSent) and whether the
// owner's window was closed. A fault of any other kind goes through as it is.
func reportFault(err error) error {
	if err == nil {
		return nil
	}
	var closed *guard.WindowClosedError
	switch {
	case errors.As(err, &closed):
		return &report.WindowClosedError{}
	case guard.IsNotSent(err):
		return &report.NotSentError{Msg: err.Error()}
	}
	if g, ok := guard.AsGuard(err); ok && g.Kind == guard.KindUnavailable {
		return &report.GuardUnavailableError{Status: g.Status, Msg: g.Message}
	}
	if status, ok := guard.IsAPI(err); ok {
		return &report.APIError{Status: status, Msg: err.Error()}
	}
	return err
}

type reportMessaging struct {
	m   messaging.Messaging
	ctx context.Context
}

func (r reportMessaging) IsWindowOpen(to string) (bool, error) {
	open, err := r.m.IsWindowOpen(r.ctx, to)
	return open, reportFault(err)
}

func (r reportMessaging) SendText(to, text string) (report.Outbound, error) {
	o, err := r.m.SendText(r.ctx, to, text)
	return report.Outbound{ID: o.ID}, reportFault(err)
}

func (r reportMessaging) SendTemplate(to string, t report.Template) (report.Outbound, error) {
	m := messaging.TemplateMessage{Name: t.Name, Language: t.Language, Text: t.Text, Parameters: t.Parameters}
	if t.HeaderImage != "" {
		h := t.HeaderImage
		m.HeaderImage = &h
	}
	o, err := r.m.SendTemplate(r.ctx, to, m)
	return report.Outbound{ID: o.ID}, reportFault(err)
}

func (r reportMessaging) GetMessage(id string) (*report.Outbound, error) {
	o, err := r.m.GetMessage(r.ctx, id)
	if err != nil || o == nil {
		return nil, reportFault(err)
	}
	return &report.Outbound{ID: o.ID}, nil
}

// reportMessagingDocs is the same with the optional `sendDocument` (a client that cannot send a file is simply not asked: the job looks for report.DocumentSender).
type reportMessagingDocs struct {
	reportMessaging
	d messaging.Documents
}

func (r reportMessagingDocs) SendDocument(to string, d report.Document) (report.Outbound, error) {
	caption := d.Caption
	o, err := r.d.SendDocument(r.ctx, to, messaging.DocumentMessage{Link: d.Link, Filename: d.Filename, Caption: &caption})
	return report.Outbound{ID: o.ID}, reportFault(err)
}

// ReportMessaging is report.Messaging over the shop's WhatsApp client, or nil when the shop has none. It is a report.DocumentSender as well when the client can send a file.
func (b *Books) ReportMessaging() report.Messaging {
	if b.p.Messaging == nil {
		return nil
	}
	base := reportMessaging{b.p.Messaging, b.p.Context}
	if d, ok := b.p.Messaging.(messaging.Documents); ok {
		return reportMessagingDocs{base, d}
	}
	return base
}

// ---- the Bookings for the report ----

// BookingsOf is the conversion bookingsreport needs: each booking's id, its state and how many steps wait for the owner, oldest first.
func BookingsOf(st *Store) []bookingsreport.Booking {
	out := make([]bookingsreport.Booking, len(st.Bookings))
	for i, b := range st.Bookings {
		out[i] = bookingsreport.Booking{ID: b.ID, State: b.State, Pending: len(b.Pending)}
	}
	return out
}

// ---- the monthly report ----

// MonthlyReportSetup is MonthlyReportSetup (report/monthly-job.ts): what the numbers were counted from, where the report folders go, who set the agent up, the key that signs.
type MonthlyReportSetup struct {
	// Source is what the numbers were counted from: written on the report and in the message.
	Source string
	// PagesDir and PagesBaseURL: where the report folders go (one folder per report, named by a random token) and the address that folder is served at (https, no trailing slash).
	PagesDir, PagesBaseURL string
	// Options is read each time a report is made, so a change to the badge or the name needs no restart.
	Options func() bookingsreport.Options
	// Key signs the report and the certificate; nil: they carry a digest and a code and say they are not signed.
	Key ed25519.PrivateKey
	// GoLive is what the go-live certificate the shop was given shows; nil: the report says none was given.
	GoLive func() report.GoLiveFinding
	// Tenant is the ledger tenant (report.tenant in runtime.json); "": the report's anchor is null.
	Tenant string
	// Token is the test seam: the random part of the folder name.
	Token func() string
}

// ReportTick is what the monthly job is given on the clock's beat (core.ts: `monthly.run({settings, clock, messaging, record, store, log, save})`).
type ReportTick struct {
	Settings *Settings
	Store    *Store
	Rec      RecordSource
	Now      func() int64
	// Licence is the shop's licence now ("", "paused" or "stopped"): in the final stop the shop sends nothing more, so no report goes.
	Licence string
	// Save saves the record as it is now. The job calls it after its claim (before anything goes out) and after its ending, so a restart in between finds the claim and never sends twice.
	// nil: nothing is saved in between (the runtime then saves with the step, and a crash between the send and the step's save could send the same month twice).
	Save func()
	Log  func(string)
}

// MonthlyReport is the monthly job for Bookings (plan B54), made once per process: it remembers which month it found sent, so a tick that comes every few seconds does not read the record.
type MonthlyReport struct {
	mu  sync.Mutex
	job *report.MonthlyJob
	cur ReportTick // what the report in the making reads: set for the length of one Run
	msg report.Messaging
}

// NewMonthlyReport is createMonthlyReport(setup) over this shop's messaging. A shop with no WhatsApp has none: the returned job's Run says "no-messaging" and does nothing.
func (b *Books) NewMonthlyReport(setup MonthlyReportSetup) *MonthlyReport {
	m := &MonthlyReport{msg: b.ReportMessaging()}
	m.job = bookingsreport.NewMonthlyJob(bookingsreport.Setup{
		Source: setup.Source, PagesDir: setup.PagesDir, PagesBaseURL: setup.PagesBaseURL, Options: setup.Options, Key: setup.Key, GoLive: setup.GoLive, Token: setup.Token, Tenant: setup.Tenant,
		Shop: func() bookingsreport.Shop {
			return bookingsreport.Shop{Settings: m.cur.Settings.Tree(), Entries: m.cur.Rec.Entries(), Bookings: BookingsOf(m.cur.Store)}
		},
	})
	return m
}

// Run is the job's `run(ctx)`: one look at whether last month's report is due and, if so, make it, claim it, send it and write the ending. Call it on the clock's beat AFTER the step's own work
// (core.ts). It is not safe for two runs at once (one instance per shop, one tick at a time). The error is only from making the report: the caller says it once an hour and goes on.
func (m *MonthlyReport) Run(t ReportTick) (report.MonthlyResult, error) {
	if t.Licence == "stopped" {
		return report.MonthlyResult{Why: "stopped"}, nil
	}
	if m.msg == nil {
		return report.MonthlyResult{Why: "no-messaging"}, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cur = t
	defer func() { m.cur = ReportTick{} }()
	save := t.Save
	if save == nil {
		save = func() {}
	}
	return m.job.Run(report.JobContext{Timezone: t.Settings.Timezone, OwnerWhatsapp: t.Settings.Owner.Whatsapp, OwnerLanguage: t.Settings.Owner.Language, Now: t.Now, Messaging: m.msg,
		Record: recordAdapter{t.Rec}, Save: save, Log: t.Log})
}
