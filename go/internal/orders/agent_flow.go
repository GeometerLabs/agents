package orders

// The order: reading a customer's message (onMessage over the reader), what the customer asked for (fill, the slot a time means, a price named), the limits about the order itself
// (availability: the cut-off, the day's stock, the shelf count, the day's cap, a slot's own limit), asking for exactly the next thing (proceed), the big-order line, the hold and the
// advance (proceedToHold), the address, yes and no, STOP and a voice note: agent.ts's sections "the order", "the hold and the advance", "STOP", "a voice note" and onMessage.
// OnMessage is the entry the chat calls too (W1: a chat guest's send runs as the SAME step as a WhatsApp customer's message).
//
// Where Go and JavaScript differ: the regular expressions use language.JSSpace for JavaScript's `\s`; `\d` is ASCII in both (a `u` regular expression's `\d` is [0-9]).

import (
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/discounts"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/reading"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/understanding"
	"github.com/GeometerLabs/agents/go/internal/voice"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// Minute and Hour are core/time.ts MINUTE and HOUR.
const (
	Minute = zone.Minute
	Hour   = zone.Hour
)

// flowCtx is agent.ts Ctx: what a step tells the customer along with the words that ask for what is missing (a prefix, the decisions shown, the item a price floor named).
type flowCtx struct {
	prefix []string
	shown  []Decision
	itemID string
}

func cat(a []string, b ...string) []string { return append(append([]string{}, a...), b...) }

func catD(a []Decision, b ...Decision) []Decision { return append(append([]Decision{}, a...), b...) }

// inputs is a record's inputs object with the members JavaScript would leave out (an undefined value) left out: a nil value here.
func inputs(kv ...any) map[string]any {
	m := map[string]any{}
	for i := 0; i+1 < len(kv); i += 2 {
		v := kv[i+1]
		switch x := v.(type) {
		case nil:
			continue
		case *LocalDate:
			if x == nil {
				continue
			}
		case *int64:
			if x == nil {
				continue
			}
		}
		m[kv[i].(string)] = v
	}
	return m
}

// optS is a text member that is undefined when empty.
func optS(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---- reading a message -----------------------------------------------------------------------------------------------------------------------------------------------

// readIntent is reader.ts readIntent over the router (internal/understanding over this shop's Reading): the rules first, then the decision model and the language model, each
// only when the month's AI state allows it; whatever answers is coerced (coerceIntent), and an answer that is not an Intent is "unknown" with the reader's note.
func (a *Agent) readIntent(text string, rulesOnly bool) (reading.Intent, string, understanding.Understood) {
	var in reading.Intent
	note := ""
	u := understanding.Rules()
	if a.kit.Router == nil || a.c.Snap == nil {
		in = reading.ParseIntent(text, a.parse)
	} else {
		now := a.now()
		r := *a.kit.Router
		r.Reading = reading.Reading{C: a.parse}
		var reason string
		in, u, reason = r.Parse(text, understanding.Options{RulesOnly: rulesOnly, SkipSteps: budgetPaused(&a.c.Snap.AI, a.c, now)}, now)
		if reason != "" {
			note = "the model could not be used (" + reason + "), so the rule parser read the message"
		}
	}
	if c := a.coerce(in); c != nil {
		return *c, note, u
	}
	return reading.Intent{Kind: "unknown"}, "the parser's answer was not a valid intent, so the message was treated as not understood", u
}

// coerce is coerceIntent on an intent as JSON (the shape the TypeScript hands it).
func (a *Agent) coerce(in reading.Intent) *reading.Intent {
	var raw any
	b, _ := in.MarshalJSON()
	_ = json.Unmarshal(b, &raw)
	return reading.CoerceIntent(raw, a.parse)
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

// OnMessage is agent.ts onMessage: a customer's (or the owner's) WhatsApp message.
func (a *Agent) OnMessage(msg messaging.InboundMessage) error { return a.onMessage(msg, nil, nil) }

// onMessage is agent.ts onMessage with a chat guest's recording (W1 hold-to-talk) and the bubble's words heard; both nil for a WhatsApp message.
func (a *Agent) onMessage(msg messaging.InboundMessage, audio *runtime.PageAudio, onHeard func(string)) error {
	if contains(a.store.SeenMessages, msg.ID) {
		a.log(nil, msg.From, "receive_message", "blocked", map[string]any{"id": msg.ID}, logMore{notes: "the same WhatsApp message was delivered again, so it is ignored"})
		return nil
	}
	a.store.SeenMessages = append(a.store.SeenMessages, msg.ID)
	// B37: another approver's "approve K7M2QX" is the approvals relay's (the inbox gives it a copy): no reply and no record here, as for the owner's
	if a.approverDigits()[digitsOf(msg.From)] && isRelayReply(msg) {
		return nil
	}
	// B29: a voice note is turned into the words it says and then read exactly like a typed message
	var heard *voice.Heard
	if msg.VoiceNote {
		h := a.listen(msg, audio)
		if h == nil || !h.OK {
			return a.onVoiceNote(msg, h)
		}
		heard = h
		if onHeard != nil {
			onHeard(h.Text) // a chat guest's bubble shows the words heard
		}
		msg = messaging.InboundMessage{ID: msg.ID, From: msg.From, Text: h.Text, Timestamp: msg.Timestamp, NoModel: msg.NoModel}
	}
	if msg.From == a.owner() {
		return a.onOwnerMessage(msg)
	}
	if msg.Image {
		return a.onPicture(msg)
	}
	phone := msg.From
	customer := a.store.Customer(phone)
	buttons := a.c.Snap != nil && budgetButtons(&a.c.Snap.AI, a.c, a.now())
	// UPI: "I paid" while an advance waits is read from a few plain words before any model; it is a claim, and the owner is asked to look. It marks nothing paid.
	// (a pickup-hold shop takes no advance, so "I paid" there is not a claim about one: it is read like any other message)
	if a.ownerConfirms && !a.settings.NoAdvance() && msg.Reply == nil && !customer.OptedOut && reading.IsPaidClaim(msg.Text) && a.store.LatestOrder(phone, []string{AwaitingAdvance}) != nil {
		in, refs := map[string]any{"text": msg.Text, "id": msg.ID}, map[string]string{"messageId": msg.ID, "step": "rules"}
		if heard != nil {
			in["voice"] = true
			refs = mergeRefs(refs, voice.Marks(*heard))
			refs["costMicroInr"] = strconv.FormatInt(heard.CostMicroInr, 10)
		}
		a.log(nil, phone, "receive_message", "confirmed", in, logMore{refs: refs})
		return a.onPaidClaim(phone, "words", "")
	}
	// monthly plans (17 Nov 2026): a shop with a `plans` block reads a message about a plan from plain words, before any model (G3's seam)
	if p := a.plansOf(); p != nil && msg.Reply == nil && !customer.OptedOut {
		taken, err := p.OnMessage(phone, msg.Text, a.languageOf(phone, nil))
		if err != nil || taken {
			return err
		}
	}
	// a delivery order waits for an address: the next plain message is it, unless it is a stop, a cancel, a request to talk to the owner, or a change to pickup
	if msg.Reply == nil && !customer.OptedOut {
		if addressing := a.store.LatestOrder(phone, []string{Enquiry}); addressing != nil && addressing.AwaitingAddress {
			ruled := reading.ParseIntent(msg.Text, a.parse)
			if !contains([]string{"stop", "cancel", "refund", "owner"}, ruled.Kind) && ruled.Mode != Pickup {
				a.log(nil, phone, "receive_message", "confirmed", map[string]any{"id": msg.ID, "address": true}, logMore{refs: map[string]string{"messageId": msg.ID, "step": "rules"}, notes: "the message is the delivery address"})
				return a.onAddress(addressing, msg.Text)
			}
		}
	}
	// a tap on a button or a list row is read by looking its id up: no words are read, so no model is asked, whatever the mode; an id that is none of ours is read as words
	var tapped *reading.Intent
	if msg.Reply != nil {
		tapped = reading.IntentFromReply(msg.Reply.ID, a.parse)
	}
	var in reading.Intent
	note := ""
	u := understanding.Rules()
	if tapped != nil {
		in = *tapped
	} else {
		// an opted-out customer gets no reply, so no model is paid to read it; a chat guest past the day's model turns is read by the rules alone
		in, note, u = a.readIntent(msg.Text, buttons || customer.OptedOut || msg.NoModel)
	}
	if a.c.Snap != nil {
		runtime.CountUnderstood(&a.c.Snap.AI, a.c.Policy, a.c.Clock, a.now(), u)
	}
	said := in.Language != "" && contains(a.settings.Languages, in.Language)
	if said {
		customer.Language = in.Language
	}
	if heard != nil && customer.Language == "" && !said && contains(a.settings.Languages, heard.Language) {
		customer.Language = heard.Language // the language they spoke, when the words do not say
	}
	var notes []string
	if note != "" {
		notes = append(notes, note)
	}
	if heard != nil {
		notes = append(notes, "the customer sent a voice note; this is its transcript")
	}
	if in.OverrideAttempt != nil && *in.OverrideAttempt {
		notes = append(notes, "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing")
	}
	refs := mergeRefs(map[string]string{"messageId": msg.ID}, u.Refs())
	if tapped != nil {
		refs["via"] = msg.Reply.Kind
	}
	recIn := map[string]any{"text": msg.Text, "id": msg.ID}
	if tapped != nil {
		recIn["reply"] = msg.Reply.ID
	}
	// B29: the record keeps what it keeps for typed text, plus that it came by voice, who listened and for how long, and the cost added to the message's own
	if heard != nil {
		recIn["voice"] = true
		understood, has := refs["costMicroInr"]
		refs = mergeRefs(refs, voice.Marks(*heard))
		if has {
			n, _ := strconv.ParseFloat(understood, 64)
			refs["costMicroInr"] = strconv.FormatInt(int64(n)+heard.CostMicroInr, 10)
		}
	}
	a.log(nil, phone, "receive_message", "confirmed", recIn, logMore{notes: strings.Join(notes, "; "), refs: refs})
	defer a.announceButtonMode() // after the customer has their answer (agent.ts's `finally`)

	if in.Kind == "stop" {
		return a.onStop(phone)
	}
	if customer.OptedOut {
		return nil // STOP means STOP: nothing goes to them, even if they write again
	}
	if in.AskDiscount && a.settings.Discounts != nil && (in.Kind == "unknown" || in.Kind == "greeting") {
		in.Kind = "order" // E1: "any discount?" in a shop with the discount authority is about the order (offerPrice answers it); without one, exactly as before
	}
	switch in.Kind {
	case "order":
		return a.onOrder(phone, &in)
	case "yes":
		return a.onYes(phone)
	case "no":
		return a.onNo(phone)
	case "cancel":
		if in.Ask != nil && *in.Ask {
			return a.onCancelAsk(phone)
		}
		return a.onCancel(phone)
	case "refund":
		return a.onCancelAsk(phone)
	case "owner":
		return a.onTalkToOwner(phone)
	case "keep":
		return a.onKeep(phone)
	case "paid":
		if a.settings.NoAdvance() {
			// the pickup hold: nothing is paid ahead, so "I have paid" is answered with where the hold stands (agent_hold.go)
			if w := a.store.LatestOrder(phone, []string{AwaitingAdvance, AwaitingOwner}); w != nil {
				a.tellAlreadyWaiting(w)
				return nil
			}
			a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: itemsOffer("didnt_understand")})
			return nil
		}
		if a.ownerConfirms {
			return a.onPaidClaim(phone, "button", "")
		}
		return a.onPaidReadBack(phone)
	case "greeting":
		if !a.takesNewWork() {
			a.pausedReply(phone, "menu", nil)
			return nil
		}
		a.tellCustomer(nil, phone, []string{"menu"}, sayOpts{offer: itemsOffer("pick_items")})
		return nil
	}
	if !a.takesNewWork() {
		a.pausedReply(phone, "menu", nil)
		return nil
	}
	// block M: the shop's talk may answer, from what customers may be told (false: the talk is off, a check failed, or nothing was said; the menu goes as before)
	if msg.Reply == nil && !msg.NoModel && a.talkToCustomer(phone, msg.Text, in.OverrideAttempt != nil && *in.OverrideAttempt) {
		return a.stepErr
	}
	// the pickup hold: words the reader cannot place (a model number, an item not listed by that name) go to the owner, who picks the listed item (agent_hold.go)
	if msg.Reply == nil && a.wordsStartHold(phone, msg.Text) {
		return a.startHoldEnquiry(phone, "words")
	}
	a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: itemsOffer("didnt_understand")})
	return nil
}

// ---- the order: what the customer asked for --------------------------------------------------------------------------------------------------------------------------

// resolveDate is dates.ts resolveDate over the shop's zone: the date and whether the customer is asked to confirm it (a weekday is; a relative or written date is not); ok false for
// a date that does not exist (31 November).
func (a *Agent) resolveDate(p language.DatePhrase) (zone.Date, bool, bool) {
	today := zone.LocalParts(a.now(), a.settings.Timezone)
	if p.Kind == "relative" {
		return zone.AddDays(today.Date, p.Offset), false, true
	}
	if p.Kind == "calendar" {
		year := today.Year
		if zone.DaysBetween(today.Date, zone.Date{Year: year, Month: p.Month, Day: p.Day}) < 0 {
			year++ // already gone this year: next year
		}
		if check := zone.AddDays(zone.Date{Year: year, Month: p.Month, Day: 1}, p.Day-1); check.Month != p.Month {
			return zone.Date{}, false, false
		}
		return zone.Date{Year: year, Month: p.Month, Day: p.Day}, false, true
	}
	monday := func(d int) int { return (d + 6) % 7 } // weeks run Monday (0) to Sunday (6)
	target, now := monday(p.Weekday), monday(today.Weekday)
	var offset int
	switch p.Which {
	case "next":
		offset = 7 - now + target
	case "this":
		offset = target - now
		if target < now {
			offset += 7
		}
	default:
		offset = (target - now + 7) % 7
		if offset == 0 {
			offset = 7
		}
	}
	return zone.AddDays(today.Date, offset), true, true
}

// datePhraseOf is an Intent's date as language.DatePhrase.
func datePhraseOf(m map[string]any) *language.DatePhrase {
	if m == nil {
		return nil
	}
	n := func(k string) int { f, _ := m[k].(float64); return int(f) }
	kind, _ := m["kind"].(string)
	which, _ := m["which"].(string)
	return &language.DatePhrase{Kind: kind, Offset: n("offsetDays"), Weekday: n("weekday"), Which: which, Day: n("day"), Month: n("month")}
}

type slotHit struct{ id, mode string }

func pad2(n int) string {
	if n < 10 && n >= 0 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// slotForTime is agent.ts slotForTime: the slot a time the customer typed means ("1 pm" is the slot that starts at 1 pm), among the slots of the way (or both ways).
func (a *Agent) slotForTime(mode string, t map[string]any) []slotHit {
	hf, _ := t["hour"].(float64)
	mf, _ := t["minute"].(float64)
	period, _ := t["period"].(string)
	hour, minute := int(hf), int(mf)
	var hours []int
	switch {
	case period == "pm":
		if hour == 12 {
			hours = []int{12}
		} else {
			hours = []int{hour + 12}
		}
	case period != "":
		if hour == 12 {
			hours = []int{0}
		} else {
			hours = []int{hour}
		}
	case hour >= 1 && hour <= 11:
		hours = []int{hour, hour + 12}
	default:
		hours = []int{hour}
	}
	var out []slotHit
	for _, x := range a.settings.AllSlots() {
		if mode != "" && x.Mode != mode {
			continue
		}
		for _, h := range hours {
			if x.Slot.From == pad2(h)+":"+pad2(minute) || x.Slot.From == strconv.Itoa(h)+":"+pad2(minute) {
				out = append(out, slotHit{x.Slot.ID, x.Mode})
				break
			}
		}
	}
	return out
}

// fill is agent.ts fill: put what the customer said into the draft. False when a date does not exist (31 November). It may change the intent (a delivery the shop does not make is
// dropped from it), as the TypeScript does.
func (a *Agent) fill(o *Order, in *reading.Intent) bool {
	s := a.settings
	if len(in.Items) > 0 {
		o.Lines = []OrderLine{}
		for _, l := range in.Items {
			AddLine(&o.Lines, l.ItemID, int64(l.Qty))
		}
	}
	if dp := datePhraseOf(in.Date); dp != nil {
		d, confirm, ok := a.resolveDate(*dp)
		if !ok {
			return false
		}
		ld := DateOf(d)
		o.Date, o.DateNeedsConfirmation = &ld, confirm
	}
	if in.Mode == Delivery && s.Delivery == nil {
		in.Mode = "" // the shop does not deliver
	}
	if in.Mode != "" && in.Mode != o.Mode {
		o.Mode = in.Mode
		if o.SlotID != "" {
			if x, ok := s.SlotOf(o.SlotID); !ok || x.Mode != o.Mode {
				o.SlotID = ""
			}
		}
		if o.Mode == Pickup {
			o.Area, o.Address, o.AwaitingAddress = "", "", false
		}
	}
	if in.SlotID != "" {
		o.SlotID = in.SlotID
		if x, ok := s.SlotOf(in.SlotID); ok {
			o.Mode = x.Mode
		}
	} else {
		var found []slotHit
		switch {
		case in.SlotIDs != nil: // `intent.slotIds ?`: an empty list is still a list (truthy), so a time is not read then
			for _, id := range in.SlotIDs {
				if x, ok := s.SlotOf(id); ok && (o.Mode == "" || x.Mode == o.Mode) {
					found = append(found, slotHit{id, x.Mode})
				}
			}
		case in.Time != nil:
			found = a.slotForTime(o.Mode, in.Time)
		}
		modes := map[string]bool{}
		for _, f := range found {
			modes[f.mode] = true
		}
		if len(found) > 0 && len(modes) == 1 {
			o.SlotID, o.Mode = found[0].id, found[0].mode
		}
	}
	if in.SlotIDs != nil && o.SlotID == "" {
		o.SlotCandidates = append([]string{}, in.SlotIDs...)
	}
	if o.SlotID == "" && o.Mode != "" && o.SlotCandidates != nil {
		for _, id := range o.SlotCandidates {
			if x, ok := s.SlotOf(id); ok && x.Mode == o.Mode {
				o.SlotID = id
				break
			}
		}
	}
	if o.SlotID != "" {
		o.SlotCandidates = nil
	}
	return true
}

// offerPrice is agent.ts offerPrice: a price named is about the first item, one unit; the quote is always the menu price. E1: with a "discounts" block, a price below the
// menu goes to the discount authority instead (agent_discounts.go), and stop is true when the order now waits for the owner's answer; without one, exactly as before.
func (a *Agent) offerPrice(o *Order, in *reading.Intent, ctx *flowCtx) (stop bool) {
	if in.OfferInr == nil && in.AskDiscount && a.settings.Discounts != nil {
		return a.offerCap(o, ctx) // E1: "any discount?" with no price named (agent_discounts.go)
	}
	if in.OfferInr == nil || len(o.Lines) == 0 {
		return false
	}
	item := a.settings.ItemOf(o.Lines[0].ItemID)
	if item == nil {
		return false
	}
	if a.settings.Discounts != nil {
		if *in.OfferInr < item.PriceInr {
			return a.decideOffer(o, item, *in.OfferInr, ctx)
		}
		o.setDeal(nil) // the customer takes the menu price: whatever was asked before is void
	}
	d := checkPriceAtOrAboveMenu(ItemName(item, "en"), item.PriceInr, *in.OfferInr)
	ctx.shown = append(ctx.shown, d)
	if blocked(d) {
		ctx.prefix = append(ctx.prefix, "price_floor")
		ctx.itemID = item.ID
	}
	return false
}

// probeOpen is `fixSlot(settings, probe) && probe.cutoffMs! > now` for a slot on a date: whether its cut-off has not passed.
func (a *Agent) probeOpen(date LocalDate, slotID string, now int64) bool {
	d := date
	probe := &Order{Date: &d, SlotID: slotID}
	return a.settings.FixSlot(probe) && *probe.CutoffMs > now && (!a.settings.NoAdvance() || *probe.SlotEndMs > now) // a pickup hold: a slot already over is not offered
}

// slotIsFull is agent.ts slotIsFull: a slot with a limit of its own whose places are all taken for that day.
func (a *Agent) slotIsFull(date LocalDate, slotID string) bool {
	x, ok := a.settings.SlotOf(slotID)
	return ok && x.Slot.MaxOrders != nil && int64(a.store.OrdersInSlot(date, slotID, a.now(), "")) >= *x.Slot.MaxOrders
}

// openWindows is agent.ts openWindows: the slots of a way whose cut-off has not passed on a date (and that are not full), as windows a list can offer.
func (a *Agent) openWindows(mode string, date LocalDate) []words.WindowRow {
	out := []words.WindowRow{}
	now := a.now()
	for _, w := range a.settings.SlotMoments(mode, date) {
		if a.probeOpen(date, w.ID, now) && !a.slotIsFull(date, w.ID) {
			out = append(out, words.WindowRow{ID: w.ID, FromMs: w.FromMs, ToMs: w.ToMs})
		}
	}
	return out
}

// availability is agent.ts Availability: blocked is the template that says no ("" when nothing blocks), with what it needs; decisions every limit asked.
type availability struct {
	blocked   string
	more      sayOpts
	decisions []Decision
}

// availability is agent.ts availability: the limits about the order itself (the cut-off, the stock of every item, the shelf count, the day's count, a slot's own limit), the
// slot's moments fixed first.
func (a *Agent) availability(o *Order) availability {
	now := a.now()
	a.reconcileStock() // the shelf count first, so what the orders so far took is in it
	var ds []Decision
	a.settings.FixSlot(o)
	cut := allow("before-cutoff", "The cut-off for that day and slot has not passed.") // `now >= undefined` is false: no cut-off fixed is not past
	if o.CutoffMs != nil {
		closes := *o.CutoffMs
		if a.settings.NoAdvance() && o.SlotEndMs != nil && *o.SlotEndMs < closes {
			closes = *o.SlotEndMs // a pickup hold: nothing is kept for a pickup time that has already ended, whatever the cut-off says (agent_hold.go)
		}
		cut = checkBeforeCutoff(now, closes)
	}
	ds = append(ds, cut)
	if blocked(cut) {
		return availability{"after_cutoff", sayOpts{}, ds}
	}
	if o.Date == nil {
		return availability{"", sayOpts{}, ds}
	}
	var count = a.stockCount()
	for _, l := range o.Lines {
		item := a.settings.ItemOf(l.ItemID)
		if item == nil {
			continue
		}
		taken := a.store.TakenOf(*o.Date, l.ItemID, now, o.ID)
		if a.settings.NoAdvance() {
			taken = a.store.HeldAnyDay(l.ItemID, now, o.ID) // a pickup hold keeps a unit off the shelf whatever day it is for (agent_hold.go)
		}
		d := checkStock(ItemName(item, "en"), l.Qty, taken, item.DailyStock)
		ds = append(ds, d)
		if blocked(d) {
			left := max(0, item.DailyStock-taken)
			id := "out_of_stock"
			if left == 0 {
				id = "sold_out"
			}
			return availability{id, sayOpts{itemID: item.ID, leftCount: &left}, ds}
		}
		// an item the owner counts (modules/stock): the shelf count, less what other orders hold that is not yet in it, is a second limit, with the same rule id as the day's stock
		if shelf, counted := a.store.CountedLeft(count, item.ID, now, o.ID); counted {
			dc := checkStock(ItemName(item, "en"), l.Qty, 0, shelf)
			ds = append(ds, dc)
			if blocked(dc) {
				id := "out_of_stock"
				if shelf == 0 {
					id = "sold_out"
				}
				left := shelf
				return availability{id, sayOpts{itemID: item.ID, leftCount: &left}, ds}
			}
		}
	}
	dc := checkDayCap(a.store.OrdersOn(*o.Date, now, o.ID), a.settings.Orders.MaxPerDay)
	ds = append(ds, dc)
	if blocked(dc) {
		return availability{"day_full", sayOpts{}, ds}
	}
	// a slot's own limit, in the same step as the order (17 Nov 2026): only for a slot that has one, so every other order's record is as it was
	if x, ok := a.settings.SlotOf(o.SlotID); ok && x.Slot.MaxOrders != nil {
		sc := checkSlotCap(a.store.OrdersInSlot(*o.Date, o.SlotID, now, o.ID), x.Slot.MaxOrders)
		ds = append(ds, sc)
		if blocked(sc) {
			return availability{"slot_full", sayOpts{}, ds}
		}
	}
	return availability{"", sayOpts{}, ds}
}

// merged is a blocked template's options with the step's own (agent.ts `{shown, itemId, ...more}`): what the block names wins.
func merged(base sayOpts, more sayOpts) sayOpts {
	if more.itemID != "" {
		base.itemID = more.itemID
	}
	if more.leftCount != nil {
		base.leftCount = more.leftCount
	}
	return base
}

// proceed is agent.ts proceed: ask for what is missing, or go on to the checks and the hold. Each time round, it asks for exactly the next thing.
func (a *Agent) proceed(o *Order, ctx *flowCtx) error {
	phone := o.Customer
	now := a.now()
	s := a.settings
	say1 := func(templates []string, more sayOpts) {
		opts := merged(sayOpts{shown: catD(ctx.shown), itemID: ctx.itemID}, more)
		opts.offer, opts.areas = more.offer, more.areas
		a.tellCustomer(o, phone, cat(ctx.prefix, templates...), opts)
	}
	if len(o.Lines) == 0 {
		if holdPickOn(o) != nil {
			say1([]string{"hold_still_asking"}, sayOpts{}) // the pickup hold: the owner has not yet said which listed item the photo shows
			return nil
		}
		say1([]string{"menu"}, sayOpts{offer: itemsOffer(cat(ctx.prefix, "pick_items")...)})
		return nil
	}
	if size := checkOrderSize(CountOf(o.Lines), s.Orders.MaxItemsPerOrder); blocked(size) {
		ctx.shown = append(ctx.shown, size)
		o.Lines = []OrderLine{}
		say1([]string{"too_many_items"}, sayOpts{offer: itemsOffer("too_many_items")})
		return nil
	}
	// E1: a price asked on this order is held to the order as it is now (a changed order is decided again); while the owner's card waits nothing more happens
	if s.Discounts != nil && a.checkDeal(o, ctx) {
		return nil
	}
	if o.Date == nil {
		say1([]string{"ask_when"}, sayOpts{})
		return nil
	}
	ahead := zone.DaysBetween(zone.LocalParts(now, s.Timezone).Date, o.Date.Zone())
	if ahead < 0 || int64(ahead) > s.Orders.DaysAhead {
		o.Date, o.DateNeedsConfirmation = nil, false
		say1([]string{"ask_when"}, sayOpts{})
		return nil
	}
	if o.DateNeedsConfirmation {
		say1([]string{"confirm_details"}, sayOpts{offer: yesNo(cat(ctx.prefix, "confirm_buttons")...)})
		return nil
	}
	if o.Mode == "" {
		if s.Delivery == nil {
			o.Mode = Pickup
		} else {
			say1([]string{"ask_how"}, sayOpts{offer: &offer{kind: "buttons", buttons: []string{"pickup", "delivery"}, body: cat(ctx.prefix, "ask_how")}})
			return nil
		}
	}
	if o.SlotID == "" {
		windows := a.openWindows(o.Mode, *o.Date)
		modeSlots := s.SlotsOf(o.Mode)
		var full *Slot
		for i := range modeSlots {
			if a.probeOpen(*o.Date, modeSlots[i].ID, now) && a.slotIsFull(*o.Date, modeSlots[i].ID) {
				full = &modeSlots[i]
				break
			}
		}
		if len(windows) == 0 && full != nil {
			// every slot still open that day is full (a slot's own limit), which is not the same as closed: say so for the first full one, and ask for another day
			o.SlotID = full.ID
			s.FixSlot(o)
			ctx.shown = append(ctx.shown, checkSlotCap(a.store.OrdersInSlot(*o.Date, full.ID, now, o.ID), full.MaxOrders))
			say1([]string{"slot_full"}, sayOpts{})
			o.SlotID = ""
			return nil
		}
		if len(windows) == 0 {
			// every slot of that day has closed: say so for the first one, and ask for another day
			if len(modeSlots) > 0 {
				o.SlotID = modeSlots[0].ID
				s.FixSlot(o)
			}
			cut := allow("before-cutoff", "The cut-off for that day and slot has not passed.")
			if o.CutoffMs != nil {
				cut = checkBeforeCutoff(now, *o.CutoffMs)
			}
			ctx.shown = append(ctx.shown, cut)
			o.SlotID = ""
			say1([]string{"after_cutoff"}, sayOpts{})
			return nil
		}
		say1([]string{"ask_slot"}, sayOpts{offer: &offer{kind: "slots", windows: windows, body: cat(ctx.prefix, "ask_slot")}})
		return nil
	}
	if o.Mode == Delivery && o.Area == "" {
		o.AwaitingAddress = true
		say1([]string{"ask_address"}, sayOpts{areas: true})
		return nil
	}
	s.FixSlot(o)
	av := a.availability(o)
	ctx.shown = append(ctx.shown, av.decisions...)
	if av.blocked != "" {
		a.log(o, phone, "check_order", "blocked", inputs("date", o.Date, "slot", optS(o.SlotID)), logMore{decisions: av.decisions})
		if av.blocked == "after_cutoff" || av.blocked == "slot_full" {
			o.SlotID = ""
		}
		say1([]string{a.holdWord(av.blocked)}, av.more)
		return nil
	}
	total := s.TotalOf(o.Lines)
	deal := o.deal() // E1: the agreed total, when a price was agreed or approved for this very order (checkDeal held it to the order above)
	if deal.Live() {
		total = deal.TotalInr
	}
	advance := s.AdvanceFor(total)
	o.TotalInr, o.AdvanceInr = &total, &advance
	if s.NoAdvance() {
		return a.askToHold(o, ctx, total) // the pickup hold: the shop's yes for every hold, so the big-order line has nothing to add (agent_hold.go)
	}
	if over := s.Owner.ApproveOverInr; over > 0 && total > over && (deal == nil || deal.State != discounts.Approved) { // the owner's yes to the card was to this exact total
		_ = o.MoveTo(AwaitingOwner)
		o.Pending = append(o.Pending, NewBigOrder(BigOrder{TotalInr: total, AskedAtMs: now}))
		a.log(o, phone, "ask_owner", "held_for_owner", map[string]any{"totalInr": total}, logMore{decisions: catD(ctx.shown),
			notes: "the order's total is above " + inr(over) + ", the line above which the owner approves an order before any payment is asked; nothing is held and no link is made until then",
			refs:  map[string]string{"to": "owner", "kind": "big_order"}})
		a.tellOwner(o, phone, "owner_big_order", sayOpts{})
		a.tellCustomer(o, phone, []string{"big_order_asked"}, sayOpts{shown: catD(ctx.shown)})
		return nil
	}
	return a.proceedToHold(o, ctx)
}

// ---- the hold and the advance ----------------------------------------------------------------------------------------------------------------------------------------

func advancePaise(o *Order) int64 {
	if o.AdvanceInr == nil {
		return 0
	}
	return *o.AdvanceInr * 100
}

// unpaidFromPages is the orders from the shop's page, its API and its chat that wait for their advance or for the owner (the per-shop cap), leaving one out.
func (a *Agent) unpaidFromPages(except string) []*Order {
	var out []*Order
	for _, x := range a.store.Orders {
		if x.ID != except && (x.Channel != "" || runtime.IsChatConversation(x.Customer)) && (x.State == AwaitingAdvance || x.State == AwaitingOwner) {
			out = append(out, x)
		}
	}
	return out
}

// proceedToHold is agent.ts proceedToHold: hold the stock, make the advance link, and send the quote. The checks are run again here: the owner's yes can come long after the order
// was asked.
func (a *Agent) proceedToHold(o *Order, ctx *flowCtx) error {
	phone := o.Customer
	now := a.now()
	if !a.takesNewWork() {
		o.SlotID = ""
		if o.State != Enquiry {
			_ = o.MoveTo(Enquiry)
		}
		a.pausedReply(phone, "hold", nil) // nothing held, nothing kept for later
		return nil
	}
	// W1: a chat guest's order counts in the shop's cap on unpaid orders, like one from the page; at the cap the guest is told so and nothing is held; the owner is not asked
	if runtime.IsChatConversation(phone) && len(a.unpaidFromPages(o.ID)) >= unpaidHoldsPerShop {
		a.log(o, phone, "channel_order", "blocked", map[string]any{"channel": "chat"}, logMore{refs: map[string]string{"channel": "chat", "reason": "shop_busy"},
			notes: "the shop already has " + strconv.Itoa(unpaidHoldsPerShop) + " unpaid orders from its page, its API and its chat; nothing more is held until one is paid, cancelled or ends"})
		if o.State != Enquiry {
			_ = o.MoveTo(Enquiry)
		}
		a.tellCustomer(o, phone, cat(ctx.prefix, "chat_shop_busy"), sayOpts{shown: catD(ctx.shown)})
		return nil
	}
	av := a.availability(o)
	if av.blocked != "" {
		a.log(o, phone, "check_order", "blocked", inputs("date", o.Date, "slot", optS(o.SlotID)), logMore{decisions: av.decisions})
		if o.State != Enquiry {
			_ = o.MoveTo(Enquiry)
		}
		if av.blocked == "after_cutoff" || av.blocked == "slot_full" {
			o.SlotID = ""
		}
		o.Pending = []payments.Pending{}
		a.holdBlocked(o)
		a.tellCustomer(o, phone, cat(ctx.prefix, a.holdWord(av.blocked)), merged(sayOpts{shown: catD(ctx.shown, av.decisions...)}, av.more))
		return nil
	}
	if a.settings.NoAdvance() {
		return a.holdForPickup(o, ctx, av) // no link and no money: the unit is kept until the end of the agreed pickup time (agent_hold.go)
	}
	if a.pay == nil {
		return runtime.Unported("an advance link on a shop with no payments service")
	}
	// the hold is the shop's time to pay, and never outlives the cut-off: after the cut-off the stock is back, whatever the hold said
	until := now + a.settings.Advance.HoldMinutes*Minute
	if o.CutoffMs != nil && *o.CutoffMs < until {
		until = *o.CutoffMs
	}
	o.HoldExpiresAt = &until
	if o.State == Enquiry || o.State == AwaitingOwner || o.State == Expired {
		_ = o.MoveTo(AwaitingAdvance)
	}
	keep := []payments.Pending{}
	for _, p := range o.Pending {
		if p.PendingKind() != "big_order" {
			keep = append(keep, p)
		}
	}
	o.Pending = keep
	a.log(o, phone, "hold_stock", "confirmed", inputs("lines", o.Lines, "date", o.Date, "slot", optS(o.SlotID), "until", until), logMore{decisions: av.decisions,
		notes: "the order's stock and its place in the day's count are held until the hold ends or the cut-off, whichever is first; they are worked out from the orders themselves, not counted"})
	amount := advancePaise(o)
	a.log(o, phone, "create_advance_link", "attempted", map[string]any{"amountPaise": amount})
	res, err := payments.EnsureLink(a.ctx, a.pay, payments.LinkRequest{Reference: o.ID, AmountPaise: amount, Description: a.settings.Name + " advance"})
	if err != nil {
		return err
	}
	if res.Link == nil && res.Suspended != nil {
		// Guard held the advance link back for the licence (ADR-0062): the shop's own pause, said as Guard's; asked once, the owner is not asked to do anything
		d := guardLicenceDecision(res.Suspended)
		a.log(o, phone, "create_advance_link", "blocked", map[string]any{"amountPaise": amount}, logMore{decisions: []Decision{d}, notes: res.Suspended.Message})
		o.HoldExpiresAt = nil
		_ = o.MoveTo(Enquiry)
		a.pausedReply(phone, "link", &d)
		return nil
	}
	if res.Link == nil {
		outcome, notes := "unconfirmed", "the payments service does not show the link"
		if res.Error != "" {
			outcome, notes = "failed", res.Error
		}
		a.log(o, phone, "create_advance_link", outcome, map[string]any{"amountPaise": amount}, logMore{notes: notes})
		o.HoldExpiresAt = nil
		_ = o.MoveTo(Enquiry)
		a.tellOwner(o, phone, "owner_link_failed", sayOpts{})
		a.tellCustomer(o, phone, []string{"link_failed"}, sayOpts{})
		return nil
	}
	o.LinkID, o.LinkURL = res.Link.ID, res.Link.PayURL
	a.log(o, phone, "create_advance_link", "confirmed", map[string]any{"amountPaise": amount}, logMore{refs: map[string]string{"linkId": res.Link.ID}})
	shown := catD(ctx.shown, av.decisions...)
	if a.ownerConfirms {
		r := a.requestOf(o)
		if r == nil {
			return errors.New("the owner-marked ledger has no request for the link it just made (" + o.LinkID + ")") // `requestOf(o)!`: the TypeScript throws here too
		}
		a.noteRequest(o, r, "a UPI request to the shop's own UPI ID; it counts as paid only when the owner marks it received")
		// a page order's page draws its own QR code from the link (item 11h), so no picture is made for it
		var img *messaging.SayImage
		if o.Channel == "" {
			img = a.qrOf(r)
		}
		a.tellCustomer(o, phone, cat(ctx.prefix, "quote_and_link"), sayOpts{shown: shown, itemID: ctx.itemID, offer: paidCancelOrOwner, image: img})
		a.tellOwner(o, phone, "owner_upi_expected", sayOpts{upiCode: codeOf(r.Code), offer: a.receivedButtons(r, r.AmountPaise)})
		return nil
	}
	a.tellCustomer(o, phone, cat(ctx.prefix, "quote_and_link"), sayOpts{shown: shown, itemID: ctx.itemID, offer: cancelOrOwner})
	return nil
}

// tellAlreadyWaiting is agent.ts tellAlreadyWaiting: a repeat of the same request gets the same link (and a UPI shop's QR picture again), not a second hold.
func (a *Agent) tellAlreadyWaiting(w *Order) {
	if a.settings.NoAdvance() {
		// the pickup hold: the same request again keeps the hold exactly as it is (its item, its time), or says the shop is still asked
		if w.State == AwaitingOwner {
			a.tellCustomer(w, w.Customer, []string{"hold_still_asking"}, sayOpts{})
			return
		}
		a.tellCustomer(w, w.Customer, []string{"hold_held"}, sayOpts{offer: cancelOrOwner})
		return
	}
	opts := sayOpts{offer: a.waitingOffer()}
	if a.ownerConfirms && w.Channel == "" {
		if r := a.requestOf(w); r != nil {
			opts.image = a.qrOf(r)
		}
	}
	a.tellCustomer(w, w.Customer, []string{"already_waiting"}, opts)
}

func sameLines(x, y []OrderLine) bool {
	if len(x) != len(y) {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}

func sameDate(x, y *LocalDate) bool {
	return (x == nil && y == nil) || (x != nil && y != nil && *x == *y)
}

// onOrder is agent.ts onOrder.
func (a *Agent) onOrder(phone string, in *reading.Intent) error {
	if !a.takesNewWork() {
		a.pausedReply(phone, "order", nil)
		return nil
	}
	lang := a.languageOf(phone, nil)
	waiting := a.store.LatestOrder(phone, []string{AwaitingAdvance, AwaitingOwner})
	o := a.store.LatestOrder(phone, []string{Enquiry})
	var carried *discounts.Deal // E1: the price asked on an order the customer replaced
	hasDetails := len(in.Items) > 0 || in.Date != nil || in.Time != nil || in.SlotID != "" || len(in.SlotIDs) > 0 || in.Mode != ""
	if o == nil && waiting != nil {
		// already holding an order for this customer: a repeat of the same request gets the same link, not a second hold
		probe := NewDraft(phone, lang)
		probe.Lines = append([]OrderLine{}, waiting.Lines...)
		if waiting.Date != nil {
			d := *waiting.Date
			probe.Date = &d
		}
		probe.DateNeedsConfirmation, probe.Mode, probe.SlotID, probe.Area, probe.Address = waiting.DateNeedsConfirmation, waiting.Mode, waiting.SlotID, waiting.Area, waiting.Address
		same := !hasDetails
		if hasDetails && a.fill(probe, in) {
			same = sameLines(probe.Lines, waiting.Lines) && sameDate(probe.Date, waiting.Date) && probe.Mode == waiting.Mode && probe.SlotID == waiting.SlotID
		}
		if same {
			a.tellAlreadyWaiting(waiting)
			return nil
		}
		if err := a.cancelWaiting(waiting, "replaced by a new request from the customer"); err != nil {
			return err
		}
		// the new draft starts from what the customer said now, with the day, the way and the address they had (a change of item or day, say) carried over
		o = a.store.Register(probe)
		if a.settings.Discounts != nil {
			carried = waiting.deal()
		}
	} else if o == nil {
		o = a.store.Register(NewDraft(phone, lang))
	}
	o.Language = lang
	if !a.fill(o, in) {
		a.tellCustomer(o, phone, []string{"didnt_understand"}, sayOpts{offer: itemsOffer("didnt_understand")})
		return nil
	}
	ctx := &flowCtx{}
	if a.offerPrice(o, in, ctx) {
		return nil
	}
	if carried != nil && in.OfferInr == nil && o.deal() == nil {
		// E1: the order the customer changed had a price agreed (or asked): the same price is asked again for the order as it is now, so a change never rides on an old yes
		if item := a.settings.ItemOf(carried.Item); item != nil {
			o.setDeal(&discounts.Deal{Item: carried.Item, OfferedInr: carried.OfferedInr, State: "carried"})
		}
	}
	return a.proceed(o, ctx)
}

// jsSpaceRun is JavaScript's /\s+/u.
var jsSpaceRun = regexp.MustCompile("[" + language.JSSpace + "]+")

// cleanAddress is agent.ts onAddress's `text.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120)`: control characters and runs of white space are
// one space, the ends trimmed (JavaScript's \s and trim), cut to 120 UTF-16 units.
func cleanAddress(text string) string {
	var b strings.Builder
	for _, r := range text {
		if r < 0x20 || r == 0x7f {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
	}
	s := language.TrimJS(jsSpaceRun.ReplaceAllString(b.String(), " "))
	u := []rune(s)
	n, cut := 0, len(u)
	for i, r := range u {
		w := 1
		if r > 0xffff {
			w = 2
		}
		if n+w > 120 {
			cut = i
			break
		}
		n += w
	}
	return string(u[:cut])
}

// onAddress is agent.ts onAddress: the next plain message from a customer whose delivery order waits for an address. It names a place on the delivery list or it is not delivered to.
func (a *Agent) onAddress(o *Order, text string) error {
	address := cleanAddress(text)
	var area []string
	if a.settings.Delivery != nil {
		area = a.settings.Delivery.Area
	}
	d := checkDeliveryArea(address, area)
	if blocked(d) {
		a.log(o, o.Customer, "check_address", "blocked", map[string]any{"area": nil}, logMore{decisions: []Decision{d}, notes: "the address names no place on the delivery list; it is not kept"})
		a.tellCustomer(o, o.Customer, []string{"outside_area"}, sayOpts{areas: true, shown: []Decision{d}, offer: &offer{kind: "buttons", buttons: []string{"pickup", "owner"}, body: []string{"outside_area"}}})
		return nil
	}
	o.Area, o.Address, o.AwaitingAddress = areaOf(address, area), address, false
	a.log(o, o.Customer, "check_address", "confirmed", map[string]any{"area": o.Area}, logMore{decisions: []Decision{d}, notes: "the address names a place on the delivery list; the address itself goes only to the owner when the order is confirmed"})
	return a.proceed(o, &flowCtx{shown: []Decision{d}})
}

func (a *Agent) onYes(phone string) error {
	if o := a.store.LatestOrder(phone, []string{Enquiry}); o != nil && o.DateNeedsConfirmation {
		o.DateNeedsConfirmation = false
		return a.proceed(o, &flowCtx{})
	}
	if w := a.store.LatestOrder(phone, []string{AwaitingAdvance, AwaitingOwner}); w != nil {
		a.tellAlreadyWaiting(w)
		return nil
	}
	a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: itemsOffer("didnt_understand")})
	return nil
}

func (a *Agent) onNo(phone string) error {
	if o := a.store.LatestOrder(phone, []string{Enquiry}); o != nil && o.DateNeedsConfirmation {
		o.Date, o.DateNeedsConfirmation = nil, false
		a.tellCustomer(o, phone, []string{"ask_when"}, sayOpts{})
		return nil
	}
	a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: itemsOffer("didnt_understand")})
	return nil
}

// onPaidReadBack is agent.ts onPaidReadBack: "I have paid" with a module that confirms by itself: the agent looks at the payment record again and says what it shows. It never
// confirms an order on the customer's word.
func (a *Agent) onPaidReadBack(phone string) error {
	o := a.store.LatestOrder(phone, []string{AwaitingAdvance})
	if o == nil {
		if p := a.plansOf(); p != nil {
			o = p.AwaitingOrderOf(phone) // a plan's period waiting for its payment is theirs too
		}
	}
	if o == nil {
		a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: itemsOffer("didnt_understand")})
		return nil
	}
	if _, err := a.reconcilePayments(o); err != nil { // if the record shows it, the order is confirmed and the customer told, by the usual path
		return err
	}
	if o.State == AwaitingAdvance {
		a.tellAlreadyWaiting(o)
	}
	return nil
}

// ---- STOP, and a voice note ------------------------------------------------------------------------------------------------------------------------------------------

func (a *Agent) onStop(phone string) error {
	a.store.Customer(phone).OptedOut = true
	a.log(nil, phone, "opt_out", "confirmed", map[string]any{"by": "STOP"}, logMore{notes: "no more messages to this customer, not even a reply"})
	a.tellOwner(nil, phone, "owner_opted_out", sayOpts{})
	return nil
}

// listen is agent.ts's shared listener (turn.ts createListener): the owner and the other approvers type their commands, and a customer who sent STOP is not listened to.
func (a *Agent) listen(msg messaging.InboundMessage, audio *runtime.PageAudio) *voice.Heard {
	c := a.store.FindCustomer(msg.From)
	commander := msg.From == a.owner() || a.approverDigits()[digitsOf(msg.From)]
	return a.c.Listen(a.kit.Voice, msg, audio, commander, c != nil && c.OptedOut)
}

// onVoiceNote is agent.ts onVoiceNote: a voice note that was not used. With the shop's assistant and a voice service the owner's note is read as their typed words (or they are
// told it could not be made out); otherwise the sender gets one plain line asking them to type, in the language this conversation already uses. The record says why, and what
// listening cost. STOP means STOP. tried is what listening came to (nil: not tried).
func (a *Agent) onVoiceNote(msg messaging.InboundMessage, tried *voice.Heard) error {
	phone := msg.From
	if phone == a.owner() {
		if as := a.assistantOf(); as != nil {
			if heard := as.HearOwner(msg); heard != nil {
				if heard.Text == "" {
					return a.stepErr
				}
				return a.onOwnerMessage(*heard)
			}
		}
		a.tellOwner(nil, phone, "voice_note", sayOpts{action: "voice_note_reply"})
		return nil
	}
	c := a.store.Customer(phone)
	refs := map[string]string{"messageId": msg.ID}
	notes := "a voice note: it is not listened to and nothing of it is kept"
	if tried != nil && !tried.OK {
		refs = mergeRefs(refs, voice.FailedMarks(*tried))
		notes = "a voice note that could not be used (" + voice.Why[tried.Reason] + "); the audio was held in memory for the call only and nothing of it is kept"
	}
	a.log(nil, phone, "receive_message", "confirmed", map[string]any{"voiceNote": true, "id": msg.ID}, logMore{notes: notes, refs: refs})
	if c.OptedOut {
		return nil
	}
	// B29: with voice on the line says it could not be made out; with it off, that voice notes cannot be listened to
	line := "voice_note"
	if a.kit.Voice != nil {
		line = "voice_note_retry"
	}
	a.tellCustomer(nil, phone, []string{line}, sayOpts{action: "voice_note_reply"})
	return nil
}
