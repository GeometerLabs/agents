// Tests of the text helpers, months, the settled-by-word rows, the claim rules, the go-live reading and the fault test against the TypeScript's output (testdata/vectors.json).
package report

import (
	"errors"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/GeometerLabs/agents/go/internal/accounting"
)

func TestTextHelpersMatchTypeScript(t *testing.T) {
	var x struct {
		LanguagesOf []struct {
			Lang string
			Out  []string
		}
		Rupees []struct {
			Paise int64
			Out   string
		}
		OneLine    []struct{ Text, Out string }
		Innovator  []struct{ Lang, Word, Badge string }
		SettledBy  []struct{ Lang, Who, Out string }
		SettledWho []struct{ By, Out string }
		Words      []struct {
			Lang string
			Rows []struct {
				By    string
				Count int
				Paise int64
			}
			Max int
			Out *string
		}
	}
	vec(t, "text", &x)
	for _, c := range x.LanguagesOf {
		if !slices.Equal(LanguagesOf(c.Lang), c.Out) {
			t.Errorf("languagesOf %s", c.Lang)
		}
	}
	for _, c := range x.Rupees {
		if got := Rupees(c.Paise); got != c.Out {
			t.Errorf("rupees(%d) = %q, TypeScript %q", c.Paise, got, c.Out)
		}
	}
	for _, c := range x.OneLine {
		if OneLine(c.Text) != c.Out {
			t.Errorf("oneLine(%q) = %q, TypeScript %q", c.Text, OneLine(c.Text), c.Out)
		}
	}
	for _, c := range x.Innovator {
		if Innovator(c.Lang) != c.Word || BadgeText(c.Lang) != c.Badge {
			t.Errorf("innovator %s", c.Lang)
		}
	}
	for _, c := range x.SettledBy {
		if SettledByWord(c.Lang, c.Who) != c.Out {
			t.Errorf("settled by word %s %q", c.Lang, c.Who)
		}
	}
	for _, c := range x.SettledWho {
		if SettledWho(c.By) != c.Out {
			t.Errorf("settledWho(%q) = %q, TypeScript %q", c.By, SettledWho(c.By), c.Out)
		}
	}
	fallbacks := map[int]bool{}
	for _, c := range x.Words {
		rows := make([]SettledRow, len(c.Rows))
		for i, r := range c.Rows {
			rows[i] = SettledRow{r.By, r.Count, r.Paise}
		}
		got, ok := SettledByWordWords(rows, c.Lang, func(n int) string { return "+" + itoa(n) + " more" }, func(w string) bool { return units(w) <= c.Max })
		if (c.Out == nil) == ok || (ok && got != *c.Out) {
			t.Errorf("settledByWordWords %s %d rows max %d: %q %v, TypeScript %v", c.Lang, len(rows), c.Max, got, ok, c.Out != nil)
		}
		if ok && len(rows) > 0 {
			fallbacks[strings.Count(got, ":")] = true
		}
	}
	if len(fallbacks) < 2 {
		t.Error("the cases reach too few of the fallbacks")
	}
	// the three fallbacks, spelled out: named, then totals with the amount, then the count alone, then nothing
	rows := []SettledRow{{"operator:asha", 2, 45050}, {"meera", 1, 9900}, {"ravi", 4, 100}}
	for max, want := range map[int]string{1000: "Settled by asha, by their word: 2 (₹450.5) · Settled by meera, by their word: 1 (₹99) · +1 more", 60: "Settled by a person, by their word: 7 (₹550.5)", 40: "Settled by a person, by their word: 7"} {
		got, ok := SettledByWordWords(rows, "en", func(n int) string { return "+" + itoa(n) + " more" }, func(w string) bool { return len(w) <= max })
		if !ok || got != want {
			t.Errorf("max %d: %q %v, want %q", max, got, ok, want)
		}
	}
	if _, ok := SettledByWordWords(rows, "en", func(int) string { return "" }, func(string) bool { return false }); ok {
		t.Error("nothing fits: none")
	}
	if _, ok := SettledByWordWords(nil, "en", nil, func(string) bool { return true }); ok {
		t.Error("nobody settled: none")
	}
	// a name cut inside a surrogate pair: JavaScript leaves half an emoji, Go drops it (Deferred.md)
	if got := SettledWho("operator:" + strings.Repeat("😀", 30)); got != strings.Repeat("😀", 19)+"…" {
		t.Errorf("cut inside a pair: %q", got)
	}
}

func TestMonthsMatchTypeScript(t *testing.T) {
	var months []struct {
		Month, Tz string
		trialOf[struct{ From, To int64 }]
	}
	vec(t, "months", &months)
	for _, m := range months {
		from, to, err := MonthRange(m.Month, m.Tz)
		m.same(t, m.Month+" "+m.Tz, struct{ From, To int64 }{from, to}, err, func(a, b struct{ From, To int64 }) bool { return a == b })
	}
	var last []struct {
		Tz   string
		Ms   int64
		Last string
		From int64
	}
	vec(t, "lastMonth", &last)
	for _, c := range last {
		if LastMonth(c.Ms, c.Tz) != c.Last || SendFrom(c.Ms, c.Tz) != c.From {
			t.Errorf("%s %d: %s %d, TypeScript %s %d", c.Tz, c.Ms, LastMonth(c.Ms, c.Tz), SendFrom(c.Ms, c.Tz), c.Last, c.From)
		}
	}
}

func TestSettledByWordRowsMatchTypeScript(t *testing.T) {
	var sets []struct {
		Entries []accounting.Entry
		Out     struct {
			Rows []struct {
				By    string
				Count int
				Paise int64
			}
			MissingAmounts int
		}
	}
	vec(t, "settledEntries", &sets)
	for i, s := range sets {
		rows, missing := SettledByWordOf(s.Entries)
		if missing != s.Out.MissingAmounts || len(rows) != len(s.Out.Rows) {
			t.Errorf("set %d: %d rows %d missing, TypeScript %d %d", i, len(rows), missing, len(s.Out.Rows), s.Out.MissingAmounts)
			continue
		}
		for j, r := range s.Out.Rows {
			if rows[j].By != r.By || rows[j].Count != r.Count || rows[j].Paise != r.Paise {
				t.Errorf("set %d row %d: %+v, TypeScript %+v", i, j, rows[j], r)
			}
		}
	}
}

func TestClaimRulesMatchTypeScript(t *testing.T) {
	var cases []struct {
		Text, Lang string
		Out        []string
	}
	vec(t, "claims", &cases)
	hits := 0
	for _, c := range cases {
		got := BannedIn(c.Text, c.Lang)
		if !slices.Equal(got, c.Out) && !(len(got) == 0 && len(c.Out) == 0) {
			t.Errorf("bannedIn(%q, %s) = %v, TypeScript %v", c.Text, c.Lang, got, c.Out)
		}
		if len(c.Out) > 0 {
			hits++
		}
	}
	if hits < 40 {
		t.Errorf("only %d texts were flagged", hits)
	}
}

func TestGoLiveReadingMatchesTypeScript(t *testing.T) {
	var g struct {
		Subject struct {
			Pathway                                     []string
			OwnDigest, ExampleDigest, Noun, ExampleName string
		}
		Cases []struct {
			Name, Text string
			Reading    struct {
				Finding struct {
					Status, Code, SignedBy                 string
					IssuedOn                               struct{ Year, Month, Day int }
					Held, Total, Failed, NotRun, NotTested int
				}
				Said string
			}
		}
	}
	vec(t, "goLive", &g)
	subject := GoLiveSubject{Pathway: g.Subject.Pathway, OwnDigest: g.Subject.OwnDigest, ExampleDigest: g.Subject.ExampleDigest, Noun: g.Subject.Noun, ExampleName: g.Subject.ExampleName}
	statuses := map[string]bool{}
	for _, c := range g.Cases {
		got := ReadGoLiveText(c.Text, subject)
		w := c.Reading
		f := got.Finding
		statuses[f.Status] = true
		if f.Status != w.Finding.Status || f.Code != w.Finding.Code || f.SignedBy != w.Finding.SignedBy || f.IssuedOn.Year != w.Finding.IssuedOn.Year || f.IssuedOn.Month != w.Finding.IssuedOn.Month || f.IssuedOn.Day != w.Finding.IssuedOn.Day ||
			f.Held != w.Finding.Held || f.Total != w.Finding.Total || f.Failed != w.Finding.Failed || f.NotRun != w.Finding.NotRun || f.NotTested != w.Finding.NotTested {
			t.Errorf("%s: %+v, TypeScript %+v", c.Name, f, w.Finding)
		}
		// the sentence names the JSON parser's own message for no file, but never here: an unreadable file says "changed" without a reason
		if got.Said != w.Said {
			t.Errorf("%s: said\n%s\n%s", c.Name, got.Said, w.Said)
		}
	}
	for _, s := range []string{"own", "example", "different", "untrusted"} {
		if !statuses[s] {
			t.Errorf("no case reached %q", s)
		}
	}
	if r := NoGoLive("shop"); r.Finding.Status != "none" || !strings.Contains(r.Said, "No go-live certificate was given") {
		t.Error("noGoLive")
	}
}

func TestNothingWasSent(t *testing.T) {
	var cases []struct {
		Name string
		Out  bool
	}
	vec(t, "faults", &cases)
	errs := map[string]error{
		"notSent": &NotSentError{"refused"}, "guard": &GuardUnavailableError{503, "busy"}, "api400": &APIError{400, "bad"}, "api499": &APIError{499, "bad"}, "api500": &APIError{500, "bad"},
		"api399": &APIError{399, "x"}, "window": &WindowClosedError{}, "plain": errors.New("x"), "string": errors.New("x"),
	}
	for _, c := range cases {
		if NothingWasSent(errs[c.Name]) != c.Out {
			t.Errorf("%s: %v, TypeScript %v", c.Name, !c.Out, c.Out)
		}
	}
	if NothingWasSent(nil) || !NothingWasSent(errors.Join(errors.New("wrapped"), &APIError{404, "x"})) {
		t.Error("nil and wrapped errors")
	}
}

func itoa(n int) string { return strconv.Itoa(n) }

// units is the JavaScript `.length` of a string, which `fits` in the vectors measured.
func units(s string) int { return len(utf16.Encode([]rune(s))) }
