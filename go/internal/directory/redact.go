// Before a buyer's words go to ANY model, phone numbers, e-mail addresses, links and names are taken out (modules/understanding/redact.ts; this is the part of it the directory uses: the
// directory never knows a buyer's name, so there is no list of known names), and then exact addresses (modules/discovery/assistant.ts cleanQuestion). Phone numbers go by their shape:
// any run of 10 or more digits (with spaces, dots, dashes or brackets between), in Latin, Devanagari, Malayalam or Kannada digits. Names cannot be found by shape: what goes is the word
// after a way of introducing oneself ("my name is Ravi", "मेरा नाम रवि", "എന്റെ പേര് രവി", "ನನ್ನ ಹೆಸರು ರವಿ"), and a second only when it is a capitalised Latin word.
//
// Go's regular expressions (RE2) have no look-behind and no look-ahead, and `\s` is ASCII only, where JavaScript's is the Unicode white space: the patterns below spell the white space out
// (jsWS), and the look-arounds the TypeScript uses are done by hand at the edge of a match (notAfterLetter, and a trailing group that takes one character and gives it back).
package directory

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// jsWS is the characters JavaScript's `\s` matches, as the inside of a character class.
const jsWS = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

const digits = `0-9०-९൦-൯೦-೯`

var (
	rePhone   = regexp.MustCompile(`\+?\(?[` + digits + `][` + digits + jsWS + `().\-]{8,}[` + digits + `]`)
	reEmail   = regexp.MustCompile(`[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}`)
	reLink    = regexp.MustCompile(`(?i)\b(?:https?://|www\.)[^` + jsWS + `]+`)
	reIntro   = regexp.MustCompile(`(?i)(?:my[` + jsWS + `]+name[` + jsWS + `]+is|name[` + jsWS + `]+is|name[` + jsWS + `]*[:-]|myself|mera[` + jsWS + `]+naam|mera[` + jsWS + `]+name|naam|मेरा[` + jsWS + `]+नाम|नाम|എന്റെ[` + jsWS + `]+പേര്|എൻ്റെ[` + jsWS + `]+പേര്|പേര്|ನನ್ನ[` + jsWS + `]+ಹೆಸರು|ಹೆಸರು)[` + jsWS + `]+[\p{L}\p{M}][\p{L}\p{M}.'-]*`)
	reSurname = regexp.MustCompile(`^[` + jsWS + `]+[A-Z][a-z.'-]*`)
)

func isLM(r rune) bool { return unicode.IsLetter(r) || unicode.IsMark(r) }

// notAfterLetter is the look-behind `(?<![\p{L}\p{M}])` at byte offset i of s.
func notAfterLetter(s string, i int) bool {
	if i == 0 {
		return true
	}
	r, _ := utf8.DecodeLastRuneInString(s[:i])
	return !isLM(r)
}

// redact takes the personal details out of a message before a model sees it.
func redact(text string) string {
	text = reEmail.ReplaceAllString(text, "[address]")
	text = reLink.ReplaceAllString(text, "[link]")
	// ten digits or more, separators not counted: a date written "15-11-2026" (eight digits) stays, and a mobile or landline number goes
	text = rePhone.ReplaceAllStringFunc(text, func(m string) string {
		n := 0
		for _, r := range m {
			if unicode.Is(unicode.Nd, r) {
				n++
			}
		}
		if n < 10 {
			return m
		}
		return "[number]"
	})
	var out strings.Builder
	last, pos := 0, 0
	for pos < len(text) {
		loc := reIntro.FindStringIndex(text[pos:])
		if loc == nil {
			break
		}
		start, end := pos+loc[0], pos+loc[1]
		if !notAfterLetter(text, start) { // the look-behind failed here: look again from the next character
			_, w := utf8.DecodeRuneInString(text[start:])
			pos = start + w
			continue
		}
		// the intro words as written, then the name taken out: the match is "<intro> <name>", and the intro is everything up to the last white space before the name
		m := text[start:end]
		cut := strings.LastIndexFunc(m, isJSSpace)
		intro := strings.TrimRightFunc(m[:cut], isJSSpace)
		if s := reSurname.FindString(text[end:]); s != "" {
			end += len(s)
		}
		out.WriteString(text[last:start] + intro + " [name]")
		last, pos = end, end
	}
	return out.String() + text[last:]
}

// ---- cleaning the buyer's words (assistant.ts cleanQuestion) ----

const numClass = `[` + digits + `]`

var (
	reAddr1 = regexp.MustCompile(`(?i)^(?:house|door|flat|plot|h\.?[` + jsWS + `]?no|d\.?[` + jsWS + `]?no|no)\.?[` + jsWS + `]*[:#-]?[` + jsWS + `]*` + numClass + `[\p{L}\p{N}/-]*`)
	reAddr2 = regexp.MustCompile(`(?i)^(?:घर|वीट|വീട്|ಮನೆ)[` + jsWS + `]*(?:नंबर|नं\.?|നമ്പർ|ಸಂಖ್ಯೆ)?[` + jsWS + `]*` + numClass + `+[\p{L}\p{N}/-]*`)
	reAddr3 = regexp.MustCompile(`(?i)^` + numClass + `+[` + jsWS + `]*/[` + jsWS + `]*` + numClass + `+[A-Za-z]?`)
	reAddr4 = regexp.MustCompile(`(?i)^(?:[\p{L}\p{M}.'-]+[` + jsWS + `]+){1,2}(?:road|street|lane|cross|colony|layout|nagar|apartments?|enclave|marg|रोड|गली|कॉलोनी|റോഡ്|ലെയ്ൻ|ರಸ್ತೆ|ಬಡಾವಣೆ)([^\p{L}\p{M}]|$)`)
	reWS    = regexp.MustCompile(`[` + jsWS + `]+`)
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
	first := redact(sliceUTF16(nfc(text), 600))
	s := replaceAddresses(first)
	s = jsTrim(reWS.ReplaceAllString(s, " "))
	return sliceUTF16(s, MaxQuestion)
}

var reMarks = regexp.MustCompile(`\[(?:address|number|name|link)\]`)

func stripMarks(t string) string { return reMarks.ReplaceAllString(t, " ") }
