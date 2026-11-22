package fees

// Saying things: agent.ts's "saying things" section over the shared say (internal/messaging say.go). What is Fees' own is given here: the facts a message is written from
// (due.ts factsFor), the buttons (interactive.ts buttonsFor, the owner's UPI buttons), the words (the generated templates, the Meta template a closed window needs, the outgoing
// check) and the gates (no reminder once the record shows the fee paid, the month's cap, "received" only when the record holds the money, the licence's final stop).

import (
	"context"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

func detectLanguage(text string) string { return understanding.DetectLanguage(text) }

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// offer is agent.ts Offer: buttons by their keys ("pay", "paid", "owner", "yes", "no") about one fee, words above them (nil: the message's own), or the owner's UPI choices.
type offer struct {
	buttons []string
	dueID   string
	body    []string
	choices []messaging.Choice
}

func feeButtons(d *Due, buttons ...string) *offer {
	if len(buttons) == 0 {
		buttons = []string{"pay", "paid", "owner"}
	}
	return &offer{buttons: buttons, dueID: d.ID}
}

var ownerButton = &offer{buttons: []string{"owner"}}

// sayOpts is agent.ts SayArgs' Fees members.
type sayOpts struct {
	family                                     []FamilyLine
	receivedInr, waiverInr, refundInr, paidInr *int64
	requestRef, upiCode, pageLink              string
	shown                                      []Decision
	reminder, readOK                           bool
	action                                     string
	offer                                      *offer
	image                                      *messaging.SayImage
	cls                                        *classFacts
	gate                                       []Decision
	phoneShown                                 string // the label a chat guest is named by in the owner's message (chat-guest.ts guestLabel)
}

type sayExtra struct {
	due *Due
	o   sayOpts
}

func extraOf(s *messaging.SayArgs) *sayExtra {
	if x, ok := s.Extra.(*sayExtra); ok {
		return x
	}
	return &sayExtra{}
}

func dueOf(v any) *Due {
	d, _ := v.(*Due)
	return d
}

func (a *Agent) args(d *Due, phone, to string, templates []string, o sayOpts) *messaging.SayArgs {
	args := &messaging.SayArgs{Phone: phone, To: to, Templates: templates, Shown: o.shown, Reminder: o.reminder, Action: o.action, Image: o.image, Extra: &sayExtra{due: d, o: o}}
	if d != nil {
		args.Booking = d
	}
	if o.offer != nil {
		args.Offer = &messaging.Offer{Kind: "buttons", Body: o.offer.body}
	}
	return args
}

// tellCustomer is agent.ts tellCustomer: whether the message went out (read back). A failure of the send itself is in the record, never the step's.
func (a *Agent) tellCustomer(d *Due, phone string, templates []string, o sayOpts) bool {
	went, err := a.say.Say(a.ctx, a.args(d, phone, "customer", templates, o))
	return err == nil && went
}

// tellCustomerOutcome is say.outcome to a parent.
func (a *Agent) tellCustomerOutcome(d *Due, phone, template string, o sayOpts) string {
	out, err := a.say.Outcome(a.ctx, a.args(d, phone, "customer", []string{template}, o))
	if err != nil {
		return "not_sent"
	}
	return string(out)
}

// tellOwner is agent.ts tellOwner: about this parent's fee, to the owner.
func (a *Agent) tellOwner(d *Due, phone, template string, o sayOpts) bool {
	went, err := a.say.Say(a.ctx, a.args(d, phone, "owner", []string{template}, o))
	return err == nil && went
}

// sayOwner is `say({booking: null, phone: owner, to: "owner", ...})`.
func (a *Agent) sayOwner(template string, o sayOpts) bool {
	went, err := a.say.Say(a.ctx, a.args(nil, a.owner(), "owner", []string{template}, o))
	return err == nil && went
}

// factsFor is due.ts factsFor with agent.ts's extras.
func (a *Agent) factsFor(sa *messaging.SayArgs, lang string) *MessageFacts {
	s := a.settings
	x := extraOf(sa)
	d := x.due
	f := &MessageFacts{Language: lang, Loc: s.Loc, BusinessName: s.Name}
	if d != nil {
		f.StudentName = S(d.StudentName)
		if b := s.BatchByID(d.BatchID); b != nil {
			f.BatchName = S(BatchName(b, lang))
		}
		f.MonthLabel = S(monthLabel(d.Month, lang))
		f.FeeInr = N(d.FeeInr)
		if d.LateFeeInr > 0 {
			f.LateFeeInr = N(d.LateFeeInr)
		}
		f.BalanceInr = N(balanceInr(d))
		f.DueMs = N(d.DueMs)
		f.DueRef = S(d.ID)
		f.CustomerPhone = S(d.Customer)
		for _, l := range d.Links {
			if l.ID == d.CurrentLinkID {
				f.Link = S(l.URL)
			}
		}
	}
	if x.o.paidInr != nil {
		f.PaidInr = x.o.paidInr
	} else if d != nil {
		f.PaidInr = N(paidPaise(d) / 100)
	}
	f.ReceivedInr, f.WaiverInr, f.RefundInr = x.o.receivedInr, x.o.waiverInr, x.o.refundInr
	f.WaiverLimit = N(s.WaiverLimitInr)
	f.GraceDays = N(s.Due.GraceDays)
	if x.o.requestRef != "" {
		f.RequestRef = S(x.o.requestRef)
	}
	// customerPhone: due.ts factsFor's `extra.customerPhone`, which agent.ts always gives: the number (or a chat's conversation) the message is about; a chat guest's
	// label (chat-guest.ts guestLabel) is not ported for any template yet (Deferred.md)
	switch {
	case x.o.phoneShown != "":
		f.CustomerPhone = S(x.o.phoneShown)
	default:
		f.CustomerPhone = S(sa.Phone)
	}
	if s.OwnerMarked() {
		f.UpiID, f.Payee = S(s.Payment.UpiID), S(s.Payment.Payee)
	}
	if x.o.upiCode != "" {
		f.UpiCode = S(x.o.upiCode)
	}
	if x.o.family != nil {
		f.Family, f.HasFamily = x.o.family, true
	}
	if x.o.pageLink != "" && sa.To == "customer" {
		f.PageLink = S(x.o.pageLink)
	}
	if x.o.cls != nil {
		x.o.cls.apply(f)
	}
	return f
}

// buttonsFor is interactive.ts buttonsFor: the named buttons in the language, about one fee.
func buttonsFor(lang string, ids []string, dueID string) []messaging.Choice {
	w := WordsFor(lang)
	max := bookings.WordsFor("en").Limits.ButtonTitle
	out := make([]messaging.Choice, 0, len(ids))
	for _, id := range ids {
		cid := id
		if (id == "pay" || id == "paid") && dueID != "" {
			cid = id + ":" + dueID
		}
		out = append(out, messaging.Choice{ID: cid, Title: bookings.Clip(w.Labels[id], max)})
	}
	return out
}

// markChoices is owner-marked/buttons.ts ownerMarkChoices with Fees' labels: "Received ₹1,500" carrying the one-use code, or "Refund sent".
func markChoices(lang, kind, code string, amountInr float64) []messaging.Choice {
	w := WordsFor(lang)
	max := bookings.WordsFor("en").Limits.ButtonTitle
	if kind == "received" {
		return []messaging.Choice{{ID: ownermarked.MarkButtonID(ownermarked.ReplyReceived, code), Title: bookings.Clip(w.Labels["received"]+" "+language.FormatInr(amountInr), max)}}
	}
	return []messaging.Choice{{ID: ownermarked.MarkButtonID(ownermarked.ReplyRefunded, code), Title: bookings.Clip(w.Labels["refundSent"], max)}}
}

// stoppedGate is agent.ts stoppedGate.
var stoppedGate = Decision{RuleID: "subscription_suspended", Verdict: "block", Reason: "the centre's licence has reached its final stop, so nothing more is sent from here (the owner's one notice aside); the runtime's own check of the lease"}

// voice is the Fees words for say.
type voice struct{}

func (voice) Render(id string, facts any) (string, error) { return Render(id, facts.(*MessageFacts)) }
func (voice) TemplateMessage(t messaging.TemplateArgs) (messaging.TemplateMessage, error) {
	f, ok := t.Facts.(*MessageFacts)
	if !ok {
		return messaging.TemplateMessage{Name: t.Generic, Language: t.Language, Text: t.Text}, nil
	}
	return templateMessage(t.IDs, f, t.Text, t.Generic), nil
}
func (voice) GenericNames() messaging.GenericNames {
	g := WordsFor("en").Generic
	return messaging.GenericNames{Customer: g.Customer, Reminder: g.Reminder, Owner: g.Owner}
}
func (voice) Matches(text string, facts any) messaging.Decision {
	return matches(text, facts.(*MessageFacts))
}

func (a *Agent) sayDeps() messaging.SayDeps {
	return messaging.SayDeps{
		Messaging:  a.msg,
		Voice:      voice{},
		Owner:      messaging.OwnerInfo{WhatsApp: a.owner(), Language: a.settings.Owner.Language},
		LanguageOf: func(phone string, d any) string { return a.languageOf(phone, dueOf(d)) },
		OptedOut:   func(phone string) bool { return a.store.Customer(phone).OptedOut },
		FactsFor:   func(sa *messaging.SayArgs, lang string) (any, error) { return a.factsFor(sa, lang), nil },
		InteractiveFor: func(sa *messaging.SayArgs, facts any, lang string) (*messaging.InteractiveMessage, error) {
			o := extraOf(sa).o.offer
			if o == nil {
				return nil, nil
			}
			ids := o.body
			if ids == nil {
				ids = sa.Templates
			}
			parts := make([]string, 0, len(ids))
			for _, id := range ids {
				t, err := Render(id, facts.(*MessageFacts))
				if err != nil {
					return nil, err
				}
				parts = append(parts, t)
			}
			m := &messaging.InteractiveMessage{Body: strings.Join(parts, " ")}
			if o.choices != nil {
				m.Buttons = o.choices
			} else {
				m.Buttons = buttonsFor(lang, o.buttons, o.dueID)
			}
			return m, nil
		},
		InputsOf: func(sa *messaging.SayArgs) map[string]any {
			x := extraOf(sa).o
			out := map[string]any{}
			if x.family != nil {
				refs := make([]string, len(x.family))
				for i, l := range x.family {
					refs[i] = l.DueRef
				}
				out["family"] = refs
			}
			for k, v := range map[string]*int64{"refundInr": x.refundInr, "receivedInr": x.receivedInr, "waiverInr": x.waiverInr} {
				if v != nil {
					out[k] = *v
				}
			}
			if x.requestRef != "" {
				out["requestRef"] = x.requestRef
			}
			return out
		},
		Gates: func(sa *messaging.SayArgs, optedOut bool) []messaging.Decision {
			d := dueOf(sa.Booking)
			x := extraOf(sa).o
			var out []messaging.Decision
			if sa.To == "customer" && sa.Reminder && d != nil {
				out = append(out, a.checkNoReminderOncePaid(d, x.readOK), checkReminderCap(d.RemindersSent, a.settings.Reminders.MaxPerMonth))
			}
			if d != nil && (contains(sa.Templates, "fee_received") || contains(sa.Templates, "fee_already_paid")) {
				out = append(out, a.checkPaidOnlyWhenRecorded(d, true))
			}
			if d != nil && contains(sa.Templates, "fee_part_received") {
				out = append(out, a.checkPaidOnlyWhenRecorded(d, false))
			}
			out = append(out, x.gate...)
			if a.c.Licence() == "stopped" {
				out = append(out, stoppedGate)
			}
			if sa.To == "owner" && runtime.IsChatConversation(sa.Phone) {
				if why := runtime.ChatPingBlock(a.store.chanState(), sa.To, sa.Phone, sa.Templates, a.now(), a.c.Clock.Day); why != "" {
					out = append(out, messaging.Decision{RuleID: "chat-pings-per-guest", Verdict: "block", Reason: why})
				}
			}
			return out
		},
		Log: func(booking any, phone, action, outcome string, inputs map[string]any, more messaging.LogMore) {
			m := logMore{refs: more.Refs, language: more.Language, decisions: more.Decisions}
			if more.Notes != nil {
				m.notes = *more.Notes
			}
			a.log(dueOf(booking), phone, action, outcome, inputs, m)
		},
		HeldBack: func(ctx context.Context, sa *messaging.SayArgs) error {
			a.say.Say(ctx, &messaging.SayArgs{Booking: sa.Booking, Phone: sa.Phone, To: "owner", Templates: []string{"owner_message_held"}, Extra: &sayExtra{due: dueOf(sa.Booking)}})
			return nil
		},
		Moment:     func(*messaging.SayArgs) string { return "" },
		MarkMoment: func(string, string) {},
	}
}
