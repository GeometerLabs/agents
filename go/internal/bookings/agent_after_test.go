package bookings

// The monthly report on the beat (agent_after.go over the runtime's AfterTicker): the claim is on DISK before the report goes, so a process killed between the send and its
// ending leaves a store whose next start never sends the same month again. A real runtime over a real store: a customer writes in November (the month has something in it), the
// clock moves to 1 December after 09:00, and at the instant the report is handed to WhatsApp the store's files are copied, which is exactly what a crash at that instant leaves.
// A second runtime started on the copy, with a fresh WhatsApp, must send nothing and close the claim as unconfirmed.

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// crashingWhatsApp is a WhatsApp whose window is always open; at its first report send it copies the store's files (the state a crash at that instant leaves on disk).
type crashingWhatsApp struct {
	mu        sync.Mutex
	texts     []string
	reports   int
	dir, copy string
}

func (w *crashingWhatsApp) send(text string) messaging.OutboundMessage {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.texts = append(w.texts, text)
	if strings.Contains(text, "reports.example") {
		w.reports++
		if w.reports == 1 && w.copy != "" {
			for _, f := range []string{"agent.db", "agent.db-wal"} {
				if b, err := os.ReadFile(filepath.Join(w.dir, f)); err == nil {
					_ = os.WriteFile(filepath.Join(w.copy, f), b, 0o600)
				}
			}
		}
	}
	return messaging.OutboundMessage{ID: "wamid." + time.Now().Format("150405.000000000"), Text: text}
}
func (w *crashingWhatsApp) SendText(_ context.Context, to, text string) (messaging.OutboundMessage, error) {
	return w.send(text), nil
}
func (w *crashingWhatsApp) SendTemplate(_ context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	return w.send(t.Text), nil
}
func (w *crashingWhatsApp) IsWindowOpen(context.Context, string) (bool, error) { return true, nil }
func (w *crashingWhatsApp) GetMessage(_ context.Context, id string) (*messaging.OutboundMessage, error) {
	return &messaging.OutboundMessage{ID: id}, nil
}
func (w *crashingWhatsApp) reportCount() int { w.mu.Lock(); defer w.mu.Unlock(); return w.reports }

func reportLines(entries []store.Entry) []string {
	var out []string
	for _, e := range entries {
		if e.Action == "send_message" && e.Refs["report"] == "2026-11" {
			out = append(out, e.Outcome)
		}
	}
	return out
}

func TestMonthlyReportARestartAfterTheClaimNeverSendsTheMonthTwice(t *testing.T) {
	s := exampleSettings(t)
	var now atomic.Int64
	now.Store(zone.ZonedToMs(zone.Date{Year: 2026, Month: 11, Day: 12}, 11, 0, s.Timezone))
	clock := func() int64 { return now.Load() }
	start := func(dir string, wa *crashingWhatsApp) (*runtime.Runtime, *store.Store) {
		st, err := store.Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		books := NewBooks(BooksPorts{Messaging: wa})
		kit := &Kit{Settings: s, Now: clock, Ports: Ports{WhatsApp: wa, Books: books, Capabilities: payments.Capabilities{ConfirmsAutomatically: true, RefundsAutomatically: true}}}
		kit.Report = books.NewMonthlyReport(MonthlyReportSetup{Source: "stand-in", PagesDir: t.TempDir(), PagesBaseURL: "https://reports.example/r",
			Options: func() bookingsreport.Options { return bookingsreport.Options{PreparedBy: "Divya"} }})
		client := &runtime.Client{Folder: dir}
		client.Settings.Own, client.Settings.Name, client.Settings.Timezone = s, s.Name, s.Timezone
		client.Settings.Owner.Whatsapp, client.Settings.Owner.Language = s.Owner.Whatsapp, s.Owner.Language
		client.Config.DataDir, client.Config.Mode = dir, "fakes"
		rt, err := runtime.New(runtime.Options{Client: client, Store: st, Kit: kit, Now: clock, Log: func(string) {}})
		if err != nil {
			t.Fatal(err)
		}
		kit.Licence = rt.LicenceNow
		return rt, st
	}
	until := func(what string, done func() bool) {
		for i := 0; i < 400 && !done(); i++ {
			time.Sleep(10 * time.Millisecond)
		}
		if !done() {
			t.Fatalf("gave up waiting for %s", what)
		}
	}

	dir, crashed := t.TempDir(), t.TempDir()
	wa := &crashingWhatsApp{dir: dir, copy: crashed}
	rt, st := start(dir, wa)
	// November: a customer writes, so the month has something in it
	if _, _, err := rt.SubmitKit([]map[string]any{{"kind": "message", "message": map[string]any{"id": "wamid.in1", "from": "+919811111111", "text": "hi", "timestamp": float64(now.Load())}}}); err != nil {
		t.Fatal(err)
	}
	rt.Start(20 * time.Millisecond)
	until("the customer's answer", func() bool { c, _ := st.TaskCounts(); return c.Done == 1 })
	// 1 December, after 09:00: the beat makes November's report and sends it once
	now.Store(zone.ZonedToMs(zone.Date{Year: 2026, Month: 12, Day: 1}, 10, 0, s.Timezone))
	until("the report", func() bool { return wa.reportCount() == 1 })
	time.Sleep(100 * time.Millisecond)
	rt.Close()
	if wa.reportCount() != 1 {
		t.Fatalf("the report went %d times in one process", wa.reportCount())
	}
	_, entries, _ := st.LoadState()
	if got := reportLines(entries); strings.Join(got, ",") != "attempted,confirmed" {
		t.Fatalf("the first process's record: %v", got)
	}
	_ = st.Close()

	// the copy is the store as a crash at the moment of the send left it: the claim is in it, the ending is not
	again := &crashingWhatsApp{}
	rt2, st2 := start(crashed, again)
	_, before, _ := st2.LoadState()
	if got := reportLines(before); strings.Join(got, ",") != "attempted" {
		t.Fatalf("the claim was not on disk before the send: %v", got)
	}
	rt2.Start(20 * time.Millisecond)
	until("the claim to be closed", func() bool { _, e, _ := st2.LoadState(); return len(reportLines(e)) == 2 })
	time.Sleep(150 * time.Millisecond)
	rt2.Close()
	_, after, _ := st2.LoadState()
	if got := reportLines(after); strings.Join(got, ",") != "attempted,unconfirmed" || again.reportCount() != 0 {
		t.Fatalf("after the restart: record %v, reports sent %d (want the claim closed as unconfirmed and nothing sent)", got, again.reportCount())
	}
	_ = st2.Close()
}
