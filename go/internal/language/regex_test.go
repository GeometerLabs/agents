// Tests of the JavaScript-regex matcher: every pattern in the pack compiles, and finds in every phrase of the corpus exactly what JavaScript finds (the same places, the same
// groups, and the same text after a g-flag replace), from go/scripts/gen_patterns.ts.
package language

import (
	"encoding/json"
	"os"
	"testing"
)

type hit []*string

func TestPatternsEqualJavaScript(t *testing.T) {
	b, err := os.ReadFile("testdata/pattern-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Corpus  []string
		Vectors map[string][]struct {
			Text     string
			Hits     []json.RawMessage
			Replaced string
		}
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	load()
	if len(v.Vectors) != len(compiled) {
		t.Fatalf("%d patterns have vectors, %d are packed", len(v.Vectors), len(compiled))
	}
	total := 0
	for name, rows := range v.Vectors {
		re := P(name).Global(true)
		withHits := map[string]bool{}
		for _, row := range rows {
			withHits[row.Text] = true
			got := re.All(row.Text)
			if len(got) != len(row.Hits) {
				t.Errorf("%s on %q: Go finds %d matches, JavaScript %d", name, row.Text, len(got), len(row.Hits))
				continue
			}
			for i, raw := range row.Hits {
				var h []any
				_ = json.Unmarshal(raw, &h)
				m := got[i]
				if int(h[0].(float64)) != UTF16Index(row.Text, m.Start()) {
					t.Errorf("%s on %q: match %d at %d, JavaScript at %v", name, row.Text, i, UTF16Index(row.Text, m.Start()), h[0])
				}
				for k, want := range h[1:] {
					if want == nil {
						if m.Took(k) {
							t.Errorf("%s on %q: group %d took part in Go", name, row.Text, k)
						}
					} else if m.Group(k) != want.(string) {
						t.Errorf("%s on %q: group %d is %q, JavaScript %q", name, row.Text, k, m.Group(k), want)
					}
				}
				total++
			}
			if r := re.Replace(row.Text, "<$&>"); r != row.Replaced {
				t.Errorf("%s replace on %q: %q, JavaScript %q", name, row.Text, r, row.Replaced)
			}
		}
		for _, text := range v.Corpus {
			if !withHits[text] && re.Test(text) {
				t.Errorf("%s matches %q in Go, not in JavaScript", name, text)
			}
		}
	}
	if total < 150 {
		t.Fatalf("only %d matches were compared", total)
	}
}

// TestMatchNextToMatch: the case the edge-consuming way got wrong.
func TestMatchNextToMatch(t *testing.T) {
	got := P("talk.number_words").Global(true).All("ten twenty")
	if len(got) != 2 || got[0].Group(0) != "ten" || got[1].Group(0) != "twenty" {
		t.Fatalf("ten twenty: %d matches", len(got))
	}
}

// TestBacktrackingIntoTheEdge: when the longer choice fails its edge, JavaScript backtracks to a shorter one that passes; so must this.
func TestBacktrackingIntoTheEdge(t *testing.T) {
	re := MustCompile(`(?<![\p{L}])(?:tue|tues|tuesday)(?![\p{L}])`, "u")
	if m := re.Find("tues day"); m == nil || m.Group(0) != "tues" {
		t.Fatalf("tues day: %+v", m)
	}
	re2 := MustCompile(`(?<![\p{L}])(?:ab|a)(?![b])`, "u")
	// "ab" then the edge sees "b": JavaScript backtracks to "a", whose edge sees "b" too, so no match at 0
	if m := re2.Find("abb"); m != nil {
		t.Fatalf("abb: %v", m.Group(0))
	}
	if m := re2.Find("abc"); m == nil || m.Group(0) != "ab" {
		t.Fatalf("abc: %+v", m)
	}
	// a longer look-ahead after plain text
	re3 := MustCompile(`free(?! (?:time|slot))`, "iu")
	if re3.Test("free time") || !re3.Test("free gift") || !re3.Test("Free") {
		t.Fatal("free(?! ...)")
	}
	if _, err := Compile(`(?:a|ab)(?!cd)`, "u"); err == nil {
		t.Fatal("a long look-ahead after a choice must be refused")
	}
	if _, err := Compile(`a(?=b)c`, "u"); err == nil {
		t.Fatal("a look-ahead in the middle must be refused")
	}
}

func TestPlainAndLengths(t *testing.T) {
	if Plain("ന്‍൧൨ ३") != "ൻ12 3" {
		t.Fatalf("plain: %q", Plain("ന്‍ൻ൧൨ ३"))
	}
	if UTF16Len("a😀") != 3 || UTF16Slice("a😀b", 2) != "a" || UTF16Slice("a😀b", 3) != "a😀" {
		t.Fatal("utf16")
	}
	if LanguageOfScript("hello ನಮಸ್ಕಾರ नमस्ते") != "hi" || LanguageOfScript("ok") != "en" {
		t.Fatal("languageOfScript")
	}
}
