package fees

// The monthly report's side of a Fees centre (templates/education/fees/report/monthly-job.ts and server/start.ts monthlyReportSetup): the centre's validated settings as the tree the report
// digests, the fees as the name-free list the report reads, and the job's wiring over the centre's messaging. The report itself (data, page, owner text, WhatsApp message, signed
// summary) is internal/feesreport; the generic half of the wiring (the `report` block of runtime.json, the messaging adapter, running a job on a beat) is internal/reportwire.
//
// STUDENTS' NAMES NEVER LEAVE THE CENTRE AS THEMSELVES. ReportTree reduces each student to an empty object (the policy digest takes only HOW MANY students there are), and DuesOf hands the
// report the month, the state, the count of payments and the balance of each fee, never the student, the parent or the batch. So the report cannot print a name it never received.

import (
	"github.com/GeometerLabs/agents/go/internal/feesreport"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
)

// ReportTree is the centre's settings as validateSettings returns them (what policyDigest is of, feesreport.PolicyDigest), with each student reduced to an empty object: the digest counts
// the students and nothing else of them, so no name or number is in the tree the report is given. A member the TypeScript leaves out (`address` when none, `joiningMidMonth` when
// "usual", `approvers`, `assistant`, `classes`) is left out here. Numbers are float64, as JSON.parse reads them.
func (s *Settings) ReportTree() map[string]any {
	n := func(v int64) any { return float64(v) }
	strs := func(l []string) []any {
		out := make([]any, len(l))
		for i, x := range l {
			out[i] = x
		}
		return out
	}
	batches := make([]any, len(s.Batches))
	for i, b := range s.Batches {
		names := map[string]any{}
		for lang, list := range b.Names {
			names[lang] = strs(list)
		}
		batches[i] = map[string]any{"id": b.ID, "names": names, "monthlyFeeInr": n(b.MonthlyFeeInr)}
	}
	days := make([]any, len(s.Reminders.DaysFromDue))
	for i, d := range s.Reminders.DaysFromDue {
		days[i] = n(d)
	}
	payment := map[string]any{"module": s.Payment.Module}
	if s.Payment.Module == "upi" {
		payment["upi"] = map[string]any{"id": s.Payment.UpiID, "payee": s.Payment.Payee}
	}
	t := map[string]any{
		"name": s.Name, "timezone": s.Timezone, "languages": strs(s.Languages), "batches": batches, "students": make([]any, len(s.Students)),
		"due": map[string]any{"day": n(s.Due.Day), "graceDays": n(s.Due.GraceDays)}, "lateFeeInr": n(s.LateFeeInr),
		"reminders":    map[string]any{"daysFromDue": days, "hour": n(s.Reminders.Hour), "maxPerMonth": n(s.Reminders.MaxPerMonth)},
		"partPayments": map[string]any{"allowed": s.PartPayments.Allowed, "minInr": n(s.PartPayments.MinInr)},
		"waiver":       map[string]any{"limitInr": n(s.WaiverLimitInr)}, "refund": map[string]any{"limitInr": n(s.RefundLimitInr)},
		"payment": payment, "owner": map[string]any{"whatsapp": s.Owner.Whatsapp, "language": s.Owner.Language},
	}
	for i := range s.Students {
		t["students"].([]any)[i] = map[string]any{}
	}
	if s.JoiningMidMonth != "usual" {
		t["joiningMidMonth"] = s.JoiningMidMonth
	}
	if s.HasAddress {
		t["address"] = s.Address
	}
	if s.Approvers != nil {
		t["approvers"] = s.Approvers
	}
	if s.Assistant != nil {
		t["assistant"] = s.Assistant
	}
	if c := s.Classes; c != nil {
		timetable := map[string]any{}
		for id, slots := range c.Timetable {
			list := make([]any, len(slots))
			for i, sl := range slots {
				list[i] = map[string]any{"day": float64(sl.Day), "hour": float64(sl.Hour), "minute": float64(sl.Minute), "minutes": float64(sl.Minutes)}
			}
			timetable[id] = list
		}
		t["classes"] = map[string]any{"timetable": timetable, "linkLeadMinutes": n(c.LinkLeadMinutes), "materialMaxMb": n(c.MaterialMaxMb), "oldDuesStopLink": c.OldDuesStopLink}
	}
	if c := s.Credit; c != nil {
		// report/data.ts policyOf: the credit book's people are counted like the students, so no name or number is in the tree
		t["creditBook"] = map[string]any{"maxPerPersonInr": n(c.MaxPerPersonInr), "remindEveryDays": n(c.RemindEveryDays), "people": float64(len(c.People))}
	}
	return t
}

// DuesOf is what feesreport reads of the centre's fees, oldest first: the month, the state, how many payments were counted and what is still to pay. Nothing that names a student.
func DuesOf(st *Store) []feesreport.Due {
	out := make([]feesreport.Due, len(st.Dues))
	for i, d := range st.Dues {
		out[i] = feesreport.Due{Month: d.Month, State: d.State, Payments: len(d.Payments), BalancePaise: balancePaise(d)}
	}
	return out
}

// MonthlyReport is the monthly job for Fees, made once per process: it remembers which month it found sent, so a beat that comes every few seconds does not read the record.
type MonthlyReport struct {
	*reportwire.Runner
	cur *Agent // the beat's agent while Run holds the lock: the report's Shop reads the settings, record and fees from it
	// Failed says a report that could not be made once an hour (core.ts's catch around the monthly report).
	Failed reportwire.FailureLog
}

// NewMonthlyReport is createMonthlyReport(setup) over this centre's messaging (nil: no WhatsApp, and a beat does nothing). The settings the report digests are the centre's own, read from
// the beat's agent each time a report is made, so a change to the settings file needs no restart.
func NewMonthlyReport(setup reportwire.Setup, m messaging.Messaging) *MonthlyReport {
	r := &MonthlyReport{}
	fs := feesreport.Setup{
		Source: setup.Source, PagesDir: setup.PagesDir, PagesBaseURL: setup.PagesBaseURL, Key: setup.Key, Tenant: setup.Tenant,
		Options: func() feesreport.Options {
			o := setup.Options()
			return feesreport.Options{PreparedBy: o.PreparedBy, Innovator: o.Innovator}
		},
		Shop: func() feesreport.Shop {
			return feesreport.Shop{Settings: r.cur.settings.ReportTree(), Entries: r.cur.c.Rec.Entries(), Dues: DuesOf(r.cur.store)}
		},
	}
	if file := setup.GoLiveFile; file != "" {
		fs.GoLive = func() report.GoLiveFinding { return feesreport.ReadGoLive(file, r.cur.settings.ReportTree()).Finding }
	}
	r.Runner = reportwire.NewRunner(feesreport.NewMonthlyJob(fs), m)
	return r
}

// runReport is core.ts's monthly report on a beat: it claims in the record and saves BEFORE it sends and writes its ending and saves after, so a restart between the two finds the claim
// and never sends twice. A failure is said in the log (once an hour) and never holds up the beat.
func (a *Agent) runReport(save func() error) {
	saveLogged := func() {
		if err := save(); err != nil {
			a.c.Log("The centre's state could not be saved in the middle of the beat: " + err.Error())
		}
	}
	m := a.kit.Report
	_, err := m.Run(reportwire.Tick{Timezone: a.settings.Timezone, OwnerWhatsapp: a.settings.Owner.Whatsapp, OwnerLanguage: a.settings.Owner.Language, Licence: a.c.Licence(),
		Now: a.now, Rec: a.c.Rec, Save: saveLogged, Log: a.c.Log}, func() func() { m.cur = a; return func() { m.cur = nil } })
	if err != nil {
		m.Failed.Failed(err, a.now(), a.c.Log)
	}
}
