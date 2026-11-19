package language

// The TypeScript's own patterns, by name (patterns.json, written by go/scripts/gen_patterns.ts from each RegExp's `.source` and `.flags`; `node go/scripts/gen_patterns.ts`
// after a change to one of them, or the test words-fresh fails). Compiled once per process, the first time any is asked for, and shared by every shop the process holds.

import (
	_ "embed"
	"encoding/json"
	"sync"
)

//go:embed patterns.json
var patternsJSON []byte

type pack struct {
	Kinds    []string `json:"kinds"`
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
