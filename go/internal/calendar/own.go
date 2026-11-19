// The shop's own booking list as a Calendar (B72, 12 Nov 2026): the Go twin of adapters/own-calendar.ts. A Bookings shop with no Google Calendar (settings "calendar": {"module":
// "own"}) still goes through the same agent code; this object answers the Calendar calls from a list kept INSIDE the shop's own saved state (`ownCalendar` in the bookings store), so it
// is saved and restored with the bookings and never forgets on a restart. The record's notes say "the shop's own booking list", so nobody reads it as Google's word.
//
// The state is OwnState: `{"events": {id: event}, "next": n}`, the same JSON the TypeScript saves (events in the same order), so a shop can move between the two runtimes and lose
// nothing; an event's own members are written in the order the struct declares them, which can differ from the TypeScript's for a hold added after an update (JSON readers do not
// care, and each runtime reads the other's order). The caller owns it (a field of its store, saved with it) and passes a pointer; the zero value is a fresh list, as `store.ownCalendar ??= { events: {}, next: 1 }` makes one.
package calendar

import (
	"context"
	"errors"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// keepAfterEnd is how long an event that has ended stays in the list before it is dropped (two days), so the saved state does not grow with the shop's age.
const keepAfterEnd = 2 * 24 * 3_600_000

// OwnState is store.ownCalendar. Next is the number the next event's id takes ("own_1" first); zero reads as 1, so a state that was never written is a new list.
type OwnState struct {
	Events Events `json:"events"`
	Next   int    `json:"next"`
}

// Own is the Calendar over an OwnState.
type Own struct {
	mu    sync.Mutex
	state *OwnState
	now   func() int64
}

var _ Calendar = (*Own)(nil)

// NewOwn is createOwnCalendar: state is the store's list, now the clock in milliseconds.
func NewOwn(state *OwnState, now func() int64) *Own {
	if state.Next == 0 {
		state.Next = 1 // `store.ownCalendar ??= { events: {}, next: 1 }`: a list that was never written starts at 1, never at own_0
	}
	return &Own{state: state, now: now}
}

// prune drops an event whose time is long past: it is of no use to the double-booking rule, and dropping it keeps the saved state small.
func (o *Own) prune() {
	now := o.now()
	for _, id := range o.state.Events.IDs() {
		if e, _ := o.state.Events.Get(id); e.End+keepAfterEnd < now {
			o.state.Events.Delete(id)
		}
	}
}

// Insert adds the event under the next "own_N" id.
func (o *Own) Insert(_ context.Context, ev NewEvent) (Event, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.prune()
	e := withID(ev, "own_"+guard.Itoa(int64(o.state.Next)))
	o.state.Next++
	o.state.Events.Set(e.ID, e)
	return copyEvent(e), nil
}

// Get is a copy of the event, or nil.
func (o *Own) Get(_ context.Context, id string) (*Event, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	e, ok := o.state.Events.Get(id)
	if !ok {
		return nil, nil
	}
	c := copyEvent(e)
	return &c, nil
}

// List is the matching events in the order they were added.
func (o *Own) List(_ context.Context, q Query) ([]Event, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := []Event{}
	for _, e := range o.state.Events.Values() {
		if matches(e, q) {
			out = append(out, copyEvent(e))
		}
	}
	return out, nil
}

// Update changes an event. An event that is no longer tentative has no hold end: the field is left out rather than a stale one kept.
func (o *Own) Update(_ context.Context, id string, p Patch) (Event, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	e, ok := o.state.Events.Get(id)
	if !ok {
		return Event{}, errors.New("No such event in the booking list.")
	}
	changed := apply(e, p)
	if changed.Status == Confirmed {
		changed.HoldExpiresAt = nil
	}
	o.state.Events.Set(id, changed)
	return copyEvent(changed), nil
}

// Delete removes an event; a missing one is no error.
func (o *Own) Delete(_ context.Context, id string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.state.Events.Delete(id)
	return nil
}

// FreeBusy is the busy stretches of the events overlapping [from, to).
func (o *Own) FreeBusy(_ context.Context, from, to int64) ([]Busy, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := []Busy{}
	for _, e := range o.state.Events.Values() {
		if overlaps(e, from, to) {
			out = append(out, Busy{Start: e.Start, End: e.End})
		}
	}
	return out, nil
}

// Conflicts is the events overlapping [start, end).
func (o *Own) Conflicts(_ context.Context, start, end int64) ([]Event, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := []Event{}
	for _, e := range o.state.Events.Values() {
		if overlaps(e, start, end) {
			out = append(out, copyEvent(e))
		}
	}
	return out, nil
}
