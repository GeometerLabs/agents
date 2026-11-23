// fees runs ONE Fees (and Classes) centre: the Go twin of templates/education/fees/server/main.ts (decision 61, wave 3). The shared runtime (internal/runtime) with the Fees
// template (internal/fees).
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key fees --client <folder>
//	fees health <url>      one GET of the address (the container's health check); exit 0 on a 200, else 1
//
// The folder, the token files, the environment and the test clock are the TypeScript runtime's (and cmd/bookings'), so a centre's folder starts on either runtime. A "live" centre
// refuses the test clock. Press Ctrl+C (or send SIGTERM) to stop: the step in hand finishes and the store is closed.
package main

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/fees"
	"github.com/GeometerLabs/agents/go/internal/feesreport"
	"github.com/GeometerLabs/agents/go/internal/health"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/terms"
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
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> fees --client <folder>")
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
	kit := &fees.Kit{}
	client, err := runtime.LoadClientKit(folder, kit) // refuses a wrong pathway version before anything is opened
	if err != nil {
		return err
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
			log("No usable channel token in " + f + " (CHANNEL_TOKEN_FILE): this centre's owner's page is off until the next deploy makes one.")
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
	kit.Settings, kit.Now = client.Settings.Own.(*fees.Settings), now
	var rt *runtime.Runtime
	ports, err := fees.BuildPorts(client.Config, kit.Settings, fees.PortsOptions{Now: now, Window: st, Say: log, ReportTemplates: feesreport.ReportTemplateNames()})
	if err != nil {
		return err
	}
	ports.PushOwner = func(text string) []string { return rt.OwnerPush(text) } // the one shared owner route (runtime/ownerroute.go); rt is made later, so a closure
	ports.OwnerRoute = func(hasWhatsApp bool) string { return rt.OwnerRoute(hasWhatsApp) }
	// a UPI centre's QR pictures go into the folder the monthly report's pages are served from (start.ts folderQrImages), under random names; no report block: the words alone
	if kit.Settings.OwnerMarked() {
		if rep, ok := client.Config.Raw["report"].(map[string]any); ok {
			dir, _ := rep["pagesDir"].(string)
			base, _ := rep["pageBaseUrl"].(string)
			if dir != "" && base != "" {
				if !filepath.IsAbs(dir) {
					dir = filepath.Join(client.Folder, dir)
				}
				ports.QR = ownermarked.FolderImages(dir, base, log)
			}
		}
	}
	kit.Ports = ports
	// the monthly report (report/monthly-job.ts) from runtime.json's `report` block; no block, no report (the QR pictures above read the same block)
	if setup, err := reportwire.ReadSetup(client.Config, client.Folder, log); err != nil {
		return err
	} else if setup != nil {
		kit.Report = fees.NewMonthlyReport(*setup, ports.WhatsApp)
	}
	if kit.Settings.Classes != nil {
		kit.MaterialsDir = filepath.Join(client.Folder, "materials")
	}
	// B72: the shop terms, read from the client folder again whenever the file changes; no file: the feature is off (as cmd/orders)
	kit.Terms = terms.NewReader(client.Folder)
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
	// item 11i: the page head's character reads the assistant's part of the last saved state (server/runtime.ts channel.offer)
	kit.LastSnap = func() *runtime.Snap {
		_, sn, _ := rt.KitState()
		return sn
	}
	srv, err := runtime.Listen(rt, token, channelToken, client.Config.Host, client.Config.Port)
	if err != nil {
		return err
	}
	rt.Start(time.Duration(client.Config.TickSeconds * float64(time.Second)))
	rt.Kick()
	fmt.Printf("Geometer · Fees agent (Go) · %s (%s) · %s@%s\n", client.Settings.Name, filepath.Base(client.Folder), client.Lock.Pathway, client.Lock.Version)
	fmt.Printf("Listening on %s · data in %s · a tick every %g s\n", srv.URL, client.Config.DataDir, client.Config.TickSeconds)
	fmt.Println("Press Ctrl+C to stop.")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	srv.Close()
	rt.Close()
	return nil
}
