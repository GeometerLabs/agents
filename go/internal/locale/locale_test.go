package locale

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// The vectors are what Node's own formatters wrote (scripts/gen_locale.ts).
func TestFormattersEqualTheTypeScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/vectors.json")
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
		if got := FormatDate(zone.Date{Year: c.Y, Month: c.M, Day: c.D}, c.Lang); got != c.Text {
			t.Errorf("FormatDate(%d-%d-%d, %s) = %q, TypeScript %q", c.Y, c.M, c.D, c.Lang, got, c.Text)
		}
	}
	for _, c := range v.Time {
		if got := FormatTime(c.H, c.Min, c.Lang); got != c.Text {
			t.Errorf("FormatTime(%d:%d, %s) = %q, TypeScript %q", c.H, c.Min, c.Lang, got, c.Text)
		}
	}
}

func TestInr(t *testing.T) {
	for p, want := range map[int64]string{0: "₹0", 99: "₹0.99", 100: "₹1", 45050: "₹450.50", 45005: "₹450.05", 12345600: "₹1,23,456", -50: "₹-0.50", -45000: "₹-450"} {
		if got := Inr(p); got != want {
			t.Errorf("Inr(%d) = %q, want %q", p, got, want)
		}
	}
}
