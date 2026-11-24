package runtime

// caseasked.go held to modules/record/case-asked.ts by testdata/caseasked-vectors.json (go/scripts/gen_caseasked_vectors.ts): the tokens, the record's keys, the case each
// message names in each template's forms (with and without the word form), and the hourly limit.

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/store"
)

func TestCaseAskedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/caseasked-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Holds   []string             `json:"holds"`
		Extra   [][2]string          `json:"extra"`
		Entries []store.Entry        `json:"entries"`
		Keys    map[string]string    `json:"keys"`
		Forms   map[string]CaseForms `json:"forms"`
		Tokens  []struct {
			Text   string   `json:"text"`
			Tokens []string `json:"tokens"`
		} `json:"tokens"`
		Named []struct {
			Template, Text string
			Words          bool
			Named          *Named
		} `json:"named"`
		Asked []store.Entry `json:"asked"`
		Told  []struct {
			Conversation string `json:"conversation"`
			Case         string `json:"case"`
			NowMs        int64  `json:"nowMs"`
			Told         bool   `json:"told"`
		} `json:"told"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for _, c := range v.Tokens {
		got := CaseTokens(c.Text)
		if len(got) == 0 && len(c.Tokens) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.Tokens) {
			t.Errorf("tokens of %q: %q, the TypeScript has %q", c.Text, got, c.Tokens)
		}
	}
	keys := RecordCaseKeys(v.Entries)
	if !reflect.DeepEqual(keys, v.Keys) {
		t.Errorf("the record's keys: %v, the TypeScript has %v", keys, v.Keys)
	}
	for _, e := range v.Extra {
		keys[e[0]] = e[1]
	}
	holds := map[string]bool{}
	for _, h := range v.Holds {
		holds[h] = true
	}
	isCase := func(id string) bool { return holds[id] }
	for _, c := range v.Named {
		got := NamedCase(c.Text, v.Forms[c.Template], isCase, keys, c.Words)
		if !reflect.DeepEqual(got, c.Named) {
			t.Errorf("%s %q (words %v): %+v, the TypeScript has %+v", c.Template, c.Text, c.Words, got, c.Named)
		}
	}
	for _, c := range v.Told {
		if got := ToldLately(v.Asked, c.Conversation, c.Case, c.NowMs); got != c.Told {
			t.Errorf("told lately %s %s: %v, the TypeScript has %v", c.Conversation, c.Case, got, c.Told)
		}
	}
}
