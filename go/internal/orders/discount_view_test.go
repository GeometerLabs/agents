package orders

// E1 item 4 (24 Nov 2026): the order's page shows a line at the price the deal gave it, so the lines always add up to the order's total (the amount the payment link is made
// from). Only a live deal (agreed by the agent, approved by the owner) changes a line; a card still waiting, or no deal, leaves every line at the menu price.

import (
	"encoding/json"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/discounts"
)

func TestOrderViewLinesFollowTheDeal(t *testing.T) {
	s := settingsOfCase(t, loadStoreCases(t)[0])
	if len(s.Menu) < 2 {
		t.Fatalf("the case's menu needs two items")
	}
	a, b := s.Menu[0], s.Menu[1]
	view := func(state string) (lines []struct{ Qty, PriceInr, ListInr int64 }, total int64) {
		st := NewStore()
		o := st.Register(NewDraft("web:abc", "en"))
		o.Handle = "h1"
		AddLine(&o.Lines, a.ID, 3)
		AddLine(&o.Lines, b.ID, 1)
		ask := discounts.Ask{Item: a.ID, Qty: 3, ListInr: a.PriceInr, OfferedInr: a.PriceInr - 7}
		d := discounts.NewDeal(o.ID, ask, discounts.Outcome{DiscountInr: 21, LineAgreedInr: ask.OfferedInr * 3}, b.PriceInr, 0)
		d.State = state
		o.setDeal(&d)
		tot := b.PriceInr + 3*a.PriceInr
		if d.Live() {
			tot = d.TotalInr // proceed takes the order's total from the deal
		}
		o.TotalInr = &tot
		id := o.ID
		st.Requests().Set("h1", &ChannelRequest{Channel: "web", Booking: &id})
		raw := s.OrderView(st, "h1")
		var v struct {
			Lines    []struct{ Qty, PriceInr, ListInr int64 }
			TotalInr int64
		}
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("view: %v: %s", err, raw)
		}
		return v.Lines, v.TotalInr
	}
	for _, state := range []string{discounts.Agreed, discounts.Approved} {
		lines, total := view(state)
		sum := int64(0)
		for _, l := range lines {
			sum += l.Qty * l.PriceInr
		}
		if sum != total {
			t.Errorf("%s: the lines add up to %d, the total is %d", state, sum, total)
		}
		if lines[0].PriceInr != a.PriceInr-7 || lines[0].ListInr != a.PriceInr || lines[1].PriceInr != b.PriceInr || lines[1].ListInr != 0 {
			t.Errorf("%s: lines %+v", state, lines)
		}
	}
	lines, total := view(discounts.Asked)
	if lines[0].PriceInr != a.PriceInr || lines[0].ListInr != 0 || total != b.PriceInr+3*a.PriceInr {
		t.Errorf("a card still waiting changes no line: %+v, total %d", lines, total)
	}
}
