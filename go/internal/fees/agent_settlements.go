package fees

// The daily settlement read on a Fees centre whose gateway reads settlements (Razorpay): agent.ts onTick's
// `if (can.readsSettlements) await readSettlementsOnce({payments, accounting: books, record, conversation: owner, language: settings.languages[0], nowMs: now, timeZone: tz})`.
// Yesterday's rows are read once a day and posted to the Fees books (modules/accounting/settlements.ts, internal/accounting ReadSettlementsOnce). The read itself is Bookings'
// shared books adapter (internal/bookings books.go: the record adapter and the settlement rows), so there is one copy of it; the only thing here is that the gateway's call is
// watched as the agent's own (a Guard found down parks the step, as every other call of the step does), as internal/orders' readSettlements watches it. Added 23 Nov 2026
// (go-fees-gaps-23nov); until then a Razorpay centre on Go posted no settlement rows.

import (
	"context"

	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/payments"
)

// readSettlements runs the read when the centre's gateway has one; a UPI centre (no payments client) and a provider without the read read none. A failed read is in the
// record (no `settlements_read` line for that day), and the next beat tries again.
func (a *Agent) readSettlements(now int64) {
	if !a.can.ReadsSettlements {
		return
	}
	sr, ok := a.kit.Ports.Payments.(payments.SettlementReader)
	if !ok {
		return
	}
	books := bookings.NewBooks(bookings.BooksPorts{Settlements: watchedSettlements{a, sr}, Capabilities: a.can, Context: a.ctx})
	books.ReadSettlements(a.c.Rec, a.accounts(), a.owner(), a.settings.Languages[0], now, a.settings.Timezone)
}

// watchedSettlements is the gateway's settlement read through the step's watch (the operation name is internal/orders' "listRequests": a read of the gateway's lists).
type watchedSettlements struct {
	a *Agent
	r payments.SettlementReader
}

func (w watchedSettlements) ReadSettlements(ctx context.Context, day payments.Day, pageSize int) (rows []payments.SettlementRow, err error) {
	err = w.a.watch.Do("payments", "listRequests", func() error {
		var e error
		rows, e = w.r.ReadSettlements(ctx, day, pageSize)
		return e
	})
	return rows, err
}
