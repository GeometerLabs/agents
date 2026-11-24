package fees

// How a Fees centre's program wires its Kit (runtime.WiredKit): what go/cmd/fees/main.go did inline until 25 Nov 2026, moved here unchanged so the shop of several template
// parts (decision 65, go/cmd/parts) wires a Fees part (the credit book) the same way. runtime.Serve calls Wire before runtime.New and Started after it.
//
// What is wired: the settings, the payments and WhatsApp (ports.go), the owner's messages by WhatsApp, push or both, a UPI centre's QR pictures and the monthly report (both from
// runtime.json `report`), the Classes material folder, the shop terms, the page's address, and (after the runtime) the licence and the last saved state for the page's head.

import (
	"path/filepath"

	"github.com/GeometerLabs/agents/go/internal/access"
	"github.com/GeometerLabs/agents/go/internal/feesreport"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/reportwire"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/terms"
)

var _ runtime.WiredKit = (*Kit)(nil)

// Wire fills the Kit from the client folder before the runtime is made.
func (k *Kit) Wire(w runtime.Wiring) error {
	client, now, log := w.Client, w.Now, w.Log
	k.Settings, k.Now = w.Own.(*Settings), now
	ports, err := BuildPorts(client.Config, k.Settings, PortsOptions{Now: now, Window: w.Store, Say: log, ReportTemplates: feesreport.ReportTemplateNames()})
	if err != nil {
		return err
	}
	ports.PushOwner = func(text string) []string { return w.RT().OwnerPush(text) } // the one shared owner route (runtime/ownerroute.go); the runtime is made later, so a closure
	ports.OwnerRoute = func(hasWhatsApp bool) string { return w.RT().OwnerRoute(hasWhatsApp) }
	// 24 Nov 2026: a page's message also goes to the phones that allowed alerts on that page (runtime/push.go CustomerPush, through the shop's push Guard)
	ports.PushCustomer = func(conversation, text string) { w.RT().CustomerPush(conversation, text) }
	// a UPI centre's QR pictures go into the folder the monthly report's pages are served from (start.ts folderQrImages), under random names; no report block: the words alone
	if k.Settings.OwnerMarked() {
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
	k.Ports = ports
	// the monthly report (report/monthly-job.ts) from runtime.json's `report` block; no block, no report (the QR pictures above read the same block)
	if setup, err := reportwire.ReadSetup(client.Config, client.Folder, log); err != nil {
		return err
	} else if setup != nil {
		k.Report = NewMonthlyReport(*setup, ports.WhatsApp)
	}
	if k.Settings.Classes != nil {
		k.MaterialsDir = filepath.Join(client.Folder, "materials")
	}
	// B72: the shop terms, read from the client folder again whenever the file changes; no file: the feature is off (as cmd/orders)
	k.Terms = terms.NewReader(client.Folder)
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
	return nil
}

// Started is what needs the runtime: the licence, and (item 11i) the page head's character, which reads the assistant's part of the last saved state (server/runtime.ts
// channel.offer).
func (k *Kit) Started(rt *runtime.Runtime) {
	k.Licence = rt.LicenceNow
	k.LastSnap = func() *runtime.Snap {
		_, sn, _ := rt.KitState()
		return sn
	}
}
