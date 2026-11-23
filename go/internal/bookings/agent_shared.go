package bookings

// The parts of the Bookings agent that are the same for every template's agent, opened to another template (wave 3: Fees) so they are not written twice: one step's watch over
// its Guards (agent_watch.go, the twin of modules/runtime/guard-wait.ts watchStep, with core.ts step's decision after the agent returns) and the owner's route (agent_say.go
// ownerMsg, modules/push/push.ts pushMessaging: the owner's messages by WhatsApp, push or both). Nothing here changes what Bookings does: each is a thin door onto the code
// Bookings already runs. When the TypeScript templates are deleted these belong in a package of their own; go/internal/fees/Deferred.md says so.

import (
	"errors"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// Watch is one step's watch over its services.
type Watch struct{ w *watch }

// NewWatch is a step's watch: wait for a Guard that is down (a task's step, not its last try), or only observe (a tick, the last try). givenUp are the Guards given up on in this
// outage (the template's Kit keeps them between steps).
func NewWatch(wait bool, givenUp map[string]bool) *Watch { return &Watch{newWatch(wait, givenUp)} }

// Payments is the gateway with every call watched.
func (w *Watch) Payments(p payments.Payments) payments.Payments { return wPayments{w.w, p} }

// Messaging is WhatsApp with every call watched (the optional methods kept where the wrapped value has them).
func (w *Watch) Messaging(m messaging.Messaging) messaging.Messaging { return watchedMessaging(w.w, m) }

// Do runs one call of a service through the watch (method is guard-wait.ts's name for it: a read, a call found again on a rerun, or one-time), for a call that is not one of
// the Payments or Messaging methods (Orders' settlement read, 23 Nov 2026).
func (w *Watch) Do(service, method string, call func() error) error {
	return w.w.do(service, method, call)
}

// Decide is core.ts step's decision after the agent returned (agent_watch.go finish, for an agent that is not Bookings'): keep waiting (a *runtime.WaitingForGuard), end the task
// (a *runtime.EndTask with `taken`), give up quietly (giveUp names the service: the caller writes the owner's to-do line with tell false and the step is saved), or go on.
func (w *Watch) Decide(task string, lastTry bool, givenUp map[string]bool, thrown error, taken runtime.KitState) (err error, giveUp string) {
	x := w.w
	for s := range x.answered {
		delete(givenUp, s)
	}
	if x.stopped != "" {
		out := &runtime.WaitingForGuard{Service: x.stopped, Msg: x.stopErr.Error()}
		if g, ok := guard.AsGuard(x.stopErr); ok && g.Kind == guard.KindUnavailable && g.RetryAfterSeconds != nil {
			s := int(*g.RetryAfterSeconds)
			out.RetryAfterSeconds = &s
		}
		return out, ""
	}
	down := ""
	if task != "" {
		down = x.down
	}
	givenUpOn := down != "" && (lastTry || givenUp[down])
	if thrown != nil {
		if errors.Is(thrown, runtime.ErrUnported) {
			return thrown, ""
		}
		if down != "" && (givenUpOn || x.oneTime) {
			return &runtime.EndTask{Service: down, Tell: !x.oneTime, Taken: taken}, ""
		}
		return thrown, ""
	}
	if givenUpOn {
		givenUp[down] = true
		return nil, down
	}
	return nil, ""
}

// OwnerRoute is what the owner's route needs: the owner's number now, the clock, and the push to the owner's phones with their choice of route (Ports.PushOwner, OwnerRoute;
// nil: WhatsApp alone).
type OwnerRoute struct {
	Owner       func() string
	Now         func() int64
	PushOwner   func(text string) []string
	ChooseRoute func(hasWhatsApp bool) string
}

// OwnerMessaging is the shop's messaging with the owner's alerts by their choice (push.ts pushMessaging): base is the shop's WhatsApp (nil: none).
func OwnerMessaging(base messaging.Messaging, r OwnerRoute) messaging.Messaging {
	shim := &Agent{kit: &Kit{Ports: Ports{PushOwner: r.PushOwner, OwnerRoute: r.ChooseRoute}}, c: &runtime.StepContext{Owner: func() (string, string) { return r.Owner(), "" }, Now: r.Now}}
	return shim.ownerMessaging(base)
}
