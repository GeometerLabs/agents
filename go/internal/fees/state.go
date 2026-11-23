package fees

// The Fees store as the snapshot keeps it: the Go twin of templates/education/fees/src/due.ts `Store` and its codec (server/snapshot.ts). The members, in the codec's order:
// dues (a Map written as [id, due] pairs, oldest first), customers ([phone, customer] pairs), seenMessages and seenEvents (Sets written as lists), nextDue and nextRequest (the
// id counters), startedAtMs (the day the agent first ran), and the optional ai, upi, assistant, parentLinks, confirmations, classes and channel (each left out until first set).
//
// LOSES NOTHING: a fee and a customer are typed for the fields this runtime reads and writes, and every other member is carried through as raw JSON in its place (Extra), so a
// centre that goes back to the TypeScript runtime finds every field it wrote. The optional blocks are kept whole as raw JSON until a step uses one; then it is typed and written
// back. The ai and assistant members are the shared runtime's (Snap.AI, Snap.A); this state only says where they go.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// The states of a fee (due.ts DueState): open, then paid (the record shows what is owed) or closed (the owner took off the whole of it). Both are final.
const (
	Open   = "open"
	Paid   = "paid"
	Closed = "closed"
)

// CashLink is due.ts CASH_LINK: the linkId of a payment the owner marked paid by hand (cash or a bank transfer), on no payment link and no payments service.
const CashLink = "cash"

// LocalDate is core/time.ts LocalDate.
type LocalDate struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

// LinkRecord is due.ts LinkRecord: a payment link (or a UPI request) the agent made for this fee.
type LinkRecord struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Reference   string `json:"reference"`
	AmountPaise int64  `json:"amountPaise"`
}

// CountedPayment is due.ts CountedPayment.
type CountedPayment struct {
	ID          string `json:"id"`
	AmountPaise int64  `json:"amountPaise"`
	LinkID      string `json:"linkId"`
}

// Waiver and RefundRequest are due.ts Pending's own kinds (the refunds package's guard_hold and refund_retry are payments' types; anything else is carried raw).
type Waiver struct {
	Kind            string `json:"kind"` // "waiver"
	ID              string `json:"id"`
	AmountInr       int64  `json:"amountInr"`
	BalanceAtAskInr int64  `json:"balanceAtAskInr"`
	AskedAtMs       int64  `json:"askedAtMs"`
}

func (*Waiver) PendingKind() string { return "waiver" }

type RefundRequest struct {
	Kind      string `json:"kind"` // "refund_request"
	ID        string `json:"id"`
	AmountInr int64  `json:"amountInr"`
	PaymentID string `json:"paymentId"`
	AskedAtMs int64  `json:"askedAtMs"`
}

func (*RefundRequest) PendingKind() string { return "refund_request" }

// decodePending is a pending entry: Fees' own kinds typed, the refunds package's typed by it, anything else raw.
func decodePending(raw json.RawMessage) (payments.Pending, error) {
	var k struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &k); err != nil {
		return nil, err
	}
	switch k.Kind {
	case "waiver":
		var w Waiver
		if err := json.Unmarshal(raw, &w); err != nil {
			return nil, err
		}
		return &w, nil
	case "refund_request":
		var r RefundRequest
		if err := json.Unmarshal(raw, &r); err != nil {
			return nil, err
		}
		return &r, nil
	}
	return payments.DecodePending(raw)
}

// Due is due.ts Due. Optional numbers are pointers (nil: the member is not there).
type Due struct {
	ID               string
	StudentName      string
	BatchID          string
	Customer         string
	Language         string
	Month            string
	DueDate          LocalDate
	DueMs            int64
	FeeInr           int64
	LateFeeInr       int64
	WaivedInr        int64
	State            string
	Links            []LinkRecord
	LinkSeq          int64
	CurrentLinkID    string
	Payments         []CountedPayment
	Reminders        []bookings.Reminder
	RemindersSent    int64
	Pending          []payments.Pending
	WaiverDenied     bool
	RefundIssues     []*payments.RefundIssue
	StoppedRefunds   []string
	RefundsUntold    []*payments.UntoldRefund
	PartMonth        json.RawMessage
	BackDue          bool
	ClaimTellAtMs    *int64
	DiscountTellAtMs *int64
	LinkFailTellAtMs *int64
	ReadNoteAtMs     *int64
	ClaimAtMs        *int64
	ClaimRef         string
	// Extra is every other member, raw, in the order it was read.
	Extra []runtime.Member
}

// Customer is due.ts Customer.
type Customer struct {
	Phone          string
	Language       string
	OptedOut       bool
	OwnerAskedAtMs *int64
	Extra          []runtime.Member
}

// ParentLink is due.ts ParentLink: a parent's private link by its hash only.
type ParentLink struct {
	Hash string `json:"hash"`
	AtMs int64  `json:"atMs"`
	Via  string `json:"via"`
}

// Confirmation is due.ts FeeConfirmation: a confirmation page by the hash of the handle the parent's press made.
type Confirmation struct {
	DueID   string  `json:"dueId"`
	Parent  string  `json:"parent"`
	AtMs    int64   `json:"atMs"`
	Refused *string `json:"refused,omitempty"`
}

// keyed is a JSON object kept in its key order (Object.entries), with typed values.
type keyed[T any] struct {
	Keys []string
	M    map[string]*T
}

func newKeyed[T any]() *keyed[T] { return &keyed[T]{M: map[string]*T{}} }

func (k *keyed[T]) get(key string) *T { return k.M[key] }

func (k *keyed[T]) set(key string, v *T) {
	if _, has := k.M[key]; !has {
		k.Keys = append(k.Keys, key)
	}
	k.M[key] = v
}

func (k *keyed[T]) del(key string) {
	if _, has := k.M[key]; !has {
		return
	}
	delete(k.M, key)
	for i, x := range k.Keys {
		if x == key {
			k.Keys = append(k.Keys[:i:i], k.Keys[i+1:]...)
			break
		}
	}
}

func (k *keyed[T]) json() json.RawMessage {
	var o object
	for _, key := range k.Keys {
		o.put(key, k.M[key])
	}
	return o.done()
}

func parseKeyed[T any](raw json.RawMessage) (*keyed[T], bool) {
	ms, ok := members(raw)
	if !ok {
		return nil, false
	}
	out := newKeyed[T]()
	for _, m := range ms {
		var v T
		if json.Unmarshal(m.Raw, &v) != nil {
			return nil, false
		}
		out.set(m.Name, &v)
	}
	return out, true
}

// Store is due.ts Store.
type Store struct {
	Dues         []*Due // in the Map's order: oldest first
	byID         map[string]*Due
	Customers    []*Customer
	byPhone      map[string]*Customer
	SeenMessages []string
	SeenEvents   []string
	NextDue      int64
	NextRequest  int64
	StartedAtMs  *int64
	// the optional blocks, kept whole until a step types them (nil: left out)
	Upi, ParentLinks, Confirmations, Classes, Channel json.RawMessage
	Unknown                                           []runtime.Member
	upi                                               *ownermarked.State
	links                                             *keyed[ParentLink]
	confirmations                                     *keyed[Confirmation]
	channel                                           *runtime.ChannelState
	classes                                           *ClassesState
}

// NewStore is due.ts createStore.
func NewStore() *Store {
	return &Store{Dues: []*Due{}, byID: map[string]*Due{}, Customers: []*Customer{}, byPhone: map[string]*Customer{}, SeenMessages: []string{}, SeenEvents: []string{}, NextDue: 1, NextRequest: 1}
}

// Due is the fee with this id, or nil.
func (s *Store) Due(id string) *Due { return s.byID[id] }

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

// FindCustomer is the customer with this number, or nil.
func (s *Store) FindCustomer(phone string) *Customer { return s.byPhone[phone] }

// Register is due.ts register: the fee takes the next id ("f-3").
func (s *Store) Register(d *Due) *Due {
	d.ID = fmt.Sprintf("f-%d", s.NextDue)
	s.NextDue++
	s.Dues = append(s.Dues, d)
	s.byID[d.ID] = d
	return d
}

// NewRequestID is due.ts newRequestId: "q-2".
func (s *Store) NewRequestID() string {
	id := fmt.Sprintf("q-%d", s.NextRequest)
	s.NextRequest++
	return id
}

// ledger is the owner-marked ledger (`upi`), typed on first use; nil when the saved member cannot be read.
func (s *Store) ledger(create bool) *ownermarked.State {
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

// parentLinks is `parentLinks`, typed on first use (create: made when left out).
func (s *Store) parentLinks(create bool) *keyed[ParentLink] {
	if s.links == nil && s.ParentLinks != nil {
		if k, ok := parseKeyed[ParentLink](s.ParentLinks); ok {
			s.links = k
		}
	}
	if s.links == nil && create {
		s.links = newKeyed[ParentLink]()
	}
	return s.links
}

// confirmationsOf is `confirmations`, typed on first use.
func (s *Store) confirmationsOf(create bool) *keyed[Confirmation] {
	if s.confirmations == nil && s.Confirmations != nil {
		if k, ok := parseKeyed[Confirmation](s.Confirmations); ok {
			s.confirmations = k
		}
	}
	if s.confirmations == nil && create {
		s.confirmations = newKeyed[Confirmation]()
	}
	return s.confirmations
}

// chanState is `channel`, typed on first use (modules/channels/state.ts).
func (s *Store) chanState() *runtime.ChannelState {
	if s.channel == nil {
		cs, err := runtime.ParseChannel(s.Channel)
		if err != nil {
			cs = runtime.EmptyChannel()
		}
		s.channel = cs
	}
	return s.channel
}

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------------

var errUnreadable = errors.New("the saved state is not in a format this version can read. It was probably written by another version of the pathway")

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

func count(raw json.RawMessage) (int64, bool) {
	var f float64
	if json.Unmarshal(raw, &f) != nil || f != float64(int64(f)) {
		return 0, false
	}
	return int64(f), true
}

// ParseStore reads the store's members (snapshot.ts parse): the maps, sets and counters must be there and of their kind, or the snapshot is refused.
func ParseStore(ms []runtime.Member) (*Store, error) {
	if ms == nil {
		return NewStore(), nil
	}
	s := NewStore()
	have := map[string]bool{}
	for _, m := range ms {
		have[m.Name] = true
		switch m.Name {
		case "dues":
			var pairs [][2]json.RawMessage
			if json.Unmarshal(m.Raw, &pairs) != nil {
				return nil, errUnreadable
			}
			for _, p := range pairs {
				var id string
				if json.Unmarshal(p[0], &id) != nil {
					return nil, errUnreadable
				}
				d, err := parseDue(p[1])
				if err != nil {
					return nil, err
				}
				s.Dues = append(s.Dues, d)
				s.byID[id] = d
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
		case "nextDue", "nextRequest":
			n, ok := count(m.Raw)
			if !ok {
				return nil, errUnreadable
			}
			if m.Name == "nextDue" {
				s.NextDue = n
			} else {
				s.NextRequest = n
			}
		case "startedAtMs":
			var f *float64
			if json.Unmarshal(m.Raw, &f) != nil {
				return nil, errUnreadable
			}
			if f != nil {
				n := int64(*f)
				s.StartedAtMs = &n
			}
		case "upi", "parentLinks", "confirmations", "classes", "channel":
			if !isJSONObject(m.Raw) {
				continue
			}
			raw := append(json.RawMessage(nil), m.Raw...)
			switch m.Name {
			case "upi":
				s.Upi = raw
			case "parentLinks":
				s.ParentLinks = raw
			case "confirmations":
				s.Confirmations = raw
			case "classes":
				s.Classes = raw
			default:
				s.Channel = raw
			}
		default:
			s.Unknown = append(s.Unknown, m)
		}
	}
	for _, need := range []string{"dues", "customers", "seenMessages", "seenEvents", "nextDue", "nextRequest"} {
		if !have[need] {
			return nil, errUnreadable
		}
	}
	return s, nil
}

func parseDue(raw json.RawMessage) (*Due, error) {
	ms, ok := members(raw)
	if !ok {
		return nil, errUnreadable
	}
	d := &Due{Links: []LinkRecord{}, Payments: []CountedPayment{}, Reminders: []bookings.Reminder{}, Pending: []payments.Pending{}}
	str := func(r json.RawMessage) string { var s string; _ = json.Unmarshal(r, &s); return s }
	num := func(r json.RawMessage) int64 { var f float64; _ = json.Unmarshal(r, &f); return int64(f) }
	opt := func(r json.RawMessage) *int64 {
		var f *float64
		if json.Unmarshal(r, &f) != nil || f == nil {
			return nil
		}
		n := int64(*f)
		return &n
	}
	for _, m := range ms {
		var err error
		switch m.Name {
		case "id":
			d.ID = str(m.Raw)
		case "studentName":
			d.StudentName = str(m.Raw)
		case "batchId":
			d.BatchID = str(m.Raw)
		case "customer":
			d.Customer = str(m.Raw)
		case "language":
			d.Language = str(m.Raw)
		case "month":
			d.Month = str(m.Raw)
		case "dueDate":
			err = json.Unmarshal(m.Raw, &d.DueDate)
		case "dueMs":
			d.DueMs = num(m.Raw)
		case "feeInr":
			d.FeeInr = num(m.Raw)
		case "lateFeeInr":
			d.LateFeeInr = num(m.Raw)
		case "waivedInr":
			d.WaivedInr = num(m.Raw)
		case "state":
			d.State = str(m.Raw)
		case "links":
			err = json.Unmarshal(m.Raw, &d.Links)
		case "linkSeq":
			d.LinkSeq = num(m.Raw)
		case "currentLinkId":
			d.CurrentLinkID = str(m.Raw)
		case "payments":
			err = json.Unmarshal(m.Raw, &d.Payments)
		case "reminders":
			err = json.Unmarshal(m.Raw, &d.Reminders)
		case "remindersSent":
			d.RemindersSent = num(m.Raw)
		case "pending":
			var list []json.RawMessage
			_ = json.Unmarshal(m.Raw, &list)
			for _, raw := range list {
				if x, err := decodePending(raw); err == nil {
					d.Pending = append(d.Pending, x)
				} else {
					d.Pending = append(d.Pending, &payments.OtherPending{Raw: raw})
				}
			}
		case "waiverDenied":
			_ = json.Unmarshal(m.Raw, &d.WaiverDenied)
		case "refundIssues":
			d.RefundIssues = []*payments.RefundIssue{}
			_ = json.Unmarshal(m.Raw, &d.RefundIssues)
		case "stoppedRefunds":
			d.StoppedRefunds = []string{}
			_ = json.Unmarshal(m.Raw, &d.StoppedRefunds)
		case "refundsUntold":
			d.RefundsUntold = []*payments.UntoldRefund{}
			_ = json.Unmarshal(m.Raw, &d.RefundsUntold)
		case "partMonth":
			d.PartMonth = append(json.RawMessage(nil), m.Raw...)
		case "backDue":
			_ = json.Unmarshal(m.Raw, &d.BackDue)
		case "claimTellAtMs":
			d.ClaimTellAtMs = opt(m.Raw)
		case "discountTellAtMs":
			d.DiscountTellAtMs = opt(m.Raw)
		case "linkFailTellAtMs":
			d.LinkFailTellAtMs = opt(m.Raw)
		case "readNoteAtMs":
			d.ReadNoteAtMs = opt(m.Raw)
		case "claimAtMs":
			d.ClaimAtMs = opt(m.Raw)
		case "claimRef":
			d.ClaimRef = str(m.Raw)
		default:
			d.Extra = append(d.Extra, m)
		}
		if err != nil {
			return nil, errUnreadable
		}
	}
	if d.Links == nil {
		d.Links = []LinkRecord{}
	}
	if d.Payments == nil {
		d.Payments = []CountedPayment{}
	}
	if d.Reminders == nil {
		d.Reminders = []bookings.Reminder{}
	}
	return d, nil
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

// json writes a fee in newDue's order, then the members set later, then the ones this runtime does not model.
func (d *Due) json() json.RawMessage {
	var o object
	o.put("id", d.ID)
	o.put("studentName", d.StudentName)
	o.put("batchId", d.BatchID)
	o.put("customer", d.Customer)
	o.put("language", d.Language)
	o.put("month", d.Month)
	o.put("dueDate", d.DueDate)
	o.put("dueMs", d.DueMs)
	o.put("feeInr", d.FeeInr)
	o.put("lateFeeInr", d.LateFeeInr)
	o.put("waivedInr", d.WaivedInr)
	o.put("state", d.State)
	o.put("links", d.Links)
	o.put("linkSeq", d.LinkSeq)
	o.put("payments", d.Payments)
	o.put("reminders", d.Reminders)
	o.put("remindersSent", d.RemindersSent)
	pending := make([]json.RawMessage, 0, len(d.Pending))
	for _, p := range d.Pending {
		raw, _ := json.Marshal(p)
		pending = append(pending, raw)
	}
	o.put("pending", pending)
	o.put("waiverDenied", d.WaiverDenied)
	if d.CurrentLinkID != "" {
		o.put("currentLinkId", d.CurrentLinkID)
	}
	if d.PartMonth != nil {
		o.put("partMonth", d.PartMonth)
	}
	if d.BackDue {
		o.put("backDue", true)
	}
	if d.RefundIssues != nil {
		o.put("refundIssues", d.RefundIssues)
	}
	if d.StoppedRefunds != nil {
		o.put("stoppedRefunds", d.StoppedRefunds)
	}
	if d.RefundsUntold != nil {
		o.put("refundsUntold", d.RefundsUntold)
	}
	for _, x := range []struct {
		n string
		v *int64
	}{{"claimTellAtMs", d.ClaimTellAtMs}, {"discountTellAtMs", d.DiscountTellAtMs}, {"linkFailTellAtMs", d.LinkFailTellAtMs}, {"readNoteAtMs", d.ReadNoteAtMs}, {"claimAtMs", d.ClaimAtMs}} {
		if x.v != nil {
			o.put(x.n, *x.v)
		}
	}
	if d.ClaimRef != "" {
		o.put("claimRef", d.ClaimRef)
	}
	for _, m := range d.Extra {
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
	ids := make([]string, len(s.Dues))
	for i, d := range s.Dues {
		ids[i] = d.ID
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
	if s.upi != nil {
		if raw, err := s.upi.JSON(); err == nil {
			s.Upi = raw
		}
	}
	if s.links != nil {
		s.ParentLinks = s.links.json()
	}
	if s.confirmations != nil {
		s.Confirmations = s.confirmations.json()
	}
	if s.classes != nil {
		raw, err := json.Marshal(s.classes)
		if err != nil {
			return nil, err
		}
		s.Classes = raw
	}
	if s.channel != nil {
		s.Channel = s.channel.Marshal()
	}
	var started json.RawMessage
	if s.StartedAtMs != nil {
		started = json.RawMessage(strconv.FormatInt(*s.StartedAtMs, 10))
	}
	out := []runtime.Member{
		{Name: "dues", Raw: pairs(ids, s.Dues, (*Due).json)},
		{Name: "customers", Raw: pairs(phones, s.Customers, (*Customer).json)},
		{Name: "seenMessages", Raw: list(s.SeenMessages)},
		{Name: "seenEvents", Raw: list(s.SeenEvents)},
		{Name: "nextDue", Raw: json.RawMessage(fmt.Sprint(s.NextDue))},
		{Name: "nextRequest", Raw: json.RawMessage(fmt.Sprint(s.NextRequest))},
		{Name: "startedAtMs", Raw: started},
		{Name: "ai"},
		{Name: "upi", Raw: s.Upi},
		{Name: "assistant"},
		{Name: "parentLinks", Raw: s.ParentLinks},
		{Name: "confirmations", Raw: s.Confirmations},
		{Name: "classes", Raw: s.Classes},
		{Name: "channel", Raw: s.Channel},
	}
	return append(out, s.Unknown...), nil
}
