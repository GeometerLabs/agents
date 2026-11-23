package orders

// The services of one step, each call watched: the Go twin of modules/runtime/guard-wait.ts `watchStep` (and core.ts `step`'s decision after the agent returns, in finish below).
// The agent's own failure handling (a "sorry", a `.catch` beside a read) takes a Guard that is down for a provider that said no, so whether a step is kept is decided AFTER the
// agent returns, whatever it caught or swallowed:
//   - the first call that finds a Guard unreachable or not ready (guard.WaitsForGuard) stops the step; from there on no call leaves it (each answers NotSent), and the step is
//     thrown away whole (runtime.WaitingForGuard): the task stays pending and waits;
//   - a send, a refund, a held call or a write whose outcome is unknown makes the step one-time: it is not run again (runtime.EndTask after a failure, with the customer told only
//     when they heard nothing);
//   - on the last try (the wait is over) or for a Guard given up on in this outage, the step runs with waiting off and its own "could not confirm" path is kept, with the owner's
//     to-do line (GiveUp, tell false).
// The wrapper is a value handed to the agent rather than a hook in the HTTP client, so the in-memory stand-ins go through exactly the same decisions as the live clients, as in
// the TypeScript. Where it differs: the tick's memory of one-time calls (guard-wait.ts sendMemory) is not ported; a tick thrown away is rare (a Guard down in the middle of it)
// and Deferred.md says so. Copied from internal/bookings/agent_watch.go (a template may not import another), less the calendar Orders does not have.

import (
	"context"
	"errors"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// reads are guard-wait.ts READS (change nothing); foundAgain its FOUND_AGAIN (found again on a rerun by the case id), less the calendar's methods. Any other method is one-time.
var (
	reads      = map[string]bool{"fetchRequest": true, "listRequests": true, "fetchPayment": true, "listRefunds": true, "isWindowOpen": true, "getMessage": true, "ping": true}
	foundAgain = map[string]bool{"createRequest": true, "cancelRequest": true}
)

// watch is one step's watch (StepWatch).
type watch struct {
	wait     bool            // "wait" mode: a task's step, kept waiting when its Guard is down ("observe": a tick, or the last try)
	givenUp  map[string]bool // the Kit's: Guards given up on in this outage
	stopped  string          // the service that stopped this step ("" none)
	stopErr  error
	down     string // the first service found down in this step
	oneTime  bool
	answered map[string]bool
}

func newWatch(wait bool, givenUp map[string]bool) *watch {
	return &watch{wait: wait, givenUp: givenUp, answered: map[string]bool{}}
}

// do runs one call of a service through the watch.
func (w *watch) do(service, method string, call func() error) error {
	if w.stopped != "" {
		return &guard.NotSentError{Message: "Not tried: the " + w.stopped + " Guard could not be reached, so this step will be run again."}
	}
	err := call()
	if err == nil {
		w.answered[service] = true
		if !reads[method] && !foundAgain[method] {
			w.oneTime = true
		}
		return nil
	}
	if guard.WaitsForGuard(err) {
		if w.down == "" {
			w.down = service
		}
		if w.wait && !w.oneTime && !w.givenUp[service] && w.stopped == "" {
			w.stopped, w.stopErr = service, err
		}
		return err
	}
	if reads[method] {
		return err
	}
	// a held call is real at Guard, and a lost reply or a 5xx may have reached the provider: a rerun would ask or send it again
	if g, ok := guard.AsGuard(err); (ok && g.Kind == guard.KindHeld) || guard.MayHaveHappened(err) {
		w.oneTime = true
	} else if st, ok := guard.IsAPI(err); ok && st >= 500 {
		w.oneTime = true
	}
	return err
}

// finish is core.ts step's decision after the agent returned (thrown is what it returned): keep waiting, end the task, give up quietly, or go on and save.
func (a *Agent) finish(ev map[string]any, thrown error) error {
	w := a.watch
	for s := range w.answered {
		delete(a.kit.givenUp(), s)
	}
	if w.stopped != "" {
		msg := w.stopErr.Error()
		out := &runtime.WaitingForGuard{Service: w.stopped, Msg: msg}
		if g, ok := guard.AsGuard(w.stopErr); ok && g.Kind == guard.KindUnavailable && g.RetryAfterSeconds != nil {
			s := int(*g.RetryAfterSeconds)
			out.RetryAfterSeconds = &s
		}
		return out
	}
	isTask := a.c.Task != ""
	down := ""
	if isTask {
		down = w.down
	}
	givenUpOn := down != "" && (a.c.LastTry || a.kit.givenUp()[down])
	if thrown != nil {
		if errors.Is(thrown, runtime.ErrUnported) {
			return thrown
		}
		if down != "" && (givenUpOn || w.oneTime) {
			return &runtime.EndTask{Service: down, Tell: !w.oneTime, Taken: a.store}
		}
		return thrown
	}
	if givenUpOn {
		// the agent got through on its own "could not confirm" path; the customer has heard what they can. Only the owner's item is left to write, saved with the step
		if err := a.GiveUp(ev, down, false); err != nil {
			return err
		}
		a.kit.givenUp()[down] = true
	}
	return nil
}

// ---- the watched services -------------------------------------------------------------------------------------------------------------------------------------------

type wPayments struct {
	w *watch
	p payments.Payments
}

func (x wPayments) CreateRequest(ctx context.Context, r payments.NewPaymentRequest) (out payments.PaymentRequest, err error) {
	err = x.w.do("payments", "createRequest", func() error { out, err = x.p.CreateRequest(ctx, r); return err })
	return
}
func (x wPayments) FetchRequest(ctx context.Context, id string) (out *payments.PaymentRequest, err error) {
	err = x.w.do("payments", "fetchRequest", func() error { out, err = x.p.FetchRequest(ctx, id); return err })
	return
}
func (x wPayments) ListRequests(ctx context.Context, q payments.ListQuery) (out []payments.PaymentRequest, err error) {
	err = x.w.do("payments", "listRequests", func() error { out, err = x.p.ListRequests(ctx, q); return err })
	return
}
func (x wPayments) CancelRequest(ctx context.Context, id string) (out payments.PaymentRequest, err error) {
	err = x.w.do("payments", "cancelRequest", func() error { out, err = x.p.CancelRequest(ctx, id); return err })
	return
}
func (x wPayments) FetchPayment(ctx context.Context, id string) (out *payments.Payment, err error) {
	err = x.w.do("payments", "fetchPayment", func() error { out, err = x.p.FetchPayment(ctx, id); return err })
	return
}
func (x wPayments) Refund(ctx context.Context, paymentID string, r payments.RefundRequest) (out payments.Refund, err error) {
	err = x.w.do("payments", "refund", func() error { out, err = x.p.Refund(ctx, paymentID, r); return err })
	return
}
func (x wPayments) ResendRefund(ctx context.Context, paymentID, body string, requestedBy []string) (out payments.Refund, err error) {
	err = x.w.do("payments", "resendRefund", func() error { out, err = x.p.ResendRefund(ctx, paymentID, body, requestedBy); return err })
	return
}
func (x wPayments) ListRefunds(ctx context.Context, paymentID string) (out []payments.Refund, err error) {
	err = x.w.do("payments", "listRefunds", func() error { out, err = x.p.ListRefunds(ctx, paymentID); return err })
	return
}

// wMessaging is the shop's messaging (owner's route included), watched; it has buttons only when what it wraps has them (say.ts asks by a type assertion).
type wMessaging struct {
	w *watch
	m messaging.Messaging
}

func (x wMessaging) SendText(ctx context.Context, to, text string) (out messaging.OutboundMessage, err error) {
	err = x.w.do("messaging", "sendText", func() error { out, err = x.m.SendText(ctx, to, text); return err })
	return
}
func (x wMessaging) SendTemplate(ctx context.Context, to string, t messaging.TemplateMessage) (out messaging.OutboundMessage, err error) {
	err = x.w.do("messaging", "sendTemplate", func() error { out, err = x.m.SendTemplate(ctx, to, t); return err })
	return
}
func (x wMessaging) IsWindowOpen(ctx context.Context, to string) (out bool, err error) {
	err = x.w.do("messaging", "isWindowOpen", func() error { out, err = x.m.IsWindowOpen(ctx, to); return err })
	return
}
func (x wMessaging) GetMessage(ctx context.Context, id string) (out *messaging.OutboundMessage, err error) {
	err = x.w.do("messaging", "getMessage", func() error { out, err = x.m.GetMessage(ctx, id); return err })
	return
}

type wInteractive struct{ wMessaging }

func (x wInteractive) SendInteractive(ctx context.Context, to string, m messaging.InteractiveMessage) (out messaging.OutboundMessage, err error) {
	err = x.w.do("messaging", "sendInteractive", func() error { out, err = x.m.(messaging.Interactive).SendInteractive(ctx, to, m); return err })
	return
}

type wImages struct{ wInteractive }

func (x wImages) SendImage(ctx context.Context, to string, i messaging.ImageMessage) (out messaging.OutboundMessage, err error) {
	err = x.w.do("messaging", "sendImage", func() error { out, err = x.m.(messaging.Images).SendImage(ctx, to, i); return err })
	return
}

// watchedMessaging keeps the optional methods exactly where the wrapped value has them (sendInteractive, sendImage).
func watchedMessaging(w *watch, m messaging.Messaging) messaging.Messaging {
	if m == nil {
		return nil
	}
	base := wMessaging{w, m}
	_, inter := m.(messaging.Interactive)
	_, img := m.(messaging.Images)
	switch {
	case inter && img:
		return wImages{wInteractive{base}}
	case inter:
		return wInteractive{base}
	}
	return base
}
