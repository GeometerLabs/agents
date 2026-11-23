package bookings

// The booking flow (onBook, onYes, onNo, the hold and its deposit link), cancelling and rescheduling, the owner's answers, STOP, a voice note and reading a customer's message:
// agent.ts's sections of those names, and onMessage. OnMessage is the entry the chat calls too (W1: a chat guest's send runs as the SAME step as a WhatsApp customer's message),
// so its signature is kept stable (go-bk-chat-19nov calls it).
//
// Not ported here yet, each answered with runtime.Unported or left as the TypeScript's "off" path (Deferred.md):
// the handover code, approvers other than the owner (B37).

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/discounts"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/terms"
	"github.com/GeometerLabs/agents/go/internal/understanding"
	speech "github.com/GeometerLabs/agents/go/internal/voice" // named speech: the package has its own type voice (agent_say.go)
	"github.com/GeometerLabs/agents/go/internal/zone"
)

var (
	// approvals/code.ts RELAY_CODE_REPLY and buttons.ts's button id: the approvals relay's replies, typed or tapped (`\s` is JavaScript's)
	relayCode   = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(approve|deny)[` + language.JSSpace + `]+([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})[` + language.JSSpace + `]*$`)
	relayButton = regexp.MustCompile(`^appr-(approve|deny):([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})$`)
	// agent.ts OWNER_COMMAND
	ownerCommand = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(approve|deny|retry)[` + language.JSSpace + `]+(b-[0-9]+)[` + language.JSSpace + `]*$`)
	// agent.ts DAY_WORDS
	dayToday    = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(?:today|bookings?|aaj|आज|ഇന്ന്|ಇಂದು)[` + language.JSSpace + `]*[.!?]*[` + language.JSSpace + `]*$`)
	dayTomorrow = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(?:tomorrow|kal|कल|നാളെ|ನಾಳೆ)[` + language.JSSpace + `]*[.!?]*[` + language.JSSpace + `]*$`)
	// agent.ts PAID_CLAIM and NOT_PAID: "I paid" in the shop's four languages, and a "no" in the same message that makes it not a claim. `\b` is ASCII in both (JavaScript's
	// with the u flag and no v; RE2's always); (?i) folds case by Unicode as the iu flags do.
	paidClaim = regexp.MustCompile(`(?i)\b(?:paid|i have paid|payment done|sent the money|money sent|transferred)\b|पेमेंट कर दिया|भुगतान कर दिया|पैसे भेज दिए|पैसे भेजे|भेज दिया|പണം അടച്ചു|അടച്ചു|പണം അയച്ചു|ಪಾವತಿಸಿದ್ದೇನೆ|ಹಣ ಕಳುಹಿಸಿದ್ದೇನೆ|ಪಾವತಿ ಮಾಡಿದ್ದೇನೆ`)
	notPaid   = regexp.MustCompile(`(?i)\b(?:not|haven'?t|hasn'?t|didn'?t|nahi|nahin|illa)\b|n't\b|नहीं|नही|ഇല്ല|അല്ല|ಇಲ್ಲ|ಆಗಿಲ್ಲ`)
)

func isRelayReply(m messaging.InboundMessage) bool {
	return relayCode.MatchString(m.Text) || (m.Reply != nil && relayButton.MatchString(m.Reply.ID))
}

// readIntent is reader.ts readIntent over the router (internal/understanding with this shop's Reading): the rules first, then the decision model and the language model, each only
// when the month's AI state allows it.
func (a *Agent) readIntent(text string, rulesOnly bool, slots func() []CandidateSlot) (Intent, string, understanding.Understood) {
	now := a.now()
	ai := &a.c.Snap.AI
	skip := understanding.Options{RulesOnly: rulesOnly}
	if a.kit.Router == nil {
		return a.coerce(ParseIntent(text, a.settings)), "", understanding.Rules()
	}
	r := *a.kit.Router
	r.Reading = Reading{S: a.settings, Slots: slots}
	skip.SkipSteps = budgetPaused(ai, a.c, now)
	in, u, reason := r.Parse(text, skip, now)
	note := ""
	if reason != "" {
		note = "the model could not be used (" + reason + "), so the rule parser read the message"
	}
	return a.coerce(in), note, u
}

// coerce is coerceIntent after the router: an intent that is not one comes back as "unknown".
func (a *Agent) coerce(in Intent) Intent {
	raw := map[string]any{"kind": in.Kind}
	b, _ := json.Marshal(in)
	_ = json.Unmarshal(b, &raw)
	if c := CoerceIntent(raw, a.settings); c != nil {
		return *c
	}
	return Intent{Kind: "unknown"}
}

// OnMessage is agent.ts onMessage: a customer's (or the owner's) WhatsApp message, or a chat guest's send (runtime.ChatTurn runs it under the guest's conversation).
func (a *Agent) OnMessage(msg messaging.InboundMessage) error {
	if contains(a.store.SeenMessages, msg.ID) {
		a.log(nil, msg.From, "receive_message", "blocked", map[string]any{"id": msg.ID}, logMore{notes: "the same WhatsApp message was delivered again, so it is ignored"})
		return nil
	}
	a.store.SeenMessages = append(a.store.SeenMessages, msg.ID)
	// B29: a voice note is turned into the words it says and then read exactly like a typed message (rules first, then the models, then the same limits and checks)
	var voiceHeard *speech.Heard
	if msg.VoiceNote {
		heard := a.listen(msg)
		if heard == nil || !heard.OK {
			return a.onVoiceNote(msg, heard)
		}
		voiceHeard = heard
		msg = messaging.InboundMessage{ID: msg.ID, From: msg.From, Text: heard.Text, Timestamp: msg.Timestamp, NoModel: msg.NoModel}
	}
	if msg.From == a.owner() {
		return a.onOwnerMessage(msg)
	}
	if msg.Image {
		a.onPicture(msg)
		return nil
	}
	phone := msg.From
	customer := a.store.Customer(phone)
	buttons := false
	if a.c.Snap != nil {
		buttons = budgetButtons(&a.c.Snap.AI, a.c, a.now())
	}
	// UPI: "I paid" while a deposit waits is read from a few plain words before any model; it is a claim, and the owner is asked to look. It marks nothing paid.
	if a.ownerConfirms && msg.Reply == nil && !customer.OptedOut && paidClaim.MatchString(msg.Text) && !notPaid.MatchString(msg.Text) && a.store.Latest(phone, []string{AwaitingDeposit}) != nil {
		// B29: a voice note that says "I paid" is recorded as voice too, with what listening cost, so the cost meter does not miss it
		inputs, refs := map[string]any{"text": msg.Text, "id": msg.ID}, map[string]string{"messageId": msg.ID, "step": "rules"}
		if voiceHeard != nil {
			inputs["voice"] = true
			refs = mergeRefs(refs, speech.Marks(*voiceHeard))
			refs["costMicroInr"] = strconv.FormatInt(voiceHeard.CostMicroInr, 10)
		}
		a.log(nil, phone, "receive_message", "confirmed", inputs, logMore{refs: refs})
		a.onPaidClaim(phone, "words", "")
		return nil
	}
	// a tap on a button or a list row is read by looking its id up: no words are read, so no model is asked
	var tapped *Intent
	if msg.Reply != nil {
		tapped = IntentFromReply(msg.Reply.ID, a.settings)
	}
	var in Intent
	note := ""
	u := understanding.Rules()
	if tapped != nil {
		in = *tapped
	} else {
		var latest *Booking
		in, note, u = a.readIntent(msg.Text, buttons || customer.OptedOut || msg.NoModel, func() []CandidateSlot {
			latest = a.store.Latest(phone, []string{Enquiry, ConfirmingDetails})
			id := ""
			if latest != nil {
				id = latest.ServiceID
			}
			return a.candidateSlots(id)
		})
	}
	if a.c.Snap != nil {
		runtime.CountUnderstood(&a.c.Snap.AI, a.c.Policy, a.c.Clock, a.now(), u)
	}
	if in.Language != "" && contains(a.settings.Languages, in.Language) {
		customer.Language = in.Language
	} else if voiceHeard != nil && customer.Language == "" && contains(a.settings.Languages, voiceHeard.Language) {
		customer.Language = voiceHeard.Language // the language they spoke, when the words do not say
	}
	var notes []string
	if note != "" {
		notes = append(notes, note)
	}
	if in.OverrideAttempt != nil && *in.OverrideAttempt {
		notes = append(notes, "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing")
	}
	refs := mergeRefs(map[string]string{"messageId": msg.ID}, u.Refs())
	if tapped != nil {
		refs["via"] = msg.Reply.Kind
	}
	inputs := map[string]any{"text": msg.Text, "id": msg.ID}
	if tapped != nil {
		inputs["reply"] = msg.Reply.ID
	}
	// B29: what typed text keeps, plus that it came from a voice note, which provider and model listened, for how long and what that cost; the cost is added to the message's own
	// so the cost meter counts it
	if voiceHeard != nil {
		inputs["voice"] = true
		understood := refs["costMicroInr"]
		refs = mergeRefs(refs, speech.Marks(*voiceHeard))
		if understood != "" {
			n, _ := strconv.ParseFloat(understood, 64)
			refs["costMicroInr"] = strconv.FormatInt(int64(n)+voiceHeard.CostMicroInr, 10)
		}
		notes = append(notes, "the customer sent a voice note; this is its transcript")
	}
	a.log(nil, phone, "receive_message", "confirmed", inputs, logMore{notes: strings.Join(notes, "; "), refs: refs})
	defer a.announceButtonMode() // reader.ts: after the customer has their answer, whatever it was (agent.ts's `finally`)

	if in.Kind == "stop" {
		return a.onStop(phone)
	}
	if customer.OptedOut {
		return nil // STOP means STOP: nothing goes to them, even if they write again
	}
	if in.AskDiscount && a.settings.Discounts != nil && (in.Kind == "unknown" || in.Kind == "greeting") {
		in.Kind = "book" // E1: "any discount?" in a shop with the discount authority is about the booking (onBook answers it); without one, exactly as before
	}
	switch in.Kind {
	case "book":
		return a.onBook(phone, &in)
	case "yes":
		return a.onYes(phone)
	case "no":
		return a.onNo(phone)
	case "cancel":
		if in.Ask != nil && *in.Ask {
			return a.onCancelAsk(phone)
		}
		return a.onCancel(phone)
	case "reschedule":
		return a.onReschedule(phone, &in)
	case "owner":
		return a.onTalkToOwner(phone)
	case "keep":
		return a.onKeep(phone)
	case "paid":
		if a.ownerConfirms {
			a.onPaidClaim(phone, "button", "")
			return nil
		}
		a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: servicesOffer("didnt_understand")})
		return nil
	case "greeting":
		if !a.takesNewWork() {
			a.pausedReply(phone, "menu", nil)
			return nil
		}
		a.tellCustomer(nil, phone, []string{"menu"}, sayOpts{offer: servicesOffer("pick_service")})
		return nil
	}
	if !a.takesNewWork() {
		a.pausedReply(phone, "menu", nil)
		return nil
	}
	// block M: the shop's assistant may answer, from what customers may be told (false: the talk is off, a check failed, or nothing was said; the menu goes as before)
	if msg.Reply == nil && !msg.NoModel && a.talkToCustomer(phone, msg.Text, in.OverrideAttempt != nil && *in.OverrideAttempt) {
		return nil
	}
	a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: servicesOffer("didnt_understand")})
	return nil
}

// ---- the booking flow ------------------------------------------------------------------------------------------------------------------------------------------------

type holdResult struct {
	ok        bool
	why       string // outside_hours, unavailable, failed, paused
	decisions []Decision
}

// tryHold is agent.ts tryHold: check the limits for a slot, then hold it in the shop's own bookings and the calendar.
func (a *Agent) tryHold(b *Booking) (holdResult, error) {
	sv := a.settings.ServiceByID(b.ServiceID)
	start, end := *b.StartMs, *b.EndMs
	decisions := []Decision{CheckPriceAtOrAboveList(ServiceName(sv, "en"), sv.PriceInr, sv.PriceInr)}
	hours, clash, err := a.slotRules(b, start, end)
	if err != nil {
		return holdResult{}, err
	}
	decisions = append(decisions, hours, clash)
	if hours.Blocked() {
		a.log(b, b.Customer, "hold_slot", "blocked", map[string]any{"start": start}, logMore{decisions: decisions})
		return holdResult{false, "outside_hours", decisions}, nil
	}
	if clash.Blocked() {
		a.log(b, b.Customer, "hold_slot", "blocked", map[string]any{"start": start}, logMore{decisions: decisions})
		return holdResult{false, "unavailable", decisions}, nil
	}
	// the hold is the booking's own, kept in the shop's saved state with the rest of this step; it is written before the calendar, and the calendar only follows it
	until := a.now() + a.settings.Deposit.HoldMinutes*Minute
	b.HoldExpiresAt = &until
	a.log(b, b.Customer, "hold_slot", "attempted", map[string]any{"start": start, "end": end}, logMore{decisions: decisions,
		notes: "held in the shop's own bookings until " + isoTime(until) + ", before the calendar is written; a hold that is not paid by then ends by itself"})
	found, err := a.ensureEvent(b, wanted{start, end, "tentative"})
	if err != nil {
		return holdResult{}, err
	}
	if found.event != nil {
		b.EventID = found.event.ID
		taken, unread, err := a.takenMeanwhile(b, start, end)
		if err != nil {
			return holdResult{}, err
		}
		if unread != "" || taken != nil {
			// not kept: someone else's event is on this time now, or the calendar could not be read again to say it is not
			m := logMore{refs: map[string]string{"eventId": found.event.ID}}
			why := "the calendar could not be read again after the hold was written"
			if taken != nil {
				m.decisions = append(append([]Decision{}, decisions...), *taken)
				m.notes = "another event was written on this time in the calendar while it was being held: the hold is let go and the customer is offered another time"
				why = "another event took the time while it was being held"
				a.log(b, b.Customer, "hold_slot", "blocked", map[string]any{"start": start, "end": end}, m)
			} else {
				m.notes = "the calendar could not be read again after the hold was written (" + unread + "), so the hold is not kept"
				a.log(b, b.Customer, "hold_slot", "unconfirmed", map[string]any{"start": start, "end": end}, m)
			}
			a.releaseSlot(b, why)
			b.HoldExpiresAt = nil
			if taken != nil {
				return holdResult{false, "unavailable", append(decisions, *taken)}, nil
			}
			return holdResult{false, "failed", decisions}, nil
		}
		a.log(b, b.Customer, "hold_slot", "confirmed", map[string]any{"start": start, "end": end}, logMore{refs: map[string]string{"eventId": found.event.ID}})
		return holdResult{true, "", decisions}, nil
	}
	b.HoldExpiresAt = nil
	if found.suspended != nil {
		d := guardLicenceDecision(found.suspended)
		a.log(b, b.Customer, "hold_slot", "blocked", map[string]any{"start": start, "end": end}, logMore{decisions: append(append([]Decision{}, decisions...), d), notes: found.suspended.Message})
		return holdResult{false, "paused", []Decision{d}}, nil
	}
	if found.conflict {
		a.log(b, b.Customer, "hold_slot", "blocked", map[string]any{"start": start}, logMore{notes: "the calendar refused: someone took the time first", decisions: decisions})
		return holdResult{false, "unavailable", decisions}, nil
	}
	outcome, notes := "unconfirmed", "the calendar does not show the hold"
	if found.err != "" {
		outcome, notes = "failed", found.err
	}
	a.log(b, b.Customer, "hold_slot", outcome, map[string]any{"start": start, "end": end}, logMore{notes: notes})
	return holdResult{false, "failed", decisions}, nil
}

// toEnquiry puts a booking back to an enquiry (when it is not one) with no slot.
func (a *Agent) toEnquiry(b *Booking) {
	a.clearSlot(b)
	if b.State != Enquiry {
		_ = b.MoveTo(Enquiry)
	}
}

// proceedToHold is agent.ts proceedToHold: hold the slot, create the deposit link, and send the quote.
func (a *Agent) proceedToHold(b *Booking, prefix []string, shown []Decision) error {
	phone := b.Customer
	if a.settings.Discounts != nil && a.dealStands(b) {
		// E1: the owner's card for this booking's price is out; nothing is held until they answer (a "yes" to the details does not go round the card)
		a.tellCustomer(b, phone, []string{"discount_asked"}, sayOpts{})
		return nil
	}
	if d := b.deal(); d.Live() && !priceSaid(prefix) {
		// E1: a price agreed in an earlier message is said again before the quote, which then does not state the list price
		word := "discount_agreed"
		if d.State == discounts.Approved {
			word = "discount_approved"
		}
		prefix = append(append([]string{}, prefix...), word)
	}
	if !a.takesNewWork() {
		a.toEnquiry(b) // nothing held, nothing kept for later
		a.pausedReply(phone, "hold", nil)
		return nil
	}
	// TODO(go-bk-chat-19nov): a chat guest's hold counts in the shop's cap on unpaid holds (unpaidChannelHolds, chat_shop_busy)
	held, err := a.tryHold(b)
	if err != nil {
		return err
	}
	if !held.ok && held.why == "paused" {
		a.toEnquiry(b)
		a.pausedReply(phone, "hold", &held.decisions[0])
		return nil
	}
	if !held.ok {
		slot := b.StartMs
		if held.why == "failed" {
			a.tellOwner(b, phone, "owner_not_booked", sayOpts{})
		}
		template := "hold_failed"
		switch held.why {
		case "outside_hours":
			template = "outside_hours"
		case "unavailable":
			template = "slot_unavailable"
		}
		_ = b.MoveTo(Enquiry)
		var o *offer
		if template != "hold_failed" {
			o = a.slotsOffer(b.ServiceID, append(append([]string{}, prefix...), template)...) // another time to tap, when this one cannot be had
		}
		a.tellCustomer(b, phone, append(append([]string{}, prefix...), template), sayOpts{slotMs: slot, shown: append(append([]Decision{}, shown...), held.decisions...), offer: o})
		a.clearSlot(b)
		return nil
	}
	a.log(b, phone, "create_deposit_link", "attempted", map[string]any{"amountPaise": a.depositPaise()})
	res, err := a.ensureLink(b)
	if err != nil {
		return err
	}
	if res.Link == nil && res.Suspended != nil {
		// Guard held the link back for the licence: the shop's own pause, said as Guard's. The slot is let go; the owner is not asked to do anything
		d := guardLicenceDecision(res.Suspended)
		a.log(b, phone, "create_deposit_link", "blocked", map[string]any{"amountPaise": a.depositPaise()}, logMore{decisions: []Decision{d}, notes: res.Suspended.Message})
		a.releaseSlot(b, "Guard refused the deposit link for the shop's licence")
		_ = b.MoveTo(Enquiry)
		a.clearSlot(b)
		a.pausedReply(phone, "link", &d)
		return nil
	}
	if res.Link == nil {
		outcome, notes := "unconfirmed", "the payments service does not show the link"
		if res.Error != "" {
			outcome, notes = "failed", res.Error
		}
		a.log(b, phone, "create_deposit_link", outcome, map[string]any{"amountPaise": a.depositPaise()}, logMore{notes: notes})
		a.releaseSlot(b, "no payment link could be created")
		a.tellOwner(b, phone, "owner_not_booked", sayOpts{})
		_ = b.MoveTo(Enquiry)
		a.tellCustomer(b, phone, []string{"link_failed"}, sayOpts{})
		a.clearSlot(b)
		return nil
	}
	b.LinkID, b.LinkURL = res.Link.ID, res.Link.PayURL
	a.log(b, phone, "create_deposit_link", "confirmed", map[string]any{"amountPaise": a.depositPaise()}, logMore{refs: map[string]string{"linkId": res.Link.ID}})
	_ = b.MoveTo(AwaitingDeposit)
	if a.ownerConfirms {
		a.sendMarkedRequest(b, prefix, append(append([]Decision{}, shown...), held.decisions...))
		return nil
	}
	quote := "quote_and_link"
	if priceSaid(prefix) {
		quote = "slot_and_link"
	}
	a.tellCustomer(b, phone, append(append([]string{}, prefix...), quote), sayOpts{shown: append(append([]Decision{}, shown...), held.decisions...), offer: cancelOrOwner})
	return nil
}

// onBook is agent.ts onBook.
func (a *Agent) onBook(phone string, in *Intent) error {
	if !a.takesNewWork() {
		a.pausedReply(phone, "book", nil)
		return nil
	}
	lang := a.languageOf(phone, nil)
	waiting := a.store.Latest(phone, []string{AwaitingDeposit})
	b := a.store.Latest(phone, []string{Enquiry, ConfirmingDetails})
	hasDetails := in.ServiceID != "" || in.Date != nil || in.Time != nil
	if b == nil && waiting != nil {
		// already holding a slot for this customer: a repeat of the same request gets the same link, not a second hold
		probe := NewDraft(phone, lang)
		probe.ServiceID, probe.DateNeedsConfirmation = waiting.ServiceID, waiting.DateNeedsConfirmation
		for _, k := range []string{"date", "timePhrase"} {
			var v any
			if waiting.extra(k, &v) {
				probe.setExtra(k, v)
			}
		}
		if hasDetails && a.fill(probe, in) {
			a.settle(probe)
		}
		if !hasDetails || (probe.ServiceID == waiting.ServiceID && sameHold(probe.StartMs, waiting.StartMs)) {
			a.tellAlreadyWaiting(waiting)
			return nil
		}
		if err := a.cancelWaiting(waiting, "replaced by a new request from the customer"); err != nil {
			return err
		}
		b = a.store.Register(probe)
	} else if b == nil {
		b = a.store.Register(NewDraft(phone, lang))
	}
	b.Language = lang
	if !a.fill(b, in) {
		a.tellCustomer(b, phone, []string{"didnt_understand"}, sayOpts{offer: servicesOffer("didnt_understand")})
		return nil
	}
	a.settle(b)
	// the customer's price is only ever compared with the list; the quote is always the list price. E1: with a "discounts" block, a price below the list goes to the
	// discount authority instead (agent_discounts.go); without one, this is exactly as before.
	sv := a.settings.ServiceByID(b.ServiceID)
	var shown []Decision
	var prefix []string
	disc := a.settings.Discounts != nil
	if disc && a.dealStands(b) && (in.OfferInr == nil || (sv != nil && *in.OfferInr < sv.PriceInr && b.deal().OfferedInr == *in.OfferInr)) {
		// the owner's card for this very ask is out: the customer hears that again, and no second card goes
		a.tellCustomer(b, phone, []string{"discount_asked"}, sayOpts{})
		return nil
	}
	if disc && in.OfferInr == nil && in.AskDiscount {
		// E1: "any discount?" with no price named: the price the agent may give alone (agent_discounts.go offerCap)
		p, sh, stop := a.offerCap(b, sv)
		if stop {
			return nil
		}
		prefix, shown = p, sh
	} else if sv != nil && in.OfferInr != nil {
		if disc && *in.OfferInr < sv.PriceInr {
			p, sh, stop := a.decideOffer(b, sv, *in.OfferInr)
			if stop {
				return nil
			}
			prefix, shown = p, sh
		} else {
			d := CheckPriceAtOrAboveList(ServiceName(sv, "en"), sv.PriceInr, *in.OfferInr)
			shown = append(shown, d)
			if d.Blocked() {
				prefix = append(prefix, "price_floor")
			}
			if disc && !d.Blocked() {
				b.setDeal(nil) // the customer takes the list price: whatever was asked before is void
			}
		}
	}
	return a.afterPrice(b, sv, prefix, shown)
}

// afterPrice is the rest of onBook once the price is settled: the menu when no service is known, then the time, then the details to confirm, then the hold. The owner's answer
// to a price card (agent_discounts.go) goes on from here too, with its words first.
func (a *Agent) afterPrice(b *Booking, sv *Service, prefix []string, shown []Decision) error {
	phone := b.Customer
	with := func(ids ...string) []string { return append(append([]string{}, prefix...), ids...) }
	if sv == nil {
		a.tellCustomer(b, phone, []string{"menu"}, sayOpts{shown: shown, offer: servicesOffer("pick_service")})
		return nil
	}
	if b.StartMs == nil || b.EndMs == nil {
		a.tellCustomer(b, phone, with("ask_when"), sayOpts{shown: shown, offer: a.slotsOffer(b.ServiceID, with("pick_slot")...)})
		return nil
	}
	if *b.StartMs <= a.now() {
		slot := b.StartMs
		a.clearSlot(b)
		a.tellCustomer(b, phone, with("slot_unavailable"), sayOpts{slotMs: slot, shown: shown, offer: a.slotsOffer(b.ServiceID, with("slot_unavailable")...)})
		return nil
	}
	if b.DateNeedsConfirmation || b.TimeInferred {
		_ = b.MoveTo(ConfirmingDetails)
		a.tellCustomer(b, phone, with("confirm_details"), sayOpts{shown: shown, offer: yesNo(with("confirm_buttons")...)})
		return nil
	}
	return a.proceedToHold(b, prefix, shown)
}

func (a *Agent) onYes(phone string) error {
	if moving := a.store.Latest(phone, []string{Confirmed}); moving != nil && moving.reschedule() != nil {
		return a.applyReschedule(moving)
	}
	if b := a.store.Latest(phone, []string{ConfirmingDetails}); b != nil {
		return a.proceedToHold(b, nil, nil)
	}
	if w := a.store.Latest(phone, []string{AwaitingDeposit}); w != nil {
		a.tellAlreadyWaiting(w)
		return nil
	}
	a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: servicesOffer("didnt_understand")})
	return nil
}

func (a *Agent) onNo(phone string) error {
	if moving := a.store.Latest(phone, []string{Confirmed}); moving != nil && moving.reschedule() != nil {
		moving.setReschedule(nil)
		a.tellCustomer(moving, phone, []string{"ask_new_time"}, sayOpts{})
		return nil
	}
	if b := a.store.Latest(phone, []string{ConfirmingDetails}); b != nil {
		a.clearSlot(b)
		_ = b.MoveTo(Enquiry)
		a.tellCustomer(b, phone, []string{"ask_when"}, sayOpts{offer: a.slotsOffer(b.ServiceID, "pick_slot")})
		return nil
	}
	a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: servicesOffer("didnt_understand")})
	return nil
}

// ---- cancelling and rescheduling -------------------------------------------------------------------------------------------------------------------------------------

// cancelWaiting is agent.ts cancelWaiting: give up a held slot that has not been paid: free the calendar and close the link.
func (a *Agent) cancelWaiting(b *Booking, why string) error {
	a.releaseSlot(b, why)
	a.closeLink(b, why)
	_ = b.MoveTo(Cancelled)
	a.log(b, b.Customer, "cancel_booking", "confirmed", map[string]any{"state": "awaiting_deposit"}, logMore{notes: why})
	return a.reconcilePayments(b) // a payment that landed just before the cancel is refunded, not forgotten
}

// cancellable is agent.ts cancellable: the paid booking first, then one waiting for its owner or its deposit, then a draft.
func (a *Agent) cancellable(phone string) *Booking {
	for _, states := range [][]string{{Confirmed}, {NeedsOwner}, {AwaitingDeposit}, {ConfirmingDetails, Enquiry}} {
		if b := a.store.Latest(phone, states); b != nil {
			return b
		}
	}
	return nil
}

func (a *Agent) onCancelAsk(phone string) error {
	b := a.cancellable(phone)
	if b == nil || b.StartMs == nil {
		a.tellCustomer(b, phone, []string{"no_booking_found"}, sayOpts{offer: servicesOffer("no_booking_found")})
		return nil
	}
	a.tellCustomer(b, phone, []string{"ask_cancel"}, sayOpts{offer: &offer{kind: "buttons", buttons: []string{"cancelYes", "keep"}}})
	return nil
}

func (a *Agent) onKeep(phone string) error {
	b := a.cancellable(phone)
	if b == nil || b.StartMs == nil {
		a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: servicesOffer("didnt_understand")})
		return nil
	}
	a.tellCustomer(b, phone, []string{"kept"}, sayOpts{})
	return nil
}

// onTalkToOwner is agent.ts onTalkToOwner: the owner is told, once an hour for the same customer; the agent does not reply on the owner's behalf.
func (a *Agent) onTalkToOwner(phone string) error {
	c := a.store.Customer(phone)
	now := a.now()
	recently := c.OwnerAskedAtMs != nil && now-*c.OwnerAskedAtMs < Hour
	told := recently
	if !recently {
		told = a.tellOwner(nil, phone, "owner_wants_to_talk", sayOpts{})
		if told {
			c.OwnerAskedAtMs = &now
		}
	}
	outcome, notes := "failed", "the owner could not be told"
	switch {
	case recently:
		outcome, notes = "confirmed", "the owner was already told in the last hour, so not again"
	case told:
		outcome, notes = "confirmed", "the customer asked to talk to the owner, and the owner was told"
	}
	a.log(nil, phone, "ask_owner", outcome, map[string]any{"by": "button"}, logMore{refs: map[string]string{"to": "owner"}, notes: notes})
	t := "couldnt_tell_owner"
	if told {
		t = "told_owner"
	}
	a.tellCustomer(nil, phone, []string{t}, sayOpts{})
	return nil
}

// onCancel is agent.ts onCancel.
func (a *Agent) onCancel(phone string) error {
	b := a.cancellable(phone)
	if b == nil || b.StartMs == nil {
		a.tellCustomer(b, phone, []string{"no_booking_found"}, sayOpts{offer: servicesOffer("no_booking_found")})
		return nil
	}
	switch b.State {
	case Enquiry, ConfirmingDetails:
		_ = b.MoveTo(Cancelled)
		a.log(b, phone, "cancel_booking", "confirmed", map[string]any{"state": "draft"})
		a.tellCustomer(b, phone, []string{"cancelled_no_deposit"}, sayOpts{})
		return nil
	case AwaitingDeposit:
		if err := a.cancelWaiting(b, "cancelled by the customer before paying"); err != nil {
			return err
		}
		a.tellCustomer(b, phone, []string{"cancelled_no_deposit"}, sayOpts{})
		return nil
	}
	// a paid booking: inside the cancellation window the deposit goes back; above the refund limit Guard holds it for the owner (asked once, by the relay); outside the window and
	// within the limit, whether to give it back is the owner's call, and the agent asks
	hoursLeft := float64(*b.StartMs-a.now()) / float64(Hour)
	inWindow := hoursLeft >= float64(a.settings.Cancellation.WindowHours)
	amountInr := *b.DepositInr
	a.releaseSlot(b, "cancelled by the customer")
	b.setReminders([]Reminder{})
	b.Pending = []payments.Pending{}
	_ = b.MoveTo(Cancelled)
	a.log(b, phone, "cancel_booking", "confirmed", map[string]any{"hoursLeft": jsFloor(hoursLeft), "inWindow": inWindow})
	limit := CheckRefundLimit(amountInr, a.settings.Cancellation.RefundLimitInr, amountInr, false, true)
	refs := map[string]string{"paymentId": b.DepositPaymentID, "amountPaise": i64(amountInr * 100)}
	if limit.Blocked() {
		a.log(b, phone, "refund", "blocked", map[string]any{"paymentId": b.DepositPaymentID, "amountInr": amountInr}, logMore{decisions: []Decision{limit}, refs: refs})
		return nil
	}
	// a module that cannot refund by itself: inside the window the deposit is owed back by the owner, whatever the limit (the owner sends every such refund, so there is no
	// Guard to hold one); outside it the owner decides, as below
	if a.ownerRefunds && inWindow {
		a.oweBack(b, b.DepositPaymentID, amountInr*100, "cancelled inside the cancellation window", oweOpts{customer: "upi_cancelled_refund_owed", decisions: []Decision{limit}})
		return nil
	}
	if !inWindow && (limit.Verdict == "allow" || a.ownerRefunds) {
		late := CheckRefundLimit(amountInr, a.settings.Cancellation.RefundLimitInr, amountInr, false, false)
		b.Pending = append(b.Pending, rawPending(OwnerRefund{Kind: "refund", AmountInr: amountInr, PaymentID: b.DepositPaymentID, Reason: "late_cancellation"}))
		a.log(b, phone, "refund", "held_for_owner", map[string]any{"paymentId": b.DepositPaymentID, "amountInr": amountInr}, logMore{decisions: []Decision{late}, refs: refs})
		a.tellCustomer(b, phone, []string{"cancelled_late"}, sayOpts{refundInr: ptr(amountInr)})
		a.tellOwner(b, phone, "owner_late_cancellation", sayOpts{refundInr: ptr(amountInr)})
		return nil
	}
	result, err := a.requestRefund(b, b.DepositPaymentID, amountInr, []Decision{limit}, limit.Verdict != "allow", nil)
	if err != nil {
		return err
	}
	held := "cancelled_late"
	if inWindow {
		held = "cancelled_refund_pending"
	}
	a.afterRefund(b, result, payments.RefundAfter{PaymentID: b.DepositPaymentID, AmountInr: amountInr, DoneCust: "cancelled_refund", Held: held})
	return nil
}

// jsFloor is Math.floor of a number the record keeps as a whole number.
func jsFloor(f float64) int64 {
	n := int64(f)
	if float64(n) > f {
		n--
	}
	return n
}

// onReschedule is agent.ts onReschedule: the new slot is built from the old one, changed by whatever the customer named.
func (a *Agent) onReschedule(phone string, in *Intent) error {
	b := a.store.Latest(phone, []string{Confirmed})
	if b == nil || b.StartMs == nil {
		a.tellCustomer(b, phone, []string{"no_booking_found"}, sayOpts{offer: servicesOffer("no_booking_found")})
		return nil
	}
	if in.Date == nil && in.Time == nil {
		a.tellCustomer(b, phone, []string{"ask_new_time"}, sayOpts{})
		return nil
	}
	probe := NewDraft(phone, b.Language)
	probe.ServiceID = b.ServiceID
	old := zone.LocalParts(*b.StartMs, a.settings.Timezone)
	probe.setDate(old.Date)
	h := old.Hour % 12
	if h == 0 {
		h = 12
	}
	period := "pm"
	if old.Hour < 12 {
		period = "am"
	}
	probe.setExtra("timePhrase", TimePhrase{h, old.Minute, period})
	if !a.fill(probe, in) {
		a.tellCustomer(b, phone, []string{"didnt_understand"}, sayOpts{})
		return nil
	}
	a.settle(probe)
	m := &move{Date: *probe.date(), TimePhrase: *probe.timePhrase(), StartMs: *probe.StartMs, EndMs: *probe.EndMs}
	b.setReschedule(m)
	if probe.DateNeedsConfirmation || probe.TimeInferred {
		// ask only about a time that is possible right now; it is checked again when the customer says yes
		ok, err := a.moveAllowed(b, m)
		if err != nil {
			return err
		}
		if !ok {
			b.setReschedule(nil)
			return nil
		}
		a.tellCustomer(b, phone, []string{"confirm_details"}, sayOpts{slotMs: ptr(m.StartMs), offer: yesNo("confirm_buttons")})
		return nil
	}
	return a.applyReschedule(b)
}

// moveAllowed is agent.ts moveAllowed: can this booking move to this time right now? If not, the customer is told why.
func (a *Agent) moveAllowed(b *Booking, m *move) (bool, error) {
	hours, clash, err := a.slotRules(b, m.StartMs, m.EndMs)
	if err != nil {
		return false, err
	}
	past := m.StartMs <= a.now()
	if !past && !hours.Blocked() && !clash.Blocked() {
		return true, nil
	}
	lm := logMore{decisions: []Decision{hours, clash}}
	if past {
		lm.notes = "that time has already passed"
	}
	a.log(b, b.Customer, "reschedule_booking", "blocked", map[string]any{"start": m.StartMs}, lm)
	t := "slot_unavailable"
	if hours.Blocked() {
		t = "outside_hours"
	}
	a.tellCustomer(b, b.Customer, []string{t}, sayOpts{slotMs: ptr(m.StartMs), shown: []Decision{hours, clash}})
	return false, nil
}

// applyReschedule is agent.ts applyReschedule.
func (a *Agent) applyReschedule(b *Booking) error {
	m := b.reschedule()
	b.setReschedule(nil)
	ok, err := a.moveAllowed(b, m) // the customer's yes may come after someone else took the time
	if err != nil || !ok {
		return err
	}
	want := wanted{m.StartMs, m.EndMs, "confirmed"}
	a.log(b, b.Customer, "reschedule_booking", "attempted", want)
	found, err := a.ensureEvent(b, want)
	if err != nil {
		return err
	}
	if found.event != nil {
		// the calendar is read again after the move (as after a hold): Google takes an overlapping event without a word
		taken, unread, err := a.takenMeanwhile(b, m.StartMs, m.EndMs)
		if err != nil {
			return err
		}
		if unread != "" || taken != nil {
			lm := logMore{refs: map[string]string{"eventId": found.event.ID}}
			outcome, t := "unconfirmed", "reschedule_failed"
			var shown []Decision
			if taken != nil {
				outcome, t = "blocked", "slot_unavailable"
				lm.decisions, shown = []Decision{*taken}, []Decision{*taken}
				lm.notes = "another event was written on the new time while the booking was being moved: it goes back to its old time"
			} else {
				lm.notes = "the calendar could not be read again after the move (" + unread + "): it goes back to its old time"
			}
			a.log(b, b.Customer, "reschedule_booking", outcome, want, lm)
			if _, err := a.ensureEvent(b, wanted{*b.StartMs, *b.EndMs, "confirmed"}); err != nil {
				return err
			}
			a.tellCustomer(b, b.Customer, []string{t}, sayOpts{slotMs: ptr(m.StartMs), shown: shown})
			return nil
		}
		b.StartMs, b.EndMs = ptr(m.StartMs), ptr(m.EndMs)
		b.setReminders(ReminderSchedule(a.settings, m.StartMs, a.now()))
		a.log(b, b.Customer, "reschedule_booking", "confirmed", want, logMore{refs: map[string]string{"eventId": found.event.ID}})
		a.tellCustomer(b, b.Customer, []string{"rescheduled"}, sayOpts{offer: cancelOrOwner})
		return nil
	}
	outcome, notes := "unconfirmed", "the calendar does not show the new time"
	if found.err != "" {
		outcome, notes = "failed", found.err
	}
	a.log(b, b.Customer, "reschedule_booking", outcome, want, logMore{notes: notes})
	a.tellCustomer(b, b.Customer, []string{"reschedule_failed"}, sayOpts{slotMs: ptr(m.StartMs)})
	a.tellOwner(b, b.Customer, "owner_reschedule_failed", sayOpts{slotMs: ptr(m.StartMs)})
	return nil
}

// ---- the owner's answers ---------------------------------------------------------------------------------------------------------------------------------------------

// tellDay is agent.ts tellDay: the owner's list for a day, read from the saved bookings.
func (a *Agent) tellDay(day string) {
	tz := a.settings.Timezone
	today := zone.LocalParts(a.now(), tz).Date
	off := 0
	if day == "tomorrow" {
		off = 1
	}
	from, to := zone.ZonedToMs(zone.AddDays(today, off), 0, 0, tz), zone.ZonedToMs(zone.AddDays(today, off+1), 0, 0, tz)
	var list []*Booking
	for _, x := range a.store.Bookings {
		if (x.State == Confirmed || x.State == NeedsOwner) && x.StartMs != nil && *x.StartMs >= from && *x.StartMs < to {
			list = append(list, x)
		}
	}
	sort.SliceStable(list, func(i, j int) bool { return *list[i].StartMs < *list[j].StartMs })
	rows := []DayBooking{}
	for _, x := range list {
		sv := a.settings.ServiceByID(x.ServiceID)
		if sv == nil {
			sv = &a.settings.Services[0]
		}
		rows = append(rows, DayBooking{SlotMs: *x.StartMs, ServiceName: ServiceName(sv, a.settings.Owner.Language), CustomerPhone: a.shownPhone(x.Customer, x), Ref: x.ID})
	}
	a.log(nil, a.owner(), "owner_day_list", "confirmed", map[string]any{"day": day}, logMore{notes: "the owner asked for the bookings of " + day + "; " + i64(int64(len(rows))) + " listed from the shop's saved bookings", refs: map[string]string{"day": day}})
	a.sayOwner([]string{"owner_day_bookings"}, sayExtra{day: day, dayBookings: rows}, "")
}

// onOwnerMessage is agent.ts onOwnerMessage: the relay's code replies (not the agent's), the day's list, and the owner's commands about what the agent asked them.
func (a *Agent) onOwnerMessage(msg messaging.InboundMessage) error {
	// owner-marked (B33): "received K7M2QX", "refunded K7M2QX" or a tap on one of those buttons. Only the owner's number reaches here
	if a.marks != nil {
		replyID := ""
		if msg.Reply != nil {
			replyID = msg.Reply.ID
		}
		if reply := ownermarked.ParseMarkReply(msg.Text, replyID); reply != nil {
			return a.onOwnerMark(reply, msg)
		}
	}
	if a.ownerConfirms && msg.Image {
		return nil // a picture from the owner is not a mark: only the reply with its code is
	}
	if isRelayReply(msg) {
		return nil // the approvals relay's: no reply and no record here
	}
	// B72: "terms" sends the shop terms to the owner and "I agree" records the agreement (internal/terms, modules/terms/owner.ts). Off unless the shop was handed a terms file.
	if a.kit.Terms != nil {
		if setup := a.kit.Terms(); setup != nil && terms.HandleOwner(a.ctx, runtime.TermsMessage(msg), a.termsDeps(setup)) {
			return nil
		}
	}
	// TODO(go-bk-agent): the handover code (approvals/handover.ts) reads the owner's words before the commands
	if dayToday.MatchString(msg.Text) {
		a.tellDay("today")
		return nil
	}
	if dayTomorrow.MatchString(msg.Text) {
		a.tellDay("tomorrow")
		return nil
	}
	// item 11e: the shop's assistant reads what no fixed phrase is (this command is one); a shop without an "assistant" block: exactly as before
	// E1: the owner's answer to a price card names the booking and the card's code (agent_discounts.go); a shop with no "discounts" block reads it as before
	if a.settings.Discounts != nil {
		if m := discountCommand.FindStringSubmatch(msg.Text); m != nil {
			return a.onDiscountAnswer(strings.ToLower(m[1]), m[2], strings.ToUpper(m[3]))
		}
	}
	if a.settings.Assistant != nil && !ownerCommand.MatchString(msg.Text) {
		if as := a.assistantOf(); as != nil {
			taken, err := as.OnOwnerMessage(msg)
			if err != nil {
				return err
			}
			if a.stepErr != nil {
				return a.stepErr
			}
			if taken {
				return nil
			}
		}
	}
	m := ownerCommand.FindStringSubmatch(msg.Text)
	var b *Booking
	command, ref := "", ""
	if m != nil {
		command, ref = strings.ToLower(m[1]), m[2]
		b = a.store.Booking(strings.ToLower(m[2]))
	}
	var said map[string]string
	if command != "" {
		said = map[string]string{"command": command}
	}
	var commandIn, refIn any
	if command != "" {
		commandIn, refIn = command, ref
	}
	if b != nil && command != "" && command != "retry" && a.settings.Discounts != nil && len(b.Pending) == 0 {
		if d := askedDeal(b); d != nil {
			// E1: a price card waits on this booking and its answer needs the card's code: the owner is told the exact words, and nothing is done
			a.log(b, a.owner(), "owner_decision", "blocked", map[string]any{"command": commandIn}, logMore{refs: said, notes: "a price card waits on this booking: its answer names the card's code"})
			a.tellOwner(b, b.Customer, "owner_discount_use_code", sayOpts{})
			return nil
		}
	}
	a.log(b, a.owner(), "owner_decision", "attempted", map[string]any{"command": commandIn, "ref": refIn}, logMore{refs: said})
	if b == nil || command == "" || len(b.Pending) == 0 {
		a.log(b, a.owner(), "owner_decision", "blocked", map[string]any{"command": commandIn}, logMore{notes: "not a command for something waiting on the owner", refs: said})
		a.sayOwner([]string{"owner_unknown_command"}, sayExtra{}, "")
		return nil
	}
	pending := b.Pending[0]
	switch k := pending.PendingKind(); {
	case k == "calendar":
		if command == "deny" {
			a.sayOwner([]string{"owner_unknown_command"}, sayExtra{}, "")
			return nil
		}
		if command == "retry" {
			a.log(b, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said})
			return a.completeBooking(b) // sends "booked" only if the calendar now shows it
		}
		// approve: cancel the booking and give the deposit back
		b.Pending = []payments.Pending{}
		a.releaseSlot(b, "the owner cancelled a booking the calendar could not confirm")
		b.setReminders([]Reminder{})
		_ = b.MoveTo(Cancelled)
		a.log(b, b.Customer, "cancel_booking", "confirmed", map[string]any{"by": "owner"})
		amountInr := *b.DepositInr
		limit := CheckRefundLimit(amountInr, a.settings.Cancellation.RefundLimitInr, amountInr, true, true)
		a.log(b, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said})
		if a.ownerRefunds {
			a.oweBack(b, b.DepositPaymentID, amountInr*100, "the owner cancelled a booking the calendar could not confirm", oweOpts{customer: "upi_cancelled_refund_owed", decisions: []Decision{limit}})
			return nil
		}
		result, err := a.requestRefund(b, b.DepositPaymentID, amountInr, []Decision{limit}, a.refunds.OverLimit(amountInr), nil)
		if err != nil {
			return err
		}
		a.afterRefund(b, result, payments.RefundAfter{PaymentID: b.DepositPaymentID, AmountInr: amountInr, DoneCust: "cancelled_refund", Held: "cancelled_refund_pending"})
		return nil
	case k == "guard_hold" || k == "refund_retry":
		notes := "this refund is being sent again by itself"
		if k == "guard_hold" {
			notes = "this refund is held by Guard: it is answered with the code in the approval message, not with the booking reference"
		}
		a.log(b, a.owner(), "owner_decision", "blocked", map[string]any{"command": command}, logMore{notes: notes, refs: said})
		return nil
	}
	r := OwnerRefundOf(pending)
	if command == "retry" || r == nil {
		a.sayOwner([]string{"owner_unknown_command"}, sayExtra{}, "")
		return nil
	}
	if command == "deny" {
		b.Pending = b.Pending[1:]
		// the deposit stays with the shop: the books move it from the customer's deposit to "kept from a cancellation"
		a.post(BookEvent{Kind: "kept", Case: b.ID, AmountPaise: r.AmountInr * 100, Why: "late_cancellation"}, func(m map[string]string) {
			a.log(b, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{notes: "the owner declined the refund", refs: mergeRefs(said, m)})
		})
		a.tellCustomer(b, b.Customer, []string{"refund_denied"}, sayOpts{})
		return nil
	}
	limit := CheckRefundLimit(r.AmountInr, a.settings.Cancellation.RefundLimitInr, r.AmountInr, true, true)
	a.log(b, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said})
	keep := b.Pending[:0]
	for _, p := range b.Pending {
		if p != pending {
			keep = append(keep, p)
		}
	}
	b.Pending = keep
	if a.ownerRefunds {
		a.oweBack(b, r.PaymentID, r.AmountInr*100, "the owner approved a refund after a late cancellation", oweOpts{customer: "upi_refund_owed", decisions: []Decision{limit}})
		return nil
	}
	result, err := a.requestRefund(b, r.PaymentID, r.AmountInr, []Decision{limit}, a.refunds.OverLimit(r.AmountInr), nil)
	if err != nil {
		return err
	}
	a.afterRefund(b, result, payments.RefundAfter{PaymentID: r.PaymentID, AmountInr: r.AmountInr, DoneCust: "refund_approved", Held: "cancelled_refund_pending"})
	return nil
}

// ---- STOP, and a voice note ------------------------------------------------------------------------------------------------------------------------------------------

func (a *Agent) onStop(phone string) error {
	a.store.Customer(phone).OptedOut = true
	a.log(nil, phone, "opt_out", "confirmed", map[string]any{"by": "STOP"}, logMore{notes: "no more messages to this customer, not even a reply; any reminder that falls due is stopped by the limits"})
	a.tellOwner(nil, phone, "owner_opted_out", sayOpts{})
	return nil
}

// termsDeps is agent.ts's handleOwnerTerms call: the shop's terms now, the agent's messaging, its record and its log (the case is none).
func (a *Agent) termsDeps(setup *terms.File) terms.Deps {
	return terms.Deps{
		Setup: setup, ShopName: a.settings.Name, OwnerNumber: a.owner(), OwnerLanguage: a.settings.Owner.Language, Messaging: runtime.TermsMessaging(a.msg), Record: runtime.TermsRecord(a.c.Rec.Entries),
		Log: func(action, outcome string, inputs any, more terms.LogMore) {
			a.log(nil, a.owner(), action, outcome, inputs, logMore{notes: more.Notes, refs: more.Refs})
		},
	}
}

// listen is agent.ts's shared listener (turn.ts createListener): the owner and the other approvers type their commands, and a customer who sent STOP is not listened to.
func (a *Agent) listen(msg messaging.InboundMessage) *speech.Heard {
	c := a.store.FindCustomer(msg.From)
	return a.c.Listen(a.kit.Voice, msg, nil, msg.From == a.owner(), c != nil && c.OptedOut)
}

// onVoiceNote is agent.ts onVoiceNote: a voice note that was not used. With the shop's assistant and a voice service the owner's note is read as their typed words (or they are
// told it could not be made out); otherwise the sender gets one plain line asking them to type, in the language this conversation already uses. The record says why, and what
// listening cost (a priced call is counted as a rules-read message, so the cost meter sees the spend). STOP means STOP. tried is what listening came to (nil: not tried).
func (a *Agent) onVoiceNote(msg messaging.InboundMessage, tried *speech.Heard) error {
	phone := msg.From
	if phone == a.owner() && a.settings.Assistant != nil {
		if as := a.assistantOf(); as != nil {
			if heard := as.HearOwner(msg); heard != nil {
				if heard.Text == "" {
					return nil
				}
				return a.onOwnerMessage(*heard)
			}
		}
	}
	if phone == a.owner() {
		a.sayOwner([]string{"voice_note"}, sayExtra{}, "voice_note_reply")
		return nil
	}
	c := a.store.Customer(phone)
	refs := map[string]string{"messageId": msg.ID}
	notes := "a voice note: it is not listened to and nothing of it is kept"
	if tried != nil && !tried.OK {
		refs = mergeRefs(refs, speech.FailedMarks(*tried))
		notes = "a voice note that could not be used (" + speech.Why[tried.Reason] + "); the audio was held in memory for the call only and nothing of it is kept"
	}
	a.log(nil, phone, "receive_message", "confirmed", map[string]any{"voiceNote": true, "id": msg.ID}, logMore{notes: notes, refs: refs})
	if c.OptedOut {
		return nil
	}
	// where voice is on the line says it could not be made out; where it is off, that voice notes cannot be listened to
	line := "voice_note"
	if a.kit.Voice != nil {
		line = "voice_note_retry"
	}
	a.tellCustomer(nil, phone, []string{line}, sayOpts{action: "voice_note_reply"})
	return nil
}

// budgetPaused is reader.ts readIntent's steps to leave out: a step that keeps failing, and the language model under fleet's cap, the month's budget or the router's daily cap.
func budgetPaused(ai **budget.AI, c *runtime.StepContext, now int64) []string {
	skip := budget.PausedSteps(ai, c.Clock, now)
	if budget.ModelOff(ai, c.Policy, c.Clock, now) != "" || budget.Gate(ai, c.Policy.Budget, "router", c.Clock, now, "") != "" {
		skip = append(skip, "model")
	}
	return skip
}

// budgetButtons is reader.ts mode().buttons: the shop reads with the rules alone (the allowance is used, the outside switch says so, or a model failed a moment ago).
func budgetButtons(ai **budget.AI, c *runtime.StepContext, now int64) bool {
	b, _ := budget.Buttons(ai, c.Policy, c.Clock, now)
	return b
}

// isoTime is `new Date(ms).toISOString()`.
func isoTime(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }
