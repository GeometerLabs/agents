package runtime

// The seam for a shop of several template parts (decision 65, owner 24 Nov 2026: "one shop can run several template parts"; stream d65-parts-25nov). A part is a template
// (the credit book, Stock orders, the pickup hold) run inside ONE shop program (go/internal/parts, go/cmd/parts) behind the shop's one number, one record, one stock count, one
// owner's sign-in and one assistant. Nothing here changes a single-part shop: every field is zero for it and every check below falls through to what it did before.
//
// What a part's agent gives the shop's router (PartAgent): how sure it is that a message is its own, read by its rules alone and with no effect (Claim); which case references
// are its own; which public-page requests it takes; and its hooks for the shop's one assistant. What the runtime does for a parts shop: the clock's beat once per part, each its
// own step (so a part whose beat keeps failing does not hold back the others' beats); the owner's assistant hosting every part's skill (Assistant, assistantkit.go); the shared
// beat work (the licence notice, the morning line) said once for the shop (record.go SharedBeatOff).

import (
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

// PartsKit is a Kit made of several template parts (internal/parts). Parts is the parts' names in the shop's order (the first is the one that says the shop's shared beat work).
type PartsKit interface {
	Kit
	Parts() []string
}

// Claim is how sure a part is that a message is its own, by its rules alone. The router takes the highest; two parts at the same level above ClaimNew is a message the shop
// asks about rather than guesses (internal/parts router.go).
type Claim int

const (
	// ClaimNone: not this part's.
	ClaimNone Claim = iota
	// ClaimNew: a customer this part has never met, and this part is one that takes new customers (the pickup hold does; the credit book and Stock orders do not).
	ClaimNew
	// ClaimWords: this part's own reader read the words as its own (a name with "owes" for the credit book, an order of an item from a supplier for Stock orders), or the part
	// has an open conversation with the number (a question waiting for the owner's answer, a customer's account or hold).
	ClaimWords
	// ClaimOpen: a customer's words this part reads as about what is open with them (a credit customer's yes to the first question, "I paid" on an account).
	ClaimOpen
	// ClaimCommand: the part's own command word with the part's own case reference ("approve o-3", "receive po-4", a mark code in its own ledger, a tap on its own button).
	ClaimCommand
)

// PartAgent is a template's agent that can be one part of a shop of several parts. Every method reads only; none writes a record line or changes the state.
type PartAgent interface {
	Agent
	// ClaimOwner is how sure the part is that the owner's message is its own.
	ClaimOwner(msg messaging.InboundMessage) Claim
	// ClaimCustomer is how sure the part is that a message from anyone but the owner (a customer, a supplier) is its own.
	ClaimCustomer(msg messaging.InboundMessage) Claim
	// OwnsCase: a case reference ("o-3", "f-2", "po-4", "q-1", a card's case) is this part's.
	OwnsCase(ref string) bool
	// TakesChannel: a public page's request (`channel_request`'s op) is this part's.
	TakesChannel(op string) bool
	// AssistantHooks is the part's skill and ways out for the shop's one assistant; ok false when the part has no assistant (its settings have no "assistant" block).
	AssistantHooks() (h AssistantHooks, ok bool)
}

// SetCoParts hands a part's step context the other parts' assistant hooks (internal/parts), so the assistant this part makes hosts every part's skill. Each is called only
// when the assistant is made.
func (c *StepContext) SetCoParts(co []func() (AssistantHooks, bool)) { c.coParts = co }

// TickPart is the part whose beat this step is, in a shop of several parts ("" for every other step, and for every single-part shop).
func (c *StepContext) TickPart() string { return c.tickPart }

// tickParts runs the clock's beat of a shop of several parts: one step per part, in the shop's order, each saved on its own. A part's failed beat is said and the next part's
// beat still runs; the morning line and the licence notice ride on the first part's beat (record.go SharedBeatOff).
func (r *Runtime) tickParts(pk PartsKit) {
	for _, p := range pk.Parts() {
		r.tickPart = p
		err := r.step(nil, "")
		r.tickPart = ""
		if err != nil {
			r.fail("A tick of the "+p+" part failed", err)
		}
	}
}

// joinHooks is the hooks of the shop's one assistant when the step's part has co-parts: the step's part's own hooks, with each record line of a case written by the part that
// owns the case (so the line carries that part's name), and a number opted out when ANY part has it opted out (a STOP is never forgotten by the assistant of another part).
func joinHooks(own AssistantHooks, co []AssistantHooks) AssistantHooks {
	out := own
	if own.Log != nil {
		out.Log = func(caseID, phone, action, outcome string, inputs any, more messaging.LogMore) {
			for _, h := range co {
				if caseID != "" && h.Skill != nil && h.Skill.Owns(caseID) && h.Log != nil {
					h.Log(caseID, phone, action, outcome, inputs, more)
					return
				}
			}
			own.Log(caseID, phone, action, outcome, inputs, more)
		}
	}
	out.OptedOut = func(phone string) bool {
		if own.OptedOut != nil && own.OptedOut(phone) {
			return true
		}
		for _, h := range co {
			if h.OptedOut != nil && h.OptedOut(phone) {
				return true
			}
		}
		return false
	}
	return out
}
