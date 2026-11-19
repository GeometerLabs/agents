// The calendar over Google Calendar API v3, mapped to the Calendar interface: the Go twin of live/google-calendar.ts. No token, no Authorization header of Google's: the base URL is a
// Guard in front of https://www.googleapis.com (or a stand-in), and the only credential is the agent token Guard asks of this agent.
//
// Wire facts (Google's own docs, as the TypeScript records them): events.insert POST /calendar/v3/calendars/{id}/events with summary, start/end.dateTime in RFC 3339, status and
// extendedProperties.private {bookingRef, holdExpiresAt}; events.list GET .../events?singleEvents=true&maxResults=250&pageToken&timeMin&timeMax&privateExtendedProperty=bookingRef=..
// (timeMin bounds an event's END and timeMax its START, so "overlapping [start, end)" is exactly timeMin=start, timeMax=end); events.patch PATCH .../events/{id}, where the private map is
// read first and sent whole; events.delete; freeBusy POST /calendar/v3/freeBusy. Every write carries ?sendUpdates=none so no guest is mailed.
//
// Every request's bytes are what the TypeScript sends: the path with the calendar id as encodeURIComponent writes it (guard.EncodeURIComponent: @ and : are escaped), the query in the
// TypeScript's order, the body's members in the TypeScript literal's order, and times as `new Date(ms).toISOString()` (always UTC, with milliseconds). Google never refuses an
// overlapping insert, so the agent looks at conflicts before and after (agent.ts tryHold); a 409 can only mean a duplicate id and is a ConflictError.
package calendar

import (
	"context"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// Config is GoogleCalendarConfig: the Guard's address, the calendar's id, a timeout (0: ten seconds) and the credential Guard asks of this agent ("" sends no Authorization header).
type Config struct {
	BaseURL    string
	CalendarID string
	TimeoutMs  int
	AgentToken string
}

const maxPages = 20

// Google is the live Calendar.
type Google struct {
	http       guard.Http
	calendarID string
	base       string
}

var _ Calendar = (*Google)(nil)

// New is createGoogleCalendar.
func New(c Config) (*Google, error) {
	h, err := guard.New(c.BaseURL, "Google Calendar", c.TimeoutMs, c.AgentToken)
	if err != nil {
		return nil, err
	}
	return NewWithHTTP(h, c.CalendarID), nil
}

// NewWithHTTP builds the client over any guard.Http (a test's, or a stand-in's).
func NewWithHTTP(h guard.Http, calendarID string) *Google {
	return &Google{http: h, calendarID: calendarID, base: "/calendar/v3/calendars/" + guard.EncodeURIComponent(calendarID)}
}

// ---- wire <-> our types ----------------------------------------------------------------------------------------------------------

// DescribeError is Google's words for what went wrong (error.message, even an empty one), or a plain sentence when the body is not theirs.
func DescribeError(r guard.Reply) string {
	if e, ok := guard.IsObject(guard.Get(r.Body, "error")); ok {
		if m, ok := guard.Str(e["message"]); ok {
			return m
		}
	}
	return "Google Calendar answered " + guard.Itoa(int64(r.Status)) + "."
}

// instant is the start or end of an event: a timed event has `dateTime` (Date.parse), an all-day event a bare `date`, which is midnight in the calendar's own zone.
func instant(v any, zone *string) (int64, bool) {
	o, ok := guard.IsObject(v)
	if !ok {
		return 0, false
	}
	if dt, ok := guard.Str(o["dateTime"]); ok && dt != "" {
		return ParseDate(dt)
	}
	date, ok := guard.Str(o["date"])
	if !ok || date == "" || !isDay(date) {
		return 0, false
	}
	y, _ := strconv.ParseInt(date[0:4], 10, 64)
	m, _ := strconv.ParseInt(date[5:7], 10, 64)
	d, _ := strconv.ParseInt(date[8:10], 10, 64)
	z := "UTC"
	if zone != nil {
		z = *zone
	}
	return zonedMidnight(y, m, d, z), true
}

// isDay is /^(\d{4})-(\d{2})-(\d{2})$/u (ASCII digits only, nothing before or after).
func isDay(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	for i := 0; i < 10; i++ {
		if i != 4 && i != 7 && (s[i] < '0' || s[i] > '9') {
			return false
		}
	}
	return true
}

// ToEvent is toEvent: one Google event as ours. Nil for a cancelled event or one with no usable times or id.
func ToEvent(raw guard.Object, calendarTimeZone *string) *Event {
	if s, _ := raw["status"].(string); s == "cancelled" {
		return nil
	}
	start, ok1 := instant(raw["start"], calendarTimeZone)
	end, ok2 := instant(raw["end"], calendarTimeZone)
	id, ok3 := guard.Str(raw["id"])
	if !ok1 || !ok2 || !ok3 {
		return nil
	}
	priv := guard.Object{}
	if ext, ok := guard.IsObject(raw["extendedProperties"]); ok {
		if p, ok := guard.IsObject(ext["private"]); ok {
			priv = p
		}
	}
	e := &Event{ID: id, Start: start, End: end, Status: Confirmed}
	e.Summary, _ = guard.Str(raw["summary"])
	if s, _ := raw["status"].(string); s == "tentative" {
		e.Status = Tentative
	}
	e.BookingRef = "foreign" // an event we did not make (the owner's own entry) has no bookingRef
	if ref, ok := guard.Str(priv["bookingRef"]); ok && ref != "" {
		e.BookingRef = ref
	}
	// holdExpiresAt: `str(...) && Number.isFinite(Number(str(...)))`. A fraction or a number beyond 2^53 reads as no hold here (times are whole milliseconds; see Deferred.md).
	if h, ok := guard.Str(priv["holdExpiresAt"]); ok && h != "" {
		if f, ok := JSNumber(h); ok && f == float64(int64(f)) && f <= 1<<53 && f >= -(1<<53) {
			v := int64(f)
			e.HoldExpiresAt = &v
		}
	}
	return e
}

func isTransparent(raw guard.Object) bool {
	s, _ := raw["transparency"].(string)
	return s == "transparent"
}

// wireTime is `{ dateTime }`.
type wireTime struct {
	DateTime string `json:"dateTime"`
}

// wireEvent is toWire: the parts that Google keeps as ordinary fields, in the TypeScript's order (summary, start, end, status), then the private properties.
type wireEvent struct {
	Summary  *string   `json:"summary,omitempty"`
	Start    *wireTime `json:"start,omitempty"`
	End      *wireTime `json:"end,omitempty"`
	Status   *string   `json:"status,omitempty"`
	Extended any       `json:"extendedProperties,omitempty"`
}

// newPrivate is the private map of a new event: the hold's member is left out when there is none (nothing to remove on a new event).
type newPrivate struct {
	BookingRef    string  `json:"bookingRef"`
	HoldExpiresAt *string `json:"holdExpiresAt,omitempty"`
}

// patchPrivate is the private map of a patch: a cleared hold is sent as null, which is how Google removes a private property.
type patchPrivate struct {
	BookingRef    string  `json:"bookingRef"`
	HoldExpiresAt *string `json:"holdExpiresAt"`
}

type privateWrap[T any] struct {
	Private T `json:"private"`
}

func holdText(h *int64) *string {
	if h == nil {
		return nil
	}
	s := strconv.FormatInt(*h, 10)
	return &s
}

// toWire builds the ordinary fields; a time that cannot be written (beyond a Date's range) is the RangeError toISOString throws.
func toWire(summary *string, start, end *int64, status *string) (wireEvent, error) {
	w := wireEvent{Summary: summary, Status: status}
	if start != nil {
		s, err := ISOString(*start)
		if err != nil {
			return w, err
		}
		w.Start = &wireTime{s}
	}
	if end != nil {
		s, err := ISOString(*end)
		if err != nil {
			return w, err
		}
		w.End = &wireTime{s}
	}
	return w, nil
}

// ---- the calls -------------------------------------------------------------------------------------------------------------------

func (g *Google) expectOK(r guard.Reply) (guard.Object, error) {
	if r.Status == 409 {
		return nil, &guard.ConflictError{Message: DescribeError(r)}
	}
	if r.Status < 200 || r.Status >= 300 {
		return nil, &guard.ApiError{Status: r.Status, Message: DescribeError(r)}
	}
	o, ok := guard.IsObject(r.Body)
	if !ok {
		return nil, &guard.ApiError{Status: 502, Message: "Google Calendar answered with something that is not a record."}
	}
	return o, nil
}

func optStr(s string, ok bool) *string {
	if !ok {
		return nil
	}
	return &s
}

// listRaw is every page of events.list, following nextPageToken; events that block no time (transparent) are dropped.
func (g *Google) listRaw(ctx context.Context, q Query) ([]Event, error) {
	events := []Event{}
	var pageToken *string
	for page := 0; page < maxPages; page++ {
		query := []guard.Param{{Key: "singleEvents", Value: "true"}, {Key: "maxResults", Value: "250"}}
		if pageToken != nil {
			query = append(query, guard.Param{Key: "pageToken", Value: *pageToken})
		}
		if q.From != nil {
			s, err := ISOString(*q.From)
			if err != nil {
				return nil, err
			}
			query = append(query, guard.Param{Key: "timeMin", Value: s})
		}
		if q.To != nil {
			s, err := ISOString(*q.To)
			if err != nil {
				return nil, err
			}
			query = append(query, guard.Param{Key: "timeMax", Value: s})
		}
		if q.BookingRef != nil {
			query = append(query, guard.Param{Key: "privateExtendedProperty", Value: "bookingRef=" + *q.BookingRef})
		}
		reply, err := g.http.Request(ctx, "GET", g.base+"/events", guard.Options{Query: query})
		if err != nil {
			return nil, err
		}
		body, err := g.expectOK(reply)
		if err != nil {
			return nil, err
		}
		zone := optStr(guard.Str(body["timeZone"]))
		for _, item := range guard.AsArray(body["items"]) {
			o, ok := guard.IsObject(item)
			if !ok || isTransparent(o) {
				continue
			}
			if e := ToEvent(o, zone); e != nil {
				events = append(events, *e)
			}
		}
		next, ok := guard.Str(body["nextPageToken"])
		if !ok || next == "" {
			return events, nil
		}
		pageToken = &next
	}
	return nil, &guard.ApiError{Status: 502, Message: "Google Calendar has more events than this code will page through."}
}

// getRaw is one event's record, nil for a missing (404) or gone (410) event or one marked cancelled (a deleted event may still answer).
func (g *Google) getRaw(ctx context.Context, id string) (guard.Object, error) {
	reply, err := g.http.Request(ctx, "GET", g.base+"/events/"+guard.EncodeURIComponent(id), guard.Options{})
	if err != nil {
		return nil, err
	}
	if reply.Status == 404 || reply.Status == 410 {
		return nil, nil
	}
	raw, err := g.expectOK(reply)
	if err != nil {
		return nil, err
	}
	if s, _ := raw["status"].(string); s == "cancelled" {
		return nil, nil
	}
	return raw, nil
}

var sendNone = []guard.Param{{Key: "sendUpdates", Value: "none"}}

// Insert is the tentative hold or the booking, with the booking id and the hold's end as private properties.
func (g *Google) Insert(ctx context.Context, e NewEvent) (Event, error) {
	s, st := e.Summary, e.Status
	w, err := toWire(&s, &e.Start, &e.End, &st)
	if err != nil {
		return Event{}, err
	}
	w.Extended = privateWrap[newPrivate]{newPrivate{BookingRef: e.BookingRef, HoldExpiresAt: holdText(e.HoldExpiresAt)}}
	reply, err := g.http.Request(ctx, "POST", g.base+"/events", guard.Options{Query: sendNone, Body: w})
	if err != nil {
		return Event{}, err
	}
	body, err := g.expectOK(reply)
	if err != nil {
		return Event{}, err
	}
	created := ToEvent(body, nil)
	if created == nil {
		return Event{}, &guard.ApiError{Status: 502, Message: "Google Calendar answered with an event this code cannot read."}
	}
	return *created, nil
}

// Get is the event, or nil when it is missing, gone or cancelled.
func (g *Google) Get(ctx context.Context, id string) (*Event, error) {
	raw, err := g.getRaw(ctx, id)
	if err != nil || raw == nil {
		return nil, err
	}
	return ToEvent(raw, nil), nil
}

// List is every event matching the filter, over all pages.
func (g *Google) List(ctx context.Context, q Query) ([]Event, error) { return g.listRaw(ctx, q) }

// Conflicts is the events overlapping [start, end): timeMin is an exclusive bound on an event's end and timeMax on its start.
func (g *Google) Conflicts(ctx context.Context, start, end int64) ([]Event, error) {
	return g.listRaw(ctx, Query{From: &start, To: &end})
}

// Update reads the event first (Google's docs say nothing about how private properties merge, so the whole private map is sent back), then patches it.
func (g *Google) Update(ctx context.Context, id string, p Patch) (Event, error) {
	current, err := g.getRaw(ctx, id)
	if err != nil {
		return Event{}, err
	}
	if current == nil {
		return Event{}, &guard.ApiError{Status: 404, Message: "No such event."}
	}
	existing := ToEvent(current, nil)
	var bookingRef *string
	var existingHold *int64
	if existing != nil {
		if existing.BookingRef != "foreign" {
			bookingRef = &existing.BookingRef
		}
		existingHold = existing.HoldExpiresAt
	}
	hold := existingHold // `"holdExpiresAt" in patch ? patch.holdExpiresAt : existing?.holdExpiresAt`
	if p.HoldSet {
		hold = p.HoldExpiresAt
	}
	w, err := toWire(p.Summary, p.Start, p.End, p.Status)
	if err != nil {
		return Event{}, err
	}
	if bookingRef != nil {
		w.Extended = privateWrap[patchPrivate]{patchPrivate{BookingRef: *bookingRef, HoldExpiresAt: holdText(hold)}}
	}
	reply, err := g.http.Request(ctx, "PATCH", g.base+"/events/"+guard.EncodeURIComponent(id), guard.Options{Query: sendNone, Body: w})
	if err != nil {
		return Event{}, err
	}
	body, err := g.expectOK(reply)
	if err != nil {
		return Event{}, err
	}
	changed := ToEvent(body, nil)
	if changed == nil {
		return Event{}, &guard.ApiError{Status: 502, Message: "Google Calendar answered with an event this code cannot read."}
	}
	return *changed, nil
}

// Delete removes the event; one that is already gone (404, 410) is what was asked for.
func (g *Google) Delete(ctx context.Context, id string) error {
	reply, err := g.http.Request(ctx, "DELETE", g.base+"/events/"+guard.EncodeURIComponent(id), guard.Options{Query: sendNone})
	if err != nil {
		return err
	}
	if reply.Status == 404 || reply.Status == 410 {
		return nil
	}
	if reply.Status < 200 || reply.Status >= 300 {
		return &guard.ApiError{Status: reply.Status, Message: DescribeError(reply)}
	}
	return nil
}

type freeBusyBody struct {
	TimeMin string            `json:"timeMin"`
	TimeMax string            `json:"timeMax"`
	Items   []freeBusyCalItem `json:"items"`
}

type freeBusyCalItem struct {
	ID string `json:"id"`
}

// FreeBusy is the busy stretches of this calendar. A calendar that could not be read comes back with an error and an empty busy list: that is not "free", and is an ApiError.
func (g *Google) FreeBusy(ctx context.Context, from, to int64) ([]Busy, error) {
	min, err := ISOString(from)
	if err != nil {
		return nil, err
	}
	max, err := ISOString(to)
	if err != nil {
		return nil, err
	}
	reply, err := g.http.Request(ctx, "POST", "/calendar/v3/freeBusy", guard.Options{Body: freeBusyBody{TimeMin: min, TimeMax: max, Items: []freeBusyCalItem{{ID: g.calendarID}}}})
	if err != nil {
		return nil, err
	}
	body, err := g.expectOK(reply)
	if err != nil {
		return nil, err
	}
	var entry guard.Object
	if cals, ok := guard.IsObject(body["calendars"]); ok {
		entry, _ = guard.IsObject(cals[g.calendarID])
	}
	if entry == nil {
		return nil, &guard.ApiError{Status: 502, Message: "Google Calendar's free/busy answer has nothing for this calendar."}
	}
	if errs := guard.AsArray(entry["errors"]); len(errs) > 0 {
		reasons := ""
		for i, e := range errs {
			if i > 0 {
				reasons += ", "
			}
			reason := "unknown"
			if o, ok := guard.IsObject(e); ok {
				if r, ok := guard.Str(o["reason"]); ok {
					reason = r
				}
			}
			reasons += reason
		}
		return nil, &guard.ApiError{Status: 502, Message: "Google Calendar could not read this calendar's free/busy (" + reasons + ")."}
	}
	out := []Busy{}
	for _, b := range guard.AsArray(entry["busy"]) {
		o, ok := guard.IsObject(b)
		if !ok {
			continue
		}
		// `Date.parse(String(b.start))`: String of anything, so an absent member is the text "undefined" (NaN)
		s, ok1 := ParseDate(jsMember(o, "start"))
		e, ok2 := ParseDate(jsMember(o, "end"))
		if ok1 && ok2 {
			out = append(out, Busy{Start: s, End: e})
		}
	}
	return out, nil
}

// jsMember is String(o[key]), "undefined" for a member that is not there.
func jsMember(o guard.Object, key string) string {
	v, ok := o[key]
	if !ok {
		return "undefined"
	}
	return JSString(v)
}
