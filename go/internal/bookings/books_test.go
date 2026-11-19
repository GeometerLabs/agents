// Tests of the books adapters (books.go): the record, the settlement read, the report's messaging and its faults, the Bookings conversion, and the monthly report end to end over a record
// and a messaging double: it is made once, sent once, claimed and ended in the record, and not made again. The numbers inside a report are proved in internal/bookingsreport; here is
// only that the adapters join the pieces.
package bookings

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

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

// memRecord is a RecordSource over a slice: a line gets the next number and the time of the clock it is given.
type memRecord struct {
	lines []store.Entry
	now   int64
}

func (m *memRecord) Entries() []store.Entry { return append([]store.Entry(nil), m.lines...) }
func (m *memRecord) Append(l runtime.NewLine) store.Entry {
	var booking *string
	if l.Booking != "" {
		b := l.Booking
		booking = &b
	}
	refs := l.Refs
	if refs == nil {
		refs = map[string]string{}
	}
	e := store.Entry{Seq: len(m.lines) + 1, Time: "2026-12-01T05:00:00.000Z", Conversation: l.Conversation, Booking: booking, Action: l.Action, InputsDigest: "d", Outcome: l.Outcome, Decisions: nil, Language: l.Language, Notes: l.Notes, Refs: refs}
	m.lines = append(m.lines, e)
	return e
}

func TestRecordAdapterWritesALineWithNoCaseAsNull(t *testing.T) {
	rec := &memRecord{}
	b := NewBooks(BooksPorts{})
	r := b.Record(rec)
	r.Append(accounting.NewEntry{Conversation: "+911", Action: "settlements_read", Outcome: "confirmed", Language: "en", Refs: map[string]string{"day": "2026-11-30"}})
	c := "b-1"
	r.Append(accounting.NewEntry{Conversation: "+911", Booking: &c, Action: "x", Outcome: "confirmed", Language: "en"})
	got := r.Entries()
	if len(got) != 2 || got[0].Booking != nil || got[1].Booking == nil || *got[1].Booking != "b-1" || got[0].Refs["day"] != "2026-11-30" {
		t.Fatalf("lines: %+v", got)
	}
}

func TestAccountingReadsBookingsActionNames(t *testing.T) {
	rec := &memRecord{}
	a, err := NewBooks(BooksPorts{}).Accounting(rec, "Asia/Kolkata", func() int64 { return 0 })
	if err != nil || a == nil {
		t.Fatal(err)
	}
	if a.Journal() == nil {
		t.Error("the accounting has a journal")
	}
}

type fakeSettlements struct {
	rows []payments.SettlementRow
	err  error
	day  payments.Day
}

func (r *fakeSettlements) ReadSettlements(_ context.Context, d payments.Day, _ int) ([]payments.SettlementRow, error) {
	r.day = d
	return r.rows, r.err
}

func TestSettlementPayments(t *testing.T) {
	if NewBooks(BooksPorts{}).SettlementPayments() != nil {
		t.Error("no client: no settlement read")
	}
	if NewBooks(BooksPorts{Settlements: &fakeSettlements{}}).SettlementPayments() != nil {
		t.Error("a provider whose capabilities say it reads none is not asked")
	}
	pid := "pay_1"
	rd := &fakeSettlements{rows: []payments.SettlementRow{{EntityID: "pay_1", Type: "payment", PaymentID: &pid, Amount: 20000, Fee: 472, Tax: 72, Credit: 19528, Settled: true}}}
	p := NewBooks(BooksPorts{Settlements: rd, Capabilities: payments.Capabilities{ReadsSettlements: true}}).SettlementPayments()
	if p == nil || !p.ReadsSettlements() {
		t.Fatal("a provider that reads settlements has the adapter")
	}
	rows, err := p.ReadSettlements(zone.Date{Year: 2026, Month: 11, Day: 30})
	if err != nil || len(rows) != 1 || rows[0].Amount != 20000 || *rows[0].PaymentID != "pay_1" || rd.day != (payments.Day{Year: 2026, Month: 11, Day: 30}) {
		t.Fatalf("rows %+v err %v day %+v", rows, err, rd.day)
	}
	rd.err = errors.New("the read failed")
	if _, err := p.ReadSettlements(zone.Date{Year: 2026, Month: 11, Day: 30}); err == nil {
		t.Error("a failed read is an error")
	}
	// the job: a day that cannot be read writes nothing and says so
	rec := &memRecord{}
	acct, _ := NewBooks(BooksPorts{}).Accounting(rec, "Asia/Kolkata", func() int64 { return 0 })
	books := NewBooks(BooksPorts{Settlements: rd, Capabilities: payments.Capabilities{ReadsSettlements: true}})
	res, ran := books.ReadSettlements(rec, acct, "+919800000000", "en", 1_764_550_000_000, "Asia/Kolkata")
	if !ran || res.Status != "failed" || len(rec.lines) != 0 {
		t.Errorf("result %+v ran %v lines %d", res, ran, len(rec.lines))
	}
	if _, ran := NewBooks(BooksPorts{}).ReadSettlements(rec, acct, "x", "en", 0, "Asia/Kolkata"); ran {
		t.Error("no read: not run")
	}
}

func TestReportFaults(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		nothing  bool // report.NothingWasSent: it may be tried again
		isWindow bool
	}{
		{"window closed", &guard.WindowClosedError{}, true, true},
		{"refused connection", &guard.NotSentError{Message: "refused", Code: "ECONNREFUSED"}, true, false},
		{"a 404", &guard.ApiError{Status: 404, Message: "no"}, true, false},
		{"a 500", &guard.ApiError{Status: 500, Message: "no"}, false, false},
		{"a timeout", &guard.TimeoutError{What: "send"}, false, false},
		{"guard busy", &guard.GuardError{Kind: guard.KindUnavailable, Status: 503, Message: "busy"}, true, false},
		{"another error", errors.New("boom"), false, false},
	}
	for _, c := range cases {
		got := reportFault(c.err)
		var w *report.WindowClosedError
		if report.NothingWasSent(got) != c.nothing || errors.As(got, &w) != c.isWindow {
			t.Errorf("%s: nothingWasSent %v window %v", c.name, report.NothingWasSent(got), errors.As(got, &w))
		}
		if got.Error() != c.err.Error() {
			t.Errorf("%s: words changed: %q", c.name, got.Error())
		}
	}
	if reportFault(nil) != nil {
		t.Error("no error stays none")
	}
}

// double is a messaging.Messaging with an open window that remembers what it sent; withDocs adds the optional file send.
type double struct {
	open  bool
	texts []string
	tmpl  []messaging.TemplateMessage
}

func (d *double) SendText(_ context.Context, to, text string) (messaging.OutboundMessage, error) {
	if !d.open {
		return messaging.OutboundMessage{}, &guard.WindowClosedError{}
	}
	d.texts = append(d.texts, text)
	return messaging.OutboundMessage{ID: "wamid.1"}, nil
}
func (d *double) SendTemplate(_ context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	d.tmpl = append(d.tmpl, t)
	return messaging.OutboundMessage{ID: "wamid.2"}, nil
}
func (d *double) IsWindowOpen(context.Context, string) (bool, error) { return d.open, nil }
func (d *double) GetMessage(_ context.Context, id string) (*messaging.OutboundMessage, error) {
	return &messaging.OutboundMessage{ID: id}, nil
}

type withDocs struct {
	*double
	docs []messaging.DocumentMessage
}

func (w *withDocs) SendDocument(_ context.Context, to string, d messaging.DocumentMessage) (messaging.OutboundMessage, error) {
	w.docs = append(w.docs, d)
	return messaging.OutboundMessage{ID: "wamid.3"}, nil
}

func TestReportMessagingIsADocumentSenderOnlyWhenTheClientCanSendAFile(t *testing.T) {
	if NewBooks(BooksPorts{}).ReportMessaging() != nil {
		t.Error("no WhatsApp: no report messaging")
	}
	plain := NewBooks(BooksPorts{Messaging: &double{}}).ReportMessaging()
	if _, ok := plain.(report.DocumentSender); ok {
		t.Error("a client without files is not asked to send one")
	}
	w := &withDocs{double: &double{}}
	m := NewBooks(BooksPorts{Messaging: w}).ReportMessaging()
	ds, ok := m.(report.DocumentSender)
	if !ok {
		t.Fatal("a client with files is a DocumentSender")
	}
	if _, err := ds.SendDocument("+91", report.Document{Link: "https://x/y.txt", Filename: "y.txt", Caption: "c"}); err != nil || len(w.docs) != 1 || *w.docs[0].Caption != "c" {
		t.Errorf("document %+v err %v", w.docs, err)
	}
	// a template with no header image carries none; a closed window is the report's own fault
	if _, err := m.SendTemplate("+91", report.Template{Name: "n", Language: "en", Text: "t", Parameters: []string{"a"}}); err != nil || w.tmpl[0].HeaderImage != nil || w.tmpl[0].Parameters[0] != "a" {
		t.Errorf("template %+v err %v", w.tmpl, err)
	}
	if _, err := m.SendText("+91", "hi"); !errors.As(err, new(*report.WindowClosedError)) {
		t.Errorf("a closed window should be report's fault, got %v", err)
	}
}

func TestBookingsOf(t *testing.T) {
	st := NewStore()
	a, b := &Booking{ID: "b-1", State: Confirmed}, &Booking{ID: "b-2", State: NeedsOwner, Pending: []Pending{{Kind: "calendar"}, {Kind: "refund"}}}
	st.Bookings = append(st.Bookings, a, b)
	got := BookingsOf(st)
	want := []bookingsreport.Booking{{ID: "b-1", State: "confirmed"}, {ID: "b-2", State: "needs_owner", Pending: 2}}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("got %+v", got)
	}
}

func TestMonthlyReportIsMadeAndSentOnce(t *testing.T) {
	s := exampleSettings(t)
	tick := zone.ZonedToMs(zone.Date{Year: 2026, Month: 12, Day: 1}, 10, 0, s.Timezone) // the 1st, after 09:00
	rec := &memRecord{}
	// a month with something in it: two lines on 12 and 15 November
	for _, day := range []string{"2026-11-12", "2026-11-15"} {
		rec.lines = append(rec.lines, store.Entry{Seq: len(rec.lines) + 1, Time: day + "T05:00:00.000Z", Conversation: "+919811111111", Action: "message_received", InputsDigest: "d", Outcome: "confirmed", Language: "en", Refs: map[string]string{}})
	}
	m := &withDocs{double: &double{open: true}}
	dir := t.TempDir()
	job := NewBooks(BooksPorts{Messaging: m}).NewMonthlyReport(MonthlyReportSetup{Source: "stand-in", PagesDir: dir, PagesBaseURL: "https://reports.example/r", Options: func() bookingsreport.Options { return bookingsreport.Options{PreparedBy: "Divya"} },
		Token: func() string { return "tok" }})
	saves := 0
	tk := ReportTick{Settings: s, Store: NewStore(), Rec: rec, Now: func() int64 { return tick }, Save: func() { saves++ }}
	res, err := job.Run(tk)
	if err != nil || !res.Done || res.Month != "2026-11" || res.Outcome != "confirmed" || res.Via != "text" {
		t.Fatalf("first run: %+v err %v", res, err)
	}
	if len(m.texts) != 1 || !strings.Contains(m.texts[0], "https://reports.example/r/tok/report-2026-11-") || len(m.docs) != 1 || saves < 2 {
		t.Errorf("texts %q docs %+v saves %d", m.texts, m.docs, saves)
	}
	if _, err := os.Stat(filepath.Join(dir, "tok", "report-2026-11.json")); err != nil {
		t.Errorf("the report was not written: %v", err)
	}
	sent := 0
	for _, e := range rec.lines {
		if e.Action == "send_message" && e.Refs["report"] == "2026-11" {
			sent++
		}
	}
	if sent != 2 { // the claim and the ending
		t.Errorf("record has %d report lines, want 2", sent)
	}
	// a second beat finds it done and sends nothing
	again, err := job.Run(tk)
	if err != nil || again.Done || len(m.texts) != 1 {
		t.Errorf("second run: %+v err %v texts %d", again, err, len(m.texts))
	}
	// the final stop sends nothing; no WhatsApp sends nothing
	if r, _ := job.Run(ReportTick{Settings: s, Store: NewStore(), Rec: rec, Now: func() int64 { return tick }, Licence: "stopped"}); r.Why != "stopped" {
		t.Errorf("licence stopped: %+v", r)
	}
	if r, _ := NewBooks(BooksPorts{}).NewMonthlyReport(MonthlyReportSetup{}).Run(tk); r.Done || r.Why != "no-messaging" {
		t.Errorf("no messaging: %+v", r)
	}
}
