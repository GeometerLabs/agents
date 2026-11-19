package language

// WordRe is dates.ts `wordRe`: the JavaScript source of a pattern for whole words, built the TypeScript's way and compiled by this package's
// matcher. It is for words a shop gives at run time (a service's names); every fixed word list is generated from the TypeScript (patterns.json), never built here.
//
// The rules are dates.ts's: each word after Canon, longest first (by UTF-16 length, a stable sort as V8's); a word in Malayalam or Kannada letters also matches with more letters
// stuck on its end (the endings of those languages), unless `inflect` is false, and a Malayalam word that ends in a chillu also matches with the plain consonant ("ഫേഷ്യൽ",
// "ഫേഷ്യലിന്"); words in other scripts match whole. The sources are proved equal to the TypeScript's in regex_test.go.

import (
	"regexp"
	"sort"
	"strings"
)

const (
	notLetterBefore = `(?<![\p{L}\p{M}\p{N}])`
	notLetterAfter  = `(?![\p{L}\p{M}\p{N}])`
)

var (
	dravidianLetters = regexp.MustCompile(`[\x{0D00}-\x{0D7F}\x{0C80}-\x{0CFF}]`)
	reSpecial        = regexp.MustCompile(`[.*+?^${}()|\[\]\\]`)
	spaces           = regexp.MustCompile(` +`)
	// CHILLU_BASE: the chillu and the plain consonant(s) it stands for
	chilluBase = map[string]string{"ൺ": "ണ", "ൻ": "ന", "ർ": "രറ", "ൽ": "ല", "ൾ": "ള", "ൿ": "ക"}
)

func escapeRe(s string) string { return reSpecial.ReplaceAllString(s, `\$0`) }

func stemPattern(w string) string {
	for chillu, base := range chilluBase {
		if strings.HasSuffix(w, chillu) {
			return escapeRe(strings.TrimSuffix(w, chillu)) + "[" + chillu + base + "]"
		}
	}
	// ENDS_IN_VIRAMA: a last Malayalam or Kannada virama is left off
	for _, virama := range []string{"്", "್"} {
		if strings.HasSuffix(w, virama) {
			return escapeRe(strings.TrimSuffix(w, virama))
		}
	}
	return escapeRe(w)
}

// longestFirst is the words after Canon, longest first (UTF-16 length; equal lengths keep their order).
func longestFirst(words []string) []string {
	out := make([]string, len(words))
	for i, w := range words {
		out[i] = Canon(w)
	}
	sort.SliceStable(out, func(i, j int) bool { return UTF16Len(out[i]) > UTF16Len(out[j]) })
	return out
}

// WordRe is `wordRe(words, flags, inflect)`.
func WordRe(words []string, flags string, inflect bool) *Regex {
	return MustCompile(WordReSource(words, inflect), flags)
}

// WordReSource is the source wordRe builds.
func WordReSource(words []string, inflect bool) string {
	alts := longestFirst(words)
	for i, w := range alts {
		if inflect && dravidianLetters.MatchString(w) {
			alts[i] = stemPattern(w) + `[\p{L}\p{M}]*`
		} else {
			alts[i] = escapeRe(w)
		}
	}
	return notLetterBefore + "(?:" + strings.Join(alts, "|") + ")" + notLetterAfter
}
