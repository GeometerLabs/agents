package stockorders

// Reading the owner's words, by rules only: the Go twin of src/reading.ts. The reader only READS (an item, a supplier, a unit, a number, or a command about an order); it decides
// nothing. What may be ordered, from whom and at what price is decided by the limits and the catalogue, and anything it cannot tell is asked, never guessed (agent.go).
//
// The command words are generated (words.json `reading`: each list as the regular-expression source modules/language/dates.ts wordRe builds) and matched with
// internal/language's JavaScript matcher, so `\b`, `\s` and the edges are JavaScript's. Where Go and JavaScript differ, and what is copied:
//   - `quantityIn`'s pattern `(?<![\w./-])(\d{1,6})(?![\w.]*\d)(?![.,]\d)(?!\/\d)(?!(?!x(?!\p{L}))\p{L})` has a look-behind and four look-aheads (since 25 Nov 2026 a
//     number written against a letter or in a fraction is part of a name, never a quantity); it is written out by hand below (the first run of one to six digits
//     not after a word character, dot or dash, with no digit reachable after it through word characters or dots, and no decimal after it);
//   - a name's length (`canon(n).length`) is in UTF-16 units (language.UTF16Len);
//   - `!quantityIn(t)` is JavaScript truthiness: a quantity of 0 counts as none.

import (
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// reading is reading.ts Reading. Kind is order, command, status or other.
type reading struct {
	Kind string
	// order
	LowStock        bool
	Qty             *int64
	Item            string
	Tied            []string
	Supplier        string
	Unit            string
	UnknownSupplier string
	// command: receive, wrong, paid, cancel, send, change
	Command string
	Ref     string
}

var (
	readOnce sync.Once
	re       map[string]*language.Regex
	refRe    = language.MustCompile(`\bpo-?\s*(\d{1,6})\b`, "iu")
	moneyRe  = language.MustCompile(`(?:₹|rs\.?|inr)\s*\d[\d,.]*`, "giu")
	fromRe   = language.MustCompile(`\bfrom\s+(.+?)\s*$`, "u")
	notWord  = regexp.MustCompile(`[^\p{L}\p{N}\p{M}]+`)
	latinRe  = regexp.MustCompile(`^[a-z0-9 ]+$`)
	nonLower = regexp.MustCompile(`[^a-z]+`)
)

func rx(name string) *language.Regex {
	readOnce.Do(func() {
		re = map[string]*language.Regex{}
		for k, src := range w().Reading.Words {
			re[k] = language.MustCompile(src, "u")
		}
	})
	return re[name]
}

// padded is reading.ts padded: lower case, digits in any script as Western digits, every run of other characters one space, a space at each end.
func padded(text string) string {
	return " " + strings.TrimSpace(notWord.ReplaceAllString(language.Canon(text), " ")) + " "
}

// mentions is reading.ts mentions: a Latin name matches as a whole word with a plural (s, es); a name in another script at the start of a word.
func mentions(words, name string) bool {
	n := strings.TrimSpace(notWord.ReplaceAllString(language.Canon(name), " "))
	if n == "" {
		return false
	}
	if latinRe.MatchString(n) {
		for _, suffix := range []string{" ", "s ", "es "} {
			if strings.Contains(words, " "+n+suffix) {
				return true
			}
		}
		return false
	}
	return strings.Contains(words, " "+n)
}

// longest is reading.ts longest: the length of the longest name of a set that the text mentions, 0 when none.
func longest(words string, names Names, extra []string) int {
	best := 0
	consider := func(n string) {
		if mentions(words, n) {
			best = max(best, language.UTF16Len(language.Canon(n)))
		}
	}
	for _, lang := range allLanguagesWithNames(names) {
		for _, n := range names[lang] {
			consider(n)
		}
	}
	for _, n := range extra {
		consider(n)
	}
	return best
}

// allLanguagesWithNames is Object.values(names): the order does not change a maximum, so any order is the same.
func allLanguagesWithNames(n Names) []string {
	out := make([]string, 0, len(n))
	for k := range n {
		out = append(out, k)
	}
	return out
}

func isWordByte(r rune) bool {
	return r == '_' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// quantityIn is reading.ts quantityIn: the first whole number in the text that is not part of an order number or a price.
func quantityIn(text string) *int64 {
	t := language.Canon(text)
	t = refRe.Replace(t, " ")
	t = moneyRe.Replace(t, " ")
	rs := []rune(t)
	isDigit := func(i int) bool { return i >= 0 && i < len(rs) && rs[i] >= '0' && rs[i] <= '9' }
	for i := 0; i < len(rs); i++ {
		if !isDigit(i) {
			continue
		}
		if i > 0 && (isWordByte(rs[i-1]) || rs[i-1] == '.' || rs[i-1] == '-' || rs[i-1] == '/') {
			continue
		}
		run := 0
		for isDigit(i + run) {
			run++
		}
		for l := min(6, run); l >= 1; l-- {
			end := i + l
			// (?![\w.]*\d): no digit reachable through word characters or dots
			bad := false
			for j := end; j < len(rs) && (isWordByte(rs[j]) || rs[j] == '.'); j++ {
				if isDigit(j) {
					bad = true
					break
				}
			}
			// (?![.,]\d)
			if !bad && end+1 < len(rs) && (rs[end] == '.' || rs[end] == ',') && isDigit(end+1) {
				bad = true
			}
			// (?!\/\d): a fraction ("1/2 inch") is part of a name
			if !bad && end+1 < len(rs) && rs[end] == '/' && isDigit(end+1) {
				bad = true
			}
			// (?!(?!x(?!\p{L}))\p{L}): a number written against a letter ("9W", "5L", "2kg", "16A") is part of a name; an x alone after it ("2x") is "times"
			if !bad && end < len(rs) && unicode.IsLetter(rs[end]) && !(rs[end] == 'x' && (end+1 >= len(rs) || !unicode.IsLetter(rs[end+1]))) {
				bad = true
			}
			if !bad {
				n, _ := strconv.ParseInt(string(rs[i:end]), 10, 64)
				return &n
			}
		}
	}
	for _, word := range nonLower.Split(t, -1) {
		if n, ok := w().Reading.EnglishNumbers[word]; ok {
			return &n
		}
	}
	return nil
}

// orderRefOf is order.ts orderRefOf: "po-" and the digits as written ("po-007" stays so).
func orderRefOf(text string) string {
	if m := refRe.Find(text); m != nil {
		return "po-" + m.Group(1)
	}
	return ""
}

// readOwnerText is reading.ts readOwnerText.
func readOwnerText(s *Settings, text string) reading {
	t := language.Canon(text)
	words := padded(text)
	refID := ""
	if m := refRe.Find(t); m != nil {
		n, _ := strconv.ParseInt(m.Group(1), 10, 64)
		refID = "po-" + strconv.FormatInt(n, 10)
	}
	fields := strings.Fields(strings.TrimSpace(words))
	first := ""
	if len(fields) > 0 {
		first = fields[0]
	}
	leading := func(r *language.Regex) bool {
		return r.Test(" "+first+" ") || (r.Test(t) && len(strings.FieldsFunc(language.TrimJS(t), isJSSpace)) <= 4)
	}
	for _, c := range []string{"cancel", "paid", "wrong", "receive", "send", "change"} {
		r := rx(c)
		if refID != "" {
			if !r.Test(t) {
				continue
			}
		} else if !leading(r) {
			continue
		}
		named := itemsIn(s, words)
		if refID == "" && (c == "send" || c == "change") && len(named) > 0 {
			break // "send me 10 boxes of ..." is a request, not a command
		}
		out := reading{Kind: "command", Command: c, Ref: refID}
		if len(named) == 1 {
			out.Item = named[0]
		}
		if c == "receive" || c == "change" {
			out.Qty = quantityIn(t)
		}
		return out
	}
	q := quantityIn(t)
	if rx("status").Test(t) && len(itemsIn(s, words)) == 0 && (q == nil || *q == 0) {
		return reading{Kind: "status"}
	}
	items := itemsIn(s, words)
	supplier := supplierIn(s, words)
	named := ""
	if m := fromRe.Find(t); m != nil {
		named = language.TrimJS(m.Group(1))
	}
	unknown := ""
	if supplier == "" && named != "" && len(items) > 0 {
		unknown = named
	}
	mentionsOrder := rx("order").Test(t) || rx("low").Test(t)
	if len(items) == 0 && supplier == "" && unknown == "" && !mentionsOrder {
		return reading{Kind: "other"}
	}
	out := reading{Kind: "order", LowStock: rx("low").Test(t), Qty: q, Supplier: supplier, Unit: unitIn(s, words), UnknownSupplier: unknown}
	if len(items) == 1 {
		out.Item = items[0]
	} else if len(items) > 1 {
		out.Tied = items
	}
	return out
}

// itemsIn is reading.ts itemsIn: the item with the longest matching name, or all that tie for it.
func itemsIn(s *Settings, words string) []string {
	type hit struct {
		id    string
		score int
	}
	var scored []hit
	best := 0
	for _, i := range s.Items {
		if sc := longest(words, i.Names, nil); sc > 0 {
			scored = append(scored, hit{i.ID, sc})
			best = max(best, sc)
		}
	}
	var out []string
	for _, h := range scored {
		if h.score == best {
			out = append(out, h.id)
		}
	}
	return out
}

func ensurePadded(words string) string {
	if strings.HasPrefix(words, " ") {
		return words
	}
	return padded(words)
}

// supplierIn is reading.ts supplierIn: the longest matching name or alias, among every supplier on the list (an unapproved one is named so it can be refused).
func supplierIn(s *Settings, words string) string {
	w := ensurePadded(words)
	best, score := "", 0
	for _, sp := range s.Suppliers {
		for _, n := range append([]string{sp.Name}, sp.Aliases...) {
			if l := language.UTF16Len(language.Canon(n)); mentions(w, n) && (best == "" || l > score) {
				best, score = sp.ID, l
			}
		}
	}
	return best
}

// unitIn is reading.ts unitIn: the longest matching unit name.
func unitIn(s *Settings, words string) string {
	w := ensurePadded(words)
	best, score := "", 0
	for _, u := range s.Units {
		if sc := longest(w, u.Names, nil); sc > 0 && (best == "" || sc > score) {
			best, score = u.ID, sc
		}
	}
	return best
}

var _ = utf8.RuneLen
