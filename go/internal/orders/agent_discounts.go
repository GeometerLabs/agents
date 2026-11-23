package orders

// E1, the discount authority (decision 64, 24 Nov 2026) in an Orders shop: a customer's price below the menu for an item of the order, decided by the shared package
// (internal/discounts), and the owner's answer to the card. Only a shop whose settings have a "discounts" block comes here; without one, offerPrice keeps
// `price-at-or-above-menu` exactly as before.
//
// The price named is for one of the item (the first item of the order, as offerPrice has always read it), for every one of that item in the order. The discount is on that
// line (quantity included); the order's other lines stay at their menu prices. The order's agreed TOTAL is kept on the order as its `discount` member (discounts.Deal), and
// proceed() takes the total from it, so the advance, the balance, the payment link, the books and the report all follow the agreed total and nothing else: never the model's
// words.
//
// The owner's card is bound to the exact ask: it is answered "approve o-3 K7M2QX", the order AND the card's code, a digest of the item, the quantity, the prices and the
// total on that order (discounts.CodeOf). While it waits the order stays an enquiry and nothing is held; a change to the order (another quantity, say) makes the decision
// again on the new order, with a new card when it is still beyond the cap, and the old card's yes names a code nothing waits for and is refused. The same ask again makes no
// second card.

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/discounts"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
)

// discountCommand is the owner's answer to a price card: "approve o-3 K7M2QX" or "deny o-3 K7M2QX" (`\s` is JavaScript's; the code is the approvals alphabet, any case).
var discountCommand = regexp.MustCompile(`(?i)^` + sp + `*(approve|deny)` + sp + `+(o-[0-9]+)` + sp + `+([A-HJKMNP-Za-hjkmnp-z2-9]{6})` + sp + `*$`)

// The limit card's ids for the cap (declared only for a shop with a "discounts" block, orders.go Limits).
const (
	discountCapPercent = "discount_cap_percent"
	discountCapInr     = "discount_cap_inr"
)

// deal is the order's `discount` member, or nil.
func (o *Order) deal() *discounts.Deal {
	raw := o.ExtraOf("discount")
	if raw == nil {
		return nil
	}
	var d discounts.Deal
	if json.Unmarshal(raw, &d) != nil {
		return nil
	}
	return &d
}

// setDeal writes the order's `discount` member (nil takes it out).
func (o *Order) setDeal(d *discounts.Deal) {
	if d == nil {
		o.SetExtra("discount", nil)
		return
	}
	b, _ := json.Marshal(d)
	o.SetExtra("discount", b)
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

// askOf is the ask for one item at an offered price as the order is NOW: that item's quantity, and what the order's other lines cost at the menu.
func (a *Agent) askOf(o *Order, item *MenuItem, offered int64) (discounts.Ask, int64, bool) {
	var qty, others int64
	for _, l := range o.Lines {
		if l.ItemID == item.ID {
			qty += l.Qty
		} else if it := a.settings.ItemOf(l.ItemID); it != nil {
			others += it.PriceInr * l.Qty
		}
	}
	return discounts.Ask{Item: item.ID, Name: ItemName(item, "en"), Qty: qty, ListInr: item.PriceInr, OfferedInr: offered}, others, qty > 0
}

func asDecision(o discounts.Outcome) Decision {
	return Decision{RuleID: o.RuleID, Verdict: o.Verdict, Reason: o.Reason}
}

// dealFacts lays a deal's facts over a message's (the item, the price asked, the card's code, and the total the card names).
func (a *Agent) dealFacts(d discounts.Deal) func(f *words.MessageFacts) {
	return func(f *words.MessageFacts) {
		if it := a.settings.ItemOf(d.Item); it != nil {
			f.ItemName, f.PriceInr = words.S(ItemName(it, f.Language)), words.N(it.PriceInr)
		}
		f.OfferedInr, f.DiscountCode, f.TotalInr = words.N(d.OfferedInr), words.S(d.Code), words.N(d.TotalInr)
	}
}

// decideOffer is the discount authority over a customer's price below the menu for an item of the order. It adds the words to say before the next step to ctx; stop is true
// when the customer has been answered and the order waits for the owner (the card went now, or it was already out for this very ask).
func (a *Agent) decideOffer(o *Order, item *MenuItem, offered int64, ctx *flowCtx) (stop bool) {
	ask, others, ok := a.askOf(o, item, offered)
	if !ok {
		o.setDeal(nil)
		return false
	}
	out := discounts.Decide(a.settings.Discounts, a.discountCaps(), ask)
	switch out.Kind {
	case discounts.NoFloor:
		// an item the owner set no floor for: exactly the old rule and the old words
		d := checkPriceAtOrAboveMenu(ItemName(item, "en"), item.PriceInr, offered)
		ctx.shown = append(ctx.shown, d)
		ctx.prefix = append(ctx.prefix, "price_floor")
		ctx.itemID = item.ID
		return false
	case discounts.BelowFloor:
		d := asDecision(out)
		deal := discounts.NewDeal(o.ID, ask, out, others, a.now())
		o.setDeal(nil)
		a.log(o, o.Customer, discounts.Action, "blocked", map[string]any{"offeredInr": offered}, logMore{decisions: []Decision{d}, refs: discounts.Refs(deal, "rule"),
			notes: "below the lowest price the owner set: refused, and the customer is told the menu price"})
		ctx.shown = append(ctx.shown, d)
		ctx.prefix = append(ctx.prefix, "price_floor")
		ctx.itemID = item.ID
		return false
	}
	d := asDecision(out)
	deal := discounts.NewDeal(o.ID, ask, out, others, a.now())
	if old := o.deal(); discounts.Same(old, &deal) {
		// the same ask again: no second card and no second record line
		switch old.State {
		case discounts.Asked:
			a.tellCustomer(o, o.Customer, []string{"discount_asked"}, sayOpts{itemID: item.ID, facts: a.dealFacts(*old)})
			return true
		case discounts.Refused:
			ctx.prefix = append(ctx.prefix, "discount_refused")
			ctx.itemID = item.ID
		}
		return false
	}
	if out.Kind == discounts.WithinCap {
		deal.State, deal.By = discounts.Agreed, "agent"
		o.setDeal(&deal)
		a.log(o, o.Customer, discounts.Action, "confirmed", map[string]any{"offeredInr": offered}, logMore{decisions: []Decision{d}, refs: discounts.Refs(deal, "agent"),
			notes: "within the cap the agent may give alone: agreed, and the order's total is the agreed one"})
		ctx.shown = append(ctx.shown, d)
		ctx.prefix = append(ctx.prefix, "discount_agreed")
		ctx.itemID = item.ID
		return false
	}
	// beyond the cap, at or above the floor: the owner decides, on a card bound to this exact ask; the order stays an enquiry and nothing is held
	deal.State = discounts.Asked
	o.setDeal(&deal)
	a.log(o, o.Customer, discounts.Action, "held_for_owner", map[string]any{"offeredInr": offered}, logMore{decisions: []Decision{d}, refs: discounts.Refs(deal, ""),
		notes: "beyond the cap the agent may give alone: the owner is asked with a card bound to this item, quantity and total; nothing is held until they answer"})
	a.tellOwner(o, o.Customer, "owner_discount_ask", sayOpts{shown: []Decision{d}, itemID: item.ID, facts: a.dealFacts(deal)})
	a.tellCustomer(o, o.Customer, cat(ctx.prefix, "discount_asked"), sayOpts{shown: catD(ctx.shown, d), itemID: item.ID, facts: a.dealFacts(deal)})
	return true
}

// offerCap answers "any discount?" with no price named (E1 item 3): the agent offers the lowest price it may give ALONE for the order's item (discounts.CapPrice: the lower of the
// two caps in force, never below the floor), which then goes through decideOffer like a named price, so it is decided, recorded once and the money follows it exactly. No item in
// the order yet: the customer is asked which one (stop). A card waiting for the owner is left as it is (checkDeal says so); a price already agreed or approved that is as low or
// lower stands and is said again. When nothing may be given alone (no floor, a cap of 0), the menu price is stated once, as for a price below it.
func (a *Agent) offerCap(o *Order, ctx *flowCtx) (stop bool) {
	if len(o.Lines) == 0 {
		a.tellCustomer(o, o.Customer, cat(ctx.prefix, "discount_which"), sayOpts{offer: itemsOffer(cat(ctx.prefix, "discount_which")...)}) // the menu follows its words
		return true
	}
	item := a.settings.ItemOf(o.Lines[0].ItemID) // the first item of the order, as a named price is read
	if item == nil {
		return false
	}
	ctx.itemID = item.ID
	d := o.deal()
	if d != nil && d.State == discounts.Asked {
		return false // the owner's card is out: checkDeal (in proceed) tells the customer so, and it is not voided
	}
	ask, _, _ := a.askOf(o, item, item.PriceInr)
	price, ok := discounts.CapPrice(a.settings.Discounts, a.discountCaps(), item.ID, item.PriceInr, ask.Qty)
	if d.Live() && d.Item == item.ID && (d.OfferedInr <= price || !ok) {
		ctx.prefix = append(ctx.prefix, "discount_agreed") // a price as low or lower already stands (the owner's yes, say): it is said again, never replaced
		return false
	}
	if !ok {
		ctx.prefix = append(ctx.prefix, "price_floor")
		return false
	}
	return a.decideOffer(o, item, price, ctx)
}

// checkDeal holds an order's deal to the order as it is now, before anything is held or quoted. The same ask (the same code): an asked card still waits (stop), anything else
// stands. A changed order (another quantity, other lines, a new menu price): the decision is made again for the same price asked, so a change never rides on an old yes or an
// old card; the item gone from the order drops the deal.
func (a *Agent) checkDeal(o *Order, ctx *flowCtx) (stop bool) {
	d := o.deal()
	if d == nil {
		return false
	}
	item := a.settings.ItemOf(d.Item)
	if item == nil || a.settings.Discounts == nil {
		o.setDeal(nil)
		return false
	}
	ask, others, ok := a.askOf(o, item, d.OfferedInr)
	if !ok {
		o.setDeal(nil)
		return false
	}
	now := discounts.NewDeal(o.ID, ask, discounts.Decide(a.settings.Discounts, a.discountCaps(), ask), others, 0)
	if now.Code == d.Code {
		if d.State == discounts.Asked {
			a.tellCustomer(o, o.Customer, cat(ctx.prefix, "discount_asked"), sayOpts{itemID: item.ID, facts: a.dealFacts(*d)})
			return true
		}
		return false
	}
	o.setDeal(nil) // the old card, if any, is void: its code names an ask this order no longer is
	return a.decideOffer(o, item, d.OfferedInr, ctx)
}

// onDiscountAnswer is the owner's "approve o-3 K7M2QX" or "deny o-3 K7M2QX". It acts only when that order's card waits with exactly that code and the order still is that
// exact ask; anything else (an old card after a change, an answer already given, an order gone) changes nothing and the owner is told so.
func (a *Agent) onDiscountAnswer(command, ref, code string) error {
	o := a.store.Order(strings.ToLower(ref))
	said := map[string]string{"command": command, "kind": "discount"}
	a.log(o, a.owner(), "owner_decision", "attempted", inputs("command", command, "ref", ref), logMore{refs: said})
	var d *discounts.Deal
	if o != nil && o.State == Enquiry {
		d = o.deal()
	}
	stale := d == nil || d.State != discounts.Asked || !strings.EqualFold(d.Code, code)
	var item *MenuItem
	if !stale {
		item = a.settings.ItemOf(d.Item)
		if item == nil {
			stale = true
		} else if ask, others, ok := a.askOf(o, item, d.OfferedInr); !ok || discounts.NewDeal(o.ID, ask, discounts.Decide(a.settings.Discounts, a.discountCaps(), ask), others, 0).Code != d.Code {
			stale = true // the order is not the ask the card showed any more
		}
	}
	if stale {
		a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"command": command}, logMore{refs: said,
			notes: "the price card this answer names is not the one waiting (the ask changed, it was already answered, or the order moved on): nothing was done"})
		a.tellOwner(nil, a.owner(), "owner_discount_stale", sayOpts{})
		return nil
	}
	ctx := &flowCtx{itemID: item.ID}
	if command == "approve" {
		d.State, d.By = discounts.Approved, "owner"
		o.setDeal(d)
		a.log(o, o.Customer, discounts.Action, "confirmed", map[string]any{"offeredInr": d.OfferedInr}, logMore{refs: discounts.Refs(*d, "owner"),
			notes: "the owner approved exactly this total on the card: the order's total is the agreed one"})
		a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said, notes: "the owner agreed to the total on the card"})
		ctx.prefix = []string{"discount_approved"}
		return a.proceed(o, ctx)
	}
	d.State, d.By = discounts.Refused, "owner"
	o.setDeal(d)
	a.log(o, o.Customer, discounts.Action, "blocked", map[string]any{"offeredInr": d.OfferedInr}, logMore{refs: discounts.Refs(*d, "owner"),
		notes: "the owner said no to the total on the card: the customer is offered the menu price"})
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said, notes: "the owner refused the total on the card"})
	ctx.prefix = []string{"discount_refused"}
	return a.proceed(o, ctx)
}

// askedDeal is the deal a plain "approve o-3" names when a price card waits on that order (the answer needs the card's code), or nil.
func askedDeal(o *Order) *discounts.Deal {
	if d := o.deal(); d != nil && d.State == discounts.Asked && o.State == Enquiry {
		return d
	}
	return nil
}
