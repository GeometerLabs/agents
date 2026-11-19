package bookings

// The Bookings agent over one step: the Go twin of templates/commerce/bookings/src/agent.ts `createAgent`. Handle takes ONE event of the template's own kinds and Tick one beat of
// the clock; each changes the step's store and appends to its record in memory only, and the shared runtime saves the step whole or not at all.
//
// What a kind needs that is not ported yet answers runtime.Unported with the kind, so its task ends failed at once with that sentence (never a silent "done"): see go/TRIAL.md and
// Deferred.md for the list.

import (
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// RecoveryEntry is unfinished/registry.ts RECOVERY_ENTRY; GuardWaitEntry is GUARD_WAIT_ENTRY.
const (
	RecoveryEntry  = "recovery"
	GuardWaitEntry = "guard_wait_over"
)

var receiptBooking = regexp.MustCompile(`^(b-\d+):`)

// Agent is one step's agent.
type Agent struct {
	c        *runtime.StepContext
	store    *Store
	settings *Settings
	ports    Ports
}

// languageOf is agent.ts languageOf: the booking's language, else the customer's, else the shop's first.
func (a *Agent) languageOf(phone string, b *Booking) string {
	if b != nil && b.Language != "" {
		return b.Language
	}
	if c := a.store.FindCustomer(phone); c != nil && c.Language != "" {
		return c.Language
	}
	return a.settings.Languages[0]
}

// owner is the owner's number for this step (agent.ts `owner`, read at every step).
func (a *Agent) owner() string {
	n, _ := a.c.Owner()
	return n
}

// log is agent.ts log: one record line, its conversation the number it is about and its language that conversation's.
func (a *Agent) log(b *Booking, phone, action, outcome string, inputs any, notes string, refs map[string]string) {
	id := ""
	if b != nil {
		id = b.ID
	}
	a.c.Rec.Append(runtime.NewLine{Conversation: phone, Booking: id, Action: action, Outcome: outcome, Inputs: inputs, Language: a.languageOf(phone, b), Notes: notes, Refs: refs})
}

// Handle is agent.ts handle.
func (a *Agent) Handle(ev map[string]any) error {
	kind, _ := ev["kind"].(string)
	switch kind {
	case "recovery":
		return a.onRecovery(ev)
	}
	return runtime.Unported("a " + kind + " event of a Bookings shop")
}

// Tick is agent.ts onTick. The holds' expiry, reminders and completion come with the booking domain (slice 3).
func (a *Agent) Tick() error { return nil }

// GiveUp is agent.ts giveUp without the customer's words (they come with messaging): the to-do line (unfinished/registry.ts guardWaitLine).
func (a *Agent) GiveUp(ev map[string]any, service string, tell bool) error {
	phone := a.owner()
	if kind, _ := ev["kind"].(string); kind == "message" {
		m, _ := ev["message"].(map[string]any)
		phone, _ = m["from"].(string)
	}
	kind, _ := ev["kind"].(string)
	// unfinished/registry.ts guardWaitLine, word for word; the customer is not told here yet (that is a message, and messaging is a port not wired)
	what := "event"
	if kind == "message" {
		what = "message"
	}
	a.log(nil, phone, GuardWaitEntry, "failed", map[string]any{"event": kind, "service": service},
		"The "+service+" Guard could not be reached for as long as this "+what+" could wait, so its work was not done.",
		map[string]string{"service": service, "event": kind})
	return nil
}

// onRecovery is agent.ts onRecovery: the panel's to-do list asks to look again or ask again about one booking. It carries no authority: the agent does it the way it does the same
// thing every day. A booking that is not there, or an action that does not fit it, is refused in the record.
func (a *Agent) onRecovery(ev map[string]any) error {
	id, _ := ev["id"].(string)
	cs, _ := ev["case"].(string)
	action, _ := ev["action"].(string)
	b := a.store.Booking(cs)
	refs := map[string]string{"action": action, "recovery": id}
	say := func(outcome, notes string) {
		a.log(b, a.owner(), RecoveryEntry, outcome, map[string]any{"action": action, "case": cs}, notes, refs)
	}
	if b == nil {
		say("blocked", "no booking has this id, so nothing was done")
		return nil
	}
	switch action {
	case "recheck_payment":
		if b.LinkID == "" {
			say("blocked", "this booking has no payment link to look at")
			return nil
		}
		return runtime.Unported("recheck_payment (it reads the payments service)")
	case "retry_booking":
		if b.DepositPaymentID == "" || (b.State != NeedsOwner && b.State != AwaitingDeposit) {
			say("blocked", "this booking has no deposit waiting on the calendar, so there is nothing to confirm again")
			return nil
		}
		return runtime.Unported("retry_booking (it reads the calendar)")
	case "ask_owner_again":
		if a.settings.OwnerMarked() {
			return runtime.Unported("ask_owner_again on a UPI shop (the owner's marks)")
		}
		asked := false
		for _, p := range b.Pending {
			if p.Kind == "calendar" || p.Kind == "refund" {
				asked = true
			}
		}
		if !asked {
			say("blocked", "nothing the agent asked the owner is waiting (a refund Guard holds is asked by the approvals relay)")
			return nil
		}
		return runtime.Unported("ask_owner_again (it messages the owner)")
	case "recheck_refund":
		open := false
		for _, i := range b.RefundIssues {
			if contains([]string{"unknown", "uncertain", "unconfirmed", "failed"}, i.Kind) {
				open = true
			}
		}
		if !open {
			say("blocked", "no refund here is waiting on an unclear outcome")
			return nil
		}
		return runtime.Unported("recheck_refund (it reads the payments service)")
	}
	say("blocked", `the agent has no recovery called "`+action+`"`)
	return nil
}
