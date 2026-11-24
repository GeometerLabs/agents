package orders

// An Orders shop as ONE PART of a shop of several template parts (decision 65, runtime.PartAgent; internal/parts routes a message to the part it belongs to). In the shop starter
// the part is the pickup hold (`"advance": {"mode": "none"}`). Every method here reads only: no record line, no change to the state. The rules are the agent's own
// (onOwnerMessage's fixed commands, onMessage's reading), read in the same order.

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/reading"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var _ runtime.PartAgent = (*Agent)(nil)

// ClaimOwner: the owner's mark of a code in this shop's own ledger, and its fixed commands about one of its own orders ("approve o-3", "balance o-3 cash", a price card's answer,
// "pick o-3 <item>", "collected o-3").
func (a *Agent) ClaimOwner(m messaging.InboundMessage) runtime.Claim {
	replyID := ""
	if m.Reply != nil {
		replyID = m.Reply.ID
	}
	if a.marks != nil {
		if reply := ownermarked.ParseMarkReply(m.Text, replyID); reply != nil && ownermarked.HasCode(a.marks, reply.Code) {
			return runtime.ClaimCommand
		}
	}
	own := func(g []string) bool { return g != nil && a.store.Order(strings.ToLower(g[1])) != nil }
	if own(balanceCmd.FindStringSubmatch(m.Text)) {
		return runtime.ClaimCommand
	}
	if a.settings.Discounts != nil && discountCommand.MatchString(m.Text) {
		if g := discountCommand.FindStringSubmatch(m.Text); a.store.Order(strings.ToLower(g[2])) != nil {
			return runtime.ClaimCommand
		}
	}
	if a.settings.NoAdvance() && (own(holdPickCmd.FindStringSubmatch(m.Text)) || own(collectedCmd.FindStringSubmatch(m.Text))) {
		return runtime.ClaimCommand
	}
	if g := ownerCommand.FindStringSubmatch(m.Text); g != nil && a.store.Order(strings.ToLower(g[2])) != nil {
		return runtime.ClaimCommand
	}
	return runtime.ClaimNone
}

// ClaimCustomer: a picture (an item enquiry in a pickup-hold shop, a payment screenshot in an advance shop), a tap on one of the shop's own buttons, a customer with a live order
// (their words about it read by the shop's rules), and any customer it has not met: an Orders shop takes new customers.
func (a *Agent) ClaimCustomer(m messaging.InboundMessage) runtime.Claim {
	if m.Image {
		return runtime.ClaimOpen
	}
	if m.Reply != nil && reading.IntentFromReply(m.Reply.ID, a.parse) != nil {
		return runtime.ClaimCommand
	}
	if a.store.LatestOrder(m.From, LiveStates) == nil {
		return runtime.ClaimNew // nothing open with them: a new piece of business, which an Orders shop takes
	}
	switch k := reading.ParseIntent(m.Text, a.parse).Kind; k {
	case "", "greeting", "unknown":
		return runtime.ClaimWords
	case "paid":
		if a.settings.NoAdvance() {
			return runtime.ClaimWords // a pickup hold takes no money: "I paid" is not about a hold
		}
	}
	return runtime.ClaimOpen
}

// OwnsCase: an order (o-3) or a group (g-2) is this shop's (the Orders skill's own references).
func (a *Agent) OwnsCase(ref string) bool { return orderRef.MatchString(ref) }

// TakesChannel: the order page's order, cancel and "I have paid".
func (a *Agent) TakesChannel(op string) bool { return op == "order" || op == "cancel" || op == "paid" }

// AssistantHooks: the Orders skill for the shop's one assistant, when the shop has one.
func (a *Agent) AssistantHooks() (runtime.AssistantHooks, bool) {
	if a.settings.Assistant == nil {
		return runtime.AssistantHooks{}, false
	}
	return a.assistantHooks(), true
}

// PartMessaging is the agent's own WhatsApp for this step.
func (a *Agent) PartMessaging() messaging.Messaging { return a.msg }
