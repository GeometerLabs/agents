package language

// format.ts formatDate, formatTime and formatInr (whole rupees) proved on what Node's own formatters wrote for the books and the report (testdata/locale-vectors.json, made by
// scripts/gen_locale.ts): the books, the report, the Bookings words and the owner's assistant all write with these, so a date is written one way by every Go runtime.

import (
	"encoding/json"
	"os"
	"testing"
)

// The vectors are what Node's own formatters wrote (scripts/gen_locale.ts).
func TestFormatsEqualLocaleVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/locale-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Inr []struct {
			Rupees int64
			Text   string
		} `json:"inr"`
		Date []struct {
			Lang    string
			Y, M, D int
			Text    string
		} `json:"date"`
		Time []struct {
			Lang   string
			H, Min int
			Text   string
		} `json:"time"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Inr) == 0 || len(v.Date) == 0 || len(v.Time) == 0 {
		t.Fatal("empty vectors")
	}
	for _, c := range v.Inr {
		if c.Rupees == 0 {
			continue // JavaScript writes -0 as "0" here (the vector's -0 is 0)
		}
		if got := FormatInrWhole(c.Rupees); got != c.Text {
			t.Errorf("FormatInrWhole(%d) = %q, TypeScript %q", c.Rupees, got, c.Text)
		}
	}
	for _, c := range v.Date {
		if got := Formats(c.Lang).Date(c.Y, c.M, c.D); got != c.Text {
			t.Errorf("FormatDate(%d-%d-%d, %s) = %q, TypeScript %q", c.Y, c.M, c.D, c.Lang, got, c.Text)
		}
	}
	for _, c := range v.Time {
		if got := Formats(c.Lang).TimeOfDay(c.H, c.Min); got != c.Text {
			t.Errorf("FormatTime(%d:%d, %s) = %q, TypeScript %q", c.H, c.Min, c.Lang, got, c.Text)
		}
	}
}
