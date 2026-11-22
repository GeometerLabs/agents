package stockorders

// Every message the Stock orders agent sends, per language, and the words its reader looks for: the Go twin of src/language/templates.ts (`render`, MessageFacts, STATE_WORDS,
// money), labels.ts, meta-templates.ts (the WhatsApp templates), check.ts (the outgoing check's facts), modules/stock/words.ts (the count's lines to the owner's app) and the
// word lists of src/reading.ts. The words are GENERATED, never retyped: words.json is written by go/scripts/gen_stockorders_words.ts, which renders each TypeScript template with
// probe facts and turns each probe back into a `{slot}` named after the fact it reads; this file only fills the slots.
//
// Facts are a map, as the TypeScript's MessageFacts object is: a send-once intent's `values` are merged over the order's own facts exactly as agent.ts deliverIntent does. A message
// whose record lacks a fact it needs is refused with the TypeScript's own sentence (`need`).
//
// Where Go and JavaScript differ: `money` writes whole rupees with language.FormatInr and others with two decimals in the en-IN grouping (toLocaleString "en-IN" with two fraction
// digits); a count is written as JavaScript's String(n) of a whole number.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

//go:embed words.json
var wordsJSON []byte

var isJSSpace = language.IsJSSpace

type message struct {
	Text  string   `json:"text"`
	Needs []string `json:"needs"`
}

type metaWord struct {
	Name     string   `json:"name"`
	UsedFor  string   `json:"usedFor"`
	Audience string   `json:"audience"`
	Body     string   `json:"body"`
	Params   []string `json:"params"`
}

// labels are labels.ts Labels.
type labels struct {
	Approve     string `json:"approve"`
	Decline     string `json:"decline"`
	SupplierYes string `json:"supplierYes"`
	SupplierNo  string `json:"supplierNo"`
	Choose      string `json:"choose"`
}

type langWords struct {
	T      map[string]message `json:"t"`
	Row    string             `json:"row"`
	State  map[string]string  `json:"state"`
	Labels labels             `json:"labels"`
	Meta   []metaWord         `json:"meta"`
	Stock  map[string]string  `json:"stock"`
}

type allWords struct {
	Generic         struct{ Customer, Owner string } `json:"generic"`
	ReportTemplates []string                         `json:"reportTemplates"`
	MonthsEn        []string                         `json:"monthsEn"`
	Languages       map[string]*langWords            `json:"languages"`
	Reading         struct {
		Words          map[string]string `json:"words"`
		EnglishNumbers map[string]int64  `json:"englishNumbers"`
	} `json:"reading"`
}

var (
	wordsOnce sync.Once
	words     allWords
)

func w() *allWords {
	wordsOnce.Do(func() {
		if err := json.Unmarshal(wordsJSON, &words); err != nil {
			panic("internal/stockorders/words.json does not read: " + err.Error())
		}
	})
	return &words
}

func wordsFor(lang string) *langWords {
	if l, ok := w().Languages[lang]; ok {
		return l
	}
	return w().Languages["en"]
}

// TemplateNames are every WhatsApp template name, for the stand-in WhatsApp to approve (services.ts: the messages', the generic two and the report's).
func TemplateNames() []string {
	out := []string{w().Generic.Customer, w().Generic.Owner}
	for _, m := range wordsFor("en").Meta {
		out = append(out, m.Name)
	}
	return append(out, w().ReportTemplates...)
}

// facts are templates.ts MessageFacts: the values of the record a message may use.
type facts map[string]any

// statusRow is templates.ts StatusRow.
type statusRow struct {
	Ref, ItemName, UnitName, SupplierName, StateWord string
	Qty, ReceivedQty                                 int64
	TotalInr                                         float64
}

// choice is one way to order an item, for the list the owner picks from.
type choice struct {
	SupplierName, UnitName string
	PriceInr               float64
}

var slotRe = regexp.MustCompile(`\{([A-Za-z]+)\}`)

var amountFacts = map[string]bool{"unitPriceInr": true, "totalInr": true, "budgetInr": true, "reservedInr": true, "leftInr": true, "capInr": true, "limitInr": true}

// money is templates.ts money: whole rupees plainly ("₹4,500"), otherwise two decimals ("₹37.50").
func money(rupees float64) string {
	if rupees == math.Trunc(rupees) {
		return language.FormatInr(rupees)
	}
	s := strconv.FormatFloat(math.Abs(rupees), 'f', 2, 64)
	whole, frac, _ := strings.Cut(s, ".")
	sign := ""
	if rupees < 0 {
		sign = "-"
	}
	return "₹" + sign + language.GroupIN(whole) + "." + frac
}

func numOf(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int64:
		return float64(x), true
	case int:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	}
	return 0, false
}

// jsString is String(n) of a number as JavaScript writes it.
func jsString(f float64) string { return jsNum(f) }

// value is one slot's text, or false when the record has no such fact.
func (f facts) value(slot, lang string) (string, bool) {
	v, ok := f[slot]
	if !ok || v == nil {
		return "", false
	}
	switch slot {
	case "options", "refs":
		l, _ := v.([]string)
		return strings.Join(l, ", "), true
	case "lines":
		rows, _ := v.([]statusRow)
		out := make([]string, len(rows))
		row := wordsFor(lang).Row
		for i, r := range rows {
			out[i] = fillSlots(row, func(s string) (string, bool) {
				switch s {
				case "ref":
					return r.Ref, true
				case "qty":
					return strconv.FormatInt(r.Qty, 10), true
				case "itemName":
					return r.ItemName, true
				case "unitName":
					return r.UnitName, true
				case "supplierName":
					return r.SupplierName, true
				case "totalInr":
					return money(r.TotalInr), true
				case "stateWord":
					return r.StateWord, true
				}
				return "", false
			})
		}
		return strings.Join(out, "\n"), true
	}
	if n, isNum := numOf(v); isNum {
		if amountFacts[slot] {
			return money(n), true
		}
		return jsString(n), true
	}
	if s, isStr := v.(string); isStr {
		return s, true
	}
	return fmt.Sprint(v), true
}

func fillSlots(text string, value func(string) (string, bool)) string {
	return slotRe.ReplaceAllStringFunc(text, func(m string) string {
		v, _ := value(m[1 : len(m)-1])
		return v
	})
}

// render is templates.ts render: one message from the record's facts, or the TypeScript's refusal when a fact it needs is missing.
func render(id string, f facts) (string, error) {
	lang, _ := f["language"].(string)
	m, ok := wordsFor(lang).T[id]
	if !ok {
		return "", fmt.Errorf("No message %s.", id)
	}
	for _, need := range m.Needs {
		if v, there := f[need]; !there || v == nil {
			return "", fmt.Errorf("The record has no %s for this message.", need)
		}
	}
	return fillSlots(m.Text, func(s string) (string, bool) {
		if s == "lines" || s == "options" || s == "refs" {
			if _, there := f[s]; !there {
				return "", true // `?? []`: an empty list
			}
		}
		return f.value(s, lang)
	}), nil
}

// stateWord is STATE_WORDS[lang][key].
func stateWordIn(lang, key string) string { return wordsFor(lang).State[key] }

// stockLine is STOCK_LINE_WORDS[lang][kind] with its values.
func stockLine(lang, kind string, vals map[string]string) string {
	return fillSlots(wordsFor(lang).Stock[kind], func(s string) (string, bool) { v, ok := vals[s]; return v, ok })
}

// ---- the WhatsApp templates (meta-templates.ts) ---------------------------------------------------------------------------------------------------------

var numbered = regexp.MustCompile(`\{\{(\d+)\}\}`)

// metaBody is meta-templates.ts metaBody: {slot} turned into {{1}}, {{2}} ... in order.
func metaBody(body string) string {
	n := 0
	return slotRe.ReplaceAllStringFunc(body, func(string) string { n++; return "{{" + strconv.Itoa(n) + "}}" })
}

func fillBody(metaText string, params []string) string {
	return numbered.ReplaceAllStringFunc(metaText, func(m string) string {
		n, _ := strconv.Atoi(numbered.FindStringSubmatch(m)[1])
		if n >= 1 && n <= len(params) {
			return params[n-1]
		}
		return ""
	})
}

// templateMessage is meta-templates.ts templateMessage: a message that is exactly one of the templates goes as that template with its parameters, but only if filling it gives
// back the very text the outgoing check read; anything else goes as the generic name with no parameters.
func templateMessage(ids []string, f facts, text, generic string) messaging.TemplateMessage {
	lang, _ := f["language"].(string)
	if len(ids) == 1 {
		for _, t := range wordsFor(lang).Meta {
			if t.UsedFor != ids[0] {
				continue
			}
			params := make([]string, 0, len(t.Params))
			ok := true
			for _, p := range t.Params {
				v, there := f.value(p, lang)
				ok = ok && there
				params = append(params, v)
			}
			if ok && fillBody(metaBody(t.Body), params) == text {
				return messaging.TemplateMessage{Name: t.Name, Language: lang, Text: text, Parameters: params}
			}
			break
		}
	}
	return messaging.TemplateMessage{Name: generic, Language: lang, Text: text}
}

// ---- the outgoing check's facts (check.ts) ----------------------------------------------------------------------------------------------------------------

// checkFacts is check.ts checkFactsOf: what the outgoing check may let a message state, the record's own facts as plain lists.
func checkFacts(f facts) language.Facts {
	var out language.Facts
	for _, k := range []string{"unitPriceInr", "totalInr", "budgetInr", "reservedInr", "leftInr", "capInr", "limitInr"} {
		if n, ok := numOf(f[k]); ok {
			out.AmountsInr = append(out.AmountsInr, n)
		}
	}
	rows, _ := f["lines"].([]statusRow)
	for _, r := range rows {
		out.AmountsInr = append(out.AmountsInr, r.TotalInr)
	}
	chs, _ := f["choices"].([]choice)
	for _, c := range chs {
		out.AmountsInr = append(out.AmountsInr, c.PriceInr)
	}
	for _, k := range []string{"qty", "receivedQty", "moreQty", "saidQty", "hours", "maxQty"} {
		if n, ok := numOf(f[k]); ok {
			out.Counts = append(out.Counts, n)
		}
	}
	for _, r := range rows {
		out.Counts = append(out.Counts, float64(r.Qty), float64(r.ReceivedQty))
	}
	str := func(k string) {
		if s, ok := f[k].(string); ok {
			out.Literals = append(out.Literals, s)
		}
	}
	for _, k := range []string{"businessName", "supplierName", "itemName", "unitName", "orderRef", "code", "monthLabel"} {
		str(k)
	}
	for _, k := range []string{"options", "refs"} {
		l, _ := f[k].([]string)
		out.Literals = append(out.Literals, l...)
	}
	for _, r := range rows {
		out.Literals = append(out.Literals, r.Ref, r.ItemName, r.UnitName, r.SupplierName, r.StateWord)
	}
	for _, c := range chs {
		out.Literals = append(out.Literals, c.SupplierName, c.UnitName)
	}
	str("stateWord")
	str("example")
	return out
}

// matches is limits.ts checkMessageMatchesRecord over checkFacts.
func matches(text string, f facts) messaging.Decision {
	tz, _ := f["timeZone"].(string)
	cf := checkFacts(f)
	cf.Loc = zoneLoc(tz)
	if problems := language.CheckText(text, cf); len(problems) > 0 {
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: "The message does not match the record. " + strings.Join(problems, " ")}
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount, date, time and link in the message is in the record."}
}
