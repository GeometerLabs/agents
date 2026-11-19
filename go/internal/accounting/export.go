// The accountant's files, as strings (modules/accounting/export.ts): journal-<period>.csv (one row per journal line), documents-<period>.csv (every document number, and the numbers skipped) and
// README.txt, and for a shop whose payment service settles into its bank: settlements-<period>.csv (one row per settlement) and, best effort, the two TallyPrime import files (tally.go). A period is
// a month ("2026-11") or an Indian financial year ("26-27"), cut in the shop's time zone (periods.go). CSV is the guaranteed way in for any accountant's tool.
//
// Why these choices (the TypeScript's, kept): amounts are written from integer paise by integer arithmetic ("1234567.89"), never through a float; quoting is RFC 4180 (a field with a comma,
// quote, CR or LF is quoted, quotes doubled; rows end CRLF); the files carry accounting words because their reader is an accountant; privacy: a row names a case id and a provider's payment or
// refund id, never a customer's number or a student's name (the record's own `conversation` is not read at all), and a case ref that looks like a phone number is dropped.
//
// Where Go differs from JavaScript: `Date.parse` is ParseISO (a time it cannot read is NaN there, so a line with one is never in a period; here it is left out of every range the same way);
// `x.id.localeCompare(y.id)` in the settlements sort is golang.org/x/text/collate with the English tailoring (the same approach as internal/listings/stock.go); a Map's insertion order is kept
// in order slices; a settlement ref that is missing prints as JavaScript's `undefined`, as the TypeScript's CSV does; `String(n)` of a count is strconv.
package accounting

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// ExportFile is export.ts ExportFile.
type ExportFile struct{ Name, Content string }

// ExportInput is export.ts ExportInput. Tally non-nil (even empty) makes the two best-effort Tally files. OldDueOf (Fees only) says a record entry belongs to an old due and which month ("" for none).
type ExportInput struct {
	Journal  *Journal
	Entries  []Entry
	Period   string
	TimeZone string
	Tally    *TallyOptions
	OldDueOf func(Entry) string
}

// OldDueNote is oldDueNote: the plain words an accountant reads beside a line that belongs to an old due. English only, like the rest of these files.
func OldDueNote(month string) string { return "old due " + month }

// Rupees is rupees: rupees with exactly 2 decimals from integer paise, by integer arithmetic.
func Rupees(paise int64) (string, error) {
	if paise < -9007199254740991 || paise > 9007199254740991 {
		return "", fmt.Errorf("%d is not a whole number of paise", paise)
	}
	abs := paise
	sign := ""
	if paise < 0 {
		abs, sign = -paise, "-"
	}
	return fmt.Sprintf("%s%d.%02d", sign, abs/100, abs%100), nil
}

// CSVField is csvField for text: one CSV field, RFC 4180.
func CSVField(s string) string {
	if strings.ContainsAny(s, "\",\r\n") {
		return "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
	}
	return s
}

func csv(rows [][]string) string {
	var b strings.Builder
	for _, r := range rows {
		for i, f := range r {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(CSVField(f))
		}
		b.WriteString("\r\n")
	}
	return b.String()
}

// dateOf is YYYY-MM-DD in the shop's time zone.
func dateOf(ms int64, timeZone string) string {
	p := zone.LocalParts(ms, timeZone)
	return fmt.Sprintf("%d-%02d-%02d", p.Year, p.Month, p.Day)
}

func voucherType(l Line) string {
	switch l.Kind {
	case "received":
		return "Receipt"
	case "refund_made":
		if l.Doc != "" {
			return "Credit note"
		}
		return "Payment"
	case "fee_charged", "late_fee":
		return "Sales"
	case "applied":
		if l.Doc != "" {
			return "Sales"
		}
	}
	return "Journal"
}

var docType = map[Series]string{"RCT": "Receipt", "BILL": "Bill", "CN": "Credit note"}

// ExportNames is exportNames.
type ExportNames struct{ Journal, Documents, Readme string }

// ExtraNames is extraNames: the files beside those.
type ExtraNames struct{ Settlements, TallyMasters, TallyVouchers string }

// ExportNamesOf is exportNames(period).
func ExportNamesOf(period string) ExportNames {
	return ExportNames{"journal-" + period + ".csv", "documents-" + period + ".csv", "README.txt"}
}

// ExtraNamesOf is extraNames(period).
func ExtraNamesOf(period string) ExtraNames {
	return ExtraNames{"settlements-" + period + ".csv", "tally-masters.xml", "tally-vouchers.xml"}
}

// The record's action names for the settlement job's lines. Persisted, so never renamed.
const (
	SettlementRead   = "settlements_read"
	SettlementRow    = "settlement_row"
	SettlementListed = "settlement_listed"
)

type settlementAcc struct {
	id, utr                                             string
	atMs                                                int64
	nan                                                 bool
	gross, fee, gst, refunds, adjustments, net, leftOut int64
}

// undefinedText is what a template string prints for a ref that is not there.
func undef(refs map[string]string, key string) string {
	if v, ok := refs[key]; ok {
		return v
	}
	return "undefined"
}

// settlementRows is one row per settlement the payment service paid out: gross, its charge without the GST and the GST on it, refunds taken back, other adjustments, and what reached the bank
// (the net), all from the record's own settlement lines. A settlement is in the period of the day the service settled it. nil when the shop has no settlement at all.
func settlementRows(entries []Entry, inRange func(ms int64) bool, timeZone string) [][]string {
	by := map[string]*settlementAcc{}
	order := []string{}
	any := false
	take := func(id, utr string, atMs int64, atOK bool) *settlementAcc {
		a := by[id]
		if a == nil {
			a = &settlementAcc{id: id, utr: utr, atMs: atMs}
			by[id] = a
			order = append(order, id)
			a.nan = !atOK
		}
		if !atOK {
			a.nan = true // Math.min with NaN is NaN
		} else if atMs < a.atMs {
			a.atMs = atMs
		}
		return a
	}
	// int is `Number(v ?? 0)` kept only if it is a safe integer, else 0
	int := func(refs map[string]string, key string) int64 {
		v, ok := refs[key]
		if !ok {
			return 0
		}
		f := JSNumber(v)
		if IsSafeInteger(f) {
			return int64(f)
		}
		return 0
	}
	for _, e := range entries {
		r := e.Refs
		var atMs int64
		atOK := true
		if r[RefSettledAt] != "" {
			atMs = int(r, RefSettledAt) * 1000
		} else {
			atMs, atOK = ParseISO(e.Time)
		}
		switch {
		case hasRef(r, RefKind) && r[RefKind] == "settled":
			any = true
			typ := "payment"
			if r[RefRowType] == "refund" {
				typ = "refund"
			}
			check := CheckSettlementRow(SettlementFigures{Type: typ, Amount: int(r, RefAmount), Fee: int(r, RefFee), Tax: int(r, RefTax), Credit: int(r, RefCredit), Debit: int(r, RefDebit)})
			if !check.OK {
				continue // the journal already lists it as a problem; a row that does not add up is not summed
			}
			a := take(undef(r, RefSettlement), undef(r, RefUTR), atMs, atOK)
			if typ == "payment" {
				a.gross += int(r, RefAmount)
				a.fee += check.FeePaise
				a.gst += check.GSTPaise
				a.net += int(r, RefCredit)
			} else {
				a.refunds += int(r, RefAmount)
				a.net -= int(r, RefAmount)
			}
		case e.Action == SettlementListed && (r["why"] == "unknown_payment" || r["why"] == "problem" || r["why"] == "other") && r["settlementId"] != "":
			any = true
			take(r["settlementId"], r["utr"], atMs, atOK).leftOut++ // in the bank's figure but not in the books: the sheet says so
		case e.Action == SettlementListed && r["why"] == "adjustment" && r["settlementId"] != "":
			any = true
			a := take(r["settlementId"], r["utr"], atMs, atOK)
			taken := int(r, RefDebit) - int(r, RefCredit) // an adjustment that takes money off the settlement is positive
			a.adjustments += taken
			a.net -= taken
		}
	}
	if !any {
		return nil
	}
	rows := [][]string{{"settlement_id", "utr", "settled_on", "gross", "fee_without_gst", "gst_on_fee", "refunds", "adjustments", "net", "rows_left_out"}}
	accs := make([]*settlementAcc, 0, len(order))
	for _, id := range order {
		accs = append(accs, by[id])
	}
	coll := collate.New(language.English) // not safe to share between goroutines, so one per call
	sort.SliceStable(accs, func(i, j int) bool {
		x, y := accs[i], accs[j]
		if !x.nan && !y.nan && x.atMs != y.atMs {
			return x.atMs < y.atMs
		}
		return coll.CompareString(x.id, y.id) < 0
	})
	for _, a := range accs {
		if a.nan || !inRange(a.atMs) {
			continue
		}
		cells := []string{a.id, a.utr, dateOf(a.atMs, timeZone)}
		for _, v := range []int64{a.gross, a.fee, a.gst, a.refunds, a.adjustments, a.net} {
			t, _ := Rupees(v)
			cells = append(cells, t)
		}
		rows = append(rows, append(cells, strconv.FormatInt(a.leftOut, 10)))
	}
	return rows
}

func hasRef(r map[string]string, k string) bool { _, ok := r[k]; return ok }

// AccountantFiles is accountantFiles. An error is the TypeScript's thrown message (a period it does not know).
func AccountantFiles(i ExportInput) ([]ExportFile, error) {
	rng, ok := PeriodRange(i.Period, i.TimeZone)
	if !ok {
		return nil, fmt.Errorf("\"%s\" is not a period: write a month as 2026-11 or a financial year as 26-27.", i.Period)
	}
	names, extra := ExportNamesOf(i.Period), ExtraNamesOf(i.Period)
	inRangeMs := func(t int64) bool { return t >= rng.FromMs && t < rng.ToMs }
	inRange := func(iso string) bool { t, ok := ParseISO(iso); return ok && inRangeMs(t) }
	bySeq := map[int]Entry{}
	for _, e := range i.Entries {
		bySeq[e.Seq] = e
	}

	oldDue := func(seq int) string {
		e, ok := bySeq[seq]
		if !ok || i.OldDueOf == nil {
			return ""
		}
		if m := i.OldDueOf(e); m != "" {
			return OldDueNote(m)
		}
		return ""
	}
	anyOldDue := false
	if i.OldDueOf != nil {
		for _, l := range i.Journal.Lines {
			if inRange(l.At) && oldDue(l.Seq) != "" {
				anyOldDue = true
				break
			}
		}
	}
	head := []string{"date", "voucher_no", "voucher_type", "account", "debit", "credit", "method", "evidence", "case_ref", "payment_id", "refund_id", "record_seq"}
	if anyOldDue {
		head = append(head, "note")
	}
	journalRows := [][]string{head}
	for _, l := range i.Journal.Lines {
		if !inRange(l.At) {
			continue
		}
		refs := bySeq[l.Seq].Refs
		ms, _ := ParseISO(l.At)
		voucher := l.Doc
		if voucher == "" {
			voucher = "J-" + strconv.Itoa(l.Seq)
		}
		d, _ := Rupees(l.DebitPaise)
		c, _ := Rupees(l.CreditPaise)
		row := []string{dateOf(ms, i.TimeZone), voucher, voucherType(l), AccountantName(l.Account), d, c, string(l.Method), string(l.Evidence), caseRef(l.Case), refs["paymentId"], refs["refundId"], strconv.Itoa(l.Seq)}
		if anyOldDue {
			row = append(row, oldDue(l.Seq))
		}
		journalRows = append(journalRows, row)
	}

	docRows := [][]string{{"number", "date", "type", "amount", "note"}}
	restores := []Entry{}
	for _, e := range i.Entries {
		if e.Action == RestoredAction {
			restores = append(restores, e)
		}
	}
	for _, series := range SeriesAll {
		years := []string{}
		seen := map[string]bool{}
		for _, d := range i.Journal.Documents {
			if d.Series == series && !seen[d.FY] {
				seen[d.FY] = true
				years = append(years, d.FY)
			}
		}
		for _, fy := range years {
			docs := []DocRef{}
			for _, d := range i.Journal.Documents {
				if d.Series == series && d.FY == fy {
					docs = append(docs, d)
				}
			}
			sort.SliceStable(docs, func(a, b int) bool { return docs[a].N < docs[b].N })
			prevN, prevSeq := int64(0), 0
			for _, d := range docs {
				if inRange(d.At) {
					ms, _ := ParseISO(d.At)
					amt, _ := Rupees(d.AmountPaise)
					docRows = append(docRows, []string{d.Number, dateOf(ms, i.TimeZone), docType[series], amt, ""})
				}
				// Numbers between the last one and this one were never issued here. A restore entry in between (as numbers.go reads it) says why; nothing else should.
				var restore *Entry
				for k := range restores {
					r := restores[k]
					if r.Seq > prevSeq && r.Seq < d.Seq {
						if t, ok := ParseISO(r.Time); prevSeq > 0 || (ok && t >= FYStartMs(fy, i.TimeZone)) {
							restore = &restores[k]
							break
						}
					}
				}
				when := d.At
				if restore != nil {
					when = restore.Time
				}
				if d.N > prevN+1 && inRange(when) {
					// One row per skipped range, not per number: a restore skips 10,000 numbers, and a sheet of 10,000 empty rows helps nobody.
					num := func(n int64) string { return string(series) + "/" + fy + "/" + padStart(strconv.FormatInt(n, 10), 4) }
					rangeText := num(prevN + 1)
					if d.N-1 != prevN+1 {
						rangeText = num(prevN+1) + " to " + num(d.N-1)
					}
					ms, _ := ParseISO(when)
					note := "missing"
					if restore != nil {
						note = "not used: the shop's data was restored"
					}
					docRows = append(docRows, []string{rangeText, dateOf(ms, i.TimeZone), docType[series], "", note})
				}
				prevN, prevSeq = d.N, d.Seq
			}
		}
	}

	settlementCsv := settlementRows(i.Entries, inRangeMs, i.TimeZone)

	// The Tally files are best effort and never the only copy: if they cannot be made, the CSV files are still complete and the README says why.
	var tallyMasters, tallyVouchers string
	tallyMade := false
	tallyWhy := ""
	if i.Tally != nil {
		lines := []Line{}
		for _, l := range i.Journal.Lines {
			if inRange(l.At) {
				lines = append(lines, l)
			}
		}
		opts := *i.Tally
		if opts.OldDueOf == nil && anyOldDue { // `...(anyOldDue ? { oldDueOf } : {}), ...i.tally`: the tally options' own oldDueOf, when given, wins
			opts.OldDueOf = i.OldDueOf
		}
		m, v, err := TallyFiles(lines, i.Entries, i.TimeZone, opts)
		if err != nil {
			tallyWhy = err.Error()
		} else {
			tallyMasters, tallyVouchers, tallyMade = m, v, true
		}
	}

	period := "one month"
	if language16Len(i.Period) != 7 {
		period = "one financial year, 1 April to 31 March"
	}
	journalLine := fmt.Sprintf("%s: one row for each line the shop's books wrote, in the order they were written. Each payment, refund and bill is two or more lines whose debit and credit add up to the same amount. Columns: date (YYYY-MM-DD), voucher_no (the document's number, or J-<n> where no document was issued), voucher_type, account, debit, credit, method, evidence (provider: the payment service's own record; owner_mark: the owner marked it; person_word: a person said it was done), case_ref, payment_id, refund_id, record_seq.", names.Journal)
	if anyOldDue {
		journalLine += " A last column, note, says \"old due 2026-09\" on every line of a fee for an earlier month that was unpaid when the agent started (the owner typed it in the settings): the books post it as an ordinary fee, and the accountant moves it where they prefer."
	}
	readme := []string{
		fmt.Sprintf("Files for the period %s (%s), dates in the shop's time zone (%s).", i.Period, period, i.TimeZone),
		"",
		journalLine,
		fmt.Sprintf("%s: every receipt, bill and refund note issued in the period, with its number, date, type and amount. Numbers that were skipped have one row for each run of them (\"RCT/26-27/0003 to RCT/26-27/10002\"): \"not used: the shop's data was restored\" when the shop's data was restored from a copy and the numbers moved on so none is used twice, and \"missing\" for any other gap (which should not happen).", names.Documents),
	}
	if settlementCsv != nil {
		readme = append(readme, fmt.Sprintf("%s: one row for each settlement the payment service paid into the bank: settlement_id, utr (the bank's reference, to tick against the bank statement), settled_on, gross (what customers paid), fee_without_gst, gst_on_fee, refunds, adjustments, and net (gross less the fee, the GST, refunds and adjustments, for the rows the books counted: rows_left_out is how many rows of that settlement are not in the books, such as a payment that did not go through the assistant, and the bank received those too).", extra.Settlements))
	}
	readme = append(readme, "", Owner("en").Scope, "All amounts are in rupees with two decimals. A customer's phone number or name is never in these files; a customer is only a case reference.")
	if i.Tally != nil {
		readme = append(readme, "", "Importing into TallyPrime (best effort: the CSV files above are the way that always works)")
		if tallyMade {
			company := " you want them in (the file names no company, so it goes into the open one)"
			if i.Tally.Company != "" {
				company = ": its name must be exactly \"" + i.Tally.Company + "\", as written in the file"
			}
			readme = append(readme, fmt.Sprintf("%s and %s are written from TallyPrime's own help pages and sample files. They have not been tried on a real TallyPrime, so look at the first import in Tally's Exceptions report. 1) Back up the company first. 2) Open the company%s. 3) Alt+O (Import) > Masters, choose %s. 4) Alt+O (Import) > Transactions, choose %s. Import each file once only: a second import makes every voucher again. The dates must be inside the company's financial year, and the ledgers are made under groups every TallyPrime has (Cash-in-Hand, Bank Accounts, Sundry Debtors, Current Liabilities, Sales Accounts, Indirect Expenses, Duties & Taxes). Vouchers are plain Receipt, Payment and Journal vouchers, never GST invoices.", extra.TallyMasters, extra.TallyVouchers, company, extra.TallyMasters, extra.TallyVouchers))
		} else {
			readme = append(readme, fmt.Sprintf("The Tally files could not be made this time (%s). The CSV files are complete.", tallyWhy))
		}
	}
	readme = append(readme, "")

	files := []ExportFile{{names.Journal, csv(journalRows)}, {names.Documents, csv(docRows)}}
	if settlementCsv != nil {
		files = append(files, ExportFile{extra.Settlements, csv(settlementCsv)})
	}
	if tallyMade {
		files = append(files, ExportFile{extra.TallyMasters, tallyMasters}, ExportFile{extra.TallyVouchers, tallyVouchers})
	}
	return append(files, ExportFile{names.Readme, strings.Join(readme, "\r\n")}), nil
}
