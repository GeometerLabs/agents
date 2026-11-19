package render

import "testing"

// TestInr: owner-money-render.ts inr's cases (moved here with the function from the old locale package).
func TestInr(t *testing.T) {
	for p, want := range map[int64]string{0: "₹0", 99: "₹0.99", 100: "₹1", 45050: "₹450.50", 45005: "₹450.05", 12345600: "₹1,23,456", -50: "₹-0.50", -45000: "₹-450"} {
		if got := inr(p); got != want {
			t.Errorf("inr(%d) = %q, want %q", p, got, want)
		}
	}
}
