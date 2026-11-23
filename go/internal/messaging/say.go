// The one way a message leaves an agent, for every template (say.ts): it renders the templates from the record, runs the limits on the final text, sends only if none blocks, and reads
// the message back from the messaging service. Say returns whether the message went out; Outcome sends the same way and says how it ended (SaidOutcome), for the one message kept
// until it reaches the customer (a refund confirmed after an unknown outcome).
//
// What a template gives this file (SayDeps): its words (Voice), the facts those words are written from (FactsFor), the buttons or lists it can offer (InteractiveFor) and the gates of
// its own (Gates). The care is the same for all, and is the TypeScript's, step for step:
//   - the opt-out gate and the message-matches-record gate always run, on the whole text the customer will see (the words, then each option);
//   - buttons and lists are a session message: only while the 24-hour window is open and only if they fit WhatsApp's limits, and otherwise the same words go out as plain text;
//   - a message that cannot go as text goes as an approved template when the window is closed;
//   - a lost reply may still have gone out, so it is not sent again, because there is no way to look it up;
//   - a picture that goes with the words (a UPI QR code) is sent first, only while the window is open, with a caption that passes the same check; if it cannot go the words still do.
//
// State and the world are INTERFACES the runtime supplies and a test fakes: Messaging, the Voice, and every function in SayDeps (the record's Log, the owner's HeldBack, the chat's
// MarkMoment). A failure of FactsFor or HeldBack comes out of Say as its own error, as a throw does in the TypeScript; the template's other hooks do not fail.
package messaging

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// Decision is a rule's verdict (record.ts RuleDecision, limits.ts Decision): which rule, allow / hold_for_owner / block, and why.
type Decision struct {
	RuleID  string `json:"ruleId"`
	Verdict string `json:"verdict"`
	Reason  string `json:"reason"`
}

var verdictRank = map[string]int{"allow": 0, "hold_for_owner": 1, "block": 2}

// Strictest is limits.ts strictest: a block beats a hold for the owner, which beats an allow; the first of equals wins.
func Strictest(ds []Decision) Decision {
	worst := ds[0]
	for _, d := range ds[1:] {
		if verdictRank[d.Verdict] > verdictRank[worst.Verdict] {
			worst = d
		}
	}
	return worst
}

// CheckOptOut is limits.ts checkOptOut: nothing more goes to a customer who sent STOP.
func CheckOptOut(toCustomer, customerOptedOut bool) Decision {
	if toCustomer && customerOptedOut {
		return Decision{"opt-out", "block", "The customer sent STOP, so nothing more is sent to them."}
	}
	if toCustomer {
		return Decision{"opt-out", "allow", "The customer has not opted out."}
	}
	return Decision{"opt-out", "allow", "This message is for the owner."}
}

// LicenceRule is licence/rules.ts LICENCE_RULE.
const LicenceRule = "subscription_suspended"

// GuardLicenceDecision is Guard's own licence refusal (a Suspended GuardError, HTTP 402) as a decision in the record. reason is Guard's `reason`, or "" when it gave none (`reason ??
// LICENCE_RULE`); it is cut at 300 UTF-16 units.
func GuardLicenceDecision(reason string, hasReason bool) Decision {
	if !hasReason {
		reason = LicenceRule
	}
	return Decision{LicenceRule, "block", "Guard refused it for the shop's licence (" + language.UTF16Slice(reason, 300) + "): nothing was sent, it is not tried again, and nothing is kept to do later"}
}

var (
	channelConversation = regexp.MustCompile(`^(?:web|mcp|chat):[0-9a-f]{16}$`)
	chatConversation    = regexp.MustCompile(`^chat:[0-9a-f]{16}$`)
)

// SayArgs is what every message to say carries; Extra is the template's own fields (an amount, a time), which only its own deps read.
type SayArgs struct {
	// Booking is the booking or fee the message is about, or nil. The shared code never looks inside it.
	Booking any
	// Phone is the customer's number (the record is kept under it, and the message goes there when it is for the customer).
	Phone string
	// To is "customer" or "owner".
	To string
	// Templates are the templates, in order; their texts are joined with a space.
	Templates []string
	// Shown are decisions worth recording alongside the message that do not gate it (nil: none).
	Shown []Decision
	// Reminder: sent by the clock, not as a reply (the reminder template name is used outside the window).
	Reminder bool
	// Action is the record's name for this message ("" is "send_message").
	Action string
	// Offer is the buttons or list to go with the words.
	Offer *Offer
	// Image is a picture to send before the words (a UPI QR code).
	Image *SayImage
	// Extra is the template's own fields.
	Extra any
}

// Offer names which buttons or list a template offers; Body, when not nil, are the templates whose words sit above them (`offer.body ?? a.templates`).
type Offer struct {
	Kind string
	Body []string
}

// SayImage is the picture before the words: its https address and the templates that make its caption.
type SayImage struct {
	Link    string
	Caption []string
}

// GenericNames are the generic template names, for a message that is not one of the approved templates.
type GenericNames struct{ Customer, Reminder, Owner string }

// TemplateArgs is what Voice.TemplateMessage is asked for.
type TemplateArgs struct {
	IDs      []string
	Language Language
	Facts    any
	Text     string
	Generic  string
}

// Voice is a template's words (say.ts SayVoice).
type Voice interface {
	// Render is one template, written from the facts. It fails if the record lacks something it needs.
	Render(id string, facts any) (string, error)
	// TemplateMessage is the WhatsApp template that carries this text once the window has closed.
	TemplateMessage(a TemplateArgs) (TemplateMessage, error)
	GenericNames() GenericNames
	// Matches is message-matches-record: the text against the facts.
	Matches(text string, facts any) Decision
}

// OwnerInfo is the owner's number and language (a message to the owner goes there, in that language).
type OwnerInfo struct {
	WhatsApp string
	Language Language
}

// LogMore is the rest of a record line. Decisions nil is `undefined` (left out); Notes nil is left out ("" is kept: an ApiError can have no words).
type LogMore struct {
	Decisions []Decision
	Notes     *string
	Refs      map[string]string
	Language  Language
}

// SayDeps is say.ts SayDeps.
type SayDeps struct {
	Messaging Messaging
	Voice     Voice
	Owner     OwnerInfo
	// LanguageOf is the language this customer's conversation is in.
	LanguageOf func(phone string, booking any) Language
	OptedOut   func(phone string) bool
	// FactsFor are the facts this message is written from, and the outgoing check reads.
	FactsFor func(a *SayArgs, language Language) (any, error)
	// InteractiveFor are the buttons or list for an offer (nil: the template has none). An error means the words go out as plain text.
	InteractiveFor func(a *SayArgs, facts any, language Language) (*InteractiveMessage, error)
	// Gates are the template's own gates, after the shared ones, in the order the template wants them recorded.
	Gates func(a *SayArgs, optedOut bool) []Decision
	// InputsOf is what the record keeps of the request (not the text).
	InputsOf func(a *SayArgs) map[string]any
	// Log writes a record line.
	Log func(booking any, phone, action, outcome string, inputs map[string]any, more LogMore)
	// HeldBack: a message to a customer was held back because it did not match the record: tell the owner.
	HeldBack func(ctx context.Context, a *SayArgs) error
	// Moment is whether this message is the shop saying its RECORD holds something ("confirmed" or "paid", "" for neither), decided from the template's own ids, never the words.
	Moment     func(a *SayArgs) string
	MarkMoment func(messageID, moment string)
}

// Say is say.ts createSay.
type Say struct{ deps SayDeps }

// NewSay is createSay.
func NewSay(d SayDeps) *Say { return &Say{d} }

type sayResult struct {
	went    bool
	outcome SaidOutcome
}

// Say reports whether the message went out and was read back, as every caller uses it.
func (s *Say) Say(ctx context.Context, a *SayArgs) (bool, error) {
	r, err := s.send(ctx, a)
	return r.went, err
}

// Outcome is the same send, saying how it ended (accepted, maybe, not_sent, held_back).
func (s *Say) Outcome(ctx context.Context, a *SayArgs) (SaidOutcome, error) {
	r, err := s.send(ctx, a)
	return r.outcome, err
}

func merge(m map[string]any, more map[string]any) map[string]any {
	out := make(map[string]any, len(m)+len(more))
	for k, v := range m {
		out[k] = v
	}
	for k, v := range more {
		out[k] = v
	}
	return out
}

func str1(s string) *string { return &s }

func (s *Say) renderAll(ids []string, facts any) (string, error) {
	parts := make([]string, len(ids))
	for i, id := range ids {
		t, err := s.deps.Voice.Render(id, facts)
		if err != nil {
			return "", err
		}
		parts[i] = t
	}
	return strings.Join(parts, " "), nil
}

// windowOpenOrFalse is `messaging.isWindowOpen(to).catch(() => false)`.
func (s *Say) windowOpenOrFalse(ctx context.Context, to string) bool {
	open, err := s.deps.Messaging.IsWindowOpen(ctx, to)
	return err == nil && open
}

// sendImage is the picture before the words: best effort. Inside the window only, with a caption that passes the check; whatever happens, the words go next.
func (s *Say) sendImage(ctx context.Context, a *SayArgs, toNumber string, facts any, lang Language, inputs map[string]any, decisions []Decision) {
	d := s.deps
	images, ok := d.Messaging.(Images)
	if !ok {
		return
	}
	withImage := merge(inputs, map[string]any{"image": true})
	caption, err := s.renderAll(a.Image.Caption, facts)
	if err != nil {
		d.Log(a.Booking, a.Phone, "send_message", "blocked", withImage, LogMore{Notes: str1(err.Error()), Refs: map[string]string{"to": a.To, "image": "qr"}, Language: lang})
		return
	}
	check := d.Voice.Matches(caption, facts)
	problem := ImageProblem(ImageMessage{Link: a.Image.Link, Caption: &caption})
	if check.Verdict != "allow" || problem != "" {
		notes := problem
		if problem == "" {
			notes = check.Reason
		}
		d.Log(a.Booking, a.Phone, "send_message", "blocked", withImage, LogMore{Decisions: []Decision{check}, Notes: str1(notes), Refs: map[string]string{"to": a.To, "image": "qr"}, Language: lang})
		return
	}
	if !s.windowOpenOrFalse(ctx, toNumber) {
		return // a picture is a session message: outside the window the words go alone
	}
	sent, err := images.SendImage(ctx, toNumber, ImageMessage{Link: a.Image.Link, Caption: &caption})
	var seen *OutboundMessage
	if err == nil {
		seen, err = d.Messaging.GetMessage(ctx, sent.ID)
	}
	if err != nil {
		if g, ok := guard.AsGuard(err); ok && g.Kind == guard.KindSuspended {
			ds := append(append(append([]Decision{}, decisions...), check), GuardLicenceDecision(g.Guard.Reason, g.Guard.HasReason))
			d.Log(a.Booking, a.Phone, "send_message", "blocked", withImage, LogMore{Decisions: ds, Notes: str1(err.Error()), Refs: map[string]string{"to": a.To, "image": "qr"}, Language: lang})
			return
		}
		outcome := "failed"
		if guard.MayHaveHappened(err) {
			outcome = "unconfirmed"
		}
		d.Log(a.Booking, a.Phone, "send_message", outcome, withImage, LogMore{Notes: str1(err.Error()), Refs: map[string]string{"to": a.To, "image": "qr"}, Language: lang})
		return
	}
	outcome := "unconfirmed"
	if seen != nil {
		outcome = "confirmed"
	}
	d.Log(a.Booking, a.Phone, "send_message", outcome, withImage, LogMore{Decisions: append(append([]Decision{}, decisions...), check), Refs: map[string]string{"messageId": sent.ID, "templates": strings.Join(a.Image.Caption, "+"), "to": a.To, "image": "qr"}, Language: lang})
}

// send is one send, and how it ended: went is what say has always returned (out and read back), outcome the SaidOutcome its record line matches.
func (s *Say) send(ctx context.Context, a *SayArgs) (sayResult, error) {
	d := s.deps
	toCustomer := a.To == "customer"
	action := a.Action
	if action == "" {
		action = "send_message"
	}
	toNumber := d.Owner.WhatsApp
	lang := d.Owner.Language
	if toCustomer {
		toNumber = a.Phone
		lang = d.LanguageOf(a.Phone, a.Booking)
	}
	offer := a.Offer // the owner gets buttons only where a template offers them (UPI's "Received")
	facts, err := d.FactsFor(a, lang)
	if err != nil {
		return sayResult{}, err
	}
	base := map[string]any{"to": a.To, "templates": a.Templates}
	if d.InputsOf != nil {
		base = merge(base, d.InputsOf(a))
	}
	if offer != nil {
		base["offer"] = offer.Kind
	}
	inputs := base
	text, err := s.renderAll(a.Templates, facts)
	if err != nil {
		d.Log(a.Booking, a.Phone, action, "blocked", inputs, LogMore{Decisions: a.Shown, Notes: str1(err.Error()), Refs: map[string]string{"to": a.To}, Language: lang})
		return sayResult{false, HeldBack}, nil
	}

	// Buttons and lists are a session message, like free text: only while the window is open, and only if they fit WhatsApp's limits. Otherwise: the plain words, as before.
	inter, canInteractive := d.Messaging.(Interactive)
	var interactive *InteractiveMessage
	if offer != nil && d.InteractiveFor != nil && canInteractive {
		if m, err := d.InteractiveFor(a, facts, lang); err == nil {
			interactive = m
		}
		if interactive != nil && (InteractiveProblem(*interactive) != "" || !s.windowOpenOrFalse(ctx, toNumber)) {
			interactive = nil
		}
	}
	shownText := text
	if interactive != nil {
		shownText = InteractiveText(*interactive)
	}

	optedOut := d.OptedOut(a.Phone)
	gates := []Decision{CheckOptOut(toCustomer, optedOut), d.Voice.Matches(shownText, facts)}
	if interactive != nil {
		gates = append(gates, d.Voice.Matches(text, facts)) // the plain words may be sent instead, so they must hold too
	}
	if d.Gates != nil {
		gates = append(gates, d.Gates(a, optedOut)...)
	}
	decisions := append(append([]Decision{}, a.Shown...), gates...)
	worst := Strictest(gates)
	if worst.Verdict != "allow" {
		d.Log(a.Booking, a.Phone, action, "blocked", inputs, LogMore{Decisions: decisions, Notes: str1(worst.Reason), Refs: map[string]string{"to": a.To}, Language: lang})
		if toCustomer && worst.RuleID == "message-matches-record" {
			if err := d.HeldBack(ctx, a); err != nil {
				return sayResult{}, err
			}
		}
		return sayResult{false, HeldBack}, nil
	}

	if a.Image != nil {
		s.sendImage(ctx, a, toNumber, facts, lang, inputs, decisions)
	}

	sent, seen, asButtons, err := s.deliver(ctx, a, toNumber, toCustomer, lang, facts, text, interactive, inter)
	if err != nil {
		// Guard held it back for the shop's licence (the final stop): nothing went out, and it is the runtime's own licence refusal, made outside it. Recorded once, plainly.
		if g, ok := guard.AsGuard(err); ok && g.Kind == guard.KindSuspended {
			d.Log(a.Booking, a.Phone, action, "blocked", inputs, LogMore{Decisions: append(append([]Decision{}, decisions...), GuardLicenceDecision(g.Guard.Reason, g.Guard.HasReason)), Notes: str1(err.Error()), Refs: map[string]string{"to": a.To}, Language: lang})
			return sayResult{false, HeldBack}, nil
		}
		// a lost reply may still have gone out; it is not sent again, because there is no way to look it up
		maybe := guard.MayHaveHappened(err)
		outcome, said := "failed", SaidOutcome(NotSent)
		if maybe {
			outcome, said = "unconfirmed", Maybe
		}
		d.Log(a.Booking, a.Phone, action, outcome, inputs, LogMore{Decisions: decisions, Notes: str1(err.Error()), Refs: map[string]string{"to": a.To}, Language: lang})
		return sayResult{false, said}, nil
	}
	templates := a.Templates
	if asButtons && offer.Body != nil {
		templates = offer.Body
	}
	refs := map[string]string{"messageId": sent.ID, "templates": strings.Join(templates, "+"), "to": a.To}
	if asButtons {
		refs["interactive"] = "buttons"
		if interactive.List != nil {
			refs["interactive"] = "list"
		}
	}
	// item 11d: a message kept for a booking page names its channel, so nothing counts it as a WhatsApp message
	if channelConversation.MatchString(toNumber) {
		refs["channel"] = toNumber[:strings.Index(toNumber, ":")]
	}
	outcome := "unconfirmed"
	if seen != nil {
		outcome = "confirmed"
	}
	d.Log(a.Booking, a.Phone, action, outcome, inputs, LogMore{Decisions: decisions, Refs: refs, Language: lang})
	// W1: a chat line the record stands behind is marked, once it is kept (it went out through this one say, after the record's own gate allowed it)
	if toCustomer && seen != nil && chatConversation.MatchString(toNumber) && d.Moment != nil {
		if m := d.Moment(a); m != "" && d.MarkMoment != nil {
			d.MarkMoment(sent.ID, m)
		}
	}
	return sayResult{seen != nil, Accepted}, nil // the provider gave it an id: it was taken, whether or not the outbox shows it yet
}

// deliver is the `try` block: buttons or a list (falling back to the same words as text after a plain refusal), else text inside the window or the approved template outside it, then
// the read-back. Everything it returns as an error is classified by the caller.
func (s *Say) deliver(ctx context.Context, a *SayArgs, toNumber string, toCustomer bool, lang Language, facts any, text string, interactive *InteractiveMessage, inter Interactive) (sent OutboundMessage, seen *OutboundMessage, asButtons bool, err error) {
	d := s.deps
	if interactive != nil {
		sent, err = inter.SendInteractive(ctx, toNumber, *interactive)
		if err == nil {
			asButtons = true
		} else {
			// Refused outright by the provider (a 4xx): nothing went out, so the same words go out as plain text. A lost reply or a 5xx may have gone out and is not sent again. Any
			// answer of the shop's Guard (a hold, a refusal, a conflict, unauthenticated, the licence stop) is not tried again as text: say.ts since 22 Nov (a held call may still
			// send the buttons, and a refusal is Guard's no to this message).
			if _, isGuard := guard.AsGuard(err); isGuard || guard.MayHaveHappened(err) || isWindowClosed(err) {
				return
			}
			if st, isAPI := guard.IsAPI(err); !isAPI || st >= 500 {
				return
			}
			sent, err = d.Messaging.SendText(ctx, toNumber, text)
		}
	} else {
		var open bool
		open, err = d.Messaging.IsWindowOpen(ctx, toNumber)
		if err != nil {
			return
		}
		if open {
			sent, err = d.Messaging.SendText(ctx, toNumber, text)
		} else {
			generic := d.Voice.GenericNames().Customer
			switch {
			case !toCustomer:
				generic = d.Voice.GenericNames().Owner
			case a.Reminder:
				generic = d.Voice.GenericNames().Reminder
			}
			var tm TemplateMessage
			tm, err = d.Voice.TemplateMessage(TemplateArgs{IDs: a.Templates, Language: lang, Facts: facts, Text: text, Generic: generic})
			if err != nil {
				return
			}
			sent, err = d.Messaging.SendTemplate(ctx, toNumber, tm)
		}
	}
	if err != nil {
		return
	}
	seen, err = d.Messaging.GetMessage(ctx, sent.ID) // read back from the provider's own outbox
	return
}

func isWindowClosed(err error) bool { var w *guard.WindowClosedError; return errors.As(err, &w) }
