package listings

// Small text tools the rules share, and the places where JavaScript's idea of text differs from Go's. Each of these cost a fix once; the comments say what they match.

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
)

// utf16Len is JavaScript's `string.length`: UTF-16 code units. A Malayalam title's limit of 80 is counted the way the TypeScript side counts it.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += len(utf16.Encode([]rune{r}))
	}
	return n
}

// utf16Slice is JavaScript's `s.slice(0, n)`.
func utf16Slice(s string, n int) string {
	if utf16Len(s) <= n {
		return s
	}
	units := utf16.Encode([]rune(s))
	return string(utf16.Decode(units[:n]))
}

// isJSSpace is what JavaScript's `\s` matches. Go's unicode.IsSpace differs in two places: it takes U+0085 and not U+FEFF.
func isJSSpace(r rune) bool {
	if r == 0x85 {
		return false
	}
	return unicode.IsSpace(r) || r == 0xFEFF
}

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
// The TypeScript version first normalises to NFC; Go's standard library has no Unicode normalisation (it lives in golang.org/x/text, which this trial may not add), so text is
// taken as it is typed, which is composed in practice (see TRIAL.md).
func plain(text string) string {
	for _, c := range oldChillu {
		text = strings.ReplaceAll(text, c[0], c[1])
	}
	var b strings.Builder
	for _, r := range text {
		switch {
		case r == 0x200c || r == 0x200d:
		case r >= 0x0966 && r <= 0x096f:
			b.WriteRune('0' + (r - 0x0966))
		case r >= 0x0d66 && r <= 0x0d6f:
			b.WriteRune('0' + (r - 0x0d66))
		case r >= 0x0ce6 && r <= 0x0cef:
			b.WriteRune('0' + (r - 0x0ce6))
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

var oldChillu = [][2]string{{"ണ്‍", "ൺ"}, {"ന്‍", "ൻ"}, {"ര്‍", "ർ"}, {"ല്‍", "ൽ"}, {"ള്‍", "ൾ"}, {"ക്‍", "ൿ"}}

// languageOfScript is modules/language/format.ts: which language a stretch of text is written in, by its script.
func languageOfScript(text string) string {
	for _, r := range text {
		switch {
		case r >= 0x0900 && r <= 0x097f:
			return "hi"
		}
	}
	for _, r := range text {
		if r >= 0x0d00 && r <= 0x0d7f {
			return "ml"
		}
	}
	for _, r := range text {
		if r >= 0x0c80 && r <= 0x0cff {
			return "kn"
		}
	}
	return "en"
}
