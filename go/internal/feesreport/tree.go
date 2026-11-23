// The Fees monthly report as the JSON tree that is sealed (data.ts's object, key for key): the one place that decides which keys are written and which are left out, so the signed bytes
// are the TypeScript's. See the header of data.go for the rule (absent optional keys are spreads in the TypeScript; explicit nulls are nulls). The tree helpers are internal/report's
// (reportkit.go); the go-live finding's tree and the anchor's are Bookings' (the same shared types).
package feesreport

import (
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Tree is the report as the tree that is sealed.
func (r *Report) Tree() map[string]any {
	money := map[string]any{"collected": report.AmountTree(r.Money.Collected), "givenBack": report.AmountTree(r.Money.GivenBack)}
	if r.Money.OldDues != nil {
		money["oldDues"] = report.AmountTree(*r.Money.OldDues)
	}
	if len(r.Money.SettledByWord) > 0 {
		rows := make([]any, len(r.Money.SettledByWord))
		for i, w := range r.Money.SettledByWord {
			rows[i] = map[string]any{"by": w.By, "count": w.Count, "paise": w.Paise}
		}
		money["settledByWord"] = rows
	}
	if r.Money.BooksOnly != nil {
		money["booksOnly"] = report.JSONTree(r.Money.BooksOnly)
	}
	byLanguage, byRule := map[string]any{}, map[string]any{}
	for k, v := range r.Reminders.ByLanguage {
		byLanguage[k] = v
	}
	for k, v := range r.Stopped.ByRule {
		byRule[k] = v
	}
	out := map[string]any{
		"format":       formatReport,
		"pathway":      map[string]any{"name": r.Pathway.Name, "version": r.Pathway.Version},
		"source":       r.Source,
		"shop":         map[string]any{"name": r.ShopName, "timeZone": r.TimeZone, "languages": report.StringsTree(r.Languages), "ownerLanguage": r.OwnerLang},
		"preparedBy":   report.StrTree(r.PreparedBy),
		"period":       report.PeriodTree(r.Period, r.From, r.To),
		"madeAt":       r.MadeAt,
		"policyDigest": r.PolicyDig,
		"record":       map[string]any{"entries": r.Record.Entries, "digest": r.Record.Digest, "byAction": report.ByActionTree(r.Record.ByAction)},
		"money":        money,
		"fees": map[string]any{"opened": r.Fees.Opened, "paidInFull": r.Fees.PaidInFull, "partlyPaid": r.Fees.PartlyPaid, "stillOpen": r.Fees.StillOpen,
			"stillToCollect": report.AmountTree(r.Fees.StillToCollect)},
		"waivers": map[string]any{"total": report.AmountTree(r.Waivers.Total), "byOwner": report.AmountTree(r.Waivers.ByOwner), "withinLimit": report.AmountTree(r.Waivers.WithinLimit),
			"lateFeesAdded": report.AmountTree(r.Waivers.LateFeesAdded)},
		"owner":       map[string]any{"asked": r.Owner.Asked, "approved": r.Owner.Approved, "denied": r.Owner.Denied},
		"reminders":   map[string]any{"sent": r.Reminders.Sent, "byLanguage": byLanguage, "receipts": r.Reminders.Receipts},
		"parents":     map[string]any{"stopped": r.Parents.Stopped},
		"stopped":     map[string]any{"total": r.Stopped.Total, "byRule": byRule},
		"messages":    map[string]any{"toOwner": r.Messages.ToOwner, "heldBack": r.Messages.HeldBack},
		"unconfirmed": map[string]any{"open": r.Unconfirmed.Open},
		"notCounted":  report.StringsTree(r.NotCounted),
		"notTested":   report.StringsTree(r.NotTested),
		"goLive":      bookingsreport.GoLiveTree(r.GoLive),
		"anchor":      r.Anchor.Tree(),
	}
	if r.Innovator {
		out["innovator"] = true
	}
	if r.PaidBy != "" {
		out["paidBy"] = r.PaidBy
	}
	if r.Accounting != nil {
		out["accounting"] = report.JSONTree(r.Accounting)
	}
	if c := r.Classes; c != nil {
		out["classes"] = map[string]any{"held": c.Held, "linksSent": c.LinksSent, "attendanceMarked": c.AttendanceMarked, "missedNotes": c.MissedNotes, "doubts": c.Doubts}
	}
	return out
}
