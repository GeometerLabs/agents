// Proves the validated settings tree (settings_check.go) equal to the TypeScript's validateSettings on testdata/settings-tree-vectors.json (go/scripts/gen_bookings_settings.ts): for every
// shop accepted, the checked tree AND the policy digest of it (bookingsreport.PolicyDigest equals report/data.ts policyDigest), for every shop refused, the plain-words problems in order.
// The inputs are read as text (json.RawMessage), so the order of a file's keys, which the unknown-key sentences list, is the TypeScript's.
package bookings

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
)

type treeCase struct {
	Name   string          `json:"name"`
	Input  json.RawMessage `json:"input"`
	OK     bool            `json:"ok"`
	Tree   any             `json:"tree"`
	Digest string          `json:"digest"`
	Errors []string        `json:"errors"`
}

func loadTreeCases(t *testing.T) []treeCase {
	t.Helper()
	b, err := os.ReadFile("testdata/settings-tree-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []treeCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) < 80 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	return f.Cases
}

func TestSettingsTreeVectors(t *testing.T) {
	var accepted, refused int
	for _, c := range loadTreeCases(t) {
		s, tree, errs := CheckSettingsFile(c.Input)
		if !c.OK {
			refused++
			if s != nil || !reflect.DeepEqual(errs, c.Errors) {
				t.Errorf("%s: problems\n got %q\nwant %q", c.Name, errs, c.Errors)
			}
			continue
		}
		accepted++
		if len(errs) > 0 {
			t.Errorf("%s: refused: %q", c.Name, errs)
			continue
		}
		// the tree as JSON reads it back, so a float64 is a number on both sides
		b, _ := json.Marshal(tree)
		var got any
		_ = json.Unmarshal(b, &got)
		if !reflect.DeepEqual(got, c.Tree) {
			t.Errorf("%s: tree\n got %s\nwant %s", c.Name, b, mustJSON(c.Tree))
		}
		if d := bookingsreport.PolicyDigest(tree); d != c.Digest {
			t.Errorf("%s: policy digest %s, want %s", c.Name, d, c.Digest)
		}
		// a raw file and the validated tree differ (the point of this file): the example's raw digest is not its validated one when a default was left out
		if raw, err := bookingsreport.ParseSettings(c.Input); err == nil && c.Name == "glow-salon.example.json: no time zone, buffer, languages, hold, owner language or reminders" {
			if bookingsreport.PolicyDigest(raw) == c.Digest {
				t.Errorf("%s: the raw file has the validated digest, so the vector proves nothing", c.Name)
			}
		}
	}
	if accepted < 30 || refused < 30 {
		t.Errorf("accepted %d, refused %d: the vectors are too few to mean anything", accepted, refused)
	}
}

func TestCheckSettingsFileRefusals(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{`[1]`, "The settings must be an object with the business's name, services, hours and so on."},
		{`{"name":`, "The settings file is not valid JSON"},
	} {
		_, _, errs := CheckSettingsFile([]byte(c.in))
		if len(errs) != 1 || (len(errs[0]) < len(c.want) || errs[0][:len(c.want)] != c.want) {
			t.Errorf("%s: got %q", c.in, errs)
		}
	}
}
