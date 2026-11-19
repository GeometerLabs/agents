// What a shop whose payments the owner marks (UPI today) still owes a person, read from the record alone: the payments the owner has not yet confirmed, and the refunds the owner owes and has
// not yet marked done. This is modules/payments/owner-marked/obligations.ts `markObligations` and the names it reads (MARK_ACTIONS), ported here because the owner's Money view needs exactly
// this and nothing else of that file (the kinds for the unfinished-work registry stay TypeScript). The payments stream may later own it; until then it is here with its own vectors.
//
// Where Go differs from JavaScript: the amounts are the TypeScript's `Number(r.amountPaise)`, a double, kept as float64 inside this fold (a missing or odd text is NaN, which is never "> 0" and
// so never listed as unconfirmed, but a refund owed is listed whatever its amount text); a Map's insertion order (requests, refunds owed) is kept in order slices, with Map.set on a key
// already there keeping its first place; the final sort is `a.since.localeCompare(b.since) || a.id.localeCompare(b.id)` (golang.org/x/text/collate, English, as export.go does).
package accounting

import (
	"sort"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// The record's names for payments the owner marks, the same in every template (MARK_ACTIONS). They keep their "upi_" values: records already written use them.
const (
	MarkRequest        = "upi_request"
	MarkClaim          = "upi_paid_claim"
	MarkMarked         = "owner_marked_paid"
	MarkClosed         = "upi_request_closed"
	MarkRefundOwed     = "upi_refund_owed"
	MarkRefundDone     = "upi_refund_marked_done"
	MarkRefundKept     = "upi_refund_kept"
	MarkRefundReminder = "upi_refund_reminder"
)

// ObligationTitles is OBLIGATION_TITLES.
var ObligationTitles = map[string]string{
	"upi_payment_unconfirmed": "UPI payment not yet confirmed by the owner",
	"upi_refund_owed":         "Refund owed by the owner, not yet marked done",
}

// MarkObligation is obligations.ts MarkObligation. AmountPaise is a double, as the TypeScript's number is.
type MarkObligation struct {
	Kind        string  `json:"kind"`
	Case        string  `json:"case"`
	Customer    string  `json:"customer"`
	AmountPaise float64 `json:"amountPaise"`
	Since       string  `json:"since"`
	ID          string  `json:"id"`
	Title       string  `json:"title"`
}

func confirmed(e Entry) bool { return e.Outcome == "confirmed" }

// MarkObligations is markObligations: the open owner-marked obligations in this record, oldest first.
func MarkObligations(entries []Entry) []MarkObligation {
	type request struct {
		entry  Entry
		amount float64
		reason *Entry
	}
	requests := map[string]*request{}
	requestOrder := []string{}
	markedOn := map[string]float64{}
	closed := map[string]bool{}
	type owedRec struct {
		entry  Entry
		amount float64
	}
	owed := map[string]owedRec{}
	owedOrder := []string{}
	settled := map[string]bool{}
	for _, e := range entries {
		r := e.Refs
		switch {
		case e.Action == MarkRequest && confirmed(e) && r["requestId"] != "":
			if _, ok := requests[r["requestId"]]; !ok {
				requestOrder = append(requestOrder, r["requestId"])
			}
			requests[r["requestId"]] = &request{entry: e, amount: JSNumber(r["amountPaise"])} // Number(undefined) is NaN, which JSNumber("") is not: handled below
			if _, ok := r["amountPaise"]; !ok {
				requests[r["requestId"]].amount = nan()
			}
		case e.Action == MarkClaim && r["requestId"] != "":
			if q := requests[r["requestId"]]; q != nil && q.reason == nil {
				ee := e
				q.reason = &ee
			}
		case e.Action == MarkMarked && confirmed(e) && r["requestId"] != "":
			amt := JSNumber(r["amountPaise"])
			if _, ok := r["amountPaise"]; !ok {
				amt = nan()
			}
			markedOn[r["requestId"]] += amt
			if q := requests[r["requestId"]]; q != nil {
				ee := e
				q.reason = &ee // a part marked: the rest is now the owner's to look for, from this mark on
			}
		case e.Action == MarkClosed && confirmed(e) && r["requestId"] != "":
			closed[r["requestId"]] = true
		case e.Action == MarkRefundOwed && e.Outcome == "held_for_owner" && r["refundId"] != "":
			amt := JSNumber(r["amountPaise"])
			if _, ok := r["amountPaise"]; !ok {
				amt = nan()
			}
			if _, ok := owed[r["refundId"]]; !ok {
				owedOrder = append(owedOrder, r["refundId"])
			}
			owed[r["refundId"]] = owedRec{e, amt}
		case (e.Action == MarkRefundDone || e.Action == MarkRefundKept) && confirmed(e) && r["refundId"] != "":
			settled[r["refundId"]] = true
		}
	}
	out := []MarkObligation{}
	for _, id := range requestOrder {
		q := requests[id]
		left := q.amount - markedOn[id]
		if left > 0 && q.reason != nil && !closed[id] {
			c := ""
			if q.entry.Booking != nil {
				c = *q.entry.Booking
			}
			out = append(out, MarkObligation{"upi_payment_unconfirmed", c, q.entry.Conversation, left, q.reason.Time, id, ObligationTitles["upi_payment_unconfirmed"]})
		}
	}
	for _, id := range owedOrder {
		o := owed[id]
		if !settled[id] {
			c := ""
			if o.entry.Booking != nil {
				c = *o.entry.Booking
			}
			out = append(out, MarkObligation{"upi_refund_owed", c, o.entry.Conversation, o.amount, o.entry.Time, id, ObligationTitles["upi_refund_owed"]})
		}
	}
	coll := collate.New(language.English)
	sort.SliceStable(out, func(a, b int) bool {
		if c := coll.CompareString(out[a].Since, out[b].Since); c != 0 {
			return c < 0
		}
		return coll.CompareString(out[a].ID, out[b].ID) < 0
	})
	return out
}
