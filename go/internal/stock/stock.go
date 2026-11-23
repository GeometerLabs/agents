// Package stock is the shop's one stock count: the Go twin of modules/stock/stock.ts (block S, phase A3). ONE count per item the owner chooses to count, read by every part of
// the shop: a listing ("listing:l-3"), an Orders menu item ("menu:thali") and a Stock orders item ("supply:rice25"). The state is plain JSON kept under `assistant.stock`, saved in
// the same step as everything else; this package reads and writes it field for field as the TypeScript does, so a shop moves between the runtimes and loses nothing.
//
// It is shared by three users, which is why it is its own package (one source of truth, decision 61):
//   - the owner's Stock page (internal/listings/stock.go checks the page's body and calls the owner's acts here; internal/runtime runs them in the step);
//   - Orders (internal/orders, wave 2): Sale, ReconcileSales, UnbookedHolds and LeftFor, from typed facts of its own orders;
//   - Stock orders (internal/stockorders, wave 2): ReconcileDeliveries, PendingAlerts, AckAlert, NoteAsked and LowRequestID.
//
// What it promises, as stock.ts does: counting is optional per item (an uncounted item has no line and nothing here touches it); every effect is keyed (`sale:<order>:<item>`,
// `delivery:<po>`, `req:<request id>`) and a line remembers what each key did (`applied`), so a retry, a duplicate event or a restart cannot count twice; a count never goes below 0;
// a low mark fires once per crossing. WHO MAY WRITE: the TypeScript checks an `Authority` object (the owner's, the Operator's, the builder's) or a `ShopRecord` that only
// shopRecord() makes, at run time. Go has no such run-time token across packages; the same rule is kept by the type: every write takes a Source, whose fields are unexported, so only
// Owner(by) and ShopRecord() make one and a zero Source is refused (TypeScript throws there; here the write is refused with BadSource and changes nothing).
//
// Pure: no disk, no network, no clock (the caller says what time it is).
//
// Where Go and JavaScript differ, and which TypeScript behaviour is copied:
//   - lengths are UTF-16 code units (language.UTF16Len), `\s` is language.IsJSSpace;
//   - counts are int64; numbers that arrive as float64 (the page's) are checked whole (Number.isSafeInteger and the bounds) BEFORE they become counts;
//   - `applied` is a JavaScript object, whose keys keep the order they were made in; a Go map does not, so appliedMap keeps it (the prune drops "oldest first", ties in key order);
//   - the Stock page sorts by `name.localeCompare`: golang.org/x/text/collate with the English tailoring is the same CLDR order for the names a shop has.
package stock

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	lang "github.com/GeometerLabs/agents/go/internal/language"
)

const day = 24 * 3_600_000

// Limits and horizons, as stock.ts. FactHorizonMs < SafeKeepMs < AppliedKeptMs: a key always outlives every fact that can name it.
const (
	MaxLines      = 300
	MaxCount      = 1_000_000
	MaxMoves      = 30
	MaxApplied    = 5000
	FactHorizonMs = 30 * day
	SafeKeepMs    = 45 * day
	AppliedKeptMs = 120 * day
	MaxAlerts     = 50
	MaxName       = 60
	MaxUnit       = 20
	alertKeptMs   = 30 * day
	requestKey    = "req:"
	// Action is the record's action for a stock line (STOCK_ACTION).
	Action = "stock"
)

// Failure is why a write was refused (stock.ts `Failure`). BadSource has no TypeScript word: there the write throws.
type Failure string

const (
	BadID      Failure = "bad_id"
	BadCount   Failure = "bad_count"
	BadLow     Failure = "bad_low"
	BadText    Failure = "bad_text"
	Exists     Failure = "exists"
	Full       Failure = "full"
	NoSuchLine Failure = "no_such_line"
	Stale      Failure = "stale"
	Unit       Failure = "unit"
	BadSource  Failure = "bad_source"
)

// ---- ids ----------------------------------------------------------------------------------------------------------------------------------------------

var idRe = regexp.MustCompile(`^(listing|menu|supply):[A-Za-z0-9._-]{1,64}$`)

// IsID is `isStockId`.
func IsID(id string) bool { return idRe.MatchString(id) }

// KindOf is the kind in an item id's prefix ("listing", "menu", "supply"), "" when it is not an id.
func KindOf(id string) string {
	if !IsID(id) {
		return ""
	}
	return id[:strings.Index(id, ":")]
}

// ListingID, MenuID and SupplyID are `listingStockId`, `menuStockId`, `supplyStockId`.
func ListingID(listingID string) string { return "listing:" + listingID }
func MenuID(itemID string) string       { return "menu:" + itemID }
func SupplyID(itemID string) string     { return "supply:" + itemID }

// ---- who may write ------------------------------------------------------------------------------------------------------------------------------------

// Source is who a write comes from: the owner's own act (by "owner", "operator" or "builder") or the shop's own record of a sale or a delivery (by "shop"). Its fields are
// unexported so only Owner and ShopRecord make one; a zero Source writes nothing.
type Source struct {
	by   string
	shop bool
}

// Owner is the owner's (or the Operator's, or the builder's) own act: `Authority` in TypeScript.
func Owner(by string) Source {
	if by != "owner" && by != "operator" && by != "builder" {
		return Source{}
	}
	return Source{by: by}
}

// ShopRecord is `shopRecord(from)`: only an agent's own reconcile step calls it, with facts read from its own orders (never from anyone's words).
func ShopRecord() Source { return Source{by: "shop", shop: true} }

func (s Source) ok() bool      { return s.by != "" }
func (s Source) isOwner() bool { return s.ok() && !s.shop }

// ---- the state ----------------------------------------------------------------------------------------------------------------------------------------

// Applied is what a key has already done: the quantity it stands for and how much of that really came off the count.
type Applied struct {
	Qty  int64 `json:"qty"`
	Took int64 `json:"took"`
	AtMs int64 `json:"atMs"`
}

// appliedMap is a JavaScript object of Applied by key: JSON in the order the keys were made (a Go map would write them sorted, and the prune's tie-break depends on the order).
type appliedMap struct {
	keys []string
	m    map[string]Applied
}

// Get is one key's entry.
func (a *appliedMap) Get(k string) (Applied, bool) { v, ok := a.m[k]; return v, ok }

// Len is how many keys the line remembers.
func (a *appliedMap) Len() int { return len(a.keys) }

func (a *appliedMap) set(k string, v Applied) {
	if a.m == nil {
		a.m = map[string]Applied{}
	}
	if _, ok := a.m[k]; !ok {
		a.keys = append(a.keys, k)
	}
	a.m[k] = v
}

func (a *appliedMap) del(k string) {
	if _, ok := a.m[k]; !ok {
		return
	}
	delete(a.m, k)
	for i, x := range a.keys {
		if x == k {
			a.keys = append(a.keys[:i], a.keys[i+1:]...)
			break
		}
	}
}

func (a appliedMap) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range a.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		vb, err := json.Marshal(a.m[k])
		if err != nil {
			return nil, err
		}
		b.Write(kb)
		b.WriteByte(':')
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func (a *appliedMap) UnmarshalJSON(raw []byte) error {
	*a = appliedMap{}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil // null or anything else: no keys, as a state with no `applied` reads
	}
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return err
		}
		var v Applied
		if err := dec.Decode(&v); err != nil {
			return err
		}
		a.set(kt.(string), v)
	}
	return nil
}

// Movement is one change to a count, kept for the owner's history.
type Movement struct {
	Kind  string `json:"kind"` // started, sold, returned, received, corrected
	Delta int64  `json:"delta"`
	After int64  `json:"after"`
	AtMs  int64  `json:"atMs"`
	By    string `json:"by"`
	Short int64  `json:"short,omitempty"`
}

// Line is one counted item (StockLine).
type Line struct {
	ID        string     `json:"id"`
	Name      string     `json:"name,omitempty"`
	Unit      string     `json:"unit,omitempty"`
	Count     int64      `json:"count"`
	Low       *int64     `json:"low,omitempty"`
	LowFlag   bool       `json:"lowFlag"`
	Crossings int64      `json:"crossings"`
	Aliases   []string   `json:"aliases,omitempty"`
	Applied   appliedMap `json:"applied"`
	Moves     []Movement `json:"moves"`
	StartedMs int64      `json:"startedMs"`
}

// LowAlert is one "this item is low" waiting to be shown; Asked counts the reorder questions started for it (a Stock orders agent gives up after a few).
type LowAlert struct {
	Line     string `json:"line"`
	Crossing int64  `json:"crossing"`
	Count    int64  `json:"count"`
	AtMs     int64  `json:"atMs"`
	Asked    int64  `json:"asked,omitempty"`
}

// Stock is the one stock count's state (assistant.stock, StockState).
type Stock struct {
	Lines  []Line     `json:"lines"`
	Alerts []LowAlert `json:"alerts"`
}

// New is `emptyStock`.
func New() *Stock { return &Stock{Lines: []Line{}, Alerts: []LowAlert{}} }

// Fix makes the lists non-nil after a read, so they are written as [] and never null (a state from before a member existed reads as empty).
func (st *Stock) Fix() {
	if st.Lines == nil {
		st.Lines = []Line{}
	}
	if st.Alerts == nil {
		st.Alerts = []LowAlert{}
	}
	for i := range st.Lines {
		if st.Lines[i].Moves == nil {
			st.Lines[i].Moves = []Movement{}
		}
		if st.Lines[i].Applied.m == nil {
			st.Lines[i].Applied = appliedMap{m: map[string]Applied{}}
		}
	}
}

// Clone is `structuredClone`: the page's pre-check works on a copy.
func (st *Stock) Clone() *Stock {
	if st == nil {
		return New()
	}
	b, _ := json.Marshal(st)
	out := &Stock{}
	_ = json.Unmarshal(b, out)
	out.Fix()
	return out
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------

// LineOf is `lineOf`: the line an id names by its own id, else by an alias (the own id wins across all lines). Nil: the item is uncounted.
func (st *Stock) LineOf(id string) *Line {
	if st == nil {
		return nil
	}
	for i := range st.Lines {
		if st.Lines[i].ID == id {
			return &st.Lines[i]
		}
	}
	for i := range st.Lines {
		for _, a := range st.Lines[i].Aliases {
			if a == id {
				return &st.Lines[i]
			}
		}
	}
	return nil
}

// CountOf is `countOf`: the count of a counted item.
func (st *Stock) CountOf(id string) (int64, bool) {
	if l := st.LineOf(id); l != nil {
		return l.Count, true
	}
	return 0, false
}

// Count is the count of a listing (`quantityOfListing`).
func (st *Stock) Count(listingID string) (int64, bool) { return st.CountOf(ListingID(listingID)) }

// LeftFor is `leftFor`: how many of a counted item can still be taken now, the count less what orders hold that is not yet booked (held). false: uncounted.
func (st *Stock) LeftFor(id string, held int64) (int64, bool) {
	l := st.LineOf(id)
	if l == nil {
		return 0, false
	}
	return max(0, l.Count-held), true
}

// SoldOut is `soldOutListings`: the ids of listings whose line is counted and at 0.
func (st *Stock) SoldOut() map[string]bool {
	out := map[string]bool{}
	if st == nil {
		return out
	}
	for _, l := range st.Lines {
		if l.Count > 0 {
			continue
		}
		for _, id := range append([]string{l.ID}, l.Aliases...) {
			if strings.HasPrefix(id, "listing:") {
				out[id[len("listing:"):]] = true
			}
		}
	}
	return out
}

// LowLines is `lowLines`: lines at or under their low mark the owner was told of this crossing, except one kind ("" leaves none out).
func (st *Stock) LowLines(except string) []*Line {
	var out []*Line
	if st == nil {
		return out
	}
	for i := range st.Lines {
		if st.Lines[i].LowFlag && (except == "" || KindOf(st.Lines[i].ID) != except) {
			out = append(out, &st.Lines[i])
		}
	}
	return out
}

// whole is stock.ts `whole`: a safe integer from 0 to max (every max here is far under 2^53, so the bound is the safe-integer test).
func whole(f float64, max int64) bool { return f == math.Trunc(f) && f >= 0 && f <= float64(max) }

// clean is stock.ts `clean`: every run of JavaScript white space one space, trimmed.
func clean(s string) string {
	return strings.Join(strings.FieldsFunc(s, lang.IsJSSpace), " ")
}

// ---- the owner's own acts -----------------------------------------------------------------------------------------------------------------------------

// StartInput is `StartInput`; numbers as the page sent them (checked whole here). Low nil: no low mark; Name and Unit "": not given.
type StartInput struct {
	Count   float64
	Name    string
	Unit    string
	Low     *float64
	Aliases []string
}

// Start is `startCounting`: the owner chooses to count an item. An item already counted is refused (use Correct).
func (st *Stock) Start(src Source, id string, in StartInput, nowMs int64) Failure {
	if !src.isOwner() {
		return BadSource
	}
	if !IsID(id) {
		return BadID
	}
	if !whole(in.Count, MaxCount) {
		return BadCount
	}
	if in.Low != nil && !whole(*in.Low, MaxCount) {
		return BadLow
	}
	name, unit := clean(in.Name), clean(in.Unit)
	if lang.UTF16Len(name) > MaxName || lang.UTF16Len(unit) > MaxUnit {
		return BadText
	}
	var aliases []string
	for _, a := range in.Aliases {
		if IsID(a) && a != id {
			aliases = append(aliases, a)
		}
	}
	if len(aliases) != len(in.Aliases) {
		return BadID
	}
	for _, x := range append([]string{id}, aliases...) {
		if st.LineOf(x) != nil {
			return Exists
		}
	}
	if len(st.Lines) >= MaxLines {
		return Full
	}
	count := int64(in.Count)
	line := Line{ID: id, Name: name, Unit: unit, Count: count, Aliases: aliases, Applied: appliedMap{m: map[string]Applied{}}, StartedMs: nowMs,
		Moves: []Movement{{Kind: "started", Delta: count, After: count, AtMs: nowMs, By: src.by}}}
	if in.Low != nil {
		low := int64(*in.Low)
		line.Low = &low
	}
	st.Lines = append(st.Lines, line)
	st.watchLow(&st.Lines[len(st.Lines)-1], nowMs)
	return ""
}

// Stop is `stopCounting`: the line goes, and the item behaves as an uncounted one again.
func (st *Stock) Stop(src Source, id string) Failure {
	if !src.isOwner() {
		return BadSource
	}
	l := st.LineOf(id)
	if l == nil {
		return NoSuchLine
	}
	lid := l.ID
	lines := make([]Line, 0, len(st.Lines))
	for i := range st.Lines {
		if st.Lines[i].ID != lid {
			lines = append(lines, st.Lines[i])
		}
	}
	st.Lines = lines
	st.dropAlerts(lid)
	return ""
}

func (st *Stock) dropAlerts(lineID string) {
	alerts := make([]LowAlert, 0, len(st.Alerts))
	for _, a := range st.Alerts {
		if a.Line != lineID {
			alerts = append(alerts, a)
		}
	}
	st.Alerts = alerts
}

// SetLow is `setLow`: the owner's low mark, or clear it (TypeScript's `null`).
func (st *Stock) SetLow(src Source, id string, low float64, clear bool, nowMs int64) Failure {
	if !src.isOwner() {
		return BadSource
	}
	l := st.LineOf(id)
	if l == nil {
		return NoSuchLine
	}
	if !clear && !whole(low, MaxCount) {
		return BadLow
	}
	if clear {
		l.Low, l.LowFlag = nil, false
		st.dropAlerts(l.ID)
	} else {
		v := int64(low)
		l.Low = &v
	}
	st.watchLow(l, nowMs)
	return ""
}

// Correct is `correct`: the owner's own count. reqID is the page's request id, so a retry does nothing. shown (nil: not sent) is the count the owner was looking at: if the
// count moved since, the correction is refused as stale rather than overwriting it.
func (st *Stock) Correct(src Source, id string, to float64, reqID string, shown *float64, nowMs int64) Failure {
	if !src.isOwner() {
		return BadSource
	}
	l := st.LineOf(id)
	if l == nil {
		return NoSuchLine
	}
	if !whole(to, MaxCount) {
		return BadCount
	}
	key := requestKey + reqID
	if _, done := l.Applied.Get(key); done {
		return ""
	}
	if shown != nil && *shown != float64(l.Count) {
		return Stale
	}
	target := int64(to)
	delta := target - l.Count
	l.Applied.set(key, Applied{Qty: target, Took: 0, AtMs: nowMs})
	l.Count = target
	l.noteMove(Movement{Kind: "corrected", Delta: delta, After: l.Count, AtMs: nowMs, By: src.by})
	st.watchLow(l, nowMs)
	l.prune(nowMs)
	return ""
}

// OwnerSold is `ownerSold`: "sold 2", the same keyed sale as an order's, so a retry with the same request id takes nothing more.
func (st *Stock) OwnerSold(src Source, id string, qty float64, reqID string, nowMs int64) Failure {
	if !src.isOwner() {
		return BadSource
	}
	l := st.LineOf(id)
	if l == nil {
		return NoSuchLine
	}
	if !whole(qty, MaxCount) || qty < 1 {
		return BadCount
	}
	st.settleOut(l, requestKey+reqID, int64(qty), src, nowMs)
	return ""
}

// RestoreAfterYes is `restoreAfterYes`: "Yes, I still have it" about a listing that sold itself at 0. The count is set to the number the owner first said (0: none said, so 1),
// by the owner's authority. Anything else is left alone. True when the count was set (or the same request had already set it, as Correct answers).
func (st *Stock) RestoreAfterYes(listingID string, firstQty int64, reqID string, nowMs int64) bool {
	if st == nil {
		return false
	}
	l := st.LineOf(ListingID(listingID))
	if l == nil || l.Count != 0 {
		return false
	}
	to := firstQty
	if to == 0 {
		to = 1
	}
	return st.Correct(Owner("owner"), ListingID(listingID), float64(to), reqID, nil, nowMs) == ""
}

// ---- the shop's own record of a sale or a delivery ----------------------------------------------------------------------------------------------------

// Sale is `sale`: the order `key` stands for qty of the item (target semantics). The same key and qty again changes nothing; a larger qty takes the difference; a smaller one (or 0,
// a cancelled order) gives back what was taken. An uncounted item is skipped (nil line, no failure).
func (st *Stock) Sale(src Source, id, key string, qty int64, nowMs int64) (*Line, Failure) {
	if !src.ok() {
		return nil, BadSource
	}
	l := st.LineOf(id)
	if l == nil {
		return nil, ""
	}
	if qty < 0 || qty > MaxCount {
		return nil, BadCount
	}
	st.settleOut(l, key, qty, src, nowMs)
	return l, ""
}

// Received is `received`: cumulative is the whole quantity received so far on the purchase order `key`; only the difference is added. A delivery in another unit than the line's is
// refused: a unit is never converted. unit "" is "not said".
func (st *Stock) Received(src Source, id, key string, cumulative int64, unit string, nowMs int64) (*Line, Failure) {
	if !src.ok() {
		return nil, BadSource
	}
	l := st.LineOf(id)
	if l == nil {
		return nil, ""
	}
	if cumulative < 0 || cumulative > MaxCount {
		return nil, BadCount
	}
	if l.Unit != "" && unit != "" && l.Unit != unit {
		return nil, Unit
	}
	prev, _ := l.Applied.Get(key)
	delta := cumulative - prev.Qty
	if delta <= 0 {
		return l, ""
	}
	// a line started with no unit takes the unit of its first delivery and keeps it, so boxes and pieces of the same item are never added together
	if l.Unit == "" && unit != "" {
		l.Unit = unit
	}
	l.Applied.set(key, Applied{Qty: cumulative, Took: cumulative, AtMs: nowMs})
	l.Count = min(MaxCount, l.Count+delta)
	l.noteMove(Movement{Kind: "received", Delta: delta, After: l.Count, AtMs: nowMs, By: src.by})
	st.watchLow(l, nowMs)
	l.prune(nowMs)
	return l, ""
}

// settleOut is `settleOut`: the key stands for target of the item. A sale larger than the count takes what is there and notes the shortfall; a smaller target gives back what
// the key really took.
func (st *Stock) settleOut(l *Line, key string, target int64, src Source, nowMs int64) {
	prev, ok := l.Applied.Get(key)
	if !ok {
		prev = Applied{AtMs: nowMs}
	}
	if target == prev.Qty {
		return
	}
	if target > prev.Qty {
		want := target - prev.Qty
		took := min(want, l.Count)
		l.Count -= took
		l.Applied.set(key, Applied{Qty: target, Took: prev.Took + took, AtMs: nowMs})
		m := Movement{Kind: "sold", Delta: -took, After: l.Count, AtMs: nowMs, By: src.by}
		if took < want {
			m.Short = want - took
		}
		l.noteMove(m)
	} else {
		back := min(prev.Took, prev.Qty-target)
		l.Count = min(MaxCount, l.Count+back)
		l.Applied.set(key, Applied{Qty: target, Took: prev.Took - back, AtMs: nowMs})
		l.noteMove(Movement{Kind: "returned", Delta: back, After: l.Count, AtMs: nowMs, By: src.by})
	}
	st.watchLow(l, nowMs)
	l.prune(nowMs)
}

// OrderFact is `OrderFact`: one order line as an agent reads it from its own orders. EndedMs 0 is "not said".
type OrderFact struct {
	Key       string
	ID        string
	Qty       int64
	Standing  bool
	Cancelled bool
	Holding   bool
	EndedMs   int64
}

// isHistory: an order that ended before the line began is history, unless the line already booked it (then a cancel must still be able to give it back).
func isHistory(l *Line, f OrderFact) bool {
	_, booked := l.Applied.Get(f.Key)
	return f.EndedMs != 0 && f.EndedMs <= l.StartedMs && !booked
}

// ReconcileSales is `reconcileSales`: every order that stands is booked, every cancelled one is given back; orders absent from facts are never touched. It returns how many
// changed; running it again with the same facts changes nothing.
func (st *Stock) ReconcileSales(src Source, facts []OrderFact, nowMs int64) int {
	if !src.ok() {
		return 0
	}
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
		before, _ := l.Applied.Get(f.Key)
		if target == before.Qty {
			continue
		}
		st.settleOut(l, f.Key, target, src, nowMs)
		changed++
	}
	return changed
}

// UnbookedHolds is `unbookedHolds`: what orders hold of a counted item that is NOT yet in the count. exceptKey leaves out the order being checked.
func (st *Stock) UnbookedHolds(id string, facts []OrderFact, exceptKey string) int64 {
	l := st.LineOf(id)
	if l == nil {
		return 0
	}
	var n int64
	for _, f := range facts {
		a, _ := l.Applied.Get(f.Key)
		if f.ID == id && f.Key != exceptKey && (f.Holding || f.Standing) && !isHistory(l, f) && a.Qty < f.Qty {
			n += f.Qty - a.Qty
		}
	}
	return n
}

// DeliveryFact is `DeliveryFact`: a delivery as the Stock orders agent reads it from a purchase order the owner marked received. Unit "" and AtMs nil are "not said".
type DeliveryFact struct {
	Key        string
	ID         string
	Cumulative int64
	Unit       string
	AtMs       *int64
}

// ReconcileDeliveries is `reconcileDeliveries`: every delivery not yet in the count is added once. It returns the facts the count newly refused (a unit that does not match),
// each reported once per delivered quantity (the line remembers it under "refused:<key>").
func (st *Stock) ReconcileDeliveries(src Source, facts []DeliveryFact, nowMs int64) []DeliveryFact {
	var refused []DeliveryFact
	if !src.ok() {
		return refused
	}
	for _, f := range facts {
		line := st.LineOf(f.ID)
		// goods that came before counting began are in the owner's count already: remember the total (so a later mark adds only the difference) and move nothing
		if line != nil && f.AtMs != nil && *f.AtMs < line.StartedMs {
			if _, booked := line.Applied.Get(f.Key); !booked {
				line.Applied.set(f.Key, Applied{Qty: f.Cumulative, Took: f.Cumulative, AtMs: nowMs})
				continue
			}
		}
		if _, why := st.Received(src, f.ID, f.Key, f.Cumulative, f.Unit, nowMs); why == "" {
			continue
		}
		l := st.LineOf(f.ID)
		if l == nil {
			continue
		}
		if prev, ok := l.Applied.Get("refused:" + f.Key); !ok || prev.Qty != f.Cumulative {
			l.Applied.set("refused:"+f.Key, Applied{Qty: f.Cumulative, Took: 0, AtMs: nowMs})
			refused = append(refused, f)
		}
	}
	return refused
}

// ---- the low mark: once per crossing ------------------------------------------------------------------------------------------------------------------

func (st *Stock) watchLow(l *Line, nowMs int64) {
	if l.Low == nil {
		l.LowFlag = false
		return
	}
	if l.Count <= *l.Low && !l.LowFlag {
		l.LowFlag = true
		l.Crossings++
		st.Alerts = append(st.Alerts, LowAlert{Line: l.ID, Crossing: l.Crossings, Count: l.Count, AtMs: nowMs})
		if len(st.Alerts) > MaxAlerts {
			st.Alerts = append([]LowAlert{}, st.Alerts[len(st.Alerts)-MaxAlerts:]...)
		}
	} else if l.Count > *l.Low && l.LowFlag {
		l.LowFlag = false
	}
}

// PendingAlerts is `pendingAlerts`: the alerts not yet shown whose line is of this kind ("" any), copied, without removing them.
func (st *Stock) PendingAlerts(kind string) []LowAlert {
	out := []LowAlert{}
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

// AckAlert is `ackAlert`: the card or line for this crossing has been made; take it off the queue. A second call finds nothing.
func (st *Stock) AckAlert(line string, crossing int64) bool {
	before := len(st.Alerts)
	kept := make([]LowAlert, 0, len(st.Alerts))
	for _, a := range st.Alerts {
		if !(a.Line == line && a.Crossing == crossing) {
			kept = append(kept, a)
		}
	}
	st.Alerts = kept
	return len(st.Alerts) < before
}

// NoteAsked is `noteAsked`: one more reorder question was started for this crossing; how many have been (0: no such alert).
func (st *Stock) NoteAsked(line string, crossing int64) int64 {
	for i := range st.Alerts {
		if st.Alerts[i].Line == line && st.Alerts[i].Crossing == crossing {
			st.Alerts[i].Asked++
			return st.Alerts[i].Asked
		}
	}
	return 0
}

// LowRequestID is `lowRequestId`: the request id a reorder for one crossing carries, "low:supply:rice25#2".
func LowRequestID(line string, crossing int64) string {
	return "low:" + line + "#" + itoa(crossing)
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

// ---- keeping the state small --------------------------------------------------------------------------------------------------------------------------

func (l *Line) noteMove(m Movement) {
	l.Moves = append(l.Moves, m)
	if len(l.Moves) > MaxMoves {
		l.Moves = append([]Movement{}, l.Moves[len(l.Moves)-MaxMoves:]...)
	}
}

// prune: past the soft cap only keys older than SafeKeepMs go, oldest first (a stable sort, as JavaScript's), so a key an order or delivery can still name is never dropped.
func (l *Line) prune(nowMs int64) {
	if len(l.Applied.keys) <= MaxApplied {
		return
	}
	var old []string
	for _, k := range l.Applied.keys {
		if nowMs-l.Applied.m[k].AtMs > SafeKeepMs {
			old = append(old, k)
		}
	}
	sort.SliceStable(old, func(i, j int) bool { return l.Applied.m[old[i]].AtMs < l.Applied.m[old[j]].AtMs })
	n := min(len(l.Applied.keys)-MaxApplied, len(old))
	for _, k := range old[:n] {
		l.Applied.del(k)
	}
}

// Tidy is `tidyStock`, on the daily clean-up: forget keys old enough that their order or delivery cannot change any more, and alerts older than 30 days.
func (st *Stock) Tidy(nowMs int64) {
	for i := range st.Lines {
		l := &st.Lines[i]
		for _, k := range append([]string(nil), l.Applied.keys...) {
			if nowMs-l.Applied.m[k].AtMs > AppliedKeptMs {
				l.Applied.del(k)
			}
		}
	}
	alerts := make([]LowAlert, 0, len(st.Alerts))
	for _, a := range st.Alerts {
		if nowMs-a.AtMs < alertKeptMs {
			alerts = append(alerts, a)
		}
	}
	st.Alerts = alerts
}

// ---- the record and the owner's Stock page ------------------------------------------------------------------------------------------------------------

// Refs is `stockRefs`: what a `stock` line of the record carries (the item's id and kind, what changed, who).
func Refs(id, change, by string) map[string]string {
	return map[string]string{"item": id, "kind": KindOf(id), "change": change, "by": by}
}

// Row is one counted item as the owner's Stock page lists it (StockRow).
type Row struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Unit    string     `json:"unit,omitempty"`
	Count   int64      `json:"count"`
	Low     *int64     `json:"low,omitempty"`
	IsLow   bool       `json:"isLow"`
	SoldOut bool       `json:"soldOut"`
	Kind    string     `json:"kind"`
	Moves   []Movement `json:"moves"`
}

// ItemRef is an item the owner could start counting: its id and its name in the owner's language, with the unit when the item has one.
type ItemRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit,omitempty"`
}

// View is the owner's Stock page's data (kit.ts ownerView).
type View struct {
	Rows       []Row     `json:"rows"`
	Candidates []ItemRef `json:"candidates"`
	Attention  int       `json:"attention"`
}

// ViewOf is kit.ts `ownerView`: rows (sold out first, then low, then by name), the items not counted yet, and how many need attention.
func ViewOf(st *Stock, refs []ItemRef) View {
	nameOf := func(id string) (string, bool) {
		for _, r := range refs {
			if r.ID == id {
				return r.Name, true
			}
		}
		return "", false
	}
	rows := []Row{}
	if st != nil {
		for _, l := range st.Lines {
			name := l.Name
			if name == "" {
				if n, ok := nameOf(l.ID); ok {
					name = n
				} else {
					name = l.ID
				}
			}
			kind := KindOf(l.ID)
			if kind == "" {
				kind = "listing"
			}
			last := l.Moves
			if len(last) > 5 {
				last = last[len(last)-5:]
			}
			moves := make([]Movement, 0, len(last))
			for i := len(last) - 1; i >= 0; i-- {
				moves = append(moves, last[i])
			}
			rows = append(rows, Row{ID: l.ID, Name: name, Unit: l.Unit, Count: l.Count, Low: l.Low, IsLow: l.LowFlag, SoldOut: l.Count <= 0, Kind: kind, Moves: moves})
		}
	}
	coll := collate.New(language.English) // not safe to share between goroutines, so one per read
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.SoldOut != b.SoldOut {
			return a.SoldOut
		}
		if a.IsLow != b.IsLow {
			return a.IsLow
		}
		return coll.CompareString(a.Name, b.Name) < 0
	})
	cands := []ItemRef{}
	for _, r := range refs {
		if st.LineOf(r.ID) == nil {
			cands = append(cands, r)
		}
	}
	attention := 0
	for _, r := range rows {
		if r.IsLow || r.SoldOut {
			attention++
		}
	}
	return View{Rows: rows, Candidates: cands, Attention: attention}
}
