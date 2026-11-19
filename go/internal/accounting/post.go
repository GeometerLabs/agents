// post(event): the one writer of money facts, for every payments agent (modules/accounting/post.ts): Bookings, Orders, Fees, refunds, a builder's own agent.
//
// It never moves money and calls nothing outside. A money fact becomes money only when the record shows it: the template has already read the payment back from the payments service's own
// list, or has the owner's mark, exactly where it writes a `confirmed` line, and nothing a customer or the AI says reaches here. So Post does not write a line of its own: it gives the
// template the money fields (`refs`) for the line the template writes anyway, with the template's own action name. What it adds: one shape; once (a second post of the same money gets no money
// fields and says so: the double tap, the redelivered webhook, the lost reply's retry); a gap-free document number worked out from the record in the same step; and read-back (after the
// template writes, the line is read through the journal; a line that is not there, or does not read as posted, is an error, and the runtime then saves nothing of the step).
//
// Go differs from the TypeScript only where it must: a thrown Error is a returned error with the same text; the money fields are handed to the writer as a map (the order they were made in
// is kept in an order slice, because the read-back reports the FIRST ref that differs, and a Go map has no order); an amount is int64, so a fractional or non-number amount, which the
// TypeScript refuses with "A <kind> of <n> paise cannot be posted", cannot be built (the message for the whole numbers is the same).
package accounting

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// TaxStatus is post.ts TaxStatus: "unregistered" (the default) or "composition". A regular GST-registered shop is not supported yet.
type TaxStatus string

// Shop is AccountingShop.
type Shop struct {
	Timezone string
	Status   TaxStatus // "" is unregistered
}

// MoneyEvent is post.ts MoneyEvent, all kinds in one struct: only the fields of its kind are read (Kind says which). Case is nil only for a correction. Owed is a pointer because a "kept"
// event has two shapes (a deposit kept, or a refund owed kept: `"owed" in e`). RefundID nil is "left out" (a person's word). JSON names are the TypeScript's.
type MoneyEvent struct {
	Kind         MoneyKind   `json:"kind"`
	Case         *string     `json:"case"`
	PaymentID    string      `json:"paymentId,omitempty"`
	AmountPaise  int64       `json:"amountPaise,omitempty"`
	Method       Method      `json:"method,omitempty"`
	Evidence     Evidence    `json:"evidence,omitempty"`
	For          ReceivedFor `json:"for,omitempty"`
	Service      string      `json:"service,omitempty"`
	Owed         *string     `json:"owed,omitempty"`
	Why          string      `json:"why,omitempty"`
	RefundID     *string     `json:"refundId,omitempty"`
	Reverses     int64       `json:"reverses,omitempty"`
	SettlementID string      `json:"settlementId,omitempty"`
	UTR          string      `json:"utr,omitempty"`
	EntityID     string      `json:"entityId,omitempty"`
	RowType      string      `json:"rowType,omitempty"`
	FeePaise     int64       `json:"feePaise,omitempty"`
	TaxPaise     int64       `json:"taxPaise,omitempty"`
	CreditPaise  int64       `json:"creditPaise,omitempty"`
	DebitPaise   int64       `json:"debitPaise,omitempty"`
	SettledAt    *int64      `json:"settledAt,omitempty"`
}

// WriteMoneyLine is the template's own writer: it appends its line with these refs merged in last. What it returns does not matter: the line is read back from the record.
type WriteMoneyLine func(refs map[string]string) error

// Posted is post.ts Posted: whether the money was counted, the document number it issued ("" if none), and why nothing was posted (a repeat).
type Posted struct {
	Posted bool   `json:"posted"`
	Doc    string `json:"doc,omitempty"`
	Why    string `json:"why,omitempty"`
}

// Accounting is post.ts Accounting.
type Accounting interface {
	Post(event MoneyEvent, write WriteMoneyLine) (Posted, error)
	// Journal is the journal, caught up with the record.
	Journal() *Journal
}

// Clock is core/clock.ts Clock: epoch milliseconds, passed in so a test can move it.
type Clock interface{ Now() int64 }

type accountingImpl struct {
	record Reader
	shop   Shop
	status TaxStatus
	clock  Clock
	book   *Journal
}

// CreateAccounting is createAccounting. It refuses a tax status that is not supported, with the TypeScript's words.
func CreateAccounting(record Reader, shop Shop, legacy LegacyMap, clock Clock) (Accounting, error) {
	status := shop.Status
	if status == "" {
		status = "unregistered"
	}
	if status != "unregistered" && status != "composition" {
		return nil, fmt.Errorf("The tax status \"%s\" is not supported: a shop is \"unregistered\" or \"composition\" (a regular GST-registered shop is not supported yet).", status)
	}
	return &accountingImpl{record: record, shop: shop, status: status, clock: clock, book: NewJournal(legacy)}, nil
}

func (a *accountingImpl) Journal() *Journal { return a.book.AddAll(a.record.Entries()) }

// seriesOf says which document an event issues, and in which series. A bill for work done is issued only by a composition shop (a bill of supply).
func seriesOf(e MoneyEvent, status TaxStatus) (Series, bool) {
	switch e.Kind {
	case "received":
		return "RCT", true
	case "fee_charged", "late_fee":
		return "BILL", true
	case "applied":
		if status == "composition" {
			return "BILL", true
		}
	case "refund_made":
		return "CN", true
	}
	return "", false
}

// hasAmount is `"amountPaise" in event`: every kind but a refund cancelled, a correction and a "kept" that names a refund.
func (e MoneyEvent) hasAmount() bool {
	switch e.Kind {
	case "refund_cancelled", "correction":
		return false
	case "kept":
		return e.Owed == nil
	}
	return true
}

func (e MoneyEvent) owedText() string {
	if e.Owed == nil {
		return ""
	}
	return *e.Owed
}

func optText(p *string, none string) string {
	if p == nil {
		return none
	}
	return *p
}

// repeat says why this event would count money a second time, or nothing new, or "" when it is new.
func (a *accountingImpl) repeat(j *Journal, e MoneyEvent) string {
	has := func(key string) bool { _, ok := j.Identity(key); return ok }
	switch e.Kind {
	case "received":
		if has("received:" + e.PaymentID) {
			return fmt.Sprintf("payment %s is already counted", e.PaymentID)
		}
	case "fee_charged":
		if has("fee:" + caseText(e.Case)) {
			return fmt.Sprintf("the fee %s is already charged", caseText(e.Case))
		}
	case "late_fee":
		if has("late:" + caseText(e.Case)) {
			return fmt.Sprintf("the late fee of %s is already charged", caseText(e.Case))
		}
	case "applied":
		if has("applied:" + caseText(e.Case)) {
			return fmt.Sprintf("the deposit of %s is already applied", caseText(e.Case))
		}
	case "kept":
		if e.Owed != nil {
			if j.OpenOwed(*e.Owed) == 0 {
				return fmt.Sprintf("no refund is owed under %s", *e.Owed)
			}
		} else if has("kept:" + caseText(e.Case)) {
			return fmt.Sprintf("the deposit of %s is already kept", caseText(e.Case))
		}
	case "refund_owed":
		if j.OpenOwed(e.owedText()) > 0 {
			return fmt.Sprintf("a refund is already owed under %s", e.owedText())
		}
	case "refund_made":
		key := "made:" + e.owedText() + ":" + string(e.Evidence)
		if e.RefundID != nil && *e.RefundID != "" {
			key = "made:" + *e.RefundID
		}
		if has(key) {
			return fmt.Sprintf("refund %s is already counted", optText(e.RefundID, e.owedText()))
		}
	case "refund_cancelled":
		if j.OpenOwed(e.owedText()) == 0 {
			return fmt.Sprintf("no refund is owed under %s", e.owedText())
		}
	case "correction":
		if has("correction:" + strconv.FormatInt(e.Reverses, 10)) {
			return fmt.Sprintf("entry %d is already corrected", e.Reverses)
		}
	case "settled":
		if has("settled:" + e.SettlementID + ":" + e.EntityID) {
			return fmt.Sprintf("row %s of settlement %s is already counted", e.EntityID, e.SettlementID)
		}
	}
	return ""
}

type kv struct{ k, v string }

// refsOf is the money fields of the line, in the order the TypeScript makes them (the read-back reports the first one that differs).
func refsOf(e MoneyEvent, doc string) ([]kv, error) {
	var refs []kv
	add := func(k, v string) { refs = append(refs, kv{k, v}) }
	add(RefKind, string(e.Kind))
	if e.hasAmount() {
		add(RefAmount, strconv.FormatInt(e.AmountPaise, 10))
	}
	switch e.Kind {
	case "received", "refund_owed", "refund_made", "settled":
		add(RefPaymentID, e.PaymentID)
	}
	switch e.Kind {
	case "kept":
		if e.Owed != nil {
			add(RefOwed, *e.Owed)
		}
	case "refund_owed", "refund_made", "refund_cancelled":
		add(RefOwed, e.owedText())
	}
	if e.Kind == "received" || e.Kind == "refund_made" {
		add(RefMethod, string(e.Method))
		add(RefEvidence, string(e.Evidence))
	}
	if e.Kind == "received" {
		add(RefFor, string(e.For))
	}
	if e.Kind == "applied" {
		add(RefService, e.Service)
	}
	if e.Kind == "refund_made" && e.RefundID != nil && *e.RefundID != "" {
		add(RefRefundID, *e.RefundID)
	}
	if e.Kind == "kept" || e.Kind == "refund_cancelled" || e.Kind == "correction" {
		add(RefWhy, e.Why)
	}
	if e.Kind == "correction" {
		add(RefReverses, strconv.FormatInt(e.Reverses, 10))
	}
	if e.Kind == "settled" {
		check := CheckSettlementRow(SettlementFigures{Type: e.RowType, Amount: e.AmountPaise, Fee: e.FeePaise, Tax: e.TaxPaise, Credit: e.CreditPaise, Debit: e.DebitPaise})
		if !check.OK {
			return nil, fmt.Errorf("A settlement row of %s cannot be posted: %s.", e.EntityID, check.Why) // before anything is written
		}
		add(RefSettlement, e.SettlementID)
		add(RefUTR, e.UTR)
		add(RefEntity, e.EntityID)
		add(RefRowType, e.RowType)
		add(RefFee, strconv.FormatInt(e.FeePaise, 10))
		add(RefTax, strconv.FormatInt(e.TaxPaise, 10))
		add(RefCredit, strconv.FormatInt(e.CreditPaise, 10))
		add(RefDebit, strconv.FormatInt(e.DebitPaise, 10))
		add(RefBasis, check.Basis)
		if e.SettledAt != nil {
			add(RefSettledAt, strconv.FormatInt(*e.SettledAt, 10))
		}
	}
	if doc != "" {
		add(RefDoc, doc)
	}
	return refs, nil
}

func (a *accountingImpl) Post(e MoneyEvent, write WriteMoneyLine) (Posted, error) {
	if e.hasAmount() && (e.AmountPaise <= 0 || e.AmountPaise > 9007199254740991) {
		return Posted{}, fmt.Errorf("A %s of %d paise cannot be posted: an amount is a whole number of paise above 0.", e.Kind, e.AmountPaise)
	}
	if e.Kind == "applied" && e.Service != "orders" {
		if _, err := ServiceAccount(e.Service); err != nil { // refuses an id the accounts cannot carry, before anything is written
			return Posted{}, err
		}
	}
	j := a.Journal()
	if again := a.repeat(j, e); again != "" {
		if err := write(map[string]string{}); err != nil {
			return Posted{}, err
		}
		return Posted{Posted: false, Why: again}, nil
	}
	doc := ""
	if series, ok := seriesOf(e, a.status); ok {
		fy := FYOf(a.clock.Now(), a.shop.Timezone)
		text, err := FormatNumber(NextNumber(a.record.Entries(), series, fy, FYStartMs(fy, a.shop.Timezone)))
		if err != nil {
			return Posted{}, err
		}
		doc = text
	}
	refs, err := refsOf(e, doc)
	if err != nil {
		return Posted{}, err
	}
	before := len(a.record.Entries())
	m := make(map[string]string, len(refs))
	for _, p := range refs {
		m[p.k] = p.v
	}
	if err := write(m); err != nil {
		return Posted{}, err
	}
	entries := a.record.Entries()
	if len(entries) != before+1 {
		return Posted{}, fmt.Errorf("The %s line was not written as one record entry, so it is not counted (and the step is not saved).", e.Kind)
	}
	line := entries[len(entries)-1]
	if !sameCase(line.Booking, e.Case) {
		return Posted{}, fmt.Errorf("The %s line was written for %s, not %s; it is not counted.", e.Kind, optText(line.Booking, "no case"), optText(e.Case, "no case"))
	}
	for _, p := range refs {
		got, ok := line.Refs[p.k]
		if !ok || got != p.v {
			shown := "undefined" // a ref the line does not have prints as JavaScript's undefined
			if ok {
				shown = got
			}
			return Posted{}, fmt.Errorf("The %s line's %s is \"%s\", not \"%s\"; it is not counted.", e.Kind, p.k, shown, p.v)
		}
	}
	problems := len(j.Problems)
	j.AddAll(entries)
	if len(j.LinesOf(line.Seq)) == 0 {
		why := make([]string, 0)
		for _, p := range j.Problems[problems:] {
			why = append(why, p.Why)
		}
		text := strings.Join(why, "; ")
		if text == "" {
			text = "it gave no lines"
		}
		return Posted{}, errors.New("The " + string(e.Kind) + " line cannot be read as money: " + text + ".")
	}
	return Posted{Posted: true, Doc: doc}, nil
}

func sameCase(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
