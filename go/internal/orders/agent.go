package orders

// The Orders agent over one step: the Go twin of templates/commerce/orders/src/agent.ts `createAgent`. Handle takes ONE event (a customer's or the owner's message, a payment
// event, the approvals relay's answer, the panel's recovery, a page's request, the owner's page, a chat guest's send) and Tick one beat of the clock; each changes the step's store
// and appends to its record in memory only, and the shared runtime saves the step whole or not at all. The agent's services are the Kit's ports (ports.go), each call watched
// (agent_watch.go), so a Guard that is down keeps the task waiting instead of losing the customer's message.
//
// The agent is in several files, in the order of agent.ts's sections: saying things (agent_say.go), the order and its hold (agent_flow.go), money, refunds, the licence, the beat
// and recovery (agent_money.go), the owner-marked money (agent_marks.go), cancelling, the owner's answers and the balance (agent_owner.go), the page and the owner's page
// (agent_channel.go), the customer's talk (agent_talk.go), what rides on the beat after the step (agent_after.go). The limits are limits.go.
//
// Two parts are G3's of wave W4 and have a narrow seam here (agent_seams.go): the monthly plans (src/plans/flow.ts) and the shop's assistant (assistantForAgent). Until they are
// filled a shop without a `plans` block and without an `assistant` block runs exactly as the TypeScript's does; what a plans shop needs of the plans ends runtime.Unported.

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/reading"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// RecoveryEntry is unfinished/registry.ts RECOVERY_ENTRY; GuardWaitEntry is GUARD_WAIT_ENTRY.
const (
	RecoveryEntry  = "recovery"
	GuardWaitEntry = "guard_wait_over"
)

// errBadLedger: the saved `upi` member is not one this version can read; a step that went on would save the owner's marks as nothing.
var errBadLedger = errors.New("The shop's UPI ledger (upi in the saved state) cannot be read by this version, so nothing is done until it is fixed or the TypeScript runtime runs the shop.")

// Agent is one step's agent.
type Agent struct {
	c        *runtime.StepContext
	kit      *Kit
	store    *Store
	settings *Settings
	ctx      context.Context
	watch    *watch
	// pay is the gateway behind its Guard, watched; on a UPI shop the owner-marked ledger seen as payments (ownermarked.View, never watched: it is the store)
	pay payments.Payments
	// ownerConfirms: the module cannot confirm a payment by itself (UPI), so the owner's marks are its payment record; ownerRefunds: it cannot refund by itself, so the owner owes
	// every refund (agent.ts `ownerConfirms`, `ownerRefunds`, from the module's capabilities, never its name). marks is the ledger both use (nil when neither holds).
	ownerConfirms, ownerRefunds bool
	marks                       *ownermarked.State
	badLedger                   bool
	can                         payments.Capabilities
	msg                         messaging.Messaging
	say                         *messaging.Say
	refunds                     *payments.Refunds
	acct                        accounting.Accounting // the step's books, made on the first money line
	parse                       *reading.ParseContext // agent.ts parseContext
	// plans and asst are the two seams of G3 (agent_seams.go), made on first use; stepErr is an error one of the assistant's acts met deep in the agent's own paths (a Guard found
	// down), handed back by the step after the assistant returns, so the step is thrown away whole as TypeScript's thrown error throws it away
	plans     Plans
	plansMade bool
	asst      *runtime.Assistant
	stepErr   error
}

// newAgent is createAgent: the services of this step, watched, and the shared pieces built over them (say, refunds).
func newAgent(k *Kit, c *runtime.StepContext) *Agent {
	st := c.State.(*Store)
	a := &Agent{c: c, kit: k, store: st, settings: SettingsOf(c.Settings), ctx: context.Background(), can: k.Ports.Capabilities}
	a.watch = newWatch(c.Task != "" && !c.LastTry, k.givenUp())
	a.ownerConfirms, a.ownerRefunds = !a.can.ConfirmsAutomatically, !a.can.RefundsAutomatically
	if a.ownerConfirms || a.ownerRefunds {
		// agent.ts `store.upi ??= emptyMarkState()`: the ledger is the store's, so it is saved with the step
		if a.marks = st.Ledger(true); a.marks == nil {
			a.badLedger, a.marks = true, ownermarked.Empty()
		}
	}
	switch {
	case a.ownerConfirms:
		// agent.ts `markedPayments(markState, marked.payLink, clock)`: made inside the agent, so it is not watched (nothing in it can be down)
		a.pay = ownermarked.View{State: a.marks, PayLink: a.settings.UpiPayLink(), Now: a.now, Codes: assistant.NewCode}
	case k.Ports.Payments != nil:
		a.pay = wPayments{a.watch, k.Ports.Payments}
	}
	// runtime-limits.ts apply: a limit the owner tightened or changed is in force for this step, so the agent's own checks use it; a copy, so the file's value (the base the
	// changes are judged from, Kit.Limits) is never touched
	a.settings = a.inForce(a.settings)
	a.parse = parseContextOf(a.settings)
	a.msg = a.channelMessaging(watchedMessaging(a.watch, a.ownerMessaging(k.Ports.WhatsApp)))
	a.say = messaging.NewSay(a.sayDeps())
	a.refunds = payments.NewRefunds(a.refundDeps())
	return a
}

// inForce lays the limits in force over the settings (src/chat-limits.ts: the big-order line, the refund limit, the most orders in a day).
func (a *Agent) inForce(s *Settings) *Settings {
	cp := *s
	changed := false
	if v, ok := a.c.InForce("refund_limit"); ok && v != s.Refund.LimitInr {
		cp.Refund.LimitInr, changed = v, true
	}
	if v, ok := a.c.InForce("big_order_limit"); ok && v != s.Owner.ApproveOverInr {
		cp.Owner.ApproveOverInr, changed = v, true
	}
	if v, ok := a.c.InForce("orders_per_day"); ok && v != s.Orders.MaxPerDay {
		cp.Orders.MaxPerDay, changed = v, true
	}
	if !changed {
		return s
	}
	return &cp
}

// ReadingOf is the reader of this shop's customers' words (internal/orders/reading over its menu, slots and languages), for the router cmd/orders builds.
func ReadingOf(s *Settings) reading.Reading { return reading.Reading{C: parseContextOf(s)} }

// parseContextOf is agent.ts parseContext: the menu, every slot with its names and way, the languages.
func parseContextOf(s *Settings) *reading.ParseContext {
	c := &reading.ParseContext{Languages: s.Languages}
	for _, it := range s.Menu {
		c.Menu = append(c.Menu, reading.MenuItem{ID: it.ID, Names: it.Names})
	}
	for _, x := range s.AllSlots() {
		names := x.Slot.Names
		if names == nil {
			names = map[string][]string{}
		}
		c.Slots = append(c.Slots, reading.Slot{ID: x.Slot.ID, Names: names, Mode: x.Mode})
	}
	return c
}

func (a *Agent) now() int64 {
	if a.c == nil {
		return a.kit.now()
	}
	return a.c.Now()
}

// owner is the owner's number for this step (agent.ts `owner`, read at every step).
func (a *Agent) owner() string {
	n, _ := a.c.Owner()
	return n
}

// languageOf is agent.ts languageOf: the order's language, else the customer's, else the shop's first.
func (a *Agent) languageOf(phone string, o *Order) string {
	if o != nil && o.Language != "" {
		return o.Language
	}
	if c := a.store.FindCustomer(phone); c != nil && c.Language != "" {
		return c.Language
	}
	return a.settings.Languages[0]
}

// logMore is the rest of a record line (record.ts append's `more`).
type logMore struct {
	decisions []Decision
	notes     string
	refs      map[string]string
	language  string
}

// log is agent.ts log: one record line, its conversation the number it is about and its language that conversation's.
func (a *Agent) log(o *Order, phone, action, outcome string, inputs any, more ...logMore) {
	var m logMore
	if len(more) > 0 {
		m = more[0]
	}
	id := ""
	if o != nil {
		id = o.ID
	}
	lang := m.language
	if lang == "" {
		lang = a.languageOf(phone, o)
	}
	var ds []json.RawMessage
	for _, d := range m.decisions {
		b, _ := json.Marshal(d)
		ds = append(ds, b)
	}
	a.c.Rec.Append(runtime.NewLine{Conversation: phone, Booking: id, Action: action, Outcome: outcome, Inputs: inputs, Language: lang, Notes: m.notes, Refs: m.refs, Decisions: ds})
}

// Handle is agent.ts handle, then core.ts step's decision on what the watched services saw.
func (a *Agent) Handle(ev map[string]any) error {
	if a.badLedger {
		return errBadLedger
	}
	a.noteLicence()
	a.reconcileStock()
	return a.finish(ev, a.handle(ev))
}

func (a *Agent) handle(ev map[string]any) error {
	kind, _ := ev["kind"].(string)
	switch kind {
	case "recovery":
		return a.onRecovery(ev)
	case "channel_request":
		return a.onChannel(ev)
	case "owner_action":
		return a.onOwnerAction(ev)
	case "owner_message":
		return a.onOwnerPageMessage(ev)
	case "owner_signin":
		return nil // the runtime core's own (modules/channels/owner-signin.ts): never an agent's
	case "chat_message":
		return a.onChatMessage(ev)
	case "message":
		var m messaging.InboundMessage
		raw, _ := json.Marshal(ev["message"])
		if err := json.Unmarshal(raw, &m); err != nil {
			return err
		}
		return a.OnMessage(m)
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
	return runtime.Unported("a " + kind + " event of an Orders shop")
}

// Tick is agent.ts handle({kind: "tick"}), under the same watch (a tick is never kept waiting: it is thrown away whole when it fails, and the next beat starts again).
func (a *Agent) Tick() error {
	if a.badLedger {
		return errBadLedger
	}
	a.noteLicence()
	a.reconcileStock()
	return a.finish(nil, a.onTick())
}

// GiveUp is agent.ts giveUp (`wait_over`): the wait for a Guard is over and this event's work is not done. With tell, the customer also gets the shop's words for it, and the to-do
// line (unfinished/registry.ts guardWaitLine) says whether they were told. Nothing else is promised, because nothing else happens.
func (a *Agent) GiveUp(ev map[string]any, service string, tell bool) error {
	kind, _ := ev["kind"].(string)
	phone := a.owner()
	var text string
	if kind == "message" {
		m, _ := ev["message"].(map[string]any)
		phone, _ = m["from"].(string)
		text, _ = m["text"].(string)
	}
	told := false
	if kind == "message" && tell {
		// the step that would have noted a new customer's language was thrown away, so it is read again here from the message, by the rules alone (no model is asked)
		c := a.store.Customer(phone)
		if spoken := understanding.DetectLanguage(text); c.Language == "" && spoken != "" && contains(a.settings.Languages, spoken) {
			c.Language = spoken
		}
		told = a.tellCustomer(nil, phone, []string{"wait_over"}, sayOpts{})
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

// onChatMessage is agent.ts onChatMessage (W1): a guest's send on the shop's page is run as the SAME step as a WhatsApp customer's message, under the guest's own conversation;
// runtime.ChatTurn keeps the send, makes it once and caps it (modules/channels/chat.ts).
func (a *Agent) onChatMessage(ev map[string]any) error {
	_, err := runtime.ChatTurn(runtime.ChatTurnDeps{
		State: a.store.ChannelState(), Now: a.now(), Day: a.c.Clock.Day, Kind: "orders", Budget: a.c.Policy.Budget,
		ModelCalls: func() int64 {
			m := budget.For(&a.c.Snap.AI, a.c.Clock, a.now())
			return m.Decision + m.Model
		},
		SetLanguage: func(conversation, lang string) {
			if contains(a.settings.Languages, lang) {
				a.store.Customer(conversation).Language = lang
			}
		},
		Run: func(in runtime.ChatInbound) error { return a.onMessage(in.InboundMessage, in.Audio, in.OnHeard) },
	}, runtime.ChatMessageOf(ev))
	return err
}
