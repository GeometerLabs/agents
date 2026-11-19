// The owner's money view: what the Money section of the owner's app shows, as plain figures in paise, worked out from the journal and the record alone (modules/accounting/owner-money.ts).
//
// The page words them (internal/accounting/render); the figures are what must be right, so they are tested one by one against the TypeScript. What counts: received (the payment's own side:
// cash, UPI, bank or gateway), so a payment counts once; given back (except a refund settled by a person's word, which is listed on its own); kept from cancellations; the payment service's
// charges; what open fees are still owed (Fees only); the refunds owed back; and what the books cannot match to money on their own (a UPI payment a customer says they made, a gateway payment with
// no payout after more than 4 working days, a row the service is holding, a payout for a payment that did not go through the assistant, a refund made whose customer was not told). A customer's
// number and a student's name are never in the view. No clock and no settings are read: "now" and the time zone are handed in.
//
// Where Go differs from JavaScript: `Date.parse` is ParseISO; a Set or Map keyed by `string | null` keeps nil and the text "null" apart as the TypeScript does (a Go map keyed by a pointer
// would not); `Number(e.refs.amountPaise)` of a listed row is a whole number of paise here (the settlement job writes String(int), and a text that is not whole reads as 0, noted in Deferred.md);
// `Math.round(inr * 100)` is RoundHalfUp of the double `inr * 100` (jsnum.go), formed in a variable first so no fused multiply-add changes it.
package accounting

import (
	"encoding/json"
	"regexp"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// UntoldInput is a refund made whose customer was not told yet, as the cases hold it, with the case it belongs to. Rupees, as the provider's list gives them.
type UntoldInput struct {
	Case      string  `json:"case"`
	AmountInr float64 `json:"amountInr"`
}

// MoneyViewInput is owner-money.ts MoneyViewInput.
type MoneyViewInput struct {
	Journal       *Journal
	Entries       []Entry
	RefundsUntold []UntoldInput
	NowMs         int64
	TimeZone      string
}

// MoneyTally is owner-money.ts Tally.
type MoneyTally struct {
	Paise int64 `json:"paise"`
	Count int   `json:"count"`
}

// NotMatched is one thing the books cannot match to money on their own. Kind is "upi_claim", "gateway", "gateway_held", "not_through_assistant" or "untold_refund"; the fields a kind does not
// have are left out of its JSON, as the TypeScript's variants do (not_through_assistant has no case; only gateway has sinceMs).
type NotMatched struct {
	Kind    string
	Case    *string
	Paise   int64
	SinceMs int64
}

// MarshalJSON writes the variant of the TypeScript's NotMatched union that the Kind names.
func (n NotMatched) MarshalJSON() ([]byte, error) {
	switch n.Kind {
	case "not_through_assistant":
		return json.Marshal(struct {
			Kind  string `json:"kind"`
			Paise int64  `json:"paise"`
		}{n.Kind, n.Paise})
	case "gateway":
		return json.Marshal(struct {
			Kind    string  `json:"kind"`
			Case    *string `json:"case"`
			Paise   int64   `json:"paise"`
			SinceMs int64   `json:"sinceMs"`
		}{n.Kind, n.Case, n.Paise, n.SinceMs})
	}
	return json.Marshal(struct {
		Kind  string  `json:"kind"`
		Case  *string `json:"case"`
		Paise int64   `json:"paise"`
	}{n.Kind, n.Case, n.Paise})
}

// OwedBack is a refund still owed, and why.
type OwedBack struct {
	Case  *string `json:"case"`
	Paise int64   `json:"paise"`
	Why   string  `json:"why"` // "owner_pays_upi" or "payment_service"
}

// ByWordRefund is a refund made in the month on a person's word.
type ByWordRefund struct {
	Case  *string `json:"case"`
	Paise int64   `json:"paise"`
	AtMs  int64   `json:"atMs"`
}

// MoneyMonth is the month part of the view.
type MoneyMonth struct {
	Received            MoneyTally  `json:"received"`
	GivenBack           MoneyTally  `json:"givenBack"`
	KeptPaise           int64       `json:"keptPaise"`
	GatewayChargesPaise int64       `json:"gatewayChargesPaise"`
	StillToCome         *MoneyTally `json:"stillToCome"`
}

// MoneyToday is the day part of the view.
type MoneyToday struct {
	Received  MoneyTally `json:"received"`
	GivenBack MoneyTally `json:"givenBack"`
}

// MoneyView is owner-money.ts MoneyView.
type MoneyView struct {
	Today            MoneyToday     `json:"today"`
	Month            MoneyMonth     `json:"month"`
	ByWord           []ByWordRefund `json:"byWord"`
	OwedBack         []OwedBack     `json:"owedBack"`
	NotMatched       []NotMatched   `json:"notMatched"`
	Period           string         `json:"period"`
	ReadsSettlements bool           `json:"readsSettlements"`
	PayoutsUnchecked bool           `json:"payoutsUnchecked"`
}

var moneyAccounts = map[string]bool{AccCash.Code: true, AccUPI.Code: true, AccBank.Code: true, AccGateway.Code: true, AccBankSettled.Code: true}

// settlesWithinWorkingDays: a gateway payment is "not yet in your bank" once more than this many working days have passed.
const settlesWithinWorkingDays = 4

// workingDaysSince counts the working days after a payment's day, up to and including today (Monday to Friday, local dates).
func workingDaysSince(thenMs, nowMs int64, timeZone string) int {
	from := zone.LocalParts(thenMs, timeZone)
	days := zone.DaysBetween(from.Date, zone.LocalParts(nowMs, timeZone).Date)
	n := 0
	for k := 1; k <= days; k++ {
		if w := zone.WeekdayOf(zone.AddDays(from.Date, k)); w != 0 && w != 6 {
			n++
		}
	}
	return n
}

// toPaise is `Math.round(inr * 100)`: whole paise of the rupees the provider's list gave.
func toPaise(inr float64) int64 {
	x := float64(inr * 100) // an explicit conversion: no fused multiply-add may skip the rounding of the product
	return int64(RoundHalfUp(x))
}

func tallyLines(lines []Line, kind MoneyKind, debit bool, rng Range, keep func(Line) bool) MoneyTally {
	seqs := map[int]bool{}
	var paise int64
	for _, l := range lines {
		at, ok := ParseISO(l.At)
		side := l.CreditPaise
		if debit {
			side = l.DebitPaise
		}
		if l.Kind != kind || !moneyAccounts[l.Account] || side == 0 || !ok || at < rng.FromMs || at >= rng.ToMs || !keep(l) {
			continue
		}
		paise += side
		seqs[l.Seq] = true
	}
	return MoneyTally{paise, len(seqs)}
}

func netLines(lines []Line, accounts []string, rng Range) int64 {
	var n int64
	for _, l := range lines {
		at, ok := ParseISO(l.At)
		in := false
		for _, a := range accounts {
			if a == l.Account {
				in = true
			}
		}
		if in && ok && at >= rng.FromMs && at < rng.ToMs {
			n += l.DebitPaise - l.CreditPaise
		}
	}
	return n
}

var upiRefundKey = regexp.MustCompile(`^upr-[0-9]+$`)

// owedWhy is the refund's owner-paid kind: the owner-marked ledger's ids are `upr-N`; a gateway refund's key is `<case>:<payment>`.
func owedWhy(key string) string {
	if upiRefundKey.MatchString(key) {
		return "owner_pays_upi"
	}
	return "payment_service"
}

// caseKey keeps a nil case and a case named "null" apart (a Map<string | null, ...>).
type caseKey struct {
	isNil bool
	s     string
}

func keyOf(c *string) caseKey {
	if c == nil {
		return caseKey{isNil: true}
	}
	return caseKey{s: *c}
}

// entityKey is `e.refs.entity` as a Map or Set key: a missing ref (undefined) is its own value.
func entityKey(e Entry) string {
	if v, ok := e.Refs[RefEntity]; ok {
		return "1" + v
	}
	return "0"
}

// refAmountNumber is `Number(e.refs.amountPaise)` kept as whole paise (see the file comment).
func refAmountNumber(e Entry) int64 {
	f := JSNumber(e.Refs["amountPaise"])
	if _, ok := e.Refs["amountPaise"]; !ok || !IsSafeInteger(f) {
		return 0
	}
	return int64(f)
}

// OwnerMoney is ownerMoney: the Money section's figures.
func OwnerMoney(in MoneyViewInput) MoneyView {
	lines := in.Journal.Lines
	day := DayRange(in.NowMs, in.TimeZone)
	p := zone.LocalParts(in.NowMs, in.TimeZone)
	month := MonthRange(p.Year, p.Month, in.TimeZone)
	byWordLine := func(l Line) bool { return l.Evidence == "person_word" }
	notByWord := func(l Line) bool { return !byWordLine(l) }
	always := func(Line) bool { return true }
	inMonth := func(iso string) bool { t, ok := ParseISO(iso); return ok && t >= month.FromMs && t < month.ToMs }

	stillToCome := func() *MoneyTally {
		cases := map[caseKey]bool{}
		order := []caseKey{}
		for _, l := range lines {
			if l.Account == AccReceivable.Code {
				if k := keyOf(l.Case); !cases[k] {
					cases[k] = true
					order = append(order, k)
				}
			}
		}
		if len(order) == 0 {
			return nil
		}
		var paise int64
		count := 0
		for _, c := range order {
			var owed int64
			if !c.isNil {
				owed = in.Journal.ReceivableOf(c.s) // negative: paid beyond the fee, which is not "still to come"
			}
			if owed > 0 {
				paise += owed
				count++
			}
		}
		return &MoneyTally{paise, count}
	}

	byWord := []ByWordRefund{}
	for _, l := range lines {
		if l.Kind == "refund_made" && byWordLine(l) && l.CreditPaise > 0 && moneyAccounts[l.Account] && inMonth(l.At) {
			at, _ := ParseISO(l.At)
			byWord = append(byWord, ByWordRefund{l.Case, l.CreditPaise, at})
		}
	}

	// Payments the payment service has paid into the bank (a `settled` row), and what is held or was not through the assistant, from the record's own settlement lines.
	readsSettlements := false
	for _, e := range in.Entries {
		if e.Action == SettlementRead {
			readsSettlements = true
		}
	}
	settledEntities := map[string]bool{}
	for _, e := range in.Entries {
		if e.Refs[RefKind] == "settled" {
			settledEntities[entityKey(e)] = true
		}
	}
	seqRefs := map[int]map[string]string{}
	for _, e := range in.Entries {
		seqRefs[e.Seq] = e.Refs
	}
	// A payment that came through the payment service and has no payout after more than 4 working days, while its case still holds money there.
	heldInGateway := map[caseKey]int64{}
	for _, l := range lines {
		if l.Account == AccGateway.Code {
			heldInGateway[keyOf(l.Case)] += l.DebitPaise - l.CreditPaise
		}
	}
	listed := func(why string) []Entry {
		out := []Entry{}
		for _, e := range in.Entries {
			if e.Action == SettlementListed && e.Refs["why"] == why && inMonth(e.Time) {
				out = append(out, e)
			}
		}
		return out
	}
	once := func(rows []Entry) []Entry {
		out := []Entry{}
		seen := map[string]bool{}
		for _, e := range rows {
			if k := entityKey(e); !seen[k] {
				seen[k] = true
				out = append(out, e)
			}
		}
		return out
	}
	// A held row is listed as held, and not also as "not yet in your bank". Held and not-through-the-assistant rows are listed for the month they were found in.
	heldRows := []Entry{}
	for _, e := range once(listed("held")) {
		if !settledEntities[entityKey(e)] {
			heldRows = append(heldRows, e)
		}
	}
	heldIDs := map[string]bool{}
	for _, e := range heldRows {
		heldIDs["1"+e.Refs[RefEntity]] = true
	}
	gatewayUnpaid := []NotMatched{}
	for _, l := range lines {
		if !(l.Kind == "received" && l.Account == AccGateway.Code && l.DebitPaise > 0) {
			continue
		}
		paymentID, has := seqRefs[l.Seq][RefPaymentID]
		if !readsSettlements || !has || settledEntities["1"+paymentID] || heldIDs["1"+paymentID] || heldInGateway[keyOf(l.Case)] <= 0 {
			continue
		}
		at, _ := ParseISO(l.At)
		if workingDaysSince(at, in.NowMs, in.TimeZone) > settlesWithinWorkingDays {
			gatewayUnpaid = append(gatewayUnpaid, NotMatched{Kind: "gateway", Case: l.Case, Paise: l.DebitPaise, SinceMs: at})
		}
	}
	held := []NotMatched{}
	for _, e := range heldRows {
		held = append(held, NotMatched{Kind: "gateway_held", Case: e.Booking, Paise: refAmountNumber(e)})
	}
	notThrough := []NotMatched{}
	for _, e := range once(listed("unknown_payment")) {
		if e.Refs[RefRowType] == "payment" {
			notThrough = append(notThrough, NotMatched{Kind: "not_through_assistant", Paise: refAmountNumber(e)})
		}
	}

	notMatched := []NotMatched{}
	for _, o := range MarkObligations(in.Entries) {
		if o.Kind != "upi_payment_unconfirmed" {
			continue
		}
		var c *string
		if o.Case != "" { // `o.case || null`
			cc := o.Case
			c = &cc
		}
		notMatched = append(notMatched, NotMatched{Kind: "upi_claim", Case: c, Paise: int64(o.AmountPaise)})
	}
	notMatched = append(notMatched, gatewayUnpaid...)
	notMatched = append(notMatched, held...)
	notMatched = append(notMatched, notThrough...)
	for _, u := range in.RefundsUntold {
		c := u.Case
		notMatched = append(notMatched, NotMatched{Kind: "untold_refund", Case: &c, Paise: toPaise(u.AmountInr)})
	}

	owedBack := []OwedBack{}
	for _, o := range in.Journal.OwedList() {
		owedBack = append(owedBack, OwedBack{o.Case, o.Paise, owedWhy(o.Key)})
	}
	payoutsUnchecked := false
	if !readsSettlements {
		for _, l := range lines {
			if l.Account == AccGateway.Code && l.DebitPaise > 0 {
				payoutsUnchecked = true
			}
		}
	}
	return MoneyView{
		Today: MoneyToday{tallyLines(lines, "received", true, day, always), tallyLines(lines, "refund_made", false, day, notByWord)},
		Month: MoneyMonth{
			Received:            tallyLines(lines, "received", true, month, always),
			GivenBack:           tallyLines(lines, "refund_made", false, month, notByWord),
			KeptPaise:           -netLines(lines, []string{AccKept.Code}, month),
			GatewayChargesPaise: netLines(lines, []string{AccGatewayFees.Code, AccGSTOnFees.Code}, month),
			StillToCome:         stillToCome(),
		},
		ByWord: byWord, OwedBack: owedBack, NotMatched: notMatched,
		Period: fmtPeriod(p.Year, p.Month), ReadsSettlements: readsSettlements, PayoutsUnchecked: payoutsUnchecked,
	}
}
