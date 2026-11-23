package orders

// What rides on the clock's beat AFTER the agent's own work and saves for itself (modules/runtime/core.ts step, for Orders): the owner's licence notice (server/licence.ts over
// modules/licence/notice.ts, the shared runtime.RunLicenceNotice) and the monthly report (report/monthly-job.ts, ordersreport.NewMonthlyJob). Each claims in the record and saves
// BEFORE it sends, and writes its ending and saves after, so a restart between the two finds the claim and never sends twice. They run from runtime.AfterTicker, never from
// Agent.Tick, whose step is saved whole or not at all. The owner's morning line (morning.ts) is G3's, after the report. Also the `report` block of runtime.json
// (modules/runtime/config.ts readReport, start.ts monthlyReportSetup) and the report's adapters (messaging, the orders), as internal/bookings/books.go and agent_after.go have them
// for Bookings: copied, since a template may not import another (Deferred.md: one shared place for both).

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

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/ordersreport"
	"github.com/GeometerLabs/agents/go/internal/report"
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
	// in the licence's final stop the shop sends nothing more, so no report goes
	if a.c.Licence() == "stopped" {
		return
	}
	if a.kit.Report != nil {
		if _, err := a.kit.Report.Run(ReportTick{Settings: a.settings, Store: a.store, Rec: a.c.Rec, Now: a.now, Licence: a.c.Licence(), Save: saveLogged, Log: a.c.Log}); err != nil {
			a.kit.reportFailed(err, a.now(), a.c.Log)
		}
	}
	// the owner's morning line (morning.ts) goes here, after the report, with the same save (G3's)
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

// reportFailed is core.ts's catch around the monthly report: said once, and again each hour it goes on; the paths in the message (a new random folder each time) are left out of the
// comparison.
func (k *Kit) reportFailed(err error, now int64, log func(string)) {
	same := pathLike.ReplaceAllString(err.Error(), "…")
	if same != k.reportErr || now-k.reportErrAt >= Hour {
		log("The monthly report could not be made: " + err.Error())
		k.reportErr, k.reportErrAt = same, now
	}
}

var pathLike = regexp.MustCompile(`\S*[\\/]\S*`)

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

// MonthlyReportSetup is MonthlyReportSetup (report/monthly-job.ts): what the numbers were counted from, where the report folders go, who set the agent up, the key that signs.
type MonthlyReportSetup struct {
	Source                 string
	PagesDir, PagesBaseURL string
	Options                func() ordersreport.Options
	Key                    ed25519.PrivateKey
	GoLive                 func() report.GoLiveFinding
	Tenant                 string
	Token                  func() string // the test seam: the random part of the folder name
}

// ReportTick is what the monthly job is given on the clock's beat (core.ts: `monthly.run({settings, clock, messaging, record, store, log, save})`).
type ReportTick struct {
	Settings *Settings
	Store    *Store
	Rec      RecordSource
	Now      func() int64
	Licence  string
	Save     func()
	Log      func(string)
}

// MonthlyReport is the monthly job for Orders, made once per process: it remembers which month it found sent, so a tick that comes every few seconds does not read the record.
type MonthlyReport struct {
	mu  sync.Mutex
	job *report.MonthlyJob
	cur ReportTick
	msg report.Messaging
}

// NewMonthlyReport is createMonthlyReport(setup) over this shop's messaging. A shop with no WhatsApp has none: Run says "no-messaging" and does nothing.
func NewMonthlyReport(setup MonthlyReportSetup, m messaging.Messaging) *MonthlyReport {
	r := &MonthlyReport{msg: reportMessagingOf(m)}
	r.job = ordersreport.NewMonthlyJob(ordersreport.Setup{
		Source: setup.Source, PagesDir: setup.PagesDir, PagesBaseURL: setup.PagesBaseURL, Options: setup.Options, Key: setup.Key, GoLive: setup.GoLive, Token: setup.Token, Tenant: setup.Tenant,
		Shop: func() ordersreport.Shop {
			return ordersreport.Shop{Settings: r.cur.Settings.Tree(), Entries: r.cur.Rec.Entries(), Orders: OrdersOf(r.cur.Store)}
		},
	})
	return r
}

// Run is the job's `run(ctx)`: one look at whether last month's report is due and, if so, make it, claim it, send it and write the ending.
func (m *MonthlyReport) Run(t ReportTick) (report.MonthlyResult, error) {
	if t.Licence == "stopped" {
		return report.MonthlyResult{Why: "stopped"}, nil
	}
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
	return m.job.Run(report.JobContext{Timezone: t.Settings.Timezone, OwnerWhatsapp: t.Settings.Owner.Whatsapp, OwnerLanguage: t.Settings.Owner.Language, Now: t.Now, Messaging: m.msg,
		Record: Record(t.Rec), Save: save, Log: t.Log})
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

func reportMessagingOf(m messaging.Messaging) report.Messaging {
	if m == nil {
		return nil
	}
	if d, ok := m.(messaging.Documents); ok {
		return reportMessagingDocs{reportMessaging{m}, d}
	}
	return reportMessaging{m}
}

// ---- the `report` block of runtime.json (config.ts readReport, start.ts monthlyReportSetup) ----------------------------------------------------------------------------

// reportKeys is config.ts REPORT_KEYS.
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

// ReportSetupOf is config.ts readReport with start.ts monthlyReportSetup: the monthly report's setup from runtime.json's `report` block, or nil when there is none (then no report is
// made and nothing is sent). Every problem is said at once, in the TypeScript's words, as a ClientError that stops the start; so is a signing key that cannot be used.
func ReportSetupOf(cfg runtime.Config, folder string, s *Settings, log func(string)) (*MonthlyReportSetup, error) {
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
	setup := &MonthlyReportSetup{Source: source, PagesDir: dir, PagesBaseURL: base, Tenant: tenant, Options: reportOptionsReader(folder, prepared, innovator)}
	if f := paths["signingKeyFile"]; f != "" {
		key, err := report.LoadPrivateKey(f)
		if err != nil {
			return nil, runtime.ClientError{Msg: fmt.Sprintf("I could not use the report signing key %s (report.signingKeyFile): %s", f, err.Error())}
		}
		setup.Key = key
	} else {
		log("The monthly report will not be signed (no report.signingKeyFile): it carries a digest and a code, but nothing shows who issued it.")
	}
	if f := paths["goLiveFile"]; f != "" {
		setup.GoLive = func() report.GoLiveFinding { return ordersreport.ReadGoLive(f, s.Tree()).Finding }
	}
	return setup, nil
}

// reportOptionsReader is config.ts reportOptionsReader: the report's name and badge, read from runtime.json again whenever the file changed, so a change needs no restart; the last
// good answer stands when the file cannot be read.
func reportOptionsReader(folder, preparedBy string, innovator bool) func() ordersreport.Options {
	file := filepath.Join(folder, "runtime.json")
	last := ordersreport.Options{PreparedBy: language.TrimJS(preparedBy), Innovator: innovator}
	var seen int64 = -1
	return func() ordersreport.Options {
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
