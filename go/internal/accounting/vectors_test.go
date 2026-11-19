// Shared by the books' tests: the vectors the TypeScript made (testdata/*.json, scripts/gen_books_vectors.ts), read once per file, and the small helpers that compare Go values with them.
// Every comparison is of decoded JSON (so key order does not matter) but every STRING is compared byte for byte, and so is every thrown message.
package accounting

import (
	"encoding/json"
	"os"
	"reflect"
	"sync"
	"testing"
)

var vecCache sync.Map

// loadVec decodes testdata/<name>.json into out.
func loadVec(t *testing.T, name string, out any) {
	t.Helper()
	raw, ok := vecCache.Load(name)
	if !ok {
		b, err := os.ReadFile("testdata/" + name + ".json")
		if err != nil {
			t.Fatal(err)
		}
		vecCache.Store(name, b)
		raw = b
	}
	if err := json.Unmarshal(raw.([]byte), out); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

// asAny turns a Go value into the generic JSON tree it encodes to, for comparison with a vector decoded the same way.
func asAny(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// sameJSON fails the test when what Go made differs from what the TypeScript made; what names the case.
func sameJSON(t *testing.T, what string, got any, want json.RawMessage) {
	t.Helper()
	var w any
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatalf("%s: bad vector: %v", what, err)
	}
	if g := asAny(t, got); !reflect.DeepEqual(g, w) {
		gb, _ := json.Marshal(g)
		wb, _ := json.Marshal(w)
		t.Errorf("%s:\n go %s\n ts %s", what, gb, wb)
	}
}

// outcome is {"value": ...} or {"error": "..."}: what a function that may refuse gave in the TypeScript.
type outcome[T any] struct {
	Value *T      `json:"value"`
	Error *string `json:"error"`
}
