// listings-shared is ONE process for MANY listings-only shops: the Go twin of templates/commerce/listings/server/shared-main.ts (decision 61). The design, the crash containment
// and what it cannot recover are in the package comment of internal/shared.
//
//	SHOPS_DIR=/shops SECRETS_DIR=/run/secrets listings-shared
//
//	/shops/<shop>/client/    the shop's settings.json, runtime.json, pathway.lock (read-only; the deployer writes pathway.lock last)
//	/run/secrets/<shop>/     the shop's internal_token, channel_token and record_key (one folder each, so a shop's files are never beside another's)
//
//	HOST (default 0.0.0.0)  PORT (8780)  SCAN_SECONDS (5)  STATE_DIR (where the strike memory is kept; unset: in memory only, so a quarantined shop is forgotten at a restart)
//
// The environment sets NO token and NO key: every shop's are files, handed to that shop's own start, so a shop with a missing file is not started instead of running on another
// shop's token. `listings-shared --one <shop>` is the child the host starts for a quarantined shop: it serves that one shop on a loopback port and is not run by hand.
// Ctrl+C or SIGTERM stops: each shop's step in hand finishes and its store is closed.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/GeometerLabs/agents/go/internal/shared"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func main() {
	log := func(line string) { fmt.Println(line) }
	src := shared.FolderSource{ClientsDir: env("SHOPS_DIR", "/shops"), SecretsDir: env("SECRETS_DIR", "/run/secrets")}
	args := os.Args[1:]
	if len(args) == 2 && args[0] == "--one" {
		if err := shared.RunOne(src, shared.StartGoShop, args[1], shared.Limits{}, log); err != nil {
			fmt.Fprintln(os.Stderr, "The shop could not start: "+err.Error())
			os.Exit(1)
		}
		return
	}
	if len(args) != 0 {
		fmt.Fprintln(os.Stderr, "Usage: SHOPS_DIR=<dir> SECRETS_DIR=<dir> listings-shared")
		os.Exit(2)
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	scan, _ := strconv.ParseFloat(env("SCAN_SECONDS", "5"), 64)
	if scan < 1 {
		scan = 1
	}
	h, err := shared.New(shared.Options{
		Source: src, Start: shared.StartGoShop, Addr: env("HOST", "0.0.0.0") + ":" + env("PORT", "8780"), ScanEvery: time.Duration(scan * float64(time.Second)),
		StateDir: os.Getenv("STATE_DIR"), Log: log,
		Child: shared.ExecSpawner{Exe: exe, Env: os.Environ(), Log: log},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "The shared process could not start: "+err.Error())
		os.Exit(1)
	}
	fmt.Printf("Geometer · listings-only shops (Go) · %d shop(s) held · %s\n", len(h.Held()), h.URL)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	h.Stop()
}
