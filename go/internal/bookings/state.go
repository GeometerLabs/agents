package bookings

// The Bookings store as the snapshot keeps it: the Go twin of templates/commerce/bookings/src/booking.ts `Store` and its codec (server/snapshot.ts). The members, in the codec's
// order: bookings (a Map written as [id, booking] pairs, oldest first), customers ([phone, customer] pairs), seenMessages and seenEvents (Sets written as lists), nextBooking
// (the id counter), and the optional ai, upi, ownCalendar, calendarState, channel and assistant (each left out until it is first set).
//
// LOSES NOTHING: a booking and a customer are typed for the fields this runtime reads and writes, and every other member is carried through as raw JSON in its place (Extra), so a
// shop that goes back to the TypeScript runtime finds every field it wrote. The optional blocks (upi, ownCalendar, calendarState, channel) are kept whole as raw JSON
// until a step uses one; then it is typed (the owner-marked ledger, the own booking list, the channel) and written back field for field. The ai and assistant members are the shared runtime's (Snap.AI, Snap.A); this state only says where they go.

import (
	"github.com/GeometerLabs/agents/go/internal/calendar"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// The states of a booking (booking.ts BookingState).
const (
	Enquiry           = "enquiry"
	ConfirmingDetails = "confirming_details"
	AwaitingDeposit   = "awaiting_deposit"
	NeedsOwner        = "needs_owner"
	Confirmed         = "confirmed"
	Expired           = "expired"
	Cancelled         = "cancelled"
	Completed         = "completed"
)

var transitions = map[string][]string{
	Enquiry:           {ConfirmingDetails, AwaitingDeposit, Cancelled},
	ConfirmingDetails: {Enquiry, AwaitingDeposit, Cancelled},
	AwaitingDeposit:   {Confirmed, NeedsOwner, Expired, Cancelled, Enquiry}, // enquiry: the hold or link failed, start again
	NeedsOwner:        {Confirmed, Cancelled},
	Confirmed:         {Confirmed, Cancelled, Completed}, // confirmed -> confirmed is a reschedule
	Expired:           {AwaitingDeposit, Cancelled},      // a payment that arrives late
	Cancelled:         {},
	Completed:         {},
}

// LiveStates is booking.ts LIVE_STATES.
var LiveStates = []string{Enquiry, ConfirmingDetails, AwaitingDeposit, NeedsOwner, Confirmed}

// CanMove is booking.ts canMove.
func CanMove(from, to string) bool { return from == to || contains(transitions[from], to) }

// MoveTo is booking.ts moveTo: a move the flow does not allow is a programming error, and stops the step.
func (b *Booking) MoveTo(to string) error {
	if !CanMove(b.State, to) {
		return fmt.Errorf("a booking cannot go from %s to %s", b.State, to)
	}
	b.State = to
	return nil
}

// Contact is what the customer typed on a page (not verified).
type Contact struct {
	Name  string `json:"name,omitempty"`
	Phone string `json:"phone"`
}

// A booking's pending list is the refunds package's own (payments.Pending: a guard_hold and a refund_retry are modelled there, anything else is carried raw as
// payments.OtherPending), so the refund code changes the very list that is saved (agent_refunds.go). The agent's own kinds are "calendar" (the deposit is in and the calendar
// would not confirm it) and "refund" (a late cancellation's refund, the owner's to decide): OwnerRefundOf reads the second.

// OwnerRefund is booking.ts Pending `{kind: "refund", amountInr, paymentId, reason}`.
type OwnerRefund struct {
	Kind      string `json:"kind"`
	AmountInr int64  `json:"amountInr"`
	PaymentID string `json:"paymentId"`
	Reason    string `json:"reason"`
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

// rawPending is an entry of the agent's own kinds, as JSON.
func rawPending(v any) *payments.OtherPending {
	b, _ := json.Marshal(v)
	var k struct {
		Kind string `json:"kind"`
	}
	_ = json.Unmarshal(b, &k)
	return &payments.OtherPending{Kind: k.Kind, Raw: b}
}

// Booking is booking.ts Booking. Optional numbers are pointers (nil: the member is not there).
type Booking struct {
	ID                    string
	Customer              string
	Language              string
	State                 string
	ServiceID             string
	DateNeedsConfirmation bool
	TimeInferred          bool
	StartMs, EndMs        *int64
	EventID               string
	HoldExpiresAt         *int64
	LinkID, LinkURL       string
	DepositPaymentID      string
	DepositInr            *int64
	HandledPayments       []string
	Reminders             json.RawMessage // modules/reminders Reminder[], kept whole until the reminders are ported
	Pending               []payments.Pending
	// RefundIssues, StoppedRefunds and RefundsUntold are refunds.ts's members of the case (`refundIssues`, `stoppedRefunds`, `refundsUntold`); nil: the member is not there.
	RefundIssues   []*payments.RefundIssue
	StoppedRefunds []string
	RefundsUntold  []*payments.UntoldRefund
	Channel               string
	Handle                string
	PageLink              string
	Contact               *Contact
	// Extra is every other member, raw, in the order it was read (date, timePhrase, time, reschedule, claims, page links before, ...).
	Extra []runtime.Member
}

// Customer is booking.ts Customer.
type Customer struct {
	Phone          string
	Language       string
	OptedOut       bool
	OwnerAskedAtMs *int64
	Extra          []runtime.Member
}

// Store is booking.ts Store.
type Store struct {
	Bookings     []*Booking // in the Map's order: oldest first
	byID         map[string]*Booking
	Customers    []*Customer
	byPhone      map[string]*Customer
	SeenMessages []string
	SeenEvents   []string
	NextBooking  int64
	// the optional blocks this runtime does not model yet, kept whole (nil: left out)
	Upi, OwnCalendar, CalendarState, Channel json.RawMessage
	// Unknown is any top-level member a later version adds, kept in the order it was read (written after the known ones).
	Unknown []runtime.Member
	// own is `ownCalendar` once a step inserted into the shop's own booking list (a read does not make it, since 22 Nov) (agent_offer.go ownCal), and channel the `channel` block once a step changed it (agent_channel.go);
	// Members writes each back. nil: the raw member as read is kept.
	own     *calendar.OwnState
	channel *runtime.ChannelState
	reqs    *chanRequests
	// upi is the owner-marked ledger once a step or a read used it (ownermark.go ledger); Members writes it back as `upi`. nil: the raw member as read is kept.
	upi *ownermarked.State
}

// NewStore is booking.ts createStore.
func NewStore() *Store {
	return &Store{byID: map[string]*Booking{}, byPhone: map[string]*Customer{}, SeenMessages: []string{}, SeenEvents: []string{}, NextBooking: 1, Bookings: []*Booking{}, Customers: []*Customer{}}
}

// Booking is the booking with this id, or nil.
func (s *Store) Booking(id string) *Booking { return s.byID[id] }

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

// Register is booking.ts register: the draft takes the next id ("b-3") and is kept. The counter only grows, so an id is never given out twice.
func (s *Store) Register(b *Booking) *Booking {
	b.ID = fmt.Sprintf("b-%d", s.NextBooking)
	s.NextBooking++
	s.Bookings = append(s.Bookings, b)
	s.byID[b.ID] = b
	return b
}

// NewDraft is booking.ts newDraft.
func NewDraft(customer, language string) *Booking {
	return &Booking{Customer: customer, Language: language, State: Enquiry, HandledPayments: []string{}, Reminders: json.RawMessage("[]"), Pending: []payments.Pending{}}
}

// Latest is booking.ts latestBooking: the customer's most recent booking in one of these states.
func (s *Store) Latest(customer string, states []string) *Booking {
	for i := len(s.Bookings) - 1; i >= 0; i-- {
		b := s.Bookings[i]
		if b.Customer == customer && contains(states, b.State) {
			return b
		}
	}
	return nil
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------------

var errUnreadable = errors.New("the saved state is not in a format this version can read. It was probably written by another version of the pathway")

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
		out = append(out, runtime.Member{Name: kt.(string), Raw: v})
	}
	return out, true
}

func isJSONObject(raw json.RawMessage) bool {
	t := bytes.TrimSpace(raw)
	return len(t) > 0 && t[0] == '{'
}

// ParseStore reads the store's members (snapshot.ts parse): the lists and the counter must be there and of their kind, or the snapshot is refused; an optional block is taken
// only when it is an object.
func ParseStore(ms []runtime.Member) (*Store, error) {
	if ms == nil {
		return NewStore(), nil
	}
	s := NewStore()
	have := map[string]bool{}
	for _, m := range ms {
		have[m.Name] = true
		switch m.Name {
		case "bookings":
			var pairs [][2]json.RawMessage
			if json.Unmarshal(m.Raw, &pairs) != nil {
				return nil, errUnreadable
			}
			for _, p := range pairs {
				var id string
				if json.Unmarshal(p[0], &id) != nil {
					return nil, errUnreadable
				}
				b, err := parseBooking(p[1])
				if err != nil {
					return nil, err
				}
				s.Bookings = append(s.Bookings, b)
				s.byID[id] = b
			}
		case "customers":
			var pairs [][2]json.RawMessage
			if json.Unmarshal(m.Raw, &pairs) != nil {
				return nil, errUnreadable
			}
			for _, p := range pairs {
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
		case "nextBooking":
			var f float64
			if json.Unmarshal(m.Raw, &f) != nil || f != float64(int64(f)) {
				return nil, errUnreadable
			}
			s.NextBooking = int64(f)
		case "upi", "ownCalendar", "calendarState", "channel":
			if !isJSONObject(m.Raw) {
				continue
			}
			raw := append(json.RawMessage(nil), m.Raw...)
			switch m.Name {
			case "upi":
				s.Upi = raw
			case "ownCalendar":
				s.OwnCalendar = raw
			case "calendarState":
				s.CalendarState = raw
			default:
				s.Channel = raw
			}
		default:
			s.Unknown = append(s.Unknown, m)
		}
	}
	for _, need := range []string{"bookings", "customers", "seenMessages", "seenEvents", "nextBooking"} {
		if !have[need] {
			return nil, errUnreadable
		}
	}
	return s, nil
}

func parseBooking(raw json.RawMessage) (*Booking, error) {
	ms, ok := members(raw)
	if !ok {
		return nil, errUnreadable
	}
	b := &Booking{HandledPayments: []string{}, Reminders: json.RawMessage("[]"), Pending: []payments.Pending{}}
	str := func(r json.RawMessage) string { var s string; _ = json.Unmarshal(r, &s); return s }
	num := func(r json.RawMessage) *int64 {
		var f *float64
		if json.Unmarshal(r, &f) != nil || f == nil {
			return nil
		}
		n := int64(*f)
		return &n
	}
	for _, m := range ms {
		switch m.Name {
		case "id":
			b.ID = str(m.Raw)
		case "customer":
			b.Customer = str(m.Raw)
		case "language":
			b.Language = str(m.Raw)
		case "state":
			b.State = str(m.Raw)
		case "serviceId":
			b.ServiceID = str(m.Raw)
		case "dateNeedsConfirmation":
			_ = json.Unmarshal(m.Raw, &b.DateNeedsConfirmation)
		case "timeInferred":
			_ = json.Unmarshal(m.Raw, &b.TimeInferred)
		case "startMs":
			b.StartMs = num(m.Raw)
		case "endMs":
			b.EndMs = num(m.Raw)
		case "eventId":
			b.EventID = str(m.Raw)
		case "holdExpiresAt":
			b.HoldExpiresAt = num(m.Raw)
		case "linkId":
			b.LinkID = str(m.Raw)
		case "linkUrl":
			b.LinkURL = str(m.Raw)
		case "depositPaymentId":
			b.DepositPaymentID = str(m.Raw)
		case "depositInr":
			b.DepositInr = num(m.Raw)
		case "handledPayments":
			if json.Unmarshal(m.Raw, &b.HandledPayments) != nil || b.HandledPayments == nil {
				b.HandledPayments = []string{}
			}
		case "reminders":
			b.Reminders = append(json.RawMessage(nil), m.Raw...)
		case "pending":
			var list []json.RawMessage
			_ = json.Unmarshal(m.Raw, &list)
			for _, raw := range list {
				if x, err := payments.DecodePending(raw); err == nil {
					b.Pending = append(b.Pending, x)
				}
			}
		case "refundIssues":
			b.RefundIssues = []*payments.RefundIssue{}
			_ = json.Unmarshal(m.Raw, &b.RefundIssues)
		case "stoppedRefunds":
			b.StoppedRefunds = []string{}
			_ = json.Unmarshal(m.Raw, &b.StoppedRefunds)
		case "refundsUntold":
			b.RefundsUntold = []*payments.UntoldRefund{}
			_ = json.Unmarshal(m.Raw, &b.RefundsUntold)
		case "channel":
			b.Channel = str(m.Raw)
		case "handle":
			b.Handle = str(m.Raw)
		case "pageLink":
			b.PageLink = str(m.Raw)
		case "contact":
			var c Contact
			if json.Unmarshal(m.Raw, &c) == nil {
				b.Contact = &c
			} else {
				b.Extra = append(b.Extra, m)
			}
		default:
			b.Extra = append(b.Extra, m)
		}
	}
	return b, nil
}

func parseCustomer(raw json.RawMessage) (*Customer, error) {
	ms, ok := members(raw)
	if !ok {
		return nil, errUnreadable
	}
	c := &Customer{}
	for _, m := range ms {
		switch m.Name {
		case "phone":
			_ = json.Unmarshal(m.Raw, &c.Phone)
		case "language":
			_ = json.Unmarshal(m.Raw, &c.Language)
		case "optedOut":
			_ = json.Unmarshal(m.Raw, &c.OptedOut)
		case "ownerAskedAtMs":
			var f float64
			if json.Unmarshal(m.Raw, &f) == nil {
				n := int64(f)
				c.OwnerAskedAtMs = &n
			}
		default:
			c.Extra = append(c.Extra, m)
		}
	}
	return c, nil
}

// ---- writing ------------------------------------------------------------------------------------------------------------------------------------------------

// object writes members in order, leaving out a nil one.
type object struct{ b bytes.Buffer }

func (o *object) put(name string, v any) {
	var raw []byte
	switch x := v.(type) {
	case json.RawMessage:
		if x == nil {
			return
		}
		raw = x
	default:
		raw, _ = json.Marshal(v)
	}
	if o.b.Len() == 0 {
		o.b.WriteByte('{')
	} else {
		o.b.WriteByte(',')
	}
	k, _ := json.Marshal(name)
	o.b.Write(k)
	o.b.WriteByte(':')
	o.b.Write(raw)
}

func (o *object) done() json.RawMessage {
	if o.b.Len() == 0 {
		return json.RawMessage("{}")
	}
	o.b.WriteByte('}')
	return json.RawMessage(o.b.Bytes())
}

func (b *Booking) json() json.RawMessage {
	var o object
	o.put("id", b.ID)
	o.put("customer", b.Customer)
	o.put("language", b.Language)
	o.put("state", b.State)
	o.put("dateNeedsConfirmation", b.DateNeedsConfirmation)
	o.put("timeInferred", b.TimeInferred)
	o.put("handledPayments", b.HandledPayments)
	o.put("reminders", b.Reminders)
	pending := make([]json.RawMessage, 0, len(b.Pending))
	for _, p := range b.Pending {
		raw, _ := json.Marshal(p)
		pending = append(pending, raw)
	}
	o.put("pending", pending)
	str := func(name, v string) {
		if v != "" {
			o.put(name, v)
		}
	}
	num := func(name string, v *int64) {
		if v != nil {
			o.put(name, *v)
		}
	}
	str("serviceId", b.ServiceID)
	num("startMs", b.StartMs)
	num("endMs", b.EndMs)
	str("eventId", b.EventID)
	num("holdExpiresAt", b.HoldExpiresAt)
	str("linkId", b.LinkID)
	str("linkUrl", b.LinkURL)
	str("depositPaymentId", b.DepositPaymentID)
	num("depositInr", b.DepositInr)
	if b.RefundIssues != nil {
		o.put("refundIssues", b.RefundIssues)
	}
	if b.StoppedRefunds != nil {
		o.put("stoppedRefunds", b.StoppedRefunds)
	}
	if b.RefundsUntold != nil {
		o.put("refundsUntold", b.RefundsUntold)
	}
	str("channel", b.Channel)
	str("handle", b.Handle)
	str("pageLink", b.PageLink)
	if b.Contact != nil {
		o.put("contact", b.Contact)
	}
	for _, m := range b.Extra {
		o.put(m.Name, m.Raw)
	}
	return o.done()
}

func (c *Customer) json() json.RawMessage {
	var o object
	o.put("phone", c.Phone)
	if c.Language != "" {
		o.put("language", c.Language)
	}
	o.put("optedOut", c.OptedOut)
	if c.OwnerAskedAtMs != nil {
		o.put("ownerAskedAtMs", *c.OwnerAskedAtMs)
	}
	for _, m := range c.Extra {
		o.put(m.Name, m.Raw)
	}
	return o.done()
}

func pairs[T any](keys []string, vals []T, enc func(T) json.RawMessage) json.RawMessage {
	var b bytes.Buffer
	b.WriteByte('[')
	for i := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(keys[i])
		b.WriteByte('[')
		b.Write(k)
		b.WriteByte(',')
		b.Write(enc(vals[i]))
		b.WriteByte(']')
	}
	b.WriteByte(']')
	return b.Bytes()
}

// Members is the codec's order (server/snapshot.ts): "ai" and "assistant" are where the runtime puts the shared parts.
func (s *Store) Members() ([]runtime.Member, error) {
	ids := make([]string, len(s.Bookings))
	for i, b := range s.Bookings {
		ids[i] = b.ID
	}
	phones := make([]string, len(s.Customers))
	for i, c := range s.Customers {
		phones[i] = c.Phone
	}
	list := func(l []string) json.RawMessage {
		if l == nil {
			l = []string{}
		}
		b, _ := json.Marshal(l)
		return b
	}
	if s.own != nil {
		s.OwnCalendar, _ = json.Marshal(s.own)
	}
	if s.upi != nil {
		if raw, err := s.upi.JSON(); err == nil {
			s.Upi = raw
		}
	}
	if s.channel != nil {
		if s.reqs != nil {
			s.channel.Requests = s.reqs.json()
		}
		s.Channel = s.channel.Marshal()
	}
	out := []runtime.Member{
		{Name: "bookings", Raw: pairs(ids, s.Bookings, (*Booking).json)},
		{Name: "customers", Raw: pairs(phones, s.Customers, (*Customer).json)},
		{Name: "seenMessages", Raw: list(s.SeenMessages)},
		{Name: "seenEvents", Raw: list(s.SeenEvents)},
		{Name: "nextBooking", Raw: json.RawMessage(fmt.Sprint(s.NextBooking))},
		{Name: "ai"},
		{Name: "upi", Raw: s.Upi},
		{Name: "ownCalendar", Raw: s.OwnCalendar},
		{Name: "calendarState", Raw: s.CalendarState},
		{Name: "channel", Raw: s.Channel},
		{Name: "assistant"},
	}
	return append(out, s.Unknown...), nil
}
