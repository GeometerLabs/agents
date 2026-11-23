// What Fees hands the accounting core (templates/education/fees/src/accounting.ts): its own action names, frozen, so the core can read a record written before the core existed;
// and which fees are old dues (the owner decided, 17 Nov 2026, that old dues are told apart in the report and marked in the accountant's files, never posted differently).
// Written beside BookingsLegacy, the way bookings.go says the other templates write theirs (wave 3).
package accounting

// FeesLegacy is FEES_LEGACY: a payment is for a fee (`record_payment` confirmed; `owner_marked_paid` the owner's UPI, cash or bank mark), `open_fee` charges the month's fee,
// `add_late_fee` a late fee, and `waive_fee` is a discount on what the parent owes.
var FeesLegacy = LegacyMap{
	Received: []LegacyReceived{
		{Action: "record_payment", Outcome: "confirmed", For: "fee"},
		{Action: "owner_marked_paid", Outcome: "confirmed", For: "fee"},
	},
	FeeCharged: "open_fee",
	LateFee:    "add_late_fee",
	Discount:   "waive_fee",
}

// FeesJournal is feesJournal.
func FeesJournal(entries []Entry) *Journal { return BuildJournal(entries, FeesLegacy) }

// FeesAccounting is feesAccounting: the centre's accounting over the same record the agent's log appends to.
func FeesAccounting(record Reader, timezone string, clock Clock) (Accounting, error) {
	return CreateAccounting(record, Shop{Timezone: timezone}, FeesLegacy, clock)
}

// OldDueMonths is accounting.ts oldDueMonths: fee id -> the month of each back due, from the `open_fee` lines that say `backDue: "true"`.
func OldDueMonths(entries []Entry) map[string]string {
	out := map[string]string{}
	for _, e := range entries {
		if e.Action == "open_fee" && e.Outcome == "confirmed" && e.Refs["backDue"] == "true" && e.Booking != nil && *e.Booking != "" && e.Refs["month"] != "" {
			out[*e.Booking] = e.Refs["month"]
		}
	}
	return out
}
