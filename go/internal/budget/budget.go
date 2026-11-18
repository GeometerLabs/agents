// Package budget is the shop's own limit on the language model: the month's spend in micro-rupees and a daily cap on each feature (modules/budget/budget.ts), and the month's AI
// counts they are judged against (modules/understanding/ai-state.ts). Both live in the shop's snapshot as `ai`, in the TypeScript runtime's own shape, so a month started by one
// runtime goes on in the other. The model is asked only when `Gate` says yes, so a feature over a cap costs nothing and falls back.
package budget

import (
	"encoding/json"
	"time"
)

// Features a budget can cap.
var Features = []string{"owner_talk", "customer_talk", "listing_draft", "router", "buyer"}

// Config is runtime.json's `budget`.
type Config struct {
	MonthlyMicroInr      int64            `json:"monthlyMicroInr"`
	Daily                map[string]int64 `json:"daily"`
	UnpricedCallMicroInr *int64           `json:"unpricedCallMicroInr,omitempty"`
	WarnBasisPoints      *int64           `json:"warnBasisPoints,omitempty"`
}

// DefaultUnpricedCallMicroInr is what a call with no price in the rate table counts as against the budget: 10 paise.
const DefaultUnpricedCallMicroInr = 100_000

// KeysKept is how many paid-for message keys the month remembers.
const KeysKept = 60

func (c *Config) unpriced() int64 {
	if c.UnpricedCallMicroInr != nil {
		return *c.UnpricedCallMicroInr
	}
	return DefaultUnpricedCallMicroInr
}

// Valid is the TypeScript `isBudgetConfig`: whole numbers, known features, no stray keys.
func Valid(raw map[string]any) bool {
	whole := func(v any, min float64) bool { f, ok := v.(float64); return ok && f == float64(int64(f)) && f >= min }
	if !whole(raw["monthlyMicroInr"], 0) {
		return false
	}
	d, ok := raw["daily"].(map[string]any)
	if !ok {
		return false
	}
	for k, n := range d {
		known := false
		for _, f := range Features {
			known = known || f == k
		}
		if !known || !whole(n, 1) {
			return false
		}
	}
	if v, ok := raw["unpricedCallMicroInr"]; ok && !whole(v, 0) {
		return false
	}
	if v, ok := raw["warnBasisPoints"]; ok && !(whole(v, 1) && v.(float64) <= 10_000) {
		return false
	}
	for k := range raw {
		if k != "monthlyMicroInr" && k != "daily" && k != "unpricedCallMicroInr" && k != "warnBasisPoints" {
			return false
		}
	}
	return true
}

// Row is a feature's month: calls and spend.
type Row struct {
	Calls int64 `json:"calls"`
	Micro int64 `json:"micro"`
}

// Told is the notices already sent, so each is sent once.
type Told struct {
	Warn string            `json:"warn,omitempty"`
	Full string            `json:"full,omitempty"`
	Days map[string]string `json:"days,omitempty"`
}

// State is the budget's counts inside the AI state.
type State struct {
	Day   string           `json:"day"`
	Today map[string]int64 `json:"today"`
	By    map[string]*Row  `json:"by"`
	Told  Told             `json:"told"`
	Keys  []string         `json:"keys,omitempty"`
}

// AI is the month's AI counts: what is spent on understanding, and whether the shop is in button mode. Members this runtime does not use (voice, a step's health) are carried
// along untouched so a round trip through here loses nothing.
type AI struct {
	Month         string          `json:"month"`
	Rules         int64           `json:"rules"`
	Decision      int64           `json:"decision"`
	Model         int64           `json:"model"`
	CostMicroInr  int64           `json:"costMicroInr"`
	Speech        json.RawMessage `json:"speech,omitempty"`
	Unpriced      int64           `json:"unpriced"`
	Budget        *State          `json:"budget,omitempty"`
	PausedUntilMs *int64          `json:"pausedUntilMs,omitempty"`
	Steps         json.RawMessage `json:"steps,omitempty"`
	Told          AITold          `json:"told"`
}

// AITold: allowance month, override announced, fault day, model-off month.
type AITold struct {
	Allowance string `json:"allowance,omitempty"`
	Override  bool   `json:"override,omitempty"`
	Fault     string `json:"fault,omitempty"`
	ModelOff  string `json:"modelOff,omitempty"`
}

// Policy is what the shop's runtime.json allows: the switches (asked every time, so a change takes effect at once), the allowance and the budget.
type Policy struct {
	Override       func() string // "buttons" or "auto"
	Model          func() string // "off" or "normal"
	Budget         *Config
	AllowanceMsgs  *int64
	AllowanceMicro *int64
	PauseMinutes   int64
}

// DefaultPauseMinutes is how long button mode lasts after a model step fails.
const DefaultPauseMinutes = 5

// Clock gives the time and the shop's zone.
type Clock struct {
	Now func() int64
	Loc *time.Location
}

// Month is "2026-11" in the shop's zone.
func (c Clock) Month(ms int64) string { return time.UnixMilli(ms).In(c.Loc).Format("2006-01") }

// Day is "2026-11-18" in the shop's zone.
func (c Clock) Day(ms int64) string { return time.UnixMilli(ms).In(c.Loc).Format("2006-01-02") }

// For returns the AI state for this month, starting the month again when it has moved on (the counts and the budget start from zero; a pause in force carries over).
func For(ai **AI, c Clock, nowMs int64) *AI {
	month := c.Month(nowMs)
	cur := *ai
	if cur == nil {
		*ai = &AI{Month: month}
		return *ai
	}
	if cur.Month != month {
		*ai = &AI{Month: month, Told: AITold{Override: cur.Told.Override, Fault: cur.Told.Fault}, PausedUntilMs: cur.PausedUntilMs, Steps: cur.Steps}
	}
	return *ai
}

func stateOf(ai **AI, c Clock, nowMs int64) *State {
	a := For(ai, c, nowMs)
	day := c.Day(nowMs)
	if a.Budget == nil {
		a.Budget = &State{Day: day, Today: map[string]int64{}, By: map[string]*Row{}}
	}
	b := a.Budget
	if b.Today == nil {
		b.Today = map[string]int64{}
	}
	if b.By == nil {
		b.By = map[string]*Row{}
	}
	if b.Day != day {
		b.Day, b.Today = day, map[string]int64{}
	}
	return b
}

// Used is what the month has spent, counting a call with no price at the assumed price.
func Used(ai **AI, cfg *Config, c Clock, nowMs int64) int64 {
	a := For(ai, c, nowMs)
	return a.CostMicroInr + a.Unpriced*cfg.unpriced()
}

// Level of the month's budget.
type Level struct {
	Used, Limit, BasisPoints int64
	Name                     string // ok, warn, full
}

// LevelOf is how much of the budget is used.
func LevelOf(ai **AI, cfg *Config, c Clock, nowMs int64) Level {
	if cfg == nil {
		return Level{Name: "ok"}
	}
	used := Used(ai, cfg, c, nowMs)
	limit := cfg.MonthlyMicroInr
	bp := int64(10_000)
	if limit > 0 {
		bp = used * 10_000 / limit
	}
	warn := int64(8_000)
	if cfg.WarnBasisPoints != nil {
		warn = *cfg.WarnBasisPoints
	}
	name := "ok"
	switch {
	case used >= limit:
		name = "full"
	case bp >= warn:
		name = "warn"
	}
	if bp > 10_000 {
		bp = 10_000
	}
	return Level{Used: used, Limit: limit, BasisPoints: bp, Name: name}
}

// ModelOff: is the language model left out right now? Fleet's outside switch says so ("fleet"), or the shop's own month budget is used up ("budget").
func ModelOff(ai **AI, p Policy, c Clock, nowMs int64) string {
	if p.Model != nil && p.Model() == "off" {
		return "fleet"
	}
	if LevelOf(ai, p.Budget, c, nowMs).Name == "full" {
		return "budget"
	}
	return ""
}

// Gate: may this feature ask a model now? "" yes; "month" the budget is used up; "day" the feature's daily cap is reached; "again" this key was already paid for.
func Gate(ai **AI, cfg *Config, feature string, c Clock, nowMs int64, key string) string {
	if cfg == nil {
		return ""
	}
	if LevelOf(ai, cfg, c, nowMs).Name == "full" {
		return "month"
	}
	b := stateOf(ai, c, nowMs)
	if key != "" {
		for _, k := range b.Keys {
			if k == key {
				return "again"
			}
		}
	}
	if cap, ok := cfg.Daily[feature]; ok && b.Today[feature] >= cap {
		return "day"
	}
	return ""
}

// Record counts a model call (whatever came of it) for today and for the month's breakdown, and remembers its key. The spend itself is added where the call is metered.
func Record(ai **AI, cfg *Config, feature string, costMicroInr *int64, key string, c Clock, nowMs int64) {
	if cfg == nil {
		return
	}
	b := stateOf(ai, c, nowMs)
	b.Today[feature]++
	row := b.By[feature]
	if row == nil {
		row = &Row{}
		b.By[feature] = row
	}
	row.Calls++
	if costMicroInr != nil {
		row.Micro += *costMicroInr
	} else {
		row.Micro += cfg.unpriced()
	}
	if key != "" {
		b.Keys = append(b.Keys, key)
		if len(b.Keys) > KeysKept {
			b.Keys = b.Keys[len(b.Keys)-KeysKept:]
		}
	}
}

// Buttons: is the shop in button mode (the model steps are off)? And why.
func Buttons(ai **AI, p Policy, c Clock, nowMs int64) (bool, string) {
	a := For(ai, c, nowMs)
	if p.Override != nil && p.Override() == "buttons" {
		return true, "override"
	}
	if (p.AllowanceMsgs != nil && a.Decision+a.Model >= *p.AllowanceMsgs) || (p.AllowanceMicro != nil && a.CostMicroInr >= *p.AllowanceMicro) {
		return true, "allowance"
	}
	if a.PausedUntilMs != nil && *a.PausedUntilMs > nowMs {
		return true, "fault"
	}
	return false, ""
}

// Summary is the AI block /status carries: the month's counts, the mode and, with a budget, the budget's level and each feature's calls and cap.
func Summary(ai **AI, p Policy, c Clock, nowMs int64) map[string]any {
	a := For(ai, c, nowMs)
	buttons, why := Buttons(ai, p, c, nowMs)
	var pausedDecision any
	if a.Steps != nil {
		var steps map[string]struct {
			PausedUntilMs int64 `json:"pausedUntilMs"`
		}
		if json.Unmarshal(a.Steps, &steps) == nil && steps["decision"].PausedUntilMs > nowMs {
			pausedDecision = time.UnixMilli(steps["decision"].PausedUntilMs).UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	var msgs, micro any
	if p.AllowanceMsgs != nil {
		msgs = *p.AllowanceMsgs
	}
	if p.AllowanceMicro != nil {
		micro = *p.AllowanceMicro
	}
	mode, reason := "ai", any(nil)
	if buttons {
		mode, reason = "buttons", why
	}
	out := map[string]any{
		"month": a.Month, "messages": map[string]any{"rules": a.Rules, "decision": a.Decision, "model": a.Model}, "costMicroInr": a.CostMicroInr, "unpriced": a.Unpriced,
		"paused": map[string]any{"decision": pausedDecision}, "allowance": map[string]any{"messages": msgs, "costMicroInr": micro}, "mode": mode, "reason": reason,
	}
	if p.Budget != nil {
		l := LevelOf(ai, p.Budget, c, nowMs)
		b := stateOf(ai, c, nowMs)
		features := map[string]any{}
		for _, f := range Features {
			var cap any
			if n, ok := p.Budget.Daily[f]; ok {
				cap = n
			}
			var calls, micro int64
			if r := b.By[f]; r != nil {
				calls, micro = r.Calls, r.Micro
			}
			features[f] = map[string]any{"today": b.Today[f], "cap": cap, "calls": calls, "micro": micro}
		}
		out["budget"] = map[string]any{"monthlyMicroInr": l.Limit, "usedMicroInr": l.Used, "basisPoints": l.BasisPoints, "level": l.Name, "features": features}
	}
	return out
}
