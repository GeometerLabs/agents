package orders

// What is worked out from the orders themselves: the Go twin of the derived reads of templates/commerce/orders/src/order.ts (holdsStock, takenOf, ordersOn, ordersInSlot, fixSlot,
// slotMoments, itemsText, totalOf, countOf, addLine, compactFinishedOrders, orderFacts, countedLeft, factsFor) and the one read of src/plans/ledger.ts a slot's count needs
// (planMealsInSlot, over the store's `plans` block as read).
//
// Stock and the day's order count are NOT counters, in either runtime: they are worked out each time from the orders that hold them (confirmed ones, and ones waiting for their
// advance whose hold has not run out), so an expired hold, a cancellation or a restart can never leave a number that disagrees with the orders. A slot's count adds the plans'
// meals in it, so every check of a slot (the agent's, the page's, the list of open slots) agrees. The shop's stock COUNT (internal/stock, the assistant's state on runtime.Snap)
// is the shelf; countedLeft takes what other orders hold but have not booked off what is left of it.
//
// Proved equal to the TypeScript on stores its agent wrote, at several moments (testdata/store-vectors.json.gz, order_test.go).
//
// Where Go and JavaScript differ: `Math.round` of the minutes left on a hold is floor(x + 0.5) (JavaScript rounds a half up, towards +Infinity, which math.Round does not);
// itemsText and orderWhat name an item missing from the menu by its id (the TypeScript's itemsText would throw on it; orderWhat names it by its id too).

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// ---- the money, whole rupees ----------------------------------------------------------------------------------------------------------------------------------------------

// TotalOf is order.ts totalOf: the lines at the shop's prices (an item not on the menu counts nothing).
func (s *Settings) TotalOf(lines []OrderLine) int64 {
	var n int64
	for _, l := range lines {
		if it := s.ItemOf(l.ItemID); it != nil {
			n += it.PriceInr * l.Qty
		}
	}
	return n
}

// CountOf is order.ts countOf: how many items, counting each one.
func CountOf(lines []OrderLine) int64 {
	var n int64
	for _, l := range lines {
		n += l.Qty
	}
	return n
}

// AddLine is order.ts addLine: a line, or more of the same item.
func AddLine(lines *[]OrderLine, itemID string, qty int64) {
	for i := range *lines {
		if (*lines)[i].ItemID == itemID {
			(*lines)[i].Qty += qty
			return
		}
	}
	*lines = append(*lines, OrderLine{ItemID: itemID, Qty: qty})
}

// ---- stock and the day's count, derived ----------------------------------------------------------------------------------------------------------------------------------

// HoldsStock is order.ts holdsStock: confirmed orders always hold stock and a place in the day's count; one waiting for its advance until its hold runs out.
func HoldsStock(o *Order, nowMs int64) bool {
	return o.State == Confirmed || (o.State == AwaitingAdvance && o.HoldExpiresAt != nil && *o.HoldExpiresAt > nowMs)
}

func sameDay(a *LocalDate, b LocalDate) bool { return a != nil && *a == b }

// TakenOf is order.ts takenOf: how many of an item the other orders that hold stock have taken for a day (exceptID "" leaves none out).
func (st *Store) TakenOf(date LocalDate, itemID string, nowMs int64, exceptID string) int64 {
	var n int64
	for _, o := range st.Orders {
		if o.ID != exceptID && sameDay(o.Date, date) && HoldsStock(o, nowMs) {
			for _, l := range o.Lines {
				if l.ItemID == itemID {
					n += l.Qty
				}
			}
		}
	}
	return n
}

// OrdersOn is order.ts ordersOn: how many orders hold a place in the day's count.
func (st *Store) OrdersOn(date LocalDate, nowMs int64, exceptID string) int {
	n := 0
	for _, o := range st.Orders {
		if o.ID != exceptID && sameDay(o.Date, date) && HoldsStock(o, nowMs) {
			n++
		}
	}
	return n
}

// OrdersInSlot is order.ts ordersInSlot: how many orders hold a place in one slot on one day (a slot's `maxOrders`), and the plans' meals in it.
func (st *Store) OrdersInSlot(date LocalDate, slotID string, nowMs int64, exceptID string) int {
	n := 0
	for _, o := range st.Orders {
		if o.ID != exceptID && o.SlotID == slotID && sameDay(o.Date, date) && HoldsStock(o, nowMs) {
			n++
		}
	}
	return n + st.PlanMealsInSlot(date, slotID, nowMs, "")
}

// ---- the plans' meals in a slot (plans/ledger.ts planMealsInSlot) ----------------------------------------------------------------------------------------------------------

// planRead is the part of a plan (plans/ledger.ts Plan) a slot's count reads.
type planRead struct {
	SlotID  string `json:"slotId"`
	State   string `json:"state"`
	Periods []struct {
		Index       int64             `json:"index"`
		From        string            `json:"from"`
		To          string            `json:"to"`
		State       string            `json:"state"`
		HoldUntilMs *int64            `json:"holdUntilMs"`
		Days        map[string]string `json:"days"`
	} `json:"periods"`
}

// plansRead reads the store's `plans` block for a count; nil: no plans (or a block this version cannot read, which counts no meals).
func (st *Store) plansRead() map[string]*planRead {
	if st.Plans == nil {
		return nil
	}
	var v struct {
		Plans map[string]*planRead `json:"plans"`
	}
	if json.Unmarshal(st.Plans, &v) != nil {
		return nil
	}
	return v.Plans
}

// KeyOf is plans/periods.ts keyOf: "2026-11-16" (the year as written, the month and day in two digits).
func KeyOf(d LocalDate) string {
	pad := func(n int) string {
		if n < 10 {
			return "0" + strconv.Itoa(n)
		}
		return strconv.Itoa(n)
	}
	return strconv.Itoa(d.Year) + "-" + pad(d.Month) + "-" + pad(d.Day)
}

// mealCounts is a plan's meal on a day that holds its place: its period holds places (paid; a renewal asked for; a first period while its hold runs) and the day is due or
// delivered (plans/ledger.ts holdsPlaces, periodOfDay).
func (p *planRead) mealCounts(key string, nowMs int64) bool {
	for _, per := range p.Periods {
		if key >= per.From && key <= per.To { // periodOfDay: the first period that has the day
			holds := per.State == "paid" || (per.State == "awaiting_payment" && (per.Index > 0 || (per.HoldUntilMs != nil && *per.HoldUntilMs > nowMs)))
			d := per.Days[key]
			return holds && (d == "due" || d == "delivered")
		}
	}
	return false
}

// PlanMealsInSlot is plans/ledger.ts planMealsInSlot: the plans' meals for a slot on a date (mealsOn: a lapsed plan makes none), `except` one plan left out.
func (st *Store) PlanMealsInSlot(date LocalDate, slotID string, nowMs int64, except string) int {
	plans := st.plansRead()
	if plans == nil {
		return 0
	}
	key := KeyOf(date)
	n := 0
	for _, p := range plans {
		if p == nil || p.SlotID != slotID || p.State == "lapsed" {
			continue
		}
		if p.mealCounts(key, nowMs) {
			n++
		}
	}
	// the plan being checked, taken off (as the TypeScript does, without asking whether it is lapsed)
	if own := plans[except]; own != nil && own.SlotID == slotID && own.mealCounts(key, nowMs) {
		n--
	}
	return n
}

// ---- the slot, the cut-off and what a message may say ----------------------------------------------------------------------------------------------------------------------

// at is a clock time on a date in the shop's zone, as an instant.
func (s *Settings) at(clock string, d zone.Date) int64 {
	m := ParseClock(clock)
	return zone.ZonedToMs(d, m/60, m%60, s.Timezone)
}

// FixSlot is order.ts fixSlot: the order's way, its slot's window on its date and the moment orders for it close. false (nothing changed) without a date or a slot.
func (s *Settings) FixSlot(o *Order) bool {
	found, ok := s.SlotOf(o.SlotID)
	if !ok || o.Date == nil {
		return false
	}
	cut := s.CutoffOf(found.Slot)
	d := o.Date.Zone()
	start, end, closes := s.at(found.Slot.From, d), s.at(found.Slot.To, d), s.at(cut.Time, zone.AddDays(d, -int(cut.DaysBefore)))
	o.Mode, o.SlotStartMs, o.SlotEndMs, o.CutoffMs = found.Mode, &start, &end, &closes
	return true
}

// SlotMoment is one slot's window on a date (slotMoments).
type SlotMoment struct {
	ID     string `json:"id"`
	FromMs int64  `json:"fromMs"`
	ToMs   int64  `json:"toMs"`
}

// SlotMoments is order.ts slotMoments: the moments of every slot of a way on a date, for a message that offers slots.
func (s *Settings) SlotMoments(mode string, date LocalDate) []SlotMoment {
	out := []SlotMoment{}
	for _, sl := range s.SlotsOf(mode) {
		out = append(out, SlotMoment{ID: sl.ID, FromMs: s.at(sl.From, date.Zone()), ToMs: s.at(sl.To, date.Zone())})
	}
	return out
}

// ItemsText is order.ts itemsText: the order as a line of words, from the record: "2 × Veg thali, 1 × Curd".
func (s *Settings) ItemsText(lines []OrderLine, lang string) string {
	parts := make([]string, len(lines))
	for i, l := range lines {
		name := l.ItemID
		if it := s.ItemOf(l.ItemID); it != nil {
			name = ItemName(it, lang)
		}
		parts[i] = strconv.FormatInt(l.Qty, 10) + " × " + name
	}
	return strings.Join(parts, ", ")
}

// CompactFinishedOrders is order.ts compactFinishedOrders: an order that is over and whose slot ended before beforeMs keeps only its place on the delivery list (`area`); the
// address as the customer wrote it is deleted. How many.
func (st *Store) CompactFinishedOrders(beforeMs int64) int {
	n := 0
	for _, o := range st.Orders {
		if o.Address == "" || o.SlotEndMs == nil || *o.SlotEndMs >= beforeMs {
			continue
		}
		if o.State != Completed && o.State != Cancelled && o.State != Expired {
			continue
		}
		o.Address = ""
		n++
	}
	return n
}

// FactsExtra is factsFor's `extra`: what a message may say beyond the order's own record. A nil pointer is a fact not given.
type FactsExtra struct {
	CustomerPhone *string
	RefundInr     *int64
	Menu, Areas   bool
	SlotChoices   []words.Window // nil: not given (words.MessageFacts leaves an empty list out of its JSON, where the TypeScript writes `[]`; nothing reads the difference)
	UpiCode       string
	MarkedInr     *int64
	LeftInr       *int64
	ItemID        string
	LeftCount     *int64
	NowMs         *int64
	Link          *string
}

// FactsFor is order.ts factsFor: the values of this order's record that a message may use, from the order and the settings, never from message text. o may be nil (a message
// about no order: the menu, a greeting).
func (s *Settings) FactsFor(o *Order, lang string, x FactsExtra) *words.MessageFacts {
	f := &words.MessageFacts{Language: lang, TimeZone: s.Timezone, BusinessName: s.Name, Menu: []words.MenuPrice{}}
	// Only the menu may state every item's price; any other message may state this order's own items and nothing else.
	if x.Menu {
		for i := range s.Menu {
			f.Menu = append(f.Menu, words.MenuPrice{Name: ItemName(&s.Menu[i], lang), PriceInr: s.Menu[i].PriceInr})
		}
	}
	if x.Areas && s.Delivery != nil {
		f.Areas = append([]string{}, s.Delivery.Area...)
	}
	var total, advance *int64
	if o != nil {
		if len(o.Lines) > 0 {
			f.ItemsText = words.S(s.ItemsText(o.Lines, lang))
			for _, l := range o.Lines {
				f.Quantities = append(f.Quantities, l.Qty)
			}
		}
		// a plan's period payment: the plan's name is "the items" (a plan type no longer in the settings is left as it is; the TypeScript would throw on it)
		if o.Plan != nil {
			if t := s.PlanTypeOf(o.Plan.TypeID); t != nil {
				f.ItemsText = words.S(PlanName(t, lang))
			}
		}
		total = o.TotalInr
		if total == nil && len(o.Lines) > 0 {
			total = words.N(s.TotalOf(o.Lines))
		}
		if o.Date != nil {
			f.DateMs = words.N(zone.ZonedToMs(o.Date.Zone(), 0, 0, s.Timezone))
		}
		f.SlotFromMs, f.SlotToMs, f.CutoffMs = o.SlotStartMs, o.SlotEndMs, o.CutoffMs
		if o.Mode != "" {
			f.Mode = words.S(o.Mode)
		}
		if o.Area != "" {
			f.Area = words.S(o.Area)
		}
		if o.Address != "" {
			f.Address = words.S(o.Address)
		}
		if o.ID != "" {
			f.OrderRef = words.S(o.ID)
		}
		advance = o.AdvanceInr
	}
	if advance == nil && total != nil {
		advance = words.N(s.AdvanceFor(*total))
	}
	if x.ItemID != "" {
		if it := s.ItemOf(x.ItemID); it != nil {
			f.ItemName, f.PriceInr = words.S(ItemName(it, lang)), words.N(it.PriceInr)
		}
	}
	f.LeftCount = x.LeftCount
	f.TotalInr, f.AdvanceInr = total, advance
	if total != nil && advance != nil {
		f.BalanceInr = words.N(*total - *advance)
	}
	f.RefundInr = x.RefundInr
	if x.SlotChoices != nil {
		f.SlotChoices = x.SlotChoices
	}
	switch {
	case x.Link != nil:
		f.Link = x.Link
	case o != nil && o.LinkURL != "":
		f.Link = words.S(o.LinkURL)
	}
	f.HoldMinutes = words.N(s.Advance.HoldMinutes)
	if o != nil && o.HoldExpiresAt != nil && o.State == AwaitingAdvance && x.NowMs != nil {
		f.HoldMinutes = words.N(max(1, int64(math.Floor(float64(*o.HoldExpiresAt-*x.NowMs)/60_000+0.5))))
	}
	f.WindowHours, f.MaxItems = words.N(s.Cancellation.WindowHours), words.N(s.Orders.MaxItemsPerOrder)
	switch {
	case x.CustomerPhone != nil:
		f.CustomerPhone = x.CustomerPhone
	case o != nil:
		f.CustomerPhone = words.S(o.Customer)
	}
	if s.Payment.Module == "upi" { // ownerMarkedOf(settings.payment)?.payTo: who the customer pays, when the owner marks payments
		f.UpiID, f.Payee = words.S(s.Payment.UpiID), words.S(s.Payment.Payee)
	}
	if x.UpiCode != "" {
		f.UpiCode = words.S(x.UpiCode)
	}
	f.MarkedInr, f.LeftInr = x.MarkedInr, x.LeftInr
	return f
}
