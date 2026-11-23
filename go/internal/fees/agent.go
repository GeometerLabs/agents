package fees

// The Fees agent over one step: the Go twin of templates/education/fees/src/agent.ts `createAgent`. Handle takes ONE event and Tick one beat of the clock; each changes the step's
// store and appends to its record in memory only, and the shared runtime saves the step whole or not at all. The services are the Kit's ports, each call watched (bookings.Watch,
// the twin of guard-wait.ts), so a Guard that is down keeps the task waiting instead of losing the parent's message.
//
// The agent is in several files, in agent.ts's order: saying things (agent_say.go), the payment record and the links (agent_money.go), the month's fees and reminders and the
// parent's private link (agent_month.go), the owner-marked UPI money (agent_marks.go), the parent's and the owner's page (agent_page.go), what a parent and the owner say
// (agent_talk.go). What a kind needs that is not ported answers runtime.Unported with the kind (Deferred.md lists them).

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/payments/upi"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// RecoveryEntry and GuardWaitEntry are unfinished/registry.ts RECOVERY_ENTRY and GUARD_WAIT_ENTRY.
const (
	RecoveryEntry  = "recovery"
	GuardWaitEntry = "guard_wait_over"
)

// The owner-marked ledger's record names (owner-marked/obligations.ts MARK_ACTIONS).
const (
	ActRequest    = "upi_request"
	ActClaim      = "upi_paid_claim"
	ActMarked     = "owner_marked_paid"
	ActClosed     = "upi_request_closed"
	ActRefundOwed = "upi_refund_owed"
	ActRefundDone = "upi_refund_marked_done"
	ActReminder   = "upi_refund_reminder"
)

const (
	minute = int64(60_000)
	hour   = 60 * minute
	day    = 24 * hour
	hourly = hour // the owner is told about the same parent at most this often
	// ConfirmationsPerFee is agent.ts CONFIRMATIONS_PER_FEE.
	ConfirmationsPerFee = 5
)

var errBadLedger = errors.New("The centre's UPI ledger (upi in the saved state) cannot be read by this version, so nothing is done until it is fixed or the TypeScript runtime runs the centre.")

// Decision is limits.ts Decision.
type Decision = messaging.Decision

// Agent is one step's agent.
type Agent struct {
	c        *runtime.StepContext
	kit      *Kit
	store    *Store
	settings *Settings
	ctx      context.Context
	watch    *bookings.Watch
	pay      payments.Payments
	can      payments.Capabilities
	// ownerConfirms: the module cannot confirm a payment by itself (UPI), so the owner's marks are its payment record; ownerRefunds: it cannot refund by itself.
	ownerConfirms, ownerRefunds bool
	marks                       *ownermarked.State
	badLedger                   bool
	msg                         messaging.Messaging
	say                         *messaging.Say
	refunds                     *payments.Refunds
	acct                        accounting.Accounting
	// madeThisStep are the parents' links made in this step (agent.ts madeThisStep): a parent with two students gets the same link in both reminders.
	madeThisStep map[string]string
	// asst is the shop's assistant of this step, made on first use (agent_assistant.go); stepErr is an error one of its acts met deep in the agent's own paths (a Guard found
	// down), handed back by the step after the assistant returns, so the step is thrown away whole as TypeScript's thrown error throws it away
	asst     *runtime.Assistant
	asstMade bool
	stepErr  error
}

func newAgent(k *Kit, c *runtime.StepContext) *Agent {
	st := c.State.(*Store)
	a := &Agent{c: c, kit: k, store: st, settings: settingsOf(c.Settings), ctx: context.Background(), can: k.Ports.Capabilities, madeThisStep: map[string]string{}}
	if st.StartedAtMs == nil {
		st.StartedAtMs = N(c.Now()) // agent.ts `store.startedAtMs ??= clock.now()`: the day this agent first ran, for every step
	}
	a.watch = bookings.NewWatch(c.Task != "" && !c.LastTry, k.givenUp())
	a.ownerConfirms, a.ownerRefunds = !a.can.ConfirmsAutomatically, !a.can.RefundsAutomatically
	if a.ownerConfirms || a.ownerRefunds {
		if a.marks = st.ledger(true); a.marks == nil {
			a.badLedger, a.marks = true, ownermarked.Empty()
		}
	}
	switch {
	case a.ownerConfirms:
		s := a.settings
		a.pay = ownermarked.View{State: a.marks, Now: a.now, Codes: assistant.NewCode, PayLink: func(amountPaise int64, note string) (string, error) {
			return upi.PayLink(upi.Request{Vpa: s.Payment.UpiID, Payee: s.Payment.Payee, AmountPaise: amountPaise, Note: note})
		}}
	case k.Ports.Payments != nil:
		a.pay = a.watch.Payments(k.Ports.Payments)
	}
	a.applyInForce()
	owner := bookings.OwnerMessaging(a.watch.Messaging(k.Ports.WhatsApp), bookings.OwnerRoute{Owner: a.owner, Now: a.now, PushOwner: k.Ports.PushOwner, ChooseRoute: k.Ports.OwnerRoute})
	// batch 3: a message to a number also goes to that parent's page as a web push (agent_push.go), and a page's kept message to the phones that allowed alerts on it (outbox.ts onKeep)
	a.msg = runtime.ChannelMessaging(alsoPushTo(owner, k.Ports.PushCustomer), st.chanState, a.now, k.Ports.PushCustomer)
	a.say = messaging.NewSay(a.sayDeps())
	a.refunds = payments.NewRefunds(a.refundDeps())
	return a
}

func (a *Agent) now() int64 { return a.c.Now() }

// applyInForce is runtime-limits.ts apply: a limit the owner tightened is in force for this step (a copy: the file's value is the base the changes are judged from). Called when
// the step starts, and again when the owner's tap on a limit card changed one inside the step (the assistant's InForce hook).
func (a *Agent) applyInForce() {
	if v, ok := a.c.InForce("refund_limit"); ok && v != a.settings.RefundLimitInr {
		cp := *a.settings
		cp.RefundLimitInr = v
		a.settings = &cp
	}
	if v, ok := a.c.InForce("waiver_limit"); ok && v != a.settings.WaiverLimitInr {
		cp := *a.settings
		cp.WaiverLimitInr = v
		a.settings = &cp
	}
}

// owner is the owner's number for this step.
func (a *Agent) owner() string {
	n, _ := a.c.Owner()
	return n
}

// languageOf is agent.ts languageOf: the fee's language, else the customer's, else the language the settings give this parent's students (the first of their students, in
// the settings' order, that names one), else the centre's first. The students' step is the 23 Nov 2026 fix of wave 3's TypeScript finding (a): a parent who had never written
// was answered in the centre's first language, not their student's.
func (a *Agent) languageOf(phone string, d *Due) string {
	if d != nil && d.Language != "" {
		return d.Language
	}
	if c := a.store.FindCustomer(phone); c != nil && c.Language != "" {
		return c.Language
	}
	for _, s := range a.settings.Students {
		if s.Parent == phone && s.Language != "" {
			return s.Language
		}
	}
	return a.settings.Languages[0]
}

type logMore struct {
	decisions []Decision
	notes     string
	refs      map[string]string
	language  string
}

// log is agent.ts log: one record line, its conversation the number it is about.
func (a *Agent) log(d *Due, phone, action, outcome string, inputs any, more ...logMore) {
	var m logMore
	if len(more) > 0 {
		m = more[0]
	}
	id := ""
	if d != nil {
		id = d.ID
	}
	lang := m.language
	if lang == "" {
		lang = a.languageOf(phone, d)
	}
	var ds []json.RawMessage
	for _, x := range m.decisions {
		raw, _ := json.Marshal(x)
		ds = append(ds, raw)
	}
	a.c.Rec.Append(runtime.NewLine{Conversation: phone, Booking: id, Action: action, Outcome: outcome, Inputs: inputs, Language: lang, Notes: m.notes, Refs: m.refs, Decisions: ds})
}

// confirmedRefs is RecordView.confirmedRefs: the ref `key` of every confirmed line of this fee and action.
func (a *Agent) confirmedRefs(due, action, key string) []string {
	var out []string
	for _, e := range a.c.Rec.Entries() {
		if e.Booking != nil && *e.Booking == due && e.Action == action && e.Outcome == "confirmed" {
			if v, ok := e.Refs[key]; ok {
				out = append(out, v)
			}
		}
	}
	return out
}

// Handle is agent.ts handle, then core.ts step's decision on what the watched services saw.
func (a *Agent) Handle(ev map[string]any) error {
	if a.badLedger {
		return errBadLedger
	}
	a.noteLicence()
	return a.finish(ev, a.handle(ev))
}

func (a *Agent) handle(ev map[string]any) error {
	kind, _ := ev["kind"].(string)
	switch kind {
	case "recovery":
		return a.onRecovery(ev)
	case "channel_request":
		op, _ := ev["op"].(string)
		if op == "fee_pay" || op == "fee_paid" {
			return a.onChannelFee(ev)
		}
		ch, _ := ev["channel"].(string)
		a.log(nil, a.owner(), "channel_fee", "blocked", map[string]any{"op": op}, logMore{refs: map[string]string{"channel": ch, "op": op}, notes: "a request this centre does not take (bookings and orders are other shops'): nothing was done"})
		return nil
	case "owner_action":
		return a.onOwnerAction(ev)
	case "owner_message":
		return a.onOwnerPageMessage(ev)
	case "chat_message":
		return a.onChatMessage(ev)
	case "owner_signin":
		return nil
	case "message":
		var m messaging.InboundMessage
		raw, _ := json.Marshal(ev["message"])
		if err := json.Unmarshal(raw, &m); err != nil {
			return err
		}
		return a.onMessage(m)
	case "payment_event":
		var e payments.PaymentEvent
		raw, _ := json.Marshal(ev["event"])
		if err := json.Unmarshal(raw, &e); err != nil {
			return err
		}
		return a.onPaymentEvent(e)
	case "approval_decision":
		approval, _ := ev["approval"].(string)
		decision, _ := ev["decision"].(string)
		return a.refunds.OnApprovalDecision(a.ctx, approval, decision)
	}
	return runtime.Unported("a " + kind + " event of a Fees centre")
}

// Tick is agent.ts onTick, under the same watch.
func (a *Agent) Tick() error {
	if a.badLedger {
		return errBadLedger
	}
	a.noteLicence()
	return a.finish(nil, a.onTick())
}

// finish is core.ts step's decision after the agent returned.
func (a *Agent) finish(ev map[string]any, thrown error) error {
	err, giveUp := a.watch.Decide(a.c.Task, a.c.LastTry, a.kit.givenUp(), thrown, a.store)
	if giveUp != "" {
		return a.GiveUp(ev, giveUp, false)
	}
	return err
}

// GiveUp is agent.ts giveUp: the wait for a Guard is over and this event's work is not done.
func (a *Agent) GiveUp(ev map[string]any, service string, tell bool) error {
	kind, _ := ev["kind"].(string)
	phone := a.owner()
	text := ""
	if kind == "message" {
		m, _ := ev["message"].(map[string]any)
		phone, _ = m["from"].(string)
		text, _ = m["text"].(string)
	}
	told := false
	if kind == "message" && tell {
		c := a.store.Customer(phone)
		if spoken := detectLanguage(text); c.Language == "" && spoken != "" && contains(a.settings.Languages, spoken) {
			c.Language = spoken
		}
		told = a.tellCustomer(nil, phone, []string{"fee_wait_over"}, sayOpts{})
	}
	what := "event"
	if kind == "message" {
		what = "message"
	}
	notes := "The " + service + " Guard could not be reached for as long as this " + what + " could wait, so its work was not done."
	if told {
		notes += " The customer was told to try again."
	}
	a.log(nil, phone, GuardWaitEntry, "failed", map[string]any{"event": kind, "service": service}, logMore{notes: notes, refs: map[string]string{"service": service, "event": kind}})
	return nil
}

// noteLicence is agent.ts noteLicence: one record line each time the licence restricts the centre, or stops restricting it.
func (a *Agent) noteLicence() {
	now := "active"
	switch a.c.Licence() {
	case "paused":
		now = "wind_down"
	case "stopped":
		now = "stopped"
	}
	was := "active"
	entries := a.c.Rec.Entries()
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].Action == "licence" {
			if s, ok := entries[i].Refs["state"]; ok {
				was = s
			}
			break
		}
	}
	if now == was {
		return
	}
	notes := "The centre's licence is in order again: fees are collected from now on. Nothing asked during the wind-down is done now; a parent who still wants it asks again."
	switch now {
	case "wind_down":
		notes = "The centre's licence is in its wind-down (the lease fleet signed, read on this server): no new fee link is made, no month's fees are opened and no late fee is added, and nothing is kept to do later. Payments from links sent earlier, receipts and refunds go on."
	case "stopped":
		notes = "The centre's licence has reached its final stop: open fee links are closed and nothing more is sent from here, except the owner's one notice. Payments already made are still recorded and refunds still go through. Nothing is deleted."
	}
	refs := map[string]string{"state": now}
	if pt := a.c.PaidThrough(); pt != nil {
		refs["paidThrough"] = itoa(*pt)
	}
	a.log(nil, a.owner(), "licence", "confirmed", map[string]any{"state": now}, logMore{refs: refs, notes: notes})
}

// takesNewWork is the licence's takesNewWork: not in the wind-down nor the final stop.
func (a *Agent) takesNewWork() bool { return a.c.Licence() == "" }
