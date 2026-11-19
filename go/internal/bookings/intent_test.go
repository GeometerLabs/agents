package bookings

// A model's answer checked by hand (coerceIntent) and a tap read with no model (intentFromReply), proved equal to the TypeScript on the SAME inputs: testdata/coerce-vectors.json
// (area "coerce") and testdata/templates-vectors.json (area "reply"). They stand for parts of the TypeScript unit tests parser, model-llm and buttons.

import (
	"encoding/json"
	"testing"
)

func sameJSON(t *testing.T, name string, want json.RawMessage, got any) {
	t.Helper()
	var w, g any
	_ = json.Unmarshal(want, &w)
	b, _ := json.Marshal(got)
	_ = json.Unmarshal(b, &g)
	if string(mustJSON(w)) != string(mustJSON(g)) {
		t.Errorf("%s: want %s, got %s", name, mustJSON(w), mustJSON(g))
	}
}

func TestCoerceVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "coerce-vectors.json", &vs)
	s := exampleSettings(t)
	n := 0
	for _, v := range vs {
		if v.Area != "coerce" {
			continue // "sure", "prompt", "schema" read the rule parser and the model's prompt, not ported yet
		}
		var in any
		_ = json.Unmarshal(v.Input, &in)
		got := CoerceIntent(in, s)
		if got == nil {
			sameJSON(t, v.Name, v.Output, nil)
		} else {
			sameJSON(t, v.Name, v.Output, got)
		}
		n++
	}
	if n == 0 {
		t.Fatal("no coerce cases")
	}
}

func TestReplyVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "templates-vectors.json", &vs)
	s := exampleSettings(t)
	for _, v := range vs {
		if v.Area != "reply" {
			continue
		}
		var in struct{ ID string }
		_ = json.Unmarshal(v.Input, &in)
		got := IntentFromReply(in.ID, s)
		if got == nil {
			sameJSON(t, v.Name, v.Output, nil)
		} else {
			sameJSON(t, v.Name, v.Output, got)
		}
	}
}
