// Package calendar is the Bookings shop's calendar in Go: the Calendar interface its runtime calls, the live client over Google Calendar API v3 behind a Guard (google.go), the
// in-memory fake a `fakes` shop runs on (fake.go) and the shop's own booking list for `calendar.module: own` (own.go). It is the Go twin of
// templates/commerce/bookings/src/adapters/{calendar.ts, own-calendar.ts, live/google-calendar.ts}.
//
// Times are epoch milliseconds (int64), exactly as the TypeScript keeps them; they become RFC 3339 text only on the wire. The package holds no money. It sends no key: the base URL is a
// Guard in front of Google, and the only credential is the agent token Guard asks of this agent (never a Google token).
package calendar

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// Status of an event: "tentative" is a hold on the slot, "confirmed" is a booking.
const (
	Tentative = "tentative"
	Confirmed = "confirmed"
)

// Event is CalendarEvent. The JSON names and their order are the TypeScript's, because the shop's own booking list is saved with the bookings and the Go and TypeScript runtimes read
// each other's files (own.go). BookingRef is our booking id kept on the event (Google's extendedProperties.private), so a lost reply can be looked up; an event we did not make
// (the owner's own entry) reads as "foreign". HoldExpiresAt is nil when the event has no hold end (an absent member in TypeScript).
type Event struct {
	Summary       string `json:"summary"`
	Start         int64  `json:"start"`
	End           int64  `json:"end"`
	Status        string `json:"status"`
	BookingRef    string `json:"bookingRef"`
	HoldExpiresAt *int64 `json:"holdExpiresAt,omitempty"`
	ID            string `json:"id"`
}

// NewEvent is NewCalendarEvent: an event with no id yet.
type NewEvent struct {
	Summary       string
	Start, End    int64
	Status        string
	BookingRef    string
	HoldExpiresAt *int64
}

// Patch is CalendarPatch: the members to change, nil for "leave alone". HoldSet is TypeScript's `"holdExpiresAt" in patch`: the key was given, and a nil HoldExpiresAt then CLEARS the
// hold (the TypeScript passes `holdExpiresAt: undefined`, which spreads over the old value and which Google is told with a null private property).
type Patch struct {
	Summary       *string
	Start, End    *int64
	Status        *string
	HoldSet       bool
	HoldExpiresAt *int64
}

// Busy is one busy stretch [Start, End).
type Busy struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

// Query is the `list` filter. Nil members are "not given" (TypeScript's undefined): a BookingRef of "" is a real filter, as it is in the TypeScript.
type Query struct {
	From, To   *int64
	BookingRef *string
}

// Calendar is what the Bookings runtime calls (the TypeScript `Calendar`). Conflicts are events overlapping [start, end). A fake can be put behind it, so the runtime is tested the way
// it runs.
type Calendar interface {
	Insert(ctx context.Context, e NewEvent) (Event, error)
	// Get is nil, nil for an event that is not there.
	Get(ctx context.Context, id string) (*Event, error)
	List(ctx context.Context, q Query) ([]Event, error)
	Update(ctx context.Context, id string, p Patch) (Event, error)
	Delete(ctx context.Context, id string) error
	FreeBusy(ctx context.Context, from, to int64) ([]Busy, error)
	Conflicts(ctx context.Context, start, end int64) ([]Event, error)
}

// withID is `{ ...event, id }`.
func withID(e NewEvent, id string) Event {
	return Event{Summary: e.Summary, Start: e.Start, End: e.End, Status: e.Status, BookingRef: e.BookingRef, HoldExpiresAt: copyInt(e.HoldExpiresAt), ID: id}
}

// copyEvent is `{ ...e }`: a copy nobody else can change through.
func copyEvent(e Event) Event {
	e.HoldExpiresAt = copyInt(e.HoldExpiresAt)
	return e
}

func copyInt(p *int64) *int64 {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

// apply is `{ ...e, ...patch }`. Only a hold's key can be given as "present and undefined" (HoldSet); for the other members a nil is "not given", where TypeScript's spread would
// overwrite with undefined. No caller does that (agent.ts always gives start, end and status a value), and a time that is undefined would break the calendar.
func apply(e Event, p Patch) Event {
	out := copyEvent(e)
	if p.Summary != nil {
		out.Summary = *p.Summary
	}
	if p.Start != nil {
		out.Start = *p.Start
	}
	if p.End != nil {
		out.End = *p.End
	}
	if p.Status != nil {
		out.Status = *p.Status
	}
	if p.HoldSet {
		out.HoldExpiresAt = copyInt(p.HoldExpiresAt)
	}
	return out
}

func overlaps(e Event, start, end int64) bool { return e.Start < end && start < e.End }

// matches is the `list` filter of the fake and the own list: `e.end > from` and `e.start < to`, and the booking id when one is given.
func matches(e Event, q Query) bool {
	return (q.BookingRef == nil || e.BookingRef == *q.BookingRef) && (q.From == nil || e.End > *q.From) && (q.To == nil || e.Start < *q.To)
}

// ---- an insertion-ordered set of events ----------------------------------------------------------------------------------------

// Events is a JavaScript object of events keyed by id: Object.values and Object.entries come out in the order the keys were first added, and writing an existing key keeps its place.
// Go's map has no order, and the order is visible (the order of `list`), so the ids are kept in a slice beside the map. It reads and writes a JSON object in that order.
type Events struct {
	ids []string
	m   map[string]Event
}

// Get is the event with this id.
func (s *Events) Get(id string) (Event, bool) { e, ok := s.m[id]; return e, ok }

// Set adds an event, or replaces the one with its id without moving it.
func (s *Events) Set(id string, e Event) {
	if s.m == nil {
		s.m = map[string]Event{}
	}
	if _, ok := s.m[id]; !ok {
		s.ids = append(s.ids, id)
	}
	s.m[id] = e
}

// Delete removes an event; a later Set of the same id adds it at the end, as deleting and adding a key does.
func (s *Events) Delete(id string) {
	if _, ok := s.m[id]; !ok {
		return
	}
	delete(s.m, id)
	for i, x := range s.ids {
		if x == id {
			s.ids = append(s.ids[:i:i], s.ids[i+1:]...)
			break
		}
	}
}

// IDs are the keys in order.
func (s *Events) IDs() []string { return append([]string(nil), s.ids...) }

// Values are the events in order.
func (s *Events) Values() []Event {
	out := make([]Event, 0, len(s.ids))
	for _, id := range s.ids {
		out = append(out, s.m[id])
	}
	return out
}

// Len is how many events there are.
func (s *Events) Len() int { return len(s.ids) }

// MarshalJSON writes the object in key order.
func (s Events) MarshalJSON() ([]byte, error) {
	var b strings.Builder
	b.WriteByte('{')
	for i, id := range s.ids {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(id)
		v, err := json.Marshal(s.m[id])
		if err != nil {
			return nil, err
		}
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return []byte(b.String()), nil
}

// UnmarshalJSON reads an object, keeping its key order. A key that repeats keeps its first place and its last value, as JSON.parse does.
func (s *Events) UnmarshalJSON(data []byte) error {
	s.ids, s.m = nil, nil
	dec := json.NewDecoder(strings.NewReader(string(data)))
	t, err := dec.Token()
	if err != nil {
		return err
	}
	if t == nil {
		return nil
	}
	if d, ok := t.(json.Delim); !ok || d != '{' {
		return fmt.Errorf("calendar events must be a JSON object")
	}
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return err
		}
		var e Event
		if err := dec.Decode(&e); err != nil {
			return err
		}
		s.Set(kt.(string), e)
	}
	_, err = dec.Token()
	return err
}
