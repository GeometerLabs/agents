package stockorders

// Stock orders as ONE PART of a shop of several template parts (decision 65, runtime.PartAgent; internal/parts routes a message to the part it belongs to). Every method here reads
// only: no record line, no change to the state. The rules are the agent's own (handleMessage, onOwnerMessage, readOwnerText), read in the same order.
//
// A command without an order's reference ("paid", "received 6 boxes") is the part's only when it has an order open for it to be about: "Ramesh paid 1,000" in a shop with the
// credit book and no purchase order open is not a supplier's payment. With an order open, both parts may claim such words, and the shop asks which was meant (nothing about
// money happens on a guess).

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var _ runtime.PartAgent = (*Agent)(nil)

// ClaimOwner: a card's answer for one of its order cards, a command naming its own order, a question it is waiting on the owner to answer, an order of an item or from a
// supplier, the order status, and a command without a reference while it has an order open.
func (a *Agent) ClaimOwner(m messaging.InboundMessage) runtime.Claim {
	replyID := ""
	if m.Reply != nil {
		replyID = m.Reply.ID
	}
	code := ""
	if mm := buttonRe.FindStringSubmatch(replyID); mm != nil {
		code = mm[2]
	} else if mm := typedRe.FindStringSubmatch(m.Text); mm != nil {
		code = mm[2]
	}
	if code != "" {
		if c := a.cardByCode(strings.ToUpper(code)); c != nil && a.isOrderCard(c) {
			return runtime.ClaimCommand
		}
		return runtime.ClaimNone // another skill's card: the shop's one assistant answers it
	}
	r := readOwnerText(a.s, m.Text)
	switch r.Kind {
	case "command":
		if r.Ref != "" {
			if a.st.order(r.Ref) != nil {
				return runtime.ClaimCommand
			}
			return runtime.ClaimWords
		}
		if a.anyOpen() {
			return runtime.ClaimWords
		}
	case "order":
		if r.Item != "" || len(r.Tied) > 0 || r.Supplier != "" || r.UnknownSupplier != "" {
			return runtime.ClaimWords
		}
	case "status":
		return runtime.ClaimWords
	}
	if a.st.Asking != nil {
		return runtime.ClaimWords // the answer to a question it asked the owner
	}
	return runtime.ClaimNone
}

func (a *Agent) anyOpen() bool {
	for _, o := range a.st.Orders {
		if isOpen(o) {
			return true
		}
	}
	return false
}

// ClaimCustomer: a listed supplier's message is the part's; nobody else's is (Stock orders writes to its suppliers and its owner only).
func (a *Agent) ClaimCustomer(m messaging.InboundMessage) runtime.Claim {
	if a.supplierByNumber(m.From) != nil {
		return runtime.ClaimCommand
	}
	return runtime.ClaimNone
}

// OwnsCase: a purchase order (po-3).
func (a *Agent) OwnsCase(ref string) bool { return poRef.MatchString(ref) }

// TakesChannel: Stock orders has no public page.
func (a *Agent) TakesChannel(string) bool { return false }

// AssistantHooks: the Stock orders skill for the shop's one assistant, when the shop has one.
func (a *Agent) AssistantHooks() (runtime.AssistantHooks, bool) {
	if !a.s.Assistant {
		return runtime.AssistantHooks{}, false
	}
	return a.assistantHooks(), true
}

// PartMessaging is the agent's own WhatsApp for this step (the owner's route; its suppliers' numbers pass through).
func (a *Agent) PartMessaging() messaging.Messaging { return a.msg }
