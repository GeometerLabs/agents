// Package discounts is the discount authority (E1, decision 64, 24 Nov 2026), built once for every template that sells at a list price: Bookings' services and Orders'
// items now, the Service desk's estimates and Quotes later. No template keeps a copy of any of this.
//
// The owner sets, per item or service, a FLOOR (the agent never agrees below it) and, for the shop, a CAP the agent may take off alone: a percentage and a rupee amount,
// the lower of the two wins. A customer's ask below the list price is then one of:
//   - within the cap and not below the floor: the agent agrees, and the money follows the agreed total;
//   - beyond the cap but not below the floor: the owner is asked with a card bound to the exact item, quantity and total (Card, Code);
//   - below the floor: refused, as before.
//
// OFF BY DEFAULT: a shop with no "discounts" block has no *Settings (nil), Decide is never asked, and the templates' `price-at-or-above-list` rule runs exactly as before.
//
// The settings sentences are modules/limits/discounts.ts readDiscounts' own, in its order (the panel and the deployer validate with the TypeScript; the vectors made by
// go/scripts/gen_bookings_settings.ts and gen_orders_settings.ts hold the two equal). An object's keys are read in the order the file wrote them, as the templates' readers do.
//
// Money is whole rupees, as the price lists are. The percentage cap is the percentage of the line's list total ROUNDED DOWN to a whole rupee (never more than the
// percentage allows): "discount <= list*percent/100" is checked as discount*100 <= list*percent, with no fractions. The rupee cap is for one ask (the whole discount on
// the line, quantity included), not per unit.
package discounts

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// RuleID is the rule every discount decision is recorded under.
const RuleID = "discount-authority"

// Action is the record's action for a discount decision; its refs carry the amounts (the record keeps only a digest of the inputs).
const Action = "discount"

// MaxCapPercent and MaxCapInr are discounts.ts MAX_CAP_PERCENT and MAX_CAP_INR.
const (
	MaxCapPercent = 90
	MaxCapInr     = 100_000
)

// Floor is one item's lowest price, in the file's order.
type Floor struct {
	ID  string
	Inr int64
}

// Settings is discounts.ts DiscountSettings.
type Settings struct {
	CapPercent, CapInr int64
	Floors             []Floor
}

// FloorOf is the floor the owner set for an item or service; false: none (its list price is its floor, no discount).
func (s *Settings) FloorOf(id string) (int64, bool) {
	if s == nil {
		return 0, false
	}
	for _, f := range s.Floors {
		if f.ID == id {
			return f.Inr, true
		}
	}
	return 0, false
}

// Tree is the block as validateSettings hands it back (numbers as float64, as JSON.parse reads them; floors in the file's order is not kept by a Go map, which the policy
// digest does not need: it is canonical JSON, keys sorted).
func (s *Settings) Tree() map[string]any {
	floors := map[string]any{}
	for _, f := range s.Floors {
		floors[f.ID] = float64(f.Inr)
	}
	return map[string]any{"capPercent": float64(s.CapPercent), "capInr": float64(s.CapInr), "floors": floors}
}

// Priced is discounts.ts Priced: an item or service and its list price.
type Priced struct {
	ID       string
	PriceInr int64
}

// Least is a lower bound every floor must respect, with its name (Bookings: the deposit).
type Least struct {
	Inr  int64
	Name string
}

func whole(v any) (int64, bool) {
	n, ok := v.(float64)
	if !ok || n != math.Trunc(n) || math.IsInf(n, 0) || math.Abs(n) > 9007199254740991 {
		return 0, false
	}
	return int64(n), true
}

// Read is discounts.ts readDiscounts. v is the "discounts" member as decoded (given: it was in the file), keys gives an object's keys in the file's order by its path
// ("/discounts", "/discounts/floors"; nil: sorted), add takes each problem. Nil when the block is left out or has a problem.
func Read(v any, given bool, keys func(path string) []string, items []Priced, what string, least *Least, add func(string)) *Settings {
	if !given {
		return nil
	}
	exampleID, examplePrice := what, int64(100)
	if len(items) > 0 {
		exampleID, examplePrice = items[0].ID, items[0].PriceInr
	}
	m, ok := v.(map[string]any)
	if !ok {
		add(fmt.Sprintf(`"discounts" must be an object, for example {"capPercent": 10, "capInr": 100, "floors": {"%s": %d}}. Leave it out to refuse every discount.`, exampleID, examplePrice))
		return nil
	}
	problems := 0
	say := func(s string) { problems++; add(s) }
	for _, k := range keysIn(m, keys, "/discounts") {
		if k != "capPercent" && k != "capInr" && k != "floors" {
			say(fmt.Sprintf(`I don't know what %q means in the discounts. Allowed: capPercent, capInr, floors.`, k))
		}
	}
	pct, ok := whole(m["capPercent"])
	if !ok || pct < 0 || pct > MaxCapPercent {
		say(fmt.Sprintf(`The most the agent may take off alone, as a percentage ("discounts.capPercent"), must be a whole number from 0 to %d.`, MaxCapPercent))
	}
	capInr, ok := whole(m["capInr"])
	if !ok || capInr < 0 || capInr > MaxCapInr {
		say(fmt.Sprintf(`The most the agent may take off alone, in rupees ("discounts.capInr"), must be a whole number from 0 to %d.`, MaxCapInr))
	}
	s := &Settings{CapPercent: pct, CapInr: capInr}
	fm, ok := m["floors"].(map[string]any)
	if !ok || len(fm) == 0 {
		say(fmt.Sprintf(`"discounts.floors" must name at least one %s and its lowest price in whole rupees, for example {"%s": %d}.`, what, exampleID, examplePrice))
	} else {
		for _, id := range keysIn(fm, keys, "/discounts/floors") {
			var item *Priced
			for i := range items {
				if items[i].ID == id {
					item = &items[i]
					break
				}
			}
			floor, isWhole := whole(fm[id])
			switch {
			case item == nil:
				say(fmt.Sprintf(`"discounts.floors" names %q, which is not one of the %ss.`, id, what))
			case !isWhole || floor < 1:
				say(fmt.Sprintf(`The lowest price for %q ("discounts.floors") must be a whole number of rupees, 1 or more.`, id))
			case floor > item.PriceInr:
				say(fmt.Sprintf(`The lowest price for %q (₹%d) is above its list price (₹%d). It must be at or below the list price.`, id, floor, item.PriceInr))
			case least != nil && floor < least.Inr:
				say(fmt.Sprintf(`The lowest price for %q (₹%d) is below %s (₹%d). Raise it to at least %s.`, id, floor, least.Name, least.Inr, least.Name))
			default:
				s.Floors = append(s.Floors, Floor{id, floor})
			}
		}
	}
	if problems > 0 {
		return nil
	}
	return s
}

// keysIn is Object.keys in the file's order (sorted when the order is not known).
func keysIn(m map[string]any, keys func(string) []string, path string) []string {
	if keys != nil {
		if k := keys(path); k != nil {
			return k
		}
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// ---- the decision --------------------------------------------------------------------------------------------------------------------------------------------------------

// Caps are the cap IN FORCE (the settings' values, or a tighter one the owner tapped from the limit card, before the deployer has written it to the file).
type Caps struct{ Percent, Inr int64 }

// CapsOf are the settings' own caps.
func (s *Settings) CapsOf() Caps { return Caps{s.CapPercent, s.CapInr} }

// Ask is one ask: an item at a price the customer named, for a quantity.
type Ask struct {
	Item       string // the item's or service's id
	Name       string // its name, for the reason (English, as every limit's reason is)
	Qty        int64
	ListInr    int64 // the list price of one
	OfferedInr int64 // the price of one the customer asked for
}

// The kinds of outcome.
const (
	AtList     = "at_list"     // not below the list price: no discount, the list rule allows it
	WithinCap  = "within_cap"  // the agent agrees alone
	AskOwner   = "ask_owner"   // beyond the cap, at or above the floor: the owner decides
	BelowFloor = "below_floor" // refused
	NoFloor    = "no_floor"    // the item has no floor: its list price is its floor, refused as before
)

// Outcome is Decide's answer: the kind, the rule's verdict and reason, the discount on the line (rupees, quantity included) and the most the agent may take off alone.
type Outcome struct {
	Kind          string
	RuleID        string
	Verdict       string // allow, hold_for_owner, block
	Reason        string
	DiscountInr   int64
	MaxAloneInr   int64
	FloorInr      int64
	LineListInr   int64 // list price × quantity
	LineAgreedInr int64 // offered price × quantity
}

// inr is format.ts formatInr over whole rupees ("₹1,200", en-IN grouping), the words every limit's reason writes.
func inr(n int64) string { return language.FormatInrWhole(n) }

// MaxAlone is the most the agent may take off a line alone: the percentage of the line's list total rounded down to a whole rupee, or the rupee cap, whichever is lower.
func MaxAlone(c Caps, lineListInr int64) int64 {
	return min(lineListInr*c.Percent/100, c.Inr)
}

// CapPrice is the price of one the agent offers ALONE when the customer asks for a discount without naming a price (E1 item 3, "any discount?"): the list price less the most the
// cap in force allows on the line, spread over the quantity and rounded down so the line's discount never passes the cap (qty × off ≤ MaxAlone), and never below the floor. The
// caller hands that price to Decide like any price asked, so it is decided, recorded and bound to the money exactly as a named one (Decide finds it within the cap). ok false: the
// agent may give nothing alone (no floor for the item, a cap of 0, or a floor at the list price), and the list price stands. qty below 1 counts as 1.
func CapPrice(s *Settings, c Caps, item string, listInr, qty int64) (int64, bool) {
	floor, ok := s.FloorOf(item)
	if !ok {
		return listInr, false
	}
	qty = max(qty, 1)
	price := max(listInr-MaxAlone(c, listInr*qty)/qty, floor)
	if price >= listInr {
		return listInr, false
	}
	return price, true
}

// Decide is the discount authority's decision on one ask. s nil (the shop has no "discounts" block) is never asked: the caller keeps its list rule. qty below 1 counts as 1.
func Decide(s *Settings, c Caps, a Ask) Outcome {
	qty := max(a.Qty, 1)
	lineList, lineAgreed := a.ListInr*qty, a.OfferedInr*qty
	out := Outcome{RuleID: RuleID, LineListInr: lineList, LineAgreedInr: lineAgreed}
	if a.OfferedInr >= a.ListInr {
		out.Kind, out.Verdict = AtList, "allow"
		out.Reason = fmt.Sprintf("%s is at or above the list price of %s for %s.", inr(a.OfferedInr), inr(a.ListInr), a.Name)
		out.LineAgreedInr = lineList
		return out
	}
	floor, ok := s.FloorOf(a.Item)
	if !ok {
		out.Kind, out.Verdict, out.FloorInr = NoFloor, "block", a.ListInr
		out.Reason = fmt.Sprintf("%s is below the price list: %s is %s, and the owner set no lower price for it. The agent never quotes or agrees to less.", inr(a.OfferedInr), a.Name, inr(a.ListInr))
		return out
	}
	out.FloorInr = floor
	if a.OfferedInr < floor {
		out.Kind, out.Verdict = BelowFloor, "block"
		out.Reason = fmt.Sprintf("%s is below the lowest price the owner set for %s. The agent never agrees to less.", inr(a.OfferedInr), a.Name)
		return out
	}
	out.DiscountInr = lineList - lineAgreed
	out.MaxAloneInr = MaxAlone(c, lineList)
	each := ""
	if qty > 1 {
		each = fmt.Sprintf(" each, %d of them,", qty)
	}
	if out.DiscountInr <= out.MaxAloneInr {
		out.Kind, out.Verdict = WithinCap, "allow"
		out.Reason = fmt.Sprintf("%s for %s%s is %s off the list price of %s, within the %s the agent may take off alone.", inr(a.OfferedInr), a.Name, each, inr(out.DiscountInr), inr(a.ListInr), inr(out.MaxAloneInr))
		return out
	}
	out.Kind, out.Verdict = AskOwner, "hold_for_owner"
	out.Reason = fmt.Sprintf("%s for %s%s is %s off the list price of %s, more than the %s the agent may take off alone, so the owner decides.", inr(a.OfferedInr), a.Name, each, inr(out.DiscountInr), inr(a.ListInr), inr(out.MaxAloneInr))
	return out
}

// ---- the deal on a case, and the owner's card ---------------------------------------------------------------------------------------------------------------------

// The states of a deal.
const (
	Agreed   = "agreed"   // the agent agreed alone, within the cap
	Asked    = "asked"    // the owner's card waits
	Approved = "approved" // the owner said yes to exactly this
	Refused  = "refused"  // the owner said no to exactly this
)

// Deal is a case's discount, saved on the booking or order as its `discount` member (only when there is one: a shop with the authority off never writes it). It is the
// ACTION RECORD the money is derived from: the payment link and the totals read TotalInr from here, never from the model's words or the customer's message.
type Deal struct {
	State       string `json:"state"`
	Item        string `json:"item"`
	Qty         int64  `json:"qty"`
	ListInr     int64  `json:"listInr"`    // the list price of one
	OfferedInr  int64  `json:"offeredInr"` // the price of one the customer asked for
	DiscountInr int64  `json:"discountInr"`
	TotalInr    int64  `json:"totalInr"` // what the customer pays in all for the case (an order's whole total; a booking's price)
	Code        string `json:"code"`     // the card's code, bound to every field above and the case (CodeOf)
	AtMs        int64  `json:"atMs"`
	By          string `json:"by,omitempty"` // "agent" or "owner", once decided
}

// Live is a deal whose price stands: agreed by the agent or approved by the owner.
func (d *Deal) Live() bool { return d != nil && (d.State == Agreed || d.State == Approved) }

// codeAlphabet is modules/approvals/code.ts's: no 0 O 1 I L, so a code is never read as a reference.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// CodeOf is the card's code: six letters from sha256 over the case and every field the card shows (item, quantity, list price, offered price, discount, total). The same
// ask on the same case has the same code, so a retry finds the card it already made and makes no second one; ANY change (another item, quantity, price or total, or another
// case) is another code, so the owner's yes to an old card names a code nothing waits for, and is refused.
func CodeOf(caseID string, d Deal) string {
	b, _ := json.Marshal([]any{"discount", caseID, d.Item, d.Qty, d.ListInr, d.OfferedInr, d.DiscountInr, d.TotalInr})
	sum := sha256.Sum256(b)
	out := make([]byte, 6)
	for i := range out {
		out[i] = codeAlphabet[int(sum[i])%len(codeAlphabet)]
	}
	return string(out)
}

// NewDeal is the deal an outcome makes on a case: totalOthersInr is what the rest of the case costs at its list prices (an order's other lines; 0 for a booking), so the
// total is the whole case.
func NewDeal(caseID string, a Ask, o Outcome, totalOthersInr, nowMs int64) Deal {
	d := Deal{Item: a.Item, Qty: max(a.Qty, 1), ListInr: a.ListInr, OfferedInr: a.OfferedInr, DiscountInr: o.DiscountInr, TotalInr: totalOthersInr + o.LineAgreedInr, AtMs: nowMs}
	d.Code = CodeOf(caseID, d)
	return d
}

// Same is whether two deals are the same ask (the same code: the same case, item, quantity, prices and total).
func Same(a, b *Deal) bool { return a != nil && b != nil && a.Code == b.Code }

// Refs are the record's refs for a decision on a deal: the rule and every amount, in whole rupees as text (the record keeps refs as text; the report counts from them).
func Refs(d Deal, by string) map[string]string {
	r := map[string]string{
		"rule": RuleID, "item": d.Item, "qty": itoa(d.Qty), "listInr": itoa(d.ListInr), "offeredInr": itoa(d.OfferedInr), "discountInr": itoa(d.DiscountInr),
		"totalInr": itoa(d.TotalInr), "code": d.Code,
	}
	if by != "" {
		r["by"] = by
	}
	return r
}

func itoa(n int64) string { return fmt.Sprintf("%d", n) }

// ---- what the record and the report count ------------------------------------------------------------------------------------------------------------------------------

// Amount is the report's {count, paise}.
type Amount struct{ Count, Paise int64 }

// Counts are the discounts of a period, the monthly report's `discounts` block (discounts.ts discountsOfMonth): given (agreed by the agent or approved by the owner) with the
// rupees taken off, in paise as every report amount is; asked of the owner; and refused (below the floor, or the owner's no).
type Counts struct {
	Given          Amount
	Asked, Refused int64
}

// Count reads the period's record lines: `discount` with outcome confirmed (given), held_for_owner (asked) or blocked (refused). nil when there is none, so a report of a shop
// that never had a discount line keeps its bytes (the block is left out).
func Count(entries []store.Entry) *Counts {
	var c Counts
	seen := false
	for _, e := range entries {
		if e.Action != Action {
			continue
		}
		seen = true
		switch e.Outcome {
		case "confirmed":
			c.Given.Count++
			n, _ := strconv.ParseInt(e.Refs["discountInr"], 10, 64) // Number(x) || 0 of whole rupees as text
			c.Given.Paise += n * 100
		case "held_for_owner":
			c.Asked++
		case "blocked":
			c.Refused++
		}
	}
	if !seen {
		return nil
	}
	return &c
}

// Tree is the block as the report's JSON has it.
func (c *Counts) Tree() map[string]any {
	return map[string]any{"given": map[string]any{"count": c.Given.Count, "paise": c.Given.Paise}, "asked": c.Asked, "refused": c.Refused}
}

// LimitDecls are the caps as limits the owner may change (modules/limits/discounts.ts DISCOUNT_CHAT_LIMITS, the words chat-limit-kinds.ts discountPercent and discountInr):
// tightened by a tap on the assistant's limit card, loosened only behind the passkey page, as every limit. None for a shop without the block, so its limits page is as before.
func LimitDecls(s *Settings) []runtime.LimitDecl {
	if s == nil {
		return nil
	}
	return []runtime.LimitDecl{
		{ID: "discount_cap_percent", Path: "discounts.capPercent", Unit: "count", Tighter: "lower", Kind: "discountPercent", File: s.CapPercent, Min: 0, Max: MaxCapPercent},
		{ID: "discount_cap_inr", Path: "discounts.capInr", Unit: "inr", Tighter: "lower", Kind: "discountInr", File: s.CapInr, Min: 0, Max: MaxCapInr},
	}
}

// TalkFact is the owner's talk's source for "discounts this month" (the assistant's Facts, counts only): read from the record since the first of this month in the shop's
// zone, so the answer rests on what was recorded, never on a model's guess. monthStartIso is that moment as the record writes times (ISO, UTC); a record time sorts as text.
// Only a shop with the authority adds it (the TypeScript demo has none, so the talk-facts vectors are unchanged).
func TalkFact(entries []store.Entry, monthStartIso string) assistant.TalkSource {
	var month []store.Entry
	for _, e := range entries {
		if e.Time >= monthStartIso {
			month = append(month, e)
		}
	}
	c := Count(month)
	if c == nil {
		c = &Counts{}
	}
	rupees := c.Given.Paise / 100
	return assistant.TalkSource{ID: "r:discounts", Kind: "record", AmountsInr: []float64{float64(rupees)},
		Text: fmt.Sprintf("Discounts this month: %d given (%s off in all), %d asked of the owner, %d refused.", c.Given.Count, inr(rupees), c.Asked, c.Refused)}
}
