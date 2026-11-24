package stockorders

// How a Stock orders shop's program wires its Kit (runtime.WiredKit): what go/cmd/stock-orders/main.go did inline until 25 Nov 2026, moved here unchanged so the shop of several
// template parts (decision 65, go/cmd/parts) wires a Stock orders part the same way. runtime.Serve calls PreCheck right after the folder is read, Wire before runtime.New and
// Started after it.
//
// What is wired: the settings, WhatsApp (the stand-in in fakes mode, made once so it keeps what it was told; the live client, also for the hand check's shop whose runtime.json
// says "standins": "http"), the monthly report (runtime.json `report`) and the owner's messages by WhatsApp, push or both.

import (
	"fmt"
	"os"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

var (
	_ runtime.WiredKit   = (*Kit)(nil)
	_ runtime.PreChecker = (*Kit)(nil)
)

// PreCheck: config.ts readRuntimeConfig with STOCK_SERVICES: a live shop's WhatsApp may not be left out (readService's sentence for a missing service).
func (k *Kit) PreCheck(client *runtime.Client) error {
	if _, has := client.Config.Services["messaging"].(map[string]any); client.Config.Mode == "live" && !has {
		return runtime.ClientError{Msg: "runtime.json needs fixing:\n- In \"services\", add \"messaging\" with its \"baseUrl\" and \"phoneNumberId\"."}
	}
	return nil
}

// Wire fills the Kit from the client folder before the runtime is made.
func (k *Kit) Wire(w runtime.Wiring) error {
	client, now, log := w.Client, w.Now, w.Log
	msgConf, _ := client.Config.Services["messaging"].(map[string]any)
	k.Settings, k.Now = w.Own.(*Settings), now
	// services.ts buildServices: the stand-in WhatsApp in fakes mode (made once, so it keeps what it was told while the process runs), the live client in live mode
	// the hand check's shop (runtime.json "standins": "http") takes the live client too, to the stand-in over HTTP (runtime/config.go)
	if !client.Config.UsesClients() {
		if _, has := client.Config.Services["messaging"]; client.Config.Services == nil || has {
			k.WhatsApp = messaging.NewStandIn(messaging.Clock(now), TemplateNames(), log)
		}
	} else {
		timeout := guard.DefaultTimeoutMs
		if t, ok := client.Config.Services["timeoutMs"].(float64); ok {
			timeout = int(t)
		}
		tok := ""
		if f, _ := msgConf["agentTokenFile"].(string); f != "" {
			b, err := os.ReadFile(f)
			if err != nil || strings.TrimSpace(string(b)) == "" {
				return runtime.ClientError{Msg: fmt.Sprintf("I could not read the agent credential file %s (services.*.agentTokenFile).", f)}
			}
			tok = strings.TrimSpace(string(b))
		}
		str := func(k string) string { s, _ := msgConf[k].(string); return s }
		opt := func(k string) *string {
			if s, ok := msgConf[k].(string); ok {
				return &s
			}
			return nil
		}
		c, err := messaging.NewLive(messaging.LiveConfig{BaseURL: str("baseUrl"), PhoneNumberID: str("phoneNumberId"), Provider: str("provider"), AppID: opt("appId"), AppName: opt("appName"),
			SourceNumber: opt("sourceNumber"), AgentToken: tok, TimeoutMs: timeout}, messaging.Deps{Clock: messaging.Clock(now), Window: w.Store})
		if err != nil {
			return runtime.ClientError{Msg: err.Error()}
		}
		k.WhatsApp = c
	}
	// the monthly report (report/monthly-job.ts) from runtime.json's `report` block; without it none is made
	if cfg, err := reportwire.ReadSetup(client.Config, client.Folder, log); err != nil {
		return err
	} else if cfg != nil {
		k.Report = NewMonthlyReport(*cfg, k.Settings, k.WhatsApp)
	}
	// item 11h: every message to the owner by the owner's choice of WhatsApp, push or both (push.ts pushMessaging); the runtime exists once runtime.New returns, and no step runs before then
	k.PushOwner = func(text string) []string { return w.RT().OwnerPush(text) }
	k.OwnerRoute = func(hasWhatsApp bool) string { return w.RT().OwnerRoute(hasWhatsApp) }
	return nil
}

// Started: Stock orders needs nothing more of the runtime.
func (k *Kit) Started(*runtime.Runtime) {}
