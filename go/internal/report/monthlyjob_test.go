// Tests of the once-a-month sender over an in-memory messaging fake and record: when it may go (09:00 on the 1st in the shop's zone), the claim saved before the send and the ending
// after, a restart finding the month done, a claim with no ending (a crash) closed as "may have gone out" and never sent again, a lost reply, refusals tried again after an hour
// three times at most, the errors that are not refusals, a quiet month, the certificate document, and only the month that just ended. The cases are the situations of
// templates/commerce/bookings/test/report-monthly.test.ts that belong to the generic job.
package report

import (
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

const owner = "919876543210"

// fakeRecord is an in-memory record whose lines are stamped by the shop's clock.
type fakeRecord struct {
	entries []store.Entry
	now     *int64
	saves   int
}

func (r *fakeRecord) Entries() []accounting.Entry { return append([]accounting.Entry{}, r.entries...) }
func (r *fakeRecord) Append(n accounting.NewEntry) accounting.Entry {
	refs := map[string]string{}
	for k, v := range n.Refs {
		refs[k] = v
	}
	e := store.Entry{Seq: len(r.entries) + 1, Time: time.UnixMilli(*r.now).UTC().Format("2006-01-02T15:04:05.000Z"), Conversation: n.Conversation, Action: n.Action, Outcome: n.Outcome,
		Language: n.Language, Notes: n.Notes, Refs: refs}
	r.entries = append(r.entries, e)
	return e
}
func (r *fakeRecord) lines(outcome string) (n int) {
	for _, e := range r.entries {
		if e.Action == "send_message" && e.Outcome == outcome {
			n++
		}
	}
	return n
}

type fakeMessaging struct {
	windowOpen                                      bool
	textErr, templateErr, getErr, docErr, windowErr error
	lostReply                                       bool
	texts, templates, docs                          []string
	next                                            int
}

func (m *fakeMessaging) IsWindowOpen(string) (bool, error) { return m.windowOpen, m.windowErr }
func (m *fakeMessaging) id() Outbound                      { m.next++; return Outbound{"wamid." + strconv.Itoa(m.next)} }
func (m *fakeMessaging) SendText(_, text string) (Outbound, error) {
	if m.textErr != nil {
		return Outbound{}, m.textErr
	}
	m.texts = append(m.texts, text)
	return m.id(), nil
}
func (m *fakeMessaging) SendTemplate(_ string, tpl Template) (Outbound, error) {
	if m.templateErr != nil {
		return Outbound{}, m.templateErr
	}
	m.templates = append(m.templates, tpl.Name)
	return m.id(), nil
}
func (m *fakeMessaging) GetMessage(id string) (*Outbound, error) {
	if m.getErr != nil {
		return nil, m.getErr
	}
	if m.lostReply {
		return nil, nil
	}
	return &Outbound{id}, nil
}

type docMessaging struct{ *fakeMessaging }

func (m docMessaging) SendDocument(_ string, d Document) (Outbound, error) {
	if m.docErr != nil {
		return Outbound{}, m.docErr
	}
	m.docs = append(m.docs, d.Filename)
	return m.id(), nil
}

type shop struct {
	t       *testing.T
	now     int64
	rec     *fakeRecord
	msg     *fakeMessaging
	msgIf   Messaging
	job     *MonthlyJob
	logs    []string
	made    []MakeArgs
	cert    bool
	makeErr error
}

const tz = "Asia/Kolkata"

func at(y, m, d, h, mi int) int64 {
	return zone.ZonedToMs(zone.Date{Year: y, Month: m, Day: d}, h, mi, tz)
}

// newShop starts a shop whose record has one booking line in November 2026, at the given moment.
func newShop(t *testing.T, now int64, withActivity bool) *shop {
	s := &shop{t: t, now: now, msg: &fakeMessaging{}}
	s.rec = &fakeRecord{now: &s.now}
	s.msgIf = s.msg
	if withActivity {
		s.rec.entries = append(s.rec.entries, store.Entry{Seq: 1, Time: "2026-11-10T05:00:00.000Z", Conversation: "c1", Action: "create_booking", Outcome: "confirmed", Refs: map[string]string{}})
	}
	s.job = &MonthlyJob{Make: func(a MakeArgs) (MadeReport, error) {
		s.made = append(s.made, a)
		if s.makeErr != nil {
			return MadeReport{}, s.makeErr
		}
		m := MadeReport{Code: "7K2M-9QXD", Folder: "/pages/abc", Page: "abc", Text: "Your November report", Template: Template{Name: "monthly_report", Language: a.Language, Text: "t"}}
		if s.cert {
			m.Certificate = &CertificateDoc{Filename: "certificate.txt", Link: "https://x/certificate.txt", Caption: "cap", Code: "CERT-0001"}
		}
		return m, nil
	}}
	return s
}

func (s *shop) run() MonthlyResult {
	s.t.Helper()
	return s.runWith(s.job)
}

func (s *shop) runWith(job *MonthlyJob) MonthlyResult {
	s.t.Helper()
	m := s.msgIf
	if s.cert {
		m = docMessaging{s.msg}
	}
	res, err := job.Run(JobContext{Timezone: tz, OwnerWhatsapp: owner, OwnerLanguage: "en", Now: func() int64 { return s.now }, Messaging: m, Record: s.rec, Save: func() { s.rec.saves++ }, Log: func(l string) { s.logs = append(s.logs, l) }})
	if err != nil {
		s.t.Fatal(err)
	}
	return res
}

func TestNothingBefore9OnTheFirstThenOnceAsATemplate(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 8, 59), true)
	if r := s.run(); r.Done || r.Why != "not-yet" {
		t.Fatalf("08:59: %+v", r)
	}
	s.now = at(2026, 12, 1, 9, 0)
	r := s.run()
	if !r.Done || r.Month != "2026-11" || r.Outcome != "confirmed" || r.Via != "template" {
		t.Fatalf("09:00: %+v", r)
	}
	if len(s.msg.templates) != 1 || len(s.msg.texts) != 0 || s.msg.templates[0] != "monthly_report" || s.made[0].Month != "2026-11" || s.made[0].Language != "en" {
		t.Fatalf("what went out: %+v %+v", s.msg, s.made)
	}
	// the claim and the ending, each saved, with the report's key in refs
	if s.rec.saves != 2 || s.rec.lines("attempted") != 1 || s.rec.lines("confirmed") != 1 {
		t.Fatalf("saves %d, record %+v", s.rec.saves, s.rec.entries)
	}
	claim, end := s.rec.entries[1], s.rec.entries[2]
	if claim.Refs["report"] != "2026-11" || claim.Refs["code"] != "7K2M-9QXD" || claim.Refs["page"] != "abc" || claim.Refs["templates"] != "monthly_report" || end.Refs["via"] != "template" || end.Refs["messageId"] != "wamid.1" {
		t.Errorf("refs: %v %v", claim.Refs, end.Refs)
	}
	// a tick again, and a restart over the saved record: nothing is sent twice
	if r := s.run(); r.Done || r.Why != "already" {
		t.Errorf("again: %+v", r)
	}
	fresh := &MonthlyJob{Make: s.job.Make}
	if r := s.runWith(fresh); r.Done || r.Why != "already" {
		t.Errorf("restart: %+v", r)
	}
	if len(s.msg.templates) != 1 || len(s.made) != 1 {
		t.Error("sent or made twice")
	}
}

func TestACrashBetweenClaimAndEndingNeverSendsAgain(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 30), true)
	s.rec.Append(accounting.NewEntry{Conversation: owner, Action: "send_message", Outcome: "attempted", Language: "en", Refs: map[string]string{"to": "owner", "report": "2026-11", "code": "7K2M-9QXD", "page": "abc"}})
	if r := s.run(); r.Done || r.Why != "already" {
		t.Fatalf("%+v", r)
	}
	last := s.rec.entries[len(s.rec.entries)-1]
	if last.Outcome != "unconfirmed" || !strings.Contains(last.Notes, "may or may not have reached the owner") || last.Refs["code"] != "7K2M-9QXD" || last.Refs["page"] != "abc" || s.rec.saves != 1 {
		t.Errorf("the closing line: %+v (saves %d)", last, s.rec.saves)
	}
	if len(s.msg.templates)+len(s.msg.texts) != 0 || len(s.made) != 0 || len(s.logs) != 1 {
		t.Error("something was sent or made")
	}
	if r := s.run(); r.Why != "already" || s.rec.lines("unconfirmed") != 1 {
		t.Errorf("a second tick: %+v", r)
	}
}

func TestALostReplyIsUnconfirmedAndNeverResent(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.lostReply = true
	if r := s.run(); !r.Done || r.Outcome != "unconfirmed" {
		t.Fatalf("%+v", r)
	}
	s.now += 5 * Hour
	if r := s.run(); r.Done || r.Why != "already" || len(s.msg.templates) != 1 {
		t.Errorf("sent again: %+v", r)
	}
}

const Hour = RetryAfterMs

func TestRefusalIsTriedAgainAnHourLaterThreeTimesAtMost(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.templateErr = &APIError{400, "template not approved"}
	if r := s.run(); !r.Done || r.Outcome != "failed" {
		t.Fatalf("first: %+v", r)
	}
	if !strings.Contains(s.logs[0], "tried again in an hour (try 1 of 3)") || !strings.Contains(s.logs[0], "template not approved") {
		t.Errorf("log: %s", s.logs[0])
	}
	s.now += Hour - 1
	if r := s.run(); r.Done || r.Why != "waiting" {
		t.Errorf("before the hour: %+v", r)
	}
	s.now += 1
	if r := s.run(); !r.Done || r.Outcome != "failed" {
		t.Errorf("second: %+v", r)
	}
	s.now += Hour
	if r := s.run(); !r.Done || r.Outcome != "failed" {
		t.Errorf("third: %+v", r)
	}
	if !strings.Contains(s.logs[2], "That was the last try. The page is in /pages/abc.") {
		t.Errorf("last log: %s", s.logs[2])
	}
	s.now += 10 * Hour
	if r := s.run(); r.Done || r.Why != "gave-up" {
		t.Errorf("after three: %+v", r)
	}
	if s.rec.lines("failed") != 3 || len(s.made) != 3 {
		t.Errorf("failed %d made %d", s.rec.lines("failed"), len(s.made))
	}
	// a fresh process over the same record also gives up (and does not try)
	if r := s.runWith(&MonthlyJob{Make: s.job.Make}); r.Why != "gave-up" {
		t.Errorf("restart: %+v", r)
	}
}

func TestARefusalThatClearsIsSentOnce(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.templateErr = &NotSentError{"connection refused"}
	s.run()
	s.msg.templateErr = nil
	s.now += Hour
	if r := s.run(); !r.Done || r.Outcome != "confirmed" {
		t.Fatalf("%+v", r)
	}
	s.now += Hour
	if r := s.run(); r.Why != "already" || len(s.msg.templates) != 1 {
		t.Errorf("%+v", r)
	}
}

func TestOnlyARefusalThatSaysNothingWasSentIsTriedAgain(t *testing.T) {
	for name, err := range map[string]error{"5xx": &APIError{502, "bad gateway"}, "a surprise": errors.New("boom"), "a timeout": errors.New("timeout")} {
		s := newShop(t, at(2026, 12, 1, 9, 0), true)
		s.msg.templateErr = err
		if r := s.run(); !r.Done || r.Outcome != "unconfirmed" {
			t.Errorf("%s: %+v", name, r)
		}
		s.now += 3 * Hour
		if r := s.run(); r.Why != "already" {
			t.Errorf("%s again: %+v", name, r)
		}
	}
	// once WhatsApp has taken it, an error reading it back (even a 4xx) is not a refusal
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.getErr = &APIError{404, "no such message"}
	if r := s.run(); r.Outcome != "unconfirmed" || len(s.msg.templates) != 1 {
		t.Errorf("read-back: %+v", r)
	}
	if end := s.rec.entries[len(s.rec.entries)-1]; end.Refs["messageId"] != "wamid.1" || end.Notes != "no such message" {
		t.Errorf("ending: %+v", end)
	}
}

func TestOpenWindowSendsTextThenTheCertificateOnce(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.windowOpen = true
	s.cert = true
	r := s.run()
	if !r.Done || r.Via != "text" || r.Outcome != "confirmed" {
		t.Fatalf("%+v", r)
	}
	if len(s.msg.texts) != 1 || s.msg.texts[0] != "Your November report" {
		t.Errorf("text %v", s.msg.texts)
	}
	if s.rec.lines("attempted") != 2 || s.rec.lines("confirmed") != 2 || len(s.msg.docs) != 1 || s.msg.docs[0] != "certificate.txt" {
		t.Fatalf("record: %+v, documents %v", s.rec.entries, s.msg.docs)
	}
	doc := s.rec.entries[len(s.rec.entries)-1]
	if doc.Refs["reportFile"] != "2026-11" || doc.Refs["kind"] != "document" || doc.Refs["code"] != "CERT-0001" || doc.Refs["page"] != "abc" {
		t.Errorf("document line: %v", doc.Refs)
	}
	if r := s.run(); r.Why != "already" {
		t.Errorf("again: %+v", r)
	}
}

func TestADocumentTheProviderRefusesCostsNothing(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.windowOpen = true
	s.cert = true
	s.msg.docErr = &APIError{400, "bad file"}
	r := s.run()
	if !r.Done || r.Outcome != "confirmed" || r.Via != "text" {
		t.Fatalf("the report itself: %+v", r)
	}
	if end := s.rec.entries[len(s.rec.entries)-1]; end.Refs["reportFile"] != "2026-11" || end.Outcome != "failed" {
		t.Errorf("ending of the document: %+v", end)
	}
	s.now += 5 * Hour
	if r := s.run(); r.Why != "already" || s.rec.lines("failed") != 1 {
		t.Errorf("nothing is tried again: %+v", r)
	}
	// no document without an open window, and no document from a provider without one
	s2 := newShop(t, at(2026, 12, 1, 9, 0), true)
	s2.cert = true
	s2.run()
	if len(s2.rec.entries) != 3 {
		t.Errorf("a template report sends no document: %+v", s2.rec.entries)
	}
}

func TestAClosedWindowFallsBackToTheTemplate(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.windowOpen = true
	s.msg.textErr = &WindowClosedError{}
	if r := s.run(); !r.Done || r.Via != "template" || r.Outcome != "confirmed" || len(s.msg.templates) != 1 {
		t.Errorf("%+v", r)
	}
	// a window check that fails counts as closed
	s2 := newShop(t, at(2026, 12, 1, 9, 0), true)
	s2.msg.windowErr = errors.New("down")
	if r := s2.run(); r.Via != "template" {
		t.Errorf("%+v", r)
	}
	// a text that fails for another reason is not retried as a template: it may have gone out
	s3 := newShop(t, at(2026, 12, 1, 9, 0), true)
	s3.msg.windowOpen = true
	s3.msg.textErr = &APIError{500, "oops"}
	if r := s3.run(); r.Outcome != "unconfirmed" || len(s3.msg.templates) != 0 {
		t.Errorf("%+v", r)
	}
}

func TestAQuietMonthGetsNoMessageAndNoEntry(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), false)
	if r := s.run(); r.Done || r.Why != "quiet" {
		t.Fatalf("%+v", r)
	}
	// only this job's own lines, the licence's and a morning line: still quiet
	for _, refs := range []map[string]string{{"report": "2026-10"}, {"reportFile": "2026-10"}, {"licence": "state"}, {"morning": "2026-11-20"}} {
		s.rec.Append(accounting.NewEntry{Action: "send_message", Outcome: "confirmed", Refs: refs})
	}
	s.rec.Append(accounting.NewEntry{Action: "licence", Outcome: "confirmed"})
	s.job = &MonthlyJob{Make: s.job.Make}
	for i := range s.rec.entries {
		s.rec.entries[i].Time = "2026-11-12T05:00:00.000Z"
	}
	if r := s.run(); r.Why != "quiet" || len(s.made) != 0 || len(s.rec.entries) != 5 || s.rec.saves != 0 {
		t.Errorf("%+v, %d entries", r, len(s.rec.entries))
	}
	// activity only in an earlier month is quiet too, and activity the month after is not this month's
	s2 := newShop(t, at(2026, 12, 1, 9, 0), false)
	s2.rec.entries = []store.Entry{{Seq: 1, Time: "2026-10-31T18:00:00.000Z", Action: "create_booking", Refs: map[string]string{}}} // 23:30 on 31 Oct in Kolkata is before the month
	if r := s2.run(); r.Why != "quiet" {
		t.Errorf("an October line: %+v", r)
	}
	s3 := newShop(t, at(2026, 12, 1, 9, 0), false)
	s3.rec.entries = []store.Entry{{Seq: 1, Time: "2026-10-31T18:30:00.000Z", Action: "create_booking", Refs: map[string]string{}}} // 00:00 on 1 Nov in Kolkata: in the month
	if r := s3.run(); !r.Done {
		t.Errorf("a line at midnight on the 1st: %+v", r)
	}
}

func TestOnlyTheMonthThatJustEndedIsReported(t *testing.T) {
	// switched on late, on the 20th: still only the month before this one, never the months before it
	s := newShop(t, at(2026, 12, 20, 14, 0), true)
	r := s.run()
	if !r.Done || r.Month != "2026-11" {
		t.Fatalf("%+v", r)
	}
	// January looks back to December of the year before
	s2 := newShop(t, at(2027, 1, 1, 9, 0), false)
	s2.rec.entries = []store.Entry{{Seq: 1, Time: "2026-12-15T05:00:00.000Z", Action: "create_booking", Refs: map[string]string{}}}
	if r := s2.run(); !r.Done || r.Month != "2026-12" {
		t.Errorf("%+v", r)
	}
}

func TestAReportThatCannotBeMadeClaimsNothing(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.makeErr = errors.New("disk full")
	_, err := s.job.Run(JobContext{Timezone: tz, OwnerWhatsapp: owner, OwnerLanguage: "en", Now: func() int64 { return s.now }, Messaging: s.msg, Record: s.rec, Save: func() { s.rec.saves++ }})
	if err == nil || err.Error() != "disk full" || len(s.rec.entries) != 1 || s.rec.saves != 0 {
		t.Errorf("%v, %d entries, %d saves", err, len(s.rec.entries), s.rec.saves)
	}
	// and nothing is remembered: when it can be made, it goes
	s.makeErr = nil
	if r := s.run(); !r.Done {
		t.Errorf("%+v", r)
	}
}

func TestLogLinesNameTheOutcome(t *testing.T) {
	s := newShop(t, at(2026, 12, 1, 9, 0), true)
	s.msg.lostReply = true
	s.run()
	if len(s.logs) != 1 || s.logs[0] != "The monthly report for 2026-11 was sent, but WhatsApp did not show it back to the owner as a template (code 7K2M-9QXD)." {
		t.Errorf("%q", s.logs)
	}
}
