// The in-memory fake calendar a `fakes` shop runs on and the Bookings runtime's tests use: the Go twin of createFakeCalendar in adapters/calendar.ts. Its own store is the record the
// agent must read back before it says "booked", and it can be told to fail the ways a real calendar fails (a call that answers "ok" and stores nothing, a reply that is lost after the
// event was stored, a slot taken a moment ago, a 500), once or for a number of calls, optionally after some good ones, so the runtime's handling of each is exercised.
//
// Ids are "ev_1", "ev_2", ...; a foreign event (the owner's own entry, another booking channel) has the booking id "foreign". Events keep the order they were added in, as the
// TypeScript's Map does, because `list` answers in that order.
package calendar

import (
	"context"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// Op names a fake call; Fault a way it can go wrong.
type Op string

// The operations a fault can be put on.
const (
	OpInsert    Op = "insert"
	OpGet       Op = "get"
	OpList      Op = "list"
	OpUpdate    Op = "update"
	OpDelete    Op = "delete"
	OpFreeBusy  Op = "freeBusy"
	OpConflicts Op = "conflicts"
)

// Fault is CalendarFault: silentFailure (answers ok, stores nothing), lostReply (stored, then the client sees a timeout), conflict (someone took the slot a moment ago; insert only),
// error (the service answers 500).
type Fault string

// The ways a call can go wrong.
const (
	SilentFailure Fault = "silentFailure"
	LostReply     Fault = "lostReply"
	TookSlot      Fault = "conflict"
	ServerError   Fault = "error"
)

// FaultOptions is FaultOptions of core/faults.ts: Times calls fail (default 1; zero or less also reads as 1, as in the TypeScript), after After good calls.
type FaultOptions struct{ Times, After int }

type plan struct {
	mode         Fault
	times, after int
}

// Fake is FakeCalendar: a Calendar plus what a test needs.
type Fake struct {
	mu     sync.Mutex
	store  Events
	plans  map[Op][]*plan
	calls  []Op
	nextID int
}

var _ Calendar = (*Fake)(nil)

// NewFake is createFakeCalendar.
func NewFake() *Fake { return &Fake{plans: map[Op][]*plan{}, nextID: 1} }

// Inject plans a fault on an operation (faults.inject): plans on one operation are used in the order they were added.
func (f *Fake) Inject(op Op, mode Fault, o FaultOptions) {
	f.mu.Lock()
	defer f.mu.Unlock()
	times := o.Times
	if times == 0 {
		times = 1
	}
	f.plans[op] = append(f.plans[op], &plan{mode: mode, times: times, after: o.After})
}

// take is faults.take: the fault for this call, if any.
func (f *Fake) take(op Op) (Fault, bool) {
	list := f.plans[op]
	if len(list) == 0 {
		return "", false
	}
	p := list[0]
	if p.after > 0 {
		p.after--
		return "", false
	}
	p.times--
	if p.times <= 0 {
		f.plans[op] = list[1:]
	}
	return p.mode, true
}

// Calls is every call made, in order, whether it worked or not.
func (f *Fake) Calls() []Op {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Op(nil), f.calls...)
}

// Events is everything actually stored, which is what a test asserts against.
func (f *Fake) Events() []Event {
	f.mu.Lock()
	defer f.mu.Unlock()
	return copyAll(f.store.Values())
}

func copyAll(es []Event) []Event {
	out := make([]Event, len(es))
	for i, e := range es {
		out[i] = copyEvent(e)
	}
	return out
}

func (f *Fake) newID() string {
	id := "ev_" + guard.Itoa(int64(f.nextID))
	f.nextID++
	return id
}

// AddForeignEvent is an event made by someone else; the summary is "Busy" when none is given.
func (f *Fake) AddForeignEvent(start, end int64, summary string) Event {
	f.mu.Lock()
	defer f.mu.Unlock()
	if summary == "" {
		summary = "Busy"
	}
	e := Event{ID: f.newID(), Summary: summary, Start: start, End: end, Status: Confirmed, BookingRef: "foreign"}
	f.store.Set(e.ID, e)
	return copyEvent(e)
}

// begin records the call; a read can only fail with an error (500).
func (f *Fake) begin(op Op) (Fault, bool, error) {
	f.calls = append(f.calls, op)
	fault, ok := f.take(op)
	if ok && fault == ServerError {
		return "", false, &guard.ApiError{Status: 500, Message: "calendar " + string(op) + ": internal error"}
	}
	return fault, ok, nil
}

// Insert stores the event under a new id.
func (f *Fake) Insert(_ context.Context, ev NewEvent) (Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fault, _, err := f.begin(OpInsert)
	if err != nil {
		return Event{}, err
	}
	e := withID(ev, f.newID())
	switch fault {
	case SilentFailure:
		return copyEvent(e), nil // looks saved, is not
	case TookSlot:
		other := Event{ID: f.newID(), Summary: "Busy", Start: e.Start, End: e.End, Status: Confirmed, BookingRef: "foreign"}
		f.store.Set(other.ID, other)
		return Event{}, &guard.ConflictError{Message: "That time was just taken."}
	}
	f.store.Set(e.ID, e)
	if fault == LostReply {
		return Event{}, &guard.TimeoutError{What: "calendar insert"}
	}
	return copyEvent(e), nil
}

// Get is a copy of the event, or nil.
func (f *Fake) Get(_ context.Context, id string) (*Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, _, err := f.begin(OpGet); err != nil {
		return nil, err
	}
	e, ok := f.store.Get(id)
	if !ok {
		return nil, nil
	}
	c := copyEvent(e)
	return &c, nil
}

// List is the matching events in the order they were added.
func (f *Fake) List(_ context.Context, q Query) ([]Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, _, err := f.begin(OpList); err != nil {
		return nil, err
	}
	out := []Event{}
	for _, e := range f.store.Values() {
		if matches(e, q) {
			out = append(out, copyEvent(e))
		}
	}
	return out, nil
}

// Update changes an event; a missing one is a 404.
func (f *Fake) Update(_ context.Context, id string, p Patch) (Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fault, _, err := f.begin(OpUpdate)
	if err != nil {
		return Event{}, err
	}
	e, ok := f.store.Get(id)
	if !ok {
		return Event{}, &guard.ApiError{Status: 404, Message: "No such event."}
	}
	changed := apply(e, p)
	if fault == SilentFailure {
		return changed, nil // says it changed, nothing did
	}
	f.store.Set(id, changed)
	if fault == LostReply {
		return Event{}, &guard.TimeoutError{What: "calendar update"}
	}
	return copyEvent(changed), nil
}

// Delete removes an event; a missing one is no error.
func (f *Fake) Delete(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	fault, _, err := f.begin(OpDelete)
	if err != nil {
		return err
	}
	if fault == SilentFailure {
		return nil
	}
	f.store.Delete(id)
	if fault == LostReply {
		return &guard.TimeoutError{What: "calendar delete"}
	}
	return nil
}

// FreeBusy is the busy stretches of the stored events overlapping [from, to).
func (f *Fake) FreeBusy(_ context.Context, from, to int64) ([]Busy, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, _, err := f.begin(OpFreeBusy); err != nil {
		return nil, err
	}
	out := []Busy{}
	for _, e := range f.store.Values() {
		if overlaps(e, from, to) {
			out = append(out, Busy{Start: e.Start, End: e.End})
		}
	}
	return out, nil
}

// Conflicts is the stored events overlapping [start, end).
func (f *Fake) Conflicts(_ context.Context, start, end int64) ([]Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, _, err := f.begin(OpConflicts); err != nil {
		return nil, err
	}
	out := []Event{}
	for _, e := range f.store.Values() {
		if overlaps(e, start, end) {
			out = append(out, copyEvent(e))
		}
	}
	return out, nil
}
