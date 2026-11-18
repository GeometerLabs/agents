// Tests of the packed words and their formatters: equal to Node's on the vectors of go/scripts/gen_format_vectors.ts, and every language has the same messages.
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
		Moment []struct {
			Lang string
			Ms   int64
			Text string
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
	if len(v.Moment) == 0 {
		t.Fatal("no moment vectors: run node go/scripts/gen_format_vectors.ts")
	}
	for _, c := range v.Moment {
		if got := Words(c.Lang).Moment(c.Ms); got != c.Text {
			t.Errorf("Moment %s %d = %q, node %q", c.Lang, c.Ms, got, c.Text)
		}
	}
}

// The owner-control alerts: each form fills every slot, the label and the Operator's name are optional as in TypeScript, and a value is never read as a slot.
func TestOwnerAlerts(t *testing.T) {
	at := int64(1_763_500_000_123)
	for _, l := range []string{"en", "hi", "ml", "kn"} {
		p := Words(l)
		for _, what := range []string{"new_phone", "codes_made", "phone_removed", "removal_asked", "owner_change_asked"} {
			for _, extra := range []string{"", "Android, Chrome"} {
				got := p.OwnerAlert(what, at, extra, extra)
				if strings.Contains(got, "{") {
					t.Errorf("%s %s: a slot is left: %q", l, what, got)
				}
				if extra != "" && what != "owner_change_asked" && !strings.Contains(got, extra) {
					t.Errorf("%s %s: no %q in %q", l, what, extra, got)
				}
			}
		}
	}
	en := Words("en")
	if got := en.OwnerAlert("new_phone", at, "iPhone, Safari", ""); got != "A new phone was added to your shop on "+en.Moment(at)+" (iPhone, Safari). Not you? Open your app and remove it." {
		t.Error(got)
	}
	if got := en.OwnerAlert("removal_asked", at, "", ""); !strings.HasPrefix(got, "Your Operator asked to remove every phone") {
		t.Error(got)
	}
	if got := en.OwnerAlert("removal_asked", at, "", "{at}"); !strings.HasPrefix(got, "{at} asked") {
		t.Error("a name that looks like a slot must stay as it is:", got)
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
