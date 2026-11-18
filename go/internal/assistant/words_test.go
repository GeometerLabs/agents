package assistant

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestFormattersEqualNodes(t *testing.T) {
	b, err := os.ReadFile("testdata/format-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Inr []struct {
			Paise int64
			Text  string
		}
		Date []struct {
			Lang    string
			Y, M, D int
			Text    string
		}
		Time []struct {
			Lang   string
			H, Min int
			Text   string
		}
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Inr {
		if got := INR(c.Paise); got != c.Text {
			t.Errorf("INR(%d) = %q, node %q", c.Paise, got, c.Text)
		}
	}
	for _, c := range v.Date {
		if got := Words(c.Lang).DateText(c.Y, c.M, c.D); got != c.Text {
			t.Errorf("Date %s %d-%d-%d = %q, node %q", c.Lang, c.Y, c.M, c.D, got, c.Text)
		}
	}
	for _, c := range v.Time {
		if got := Words(c.Lang).TimeOfDay(c.H, c.Min); got != c.Text {
			t.Errorf("Time %s %d:%d = %q, node %q", c.Lang, c.H, c.Min, got, c.Text)
		}
	}
}

// Every message of every language fills its slots: no `{name}` is left when the caller gives the names the key needs, and every language has the same keys.
func TestEveryLanguageHasTheSameMessages(t *testing.T) {
	en := Words("en")
	for _, l := range []string{"hi", "ml", "kn"} {
		p := Words(l)
		for k := range en.M {
			if !p.Has(k) {
				t.Errorf("%s lacks %s", l, k)
			}
		}
		if len(p.M) != len(en.M) {
			t.Errorf("%s has %d messages, en %d", l, len(p.M), len(en.M))
		}
	}
	if got := en.Say("refusal.no_case", "ref", "b-14"); got != "Nothing has the number b-14." {
		t.Error(got)
	}
	if strings.Contains(en.Say("help.warm.named", "name", "Mithra", "shop", "Glow"), "{") {
		t.Error("slots left in help")
	}
	if !strings.Contains(Words("ml").Say("refusal.no_case", "ref", "b-14"), "b-14") {
		t.Error("ml ref")
	}
	if len(Loaded()) != 4 {
		t.Error("loaded", Loaded())
	}
}

func TestPriceInCard(t *testing.T) {
	p := Words("en")
	if got := p.Say("card.listing.priced", "title", "Persian kittens", "who", "Pets", "price", INR(800000)); got != "Show this on your page? Persian kittens. Price: ₹8,000. Category: Pets." {
		t.Error(got)
	}
}
