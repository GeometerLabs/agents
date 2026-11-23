package orders

// Every call of the shop's stock count (internal/stock, the Go twin of modules/stock: stream W5's package, whose calls are methods on *stock.Stock) in ONE file: the facts the count reads from the orders (order.ts orderFacts), what is left of a counted item for a new order (order.ts
// countedLeft) and the agent's reconcileStock (agent.ts: the sales booked once, the cancelled ones given back, the low mark's line to the owner). Nothing else in this package
// imports internal/stock.

import (
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/stock"
)

// OrderFacts is order.ts orderFacts: each item line of every order as the stock module reads it, one fact per order and item (two lines of an item are one fact with both
// quantities added). Plan payments are not orders of the menu; an order that ended more than stock.FactHorizonMs ago is no longer passed.
func (st *Store) OrderFacts(nowMs int64) []stock.OrderFact {
	var out []stock.OrderFact
	for _, o := range st.Orders {
		if o.Plan != nil {
			continue
		}
		if (o.State == Completed || o.State == Cancelled) && o.SlotEndMs != nil && nowMs-*o.SlotEndMs > stock.FactHorizonMs {
			continue
		}
		var items []string // a Map keeps the order of first insertion
		qty := map[string]int64{}
		for _, l := range o.Lines {
			if _, seen := qty[l.ItemID]; !seen {
				items = append(items, l.ItemID)
			}
			qty[l.ItemID] += l.Qty
		}
		for _, id := range items {
			f := stock.OrderFact{Key: "sale:" + o.ID + ":" + id, ID: stock.MenuID(id), Qty: qty[id], Standing: o.State == Confirmed || o.State == Completed,
				Cancelled: o.State == Cancelled, Holding: HoldsStock(o, nowMs)}
			if o.SlotEndMs != nil {
				f.EndedMs = *o.SlotEndMs // W5's OrderFact: 0 is "not said"
			}
			out = append(out, f)
		}
	}
	return out
}

// CountedLeft is order.ts countedLeft: what is left of a COUNTED menu item for a new order (the count less what other orders hold that is not yet in it); ok false for an item
// nobody counts. `count` is the shop's stock count (the assistant's state, runtime.Snap.Stock; nil: none). exceptID is the order being checked.
func (st *Store) CountedLeft(count *stock.Stock, itemID string, nowMs int64, exceptID string) (int64, bool) {
	id := stock.MenuID(itemID)
	if count == nil || count.LineOf(id) == nil {
		return 0, false
	}
	var facts []stock.OrderFact
	for _, f := range st.OrderFacts(nowMs) {
		if exceptID == "" || !strings.HasPrefix(f.Key, "sale:"+exceptID+":") {
			facts = append(facts, f)
		}
	}
	return count.LeftFor(id, count.UnbookedHolds(id, facts, ""))
}

// stockCount is `store.assistant?.stock`: the shop's one stock count in this step's state (nil: nothing is counted).
func (a *Agent) stockCount() *stock.Stock {
	if a.c == nil || a.c.Snap == nil {
		return nil
	}
	return a.c.Snap.Stock
}

// reconcileStock is agent.ts reconcileStock: for each menu item the owner counts, an order that stands is booked once under `sale:<order>:<item>`, and a cancelled order gives back
// exactly what it took. Run at the start of every step and tick and again before an availability check; asking twice changes nothing. A shop that counts nothing returns at once,
// writing nothing and logging nothing. An item that fell to its low mark gets the owner one line in their app now (once per crossing); Orders has no supplier to ask.
func (a *Agent) reconcileStock() {
	st := a.stockCount()
	if st == nil || len(st.Lines) == 0 {
		return
	}
	now := a.now()
	countsOf := func() string {
		parts := make([]string, len(st.Lines))
		for i, l := range st.Lines {
			parts[i] = strconv.FormatInt(l.Count, 10)
		}
		return strings.Join(parts, ",")
	}
	before := countsOf()
	if changed := st.ReconcileSales(stock.ShopRecord(), a.store.OrderFacts(now), now); changed > 0 && countsOf() != before {
		a.log(nil, a.owner(), stock.Action, "confirmed", map[string]any{"changed": changed}, logMore{refs: stock.Refs("menu:*", "booked_sale", "shop"),
			notes: "the shop's stock count was brought in line with the orders that stand and the ones cancelled (each order is booked once)"})
	}
	for _, al := range st.PendingAlerts("") {
		if stock.KindOf(al.Line) == "supply" {
			continue // a supply item belongs to Stock orders, which turns its alert into a reorder
		}
		st.AckAlert(al.Line, al.Crossing)
		// `item ? itemName(item, ownerLanguage) : st.lines.find((l) => l.id === a.line)?.name ?? a.line`
		name := al.Line
		var item *MenuItem
		if strings.HasPrefix(al.Line, "menu:") {
			item = a.settings.ItemOf(strings.TrimPrefix(al.Line, "menu:"))
		}
		if item != nil {
			name = ItemName(item, a.settings.Owner.Language)
		} else {
			for _, l := range st.Lines {
				if l.ID == al.Line {
					if l.Name != "" {
						name = l.Name
					}
					break
				}
			}
		}
		if a.c.Snap.A != nil {
			a.c.Snap.A.Talk = append(a.c.Snap.A.Talk, assistant.TalkLine{AtMs: now, From: "assistant", Text: stock.Words(a.settings.Owner.Language).RunningLow(name, al.Count)})
		}
		a.log(nil, a.owner(), stock.Action, "confirmed", map[string]any{"item": al.Line, "count": al.Count, "crossing": al.Crossing}, logMore{refs: stock.Refs(al.Line, "low", "shop"),
			notes: "a counted item fell to its low mark; the owner was told once for this crossing"})
	}
}
