package stockorders

// A purchase order and the store the agent keeps it in: the Go twin of templates/commerce/stock-orders/src/order.ts and server/snapshot.ts. The store's members are written in
// the TypeScript codec's order (orders, handled, requests, optedOut, seq, asking, assistant, ai, sendOnce), Maps and Sets as lists in their own order, so a shop moves between
// the two runtimes and loses nothing. Every member of an order this code does not know is carried through raw (the project's rule).
//
// Three questions are kept as different fields, never folded into one status (order.ts): did the supplier accept it (`ack`), did the goods come (`receipt`), was it paid
// (`paidOutsideMs`, the owner's own note). The month's budget is NOT a counter: it is worked out from the orders every time (reservedPaise).

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

var errUnreadable = errors.New("The saved state is not in a format this version can read. It was probably written by another version of the pathway.")

// Reminder is reminders.ts Reminder.
type Reminder struct {
	AtMs int64 `json:"atMs"`
	Sent bool  `json:"sent"`
}

// Order is order.ts PurchaseOrder. Optional members are nil when the TypeScript leaves them out.
type Order struct {
	ID          string     `json:"id"`
	RequestID   string     `json:"requestId"`
	LowStock    bool       `json:"lowStock"`
	Supplier    string     `json:"supplier"`
	Line        string     `json:"line"`
	Item        string     `json:"item"`
	Unit        string     `json:"unit"`
	Qty         int64      `json:"qty"`
	UnitPaise   int64      `json:"unitPaise"`
	TotalPaise  int64      `json:"totalPaise"`
	State       string     `json:"state"`
	CreatedMs   int64      `json:"createdMs"`
	Ack         string     `json:"ack"`
	Receipt     string     `json:"receipt"`
	ReceivedQty int64      `json:"receivedQty"`
	Asks        []Reminder `json:"asks"`
	ApprovedMs  *int64     `json:"approvedMs,omitempty"`
	BudgetMonth *string    `json:"budgetMonth,omitempty"`
	SentMs      *int64     `json:"sentMs,omitempty"`
	AckMs       *int64     `json:"ackMs,omitempty"`
	ReceiptMs   *int64     `json:"receiptMs,omitempty"`
	PaidOutside *int64     `json:"paidOutsideMs,omitempty"`
	SilentTold  *int64     `json:"silentToldMs,omitempty"`
	AskedMs     *int64     `json:"askedMs,omitempty"`
	rest        map[string]json.RawMessage
}

var orderKnown = map[string]bool{"id": true, "requestId": true, "lowStock": true, "supplier": true, "line": true, "item": true, "unit": true, "qty": true, "unitPaise": true,
	"totalPaise": true, "state": true, "createdMs": true, "ack": true, "receipt": true, "receivedQty": true, "asks": true, "approvedMs": true, "budgetMonth": true, "sentMs": true,
	"ackMs": true, "receiptMs": true, "paidOutsideMs": true, "silentToldMs": true, "askedMs": true}

type orderJSON Order

func (o *Order) UnmarshalJSON(b []byte) error {
	var x orderJSON
	if err := json.Unmarshal(b, &x); err != nil {
		return err
	}
	var all map[string]json.RawMessage
	_ = json.Unmarshal(b, &all)
	for k, v := range all {
		if !orderKnown[k] {
			if x.rest == nil {
				x.rest = map[string]json.RawMessage{}
			}
			x.rest[k] = v
		}
	}
	*o = Order(x)
	if o.Asks == nil {
		o.Asks = []Reminder{}
	}
	return nil
}

func (o Order) MarshalJSON() ([]byte, error) {
	b, err := json.Marshal(orderJSON(o))
	if err != nil || len(o.rest) == 0 {
		return b, err
	}
	extra, _ := json.Marshal(o.rest)
	return append(append(b[:len(b)-1], ','), extra[1:]...), nil
}

// Asking is order.ts Asking: what the agent is waiting for the owner to answer. Qty nil: none given.
type Asking struct {
	Kind      string   `json:"kind"` // line, qty
	RequestID string   `json:"requestId"`
	LowStock  bool     `json:"lowStock"`
	Item      string   `json:"item"`
	Qty       *int64   `json:"qty,omitempty"`
	Options   []string `json:"options"`
	AskedMs   int64    `json:"askedMs"`
}

// Store is order.ts Store, minus the shared members the runtime keeps (assistant, ai).
type Store struct {
	Orders   []*Order
	byID     map[string]*Order
	Handled  []string
	Requests [][2]string // requestId, order id: a Map's entries in insertion order
	OptedOut []string
	Seq      int64
	Asking   *Asking
	SendOnce *messaging.SendOnceState
}

// NewStore is order.ts createStore.
func NewStore() *Store {
	return &Store{byID: map[string]*Order{}, Handled: []string{}, Requests: [][2]string{}, OptedOut: []string{}}
}

func (s *Store) order(id string) *Order { return s.byID[id] }

func (s *Store) put(o *Order) {
	if _, there := s.byID[o.ID]; !there {
		s.Orders = append(s.Orders, o)
	}
	s.byID[o.ID] = o
}

func (s *Store) request(id string) (string, bool) {
	for _, r := range s.Requests {
		if r[0] == id {
			return r[1], true
		}
	}
	return "", false
}

func (s *Store) setRequest(id, order string) {
	for i := range s.Requests {
		if s.Requests[i][0] == id {
			s.Requests[i][1] = order
			return
		}
	}
	s.Requests = append(s.Requests, [2]string{id, order})
}

func (s *Store) handled(id string) bool {
	for _, h := range s.Handled {
		if h == id {
			return true
		}
	}
	return false
}

func (s *Store) optedOut(digits string) bool {
	for _, x := range s.OptedOut {
		if x == digits {
			return true
		}
	}
	return false
}

func (s *Store) sendOnce() *messaging.SendOnceState {
	if s.SendOnce == nil {
		s.SendOnce = &messaging.SendOnceState{Intents: []*messaging.SendIntent{}}
	}
	return s.SendOnce
}

// nextOrderID is order.ts nextOrderId: "po-N" from a counter that survives a restart.
func (s *Store) nextOrderID() string {
	s.Seq++
	return fmt.Sprintf("po-%d", s.Seq)
}

// ParseStore reads the store's members of a saved snapshot (snapshot.ts parse); nil is a fresh store.
func ParseStore(ms []runtime.Member) (*Store, error) {
	s := NewStore()
	if ms == nil {
		return s, nil
	}
	for _, m := range ms {
		switch m.Name {
		case "orders":
			var pairs [][2]json.RawMessage
			if json.Unmarshal(m.Raw, &pairs) != nil || pairs == nil {
				return nil, errUnreadable
			}
			for _, p := range pairs {
				var o Order
				if json.Unmarshal(p[1], &o) != nil {
					return nil, errUnreadable
				}
				s.put(&o)
			}
		case "handled", "optedOut":
			var list []string
			if json.Unmarshal(m.Raw, &list) != nil || list == nil {
				return nil, errUnreadable
			}
			if m.Name == "handled" {
				s.Handled = list
			} else {
				s.OptedOut = list
			}
		case "requests":
			var pairs [][2]string
			if json.Unmarshal(m.Raw, &pairs) != nil || pairs == nil {
				return nil, errUnreadable
			}
			s.Requests = pairs
		case "seq":
			var f float64
			if json.Unmarshal(m.Raw, &f) != nil || f != float64(int64(f)) {
				return nil, errUnreadable
			}
			s.Seq = int64(f)
		case "asking":
			var a Asking
			if len(m.Raw) > 0 && m.Raw[0] == '{' && json.Unmarshal(m.Raw, &a) == nil {
				s.Asking = &a
			}
		case "sendOnce":
			var so messaging.SendOnceState
			if len(m.Raw) > 0 && m.Raw[0] == '{' && json.Unmarshal(m.Raw, &so) == nil {
				if so.Intents == nil {
					so.Intents = []*messaging.SendIntent{}
				}
				s.SendOnce = &so
			}
		}
	}
	return s, nil
}

// Members writes the store in the codec's order; "assistant" and "ai" are where the runtime puts the shared parts.
func (s *Store) Members() ([]runtime.Member, error) {
	var b strings.Builder
	b.WriteByte('[')
	for i, o := range s.Orders {
		if i > 0 {
			b.WriteByte(',')
		}
		id, _ := json.Marshal(o.ID)
		ob, err := json.Marshal(o)
		if err != nil {
			return nil, err
		}
		b.WriteByte('[')
		b.Write(id)
		b.WriteByte(',')
		b.Write(ob)
		b.WriteByte(']')
	}
	b.WriteByte(']')
	mj := func(v any) json.RawMessage { r, _ := json.Marshal(v); return r }
	out := []runtime.Member{
		{Name: "orders", Raw: json.RawMessage(b.String())},
		{Name: "handled", Raw: mj(s.Handled)},
		{Name: "requests", Raw: mj(s.Requests)},
		{Name: "optedOut", Raw: mj(s.OptedOut)},
		{Name: "seq", Raw: mj(s.Seq)},
	}
	if s.Asking != nil {
		out = append(out, runtime.Member{Name: "asking", Raw: mj(s.Asking)})
	} else {
		out = append(out, runtime.Member{Name: "asking"})
	}
	out = append(out, runtime.Member{Name: "assistant"}, runtime.Member{Name: "ai"})
	if s.SendOnce != nil {
		out = append(out, runtime.Member{Name: "sendOnce", Raw: mj(s.SendOnce)})
	} else {
		out = append(out, runtime.Member{Name: "sendOnce"})
	}
	return out, nil
}

// ---- the order's rules (order.ts) ---------------------------------------------------------------------------------------------------------------------

// monthOf is order.ts monthOf: "2026-11", the month a moment is in, in the shop's zone.
func monthOf(ms int64, tz string) string {
	t := zone.LocalParts(ms, tz)
	return fmt.Sprintf("%d-%02d", t.Year, t.Month)
}

var holdsBudgetStates = map[string]bool{"approved": true, "sent": true, "send_unknown": true, "send_failed": true, "send_blocked": true}

// holdsBudget is order.ts holdsBudget: approved, and not cancelled or declined by the supplier.
func holdsBudget(o *Order) bool { return o.ApprovedMs != nil && holdsBudgetStates[o.State] }

// reservedPaise is order.ts reservedPaise: what the month's approved orders add up to, worked out from the orders; except leaves one out.
func (s *Store) reservedPaise(month, except string) int64 {
	var sum int64
	for _, o := range s.Orders {
		if o.ID != except && o.BudgetMonth != nil && *o.BudgetMonth == month && holdsBudget(o) {
			sum += o.TotalPaise
		}
	}
	return sum
}

// isOpen is order.ts isOpen: still to arrive.
func isOpen(o *Order) bool {
	return holdsBudgetStates[o.State] && o.Receipt != "full" && o.Receipt != "wrong_item"
}

// unansweredFor is order.ts unansweredFor: the orders with a supplier that has not answered yet.
func (s *Store) unansweredFor(supplier string) []*Order {
	var out []*Order
	for _, o := range s.Orders {
		if o.Supplier == supplier && o.Ack == "none" && (o.State == "sent" || o.State == "send_unknown") {
			out = append(out, o)
		}
	}
	return out
}
