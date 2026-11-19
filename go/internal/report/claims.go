// The claim rules, kept as DATA for the tests: modules/report/claims.ts. A document counts and states facts; it never grades. BANNED lists, per language, the words no document may
// contain (safe, guaranteed, certified, earnings and their translations). The patterns are the TypeScript's own (words.go, from scripts/gen_report_words.ts), compiled with RE2:
// every one is plain (no look-around, no back-reference), `i` becomes (?i) and `u` is Go's default. One difference to know: Go's (?i) also folds U+017F (long s) to "s" and U+212A (Kelvin
// sign) to "k", which JavaScript's non-unicode /i does not, so a text holding those two characters could be flagged here and not there. Nothing sends such a text.
package report

import (
	"regexp"
	"strings"
	"sync"
)

type bannedPattern struct {
	source string
	re     *regexp.Regexp
}

var (
	bannedOnce sync.Once
	banned     map[string][]bannedPattern
)

func loadBanned() map[string][]bannedPattern {
	bannedOnce.Do(func() {
		banned = map[string][]bannedPattern{}
		for lang, list := range loadWords().Banned {
			for _, p := range list {
				expr := p.Source
				if strings.Contains(p.Flags, "i") {
					expr = "(?i)" + expr
				}
				banned[lang] = append(banned[lang], bannedPattern{p.Source, regexp.MustCompile(expr)})
			}
		}
	})
	return banned
}

// BannedIn is bannedIn: the banned words found in a text written in a language (pass each language of a "both" report). Empty means none. The results are the patterns' sources.
func BannedIn(text, lang string) []string {
	b := loadBanned()
	var found []string
	for _, p := range append(append([]bannedPattern{}, b["any"]...), b[lang]...) {
		if p.re.MatchString(text) {
			found = append(found, p.source)
		}
	}
	return found
}
