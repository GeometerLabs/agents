package bookings

// E1, the discount authority (decision 64, 24 Nov 2026) in a Bookings shop: a customer's price below the list, decided by the shared package (internal/discounts), and the owner's
// answer to the card. Only a shop whose settings have a "discounts" block comes here; without one, onBook keeps `price-at-or-above-list` exactly as before.
//
// What the authority changes in a booking is its PRICE, kept on the booking as its `discount` member (discounts.Deal): the quote says the agreed price, and the record says
// who agreed (the agent within the cap, or the owner). The deposit link does not change: Guard holds it to exactly the deposit (guard-limits.ts `deposit-amount`), and a floor is
// never below the deposit (the settings check), so the deposit is always part of the agreed price. Refunds stay bound to what was paid.
//
// The owner's card is bound to the exact ask: it is answered "approve b-3 K7M2QX", the booking AND the card's code, and the code is a digest of the service, the price asked and
// the list price on that booking (discounts.CodeOf). A changed ask makes another code, so a yes to an old card names a code nothing waits for and is refused; the same ask again
// finds the card it already made and sends no second one.

import (
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/discounts"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// discountCommand is the owner's answer to a price card: "approve b-3 K7M2QX" or "deny b-3 K7M2QX" (`\s` is JavaScript's; the code is the approvals alphabet, any case).
var discountCommand = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(approve|deny)[` + language.JSSpace + `]+(b-[0-9]+)[` + language.JSSpace + `]+([A-HJKMNP-Za-hjkmnp-z2-9]{6})[` + language.JSSpace + `]*$`)

// The limit card's ids for the cap (chat-limits.ts): declared only for a shop with a "discounts" block (agent_discounts_limits.go).
const (
	discountCapPercent = "discount_cap_percent"
	discountCapInr     = "discount_cap_inr"
)

// deal is the booking's `discount` member, or nil.
func (b *Booking) deal() *discounts.Deal {
	var d discounts.Deal
	if b == nil || !b.extra("discount", &d) {
		return nil
	}
	return &d
}

// setDeal writes the booking's `discount` member (nil removes it).
func (b *Booking) setDeal(d *discounts.Deal) {
	if d == nil {
		b.delExtra("discount")
		return
	}
	b.setExtra("discount", d)
}

// discountCaps is the cap IN FORCE: the settings' own, or a tighter one the owner tapped from the limit card that the file does not carry yet.
func (a *Agent) discountCaps() discounts.Caps {
	c := a.settings.Discounts.CapsOf()
	if v, ok := a.c.InForce(discountCapPercent); ok {
		c.Percent = v
	}
	if v, ok := a.c.InForce(discountCapInr); ok {
		c.Inr = v
	}
	return c
}

// priceSaid: the words before the quote already said the price (the list price refused, or a discount agreed, approved or refused), so the quote does not repeat it.
func priceSaid(prefix []string) bool {
	for _, p := range prefix {
		if p == "price_floor" || strings.HasPrefix(p, "discount_") {
			return true
		}
	}
	return false
}

func asDecision(o discounts.Outcome) Decision {
	return Decision{RuleID: o.RuleID, Verdict: o.Verdict, Reason: o.Reason}
}

// decideOffer is the discount authority over a customer's price below the list for a service. It returns the words to say before the next step and the decisions shown; stop
// is true when the customer has been answered and the flow waits for the owner (the card went now, or it was already out for this very ask).
func (a *Agent) decideOffer(b *Booking, sv *Service, offered int64) (prefix []string, shown []Decision, stop bool) {
	ask := discounts.Ask{Item: sv.ID, Name: ServiceName(sv, "en"), Qty: 1, ListInr: sv.PriceInr, OfferedInr: offered}
	out := discounts.Decide(a.settings.Discounts, a.discountCaps(), ask)
	switch out.Kind {
	case discounts.NoFloor:
		// a service the owner set no floor for: exactly the old rule and the old words
		return []string{"price_floor"}, []Decision{CheckPriceAtOrAboveList(ServiceName(sv, "en"), sv.PriceInr, offered)}, false
	case discounts.BelowFloor:
		d := asDecision(out)
		deal := discounts.NewDeal(b.ID, ask, out, 0, a.now())
		b.setDeal(nil) // whatever was agreed before is not this ask
		a.log(b, b.Customer, discounts.Action, "blocked", map[string]any{"offeredInr": offered}, logMore{decisions: []Decision{d}, refs: discounts.Refs(deal, "rule"),
			notes: "below the lowest price the owner set: refused, and the customer is told the list price"})
		return []string{"price_floor"}, []Decision{d}, false
	}
	d := asDecision(out)
	deal := discounts.NewDeal(b.ID, ask, out, 0, a.now())
	if old := b.deal(); discounts.Same(old, &deal) {
		// the same ask again: no second card and no second record line
		switch old.State {
		case discounts.Asked:
			a.tellCustomer(b, b.Customer, []string{"discount_asked"}, sayOpts{})
			return nil, nil, true
		case discounts.Refused:
			return []string{"discount_refused"}, nil, false
		}
		return nil, nil, false // agreed or approved: it stands
	}
	if out.Kind == discounts.WithinCap {
		deal.State, deal.By = discounts.Agreed, "agent"
		b.setDeal(&deal)
		a.log(b, b.Customer, discounts.Action, "confirmed", map[string]any{"offeredInr": offered}, logMore{decisions: []Decision{d}, refs: discounts.Refs(deal, "agent"),
			notes: "within the cap the agent may give alone: agreed, and this booking's price is the agreed one"})
		return []string{"discount_agreed"}, []Decision{d}, false
	}
	// beyond the cap, at or above the floor: the owner decides, on a card bound to this exact ask
	deal.State = discounts.Asked
	b.setDeal(&deal)
	a.log(b, b.Customer, discounts.Action, "held_for_owner", map[string]any{"offeredInr": offered}, logMore{decisions: []Decision{d}, refs: discounts.Refs(deal, ""),
		notes: "beyond the cap the agent may give alone: the owner is asked with a card bound to this service and price; nothing is held until they answer"})
	a.tellOwner(b, b.Customer, "owner_discount_ask", sayOpts{shown: []Decision{d}})
	a.tellCustomer(b, b.Customer, []string{"discount_asked"}, sayOpts{shown: []Decision{d}})
	return nil, nil, true
}

// offerCap answers "any discount?" with no price named (E1 item 3): the agent offers the lowest price it may give ALONE for the service in the conversation (discounts.CapPrice:
// the lower of the two caps in force, never below the floor), which then goes through decideOffer like a named price, so it is decided, recorded once and bound like one. No
// service known yet: the customer is asked which one (stop). A price already agreed or approved that is as low or lower stands and is said again (a card that waits never comes
// here: onBook answers it first). When nothing may be given alone (no floor, a cap of 0), the list price is stated once, as for a price below it.
func (a *Agent) offerCap(b *Booking, sv *Service) (prefix []string, shown []Decision, stop bool) {
	if sv == nil {
		a.tellCustomer(b, b.Customer, []string{"discount_which"}, sayOpts{offer: servicesOffer("discount_which")}) // the list of services follows its words
		return nil, nil, true
	}
	price, ok := discounts.CapPrice(a.settings.Discounts, a.discountCaps(), sv.ID, sv.PriceInr, 1)
	if d := b.deal(); d.Live() && d.Item == sv.ID && (d.OfferedInr <= price || !ok) {
		return []string{"discount_agreed"}, nil, false
	}
	if !ok {
		return []string{"price_floor"}, nil, false
	}
	return a.decideOffer(b, sv, price)
}

// dealStands checks a booking's deal against what the booking is now: a deal for another service, or one whose list price changed, no longer applies and is dropped (a card
// that waited for it is void). True when an asked card still waits for the owner (the flow does not go on).
func (a *Agent) dealStands(b *Booking) (waiting bool) {
	d := b.deal()
	if d == nil {
		return false
	}
	sv := a.settings.ServiceByID(b.ServiceID)
	if sv == nil || sv.ID != d.Item || sv.PriceInr != d.ListInr || a.settings.Discounts == nil {
		b.setDeal(nil)
		return false
	}
	return d.State == discounts.Asked
}

// agreedPriceInr is the booking's price: the agreed one when a deal stands (agreed by the agent or approved by the owner), else the list price. ok is false for no service.
func (a *Agent) agreedPriceInr(b *Booking) (int64, bool) {
	sv := a.settings.ServiceByID(b.ServiceID)
	if sv == nil {
		return 0, false
	}
	if d := b.deal(); d.Live() && d.Item == sv.ID {
		return d.TotalInr, true
	}
	return sv.PriceInr, true
}

// onDiscountAnswer is the owner's "approve b-3 K7M2QX" or "deny b-3 K7M2QX". It acts only when that booking's card waits with exactly that code and the booking still asks for
// that service at that list price; anything else (an old card after a change, an answer already given, a booking gone) changes nothing and the owner is told so.
func (a *Agent) onDiscountAnswer(command, ref, code string) error {
	b := a.store.Booking(strings.ToLower(ref))
	said := map[string]string{"command": command, "kind": "discount"}
	a.log(b, a.owner(), "owner_decision", "attempted", map[string]any{"command": command, "ref": ref}, logMore{refs: said})
	var d *discounts.Deal
	if b != nil && (b.State == Enquiry || b.State == ConfirmingDetails) {
		a.dealStands(b) // a deal for another service or list price is dropped here, so its card is void
		d = b.deal()
	}
	if d == nil || d.State != discounts.Asked || !strings.EqualFold(d.Code, code) || discounts.CodeOf(b.ID, *d) != d.Code {
		a.log(b, a.owner(), "owner_decision", "blocked", map[string]any{"command": command}, logMore{refs: said,
			notes: "the price card this answer names is not the one waiting (the ask changed, it was already answered, or the booking moved on): nothing was done"})
		a.sayOwner([]string{"owner_discount_stale"}, sayExtra{}, "")
		return nil
	}
	sv := a.settings.ServiceByID(b.ServiceID)
	if command == "approve" {
		d.State, d.By = discounts.Approved, "owner"
		b.setDeal(d)
		a.log(b, b.Customer, discounts.Action, "confirmed", map[string]any{"offeredInr": d.OfferedInr}, logMore{refs: discounts.Refs(*d, "owner"),
			notes: "the owner approved exactly this price on the card: this booking's price is the agreed one"})
		a.log(b, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said, notes: "the owner agreed to the price on the card"})
		return a.afterPrice(b, sv, []string{"discount_approved"}, nil)
	}
	d.State, d.By = discounts.Refused, "owner"
	b.setDeal(d)
	a.log(b, b.Customer, discounts.Action, "blocked", map[string]any{"offeredInr": d.OfferedInr}, logMore{refs: discounts.Refs(*d, "owner"),
		notes: "the owner said no to the price on the card: the customer is offered the list price"})
	a.log(b, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said, notes: "the owner refused the price on the card"})
	return a.afterPrice(b, sv, []string{"discount_refused"}, nil)
}

// askedDeal is the booking a plain "approve b-3" names when a price card waits on it (the answer needs the card's code), or nil.
func askedDeal(b *Booking) *discounts.Deal {
	if d := b.deal(); d != nil && d.State == discounts.Asked && (b.State == Enquiry || b.State == ConfirmingDetails) {
		return d
	}
	return nil
}
