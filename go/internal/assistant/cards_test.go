package assistant

import (
	"encoding/json"
	"os"
	"testing"
)

// TestDigestMatchesTypeScript: the digest of each vector (made by go/scripts/gen_digest_vectors.ts from the TypeScript runtime's own function) equals Go's.
func TestDigestMatchesTypeScript(t *testing.T) {
	b, err := os.ReadFile("testdata/digest-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Kind, Case string
		Fields     Raw
		Digest     string
	}
	if err := json.Unmarshal(b, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors) < 5 {
		t.Fatal("too few vectors")
	}
	for i, v := range vectors {
		if got := ActionDigest(Action{Kind: v.Kind, Skill: "listings", Case: v.Case, Fields: v.Fields}); got != v.Digest {
			t.Errorf("vector %d: Go %s, TypeScript %s", i, got, v.Digest)
		}
	}
}

func TestJSQuote(t *testing.T) {
	for in, want := range map[string]string{"a<b>&c": `"a<b>&c"`, "  ": "\"  \"", "\b\f\n\r\t": `"\b\f\n\r\t"`, "\x01\x1f": `"\u0001\u001f"`, `"\`: `"\"\\"`, "\x7f": "\"\x7f\""} {
		if got := jsQuote(in); got != want {
			t.Errorf("%q: got %s want %s", in, got, want)
		}
	}
}

// A state round trip loses nothing: unknown members of the state, of a card, of its action and of a talk line come back, and the typed ones are written as TypeScript reads them.
func TestStateRoundTripKeepsUnknownMembers(t *testing.T) {
	in := `{"seq":4,"cards":[{"id":"c-1","codeHash":"h","action":{"kind":"listing","skill":"listings","case":"listing:l-1","fields":{"qty":2,"title_en":"x"},"future":1},"proposal":{"kind":"listing","case":"listing:l-1"},"digest":"d","state":"open","createdAtMs":1,"expiresAtMs":2,"newer":{"a":[1]}}],"refused":[],"closedDays":["2026-11-20"],"undo":[{"id":"u-2","kind":"remember","skill":"s","date":"","asked":[],"case":"n-1","atMs":1,"untilMs":2}],"talk":[{"atMs":5,"from":"owner","text":"hi","voice":true}],"chat":[],"limitChanges":[{"id":"x"}],"memory":{"notes":[]},"stock":{"lines":[]},"listings":{"seq":1},"brandNew":"yes"}`
	var m Raw
	if err := json.Unmarshal([]byte(in), &m); err != nil {
		t.Fatal(err)
	}
	out := FromMembers(m).Members()
	var a, b any
	_ = json.Unmarshal([]byte(in), &a)
	ob, _ := json.Marshal(out)
	_ = json.Unmarshal(ob, &b)
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if string(ja) != string(jb) {
		t.Fatalf("round trip changed the state:\n in  %s\n out %s", ja, jb)
	}
}

func TestMakeJudgeClose(t *testing.T) {
	s := Fresh()
	act := Action{Kind: "listing", Skill: "listings", Case: "listing:l-1", Fields: Raw{"title_en": jstr("A")}}
	c1, _ := s.MakeCard(act, Raw{"kind": jstr("listing")}, 1000)
	if c1.ID != "c-1" || c1.Digest != ActionDigest(act) {
		t.Fatal("first card", c1.ID, c1.Digest)
	}
	same := func(*Card) (Action, string, bool) { return act, "", true }
	if v := JudgeCard(c1, "yes", 2000, same); v.Kind != "do" {
		t.Fatal(v.Kind)
	}
	other := Action{Kind: "listing", Skill: "listings", Case: "listing:l-1", Fields: Raw{"title_en": jstr("B")}}
	if v := JudgeCard(c1, "yes", 2000, func(*Card) (Action, string, bool) { return other, "", true }); v.Kind != "changed" {
		t.Fatal(v.Kind)
	}
	if v := JudgeCard(c1, "yes", 2000, func(*Card) (Action, string, bool) { return act, "not_live", false }); v.Kind != "gone" || v.Why != "not_live" {
		t.Fatal(v.Kind)
	}
	if v := JudgeCard(c1, "no", 2000, same); v.Kind != "refuse" {
		t.Fatal(v.Kind)
	}
	if v := JudgeCard(c1, "yes", 1000+CardForMs, same); v.Kind != "expired" {
		t.Fatal(v.Kind)
	}
	if v := JudgeCard(nil, "yes", 0, same); v.Kind != "unknown" {
		t.Fatal(v.Kind)
	}
	c2, voided := s.MakeCard(act, Raw{}, 3000) // a second card for the same thing voids the first
	if len(voided) != 1 || s.Cards[0].State != "void" || s.Cards[0].ReplacedBy != c2.ID || c2.ID != "c-2" {
		t.Fatal("void", voided, s.Cards[0].State)
	}
	s.Close(c2, "refused", 4000)
	if r := s.RefusedBefore(c2.Digest, 5000); r == nil || r.Card != "c-2" {
		t.Fatal("a no is final")
	}
	if v := JudgeCard(c2, "yes", 5000, same); v.Kind != "closed" {
		t.Fatal(v.Kind)
	}
	if len(s.Expire(3000+CardForMs)) != 0 {
		t.Fatal("nothing open to expire")
	}
}
