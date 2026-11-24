package orders

// How an Orders shop's program wires its Kit (runtime.WiredKit): what go/cmd/orders/main.go did inline until 25 Nov 2026, moved here unchanged so the shop of several template
// parts (decision 65, go/cmd/parts) wires an Orders part (the pickup hold) the same way. cmd/orders calls Wire before runtime.New and Started after it.
//
// What is wired: the settings, the payments and WhatsApp (built from runtime.json as ports.go says: a UPI shop's owner-marked ledger needs no Guard), the owner's messages by
// WhatsApp, push or both, the page's address, the saved stock count for the page's offer, the monthly report and a UPI shop's QR pictures (runtime.json `report`), the shop
// terms, voice (`speech`) and the reader of customers' words (`decision`, `parser`), and the assistant's two channel hooks.

import (
	"encoding/json"
	"path/filepath"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/orders/reading"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/terms"
	"github.com/GeometerLabs/agents/go/internal/voice"
)

var _ runtime.WiredKit = (*Kit)(nil)

// Wire fills the Kit from the client folder before the runtime is made.
func (k *Kit) Wire(w runtime.Wiring) error {
	client, now, log := w.Client, w.Now, w.Log
	k.Settings, k.Now = w.Own.(*Settings), now
	// the services (services.ts buildServices): the stand-ins in fakes mode, made once here so they keep what they were told while the process runs; the live clients in live mode
	ports, err := BuildPorts(client.Config, k.Settings, PortsOptions{Now: now, Window: w.Store, Say: log})
	if err != nil {
		return err
	}
	// item 11h: every message to the owner by the owner's choice of WhatsApp, push or both (push alone for a shop with no WhatsApp: push.ts ownerRoute)
	ports.PushOwner = func(text string) []string { return w.RT().OwnerPush(text) } // the one shared owner route (runtime/ownerroute.go); the runtime is made later, so a closure
	ports.OwnerRoute = func(hasWhatsApp bool) string { return w.RT().OwnerRoute(hasWhatsApp) }
	// 24 Nov 2026: a page's message also goes to the phones that allowed alerts on that page (runtime/push.go CustomerPush, through the shop's push Guard)
	ports.PushCustomer = func(conversation, text string) { w.RT().CustomerPush(conversation, text) }
	k.Ports = ports
	// the monthly report (report/monthly-job.ts) from runtime.json's `report` block; a UPI shop's QR pictures go into the folder its pages are served from (start.ts folderQrImages)
	if setup, err := reportwire.ReadSetup(client.Config, client.Folder, log); err != nil {
		return err
	} else if setup != nil {
		k.Report = NewMonthlyReport(*setup, ports.WhatsApp)
		if k.Settings.OwnerMarked() {
			k.QRImage = ownermarked.FolderImages(setup.PagesDir, setup.PagesBaseURL, log)
		}
	}
	// B72: the shop terms, read from the client folder again whenever the file changes; no file: the feature is off
	k.Terms = terms.NewReader(client.Folder)
	// B29: the shop's voice service, from runtime.json `speech` (internal/voice); left out, voice is off and a voice note gets the one line asking to type
	if raw, ok := client.Config.Raw["speech"]; ok {
		c, problems := voice.Read(raw, client.Folder)
		if len(problems) > 0 {
			return runtime.ClientError{Msg: "runtime.json: " + strings.Join(problems, " ")}
		}
		if k.Voice, err = voice.Build(c, k.Settings.Languages, now, log); err != nil {
			return runtime.ClientError{Msg: err.Error()}
		}
	}
	// how the shop reads a customer's words past the rules (the decision model and the language model of runtime.json), over internal/orders/reading
	k.Router = runtime.RouterFor[reading.Intent](&client.Config, ReadingOf(k.Settings), log)
	// item 11h: where an order's own page lives, read fresh from the deployer's pages.json (start.ts pageBase: the pages domain's address, else this server's)
	k.PageBase = func() string {
		p := access.ReadPages(filepath.Join(client.Folder, access.PagesFile))
		if p == nil {
			return ""
		}
		if p.URL != "" {
			return p.URL
		}
		return p.Base
	}
	// the page's offer counts the owner's stock count (the assistant's state) as orderOffer's countedLeft does: read from the last saved state, as the offer itself is
	k.SavedStock = func() *listings.Stock {
		_, sn, _ := w.RT().KitState()
		if sn == nil {
			return nil
		}
		return sn.Stock
	}
	// item 11e/11i: with the shop's assistant on, the owner's read carries the app's view, and the page's head the character in the mood the public sees now, both over the
	// Orders skill read-only and the last saved state's assistant part (server/runtime.ts channel.owner and channel.offer)
	k.OwnerApp = k.AppView
	k.OfferCharacter = func(st *Store) json.RawMessage {
		_, sn, _ := w.RT().KitState()
		return k.PublicCharacter(st, sn)
	}
	return nil
}

// Started is what needs the runtime: the licence.
func (k *Kit) Started(rt *runtime.Runtime) { k.Licence = rt.LicenceNow }
