package payments

import (
	"testing"

	"github.com/GeometerLabs/agents/go/internal/accounting"
)

// recordOf is a one-case record that appends what write is asked to, the way a template's own line would.
type recordOf struct{ entries []accounting.Entry }

func (r *recordOf) Entries() []accounting.Entry { return r.entries }

type clock int64

func (c clock) Now() int64 { return int64(c) }

func TestBooksPostsARefundOwedThenMadeOnce(t *testing.T) {
	rec := &recordOf{}
	acc, err := accounting.CreateAccounting(rec, accounting.Shop{Timezone: "Asia/Kolkata"}, accounting.BookingsLegacy, clock(1_763_500_000_000))
	if err != nil {
		t.Fatal(err)
	}
	books := Books{A: acc}
	line := func(booking, action string) func(map[string]string) {
		return func(refs map[string]string) {
			b := booking
			rec.entries = append(rec.entries, accounting.Entry{Seq: len(rec.entries) + 1, Time: "2026-11-18T10:00:00.000Z", Booking: &b, Action: action, Outcome: "confirmed", Refs: refs})
		}
	}
	// the customer's deposit, as the journal reads an older confirmed record_deposit line
	b := "b-1"
	rec.entries = append(rec.entries, accounting.Entry{Seq: 1, Time: "2026-11-18T09:00:00.000Z", Booking: &b, Action: "record_deposit", Outcome: "confirmed", Refs: map[string]string{"paymentId": "pay_1", "amountPaise": "20000"}})
	books.Post(MoneyEvent{Kind: "refund_owed", Case: "b-1", Owed: "b-1:pay_1", PaymentID: "pay_1", AmountPaise: 20000}, line("b-1", "refund"))
	books.Post(MoneyEvent{Kind: "refund_made", Case: "b-1", Owed: "b-1:pay_1", PaymentID: "pay_1", AmountPaise: 20000, Method: "gateway", Evidence: "provider", RefundID: "rfnd_1"}, line("b-1", "refund"))
	// a second post of the same refund counts nothing and writes no money refs
	var second map[string]string
	books.Post(MoneyEvent{Kind: "refund_made", Case: "b-1", Owed: "b-1:pay_1", PaymentID: "pay_1", AmountPaise: 20000, Method: "gateway", Evidence: "provider", RefundID: "rfnd_1"}, func(m map[string]string) { second = m; line("b-1", "refund")(m) })
	if len(second) != 0 {
		t.Fatalf("a repeat must write no money refs, got %v", second)
	}
	j := acc.Journal()
	if got := j.OwedList(); len(got) != 0 {
		t.Fatalf("nothing should still be owed, got %v", got)
	}
	if rec.entries[2].Refs["money"] != "refund_made" || rec.entries[2].Refs["doc"] == "" {
		t.Fatalf("the made refund should carry its money kind and a refund note number: %v", rec.entries[2].Refs)
	}
}

func TestBooksPanicsWhenTheBooksRefuse(t *testing.T) {
	acc, _ := accounting.CreateAccounting(&recordOf{}, accounting.Shop{Timezone: "Asia/Kolkata"}, accounting.BookingsLegacy, clock(0))
	defer func() {
		if _, ok := recover().(BooksError); !ok {
			t.Fatal("a refused amount must panic with a BooksError, as post.ts throws")
		}
	}()
	Books{A: acc}.Post(MoneyEvent{Kind: "refund_owed", Case: "b-1", Owed: "k", AmountPaise: 0}, func(map[string]string) {})
}
