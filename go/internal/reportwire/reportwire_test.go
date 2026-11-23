// Tests of the one shared report wiring (what Bookings' books_test.go held before 23 Nov, when its copy of the adapters was folded onto this package): the messaging faults the monthly
// job reads, a client that sends a file being a DocumentSender, and a line written with no case being null. The report's numbers are proved in the template report packages.
package reportwire

import (
	"context"
	"errors"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// memRecord is a RecordSource over a slice.
type memRecord struct{ lines []store.Entry }

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
	e := store.Entry{Seq: len(m.lines) + 1, Time: "2026-12-01T05:00:00.000Z", Conversation: l.Conversation, Booking: booking, Action: l.Action, InputsDigest: "d", Outcome: l.Outcome, Language: l.Language, Notes: l.Notes, Refs: refs}
	m.lines = append(m.lines, e)
	return e
}

// double is a messaging.Messaging with a window that is open or closed; withDocs adds the optional file send.
type double struct {
	open bool
	tmpl []messaging.TemplateMessage
}

func (d *double) SendText(_ context.Context, to, text string) (messaging.OutboundMessage, error) {
	if !d.open {
		return messaging.OutboundMessage{}, &guard.WindowClosedError{}
	}
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


func TestRecordAdapterWritesALineWithNoCaseAsNull(t *testing.T) {
	rec := &memRecord{}
	r := Record(rec)
	r.Append(accounting.NewEntry{Conversation: "+911", Action: "settlements_read", Outcome: "confirmed", Language: "en", Refs: map[string]string{"day": "2026-11-30"}})
	c := "b-1"
	r.Append(accounting.NewEntry{Conversation: "+911", Booking: &c, Action: "x", Outcome: "confirmed", Language: "en"})
	got := r.Entries()
	if len(got) != 2 || got[0].Booking != nil || got[1].Booking == nil || *got[1].Booking != "b-1" || got[0].Refs["day"] != "2026-11-30" {
		t.Fatalf("lines: %+v", got)
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

func TestReportMessagingIsADocumentSenderOnlyWhenTheClientCanSendAFile(t *testing.T) {
	if MessagingOf(nil) != nil {
		t.Error("no WhatsApp: no report messaging")
	}
	plain := MessagingOf(&double{})
	if _, ok := plain.(report.DocumentSender); ok {
		t.Error("a client without files is not asked to send one")
	}
	w := &withDocs{double: &double{}}
	m := MessagingOf(w)
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
