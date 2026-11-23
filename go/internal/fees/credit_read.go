package fees

// Reading the owner's credit-book words with no model: "Ramesh owes 2,400", "Ramesh paid 1,000", "who owes", "ask Ramesh", and a name with a WhatsApp number. The word lists are
// the TypeScript's own (templates/education/fees/src/credit/words.ts CREDIT_WORDS, generated into reading.json), built with language.WordRe as the Fees rule parser builds its
// lists, over language.Canon (lower case, the Indian scripts' digits as 0-9).
//
// Why no model reads these words: they carry a customer's number and an amount of money. A model's reading is untrusted, and a number given to the shop must stay in the shop;
// so the credit book reads them by rules alone, and a message with a number in it that the rules cannot read is answered with the credit book's help line, never handed to the
// assistant or a hosted model (credit.go creditOwnerText).
//
// The name is what is left when the number, the amount and the credit words are taken out, in the owner's own letters and case (Plain, not lower-cased), so "Ramesh K" stays
// "Ramesh K". A name with a digit in it is no name.

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/GeometerLabs/agents/go/internal/language"
)

type creditLists struct {
	Owes, OwesWeak, Paid, List, Ask, Filler []string
}

type creditReaders struct {
	owes, owesWeak, paid, list, ask, filler *language.Regex
}

var (
	creditOnce    sync.Once
	creditReading creditReaders
)

// creditWords is the credit book's lists, built once from reading.json's `credit` member.
func creditWords() *creditReaders {
	creditOnce.Do(func() {
		var l struct {
			Credit creditLists `json:"credit"`
		}
		if err := json.Unmarshal(readingJSON, &l); err != nil {
			panic("reading.json: " + err.Error())
		}
		c := l.Credit
		creditReading = creditReaders{owes: language.WordRe(c.Owes, "u", false), owesWeak: language.WordRe(c.OwesWeak, "u", false), paid: language.WordRe(c.Paid, "u", false), list: language.WordRe(c.List, "u", false),
			ask: language.WordRe(c.Ask, "u", false), filler: language.WordRe(c.Filler, "u", false)}
	})
	return &creditReading
}

// creditSaid is what the owner's words say to the credit book.
type creditSaid struct {
	kind      string // "owes", "paid", "list", "ask", "number", "unclear" (both owes and paid), "" (none of the credit book's words)
	weak      bool   // "owes" read from a word that also means "remaining" only (CREDIT_WORDS owesWeak)
	name      string
	amountInr int64
	hasAmount bool
	badAmount bool // a number that is not whole rupees, or 0
	phone     string
	hasPhone  bool
}

var (
	// a phone number as people type it: digits with spaces or dashes inside, maybe a + in front
	creditPhoneRe = regexp.MustCompile(`\+?\d[\d \-]{8,17}\d`)
	// an amount: 2,400 or 2400 or 1,00,000, maybe with paise after a point
	creditAmountRe = regexp.MustCompile(`\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?`)
)

// phoneOf reads a typed number as a WhatsApp number with + and the country code: "+44 7700 900123" as written; ten digits from 6 to 9 as an Indian mobile (+91); "91" and
// ten such digits likewise. Anything else is no number.
func phoneOf(typed string) (string, bool) {
	var d strings.Builder
	for _, r := range typed {
		if r >= '0' && r <= '9' {
			d.WriteRune(r)
		}
	}
	digits := d.String()
	switch {
	case strings.HasPrefix(typed, "+") && len(digits) >= 10 && len(digits) <= 15:
		return "+" + digits, true
	case len(digits) == 10 && digits[0] >= '6' && digits[0] <= '9':
		return "+91" + digits, true
	case len(digits) == 12 && strings.HasPrefix(digits, "91") && digits[2] >= '6' && digits[2] <= '9':
		return "+" + digits, true
	}
	return "", false
}

type span struct{ from, to int }

// readCredit reads one message of the owner's.
func readCredit(text string) creditSaid {
	w := creditWords()
	plain := language.Plain(text)
	low := strings.ToLower(plain)
	if len(low) != len(plain) { // a letter whose lower case is longer: read the lower-cased text for the name too
		plain = low
	}
	var out creditSaid
	var gone []span
	for _, m := range creditPhoneRe.FindAllStringIndex(low, -1) {
		if p, ok := phoneOf(low[m[0]:m[1]]); ok {
			out.phone, out.hasPhone = p, true
			gone = append(gone, span{m[0], m[1]})
			break
		}
	}
	for _, m := range creditAmountRe.FindAllStringIndex(low, -1) {
		if inside(gone, m[0]) {
			continue
		}
		if m[0] > 0 && (low[m[0]-1] == '-' || unicode.IsLetter(rune(low[m[0]-1]))) { // "f-3", "c2": a reference, not an amount
			continue
		}
		whole, frac, _ := strings.Cut(strings.ReplaceAll(low[m[0]:m[1]], ",", ""), ".")
		n, err := strconv.ParseInt(whole, 10, 64)
		out.hasAmount = true
		out.badAmount = err != nil || n < 1 || strings.Trim(frac, "0") != ""
		out.amountInr = n
		gone = append(gone, span{m[0], m[1]})
		break
	}
	found := func(r *language.Regex) []*language.Match { return r.All(low) }
	owes, weak, paid, list, ask := found(w.owes), found(w.owesWeak), found(w.paid), found(w.list), found(w.ask)
	for _, ms := range [][]*language.Match{owes, weak, paid, list, ask, found(w.filler)} {
		for _, m := range ms {
			gone = append(gone, span{m.Start(), m.End()})
		}
	}
	out.name = nameLeft(plain, gone)
	switch {
	case len(list) > 0 && out.name == "" && !out.hasAmount:
		out.kind = "list"
	case len(ask) > 0 && ask[0].Start() == firstWordAt(low) && !out.hasAmount:
		out.kind = "ask"
	case len(owes)+len(weak) > 0 && len(paid) > 0:
		out.kind = "unclear"
	case len(owes) > 0:
		out.kind = "owes"
	case len(weak) > 0:
		out.kind, out.weak = "owes", true
	case len(paid) > 0:
		out.kind = "paid"
	case out.hasPhone && !out.hasAmount:
		out.kind = "number"
	}
	return out
}

func inside(spans []span, at int) bool {
	for _, s := range spans {
		if at >= s.from && at < s.to {
			return true
		}
	}
	return false
}

func firstWordAt(s string) int {
	for i, r := range s {
		if !language.IsJSSpace(r) {
			return i
		}
	}
	return 0
}

// nameLeft is the words of the text that no span covers and that have a letter in them, joined by one space, with the punctuation at either end taken off. A word with a digit
// in it makes no name (a number the reader did not take, so the name cannot be trusted).
func nameLeft(text string, gone []span) string {
	var words []string
	start := -1
	flush := func(end int) {
		if start < 0 {
			return
		}
		word := text[start:end]
		at := start
		start = -1
		if inside(gone, at) || inside(gone, end-1) {
			return
		}
		letters := false
		for _, r := range word {
			letters = letters || unicode.IsLetter(r) || unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Mc, r)
		}
		if letters {
			words = append(words, word)
		}
	}
	for i, r := range text {
		if language.IsJSSpace(r) || r == ',' || r == ':' || r == ';' {
			flush(i)
		} else if start < 0 {
			start = i
		}
	}
	flush(len(text))
	name := strings.TrimFunc(strings.Join(words, " "), func(r rune) bool { return unicode.IsPunct(r) || unicode.IsSymbol(r) })
	if strings.IndexFunc(name, unicode.IsDigit) >= 0 || language.UTF16Len(name) > 40 {
		return ""
	}
	return name
}
