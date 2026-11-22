package stock

// Proves the Go package equals modules/stock/stock.ts: testdata/stock-vectors.json.gz (go/scripts/gen_stock_vectors.ts) holds scenarios the TypeScript RAN (starting state, each step, what it
// answered, the whole state after it); every step is replayed here on listings.Stock and compared member for member (and the order `applied` keys were made in, which the prune depends on).

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/listings"
)

type step struct {
	Op         string          `json:"op"`
	ID         string          `json:"id"`
	Key        string          `json:"key"`
	Line       string          `json:"line"`
	Qty        float64         `json:"qty"`
	Cumulative float64         `json:"cumulative"`
	Count      float64         `json:"count"`
	To         float64         `json:"to"`
	Shown      *float64        `json:"shown"`
	Low        *float64        `json:"low"`
	Unit       *string         `json:"unit"`
	Name       string          `json:"name"`
	Kind       *string         `json:"kind"`
	Except     *string         `json:"except"`
	ExceptKey  string          `json:"exceptKey"`
	ReqID      string          `json:"reqId"`
	Held       int64           `json:"held"`
	Crossing   int64           `json:"crossing"`
	NowMs      int64           `json:"nowMs"`
	Facts      json.RawMessage `json:"facts"`
	Result     json.RawMessage `json:"result"`
	State      json.RawMessage `json:"state"`
}

type scenario struct {
	Name    string          `json:"name"`
	Digest  bool            `json:"digest"`
	Initial json.RawMessage `json:"initial"`
	Steps   []step          `json:"steps"`
}

type vectors struct {
	Scenarios []scenario `json:"scenarios"`
	Pure      struct {
		IDs []struct {
			ID     string  `json:"id"`
			IsID   bool    `json:"isStockId"`
			KindOf *string `json:"kindOf"`
		} `json:"ids"`
		Builders []struct{ In, Menu, Supply, Listing string } `json:"builders"`
		Refs     []struct {
			ID, Change, By string
			Refs           map[string]string `json:"refs"`
		} `json:"refs"`
		LowRequestIDs []struct {
			Line     string `json:"line"`
			Crossing int64  `json:"crossing"`
			ID       string `json:"id"`
		} `json:"lowRequestIds"`
		Constants struct {
			FactHorizonMs int64  `json:"FACT_HORIZON_MS"`
			SafeKeepMs    int64  `json:"SAFE_KEEP_MS"`
			AppliedKept   int64  `json:"APPLIED_KEPT_MS"`
			MaxApplied    int    `json:"MAX_APPLIED"`
			Action        string `json:"STOCK_ACTION"`
		} `json:"constants"`
	} `json:"pure"`
	Words []map[string]json.RawMessage `json:"words"`
}

func load(t *testing.T) vectors {
	t.Helper()
	f, err := os.Open("testdata/stock-vectors.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func normal(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return decode(t, b)
}

func decode(t *testing.T, b []byte) any {
	t.Helper()
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// appliedOrder is the keys of each line's `applied`, in file order, from raw JSON (a Go map has none).
func appliedOrder(t *testing.T, raw []byte) [][]string {
	t.Helper()
	var st struct {
		Lines []struct {
			Applied json.RawMessage `json:"applied"`
		} `json:"lines"`
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		t.Fatal(err)
	}
	var out [][]string
	for _, l := range st.Lines {
		var keys []string
		if len(l.Applied) > 0 {
			dec := json.NewDecoder(bytes.NewReader(l.Applied))
			if tok, _ := dec.Token(); tok == json.Delim('{') {
				for dec.More() {
					k, _ := dec.Token()
					keys = append(keys, k.(string))
					var skip json.RawMessage
					_ = dec.Decode(&skip)
				}
			}
		}
		out = append(out, keys)
	}
	return out
}

// digestOf is the generator's digestOf: each line without its keys, plus how many keys and a hash of every key and value in order.
func digestOf(t *testing.T, st *listings.Stock) any {
	t.Helper()
	m := normal(t, st).(map[string]any)
	lines := m["lines"].([]any)
	for i, x := range lines {
		l := x.(map[string]any)
		delete(l, "applied")
		h := sha256.New()
		keys := st.Lines[i].AppliedKeys()
		for _, k := range keys {
			a, _ := st.Lines[i].AppliedGet(k)
			fmt.Fprintf(h, "%s|%d|%d|%d\n", k, a.Qty, a.Took, a.AtMs)
		}
		l["appliedCount"] = float64(len(keys))
		l["appliedSha256"] = hex.EncodeToString(h.Sum(nil))
	}
	return m
}

func lineID(l *listings.StockLine) any {
	if l == nil {
		return nil
	}
	return l.ID
}

func okResult(l *listings.StockLine, why listings.StockFailure) any {
	if why != "" {
		return map[string]any{"ok": false, "why": string(why)}
	}
	return map[string]any{"ok": true, "line": lineID(l)}
}

func optF(p *float64) listings.Opt[float64] {
	if p == nil {
		return listings.Opt[float64]{}
	}
	return listings.Opt[float64]{Set: true, V: *p}
}

func isWhole(f float64) bool { return f == float64(int64(f)) }

// run does one step on the state and gives back what the TypeScript's call answered, in the vector's shape.
func run(t *testing.T, st *listings.Stock, s step) any {
	t.Helper()
	rec := ShopRecord(FromOrders)
	switch s.Op {
	case "sale":
		return okResult(Sale(st, rec, s.ID, s.Key, int64(s.Qty), s.NowMs))
	case "received":
		unit := ""
		if s.Unit != nil {
			unit = *s.Unit
		}
		if !isWhole(s.Cumulative) { // the Go API takes whole counts; a fraction is refused by the TypeScript's `whole`, and by the caller's conversion here
			return map[string]any{"ok": false, "why": "bad_count"}
		}
		return okResult(Received(st, ShopRecord(FromStockOrders), s.ID, s.Key, int64(s.Cumulative), unit, s.NowMs))
	case "reconcileSales":
		var facts []OrderFact
		mustJSON(t, s.Facts, &facts)
		return float64(ReconcileSales(st, rec, facts, s.NowMs))
	case "reconcileDeliveries":
		var facts []DeliveryFact
		mustJSON(t, s.Facts, &facts)
		return normal(t, ReconcileDeliveries(st, ShopRecord(FromStockOrders), facts, s.NowMs))
	case "unbookedHolds":
		var facts []OrderFact
		mustJSON(t, s.Facts, &facts)
		return float64(UnbookedHolds(st, s.ID, facts, s.ExceptKey))
	case "leftFor":
		if n, ok := LeftFor(st, s.ID, s.Held); ok {
			return float64(n)
		}
		return nil
	case "countOf":
		if n, ok := CountOf(st, s.ID); ok {
			return float64(n)
		}
		return nil
	case "isCounted":
		return IsCounted(st, s.ID)
	case "pendingAlerts":
		kind := ""
		if s.Kind != nil {
			kind = *s.Kind
		}
		return normal(t, PendingAlerts(st, kind))
	case "lowLines":
		except := ""
		if s.Except != nil {
			except = *s.Except
		}
		ids := []any{}
		for _, l := range LowLines(st, except) {
			ids = append(ids, l.ID)
		}
		return ids
	case "ackAlert":
		return AckAlert(st, s.Line, s.Crossing)
	case "noteAsked":
		return float64(NoteAsked(st, s.Line, s.Crossing))
	case "tidy":
		st.Tidy(s.NowMs)
		return nil
	case "start", "stop", "correct", "ownerSold", "setLow":
		return ownerStep(st, s)
	}
	t.Fatalf("unknown op %q", s.Op)
	return nil
}

// ownerStep runs the owner's ops through listings (kit.ts applyOp), which the scenarios use to set up and to cross the shop's record with the owner's own acts.
func ownerStep(st *listings.Stock, s step) any {
	op := listings.StockOp{ID: s.ID}
	switch s.Op {
	case "start":
		op.Op, op.Count, op.Name = "start", s.Count, s.Name
		if s.Unit != nil {
			op.Unit = *s.Unit
		}
		op.Low = optF(s.Low)
	case "stop":
		op.Op = "stop"
	case "correct":
		op.Op, op.To, op.Shown = "correct", s.To, optF(s.Shown)
	case "ownerSold":
		op.Op = "sold"
		op.Qty = s.Qty
	case "setLow":
		op.Op = "low"
		if s.Low == nil {
			op.Low = listings.Opt[float64]{Set: true, Null: true}
		} else {
			op.Low = optF(s.Low)
		}
	}
	_, why := listings.ApplyStockOp(st, op, s.ReqID, s.NowMs)
	if why != "" {
		return map[string]any{"ok": false, "why": string(why)}
	}
	if s.Op == "stop" {
		return map[string]any{"ok": true}
	}
	return map[string]any{"ok": true, "line": lineID(st.LineOf(s.ID))}
}

func mustJSON(t *testing.T, raw json.RawMessage, into any) {
	t.Helper()
	if len(raw) == 0 || string(raw) == "null" {
		return
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatal(err)
	}
}

func TestEveryScenarioEqualsTheTypeScript(t *testing.T) {
	v := load(t)
	steps := 0
	for _, sc := range v.Scenarios {
		var st listings.Stock
		if err := json.Unmarshal(sc.Initial, &st); err != nil {
			t.Fatalf("%s: %v", sc.Name, err)
		}
		st.Fix()
		for i, s := range sc.Steps {
			steps++
			got := run(t, &st, s)
			if want := decode(t, s.Result); !reflect.DeepEqual(got, want) {
				t.Fatalf("%s, step %d (%s): answered %v, TypeScript %v", sc.Name, i, s.Op, got, want)
			}
			if sc.Digest {
				if want := decode(t, s.State); !reflect.DeepEqual(digestOf(t, &st), want) {
					t.Fatalf("%s, step %d (%s): the state differs from the TypeScript's (digest)", sc.Name, i, s.Op)
				}
				continue
			}
			raw, _ := json.Marshal(&st)
			if g, w := decode(t, raw), decode(t, s.State); !reflect.DeepEqual(g, w) {
				gb, _ := json.Marshal(g)
				wb, _ := json.Marshal(w)
				t.Fatalf("%s, step %d (%s): the state differs from the TypeScript's:\n go %s\n ts %s", sc.Name, i, s.Op, gb, wb)
			}
			if g, w := appliedOrder(t, raw), appliedOrder(t, s.State); !reflect.DeepEqual(g, w) {
				t.Fatalf("%s, step %d (%s): the keys of `applied` are in another order than the TypeScript's", sc.Name, i, s.Op)
			}
		}
	}
	t.Logf("%d scenarios, %d steps", len(v.Scenarios), steps)
}

func TestIdsBuildersRefsAndConstants(t *testing.T) {
	v := load(t)
	for _, c := range v.Pure.IDs {
		if IsStockID(c.ID) != c.IsID {
			t.Errorf("IsStockID(%q) = %v", c.ID, !c.IsID)
		}
		want := ""
		if c.KindOf != nil {
			want = *c.KindOf
		}
		if KindOf(c.ID) != want {
			t.Errorf("KindOf(%q) = %q, want %q", c.ID, KindOf(c.ID), want)
		}
	}
	for _, b := range v.Pure.Builders {
		if MenuStockID(b.In) != b.Menu || SupplyStockID(b.In) != b.Supply || ListingStockID(b.In) != b.Listing {
			t.Errorf("builders of %q", b.In)
		}
	}
	for _, r := range v.Pure.Refs {
		if !reflect.DeepEqual(StockRefs(r.ID, r.Change, r.By), r.Refs) {
			t.Errorf("StockRefs(%q)", r.ID)
		}
	}
	for _, c := range v.Pure.LowRequestIDs {
		if LowRequestID(c.Line, c.Crossing) != c.ID {
			t.Errorf("LowRequestID(%q, %d) = %q, want %q", c.Line, c.Crossing, LowRequestID(c.Line, c.Crossing), c.ID)
		}
	}
	k := v.Pure.Constants
	if FactHorizonMs != k.FactHorizonMs || listings.SafeKeepMs != k.SafeKeepMs || listings.AppliedKeptMs != k.AppliedKept || listings.MaxApplied != k.MaxApplied || Action != k.Action {
		t.Errorf("a horizon or limit differs from stock.ts: %+v", k)
	}
	if !(FactHorizonMs < listings.SafeKeepMs && listings.SafeKeepMs < listings.AppliedKeptMs) {
		t.Error("the horizons are not in order")
	}
}

func TestWordsEqualTheTypeScripts(t *testing.T) {
	v := load(t)
	if len(v.Words) != 4 {
		t.Fatalf("%d languages", len(v.Words))
	}
	str := func(raw json.RawMessage) string { var s string; _ = json.Unmarshal(raw, &s); return s }
	for _, m := range v.Words {
		lang := str(m["lang"])
		w := Words(lang)
		var left []string
		_ = json.Unmarshal(m["left"], &left)
		got := []string{w.Left(12, ""), w.Left(0, "kg"), w.Left(3, "bag")}
		if !reflect.DeepEqual(got, left) {
			t.Errorf("%s left: %q vs %q", lang, got, left)
		}
		checks := map[string]string{
			"lowMark": w.LowMark(3), "short": w.Short(2), "runningLow": w.RunningLow("Rice 5 kg", 3), "reorderAsk": w.ReorderAsk("Rice 5 kg", 3, "Ravi Traders"),
			"morningLow": w.MorningLow("2"), "unitRefused": w.UnitRefused("Rice 5 kg", "bag"), "title": w.Title, "saved": w.Saved, "slotLike": w.RunningLow("{name} {n}", 1),
		}
		for k, g := range checks {
			if want := str(m[k]); g != want {
				t.Errorf("%s %s: %q vs %q", lang, k, g, want)
			}
		}
		var notices map[string]string
		_ = json.Unmarshal(m["notices"], &notices)
		n := w.Notices
		if notices["stale"] != n.Stale || notices["bad_count"] != n.BadCount || notices["bad_low"] != n.BadLow || notices["bad_id"] != n.BadID || notices["bad_text"] != n.BadText ||
			notices["exists"] != n.Exists || notices["full"] != n.Full || notices["no_such_line"] != n.NoSuchLine || notices["unit"] != n.Unit {
			t.Errorf("%s notices differ", lang)
		}
		var moves, kinds map[string]string
		_ = json.Unmarshal(m["moves"], &moves)
		_ = json.Unmarshal(m["kinds"], &kinds)
		if moves["started"] != w.Moves.Started || moves["sold"] != w.Moves.Sold || moves["returned"] != w.Moves.Returned || moves["received"] != w.Moves.Received || moves["corrected"] != w.Moves.Corrected ||
			kinds["listing"] != w.Kinds.Listing || kinds["menu"] != w.Kinds.Menu || kinds["supply"] != w.Kinds.Supply {
			t.Errorf("%s moves or kinds differ", lang)
		}
		for _, bad := range []string{"safe", "guaranteed", "certified", "100%", "earn", "income", "bot ", "founder"} {
			if strings.Contains(strings.ToLower(w.Low+w.Intro+w.Empty+w.StopHelp+w.RunningLow("x", 1)), bad) {
				t.Errorf("%s: a word that must not be said: %q", lang, bad)
			}
		}
	}
}

func TestOnlyTheShopsOwnRecordWrites(t *testing.T) {
	st := listings.NewStock()
	for name, f := range map[string]func(){
		"sale":       func() { Sale(st, Record{}, MenuStockID("thali"), "sale:o-1:thali", 2, 0) },
		"received":   func() { Received(st, Record{}, SupplyStockID("rice"), "delivery:po-1", 4, "", 0) },
		"reconcile":  func() { ReconcileSales(st, Record{}, nil, 0) },
		"deliveries": func() { ReconcileDeliveries(st, Record{}, nil, 0) },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s with a record nobody made did not refuse", name)
				}
			}()
			f()
		}()
	}
}
