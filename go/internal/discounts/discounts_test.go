package discounts

// The discount authority's boundaries (E1): exactly the cap, exactly the floor, the lower of the percentage and the rupees, the percentage rounded down to a whole rupee,
// a quantity, an item with no floor, and the card's code bound to every field. The settings sentences are held to the TypeScript by the templates' settings vectors
// (go/scripts/gen_bookings_settings.ts, gen_orders_settings.ts); the few here only pin the reader's shape.

import (
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/store"
)

var shop = &Settings{CapPercent: 10, CapInr: 100, Floors: []Floor{{"haircut", 300}, {"thali", 100}}}

func ask(item string, qty, list, offered int64) Ask {
	return Ask{Item: item, Name: item, Qty: qty, ListInr: list, OfferedInr: offered}
}

func TestDecideBoundaries(t *testing.T) {
	cases := []struct {
		name     string
		s        *Settings
		c        Caps
		a        Ask
		kind     string
		discount int64
		alone    int64
	}{
		{"at the list price", shop, shop.CapsOf(), ask("haircut", 1, 400, 400), AtList, 0, 0},
		{"above the list price", shop, shop.CapsOf(), ask("haircut", 1, 400, 450), AtList, 0, 0},
		{"exactly the cap (10% of 400 is 40, below the rupee cap)", shop, shop.CapsOf(), ask("haircut", 1, 400, 360), WithinCap, 40, 40},
		{"one rupee beyond the cap", shop, shop.CapsOf(), ask("haircut", 1, 400, 359), AskOwner, 41, 40},
		{"exactly the floor, beyond the cap: the owner decides", shop, shop.CapsOf(), ask("haircut", 1, 400, 300), AskOwner, 100, 40},
		{"one rupee below the floor", shop, shop.CapsOf(), ask("haircut", 1, 400, 299), BelowFloor, 0, 0},
		{"the rupee cap is lower than the percentage (10% of 2,000 is 200, the cap is 100)", &Settings{10, 100, []Floor{{"haircut", 1500}}}, Caps{10, 100}, ask("haircut", 1, 2000, 1900), WithinCap, 100, 100},
		{"the rupee cap is lower: one rupee more asks", &Settings{10, 100, []Floor{{"haircut", 1500}}}, Caps{10, 100}, ask("haircut", 1, 2000, 1899), AskOwner, 101, 100},
		{"the percentage rounded down (10% of 455 is 45.5: 45 alone)", &Settings{10, 100, []Floor{{"haircut", 300}}}, Caps{10, 100}, ask("haircut", 1, 455, 410), WithinCap, 45, 45},
		{"the percentage rounded down: 46 asks", &Settings{10, 100, []Floor{{"haircut", 300}}}, Caps{10, 100}, ask("haircut", 1, 455, 409), AskOwner, 46, 45},
		{"a quantity: the cap is on the line (3 × 120 = 360, 10% is 36), 3 × 12 off is exactly it", shop, shop.CapsOf(), ask("thali", 3, 120, 108), WithinCap, 36, 36},
		{"a quantity: 3 × 13 off is beyond it", shop, shop.CapsOf(), ask("thali", 3, 120, 107), AskOwner, 39, 36},
		{"the floor is per unit, whatever the quantity", shop, shop.CapsOf(), ask("thali", 5, 120, 99), BelowFloor, 0, 0},
		{"an item with no floor keeps its list price as its floor", shop, shop.CapsOf(), ask("shave", 1, 200, 199), NoFloor, 0, 0},
		{"a cap of 0 asks the owner about every discount", shop, Caps{0, 100}, ask("haircut", 1, 400, 399), AskOwner, 1, 0},
		{"the cap in force (tightened by the owner) wins over the file's", shop, Caps{5, 100}, ask("haircut", 1, 400, 360), AskOwner, 40, 20},
	}
	for _, c := range cases {
		o := Decide(c.s, c.c, c.a)
		if o.Kind != c.kind || o.DiscountInr != c.discount || o.MaxAloneInr != c.alone {
			t.Errorf("%s: got %s, %d off, %d alone; want %s, %d, %d (%s)", c.name, o.Kind, o.DiscountInr, o.MaxAloneInr, c.kind, c.discount, c.alone, o.Reason)
		}
		want := map[string]string{AtList: "allow", WithinCap: "allow", AskOwner: "hold_for_owner", BelowFloor: "block", NoFloor: "block"}[c.kind]
		if o.Verdict != want || o.RuleID != RuleID || o.Reason == "" {
			t.Errorf("%s: verdict %q rule %q reason %q", c.name, o.Verdict, o.RuleID, o.Reason)
		}
	}
}

func TestReasonsNameTheAmounts(t *testing.T) {
	o := Decide(shop, shop.CapsOf(), ask("haircut", 1, 1200, 1150))
	if o.Reason != "₹1,150 for haircut is ₹50 off the list price of ₹1,200, within the ₹100 the agent may take off alone." {
		t.Errorf("reason: %s", o.Reason)
	}
	o = Decide(shop, shop.CapsOf(), ask("thali", 2, 120, 100))
	if !strings.Contains(o.Reason, "₹100 for thali each, 2 of them, is ₹40 off the list price of ₹120") {
		t.Errorf("reason: %s", o.Reason)
	}
}

func TestCardCodeIsBoundToEveryField(t *testing.T) {
	a := ask("thali", 3, 120, 100)
	o := Decide(shop, shop.CapsOf(), a)
	d := NewDeal("o-1", a, o, 80, 1)
	if d.TotalInr != 80+300 || d.DiscountInr != 60 || len(d.Code) != 6 {
		t.Fatalf("deal %+v", d)
	}
	again := NewDeal("o-1", a, o, 80, 999) // the same ask later: the same card
	if again.Code != d.Code || !Same(&d, &again) {
		t.Errorf("a retry must find the same card: %s %s", d.Code, again.Code)
	}
	for name, change := range map[string]func(*Deal){
		"case":     func(x *Deal) {},
		"item":     func(x *Deal) { x.Item = "curd" },
		"qty":      func(x *Deal) { x.Qty = 4 },
		"list":     func(x *Deal) { x.ListInr = 121 },
		"offered":  func(x *Deal) { x.OfferedInr = 101 },
		"discount": func(x *Deal) { x.DiscountInr = 59 },
		"total":    func(x *Deal) { x.TotalInr = 381 },
	} {
		x := d
		change(&x)
		caseID := "o-1"
		if name == "case" {
			caseID = "o-2"
		}
		if CodeOf(caseID, x) == d.Code {
			t.Errorf("a change of %s must make another code", name)
		}
	}
	for _, r := range d.Code {
		if !strings.ContainsRune(codeAlphabet, r) {
			t.Errorf("code %s has %q", d.Code, r)
		}
	}
}

func TestCount(t *testing.T) {
	d := Deal{Item: "haircut", Qty: 1, ListInr: 400, OfferedInr: 360, DiscountInr: 40, TotalInr: 360, Code: "ABCDEF"}
	e := []store.Entry{
		{Action: Action, Outcome: "confirmed", Refs: Refs(d, "agent")},
		{Action: Action, Outcome: "held_for_owner", Refs: Refs(d, "")},
		{Action: Action, Outcome: "confirmed", Refs: Refs(Deal{DiscountInr: 100}, "owner")},
		{Action: Action, Outcome: "blocked", Refs: Refs(d, "owner")},
		{Action: "refund", Outcome: "confirmed", Refs: map[string]string{"discountInr": "5"}},
	}
	got := Count(e)
	if got == nil || *got != (Counts{Given: Amount{2, 14000}, Asked: 1, Refused: 1}) {
		t.Errorf("count %+v", got)
	}
	if Count(e[4:]) != nil {
		t.Errorf("no discount line: no block")
	}
}

func TestReadShape(t *testing.T) {
	items := []Priced{{"haircut", 400}, {"shave", 200}}
	var errs []string
	add := func(s string) { errs = append(errs, s) }
	if s := Read(nil, false, nil, items, "service", nil, add); s != nil || len(errs) != 0 {
		t.Fatalf("left out: off, no problem")
	}
	s := Read(map[string]any{"capPercent": 10.0, "capInr": 100.0, "floors": map[string]any{"haircut": 300.0}}, true, nil, items, "service", &Least{200, "the deposit"}, add)
	if s == nil || len(errs) != 0 || s.Floors[0] != (Floor{"haircut", 300}) {
		t.Fatalf("a good block: %+v %v", s, errs)
	}
	s = Read(map[string]any{"capPercent": 91.0, "capInr": 100.5, "floors": map[string]any{"haircut": 150.0, "beard": 10.0, "shave": 300.0}, "x": 1.0}, true, nil, items, "service", &Least{200, "the deposit"}, add)
	if s != nil || len(errs) != 6 {
		t.Fatalf("every problem: %v", errs)
	}
}

// CapPrice (E1 item 3, "any discount?"): the lowest price the agent gives alone, which Decide always finds within the cap, never below the floor, and the list price when nothing
// may be given alone.
func TestCapPrice(t *testing.T) {
	s := &Settings{CapPercent: 10, CapInr: 100, Floors: []Floor{{"haircut", 300}, {"thali", 100}, {"tea", 20}}}
	c := s.CapsOf()
	check := func(item string, list, qty, want int64, ok bool) {
		t.Helper()
		got, gotOK := CapPrice(s, c, item, list, qty)
		if got != want || gotOK != ok {
			t.Errorf("CapPrice(%s, %d, ×%d) = %d %v, want %d %v", item, list, qty, got, gotOK, want, ok)
		}
		if gotOK {
			if o := Decide(s, c, Ask{Item: item, Name: item, Qty: qty, ListInr: list, OfferedInr: got}); o.Kind != WithinCap {
				t.Errorf("Decide(%s at %d ×%d) = %s, want within the cap", item, got, qty, o.Kind)
			}
		}
	}
	check("haircut", 450, 1, 405, true)  // 10% of ₹450 is ₹45, below the ₹100 cap
	check("haircut", 2000, 1, 1900, true) // 10% is ₹200: the ₹100 cap is lower
	check("thali", 120, 2, 108, true)    // 10% of the line (₹240) is ₹24: ₹12 off each
	check("thali", 120, 9, 109, true)    // 10% of ₹1,080 is ₹108, ₹100 cap: ₹100 / 9 = ₹11 off each (₹99 in all), never past the cap
	check("thali", 105, 1, 100, true)    // 10% of ₹105 rounds down to ₹10: ₹95 is below the floor, so the floor
	check("tea", 20, 1, 20, false)       // the floor is the list price: nothing alone
	check("dosa", 60, 1, 60, false)      // no floor: the list price
	if p, ok := CapPrice(s, Caps{0, 100}, "haircut", 450, 1); p != 450 || ok {
		t.Errorf("a cap of 0%%: the list price, got %d %v", p, ok)
	}
}
