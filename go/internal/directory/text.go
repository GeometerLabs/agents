// The pure text helpers of search (modules/discovery/text.ts): how words are normalised for the index and for a search, the search words of a question and the distance
// between two points. Where JavaScript and Go differ the helper in jsutil.go is used (UTF-16 slices, the full lower-casing).
package directory

import (
	"math"
	"regexp"
	"strings"
)

// normal: words as they are indexed and searched: composed form, no zero-width joiners (they split Malayalam words), lower case.
func normal(text string) string {
	t := nfc(text)
	t = strings.ReplaceAll(strings.ReplaceAll(t, "‌", ""), "‍", "")
	return jsLower(t)
}

// haversineKm is the great-circle distance in kilometres. Math.sin and the others are V8's; Go's may differ in the last bit, which can only matter exactly on a band edge.
func haversineKm(aLat, aLon, bLat, bLon float64) float64 {
	rad := math.Pi / 180
	dLat, dLon := (bLat-aLat)*rad, (bLon-aLon)*rad
	s1, s2 := math.Sin(dLat/2), math.Sin(dLon/2)
	h := s1*s1 + math.Cos(aLat*rad)*math.Cos(bLat*rad)*s2*s2
	return 2 * 6371.0088 * math.Asin(math.Min(1, math.Sqrt(h)))
}

var wordRun = regexp.MustCompile(`[\p{L}\p{M}\p{N}]+`)

// wordsOf: the search words of a text: runs of letters, marks and digits (so a Malayalam word stays whole), at most 8 of 40 UTF-16 units.
func wordsOf(text string) []string {
	var out []string
	for _, w := range wordRun.FindAllString(normal(text), -1) {
		out = append(out, sliceUTF16(w, 40))
		if len(out) == 8 {
			break
		}
	}
	return out
}

// filler: words that say what a person is doing, not what they want; leaving them out lets "kitten near me" mean "kitten".
var filler = map[string]bool{}

func init() {
	for _, w := range strings.Fields("near nearby me my in at the a an for of to and with around buy sale sell selling available shop shops want need looking") {
		filler[w] = true
	}
}

func searchWords(text string) []string {
	out := []string{}
	for _, w := range wordsOf(text) {
		if !filler[w] {
			out = append(out, w)
		}
	}
	return out
}

// turnHash is order.ts turnHash: two FNV-1a lanes over the UTF-16 code units, as 16 hex digits. JavaScript's Math.imul and `>>> 0` are 32-bit unsigned arithmetic.
func turnHash(text string) string {
	a, b := uint32(0x811c9dc5), uint32(0x01000193^0x5bd1e995)
	i := uint32(0)
	step := func(c uint32) {
		a = (a ^ c) * 0x01000193
		b = (b ^ (c + i)) * 0x85ebca6b
		b ^= b >> 13
		i++
	}
	for _, r := range text {
		if r >= 0x10000 {
			r -= 0x10000
			step(0xd800 + uint32(r>>10))
			step(0xdc00 + uint32(r&0x3ff))
		} else {
			step(uint32(r))
		}
	}
	return hex8(a) + hex8(b)
}

func hex8(n uint32) string {
	const d = "0123456789abcdef"
	var b [8]byte
	for i := 7; i >= 0; i-- {
		b[i] = d[n&15]
		n >>= 4
	}
	return string(b[:])
}
