package understanding

// The shared readers of a customer's words (rules.go) proved equal to the TypeScript's on the corpus of go/scripts/gen_patterns.ts (language/testdata/pattern-vectors.json,
// `readers`: findOffer, detectLanguage, isStop, isOverrideAttempt).

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/language"
)

func TestRulesEqualJavaScript(t *testing.T) {
	b, err := os.ReadFile("../language/testdata/pattern-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Readers []struct {
			Text     string
			Offer    *float64
			Language *string
			Stop     bool
			Override bool
		}
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Readers) < 100 {
		t.Fatalf("only %d rows", len(v.Readers))
	}
	for _, r := range v.Readers {
		c := language.Canon(r.Text)
		want := int64(-1)
		if r.Offer != nil {
			want = int64(*r.Offer)
		}
		if got := FindOffer(c); got != want {
			t.Errorf("offer in %q: Go %d, JavaScript %d", r.Text, got, want)
		}
		wantL := ""
		if r.Language != nil {
			wantL = *r.Language
		}
		if got := DetectLanguage(r.Text); got != wantL {
			t.Errorf("language of %q: Go %q, JavaScript %q", r.Text, got, wantL)
		}
		if got := IsStop(c); got != r.Stop {
			t.Errorf("stop %q: Go %v, JavaScript %v", r.Text, got, r.Stop)
		}
		if got := IsOverrideAttempt(c); got != r.Override {
			t.Errorf("override %q: Go %v, JavaScript %v", r.Text, got, r.Override)
		}
	}
}
