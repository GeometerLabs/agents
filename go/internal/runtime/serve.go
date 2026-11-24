package runtime

// Serve is the start of ONE shop's program, the same for Orders, Fees, Stock orders and a shop of several parts (go/cmd/orders, cmd/fees, cmd/stock-orders, cmd/parts): what
// each of their main.go did inline until 25 Nov 2026 (decision 65 made a fourth copy the next step, so it is here once). In order: the folder checked against the Kit's pin
// (LoadClientKit), the Kit's own check of the folder (PreChecker), the internal token, the channel token (a shop with none has no owner's page), the record key, the store, the
// contract tests' clock (a "live" shop refuses one), the shop's own signing key, the Kit's wiring (WiredKit.Wire), the owner's access store, the runtime, the Kit's part that
// needs the runtime (Started), the HTTP face, the runner, and the banner. It returns when SIGINT or SIGTERM comes: the step in hand finishes and the store is closed.

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/testclock"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// PreChecker is a WiredKit with a check of the folder before anything is opened (Stock orders: a live shop must name its WhatsApp).
type PreChecker interface {
	PreCheck(c *Client) error
}

// ServeOptions: Label names the program in its banner ("Orders agent"); Shop and Centre say "shop" or "centre" in the line about a missing channel token; OnPanic, when set,
// is the runtime's (a panic in a step is handed to it and the runner goes on: the shop of several parts sets it, so one part's panic does not stop the others).
type ServeOptions struct {
	Label   string
	Noun    string
	OnPanic func(where string, v any)
}

// Serve runs the shop in `folder` with `kit` until a stop signal.
func Serve(folder string, kit WiredKit, o ServeOptions) error {
	log := func(line string) { fmt.Println(line) }
	client, err := LoadClientKit(folder, kit) // refuses a wrong pathway version before anything is opened
	if err != nil {
		return err
	}
	if pc, ok := kit.(PreChecker); ok {
		if err := pc.PreCheck(client); err != nil {
			return err
		}
	}
	token, err := ReadToken(os.Getenv("INTERNAL_TOKEN_FILE"), "internal token")
	if err != nil {
		return err
	}
	// never a reason not to start: a shop with no channel token simply has no owner's page
	channelToken := ""
	if f := os.Getenv("CHANNEL_TOKEN_FILE"); f != "" {
		if t, err := ReadToken(f, "channel token"); err == nil {
			channelToken = t
		} else {
			log("No usable channel token in " + f + " (CHANNEL_TOKEN_FILE): this " + o.Noun + "'s owner's page is off until the next deploy makes one.")
		}
	}
	key, err := RecordKey(client.Config.Mode, os.Getenv("RECORD_KEY_FILE"))
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
		return ClientError{Msg: err.Error()}
	} else if test != nil {
		now = test
	}
	// the shop's own signing key is made here on the first start (or taken from shop-key.json), as the TypeScript start does for every template
	if _, err := LoadShopKey(st, client.Config.DataDir, now(), log); err != nil {
		return err
	}
	var rt *Runtime
	if err := kit.Wire(Wiring{Client: client, Own: client.Settings.Own, Store: st, Now: now, Log: log, RT: func() *Runtime { return rt }}); err != nil {
		return err
	}
	var acc *access.Access
	if channelToken != "" {
		if acc, err = access.Open(filepath.Join(client.Config.DataDir, access.OwnerAccessFile)); err != nil {
			return err
		}
		defer acc.Close()
	}
	rt, err = New(Options{Client: client, Store: st, Access: acc, Model: understanding.NewModel(client.Config.Talk, log, "The talk is off", understanding.TalkTimeoutMs, understanding.TalkMaxTokens), RecordKey: key, Log: log, Now: now, Kit: kit, OnPanic: o.OnPanic})
	if err != nil {
		return err
	}
	kit.Started(rt)
	srv, err := Listen(rt, token, channelToken, client.Config.Host, client.Config.Port)
	if err != nil {
		return err
	}
	rt.Start(time.Duration(client.Config.TickSeconds * float64(time.Second)))
	rt.Kick() // any task saved but not finished when the last process stopped runs now
	fmt.Printf("Geometer · %s (Go) · %s (%s) · %s@%s\n", o.Label, client.Settings.Name, filepath.Base(client.Folder), client.Lock.Pathway, client.Lock.Version)
	fmt.Printf("Listening on %s · data in %s · a tick every %g s\n", srv.URL, client.Config.DataDir, client.Config.TickSeconds)
	fmt.Println("Press Ctrl+C to stop.")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	srv.Close()
	rt.Close()
	return nil
}
