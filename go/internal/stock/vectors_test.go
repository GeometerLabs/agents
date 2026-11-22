package stock

// The stock vectors (testdata/stock-vectors.json, made by go/scripts/gen_stock_vectors.ts by RUNNING modules/stock/stock.ts): every step of every scenario is done here the same way
// and must answer the same and leave the same state. States are compared as JSON values, not bytes: where the TypeScript adds a member to an object that already exists (a line's
// `unit` taken from its first delivery, a `low` set later), JavaScript puts it last, and Go writes a line's members in one fixed order; both read back the same.

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

type vstep struct {
	Do         string          `json:"do"`
	ID         string          `json:"id"`
	Input      json.RawMessage `json:"input"`
	NowMs      int64           `json:"nowMs"`
	Low        *float64        `json:"low"`
	To         float64         `json:"to"`
	ReqID      string          `json:"reqId"`
	Shown      *float64        `json:"shown"`
	Qty        float64         `json:"qty"`
	Key        string          `json:"key"`
	Cumulative int64           `json:"cumulative"`
	Unit       string          `json:"unit"`
	Facts      json.RawMessage `json:"facts"`
	ExceptKey  string          `json:"exceptKey"`
	Held       int64           `json:"held"`
	Kind       string          `json:"kind"`
	Line       string          `json:"line"`
	Crossing   int64           `json:"crossing"`
}

type orderFactJSON struct {
	Key       string `json:"key"`
	ID        string `json:"id"`
	Qty       int64  `json:"qty"`
	Standing  bool   `json:"standing"`
	Cancelled bool   `json:"cancelled"`
	Holding   bool   `json:"holding"`
	EndedMs   int64  `json:"endedMs"`
}

type deliveryFactJSON struct {
	Key        string `json:"key"`
	ID         string `json:"id"`
	Cumulative int64  `json:"cumulative"`
	Unit       string `json:"unit"`
	AtMs       *int64 `json:"atMs"`
}

func okOr(why Failure) map[string]any {
	if why == "" {
		return map[string]any{"ok": true}
	}
	return map[string]any{"ok": false, "why": string(why)}
}

func asJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}

func TestStockVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/stock-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Scenarios []struct {
			Name  string `json:"name"`
			Steps []struct {
				Step   vstep `json:"step"`
				Result any   `json:"result"`
				State  any   `json:"state"`
			} `json:"steps"`
		} `json:"scenarios"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	owner, shop := Owner("owner"), ShopRecord()
	for _, sc := range file.Scenarios {
		st := New()
		for i, x := range sc.Steps {
			s := x.Step
			var got any
			switch s.Do {
			case "start":
				var in struct {
					Count   float64  `json:"count"`
					Name    string   `json:"name"`
					Unit    string   `json:"unit"`
					Low     *float64 `json:"low"`
					Aliases []string `json:"aliases"`
				}
				_ = json.Unmarshal(s.Input, &in)
				got = okOr(st.Start(owner, s.ID, StartInput{Count: in.Count, Name: in.Name, Unit: in.Unit, Low: in.Low, Aliases: in.Aliases}, s.NowMs))
			case "stop":
				got = okOr(st.Stop(owner, s.ID))
			case "low":
				v := 0.0
				if s.Low != nil {
					v = *s.Low
				}
				got = okOr(st.SetLow(owner, s.ID, v, s.Low == nil, s.NowMs))
			case "correct":
				got = okOr(st.Correct(owner, s.ID, s.To, s.ReqID, s.Shown, s.NowMs))
			case "sold":
				got = okOr(st.OwnerSold(owner, s.ID, s.Qty, s.ReqID, s.NowMs))
			case "sale":
				if s.Qty != math.Trunc(s.Qty) { // the agents' facts are whole numbers; a fraction is refused before it becomes a count
					if st.LineOf(s.ID) == nil {
						got = map[string]any{"ok": true, "counted": false}
					} else {
						got = map[string]any{"ok": false, "why": "bad_count"}
					}
					break
				}
				l, why := st.Sale(shop, s.ID, s.Key, int64(s.Qty), s.NowMs)
				got = okOr(why)
				if why == "" {
					got.(map[string]any)["counted"] = l != nil
				}
			case "received":
				l, why := st.Received(shop, s.ID, s.Key, s.Cumulative, s.Unit, s.NowMs)
				got = okOr(why)
				if why == "" {
					got.(map[string]any)["counted"] = l != nil
				}
			case "reconcileSales", "unbooked":
				var fs []orderFactJSON
				_ = json.Unmarshal(s.Facts, &fs)
				facts := make([]OrderFact, len(fs))
				for j, f := range fs {
					facts[j] = OrderFact{Key: f.Key, ID: f.ID, Qty: f.Qty, Standing: f.Standing, Cancelled: f.Cancelled, Holding: f.Holding, EndedMs: f.EndedMs}
				}
				if s.Do == "unbooked" {
					got = map[string]any{"held": st.UnbookedHolds(s.ID, facts, s.ExceptKey)}
				} else {
					got = map[string]any{"changed": st.ReconcileSales(shop, facts, s.NowMs)}
				}
			case "reconcileDeliveries":
				var fs []deliveryFactJSON
				_ = json.Unmarshal(s.Facts, &fs)
				facts := make([]DeliveryFact, len(fs))
				for j, f := range fs {
					facts[j] = DeliveryFact{Key: f.Key, ID: f.ID, Cumulative: f.Cumulative, Unit: f.Unit, AtMs: f.AtMs}
				}
				keys := []string{}
				for _, f := range st.ReconcileDeliveries(shop, facts, s.NowMs) {
					keys = append(keys, f.Key)
				}
				got = map[string]any{"refused": keys}
			case "left":
				if n, ok := st.LeftFor(s.ID, s.Held); ok {
					got = map[string]any{"left": n}
				} else {
					got = map[string]any{"left": nil}
				}
			case "count":
				if n, ok := st.CountOf(s.ID); ok {
					got = map[string]any{"count": n}
				} else {
					got = map[string]any{"count": nil}
				}
			case "pending":
				got = map[string]any{"alerts": st.PendingAlerts(s.Kind)}
			case "ack":
				got = map[string]any{"acked": st.AckAlert(s.Line, s.Crossing)}
			case "asked":
				got = map[string]any{"asked": st.NoteAsked(s.Line, s.Crossing)}
			case "requestId":
				got = map[string]any{"id": LowRequestID(s.Line, s.Crossing)}
			case "tidy":
				st.Tidy(s.NowMs)
				got = map[string]any{}
			default:
				t.Fatalf("%s: unknown step %q", sc.Name, s.Do)
			}
			if g := asJSON(t, got); !reflect.DeepEqual(g, x.Result) {
				t.Fatalf("%s, step %d (%s): answered %v, the TypeScript %v", sc.Name, i, s.Do, g, x.Result)
			}
			if g := asJSON(t, st); !reflect.DeepEqual(g, x.State) {
				gb, _ := json.Marshal(g)
				wb, _ := json.Marshal(x.State)
				t.Fatalf("%s, step %d (%s): the state differs\n go %s\n ts %s", sc.Name, i, s.Do, gb, wb)
			}
		}
	}
}
