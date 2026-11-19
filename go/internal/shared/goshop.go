package shared

// The real Starter: one listings-only shop built from its folder and token files, the Go twin of templates/commerce/listings/server/shared-start.ts. It is cmd/listings' `run`
// without the listener and without the signal wait: the same store, access database, runtime and routes (internal/runtime), whose HTTP face is handed to the host as an
// http.Handler. Every token is read from the shop's OWN files; there is no environment fallback, so a shop whose file is missing fails here and never runs on another's token.

import (
	"fmt"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

type goShop struct {
	rt   *runtime.Runtime
	srv  *runtime.Server
	st   *store.Store
	acc  *access.Access
	once sync.Once
}

func (g *goShop) Handler() http.Handler { return g.srv.Handler() }
func (g *goShop) Ready() bool           { ok, _ := g.rt.Ready(); return ok }
func (g *goShop) StepSince() int64      { return g.rt.StepSince() }

// Close finishes the step in hand, then closes the owner sign-in file and the store (the order cmd/listings uses).
func (g *goShop) Close() {
	g.once.Do(func() {
		g.rt.Close()
		if g.acc != nil {
			_ = g.acc.Close()
		}
		_ = g.st.Close()
	})
}

// StartGoShop is the shipped Starter.
func StartGoShop(p Paths, h Hooks) (Shop, error) {
	client, err := runtime.LoadClient(p.ClientFolder) // refuses a wrong pathway version before anything is opened
	if err != nil {
		return nil, err
	}
	token, err := runtime.ReadToken(p.TokenFile, "internal token")
	if err != nil {
		return nil, err
	}
	// never a reason not to start: a shop with no usable channel token simply has no owner's page (as cmd/listings does)
	channelToken := ""
	if t, err := runtime.ReadToken(p.ChannelTokenFile, "channel token"); err == nil {
		channelToken = t
	} else {
		h.Log("No usable channel token in " + p.ChannelTokenFile + ": this shop's owner's page is off until the next deploy makes one.")
	}
	key, err := runtime.RecordKey(client.Config.Mode, p.RecordKeyFile)
	if err != nil {
		return nil, err
	}
	st, err := store.Open(client.Config.DataDir)
	if err != nil {
		return nil, err
	}
	now := func() int64 { return time.Now().UnixMilli() }
	fail := func(err error, acc *access.Access) (Shop, error) {
		if acc != nil {
			_ = acc.Close()
		}
		_ = st.Close()
		return nil, err
	}
	if _, err := runtime.LoadShopKey(st, client.Config.DataDir, now(), h.Log); err != nil {
		return fail(err, nil)
	}
	var acc *access.Access
	if channelToken != "" {
		if acc, err = access.Open(filepath.Join(client.Config.DataDir, access.OwnerAccessFile)); err != nil {
			return fail(err, nil)
		}
	}
	rt, err := runtime.New(runtime.Options{Client: client, Store: st, Access: acc, Model: understanding.NewModel(client.Config.Talk, h.Log, "The talk is off", understanding.TalkTimeoutMs, understanding.TalkMaxTokens), RecordKey: key, Log: h.Log, Now: now, OnPanic: h.OnPanic})
	if err != nil {
		return fail(err, acc)
	}
	srv := runtime.NewServer(rt, token, channelToken)
	rt.Start(time.Duration(client.Config.TickSeconds * float64(time.Second)))
	rt.Kick() // any task saved but not finished when the last process stopped runs now
	h.Log(fmt.Sprintf("%s (%s) · %s@%s · data in %s", client.Settings.Name, filepath.Base(client.Folder), client.Lock.Pathway, client.Lock.Version, client.Config.DataDir))
	return &goShop{rt: rt, srv: srv, st: st, acc: acc}, nil
}
