// The Money section of the owner's app, as one HTML fragment (modules/accounting/owner-money-render.ts). The figures are accounting.MoneyView, the words accounting.Owner. Phone first, and only the
// page's own look: the cards, stamps and big `.amt` figures of the customer pages' style sheet (`.item`, `.top`, `.stamp`, `.amt`, `.calm`, `.row`, `.btn.quiet`, `.note`, `.machine`), so it
// needs no style and no script. Every value goes through esc. Amounts are written from integer paise, whole rupees without decimals, with Indian grouping (inr).
package render

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	lang "github.com/GeometerLabs/agents/go/internal/language" // its parameters are named "language", as owner-money-render.ts's are
	"github.com/GeometerLabs/agents/go/internal/slots"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// ExportLinks says where the accountant's files are: `Base` is the owner app's accounting address, and a period's files are at `<Base>/<period>/<file name>`. A nil *ExportLinks (the panel's
// link page has no signed-in session) shows no download card.
type ExportLinks struct{ Base string }

// inr is owner-money-render.ts `inr`: "₹1,200", or "₹1,200.50" when the paise are not whole rupees, by integer arithmetic (the whole rupees are format.ts formatInr's text).
// `Math.trunc(paise / 100)` of a negative amount under one rupee is -0, which toLocaleString writes "-0", so that case is copied ("₹-0.50").
func inr(paise int64) string {
	rupees, rest := paise/100, paise%100 // Go truncates towards zero, as Math.trunc does
	if rest < 0 {
		rest = -rest
	}
	text := lang.FormatInrWhole(rupees)
	if rupees == 0 && paise < 0 {
		text = "₹-0"
	}
	if rest == 0 {
		return text
	}
	return fmt.Sprintf("%s.%02d", text, rest)
}

// OwnerMoneySection is ownerMoneySection.
func OwnerMoneySection(view accounting.MoneyView, language string, links *ExportLinks, timeZone string) string {
	w := accounting.Owner(language)
	ref := func(c *string) string {
		if c == nil {
			return w.ACase
		}
		return *c
	}
	fig := func(tone, label string, paise int64, note string) string {
		n := ""
		if note != "" {
			n = `<p class="note">` + esc(note) + `</p>`
		}
		return `<div class="item s-` + esc(tone) + `"><div class="top"><span class="stamp">` + esc(label) + `</span><span class="amt">` + esc(inr(paise)) + `</span></div>` + n + `</div>`
	}
	m := view.Month
	var owed string
	if len(view.OwedBack) == 0 {
		owed = `<p class="calm">` + esc(w.OwedNone) + `</p>`
	} else {
		var b strings.Builder
		for _, o := range view.OwedBack {
			tpl := w.OwedService
			if o.Why == "owner_pays_upi" {
				tpl = w.OwedUpi
			}
			b.WriteString(`<div class="item s-wait"><div class="top"><span class="amt">` + esc(inr(o.Paise)) + `</span></div><p>` + esc(slots.Fill(tpl, ref(o.Case))) + `</p></div>`)
		}
		owed = b.String()
	}
	sentence := func(n accounting.NotMatched) string {
		switch n.Kind {
		case "upi_claim":
			return slots.Fill(w.UpiClaim, inr(n.Paise), ref(n.Case))
		case "gateway":
			p := zone.LocalParts(n.SinceMs, timeZone)
			return slots.Fill(w.Gateway, inr(n.Paise), ref(n.Case), lang.Formats(language).Date(p.Date.Year, p.Date.Month, p.Date.Day))
		case "gateway_held":
			return slots.Fill(w.GatewayHeld, inr(n.Paise), ref(n.Case))
		case "not_through_assistant":
			return slots.Fill(w.NotThrough, inr(n.Paise))
		case "untold_refund":
			return slots.Fill(w.Untold, inr(n.Paise), ref(n.Case))
		}
		return ""
	}
	// "everything is matched" only when it is known: a shop with online money it does not check against the bank is told that instead
	unchecked := ""
	if view.PayoutsUnchecked {
		unchecked = `<div class="item s-info"><p>` + esc(w.PayoutsUnchecked) + `</p></div>`
	}
	var unmatched string
	if len(view.NotMatched) == 0 {
		if view.PayoutsUnchecked {
			unmatched = unchecked
		} else {
			unmatched = `<p class="calm">` + esc(w.NotMatchedNone) + `</p>`
		}
	} else {
		var b strings.Builder
		b.WriteString(unchecked)
		for _, n := range view.NotMatched {
			b.WriteString(`<div class="item s-info"><p>` + esc(sentence(n)) + `</p></div>`)
		}
		unmatched = b.String()
	}
	// the three periods come from the month the runtime says it is (view.Period), so the links, their labels and the front's allowed set all follow one clock
	periods := accounting.ExportPeriods(view.Period)
	rows := func() string {
		py, pm := 0, 0
		ys, ms, _ := strings.Cut(view.Period, "-")
		py, _ = strconv.Atoi(ys)
		pm, _ = strconv.Atoi(ms)
		row := func(label, period string) string {
			names, extra := accounting.ExportNamesOf(period), accounting.ExtraNamesOf(period)
			file := func(name, text string) string {
				return `<a class="btn quiet" href="` + esc(links.Base) + `/` + esc(period) + `/` + esc(name) + `">` + esc(text) + `</a>`
			}
			// the settlements file exists only for a shop that reads settlements; the two Tally files are best effort (the export leaves them out, and says why in the README, when they
			// cannot be made, so their link is then a plain not-found while the CSV files are always there)
			s := ""
			if view.ReadsSettlements {
				s = file(extra.Settlements, w.FileSettlements)
			}
			return `<p><b>` + esc(label) + `</b></p><div class="row">` + file(names.Journal, w.FileJournal) + file(names.Documents, w.FileDocuments) + s + file(extra.TallyMasters, w.FileTallyMasters) + file(extra.TallyVouchers, w.FileTallyVouchers) + file(names.Readme, w.FileReadme) + `</div>`
		}
		// the WhatsApp link carries the words only, never a file or a customer: the accountant is asked for, the files are sent from the downloads above
		share := "https://wa.me/?text=" + encodeURIComponent(slots.Fill(w.ShareText, monthName(language, pm)+" "+strconv.Itoa(py)))
		return row(w.ThisMonth, periods.ThisMonth) + row(w.LastMonth, periods.LastMonth) + row(slots.Fill(w.ThisYear, periods.Year), periods.Year) +
			`<p><a class="btn quiet" href="` + esc(share) + `" rel="noopener">` + esc(w.ShareWhatsapp) + `</a></p>`
	}
	var b strings.Builder
	b.WriteString(`<section class="money" lang="` + esc(language) + `">` + "\n")
	b.WriteString(`<h2>` + esc(w.Title) + `</h2>` + "\n")
	if w.Machine != nil && *w.Machine != "" {
		b.WriteString(`<p class="machine">` + esc(*w.Machine) + `</p>`)
	}
	b.WriteString("\n<h3>" + esc(w.Today) + "</h3>\n")
	b.WriteString(fig("ok", w.Received, view.Today.Received.Paise, w.Payments.Fill(view.Today.Received.Count)) + "\n")
	b.WriteString(fig("info", w.GivenBack, view.Today.GivenBack.Paise, w.Refunds.Fill(view.Today.GivenBack.Count)) + "\n")
	b.WriteString("<h3>" + esc(w.Month) + "</h3>\n")
	b.WriteString(fig("ok", w.Received, m.Received.Paise, w.Payments.Fill(m.Received.Count)) + "\n")
	b.WriteString(fig("info", w.GivenBack, m.GivenBack.Paise, w.Refunds.Fill(m.GivenBack.Count)) + "\n")
	if m.KeptPaise != 0 {
		b.WriteString(fig("plain", w.Kept, m.KeptPaise, ""))
	}
	b.WriteString("\n")
	if m.GatewayChargesPaise != 0 {
		b.WriteString(fig("plain", w.Charges, m.GatewayChargesPaise, ""))
	}
	b.WriteString("\n")
	if m.StillToCome != nil {
		b.WriteString(fig("wait", w.StillToCome, m.StillToCome.Paise, w.Fees.Fill(m.StillToCome.Count)))
	}
	b.WriteString("\n")
	if len(view.ByWord) > 0 {
		b.WriteString(`<div class="item s-plain"><p><b>` + esc(w.ByWordTitle) + `</b></p>`)
		for _, x := range view.ByWord {
			b.WriteString(`<p>` + esc(slots.Fill(w.ByWordRow, inr(x.Paise), ref(x.Case))) + `</p>`)
		}
		b.WriteString(`</div>`)
	}
	b.WriteString("\n<h3>" + esc(w.OwedTitle) + "</h3>\n" + owed + "\n<h3>" + esc(w.NotMatchedTitle) + "</h3>\n" + unmatched + "\n")
	if links != nil {
		b.WriteString(`<div class="card"><h3>` + esc(w.AccountantTitle) + `</h3><p class="note">` + esc(w.AccountantNote) + `</p>` + rows() + `</div>`)
	}
	b.WriteString("\n" + `<p class="note">` + esc(w.Scope) + `</p>` + "\n</section>")
	return b.String()
}

// monthName is MONTH_NAMES[language][month - 1] (month 1 to 12).
func monthName(language string, month int) string { return lang.Formats(language).Months[month-1] }
