package bookings

// The owner's talk on a Bookings shop is given what the TypeScript gives it (testdata/talk-facts-vectors.json, go/scripts/gen_talk_facts_vectors.ts): the skill's own numbers
// (ownerTalkFacts), what customers may be told (publicContext with no customer), and the system prompt with those sources and the declared limit, from the packed words
// (talk.system.<personality>.plain.limits) filled the way runtime/talk.go fills it; the schema's limit enum holds the declared ids. In English and Hindi, for an empty shop and
// one with bookings in every state.

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/assistant"
)

type talkSrc struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	Text       string    `json:"text"`
	AmountsInr []float64 `json:"amountsInr"`
	MomentsMs  []int64   `json:"momentsMs"`
	Literals   []string  `json:"literals"`
}

func srcOf(s assistant.TalkSource) talkSrc {
	return talkSrc{s.ID, s.Kind, s.Text, s.AmountsInr, s.MomentsMs, s.Literals}
}

func TestTheOwnersTalkIsGivenWhatTheTypeScriptGivesIt(t *testing.T) {
	b, err := os.ReadFile("testdata/talk-facts-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Cases []struct {
			Lang     string          `json:"lang"`
			Settings json.RawMessage `json:"settings"`
			NowMs    int64           `json:"nowMs"`
			Rows     []struct {
				Customer, State, ServiceID string
				StartMs                    *int64
				Minutes                    int64
			} `json:"rows"`
			Facts  []talkSrc `json:"facts"`
			Public []talkSrc `json:"public"`
			Limits []struct {
				ID    string `json:"id"`
				About string `json:"about"`
			} `json:"limits"`
			System string         `json:"system"`
			Schema map[string]any `json:"schema"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Cases) != 4 {
		t.Fatalf("%d cases", len(v.Cases))
	}
	for i, k := range v.Cases {
		set, _, errs := CheckSettingsFile(k.Settings)
		if len(errs) > 0 {
			t.Fatal(errs)
		}
		st := NewStore()
		for _, r := range k.Rows {
			bk := NewDraft(r.Customer, "en")
			bk.State, bk.ServiceID = r.State, r.ServiceID
			if r.StartMs != nil {
				start, end := *r.StartMs, *r.StartMs+r.Minutes*Minute
				bk.StartMs, bk.EndMs = &start, &end
			}
			st.Register(bk)
		}
		now := k.NowMs
		a := &Agent{kit: &Kit{Now: func() int64 { return now }}, settings: set, store: st}
		skill := &bookingsSkill{a}
		var facts, pub []talkSrc
		var sources []assistant.TalkSource
		for _, s := range skill.Facts(now) {
			facts = append(facts, srcOf(s))
			sources = append(sources, s)
		}
		for _, s := range skill.PublicContext("", now) {
			pub = append(pub, srcOf(s))
			sources = append(sources, s)
		}
		if !reflect.DeepEqual(norm(facts), norm(k.Facts)) {
			t.Errorf("case %d (%s): facts\n got %+v\nwant %+v", i, k.Lang, facts, k.Facts)
		}
		if !reflect.DeepEqual(norm(pub), norm(k.Public)) {
			t.Errorf("case %d (%s): public\n got %+v\nwant %+v", i, k.Lang, pub, k.Public)
		}
		var listed, ids []string
		for _, l := range k.Limits {
			listed = append(listed, l.ID+" ("+l.About+")")
			ids = append(ids, l.ID)
		}
		system := assistant.Words(k.Lang).Say("talk.system.warm.plain.limits", "shop", set.Name, "name", "", "sources", assistant.SourceLines(sources), "limits", strings.Join(listed, "; "))
		if system != k.System {
			t.Errorf("case %d (%s): system\n got %q\nwant %q", i, k.Lang, system, k.System)
		}
		gotSchema, _ := json.Marshal(assistant.TalkSchemaFor(ids))
		var g map[string]any
		_ = json.Unmarshal(gotSchema, &g)
		if !reflect.DeepEqual(g, k.Schema) {
			t.Errorf("case %d (%s): schema\n got %v\nwant %v", i, k.Lang, g, k.Schema)
		}
	}
}

// norm makes a missing list and an empty one the same (TypeScript leaves a member out where Go has nil).
func norm(xs []talkSrc) []talkSrc {
	out := make([]talkSrc, len(xs))
	for i, x := range xs {
		if len(x.AmountsInr) == 0 {
			x.AmountsInr = nil
		}
		if len(x.MomentsMs) == 0 {
			x.MomentsMs = nil
		}
		if len(x.Literals) == 0 {
			x.Literals = nil
		}
		out[i] = x
	}
	return out
}
