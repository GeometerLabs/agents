// "What this checks" (plan B67): modules/report/what-this-checks.ts. The same three lines on every report, certificate and paper, in the shop's language, added by Page so no paper
// can leave it out. The words are the TypeScript's (words.go); the Hindi, Malayalam and Kannada are machine-written there and wait for a native reader.
package report

import "strings"

// WhatThisChecksBlock is whatThisChecksBlock: the block as page HTML, a heading and three term/description pairs (the page's own style sheet draws it; no script, no link).
func WhatThisChecksBlock(lang string) string {
	w := loadWords().WhatThisChecks[lang]
	var b strings.Builder
	b.WriteString(`<aside class="what"><h2>` + Esc(w.Heading) + `</h2><dl>`)
	for _, l := range w.Lines {
		b.WriteString("<dt>" + Esc(l[0]) + "</dt><dd>" + Esc(l[1]) + "</dd>")
	}
	b.WriteString("</dl></aside>")
	return b.String()
}
