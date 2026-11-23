package stockorders

// Proves the Go Stock orders skill (skill.go) equal to the TypeScript stockSkill on testdata/skill-vectors.json (go/scripts/gen_stockorders_skill_vectors.ts), over a store with an
// order in every state and an owner who speaks English, Hindi and Malayalam: the talk's reads (`facts`; `publicContext` for each supplier, a stranger and nobody), the open list, what
// waits, the count of problems, and `prepare` for every kind of proposal on every order. This is what holds the rules the contract cannot reach through HTTP (the owner's talk needs a
// model): a cancel is prepared only for an order that has not gone out and shows no money moving; an answer is bound to exactly the action the agent's own card is; a supplier's talk
// is given only that supplier's own open orders, never the budget or another supplier's lines.

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/assistant"
)

type vSource struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	Text       string    `json:"text"`
	AmountsInr []float64 `json:"amountsInr"`
	Literals   []string  `json:"literals"`
}

func jsonOf(v any) any {
	b, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}

func sourcesOf(in []assistant.TalkSource) any {
	out := make([]vSource, len(in))
	for i, s := range in {
		out[i] = vSource{ID: s.ID, Kind: s.Kind, Text: s.Text, AmountsInr: s.AmountsInr, Literals: s.Literals}
	}
	return jsonOf(out)
}

func TestSkillMatchesStockSkill(t *testing.T) {
	raw, err := os.ReadFile("testdata/skill-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Lang     string            `json:"lang"`
			Settings json.RawMessage   `json:"settings"`
			Orders   []json.RawMessage `json:"orders"`
			NowMs    int64             `json:"nowMs"`
			Facts    []vSource         `json:"facts"`
			Public   []struct {
				Phone   string    `json:"phone"`
				Sources []vSource `json:"sources"`
			} `json:"publicContext"`
			Open []struct {
				Case        string `json:"case"`
				Who, What   string
				AmountPaise int64  `json:"amountPaise"`
				State       string `json:"state"`
			} `json:"open"`
			Waiting []struct {
				Case, Kind, Who, What, Yes, No string
				AmountPaise                    int64 `json:"amountPaise"`
				Money                          bool  `json:"money"`
			} `json:"waiting"`
			Problems int `json:"problems"`
			Prepared []struct {
				Proposal map[string]string `json:"proposal"`
				Result   json.RawMessage   `json:"result"`
			} `json:"prepared"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Cases) != 3 {
		t.Fatalf("%d cases, want 3", len(file.Cases))
	}
	for _, c := range file.Cases {
		s, errs := ReadSettings(c.Settings)
		if len(errs) > 0 {
			t.Fatalf("%s: the settings do not read: %v", c.Lang, errs)
		}
		st := NewStore()
		for _, o := range c.Orders {
			var ord Order
			if err := json.Unmarshal(o, &ord); err != nil {
				t.Fatal(err)
			}
			st.put(&ord)
		}
		k := &skill{a: &Agent{kit: &Kit{Settings: s, Now: func() int64 { return c.NowMs }}, st: st, s: s}}

		if got, want := sourcesOf(k.Facts(c.NowMs)), jsonOf(c.Facts); !reflect.DeepEqual(got, want) {
			t.Errorf("%s facts:\n go %v\n ts %v", c.Lang, got, want)
		}
		for _, p := range c.Public {
			if got, want := sourcesOf(k.PublicContext(p.Phone, c.NowMs)), jsonOf(p.Sources); !reflect.DeepEqual(got, want) {
				t.Errorf("%s publicContext(%q):\n go %v\n ts %v", c.Lang, p.Phone, got, want)
			}
		}
		open := k.Open()
		if len(open) != len(c.Open) {
			t.Fatalf("%s open: %d rows, the TypeScript's %d", c.Lang, len(open), len(c.Open))
		}
		for i, r := range open {
			w := c.Open[i]
			if r.Case != w.Case || r.Who != w.Who || r.What != w.What || r.AmountPaise != w.AmountPaise || r.State != w.State {
				t.Errorf("%s open row %d: go %+v, ts %+v", c.Lang, i, r, w)
			}
		}
		waiting := k.Waiting()
		if len(waiting) != len(c.Waiting) {
			t.Fatalf("%s waiting: %d, the TypeScript's %d", c.Lang, len(waiting), len(c.Waiting))
		}
		for i, w := range waiting {
			x := c.Waiting[i]
			if w.Case != x.Case || w.Kind != x.Kind || w.Who != x.Who || w.What != x.What || w.AmountPaise != x.AmountPaise || w.Money != x.Money || w.Yes != x.Yes || w.No != x.No {
				t.Errorf("%s waiting %d: go %+v, ts %+v", c.Lang, i, w, x)
			}
		}
		if k.Problems() != c.Problems {
			t.Errorf("%s problems: %d, the TypeScript's %d", c.Lang, k.Problems(), c.Problems)
		}
		for _, pv := range c.Prepared {
			key, wantRaw := pv.Proposal, pv.Result
			var want struct {
				OK     bool   `json:"ok"`
				Why    string `json:"why"`
				Action *struct {
					Kind, Skill, Case string
					Fields            map[string]any `json:"fields"`
				} `json:"action"`
				Shown *struct {
					Who, What   string
					AmountPaise int64 `json:"amountPaise"`
				} `json:"shown"`
			}
			if err := json.Unmarshal(wantRaw, &want); err != nil {
				t.Fatal(err)
			}
			proposal := assistant.Raw{}
			for name, v := range key {
				proposal[name] = mustRaw(v)
			}
			prep, why := k.Prepare(proposal)
			if want.OK != (why == "") {
				t.Errorf("%s prepare %v: go why %q, ts ok %v why %q", c.Lang, key, why, want.OK, want.Why)
				continue
			}
			if !want.OK {
				if why != want.Why {
					t.Errorf("%s prepare %v: why %q, the TypeScript's %q", c.Lang, key, why, want.Why)
				}
				continue
			}
			if prep.Action.Kind != want.Action.Kind || prep.Action.Skill != want.Action.Skill || prep.Action.Case != want.Action.Case {
				t.Errorf("%s prepare %v: action %+v, the TypeScript's %+v", c.Lang, key, prep.Action, want.Action)
			}
			if !reflect.DeepEqual(jsonOf(prep.Action.Fields), any(want.Action.Fields)) {
				t.Errorf("%s prepare %v: fields\n go %v\n ts %v", c.Lang, key, jsonOf(prep.Action.Fields), want.Action.Fields)
			}
			if prep.Shown.Who != want.Shown.Who || prep.Shown.What != want.Shown.What || prep.Shown.AmountPaise != want.Shown.AmountPaise {
				t.Errorf("%s prepare %v: shown %+v, the TypeScript's %+v", c.Lang, key, prep.Shown, want.Shown)
			}
		}
	}
}
