package stockorders

// A number written against a letter ("9W", "5L", "2kg", "16A") or in a fraction ("1/2 inch") is part of an item's or a unit's name, never a quantity, in every language the
// reader has words for (25 Nov 2026: the starter shop's "LED bulb 9W is low" was read as an order of 9). The TypeScript's own answers for the same phrases are in
// testdata/vectors.json (vectors_test.go); this names the rule.

import "testing"

func TestANumberInANameIsNotAQuantity(t *testing.T) {
	for _, text := range []string{"LED bulb 9W is low", "5L oil is low", "1/2 inch pipe is low", "9W बल्ब खत्म", "9W ബൾബ് തീർന്നു", "9W ಬಲ್ಬ್ ಮುಗಿದಿದೆ", "16A MCB low"} {
		if q := quantityIn(text); q != nil {
			t.Errorf("%q: read as a quantity of %d", text, *q)
		}
	}
	for text, want := range map[string]int64{"order 10 LED bulb 9W": 10, "order 2x towels": 2, "order 3 2kg bags": 3, "10 9W बल्ब मंगाओ": 10, "change po-3 to 12": 12} {
		if q := quantityIn(text); q == nil || *q != want {
			t.Errorf("%q: %v, want %d", text, q, want)
		}
	}
}
