// Tests of the Fees monthly report against what the TypeScript produced on Node (testdata/vectors.json.gz, made by go/scripts/gen_fees_report_vectors.ts): for each centre record the
// report as the sealed envelope file (so the tree, its digest, code and signature are held BYTE FOR BYTE), the report page and the owner's texts, the signed summary link and what the
// TypeScript's checker reads in it, and the WhatsApp message (text and template) in all four languages; the policy digest, the "not tested" lists, the go-live certificates the report
// reads, the files writeFeesReport writes, and the monthly job's wiring over a scripted messaging. The TypeScript was given the real fees; Go is given only the projection each case
// holds (no name, no number). Also the vector that a report carries NO STUDENT'S NAME: every case's settings and record name students, and nothing Go makes may hold one.
package feesreport

import (
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// testKey is the generator's TEST key: a fixed 32-byte seed, (i*7+3)&255. It signs nothing real.
func testKey() ed25519.PrivateKey {
	seed := make([]byte, 32)
	for i := range seed {
		seed[i] = byte((i*7 + 3) & 255)
	}
	return ed25519.NewKeyFromSeed(seed)
}

// dueVec is the projection of a fee the generator hands Go: no name, no number.
type dueVec struct {
	Month        string `json:"month"`
	State        string `json:"state"`
	Payments     int    `json:"payments"`
	BalancePaise int64  `json:"balancePaise"`
}

func duesOf(in []dueVec) []Due {
	var out []Due
	for _, d := range in {
		out = append(out, Due{Month: d.Month, State: d.State, Payments: d.Payments, BalancePaise: d.BalancePaise})
	}
	return out
}

type messageVec struct {
	Ok *struct {
		Text     string `json:"text"`
		Template struct {
			Name       string   `json:"name"`
			Language   string   `json:"language"`
			Text       string   `json:"text"`
			Parameters []string `json:"parameters"`
		} `json:"template"`
	} `json:"ok"`
	Error string `json:"error"`
}

type checkedVec struct {
	Status      string  `json:"status"`
	Layout      int     `json:"layout"`
	Source      string  `json:"source"`
	OwnerMarked bool    `json:"ownerMarked"`
	Period      string  `json:"period"`
	Pathway     string  `json:"pathway"`
	Shop        string  `json:"shop"`
	By          string  `json:"by"`
	Figures     []int64 `json:"figures"`
	Digest      string  `json:"digest"`
	Signer      string  `json:"signer"`
}

type caseVec struct {
	Name     string          `json:"name"`
	Month    *string         `json:"month"`
	Settings map[string]any  `json:"settings"`
	Entries  json.RawMessage `json:"entries"`
	Dues     []dueVec        `json:"dues"`
	People   struct {
		Names   []string `json:"names"`
		Numbers []string `json:"numbers"`
	} `json:"people"`
	From       int64          `json:"from"`
	To         int64          `json:"to"`
	Source     string         `json:"source"`
	MadeAt     int64          `json:"madeAt"`
	PreparedBy *string        `json:"preparedBy"`
	Innovator  bool           `json:"innovator"`
	GoLive     map[string]any `json:"goLive"`
	Tenant     *string        `json:"tenant"`
	Signed     bool           `json:"signed"`
	Error      string         `json:"error"`

	Report   string                `json:"report"`
	Check    *string               `json:"check"`
	Checked  *checkedVec           `json:"checked"`
	Pages    map[string]string     `json:"pages"`
	Owner    map[string]string     `json:"owner"`
	Messages map[string]messageVec `json:"messages"`
}

type fileVec struct {
	Name       string            `json:"name"`
	Language   string            `json:"language"`
	Written    []string          `json:"written"`
	Sha        map[string]string `json:"sha"`
	OwnerTexts []string          `json:"ownerTexts"`
	Code       string            `json:"code"`
	Check      *string           `json:"check"`
}

type notTestedVec struct {
	Settings              map[string]any `json:"settings"`
	ConfirmsAutomatically bool           `json:"confirmsAutomatically"`
	NotTested             []string       `json:"notTested"`
}

type vectors struct {
	Node      string                     `json:"node"`
	Records   map[string]json.RawMessage `json:"records"`
	PublicKey string                     `json:"publicKey"`
	Signer    report.ListedSigner        `json:"signer"`
	Cases     []caseVec                  `json:"cases"`
	Files     []fileVec                  `json:"files"`
	BadSource struct{ Error string }     `json:"badSource"`
	Policies  struct {
		Rows []struct {
			Name                  string         `json:"name"`
			Settings              map[string]any `json:"settings"`
			Digest                string         `json:"digest"`
			ConfirmsAutomatically bool           `json:"confirmsAutomatically"`
			NotTested             []string       `json:"notTested"`
		} `json:"rows"`
		CheckedPolicyDigest string       `json:"checkedPolicyDigest"`
		NoPayment           notTestedVec `json:"noPayment"`
		UnknownModule       notTestedVec `json:"unknownModule"`
	} `json:"policies"`
	GoLive struct {
		Cases []struct {
			Name     string         `json:"name"`
			Settings map[string]any `json:"settings"`
			Text     string         `json:"text"`
			Reading  readingVec     `json:"reading"`
		} `json:"cases"`
		Paths struct {
			None    readingVec `json:"none"`
			Empty   readingVec `json:"empty"`
			Missing struct {
				Path    string     `json:"path"`
				Reading readingVec `json:"reading"`
			} `json:"missing"`
		} `json:"paths"`
	} `json:"goLive"`
	Job []jobVec `json:"job"`
}

// entriesOf reads a case's record: the name of one of the shared records, or the entries themselves.
func (v *vectors) entriesOf(t *testing.T, raw json.RawMessage) []accounting.Entry {
	t.Helper()
	var name string
	if json.Unmarshal(raw, &name) == nil {
		raw = v.Records[name]
	}
	var out []accounting.Entry
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

type readingVec struct {
	Finding map[string]any `json:"finding"`
	Said    string         `json:"said"`
}

var loaded *vectors

func vecs(t *testing.T) *vectors {
	t.Helper()
	if loaded == nil {
		packed, err := os.ReadFile("testdata/vectors.json.gz")
		if err != nil {
			t.Fatal(err)
		}
		zr, err := gzip.NewReader(bytes.NewReader(packed))
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(zr)
		if err != nil {
			t.Fatal(err)
		}
		var v vectors
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		loaded = &v
	}
	return loaded
}

// finding reads a go-live finding from the JSON tree the TypeScript wrote.
func finding(m map[string]any) *report.GoLiveFinding {
	if m == nil {
		return nil
	}
	num := func(v any) int { f, _ := v.(float64); return int(f) }
	g := report.GoLiveFinding{Status: m["status"].(string)}
	g.Code, _ = m["code"].(string)
	g.SignedBy, _ = m["signedBy"].(string)
	if on, ok := m["issuedOn"].(map[string]any); ok {
		g.IssuedOn = zone.Date{Year: num(on["year"]), Month: num(on["month"]), Day: num(on["day"])}
	}
	g.Held, g.Total, g.Failed, g.NotRun, g.NotTested = num(m["held"]), num(m["total"]), num(m["failed"]), num(m["notRun"]), num(m["notTested"])
	return &g
}

func (c *caseVec) input(entries []accounting.Entry) Input {
	return Input{Settings: c.Settings, Entries: entries, Dues: duesOf(c.Dues), From: c.From, To: c.To, Source: c.Source, MadeAt: c.MadeAt, PreparedBy: c.PreparedBy, Innovator: c.Innovator,
		GoLive: finding(c.GoLive), LedgerTenant: c.Tenant}
}

func eq(t *testing.T, name, what, got, want string) {
	t.Helper()
	if got == want {
		return
	}
	i := 0
	for i < len(got) && i < len(want) && got[i] == want[i] {
		i++
	}
	lo := max(0, i-60)
	t.Errorf("%s: %s differs at byte %d (got %d bytes, want %d):\n got ...%q\nwant ...%q", name, what, i, len(got), len(want), got[lo:min(len(got), i+80)], want[lo:min(len(want), i+80)])
}

func samePtr(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

func TestReportsMatchTypeScript(t *testing.T) {
	v := vecs(t)
	if len(v.Cases) < 34 {
		t.Fatalf("only %d cases", len(v.Cases))
	}
	if !strings.HasPrefix(v.Node, "v") {
		t.Errorf("the vectors do not name the Node that made them: %q", v.Node)
	}
	key := testKey()
	if report.PublicKeyHex(key) != v.PublicKey {
		t.Fatalf("the test key is not the generator's")
	}
	signers := []report.ListedSigner{v.Signer}
	sawKinds := map[string]bool{}
	for i := range v.Cases {
		c := &v.Cases[i]
		t.Run(c.Name, func(t *testing.T) {
			doc, err := BuildFeesReport(c.input(v.entriesOf(t, c.Entries)))
			if c.Error != "" {
				if err == nil || err.Error() != c.Error {
					t.Fatalf("error: got %v, want %q", err, c.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			var k ed25519.PrivateKey
			if c.Signed {
				k = key
			}
			sealed := SealReport(doc, k)
			eq(t, c.Name, "the sealed report", report.EnvelopeFile(sealed.Envelope), c.Report)
			check, err := report.SummaryLinkFor(sealed.Envelope, ReportSummaryFields(doc), k)
			if err != nil {
				t.Fatal(err)
			}
			wantCheck := ""
			if c.Check != nil {
				wantCheck = *c.Check
			}
			eq(t, c.Name, "the report's summary link", check, wantCheck)
			compareChecked(t, c.Name+" report", check, signers, c.Checked)
			for lang, want := range c.Pages {
				page, err := ReportPage(sealed, lang, check)
				if err != nil {
					t.Fatal(err)
				}
				eq(t, c.Name, "the report page ("+lang+")", page, want)
			}
			for lang, want := range c.Owner {
				eq(t, c.Name, "the owner's text ("+lang+")", OwnerText(doc, lang), want)
			}
			for lang, want := range c.Messages {
				link := fmt.Sprintf("https://reports.example.com/r/3f9a1c7d2b8e4f60/report-%s-%s.html", monthOrRange(c), lang)
				msg, err := MonthlyReportMessage(sealed, lang, link, check)
				if want.Error != "" {
					if err == nil || err.Error() != want.Error {
						t.Errorf("%s message (%s): error got %v, want %q", c.Name, lang, err, want.Error)
					}
					continue
				}
				if err != nil {
					t.Errorf("%s message (%s): %v", c.Name, lang, err)
					continue
				}
				w := want.Ok
				eq(t, c.Name, "the message text ("+lang+")", msg.Text, w.Text)
				eq(t, c.Name, "the template text ("+lang+")", msg.Template.Text, w.Template.Text)
				if msg.Template.Name != w.Template.Name || msg.Template.Language != w.Template.Language || !reflect.DeepEqual(msg.Template.Parameters, w.Template.Parameters) {
					t.Errorf("%s message (%s): template got %+v, want %+v", c.Name, lang, msg.Template, w.Template)
				}
				for _, p := range w.Template.Parameters {
					if strings.HasPrefix(p, "https://geometer.dev/verify/") {
						switch {
						case strings.Contains(p, "#s1."):
							sawKinds["summary"] = true
						case strings.Contains(p, "#sha256:"):
							sawKinds["digest"] = true
						default:
							sawKinds["code"] = true
						}
					}
				}
			}
		})
	}
	for _, k := range []string{"summary", "digest", "code"} {
		if !sawKinds[k] {
			t.Errorf("no message chose the %s check link", k)
		}
	}
}

// monthOrRange is how the generator names a case in the report's address: its month, or "range" for a period that is not a month.
func monthOrRange(c *caseVec) string {
	if c.Month != nil {
		return *c.Month
	}
	return "range"
}

func compareChecked(t *testing.T, name, link string, signers []report.ListedSigner, want *checkedVec) {
	t.Helper()
	if link == "" {
		if want != nil {
			t.Errorf("%s: no link but the TypeScript checked one", name)
		}
		return
	}
	got := report.CheckSummaryLink(link, signers)
	if want == nil || got.Status != want.Status {
		t.Errorf("%s: the check says %q, the TypeScript's says %+v", name, got.Status, want)
		return
	}
	s := got.Summary
	if s.Layout != want.Layout || s.Source != want.Source || s.OwnerMarked != want.OwnerMarked || s.Period != want.Period || s.Pathway != want.Pathway || s.Shop != want.Shop || s.By != want.By ||
		!reflect.DeepEqual(s.Figures, want.Figures) || s.Digest != want.Digest || got.Signer.KeyID != want.Signer {
		t.Errorf("%s: the summary read back is %+v, the TypeScript's %+v", name, *s, *want)
	}
	if (s.Layout != 4 && s.Layout != 7) || s.Pathway != "fees" {
		t.Errorf("%s: the summary is layout %d of %q, want layout 4 (7 with old dues) of fees", name, s.Layout, s.Pathway)
	}
}

func TestWriteFeesReportFilesMatchTypeScript(t *testing.T) {
	v := vecs(t)
	byName := map[string]*caseVec{}
	for i := range v.Cases {
		byName[v.Cases[i].Name] = &v.Cases[i]
	}
	if len(v.Files) < 5 {
		t.Fatalf("only %d runs", len(v.Files))
	}
	for _, f := range v.Files {
		c := byName[f.Name]
		t.Run(f.Name+"-"+f.Language, func(t *testing.T) {
			out := filepath.Join(t.TempDir(), "report")
			run := Run{Settings: c.Settings, Entries: v.entriesOf(t, c.Entries), Dues: duesOf(c.Dues), Month: *c.Month, Language: f.Language, Out: out, Source: c.Source, PreparedBy: c.PreparedBy,
				Innovator: c.Innovator, GoLive: finding(c.GoLive), Now: c.MadeAt}
			if c.Signed {
				run.Key = testKey()
			}
			if c.Tenant != nil {
				run.Tenant = *c.Tenant
			}
			got, err := WriteFeesReport(run)
			if err != nil {
				t.Fatal(err)
			}
			var written []string
			for _, p := range got.Files {
				written = append(written, filepath.Base(p))
			}
			if !reflect.DeepEqual(written, f.Written) {
				t.Errorf("files written: got %v, want %v", written, f.Written)
			}
			names, _ := os.ReadDir(out)
			gotSha := map[string]string{}
			for _, n := range names {
				raw, _ := os.ReadFile(filepath.Join(out, n.Name()))
				s := sha256.Sum256(raw)
				gotSha[n.Name()] = hex.EncodeToString(s[:])
			}
			if !reflect.DeepEqual(gotSha, f.Sha) {
				for n, s := range f.Sha {
					if gotSha[n] != s {
						t.Errorf("file %s differs from the TypeScript's", n)
					}
				}
				t.Errorf("file contents differ (got %d files, want %d)", len(gotSha), len(f.Sha))
			}
			if !reflect.DeepEqual(got.OwnerTexts, f.OwnerTexts) || got.Code != f.Code {
				t.Errorf("owner texts or the code differ: %v %s", got.OwnerTexts, got.Code)
			}
			if (f.Check == nil) != (got.Check == "") || (f.Check != nil && *f.Check != got.Check) {
				t.Errorf("check link differs")
			}
		})
	}
	if v.BadSource.Error == "" {
		t.Errorf("no error vector for an unknown source")
	}
	_, err := BuildFeesReport(Input{Settings: v.Cases[0].Settings, Source: "paper", From: 0, To: 1})
	if err == nil || err.Error() != v.BadSource.Error {
		t.Errorf("unknown source: got %v, want %q", err, v.BadSource.Error)
	}
}

func TestPolicyDigestsAndNotTestedMatchTypeScript(t *testing.T) {
	v := vecs(t)
	p := v.Policies
	if CheckedPolicyDigest() != p.CheckedPolicyDigest {
		t.Errorf("checked policy digest %s, want %s", CheckedPolicyDigest(), p.CheckedPolicyDigest)
	}
	if len(p.Rows) < 7 {
		t.Fatalf("only %d settings", len(p.Rows))
	}
	for _, r := range p.Rows {
		if got := PolicyDigest(r.Settings); got != r.Digest {
			t.Errorf("%s: policy digest %s, want %s", r.Name, got, r.Digest)
		}
		sh, err := ShopOf(r.Settings)
		if err != nil {
			t.Fatal(err)
		}
		if ConfirmsAutomatically(sh) != r.ConfirmsAutomatically {
			t.Errorf("%s: confirmsAutomatically %v, want %v", r.Name, ConfirmsAutomatically(sh), r.ConfirmsAutomatically)
		}
		if got := NotTestedOf(sh); !reflect.DeepEqual(got, r.NotTested) {
			t.Errorf("%s: not tested %v, want %v", r.Name, got, r.NotTested)
		}
	}
	// the caller's duty (settings.go): the digest is of the VALIDATED settings. A raw file's digest is another (the name's padding, the defaults left out); fees.ReadSettings and
	// Settings.ReportTree make the validated tree, and internal/fees/report_test.go holds that they digest as the TypeScript's.
	// settings with no payment block, and an unknown payment module: the default provider's capabilities (a UPI shop for paidBy), the Razorpay "not tested" list
	for name, np := range map[string]notTestedVec{"no payment block": p.NoPayment, "unknown module": p.UnknownModule} {
		sh, _ := ShopOf(np.Settings)
		if ConfirmsAutomatically(sh) != np.ConfirmsAutomatically || !reflect.DeepEqual(NotTestedOf(sh), np.NotTested) {
			t.Errorf("%s: %v %v, want %v %v", name, ConfirmsAutomatically(sh), NotTestedOf(sh), np.ConfirmsAutomatically, np.NotTested)
		}
	}
}

func TestGoLiveReadingsMatchTypeScript(t *testing.T) {
	v := vecs(t)
	statuses := map[string]bool{}
	for _, c := range v.GoLive.Cases {
		got := ReadGoLiveCertificate(c.Text, c.Settings)
		want := finding(c.Reading.Finding)
		if !reflect.DeepEqual(&got.Finding, want) || got.Said != c.Reading.Said {
			t.Errorf("%s: reading %+v %q, want %+v %q", c.Name, got.Finding, got.Said, *want, c.Reading.Said)
		}
		statuses[got.Finding.Status] = true
	}
	for _, s := range []string{"own", "example", "different", "untrusted"} {
		if !statuses[s] {
			t.Errorf("no go-live case reads as %q", s)
		}
	}
	settings := v.GoLive.Cases[0].Settings
	p := v.GoLive.Paths
	for name, r := range map[string]struct {
		path string
		want readingVec
	}{"none": {"", p.None}, "missing": {p.Missing.Path, p.Missing.Reading}, "empty": {"", p.Empty}} {
		got := ReadGoLive(r.path, settings)
		if !reflect.DeepEqual(&got.Finding, finding(r.want.Finding)) || got.Said != r.want.Said {
			t.Errorf("readGoLive %s: %+v %q, want %+v", name, got, got.Said, r.want)
		}
	}
	// a file that is there is read
	dir := t.TempDir()
	good := v.GoLive.Cases[0]
	path := filepath.Join(dir, "go-live-certificate.json")
	if err := os.WriteFile(path, []byte(good.Text), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ReadGoLive(path, good.Settings); got.Said != good.Reading.Said {
		t.Errorf("a certificate file on disk: %q, want %q", got.Said, good.Reading.Said)
	}
}

// ---- the monthly job's wiring ----

type jobVec struct {
	Mode    string          `json:"mode"`
	Entries json.RawMessage `json:"entries"`
	Dues    []dueVec        `json:"dues"`
	Now     int64           `json:"now"`
	Result  struct {
		Done    bool   `json:"done"`
		Why     string `json:"why"`
		Month   string `json:"month"`
		Outcome string `json:"outcome"`
		Via     string `json:"via"`
	} `json:"result"`
	Sent []struct {
		Kind     string `json:"kind"`
		To       string `json:"to"`
		Text     string `json:"text"`
		Template *struct {
			Name       string   `json:"name"`
			Language   string   `json:"language"`
			Text       string   `json:"text"`
			Parameters []string `json:"parameters"`
		} `json:"template"`
		Doc *struct{ Link, Filename, Caption string } `json:"doc"`
	} `json:"sent"`
	Written []struct {
		Seq      int               `json:"seq"`
		Time     string            `json:"time"`
		Action   string            `json:"action"`
		Outcome  string            `json:"outcome"`
		Booking  *string           `json:"booking"`
		Language string            `json:"language"`
		Notes    string            `json:"notes"`
		Refs     map[string]string `json:"refs"`
	} `json:"written"`
	Saves []int             `json:"saves"`
	Logs  []string          `json:"logs"`
	Files map[string]string `json:"files"`
}

// memRecord is a record held in memory: what the shop's store gives the job (accounting.Record).
type memRecord struct {
	entries []accounting.Entry
	now     func() int64
}

func (m *memRecord) Entries() []accounting.Entry {
	return append([]accounting.Entry(nil), m.entries...)
}
func (m *memRecord) Append(n accounting.NewEntry) accounting.Entry {
	refs := map[string]string{}
	for k, v := range n.Refs {
		refs[k] = v
	}
	e := accounting.Entry{Seq: len(m.entries) + 1, Time: report.ISOOf(m.now()), Conversation: n.Conversation, Booking: n.Booking, Action: n.Action, Outcome: n.Outcome, Language: n.Language, Notes: n.Notes, Refs: refs}
	m.entries = append(m.entries, e)
	return e
}

type sentMsg struct {
	kind, to, text string
	template       report.Template
	doc            report.Document
}

type fakeMessaging struct {
	mode string
	sent []sentMsg
	next int
}

func (f *fakeMessaging) id() report.Outbound {
	f.next++
	return report.Outbound{ID: fmt.Sprintf("wamid.%d", f.next)}
}
func (f *fakeMessaging) IsWindowOpen(string) (bool, error) { return f.mode != "template", nil }
func (f *fakeMessaging) SendText(to, text string) (report.Outbound, error) {
	f.sent = append(f.sent, sentMsg{kind: "text", to: to, text: text})
	return f.id(), nil
}
func (f *fakeMessaging) SendTemplate(to string, tpl report.Template) (report.Outbound, error) {
	f.sent = append(f.sent, sentMsg{kind: "template", to: to, template: tpl})
	return f.id(), nil
}
func (f *fakeMessaging) GetMessage(id string) (*report.Outbound, error) {
	return &report.Outbound{ID: id}, nil
}
func (f *fakeMessaging) SendDocument(to string, d report.Document) (report.Outbound, error) {
	f.sent = append(f.sent, sentMsg{kind: "document", to: to, doc: d})
	if f.mode == "document-refused" {
		return report.Outbound{}, &report.APIError{Status: 400, Msg: "document refused"}
	}
	return f.id(), nil
}

func TestMonthlyJobWiringMatchesTypeScript(t *testing.T) {
	v := vecs(t)
	if len(v.Job) != 4 {
		t.Fatalf("%d job runs", len(v.Job))
	}
	var settings map[string]any
	for _, c := range v.Cases {
		if c.Name == "rules-gateway" { // the job's shop is the gateway centre the generator used
			settings = c.Settings
		}
	}
	for _, j := range v.Job {
		t.Run(j.Mode, func(t *testing.T) {
			dir := t.TempDir()
			now := j.Now
			rec := &memRecord{entries: v.entriesOf(t, j.Entries), now: func() int64 { return now }}
			msg := &fakeMessaging{mode: j.Mode}
			setup := Setup{Source: "stand-in", PagesDir: dir, PagesBaseURL: "https://reports.example.com/r", Key: testKey(), Tenant: "bright",
				Options: func() Options { return Options{PreparedBy: "Divya, Sri Sai Digital", Innovator: j.Mode == "text"} },
				GoLive:  func() report.GoLiveFinding { return *finding(v.Cases[0].GoLive) },
				Token:   func() string { return "0123456789abcdef0123456789abcdef" },
				Shop:    func() Shop { return Shop{Settings: settings, Entries: rec.Entries(), Dues: duesOf(j.Dues)} }}
			var saves []int
			var logs []string
			job := NewMonthlyJob(setup)
			before := len(rec.entries)
			res, err := job.Run(report.JobContext{Timezone: settings["timezone"].(string), OwnerWhatsapp: settings["owner"].(map[string]any)["whatsapp"].(string), OwnerLanguage: settings["owner"].(map[string]any)["language"].(string),
				Now: func() int64 { return now }, Messaging: msg, Record: rec, Save: func() { saves = append(saves, len(rec.entries)) }, Log: func(s string) { logs = append(logs, s) }})
			if err != nil {
				t.Fatal(err)
			}
			if res.Done != j.Result.Done || res.Why != j.Result.Why || res.Month != j.Result.Month || res.Outcome != j.Result.Outcome || res.Via != j.Result.Via {
				t.Errorf("result %+v, want %+v", res, j.Result)
			}
			if len(msg.sent) != len(j.Sent) {
				t.Fatalf("sent %d, want %d", len(msg.sent), len(j.Sent))
			}
			for i, w := range j.Sent {
				g := msg.sent[i]
				if g.kind != w.Kind || g.to != w.To {
					t.Errorf("sent[%d]: %s to %s, want %s to %s", i, g.kind, g.to, w.Kind, w.To)
				}
				switch w.Kind {
				case "text":
					eq(t, j.Mode, "the text sent", g.text, w.Text)
				case "template":
					if g.template.Name != w.Template.Name || g.template.Language != w.Template.Language || !reflect.DeepEqual(g.template.Parameters, w.Template.Parameters) {
						t.Errorf("template sent %+v, want %+v", g.template, *w.Template)
					}
					eq(t, j.Mode, "the template text", g.template.Text, w.Template.Text)
				case "document":
					t.Errorf("a document was sent: Fees has no monthly certificate to send")
				}
			}
			written := rec.entries[before:]
			if len(written) != len(j.Written) {
				t.Fatalf("record entries written: %d, want %d", len(written), len(j.Written))
			}
			for i, w := range j.Written {
				g := written[i]
				if g.Seq != w.Seq || g.Time != w.Time || g.Action != w.Action || g.Outcome != w.Outcome || !samePtr(g.Booking, w.Booking) || g.Language != w.Language || g.Notes != w.Notes || !reflect.DeepEqual(g.Refs, w.Refs) {
					t.Errorf("entry %d: got %+v, want %+v", i, g, w)
				}
			}
			if !reflect.DeepEqual(saves, j.Saves) && !(len(saves) == 0 && len(j.Saves) == 0) {
				t.Errorf("saves %v, want %v", saves, j.Saves)
			}
			if !reflect.DeepEqual(logs, j.Logs) && !(len(logs) == 0 && len(j.Logs) == 0) {
				t.Errorf("logs %q, want %q", logs, j.Logs)
			}
			files := map[string]string{}
			filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
				if err == nil && !d.IsDir() {
					rel, _ := filepath.Rel(dir, p)
					raw, _ := os.ReadFile(p)
					s := sha256.Sum256(raw)
					files[filepath.ToSlash(rel)] = hex.EncodeToString(s[:])
				}
				return nil
			})
			if !reflect.DeepEqual(files, j.Files) && !(len(files) == 0 && len(j.Files) == 0) {
				var names []string
				for n := range j.Files {
					names = append(names, n)
				}
				sort.Strings(names)
				for _, n := range names {
					if files[n] != j.Files[n] {
						t.Errorf("file %s differs from the TypeScript's", n)
					}
				}
				t.Errorf("files: got %d, want %d", len(files), len(j.Files))
			}
		})
	}
}

func TestJobRefusesAReportWithNoPreparer(t *testing.T) {
	v := vecs(t)
	settings := v.Cases[0].Settings
	dir := t.TempDir()
	now := v.Job[0].Now
	rec := &memRecord{entries: v.entriesOf(t, v.Job[0].Entries), now: func() int64 { return now }}
	msg := &fakeMessaging{mode: "template"}
	setup := Setup{Source: "live", PagesDir: dir, PagesBaseURL: "https://reports.example.com/r", Options: func() Options { return Options{PreparedBy: ""} },
		Shop: func() Shop { return Shop{Settings: settings, Entries: rec.Entries()} }}
	ctx := report.JobContext{Timezone: "Asia/Kolkata", OwnerWhatsapp: "+919800000000", OwnerLanguage: "en", Now: func() int64 { return now }, Messaging: msg, Record: rec, Save: func() {}}
	before := len(rec.entries)
	_, err := NewMonthlyJob(setup).Run(ctx)
	// a report that names no one who set the agent up cannot be sent: the job refuses before it claims the month
	if err == nil || !strings.Contains(err.Error(), "names no one who set the agent up") {
		t.Fatalf("expected the refusal to send a report with no preparer, got %v", err)
	}
	if len(rec.entries) != before || len(msg.sent) != 0 {
		t.Errorf("a refused report claimed the month or sent something")
	}
}
