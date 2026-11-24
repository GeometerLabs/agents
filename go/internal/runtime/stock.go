package runtime

// The owner's Stock page in the runtime (modules/stock/kit.ts `run`/`check`/`ownerView`, modules/runtime/core.ts, http.ts `/internal/channel/owner-stock`): the step that runs one
// `owner_stock` event on the saved state and writes its record line, the reads of the last saved state, the Confirm button's stock side (`restoreAfterYes`), and the route. The rules
// themselves are in listings/stock.go; this file only wires them to the step, the record and the HTTP layer, so the two big files (runtime.go, server.go) change by a line each.

import (
	"fmt"
	"net/http"

	"github.com/GeometerLabs/agents/go/internal/listings"
)

// touchStock is `stockOf(store.assistant ??= ...)`: the assistant's state and an empty stock count are made on first use. Unlike Touch it makes no listings state (TypeScript's stock
// kit does not either).
func (s *Snap) touchStock() *listings.Stock {
	s.ensureA()
	if s.Stock == nil {
		s.Stock = listings.NewStock()
	}
	return s.Stock
}

// listingRefs is `known` for a listings-only shop: the live listings named in a language (the shop has no menu or supply items).
func (s *Snap) listingRefs(lang string) []listings.ItemRef {
	if !s.hasList {
		return []listings.ItemRef{}
	}
	return listings.ListingRefs(&s.Listings, lang)
}

// ownerStock is kit.ts `run`: one op of the owner's Stock page, and its line in the record.
func (r *Runtime) ownerStock(snap *Snap, rec *recorder, ev map[string]any, now int64) {
	number, lang := r.owner()
	rid, op, _ := listings.CheckOwnerStock(map[string]any{"id": ev["id"], "op": ev["op"]})
	st := snap.touchStock()
	// a new line takes the item's own name when the page did not send one, so the Stock page says the item's name (kit.ts `fixed`)
	if op.Op == "start" && op.Name == "" {
		for _, ref := range r.stockRefs(snap, lang) {
			if ref.ID == op.ID {
				op.Name = ref.Name
				break
			}
		}
	}
	// decision 65: in a shop of several parts an item two parts know by one id is ONE count (the line is the supplier's item, so Stock orders' low mark reorders it)
	if sa, ok := r.o.Kit.(StockAliaser); ok && op.Op == "start" {
		op.ID, op.Aliases = sa.StockAliases(op.ID, lang)
	}
	change, why := listings.ApplyStockOp(st, op, rid, now)
	if why != "" {
		rec.append(NewLine{Conversation: number, Action: "stock", Outcome: "blocked", Inputs: map[string]any{"op": op.Op, "item": op.ID, "why": string(why)}, Language: lang,
			Refs: listings.StockRefs(op.ID, "corrected", "owner"), Notes: fmt.Sprintf("the owner's Stock page asked for something the rules refuse (%s); nothing changed", why)})
		return
	}
	inputs := map[string]any{"op": op.Op, "item": op.ID}
	switch op.Op { // the same members the TypeScript line carries ("count" in op, "to" in op, ...), as whole numbers
	case "start":
		inputs["count"] = int64(op.Count)
	case "correct":
		inputs["to"] = int64(op.To)
	case "sold":
		inputs["qty"] = int64(op.Qty)
	case "low":
		if op.Low.Null {
			inputs["low"] = nil
		} else {
			inputs["low"] = int64(op.Low.V)
		}
	}
	if op.Op == "start" && op.Low.Set { // a start op's own `low` is in its inputs too (`"low" in op`)
		inputs["low"] = int64(op.Low.V)
	}
	rec.append(NewLine{Conversation: number, Action: "stock", Outcome: "confirmed", Inputs: inputs, Language: lang, Refs: listings.StockRefs(op.ID, change, "owner"), Notes: "the owner changed their stock count in their app"})
}

// restoreAfterConfirm is the Confirm button's stock side (modules/listings/kit.ts): for a counted listing that sold itself at 0 the count is set to the number the owner first said,
// or 1, and a stock line says so. It runs after the listing's own rule and BEFORE the listing's record line, as the TypeScript does.
func (r *Runtime) restoreAfterConfirm(snap *Snap, rec *recorder, l *listings.Listing, eventID string, now int64) {
	if snap.Stock == nil || !snap.Stock.RestoreAfterYes(l.ID, l.Qty, "confirm-"+eventID, now) {
		return
	}
	number, lang := r.owner()
	item := listings.ListingStockID(l.ID)
	rec.append(NewLine{Conversation: number, Action: "stock", Outcome: "confirmed", Inputs: map[string]any{"op": "correct", "item": item}, Language: lang,
		Refs: listings.StockRefs(item, "corrected", "owner"), Notes: "the owner confirmed a listing that had sold itself at 0, so its count was set to the number they first said"})
}

// StockView is the owner's Stock page's data, from the last saved state, in a language ("" is the owner's own).
func (r *Runtime) StockView(lang string) listings.StockView {
	if lang == "" {
		_, lang = r.owner()
	}
	s := r.current()
	return listings.StockViewOf(s.Stock, r.stockRefs(s, lang))
}

// StockCheck is `check`: what an op would do now on a copy of the saved state, "" when it would work.
func (r *Runtime) StockCheck(rid string, op listings.StockOp) listings.StockFailure {
	_, why := listings.ApplyStockOp(r.current().Stock.Clone(), op, rid, r.o.Now())
	return why
}

// ownerStockRoute is http.ts `/internal/channel/owner-stock`: the owner's credential, then GET (the page's data, `?lang=` picks a language) or POST (one op, checked now so the page
// can say why before anything is saved, then run in a step).
func (s *Server) ownerStockRoute(w http.ResponseWriter, r *http.Request) error {
	if !s.ownerAuthorised(r) {
		send(w, 403, errBody(ownerRefused))
		return nil
	}
	if r.Method == "GET" {
		lang := r.URL.Query().Get("lang")
		switch lang {
		case "hi", "en", "ml", "kn":
		default:
			lang = "" // not a language we have: the owner's own, as TypeScript's `LANGUAGES.includes`
		}
		send(w, 200, s.rt.StockView(lang))
		return nil
	}
	if err := only(r, "POST"); err != nil {
		return err
	}
	body, ok := readJSON(w, r, 4*1024)
	if !ok {
		return nil
	}
	rid, op, why := listings.CheckOwnerStock(body)
	if why != "" {
		send(w, 400, errBody(why))
		return nil
	}
	if f := s.rt.StockCheck(rid, op); f != "" {
		send(w, 422, map[string]any{"why": string(f), "error": fmt.Sprintf("The shop's rules refuse that (%s).", f)})
		return nil
	}
	saved, dup, err := s.rt.Submit([]map[string]any{op.Event(rid)})
	if err != nil {
		return err
	}
	send(w, 200, map[string]any{"saved": saved, "duplicates": dup})
	s.rt.Kick()
	return nil
}
