// The order may not know a price, a plan, a payment, an Operator, a shop's name or when it arrived (modules/discovery/order.ts): the only fields it reads are the six of Candidate, and a
// new one has to be added here on purpose. Two lists of candidates that differ in nothing the order may read give the same order, whatever else they carry.
package directory

import (
	"reflect"
	"testing"
)

func TestOrderFieldsAreTheSix(t *testing.T) {
	var names []string
	typ := reflect.TypeOf(Candidate{})
	for i := 0; i < typ.NumField(); i++ {
		names = append(names, typ.Field(i).Name)
	}
	want := []string{"Key", "Shop", "Fit", "DistanceKm", "SameTown", "InStock"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("the order's input is %v: a field was added or removed; the order may read only %v (modules/discovery/order.ts ORDER_FIELDS)", names, want)
	}
}

func TestOrderTakesTurnsAndCapsTheFirstPage(t *testing.T) {
	var cands []Candidate
	for _, shop := range []string{"a", "b", "c", "d"} {
		for i := 0; i < 5; i++ {
			cands = append(cands, Candidate{Key: shop + "|" + string(rune('0'+i)), Shop: shop, InStock: true})
		}
	}
	got := orderResults(cands, OrderQuery{Place: "none", Seed: "2026-11-19|x|"})
	if len(got) != 20 {
		t.Fatalf("every candidate once, got %d", len(got))
	}
	perShop := map[string]int{}
	for _, k := range got[:10] {
		perShop[k[:1]]++
	}
	for s, n := range perShop {
		if n > 3 {
			t.Errorf("shop %s has %d in the first ten", s, n)
		}
	}
	if got[0][:1] == got[1][:1] {
		t.Errorf("shops take turns, but %v starts with one shop twice", got[:3])
	}
}
