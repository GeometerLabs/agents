package calendar_test

// The calendar package against what the TypeScript did: the live Google client replayed from recorded exchanges (same requests byte for byte, same result or error), the fake and the
// shop's own booking list run through the same scripted and seeded-random steps, and the JavaScript behaviours (Date.parse, toISOString, Number, String, all-day events in a zone) on
// the inputs Node answered. Go-only tests at the end cover the places Go differs on purpose. Vectors: go/scripts/vectors/calendar.ts.

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/calendar"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/guard/guardtest"
)

// ---- decoding what a vector call says --------------------------------------------------------------------------------------------

type wireEvent struct {
	Summary       string `json:"summary"`
	Start         int64  `json:"start"`
	End           int64  `json:"end"`
	Status        string `json:"status"`
	BookingRef    string `json:"bookingRef"`
	HoldExpiresAt *int64 `json:"holdExpiresAt"`
}

func newEvent(raw json.RawMessage) calendar.NewEvent {
	var w wireEvent
	must(json.Unmarshal(raw, &w))
	return calendar.NewEvent{Summary: w.Summary, Start: w.Start, End: w.End, Status: w.Status, BookingRef: w.BookingRef, HoldExpiresAt: w.HoldExpiresAt}
}

func patchOf(raw json.RawMessage) calendar.Patch {
	var m map[string]json.RawMessage
	must(json.Unmarshal(raw, &m))
	var p calendar.Patch
	if v, ok := m["summary"]; ok {
		var s string
		must(json.Unmarshal(v, &s))
		p.Summary = &s
	}
	if v, ok := m["start"]; ok {
		var n int64
		must(json.Unmarshal(v, &n))
		p.Start = &n
	}
	if v, ok := m["end"]; ok {
		var n int64
		must(json.Unmarshal(v, &n))
		p.End = &n
	}
	if v, ok := m["status"]; ok {
		var s string
		must(json.Unmarshal(v, &s))
		p.Status = &s
	}
	if v, ok := m["holdExpiresAt"]; ok { // the key is there: a null is "present and undefined"
		p.HoldSet = true
		must(json.Unmarshal(v, &p.HoldExpiresAt))
	}
	return p
}

func queryOf(raw json.RawMessage) calendar.Query {
	var w struct {
		From, To   *int64
		BookingRef *string `json:"bookingRef"`
	}
	var m map[string]json.RawMessage
	must(json.Unmarshal(raw, &m))
	if v, ok := m["from"]; ok {
		must(json.Unmarshal(v, &w.From))
	}
	if v, ok := m["to"]; ok {
		must(json.Unmarshal(v, &w.To))
	}
	if v, ok := m["bookingRef"]; ok {
		must(json.Unmarshal(v, &w.BookingRef))
	}
	return calendar.Query{From: w.From, To: w.To, BookingRef: w.BookingRef}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func str(raw json.RawMessage) string { var s string; must(json.Unmarshal(raw, &s)); return s }
func num(raw json.RawMessage) int64  { var n int64; must(json.Unmarshal(raw, &n)); return n }

// do makes the call a vector names on any Calendar; a missing thing is JSON null.
func do(ctx context.Context, cal calendar.Calendar, op string, args []json.RawMessage) (any, error) {
	switch op {
	case "insert":
		e, err := cal.Insert(ctx, newEvent(args[0]))
		return e, err
	case "get":
		e, err := cal.Get(ctx, str(args[0]))
		if err != nil || e == nil {
			return nil, err
		}
		return *e, nil
	case "list":
		q := calendar.Query{}
		if len(args) > 0 {
			q = queryOf(args[0])
		}
		return cal.List(ctx, q)
	case "update":
		e, err := cal.Update(ctx, str(args[0]), patchOf(args[1]))
		return e, err
	case "delete":
		return nil, cal.Delete(ctx, str(args[0]))
	case "freeBusy":
		return cal.FreeBusy(ctx, num(args[0]), num(args[1]))
	case "conflicts":
		return cal.Conflicts(ctx, num(args[0]), num(args[1]))
	}
	panic("unknown op " + op)
}

// result turns what a call gave into the vector's shape.
func result(v any, err error) any {
	if err != nil {
		return guardtest.Outcome(nil, err)
	}
	return guardtest.Outcome(v, nil)
}

// ---- the live client -------------------------------------------------------------------------------------------------------------

func TestGoogleVectors(t *testing.T) {
	cases := guardtest.Load(t, "testdata/calendar-vectors.json")
	if len(cases) < 150 {
		t.Fatalf("only %d cases", len(cases))
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			raw, _ := json.Marshal(c.Config)
			var cfg struct {
				Call struct {
					Op   string            `json:"op"`
					Args []json.RawMessage `json:"args"`
				} `json:"call"`
				CalendarID string `json:"calendarId"`
				AgentToken string `json:"agentToken"`
				BaseSuffix string `json:"baseSuffix"`
				Closed     bool   `json:"closed"`
				TimeoutMs  int    `json:"timeoutMs"`
			}
			must(json.Unmarshal(raw, &cfg))
			srv := guardtest.Replay(c)
			defer srv.Close()
			base := srv.URL
			if cfg.Closed {
				base = guardtest.ClosedURL()
			}
			cl, err := calendar.New(calendar.Config{BaseURL: base + cfg.BaseSuffix, CalendarID: cfg.CalendarID, TimeoutMs: cfg.TimeoutMs, AgentToken: cfg.AgentToken})
			if err != nil {
				t.Fatal(err)
			}
			v, err := do(context.Background(), cl, cfg.Call.Op, cfg.Call.Args)
			guardtest.Check(t, c, srv, result(v, err))
		})
	}
}

// ---- the JavaScript behaviours ---------------------------------------------------------------------------------------------------

type jsVectors struct {
	Parse []struct {
		Input string `json:"input"`
		Ms    *int64 `json:"ms"`
	} `json:"parse"`
	ISO []struct {
		Ms    float64 `json:"ms"`
		ISO   string  `json:"iso"`
		Error string  `json:"error"`
	} `json:"iso"`
	ToNumber []struct {
		Input  string `json:"input"`
		Number any    `json:"number"`
	} `json:"toNumber"`
	Stringed []struct {
		JSON   string `json:"json"`
		String string `json:"string"`
	} `json:"stringed"`
}

func loadJS(t *testing.T) jsVectors {
	t.Helper()
	b, err := os.ReadFile("testdata/js-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v jsVectors
	must(json.Unmarshal(b, &v))
	return v
}

// parseDifferences are the strings Date.parse reads through V8's older free-form parser, and a date and time with no offset (the computer's local time there, UTC here). They are on
// purpose: Google writes RFC 3339 with an offset. Each says what Node answered; the test checks Go answers NaN (or UTC) and that the list does not grow unnoticed.
var parseDifferences = map[string]string{
	"Nov 10 2026": "V8's free-form parser",
	"5":           "V8's free-form parser reads a lone number as a month",
	"-5":          "V8's free-form parser",
	"2026.5":      "V8's free-form parser",
	"2026-1-1":    "one-digit month and day: the free-form parser",
	"2026-11-1":   "one-digit day: the free-form parser",
	"２０２６-11-10":  "full-width digits: the free-form parser",
}

func TestDateParseMatchesNode(t *testing.T) {
	v := loadJS(t)
	differ := 0
	for _, c := range v.Parse {
		got, ok := calendar.ParseDate(c.Input)
		switch {
		case c.Ms == nil && !ok, c.Ms != nil && ok && *c.Ms == got:
		default:
			differ++
			if _, known := parseDifferences[c.Input]; !known {
				t.Errorf("Date.parse(%q): Node %v, Go %d (%v)", c.Input, deref(c.Ms), got, ok)
			}
		}
	}
	for in := range parseDifferences {
		found := false
		for _, c := range v.Parse {
			found = found || c.Input == in
		}
		if !found {
			t.Errorf("parseDifferences lists %q, which is not a vector", in)
		}
	}
	t.Logf("%d inputs, %d known differences", len(v.Parse), differ)
}

func deref(p *int64) any {
	if p == nil {
		return "NaN"
	}
	return *p
}

func TestISOStringMatchesNode(t *testing.T) {
	for _, c := range loadJS(t).ISO {
		got, err := calendar.ISOString(int64(c.Ms))
		if c.Error != "" {
			if err == nil || "RangeError: "+err.Error() != c.Error {
				t.Errorf("toISOString(%v): want error %q, got %q %v", c.Ms, c.Error, got, err)
			}
			continue
		}
		if err != nil || got != c.ISO {
			t.Errorf("toISOString(%v) = %q (%v), Node %q", c.Ms, got, err, c.ISO)
		}
	}
}

func TestNumberAndStringMatchNode(t *testing.T) {
	v := loadJS(t)
	for _, c := range v.ToNumber {
		f, ok := calendar.JSNumber(c.Input)
		var got any
		switch {
		case !ok:
			got = "NaN"
		case math.IsInf(f, 1):
			got = "Infinity"
		case math.IsInf(f, -1):
			got = "-Infinity"
		case f == 0 && 1/f < 0:
			got = "-0"
		default:
			got = f
		}
		if !reflect.DeepEqual(got, c.Number) {
			t.Errorf("Number(%q) = %v, Node %v", c.Input, got, c.Number)
		}
	}
	for _, c := range v.Stringed {
		decoded, err := guard.Decode(c.JSON)
		if err != nil {
			t.Fatal(err)
		}
		if got := calendar.JSString(decoded); got != c.String {
			t.Errorf("String(%s) = %q, Node %q", c.JSON, got, c.String)
		}
	}
}

func TestToEventMatchesTypeScript(t *testing.T) {
	b, err := os.ReadFile("testdata/event-vectors.json")
	must(err)
	var vs []struct {
		Label string          `json:"label"`
		Raw   json.RawMessage `json:"raw"`
		Zone  *string         `json:"zone"`
		Event any             `json:"event"`
	}
	must(json.Unmarshal(b, &vs))
	for _, c := range vs {
		raw, err := guard.Decode(string(c.Raw))
		must(err)
		var got any
		if e := calendar.ToEvent(raw.(guard.Object), c.Zone); e != nil {
			j, _ := json.Marshal(e)
			must(json.Unmarshal(j, &got))
		}
		if !reflect.DeepEqual(got, c.Event) {
			t.Errorf("%s: Go %v, TypeScript %v", c.Label, got, c.Event)
		}
	}
}

// ---- the fake and the own list ---------------------------------------------------------------------------------------------------

type step struct {
	Op      string            `json:"op"`
	Args    []json.RawMessage `json:"args"`
	Inject  []json.RawMessage `json:"inject"`
	Foreign []json.RawMessage `json:"foreign"`
	Now     *int64            `json:"now"`
}

// run makes the steps on a calendar, returning each step's result as the vector writes it.
func run(cal calendar.Calendar, steps []step, inject func(op, mode string, times, after int), foreign func(s, e int64, summary string) calendar.Event, setNow func(int64)) []any {
	out := []any{}
	for _, s := range steps {
		switch {
		case s.Now != nil:
			setNow(*s.Now)
			out = append(out, nil)
		case s.Inject != nil:
			var o struct{ Times, After int }
			if len(s.Inject) > 2 && string(s.Inject[2]) != "null" {
				must(json.Unmarshal(s.Inject[2], &o))
				if o.Times == 0 {
					// `{ after }` alone: times is left out, which the TypeScript reads as 1
					o.Times = 1
				}
			}
			inject(str(s.Inject[0]), str(s.Inject[1]), o.Times, o.After)
			out = append(out, nil)
		case s.Foreign != nil:
			summary := ""
			if len(s.Foreign) > 2 && string(s.Foreign[2]) != "null" {
				summary = str(s.Foreign[2])
			}
			out = append(out, normal(foreign(num(s.Foreign[0]), num(s.Foreign[1]), summary)))
		default:
			v, err := do(context.Background(), cal, s.Op, s.Args)
			out = append(out, result(v, err))
		}
	}
	return out
}

func normal(v any) any {
	b, _ := json.Marshal(v)
	var out any
	must(json.Unmarshal(b, &out))
	return out
}

func TestFakeMatchesTypeScript(t *testing.T) {
	b, err := os.ReadFile("testdata/fake-vectors.json")
	must(err)
	var vs []struct {
		Name    string          `json:"name"`
		Steps   []step          `json:"steps"`
		Results []any           `json:"results"`
		Events  json.RawMessage `json:"events"`
		Calls   []string        `json:"calls"`
	}
	must(json.Unmarshal(b, &vs))
	if len(vs) < 10 {
		t.Fatalf("only %d scenarios", len(vs))
	}
	for _, v := range vs {
		t.Run(v.Name, func(t *testing.T) {
			f := calendar.NewFake()
			// the TypeScript's `times: 0` and a missing `times` both mean 1, and so does a Go FaultOptions of 0
			got := run(f, v.Steps, func(op, mode string, times, after int) {
				f.Inject(calendar.Op(op), calendar.Fault(mode), calendar.FaultOptions{Times: times, After: after})
			}, func(s, e int64, summary string) calendar.Event { return f.AddForeignEvent(s, e, summary) }, nil)
			for i := range got {
				if !reflect.DeepEqual(got[i], v.Results[i]) {
					t.Errorf("step %d (%+v): Go %v, TypeScript %v", i, v.Steps[i], got[i], v.Results[i])
					break
				}
			}
			if !reflect.DeepEqual(normal(f.Events()), normal(mustDecode(v.Events))) {
				t.Errorf("events: Go %v, TypeScript %s", normal(f.Events()), v.Events)
			}
			calls := []string{}
			for _, c := range f.Calls() {
				calls = append(calls, string(c))
			}
			if !reflect.DeepEqual(calls, v.Calls) {
				t.Errorf("calls: Go %v, TypeScript %v", calls, v.Calls)
			}
		})
	}
}

func mustDecode(raw json.RawMessage) any {
	var v any
	must(json.Unmarshal(raw, &v))
	return v
}

func TestOwnMatchesTypeScript(t *testing.T) {
	b, err := os.ReadFile("testdata/own-vectors.json")
	must(err)
	var vs []struct {
		Name    string          `json:"name"`
		Initial json.RawMessage `json:"initial"`
		Now     int64           `json:"now"`
		Steps   []step          `json:"steps"`
		Results []any           `json:"results"`
		State   json.RawMessage `json:"state"`
		Order   []string        `json:"order"`
	}
	must(json.Unmarshal(b, &vs))
	if len(vs) < 10 {
		t.Fatalf("only %d scenarios", len(vs))
	}
	for _, v := range vs {
		t.Run(v.Name, func(t *testing.T) {
			state := &calendar.OwnState{}
			if string(v.Initial) != "null" {
				must(json.Unmarshal(v.Initial, state))
			}
			now := v.Now
			own := calendar.NewOwn(state, func() int64 { return now })
			got := run(own, v.Steps, nil, nil, func(n int64) { now = n })
			for i := range got {
				if !reflect.DeepEqual(got[i], v.Results[i]) {
					t.Errorf("step %d (%+v): Go %v, TypeScript %v", i, v.Steps[i], got[i], v.Results[i])
					break
				}
			}
			if !reflect.DeepEqual(append([]string{}, state.Events.IDs()...), append([]string{}, v.Order...)) {
				t.Errorf("event order: Go %v, TypeScript %v", state.Events.IDs(), v.Order)
			}
			// The TypeScript's saved state exists once the list was touched; Go's zero state is that list. Compare the JSON they would save (members in the Go order).
			if string(v.State) != "null" {
				j, _ := json.Marshal(state)
				if !reflect.DeepEqual(normal(mustDecode(j)), normal(mustDecode(v.State))) {
					t.Errorf("state: Go %s, TypeScript %s", j, v.State)
				}
			}
		})
	}
}

// ---- Go only ---------------------------------------------------------------------------------------------------------------------

func TestEventsKeepKeyOrderThroughJSON(t *testing.T) {
	in := `{"events":{"own_9":{"summary":"a","start":1,"end":2,"status":"confirmed","bookingRef":"b","id":"own_9"},"own_2":{"summary":"c","start":3,"end":4,"status":"tentative","bookingRef":"d","holdExpiresAt":5,"id":"own_2"}},"next":10}`
	var s calendar.OwnState
	must(json.Unmarshal([]byte(in), &s))
	if got := strings.Join(s.Events.IDs(), ","); got != "own_9,own_2" {
		t.Fatalf("order %s", got)
	}
	out, _ := json.Marshal(s)
	if string(out) != in {
		t.Errorf("round trip\n  in:  %s\n  out: %s", in, out)
	}
	s.Events.Delete("own_9")
	s.Events.Set("own_9", calendar.Event{ID: "own_9"})
	if got := strings.Join(s.Events.IDs(), ","); got != "own_2,own_9" {
		t.Errorf("a deleted and re-added id goes last, as a JavaScript key does: %s", got)
	}
	var empty calendar.OwnState
	out, _ = json.Marshal(empty)
	if string(out) != `{"events":{},"next":0}` {
		t.Errorf("empty: %s", out)
	}
}

func TestOwnZeroValueIsAFreshList(t *testing.T) {
	own := calendar.NewOwn(&calendar.OwnState{}, func() int64 { return 0 })
	e, err := own.Insert(context.Background(), calendar.NewEvent{Summary: "a", Start: 1, End: 2, Status: calendar.Confirmed, BookingRef: "b"})
	if err != nil || e.ID != "own_1" {
		t.Fatalf("%+v %v", e, err)
	}
}

// A hold end Google keeps as text that is a fraction, or beyond 2^53, reads as no hold in Go (times are whole milliseconds here); the TypeScript keeps the fraction.
func TestFractionalHoldReadsAsNone(t *testing.T) {
	for in, want := range map[string]*int64{"12.5": nil, "1793000000000": ptr(1793000000000), " 7 ": ptr(7), "1e3": ptr(1000), "0x10": ptr(16), "9007199254740993": ptr(9007199254740992), "9007199254740994": nil, "-5": ptr(-5)} {
		e := calendar.ToEvent(guard.Object{"id": "x", "start": guard.Object{"dateTime": "2026-11-10T10:00:00Z"}, "end": guard.Object{"dateTime": "2026-11-10T11:00:00Z"},
			"extendedProperties": guard.Object{"private": guard.Object{"bookingRef": "b", "holdExpiresAt": in}}}, nil)
		if e == nil || !reflect.DeepEqual(e.HoldExpiresAt, want) {
			t.Errorf("hold %q: %+v", in, e)
		}
	}
}

func ptr(n int64) *int64 { return &n }

// A date and time with no offset is UTC here (the computer's local time in JavaScript).
func TestNoOffsetIsUTC(t *testing.T) {
	got, ok := calendar.ParseDate("2026-11-10T18:00:00")
	if !ok || got != 1794333600000 {
		t.Errorf("%d %v", got, ok)
	}
}

// A free-form date V8 reads is NaN here.
func TestFreeFormDatesAreNotRead(t *testing.T) {
	for _, s := range []string{"Nov 10 2026", "10 Nov 2026 18:00 GMT", "11/10/2026"} {
		if _, ok := calendar.ParseDate(s); ok {
			t.Errorf("%q was read", s)
		}
	}
}

// A time beyond what a Date holds is the RangeError toISOString throws; Go's error carries the same words (the TypeScript's name RangeError is a plain Error here).
func TestTimeBeyondADateIsAnError(t *testing.T) {
	over := int64(9_000_000_000_000_000)
	cl := calendar.NewWithHTTP(neverCalled{}, "x@y.z")
	ctx := context.Background()
	if _, err := cl.FreeBusy(ctx, 0, over); err == nil || err.Error() != "Invalid time value" {
		t.Errorf("freeBusy: %v", err)
	}
	if _, err := cl.Conflicts(ctx, over, over+1); err == nil || err.Error() != "Invalid time value" {
		t.Errorf("conflicts: %v", err)
	}
	if _, err := cl.Insert(ctx, calendar.NewEvent{Start: over, End: over + 1}); err == nil || err.Error() != "Invalid time value" {
		t.Errorf("insert: %v", err)
	}
}

// neverCalled is a guard.Http that must not be reached: the time cannot be written, so nothing is sent.
type neverCalled struct{}

func (neverCalled) Request(context.Context, string, string, guard.Options) (guard.Reply, error) {
	panic("a request was sent for a time that cannot be written")
}
