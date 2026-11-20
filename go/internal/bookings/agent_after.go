package bookings

// What rides on the clock's beat AFTER the agent's own work and saves for itself (modules/runtime/core.ts step, for Bookings): the owner's licence notice (server/licence.ts over
// modules/licence/notice.ts, the shared runtime.RunLicenceNotice) and the monthly report (report/monthly-job.ts, MonthlyReport in books.go). Each claims in the record and saves
// BEFORE it sends, and writes its ending and saves after, so a restart between the two finds the claim and never sends twice. They run from runtime.AfterTicker, never from
// Agent.Tick, whose step is saved whole or not at all. Also the `report` block of runtime.json (modules/runtime/config.ts readReport, start.ts monthlyReportSetup).

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"

	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/runtime"
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
	paid := (*int64)(nil)
	if a.c.PaidThrough != nil {
		paid = a.c.PaidThrough()
	}
	lang := a.settings.Owner.Language
	if _, _, err := runtime.RunLicenceNotice(runtime.NoticeContext{
		Licence: a.c.Licence(), PaidThrough: paid, Owner: a.owner(), Language: lang, Now: a.now(), Messaging: a.ownerMessaging(a.kit.Ports.WhatsApp), Rec: a.c.Rec, Save: save, Log: a.c.Log,
		Message: func(kind string) (string, messaging.TemplateMessage, error) { return a.licenceMessage(kind) },
	}); err != nil {
		a.c.Log("The owner's licence notice could not be sent: " + err.Error())
	}
	// in the licence's final stop the shop sends nothing more, so no report goes
	if a.kit.Report == nil || a.c.Licence() == "stopped" {
		return
	}
	if _, err := a.kit.Report.Run(ReportTick{Settings: a.settings, Store: a.store, Rec: a.c.Rec, Now: a.now, Licence: a.c.Licence(), Save: saveLogged, Log: a.c.Log}); err != nil {
		a.kit.reportFailed(err, a.now(), a.c.Log)
	}
}

// licenceMessage is licence.ts createBookingsLicenceNotice's `message`: the wind-down's or the final stop's words in the owner's language, naming the Operator, with how many
// bookings after now are still confirmed; and the approved template that carries the same words outside the owner's window.
func (a *Agent) licenceMessage(kind string) (string, messaging.TemplateMessage, error) {
	lang := a.settings.Owner.Language
	id := "owner_licence_paused"
	if kind == "stop" {
		id = "owner_licence_stopped"
	}
	var upcoming int64
	for _, b := range a.store.Bookings {
		if b.State == Confirmed && b.StartMs != nil && *b.StartMs > a.now() {
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
	f := a.factsFor(&messaging.SayArgs{Extra: &sayExtra{}}, lang)
	f.Partner, f.UpcomingCount = S(partner), N(upcoming)
	text, err := renderAny(id, f)
	if err != nil {
		return "", messaging.TemplateMessage{}, err
	}
	m := MetaTemplateMessage([]string{id}, f, text, WordsFor("en").Generic.Owner)
	return text, messaging.TemplateMessage{Name: m.Name, Language: m.Language, Text: m.Text, Parameters: m.Parameters}, nil
}

// reportFailed is core.ts's catch around the monthly report: said once, and again each hour it goes on; the paths in the message (a new random folder each time) are left out of
// the comparison.
func (k *Kit) reportFailed(err error, now int64, log func(string)) {
	same := pathLike.ReplaceAllString(err.Error(), "…")
	if same != k.reportErr || now-k.reportErrAt >= Hour {
		log("The monthly report could not be made: " + err.Error())
		k.reportErr, k.reportErrAt = same, now
	}
}

var pathLike = regexp.MustCompile(`\S*[\\/]\S*`)

// ---- the `report` block of runtime.json ----------------------------------------------------------------------------------------------------------------------------

// reportKeys is config.ts REPORT_KEYS.
var reportKeys = []string{"preparedBy", "innovator", "pageBaseUrl", "pagesDir", "source", "signingKeyFile", "goLiveFile", "tenant"}

var tenantRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$`)

// validName is config.ts validName: some text, one line, at most 120 UTF-16 units (JavaScript's length).
func validName(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && language.TrimJS(s) != "" && len(utf16.Encode([]rune(s))) <= 120 && !strings.ContainsAny(s, "\n\r\t")
}

// isText is config.ts isText: a string that is not only white space (JavaScript's trim).
func isText(v any) bool {
	s, ok := v.(string)
	return ok && language.TrimJS(s) != ""
}

// ReportSetupOf is config.ts readReport with start.ts monthlyReportSetup: the monthly report's setup from runtime.json's `report` block, or nil when there is none (then no report
// is made and nothing is sent). Every problem is said at once, in the TypeScript's words, as a ClientError that stops the start; so is a signing key that cannot be used.
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
		setup.GoLive = func() report.GoLiveFinding { return bookingsreport.ReadGoLive(f, s.Tree()).Finding }
	}
	return setup, nil
}

// reportOptionsReader is config.ts reportOptionsReader: the report's name and badge, read from runtime.json again whenever the file changed, so a change needs no restart; the last
// good answer stands when the file cannot be read.
func reportOptionsReader(folder, preparedBy string, innovator bool) func() bookingsreport.Options {
	file := filepath.Join(folder, "runtime.json")
	last := bookingsreport.Options{PreparedBy: language.TrimJS(preparedBy), Innovator: innovator}
	var seen int64 = -1
	return func() bookingsreport.Options {
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
