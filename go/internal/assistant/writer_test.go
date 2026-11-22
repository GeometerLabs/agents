package assistant

// Every line the packs hold, in every language, passes the outgoing check over the facts the Writer notes for it, with ordinary values in its slots (a count, an amount, a date, a
// reference with digits, a name with digits). The generator already proves the TypeScript's check passes each key's words with its facts; this proves the Go side reads the
// generated facts the same way, so no line the assistant says is held back by a fact Go failed to note (the listings shop's and Bookings' contracts would show it later and
// less clearly). The slots a caller notes itself (a limit's rule and values, a list of names, the morning line's parts) get words without digits here.

import (
	"regexp"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/language"
)

var notSaid = regexp.MustCompile(`^(talk\.system|alert\.|signin\.)|\.(name|order)$`)
var slotRe = regexp.MustCompile(`\{(\w+)\}`)

func TestEveryPackedLinePassesTheCheckWithItsOwnFacts(t *testing.T) {
	for _, l := range []string{"en", "hi", "ml", "kn"} {
		p := Words(l)
		if len(p.F) < 100 {
			t.Fatalf("%s: only %d keys carry facts", l, len(p.F))
		}
		for key, text := range p.M {
			if notSaid.MatchString(key) {
				continue
			}
			var vals []string
			for _, m := range slotRe.FindAllStringSubmatch(text, -1) {
				name := m[1]
				v := "Room 4 Ravi"
				switch name {
				case "n":
					v = "3"
				case "inr":
					v = INR(123450)
				case "date":
					v = p.DateText(2026, 11, 25)
				case "time":
					v = p.TimeOfDay(16, 5)
				case "slot":
					v = p.DateText(2026, 11, 25) + ", " + p.TimeOfDay(16, 5)
				case "ref", "case", "mcase", "id":
					v = "b-14"
				case "code":
					v = "K7M2QX"
				case "rule", "now", "to", "names", "missed", "price", "today", "money", "waiting", "v", "sources":
					v = "plain words" // noted by the caller
				}
				vals = append(vals, name, v)
			}
			w := p.Writer()
			said := w.Say(key, vals...)
			if strings.Contains(said, "{") && slotRe.MatchString(said) {
				t.Errorf("%s %s: a slot is left: %q", l, key, said)
			}
			if problems := language.CheckText(said, w.Facts()); len(problems) > 0 {
				t.Errorf("%s %s: %q held back: %v", l, key, said, problems)
			}
		}
	}
}

func TestRupeesOfReadsWhatFormatInrWrites(t *testing.T) {
	for _, paise := range []int64{0, 100, 50000, 150050, 12345600} {
		v, ok := RupeesOf(INR(paise))
		if !ok || v != float64(paise)/100 {
			t.Errorf("%d: %v %v", paise, v, ok)
		}
	}
	if _, ok := RupeesOf("never"); ok {
		t.Error("never is not an amount")
	}
}
