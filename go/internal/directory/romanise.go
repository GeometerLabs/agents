// A rough Latin spelling of Hindi, Malayalam and Kannada words (modules/discovery/romanise.ts), so a search typed in Latin letters ("billi", "poocha", "bekku") finds the listing whose
// words are in the native script. A FOLD, not a transliteration scheme: both sides are brought to the same plain lower-case Latin skeleton and the skeleton is compared. The letter
// tables are GENERATED from the TypeScript (scripts/gen_directory.ts into romanise_gen.go), never retyped; this file is the walk over them.
package directory

import (
	"github.com/GeometerLabs/agents/go/internal/language"
	"regexp"
	"strings"
	"unicode"
)

// spell: the plain Latin letters of a word in Devanagari, Malayalam or Kannada (other characters are kept as they are, lower-cased).
func spell(text string) string {
	var out strings.Builder
	chars := []rune(language.NFC(text))
	for i := 0; i < len(chars); i++ {
		c := string(chars[i])
		if consonant, ok := romConsonants[c]; ok {
			out.WriteString(consonant)
			if romNoVowel[c] {
				continue
			}
			if i+1 < len(chars) {
				next := string(chars[i+1])
				if romVirama[next] { // no vowel: the next consonant joins
					i++
					continue
				}
				if sign, ok := romSigns[next]; ok {
					out.WriteString(sign)
					i++
					continue
				}
			}
			out.WriteString("a") // the inherent vowel
			continue
		}
		if v, ok := romVowels[c]; ok {
			out.WriteString(v)
		} else if n, ok := romNasal[c]; ok {
			out.WriteString(n)
		} else if _, ok := romSigns[c]; ok || romVirama[c] || unicode.Is(unicode.M, chars[i]) {
			continue // a stray sign: nothing to say
		} else {
			out.WriteString(jsLowerRune(chars[i]))
		}
	}
	return out.String()
}

func jsLowerRune(r rune) string { return language.LowerJS(string(r)) }

var (
	notLatin = regexp.MustCompile(`[^a-z0-9]+`)
	hAfter   = regexp.MustCompile(`([bcdfgjklmnprstvy])h`)
	finalA   = regexp.MustCompile(`^(.{2,})a$`)
)

// flatten: a Latin spelling (typed by a buyer, or made by spell) brought to the skeleton both sides are compared by.
func flatten(latin string) string {
	words := strings.Fields(notLatin.ReplaceAllString(language.LowerJS(latin), " "))
	for i, w := range words {
		w = strings.NewReplacer("w", "v", "z", "j", "q", "k", "x", "ks").Replace(w) // single pass, as the chain of replaces each only sees letters the last left (none make another)
		w = hAfter.ReplaceAllString(w, "$1")
		w = strings.NewReplacer("ee", "i", "oo", "u").Replace(w)
		w = collapseRepeats(w)
		// `(.{2,})a$` on a word of any length: the part before the final a must be two characters or more (code points, as the u flag counts)
		if m := finalA.FindStringSubmatch(w); m != nil {
			w = m[1]
		}
		words[i] = w
	}
	return strings.Join(words, " ")
}

// collapseRepeats is `.replace(/(.)\1+/gu, "$1")`: a run of the same character becomes one (RE2 has no back-reference).
func collapseRepeats(w string) string {
	var out []rune
	for _, r := range w {
		if len(out) > 0 && out[len(out)-1] == r {
			continue
		}
		out = append(out, r)
	}
	return string(out)
}

// skeleton: the skeleton of a word or phrase in any of our scripts or in Latin letters: what the index stores and what a Latin search is turned into.
func skeleton(text string) string { return flatten(spell(text)) }
