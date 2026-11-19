// A customer's document (receipt, bill, bill of supply, refund note) as one HTML page (modules/accounting/document-page.ts): phone first, in the customer's language with the fixed fields (title,
// number, date, amount) also in English beside it so an accountant can read any document, and a print stylesheet so the phone's own "Print / Save as PDF" makes the PDF. It runs NO script and loads
// nothing. It reuses the customer pages' style sheet (CUSTOMER_CSS of modules/channels/look.ts) and the page's machine-written note (PAGE[language].machine of modules/channels/words.ts), both
// carried from the TypeScript by scripts/gen_books_words.ts and not retyped, and its own DOC_CSS (the screen additions and the print sheet), which that script takes from the TypeScript as well.
// What it draws is an accounting.Document; the escaping is report.Esc's, so a shop named <script> is text. A JavaScript `${}` of a plain value is esc here.
package render

import (
	"errors"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/locale"
	"github.com/GeometerLabs/agents/go/internal/slots"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// errBadTime is what JavaScript's Intl throws for a time it cannot read (RangeError).
var errBadTime = errors.New("Invalid time value")

// englishDate is the date as "15 Nov 2026": the English fixed field, written the same in every language.
func englishDate(ms int64, tz string) string {
	p := zone.LocalParts(ms, tz)
	return strconv.Itoa(p.Day) + " " + locale.Month("en", p.Month) + " " + strconv.Itoa(p.Year)
}

// DocumentPage is documentPage: the whole page for one document. A time the document carries that cannot be read, or an amount that is not whole paise, is the TypeScript's thrown error.
func DocumentPage(d accounting.Document) (string, error) {
	w := accounting.Doc(d.Language)
	en := accounting.Doc("en")
	ms, ok := accounting.ParseISO(d.At)
	if !ok {
		return "", errBadTime
	}
	both := d.Language != "en"
	// a fixed field's label: in the customer's language, with the English one beneath it when that differs
	label := func(local, english string) string {
		s := esc(local)
		if both {
			s += `<span class="en" lang="en">` + esc(english) + `</span>`
		}
		return s
	}
	refund := d.Kind == "refund_note"
	how := ""
	if d.Evidence != "" {
		if d.Evidence == "owner_mark" && refund {
			how = w.OwnerMarkRefund
		} else {
			how = w.Evidence[d.Evidence]
		}
	}
	when := zone.LocalParts(ms, d.TimeZone)
	dateText := locale.FormatDate(when.Date, d.Language) + " " + strconv.Itoa(when.Year) + ", " + locale.FormatTime(when.Hour, when.Minute, d.Language)
	citeDate := func(iso string) (string, error) {
		t, ok := accounting.ParseISO(iso)
		if !ok {
			return "", errBadTime
		}
		p := zone.LocalParts(t, d.TimeZone)
		return locale.FormatDate(p.Date, d.Language) + " " + strconv.Itoa(p.Year), nil
	}
	title := w.Title[d.Kind] + " " + d.Number
	amount, err := accounting.FormatPaise(d.AmountPaise)
	if err != nil {
		return "", err
	}
	machine := accounting.MachineNote(d.Language)

	s := `<!doctype html><html lang="` + esc(d.Language) + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#e2f2e9">` + "\n"
	s += `<title>` + esc(title) + ` - ` + esc(d.Shop.Name) + `</title><style>` + accounting.CustomerCSS() + accounting.DocCSS() + `</style></head>` + "\n"
	s += `<body><header class="head"><div class="wrap"><h1>` + esc(d.Shop.Name) + `</h1></div></header>` + "\n"
	s += `<main class="wrap">`
	if machine != "" {
		s += `<p class="machine">` + esc(machine) + `</p>`
	}
	s += "\n" + `<article class="card doc">` + "\n"
	if d.Legend {
		leg := esc(w.Legend)
		if both {
			leg += `<span class="en" lang="en">` + esc(en.Legend) + `</span>`
		}
		s += `<p class="legend">` + leg + `</p>`
	}
	s += "\n" + `<h1>` + label(w.Title[d.Kind], en.Title[d.Kind]) + `</h1>` + "\n"
	note := esc(d.Shop.Name)
	if d.Shop.Address != "" {
		note += `<br>` + esc(d.Shop.Address)
	}
	if d.Shop.Phone != "" {
		note += `<br>` + esc(w.Phone) + `: ` + esc(d.Shop.Phone)
	}
	s += `<p class="note">` + note + `</p>` + "\n"
	s += `<dl>` + "\n"
	s += `<dt>` + label(w.Number, en.Number) + `</dt><dd>` + esc(d.Number) + `</dd>` + "\n"
	dd := esc(dateText)
	if both {
		dd += `<span class="en" lang="en">` + esc(englishDate(ms, d.TimeZone)) + `</span>`
	}
	s += `<dt>` + label(w.Date, en.Date) + `</dt><dd>` + dd + `</dd>` + "\n"
	s += `<dt>` + label(w.AmountLabel[d.Kind], en.AmountLabel[d.Kind]) + `</dt><dd class="amount">` + esc(amount) + `</dd>` + "\n"
	if d.WhatFor != "" {
		s += `<dt>` + esc(w.ForLabel) + `</dt><dd>` + esc(d.WhatFor) + `</dd>`
	}
	s += "\n"
	if d.Person != "" {
		s += `<dt>` + esc(w.Person) + `</dt><dd>` + esc(d.Person) + `</dd>`
	}
	s += "\n"
	if d.Cites != nil {
		cd, err := citeDate(d.Cites.At)
		if err != nil {
			return "", err
		}
		s += `<dd>` + esc(slots.Fill(w.Cites, d.Cites.Number, cd)) + `</dd>`
	}
	s += "\n"
	if d.Method != "" {
		s += `<dt>` + esc(w.PaidBy) + `</dt><dd>` + esc(w.Method[d.Method]) + `</dd>`
	}
	s += "\n"
	if how != "" {
		s += `<dt>` + esc(w.HowKnown) + `</dt><dd>` + esc(how) + `</dd>`
	}
	s += "\n" + `</dl>` + "\n"
	s += `<p class="made">` + esc(slots.Fill(w.Footer, d.Shop.Name)) + `</p>` + "\n"
	s += `</article>` + "\n"
	s += `<p class="note noprint">` + esc(w.PrintHint) + `</p>` + "\n"
	s += `</main></body></html>`
	return s, nil
}
