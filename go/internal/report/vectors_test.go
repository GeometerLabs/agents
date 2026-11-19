// Shared by the report tests: the vectors the TypeScript made (testdata/vectors.json, scripts/gen_report_vectors.ts) and the small helpers that read them. The signing keys are TEST
// values made from fixed seeds in that script; nothing here is a real key.
package report

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

// languages is languages.ts LANGUAGES, in the order the vectors use.
var languages = []string{"hi", "en", "ml", "kn"}

var (
	vecOnce sync.Once
	vecRaw  map[string]json.RawMessage
)

// vec decodes one top-level member of testdata/vectors.json into out.
func vec(t *testing.T, name string, out any) {
	t.Helper()
	vecOnce.Do(func() {
		raw, err := os.ReadFile("testdata/vectors.json")
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &vecRaw); err != nil {
			t.Fatal(err)
		}
	})
	raw, ok := vecRaw[name]
	if !ok {
		t.Fatalf("no %q in the vectors", name)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

// tree reads JSON text as the tree CanonicalJSON takes (numbers kept as json.Number: the doubles JSON.parse would make).
func tree(t *testing.T, text string) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader([]byte(text)))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

type keyVectors struct {
	Seed       string `json:"seed"`
	PublicKey  string `json:"publicKey"`
	KeyID      string `json:"keyId"`
	Seed2      string `json:"seed2"`
	PublicKey2 string `json:"publicKey2"`
	Pem        string `json:"pem"`
	Pem2       string `json:"pem2"`
}

func testKeys(t *testing.T) (main, other ed25519.PrivateKey, kv keyVectors) {
	t.Helper()
	vec(t, "keys", &kv)
	s1, _ := hex.DecodeString(kv.Seed)
	s2, _ := hex.DecodeString(kv.Seed2)
	return ed25519.NewKeyFromSeed(s1), ed25519.NewKeyFromSeed(s2), kv
}

// trialOf is what the generator's `trial` writes: {ok: value} or {error: message}.
type trialOf[T any] struct {
	OK    *T      `json:"ok"`
	Error *string `json:"error"`
}

// same compares what Go gave with a trial: the same value, or the same error message.
func (tr trialOf[T]) same(t *testing.T, what string, got T, err error, eq func(a, b T) bool) {
	t.Helper()
	switch {
	case tr.Error != nil:
		if err == nil || err.Error() != *tr.Error {
			t.Errorf("%s: error %v, TypeScript %q", what, err, *tr.Error)
		}
	case err != nil:
		t.Errorf("%s: error %v, TypeScript gave a value", what, err)
	case !eq(got, *tr.OK):
		t.Errorf("%s: %v, TypeScript %v", what, got, *tr.OK)
	}
}

func strEq(a, b string) bool { return a == b }
