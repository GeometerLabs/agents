package orders

// The two seams the agent leaves for G3 of wave W4: the monthly plans (templates/commerce/orders/src/plans/flow.ts createPlans) and the shop's assistant (modules/assistant/wire.ts
// assistantForAgent with src/assistant.ts ordersSkill). The agent calls each at exactly agent.ts's places, so G3 only fills them:
//
//	plans:     onMessage (before the address and the reader: a message about a plan), onPaidClaim and onPaidReadBack (a period waiting for its payment), completeOrder (a period's
//	           payment recorded: plans.onPaid), onTick (after the orders: meals delivered, renewals asked, unpaid ones lapsed). The agent's own paths a plan is handed are
//	           askPlanPayment, refundPlanCredit, planApplied (agent_money.go), qrOf, reconcilePayments, cancelWaiting, log, tellCustomer, tellOwner and sayOpts.facts.
//	assistant: onOwnerMessage (what no fixed phrase is), onVoiceNote (the owner's voice note heard as words), onOwnerAction's card answers, onOwnerPageMessage (the talk box and its
//	           recordings), onTick (cards past their time). The customer's talk (agent_talk.go) and the morning line (AfterTick) are the runtime's, over the same settings block.
//
// A refund G3 builds goes through checkRefundLimit with a refundAsk: its paidInr is the payment in whole rupees and must be given (its zero is "₹0 was paid", which blocks every
// refund; -1 is "not given").
//
// Until they are filled: a shop without a `plans` block and without an `assistant` block runs exactly as the TypeScript's does. A plans shop's ordinary orders run; a plan's
// period payment recorded ends runtime.Unported (never confirmed as an ordinary order), and messages about a plan are read as ordinary words. An assistant shop runs as one without
// it (its owner's words get the fixed commands only).

import "github.com/GeometerLabs/agents/go/internal/runtime"

// Plans is what the agent asks of src/plans/flow.ts.
type Plans interface {
	// OnMessage is plans.onMessage: a message about a plan (subscribe, skip, pause, resume, cancel the plan), read from plain words before any model; true when it was the plans'.
	OnMessage(phone, text, lang string) (bool, error)
	// AwaitingOrderOf is plans.awaitingOrderOf: the period's payment waiting for this customer, or nil.
	AwaitingOrderOf(phone string) *Order
	// OnPaid is plans.onPaid: the payment record shows a period's payment, so its meals are owed.
	OnPaid(o *Order) error
	// OnTick is plans.onTick.
	OnTick() error
}

// newPlans makes the plans of one step for a shop with a `plans` block (G3 sets it, from its own file's init); nil: the plans are not in Go yet.
var newPlans func(a *Agent) Plans

// assistantFor makes the shop's assistant of one step over the Orders skill, for a shop with an `assistant` block (G3 sets it); nil: not in Go yet.
var assistantFor func(a *Agent) *runtime.Assistant

// plansOf is agent.ts `plans` (settings.plans ? createPlans(...) : undefined), made once a step.
func (a *Agent) plansOf() Plans {
	if !a.plansMade {
		a.plansMade = true
		if a.settings.Plans != nil && newPlans != nil {
			a.plans = newPlans(a)
		}
	}
	return a.plans
}

// assistantOf is agent.ts `assistant` (assistantForAgent: on only with an `assistant` block), made once a step.
func (a *Agent) assistantOf() *runtime.Assistant {
	if a.asst == nil && a.c != nil && a.settings.Assistant != nil && assistantFor != nil {
		a.asst = assistantFor(a)
	}
	return a.asst
}
