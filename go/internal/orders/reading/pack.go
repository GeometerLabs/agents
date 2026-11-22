// Package reading is how an Orders shop READS a customer's message (the Go twin of templates/commerce/orders/src/adapters/{model,rule-parser,reading}.ts,
// src/language/interactive.ts intentFromReply and src/plans/words.ts): the rule parser that turns a message in Hindi, English, Malayalam or Kannada (or typed in Latin letters)
// into an Intent with no model, the check on a model's answer (untrusted, decoded to `any` and checked by hand as the TypeScript does), the reading the shared router
// (understanding.Router) is given, a tapped button or list row read with no model, and the plan reading (subscribe, skip, pause, resume, cancel, mine).
//
// It never decides anything: prices, stock, cut-offs and the delivery list are decided by the limits, so a smarter (or fooled) parser changes nothing about what is allowed.
//
// Every word list and every pattern is the TypeScript's own, GENERATED into reading.json by go/scripts/gen_orders_reading.ts (each RegExp's `.source` and `.flags`), matched by
// internal/language's JavaScript-regex matcher; only a shop's item and slot names, which the shop gives at run time, are turned into patterns here, with language.WordRe as
// wordRe builds them. The shared readers (yes, no, STOP, a trick, a price, a day, a time, the language) are internal/language's and internal/understanding's.
package reading

import (
	_ "embed"
	"encoding/json"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/language"
)

//go:embed reading.json
var readingJSON []byte

type pack struct {
	Patterns map[string]struct {
		Source string `json:"source"`
		Flags  string `json:"flags"`
	} `json:"patterns"`
	NumberWords map[string]int `json:"numberWords"`
	Kinds       []string       `json:"kinds"`
	ModelKinds  []string       `json:"modelKinds"`
	Questions   struct {
		Intent struct {
			Instructions string      `json:"instructions"`
			Criteria     [][2]string `json:"criteria"`
		} `json:"intent"`
	} `json:"questions"`
	Prompt string         `json:"prompt"`
	Schema map[string]any `json:"schema"`

	re map[string]*language.Regex
}

var (
	packOnce sync.Once
	packed   pack
)

// words is reading.json, decoded and its patterns compiled, once per process (the compile panics, which the tests show, if a pattern is one the matcher cannot copy).
func words() *pack {
	packOnce.Do(func() {
		if err := json.Unmarshal(readingJSON, &packed); err != nil {
			panic("orders/reading: reading.json: " + err.Error())
		}
		packed.re = make(map[string]*language.Regex, len(packed.Patterns))
		for name, p := range packed.Patterns {
			packed.re[name] = language.MustCompile(p.Source, p.Flags)
		}
	})
	return &packed
}

// pat is the pattern of that name (a name that is not in reading.json is a programming error).
func pat(name string) *language.Regex {
	r, ok := words().re[name]
	if !ok {
		panic("orders/reading: no pattern named " + name)
	}
	return r
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
