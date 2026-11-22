// Package stock is the shop's own record of the one stock count: what an Orders order and a Stock-orders delivery do to it. It is the Go twin of the parts of modules/stock/stock.ts
// that internal/listings/stock.go leaves out on purpose (a listings-only shop has no orders): `sale`, `received`, `reconcileSales`, `reconcileDeliveries`, `unbookedHolds`, `leftFor`,
// the low-mark alert queue (pendingAlerts, ackAlert, noteAsked), `shopRecord` and `stockRefs`. It works OVER listings.Stock, the one typed state (its key-ordered `applied`, its
// movements, `short`, an alert's `asked`), so a state the TypeScript runtime wrote is read and written back whole; there is no second state type. Pure: no disk, no clock (the caller
// says what time it is), no network, and nothing here takes anyone's words: facts are typed values the agent read from its own order state.
//
// What it keeps, as the TypeScript does:
//   - Counting is optional per item: an id with no line (own id or alias) is skipped and nothing is made for it.
//   - Every effect is keyed (`sale:<order>:<item>`, `delivery:<po>`) and the line remembers what each key did (`applied`), so a retry, a duplicate event or a restart never counts twice.
//     A sale is "the order stands, qty N" (target semantics); a cancelled order sets the target to 0 and gives back exactly what it took. A delivery is the CUMULATIVE quantity received.
//   - A count never goes below 0 (a larger sale takes what is there and notes `short`) and never above MaxStockCount.
//   - Orders stays the source for its holds: LeftFor takes away what UnbookedHolds says is held but not yet booked.
//
// Where Go and JavaScript differ: counts are int64 (a JavaScript number that is a safe integer; every bound here is far under 2^53), `Math.min` is the builtin min, and a JavaScript
// `undefined` for the optional unit, end time or `held` is "" / nil / 0 here (an empty unit is "no unit": Orders and Stock orders never pass ""). The write rule the TypeScript enforces with a
// WeakSet (only shopRecord() makes a record) is a struct with an unexported field: the zero Record is refused with a panic, as `requireSource` throws.
package stock

import (
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/listings"
)

// Limits and horizons, as stock.ts. SafeKeepMs and AppliedKeptMs are listings.SafeKeepMs and listings.AppliedKeptMs (one source); FACT_HORIZON_MS is only the agents' business.
const (
	// FactHorizonMs: the agents pass only orders and deliveries still open or finished within this long (30 days); FACT_HORIZON < SAFE_KEEP (45) < APPLIED_KEPT (120).
	FactHorizonMs = 30 * listings.Day
	// Action is STOCK_ACTION, the record's action name for a stock line.
	Action = "stock"
	// FailUnit is the `unit` Failure: a delivery in another unit than the line's is refused, never converted.
	FailUnit listings.StockFailure = "unit"
)

// The kinds of item a stock line may count (STOCK_KINDS).
const (
	KindListing = "listing"
	KindMenu    = "menu"
	KindSupply  = "supply"
)

// What a `stock` line of the record says changed (StockChange).
const (
	ChangeStarted    = "started"
	ChangeStopped    = "stopped"
	ChangeLowMark    = "low_mark"
	ChangeCorrected  = "corrected"
	ChangeSold       = "sold"
	ChangeBookedSale = "booked_sale"
	ChangeReturned   = "returned"
	ChangeReceived   = "received"
	ChangeLow        = "low"
)

// MenuStockID is `menuStockId`: "menu:thali".
func MenuStockID(itemID string) string { return "menu:" + itemID }

// SupplyStockID is `supplyStockId`: "supply:rice25".
func SupplyStockID(itemID string) string { return "supply:" + itemID }

// ListingStockID is `listingStockId`: "listing:l-3".
func ListingStockID(listingID string) string { return listings.ListingStockID(listingID) }

// IsStockID is `isStockId` (the id scheme's one regular expression is in listings).
func IsStockID(id string) bool { return listings.IsStockID(id) }

// KindOf is `kindOf`: "listing", "menu" or "supply"; "" when it is not an id (undefined).
func KindOf(id string) string { return listings.KindOf(id) }

// StockRefs is `stockRefs`: what a `stock` line of the record carries (item, kind, change, by).
func StockRefs(id, change, by string) map[string]string { return listings.StockRefs(id, change, by) }

// ---- who may write ------------------------------------------------------------------------------------------------------------------------------------

// Record is the shop's own record of a sale or a delivery. Only ShopRecord makes a usable one (the field is unexported), and only an agent's own reconcile step calls it, with typed facts.
type Record struct{ from string }

// Who the record is from.
const (
	FromOrders      = "orders"
	FromStockOrders = "stock-orders"
)

// ShopRecord is `shopRecord`.
func ShopRecord(from string) Record { return Record{from: from} }

// require is `requireSource` for the shop's record: the zero Record is a forgery and is refused as the TypeScript throws.
func (r Record) require() {
	if r.from != FromOrders && r.from != FromStockOrders {
		panic("Only the shop's own record of a sale or a delivery, or its owner, can change the stock count.")
	}
}

// by is the movement's `by` for the shop's record.
const by = "shop"

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------

// IsCounted is `isCounted`.
func IsCounted(st *listings.Stock, id string) bool { return st.LineOf(id) != nil }

// CountOf is `countOf`: the count of a counted item, else false.
func CountOf(st *listings.Stock, id string) (int64, bool) {
	if l := st.LineOf(id); l != nil {
		return l.Count, true
	}
	return 0, false
}

// LeftFor is `leftFor`: how many of a counted item can still be taken now (the count less what orders hold that is not yet booked, never below 0). False: uncounted, so the caller's
// own limits stand as they were.
func LeftFor(st *listings.Stock, id string, held int64) (int64, bool) {
	l := st.LineOf(id)
	if l == nil {
		return 0, false
	}
	return max(0, l.Count-held), true
}

// LowLines is `lowLines`: the lines at or under their low mark that the owner has been told of this crossing. except "" is every kind.
func LowLines(st *listings.Stock, except string) []*listings.StockLine {
	out := []*listings.StockLine{}
	if st == nil {
		return out
	}
	for i := range st.Lines {
		l := &st.Lines[i]
		if l.LowFlag && (except == "" || KindOf(l.ID) != except) {
			out = append(out, l)
		}
	}
	return out
}

// ---- the shop's own record of a sale or a delivery ------------------------------------------------------------------------------------------------------

// whole is `whole` for an int64 count: 0 to MaxStockCount.
func whole(n int64) bool { return n >= 0 && n <= listings.MaxStockCount }

// settleOut is `settleOut` with the shop's record as the source: the key stands for `target` of the item. The same target changes nothing; a larger one takes the difference (never more
// than the count, the rest is `short`); a smaller one (0 is a cancelled order) gives back what the key really took.
func settleOut(st *listings.Stock, l *listings.StockLine, key string, target int64, nowMs int64) {
	prev, ok := l.AppliedGet(key)
	if !ok {
		prev = listings.Applied{AtMs: nowMs}
	}
	if target == prev.Qty {
		return
	}
	if target > prev.Qty {
		want := target - prev.Qty
		took := min(want, l.Count)
		l.Count -= took
		l.AppliedSet(key, listings.Applied{Qty: target, Took: prev.Took + took, AtMs: nowMs})
		m := listings.Movement{Kind: "sold", Delta: -took, After: l.Count, AtMs: nowMs, By: by}
		if took < want {
			m.Short = want - took
		}
		l.NoteMove(m)
	} else {
		back := min(prev.Took, prev.Qty-target)
		l.Count = min(listings.MaxStockCount, l.Count+back)
		l.AppliedSet(key, listings.Applied{Qty: target, Took: prev.Took - back, AtMs: nowMs})
		l.NoteMove(listings.Movement{Kind: "returned", Delta: back, After: l.Count, AtMs: nowMs, By: by})
	}
	st.WatchLow(l, nowMs)
	l.Prune(nowMs)
}

// Sale is `sale`: the order `key` stands for qty of the item. The same key and qty again changes nothing. The line is nil when the item is uncounted (nothing is made for it); why is ""
// on success, else StockBadCount.
func Sale(st *listings.Stock, src Record, id, key string, qty, nowMs int64) (*listings.StockLine, listings.StockFailure) {
	src.require()
	l := st.LineOf(id)
	if l == nil {
		return nil, ""
	}
	if !whole(qty) {
		return nil, listings.StockBadCount
	}
	settleOut(st, l, key, qty, nowMs)
	return l, ""
}

// Received is `received`: cumulative is the whole quantity received so far on the purchase order `key`; only the difference is added, a smaller or equal cumulative adds nothing. A
// delivery in another unit than the line's is refused (FailUnit); unit "" is "no unit given". A line with no unit takes the unit of its first delivery and keeps it.
func Received(st *listings.Stock, src Record, id, key string, cumulative int64, unit string, nowMs int64) (*listings.StockLine, listings.StockFailure) {
	src.require()
	l := st.LineOf(id)
	if l == nil {
		return nil, ""
	}
	if !whole(cumulative) {
		return nil, listings.StockBadCount
	}
	if l.Unit != "" && unit != "" && l.Unit != unit {
		return nil, FailUnit
	}
	prev, _ := l.AppliedGet(key)
	delta := cumulative - prev.Qty
	if delta <= 0 {
		return l, ""
	}
	if l.Unit == "" && unit != "" {
		l.Unit = unit
	}
	l.AppliedSet(key, listings.Applied{Qty: cumulative, Took: cumulative, AtMs: nowMs})
	l.Count = min(listings.MaxStockCount, l.Count+delta)
	l.NoteMove(listings.Movement{Kind: "received", Delta: delta, After: l.Count, AtMs: nowMs, By: by})
	st.WatchLow(l, nowMs)
	l.Prune(nowMs)
	return l, ""
}

// ---- Orders: what is held but not yet booked ------------------------------------------------------------------------------------------------------------

// OrderFact is one order line as the agent reads it from its own orders: the key its sale is booked under, the item, the quantity, whether the order STANDS (confirmed or completed),
// whether it was cancelled and whether it merely HOLDS stock. EndedMs is when the sale became final (an order's slot end); an order that ended at or before the line's start is HISTORY and
// never moves the count or counts as a hold. nil is "no end time".
type OrderFact struct {
	Key       string `json:"key"`
	ID        string `json:"id"`
	Qty       int64  `json:"qty"`
	Standing  bool   `json:"standing"`
	Cancelled bool   `json:"cancelled"`
	Holding   bool   `json:"holding"`
	EndedMs   *int64 `json:"endedMs,omitempty"`
}

// isHistory is `isHistory`: an order that ended before the line began, unless the line already booked it (then a cancel must still be able to give it back).
func isHistory(l *listings.StockLine, f OrderFact) bool {
	if f.EndedMs == nil || *f.EndedMs > l.StartedMs {
		return false
	}
	_, booked := l.AppliedGet(f.Key)
	return !booked
}

// ReconcileSales is `reconcileSales`: every order that stands is booked, every cancelled one is given back; orders absent from facts are never touched. Idempotent. Returns how many
// facts changed the count.
func ReconcileSales(st *listings.Stock, src Record, facts []OrderFact, nowMs int64) int {
	src.require()
	changed := 0
	for _, f := range facts {
		l := st.LineOf(f.ID)
		if l == nil {
			continue
		}
		var target int64
		switch {
		case f.Standing:
			target = f.Qty
		case f.Cancelled:
			target = 0
		default:
			continue
		}
		if isHistory(l, f) {
			continue
		}
		before, _ := l.AppliedGet(f.Key)
		if target == before.Qty {
			continue
		}
		settleOut(st, l, f.Key, target, nowMs)
		changed++
	}
	return changed
}

// UnbookedHolds is `unbookedHolds`: what orders hold of a counted item that is NOT yet in the count (holding or standing orders whose sale key has booked less than they want).
// exceptKey leaves out the order being checked ("" leaves none out).
func UnbookedHolds(st *listings.Stock, id string, facts []OrderFact, exceptKey string) int64 {
	l := st.LineOf(id)
	if l == nil {
		return 0
	}
	var n int64
	for _, f := range facts {
		if f.ID != id || f.Key == exceptKey || !(f.Holding || f.Standing) || isHistory(l, f) {
			continue
		}
		a, _ := l.AppliedGet(f.Key)
		if a.Qty < f.Qty {
			n += f.Qty - a.Qty
		}
	}
	return n
}

// ---- Stock orders: deliveries ---------------------------------------------------------------------------------------------------------------------------

// DeliveryFact is a delivery as the Stock orders agent reads it from a purchase order the owner marked received (a wrong item is not passed). AtMs is when the owner last marked something
// received; a total last marked BEFORE the line's start is HISTORY (the owner's count already has those goods). nil is "no time". Unit "" is "no unit".
type DeliveryFact struct {
	Key        string `json:"key"`
	ID         string `json:"id"`
	Cumulative int64  `json:"cumulative"`
	Unit       string `json:"unit,omitempty"`
	AtMs       *int64 `json:"atMs,omitempty"`
}

// ReconcileDeliveries is `reconcileDeliveries`: add every delivery not yet in the count. It returns the facts the stock newly refused (a unit that does not match, or a bad quantity; each
// reported once per quantity, remembered under "refused:<key>") so the agent can say so.
func ReconcileDeliveries(st *listings.Stock, src Record, facts []DeliveryFact, nowMs int64) []DeliveryFact {
	src.require()
	refused := []DeliveryFact{}
	for _, f := range facts {
		line := st.LineOf(f.ID)
		// goods that came before counting began are in the owner's count already: remember the total (so a later mark adds only the difference) and move nothing
		if line != nil && f.AtMs != nil && *f.AtMs < line.StartedMs {
			if _, seen := line.AppliedGet(f.Key); !seen {
				line.AppliedSet(f.Key, listings.Applied{Qty: f.Cumulative, Took: f.Cumulative, AtMs: nowMs})
				continue
			}
		}
		if _, why := Received(st, src, f.ID, f.Key, f.Cumulative, f.Unit, nowMs); why == "" {
			continue
		}
		l := st.LineOf(f.ID)
		if l == nil {
			continue
		}
		rk := "refused:" + f.Key
		if a, ok := l.AppliedGet(rk); !ok || a.Qty != f.Cumulative {
			l.AppliedSet(rk, listings.Applied{Qty: f.Cumulative, Took: 0, AtMs: nowMs})
			refused = append(refused, f)
		}
	}
	return refused
}

// ---- the low mark's alerts --------------------------------------------------------------------------------------------------------------------------------

// PendingAlerts is `pendingAlerts`: the alerts not yet shown whose line is of this kind ("" is every kind). Pure: it shows them without removing.
func PendingAlerts(st *listings.Stock, kind string) []listings.LowAlert {
	out := []listings.LowAlert{}
	if st == nil {
		return out
	}
	for _, a := range st.Alerts {
		if kind == "" || KindOf(a.Line) == kind {
			out = append(out, a)
		}
	}
	return out
}

// AckAlert is `ackAlert`: the card or line for this crossing has been made, so take it off the queue. A second call finds nothing and answers false.
func AckAlert(st *listings.Stock, line string, crossing int64) bool {
	before := len(st.Alerts)
	kept := make([]listings.LowAlert, 0, len(st.Alerts))
	for _, a := range st.Alerts {
		if !(a.Line == line && a.Crossing == crossing) {
			kept = append(kept, a)
		}
	}
	st.Alerts = kept
	return len(kept) < before
}

// NoteAsked is `noteAsked`: one more reorder question was started for this crossing; returns how many have been (0 when there is no such alert).
func NoteAsked(st *listings.Stock, line string, crossing int64) int64 {
	for i := range st.Alerts {
		a := &st.Alerts[i]
		if a.Line == line && a.Crossing == crossing {
			a.Asked++
			return a.Asked
		}
	}
	return 0
}

// LowRequestID is `lowRequestId`: the request id a reorder for one crossing carries ("low:supply:rice25#2"), so asking twice for the same crossing makes one order.
func LowRequestID(line string, crossing int64) string {
	return "low:" + line + "#" + strconv.FormatInt(crossing, 10)
}
