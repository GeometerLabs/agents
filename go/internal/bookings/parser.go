package bookings

// The Bookings rule parser (src/adapters/rule-parser.ts parseIntent): a customer's message in Hindi, English, Malayalam or Kannada (or typed in Latin letters) read into an
// Intent with no model. It never decides anything: prices, hours and slots are decided by the limits, so a smarter (or fooled) parser changes nothing about what is allowed.
// The patterns are the TypeScript's: the shared ones (yes, no, STOP, a trick, a price, a date, a time) from language/patterns.json, Bookings' own (cancel, reschedule, book) from
// reading.json (go/scripts/gen_bookings_reading.ts); only a service's names, which a shop gives, are built here, with language.WordRe as rule-parser.ts builds them.

import (
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// nameRes keeps the pattern of each service name a shop gives (built once per name per process; a shop's names change only with its settings).
var nameRes sync.Map

func nameRe(name string) *language.Regex {
	if r, ok := nameRes.Load(name); ok {
		return r.(*language.Regex)
	}
	r := language.WordRe([]string{name}, "u", true)
	nameRes.Store(name, r)
	return r
}

// findService is rule-parser.ts findService: the service whose name is in the words, the longest name winning (by UTF-16 length; the first found on a tie). Names are tried in the
// order the TypeScript's names object has them: the shop's languages' order, as settings.ts fills it.
func findService(t string, s *Settings) string {
	best, bestLen := "", -1
	for i := range s.Services {
		sv := &s.Services[i]
		for _, l := range s.Languages {
			for _, name := range sv.Names[l] {
				if n := language.UTF16Len(name); n > bestLen && nameRe(name).Test(t) {
					best, bestLen = sv.ID, n
				}
			}
		}
	}
	return best
}

// ParseIntent is rule-parser.ts parseIntent: pure, with no model.
func ParseIntent(text string, s *Settings) Intent {
	t := language.Canon(text)
	in := Intent{Kind: "unknown", Language: understanding.DetectLanguage(text)}
	if understanding.IsOverrideAttempt(t) {
		yes := true
		in.OverrideAttempt = &yes
	}
	if understanding.IsStop(t) {
		in.Kind = "stop"
		return in
	}
	in.ServiceID = findService(t, s)
	if offer := understanding.FindOffer(t); offer >= 0 {
		in.OfferInr = &offer
	}
	if d := language.FindDatePhrase(text); d != nil {
		in.Date = d.JSON()
	}
	if tm := language.FindTimePhrase(text); tm != nil {
		in.Time = tm.JSON()
	}
	hasDetails := in.ServiceID != "" || in.OfferInr != nil || in.Date != nil || in.Time != nil
	// t.trim().split(/\s+/u).length: an empty message is one (empty) piece in JavaScript
	words := len(strings.FieldsFunc(language.TrimJS(t), language.IsJSSpace))
	shortReply := max(words, 1) <= 5 && !hasDetails
	r := readingWords()
	switch {
	case r.reschedule.Test(t) || r.rescheduleDravidian.Test(t):
		in.Kind = "reschedule"
	case r.cancel.Test(t):
		in.Kind = "cancel"
	case hasDetails || r.book.Test(t):
		in.Kind = "book"
	case shortReply && language.P("rules.no").Test(t) && !language.P("rules.yes").Test(t):
		in.Kind = "no"
	case shortReply && language.P("rules.yes").Test(t):
		in.Kind = "yes"
	case language.P("rules.greeting").Test(t):
		in.Kind = "greeting"
	}
	return in
}
