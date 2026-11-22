package orders

// The Orders books: the Go twin of templates/commerce/orders/src/accounting.ts (ordersJournal, ordersAccounting) over the shared books (internal/accounting), as
// internal/bookings/books.go adapts Bookings'. Orders' own older action names (ORDERS_LEGACY: `record_payment` confirmed is the advance, `record_payment` blocked a second payment
// given back, `owner_marked_paid` a UPI advance the owner marked, `complete_order` applies the advance the order then holds) are not retyped here: internal/ordersreport carries
// them as generated from the TypeScript (ordersreport.Legacy), and the journal and the accounting are built over that one copy.
//
// The monthly report's wiring (ordersreport.NewMonthlyJob with the shop's settings tree, record and orders) and the daily settlement read are left to the agent's side (G3's part
// of wave W4); this file is what every money line and every read of the record needs.

import (
	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/ordersreport"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// Legacy is ORDERS_LEGACY.
func Legacy() accounting.LegacyMap { return ordersreport.Legacy() }

// OrdersJournal is accounting.ts ordersJournal: the journal of a record's entries, read with Orders' own action names: what the page's receipts, the owner's Money section and the
// accountant's files are built from.
func OrdersJournal(entries []store.Entry) *accounting.Journal {
	return accounting.BuildJournal(entries, Legacy())
}

// RecordSource is the shop's record as the books use it: the whole of it, and a way to append a line. *runtime.Recorder is one.
type RecordSource interface {
	Entries() []store.Entry
	Append(runtime.NewLine) store.Entry
}

var _ RecordSource = (*runtime.Recorder)(nil)

// recordAdapter is accounting.Record over the shop's record: Append is a runtime.NewLine, so the line gets its keyed digest and its number exactly as the agent's own lines do.
type recordAdapter struct{ r RecordSource }

func (a recordAdapter) Entries() []accounting.Entry { return a.r.Entries() }

// Append is record.ts append: a line without a case is written with a null `booking`.
func (a recordAdapter) Append(n accounting.NewEntry) accounting.Entry {
	booking := ""
	if n.Booking != nil {
		booking = *n.Booking
	}
	return a.r.Append(runtime.NewLine{Conversation: n.Conversation, Booking: booking, Action: n.Action, Outcome: n.Outcome, Inputs: n.Inputs, Language: n.Language, Notes: n.Notes, Refs: n.Refs})
}

// Record is accounting.Record over the shop's record.
func Record(rec RecordSource) accounting.Record { return recordAdapter{rec} }

type clockFunc func() int64

func (f clockFunc) Now() int64 { return f() }

// OrdersAccounting is accounting.ts ordersAccounting: the shop's accounting over the very record the agent's log appends to (an unregistered shop: no tax status is given).
func OrdersAccounting(rec RecordSource, timezone string, now func() int64) (accounting.Accounting, error) {
	return accounting.CreateAccounting(recordAdapter{rec}, accounting.Shop{Timezone: timezone}, Legacy(), clockFunc(now))
}
