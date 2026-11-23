package stockorders

// The monthly report and the owner's morning line on Stock orders' clock beat: templates/commerce/stock-orders/server/runtime.ts (`monthly: createMonthlyReport(options.report)`) and modules/runtime/core.ts step, which
// runs the job on a tick AFTER the agent's own work, saving for itself (a claim in the record before it sends, the ending after), so a restart between the two finds the claim and never
// sends twice. It runs from runtime.AfterTicker, never from Agent.Tick, whose step is saved whole or not at all. In the licence's final stop the shop sends nothing more, so no report goes.
//
// The report itself is internal/stockordersreport (the TypeScript's report/ folder); the `report` block of runtime.json, the shop's messaging and the beat's runner are the one shared
// copy in internal/reportwire, so this file holds only what is Stock orders': the settings tree and the orders the job reads, and the beat.

import (
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stockordersreport"
)

var _ runtime.AfterTicker = (*Agent)(nil)

// OrdersOf is what stockordersreport reads of the store's purchase orders, oldest first.
func OrdersOf(st *Store) []stockordersreport.Order {
	out := make([]stockordersreport.Order, len(st.Orders))
	for i, o := range st.Orders {
		out[i] = stockordersreport.Order{State: o.State, Supplier: o.Supplier, TotalPaise: o.TotalPaise, CreatedMs: &o.CreatedMs, ApprovedMs: o.ApprovedMs, SentMs: o.SentMs, Ack: o.Ack, Receipt: o.Receipt}
	}
	return out
}

// MonthlyReport is the monthly job for Stock orders, made once per process: it remembers which month it found sent, so a tick that comes every few seconds does not read the record.
type MonthlyReport struct {
	*reportwire.Runner
	cur ReportTick
	// Failed says a report that could not be made once an hour (core.ts lastReportError).
	Failed reportwire.FailureLog
}

// ReportTick is what the monthly job is given on the clock's beat (core.ts: `monthly.run({settings, clock, messaging, record, store, log, save})`).
type ReportTick struct {
	Store *Store
	Rec   *runtime.Recorder
	Now   func() int64
	Save  func()
	Log   func(string)
}

// NewMonthlyReport is createMonthlyReport(setup) over this shop's settings and messaging. A shop with no WhatsApp has none: Run says "no-messaging" and does nothing.
func NewMonthlyReport(setup reportwire.Setup, s *Settings, m messaging.Messaging) *MonthlyReport {
	r := &MonthlyReport{}
	tree := s.Tree() // the file's settings as validated, which is what the TypeScript's job digests (the owner's tightened limits are not in it)
	rs := stockordersreport.Setup{
		Source: setup.Source, PagesDir: setup.PagesDir, PagesBaseURL: setup.PagesBaseURL, Key: setup.Key, Tenant: setup.Tenant, Token: setup.Token,
		Options: func() stockordersreport.Options {
			o := setup.Options()
			return stockordersreport.Options{PreparedBy: o.PreparedBy, Innovator: o.Innovator}
		},
		Shop: func() stockordersreport.Shop {
			return stockordersreport.Shop{Settings: tree, Entries: r.cur.Rec.Entries(), Orders: OrdersOf(r.cur.Store)}
		},
	}
	if file := setup.GoLiveFile; file != "" {
		rs.GoLive = func() report.GoLiveFinding { return stockordersreport.ReadGoLive(file, tree).Finding }
	}
	r.Runner = reportwire.NewRunner(stockordersreport.NewMonthlyJob(rs), m)
	return r
}

// Run is the job's `run(ctx)`: one look at whether last month's report is due and, if so, make it, claim it, send it and write the ending.
func (m *MonthlyReport) Run(t ReportTick, s *Settings) (report.MonthlyResult, error) {
	return m.Runner.Run(reportwire.Tick{Timezone: s.Timezone, OwnerWhatsapp: s.Owner.WhatsApp, OwnerLanguage: s.Owner.Language, Now: t.Now, Rec: t.Rec, Save: t.Save, Log: t.Log},
		func() func() { m.cur = t; return func() { m.cur = ReportTick{} } })
}

// AfterTick is core.ts's monthly report on a beat, after the agent's own work, then (item 11e) the owner's morning line over this template's skill, read-only, with the same save so its
// claim is on disk before it goes. A failure is said in the log and never holds up the beat. In the licence's final stop the shop sends nothing more: neither goes.
func (a *Agent) AfterTick(save func() error) {
	if a.c.Licence() == "stopped" {
		return
	}
	if a.kit.Report != nil {
		saveLogged := func() {
			if err := save(); err != nil {
				a.c.Log("The shop's state could not be saved in the middle of the beat: " + err.Error())
			}
		}
		if _, err := a.kit.Report.Run(ReportTick{Store: a.st, Rec: a.c.Rec, Now: a.now, Save: saveLogged, Log: a.c.Log}, a.kit.Settings); err != nil {
			a.kit.Report.Failed.Failed(err, a.now(), a.c.Log)
		}
	}
	if a.msg == nil {
		return // no WhatsApp: nothing to send a line on
	}
	if err := a.c.Morning(runtime.MorningContext{Skill: &skill{a}, Messaging: a.msg, Save: save}); err != nil {
		a.c.Log("The owner's morning line could not be made: " + err.Error())
	}
}
