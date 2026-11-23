package orders

// Item 11h: the shop's page, its API and the MCP endpoint, and the owner's page: agent.ts's channel section (onChannel, channelOrderProblem, onChannelOrder, onOwnerAction,
// onOwnerPageMessage). A channel order goes through the SAME `proceed` as a WhatsApp order (the size, the day, the cut-off, the stock, the day's count, the big-order line; then the
// hold and the advance). What differs: its conversation is its own ("web:<16 hex>"), its messages go to its page (agent_say.go chanMsg), the request names exact items, a day, the
// way and its slot, every one checked against the settings BEFORE `proceed` (a page cannot answer a question), and the per-number and per-shop limits.

import (
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// channels/state.ts CHANNEL_LIMITS.
const (
	holdsPerPhone        = 2
	startsPerPhonePerDay = 5
	unpaidHoldsPerShop   = 6
	dayMs                = 24 * Hour
)

// channelLine is one line of a page's request (`{itemId, qty}`).
type channelLine struct {
	ItemID string
	Qty    int64
}

func channelLines(v any) []channelLine {
	list, _ := v.([]any)
	out := []channelLine{}
	for _, x := range list {
		m, _ := x.(map[string]any)
		id, _ := m["itemId"].(string)
		q, _ := m["qty"].(float64)
		out = append(out, channelLine{id, int64(q)})
	}
	return out
}

// channelOrderProblem is agent.ts channelOrderProblem: why an order cannot be tried before anything is held (its items, its size, its day, its way and slot, its address); reason ""
// when `proceed` may take it.
func (a *Agent) channelOrderProblem(lines []channelLine, dateText, mode, slotID, address string) (reason, notes string, ds []Decision) {
	s := a.settings
	var n int64
	for _, l := range lines {
		if s.ItemOf(l.ItemID) == nil {
			return "unknown_item", "an item the shop's menu does not have", nil
		}
		n += l.Qty
	}
	if size := checkOrderSize(n, s.Orders.MaxItemsPerOrder); blocked(size) {
		return "too_many_items", "more items than the shop takes in one order", []Decision{size}
	}
	date := DateOfIso(dateText)
	ahead := -1
	if date != nil {
		ahead = zone.DaysBetween(zone.LocalParts(a.now(), s.Timezone).Date, date.Zone())
	}
	if date == nil || ahead < 0 || int64(ahead) > s.Orders.DaysAhead {
		return "bad_date", fmt.Sprintf("a day that is not one the shop takes orders for (today to %d days ahead)", s.Orders.DaysAhead), nil
	}
	if mode == Delivery && s.Delivery == nil {
		return "no_delivery", "the shop does not deliver", nil
	}
	if x, ok := s.SlotOf(slotID); !ok || x.Mode != mode {
		return "bad_slot", "a slot the shop does not have for this way", nil
	}
	if mode == Delivery {
		if d := checkDeliveryArea(address, s.Delivery.Area); blocked(d) {
			return "outside_area", "the address names no place on the delivery list; it is not kept", []Decision{d}
		}
	}
	return "", "", nil
}

// onChannelOrder is agent.ts onChannelOrder.
func (a *Agent) onChannelOrder(ev map[string]any, channel, handle string) error {
	reqs := a.store.Requests()
	if reqs.Get(handle) != nil {
		return nil // the same request again (its task key is the handle): one order, however often it is sent
	}
	now := a.now()
	conversation := channel + ":" + handle[:min(16, len(handle))]
	dateText, _ := ev["date"].(string)
	mode, _ := ev["mode"].(string)
	slotID, _ := ev["slotId"].(string)
	name, _ := ev["name"].(string)
	phone, _ := ev["phone"].(string)
	address, _ := ev["address"].(string)
	lang, _ := ev["language"].(string)
	digits := digitsOf(phone)
	if !contains(a.settings.Languages, lang) {
		lang = a.settings.Languages[0]
	}
	lines := channelLines(ev["lines"])
	// the name, number and address are inputs only: the record keeps their keyed digest (B69), never the words, in refs or notes
	in := inputs("channel", channel, "lines", ev["lines"], "date", ev["date"], "mode", ev["mode"], "slotId", ev["slotId"], "name", ev["name"], "phone", ev["phone"], "address", optS(address))
	refuse := func(reason, notes string, ds []Decision) {
		r := reason
		reqs.Set(handle, &ChannelRequest{AtMs: now, Channel: channel, Refused: &r, Phone: digits})
		a.log(nil, conversation, "channel_order", "blocked", in, logMore{decisions: ds, refs: map[string]string{"channel": channel, "reason": reason}, notes: notes})
	}
	if !a.takesNewWork() {
		refuse("paused", "online ordering is paused (the shop's licence): nothing is held and nothing is kept to do later", nil)
		a.store.Customer(conversation).Language = lang
		a.pausedReply(conversation, "order", nil)
		return nil
	}
	if reason, notes, ds := a.channelOrderProblem(lines, dateText, mode, slotID, address); reason != "" {
		refuse(reason, notes, ds)
		return nil
	}
	// the typed number is not verified, so these only slow one person down; the per-shop cap and the hold's own end are what bound a flood. An order waiting for the owner counts
	// too: each one asks the owner. A chat guest's order counts in the cap too.
	live := a.unpaidFromPages("")
	samePhone := 0
	for _, o := range live {
		if o.Contact != nil && digitsOf(o.Contact.Phone) == digits {
			samePhone++
		}
	}
	if samePhone >= holdsPerPhone {
		refuse("phone_busy", fmt.Sprintf("this number already has %d unpaid orders from the shop's page; nothing more is held for it until one is paid, cancelled or ends", holdsPerPhone), nil)
		return nil
	}
	today := 0
	for _, k := range reqs.Keys() {
		if r := reqs.Get(k); r.Phone == digits && now-r.AtMs < dayMs {
			today++
		}
	}
	if today >= startsPerPhonePerDay {
		refuse("phone_day", fmt.Sprintf("this number started %d orders from the shop's page in the last 24 hours; no more today", startsPerPhonePerDay), nil)
		return nil
	}
	if len(live) >= unpaidHoldsPerShop {
		refuse("shop_busy", fmt.Sprintf("the shop already has %d unpaid orders from its page and its API; nothing more is held until one is paid, cancelled or ends", unpaidHoldsPerShop), nil)
		return nil
	}
	a.store.Customer(conversation).Language = lang // only now: a refused request leaves no customer behind
	o := a.store.Register(NewDraft(conversation, lang))
	o.Channel, o.Handle = channel, handle
	o.Contact = &Contact{Name: name, Phone: phone}
	for _, l := range lines {
		AddLine(&o.Lines, l.ItemID, l.Qty)
	}
	o.Date = DateOfIso(dateText)
	o.Mode, o.SlotID = mode, slotID
	var shown []Decision
	if mode == Delivery {
		shown = []Decision{checkDeliveryArea(address, a.settings.Delivery.Area)}
		o.Area, o.Address = areaOf(address, a.settings.Delivery.Area), address
	}
	id := o.ID
	reqs.Set(handle, &ChannelRequest{AtMs: now, Channel: channel, Booking: &id, Phone: digits})
	where := "shop's page or its API"
	if channel == "mcp" {
		where = "MCP endpoint, by an AI assistant for its user"
	}
	a.log(o, conversation, "channel_order", "confirmed", in, logMore{decisions: shown, refs: map[string]string{"channel": channel},
		notes: "asked for on the " + where + ": exact items, a day, the way and its slot, so no words were read; the same checks, hold and advance as a WhatsApp order follow"})
	return a.proceed(o, &flowCtx{shown: shown})
}

// onChannel is agent.ts onChannel: the page's requests: an order, or a cancel or an "I have paid" for the order with this handle (the same as the same button on WhatsApp, in the
// order's own conversation).
func (a *Agent) onChannel(ev map[string]any) error {
	op, _ := ev["op"].(string)
	channel, _ := ev["channel"].(string)
	handle, _ := ev["handle"].(string)
	if op == "order" {
		return a.onChannelOrder(ev, channel, handle)
	}
	refs := map[string]string{"channel": channel, "op": op}
	if op != "cancel" && op != "paid" {
		a.log(nil, a.owner(), "channel_order", "blocked", map[string]any{"op": op}, logMore{refs: refs, notes: "a request this shop does not take (it is not a booking or fees shop): nothing was done"})
		return nil
	}
	var o *Order
	if r := a.store.Requests().Get(handle); r != nil && r.Booking != nil {
		o = a.store.Order(*r.Booking)
	}
	if o == nil || o.Handle != handle {
		a.log(nil, a.owner(), "channel_order", "blocked", map[string]any{"op": op}, logMore{refs: refs, notes: "no order has this handle, so nothing was done"})
		return nil
	}
	notes := "the customer says they paid, from the order's page; nothing is marked paid until the owner marks it"
	if op == "cancel" {
		notes = "the customer cancelled from the order's page"
	}
	a.log(o, o.Customer, "channel_order", "confirmed", map[string]any{"op": op}, logMore{refs: refs, notes: notes})
	if op == "cancel" {
		return a.onCancel(o.Customer) // its conversation holds only this order, so this cancels exactly it
	}
	if a.ownerConfirms {
		upiRef, _ := ev["upiRef"].(string)
		return a.onPaidClaim(o.Customer, "button", upiRef)
	}
	return a.onPaidReadBack(o.Customer)
}

// onOwnerAction is agent.ts onOwnerAction: the owner pressed a button on their page. The page showed an action with a digest of exactly what it showed (channel.go OwnerItems); if
// what waits now has another digest (a mark was made since, it was already answered) nothing is done. Otherwise it is handled by the same code as the owner's reply on WhatsApp:
// the one-use code's button for a UPI mark, "approve o-3" / "deny o-3" for what the agent asked the owner. A refund Guard holds is never here: the approvals relay answers it.
func (a *Agent) onOwnerAction(ev map[string]any) error {
	id, _ := ev["id"].(string)
	action, _ := ev["action"].(string)
	cs, _ := ev["case"].(string)
	digest, _ := ev["digest"].(string)
	refs := map[string]string{"channel": "owner_page", "action": action}
	in := map[string]any{"action": action, "case": cs}
	// item 11e on the page: an answer to one of the assistant's cards, bound by the card's own digest, exactly as a tap on WhatsApp
	if action == "card_yes" || action == "card_no" {
		as := a.assistantOf()
		if as == nil {
			a.log(nil, a.owner(), "owner_page_action", "blocked", in, logMore{refs: refs, notes: "a card's answer came for a shop without the assistant: nothing was done"})
			return nil
		}
		a.log(nil, a.owner(), "owner_page_action", "confirmed", in, logMore{refs: refs, notes: "pressed by the owner on their page; the card's own binding decides, as for a tap on WhatsApp"})
		answer := "yes"
		if action == "card_no" {
			answer = "no"
		}
		as.OnPageCard(cs, digest, answer)
		return a.stepErr
	}
	items, _ := a.settings.OwnerItems(a.store, a.now())
	var item *OwnerItem
	for i := range items {
		if items[i].Case == cs && items[i].Digest == digest && contains(items[i].Actions, action) {
			item = &items[i]
			break
		}
	}
	o := a.store.Order(cs)
	if item == nil {
		a.log(o, a.owner(), "owner_page_action", "blocked", in, logMore{refs: refs, notes: "what the owner's page showed is not what waits now (already answered, a new mark since, or gone): nothing was done"})
		return nil
	}
	a.log(o, a.owner(), "owner_page_action", "confirmed", in, logMore{refs: refs, notes: "pressed by the owner on their page; handled exactly as the same reply on WhatsApp"})
	msg := messaging.InboundMessage{ID: "owner-page:" + id, From: a.owner(), Timestamp: a.now()}
	if item.Code != "" {
		kind := ownermarked.ReplyRefunded
		switch action {
		case "received":
			kind = ownermarked.ReplyReceived
		case "kept":
			kind = ownermarked.ReplyKept
		}
		msg.Reply = &messaging.Reply{ID: ownermarked.MarkButtonID(kind, item.Code), Kind: "button"}
	} else {
		msg.Text = action + " " + cs
	}
	return a.onOwnerMessage(msg)
}

// onOwnerPageMessage is agent.ts onOwnerPageMessage: the owner's talk box on their page (typed words, or a recording the runtime holds in memory) is the shop's assistant's; a shop
// without one reads nothing.
func (a *Agent) onOwnerPageMessage(ev map[string]any) error {
	_, voice := ev["voice"]
	as := a.assistantOf()
	if as == nil {
		a.log(nil, a.owner(), "owner_page_message", "blocked", map[string]any{"voice": voice}, logMore{refs: map[string]string{"channel": "owner_page"}, notes: "the owner's talk box is the shop's assistant's, and this shop has none: nothing was read"})
		return nil
	}
	id, _ := ev["id"].(string)
	if !voice {
		text, _ := ev["text"].(string)
		if err := as.OnPageMessage("owner-page:"+id, text, a.now()); err != nil {
			return err
		}
		return a.stepErr
	}
	ref, _ := ev["voice"].(string)
	if err := as.OnPageVoice("owner-page:"+id, a.c.OwnerAudio(ref)); err != nil {
		return err
	}
	return a.stepErr
}
