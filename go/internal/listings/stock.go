package listings

// The owner's Stock page, listings side (modules/stock/kit.ts): the shape check of the page's body (`checkOwnerStock`), the op as the queue keeps it, the op applied with the
// owner's authority (`applyOp`), and the listings a listings-only shop could count. The one stock count itself (the state under `assistant.stock`, every rule, the shop's own record
// of a sale or a delivery, the reads) is go/internal/stock, shared with Orders and Stock orders; the names below are aliases of it, so the runtime's call sites read as before.

import (
	"github.com/GeometerLabs/agents/go/internal/stock"
)

// The one stock count, from go/internal/stock.
type (
	Stock        = stock.Stock
	StockLine    = stock.Line
	LowAlert     = stock.LowAlert
	Movement     = stock.Movement
	Applied      = stock.Applied
	StockFailure = stock.Failure
	StockRow     = stock.Row
	ItemRef      = stock.ItemRef
	StockView    = stock.View
)

// Limits the page's check uses (stock.ts), and how long the page's own text may be before it is cut (kit.ts).
const (
	MaxStockCount  = stock.MaxCount
	maxStockNameIn = 80
	maxStockUnitIn = 40
)

const (
	StockBadID      = stock.BadID
	StockNoSuchLine = stock.NoSuchLine
)

// NewStock, IsStockID, KindOf, ListingStockID, StockRefs and StockViewOf are the shared package's.
func NewStock() *Stock                                   { return stock.New() }
func IsStockID(id string) bool                            { return stock.IsID(id) }
func KindOf(id string) string                             { return stock.KindOf(id) }
func ListingStockID(listingID string) string              { return stock.ListingID(listingID) }
func StockRefs(id, change, by string) map[string]string   { return stock.Refs(id, change, by) }
func StockViewOf(st *Stock, refs []ItemRef) StockView      { return stock.ViewOf(st, refs) }

// ---- the owner's ops ----------------------------------------------------------------------------------------------------------------------------------

// StockOp is one step on the owner's Stock page, after its shape was checked.
type StockOp struct {
	Op    string // start, correct, sold, low, stop
	ID    string
	Count float64      // start
	Low   Opt[float64] // start: Set when sent; low: Null clears it
	Name  string       // start, already cut to 80 UTF-16 units; "" is "not sent"
	Unit  string       // start, cut to 40
	To    float64      // correct
	Shown Opt[float64] // correct
	Qty   float64      // sold
}

// Event is the op as the queue keeps it: the TypeScript event's shape ({kind, id, op}), only the members that were sent.
func (o StockOp) Event(rid string) map[string]any {
	op := map[string]any{"op": o.Op, "id": o.ID}
	switch o.Op {
	case "start":
		op["count"] = o.Count
		if o.Low.Set {
			op["low"] = o.Low.V
		}
		if o.Name != "" {
			op["name"] = o.Name
		}
		if o.Unit != "" {
			op["unit"] = o.Unit
		}
	case "correct":
		op["to"] = o.To
		if o.Shown.Set {
			op["shown"] = o.Shown.V
		}
	case "sold":
		op["qty"] = o.Qty
	case "low":
		if o.Low.Null {
			op["low"] = nil
		} else {
			op["low"] = o.Low.V
		}
	}
	return map[string]any{"kind": "owner_stock", "id": rid, "op": op}
}

// CheckOwnerStock checks the body of POST /internal/channel/owner-stock for shape (kit.ts `checkOwnerStock`). The rules themselves (limits, ids) are applied again in the step.
func CheckOwnerStock(body any) (id string, op StockOp, errText string) {
	const sendShape = `Send {"id": a request id, "op": {...}}.`
	b, ok := isObj(body)
	if !ok {
		return "", StockOp{}, sendShape
	}
	rid, isStr := b["id"].(string)
	o, isO := isObj(b["op"])
	if !isStr || !requestID.MatchString(rid) || !isO {
		return "", StockOp{}, sendShape
	}
	itemID, isStr := o["id"].(string)
	if !isStr || !IsStockID(itemID) {
		return "", StockOp{}, "An item id looks like listing:l-3, menu:thali or supply:rice."
	}
	which, _ := o["op"].(string)
	switch which {
	case "start":
		count, okC := num(o["count"])
		x := StockOp{Op: which, ID: itemID, Count: count}
		if v, present := o["low"]; present {
			low, okL := num(v)
			if !okL {
				return "", StockOp{}, "count and low are numbers."
			}
			x.Low = Opt[float64]{Set: true, V: low}
		}
		if !okC {
			return "", StockOp{}, "count and low are numbers."
		}
		if s, ok := o["name"].(string); ok && hasNonSpace(s) {
			x.Name = utf16Slice(s, maxStockNameIn)
		}
		if s, ok := o["unit"].(string); ok && hasNonSpace(s) {
			x.Unit = utf16Slice(s, maxStockUnitIn)
		}
		return rid, x, ""
	case "correct":
		to, okT := num(o["to"])
		x := StockOp{Op: which, ID: itemID, To: to}
		if v, present := o["shown"]; present {
			sh, okS := num(v)
			if !okS {
				return "", StockOp{}, "to is the new count, a number."
			}
			x.Shown = Opt[float64]{Set: true, V: sh}
		}
		if !okT {
			return "", StockOp{}, "to is the new count, a number."
		}
		return rid, x, ""
	case "sold":
		qty, okQ := num(o["qty"])
		if !okQ {
			return "", StockOp{}, "qty is how many were sold, a number."
		}
		return rid, StockOp{Op: which, ID: itemID, Qty: qty}, ""
	case "low":
		if v, present := o["low"]; present && v == nil {
			return rid, StockOp{Op: which, ID: itemID, Low: Opt[float64]{Set: true, Null: true}}, ""
		}
		low, okL := num(o["low"])
		if !okL {
			return "", StockOp{}, "low is a number, or null to clear it."
		}
		return rid, StockOp{Op: which, ID: itemID, Low: Opt[float64]{Set: true, V: low}}, ""
	case "stop":
		return rid, StockOp{Op: which, ID: itemID}, ""
	}
	return "", StockOp{}, "op is one of start, correct, sold, low, stop."
}

// ApplyStockOp is kit.ts `applyOp`: the effect of one op on a state with the owner's authority, shared by the step (the real state) and the page's pre-check (a copy). On success
// it says what changed (the record's `change` word).
func ApplyStockOp(st *Stock, op StockOp, reqID string, nowMs int64) (change string, why StockFailure) {
	owner := stock.Owner("owner")
	opt := func(o Opt[float64]) *float64 {
		if !o.Set || o.Null {
			return nil
		}
		v := o.V
		return &v
	}
	switch op.Op {
	case "start":
		return "started", st.Start(owner, op.ID, stock.StartInput{Count: op.Count, Name: op.Name, Unit: op.Unit, Low: opt(op.Low)}, nowMs)
	case "correct":
		return "corrected", st.Correct(owner, op.ID, op.To, reqID, opt(op.Shown), nowMs)
	case "sold":
		return "sold", st.OwnerSold(owner, op.ID, op.Qty, reqID, nowMs)
	case "low":
		return "low_mark", st.SetLow(owner, op.ID, op.Low.V, op.Low.Null, nowMs)
	case "stop":
		return "stopped", st.Stop(owner, op.ID)
	}
	return "", StockBadID
}

// ListingRefs is `known`, for a listings-only shop: the live listings named in a language (liveListingTitles). A shop with no listings state yet has none.
func ListingRefs(s *State, lang string) []ItemRef {
	out := []ItemRef{}
	if s == nil {
		return out
	}
	for i := range s.Items {
		if s.Items[i].State == "live" {
			out = append(out, ItemRef{ID: ListingStockID(s.Items[i].ID), Name: TextIn(&s.Items[i], lang).Title})
		}
	}
	return out
}

