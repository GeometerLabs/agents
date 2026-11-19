// The daily settlement read: once a day, the rows the payment service settled yesterday are read and posted to the books (modules/accounting/settlements.ts).
//
// It is the same for Bookings, Orders and Fees: a template calls it from its tick only when its payment module reads settlements. The payments stream's real types do not exist in Go yet, so this
// file defines the two small interfaces it needs (Payments and, from record.go, Record) and a SettlementRow with the fields of modules/payments/payments.ts SettlementRow. The Bookings wave writes
// the adapter: a Payments whose ReadSettlements calls the provider's settlement report (the Razorpay recon read) and returns its rows, and a Record over the shop's store (accounting.Record: Entries
// and Append); the accounting handed in is CreateAccounting over the same record.
//
// What it does, in order: yesterday is read once (with the days since the last one read, at most 7, oldest first; a day that was read has a `settlements_read` line in the record and is not read
// again: the record is the memory, so a restore from a copy cannot read twice; a read that fails writes nothing and is tried again on the next tick); a payment or refund row whose payment the books
// know is posted with Post, once per row; a row that is held is listed and posted when it comes round again settled; a row for a payment the books do not know is listed, not posted; a row whose
// figures fit neither way of reading the fee, or of another kind, is listed and never posted. A listed row is one `settlement_listed` line (no money refs, so the journal ignores it), at most once
// per reason, settlement and row. Where Go differs: the JavaScript is async and a failure is a thrown Error; here a read that fails is an error value, and the job is synchronous (the adapter
// blocks), with the same results.
package accounting

import (
	"fmt"
	"sort"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// SettlementRow is payments.ts SettlementRow: one row of a provider's settlement report. Amounts are paise, times epoch seconds. Nil pointers are the TypeScript's null.
type SettlementRow struct {
	EntityID     string  `json:"entityId"`
	Type         string  `json:"type"` // payment, refund, transfer, adjustment or other
	PaymentID    *string `json:"paymentId"`
	Amount       int64   `json:"amount"`
	Fee          int64   `json:"fee"`
	Tax          int64   `json:"tax"`
	Debit        int64   `json:"debit"`
	Credit       int64   `json:"credit"`
	OnHold       bool    `json:"onHold"`
	Settled      bool    `json:"settled"`
	SettlementID *string `json:"settlementId"`
	UTR          *string `json:"utr"`
	SettledAt    *int64  `json:"settledAt"`
}

// Payments is what the job needs of the payments adapter: whether the provider reads settlements (its capabilities say readsSettlements), and the read of one day.
type Payments interface {
	ReadsSettlements() bool
	ReadSettlements(day zone.Date) ([]SettlementRow, error)
}

// SettlementActions are the record's action names for these lines. Persisted, so never renamed.
var SettlementActions = struct{ Read, Row, Listed string }{SettlementRead, SettlementRow, SettlementListed}

// SettlementsInput is SettlementsInput: the payments adapter, the books, the agent's own record (read for the days already read and the rows already listed, and appended to), who a system line is
// filed under (no customer is ever named) and its language, the moment and the shop's time zone.
type SettlementsInput struct {
	Payments     Payments
	Accounting   Accounting
	Record       Record
	Conversation string
	Language     string
	NowMs        int64
	TimeZone     string
}

// SettlementsResult is SettlementsResult. Status is "read" (the day was read now), "already_read" (nothing done) or "failed" (nothing written, the next tick tries again).
type SettlementsResult struct {
	Status string `json:"status"`
	Day    string `json:"day"`
	Posted int    `json:"posted"`
	Listed int    `json:"listed"`
	Error  string `json:"error,omitempty"`
}

func (i SettlementsInput) line(caseID *string, action, outcome, notes string, inputs any, refs map[string]string) {
	i.Record.Append(NewEntry{Conversation: i.Conversation, Booking: caseID, Action: action, Inputs: inputs, Outcome: outcome, Language: i.Language, Notes: notes, Refs: refs})
}

func dayKey(d zone.Date) string { return fmt.Sprintf("%d-%02d-%02d", d.Year, d.Month, d.Day) }

// YesterdayOf is yesterdayOf: yesterday in the shop's time zone (the day before the one nowMs falls in).
func YesterdayOf(nowMs int64, timeZone string) zone.Date {
	return zone.LocalParts(DayRange(nowMs, timeZone).FromMs-1, timeZone).Date
}

// catchUpDays is how many unread days one tick catches up on, at most.
const catchUpDays = 7

// daysToRead is every day after the last one read up to yesterday (at most catchUpDays), or just yesterday when none was ever read. The last one read is the greatest `refs.day` as
// JavaScript's default sort puts it: by code unit, with a line that has no day sorted last (so such a line makes the last read "none").
func daysToRead(i SettlementsInput, yesterday zone.Date) []zone.Date {
	days := []string{}
	missing := false
	for _, e := range i.Record.Entries() {
		if e.Action != SettlementRead {
			continue
		}
		if d, ok := e.Refs["day"]; ok {
			days = append(days, d)
		} else {
			missing = true
		}
	}
	sort.Strings(days)
	last, hasLast := "", len(days) > 0 && !missing
	if hasLast {
		last = days[len(days)-1]
	}
	out := []zone.Date{}
	for back := 0; back < catchUpDays; back++ {
		d := zone.AddDays(yesterday, -back)
		if hasLast && dayKey(d) <= last {
			break
		}
		out = append([]zone.Date{d}, out...)
		if !hasLast {
			break // never read before: yesterday only
		}
	}
	return out
}

// ReadSettlementsOnce is readSettlementsOnce: read what is unread, oldest day first: normally yesterday. It stops at the first day that fails (a failed read writes nothing, so the next tick
// starts there again).
func ReadSettlementsOnce(i SettlementsInput) SettlementsResult {
	yesterday := YesterdayOf(i.NowMs, i.TimeZone)
	result := SettlementsResult{Status: "already_read", Day: dayKey(yesterday)}
	if !i.Payments.ReadsSettlements() {
		result.Status = "failed"
		result.Error = "This payment module has no settlement read (its capabilities say readsSettlements: false)."
		return result
	}
	for _, day := range daysToRead(i, yesterday) {
		one := readDay(i, day)
		if one.Status == "failed" {
			return SettlementsResult{Status: "failed", Day: result.Day, Posted: result.Posted + one.Posted, Listed: result.Listed + one.Listed, Error: one.Error}
		}
		result.Status = "read"
		result.Posted += one.Posted
		result.Listed += one.Listed
	}
	return result
}

func orEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func readDay(i SettlementsInput, day zone.Date) SettlementsResult {
	key := dayKey(day)
	rows, err := i.Payments.ReadSettlements(day)
	if err != nil {
		return SettlementsResult{Status: "failed", Day: key, Error: err.Error()}
	}
	posted, listed := 0, 0
	list := func(why string, row SettlementRow, notes string, caseID *string) {
		id := why + ":" + orEmpty(row.SettlementID) + ":" + row.EntityID
		for _, e := range i.Record.Entries() {
			if e.Action == SettlementListed && undef(e.Refs, "why")+":"+e.Refs["settlementId"]+":"+undef(e.Refs, "entity") == id {
				return
			}
		}
		i.line(caseID, SettlementListed, "unconfirmed", notes, map[string]any{"entity": row.EntityID}, rowRefs(row, map[string]string{"why": why}))
		listed++
	}
	for _, row := range rows {
		if row.Type != "payment" && row.Type != "refund" {
			why := "other"
			if row.Type == "adjustment" {
				why = "adjustment"
			}
			sid := "?"
			if row.SettlementID != nil {
				sid = *row.SettlementID
			}
			list(why, row, fmt.Sprintf("a %s row of settlement %s: not booked, kept for the settlements file", row.Type, sid), nil)
			continue
		}
		var paymentID *string
		if row.Type == "payment" {
			e := row.EntityID
			paymentID = &e
		} else {
			paymentID = row.PaymentID
		}
		var known *string
		if paymentID != nil {
			known = caseOf(i.Accounting, *paymentID)
		}
		if row.OnHold || !row.Settled {
			list("held", row, "the payment service is holding this row; it is not in the bank", known)
			continue
		}
		if row.SettlementID == nil || row.UTR == nil {
			list("problem", row, "a settled row with no settlement id or bank reference is not posted", known)
			continue
		}
		if known == nil || paymentID == nil {
			list("unknown_payment", row, "a payment that did not go through the assistant: left out of the books", nil)
			continue
		}
		event := MoneyEvent{Kind: "settled", Case: known, SettlementID: *row.SettlementID, UTR: *row.UTR, EntityID: row.EntityID, RowType: row.Type, PaymentID: *paymentID,
			AmountPaise: row.Amount, FeePaise: row.Fee, TaxPaise: row.Tax, CreditPaise: row.Credit, DebitPaise: row.Debit, SettledAt: row.SettledAt}
		done, err := i.Accounting.Post(event, func(money map[string]string) error {
			notes := "the payment service paid this out"
			if len(money) == 0 {
				notes = "already counted"
			}
			i.line(known, SettlementRow, "confirmed", notes, map[string]any{"settlement": *row.SettlementID, "entity": row.EntityID}, money)
			return nil
		})
		if err != nil {
			list("problem", row, err.Error(), known) // a post that threw after its write leaves the row's line in the record; the listing is added as the TypeScript does
			continue
		}
		if done.Posted {
			posted++
		}
	}
	i.line(nil, SettlementRead, "confirmed", fmt.Sprintf("read %d settlement rows for %s", len(rows), key), map[string]any{"day": key},
		map[string]string{"day": key, "rows": strconv.Itoa(len(rows)), "posted": strconv.Itoa(posted), "listed": strconv.Itoa(listed)})
	return SettlementsResult{Status: "read", Day: key, Posted: posted, Listed: listed}
}

// caseOf is the case the books hold this gateway payment under, or nil when the books never counted it.
func caseOf(a Accounting, paymentID string) *string {
	j := a.Journal()
	seq, ok := j.Identity("received:" + paymentID)
	if !ok {
		return nil
	}
	if lines := j.LinesOf(seq); len(lines) > 0 {
		return lines[0].Case
	}
	return nil
}

// rowRefs is the row's own ids and figures as record refs (no customer: a payment id and a settlement are the provider's).
func rowRefs(row SettlementRow, extra map[string]string) map[string]string {
	refs := map[string]string{}
	for k, v := range extra {
		refs[k] = v
	}
	refs["entity"] = row.EntityID
	refs["rowType"] = row.Type
	refs["amountPaise"] = strconv.FormatInt(row.Amount, 10)
	refs["feePaise"] = strconv.FormatInt(row.Fee, 10)
	refs["taxPaise"] = strconv.FormatInt(row.Tax, 10)
	refs["creditPaise"] = strconv.FormatInt(row.Credit, 10)
	refs["debitPaise"] = strconv.FormatInt(row.Debit, 10)
	if row.SettlementID != nil && *row.SettlementID != "" {
		refs["settlementId"] = *row.SettlementID
	}
	if row.UTR != nil && *row.UTR != "" {
		refs["utr"] = *row.UTR
	}
	if row.PaymentID != nil && *row.PaymentID != "" {
		refs["paymentId"] = *row.PaymentID
	}
	if row.SettledAt != nil {
		refs["settledAt"] = strconv.FormatInt(*row.SettledAt, 10)
	}
	return refs
}
