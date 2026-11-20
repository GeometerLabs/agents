package bookings

// The Bookings agent over one step: the Go twin of templates/commerce/bookings/src/agent.ts `createAgent`. Handle takes ONE event of the template's own kinds and Tick one beat of
// the clock; each changes the step's store and appends to its record in memory only, and the shared runtime saves the step whole or not at all. The agent's services are the
// Kit's ports (ports.go), each call watched (agent_watch.go), so a Guard that is down keeps the task waiting instead of losing the customer's message.
//
// The agent is in several files, in the order of agent.ts's sections: saying things (agent_say.go), what to offer and the calendar (agent_offer.go), payments, refunds, deposits,
// the beat and recovery (agent_money.go), the booking flow, cancelling, rescheduling, the owner's answers, STOP and a voice note (agent_flow.go), the booking page's channel kit
// (agent_channel.go). What a kind needs that is not ported yet answers runtime.Unported with the kind, so its task ends failed at once with that sentence (never a silent
// "done"): see go/TRIAL.md and Deferred.md for the list.

import (
	"context"
	"encoding/json"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/calendar"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
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
	kit      *Kit
	store    *Store
	settings *Settings
	ctx      context.Context
	watch    *watch
	cal      calendar.Calendar
	ownList  bool
	pay      payments.Payments // nil: a UPI shop (the owner's marks are its payment record; not ported yet)
	msg      messaging.Messaging
	say      *messaging.Say
	refunds  *payments.Refunds
	can      payments.Capabilities
	acct     accounting.Accounting // the step's books, made on the first money line
}

// newAgent is createAgent: the services of this step, watched, and the shared pieces built over them (say, refunds).
func newAgent(k *Kit, c *runtime.StepContext) *Agent {
	st := c.State.(*Store)
	a := &Agent{c: c, kit: k, store: st, settings: settingsOf(c.Settings), ctx: context.Background(), can: k.Ports.Capabilities}
	a.watch = newWatch(c.Task != "" && !c.LastTry, k.givenUp())
	if k.Ports.Calendar != nil {
		a.cal = wCalendar{a.watch, k.Ports.Calendar}
	} else {
		// B72: the shop's own booking list lives in the store, so it is saved with the step (src/adapters/own-calendar.ts); it never reaches a Guard
		a.ownList = a.settings.Calendar == "own"
		a.cal = ownCal{st, c.Now}
	}
	if k.Ports.Payments != nil {
		a.pay = wPayments{a.watch, k.Ports.Payments}
	}
	a.msg = a.channelMessaging(watchedMessaging(a.watch, a.ownerMessaging(k.Ports.WhatsApp)))
	a.say = messaging.NewSay(a.sayDeps())
	a.refunds = payments.NewRefunds(a.refundDeps())
	return a
}

func (a *Agent) now() int64 {
	if a.c == nil {
		return a.kit.now() // a channel's read (readAgent)
	}
	return a.c.Now()
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

// logMore is the rest of a record line (record.ts append's `more`).
type logMore struct {
	decisions []Decision
	notes     string
	refs      map[string]string
	language  string
}

// log is agent.ts log: one record line, its conversation the number it is about and its language that conversation's.
func (a *Agent) log(b *Booking, phone, action, outcome string, inputs any, more ...logMore) {
	var m logMore
	if len(more) > 0 {
		m = more[0]
	}
	id := ""
	if b != nil {
		id = b.ID
	}
	lang := m.language
	if lang == "" {
		lang = a.languageOf(phone, b)
	}
	var ds []json.RawMessage
	for _, d := range m.decisions {
		ds = append(ds, d.JSON())
	}
	a.c.Rec.Append(runtime.NewLine{Conversation: phone, Booking: id, Action: action, Outcome: outcome, Inputs: inputs, Language: lang, Notes: m.notes, Refs: m.refs, Decisions: ds})
}

// Handle is agent.ts handle, then core.ts step's decision on what the watched services saw.
func (a *Agent) Handle(ev map[string]any) error {
	a.noteLicence()
	return a.finish(ev, a.handle(ev))
}

func (a *Agent) handle(ev map[string]any) error {
	kind, _ := ev["kind"].(string)
	switch kind {
	case "recovery":
		return a.onRecovery(ev)
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
		if a.pay == nil {
			return runtime.Unported("an approval decision on a UPI shop (the owner's marks)")
		}
		return a.refunds.OnApprovalDecision(a.ctx, approval, decision)
	case "channel_request":
		return a.onChannel(ev)
	case "chat_message":
		return a.onChatMessage(ev)
	}
	return runtime.Unported("a " + kind + " event of a Bookings shop")
}

// Tick is agent.ts onTick, under the same watch (a tick is never kept waiting: it is thrown away whole when it fails, and the next beat starts again).
func (a *Agent) Tick() error {
	a.noteLicence()
	return a.finish(nil, a.onTick())
}

// GiveUp is agent.ts giveUp: the wait for a Guard is over and this event's work is not done. With tell, the customer also gets the shop's words for it ("wait_over"), and the to-do
// line (unfinished/registry.ts guardWaitLine) says whether they were told.
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
		if spoken := detectLanguage(text); c.Language == "" && spoken != "" && contains(a.settings.Languages, spoken) {
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
	cs := a.store.chanState()
	now := a.now()
	_, err := runtime.ChatTurn(runtime.ChatTurnDeps{
		State: cs, Now: now, Day: a.c.Clock.Day, Kind: "bookings", Budget: a.c.Policy.Budget,
		ModelCalls: func() int64 {
			m := budget.For(&a.c.Snap.AI, a.c.Clock, a.now())
			return m.Decision + m.Model
		},
		SetLanguage: func(conversation, lang string) {
			if contains(a.settings.Languages, lang) {
				a.store.Customer(conversation).Language = lang
			}
		},
		Run: func(in runtime.ChatInbound) error { return a.OnMessage(in.InboundMessage) },
	}, runtime.ChatMessageOf(ev))
	return err
}
