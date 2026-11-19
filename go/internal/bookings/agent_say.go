package bookings

// Saying things: agent.ts's "saying things" section over the shared say (go/internal/messaging say.go, the twin of modules/messaging/say.ts). What is Bookings' own is given here:
// the facts a message is written from (booking.ts factsFor), the offers (buttons or a list under the words), the words themselves (the generated templates: Render, the Meta
// template a closed window needs, the outgoing check) and the two gates (no reminder after a cancellation or a STOP, "booked" only when the record holds the calendar AND the
// deposit). Also the owner's route (modules/push/push.ts pushMessaging: the owner's messages by WhatsApp, push or both, push alone for a shop with no WhatsApp).

import (
	"context"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

func detectLanguage(text string) string { return understanding.DetectLanguage(text) }

// offer is agent.ts Offer: the shop's services, free times, a few buttons (by their keys: "yes", "no", "cancel", "owner", "cancelYes", "keep", "paid"); body are the templates whose
// words sit above them (nil: the message's own).
type offer struct {
	kind    string // services, slots, buttons
	slots   []int64
	buttons []string
	body    []string
}

func servicesOffer(body ...string) *offer { return &offer{kind: "services", body: body} }
func yesNo(body ...string) *offer         { return &offer{kind: "buttons", buttons: []string{"yes", "no"}, body: body} }

var cancelOrOwner = &offer{kind: "buttons", buttons: []string{"cancel", "owner"}}

// sayExtra is SayArgs' Bookings members (agent.ts SayArgs): an amount, a time, a reminder's flag, a page link (never in the record).
type sayExtra struct {
	booking     *Booking
	offer       *offer
	refundInr   *int64
	slotMs      *int64
	day         string
	dayBookings []DayBooking
	pageLink    string
}

// sayOpts is tellCustomer's `more`.
type sayOpts struct {
	refundInr *int64
	slotMs    *int64
	shown     []Decision
	reminder  bool
	action    string
	offer     *offer
	pageLink  string
}

func toMsgDecisions(ds []Decision) []messaging.Decision {
	if ds == nil {
		return nil
	}
	out := make([]messaging.Decision, len(ds))
	for i, d := range ds {
		out[i] = messaging.Decision(d)
	}
	return out
}

func (a *Agent) sayArgs(b *Booking, phone, to string, templates []string, o sayOpts) *messaging.SayArgs {
	x := &sayExtra{booking: b, offer: o.offer, refundInr: o.refundInr, slotMs: o.slotMs, pageLink: o.pageLink}
	args := &messaging.SayArgs{Phone: phone, To: to, Templates: templates, Shown: toMsgDecisions(o.shown), Reminder: o.reminder, Action: o.action, Extra: x}
	if b != nil {
		args.Booking = b
	}
	if o.offer != nil {
		args.Offer = &messaging.Offer{Kind: o.offer.kind, Body: o.offer.body}
	}
	return args
}

// tellCustomer is agent.ts tellCustomer: whether the message went out (read back from the messaging service). A failure of the send itself is in the record, never the step's.
func (a *Agent) tellCustomer(b *Booking, phone string, templates []string, o sayOpts) bool {
	went, err := a.say.Say(a.ctx, a.sayArgs(b, phone, "customer", templates, o))
	return err == nil && went
}

// tellOwner is agent.ts tellOwner.
func (a *Agent) tellOwner(b *Booking, phone, template string, o sayOpts) bool {
	went, err := a.say.Say(a.ctx, a.sayArgs(b, phone, "owner", []string{template}, o))
	return err == nil && went
}

// sayOwner is `say({booking: null, phone: owner, to: "owner", ...})`.
func (a *Agent) sayOwner(templates []string, x sayExtra, action string) bool {
	args := &messaging.SayArgs{Phone: a.owner(), To: "owner", Templates: templates, Action: action, Extra: &x}
	went, err := a.say.Say(a.ctx, args)
	return err == nil && went
}

func extraOf(s *messaging.SayArgs) *sayExtra {
	if x, ok := s.Extra.(*sayExtra); ok {
		return x
	}
	return &sayExtra{}
}

func bookingOf(v any) *Booking {
	b, _ := v.(*Booking)
	return b
}

// shownPhone is agent.ts shownPhone: a channel booking's number is the one its customer typed, never its "web:..." conversation. (A chat guest's label is the chat stream's.)
func (a *Agent) shownPhone(phone string, b *Booking) string {
	if b != nil && b.Channel != "" && b.Contact != nil {
		return b.Contact.Phone
	}
	return phone
}

// factsFor is booking.ts factsFor with agent.ts's extras.
func (a *Agent) factsFor(sa *messaging.SayArgs, lang string) *MessageFacts {
	s := a.settings
	x := extraOf(sa)
	b := x.booking
	var sv *Service
	if b != nil && b.ServiceID != "" {
		sv = s.ServiceByID(b.ServiceID)
	}
	f := &MessageFacts{Language: lang, Loc: s.Loc, BusinessName: s.Name}
	menu := contains(sa.Templates, "menu") || (x.offer != nil && x.offer.kind == "services")
	// only the menu may state every service's price; any other message may state this booking's own service and nothing else
	if menu {
		for i := range s.Services {
			f.Services = append(f.Services, ServicePrice{ServiceName(&s.Services[i], lang), s.Services[i].PriceInr})
		}
	} else if sv != nil {
		f.Services = []ServicePrice{{ServiceName(sv, lang), sv.PriceInr}}
	}
	if sv != nil {
		f.ServiceName, f.PriceInr = S(ServiceName(sv, lang)), N(sv.PriceInr)
	}
	f.DepositInr = N(s.Deposit.AmountInr)
	if b != nil && b.DepositInr != nil {
		f.DepositInr = N(*b.DepositInr)
	}
	f.RefundInr = x.refundInr
	f.SlotMs = x.slotMs
	if f.SlotMs == nil && b != nil && b.StartMs != nil {
		f.SlotMs = N(*b.StartMs)
	}
	if x.offer != nil && x.offer.kind == "slots" {
		f.SlotChoices = x.offer.slots
	}
	if b != nil && b.LinkURL != "" {
		f.Link = S(b.LinkURL)
	}
	f.HoldMinutes, f.WindowHours = N(s.Deposit.HoldMinutes), N(s.Cancellation.WindowHours)
	if b != nil && b.ID != "" {
		f.BookingRef = S(b.ID)
	}
	if p := a.shownPhone(sa.Phone, b); p != "" {
		f.CustomerPhone = S(p)
	}
	if s.OwnerMarked() {
		f.UpiID, f.Payee = S(s.Payment.UpiID), S(s.Payment.Payee)
	}
	if x.day != "" {
		f.Day, f.DayBookings = x.day, x.dayBookings
		if f.DayBookings == nil {
			f.DayBookings = []DayBooking{}
		}
	}
	if x.pageLink != "" {
		f.PageLink = S(x.pageLink)
	}
	return f
}

// interactiveFor is agent.ts buildInteractive.
func (a *Agent) interactiveFor(sa *messaging.SayArgs, facts *MessageFacts, lang string) (*messaging.InteractiveMessage, error) {
	o := extraOf(sa).offer
	ids := o.body
	if ids == nil {
		ids = sa.Templates
	}
	var parts []string
	for _, id := range ids {
		t, err := Render(id, facts)
		if err != nil {
			return nil, err
		}
		parts = append(parts, t)
	}
	m := &messaging.InteractiveMessage{Body: strings.Join(parts, " ")}
	conv := func(cs []Choice) []messaging.Choice {
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
	switch o.kind {
	case "services":
		l := ServiceList(a.settings, lang)
		m.List = &messaging.InteractiveList{Button: l.Button, Rows: conv(l.Rows)}
	case "slots":
		l := SlotList(o.slots, a.settings.Loc, lang)
		m.List = &messaging.InteractiveList{Button: l.Button, Rows: conv(l.Rows)}
	default:
		m.Buttons = conv(ButtonsFor(lang, o.buttons...))
	}
	return m, nil
}

// voice is the Bookings words for say (say.ts SayVoice): the generated templates, the Meta template a closed window needs, the outgoing check.
type voice struct{}

func (voice) Render(id string, facts any) (string, error) { return Render(id, facts.(*MessageFacts)) }
func (voice) TemplateMessage(t messaging.TemplateArgs) (messaging.TemplateMessage, error) {
	m := MetaTemplateMessage(t.IDs, t.Facts.(*MessageFacts), t.Text, t.Generic)
	return messaging.TemplateMessage{Name: m.Name, Language: m.Language, Text: m.Text, Parameters: m.Parameters}, nil
}
func (voice) GenericNames() messaging.GenericNames {
	g := WordsFor("en").Generic
	return messaging.GenericNames{Customer: g.Customer, Reminder: g.Reminder, Owner: g.Owner}
}

// Matches is limits.ts checkMessageMatchesRecord (checkRecordMatch over check.ts checkFactsOf), word for word.
func (voice) Matches(text string, facts any) messaging.Decision {
	problems := CheckMessage(text, facts.(*MessageFacts))
	if len(problems) == 0 {
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount, date, time and link in the message is in the record."}
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: "The message does not match the record. " + strings.Join(problems, " ")}
}

// stoppedGate is agent.ts stoppedGate: in the licence's final stop nothing more is sent from here.
var stoppedGate = Decision{"subscription_suspended", "block", "the shop's licence has reached its final stop, so nothing more is sent from here (the owner's one notice aside); the runtime's own check of the lease"}

// checkConfirmOnlyWhenRecorded is limits.ts checkConfirmOnlyWhenRecorded over the record (a gateway shop: the deposit is a confirmed record_deposit line).
func (a *Agent) checkConfirmOnlyWhenRecorded(booking string) Decision {
	calendarShown, deposit := a.isConfirmed(booking, "confirm_booking"), a.isConfirmed(booking, "record_deposit")
	if calendarShown && deposit {
		return allow("confirm-only-when-recorded", "The calendar shows the booking and the payment record shows the deposit.")
	}
	var missing []string
	if !calendarShown {
		missing = append(missing, "the calendar does not show the booking")
	}
	if !deposit {
		missing = append(missing, "no deposit is recorded")
	}
	return block("confirm-only-when-recorded", "Not booked yet: "+strings.Join(missing, " and ")+".")
}

// isConfirmed is record.ts RecordView.isConfirmed: a line of this booking and action whose outcome is confirmed (the step's own fresh lines included).
func (a *Agent) isConfirmed(booking, action string) bool {
	for _, e := range a.c.Rec.Entries() {
		if e.Booking != nil && *e.Booking == booking && e.Action == action && e.Outcome == "confirmed" {
			return true
		}
	}
	return false
}

// confirmedRefs is RecordView.confirmedRefs: the ref `key` of every confirmed line of this booking and action.
func (a *Agent) confirmedRefs(booking, action, key string) []string {
	var out []string
	for _, e := range a.c.Rec.Entries() {
		if e.Booking != nil && *e.Booking == booking && e.Action == action && e.Outcome == "confirmed" {
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
		Voice:      voice{},
		Owner:      messaging.OwnerInfo{WhatsApp: a.owner(), Language: a.settings.Owner.Language},
		LanguageOf: func(phone string, b any) string { return a.languageOf(phone, bookingOf(b)) },
		OptedOut:   func(phone string) bool { return a.store.Customer(phone).OptedOut },
		FactsFor:   func(sa *messaging.SayArgs, lang string) (any, error) { return a.factsFor(sa, lang), nil },
		InteractiveFor: func(sa *messaging.SayArgs, facts any, lang string) (*messaging.InteractiveMessage, error) {
			if extraOf(sa).offer == nil {
				return nil, nil
			}
			return a.interactiveFor(sa, facts.(*MessageFacts), lang)
		},
		InputsOf: func(sa *messaging.SayArgs) map[string]any {
			x := extraOf(sa)
			// never the page link nor the owner's code: they are never in the record
			out := map[string]any{}
			if x.refundInr != nil {
				out["refundInr"] = *x.refundInr
			}
			if x.slotMs != nil {
				out["slotMs"] = *x.slotMs
			}
			return out
		},
		Gates: func(sa *messaging.SayArgs, optedOut bool) []messaging.Decision {
			b := bookingOf(sa.Booking)
			var gs []messaging.Decision
			if sa.To == "customer" && sa.Reminder {
				gs = append(gs, messaging.Decision(CheckNoMessageAfterStop(true, b != nil && b.State == Confirmed, optedOut)))
			}
			if b != nil && (contains(sa.Templates, "booked") || contains(sa.Templates, "upi_booked")) {
				gs = append(gs, messaging.Decision(a.checkConfirmOnlyWhenRecorded(b.ID)))
			}
			if a.c.Licence() == "stopped" {
				gs = append(gs, messaging.Decision(stoppedGate))
			}
			// TODO(go-bk-chat-19nov): chatPingGate (what a chat guest may make the shop tell the owner is bounded per guest per day) is the chat's
			return gs
		},
		Log: func(booking any, phone, action, outcome string, inputs map[string]any, more messaging.LogMore) {
			m := logMore{refs: more.Refs, language: more.Language}
			if more.Notes != nil {
				m.notes = *more.Notes
			}
			for _, d := range more.Decisions {
				m.decisions = append(m.decisions, Decision(d))
			}
			a.log(bookingOf(booking), phone, action, outcome, inputs, m)
		},
		HeldBack: func(ctx context.Context, sa *messaging.SayArgs) error {
			a.say.Say(ctx, &messaging.SayArgs{Booking: sa.Booking, Phone: sa.Phone, To: "owner", Templates: []string{"owner_message_held"}, Extra: &sayExtra{booking: bookingOf(sa.Booking)}})
			return nil
		},
		Moment: func(sa *messaging.SayArgs) string {
			if contains(sa.Templates, "upi_booked") {
				return "paid"
			}
			if contains(sa.Templates, "booked") {
				return "confirmed"
			}
			return ""
		},
		MarkMoment: func(id, moment string) { a.store.chanState().markMoment(id, moment) },
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
		return ownerInteractive{o}
	}
	return o
}

func noWhatsApp() error {
	return &guard.ApiError{Status: 400, Message: "This shop has no WhatsApp number, and the owner has no phone with alerts on, so nothing was sent; the owner's app shows what waits for them."}
}

func (o *ownerMsg) isOwner(to string) bool { return sameNumber(to, o.a.owner()) }

// sameNumber is push.ts sameNumber: the digits of two numbers are the same.
func sameNumber(x, y string) bool { return digitsOf(x) == digitsOf(y) }

func digitsOf(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

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
