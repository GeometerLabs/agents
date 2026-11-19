// Grapheme clusters, the way `Intl.Segmenter(undefined, { granularity: "grapheme" })` cuts them in Node: Unicode Standard Annex 29 extended grapheme clusters, including the
// Indic conjunct rule GB9c (Devanagari, Bengali, Gujarati, Oriya, Telugu, Malayalam) and the emoji rule GB11. summary.ts `fitText` cuts a long shop name at a whole cluster, so
// a letter with its marks is never split; Go's standard library and the modules the owner approved have no segmenter (and rivo/uniseg is not approved), so the rules are here.
//
// Where the properties come from. The Go `unicode` tables (Unicode 17, the version Node 26's ICU also has) give Extend (Mn, Me, Other_Grapheme_Extend, the emoji modifiers),
// SpacingMark (Mc, and the two letters U+0E33 and U+0EB3), Control and the Regional Indicators. The few properties Go does not carry (Prepend, Extended_Pictographic, and the three
// Indic_Conjunct_Break classes) are in graphemes_gen.go, MADE BY RUNNING Node's own segmenter over every code point (scripts/gen_report_words.ts), so they are Node's, not retyped.
// The Go test then compares this file's cut with Intl.Segmenter's on every code point after "a" and before "a", on all pairs of a few hundred edge code points, and on
// hand-made Hindi, Malayalam, Kannada, Latin-with-combining-marks, emoji and flag strings (testdata/graphemes.json).
//
// Where Go and Node can still differ (also in Deferred.md): a Unicode version change in either (a new Go with newer tables, a new Node with newer ICU) shifts properties of newly
// assigned code points until the generator is run again (the freshness test names it); a string with invalid UTF-8 (JavaScript's lone surrogate) is cut with each bad byte as its own
// U+FFFD, which Node cannot be compared on since a Go string cannot hold a lone surrogate.
package report

import (
	"unicode"
	"unicode/utf8"
)

type gcb uint8

const (
	gOther gcb = iota
	gCR
	gLF
	gControl
	gExtend
	gZWJ
	gRI
	gPrepend
	gSpacingMark
	gL
	gV
	gT
	gLV
	gLVT
)

func inRanges(r rune, rs [][2]rune) bool {
	lo, hi := 0, len(rs)
	for lo < hi {
		mid := (lo + hi) / 2
		switch {
		case r < rs[mid][0]:
			hi = mid
		case r > rs[mid][1]:
			lo = mid + 1
		default:
			return true
		}
	}
	return false
}

// notSpacingMark are the spacing marks (Mc) the segmenter still treats as plain letters: the exceptions the standard's older tables listed (Myanmar, Tai Tham, Myanmar Extended-B) and Node's ICU keeps. Found by the every-code-point test against Node; 31 code points.
var notSpacingMark = [][2]rune{{0x102b, 0x102c}, {0x1038, 0x1038}, {0x1062, 0x1064}, {0x1067, 0x106d}, {0x1083, 0x1083}, {0x1087, 0x108c}, {0x108f, 0x108f}, {0x109a, 0x109c},
	{0x1a61, 0x1a61}, {0x1a63, 0x1a64}, {0xaa7b, 0xaa7b}, {0xaa7d, 0xaa7d}, {0x11720, 0x11721}}

func isExtPict(r rune) bool { return inRanges(r, extPictRanges) }

func classOf(r rune) gcb {
	switch {
	case r == '\r':
		return gCR
	case r == '\n':
		return gLF
	case r == 0x200d:
		return gZWJ
	case r >= 0x1100 && r <= 0x115f, r >= 0xa960 && r <= 0xa97c:
		return gL
	case r >= 0x1160 && r <= 0x11a7, r >= 0xd7b0 && r <= 0xd7c6:
		return gV
	case r >= 0x11a8 && r <= 0x11ff, r >= 0xd7cb && r <= 0xd7fb:
		return gT
	case r >= 0xac00 && r <= 0xd7a3:
		if (r-0xac00)%28 == 0 {
			return gLV
		}
		return gLVT
	case r >= 0x1f1e6 && r <= 0x1f1ff:
		return gRI
	case inRanges(r, prependRanges):
		return gPrepend
	case unicode.Is(unicode.Mn, r), unicode.Is(unicode.Me, r), unicode.Is(unicode.Other_Grapheme_Extend, r), r >= 0x1f3fb && r <= 0x1f3ff:
		return gExtend
	case inRanges(r, notSpacingMark):
		return gOther
	case unicode.Is(unicode.Mc, r), r == 0x0e33, r == 0x0eb3:
		return gSpacingMark
	case unicode.Is(unicode.Zl, r), unicode.Is(unicode.Zp, r), unicode.Is(unicode.Cc, r), unicode.Is(unicode.Cs, r), unicode.Is(unicode.Cf, r),
		unicode.Is(unicode.Other_Default_Ignorable_Code_Point, r):
		return gControl
	}
	return gOther
}

// Indic_Conjunct_Break state for GB9c: 0 nothing, 1 a consonant (and extenders) seen, 2 a linker seen after it.
type cut struct {
	prev  gcb
	incb  int
	pict  int // 0 none, 1 an ExtPict and then Extends, 2 that and then a ZWJ
	riOdd bool
	begun bool
}

// step takes the next code point and says whether a cluster boundary is before it, updating the state.
func (c *cut) step(r rune) (boundary bool) {
	cur := classOf(r)
	consonant, linker, extend := inRanges(r, incbConsonantRanges), inRanges(r, incbLinkerRanges), inRanges(r, incbExtendRanges)
	pict := isExtPict(r)
	if !c.begun {
		boundary = true // the start of the text (GB1)
	} else {
		prev := c.prev
		switch {
		case prev == gCR && cur == gLF: // GB3
		case prev == gControl || prev == gCR || prev == gLF: // GB4
			boundary = true
		case cur == gControl || cur == gCR || cur == gLF: // GB5
			boundary = true
		case prev == gL && (cur == gL || cur == gV || cur == gLV || cur == gLVT): // GB6
		case (prev == gLV || prev == gV) && (cur == gV || cur == gT): // GB7
		case (prev == gLVT || prev == gT) && cur == gT: // GB8
		case cur == gExtend || cur == gZWJ: // GB9
		case cur == gSpacingMark: // GB9a
		case prev == gPrepend: // GB9b
		case c.incb == 2 && consonant: // GB9c
		case c.pict == 2 && pict: // GB11
		case prev == gRI && cur == gRI && c.riOdd: // GB12, GB13
		default:
			boundary = true // GB999
		}
	}
	// the states for the next code point
	switch {
	case consonant:
		c.incb = 1
	case linker && c.incb >= 1:
		c.incb = 2
	case (extend || linker) && c.incb >= 1:
		// an extender keeps the state
	default:
		c.incb = 0
	}
	switch {
	case pict:
		c.pict = 1
	case cur == gExtend && c.pict == 1:
	case cur == gZWJ && c.pict == 1:
		c.pict = 2
	default:
		c.pict = 0
	}
	if cur == gRI {
		c.riOdd = boundary || !c.riOdd // a pair is complete when the second one joins: odd = an unpaired RI is waiting
	} else {
		c.riOdd = false
	}
	c.prev, c.begun = cur, true
	return boundary
}

// Graphemes cuts s into extended grapheme clusters (`[...new Intl.Segmenter(undefined, {granularity: "grapheme"}).segment(s)].map(g => g.segment)`). An invalid byte is its own cluster.
func Graphemes(s string) []string {
	var out []string
	var c cut
	start := 0
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		if c.step(r) && i > start {
			out = append(out, s[start:i])
			start = i
		}
		i += n
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}
