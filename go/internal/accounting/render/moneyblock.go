// The "Money this month" block of a monthly report page: a few bold figures from the signed books summary, in plain words, in four languages (modules/accounting/report-block.ts). Bookings,
// Orders and Fees show the same four or five figures, so the markup lives here once and a template's report takes accounting.BlockWords(language) as its words. The figures are read from the
// summary only, by kind of money fact and the closing balances, so no account name reaches the owner's page.
package render

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// BlockOptions is moneyBlock's options: ToCome (a template that bills in advance, Fees, also shows what is still to come in) and BooksOnly (under the cards, a line for each kind of money the block
// counts and the report's rows above do not: a payment made twice, the owner's own marks), nil for none.
type BlockOptions struct {
	ToCome    bool
	BooksOnly *accounting.BooksOnly
}

// MoneyBlock is moneyBlock: the block as HTML for the report page. What is shown: received and given back always; what the shop kept only when something was; refunds settled on someone's
// word only when there were some, and never inside "given back"; what is still owed back always (a plain zero is an answer).
func MoneyBlock(summary accounting.AccountingSummary, words *accounting.MoneyBlockWords, o BlockOptions) string {
	paiseOf := func(kind string) int64 {
		for _, k := range summary.ByKind {
			if k.Kind == kind {
				return k.Paise
			}
		}
		return 0
	}
	card := func(label string, paise int64) string {
		return `<div class="card">` + report.Fig(inr(paise)) + `<span>` + esc(label) + `</span></div>`
	}
	cards := []string{card(words.Received, paiseOf("received")), card(words.GivenBack, paiseOf("refund_made")-summary.ByWord.Paise)}
	if paiseOf("kept") > 0 {
		cards = append(cards, card(words.Kept, paiseOf("kept")))
	}
	if summary.ByWord.Paise > 0 {
		cards = append(cards, card(words.ByWord, summary.ByWord.Paise))
	}
	cards = append(cards, card(words.OwedBack, summary.Closing.RefundsOwedPaise))
	if o.ToCome {
		cards = append(cards, card(words.ToCome, max(0, summary.Closing.ReceivablePaise)))
	}
	// why the block differs from the rows above it, one line for each kind of money the rows leave out
	var why strings.Builder
	if b := o.BooksOnly; b != nil {
		for _, x := range []struct {
			line  string
			paise int64
		}{{words.PaidTwice, b.PaidTwicePaise}, {words.MarkedReceived, b.MarkedReceivedPaise}, {words.MarkedGivenBack, b.MarkedGivenBackPaise}} {
			if x.paise > 0 {
				// String.replace with a string pattern replaces the first "{amount}" only
				why.WriteString(`<p class="small">` + esc(strings.Replace(x.line, "{amount}", inr(x.paise), 1)) + `</p>`)
			}
		}
	}
	return `<h2>` + esc(words.Heading) + `</h2><div class="cards">` + strings.Join(cards, "") + `</div>` + why.String()
}
