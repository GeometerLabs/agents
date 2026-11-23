package stockorders

// Proves Settings.Tree (settingstree.go) is the value the TypeScript's validateSettings returns, on settings files as owners write them (padded names, repeated languages, the owner's
// language and the follow-up hours left out, every shape of the assistant block): the vectors of the monthly report (made by go/scripts/gen_stockorders_report_vectors.ts) carry each
// file's text, the TypeScript's validated tree and its policy digest. The report digests this tree, so a shop that moves between the two runtimes keeps its digest.

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/stockordersreport"
)

func TestSettingsTreeMatchesValidateSettings(t *testing.T) {
	packed, err := os.ReadFile("../stockordersreport/testdata/vectors.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	zr, err := gzip.NewReader(bytes.NewReader(packed))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Policies struct {
			Trees []struct {
				Text   string         `json:"text"`
				Tree   map[string]any `json:"tree"`
				Digest string         `json:"digest"`
			} `json:"trees"`
		} `json:"policies"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Policies.Trees) < 7 {
		t.Fatalf("only %d settings files in the vectors", len(v.Policies.Trees))
	}
	for i, c := range v.Policies.Trees {
		s, errs := ReadSettings([]byte(c.Text))
		if len(errs) > 0 {
			t.Fatalf("file %d: %v", i, errs)
		}
		// through JSON, as the report's tree is handed on (and as the TypeScript's was written)
		b, _ := json.Marshal(s.Tree())
		var got map[string]any
		_ = json.Unmarshal(b, &got)
		if !reflect.DeepEqual(got, c.Tree) {
			gb, _ := json.Marshal(got)
			wb, _ := json.Marshal(c.Tree)
			t.Errorf("file %d: the tree differs\n got %s\nwant %s", i, gb, wb)
		}
		if d := stockordersreport.PolicyDigest(got); d != c.Digest {
			t.Errorf("file %d: the policy digest of the Go tree is %s, want %s", i, d, c.Digest)
		}
	}
}
