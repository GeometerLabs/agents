package bookings

// What is particular to Bookings in understanding a message (src/adapters/reading.ts, model-prompt.ts): the reading the shared router (understanding.Router) is given. Its
// rules are ParseIntent; a language model's answer is put into an Intent's own shape (Shape: model-prompt.ts toIntentShape) and checked by hand (CoerceIntent); the prompt and
// the answer schema list this shop's services; the decision model is asked what the customer wants, which service and (when the rules found no day and time) which of the next
// free times. The texts, the labels, the prompt and the schema are the TypeScript's own, from reading.json (go/scripts/gen_bookings_reading.ts), filled with the shop's services.

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/understanding"
)

//go:embed reading.json
var readingJSON []byte

type readingPack struct {
	Patterns map[string]struct {
		Source string `json:"source"`
		Flags  string `json:"flags"`
	} `json:"patterns"`
	Kinds      []string `json:"kinds"`
	ModelKinds []string `json:"modelKinds"`
	Questions  struct {
		Intent struct {
			Instructions string      `json:"instructions"`
			Criteria     [][2]string `json:"criteria"`
		} `json:"intent"`
		Service, Slot struct {
			Instructions string    `json:"instructions"`
			None         [2]string `json:"none"`
		}
	} `json:"questions"`
	Prompt string         `json:"prompt"`
	Schema map[string]any `json:"schema"`

	cancel, reschedule, rescheduleDravidian, book *language.Regex
}

var (
	readingOnce sync.Once
	readingP    readingPack
)

func readingWords() *readingPack {
	readingOnce.Do(func() {
		if err := json.Unmarshal(readingJSON, &readingP); err != nil {
			panic("bookings: reading.json: " + err.Error())
		}
		re := func(name string) *language.Regex {
			p := readingP.Patterns[name]
			return language.MustCompile(p.Source, p.Flags)
		}
		readingP.cancel, readingP.reschedule, readingP.rescheduleDravidian, readingP.book = re("cancel"), re("reschedule"), re("rescheduleDravidian"), re("book")
	})
	return &readingP
}

// CandidateSlot is model.ts CandidateSlot: a time the shop could still be booked for, from the calendar, that the decision model may pick.
type CandidateSlot struct {
	StartMs int64
	Date    map[string]any
	Time    map[string]any
	Label   string
}

// Reading is Bookings' reading over one shop's settings. Slots gives the next few free times for the decision model (nil: none; reading.ts asks options.slots only when the
// rules found no day and time, and a failure is no slots).
type Reading struct {
	S     *Settings
	Slots func() []CandidateSlot
}

var _ understanding.Reading[Intent] = Reading{}
var _ understanding.Shaper = Reading{}

// Rules is parseIntent.
func (r Reading) Rules(text string) Intent { return ParseIntent(text, r.S) }

// Language is what the rules saw.
func (Reading) Language(ruled Intent) string { return ruled.Language }

// Sure is reading.ts rulesAreSure: is the rule parser's reading enough on its own? A booking with no service or no time is not: the next step may know.
func (Reading) Sure(i Intent) bool {
	if i.OverrideAttempt != nil && *i.OverrideAttempt {
		return true // a trick is answered by the rules; paying for a model to read it helps nobody
	}
	switch i.Kind {
	case "stop", "yes", "no", "cancel", "greeting", "owner", "keep":
		return true
	case "reschedule":
		return i.Date != nil || i.Time != nil
	case "book":
		return i.ServiceID != "" && i.Date != nil && i.Time != nil
	}
	return false
}

// Coerce is coerceIntent on a model's answer (already in an Intent's shape: Shape).
func (r Reading) Coerce(raw any) (Intent, bool) {
	if in := CoerceIntent(raw, r.S); in != nil {
		return *in, true
	}
	return Intent{}, false
}

// Shape is model-prompt.ts toIntentShape: the model answers every field, with null for what the customer did not say. The nulls are taken out, each date and time phrase keeps
// only the fields of its kind, "18:00 pm" is just 18:00, and nothing else passes (a model cannot set `ask`, which only the shop's own buttons set).
func (Reading) Shape(answer any) any {
	a, ok := answer.(map[string]any)
	if !ok {
		return answer
	}
	out := map[string]any{"kind": a["kind"]}
	if _, has := a["kind"]; !has {
		delete(out, "kind") // { kind: answer.kind } with no kind is a member that is undefined: as good as absent
	}
	for _, k := range []string{"language", "serviceId", "offerInr"} {
		if v, has := a[k]; has && v != nil {
			out[k] = v
		}
	}
	if d, isObj := a["date"].(map[string]any); isObj {
		fields := map[string][]string{"relative": {"offsetDays"}, "weekday": {"weekday", "which"}, "calendar": {"day", "month"}}
		kind, _ := d["kind"].(string)
		date := map[string]any{"kind": d["kind"]}
		for _, f := range fields[kind] {
			date[f] = d[f] // Object.fromEntries keeps a missing field as undefined: coerceIntent refuses it either way
		}
		out["date"] = date
	} else if v, has := a["date"]; has && v != nil {
		out["date"] = v
	}
	if t, isObj := a["time"].(map[string]any); isObj {
		tm := map[string]any{"hour": t["hour"], "minute": t["minute"]}
		h, isNum := t["hour"].(float64)
		twentyFour := isNum && (h == 0 || h > 12)
		if p, has := t["period"]; has && p != nil && !twentyFour {
			tm["period"] = p
		}
		out["time"] = tm
	} else if v, has := a["time"]; has && v != nil {
		out["time"] = v
	}
	if a["overrideAttempt"] == true {
		out["overrideAttempt"] = true
	}
	return out
}

// Prompt is model-prompt.ts systemPrompt: the same text for every message of a shop, so a provider can cache it.
func (r Reading) Prompt() string {
	first := &r.S.Services[0]
	name := first.ID
	if n := first.Names["en"]; len(n) > 0 {
		name = n[0]
	}
	lines := make([]string, len(r.S.Services))
	for i := range r.S.Services {
		sv := &r.S.Services[i]
		var parts []string
		for _, l := range runtime.LANGUAGES {
			if n := sv.Names[l]; len(n) > 0 {
				parts = append(parts, l+": "+strings.Join(n, " / "))
			}
		}
		lines[i] = "- " + sv.ID + " = " + strings.Join(parts, " | ")
	}
	p := readingWords().Prompt
	p = strings.Replace(p, "{{services}}", strings.Join(lines, "\n"), 1)
	return strings.ReplaceAll(strings.ReplaceAll(p, "{{id}}", first.ID), "{{name}}", name)
}

// Schema is model-prompt.ts intentSchema: the answer's JSON schema, the service ids this shop's.
func (r Reading) Schema() map[string]any {
	var s map[string]any
	b, _ := json.Marshal(readingWords().Schema)
	_ = json.Unmarshal(b, &s) // a fresh copy: the template is shared
	ids := make([]any, len(r.S.Services))
	for i := range r.S.Services {
		ids[i] = r.S.Services[i].ID
	}
	s["properties"].(map[string]any)["serviceId"].(map[string]any)["anyOf"].([]any)[0].(map[string]any)["enum"] = ids
	return s
}

// Decision is reading.ts `decision`: the questions (what the customer wants; which service; which free time, when the rules found no day and time and there are free times)
// and how the answers are read (readDecision).
func (r Reading) Decision(ruled Intent) (map[string]understanding.ChoiceQuestion, func(map[string]understanding.ChoiceAnswer, float64) (Intent, bool), bool) {
	var slots []CandidateSlot
	if !(ruled.Date != nil && ruled.Time != nil) && r.Slots != nil {
		slots = r.Slots()
	}
	w := readingWords()
	what := w.Questions
	services := make([][2]string, 0, len(r.S.Services)+1)
	for i := range r.S.Services {
		sv := &r.S.Services[i]
		var names []string
		for _, l := range r.S.Languages { // Object.values(s.names): the shop's languages' order
			names = append(names, sv.Names[l]...)
		}
		services = append(services, [2]string{sv.ID, strings.Join(names, " / ")})
	}
	qs := map[string]understanding.ChoiceQuestion{
		"intent":  {Instructions: what.Intent.Instructions, Criteria: what.Intent.Criteria},
		"service": {Instructions: what.Service.Instructions, Criteria: append(services, what.Service.None)},
	}
	if len(slots) > 0 {
		crit := make([][2]string, 0, len(slots)+1)
		for i, sl := range slots {
			crit = append(crit, [2]string{"slot_" + strconv.Itoa(i+1), sl.Label})
		}
		qs["slot"] = understanding.ChoiceQuestion{Instructions: what.Slot.Instructions, Criteria: append(crit, what.Slot.None)}
	}
	read := func(answers map[string]understanding.ChoiceAnswer, threshold float64) (Intent, bool) {
		return readDecision(answers, ruled, slots, threshold)
	}
	return qs, read, true
}

func chosen(a understanding.ChoiceAnswer) float64 { return a.Probabilities[a.Choice] } // model.ts chosenProbability: 0 when the choice has no probability

// readDecision is reading.ts readDecision: the decision model's reading, or false when it is unsure. The rules' own values win (they are exact).
func readDecision(answers map[string]understanding.ChoiceAnswer, ruled Intent, slots []CandidateSlot, threshold float64) (Intent, bool) {
	none := readingWords().Questions
	intent, ok := answers["intent"]
	if !ok || chosen(intent) < threshold {
		return Intent{}, false
	}
	kind := intent.Choice
	if kind == "other" {
		kind = "unknown"
	}
	read := Intent{Kind: kind, Language: ruled.Language, OfferInr: ruled.OfferInr, OverrideAttempt: nil}
	if ruled.OverrideAttempt != nil && *ruled.OverrideAttempt {
		read.OverrideAttempt = ruled.OverrideAttempt
	}
	wantsDetails := kind == "book" || kind == "reschedule"
	if ruled.ServiceID != "" {
		read.ServiceID = ruled.ServiceID
	} else if kind == "book" {
		service, ok := answers["service"]
		if !ok || chosen(service) < threshold {
			return Intent{}, false
		}
		if service.Choice != none.Service.None[0] {
			read.ServiceID = service.Choice
		}
	}
	read.Date, read.Time = ruled.Date, ruled.Time
	if slot, has := answers["slot"]; wantsDetails && has && !(ruled.Date != nil && ruled.Time != nil) {
		if chosen(slot) < threshold {
			return Intent{}, false
		}
		var picked *CandidateSlot
		if slot.Choice != none.Slot.None[0] {
			// slots[Number(choice.slice("slot_".length)) - 1]: anything that is not a listed slot picks nothing
			if n, err := strconv.Atoi(strings.TrimPrefix(slot.Choice, "slot_")); err == nil && strings.HasPrefix(slot.Choice, "slot_") && n >= 1 && n <= len(slots) {
				picked = &slots[n-1]
			}
		}
		if picked != nil {
			if read.Date == nil {
				read.Date = picked.Date
			}
			if read.Time == nil {
				read.Time = picked.Time
			}
		}
	}
	return read, true
}

// Merge is reading.ts `merge`: the rules' service when the model named none.
func (Reading) Merge(model, ruled Intent) Intent {
	if model.ServiceID == "" && ruled.ServiceID != "" {
		model.ServiceID = ruled.ServiceID
	}
	return model
}
