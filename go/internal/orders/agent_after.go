package orders

// What rides on the clock's beat AFTER the agent's own work and saves for itself (modules/runtime/core.ts step, for Orders): the owner's licence notice (server/licence.ts over
// modules/licence/notice.ts, the shared runtime.RunLicenceNotice) and the monthly report (report/monthly-job.ts, ordersreport.NewMonthlyJob). Each claims in the record and saves
// BEFORE it sends, and writes its ending and saves after, so a restart between the two finds the claim and never sends twice. They run from runtime.AfterTicker, never from
// Agent.Tick, whose step is saved whole or not at all. The owner's morning line (morning.ts) is G3's, after the report. The `report` block of runtime.json, the messaging adapter and the
// beat's runner are the one shared copy in internal/reportwire (23 Nov: Stream CL folded this template's copy of them onto it); what is left here is Orders' own: the orders the report
// reads and the report's Shop.

import (
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/ordersreport"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// WhoSetItUp is licence.ts WHO_SET_IT_UP: who to contact when the lease names no Operator (only for a runtime started by hand).
var WhoSetItUp = map[string]string{"en": "the person who set it up", "hi": "इसे सेट करने वाले व्यक्ति", "ml": "ഇത് ക്രമീകരിച്ച വ്യക്തിയെ", "kn": "ಇದನ್ನು ಸಿದ್ಧಪಡಿಸಿದವರನ್ನು"}

var _ runtime.AfterTicker = (*Agent)(nil)

// AfterTick is core.ts's licence notice and monthly report on a beat, in that order. A failure is said in the log and never holds up the beat.
func (a *Agent) AfterTick(save func() error) {
	saveLogged := func() {
		if err := save(); err != nil {
			a.c.Log("The shop's state could not be saved in the middle of the beat: " + err.Error())
		}
	}
	if _, _, err := runtime.RunLicenceNotice(runtime.NoticeContext{
		Licence: a.c.Licence(), PaidThrough: a.paidThrough(), Owner: a.owner(), Language: a.settings.Owner.Language, Now: a.now(), Messaging: a.ownerMessaging(a.kit.Ports.WhatsApp),
		Rec: a.c.Rec, Save: save, Log: a.c.Log, Message: a.licenceMessage,
	}); err != nil {
		a.c.Log("The owner's licence notice could not be sent: " + err.Error())
	}
	// in the licence's final stop the shop sends nothing more, so no report and no morning line go
	if a.c.Licence() == "stopped" {
		return
	}
	if a.kit.Report != nil {
		if _, err := a.kit.Report.Run(ReportTick{Settings: a.settings, Store: a.store, Rec: a.c.Rec, Now: a.now, Licence: a.c.Licence(), Save: saveLogged, Log: a.c.Log}); err != nil {
			a.kit.Report.Failed.Failed(err, a.now(), a.c.Log)
		}
	}
	// item 11e: the owner's morning line (morning.ts), after the report, with the same save so its claim is on disk before it goes; the skill reads the store, read-only
	if err := a.c.Morning(runtime.MorningContext{Skill: &ordersSkill{a: a}, Messaging: a.ownerMessaging(a.kit.Ports.WhatsApp), Save: save}); err != nil {
		a.c.Log("The owner's morning line could not be made: " + err.Error())
	}
}

// licenceMessage is licence.ts createOrdersLicenceNotice's `message`: the wind-down's or the final stop's words in the owner's language, naming the Operator, with how many orders
// are still confirmed; and the approved template that carries the same words outside the owner's window.
func (a *Agent) licenceMessage(kind string) (string, messaging.TemplateMessage, error) {
	lang := a.settings.Owner.Language
	id := "owner_licence_paused"
	if kind == "stop" {
		id = "owner_licence_stopped"
	}
	var upcoming int64
	for _, o := range a.store.Orders {
		if o.State == Confirmed {
			upcoming++
		}
	}
	partner := ""
	if a.c.Partner != nil {
		partner = a.c.Partner()
	}
	if partner == "" {
		partner = WhoSetItUp[lang]
	}
	f := a.settings.FactsFor(nil, lang, FactsExtra{})
	f.Partner, f.UpcomingCount = words.S(partner), words.N(upcoming)
	text, err := words.Render(id, f)
	if err != nil {
		return "", messaging.TemplateMessage{}, err
	}
	m := words.MetaTemplateMessage([]string{id}, f, text, words.WordsFor("en").Generic.Owner)
	return text, messaging.TemplateMessage{Name: m.Name, Language: m.Language, Text: m.Text, Parameters: m.Parameters}, nil
}

// ---- the monthly report (report/monthly-job.ts) --------------------------------------------------------------------------------------------------------------------

// OrdersOf is what ordersreport reads of the store's orders, oldest first.
func OrdersOf(st *Store) []ordersreport.Order {
	out := make([]ordersreport.Order, len(st.Orders))
	for i, o := range st.Orders {
		r := ordersreport.Order{ID: o.ID, State: o.State, Pending: len(o.Pending), Mode: o.Mode}
		if o.Date != nil {
			d := zone.Date{Year: o.Date.Year, Month: o.Date.Month, Day: o.Date.Day}
			r.Date = &d
		}
		for _, l := range o.Lines {
			r.Lines = append(r.Lines, ordersreport.OrderLine{ItemID: l.ItemID, Qty: int(l.Qty)})
		}
		if o.TotalInr != nil {
			r.TotalInr = *o.TotalInr
		}
		if o.AdvanceInr != nil {
			r.AdvanceInr = *o.AdvanceInr
		}
		if b := o.balance(); b != nil && b.Paid != nil {
			r.BalancePaid = true
		}
		out[i] = r
	}
	return out
}

// ReportTick is what the monthly job is given on the clock's beat (core.ts: `monthly.run({settings, clock, messaging, record, store, log, save})`).
type ReportTick struct {
	Settings *Settings
	Store    *Store
	Rec      reportwire.RecordSource
	Now      func() int64
	Licence  string
	Save     func()
	Log      func(string)
}

// MonthlyReport is the monthly job for Orders, made once per process: it remembers which month it found sent, so a tick that comes every few seconds does not read the record.
type MonthlyReport struct {
	*reportwire.Runner
	cur ReportTick // what the report in the making reads: set for the length of one Run
	// Failed says a report that could not be made once an hour (core.ts's catch around the monthly report).
	Failed reportwire.FailureLog
}

// NewMonthlyReport is createMonthlyReport(setup) over this shop's messaging. A shop with no WhatsApp has none: Run says "no-messaging" and does nothing.
func NewMonthlyReport(setup reportwire.Setup, m messaging.Messaging) *MonthlyReport {
	r := &MonthlyReport{}
	rs := ordersreport.Setup{
		Source: setup.Source, PagesDir: setup.PagesDir, PagesBaseURL: setup.PagesBaseURL, Key: setup.Key, Tenant: setup.Tenant, Token: setup.Token,
		Options: func() ordersreport.Options {
			o := setup.Options()
			return ordersreport.Options{PreparedBy: o.PreparedBy, Innovator: o.Innovator}
		},
		Shop: func() ordersreport.Shop {
			return ordersreport.Shop{Settings: r.cur.Settings.Tree(), Entries: r.cur.Rec.Entries(), Orders: OrdersOf(r.cur.Store)}
		},
	}
	if file := setup.GoLiveFile; file != "" {
		rs.GoLive = func() report.GoLiveFinding { return ordersreport.ReadGoLive(file, r.cur.Settings.Tree()).Finding }
	}
	r.Runner = reportwire.NewRunner(ordersreport.NewMonthlyJob(rs), m)
	return r
}

// Run is the job's `run(ctx)`: one look at whether last month's report is due and, if so, make it, claim it, send it and write the ending.
func (m *MonthlyReport) Run(t ReportTick) (report.MonthlyResult, error) {
	return m.Runner.Run(reportwire.Tick{Timezone: t.Settings.Timezone, OwnerWhatsapp: t.Settings.Owner.Whatsapp, OwnerLanguage: t.Settings.Owner.Language, Licence: t.Licence,
		Now: t.Now, Rec: t.Rec, Save: t.Save, Log: t.Log}, func() func() { m.cur = t; return func() { m.cur = ReportTick{} } })
}
