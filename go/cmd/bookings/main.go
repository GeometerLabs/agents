// bookings runs ONE Bookings shop: the Go twin of templates/commerce/bookings/server/main.ts (decision 61, wave 2). The shared runtime (internal/runtime) with the Bookings
// template (internal/bookings).
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key bookings --client <folder>
//	bookings health <url>      one GET of the address (the container's health check: the image has no wget); exit 0 on a 200, else 1
//
// The folder, the token files, the environment and the test clock are the TypeScript runtime's (and cmd/listings'), so a shop's folder starts on either runtime. A "live" shop refuses
// the test clock. Press Ctrl+C (or send SIGTERM) to stop: the step in hand finishes and the store is closed.
package main

import (
	"errors"
	"fmt"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/health"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/terms"
	"github.com/GeometerLabs/agents/go/internal/testclock"
	"github.com/GeometerLabs/agents/go/internal/understanding"
	"github.com/GeometerLabs/agents/go/internal/voice"
)

func main() {
	args := os.Args[1:]
	if len(args) == 2 && args[0] == "health" {
		os.Exit(health.Check(args[1], func(line string) { fmt.Fprintln(os.Stderr, line) }))
	}
	if len(args) == 2 && args[0] == "get" {
		os.Exit(health.Get(args[1], os.Stdout, func(line string) { fmt.Fprintln(os.Stderr, line) }))
	}
	for _, a := range args {
		if a == "--help" || a == "-h" {
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> bookings --client <folder>")
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
	kit := &bookings.Kit{}
	client, err := runtime.LoadClientKit(folder, kit) // refuses a wrong pathway version before anything is opened
	if err != nil {
		return err
	}
	token, err := runtime.ReadToken(os.Getenv("INTERNAL_TOKEN_FILE"), "internal token")
	if err != nil {
		return err
	}
	// never a reason not to start: a shop with no channel token simply has no owner's page
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
	// the contract tests may run the shop on a TEST clock (internal/testclock says why a real shop never can: a "live" shop refuses to start with one)
	if test, err := testclock.FromEnv(os.Getenv, client.Config.Mode); err != nil {
		return runtime.ClientError{Msg: err.Error()}
	} else if test != nil {
		now = test
	}
	// the shop's own signing key is made here on the first start (or taken from shop-key.json), as the TypeScript start does for every template
	if _, err := runtime.LoadShopKey(st, client.Config.DataDir, now(), log); err != nil {
		return err
	}
	kit.Settings, kit.Now = client.Settings.Own.(*bookings.Settings), now
	// the services (services.ts buildServices): the stand-ins in fakes mode, made once here so they keep what they were told while the process runs; the live clients in live mode
	var rt *runtime.Runtime
	ports, err := bookings.BuildPorts(client.Config, kit.Settings, bookings.PortsOptions{Now: now, Window: st, Say: log})
	if err != nil {
		return err
	}
	// item 11h: every message to the owner by the owner's choice of WhatsApp, push or both (push alone for a shop with no WhatsApp: push.ts ownerRoute)
	ports.PushOwner = func(text string) []string {
		p := rt.Push()
		if p == nil || !p.On {
			return nil
		}
		ids, _ := p.Owner(text, "")
		return ids
	}
	ports.OwnerRoute = func(hasWhatsApp bool) string {
		phones := 0
		p := rt.Push()
		if p != nil && p.On {
			phones = p.OwnerPhones()
		}
		switch {
		case !hasWhatsApp && phones > 0:
			return "push"
		case !hasWhatsApp:
			return "none"
		case phones == 0:
			return "whatsapp"
		}
		return p.Choice()
	}
	// the books (go-bk-books-19nov's adapters): the money lines' accounting and the settlement read; the monthly report runs after the beat's step (agent_after.go)
	sr, _ := ports.Payments.(payments.SettlementReader)
	ports.Books = bookings.NewBooks(bookings.BooksPorts{Messaging: ports.WhatsApp, Settlements: sr, Capabilities: ports.Capabilities})
	if setup, err := bookings.ReportSetupOf(client.Config, client.Folder, kit.Settings, log); err != nil {
		return err
	} else if setup != nil {
		kit.Report = ports.Books.NewMonthlyReport(*setup)
		// start.ts: a UPI shop's QR pictures go into the report's pages folder, served at its address (ownerMarkedOf(payment) && report)
		if kit.Settings.OwnerMarked() {
			kit.QRImage = ownermarked.FolderImages(setup.PagesDir, setup.PagesBaseURL, log)
		}
	}
	kit.Ports = ports
	// B72: the shop terms, read from the client folder again whenever the file changes; no file: the feature is off
	kit.Terms = terms.NewReader(client.Folder)
	// B29: the shop's voice service, from runtime.json `speech` (internal/voice); left out, voice is off and a voice note gets the one line asking to type
	if raw, ok := client.Config.Raw["speech"]; ok {
		c, problems := voice.Read(raw, client.Folder)
		if len(problems) > 0 {
			return runtime.ClientError{Msg: "runtime.json: " + strings.Join(problems, " ")}
		}
		if kit.Voice, err = voice.Build(c, kit.Settings.Languages, now, log); err != nil {
			return runtime.ClientError{Msg: err.Error()}
		}
	}
	kit.Router = runtime.RouterFor[bookings.Intent](&client.Config, bookings.Reading{S: kit.Settings}, log)
	// item 11h: where a WhatsApp booking's own page lives, read fresh from the deployer's pages.json (start.ts pageBase: the pages domain's address, else this server's)
	kit.PageBase = func() string {
		p := access.ReadPages(filepath.Join(client.Folder, access.PagesFile))
		if p == nil {
			return ""
		}
		if p.URL != "" {
			return p.URL
		}
		return p.Base
	}
	var acc *access.Access
	if channelToken != "" {
		if acc, err = access.Open(filepath.Join(client.Config.DataDir, access.OwnerAccessFile)); err != nil {
			return err
		}
		defer acc.Close()
	}
	rt, err = runtime.New(runtime.Options{Client: client, Store: st, Access: acc, Model: understanding.NewModel(client.Config.Talk, log, "The talk is off", understanding.TalkTimeoutMs, understanding.TalkMaxTokens), RecordKey: key, Log: log, Now: now, Kit: kit})
	if err != nil {
		return err
	}
	kit.Licence = rt.LicenceNow
	srv, err := runtime.Listen(rt, token, channelToken, client.Config.Host, client.Config.Port)
	if err != nil {
		return err
	}
	rt.Start(time.Duration(client.Config.TickSeconds * float64(time.Second)))
	rt.Kick() // any task saved but not finished when the last process stopped runs now
	fmt.Printf("Geometer · Bookings agent (Go) · %s (%s) · %s@%s\n", client.Settings.Name, filepath.Base(client.Folder), client.Lock.Pathway, client.Lock.Version)
	fmt.Printf("Listening on %s · data in %s · a tick every %g s\n", srv.URL, client.Config.DataDir, client.Config.TickSeconds)
	fmt.Println("Press Ctrl+C to stop.")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	srv.Close()
	rt.Close()
	return nil
}
