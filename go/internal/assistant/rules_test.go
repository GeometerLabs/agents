// Tests of the rule reader: what it reads from each phrase is what TypeScript reads (go/scripts/gen_rules_vectors.ts).
package assistant

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/language"
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
		Date                         *struct {
			Kind                string
			OffsetDays, Weekday int
			Which               string
			Day, Month          int
		}
		Nows     []int64
		Resolved []*string
	}
	if err := json.Unmarshal(b, &vs); err != nil {
		t.Fatal(err)
	}
	if len(vs) < 100 {
		t.Fatal("too few phrases")
	}
	india, _ := time.LoadLocation("Asia/Kolkata")
	for _, v := range vs {
		got := ReadOwnerRules(v.Text)
		if got.Kind != v.Kind || got.Ref != v.Ref || got.Note != v.Note {
			t.Errorf("%q: Go reads %s ref=%q note=%q; TypeScript %s ref=%q note=%q", v.Text, got.Kind, got.Ref, got.Note, v.Kind, v.Ref, v.Note)
			continue
		}
		if (v.Kind == "message" || v.Kind == "remember") && got.Words != v.Words {
			t.Errorf("%q: words %q, TypeScript %q", v.Text, got.Words, v.Words)
		}
		if (v.Date == nil) != (got.Date == nil) {
			t.Errorf("%q: date %+v, TypeScript %+v", v.Text, got.Date, v.Date)
			continue
		}
		if v.Date == nil {
			continue
		}
		d := got.Date
		if d.Kind != v.Date.Kind || d.Offset != v.Date.OffsetDays || d.Weekday != v.Date.Weekday || d.Which != v.Date.Which || d.Day != v.Date.Day || d.Month != v.Date.Month {
			t.Errorf("%q: date %+v, TypeScript %+v", v.Text, *d, *v.Date)
		}
		for i, now := range v.Nows {
			y, m, day, ok := language.ResolveDate(*d, time.UnixMilli(now).In(india))
			gotS := ""
			if ok {
				gotS = fmt.Sprintf("%d-%d-%d", y, int(m), day)
			}
			want := ""
			if v.Resolved[i] != nil {
				want = *v.Resolved[i]
			}
			if gotS != want {
				t.Errorf("%q at %d: resolved to %q, TypeScript %q", v.Text, now, gotS, want)
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
