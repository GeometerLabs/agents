package orders

// Saying things: agent.ts's "saying things" section over the shared say (internal/messaging say.go, the twin of modules/messaging/say.ts). What is Orders' own is given here: the
// facts a message is written from (order.ts factsFor, Settings.FactsFor), the offers (the menu's list, a day's slots, a few buttons, the owner's UPI buttons), the words (the
// generated templates of internal/orders/words: Render, the Meta template outside the 24-hour window, the outgoing check) and the gates ("confirmed" only when the record holds the
// whole advance, the licence's final stop, the chat's ping cap). Also the two ways out that are not WhatsApp: the owner's route (push.ts pushMessaging: WhatsApp, push or both) and
// a page conversation's outbox (channels/outbox.ts channelMessaging: kept for its page, never sent to the typed number).
//
// The owner's route and the outbox are internal/bookings' (agent_say.go, agent_channel.go), copied: a template may not import another (both belong in one shared place; Deferred.md).

import (
	"context"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// offer is agent.ts Offer: the menu's list ("items"), a day's slots ("slots", with the windows), a few buttons by their keys ("buttons": yes, no, cancel, cancelYes, keep, owner, paid,
// pickup, delivery), or the owner's UPI buttons ("owner_upi", each carrying its one-use code). body are the templates whose words sit above them (nil: the message's own). A kind
// "talk:<kind>" is the customer talk's reply with that menu under it (agent_talk.go).
type offer struct {
	kind    string
	windows []words.WindowRow
	buttons []string
	choices []words.Choice
	body    []string
}

func itemsOffer(body ...string) *offer { return &offer{kind: "items", body: body} }
func yesNo(body ...string) *offer {
	return &offer{kind: "buttons", buttons: []string{"yes", "no"}, body: body}
}

var cancelOrOwner = &offer{kind: "buttons", buttons: []string{"cancel", "owner"}}

// paidCancelOrOwner is agent.ts paidCancelOrOwner: a UPI shop's customer, while their advance waits, may also say "I have paid" (the owner is asked to look; nothing is marked).
var paidCancelOrOwner = &offer{kind: "buttons", buttons: []string{"paid", "cancel", "owner"}}

// waitingOffer is agent.ts waitingOffer.
func (a *Agent) waitingOffer() *offer {
	if a.ownerConfirms {
		return paidCancelOrOwner
	}
	return cancelOrOwner
}

// sayOpts is agent.ts More (SayArgs less the order, the number, the side and the templates). A nil pointer is a fact not given.
type sayOpts struct {
	refundInr *int64
	shown     []Decision
	action    string
	offer     *offer
	image     *messaging.SayImage // a UPI request's QR picture before the words (nil: the words carry the link, the UPI ID and the amount)
	upiCode   string              // the owner's one-use code (never in the record)
	markedInr *int64
	leftInr   *int64
	itemID    string
	leftCount *int64
	areas     bool
	link      string // the balance's own link (17 Nov 2026), not the advance's
	// facts are laid over the order's own (monthly plans: src/plans/flow.ts hands its plan facts in this way; G3's)
	facts func(f *words.MessageFacts)
}

// sayExtra is what say carries for this template (SayArgs.Extra): the order and the options, and a talk reply's words.
type sayExtra struct {
	order *Order
	o     sayOpts
	talk  *talkFacts
}

func extraOf(s *messaging.SayArgs) *sayExtra {
	if x, ok := s.Extra.(*sayExtra); ok {
		return x
	}
	return &sayExtra{}
}

func orderOf(v any) *Order {
	o, _ := v.(*Order)
	return o
}

func (a *Agent) sayArgs(o *Order, phone, to string, templates []string, opts sayOpts) *messaging.SayArgs {
	args := &messaging.SayArgs{Phone: phone, To: to, Templates: templates, Shown: opts.shown, Action: opts.action, Image: opts.image, Extra: &sayExtra{order: o, o: opts}}
	if o != nil {
		args.Booking = o
	}
	if opts.offer != nil {
		kind := opts.offer.kind
		if strings.HasPrefix(kind, "talk:") {
			kind = "talk" // conversation.ts: a talk reply's offer is `{kind: "talk"}`, whatever menu goes under it
		}
		args.Offer = &messaging.Offer{Kind: kind, Body: opts.offer.body}
	}
	return args
}

// tellCustomer is agent.ts tellCustomer: whether the message went out (read back from the messaging service). A failure of the send itself is in the record, never the step's.
func (a *Agent) tellCustomer(o *Order, phone string, templates []string, opts sayOpts) bool {
	went, err := a.say.Say(a.ctx, a.sayArgs(o, phone, "customer", templates, opts))
	return err == nil && went
}

// tellOwner is agent.ts tellOwner (and `say({booking: null, phone: owner, to: "owner", ...})`, which is the same call).
func (a *Agent) tellOwner(o *Order, phone, template string, opts sayOpts) bool {
	went, err := a.say.Say(a.ctx, a.sayArgs(o, phone, "owner", []string{template}, opts))
	return err == nil && went
}

// sayOutcome is say.outcome for one customer template: how the send ended (refunds.ts keeps a confirmation until WhatsApp accepts it).
func (a *Agent) sayOutcome(o *Order, phone, template string, opts sayOpts) string {
	out, err := a.say.Outcome(a.ctx, a.sayArgs(o, phone, "customer", []string{template}, opts))
	if err != nil {
		return messaging.NotSent
	}
	return out
}

// shownPhone is agent.ts shownPhone: a page order's number is the one its customer typed (never its "web:..." conversation); a chat guest is "Chat guest 3" to the owner.
func (a *Agent) shownPhone(phone string, o *Order) string {
	if o != nil && o.Channel != "" && o.Contact != nil {
		return o.Contact.Phone
	}
	if runtime.IsChatConversation(phone) {
		return a.store.guestLabel(phone, a.settings.Owner.Language)
	}
	return phone
}

// factsFor is say's factsFor: order.ts factsFor with agent.ts's extras, then the facts laid over them.
func (a *Agent) factsFor(sa *messaging.SayArgs, lang string) *words.MessageFacts {
	x := extraOf(sa)
	o := x.o
	shown := a.shownPhone(sa.Phone, x.order)
	now := a.now()
	ex := FactsExtra{CustomerPhone: &shown, RefundInr: o.refundInr, Menu: contains(sa.Templates, "menu") || (o.offer != nil && o.offer.kind == "items"), Areas: o.areas, ItemID: o.itemID,
		LeftCount: o.leftCount, UpiCode: o.upiCode, MarkedInr: o.markedInr, LeftInr: o.leftInr, NowMs: &now}
	if o.link != "" {
		ex.Link = &o.link
	}
	if o.offer != nil && o.offer.kind == "slots" {
		ex.SlotChoices = make([]words.Window, len(o.offer.windows))
		for i, w := range o.offer.windows {
			ex.SlotChoices[i] = words.Window{FromMs: w.FromMs, ToMs: w.ToMs}
		}
	}
	f := a.settings.FactsFor(x.order, lang, ex)
	if o.facts != nil {
		o.facts(f)
	}
	return f
}

func toChoices(cs []words.Choice) []messaging.Choice {
	out := make([]messaging.Choice, 0, len(cs))
	for _, c := range cs {
		ch := messaging.Choice{ID: c.ID, Title: c.Title}
		if c.Description != "" {
			d := c.Description
			ch.Description = &d
		}
		out = append(out, ch)
	}
	return out
}

// interactiveFor is agent.ts buildInteractive.
func (a *Agent) interactiveFor(sa *messaging.SayArgs, facts any, lang string) (*messaging.InteractiveMessage, error) {
	o := extraOf(sa).o.offer
	ids := o.body
	if ids == nil {
		ids = sa.Templates
	}
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		t, err := renderAny(id, facts)
		if err != nil {
			return nil, err
		}
		parts = append(parts, t)
	}
	m := &messaging.InteractiveMessage{Body: strings.Join(parts, " ")}
	switch strings.TrimPrefix(o.kind, "talk:") {
	case "items":
		l := words.ItemList(a.settings.WordsShop(), lang)
		m.List = &messaging.InteractiveList{Button: l.Button, Rows: toChoices(l.Rows)}
	case "slots":
		l := words.SlotList(o.windows, a.settings.Timezone, lang)
		m.List = &messaging.InteractiveList{Button: l.Button, Rows: toChoices(l.Rows)}
	case "owner_upi":
		m.Buttons = toChoices(o.choices)
	default:
		m.Buttons = toChoices(words.ButtonsFor(lang, o.buttons...))
	}
	return m, nil
}

// sayVoice is the Orders words for say (say.ts SayVoice): the generated templates, the Meta template a closed window needs, the outgoing check.
type sayVoice struct{}

func (sayVoice) Render(id string, facts any) (string, error) { return renderAny(id, facts) }

func (sayVoice) TemplateMessage(t messaging.TemplateArgs) (messaging.TemplateMessage, error) {
	f, ok := t.Facts.(*words.MessageFacts)
	if tf, isTalk := t.Facts.(*talkFacts); isTalk {
		f, ok = tf.MessageFacts, true
	}
	if !ok {
		return messaging.TemplateMessage{Name: t.Generic, Language: t.Language, Text: t.Text}, nil
	}
	m := words.MetaTemplateMessage(t.IDs, f, t.Text, t.Generic)
	return messaging.TemplateMessage{Name: m.Name, Language: m.Language, Text: m.Text, Parameters: m.Parameters}, nil
}

// GenericNames is agent.ts `{...TEMPLATE_NAMES, reminder: TEMPLATE_NAMES.customer}`: Orders' reminder goes out under the customer's generic name.
func (sayVoice) GenericNames() messaging.GenericNames {
	g := words.WordsFor("en").Generic
	return messaging.GenericNames{Customer: g.Customer, Reminder: g.Customer, Owner: g.Owner}
}

// Matches is limits.ts checkMessageMatchesRecord, word for word; a talk reply is read against the talk's own facts.
func (sayVoice) Matches(text string, facts any) messaging.Decision { return matchAny(text, facts) }

// stoppedGate is agent.ts stoppedGate (LICENCE_RULE): in the licence's final stop nothing more is sent from here.
var stoppedGate = Decision{RuleID: "subscription_suspended", Verdict: "block", Reason: "the shop's licence has reached its final stop, so nothing more is sent from here (the owner's one notice aside); the runtime's own check of the lease"}

// confirmedRefs is RecordView.confirmedRefs: the ref `key` of every confirmed line of this order and action (the step's own fresh lines included).
func (a *Agent) confirmedRefs(order, action, key string) []string {
	var out []string
	for _, e := range a.c.Rec.Entries() {
		if e.Booking != nil && *e.Booking == order && e.Action == action && e.Outcome == "confirmed" {
			if v, ok := e.Refs[key]; ok {
				out = append(out, v)
			}
		}
	}
	return out
}

func (a *Agent) sayDeps() messaging.SayDeps {
	return messaging.SayDeps{
		Messaging:  a.msg,
		Voice:      sayVoice{},
		Owner:      messaging.OwnerInfo{WhatsApp: a.owner(), Language: a.settings.Owner.Language},
		LanguageOf: func(phone string, o any) string { return a.languageOf(phone, orderOf(o)) },
		OptedOut:   func(phone string) bool { return a.store.Customer(phone).OptedOut },
		FactsFor: func(sa *messaging.SayArgs, lang string) (any, error) {
			f := a.factsFor(sa, lang)
			if t := extraOf(sa).talk; t != nil {
				t.MessageFacts = f
				return t, nil
			}
			return f, nil
		},
		InteractiveFor: func(sa *messaging.SayArgs, facts any, lang string) (*messaging.InteractiveMessage, error) {
			if extraOf(sa).o.offer == nil {
				return nil, nil
			}
			return a.interactiveFor(sa, facts, lang)
		},
		// never the owner's code
		InputsOf: func(sa *messaging.SayArgs) map[string]any {
			o := extraOf(sa).o
			out := map[string]any{}
			if o.refundInr != nil {
				out["refundInr"] = *o.refundInr
			}
			if o.markedInr != nil {
				out["markedInr"] = *o.markedInr
			}
			return out
		},
		Gates: func(sa *messaging.SayArgs, _ bool) []messaging.Decision {
			o := orderOf(sa.Booking)
			var gs []messaging.Decision
			if o != nil && (contains(sa.Templates, "order_confirmed") || contains(sa.Templates, "upi_order_confirmed")) {
				gs = append(gs, a.checkConfirmOnlyWhenRecorded(o.ID, advancePaise(o)))
			}
			if a.c.Licence() == "stopped" {
				gs = append(gs, stoppedGate)
			}
			// W1: what a chat guest may make the shop tell the owner is bounded per guest per day (chat.ts chatPingGate); the channel block is not touched otherwise
			if sa.To != "owner" || !runtime.IsChatConversation(sa.Phone) {
				return gs
			}
			if why := runtime.ChatPingBlock(a.store.ChannelState(), sa.To, sa.Phone, sa.Templates, a.now(), a.c.Clock.Day); why != "" {
				gs = append(gs, messaging.Decision{RuleID: "chat-pings-per-guest", Verdict: "block", Reason: why})
			}
			return gs
		},
		Log: func(o any, phone, action, outcome string, inputs map[string]any, more messaging.LogMore) {
			m := logMore{refs: more.Refs, language: more.Language, decisions: more.Decisions}
			if more.Notes != nil {
				m.notes = *more.Notes
			}
			a.log(orderOf(o), phone, action, outcome, inputs, m)
		},
		HeldBack: func(ctx context.Context, sa *messaging.SayArgs) error {
			a.say.Say(ctx, a.sayArgs(orderOf(sa.Booking), sa.Phone, "owner", []string{"owner_message_held"}, sayOpts{}))
			return nil
		},
		// W1: the chat marks the lines the record stands behind
		Moment: func(sa *messaging.SayArgs) string {
			if contains(sa.Templates, "upi_order_confirmed") || contains(sa.Templates, "balance_paid") {
				return "paid"
			}
			if contains(sa.Templates, "order_confirmed") {
				return "confirmed"
			}
			return ""
		},
		MarkMoment: func(id, moment string) { a.store.ChannelState().MarkMoment(id, moment) },
	}
}

// ---- the owner's route (modules/push/push.ts pushMessaging) ----------------------------------------------------------------------------------------------------------

// ownerMsg is the shop's messaging with the owner's alerts by their choice: base is the shop's WhatsApp (nil: the shop has none). A push stands in for a send: its id is "push-..."
// and GetMessage knows it, so the record says the alert went and names it by that id.
type ownerMsg struct {
	a    *Agent
	base messaging.Messaging
	sent map[string]messaging.OutboundMessage
}

func (a *Agent) ownerMessaging(base messaging.Messaging) messaging.Messaging {
	o := &ownerMsg{a: a, base: base, sent: map[string]messaging.OutboundMessage{}}
	_, inter := base.(messaging.Interactive)
	if inter || (base == nil && a.kit.Ports.PushOwner != nil) {
		if img, ok := base.(messaging.Images); ok {
			return ownerImages{ownerInteractive{o}, img}
		}
		return ownerInteractive{o}
	}
	return o
}

func noWhatsApp() error {
	return &guard.ApiError{Status: 400, Message: "This shop has no WhatsApp number, and the owner has no phone with alerts on, so nothing was sent; the owner's app shows what waits for them."}
}

func (o *ownerMsg) isOwner(to string) bool { return digitsOf(to) == digitsOf(o.a.owner()) }

func (o *ownerMsg) route() string {
	if o.a.kit.Ports.OwnerRoute == nil {
		if o.base != nil {
			return "whatsapp"
		}
		return "none"
	}
	return o.a.kit.Ports.OwnerRoute(o.base != nil)
}

func (o *ownerMsg) toOwner(to, kind, text string, viaWhatsApp func() (messaging.OutboundMessage, error)) (messaging.OutboundMessage, error) {
	route := o.route()
	var ids []string
	if (route == "push" || route == "both") && o.a.kit.Ports.PushOwner != nil {
		ids = o.a.kit.Ports.PushOwner(text)
	}
	if (route == "whatsapp" || route == "both") && viaWhatsApp != nil {
		m, err := viaWhatsApp()
		if err == nil || len(ids) == 0 {
			return m, err
		}
	}
	if len(ids) > 0 {
		push := "push"
		m := messaging.OutboundMessage{ID: "push-" + ids[0], To: to, Kind: kind, Text: text, SentAt: o.a.now(), AcceptedAs: &push}
		o.sent[m.ID] = m
		return m, nil
	}
	if o.base != nil && viaWhatsApp != nil {
		return viaWhatsApp()
	}
	return messaging.OutboundMessage{}, noWhatsApp()
}

func (o *ownerMsg) SendText(ctx context.Context, to, text string) (messaging.OutboundMessage, error) {
	if o.isOwner(to) {
		var via func() (messaging.OutboundMessage, error)
		if o.base != nil {
			via = func() (messaging.OutboundMessage, error) { return o.base.SendText(ctx, to, text) }
		}
		return o.toOwner(to, "text", text, via)
	}
	if o.base == nil {
		return messaging.OutboundMessage{}, noWhatsApp()
	}
	return o.base.SendText(ctx, to, text)
}

func (o *ownerMsg) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	if o.isOwner(to) {
		var via func() (messaging.OutboundMessage, error)
		if o.base != nil {
			via = func() (messaging.OutboundMessage, error) { return o.base.SendTemplate(ctx, to, t) }
		}
		return o.toOwner(to, "template", t.Text, via)
	}
	if o.base == nil {
		return messaging.OutboundMessage{}, noWhatsApp()
	}
	return o.base.SendTemplate(ctx, to, t)
}

func (o *ownerMsg) IsWindowOpen(ctx context.Context, to string) (bool, error) {
	if o.isOwner(to) && o.route() == "push" {
		return true, nil // free text is what a push carries; no template is needed
	}
	if o.base == nil {
		return false, nil
	}
	return o.base.IsWindowOpen(ctx, to)
}

func (o *ownerMsg) GetMessage(ctx context.Context, id string) (*messaging.OutboundMessage, error) {
	if strings.HasPrefix(id, "push-") {
		if m, ok := o.sent[id]; ok {
			return &m, nil
		}
		return nil, nil
	}
	if o.base == nil {
		return nil, nil
	}
	return o.base.GetMessage(ctx, id)
}

type ownerInteractive struct{ *ownerMsg }

func (o ownerInteractive) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	inter, has := o.base.(messaging.Interactive)
	if o.isOwner(to) {
		var via func() (messaging.OutboundMessage, error)
		switch {
		case has:
			via = func() (messaging.OutboundMessage, error) { return inter.SendInteractive(ctx, to, m) }
		case o.base != nil:
			via = func() (messaging.OutboundMessage, error) { return o.base.SendText(ctx, to, m.Body) }
		}
		return o.toOwner(to, "interactive", m.Body, via)
	}
	if o.base == nil {
		return messaging.OutboundMessage{}, noWhatsApp()
	}
	if !has {
		return messaging.OutboundMessage{}, &guard.ApiError{Status: 400, Message: "This WhatsApp provider has no buttons."}
	}
	return inter.SendInteractive(ctx, to, m)
}

// ownerImages keeps a provider's pictures (a UPI request's QR code goes to the customer as an image message); a picture is never the owner's, so it goes straight to the provider.
type ownerImages struct {
	ownerInteractive
	img messaging.Images
}

func (o ownerImages) SendImage(ctx context.Context, to string, m messaging.ImageMessage) (messaging.OutboundMessage, error) {
	return o.img.SendImage(ctx, to, m)
}

// ---- outbox.ts channelMessaging: a message to a page's conversation is kept for its page, never sent to the typed number ---------------------------------------------

type chanMsg struct {
	a    *Agent
	base messaging.Messaging
}

// channelMessaging wraps the shop's messaging so a page conversation's message is kept in the channel block's outbox. A picture to a page conversation is never made (agent.ts sends
// none for a page order: its page draws its own QR code), so the outbox has no SendImage of its own; a WhatsApp customer's picture goes to the provider.
func (a *Agent) channelMessaging(base messaging.Messaging) messaging.Messaging {
	c := chanInteractive{&chanMsg{a, base}}
	if img, ok := base.(messaging.Images); ok {
		return chanImages{c, img}
	}
	return c
}

func (c *chanMsg) keep(to, kind, text string, choices []runtime.ChatChoice) messaging.OutboundMessage {
	m := c.a.store.ChannelState().Keep(to, text, choices, c.a.now())
	return messaging.OutboundMessage{ID: m.ID, To: to, Kind: kind, Text: text, SentAt: m.AtMs}
}

func noChannelWhatsApp() error {
	return &guard.ApiError{Status: 400, Message: "This shop has no WhatsApp number yet, so nothing was sent; the owner's page shows what waits for them."}
}

func (c *chanMsg) SendText(ctx context.Context, to, text string) (messaging.OutboundMessage, error) {
	if runtime.IsChannelConversation(to) {
		return c.keep(to, "text", text, nil), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChannelWhatsApp()
	}
	return c.base.SendText(ctx, to, text)
}

func (c *chanMsg) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (messaging.OutboundMessage, error) {
	if runtime.IsChannelConversation(to) {
		return c.keep(to, "text", t.Text, nil), nil
	}
	if c.base == nil {
		return messaging.OutboundMessage{}, noChannelWhatsApp()
	}
	return c.base.SendTemplate(ctx, to, t)
}

func (c *chanMsg) IsWindowOpen(ctx context.Context, to string) (bool, error) {
	if runtime.IsChannelConversation(to) {
		return true, nil
	}
	if c.base == nil {
		return false, nil
	}
	return c.base.IsWindowOpen(ctx, to)
}

func (c *chanMsg) GetMessage(ctx context.Context, id string) (*messaging.OutboundMessage, error) {
	if strings.HasPrefix(id, "ch-") {
		for _, m := range c.a.store.ChannelState().Outbox {
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

// SendInteractive: buttons and lists are WhatsApp's; an order's page has its own, so only the words above them are kept; a chat thread keeps the choices too (outbox.ts choicesOf).
func (c chanInteractive) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (messaging.OutboundMessage, error) {
	if runtime.IsChannelConversation(to) {
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

type chanImages struct {
	chanInteractive
	img messaging.Images
}

func (c chanImages) SendImage(ctx context.Context, to string, m messaging.ImageMessage) (messaging.OutboundMessage, error) {
	return c.img.SendImage(ctx, to, m)
}

// ---- a talk reply through say's voice --------------------------------------------------------------------------------------------------------------------------------

// talkFacts are the facts of a talk reply: the words were written by the model and checked by the runtime, and the outgoing check reads them against Check.
type talkFacts struct {
	*words.MessageFacts
	Text  string
	Check language.Facts
}

func renderAny(id string, facts any) (string, error) {
	if t, ok := facts.(*talkFacts); ok {
		if id == "assistant_talk" {
			return t.Text, nil
		}
		return words.Render(id, t.MessageFacts)
	}
	return words.Render(id, facts.(*words.MessageFacts))
}

func matchAny(text string, facts any) messaging.Decision {
	if t, ok := facts.(*talkFacts); ok {
		problems := language.CheckText(text, t.Check)
		if len(problems) == 0 {
			return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount, date, time and link in the message is in the record."}
		}
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: "The message does not match the record. " + strings.Join(problems, " ")}
	}
	return words.MatchesRecord(text, facts.(*words.MessageFacts))
}
