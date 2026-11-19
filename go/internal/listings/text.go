package listings

// Small text tools the rules share, and the places where JavaScript's idea of text differs from Go's. Each of these cost a fix once; the comments say what they match. The
// format.ts helpers (plain, the length, the whitespace, the script's language) are internal/language's: one implementation.

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// utf16Len is JavaScript's `string.length`: UTF-16 code units. A Malayalam title's limit of 80 is counted the way the TypeScript side counts it.
func utf16Len(s string) int { return language.UTF16Len(s) }

// utf16Slice is JavaScript's `s.slice(0, n)`, a cut through a surrogate pair becoming U+FFFD as this package has always written it (language.UTF16SliceFFFD; UTF16Slice drops the half).
func utf16Slice(s string, n int) string { return language.UTF16SliceFFFD(s, n) }

// isJSSpace is what JavaScript's `\s` matches. Go's unicode.IsSpace differs in two places: it takes U+0085 and not U+FEFF.
func isJSSpace(r rune) bool { return language.IsJSSpace(r) }

// clean is `text.replace(/\s+/gu, " ").trim()`.
func clean(s string) string {
	return strings.Join(strings.FieldsFunc(s, isJSSpace), " ")
}

// wordEdge reports whether a match at s[from:to] stands alone as a word in the scripts where `\b` does not work: no letter or mark just before or after. This is the pair
// `(?<![\p{L}\p{M}])...(?![\p{L}\p{M}])` the TypeScript patterns use; Go's regexp has no look-behind or look-ahead, so the edges are checked here.
func wordEdge(s string, from, to int) bool {
	if from > 0 {
		r, _ := utf8.DecodeLastRuneInString(s[:from])
		if unicode.IsLetter(r) || unicode.IsMark(r) {
			return false
		}
	}
	if to < len(s) {
		r, _ := utf8.DecodeRuneInString(s[to:])
		if unicode.IsLetter(r) || unicode.IsMark(r) {
			return false
		}
	}
	return true
}

// wordEdgeBefore and wordEdgeAfter are the two halves of wordEdge, for the patterns that need only one.
func wordEdgeBefore(s string, from int) bool {
	if from == 0 {
		return true
	}
	r, _ := utf8.DecodeLastRuneInString(s[:from])
	return !(unicode.IsLetter(r) || unicode.IsMark(r))
}

func wordEdgeAfter(s string, to int) bool {
	if to >= len(s) {
		return true
	}
	r, _ := utf8.DecodeRuneInString(s[to:])
	return !(unicode.IsLetter(r) || unicode.IsMark(r))
}

// findWord is "does re match somewhere as a whole word". It tries every match the engine finds, left to right. (JavaScript would also try a shorter alternative at the same place
// when the first one fails its edges; with these word lists that has not mattered, and the contract has a test for the cases that do.)
func findWord(re *regexp.Regexp, s string) bool {
	for _, loc := range re.FindAllStringIndex(s, -1) {
		if wordEdge(s, loc[0], loc[1]) {
			return true
		}
	}
	return false
}

// compileWords makes a case-insensitive pattern from a list of alternatives.
func compileWords(alternatives string) *regexp.Regexp {
	return regexp.MustCompile("(?i)(?:" + alternatives + ")")
}

// plain is modules/language/format.ts `plain`: Devanagari, Malayalam and Kannada digits turned into 0-9, old-style Malayalam chillus made new-style, zero-width joiners removed.
// Like the TypeScript version it first puts the text in NFC (golang.org/x/text/unicode/norm, approved 19 Nov 2026), so a phone that sends Malayalam, Kannada or Hindi decomposed
// (a vowel sign sent as its two halves, a nukta letter as letter + U+093C) is read as the same words as one that sends it composed.
func plain(text string) string { return language.Plain(text) }

// languageOfScript is modules/language/format.ts: which language a stretch of text is written in, by its script.
func languageOfScript(text string) string { return language.LanguageOfScript(text) }
