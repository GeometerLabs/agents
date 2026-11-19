// The page every report and certificate is printed on, for every template: modules/report/page.ts. One file, inline CSS, no script, no external font or image, a content policy that
// forbids everything else, and "What this checks" (whatthischecks.go) inside every section. Every value that reaches the page is escaped by the caller with Esc. The style sheet is
// the TypeScript's own text, taken from it by scripts/gen_report_words.ts (words.go), so the two runtimes print the same page byte for byte.
package report

import (
	"regexp"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/qr"
)

// Esc is esc: the one door for text into the page. The same five replacements, in the same order (& first).
func Esc(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	value = strings.ReplaceAll(value, `"`, "&quot;")
	return strings.ReplaceAll(value, "'", "&#39;")
}

// Fig is fig: a figure in a table cell or card, <strong> so it stands out from its label; empty stays empty. The value is escaped here. (The TypeScript also takes a number: write it
// with strconv first.)
func Fig(value string) string {
	if value == "" {
		return ""
	}
	return "<strong>" + Esc(value) + "</strong>"
}

var sectionLang = regexp.MustCompile(`^<section[^>]*\blang="(en|hi|ml|kn)"`)

// withWhatThisChecks adds "What this checks" as the last block of a section, in that section's language (the `lang` its opening tag names, else the page's).
func withWhatThisChecks(section, pageLanguage string) string {
	lang := pageLanguage
	if m := sectionLang.FindStringSubmatch(section); m != nil {
		lang = m[1]
	}
	end := strings.LastIndex(section, "</section>")
	if end < 0 {
		return section
	}
	return section[:end] + WhatThisChecksBlock(lang) + section[end:]
}

// Page is page: a whole page around one or more language sections.
func Page(title, lang string, sections []string) string {
	withBlocks := make([]string, len(sections))
	for i, s := range sections {
		withBlocks[i] = withWhatThisChecks(s, lang)
	}
	return `<!doctype html>
<html lang="` + lang + `">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>` + Esc(title) + `</title>
<style>` + loadWords().CSS + `</style>
</head>
<body>
<main>
` + strings.Join(withBlocks, "\n") + `
</main>
</body>
</html>
`
}

// TableHead is one column heading; N says the column holds numbers (right-aligned).
type TableHead struct {
	Text string
	N    bool
}

// Table is table: cells are passed in already escaped (they may hold markup such as a line break), so the caller owns escaping; the head is escaped here.
func Table(head []TableHead, rows [][]string) string {
	var b strings.Builder
	b.WriteString(`<div class="tablewrap"><table><thead><tr>`)
	for _, h := range head {
		b.WriteString("<th")
		if h.N {
			b.WriteString(` class="n"`)
		}
		b.WriteString(">" + Esc(h.Text) + "</th>")
	}
	b.WriteString("</tr></thead><tbody>")
	for _, r := range rows {
		b.WriteString("<tr>")
		for i, c := range r {
			b.WriteString("<td")
			if i < len(head) && head[i].N {
				b.WriteString(` class="n"`)
			}
			b.WriteString(">" + c + "</td>")
		}
		b.WriteString("</tr>")
	}
	b.WriteString("</tbody></table></div>")
	return b.String()
}

// List is list: items are escaped here, unlike table cells, because a list item is always plain text.
func List(items []string) string {
	var b strings.Builder
	b.WriteString("<ul>")
	for _, i := range items {
		b.WriteString("<li>" + Esc(i) + "</li>")
	}
	b.WriteString("</ul>")
	return b.String()
}

// SealWords are the words the verification block needs; every template's strings carry them under `page`. ScanSummary is what a paper with a signed summary in its link says instead
// of ScanToCheck; "" means left out (ScanToCheck is used for both; the TypeScript's undefined, which an empty string cannot be told apart from here).
type SealWords struct {
	CheckHeading, Code, Digest, SignedBy, NotSigned, SignatureNote, ScanToCheck, ScanSummary string
}

// SealBlock is sealBlock: the verification block every report and certificate carries: the code, the full digest, the QR and the link, and what a signature does and does not show.
// extra rows come before the digest row. summaryLink ("" when there is none) is the paper's signed summary link, given only for a signed paper: with it the QR and the printed link
// carry the summary, the QR is drawn larger, and the link can be tapped (opening with no referrer). Without it the older #digest link is printed.
func SealBlock(words SealWords, envelope Envelope, extra [][2]string, summaryLink string) (string, error) {
	rows := append(append([][2]string{}, extra...), [2]string{words.Digest, envelope.Digest})
	scan := words.ScanToCheck
	if summaryLink != "" && words.ScanSummary != "" {
		scan = words.ScanSummary
	}
	var qrHTML, link string
	if summaryLink != "" {
		svg, err := qr.TextSvg(summaryLink, qr.SvgOptions{Label: scan})
		if err != nil {
			return "", err
		}
		qrHTML = `<div class="qr wide">` + svg + `</div>`
		link = `<div class="mono"><a href="` + Esc(summaryLink) + `" rel="noreferrer">` + Esc(summaryLink) + `</a></div>`
	} else {
		svg, err := VerifyQrSvg(envelope.Digest, scan, "")
		if err != nil {
			return "", err
		}
		l, _ := VerifyLink(envelope.Digest, "")
		qrHTML = `<div class="qr">` + svg + `</div>`
		link = `<div class="mono">` + Esc(l) + `</div>`
	}
	signer := words.NotSigned
	if envelope.Signature != nil {
		signer = envelope.Signature.KeyID
	}
	var dl strings.Builder
	for _, r := range rows {
		dl.WriteString("<dt>" + Esc(r[0]) + `</dt><dd class="mono">` + Esc(r[1]) + "</dd>")
	}
	dl.WriteString("<dt>" + Esc(words.SignedBy) + `</dt><dd class="mono">` + Esc(signer) + "</dd>")
	return "<h2>" + Esc(words.CheckHeading) + `</h2>
<div class="seal">` + qrHTML + `<div class="words"><div class="small">` + Esc(words.Code) + `</div><div class="code">` + Esc(envelope.Code) + `</div>` + link + `<p class="small">` + Esc(scan) + `</p></div></div>
<dl>` + dl.String() + `</dl>
<p class="small">` + Esc(words.SignatureNote) + `</p>`, nil
}
