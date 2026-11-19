package language

// The customer's readers in this package (FindTimePhrase, FindDatePhrase, BlankWrittenDate) and the sources WordRe builds, proved equal to the TypeScript on its own outputs over
// the corpus of go/scripts/gen_patterns.ts (testdata/pattern-vectors.json, `readers` and `wordRe`).

import (
	"encoding/json"
	"os"
	"testing"
)

// Readers is one row of the vectors' `readers`, shared with the understanding package's test.
type Readers struct {
	Text     string
	Offer    *float64
	Time     map[string]any
	Date     map[string]any
	Language *string
	Stop     bool
	Override bool
	Blanked  string
}

func readersVectors(t *testing.T) ([]Readers, []struct {
	Words         []string
	Source, Plain string
}) {
	b, err := os.ReadFile("testdata/pattern-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Readers []Readers
		WordRe  []struct {
			Words         []string
			Source, Plain string
		} `json:"wordRe"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Readers) < 100 || len(v.WordRe) == 0 {
		t.Fatalf("only %d reader rows and %d word lists", len(v.Readers), len(v.WordRe))
	}
	return v.Readers, v.WordRe
}

func sameJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	var p, q any
	_ = json.Unmarshal(x, &p)
	_ = json.Unmarshal(y, &q)
	x, _ = json.Marshal(p)
	y, _ = json.Marshal(q)
	return string(x) == string(y)
}

func TestReadersEqualJavaScript(t *testing.T) {
	rows, lists := readersVectors(t)
	for _, r := range rows {
		var tm, d any
		if p := FindTimePhrase(r.Text); p != nil {
			tm = p.JSON()
		}
		if p := FindDatePhrase(r.Text); p != nil {
			d = p.JSON()
		}
		var wantT, wantD any
		if r.Time != nil {
			wantT = r.Time
		}
		if r.Date != nil {
			wantD = r.Date
		}
		if !sameJSON(tm, wantT) {
			t.Errorf("time of %q: Go %v, JavaScript %v", r.Text, tm, wantT)
		}
		if !sameJSON(d, wantD) {
			t.Errorf("date of %q: Go %v, JavaScript %v", r.Text, d, wantD)
		}
		if got := BlankWrittenDate(Canon(r.Text)); got != r.Blanked {
			t.Errorf("blanked %q: Go %q, JavaScript %q", r.Text, got, r.Blanked)
		}
	}
	for _, l := range lists {
		if got := WordReSource(l.Words, true); got != l.Source {
			t.Errorf("wordRe %q: Go %s, JavaScript %s", l.Words, got, l.Source)
		}
		if got := WordReSource(l.Words, false); got != l.Plain {
			t.Errorf("wordRe %q (no endings): Go %s, JavaScript %s", l.Words, got, l.Plain)
		}
		WordRe(l.Words, "u", true) // and it compiles
	}
}
