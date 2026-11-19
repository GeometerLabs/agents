package understanding

// Personal details taken out of words before ANY model sees them (modules/understanding/redact.ts): e-mail addresses, links, phone numbers (ten digits or more in any of the four
// scripts, separators not counted) and the word after a way of introducing oneself ("my name is Ravi", "मेरा नाम रवि", "എന്റെ പേര് രവി", "ನನ್ನ ಹೆಸರು ರವಿ"), with a second only when it
// is a capitalised Latin word. The patterns are redact.ts's own sources (language, patterns.json), matched as JavaScript matches them (the name pattern's look-behind is checked by
// hand).

import (
	"strings"
	"unicode"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// Redact is redact.ts `redact` with no known names: the words with the details replaced by [address], [link], [number] and [name].
func Redact(text string) string {
	text = language.P("redact.email").Replace(text, "[address]")
	text = language.P("redact.link").Replace(text, "[link]")
	text = language.P("redact.phone").ReplaceFunc(text, func(m *language.Match) string {
		n := 0
		for _, r := range m.Group(0) {
			if unicode.Is(unicode.Nd, r) {
				n++
			}
		}
		if n < 10 {
			return m.Group(0)
		}
		return "[number]"
	})
	var out strings.Builder
	last := 0
	for _, m := range language.P("redact.name").All(text) {
		end := m.End()
		if s := language.P("redact.surname").Find(text[end:]); s != nil {
			end += s.End()
		}
		if m.Start() > last { // JavaScript's slice(last, index) is "" when the index is before last (a match inside the surname just taken)
			out.WriteString(text[last:m.Start()])
		}
		out.WriteString(m.Group(1) + " [name]")
		last = end
	}
	out.WriteString(text[last:])
	return out.String()
}
