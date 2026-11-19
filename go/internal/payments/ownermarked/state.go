// The owner-marked ledger's state, field for field as modules/payments/owner-marked/ledger.ts keeps it under the Bookings store's `upi` member (and the other templates' stores):
// the requests the agent has sent, the owner's marks, and the refunds the owner owes. It is plain JSON the TypeScript runtime also reads and writes, so a shop can move between the two
// runtimes and lose nothing.
//
// LOSES NOTHING: every struct here carries `Extra`, the members it does not model (a later version's, or the desk's `customer`/`service`/`slotMs` that a Bookings shop never sets),
// kept raw in the order they were read and written back after the known ones. A member the TypeScript leaves out (`undefined`) is left out here (omitempty); `code` is null once used
// (`*string`, written as null, never omitted), as the TypeScript writes it.
//
// Where Go and JavaScript differ: amounts and times are int64 (the TypeScript's are integer-valued numbers; a request's or mark's amount is checked whole before it is written).
// An optional text member that is the empty string is read as "left out" (the TypeScript never writes one).
package ownermarked

import (
	"bytes"
	"encoding/json"
)

// Statuses of a request (ledger.ts MarkedRequest.status) and states of an owed refund (OwedRefund.state).
const (
	StatusCreated       = "created"
	StatusPartiallyPaid = "partially_paid"
	StatusPaid          = "paid"
	StatusCancelled     = "cancelled"

	RefundOwed = "owed"
	RefundDone = "done"
	RefundKept = "kept"
)

// member is one JSON object member kept raw.
type member struct {
	Name string
	Raw  json.RawMessage
}

// unknownMembers reads the members of a JSON object whose names are not in known, in the order the text has them.
func unknownMembers(data []byte, known map[string]bool) ([]member, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	if _, err := dec.Token(); err != nil { // the opening brace
		return nil, err
	}
	var out []member
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return nil, err
		}
		name := t.(string)
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, err
		}
		if !known[name] {
			out = append(out, member{name, raw})
		}
	}
	return out, nil
}

// withExtra writes the raw members after the known ones: base is a marshalled object.
func withExtra(base []byte, extra []member) []byte {
	if len(extra) == 0 {
		return base
	}
	var b bytes.Buffer
	b.Write(base[:len(base)-1])
	for _, m := range extra {
		if b.Len() > 1 {
			b.WriteByte(',')
		}
		n, _ := json.Marshal(m.Name)
		b.Write(n)
		b.WriteByte(':')
		b.Write(m.Raw)
	}
	b.WriteByte('}')
	return b.Bytes()
}

func keysOf(names ...string) map[string]bool {
	m := map[string]bool{}
	for _, n := range names {
		m[n] = true
	}
	return m
}

// OwnerMark is one mark by the owner: "I see this much from this request in my payment app". AfterClose is true when the request had already been closed by the agent.
type OwnerMark struct {
	ID          string   `json:"id"`
	AmountPaise int64    `json:"amountPaise"`
	AtMs        int64    `json:"atMs"`
	AfterClose  bool     `json:"afterClose,omitempty"`
	Extra       []member `json:"-"`
}

type ownerMarkAlias OwnerMark

var markKeys = keysOf("id", "amountPaise", "atMs", "afterClose")

func (m OwnerMark) MarshalJSON() ([]byte, error) {
	b, err := json.Marshal(ownerMarkAlias(m))
	return withExtra(b, m.Extra), err
}

func (m *OwnerMark) UnmarshalJSON(d []byte) error {
	var a ownerMarkAlias
	if err := json.Unmarshal(d, &a); err != nil {
		return err
	}
	x, err := unknownMembers(d, markKeys)
	if err != nil {
		return err
	}
	*m = OwnerMark(a)
	m.Extra = x
	return nil
}

// MarkedRequest is ledger.ts MarkedRequest. Code is the owner's live one-use code, nil (null) once the request is paid in full; it is never sent to the customer and never written into the record.
type MarkedRequest struct {
	ID            string      `json:"id"`        // "upi-3"
	Reference     string      `json:"reference"` // the template's reference: "b-3", "f-3.2"
	AmountPaise   int64       `json:"amountPaise"`
	Description   string      `json:"description"`
	Link          string      `json:"link"` // the provider's link (for UPI the upi://pay link); it holds the reference, never the code
	Code          *string     `json:"code"`
	UsedCodes     []string    `json:"usedCodes"`
	Status        string      `json:"status"`
	CreatedAtMs   int64       `json:"createdAtMs"`
	Marks         []OwnerMark `json:"marks"`
	AcceptPartial bool        `json:"acceptPartial,omitempty"`
	ClosedAtMs    *int64      `json:"closedAtMs,omitempty"`
	ImageLink     string      `json:"imageLink,omitempty"` // where the QR picture of the link is, once it was made
	// Customer, Service and SlotMs are the desk's (an agent someone else wrote, which has no booking of ours to name them).
	Customer string   `json:"customer,omitempty"`
	Service  string   `json:"service,omitempty"`
	SlotMs   *int64   `json:"slotMs,omitempty"`
	Extra    []member `json:"-"`
}

type requestAlias MarkedRequest

var requestKeys = keysOf("id", "reference", "amountPaise", "description", "link", "code", "usedCodes", "status", "createdAtMs", "marks", "acceptPartial", "closedAtMs", "imageLink", "customer", "service", "slotMs")

func (r MarkedRequest) MarshalJSON() ([]byte, error) {
	a := requestAlias(r)
	if a.UsedCodes == nil {
		a.UsedCodes = []string{}
	}
	if a.Marks == nil {
		a.Marks = []OwnerMark{}
	}
	b, err := json.Marshal(a)
	return withExtra(b, r.Extra), err
}

func (r *MarkedRequest) UnmarshalJSON(d []byte) error {
	var a requestAlias
	if err := json.Unmarshal(d, &a); err != nil {
		return err
	}
	x, err := unknownMembers(d, requestKeys)
	if err != nil {
		return err
	}
	*r = MarkedRequest(a)
	r.Extra = x
	return nil
}

// OwedRefund is ledger.ts OwedRefund: a refund the owner owes and pays from their own payment app.
type OwedRefund struct {
	ID               string   `json:"id"`     // "upr-2"
	CaseID           string   `json:"caseId"` // the booking or fee it belongs to
	Customer         string   `json:"customer"`
	PaymentID        string   `json:"paymentId"` // the mark it gives back
	AmountPaise      int64    `json:"amountPaise"`
	Why              string   `json:"why"`
	State            string   `json:"state"` // owed, done or kept
	Code             *string  `json:"code"`  // the owner's one-use code to mark it done; null once used
	UsedCodes        []string `json:"usedCodes"`
	OwedAtMs         int64    `json:"owedAtMs"`
	Reminders        int64    `json:"reminders"`
	NextReminderAtMs int64    `json:"nextReminderAtMs"`
	// KeepAllowed: the owner may also say "kept" (money paid for something they will give another way). Only offered where that is true.
	KeepAllowed bool     `json:"keepAllowed,omitempty"`
	DoneAtMs    *int64   `json:"doneAtMs,omitempty"`
	Extra       []member `json:"-"`
}

type refundAlias OwedRefund

var refundKeys = keysOf("id", "caseId", "customer", "paymentId", "amountPaise", "why", "state", "code", "usedCodes", "owedAtMs", "reminders", "nextReminderAtMs", "keepAllowed", "doneAtMs")

func (r OwedRefund) MarshalJSON() ([]byte, error) {
	a := refundAlias(r)
	if a.UsedCodes == nil {
		a.UsedCodes = []string{}
	}
	b, err := json.Marshal(a)
	return withExtra(b, r.Extra), err
}

func (r *OwedRefund) UnmarshalJSON(d []byte) error {
	var a refundAlias
	if err := json.Unmarshal(d, &a); err != nil {
		return err
	}
	x, err := unknownMembers(d, refundKeys)
	if err != nil {
		return err
	}
	*r = OwedRefund(a)
	r.Extra = x
	return nil
}

// State is ledger.ts MarkState: the counter every id and mark is numbered from, the requests and the owed refunds. Requests and Refunds are pointers so a caller changes one in place.
type State struct {
	Seq      int64            `json:"seq"`
	Requests []*MarkedRequest `json:"requests"`
	Refunds  []*OwedRefund    `json:"refunds"`
	Extra    []member         `json:"-"`
}

type stateAlias State

var stateKeys = keysOf("seq", "requests", "refunds")

// Empty is emptyMarkState: a fresh shop starts with nothing sent, marked or owed.
func Empty() *State { return &State{Requests: []*MarkedRequest{}, Refunds: []*OwedRefund{}} }

func (s State) MarshalJSON() ([]byte, error) {
	a := stateAlias(s)
	if a.Requests == nil {
		a.Requests = []*MarkedRequest{}
	}
	if a.Refunds == nil {
		a.Refunds = []*OwedRefund{}
	}
	b, err := json.Marshal(a)
	return withExtra(b, s.Extra), err
}

func (s *State) UnmarshalJSON(d []byte) error {
	var a stateAlias
	if err := json.Unmarshal(d, &a); err != nil {
		return err
	}
	x, err := unknownMembers(d, stateKeys)
	if err != nil {
		return err
	}
	*s = State(a)
	s.Extra = x
	if s.Requests == nil {
		s.Requests = []*MarkedRequest{}
	}
	if s.Refunds == nil {
		s.Refunds = []*OwedRefund{}
	}
	return nil
}

// Parse reads the store's `upi` member; an empty or missing one is a fresh state (the member is left out until the first request).
func Parse(raw json.RawMessage) (*State, error) {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return Empty(), nil
	}
	s := &State{}
	if err := json.Unmarshal(raw, s); err != nil {
		return nil, err
	}
	return s, nil
}

// JSON writes the state as the store's `upi` member.
func (s *State) JSON() (json.RawMessage, error) { return json.Marshal(s) }
