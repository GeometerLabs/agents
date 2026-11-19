package terms_test

// The shop terms against what the TypeScript made (testdata/terms-vectors.json, written by go/scripts/vectors/terms.ts from modules/terms): the text and digest for many shops in the
// four languages, readTermsFile on many inputs, the two word patterns on a corpus, and the owner's side run through scripted conversations (what was sent, what was recorded). The words
// themselves are words.json, generated from the TypeScript, never typed here. Go-only tests at the end: the reader on a real folder, and a language the terms do not exist in.

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/terms"
)

type vectors struct {
	Texts []struct {
		Lang   string
		Shop   string
		File   terms.File
		Text   string
		Digest string
	}
	Reads []struct {
		JSON string `json:"json"`
		Out  any    `json:"out"`
	}
	Patterns []struct {
		Text    string
		Request bool
		Agree   bool
	}
	Owner []scenario
}

type scenario struct {
	Name          string
	Setup         *terms.File
	ShopName      string
	OwnerNumber   string
	OwnerLanguage string
	Interactive   bool
	FailText      []int
	FailInt       bool `json:"failInteractive"`
	Messages      []msg
	Throws        string
	Changing      bool
	Steps         []struct {
		Setup terms.File
		M     msg
	}
	Handled []bool
	Sent    []any
	Logged  []any
}

type msg struct {
	ID    string
	Text  string
	Reply *struct{ ID string }
}

func load(t *testing.T) vectors {
	t.Helper()
	b, err := os.ReadFile("testdata/terms-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Texts) < 100 || len(v.Reads) < 30 || len(v.Patterns) < 50 || len(v.Owner) < 10 {
		t.Fatalf("the vector file is nearly empty: %d %d %d %d", len(v.Texts), len(v.Reads), len(v.Patterns), len(v.Owner))
	}
	return v
}

func TestConstantsAreTheTypeScripts(t *testing.T) {
	version, sent, agreed, prefix, later, review := terms.Constants()
	if version != terms.Version || sent != terms.SentAction || agreed != terms.AgreedAction || prefix != terms.AgreePrefix || later != terms.LaterID || review != terms.ReviewState {
		t.Errorf("the Go constants differ from the generated ones: %s %s %s %s %s %s", version, sent, agreed, prefix, later, review)
	}
}

func TestTextAndDigestMatchTypeScript(t *testing.T) {
	for _, c := range load(t).Texts {
		got, err := terms.Text(c.Lang, c.Shop, c.File)
		if err != nil {
			t.Fatal(err)
		}
		if got != c.Text {
			t.Errorf("%s %q %+v: the text differs\n  Go: %s\n  TS: %s", c.Lang, c.Shop, c.File, got, c.Text)
		} else if terms.Digest(got) != c.Digest {
			t.Errorf("%s %q: digest %s, TypeScript %s", c.Lang, c.Shop, terms.Digest(got), c.Digest)
		}
	}
}

func TestReadFileMatchesTypeScript(t *testing.T) {
	for _, c := range load(t).Reads {
		raw, err := guard.Decode(c.JSON)
		if err != nil {
			t.Fatalf("%s: %v", c.JSON, err)
		}
		var got any
		if f := terms.ReadFile(raw); f != nil {
			b, _ := json.Marshal(f)
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatal(err)
			}
		}
		if !reflect.DeepEqual(got, c.Out) {
			t.Errorf("%s: Go %v, TypeScript %v", c.JSON, got, c.Out)
		}
	}
}

func TestPatternsMatchTypeScript(t *testing.T) {
	for _, c := range load(t).Patterns {
		if got := terms.IsTermsRequest(c.Text); got != c.Request {
			t.Errorf("isTermsRequest(%q) = %v, TypeScript %v", c.Text, got, c.Request)
		}
		if got := terms.IsAgreeWords(c.Text); got != c.Agree {
			t.Errorf("isAgreeWords(%q) = %v, TypeScript %v", c.Text, got, c.Agree)
		}
	}
}

// ---- the owner's side --------------------------------------------------------------------------------------------------------------

type recorder struct {
	sent    []any
	logged  []any
	entries []terms.Entry
	texts   int
	failAt  map[int]bool
	failInt bool
}

type textOnly struct{ r *recorder }

func (m textOnly) SendText(_ context.Context, to, body string) error {
	n := m.r.texts
	m.r.texts++
	row := map[string]any{"kind": "text", "to": to, "body": body}
	if m.r.failAt[n] {
		row["failed"] = true
	}
	m.r.sent = append(m.r.sent, row)
	if m.r.failAt[n] {
		return errors.New("boom")
	}
	return nil
}

type withButtons struct{ textOnly }

func (m withButtons) SendInteractive(_ context.Context, to string, i terms.Interactive) error {
	buttons := []any{}
	for _, b := range i.Buttons {
		buttons = append(buttons, map[string]any{"id": b.ID, "title": b.Title})
	}
	row := map[string]any{"kind": "interactive", "to": to, "message": map[string]any{"body": i.Body, "buttons": buttons}}
	if m.r.failInt {
		row["failed"] = true
	}
	m.r.sent = append(m.r.sent, row)
	if m.r.failInt {
		return errors.New("no buttons today")
	}
	return nil
}

func (r *recorder) Entries() []terms.Entry { return r.entries }

func (r *recorder) log(action, outcome string, inputs any, more terms.LogMore) {
	row := map[string]any{"action": action, "outcome": outcome, "inputs": inputs, "notes": more.Notes, "refs": more.Refs}
	r.logged = append(r.logged, row)
	refs := more.Refs
	if refs == nil {
		refs = map[string]string{}
	}
	r.entries = append(r.entries, terms.Entry{Action: action, Outcome: outcome, Refs: refs})
}

func normal(v any) any {
	b, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}

func (r *recorder) deps(s scenario, setup *terms.File, buttons bool) terms.Deps {
	var m terms.Messaging = textOnly{r}
	if buttons {
		m = withButtons{textOnly{r}}
	}
	return terms.Deps{Setup: setup, ShopName: s.ShopName, OwnerNumber: s.OwnerNumber, OwnerLanguage: s.OwnerLanguage, Messaging: m, Record: r, Log: r.log}
}

func toMessage(m msg) terms.Message {
	out := terms.Message{ID: m.ID, Text: m.Text}
	if m.Reply != nil {
		id := m.Reply.ID
		out.ReplyID = &id
	}
	return out
}

func TestOwnerMatchesTypeScript(t *testing.T) {
	for _, s := range load(t).Owner {
		t.Run(s.Name, func(t *testing.T) {
			r := &recorder{failAt: map[int]bool{}, failInt: s.FailInt, sent: []any{}, logged: []any{}}
			for _, n := range s.FailText {
				r.failAt[n] = true
			}
			var handled []bool
			if s.Changing {
				for _, st := range s.Steps {
					setup := st.Setup
					handled = append(handled, terms.HandleOwner(context.Background(), toMessage(st.M), r.deps(scenario{ShopName: "Glow Salon", OwnerNumber: "+919811111111", OwnerLanguage: "en"}, &setup, true)))
				}
			} else {
				for _, m := range s.Messages {
					handled = append(handled, terms.HandleOwner(context.Background(), toMessage(m), r.deps(s, s.Setup, s.Interactive)))
				}
			}
			if s.Throws != "" {
				// the TypeScript throws on a language it has no row for; Go leaves the message alone and sends nothing (see Explanation.md)
				if len(r.sent) != 0 || len(r.logged) != 0 {
					t.Errorf("Go sent or logged for a language with no terms: %v %v", r.sent, r.logged)
				}
				return
			}
			if !reflect.DeepEqual(handled, s.Handled) {
				t.Errorf("handled: Go %v, TypeScript %v", handled, s.Handled)
			}
			if !reflect.DeepEqual(normal(r.sent), normal(s.Sent)) {
				t.Errorf("sent differs\n  Go: %v\n  TS: %v", normal(r.sent), normal(s.Sent))
			}
			if !reflect.DeepEqual(normal(r.logged), normal(s.Logged)) {
				t.Errorf("logged differs\n  Go: %v\n  TS: %v", normal(r.logged), normal(s.Logged))
			}
		})
	}
}

// ---- Go only -----------------------------------------------------------------------------------------------------------------------

func TestUnknownLanguage(t *testing.T) {
	if _, err := terms.Text("fr", "x", terms.File{}); err == nil {
		t.Error("a language with no terms must be an error")
	}
	if _, ok := terms.Words("fr", terms.Version); ok {
		t.Error("a language with no words")
	}
}

// The reader follows the file, as the TypeScript test of reader.ts does: no file is off, a good one is read, a bad one or a removed one is off again.
func TestReaderFollowsTheFile(t *testing.T) {
	dir := t.TempDir()
	file := terms.File{Schema: 1, PartnerName: "Divya", PartnerPhone: "+919800000000", MonthlyInr: 700, SetupInr: 1500}
	read := terms.NewReader(dir)
	if read() != nil {
		t.Fatal("no file: the feature is off")
	}
	write := func(v any, mtime time.Time) {
		b, _ := json.Marshal(v)
		path := filepath.Join(dir, "terms.json")
		if err := os.WriteFile(path, b, 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, mtime, mtime); err != nil {
			t.Fatal(err)
		}
	}
	t0 := time.Now().Add(-time.Hour)
	write(file, t0)
	if got := read(); got == nil || *got != file {
		t.Fatalf("a good file: %+v", got)
	}
	changed := file
	changed.MonthlyInr = 800
	write(changed, t0.Add(time.Second))
	if got := read(); got == nil || got.MonthlyInr != 800 {
		t.Fatalf("a changed file is read again: %+v", got)
	}
	write(map[string]any{"schema": 2}, t0.Add(2*time.Second))
	if read() != nil {
		t.Fatal("a file that does not check is off")
	}
	// the same modified time and a repaired file: the bad one was remembered by its time, so it stays off until the time changes (the TypeScript's `seen`)
	write(file, t0.Add(2*time.Second))
	if read() != nil {
		t.Fatal("a bad file is remembered as off until its modified time changes")
	}
	write(file, t0.Add(3*time.Second))
	if read() == nil {
		t.Fatal("a repaired file is read")
	}
	if err := os.Remove(filepath.Join(dir, "terms.json")); err != nil {
		t.Fatal(err)
	}
	if read() != nil {
		t.Fatal("the file is gone: off again")
	}
	// not JSON: off, and the modified time is forgotten, so the same file repaired at the same time is read
	if err := os.WriteFile(filepath.Join(dir, "terms.json"), []byte("{oops"), 0o644); err != nil {
		t.Fatal(err)
	}
	if read() != nil {
		t.Fatal("not JSON is off")
	}
	b, _ := json.Marshal(file)
	if err := os.WriteFile(filepath.Join(dir, "terms.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
	if read() == nil {
		t.Fatal("repaired")
	}
}
