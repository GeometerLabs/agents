package fees

// Tests of what report.go gives the Fees monthly report: the centre's validated settings as the tree the report digests (ReportTree), and the fees as the name-free list it reads
// (DuesOf). The expected digests are the TypeScript's: go/scripts/gen_fees_report_vectors.ts runs validateSettings and policyDigest on the example settings FILES and on files written
// differently (a part-month rule, an unsorted list of reminder days, an earlier unpaid month, another time zone, a name with spaces round it), and the test reads the same TEXT with
// ReadSettings, builds the tree and digests it with feesreport.PolicyDigest. A tree that is not what validateSettings returns would give another digest and a go-live certificate of the
// same settings would then be read as "different" instead of "own".

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/feesreport"
)

type policyVectors struct {
	Policies struct {
		Rows []struct {
			Name   string `json:"name"`
			Text   string `json:"text"`
			Digest string `json:"digest"`
		} `json:"rows"`
	} `json:"policies"`
}

func TestReportTreeDigestsLikeTheTypeScript(t *testing.T) {
	packed, err := os.ReadFile("../feesreport/testdata/vectors.json.gz")
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
	var v policyVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Policies.Rows) < 7 {
		t.Fatalf("only %d settings files", len(v.Policies.Rows))
	}
	for _, r := range v.Policies.Rows {
		var in map[string]any
		if err := json.Unmarshal([]byte(r.Text), &in); err != nil {
			t.Fatal(err)
		}
		s, errs := ReadSettings(in, []byte(r.Text))
		if len(errs) > 0 {
			t.Fatalf("%s: %v", r.Name, errs)
		}
		tree := s.ReportTree()
		if got := feesreport.PolicyDigest(tree); got != r.Digest {
			t.Errorf("%s: the policy digest of the settings tree is %s, the TypeScript's is %s", r.Name, got, r.Digest)
		}
		// no student's name is in the tree the report is given: each student is an empty object
		students, _ := tree["students"].([]any)
		if len(students) != len(s.Students) {
			t.Errorf("%s: %d students in the tree, want %d", r.Name, len(students), len(s.Students))
		}
		text, _ := json.Marshal(students)
		for _, st := range s.Students {
			if strings.Contains(string(text), st.Name) || strings.Contains(string(text), st.Parent) {
				t.Errorf("%s: the tree holds a student's name or number (%s)", r.Name, st.Name)
			}
		}
	}
}

func TestDuesOfCarriesNoStudent(t *testing.T) {
	st := &Store{Dues: []*Due{{ID: "f-1", StudentName: "Rohan Mehta", Customer: "+919844444444", BatchID: "class-10", Month: "2026-11", State: Open, FeeInr: 1500, LateFeeInr: 100, WaivedInr: 200,
		Payments: []CountedPayment{{AmountPaise: 50000}}}}}
	got := DuesOf(st)
	if len(got) != 1 || got[0].Month != "2026-11" || got[0].State != Open || got[0].Payments != 1 || got[0].BalancePaise != (1500+100-200)*100-50000 {
		t.Fatalf("DuesOf: %+v", got)
	}
	if b, _ := json.Marshal(got); strings.Contains(string(b), "Rohan") || strings.Contains(string(b), "919844444444") {
		t.Fatalf("a fee handed to the report names a student: %s", b)
	}
}
