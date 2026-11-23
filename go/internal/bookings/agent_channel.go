package bookings

// Item 11d, the booking page, its API and the MCP endpoint: agent.ts's channel section (onChannel, onChannelBook, channelTimeProblem) and the store's `channel` block as a step
// changes it (modules/channels/state.ts ChannelState, outbox.ts channelMessaging). A channel booking goes through the SAME steps as a WhatsApp booking (proceedToHold); what
// differs is its own conversation ("web:<16 hex>"), its messages kept for its page (never sent to the typed number), the exact service and start (no words are read), and the
// per-number and per-shop limits.
//
// The channel block is the shared runtime's ChannelState (internal/runtime chatstate.go: the outbox, the chat's guests); only its `requests` are the template's own, modelled here.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// channels/state.ts CHANNEL_LIMITS (the outbox's caps are the runtime's: runtime.OutboxPerConversation, ChatThreadMax).
const (
	holdsPerPhone        = 2
	startsPerPhonePerDay = 5
	unpaidHoldsPerShop   = 6
)

// ChannelRequest is state.ts ChannelRequestRecord: the template's own part of the shared channel state (runtime.ChannelState keeps `requests` raw for the template).
type ChannelRequest struct {
	AtMs    int64  `json:"atMs"`
	Channel string `json:"channel"`
	Booking string `json:"booking,omitempty"`
	Refused string `json:"refused,omitempty"`
	Phone   string `json:"phone,omitempty"`
}

// chanRequests are the requests by their handle's hash, in their keys' order (a JS object's).
type chanRequests struct {
	keys []string
	m    map[string]*ChannelRequest
}

func (c *chanRequests) set(hash string, r *ChannelRequest) {
	if _, ok := c.m[hash]; !ok {
		c.keys = append(c.keys, hash)
	}
	c.m[hash] = r
}

func (c *chanRequests) json() json.RawMessage {
	var o object
	for _, k := range c.keys {
		o.put(k, c.m[k])
	}
	return o.done()
}

// chanState is the store's `channel` block for this step (`store.channel ??= emptyChannelState()`), the runtime's own ChannelState (the chat's part included), parsed once; Members
// writes it back. A block this version cannot read is started fresh only in memory: it is written back only if the step changes it.
func (s *Store) chanState() *runtime.ChannelState {
	if s.channel == nil {
		cs, err := runtime.ParseChannel(s.Channel)
		if err != nil {
			cs = runtime.EmptyChannel()
		}
		s.channel = cs
	}
	return s.channel
}

// requests are the channel's requests, parsed on first use.
func (s *Store) requests() *chanRequests {
	if s.reqs == nil {
		s.reqs = &chanRequests{m: map[string]*ChannelRequest{}}
		if raw := s.chanState().Requests; raw != nil {
			if rs, ok := members(raw); ok {
				for _, r := range rs {
					x := &ChannelRequest{}
					_ = json.Unmarshal(r.Raw, x)
					s.reqs.set(r.Name, x)
				}
			}
		}
	}
	return s.reqs
}

func isChannelConversation(to string) bool { return runtime.IsChannelConversation(to) }
func isChatConversation(to string) bool    { return runtime.IsChatConversation(to) }

// ---- outbox.ts channelMessaging: a message to a channel's conversation is kept for its page, never sent to the typed number ------------------------------------------

type chanMsg struct {
	a    *Agent
	base messaging.Messaging
}

func (a *Agent) channelMessaging(base messaging.Messaging) messaging.Messaging {
	if _, img := base.(messaging.Images); img {
		return chanImages{chanInteractive{&chanMsg{a, base}}}
	}
	return chanInteractive{&chanMsg{a, base}}
}

// chanImages keeps the base's pictures for a WhatsApp conversation (a UPI request's QR); a channel's page draws its own QR, so a picture to a channel conversation is refused.
type chanImages struct{ chanInteractive }

func (c chanImages) SendImage(ctx context.Context, to string, i messaging.ImageMessage) (messaging.OutboundMessage, error) {
	if isChannelConversation(to) {
		return messaging.OutboundMessage{}, &guard.ApiError{Status: 400, Message: "A booking page draws its own QR code; no picture is kept for it."}
	}
	return c.base.(messaging.Images).SendImage(ctx, to, i)
}

func (c *chanMsg) keep(to, kind, text string, choices []runtime.ChatChoice) messaging.OutboundMessage {
	m := c.a.store.chanState().Keep(to, text, choices, c.a.now())
	// outbox.ts onKeep: a customer who allowed alerts on this page gets the same words as a web push (runtime.CustomerPush, which never fails the message)
	if push := c.a.kit.Ports.PushCustomer; push != nil {
		push(to, text)
	}
	return messaging.OutboundMessage{ID: m.ID, To: to, Kind: kind, Text: text, SentAt: m.AtMs}
}

func noChannelWhatsApp() error {
	return &guard.ApiError{Status: 400, Message: "This shop has no WhatsApp number yet, so nothing was sent; the owner's page shows what waits for them."}
}

func (c *chanMsg) SendText(ctx context.Context, to, text string) (messaging.OutboundMessage, error) {
	if isChannelConversation(to) {
		return c.keep(to, "text", text, nil), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChannelWhatsApp()
	}
	return c.base.SendText(ctx, to, text)
}

func (c *chanMsg) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	if isChannelConversation(to) {
		return c.keep(to, "text", t.Text, nil), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChannelWhatsApp()
	}
	return c.base.SendTemplate(ctx, to, t)
}

func (c *chanMsg) IsWindowOpen(ctx context.Context, to string) (bool, error) {
	if isChannelConversation(to) {
		return true, nil
	}
	if c.base == nil {
		return false, nil
	}
	return c.base.IsWindowOpen(ctx, to)
}

func (c *chanMsg) GetMessage(ctx context.Context, id string) (*messaging.OutboundMessage, error) {
	if strings.HasPrefix(id, "ch-") {
		for _, m := range c.a.store.chanState().Outbox {
			if m.ID == id {
				return &messaging.OutboundMessage{ID: m.ID, To: m.To, Kind: "text", Text: m.Text, SentAt: m.AtMs}, nil
			}
		}
		return nil, nil
	}
	if c.base == nil {
		return nil, nil
	}
	return c.base.GetMessage(ctx, id)
}

type chanInteractive struct{ *chanMsg }

// SendInteractive: buttons and lists are WhatsApp's; a booking's page has its own, so only the words above them are kept; a chat thread keeps the choices too (outbox.ts choicesOf).
func (c chanInteractive) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	if isChannelConversation(to) {
		var buttons, rows []runtime.ChatChoice
		for _, b := range m.Buttons {
			buttons = append(buttons, runtime.ChatChoice{ID: b.ID, Title: b.Title})
		}
		if m.List != nil {
			for _, r := range m.List.Rows {
				ch := runtime.ChatChoice{ID: r.ID, Title: r.Title, List: true}
				if r.Description != nil {
					ch.Hint = *r.Description
				}
				rows = append(rows, ch)
			}
		}
		return c.keep(to, "text", m.Body, runtime.ChoicesOf(buttons, rows)), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChannelWhatsApp()
	}
	inter, ok := c.base.(messaging.Interactive)
	if !ok {
		return messaging.OutboundMessage{}, &guard.ApiError{Status: 400, Message: "This WhatsApp provider has no buttons."}
	}
	return inter.SendInteractive(ctx, to, m)
}

// ---- the booking page's requests ---------------------------------------------------------------------------------------------------------------------------------

// channelTimeProblem is agent.ts channelTimeProblem: why a requested start cannot be booked before anything is held, or "".
func (a *Agent) channelTimeProblem(sv *Service, startMs int64) string {
	now := a.now()
	p := zone.LocalParts(startMs, a.settings.Timezone)
	minuteOfDay := p.Hour*60 + p.Minute
	if startMs%Minute != 0 || int64(minuteOfDay)%a.settings.SlotMinutes != 0 {
		return "off_grid"
	}
	if startMs <= now+a.settings.Deposit.HoldMinutes*Minute {
		return "too_soon"
	}
	if startMs > now+channelDaysAhead*Day {
		return "too_far"
	}
	hours := a.settings.HoursOn(zone.WeekdayOf(p.Date))
	if hours == nil || contains(a.closedDays(), isoDate(p.Date)) || minuteOfDay < hours.Open || minuteOfDay+int(sv.DurationMinutes) > hours.Close {
		return "outside_hours"
	}
	return ""
}

// onChannel is agent.ts onChannel: a book, a cancel or an "I have paid" from the booking's page.
func (a *Agent) onChannel(ev map[string]any) error {
	op, _ := ev["op"].(string)
	channel, _ := ev["channel"].(string)
	handle, _ := ev["handle"].(string)
	if op == "book" {
		return a.onChannelBook(ev, channel, handle)
	}
	refs := map[string]string{"channel": channel, "op": op}
	if op != "cancel" && op != "paid" {
		a.log(nil, a.owner(), "channel_booking", "blocked", map[string]any{"op": op}, logMore{refs: refs, notes: "a request this shop does not take (it is not an orders or fees shop): nothing was done"})
		return nil
	}
	var b *Booking
	if r := a.store.requests().m[handle]; r != nil && r.Booking != "" {
		b = a.store.Booking(r.Booking)
	}
	if b == nil || b.Handle != handle {
		a.log(nil, a.owner(), "channel_booking", "blocked", map[string]any{"op": op}, logMore{refs: refs, notes: "no booking has this handle, so nothing was done"})
		return nil
	}
	notes := "the customer says they paid, from the booking's page; nothing is marked paid until the owner marks it"
	if op == "cancel" {
		notes = "the customer cancelled from the booking's page"
	}
	a.log(b, b.Customer, "channel_booking", "confirmed", map[string]any{"op": op}, logMore{refs: refs, notes: notes})
	if op == "cancel" {
		return a.onCancel(b.Customer) // its conversation holds only this booking, so this cancels exactly it
	}
	if !a.ownerConfirms {
		return nil
	}
	upiRef, _ := ev["upiRef"].(string)
	if b.State == Expired {
		a.onLateClaim(b, upiRef)
		return nil
	}
	a.onPaidClaim(b.Customer, "button", upiRef)
	return nil
}

func (a *Agent) onChannelBook(ev map[string]any, channel, handle string) error {
	state := a.store.requests()
	if state.m[handle] != nil {
		return nil // the same request again (its task key is the handle): one booking, however often it is sent
	}
	now := a.now()
	conversation := channel + ":" + handle[:min(16, len(handle))]
	serviceID, _ := ev["serviceId"].(string)
	startF, _ := ev["startMs"].(float64)
	start := int64(startF)
	name, _ := ev["name"].(string)
	phone, _ := ev["phone"].(string)
	lang, _ := ev["language"].(string)
	digits := digitsOf(phone)
	if !contains(a.settings.Languages, lang) {
		lang = a.settings.Languages[0]
	}
	// the name and number are inputs only: the record keeps their keyed digest, never the words
	inputs := map[string]any{"channel": channel, "serviceId": serviceID, "startMs": ev["startMs"], "name": name, "phone": phone}
	refuse := func(reason, notes string) error {
		state.set(handle, &ChannelRequest{AtMs: now, Channel: channel, Refused: reason, Phone: digits})
		a.log(nil, conversation, "channel_booking", "blocked", inputs, logMore{refs: map[string]string{"channel": channel, "reason": reason}, notes: notes})
		return nil
	}
	if !a.takesNewWork() {
		_ = refuse("paused", "online booking is paused (the shop's licence): nothing is held and nothing is kept to do later")
		a.store.Customer(conversation).Language = lang
		a.pausedReply(conversation, "book", nil)
		return nil
	}
	sv := a.settings.ServiceByID(serviceID)
	if sv == nil {
		return refuse("unknown_service", "the shop has no such service")
	}
	if p := a.channelTimeProblem(sv, start); p != "" {
		return refuse(p, "the start asked for is not one the shop can offer (off its slot grid, too soon to pay in time, too far ahead, or outside its hours); nothing was held")
	}
	// the typed number is not verified, so these only slow one person down; the per-shop cap and the hold's own end are what bound a flood
	var live []*Booking
	for _, b := range a.store.Bookings {
		if (b.Channel != "" || isChatConversation(b.Customer)) && b.State == AwaitingDeposit {
			live = append(live, b)
		}
	}
	samePhone := 0
	for _, b := range live {
		if b.Contact != nil && digitsOf(b.Contact.Phone) == digits {
			samePhone++
		}
	}
	if samePhone >= holdsPerPhone {
		return refuse("phone_busy", fmt.Sprintf("this number already has %d unpaid holds from the booking page; nothing more is held for it until one is paid, cancelled or ends", holdsPerPhone))
	}
	today := 0
	for _, k := range state.keys {
		if r := state.m[k]; r.Phone == digits && now-r.AtMs < Day {
			today++
		}
	}
	if today >= startsPerPhonePerDay {
		return refuse("phone_day", fmt.Sprintf("this number started %d bookings from the booking page in the last 24 hours; no more today", startsPerPhonePerDay))
	}
	if len(live) >= unpaidHoldsPerShop {
		return refuse("shop_busy", fmt.Sprintf("the shop already has %d unpaid holds from the booking page and its API; nothing more is held until one is paid, cancelled or ends", unpaidHoldsPerShop))
	}
	a.store.Customer(conversation).Language = lang // only now: a refused request leaves no customer behind
	b := a.store.Register(NewDraft(conversation, lang))
	b.Channel, b.Handle = channel, handle
	b.Contact = &Contact{Name: name, Phone: phone}
	b.ServiceID = sv.ID
	end := start + sv.DurationMinutes*Minute
	b.StartMs, b.EndMs = &start, &end
	p := zone.LocalParts(start, a.settings.Timezone)
	b.setDate(p.Date)
	b.setExtra("time", clockTime{p.Hour, p.Minute})
	state.set(handle, &ChannelRequest{AtMs: now, Channel: channel, Booking: b.ID, Phone: digits})
	where := "shop's booking page or its API"
	if channel == "mcp" {
		where = "MCP endpoint, by an AI assistant for its user"
	}
	a.log(b, conversation, "channel_booking", "confirmed", inputs, logMore{refs: map[string]string{"channel": channel}, notes: "asked for on the " + where + ": an exact service and start, so no words were read; the same hold, limits and deposit as a WhatsApp booking follow"})
	return a.proceedToHold(b, nil, nil)
}

// ---- the owner's private page (item 11d) --------------------------------------------------------------------------------------------------------------------------------

// onOwnerAction is agent.ts onOwnerAction: the owner pressed a button on their private page. The page showed an action with a digest of exactly what it showed (ownerItems); if what
// waits now has another digest (a mark was made since, the amount changed, it was already answered) nothing is done. Otherwise it is handled by the same code as the owner's reply
// on WhatsApp: the one-use code's button for a UPI mark, "approve b-3" and the like for what the agent asked the owner. A refund Guard holds is never here (the approvals relay's).
func (a *Agent) onOwnerAction(ev map[string]any) error {
	id, _ := ev["id"].(string)
	action, _ := ev["action"].(string)
	cs, _ := ev["case"].(string)
	digest, _ := ev["digest"].(string)
	refs := map[string]string{"channel": "owner_page", "action": action}
	inputs := map[string]any{"action": action, "case": cs}
	if action == "card_yes" || action == "card_no" {
		if a.settings.Assistant == nil {
			a.log(nil, a.owner(), "owner_page_action", "blocked", inputs, logMore{refs: refs, notes: "a card's answer came for a shop without the assistant: nothing was done"})
			return nil
		}
		// item 11e on the page: an answer to one of the assistant's cards, by the card's id and the digest the page showed (cards.ts judgeCard decides, as for a tap)
		answer := "yes"
		if action == "card_no" {
			answer = "no"
		}
		if as := a.assistantOf(); as != nil {
			as.OnPageCard(cs, digest, answer)
		}
		return a.stepErr
	}
	var item *ownerItem
	for _, it := range ownerItems(a.store, a.settings, a.now()) {
		if it.Case == cs && it.Digest == digest && contains(it.Actions, action) {
			item = &it
			break
		}
	}
	b := a.store.Booking(cs)
	if item == nil {
		a.log(b, a.owner(), "owner_page_action", "blocked", inputs, logMore{refs: refs, notes: "what the owner's page showed is not what waits now (already answered, a new mark or amount since, or gone): nothing was done"})
		return nil
	}
	a.log(b, a.owner(), "owner_page_action", "confirmed", inputs, logMore{refs: refs, notes: "pressed by the owner on their private approvals page; handled exactly as the same reply on WhatsApp"})
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
	} else if item.Deal != nil {
		msg.Text = action + " " + cs + " " + item.Deal.Code // E1: a price card's answer names its code, exactly as the owner types it on WhatsApp (onDiscountAnswer decides)
	} else {
		msg.Text = action + " " + cs
	}
	return a.onOwnerMessage(msg)
}

// onOwnerPageMessage is agent.ts onOwnerPageMessage: the owner's talk box on their page is the shop's assistant's; a shop without one reads nothing.
func (a *Agent) onOwnerPageMessage(ev map[string]any) error {
	_, voice := ev["voice"]
	if a.settings.Assistant == nil {
		a.log(nil, a.owner(), "owner_page_message", "blocked", map[string]any{"voice": voice}, logMore{refs: map[string]string{"channel": "owner_page"}, notes: "the owner's talk box is the shop's assistant's, and this shop has none: nothing was read"})
		return nil
	}
	as := a.assistantOf()
	if as == nil {
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
