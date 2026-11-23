package stockorders

// Proves the Stock orders settings reader (settings.go) equal to the TypeScript's validateSettings on testdata/settings-vectors.json (go/scripts/gen_stockorders_settings.ts): the Glow
// salon example and many hostile or sloppy variations of it. For a file that is refused, the plain-words problems must be the TypeScript's, in the same order (the `assistant` block's
// own sentences included); for one that passes, the checked tree must be the one the TypeScript returns (what the monthly report digests). The inputs are read as text, so the order
// of a file's keys, which the unknown-key sentences list, is the TypeScript's.

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestSettingsMatchValidateSettings(t *testing.T) {
	raw, err := os.ReadFile("testdata/settings-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Name   string         `json:"name"`
			Text   string         `json:"text"`
			OK     bool           `json:"ok"`
			Errors []string       `json:"errors"`
			Tree   map[string]any `json:"tree"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Cases) < 80 {
		t.Fatalf("only %d cases in the vectors", len(file.Cases))
	}
	for _, c := range file.Cases {
		s, errs := ReadSettings([]byte(c.Text))
		if !c.OK {
			if !reflect.DeepEqual(errs, c.Errors) {
				t.Errorf("%s:\n go %q\n ts %q", c.Name, errs, c.Errors)
			}
			continue
		}
		if len(errs) > 0 {
			t.Errorf("%s: refused here (%q), accepted by the TypeScript", c.Name, errs)
			continue
		}
		b, _ := json.Marshal(s.Tree()) // through JSON, as the report's tree is handed on
		var got map[string]any
		_ = json.Unmarshal(b, &got)
		if !reflect.DeepEqual(got, c.Tree) {
			wb, _ := json.Marshal(c.Tree)
			t.Errorf("%s: the tree differs\n got %s\nwant %s", c.Name, b, wb)
		}
	}
}
