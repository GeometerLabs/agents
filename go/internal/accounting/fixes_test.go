// The TypeScript findings of wave 2 fixed on both sides on 22 Nov 2026, each held here directly (the vectors in testdata hold the same cases against a fresh run of the
// TypeScript): a refund owed that the owner keeps posts with no amount in its line; the borrowed refund amount is whole paise only; a settlement read line with no day does
// not hide the last day read; a settled post that throws after its write is not listed as a problem as well. The TypeScript twins are in modules/accounting/test/.
package accounting

import (
	"errors"
	"testing"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

func fixWorld(t *testing.T) (*memRecord, Accounting) {
	t.Helper()
	rec := &memRecord{now: 1_794_000_000_000} // 6 Nov 2026
	acc, err := CreateAccounting(rec, Shop{Timezone: "Asia/Kolkata"}, LegacyMap{Received: []LegacyReceived{{Action: "record_deposit", Outcome: "confirmed", For: "advance"}}}, rec)
	if err != nil {
		t.Fatal(err)
	}
	return rec, acc
}

func fixPost(t *testing.T, rec *memRecord, acc Accounting, e MoneyEvent, action, outcome string) Posted {
	t.Helper()
	p, err := acc.Post(e, func(refs map[string]string) error {
		rec.Append(NewEntry{Conversation: "+919800000001", Booking: e.Case, Action: action, Outcome: outcome, Language: "en", Refs: refs})
		return nil
	})
	if err != nil {
		t.Fatalf("%s: %v", e.Kind, err)
	}
	return p
}

func TestKeptOwedNeedsNoAmount(t *testing.T) {
	rec, acc := fixWorld(t)
	c, owed := "b-9", "upr-9"
	fixPost(t, rec, acc, MoneyEvent{Kind: "received", Case: &c, PaymentID: "pay_9", AmountPaise: 25_000, Method: "gateway", Evidence: "provider", For: "advance"}, "record_deposit", "confirmed")
	fixPost(t, rec, acc, MoneyEvent{Kind: "refund_owed", Case: &c, Owed: &owed, PaymentID: "pay_9", AmountPaise: 25_000}, "upi_refund_owed", "held_for_owner")
	if p := fixPost(t, rec, acc, MoneyEvent{Kind: "kept", Case: &c, Owed: &owed, Why: "late_mark_kept"}, "upi_refund_kept", "confirmed"); !p.Posted {
		t.Fatalf("kept: %+v", p)
	}
	j := acc.Journal()
	if len(j.Problems) != 0 || j.OpenOwed("upr-9") != 0 {
		t.Fatalf("problems %v, open %d", j.Problems, j.OpenOwed("upr-9"))
	}
	if p := fixPost(t, rec, acc, MoneyEvent{Kind: "kept", Case: &c, Owed: &owed, Why: "late_mark_kept"}, "upi_refund_kept", "confirmed"); p.Posted {
		t.Fatal("a second keep was posted")
	}
}

func TestBorrowedRefundAmountIsWholePaise(t *testing.T) {
	figures := func(amount string) MonthFigures {
		rec, acc := fixWorld(t)
		c := "b-1"
		rec.Append(NewEntry{Booking: &c, Action: "refund", Outcome: "confirmed", Refs: map[string]string{"paymentId": "pay_1", "refundId": "rf_1", "amountPaise": amount}})
		rec.Append(NewEntry{Booking: &c, Action: "refund", Outcome: "confirmed", Refs: map[string]string{"paymentId": "pay_1", "refundId": "rf_2"}})
		return FiguresOf(acc.Journal(), rec.Entries(), LegacyMap{}, "2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z", FigureOptions{RefundAmountFromPayment: true})
	}
	if f := figures("1000"); f.Refunds.Paise != 2000 || f.Missing.RefundAmounts != 0 {
		t.Fatalf("whole: %+v", f.Refunds)
	}
	for _, bad := range []string{"1e3", "12.5", "0x10"} {
		if f := figures(bad); f.Refunds.Paise != 0 || f.Missing.RefundAmounts != 2 {
			t.Fatalf("%s: %+v %+v", bad, f.Refunds, f.Missing)
		}
	}
}

type dayPayments struct{ asked []int }

func (p *dayPayments) ReadsSettlements() bool { return true }
func (p *dayPayments) ReadSettlements(d zone.Date) ([]SettlementRow, error) {
	p.asked = append(p.asked, d.Day)
	return []SettlementRow{}, nil
}

func TestSettlementReadLineWithNoDay(t *testing.T) {
	rec, acc := fixWorld(t)
	p := &dayPayments{}
	in := func(now int64) SettlementsInput {
		return SettlementsInput{Payments: p, Accounting: acc, Record: rec, Conversation: "+919800000001", Language: "en", NowMs: now, TimeZone: "Asia/Kolkata"}
	}
	nov13 := int64(1_794_544_200_000) // 13 Nov 2026, 10:00 in India
	ReadSettlementsOnce(in(nov13))
	rec.Append(NewEntry{Action: SettlementRead, Outcome: "confirmed", Refs: map[string]string{}})
	ReadSettlementsOnce(in(nov13 + 3*86_400_000))
	if want := []int{12, 13, 14, 15}; len(p.asked) != 4 || p.asked[0] != 12 || p.asked[3] != 15 {
		t.Fatalf("asked %v, want %v", p.asked, want)
	}
}

// throwingBooks posts nothing: it writes the row's line (or not) and then fails, as a read-back failure (after) or a refused fee (before) does.
type throwingBooks struct {
	Accounting
	write bool
}

func (b throwingBooks) Post(e MoneyEvent, write WriteMoneyLine) (Posted, error) {
	if b.write {
		_ = write(map[string]string{"money": "settled"})
	}
	return Posted{}, errors.New("the settled line cannot be read as money")
}

func TestSettledPostThatThrowsAfterItsWrite(t *testing.T) {
	for _, after := range []bool{true, false} {
		rec, acc := fixWorld(t)
		c := "b-1"
		fixPost(t, rec, acc, MoneyEvent{Kind: "received", Case: &c, PaymentID: "pay_1", AmountPaise: 10_000, Method: "gateway", Evidence: "provider", For: "advance"}, "record_deposit", "confirmed")
		s, u, at := "setl_1", "UTR1", int64(1_794_454_200)
		rows := []SettlementRow{{EntityID: "pay_1", Type: "payment", Amount: 10_000, Fee: 200, Tax: 36, Credit: 9_764, Settled: true, SettlementID: &s, UTR: &u, SettledAt: &at}}
		r := ReadSettlementsOnce(SettlementsInput{Payments: rowsPayments(rows), Accounting: throwingBooks{acc, after}, Record: rec, Conversation: "+919800000001", Language: "en", NowMs: 1_794_544_200_000, TimeZone: "Asia/Kolkata"})
		want := 1
		if after {
			want = 0
		}
		if r.Posted != 0 || r.Listed != want {
			t.Fatalf("after=%v: %+v", after, r)
		}
	}
}

type rowsPayments []SettlementRow

func (p rowsPayments) ReadsSettlements() bool                             { return true }
func (p rowsPayments) ReadSettlements(zone.Date) ([]SettlementRow, error) { return p, nil }
