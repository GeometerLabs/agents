package fees

// Reading a parent's message with no model: the Go twin of templates/education/fees/src/adapters/rule-parser.ts parseIntent, and of interactive.ts intentFromReply (a tapped
// button is read by its id). The word lists are the TypeScript's own (reading.json, written by go/scripts/gen_fees_words.ts from rule-parser.ts FEE_WORDS), built with
// language.WordRe as wordRe builds them; the shared readers (yes, no, a greeting, STOP, a trick, a price, a written date) are internal/understanding's and internal/language's.
//
// Where Go and JavaScript differ: findAmount's plain-number pattern `(?<![\d:.])(\d[\d,]*)(?![\d:])` has a look-behind and a look-ahead, which RE2 does not have, so the edges are
// checked by hand. The "already" pattern of a negated claim (`/\balready\b|पहले ही|ഇതിനകം|ಈಗಾಗಲೇ/u`, inline in parseIntent) is written here as it is there.
// What is NOT ported: the model steps (the decision model and the language model through the shared router), so a Fees centre on Go reads every message by these rules
// (Deferred.md).

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

//go:embed reading.json
var readingJSON []byte

type readingLists struct {
	Fee struct {
		Paid, Pay, Discount, Refund, Owner, Not []string
	} `json:"fee"`
	Classes struct {
		Next, Material, Doubt []string
	} `json:"classes"`
}

type readers struct {
	paid, pay, discount, refund, owner, not *language.Regex
	next, material, doubt, doubtAnyCase     *language.Regex
	lists                                   readingLists
}

var (
	readingOnce sync.Once
	reading     readers
)

func readingWords() *readers {
	readingOnce.Do(func() {
		if err := json.Unmarshal(readingJSON, &reading.lists); err != nil {
			panic("reading.json: " + err.Error())
		}
		f := reading.lists.Fee
		reading.paid, reading.pay, reading.discount = language.WordRe(f.Paid, "u", false), language.WordRe(f.Pay, "u", false), language.WordRe(f.Discount, "u", false)
		reading.refund, reading.owner = language.WordRe(f.Refund, "u", false), language.WordRe(f.Owner, "u", false)
		reading.not = language.WordRe(f.Not, "u", true)
		c := reading.lists.Classes
		reading.next, reading.material, reading.doubt = language.WordRe(c.Next, "u", false), language.WordRe(c.Material, "u", false), language.WordRe(c.Doubt, "u", false)
		reading.doubtAnyCase = language.WordRe(c.Doubt, "giu", false)
	})
	return &reading
}

// intent is model.ts Intent.
type intent struct {
	Kind            string `json:"kind"`
	Language        string `json:"language,omitempty"`
	AmountInr       *int64 `json:"amountInr,omitempty"`
	DueID           string `json:"dueId,omitempty"`
	OverrideAttempt bool   `json:"overrideAttempt,omitempty"`
}

var (
	alreadyRe = regexp.MustCompile(`(?:^|[^\p{L}\p{N}_])already(?:$|[^\p{L}\p{N}_])|पहले ही|ഇതിനകം|ಈಗಾಗಲೇ`)
	tiedReply = regexp.MustCompile(`^(pay|paid):(f-\d{1,9})$`)
)

// findAmount is rule-parser.ts findAmount: a rupee cue first (the shared finder), else the first plain number of 20 or more that is not part of a written date.
func findAmount(t string) *int64 {
	if cued := understanding.FindOffer(t); cued > 0 {
		return &cued
	}
	b := language.BlankWrittenDate(t)
	digit := func(c byte) bool { return c >= '0' && c <= '9' }
	// the JavaScript engine's search, by hand: at each place a digit may start (not after a digit, a colon or a dot), the longest run of digits and commas, given back one
	// character at a time until what follows is neither a digit nor a colon; the next search starts where a match ended
	for i := 0; i < len(b); {
		if !digit(b[i]) || (i > 0 && (digit(b[i-1]) || b[i-1] == ':' || b[i-1] == '.')) {
			i++
			continue
		}
		run := i + 1
		for run < len(b) && (digit(b[run]) || b[run] == ',') {
			run++
		}
		end := -1
		for e := run; e > i; e-- {
			if e == len(b) || (!digit(b[e]) && b[e] != ':') {
				end = e
				break
			}
		}
		if end < 0 {
			i++
			continue
		}
		n, err := strconv.ParseInt(strings.ReplaceAll(b[i:end], ",", ""), 10, 64)
		if err == nil && n >= 20 && n <= 1_000_000 {
			return &n
		}
		i = end
	}
	return nil
}

// parseIntent is rule-parser.ts parseIntent.
func parseIntent(text string) intent {
	t := language.Canon(text)
	in := intent{Kind: "unknown", Language: understanding.DetectLanguage(text)}
	if understanding.IsOverrideAttempt(t) {
		in.OverrideAttempt = true
	}
	if understanding.IsStop(t) {
		in.Kind = "stop"
		return in
	}
	amount := findAmount(t)
	// t.trim().split(/\s+/u).filter(Boolean).length
	tokens := len(strings.FieldsFunc(language.TrimJS(t), language.IsJSSpace))
	short := tokens <= 5
	r := readingWords()
	switch {
	case r.refund.Test(t):
		in.Kind, in.AmountInr = "refund", amount
	case r.discount.Test(t):
		in.Kind, in.AmountInr = "discount", amount
	case r.paid.Test(t):
		in.Kind = "paid"
		if r.not.Test(t) && !alreadyRe.MatchString(t) {
			in.Kind = "pay"
		}
	case r.owner.Test(t):
		in.Kind = "owner"
	case r.pay.Test(t):
		in.Kind = "pay"
	case short && language.P("rules.no").Test(t) && !language.P("rules.yes").Test(t):
		in.Kind = "no"
	case short && language.P("rules.yes").Test(t):
		in.Kind = "yes"
	case language.P("rules.greeting").Test(t):
		in.Kind = "greeting"
	}
	return in
}

// intentFromReply is interactive.ts intentFromReply: the Intent a button id stands for, or nil when the id is none of ours.
func intentFromReply(id string) *intent {
	switch id {
	case "yes", "no", "owner", "pay", "paid":
		return &intent{Kind: id}
	}
	if m := tiedReply.FindStringSubmatch(id); m != nil {
		return &intent{Kind: m[1], DueID: m[2]}
	}
	return nil
}
