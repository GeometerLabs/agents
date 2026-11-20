package bookings

// The services a Bookings step calls, handed in once by cmd/bookings: the Go twin of templates/commerce/bookings/server/services.ts `buildServices` with the part of
// server/start.ts and server/runtime.ts that sits between it and `createAgent` (the owner's messages by WhatsApp, push or both; the shop's own booking list when there is no
// Google Calendar). Each field is typed with the SHARED package's own interface (go/internal/calendar, payments, messaging): an interface typed here would be a second copy of
// theirs ("no duplicates", decision 61).
//
//	mode "fakes": the in-memory stand-ins (calendar.NewFake, payments.NewFake, messaging.NewStandIn with every template the pathway can send approved), built ONCE at start, so
//	              they keep what they were told for as long as the process runs, exactly as the TypeScript's do (they forget it all when the process stops)
//	mode "live":  the live clients, each pointing at the Guard runtime.json names (`services.<name>.baseUrl`), with this agent's credential for that Guard read from its
//	              `agentTokenFile` (never logged); `services.timeoutMs` for every call
//
// A nil field is "this shop has no such service": no `services.messaging` (or `services: {}` in fakes mode) is no WhatsApp; no `services.calendar` (or `calendar.module: own`) is the
// shop's own booking list, which lives IN the store and so is made per step over it (calendar.NewOwn, agent.go); a UPI shop (`payment.module: upi`) has no payments Guard.

import (
	"github.com/GeometerLabs/agents/go/internal/accounting"
	"fmt"
	"os"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/calendar"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/razorpay"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// Ports are the services of one shop.
type Ports struct {
	// Calendar is Google Calendar behind its Guard, or the fake; nil: the shop's own booking list (calendar.module "own", or live with no services.calendar).
	Calendar calendar.Calendar
	// Payments is the gateway behind its Guard, or the fake; nil: a UPI shop (the owner marks money by hand).
	Payments payments.Payments
	// Capabilities is what the payment module can do (modules/payments/providers capabilitiesOf).
	Capabilities payments.Capabilities
	// WhatsApp is the shop's WhatsApp behind its Guard, or the stand-in; nil: a shop with no WhatsApp (everything goes to the page and to push).
	WhatsApp messaging.Messaging
	// PushOwner pushes words to the owner's phones (modules/push/push.ts `push.owner`); nil, or no ids: no phone has alerts on. OwnerRoute is the owner's choice of
	// "whatsapp", "push" or "both" (push.ts ownerRoute).
	PushOwner  func(text string) []string
	OwnerRoute func(hasWhatsApp bool) string
	// Books are the shop's books (books.go NewBooks): every money line is posted through the step's accounting over the record (accounting.ts bookingsAccounting). nil: the line
	// is written with no money fields.
	Books *Books
	// FakePayments is the stand-in gateway in fakes mode (nil live): the runtime's test hooks pay a link through it, as the TypeScript's stand-in does.
	FakePayments *payments.Fake
}

// BookEvent is accounting's MoneyEvent as the Bookings agent posts it (accounting.ts bookingsAccounting): received (a deposit or an extra payment), applied (a done booking's
// deposit), kept (a late cancellation's deposit the owner kept), and the refund events the refunds code posts (refund_owed, refund_made, refund_cancelled).
type BookEvent struct {
	Kind        string
	Case        string
	PaymentID   string
	AmountPaise int64
	Method      string // received, refund_made: "gateway"
	Evidence    string // received, refund_made: "provider" or "person_word"
	For         string // received: "advance" or "extra"
	Service     string // applied: the booking's service ("bookings" when it has none)
	Why         string // kept: "late_cancellation"; refund_cancelled: owner_said_no, expired, refused, failed
	Owed        string // the refund events: "<case>:<payment id>"
	RefundID    string
}

// money is the event as internal/accounting takes it.
func (e BookEvent) money() accounting.MoneyEvent {
	m := accounting.MoneyEvent{Kind: accounting.MoneyKind(e.Kind), PaymentID: e.PaymentID, AmountPaise: e.AmountPaise, Method: accounting.Method(e.Method), Evidence: accounting.Evidence(e.Evidence),
		For: accounting.ReceivedFor(e.For), Service: e.Service, Why: e.Why}
	if e.Case != "" {
		m.Case = &e.Case
	}
	if e.Owed != "" {
		m.Owed = &e.Owed
	}
	if e.RefundID != "" {
		m.RefundID = &e.RefundID
	}
	return m
}

// refundBooks is the step's books as the refunds code needs them (payments.Accounting).
type refundBooks struct{ a *Agent }

func (r refundBooks) Post(e payments.MoneyEvent, write func(map[string]string)) {
	r.a.post(BookEvent{Kind: e.Kind, Case: e.Case, PaymentID: e.PaymentID, AmountPaise: e.AmountPaise, Method: e.Method, Evidence: e.Evidence, Why: e.Why, Owed: e.Owed, RefundID: e.RefundID}, write)
}

// TemplateNames is every WhatsApp template a Bookings shop can send (services.ts: TEMPLATE_NAMES' values, META_TEMPLATE_NAMES and REPORT_TEMPLATE_NAMES), for the stand-in to
// approve in every language. All three lists are generated from the TypeScript (words/<lang>.json.gz, bookingsreport).
func TemplateNames() []string {
	g := WordsFor("en").Generic
	names := []string{g.Customer, g.Reminder, g.Owner}
	seen := map[string]bool{}
	for _, t := range MetaTemplates("en") {
		if !seen[t.Name] {
			seen[t.Name] = true
			names = append(names, t.Name)
		}
	}
	return append(names, bookingsreport.ReportTemplateNames()...)
}

// serviceConf is one `services.<name>` block of runtime.json, as read.
func serviceConf(services map[string]any, name string) (map[string]any, bool) {
	m, ok := services[name].(map[string]any)
	return m, ok
}

func strOf(m map[string]any, k string) string { s, _ := m[k].(string); return s }

func optStr(m map[string]any, k string) *string {
	if s, ok := m[k].(string); ok {
		return &s
	}
	return nil
}

// agentToken is services.ts readAgentTokens for one service: the credential in its agentTokenFile, trimmed; "" when none is named. An unreadable or empty file stops the start.
func agentToken(m map[string]any) (string, error) {
	file := strOf(m, "agentTokenFile")
	if file == "" {
		return "", nil
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return "", runtime.ClientError{Msg: fmt.Sprintf("I could not read the agent credential file %s (services.*.agentTokenFile).", file)}
	}
	t := strings.TrimSpace(string(b))
	if t == "" {
		return "", runtime.ClientError{Msg: fmt.Sprintf("The agent credential file %s is empty.", file)}
	}
	return t, nil
}

// PortsOptions is what BuildPorts needs beside the folder: the clock, the runtime's window store (when each customer last wrote) and where the stand-in WhatsApp says what it sends.
type PortsOptions struct {
	Now    func() int64
	Window messaging.WindowStore
	Say    func(line string)
}

// BuildPorts is services.ts buildServices with start.ts's choices: which services this shop has, live or stand-in, by runtime.json's mode.
func BuildPorts(cfg runtime.Config, s *Settings, o PortsOptions) (Ports, error) {
	var p Ports
	own := s.Calendar == "own"
	upi := s.OwnerMarked()
	p.Capabilities = razorpay.Capabilities
	if upi {
		// owner-marked (modules/payments/providers/upi): the owner confirms and refunds by hand; nothing is cancelled at a gateway
		p.Capabilities = payments.Capabilities{}
	}
	if cfg.Mode != "live" {
		if !own {
			p.Calendar = calendar.NewFake()
		}
		if !upi {
			p.FakePayments = payments.NewFake(o.Now)
			p.Payments = p.FakePayments
		}
		// `services` naming no messaging means "no WhatsApp" (config.ts runtimeHasWhatsApp); leaving `services` out keeps the stand-in WhatsApp
		if _, has := cfg.Services["messaging"]; cfg.Services == nil || has {
			p.WhatsApp = messaging.NewStandIn(messaging.Clock(o.Now), TemplateNames(), o.Say)
		}
		return p, nil
	}
	timeout := guard.DefaultTimeoutMs
	if t, ok := cfg.Services["timeoutMs"].(float64); ok {
		timeout = int(t)
	}
	if m, ok := serviceConf(cfg.Services, "payments"); ok && !upi {
		tok, err := agentToken(m)
		if err != nil {
			return p, err
		}
		c, err := razorpay.New(razorpay.Config{BaseURL: strOf(m, "baseUrl"), TimeoutMs: timeout, AgentToken: tok})
		if err != nil {
			return p, runtime.ClientError{Msg: err.Error()}
		}
		p.Payments = c
	}
	// never a stand-in in live mode: no calendar service means the shop's own booking list, which is saved
	if m, ok := serviceConf(cfg.Services, "calendar"); ok && !own {
		tok, err := agentToken(m)
		if err != nil {
			return p, err
		}
		c, err := calendar.New(calendar.Config{BaseURL: strOf(m, "baseUrl"), CalendarID: strOf(m, "calendarId"), TimeoutMs: timeout, AgentToken: tok})
		if err != nil {
			return p, runtime.ClientError{Msg: err.Error()}
		}
		p.Calendar = c
	}
	if m, ok := serviceConf(cfg.Services, "messaging"); ok {
		tok, err := agentToken(m)
		if err != nil {
			return p, err
		}
		c, err := messaging.NewLive(messaging.LiveConfig{BaseURL: strOf(m, "baseUrl"), PhoneNumberID: strOf(m, "phoneNumberId"), Provider: strOf(m, "provider"), AppID: optStr(m, "appId"),
			AppName: optStr(m, "appName"), SourceNumber: optStr(m, "sourceNumber"), AgentToken: tok, TimeoutMs: timeout}, messaging.Deps{Clock: messaging.Clock(o.Now), Window: o.Window})
		if err != nil {
			return p, runtime.ClientError{Msg: err.Error()}
		}
		p.WhatsApp = c
	}
	return p, nil
}
