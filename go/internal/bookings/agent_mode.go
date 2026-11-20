package bookings

// What the record and the owner are told about how the shop reads messages (modules/understanding/reader.ts announceButtonMode, announceSteps, announceModelOff), run after a
// customer has their answer and on the clock's beat:
//   - a decision model (step 1) that keeps failing is left out for a while, and back when it answers: one ai_mode line each, when it begins and when it ends; nobody is told,
//     because nothing anyone sees changes;
//   - the language model left out under fleet's cap or the shop's month budget: one line a month; nobody is told from here (fleet tells the Operator, the assistant the owner);
//   - button mode: one line and the owner told once (once a month for the allowance, once per switch for the outside switch, once a day for a failing model).

import (
	"fmt"
	"time"

	"github.com/GeometerLabs/agents/go/internal/budget"
)

// pauseMinutes is the shop's fault pause (runtime.json pauseMinutes, reader.ts DEFAULT_PAUSE_MINUTES when unset).
func (a *Agent) pauseMinutes() int64 { return a.c.Policy.PauseMinutes }

// announceButtonMode is reader.ts announceButtonMode.
func (a *Agent) announceButtonMode() {
	if a.c == nil || a.c.Snap == nil {
		return
	}
	ai, now := &a.c.Snap.AI, a.now()
	a.announceSteps(ai, now)
	a.announceModelOff(ai, now)
	state := budget.For(ai, a.c.Clock, now)
	buttons, reason := budget.Buttons(ai, a.c.Policy, a.c.Clock, now)
	if reason != "override" {
		state.Told.Override = false // modeOf: the outside switch is off, so its next turn is told again
	}
	if !buttons {
		return
	}
	today := a.c.Clock.Day(now)
	switch reason {
	case "allowance":
		if state.Told.Allowance == state.Month {
			return
		}
		state.Told.Allowance = state.Month
	case "override":
		if state.Told.Override {
			return
		}
		state.Told.Override = true
	default:
		if state.Told.Fault == today {
			return
		}
		state.Told.Fault = today
	}
	// `(costMicroInr / 1_000_000).toFixed(2)`
	spent := fmt.Sprintf("%d messages and about ₹%.2f so far this month (%s)", state.Decision+state.Model, float64(state.CostMicroInr)/1_000_000, state.Month)
	notes := fmt.Sprintf("A model step failed, so for %d minutes the agent reads with the rules only and answers with buttons and lists, then tries the AI again. Every limit still holds. The owner is told once a day.", a.pauseMinutes())
	switch reason {
	case "allowance":
		notes = "This shop's monthly AI allowance is used up (" + spent + "). The agent reads with the rules only and answers with buttons and lists until the month ends. Every limit still holds. The owner has been told once."
	case "override":
		notes = "The shop's config says ai: buttons (set from outside, for example when the plan or the Operator's balance has no AI left). The agent reads with the rules only and answers with buttons and lists until that is changed. Every limit still holds. The owner has been told once."
	}
	a.log(nil, a.owner(), "ai_mode", "confirmed", map[string]any{"reason": reason, "month": state.Month}, logMore{notes: notes, refs: map[string]string{"mode": "buttons", "reason": reason, "month": state.Month}})
	template := "owner_ai_fault"
	switch reason {
	case "allowance":
		template = "owner_ai_allowance"
	case "override":
		template = "owner_ai_off"
	}
	a.sayOwner([]string{template}, sayExtra{}, "")
}

// announceSteps is reader.ts announceSteps: the pauses and resumptions of a step, in the record once each.
func (a *Agent) announceSteps(ai **budget.AI, now int64) {
	month := budget.For(ai, a.c.Clock, now).Month
	b := budget.Breaker
	for _, e := range budget.TakeAnnouncements(ai, a.c.Clock, now) {
		if e.Event == "paused" {
			refs := map[string]string{"mode": "step_paused", "step": e.Step, "reason": "failures", "month": month}
			if e.UntilMs != nil {
				refs["until"] = time.UnixMilli(*e.UntilMs).UTC().Format("2006-01-02T15:04:05.000Z")
			}
			a.log(nil, a.owner(), "ai_mode", "confirmed", map[string]any{"step": e.Step, "event": "paused", "month": month}, logMore{refs: refs,
				notes: fmt.Sprintf("The decision model (step 1) failed %d times in %d minutes, so for %d minutes the agent skips it and the language model (step 2) reads each message at once. A message costs the language model's price, as it did while the decision model failed, but does not wait for it. Then one message tries the decision model again. Every limit still holds. No customer or owner is told.", b.Failures, b.WindowMinutes, b.PauseMinutes)})
			continue
		}
		a.log(nil, a.owner(), "ai_mode", "confirmed", map[string]any{"step": e.Step, "event": "resumed", "month": month}, logMore{refs: map[string]string{"mode": "step_resumed", "step": e.Step, "month": month},
			notes: "The decision model (step 1) answered again, so the agent asks it first again."})
	}
}

// announceModelOff is reader.ts announceModelOff: one line a month when the language model is first left out (fleet's cap, or the shop's own month budget).
func (a *Agent) announceModelOff(ai **budget.AI, now int64) {
	why := budget.ModelOff(ai, a.c.Policy, a.c.Clock, now)
	if why == "" {
		return
	}
	state := budget.For(ai, a.c.Clock, now)
	if state.Told.ModelOff == state.Month {
		return
	}
	state.Told.ModelOff = state.Month
	if why == "budget" {
		a.log(nil, a.owner(), "ai_mode", "confirmed", map[string]any{"reason": "budget", "month": state.Month}, logMore{refs: map[string]string{"mode": "model_off", "reason": "budget", "month": state.Month},
			notes: fmt.Sprintf("This shop has used its own model budget for the month (%s). The language model is left out until the 1st: the rules, the buttons and the decision model (step 1) keep answering, the owner's talk, customers' open questions and listing drafts use their fixed answers and the plain form. Every limit still holds. The owner is told once by the assistant; the Operator sees it in the panel.", state.Month)})
		return
	}
	a.log(nil, a.owner(), "ai_mode", "confirmed", map[string]any{"reason": "ai_cap", "month": state.Month}, logMore{refs: map[string]string{"mode": "model_off", "reason": "ai_cap", "month": state.Month},
		notes: fmt.Sprintf("This shop has used its AI allowance for the month (%s): its model spend reached the plan's cap, so the shop's config says model: off. The language model (step 2) is left out until fleet turns it back on, on the 1st. The rules and the decision model (step 1) keep answering; a message they cannot read gets the menu, as in button mode. Every limit still holds. Fleet tells the Operator; no customer or owner is told.", state.Month)})
}
