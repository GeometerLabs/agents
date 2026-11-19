// Redact takes out of each phrase of the corpus exactly what redact.ts takes out (go/scripts/gen_patterns.ts writes both the phrases and the TypeScript's results).
package understanding

import (
	"encoding/json"
	"os"
	"testing"
)

func TestRedactEqualsTypeScript(t *testing.T) {
	b, err := os.ReadFile("../language/testdata/pattern-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct{ Redact [][2]string }
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Redact) < 100 {
		t.Fatal("too few phrases")
	}
	changed := 0
	for _, p := range v.Redact {
		if got := Redact(p[0]); got != p[1] {
			t.Errorf("%q: Go %q, TypeScript %q", p[0], got, p[1])
		}
		if p[0] != p[1] {
			changed++
		}
	}
	if changed < 5 {
		t.Fatalf("only %d phrases had anything taken out", changed)
	}
}
