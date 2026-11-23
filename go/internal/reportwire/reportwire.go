// What a template's runtime needs to run the monthly report, the same for every template: the owner's messaging as the report package takes it (with the messaging faults turned into the
// report package's own, which the monthly job reads to decide whether a send may be tried again), the `report` block of runtime.json (modules/runtime/config.ts readReport with
// server/start.ts monthlyReportSetup: every problem said at once in the TypeScript's words), the report's name and badge read again whenever runtime.json changes (reportOptionsReader),
// and the once-an-hour telling of a report that could not be made (core.ts's catch around the monthly report).
//
// Why a package of its own, and the one copy: Bookings, Orders, Fees and Stock orders each carried a private copy of this wiring (23 Nov: Stream CL folded them onto this one, the
// best of the four because it also holds the beat's runner and the failure log, which the runtime's copy lacked; that copy, internal/runtime/reportwiring.go, is deleted). It depends
// on messaging, guard and runtime, so it cannot live in internal/report. The record adapter (accounting.Record over the shop's record) lives here too: the books use it as well.
package reportwire

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode/utf16"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// Options is `setup.options()`: who set the agent up and whether they have the Innovator badge.
type Options struct {
	PreparedBy string
	Innovator  bool
}

// Setup is the monthly report's setup as runtime.json gives it (start.ts monthlyReportSetup): what the numbers were counted from, where the report folders go and the address they are
// served at, who set the agent up (read again when the file changes), the key that signs ("" for none), the go-live certificate's file ("" for none) and the ledger tenant ("" for none).
type Setup struct {
	Source                 string
	PagesDir, PagesBaseURL string
	Options                func() Options
	Key                    ed25519.PrivateKey
	GoLiveFile             string
	Tenant                 string
	Token                  func() string // the test seam: the random part of a report folder's name (nil: a random one)
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

// FailureLog is core.ts's catch around the monthly report: a report that could not be made is said once, and again each hour it goes on; the paths in the message (a new random folder
// each time) are left out of the comparison.
type FailureLog struct {
	last string
	at   int64
}

// hourMs is an hour in milliseconds.
const hourMs = 3_600_000

var pathLike = regexp.MustCompile(`\S*[\\/]\S*`)

// Failed says the failure in the log when it is new or an hour old.
func (f *FailureLog) Failed(err error, now int64, log func(string)) {
	same := pathLike.ReplaceAllString(err.Error(), "…")
	if same != f.last || now-f.at >= hourMs {
		log("The monthly report could not be made: " + err.Error())
		f.last, f.at = same, now
	}
}

// reportFault turns a messaging error into the report package's own faults, which the monthly job reads to decide whether a send may be tried again.
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

type reportMessaging struct{ m messaging.Messaging }

func (r reportMessaging) IsWindowOpen(to string) (bool, error) {
	open, err := r.m.IsWindowOpen(context.Background(), to)
	return open, reportFault(err)
}

func (r reportMessaging) SendText(to, text string) (report.Outbound, error) {
	o, err := r.m.SendText(context.Background(), to, text)
	return report.Outbound{ID: o.ID}, reportFault(err)
}

func (r reportMessaging) SendTemplate(to string, t report.Template) (report.Outbound, error) {
	m := messaging.TemplateMessage{Name: t.Name, Language: t.Language, Text: t.Text, Parameters: t.Parameters}
	if t.HeaderImage != "" {
		h := t.HeaderImage
		m.HeaderImage = &h
	}
	o, err := r.m.SendTemplate(context.Background(), to, m)
	return report.Outbound{ID: o.ID}, reportFault(err)
}

func (r reportMessaging) GetMessage(id string) (*report.Outbound, error) {
	o, err := r.m.GetMessage(context.Background(), id)
	if err != nil || o == nil {
		return nil, reportFault(err)
	}
	return &report.Outbound{ID: o.ID}, nil
}

type reportMessagingDocs struct {
	reportMessaging
	d messaging.Documents
}

func (r reportMessagingDocs) SendDocument(to string, d report.Document) (report.Outbound, error) {
	caption := d.Caption
	o, err := r.d.SendDocument(context.Background(), to, messaging.DocumentMessage{Link: d.Link, Filename: d.Filename, Caption: &caption})
	return report.Outbound{ID: o.ID}, reportFault(err)
}

func MessagingOf(m messaging.Messaging) report.Messaging {
	if m == nil {
		return nil
	}
	if d, ok := m.(messaging.Documents); ok {
		return reportMessagingDocs{reportMessaging{m}, d}
	}
	return reportMessaging{m}
}

// ---- the `report` block of runtime.json (config.ts readReport, start.ts monthlyReportSetup) ----------------------------------------------------------------------------

var reportKeys = []string{"preparedBy", "innovator", "pageBaseUrl", "pagesDir", "source", "signingKeyFile", "goLiveFile", "tenant"}

var tenantRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$`)

// validName is config.ts validName: some text, one line, at most 120 UTF-16 units (JavaScript's length).
func validName(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && language.TrimJS(s) != "" && len(utf16.Encode([]rune(s))) <= 120 && !strings.ContainsAny(s, "\n\r\t")
}

func isText(v any) bool {
	s, ok := v.(string)
	return ok && language.TrimJS(s) != ""
}

// ReadSetup is config.ts readReport with start.ts monthlyReportSetup: the monthly report's setup from runtime.json's `report` block, or nil when there is none (then no report is
// made and nothing is sent). Every problem is said at once, in the TypeScript's words, as a ClientError that stops the start; so is a signing key that cannot be used.
func ReadSetup(cfg runtime.Config, folder string, log func(string)) (*Setup, error) {
	raw, given := cfg.Raw["report"]
	if !given {
		return nil, nil
	}
	r, ok := raw.(map[string]any)
	if !ok {
		return nil, runtime.ClientError{Msg: `"report" must be an object like {"preparedBy": "Divya, local Operator", "pageBaseUrl": "https://reports.example.com/r"}. Leave it out and no monthly report is sent to the owner.`}
	}
	var errs []string
	unknown := []string{}
	for k := range r {
		if !contains(reportKeys, k) {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(unknown) // Go's map has no order; the TypeScript says them in the file's order
	for _, k := range unknown {
		errs = append(errs, fmt.Sprintf(`I don't know what "%s" means in report. Allowed: %s.`, k, strings.Join(reportKeys, ", ")))
	}
	prepared, okName := validName(r["preparedBy"])
	if !okName {
		errs = append(errs, "report.preparedBy must be the name the owner should read for who set the agent up, on one line, up to 120 characters. The monthly message says it.")
	}
	innovator := false
	if v, has := r["innovator"]; has {
		b, isBool := v.(bool)
		if !isBool {
			errs = append(errs, "report.innovator must be true or false.")
		}
		innovator = b
	}
	base, _ := r["pageBaseUrl"].(string)
	u, perr := url.Parse(base)
	switch {
	case !isText(base) || perr != nil || u.Scheme != "https" || u.Host == "":
		errs = append(errs, "report.pageBaseUrl must be the https address the report pages are served from, like https://reports.example.com/r. WhatsApp fetches and shows a link only if it is https.")
	case u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Contains(base, "?") || strings.Contains(base, "#"):
		errs = append(errs, "report.pageBaseUrl must not hold a user name, a password, a query or a #fragment.")
	case strings.HasSuffix(base, "/"):
		errs = append(errs, "report.pageBaseUrl must not end with a slash.")
	}
	source := "test-mode"
	if cfg.Mode == "fakes" {
		source = "stand-in"
	}
	if v, has := r["source"]; has {
		if v != "live" && v != "test-mode" {
			errs = append(errs, `report.source must be "live" or "test-mode". Left out, it is test-mode (a report that says test money when it was real is a smaller mistake than the other way round).`)
		} else {
			source = v.(string)
		}
	}
	paths := map[string]string{}
	for _, k := range []string{"pagesDir", "signingKeyFile", "goLiveFile"} {
		if v, has := r[k]; has {
			if !isText(v) {
				errs = append(errs, fmt.Sprintf("report.%s must be a path.", k))
				continue
			}
			p := v.(string)
			if !filepath.IsAbs(p) {
				p = filepath.Join(folder, p)
			}
			paths[k] = p
		}
	}
	tenant := ""
	if v, has := r["tenant"]; has {
		t, isStr := v.(string)
		if !isStr || !isText(t) || !tenantRe.MatchString(t) {
			errs = append(errs, "report.tenant must be the shop's id (letters, digits and . _ : / @ + -), the one its daily fingerprint uses.")
		}
		tenant = t
	}
	if len(errs) > 0 {
		return nil, runtime.ClientError{Msg: "runtime.json has problems:\n- " + strings.Join(errs, "\n- ")}
	}
	dir := paths["pagesDir"]
	if dir == "" {
		dir = filepath.Join(cfg.DataDir, "reports")
	}
	setup := &Setup{Source: source, PagesDir: dir, PagesBaseURL: base, Tenant: tenant, Options: optionsReader(folder, prepared, innovator)}
	if f := paths["signingKeyFile"]; f != "" {
		key, err := report.LoadPrivateKey(f)
		if err != nil {
			return nil, runtime.ClientError{Msg: fmt.Sprintf("I could not use the report signing key %s (report.signingKeyFile): %s", f, err.Error())}
		}
		setup.Key = key
	} else {
		log("The monthly report will not be signed (no report.signingKeyFile): it carries a digest and a code, but nothing shows who issued it.")
	}
	setup.GoLiveFile = paths["goLiveFile"]
	return setup, nil
}

// optionsReader is config.ts optionsReader: the report's name and badge, read from runtime.json again whenever the file changed, so a change needs no restart; the last
// good answer stands when the file cannot be read.
func optionsReader(folder, preparedBy string, innovator bool) func() Options {
	file := filepath.Join(folder, "runtime.json")
	last := Options{PreparedBy: language.TrimJS(preparedBy), Innovator: innovator}
	var seen int64 = -1
	return func() Options {
		st, err := os.Stat(file)
		if err != nil || st.ModTime().UnixNano() == seen {
			return last
		}
		b, err := os.ReadFile(file)
		if err != nil {
			return last
		}
		var o map[string]any
		if json.Unmarshal(b, &o) == nil {
			if r, ok := o["report"].(map[string]any); ok {
				if n, ok := validName(r["preparedBy"]); ok {
					last.PreparedBy = language.TrimJS(n)
				}
				if v, ok := r["innovator"].(bool); ok {
					last.Innovator = v
				}
			}
		}
		seen = st.ModTime().UnixNano()
		return last
	}
}

// ---- running the job on a beat ----------------------------------------------------------------------------------------------------------------------------------

// RecordSource is the centre's record as the monthly job needs it: the whole of it, and a way to append a line. *runtime.Recorder is one.
type RecordSource interface {
	Entries() []store.Entry
	Append(runtime.NewLine) store.Entry
}

var _ RecordSource = (*runtime.Recorder)(nil)

// recordAdapter is accounting.Record over the centre's record: Append is a runtime.NewLine, so the line gets its keyed digest and its number exactly as the agent's own lines do.
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

// Record is accounting.Record over the centre's record.
func Record(rec RecordSource) accounting.Record { return recordAdapter{rec} }

// Tick is what the monthly job is given on the clock's beat (core.ts: `monthly.run({settings, clock, messaging, record, store, log, save})`), as far as the schedule needs it: the
// template's own report reads its settings, record and store through the closure it bound.
type Tick struct {
	Timezone, OwnerWhatsapp, OwnerLanguage string
	Licence                                string
	Now                                    func() int64
	Rec                                    RecordSource
	Save                                   func()
	Log                                    func(string)
}

// Runner runs a template's monthly job over one beat at a time. A centre with no WhatsApp has no messaging: Run says "no-messaging" and does nothing.
type Runner struct {
	mu  sync.Mutex
	job *report.MonthlyJob
	msg report.Messaging
}

// NewRunner is the job over this centre's messaging.
func NewRunner(job *report.MonthlyJob, m messaging.Messaging) *Runner {
	return &Runner{job: job, msg: MessagingOf(m)}
}

// Run is the job's `run(ctx)`: one look at whether last month's report is due and, if so, make it, claim it, send it and write the ending. bind is called with the lock held, before the
// job reads anything, and its result when the job is done: the template points its report's `Shop` at this beat's state and lets it go again.
func (r *Runner) Run(t Tick, bind func() (unbind func())) (report.MonthlyResult, error) {
	if t.Licence == "stopped" {
		return report.MonthlyResult{Why: "stopped"}, nil
	}
	if r.msg == nil {
		return report.MonthlyResult{Why: "no-messaging"}, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	defer bind()()
	save := t.Save
	if save == nil {
		save = func() {}
	}
	return r.job.Run(report.JobContext{Timezone: t.Timezone, OwnerWhatsapp: t.OwnerWhatsapp, OwnerLanguage: t.OwnerLanguage, Now: t.Now, Messaging: r.msg, Record: Record(t.Rec), Save: save, Log: t.Log})
}
