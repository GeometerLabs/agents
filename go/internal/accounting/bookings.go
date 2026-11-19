// What Bookings hands the accounting core (templates/commerce/bookings/src/accounting.ts): its own action names, frozen, so the core can read a record written before the core existed.
//
// The map lives with the template in the TypeScript because a module imports nothing from a template; here the package is shared by the Go runtimes and the Bookings one is the first, so its map is
// a variable beside the core and the other templates write theirs the same way. The map is frozen: new lines carry `refs.money` (post.go) and never need it. `record_deposit` confirmed is the
// deposit, `record_deposit` blocked is a second payment on the same link (given back, never revenue), `owner_marked_paid` is a UPI deposit the owner marked, and `complete_booking` applies the
// deposit the booking then holds. A test holds it equal to the TypeScript's BOOKINGS_LEGACY (the vectors carry it).
package accounting

// BookingsLegacy is BOOKINGS_LEGACY.
var BookingsLegacy = LegacyMap{
	Received: []LegacyReceived{
		{Action: "record_deposit", Outcome: "confirmed", For: "advance"},
		{Action: "record_deposit", Outcome: "blocked", For: "extra"},
		{Action: "owner_marked_paid", Outcome: "confirmed", For: "advance"},
	},
	Applied: []LegacyApplied{{Action: "complete_booking", Account: "revenue:bookings"}},
}

// BookingsJournal is bookingsJournal: the journal of a record's entries, read with Bookings' own action names: what the page's receipts, the owner's Money section and the accountant's files are
// built from.
func BookingsJournal(entries []Entry) *Journal { return BuildJournal(entries, BookingsLegacy) }

// BookingsAccounting is bookingsAccounting: the shop's accounting over the same record the agent's log appends to (an unregistered shop: no tax status is given).
func BookingsAccounting(record Reader, timezone string, clock Clock) (Accounting, error) {
	return CreateAccounting(record, Shop{Timezone: timezone}, BookingsLegacy, clock)
}
