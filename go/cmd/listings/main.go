// listings runs ONE listings-only shop on its own, for a local try, a test or a small server: the Go twin of templates/commerce/listings/server/main.ts.
//
//	INTERNAL_TOKEN_FILE=token.txt CHANNEL_TOKEN_FILE=channel.txt RECORD_KEY_FILE=record.key listings --client <folder>
//
// The folder, the token files and the environment are the TypeScript runtime's, so a shop's folder starts on either. Press Ctrl+C (or send SIGTERM) to stop: the step in hand finishes and
// the store is closed.
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
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

func main() {
	args := os.Args[1:]
	for _, a := range args {
		if a == "--help" || a == "-h" {
			fmt.Println("Usage: INTERNAL_TOKEN_FILE=<file> listings --client <folder>")
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
	client, err := runtime.LoadClient(folder) // refuses a wrong pathway version before anything is opened
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
	// the shop's own signing key is made here on the first start (or taken from shop-key.json), so it is there before any page asks for it
	if _, err := runtime.LoadShopKey(st, client.Config.DataDir, now(), log); err != nil {
		return err
	}
	var acc *access.Access
	if channelToken != "" {
		if acc, err = access.Open(filepath.Join(client.Config.DataDir, access.OwnerAccessFile)); err != nil {
			return err
		}
		defer acc.Close()
	}
	rt, err := runtime.New(runtime.Options{Client: client, Store: st, Access: acc, Model: runtime.NewModel(client.Config.Talk, log), RecordKey: key, Log: log, Now: now})
	if err != nil {
		return err
	}
	srv, err := runtime.Listen(rt, token, channelToken, client.Config.Host, client.Config.Port)
	if err != nil {
		return err
	}
	rt.Start(time.Duration(client.Config.TickSeconds * float64(time.Second)))
	rt.Kick() // any task saved but not finished when the last process stopped runs now
	fmt.Printf("Geometer · Listings only agent (Go) · %s (%s) · %s@%s\n", client.Settings.Name, filepath.Base(client.Folder), client.Lock.Pathway, client.Lock.Version)
	fmt.Printf("Listening on %s · data in %s · a tick every %g s\n", srv.URL, client.Config.DataDir, client.Config.TickSeconds)
	fmt.Println("Press Ctrl+C to stop.")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	srv.Close()
	rt.Close()
	return nil
}
