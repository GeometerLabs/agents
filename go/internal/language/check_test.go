// The outgoing check's links (check.go CheckText), the Go side of modules/language/test/check-links.test.ts: the record's own link is read whole before the names and references
// are masked, so a reference inside a page link's random handle ("f-5", in any case) does not cut it in two (25 Nov 2026, the Fees hand check's one-in-a-few-hundred hold).
package language

import (
	"strings"
	"testing"
)

func TestCheckTextReadsTheRecordsLinkWhole(t *testing.T) {
	link := "https://rzp.io/l/fee-ab12cd"
	page := "https://pages.example/hand-check/f/Qm9vbGVhbnNhcmVmdW5uF-5yZWFsbHk1"
	f := Facts{Links: []string{link, page}, Literals: []string{"f-5", "Rohan Mehta"}}
	for _, text := range []string{"Rohan Mehta's fee: " + link + " Your page: " + page + ". Receipt f-5", "Your page: " + page} {
		if p := CheckText(text, f); len(p) != 0 {
			t.Errorf("%q: %v", text, p)
		}
	}
	// a link that only starts like the record's is still not the record's
	p := CheckText("Your page: "+page+"9", f)
	if len(p) == 0 || !strings.Contains(strings.Join(p, " "), "not the payment link in the record") {
		t.Errorf("a longer link passed: %v", p)
	}
}
