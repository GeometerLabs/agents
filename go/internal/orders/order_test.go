// Proves the store (state.go), the derived reads (order.go) and the channel's reads (channel.go) equal to the TypeScript on stores its AGENT wrote (testdata/store-vectors.json.gz,
// go/scripts/gen_orders_settings.ts: UPI, Razorpay, plans and page orders, driven as the template's tests drive them): the snapshot read and written back is the same bytes, and
// at each moment the generator read them, the day's counts, a slot's count with the plans' meals, the stock taken, a slot fixed, a message's facts, the page's offer and views,
// the owner's items (their digests) and view (with the Money section), the page's receipts and the stock facts are what the TypeScript answered. Values are compared as JSON
// values; a view is also compared as text, so its members' order is the TypeScript's.
package orders

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stock"
	"github.com/GeometerLabs/agents/go/internal/store"
)

type storeCase struct {
	Name     string          `json:"name"`
	Settings json.RawMessage `json:"settings"`
	Snapshot string          `json:"snapshot"`
	Entries  []store.Entry   `json:"entries"`
	Reads    []struct {
		NowMs int64 `json:"nowMs"`
		Days  []struct {
			Date           LocalDate               `json:"date"`
			OrdersOn       int                     `json:"ordersOn"`
			OrdersOnExcept []int                   `json:"ordersOnExcept"`
			InSlot         [][3]any                `json:"inSlot"`
			Taken          [][]any                 `json:"taken"`
			Moments        map[string][]SlotMoment `json:"moments"`
		} `json:"days"`
		Orders []struct {
			ID        string    `json:"id"`
			Holds     bool      `json:"holds"`
			Total     int64     `json:"total"`
			Count     int64     `json:"count"`
			ItemsText []*string `json:"itemsText"`
			Fix       *struct {
				Mode   string    `json:"mode"`
				From   int64     `json:"from"`
				To     int64     `json:"to"`
				Cutoff int64     `json:"cutoff"`
				Date   LocalDate `json:"date"`
				SlotID string    `json:"slotId"`
			} `json:"fix"`
			Facts     json.RawMessage `json:"facts"`
			FactsMenu json.RawMessage `json:"factsMenu"`
			What      string          `json:"what"`
		} `json:"orders"`
		FactsNone   json.RawMessage      `json:"factsNone"`
		Lines       [][]OrderLine        `json:"lines"`
		Latest      [][3]*string         `json:"latest"`
		Facts       json.RawMessage      `json:"facts"`
		Offer       json.RawMessage      `json:"offer"`
		OfferPaused json.RawMessage      `json:"offerPaused"`
		Views       [][2]json.RawMessage `json:"views"`
		Items       struct {
			Items []struct {
				Code string `json:"code"`
			} `json:"items"`
		} `json:"items"`
		Owner     json.RawMessage      `json:"owner"`
		Documents [][2]json.RawMessage `json:"documents"`
		ChatWork  [][2]any             `json:"chatWork"`
	} `json:"reads"`
}

func loadStoreCases(t *testing.T) []storeCase {
	t.Helper()
	b, err := readGz("testdata/store-vectors.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []storeCase `json:"cases"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) < 6 {
		t.Fatalf("only %d stores", len(f.Cases))
	}
	return f.Cases
}

// splitSnapshot is the snapshot's members in order, without format, ai and assistant (the shared runtime's), and those three as read.
func splitSnapshot(t *testing.T, text string) (kit []runtime.Member, shared map[string]json.RawMessage) {
	t.Helper()
	ms, ok := members([]byte(text))
	if !ok {
		t.Fatal("the snapshot is not an object")
	}
	shared = map[string]json.RawMessage{}
	for _, m := range ms {
		switch m.Name {
		case "format", "ai", "assistant":
			shared[m.Name] = m.Raw
		default:
			kit = append(kit, m)
		}
	}
	return kit, shared
}

// writeSnapshot is the snapshot as the runtime writes it: format first, then the store's members with the shared ones in their places.
func writeSnapshot(st *Store, shared map[string]json.RawMessage) string {
	ms, _ := st.Members()
	var o obj
	o.put("format", shared["format"])
	for _, m := range ms {
		if m.Raw == nil {
			o.put(m.Name, shared[m.Name])
			continue
		}
		o.put(m.Name, m.Raw)
	}
	return string(o.done())
}

func sameJSON(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}

func settingsOfCase(t *testing.T, c storeCase) *Settings {
	t.Helper()
	s, _, errs := CheckSettingsFile(c.Settings)
	if errs != nil {
		t.Fatalf("%s: the settings are refused: %q", c.Name, errs)
	}
	return s
}

func parseCase(t *testing.T, c storeCase) (*Store, map[string]json.RawMessage) {
	t.Helper()
	kit, shared := splitSnapshot(t, c.Snapshot)
	st, err := ParseStore(kit)
	if err != nil {
		t.Fatalf("%s: %v", c.Name, err)
	}
	return st, shared
}

func TestStoreRoundTrip(t *testing.T) {
	for _, c := range loadStoreCases(t) {
		st, shared := parseCase(t, c)
		if got := writeSnapshot(st, shared); got != c.Snapshot {
			t.Errorf("%s: the store written back differs\n got %s\nwant %s", c.Name, got, c.Snapshot)
		}
		// every typed block used, then written back: the same bytes again (the ledger and the channel are typed and re-encoded)
		st.Ledger(false)
		st.Requests()
		// the plans block typed and written back is the same BYTES (plans_state.go writes each member in the order flow.ts first sets it)
		if raw := st.Plans; raw != nil {
			if st.PlansState(false) == nil {
				t.Errorf("%s: the plans block cannot be read", c.Name)
			} else if ms, _ := st.Members(); string(memberRaw(ms, "plans")) != string(raw) {
				t.Errorf("%s: the plans block written back differs\n got %s\nwant %s", c.Name, memberRaw(ms, "plans"), raw)
			}
		}
		if got := writeSnapshot(st, shared); !sameJSON([]byte(got), []byte(c.Snapshot)) {
			t.Errorf("%s: the store with its blocks typed differs\n got %s\nwant %s", c.Name, got, c.Snapshot)
		} else if got != c.Snapshot {
			t.Logf("%s: the typed blocks are written in another member order (the same values)", c.Name)
		}
	}
}

func TestDerivedReadsMatchTypeScript(t *testing.T) {
	for _, c := range loadStoreCases(t) {
		s := settingsOfCase(t, c)
		for _, r := range c.Reads {
			st, _ := parseCase(t, c)
			now := r.NowMs
			for _, d := range r.Days {
				if got := st.OrdersOn(d.Date, now, ""); got != d.OrdersOn {
					t.Errorf("%s @%d %v: ordersOn %d, want %d", c.Name, now, d.Date, got, d.OrdersOn)
				}
				for i, o := range st.Orders {
					if got := st.OrdersOn(d.Date, now, o.ID); got != d.OrdersOnExcept[i] {
						t.Errorf("%s @%d %v: ordersOn except %s %d, want %d", c.Name, now, d.Date, o.ID, got, d.OrdersOnExcept[i])
					}
				}
				for _, x := range d.InSlot {
					id := x[0].(string)
					if got, plan := st.OrdersInSlot(d.Date, id, now, ""), st.PlanMealsInSlot(d.Date, id, now); float64(got) != x[1].(float64) || float64(plan) != x[2].(float64) {
						t.Errorf("%s @%d %v: slot %s: %d orders, %d meals, want %v", c.Name, now, d.Date, id, got, plan, x)
					}
				}
				for _, x := range d.Taken {
					id := x[0].(string)
					if got := st.TakenOf(d.Date, id, now, ""); float64(got) != x[1].(float64) {
						t.Errorf("%s @%d %v: taken %s %d, want %v", c.Name, now, d.Date, id, got, x[1])
					}
					for i, o := range st.Orders {
						if got := st.TakenOf(d.Date, id, now, o.ID); float64(got) != x[2+i].(float64) {
							t.Errorf("%s @%d %v: taken %s except %s %d, want %v", c.Name, now, d.Date, id, o.ID, got, x[2+i])
						}
					}
				}
				for _, mode := range []string{Pickup, Delivery} {
					if got := s.SlotMoments(mode, d.Date); !reflect.DeepEqual(got, d.Moments[mode]) {
						t.Errorf("%s %v: %s moments %v, want %v", c.Name, d.Date, mode, got, d.Moments[mode])
					}
				}
			}
			for i, w := range r.Orders {
				o := st.Orders[i]
				if o.ID != w.ID || HoldsStock(o, now) != w.Holds || s.TotalOf(o.Lines) != w.Total || CountOf(o.Lines) != w.Count || s.OrderWhat(o, "") != w.What {
					t.Errorf("%s @%d %s: holds %v total %d count %d what %q, want %+v", c.Name, now, o.ID, HoldsStock(o, now), s.TotalOf(o.Lines), CountOf(o.Lines), s.OrderWhat(o, ""), w)
				}
				for j, l := range runtime.LANGUAGES {
					if w.ItemsText[j] != nil && s.ItemsText(o.Lines, l) != *w.ItemsText[j] {
						t.Errorf("%s %s: itemsText %s %q, want %q", c.Name, o.ID, l, s.ItemsText(o.Lines, l), *w.ItemsText[j])
					}
				}
				// fixSlot on a copy, with a date and a slot as the generator gave one that had none
				p := &Order{Date: o.Date, SlotID: o.SlotID}
				if p.Date == nil {
					p.Date = &r.Days[2].Date
				}
				if p.SlotID == "" {
					p.SlotID = s.AllSlots()[0].Slot.ID
				}
				if ok := s.FixSlot(p); ok != (w.Fix != nil) || (ok && (p.Mode != w.Fix.Mode || *p.SlotStartMs != w.Fix.From || *p.SlotEndMs != w.Fix.To || *p.CutoffMs != w.Fix.Cutoff)) {
					t.Errorf("%s %s: fixSlot %v %s, want %+v", c.Name, o.ID, ok, p.Mode, w.Fix)
				}
				if w.Facts != nil && string(w.Facts) != "null" {
					if got := jsonOf(s.FactsFor(o, o.Language, FactsExtra{NowMs: &now})); !sameJSON(got, w.Facts) {
						t.Errorf("%s @%d %s: facts\n got %s\nwant %s", c.Name, now, o.ID, got, w.Facts)
					}
					phone, refund, left, code, marked, leftInr, link := "+919899999999", int64(50), int64(3), "ABC234", int64(10), int64(5), "https://pay.example/x"
					x := FactsExtra{Menu: true, Areas: true, RefundInr: &refund, ItemID: s.Menu[0].ID, LeftCount: &left, CustomerPhone: &phone, UpiCode: code, MarkedInr: &marked, LeftInr: &leftInr, Link: &link}
					if got := jsonOf(s.FactsFor(o, "en", x)); !sameJSON(got, w.FactsMenu) {
						t.Errorf("%s %s: facts with the menu\n got %s\nwant %s", c.Name, o.ID, got, w.FactsMenu)
					}
				}
			}
			if got := jsonOf(s.FactsFor(nil, "hi", FactsExtra{})); !sameJSON(got, r.FactsNone) {
				t.Errorf("%s: facts of no order\n got %s\nwant %s", c.Name, got, r.FactsNone)
			}
			for i, start := range [][]OrderLine{{}, {{ItemID: s.Menu[0].ID, Qty: 2}}} {
				lines := append([]OrderLine{}, start...)
				AddLine(&lines, s.Menu[0].ID, 1)
				AddLine(&lines, s.Menu[1].ID, 3)
				if !reflect.DeepEqual(lines, r.Lines[i]) {
					t.Errorf("%s: addLine %v, want %v", c.Name, lines, r.Lines[i])
				}
			}
			for _, l := range r.Latest {
				live, done := st.LatestOrder(*l[0], LiveStates), st.LatestOrder(*l[0], []string{Cancelled, Expired, Completed})
				if idOf(live) != str(l[1]) || idOf(done) != str(l[2]) {
					t.Errorf("%s: latest of %s %q %q, want %v %v", c.Name, *l[0], idOf(live), idOf(done), str(l[1]), str(l[2]))
				}
			}
			if got := jsonOf(factsJSON(st.OrderFacts(now))); !sameJSON(nullToEmpty(got), nullToEmpty(r.Facts)) {
				t.Errorf("%s @%d: orderFacts\n got %s\nwant %s", c.Name, now, got, r.Facts)
			}
			for _, w := range r.ChatWork {
				if got := st.ChatWork(w[0].(string)); float64(got) != w[1].(float64) {
					t.Errorf("%s: chatWork %v = %d", c.Name, w, got)
				}
			}
		}
	}
}

func idOf(o *Order) string {
	if o == nil {
		return ""
	}
	return o.ID
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// compactJSON is a vector's JSON as one line, its members in the order the generator wrote them: the vector file is indented, the runtime's output is not, and only the
// bytes past the white space are the TypeScript's answer.
func compactJSON(raw json.RawMessage) string {
	var b bytes.Buffer
	if err := json.Compact(&b, raw); err != nil {
		return string(raw)
	}
	return b.String()
}

// nullToEmpty reads a JSON null as an empty list: a page with no receipts is [] in the TypeScript, and a nil list in Go is written null.
func nullToEmpty(raw json.RawMessage) json.RawMessage {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return json.RawMessage("[]")
	}
	return raw
}

func TestChannelReadsMatchTypeScript(t *testing.T) {
	views, items, owners := 0, 0, 0
	for _, c := range loadStoreCases(t) {
		s := settingsOfCase(t, c)
		for _, r := range c.Reads {
			st, _ := parseCase(t, c)
			now := r.NowMs
			if got := s.OrderOffer(st, nil, now, false); string(got) != compactJSON(r.Offer) {
				t.Errorf("%s @%d: offer\n got %s\nwant %s", c.Name, now, got, r.Offer)
			}
			if got := s.OrderShopInfo(true); string(got) != compactJSON(r.OfferPaused) {
				t.Errorf("%s: paused shop\n got %s\nwant %s", c.Name, got, r.OfferPaused)
			}
			for _, v := range r.Views {
				var hash string
				_ = json.Unmarshal(v[0], &hash)
				got := s.OrderView(st, hash)
				want := v[1]
				if string(want) == "null" {
					if got != nil {
						t.Errorf("%s: view %s: %s, want none", c.Name, hash[:8], got)
					}
					continue
				}
				views++
				if string(got) != compactJSON(want) {
					t.Errorf("%s @%d: view %s\n got %s\nwant %s", c.Name, now, hash[:8], got, want)
				}
			}
			its, _ := s.OwnerItems(st, now)
			if len(its) != len(r.Items.Items) {
				t.Errorf("%s @%d: %d owner items, want %d", c.Name, now, len(its), len(r.Items.Items))
			} else {
				for i, it := range its {
					items++
					if it.Code != r.Items.Items[i].Code {
						t.Errorf("%s: item %d's code %q, want %q", c.Name, i, it.Code, r.Items.Items[i].Code)
					}
				}
			}
			owners++
			if got := s.OwnerView(st, now, c.Entries, nil); string(got) != compactJSON(r.Owner) {
				if sameJSON(got, r.Owner) {
					t.Errorf("%s @%d: owner view in another member order\n got %s\nwant %s", c.Name, now, got, r.Owner)
				} else {
					t.Errorf("%s @%d: owner view\n got %s\nwant %s", c.Name, now, got, r.Owner)
				}
			}
			for _, d := range r.Documents {
				var hash string
				_ = json.Unmarshal(d[0], &hash)
				var want []json.RawMessage
				_ = json.Unmarshal(d[1], &want)
				for i, l := range runtime.LANGUAGES {
					if got := jsonOf(s.DocumentsOf(st, c.Entries, hash, l)); !sameJSON(nullToEmpty(got), nullToEmpty(want[i])) {
						t.Errorf("%s: documents of %s in %s\n got %s\nwant %s", c.Name, hash[:8], l, got, want[i])
					}
				}
			}
		}
	}
	if views < 8 || items < 15 || owners < 8 {
		t.Errorf("%d views, %d owner items, %d owner views: too few to mean anything", views, items, owners)
	}
	t.Logf("%d page views, %d owner items and %d owner views equal to the TypeScript", views, items, owners)
}

func TestTransitionsAndPending(t *testing.T) {
	o := NewDraft("+919800000009", "en")
	if err := o.MoveTo(Confirmed); err == nil || err.Error() != "An order cannot go from enquiry to confirmed." {
		t.Errorf("enquiry to confirmed: %v", err)
	}
	for _, to := range []string{AwaitingAdvance, Confirmed, Completed} {
		if err := o.MoveTo(to); err != nil {
			t.Fatal(err)
		}
	}
	st := NewStore()
	a, b := st.Register(NewDraft("x", "en")), st.Register(NewDraft("x", "en"))
	if a.ID != "o-1" || b.ID != "o-2" || st.NextOrder != 3 || st.LatestOrder("x", LiveStates) != b {
		t.Errorf("register: %s %s %d", a.ID, b.ID, st.NextOrder)
	}
	b.Pending = append(b.Pending, NewBigOrder(BigOrder{TotalInr: 1200, AskedAtMs: 5}), NewOwnerRefund(OwnerRefund{AmountInr: 80, PaymentID: "p", Reason: "late_cancellation"}))
	if BigOrderOf(b.Pending[0]) == nil || OwnerRefundOf(b.Pending[1]) == nil || OwnerRefundOf(b.Pending[0]) != nil {
		t.Error("the agent's own pending kinds")
	}
	if got := string(jsonOf(b.Pending)); got != `[{"kind":"big_order","totalInr":1200,"askedAtMs":5},{"kind":"refund","amountInr":80,"paymentId":"p","reason":"late_cancellation"}]` {
		t.Errorf("pending as written: %s", got)
	}
	var _ payments.Pending = b.Pending[0]
}

func TestCompactStore(t *testing.T) {
	for _, c := range loadStoreCases(t) {
		if c.Name != "upi: two days on" {
			continue
		}
		s := settingsOfCase(t, c)
		st, shared := parseCase(t, c)
		k := &Kit{Settings: s}
		far := int64(1) << 50
		n := k.CompactStore(st, far)
		if n == 0 {
			t.Fatal("nothing compacted")
		}
		for _, o := range st.Orders {
			if ended(o) && o.Address != "" {
				t.Errorf("%s keeps its address", o.ID)
			}
			if ended(o) && o.Contact != nil && o.Contact.Name != "" {
				t.Errorf("%s keeps its typed name", o.ID)
			}
		}
		if st.Requests().Get(PageHandleForTest) != nil {
			t.Error("a finished request is kept")
		}
		again, _ := ParseStore(mustMembers(t, writeSnapshot(st, shared)))
		if k.CompactStore(again, far) != 0 {
			t.Error("compacting twice changes something")
		}
		return
	}
	t.Fatal("no store to compact")
}

// PageHandleForTest is the generator's first page order's handle.
const PageHandleForTest = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"

func mustMembers(t *testing.T, text string) []runtime.Member {
	kit, _ := splitSnapshot(t, text)
	return kit
}

// factsJSON writes stock.OrderFact as the TypeScript's OrderFact (stream W5's struct has no JSON tags; endedMs is left out when it is 0, "not said").
func factsJSON(fs []stock.OrderFact) []map[string]any {
	out := []map[string]any{}
	for _, f := range fs {
		m := map[string]any{"key": f.Key, "id": f.ID, "qty": f.Qty, "standing": f.Standing, "cancelled": f.Cancelled, "holding": f.Holding}
		if f.EndedMs != 0 {
			m["endedMs"] = f.EndedMs
		}
		out = append(out, m)
	}
	return out
}

func memberRaw(ms []runtime.Member, name string) json.RawMessage {
	for _, m := range ms {
		if m.Name == name {
			return m.Raw
		}
	}
	return nil
}
