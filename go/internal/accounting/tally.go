// TallyPrime import files, BEST EFFORT: tally-masters.xml (the ledgers the vouchers use) and tally-vouchers.xml (one voucher for each book entry) (modules/accounting/tally.ts). The CSV files
// (export.go) are the guaranteed way into any accountant's tool; these two are for an accountant who uses TallyPrime. Nothing here has been imported into a real TallyPrime; the TypeScript's own
// header says what is and is not confirmed by Tally's pages, and that is not repeated here.
//
// What is built: masters first (Tally refuses a voucher whose ledger does not exist), each under a group TallyPrime has by default; plain accounting vouchers only (Receipt, Payment, Journal),
// chosen by where the cash or bank ledger sits; a debit is ISDEEMEDPOSITIVE Yes with a NEGATIVE amount and a credit No with a POSITIVE one, in rupees with two decimals written from integer paise;
// every voucher is added up in paise before it is written and must be exactly zero, or the file is not made (an error here, and export.go then leaves the Tally files out and says so); the date is
// YYYYMMDD in the shop's time zone; the voucher number is the document's number, or J-<seq>; the narration carries the payment, refund, settlement or bank reference; every value is escaped for XML.
//
// Where Go differs from JavaScript: a Map's insertion order (the vouchers by entry, the ledgers) is kept in order slices; the valid-XML-character class of the TypeScript's regex is
// [\t\n\r U+0020-U+D7FF U+E000-U+FFFD U+10000-U+10FFFF] (read from the source bytes, not from memory), and a byte that is not valid UTF-8 (JavaScript would hold a lone surrogate) is replaced
// by a space like any other character outside it; `.trim()` is language.TrimJS.
package accounting

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// TallyOptions is tally.ts TallyOptions. Company "" is left out. LedgerNames gives the accountant's own name for an account code. OldDueOf (Fees only) says a record entry belongs to an old
// due and which month ("" for none).
type TallyOptions struct {
	Company     string
	LedgerNames map[string]string
	OldDueOf    func(Entry) string
}

// TallyGroups is TALLY_GROUPS: the groups TallyPrime has by default and the ledgers here use.
var TallyGroups = []string{"Cash-in-Hand", "Bank Accounts", "Sundry Debtors", "Current Liabilities", "Sales Accounts", "Indirect Expenses", "Duties & Taxes"}

type side struct {
	group string
	debit bool
}

// voucherTypeOf chooses a voucher's type by where the cash or bank ledger sits: on the debit side a Receipt, on the credit side a Payment, on both a Contra, on neither a Journal.
func voucherTypeOf(sides []side) string {
	money := func(g string) bool { return g == "Cash-in-Hand" || g == "Bank Accounts" }
	into, outOf := false, false
	for _, s := range sides {
		if money(s.group) && s.debit {
			into = true
		}
		if money(s.group) && !s.debit {
			outOf = true
		}
	}
	switch {
	case into && outOf:
		return "Contra"
	case into:
		return "Receipt"
	case outOf:
		return "Payment"
	}
	return "Journal"
}

// XML is tally.ts xml: text safe inside an XML element or attribute: what XML 1.0 cannot carry replaced with a space, then the five special characters escaped (`&apos;` here; the report's escaper
// writes `&#39;`: they are two different functions in the TypeScript and stay two).
func XML(text string) string {
	var b strings.Builder
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		ok := r == 0x09 || r == 0x0A || r == 0x0D || (r >= 0x20 && r <= 0xD7FF) || (r >= 0xE000 && r <= 0xFFFD) || (r >= 0x10000 && r <= 0x10FFFF)
		if r == utf8.RuneError && size == 1 {
			ok = false
		}
		if ok {
			b.WriteString(text[i : i+size])
		} else {
			b.WriteByte(' ')
		}
		i += size
	}
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;").Replace(b.String())
}

const tallyHead = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"

func envelope(report, company, body string) string {
	vars := ""
	if company != "" {
		vars = "<STATICVARIABLES><SVCURRENTCOMPANY>" + XML(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>"
	}
	return tallyHead + "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>" + report + "</REPORTNAME>" + vars + "</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF=\"TallyUDF\">\n" + body + "</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n"
}

var longDigits = regexp.MustCompile(`[0-9]{8,}`)

// caseRef: a case id is `b-14` or `f-3.2`; a long run of digits could be a phone number and is left out (the same guard as export.ts).
func caseRef(c *string) string {
	if c == nil || longDigits.MatchString(*c) {
		return ""
	}
	return *c
}

func narrationOf(first Line, refs map[string]string, oldDue string) string {
	bits := []string{strings.ReplaceAll(string(first.Kind), "_", " ")}
	if c := caseRef(first.Case); c != "" {
		bits = append(bits, c)
	}
	if v := refs["paymentId"]; v != "" {
		bits = append(bits, "payment "+v)
	}
	if v := refs["refundId"]; v != "" {
		bits = append(bits, "refund "+v)
	}
	if v := refs["settlementId"]; v != "" {
		bits = append(bits, "settlement "+v)
	}
	if v := refs["utr"]; v != "" {
		bits = append(bits, "UTR "+v)
	}
	if oldDue != "" {
		bits = append(bits, oldDue)
	}
	return strings.Join(bits, ", ")
}

// errInvalidTime is what JavaScript's Intl throws (RangeError) for a time it cannot read, when the voucher's date is worked out.
var errInvalidTime = errors.New("Invalid time value")

// TallyFiles is tallyFiles: the two files for the journal lines given (already cut to the period). A voucher that does not add up to zero, or two ledgers whose names are the same but whose
// groups differ, is an error: the caller leaves the Tally files out and says why.
func TallyFiles(lines []Line, entries []Entry, timeZone string, o TallyOptions) (masters, vouchers string, err error) {
	nameOf := func(code string) (string, error) {
		n, ok := o.LedgerNames[code]
		if !ok {
			n = AccountantName(code)
		}
		n = language.TrimJS(n)
		if n == "" {
			return "", fmt.Errorf("The ledger name for \"%s\" is empty.", code)
		}
		return n, nil
	}
	bySeq := map[int]map[string]string{}
	oldDueBySeq := map[int]string{}
	for _, e := range entries {
		bySeq[e.Seq] = e.Refs
		if o.OldDueOf != nil {
			oldDueBySeq[e.Seq] = o.OldDueOf(e)
		} else {
			oldDueBySeq[e.Seq] = ""
		}
	}
	groups := map[int][]Line{}
	order := []int{}
	for _, l := range lines {
		if _, ok := groups[l.Seq]; !ok {
			order = append(order, l.Seq)
		}
		groups[l.Seq] = append(groups[l.Seq], l)
	}
	ledgerGroup := map[string]string{} // ledger name -> group
	ledgerOrder := []string{}
	var vb strings.Builder
	for _, seq := range order {
		ls := groups[seq]
		var sum int64
		sides := make([]side, len(ls))
		for i, l := range ls {
			sum += l.DebitPaise - l.CreditPaise
			sides[i] = side{TallyGroupOf(l.Account), l.DebitPaise > 0}
		}
		if sum != 0 {
			return "", "", fmt.Errorf("Voucher J-%d does not add up (%d paise): it is not written, and no Tally file is made.", seq, sum)
		}
		first := ls[0]
		typ := voucherTypeOf(sides)
		ms, ok := ParseISO(first.At)
		if !ok {
			return "", "", errInvalidTime
		}
		p := zone.LocalParts(ms, timeZone)
		date := fmt.Sprintf("%d%02d%02d", p.Year, p.Month, p.Day)
		number := fmt.Sprintf("J-%d", seq)
		for _, l := range ls {
			if l.Doc != "" {
				number = l.Doc
				break
			}
		}
		var ex strings.Builder
		for _, l := range ls {
			name, err := nameOf(l.Account)
			if err != nil {
				return "", "", err
			}
			group := TallyGroupOf(l.Account)
			had, seen := ledgerGroup[name]
			if seen && had != group {
				return "", "", fmt.Errorf("The ledger \"%s\" would be made under two groups (%s and %s); give the accounts different names.", name, had, group)
			}
			if !seen {
				ledgerOrder = append(ledgerOrder, name)
			}
			ledgerGroup[name] = group
			debit := l.DebitPaise > 0
			paise := l.CreditPaise
			if debit {
				paise = l.DebitPaise
			}
			yes, minus := "No", ""
			if debit {
				yes, minus = "Yes", "-"
			}
			amount, err := Rupees(paise)
			if err != nil {
				return "", "", err
			}
			ex.WriteString("<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + XML(name) + "</LEDGERNAME><ISDEEMEDPOSITIVE>" + yes + "</ISDEEMEDPOSITIVE><AMOUNT>" + minus + amount + "</AMOUNT></ALLLEDGERENTRIES.LIST>\n")
		}
		oldDue := ""
		if v := oldDueBySeq[seq]; v != "" {
			oldDue = "old due " + v
		}
		vb.WriteString("<VOUCHER VCHTYPE=\"" + typ + "\" ACTION=\"Create\" OBJVIEW=\"Accounting Voucher View\"><DATE>" + date + "</DATE><VOUCHERTYPENAME>" + typ + "</VOUCHERTYPENAME><VOUCHERNUMBER>" + XML(number) + "</VOUCHERNUMBER><NARRATION>" + XML(narrationOf(first, bySeq[seq], oldDue)) + "</NARRATION>\n" + ex.String() + "</VOUCHER>\n")
	}
	var mb strings.Builder
	for _, name := range ledgerOrder {
		mb.WriteString("<LEDGER NAME=\"" + XML(name) + "\" ACTION=\"Create\"><NAME>" + XML(name) + "</NAME><PARENT>" + XML(ledgerGroup[name]) + "</PARENT></LEDGER>\n")
	}
	return envelope("All Masters", o.Company, mb.String()), envelope("Vouchers", o.Company, vb.String()), nil
}
