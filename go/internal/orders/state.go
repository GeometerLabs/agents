package orders

// The Orders store as the snapshot keeps it: the Go twin of templates/commerce/orders/src/order.ts `Order`, `Customer`, `Store` and its codec (server/snapshot.ts). The members, in
// the codec's order: orders (a Map written as [id, order] pairs, oldest first), customers ([phone, customer] pairs), seenMessages and seenEvents (Sets written as lists),
// nextOrder (the id counter), then the optional ai, upi, assistant, channel and plans (each left out until it is first set). Note the order: `assistant` comes BEFORE `channel`
// here (Bookings has it last), so the runtime's placeholder for it is in that place.
//
// LOSES NOTHING, AND KEEPS THE ORDER: an order and a customer are typed for the fields this runtime reads and writes, every other member is carried as raw JSON (Extra), and the
// members are written back in the order they were read (a JavaScript object keeps the order its members were first set in, which differs from order to order: a page order
// has its `channel` before its `date`), so a store read and written back is the same bytes (proved on stores the TypeScript agent wrote, testdata/store-vectors.json.gz). A member
// first set by this runtime goes after the ones read, in the TypeScript's usual order. The optional blocks are kept whole as raw JSON until something uses one: the owner-marked
// ledger (`upi`, ownermarked.State) and the channel (`channel`, runtime.ChannelState) are then typed once per store and written back; `plans` stays raw here (plans.go reads it,
// the plans' own code types it). The ai and assistant members are the shared runtime's (Snap.AI, Snap.A); this state only says where they go.
//
// Where Go and JavaScript differ: JSON is written as JSON.stringify writes it (jsonOf: no HTML escaping of <, > and &); a number member is a whole number of milliseconds or
// rupees (a value that is not one is kept raw, as read).

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// The states of an order (order.ts OrderState).
const (
	Enquiry         = "enquiry"
	AwaitingOwner   = "awaiting_owner"
	AwaitingAdvance = "awaiting_advance"
	Confirmed       = "confirmed"
	Expired         = "expired"
	Cancelled       = "cancelled"
	Completed       = "completed"
)

var transitions = map[string][]string{
	Enquiry:         {AwaitingOwner, AwaitingAdvance, Cancelled},
	AwaitingOwner:   {AwaitingAdvance, Enquiry, Cancelled},
	AwaitingAdvance: {Confirmed, Expired, Cancelled, Enquiry}, // enquiry: the link failed, start again
	Confirmed:       {Cancelled, Completed},
	Expired:         {AwaitingAdvance, Cancelled}, // a payment that arrives late
	Cancelled:       {},
	Completed:       {},
}

// LiveStates is order.ts LIVE_STATES: the states in which an order is still the customer's current business.
var LiveStates = []string{Enquiry, AwaitingOwner, AwaitingAdvance, Confirmed}

// CanMove is order.ts canMove.
func CanMove(from, to string) bool { return from == to || contains(transitions[from], to) }

// MoveTo is order.ts moveTo: a move the flow does not allow is a programming error, with the TypeScript's sentence, and stops the step.
func (o *Order) MoveTo(to string) error {
	if !CanMove(o.State, to) {
		return fmt.Errorf("An order cannot go from %s to %s.", o.State, to)
	}
	o.State = to
	return nil
}

// LocalDate is core/time.ts LocalDate as an order keeps it ({"year", "month", "day"}).
type LocalDate struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

// Zone is the date as internal/zone takes it.
func (d LocalDate) Zone() zone.Date { return zone.Date{Year: d.Year, Month: d.Month, Day: d.Day} }

// DateOf is a zone date as an order keeps it.
func DateOf(d zone.Date) LocalDate { return LocalDate{Year: d.Year, Month: d.Month, Day: d.Day} }

// OrderLine is order.ts OrderLine.
type OrderLine struct {
	ItemID string `json:"itemId"`
	Qty    int64  `json:"qty"`
}

// OrderPlan is order.ts Order.plan: this "order" is the payment of one period of a monthly plan, not a meal.
type OrderPlan struct {
	ID     string `json:"id"`
	Period int64  `json:"period"`
	TypeID string `json:"typeId"`
}

// Contact is what the customer typed on a page (not verified): the owner sees it, and the per-number limits count it.
type Contact struct {
	Name  string `json:"name,omitempty"`
	Phone string `json:"phone"`
}

// Order is order.ts Order. An optional number is a pointer and an optional text "" (nil or "": the member is not there); Reminders and Balance are kept as raw JSON (nil: not
// there) until their code is ported. Extra is every other member, raw, in the order it was read; keys is the order of all the members as read.
type Order struct {
	ID                    string
	Customer              string
	Language              string
	State                 string
	Lines                 []OrderLine
	Date                  *LocalDate
	DateNeedsConfirmation bool
	Mode                  string
	SlotID                string
	SlotCandidates        []string // nil: not there
	AwaitingAddress       bool
	Area, Address         string
	SlotStartMs           *int64
	SlotEndMs             *int64
	CutoffMs              *int64
	TotalInr              *int64
	AdvanceInr            *int64
	HoldExpiresAt         *int64
	LinkID, LinkURL       string
	AdvancePaymentID      string
	HandledPayments       []string
	// Pending is the refunds package's own list (a guard_hold and a refund_retry are typed there); the agent's own kinds, "refund" and "big_order", are payments.OtherPending
	// (OwnerRefundOf, BigOrderOf read them; NewOwnerRefund, NewBigOrder make them).
	Pending []payments.Pending
	// RefundIssues, StoppedRefunds and RefundsUntold are refunds.ts's members of the case; nil: the member is not there.
	RefundIssues   []*payments.RefundIssue
	StoppedRefunds []string
	RefundsUntold  []*payments.UntoldRefund
	ClaimTellAtMs  *int64
	ClaimAtMs      *int64
	ClaimRef       string
	Channel        string // "web" or "mcp"; "" a WhatsApp (or chat) order
	Reminders      json.RawMessage
	Balance        json.RawMessage
	Plan           *OrderPlan
	Handle         string
	Contact        *Contact
	Extra          []runtime.Member
	keys           []string
}

// Customer is order.ts Customer.
type Customer struct {
	Phone          string
	Language       string
	OptedOut       bool
	OwnerAskedAtMs *int64
	Extra          []runtime.Member
	keys           []string
}

// Store is order.ts Store.
type Store struct {
	Orders       []*Order // in the Map's order: oldest first
	byID         map[string]*Order
	Customers    []*Customer
	byPhone      map[string]*Customer
	SeenMessages []string
	SeenEvents   []string
	NextOrder    int64
	// the optional blocks, kept whole as read (nil: left out)
	Upi, Channel, Plans json.RawMessage
	// Unknown is any top-level member a later version adds, kept in the order it was read (written after the known ones).
	Unknown []runtime.Member
	// upi is the owner-marked ledger once a step or a read used it (Ledger), channel the `channel` block once one did (ChannelState), reqs its requests; Members writes each
	// back. nil: the raw member as read is kept.
	upi     *ownermarked.State
	channel *runtime.ChannelState
	reqs    *ChannelRequests
}

// NewStore is order.ts createStore.
func NewStore() *Store {
	return &Store{byID: map[string]*Order{}, byPhone: map[string]*Customer{}, SeenMessages: []string{}, SeenEvents: []string{}, NextOrder: 1, Orders: []*Order{}, Customers: []*Customer{}}
}

// NewDraft is order.ts newDraft.
func NewDraft(customer, language string) *Order {
	return &Order{Customer: customer, Language: language, State: Enquiry, Lines: []OrderLine{}, HandledPayments: []string{}, Pending: []payments.Pending{}}
}

// Order is the order with this id, or nil.
func (s *Store) Order(id string) *Order { return s.byID[id] }

// Customer is the customer with this number, made on first use (agent.ts customerOf).
func (s *Store) Customer(phone string) *Customer {
	if c := s.byPhone[phone]; c != nil {
		return c
	}
	c := &Customer{Phone: phone}
	s.Customers = append(s.Customers, c)
	s.byPhone[phone] = c
	return c
}

// FindCustomer is the customer with this number, or nil (never made).
func (s *Store) FindCustomer(phone string) *Customer { return s.byPhone[phone] }

// DeleteCustomer is `store.customers.delete(phone)`.
func (s *Store) DeleteCustomer(phone string) {
	if s.byPhone[phone] == nil {
		return
	}
	delete(s.byPhone, phone)
	for i, c := range s.Customers {
		if c.Phone == phone {
			s.Customers = append(s.Customers[:i:i], s.Customers[i+1:]...)
			return
		}
	}
}

// Register is order.ts register: the draft takes the next id ("o-3") and is kept. The counter only grows, so an id is never given out twice.
func (s *Store) Register(o *Order) *Order {
	o.ID = "o-" + strconv.FormatInt(s.NextOrder, 10)
	s.NextOrder++
	s.Orders = append(s.Orders, o)
	s.byID[o.ID] = o
	return o
}

// LatestOrder is order.ts latestOrder: the customer's most recent order in one of these states. The payment of a plan's period is not "their order" (plans find theirs by the plan).
func (s *Store) LatestOrder(customer string, states []string) *Order {
	for i := len(s.Orders) - 1; i >= 0; i-- {
		o := s.Orders[i]
		if o.Customer == customer && o.Plan == nil && contains(states, o.State) {
			return o
		}
	}
	return nil
}

// ---- the agent's own pending kinds ----------------------------------------------------------------------------------------------------------------------------------------

// OwnerRefund is order.ts Pending `{kind: "refund", amountInr, paymentId, reason: "late_cancellation", askedAtMs?}`: the owner's own call about a refund within the limit.
type OwnerRefund struct {
	Kind      string `json:"kind"`
	AmountInr int64  `json:"amountInr"`
	PaymentID string `json:"paymentId"`
	Reason    string `json:"reason"`
	AskedAtMs *int64 `json:"askedAtMs,omitempty"`
}

// BigOrder is order.ts Pending `{kind: "big_order", totalInr, askedAtMs}`: an order above the owner's approval line, waiting for "approve o-3" or "deny o-3".
type BigOrder struct {
	Kind      string `json:"kind"`
	TotalInr  int64  `json:"totalInr"`
	AskedAtMs int64  `json:"askedAtMs"`
}

// OwnerRefundOf is the late cancellation's refund this entry is, or nil.
func OwnerRefundOf(p payments.Pending) *OwnerRefund {
	o, ok := p.(*payments.OtherPending)
	if !ok || o.Kind != "refund" {
		return nil
	}
	var r OwnerRefund
	if json.Unmarshal(o.Raw, &r) != nil {
		return nil
	}
	return &r
}

// BigOrderOf is the big order's ask this entry is, or nil.
func BigOrderOf(p payments.Pending) *BigOrder {
	o, ok := p.(*payments.OtherPending)
	if !ok || o.Kind != "big_order" {
		return nil
	}
	var b BigOrder
	if json.Unmarshal(o.Raw, &b) != nil {
		return nil
	}
	return &b
}

// NewOwnerRefund and NewBigOrder are the entries as the agent pushes them (`kind` set for the caller).
func NewOwnerRefund(r OwnerRefund) payments.Pending {
	r.Kind = "refund"
	return otherPending(r.Kind, r)
}

func NewBigOrder(b BigOrder) payments.Pending { b.Kind = "big_order"; return otherPending(b.Kind, b) }

func otherPending(kind string, v any) *payments.OtherPending {
	return &payments.OtherPending{Kind: kind, Raw: jsonOf(v)}
}

// ---- JSON as JavaScript writes it -----------------------------------------------------------------------------------------------------------------------------------------

// jsonOf is JSON.stringify of a Go value: encoding/json without HTML escaping, and U+2028 and U+2029 written as themselves (Go escapes both; JavaScript neither).
func jsonOf(v any) json.RawMessage {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return json.RawMessage("null")
	}
	out := bytes.TrimRight(b.Bytes(), "\n")
	if bytes.Contains(out, []byte(`\u202`)) {
		out = []byte(strings.NewReplacer(` `, " ", ` `, " ").Replace(string(out)))
	}
	return json.RawMessage(out)
}

// obj writes a JSON object's members in order, leaving out a nil one.
type obj struct{ b bytes.Buffer }

func (o *obj) put(name string, raw json.RawMessage) {
	if raw == nil {
		return
	}
	if o.b.Len() == 0 {
		o.b.WriteByte('{')
	} else {
		o.b.WriteByte(',')
	}
	o.b.Write(jsonOf(name))
	o.b.WriteByte(':')
	o.b.Write(raw)
}

func (o *obj) done() json.RawMessage {
	if o.b.Len() == 0 {
		return json.RawMessage("{}")
	}
	o.b.WriteByte('}')
	return json.RawMessage(o.b.Bytes())
}

// writeOrdered writes an object whose typed members are `typed` (name to JSON, nil: not there; `canon` their usual order) and whose other members are `extra`: the members in
// the order read (`keys`), then any typed member set since, in `canon` order, then any extra member added since.
func writeOrdered(keys, canon []string, typed map[string]json.RawMessage, extra []runtime.Member) json.RawMessage {
	var o obj
	done := map[string]bool{}
	extraOf := func(name string) (json.RawMessage, bool) {
		for _, m := range extra {
			if m.Name == name {
				return m.Raw, true
			}
		}
		return nil, false
	}
	for _, k := range keys {
		if done[k] {
			continue
		}
		done[k] = true
		if raw := typed[k]; raw != nil {
			o.put(k, raw)
		} else if raw, ok := extraOf(k); ok {
			o.put(k, raw) // a member read but not typed (or not of its type) stays where it was
		}
	}
	for _, k := range canon {
		if !done[k] {
			o.put(k, typed[k])
			done[k] = true
		}
	}
	for _, m := range extra {
		if !done[m.Name] {
			o.put(m.Name, m.Raw)
			done[m.Name] = true
		}
	}
	return o.done()
}

func numRaw(v *int64) json.RawMessage {
	if v == nil {
		return nil
	}
	return json.RawMessage(strconv.FormatInt(*v, 10))
}

func strRaw(v string) json.RawMessage {
	if v == "" {
		return nil
	}
	return jsonOf(v)
}

// orderCanon is the order an order's members are usually first set in (newDraft's, then the flow's): where a member this runtime adds goes.
var orderCanon = []string{"id", "customer", "language", "state", "lines", "dateNeedsConfirmation", "awaitingAddress", "handledPayments", "pending", "channel", "handle", "contact",
	"plan", "date", "slotCandidates", "mode", "slotId", "area", "address", "slotStartMs", "slotEndMs", "cutoffMs", "totalInr", "advanceInr", "holdExpiresAt", "linkId", "linkUrl",
	"advancePaymentId", "claimTellAtMs", "claimAtMs", "claimRef", "reminders", "balance", "refundIssues", "stoppedRefunds", "refundsUntold"}

func (o *Order) json() json.RawMessage {
	t := map[string]json.RawMessage{
		"id": jsonOf(o.ID), "customer": jsonOf(o.Customer), "language": jsonOf(o.Language), "state": jsonOf(o.State), "dateNeedsConfirmation": jsonOf(o.DateNeedsConfirmation),
		"awaitingAddress": jsonOf(o.AwaitingAddress), "mode": strRaw(o.Mode), "slotId": strRaw(o.SlotID), "area": strRaw(o.Area), "address": strRaw(o.Address),
		"slotStartMs": numRaw(o.SlotStartMs), "slotEndMs": numRaw(o.SlotEndMs), "cutoffMs": numRaw(o.CutoffMs), "totalInr": numRaw(o.TotalInr), "advanceInr": numRaw(o.AdvanceInr),
		"holdExpiresAt": numRaw(o.HoldExpiresAt), "linkId": strRaw(o.LinkID), "linkUrl": strRaw(o.LinkURL), "advancePaymentId": strRaw(o.AdvancePaymentID),
		"claimTellAtMs": numRaw(o.ClaimTellAtMs), "claimAtMs": numRaw(o.ClaimAtMs), "claimRef": strRaw(o.ClaimRef), "channel": strRaw(o.Channel), "handle": strRaw(o.Handle),
		"reminders": o.Reminders, "balance": o.Balance,
	}
	lines := o.Lines
	if lines == nil {
		lines = []OrderLine{}
	}
	t["lines"] = jsonOf(lines)
	handled := o.HandledPayments
	if handled == nil {
		handled = []string{}
	}
	t["handledPayments"] = jsonOf(handled)
	pending := make([]json.RawMessage, 0, len(o.Pending))
	for _, p := range o.Pending {
		pending = append(pending, jsonOf(p))
	}
	t["pending"] = jsonOf(pending)
	if o.Date != nil {
		t["date"] = jsonOf(o.Date)
	}
	if o.SlotCandidates != nil {
		t["slotCandidates"] = jsonOf(o.SlotCandidates)
	}
	if o.RefundIssues != nil {
		t["refundIssues"] = jsonOf(o.RefundIssues)
	}
	if o.StoppedRefunds != nil {
		t["stoppedRefunds"] = jsonOf(o.StoppedRefunds)
	}
	if o.RefundsUntold != nil {
		t["refundsUntold"] = jsonOf(o.RefundsUntold)
	}
	if o.Plan != nil {
		t["plan"] = jsonOf(o.Plan)
	}
	if o.Contact != nil {
		t["contact"] = jsonOf(o.Contact)
	}
	for k, v := range t {
		if v == nil {
			delete(t, k)
		}
	}
	return writeOrdered(o.keys, orderCanon, t, o.Extra)
}

var customerCanon = []string{"phone", "optedOut", "language", "ownerAskedAtMs"}

func (c *Customer) json() json.RawMessage {
	t := map[string]json.RawMessage{"phone": jsonOf(c.Phone), "optedOut": jsonOf(c.OptedOut), "language": strRaw(c.Language), "ownerAskedAtMs": numRaw(c.OwnerAskedAtMs)}
	return writeOrdered(c.keys, customerCanon, t, c.Extra)
}

// ExtraOf is an order's other member by name, raw; nil when it is not there.
func (o *Order) ExtraOf(name string) json.RawMessage {
	for _, m := range o.Extra {
		if m.Name == name {
			return m.Raw
		}
	}
	return nil
}

// SetExtra sets (raw non-nil) or takes out (nil) an order's other member, in its place when it is there.
func (o *Order) SetExtra(name string, raw json.RawMessage) {
	for i, m := range o.Extra {
		if m.Name == name {
			if raw == nil {
				o.Extra = append(o.Extra[:i:i], o.Extra[i+1:]...)
			} else {
				o.Extra[i].Raw = raw
			}
			return
		}
	}
	if raw != nil {
		o.Extra = append(o.Extra, runtime.Member{Name: name, Raw: raw})
	}
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------------------------------

var errUnreadable = errors.New("The saved state is not in a format this version can read. It was probably written by another version of the pathway.")

// members is a JSON object's members in order.
func members(raw []byte) ([]runtime.Member, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, false
	}
	var out []runtime.Member
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return nil, false
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false
		}
		out = append(out, runtime.Member{Name: kt.(string), Raw: append(json.RawMessage(nil), v...)})
	}
	return out, true
}

// isBlock is snapshot.ts's test of an optional object (`value && typeof value === "object"`): an object or a list.
func isBlock(raw json.RawMessage) bool {
	t := bytes.TrimSpace(raw)
	return len(t) > 0 && (t[0] == '{' || t[0] == '[')
}

// ParseStore reads the store's members (snapshot.ts parse): the lists and the counter must be there and of their kind, or the snapshot is refused; an optional block is taken
// only when it is an object. nil members are a fresh store.
func ParseStore(ms []runtime.Member) (*Store, error) {
	if ms == nil {
		return NewStore(), nil
	}
	s := NewStore()
	have := map[string]bool{}
	for _, m := range ms {
		have[m.Name] = true
		switch m.Name {
		case "orders":
			var ps [][2]json.RawMessage
			if json.Unmarshal(m.Raw, &ps) != nil {
				return nil, errUnreadable
			}
			for _, p := range ps {
				var id string
				if json.Unmarshal(p[0], &id) != nil {
					return nil, errUnreadable
				}
				o, err := parseOrder(p[1])
				if err != nil {
					return nil, err
				}
				s.Orders = append(s.Orders, o)
				s.byID[id] = o
			}
		case "customers":
			var ps [][2]json.RawMessage
			if json.Unmarshal(m.Raw, &ps) != nil {
				return nil, errUnreadable
			}
			for _, p := range ps {
				var phone string
				if json.Unmarshal(p[0], &phone) != nil {
					return nil, errUnreadable
				}
				c, err := parseCustomer(p[1])
				if err != nil {
					return nil, err
				}
				s.Customers = append(s.Customers, c)
				s.byPhone[phone] = c
			}
		case "seenMessages", "seenEvents":
			var list []string
			if json.Unmarshal(m.Raw, &list) != nil || list == nil {
				return nil, errUnreadable
			}
			if m.Name == "seenMessages" {
				s.SeenMessages = list
			} else {
				s.SeenEvents = list
			}
		case "nextOrder":
			var f float64
			if json.Unmarshal(m.Raw, &f) != nil || f != float64(int64(f)) {
				return nil, errUnreadable
			}
			s.NextOrder = int64(f)
		case "upi", "channel", "plans":
			if !isBlock(m.Raw) {
				continue
			}
			raw := append(json.RawMessage(nil), m.Raw...)
			switch m.Name {
			case "upi":
				s.Upi = raw
			case "channel":
				s.Channel = raw
			default:
				s.Plans = raw
			}
		default:
			s.Unknown = append(s.Unknown, m)
		}
	}
	for _, need := range []string{"orders", "customers", "seenMessages", "seenEvents", "nextOrder"} {
		if !have[need] {
			return nil, errUnreadable
		}
	}
	return s, nil
}

// intOf is a whole number member, or nil when it is not one (null, text, a fraction).
func intOf(r json.RawMessage) *int64 {
	var f *float64
	if json.Unmarshal(r, &f) != nil || f == nil || *f != float64(int64(*f)) {
		return nil
	}
	n := int64(*f)
	return &n
}

// textOf is a text member, ok false when it is not text (or is the empty string, which this runtime cannot tell from "not there": it is kept raw).
func textOf(r json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(r, &s) != nil || s == "" {
		return "", false
	}
	return s, true
}

func parseOrder(raw json.RawMessage) (*Order, error) {
	ms, ok := members(raw)
	if !ok {
		return nil, errUnreadable
	}
	o := &Order{Lines: []OrderLine{}, HandledPayments: []string{}, Pending: []payments.Pending{}}
	keep := func(m runtime.Member) { o.Extra = append(o.Extra, m) }
	for _, m := range ms {
		o.keys = append(o.keys, m.Name)
		typed := true
		switch m.Name {
		case "id", "customer", "language", "state":
			var s string
			if json.Unmarshal(m.Raw, &s) != nil {
				typed = false
				break
			}
			switch m.Name {
			case "id":
				o.ID = s
			case "customer":
				o.Customer = s
			case "language":
				o.Language = s
			default:
				o.State = s
			}
		case "lines":
			typed = json.Unmarshal(m.Raw, &o.Lines) == nil && o.Lines != nil
			if !typed {
				o.Lines = []OrderLine{}
			}
		case "date":
			var d LocalDate
			if typed = json.Unmarshal(m.Raw, &d) == nil && bytes.HasPrefix(bytes.TrimSpace(m.Raw), []byte("{")); typed {
				o.Date = &d
			}
		case "dateNeedsConfirmation":
			typed = json.Unmarshal(m.Raw, &o.DateNeedsConfirmation) == nil
		case "awaitingAddress":
			typed = json.Unmarshal(m.Raw, &o.AwaitingAddress) == nil
		case "mode", "slotId", "area", "address", "linkId", "linkUrl", "advancePaymentId", "claimRef", "channel", "handle":
			s, ok := textOf(m.Raw)
			if typed = ok; !ok {
				break
			}
			switch m.Name {
			case "mode":
				o.Mode = s
			case "slotId":
				o.SlotID = s
			case "area":
				o.Area = s
			case "address":
				o.Address = s
			case "linkId":
				o.LinkID = s
			case "linkUrl":
				o.LinkURL = s
			case "advancePaymentId":
				o.AdvancePaymentID = s
			case "claimRef":
				o.ClaimRef = s
			case "channel":
				o.Channel = s
			default:
				o.Handle = s
			}
		case "slotStartMs", "slotEndMs", "cutoffMs", "totalInr", "advanceInr", "holdExpiresAt", "claimTellAtMs", "claimAtMs":
			n := intOf(m.Raw)
			if typed = n != nil; !typed {
				break
			}
			switch m.Name {
			case "slotStartMs":
				o.SlotStartMs = n
			case "slotEndMs":
				o.SlotEndMs = n
			case "cutoffMs":
				o.CutoffMs = n
			case "totalInr":
				o.TotalInr = n
			case "advanceInr":
				o.AdvanceInr = n
			case "holdExpiresAt":
				o.HoldExpiresAt = n
			case "claimTellAtMs":
				o.ClaimTellAtMs = n
			default:
				o.ClaimAtMs = n
			}
		case "slotCandidates":
			typed = json.Unmarshal(m.Raw, &o.SlotCandidates) == nil && o.SlotCandidates != nil
		case "handledPayments":
			typed = json.Unmarshal(m.Raw, &o.HandledPayments) == nil && o.HandledPayments != nil
			if !typed {
				o.HandledPayments = []string{}
			}
		case "pending":
			var list []json.RawMessage
			if typed = json.Unmarshal(m.Raw, &list) == nil && list != nil; !typed {
				break
			}
			for _, r := range list {
				p, err := payments.DecodePending(r)
				if err != nil {
					return nil, errUnreadable
				}
				o.Pending = append(o.Pending, p)
			}
		case "refundIssues":
			o.RefundIssues = []*payments.RefundIssue{}
			typed = json.Unmarshal(m.Raw, &o.RefundIssues) == nil
		case "stoppedRefunds":
			o.StoppedRefunds = []string{}
			typed = json.Unmarshal(m.Raw, &o.StoppedRefunds) == nil
		case "refundsUntold":
			o.RefundsUntold = []*payments.UntoldRefund{}
			typed = json.Unmarshal(m.Raw, &o.RefundsUntold) == nil
		case "reminders":
			o.Reminders = append(json.RawMessage(nil), m.Raw...)
		case "balance":
			o.Balance = append(json.RawMessage(nil), m.Raw...)
		case "plan":
			var p OrderPlan
			if typed = json.Unmarshal(m.Raw, &p) == nil && bytes.Equal(jsonOf(p), bytes.TrimSpace(m.Raw)); typed {
				o.Plan = &p
			}
		case "contact":
			var c Contact
			if typed = json.Unmarshal(m.Raw, &c) == nil && bytes.Equal(jsonOf(c), bytes.TrimSpace(m.Raw)); typed {
				o.Contact = &c
			}
		default:
			typed = false
		}
		if !typed {
			// a member this runtime cannot read as its type is carried as it is (and the typed field stays as "not there")
			switch m.Name {
			case "refundIssues":
				o.RefundIssues = nil
			case "stoppedRefunds":
				o.StoppedRefunds = nil
			case "refundsUntold":
				o.RefundsUntold = nil
			case "slotCandidates":
				o.SlotCandidates = nil
			}
			keep(m)
		}
	}
	return o, nil
}

func parseCustomer(raw json.RawMessage) (*Customer, error) {
	ms, ok := members(raw)
	if !ok {
		return nil, errUnreadable
	}
	c := &Customer{}
	for _, m := range ms {
		c.keys = append(c.keys, m.Name)
		typed := true
		switch m.Name {
		case "phone":
			typed = json.Unmarshal(m.Raw, &c.Phone) == nil
		case "language":
			c.Language, typed = textOf(m.Raw)
		case "optedOut":
			typed = json.Unmarshal(m.Raw, &c.OptedOut) == nil
		case "ownerAskedAtMs":
			c.OwnerAskedAtMs = intOf(m.Raw)
			typed = c.OwnerAskedAtMs != nil
		default:
			typed = false
		}
		if !typed {
			c.Extra = append(c.Extra, m)
		}
	}
	return c, nil
}

// ---- the optional blocks --------------------------------------------------------------------------------------------------------------------------------------------------

// Ledger is the store's owner-marked ledger (`upi`), typed once and kept on the store, so a step's changes and the channel's reads see the same one and Members writes it back.
// With create, a store that has none gets an empty one (agent.ts `store.upi ??= emptyMarkState()`); without, nil when there is none. A `upi` member this version cannot read is
// never replaced: it reads as none (and is saved as it was).
func (s *Store) Ledger(create bool) *ownermarked.State {
	if s.upi == nil && s.Upi != nil {
		st, err := ownermarked.Parse(s.Upi)
		if err != nil {
			return nil
		}
		s.upi = st
	}
	if s.upi == nil && create {
		s.upi = ownermarked.Empty()
	}
	return s.upi
}

// ChannelState is the store's `channel` block (`store.channel ??= emptyChannelState()`), the runtime's own ChannelState, parsed once. A block this version cannot read is started
// fresh in memory only: it is written back only if a step changes it.
func (s *Store) ChannelState() *runtime.ChannelState {
	if s.channel == nil {
		cs, err := runtime.ParseChannel(s.Channel)
		if err != nil {
			cs = runtime.EmptyChannel()
		}
		s.channel = cs
	}
	return s.channel
}

// channelRead is the channel block for a read: nil when the store has none (a read never makes one, so a store with no channel is saved with none, as the TypeScript's is).
func (s *Store) channelRead() *runtime.ChannelState {
	if s.channel == nil && s.Channel == nil {
		return nil
	}
	return s.ChannelState()
}

// ChannelRequest is one request of the channel's `requests` (agent.ts onChannelOrder): when it came, on which channel, the order it made or why it was refused, and the
// typed number's digits (the per-number limits count them). Rest is any other member, raw.
type ChannelRequest struct {
	AtMs    int64   `json:"atMs"`
	Channel string  `json:"channel"`
	Booking *string `json:"booking,omitempty"`
	Refused *string `json:"refused,omitempty"`
	Phone   string  `json:"phone,omitempty"`
	raw     json.RawMessage
}

// ChannelRequests are the requests by their handle's hash, in their keys' order (a JavaScript object's).
type ChannelRequests struct {
	keys []string
	m    map[string]*ChannelRequest
}

// Get is the request with this handle's hash, or nil.
func (c *ChannelRequests) Get(hash string) *ChannelRequest { return c.m[hash] }

// Keys are the handles' hashes in order.
func (c *ChannelRequests) Keys() []string { return c.keys }

// Set keeps a request under its handle's hash (written as the struct is: a request this runtime makes).
func (c *ChannelRequests) Set(hash string, r *ChannelRequest) {
	if _, ok := c.m[hash]; !ok {
		c.keys = append(c.keys, hash)
	}
	r.raw = nil
	c.m[hash] = r
}

func (c *ChannelRequests) json() json.RawMessage {
	var o obj
	for _, k := range c.keys {
		r := c.m[k]
		if r.raw != nil {
			o.put(k, r.raw)
		} else {
			o.put(k, jsonOf(r))
		}
	}
	return o.done()
}

// Requests are the channel's requests, read on first use (Members writes them back into the channel block, made when a request is kept on a store that had none). A request is written back as it was read
// unless Set replaces it.
func (s *Store) Requests() *ChannelRequests {
	if s.reqs == nil {
		s.reqs = &ChannelRequests{m: map[string]*ChannelRequest{}}
		var raw json.RawMessage
		if cs := s.channelRead(); cs != nil {
			raw = cs.Requests
		}
		if rs, ok := members(raw); ok {
			for _, r := range rs {
				x := &ChannelRequest{}
				_ = json.Unmarshal(r.Raw, x)
				x.raw = r.Raw
				s.reqs.keys = append(s.reqs.keys, r.Name)
				s.reqs.m[r.Name] = x
			}
		}
	}
	return s.reqs
}

// ---- writing ------------------------------------------------------------------------------------------------------------------------------------------------------------------

func pairs[T any](keys []string, vals []T, enc func(T) json.RawMessage) json.RawMessage {
	var b bytes.Buffer
	b.WriteByte('[')
	for i := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('[')
		b.Write(jsonOf(keys[i]))
		b.WriteByte(',')
		b.Write(enc(vals[i]))
		b.WriteByte(']')
	}
	b.WriteByte(']')
	return b.Bytes()
}

// Members is the codec's order (server/snapshot.ts): "ai" and "assistant" are where the runtime puts the shared parts.
func (s *Store) Members() ([]runtime.Member, error) {
	ids := make([]string, len(s.Orders))
	for i, o := range s.Orders {
		ids[i] = o.ID
	}
	phones := make([]string, len(s.Customers))
	for i, c := range s.Customers {
		phones[i] = c.Phone
	}
	list := func(l []string) json.RawMessage {
		if l == nil {
			l = []string{}
		}
		return jsonOf(l)
	}
	if s.upi != nil {
		if raw, err := s.upi.JSON(); err == nil {
			s.Upi = raw
		}
	}
	if s.reqs != nil && len(s.reqs.keys) > 0 && s.channel == nil {
		s.ChannelState() // a request kept on a store that had no channel block: `store.channel ??= emptyChannelState()`
	}
	if s.channel != nil {
		if s.reqs != nil {
			s.channel.Requests = s.reqs.json()
		}
		s.Channel = s.channel.Marshal()
	}
	out := []runtime.Member{
		{Name: "orders", Raw: pairs(ids, s.Orders, (*Order).json)},
		{Name: "customers", Raw: pairs(phones, s.Customers, (*Customer).json)},
		{Name: "seenMessages", Raw: list(s.SeenMessages)},
		{Name: "seenEvents", Raw: list(s.SeenEvents)},
		{Name: "nextOrder", Raw: json.RawMessage(strconv.FormatInt(s.NextOrder, 10))},
		{Name: "ai"},
		{Name: "upi", Raw: s.Upi},
		{Name: "assistant"},
		{Name: "channel", Raw: s.Channel},
		{Name: "plans", Raw: s.Plans},
	}
	return append(out, s.Unknown...), nil
}
