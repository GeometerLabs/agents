package listings

// The shop's one stock count, owner side (modules/stock/stock.ts and modules/stock/kit.ts): the typed state kept under `assistant.stock`, the owner's five ops on their Stock page
// (start, correct, sold, low, stop), the shape check of the page's body, the reads the page needs, `restoreAfterYes` (the Confirm button on a listing that sold itself at 0) and the
// daily tidy. Pure: no disk, no network, no clock (the caller says what time it is).
//
// What is NOT here, on purpose: the shop's own record of an order's sale or a delivery (`sale`, `received`, `reconcile*`, `unbookedHolds`): a listings-only shop has no orders and
// no purchase orders, so nothing here could call them. The state keeps what they write (`applied` keys such as `sale:...`, movements of kind returned/received, `short`, an alert's
// `asked`), so a folder that the TypeScript runtime also ran is read and written back whole.
//
// Where Go and JavaScript differ, and which TypeScript behaviour is copied:
//  - lengths are UTF-16 code units (utf16Len), `\s` is isJSSpace, as in text.go;
//  - counts are int64; the page's numbers arrive as float64 and are checked whole (Number.isSafeInteger and the bounds) BEFORE they become counts;
//  - `applied` is a JavaScript object, whose keys keep the order they were made in; Go's map does not, so appliedMap keeps it (the prune drops "oldest first", ties in key order);
//  - the Stock page sorts by `name.localeCompare`: golang.org/x/text/collate with the English tailoring is the same CLDR order for the names a shop has.

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// Limits, as stock.ts.
const (
	MaxStockLines   = 300
	MaxStockCount   = 1_000_000
	MaxMoves        = 30
	MaxApplied      = 5000
	SafeKeepMs      = 45 * Day
	AppliedKeptMs   = 120 * Day
	MaxAlerts       = 50
	MaxStockName    = 60
	MaxStockUnit    = 20
	alertKeptMs     = 30 * Day
	maxStockNameIn  = 80 // the page's name, cut to this many UTF-16 units by the shape check (kit.ts)
	maxStockUnitIn  = 40
	stockOwner      = "owner"
	stockRequestKey = "req:"
)

// StockFailure is why a stock op was refused (stock.ts `Failure`; "unit" is only the shop's own delivery record's and never arises here, but is a valid word in a state).
type StockFailure string

const (
	StockBadID      StockFailure = "bad_id"
	StockBadCount   StockFailure = "bad_count"
	StockBadLow     StockFailure = "bad_low"
	StockBadText    StockFailure = "bad_text"
	StockExists     StockFailure = "exists"
	StockFull       StockFailure = "full"
	StockNoSuchLine StockFailure = "no_such_line"
	StockStale      StockFailure = "stale"
)

// stockIDRe is stock.ts ID: "listing:l-3", "menu:thali", "supply:rice25".
var stockIDRe = regexp.MustCompile(`^(listing|menu|supply):[A-Za-z0-9._-]{1,64}$`)

// IsStockID is `isStockId`.
func IsStockID(id string) bool { return stockIDRe.MatchString(id) }

// KindOf is the kind in an item id's prefix, "" when it is not an id.
func KindOf(id string) string {
	if !IsStockID(id) {
		return ""
	}
	return id[:strings.Index(id, ":")]
}

// ListingStockID is "listing:<id>".
func ListingStockID(listingID string) string { return "listing:" + listingID }

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

func (a *appliedMap) get(k string) (Applied, bool) { v, ok := a.m[k]; return v, ok }

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

// StockLine is one counted item.
type StockLine struct {
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

// LowAlert is one "this item is low" waiting to be shown.
type LowAlert struct {
	Line     string `json:"line"`
	Crossing int64  `json:"crossing"`
	Count    int64  `json:"count"`
	AtMs     int64  `json:"atMs"`
	Asked    int64  `json:"asked,omitempty"`
}

// Stock is the one stock count's state (assistant.stock).
type Stock struct {
	Lines  []StockLine `json:"lines"`
	Alerts []LowAlert  `json:"alerts"`
}

// NewStock is `emptyStock`.
func NewStock() *Stock { return &Stock{Lines: []StockLine{}, Alerts: []LowAlert{}} }

// Fix makes the lists non-nil after a read, so they are written as [] and never null (a state from before a member existed reads as empty).
func (st *Stock) Fix() {
	if st.Lines == nil {
		st.Lines = []StockLine{}
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
		return NewStock()
	}
	b, _ := json.Marshal(st)
	out := &Stock{}
	_ = json.Unmarshal(b, out)
	out.Fix()
	return out
}

// lineOf is `lineOf`: the line an id names by its own id, else by an alias (the own id wins across all lines).
func (st *Stock) lineOf(id string) *StockLine {
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

// Count is the count of a listing, if it is counted.
func (st *Stock) Count(listingID string) (int64, bool) {
	if l := st.lineOf(ListingStockID(listingID)); l != nil {
		return l.Count, true
	}
	return 0, false
}

// SoldOut is the ids of listings whose line is counted and at 0.
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

// whole is stock.ts `whole`: a safe integer from 0 to max. (Every max here is far under 2^53, so the bound is the safe-integer test.)
func whole(f float64, max int64) bool { return f == math.Trunc(f) && f >= 0 && f <= float64(max) }

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
	switch op.Op {
	case "start":
		return "started", st.start(op, nowMs)
	case "correct":
		return "corrected", st.correct(op.ID, op.To, reqID, op.Shown, nowMs)
	case "sold":
		return "sold", st.ownerSold(op.ID, op.Qty, reqID, nowMs)
	case "low":
		return "low_mark", st.setLow(op.ID, op.Low, nowMs)
	case "stop":
		return "stopped", st.stop(op.ID)
	}
	return "", StockBadID
}

// start is `startCounting`: the owner chooses to count an item. An item already counted is refused (use correct).
func (st *Stock) start(op StockOp, nowMs int64) StockFailure {
	if !IsStockID(op.ID) {
		return StockBadID
	}
	if !whole(op.Count, MaxStockCount) {
		return StockBadCount
	}
	if op.Low.Set && !whole(op.Low.V, MaxStockCount) {
		return StockBadLow
	}
	name, unit := clean(op.Name), clean(op.Unit)
	if utf16Len(name) > MaxStockName || utf16Len(unit) > MaxStockUnit {
		return StockBadText
	}
	if st.lineOf(op.ID) != nil {
		return StockExists
	}
	if len(st.Lines) >= MaxStockLines {
		return StockFull
	}
	count := int64(op.Count)
	line := StockLine{ID: op.ID, Name: name, Unit: unit, Count: count, Applied: appliedMap{m: map[string]Applied{}}, StartedMs: nowMs,
		Moves: []Movement{{Kind: "started", Delta: count, After: count, AtMs: nowMs, By: stockOwner}}}
	if op.Low.Set {
		low := int64(op.Low.V)
		line.Low = &low
	}
	st.Lines = append(st.Lines, line)
	st.watchLow(&st.Lines[len(st.Lines)-1], nowMs)
	return ""
}

// stop is `stopCounting`: the line goes, and the item behaves as an uncounted one again.
func (st *Stock) stop(id string) StockFailure {
	l := st.lineOf(id)
	if l == nil {
		return StockNoSuchLine
	}
	lid := l.ID
	lines := make([]StockLine, 0, len(st.Lines))
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

// setLow is `setLow`: the owner's low mark, or null to clear it.
func (st *Stock) setLow(id string, low Opt[float64], nowMs int64) StockFailure {
	l := st.lineOf(id)
	if l == nil {
		return StockNoSuchLine
	}
	if !low.Null && !whole(low.V, MaxStockCount) {
		return StockBadLow
	}
	if low.Null {
		l.Low, l.LowFlag = nil, false
		st.dropAlerts(l.ID)
	} else {
		v := int64(low.V)
		l.Low = &v
	}
	st.watchLow(l, nowMs)
	return ""
}

// correct is `correct`: the owner's own count. reqID is the page's request id, so a retry does nothing. shown is the count the owner was looking at: if the count moved since, the
// correction is refused as stale rather than overwriting it.
func (st *Stock) correct(id string, to float64, reqID string, shown Opt[float64], nowMs int64) StockFailure {
	l := st.lineOf(id)
	if l == nil {
		return StockNoSuchLine
	}
	if !whole(to, MaxStockCount) {
		return StockBadCount
	}
	key := stockRequestKey + reqID
	if _, done := l.Applied.get(key); done {
		return ""
	}
	if shown.Set && shown.V != float64(l.Count) {
		return StockStale
	}
	target := int64(to)
	delta := target - l.Count
	l.Applied.set(key, Applied{Qty: target, Took: 0, AtMs: nowMs})
	l.Count = target
	l.noteMove(Movement{Kind: "corrected", Delta: delta, After: l.Count, AtMs: nowMs, By: stockOwner})
	st.watchLow(l, nowMs)
	l.prune(nowMs)
	return ""
}

// ownerSold is `ownerSold`: "sold 2", the same keyed sale as an order's, so a retry with the same request id takes nothing more.
func (st *Stock) ownerSold(id string, qty float64, reqID string, nowMs int64) StockFailure {
	l := st.lineOf(id)
	if l == nil {
		return StockNoSuchLine
	}
	if !whole(qty, MaxStockCount) || qty < 1 {
		return StockBadCount
	}
	st.settleOut(l, stockRequestKey+reqID, int64(qty), nowMs)
	return ""
}

// settleOut is `settleOut` for the owner as the source: the key stands for `target` of the item (target semantics). A sale larger than the count takes what is there and notes the
// shortfall; a smaller target gives back what the key really took.
func (st *Stock) settleOut(l *StockLine, key string, target int64, nowMs int64) {
	prev, ok := l.Applied.get(key)
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
		m := Movement{Kind: "sold", Delta: -took, After: l.Count, AtMs: nowMs, By: stockOwner}
		if took < want {
			m.Short = want - took
		}
		l.noteMove(m)
	} else {
		back := min(prev.Took, prev.Qty-target)
		l.Count = min(MaxStockCount, l.Count+back)
		l.Applied.set(key, Applied{Qty: target, Took: prev.Took - back, AtMs: nowMs})
		l.noteMove(Movement{Kind: "returned", Delta: back, After: l.Count, AtMs: nowMs, By: stockOwner})
	}
	st.watchLow(l, nowMs)
	l.prune(nowMs)
}

// watchLow is the low mark, once per crossing: at or under it the line sets lowFlag and queues one alert; the flag clears only when the count rises above the mark again.
func (st *Stock) watchLow(l *StockLine, nowMs int64) {
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

func (l *StockLine) noteMove(m Movement) {
	l.Moves = append(l.Moves, m)
	if len(l.Moves) > MaxMoves {
		l.Moves = append([]Movement{}, l.Moves[len(l.Moves)-MaxMoves:]...)
	}
}

// prune: past the soft cap only keys older than SafeKeepMs go, oldest first (a stable sort, as JavaScript's), so a key an order or delivery can still name is never dropped.
func (l *StockLine) prune(nowMs int64) {
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
	n := len(l.Applied.keys) - MaxApplied
	if n > len(old) {
		n = len(old)
	}
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

// RestoreAfterYes is `restoreAfterYes`: "Yes, I still have it" about a listing that sold itself at 0 (the Confirm button on the owner's page). The count is set to the number the owner
// first said for the listing, or 1, by the owner's authority. Anything else (an uncounted listing, a count above 0) is left alone. True when the count was set (or the same request
// had already set it, as `correct` answers).
func (st *Stock) RestoreAfterYes(listingID string, firstQty int64, reqID string, nowMs int64) bool {
	if st == nil {
		return false
	}
	l := st.lineOf(ListingStockID(listingID))
	if l == nil || l.Count != 0 {
		return false
	}
	to := firstQty // a listing's qty is 1 to 9999 when it has one; 0 here is "none said"
	if to == 0 {
		to = 1
	}
	return st.correct(ListingStockID(listingID), float64(to), reqID, Opt[float64]{}, nowMs) == ""
}

// ---- the reads ----------------------------------------------------------------------------------------------------------------------------------------------

// StockMark is the record's `refs` for a stock line: item, kind, change, by (stock.ts `stockRefs`).
func StockRefs(id, change, by string) map[string]string {
	return map[string]string{"item": id, "kind": KindOf(id), "change": change, "by": by}
}

// StockRow is one counted item as the owner's Stock page lists it.
type StockRow struct {
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

// ItemRef is an item the owner could start counting: its id and its name in the owner's language.
type ItemRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit,omitempty"`
}

// StockView is the owner's Stock page's data.
type StockView struct {
	Rows       []StockRow `json:"rows"`
	Candidates []ItemRef  `json:"candidates"`
	Attention  int        `json:"attention"`
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

// StockViewOf is `ownerView`: rows (sold out first, then low, then by name), the items not counted yet, and how many need attention.
func StockViewOf(st *Stock, refs []ItemRef) StockView {
	nameOf := func(id string) (string, bool) {
		for _, r := range refs {
			if r.ID == id {
				return r.Name, true
			}
		}
		return "", false
	}
	rows := []StockRow{}
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
			rows = append(rows, StockRow{ID: l.ID, Name: name, Unit: l.Unit, Count: l.Count, Low: l.Low, IsLow: l.LowFlag, SoldOut: l.Count <= 0, Kind: kind, Moves: moves})
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
		if st == nil || st.lineOf(r.ID) == nil {
			cands = append(cands, r)
		}
	}
	attention := 0
	for _, r := range rows {
		if r.IsLow || r.SoldOut {
			attention++
		}
	}
	return StockView{Rows: rows, Candidates: cands, Attention: attention}
}
