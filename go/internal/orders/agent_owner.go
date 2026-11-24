package orders

// Cancelling, the owner's answers and the balance: agent.ts's sections "cancelling" (closeLink, cancelWaiting, cancellable, onCancelAsk, onKeep, onTalkToOwner, onCancel: the window,
// the late cancellation's ask, the refund limit), "the owner's answers" (onOwnerMessage: the owner's UPI marks, the relay's replies left alone, the handover code, the shop terms, the
// balance command, the assistant's turn, "approve o-3" / "deny o-3") and "the balance, paid when the order is collected or delivered" (onOwnerBalance, markBalance, closeBalanceLink,
// reconcileBalance).
//
// The balance and the reminders are raw JSON in the order (state.go keeps them as read): balance() reads the balance typed, setBalance writes members into it in the TypeScript's
// spread order (`{...(o.balance ?? {}), amountInr, ...}`: a member already there keeps its place, a new one goes last), so a store written back is the TypeScript's bytes.

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/terms"
)

// The owner's fixed commands (agent.ts OWNER_COMMAND, BALANCE_COMMAND) and the approvals relay's replies (approvals/code.ts RELAY_CODE_REPLY and buttons.ts's button id); the
// handover code is every template's (internal/runtime ownerwords.go, since 23 Nov 2026). `\s` is JavaScript's (language.JSSpace); `\d` is ASCII in both; (?i) folds case as the i (and iu) flags do.
var (
	sp           = "[" + language.JSSpace + "]"
	ownerCommand = regexp.MustCompile(`(?i)^` + sp + `*(approve|deny)` + sp + `+(o-[0-9]+)` + sp + `*$`)
	balanceCmd   = regexp.MustCompile(`(?i)^` + sp + `*balance` + sp + `+(o-[0-9]+)` + sp + `+(cash|upi|link)` + sp + `*$`)
	relayCode    = regexp.MustCompile(`(?i)^` + sp + `*(approve|deny)` + sp + `+([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})` + sp + `*$`)
	relayButton  = regexp.MustCompile(`^appr-(approve|deny):([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})$`)
)

func isRelayReply(m messaging.InboundMessage) bool {
	return relayCode.MatchString(m.Text) || (m.Reply != nil && relayButton.MatchString(m.Reply.ID))
}

// approverDigits is approvals/people.ts approverNumbers: the digits of every other approver's number.
func (a *Agent) approverDigits() map[string]bool {
	out := map[string]bool{}
	people, _ := a.settings.Approvers["people"].([]any)
	for _, p := range people {
		if m, ok := p.(map[string]any); ok {
			if wa, ok := m["whatsapp"].(string); ok {
				out[digitsOf(wa)] = true
			}
		}
	}
	return out
}

// askedByOwner is people.ts ownerAsked: with other approvers, a refund the owner's own command asks for names the owner (Geo-Requested-By).
func (a *Agent) askedByOwner() []string {
	if a.settings.Approvers == nil {
		return nil
	}
	return []string{"owner"}
}

// ---- cancelling ------------------------------------------------------------------------------------------------------------------------------------------------------

// closeLink is agent.ts closeLink.
func (a *Agent) closeLink(o *Order, why string) {
	if o.LinkID == "" {
		return
	}
	closed := a.linkClosed(o.LinkID)
	outcome, notes := "unconfirmed", "the link could not be closed: it may still be open or already paid"
	if closed {
		outcome, notes = "confirmed", why
	}
	a.log(o, o.Customer, "cancel_advance_link", outcome, map[string]any{"linkId": o.LinkID}, logMore{notes: notes})
	if a.ownerConfirms && closed {
		a.log(o, o.Customer, ActionClosed, "confirmed", map[string]any{"requestId": o.LinkID}, logMore{refs: map[string]string{"requestId": o.LinkID},
			notes: why + "; a mark by the owner that comes later is still recorded, and never confirms an order by itself"})
	}
}

// cancelWaiting is agent.ts cancelWaiting: give up an order that is waiting for its advance: its stock is free again at once (it is no longer held), and the link is closed.
func (a *Agent) cancelWaiting(o *Order, why string) error {
	if a.settings.NoAdvance() {
		a.dropHold(o, why) // the pickup hold: no link, no payment (agent_hold.go)
		return nil
	}
	o.HoldExpiresAt = nil
	a.closeLink(o, why)
	_ = o.MoveTo(Cancelled)
	o.Pending = []payments.Pending{}
	a.log(o, o.Customer, "cancel_order", "confirmed", map[string]any{"state": "awaiting_advance"}, logMore{notes: why})
	_, err := a.reconcilePayments(o) // a payment that landed just before the cancel is refunded, not forgotten
	return err
}

// cancellable is agent.ts cancellable: the paid order first, then one waiting for its advance, then one waiting for its owner, then a draft.
func (a *Agent) cancellable(phone string) *Order {
	for _, state := range []string{Confirmed, AwaitingAdvance, AwaitingOwner, Enquiry} {
		if o := a.store.LatestOrder(phone, []string{state}); o != nil {
			return o
		}
	}
	return nil
}

// onCancelAsk is agent.ts onCancelAsk: the customer tapped "Cancel order"; nothing is cancelled yet. They are asked once, with Yes and No buttons; "Yes, cancel" is the same as typing
// cancel. Nothing paid: no need to ask twice.
func (a *Agent) onCancelAsk(phone string) error {
	o := a.cancellable(phone)
	if o == nil || len(o.Lines) == 0 {
		a.tellCustomer(o, phone, []string{"no_order_found"}, sayOpts{offer: itemsOffer("no_order_found")})
		return nil
	}
	if o.State != Confirmed || o.SlotStartMs == nil {
		return a.onCancel(phone)
	}
	a.tellCustomer(o, phone, []string{"ask_cancel"}, sayOpts{offer: &offer{kind: "buttons", buttons: []string{"cancelYes", "keep"}}})
	return nil
}

// onKeep is agent.ts onKeep: "No, keep it": the order is left exactly as it was.
func (a *Agent) onKeep(phone string) error {
	o := a.cancellable(phone)
	if o == nil || o.SlotStartMs == nil {
		a.tellCustomer(nil, phone, []string{"didnt_understand"}, sayOpts{offer: itemsOffer("didnt_understand")})
		return nil
	}
	a.tellCustomer(o, phone, []string{"kept"}, sayOpts{})
	return nil
}

// onTalkToOwner is agent.ts onTalkToOwner: the owner is told, once an hour for the same customer, and the customer is told the owner will message them; the agent does not reply on
// the owner's behalf and decides nothing. If the owner could not be told, the customer is told that.
// orderForms and planForms are agent.ts ORDER_FORMS and PLAN_FORMS: how a customer names an order and a plan ("o-5", "p-5", and the word before the number in each language).
var (
	orderForms = runtime.CaseForms{Prefix: "o", Words: []string{"order", "ऑर्डर", "ഓർഡർ", "ಆರ್ಡರ್"}}
	planForms  = runtime.CaseForms{Prefix: "p", Words: []string{"plan", "प्लान", "പ്ലാൻ", "ಪ್ಲಾನ್"}}
)

// onCaseAsked is agent.ts onCaseAsked (25 Nov 2026, runtime/caseasked.go): only for a conversation that holds no order and no plan, words that name one of the shop's orders (a
// pickup hold and a plan's period are orders too) or plans get one line that shows nothing of it, and the owner is told (at most once an hour for this asker and case, by the
// record) with both numbers. The record line keeps the case in refs.case and leaves `booking` null. False: nothing was named, and the message goes on as before.
func (a *Agent) onCaseAsked(phone, text string, wordForm bool) bool {
	plans := a.store.PlansState(false).All()
	for _, x := range a.store.Orders {
		if x.Customer == phone {
			return false
		}
	}
	for _, p := range plans {
		if p.Customer == phone {
			return false
		}
	}
	entries := a.c.Rec.Entries()
	keys := runtime.RecordCaseKeys(entries)
	for _, x := range a.store.Orders {
		if x.ClaimRef != "" {
			keys[runtime.CaseKey(x.ClaimRef)] = x.ID
		}
	}
	planOf := func(id string) *Plan {
		for _, p := range plans {
			if p.ID == id {
				return p
			}
		}
		return nil
	}
	named := runtime.NamedCase(text, orderForms, func(id string) bool { return a.store.Order(id) != nil }, keys, wordForm)
	if named == nil {
		named = runtime.NamedCase(text, planForms, func(id string) bool { return planOf(id) != nil }, map[string]string{}, wordForm)
	}
	if named == nil {
		return false
	}
	caseCustomer := ""
	if o := a.store.Order(named.Case); o != nil {
		caseCustomer = a.shownPhone(o.Customer, o)
	} else {
		caseCustomer = a.shownPhone(planOf(named.Case).Customer, nil)
	}
	lately := runtime.ToldLately(entries, phone, named.Case, a.now())
	asker, ref := a.shownPhone(phone, nil), named.Case
	told := lately || a.tellOwner(nil, phone, "owner_case_other_number", sayOpts{facts: func(f *words.MessageFacts) {
		f.OrderRef, f.CustomerPhone, f.AskerPhone = words.S(ref), words.S(caseCustomer), words.S(asker)
	}})
	outcome, how := "failed", "the owner could not be told"
	switch {
	case lately:
		outcome, how = "blocked", "the owner was already told in the last hour"
	case told:
		outcome, how = "confirmed", "the owner was told"
	}
	a.log(nil, phone, runtime.CaseAsked, outcome, map[string]any{"case": named.Case, "via": named.Via}, logMore{refs: map[string]string{"case": named.Case, "via": named.Via, "to": "owner"},
		notes: "another conversation named " + named.Case + " (" + named.Via + "); nothing of it was shown and nothing changed; " + how})
	t := "case_other_number_untold"
	if told {
		t = "case_other_number"
	}
	a.tellCustomer(nil, phone, []string{t}, sayOpts{})
	return true
}

func (a *Agent) onTalkToOwner(phone string) error {
	c := a.store.Customer(phone)
	now := a.now()
	recently := c.OwnerAskedAtMs != nil && now-*c.OwnerAskedAtMs < Hour
	told := recently
	if !recently {
		told = a.tellOwner(nil, phone, "owner_wants_to_talk", sayOpts{})
		if told {
			c.OwnerAskedAtMs = ptr(now)
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

// jsFloor is Math.floor of a number the record keeps as a whole number.
func jsFloor(f float64) int64 {
	n := int64(f)
	if float64(n) > f {
		n--
	}
	return n
}

// onCancel is agent.ts onCancel.
func (a *Agent) onCancel(phone string) error {
	o := a.cancellable(phone)
	if o != nil && len(o.Lines) == 0 && holdPickOn(o) != nil {
		// the pickup hold: a photo or model number the owner has not answered yet is dropped, with its card (agent_hold.go)
		a.dropHold(o, "the customer cancelled before the owner said which item it is")
		a.tellCustomer(o, phone, []string{"cancelled_draft"}, sayOpts{})
		return nil
	}
	if o == nil || len(o.Lines) == 0 {
		a.tellCustomer(o, phone, []string{"no_order_found"}, sayOpts{offer: itemsOffer("no_order_found")})
		return nil
	}
	switch o.State {
	case Enquiry, AwaitingOwner:
		_ = o.MoveTo(Cancelled)
		o.Pending = []payments.Pending{}
		a.log(o, phone, "cancel_order", "confirmed", map[string]any{"state": "draft"})
		t := "cancelled_draft"
		if o.Date != nil {
			t = "cancelled_no_advance"
		}
		a.tellCustomer(o, phone, []string{t}, sayOpts{})
		return nil
	case AwaitingAdvance:
		if a.settings.NoAdvance() {
			return a.letGoHold(o) // the pickup hold: nothing was paid, so nothing to look for (agent_hold.go)
		}
		if err := a.cancelWaiting(o, "cancelled by the customer before paying"); err != nil {
			return err
		}
		a.tellCustomer(o, phone, []string{"cancelled_no_advance"}, sayOpts{})
		return nil
	}
	// a confirmed order: inside the cancellation window the advance goes back; above the refund limit Guard holds it for the owner (asked once, by the relay); outside the window and
	// within the limit, whether to give it back is the owner's call, and the agent asks; outside the window AND above the limit it is the same one ask, Guard's. Either way the
	// owner is told the order is cancelled, so it is not prepared.
	var start int64
	if o.SlotStartMs != nil {
		start = *o.SlotStartMs
	}
	hoursLeft := float64(start-a.now()) / float64(Hour)
	inWindow := hoursLeft >= float64(a.settings.Cancellation.WindowHours)
	var amountInr int64
	if o.AdvanceInr != nil {
		amountInr = *o.AdvanceInr
	}
	o.Pending = []payments.Pending{}
	_ = o.MoveTo(Cancelled)
	a.log(o, phone, "cancel_order", "confirmed", map[string]any{"hoursLeft": jsFloor(hoursLeft), "inWindow": inWindow})
	a.closeBalanceLink(o)
	a.tellOwner(o, phone, "owner_order_cancelled", sayOpts{})
	limit := checkRefundLimit(refundAsk{amountInr: amountInr, limitInr: a.settings.Refund.LimitInr, paidInr: amountInr})
	refs := map[string]string{"paymentId": o.AdvancePaymentID, "amountPaise": i64(amountInr * 100)}
	if blocked(limit) {
		a.log(o, phone, "refund", "blocked", inputs("paymentId", optS(o.AdvancePaymentID), "amountInr", amountInr), logMore{decisions: []Decision{limit}, refs: refs})
		return nil
	}
	// a module that cannot refund by itself: inside the window the advance is owed back by the owner, whatever the limit (the owner sends every such refund, so there is no Guard to
	// hold one); outside it the owner decides, as below
	if a.ownerRefunds && inWindow {
		a.oweBack(o, o.AdvancePaymentID, amountInr*100, "cancelled inside the cancellation window", oweOpts{customer: "upi_cancelled_refund_owed", decisions: []Decision{limit}})
		return nil
	}
	if !inWindow && (limit.Verdict == "allow" || a.ownerRefunds) {
		late := checkRefundLimit(refundAsk{amountInr: amountInr, limitInr: a.settings.Refund.LimitInr, paidInr: amountInr, outsideWindow: true})
		o.Pending = append(o.Pending, NewOwnerRefund(OwnerRefund{AmountInr: amountInr, PaymentID: o.AdvancePaymentID, Reason: "late_cancellation", AskedAtMs: ptr(a.now())}))
		a.log(o, phone, "refund", "held_for_owner", inputs("paymentId", optS(o.AdvancePaymentID), "amountInr", amountInr), logMore{decisions: []Decision{late}, refs: refs})
		a.tellCustomer(o, phone, []string{"cancelled_late"}, sayOpts{})
		a.tellOwner(o, phone, "owner_late_cancellation", sayOpts{})
		return nil
	}
	result, err := a.requestRefund(o, o.AdvancePaymentID, amountInr, []Decision{limit}, limit.Verdict != "allow", nil)
	if err != nil {
		return err
	}
	held := "cancelled_late"
	if inWindow {
		held = "cancelled_refund_pending"
	}
	a.afterRefund(o, result, payments.RefundAfter{PaymentID: o.AdvancePaymentID, AmountInr: amountInr, DoneCust: "cancelled_refund", Held: held})
	return nil
}

// ---- the owner's answers ---------------------------------------------------------------------------------------------------------------------------------------------

// onOwnerMessage is agent.ts onOwnerMessage.
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
	// "approve K7M2QX" answers the approvals relay, which reads the owner's messages too: no reply and no record, so the owner is not told "I didn't understand" about an answer that
	// was understood elsewhere
	if isRelayReply(msg) {
		return nil
	}
	// "move K7M2QX" is the owner agreeing to hand the shop to another Operator or builder (approvals/handover.ts): the record keeps the owner's number and the code's hash
	if code, ok := runtime.HandoverCode(msg.Text); ok {
		a.log(nil, a.owner(), runtime.HandoverAction, "confirmed", map[string]any{"command": "handover"}, logMore{refs: runtime.HandoverRefs(code), notes: runtime.HandoverNotes})
		return nil
	}
	// B72: "terms" sends the shop terms to the owner and "I agree" records the agreement (internal/terms). Off unless the shop was handed a terms file
	if a.kit.Terms != nil {
		if setup := a.kit.Terms(); setup != nil && terms.HandleOwner(a.ctx, runtime.TermsMessage(msg), a.termsDeps(setup)) {
			return nil
		}
	}
	// 17 Nov 2026: "balance o-3 cash", "balance o-3 upi" or "balance o-3 link": the balance paid when the order is collected or delivered; a fixed command, so the assistant never
	// reads it as something else
	if m := balanceCmd.FindStringSubmatch(msg.Text); m != nil {
		return a.onOwnerBalance(strings.ToLower(m[1]), strings.ToLower(m[2]))
	}
	// E1: the owner's answer to a price card names the order and the card's code (agent_discounts.go); a shop with no "discounts" block reads it as before
	if a.settings.Discounts != nil {
		if m := discountCommand.FindStringSubmatch(msg.Text); m != nil {
			return a.onDiscountAnswer(strings.ToLower(m[1]), m[2], strings.ToUpper(m[3]))
		}
	}
	// the pickup hold's two fixed replies (agent_hold.go): "pick o-3 <item>" for a photo or a model number, and "collected o-3"; a shop with an advance reads them as before
	if a.settings.NoAdvance() {
		if m := holdPickCmd.FindStringSubmatch(msg.Text); m != nil {
			return a.onHoldPick(strings.ToLower(m[1]), m[2])
		}
		if m := collectedCmd.FindStringSubmatch(msg.Text); m != nil {
			return a.onCollected(strings.ToLower(m[1]))
		}
	}
	// item 11e: the shop's assistant reads what no fixed phrase is (this command is one); a shop without an "assistant" block: exactly as before
	if !ownerCommand.MatchString(msg.Text) {
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
	var o *Order
	command, ref := "", ""
	if m != nil {
		command, ref = strings.ToLower(m[1]), m[2]
		o = a.store.Order(strings.ToLower(m[2]))
	}
	var said map[string]string // the record keeps the command in the clear, so a report can count approvals and refusals
	if command != "" {
		said = map[string]string{"command": command}
	}
	if o != nil && command != "" && a.settings.Discounts != nil && len(o.Pending) == 0 && askedDeal(o) != nil {
		// E1: a price card waits on this order and its answer needs the card's code: the owner is told the exact words, and nothing is done
		a.log(o, a.owner(), "owner_decision", "blocked", inputs("command", optS(command)), logMore{refs: said, notes: "a price card waits on this order: its answer names the card's code"})
		a.tellOwner(o, o.Customer, "owner_discount_use_code", sayOpts{facts: a.dealFacts(*o.deal())})
		return nil
	}
	a.log(o, a.owner(), "owner_decision", "attempted", inputs("command", optS(command), "ref", optS(ref)), logMore{refs: said})
	if o == nil || command == "" || len(o.Pending) == 0 {
		a.log(o, a.owner(), "owner_decision", "blocked", inputs("command", optS(command)), logMore{notes: "not a command for something waiting on the owner", refs: said})
		a.tellOwner(nil, a.owner(), "owner_unknown_command", sayOpts{})
		return nil
	}
	pending := o.Pending[0]
	switch k := pending.PendingKind(); k {
	case "hold_ask", "hold_pick":
		return a.onHoldAnswer(o, pending, command) // the pickup hold (agent_hold.go)
	case "guard_hold", "refund_retry":
		notes := "this refund is being sent again by itself"
		if k == "guard_hold" {
			notes = "this refund is held by Guard: it is answered with the code in the approval message, not with the order reference"
		}
		a.log(o, a.owner(), "owner_decision", "blocked", map[string]any{"command": command}, logMore{notes: notes, refs: said})
		return nil
	case "big_order":
		o.Pending = without(o.Pending, pending)
		notes := "the owner refused this order"
		if command == "approve" {
			notes = "the owner let the customer pay for this order"
		}
		a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said, notes: notes})
		if command == "deny" {
			_ = o.MoveTo(Cancelled)
			a.tellCustomer(o, o.Customer, []string{"big_order_denied"}, sayOpts{})
			return nil
		}
		return a.proceedToHold(o, &flowCtx{})
	}
	r := OwnerRefundOf(pending)
	if r == nil {
		a.tellOwner(nil, a.owner(), "owner_unknown_command", sayOpts{})
		return nil
	}
	if command == "deny" {
		o.Pending = o.Pending[1:]
		// the advance stays with the shop: the books move it from the customer's advance to "kept from a cancellation" (the owner's page takes this same path)
		a.post(bookEvent{Kind: "kept", Case: o.ID, AmountPaise: r.AmountInr * 100, Why: "late_cancellation"}, func(m map[string]string) {
			a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{notes: "the owner declined the refund", refs: mergeRefs(said, m)})
		})
		a.tellCustomer(o, o.Customer, []string{"refund_denied"}, sayOpts{})
		return nil
	}
	limit := checkRefundLimit(refundAsk{amountInr: r.AmountInr, limitInr: a.settings.Refund.LimitInr, paidInr: r.AmountInr, ownerApproved: true})
	a.log(o, a.owner(), "owner_decision", "confirmed", map[string]any{"command": command}, logMore{refs: said})
	o.Pending = without(o.Pending, pending)
	if a.ownerRefunds {
		a.oweBack(o, r.PaymentID, r.AmountInr*100, "the owner approved a refund after a late cancellation", oweOpts{customer: "upi_refund_owed", decisions: []Decision{limit}})
		return nil
	}
	// with other approvers the owner is named as asking: if Guard holds it, someone else approves
	asked := a.askedByOwner()
	result, err := a.requestRefund(o, r.PaymentID, r.AmountInr, []Decision{limit}, a.refunds.OverLimit(r.AmountInr), asked)
	if err != nil {
		return err
	}
	a.afterRefund(o, result, payments.RefundAfter{PaymentID: r.PaymentID, AmountInr: r.AmountInr, DoneCust: "refund_approved", Held: "cancelled_refund_pending", RequestedBy: asked})
	return nil
}

func without(ps []payments.Pending, p payments.Pending) []payments.Pending {
	out := []payments.Pending{}
	for _, x := range ps {
		if x != p {
			out = append(out, x)
		}
	}
	return out
}

// termsDeps is agent.ts's handleOwnerTerms call: the shop's terms now, the agent's messaging, its record and its log (the case is none).
func (a *Agent) termsDeps(setup *terms.File) terms.Deps {
	return terms.Deps{
		Setup: setup, ShopName: a.settings.Name, OwnerNumber: a.owner(), OwnerLanguage: a.settings.Owner.Language, Messaging: runtime.TermsMessaging(a.msg), Record: runtime.TermsRecord(a.c.Rec.Entries),
		Log: func(action, outcome string, in any, more terms.LogMore) {
			a.log(nil, a.owner(), action, outcome, in, logMore{notes: more.Notes, refs: more.Refs})
		},
	}
}

// ---- the balance, paid when the order is collected or delivered (17 Nov 2026) ----------------------------------------------------------------------------------------
//
// The advance and the balance are two records. The advance is the payment record's and confirms the order; the balance is what is left of the total, recorded on its own line
// (`record_balance`), never added to "advance collected". It is known in one of two ways: the owner marks it received (cash or UPI), or, on a gateway shop, the owner asks for a link
// for it and the payments service's own list shows it paid. What a customer says never marks it.

// balancePaid is order.ts Order.balance.paid.
type balancePaid struct {
	By        string `json:"by"`
	AtMs      int64  `json:"atMs"`
	PaymentID string `json:"paymentId,omitempty"`
}

// balanceRead is order.ts Order.balance, as read.
type balanceRead struct {
	AmountInr *int64       `json:"amountInr"`
	LinkID    string       `json:"linkId"`
	LinkURL   string       `json:"linkUrl"`
	Paid      *balancePaid `json:"paid"`
}

// balance is the order's balance block, typed; nil when it has none.
func (o *Order) balance() *balanceRead {
	if o.Balance == nil {
		return nil
	}
	var b balanceRead
	if json.Unmarshal(o.Balance, &b) != nil {
		return nil
	}
	return &b
}

// setBalance is `o.balance = {...(o.balance ?? {}), name: value, ...}`: each member set in place when there, else added last, in the order given.
func (o *Order) setBalance(kv ...any) {
	ms, _ := members(o.Balance)
	for i := 0; i+1 < len(kv); i += 2 {
		name, raw := kv[i].(string), jsonOf(kv[i+1])
		found := false
		for j := range ms {
			if ms[j].Name == name {
				ms[j].Raw, found = raw, true
			}
		}
		if !found {
			ms = append(ms, runtime.Member{Name: name, Raw: raw})
		}
	}
	var w obj
	for _, m := range ms {
		w.put(m.Name, m.Raw)
	}
	o.Balance = w.done()
}

// balanceInrOf is agent.ts balanceInrOf: what is left of the total after the advance.
func balanceInrOf(o *Order) int64 {
	var total, advance int64
	if o.TotalInr != nil {
		total = *o.TotalInr
	}
	if o.AdvanceInr != nil {
		advance = *o.AdvanceInr
	}
	return max(0, total-advance)
}

// onOwnerBalance is agent.ts onOwnerBalance: "balance o-3 cash|upi" marks it; "balance o-3 link" (a gateway shop) asks for a link for it.
func (a *Agent) onOwnerBalance(ref, how string) error {
	o := a.store.Order(ref)
	var due int64
	if o != nil && (o.State == Confirmed || o.State == Completed) {
		if b := o.balance(); b == nil || b.Paid == nil {
			due = balanceInrOf(o)
		}
	}
	if o == nil || due == 0 || (how == "link" && !a.can.ConfirmsAutomatically) {
		notes := "a link for the balance is for a shop whose payments service confirms payments itself"
		switch {
		case o == nil:
			notes = "no such order"
		case due == 0:
			notes = "there is no balance to mark: the order is not confirmed or finished, nothing is left to pay, or it is already marked"
		}
		a.log(o, a.owner(), "record_balance", "blocked", map[string]any{"how": how, "ref": ref}, logMore{notes: notes})
		a.tellOwner(nil, a.owner(), "owner_balance_none", sayOpts{})
		return nil
	}
	if how != "link" {
		a.markBalance(o, how, "")
		return nil
	}
	if a.pay == nil {
		return runtime.Unported("a balance link on a shop with no payments service")
	}
	a.log(o, a.owner(), "create_balance_link", "attempted", map[string]any{"amountPaise": due * 100})
	res, err := payments.EnsureLink(a.ctx, a.pay, payments.LinkRequest{Reference: o.ID + ".b", AmountPaise: due * 100, Description: a.settings.Name + " balance"})
	if err != nil {
		return err
	}
	if res.Link == nil {
		outcome, notes := "unconfirmed", "the payments service does not show the link"
		if res.Error != "" {
			outcome, notes = "failed", res.Error
		}
		a.log(o, a.owner(), "create_balance_link", outcome, map[string]any{"amountPaise": due * 100}, logMore{notes: notes})
		a.tellOwner(o, o.Customer, "owner_link_failed", sayOpts{})
		return nil
	}
	o.setBalance("amountInr", due, "linkId", res.Link.ID, "linkUrl", res.Link.PayURL)
	a.log(o, a.owner(), "create_balance_link", "confirmed", map[string]any{"amountPaise": due * 100}, logMore{refs: map[string]string{"linkId": res.Link.ID, "amountPaise": i64(due * 100)}})
	a.tellCustomer(o, o.Customer, []string{"balance_link"}, sayOpts{link: res.Link.PayURL})
	return nil
}

// markBalance is agent.ts markBalance: record the balance as received, on its own line, and tell the customer and the owner. Once: an order whose balance is marked is not marked
// again. by is "cash", "upi" or "provider".
func (a *Agent) markBalance(o *Order, by, paymentID string) {
	if b := o.balance(); b != nil && b.Paid != nil {
		return
	}
	amountInr := balanceInrOf(o)
	o.setBalance("amountInr", amountInr, "paid", balancePaid{By: by, AtMs: a.now(), PaymentID: paymentID})
	refs := map[string]string{"balancePaise": i64(amountInr * 100), "by": by}
	if paymentID != "" {
		refs["paymentId"] = paymentID
	}
	who, notes := a.owner(), "the owner marked the balance received at pickup or delivery, from their own number"
	if by == "provider" {
		who, notes = o.Customer, "the payments service's own list shows the balance's link paid"
	}
	a.log(o, who, "record_balance", "confirmed", map[string]any{"by": by, "amountInr": amountInr}, logMore{refs: refs, notes: notes})
	a.tellCustomer(o, o.Customer, []string{"balance_paid"}, sayOpts{})
	a.tellOwner(o, o.Customer, "owner_balance_marked", sayOpts{})
}

// closeBalanceLink is agent.ts closeBalanceLink: an order that is cancelled no longer takes its balance: a link made for it is closed, so no money comes in on it. Best effort.
func (a *Agent) closeBalanceLink(o *Order) {
	b := o.balance()
	if b == nil || b.LinkID == "" || b.Paid != nil {
		return
	}
	closed := a.linkClosed(b.LinkID)
	outcome, notes := "unconfirmed", "the order was cancelled but the balance's link could not be closed: a payment on it is not counted (the record says so), and the owner looks in the payment account"
	if closed {
		outcome, notes = "confirmed", "the order was cancelled, so the link for its balance is closed"
	}
	a.log(o, o.Customer, "cancel_balance_link", outcome, map[string]any{"linkId": b.LinkID}, logMore{notes: notes})
}

// reconcileBalance is agent.ts reconcileBalance: the balance link's payments from the payments service's own list. A payment that is not exactly the balance is not counted, and says
// so in the record.
func (a *Agent) reconcileBalance(o *Order) error {
	b := o.balance()
	if b == nil || b.LinkID == "" || b.Paid != nil {
		return nil
	}
	if o.State != Confirmed && o.State != Completed {
		return nil // a cancelled order takes no balance: its link was closed, and nothing arriving on it is counted
	}
	if a.pay == nil {
		return nil
	}
	link, err := a.pay.FetchRequest(a.ctx, b.LinkID)
	if err != nil {
		return err
	}
	if link == nil {
		a.log(o, o.Customer, "record_balance", "failed", map[string]any{"linkId": b.LinkID}, logMore{notes: "the payments service has no such link"})
		return nil
	}
	var want int64
	if b.AmountInr != nil {
		want = *b.AmountInr * 100
	}
	for _, p := range link.Payments {
		if contains(o.HandledPayments, p.ID) {
			continue
		}
		o.HandledPayments = append(o.HandledPayments, p.ID)
		if p.Amount == want {
			a.markBalance(o, "provider", p.ID)
			return nil
		}
		a.log(o, o.Customer, "record_balance", "blocked", map[string]any{"paymentId": p.ID, "amount": p.Amount}, logMore{refs: map[string]string{"paymentId": p.ID},
			notes: "a payment on the balance's link that is not the balance: it is not counted, and the owner looks at it in the payment account"})
	}
	return nil
}
