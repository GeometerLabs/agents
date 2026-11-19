// Tests of the grapheme cutter against Node's Intl.Segmenter (testdata/graphemes.json, made by scripts/gen_report_vectors.ts): every code point after "a" and before "a", all pairs of
// a few hundred edge code points, every triple of a small set (regional indicators, ZWJ, Indic virama, Hangul), and hand-made Hindi, Malayalam, Kannada, Latin-with-marks, emoji,
// flag and Hangul strings.
package report

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

type graphemeVectors struct {
	JoinsAfter, JoinsBefore, Controls [][2]rune
	Edge                              []rune
	Pairs                             []string
	Triples, Strings                  []struct {
		S    string
		Cuts []string
	}
}

func loadGraphemes(t *testing.T) graphemeVectors {
	t.Helper()
	raw, err := os.ReadFile("testdata/graphemes.json")
	if err != nil {
		t.Fatal(err)
	}
	var g graphemeVectors
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestGraphemesEveryCodePoint(t *testing.T) {
	g := loadGraphemes(t)
	for _, c := range []struct {
		name   string
		ranges [][2]rune
		// join: does the cluster continue (no boundary) at the second step, given the sequence this test builds
		joins func(r rune) bool
	}{
		{"after a", g.JoinsAfter, func(r rune) bool { var c cut; c.step('a'); return !c.step(r) }},
		{"before a", g.JoinsBefore, func(r rune) bool { var c cut; c.step(r); return !c.step('a') }},
		{"controls", g.Controls, func(r rune) bool { var c cut; c.step('a'); b1 := c.step(r); b2 := c.step('a'); return b1 && b2 }},
	} {
		bad := 0
		for r := rune(0); r <= 0x10ffff; r++ {
			if r >= 0xd800 && r <= 0xdfff {
				continue
			}
			if c.joins(r) != inRanges(r, c.ranges) {
				if bad++; bad <= 10 {
					t.Errorf("%s: U+%04X: Go says %v, Node %v", c.name, r, c.joins(r), inRanges(r, c.ranges))
				}
			}
		}
		if bad > 10 {
			t.Errorf("%s: %d code points differ", c.name, bad)
		}
	}
}

func TestGraphemesPairsTriplesAndStrings(t *testing.T) {
	g := loadGraphemes(t)
	for i, x := range g.Edge {
		for j, y := range g.Edge {
			want := int(g.Pairs[i][j] - '0')
			if got := len(Graphemes(string(x) + string(y))); got != want {
				t.Errorf("U+%04X U+%04X: %d clusters, Node %d", x, y, got, want)
			}
		}
	}
	for _, c := range g.Triples {
		if got := Graphemes(c.S); !slices.Equal(got, c.Cuts) {
			t.Errorf("%q: %q, Node %q", c.S, got, c.Cuts)
		}
	}
	if len(g.Triples) < 8000 || len(g.Strings) < 90 {
		t.Errorf("too few vectors: %d triples, %d strings", len(g.Triples), len(g.Strings))
	}
	for _, c := range g.Strings {
		if got := Graphemes(c.S); !slices.Equal(got, c.Cuts) && !(len(got) == 0 && len(c.Cuts) == 0) {
			t.Errorf("%q: %q, Node %q", c.S, got, c.Cuts)
		}
	}
}

func TestGraphemesInvalidUTF8(t *testing.T) {
	if got := Graphemes("a\xffb"); len(got) != 3 {
		t.Errorf("an invalid byte is a cluster of its own: %q", got)
	}
}
