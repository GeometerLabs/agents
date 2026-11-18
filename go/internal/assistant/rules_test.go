package assistant

import (
	"encoding/json"
	"os"
	"testing"
)

// TestRulesEqualTypeScript: the kind, the case reference, a forgotten note's id, a message's or a note's words and the date's offset the Go reader finds in each phrase are what the
// TypeScript reader (go/scripts/gen_rules_vectors.ts, modules/assistant/intents.ts readOwnerRules) finds in it.
func TestRulesEqualTypeScript(t *testing.T) {
	b, err := os.ReadFile("testdata/rules-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vs []struct {
		Text, Kind, Ref, Note, Words string
		Date                         any
	}
	if err := json.Unmarshal(b, &vs); err != nil {
		t.Fatal(err)
	}
	if len(vs) < 100 {
		t.Fatal("too few phrases")
	}
	for _, v := range vs {
		got := ReadOwnerRules(v.Text)
		if got.Kind != v.Kind || got.Ref != v.Ref || got.Note != v.Note {
			t.Errorf("%q: Go reads %s ref=%q note=%q; TypeScript %s ref=%q note=%q", v.Text, got.Kind, got.Ref, got.Note, v.Kind, v.Ref, v.Note)
			continue
		}
		if (v.Kind == "message" || v.Kind == "remember") && got.Words != v.Words {
			t.Errorf("%q: words %q, TypeScript %q", v.Text, got.Words, v.Words)
		}
		switch d := v.Date.(type) {
		case nil:
			if got.Date != nil {
				t.Errorf("%q: Go finds a date, TypeScript none", v.Text)
			}
		case string:
			if got.Date == nil || !got.Date.Other {
				t.Errorf("%q: TypeScript finds another kind of date, Go %+v", v.Text, got.Date)
			}
		case float64:
			if got.Date == nil || got.Date.Other || got.Date.Offset != int(d) {
				t.Errorf("%q: date offset %v, Go %+v", v.Text, d, got.Date)
			}
		}
	}
}

func TestOfferedTurnsOtherKindsIntoUnknown(t *testing.T) {
	for kind, want := range map[string]string{"day": "unknown", "owes": "unknown", "open_orders": "unknown", "close_day": "unknown", "move": "unknown", "help": "help", "limit": "limit", "money": "money", "leave_file": "leave_file", "unknown": "unknown"} {
		if got := Offered(kind); got != want {
			t.Errorf("%s -> %s, want %s", kind, got, want)
		}
	}
}
