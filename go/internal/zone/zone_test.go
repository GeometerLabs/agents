package zone

import (
	"encoding/json"
	"os"
	"testing"
)

// The vectors are what the TypeScript's Intl-based helpers wrote on Node (scripts/gen_locale.ts): the same instants in India, New York and Sydney (both sides of a gap and an overlap),
// Kathmandu (+5:45) and UTC.
func TestEqualsTheTypeScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Parts []struct {
			Tz    string
			Ms    int64
			Parts struct{ Year, Month, Day, Hour, Minute, Weekday int }
		} `json:"parts"`
		Zoned []struct {
			Tz             string
			Y, M, D, H, Mi int
			Ms             int64
		} `json:"zoned"`
		AddDays []struct {
			Y, M, D, N int
			To         Date
		} `json:"addDays"`
		Between []struct {
			A, B Date
			N    int
		} `json:"between"`
		Weekday []struct{ Y, M, D, W int } `json:"weekday"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Parts) == 0 || len(v.Zoned) == 0 {
		t.Fatal("empty vectors")
	}
	for _, c := range v.Parts {
		got := LocalParts(c.Ms, c.Tz)
		want := Parts{Date: Date{c.Parts.Year, c.Parts.Month, c.Parts.Day}, Hour: c.Parts.Hour, Minute: c.Parts.Minute, Weekday: c.Parts.Weekday}
		if got != want {
			t.Errorf("LocalParts(%d, %s) = %+v, TypeScript %+v", c.Ms, c.Tz, got, want)
		}
	}
	for _, c := range v.Zoned {
		if got := ZonedToMs(Date{c.Y, c.M, c.D}, c.H, c.Mi, c.Tz); got != c.Ms {
			t.Errorf("ZonedToMs(%d-%d-%d %d:%d, %s) = %d, TypeScript %d", c.Y, c.M, c.D, c.H, c.Mi, c.Tz, got, c.Ms)
		}
	}
	for _, c := range v.AddDays {
		if got := AddDays(Date{c.Y, c.M, c.D}, c.N); got != c.To {
			t.Errorf("AddDays(%d-%d-%d, %d) = %+v, TypeScript %+v", c.Y, c.M, c.D, c.N, got, c.To)
		}
	}
	for _, c := range v.Between {
		if got := DaysBetween(c.A, c.B); got != c.N {
			t.Errorf("DaysBetween(%+v, %+v) = %d, TypeScript %d", c.A, c.B, got, c.N)
		}
	}
	for _, c := range v.Weekday {
		if got := WeekdayOf(Date{c.Y, c.M, c.D}); got != c.W {
			t.Errorf("WeekdayOf = %d, TypeScript %d", got, c.W)
		}
	}
}

func TestBadZonePanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("a bad time zone name must fail as Intl's RangeError does")
		}
	}()
	LocalParts(0, "Mars/Olympus")
}
