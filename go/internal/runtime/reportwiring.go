package runtime

// What every template's monthly report needs from the shop's folder and its WhatsApp, and nothing of the template's own report: modules/runtime/config.ts `readReport` and
// `reportOptionsReader`, modules/runtime/start.ts `monthlyReportSetup` (without the template's go-live reader), and the adapter from the shop's messaging to the report package's
// (internal/report Messaging, with the faults the job reads to decide whether a send may be tried again).
//
// Written for Stock orders' report (internal/stockorders) so that it does not become a third copy: internal/orders/agent_after.go and internal/bookings carry their own copies of the same
// code, which a later step folds onto this file (see internal/stockordersreport/Deferred.md); this stream did not touch them.

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
	"unicode/utf16"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// ReportConfig is the `report` block of runtime.json, read and checked.
type ReportConfig struct {
	// Source is what the numbers were counted from: "stand-in" in fakes mode, else "test-mode" unless the file says "live".
	Source string
	// PagesDir and PagesBaseURL: where the report folders go and the https address they are served at (no trailing slash).
	PagesDir, PagesBaseURL string
	// Tenant is the shop's id for the record's ledger ("" leaves the report's anchor null).
	Tenant string
	// Options reads who set the agent up and the Innovator badge, again whenever runtime.json changed, so a change needs no restart.
	Options func() (preparedBy string, innovator bool)
	// Key signs the report; nil when no signing key is named (the report then says it is not signed).
	Key ed25519.PrivateKey
	// GoLiveFile is the path of the go-live certificate the shop was given, "" when none.
	GoLiveFile string
}

// reportKeys is config.ts REPORT_KEYS.
var reportKeys = []string{"preparedBy", "innovator", "pageBaseUrl", "pagesDir", "source", "signingKeyFile", "goLiveFile", "tenant"}

var tenantRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$`)

// validName is config.ts validName: some text, one line, at most 120 UTF-16 units (JavaScript's length).
func validName(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && language.TrimJS(s) != "" && len(utf16.Encode([]rune(s))) <= 120 && !strings.ContainsAny(s, "\n\r\t")
}

func reportText(v any) bool {
	s, ok := v.(string)
	return ok && language.TrimJS(s) != ""
}

// ReadReportConfig is config.ts readReport with start.ts monthlyReportSetup: the monthly report's setup from runtime.json's `report` block, or nil when there is none (then no report is
// made and nothing is sent). Every problem is said at once, in the TypeScript's words, as a ClientError that stops the start; so is a signing key that cannot be used.
func ReadReportConfig(cfg Config, folder string, log func(string)) (*ReportConfig, error) {
	raw, given := cfg.Raw["report"]
	if !given {
		return nil, nil
	}
	r, ok := raw.(map[string]any)
	if !ok {
		return nil, ClientError{Msg: `"report" must be an object like {"preparedBy": "Divya, local Operator", "pageBaseUrl": "https://reports.example.com/r"}. Leave it out and no monthly report is sent to the owner.`}
	}
	var errs []string
	var unknown []string
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
	case !reportText(base) || perr != nil || u.Scheme != "https" || u.Host == "":
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
			if !reportText(v) {
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
		if !isStr || !reportText(t) || !tenantRe.MatchString(t) {
			errs = append(errs, "report.tenant must be the shop's id (letters, digits and . _ : / @ + -), the one its daily fingerprint uses.")
		}
		tenant = t
	}
	if len(errs) > 0 {
		return nil, ClientError{Msg: "runtime.json has problems:\n- " + strings.Join(errs, "\n- ")}
	}
	dir := paths["pagesDir"]
	if dir == "" {
		dir = filepath.Join(cfg.DataDir, "reports")
	}
	out := &ReportConfig{Source: source, PagesDir: dir, PagesBaseURL: base, Tenant: tenant, Options: reportOptionsReader(folder, prepared, innovator), GoLiveFile: paths["goLiveFile"]}
	if f := paths["signingKeyFile"]; f != "" {
		key, err := report.LoadPrivateKey(f)
		if err != nil {
			return nil, ClientError{Msg: fmt.Sprintf("I could not use the report signing key %s (report.signingKeyFile): %s", f, err.Error())}
		}
		out.Key = key
	} else {
		log("The monthly report will not be signed (no report.signingKeyFile): it carries a digest and a code, but nothing shows who issued it.")
	}
	return out, nil
}

// reportOptionsReader is config.ts reportOptionsReader: the report's name and badge, read from runtime.json again whenever the file changed, so a change needs no restart; the last good
// answer stands when the file cannot be read.
func reportOptionsReader(folder, preparedBy string, innovator bool) func() (string, bool) {
	file := filepath.Join(folder, "runtime.json")
	lastName, lastBadge := language.TrimJS(preparedBy), innovator
	var seen int64 = -1
	return func() (string, bool) {
		st, err := os.Stat(file)
		if err != nil || st.ModTime().UnixNano() == seen {
			return lastName, lastBadge
		}
		b, err := os.ReadFile(file)
		if err != nil {
			return lastName, lastBadge
		}
		var o map[string]any
		if json.Unmarshal(b, &o) == nil {
			if r, ok := o["report"].(map[string]any); ok {
				if n, ok := validName(r["preparedBy"]); ok {
					lastName = language.TrimJS(n)
				}
				if v, ok := r["innovator"].(bool); ok {
					lastBadge = v
				}
			}
		}
		seen = st.ModTime().UnixNano()
		return lastName, lastBadge
	}
}

// ---- the shop's messaging, as the report package takes it ----

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

// ReportMessagingOf is the shop's WhatsApp as the monthly job takes it (nil: the shop has none, and the job says "no-messaging").
func ReportMessagingOf(m messaging.Messaging) report.Messaging {
	if m == nil {
		return nil
	}
	if d, ok := m.(messaging.Documents); ok {
		return reportMessagingDocs{reportMessaging{m}, d}
	}
	return reportMessaging{m}
}

// ---- the shop's record, as the monthly job takes it ----

type reportRecord struct{ r *Recorder }

func (a reportRecord) Entries() []accounting.Entry { return a.r.Entries() }

// Append is record.ts append: a line without a case is written with a null `booking`, and gets its keyed digest and its number exactly as the agent's own lines do.
func (a reportRecord) Append(n accounting.NewEntry) accounting.Entry {
	booking := ""
	if n.Booking != nil {
		booking = *n.Booking
	}
	return a.r.Append(NewLine{Conversation: n.Conversation, Booking: booking, Action: n.Action, Outcome: n.Outcome, Inputs: n.Inputs, Language: n.Language, Notes: n.Notes, Refs: n.Refs})
}

// ReportRecordOf is the shop's record as the monthly job reads and writes it.
func ReportRecordOf(r *Recorder) accounting.Record { return reportRecord{r} }
