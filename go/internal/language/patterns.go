package language

// The TypeScript's own patterns, by name (patterns.json, written by go/scripts/gen_patterns.ts from each RegExp's `.source` and `.flags`; `node go/scripts/gen_patterns.ts`
// after a change to one of them, or the test words-fresh fails). Compiled once per process, the first time any is asked for, and shared by every shop the process holds.

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"sync"
)

//go:embed patterns.json
var patternsJSON []byte

type pack struct {
	Kinds    []string `json:"kinds"`
	Offers   []Offer  `json:"offers"`
	Patterns map[string]struct {
		Source string `json:"source"`
		Flags  string `json:"flags"`
	} `json:"patterns"`
}

var (
	packOnce sync.Once
	packed   pack
	compiled map[string]*Regex
)

func load() {
	packOnce.Do(func() {
		if err := json.Unmarshal(patternsJSON, &packed); err != nil {
			panic("language: patterns.json: " + err.Error())
		}
		compiled = make(map[string]*Regex, len(packed.Patterns))
		for name, p := range packed.Patterns {
			compiled[name] = MustCompile(p.Source, p.Flags)
		}
	})
}

// P is the pattern of that name ("dates.today", "intents.kind.undo", "talk.number_words"). A name that is not in the pack is a programming error.
func P(name string) *Regex {
	load()
	r, ok := compiled[name]
	if !ok {
		panic("language: no pattern named " + name)
	}
	return r
}

// OwnerKinds is the order the owner's kinds are tried in (intents.ts KIND_RES): the first whose words are in a message wins.
func OwnerKinds() []string {
	load()
	return packed.Kinds
}

// Ps is the numbered patterns of a family, in their order: "rules.override." gives rules.override.0, .1, ... as far as they go.
func Ps(prefix string) []*Regex {
	load()
	var out []*Regex
	for i := 0; ; i++ {
		r, ok := compiled[prefix+strconv.Itoa(i)]
		if !ok {
			return out
		}
		out = append(out, r)
	}
}

// Offer is what understanding/rules.ts OFFER_TESTS says of each price pattern (rules.offer.N): the smallest price it may give, and whether a written date is blanked out first.
type Offer struct {
	Minimum         float64 `json:"minimum"`
	SkipWrittenDate bool    `json:"skipWrittenDate"`
}

// Offers is OFFER_TESTS's numbers, in the patterns' order.
func Offers() []Offer {
	load()
	return packed.Offers
}
