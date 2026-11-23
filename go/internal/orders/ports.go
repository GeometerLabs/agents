package orders

// The services an Orders step calls, handed in once by cmd/orders: the Go twin of templates/commerce/orders/server/services.ts `buildServices` with the part of server/start.ts
// and server/runtime.ts between it and `createAgent`. Orders calls two services, payments and messaging; it has no calendar. Each field is typed with the SHARED package's own
// interface (go/internal/payments, messaging): an interface typed here would be a second copy of theirs (decision 61). The pattern is internal/bookings/ports.go's, less the
// calendar.
//
//	mode "fakes": the in-memory stand-ins (payments.NewFake, messaging.NewStandIn with every template the pathway can send approved), built ONCE at start, so they keep what
//	              they were told for as long as the process runs, as the TypeScript's do
//	mode "live":  the live clients, each pointing at the Guard runtime.json names (`services.<name>.baseUrl`), with this agent's credential for that Guard read from its
//	              `agentTokenFile` (never logged); `services.timeoutMs` for every call
//
// A nil field is "this shop has no such service": no `services.messaging` (or `services: {}` in fakes mode) is no WhatsApp; a UPI shop (`payment.module: upi`, whose module cannot
// confirm a payment by itself) has no payments Guard: its ledger is the store's own (`upi`, owner-marked), which needs no Guard because nothing in it calls out.

import (
	"fmt"
	"os"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/ordersreport"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/razorpay"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// Ports are the services of one shop.
type Ports struct {
	// Payments is the gateway behind its Guard, or the fake; nil: a UPI shop (the owner marks money by hand).
	Payments payments.Payments
	// Capabilities is what the payment module can do (Settings.Capabilities, providers capabilitiesOf).
	Capabilities payments.Capabilities
	// WhatsApp is the shop's WhatsApp behind its Guard, or the stand-in; nil: a shop with no WhatsApp (everything goes to the page and to push).
	WhatsApp messaging.Messaging
	// PushOwner pushes words to the owner's phones (push.ts `push.owner`); nil, or no ids: no phone has alerts on. OwnerRoute is the owner's choice of "whatsapp", "push",
	// "both" or "none" (push.ts ownerRoute).
	PushOwner  func(text string) []string
	OwnerRoute func(hasWhatsApp bool) string
	// PushCustomer is push.ts `customer` (24 Nov 2026): the words kept for a page's conversation also go to the phones that allowed alerts on that page (runtime.CustomerPush). nil:
	// no push. It never fails the message.
	PushCustomer func(conversation, text string)
	// FakePayments is the stand-in gateway in fakes mode (nil live): the runtime's test hooks pay a link through it, as the TypeScript's stand-in does.
	FakePayments *payments.Fake
}

// TemplateNames is every WhatsApp template an Orders shop can send (services.ts: TEMPLATE_NAMES' values, META_TEMPLATE_NAMES and REPORT_TEMPLATE_NAMES), for the stand-in to
// approve in every language. All three lists are generated from the TypeScript (internal/orders/words, internal/ordersreport).
func TemplateNames() []string {
	g := words.WordsFor("en").Generic
	names := []string{g.Customer, g.Owner}
	seen := map[string]bool{g.Customer: true, g.Owner: true}
	for _, t := range words.MetaTemplates("en") {
		if !seen[t.Name] {
			seen[t.Name] = true
			names = append(names, t.Name)
		}
	}
	return append(names, ordersreport.ReportTemplateNames()...)
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
	p := Ports{Capabilities: s.Capabilities()}
	gateway := p.Capabilities.ConfirmsAutomatically // a UPI shop's module cannot confirm a payment by itself: it has no gateway
	if cfg.Mode != "live" {
		if gateway {
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
	if m, ok := cfg.Services["payments"].(map[string]any); ok && gateway {
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
	if m, ok := cfg.Services["messaging"].(map[string]any); ok {
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
