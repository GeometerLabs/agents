// Cleaning a buyer's words before ANY model sees them (modules/discovery/assistant.ts cleanQuestion): first the personal details every model step takes out (phone numbers, e-mail
// addresses, links, the name after "my name is"), which is understanding.Redact, the one implementation the shops' runtime uses too (redact.ts; the directory never knows a buyer's name,
// so it passes no list of known names); then exact addresses (a house or door number, "12/4", "<a word or two> road"), which only the directory looks for; then cut to 200 characters.
//
// Go's regular expressions (RE2) have no look-behind and no look-ahead, and `\s` is ASCII only, where JavaScript's is the Unicode white space: the patterns spell the white space out
// (language.JSSpace), and the look-arounds the TypeScript uses are done by hand at the edge of a match (notAfterLetter, and a trailing group that takes one character and gives it back).
package directory

import (
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/understanding"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const digits = `0-9०-९൦-൯೦-೯`

func isLM(r rune) bool { return unicode.IsLetter(r) || unicode.IsMark(r) }

// notAfterLetter is the look-behind `(?<![\p{L}\p{M}])` at byte offset i of s.
func notAfterLetter(s string, i int) bool {
	if i == 0 {
		return true
	}
	r, _ := utf8.DecodeLastRuneInString(s[:i])
	return !isLM(r)
}

// ---- cleaning the buyer's words (assistant.ts cleanQuestion) ----

const numClass = `[` + digits + `]`

var (
	reAddr1 = regexp.MustCompile(`(?i)^(?:house|door|flat|plot|h\.?[` + language.JSSpace + `]?no|d\.?[` + language.JSSpace + `]?no|no)\.?[` + language.JSSpace + `]*[:#-]?[` + language.JSSpace + `]*` + numClass + `[\p{L}\p{N}/-]*`)
	reAddr2 = regexp.MustCompile(`(?i)^(?:घर|वीट|വീട്|ಮನೆ)[` + language.JSSpace + `]*(?:नंबर|नं\.?|നമ്പർ|ಸಂಖ್ಯೆ)?[` + language.JSSpace + `]*` + numClass + `+[\p{L}\p{N}/-]*`)
	reAddr3 = regexp.MustCompile(`(?i)^` + numClass + `+[` + language.JSSpace + `]*/[` + language.JSSpace + `]*` + numClass + `+[A-Za-z]?`)
	reAddr4 = regexp.MustCompile(`(?i)^(?:[\p{L}\p{M}.'-]+[` + language.JSSpace + `]+){1,2}(?:road|street|lane|cross|colony|layout|nagar|apartments?|enclave|marg|रोड|गली|कॉलोनी|റോഡ്|ലെയ്ൻ|ರಸ್ತೆ|ಬಡಾವಣೆ)([^\p{L}\p{M}]|$)`)
	reWS    = regexp.MustCompile(`[` + language.JSSpace + `]+`)
)

// replaceAddresses is `text.replace(ADDRESS, "[address]")`: at each position, the first of the four patterns that matches (the first only where it is not after a letter; the last only
// where no letter follows) is replaced.
func replaceAddresses(text string) string {
	var out strings.Builder
	for i := 0; i < len(text); {
		n := 0
		if notAfterLetter(text, i) {
			if loc := reAddr1.FindStringIndex(text[i:]); loc != nil {
				n = loc[1]
			}
		}
		if n == 0 {
			if loc := reAddr2.FindStringIndex(text[i:]); loc != nil {
				n = loc[1]
			}
		}
		if n == 0 {
			if loc := reAddr3.FindStringIndex(text[i:]); loc != nil {
				n = loc[1]
			}
		}
		if n == 0 {
			if m := reAddr4.FindStringSubmatchIndex(text[i:]); m != nil {
				n = m[2] // the match without the one character that showed no letter follows
			}
		}
		if n > 0 {
			out.WriteString("[address]")
			i += n
			continue
		}
		_, w := utf8.DecodeRuneInString(text[i:])
		out.WriteString(text[i : i+w])
		i += w
	}
	return out.String()
}

// CleanQuestion is the buyer's words made fit to send to a model: numbers, e-mail addresses, links and names after "my name is", then exact addresses, then cut to 200 characters. What is
// taken out is replaced by a bracketed word, which stripMarks removes again for the search words.
func CleanQuestion(text string) string {
	first := understanding.Redact(language.UTF16SliceFFFD(language.NFC(text), 600))
	s := replaceAddresses(first)
	s = language.TrimJS(reWS.ReplaceAllString(s, " "))
	return language.UTF16SliceFFFD(s, MaxQuestion)
}

var reMarks = regexp.MustCompile(`\[(?:address|number|name|link)\]`)

func stripMarks(t string) string { return reMarks.ReplaceAllString(t, " ") }
