package reading

// The plan reading (src/plans/words.ts, 17 Nov 2026): what a customer writes about a monthly plan, a few plain words in four languages read with the rules alone. No model is
// asked, so a plan costs no AI allowance, and the reading can only ever mean one of: start a plan, skip a day, pause from a day, resume from a day, cancel the plan, or "my plan".
// It decides nothing: the cut-off, the capacity and the money are the ledger's and the agent's. It is read only when the shop has plans, and a message with no plan word in it
// (and no plan on the customer) is never read as one, so "2 veg thali tomorrow" and a bare "cancel" go the way they always did.

import (
	"sort"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// PlanType is what the plan reading needs of a plan type (settings.ts PlanType): its id and what customers call it, per language.
type PlanType struct {
	ID    string              `json:"id"`
	Names map[string][]string `json:"names"`
}

// PlanIntent is words.ts PlanIntent: Kind is "subscribe" (TypeID when exactly one plan type is named), "skip", "pause", "resume" (Date when a day is written), "cancel_plan" or "my_plan".
type PlanIntent struct {
	Kind   string         `json:"kind"`
	TypeID string         `json:"typeId,omitempty"`
	Date   map[string]any `json:"date,omitempty"`
}

// MentionsPlan is words.ts mentionsPlan: does the message name a plan at all? The only thing that lets a customer with no plan reach the plan reading.
func MentionsPlan(text string) bool { return pat("plan.plan").Test(language.Canon(text)) }

// ReadPlanIntent is words.ts readPlanIntent. hasPlan says the customer already has a plan: then "skip tomorrow" or "pause from monday" need no word for "plan". Without one, only a
// message that names a plan is read here ("I want the monthly plan"). nil: not about a plan.
func ReadPlanIntent(text string, hasPlan bool, types []PlanType, languages []string) *PlanIntent {
	t := language.Canon(text)
	named := pat("plan.plan").Test(t)
	if !hasPlan && !named {
		return nil
	}
	var date map[string]any
	if d := language.FindDatePhrase(text); d != nil {
		date = asJSONNumbers(d.JSON())
	}
	// order matters: "resume" and "cancel plan" before "pause"/"skip", because "stop my plan" is not a skip
	switch {
	case hasPlan && pat("plan.resume").Test(t):
		return &PlanIntent{Kind: "resume", Date: date}
	case hasPlan && named && pat("plan.cancel").Test(t):
		return &PlanIntent{Kind: "cancel_plan"}
	case hasPlan && pat("plan.skip").Test(t):
		return &PlanIntent{Kind: "skip", Date: date}
	case hasPlan && pat("plan.pause").Test(t):
		return &PlanIntent{Kind: "pause", Date: date}
	case hasPlan && (named || pat("plan.mine").Test(t)):
		return &PlanIntent{Kind: "my_plan"}
	case named && (pat("plan.subscribe").Test(t) || len(types) > 0):
		return &PlanIntent{Kind: "subscribe", TypeID: typeNamed(t, types, languages)}
	}
	return nil
}

// typeNamed is words.ts typeNamed: the plan type a message names by one of its names, "" unless exactly one is named. The longest name written wins, so "home lunch" is the home plan
// although "lunch" is also in the other's name (length in UTF-16 units, of the name as the shop wrote it, as JavaScript's `n.length`).
func typeNamed(t string, types []PlanType, languages []string) string {
	type scored struct {
		id  string
		len int
	}
	var found []scored
	for i := range types {
		best := 0
		for _, l := range languages {
			for _, n := range types[i].Names[l] {
				if strings.Contains(t, language.Canon(n)) {
					best = max(best, language.UTF16Len(n))
				}
			}
		}
		if best > 0 {
			found = append(found, scored{types[i].ID, best})
		}
	}
	sort.SliceStable(found, func(a, b int) bool { return found[a].len > found[b].len })
	if len(found) > 0 && (len(found) == 1 || found[0].len > found[1].len) {
		return found[0].id
	}
	return ""
}
