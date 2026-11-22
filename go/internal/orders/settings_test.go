// Proves the Orders settings check (settings.go, settings_check.go) equal to the TypeScript's validateSettings on testdata/settings-vectors.json.gz (go/scripts/gen_orders_settings.ts):
// for every shop refused, the plain-words problems in order; for every shop accepted, the checked tree, its policy digest (ordersreport.PolicyDigest equals report/data.ts
// policyDigest), and the helpers' answers (highestOrderInr, advanceFor, allSlots with cutoffOf, slotOf, itemOf, itemName, the payment module's capabilities). The inputs are read
// as text (json.RawMessage), so the order of a file's keys, which the unknown-key sentences list, is the TypeScript's.
package orders

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/ordersreport"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

type settingsCase struct {
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	OK      bool            `json:"ok"`
	Tree    any             `json:"tree"`
	Digest  string          `json:"digest"`
	Errors  []string        `json:"errors"`
	Helpers struct {
		HighestOrderInr int64      `json:"highestOrderInr"`
		AdvanceFor      [][2]int64 `json:"advanceFor"`
		AllSlots        []struct {
			ID     string `json:"id"`
			Mode   string `json:"mode"`
			Cutoff struct {
				DaysBefore int64  `json:"daysBefore"`
				Time       string `json:"time"`
			} `json:"cutoff"`
		} `json:"allSlots"`
		SlotOf []struct {
			ID   string `json:"id"`
			Slot string `json:"slot"`
			Mode string `json:"mode"`
			None bool   `json:"none"`
		} `json:"slotOf"`
		ItemOf []struct {
			ID    string `json:"id"`
			Found bool   `json:"found"`
		} `json:"itemOf"`
		ItemName     [][]string      `json:"itemName"`
		Capabilities json.RawMessage `json:"capabilities"`
	} `json:"helpers"`
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

// readGz is a generated vector file, unzipped.
func readGz(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	return io.ReadAll(z)
}

func TestSettingsVectors(t *testing.T) {
	b, err := readGz("testdata/settings-vectors.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []settingsCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	var accepted, refused int
	for _, c := range f.Cases {
		s, tree, errs := CheckSettingsFile(c.Input)
		if !c.OK {
			refused++
			if s != nil || !reflect.DeepEqual(errs, c.Errors) {
				t.Errorf("%s: problems\n got %s\nwant %s", c.Name, strings.Join(errs, "\n     "), strings.Join(c.Errors, "\n     "))
			}
			continue
		}
		accepted++
		if len(errs) > 0 {
			t.Errorf("%s: refused: %q", c.Name, errs)
			continue
		}
		raw, _ := json.Marshal(tree)
		var got any
		_ = json.Unmarshal(raw, &got)
		if !reflect.DeepEqual(got, c.Tree) {
			t.Errorf("%s: tree\n got %s\nwant %s", c.Name, raw, mustJSON(c.Tree))
		}
		if d := ordersreport.PolicyDigest(tree); d != c.Digest {
			t.Errorf("%s: policy digest %s, want %s", c.Name, d, c.Digest)
		}
		h := c.Helpers
		if s.HighestOrderInr() != h.HighestOrderInr {
			t.Errorf("%s: highestOrderInr %d, want %d", c.Name, s.HighestOrderInr(), h.HighestOrderInr)
		}
		for _, p := range h.AdvanceFor {
			if got := s.AdvanceFor(p[0]); got != p[1] {
				t.Errorf("%s: advanceFor(%d) = %d, want %d", c.Name, p[0], got, p[1])
			}
		}
		all := s.AllSlots()
		if len(all) != len(h.AllSlots) {
			t.Errorf("%s: %d slots, want %d", c.Name, len(all), len(h.AllSlots))
		} else {
			for i, w := range h.AllSlots {
				cut := s.CutoffOf(all[i].Slot)
				if all[i].Slot.ID != w.ID || all[i].Mode != w.Mode || cut.DaysBefore != w.Cutoff.DaysBefore || cut.Time != w.Cutoff.Time {
					t.Errorf("%s: slot %d is %s %s %+v, want %+v", c.Name, i, all[i].Slot.ID, all[i].Mode, cut, w)
				}
			}
		}
		for _, w := range h.SlotOf {
			got, ok := s.SlotOf(w.ID)
			if ok == w.None || (ok && (got.Slot.ID != w.Slot || got.Mode != w.Mode)) {
				t.Errorf("%s: slotOf(%q) = %v %v, want %+v", c.Name, w.ID, got, ok, w)
			}
		}
		for _, w := range h.ItemOf {
			if (s.ItemOf(w.ID) != nil) != w.Found {
				t.Errorf("%s: itemOf(%q) found %v", c.Name, w.ID, !w.Found)
			}
		}
		for i, names := range h.ItemName {
			for j, l := range runtime.LANGUAGES {
				if got := ItemName(&s.Menu[i], l); got != names[j] {
					t.Errorf("%s: itemName(%s, %s) = %q, want %q", c.Name, s.Menu[i].ID, l, got, names[j])
				}
			}
		}
		var caps map[string]bool
		_ = json.Unmarshal(h.Capabilities, &caps)
		g := s.Capabilities()
		gotCaps := map[string]bool{"confirmsAutomatically": g.ConfirmsAutomatically, "refundsAutomatically": g.RefundsAutomatically, "takesPartPayments": g.TakesPartPayments,
			"cancels": g.Cancels, "readsBack": g.ReadsBack, "readsSettlements": g.ReadsSettlements}
		if !reflect.DeepEqual(gotCaps, caps) {
			t.Errorf("%s: capabilities %v, want %v", c.Name, gotCaps, caps)
		}
	}
	if accepted < 40 || refused < 90 {
		t.Errorf("accepted %d, refused %d: the vectors are too few to mean anything", accepted, refused)
	}
	t.Logf("%d settings accepted and %d refused, each equal to the TypeScript", accepted, refused)
}

func TestCheckSettingsFileRefusals(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{`[1]`, "The settings must be an object with the shop's name, menu, slots and so on."},
		{`{"name":`, "The settings file is not valid JSON"},
	} {
		_, _, errs := CheckSettingsFile([]byte(c.in))
		if len(errs) != 1 || !strings.HasPrefix(errs[0], c.want) {
			t.Errorf("%s: got %q", c.in, errs)
		}
	}
	if LowestLinkInr() != 1 || ChatGuestWords("en") != "Chat guest" {
		t.Errorf("the generated constants: %d %q", LowestLinkInr(), ChatGuestWords("en"))
	}
}
