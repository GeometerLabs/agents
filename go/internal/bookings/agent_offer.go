package bookings

// What to offer (the shop's services, free times, a few buttons) and the calendar (look first, write, read back): agent.ts's sections "what to offer" and "the calendar", with
// the booking's draft (fill, settle, clearSlot) and the slot rules every hold and move passes (slotRules, takenMeanwhile). Free times come from FreeOnDay (rules.go), the one
// place they are worked out, over the calendar's events and the shop's own holds.
//
// A booking's draft members (`date`, `timePhrase`, `time`, `reschedule`) are booking.ts's own JSON, kept in Booking.Extra (state.go) in the TypeScript's shapes, so a shop moves
// between the runtimes mid-conversation and loses nothing.

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/GeometerLabs/agents/go/internal/calendar"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

const (
	offerDays = 7 // free times are looked for a week ahead
	offerRows = 9 // a list holds ten rows, and the last is the row that reaches the owner
	attempts  = 2 // modules/payments/links.ts ATTEMPTS, which the calendar's look-first loop also uses
	// channelDaysAhead is channels/state.ts CHANNEL_LIMITS.daysAhead: how far ahead a booking may start.
	channelDaysAhead = 30
)

// ---- the shop's own booking list, made on first use (own-calendar.ts `store.ownCalendar ??= ...` in every call) ------------------------------------------------------

type ownCal struct {
	st  *Store
	now func() int64
}

func (s *Store) ownList(now func() int64) *calendar.Own {
	if s.own == nil {
		s.own = &calendar.OwnState{}
		if s.OwnCalendar != nil {
			_ = json.Unmarshal(s.OwnCalendar, s.own)
		}
	}
	return calendar.NewOwn(s.own, now)
}

func (o ownCal) Insert(ctx context.Context, e calendar.NewEvent) (calendar.Event, error) { return o.st.ownList(o.now).Insert(ctx, e) }
func (o ownCal) Get(ctx context.Context, id string) (*calendar.Event, error)              { return o.st.ownList(o.now).Get(ctx, id) }
func (o ownCal) List(ctx context.Context, q calendar.Query) ([]calendar.Event, error)     { return o.st.ownList(o.now).List(ctx, q) }
func (o ownCal) Update(ctx context.Context, id string, p calendar.Patch) (calendar.Event, error) {
	return o.st.ownList(o.now).Update(ctx, id, p)
}
func (o ownCal) Delete(ctx context.Context, id string) error { return o.st.ownList(o.now).Delete(ctx, id) }
func (o ownCal) FreeBusy(ctx context.Context, from, to int64) ([]calendar.Busy, error) {
	return o.st.ownList(o.now).FreeBusy(ctx, from, to)
}
func (o ownCal) Conflicts(ctx context.Context, start, end int64) ([]calendar.Event, error) {
	return o.st.ownList(o.now).Conflicts(ctx, start, end)
}

// ---- a booking's draft members (booking.ts Booking.date, timePhrase, time, reschedule) -----------------------------------------------------------------------------

// TimePhrase is dates.ts TimePhrase.
type TimePhrase struct {
	Hour   int    `json:"hour"`
	Minute int    `json:"minute"`
	Period string `json:"period,omitempty"`
}

// clockTime is time.ts LocalTime.
type clockTime struct {
	Hour   int `json:"hour"`
	Minute int `json:"minute"`
}

// move is booking.ts Booking.reschedule.
type move struct {
	Date       zone.Date  `json:"date"`
	TimePhrase TimePhrase `json:"timePhrase"`
	StartMs    int64      `json:"startMs"`
	EndMs      int64      `json:"endMs"`
}

// dateJSON is zone.Date in time.ts's own member names.
type dateJSON struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Day   int `json:"day"`
}

func (b *Booking) extra(name string, v any) bool {
	for _, m := range b.Extra {
		if m.Name == name {
			return json.Unmarshal(m.Raw, v) == nil
		}
	}
	return false
}

func (b *Booking) setExtra(name string, v any) {
	raw, _ := json.Marshal(v)
	for i := range b.Extra {
		if b.Extra[i].Name == name {
			b.Extra[i].Raw = raw
			return
		}
	}
	b.Extra = append(b.Extra, runtime.Member{Name: name, Raw: raw})
}

func (b *Booking) delExtra(names ...string) {
	out := b.Extra[:0]
	for _, m := range b.Extra {
		if !contains(names, m.Name) {
			out = append(out, m)
		}
	}
	b.Extra = out
}

func (b *Booking) date() *zone.Date {
	var d dateJSON
	if !b.extra("date", &d) {
		return nil
	}
	return &zone.Date{Year: d.Year, Month: d.Month, Day: d.Day}
}

func (b *Booking) setDate(d zone.Date) { b.setExtra("date", dateJSON{d.Year, d.Month, d.Day}) }

func (b *Booking) timePhrase() *TimePhrase {
	var t TimePhrase
	if !b.extra("timePhrase", &t) {
		return nil
	}
	return &t
}

func (b *Booking) reschedule() *move {
	var m struct {
		Date       dateJSON   `json:"date"`
		TimePhrase TimePhrase `json:"timePhrase"`
		StartMs    int64      `json:"startMs"`
		EndMs      int64      `json:"endMs"`
	}
	if !b.extra("reschedule", &m) {
		return nil
	}
	return &move{zone.Date{Year: m.Date.Year, Month: m.Date.Month, Day: m.Date.Day}, m.TimePhrase, m.StartMs, m.EndMs}
}

func (b *Booking) setReschedule(m *move) {
	if m == nil {
		b.delExtra("reschedule")
		return
	}
	b.setExtra("reschedule", map[string]any{"date": dateJSON{m.Date.Year, m.Date.Month, m.Date.Day}, "timePhrase": m.TimePhrase, "startMs": m.StartMs, "endMs": m.EndMs})
}

func (b *Booking) setReminders(rs []Reminder) {
	raw, _ := json.Marshal(rs)
	b.Reminders = raw
}

func (b *Booking) reminders() []Reminder {
	var rs []Reminder
	_ = json.Unmarshal(b.Reminders, &rs)
	return rs
}

// phraseOf is an Intent's time (model.ts TimePhrase as the checked object).
func phraseOf(m map[string]any) *TimePhrase {
	if m == nil {
		return nil
	}
	h, _ := m["hour"].(float64)
	mi, _ := m["minute"].(float64)
	p, _ := m["period"].(string)
	return &TimePhrase{Hour: int(h), Minute: int(mi), Period: p}
}

// datePhraseOf is an Intent's date as language.DatePhrase.
func datePhraseOf(m map[string]any) *language.DatePhrase {
	if m == nil {
		return nil
	}
	n := func(k string) int { f, _ := m[k].(float64); return int(f) }
	kind, _ := m["kind"].(string)
	which, _ := m["which"].(string)
	return &language.DatePhrase{Kind: kind, Offset: n("offsetDays"), Weekday: n("weekday"), Which: which, Day: n("day"), Month: n("month")}
}

// resolveDate is dates.ts resolveDate over the shop's zone: the date and whether the customer is asked to confirm it (a weekday is; a relative or written date is not).
func (a *Agent) resolveDate(p language.DatePhrase) (zone.Date, bool, bool) {
	today := zone.LocalParts(a.now(), a.settings.Timezone)
	if p.Kind == "relative" {
		return zone.AddDays(today.Date, p.Offset), false, true
	}
	if p.Kind == "calendar" {
		year := today.Year
		if zone.DaysBetween(today.Date, zone.Date{Year: year, Month: p.Month, Day: p.Day}) < 0 {
			year++ // already gone this year: next year
		}
		if check := zone.AddDays(zone.Date{Year: year, Month: p.Month, Day: 1}, p.Day-1); check.Month != p.Month {
			return zone.Date{}, false, false
		}
		return zone.Date{Year: year, Month: p.Month, Day: p.Day}, false, true
	}
	monday := func(d int) int { return (d + 6) % 7 } // weeks run Monday (0) to Sunday (6)
	target, now := monday(p.Weekday), monday(today.Weekday)
	var offset int
	switch p.Which {
	case "next":
		offset = 7 - now + target
	case "this":
		offset = target - now
		if target < now {
			offset += 7
		}
	default:
		offset = (target - now + 7) % 7
		if offset == 0 {
			offset = 7
		}
	}
	return zone.AddDays(today.Date, offset), true, true
}

// resolveTime is dates.ts resolveTime: a clock time from the customer's phrase, and whether am or pm was inferred from the day's hours.
func resolveTime(p TimePhrase, hours *Hours) (clockTime, bool) {
	switch {
	case p.Period == "pm":
		if p.Hour == 12 {
			return clockTime{12, p.Minute}, false
		}
		return clockTime{p.Hour + 12, p.Minute}, false
	case p.Period == "am":
		if p.Hour == 12 {
			return clockTime{0, p.Minute}, false
		}
		return clockTime{p.Hour, p.Minute}, false
	case p.Hour == 0 || p.Hour >= 12:
		return clockTime{p.Hour, p.Minute}, false // 24-hour time, or noon
	}
	var inside []int
	for _, c := range []int{p.Hour, p.Hour + 12} {
		if hours != nil && c*60+p.Minute >= hours.Open && c*60+p.Minute < hours.Close {
			inside = append(inside, c)
		}
	}
	chosen := p.Hour + 12 // otherwise: 7-11 is morning, 1-6 afternoon
	if len(inside) == 1 {
		chosen = inside[0]
	} else if p.Hour >= 7 {
		chosen = p.Hour
	}
	return clockTime{chosen, p.Minute}, true
}

// fill is agent.ts fill: what the customer said goes into the draft. False when a date does not exist (31 November).
func (a *Agent) fill(b *Booking, in *Intent) bool {
	if in.ServiceID != "" {
		b.ServiceID = in.ServiceID
	}
	if dp := datePhraseOf(in.Date); dp != nil {
		d, confirm, ok := a.resolveDate(*dp)
		if !ok {
			return false
		}
		b.setDate(d)
		b.DateNeedsConfirmation = confirm
	}
	if tp := phraseOf(in.Time); tp != nil {
		b.setExtra("timePhrase", tp)
	}
	return true
}

// settle is agent.ts settle: the exact start and end from the draft, if it is complete.
func (a *Agent) settle(b *Booking) bool {
	d, tp := b.date(), b.timePhrase()
	if d == nil || tp == nil {
		return false
	}
	t, inferred := resolveTime(*tp, a.settings.HoursOn(zone.WeekdayOf(*d)))
	b.setExtra("time", t)
	b.TimeInferred = inferred
	start := zone.ZonedToMs(*d, t.Hour, t.Minute, a.settings.Timezone)
	b.StartMs = &start
	b.EndMs = nil
	if sv := a.settings.ServiceByID(b.ServiceID); sv != nil {
		end := start + sv.DurationMinutes*Minute
		b.EndMs = &end
	}
	return true
}

// clearSlot is agent.ts clearSlot.
func (a *Agent) clearSlot(b *Booking) {
	b.delExtra("date", "timePhrase", "time")
	b.StartMs, b.EndMs = nil, nil
	b.DateNeedsConfirmation, b.TimeInferred = false, false
}

// ---- what to offer ----------------------------------------------------------------------------------------------------------------------------------------------------

// closedDays are the dates the owner closed through the shop's assistant (item 11e); the free times and the within-hours limit leave them out.
func (a *Agent) closedDays() []string {
	if a.c != nil && a.c.Snap != nil && a.c.Snap.A != nil {
		return a.c.Snap.A.ClosedDays
	}
	return nil
}

// busyOf is agent.ts busyOf: a tentative event (a hold) stops blocking when its hold ends; an event that is not one of this shop's bookings blocks every resource.
func (a *Agent) busyOf(e calendar.Event) BusyEvent {
	out := BusyEvent{Start: e.Start, End: e.End, BookingRef: e.BookingRef}
	if e.Status == "tentative" {
		out.TentativeUntil = e.HoldExpiresAt
	}
	if x := a.store.Booking(e.BookingRef); x != nil {
		out.Resource = resourceOf(a.settings.ServiceByID(x.ServiceID))
	}
	return out
}

// busyBetween is agent.ts busyBetween: the calendar's events and the shop's own holds. An error when the calendar cannot be read.
func (a *Agent) busyBetween(from, to int64) ([]BusyEvent, error) {
	buf := a.settings.BufferMinutes * Minute
	events, err := a.cal.Conflicts(a.ctx, from-buf, to+buf)
	if err != nil {
		return nil, err
	}
	out := make([]BusyEvent, 0, len(events))
	for _, e := range events {
		out = append(out, a.busyOf(e))
	}
	return append(out, HeldByBookings(a.store, a.settings, "")...), nil
}

// freeSlots is agent.ts freeSlots: up to `limit` free starts of this service in the next week, at most three a day (spread through the day), earliest first; none when the
// calendar cannot be read (the customer is then asked to type a time).
func (a *Agent) freeSlots(serviceID string, limit int) []int64 {
	sv := a.settings.ServiceByID(serviceID)
	if sv == nil {
		// the shortest service (a stable sort: the first of equals)
		ss := append([]Service(nil), a.settings.Services...)
		sort.SliceStable(ss, func(i, j int) bool { return ss[i].DurationMinutes < ss[j].DurationMinutes })
		sv = &ss[0]
	}
	now := a.now()
	today := zone.LocalParts(now, a.settings.Timezone).Date
	others, err := a.busyBetween(now, now+(offerDays+2)*Day)
	if err != nil {
		return []int64{}
	}
	out := []int64{}
	for day := 0; day < offerDays && len(out) < limit; day++ {
		free := FreeOnDay(a.settings, sv, zone.AddDays(today, day), others, now, a.closedDays())
		if len(free) == 0 {
			continue
		}
		seen := map[int]bool{}
		for _, i := range []int{0, (len(free) - 1) / 2, len(free) - 1} {
			if !seen[i] && len(out) < limit {
				seen[i] = true
				out = append(out, free[i])
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// DayStarts is one day of FreeStarts.
type DayStarts struct {
	Date   string  `json:"date"`
	Starts []int64 `json:"starts"`
}

// FreeStarts is agent.ts freeStarts (item 11d): every free start of one service, day by day, for the booking page and its API. A read only; an error when the calendar cannot be read.
func (a *Agent) FreeStarts(serviceID string, from *zone.Date, days int) ([]DayStarts, error) {
	sv := a.settings.ServiceByID(serviceID)
	if sv == nil {
		return []DayStarts{}, nil
	}
	tz := a.settings.Timezone
	now := a.now()
	today := zone.LocalParts(now, tz).Date
	first := today
	if from != nil && zone.ZonedToMs(*from, 0, 0, tz) > zone.ZonedToMs(today, 0, 0, tz) {
		first = *from
	}
	firstMs := zone.ZonedToMs(first, 0, 0, tz)
	lastAllowed := now + channelDaysAhead*Day
	others, err := a.busyBetween(max(now, firstMs), firstMs+int64(days+1)*Day)
	if err != nil {
		return nil, err
	}
	out := []DayStarts{}
	for day := 0; day < days; day++ {
		date := zone.AddDays(first, day)
		if zone.ZonedToMs(date, 0, 0, tz) > lastAllowed {
			break
		}
		starts := []int64{}
		for _, t := range FreeOnDay(a.settings, sv, date, others, now, a.closedDays()) {
			if t <= lastAllowed {
				starts = append(starts, t)
			}
		}
		out = append(out, DayStarts{isoDate(date), starts})
	}
	return out, nil
}

// candidateSlots is agent.ts candidateSlots: the same free times as the decision model may pick from, each as the date and clock time a customer could have written.
func (a *Agent) candidateSlots(serviceID string) []CandidateSlot {
	var out []CandidateSlot
	for _, start := range a.freeSlots(serviceID, 6) {
		p := zone.LocalParts(start, a.settings.Timezone)
		h := p.Hour % 12
		if h == 0 {
			h = 12
		}
		period := "pm"
		if p.Hour < 12 {
			period = "am"
		}
		out = append(out, CandidateSlot{StartMs: start, Date: map[string]any{"kind": "calendar", "day": p.Day, "month": p.Month},
			Time: map[string]any{"hour": h, "minute": p.Minute, "period": period}, Label: language.Formats("en").Slot(start, a.settings.Loc)})
	}
	return out
}

// slotsOffer is agent.ts slotsOffer: the list of free times under these words, or nil when there are none.
func (a *Agent) slotsOffer(serviceID string, body ...string) *offer {
	if slots := a.freeSlots(serviceID, offerRows); len(slots) > 0 {
		return &offer{kind: "slots", slots: slots, body: body}
	}
	return nil
}

// ---- the calendar: look first, write, read back ---------------------------------------------------------------------------------------------------------------------

type wanted struct {
	Start  int64  `json:"start"`
	End    int64  `json:"end"`
	Status string `json:"status"`
}

type ensured struct {
	event     *calendar.Event
	err       string
	conflict  bool
	suspended *guard.GuardError
}

// retryable is `e instanceof TimeoutError || e instanceof ApiError` (every Guard error, NotSent and Conflict are ApiErrors in the TypeScript).
func retryable(err error) bool {
	_, api := guard.IsAPI(err)
	return guard.IsTimeout(err) || api
}

func ptr[T any](v T) *T { return &v }

// ensureEvent is agent.ts ensureEvent: make the calendar show this booking's event as wanted; the event only if the calendar's own list shows it.
func (a *Agent) ensureEvent(b *Booking, want wanted) (ensured, error) {
	matches := func(e calendar.Event) bool { return e.Start == want.Start && e.End == want.End && e.Status == want.Status }
	var hold *int64
	if want.Status == "tentative" {
		hold = b.HoldExpiresAt
	}
	ref := b.ID
	q := calendar.Query{BookingRef: &ref}
	find := func(l []calendar.Event) *calendar.Event {
		for i := range l {
			if matches(l[i]) {
				return &l[i]
			}
		}
		return nil
	}
	var lastErr string
	for attempt := 0; attempt < attempts; attempt++ {
		res, done, err := func() (ensured, bool, error) {
			before, err := a.cal.List(a.ctx, q) // look first: an earlier try (a lost reply) may have landed
			if err != nil {
				return ensured{}, false, err
			}
			if found := find(before); found != nil {
				// a rerun after a wait for a Guard finds the hold its first try left; the calendar must show the hold's new end
				if want.Status == "tentative" && !sameHold(found.HoldExpiresAt, hold) {
					if _, err := a.cal.Update(a.ctx, found.ID, calendar.Patch{Start: &want.Start, End: &want.End, Status: &want.Status, HoldSet: true, HoldExpiresAt: hold}); err != nil {
						return ensured{}, false, err
					}
				}
				return ensured{event: found}, true, nil
			}
			if len(before) > 0 {
				if _, err := a.cal.Update(a.ctx, before[0].ID, calendar.Patch{Start: &want.Start, End: &want.End, Status: &want.Status, HoldSet: true, HoldExpiresAt: hold}); err != nil {
					return ensured{}, false, err
				}
			} else {
				name := "booking"
				if sv := a.settings.ServiceByID(b.ServiceID); sv != nil {
					name = sv.ID
				}
				if _, err := a.cal.Insert(a.ctx, calendar.NewEvent{Summary: name + " · " + b.Customer, Start: want.Start, End: want.End, Status: want.Status, BookingRef: b.ID, HoldExpiresAt: hold}); err != nil {
					return ensured{}, false, err
				}
			}
			after, err := a.cal.List(a.ctx, q) // read back from the calendar's own list
			if err != nil {
				return ensured{}, false, err
			}
			if found := find(after); found != nil {
				return ensured{event: found}, true, nil
			}
			return ensured{}, false, nil
		}()
		if err != nil {
			var c *guard.ConflictError
			if errors.As(err, &c) {
				return ensured{err: err.Error(), conflict: true}, nil
			}
			if g, ok := guard.AsGuard(err); ok && g.Kind == guard.KindSuspended {
				return ensured{err: err.Error(), suspended: g}, nil // Guard held it back for the licence: nothing was sent, never tried again
			}
			if !retryable(err) {
				return ensured{}, err
			}
			lastErr = err.Error()
			continue
		}
		if done {
			return res, nil
		}
	}
	// the last write may have landed too
	if l, err := a.cal.List(a.ctx, q); err == nil {
		if found := find(l); found != nil {
			return ensured{event: found}, nil
		}
	}
	return ensured{err: lastErr}, nil
}

func sameHold(x, y *int64) bool { return (x == nil && y == nil) || (x != nil && y != nil && *x == *y) }

// removeEvents is agent.ts removeEvents: delete every event this booking has, and check the calendar agrees.
func (a *Agent) removeEvents(b *Booking) (bool, error) {
	ref := b.ID
	q := calendar.Query{BookingRef: &ref}
	for attempt := 0; attempt < attempts; attempt++ {
		events, err := a.cal.List(a.ctx, q)
		if err != nil {
			if !retryable(err) {
				return false, err
			}
			continue
		}
		if len(events) == 0 {
			return true, nil
		}
		for _, e := range events {
			_ = a.cal.Delete(a.ctx, e.ID)
		}
	}
	l, err := a.cal.List(a.ctx, q)
	return err == nil && len(l) == 0, nil
}

// releaseSlot is agent.ts releaseSlot.
func (a *Agent) releaseSlot(b *Booking, why string) {
	gone, _ := a.removeEvents(b) // `.catch(() => false)`
	outcome := "unconfirmed"
	if gone {
		outcome = "confirmed"
	}
	var eventID any
	if b.EventID != "" {
		eventID = b.EventID
	}
	a.log(b, b.Customer, "release_slot", outcome, map[string]any{"eventId": eventID}, logMore{notes: why})
	if gone {
		b.EventID, b.HoldExpiresAt = "", nil
	}
}

// slotRules is agent.ts slotRules: within hours, and no double booking (the calendar near the time and the shop's own holds).
func (a *Agent) slotRules(b *Booking, start, end int64) (hours, clash Decision, err error) {
	buf := a.settings.BufferMinutes * Minute
	nearby, err := a.cal.Conflicts(a.ctx, start-buf, end+buf)
	if err != nil {
		return Decision{}, Decision{}, err
	}
	sv := a.settings.ServiceByID(b.ServiceID)
	others := make([]BusyEvent, 0, len(nearby))
	for _, e := range nearby {
		others = append(others, a.busyOf(e))
	}
	others = append(others, HeldByBookings(a.store, a.settings, b.ID)...)
	return CheckWithinHours(a.settings, sv, start, a.closedDays()),
		CheckNoDoubleBooking(start, end, a.settings.BufferMinutes, b.ID, others, a.now(), resourceOf(sv), a.settings.UnitsFor(sv)), nil
}

// takenMeanwhile is agent.ts takenMeanwhile: after this booking's hold is written, did anyone else write an event on the same time? clash nil: not taken; unread "": it was read.
func (a *Agent) takenMeanwhile(b *Booking, start, end int64) (clash *Decision, unread string, err error) {
	buf := a.settings.BufferMinutes * Minute
	nearby, err := a.cal.Conflicts(a.ctx, start-buf, end+buf)
	if err != nil {
		if !retryable(err) {
			return nil, "", err
		}
		return nil, err.Error(), nil
	}
	sv := a.settings.ServiceByID(b.ServiceID)
	others := make([]BusyEvent, 0, len(nearby))
	for _, e := range nearby {
		others = append(others, a.busyOf(e))
	}
	d := CheckNoDoubleBooking(start, end, a.settings.BufferMinutes, b.ID, others, a.now(), resourceOf(sv), a.settings.UnitsFor(sv))
	if d.Blocked() {
		return &d, "", nil
	}
	return nil, "", nil
}
