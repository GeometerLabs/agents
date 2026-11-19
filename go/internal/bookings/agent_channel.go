package bookings

// Item 11d, the booking page, its API and the MCP endpoint: agent.ts's channel section (onChannel, onChannelBook, channelTimeProblem) and the store's `channel` block as a step
// changes it (modules/channels/state.ts ChannelState, outbox.ts channelMessaging). A channel booking goes through the SAME steps as a WhatsApp booking (proceedToHold); what
// differs is its own conversation ("web:<16 hex>"), its messages kept for its page (never sent to the typed number), the exact service and start (no words are read), and the
// per-number and per-shop limits.
//
// ChannelState models the members this file changes (seq, outbox, requests) and keeps the rest raw in its own order (`chat`, `guests`: the chat's, go-bk-chat-19nov), so a shop
// moves between the runtimes and loses nothing. TODO(go-bk-chat-19nov): the chat's thread lines (choices, the CHAT_THREAD_MAX cap) use this same outbox.

import (
	"regexp"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// channels/state.ts CHANNEL_LIMITS and OUTBOX_PER_CONVERSATION.
const (
	holdsPerPhone          = 2
	startsPerPhonePerDay   = 5
	unpaidHoldsPerShop     = 6
	outboxPerConversation  = 20
	chatThreadMax          = 60
)

// OutboxMessage is state.ts OutboxMessage; Rest keeps the members this file does not model (a chat line's `choices`).
type OutboxMessage struct {
	ID     string `json:"id"`
	To     string `json:"to"`
	Text   string `json:"text"`
	AtMs   int64  `json:"atMs"`
	Moment string `json:"moment,omitempty"`
	Rest   map[string]json.RawMessage
}

// ChannelRequest is state.ts ChannelRequestRecord.
type ChannelRequest struct {
	AtMs    int64  `json:"atMs"`
	Channel string `json:"channel"`
	Booking string `json:"booking,omitempty"`
	Refused string `json:"refused,omitempty"`
	Phone   string `json:"phone,omitempty"`
}

// ChannelState is the store's `channel` block as a step changes it. Requests keep their keys' order (a JS object's).
type ChannelState struct {
	Seq      int64
	Outbox   []*OutboxMessage
	keys     []string
	Requests map[string]*ChannelRequest
	rest     []runtime.Member // chat, guests and anything newer, in order
}

// chan_ is the store's channel block, parsed on first use in a step (`store.channel ??= emptyChannelState()`).
func (s *Store) chanState() *ChannelState {
	if s.channel != nil {
		return s.channel
	}
	c := &ChannelState{Requests: map[string]*ChannelRequest{}, Outbox: []*OutboxMessage{}}
	if s.Channel != nil {
		if ms, ok := members(s.Channel); ok {
			for _, m := range ms {
				switch m.Name {
				case "seq":
					var f float64
					_ = json.Unmarshal(m.Raw, &f)
					c.Seq = int64(f)
				case "outbox":
					var list []json.RawMessage
					_ = json.Unmarshal(m.Raw, &list)
					for _, raw := range list {
						o := &OutboxMessage{}
						_ = json.Unmarshal(raw, o)
						var all map[string]json.RawMessage
						_ = json.Unmarshal(raw, &all)
						for _, k := range []string{"id", "to", "text", "atMs", "moment"} {
							delete(all, k)
						}
						if len(all) > 0 {
							o.Rest = all
						}
						c.Outbox = append(c.Outbox, o)
					}
				case "requests":
					if rs, ok := members(m.Raw); ok {
						for _, r := range rs {
							x := &ChannelRequest{}
							_ = json.Unmarshal(r.Raw, x)
							c.keys = append(c.keys, r.Name)
							c.Requests[r.Name] = x
						}
					}
				default:
					c.rest = append(c.rest, m)
				}
			}
		}
	}
	s.channel = c
	return c
}

func (c *ChannelState) setRequest(hash string, r *ChannelRequest) {
	if _, ok := c.Requests[hash]; !ok {
		c.keys = append(c.keys, hash)
	}
	c.Requests[hash] = r
}

func (c *ChannelState) markMoment(id, moment string) {
	for _, m := range c.Outbox {
		if m.ID == id {
			m.Moment = moment
		}
	}
}

// json writes the block back in state.ts's member order (seq, outbox, requests, then the rest as read).
func (c *ChannelState) json() json.RawMessage {
	var o object
	o.put("seq", c.Seq)
	out := make([]json.RawMessage, 0, len(c.Outbox))
	for _, m := range c.Outbox {
		var x object
		x.put("id", m.ID)
		x.put("to", m.To)
		x.put("text", m.Text)
		x.put("atMs", m.AtMs)
		for k, v := range m.Rest {
			x.put(k, v)
		}
		if m.Moment != "" {
			x.put("moment", m.Moment)
		}
		out = append(out, x.done())
	}
	o.put("outbox", out)
	var rs object
	for _, k := range c.keys {
		rs.put(k, c.Requests[k])
	}
	o.put("requests", rs.done())
	for _, m := range c.rest {
		o.put(m.Name, m.Raw)
	}
	return o.done()
}

var (
	channelConversationRe = regexp.MustCompile(`^(?:web|mcp|chat):[0-9a-f]{16}$`) // channels/conversation.ts isChannelConversation
	chatConversationRe    = regexp.MustCompile(`^chat:[0-9a-f]{16}$`)
)

func isChannelConversation(to string) bool { return channelConversationRe.MatchString(to) }
func isChatConversation(to string) bool    { return chatConversationRe.MatchString(to) }

// ---- outbox.ts channelMessaging: a message to a channel's conversation is kept for its page, never sent to the typed number ------------------------------------------

type chanMsg struct {
	a    *Agent
	base messaging.Messaging
}

func (a *Agent) channelMessaging(base messaging.Messaging) messaging.Messaging {
	c := &chanMsg{a, base}
	return chanInteractive{c}
}

func (c *chanMsg) keep(to, kind, text string) messaging.OutboundMessage {
	s := c.a.store.chanState()
	s.Seq++
	m := &OutboxMessage{ID: fmt.Sprintf("ch-%d", s.Seq), To: to, Text: text, AtMs: c.a.now()}
	s.Outbox = append(s.Outbox, m)
	limit := outboxPerConversation
	if isChatConversation(to) {
		limit = chatThreadMax
	}
	var mine []*OutboxMessage
	for _, x := range s.Outbox {
		if x.To == to {
			mine = append(mine, x)
		}
	}
	if len(mine) > limit {
		drop := map[*OutboxMessage]bool{}
		for _, x := range mine[:len(mine)-limit] {
			drop[x] = true
		}
		keep := s.Outbox[:0]
		for _, x := range s.Outbox {
			if !drop[x] {
				keep = append(keep, x)
			}
		}
		s.Outbox = keep
	}
	// TODO(go-bk-agent): onKeep, the customer's web push of the page's message (push.customer), is not wired yet
	return messaging.OutboundMessage{ID: m.ID, To: to, Kind: kind, Text: text, SentAt: m.AtMs}
}

func noChannelWhatsApp() error {
	return &guard.ApiError{Status: 400, Message: "This shop has no WhatsApp number yet, so nothing was sent; the owner's page shows what waits for them."}
}

func (c *chanMsg) SendText(ctx context.Context, to, text string) (messaging.OutboundMessage, error) {
	if isChannelConversation(to) {
		return c.keep(to, "text", text), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChannelWhatsApp()
	}
	return c.base.SendText(ctx, to, text)
}

func (c *chanMsg) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	if isChannelConversation(to) {
		return c.keep(to, "text", t.Text), nil
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

// SendInteractive: buttons and lists are WhatsApp's; a booking's page has its own, so only the words above them are kept.
func (c chanInteractive) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	if isChannelConversation(to) {
		return c.keep(to, "text", m.Body), nil
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
	if r := a.store.chanState().Requests[handle]; r != nil && r.Booking != "" {
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
	if !a.settings.OwnerMarked() {
		return nil
	}
	return runtime.Unported("an \"I have paid\" from the booking page of a UPI shop (the owner's marks)")
}

func (a *Agent) onChannelBook(ev map[string]any, channel, handle string) error {
	state := a.store.chanState()
	if state.Requests[handle] != nil {
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
		state.setRequest(handle, &ChannelRequest{AtMs: now, Channel: channel, Refused: reason, Phone: digits})
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
		if r := state.Requests[k]; r.Phone == digits && now-r.AtMs < Day {
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
	state.setRequest(handle, &ChannelRequest{AtMs: now, Channel: channel, Booking: b.ID, Phone: digits})
	where := "shop's booking page or its API"
	if channel == "mcp" {
		where = "MCP endpoint, by an AI assistant for its user"
	}
	a.log(b, conversation, "channel_booking", "confirmed", inputs, logMore{refs: map[string]string{"channel": channel}, notes: "asked for on the " + where + ": an exact service and start, so no words were read; the same hold, limits and deposit as a WhatsApp booking follow"})
	return a.proceedToHold(b, nil, nil)
}

