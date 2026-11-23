// The journal: the shop's record read as double-entry lines in paise. The one reader of the accounts (modules/accounting/journal.ts).
//
// Why a fold over the record and not a store of its own: every money fact a shop agent may count is already a record entry that the payments service's own list or the owner's mark confirmed,
// and the record is append-only and hash-chained. Reading the accounts out of it means they can never disagree with it. This file reads only chained fields: action, outcome, the case id, the
// time and `refs`; never `conversation`, `notes` or `refs.page`. It is pure: no settings, no clock.
//
// Two kinds of entry are read: a money line written through post.go carries `refs.money` (the kind) and the rest of its facts in `refs`; an older line has no `refs.money` and is read through
// a LegacyMap the template hands in (frozen: new code always writes `refs.money`). Every entry gives lines that sum to zero. Anything that cannot be read as written is a Problem, listed and
// never silently fixed. A Problem's `Why` is shown in exports and matched by the invariants (`already counted`) and the figures (`the amount`), so every message here is the TypeScript's, word
// for word.
//
// Where Go differs from JavaScript, and what is copied:
//   - a JavaScript Map iterates in insertion order and `Map.set` on a key already there keeps its first place (so a refund owed, made, and owed again under one key stays where it was): Go maps
//     are unordered, so `owed` and `identities` keep an order slice;
//   - a template string writes a null case as "null" ("fee:null", "null|cash"): copied as text, so a case really named "null" is the same key, as it is in the TypeScript;
//   - `refs.x === undefined` is a presence test and `refs.x ?` a truthiness test (an empty text is false): both are kept where the TypeScript uses each;
//   - `Number(text)` is JSNumber (jsnum.go), and money is int64 paise.
package accounting

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
)

// MoneyKind is journal.ts MoneyKind. A payment request is not one: no money moved and nothing was supplied.
type MoneyKind string

// MoneyKinds is MONEY_KINDS.
var MoneyKinds = []MoneyKind{"received", "fee_charged", "late_fee", "discount", "applied", "kept", "refund_owed", "refund_made", "refund_cancelled", "write_off", "correction", "settled"}

// Evidence is how the money is known: the payments service's own list, the owner's mark, or a person's word.
type Evidence string

// ReceivedFor is what a payment received was for.
type ReceivedFor string

// The `refs` keys a money line carries (MONEY_REFS). Chained, so never renamed.
const (
	RefKind       = "money"
	RefAmount     = "amountPaise"
	RefPaymentID  = "paymentId"
	RefRefundID   = "refundId"
	RefOwed       = "owed"
	RefMethod     = "method"
	RefEvidence   = "evidence"
	RefFor        = "for"
	RefService    = "service"
	RefDoc        = "doc"
	RefReverses   = "reverses"
	RefWhy        = "why"
	RefSettlement = "settlementId"
	RefUTR        = "utr"
	RefEntity     = "entity"
	RefRowType    = "rowType"
	RefFee        = "feePaise"
	RefTax        = "taxPaise"
	RefCredit     = "creditPaise"
	RefDebit      = "debitPaise"
	RefBasis      = "feeBasis"
	RefSettledAt  = "settledAt"
)

// SettlementFigures is the payment service's own figures for one settlement row, in paise.
type SettlementFigures struct {
	Type                            string // "payment" or "refund"
	Amount, Fee, Tax, Credit, Debit int64
}

// RowCheck is journal.ts RowCheck: ok with how the fee reads, or not ok with why.
type RowCheck struct {
	OK       bool
	Basis    string // "without_gst" or "with_gst"
	FeePaise int64
	GSTPaise int64
	Why      string
}

func safeNonNeg(n int64) bool { return n >= 0 && n <= 9007199254740991 }

// CheckSettlementRow is checkSettlementRow: whether a settlement row's figures add up, and which way. A payment row is checked both ways to the paisa (credit = amount - fee - tax, the fee
// without GST; or credit = amount - fee, the fee holding the tax); a row that fits neither is refused. A refund row must be a plain take-back.
func CheckSettlementRow(r SettlementFigures) RowCheck {
	for _, n := range []int64{r.Amount, r.Fee, r.Tax, r.Credit, r.Debit} {
		if !safeNonNeg(n) {
			return RowCheck{Why: "a figure of the row is not a whole number of paise, or is negative"}
		}
	}
	if r.Amount <= 0 {
		return RowCheck{Why: "the row has no amount"}
	}
	if r.Type == "refund" {
		if r.Debit == r.Amount && r.Credit == 0 && r.Fee == 0 && r.Tax == 0 {
			return RowCheck{OK: true, Basis: "without_gst"}
		}
		return RowCheck{Why: "a refund row is not just its amount taken back"}
	}
	if r.Debit != 0 {
		return RowCheck{Why: "a payment row has something taken off it (a debit)"}
	}
	if r.Credit == r.Amount-r.Fee-r.Tax {
		return RowCheck{OK: true, Basis: "without_gst", FeePaise: r.Fee, GSTPaise: r.Tax}
	}
	if r.Fee >= r.Tax && r.Credit == r.Amount-r.Fee {
		return RowCheck{OK: true, Basis: "with_gst", FeePaise: r.Fee - r.Tax, GSTPaise: r.Tax}
	}
	return RowCheck{Why: fmt.Sprintf("the credit %d is neither amount - fee - tax (%d) nor amount - fee (%d)", r.Credit, r.Amount-r.Fee-r.Tax, r.Amount-r.Fee)}
}

// LegacyReceived is one of the template's older actions that was a payment received.
type LegacyReceived struct {
	Action  string      `json:"action"`
	Outcome string      `json:"outcome"`
	For     ReceivedFor `json:"for"`
}

// LegacyApplied is the older line that says the booking or order was done, and the account its deposit or advance goes to.
type LegacyApplied struct {
	Action  string `json:"action"`
	Account string `json:"account"`
}

// LegacyMap is journal.ts LegacyMap: which of a template's older actions were money, and what kind. Handed in by the template (it knows its own action names). Applied nil is the TypeScript's
// undefined; an empty FeeCharged, LateFee or Discount is undefined too.
type LegacyMap struct {
	Received   []LegacyReceived `json:"received"`
	Applied    []LegacyApplied  `json:"applied,omitempty"`
	FeeCharged string           `json:"feeCharged,omitempty"`
	LateFee    string           `json:"lateFee,omitempty"`
	Discount   string           `json:"discount,omitempty"`
}

// The lines every template writes the same way (modules/payments/refunds.ts and owner-marked/obligations.ts MARK_ACTIONS): persisted names.
const (
	sharedRefund      = "refund"
	sharedOwedByOwner = "upi_refund_owed"
	sharedDoneByOwner = "upi_refund_marked_done"
	sharedKeptByOwner = "upi_refund_kept"
	sharedMarkedPaid  = "owner_marked_paid"
)

// Line is journal.ts Line. Case is nil for a line that belongs to no case.
type Line struct {
	Seq         int       `json:"seq"`
	At          string    `json:"at"`
	Case        *string   `json:"case"`
	Account     string    `json:"account"`
	DebitPaise  int64     `json:"debitPaise"`
	CreditPaise int64     `json:"creditPaise"`
	Kind        MoneyKind `json:"kind"`
	Evidence    Evidence  `json:"evidence,omitempty"`
	Method      Method    `json:"method,omitempty"`
	Doc         string    `json:"doc,omitempty"`
}

// DocRef is journal.ts DocRef: one document the journal found.
type DocRef struct {
	Number      string    `json:"number"`
	Series      Series    `json:"series"`
	FY          string    `json:"fy"`
	N           int64     `json:"n"`
	Seq         int       `json:"seq"`
	At          string    `json:"at"`
	Case        *string   `json:"case"`
	Kind        MoneyKind `json:"kind"`
	AmountPaise int64     `json:"amountPaise"`
	Evidence    Evidence  `json:"evidence,omitempty"`
	PaymentID   string    `json:"paymentId,omitempty"`
	Method      Method    `json:"method,omitempty"`
}

// Problem is journal.ts Problem: an entry that could not be read as money, and why.
type Problem struct {
	Seq int    `json:"seq"`
	Why string `json:"why"`
}

type source struct {
	account string
	paise   int64
}

// owed is one refund owed, open until it is made, cancelled or kept. from is where its money was taken, so a cancellation puts it back exactly there.
type owedRefund struct {
	caseID *string
	open   int64
	from   []source
}

// Journal is the journal, built one entry at a time (the record is append-only, so a caller that keeps one only reads the entries after the last it saw).
type Journal struct {
	Lines     []Line
	Documents []DocRef
	Problems  []Problem
	// Seen is how many record entries have been read.
	Seen int

	identities map[string]int
	idOrder    []string
	balance    map[string]int64 // "<case>|<account>": debits less credits
	owed       map[string]*owedRefund
	owedOrder  []string
	bySeq      map[int][]Line
	legacy     LegacyMap
}

// NewJournal is `new Journal(legacy)`.
func NewJournal(legacy LegacyMap) *Journal {
	return &Journal{Lines: []Line{}, Documents: []DocRef{}, Problems: []Problem{}, identities: map[string]int{}, balance: map[string]int64{}, owed: map[string]*owedRefund{}, bySeq: map[int][]Line{}, legacy: legacy}
}

// BuildJournal is `journal(entries, legacy)`: the whole record, read once.
func BuildJournal(entries []Entry, legacy LegacyMap) *Journal {
	return NewJournal(legacy).AddAll(entries)
}

// AddAll reads the entries after the last one seen.
func (j *Journal) AddAll(entries []Entry) *Journal {
	for i := j.Seen; i < len(entries); i++ {
		j.Add(entries[i])
	}
	return j
}

func caseText(c *string) string {
	if c == nil {
		return "null" // `${null}`
	}
	return *c
}

// CaseBalance is caseBalance: what the case holds in an account, debits less credits.
func (j *Journal) CaseBalance(caseID *string, account string) int64 {
	return j.balance[caseText(caseID)+"|"+account]
}

// AdvancesOf is advancesOf: the deposit or advance a case holds now, in paise.
func (j *Journal) AdvancesOf(caseID string) int64 {
	return 0 - j.CaseBalance(&caseID, AccAdvances.Code)
}

// ReceivableOf is receivableOf: what a fee case is still owed (negative: paid beyond it).
func (j *Journal) ReceivableOf(caseID string) int64 {
	return j.CaseBalance(&caseID, AccReceivable.Code)
}

// LinesOf is linesOf: the lines one record entry gave (none: it was not money, or it could not be read).
func (j *Journal) LinesOf(seq int) []Line { return j.bySeq[seq] }

// OpenOwed is openOwed: the refund owed under this key that is still open, in paise (0: none).
func (j *Journal) OpenOwed(key string) int64 {
	if o := j.owed[key]; o != nil {
		return o.open
	}
	return 0
}

// OwedItem is one refund still owed: its key, case and amount.
type OwedItem struct {
	Key   string  `json:"key"`
	Case  *string `json:"case"`
	Paise int64   `json:"paise"`
}

// OwedList is owedList: every refund still owed, in the order the owed map was first filled (a JavaScript Map's order).
func (j *Journal) OwedList() []OwedItem {
	out := []OwedItem{}
	for _, k := range j.owedOrder {
		if o := j.owed[k]; o.open > 0 {
			out = append(out, OwedItem{k, o.caseID, o.open})
		}
	}
	return out
}

// Identity is identities.get: the entry that posted a money identity ("received:<payment>", "made:<refund>", "fee:<case>" ...).
func (j *Journal) Identity(key string) (int, bool) { v, ok := j.identities[key]; return v, ok }

// IdentityKeys are the identities in the order they were posted (a Map's order).
func (j *Journal) IdentityKeys() []string { return j.idOrder }

// Add reads one record entry. Anything unreadable becomes a Problem naming the entry.
func (j *Journal) Add(e Entry) {
	j.Seen++
	var err error
	if kind, ok := e.Refs[RefKind]; ok {
		err = j.readNew(e, kind)
	} else {
		err = j.readLegacy(e)
	}
	if err != nil {
		j.Problems = append(j.Problems, Problem{e.Seq, err.Error()})
	}
}

type pair struct {
	account       string
	debit, credit int64
}

type postExtra struct {
	evidence  Evidence
	method    Method
	doc       string
	paymentID string
	identity  *string
	amount    int64
}

func ident(s string) *string { return &s }

func (j *Journal) post(e Entry, kind MoneyKind, pairs []pair, x postExtra) error {
	if x.identity != nil {
		if was, ok := j.identities[*x.identity]; ok {
			return fmt.Errorf("%s was already counted at entry %d; this one is not counted again", *x.identity, was)
		}
	}
	var sum int64
	for _, p := range pairs {
		if !IsAccount(p.account) {
			return fmt.Errorf("\"%s\" is not an account", p.account)
		}
		sum += p.debit - p.credit
	}
	if sum != 0 {
		return fmt.Errorf("the lines of a %s do not balance (%d paise)", kind, sum)
	}
	made := []Line{}
	for _, p := range pairs {
		if p.debit == 0 && p.credit == 0 {
			continue
		}
		made = append(made, Line{Seq: e.Seq, At: e.Time, Case: e.Booking, Account: p.account, DebitPaise: p.debit, CreditPaise: p.credit, Kind: kind, Evidence: x.evidence, Method: x.method, Doc: x.doc})
		j.balance[caseText(e.Booking)+"|"+p.account] += p.debit - p.credit
	}
	j.Lines = append(j.Lines, made...)
	j.bySeq[e.Seq] = made
	if x.identity != nil {
		j.identities[*x.identity] = e.Seq
		j.idOrder = append(j.idOrder, *x.identity)
	}
	if x.doc != "" {
		d, ok := ParseNumber(x.doc)
		if !ok {
			j.Problems = append(j.Problems, Problem{e.Seq, fmt.Sprintf("\"%s\" is not a document number this module writes", x.doc)})
		} else {
			j.Documents = append(j.Documents, DocRef{Number: x.doc, Series: d.Series, FY: d.FY, N: d.N, Seq: e.Seq, At: e.Time, Case: e.Booking, Kind: kind, AmountPaise: x.amount, Evidence: x.evidence, PaymentID: x.paymentID, Method: x.method})
		}
	}
	return nil
}

// take is where money given back comes from, in this order: the deposit or advance the case holds, then what it paid beyond a fee, then the sale itself (a return).
func (j *Journal) take(caseID *string, amount int64) []source {
	out := []source{}
	left := amount
	var held, over int64
	if caseID != nil {
		held = max(0, j.AdvancesOf(*caseID))
	}
	if held > 0 && left > 0 {
		p := min(held, left)
		out = append(out, source{AccAdvances.Code, p})
		left -= p
	}
	if caseID != nil {
		over = max(0, -j.ReceivableOf(*caseID))
	}
	if over > 0 && left > 0 {
		p := min(over, left)
		out = append(out, source{AccReceivable.Code, p})
		left -= p
	}
	if left > 0 {
		out = append(out, source{AccReturns.Code, left})
	}
	return out
}

type receivedArgs struct {
	amount    int64
	paymentID string
	method    Method
	evidence  Evidence
	forWhat   ReceivedFor
	doc       string
}

func (j *Journal) received(e Entry, a receivedArgs) error {
	into := AccAdvances.Code
	if a.forWhat == "fee" {
		into = AccReceivable.Code
	}
	return j.post(e, "received", []pair{{MethodAccount(a.method), a.amount, 0}, {into, 0, a.amount}}, postExtra{evidence: a.evidence, method: a.method, doc: a.doc, paymentID: a.paymentID, identity: ident("received:" + a.paymentID), amount: a.amount})
}

func (j *Journal) refundOwed(e Entry, key string, amount int64, doc string) error {
	if j.OpenOwed(key) > 0 {
		return fmt.Errorf("a refund is already owed under %s; it is not owed twice", key)
	}
	from := j.take(e.Booking, amount)
	pairs := []pair{}
	for _, f := range from {
		pairs = append(pairs, pair{f.account, f.paise, 0})
	}
	pairs = append(pairs, pair{AccRefundsOwed.Code, 0, amount})
	if err := j.post(e, "refund_owed", pairs, postExtra{doc: doc, amount: amount}); err != nil {
		return err
	}
	if _, ok := j.owed[key]; !ok {
		j.owedOrder = append(j.owedOrder, key) // Map.set on a key already there keeps its first place
	}
	j.owed[key] = &owedRefund{caseID: e.Booking, open: amount, from: from}
	return nil
}

type madeArgs struct {
	amount    int64
	method    Method
	evidence  Evidence
	identity  string
	doc       string
	paymentID string
}

func (j *Journal) refundMade(e Entry, key string, a madeArgs) error {
	o := j.owed[key]
	var open int64
	if o != nil {
		open = o.open
	}
	use := min(open, a.amount)
	rest := a.amount - use // made with nothing (or less) owed first: an older line, or a refund the list showed after it was given up
	var from []source
	if rest > 0 {
		from = j.take(e.Booking, rest)
	}
	pairs := []pair{{AccRefundsOwed.Code, use, 0}}
	for _, f := range from {
		pairs = append(pairs, pair{f.account, f.paise, 0})
	}
	pairs = append(pairs, pair{MethodAccount(a.method), 0, a.amount})
	if err := j.post(e, "refund_made", pairs, postExtra{evidence: a.evidence, method: a.method, doc: a.doc, paymentID: a.paymentID, identity: ident(a.identity), amount: a.amount}); err != nil {
		return err
	}
	if o != nil && use > 0 { // only once the lines are in: a refused line changes nothing
		o.open -= use
		o.from = spend(o.from, use)
	}
	return nil
}

// refundCancelled: a refund owed that will not be made (the owner's no, an approval that ran out, a refusal): its money goes back where it was taken from.
func (j *Journal) refundCancelled(e Entry, key string) error {
	o := j.owed[key]
	if o == nil || o.open == 0 {
		return fmt.Errorf("no refund is owed under %s, so there is nothing to cancel", key)
	}
	amount := o.open
	pairs := []pair{{AccRefundsOwed.Code, amount, 0}}
	for _, f := range o.from {
		pairs = append(pairs, pair{f.account, 0, f.paise})
	}
	if err := j.post(e, "refund_cancelled", pairs, postExtra{amount: amount}); err != nil {
		return err
	}
	o.open = 0
	o.from = nil
	return nil
}

// kept: money the owner keeps: a deposit after a late cancellation the owner said no to (from the advances), or a refund owed the owner keeps for work done by hand. hasKey says whether the
// line named a refund (a presence test, so an empty key is a key).
func (j *Journal) kept(e Entry, amount int64, key string, hasKey bool) error {
	if hasKey {
		o := j.owed[key]
		if o == nil || o.open == 0 {
			return fmt.Errorf("no refund is owed under %s, so nothing can be kept from it", key)
		}
		amt := o.open
		if err := j.post(e, "kept", []pair{{AccRefundsOwed.Code, amt, 0}, {AccKept.Code, 0, amt}}, postExtra{amount: amt, identity: ident("kept:" + key)}); err != nil {
			return err
		}
		o.open = 0
		o.from = nil
		return nil
	}
	return j.post(e, "kept", []pair{{AccAdvances.Code, amount, 0}, {AccKept.Code, 0, amount}}, postExtra{amount: amount, identity: ident("kept:" + caseText(e.Booking))})
}

// spend uses up `paise` of where an owed refund's money came from, first source first (the JavaScript shifts the emptied source off the front).
func spend(from []source, paise int64) []source {
	left := paise
	for left > 0 && len(from) > 0 {
		p := min(from[0].paise, left)
		from[0].paise -= p
		left -= p
		if from[0].paise == 0 {
			from = from[1:]
		}
	}
	return from
}

// paiseText is journal.ts paise: a ref's amount, a whole number of paise above zero. present false is the TypeScript's `undefined`.
func paiseText(text string, present bool) (int64, error) {
	n, ok := canonicalInt(text)
	if !present || !ok || n <= 0 {
		if !present {
			return 0, errors.New("the amount is missing")
		}
		return 0, fmt.Errorf("the amount \"%s\" is not a whole number of paise above 0", text)
	}
	return n, nil
}

func paiseRef(refs map[string]string, key string) (int64, error) {
	t, ok := refs[key]
	return paiseText(t, ok)
}

func parseMethod(v string) (Method, error) {
	switch Method(v) {
	case "gateway", "upi", "cash", "bank":
		return Method(v), nil
	}
	return "", fmt.Errorf("\"%s\" is not a payment method", v)
}

func parseEvidence(v string) (Evidence, error) {
	switch Evidence(v) {
	case "provider", "owner_mark", "person_word":
		return Evidence(v), nil
	}
	return "", fmt.Errorf("\"%s\" is not a kind of evidence", v)
}

func parseFor(v string) (ReceivedFor, error) {
	switch ReceivedFor(v) {
	case "advance", "fee", "extra":
		return ReceivedFor(v), nil
	}
	return "", fmt.Errorf("\"%s\" is not what a payment can be for", v)
}

// readNew reads a line written through post.go.
func (j *Journal) readNew(e Entry, kindText string) error {
	known := false
	for _, k := range MoneyKinds {
		if string(k) == kindText {
			known = true
		}
	}
	if !known {
		return fmt.Errorf("\"%s\" is not a kind of money fact", kindText)
	}
	kind := MoneyKind(kindText)
	r := e.Refs
	doc := r[RefDoc]
	var amount int64
	// journal.ts: a refund owed that the owner keeps (`kept` naming `owed`) carries no amount (post writes none; it is the refund's open part), so none is read.
	_, keptOwed := r[RefOwed]
	keptOwed = keptOwed && kind == "kept"
	if kind != "correction" && kind != "refund_cancelled" && !keptOwed {
		var err error
		if amount, err = paiseRef(r, RefAmount); err != nil { // read before anything else, as the TypeScript does: a missing amount is the first thing said
			return err
		}
	}
	need := func(key string) (string, error) {
		v, ok := r[key]
		if !ok || v == "" {
			return "", fmt.Errorf("a %s line has no %s", kind, key)
		}
		return v, nil
	}
	switch kind {
	case "received":
		paymentID, err := need(RefPaymentID)
		if err != nil {
			return err
		}
		mt, err := need(RefMethod)
		if err != nil {
			return err
		}
		m, err := parseMethod(mt)
		if err != nil {
			return err
		}
		et, err := need(RefEvidence)
		if err != nil {
			return err
		}
		ev, err := parseEvidence(et)
		if err != nil {
			return err
		}
		ft, err := need(RefFor)
		if err != nil {
			return err
		}
		f, err := parseFor(ft)
		if err != nil {
			return err
		}
		return j.received(e, receivedArgs{amount, paymentID, m, ev, f, doc})
	case "fee_charged":
		return j.post(e, kind, []pair{{AccReceivable.Code, amount, 0}, {AccFees.Code, 0, amount}}, postExtra{doc: doc, identity: ident("fee:" + caseText(e.Booking)), amount: amount})
	case "late_fee":
		return j.post(e, kind, []pair{{AccReceivable.Code, amount, 0}, {AccLateFees.Code, 0, amount}}, postExtra{doc: doc, identity: ident("late:" + caseText(e.Booking)), amount: amount})
	case "discount":
		return j.post(e, kind, []pair{{AccDiscounts.Code, amount, 0}, {AccReceivable.Code, 0, amount}}, postExtra{amount: amount})
	case "write_off":
		return j.post(e, kind, []pair{{AccWrittenOff.Code, amount, 0}, {AccReceivable.Code, 0, amount}}, postExtra{amount: amount})
	case "applied":
		service, err := need(RefService)
		if err != nil {
			return err
		}
		account := AccOrders.Code
		if service != "orders" {
			if account, err = ServiceAccount(service); err != nil {
				return err
			}
		}
		if e.Booking != nil && j.AdvancesOf(*e.Booking) < amount {
			j.Problems = append(j.Problems, Problem{e.Seq, fmt.Sprintf("%s holds %d paise of deposit, less than the %d applied", *e.Booking, j.AdvancesOf(*e.Booking), amount)})
		}
		return j.post(e, kind, []pair{{AccAdvances.Code, amount, 0}, {account, 0, amount}}, postExtra{doc: doc, identity: ident("applied:" + caseText(e.Booking)), amount: amount})
	case "kept":
		key, has := r[RefOwed]
		return j.kept(e, amount, key, has)
	case "refund_owed":
		owed, err := need(RefOwed)
		if err != nil {
			return err
		}
		return j.refundOwed(e, owed, amount, doc)
	case "refund_made":
		et, err := need(RefEvidence)
		if err != nil {
			return err
		}
		ev, err := parseEvidence(et)
		if err != nil {
			return err
		}
		var identity string
		refundID := r[RefRefundID]
		if refundID != "" {
			identity = "made:" + refundID
		} else {
			o, err := need(RefOwed)
			if err != nil {
				return err
			}
			identity = "made:" + o + ":" + string(ev)
		}
		owed, err := need(RefOwed)
		if err != nil {
			return err
		}
		mt, err := need(RefMethod)
		if err != nil {
			return err
		}
		m, err := parseMethod(mt)
		if err != nil {
			return err
		}
		return j.refundMade(e, owed, madeArgs{amount: amount, method: m, evidence: ev, identity: identity, doc: doc, paymentID: r[RefPaymentID]})
	case "refund_cancelled":
		owed, err := need(RefOwed)
		if err != nil {
			return err
		}
		return j.refundCancelled(e, owed)
	case "settled":
		return j.settled(e, amount)
	case "correction":
		rt, err := need(RefReverses)
		if err != nil {
			return err
		}
		seq := JSNumber(rt) // a bare Number(): no check that it is a whole number (a text like " 5" or "5e0" reverses entry 5)
		var lines []Line
		if IsSafeInteger(seq) {
			lines = j.bySeq[int(seq)]
		}
		if len(lines) == 0 {
			return fmt.Errorf("entry %s has no lines to reverse", JSNumberString(seq))
		}
		k := lines[0].Kind
		if k == "refund_owed" || k == "refund_made" || k == "refund_cancelled" || k == "correction" || k == "received" {
			return fmt.Errorf("a %s is corrected by its own flow, never by a correction", k)
		}
		var total int64
		pairs := make([]pair, len(lines))
		for i, l := range lines {
			total += l.DebitPaise
			pairs[i] = pair{l.Account, l.CreditPaise, l.DebitPaise}
		}
		return j.post(e, kind, pairs, postExtra{identity: ident("correction:" + JSNumberString(seq)), amount: total})
	}
	return nil
}

// settled books one row of the settlement report. A payment row: what was credited to the bank, the charge (without its GST) and the GST on it, out of what the payment held at the gateway. A
// refund row: what the gateway took back is out of the bank. Once per row, by the settlement and the row's own id.
func (j *Journal) settled(e Entry, amount int64) error {
	r := e.Refs
	need := func(key string) (string, error) {
		v, ok := r[key]
		if !ok || v == "" {
			return "", fmt.Errorf("a settled line has no %s", key)
		}
		return v, nil
	}
	whole := func(key string) (int64, error) {
		t, err := need(key)
		if err != nil {
			return 0, err
		}
		n, ok := canonicalInt(t)
		if !ok || n < 0 {
			return 0, fmt.Errorf("the %s \"%s\" is not a whole number of paise", key, t)
		}
		return n, nil
	}
	typ, err := need(RefRowType)
	if err != nil {
		return err
	}
	if typ != "payment" && typ != "refund" {
		return fmt.Errorf("\"%s\" is not a settled row this module books (a payment or a refund)", typ)
	}
	fig := SettlementFigures{Type: typ, Amount: amount}
	// the object literal's order: fee, tax, credit, debit
	if fig.Fee, err = whole(RefFee); err != nil {
		return err
	}
	if fig.Tax, err = whole(RefTax); err != nil {
		return err
	}
	if fig.Credit, err = whole(RefCredit); err != nil {
		return err
	}
	if fig.Debit, err = whole(RefDebit); err != nil {
		return err
	}
	check := CheckSettlementRow(fig)
	if !check.OK {
		return fmt.Errorf("a settled %s row is not posted: %s", typ, check.Why)
	}
	basis, err := need(RefBasis)
	if err != nil {
		return err
	}
	if check.Basis != basis {
		return fmt.Errorf("the settled row says its fee is read %s but its figures read %s", basis, check.Basis)
	}
	sid, err := need(RefSettlement)
	if err != nil {
		return err
	}
	entity, err := need(RefEntity)
	if err != nil {
		return err
	}
	identity := "settled:" + sid + ":" + entity
	if _, err := need(RefUTR); err != nil {
		return err
	}
	var pairs []pair
	if typ == "payment" {
		pairs = []pair{{AccBankSettled.Code, fig.Credit, 0}, {AccGatewayFees.Code, check.FeePaise, 0}, {AccGSTOnFees.Code, check.GSTPaise, 0}, {AccGateway.Code, 0, amount}}
	} else {
		pairs = []pair{{AccGateway.Code, amount, 0}, {AccBankSettled.Code, 0, amount}}
	}
	return j.post(e, "settled", pairs, postExtra{evidence: "provider", identity: &identity, amount: amount})
}

// readLegacy reads a line written before this module (frozen).
func (j *Journal) readLegacy(e Entry) error {
	r := e.Refs
	L := j.legacy
	var got *LegacyReceived
	for i := range L.Received {
		if L.Received[i].Action == e.Action && L.Received[i].Outcome == e.Outcome {
			got = &L.Received[i]
			break
		}
	}
	if got != nil {
		pid, ok := r["paymentId"]
		if !ok {
			return fmt.Errorf("an older %s line has no payment id", e.Action)
		}
		byOwner := e.Action == sharedMarkedPaid
		m := Method("gateway")
		ev := Evidence("provider")
		if byOwner {
			m = "upi"
			if r["via"] == "cash" {
				m = "cash"
			}
			ev = "owner_mark"
		}
		amount, err := paiseRef(r, "amountPaise")
		if err != nil {
			return err
		}
		return j.received(e, receivedArgs{amount: amount, paymentID: pid, method: m, evidence: ev, forWhat: got.For})
	}
	if e.Outcome != "confirmed" && !(e.Action == sharedOwedByOwner && e.Outcome == "held_for_owner") {
		return nil
	}
	var applied *LegacyApplied
	for i := range L.Applied {
		if L.Applied[i].Action == e.Action {
			applied = &L.Applied[i]
			break
		}
	}
	if applied != nil && e.Booking != nil {
		held := j.AdvancesOf(*e.Booking)
		if held > 0 {
			return j.post(e, "applied", []pair{{AccAdvances.Code, held, 0}, {applied.Account, 0, held}}, postExtra{identity: ident("applied:" + *e.Booking), amount: held})
		}
		return nil
	}
	if L.FeeCharged != "" && L.FeeCharged == e.Action {
		a, err := paiseRef(r, "amountPaise")
		if err != nil {
			return err
		}
		return j.post(e, "fee_charged", []pair{{AccReceivable.Code, a, 0}, {AccFees.Code, 0, a}}, postExtra{identity: ident("fee:" + caseText(e.Booking)), amount: a})
	}
	if L.LateFee != "" && L.LateFee == e.Action {
		a, err := paiseRef(r, "amountPaise")
		if err != nil {
			return err
		}
		return j.post(e, "late_fee", []pair{{AccReceivable.Code, a, 0}, {AccLateFees.Code, 0, a}}, postExtra{identity: ident("late:" + caseText(e.Booking)), amount: a})
	}
	if L.Discount != "" && L.Discount == e.Action {
		a, err := paiseRef(r, "amountPaise")
		if err != nil {
			return err
		}
		return j.post(e, "discount", []pair{{AccDiscounts.Code, a, 0}, {AccReceivable.Code, 0, a}}, postExtra{amount: a})
	}
	switch e.Action {
	case sharedRefund:
		// A refund the payments service's list showed, or one a person settled by their word (Guard's already_done: refs.confirmedBy, no refund id).
		_, hasConfirmed := r["confirmedBy"]
		_, hasRefundID := r["refundId"]
		byWord := hasConfirmed && !hasRefundID
		pid, ok := r["paymentId"]
		if !ok {
			return errors.New("an older refund line has no payment id")
		}
		key := caseText(e.Booking) + ":" + pid
		amount, err := paiseRef(r, "amountPaise")
		if err != nil {
			return err
		}
		ev := Evidence("provider")
		if byWord {
			ev = "person_word"
		}
		identity := "made:" + key + ":person_word"
		if r["refundId"] != "" {
			identity = "made:" + r["refundId"]
		}
		return j.refundMade(e, key, madeArgs{amount: amount, method: "gateway", evidence: ev, identity: identity, paymentID: pid})
	case sharedOwedByOwner:
		id, ok := r["refundId"]
		if !ok {
			return errors.New("an older refund owed by the owner has no id")
		}
		a, err := paiseRef(r, "amountPaise")
		if err != nil {
			return err
		}
		return j.refundOwed(e, id, a, "")
	case sharedDoneByOwner:
		id, ok := r["refundId"]
		if !ok {
			return errors.New("an older refund marked sent has no id")
		}
		text, present := r["amountPaise"]
		if !present { // `r.amountPaise ?? String(openOwed(id))`: only a missing ref falls back, an empty one is refused
			text, present = strconv.FormatInt(j.OpenOwed(id), 10), true
		}
		a, err := paiseText(text, present)
		if err != nil {
			return err
		}
		return j.refundMade(e, id, madeArgs{amount: a, method: "upi", evidence: "owner_mark", identity: "made:" + id})
	case sharedKeptByOwner:
		id, ok := r["refundId"]
		if !ok {
			return errors.New("an older refund kept by the owner has no id")
		}
		return j.kept(e, 0, id, true)
	}
	return nil
}

// Balances is balances: debits less credits per account over the lines whose time is in [from, to) (both optional; ISO strings compare as text, as in the TypeScript).
func Balances(lines []Line, from, to *string) map[string]int64 {
	out := map[string]int64{}
	for _, l := range lines {
		if (from != nil && l.At < *from) || (to != nil && l.At >= *to) {
			continue
		}
		out[l.Account] += l.DebitPaise - l.CreditPaise
	}
	return out
}

// sortedKeys returns the keys of a map in code-unit order (for the few places a Go map must be listed in some fixed order).
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
