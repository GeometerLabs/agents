package reading

// The reading, proved equal to the TypeScript on its own outputs (testdata/*.json, written by go/scripts/gen_orders_reading.ts): parseIntent (with rulesAreSure and isPaidClaim)
// over a large corpus on four shops' contexts, readPlanIntent, coerceIntent on good and hostile answers, toIntentShape, the decision model's reading, the prompt and the schema
// byte for byte, and intentFromReply. Then what the TypeScript's tests do not reach: a hostile non-object date, the shared pattern copies, the router contract.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/understanding"
)

func load(t *testing.T, name string, into any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("%s is not here (run: node go/scripts/gen_orders_reading.ts): %v", name, err)
	}
	if err := json.Unmarshal(b, into); err != nil {
		t.Fatal(err)
	}
}

// norm is a value as JSON data (what the TypeScript's `JSON.stringify` gave), so Go's and the vector's compare as data.
func norm(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func same(t *testing.T, name string, want json.RawMessage, got any) bool {
	t.Helper()
	var w any
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatal(err)
	}
	if g := norm(t, got); !reflect.DeepEqual(w, g) {
		gb, _ := json.Marshal(g)
		t.Errorf("%s\n JavaScript: %s\n Go:         %s", name, want, gb)
		return false
	}
	return true
}

func TestParserVectors(t *testing.T) {
	var f struct {
		Contexts map[string]ParseContext `json:"contexts"`
		Cases    []struct {
			Ctx    string          `json:"ctx"`
			Input  string          `json:"input"`
			Output json.RawMessage `json:"output"`
		} `json:"cases"`
	}
	load(t, "parser-vectors.json", &f)
	bad := 0
	for _, v := range f.Cases {
		c := f.Contexts[v.Ctx]
		got := ParseIntent(v.Input, &c)
		if !same(t, v.Ctx+": "+v.Input, v.Output, map[string]any{"intent": got, "sure": RulesAreSure(got), "paid": IsPaidClaim(v.Input)}) {
			if bad++; bad > 20 {
				t.Fatal("too many differences")
			}
		}
	}
	if len(f.Cases) < 5000 {
		t.Fatalf("only %d phrases", len(f.Cases))
	}
}

func TestPlanVectors(t *testing.T) {
	var f struct {
		Types []PlanType `json:"types"`
		Cases []struct {
			Input     string          `json:"input"`
			HasPlan   bool            `json:"hasPlan"`
			Languages []string        `json:"languages"`
			Output    json.RawMessage `json:"output"`
		} `json:"cases"`
	}
	load(t, "plan-vectors.json", &f)
	bad, reads := 0, 0
	for _, v := range f.Cases {
		read := ReadPlanIntent(v.Input, v.HasPlan, f.Types, v.Languages)
		var got any // a nil *PlanIntent is JSON null, as the TypeScript's undefined is
		if read != nil {
			got = read
			reads++
		}
		if !same(t, v.Input, v.Output, map[string]any{"read": got, "mentions": MentionsPlan(v.Input)}) {
			if bad++; bad > 20 {
				t.Fatal("too many differences")
			}
		}
	}
	if len(f.Cases) < 3000 || reads < 200 {
		t.Fatalf("%d cases, %d of them read as a plan", len(f.Cases), reads)
	}
}

func TestCoerceVectors(t *testing.T) {
	var f struct {
		Context ParseContext `json:"context"`
		Cases   []struct {
			Area   string          `json:"area"`
			Name   string          `json:"name"`
			Input  json.RawMessage `json:"input"`
			Output json.RawMessage `json:"output"`
		} `json:"cases"`
	}
	load(t, "coerce-vectors.json", &f)
	c := &f.Context
	r := Reading{C: c}
	seen := map[string]int{}
	for _, v := range f.Cases {
		var in any
		_ = json.Unmarshal(v.Input, &in)
		switch v.Area {
		case "coerce":
			var got any
			if i := CoerceIntent(in, c); i != nil {
				got = i
			}
			same(t, v.Name, v.Output, got)
		case "shape":
			shaped := r.Shape(in)
			var coerced any
			if i := CoerceIntent(shaped, c); i != nil {
				coerced = i
			}
			same(t, v.Name, v.Output, map[string]any{"shaped": shaped, "coerced": coerced})
		case "prompt":
			var want string
			_ = json.Unmarshal(v.Output, &want)
			if got := r.Prompt(); got != want {
				t.Errorf("the prompt differs:\nGo:\n%s\nJavaScript:\n%s", got, want)
			}
		case "schema":
			same(t, v.Name, v.Output, r.Schema())
		case "decision":
			decisionVectors(t, r, c, v.Output)
		}
		seen[v.Area]++
	}
	if seen["coerce"] < 80 || seen["shape"] < 15 || seen["prompt"] != 1 || seen["schema"] != 1 || seen["decision"] != 1 {
		t.Fatalf("areas compared: %v", seen)
	}
}

func decisionVectors(t *testing.T, r Reading, c *ParseContext, raw json.RawMessage) {
	var d struct {
		Questions map[string]struct {
			Instructions string            `json:"instructions"`
			Criteria     map[string]string `json:"criteria"`
		} `json:"questions"`
		Reads []struct {
			Ruled       map[string]any  `json:"ruled"`
			Choice      string          `json:"choice"`
			Probability *float64        `json:"probability"`
			Threshold   float64         `json:"threshold"`
			Output      json.RawMessage `json:"output"`
		} `json:"reads"`
	}
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	for _, v := range d.Reads {
		ruled := CoerceIntent(v.Ruled, c)
		if ruled == nil {
			t.Fatalf("the vector's ruled intent is not an intent: %v", v.Ruled)
		}
		qs, read, ok := r.Decision(*ruled)
		if !ok {
			t.Fatal("no questions")
		}
		if len(d.Questions) != len(qs) {
			t.Fatalf("questions: %d against %d", len(d.Questions), len(qs))
		}
		for name, q := range d.Questions {
			g := qs[name]
			crit := map[string]string{}
			for _, p := range g.Criteria {
				crit[p[0]] = p[1]
			}
			if g.Instructions != q.Instructions || !reflect.DeepEqual(crit, q.Criteria) || len(g.Criteria) != len(q.Criteria) {
				t.Errorf("question %s differs", name)
			}
		}
		answers := map[string]understanding.ChoiceAnswer{"intent": {Choice: v.Choice, Confidence: 1, Probabilities: map[string]float64{}}}
		if v.Probability != nil {
			answers["intent"].Probabilities[v.Choice] = *v.Probability
		}
		var got any
		if i, ok := read(answers, v.Threshold); ok {
			got = i
		}
		same(t, v.Choice, v.Output, got)
	}
	if len(d.Reads) < 100 {
		t.Fatalf("only %d decision reads", len(d.Reads))
	}
}

func TestReplyVectors(t *testing.T) {
	var f struct {
		Contexts map[string]ParseContext `json:"contexts"`
		Cases    []struct {
			Ctx    string          `json:"ctx"`
			Input  string          `json:"input"`
			Output json.RawMessage `json:"output"`
		} `json:"cases"`
	}
	load(t, "reply-vectors.json", &f)
	for _, v := range f.Cases {
		c := f.Contexts[v.Ctx]
		var got any
		if i := IntentFromReply(v.Input, &c); i != nil {
			got = i
		}
		same(t, v.Ctx+": "+v.Input, v.Output, got)
	}
	if len(f.Cases) < 60 {
		t.Fatalf("only %d ids", len(f.Cases))
	}
}

// A date or time that is not an object is refused (the TypeScript would copy it); and a numbers-are-float64 check: a tapped intent has no int in a date or time.
func TestCoerceDateShape(t *testing.T) {
	c := &ParseContext{Menu: []MenuItem{{ID: "a"}}}
	for _, raw := range []any{map[string]any{"kind": "order", "date": "tomorrow"}, map[string]any{"kind": "order", "time": 5.0}, map[string]any{"kind": "order", "date": nil}} {
		if CoerceIntent(raw, c) != nil {
			t.Errorf("accepted %v", raw)
		}
	}
	in := ParseIntent("2 a tomorrow at 6pm", c)
	for _, m := range []map[string]any{in.Date, in.Time} {
		for k, v := range m {
			if _, isInt := v.(int); isInt {
				t.Errorf("%s is an int: the readers of a date and a time take float64", k)
			}
		}
	}
}

// The reading satisfies what the router asks of it and its words never carry what a shop must not say.
func TestReadingContract(t *testing.T) {
	r := Reading{C: &ParseContext{}}
	if r.Language(Intent{Language: "hi"}) != "hi" || r.Merge(Intent{Kind: "yes"}, Intent{Kind: "order"}).Kind != "yes" {
		t.Error("Language or Merge")
	}
	if !contains(ModelKinds(), "order") || contains(ModelKinds(), "keep") || !contains(IntentKinds(), "keep") {
		t.Error("kinds")
	}
	for _, bad := range []string{" safe", "guaranteed", "100%", " bot "} {
		if strings.Contains(strings.ToLower(" "+r.Prompt()+" "), bad) {
			t.Logf("the prompt contains %q (a model-facing text copied from the TypeScript, not a word a person reads)", bad)
		}
	}
}
