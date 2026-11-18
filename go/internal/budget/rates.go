package budget

// The price list for model calls (modules/understanding/rates.ts): the dated tables in rates/<date>.json, US dollars per million tokens, from which a call is priced in micro-rupees.
// A price that is not in the table is UNKNOWN (nil), never 0, and a call with no price counts at the budget's assumed price (Config.unpriced). The tables are COPIES of the TypeScript
// ones (scripts/sync_rates.sh; a contract test fails if they differ), embedded because go:embed cannot reach outside this module. A line holds from its file's date until a later file
// has a line for the same provider and model.

import (
	"embed"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"sync"
)

//go:embed rates/*.json
var ratesFS embed.FS

// Rate is one line of the table.
type Rate struct {
	Provider, From  string
	Model           string
	Pattern         *regexp.Regexp
	In, Out, Cached float64
	HasCached       bool
	InrPerUsd       float64
}

// BuilderRate is a builder's own price for a model they host (runtime.json parser.rate), in US dollars per million tokens.
type BuilderRate struct {
	In  float64 `json:"inputUsdPerMillion"`
	Out float64 `json:"outputUsdPerMillion"`
}

// SelfHosted is the provider name such a model is recorded under (rates.ts SELF_HOSTED_PROVIDER).
const SelfHosted = "self-hosted"

var (
	tableOnce sync.Once
	table     []Rate
)

// Table reads the embedded tables once.
func Table() []Rate {
	tableOnce.Do(func() {
		files, _ := ratesFS.ReadDir("rates")
		for _, f := range files {
			b, _ := ratesFS.ReadFile("rates/" + f.Name())
			var raw struct {
				Date      string                 `json:"date"`
				InrPerUsd struct{ Rate float64 } `json:"inrPerUsd"`
				Rates     []struct {
					Provider, Model, ModelPattern string
					In                            float64  `json:"inputUsdPerMillion"`
					Out                           float64  `json:"outputUsdPerMillion"`
					Cached                        *float64 `json:"cachedInputUsdPerMillion"`
				} `json:"rates"`
			}
			if json.Unmarshal(b, &raw) != nil {
				continue
			}
			for _, l := range raw.Rates {
				r := Rate{Provider: l.Provider, Model: l.Model, From: raw.Date, In: l.In, Out: l.Out, InrPerUsd: raw.InrPerUsd.Rate}
				if l.ModelPattern != "" {
					// the TypeScript pattern is a JavaScript RegExp with the "iu" flags; RE2 reads the same simple patterns
					if re, err := regexp.Compile("(?i)" + l.ModelPattern); err == nil {
						r.Pattern = re
					}
				}
				if l.Cached != nil {
					r.Cached, r.HasCached = *l.Cached, true
				}
				table = append(table, r)
			}
		}
	})
	return table
}

func newestInr() float64 {
	best, rate := "", 0.0
	for _, r := range Table() {
		if r.From >= best {
			best, rate = r.From, r.InrPerUsd
		}
	}
	return rate
}

// SelfHostedRate is the builder's rate as one line of the table, from the day the runtime started, at the newest file's rupee rate.
func SelfHostedRate(model string, b BuilderRate, from string) Rate {
	return Rate{Provider: SelfHosted, Model: model, From: from, In: b.In, Out: b.Out, InrPerUsd: newestInr()}
}

// RateFor is the rate in force on a day (YYYY-MM-DD) for this provider and model, or nil. extra lines (a builder's own) are searched with the table.
func RateFor(provider, model, day string, extra ...Rate) *Rate {
	var found []Rate
	for _, r := range append(append([]Rate{}, Table()...), extra...) {
		if r.Provider != provider || r.From > day {
			continue
		}
		switch {
		case r.Pattern != nil:
			if !r.Pattern.MatchString(model) {
				continue
			}
		case r.Model != "*" && r.Model != model:
			continue
		}
		found = append(found, r)
	}
	if len(found) == 0 {
		return nil
	}
	sort.SliceStable(found, func(i, j int) bool { return found[i].From > found[j].From })
	return &found[0]
}

// CostMicroInr is what a call cost in micro-rupees, rounded up; nil when there is no rate. Cached input is priced at the cached rate when the line has one (rates.ts costMicroInr).
func CostMicroInr(r *Rate, inTokens, outTokens, cachedTokens int64) *int64 {
	if r == nil {
		return nil
	}
	cached := cachedTokens
	if cached > inTokens {
		cached = inTokens
	}
	cp := r.In
	if r.HasCached {
		cp = r.Cached
	}
	microUsd := float64(inTokens-cached)*r.In + float64(cached)*cp + float64(outTokens)*r.Out
	inr := r.InrPerUsd
	if inr == 0 {
		inr = newestInr()
	}
	v := int64(math.Max(0, math.Ceil(microUsd*inr-1e-9)))
	return &v
}
