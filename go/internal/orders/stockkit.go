package orders

// The owner's Stock page on an Orders shop (modules/runtime/core.ts createStockKit with `templateItems`): the Orders Kit is a runtime.StockKit (go/internal/runtime/kitstock.go,
// added by stream W5), so the shared runtime serves /internal/channel/owner-stock and takes the page's owner_stock steps for a shop with the assistant, and offers the menu's
// items to count as "menu:<id>", after the shop's listings. The agent's side of the count (the sales booked once, the shelf count in the order's checks) is stock_calls.go.

import (
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stock"
)

var _ runtime.StockKit = (*Kit)(nil)

// StockOn is core.ts `shopPeople.assistant && shopPeople.owner`: the stock kit exists when the settings have an assistant block and an owner's number.
func (k *Kit) StockOn() bool {
	return k.Settings != nil && k.Settings.Assistant != nil && k.Settings.Owner.Whatsapp != ""
}

// StockItems is core.ts templateItems for Orders: each menu item as "menu:<id>", named `names[language] ?? names.en`, its first name, else the id. As in the TypeScript, a
// language whose list is there but empty does not fall back to English (`??` only skips a missing list) and names the item by its id.
func (k *Kit) StockItems(lang string) []listings.ItemRef {
	out := []listings.ItemRef{}
	if k.Settings == nil {
		return out
	}
	for i := range k.Settings.Menu {
		m := &k.Settings.Menu[i]
		names, ok := m.Names[lang]
		if !ok {
			names = m.Names["en"]
		}
		name := m.ID
		if len(names) > 0 && names[0] != "" {
			name = names[0]
		}
		out = append(out, listings.ItemRef{ID: stock.MenuID(m.ID), Name: name})
	}
	return out
}
