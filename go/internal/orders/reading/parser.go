package reading

// The Orders rule parser (src/adapters/rule-parser.ts parseIntent, isPaidClaim): a customer's message read into an Intent with no model. The shared patterns (yes, no, STOP, a
// trick, a price, a date, a time) come from internal/language and internal/understanding; Orders' own (cancel, refund, paid, owner, order, menu, pickup, delivery, the
// quantity before and after an item) from reading.json. Only the shop's item and slot names are built here, with language.WordRe as rule-parser.ts builds them with wordRe.
//
// Where Go and JavaScript differ, the JavaScript is copied: lengths and offsets are UTF-16 units (the 24 and 12 characters read around an item name, the order names are tried in),
// `\s` is JavaScript's, `split(/\s+/)` of an empty message is one piece, and a stable sort keeps the shop's order on a tie.

import (
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// nameRes keeps the pattern of a name (or of a slot's names together): built once per process, a shop's names change only with its settings.
var nameRes sync.Map

func wordsRe(names []string) *language.Regex {
	key := strings.Join(names, "\x00")
	if r, ok := nameRes.Load(key); ok {
		return r.(*language.Regex)
	}
	r := language.WordRe(names, "u", true)
	nameRes.Store(key, r)
	return r
}

// asJSONNumbers makes the numbers of a date or time phrase float64, as decoded JSON has them: the readers of an Intent's date and time take float64 (a type assertion on an int
// would read 0), so a phrase the parser found must look like one that came through JSON (the Bookings lesson).
func asJSONNumbers(m map[string]any) map[string]any {
	for k, v := range m {
		if n, ok := v.(int); ok {
			m[k] = float64(n)
		}
	}
	return m
}

// IsPaidClaim is rule-parser.ts isPaidClaim: does this say "I have paid"? Used on a UPI shop before any model is asked, and for the "paid" intent. A "no" in the same message
// ("I have not paid yet") makes it not a claim.
func IsPaidClaim(text string) bool {
	t := language.Canon(text)
	return pat("paid").Test(t) && !pat("negation").Test(t)
}

// unitSlice is `s.slice(from, to)` by UTF-16 units; a cut inside a surrogate pair drops the half character (a Go string cannot hold a lone surrogate).
func unitSlice(s string, from, to int) string {
	from = max(from, 0)
	units, start, end := 0, -1, 0
	for i, r := range s {
		w := language.UTF16Len(string(r))
		if units >= from && units+w <= to {
			if start < 0 {
				start = i
			}
			_, size := utf8.DecodeRuneInString(s[i:])
			end = i + size
		}
		units += w
	}
	if start < 0 {
		return ""
	}
	return s[start:end]
}

// quantityOf is rule-parser.ts quantityOf: a number written in digits, or a number word (1 for any other).
func quantityOf(n string) int {
	if q, err := strconv.Atoi(n); err == nil && isDigits(n) {
		return q
	}
	if q, ok := words().NumberWords[n]; ok {
		return q
	}
	return 1
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// languageOrder is the order a menu item's names are read in: the shop's languages (settings.ts fills `names` in that order), then any other language that has names.
func (c *ParseContext) languageOrder() []string {
	out := append([]string(nil), c.Languages...)
	for _, l := range runtime.LANGUAGES {
		if !contains(out, l) {
			out = append(out, l)
		}
	}
	return out
}

type nameOf struct {
	id, name string
	units    int
}

// findItems is rule-parser.ts findItems: the menu items named in the message, each with a quantity (the number just before the name, "x 2" just after, else 1). Longest name
// first, so "veg thali" beats "thali"; a stretch of the message already taken by a longer name is not read again.
func findItems(t string, c *ParseContext) []IntentLine {
	text := language.BlankWrittenDate(t)
	order := c.languageOrder()
	var names []nameOf
	for i := range c.Menu {
		item := &c.Menu[i]
		for _, l := range order {
			for _, n := range item.Names[l] {
				cn := language.Canon(n)
				names = append(names, nameOf{item.ID, cn, language.UTF16Len(cn)})
			}
		}
	}
	sort.SliceStable(names, func(i, j int) bool { return names[i].units > names[j].units })
	type span struct{ a, b int }
	var taken []span
	var lines []IntentLine
	for _, nm := range names {
		for _, m := range wordsRe([]string{nm.name}).All(text) {
			start, end := m.Start(), m.End() // bytes: only compared with each other
			overlap := false
			for _, s := range taken {
				if start < s.b && s.a < end {
					overlap = true
					break
				}
			}
			if overlap {
				continue
			}
			taken = append(taken, span{start, end})
			u := language.UTF16Index(text, start)
			ue := language.UTF16Index(text, end)
			qty := 1
			if after := pat("quantityAfter").Find(unitSlice(text, ue, ue+12)); after != nil {
				qty, _ = strconv.Atoi(after.Group(1))
			} else if before := pat("quantityBefore").Find(unitSlice(text, u-24, u)); before != nil {
				qty = quantityOf(before.Group(1))
			}
			found := -1
			for i := range lines {
				if lines[i].ItemID == nm.id {
					found = i
					break
				}
			}
			if found >= 0 {
				lines[found].Qty += qty
			} else {
				lines = append(lines, IntentLine{ItemID: nm.id, Qty: qty})
			}
		}
	}
	return lines
}

// findSlots is rule-parser.ts findSlots: the slots a name in the message stands for ("lunch" is the lunch slot for pickup and the one for delivery).
func findSlots(t string, c *ParseContext) []string {
	var ids []string
	for i := range c.Slots {
		s := &c.Slots[i]
		var names []string
		for _, l := range runtime.LANGUAGES { // Object.values(slot.names): settings.ts readSlotNames fills them in LANGUAGES' order
			for _, n := range s.Names[l] {
				names = append(names, language.Canon(n))
			}
		}
		if len(names) > 0 && wordsRe(names).Test(t) {
			ids = append(ids, s.ID)
		}
	}
	return ids
}

// ParseIntent is rule-parser.ts parseIntent: one message read. Pure; it decides nothing.
func ParseIntent(text string, c *ParseContext) Intent {
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
	items := findItems(t, c)
	offer := understanding.FindOffer(t)
	date := language.FindDatePhrase(text)
	tm := language.FindTimePhrase(text)
	slotIDs := findSlots(t, c)
	mode := ""
	if pat("pickup").Test(t) {
		mode = "pickup"
	} else if pat("delivery").Test(t) {
		mode = "delivery"
	}
	if len(items) > 0 {
		in.Items = items
	}
	if offer >= 0 {
		in.OfferInr = &offer
	} else if understanding.AsksDiscount(t) {
		in.AskDiscount = true // E1: "any discount?" with no price named (a named price wins)
	}
	if date != nil {
		in.Date = asJSONNumbers(date.JSON())
	}
	if tm != nil {
		in.Time = asJSONNumbers(tm.JSON())
	}
	in.Mode = mode
	if len(slotIDs) > 0 {
		in.SlotIDs = slotIDs
	}

	hasDetails := len(items) > 0 || offer >= 0 || date != nil || tm != nil || mode != "" || len(slotIDs) > 0
	// t.trim().split(/\s+/u).length: an empty message is one (empty) piece in JavaScript
	pieces := len(strings.FieldsFunc(language.TrimJS(t), language.IsJSSpace))
	shortReply := max(pieces, 1) <= 5 && !hasDetails

	switch {
	case pat("cancel").Test(t):
		in.Kind = "cancel"
	case pat("refund").Test(t):
		in.Kind = "refund"
	case pat("paid").Test(t) && !pat("negation").Test(t):
		in.Kind = "paid"
	case pat("owner").Test(t):
		in.Kind = "owner"
	case hasDetails || pat("order").Test(t):
		in.Kind = "order"
	case shortReply && language.P("rules.no").Test(t) && !language.P("rules.yes").Test(t):
		in.Kind = "no"
	case shortReply && language.P("rules.yes").Test(t):
		in.Kind = "yes"
	case language.P("rules.greeting").Test(t) || pat("menu").Test(t):
		in.Kind = "greeting"
	}
	return in
}
