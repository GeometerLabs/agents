package fees

// What a parent and the owner say: agent.ts onMessage (with the parent's intents: pay, I have paid, a discount, a refund, the owner, the menu, STOP, a voice note), the owner's
// answers (the UPI marks, "approve q-3" / "deny q-3"), the panel's to-do list (onRecovery), the refund the owner decided (sendOwnerRefund) and the centre's public chat.
// Read by the rules alone (reading.go): the model steps, the shop's assistant and its talk, voice notes heard by a speech service, the shop terms and the handover code are
// not ported for Fees yet (Deferred.md); each says so in the record or answers as the TypeScript does without them.

import (
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

var (
	// approvals/code.ts RELAY_CODE_REPLY and buttons.ts's button id: the approvals relay's replies, typed or tapped (the same patterns internal/bookings reads)
	relayCode   = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(approve|deny)[` + language.JSSpace + `]+([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})[` + language.JSSpace + `]*$`)
	relayButton = regexp.MustCompile(`^appr-(approve|deny):([A-HJKMNP-Za-hjkmnp-z2-9]{4,6})$`)
	// agent.ts OWNER_COMMAND: /^\s*(approve|deny)\s+(q-\d+)\s*$/i
	ownerCommand = regexp.MustCompile(`(?i)^[` + language.JSSpace + `]*(approve|deny)[` + language.JSSpace + `]+(q-[0-9]+)[` + language.JSSpace + `]*$`)
)

func isRelayReply(m messaging.InboundMessage) bool {
	return relayCode.MatchString(m.Text) || (m.Reply != nil && relayButton.MatchString(m.Reply.ID))
}

// onMessage is agent.ts onMessage.
func (a *Agent) onMessage(m messaging.InboundMessage) error {
	if contains(a.store.SeenMessages, m.ID) {
		a.log(nil, m.From, "receive_message", "blocked", map[string]any{"id": m.ID}, logMore{notes: "the same WhatsApp message was delivered again, so it is ignored"})
		return nil
	}
	a.store.SeenMessages = append(a.store.SeenMessages, m.ID)
	if m.VoiceNote {
		return a.onVoiceNote(m)
	}
	if m.From == a.owner() {
		return a.onOwnerMessage(m)
	}
	if m.Image {
		return a.onPicture(m)
	}
	phone := m.From
	c := a.store.Customer(phone)
	if a.settings.Classes != nil && !c.OptedOut {
		taken, err := a.classesContact(m)
		if err != nil || taken {
			return err
		}
	}
	var in intent
	tapped := false
	if m.Reply != nil {
		if t := intentFromReply(m.Reply.ID); t != nil {
			in, tapped = *t, true
		}
	}
	if !tapped {
		in = parseIntent(m.Text)
	}
	if in.Language != "" && contains(a.settings.Languages, in.Language) {
		c.Language = in.Language
		for _, d := range a.store.duesOf(phone) {
			d.Language = in.Language
		}
	}
	var notes []string
	if in.OverrideAttempt {
		notes = append(notes, "the message asked the agent to ignore its rules; it is treated as ordinary text and changes nothing")
	}
	inputs := map[string]any{"text": m.Text, "id": m.ID}
	u := understanding.Rules() // the rules alone read every message on Go (the model steps are not ported: Deferred.md)
	runtime.CountUnderstood(&a.c.Snap.AI, a.c.Policy, a.c.Clock, a.now(), u)
	refs := merge(map[string]string{"messageId": m.ID}, u.Refs())
	if tapped {
		inputs["reply"] = m.Reply.ID
		refs["via"] = m.Reply.Kind
	}
	a.log(nil, phone, "receive_message", "confirmed", inputs, logMore{notes: strings.Join(notes, "; "), refs: refs})
	if in.Kind == "stop" {
		return a.onStop(phone)
	}
	if c.OptedOut {
		return nil
	}
	switch in.Kind {
	case "pay":
		return a.onPay(phone, in)
	case "paid":
		return a.onPaidClaim(phone, in, "")
	case "discount":
		return a.onDiscount(phone, in)
	case "refund":
		return a.onRefundAsk(phone, in)
	case "owner":
		return a.onTalkToOwner(phone, phone)
	case "greeting", "yes", "no":
		return a.onMenu(phone, true, "", false)
	}
	text := m.Text
	if m.Reply != nil {
		text = ""
	}
	return a.onMenu(phone, false, text, in.OverrideAttempt)
}

// targetDue is agent.ts targetDue: the parent's own fee a button named, or their oldest open one; failing that (allowPaid), their latest.
func (a *Agent) targetDue(phone string, in intent, allowPaid bool) *Due {
	own := a.store.duesOf(phone)
	if in.DueID != "" {
		for _, d := range own {
			if d.ID == in.DueID {
				return d
			}
		}
	}
	if open := a.store.openDues(phone); len(open) > 0 {
		return open[0]
	}
	if allowPaid && len(own) > 0 {
		return own[0]
	}
	return nil
}

// pausedReply is agent.ts pausedReply.
func (a *Agent) pausedReply(phone, asked string) error {
	a.log(nil, phone, "new_work", "blocked", map[string]any{"asked": asked}, logMore{decisions: []Decision{a.pausedDecision()}, notes: "the parent is told online fee payment is paused and to contact the centre"})
	a.tellCustomer(nil, phone, []string{"fee_paused"}, sayOpts{})
	return nil
}

// onPay is agent.ts onPay.
func (a *Agent) onPay(phone string, in intent) error {
	if !a.takesNewWork() {
		return a.pausedReply(phone, "pay")
	}
	d := a.targetDue(phone, in, false)
	if d == nil {
		a.tellCustomer(nil, phone, []string{"fee_nothing_due"}, sayOpts{})
		return nil
	}
	_, receipt, err := a.look(d)
	if err != nil {
		return err
	}
	if d.State != Open {
		if !receipt {
			a.tellCustomer(d, phone, []string{"fee_already_paid"}, sayOpts{})
		}
		return nil
	}
	link, err := a.currentLink(d)
	if err != nil {
		return err
	}
	if !link.ok && link.paused {
		return a.pausedReply(phone, "pay")
	}
	if !link.ok {
		a.tellCustomer(d, phone, []string{"fee_link_failed"}, sayOpts{offer: ownerButton})
		a.tellOwner(d, phone, "owner_link_failed", sayOpts{})
		return nil
	}
	a.tellCustomer(d, phone, []string{"fee_pay_link"}, sayOpts{offer: feeButtons(d, "paid", "owner"), image: a.qrOf(d)})
	return nil
}

// onPaidClaim is agent.ts onPaidClaim: the payment record is read again and answers; what the parent says marks nothing.
func (a *Agent) onPaidClaim(phone string, in intent, via string) error {
	if via == "" {
		via = "words"
		if in.DueID != "" {
			via = "button"
		}
	}
	d := a.targetDue(phone, in, true)
	if d == nil {
		a.tellCustomer(nil, phone, []string{"fee_nothing_due"}, sayOpts{})
		return nil
	}
	_, receipt, err := a.look(d)
	if err != nil || receipt {
		return err
	}
	if d.State != Open && paidPaise(d) > 0 {
		a.tellCustomer(d, phone, []string{"fee_already_paid"}, sayOpts{})
		return nil
	}
	if d.State != Open {
		a.tellCustomer(nil, phone, []string{"fee_nothing_due"}, sayOpts{})
		return nil
	}
	link, err := a.currentLink(d)
	if err != nil {
		return err
	}
	if a.ownerConfirms {
		a.markClaim(d, phone, via, link.ok)
		return nil
	}
	if paidPaise(d) > 0 {
		if link.ok {
			a.tellCustomer(d, phone, []string{"fee_claim_partial"}, sayOpts{offer: feeButtons(d, "pay", "owner")})
		}
		return nil
	}
	a.log(d, phone, "ask_owner", "confirmed", map[string]any{"claim": "paid"}, logMore{notes: "the parent says the fee is paid and the payment record shows nothing; the fee stays open", refs: map[string]string{"to": "owner"}})
	if link.ok {
		a.tellCustomer(d, phone, []string{"fee_claim_not_found"}, sayOpts{offer: feeButtons(d, "pay", "owner")})
	}
	now := a.now()
	if d.ClaimTellAtMs == nil || now-*d.ClaimTellAtMs >= hourly {
		d.ClaimTellAtMs = N(now)
		a.tellOwner(d, phone, "owner_payment_claim", sayOpts{})
	}
	return nil
}

// onDiscount is agent.ts onDiscount: a discount is never offered; within the limit it is done and the owner told; above it the owner is asked for the exact amount.
func (a *Agent) onDiscount(phone string, in intent) error {
	if !a.takesNewWork() {
		return a.pausedReply(phone, "discount")
	}
	d := a.targetDue(phone, in, false)
	if d == nil {
		a.tellCustomer(nil, phone, []string{"fee_nothing_due"}, sayOpts{})
		return nil
	}
	if _, _, err := a.look(d); err != nil {
		return err
	}
	if d.State != Open {
		a.tellCustomer(d, phone, []string{"fee_already_paid"}, sayOpts{})
		return nil
	}
	for _, p := range d.Pending {
		if p.PendingKind() == "waiver" {
			a.tellCustomer(d, phone, []string{"fee_request_waiting"}, sayOpts{offer: ownerButton})
			return nil
		}
	}
	if d.WaiverDenied {
		link, err := a.currentLink(d)
		if err != nil {
			return err
		}
		if link.ok {
			a.tellCustomer(d, phone, []string{"fee_waiver_denied"}, sayOpts{offer: feeButtons(d, "pay", "owner")})
		}
		return nil
	}
	var decision *Decision
	if in.AmountInr != nil {
		dd := checkWaiver(*in.AmountInr, balanceInr(d), d.WaivedInr, a.settings.WaiverLimitInr, false)
		decision = &dd
	}
	if in.AmountInr == nil || decision.Verdict == "block" {
		now := a.now()
		told := d.DiscountTellAtMs != nil && now-*d.DiscountTellAtMs < hourly
		if !told {
			told = a.tellOwner(d, phone, "owner_discount_note", sayOpts{})
			if told {
				d.DiscountTellAtMs = N(now)
			}
		}
		var ds []Decision
		if decision != nil {
			ds = []Decision{*decision}
		}
		outcome, reply := "failed", "fee_couldnt_tell_owner"
		if told {
			outcome, reply = "confirmed", "fee_discount_to_owner"
		}
		a.log(d, phone, "ask_owner", outcome, map[string]any{"claim": "discount"}, logMore{decisions: ds, refs: map[string]string{"to": "owner"}, notes: "a discount was asked for without a usable amount; nothing was changed"})
		a.tellCustomer(d, phone, []string{reply}, sayOpts{offer: feeButtons(d, "pay", "owner")})
		return nil
	}
	amount := *in.AmountInr
	if decision.Verdict == "allow" {
		return a.applyWaiver(d, amount, "limit", []Decision{*decision})
	}
	req := &Waiver{Kind: "waiver", ID: a.store.NewRequestID(), AmountInr: amount, BalanceAtAskInr: balanceInr(d), AskedAtMs: a.now()}
	d.Pending = append(d.Pending, req)
	a.log(d, phone, "waiver_request", "held_for_owner", map[string]any{"amountInr": amount, "balanceInr": req.BalanceAtAskInr}, logMore{decisions: []Decision{*decision}, refs: map[string]string{"request": req.ID, "amountPaise": itoa(amount * 100)}})
	a.tellOwner(d, phone, "owner_waiver_request", sayOpts{waiverInr: N(amount), requestRef: req.ID})
	a.tellCustomer(d, phone, []string{"fee_waiver_asked"}, sayOpts{waiverInr: N(amount), offer: feeButtons(d, "pay", "owner")})
	return nil
}

// applyWaiver is agent.ts applyWaiver.
func (a *Agent) applyWaiver(d *Due, amountInr int64, by string, decisions []Decision) error {
	d.WaivedInr += amountInr
	notes := "within the waiver limit"
	if by == "owner" {
		notes = "the owner approved this waiver"
	}
	a.post(moneyEvent("discount", d.ID, amountInr*100), func(m map[string]string) {
		a.log(d, d.Customer, "waive_fee", "confirmed", map[string]any{"amountInr": amountInr}, logMore{decisions: decisions, refs: merge(map[string]string{"amountPaise": itoa(amountInr * 100), "by": by}, m), notes: notes})
	})
	if balancePaise(d) <= 0 {
		to := Closed
		if paidPaise(d) > 0 {
			to = Paid
		}
		if err := moveTo(d, to); err != nil {
			return err
		}
		a.log(d, d.Customer, "settle_fee", "confirmed", map[string]any{"waived": true}, logMore{refs: map[string]string{"amountPaise": itoa(paidPaise(d))}, notes: "the waiver covers what was left"})
		a.tellCustomer(d, d.Customer, []string{"fee_waiver_cleared"}, sayOpts{waiverInr: N(amountInr)})
	} else {
		link, err := a.currentLink(d)
		if err != nil {
			return err
		}
		switch {
		case link.ok:
			a.tellCustomer(d, d.Customer, []string{"fee_waiver_applied"}, sayOpts{waiverInr: N(amountInr), offer: feeButtons(d, "pay", "owner")})
		case !a.takesNewWork():
			a.tellCustomer(d, d.Customer, []string{"fee_paused"}, sayOpts{})
		default:
			a.tellCustomer(d, d.Customer, []string{"fee_link_failed"}, sayOpts{offer: ownerButton})
			a.tellOwner(d, d.Customer, "owner_link_failed", sayOpts{})
		}
	}
	if by == "limit" {
		a.tellOwner(d, d.Customer, "owner_waiver_applied", sayOpts{waiverInr: N(amountInr)})
	}
	return nil
}

// onRefundAsk is agent.ts onRefundAsk: never more than a payment on record; one refund for a payment; above the limit Guard holds it, otherwise the owner decides.
func (a *Agent) onRefundAsk(phone string, in intent) error {
	own := a.store.duesOf(phone)
	var d *Due
	if in.DueID != "" {
		for _, x := range own {
			if x.ID == in.DueID {
				d = x
			}
		}
	}
	if d == nil {
		for _, x := range own {
			if len(x.Payments) > 0 {
				d = x
				break
			}
		}
	}
	if d == nil && len(own) > 0 {
		d = own[0]
	}
	if d == nil {
		a.tellCustomer(nil, phone, []string{"fee_nothing_due"}, sayOpts{})
		return nil
	}
	if _, _, err := a.look(d); err != nil {
		return err
	}
	for _, p := range d.Pending {
		if k := p.PendingKind(); k == "refund_request" || k == "guard_hold" || k == "refund_retry" {
			a.tellCustomer(d, phone, []string{"fee_request_waiting"}, sayOpts{offer: ownerButton})
			return nil
		}
	}
	type candidate struct {
		p        CountedPayment
		refunded int64
	}
	var open []candidate
	for _, c := range d.Payments {
		if c.LinkID == CashLink {
			continue
		}
		var refunded int64
		if p, err := a.pay.FetchPayment(a.ctx, c.ID); err == nil && p != nil {
			refunded = p.AmountRefunded
		}
		if refunded == 0 {
			open = append(open, candidate{c, refunded})
		}
	}
	if len(open) == 0 {
		a.tellCustomer(d, phone, []string{"fee_refund_none"}, sayOpts{offer: ownerButton})
		return nil
	}
	best := 0
	for i := range open {
		if open[i].p.AmountPaise > open[best].p.AmountPaise {
			best = i // sort by amount, biggest first, stable: the first of the biggest
		}
	}
	target := open[best].p
	paidInr := target.AmountPaise / 100
	requested := paidInr
	if in.AmountInr != nil {
		requested = *in.AmountInr
	}
	once := checkOneRefundPerPayment(target.ID, 0)
	limit := checkRefundLimit(requested, a.settings.RefundLimitInr, float64(target.AmountPaise)/100, false)
	if limit.Verdict == "block" {
		a.log(d, phone, "refund", "blocked", map[string]any{"paymentId": target.ID, "amountInr": requested}, logMore{decisions: []Decision{once, limit}, refs: map[string]string{"paymentId": target.ID, "amountPaise": itoa(requested * 100)}, notes: "the parent asked for more than the payment on record"})
		a.tellCustomer(d, phone, []string{"fee_refund_too_much"}, sayOpts{paidInr: N(paidInr), offer: ownerButton})
		return nil
	}
	if limit.Verdict == "hold_for_owner" && !a.ownerRefunds {
		result, err := a.refunds.RequestRefund(a.ctx, refundCase{d}, target.ID, requested, []any{once, limit}, true, nil)
		if err != nil {
			return err
		}
		a.refunds.AfterRefund(refundCase{d}, result, payments.RefundAfter{PaymentID: target.ID, AmountInr: requested, DoneCust: "fee_refund_done", Held: "fee_refund_pending"})
		return nil
	}
	req := &RefundRequest{Kind: "refund_request", ID: a.store.NewRequestID(), AmountInr: requested, PaymentID: target.ID, AskedAtMs: a.now()}
	d.Pending = append(d.Pending, req)
	a.log(d, phone, "refund", "held_for_owner", map[string]any{"paymentId": target.ID, "amountInr": requested}, logMore{decisions: []Decision{once, limit}, refs: map[string]string{"request": req.ID, "paymentId": target.ID, "amountPaise": itoa(requested * 100)}})
	a.tellOwner(d, phone, "owner_refund_request", sayOpts{refundInr: N(requested), paidInr: N(paidInr), requestRef: req.ID})
	a.tellCustomer(d, phone, []string{"fee_refund_asked"}, sayOpts{refundInr: N(requested), paidInr: N(paidInr), offer: ownerButton})
	return nil
}

// onTalkToOwner is agent.ts onTalkToOwner: the owner told, once an hour for the same parent; replyTo is where the parent hears it (a parent's chat).
func (a *Agent) onTalkToOwner(phone, replyTo string) error {
	c := a.store.Customer(phone)
	now := a.now()
	recently := c.OwnerAskedAtMs != nil && now-*c.OwnerAskedAtMs < hourly
	told := recently
	if !recently {
		told = a.tellOwner(nil, phone, "owner_wants_to_talk", sayOpts{})
		if told {
			c.OwnerAskedAtMs = N(now)
		}
	}
	outcome, notes := "failed", "the owner could not be told"
	switch {
	case recently:
		outcome, notes = "confirmed", "the owner was already told in the last hour, so not again"
	case told:
		outcome, notes = "confirmed", "the parent asked to talk to the owner, and the owner was told"
	}
	a.log(nil, phone, "ask_owner", outcome, map[string]any{"by": "button"}, logMore{refs: map[string]string{"to": "owner"}, notes: notes})
	reply := "fee_couldnt_tell_owner"
	if told {
		reply = "fee_told_owner"
	}
	a.tellCustomer(nil, replyTo, []string{reply}, sayOpts{})
	return nil
}

// onMenu is agent.ts onMenu: a greeting, a yes or a no, or words that are none of these: what is owed, with the buttons; or that nothing is. Words nothing could read may be
// answered by the shop's talk first (agent_customertalk.go).
func (a *Agent) onMenu(phone string, understood bool, text string, overrideAttempt bool) error {
	if !a.takesNewWork() {
		return a.pausedReply(phone, "menu")
	}
	open := a.store.openDues(phone)
	if len(open) == 0 {
		// block M: words nothing could read, from a parent with nothing due: the assistant may still answer from what the centre has published
		if !understood && text != "" && a.talkToCustomer(phone, text, overrideAttempt, nil) {
			return nil
		}
		a.tellCustomer(nil, phone, []string{"fee_nothing_due"}, sayOpts{})
		return nil
	}
	d := open[0]
	_, receipt, err := a.look(d)
	if err != nil {
		return err
	}
	if d.State != Open {
		if !receipt {
			a.tellCustomer(d, phone, []string{"fee_already_paid"}, sayOpts{})
		}
		return nil
	}
	if _, err := a.currentLink(d); err != nil {
		return err
	}
	if understood {
		a.tellCustomer(d, phone, []string{"fee_menu"}, sayOpts{offer: feeButtons(d)})
	} else if text == "" || !a.talkToCustomer(phone, text, overrideAttempt, d) {
		a.tellCustomer(d, phone, []string{"fee_didnt_understand"}, sayOpts{offer: feeButtons(d)})
	}
	return nil
}

// onStop is agent.ts onStop.
func (a *Agent) onStop(phone string) error {
	a.store.Customer(phone).OptedOut = true
	a.log(nil, phone, "opt_out", "confirmed", map[string]any{"by": "STOP"}, logMore{notes: "no more messages to this parent, not even a reply; any reminder that falls due is stopped by the limits"})
	a.tellOwner(nil, phone, "owner_opted_out", sayOpts{})
	return nil
}

// onVoiceNote is agent.ts onVoiceNote with voice off (voice notes heard by a speech service are not ported for Fees): one plain line asking to type.
func (a *Agent) onVoiceNote(m messaging.InboundMessage) error {
	phone := m.From
	if phone == a.owner() {
		a.say.Say(a.ctx, a.args(nil, phone, "owner", []string{"voice_note"}, sayOpts{action: "voice_note_reply"}))
		return nil
	}
	a.log(nil, phone, "receive_message", "confirmed", map[string]any{"voiceNote": true, "id": m.ID}, logMore{notes: "a voice note: it is not listened to and nothing of it is kept", refs: map[string]string{"messageId": m.ID}})
	if a.store.Customer(phone).OptedOut {
		return nil
	}
	a.tellCustomer(nil, phone, []string{"voice_note"}, sayOpts{action: "voice_note_reply"})
	return nil
}

// ---- the owner's answers ----

// onOwnerMessage is agent.ts onOwnerMessage.
func (a *Agent) onOwnerMessage(m messaging.InboundMessage) error {
	owner := a.owner()
	if a.marks != nil {
		replyID := ""
		if m.Reply != nil {
			replyID = m.Reply.ID
		}
		if reply := ownermarked.ParseMarkReply(m.Text, replyID); reply != nil {
			return a.onOwnerMark(reply, m)
		}
	}
	if m.Image || isRelayReply(m) {
		return nil
	}
	if a.settings.Classes != nil {
		taken, err := a.classesTeacher(m)
		if err != nil || taken {
			return err
		}
	}
	g := ownerCommand.FindStringSubmatch(m.Text)
	var command, ref string
	var found *Due
	var pending payments.Pending
	if g != nil {
		command, ref = strings.ToLower(g[1]), g[2]
		id := strings.ToLower(g[2])
		for _, d := range a.store.Dues {
			for _, p := range d.Pending {
				switch x := p.(type) {
				case *Waiver:
					if x.ID == id && found == nil {
						found, pending = d, p
					}
				case *RefundRequest:
					if x.ID == id && found == nil {
						found, pending = d, p
					}
				}
			}
		}
	}
	var said map[string]string
	var commandIn, refIn any
	if command != "" {
		said, commandIn = map[string]string{"command": command}, command
	}
	if g != nil {
		refIn = ref
	}
	a.log(found, owner, "owner_decision", "attempted", map[string]any{"command": commandIn, "ref": refIn}, logMore{refs: said})
	if found == nil || command == "" {
		a.log(found, owner, "owner_decision", "blocked", map[string]any{"command": commandIn}, logMore{notes: "not a command for something waiting on the owner", refs: said})
		a.sayOwner("owner_unknown_command", sayOpts{})
		return nil
	}
	d := found
	var rest []payments.Pending
	for _, p := range d.Pending {
		if p != pending {
			rest = append(rest, p)
		}
	}
	d.Pending = rest
	if w, ok := pending.(*Waiver); ok {
		if command == "deny" {
			a.log(d, owner, "owner_decision", "confirmed", map[string]any{"command": command}, logMore{notes: "the owner declined the waiver", refs: said})
			d.WaiverDenied = true
			link, err := a.currentLink(d)
			if err != nil {
				return err
			}
			if link.ok {
				a.tellCustomer(d, d.Customer, []string{"fee_waiver_denied"}, sayOpts{offer: feeButtons(d, "pay", "owner")})
			}
			return nil
		}
		if _, _, err := a.look(d); err != nil {
			return err
		}
		if d.State != Open || balanceInr(d) != w.BalanceAtAskInr {
			a.log(d, owner, "owner_decision", "blocked", map[string]any{"command": command}, logMore{notes: "the fee changed since the owner was asked (the balance was " + itoa(w.BalanceAtAskInr) + " and is " + itoa(balanceInr(d)) + ", or the fee is no longer open), so the waiver was not applied", refs: said})
			a.tellOwner(d, d.Customer, "owner_request_stale", sayOpts{})
			return nil
		}
		decision := checkWaiver(w.AmountInr, balanceInr(d), d.WaivedInr, a.settings.WaiverLimitInr, true)
		if decision.Verdict != "allow" {
			a.log(d, owner, "owner_decision", "blocked", map[string]any{"command": command}, logMore{decisions: []Decision{decision}, refs: said})
			a.tellOwner(d, d.Customer, "owner_request_stale", sayOpts{})
			return nil
		}
		a.log(d, owner, "owner_decision", "confirmed", map[string]any{"command": command}, logMore{decisions: []Decision{decision}, refs: said})
		return a.applyWaiver(d, w.AmountInr, "owner", []Decision{decision})
	}
	r := pending.(*RefundRequest)
	if command == "deny" {
		a.log(d, owner, "owner_decision", "confirmed", map[string]any{"command": command}, logMore{notes: "the owner declined the refund", refs: said})
		a.tellCustomer(d, d.Customer, []string{"fee_refund_denied"}, sayOpts{})
		return nil
	}
	var refunded int64
	paid := 0.0
	if p, err := a.pay.FetchPayment(a.ctx, r.PaymentID); err == nil && p != nil {
		refunded, paid = p.AmountRefunded, float64(p.Amount)/100
	}
	once := checkOneRefundPerPayment(r.PaymentID, refunded)
	limit := checkRefundLimit(r.AmountInr, a.settings.RefundLimitInr, paid, true)
	if once.Verdict == "block" || limit.Verdict == "block" {
		a.log(d, owner, "owner_decision", "blocked", map[string]any{"command": command}, logMore{decisions: []Decision{once, limit}, refs: said})
		a.tellOwner(d, d.Customer, "owner_request_stale", sayOpts{})
		return nil
	}
	a.log(d, owner, "owner_decision", "confirmed", map[string]any{"command": command}, logMore{decisions: []Decision{once, limit}, refs: said})
	return a.sendOwnerRefund(d, r.PaymentID, r.AmountInr, "the owner approved the refund the parent asked for", []Decision{once, limit})
}

// sendOwnerRefund is agent.ts sendOwnerRefund: the one path for a refund the owner decided. A UPI centre's owner pays it back by hand; a gateway refund goes through Guard.
func (a *Agent) sendOwnerRefund(d *Due, paymentID string, amountInr int64, why string, decisions []Decision) error {
	if a.ownerRefunds {
		a.oweBack(d, paymentID, amountInr*100, why, decisions)
		return nil
	}
	ds := make([]any, len(decisions))
	for i, x := range decisions {
		ds[i] = x
	}
	result, err := a.refunds.RequestRefund(a.ctx, refundCase{d}, paymentID, amountInr, ds, a.refunds.OverLimit(amountInr), nil)
	if err != nil {
		return err
	}
	a.refunds.AfterRefund(refundCase{d}, result, payments.RefundAfter{PaymentID: paymentID, AmountInr: amountInr, DoneCust: "fee_refund_approved", Held: "fee_refund_pending"})
	return nil
}

// ---- the panel's to-do list ----

// onRecovery is agent.ts onRecovery.
func (a *Agent) onRecovery(ev map[string]any) error {
	caseID, _ := ev["case"].(string)
	action, _ := ev["action"].(string)
	id, _ := ev["id"].(string)
	d := a.store.Due(caseID)
	refs := map[string]string{"action": action, "recovery": id}
	note := func(outcome, notes string) {
		a.log(d, a.owner(), RecoveryEntry, outcome, map[string]any{"action": action, "case": caseID}, logMore{notes: notes, refs: refs})
	}
	if d == nil {
		note("blocked", "no fee has this id, so nothing was done")
		return nil
	}
	switch action {
	case "recheck_payment":
		if len(d.Links) == 0 {
			note("blocked", "this fee has no payment link to look at")
			return nil
		}
		note("attempted", "looking again at the payments service's list for this fee's links")
		ok, _, err := a.look(d)
		if err != nil {
			return err
		}
		if ok {
			note("confirmed", "the payments service's list was read; any payment not yet counted was recorded above")
		} else {
			note("failed", "the payments service could not be read whole just now; nothing was changed")
		}
		return nil
	case "ask_owner_again":
		if a.marks != nil && a.markAskAgain(d, note) {
			return nil
		}
		var waiting payments.Pending
		for _, p := range d.Pending {
			if k := p.PendingKind(); (k == "waiver" || k == "refund_request") && waiting == nil {
				waiting = p
			}
		}
		if waiting == nil {
			note("blocked", "nothing the agent asked the owner is waiting (a refund Guard holds is asked by the approvals relay)")
			return nil
		}
		note("attempted", "telling the owner again")
		var told bool
		if w, ok := waiting.(*Waiver); ok {
			told = a.tellOwner(d, d.Customer, "owner_waiver_request", sayOpts{waiverInr: N(w.AmountInr), requestRef: w.ID})
		} else {
			r := waiting.(*RefundRequest)
			told = a.tellOwner(d, d.Customer, "owner_refund_request", sayOpts{refundInr: N(r.AmountInr), paidInr: N(paidPaise(d) / 100), requestRef: r.ID})
		}
		if told {
			note("confirmed", "the owner was told again")
		} else {
			note("failed", "the owner could not be told (the limits or the provider said no)")
		}
		return nil
	case "recheck_refund":
		unclear := false
		for _, i := range d.RefundIssues {
			unclear = unclear || contains([]string{"unknown", "uncertain", "unconfirmed", "failed"}, i.Kind)
		}
		if !unclear {
			note("blocked", "no refund here is waiting on an unclear outcome")
			return nil
		}
		note("attempted", "looking again, read-only, for a refund that may have gone")
		settled, looked, told, err := a.refunds.Recheck(a.ctx, refundCase{d})
		if err != nil {
			return err
		}
		note("confirmed", payments.RecheckLine(settled, looked, told))
		return nil
	}
	note("blocked", `the agent has no recovery called "`+action+`"`)
	return nil
}

// ---- the centre's public chat (W1) ----

// onChatMessage is agent.ts onChatMessage: a guest's send run as its own step under the guest's conversation (runtime.ChatTurn keeps it, makes it once and caps it).
func (a *Agent) onChatMessage(ev map[string]any) error {
	cs := a.store.chanState()
	_, err := runtime.ChatTurn(runtime.ChatTurnDeps{
		State: cs, Now: a.now(), Day: a.c.Clock.Day, Kind: "fees", Budget: a.c.Policy.Budget,
		ModelCalls: func() int64 { return 0 },
		SetLanguage: func(conversation, lang string) {
			if contains(a.settings.Languages, lang) {
				a.store.Customer(conversation).Language = lang
			}
		},
		Run: func(in runtime.ChatInbound) error { return a.onChatTurn(in.InboundMessage) },
	}, runtime.ChatMessageOf(ev))
	return err
}

// onChatTurn is agent.ts onChatTurn: PUBLIC questions only. A parent's own chat (W2) is not ported (Deferred.md): a parent's thread gets the public line too.
func (a *Agent) onChatTurn(m messaging.InboundMessage) error {
	phone := m.From
	c := a.store.Customer(phone)
	if contains(a.store.SeenMessages, m.ID) {
		return nil
	}
	a.store.SeenMessages = append(a.store.SeenMessages, m.ID)
	var in intent
	if m.Reply != nil {
		if t := intentFromReply(m.Reply.ID); t != nil {
			in = *t
		}
	}
	if in.Kind == "" {
		in = parseIntent(m.Text)
	}
	inputs := map[string]any{"text": m.Text, "id": m.ID}
	if m.Reply != nil {
		inputs["reply"] = m.Reply.ID
	}
	a.log(nil, phone, "receive_message", "confirmed", inputs, logMore{notes: "a public question from the chat on the centre's page; no fee or student is read for it", refs: map[string]string{"messageId": m.ID, "channel": "chat"}})
	if in.Kind == "stop" {
		return a.onStop(phone)
	}
	if c.OptedOut {
		return nil
	}
	if in.Kind == "owner" {
		return a.onTalkToOwner(phone, phone)
	}
	if !a.takesNewWork() {
		return a.pausedReply(phone, "menu")
	}
	a.tellCustomer(nil, phone, []string{"fee_chat_public"}, sayOpts{offer: &offer{buttons: []string{"owner"}}})
	return nil
}

// moneyEvent is a money event of one fee (fee_charged, late_fee, discount) for the books.
func moneyEvent(kind, caseID string, amountPaise int64) accounting.MoneyEvent {
	return accounting.MoneyEvent{Kind: accounting.MoneyKind(kind), Case: strp(caseID), AmountPaise: amountPaise}
}
