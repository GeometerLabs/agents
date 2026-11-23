package stockorders

// The monthly report and the owner's morning line on Stock orders' clock beat: templates/commerce/stock-orders/server/runtime.ts (`monthly: createMonthlyReport(options.report)`) and modules/runtime/core.ts step, which
// runs the job on a tick AFTER the agent's own work, saving for itself (a claim in the record before it sends, the ending after), so a restart between the two finds the claim and never
// sends twice. It runs from runtime.AfterTicker, never from Agent.Tick, whose step is saved whole or not at all. In the licence's final stop the shop sends nothing more, so no report goes.
//
// The report itself is internal/stockordersreport (the TypeScript's report/ folder); the `report` block of runtime.json and the shop's messaging are read by the shared runtime
// (runtime.ReadReportConfig, runtime.ReportMessagingOf), so this file holds only what is Stock orders': the settings tree and the orders the job reads, and the beat.

import (
	"regexp"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/report"
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
	mu  sync.Mutex
	job *report.MonthlyJob
	cur ReportTick
	msg report.Messaging
	// the last failure said in the log, said once and again each hour it goes on (core.ts lastReportError)
	failed   string
	failedAt int64
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
func NewMonthlyReport(cfg *runtime.ReportConfig, s *Settings, m messaging.Messaging) *MonthlyReport {
	r := &MonthlyReport{msg: runtime.ReportMessagingOf(m)}
	tree := s.Tree() // the file's settings as validated, which is what the TypeScript's job digests (the owner's tightened limits are not in it)
	setup := stockordersreport.Setup{
		Source: cfg.Source, PagesDir: cfg.PagesDir, PagesBaseURL: cfg.PagesBaseURL, Key: cfg.Key, Tenant: cfg.Tenant,
		Options: func() stockordersreport.Options {
			name, badge := cfg.Options()
			return stockordersreport.Options{PreparedBy: name, Innovator: badge}
		},
		Shop: func() stockordersreport.Shop {
			return stockordersreport.Shop{Settings: tree, Entries: r.cur.Rec.Entries(), Orders: OrdersOf(r.cur.Store)}
		},
	}
	if cfg.GoLiveFile != "" {
		file := cfg.GoLiveFile
		setup.GoLive = func() report.GoLiveFinding { return stockordersreport.ReadGoLive(file, tree).Finding }
	}
	r.job = stockordersreport.NewMonthlyJob(setup)
	return r
}

// Run is the job's `run(ctx)`: one look at whether last month's report is due and, if so, make it, claim it, send it and write the ending.
func (m *MonthlyReport) Run(t ReportTick, s *Settings) (report.MonthlyResult, error) {
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
	return m.job.Run(report.JobContext{Timezone: s.Timezone, OwnerWhatsapp: s.Owner.WhatsApp, OwnerLanguage: s.Owner.Language, Now: t.Now, Messaging: m.msg,
		Record: runtime.ReportRecordOf(t.Rec), Save: save, Log: t.Log})
}

// pathLike is a word with a path in it: the paths in a failure's message (a new random folder each time) are left out of the comparison.
var pathLike = regexp.MustCompile(`\S*[\\/]\S*`)

// failedOnce is core.ts's catch around the monthly report: said once, and again each hour it goes on.
func (m *MonthlyReport) failedOnce(err error, now int64, log func(string)) {
	same := pathLike.ReplaceAllString(err.Error(), "…")
	if same != m.failed || now-m.failedAt >= hour {
		log("The monthly report could not be made: " + err.Error())
		m.failed, m.failedAt = same, now
	}
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
			a.kit.Report.failedOnce(err, a.now(), a.c.Log)
		}
	}
	if a.msg == nil {
		return // no WhatsApp: nothing to send a line on
	}
	if err := a.c.Morning(runtime.MorningContext{Skill: &skill{a}, Messaging: a.msg, Save: save}); err != nil {
		a.c.Log("The owner's morning line could not be made: " + err.Error())
	}
}
