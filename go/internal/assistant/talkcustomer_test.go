// Tests of a customer's talk: the checks, the reading of a model's JSON and the prompt are what the TypeScript makes of them (go/scripts/gen_customer_talk_vectors.ts, from
// modules/assistant/talk-check.ts, talk-types.ts and talk-prompt.ts; the cases are talk-check.test.ts's own plus the words of each list in four languages).
package assistant

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/listings"
)

type vecSource struct {
	ID, Kind, Text string
	AmountsInr     []float64
	MomentsMs      []int64
	Literals       []string
}

func (v vecSource) source() TalkSource {
	return TalkSource{ID: v.ID, Kind: v.Kind, Text: v.Text, AmountsInr: v.AmountsInr, MomentsMs: v.MomentsMs, Literals: v.Literals}
}

func sources(vs []vecSource) []TalkSource {
	var out []TalkSource
	for _, v := range vs {
		out = append(out, v.source())
	}
	return out
}

func sorted(xs []float64) []float64 {
	out := append([]float64{}, xs...)
	sort.Float64s(out)
	if out == nil {
		out = []float64{}
	}
	return out
}

func loadVectors(t *testing.T) (out struct {
	Scope  []vecSource
	Checks []struct {
		Name      string
		Role      string
		Sentences []struct {
			Text    string
			Sources []string
		}
		SpeakerText, SpeakerLanguage string
		Links, Literals              []string
		MaxChars                     int
		Result                       struct {
			OK       bool
			Check    int
			Text     string
			Amounts  []float64
			Counts   []float64
			Moments  []int64
			Literals []string
		}
	}
	Reads []struct {
		Raw    any
		Answer *struct {
			Sentences []struct {
				Text    string
				Sources []string
			}
			AskOwner bool
			Note     *struct{ Kind, Text string }
			Limit    string
		}
	}
	Prompts []struct {
		Shop, CharName, Personality, Language string
		Sources                               []vecSource
		System                                string
	}
}) {
	b, err := os.ReadFile("testdata/customer-talk-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestCustomerChecksEqualTypeScript: each answer passes or fails the check the TypeScript says it does, with the same text and the same facts for the outgoing check.
func TestCustomerChecksEqualTypeScript(t *testing.T) {
	v := loadVectors(t)
	if len(v.Checks) < 90 {
		t.Fatalf("too few cases: %d", len(v.Checks))
	}
	india, _ := time.LoadLocation("Asia/Kolkata")
	scope := sources(v.Scope)
	for _, c := range v.Checks {
		a := &TalkAnswer{}
		for _, s := range c.Sentences {
			a.Sentences = append(a.Sentences, TalkSentence{Text: s.Text, Sources: s.Sources})
		}
		got := CheckTalk(TalkInput{Role: c.Role, Answer: a, Scope: scope, SpeakerText: c.SpeakerText, SpeakerLanguage: c.SpeakerLanguage, Loc: india, Links: c.Links, Literals: c.Literals, MaxChars: c.MaxChars,
			ClaimKinds: listings.ClaimKindsOf, Banned: listings.BannedWords, HealthClaim: listings.HasHealthClaim})
		if got.OK != c.Result.OK || (!got.OK && got.Check != c.Result.Check) {
			t.Errorf("%s: Go says ok=%v check=%d (%s), TypeScript says ok=%v check=%d", c.Name, got.OK, got.Check, got.Why, c.Result.OK, c.Result.Check)
			continue
		}
		if !got.OK {
			continue
		}
		if got.Text != c.Result.Text {
			t.Errorf("%s: text %q, want %q", c.Name, got.Text, c.Result.Text)
		}
		if !reflect.DeepEqual(sorted(got.Facts.AmountsInr), sorted(c.Result.Amounts)) || !reflect.DeepEqual(sorted(got.Facts.Counts), sorted(c.Result.Counts)) {
			t.Errorf("%s: facts differ: amounts %v counts %v, want %v %v", c.Name, got.Facts.AmountsInr, got.Facts.Counts, c.Result.Amounts, c.Result.Counts)
		}
		if len(got.Facts.MomentsMs) != len(c.Result.Moments) || len(got.Facts.Literals) != len(c.Result.Literals) {
			t.Errorf("%s: moments %v literals %v, want %v %v", c.Name, got.Facts.MomentsMs, got.Facts.Literals, c.Result.Moments, c.Result.Literals)
		}
	}
}

// TestCustomerAnswersAreReadByHand: a model's JSON is untrusted; what it comes to once read is what talk-types.ts readTalkAnswer makes of it (a customer's has no note and no limit).
func TestCustomerAnswersAreReadByHand(t *testing.T) {
	v := loadVectors(t)
	for i, r := range v.Reads {
		got := ReadCustomerAnswer(r.Raw)
		if (got == nil) != (r.Answer == nil) {
			t.Errorf("answer %d (%v): Go %v, TypeScript %v", i, r.Raw, got, r.Answer)
			continue
		}
		if got == nil {
			continue
		}
		if len(got.Sentences) != len(r.Answer.Sentences) || got.AskOwner != r.Answer.AskOwner || got.Limit != "" || got.NoteKind != "" {
			t.Errorf("answer %d: %+v, want %+v", i, got, r.Answer)
			continue
		}
		for j, s := range got.Sentences {
			w := r.Answer.Sentences[j]
			if s.Text != w.Text || !reflect.DeepEqual(append([]string{}, s.Sources...), append([]string{}, w.Sources...)) {
				t.Errorf("answer %d sentence %d: %+v, want %+v", i, j, s, w)
			}
		}
	}
}

// TestCustomerPromptsEqualTypeScript: the system text for every personality, character name and language, with the shop's name, the character's and the sources filled in.
func TestCustomerPromptsEqualTypeScript(t *testing.T) {
	v := loadVectors(t)
	if len(v.Prompts) < 25 {
		t.Fatalf("too few prompts: %d", len(v.Prompts))
	}
	for _, p := range v.Prompts {
		if got := CustomerPrompt(p.Shop, p.CharName, p.Personality, p.Language, sources(p.Sources)); got != p.System {
			t.Errorf("%s/%s/%q: prompt differs:\n%s\nwant\n%s", p.Language, p.Personality, p.CharName, got, p.System)
		}
	}
	if CustomerChars() != 400 {
		t.Errorf("a customer's reply is at most 400 characters, not %d", CustomerChars())
	}
}
