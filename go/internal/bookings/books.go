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
//   - Record: accounting.Record over the runtime's record writer, the one shared adapter (reportwire.Record).
//   - Payments for the settlement read: accounting.Payments over the payments Guard client's optional payments.SettlementReader (the Razorpay recon read); a shop whose provider cannot read
//     settlements (UPI, or none) has none and the read is skipped (agent.ts `if (can.readsSettlements)`).
//   - Messaging for the report: the one shared adapter (reportwire.MessagingOf, with the faults the job reads to decide what may be tried again).
//   - Bookings for the report: bookingsreport.Booking (the id, the state and how many steps wait) from the Bookings store, oldest first, as the TypeScript passes `[...store.bookings.values()]`.
//   - The settings for the report: the VALIDATED tree (settings_check.go Tree), never the raw file: the policy digest is of the validated settings.
//
// Where Go differs: the TypeScript's calls are async; here they block (the runtime runs a step at a time). A context is taken once, in BooksPorts, and used for every call.

import (
	"context"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

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

type clockFunc func() int64

func (f clockFunc) Now() int64 { return f() }

// Accounting is bookingsAccounting: the shop's accounting over the very record the agent's log appends to, read with Bookings' own action names (accounting.BookingsLegacy).
func (b *Books) Accounting(rec reportwire.RecordSource, timezone string, now func() int64) (accounting.Accounting, error) {
	return accounting.BookingsAccounting(reportwire.Record(rec), timezone, clockFunc(now))
}

// Journal is bookingsJournal over the record as it is now: what the page's receipts, the owner's Money section and the accountant's files are built from.
func (b *Books) Journal(rec reportwire.RecordSource) *accounting.Journal {
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
func (b *Books) ReadSettlements(rec reportwire.RecordSource, acct accounting.Accounting, owner, language string, nowMs int64, timeZone string) (res accounting.SettlementsResult, ran bool) {
	p := b.SettlementPayments()
	if p == nil {
		return res, false
	}
	return accounting.ReadSettlementsOnce(accounting.SettlementsInput{Payments: p, Accounting: acct, Record: reportwire.Record(rec), Conversation: owner, Language: language, NowMs: nowMs, TimeZone: timeZone}), true
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

// ReportTick is what the monthly job is given on the clock's beat (core.ts: `monthly.run({settings, clock, messaging, record, store, log, save})`).
type ReportTick struct {
	Settings *Settings
	Store    *Store
	Rec      reportwire.RecordSource
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
	*reportwire.Runner
	cur ReportTick // what the report in the making reads: set for the length of one Run
	// Failed says a report that could not be made once an hour (core.ts's catch around the monthly report).
	Failed reportwire.FailureLog
}

// NewMonthlyReport is createMonthlyReport(setup) over this shop's messaging. A shop with no WhatsApp has none: the returned job's Run says "no-messaging" and does nothing. The setup is
// the one shared reading of runtime.json's `report` block (reportwire.ReadSetup).
func (b *Books) NewMonthlyReport(setup reportwire.Setup) *MonthlyReport {
	m := &MonthlyReport{}
	rs := bookingsreport.Setup{
		Source: setup.Source, PagesDir: setup.PagesDir, PagesBaseURL: setup.PagesBaseURL, Key: setup.Key, Tenant: setup.Tenant, Token: setup.Token,
		Options: func() bookingsreport.Options {
			o := setup.Options()
			return bookingsreport.Options{PreparedBy: o.PreparedBy, Innovator: o.Innovator}
		},
		Shop: func() bookingsreport.Shop {
			return bookingsreport.Shop{Settings: m.cur.Settings.Tree(), Entries: m.cur.Rec.Entries(), Bookings: BookingsOf(m.cur.Store)}
		},
	}
	if file := setup.GoLiveFile; file != "" {
		rs.GoLive = func() report.GoLiveFinding { return bookingsreport.ReadGoLive(file, m.cur.Settings.Tree()).Finding }
	}
	m.Runner = reportwire.NewRunner(bookingsreport.NewMonthlyJob(rs), b.p.Messaging)
	return m
}

// Run is the job's `run(ctx)`: one look at whether last month's report is due and, if so, make it, claim it, send it and write the ending. Call it on the clock's beat AFTER the step's own work
// (core.ts). It is not safe for two runs at once (one instance per shop, one tick at a time). The error is only from making the report: the caller says it once an hour and goes on.
func (m *MonthlyReport) Run(t ReportTick) (report.MonthlyResult, error) {
	return m.Runner.Run(reportwire.Tick{Timezone: t.Settings.Timezone, OwnerWhatsapp: t.Settings.Owner.Whatsapp, OwnerLanguage: t.Settings.Owner.Language, Licence: t.Licence,
		Now: t.Now, Rec: t.Rec, Save: t.Save, Log: t.Log}, func() func() { m.cur = t; return func() { m.cur = ReportTick{} } })
}
