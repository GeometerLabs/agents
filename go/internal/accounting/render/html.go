// Package render is the books' HTML: the owner's Money section (modules/accounting/owner-money-render.ts), the "Money this month" block of a report page (report-block.ts) and a customer's
// document page (document-page.ts). It is a package of its own because the report package imports the books for the record's entry type, so the books cannot import the report's escaping
// (esc and fig, modules/report/page.ts) without an import cycle; this package imports both and so reuses report.Esc and report.Fig with no copy.
//
// How the TypeScript's `html` tagged template (modules/core/html.ts) is written here: it escapes every interpolated value unless it is markup built by another html“ call (a Raw), joins
// arrays and shows null, undefined and false as nothing. In Go the markup around the values is written as plain string concatenation, and every value that was a plain value there goes through
// esc here (report.Esc: & < > " and ' as &#39;), while a Raw stays a plain string. A page's number is written with strconv as `${n}` does.
package render

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/report"
)

// esc is html.ts esc (modules/report/page.ts): the one door for a value into a page.
func esc(s string) string { return report.Esc(s) }

const hex = "0123456789ABCDEF"

// encodeURIComponent is JavaScript's: every character except A-Z a-z 0-9 - _ . ! ~ * ' ( ) is written as %XX of its UTF-8 bytes (upper-case hex). Neither url.QueryEscape (which turns a space
// into "+") nor url.PathEscape (which keeps more characters) is the same.
func encodeURIComponent(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', strings.IndexByte("-_.!~*'()", c) >= 0:
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}
