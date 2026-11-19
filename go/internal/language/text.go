// Package language is the bottom layer of the shop's reading of words (the Go twin of modules/language): text made easy to match (format.ts `plain`, `canon`,
// `languageOfScript`), JavaScript's idea of a string's length and of whitespace, and regular expressions matched the way JavaScript matches them (regex.go), with the
// TypeScript's own patterns (patterns.go). It imports nothing of the shop's: `memory`, `understanding` and `assistant` build on it, never the other way round.
package language

import (
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	xnorm "golang.org/x/text/unicode/norm"
)

// JSSpace is the character-class content of JavaScript's `\s` (ECMAScript WhiteSpace and LineTerminator). Go's `\s` is only [\t\n\f\r ], and unicode.IsSpace takes U+0085 and
// not U+FEFF, so neither is used where TypeScript's `\s` is copied.
const JSSpace = `\t\n\x0b\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// IsJSSpace is what JavaScript's `\s` matches.
func IsJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', 0x0b, '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// TrimJS is JavaScript's `s.trim()`.
func TrimJS(s string) string { return strings.TrimFunc(s, IsJSSpace) }

// UTF16Len is JavaScript's `s.length`: UTF-16 code units.
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

// UTF16Index is the JavaScript index (UTF-16 units) of byte offset i of s.
func UTF16Index(s string, i int) int { return UTF16Len(s[:i]) }

// UTF16Slice is JavaScript's `s.slice(0, n)`. A cut inside a surrogate pair leaves a lone surrogate in JavaScript, which a Go string cannot hold: the half character is dropped.
func UTF16Slice(s string, n int) string {
	units := 0
	for i, r := range s {
		w := utf16.RuneLen(r)
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

var oldChillu = strings.NewReplacer("ണ്‍", "ൺ", "ന്‍", "ൻ", "ര്‍", "ർ", "ല്‍", "ൽ", "ള്‍", "ൾ", "ക്‍", "ൿ")

// Plain is format.ts `plain`: composed (NFC), old-style Malayalam chillus (consonant + virama + ZWJ) made new-style, zero-width joiners removed, Devanagari, Malayalam and
// Kannada digits turned into 0-9. Case is kept.
func Plain(text string) string {
	out := oldChillu.Replace(xnorm.NFC.String(text))
	var b strings.Builder
	b.Grow(len(out))
	for _, r := range out {
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

// Canon is format.ts `canon`: Plain and lower case. Go's strings.ToLower and JavaScript's toLowerCase differ only on a few special cases (U+0130 is "i̇" in JavaScript), none
// of which is in the four languages' words.
func Canon(text string) string { return strings.ToLower(Plain(text)) }

// LanguageOfScript is format.ts `languageOfScript`: Devanagari is Hindi, then Malayalam, then Kannada (each looked for in the whole text, in that order); Latin letters are English.
func LanguageOfScript(text string) string {
	for _, block := range []struct {
		lo, hi rune
		lang   string
	}{{0x0900, 0x097f, "hi"}, {0x0d00, 0x0d7f, "ml"}, {0x0c80, 0x0cff, "kn"}} {
		for _, r := range text {
			if r >= block.lo && r <= block.hi {
				return block.lang
			}
		}
	}
	return "en"
}

// runeBefore is the code point ending at byte i of s (utf8.RuneError at 0).
func runeBefore(s string, i int) rune {
	if i <= 0 {
		return utf8.RuneError
	}
	r, _ := utf8.DecodeLastRuneInString(s[:i])
	return r
}

// Fold is talk-check.ts `fold`: decomposed (NFD) with the Devanagari nukta (U+093C) dropped, so "मुफ़्त" and "मुफ्त", typed either way, are one word. x/text's NFD splits the
// eight precomposed nukta letters (U+0958 to U+095F) itself.
func Fold(s string) string { return strings.ReplaceAll(xnorm.NFD.String(s), "\u093c", "") }
