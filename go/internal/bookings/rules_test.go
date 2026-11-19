package bookings

// The pure Bookings rules proved equal to the TypeScript on the SAME inputs: testdata/limits-vectors.json (go/scripts/gen_bookings_vectors.ts: hours by half hour over a week,
// the double-booking grid with units and resources, the refund limit around its boundary, every move between states, the reminders, the price floor) and
// testdata/settings-vectors.json (validateSettings on the example and each of its mutations). These stand for the TypeScript unit tests limits, booking, capacity and settings.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func readVectors(t *testing.T, name string, into any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Skipf("%s is not here (the Bookings contract stream writes it with go/scripts/gen_bookings_vectors.ts): %v", name, err)
	}
	if err := json.Unmarshal(b, into); err != nil {
		t.Fatal(err)
	}
}

func exampleSettings(t *testing.T) *Settings {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "templates", "commerce", "bookings", "settings", "glow-salon.example.json"))
	if err != nil {
		t.Fatal(err)
	}
	var in map[string]any
	if err := json.Unmarshal(raw, &in); err != nil {
		t.Fatal(err)
	}
	s, errs := ReadSettings(in, raw)
	if len(errs) > 0 {
		t.Fatalf("the example settings are refused: %v", errs)
	}
	return s
}

type vec struct {
	Area   string          `json:"area"`
	Name   string          `json:"name"`
	Input  json.RawMessage `json:"input"`
	Output json.RawMessage `json:"output"`
}

func TestLimitsVectors(t *testing.T) {
	var vs []vec
	readVectors(t, "limits-vectors.json", &vs)
	s := exampleSettings(t)
	for _, v := range vs {
		var got any
		switch v.Area {
		case "price":
			var in struct {
				ServiceName           string
				ListInr, ProposedInr int64
			}
			_ = json.Unmarshal(v.Input, &in)
			got = CheckPriceAtOrAboveList(in.ServiceName, in.ListInr, in.ProposedInr)
		case "hours":
			var in struct {
				Service    string
				StartMs    int64
				ClosedDays []string
			}
			_ = json.Unmarshal(v.Input, &in)
			got = CheckWithinHours(s, s.ServiceByID(in.Service), in.StartMs, in.ClosedDays)
		case "double":
			var in struct {
				StartMs, EndMs, BufferMinutes, NowMs int64
				OwnBookingRef, Resource              string
				Units                                int64
				Others                               []struct {
					Start, End     int64
					BookingRef     string
					TentativeUntil *int64
					Resource       string
				}
			}
			_ = json.Unmarshal(v.Input, &in)
			var others []BusyEvent
			for _, o := range in.Others {
				others = append(others, BusyEvent{Start: o.Start, End: o.End, BookingRef: o.BookingRef, TentativeUntil: o.TentativeUntil, Resource: o.Resource})
			}
			got = CheckNoDoubleBooking(in.StartMs, in.EndMs, in.BufferMinutes, in.OwnBookingRef, others, in.NowMs, in.Resource, in.Units)
		case "refund":
			var in struct {
				AmountInr, LimitInr  int64
				PaidInr              *int64
				OwnerApproved        bool
				InCancellationWindow *bool
			}
			_ = json.Unmarshal(v.Input, &in)
			paid, window := int64(-1), true
			if in.PaidInr != nil {
				paid = *in.PaidInr
			}
			if in.InCancellationWindow != nil {
				window = *in.InCancellationWindow
			}
			got = CheckRefundLimit(in.AmountInr, in.LimitInr, paid, in.OwnerApproved, window)
		case "stop":
			var in struct{ IsReminder, BookingConfirmed, CustomerOptedOut bool }
			_ = json.Unmarshal(v.Input, &in)
			got = CheckNoMessageAfterStop(in.IsReminder, in.BookingConfirmed, in.CustomerOptedOut)
		case "move":
			var in struct{ From, To string }
			_ = json.Unmarshal(v.Input, &in)
			got = CanMove(in.From, in.To)
		case "reminders":
			var in struct{ StartMs, NowMs int64 }
			_ = json.Unmarshal(v.Input, &in)
			got = ReminderSchedule(s, in.StartMs, in.NowMs)
		default:
			t.Errorf("%s: an area this test does not know: %s", v.Name, v.Area)
			continue
		}
		var want, have any
		_ = json.Unmarshal(v.Output, &want)
		b, _ := json.Marshal(got)
		_ = json.Unmarshal(b, &have)
		if d, ok := have.(map[string]any); ok {
			delete(d, "reason") // the vectors keep the verdict and the rule; the words are the record's, proved in the contract
		}
		if !reflect.DeepEqual(want, have) {
			t.Errorf("%s %s: want %v, got %v", v.Area, v.Name, string(v.Output), string(b))
		}
	}
}

func TestSettingsVectors(t *testing.T) {
	var vs []struct {
		Name   string          `json:"name"`
		Input  json.RawMessage `json:"input"`
		Output struct {
			OK     bool     `json:"ok"`
			Errors []string `json:"errors"`
		} `json:"output"`
	}
	readVectors(t, "settings-vectors.json", &vs)
	for _, v := range vs {
		var in any
		_ = json.Unmarshal(v.Input, &in)
		m, _ := in.(map[string]any)
		_, errs := ReadSettings(m, v.Input)
		if v.Output.OK != (len(errs) == 0) {
			t.Errorf("%s: TypeScript says ok=%v, Go says %v", v.Name, v.Output.OK, errs)
			continue
		}
		if !v.Output.OK && strings.Join(errs, "\n") != strings.Join(v.Output.Errors, "\n") {
			t.Errorf("%s:\nwant %q\n got %q", v.Name, v.Output.Errors, errs)
		}
	}
}
