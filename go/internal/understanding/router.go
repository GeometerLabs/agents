package understanding

// Reading a message cheapest first (modules/understanding/router.ts `createRouter` with model-llm.ts `createModelParser`), for any template's reading:
//
//   0. rules     the template's rule parser: when it is sure (`Sure`), that is the reading;
//   1. decision  a System One decision model answers the template's choice questions; below the threshold, or for a language it is not trusted with, it is unsure and the
//                message goes on;
//   2. model     a small language model over the OpenAI-compatible wire, asked for the template's JSON; its answer is untrusted and only what `Coerce` accepts is read.
//
// What a model reads is the message with numbers and names taken out (Redact). Whatever no step could read better stays the rules' reading. What each message cost comes back
// with it (`Understood`), priced from the dated rate table. The router keeps no state: whether a shop may spend at all, and a step paused or left out, is the caller's
// (`Options`), from the month's AI state (budget).

import (
	"strconv"
	"strings"
)

// Reading is what a template gives the router (model.ts `Reading`), over its own intent type.
type Reading[I any] interface {
	Rules(text string) I
	// Sure: the rules are enough (no model is asked).
	Sure(ruled I) bool
	// Language the rules saw ("" when the words do not say: Latin letters may be English or Hindi).
	Language(ruled I) string
	// Coerce checks a model's answer, decoded to `any` (model.ts: nulls already dropped by `shape`).
	Coerce(raw any) (I, bool)
	Prompt() string
	Schema() map[string]any
	// Decision is the decision model's questions and how its answers are read (false: no questions).
	Decision(ruled I) (map[string]ChoiceQuestion, func(map[string]ChoiceAnswer, float64) (I, bool), bool)
	// Merge puts the rules' values back on the model's reading.
	Merge(model, ruled I) I
}

// Router is the three steps, with the steps this shop has (nil: not configured, or its key is not in the environment).
type Router[I any] struct {
	Reading   Reading[I]
	Decision  *SystemOne
	Threshold float64
	Languages []string
	Model     *Model
}

// Options is ParseOptionsBase: read with the rules only (button mode), and steps to leave out ("decision" paused, "model" under the cap or the budget).
type Options struct {
	RulesOnly bool
	SkipSteps []string
}

// Understood is model.ts `Understood`: which step read it, and what the steps asked cost. CostMicroInr nil: a step had no price (never 0).
type Understood struct {
	Step, Provider, Model     string
	InputTokens, OutputTokens int64
	CostMicroInr              *int64
	RateDate                  string
	Tried, Failed, Skipped    []string
}

// Rules is model.ts RULES: read by the rules alone.
func Rules() Understood {
	zero := int64(0)
	return Understood{Step: "rules", Provider: "rules", Model: "rule-parser", CostMicroInr: &zero, Tried: []string{"rules"}}
}

// Refs is reader.ts `understandingRefs`: the cost of one message as the record keeps it (every value a string).
func (u Understood) Refs() map[string]string {
	r := map[string]string{"step": u.Step, "provider": u.Provider, "model": u.Model, "inputTokens": strconv.FormatInt(u.InputTokens, 10), "outputTokens": strconv.FormatInt(u.OutputTokens, 10), "tried": strings.Join(u.Tried, "+")}
	if u.CostMicroInr != nil {
		r["costMicroInr"] = strconv.FormatInt(*u.CostMicroInr, 10)
	}
	if u.RateDate != "" {
		r["rateDate"] = u.RateDate
	}
	if len(u.Failed) > 0 {
		r["failed"] = strings.Join(u.Failed, "+")
	}
	if len(u.Skipped) > 0 {
		r["skipped"] = strings.Join(u.Skipped, "+")
	}
	return r
}

type spend struct {
	step, provider, model string
	in, out               int64
	own                   *ModelConfig // the builder's own rate applies to the parser's model only
}

func has(xs []string, s string) bool { return contains(xs, s) }

// Parse is `parseDetailed`: the reading, what it cost, and why a model could not be used ("" when none failed).
func (r *Router[I]) Parse(text string, o Options, nowMs int64) (I, Understood, string) {
	ruled := r.Reading.Rules(text)
	rules := &spend{step: "rules", provider: "rules", model: "rule-parser"}
	tried, failed, skipped := []string{"rules"}, []string{}, []string{}
	var spends []*spend
	finish := func(intent I, handled *spend, reason string) (I, Understood, string) {
		all := spends
		if handled == rules {
			all = append([]*spend{rules}, spends...)
		}
		return intent, r.understood(handled, all, tried, failed, skipped, nowMs), reason
	}
	if o.RulesOnly || r.Reading.Sure(ruled) {
		return finish(ruled, rules, "")
	}
	step2 := r.Model
	if has(o.SkipSteps, "model") {
		step2 = nil
	}
	if r.Model != nil && step2 == nil {
		skipped = append(skipped, "model")
	}
	if r.Decision == nil && step2 == nil {
		return finish(ruled, rules, "")
	}
	stripped := Redact(text)
	reason := ""

	// step 1: the decision model, for the languages it is trusted with; left out while paused, but only when the language model is there to take over
	questions, read, hasQuestions := r.Reading.Decision(ruled)
	langs := r.Languages
	if len(langs) == 0 {
		langs = DefaultDecisionLanguages
	}
	lang := r.Reading.Language(ruled)
	trusted := r.Decision != nil && hasQuestions && (lang == "" || has(langs, lang))
	if trusted && has(o.SkipSteps, "decision") && step2 != nil {
		skipped = append(skipped, "decision")
	} else if trusted {
		tried = append(tried, "decision")
		sp := &spend{step: "decision", provider: r.Decision.Kind, model: r.Decision.Model}
		d, why := r.Decision.Decide(stripped, questions)
		spends = append(spends, sp)
		if why == "" {
			sp.in, sp.out = d.InputTokens, d.OutputTokens
			threshold := r.Threshold
			if threshold == 0 {
				threshold = DefaultThreshold
			}
			if intent, ok := read(d.Answers, threshold); ok {
				return finish(intent, sp, "")
			}
		} else {
			failed = append(failed, "decision")
			reason = why
		}
	}

	// step 2: the language model (model-llm.ts createModelParser)
	if step2 != nil {
		tried = append(tried, "model")
		got := step2.Ask(Call{System: r.Reading.Prompt(), User: stripped, Schema: r.Reading.Schema(), Name: "intent"})
		sp := &spend{step: "model", provider: step2.Provider, model: step2.Cfg.Model, in: got.InputTokens, out: got.OutputTokens, own: &step2.Cfg}
		spends = append(spends, sp)
		why := got.Reason
		if why == "" {
			if intent, ok := r.Reading.Coerce(shape(got.Answer)); ok {
				return finish(r.Reading.Merge(intent, ruled), sp, "")
			}
			why = "its answer was not a valid intent"
		}
		failed = append(failed, "model")
		reason = why
	}
	if len(failed) == 0 {
		reason = ""
	}
	return finish(ruled, rules, reason)
}

// shape is the reading's `shape`: an object's null members dropped (a strict schema makes every field required and nullable).
func shape(answer any) any {
	o, ok := answer.(map[string]any)
	if !ok {
		return answer
	}
	out := map[string]any{}
	for k, v := range o {
		if v != nil {
			out[k] = v
		}
	}
	return out
}

// understood adds up what was spent (router.ts): a call with no price makes the total unknown (nil); the rules cost nothing on any date.
func (r *Router[I]) understood(handled *spend, spends []*spend, tried, failed, skipped []string, nowMs int64) Understood {
	var micro int64
	priced := true
	rateDate := ""
	var in, out int64
	for _, s := range spends {
		in += s.in
		out += s.out
		if s.provider == "rules" {
			continue
		}
		var own = (*ModelConfig)(nil)
		if s.own != nil {
			own = s.own
		}
		var cost *int64
		var from string
		if own != nil {
			cost, from = PriceOf(s.provider, s.model, own.Rate, s.in, s.out, nowMs)
		} else {
			cost, from = PriceOf(s.provider, s.model, nil, s.in, s.out, nowMs)
		}
		if cost == nil {
			priced = false
		} else if priced {
			micro += *cost
		}
		if cost != nil && (s == handled || rateDate == "") {
			rateDate = from
		}
	}
	u := Understood{Step: handled.step, Provider: handled.provider, Model: handled.model, InputTokens: in, OutputTokens: out, Tried: tried, Failed: failed, Skipped: skipped}
	if priced {
		u.CostMicroInr = &micro
		u.RateDate = rateDate
	}
	return u
}
