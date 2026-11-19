// The monthly report and the go-live finding as the JSON tree that is sealed (data.ts's object, key for key): the one place that decides which keys are written and which are left
// out, so the signed bytes are the TypeScript's. See the header of data.go for the rule (absent optional keys are spreads in the TypeScript; explicit nulls are nulls). A tree is
// map[string]any with ints, strings, bools, nil, []any and json.Number (from jsonTree): exactly what report.CanonicalJSON writes.
package bookingsreport

import (
	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

func amountTree(a accounting.Amount) map[string]any {
	return map[string]any{"count": a.Count, "paise": a.Paise}
}

func dateTree(d zone.Date) map[string]any {
	return map[string]any{"year": d.Year, "month": d.Month, "day": d.Day}
}

func stringsTree(l []string) []any {
	out := make([]any, len(l))
	for i, s := range l {
		out[i] = s
	}
	return out
}

func intsTree(l []int) []any {
	out := make([]any, len(l))
	for i, n := range l {
		out[i] = n
	}
	return out
}

func int64Tree(n *int64) any {
	if n == nil {
		return nil
	}
	return *n
}

// GoLiveTree is a GoLiveFinding as the report carries it (modules/report/go-live.ts GoLiveFinding): "none" and "untrusted" are the status alone; "own" adds the counts the certificate
// states; "own", "example" and "different" carry the code, the key that signed it and its date.
func GoLiveTree(g report.GoLiveFinding) map[string]any {
	out := map[string]any{"status": g.Status}
	if g.Status == "none" || g.Status == "untrusted" {
		return out
	}
	out["code"], out["signedBy"], out["issuedOn"] = g.Code, g.SignedBy, dateTree(g.IssuedOn)
	if g.Status == "own" {
		out["held"], out["total"], out["failed"], out["notRun"], out["notTested"] = g.Held, g.Total, g.Failed, g.NotRun, g.NotTested
	}
	return out
}

func periodTree(r *MonthlyReport) map[string]any {
	var month any
	if r.Period.Month != nil {
		month = map[string]any{"year": r.Period.Month.Year, "month": r.Period.Month.Month}
	}
	return map[string]any{"from": r.From, "to": r.To, "firstDay": dateTree(r.Period.FirstDay), "lastDay": dateTree(r.Period.LastDay), "month": month}
}

func sideTree(s Side) map[string]any {
	by := make(map[string]any, len(s.ByLanguage))
	for k, v := range s.ByLanguage {
		by[k] = v
	}
	return map[string]any{"total": s.Total, "byLanguage": by}
}

// Tree is the report as the tree that is sealed.
func (r *MonthlyReport) Tree() map[string]any {
	byAction := map[string]any{}
	for a, outcomes := range r.Record.ByAction {
		m := map[string]any{}
		for o, n := range outcomes {
			m[o] = n
		}
		byAction[a] = m
	}
	recordRows := make([]any, len(r.Record.Rows))
	for i, x := range r.Record.Rows {
		recordRows[i] = map[string]any{"seq": x.Seq, "time": x.Time, "action": x.Action, "outcome": x.Outcome, "booking": strTree(x.Booking), "inputsDigest": x.InputsDigest, "digest": x.Digest}
	}
	refunds := map[string]any{"count": r.Money.Refunds.Count, "paise": r.Money.Refunds.Paise, "ofDeposits": amountTree(r.Money.Refunds.OfDeposits), "ofSecondPayments": amountTree(r.Money.Refunds.OfSecondPayments)}
	money := map[string]any{"deposits": amountTree(r.Money.Deposits), "refunds": refunds}
	if len(r.Money.SettledByWord) > 0 {
		rows := make([]any, len(r.Money.SettledByWord))
		for i, w := range r.Money.SettledByWord {
			rows[i] = map[string]any{"by": w.By, "count": w.Count, "paise": w.Paise}
		}
		money["settledByWord"] = rows
	}
	if r.Money.BooksOnly != nil {
		money["booksOnly"] = jsonTree(r.Money.BooksOnly)
	}
	byRule := map[string]any{}
	for k, v := range r.Stopped.ByRule {
		byRule[k] = v
	}
	unconfirmedRows := make([]any, len(r.Unconfirmed.Rows))
	for i, x := range r.Unconfirmed.Rows {
		row := map[string]any{"seq": x.Seq, "action": x.Action, "outcome": x.Outcome, "booking": strTree(x.Booking), "settledLater": x.SettledLater}
		if x.SettledByWord != nil {
			row["settledByWord"] = *x.SettledByWord
		}
		unconfirmedRows[i] = row
	}
	list := make([]any, len(r.Work.List))
	for i, j := range r.Work.List {
		list[i] = map[string]any{"booking": j.Booking, "state": j.State, "why": strTree(j.Why), "seqs": intsTree(j.Seqs)}
	}
	work := map[string]any{"list": list, "jobs": r.Work.Jobs, "completed": r.Work.Completed, "abandoned": r.Work.Abandoned, "unresolved": r.Work.Unresolved, "settledByPerson": r.Work.SettledByPerson,
		"costMicroInr": int64Tree(r.Work.CostMicroInr), "costBasis": strTree(r.Work.CostBasis), "costPerCompletedMicroInr": int64Tree(r.Work.CostPerCompletedMicroInr), "noUnitCost": strTree(r.Work.NoUnitCost)}
	out := map[string]any{
		"format":       formatMonthly,
		"pathway":      map[string]any{"name": r.Pathway.Name, "version": r.Pathway.Version},
		"source":       r.Source,
		"shop":         map[string]any{"name": r.ShopName, "timeZone": r.TimeZone, "languages": stringsTree(r.Languages), "ownerLanguage": r.OwnerLang},
		"preparedBy":   strTree(r.PreparedBy),
		"period":       periodTree(r),
		"madeAt":       r.MadeAt,
		"policyDigest": r.PolicyDig,
		"record":       map[string]any{"entries": r.Record.Entries, "digest": r.Record.Digest, "byAction": byAction, "rows": recordRows},
		"bookings":     map[string]any{"made": r.Bookings.Made, "cancelled": r.Bookings.Cancelled, "moved": r.Bookings.Moved, "droppedBeforeBooked": r.Bookings.DroppedBeforeBooked},
		"money":        money,
		"owner":        map[string]any{"asked": r.Owner.Asked, "approved": r.Owner.Approved, "denied": r.Owner.Denied, "retried": r.Owner.Retried},
		"stopped":      map[string]any{"total": r.Stopped.Total, "byRule": byRule},
		"messages":     map[string]any{"toCustomers": sideTree(r.Messages.ToCustomers), "toOwner": sideTree(r.Messages.ToOwner), "heldBack": r.Messages.HeldBack},
		"unconfirmed":  map[string]any{"open": r.Unconfirmed.Open, "openOnBookings": r.Unconfirmed.OpenOnBookings, "settledLater": r.Unconfirmed.SettledLater, "rows": unconfirmedRows},
		"atReportTime": map[string]any{"waitingForOwner": r.AtReportTime.WaitingForOwner, "paidNotBooked": r.AtReportTime.PaidNotBooked},
		"work":         work,
		"missing":      map[string]any{"depositAmounts": r.Missing.DepositAmounts, "refundAmounts": r.Missing.RefundAmounts, "ownerCommands": r.Missing.OwnerCommands, "messageTargets": r.Missing.MessageTargets},
		"notCounted":   stringsTree(r.NotCounted),
		"notTested":    stringsTree(r.NotTested),
		"goLive":       GoLiveTree(r.GoLive),
		"anchor":       r.Anchor.Tree(),
	}
	if r.Innovator {
		out["innovator"] = true
	}
	if r.PaidBy != "" {
		out["paidBy"] = r.PaidBy
	}
	if r.Accounting != nil {
		out["accounting"] = jsonTree(r.Accounting)
	}
	return out
}
