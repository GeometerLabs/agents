package assistant

// The owner's reading for the router (modules/assistant/intents.ts `ownerReading`): an implementation of understanding.Reading over the owner's Intent. Only the KIND comes from a
// model; `Merge` puts back the rules' values (a date, a case reference, a message's words), so a model never writes a value into an act. The prompt, the schema and the decision
// model's question are the TypeScript's own, rendered for this shop's kinds by go/scripts/gen_words.ts (words/rules.json.gz).
//
// A model's answer is untrusted: it comes as `any` (understanding decodes it so) and `Coerce` checks its types by hand, as intents.ts `coerce` does. CoerceIntent is the same check
// on the intent the reader ends with (reader.ts runs `coerce` on every reading, the rules' too).

import (
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

// OwnerKinds is intents.ts OWNER_KINDS: every kind an owner's words can be read as.
var OwnerKinds = []string{"day", "owes", "open_orders", "waiting", "money", "close_day", "reopen_day", "move", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget", "leave_file", "leave_operator"}

// OwnerReading is the owner's reading for this shop's kinds: the zero value is a listings-only shop's (OfferedKinds); Bookings is a Bookings shop's (BookingsKinds, with its
// router prompt, schema and decision question rendered for those kinds), and LimitRule reads a rule about one of its declared limits.
type OwnerReading struct {
	Bookings  bool
	LimitRule func(text string) bool
}

var _ understanding.Reading[Intent] = OwnerReading{}

// Kinds are the kinds this reading's shop takes.
func (r OwnerReading) Kinds() []string {
	if r.Bookings {
		return Rules().KindsBookings
	}
	return OfferedKinds
}

func (r OwnerReading) router() routerWords {
	if r.Bookings {
		return Rules().RouterBookings
	}
	return Rules().Router
}

// Context is the rules' context for this reading.
func (r OwnerReading) Context() Context { return Context{Kinds: r.Kinds(), LimitRule: r.LimitRule} }

// Rules is readOwnerRules.
func (r OwnerReading) Rules(text string) Intent { return ReadOwnerRulesIn(text, r.Context()) }

// Sure: the rules are enough whenever they found a kind.
func (OwnerReading) Sure(ruled Intent) bool { return ruled.Kind != "unknown" }

// Language is what the rules saw of the words' language.
func (OwnerReading) Language(ruled Intent) string { return ruled.Language }

// Coerce is intents.ts `coerce` on a model's answer: an object whose `kind` is a string and an owner's kind (or "unknown"); a kind this shop does not take (but help and limit) is
// read as unknown. Of the rest only the kind is ever used (Merge), so the other members are not read here.
func (r OwnerReading) Coerce(raw any) (Intent, bool) {
	o, ok := raw.(map[string]any)
	if !ok {
		return Intent{}, false
	}
	kind, ok := o["kind"].(string)
	if !ok || (kind != "unknown" && !contains(OwnerKinds, kind)) {
		return Intent{}, false
	}
	return Intent{Kind: OfferedIn(kind, r.Kinds())}, true
}

// Prompt and Schema are the language model's, for this shop's kinds.
func (r OwnerReading) Prompt() string         { return r.router().Prompt }
func (r OwnerReading) Schema() map[string]any { return r.router().Schema }

// Decision is the decision model's one question ("what do they want?", over the kinds a model may choose) and how its answer is read: the chosen kind, when its probability is at
// least the threshold, with the rules' values.
func (r OwnerReading) Decision(ruled Intent) (map[string]understanding.ChoiceQuestion, func(map[string]understanding.ChoiceAnswer, float64) (Intent, bool), bool) {
	w := r.router()
	kinds := make([]string, len(w.Criteria))
	for i, c := range w.Criteria {
		kinds[i] = c[0]
	}
	qs := map[string]understanding.ChoiceQuestion{"want": {Instructions: w.Instructions, Criteria: w.Criteria}}
	read := func(answers map[string]understanding.ChoiceAnswer, threshold float64) (Intent, bool) {
		a, ok := answers["want"]
		if !ok || a.Probabilities[a.Choice] < threshold || !contains(kinds, a.Choice) {
			return Intent{}, false
		}
		return r.Merge(Intent{Kind: a.Choice}, ruled), true
	}
	return qs, read, true
}

// Merge is intents.ts `merge`: the model's kind with the rules' values; a refund's amount only for a refund, a message's words only for a message that names a case.
func (OwnerReading) Merge(model, ruled Intent) Intent {
	out := Intent{Kind: model.Kind, Language: ruled.Language, Date: ruled.Date, Time: ruled.Time, Ref: ruled.Ref}
	if model.Kind == "message" && ruled.Ref != "" {
		out.Words = ruled.Words
	}
	if model.Kind == "refund" {
		out.AmountPaise = ruled.AmountPaise
	}
	return out
}

var (
	refShape  = regexp.MustCompile(`^[bfqog]-\d{1,6}$`)
	noteShape = regexp.MustCompile(`^n-\d{1,4}$`)
)

// CoerceIntent is CoerceIntentIn for a listings-only shop.
func CoerceIntent(in Intent) Intent { return CoerceIntentIn(in, OfferedKinds) }

// CoerceIntentIn is `coerce` on the reader's final reading (the rules' or the merged one): a kind this shop does not take is unknown (but help and limit); a reference, a note's id
// and a message's or note's words are kept only in their shape (words: not blank, at most 900 UTF-16 units); an amount only when positive.
func CoerceIntentIn(in Intent, kinds []string) Intent {
	out := Intent{Kind: OfferedIn(in.Kind, kinds)}
	if out.Kind == "unknown" && in.Kind != "unknown" {
		return out
	}
	out.Language, out.Date, out.Time = in.Language, in.Date, in.Time
	if in.AmountPaise > 0 {
		out.AmountPaise = in.AmountPaise
	}
	if refShape.MatchString(in.Ref) {
		out.Ref = in.Ref
	}
	if noteShape.MatchString(in.Note) {
		out.Note = in.Note
	}
	if strings.TrimFunc(in.Words, language.IsJSSpace) != "" && language.UTF16Len(in.Words) <= 900 {
		out.Words = in.Words
	}
	return out
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}
