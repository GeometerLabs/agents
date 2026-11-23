// stock-orders runs ONE Stock orders shop: the Go twin of templates/commerce/stock-orders/server/main.ts (decision 61, wave 2). The shared runtime (internal/runtime) with the
// Stock orders template (internal/stockorders).
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key stock-orders --client <folder>
//	stock-orders health <url>      one GET of the address (the container's health check); exit 0 on a 200, else 1
//
// The folder, the token files, the environment and the test clock are the TypeScript runtime's (and cmd/bookings'), so a shop's folder starts on either runtime. A "live" shop
// refuses the test clock, and a live shop must name its WhatsApp Guard (config.ts STOCK_SERVICES: the order goes to a supplier on it). Press Ctrl+C (or send SIGTERM) to stop.
package main

import (
	"errors"
	"fmt"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/health"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stockorders"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/testclock"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

func main() {
	args := os.Args[1:]
	if len(args) == 2 && args[0] == "health" {
		os.Exit(health.Check(args[1], func(line string) { fmt.Fprintln(os.Stderr, line) }))
	}
	for _, a := range args {
		if a == "--help" || a == "-h" {
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> stock-orders --client <folder>")
			return
		}
	}
	if len(args) != 2 || args[0] != "--client" || strings.HasPrefix(args[1], "--") {
		fmt.Fprintln(os.Stderr, "Say which client to run: --client <folder>")
		os.Exit(2)
	}
	if err := run(args[1]); err != nil {
		var ce runtime.ClientError
		if errors.As(err, &ce) {
			fmt.Fprintln(os.Stderr, ce.Error())
		} else {
			fmt.Fprintln(os.Stderr, "The agent could not start: "+err.Error())
		}
		os.Exit(1)
	}
}

func run(folder string) error {
	log := func(line string) { fmt.Println(line) }
	kit := &stockorders.Kit{}
	client, err := runtime.LoadClientKit(folder, kit)
	if err != nil {
		return err
	}
	msgConf, hasMessaging := client.Config.Services["messaging"].(map[string]any)
	if client.Config.Mode == "live" && !hasMessaging {
		// config.ts readRuntimeConfig with STOCK_SERVICES: WhatsApp may not be left out (readService's sentence for a missing service)
		return runtime.ClientError{Msg: "runtime.json needs fixing:\n- In \"services\", add \"messaging\" with its \"baseUrl\" and \"phoneNumberId\"."}
	}
	token, err := runtime.ReadToken(os.Getenv("INTERNAL_TOKEN_FILE"), "internal token")
	if err != nil {
		return err
	}
	channelToken := ""
	if f := os.Getenv("CHANNEL_TOKEN_FILE"); f != "" {
		if t, err := runtime.ReadToken(f, "channel token"); err == nil {
			channelToken = t
		} else {
			log("No usable channel token in " + f + " (CHANNEL_TOKEN_FILE): this shop's owner's page is off until the next deploy makes one.")
		}
	}
	key, err := runtime.RecordKey(client.Config.Mode, os.Getenv("RECORD_KEY_FILE"))
	if err != nil {
		return err
	}
	st, err := store.Open(client.Config.DataDir)
	if err != nil {
		return err
	}
	defer st.Close()
	now := func() int64 { return time.Now().UnixMilli() }
	if test, err := testclock.FromEnv(os.Getenv, client.Config.Mode); err != nil {
		return runtime.ClientError{Msg: err.Error()}
	} else if test != nil {
		now = test
	}
	if _, err := runtime.LoadShopKey(st, client.Config.DataDir, now(), log); err != nil {
		return err
	}
	kit.Settings, kit.Now = client.Settings.Own.(*stockorders.Settings), now
	// services.ts buildServices: the stand-in WhatsApp in fakes mode (made once, so it keeps what it was told while the process runs), the live client in live mode
	if client.Config.Mode != "live" {
		if _, has := client.Config.Services["messaging"]; client.Config.Services == nil || has {
			kit.WhatsApp = messaging.NewStandIn(messaging.Clock(now), stockorders.TemplateNames(), log)
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
			SourceNumber: opt("sourceNumber"), AgentToken: tok, TimeoutMs: timeout}, messaging.Deps{Clock: messaging.Clock(now), Window: st})
		if err != nil {
			return runtime.ClientError{Msg: err.Error()}
		}
		kit.WhatsApp = c
	}
	// the monthly report (report/monthly-job.ts) from runtime.json's `report` block; without it none is made
	if cfg, err := reportwire.ReadSetup(client.Config, client.Folder, log); err != nil {
		return err
	} else if cfg != nil {
		kit.Report = stockorders.NewMonthlyReport(*cfg, kit.Settings, kit.WhatsApp)
	}
	var acc *access.Access
	if channelToken != "" {
		if acc, err = access.Open(filepath.Join(client.Config.DataDir, access.OwnerAccessFile)); err != nil {
			return err
		}
		defer acc.Close()
	}
	rt, err := runtime.New(runtime.Options{Client: client, Store: st, Access: acc, Model: understanding.NewModel(client.Config.Talk, log, "The talk is off", understanding.TalkTimeoutMs, understanding.TalkMaxTokens), RecordKey: key, Log: log, Now: now, Kit: kit})
	if err != nil {
		return err
	}
	srv, err := runtime.Listen(rt, token, channelToken, client.Config.Host, client.Config.Port)
	if err != nil {
		return err
	}
	rt.Start(time.Duration(client.Config.TickSeconds * float64(time.Second)))
	rt.Kick()
	fmt.Printf("Geometer · Stock orders agent (Go) · %s (%s) · %s@%s\n", client.Settings.Name, filepath.Base(client.Folder), client.Lock.Pathway, client.Lock.Version)
	fmt.Printf("Listening on %s · data in %s · a tick every %g s\n", srv.URL, client.Config.DataDir, client.Config.TickSeconds)
	fmt.Println("Press Ctrl+C to stop.")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	srv.Close()
	rt.Close()
	return nil
}
