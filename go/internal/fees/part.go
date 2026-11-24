package fees

// A Fees centre as ONE PART of a shop of several template parts (decision 65, runtime.PartAgent; internal/parts routes a message to the part it belongs to). In practice the part
// is the credit book (the `creditBook` block). Every method here reads only: no record line, no change to the state, so asking a part "is this yours?" costs nothing when the
// answer is no. The rules are the agent's own (onOwnerMessage, creditOwnerText, onMessage), read the same way, in the same order.

import (
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var _ runtime.PartAgent = (*Agent)(nil)

func replyOf(m messaging.InboundMessage) string {
	if m.Reply != nil {
		return m.Reply.ID
	}
	return ""
}

// ClaimOwner: the owner's mark of a code in this centre's own ledger, "approve q-3" for a request it holds, the credit book's Ask button, and the credit book's words when its
// reader would take them (creditTakes).
func (a *Agent) ClaimOwner(m messaging.InboundMessage) runtime.Claim {
	replyID := replyOf(m)
	if a.marks != nil {
		if reply := ownermarked.ParseMarkReply(m.Text, replyID); reply != nil && ownermarked.HasCode(a.marks, reply.Code) {
			return runtime.ClaimCommand
		}
	}
	if g := ownerCommand.FindStringSubmatch(m.Text); g != nil && a.holdsRequest(strings.ToLower(g[2])) {
		return runtime.ClaimCommand
	}
	if a.credit() {
		if strings.HasPrefix(replyID, creditAskButton) && a.store.creditOf(false).byRef(strings.TrimPrefix(replyID, creditAskButton)) != nil {
			return runtime.ClaimCommand
		}
		if !ownerCommand.MatchString(m.Text) && a.creditTakes(m.Text) {
			return runtime.ClaimWords
		}
	}
	return runtime.ClaimNone
}

// holdsRequest: a waiver or a refund request "q-3" waits on one of the centre's fees.
func (a *Agent) holdsRequest(id string) bool {
	for _, d := range a.store.Dues {
		for _, p := range d.Pending {
			switch x := p.(type) {
			case *Waiver:
				if x.ID == id {
					return true
				}
			case *RefundRequest:
				if x.ID == id {
					return true
				}
			}
		}
	}
	return false
}

// creditTakes is creditOwnerText's decision without its effects: would the credit book take these words (an entry, a mark, the list, an ask, a number it waits for, or its help
// line for words with a phone number in them, so a customer's number never reaches another part or a model)? A name the settings put in the book counts as known before the
// book has opened it (creditOpen runs at the start of the centre's own step).
func (a *Agent) creditTakes(text string) bool {
	said := readCredit(text)
	known := a.store.creditOf(false).byName(said.name) != nil
	if !known && said.name != "" {
		for _, p := range a.settings.Credit.People {
			if nameKey(p.Name) == nameKey(said.name) {
				known = true
			}
		}
	}
	switch said.kind {
	case "list", "number":
		return true
	case "ask", "paid":
		return known || said.hasPhone
	case "owes":
		if said.name == "" || !said.hasAmount || (said.weak && !known && !said.hasPhone) {
			return said.hasPhone
		}
		return true
	case "unclear":
		return known || said.hasPhone
	}
	return said.hasPhone
}

// ClaimCustomer: someone in the credit book, or a parent with fees: open with them; their yes or no, a payment, a refund or a STOP read by the centre's rules is about it. The
// centre takes no customer it has never met (a new customer is the shop's other parts').
func (a *Agent) ClaimCustomer(m messaging.InboundMessage) runtime.Claim {
	if a.creditAccountOf(m.From) == nil && len(a.store.duesOf(m.From)) == 0 && !a.creditPerson(m.From) {
		return runtime.ClaimNone
	}
	if m.Reply != nil && intentFromReply(m.Reply.ID) != nil {
		return runtime.ClaimCommand // a tap on one of the centre's own buttons
	}
	if m.Image {
		return runtime.ClaimWords // a picture from someone the centre knows may be a payment's screenshot (it is read as "I paid", never as paid)
	}
	// someone in the credit book who has not said yes: the book's gate decides what they hear (nothing before their yes), so every word of theirs is the book's, never a question
	if acc := a.creditAccountOf(m.From); (acc != nil && acc.Consent != "yes") || (acc == nil && a.creditPerson(m.From)) {
		switch parseIntent(m.Text).Kind {
		case "yes", "no", "pay", "paid", "refund", "stop":
			return runtime.ClaimOpen
		}
		return runtime.ClaimWords // above a part that only takes new customers, below another part's own reading (a hold asked for in words)
	}
	switch parseIntent(m.Text).Kind {
	case "yes", "no", "pay", "paid", "refund", "stop":
		return runtime.ClaimOpen
	case "discount", "owner":
		return runtime.ClaimWords
	}
	// words the centre's rules do not read, from someone it knows: the centre's, above a part that only takes new customers; a part whose own rules read them whole (the
	// hold's order, which it claims as open) still takes them
	return runtime.ClaimWords
}

// creditPerson: the settings' credit book names this number (the book opens its people on the centre's first step, which may not have run yet).
func (a *Agent) creditPerson(phone string) bool {
	if !a.credit() {
		return false
	}
	for _, p := range a.settings.Credit.People {
		if p.Phone == phone {
			return true
		}
	}
	return false
}

// OwnsCase: a fee (f-3), a request (q-2), a credit account (c-4), a parent (p- and 12 hex digits, the owner page's send_link and revoke_link), anything the centre's own
// owner page lists, and with Classes a doubt (d-3) or a class session's case.
func (a *Agent) OwnsCase(ref string) bool {
	if feeRef.MatchString(ref) || parentRefRe.MatchString(ref) || (a.credit() && a.store.creditOf(false).byRef(ref) != nil) {
		return true
	}
	for _, x := range ownerItems(a.settings, a.store) {
		if x.Case == ref {
			return true
		}
	}
	return a.settings.Classes != nil && (doubtRefRe.MatchString(ref) || strings.Contains(ref, "."))
}

var (
	parentRefRe = regexp.MustCompile(`^p-[0-9a-f]{12}$`)
	doubtRefRe  = regexp.MustCompile(`^d-\d+$`)
)

// TakesChannel: a fee's page pays or says it paid.
func (a *Agent) TakesChannel(op string) bool { return op == "fee_pay" || op == "fee_paid" }

// AssistantHooks: the Fees skill for the shop's one assistant, when the centre has one.
func (a *Agent) AssistantHooks() (runtime.AssistantHooks, bool) {
	if a.settings.Assistant == nil {
		return runtime.AssistantHooks{}, false
	}
	return a.assistantHooks(), true
}

// PartMessaging is the agent's own WhatsApp for this step.
func (a *Agent) PartMessaging() messaging.Messaging { return a.msg }
