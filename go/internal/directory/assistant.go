// The buyer's assistant at the directory (modules/discovery/assistant.ts; specs/directory.md "The buyer's assistant"; decision 60). A buyer may type "Persian kitten near Thrissur?" in
// their own words. The assistant turns the question into a TYPED SEARCH (words, a category from the fixed list, a place, a radius, a highest price); the directory then searches and ranks
// with its own code as it always did, and a short line in the buyer's language, built from the results by a fixed template, is written over them.
//
// What it is NOT: it never ranks, never answers from its own knowledge, never talks to a shop and never sees a shop's conversation. A MODEL'S ANSWER IS UNTRUSTED INPUT: it is decoded to
// `any` and checked by hand (readTypedSearch): exactly seven keys, every value of its exact type and size; anything that does not fit is dropped whole and the buyer's words are searched
// as typed, with ONE plain notice. The steps, cheapest first: 1. patterns read "within 10 km", "under 5000", "near me" (no model); 2. the language model, through the model Guard (its
// address; no key lives here, the directory's own credential is its bearer), only with a budget, a daily cap and the one buyer's own cap in hand.
//
// NOT PORTED (Deferred.md): the decision model ("System One", which the deployer never configures: directoryConfig writes no `systemOne`) and the hook that lets a model write the line over
// the results (`writeLine`, which the service never wires, with the talk-check that would guard it). The line is the template. Only the "openai" model wire is spoken here, as in the shop
// runtime; the TypeScript also speaks "anthropic".
package directory

import (
	"context"
	"fmt"
	"github.com/GeometerLabs/agents/go/internal/language"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/budget"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

const (
	MaxQuestion = 200
	maxWords    = 8
	maxWord     = 30
	maxTown     = 80
	maxPrice    = 10_000_000
	dayMs       = 86_400_000
	timeZone    = "Asia/Kolkata"
)

// TypedSearch is a search as a program says it: the only thing a model may give back.
type TypedSearch struct {
	Words    []string `json:"words"`
	WordsEn  []string `json:"wordsEn"`
	Category string   `json:"category,omitempty"`
	Place    Place2   `json:"place"`
	RadiusKm *int     `json:"radiusKm,omitempty"`
	MaxPrice *int     `json:"maxPrice,omitempty"`
}

// Place2 is where a typed search looks: a town, "near me" or nowhere.
type Place2 struct {
	Kind string `json:"kind"`
	Town string `json:"town,omitempty"`
}

var (
	wordOK = regexp.MustCompile(`^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'-]*$`)
	townOK = regexp.MustCompile(`^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'-]*$`)
	keys   = []string{"words", "words_en", "category", "place", "town", "radius_km", "max_price"}
)

func wordList(v any) ([]string, bool) {
	arr, ok := v.([]any)
	if !ok || len(arr) > maxWords {
		return nil, false
	}
	out := make([]string, 0, len(arr))
	for _, w := range arr {
		s, ok := w.(string)
		if !ok {
			return nil, false
		}
		t := language.TrimJS(s)
		if t == "" || language.UTF16Len(t) > maxWord || !wordOK.MatchString(t) {
			return nil, false
		}
		out = append(out, t)
	}
	return out, true
}

// whole is `v === null ? undefined : integer in [min,max] ? v : null (bad)`.
func whole(v any, min, max float64) (value *int, ok bool) {
	if v == nil {
		return nil, true
	}
	f, isNum := v.(float64)
	if !isNum || f != math.Trunc(f) || f < min || f > max {
		return nil, false
	}
	n := int(f)
	return &n, true
}

// ReadTypedSearch is the model's answer as a typed search, or nil. Strict: exactly the seven keys, every value of its exact type and size, a category from the fixed list, a town only with
// place "town". One thing wrong anywhere drops the WHOLE answer, because a half-valid answer is a model not doing what it was asked.
func ReadTypedSearch(raw any) *TypedSearch {
	r, ok := isObj(raw)
	if !ok || len(r) != len(keys) {
		return nil
	}
	for _, k := range keys {
		if _, has := r[k]; !has {
			return nil
		}
	}
	words, ok1 := wordList(r["words"])
	wordsEn, ok2 := wordList(r["words_en"])
	if !ok1 || !ok2 {
		return nil
	}
	category, ok := r["category"].(string)
	if !ok || !(category == "any" || isCategory(category)) {
		return nil
	}
	place, _ := r["place"].(string)
	if place != "town" && place != "near_me" && place != "none" {
		return nil
	}
	town, ok := r["town"].(string)
	if !ok {
		return nil
	}
	townText := language.TrimJS(town)
	if place == "town" {
		if townText == "" || language.UTF16Len(townText) > maxTown || !townOK.MatchString(townText) {
			return nil
		}
	} else if townText != "" {
		return nil
	}
	radius, okR := whole(r["radius_km"], 1, 500)
	price, okP := whole(r["max_price"], 1, maxPrice)
	if !okR || !okP {
		return nil
	}
	t := &TypedSearch{Words: words, WordsEn: wordsEn, RadiusKm: radius, MaxPrice: price, Place: Place2{Kind: place}}
	if category != "any" {
		t.Category = category
	}
	if place == "town" {
		t.Place.Town = townText
	}
	return t
}

// ---- step 1: the rules ----

var (
	reRadius      = regexp.MustCompile(`(?i)(\d{1,3})[` + language.JSSpace + `]*(?:km|kms|kilomet(?:er|re)s?|किमी|किलोमीटर|കി\.?[` + language.JSSpace + `]?മീ|കിലോമീറ്റർ|ಕಿ\.?[` + language.JSSpace + `]?ಮೀ|ಕಿಲೋಮೀಟರ್)([^\p{L}\p{M}]|$)`)
	rePriceBefore = regexp.MustCompile(`(?i)(?:under|below|less than|upto|up to|max(?:imum)?|budget(?: of)?)[` + language.JSSpace + `]*(?:₹|rs\.?|inr)?[` + language.JSSpace + `]*(\d[\d,]{0,8})`)
	rePriceAfter  = regexp.MustCompile(`(?i)(\d[\d,]{0,8})[` + language.JSSpace + `]*(?:₹|rs\.?|rupees|रुपये|रुपए|രൂപ|ರೂಪಾಯಿ)?[` + language.JSSpace + `]*(?:or less|or below|से कम|के अंदर|ൽ താഴെ|ക്ക് താഴെ|ಕ್ಕಿಂತ ಕಡಿಮೆ)`)
	reNearMe1     = regexp.MustCompile(`(?i)(?:near me|nearby|around me)([^\p{L}\p{M}]|$)`)
	reNearMe2     = regexp.MustCompile(`(?i)मेरे पास|आस-पास|എന്റെ അടുത്ത്|ನನ್ನ ಹತ್ತಿರ`)
)

// findNearMe is NEAR_ME.exec: the leftmost of "near me", "nearby", "around me" (not after a letter, not before one) and the other languages' phrases, as a span.
func findNearMe(s string) (int, int, bool) {
	best, bestEnd := -1, -1
	pos := 0
	for pos <= len(s) {
		m := reNearMe1.FindStringSubmatchIndex(s[pos:])
		if m == nil {
			break
		}
		start := pos + m[0]
		if notAfterLetter(s, start) {
			best, bestEnd = start, pos+m[2]
			break
		}
		_, w := utf8.DecodeRuneInString(s[start:])
		pos = start + w
	}
	if m := reNearMe2.FindStringIndex(s); m != nil && (best < 0 || m[0] < best) {
		best, bestEnd = m[0], m[1]
	}
	return best, bestEnd, best >= 0
}

// Rules is what patterns alone can read: a distance, a highest price, "near me". Rest is the text without those phrases (what is left to understand).
type Rules struct {
	RadiusKm *int
	MaxPrice *int
	NearMe   bool
	Rest     string
}

// ReadRules reads the patterns.
func ReadRules(text string) Rules {
	rest := text
	out := Rules{}
	if m := reRadius.FindStringSubmatchIndex(rest); m != nil {
		if n, _ := strconv.Atoi(rest[m[2]:m[3]]); n >= 1 && n <= 500 {
			out.RadiusKm = &n
			rest = rest[:m[0]] + " " + rest[m[4]:] // the match without the one character that showed no letter follows
		}
	}
	var p []string
	if m := rePriceBefore.FindStringSubmatch(rest); m != nil {
		p = m
	} else if m := rePriceAfter.FindStringSubmatch(rest); m != nil {
		p = m
	}
	if p != nil {
		price, err := strconv.Atoi(strings.ReplaceAll(p[1], ",", ""))
		if err == nil && price >= 1 && price <= maxPrice {
			out.MaxPrice = &price
			rest = strings.Replace(rest, p[0], " ", 1)
		}
	}
	if s, e, ok := findNearMe(rest); ok {
		out.NearMe = true
		rest = rest[:s] + " " + rest[e:]
	}
	out.Rest = rest
	return out
}

// ---- the model call: understanding.Model, the one implementation the shops' runtime uses too (model-llm.ts askJson, the openai wire; 8000 ms and 1024 tokens by default) ----

// ---- the assistant ----

// AssistantConfig is what the assistant needs. Without a budget there is no assistant at all (the caller makes none). Model is the config's `assistant.model` (wire, baseUrl,
// model; the credential is Bearer, read by the caller from `assistant.agentTokenFile`, so the model's own file and environment fields are not read).
type AssistantConfig struct {
	Budget         *budget.Config
	PerBuyerPerDay int
	Model          understanding.ModelConfig
	Provider       string // the provider the rate table prices the model under (default "deepinfra")
	Bearer         string
	Client         *http.Client
	Now            func() int64
	Log            func(string)
}

// Assistant is the buyer's assistant.
type Assistant struct {
	cfg     AssistantConfig
	model   *understanding.Model
	limiter *Limiter
	clock   budget.Clock
	mu      sync.Mutex
	ai      *budget.AI
	how     map[string]int
	refused map[string]int
	asked   int
}

// NewAssistant makes the assistant.
func NewAssistant(cfg AssistantConfig) *Assistant {
	if cfg.Now == nil {
		cfg.Now = func() int64 { return time.Now().UnixMilli() }
	}
	if cfg.Provider == "" {
		cfg.Provider = "deepinfra"
	}
	if cfg.Log == nil {
		cfg.Log = func(string) {}
	}
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		loc = time.FixedZone("IST", 19800)
	}
	model := understanding.Open(cfg.Model, cfg.Bearer, cfg.Client, understanding.ParserTimeoutMs, understanding.ParserMaxTokens)
	return &Assistant{cfg: cfg, model: model, limiter: NewLimiter(map[string]Limit{"ask": {cfg.PerBuyerPerDay, dayMs}}, cfg.Now), clock: budget.Clock{Now: cfg.Now, Loc: loc}, how: map[string]int{}, refused: map[string]int{}}
}

// AskInput is a question and who asks.
type AskInput struct {
	Question string
	Lang     string
	Who      string // an address, for the per-buyer cap: never kept as it is, never logged
	Lat, Lon string
	Towns    []string
}

// Understood is what the assistant made of a question.
type Understood struct {
	How     string // model or plain
	Typed   *TypedSearch
	Refused string
}

func (a *Assistant) fall(why string) Understood {
	a.mu.Lock()
	a.how["plain"]++
	a.refused[why]++
	n := a.refused[why]
	a.mu.Unlock()
	a.cfg.Log(fmt.Sprintf("directory: the buyer's assistant fell back to the plain search (%s), %d so far", why, n)) // a reason and a count, never the question
	return Understood{How: "plain", Refused: why}
}

// meter counts a model call against the budget: the spend in the one meter, the call for today (a failed call still counts: it still cost).
func (a *Assistant) meter(r understanding.Answer) {
	at := a.cfg.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	month := budget.For(&a.ai, a.clock, at)
	month.Model++
	cost := new(int64)
	if r.HasUsage {
		rate := budget.RateFor(a.cfg.Provider, a.cfg.Model.Model, time.UnixMilli(at).UTC().Format("2006-01-02"))
		cost = budget.CostMicroInr(rate, r.InputTokens, r.OutputTokens, r.CachedTokens)
		if cost == nil {
			month.Unpriced++
		} else {
			month.CostMicroInr += *cost
		}
	}
	budget.Record(&a.ai, a.cfg.Budget, "buyer", cost, "", a.clock, at)
}

func (a *Assistant) allowed() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return budget.Gate(&a.ai, a.cfg.Budget, "buyer", a.clock, a.cfg.Now(), "")
}

// Understand reads a question: patterns, then the model (when the caps allow), else nothing (the words are searched as typed).
func (a *Assistant) Understand(ctx context.Context, in AskInput) Understood {
	a.mu.Lock()
	a.asked++
	a.mu.Unlock()
	if !a.limiter.Take("ask", in.Who) {
		return a.fall("buyer")
	}
	if why := a.allowed(); why != "" {
		return a.fall(why)
	}
	clean := CleanQuestion(in.Question)
	rules := ReadRules(clean)
	near := func(p Place2) Place2 {
		if p.Kind == "none" && rules.NearMe {
			return Place2{Kind: "near_me"}
		}
		return p
	}
	if why := a.allowed(); why != "" {
		return a.fall(why)
	}
	user := language.TrimJS(stripMarks(rules.Rest))
	if user == "" {
		user = clean
	}
	p := loadPack()
	got := a.model.AskContext(ctx, understanding.Call{System: p.Assistant.System, User: "<question>" + user + "</question>", Schema: p.Assistant.Schema, Name: p.Assistant.Name})
	a.meter(got)
	if got.Reason != "" || got.Answer == nil {
		return a.fall("failed")
	}
	typed := ReadTypedSearch(got.Answer)
	if typed == nil {
		return a.fall("bad_answer")
	}
	a.mu.Lock()
	a.how["model"]++
	a.mu.Unlock()
	// the rules' numbers are the buyer's own words read by pattern: they win over what a model says
	if rules.RadiusKm != nil {
		typed.RadiusKm = rules.RadiusKm
	}
	if rules.MaxPrice != nil {
		typed.MaxPrice = rules.MaxPrice
	}
	typed.Place = near(typed.Place)
	return Understood{How: "model", Typed: typed}
}

// RequestOf is the typed search as the directory's request. The buyer's own point (if they gave one) is used for "near me" and for distances; a town is used as named.
func RequestOf(t *TypedSearch, in AskInput, useEnglish bool) SearchRequest {
	words := t.Words
	if useEnglish || len(words) == 0 {
		words = t.WordsEn
	}
	r := SearchRequest{"q": strings.Join(words, " "), "lang": in.Lang}
	if t.Category != "" {
		r["category"] = t.Category
	}
	if t.Place.Kind == "town" {
		r["town"] = t.Place.Town
	} else if in.Lat != "" && in.Lon != "" {
		r["lat"], r["lon"] = in.Lat, in.Lon
	}
	if t.RadiusKm != nil {
		r["radius_km"] = float64(*t.RadiusKm)
	}
	return r
}

// Asked is what "Ask in your own words" came to.
type Asked struct {
	Searched Searched
	Search   *TypedSearch
	How      string
	Line     string // "" when there is none to say
	Notice   string // the one plain notice when the buyer's words were searched as typed
	Form     FormValues
}

// AskListings: understand, search with the directory's own code, say it in a line. Never fails for a bad answer from a model: that is the plain search.
func AskListings(ctx context.Context, deps SearchDeps, a *Assistant, in AskInput) Asked {
	in.Question = language.UTF16SliceFFFD(language.TrimJS(in.Question), MaxQuestion)
	if in.Towns == nil {
		in.Towns = deps.Index.Towns(30)
	}
	u := a.Understand(ctx, in)
	w := WordsIn(in.Lang)
	if u.Typed == nil {
		searched := SearchListings(deps, plainRequest(in))
		return Asked{Searched: searched, How: "plain", Notice: w.S("askPlain"), Form: FormValues{Q: in.Question, Lat: in.Lat, Lon: in.Lon}}
	}
	typed := u.Typed
	usedEnglish := false
	searched := SearchListings(deps, RequestOf(typed, in, false))
	// nothing found with the buyer's own words: the English words are tried once (a search of the index is free; no model is asked again)
	if searched.OK && len(searched.Answer.Results) == 0 && len(typed.Words) > 0 && len(typed.WordsEn) > 0 {
		if again := SearchListings(deps, RequestOf(typed, in, true)); again.OK && len(again.Answer.Results) > 0 {
			searched, usedEnglish = again, true
		}
	}
	if searched.OK && typed.MaxPrice != nil {
		cap := float64(*typed.MaxPrice)
		kept := make([]SearchResultItem, 0, len(searched.Answer.Results))
		for _, r := range searched.Answer.Results {
			if v, _ := strconv.ParseFloat(func() string {
				if r.Item.Price != nil {
					return r.Item.Price.Value
				}
				return ""
			}(), 64); r.Item.Price == nil || v <= cap {
				kept = append(kept, r)
			}
		}
		searched.Answer.Results = kept
	}
	var results []SearchResultItem
	if searched.OK {
		results = searched.Answer.Results
	}
	line := lineFor(in, results, typed, usedEnglish)
	said := typed.Words
	if usedEnglish || len(typed.Words) == 0 {
		said = typed.WordsEn
	}
	f := FormValues{Q: strings.Join(said, " "), Category: typed.Category, RadiusKm: ""}
	if typed.Place.Kind == "town" {
		f.Town = typed.Place.Town
	} else {
		f.Lat, f.Lon = in.Lat, in.Lon
	}
	if typed.RadiusKm != nil {
		f.RadiusKm = strconv.Itoa(*typed.RadiusKm)
	}
	return Asked{Searched: searched, Search: typed, How: u.How, Line: line, Form: f}
}

func plainRequest(in AskInput) SearchRequest {
	r := SearchRequest{"q": in.Question, "lang": in.Lang}
	if in.Lat != "" && in.Lon != "" {
		r["lat"], r["lon"] = in.Lat, in.Lon
	}
	return r
}

// lineFor is the short line over the results: the template of the buyer's language, made from the results (so it cannot say what they do not).
func lineFor(in AskInput, results []SearchResultItem, typed *TypedSearch, usedEnglish bool) string {
	if len(results) == 0 {
		return ""
	}
	w := WordsIn(in.Lang)
	said := typed.Words
	if usedEnglish || len(typed.Words) == 0 {
		said = typed.WordsEn
	}
	what := strings.Join(said, " ")
	if what == "" && typed.Category != "" {
		what = w.Map("kinds")[typed.Category]
	}
	if what == "" {
		return ""
	}
	shops := map[string]bool{}
	nearest := math.Inf(1)
	for _, r := range results {
		shops[r.Shop.Page] = true
		if r.Shop.DistanceKm != nil && *r.Shop.DistanceKm < nearest {
			nearest = *r.Shop.DistanceKm
		}
	}
	args := map[string]string{"what": what}
	var flags []string
	if !math.IsInf(nearest, 1) {
		args["km"] = KmText(nearest)
		flags = append(flags, "km")
	}
	if typed.Place.Kind == "town" {
		args["town"] = typed.Place.Town
		flags = append(flags, "town")
	}
	return w.Fn("askLine", len(shops), strings.Join(flags, ","), args)
}

// askAnswer is `{...answer, assistant: {how, search, line, notice}}`.
func askAnswer(r Asked) any {
	var search any
	if r.Search != nil {
		search = r.Search
	}
	var line, notice any
	if r.Line != "" {
		line = r.Line
	}
	if r.Notice != "" {
		notice = r.Notice
	}
	a := r.Searched.Answer
	return orderedMap("format", a.Format, "results", a.Results, "order", a.Order, "next", a.Next, "assistant", orderedMap("how", r.How, "search", search, "line", line, "notice", notice))
}
