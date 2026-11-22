package reading

// What is particular to Orders in understanding a message (src/adapters/reading.ts ordersReading): the reading the shared router (understanding.Router) is given. Its rules are
// ParseIntent; a language model's answer is put in an Intent's own shape (Shape: toIntentShape) and checked by hand (Coerce: coerceIntent); the prompt and the answer schema are
// the TypeScript's own, from reading.json (they name nothing of the shop, so they are whole there); the decision model is asked one question, what the customer wants, and the
// rules' own values win over it. createOrdersRouter and createOrdersModelParser are wiring the Orders runtime does over understanding.Router.

import (
	"encoding/json"

	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// Reading is Orders' reading over one shop's ParseContext.
type Reading struct {
	C *ParseContext
}

var (
	_ understanding.Reading[Intent] = Reading{}
	_ understanding.Shaper          = Reading{}
)

// Rules is parseIntent.
func (r Reading) Rules(text string) Intent { return ParseIntent(text, r.C) }

// Language is what the rules saw.
func (Reading) Language(ruled Intent) string { return ruled.Language }

// Sure is reading.ts rulesAreSure: is the rule parser's reading enough on its own? A word the rules do not know is not: the next step may.
func (Reading) Sure(i Intent) bool { return RulesAreSure(i) }

// RulesAreSure is reading.ts rulesAreSure.
func RulesAreSure(i Intent) bool {
	if i.OverrideAttempt != nil && *i.OverrideAttempt {
		return true // a trick is answered by the rules; paying for a model to read it helps nobody
	}
	return i.Kind != "unknown"
}

// Coerce is coerceIntent on a model's answer (already in an Intent's shape: Shape).
func (r Reading) Coerce(raw any) (Intent, bool) {
	if in := CoerceIntent(raw, r.C); in != nil {
		return *in, true
	}
	return Intent{}, false
}

// Shape is reading.ts toIntentShape: the model answers every field, with null for what the customer did not say. Take the nulls out, so what reaches Coerce is an Intent's own shape;
// nothing else passes (a model cannot set `ask`, `items`, `date`, `time`, `mode` or a slot: those come from the rules and the shop's own buttons).
func (Reading) Shape(answer any) any {
	a, ok := answer.(map[string]any)
	if !ok {
		return answer
	}
	out := map[string]any{}
	if k, has := a["kind"]; has {
		out["kind"] = k // { kind: answer.kind } with no kind is a member that is undefined: as good as absent
	}
	for _, k := range []string{"language", "offerInr"} {
		if v, has := a[k]; has && v != nil {
			out[k] = v
		}
	}
	if a["overrideAttempt"] == true {
		out["overrideAttempt"] = true
	}
	return out
}

// Prompt is reading.ts systemPrompt: the same text for every message of a shop, so a provider can cache it.
func (Reading) Prompt() string { return words().Prompt }

// Schema is reading.ts intentSchema: the answer's JSON schema (a fresh copy: the template is shared).
func (Reading) Schema() map[string]any {
	var s map[string]any
	b, _ := json.Marshal(words().Schema)
	_ = json.Unmarshal(b, &s)
	return s
}

// Decision is reading.ts `decision`: one question (what the customer wants; the label "other" is "unknown") and how its answer is read: below the threshold nothing is read, and the
// rules' own language, price, items, day, time and way are kept (they are exact), as is a trick.
func (r Reading) Decision(ruled Intent) (map[string]understanding.ChoiceQuestion, func(map[string]understanding.ChoiceAnswer, float64) (Intent, bool), bool) {
	q := words().Questions.Intent
	qs := map[string]understanding.ChoiceQuestion{"intent": {Instructions: q.Instructions, Criteria: q.Criteria}}
	read := func(answers map[string]understanding.ChoiceAnswer, threshold float64) (Intent, bool) {
		answer, ok := answers["intent"]
		if !ok || answer.Probabilities[answer.Choice] < threshold { // model.ts chosenProbability: 0 when the choice has no probability
			return Intent{}, false
		}
		kind := answer.Choice
		if kind == "other" {
			kind = "unknown"
		}
		read := Intent{Kind: kind, Language: ruled.Language, OfferInr: ruled.OfferInr, Items: ruled.Items, Date: ruled.Date, Time: ruled.Time, Mode: ruled.Mode}
		if ruled.OverrideAttempt != nil && *ruled.OverrideAttempt {
			read.OverrideAttempt = ruled.OverrideAttempt
		}
		return read, true
	}
	return qs, read, true
}

// Merge: Orders' reading has no `merge` (the model's reading is used as it is, after Coerce).
func (Reading) Merge(model, _ Intent) Intent { return model }
