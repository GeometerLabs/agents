package slots

import "testing"

func TestFill(t *testing.T) {
	if got := Fill("{0} for {1}, {0}", "₹5", "a {1} b"); got != "₹5 for a {1} b, ₹5" {
		t.Fatalf("got %q", got)
	}
	if got := Fill("{2} and {x} and {", "a"); got != "{2} and {x} and {" {
		t.Fatalf("got %q", got)
	}
	c := Count{One: "1 payment", Other: "{0} payments"}
	if c.Fill(1) != "1 payment" || c.Fill(0) != "0 payments" || c.Fill(12) != "12 payments" {
		t.Fatal("count")
	}
}
