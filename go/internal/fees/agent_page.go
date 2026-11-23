package fees

// The pages' presses: agent.ts onChannelFee (a parent's press on their private page: "show how to pay", "I have paid"), onOwnerAction (the owner's page: what waits, by its
// digest, handled exactly as the same reply on WhatsApp; a parent's link sent anew or switched off; cash or a bank transfer marked by hand; Classes' attendance and doubts) and
// onOwnerCash. The owner's talk box and a card's answer belong to the shop's assistant (agent_assistant.go): on a centre without it both are refused in the record, as the
// TypeScript does.

import (
	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
)

// onChannelFee is agent.ts onChannelFee.
func (a *Agent) onChannelFee(ev map[string]any) error {
	op, _ := ev["op"].(string)
	linkHash, _ := ev["parent"].(string)
	dueID, _ := ev["dueId"].(string)
	handle, _ := ev["handle"].(string)
	upiRef, _ := ev["upiRef"].(string)
	cs := a.store.confirmationsOf(true)
	if op == "fee_paid" && cs.get(handle) != nil {
		return nil // the same press again (its task key is the handle)
	}
	now := a.now()
	parent := a.store.parentOf(linkHash)
	d := a.store.Due(dueID)
	refuse := func(reason, notes string) error {
		if op == "fee_paid" {
			r := reason
			cs.set(handle, &Confirmation{DueID: dueID, Parent: parent, AtMs: now, Refused: &r})
		}
		var of *Due
		phone := a.owner()
		if d != nil && parent != "" && d.Customer == parent {
			of = d
		}
		if parent != "" {
			phone = parent
		}
		a.log(of, phone, "channel_fee", "blocked", map[string]any{"op": op, "dueId": dueID}, logMore{refs: map[string]string{"channel": "web", "op": op, "reason": reason}, notes: notes})
		return nil
	}
	if parent == "" {
		return refuse("link_gone", "the parent's link was replaced or switched off before this press was done: nothing was done")
	}
	if d == nil || d.Customer != parent {
		return refuse("unknown", "no fee of this parent's has that id: nothing was done (a link never reaches another parent's fees)")
	}
	if op == "fee_paid" {
		cs.set(handle, &Confirmation{DueID: d.ID, Parent: parent, AtMs: now})
		// the newest few per fee stay (a stable sort, newest first)
		var mine []string
		for _, h := range cs.Keys {
			c := cs.get(h)
			if c.DueID == d.ID && c.Parent == parent && c.Refused == nil {
				mine = append(mine, h)
			}
		}
		for i := 1; i < len(mine); i++ {
			for j := i; j > 0 && cs.get(mine[j]).AtMs > cs.get(mine[j-1]).AtMs; j-- {
				mine[j], mine[j-1] = mine[j-1], mine[j]
			}
		}
		for _, h := range mine[min(len(mine), ConfirmationsPerFee):] {
			cs.del(h)
		}
	}
	notes := "the parent asked, on their private page, how to pay"
	if op == "fee_paid" {
		notes = "the parent says, on their private page, that the fee is paid; nothing is marked paid until the record shows it"
	}
	a.log(d, parent, "channel_fee", "confirmed", map[string]any{"op": op}, logMore{refs: map[string]string{"channel": "web", "op": op}, notes: notes})
	if _, _, err := a.look(d); err != nil {
		return err
	}
	if d.State != Open {
		return nil
	}
	if op == "fee_pay" && !a.takesNewWork() {
		return refuse("paused", "online fee payment is paused (the centre's licence): no link is made")
	}
	link, err := a.currentLink(d)
	if err != nil {
		return err
	}
	if !link.ok && !link.paused && (d.LinkFailTellAtMs == nil || now-*d.LinkFailTellAtMs >= hourly) {
		d.LinkFailTellAtMs = N(now)
		a.tellOwner(d, parent, "owner_link_failed", sayOpts{})
	}
	if op == "fee_pay" {
		return nil
	}
	if upiRef != "" {
		d.ClaimRef = upiRef
	}
	if a.ownerConfirms {
		a.markClaim(d, parent, "page", link.ok)
		return nil
	}
	d.ClaimAtMs = N(now)
	a.log(d, parent, "ask_owner", "confirmed", map[string]any{"claim": "paid"}, logMore{notes: "the parent says, on their private page, that the fee is paid and the payment record shows nothing yet; the fee stays open", refs: map[string]string{"to": "owner"}})
	if d.ClaimTellAtMs == nil || now-*d.ClaimTellAtMs >= hourly {
		d.ClaimTellAtMs = N(now)
		a.tellOwner(d, parent, "owner_payment_claim", sayOpts{})
	}
	return nil
}

func (a *Agent) pageAction(d *Due, outcome, action string, notes string, more map[string]any) {
	in := map[string]any{"action": action}
	for k, v := range more {
		in[k] = v
	}
	a.log(d, a.owner(), "owner_page_action", outcome, in, logMore{refs: map[string]string{"channel": "owner_page", "action": action}, notes: notes})
}

// onOwnerAction is agent.ts onOwnerAction.
func (a *Agent) onOwnerAction(ev map[string]any) error {
	action, _ := ev["action"].(string)
	caseID, _ := ev["case"].(string)
	digest, _ := ev["digest"].(string)
	id, _ := ev["id"].(string)
	switch action {
	case "card_yes", "card_no":
		// item 11e on the page: an answer to one of the assistant's cards, bound by the card's own digest, exactly as a tap on WhatsApp
		as := a.assistantOf()
		if as == nil {
			a.pageAction(nil, "blocked", action, "a card's answer came for a shop without the assistant: nothing was done", map[string]any{"case": caseID})
			return nil
		}
		a.pageAction(nil, "confirmed", action, "pressed by the owner on their page; the card's own binding decides, as for a tap on WhatsApp", map[string]any{"case": caseID})
		answer := "yes"
		if action == "card_no" {
			answer = "no"
		}
		as.OnPageCard(caseID, digest, answer)
		return a.stepErr
	case "send_link", "revoke_link":
		var shown *parentRow
		for _, p := range parentsList(a.settings, a.store) {
			if p.Ref == caseID && p.Digest == digest {
				p := p
				shown = &p
			}
		}
		if shown == nil || (action == "revoke_link" && shown.Link != "active") {
			a.pageAction(nil, "blocked", action, "the parent's link is not as the owner's page showed it (already changed): nothing was done", nil)
			return nil
		}
		notes := "the owner asked, on their page, for a new private link to be sent to a parent"
		if action == "revoke_link" {
			notes = "the owner switched a parent's private link off on their page"
		}
		a.pageAction(nil, "confirmed", action, notes, nil)
		if action == "revoke_link" {
			a.revokeLink(shown.Phone)
			return nil
		}
		url, token := a.linkFor(shown.Phone, true)
		if url == "" {
			a.log(nil, a.owner(), "parent_link", "blocked", map[string]any{}, logMore{notes: "the centre has no page yet (no pages file), so no link can be made"})
			return nil
		}
		var latest *Due
		if open := a.store.openDues(shown.Phone); len(open) > 0 {
			latest = open[0]
		} else if all := a.store.duesOf(shown.Phone); len(all) > 0 {
			latest = all[0]
		}
		if a.tellCustomer(latest, shown.Phone, []string{"fee_page_link"}, sayOpts{pageLink: url}) {
			a.keepLink(shown.Phone, token, "owner")
		} else {
			a.log(nil, a.owner(), "parent_link", "failed", map[string]any{}, logMore{notes: "the message with the new link was not accepted, so the parent's old link (if any) still works and nothing changed"})
		}
		return nil
	case "cash", "bank":
		return a.onOwnerCash(ev)
	case "credit_ask":
		// the credit book: the owner's tap on their page that sends the first question, bound to the account as the page showed it (credit.go)
		var acc *CreditAccount
		if a.credit() {
			for _, r := range creditRows(a.store) {
				if r.Ref == caseID && r.Digest == digest && r.Askable {
					acc = a.store.creditOf(false).byRef(caseID)
				}
			}
		}
		if acc == nil {
			a.pageAction(nil, "blocked", action, "the account is not as the owner's page showed it (already asked, paid, or changed since): nothing was sent", map[string]any{"case": caseID})
			return nil
		}
		a.pageAction(a.openCreditDue(acc), "confirmed", action, "pressed by the owner on their page: the first question to this customer", map[string]any{"case": caseID})
		a.creditAsk(acc)
		return nil
	case "present", "absent", "answered":
		done, err := a.classesPageAction(action, caseID, digest)
		if err != nil {
			return err
		}
		outcome, notes := "blocked", "what the owner's page showed is not what waits now (already marked or answered, or gone): nothing was done"
		if done {
			outcome, notes = "confirmed", "pressed by the teacher on their page"
		}
		a.pageAction(nil, outcome, action, notes, map[string]any{"case": caseID})
		return nil
	}
	var item *ownerItem
	for _, x := range ownerItems(a.settings, a.store) {
		if x.Case == caseID && x.Digest == digest && contains(x.Actions, action) {
			x := x
			item = &x
			break
		}
	}
	d := a.store.Due(caseID)
	if item == nil {
		a.pageAction(d, "blocked", action, "what the owner's page showed is not what waits now (already answered, a new mark since, or gone): nothing was done", map[string]any{"case": caseID})
		return nil
	}
	a.pageAction(d, "confirmed", action, "pressed by the owner on their page; handled exactly as the same reply on WhatsApp", map[string]any{"case": caseID})
	msg := messaging.InboundMessage{ID: "owner-page:" + id, From: a.owner(), Timestamp: a.now()}
	if item.code != "" {
		kind := ownermarked.ReplyReceived
		if action != "received" {
			kind = ownermarked.ReplyRefunded
		}
		msg.Reply = &messaging.Reply{ID: ownermarked.MarkButtonID(kind, item.code), Kind: "button"}
	} else {
		msg.Text = action + " " + item.request
	}
	return a.onOwnerMessage(msg)
}

// onOwnerCash is agent.ts onOwnerCash: the owner marks an open fee paid in cash (or by a bank transfer), the whole balance or a part, bound to what the page showed.
func (a *Agent) onOwnerCash(ev map[string]any) error {
	action, _ := ev["action"].(string)
	caseID, _ := ev["case"].(string)
	digest, _ := ev["digest"].(string)
	var shown *cashRow
	for _, x := range cashList(a.settings, a.store) {
		if x.Case == caseID && x.Digest == digest {
			x := x
			shown = &x
		}
	}
	d := a.store.Due(caseID)
	if shown == nil || d == nil || d.State != Open {
		a.pageAction(d, "blocked", action, "the fee is not as the owner's page showed it (paid, waived or changed since): nothing was marked", map[string]any{"case": caseID})
		return nil
	}
	balance := balancePaise(d)
	amount := balance
	if v, ok := ev["amountPaise"].(float64); ok {
		amount = int64(v)
	}
	if amount < 100 || amount%100 != 0 || amount > balance {
		a.pageAction(d, "blocked", action, "the amount marked is not whole rupees, or is more than what is owed on the fee: nothing was marked", map[string]any{"case": caseID})
		return nil
	}
	via := "cash"
	if action == "bank" {
		via = "bank"
	}
	return a.recordCash(d, amount, via, "page", func() {
		a.pageAction(d, "confirmed", action, "the owner marked this fee paid in cash (or by a transfer the agent cannot see) on their private page", map[string]any{"case": caseID})
	})
}

// recordCash is the owner's mark of money paid by hand (cash, or a bank transfer the agent cannot see) on an open fee: a payment on no link and no payments service, recorded
// as "marked paid by owner", never as a confirmed payment; then what the record shows is settled as for any payment. `where` is where the owner marked it: "page" (the cash
// list on their page, agent.ts onOwnerCash) or "words" (the credit book's "Ramesh paid 1,000", credit.go). `before` writes the line that comes first (the page's press).
func (a *Agent) recordCash(d *Due, amount int64, via, where string, before func()) error {
	balance := balancePaise(d)
	n := 1
	for _, p := range d.Payments {
		if p.LinkID == CashLink {
			n++
		}
	}
	c := CountedPayment{ID: "cash-" + d.ID + "-" + itoa(int64(n)), AmountPaise: amount, LinkID: CashLink}
	d.Payments = append(d.Payments, c)
	if before != nil {
		before()
	}
	notes := "marked paid by owner: paid by hand (cash or a bank transfer), from the owner's own page; no payments service holds it"
	if where == "words" {
		notes = "marked paid by owner: paid at the counter, in the owner's own words to the credit book; no payments service holds it"
	}
	a.post(accounting.MoneyEvent{Kind: "received", Case: strp(d.ID), PaymentID: c.ID, AmountPaise: amount, Method: accounting.Method(via), Evidence: "owner_mark", For: "fee"}, func(m map[string]string) {
		a.log(d, a.owner(), ActMarked, "confirmed", map[string]any{"via": via, "amountPaise": amount}, logMore{refs: merge(map[string]string{"paymentId": c.ID, "amountPaise": itoa(amount), "markedBy": "owner", "via": via}, m), notes: notes})
	})
	if amount < balance {
		if _, err := a.currentLink(d); err != nil {
			return err
		}
	}
	if _, err := a.settle(d, []CountedPayment{c}); err != nil {
		return err
	}
	if d.State != Open {
		a.closeOpenLinks(d)
	}
	return nil
}

// onOwnerPageMessage is agent.ts onOwnerPageMessage: the owner's talk box on their page (typed words, or a recording the runtime holds in memory) is the shop's assistant's; a
// centre without one reads nothing. A recording is heard by no one on Go for Fees (Deferred.md): the owner is asked to type it, as with voice off.
func (a *Agent) onOwnerPageMessage(ev map[string]any) error {
	_, voice := ev["voice"]
	// the credit book's words typed on the owner's page are read as on WhatsApp, before (and without) the assistant (credit.go); the answer goes to the owner as the WhatsApp one does
	if text, _ := ev["text"].(string); a.credit() && !voice && text != "" {
		if taken, err := a.creditOwnerText(text, ""); err != nil || taken {
			return err
		}
	}
	as := a.assistantOf()
	if as == nil {
		a.log(nil, a.owner(), "owner_page_message", "blocked", map[string]any{"voice": voice}, logMore{refs: map[string]string{"channel": "owner_page"}, notes: "the owner's talk box is the shop's assistant's, and this shop has none: nothing was read"})
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
